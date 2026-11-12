# Capsight-StartupHelp: SG SaaS-Focused Startup Research Agent

> A founder writes one sentence about a SaaS idea. Capsight returns a readable Singapore market report in about two minutes, where every figure is cited to its source and every gap is stated. **The report never tells the founder whether to build. The founder decides.**

MSI5002 Gate 3 team project, National University of Singapore (November 2026).
Team: Li Yisha · Chng Hui Mei (Angie) · Seah Yee Hong (Yvonne) · Xu Zihan · Sasitheran Ramamoorthy.

---

## 1. What the system does

Capsight-StartupHelp is **one system with two research modules** that feed one report:

| Module | What it answers | How |
| --- | --- | --- |
| **Policy knowledge base (RAG)** | JP1 market size and growth · JP2 regulations · JP3 government grants | Retrieval over **40 Singapore official documents** that passed a human admission gate (statutes, PDPC/IMDA/CSA guidelines, Enterprise Singapore grants, SingStat and MTI reports) |
| **Competitor research** | JP4 competitors · JP5 competitor pricing | Web search for competitors, confirmation of each company's official site, then a structured table read from public pages |

```
Founder's one-sentence idea
   │
   ▼  Read the idea: product, customer, sector, market (shown on the report so a misread is visible)
   │
   ├──► Policy knowledge base (RAG) ──► JP1 market · JP2 regulation · JP3 grants
   │       only documents admitted by the KM gate; passages carry document, page, issuer, date
   │
   ├──► Competitor research ──► JP4 competitors · JP5 pricing
   │       search → official site (confirmed by search results and Wikidata) → read public pages
   │       → table: overview · country/region · size · funding · pricing
   │
   ▼  Evidence gates (run in code, not by the model)
   │   • a claim is kept only if its quoted text is found in the source passage
   │   • a sentence with a number that appears in no source is removed
   │   • "build / invest / stop" verdict wording is removed
   │   • a model or knowledge-base outage stops the report; it is never reported as "no data"
   │
   ▼  Report: key takeaways · one cited paragraph per judgment point · competitor table (CSV export)
   │          · what to validate next · numbered references (document, page, issuer, date)
   │
   ▼  The founder decides
```

The language model (DeepSeek) reads the idea, extracts candidate facts and writes the paragraphs. **Code decides what is kept.**

## 2. Report structure (judgment points)

| # | Judgment point | Evidence from | Counts as enough evidence | If missing, the report says |
| --- | --- | --- | --- | --- |
| JP1 | How big is the market, and is it growing? | Knowledge base | ≥1 official statistic or industry report | "No data found for this market segment" |
| JP2 | Which policies and regulations apply? | Knowledge base | Original government text, with its date | "No relevant regulation found; please consult a professional" |
| JP3 | Any government grants or support? | Knowledge base | Original official text | "No relevant grant found" |
| JP4 | Who are the competitors? | Competitor research | ≥3 competitors confirmed on their official sites | "Only n found; list may be incomplete" |
| JP5 | How do competitors charge? | Competitor research | Official prices from ≥3 competitors | "Pricing not publicly available" |
| Summary | Signals, risks, gaps, what the founder must validate | JP1–JP5 | **No go / no-go verdict** | |

## 3. Test results (PR04, In-vitro, 8 Nov 2026)

Test sets written by Sasitheran Ramamoorthy; runs on the integrated system. Raw files: [`eval/pr04/runs/`](eval/pr04/runs/).

**Knowledge base: 50 questions asked directly to the RAG module**

| Measure | Result |
| --- | --- |
| Retrieval returned an expected document (hit@6) | 49/50 (98%) |
| Answer cites an expected document | 43/50 (86%) |
| Answered with at least one verified claim | 46/50 (92%); the other 4 said "not found" instead of guessing |
| Claims removed by the quote gate | 16 of 213 proposed |
| Cited-document precision / recall / F1 | 0.75 / 0.72 / 0.74 |
| Fabricated sources | 0 (a quote not found in its source is never kept) |

**Founder reports: scenarios TC01–TC07 (fictional ideas written by the team)**

| Measure | Result |
| --- | --- |
| Judgment points with enough evidence | 34/35 (97%); TC06 pricing partial, flagged in the report |
| Competitor-table values that passed the quote check | 147/168 (88%) |
| Pricing details filled, all from official sites | 124/168 (74%); 0 third-party prices |
| References per report | 17–26 |
| Time per report | 98–174 seconds |
| Ceased grants flagged | TC04 states that EDG and PSG ceased on 29 Sep 2026 |

