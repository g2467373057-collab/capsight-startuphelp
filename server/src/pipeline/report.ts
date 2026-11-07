import { UNTRUSTED_NOTE, type Llm } from '../llm/llm.ts'
import type { Rag } from '../rag/rag.ts'
import type { SearchStack } from '../sources/search.ts'
import {
  JP_IDS,
  RAG_JPS,
  type Claim,
  type EvidenceStatus,
  type FounderIdea,
  type JpId,
  type Lang,
  type Narrative,
  type Passage,
  type Reference,
  type ReportResult,
  type ReportSection,
  type ReportSummary,
  type Row,
  type RunEvent,
  type RunResult,
} from '../types.ts'
import { normaliseIntent, parseIntent } from './intent.ts'
import { runResearch, type RunDeps } from './run.ts'

/**
 * Founder market report.
 * A founder describes a SaaS idea → JP1–JP3 from the RAG knowledge base (market, regulation, grants)
 * and JP4–JP5 from the competitor pipeline (competitors, pricing) → a summary of signals, risks, gaps
 * and what the founder must validate. The report presents evidence only: it never gives a go / no-go verdict.
 */
export interface ReportDeps extends RunDeps {
  rag: Rag
  topK: number
  maxCompetitors: number
  /** Model and search for another language (the competitor search follows the target market, not the UI language). */
  forLang?: (lang: Lang) => { llm: Llm; search: SearchStack }
}

export const JP_LABEL: Record<Lang, Record<JpId, string>> = {
  zh: { jp1: '市场有多大、在增长吗', jp2: '有哪些政策法规要遵守', jp3: '有没有政府补贴或支持', jp4: '竞争对手有哪些', jp5: '别人怎么收费' },
  en: { jp1: 'How big is the market, and is it growing?', jp2: 'Which policies and regulations apply?', jp3: 'Any government grants or support?', jp4: 'Who are the competitors?', jp5: 'How do competitors charge?' },
}

/** Fixed wording when a judgment point's evidence bar is not met (agreed judgment-point table). */
export const MISSING_NOTE = {
  zh: {
    jp1: '未找到该细分市场数据',
    jp2: '未找到相关法规，请咨询专业人士',
    jp3: '未找到相关补贴',
    jp4: (n: number) => `仅找到 ${n} 家，可能不完整`,
    jp5: '价格未公开',
    jp5Partial: (n: number, m: number) => `仅 ${n} 家（共 ${m} 家）公开了官方价格，其余价格未公开`,
    jp2Undated: '来源未注明日期，请确认该法规仍然有效',
    failed: '这一部分分析失败（模型返回无法读取），不代表没有资料',
    ragOff: '（知识库尚未接入）',
  },
  en: {
    jp1: 'No data found for this market segment',
    jp2: 'No relevant regulation found; please consult a professional',
    jp3: 'No relevant grant found',
    jp4: (n: number) => `Only ${n} found; list may be incomplete`,
    jp5: 'Pricing not publicly available',
    jp5Partial: (n: number, m: number) => `Official prices found for only ${n} of ${m} competitors; the rest: pricing not publicly available`,
    jp2Undated: 'Source date not stated; check that the regulation is still in force',
    failed: 'Analysis failed for this section (unreadable model output); this is not a finding that no data exists',
    ragOff: ' (knowledge base not connected)',
  },
}

/** What every founder has to validate outside desk research. */
const ALWAYS_VALIDATE: Record<Lang, string[]> = {
  zh: ['目标客户是否真的有这个痛点（需要客户访谈）', '客户是否愿意按你的价格付费（需要客户或交易证据）'],
  en: ['Whether target customers really have this pain (needs customer interviews)', 'Whether customers will pay your price (needs customer or transaction evidence)'],
}

/** Wording that would turn the report into a decision. Such sentences are removed. */
const VERDICT = /\b((you|founders?|they) (should|must|need to)( not)? (invest|proceed|build|launch|go ahead|pursue|stop|pivot|abandon)|(we |i )?(strongly )?recommend( that)?( you)?( to)? (invest|proceed|build|launch|pursue|going|stop|pivot)|go\s*\/\s*no[- ]go|(not )?worth (investing|pursuing|building)|do not (invest|build|launch)|(persevere|pivot|stop)\s*(\/|or)\s*(pivot|stop))\b|建议(你)?(投资|投入|放弃|继续做|启动|不要)|(值得|不值得)(投入|投资|做)|应该(投入|投资|放弃)|可以放心(投入|投资)/i

