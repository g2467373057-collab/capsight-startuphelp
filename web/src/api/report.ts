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
  const out: string[] = []
  out.push(`# ${zh ? '创业市场报告' : 'Founder market report'}: ${r.idea.product}`)
  out.push('')
  out.push(`> ${zh ? '本报告只列出证据，不给出投或不投的结论。决定由创业者做出。' : 'This report presents evidence only. It gives no go / no-go verdict; the founder decides.'}`)
  out.push('')
  out.push(`- ${zh ? '想法' : 'Idea'}: ${r.idea.idea}`)
  out.push(`- ${zh ? '目标客户' : 'Customer'}: ${r.idea.customer || '—'} · ${zh ? '市场' : 'Market'}: ${r.idea.geography}`)
  out.push(`- ${zh ? '生成时间' : 'Generated'}: ${r.finishedAt.slice(0, 16).replace('T', ' ')} UTC · run ${r.runId}`)
  for (const s of r.sections) {
    out.push('', `## ${s.jp.toUpperCase()} ${JP_LABEL[lang][s.jp]} (${JP_SOURCE[s.jp]})`, '', `**${statusText(lang, s.status)}**${s.note ? `: ${s.note}` : ''}`, '')
    for (const c of s.claims) {
      const meta = [c.issuer, c.date].filter(Boolean).join(', ')
      out.push(`- ${c.text}${meta ? ` (${meta})` : ''} ${c.sources.map((x) => `[${x.title || x.url}](${x.url})`).join(' ')}`)
      if (c.quote) out.push(`  - ${zh ? '原文' : 'Source text'}: "${c.quote}"`)
    }
  }
  const list = (h: string, items: string[]) => {
    out.push('', `### ${h}`, '')
    if (items.length) for (const i of items) out.push(`- ${i}`)
    else out.push(`- ${zh ? '无' : 'None'}`)
  }
  out.push('', `## ${zh ? '总结' : 'Summary'}`)
  list(zh ? '有利信号' : 'Favorable signals', r.summary.favorable)
  list(zh ? '风险' : 'Risks', r.summary.risks)
  list(zh ? '证据缺口' : 'Evidence gaps', r.summary.gaps)
  list(zh ? '需要你自己验证' : 'What you must validate yourself', r.summary.validate)
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
