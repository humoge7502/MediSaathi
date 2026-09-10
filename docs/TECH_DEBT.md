# TECH_DEBT.md — honest ledger

Each item: what, why it exists, risk, effort (S/M/L), priority. No invented
debt; every item below was verified by reading the code. Status: OPEN unless
marked.

| ID | Debt | Origin | Risk | Effort | Priority |
|---|---|---|---|---|---|
| TD-1 | No authentication/authorization (read-only demo scope) | event-build scope decision | any public deployment exposes stored states; mitigated by rate limiting + no PII collected | M | P1 (first post-event item per MASTER_PLAN) |
| TD-2 | CSP on the web app keeps `'unsafe-inline'` for scripts | Next.js inline runtime + no-flash theme init | weakens XSS defense-in-depth; no untrusted HTML is rendered anywhere today | S | P2 — move to nonce-based CSP |
| TD-3 | No Playwright E2E; UI gated by tsc + build + manual demo drills | time-boxed event build | UI regressions reach main if no human clicks through | M | P2 |
| TD-4 | axe-core accessibility audit not in CI | conventions followed (landmarks, aria-live, labels, focus-visible, reduced-motion, contrast mode) but unmeasured | possible AA violations we have not caught | S | P2 |
| TD-5 | Seed CSVs are synthetic-curated (provenance recorded) | no licensed dataset at event time | real-world accuracy unbounded until versioned snapshots land | L | P1 (post-event roadmap item 3) |
| TD-6 | `eval/eval.py` imports via `sys.path` hacks instead of an installed eval package | kept eval standalone for the event build | brittle import ordering; works today, CI-verified | S | P3 |
| TD-7 | `verdict_counts()` and metrics are process-local; multi-worker uvicorn gives per-worker counters | single-process demo deployment | `/metrics` under-counts behind `--workers N` | S | P3 (fold into Postgres/Redis swap) |
| TD-8 | Fixture parser regexes accept only the shipped line grammar | fixtures simulate OCR | live tier does not use this parser (schema JSON), so risk is contained to fixtures | S | P3 |
| TD-9 | No request-body size cap on JSON endpoints (uploads are capped at 12 MB) | FastAPI defaults | oversized JSON burns a request slot; rate limiter bounds abuse | S | P3 |
| TD-10 | `nlm_schema_fail_total`-style counters reset on restart | in-memory observability | long-horizon dashboards need a metrics store | S | P3 |

## Resolved during this audit (kept for the record)

| ID | Was | Fix | Test |
|---|---|---|---|
| RES-1 | confirm endpoint re-ran the engine with an **empty context** — declared pregnancy/child context silently dropped after any confirmation | `context` persisted on `PrescriptionState`; confirm re-screens with the original context | `test_confirm_rescreens_with_declared_context` |
| RES-2 | `/metrics` reported a hardcoded `llm_schema_fail_total: 0` | real counter in `vision.py`, incremented on every schema/network failure | `test_metrics_schema_fail_counter_is_real` |
| RES-3 | `/metrics` verdict aggregation O(n) over stored JSON | indexed `verdict_kind` column + `GROUP BY`; in-place migration | `store` tests + bench (`/metrics` ~2 ms) |
| RES-4 | no rate limiting, no security headers, no request IDs on the API | `middleware_security.py` (sliding-window limiter, headers, sane-id propagation) | red-team suite |
| RES-5 | upload trusted declared MIME alone | MIME allow-list + magic-byte sniffing | `test_upload_rejects_non_image_magic_bytes` |
| RES-6 | `SearchList` fetched in render phase (setState-during-render anti-pattern) | moved to `useEffect` with cancellation | tsc + build |
| RES-7 | ADR form's numeric input had no accessible label | `aria-label` added | manual |
| RES-8 | no route-level error boundary or 404 page | `error.tsx` / `not-found.tsx` added | build |
