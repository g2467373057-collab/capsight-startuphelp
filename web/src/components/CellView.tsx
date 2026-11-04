import type { Cell, Source } from '../api/types'
import { useLang } from '../i18n'
import { Icon } from './ui'

/* Table cells of the competitor research table (JP4–JP5 details): value, sources, pricing-template gaps. */

export function SourcePill({ s }: { s: Source }) {
  const { t } = useLang()
  let host = ''
  try {
    host = new URL(s.url).hostname.replace(/^www\./, '')
  } catch {
    host = s.url
  }
  const label = s.kind === 'seo' || s.kind === 'news' ? t.sources[s.kind].label : host
  return (
    <a className={`src-pill src-pill--${s.kind}`} href={s.url} target="_blank" rel="noreferrer" title={`${s.title}\n${s.url}`}>
      <Icon name={s.kind === 'web' ? 'site' : s.kind} size={12} />
      {label}
    </a>
  )
}

export function CellView({ c }: { c?: Cell }) {
  const { t } = useLang()
  if (!c) return <td />
  if (c.status === 'missing') {
    return (
      <td className="cell cell--missing">
        <span className="cell__v">{c.value}</span>
      </td>
    )
  }
  // pricing template: the slots with no public information are named, never left blank; a third-party basis is flagged
  const gaps = (
    <>
      {c.thirdParty && (
        <span className="cell__meta">
          <span className="badge-loop">{t.studio.result.thirdParty}</span>
        </span>
      )}
      {c.gaps?.length ? (
        <span className="cell__meta cell__gaps">
          {t.studio.result.noInfo}：{c.gaps.join(' / ')}
        </span>
      ) : null}
    </>
  )
  if (c.items?.length) {
    const template = c.gaps !== undefined
    const extra = template ? c.sources : c.sources.filter((s) => s.kind === 'social' && !c.items!.some((i) => i.url === s.url))
    return (
      <td className="cell cell--list">
        {!(c.items.length === 1 && c.items[0].text === c.value) && <span className="cell__v cell__v--sum">{c.value}</span>}
        <ol className="cell__items">
          {c.items.map((i, k) => (
            <li key={i.url + k}>
              <span className="cell__ihead">
                {i.date && <span className="cell__date">{i.date.slice(5)}</span>}
                {i.label && <span className="cell__label">{i.label}</span>}
              </span>
              <a className="cell__itext" href={i.url} target="_blank" rel="noreferrer" title={i.url}>
                {i.text}
                <Icon name="external" size={11} />
              </a>
            </li>
          ))}
        </ol>
        {extra.length > 0 && (
          <span className="cell__meta">
            {extra.map((s) => (
              <SourcePill key={s.url} s={s} />
            ))}
            {c.status === 'requeried' && <span className="badge-loop" title={t.studio.result.requeried}>↺ {t.studio.result.requeriedShort}</span>}
          </span>
        )}
        {gaps}
      </td>
    )
  }
  return (
    <td className={`cell ${c.status === 'requeried' ? 'cell--requeried' : ''}`}>
      <span className="cell__v">
        {c.date && <span className="cell__date">{c.date}</span>}
        {c.value}
      </span>
      <span className="cell__meta">
        {c.sources.map((s) => (
          <SourcePill key={s.url + s.kind} s={s} />
        ))}
        {c.status === 'requeried' && <span className="badge-loop" title={t.studio.result.requeried}>↺ {t.studio.result.requeriedShort}</span>}
      </span>
      {gaps}
    </td>
  )
}
