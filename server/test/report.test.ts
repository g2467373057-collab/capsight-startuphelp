import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { MockLlm, type LlmRequest } from '../src/llm/llm.ts'
import { competitorSections, MISSING_NOTE, runReport, writeRagSection, writeSummary } from '../src/pipeline/report.ts'
import { HttpRag, jpsFromPrefix, NoRag, normalisePassages, parseRegister, type Rag } from '../src/rag/rag.ts'
import type { Passage, Row, RunEvent } from '../src/types.ts'
import { freshDb, mockSearch, testConfig, testProviders } from './helpers.ts'

const idea = { idea: 'x', product: 'SME recruitment platform', customer: 'SMEs', sector: 'HR tech', geography: 'Singapore', questions: { jp1: ['q'], jp2: ['q'], jp3: ['q'] } }
const P: Passage[] = [
  { id: 'a#1', title: 'PDPA overview', issuer: 'PDPC', date: '2021-02-01', url: 'https://www.pdpc.gov.sg/overview', text: 'Organisations must obtain consent before collecting, using or disclosing personal data for a purpose.' },
  { id: 'b#1', title: 'Old note', url: 'https://example.gov.sg/note', text: 'Employers should keep employee records for two years after the employee leaves.' },
]

test('RAG section keeps only claims whose quote is really in the passage', async () => {
  const llm = new MockLlm(() => ({
    claims: [
      { text: 'Consent is required before collecting personal data.', passage: 'P1', quote: 'must obtain consent before collecting, using or disclosing personal data' },
      { text: 'Fines are up to S$1 million.', passage: 'P1', quote: 'financial penalty of up to S$1 million' }, // not in the passage
      { text: 'You should launch now.', passage: 'P2', quote: 'keep employee records for two years' }, // verdict wording
      { text: 'Bad ref', passage: 'P9', quote: 'must obtain consent before collecting' },
    ],
  }))
  const { section, proposed } = await writeRagSection(llm, 'en', 'jp2', idea, P, true)
  assert.equal(proposed, 4)
  assert.equal(section.claims.length, 1)
  assert.equal(section.status, 'enough')
  assert.equal(section.claims[0].issuer, 'PDPC')
  assert.equal(section.claims[0].sources[0].url, 'https://www.pdpc.gov.sg/overview')
})

test('JP2 without a dated source is partial; no passages is missing with the agreed wording', async () => {
  const llm = new MockLlm(() => ({ claims: [{ text: 'Records are kept two years.', passage: 'P1', quote: 'keep employee records for two years after the employee leaves' }] }))
  const undated = await writeRagSection(llm, 'en', 'jp2', idea, [P[1]], true)
  assert.equal(undated.section.status, 'partial')
  assert.equal(undated.section.note, MISSING_NOTE.en.jp2Undated)
  const none = await writeRagSection(llm, 'zh', 'jp3', idea, [], true)
  assert.deepEqual([none.section.status, none.section.note], ['missing', '未找到相关补贴'])
  const off = await writeRagSection(llm, 'en', 'jp1', idea, [], false)
  assert.equal(off.section.note, 'No data found for this market segment (knowledge base not connected)')
})

const row = (name: string, domain: string, pricing?: { value: string; thirdParty?: boolean }): Row => ({
  competitor: name,
  domain,
  ...(domain ? { siteMethod: 'google_kg' as const } : {}),
  cells: {
    overview: { value: `${name} does hiring`, sources: [{ kind: 'site', url: `https://${domain}/about`, title: name }], status: 'verified' },
    pricing: pricing ? { value: pricing.value, sources: [{ kind: 'site', url: `https://${domain}/pricing`, title: 'Pricing' }], status: 'verified', thirdParty: pricing.thirdParty } : { value: '暂无公开信息', sources: [], status: 'missing' },
  },
})

test('JP4/JP5 apply the at-least-3-from-official-sites bar', () => {
  const [jp4, jp5] = competitorSections('en', [row('A', 'a.com', { value: '$10/user' }), row('B', 'b.com', { value: '$12', thirdParty: true }), row('C', '')])
  assert.deepEqual([jp4.status, jp4.note], ['partial', 'Only 2 found; list may be incomplete'])
  assert.equal(jp4.claims.length, 2)
  assert.equal(jp5.status, 'partial')
  assert.match(jp5.claims[1].text, /third-party/)
  const [full4, full5] = competitorSections('en', [row('A', 'a.com', { value: '1' }), row('B', 'b.com', { value: '2' }), row('C', 'c.com', { value: '3' })])
  assert.deepEqual([full4.status, full5.status, full5.note], ['enough', 'enough', undefined])
  const [, none5] = competitorSections('zh', [row('A', 'a.com')])
  assert.deepEqual([none5.status, none5.note], ['missing', '价格未公开'])
})

