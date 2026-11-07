# Capsight – RAG Knowledge Base & API

Serves verified Singapore policy / regulatory / macro-industry context with exact source tracing.

## Structure

```
capsight-rag/
├── data/            # drop your 30-40 PDFs / .docx here
├── chroma_db/       # auto-created vector store (gitignored)
├── tests/test_api.py
├── config.py        # all settings (env-overridable)
├── rag_engine.py    # load -> chunk -> embed -> Chroma -> retrieve
├── main.py          # FastAPI app
└── requirements.txt
```

## Setup

```bash
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
# put documents in data/
python rag_engine.py --rebuild      # optional: ingest from the CLI
uvicorn main:app --reload --port 8000
```

Swagger UI: http://localhost:8000/docs (first run downloads the embedding model, \~130 MB).

## Endpoints

|Method|Path|Purpose|
|-|-|-|
|POST|`/retrieve`|query -> relevant chunks + sources|
|POST|`/ingest`|(re)index `data/` (`{"rebuild": true}` to wipe first)|
|GET|`/sources`|list indexed documents|
|GET|`/health`|status + chunk count|

### Example

```bash
curl -X POST localhost:8000/retrieve -H "Content-Type: application/json" \\
  -d '{"query": "PDPA obligations for a SaaS company", "top_k": 3}'
```

```json
{
  "query": "PDPA obligations for a SaaS company",
  "total_results": 3,
  "results": [
    {"text": "...", "score": 0.78,
     "source": {"file_name": "PDPA_Guidelines.pdf", "file_path": "PDPA_Guidelines.pdf",
                "file_type": "pdf", "page": 12, "chunk_index": 2}}
  ],
  "source_documents": ["PDPA_Guidelines.pdf"]
}
```

`page` is `null` for Word files (no fixed pages). Teammate integration: `requests.post(url + "/retrieve", json={...}).json()["results"]`.

## Notes

* Scanned PDFs without a text layer are reported under `files_without_text` in the `/ingest` response; they need OCR.
* Legacy `.doc` files aren't supported; re-save as `.docx`.
* Tune chunking/model via env vars, e.g. `CAPSIGHT_CHUNK_SIZE=800`. Changing the embedding model requires `rebuild: true`.
* Tests: `python -m pytest`

