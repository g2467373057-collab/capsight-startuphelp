import { API_BASE, api, ApiError } from './http'
import type { JpId, Lang, ReportResult, Row, RunEvent, RunResult } from './types'

export const JP_LABEL: Record<Lang, Record<JpId, string>> = {
  zh: { jp1: '市场有多大、在增长吗', jp2: '有哪些政策法规要遵守', jp3: '有没有政府补贴或支持', jp4: '竞争对手有哪些', jp5: '别人怎么收费' },
  en: { jp1: 'How big is the market, and is it growing?', jp2: 'Which policies and regulations apply?', jp3: 'Any government grants or support?', jp4: 'Who are the competitors?', jp5: 'How do competitors charge?' },
}
export const JP_SOURCE: Record<JpId, 'RAG' | 'Capsight'> = { jp1: 'RAG', jp2: 'RAG', jp3: 'RAG', jp4: 'Capsight', jp5: 'Capsight' }

interface ReportOptions {
  lang: Lang
  onEvent?: (e: RunEvent) => void
}

/** Starts a founder market report and follows its progress (server-sent events). */
export async function runReport(idea: string, opts: ReportOptions): Promise<ReportResult> {
  if (!API_BASE) return demoReport(idea, opts)
  const { runId } = await api<{ runId: string }>('/reports', { body: { idea, lang: opts.lang } })
  return new Promise<ReportResult>((resolve, reject) => {
    const es = new EventSource(`${API_BASE}/runs/${runId}/events`, { withCredentials: true })
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      es.close()
      fn()
    }
    es.addEventListener('progress', (m) => opts.onEvent?.(JSON.parse((m as MessageEvent).data) as RunEvent))
    es.addEventListener('result', (m) => done(() => resolve(JSON.parse((m as MessageEvent).data) as ReportResult)))
    es.addEventListener('failed', () => done(() => reject(new ApiError('run_failed', 500))))
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) done(() => reject(new ApiError('network', 0)))
    }
  })
}