test('summary drops uncited items and anything that reads as a verdict; always lists what the founder must validate', async () => {
  const sections = competitorSections('en', [row('A', 'a.com', { value: '$10' })])
  const llm = new MockLlm(() => ({
    favorable: [{ text: 'Few competitors publish prices.', claims: ['C2'] }, { text: 'Huge market.', claims: [] }],
    risks: [{ text: 'We recommend you invest now.', claims: ['C1'] }, { text: 'Only one competitor verified.', claims: ['C1'] }],
    validate: ['Check hiring volumes of target SMEs', 'You should not build this'],
  }))
  const s = await writeSummary(llm, 'en', idea, sections)
  assert.deepEqual(s.favorable, ['Few competitors publish prices. [JP5]'])
  assert.deepEqual(s.risks, ['Only one competitor verified. [JP4]'])
  assert.equal(s.validate.length, 3)
  assert.match(s.validate[0], /pain/)
  assert.match(s.validate[2], /hiring volumes/)
  assert.equal(s.gaps.length, 2)
})

test('passages from the RAG service are cleaned; unusable ones dropped', () => {
  const out = normalisePassages({ passages: [{ text: 'T', title: 'X', url: 'https://a.gov.sg', issuer: 'IMDA', date: '2024-05-01', chunk_id: 'c1' }, { text: 'no link', title: 'Y', url: 'ftp://x' }, { text: 'bad date', title: 'Z', url: 'https://b.sg', date: 'May 2024' }] }, 5)
  assert.equal(out.length, 2)
  assert.deepEqual([out[0].id, out[0].issuer, out[0].date], ['c1', 'IMDA', '2024-05-01'])
  assert.equal(out[1].date, undefined)
})

test('HttpRag speaks the rag-service API: query, JP file filter from the register, results joined to the register', async () => {
  const bodies: Record<string, unknown>[] = []
  let auth = ''
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      bodies.push(raw ? JSON.parse(raw) : {})
      auth = String(req.headers.authorization ?? '')
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          query: 'grants',
          total_results: 2,
          results: [
            { text: 'Grant covers **50%** of costs', score: 0.8, source: { file_name: 'S05_Productivity_Solutions_Grant_PSG.pdf', file_path: 'S05_Productivity_Solutions_Grant_PSG.pdf', file_type: 'pdf', page: 3, chunk_index: 1 } },
            { text: 'Rejected doc text', score: 0.7, source: { file_name: 'S99_Old.pdf', file_path: 'S99_Old.pdf', file_type: 'pdf', page: 1, chunk_index: 1 } },
          ],
          source_documents: ['S05_Productivity_Solutions_Grant_PSG.pdf'],
        }),
      )
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const register = parseRegister(
      'file_name,doc_id,title,issuer,date,url,jp,admitted\nS05_Productivity_Solutions_Grant_PSG.pdf,S05,Productivity Solutions Grant,Enterprise Singapore,2025-04-01,https://www.gobusiness.gov.sg/psg,JP3,yes\nS99_Old.pdf,S99,Old,EnterpriseSG,2019,https://x.gov.sg,JP3,no\nD01_PDPA.pdf,D01,PDPA,PDPC,2012,https://sso.agc.gov.sg/Act/PDPA2012,JP2,yes\n',
    )
    const rag = new HttpRag({ url, apiKey: 'k', timeoutMs: 3000, topK: 5, register: '' }, register)
    const out = await rag.retrieve({ question: 'grants', jp: 'jp3', geography: 'Singapore', sector: 'HR', topK: 3 })
    assert.equal(out.length, 1)
    assert.deepEqual([out[0].issuer, out[0].date, out[0].page, out[0].url], ['Enterprise Singapore', '2025-04-01', 3, 'https://www.gobusiness.gov.sg/psg'])
    assert.deepEqual([bodies[0].query, bodies[0].top_k, bodies[0].source_files, auth], ['grants', 3, ['S05_Productivity_Solutions_Grant_PSG.pdf', 'S99_Old.pdf'].filter((f) => f !== 'S99_Old.pdf'), 'Bearer k'])
  } finally {
    server.close()
  }
})

test('without a register: file-name prefix decides the judgment point, links point at the RAG service', () => {
  assert.deepEqual([jpsFromPrefix('I01_Digital_Economy.pdf'), jpsFromPrefix('S04_EDG.pdf'), jpsFromPrefix('D01_PDPA.pdf')], [['jp1'], ['jp3'], ['jp2']])
  const out = normalisePassages({ results: [{ text: 'Text', score: 0.5, source: { file_name: 'D01_Personal_Data_Protection_Act_2012.pdf', page: 12, chunk_index: 2 } }] }, 5, new Map(), 'http://localhost:8000')
  assert.equal(out[0].title, 'Personal Data Protection Act 2012')
  assert.equal(out[0].url, 'http://localhost:8000/files/D01_Personal_Data_Protection_Act_2012.pdf#page=12')
  assert.equal(out[0].date, undefined)
})

