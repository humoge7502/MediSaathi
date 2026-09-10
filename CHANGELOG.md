# Changelog

All notable changes. Format based on Keep a Changelog; versions here map to
the event build blocks.

## [0.3.2] - 2026-09-10 - integration pass: security + E2E lines united

Unifies the two parallel hardening passes (the 0.3.1 security line and the
uncommitted E2E line) into one tree:

### Added
- **Browser E2E (TD-3 resolution, now merged)** — `apps/web/e2e/product.spec.ts`:
  12 Playwright journeys on the deterministic tier, wired into `make web-e2e`
  and a dedicated CI job.
- **JSON body cap (TD-9 resolution, now merged)** — `apps/api/app/bounded_body.py`:
  1 MiB cap on every non-multipart request (413 envelope; declared
  Content-Length fast path + streaming receive counter), pinned by 3 red-team
  tests. `MEDISAATHI_MAX_BODY_BYTES` documented in `.env.example` and
  docs/DEPLOYMENT.md.
- **CI union** — secret scan, ruff, pip-audit, eval + ablation + demo-check,
  eslint, integration tests, and the Playwright job in one workflow; push
  trigger now covers the actual default branch (`master`).

### Fixed
- **Web middleware rate limiter shared one window across read AND write
  requests** — the Python tier keeps separate `_WRITES`/`_READS` limiters, but
  the TS port keyed one bucket per client, so ~60 combined API calls a minute
  (browser journeys issue many reads) 429'd the next write. Found by the E2E
  dose-guardrail journey failing with HTTP 429; windows are now per
  (class, client), mirroring the FastAPI tier. Pinned by the E2E suite
  (12/12) which fails-first on the old behavior.
- **Makefile recipe indentation** — recipes used spaces, so every target
  failed with "missing separator"; restored tabs and verified `make -n` plus a
  full `make web-check` run.
- Copilot outage kind (`service_unavailable`) now has its own UI badge instead
  of masquerading as a low-confidence refusal (RES-12).
- Eval case E07 replaced with a below-floor BM25 probe so the low-confidence
  refusal fires deterministically (RES-13).

### Verified (this tree, this environment)
- API: **107/107 pytest**, eval (recall 1.00 / agreement 1.00 / refusal
  precision 1.00), ablation, demo-check, ruff clean.
- Web: eslint + tsc clean, 18/18 self-test, 3/3 copilot gates, 14/14
  integration tests, production build, **12/12 Playwright journeys**.

## [0.3.1] - 2026-09-10 - red-team hardening, web test suite, dependency discipline

### Security (all confirmed findings from a second-pass red-team, each pinned by tests)
- **Path traversal in the fixture loader (CWE-22, HIGH)** — `sample_id` was
  joined into a path with no containment check, so
  `sample_id=../../../../../apps/web/tsconfig` read arbitrary `.json` files
  outside the fixture directory. Fixed with a character allow-list plus a
  realpath containment check; blocked ids now return a clean 404 that does
  not echo the attacker-controlled input back. (`test_redteam.py::test_fixture_traversal_*`)
- **Rate-limit bypass via X-Forwarded-For (MEDIUM)** — the API limiter trusted
  a client-supplied XFF unconditionally; rotating the header minted a fresh
  bucket per request. XFF is now honored only behind
  `MEDISAATHI_TRUST_PROXY=1`. (`test_xff_rotation_cannot_mint_fresh_buckets`)
- **Limiter DoS via key flooding (LOW)** — the 10k-key guard cleared ALL
  buckets, so spraying junk keys reset every client's budget. Eviction is now
  approx-LRU (oldest keys evicted, active budgets preserved).
  (`test_limiter_eviction_never_flushes_active_buckets`)
- **Web tier got the API tier's middleware contract**: request-ID correlation +
  per-client sliding-window rate limits on `/api/*` (bounded-memory, LRU
  eviction, same 429 envelope).
- **Caregiver join codes** now come from a CSPRNG (`crypto.getRandomValues`),
  not `Math.random()`; `eventId` inputs are shape-validated before any lookup;
  `caregiverName` length-capped.
- **Store**: per-thread SQLite connections (the shared cross-thread connection
  allowed read/write interleaving on one connection object) + `busy_timeout`.

### Added
- **Web integration test suite** (`bun run test`, 14 tests): route handlers
  exercised end-to-end over an isolated SQLite with the perception layer
  sealed — verify verdicts, plan lifecycle, double-dose guardrail replay,
  family-code shape, metrics. No model keys needed.
- **Web quality gates**: eslint in CI; `make web-check` now runs
  lint + typecheck + selftest + integration tests + build.
- **CI hardening**: least-privilege `permissions`, concurrency cancellation,
  secret scanning (gitleaks), Python lint (ruff), dependency audit (pip-audit),
  PR dependency review.
- **Brand assets**: typographic social-preview/OG image (no stock photos).
- **Accessibility**: skip-to-content link, `aria-live` verdict region,
  `:focus-visible` ring, staggered landing entrance honoring
  `prefers-reduced-motion`.