**What these numbers prove, and what they do not.** They show that answers are traceable to admitted sources and that nothing is fabricated. They do not show that every answer is complete or that the report helps a real founder decide. Real-founder tests (TC08–TC10, In-vivo) are planned and were not run before Gate 3, so falsifier F4 is still open.

**Run note.** The 8 Nov founder run (TC01–TC07) ran with the Wikidata cross-check for official sites switched off by mistake (logged as ISS-05; the setting is on in this repository).

**Known limits.** JP1 can cite national digital-economy data when no sector-specific figure exists, while still marked "enough". The knowledge base has no Ministry of Manpower employment law. Retrieval has no reranker (retrieval precision 0.51); this is the next step, to be tested on new questions rather than tuned on these 50.

## 4. Governance

- **Admission gate (PR02):** no document enters the knowledge base without issuer, date, official URL and judgment-point tag, and a human admit decision. Four audit runs and the final registry check are in [`eval/pr02-km-gate/`](eval/pr02-km-gate/). Ceased schemes (EDG, PSG) are admitted as history only and labelled as ceased in every citation.
- **Public sources only:** the system reads public web pages and admitted public documents. The founder's idea sentence is sent to the language model and search APIs to run the research; nothing else about the founder is collected. API keys stay in a local `keys.env` that is never committed.
- **The founder decides:** the verdict filter removes build/invest/stop wording, and every report states that the decision is the founder's.

## 5. Who built what

| Part | Folder | Owner |
| --- | --- | --- |
| **Lead:** system design and build (website + server, report pipeline, evidence gates), team task plan, test logic (F1–F4), integration of the RAG module and search APIs, all test runs; reviewed the judgment points | `web/`, `server/`, `eval/pr04/` runners and results | Li Yisha |
| Judgment points JP1–JP5 and evidence bars | report structure above | Chng Hui Mei |
| Document discovery, audit and admission (KM gate) | `eval/pr02-km-gate/`, `rag-service/data/register.csv` | Seah Yee Hong |
| Knowledge-base service (FastAPI + Chroma, BGE embeddings) | `rag-service/` | Xu Zihan |
| Test questions (50 RAG questions, 10 founder scenarios) and the independent number check | `eval/pr04/` | Sasitheran Ramamoorthy |

## 6. Run it

Requires Node.js 22.18+ and Python 3.10+. API keys (DeepSeek, Serper, Jina) go in `server/keys.env`. Full steps: [`RUNNING.md`](RUNNING.md).

```bash
# 1. Knowledge base (first run builds the index from the 40 admitted PDFs in rag-service/data/)
cd rag-service && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && uvicorn main:app --port 8000

# 2. Server and website
cd server && npm start                     # http://localhost:8787
cd web && npm install && npm run dev       # http://localhost:5173

# 3. Automated tests (68 tests of the evidence gates, RAG adapter and report pipeline)
cd server && npm test

# 4. PR04 test sets
bash eval/pr04/run-pr04.sh rag50
bash eval/pr04/run-pr04.sh founder
```

The PDFs are not stored in this repository; each row of `rag-service/data/register.csv` links to the official source.

## 7. Repository map

| Path | What |
| --- | --- |
| `web/` | Website: one-sentence input, progress, report page, CSV/Markdown export (Vite + React + TypeScript) |
| `server/` | API: idea reading, competitor research module, evidence gates, report writing (Node.js + TypeScript) |
| `rag-service/` | Knowledge-base service and the admission register |
| `eval/pr04/` | PR04 test sets, runners, workbooks and run results |
| `eval/pr02-km-gate/` | PR02 KM gate audit runs and registry check |
| `eval/batch-*` | Competitor-research test batches from Gate 2 (before integration) |
| `docs/RAG-API.md` | The contract between the server and the knowledge base |

The competitor research module started as Li Yisha's Gate 2 project (repository `capsight`); in this system it is the module behind JP4 and JP5.

---

## License · 版权声明

© 2026 Li Yisha. All rights reserved.

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may read, study and use it for personal, academic and other noncommercial purposes. **Any commercial use requires prior written permission from the author.**

本项目采用 [PolyForm Noncommercial 1.0.0](LICENSE) 许可证。允许个人学习、学术研究等非商业用途；**任何商业用途须事先获得作者书面许可。**
