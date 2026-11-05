# Performance Report — MEASURED, not claimed

Every number below is from an actual run of the named tool on this repository.
No number is estimated. Re-run everything: commands included.

## API latency under three transports (`python tools/bench.py --requests 400 --transport all`, 2026-10-27) — TD-25 closed

Same build, same machine, nothing else running, 10 warmup requests per endpoint.
The tool now measures the **same nine endpoints** through three different harness
calls, because TD-25 turned out to be a question about which side of a line the
time moved to and one column cannot answer that:

- **asgi** — `httpx.AsyncClient` + `ASGITransport`: the app object is awaited
  directly in this event loop. No socket, no thread hop. This is application work.
- **live** — uvicorn on a loopback port, real HTTP/1.1 over TCP. This is what a
  deployed client actually pays.
- **testclient** — starlette's `TestClient`, the harness every recorded number in
  this file up to today was measured with. It runs the app through an **anyio
  blocking portal per request**.

| Endpoint | asgi p50 | live p50 | TestClient p50 | asgi p95 | live p95 | TestClient p95 |
|---|---|---|---|---|---|---|
| GET /healthz | **1.984 ms** | 8.257 ms | 9.439 ms | 2.697 | 10.586 | 13.497 |
| GET /metrics (indexed GROUP BY) | 4.443 ms | 9.517 ms | 18.534 ms | 5.522 | 11.081 | 49.740 |
| GET /formulary/search?q=par | 4.681 ms | 9.721 ms | 13.597 ms | 5.745 | 11.762 | 23.558 |
| POST /prescriptions RX-001 | 11.809 ms | 16.100 ms | 54.667 ms | 14.256 | 36.469 | 92.451 |
| POST /prescriptions RX-002 | 12.039 ms | 17.748 ms | 52.762 ms | 14.878 | 22.773 | 90.421 |
| POST /prescriptions RX-004 | 11.818 ms | 21.390 ms | 54.689 ms | 14.654 | 36.684 | 108.468 |
| POST /prescriptions RX-008 | 11.858 ms | 20.711 ms | 62.411 ms | 14.315 | 30.834 | 137.874 |
| POST /prescriptions RX-009 | 9.903 ms | 17.213 ms | 60.289 ms | 11.432 | 23.598 | 133.671 |
| POST /prescriptions RX-012 | 7.510 ms | 14.849 ms | 42.568 ms | 11.118 | 20.304 | 273.309 |

**The regression was in the harness.** `/healthz` costs **1.984 ms** of
application work and **8.257 ms** over a socket; through `TestClient` it costs
**9.439 ms**, so the portal hop is ~7.5 ms on an endpoint that does nothing else.
The fixture pipeline reads **7.5–12.0 ms** in-process — the same band the
2026-09-10 run recorded as 11.3–12.4 ms — and **42.6–62.4 ms** through the
harness, which is where the October table's 56.0–59.4 ms comes from. The October
run was not wrong; it was measuring a per-request portal that the deployed server
never builds.

**What to quote.** The **live** column: a real client pays the socket, so
pipeline p50 **14.8–21.4 ms** and p95 **20.3–36.7 ms** is the deployment number,
inside the ≤ 50 ms budget. The asgi column is the one to compare across code
changes, because it moves only when the application moves.

**Residual, stated rather than smoothed over.** September's *TestClient* run read
2.274 ms on `/healthz`, i.e. the same harness that costs 9.4 ms today cost ~0.2 ms
then, and `apps/api/requirements.txt` is unchanged between those dates. That
difference is not explained by this pass; what is established is that the current
app costs 1.98 ms in-process and that the October pipeline figure is harness
overhead. One live-tail number is kept visible: RX-001 p99 **154.2 ms** / max
188.1 ms, consistent with a SQLite WAL checkpoint landing inside the timed
window — the September run called the same shape "an outlier on the first
requests" and this run had warmup, so it is recorded as a tail to chase, not as
noise already explained.

## Did the framework upgrade move the number? A/B with a framework-free floor (2026-10-28)

