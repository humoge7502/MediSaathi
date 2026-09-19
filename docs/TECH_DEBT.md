# TECH_DEBT.md — honest ledger

Each item: what, why it exists, risk, effort (S/M/L), priority. No invented
debt; every item below was verified by reading the code. Status: OPEN unless
marked.

| ID | Debt | Origin | Risk | Effort | Priority |
|---|---|---|---|---|---|
| TD-1 | No authentication/authorization (read-only demo scope) | event-build scope decision | any public deployment exposes stored states; mitigated by rate limiting + no PII collected | M | P1 (first post-event item per MASTER_PLAN) |
| TD-5 | Seed CSVs are synthetic-curated (provenance recorded) | no licensed dataset at event time | real-world accuracy unbounded until versioned snapshots land | L | P1 (post-event roadmap item 3) |
| TD-6 | `eval/eval.py` imports via `sys.path` hacks instead of an installed eval package | kept eval standalone for the event build | brittle import ordering; works today, CI-verified | S | P3 |
| TD-7 | `verdict_counts()` and metrics are process-local; multi-worker uvicorn gives per-worker counters | single-process demo deployment | `/metrics` under-counts behind `--workers N` | S | P3 (fold into Postgres/Redis swap) |
| TD-8 | Fixture parser regexes accept only the shipped line grammar | fixtures simulate OCR | live tier does not use this parser (schema JSON), so risk is contained to fixtures | S | P3 |
| TD-10 | `nlm_schema_fail_total`-style counters reset on restart | in-memory observability | long-horizon dashboards need a metrics store | S | P3 |
| TD-11 | Web landing shell first-load JS is ~615 kB uncompressed (panels are already code-split per tab) | single-route product app ships the full shared vendor + shell | slower first paint on weak demo hardware; gzip ≈ 200 kB | M | P2 — next optimization target (audit shared chunk contents, trim unused shadcn primitives, move heavy libs fully behind dynamic chunks) |
| TD-11 | Web/API rate limiter and schema-fail counters are per-process (in-memory) | demo-scale single-process deployment; shared-store swap point documented (`RateLimiter.allow`, Redis) | limits and counters fragment behind multi-worker deployments | S | P3 (fold into Postgres/Redis swap, same as TD-7) |
| TD-12 | Regimen-mode parity corpus: the TypeScript regimen port (`apps/web/src/lib/safety/regimen.ts`) mirrors the Python normative module but no regimen golden corpus pins the two planes together yet (single-Rx parity: 110/110) | the product-tier port shipped with its own test suite first; the corpus is the conformance guarantee | a future divergence between the two regimen implementations would not be caught by CI | M | P2 |
| TD-13 | Regimen corpus is synthetic-curated and its fragile stratum is small (4 cases) | the demo formulary (96 brands) contains few look-alike pairs; similarity neighbourhood derived from that data | the E-H fragile-read evidence is directionally real but too small to support a strong claim on its own | M | P1 (grow with a licensed DDInter/RxNorm snapshot and a curated SALAD table with sources) |

## Resolved during this audit (kept for the record)

