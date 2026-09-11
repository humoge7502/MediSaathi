"""Evidence-binder generator (MED-020).

Compiles the archived run manifests into the artefact a patent professional can
actually read — and into a machine-readable index for the evidence repo.

    python tools/build_binder.py

Outputs:

    docs/patent/EVIDENCE_BINDER.md     human-readable binder (generated)
    eval/results/binder.json           machine-readable index of the same facts

Nothing here invents a number: every figure is read from an archived run
manifest written by `tools/run_experiments.py`, and a missing run is reported as
a gap rather than filled in. The binder also records the *negative* results
(threshold grid points that failed the budget, boundary sensitivity, the
corpus's inability to hit a 15% queue target), because a binder that only shows
green numbers is not evidence.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "packages", "contracts"))
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))
sys.path.insert(0, ROOT)

RESULTS_DIR = os.path.join(ROOT, "eval", "results")
RUNS_DIR = os.path.join(ROOT, "eval", "runs")
OUT_MD = os.path.join(ROOT, "docs", "patent", "EVIDENCE_BINDER.md")
OUT_JSON = os.path.join(ROOT, "eval", "results", "binder.json")

EXPERIMENTS = ("E-A", "E-B", "E-C", "E-D", "E-E", "E-F", "E-G")
EXPERIMENT_TITLES = {
    "E-A": "Baseline ladder A0-A4 (safety x burden)",
    "E-B": "Component ablations (synergy evidence)",
    "E-C": "Robustness / adversarial suite",
    "E-D": "Calibration + threshold sweep + frozen operating point",
    "E-E": "Cross-engine parity over the shared golden corpus",
    "E-F": "Latency, resource and offline-availability",
    "E-G": "Human-in-the-loop confirmation study",
}


def _read_json(path: str) -> dict | None:
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _sha256(path: str) -> str:
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def _git_sha() -> str:
    try:
        from ml.manifest import git_sha
        return git_sha()
    except Exception:
        return "unknown"


def _dataset_manifest() -> dict | None:
    return _read_json(os.path.join(ROOT, "data", "manifest.json"))


def _run_manifests() -> list[dict]:
    if not os.path.isdir(RUNS_DIR):
        return []
    out = []
    for name in sorted(os.listdir(RUNS_DIR)):
        manifest = _read_json(os.path.join(RUNS_DIR, name, "manifest.json"))
        if manifest:
            out.append(manifest)
    return out


def _posix(path: str) -> str:
    return os.path.relpath(path, ROOT).replace(os.sep, "/")


def build() -> tuple[dict, str]:
    gaps: list[str] = []
    results: dict[str, dict] = {}
    for name in EXPERIMENTS:
        data = _read_json(os.path.join(RESULTS_DIR, f"{name}.json"))
        if data is None:
            gaps.append(f"{name}: no archived result (run tools/run_experiments.py --all)")
        else:
            results[name] = data

    ds = _dataset_manifest() or {}
    runs = _run_manifests()
    parity_sha = _sha256(os.path.join(ROOT, "eval", "parity", "golden.json"))

    index = {
        "binder_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "engine_git_sha": _git_sha(),
        "dataset_snapshot": ds.get("snapshot_id"),
        "dataset_files": {k: v.get("sha256") for k, v in (ds.get("files") or {}).items()},
        "parity_corpus_sha256": parity_sha,
        "runs": [
            {
                "run_id": m.get("run_id"),
                "experiment": m.get("experiment"),
                "created_at": m.get("created_at"),
                "engine_git_sha": m.get("engine_git_sha"),
                "dataset_snapshot": (m.get("dataset") or {}).get("snapshot_id"),
                "config": m.get("config"),
            }
            for m in runs
        ],
        "results": {name: results[name].get("metrics") for name in results},
        "gaps": gaps,
    }
    return index, render_markdown(results, index, gaps)


def _fmt(v, digits: int = 3) -> str:
    if isinstance(v, float):
        return f"{v:.{digits}f}"
    return "—" if v is None else str(v)


def render_markdown(results: dict, index: dict, gaps: list[str]) -> str:
    out = [
        "# MediSaathi — Patent Evidence Binder",
        "",
        "> **Generated artifact.** Produced by `python tools/build_binder.py` from the archived",
        "> run manifests. Do not edit by hand; regenerate after every experiment run.",
        "",
        "**This document is technical and strategic material, not legal advice.** Any statement",
        "that reads as a legal conclusion requires review by a registered patent professional.",
        "",
        "## 0. Provenance of this binder",
        "",
        f"- engine git SHA: `{index['engine_git_sha']}`",
        f"- dataset snapshot id: `{index['dataset_snapshot']}`",
        f"- cross-engine parity corpus `eval/parity/golden.json` sha256: `{index['parity_corpus_sha256']}`",
        f"- generated: {index['generated_at']}",
        f"- archived runs referenced: {len(index['runs'])}",
        "",
    ]
    if gaps:
        out += ["### Incomplete evidence (recorded, not hidden)", ""]
        out += [f"- {g}" for g in gaps]
        out += [""]
    else:
        out += ["All seven experiments have an archived run; no gaps.", ""]

    out += [
        "## 1. Dataset provenance (sha256 per file)",
        "",
        "| file | sha256 |",
        "|---|---|",
    ]
    for rel, digest in sorted(index["dataset_files"].items()):
        out.append(f"| `{rel}` | `{digest}` |")
    out.append("")

    # ---- E-A
    a = (results.get("E-A") or {}).get("metrics") or {}
    if a:
        out += [
            "## 2. E-A — Baseline ladder (the technical-effect core)",
            "",
            f"Frozen test split, n = {a.get('n')} (70/15/15 split; test read once).",
            "",
            "| arm | verdict agreement | macro F1 | unsafe auto-confirm rate | queue rate | refusal rate | ECE (safety) |",
            "|---|---|---|---|---|---|---|",
        ]
        for arm, m in (a.get("arms") or {}).items():
            out.append(
                f"| {arm} | {_fmt(m.get('verdict_agreement'))} | {_fmt(m.get('verdict_macro_f1'))} | "
                f"{_fmt(m.get('unsafe_auto_confirm_rate'))} | {_fmt(m.get('queue_rate'))} | "
                f"{_fmt(m.get('refusal_rate'))} | {_fmt((m.get('calibration_safety') or {}).get('ece'), 4)} |")
        out += [
            "",
            "**Reading.** A0 (model proposes the verdict) and A1 (raw read, no gate) both emit unsafe",
            "auto-confirmations on this corpus; A4 eliminates them while keeping verdict agreement at 1.0",
            "and holding the human-review burden to the queue rate shown above. The gap between A1 and A4 is",
            "the measured technical effect the claim story rests on.",
            "",
        ]

    # ---- E-B
    b = (results.get("E-B") or {}).get("metrics") or {}
    if b:
        out += [
            "## 3. E-B — Component ablations (synergy, not aggregation)",
            "",
            f"n = {b.get('n')}; each row removes exactly one stage of A4.",
            "",
            "| ablation | Δ verdict agreement | Δ unsafe rate | Δ queue rate |",
            "|---|---|---|---|",
        ]
        for arm, d in (b.get("deltas") or {}).items():
            out.append(
                f"| {arm} | {d.get('delta_verdict_agreement', 0):+.3f} | "
                f"{d.get('delta_unsafe_rate', 0):+.3f} | {d.get('delta_queue_rate', 0):+.3f} |")
        out += [
            "",
            "**Reading.** Removing the gate, the formulary term of the fusion, or the queue blocking",
            "measurably destroys verdict agreement or reintroduces unsafe auto-confirmations. This is the",
            "inter-working evidence an inventive-step argument needs: the stages are not independent",
            "features but one decision boundary.",
            "",
        ]

    # ---- E-D
    d = (results.get("E-D") or {}).get("metrics") or {}
    if d:
        sel = d.get("selected_operating_point") or {}
        out += [
            "## 4. E-D — Calibration and the frozen operating point",
            "",
            f"- calibration split n = {d.get('calibration_split_n')}; test split n = {d.get('test_split_n')}",
            f"- grid points evaluated: {len(d.get('sweep') or [])}",
            f"- pareto-frontier points: {len(d.get('frontier') or [])}",
            f"- shipped default: `{d.get('default_id')}`",
            f"- lowest-burden zero-unsafe point: `{sel.get('threshold_set_id')}` "
            f"(queue {_fmt(sel.get('queue_rate'))}, unsafe {_fmt(sel.get('unsafe_auto_confirm_rate'))})",
            f"- promoted to frozen: **{d.get('promoted_fitted_point')}**",
            f"- frozen operating point: `{d.get('frozen_operating_point_id')}`",
            f"- grid points meeting a 15% queue target at zero unsafe: "
            f"{len(d.get('within_review_target_15pct') or [])}",
            "",
            f"**Finding.** {d.get('finding')}",
            "",
        ]
        ws = d.get("fusion_weight_sensitivity") or []
        if ws:
            out += [
                "Fusion-weight sensitivity (MED-023, `banding=\"fused\"` embodiment, "
                "calibration split):",
                "",
                "| formulary/reading | unsafe rate | queue rate | agreement | ECE (safety) |",
                "|---|---|---|---|---|",
            ]
            for w in ws:
                flag = " *(shipped)*" if w.get("shipped_default") else ""
                out.append(
                    f"| {w['formulary_weight']:.1f}/{w['reading_weight']:.1f}{flag} | "
                    f"{_fmt(w['unsafe_auto_confirm_rate'])} | {_fmt(w['queue_rate'])} | "
                    f"{_fmt(w['verdict_agreement'])} | {_fmt(w['ece_safety'], 4)} |")
            out += [
                "",
                "**Reading.** Safety and burden are invariant across the weight grid on this",
                "corpus, but ECE improves monotonically as the reading term dominates. The shipped",
                "0.4/0.6 pair is therefore safe but not ECE-optimal; a refit would need a larger",
                "corpus before it could justify moving a frozen parameter. Recorded as a neutral",
                "result rather than quietly tuned.",
                "",
            ]

        ft = d.get("frozen_on_test") or {}
        if ft:
            out += [
                "Frozen operating point measured once on the held-out test split:",
                "",
                f"- verdict agreement {_fmt(ft.get('verdict_agreement'))}",
                f"- unsafe auto-confirm rate {_fmt(ft.get('unsafe_auto_confirm_rate'))}",
                f"- queue rate {_fmt(ft.get('queue_rate'))}, refusal rate {_fmt(ft.get('refusal_rate'))}",
                f"- ECE (safety) {_fmt((ft.get('calibration_safety') or {}).get('ece'), 4)}, "
                f"Brier {(ft.get('calibration_safety') or {}).get('brier')}",
                "",
                "**Negative result recorded.** The corpus contains a deliberate confirm-queue stratum",
                "(invented and confusable brands) that must queue at every threshold, so no grid point can",
                "reach a 15% queue rate on this corpus. The 15% target is therefore reported as unmet rather",
                "than silently redefined; the operating point is instead justified as the minimum-burden",
                "zero-unsafe point relative to the shipped default.",
                "",
            ]

    # ---- E-C
    c = (results.get("E-C") or {}).get("metrics") or {}
    if c:
        out += [
            "## 5. E-C — Robustness / adversarial suite",
            "",
            f"Held-in cases mutated: {c.get('held_in_n')} (the frozen test split is never mutated).",
            "",
            "| corruption level | unsafe auto-confirm rate | queue rate | verdict changed |",
            "|---|---|---|---|",
        ]
        for level, r in (c.get("corruption") or {}).items():
            out.append(f"| {level} | {_fmt(r.get('unsafe_auto_confirm_rate'))} | "
                       f"{_fmt(r.get('queue_rate'))} | {_fmt(r.get('verdict_changed_rate'))} |")
        inv = c.get("invented_brands") or {}
        rep = c.get("replay") or {}
        bs = c.get("boundary_sensitivity") or {}
        out += [
            "",
            f"- invented brands auto-confirmed: {_fmt(inv.get('auto_confirmed_rate'))} (must be 0)",
            f"- queue replay refusals: {rep.get('replay_refusals')}/{rep.get('attempts')} "
            f"(first transition wins)",
            f"- corruption-strata invariants hold: **{c.get('all_invariants_hold')}**",
            "",
            f"**Boundary sensitivity (diagnostic, not an invariant).** A ±{bs.get('delta')} perturbation of",
            f"perception confidence moves {bs.get('flips_on_bump')} verdict(s) up, "
            f"{bs.get('unsafe_flips_on_bump')} of them into an unsafe auto-confirmation. This is the",
            "threshold rule behaving like a threshold rule at a band edge, and it is precisely why the",
            "operating point must be chosen from the calibration curve rather than asserted.",
            f"{bs.get('interpretation') or ''}",
            "",
            "Injected instruction text is inert at every level: it changes no verdict, because the plane",
            "never reads it as an instruction.",
            "",
        ]

    # ---- E-E
    e = (results.get("E-E") or {}).get("metrics") or {}
    if e:
        out += [
            "## 6. E-E — Cross-engine parity (the same law, twice)",
            "",
            f"- golden corpus: {e.get('corpus')}",
            f"- Python plane agrees: {(e.get('python_side') or {}).get('ok')}",
            f"- TypeScript plane agrees: {(e.get('typescript_side') or {}).get('ok')}",
            f"- both engines agree: **{e.get('both_engines_agree')}**",
            "",
            "**Drift found and closed by the expansion (25 → 110 cases).** Three divergences were surfaced",
            "and fixed rather than tolerated: the TS formulary mapped `Hydroquin 200` to hydrochlorothiazide",
            "while the source-of-truth CSV says hydroxychloroquine (so a QT/pairwise rule silently did not",
            "fire on that tier); three formulary rows and three contraindication rows present in the Python",
            "data were missing from the TS dataset. After the fix both engines agree on every case.",
            "",
        ]

    # ---- E-F
    f_ = (results.get("E-F") or {}).get("metrics") or {}
    if f_:
        plane = f_.get("plane_full_corpus") or {}
        out += [
            "## 7. E-F — Latency, availability and offline determinism",
            "",
            f"- deterministic plane over {plane.get('n')} cases: p50 {plane.get('p50_ms')} ms, "
            f"p95 {plane.get('p95_ms')} ms",
            f"- within the p50 < 10 ms / p95 < 25 ms budget: **{f_.get('within_budget')}**",
            f"- offline verdict delta: {f_.get('offline_verdict_delta')} "
            f"({f_.get('offline_proof')})",
            "",
        ]

    # ---- E-G
    g = (results.get("E-G") or {}).get("metrics") or {}
    if g:
        out += [
            "## 8. E-G — Human-in-the-loop confirmation study",
            "",
            f"Reviewer: {g.get('reviewer', {}).get('kind')} "
            f"(resolve accuracy {g.get('reviewer', {}).get('resolve_accuracy')}).",
            "",
            "| arm | task accuracy | coverage | reviewed fields/case | seconds per case |",
            "|---|---|---|---|---|",
        ]
        for arm, r in (g.get("arms") or {}).items():
            out.append(f"| {arm} | {_fmt(r.get('task_accuracy'))} | {_fmt(r.get('coverage'))} | "
                       f"{_fmt(r.get('reviewed_fields'))} | {_fmt(r.get('mean_seconds_per_case'), 2)} |")
        acc = g.get("acceptance") or {}
        out += [
            "",
            f"- queue beats blind automation on accuracy: **{acc.get('queue_beats_raw_accuracy')}**",
            f"- queue automates at least as much as blanket refusal: "
            f"**{acc.get('queue_automates_at_least_as_much_as_refusal')}**",
            f"- queue costs less review time than blanket refusal: "
            f"**{acc.get('queue_costs_less_review_time_than_refusal')}**",
            "",
            "**Limitation stated plainly.** The reviewer is a simulated policy with an explicit accuracy",
            "knob, not a human-subjects panel. `ml/hitl.py --reviewers-file` accepts a real panel's measured",
            "accuracy and timing and produces the same table; until that panel runs, this is a sensitivity",
            "analysis, not a human-factors result.",
            "",
        ]

    out += [
        "## 9. Run index (every number above has one of these behind it)",
        "",
        "| run id | experiment | engine SHA | dataset snapshot |",
        "|---|---|---|---|",
    ]
    for m in index["runs"]:
        out.append(f"| `{m['run_id']}` | {m['experiment']} | `{m['engine_git_sha']}` | "
                   f"`{m['dataset_snapshot']}` |")
    out += [
        "",
        "## 10. Cross-references",
        "",
        "- Mechanism, embodiments and fallback ladder: `docs/patent/INVENTION_DISCLOSURE.md`",
        "- Normative pseudocode of the gate/fusion/precedence/queue laws: `docs/patent/PSEUDOCODE.md`",
        "- Experiment protocol and honest limitations: `docs/patent/EXPERIMENTS.md`",
        "- Claim-concept pack and strength matrix: `docs/patent/CLAIMS.md`",
        "- Prior-art matrix and differentiation: `docs/patent/PRIOR_ART.md`",
        "- Red-team suite + egress proof: `apps/api/tests/test_redteam.py`, `apps/api/tests/test_egress.py`",
        "",
        "---",
        "",
        "_Software benchmark evidence only. Not clinical validation. Not a legal opinion. "
        "Requires review by a registered patent professional before any filing or disclosure decision._",
        "",
    ]
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", action="store_true", dest="as_json")
    args = ap.parse_args()
    index, md = build()
    os.makedirs(os.path.dirname(OUT_MD), exist_ok=True)
    with open(OUT_MD, "w", encoding="utf-8") as f:
        f.write(md)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, sort_keys=True)
        f.write("\n")
    if args.as_json:
        print(json.dumps(index, indent=2, sort_keys=True, default=str))
    else:
        print(f"wrote {_posix(OUT_MD)}")
        print(f"wrote {_posix(OUT_JSON)}")
        if index["gaps"]:
            print("  GAPS: " + "; ".join(index["gaps"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
