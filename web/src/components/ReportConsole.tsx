import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../api/http'
import { downloadMarkdown, JP_LABEL, JP_SOURCE, runReport, statusText } from '../api/report'
import type { Claim, Lang, ReportResult, RunEvent, Source } from '../api/types'
import { errorText } from '../data/content'
import { useLang } from '../i18n'
import { Icon } from './ui'

const COPY = {
  zh: {
    window: '创业市场报告',
    ask: '描述你的 SaaS 创业想法',
    placeholder: '例如：我想做一个面向新加坡中小企业的订阅制招聘平台，帮雇主发布职位、筛选简历、安排面试。目标客户是 10–100 人的公司。',
    start: '生成报告',
    running: '生成中…',
    tryOne: '试一试',
    examples: [
      '我想做一个面向新加坡中小企业的订阅制招聘平台，帮雇主发布职位、筛选简历、安排面试。',
      '我想为新加坡小型零售店做库存管理 SaaS，计划每月收费 S$79。',
    ],
    stages: ['', '理解想法 · 知识库', '竞品与定价', '整理判断点', '总结'],
    noVerdict: '本报告只列出证据，不给出投或不投的结论。决定由你来做。',
    idea: '想法',
    market: '市场',
    customer: '目标客户',
    source: '证据来源',
    sourceText: '原文',
    summary: '总结',
    favorable: '有利信号',
    risks: '风险',
    gaps: '证据缺口',
    validate: '需要你自己验证',
    none: '无',
    exportMd: '导出 Markdown',
    again: '新的想法',
    ragOff: '知识库尚未接入：JP1–JP3 暂时没有证据，接入后会自动使用。',
    tooShort: '请多写几句，至少说明产品做什么、卖给谁。',
  },
  en: {
    window: 'Founder market report',
    ask: 'Describe your SaaS startup idea',
    placeholder: 'e.g. I want to build a subscription recruitment platform for Singapore SMEs that helps employers post jobs, screen applicants and schedule interviews. Target customers have 10–100 employees.',
    start: 'Generate report',
    running: 'Generating…',
    tryOne: 'Try one',
    examples: [
      'I want to build a subscription recruitment platform for Singapore SMEs that helps employers post jobs, screen applicants and schedule interviews.',
      'I want to build an inventory management SaaS for small retail shops in Singapore, charging S$79 per month.',
    ],
    stages: ['', 'Idea · knowledge base', 'Competitors & pricing', 'Judgment points', 'Summary'],
    noVerdict: 'This report presents evidence only. It gives no go / no-go verdict: the decision is yours.',
    idea: 'Idea',
    market: 'Market',
    customer: 'Customer',
    source: 'Evidence from',
    sourceText: 'Source text',
    summary: 'Summary',
    favorable: 'Favorable signals',
    risks: 'Risks',
    gaps: 'Evidence gaps',
    validate: 'What you must validate yourself',
    none: 'None',
    exportMd: 'Export Markdown',
    again: 'New idea',
    ragOff: 'Knowledge base not connected yet: JP1–JP3 have no evidence for now and will use it once connected.',
    tooShort: 'Please write a bit more: at least what the product does and who it is for.',
  },
} satisfies Record<Lang, unknown>

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function Src({ s }: { s: Source }) {
  return (
    <a className={`src-pill src-pill--${s.kind}`} href={s.url} target="_blank" rel="noreferrer" title={`${s.title}\n${s.url}`}>
      <Icon name={s.kind === 'web' ? 'site' : s.kind} size={12} />
      {host(s.url)}
    </a>
  )
}

function ClaimItem({ c, label }: { c: Claim; label: string }) {
  const meta = [c.issuer, c.date].filter(Boolean).join(' · ')
  return (
    <li className="rep-claim">
      <span>{c.text}</span>
      <span className="rep-claim__meta">
        {meta && <span className="rep-claim__issuer">{meta}</span>}
        {c.sources.map((s) => (
          <Src key={s.url} s={s} />
        ))}
      </span>
      {c.quote && (
        <span className="rep-claim__quote">
          {label}: “{c.quote}”
        </span>
      )}
    </li>
  )
}