The dependency pass took `fastapi 0.136.3 → 0.162.0` (26 minor versions) and
`uvicorn 0.51.0 → 0.54.0`, with `starlette` pinned at `1.10.0` on both sides so
the middleware contract is held constant. Answering "did that make us slower?"
needed three method changes to `tools/bench.py` first, each of which was itself a
measurement bug:

- **`--out FILE`** — the app logs JSON lines on **stdout** (`apps/api/app/obs.py`),
  so `python tools/bench.py … > run.json` wrote a log file with a JSON payload
  buried in it. Parsing one required string-splicing. The flag makes the tool own
  the file.
- **a bare ASGI-3 probe (`GET /noop`)** — `/healthz` is a poor noise floor because
  it runs through the exact stack an upgrade replaces: routing, the
  `BaseHTTPMiddleware` chain, the response-model serializer. So the harness now
  times `_noop`, a raw `async def(scope, receive, send)` that answers the lifespan
  handshake and returns `ok`, **next to each transport** rather than once. That
  gives three numbers instead of one: `noop` = machine + event loop,
  `healthz − noop` = **the framework's own cost — the quantity an upgrade is
  supposed to move**, `pipeline − healthz` = application work.
- **`--fresh-db`** — every timed pipeline request *inserts a row*, and the store is
  read at 60k+ rows in this working tree, so a benchmark was measuring its own
  accumulation (and `verdict_counts()` — see the `/metrics` finding below). The
  flag points `MEDISAATHI_DB_PATH` at a throwaway temp database *before* the app
  is imported (`app/store.py` reads the env var at import time, which is why the
  app import became lazy), and the payload now records `store`: path, env,
  `rows_at_start`, `rows_at_end`, `bytes_at_end` and the resolved
  fastapi/starlette/uvicorn/httpx/python versions. Provenance, not a footnote: a
  number without a row count is not comparable to anything.

Commands (run alternately, old pins in `.venv-oldpins`, new in `.venv`, same
interpreter 3.13.6, same machine, `n=400`, 10 warmup/endpoint, empty store):

```
.venv-oldpins/Scripts/python.exe tools/bench.py --requests 400 --transport asgi --fresh-db --out bench-old-1.json
.venv/Scripts/python.exe        tools/bench.py --requests 400 --transport asgi --fresh-db --out bench-new-1.json
```

| run | pins | `noop` p50 | `/healthz` p50 | **framework stack** | `/metrics` p50 | pipeline − healthz (p50 band over 6 fixtures) |
|---|---|---|---|---|---|---|
| old-1 | 0.136.3 / 0.51.0 | 1.209 | 3.109 | **1.900 ms** | 3.171 | 7.73–11.26 |
| old-2 | 0.136.3 / 0.51.0 | 1.066 | 3.072 | **2.006 ms** | 3.609 | 8.64–14.10 |
| old-3 | 0.136.3 / 0.51.0 | 1.757 | 4.479 | **2.722 ms** | 7.005 | 8.38–16.95 |
| new-1 | 0.162.0 / 0.54.0 | 0.795 | 2.389 | **1.594 ms** | 3.213 | 8.90–13.99 |
| new-2 | 0.162.0 / 0.54.0 | 0.983 | 4.540 | **3.557 ms** | 4.406 | 9.40–18.21 |
| new-3 | 0.162.0 / 0.54.0 | 0.862 | 3.537 | **2.675 ms** | 3.747 | 8.50–41.85 |

**Verdict: the upgrade is not a latency event, and this machine cannot resolve
one if it is.** The framework-stack band is old `[1.900, 2.722]` vs new
`[1.594, 3.557]` — overlapping, with the new side's *worst* run (3.557) above the
old side's worst and its *best* run (1.594) below the old side's best. The
pipeline-above-healthz bands likewise overlap (`7.73–16.95` vs `8.50–41.85`).
The reason is visible in the bare row: a framework-free `noop` handler — no
routing, no middleware, no Pydantic — ranged **0.670–1.757 ms p50 across the ten
runs** on this machine. That spread is 2.6x and contains no application code at
all, so any per-request difference smaller than ~1 ms is below the resolution of
this harness, and quoting the new side as "up to 1.1 ms faster" (new bare p50
0.795–0.983 vs old 1.066–1.757) would be reading machine noise as a result. The
honest claim is: **no regression detectable at this scale, one upgrade, n=400 x 3
runs per side.** `new-3` RX-004 p50 45.4 ms / max 954.3 ms is the same
checkpoint-shaped stall as TD-26, on the same machine, in the middle of a run —
which is more evidence that the tail is real and not a first-request artefact.

