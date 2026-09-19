# MediSaathi — Patent Evidence Binder

> **Generated artifact.** Produced by `python tools/build_binder.py` from the archived
> run manifests. Do not edit by hand; regenerate after every experiment run.

**This document is technical and strategic material, not legal advice.** Any statement
that reads as a legal conclusion requires review by a registered patent professional.

## 0. Provenance of this binder

- engine git SHA: `14226de-dirty`
- dataset snapshot id: `fbbbec6c010476a3`
- cross-engine parity corpus `eval/parity/golden.json` sha256: `347ab35ce6cc5d3164b04372388eb380ea86f499ba091e05ed47b32c51a73622`
- generated: 2026-09-19T19:47:55+00:00
- archived runs referenced: 41

All eight experiments have an archived run; no gaps.

## 1. Dataset provenance (sha256 per file)

| file | sha256 |
|---|---|
| `data/brands.csv` | `f80a7fffc3a0b45c11c04dfcd9bd738063c1aadf0bb1e110491d2f1847f5b558` |
| `data/cases_manifest.json` | `a21750cf8bd5928049eac02df8628b6aca1de63307f0b72e86dd789a517fea65` |
| `data/contraindications.csv` | `4fa47481c3ee2440f22685b4f2438ed147212b9143f89e6dac0af03317cfffe2` |
| `data/corpus/adversarial.jsonl` | `a2f5c110b99a52abd1185c81d8efbf5334c4776056f6b38d75bad42ab230f854` |
| `data/corpus/cases.jsonl` | `f24dcaac92428f96a435fcf3fe5f0e4b21ae2591348d6a8e14721bab329022a7` |
| `data/corpus/codebook.json` | `51cb5806e907199c76d8aeeaa21a94b9dac62d26288064e0b2d7c9ad44a8ecea` |
| `data/corpus/regimen.jsonl` | `b95fa3af6f46688c712ff4233a7327f1ad91bd21063c0e0e7d30c5120176676e` |
| `data/corpus/splits.json` | `8ec31186e3ff81f82a28d7103391e519bc21d75c6444410b795c53ca47a415ab` |
| `data/eval_labels.csv` | `990578e855396f9eaf43d70d3e9ba2d4e9c8545e9cf97d25cb5684a8bdd75e4f` |
| `data/interactions.csv` | `176711b638925e5fe5f73b71be4bd83da0d2891157f4ad38fdde2fcf57bd2a55` |
| `data/sources.json` | `c6d4c3784409cb61187961b8340d48e82be3f05a5c94bb365f21f9a50196f4e4` |

## 2. E-A — Baseline ladder (the technical-effect core)

Frozen test split, n = 44 (70/15/15 split; test read once).

| arm | verdict agreement | macro F1 | unsafe auto-confirm rate | queue rate | refusal rate | ECE (safety) |
|---|---|---|---|---|---|---|
| A0 | 0.227 | 0.062 | 0.773 | 0.000 | 0.000 | 0.6727 |
| A1 | 0.705 | 0.601 | 0.295 | 0.000 | 0.000 | 0.2343 |
| A2 | 0.477 | 0.234 | 0.477 | 0.295 | 0.000 | 0.5888 |
| A3 | 0.705 | 0.601 | 0.295 | 0.000 | 0.000 | 0.2955 |
| A4 | 1.000 | 1.000 | 0.000 | 0.250 | 0.045 | 0.1452 |

**Reading.** A0 (model proposes the verdict) and A1 (raw read, no gate) both emit unsafe
auto-confirmations on this corpus; A4 eliminates them while keeping verdict agreement at 1.0
and holding the human-review burden to the queue rate shown above. The gap between A1 and A4 is
the measured technical effect the claim story rests on.

## 3. E-B — Component ablations (synergy, not aggregation)

n = 44; each row removes exactly one stage of A4.

