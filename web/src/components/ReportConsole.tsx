import { useEffect, useRef, useState, type FormEvent } from 'react'
import { colLabel, downloadCsv } from '../api/client'
import { ApiError, isDemo } from '../api/http'
import { downloadMarkdown, runReport } from '../api/report'
import type { Lang, Reference, ReportResult, RunEvent, RunResult } from '../api/types'
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
    noVerdict: '报告基于公开资料和政策知识库，每条数据都标了出处。',
    title: (p: string) => `${p}：市场调研报告`,
    conclusion: '核心结论',
    yourCall: '这是对市场现状的分析，做不做由你决定。',
    refs: '参考来源',
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
    validate: '接下来建议你自己验证',
    none: '无',
    exportMd: '导出报告',
    exportCsv: '导出竞品表 CSV',
    again: '新的想法',
    ragOff: '说明：政策知识库还在接入中，所以市场规模、政策和补贴三部分暂时没有资料可引用。',
    tooShort: '请多写几个字，至少说明产品做什么、卖给谁。',
    details: (n: number) => `查看竞品明细表（${n} 家）`,
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
    noVerdict: 'Built from public sources and the policy knowledge base; every figure is cited.',
    title: (p: string) => `${p}: market research report`,
    conclusion: 'Key takeaways',
    yourCall: 'This reads the market as it stands; whether to build it is your call.',
    refs: 'References',
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
    validate: 'What to validate next yourself',
    none: 'None',
    exportMd: 'Export report',
    exportCsv: 'Competitor table (CSV)',
    again: 'New idea',
    ragOff: 'Note: the policy knowledge base is still being connected, so the market, policy and grant sections have no documents to cite yet.',
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

/** Paragraph text with [n] marks turned into small superscript links to the numbered references. */
function Cited({ text, refs }: { text: string; refs: Reference[] }) {
  const parts = text.split(/(\[\d+(?:,\s*\d+)*\])/g)
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\[(\d+(?:,\s*\d+)*)\]$/.exec(p)
        if (!m) return <span key={i}>{p}</span>
        return (
          <sup key={i} className="rep-cite">
            {m[1].split(/,\s*/).map((n) => {
              const r = refs.find((x) => x.n === Number(n))
              return r ? (
                <a key={n} href={r.url} target="_blank" rel="noreferrer" title={[r.title, r.issuer, r.date].filter(Boolean).join(' · ')}>
                  {n}
                </a>
              ) : null
            })}
          </sup>
        )
      })}
    </>
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
          <article className="pane pane--result rep-doc">
            <div className="rep-head">
              <div>
                <p className="pane__label">{s.steps[2]}</p>
                <h2 className="rep-doc__title">{s.title(result.idea.product)}</h2>
                <p className="rep-muted">
                  {s.customer}: {result.idea.customer || '—'} · {s.market}: {result.idea.geography} · {result.finishedAt.slice(0, 10)}
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

            <section className="rep-conc">
              <h3>{s.conclusion}</h3>
              <p>
                <Cited text={result.narrative.conclusion} refs={result.narrative.references} />
              </p>
              <p className="rep-conc__note">{s.yourCall}</p>
            </section>

            {result.narrative.sections.map((sec, i) => (
              <section key={sec.jp} className="rep-para">
                <h3>
                  {i + 1}. {sec.heading}
                </h3>
                <p>
                  <Cited text={sec.text} refs={result.narrative.references} />
                </p>
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

            {result.summary.validate.length > 0 && (
              <section className="rep-para">
                <h3>{s.validate}</h3>
                <ul className="rep-validate">
                  {result.summary.validate.map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
              </section>
            )}

            {result.narrative.references.length > 0 && (
              <section className="rep-refs">
                <h3>{s.refs}</h3>
                <ol>
                  {result.narrative.references.map((r) => (
                    <li key={r.n} id={`ref-${result.runId}-${r.n}`}>
                      <a href={r.url} target="_blank" rel="noreferrer">
                        {r.title}
                      </a>
                      <span className="rep-muted">
                        {' '}
                        · {[r.issuer, r.date, r.page ? (lang === 'zh' ? `第 ${r.page} 页` : `p. ${r.page}`) : '', host(r.url)].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {!result.ragConnected && <p className="footnote">{s.ragOff}</p>}
            {isDemo && <p className="footnote">{s.demo}</p>}
          </article>
        )}
      </div>
    </div>
  )
}