function List({ title, items, none, tone }: { title: string; items: string[]; none: string; tone: string }) {
  return (
    <div className={`rep-sum__box rep-sum__box--${tone}`}>
      <p className="pane__label">{title}</p>
      {items.length ? (
        <ul>
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : (
        <p className="rep-muted">{none}</p>
      )}
    </div>
  )
}

/** Founder idea → market report structured by the five judgment points, plus a summary with no verdict. */
export default function ReportConsole({ onDone }: { onDone?: (idea: string) => void }) {
  const { lang, t } = useLang()
  const s = COPY[lang]
  const [idea, setIdea] = useState('')
  const [phase, setPhase] = useState<'input' | 'running' | 'done'>('input')
  const [events, setEvents] = useState<RunEvent[]>([])
  const [result, setResult] = useState<ReportResult | null>(null)
  const [error, setError] = useState('')
  const logRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [events])

  const start = async (text: string) => {
    const q = text.replace(/\s+/g, ' ').trim()
    if (q.length < 10) {
      setError(s.tooShort)
      return
    }
    setIdea(q)
    setError('')
    setEvents([])
    setResult(null)
    setPhase('running')
    try {
      const r = await runReport(q, { lang, onEvent: (e) => setEvents((prev) => [...prev, e]) })
      setResult(r)
      setPhase('done')
      onDone?.(q)
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'idea_too_short' ? s.tooShort : errorText(t, e))
      setPhase('input')
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void start(idea)
  }

  return (
    <div className="glass console" id="report">
      <div className="console__bar">
        <span className="dots" aria-hidden>
          <span />
          <span />
          <span />
        </span>
        <span className="console__title">{s.window}</span>
      </div>
      <div className="console__body studio__body">
        <p className="rep-banner">{s.noVerdict}</p>

        {phase !== 'done' && (
          <div className="pane pane--ask">
            <label className="pane__label" htmlFor="report-idea">
              {s.ask}
            </label>
            <form className="rep-form" onSubmit={submit}>
              <textarea id="report-idea" rows={4} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder={s.placeholder} disabled={phase === 'running'} maxLength={1200} />
              <button className="btn btn--red" type="submit" disabled={phase === 'running' || !idea.trim()}>
                {phase === 'running' ? s.running : s.start}
              </button>
            </form>
            {phase === 'input' && (
              <div className="examples">
                <span className="mono-label">{s.tryOne}</span>
                {s.examples.map((ex) => (
                  <button key={ex} type="button" className="example" onClick={() => void start(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            )}
            {error && <p className="error">{error}</p>}
          </div>
        )}

        {events.length > 0 && phase === 'running' && (
          <div className="pane pane--live">
            {phase === 'running' && <div className="shimmer" aria-hidden />}
            <ol className="log" ref={logRef}>
              {events.map((e, i) => (
                <li key={i} className={`log__line log__line--${e.kind}`}>
                  <span className="log__stage">{s.stages[e.stage - 1] ?? ''}</span>
                  <span className="log__icon">{e.kind === 'ok' ? '✓' : e.kind === 'retry' ? '!' : e.kind === 'fail' ? '✕' : '·'}</span>
                  <span>{e.text}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {phase === 'done' && result && (
          <div className="pane pane--result rep">
            <div className="rep-head">
              <div>
                <p className="pane__label">{s.window}</p>
                <h3>{result.idea.product}</h3>
                <p className="rep-muted">
                  {s.customer}: {result.idea.customer || '—'} · {s.market}: {result.idea.geography}
                </p>
              </div>
              <div className="result-head__actions">
                <button className="btn btn--glass btn--sm" onClick={() => downloadMarkdown(result, lang)}>
                  <Icon name="download" size={14} /> {s.exportMd}
                </button>
                <button
                  className="btn btn--red btn--sm"
                  onClick={() => {
                    setPhase('input')
                    setResult(null)
                    setEvents([])
                  }}
                >
                  <Icon name="plus" size={14} /> {s.again}
                </button>
              </div>
            </div>
            {!result.ragConnected && <p className="rep-warn">{s.ragOff}</p>}

            {result.sections.map((sec) => (
              <section key={sec.jp} className={`rep-sec rep-sec--${sec.status}`}>
                <header className="rep-sec__head">
                  <span className="rep-sec__id">{sec.jp.toUpperCase()}</span>
                  <h4>{JP_LABEL[lang][sec.jp]}</h4>
                  <span className={`rep-tag rep-tag--${JP_SOURCE[sec.jp] === 'RAG' ? 'rag' : 'cap'}`}>{JP_SOURCE[sec.jp]}</span>
                  <span className={`rep-status rep-status--${sec.status}`}>{statusText(lang, sec.status)}</span>
                </header>
                {sec.note && <p className="rep-note">{sec.note}</p>}
                {sec.claims.length > 0 && (
                  <ul className="rep-claims">
                    {sec.claims.map((c, i) => (
                      <ClaimItem key={i} c={c} label={s.sourceText} />
                    ))}
                  </ul>
                )}
              </section>
            ))}

            <section className="rep-sum">
              <h4>{s.summary}</h4>
              <div className="rep-sum__grid">
                <List title={s.favorable} items={result.summary.favorable} none={s.none} tone="ok" />
                <List title={s.risks} items={result.summary.risks} none={s.none} tone="risk" />
                <List title={s.gaps} items={result.summary.gaps} none={s.none} tone="gap" />
                <List title={s.validate} items={result.summary.validate} none={s.none} tone="you" />
              </div>
              <p className="rep-banner rep-banner--foot">{s.noVerdict}</p>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
