# MediSaathi — Patent Evidence Binder

> **Generated artifact.** Produced by `python tools/build_binder.py` from the archived
> run manifests. Do not edit by hand; regenerate after every experiment run.

**This document is technical and strategic material, not legal advice.** Any statement
that reads as a legal conclusion requires review by a registered patent professional.

## 0. Provenance of this binder

- engine git SHA: `a349342-dirty`
- dataset snapshot id: `9b55abc2339e8265`
- cross-engine parity corpus `eval/parity/golden.json` sha256: `8ebb4f6e4b2ab6dce20adfd309424a446298539e83edd8737d513eb0d3692fd1`
- generated: 2026-09-11T16:35:14+00:00
- archived runs referenced: 7

All seven experiments have an archived run; no gaps.

## 1. Dataset provenance (sha256 per file)

| file | sha256 |
|---|---|
| `data/brands.csv` | `a9a018a9d6b3df41b2913247282484152f90dae6b44d37685409e6ae2cc0a595` |
| `data/cases_manifest.json` | `c46e8384a1987b9b64db91ce8868e85ad63e6d8db7e5305a39f4ae6672004296` |
| `data/contraindications.csv` | `811d6b3bcdd0312cce0191b5e0a06e019a35b472f7dde0b1a4aa6d8e21595cb6` |
| `data/corpus/adversarial.jsonl` | `f3d1a07952f2c8f55840ade0d1688305c506014be13a9caaf0618c228a6c2280` |
| `data/corpus/cases.jsonl` | `ab30dbdf003c2c76128c86a94ee4bb4c33510add5261f1e5928ad5cc5ed47f85` |
| `data/corpus/codebook.json` | `51cb5806e907199c76d8aeeaa21a94b9dac62d26288064e0b2d7c9ad44a8ecea` |
| `data/corpus/splits.json` | `8ec31186e3ff81f82a28d7103391e519bc21d75c6444410b795c53ca47a415ab` |
| `data/eval_labels.csv` | `36a6b977fe50fb9155d1f483847e1fb810e7874039790f8234d63b14431e97cc` |
| `data/interactions.csv` | `7a060917e768f1b06ecb28b166e6412691cdc3f03152b6ea5f8518a34f48ecc7` |
| `data/sources.json` | `1938bd3d358c6b8cedcce8f9a9d3cdf24355fd97f3627d1cba4a3c7ffe39f059` |

## 2. E-A — Baseline ladder (the technical-effect core)

Frozen test split, n = 44 (70/15/15 split; test read once).

| arm | verdict agreement | macro F1 | unsafe auto-confirm rate | queue rate | refusal rate | ECE (safety) |
|---|---|---|---|---|---|---|
| A0 | 0.227 | 0.062 | 0.773 | 0.000 | 0.000 | 0.6727 |
| A1 | 0.705 | 0.601 | 0.295 | 0.000 | 0.000 | 0.2304 |
| A2 | 0.477 | 0.234 | 0.477 | 0.295 | 0.000 | 0.5918 |
| A3 | 0.705 | 0.601 | 0.295 | 0.000 | 0.000 | 0.2955 |
| A4 | 1.000 | 1.000 | 0.000 | 0.250 | 0.045 | 0.1482 |

**Reading.** A0 (model proposes the verdict) and A1 (raw read, no gate) both emit unsafe
auto-confirmations on this corpus; A4 eliminates them while keeping verdict agreement at 1.0
and holding the human-review burden to the queue rate shown above. The gap between A1 and A4 is
the measured technical effect the claim story rests on.

## 3. E-B — Component ablations (synergy, not aggregation)

n = 44; each row removes exactly one stage of A4.

| ablation | Δ verdict agreement | Δ unsafe rate | Δ queue rate |
|---|---|---|---|
| A4_minus_combination | -0.045 | +0.045 | +0.000 |
| A4_minus_formulary_fusion | -0.250 | +0.250 | -0.250 |
| A4_minus_gate | -0.295 | +0.295 | -0.250 |
| A4_minus_queue_blocking | -0.250 | +0.250 | -0.250 |
| A4_minus_refusal_band | -0.045 | +0.000 | +0.045 |

