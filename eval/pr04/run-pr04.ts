/**
 * PR04 test runner (test sets designed by Sasitheran; knowledge base by Yvonne and Xu Zihan).
 *
 *   rag50    – asks the 50 RAG questions straight to the knowledge base (retrieve → quote-checked answer).
 *              Auto-measured: did retrieval return the expected source document (hit@k), and did the
 *              verified answer cite it. Acceptable / Partial / Reject is scored by a person afterwards.
 *   founder  – generates the founder market report for TC01–TC07 (fictional ideas; TC08–TC10 are real
 *              friends and must be run by the friend on the website).
 *
 * Usage (from the project folder, with the RAG service running):
 *   bash eval/pr04/run-pr04.sh rag50
 *   bash eval/pr04/run-pr04.sh founder [TC01 TC04 …]
 * Output: eval/pr04/runs/<kind>-<timestamp>/
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const [kind = 'rag50', ...only] = process.argv.slice(2)

const { loadDotEnv, loadConfig } = await import('../../server/src/config.ts')
loadDotEnv(join(here, '../../server/.env'))
loadDotEnv(join(here, '../../server/keys.env'))
const { openDb } = await import('../../server/src/db/db.ts')
const { createProviders } = await import('../../server/src/providers.ts')
const { askKnowledgeBase } = await import('../../server/src/pipeline/ask.ts')
const { runReport, JP_LABEL } = await import('../../server/src/pipeline/report.ts')

const cfg = loadConfig()
if (!cfg.rag.url) {
  console.error('RAG_URL is not set in server/keys.env (e.g. RAG_URL=http://localhost:8000). Start rag-service first.')
  process.exit(1)
}
const providers = createProviders(cfg, openDb(cfg.dbPath))
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = join(here, 'runs', `${kind}-${stamp}`)
mkdirSync(outDir, { recursive: true })
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
const csv = (head: string[], rows: unknown[][]) => '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
const code = (f: string) => f.split('_')[0]

// health check first: an empty knowledge base would make every answer "not found"
try {
  const h = (await (await fetch(`${cfg.rag.url}/health`)).json()) as { chunks_indexed?: number; files_in_data_dir?: number }
  console.log(`RAG service: ${h.files_in_data_dir} files, ${h.chunks_indexed} chunks indexed`)
  if (!h.chunks_indexed) throw new Error('knowledge base is empty: put the PDFs in rag-service/data and call POST /ingest')
} catch (e) {
  console.error(`RAG service not reachable at ${cfg.rag.url}: ${(e as Error).message}`)
  process.exit(1)
}

// pre-flight: one tiny model call, so an empty balance or a bad key stops the run before it produces fake "not found" answers
try {
  await providers.llm('en').json({ task: 'preflight', system: 'Reply with JSON {"ok":true}.', user: 'ping', maxTokens: 10 })
} catch (e) {
  console.error(`The language model call failed: ${(e as Error).message.slice(0, 200)}\nCheck the DeepSeek balance and key in server/keys.env, then run again.`)
  process.exit(1)
}

if (kind === 'rag50') {
  type Q = { id: string; topic: string; question: string; expected: string; expected_files: string[]; reference_answer: string; acceptable_rule: string; partial_rule: string; reject_rule: string }
  const all = JSON.parse(readFileSync(join(here, 'rag50-questions.json'), 'utf8')) as Q[]
  const qs = only.length ? all.filter((q) => only.includes(q.id)) : all
  const llm = providers.llm('en')
  const results: Record<string, unknown>[] = []
  console.log(`\nPR04 RAG test · ${qs.length} questions · top-${cfg.rag.topK + 1} · saving to eval/pr04/runs/${kind}-${stamp}\n`)
  for (const q of qs) {
    const t0 = Date.now()
    let r: Awaited<ReturnType<typeof askKnowledgeBase>> | undefined
    let error = ''
    try {
      r = await askKnowledgeBase(llm, providers.rag, q.question, cfg.rag.topK + 1)
    } catch (e) {
      error = (e as Error).message
    }
    const expected = q.expected_files.map(code)
    const retrievedCodes = [...new Set((r?.retrieved ?? []).map((x) => x.docId ?? ''))]
    const citedCodes = [...new Set((r?.claims ?? []).map((c) => c.docId ?? ''))]
    const hit = expected.some((e) => retrievedCodes.includes(e))
    const cited = expected.some((e) => citedCodes.includes(e))
    if (error) {
      console.error(`\n${q.id} failed: ${error.slice(0, 200)}\nStopping: a failed model call is not an answer. Fix the cause (balance, key, network) and run again.`)
      process.exit(1)
    }
    const pre = r ? await preScore(llm, q, r) : { score: 'Needs review', reason: 'no answer' }
    const sources = (r?.claims ?? []).map((c, i) => `[${i + 1}] ${c.docId ?? ''} ${c.title}${c.page ? `, p. ${c.page}` : ''}: "${c.quote}"`).join('\n')
    results.push({ id: q.id, topic: q.topic, question: q.question, answer: r?.answer ?? `ERROR: ${error}`, sources, expected_docs: expected.join(' '), retrieved_docs: retrievedCodes.join(' '), hit_at_k: hit, cited_expected: cited, verified_claims: r?.claims.length ?? 0, proposed_claims: r?.proposed ?? 0, ai_prescore: pre.score, ai_prescore_reason: pre.reason, seconds: Math.round((Date.now() - t0) / 1000), error, detail: r })
    console.log(`${q.id}  hit:${hit ? 'Y' : 'n'}  cited:${cited ? 'Y' : 'n'}  claims ${r?.claims.length ?? 0}/${r?.proposed ?? 0}  AI pre-score: ${pre.score}  ${error}`)
  }
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 1))
  writeFileSync(
    join(outDir, 'results.csv'),
    csv(['id', 'topic', 'question', 'answer', 'sources', 'expected_docs', 'retrieved_docs', 'hit_at_k', 'cited_expected', 'verified_claims', 'proposed_claims', 'ai_prescore_to_confirm', 'ai_prescore_reason', 'seconds'], results.map((r) => [r.id, r.topic, r.question, r.answer, r.sources, r.expected_docs, r.retrieved_docs, r.hit_at_k ? 'Y' : 'N', r.cited_expected ? 'Y' : 'N', r.verified_claims, r.proposed_claims, r.ai_prescore, r.ai_prescore_reason, r.seconds])),
  )
  const n = results.length
  const pct = (k: number) => `${k}/${n} (${Math.round((k / n) * 100)}%)`
  const lines = [
    `# PR04 RAG test · ${stamp}`,
    ``,
    `Tag: In-vitro (official documents, questions written by the team). n = ${n}. top-k = ${cfg.rag.topK + 1}. Model: ${cfg.llm.en.model}.`,
    ``,
    `| automatic measure | result |`,
    `|---|---|`,
    `| Retrieval returned an expected source document (hit@k) | ${pct(results.filter((r) => r.hit_at_k).length)} |`,
    `| Verified answer cites an expected source document | ${pct(results.filter((r) => r.cited_expected).length)} |`,
    `| Answered with ≥1 verified claim | ${pct(results.filter((r) => (r.verified_claims as number) > 0).length)} |`,
    `| Claims dropped by the quote gate | ${results.reduce((a, r) => a + (r.proposed_claims as number) - (r.verified_claims as number), 0)} of ${results.reduce((a, r) => a + (r.proposed_claims as number), 0)} proposed |`,
    ``,
    `| AI pre-score (NOT the result; a person confirms every row) | Acceptable ${results.filter((r) => r.ai_prescore === 'Acceptable').length} · Partial ${results.filter((r) => r.ai_prescore === 'Partial').length} · Reject ${results.filter((r) => r.ai_prescore === 'Reject').length} |`,
    ``,
    `Not yet measured: answer correctness (Acceptable / Partial / Reject) — scored by a person in PR04_50_RAG_Question_Bank (filled copy in this folder). F1 needs ≥85% correct and 0 fabricated sources.`,
  ]
  writeFileSync(join(outDir, 'summary.md'), lines.join('\n') + '\n')
  console.log('\n' + lines.join('\n'))
} else if (kind === 'founder') {
  type TC = { id: string; title: string; prompt: string; friend: boolean }
  const all = (JSON.parse(readFileSync(join(here, 'founder-tests.json'), 'utf8')) as TC[]).filter((t) => !t.friend)
  const tcs = only.length ? all.filter((t) => only.includes(t.id)) : all
  console.log(`\nPR04 founder test · ${tcs.length} scenarios · saving to eval/pr04/runs/${kind}-${stamp}\n`)
  const index: unknown[][] = []
  for (const tc of tcs) {
    const t0 = Date.now()
    const lang = 'en' as const
    try {
      const r = await runReport(`${tc.id}_${stamp}`, tc.prompt, {
        llm: providers.llm(lang),
        search: providers.search(lang),
        fetcher: providers.fetcher,
        social: providers.social,
        lang,
        maxRequery: cfg.limits.maxRequery,
        emit: (e) => console.log(`  ${tc.id} · ${e.text}`),
        rag: providers.rag,
        topK: cfg.rag.topK,
        maxCompetitors: cfg.limits.maxCompetitors,
        forLang: (l) => ({ llm: providers.llm(l), search: providers.search(l) }),
      })
      const md = reportMd(r, tc)
      writeFileSync(join(outDir, `${tc.id}.md`), md)
      writeFileSync(join(outDir, `${tc.id}.json`), JSON.stringify(r, null, 1))
      const st = r.sections.map((s) => `${s.jp.toUpperCase()}:${s.status}`).join(' ')
      index.push([tc.id, tc.title, `${tc.id}.md`, st, r.narrative.references.length, Math.round((Date.now() - t0) / 1000)])
      console.log(`${tc.id} done · ${st}`)
    } catch (e) {
      index.push([tc.id, tc.title, '', `ERROR ${(e as Error).message}`, 0, 0])
      console.log(`${tc.id} failed: ${(e as Error).message}`)
    }
  }
  writeFileSync(join(outDir, 'index.csv'), csv(['id', 'title', 'report_file', 'section_status', 'references', 'seconds'], index))
} else {
  console.error('Usage: rag50 | founder')
  process.exit(1)
}
process.exit(0)

/**
 * AI pre-score: a second model call compares the answer with the team's reference answer and scoring rules.
 * It only suggests a score for the human scorer to confirm or overrule; it is never reported as the result.
 */
