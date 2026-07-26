# CSI Nora k-fold full-stack evaluation

- Generated: `2026-07-26T12:58:35.924270+00:00`
- Base URL: `http://localhost:9090`
- K=5, N=35
- Overall mean pass rate: **100.0%** ± 0.0%
- Suite score (all case attempts): **100.0%** (35/35)
- Fixes applied: ['nginx /chroma/ location: set proxy_http_version 1.1 (Chroma rejected HTTP/1.0 → 400)']

## Stratification

| Category | Count |
|---|---:|
| acl | 2 |
| chat | 3 |
| guardrails | 8 |
| infrastructure | 9 |
| kb_rag | 5 |
| mcp | 1 |
| persistence | 1 |
| threat_model | 3 |
| ui | 3 |

## Per-fold results

| Fold | N | Pass | Fail | Pass rate | p50 ms | p95 ms | Flakes |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 11 | 11 | 0 | 100.0% | 3175 | 14194 | 0 |
| 2 | 9 | 9 | 0 | 100.0% | 2403 | 28807 | 0 |
| 3 | 8 | 8 | 0 | 100.0% | 2402 | 8104 | 0 |
| 4 | 4 | 4 | 0 | 100.0% | 2410 | 15239 | 0 |
| 5 | 3 | 3 | 0 | 100.0% | 2319 | 2476 | 0 |

## Per-category pass rates

| Category | Pass | Total | Rate |
|---|---:|---:|---:|
| acl | 2 | 2 | 100.0% |
| chat | 3 | 3 | 100.0% |
| guardrails | 8 | 8 | 100.0% |
| infrastructure | 9 | 9 | 100.0% |
| kb_rag | 5 | 5 | 100.0% |
| mcp | 1 | 1 | 100.0% |
| persistence | 1 | 1 | 100.0% |
| threat_model | 3 | 3 | 100.0% |
| ui | 3 | 3 | 100.0% |

## Guardrail metrics (labeled injection/benign)

- Precision: 1.0  Recall: 1.0  (tp=3 fp=0 tn=2 fn=0)

## Failures

_None — all cases passed._
## Re-run

```powershell
cd "C:\Users\admin\Downloads\csi-nora-hybridrag\ai-ecosystem-sandbox"; .\.venv\Scripts\python.exe tests\kfold\run_kfold.py --base http://localhost:9090 --k 5
```
