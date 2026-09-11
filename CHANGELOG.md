# Changelog

All notable changes. Format based on Keep a Changelog; versions here map to
the event build blocks.

## [0.6.0] - 2026-09-11 - patent-readiness evidence spine (MED-001..MED-028)

Turns the engineering into *reproducible* evidence. The organising law: no
number is quoted anywhere without an archived run manifest behind it.

### Added — evidence spine
- **`ml/`** research package: corpus loader/splits/strata, the A0-A4 baseline
  ladder + A4 ablations, calibration (ECE / Brier / reliability curves /
  threshold sweep / operating-point selection), the corruption+injection+
  confusable+replay robustness suite, the HITL simulation, sha256 dataset
  manifests and the run-manifest writer.
- **`tools/run_experiments.py`** — one command runs E-A..E-G and archives
  `eval/runs/<id>/{manifest,metrics,cases}` (config, dataset SHAs, engine
  commit, environment). Writes `eval/results/RESULTS.md`.
- **`tools/build_binder.py`** (MED-020) — compiles the run archive into
  `docs/patent/EVIDENCE_BINDER.md` + `eval/results/binder.json`, including the
  negative results.
- **`tools/export_evidence.py`** (MED-013) — compiles the archive into the
  Evidence-tab artifact, labelled with its snapshot/commit and honest limits.
- **`tools/import_snapshot.py`** (MED-027) — governed knowledge-snapshot
  import: schema validation, sha256, diff report, explicit `--apply`.
- **`data/corpus/`** (MED-005/006) — 300-case adjudicated corpus with a
  70/15/15 stratified split, annotation codebook and sha256 manifest.

### Added — product surfaces
- **Pharmacist review console** (MED-012) — a Review tab over the persisted
  confirm queue: band/fused/why per queued field, confirm/correct/reject with
  actor + reason, per-prescription audit trail, and the plan-block state.
- **Evidence tab v2** (MED-013/014) — renders the archived baseline ladder,
  ablations, calibration reliability curve, frozen operating point, parity and
  latency, with run provenance and explicit honesty notes. Verify now shows the
  band, fused score and why-queued explanation per queued field.
- **FHIR R4 export mapping** (MED-028) — `GET /prescriptions/{id}/fhir` returns
  a MedicationRequest collection Bundle **only for verified prescriptions**; a
  queued or refused prescription exports 409, because an unverified read must
  never be laundered into a clinical record.
- **Consent-artifact stub** (MED-025) — ABDM-vocabulary consent records
  (pseudonymous ref only, expiring, fail-closed on revoke/expiry). Explicitly a
  stub, not a live ABDM gateway.
- **Multilingual NLG coverage tests** (MED-026) — the slot-traceability law is
  now asserted across en/ta/hi, including “no unformatted placeholder survives”.

### Added — documentation
- **`docs/patent/`** — invention disclosure (MED-021), claim-concept pack +
  strength matrix (MED-022), normative pseudocode of the gate/fusion/precedence/
  queue laws, experiment protocol + results, prior-art matrix, and the generated
  binder.
- **Disclosure pause** (MED-001) in `CONTRIBUTING.md` + `docs/patent/README.md`:
  the repository is public, so post-push mechanism detail is a public disclosure.

### Changed — cross-engine parity (MED-015)
- The golden corpus moved from a 25-case in-code copy per language to **one
  shared, versioned file** (`eval/parity/golden.json`), expanded to **110 cases**;
  both planes read the identical bytes, so corpus drift is impossible by
  construction.
- **Three real drifts found and fixed by the expansion:** the TS formulary mapped
  `Hydroquin 200` to hydrochlorothiazide where the source-of-truth CSV says
  hydroxychloroquine (so a QT/pairwise rule silently did not fire on that tier);
  three formulary rows (`Zental`, `Monocef 1g`, `Digoxin Tab`) and three
  contraindication rows present in the Python data were missing from the TS
  dataset.

### Fixed
- `ml.manifest.git_sha()` passed `--short` without a revision, so every run
  manifest recorded `engine_git_sha: "unknown"`.