const T = {
  zh: {
    understand: '理解你的创业想法',
    understood: (p: string, g: string) => `产品：${p} · 市场：${g}`,
    ragOff: '知识库尚未接入，JP1–JP3 将标为证据不足',
    rag: (jp: string, n: number) => `${jp} · 知识库返回 ${n} 段原文`,
    ragFail: (jp: string) => `${jp} · 知识库调用失败`,
    findComp: '寻找竞争对手',
    compFound: (n: number) => `找到 ${n} 家候选竞品，开始核实官网和定价`,
    compNone: '没有找到竞品',
    writing: (jp: string) => `整理 ${jp}`,
    kept: (jp: string, ok: number, all: number) => `${jp} · ${ok}/${all} 条结论与原文一致`,
    summary: '撰写报告和结论',
    done: '报告完成，做不做由你决定',
  },
  en: {
    understand: 'Reading your startup idea',
    understood: (p: string, g: string) => `Product: ${p} · Market: ${g}`,
    ragOff: 'Knowledge base not connected yet: JP1–JP3 will be marked as missing evidence',
    rag: (jp: string, n: number) => `${jp} · knowledge base returned ${n} passages`,
    ragFail: (jp: string) => `${jp} · knowledge base call failed`,
    findComp: 'Finding competitors',
    compFound: (n: number) => `Found ${n} candidate competitors; checking official sites and pricing`,
    compNone: 'No competitors found',
    writing: (jp: string) => `Writing ${jp}`,
    kept: (jp: string, ok: number, all: number) => `${jp} · ${ok}/${all} claims match their source text`,
    summary: 'Writing the report and conclusion',
    done: 'Report ready; the decision is yours',
  },
}

/**
 * A model or network failure (out of credit, bad key, timeout, service down) must stop the report:
 * otherwise every section would read "no data found", which is a false finding.
 */
export function isFatal(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e)
  return /^llm_http_|fetch failed|timeout|aborted|ECONN|ENOTFOUND/i.test(m) || (e instanceof Error && (e.name === 'TypeError' || e.name === 'AbortError' || e.name === 'TimeoutError'))
}

const oneLine = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
/** Lower-cased, whitespace- and quote-normalised text for "is this quote really in the source" checks. */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’“”"'`*_#|>]/g, '') // quotes and Markdown marks from PDF extraction
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/-\s+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()

interface IdeaPlan extends FounderIdea {
  questions: Record<'jp1' | 'jp2' | 'jp3', string[]>
}

/** Step 1: structure the idea and write the knowledge-base questions for JP1–JP3. */
export async function understandIdea(llm: Llm, idea: string, lang: Lang): Promise<IdeaPlan> {
  type Raw = { product?: unknown; customer?: unknown; sector?: unknown; geography?: unknown; questions?: Record<string, unknown> }
  let raw: Raw = {}
  try {
    raw = await llm.json<Raw>({
      task: 'report_idea',
      system: [
        'A founder describes a SaaS idea. Turn it into JSON. Use only the founder\'s words; never invent facts.',
        `product: 2–8 words naming what the product does, in ${lang === 'zh' ? 'Chinese' : 'English'} (e.g. "SME recruitment platform").`,
        'customer: who the target customers are, in the same language. sector: the industry, in the same language.',
        'geography: the target market country or city in English; "Singapore" if the founder does not say.',
        'questions: for each judgment point, 2 short English search questions for a knowledge base of official policy, regulatory and industry documents:',
        '- jp1: market size and growth of this segment in the geography',
        '- jp2: laws, regulations and licences that apply to this product (e.g. personal data, sector rules)',
        '- jp3: government grants, schemes or support available to this kind of company or its customers',
        'Output JSON only: {"product":"","customer":"","sector":"","geography":"","questions":{"jp1":["",""],"jp2":["",""],"jp3":["",""]}}',
      ].join('\n'),
      user: `Founder idea: ${idea}`,
      maxTokens: 600,
    })
  } catch (e) {
    if (isFatal(e)) throw e
    raw = {}
  }
  const product = oneLine(raw.product, 80) || oneLine(idea, 60)
  const geography = oneLine(raw.geography, 40) || 'Singapore'
  const sector = oneLine(raw.sector, 60) || product
  const fallback: IdeaPlan['questions'] = {
    jp1: [`${product} market size ${geography}`, `${sector} industry growth ${geography}`],
    jp2: [`regulations that apply to ${product} in ${geography}`, `personal data protection requirements for ${sector} ${geography}`],
    jp3: [`government grants for ${sector} companies ${geography}`, `${geography} schemes supporting adoption of ${product}`],
  }
  const questions = {} as IdeaPlan['questions']
  for (const jp of RAG_JPS as ('jp1' | 'jp2' | 'jp3')[]) {
    const q = Array.isArray(raw.questions?.[jp]) ? (raw.questions![jp] as unknown[]).map((x) => oneLine(x, 200)).filter(Boolean).slice(0, 3) : []
    questions[jp] = q.length ? q : fallback[jp]
  }
  return { idea: oneLine(idea, 1200), product, customer: oneLine(raw.customer, 80), sector, geography, questions }
}

