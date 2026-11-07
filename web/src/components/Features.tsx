import { useEffect, useRef, useState, type ReactNode } from 'react'
import { COMPETITORS } from '../data/mock'
import { useLang } from '../i18n'
import { Icon, Reveal, SectionHeader, useParallax } from './ui'

/* ------------------------------------------------------------------ */
/* Looping product demos, drawn with the studio's own components.       */
/* Each scene is a pure function of `t` (ms into its loop), so it is    */
/* easy to retime. A scene only plays while it is on screen.            */
/* ------------------------------------------------------------------ */

/** Playback speed of the demos (1 = timings as written below). */
const SPEED = 1.5

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Milliseconds into a repeating loop. Plays only while on screen and `active`;
 * restarts from 0 every time it becomes playable.
 */
function useLoop(loopMs: number, restMs: number, active = true) {
  const ref = useRef<HTMLDivElement>(null)
  const [t, setT] = useState(() => (reduced() ? restMs : 0))
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (reduced()) {
      setT(restMs)
      return
    }
    if (!visible || !active) return
    const start = performance.now()
    setT(0)
    const id = window.setInterval(() => setT(((performance.now() - start) * SPEED) % loopMs), 40)
    return () => window.clearInterval(id)
  }, [visible, active, loopMs, restMs])
  return { ref, t }
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
/** 0→1 progress of t across [a, b]. */
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const ease = (x: number) => 1 - Math.pow(1 - x, 3)

function Window({ stage, fading, children }: { stage: number; fading: boolean; children: ReactNode }) {
  const { t } = useLang()
  // 0 typing · 1 understood · 2 researching · 3 report  →  three visible steps
  const step = stage <= 1 ? 0 : stage === 2 ? 1 : 2
  return (
    <div className="glass console demo spot">
      <div className="console__bar">
        <span className="dots" aria-hidden>
          <span />
          <span />
          <span />
        </span>
        <span className="console__title">{t.studio.window}</span>
      </div>
      <ol className="demo__steps" aria-hidden>
        {t.studio.steps.map((s, i) => (
          <li key={s} className={i < step ? 'is-done' : i === step ? 'is-current' : ''}>
            <span className="demo__dot">{i < step ? '✓' : i + 1}</span>
            {i === step && <span>{s}</span>}
          </li>
        ))}
      </ol>
      <div className={`demo__body ${fading ? 'is-fading' : ''}`}>{children}</div>
    </div>
  )
}