### `/metrics` is O(rows). Every earlier claim of "constant" was wrong.

`apps/api/app/store.py` documented `verdict_counts()` as an "O(1) aggregate over
the indexed column", and the optimization note below this section repeated it. An
index makes a `GROUP BY` cheap per row; it does not make it skip rows — SQLite
walks every `verdict_kind` index entry to count them. Alternating probe
(`n=150`, asgi, same process order, empty temp store vs the 56k–60k-row
development store):

| run | rows at start | `/metrics` p50 | p95 | `/healthz` p50 | `noop` p50 |
|---|---|---|---|---|---|
| empty-1 | 0 | **2.993 ms** | 4.984 | 2.412 | 0.866 |
| empty-2 | 0 | **2.355 ms** | 3.075 | 2.280 | 0.670 |
| empty-3 | 0 | **2.227 ms** | 2.974 | 2.269 | 0.767 |
| big-1 | 56 446 | **9.412 ms** | 11.696 | 3.169 | 0.866 |
| big-2 | 59 092 | **12.909 ms** | 18.546 | 2.324 | 0.789 |
| big-3 | 60 286 | **5.756 ms** | 6.635 | 2.228 | 0.745 |

Two facts, stated precisely. (1) The separation is clean and endpoint-specific:
the slowest empty-store `/metrics` (2.993) is below the fastest 56k-row one
(5.756), while `/healthz` (`2.269–3.169`) and the bare `noop` (`0.670–0.866`)
overlap completely across the two groups — so the row count moves `/metrics` and
nothing else. (2) It is **not** a tidy linear curve: 60 286 rows read 5.756 ms
while 56 446 read 9.412 ms, i.e. index-cache temperature and OS page state
dominate within this range. What is established is the scaling class (grows with
rows) and the budget consequence: the ≤ 10 ms line passes at demo scale and
**breaks at p50 9.4–12.9 with p95 up to 18.5 on a store this repository's own
demo seeding produces in a day**. Recorded as TD-29, and fixed in the same pass —
see the next subsection.

Related correction: the 2026-10-27 three-transport table above quotes `/metrics`
at 4.443 ms in-process — taken on a smaller store. Absolute `/metrics` numbers
from before this pass are not comparable, and any future comparison must quote
`store.rows_at_start` with it.

### Fixed the same day: `/metrics` no longer reads the rows

`store.verdict_counts()` now returns counts from a `verdict_tally` table that
`put()` maintains in the same write transaction — one indexed primary-key lookup
per write replaces a full index walk per read. Old databases seed the tally with
one scan on first open, recorded in `store_meta.tally_seeded` so the scan cannot
become a per-connection habit. Re-measured with the same probe (`n=150`, asgi):

| run | store | rows start → end | `/metrics` p50 | p95 | p99 | `/healthz` p50 | `noop` p50 |
|---|---|---|---|---|---|---|---|
| tally-empty-1 | temp | 0 → 960 | 2.483 ms | 3.376 | 3.915 | 2.185 | 0.694 |
| tally-empty-2 | temp | 0 → 960 | 2.638 ms | 3.978 | 4.629 | 2.358 | 1.235 |
| tally-big-1 | dev copy | 63 166 → 64 126 | **2.093 ms** | 2.903 | 3.108 | 1.875 | 0.650 |
| tally-big-2 | dev copy | 64 126 → 65 086 | **2.562 ms** | 3.314 | 3.633 | 2.632 | 0.615 |

