#!/bin/bash
# One command on the Mac: set up the knowledge base, start it, run both PR04 tests, fill the workbooks.
#   cd <this folder> && bash run-all-tests.sh
# First run takes ~30–40 min (Python packages, a ~130 MB embedding model, indexing ~3,500 pages, then the tests).
# Keep the Mac awake and the window open. Nothing here prints your API keys.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

say() { printf '\n\033[1;32m== %s\033[0m\n' "$1"; }

# ---------- keys: reuse the Capsight keys if this folder has none yet ----------
if [ ! -f server/keys.env ]; then
  for old in "$ROOT/../调研ai工具项目/server/keys.env" "$HOME/Desktop/我的项目/调研ai工具项目/server/keys.env"; do
    if [ -f "$old" ]; then cp "$old" server/keys.env; say "Copied API keys from the Capsight folder"; break; fi
  done
fi
[ -f server/keys.env ] || { echo "server/keys.env not found. Copy it from your Capsight project (server/keys.env) and run again."; exit 1; }
grep -q '^RAG_URL=' server/keys.env || { printf '\nRAG_URL=http://localhost:8000\n' >> server/keys.env; say "Added RAG_URL to server/keys.env"; }

# ---------- 1. knowledge base ----------
say "1/4 Knowledge base: Python packages"
cd rag-service
PY=python3
command -v python3.12 >/dev/null && PY=python3.12
command -v python3.11 >/dev/null && PY=python3.11
$PY -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || { echo "Python 3.10+ needed (found $($PY --version)). Install it with:  brew install python@3.12   then run again."; exit 1; }
[ -d .venv ] || $PY -m venv .venv
source .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt

ls data/*.pdf >/dev/null 2>&1 || { echo "No PDFs in rag-service/data. Put the 40 KM Gate PDFs there and run again."; exit 1; }
if [ ! -f chroma_db/.indexed ]; then
  say "2/4 Indexing the PDFs (first time only, ~10–20 min)"
  python rag_engine.py --rebuild | tee ../rag-index.log
  COUNT=$(python -c "from rag_engine import RAGEngine; print(RAGEngine().count())")
  [ "$COUNT" -gt 0 ] || { echo "Indexing produced 0 chunks; see rag-index.log and send it to the team."; exit 1; }
  echo "$COUNT chunks" > chroma_db/.indexed
else
  say "2/4 Index already built: $(cat chroma_db/.indexed) (delete rag-service/chroma_db to rebuild)"
fi

say "Starting the knowledge base on http://localhost:8000"
uvicorn main:app --port 8000 > ../rag-service.log 2>&1 &
RAG_PID=$!
trap 'kill $RAG_PID 2>/dev/null' EXIT
for i in $(seq 1 60); do
  curl -s localhost:8000/health >/dev/null 2>&1 && break
  sleep 2
done
curl -s localhost:8000/health; echo
cd "$ROOT"

# ---------- 2. tests ----------
say "3/4 PR04 RAG test: 50 questions"
bash eval/pr04/run-pr04.sh rag50
RAG_RUN="$(ls -td eval/pr04/runs/rag50-* | head -1)"
python eval/pr04/fill_workbooks.py "$RAG_RUN"

say "4/4 PR04 founder test: TC01–TC07"
bash eval/pr04/run-pr04.sh founder
F_RUN="$(ls -td eval/pr04/runs/founder-* | head -1)"
python eval/pr04/fill_workbooks.py "$F_RUN"

say "Done"
echo "RAG results:      $RAG_RUN  (summary.md, PR04_50_RAG_Question_Bank_filled.xlsx)"
echo "Founder reports:  $F_RUN  (TC01.md … TC07.md, PR04_10_Founder_Tests_filled.xlsx)"
echo "Next: Sasi scores 'Your result' in the RAG workbook, then:"
echo "  python3 eval/pr04/score_rag50.py \"$RAG_RUN/PR04_50_RAG_Question_Bank_filled.xlsx\""
open "$RAG_RUN" 2>/dev/null || true
