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
          contraindications -> duplicate-ATC -> AWaRe)  ... zero LLM, zero network
                │
                ▼
          plan in en/ta/hi (template-grounded voice over VERIFIED slots only)
```

The model reads. The rules decide. Below threshold it refuses - and the refusal
is a designed success state with a live counter, because in medication a
confident wrong answer is worse than an honest one.

## What works right now (offline, no keys)

- **Deterministic safety engine**: 63-brand Indian formulary map, 45
  DDInter-derived interaction pairs, 25 contraindication rules, duplicate-ATC
  detection, WHO AWaRe tagging.
- **Pipeline**: 12 sealed fixture cases covering clean prints, handwriting,
  Tamil script, a corrupted scan, and a non-prescription photo.
- **Verdict law**: refuse < 0.75 confidence; human confirm queue between 0.75-0.90;
  full-screen refusal with explanation for unusable images.
- **Spoken plan**: template-grounded NLG in English/Tamil/Hindi - every brand and
  dose in the voice output is traceable to a verified slot (tested).
- **API**: FastAPI, typed end-to-end from `medisaathi-contracts` (Pydantic v2),
  envelope responses, `/judge` sealed-case route, `/metrics` refusal counters.
- **Eval CLI**: brand recall, verdict agreement, refusal precision on the
  fixture benchmark; `--json` results committed per build tag.

## Quickstart

```bash
make setup      # contracts + api (editable installs)
make test       # safety-plane property tests + API golden paths
make eval       # benchmark table
make demo-check # FULL offline demo gate (sealed cases + tests + eval)
make run        # uvicorn on :8000, then open /docs
```

Try the pipeline:

```bash
curl -X POST "localhost:8000/api/v1/prescriptions?sample_id=RX-002"
# -> meta.verdict = "interaction"  (warfarin + aspirin, severe, DDInter)

curl -X POST "localhost:8000/api/v1/prescriptions?sample_id=RX-006"
# -> meta.verdict = "refused"      (corrupted scan; refusal-as-feature)
```

## Benchmark (fixture set v0)

| Metric | Value | Note |
|---|---|---|
| n | 12 | sealed fixture cases; 50-case labeled set lands at Block B7 |
| brand recall | 1.00 | formulary-seeded fixtures |
| verdict agreement | 1.00 | vs expected verdicts in `data/cases_manifest.json` |
| refusal precision | 1.00 | refused cases are exactly the unusable images |

`make eval --json` emits machine-readable results; commit them beside the build
tag (`MEDISAATHI_BUILD_TAG`). The A1 (raw LLM) vs A4 (full) ablation harness is
specified in the master plan and lands at Block B7 - the table above is the A4
column of that ladder.

## Honest limits (read before judging us)

- **Demo scope**: extraction runs on a sealed fixture corpus (deterministic,
  offline, zero-key). The live vision path is wired behind `MEDISAATHI_VISION_KEY`
  and implemented at Block B2 of the event window.
- **Handwriting**: severe scrawl degrades to the confirmation queue or refusal,
  by design and by measurement.
- **Data**: seed CSVs are synthetic-curated with sources recorded
  (`data/sources.json`); production replaces them with versioned snapshots.
- **No auth** in the event build (read-only demo scope); OTP + ABDM-style consent
  is the first post-event line item.
- **Not a doctor**: information layer only; every screen and spoken plan says so.

## Repository layout

```
apps/api        FastAPI service (pipeline, verdicts, plan, price, ADR, judge)
apps/web        Next.js 16 frontend (Block B5 scaffold)
packages/contracts  Pydantic v2 contracts -> OpenAPI -> generated TS client
data/           seed CSVs, fixture corpus, cases manifest, sources
eval/           benchmark CLI (brand recall / verdict agreement / refusal precision)
docs/           master plan, PRD, demo script, judge Q&A bank
```

## Team

| Role | Owns |
|---|---|
| Pipeline lead | vision plane, LLM schemas, API |
| Safety engineer | rule engine, NLG templates, audio |
| Product frontend | design system, judge route, a11y |
| Data + research | benchmark, labeling, eval harness, docs |

## License

Code: MIT. Data: CC-BY 4.0 (citation required). See `data/sources.json`.
