# 胶囊AI · Capsight

> 一句话描述你的 SaaS 创业想法，得到一份有出处的市场调研报告。做不做，由你决定。
> Describe your SaaS idea in one sentence; get a source-traced market report. Whether to build it is your call.

Capsight takes a founder's one-sentence idea and writes a readable market report for Singapore: market size, regulations, government grants, competitors and their pricing. Every figure carries a numbered citation to an official source, every gap is stated instead of guessed, and the report never tells the founder to build or not.

## How it works

```
one-sentence idea
  → read the idea (product, customer, market)
  → two evidence streams
      · policy knowledge base (RAG over 40 admitted Singapore official documents) → JP1 market · JP2 regulation · JP3 grants
      · competitor research module (official sites, search) → JP4 competitors · JP5 pricing
  → evidence wall: a claim is kept only if its quote is found in the source; sentences with numbers found in no source,
    or telling the founder to build / invest / stop, are removed
  → readable report: one paragraph per judgment point with [n] citations, key takeaways, what to validate next, references
  → the founder decides
```

## Report structure (judgment points)

| # | Judgment point | Evidence from | Enough evidence | If missing |
| --- | --- | --- | --- | --- |
| JP1 | How big is the market, and is it growing? | Knowledge base | ≥1 official statistic or industry report | "No data found for this market segment" |
| JP2 | Which policies and regulations apply? | Knowledge base | Original government text, with date | "No relevant regulation found; please consult a professional" |
| JP3 | Any government grants or support? | Knowledge base | Original official text | "No relevant grant found" |
| JP4 | Who are the competitors? | Competitor research | ≥3 competitors from official websites | "Only n found; list may be incomplete" |
| JP5 | How do competitors charge? | Competitor research | Official prices from ≥3 competitors | "Pricing not publicly available" |
| Summary | Signals, risks, gaps, what the founder must validate | JP1–JP5 | No go / no-go verdict | |

## Project layout

| Folder | What | Built by |
| --- | --- | --- |
| `web/` | Website: one-sentence input, progress, report page, exports | Li Yisha |
| `server/` | API: idea reading, competitor research module, evidence gates, report writing | Li Yisha |
| `rag-service/` | Knowledge base service (FastAPI + Chroma), `data/register.csv` admission register | Xu Zihan; documents and register from Seah Yee Hong's KM gate |
| `eval/pr04/` | 50 RAG questions and 10 founder scenarios, runners and workbooks | test sets by Sasitheran Ramamoorthy |
| `eval/batch-*` | Competitor research test runs (Gate 2) | Li Yisha |
| `docs/`, `RUNNING.md` | RAG API contract, how to run everything | |

Judgment points JP1–JP5 come from Chng Hui Mei's judgment-point table. MSI5002 Gate 3 team project, National University of Singapore.

## Run it

See [`RUNNING.md`](RUNNING.md). Quickest: `bash run-all-tests.sh` (knowledge base + PR04 tests), then `server: npm run dev` and `web: npm install && npm run dev`, open http://localhost:5173.

---

## Appendix · The competitor research module (Gate 2 version)

*The section below describes Capsight before Gate 3, when competitor research was the whole product. It is now the module behind JP4 and JP5.*


> 吃下一颗，就看清局面。 / Take one. See the whole field.

