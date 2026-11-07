import { UNTRUSTED_NOTE, type Llm } from '../llm/llm.ts'
import type { Rag } from '../rag/rag.ts'
import type { Passage } from '../types.ts'
import { norm } from './report.ts'

/**
 * Ask the knowledge base one question directly (used by the PR04 50-question RAG test).
 * Same rule as the report: an answer sentence is kept only if its quote is found in the passage it cites.
 */
export interface AskClaim {
  text: string
  quote: string
  title: string
  docId?: string
  page?: number
  url: string
}

export interface AskResult {
  question: string
  /** The verified answer, or a plain "not found" sentence. */
  answer: string
  claims: AskClaim[]
  /** What retrieval returned, before any gate. */
  retrieved: { docId?: string; title: string; page?: number; score?: number }[]
  proposed: number
}

const NOT_FOUND = 'The knowledge base does not hold enough evidence to answer this question.'
const oneLine = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

export async function askKnowledgeBase(llm: Llm, rag: Rag, question: string, topK = 6): Promise<AskResult> {
  const passages: Passage[] = await rag.retrieve({ question, geography: 'Singapore', sector: '', topK })
  const retrieved = passages.map((p) => ({ docId: p.docId, title: p.title, page: p.page, score: p.score }))
  if (!passages.length) return { question, answer: NOT_FOUND, claims: [], retrieved, proposed: 0 }
  type RawClaim = { text?: unknown; passage?: unknown; quote?: unknown }
  let raw: { claims?: RawClaim[] } = {}
  try {
    raw = await llm.json<{ claims?: RawClaim[] }>({
      task: 'ask_kb',
      system: [
        'Answer the question using ONLY the passages from official Singapore documents.',
        'Write up to 5 claims that together answer the question. Each claim: one factual sentence, the passage id, and a quote copied word for word from that passage (8–40 words) that supports it.',
        'Keep names, dates, numbers and scope limits exactly as the passage states them. If the passages do not answer the question, return no claims.',
        UNTRUSTED_NOTE,
        'Output JSON only: {"claims":[{"text":"","passage":"P1","quote":""}]}',
      ].join('\n'),
      user: `Question: ${question}\n\nPassages:\n${passages.map((p, i) => `[P${i + 1}] ${p.title}${p.page ? ` · p. ${p.page}` : ''}\n${p.text}`).join('\n\n---\n\n')}`,
      maxTokens: 1000,
    })
  } catch {
    raw = {}
  }
  const proposed = Array.isArray(raw.claims) ? raw.claims : []
  const claims: AskClaim[] = []
  for (const c of proposed) {
    const m = /^P?(\d+)$/i.exec(oneLine(c?.passage, 6))
    const p = m ? passages[Number(m[1]) - 1] : undefined
    const text = oneLine(c?.text, 500)
    const quote = oneLine(c?.quote, 500)
    if (!p || !text || norm(quote).length < 12 || !norm(p.text).includes(norm(quote))) continue
    claims.push({ text, quote, title: p.title, url: p.url, ...(p.docId ? { docId: p.docId } : {}), ...(p.page ? { page: p.page } : {}) })
  }
  const answer = claims.length ? claims.map((c, i) => `${c.text.replace(/[.。]$/, '')} [${i + 1}].`).join(' ') : NOT_FOUND
  return { question, answer, claims, retrieved, proposed: proposed.length }
}
