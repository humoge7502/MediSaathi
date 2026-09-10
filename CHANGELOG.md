# Changelog

All notable changes. Format based on Keep a Changelog; versions here map to
the event build blocks.

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