| ablation | Δ verdict agreement | Δ unsafe rate | Δ queue rate |
|---|---|---|---|
| A4_minus_combination | -0.068 | +0.000 | +0.000 |
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
| 0.3/0.7 | 0.000 | 0.250 | 1.000 | 0.1225 |
| 0.4/0.6 *(shipped)* | 0.000 | 0.250 | 1.000 | 0.1436 |
| 0.5/0.5 | 0.000 | 0.250 | 1.000 | 0.1663 |
| 0.6/0.4 | 0.000 | 0.250 | 1.000 | 0.1870 |

**Reading.** Safety and burden are invariant across the weight grid on this
corpus, but ECE improves monotonically as the reading term dominates. The shipped
0.4/0.6 pair is therefore safe but not ECE-optimal; a refit would need a larger
corpus before it could justify moving a frozen parameter. Recorded as a neutral
result rather than quietly tuned.

Frozen operating point measured once on the held-out test split:

- verdict agreement 1.000
- unsafe auto-confirm rate 0.000
- queue rate 0.250, refusal rate 0.045
- ECE (safety) 0.1452, Brier 0.0564

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
perception confidence moves 0 verdict(s) up, 0 of them into an unsafe auto-confirmation. This is the
threshold rule behaving like a threshold rule at a band edge, and it is precisely why the
operating point must be chosen from the calibration curve rather than asserted.
threshold-rule boundary sensitivity, not an injection breach: these are cases within `delta` of a band edge (motivates E-D calibration and an operating point chosen with margin)

Injected instruction text is inert at every level: it changes no verdict, because the plane
never reads it as an instruction.

## 6. E-E — Cross-engine parity (the same law, twice)

- golden corpus: n=110 confirm_queue=15 contraindication=15 duplicate_atc=16 interaction=38 pass=17 refused=9
- Python plane agrees: True
- TypeScript plane agrees: True
- both engines agree: **True**

**Drift found and closed by the expansion (25 → 110 cases).** Three divergences were surfaced
and fixed rather than tolerated: the TS formulary mapped `Hydroquin 200` to hydrochlorothiazide
while the source-of-truth CSV says hydroxychloroquine (so a QT/pairwise rule silently did not
fire on that tier); three formulary rows and three contraindication rows present in the Python
data were missing from the TS dataset. After the fix both engines agree on every case.

## 7. E-F — Latency, availability and offline determinism

- deterministic plane over 300 cases: p50 0.086 ms, p95 0.685 ms
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

## 9. E-H — Longitudinal regimen plane (mechanisms A+B)

The 300-case corpus is single-prescription by construction, so it cannot contain a harm
that exists only because two prescriptions were composed. This experiment holds the
patient's active regimen fixed and varies the arriving prescription, comparing the
incumbent single-prescription law against (A) regimen composition and (A+B) regimen
composition with read-uncertainty propagation.

Corpus `data/corpus/regimen.jsonl`, n = 119 (84 cross-prescription).

| arm | unsafe pass on harm | cross-prescription caught | queue rate | agreement |
|---|---|---|---|---|
| regimen | 0.000 | 0.905 | 0.000 | 0.891 |
| regimen+propagation | 0.000 | 1.000 | 0.084 | 0.975 |
| single_rx | 0.832 | 0.000 | 0.000 | 0.294 |

**Reading.** The incumbent law cannot express a cross-prescription harm at all: it returns
a bare `pass` on 0.832 of the harmful cases here and catches
0.000 of the cross-prescription harms. Composing the active
regimen (mechanism A) closes almost all of that gap; read-uncertainty propagation
(mechanism B) closes the remainder by routing a read whose confusion neighbourhood could
hide a harm to the confirm queue, and removes the last unsafe auto-confirmations. The
marginal queue cost of mechanism B is small and bounded, because the coupling fires only
when uncertainty could *hide* harm, not whenever the read is uncertain.

