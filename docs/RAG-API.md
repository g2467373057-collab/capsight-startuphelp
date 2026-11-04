# RAG API contract (for the knowledge base service)

startup-help-agent calls the knowledge base for judgment points **JP1–JP3**. The service is built separately; set its address in `server/keys.env`:

```
RAG_URL=http://localhost:8000      # no trailing slash
RAG_API_KEY=optional-shared-secret # sent as "Authorization: Bearer …" when set
RAG_TOP_K=5                        # passages per question (default 5)
RAG_TIMEOUT_MS=20000
```

If `RAG_URL` is empty, the report still runs and JP1–JP3 say "knowledge base not connected".

## Request

`POST {RAG_URL}/retrieve`

```json
{
  "question": "regulations that apply to SME recruitment platforms in Singapore",
  "judgment_point": "JP2",
  "geography": "Singapore",
  "sector": "HR tech",
  "top_k": 5
}
```

| field | meaning |
| --- | --- |
| question | English search question written by the agent (2 per judgment point) |
| judgment_point | `JP1` market size & growth · `JP2` policies & regulations · `JP3` government grants & support. Use it to filter by the tag on each admitted document. |
| geography, sector | from the founder's idea; use for filtering or ranking if helpful |
| top_k | maximum passages to return |

## Response

```json
{
  "passages": [
    {
      "text": "Organisations must obtain consent before collecting, using or disclosing personal data…",
      "title": "PDPA Overview",
      "issuer": "Personal Data Protection Commission",
      "date": "2021-02-01",
      "url": "https://www.pdpc.gov.sg/overview-of-pdpa/the-legislation/personal-data-protection-act",
      "doc_id": "SRC012",
      "chunk_id": "SRC012#4",
      "score": 0.82
    }
  ]
}
```

| field | required | notes |
| --- | --- | --- |
| text | yes | the passage exactly as in the source document (the agent checks quotes against it word for word) |
| title | yes | document title |
| url | yes | original http(s) link |
| issuer | recommended | issuing body, shown next to the claim |
| date | recommended | publication or effective date, `YYYY-MM-DD`, `YYYY-MM` or `YYYY`. **JP2 needs a dated source to count as enough evidence.** |
| doc_id, chunk_id | recommended | IDs from the KM intake register, for tracing |
| score | optional | similarity score |

Passages without text, title or an http(s) url are ignored. Return `{"passages": []}` when nothing relevant is found; never return made-up text.

## What the agent does with passages

1. Writes up to 4 claims per judgment point, each citing one passage and a verbatim quote.
2. Code keeps a claim only if the quote really appears in the passage text.
3. Status: **enough** (≥1 verified claim; JP2 also needs a dated source) · **partial** · **missing** (fixed wording from the judgment-point table).