/** Offline demo (VITE_API_BASE=demo): shows the report layout with the knowledge base not connected. */
async function demoReport(idea: string, { lang, onEvent }: ReportOptions): Promise<ReportResult> {
  const zh = lang === 'zh'
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const steps: RunEvent[] = [
    { stage: 2, kind: 'ok', text: zh ? '产品：中小企业招聘平台 · 市场：Singapore' : 'Product: SME recruitment platform · Market: Singapore' },
    { stage: 2, kind: 'info', text: zh ? '知识库尚未接入，JP1–JP3 将标为证据不足' : 'Knowledge base not connected yet: JP1–JP3 will be marked as missing evidence' },
    { stage: 3, kind: 'ok', text: zh ? '找到 3 家候选竞品（演示数据）' : 'Found 3 candidate competitors (demo data)' },
    { stage: 5, kind: 'ok', text: zh ? '报告完成：只列证据，不替你做决定' : 'Report ready: evidence only, the decision is yours' },
  ]
  for (const e of steps) {
    await wait(500)
    onEvent?.(e)
  }
  const off = zh ? '（知识库尚未接入）' : ' (knowledge base not connected)'
  return {
    runId: `demo_${Date.now().toString(36)}`,
    kind: 'report',
    idea: { idea, product: zh ? '中小企业招聘平台（演示）' : 'SME recruitment platform (demo)', customer: 'SMEs', sector: 'HR tech', geography: 'Singapore' },
    ragConnected: false,
    narrative: {
      sections: zh
        ? [
            { jp: 'jp1', heading: '市场规模与增长', text: '目前接入的资料里还没有这个细分市场的规模或增长数据，所以市场有多大暂时无法用数字说明。' },
            { jp: 'jp2', heading: '政策与法规', text: '还没有检索到适用的法规原文。处理求职者个人资料的产品通常涉及数据保护要求，上线前最好请专业人士确认。' },
            { jp: 'jp3', heading: '政府补贴与支持', text: '暂时没有找到相关的政府补贴或支持计划。' },
            { jp: 'jp4', heading: '竞争格局', text: '市场上已经有面向中小企业的招聘软件[1]、求职招聘平台[2]和人力资源管理套件[3]，说明这个需求已经有人在做，并不是空白市场。' },
            { jp: 'jp5', heading: '竞品定价', text: '这几家竞品的官网都没有公开价格，暂时没法用价格做对比，可能需要以客户身份询价。' },
          ]
        : [
            { jp: 'jp1', heading: 'Market size and growth', text: 'The documents connected so far give no size or growth figures for this segment, so the size of the market cannot be stated in numbers yet.' },
            { jp: 'jp2', heading: 'Policy and regulation', text: 'No applicable regulation text has been retrieved yet. Products that handle applicants\' personal data usually face data protection rules, so a professional check before launch is wise.' },
            { jp: 'jp3', heading: 'Government grants and support', text: 'No relevant government grant or support scheme has been found yet.' },
            { jp: 'jp4', heading: 'Competitive landscape', text: 'Hiring software for SMEs [1], a job board [2] and an HR suite [3] already serve this market, so the need is real and the space is not empty.' },
            { jp: 'jp5', heading: 'Competitor pricing', text: 'None of these competitors publish prices on their sites, so a price comparison is not possible yet; asking for quotes as a customer may be needed.' },
          ],
      conclusion: zh
        ? '这是一个已经有人在做的市场[1][2][3]：需求存在，但你需要讲清楚和现有招聘平台、人力资源套件的区别。竞品价格不透明，既是比价的难点，也可能是用透明定价切入的机会。市场规模和法规要求还缺资料，是现在最大的不确定性。'
        : 'This is a market others already serve [1][2][3]: the need exists, but you will need a clear difference from current job boards and HR suites. Opaque competitor pricing makes comparison hard, and may also be an opening for transparent pricing. Market size and regulatory requirements are the biggest unknowns right now.',
      references: [
        { n: 1, title: 'Example A', url: 'https://example.com/about', kind: 'site' },
        { n: 2, title: 'Example B', url: 'https://example.org/about', kind: 'site' },
        { n: 3, title: 'Example C', url: 'https://example.net/about', kind: 'site' },
      ],
    },
    sections: [
      { jp: 'jp1', status: 'missing', claims: [], note: (zh ? '未找到该细分市场数据' : 'No data found for this market segment') + off },
      { jp: 'jp2', status: 'missing', claims: [], note: (zh ? '未找到相关法规，请咨询专业人士' : 'No relevant regulation found; please consult a professional') + off },
      { jp: 'jp3', status: 'missing', claims: [], note: (zh ? '未找到相关补贴' : 'No relevant grant found') + off },
      {
        jp: 'jp4',
        status: 'enough',
        claims: [
          { text: zh ? '示例公司 A：面向中小企业的招聘软件（演示数据）' : 'Example Co A: hiring software for SMEs (demo data)', sources: [{ kind: 'site', url: 'https://example.com', title: 'Example A' }] },
          { text: zh ? '示例公司 B：求职招聘平台（演示数据）' : 'Example Co B: job board (demo data)', sources: [{ kind: 'site', url: 'https://example.org', title: 'Example B' }] },
          { text: zh ? '示例公司 C：人力资源管理套件（演示数据）' : 'Example Co C: HR suite (demo data)', sources: [{ kind: 'site', url: 'https://example.net', title: 'Example C' }] },
        ],
      },
      { jp: 'jp5', status: 'missing', claims: [], note: zh ? '价格未公开' : 'Pricing not publicly available' },
    ],
    summary: {
      favorable: [],
      risks: [zh ? '演示数据：已找到 3 家竞品，市场并非空白 [JP4]' : 'Demo data: 3 competitors found, so the market is not empty [JP4]'],
      gaps: ['JP1', 'JP2', 'JP3', 'JP5'].map((j) => `${j}: ${zh ? '证据不足' : 'missing evidence'}`),
      validate: zh
        ? ['目标客户是否真的有这个痛点（需要客户访谈）', '客户是否愿意按你的价格付费（需要客户或交易证据）']
        : ['Whether target customers really have this pain (needs customer interviews)', 'Whether customers will pay your price (needs customer or transaction evidence)'],
    },
    competitors: demoCompetitors(zh),
    finishedAt: new Date().toISOString(),
  }
}