test('quotes still match when the PDF text carries Markdown marks', async () => {
  const md: Passage = { id: 'x', title: 'PSG', url: 'https://www.gobusiness.gov.sg/psg', date: '2025-04-01', text: 'The grant supports **up to 50%** of qualifying costs for _pre-scoped_ solutions.' }
  const llm = new MockLlm(() => ({ claims: [{ text: 'PSG covers up to half of costs.', passage: 'P1', quote: 'supports up to 50% of qualifying costs for pre-scoped solutions' }] }))
  const { section } = await writeRagSection(llm, 'en', 'jp3', idea, [md], true)
  assert.equal(section.claims.length, 1)
})

test('full report without a knowledge base or competitors: every gap is stated, nothing invented', async () => {
  const cfg = testConfig()
  const db = freshDb()
  const p = testProviders(cfg, db, (r: LlmRequest) => (r.task === 'report_idea' ? { product: 'SME hiring app', customer: 'SMEs', sector: 'HR', geography: 'Singapore' } : r.task === 'intent' ? { type: 'own', competitors: [], product: 'SME hiring app', discover: 'competitors' } : {}), mockSearch(() => []))
  const events: RunEvent[] = []
  const res = await runReport('run_r', 'I want to build a subscription recruitment platform for Singapore SMEs', {
    llm: p.llm('en'), search: p.search('en'), fetcher: p.fetcher, social: p.social, lang: 'en', maxRequery: 1, emit: (e) => events.push(e), rag: new NoRag(), topK: 5, maxCompetitors: 4,
  })
  assert.equal(res.kind, 'report')
  assert.equal(res.ragConnected, false)
  assert.deepEqual(res.sections.map((s) => s.status), ['missing', 'missing', 'missing', 'missing', 'missing'])
  assert.equal(res.sections[3].note, 'Only 0 found; list may be incomplete')
  assert.equal(res.summary.favorable.length + res.summary.risks.length, 0)
  assert.equal(res.summary.gaps.length, 5)
  assert.ok(events.some((e) => /not connected/.test(e.text)))
})

test('full report with RAG passages fills JP1–JP3', async () => {
  const cfg = testConfig()
  const db = freshDb()
  const rag: Rag = { connected: true, retrieve: async (q) => (q.jp === 'jp3' ? [] : [P[0]]) }
  const p = testProviders(cfg, db, (r: LlmRequest) => {
    if (r.task === 'report_jp1' || r.task === 'report_jp2') return { claims: [{ text: 'Consent needed.', passage: 'P1', quote: 'obtain consent before collecting' }] }
    if (r.task === 'intent') return { type: 'own', competitors: [] }
    return {}
  }, mockSearch(() => []))
  const res = await runReport('run_r2', 'An HR SaaS for Singapore SMEs to manage hiring', {
    llm: p.llm('en'), search: p.search('en'), fetcher: p.fetcher, social: p.social, lang: 'en', maxRequery: 1, emit: () => {}, rag, topK: 5, maxCompetitors: 4,
  })
  assert.deepEqual(res.sections.slice(0, 3).map((s) => s.status), ['enough', 'enough', 'missing'])
  assert.equal(res.idea.geography, 'Singapore')
})

test('narrative: bad citations removed, sentences with unsupported numbers dropped, verdicts dropped', async () => {
  const { checkParagraph, writeNarrative, competitorSections: cs } = await import('../src/pipeline/report.ts')
  const allowed = new Set(['3', '79'])
  assert.equal(checkParagraph('Three firms compete [1]. Prices start at S$79 [2][9]. The market is worth S$500 million [1].', 2, allowed), 'Three firms compete [1]. Prices start at S$79 [2].')
  assert.equal(checkParagraph('竞品有 3 家[1]。你应该投入这个市场。', 1, allowed), '竞品有 3 家[1]。')
  const sections = cs('en', [row('A', 'a.com', { value: '$10/user' }), row('B', 'b.com', { value: '$12/user' }), row('C', 'c.com')])
  const llm = new MockLlm((r: LlmRequest) => {
    assert.match(r.user, /\[1\]/)
    return { sections: { jp4: 'Three products already serve this market: A [1], B [3] and C [5]. A charges $10 per user [2][42].', jp5: 'A charges $10 [2] and B $12 [4].' }, conclusion: 'A crowded market with room at the low end. You should invest now. The key risk is price competition [2].' }
  })
  const n = await writeNarrative(llm, 'en', { ...idea, idea: 'SME hiring app' }, [{ jp: 'jp1', status: 'missing', claims: [], note: 'No data found for this market segment' }, ...sections])
  assert.equal(n.references.length, 5)
  assert.equal(n.sections[0].text, 'No data found for this market segment.')
  assert.equal(n.sections[1].text, 'Three products already serve this market: A [1], B [3] and C [5]. A charges $10 per user [2].')
  assert.equal(n.conclusion, 'A crowded market with room at the low end. The key risk is price competition [2].')
})

