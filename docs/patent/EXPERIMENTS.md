# Experiment protocol and results

Referenced by `ml/corpus.py`. Regenerate every number in this document with:

```bash
python tools/run_experiments.py --all    # writes eval/runs/ and eval/results/
python tools/build_binder.py             # writes docs/patent/EVIDENCE_BINDER.md
```

The results tables below are a **summary**; `docs/patent/EVIDENCE_BINDER.md` is
generated from the archived runs and is the authoritative table. No number is
quoted anywhere in this repository without a run manifest behind it.

## What is measured, and by which arm

The system's learning component is perception, not decision. Formally: given a
prescription artifact, produce typed fields each with a confidence that is
*calibrated* — a field labelled 0.9 should be correct about 9 times in 10 — such
that band-gating at `(0.75, 0.90)` achieves **zero unsafe auto-confirmations at
a bounded human-review burden**. The decision layer is deliberately
non-learning: auditability and offline determinism are design requirements.

| Arm | Pipeline |
|---|---|
| **A0** | model proposes the verdict directly; nothing screened, nothing gated |
| **A1** | raw read: fields accepted at face value, no gate, no refusal, no queue |
| **A2** | correct three-band gate, no rule plane |
| **A3** | perfect perception (ground-truth fields), full rule plane, no gate |
| **A4** | **proposed**: schema-constrained read → fusion → three-band gate → deterministic plane → precedence → queue blocking |

Each ablation removes exactly one stage of A4: `-gate`, `-combination`,
`-formulary_fusion`, `-queue_blocking`, `-refusal_band`.

## Corpus

- `data/corpus/cases.jsonl` — 300 adjudicated cases
  (clean_pass 55, severe_pair 40, moderate_pair 25, contraindication 25,
  duplicate 20, combination 20, confirm_queue 30, refused 15, script_mix 15,
  adversarial 55).
- `data/corpus/splits.json` — deterministic 70/15/15 split, stratified by
  verdict class, seed `20260911`; the test split is read once.
- `data/corpus/codebook.json` — label fields, verdict vocabulary, provenance.
- The corpus is a **decision-layer** corpus: each case ships the perception
  result it was built from (raw line + per-line confidence) plus adjudicated
  field/verdict/finding labels, so the ladder is reproducible with no live model.
- `data/manifest.json` pins every corpus and knowledge file by sha256; the loader
  verifies hashes and CI fails on mismatch.

### Known limitation: annotation

The corpus is synthetic-curated by the generator `tools/build_corpus.py`. Dual
human annotation, adjudication and an inter-annotator Cohen's kappa are the
outstanding human-bound step (MED-005), and `data/corpus/codebook.json` records
that status as `pending` rather than implying it was done. Metrics on this
corpus are therefore *engineering* evidence, not a clinical benchmark.

## Results (frozen test split, n = 44)

| arm | verdict agreement | macro F1 | unsafe auto-confirm rate | queue rate | ECE (safety) |
|---|---|---|---|---|---|
| A0 | 0.227 | 0.062 | 0.773 | 0.000 | 0.673 |
| A1 | 0.705 | 0.601 | 0.295 | 0.000 | 0.230 |
| A2 | 0.477 | 0.234 | 0.477 | 0.295 | 0.592 |
| A3 | 0.705 | 0.601 | 0.295 | 0.000 | 0.296 |
| **A4** | **1.000** | **1.000** | **0.000** | 0.250 | **0.148** |

**Reading.** Removing the gate and the formulary screen (A1) collapses verdict
agreement to 0.705 and reintroduces a 29.5% unsafe auto-confirm rate; the
LLM-only arm (A0) is far worse. A4 eliminates unsafe auto-confirmations while
keeping verdict agreement at 1.0 and holding human review to the confirm-queue
stratum. This is the measured technical effect.

### Ablations (Δ vs A4)

| ablation | Δ agreement | Δ unsafe rate |
|---|---|---|
| `-gate` | −0.295 | +0.295 |
| `-formulary_fusion` | −0.250 | +0.250 |
| `-queue_blocking` | −0.250 | +0.250 |
| `-combination` | −0.045 | +0.045 |
| `-refusal_band` | −0.045 | +0.000 |

Removing the gate, the formulary term of the fusion, or queue blocking
measurably destroys safety or agreement: the stages inter-work rather than
aggregate.

## E-D — calibration and the frozen operating point

The threshold grid (refuse 0.60–0.90 × confirm 0.85–0.95) is swept on the
calibration split; the frozen point is then evaluated **once** on the held-out
test split. The shipped default `v1-2026-09` reproduced agreement 1.000,
unsafe 0.000, queue 0.250 and ECE(safety) 0.148 on the test split.

**Honest negative result.** No grid point reaches a 15% queue rate on this
corpus, because the corpus contains a deliberate confirm-queue stratum
(invented/confusable brands) that must queue at *every* threshold. The 15%
review-burden target is therefore reported as unmet rather than redefined, and
the frozen point is justified as the minimum-burden zero-unsafe point relative
to the shipped default. Similarly, ±0.01 confidence perturbation moves one
verdict at a band edge (documented as `boundary_sensitivity`, not hidden).

### Fusion-weight sensitivity (MED-023)

The alternative `banding = "fused"` embodiment was swept across the weight grid
on the calibration split (this is the only setting where the weights move the
decision boundary rather than just the provenance score):

| formulary / reading | unsafe rate | queue rate | agreement | ECE (safety) |
|---|---|---|---|---|
| 0.3 / 0.7 | 0.000 | 0.250 | 1.000 | 0.127 |
| **0.4 / 0.6 (shipped)** | 0.000 | 0.250 | 1.000 | 0.148 |
| 0.5 / 0.5 | 0.000 | 0.250 | 1.000 | 0.169 |
| 0.6 / 0.4 | 0.000 | 0.250 | 1.000 | 0.189 |

