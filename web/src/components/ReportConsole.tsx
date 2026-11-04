import { useEffect, useRef, useState, type FormEvent } from 'react'
import { colLabel, downloadCsv } from '../api/client'
import { ApiError, isDemo } from '../api/http'
import { downloadMarkdown, JP_LABEL, JP_SOURCE, runReport, statusText } from '../api/report'
import type { Claim, Lang, ReportResult, RunEvent, RunResult, Source } from '../api/types'
import { errorText } from '../data/content'
import { useLang } from '../i18n'
import { CellView } from './CellView'
import { Icon } from './ui'

const COPY = {
  zh: {
    steps: ['描述想法', '生成中', '市场报告'],
    stages: ['', '理解想法 · 知识库', '竞品与定价', '整理判断点', '总结'],
    ask: '用一句话描述你的 SaaS 创业想法',
    hint: '说清楚做什么产品、卖给谁、在哪个市场，报告会更准。',
    start: '生成报告',
    running: '生成中…',
    tryOne: '试试：',
    noVerdict: '本报告只列出证据，不给出做或不做的结论。决定由你来做。',
    live: '正在生成报告',
    liveSub: '查政策知识库、找竞争对手、核对官网和定价，通常需要几分钟。',
    customer: '目标客户',
    market: '市场',
    idea: '你的想法',
    sourceText: '原文',
    summary: '总结',
    favorable: '有利信号',
    risks: '风险',
    gaps: '证据缺口',
    validate: '需要你自己验证',
    none: '无',
    exportMd: '导出报告',
    exportCsv: '导出竞品表 CSV',
    again: '新的想法',
    ragOff: '政策知识库尚未接入：JP1–JP3 暂时没有证据，接入后会自动使用。',
    tooShort: '请多写几个字，至少说明产品做什么、卖给谁。',
    details: (n: number) => `查看竞品明细（${n} 家）`,
    hideDetails: '收起竞品明细',
    demo: '演示数据，仅用于展示报告结构。',
  },
  en: {
    steps: ['Your idea', 'Researching', 'Market report'],
    stages: ['', 'Idea · knowledge base', 'Competitors & pricing', 'Judgment points', 'Summary'],
    ask: 'Describe your SaaS startup idea in one sentence',
    hint: 'Say what the product does, who it is for and which market. The report gets sharper.',
    start: 'Generate report',
    running: 'Generating…',
    tryOne: 'Try:',
    noVerdict: 'This report presents evidence only. It gives no go / no-go verdict: the decision is yours.',
    live: 'Building your report',
    liveSub: 'Searching the policy knowledge base, finding competitors, checking official sites and pricing. Usually a few minutes.',
    customer: 'Customer',
    market: 'Market',
    idea: 'Your idea',
    sourceText: 'Source text',
    summary: 'Summary',
    favorable: 'Favorable signals',
    risks: 'Risks',
    gaps: 'Evidence gaps',
    validate: 'What you must validate yourself',
    none: 'None',
    exportMd: 'Export report',
    exportCsv: 'Competitor table (CSV)',
    again: 'New idea',
    ragOff: 'Policy knowledge base not connected yet: JP1–JP3 have no evidence for now and will use it once connected.',
    tooShort: 'Please write a bit more: at least what the product does and who it is for.',
    details: (n: number) => `Competitor details (${n})`,
    hideDetails: 'Hide competitor details',
    demo: 'Demo data, only to show the report structure.',
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

function Box({ title, items, none, tone }: { title: string; items: string[]; none: string; tone: string }) {
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

/** The competitor research behind JP4–JP5, folded into the report. */
function CompetitorTable({ run, lang }: { run: RunResult; lang: Lang }) {
  const cols = ['name', 'region', 'overview', 'pricing'].filter((c) => run.rows.some((r) => r.cells[c]))
  return (
    <div className="ftable-wrap rep-ftable">
      <table className="ftable">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{colLabel(lang, c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {run.rows.map((r) => (
            <tr key={r.competitor}>
              {cols.map((c) => (
                <CellView key={c} c={r.cells[c]} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Stepper({ current, running, steps, sub }: { current: number; running: boolean; steps: string[]; sub?: string }) {
  return (
    <ol className="stepper">
      {steps.map((s, i) => (
        <li key={s} className={`stepper__item ${i < current ? 'is-done' : ''} ${i === current ? 'is-current' : ''} ${i === current && running ? 'is-running' : ''}`}>
          <span className="stepper__dot">{i < current ? '✓' : i + 1}</span>
          <span className="stepper__label">
            {s}
            {i === 1 && i === current && sub && <small className="stepper__sub">{sub}</small>}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** One sentence about a startup idea → a market report structured by the five judgment points, plus a summary with no verdict. */
export default function ReportConsole({
  incoming,
  onDone,
}: {
  /** An idea handed over from the home page or the history list; it starts a report right away. */
  incoming?: { q: string; n: number } | null
  onDone?: (idea: string) => void
}) {
  const { lang, t } = useLang()
  const s = COPY[lang]
  const [idea, setIdea] = useState('')
  const [phase, setPhase] = useState<'input' | 'running' | 'done'>('input')
  const [events, setEvents] = useState<RunEvent[]>([])
  const [result, setResult] = useState<ReportResult | null>(null)
  const [error, setError] = useState('')
  const [showComp, setShowComp] = useState(false)
  const logRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [events])

  const start = async (text: string) => {
    const q = text.replace(/\s+/g, ' ').trim()
    setIdea(q)
    if (q.length < 10) {
      setError(s.tooShort)
      return
    }
    setError('')
    setEvents([])
    setResult(null)
    setShowComp(false)
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

  // each hand-off starts one report (guards against effects running twice in development)
  const handled = useRef(0)
  useEffect(() => {
    if (!incoming?.q || handled.current === incoming.n) return
    handled.current = incoming.n
    void start(incoming.q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.n])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void start(idea)
  }
  const reset = () => {
    setPhase('input')
    setResult(null)
    setEvents([])
    setError('')
  }

  const current = phase === 'input' ? 0 : phase === 'running' ? 1 : 2
  const lastStage = events.length ? events[events.length - 1].stage : 2
  const comp = result?.competitors

  return (
    <div className="glass console" id="report">
      <div className="console__bar">
        <span className="dots" aria-hidden>
          <span />
          <span />
          <span />
        </span>
        <span className="console__title">{t.studio.window}</span>
      </div>
      <div className="studio__stepper">
        <Stepper current={current} running={phase === 'running'} steps={s.steps} sub={phase === 'running' ? s.stages[lastStage - 1] : undefined} />
      </div>

      <div className="console__body studio__body">
        {/* ---------- 1 · one sentence ---------- */}
        {phase === 'input' && (
          <div className="pane pane--ask">
            <label className="pane__label" htmlFor="report-idea">
              {s.ask}
            </label>
            <form className="console__field ask ask--studio" onSubmit={submit}>
              <input id="report-idea" value={idea} onChange={(e) => setIdea(e.target.value)} placeholder={t.hero.placeholder} maxLength={600} autoFocus />
              <button className="btn btn--red" type="submit" disabled={!idea.trim()}>
                {s.start}
              </button>
            </form>
            <p className="rep-muted rep-hint">{s.hint}</p>
            <div className="examples">
              <span className="mono-label">{s.tryOne}</span>
              {t.examples.map((ex) => (
                <button key={ex} type="button" className="example" onClick={() => void start(ex)}>
                  {ex}
                </button>
              ))}
            </div>
            {error && <p className="error">{error}</p>}
            <p className="rep-banner rep-banner--soft">{s.noVerdict}</p>
          </div>
        )}

        {/* ---------- 2 · researching ---------- */}
        {phase === 'running' && (
          <div className="pane pane--live">
            <p className="pane__label">{s.idea}</p>
            <p className="pane__query">{idea}</p>
            <h3 className="rep-live">{s.live}</h3>
            <p className="rep-muted">{s.liveSub}</p>
            <div className="shimmer" aria-hidden />
            {events.length > 0 && (
              <ol className="log" ref={logRef}>
                {events.map((e, i) => (
                  <li key={i} className={`log__line log__line--${e.kind}`}>
                    <span className="log__stage">{s.stages[e.stage - 1] ?? ''}</span>
                    <span className="log__icon">{e.kind === 'ok' ? '✓' : e.kind === 'retry' ? '!' : e.kind === 'fail' ? '✕' : '·'}</span>
                    <span>{e.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {/* ---------- 3 · market report ---------- */}
        {phase === 'done' && result && (
          <div className="pane pane--result rep">
            <div className="rep-head">
              <div>
                <p className="pane__label">{s.steps[2]}</p>
                <h3>{result.idea.product}</h3>
                <p className="rep-muted">
                  {s.customer}: {result.idea.customer || '—'} · {s.market}: {result.idea.geography}
                </p>
                <p className="rep-muted rep-idea">“{result.idea.idea}”</p>
              </div>
              <div className="result-head__actions">
                <button className="btn btn--glass btn--sm" onClick={() => downloadMarkdown(result, lang)}>
                  <Icon name="download" size={14} /> {s.exportMd}
                </button>
                <button className="btn btn--red btn--sm" onClick={reset}>
                  <Icon name="plus" size={14} /> {s.again}
                </button>
              </div>
            </div>
            <p className="rep-banner">{s.noVerdict}</p>
            {!result.ragConnected && <p className="rep-warn">{s.ragOff}</p>}

            {result.sections.map((sec) => (
              <section key={sec.jp} className={`rep-sec rep-sec--${sec.status}`}>
                <header className="rep-sec__head">
                  <span className="rep-sec__id">{sec.jp.toUpperCase()}</span>
                  <h4>{JP_LABEL[lang][sec.jp]}</h4>
                  <span className={`rep-tag rep-tag--${JP_SOURCE[sec.jp] === 'RAG' ? 'rag' : 'cap'}`}>{JP_SOURCE[sec.jp] === 'RAG' ? (lang === 'zh' ? '政策知识库' : 'Knowledge base') : lang === 'zh' ? '竞品调研' : 'Competitor research'}</span>
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
                {sec.jp === 'jp5' && comp && comp.rows.length > 0 && (
                  <div className="rep-comp">
                    <div className="rep-comp__bar">
                      <button className="log-toggle" onClick={() => setShowComp((v) => !v)}>
                        {showComp ? s.hideDetails : s.details(comp.rows.length)}
                      </button>
                      {showComp && (
                        <button className="btn btn--glass btn--sm" onClick={() => void downloadCsv(comp, lang)}>
                          <Icon name="download" size={14} /> {s.exportCsv}
                        </button>
                      )}
                    </div>
                    {showComp && <CompetitorTable run={comp} lang={lang} />}
                  </div>
                )}
              </section>
            ))}

            <section className="rep-sum">
              <h4>{s.summary}</h4>
              <div className="rep-sum__grid">
                <Box title={s.favorable} items={result.summary.favorable} none={s.none} tone="ok" />
                <Box title={s.risks} items={result.summary.risks} none={s.none} tone="risk" />
                <Box title={s.gaps} items={result.summary.gaps} none={s.none} tone="gap" />
                <Box title={s.validate} items={result.summary.validate} none={s.none} tone="you" />
              </div>
              <p className="rep-banner rep-banner--foot">{s.noVerdict}</p>
            </section>
            {isDemo && <p className="footnote">{s.demo}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
