"""RAG engine: load -> chunk -> embed -> store (Chroma) -> retrieve with source metadata."""
from __future__ import annotations

import hashlib
import logging
import re
from pathlib import Path
from typing import Any

from langchain_chroma import Chroma
import pymupdf4llm
from langchain_community.document_loaders import Docx2txtLoader
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

import config

logger = logging.getLogger("capsight.rag")

SUPPORTED_EXTENSIONS = {".pdf", ".docx"}


def _clean(text: str) -> str:
    """Normalise whitespace left over from PDF/Word extraction."""
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _page_number(meta: dict, index: int) -> int:
    """1-based page number from pymupdf4llm chunk metadata, whatever the library version calls it."""
    for key in ("page", "page_number", "page_num"):
        value = meta.get(key)
        if isinstance(value, int) and value > 0:
            return value
    return index + 1


class RAGEngine:
    def __init__(
        self,
        data_dir: Path = config.DATA_DIR,
        persist_dir: Path = config.PERSIST_DIR,
        collection_name: str = config.COLLECTION_NAME,
        embedding_model: str = config.EMBEDDING_MODEL,
        chunk_size: int = config.CHUNK_SIZE,
        chunk_overlap: int = config.CHUNK_OVERLAP,
    ):
        self.data_dir = Path(data_dir)
        self.persist_dir = Path(persist_dir)
        self.collection_name = collection_name
        self.embedding_model = embedding_model
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            separators=["\n\n", "\n", ". ", " ", ""],
        )
        self._embeddings: HuggingFaceEmbeddings | None = None
        self._store: Chroma | None = None

    # ------------------------------------------------------------------ setup
    @property
    def embeddings(self) -> HuggingFaceEmbeddings:
        if self._embeddings is None:
            logger.info("Loading embedding model: %s", self.embedding_model)
            self._embeddings = HuggingFaceEmbeddings(
                model_name=self.embedding_model,
                encode_kwargs={"normalize_embeddings": True},
                query_encode_kwargs={
                    "prompt": "Represent this sentence for searching relevant passages: ",
                    "normalize_embeddings": True,
                },
            )
        return self._embeddings

    @property
    def store(self) -> Chroma:
        if self._store is None:
            self._store = Chroma(
                collection_name=self.collection_name,
                embedding_function=self.embeddings,
                persist_directory=str(self.persist_dir),
                collection_metadata={"hnsw:space": "cosine"},
            )
        return self._store

    # -------------------------------------------------------------- ingestion
    def list_files(self) -> list[Path]:
        if not self.data_dir.exists():
            return []
        return sorted(
            p for p in self.data_dir.rglob("*")
            if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS
            and not p.name.startswith("~$")  # Word temp files
        )

    def _load_file(self, path: Path) -> list[Document]:
      rel = str(path.relative_to(self.data_dir))
      out = []

      if path.suffix.lower() == ".pdf":
          # 按页提取为 Markdown 格式，完整保留表格的行列结构
          md_pages = pymupdf4llm.to_markdown(str(path), page_chunks=True)
          for i, p in enumerate(md_pages):
              text = _clean(p["text"])
              if not text:
                  continue
              out.append(Document(
                  page_content=text,
                  metadata={
                      "source_file": path.name,
                      "source_path": rel,
                      "file_type": "pdf",
                      # pymupdf4llm renamed "page" to "page_number" in newer versions; fall back to position
                      "page": _page_number(p.get("metadata", {}), i),
                  },
              ))
      else:
          docs = Docx2txtLoader(str(path)).load()
          for d in docs:
              text = _clean(d.page_content)
              if not text:
                  continue
              out.append(Document(
                  page_content=text,
                  metadata={
                      "source_file": path.name,
                      "source_path": rel,
                      "file_type": path.suffix.lower().lstrip("."),
                      "page": -1,
                  },
              ))
      return out

    def load_documents(self) -> tuple[list[Document], list[str]]:
        """Returns (documents, files_with_no_extractable_text)."""
        docs: list[Document] = []
        empty_files: list[str] = []
        for path in self.list_files():
            try:
                loaded = self._load_file(path)
            except Exception as exc:  # one bad file must not kill the whole ingest
                logger.error("Failed to load %s: %s", path.name, exc)
                empty_files.append(path.name)
                continue
            if not loaded:
                logger.warning("No extractable text in %s (scanned PDF? needs OCR)", path.name)
                empty_files.append(path.name)
            docs.extend(loaded)
        return docs, empty_files

    def chunk_documents(self, docs: list[Document]) -> list[Document]:
        chunks = self.splitter.split_documents(docs)
        counters: dict[tuple, int] = {}
        for c in chunks:
            key = (c.metadata["source_file"], c.metadata["page"])
            counters[key] = counters.get(key, 0) + 1
            c.metadata["chunk_index"] = counters[key]
        return chunks

    @staticmethod
    def _chunk_id(chunk: Document) -> str:
        m = chunk.metadata
        raw = f'{m["source_path"]}|{m["page"]}|{m["chunk_index"]}|{chunk.page_content[:50]}'
        return hashlib.sha1(raw.encode()).hexdigest()

    def build_index(self, rebuild: bool = False) -> dict[str, Any]:
        """Ingest everything in data_dir. rebuild=True wipes the collection first."""
        if rebuild:
            try:
                self.store.delete_collection()
            except Exception:
                pass
            self._store = None  # recreate fresh collection on next access

        docs, empty_files = self.load_documents()
        chunks = self.chunk_documents(docs)
        if chunks:
            ids = [self._chunk_id(c) for c in chunks]
            # Deterministic ids -> re-running without rebuild upserts instead of duplicating.
            batch = 500
            for i in range(0, len(chunks), batch):
                self.store.add_documents(chunks[i:i + batch], ids=ids[i:i + batch])
        stats = {
            "files_found": len(self.list_files()),
            "files_without_text": empty_files,
            "pages_or_sections_loaded": len(docs),
            "chunks_indexed": len(chunks),
            "total_chunks_in_store": self.count(),
        }
        logger.info("Ingest complete: %s", stats)
        return stats

    # -------------------------------------------------------------- retrieval
    def count(self) -> int:
        return self.store._collection.count()

    def list_indexed_sources(self) -> list[str]:
        data = self.store.get(include=["metadatas"])
        return sorted({m["source_file"] for m in data["metadatas"]})

    def retrieve(
        self,
        query: str,
        top_k: int = config.DEFAULT_TOP_K,
        min_score: float | None = None,
        source_files: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Return the top_k most relevant chunks with exact source metadata.

        score = cosine similarity in [~0, 1]; higher is more relevant.
        """
        search_filter = None
        if source_files:
            search_filter = {"source_file": {"$in": source_files}}

        hits = self.store.similarity_search_with_relevance_scores(
            query, k=top_k, filter=search_filter
        )
        results = []
        for doc, score in hits:
            if min_score is not None and score < min_score:
                continue
            m = doc.metadata
            results.append({
                "text": doc.page_content,
                "score": round(float(score), 4),
                "source": {
                    "file_name": m["source_file"],
                    "file_path": m["source_path"],
                    "file_type": m["file_type"],
                    "page": m["page"] if m["page"] != -1 else None,
                    "chunk_index": m["chunk_index"],
                },
            })
        return results


if __name__ == "__main__":  # python rag_engine.py  -> quick CLI ingest
    import sys

    logging.basicConfig(level=logging.INFO)
    print(RAGEngine().build_index(rebuild="--rebuild" in sys.argv))
