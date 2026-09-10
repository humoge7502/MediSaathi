# MediSaathi Master Plan - Block Trace (completed)

The event-window plan, annotated with what shipped. Kept as a record of method:
blocks were sequenced so a zero-failure demo existed at every point in time.

## A. Foundations (hours 0-4)
- A1 Contracts package first (`packages/contracts`): Pydantic v2 models are the
  single source of truth; every boundary crossing is typed. **SHIPPED**
- A2 Two-plane architecture law: perception never decides; the safety plane
  never calls a model. **SHIPPED**
- A3 Seed data with provenance (`data/sources.json`). **SHIPPED + expanded**
  (84 brands / 47 pairs / 27 rules, all molecules covered by the formulary)

## B. The build ladder
- B1 Safety engine + verdict gate (0.75 refuse / 0.90 confirm). **SHIPPED**
- B2 Live vision path, key-gated, schema-constrained, temp 0, one retry.
  **SHIPPED** (`app/vision.py`, `POST /prescriptions/upload`, mocked-provider tests)
- B3 Sealed fixture corpus + cases manifest + refusal-as-feature. **SHIPPED**
- B4 Persistence + integration: SQLite WAL store, thread-safe, restart-safe;
  multipart upload; formulary autocomplete endpoint. **SHIPPED**
- B5 Frontend: scan flow (samples + camera + upload), per-field confidence UI,
  confirm queue with autocomplete, interaction/dose cards, spoken plan with
  per-sentence highlighting and TTS, price table with savings, provenance
  drawer, ADR form. **SHIPPED** (`apps/web`)
- B6 Voice: template-grounded NLG emits `AudioSegment`s with slot refs; client
  speaks via Web Speech API (en-IN / ta-IN / hi-IN). **SHIPPED**
- B7 Eval harness: brand recall, frequency recall, verdict agreement, refusal
  precision, latency; `--json` per build tag; **A1-vs-A4 ablation** (the
  counterfactual that shows the gate, not the reading, is the product).
  **SHIPPED** (`eval/eval.py`)
- B8 Judge route: sealed cases, 90-second auto-advancing walkthrough, cached
  tier baked from the real pipeline (`make bake-judge`), contrast mode for the
  projector failure drill. **SHIPPED**

## C. Verification gates
- `make test` - 64 tests, including parser regression tests (the original
  scaffold's regexes were silent no-ops; tests now pin the parsing contract),
  gate-law properties, no-false-positive interaction shuffles, NLG slot
  traceability, upload gating, judge cache, store roundtrip.
- `make demo-check` - all six verdict kinds offline, plan+price on the
  non-blocking ones, refusal counter asserted.
- `make eval` + `make ablation` - the numbers.
- CI (`.github/workflows/ci.yml`) - api job (pytest + eval + demo-check) and
  web job (tsc + next build) on every push.

## D. Post-event roadmap (deliberately NOT in the event build)
1. OTP auth + ABDM-style consent artifacts.
2. Postgres migration (single-file swap behind `app/store.py`).
3. 50-case labeled set -> 300; codebook published; per-field label release.
4. Fine-tuned small vision model to cut live-tier cost; the safety plane is
   sensor-agnostic already.
5. Pharmacist review console for the confirm queue (queue is persisted today).
6. Pre-baked phrase audio in 3 languages to replace client TTS on low-end devices.