[English](#english) · [中文](#中文)

---

### English

Capsight is a free AI research assistant for **SaaS competitor research**. Ask one question in Chinese or English and it finds the competitors, collects their official pages and other public sources, checks every fact against its source page, and returns a table you can export to CSV.

**Two ways to ask**
- **You don't know your competitors yet.** Describe your product (e.g. "We build online collaborative docs, find our competitors"). Capsight lists the competitors, each with a short introduction, country/region, company size and funding.
- **You know who they are.** Name them (e.g. "Compare Asana, Monday.com and Trello pricing"). Capsight looks up the overview, region, features, pricing, social accounts and recent news.
- A "find competitors" result has a one-click button to look up the details of the competitors it found. You don't have to start over.

**Pricing in a fixed six-part template:** plans and prices, pricing unit, billing, extra costs, free tier and trial, current offer.

**Every value has a source.** A value is shown only if the program finds its quoted text on the source page; otherwise the cell reads "暂无公开信息" (no public information). The official site of each company has to be confirmed by search results, Google's knowledge panel, Wikidata or the site itself. Directory, download, review and news sites are never treated as official. If a vendor publishes no price on its own site, Capsight may use a third-party pricing page updated within the last 12 months, and always labels it as third-party with that date.

### How it works

Question → intent (find competitors / named competitors) → official site → collect pages → extract a value and its exact quote → code checks the quote is on the page → re-query a failed value at most twice → table + CSV.

The language model ([DeepSeek](https://www.deepseek.com/)) reads and proposes; code decides what is kept. Search uses Serper (Google) and Bocha (Chinese web), plus Wikidata and Jina Reader for pages that load prices with JavaScript.

### Evaluation

The test sets, results and the proof bar (thresholds dated before each test) are in [`eval/`](eval/).

| Test | Version | Result |
| --- | --- | --- |
| Batch A, 10 questions, 19 Oct 2026 | v1 | Official site correct for 17 of 31 companies |
| Batch B, same 10 questions, 25 Oct 2026 | v2.3 | Official site correct for 32 of 33; pricing template 3.95 of 6 slots filled per company |
| Batch C, 48 products in 8 SaaS scenarios, 25 Oct 2026 | v2.4 | Intent branch right in 64 of 64 questions; official site right in 68 of 72 look-ups, no look-alike sites |

Known gaps: pricing for several Chinese collaboration suites (e.g. 钉钉, 小鱼易连) is often not found, and some fixes in v2.4 and v2.5 are covered by unit tests but not yet re-run on real questions.

### Project layout

- `web/`: website front end (Vite + React + TypeScript).
- `server/`: API server (Node.js + TypeScript, no third-party dependencies): fetching, verification and accounts.
- `eval/`: test sets, batch results, proof bar and design notes.

### Quick start

Requires Node.js 22.18 or later.

```bash
# Put your API keys in server/keys.env first (see server/README.md), then:
cd server && npm run dev                        # API at http://localhost:8787
cd web && npm install && npm run dev            # website at http://localhost:5173 (/api is proxied to the server)

# Share with friends for testing: one command creates a public link (needs: brew install cloudflared)
bash share.sh

# Offline demo with built-in sample data
cd web && VITE_API_BASE=demo npm run dev

# Run the automated tests
cd server && npm test
```

Deployment and the list of API keys are in `server/README.md`.

### Credits

Designed by LI YISHA (yisa): product positioning, workflow, intent branches, pricing template, front-end design and interaction, brand, test sets and evaluation. Code written with AI assistance to that design. Built as a course project for MSI5002, National University of Singapore.

---

### 中文

免费的 AI 调研助手：一句话提问 → 多源抓取（官网 / 相关网页 / SEO / 新闻 / 社媒）→ 事实校验 → AI 自检重查 → 字段整理 → 导出 CSV。

定位：**SaaS 竞品调研**（这一版先把它跑通，其他调研场景以后再做）。
- 不知道竞品：描述你的产品，列出竞品清单和公司介绍。
- 知道竞品：点名就查公司介绍、地区、功能、定价（6 栏模板：套餐与单价 / 计价单位 / 计费方式 / 附加成本 / 免费策略 / 当前优惠）、社媒和最新动态。
- 每条信息都要能在原网页里找到引用，否则写「暂无公开信息」；官网读不到价格时才用 12 个月内的第三方定价页，并标注出来。

### 目录

- `web/`：网站前端（Vite + React + TypeScript）。
- `server/`：后端 API（Node.js + TypeScript，无第三方依赖），负责真实抓取、校验和账号。
- `eval/`：测试集、每轮测试结果、证明标准和设计记录。

### 快速开始

```bash
# 先在 server/keys.env 填好 Key，然后：
cd server && npm run dev                        # 后端 http://localhost:8787
cd web && npm install && npm run dev            # 前端 http://localhost:5173（/api 自动转发到后端）

# 给同学用：一条命令，生成公网链接（需要 brew install cloudflared）
bash share.sh

# 只想看离线演示（内置示例数据）
cd web && VITE_API_BASE=demo npm run dev
```

部署和 Key 清单见 `server/README.md`。

---

© 2026 yisa. All rights reserved.