/** JP1–JP3: claims written only from the retrieved passages, each with a verbatim quote that code checks. */
export async function writeRagSection(llm: Llm, lang: Lang, jp: JpId, idea: IdeaPlan, passages: Passage[], ragConnected: boolean): Promise<{ section: ReportSection; proposed: number }> {
  const notes = MISSING_NOTE[lang]
  const missing = (): ReportSection => ({ jp, status: 'missing', claims: [], note: (notes[jp as 'jp1' | 'jp2' | 'jp3'] as string) + (ragConnected ? '' : notes.ragOff) })
  if (!passages.length) return { section: missing(), proposed: 0 }
  type RawClaim = { text?: unknown; passage?: unknown; quote?: unknown }
  let raw: { claims?: RawClaim[] } = {}
  try {
    raw = await llm.json<{ claims?: RawClaim[] }>({
      task: `report_${jp}`,
      system: [
        `You write one section of a founder's market report: "${JP_LABEL.en[jp]}".`,
        'Use ONLY facts stated in the passages. Write up to 4 claims. Each claim: a short factual sentence, the passage id it comes from, and a quote copied word for word from that passage (8–40 words) that supports it.',
        'Include numbers, years, issuer names and effective dates when the passage gives them. If a passage is about another country or sector, do not use it.',
        'Never give advice or a verdict (no "you should", no recommendation to invest, build or stop). The founder decides.',
        `Write "text" in ${lang === 'zh' ? 'Chinese' : 'English'}; keep "quote" in the passage\'s original language.`,
        UNTRUSTED_NOTE,
        'Output JSON only: {"claims":[{"text":"","passage":"P1","quote":""}]}',
      ].join('\n'),
      user: `Idea: ${idea.product} for ${idea.customer || 'its customers'} in ${idea.geography}\n\nPassages:\n${passages.map((p, i) => `[P${i + 1}] ${p.title}${p.issuer ? ` · ${p.issuer}` : ''}${p.date ? ` · ${p.date}` : ''}${p.page ? ` · p. ${p.page}` : ''}\n${p.text}`).join('\n\n---\n\n')}`,
      maxTokens: 900,
    })
  } catch (e) {
    if (isFatal(e)) throw e
    // the model answered but not in a usable form: say the analysis failed, never "no data found"
    return { section: { jp, status: 'missing', claims: [], note: notes.failed }, proposed: 0 }
  }
  const proposed = Array.isArray(raw.claims) ? raw.claims : []
  const claims: Claim[] = []
  const used: Passage[] = []
  for (const c of proposed) {
    const m = /^P?(\d+)$/i.exec(oneLine(c?.passage, 6))
    const p = m ? passages[Number(m[1]) - 1] : undefined
    const text = oneLine(c?.text, 400)
    const quote = oneLine(c?.quote, 400)
    if (!p || !text || norm(quote).length < 12 || !norm(p.text).includes(norm(quote)) || VERDICT.test(text)) continue
    claims.push({ text, quote, sources: [{ kind: 'web', url: p.url, title: p.title }], ...(p.issuer ? { issuer: p.issuer } : {}), ...(p.date ? { date: p.date } : {}), ...(p.page ? { page: p.page } : {}) })
    used.push(p)
  }
  if (!claims.length) return { section: missing(), proposed: proposed.length }
  // JP2 needs the original government text WITH its date
  if (jp === 'jp2' && !used.some((p) => p.date)) return { section: { jp, status: 'partial', claims, note: notes.jp2Undated }, proposed: proposed.length }
  return { section: { jp, status: 'enough', claims }, proposed: proposed.length }
}

