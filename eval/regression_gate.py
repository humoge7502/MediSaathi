"""Eval regression gate (ADR-0013, audit finding TD-B).

CI runs the fixture benchmark on every push — but until now it asserted
nothing: severity drift and recall regressions passed green. This gate turns
the benchmark into a CONTRACT: `python eval/regression_gate.py` re-runs the
eval, loads the committed baseline (eval/baseline.json), and fails on any
metric drift beyond the thresholds below.

Thresholds are deliberately tight (the benchmark is deterministic against
sealed fixtures): any change is either an improvement (update the baseline in
the same PR and say why) or a regression (block the merge).

Usage:
    python eval/regression_gate.py            # run eval, compare, exit code
    python eval/regression_gate.py --update   # re-baseline after an intentional improvement
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

BASELINE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "baseline.json")

# metric -> (floor, "higher is better")
FLOORS = {
    "brand_recall": 0.95,
    "verdict_agreement": 1.00,
    "refusal_precision": 1.00,
}

# Absolute drift allowed per metric beyond the floor (guards against noise).
MAX_DROP = {
    "brand_recall": 0.01,
    "frequency_recall": 0.01,
}


def run_eval() -> dict:
    """Run the A4 benchmark in-process and return its result block."""
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "apps", "api")))
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "packages", "contracts")))

    import importlib.util

    spec = importlib.util.spec_from_file_location("eval_cli", os.path.join(os.path.dirname(__file__), "eval.py"))
    mod = importlib.util.module_from_spec(spec)
    # Import without executing __main__; eval.py guards with if __name__ == "__main__".
    spec.loader.exec_module(mod)

    import contextlib
    import io

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        # eval.main() prints and returns 0; capture the JSON it would print by
        # re-running its logic via --json path in-process is complex, so call
        # the module's main with argv patched.
        old_argv = sys.argv
        sys.argv = ["eval.py"]
        try:
            rc = mod.main()
        finally:
            sys.argv = old_argv
    if rc != 0:
        raise RuntimeError(f"eval.py exited {rc}")
    # Parse the human-readable summary line instead of re-implementing metrics:
    # the JSON path is authoritative; run it as a subprocess for exact numbers.
    out = subprocess.run(
        [sys.executable, os.path.join(os.path.dirname(__file__), "eval.py"), "--json"],
        capture_output=True, text=True, check=True)
    payload = json.loads(out.stdout)
    return payload["results"]


def check(results: dict, baseline: dict) -> list[str]:
    failures: list[str] = []
    for metric, floor in FLOORS.items():
        actual = results.get(metric)
        if actual is None:
            failures.append(f"metric missing from eval output: {metric}")
            continue
        if actual < floor:
            failures.append(f"{metric}={actual} below floor {floor}")
        base = baseline.get(metric)
        if base is not None and abs(base - actual) > MAX_DROP.get(metric, 0.0):
            failures.append(f"{metric} drifted from committed baseline: {base} -> {actual}")
    for metric in ("frequency_recall",):
        base = baseline.get(metric)
        actual = results.get(metric)
        if base is not None and actual is not None:
            drop = base - actual
            if drop > MAX_DROP.get(metric, 0.0):
                failures.append(f"{metric} regressed: {base} -> {actual} (max drop {MAX_DROP[metric]})")
    return failures


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--update", action="store_true", help="re-baseline after an intentional improvement")
    args = ap.parse_args()

    results = run_eval()
    if args.update:
        with open(BASELINE_PATH, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, sort_keys=True)
            f.write("\n")
        print(f"baseline updated: {BASELINE_PATH}")
        print(json.dumps(results, indent=2, sort_keys=True))
        return 0

    with open(BASELINE_PATH, encoding="utf-8") as f:
        baseline = json.load(f)
    failures = check(results, baseline)
    print(f"eval gate: n={results.get('n')} "
          f"brand_recall={results.get('brand_recall')} "
          f"frequency_recall={results.get('frequency_recall')} "
          f"verdict_agreement={results.get('verdict_agreement')} "
          f"refusal_precision={results.get('refusal_precision')}")
    if failures:
        print("EVAL GATE FAILED:")
        for msg in failures:
            print(f"  - {msg}")
        return 1
    print("EVAL GATE PASSED (metrics at or above floors and committed baseline)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
