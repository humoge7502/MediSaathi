"""Eval regression gate (ADR-0013, audit finding TD-B).

CI runs the fixture benchmark on every push — but until now it asserted
nothing: severity drift and recall regressions passed green. This gate turns
the benchmark into a CONTRACT: `python eval/regression_gate.py` re-runs the
eval, loads the committed baseline (eval/baseline.json), and fails on any
metric drift beyond the thresholds below.

Thresholds are deliberately tight (the benchmark is deterministic against
sealed fixtures): any change is either an improvement (update the baseline in
the same PR and say why) or a regression (block the merge).

`verdict_agreement` is the one metric that cannot be a bare number, because
three of its 111 labels are known-stale (TD-21). The gate instead asserts the
exact set of disagreeing sample ids, re-derives the aggregate from the case rows
that produced it, and raises the floor automatically as that set shrinks.

Usage:
    python eval/regression_gate.py            # run eval, compare, exit code
    python eval/regression_gate.py --update   # re-baseline after an intentional change
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

BASELINE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "baseline.json")

# metric -> floor (all higher-is-better)
FLOORS = {
    "brand_recall": 0.95,
    "refusal_precision": 1.00,
}

# Absolute drift allowed per metric beyond the floor (guards against noise).
MAX_DROP = {
    "brand_recall": 0.01,
    "frequency_recall": 0.01,
}

# TD-21: three sealed fixture labels are stale. They were labelled against the
# interaction and ATC tables as they stood at sealing; the engine now returns
# `confirm_queue` for all three, which is the correct answer, and the sealed set
# is frozen by design so the harness cannot be re-labelled in place.
#
# `verdict_agreement` therefore cannot have a numeric floor: 0.973 is acceptable
# and so is 1.000, and a bare number cannot tell them apart. What IS acceptable
# is exactly this set of disagreements and nothing else. So the floor is derived
# from the set — and the day TD-21 is resolved by re-sealing the fixtures, this
# set becomes empty, the floor returns to 1.00 on its own, and a gate that had
# been quietly tolerating three known-stale labels starts demanding none.
SEALED_STALE_VERDICTS = frozenset({"RX-045", "RX-088", "RX-089"})


def truthy(value: object) -> bool:
    """The eval JSON writes booleans as strings; accept both readings."""
    if isinstance(value, bool):
        return value
    return str(value).lower() == "true"


def verdict_disagreements(cases: list[dict]) -> set[str]:
    return {c["sample_id"] for c in cases if not truthy(c.get("verdict_agree"))}


def run_eval() -> dict:
    """Run the A4 benchmark in-process and return its full payload (results + cases)."""
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
    return json.loads(out.stdout)


def check(payload: dict, baseline: dict) -> list[str]:
    results = payload["results"]
    cases = payload.get("cases") or []
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

    # The verdict law, stated as a set rather than a number (TD-21). Three
    # sealed labels are known-stale, so 0.973 is the correct reading of this
    # fixture set — and 1.000 would be correct too, once they are re-sealed. A
    # numeric floor cannot tell those two states apart; the disagreement set can.
    if not cases:
        failures.append("eval payload carried no per-case rows: the verdict set law "
                        "cannot be checked against a bare aggregate")
        return failures

    stale = verdict_disagreements(cases)
    unexpected = sorted(stale - SEALED_STALE_VERDICTS)
    healed = sorted(SEALED_STALE_VERDICTS - stale)
    if unexpected:
        failures.append("new verdict regressions beyond the sealed-stale labels "
                        f"(TD-21): {', '.join(unexpected)}")
    if healed:
        failures.append("sealed-stale labels now agree: "
                        f"{', '.join(healed)} — remove them from SEALED_STALE_VERDICTS "
                        "and re-baseline; the floor rises with the set")

    expected = (len(cases) - len(stale)) / len(cases)
    actual = results.get("verdict_agreement")
    if actual is None:
        failures.append("metric missing from eval output: verdict_agreement")
    else:
        # The aggregate is re-derived from the rows it summarises, so a harness
        # that disagrees with itself cannot pass either direction of the check.
        if abs(actual - expected) > 0.005:
            failures.append(f"verdict_agreement={actual} does not recount from its own "
                            f"case rows: {len(stale)} disagreements over {len(cases)} "
                            f"cases is {expected:.4f}")
        base = baseline.get("verdict_agreement")
        if base is not None and abs(base - actual) > 0.005:
            failures.append(f"verdict_agreement drifted from committed baseline: {base} -> {actual}")
    return failures


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--update", action="store_true", help="re-baseline after an intentional improvement")
    args = ap.parse_args()

    payload = run_eval()
    results = payload["results"]
    if args.update:
        with open(BASELINE_PATH, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, sort_keys=True)
            f.write("\n")
        print(f"baseline updated: {BASELINE_PATH}")
        print(json.dumps(results, indent=2, sort_keys=True))
        return 0

    with open(BASELINE_PATH, encoding="utf-8") as f:
        baseline = json.load(f)
    failures = check(payload, baseline)
    disagreements = sorted(verdict_disagreements(payload.get("cases") or []))
    print(f"eval gate: n={results.get('n')} "
          f"brand_recall={results.get('brand_recall')} "
          f"frequency_recall={results.get('frequency_recall')} "
          f"verdict_agreement={results.get('verdict_agreement')} "
          f"refusal_precision={results.get('refusal_precision')}")
    print(f"  verdict disagreements: {len(disagreements)} "
          f"({'exactly the sealed-stale set — TD-21' if set(disagreements) == SEALED_STALE_VERDICTS else disagreements})")
    if failures:
        print("EVAL GATE FAILED:")
        for msg in failures:
            print(f"  - {msg}")
        return 1
    print("EVAL GATE PASSED (floors met, no verdict disagreement outside TD-21's stale set, "
          "metrics at the committed baseline)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