- The E-C corruption ladder no longer perturbs perception confidence when
  injecting instruction text: labels are confidence-derived, so moving
  confidence invalidated the label. Boundary sensitivity is instead measured and
  reported as its own diagnostic (`confidence_boundary_sensitivity`).
- `ml.hitl` raw arm reported 0 coverage while auto-accepting everything, and the
  acceptance test used `>` where equality was the honest comparison.

### Verified (this tree)
API: **179/179 pytest**, ruff clean, eval + eval regression gate, parity
110/110 both engines, demo-check PASS. Web: eslint + tsc clean, 18/18 selftest,
110/110 parity, 68/68 integration tests, production build, **14/14 Playwright**.
Experiments: E-A..E-G archived with manifests; E-A A4 agreement 1.000 / unsafe
0.000 on the frozen test split vs A1 0.705 / 0.295.

## [0.5.0] - 2026-09-11 - observability + property-based safety proofs

Two engineering-depth additions, both dependency-free and both *proven* by
tests rather than claimed:

### Added
- **Observability stack (API tier, zero deps)** — `app/obs.py`:
  · structured JSON-lines logging (one machine-parseable object per request:
  ts/level/route/method/status/latency_ms/request_id; unwhitelisted fields
  can never leak into the stream),
  · `GET /slo` — per-endpoint p50/p95/p99/max from bounded per-route rings
  (512 obs each; memory O(routes), never O(traffic)),
  · `GET /metrics.prometheus` — Prometheus/OpenMetrics text exposition of the
  existing counters + latency summary with correct HELP/TYPE and label
  escaping. Pinned by 8 tests: format parses, counts match /metrics, labels
  escape correctly.
- **Property-based safety proofs (hypothesis)** — `tests/test_properties.py`:
  ~900 generated prescriptions must uphold the five product invariants:
  P1 totality (never crash; verdict stays in the shared vocabulary),
  P2 gate integrity (low-confidence fields are queued and never feed
  findings), P3 symmetry (screen(a,b) ≡ screen(b,a)), P4 dose caps (the
  aggregate paracetamol cap fires iff the summed daily mg exceeds it —
  combination molecules like Combiflam legitimately trip other molecules'
  caps), P5 monotonicity (raising perception confidence can never produce a
  refusal). The deterministic core is the right place for property testing:
  a single counterexample is a real bug class, not a flake.
- **Retry/backoff on the live vision call** — exponential backoff between
  attempts (0.5s → 1s → …, env-capped), attempt count env-tunable; pinned by
  two deterministic tests (fake transport): backoff schedule is exactly
  [0.5, 1.0] for 3 attempts, and a transient failure recovers on attempt 2.
- **Circuit breaker for the copilot (web tier)** — `lib/ai/breaker.ts`: after
  3 consecutive model failures the breaker opens; queries fail fast and
  honestly (`service_unavailable`) instead of paying the network timeout;
  after a 30 s cooldown the next call probes (half-open) and recovery is
  automatic. Clock-injected so the state machine is walked deterministically
  (7 tests, no sleeps).
- **Web `/api/metrics`** now reports a live engine-plane latency measurement.

### Changed
- CI test step renamed to include properties + observability;
  `hypothesis` pinned in `constraints.txt` and `apps/api[dev]`.

### Verified (this tree)
API: 125/125 pytest (was 112), ruff clean, eval gate, parity 25/25 both
engines. Web: tsc/eslint clean, 48/48 integration tests (was 41), build,
12/12 Playwright.

## [0.4.1] - 2026-09-11 - container stack fixed and verified live end-to-end

The Docker path was asserted, never executed. Built both images, booted the
compose stack on a clean volume, and drove every check below through the
published ports. Four real defects found and fixed:

### Fixed
- **web image could not build** — the build stage ran `next build` under
  bun 1.2, whose unimplemented worker_threads options and CommonJS loader
  break the Next 16 production build inside a container (it passed on the
  host only because `bun run` shells out to node). Build now runs on
  `node:22-slim`; bun still owns installs (`bun.lock`).
