export type Lang = 'zh' | 'en'

/** The output fields, in table order. */
export type Dimension = 'name' | 'overview' | 'region' | 'size' | 'funding' | 'features' | 'pricing' | 'contact' | 'social' | 'news'

export const DIMENSIONS: Dimension[] = ['name', 'overview', 'region', 'size', 'funding', 'features', 'pricing', 'contact', 'social', 'news']

/** Default fields per branch (keep in sync with server/src/types.ts). A: list + basic company info · B: full research. */
export const DEFAULT_DIMS_OWN: Dimension[] = ['name', 'overview', 'region', 'size', 'funding']
export const DEFAULT_DIMS_NAMED: Dimension[] = ['name', 'overview', 'region', 'features', 'pricing', 'social', 'news']

/** Where a fact was found. site = the subject's own website · web = another page found by search. */
export type SourceKind = 'site' | 'web' | 'seo' | 'news' | 'social'

/**
 * own       — "find them for me" (competitors of my company, or things matching a description)
 * named     — "facts about these subjects"
 * timeframe — "this dimension, in this time window"
 */
export type IntentType = 'own' | 'named' | 'timeframe'

export type TimeRange = 'all' | '7d' | '30d' | '90d' | 'ytd'

export interface Intent {
  type: IntentType
  query: string
  /** The user's own company, for `own` intents. */
  company?: string
  /** The things being researched (companies, products, schools, cities…). Name kept for compatibility. */
  competitors: string[]
  timeRange: TimeRange
  dimensions: Dimension[]
  /** What kind of thing the subjects are. */
  topic?: string
  /** Extra fields in the user's own words, e.g. ["融资情况", "集成"]. */
  fields?: string[]
  /** Official domains already confirmed (carried over from a "find competitors" run), keyed by subject name. */
  sites?: Record<string, string>
}

/** Column key of a custom field. */
export const CUSTOM_PREFIX = 'f:'
export const customKey = (label: string) => `${CUSTOM_PREFIX}${label}`
export const isCustom = (key: string) => key.startsWith(CUSTOM_PREFIX)
export const MAX_FIELDS = 6
/** All table columns of an intent, in order: built-in fields, then custom ones, then news/social. */
export function columnsOf(intent: Pick<Intent, 'dimensions' | 'fields'>): string[] {
  const dims = intent.dimensions
  const head = dims.filter((d) => d !== 'news' && d !== 'social')
  const tail = dims.filter((d) => d === 'news' || d === 'social')
  return [...head, ...(intent.fields ?? []).map(customKey), ...tail]
}

export interface Source {
  kind: SourceKind
  url: string
  title: string
}

/** verified: passed first check · requeried: failed self-check, passed after re-query · missing: dropped */
export type CellStatus = 'verified' | 'requeried' | 'missing'

/** One summarised post or article inside a list cell (latest news, social). */
export interface CellItem {
  text: string
  url: string
  date?: string
  /** Where it came from, e.g. "X", "LinkedIn", "微博", or the news outlet. */
  label?: string
}

export interface Cell {
  value: string
  sources: Source[]
  status: CellStatus
  /** ISO date, for time-bound facts such as news. */
  date?: string
  /** Present for list fields: each item has its own summary and link. */
  items?: CellItem[]
  /** Pricing template: slots with no public information (present, possibly empty, on pricing cells). */
  gaps?: string[]
  /** The pricing rests on a dated third-party page because no official page stated it. */
  thirdParty?: boolean
}

export interface Row {
  competitor: string
  domain: string
  /** How the official site was identified (google_kg, wikidata, search_hint, hint_verified, search_domain, search_weak). */
  siteMethod?: string
  /** Keyed by column: a Dimension or `f:<custom label>`. */
  cells: Record<string, Cell | undefined>
}

/** Pipeline stage a log line belongs to: 2 fetch · 3 verify · 4 self-check · 5 organise */
export type RunStage = 2 | 3 | 4 | 5

export type RunEventKind = 'info' | 'ok' | 'retry' | 'fail'

export interface RunEvent {
  stage: RunStage
  kind: RunEventKind
  text: string
  /** Optional running counters, merged into the live stats. */
  stats?: Partial<RunStats>
}

export interface RunStats {
  sources: number
  checked: number
  requeried: number
  passed: number
  dropped: number
  /** Pricing template slots filled with verified facts. */
  pricingSlots?: { filled: number; total: number }
  pricingThirdParty?: number
}

export interface RunResult {
  runId: string
  intent: Intent
  rows: Row[]
  stats: RunStats
  finishedAt: string
}

export interface RunOptions {
  lang: Lang
  onEvent?: (e: RunEvent) => void
}

/* ---------- startup-help-agent: founder market report ---------- */

/** The five judgment points (one report section each); the summary is built from them. */
export type JpId = 'jp1' | 'jp2' | 'jp3' | 'jp4' | 'jp5'
export const JP_IDS: JpId[] = ['jp1', 'jp2', 'jp3', 'jp4', 'jp5']
/** JP1–JP3 come from the RAG knowledge base, JP4–JP5 from the competitor pipeline. */
export const RAG_JPS: JpId[] = ['jp1', 'jp2', 'jp3']

/** enough = the judgment point's evidence bar is met · partial = some evidence, bar not met · missing = none found. */
export type EvidenceStatus = 'enough' | 'partial' | 'missing'

/** A passage returned by the RAG knowledge base (see docs/RAG-API.md). */
export interface Passage {
  id: string
  text: string
  title: string
  issuer?: string
  /** Publication or effective date, YYYY-MM-DD or YYYY. */
  date?: string
  url: string
  docId?: string
  /** Page in the source PDF (1-based), when known. */
  page?: number
  score?: number
}

/** One statement in the report, tied to the evidence it rests on. */
export interface Claim {
  text: string
  /** Verbatim words from the source that support the claim (checked by code). */
  quote?: string
  sources: Source[]
  /** For passages: issuer and date shown next to the link. */
  issuer?: string
  date?: string
  page?: number
}

export interface ReportSection {
  jp: JpId
  status: EvidenceStatus
  claims: Claim[]
  /** Fixed wording shown when the evidence bar is not met (e.g. "No relevant grant found"). */
  note?: string
}

export interface ReportSummary {
  favorable: string[]
  risks: string[]
  gaps: string[]
  /** What the founder must validate themselves (customer pain, willingness to pay…). */
  validate: string[]
}

export interface FounderIdea {
  idea: string
  product: string
  customer: string
  sector: string
  geography: string
}

/** A numbered source in the written report, cited in the text as [n]. */
export interface Reference {
  n: number
  title: string
  url: string
  issuer?: string
  date?: string
  page?: number
  kind: SourceKind
}

/** The report as a reader sees it: one paragraph per judgment point, a conclusion, numbered references. */
export interface Narrative {
  sections: { jp: JpId; heading: string; text: string }[]
  conclusion: string
  references: Reference[]
}

export interface ReportResult {
  runId: string
  kind: 'report'
  idea: FounderIdea
  /** Written report shown to the founder; the structured sections below back it and are used for scoring. */
  narrative: Narrative
  sections: ReportSection[]
  summary: ReportSummary
  /** The competitor table behind JP4–JP5. */
  competitors?: RunResult
  /** False when no RAG service is connected: JP1–JP3 then say so instead of guessing. */
  ragConnected: boolean
  finishedAt: string
}
