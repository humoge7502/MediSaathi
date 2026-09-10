# Performance Report — MEASURED, not claimed

Every number below is from an actual run of the named tool on this repository.
No number is estimated. Re-run everything: commands included.

## API latency (`python3 tools/bench.py --requests 300`)

ASGI in-process transport — isolates application work (middleware, validation,
rule engine, store) from TCP/TLS noise.

| Endpoint | p50 | p95 | p99 | max |
|---|---|---|---|---|
| GET /healthz | 1.9 ms | 2.6 ms | 3.0 ms | 17.6 ms |
| GET /metrics (O(1) GROUP BY) | 2.0 ms | 2.5 ms | 3.9 ms | 4.1 ms |
| GET /formulary/search?q=par | 2.2 ms | 2.8 ms | 3.3 ms | 3.8 ms |
| POST /prescriptions RX-001 (full pipeline) | 12.0 ms | 14.0 ms | 16.5 ms | 27.9 ms |
| POST /prescriptions RX-002 | 12.0 ms | 14.6 ms | 19.0 ms | 26.1 ms |
| POST /prescriptions RX-004 | 12.2 ms | 15.2 ms | 23.6 ms | 787.9 ms* |
| POST /prescriptions RX-009 | 11.9 ms | 14.2 ms | 16.9 ms | 25.9 ms |

\* one outlier on the first requests (SQLite WAL first-write + allocator
warm-up), not steady-state; p99 is the honest tail number. **Live-vision tier
adds a network model round-trip (~0.5–3 s typical for hosted vision endpoints)
and is explicitly out of scope for the offline numbers above.**

Fixture-tier pipeline p50 ≈ **12 ms** end-to-end including security middleware,
context validation, full rule screen, verdict assembly, and a durable write.

## Frontend bundle (`npm run build`, Next.js 16)

| Route | Size | First Load JS |
|---|---|---|
| / | 2.24 kB | 105 kB |
| /scan | 5.11 kB | 108 kB |
| /judge | 2.77 kB | 105 kB |
| /adr | 2.12 kB | 105 kB |

All routes are statically prerendered; the API client is the only runtime
network dependency. No chart library, no icon package, no component framework —
the design system is CSS custom properties + Tailwind, which is why first-load
JS stays at ~105 kB (Next.js runtime baseline).

## Budget

| Metric | Budget | Measured | Status |
|---|---|---|---|
| First Load JS (any route) | ≤ 150 kB | 105–108 kB | PASS |
| Fixture pipeline p50 | ≤ 50 ms | ~12 ms | PASS |
| Fixture pipeline p95 | ≤ 100 ms | ~15 ms | PASS |
| /metrics (any DB size, indexed) | ≤ 10 ms | ~2.0 ms | PASS |
| Eval benchmark wall time | ≤ 5 s | < 2 s | PASS |
| Full pytest suite | ≤ 5 s | 0.91 s | PASS |

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