async function preScore(llm: ReturnType<typeof providers.llm>, q: { question: string; reference_answer: string; acceptable_rule: string; partial_rule: string; reject_rule: string }, r: { answer: string; claims: { quote: string; docId?: string; page?: number }[] }) {
  try {
    const out = await llm.json<{ score?: string; reason?: string }>({
      task: 'pr04_prescore',
      system: [
        'You pre-score one answer for a human test reviewer, who will confirm or overrule you.',
        'Compare the system answer with the reference answer and apply the scoring rules exactly as written.',
        'Acceptable: main facts right, important points covered, evidence supports it. Partial: some facts right but an important point or source support is missing. Reject: wrong, invented, misleading evidence, or misses the main point.',
        'An answer saying the knowledge base has no evidence is Reject unless the reference answer also says the documents do not cover it.',
        'Be strict. Output JSON only: {"score":"Acceptable|Partial|Reject","reason":"one sentence naming what is right or missing"}',
      ].join('\n'),
      user: `Question: ${q.question}\n\nReference answer: ${q.reference_answer}\nAcceptable if: ${q.acceptable_rule}\nPartial if: ${q.partial_rule}\nReject if: ${q.reject_rule}\n\nSystem answer: ${r.answer}\nQuotes it rests on: ${r.claims.map((c) => `${c.docId ?? ''} p.${c.page ?? '?'}: "${c.quote}"`).join(' | ') || '(none)'}`,
      maxTokens: 200,
    })
    const score = ['Acceptable', 'Partial', 'Reject'].find((x) => x.toLowerCase() === String(out.score ?? '').trim().toLowerCase())
    return score ? { score, reason: String(out.reason ?? '').replace(/\s+/g, ' ').slice(0, 300) } : { score: 'Needs review', reason: 'pre-score unreadable' }
  } catch {
    return { score: 'Needs review', reason: 'pre-score call failed' }
  }
}

