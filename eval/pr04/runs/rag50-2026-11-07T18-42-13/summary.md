# PR04 RAG test · 2026-11-07T18-42-13

Tag: In-vitro (official documents, questions written by the team). n = 50. top-k = 6. Model: deepseek-flash.

| automatic measure | result |
|---|---|
| Retrieval returned an expected source document (hit@k) | 49/50 (98%) |
| Verified answer cites an expected source document | 43/50 (86%) |
| Answered with ≥1 verified claim | 46/50 (92%) |
| Claims dropped by the quote gate | 16 of 213 proposed |

| AI pre-score (NOT the result; a person confirms every row) | Acceptable 10 · Partial 30 · Reject 10 |

Not yet measured: answer correctness (Acceptable / Partial / Reject) — scored by a person in PR04_50_RAG_Question_Bank (filled copy in this folder). F1 needs ≥85% correct and 0 fabricated sources.