**Neutral result, recorded rather than tuned.** Safety and burden are invariant
across the grid, but ECE improves monotonically as the reading term dominates —
the shipped 0.4/0.6 pair is safe but not ECE-optimal. Moving a frozen parameter
on evidence this thin would be exactly the kind of quiet tuning the evidence
discipline exists to prevent, so the default stays frozen and the refit is
listed as future work requiring a larger corpus.

## E-C — robustness

Six corruption levels (baseline, abbreviation, OCR-numeric, OCR-brand, layout,
instruction-injection) over 256 held-in cases: **zero unsafe auto-confirmations
in every stratum**; invented brands never auto-confirm; queue replays are
refused (first transition wins, 3/4 = all but the first). The frozen test split
is never mutated.

Injected instruction text is inert: it changes no verdict, because the plane
never reads it as an instruction.

## E-E — cross-engine parity

110 golden cases in one shared, versioned file (`eval/parity/golden.json`) run
through both the TypeScript and Python planes; both agree 110/110. The expansion
from 25 cases surfaced and closed three real drifts (a wrong molecule mapping
for `Hydroquin 200`, three missing formulary rows, three missing
contraindication rows on the TS side).

## E-F — latency and offline availability

The deterministic plane runs at p50 ≈ 0.07 ms / p95 ≈ 0.11 ms over the whole
corpus (in-process). Full HTTP pipeline p50 ≈ 13 ms. Offline verdict delta is
zero: the plane makes no network calls, proven by
`apps/api/tests/test_egress.py` under a poisoned socket, so degraded mode
changes no verdict.

## E-G — human-in-the-loop simulation

| arm | task accuracy | coverage | reviewed fields/case | s/case |
|---|---|---|---|---|
| raw (blind automation) | 0.705 | 1.000 | 0 | 0.0 |
| blanket refusal | 1.000 | 0.705 | 13 | 26.6 |
| **queue (proposed)** | **1.000** | **0.705** | 13 | **5.9** |

The queue arm matches blanket refusal's accuracy while costing ~4.5× less human
time, and beats blind automation by 0.295 absolute. **The reviewer is a
simulated policy with an explicit accuracy knob, not a human-subjects panel**
(`ml/hitl.py --reviewers-file` accepts a real panel's measured accuracy).

## E-H — longitudinal regimen plane (mechanisms A + B)

The 300-case corpus is single-prescription by construction: each case is screened
alone, so it cannot contain a harm that exists only because two prescriptions
were *composed*. This experiment holds the patient's active regimen fixed and
varies the arriving prescription, comparing the incumbent single-prescription
law against the extended plane.

Corpus: `data/corpus/regimen.jsonl`, constructed by intent and verified against
*both* planes — a cross-prescription case is kept only if the incumbent returns
`pass` (it cannot see the harm) and the regimen plane catches it. Strata:
triple-whammy spread across visits, a third QT-prolonger added later, a second
serotonergic added to an SSRI, an NSAID added to an antithrombotic + SSRI, a
duplicate molecule reached through a different brand, a fragile confusable read,
a clean continuation, and an incoming-only control.

| arm | unsafe pass on harm | cross-prescription caught | queue rate | agreement |
|---|---|---|---|---|
| `single_rx` (incumbent) | 0.832 | **0.000** | 0.000 | 0.310 |
| `regimen` (A) | 0.000 | 0.949 | 0.000 | 0.947 |
| `regimen+propagation` (A+B) | 0.000 | **1.000** | 0.035 | 0.982 |

n = 113 (66 cross-prescription). Numbers are from the archived run; see the
binder for the run id and SHAs.

**Reading.** The incumbent law is structurally blind to harm assembled across
prescriptions: it returns a bare `pass` on 83% of the harmful cases here and
catches none of the cross-prescription harms. Mechanism A (compose the active
regimen, screen the union) closes almost all of it. Mechanism B (propagate
read-identity uncertainty to a verdict distribution, and force the confirm queue
when the uncertainty could *hide* harm) closes the remainder, including the
fragile reads that mechanism A would auto-confirm — at a marginal queue cost of
3.5%, because the coupling fires only when uncertainty could hide harm, not
whenever a read is merely uncertain.

**Limitation stated plainly.** The confusion neighbourhood is derived from
brand-core string similarity against the 96-brand demo formulary, so the fragile
stratum is small (4 cases — the number of genuinely look-alike pairs the data
contains). The mechanism is general; the size of its demonstration here is
bounded by the demo formulary, and a licensed DDInter/RxNorm snapshot would
widen it. The regimen corpus is synthetic-curated like the primary corpus.

## Reproducibility contract

- Perception temperature 0; the engine is deterministic; corruption seeds pinned
  (`20260911`); split seed pinned.
- Every CSV/corpus file is sha256-pinned in `data/manifest.json`; the shared
  parity corpus is sha256-pinned in the binder.
- Every run emits `eval/runs/<id>/{manifest.json,metrics.json,cases.jsonl}`
  recording config, dataset SHAs, engine commit, environment and seed.
- Proportions are reported with Wilson 95% intervals; the test split is touched
  once, after the operating point is frozen.

## What this is not

Software benchmark evidence. Not clinical validation, not a medical device, no
patient outcomes measured, no real patient data used. Perception *accuracy* on
real images is a separate, open experiment requiring a live model
(`apps/api/app/vision.py`; the key-gated path exists and is unit-tested).