function reportMd(r: Awaited<ReturnType<typeof runReport>>, tc: { id: string; title: string; prompt: string }) {
  const n = r.narrative
  const cite = (t: string) => t.replace(/\[(\d+(?:,\s*\d+)*)\]/g, (_, l: string) => l.split(/,\s*/).map((x) => `[^${x}]`).join(''))
  const out = [
    `# ${tc.id} · ${tc.title}: market research report`,
    ``,
    `> Test run, In-vitro (fictional founder idea). Generated ${r.finishedAt}. Evidence only; the founder decides.`,
    ``,
    `**Founder prompt:** ${tc.prompt}`,
    ``,
    `**Read as:** ${r.idea.product} · customer: ${r.idea.customer || '—'} · market: ${r.idea.geography}`,
    ``,
    `## Key takeaways`,
    ``,
    cite(n.conclusion),
  ]
  n.sections.forEach((s, i) => out.push('', `## ${i + 1}. ${s.heading}`, '', cite(s.text)))
  out.push('', `## What to validate next yourself`, '', ...r.summary.validate.map((v) => `- ${v}`))
  out.push('', `## Evidence check (for scoring)`, '', `| JP | question | status | note |`, `|---|---|---|---|`)
  for (const s of r.sections) out.push(`| ${s.jp.toUpperCase()} | ${JP_LABEL.en[s.jp]} | ${s.status} | ${s.note ?? ''} |`)
  if (n.references.length) {
    out.push('', `## References`, '')
    for (const ref of n.references) out.push(`[^${ref.n}]: [${ref.title}](${ref.url})${[ref.issuer, ref.date, ref.page ? `p. ${ref.page}` : ''].filter(Boolean).length ? ` · ${[ref.issuer, ref.date, ref.page ? `p. ${ref.page}` : ''].filter(Boolean).join(' · ')}` : ''}`)
  }
  return out.join('\n') + '\n'
}
