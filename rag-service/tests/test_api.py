"""API contract tests using a fake engine (no model download needed). Run: pytest"""
from fastapi.testclient import TestClient

from main import app, get_engine


class FakeEngine:
    embedding_model = "fake"

    def count(self):
        return 2

    def list_files(self):
        from pathlib import Path
        return [Path("data/a.pdf")]

    def list_indexed_sources(self):
        return ["a.pdf"]

    def retrieve(self, query, top_k=5, min_score=None, source_files=None):
        return [{
            "text": "SaaS startups may qualify for the Startup SG Founder grant.",
            "score": 0.82,
            "source": {"file_name": "a.pdf", "file_path": "a.pdf", "file_type": "pdf",
                       "page": 3, "chunk_index": 1},
        }]


app.dependency_overrides[get_engine] = lambda: FakeEngine()
client = TestClient(app)  # not used as a context manager -> skips lifespan/model load


def test_health():
    assert client.get("/health").json()["status"] == "ok"


def test_retrieve_shape():
    r = client.post("/retrieve", json={"query": "SaaS grants Singapore"})
    body = r.json()
    assert r.status_code == 200
    assert body["total_results"] == 1
    assert body["source_documents"] == ["a.pdf"]
    assert body["results"][0]["source"]["page"] == 3


def test_retrieve_validation():
    assert client.post("/retrieve", json={"query": "x"}).status_code == 422


def test_files_rejects_unknown():
    assert client.get("/files/not-there.pdf").status_code == 404
