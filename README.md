# MediSaathi

**Every prescription, understood.** A verification-first prescription intelligence
layer: snap a prescription photo, get back a medicine plan that is extracted with
per-field confidence, screened for interactions on public drug data, spoken aloud
in Tamil, Hindi, or English, priced against Jan Aushadhi generics - and **refused,
not guessed, when confidence drops**.

> VMEDITHON 3.0 (VIT Chennai) - Bio x Engineering track, software division.

## Why

Long-term therapy adherence in India sits at **16.6-24.1%**, **62% of antibiotics
are supplied without a prescription**, and only **6-10% of adverse drug reactions
are ever reported** (sources: 2023 Indian adherence meta-analysis; pooled pharmacy
surveys; PvPI uptake analyses; WHO *Medication Without Harm*, $42B global cost).
Commerce apps sell medicines and reminder apps send nudges. **Nothing verifies.**

## The one-line architecture law

```
photo ──> PERCEPTION PLANE (vision LLM, JSON schema, per-field confidence)
                │
                ▼  [CONFIDENCE GATE 0.75 / 0.90]
          SAFETY PLANE (deterministic rules: normalize -> interactions ->
          contraindications -> duplicate-ATC -> dose caps)  ... zero LLM, zero network
                │
                ▼
          plan in en/ta/hi (template-grounded voice over VERIFIED slots only)
```

The model reads. The rules decide. Below threshold it refuses - and the refusal
is a designed success state with a live counter, because in medication a
confident wrong answer is worse than an honest one.

## What works right now (offline, no keys)

- **Deterministic safety engine** (`apps/api/app/safety/`): 84-brand Indian
  formulary map, 47 DDInter-derived interaction pairs, 27 contraindication rules,
  duplicate-ATC detection, same-brand double-dose detection, WHO AWaRe tagging,
  and **dose-cap arithmetic** (per line AND aggregate across brands, e.g. two
  paracetamol brands each under the cap whose sum exceeds it).
- **Pipeline**: 12 sealed fixture cases covering clean prints, handwriting,
  Tamil script, a corrupted scan, and a non-prescription photo.
- **Verdict law** (`apps/api/app/verdict.py`): refuse < 0.75 confidence; human
  confirm queue between 0.75-0.90; six verdict kinds, all property-tested.
- **Spoken plan** (`apps/api/app/nlg/`): template-grounded NLG in English/Tamil/
  Hindi with **per-sentence audio segments**, every brand and dose traceable to a
  verified slot (tested). The web client speaks it via the Web Speech API.
- **API** (`apps/api/`): FastAPI, typed end-to-end from `medisaathi-contracts`
  (Pydantic v2), envelope responses, multipart upload, formulary autocomplete,
  `/judge` sealed-case route with a **baked zero-network cache**, `/metrics`
  refusal counters.
- **Security layer** (`apps/api/app/middleware_security.py`): request IDs with
  injection-proof validation, security headers, sliding-window rate limiting
  (env-tunable), upload MIME allow-list **plus magic-byte sniffing** - covered
  by a dedicated red-team test suite (26 tests).
- **Persistence**: SQLite (WAL) store with an **indexed verdict column**
  (O(1) metrics aggregation, in-place migration for older DBs), thread-safe,
  restart-safe; single-file swap to Postgres post-event.
- **Live vision** (`apps/api/app/vision.py`): implemented and key-gated -
  schema-constrained, temperature-0 call to any OpenAI-compatible vision endpoint
  (Gemini, OpenAI, Ollama, vLLM...), one retry on schema failure, honest refusal
  when the model reports no prescription content. Schema failures are counted in
  `/metrics`, never hidden.
- **Eval CLI** (`eval/eval.py`): brand recall, **frequency recall**, verdict
  agreement, refusal precision, latency p50/max on the fixture benchmark;
  `--json` results per build tag; **`--ablation A1`** runs the raw-read
  counterfactual (no gate, no formulary, no refusal) against the A4 full
  pipeline.