The row-count dependence is gone: the 63k–65k-store readings (2.093 / 2.562) sit
*inside* the empty-store band (2.483 / 2.638), where pre-fix they had been
5.756–12.909 with p99 up to 21.270. Read in isolation at 61 246 rows, the tally
answer costs **0.009–0.023 ms** against **2.648–2.744 ms** for the same-result
`GROUP BY` on a warm cache — and `E-F`'s own table now shows `/metrics` p50
2.582 ms against `/healthz` 2.666 ms, i.e. the aggregate endpoint costs what a
do-nothing endpoint costs.

The write path paid for it, and that cost is below this machine's resolution:
RX-001 p50 is **13.57–13.69 ms** on the 63k–65k store post-fix against
15.08–19.15 ms on an empty store pre-fix, so the honest claim is *no measurable
write-path regression, bounded by the same ~1 ms floor as the A/B above* — not a
speedup. `store.count()` is still a `COUNT(*)` over the table; measured best-of-50
at 65 086 rows it costs **0.017 ms**, so it is not the term that was breaking the
budget and it stays a scan.

Corrected claims: the optimization note below this section, the `verdict_counts()`
docstring, the module docstring, and `MEDISAATHI_ENGINEERING_REPORT.md` all said
"O(1)" about the scan. `count()` remains O(rows); the endpoint no longer is.
Tested by `apps/api/tests/test_verdict_tally.py`: the tally equals the row scan
after plain writes, after an upsert that *replaces* a verdict (the case a naive
increment gets wrong), after an idempotent re-put, and after a verdict is cleared;
a pre-tally database seeds correctly and seeds only once; and an
`EXPLAIN QUERY PLAN` guard on the production statement fails if the read ever
reaches the `prescriptions` table again. Nothing asserts milliseconds — on this
machine that would fail for the wrong reason.

## API latency (`python tools/bench.py`, 2026-10-26, n=400 per endpoint) — superseded: this is the TestClient column above

Same in-process ASGI transport, same tool, one machine, nothing else running. This
is the current number; the September run below it is kept because the delta is the
finding.

| Endpoint | p50 | p95 | p99 | max |
|---|---|---|---|---|
| GET /healthz | 11.524 ms | 19.834 ms | 22.713 ms | 148.663 ms |
| GET /metrics (indexed GROUP BY) | 19.347 ms | 31.277 ms | 36.507 ms | 77.957 ms |
| GET /formulary/search?q=par | 15.906 ms | 25.098 ms | 27.673 ms | 32.431 ms |
| POST /prescriptions RX-001 (full pipeline) | 59.361 ms | 74.074 ms | 86.256 ms | 234.563 ms |
| POST /prescriptions RX-002 (full pipeline) | 58.484 ms | 73.111 ms | 93.675 ms | 130.360 ms |
| POST /prescriptions RX-004 (full pipeline) | 56.969 ms | 69.524 ms | 77.230 ms | 130.464 ms |
| POST /prescriptions RX-008 (full pipeline) | 56.487 ms | 71.630 ms | 114.210 ms | 259.301 ms |
| POST /prescriptions RX-009 (full pipeline) | 56.027 ms | 67.020 ms | 78.985 ms | 169.098 ms |
| POST /prescriptions RX-012 (full pipeline) | 36.318 ms | 44.956 ms | 51.657 ms | 68.528 ms |

**What this said at the time, and what it actually measured.** The fixture
pipeline p50 appeared to go **11.3–12.4 ms → 56.0–59.4 ms**, breaking the ≤ 50 ms
budget, with `/healthz` at 11.5 ms doing no rule work at all — so the cost was
correctly placed in the request path rather than in the safety law (E-F measures a
whole verification at **0.451 ms p50 / 2.978 ms p95** over 300 cases). The step
that was missing was a transport dimension: this run and the September run were
both taken through starlette's `TestClient`, and the three-transport table above
shows that the portal, not the pipeline, accounts for most of the gap. Recorded
as TD-25 at the time; closed by the 2026-10-27 run. A probe that stripped every
logging handler from the process had already moved `/healthz` p50 by less than
run-to-run noise (10.1 ms with handlers, 11.9 ms without), which was the first
hint the cost was not in the app's own work.

