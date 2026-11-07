#!/bin/bash
# PR04 tests.  Start the knowledge base first (see rag-service/README.md), then:
#   bash eval/pr04/run-pr04.sh rag50            → 50 RAG questions (~10 min)
#   bash eval/pr04/run-pr04.sh founder          → reports for TC01–TC07 (~5 min each)
#   bash eval/pr04/run-pr04.sh founder TC04     → one scenario
# Then fill the PR04 workbooks for human scoring:
#   python3 eval/pr04/fill_workbooks.py eval/pr04/runs/<folder>
set -e
cd "$(dirname "$0")/../../server"
if command -v caffeinate >/dev/null; then KEEP="caffeinate -i"; else KEEP=""; fi
$KEEP node --no-warnings=ExperimentalWarning ../eval/pr04/run-pr04.ts "$@"