### Changed
- **Dependency discipline**: web package pruned 827 → 170 installed packages;
  45 unused shadcn/ui components and ~35 unused runtime deps removed
  (dnd-kit, mdxeditor, react-query, next-auth, next-intl, framer-motion,
  sharp, zustand, uuid, date-fns, ...). Package renamed
  `nextjs_tailwind_shadcn_ts` → `medisaathi-web`.
- Stale-response race fixed in Today/Family panels (cancelled-fetch pattern);
  dose actions no longer flash the loading skeleton.
- Python tier: 76 ruff findings resolved (import hygiene, exception chaining
  with `from e`, dead code); `ruff check` added as a CI gate.

### Verified
- API: 104/104 pytest · eval benchmark · ablation · demo-check · bench.
- Web: typecheck · eslint · 18/18 selftest · 14/14 integration · build.

## [0.3.0] - 2026-09-10 - the closed-loop product app

### Added
- **Product app integrated into `apps/web`** (from `vaidya-project.zip`):
  self-contained Next.js 16 fullstack app closing the loop
  verify → schedule → adhere → protect → explain → measure. Deterministic
  TypeScript safety plane (94 brands · 79 interaction rules · 34
  contraindication rules · combination graph rules · aggregate dose caps),
  adherence engine (MPR, streaks, 14-day heatmap), family escalation feed,
  three-gate grounded copilot with citations, 18-case in-app engine
  self-test and 10-case copilot eval, Prisma/SQLite longitudinal schema.
- **Web gates in CI**: bun install, prisma generate, typecheck, 18-case
  engine selftest + copilot gates, production build.
- `scripts/selftest.ts` — deterministic verification gate for the web tier.
- `scripts/start-standalone.mjs` — cwd-independent standalone boot
  (Prisma SQLite path resolution).
- Dockerfile + compose updates for the bun-based web container.

### Fixed
- **Degraded-tier confidence**: the no-LLM fallback queued everything at a
  flat 70%, so the safety plane never demonstrated offline. The plane now
  uses its own formulary-grounded brand-match confidence — warfarin+aspirin,
  triple whammy and contraindication verdicts all fire without any model.
- **Double-dose guardrail**: a second `taken` action silently overwrote the
  log; dose accounting is now first-action-wins (`already_acted` refusal).
- **Guardrail persistence**: the catch-up guardrail claimed a protected skip
  without writing it; the skip is now persisted.
- **Context provenance**: prescriptions store the declared contexts
  (`contextsJson`); plan-start re-screening re-applies them instead of
  silently dropping contraindication checks.
- **Copilot scope gate**: "can I stop taking my medicines" now refuses
  deterministically (patterns added, gate test covers it).

## [0.2.0] - 2026-09-10 - the completed build

### Fixed
- **Parser regression**: extraction regexes in `app/vision.py` used doubled
  backslashes inside raw strings, making dose/frequency/duration parsing a
  silent no-op. Fixed, plus parsing contract tests (`tests/test_vision.py`)
  so it cannot ship silently again.
- Data: "Jan Aushadri" typo, CRLF line endings, duplicate interaction pair,
  orphan molecules that could never normalize (tizanidine, calcium carbonate,
  codeine...), contraindication coverage.

### Added
- Live vision path: OpenAI-compatible schema-constrained call (Gemini/OpenAI/
  Ollama/vLLM), temperature 0, one retry, honest refusals; multipart upload
  endpoint with key-gating (503 without key, 413 over 12 MB, 422 empty).
- Dose-plausibility plane: per-line daily-dose caps, aggregate cross-brand
  caps (two sub-cap paracetamol brands summing over), bizarre-frequency
  detection, long-course review notes - deterministic warnings that ride with
  the report without touching the verdict law.
- SQLite WAL store (thread-safe, restart-safe) replacing the in-memory dict.
- Formulary autocomplete endpoint (`GET /formulary/search`), wired into the
  confirm-queue UI.
- Price savings math: generic brand, per-row and total savings vs Jan Aushadhi.
- NLG per-sentence `AudioSegment`s with slot_refs; web TTS with highlight-
  while-speaking in en/ta/hi.
- Eval v2: frequency recall, latency p50/max, `--ablation A1` raw-read
  counterfactual (A4 verdict agreement 1.00 vs A1 0.17 on the fixture set).
- Judge cache baker (`make bake-judge`) + baked zero-network tier.
- Frontend: full scan flow (samples, camera, upload, context chips), per-field
  confidence UI, confirm queue with autocomplete, interaction/dose cards,
  price table, provenance drawer, ADR form, high-contrast mode, skip link.
- Docker: api + web Dockerfiles, compose with data volume; CI split into
  api/web jobs enforcing all gates.

## [0.1.0] - 2026-08-18 - the scaffold

- Two-plane pipeline (fixture tier), safety engine, verdict gate, NLG,
  12 sealed cases, eval CLI, judge route, Next.js scaffold, docs skeleton.
