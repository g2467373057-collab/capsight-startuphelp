"""FastAPI service exposing the Capsight RAG knowledge base.

Run:  uvicorn main:app --reload --port 8000
Docs: http://localhost:8000/docs  (Swagger UI)
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import config
from rag_engine import RAGEngine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("capsight.api")


# ---------------------------------------------------------------- schemas
class RetrieveRequest(BaseModel):
    query: str = Field(..., min_length=3, examples=["What grants are available for Singapore SaaS startups?"])
    top_k: int = Field(config.DEFAULT_TOP_K, ge=1, le=20)
    min_score: float | None = Field(None, ge=0, le=1, description="Drop chunks scoring below this.")
    source_files: list[str] | None = Field(None, description="Restrict search to these file names.")


class SourceInfo(BaseModel):
    file_name: str
    file_path: str
    file_type: str
    page: int | None = None
    chunk_index: int


class RetrievedChunk(BaseModel):
    text: str
    score: float
    source: SourceInfo


class RetrieveResponse(BaseModel):
    query: str
    total_results: int
    results: list[RetrievedChunk]
    source_documents: list[str] = Field(description="Unique file names cited, in relevance order.")


class IngestRequest(BaseModel):
    rebuild: bool = Field(False, description="Wipe the vector store and re-index from scratch.")


# ---------------------------------------------------------------- app
@asynccontextmanager
async def lifespan(app: FastAPI):
    engine = RAGEngine()
    app.state.engine = engine
    if config.AUTO_INGEST:
        try:
            if engine.count() == 0 and engine.list_files():
                logger.info("Vector store empty - ingesting documents from %s", engine.data_dir)
                engine.build_index()
        except Exception:
            logger.exception("Auto-ingest failed; call POST /ingest manually.")
    yield


app = FastAPI(
    title="Capsight RAG Knowledge Base API",
    description="Verified Singapore policy, regulatory and industry context with source tracing.",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_engine(request: Request) -> RAGEngine:
    return request.app.state.engine


@app.get("/health")
def health(engine: RAGEngine = Depends(get_engine)):
    return {
        "status": "ok",
        "embedding_model": engine.embedding_model,
        "chunks_indexed": engine.count(),
        "files_in_data_dir": len(engine.list_files()),
    }


@app.get("/sources")
def sources(engine: RAGEngine = Depends(get_engine)):
    """List every document currently indexed."""
    docs = engine.list_indexed_sources()
    return {"total": len(docs), "documents": docs}


@app.post("/ingest")
def ingest(body: IngestRequest = IngestRequest(), engine: RAGEngine = Depends(get_engine)):
    """(Re)build the index from the data folder. Call after adding or changing documents."""
    return engine.build_index(rebuild=body.rebuild)


@app.post("/retrieve", response_model=RetrieveResponse)
def retrieve(body: RetrieveRequest, engine: RAGEngine = Depends(get_engine)):
    if engine.count() == 0:
        raise HTTPException(503, "Knowledge base is empty. Add files to data/ and call POST /ingest.")
    results = engine.retrieve(
        body.query, top_k=body.top_k, min_score=body.min_score, source_files=body.source_files
    )
    unique_sources = list(dict.fromkeys(r["source"]["file_name"] for r in results))
    return RetrieveResponse(
        query=body.query,
        total_results=len(results),
        results=results,
        source_documents=unique_sources,
    )


@app.get("/files/{file_name}")
def get_file(file_name: str, engine: RAGEngine = Depends(get_engine)):
    """Serve an admitted document so a report citation can open it (only files inside data/)."""
    for path in engine.list_files():
        if path.name == file_name:
            return FileResponse(path)
    raise HTTPException(404, "Not in the knowledge base")