/** JP4–JP5 from the competitor table: counts against the agreed bars (≥3 from official sites). */
export function competitorSections(lang: Lang, rows: Row[]): ReportSection[] {
  const notes = MISSING_NOTE[lang]
  const official = rows.filter((r) => r.domain && r.siteMethod)
  const jp4Claims: Claim[] = official.map((r) => {
    const o = r.cells.overview
    const hasOverview = o && o.status !== 'missing'
    return {
      text: hasOverview ? `${r.competitor}: ${o.value}` : `${r.competitor} (${r.domain})`,
      sources: hasOverview && o.sources.length ? o.sources : [{ kind: 'site', url: `https://${r.domain}`, title: r.competitor }],
    }
  })
  const jp4: ReportSection =
    official.length >= 3 ? { jp: 'jp4', status: 'enough', claims: jp4Claims } : { jp: 'jp4', status: official.length ? 'partial' : 'missing', claims: jp4Claims, note: notes.jp4(official.length) }

  const priced = rows.filter((r) => r.cells.pricing && r.cells.pricing.status !== 'missing')
  const officialPriced = priced.filter((r) => !r.cells.pricing!.thirdParty)
  const jp5Claims: Claim[] = priced.map((r) => {
    const p = r.cells.pricing!
    return { text: `${r.competitor}: ${p.value}${p.thirdParty ? (lang === 'zh' ? '（第三方页面）' : ' (third-party page)') : ''}`, sources: p.sources, ...(p.date ? { date: p.date } : {}) }
  })
  const status: EvidenceStatus = officialPriced.length >= 3 ? 'enough' : priced.length ? 'partial' : 'missing'
  const jp5: ReportSection =
    status === 'enough'
      ? { jp: 'jp5', status, claims: jp5Claims }
      : { jp: 'jp5', status, claims: jp5Claims, note: priced.length ? notes.jp5Partial(officialPriced.length, rows.length) : notes.jp5 }
  return [jp4, jp5]
}

/** Summary: signals and risks must cite claims from the sections; nothing that reads as a decision is kept. */
export async function writeSummary(llm: Llm, lang: Lang, idea: IdeaPlan, sections: ReportSection[]): Promise<ReportSummary> {
  const numbered: { id: string; jp: JpId; text: string }[] = []
  for (const s of sections) for (const c of s.claims) numbered.push({ id: `C${numbered.length + 1}`, jp: s.jp, text: c.text })
  const gaps = sections.filter((s) => s.status !== 'enough').map((s) => `${s.jp.toUpperCase()} ${JP_LABEL[lang][s.jp]}: ${s.note ?? ''}`.trim())
  type Item = { text?: unknown; claims?: unknown }
  let raw: { favorable?: Item[]; risks?: Item[]; validate?: unknown[] } = {}
  if (numbered.length) {
    try {
      raw = await llm.json({
        task: 'report_summary',
        system: [
          'You summarise the evidence in a founder\'s market report. Use ONLY the numbered claims.',
          'favorable: up to 4 signals that work in the idea\'s favour. risks: up to 4 risks or obstacles. Each item is one short sentence and lists the claim ids it rests on.',
          'validate: up to 3 specific things the founder should check next themselves (beyond customer pain and willingness to pay, which are always listed).',
          'NEVER give a verdict or recommendation: no go / no-go, no "you should invest/build/stop", no persevere / pivot / stop. The founder makes the decision.',
          `Write in ${lang === 'zh' ? 'Chinese' : 'English'}.`,
          'Output JSON only: {"favorable":[{"text":"","claims":["C1"]}],"risks":[{"text":"","claims":["C2"]}],"validate":[""]}',
        ].join('\n'),
        user: `Idea: ${idea.product} for ${idea.customer || 'its customers'} in ${idea.geography}\n\nClaims:\n${numbered.map((c) => `[${c.id}] (${c.jp.toUpperCase()}) ${c.text}`).join('\n')}`,
        maxTokens: 800,
      })
    } catch (e) {
      if (isFatal(e)) throw e
      raw = {}
    }
  }
  const byId = new Map(numbered.map((c) => [c.id, c]))
  const cited = (items: Item[] | undefined) =>
    (Array.isArray(items) ? items : [])
      .map((it) => {
        const text = oneLine(it?.text, 300)
        const refs = (Array.isArray(it?.claims) ? it.claims : []).map((x) => oneLine(x, 6).toUpperCase()).filter((x) => byId.has(x))
        if (!text || !refs.length || VERDICT.test(text)) return ''
        const jps = [...new Set(refs.map((r) => byId.get(r)!.jp.toUpperCase()))]
        return `${text} [${jps.join(', ')}]`
      })
      .filter(Boolean)
      .slice(0, 4)
  const extra = (Array.isArray(raw.validate) ? raw.validate : []).map((v) => oneLine(v, 200)).filter((v) => v && !VERDICT.test(v)).slice(0, 3)
  return { favorable: cited(raw.favorable), risks: cited(raw.risks), gaps, validate: [...ALWAYS_VALIDATE[lang], ...extra] }
}