## Quickstart

```bash
make setup        # contracts + api (editable installs)
make test         # 90 tests: safety-plane properties + API + perception + red-team
make eval         # benchmark table (A4)
make demo-check   # FULL offline demo gate (sealed cases + tests + eval)
make run          # uvicorn on :8000, then open /docs
```

Frontend:

```bash
make web          # installs, then next dev on :3000
# or: cd apps/web && npm install && npm run build && npm start
```

Docker:

```bash
make docker       # api on :8000, web on :3000, SQLite volume persisted
```

Try the pipeline:

```bash
curl -X POST "localhost:8000/api/v1/prescriptions?sample_id=RX-002"
# -> meta.verdict = "interaction"  (warfarin + aspirin, severe, DDInter)

curl -X POST "localhost:8000/api/v1/prescriptions?sample_id=RX-006"
# -> meta.verdict = "refused"      (corrupted scan; refusal-as-feature)

curl "localhost:8000/api/v1/formulary/search?q=paracetamol"
# -> autocomplete over the 84-brand formulary
```

## Benchmark (fixture set v0)

| Metric | Value | Note |
|---|---|---|
| n | 12 | sealed fixture cases; labels in `data/cases_manifest.json` + `data/eval_labels.csv` |
| brand recall | 1.00 | formulary-seeded fixtures |
| frequency recall | 0.94 | TAC-code parsing vs labeled frequencies |
| verdict agreement | 1.00 | vs expected verdicts |
| refusal precision | 1.00 | refused cases are exactly the unusable images |
| latency p50 | < 1 ms | deterministic fixture tier |

Run `python eval/eval.py --ablation A1` to see the counterfactual: with the gate
and formulary removed, verdict agreement collapses to **0.17** - the safety plane,
not the reading, is the product. `--json` emits machine-readable results;
commit them beside the build tag (`MEDISAATHI_BUILD_TAG`).

## Performance (measured)

