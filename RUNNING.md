# Running Capsight with the knowledge base and the PR04 tests

**Quickest:** `bash run-all-tests.sh` does steps 1 and 3 in one go (keys copied from your earlier Capsight folder if missing).

Three parts run side by side. Use three terminal windows, from the project folder.

## 1 · Knowledge base (rag-service, Python 3.10+; built by Xu Zihan)

```bash
cd rag-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# the 40 admitted PDFs and register.csv must be in rag-service/data/
python rag_engine.py --rebuild        # first time only: indexes ~3,500 pages (downloads a ~130 MB model)
uvicorn main:app --port 8000
```

Check: http://localhost:8000/health shows `chunks_indexed` > 0.

`data/register.csv` is generated from Yvonne's KM Gate Run4 audit (2_PR02_Intake): title, issuer, date, official URL, JP tag and the human admit decision for each document. Rows marked `admitted = no` are never cited. EDG (S04) and PSG (S05) are admitted as history and carry "(Ceased 29 Sep 2026)" in their title.

## 2 · Server and website

Add to `server/keys.env`:

```
RAG_URL=http://localhost:8000
```

```bash
cd server && npm run dev              # API at http://localhost:8787
cd web && npm run dev                 # website at http://localhost:5173
```

## 3 · PR04 tests (test sets by Sasitheran)

With 1 and the keys in place (the server does not need to be running):

```bash
bash eval/pr04/run-pr04.sh rag50      # 50 RAG questions asked straight to the knowledge base
bash eval/pr04/run-pr04.sh founder    # reports for TC01–TC07
python3 eval/pr04/fill_workbooks.py eval/pr04/runs/<folder>   # copies the workbook, fills answers + AI pre-score
# after Sasi has filled "Your result" (human score) in the filled RAG workbook:
python3 eval/pr04/score_rag50.py eval/pr04/runs/<rag50 folder>/PR04_50_RAG_Question_Bank_filled.xlsx
```

Each run folder holds `results.json/.csv` (or `TC0x.md` reports), `summary.md`, and a filled copy of the PR04 workbook.

What is automatic and what is not:

| | automatic | by a person |
|---|---|---|
| RAG 50 | hit@k, answer cites expected document, claims dropped by the quote gate, AI pre-score (suggestion only) | Acceptable / Partial / Reject per question (F1); override rate vs the AI pre-score |
| Founder TC01–07 | report, references, JP status table | Good / Partly / Wrong per JP; claim spot-checks (F2, F3) |
| Friends TC08–10 | — | the friend runs it on the website and rates it 1–5 (F4) |

All runs are In-vitro (team-written questions and fictional ideas) except TC08–10.