export const NARRATIVE_HEADING: Record<Lang, Record<JpId, string>> = {
  zh: { jp1: '市场规模与增长', jp2: '政策与法规', jp3: '政府补贴与支持', jp4: '竞争格局', jp5: '竞品定价' },
  en: { jp1: 'Market size and growth', jp2: 'Policy and regulation', jp3: 'Government grants and support', jp4: 'Competitive landscape', jp5: 'Competitor pricing' },
}

/** Numbers every source cited by the sections (one number per URL), in report order. */
export function numberReferences(sections: ReportSection[]): { refs: Reference[]; refOf: (url: string, page?: number) => number | undefined } {
  const refs: Reference[] = []
  const byUrl = new Map<string, number>()
  const key = (url: string, page?: number) => `${url}|${page ?? ''}`
  for (const s of sections)
    for (const c of s.claims)
      for (const src of c.sources) {
        const k = key(src.url, c.page)
        if (byUrl.has(k)) continue
        const n = refs.length + 1
        byUrl.set(k, n)
        refs.push({ n, title: src.title || src.url, url: src.url, kind: src.kind, ...(c.issuer ? { issuer: c.issuer } : {}), ...(c.date ? { date: c.date } : {}), ...(c.page ? { page: c.page } : {}) })
      }
  return { refs, refOf: (url, page) => byUrl.get(key(url, page)) }
}

const splitSentences = (t: string) => t.split(/(?<=[。！？；])|(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean)
const numbersIn = (t: string) => (t.replace(/\[\d+(?:\s*[,，]\s*\d+)*\]/g, ' ').match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ''))

/**
 * Keeps a written paragraph honest: citation marks must point at real references,
 * and a sentence that states a number found in no claim (or the idea) is dropped.
 */
export function checkParagraph(text: string, maxRef: number, allowedNumbers: Set<string>): string {
  const kept: string[] = []
  for (const sentence of splitSentences(oneLine(text, 3000))) {
    if (VERDICT.test(sentence)) continue
    if (numbersIn(sentence).some((n) => !allowedNumbers.has(n))) continue
    kept.push(
      sentence
        .replace(/\[(\d+(?:\s*[,，]\s*\d+)*)\]/g, (_, list: string) => {
          const ok = list.split(/[,，]/).map((x) => Number(x.trim())).filter((n) => n >= 1 && n <= maxRef)
          return ok.length ? `[${[...new Set(ok)].join(', ')}]` : ''
        })
        .replace(/\s+([。，,.])/g, '$1'),
    )
  }
  return kept.join(/[\u4e00-\u9fff]/.test(text) ? '' : ' ')
}