`python3 tools/bench.py` — full pipeline p50 ≈ **12 ms** / p95 ≈ **15 ms**
in-process (middleware + rule engine + durable write); `/metrics` ≈ 2 ms via
indexed `GROUP BY`; web first-load JS ≈ **105 kB**, statically prerendered.
Budgets and methodology: [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

## Security posture

- Rate limiting (60 writes/min per client, sliding window; env-overridable),
  security headers, request-ID correlation with injection-proof validation.
- Upload hardening: declared MIME allow-list + magic-byte sniffing; a JSON
  payload wearing `image/jpeg` is rejected before any model call.
- Prompt-injection containment: perception output is inert text; injected
  instructions cannot reach verdict fields, fabricate verdicts, or bypass the
  gate (tested in `tests/test_redteam.py`).
- Privacy by design: no PII collected, context is declared-never-inferred and
  vocabulary-validated, sensitive content is never logged.
- Honest boundaries: no auth in the event build (read-only demo scope, rate
  limited); web CSP keeps `unsafe-inline` (documented debt, nonce regime is the
  follow-up). Full model: [docs/SECURITY.md](docs/SECURITY.md) and
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Engineering decisions (the interview section)

**Why two planes?** An LLM that both reads and decides cannot be audited.
Splitting them gives a property-tested, zero-network decision core and makes
the model swappable without touching safety.

**Why contracts-first?** `packages/contracts` (Pydantic v2) is the single source
of truth; the TS client mirrors it. The frontend cannot silently drift from the
backend because every response is one `Envelope`.

**Why a modular monolith?** Demo scale does not justify microservices. The store
API (`create/get/put/count/verdict_counts`) is the documented Postgres swap
point; the limiter interface is the Redis swap point; the vision tier already
speaks any OpenAI-compatible endpoint (or local vLLM/Ollama for on-prem).

**What makes this technically difficult?**
1. Refusal discipline under a confidence gate - the A1/A4 ablation exists
   because the naive version (raw read) measurably collapses.
2. Slot-traceable multilingual NLG - spoken doses are template-grounded over
   verified fields, tested per segment; nothing is freely generated.
3. Aggregate dose-cap arithmetic across brands - two sub-cap paracetamol lines
   can sum over the cap; caught by the engine, property-tested.
4. A demo that cannot fail on stage - three tiers (baked cache, sealed
   fixtures, key-gated live) with rehearsed failure drills.

**What I would scale next?** Postgres behind the store API, Redis-backed
limiter + counters, a labeled 300-case corpus with per-field labels, a
fine-tuned small vision model to cut live-tier cost, and a pharmacist review
console over the (already persisted) confirm queue.

## The demo's three tiers

1. **Cached tier** - `make bake-judge` runs the real pipeline once and persists
   full envelopes to `apps/api/app/data/judge_cache.json`; `/api/v1/judge/
   cases/{id}/cached` then answers with zero network. Re-baked from truth,
   never hand-edited.
2. **Fixture tier** - the sealed 12-case corpus answers offline, deterministically.
3. **Live tier** - set `MEDISAATHI_VISION_KEY` (+ optional `MEDISAATHI_VISION_
   BASE_URL`/`MODEL`) and `POST /api/v1/prescriptions/upload` with a multipart
   image. Without the key it returns an honest 503, never a fake.

## Documentation map

| Doc | What's inside |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | system/data-flow diagrams, two-plane law, ADR table, FMEA |
| [docs/RESEARCH.md](docs/RESEARCH.md) | problem, hypothesis, method, measured results, limitations (labeled claims) |
| [docs/TESTING.md](docs/TESTING.md) | test pyramid, red-team coverage table, regression law |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | measured latency + bundle numbers, budgets |
| [docs/SECURITY.md](docs/SECURITY.md) | threat model, controls, honest gaps |
| [docs/TECH_DEBT.md](docs/TECH_DEBT.md) | open debt ledger + resolved-with-tests record |
| [docs/HACKATHON_STRATEGY.md](docs/HACKATHON_STRATEGY.md) | judged scorecard, demo path, judge-attack Q&A |
| [docs/DECISIONS.md](docs/DECISIONS.md) | append-only decision log |
| [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | 90-second script + 5 failure drills |

## Honest limits (read before judging us)

- **Demo scope**: extraction runs on a sealed fixture corpus (deterministic,
  offline, zero-key). The live vision path is implemented and key-gated; it was
  not the demo default so the walkthrough cannot fail on quota or WiFi.
- **Handwriting**: severe scrawl degrades to the confirmation queue or refusal,
  by design and by measurement.
- **Data**: seed CSVs are synthetic-curated with sources recorded
  (`data/sources.json`); production replaces them with versioned snapshots.
- **No auth** in the event build (read-only demo scope); OTP + ABDM-style consent
  is the first post-event line item.
- **Not a doctor**: information layer only; every screen and spoken plan says so.

## Repository layout

```
apps/api            FastAPI service (pipeline, verdicts, plan, price, ADR, judge, upload)
apps/web            Next.js 16 frontend (scan flow, confirm queue, TTS plan, judge timeline)
packages/contracts  Pydantic v2 contracts - the single source of truth
data/               seed CSVs, fixture corpus, cases manifest, eval labels, sources
eval/               benchmark CLI (A1/A4 ablation, recall/agreement/precision/latency)
tools/              demo-check gate, judge-cache baker, latency bench
docs/               architecture, research, testing, performance, security, strategy
```

## Team

| Role | Owns |
|---|---|
| Pipeline lead | vision plane, LLM schemas, API |
| Safety engineer | rule engine, dosing rules, NLG templates |
| Product frontend | design system, judge route, a11y |
| Data + research | benchmark, labeling, eval harness, docs |

## License

Code: MIT. Data: CC-BY 4.0 (citation required). See `data/sources.json`.