function demoCompetitors(zh: boolean): RunResult {
  const site = (d: string, path = '') => [{ kind: 'site' as const, url: `https://${d}${path}`, title: d }]
  const row = (name: string, d: string, region: string, overview: string, pricing?: string): Row => ({
    competitor: name,
    domain: d,
    siteMethod: 'given',
    cells: {
      name: { value: name, sources: site(d), status: 'verified' },
      region: { value: region, sources: site(d, '/about'), status: 'verified' },
      overview: { value: overview, sources: site(d, '/about'), status: 'verified' },
      pricing: pricing ? { value: pricing, sources: site(d, '/pricing'), status: 'verified' } : { value: zh ? '暂无公开信息' : 'No public information', sources: [], status: 'missing' },
    },
  })
  const rows = [
    row('Example A', 'example.com', 'Singapore', zh ? '面向中小企业的招聘软件（演示数据）' : 'Hiring software for SMEs (demo data)'),
    row('Example B', 'example.org', 'Singapore', zh ? '求职招聘平台（演示数据）' : 'Job board (demo data)'),
    row('Example C', 'example.net', 'Australia', zh ? '人力资源管理套件（演示数据）' : 'HR suite (demo data)'),
  ]
  return {
    runId: 'demo_c',
    intent: { type: 'named', query: 'demo', competitors: rows.map((r) => r.competitor), timeRange: 'all', dimensions: ['name', 'region', 'overview', 'pricing'] },
    rows,
    stats: { sources: 9, checked: 12, requeried: 0, passed: 9, dropped: 3 },
    finishedAt: new Date().toISOString(),
  }
}

const STATUS_TEXT: Record<Lang, Record<'enough' | 'partial' | 'missing', string>> = {
  zh: { enough: '证据充分', partial: '部分证据', missing: '证据不足' },
  en: { enough: 'Enough evidence', partial: 'Partial evidence', missing: 'Missing evidence' },
}
export const statusText = (lang: Lang, s: 'enough' | 'partial' | 'missing') => STATUS_TEXT[lang][s]

/** The report as Markdown, for sharing or pasting into the team's documents. */
export function reportMarkdown(r: ReportResult, lang: Lang): string {
  const zh = lang === 'zh'
  const n = r.narrative
  const cite = (t: string) => t.replace(/\[(\d+(?:,\s*\d+)*)\]/g, (_, l: string) => l.split(/,\s*/).map((x) => `[^${x}]`).join(''))
  const out: string[] = []
  out.push(`# ${r.idea.product}${zh ? '：市场调研报告' : ': market research report'}`, '')
  out.push(`*${zh ? '想法' : 'Idea'}: ${r.idea.idea}*`, '')
  out.push(`${zh ? '目标客户' : 'Customer'}: ${r.idea.customer || '—'} · ${zh ? '市场' : 'Market'}: ${r.idea.geography} · ${r.finishedAt.slice(0, 10)}`, '')
  out.push(`## ${zh ? '核心结论' : 'Key takeaways'}`, '', cite(n.conclusion), '', `> ${zh ? '这是对市场现状的分析，做不做由你决定。' : 'This reads the market as it stands; whether to build it is your call.'}`)
  n.sections.forEach((s, i) => out.push('', `## ${i + 1}. ${s.heading}`, '', cite(s.text)))
  if (r.summary.validate.length) {
    out.push('', `## ${zh ? '接下来建议你自己验证' : 'What to validate next yourself'}`, '')
    for (const v of r.summary.validate) out.push(`- ${v}`)
  }
  if (n.references.length) {
    out.push('', `## ${zh ? '参考来源' : 'References'}`, '')
    for (const ref of n.references) out.push(`[^${ref.n}]: [${ref.title}](${ref.url})${[ref.issuer, ref.date].filter(Boolean).length ? ` · ${[ref.issuer, ref.date].filter(Boolean).join(' · ')}` : ''}`)
  }
  return out.join('\n') + '\n'
}

export function downloadMarkdown(r: ReportResult, lang: Lang) {
  const blob = new Blob([reportMarkdown(r, lang)], { type: 'text/markdown;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `startup-report-${r.runId}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