/** Paragraphs a person would read: the LLM writes from the verified claims only, citing [n]; code checks the result. */
export async function writeNarrative(llm: Llm, lang: Lang, idea: IdeaPlan, sections: ReportSection[]): Promise<Narrative> {
  const { refs, refOf } = numberReferences(sections)
  const cite = (c: Claim) => [...new Set(c.sources.map((x) => refOf(x.url, c.page)).filter(Boolean))].map((n) => `[${n}]`).join('')
  const allowed = new Set<string>([...numbersIn(idea.idea), ...numbersIn(idea.product), ...numbersIn(idea.customer)])
  for (const s of sections) for (const c of s.claims) for (const n of numbersIn(c.text)) allowed.add(n)
  for (const s of sections) if (s.note) for (const n of numbersIn(s.note)) allowed.add(n)
  for (const r of refs) if (r.date) for (const n of numbersIn(r.date)) allowed.add(n)
  // counts the report may state ("3 competitors")
  for (let i = 0; i <= 12; i++) allowed.add(String(i))

  const brief = sections
    .map((s) => `${s.jp.toUpperCase()} ${NARRATIVE_HEADING.en[s.jp]}\n${s.claims.length ? s.claims.map((c) => `- ${c.text} ${cite(c)}${c.date ? ` (dated ${c.date})` : ''}`).join('\n') : '- (no evidence found)'}${s.note ? `\nGap: ${s.note}` : ''}`)
    .join('\n\n')
  type Raw = { sections?: Record<string, unknown>; conclusion?: unknown }
  let raw: Raw = {}
  try {
    raw = await llm.json<Raw>({
      task: 'report_narrative',
      system: [
        `You write a founder's market report in ${lang === 'zh' ? 'Chinese' : 'English'}, as a clear analyst brief a person enjoys reading.`,
        'Use ONLY the facts in the evidence list. Do not add facts, numbers, company names or dates that are not there.',
        'For each judgment point write one paragraph of 2–5 sentences that explains what the evidence means for this idea. Put the reference marks exactly as given (e.g. [2] or [1][3]) right after the facts they support.',
        'Where there is no evidence, say so naturally in one sentence (e.g. "Public sources found so far do not give a size for this segment") and what that means; never write labels like "missing evidence".',
        'conclusion: 3–5 sentences. Give your overall reading of where the idea stands in the market: how crowded it is, how heavy the regulatory load is, what support exists, where the pricing room is, the biggest opportunity and the biggest risk, and what to validate first. You may give an overall assessment (e.g. "a crowded market with room at the low-price end"), but do NOT tell the founder to build, invest, launch or stop: the founder decides.',
        'Output JSON only: {"sections":{"jp1":"","jp2":"","jp3":"","jp4":"","jp5":""},"conclusion":""}',
      ].join('\n'),
      user: `Idea: ${idea.idea}\nProduct: ${idea.product} · Customer: ${idea.customer || '-'} · Market: ${idea.geography}\n\nEvidence:\n${brief}`,
      maxTokens: 1800,
    })
  } catch (e) {
    if (isFatal(e)) throw e
    raw = {}
  }
  const fallback = (s: ReportSection) =>
    s.claims.length ? s.claims.map((c) => `${c.text.replace(/[。.]$/, '')}${cite(c)}${lang === 'zh' ? '。' : '.'}`).join(lang === 'zh' ? '' : ' ') + (s.note ? `${lang === 'zh' ? '' : ' '}${s.note}${lang === 'zh' ? '。' : '.'}` : '') : `${s.note ?? ''}${lang === 'zh' ? '。' : '.'}`
  const out = sections.map((s) => {
    const written = checkParagraph(String(raw.sections?.[s.jp] ?? ''), refs.length, allowed)
    return { jp: s.jp, heading: NARRATIVE_HEADING[lang][s.jp], text: written || fallback(s) }
  })
  const conclusion = checkParagraph(String(raw.conclusion ?? ''), refs.length, allowed) || (lang === 'zh' ? '现有证据还不足以对市场形成整体判断，建议先补充上面列出的缺口。' : 'The evidence so far is not enough for an overall reading of the market; the gaps above come first.')
  return { sections: out, conclusion, references: refs }
}

/** Competitor search language follows the target market: Chinese web for mainland China, English otherwise. */
const marketLang = (geography: string, fallback: Lang): Lang => (/china|中国|大陆|mainland/i.test(geography) && !/hong kong|taiwan|香港|台湾/i.test(geography) ? 'zh' : geography ? 'en' : fallback)

