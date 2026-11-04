/* Shapes shared with the web app (web/src/api/types.ts). Keep the two in sync. */

export type Lang = 'zh' | 'en'

export type Dimension = 'name' | 'overview' | 'region' | 'size' | 'funding' | 'features' | 'pricing' | 'contact' | 'social' | 'news'
export const DIMENSIONS: Dimension[] = ['name', 'overview', 'region', 'size', 'funding', 'features', 'pricing', 'contact', 'social', 'news']

/**
 * Default fields per branch (design v2, 19 Oct 2026):
 * A · own   — the user does not know the competitors: a list with basic company information (introduction, country, size, funding), no pricing or news.
 * B · named — the user names them: basic info (overview, region), business (features, pricing template), recent activity (news, social).
 */
export const DEFAULT_DIMS_OWN: Dimension[] = ['name', 'overview', 'region', 'size', 'funding']
export const DEFAULT_DIMS_NAMED: Dimension[] = ['name', 'overview', 'region', 'features', 'pricing', 'social', 'news']

/** The SaaS pricing template: each slot is extracted and verified on its own. */
export type PricingSlot = 'plans' | 'unit' | 'billing' | 'addons' | 'free' | 'promo'
export const PRICING_SLOTS: PricingSlot[] = ['plans', 'unit', 'billing', 'addons', 'free', 'promo']

/** site = the subject's own website · web = any other page found by search · seo = search snippet */
export type SourceKind = 'site' | 'web' | 'seo' | 'news' | 'social'
export type IntentType = 'own' | 'named' | 'timeframe'
export type TimeRange = 'all' | '7d' | '30d' | '90d' | 'ytd'
export const TIME_RANGES: TimeRange[] = ['all', '7d', '30d', '90d', 'ytd']

export interface Intent {
  type: IntentType
  query: string
  company?: string
  /** The things being researched (companies, products, schools, cities, tools…). Name kept for compatibility. */
  competitors: string[]
  timeRange: TimeRange
  dimensions: Dimension[]
  /** What kind of thing the subjects are, e.g. "SaaS 产品", "大学硕士项目", "城市". */
  topic?: string
  /** Extra fields the user wants, in their own words, e.g. ["学费", "申请截止日期"]. */
  fields?: string[]
  /** Official domains already confirmed for some subjects (e.g. carried over from a "find competitors" run), keyed by subject name. */
  sites?: Record<string, string>
}

/** Column key of a custom field. */
export const CUSTOM_PREFIX = 'f:'
export const customKey = (label: string) => `${CUSTOM_PREFIX}${label}`
export const isCustom = (key: string) => key.startsWith(CUSTOM_PREFIX)
/** All table columns of an intent, in order: built-in fields, then custom ones. */
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

export type CellStatus = 'verified' | 'requeried' | 'missing'

/** One summarised post or article inside a list cell (latest news, social). */
export interface CellItem {
  /** One-sentence summary written by the model from the item itself. */
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
  date?: string
  /** Present for list fields: each item has its own summary and link. */
  items?: CellItem[]
  /** Pricing template slots with no public information. */
  gaps?: string[]
  /** The pricing came from a dated third-party page because no official page stated it. */
  thirdParty?: boolean
}

/** How the official site was found, most reliable first (recorded for the audit). */
export type SiteMethod = 'google_kg' | 'wikidata' | 'search_hint' | 'hint_verified' | 'search_domain' | 'search_weak' | 'given'

export interface Row {
  competitor: string
  domain: string
  /** How the official site was identified; absent when none was found. */
  siteMethod?: SiteMethod
  /** Keyed by column: a Dimension or `f:<custom label>`. */
  cells: Record<string, Cell | undefined>
}

export type RunStage = 2 | 3 | 4 | 5
export type RunEventKind = 'info' | 'ok' | 'retry' | 'fail'

export interface RunStats {
  sources: number
  checked: number
  requeried: number
  passed: number
  dropped: number
  /** Pricing template slots filled with verified facts, out of slots asked for. */
  pricingSlots?: { filled: number; total: number }
  /** Companies whose pricing rests on a dated third-party page instead of the official site. */
  pricingThirdParty?: number
}

export interface RunEvent {
  stage: RunStage
  kind: RunEventKind
  text: string
  stats?: Partial<RunStats>
}

export interface RunResult {
  runId: string
  intent: Intent
  rows: Row[]
  stats: RunStats
  finishedAt: string
}

export interface PublicUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
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
