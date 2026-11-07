"""Central settings. Override any of these with environment variables."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

DATA_DIR = Path(os.getenv("CAPSIGHT_DATA_DIR", BASE_DIR / "data"))
PERSIST_DIR = Path(os.getenv("CAPSIGHT_PERSIST_DIR", BASE_DIR / "chroma_db"))
COLLECTION_NAME = os.getenv("CAPSIGHT_COLLECTION", "sg_policy_docs")

# Local embedding model: free, no API key. Swap for a larger one if quality matters
# (e.g. "BAAI/bge-base-en-v1.5" or "intfloat/e5-base-v2").
EMBEDDING_MODEL = os.getenv("CAPSIGHT_EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")

CHUNK_SIZE = int(os.getenv("CAPSIGHT_CHUNK_SIZE", "1000"))
CHUNK_OVERLAP = int(os.getenv("CAPSIGHT_CHUNK_OVERLAP", "150"))
DEFAULT_TOP_K = int(os.getenv("CAPSIGHT_TOP_K", "5"))

# Build the index automatically on API startup if the vector store is empty.
AUTO_INGEST = os.getenv("CAPSIGHT_AUTO_INGEST", "true").lower() == "true"
