# Patent evidence package

Technical and strategic material for a patent-professional review. **Nothing in
this directory is legal advice**, and no document here may be filed or publicly
disclosed without review by a registered patent professional.

## ⚠️ Disclosure-pause notice

`master` is already public. The architecture law, the thresholds and the small
ablation are therefore *already disclosed* by the repository's own history.
Everything in this directory — the corpus, the run manifests, the calibration
result, the binder — adds mechanism detail that is **not** yet public.

**Do not** publish, post, present, or demo the specific mechanism (the fusion
function, the three-band gate law, the queue-blocking semantics, the calibration
method or the numbers in the binder) beyond what `master` already shows, until
either (a) a provisional application is on file, or (b) counsel has advised
otherwise. See `CONTRIBUTING.md` → "Disclosure pause" and
`INVENTION_DISCLOSURE.md` §7.

## Contents

| File | What it is | Source of truth |
|---|---|---|
| `INVENTION_DISCLOSURE.md` | Problem, mechanism, embodiments, fallback ladder, inventor-contribution records | MED-021 |
| `CLAIMS.md` | Independent system/method claim concepts, dependent-claim ideas, claim-strength matrix | MED-022 |
| `PSEUDOCODE.md` | Normative pseudocode of the gate law, fusion, precedence and queue blocking | referenced by `apps/api/app/gate.py` |
| `EXPERIMENTS.md` | Experiment protocol, results, reproducibility and honest limitations | referenced by `ml/corpus.py` |
| `PRIOR_ART.md` | Prior-art matrix and differentiation strategy | audit §6 |
| `EVIDENCE_BINDER.md` | **Generated.** Every measured number, with its run manifest and SHAs | `tools/build_binder.py` |

## Regenerating the evidence

```bash
python tools/run_experiments.py --all   # E-A..E-G -> eval/runs/ + eval/results/
python tools/export_evidence.py         # -> apps/web/src/data/evidence.json (UI)
python tools/build_binder.py            # -> docs/patent/EVIDENCE_BINDER.md
```

Every number in the binder traces to an archived run directory under
`eval/runs/` that records the config, the dataset sha256 set, the engine commit
and the environment. A number without a manifest is not evidence.
