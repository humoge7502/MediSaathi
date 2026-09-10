# RESEARCH.md — verification-first medication intelligence

Status labels follow the project law: **VERIFIED** (measured in this repo),
**LITERATURE** (cited source), **SIMULATED** (synthetic seed data), **HYPOTHESIS**
(not yet measured). Nothing here is invented; empty sections say so.

## 1. Abstract (positioning)

MediSaathi is a verification-first layer between a prescription photo and the
patient: a vision model transcribes lines with per-field confidence under a
strict JSON schema; a deterministic rule engine screens the result against
versioned drug-data snapshots (interactions, contraindications, duplicate ATC
classes, daily dose caps); below a confidence threshold the system refuses
rather than guesses; above it, the verified plan is spoken aloud in Tamil,
Hindi, or English with slot-level traceability and priced against Jan Aushadhi
generics. The central claim is architectural: **verification, not generation,
is the safe unit of AI in medication workflows.**

## 2. Problem statement

Long-term therapy adherence in India sits at **16.6–24.1%** (2023 Indian
adherence meta-analysis; LITERATURE), **~62% of antibiotics are supplied
without prescription** (pooled pharmacy surveys; LITERATURE), and only
**6–10% of adverse drug reactions are reported** (PvPI uptake analyses;
LITERATURE). WHO's *Medication Without Harm* names medication errors a global
**$42B** cost (LITERATURE). The patient-facing failure is concrete: a family
leaves a hospital with a paper they cannot fully read, cannot check for
interactions, cannot price, and cannot hear in their own language.

## 3. Existing approaches (and their gap)

| Approach | What it does | Why it does not verify |
|---|---|---|
| Pharmacy commerce apps (PharmEasy-class) | sell medicines, order tracking | no independent safety screen; incentive to fulfill, not question |
| Reminder apps | notification schedules | presuppose a correctly understood prescription |
| Generic LLM chat | free-text answers | fluent hallucination of doses/brands; no data provenance; no refusal discipline |
| Hospital pharmacist | the real safety net | scarce; queue times; not portable to the home |

Research gap: no patient-facing tool treats **refusal and human confirmation**
as first-class, measured outcomes of an AI medication pipeline.

## 4. Hypothesis (H1, H2)

- **H1**: binding AI output to a deterministic verification plane with an
  explicit confidence gate materially reduces unsafe outputs compared to a
  raw model read at equal extraction quality.
- **H2**: the gate's value is measurable as a verdict-agreement delta between
  the raw-read ablation (A1) and the full pipeline (A4).

## 5. Method

Sealed 12-case fixture corpus (clean prints, handwriting, Tamil script,
corrupted scan, non-prescription photo) with a labeled manifest
(`data/cases_manifest.json`, `data/eval_labels.csv`). Cases run through the
real pipeline (no mocks); metrics computed against labels.

## 6. Results — VERIFIED (run `make eval`, `make ablation`)

| Metric | A4 full pipeline | A1 raw-read counterfactual |
|---|---|---|
| n | 12 | 12 |
| brand recall | 1.00 | 1.00 |
| frequency recall | 0.94 | 0.94 |
| **verdict agreement** | **1.00** | **0.17** |
| refusal precision | 1.00 | n/a (refusals suppressed by design) |
| latency p50 (fixture tier) | < 1 ms | 0 ms |

The brand-recall parity is the point: **reading is not the hard part — deciding
is.** With the gate and formulary removed, verdict agreement collapses to 0.17
while the same fields are read perfectly (H1, H2 supported **on this corpus**;
SIMULATED data; small n; not a clinical claim).

## 7. Baselines and ablations

- **A1** (implemented): raw read, face-value fields, no gate, no refusal.
- **A4** (implemented): schema + gate + deterministic plane.
- **A2/A3** (proposed, not yet implemented): schema-only without gate; gate
  without formulary. Listed as future ablation ladder rungs.

## 8. Data provenance

Seed CSVs are synthetic-curated with sources recorded per row in
`data/sources.json` (84 brands / 47 DDInter-derived interaction pairs / 27
contraindication rules; WHO AWaRe tagging; Jan Aushadhi price snapshot
2026-09). SIMULATED by design for the event build; production replaces them
with versioned licensed snapshots. No patient data exists anywhere in the
repo; the ADR draft explicitly collects no identifiers ("not-collected
(privacy)").

## 9. Limitations (concessions, not weaknesses)

- 12 cases is a demo corpus, not a dataset; per-field human labels beyond
  frequency/verdict do not yet exist.
- Fixture tier simulates OCR with pre-segmented lines; the live vision path is
  implemented and schema-constrained but was not evaluated for accuracy here.
- Interaction data is DDInter-derived (population-general pharmacology;
  Indian formulation map layered on top) — ambiguity routes to the pharmacist
  queue by design.
- No clinical validation, no user study, no accuracy claim beyond the labeled
  metrics above. Everything else is architecture + measurement discipline.

## 10. Ethics & safety framing

The system never presents AI output as diagnosis; every screen, plan, and
audio outro carries the "information tool, not a doctor" disclaimer; refusals
and queueing are designed success states with live counters; the confirm queue
puts a human before any plan is spoken. Privacy by design: no PII collected,
context is declared (never inferred), sensitive content is never logged.

## 11. Reproducibility

```bash
make setup && make test && make eval && make ablation
python eval/eval.py --json > eval/runs/$(git rev-parse --short HEAD).json
```

Deterministic fixture tier → results are byte-stable across runs; CI runs the
same commands on every push.