**Limitation stated plainly.** The confusion neighbourhood is derived from brand-core string
similarity against this 96-brand formulary, so the fragile stratum is small (the number of
truly look-alike pairs the data contains). The mechanism is general; the size of its
demonstration here is bounded by the demo formulary, and a licensed DDInter/RxNorm snapshot
would widen it.

## 10. Run index (every number above has one of these behind it)

| run id | experiment | engine SHA | dataset snapshot |
|---|---|---|---|
| `20260911T174112Z-E-A-baseline-ladder-830e89` | E-A-baseline-ladder | `38f69fb` | `86bce3e0d7c3b1e9` |
| `20260911T174112Z-E-B-ablations-87f07b` | E-B-ablations | `38f69fb` | `86bce3e0d7c3b1e9` |
| `20260911T174113Z-E-C-robustness-782338` | E-C-robustness | `38f69fb` | `86bce3e0d7c3b1e9` |
| `20260911T174113Z-E-D-calibration-operating-point-cbda27` | E-D-calibration-operating-point | `38f69fb` | `86bce3e0d7c3b1e9` |
| `20260911T174113Z-E-E-cross-engine-parity-b730b8` | E-E-cross-engine-parity | `38f69fb` | `86bce3e0d7c3b1e9` |
| `20260911T174134Z-E-F-latency-availability-aaaef0` | E-F-latency-availability | `38f69fb` | `86bce3e0d7c3b1e9` |
| `20260911T174134Z-E-G-human-in-the-loop-b3b5f0` | E-G-human-in-the-loop | `38f69fb` | `86bce3e0d7c3b1e9` |
| `20260911T174134Z-E-H-regimen-longitudinal-48b096` | E-H-regimen-longitudinal | `38f69fb` | `86bce3e0d7c3b1e9` |
| `20260919T152651Z-E-A-baseline-ladder-ca7293` | E-A-baseline-ladder | `14226de-dirty` | `79af3382595f76a4` |
| `20260919T152651Z-E-B-ablations-b8fa2c` | E-B-ablations | `14226de-dirty` | `79af3382595f76a4` |
| `20260919T152652Z-E-C-robustness-d1a4bc` | E-C-robustness | `14226de-dirty` | `79af3382595f76a4` |
| `20260919T152652Z-E-D-calibration-operating-point-1aa45f` | E-D-calibration-operating-point | `14226de-dirty` | `79af3382595f76a4` |
| `20260919T152652Z-E-E-cross-engine-parity-becbd8` | E-E-cross-engine-parity | `14226de-dirty` | `79af3382595f76a4` |
| `20260919T152714Z-E-F-latency-availability-116c15` | E-F-latency-availability | `14226de-dirty` | `79af3382595f76a4` |
| `20260919T152714Z-E-G-human-in-the-loop-ca1afd` | E-G-human-in-the-loop | `14226de-dirty` | `79af3382595f76a4` |
| `20260919T152714Z-E-H-regimen-longitudinal-220d57` | E-H-regimen-longitudinal | `14226de-dirty` | `79af3382595f76a4` |
| `20260919T153106Z-E-A-baseline-ladder-1c4b71` | E-A-baseline-ladder | `14226de-dirty` | `34b253da8cab70ea` |
| `20260919T153106Z-E-B-ablations-8ecc19` | E-B-ablations | `14226de-dirty` | `34b253da8cab70ea` |
| `20260919T153106Z-E-C-robustness-bc6092` | E-C-robustness | `14226de-dirty` | `34b253da8cab70ea` |
| `20260919T153107Z-E-D-calibration-operating-point-2cca93` | E-D-calibration-operating-point | `14226de-dirty` | `34b253da8cab70ea` |
| `20260919T153107Z-E-E-cross-engine-parity-4807d9` | E-E-cross-engine-parity | `14226de-dirty` | `34b253da8cab70ea` |
| `20260919T153129Z-E-F-latency-availability-a327b8` | E-F-latency-availability | `14226de-dirty` | `34b253da8cab70ea` |
| `20260919T153129Z-E-G-human-in-the-loop-a58747` | E-G-human-in-the-loop | `14226de-dirty` | `34b253da8cab70ea` |
| `20260919T153129Z-E-H-regimen-longitudinal-a749bf` | E-H-regimen-longitudinal | `14226de-dirty` | `34b253da8cab70ea` |
| `20260919T153418Z-E-A-baseline-ladder-4d0624` | E-A-baseline-ladder | `14226de-dirty` | `34b253da8cab70ea` |
| `20260919T153418Z-E-B-ablations-eff486` | E-B-ablations | `14226de-dirty` | `34b253da8cab70ea` |
| `20260919T153418Z-E-C-robustness-690e01` | E-C-robustness | `14226de-dirty` | `34b253da8cab70ea` |
| `20260919T153419Z-E-D-calibration-operating-point-a9c77e` | E-D-calibration-operating-point | `14226de-dirty` | `34b253da8cab70ea` |
| `20260919T153419Z-E-E-cross-engine-parity-27d983` | E-E-cross-engine-parity | `14226de-dirty` | `34b253da8cab70ea` |
| `20260919T153442Z-E-F-latency-availability-ab9449` | E-F-latency-availability | `14226de-dirty` | `34b253da8cab70ea` |
| `20260919T153443Z-E-G-human-in-the-loop-e41b7a` | E-G-human-in-the-loop | `14226de-dirty` | `34b253da8cab70ea` |
| `20260919T153443Z-E-H-regimen-longitudinal-4a0a75` | E-H-regimen-longitudinal | `14226de-dirty` | `34b253da8cab70ea` |
| `20260919T194657Z-E-A-baseline-ladder-e8fba1` | E-A-baseline-ladder | `14226de-dirty` | `fbbbec6c010476a3` |
| `20260919T194657Z-E-B-ablations-236f87` | E-B-ablations | `14226de-dirty` | `fbbbec6c010476a3` |
| `20260919T194658Z-E-C-robustness-b35ba0` | E-C-robustness | `14226de-dirty` | `fbbbec6c010476a3` |
| `20260919T194658Z-E-D-calibration-operating-point-1ff25b` | E-D-calibration-operating-point | `14226de-dirty` | `fbbbec6c010476a3` |
| `20260919T194659Z-E-E-cross-engine-parity-36f4b3` | E-E-cross-engine-parity | `14226de-dirty` | `fbbbec6c010476a3` |
| `20260919T194720Z-E-F-latency-availability-cd82ce` | E-F-latency-availability | `14226de-dirty` | `fbbbec6c010476a3` |
| `20260919T194720Z-E-G-human-in-the-loop-d4a23d` | E-G-human-in-the-loop | `14226de-dirty` | `fbbbec6c010476a3` |
| `20260919T194741Z-E-H-regimen-longitudinal-a9b056` | E-H-regimen-longitudinal | `14226de-dirty` | `fbbbec6c010476a3` |
| `20260919T194749Z-E-A-baseline-ladder-94801a` | E-A-baseline-ladder | `14226de-dirty` | `fbbbec6c010476a3` |

## 11. Cross-references

- Mechanism, embodiments and fallback ladder: `docs/patent/INVENTION_DISCLOSURE.md`
- Normative pseudocode of the gate/fusion/precedence/queue laws: `docs/patent/PSEUDOCODE.md`
- Experiment protocol and honest limitations: `docs/patent/EXPERIMENTS.md`
- Claim-concept pack and strength matrix: `docs/patent/CLAIMS.md`
- Prior-art matrix and differentiation: `docs/patent/PRIOR_ART.md`
- Red-team suite + egress proof: `apps/api/tests/test_redteam.py`, `apps/api/tests/test_egress.py`

---

_Software benchmark evidence only. Not clinical validation. Not a legal opinion. Requires review by a registered patent professional before any filing or disclosure decision._