| ID | Was | Fix | Test |
|---|---|---|---|
| RES-1 | confirm endpoint re-ran the engine with an **empty context** — declared pregnancy/child context silently dropped after any confirmation | `context` persisted on `PrescriptionState`; confirm re-screens with the original context | `test_confirm_rescreens_with_declared_context` |
| RES-2 | `/metrics` reported a hardcoded `llm_schema_fail_total: 0` | real counter in `vision.py`, incremented on every schema/network failure | `test_metrics_schema_fail_counter_is_real` |
| RES-3 | `/metrics` verdict aggregation O(n) over stored JSON | indexed `verdict_kind` column + `GROUP BY`; in-place migration | `store` tests + bench (`/metrics` ~2 ms) |
| RES-4 | no rate limiting, no security headers, no request IDs on the API | `middleware_security.py` (sliding-window limiter, headers, sane-id propagation) | red-team suite |
| RES-5 | upload trusted declared MIME alone and buffered the full multipart body | MIME allow-list + bounded read + signature/MIME agreement + recognized HEIF brands | upload boundary regressions in `test_redteam.py` |
| RES-6 | `SearchList` fetched in render phase (setState-during-render anti-pattern) | moved to `useEffect` with cancellation | tsc + build |
| RES-7 | ADR form's numeric input had no accessible label | `aria-label` added | manual |
| RES-8 | no route-level error boundary or 404 page | `error.tsx` / `not-found.tsx` added | build |
| RES-9 | web degraded tier queued everything at a flat 70% confidence (no-LLM tier could not demonstrate the safety plane) | the plane uses its own formulary-grounded brand confidence when the deterministic splitter ran | live HTTP smoke: warfarin+aspirin → interaction, triple whammy → combination, child+doxy → contraindication, garbage → confirm queue |
| RES-10 | dose "taken" could be re-logged (double tap/replay overwrote the record) and the catch-up guardrail claimed a skip it never persisted | first-action-wins accounting (`already_acted`) + guarded skip persisted to the DB | live HTTP smoke + audit trail |
| RES-11 | plan-start re-ran the safety plane with an empty context, dropping contraindication screening | declared contexts persisted on the Prescription (`contextsJson`) and re-applied at plan start | live HTTP smoke with `age_under_12` |
| RES-12 | copilot outage mislabeled as "low retrieval confidence" in the UI badge | distinct `service_unavailable` kind with its own badge and styling | typecheck + E2E copilot suite |
| RES-13 | eval case E07 (IPL question) false-matched BM25 on "last/final" and could not deterministically test the low-confidence refusal | replaced with a below-floor probe ("capital of France") so the refusal fires before any model call | E2E copilot out-of-knowledge test |
| ~~TD-2~~ | CSP kept `'unsafe-inline'` for scripts | middleware (`src/middleware.ts`) mints a per-request nonce and serves `script-src 'self' 'nonce-…' 'strict-dynamic'` on document routes; `layout.tsx` opts into dynamic rendering (`connection()`) so Next stamps every runtime script with the nonce (verified: 11/11 scripts nonced in served HTML). Styles keep `'unsafe-inline'` (Next inline styles; no untrusted HTML rendered). Tradeoff: document routes are SSR per request. The standalone launcher also anchors relative `file:` DATABASE_URLs (was a live 500 in the boot path) | 4 new middleware contract tests + live curl verification |
| ~~TD-3~~ | No Playwright E2E | `apps/web/e2e/product.spec.ts` — 14 browser journeys on the deterministic tier, wired into `make web-e2e` + CI | 17/17 green (incl. a11y spec) |
| ~~TD-4~~ | axe-core accessibility audit not in CI | `e2e/accessibility.spec.ts` runs axe-core (wcag2a/2aa/21a/21aa) on the landing page, workspace and Evidence tab inside `make web-e2e`; serious/critical violations fail the gate. First run caught and fixed 3 real contrast violations (dark-band eyebrow, clay CTA 3.79:1, decorative Rx watermark) and 1 non-focusable scroll region | 3 axe scans green; 17/17 E2E |
| ~~TD-9~~ | No request-body size cap on JSON endpoints | `app/bounded_body.py` caps every non-multipart body at 1 MiB (413 envelope) | 3 red-team tests |
| ~~TD-12~~ (product tier) | Regimen plane (mechanisms A+B) existed only in Python; the web tier never screened against the active regimen | `src/lib/safety/regimen.ts` ports the law 1:1 (identity distributions, confusion neighbourhoods, pruned world enumeration, fragility→queue coupling with the could-hide-harm guard); verify + queue-resolve apply it through ONE shared function (`applyRegimenEscalation`); escalations ride the persisted confirm queue (fieldIndex 0, human resolution = the E-G reviewed arm); refills (same brand re-verified) do not escalate. Remaining sub-item moved to open TD-12 (parity corpus) | 18 unit tests (`tests/regimen.test.ts`) + 4 route tests (`tests/regimen-route.test.ts`) + 17/17 E2E |
| ~~TD-14~~ | Regimen mode read a caller-supplied list, not the persisted plan rows | `src/lib/regimen-state.ts` reads the active `TherapyPlan`/`Medication` rows server-side (never caller-supplied), derives start days from the first scheduled dose and filters expired windows | covered by regimen-route tests |