export async function runReport(runId: string, ideaText: string, deps: ReportDeps): Promise<ReportResult> {
  const { lang, emit } = deps
  const t = T[lang]
  const step = (stage: RunEvent['stage'], kind: RunEvent['kind'], text: string) => emit({ stage, kind, text })

  // ---- 1. understand the idea
  step(2, 'info', t.understand)
  const idea = await understandIdea(deps.llm, ideaText, lang)
  step(2, 'ok', t.understood(idea.product, idea.geography))

  // ---- 2. JP1–JP3: knowledge base
  const passagesBy: Partial<Record<JpId, Passage[]>> = {}
  if (!deps.rag.connected) step(2, 'info', t.ragOff)
  else {
    let calls = 0
    let failures = 0
    for (const jp of RAG_JPS as ('jp1' | 'jp2' | 'jp3')[]) {
      const seen = new Set<string>()
      const list: Passage[] = []
      let failed = false
      for (const question of idea.questions[jp]) {
        try {
          for (const p of await deps.rag.retrieve({ question, jp, geography: idea.geography, sector: idea.sector, topK: deps.topK })) {
            const key = `${p.url}|${norm(p.text).slice(0, 80)}`
            if (!seen.has(key)) {
              seen.add(key)
              list.push(p)
            }
          }
        } catch {
          failed = true
          failures++
        }
        calls++
      }
      passagesBy[jp] = list.slice(0, deps.topK * 2)
      step(2, failed && !list.length ? 'fail' : list.length ? 'ok' : 'info', failed && !list.length ? t.ragFail(jp.toUpperCase()) : t.rag(jp.toUpperCase(), list.length))
    }
    // Every knowledge-base call failed: the service is not running. Stop rather than report "no data found".
    if (calls > 0 && failures === calls) throw new Error('rag_unreachable')
  }

  // ---- 3. JP4–JP5: competitor pipeline
  step(3, 'info', t.findComp)
  const cl = marketLang(idea.geography, lang)
  const other = cl !== lang && deps.forLang ? deps.forLang(cl) : { llm: deps.llm, search: deps.search }
  let competitors: RunResult | undefined
  try {
    const ask =
      cl === 'zh'
        ? `我们做${idea.product}${idea.customer ? `，面向${idea.customer}` : ''}，市场在${idea.geography}，帮我找竞品`
        : `We are building ${idea.product}${idea.customer ? ` for ${idea.customer}` : ''} in ${idea.geography}. Find our competitors`
    const found = await parseIntent(other.llm, other.search, ask, cl, deps.maxCompetitors)
    if (found.competitors.length) {
      step(3, 'ok', t.compFound(found.competitors.length))
      const intent = normaliseIntent({ type: 'named', competitors: found.competitors, dimensions: ['name', 'overview', 'region', 'features', 'pricing'], topic: found.topic ?? 'SaaS' }, ask, deps.maxCompetitors)
      competitors = await runResearch(`${runId}_c`, intent, { ...deps, llm: other.llm, search: other.search, lang: cl, emit: (e) => emit({ ...e, stage: 3 }) })
    } else step(3, 'info', t.compNone)
  } catch (e) {
    if (isFatal(e)) throw e
    step(3, 'fail', t.compNone)
  }

  // ---- 4. write and check each section
  const sections: ReportSection[] = []
  for (const jp of RAG_JPS) {
    step(4, 'info', t.writing(jp.toUpperCase()))
    const { section, proposed } = await writeRagSection(deps.llm, lang, jp, idea, passagesBy[jp] ?? [], deps.rag.connected)
    if (proposed) step(4, section.claims.length ? 'ok' : 'fail', t.kept(jp.toUpperCase(), section.claims.length, proposed))
    sections.push(section)
  }
  sections.push(...competitorSections(lang, competitors?.rows ?? []))

  // ---- 5. summary (no verdict)
  step(5, 'info', t.summary)
  const summary = await writeSummary(deps.llm, lang, idea, sections)
  const narrative = await writeNarrative(deps.llm, lang, idea, sections)
  step(5, 'ok', t.done)

  const { questions: _q, ...founder } = idea
  return {
    runId,
    kind: 'report',
    idea: founder,
    narrative,
    sections: JP_IDS.map((jp) => sections.find((s) => s.jp === jp)!),
    summary,
    ...(competitors ? { competitors } : {}),
    ragConnected: deps.rag.connected,
    finishedAt: new Date().toISOString(),
  }
}