**Reading.** Removing the gate, the formulary term of the fusion, or the queue blocking
measurably destroys verdict agreement or reintroduces unsafe auto-confirmations. This is the
inter-working evidence an inventive-step argument needs: the stages are not independent
features but one decision boundary.

## 4. E-D — Calibration and the frozen operating point

- calibration split n = 44; test split n = 44
- grid points evaluated: 20
- pareto-frontier points: 13
- shipped default: `v1-2026-09`
- lowest-burden zero-unsafe point: `sweep-r0.90-c0.90-reading` (queue 0.250, unsafe 0.000)
- promoted to frozen: **False**
- frozen operating point: `v1-2026-09`
- grid points meeting a 15% queue target at zero unsafe: 0

**Finding.** no fitted point beat the shipped default on burden without weakening safety; v1-2026-09 remains frozen

Fusion-weight sensitivity (MED-023, `banding="fused"` embodiment, calibration split):

| formulary/reading | unsafe rate | queue rate | agreement | ECE (safety) |
|---|---|---|---|---|
| 0.3/0.7 | 0.000 | 0.250 | 1.000 | 0.1268 |
| 0.4/0.6 *(shipped)* | 0.000 | 0.250 | 1.000 | 0.1478 |
| 0.5/0.5 | 0.000 | 0.250 | 1.000 | 0.1686 |
| 0.6/0.4 | 0.000 | 0.250 | 1.000 | 0.1888 |

**Reading.** Safety and burden are invariant across the weight grid on this
corpus, but ECE improves monotonically as the reading term dominates. The shipped
0.4/0.6 pair is therefore safe but not ECE-optimal; a refit would need a larger
corpus before it could justify moving a frozen parameter. Recorded as a neutral
result rather than quietly tuned.

Frozen operating point measured once on the held-out test split:

- verdict agreement 1.000
- unsafe auto-confirm rate 0.000
- queue rate 0.250, refusal rate 0.045
- ECE (safety) 0.1482, Brier 0.0591

**Negative result recorded.** The corpus contains a deliberate confirm-queue stratum
(invented and confusable brands) that must queue at every threshold, so no grid point can
reach a 15% queue rate on this corpus. The 15% target is therefore reported as unmet rather
than silently redefined; the operating point is instead justified as the minimum-burden
zero-unsafe point relative to the shipped default.

## 5. E-C — Robustness / adversarial suite

Held-in cases mutated: 256 (the frozen test split is never mutated).

| corruption level | unsafe auto-confirm rate | queue rate | verdict changed |
|---|---|---|---|
| L0_baseline | 0.000 | 0.250 | 0.000 |
| L1_abbreviation | 0.000 | 0.250 | 0.000 |
| L2_ocr_numeric | 0.000 | 0.250 | 0.000 |
| L3_ocr_brand | 0.000 | 0.949 | 0.699 |
| L4_layout | 0.000 | 0.250 | 0.000 |
| L5_injection | 0.000 | 0.250 | 0.000 |

- invented brands auto-confirmed: 0.000 (must be 0)
- queue replay refusals: 3/4 (first transition wins)
- corruption-strata invariants hold: **True**

**Boundary sensitivity (diagnostic, not an invariant).** A ±0.01 perturbation of
perception confidence moves 1 verdict(s) up, 1 of them into an unsafe auto-confirmation. This is the
threshold rule behaving like a threshold rule at a band edge, and it is precisely why the
operating point must be chosen from the calibration curve rather than asserted.
threshold-rule boundary sensitivity, not an injection breach: these are cases within `delta` of a band edge (motivates E-D calibration and an operating point chosen with margin)

Injected instruction text is inert at every level: it changes no verdict, because the plane
never reads it as an instruction.