- **web container could not start** — the runner was `oven/bun` calling
  `node server.js` (no node in the image). Runner is now `node:22-slim`, and
  `HOSTNAME=0.0.0.0` is pinned (Docker's container-id HOSTNAME made the
  standalone server die with `EAI_AGAIN`).
- **api container exited at import** — the Dockerfile never copied the
  repo-root `data/` corpus, so `SafetyEngine.load()` raised
  FileNotFoundError on `/srv/data/brands.csv`. Corpus is now baked in.
- **web DB was read-only at runtime** — Prisma needs a detectable OpenSSL on
  slim images (installed), and the MS-05 removal of the boot-time push
  requires an operator one-shot: a profile-gated `schema` compose service
  (uid 10001, shared with the runner) applies the schema deliberately.

### Verified (clean volume, published ports)
web: warfarin+aspirin -> interaction; triple whammy -> interaction; garbage
-> confirm_queue; seed OK; evidence selftest 18/18 in-container;
cross-origin write -> 403. api: RX-002 -> interaction; /healthz + /readyz
ok; judge route default-closed (403). Both containers healthy, non-root.

Also: demo-check no longer pulls `make parity` (which needs bun) in the
python-only CI job — `parity-py` is the API-tier gate (CI green on master).

## [0.4.0] - 2026-09-11 - audit hardening pass: parity contract, safe defaults, privacy switch

Third audit pass. Every item below is pinned by a test and verified green in
this tree (112/112 pytest · eval gate · parity 25/25 both engines · eslint +
tsc · 18/18 selftest · 41/41 web tests · build · 12/12 Playwright).

### Added
- **Cross-engine parity gate (ADR-0012)** — `eval/parity/parity.{py,ts}`: a
  25-case golden corpus (pass / interaction / contraindication / duplicate /
  confirm_queue / refused) run through BOTH safety planes; any disagreement
  blocks the merge (`make parity`, pytest `test_parity.py`, `bun run parity`,
  CI). Closes the two-plane drift risk (R-7/TD-D).
- **Eval regression gate (ADR-0013)** — `eval/regression_gate.py` + committed
  `eval/baseline.json`: CI benchmark now FAILS on severity/recall drift
  instead of printing a table. Floors: brand recall 0.95, verdict agreement
  1.00, refusal precision 1.00.
- **Privacy kill switch (Ch.12)** — `MEDISAATHI_DISABLE_MODEL_EGRESS=1`
  hard-disables every outbound model call on both tiers (extraction, copilot,
  live vision); the deterministic plane runs at full strength with zero
  third-party transmission. Pinned by tests in both tiers.
- **Combination graph rules ported to the Python plane (ADR-0012)** — triple
  whammy, QT stacks, serotonin stacks, bleeding stack now fire in
  `apps/api/app/safety/engine.py`, mirrored 1:1 from the TS plane; parity
  corpus P16/P17/P23 pins them across engines.
- **`MEDISAATHI_ENV` + `MEDISAATHI_ADMIN_TOKEN`** — `POST /api/seed
  {force:true}` (destructive demo reset) is deny-by-default outside
  development: 403 unless a constant-time-compared admin token is presented;
  an empty token never unlocks it (MS-03).
- **Pinned CI installs (MS-11)** — `constraints.txt`; both pip installs run
  `-c constraints.txt`; `bun audit --audit-level=high` added to the web job
  (with the one documented dev-only exception).
- **Citation contract for the grounded copilot (TD-G)** — `validateCitations()`:
  a grounded answer MUST carry inline `[n]` citations, all within the
  retrieved range; violations demote to refusal. The dosage post-check regex
  is exported and unit-tested (`DOSAGE_POSTCHECK`).
- **Named confidence formula (TD-F)** — `overallConfidence()` in the safety
  plane with documented 0.4/0.6 weighting and boundary tests; the verify route
  no longer carries an inline magic-weight expression.

### Security
- **Judge route default CLOSED (MS-08)** — `MEDISAATHI_JUDGE_OPEN` now
  defaults to `0` (403); demo laptops opt in explicitly. Regression test pins
  the forgotten-env case.
