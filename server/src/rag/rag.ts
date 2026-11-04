import type { Config } from '../config.ts'
import type { JpId, Passage } from '../types.ts'

/**
 * The RAG knowledge base (policy, regulation, market documents admitted through the KM gate).
 * The retrieval service itself is built separately; this file only speaks its HTTP contract (docs/RAG-API.md).
 */
export interface RagQuery {
  question: string
  jp: JpId
  /** e.g. "Singapore" */
  geography: string
  /** e.g. "HR SaaS for SMEs" */
  sector: string
  topK: number
}

export interface Rag {
  readonly connected: boolean
  retrieve(q: RagQuery): Promise<Passage[]>
}

/** No knowledge base connected: every query returns nothing, so the report says so instead of guessing. */
export class NoRag implements Rag {
  readonly connected = false
  async retrieve(): Promise<Passage[]> {
    return []
  }
}

interface RawPassage {
  text?: unknown
  title?: unknown
  issuer?: unknown
  date?: unknown
  url?: unknown
  doc_id?: unknown
  chunk_id?: unknown
  score?: unknown
}

const s = (v: unknown, max: number) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** Keeps only passages that can be cited: text, a title and an http(s) link. */
export function normalisePassages(raw: unknown, topK: number): Passage[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { passages?: unknown }).passages) ? ((raw as { passages: RawPassage[] }).passages) : []
  const out: Passage[] = []
  for (const p of list) {
    if (!p || typeof p !== 'object') continue
    const text = s(p.text, 2000)
    const url = s(p.url, 500)
    const title = s(p.title, 200)
    if (!text || !title || !/^https?:\/\//i.test(url)) continue
    const date = s(p.date, 10)
    out.push({
      id: s(p.chunk_id, 80) || `${s(p.doc_id, 60) || url}#${out.length}`,
      text,
      title,
      url,
      ...(s(p.issuer, 120) ? { issuer: s(p.issuer, 120) } : {}),
      ...(/^\d{4}(-\d{2}(-\d{2})?)?$/.test(date) ? { date } : {}),
      ...(s(p.doc_id, 80) ? { docId: s(p.doc_id, 80) } : {}),
      ...(typeof p.score === 'number' && Number.isFinite(p.score) ? { score: p.score } : {}),
    })
    if (out.length >= topK) break
  }
  return out
}

/** Calls the RAG service: POST {RAG_URL}/retrieve. */
export class HttpRag implements Rag {
  readonly connected = true
  private url: string
  private apiKey?: string
  private timeoutMs: number
  constructor(cfg: Config['rag']) {
    this.url = cfg.url
    this.apiKey = cfg.apiKey
    this.timeoutMs = cfg.timeoutMs
  }
  async retrieve(q: RagQuery): Promise<Passage[]> {
    const res = await fetch(`${this.url}/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ question: q.question, judgment_point: q.jp.toUpperCase(), geography: q.geography, sector: q.sector, top_k: q.topK }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!res.ok) throw new Error(`rag_http_${res.status}`)
    return normalisePassages(await res.json(), q.topK)
  }
}

export function createRag(cfg: Config): Rag {
  return cfg.rag.url ? new HttpRag(cfg.rag) : new NoRag()
}
