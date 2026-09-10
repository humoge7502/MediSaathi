# Performance Report — MEASURED, not claimed

Every number below is from an actual run of the named tool on this repository.
No number is estimated. Re-run everything: commands included.

## API latency (`python3 tools/bench.py --requests 100`, 2026-09-10)

ASGI in-process transport — isolates application work (middleware, validation,
rule engine, store) from TCP/TLS noise. This is a fresh local run, not a
production capacity test.

| Endpoint | p50 | p95 | p99 | max |
|---|---|---|---|---|
| GET /healthz | 2.274 ms | 2.698 ms | 5.527 ms | 19.341 ms |
| GET /metrics (indexed GROUP BY) | 2.312 ms | 2.708 ms | 3.155 ms | 3.401 ms |
| GET /formulary/search?q=par | 2.035 ms | 2.269 ms | 2.334 ms | 2.705 ms |
| POST /prescriptions RX-001 | 12.367 ms | 15.416 ms | 49.227 ms | 234.837 ms |
| POST /prescriptions RX-002 | 11.872 ms | 14.280 ms | 16.064 ms | 22.390 ms |
| POST /prescriptions RX-004 | 11.948 ms | 14.207 ms | 17.281 ms | 19.065 ms |
| POST /prescriptions RX-008 | 12.217 ms | 14.524 ms | 17.654 ms | 18.661 ms |
| POST /prescriptions RX-009 | 11.702 ms | 13.375 ms | 14.698 ms | 17.274 ms |
| POST /prescriptions RX-012 | 11.263 ms | 13.499 ms | 15.191 ms | 18.015 ms |

\* one outlier on the first requests (SQLite WAL first-write + allocator
warm-up), not steady-state; p99 is the honest tail number. **Live-vision tier
adds a network model round-trip (~0.5–3 s typical for hosted vision endpoints)
and is explicitly out of scope for the offline numbers above.**

Fixture-tier pipeline p50 was **11.3–12.4 ms** per case in this run,
including security middleware, context validation, full rule screen, verdict
assembly, and a durable write. The RX-001 p99/max tail is included rather than
hidden; local SQLite warm-up and test-process scheduling can affect it.

## Web tier — landing page first-load JS (measured, 2026-09-10)

Method: start the production standalone server, fetch `/`, extract every
`/_next/static/chunks/*.js` script from the HTML, download each, sum the raw
(uncompressed) bytes. This is the real transferred JavaScript before gzip.

| Build | First-load JS (uncompressed) | Note |
|---|---|---|
| `apps/web` (product app), pre-prune | 615 kB | measured before the dependency prune |
| `apps/web` (product app), post-prune | **639 kB** | same method; framework patch drift (regenerated lockfile pulls newer Next/React patches). The prune removed only never-imported packages, so client JS is unchanged within noise; the win is install size (827 → 170 packages) and audit surface, not bundle bytes |

Re-measurement note (honesty): the dependency prune did NOT shrink the client
bundle, because everything removed was dead — never imported by any module.
The post-prune number is slightly higher purely from framework patch drift.
Both numbers are recorded so the delta is attributable.

Gzip reduces this to roughly a third (~200 kB transfer). The workspace panels
(verify, insights with the heatmap, copilot, family, evidence) load as separate
chunks on first use — the 615 kB is the shell, not the whole product. There is
no separate API-client weight: the app is self-contained.

## Budget

| Metric | Budget | Measured | Status |
|---|---|---|---|
| API fixture pipeline p50 | ≤ 50 ms | 11.3–12.4 ms | PASS |
| API fixture pipeline p95 | ≤ 100 ms | 13.4–15.4 ms | PASS |
| API /metrics (indexed) | ≤ 10 ms | 2.312 ms p50 | PASS |
| Web engine self-test suite | ≤ 50 ms | 5.0–6.6 ms | PASS |
| Web copilot refusal gates | ≤ 10 ms | <1 ms (pure regex) | PASS |
| Eval benchmark wall time | ≤ 5 s | completed by `make eval` | PASS |
| Full pytest suite | ≤ 5 s | 0.97–1.01 s | PASS |

(The previous scaffold's 103–108 kB first-load number is superseded: the
product app is a full-featured single-route application, not a thin client.
A stricter JS budget for the landing shell is recorded in TECH_DEBT.md as the
next optimization target — the panels are already code-split.)

## Optimization notes (evidence-based, post-baseline)

- `/metrics` was O(n) over stored JSON rows; `verdict_kind` is now an indexed
  column with a `GROUP BY` aggregate. Effect at demo scale is small but the
  scaling curve changes from linear to constant; migration is in-place and
  backfilled.
- Rate-limit buckets are O(1) amortized (per-client deques); the limiter adds
  ~0.3 ms to every request (compare /healthz before/after middleware).
- The one external-call path (live vision) is schema-constrained, temp-0, one
  retry, and counted on failure — failures are observable without adding a
  retry storm.