- **Web rate-limit key law (MS-02)** — without a trusted proxy the limiter
  uses a shared `anon` bucket; `x-real-ip` (client-supplied) is never
  trusted, so callers cannot mint fresh buckets per request.
- **Same-origin mutation check (MS-10)** — cross-origin writes are rejected
  at middleware with 403 before any handler runs (defense in depth; pinned by
  the middleware security contract tests).
- **System-prompt role (MS-09)** — system instructions travel as role
  `system`, not `assistant`, in every model call (extraction, copilot, rubric
  judge): instruction hierarchy matters for gates 1–2.
- **Containers run non-root (MS-06)** — both Dockerfiles add a dedicated
  `medisaathi` user; the web image's SQLite dir is 0750; the boot-time
  `prisma db push --accept-data-loss` was REMOVED from the web CMD (MS-05):
  schema is applied deliberately by the operator, never silently at start.
- **Short-brand matcher hardening** — sub-4-char brand cores ("Pan 40")
  match only as full brand tokens; parity case P03 pins the law in both
  engines.

### Fixed
- **Offline-tier confirm/refuse boundary** — the TS gate's all-refused band
  consumed formulary `brandConfidence` when no LLM ran, REFUSING garbage that
  the Python law (and decision B9) queues for human confirmation. The
  refusal band now consumes perception confidence only — exactly mirroring
  `apps/api/app/verdict.py` (gate 2). Found by the E2E confirm-queue and
  prompt-injection journeys failing; parity + selftest + E2E all pin it.
- **Plan-start atomicity (TD-E)** — archive-old-plan → create-plan →
  medications → doses now runs in ONE interactive transaction; a mid-loop
  failure no longer leaves a partially scheduled plan.
- **Judge test isolation** — judge-path tests opt in via `monkeypatch` so
  each file is self-contained under the new closed-by-default flag.
- **Corpus sync** — brands/interactions CSVs extended for cross-tier parity
  (warfarin+cotrimoxazole, metformin+furosemide, PDE5+nitrate, lithium and
  statin stacks, …); TS dataset adds Warfone 5 / Cotrimoxazole DS.

### Verified (this tree, this environment)
- API: **112/112 pytest** (incl. parity gate + egress switch + judge default),
  eval gate at floors (brand recall 1.00 · frequency recall 0.9444 · verdict
  agreement 1.00 · refusal precision 1.00), ablation, demo-check, ruff clean,
  bench p50 ~13 ms.
- Web: eslint + tsc clean, 18/18 self-test + 3/3 copilot gates, **TS parity
  25/25**, **41/41 integration tests**, production build, **12/12 Playwright
  journeys**.

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
- **Fresh-install typecheck/build breakage (CI-caught)** — `tailwind.config.ts`
  still imported `tailwindcss-animate`, which the 0.3.1 dependency prune had
  removed; a stale local `node_modules` masked it locally while CI's frozen
  install failed. The file was dead scaffold code (Tailwind v4 config is
  CSS-first via `@theme inline` in globals.css; nothing referenced it, and the
  one animate-utility consumer, the toaster, is served by the already-imported
  `tw-animate-css`). Deleted; verified by a full clean-install gate.
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
- docker-compose: added the missing web healthcheck (the API service already
  had one); closes the reliability-audit gap noted in the engineering report.
- Copilot outage kind (`service_unavailable`) now has its own UI badge instead
  of masquerading as a low-confidence refusal (RES-12).
- Eval case E07 replaced with a below-floor BM25 probe so the low-confidence
  refusal fires deterministically (RES-13).

### Verified (this tree, this environment)
- API: **107/107 pytest**, eval (recall 1.00 / agreement 1.00 / refusal
  precision 1.00), ablation, demo-check, ruff clean.
- Web (verified twice: stale install **and** a from-scratch
  `bun install --frozen-lockfile`): eslint + tsc clean, 18/18 self-test, 3/3
  copilot gates, 14/14 integration tests, production build, **12/12
  Playwright journeys**. Install surface after the prune + E2E tooling:
  170 product packages, ~420 with dev tooling.

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