/* ---------- 1 · one sentence → what the report will answer ---------- */
function SceneIdea({ active = true }: { active?: boolean }) {
  const { t: c } = useLang()
  const v = c.features.viz
  const L = 9200
  const { ref, t } = useLoop(L, 8000, active)
  const typed = Math.round(span(t, 500, 3000) * v.query.length)
  const pressed = t > 3100 && t < 3300
  const parsing = t >= 3200 && t < 4100
  const shown = t >= 4100
  const pop = (at: number) => (t >= at ? 'is-in' : '')
  return (
    <div ref={ref}>
      <Window stage={shown ? 1 : 0} fading={t > L - 500}>
        <p className="pane__label">{c.studio.ask}</p>
        <div className="console__field ask ask--studio demo__ask">
          <span className="demo__input">
            {typed ? v.query.slice(0, typed) : <span className="demo__ph">{c.hero.placeholder}</span>}
            {!shown && t < 3200 && <span className="caret" />}
          </span>
          <span className={`btn btn--red btn--sm ${pressed ? 'is-pressed' : ''} ${typed < v.query.length ? 'is-dim' : ''}`}>{c.hero.go}</span>
        </div>
        {parsing && <div className="shimmer" />}
        {shown && (
          <div className="pane demo__pane">
            <p className="pane__label">{v.understood}</p>
            <dl className="intent intent--demo">
              {v.fields.map(([k, val], i) => (
                <div key={k} className={`pop ${pop(4300 + i * 350)}`}>
                  <dt>{k}</dt>
                  <dd>
                    <span className="chip chip--on">{val}</span>
                  </dd>
                </div>
              ))}
              <div className={`pop ${pop(5400)}`}>
                <dt>{v.jpLabel}</dt>
                <dd className="chips">
                  {v.jps.map((j, i) => (
                    <span key={j} className={`chip chip--on pop ${pop(5500 + i * 160)}`}>
                      {i + 1} · {j}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </Window>
    </div>
  )
}

/* ---------- 2 · two evidence sources searched together ---------- */
function SceneEvidence({ active = true }: { active?: boolean }) {
  const { t: c } = useLang()
  const v = c.features.viz
  const L = 8400
  const { ref, t } = useLoop(L, 6500, active)
  const icons = ['table', 'site'] as const
  const ends = [3600, 4800]
  const at = [900, 1700, 2500, 3300, 4300]
  const lines = v.evLog.filter((_, i) => t >= at[i])
  const counts = [3, 5, 8, 11, 14]
  const found = lines.length ? counts[lines.length - 1] : 0
  return (
    <div ref={ref}>
      <Window stage={2} fading={t > L - 500}>
        <div className="demo__bars demo__bars--two">
          {v.lanes.map((lane, i) => {
            const p = ease(span(t, 300, ends[i]))
            return (
              <div key={lane.name} className="viz__src">
                <span className={`src-icon src-icon--${i ? 'site' : 'news'}`}>
                  <Icon name={icons[i]} size={16} />
                </span>
                <div className="viz__src-main">
                  <div className="viz__src-top">
                    <strong>{lane.name}</strong>
                    <span className="mono">{Math.round(p * 100)}%</span>
                  </div>
                  <small className="demo__lane-sub">{lane.sub}</small>
                  <div className="viz__bar">
                    <span style={{ width: `${p * 100}%` }} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="pane demo__pane">
          <div className="pane__head">
            <p className="pane__label">
              {t < 5000 && <span className="pulse" />}
              {c.studio.live.heading}
            </p>
            <div className="counters">
              <span>
                <b>{found}</b> {v.found}
              </span>
            </div>
          </div>
          <ol className="log log--demo">
            {lines.map((l, i) => (
              <li key={l} className="log__line log__line--ok">
                <span className="log__stage">{v.jps[i]}</span>
                <span className="log__icon">✓</span>
                <span>{l}</span>
              </li>
            ))}
          </ol>
        </div>
      </Window>
    </div>
  )
}

/* ---------- 3 · the evidence gates: quotes checked, unsourced numbers deleted ---------- */
function SceneVerify({ active = true }: { active?: boolean }) {
  const { t: c, lang } = useLang()
  const v = c.features.viz
  const L = 9000
  const { ref, t } = useLoop(L, 7500, active)
  const at = [500, 1400, 2500, 3600, 4700]
  const lines = v.verifyLog.filter((_, i) => t >= at[i])
  const cut = t >= 2700
  return (
    <div ref={ref}>
      <Window stage={2} fading={t > L - 500}>
        <div className="pane demo__pane">
          <div className="pane__head">
            <p className="pane__label">
              {t < 4900 && <span className="pulse" />}
              {c.features.items[2].tag}
            </p>
            <div className="counters">
              <span>
                <b>{t >= 1400 ? 18 : 0}</b> {v.checked}
              </span>
              <span className="counters--loop">
                <b>{(t >= 2500 ? 1 : 0) + (t >= 3600 ? 1 : 0)}</b> {v.dropped}
              </span>
            </div>
          </div>
          <ol className="log log--demo">
            {lines.map((l, i) => (
              <li key={i} className={`log__line log__line--${l.kind}`}>
                <span className="log__stage">{v.verifyStage[i]}</span>
                <span className="log__icon">{l.kind === 'ok' ? '✓' : l.kind === 'retry' ? '!' : l.kind === 'fail' ? '✕' : '·'}</span>
                <span>{l.text}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="pane demo__pane demo__draft">
          <p className="pane__label">{v.draft}</p>
          <p>
            {v.paraA}
            <sup className="rep-cite">
              <a>1</a>
            </sup>
            {v.paraB}
            <sup className="rep-cite">
              <a>2</a>
            </sup>
            {lang === 'zh' ? '。' : '. '}
            <span className={`demo__strike ${cut ? 'is-cut' : ''}`}>{v.struck}</span>
            {cut && <span className="demo__strike-note">✕ {v.struckNote}</span>}
          </p>
        </div>
      </Window>
    </div>
  )
}

/* ---------- 4 · the report, with the competitor table attached as CSV ---------- */
function SceneReport({ active = true }: { active?: boolean }) {
  const { t: c, lang } = useLang()
  const v = c.features.viz
  const L = 9400
  const { ref, t } = useLoop(L, 6500, active)
  const rows = COMPETITORS.slice(0, 3)
  const cursor = span(t, 3400, 4300)
  const pressed = t > 4350 && t < 4550
  const done = t >= 4500
  const pop = (at: number) => (t >= at ? 'is-in' : '')
  return (
    <div ref={ref}>
      <Window stage={3} fading={t > L - 500}>
        <div className="demo__doc">
          <h4 className={`pop ${pop(200)}`}>{v.reportTitle}</h4>
          <div className={`rep-conc demo__conc pop ${pop(600)}`}>
            <h3>{v.conclusion}</h3>
            <p>
              {v.concText}
              <sup className="rep-cite">
                <a>3</a>
              </sup>
              {v.concText2}
              <sup className="rep-cite">
                <a>4</a>
              </sup>
              {lang === 'zh' ? '。' : '.'}
            </p>
            <p className="rep-conc__note">{v.yourCall}</p>
          </div>
          <div className={`rep-comp__bar demo__appbar pop ${pop(1500)}`}>
            <strong>{v.appendix}</strong>
            <span className="demo__btnwrap">
              <span className={`btn btn--glass btn--sm ${pressed ? 'is-pressed' : ''}`}>
                <Icon name="download" size={13} />
                {v.exportCsv}
              </span>
              <svg
                className="demo__cursor"
                viewBox="0 0 24 24"
                width="22"
                height="22"
                style={{
                  opacity: t > 3200 && t < 6000 ? 1 : 0,
                  transform: `translate(${(1 - ease(cursor)) * 70}px, ${(1 - ease(cursor)) * 60}px) scale(${pressed ? 0.85 : 1})`,
                }}
                aria-hidden
              >
                <path d="M5 3l14 8-6 1.6L10 19z" />
              </svg>
            </span>
          </div>
          <div className="ftable-wrap demo__table">
            <table className="ftable">
              <thead>
                <tr>
                  <th>{c.dims.name}</th>
                  <th>{c.dims.region}</th>
                  <th>{c.dims.pricing}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.name} className={`pop ${pop(1800 + i * 300)}`}>
                    <td className="cell">
                      <span className="cell__v">{r.name}</span>
                    </td>
                    <td className="cell">
                      <span className="cell__v">{r.region.value[lang]}</span>
                    </td>
                    <td className="cell">
                      <span className="cell__v">{r.pricing.value[lang]}</span>
                      <span className="cell__meta">
                        <span className="src-pill">
                          <Icon name="site" size={12} />
                          {r.domain}
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className={`demo__toast ${done && t < 8200 ? 'is-in' : ''}`} role="status">
          <span className="viz__file-icon">CSV</span>
          <span>
            {v.saved} <span className="mono">capsight-202611081118.csv</span>
          </span>
        </div>
      </Window>
    </div>
  )
}

const SCENES = [SceneIdea, SceneEvidence, SceneVerify, SceneReport]

function useStoryMode() {
  const q = '(min-width: 961px)'
  const [on, setOn] = useState(() => !reduced() && !!window.matchMedia?.(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const f = () => setOn(!reduced() && mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])
  return on
}

/** Desktop: the demo window stays pinned while the four captions scroll past; the window follows along. */
function Story() {
  const { t } = useLang()
  const [active, setActive] = useState(0)
  const steps = useRef<(HTMLDivElement | null)[]>([])
  const deck = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const update = () => {
      raf = 0
      const mid = window.innerHeight * 0.5
      let best = 0
      let dist = Infinity
      steps.current.forEach((el, i) => {
        if (!el) return
        const r = el.getBoundingClientRect()
        const d = Math.abs(r.top + r.height / 2 - mid)
        if (d < dist) {
          dist = d
          best = i
        }
      })
      setActive(best)
    }
    const on = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => {
      window.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  const tilt = (e: { clientX: number; clientY: number }) => {
    const el = deck.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    el.style.setProperty('--ry', `${(x * 6).toFixed(2)}deg`)
    el.style.setProperty('--rx', `${(-y * 5).toFixed(2)}deg`)
  }
  const untilt = () => {
    deck.current?.style.setProperty('--ry', '0deg')
    deck.current?.style.setProperty('--rx', '0deg')
  }

  return (
    <section id="features" className="section story-sec">
      <SectionHeader index="01" eyebrow={t.features.eyebrow} title={t.features.title} sub={t.features.sub} />
      <div className="story">
        <div className="story__steps">
          {t.features.items.map((f, i) => (
            <div
              key={f.tag}
              ref={(n) => {
                steps.current[i] = n
              }}
              className={`story__step ${i === active ? 'is-active' : ''}`}
            >
              <p className="mono-label">
                {String(i + 1).padStart(2, '0')} · {f.tag}
              </p>
              <h3>{f.title}</h3>
              <p className="muted">{f.body}</p>
            </div>
          ))}
        </div>
        <div className="story__stage">
          <div className="story__sticky">
            <div className="story__pager" aria-hidden>
              {t.features.items.map((f, i) => (
                <span key={f.tag} className={i === active ? 'is-on' : i < active ? 'is-past' : ''}>
                  {String(i + 1).padStart(2, '0')}
                </span>
              ))}
            </div>
            <div className="story__deck" ref={deck} onPointerMove={tilt} onPointerLeave={untilt}>
              {SCENES.map((Scene, i) => (
                <div key={i} className={`story__scene ${i === active ? 'is-active' : i < active ? 'is-past' : ''}`}>
                  <Scene active={i === active} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/** Phones and reduced motion: alternating rows, each demo plays when it scrolls into view. */
function Rows() {
  const { t } = useLang()
  const ref = useParallax<HTMLElement>()
  return (
    <section id="features" className="section" ref={ref}>
      <SectionHeader index="01" eyebrow={t.features.eyebrow} title={t.features.title} sub={t.features.sub} />
      <div className="features">
        {t.features.items.map((f, i) => {
          const Scene = SCENES[i]
          return (
            <div key={f.tag} className={`feature ${i % 2 ? 'feature--flip' : ''}`}>
              <Reveal className="feature__text">
                <p className="mono-label">
                  {String(i + 1).padStart(2, '0')} · {f.tag}
                </p>
                <h3>{f.title}</h3>
                <p className="muted">{f.body}</p>
              </Reveal>
              <Reveal className="feature__media" delay={0.1}>
                <div className="feature__frame" data-speed={i % 2 ? -50 : 50}>
                  <Scene />
                </div>
              </Reveal>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default function Features() {
  return useStoryMode() ? <Story /> : <Rows />
}
