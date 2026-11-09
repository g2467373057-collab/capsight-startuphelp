# PR02 KM Gate evidence (document admission, Seah Yee Hong)

How the 40 documents in the Capsight knowledge base were found, audited and admitted.

| File | What it is |
|---|---|
| `KM Gate Run1_Audit.xlsx` … `KM Gate Run4_Audit.xlsx` | Four audit runs over the candidate documents; Run 4 is the admission decision the system uses. |
| `SaaS Knowledge Taxonomy_precheck.xlsx / .pdf` | The register before the identity check. |
| `SaaS Knowledge Taxonomy Register_Audited.xlsx` | The register after the identity check of 8 Nov 2026 (sheet `Registry_Check`). |
| `SaaS Knowledge Taxonomy - Checked Registry.pdf` | The same check, printable. |

Result of the 8 Nov check: all 40 IDs unique, all 40 PDFs located, all 40 URLs equal the Run 4 audit URLs. Four metadata cells were corrected (T10 and I06 file names, T10 page count 6 → 9, I06 type → statistical table). No PDF was renamed or replaced, so the knowledge-base index did not need rebuilding.

The system reads its own copy of the admitted list from `rag-service/data/register.csv` (title, issuer, date, URL, judgment point, admitted, ceased status). The PDFs themselves are not in this repository; each register row links to the official source.