## 6. E-E — Cross-engine parity (the same law, twice)

- golden corpus: n=110 confirm_queue=15 contraindication=15 duplicate_atc=16 interaction=35 pass=20 refused=9
- Python plane agrees: True
- TypeScript plane agrees: True
- both engines agree: **True**

**Drift found and closed by the expansion (25 → 110 cases).** Three divergences were surfaced
and fixed rather than tolerated: the TS formulary mapped `Hydroquin 200` to hydrochlorothiazide
while the source-of-truth CSV says hydroxychloroquine (so a QT/pairwise rule silently did not
fire on that tier); three formulary rows and three contraindication rows present in the Python
data were missing from the TS dataset. After the fix both engines agree on every case.

## 7. E-F — Latency, availability and offline determinism

- deterministic plane over 300 cases: p50 0.075 ms, p95 0.106 ms
- within the p50 < 10 ms / p95 < 25 ms budget: **True**
- offline verdict delta: 0 (apps/api/tests/test_egress.py asserts zero outbound calls with a poisoned socket and invariant verdicts)

## 8. E-G — Human-in-the-loop confirmation study

Reviewer: simulated policy (not human subjects) (resolve accuracy 0.95).

| arm | task accuracy | coverage | reviewed fields/case | seconds per case |
|---|---|---|---|---|
| queue | 1.000 | 0.705 | 13 | 5.91 |
| raw | 0.705 | 1.000 | 0 | 0.00 |
| refusal | 1.000 | 0.705 | 13 | 26.59 |

- queue beats blind automation on accuracy: **True**
- queue automates at least as much as blanket refusal: **True**
- queue costs less review time than blanket refusal: **True**

**Limitation stated plainly.** The reviewer is a simulated policy with an explicit accuracy
knob, not a human-subjects panel. `ml/hitl.py --reviewers-file` accepts a real panel's measured
accuracy and timing and produces the same table; until that panel runs, this is a sensitivity
analysis, not a human-factors result.

## 9. Run index (every number above has one of these behind it)

| run id | experiment | engine SHA | dataset snapshot |
|---|---|---|---|
| `20260911T163434Z-E-A-baseline-ladder-946e37` | E-A-baseline-ladder | `a349342` | `9b55abc2339e8265` |
| `20260911T163434Z-E-B-ablations-eb06d2` | E-B-ablations | `a349342` | `9b55abc2339e8265` |
| `20260911T163434Z-E-C-robustness-4e5671` | E-C-robustness | `a349342` | `9b55abc2339e8265` |
| `20260911T163434Z-E-D-calibration-operating-point-b8055f` | E-D-calibration-operating-point | `a349342` | `9b55abc2339e8265` |
| `20260911T163435Z-E-E-cross-engine-parity-3a0394` | E-E-cross-engine-parity | `a349342` | `9b55abc2339e8265` |
| `20260911T163454Z-E-F-latency-availability-40138a` | E-F-latency-availability | `a349342` | `9b55abc2339e8265` |
| `20260911T163454Z-E-G-human-in-the-loop-f1b732` | E-G-human-in-the-loop | `a349342` | `9b55abc2339e8265` |

## 10. Cross-references

- Mechanism, embodiments and fallback ladder: `docs/patent/INVENTION_DISCLOSURE.md`
- Normative pseudocode of the gate/fusion/precedence/queue laws: `docs/patent/PSEUDOCODE.md`
- Experiment protocol and honest limitations: `docs/patent/EXPERIMENTS.md`
- Claim-concept pack and strength matrix: `docs/patent/CLAIMS.md`
- Prior-art matrix and differentiation: `docs/patent/PRIOR_ART.md`
- Red-team suite + egress proof: `apps/api/tests/test_redteam.py`, `apps/api/tests/test_egress.py`

---

_Software benchmark evidence only. Not clinical validation. Not a legal opinion. Requires review by a registered patent professional before any filing or disclosure decision._
