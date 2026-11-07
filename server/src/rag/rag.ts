import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { Config } from '../config.ts'
import type { JpId, Passage } from '../types.ts'

/**
 * The RAG knowledge base (policy, regulation, market documents admitted through the KM gate).
 * The retrieval service lives in rag-service/ (FastAPI + Chroma, built by Xu Zihan).
 * This client speaks its API, and joins each passage to the document register
 * (title, issuer, date, official URL) kept with the admitted documents.
 */
export interface RagQuery {
  question: string
  /** Restrict to documents tagged for this judgment point; omit to search everything. */
  jp?: JpId
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

/* ---------------- document register ---------------- */

/** One admitted document, from the KM admission register (CSV). */
export interface RegisterEntry {
  fileName: string
  docId: string
  title?: string
  issuer?: string
  /** YYYY-MM-DD, YYYY-MM or YYYY */
  date?: string
  url?: string
  /** Judgment points this document may answer. */
  jps: JpId[]
  admitted: boolean
}

/** Default judgment point from the file-name prefix the team used (C02, D01, S04…). */
export function jpsFromPrefix(fileName: string): JpId[] {
  const p = fileName.trim().charAt(0).toUpperCase()
  if (p === 'I') return ['jp1'] // industry and macro
  if (p === 'S') return ['jp3'] // grants and support
  if ('CDGLT'.includes(p)) return ['jp2'] // cybersecurity, data protection, AI governance, law, tax
  return ['jp1', 'jp2', 'jp3']
}

/** Minimal CSV parser (quoted fields, commas and newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((c) => c.trim())) rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim())) rows.push(row)
  return rows
}

const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/
const JP_RE = /jp\s*0?([1-5])/gi

/**
 * Reads the register. Expected columns (header names, any order, case-insensitive):
 * file_name, doc_id, title, issuer, date, url, jp, admitted
 * jp may hold "JP2" or "JP1;JP3"; admitted = yes/no (rows marked no are never cited).
 */
export function parseRegister(csv: string): Map<string, RegisterEntry> {
  const rows = parseCsv(csv.replace(/^﻿/, ''))
  const out = new Map<string, RegisterEntry>()
  if (!rows.length) return out
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'))
  const col = (r: string[], ...names: string[]) => {
    for (const n of names) {
      const i = head.indexOf(n)
      if (i >= 0 && r[i] !== undefined) return r[i].trim()
    }
    return ''
  }
  for (const r of rows.slice(1)) {
    const fileName = basename(col(r, 'file_name', 'file', 'filename'))
    if (!fileName) continue
    const jpText = col(r, 'jp', 'judgment_point', 'judgment_points')
    const jps = [...jpText.matchAll(JP_RE)].map((m) => `jp${m[1]}` as JpId)
    const date = col(r, 'date', 'publication_date', 'effective_date')
    const url = col(r, 'url', 'official_url', 'link')
    const admitted = !/^(no|n|rejected|false|0)$/i.test(col(r, 'admitted', 'status'))
    out.set(fileName, {
      fileName,
      docId: col(r, 'doc_id', 'id') || fileName.split('_')[0],
      // a ceased scheme stays citable as history, and says so in its title
      ...(col(r, 'title') ? { title: col(r, 'title') + (/^ceased/i.test(col(r, 'status')) ? ` (${col(r, 'status')})` : '') } : {}),
      ...(col(r, 'issuer', 'agency') ? { issuer: col(r, 'issuer', 'agency') } : {}),
      ...(DATE.test(date) ? { date } : {}),
      ...(/^https?:\/\//i.test(url) ? { url } : {}),
      jps: jps.length ? jps : jpsFromPrefix(fileName),
      admitted,
    })
  }
  return out
}

export function loadRegister(path: string): Map<string, RegisterEntry> {
  const p = resolve(path)
  return existsSync(p) ? parseRegister(readFileSync(p, 'utf8')) : new Map()
}

/* ---------------- response normalising ---------------- */

const s = (v: unknown, max: number) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** Readable title from a file name: "D01_Personal_Data_Protection_Act_2012.pdf" → "Personal Data Protection Act 2012". */
export const titleFromFile = (f: string) =>
  f
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/^[A-Z]\d{2}_/, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

interface ZihanResult {
  text?: unknown
  score?: unknown
  source?: { file_name?: unknown; file_path?: unknown; page?: unknown; chunk_index?: unknown }
}

/**
 * Accepts either response shape:
 *  - rag-service (Zihan): { results: [{ text, score, source: { file_name, page, chunk_index } }] }
 *  - docs/RAG-API.md:     { passages: [{ text, title, issuer, date, url, doc_id, chunk_id, score }] }
 * Passages that cannot be cited (no text, no title, no link) and documents marked not admitted are dropped.
 */
export function normalisePassages(raw: unknown, topK: number, register: Map<string, RegisterEntry> = new Map(), ragUrl = ''): Passage[] {
  const out: Passage[] = []
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  if (Array.isArray(obj.results)) {
    for (const r of obj.results as ZihanResult[]) {
      const text = s(r?.text, 3000)
      const file = s(r?.source?.file_name, 200)
      if (!text || !file) continue
      const reg = register.get(file)
      if (reg && !reg.admitted) continue
      const page = typeof r.source?.page === 'number' && r.source.page > 0 ? r.source.page : undefined
      const local = ragUrl ? `${ragUrl}/files/${encodeURIComponent(file)}${page ? `#page=${page}` : ''}` : ''
      const url = reg?.url ?? local
      if (!url) continue
      out.push({
        id: `${reg?.docId ?? file}#p${page ?? '-'}#${s(r.source?.chunk_index, 6) || out.length}`,
        text,
        title: reg?.title ?? titleFromFile(file),
        url,
        docId: reg?.docId ?? file.split('_')[0],
        ...(reg?.issuer ? { issuer: reg.issuer } : {}),
        ...(reg?.date ? { date: reg.date } : {}),
        ...(page ? { page } : {}),
        ...(typeof r.score === 'number' && Number.isFinite(r.score) ? { score: r.score } : {}),
      })
      if (out.length >= topK) break
    }
    return out
  }
  const list = Array.isArray(obj.passages) ? (obj.passages as Record<string, unknown>[]) : []
  for (const p of list) {
    if (!p || typeof p !== 'object') continue
    const text = s(p.text, 3000)
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
      ...(DATE.test(date) ? { date } : {}),
      ...(s(p.doc_id, 80) ? { docId: s(p.doc_id, 80) } : {}),
      ...(typeof p.page === 'number' && p.page > 0 ? { page: p.page } : {}),
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
  private register: Map<string, RegisterEntry>
  constructor(cfg: Config['rag'], register: Map<string, RegisterEntry> = new Map()) {
    this.url = cfg.url
    this.apiKey = cfg.apiKey
    this.timeoutMs = cfg.timeoutMs
    this.register = register
  }
  private indexed?: string[]
  /** Files the service has indexed (GET /sources), fetched once; used when the register is empty. */
  private async indexedFiles(): Promise<string[]> {
    if (this.indexed) return this.indexed
    try {
      const res = await fetch(`${this.url}/sources`, { signal: AbortSignal.timeout(this.timeoutMs) })
      const body = (await res.json()) as { documents?: unknown }
      this.indexed = Array.isArray(body.documents) ? body.documents.map(String) : []
    } catch {
      this.indexed = []
    }
    return this.indexed
  }
  /** Files tagged for a judgment point: register tags first, else the file-name prefix rule on indexed files. */
  async filesFor(jp: JpId): Promise<string[]> {
    if (this.register.size) return [...this.register.values()].filter((e) => e.admitted && e.jps.includes(jp)).map((e) => e.fileName)
    return (await this.indexedFiles()).filter((f) => jpsFromPrefix(f).includes(jp))
  }
  async retrieve(q: RagQuery): Promise<Passage[]> {
    const files = q.jp ? await this.filesFor(q.jp) : []
    const res = await fetch(`${this.url}/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({
        query: q.question,
        top_k: Math.min(20, Math.max(1, q.topK)),
        ...(files.length ? { source_files: files } : {}),
        // fields for services built to docs/RAG-API.md
        question: q.question,
        ...(q.jp ? { judgment_point: q.jp.toUpperCase() } : {}),
        geography: q.geography,
        sector: q.sector,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (res.status === 503) return [] // knowledge base empty
    if (!res.ok) throw new Error(`rag_http_${res.status}`)
    return normalisePassages(await res.json(), q.topK, this.register, this.url)
  }
}

export function createRag(cfg: Config): Rag {
  return cfg.rag.url ? new HttpRag(cfg.rag, loadRegister(cfg.rag.register)) : new NoRag()
}