test('asking the knowledge base: only quote-matched claims answer; nothing found says so', async () => {
  const { askKnowledgeBase } = await import('../src/pipeline/ask.ts')
  const rag: Rag = { connected: true, retrieve: async () => [{ id: 'S10#p1', docId: 'S10', page: 1, title: 'EDGE Grant', url: 'https://www.enterprisesg.gov.sg/financial-support/edge-grant', text: 'The EDGE grant opens for applications from 30 September 2026 and supports **projects** that build capabilities.' }] }
  const llm = new MockLlm(() => ({ claims: [{ text: 'EDGE opens on 30 September 2026.', passage: 'P1', quote: 'opens for applications from 30 September 2026' }, { text: 'It funds 90% of costs.', passage: 'P1', quote: 'funds up to 90% of qualifying costs' }] }))
  const r = await askKnowledgeBase(llm, rag, 'When does EDGE open?')
  assert.equal(r.claims.length, 1)
  assert.equal(r.proposed, 2)
  assert.equal(r.answer, 'EDGE opens on 30 September 2026 [1].')
  assert.equal(r.claims[0].docId, 'S10')
  const none = await askKnowledgeBase(llm, new NoRag(), 'Anything?')
  assert.match(none.answer, /does not hold enough evidence/)
})

test('register from the KM audit: JP01-style tags, ceased schemes labelled, rejected docs excluded', () => {
  const reg = parseRegister('file_name,doc_id,title,issuer,date,url,jp,admitted,status\nS04_EDG.pdf,S04,Enterprise Development Grant,EnterpriseSG,2026-09-29,https://www.enterprisesg.gov.sg/edg,JP03,yes,Ceased 29 Sep 2026\nI07_MTI.pdf,I07,Economic Survey,MTI,2026-02-10,https://www.mti.gov.sg,JP01,no,\n')
  assert.deepEqual(reg.get('S04_EDG.pdf')!.jps, ['jp3'])
  assert.equal(reg.get('S04_EDG.pdf')!.title, 'Enterprise Development Grant (Ceased 29 Sep 2026)')
  assert.equal(reg.get('I07_MTI.pdf')!.admitted, false)
  const out = normalisePassages({ results: [{ text: 'x', source: { file_name: 'I07_MTI.pdf', page: 2 } }] }, 5, reg, 'http://localhost:8000')
  assert.equal(out.length, 0)
})

test('a model outage stops the report instead of reporting "no data found"', async () => {
  const cfg = testConfig()
  const db = freshDb()
  const p = testProviders(cfg, db, () => {
    throw new Error('llm_http_402: {"error":{"message":"Insufficient Balance"}}')
  }, mockSearch(() => []))
  await assert.rejects(
    runReport('run_x', 'An HR SaaS for Singapore SMEs to manage hiring', { llm: p.llm('en'), search: p.search('en'), fetcher: p.fetcher, social: p.social, lang: 'en', maxRequery: 1, emit: () => {}, rag: new NoRag(), topK: 5, maxCompetitors: 4 }),
    /llm_http_402/,
  )
  const { askKnowledgeBase } = await import('../src/pipeline/ask.ts')
  const rag: Rag = { connected: true, retrieve: async () => [P[0]] }
  await assert.rejects(askKnowledgeBase(p.llm('en'), rag, 'q?'), /llm_http_402/)
})

test('unreadable model output marks the section as failed analysis, not as missing data', async () => {
  const llm = new MockLlm(() => {
    throw new Error('not json')
  })
  const { section } = await writeRagSection(llm, 'en', 'jp2', idea, P, true)
  assert.match(section.note!, /Analysis failed/)
})

test('a knowledge base that cannot be reached stops the report instead of reporting "no data found"', async () => {
  const cfg = testConfig()
  const db = freshDb()
  const p = testProviders(cfg, db, () => ({}), mockSearch(() => []))
  const rag: Rag = { connected: true, retrieve: async () => { throw new TypeError('fetch failed') } }
  await assert.rejects(
    runReport('run_y', 'An HR SaaS for Singapore SMEs to manage hiring', { llm: p.llm('en'), search: p.search('en'), fetcher: p.fetcher, social: p.social, lang: 'en', maxRequery: 1, emit: () => {}, rag, topK: 5, maxCompetitors: 4 }),
    /rag_unreachable/,
  )
})
