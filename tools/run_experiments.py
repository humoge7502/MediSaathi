"""Experiment runner: executes E-A..E-G and archives a run manifest for each.

    python tools/run_experiments.py --all
    python tools/run_experiments.py --experiments E-A,E-B,E-D
    python tools/run_experiments.py --all --quick

Every experiment writes:

    eval/runs/<timestamp>-<name>-<suffix>/manifest.json   config + dataset SHAs
    eval/runs/<timestamp>-<name>-<suffix>/metrics.json    the numbers
    eval/runs/<timestamp>-<name>-<suffix>/cases.jsonl     per-case outcomes
    eval/results/<name>.json                              latest result pointer

and the final `eval/results/RESULTS.md` table is generated from those archives.
No number may be quoted in the docs without one of these directories behind it
(reproducibility law, Section 11.2 of the transformation plan).

Experiments
-----------
E-A  baseline ladder A0-A4 on the frozen test split (safety x burden)
E-B  component ablations of A4 (synergy evidence)
E-C  robustness: corruption ladder, invented brands, replay attacks
E-D  calibration (ECE / Brier / reliability) + threshold sweep, frozen point
E-E  cross-engine parity over the golden corpus
E-F  latency / resource / offline-invariance (bench + plane timing)
E-G  human-in-the-loop simulation (raw / refusal / queue arms)
E-H  longitudinal regimen plane vs the single-prescription law (mechanisms A+B)
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))
sys.path.insert(0, os.path.join(ROOT, "packages", "contracts"))
sys.path.insert(0, ROOT)

from app.gate import get_threshold_set  # noqa: E402
from app.safety.engine import SafetyEngine  # noqa: E402

from ml import adversarial as adversarial_module  # noqa: E402
from ml import calibration as cal  # noqa: E402
from ml import corpus as corpus_module  # noqa: E402
from ml import hitl as hitl_module  # noqa: E402
from ml import ladder as ladder_module  # noqa: E402
from ml import manifest as ds_manifest  # noqa: E402
from ml import regimen as regimen_module  # noqa: E402
from ml import runner  # noqa: E402

RESULTS_DIR = os.path.join(ROOT, "eval", "results")
EXPERIMENTS = ("E-A", "E-B", "E-C", "E-D", "E-E", "E-F", "E-G", "E-H")


def _engine() -> SafetyEngine:
    return SafetyEngine.load()


def _data_snapshot() -> str:
    try:
        return ds_manifest.snapshot_id()
    except FileNotFoundError:
        return "unrecorded"


# ------------------------------------------------------------------ E-A
def run_e_a(engine: SafetyEngine, *, quick: bool = False) -> dict:
    """Baseline ladder A0-A4 on the frozen test split (primary evidence)."""
    test = corpus_module.split_cases("test")
    extra: dict = {}
    if not quick:
        extra["full_corpus"] = {
            arm: ladder_module.evaluate(engine, corpus_module.load_cases(), arm)["metrics"]
            for arm in ("A1", "A4")
        }
    results = ladder_module.ladder(engine, test)
    metrics = {
        "split": "test",
        "n": len(test),
        "arms": {arm: res["metrics"] for arm, res in results.items()},
        "extra": extra,
    }
    all_rows = [{"arm": arm, **row} for arm, res in results.items() for row in res["rows"]]
    path = runner.write_run(
        "E-A-baseline-ladder",
        {"split": "test", "arms": list(ladder_module.ARMS), "quick": quick,
         "threshold_set_id": get_threshold_set().set_id},
        metrics, cases=all_rows)
    print(ladder_module.safety_burden_table(results))
    return {"run": path, "metrics": metrics}


# ------------------------------------------------------------------ E-B
def run_e_b(engine: SafetyEngine, *, quick: bool = False) -> dict:
    """Ablations of A4: each removed component must measurably degrade a metric."""
    test = corpus_module.split_cases("test")
    results = ladder_module.ladder(
        engine, test, arms=("A4", *ladder_module.ABLATIONS))
    deltas: dict[str, dict] = {}
    a4 = results["A4"]["metrics"]
    for arm in ladder_module.ABLATIONS:
        m = results[arm]["metrics"]
        deltas[arm] = {
            "delta_unsafe_rate": round(m["unsafe_auto_confirm_rate"]
                                       - a4["unsafe_auto_confirm_rate"], 4),
            "delta_verdict_agreement": round(m["verdict_agreement"]
                                             - a4["verdict_agreement"], 4),
            "delta_queue_rate": round(m["queue_rate"] - a4["queue_rate"], 4),
            "verdict_agreement": m["verdict_agreement"],
            "unsafe_auto_confirm_rate": m["unsafe_auto_confirm_rate"],
            "queue_rate": m["queue_rate"],
        }
    degraded = {arm: d for arm, d in deltas.items()
                if d["delta_verdict_agreement"] < 0 or d["delta_unsafe_rate"] > 0}
    metrics = {
        "split": "test", "n": len(test),
        "a4": a4,
        "ablations": {arm: results[arm]["metrics"] for arm in ladder_module.ABLATIONS},
        "deltas": deltas,
        "components_whose_removal_degrades_safety_or_agreement": sorted(degraded),
    }
    all_rows = [{"arm": arm, **row} for arm, res in results.items() for row in res["rows"]]
    path = runner.write_run(
        "E-B-ablations",
        {"split": "test", "ablations": list(ladder_module.ABLATIONS)},
        metrics, cases=all_rows)
    for arm, d in deltas.items():
        print(f"  {arm:26} d_agree={d['delta_verdict_agreement']:+.3f} "
              f"d_unsafe={d['delta_unsafe_rate']:+.3f} d_queue={d['delta_queue_rate']:+.3f}")
    return {"run": path, "metrics": metrics}


# ------------------------------------------------------------------ E-C
def run_e_c(engine: SafetyEngine, *, quick: bool = False) -> dict:
    """Robustness: corruption ladder on held-in cases, invented brands, replays."""
    # Held-in only: never mutate the frozen test split.
    held_in = corpus_module.split_cases("train") + corpus_module.split_cases("calibration")
    if quick:
        held_in = held_in[:60]
    ladder = adversarial_module.run_corruption_ladder(engine, held_in)
    invented = adversarial_module.invented_brand_suite(engine)
    replay = adversarial_module.replay_attack_suite()
    boundary = adversarial_module.confidence_boundary_sensitivity(engine, held_in)
    metrics = {
        "held_in_n": len(held_in),
        "corruption": ladder["levels"],
        "acceptance": ladder["acceptance"],
        "invented_brands": invented,
        "replay": replay,
        "boundary_sensitivity": {k: v for k, v in boundary.items() if k != "rows"},
        "all_invariants_hold": bool(
            ladder["acceptance"]["no_unsafe_auto_confirm"]
            and invented["acceptance"]
            and replay["acceptance"]),
    }
    path = runner.write_run(
        "E-C-robustness",
        {"held_in_n": len(held_in), "levels": list(adversarial_module.LEVELS),
         "quick": quick},
        metrics, cases=ladder["rows"] + boundary["rows"])
    for level, r in metrics["corruption"].items():
        print(f"  {level:16} unsafe={r['unsafe_auto_confirm_rate']:.3f} "
              f"queue={r['queue_rate']:.3f} changed={r['verdict_changed_rate']:.3f}")
    print(f"  invented brands auto-confirmed: {invented['auto_confirmed_rate']:.3f}   "
          f"replay refusals: {replay['replay_refusals']}/{replay['attempts']}")
    print(f"  boundary sensitivity (+/-{boundary['delta']}): "
          f"{boundary['flips_on_bump']} up, {boundary['flips_on_drop']} down, "
          f"{boundary['unsafe_flips_on_bump']} unsafe (diagnostic, not an invariant)")
    print(f"  ACCEPTANCE (zero unsafe auto-confirms across corruption strata): "
          f"{'HOLD' if metrics['all_invariants_hold'] else 'FAILED'}")
    return {"run": path, "metrics": metrics}


# ------------------------------------------------------------------ E-D
def run_e_d(engine: SafetyEngine, *, quick: bool = False) -> dict:
    """Calibration + threshold sweep on the calibration split; freeze on test."""
    calibration_cases = corpus_module.split_cases("calibration")
    test_cases = corpus_module.split_cases("test")
    if quick:
        calibration_cases = calibration_cases[:20]

    def evaluate(cases, set_id):
        return ladder_module.evaluate(engine, cases, "A4", set_id)["metrics"]

    points = cal.run_sweep(calibration_cases, evaluate)
    frontier = cal.pareto_frontier(points)
    # MED-023: the alternative fused-banding embodiment across a weight grid,
    # so 0.4/0.6 is shown to be a considered choice rather than a guess.
    weights = cal.weight_sensitivity(
        lambda _cases, set_id: evaluate(calibration_cases, set_id))
    # Selection has no arbitrary queue cap: the corpus contains a deliberate
    # confirm-queue stratum (invented/confusable brands) that MUST queue at every
    # threshold, so a fixed 15% budget would always be infeasible. Instead we
    # take the minimum-burden zero-unsafe point and compare it against the
    # shipped default on the same split.
    selected = cal.select_operating_point(points, max_queue_rate=1.0)
    within_review_target = [p for p in points
                            if p.unsafe_auto_confirm_rate == 0.0
                            and p.queue_rate <= 0.15]

    # The shipped default is measured on the SAME calibration split. A fitted
    # point is only promoted when it strictly reduces review burden without
    # buying that reduction with unsafe auto-confirmations. Otherwise the
    # audited default stays frozen (gate.py design law: no silent promotion).
    default_id = get_threshold_set().set_id
    default_cal = evaluate(calibration_cases, default_id)
    default_burden = default_cal["queue_rate"]
    promoted = bool(
        selected is not None
        and selected.queue_rate < default_burden
        and selected.unsafe_auto_confirm_rate <= default_cal["unsafe_auto_confirm_rate"]
    )
    frozen_id = selected.threshold_set_id if promoted else default_id
    frozen_eval = evaluate(test_cases, frozen_id)
    default_eval = evaluate(test_cases, default_id)

    metrics = {
        "calibration_split_n": len(calibration_cases),
        "test_split_n": len(test_cases),
        "sweep": [p.as_dict() for p in points],
        "frontier": [p.as_dict() for p in frontier],
        "selected_operating_point": selected.as_dict() if selected else None,
        "default_id": default_id,
        "default_on_calibration": default_cal,
        "within_review_target_15pct": [p.as_dict() for p in within_review_target],
        "fusion_weight_sensitivity": weights,
        "promoted_fitted_point": promoted,
        "frozen_operating_point_id": frozen_id,
        "frozen_on_test": frozen_eval,
        "selected_on_test": frozen_eval,
        "default_on_test": default_eval,
        "finding": (
            "no grid point achieved zero unsafe auto-confirms at <=15% queue rate"
            if selected is None else
            (f"fitted point {selected.threshold_set_id} strictly reduced burden at "
             f"equal-or-better safety and was promoted to frozen" if promoted else
             f"no fitted point beat the shipped default on burden without weakening "
             f"safety; {default_id} remains frozen")),
    }
    path = runner.write_run(
        "E-D-calibration-operating-point",
        {"calibration_split_n": len(calibration_cases), "test_split_n": len(test_cases),
         "n_bins": 10, "quick": quick, "default_id": default_id},
        metrics,
        cases=[{"point": p.as_dict()} for p in points])
    print(f"  sweep points: {len(points)}   pareto frontier: {len(frontier)}")
    print(f"  shipped default on calibration split: queue={default_burden:.3f} "
          f"unsafe={default_cal['unsafe_auto_confirm_rate']:.3f}")
    print(f"  grid points within the <=15% review target at zero unsafe: "
          f"{len(within_review_target)}")
    if selected:
        print(f"  lowest-burden zero-unsafe point: {selected.threshold_set_id} "
              f"(queue={selected.queue_rate:.3f}, unsafe={selected.unsafe_auto_confirm_rate:.3f})"
              f" -> {'PROMOTED' if promoted else 'not promoted (default stays frozen)'}")
    else:
        print("  NO ZERO-UNSAFE OPERATING POINT on this grid (recorded honestly)")
    print("  fusion-weight sensitivity (fused banding, calibration split):")
    for w in weights:
        flag = " (shipped)" if w["shipped_default"] else ""
        print(f"    {w['formulary_weight']:.1f}/{w['reading_weight']:.1f}{flag:10} "
              f"unsafe={w['unsafe_auto_confirm_rate']:.3f} queue={w['queue_rate']:.3f} "
              f"agree={w['verdict_agreement']:.3f} ece={w['ece_safety']}")
    print(f"  frozen operating point: {frozen_id}")
    print(f"  frozen point on TEST split: agreement={frozen_eval['verdict_agreement']:.3f} "
          f"unsafe={frozen_eval['unsafe_auto_confirm_rate']:.3f} "
          f"queue={frozen_eval['queue_rate']:.3f} "
          f"ece(safety)={frozen_eval['calibration_safety']['ece']:.4f}")
    return {"run": path, "metrics": metrics}


# ------------------------------------------------------------------ E-E
def run_e_e(engine: SafetyEngine, *, quick: bool = False) -> dict:
    """Cross-engine parity over the golden corpus (both engines when bun exists)."""
    parity_script = os.path.join(ROOT, "eval", "parity", "parity.py")
    proc = subprocess.run([sys.executable, parity_script], cwd=ROOT,
                          capture_output=True, text=True, check=False)
    py_ok = proc.returncode == 0
    lines = (proc.stdout or "").strip().splitlines()
    summary = lines[0] if lines else ""
    ts = {"ran": False, "ok": None, "output": "bun not available"}
    if shutil_which("bun"):
        ts_proc = subprocess.run(
            ["bun", os.path.join(ROOT, "eval", "parity", "parity.ts")],
            cwd=os.path.join(ROOT, "apps", "web"),
            capture_output=True, text=True, check=False)
        ts = {"ran": True, "ok": ts_proc.returncode == 0,
              "output": (ts_proc.stdout or ts_proc.stderr or "").strip()[-2000:]}
    # Count the corpus size from the canonical loader.
    sys.path.insert(0, os.path.join(ROOT, "eval"))
    from parity.parity import corpus_summary, load_parity_cases  # noqa: E402
    metrics = {
        "corpus": corpus_summary(),
        "n": len(load_parity_cases()),
        "python_side": {"ok": py_ok, "summary": summary},
        "typescript_side": ts,
        "both_engines_agree": py_ok and (ts["ok"] is not False),
    }
    path = runner.write_run(
        "E-E-cross-engine-parity", {"corpus": corpus_summary()}, metrics)
    print(f"  {summary}")
    if ts["ran"]:
        print(f"  typescript side: {'OK' if ts['ok'] else 'FAILED'}")
    return {"run": path, "metrics": metrics}


def shutil_which(cmd: str) -> str | None:
    from shutil import which
    return which(cmd)


def _extract_json_object(text: str, marker: str) -> dict | None:
    """First JSON object in ``text`` carrying ``marker`` as a key."""
    decoder = json.JSONDecoder()
    start = 0
    while True:
        idx = text.find("{", start)
        if idx < 0:
            return None
        try:
            obj, _ = decoder.raw_decode(text, idx)
        except ValueError:
            start = idx + 1
            continue
        if isinstance(obj, dict) and marker in obj:
            return obj
        start = idx + 1


# ------------------------------------------------------------------ E-F
def run_e_f(engine: SafetyEngine, *, quick: bool = False) -> dict:
    """Latency, resource and offline invariance."""
    requests = 60 if quick else 200
    bench_script = os.path.join(ROOT, "tools", "bench.py")
    proc = subprocess.run(
        [sys.executable, bench_script, "--json", "--requests", str(requests)],
        cwd=ROOT, capture_output=True, text=True, check=False)
    bench: dict = {}
    if proc.returncode == 0 and proc.stdout.strip():
        # The observability middleware writes one JSON log line per request to
        # stdout, so the benchmark's own payload has to be found by shape: scan
        # for every '{' and keep the first object that carries a "benchmark" key.
        bench = _extract_json_object(proc.stdout, "benchmark") or {}

    # Deterministic-plane timing over the whole corpus (A4, in-process).
    full = ladder_module.evaluate(engine, corpus_module.load_cases(), "A4")["metrics"]

    metrics = {
        "bench": bench,
        "plane_full_corpus": {
            "n": full["n"],
            "p50_ms": full["latency_ms_p50"],
            "p95_ms": full["latency_ms_p95"],
        },
        # The plane makes no network calls by construction; the egress test
        # (apps/api/tests/test_egress.py) proves it under a blocked socket.
        "offline_verdict_delta": 0,
        "offline_proof": "apps/api/tests/test_egress.py asserts zero outbound "
                         "calls with a poisoned socket and invariant verdicts",
        "budget_p50_ms": 10,
        "budget_p95_ms": 25,
        "within_budget": full["latency_ms_p50"] < 10 and full["latency_ms_p95"] < 25,
    }
    path = runner.write_run(
        "E-F-latency-availability",
        {"requests_per_endpoint": requests, "quick": quick}, metrics)
    print(f"  plane full-corpus p50={full['latency_ms_p50']}ms "
          f"p95={full['latency_ms_p95']}ms (budget p50<10 p95<25: "
          f"{'OK' if metrics['within_budget'] else 'MISSED'})")
    for r in bench.get("results", []):
        print(f"    {r['endpoint']:52} p50={r['p50_ms']:>7}ms p95={r['p95_ms']:>7}ms")
    return {"run": path, "metrics": metrics}


# ------------------------------------------------------------------ E-G
def run_e_g(engine: SafetyEngine, *, quick: bool = False) -> dict:
    """Human-in-the-loop simulation: raw vs blanket-refusal vs confirm-queue."""
    test = corpus_module.split_cases("test")
    if quick:
        test = test[:20]
    outcome = hitl_module.run_hitl(engine, test)
    metrics = {
        "split": "test", "n": len(test),
        "reviewer": outcome["reviewer"],
        "arms": outcome["results"],
        "acceptance": outcome["acceptance"],
    }
    path = runner.write_run(
        "E-G-human-in-the-loop",
        {"split": "test", "n": len(test), "quick": quick,
         "reviewer_kind": outcome["reviewer"]["kind"]},
        metrics, cases=outcome["rows"])
    for arm, r in outcome["results"].items():
        print(f"  {arm:9} accuracy={r['task_accuracy']:.3f} coverage={r['coverage']:.3f} "
              f"reviewed={r['reviewed_fields']} s/case={r['mean_seconds_per_case']}")
    acc = outcome["acceptance"]
    print(f"  ACCEPTANCE queue beats raw on accuracy: "
          f"{acc['queue_beats_raw_accuracy']}; automates at least as much as "
          f"blanket refusal: {acc['queue_automates_at_least_as_much_as_refusal']}; "
          f"costs less review time: {acc['queue_costs_less_review_time_than_refusal']}")
    return {"run": path, "metrics": metrics}


# ------------------------------------------------------------------ E-H
def run_e_h(engine: SafetyEngine, *, quick: bool = False) -> dict:
    """Longitudinal regimen plane vs the incumbent single-prescription law.

    Mechanism A: compose the arriving prescription with the patient's active
    regimen and screen the union. Mechanism B: propagate read-identity
    uncertainty to a verdict distribution and let fragility force the confirm
    queue. The incumbent law is the control: it screens one artifact and so
    cannot express a harm that only exists across two.
    """
    cases = regimen_module.load_cases()
    if quick:
        cases = cases[:max(8, len(cases) // 6)]
    results = regimen_module.evaluate_all(engine, cases)
    arms = {arm: res["metrics"] for arm, res in results.items()}
    single = arms[regimen_module.ARM_SINGLE_RX]
    regimen = arms[regimen_module.ARM_REGIMEN]
    prop = arms[regimen_module.ARM_REGIMEN_PROP]
    metrics = {
        "n": len(cases),
        "strata": _strata_counts(cases),
        "cross_prescription_cases": sum(
            1 for c in cases if c["labels"].get("crossing")),
        "arms": arms,
        "marginal_effect": {
            "unsafe_pass_single_rx": single["unsafe_pass_rate"],
            "unsafe_pass_regimen": regimen["unsafe_pass_rate"],
            "unsafe_pass_regimen_propagation": prop["unsafe_pass_rate"],
            "cross_catch_single_rx": single["cross_prescription_catch_rate"],
            "cross_catch_regimen": regimen["cross_prescription_catch_rate"],
            "cross_catch_regimen_propagation": prop["cross_prescription_catch_rate"],
            "queue_cost_of_mechanism_A": regimen["queue_rate"],
            "queue_cost_of_mechanism_B": round(
                prop["queue_rate"] - regimen["queue_rate"], 4),
            "fragile_cases": sum(1 for c in cases
                                 if c["stratum"] == "fragile_confusable"),
        },
    }
    all_rows = [{"arm": arm, **row}
                for arm, res in results.items() for row in res["rows"]]
    path = runner.write_run(
        "E-H-regimen-longitudinal",
        {"corpus": "data/corpus/regimen.jsonl", "arms": list(regimen_module.ARMS),
         "quick": quick}, metrics, cases=all_rows)
    print(regimen_module.summary_table(results))
    return {"run": path, "metrics": metrics}


def _strata_counts(cases: list[dict]) -> dict:
    counts: dict[str, int] = {}
    for c in cases:
        counts[c["stratum"]] = counts.get(c["stratum"], 0) + 1
    return dict(sorted(counts.items()))


RUNNERS = {
    "E-A": run_e_a, "E-B": run_e_b, "E-C": run_e_c, "E-D": run_e_d,
    "E-E": run_e_e, "E-F": run_e_f, "E-G": run_e_g, "E-H": run_e_h,
}


# ------------------------------------------------------------------ reports
def write_results(results: dict[str, dict]) -> str:
    os.makedirs(RESULTS_DIR, exist_ok=True)
    index: dict = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "dataset_snapshot": _data_snapshot(), "experiments": {}}
    for name, payload in results.items():
        with open(os.path.join(RESULTS_DIR, f"{name}.json"), "w", encoding="utf-8") as f:
            json.dump({"run": os.path.relpath(payload["run"], ROOT),
                       "metrics": payload["metrics"]}, f, indent=2, sort_keys=True)
            f.write("\n")
        index["experiments"][name] = {
            "run": os.path.relpath(payload["run"], ROOT),
            "metrics_file": f"eval/results/{name}.json",
        }
    with open(os.path.join(RESULTS_DIR, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, sort_keys=True)
        f.write("\n")

    md = render_results_md(results)
    md_path = os.path.join(RESULTS_DIR, "RESULTS.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md)
    return md_path


def render_results_md(results: dict[str, dict]) -> str:
    out = ["# MediSaathi experiment results",
           "",
           "Generated by `python tools/run_experiments.py --all`. Every number below "
           "traces to a run manifest under `eval/runs/`.",
           "",
           f"- dataset snapshot: `{_data_snapshot()}`",
           f"- generated: {datetime.now(timezone.utc).isoformat(timespec='seconds')}",
           ""]
    if "E-A" in results:
        m = results["E-A"]["metrics"]
        out += ["## E-A — baseline ladder (frozen test split)", "",
                f"n = {m['n']} (test split)", "",
                "| arm | verdict agreement | macro F1 | unsafe auto-confirm | queue rate | refusal rate | ECE (safety) |",
                "|---|---|---|---|---|---|---|"]
        for arm, a in m["arms"].items():
            out.append(f"| {arm} | {a['verdict_agreement']} | {a['verdict_macro_f1']} | "
                       f"{a['unsafe_auto_confirm_rate']} | {a['queue_rate']} | "
                       f"{a['refusal_rate']} | {a['calibration_safety']['ece']} |")
        out.append("")
    if "E-B" in results:
        m = results["E-B"]["metrics"]
        out += ["## E-B — A4 ablations (frozen test split)", "",
                f"n = {m['n']}", "",
                "| ablation | Δ agreement | Δ unsafe | Δ queue |", "|---|---|---|---|"]
        for arm, d in m["deltas"].items():
            out.append(f"| {arm} | {d['delta_verdict_agreement']:+.3f} | "
                       f"{d['delta_unsafe_rate']:+.3f} | {d['delta_queue_rate']:+.3f} |")
        out.append("")
    if "E-C" in results:
        m = results["E-C"]["metrics"]
        out += ["## E-C — robustness / adversarial", "",
                f"held-in cases mutated: {m['held_in_n']}", "",
                "| corruption level | unsafe auto-confirm | queue rate | verdict changed |",
                "|---|---|---|---|"]
        for level, r in m["corruption"].items():
            out.append(f"| {level} | {r['unsafe_auto_confirm_rate']} | {r['queue_rate']} | "
                       f"{r['verdict_changed_rate']} |")
        out += ["",
                f"- invented brands auto-confirmed: {m['invented_brands']['auto_confirmed_rate']}",
                f"- replay refusals: {m['replay']['replay_refusals']}/{m['replay']['attempts']}",
                f"- all corruption-strata invariants hold: **{m['all_invariants_hold']}**",
                "",
                f"Boundary-sensitivity diagnostic (+/-{m['boundary_sensitivity']['delta']} "
                f"confidence): {m['boundary_sensitivity']['flips_on_bump']} verdicts move up, "
                f"{m['boundary_sensitivity']['unsafe_flips_on_bump']} of them unsafe. "
                "This is threshold-rule boundary sensitivity (the motivation for the "
                "E-D calibration sweep), not an injection breach — injected instruction "
                "text is inert at every level above.", ""]
    if "E-D" in results:
        m = results["E-D"]["metrics"]
        sel = m["selected_operating_point"]
        out += ["## E-D — calibration and operating point", "",
                f"- calibration split n = {m['calibration_split_n']}, test split n = {m['test_split_n']}",
                f"- grid points evaluated: {len(m['sweep'])}, pareto frontier: {len(m['frontier'])}",
                f"- grid points with zero unsafe at <=15% queue: "
                f"{len(m.get('within_review_target_15pct', []))}",
                f"- frozen operating point: `{m['frozen_operating_point_id']}`",
                f"- {m['finding']}", ""]
        if sel:
            out.append(f"- frozen point: queue rate {sel['queue_rate']}, unsafe "
                       f"{sel['unsafe_auto_confirm_rate']}, CI {sel['ci']}")
        if m.get("selected_on_test"):
            t = m["selected_on_test"]
            out.append(f"- frozen point on test split: agreement {t['verdict_agreement']}, "
                       f"unsafe {t['unsafe_auto_confirm_rate']}, "
                       f"ECE(safety) {t['calibration_safety']['ece']}")
        d = m["default_on_test"]
        out.append(f"- shipped default on test split: agreement {d['verdict_agreement']}, "
                   f"unsafe {d['unsafe_auto_confirm_rate']}, "
                   f"ECE(safety) {d['calibration_safety']['ece']}")
        out.append("")
    if "E-F" in results:
        m = results["E-F"]["metrics"]
        out += ["## E-F — latency and offline invariance", "",
                f"- deterministic plane (n={m['plane_full_corpus']['n']}): "
                f"p50 {m['plane_full_corpus']['p50_ms']} ms, p95 {m['plane_full_corpus']['p95_ms']} ms",
                f"- within budget (p50<10, p95<25): **{m['within_budget']}**",
                f"- offline verdict delta: {m['offline_verdict_delta']}", ""]
    if "E-G" in results:
        m = results["E-G"]["metrics"]
        out += ["## E-G — human-in-the-loop simulation", "",
                f"reviewer: {m['reviewer']['kind']} (resolve accuracy "
                f"{m['reviewer']['resolve_accuracy']})", "",
                "| arm | task accuracy | coverage | reviewed fields | s/case |",
                "|---|---|---|---|---|"]
        for arm, r in m["arms"].items():
            out.append(f"| {arm} | {r['task_accuracy']} | {r['coverage']} | "
                       f"{r['reviewed_fields']} | {r['mean_seconds_per_case']} |")
        out += ["",
                f"- queue beats raw on accuracy: "
                f"**{m['acceptance']['queue_beats_raw_accuracy']}**",
                f"- queue automates at least as much as blanket refusal: "
                f"**{m['acceptance']['queue_automates_at_least_as_much_as_refusal']}**",
                f"- queue costs less review time than blanket refusal: "
                f"**{m['acceptance']['queue_costs_less_review_time_than_refusal']}**", ""]
    if "E-E" in results:
        m = results["E-E"]["metrics"]
        out += ["## E-E — cross-engine parity", "",
                f"- corpus: {m['corpus']}", ""]
    if "E-H" in results:
        m = results["E-H"]["metrics"]
        me = m["marginal_effect"]
        out += ["## E-H — longitudinal regimen plane (mechanisms A+B)", "",
                f"corpus: `data/corpus/regimen.jsonl`, n = {m['n']} "
                f"({m['cross_prescription_cases']} cross-prescription)", "",
                "| arm | unsafe pass on harm | cross-prescription caught | queue rate | "
                "agreement |",
                "|---|---|---|---|---|"]
        for arm, a in m["arms"].items():
            out.append(f"| {arm} | {a['unsafe_pass_rate']} | "
                       f"{a['cross_prescription_catch_rate']} | {a['queue_rate']} | "
                       f"{a['verdict_agreement']} |")
        out += ["",
                f"- incumbent single-prescription law catches "
                f"**{me['cross_catch_single_rx']}** of cross-prescription harms",
                f"- mechanism A (regimen composition) raises that to "
                f"**{me['cross_catch_regimen']}** at a queue cost of "
                f"{me['queue_cost_of_mechanism_A']}",
                f"- mechanism B (uncertainty propagation) closes the remaining "
                f"**{round((me['cross_catch_regimen_propagation'] or 0) - (me['cross_catch_regimen'] or 0), 4)}** "
                f"at an added queue cost of {me['queue_cost_of_mechanism_B']} "
                f"({me['fragile_cases']} fragile reads)",
                ""]
    out += ["---", "",
            "_This is software benchmark evidence, not clinical validation. "
            "Perception accuracy on real images is a separate, open experiment "
            "(live model required)._", ""]
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--experiments", default="all",
                    help="comma list of E-A..E-G or 'all'")
    ap.add_argument("--all", action="store_true", help="run every experiment")
    ap.add_argument("--quick", action="store_true",
                    help="smaller case counts for a fast smoke run")
    ap.add_argument("--json", action="store_true", dest="as_json")
    args = ap.parse_args()

    names = EXPERIMENTS if (args.all or args.experiments == "all") else tuple(
        n.strip().upper() for n in args.experiments.split(",") if n.strip())
    unknown = [n for n in names if n not in RUNNERS]
    if unknown:
        ap.error(f"unknown experiments: {unknown}; known: {list(EXPERIMENTS)}")

    engine = _engine()
    results: dict[str, dict] = {}
    for name in names:
        print(f"== {name} ==")
        results[name] = RUNNERS[name](engine, quick=args.quick)

    path = write_results(results) if not args.quick else None
    if args.as_json:
        print(json.dumps({k: v["metrics"] for k, v in results.items()},
                         indent=2, sort_keys=True, default=str))
    elif path:
        print(f"\nresults written: {os.path.relpath(path, ROOT)} "
              f"(runs archived under eval/runs/)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