## API latency (`python3 tools/bench.py --requests 100`, 2026-09-10) — superseded, kept for the delta

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
| `apps/web`, post nonce-CSP + regimen escalation (measured 2026-09-12) | **654.8 kB / 9 chunks** | same method. The regimen plane is server-side only (zero client bytes); the delta is framework patch drift + the axe-driven a11y fixes. Dynamic rendering (required by the nonce CSP) changes *when* the HTML is built, not how much JS the browser downloads |

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
| API fixture pipeline p50 | ≤ 50 ms | **14.8–21.4 ms** over loopback HTTP, 7.5–12.0 ms in-process (2026-10-27; the 2026-10-26 reading of 56.0–59.4 ms was `TestClient` portal overhead — TD-25 closed) | **PASS** on both columns |
| API fixture pipeline p95 | ≤ 100 ms | 20.3–36.7 ms live / 11.1–14.9 ms in-process | PASS |
| Safety law inside one verification | ≤ 10 ms p50 | 0.451 ms p50 / 2.978 ms p95 (E-F, n=300) | PASS — the rule law is not the cost |
| API /metrics (verdict aggregate) | ≤ 10 ms | **2.09–2.64 ms** p50 / 2.90–3.98 ms p95, identical on an empty store and a 63k–65k-row store (in-process, 2026-10-28) | **PASS** — was 5.8–12.9 ms p50 / up to 21.3 ms p99 at 56k–60k rows when the read scanned the rows (TD-29, closed by RES-31) |
| Framework stack per request (`/healthz` − bare `noop`) | reported, not budgeted | **1.594–3.557 ms** (fastapi 0.162.0 / uvicorn 0.54.0, fresh store, n=400 x 3) | the number an upgrade moves; old pins measured 1.900–2.722 — overlapping, so no regression is detectable |
| Machine floor (bare ASGI-3 `noop`, no framework) | reported, not budgeted | **0.670–1.757 ms** p50 | 2.6x spread with zero application code — this is the resolution limit of the harness |
| Transport floor (/healthz socket hop) | reported, not budgeted | **6.273 ms** p50 (asgi 1.984 → live 8.257) | the number to subtract when quoting a socket table |
| Web engine self-test suite | ≤ 50 ms | 5.0–6.6 ms | PASS |
| Web copilot refusal gates | ≤ 10 ms | <1 ms (pure regex) | PASS |
| Eval benchmark wall time | ≤ 5 s | `make eval` completes well inside it (n=111, offline) | PASS |
| Full pytest suite | ≤ 60 s | **25.5–30.4 s for 466 tests** (three runs 2026-10-28: 25.45 s, 26.84 s, 30.36 s). The 58.4 s recorded here for a 462-test suite did not reproduce on three quiet runs — same lesson as `docs/TESTING.md`: wall time on this machine is a band, and a band measured under load is not a property of the suite | reported, not redefined |

(The previous scaffold's 103–108 kB first-load number is superseded: the
product app is a full-featured single-route application, not a thin client.
A stricter JS budget for the landing shell is recorded in TECH_DEBT.md as the
next optimization target — the panels are already code-split.)

## Optimization notes (evidence-based, post-baseline)

- `/metrics` was O(n) over stored JSON rows; `verdict_kind` is now an indexed
  column with a `GROUP BY` aggregate. **Correction (2026-10-28, measured above):
  this note claimed the scaling curve changed "from linear to constant" and it
  did not** — the index removed JSON parsing per row, not the per-row walk, so
  the aggregate stayed O(rows): 5.8–12.9 ms p50 at 56k–60k rows against 2.2–3.0 ms
  on an empty store. Fixed in the same pass by a `verdict_tally` table maintained
  transactionally on write (RES-31); the read is now 2.09–2.64 ms p50 regardless
  of store size. Migration is in-place and backfilled.
- Rate-limit buckets are O(1) amortized (per-client deques); the limiter adds
  ~0.3 ms to every request (compare /healthz before/after middleware).
- The one external-call path (live vision) is schema-constrained, temp-0, one
  retry, and counted on failure — failures are observable without adding a
  retry storm.
