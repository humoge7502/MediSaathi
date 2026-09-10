"""MediSaathi eval CLI.

Runs the fixture corpus through the pipeline and reports brand recall,
verdict agreement, refusal precision, field-level extraction metrics, and
latency against data/cases_manifest.json + data/eval_labels.csv.

The A1-vs-A4 ablation ladder (master plan, section 34) lives here:

  A1  raw LLM, no schema, no gate      - simulated on fixtures by the
      `--ablation A1` flag: every field is accepted at face value, unknown
      brands are "normalized" by best-guess substring, refusals never happen.
  A4  full pipeline (schema + gate + deterministic plane) - the default run.

Usage (from repo root, after setup):
    python eval/eval.py                 # A4 table + score
    python eval/eval.py --json          # machine-readable results (committed per build)
    python eval/eval.py --ablation A1   # the no-safety-plane counterfactual
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import statistics
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "apps", "api")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "packages", "contracts")))

from app.routers.api import engine  # noqa: E402
from app.verdict import assemble  # noqa: E402
from app.vision import RefusalCandidate, extract  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LABELS = os.path.join(ROOT, "data", "eval_labels.csv")
MANIFEST = os.path.join(ROOT, "data", "cases_manifest.json")


def load_labels() -> dict:
    labels = {}
    if os.path.exists(LABELS):
        with open(LABELS, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                labels[row["sample_id"]] = row
    return labels


def run_case(case: dict, ablation: str) -> dict:
    """Run one manifest case through the requested pipeline variant."""
    sid = case["sample_id"]
    try:
        result = extract(sid)
    except RefusalCandidate:
        return {"brands": [], "verdict": "refused", "refused": True,
                "fields": [], "latency_ms": 0}

    ctx = {k: True for k in case.get("context", [])}
    report, items, _ = engine.run(result.fields, ctx)

    if ablation == "A1":
        # Raw-LLM counterfactual: keep every field at face value, no confirm
        # queue, refusals suppressed. Interactions still surfaced because even
        # the A1 world "reads" the pair - the point is to show what the gate
        # and formulary add on TOP of raw reading.
        brands = []
        for f in result.fields:
            row = engine.normalize(f.brand_text or f.raw_text)
            brands.append(row["brand"] if row else (f.brand_text or f.raw_text))
        brands = sorted(set(brands))
        return {"brands": brands, "verdict": "A1_raw_read", "refused": False,
                "fields": [f.model_dump() for f in result.fields],
                "latency_ms": result.latency_ms,
                "interaction_count": len(report.interactions),
                "contraindication_count": len(report.contraindications),
                "duplicate_count": len(report.duplicates)}

    verdict = assemble(engine, result, report, items)
    return {"brands": sorted(m.brand for m in report.medications),
            "verdict": verdict.kind.value, "refused": verdict.kind.value == "refused",
            "fields": [f.model_dump() for f in result.fields],
            "latency_ms": result.latency_ms}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", dest="as_json")
    ap.add_argument("--ablation", choices=["A1", "A4"], default="A4")
    args = ap.parse_args()

    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    labels = load_labels()

    rows, field_hits, field_total = [], 0, 0
    latencies: list[int] = []
    freq_hits = 0
    freq_total = 0
    for case in manifest:
        sid = case["sample_id"]
        out = run_case(case, args.ablation)
        got_brands, got_verdict, refused = out["brands"], out["verdict"], out["refused"]
        latencies.append(out.get("latency_ms", 0))

        expected_brands = sorted(case["expected_brands"])
        expected_verdict = case["expected_verdict"]
        base = expected_verdict.replace("_severe", "").replace("_moderate", "")

        if expected_brands:
            hits, total = len(set(got_brands) & set(expected_brands)), len(expected_brands)
        else:
            hits, total = (1, 1) if not got_brands else (0, 1)
        field_hits += hits
        field_total += total

        # frequency-level metric: does the parsed TAC match the labeled one?
        lab = labels.get(sid, {})
        if lab.get("expected_frequencies"):
            expected_freqs = [x for x in lab["expected_frequencies"].split("|") if x]
            got_freqs = [f["frequency"] for f in out["fields"] if f.get("frequency")]
            freq_total += len(expected_freqs)
            freq_hits += sum(1 for ef in expected_freqs if ef in got_freqs)

        rows.append({
            "sample_id": sid,
            "brands_extracted": ";".join(got_brands),
            "brands_expected": ";".join(expected_brands),
            "brand_recall": round(hits / total, 3),
            "verdict": got_verdict,
            "verdict_expected": expected_verdict,
            "verdict_agree": str(got_verdict == base),
            "refusal_precise": str((base == "refused") == refused),
        })

    brand_recall = round(field_hits / max(field_total, 1), 4)
    verdict_agree = round(
        sum(1 for r in rows if r["verdict_agree"] == "True") / len(rows), 4)
    refusal_precision = round(
        sum(1 for r in rows if r["refusal_precise"] == "True") / len(rows), 4)
    freq_recall = round(freq_hits / freq_total, 4) if freq_total else None

    result_block = {
        "benchmark": "medisaathi-fixture-v0",
        "ablation": args.ablation,
        "n": len(rows),
        "brand_recall": brand_recall,
        "frequency_recall": freq_recall,
        "verdict_agreement": verdict_agree,
        "refusal_precision": refusal_precision,
        "latency_ms_p50": int(statistics.median(latencies)),
        "latency_ms_max": max(latencies),
        "build_tag": os.environ.get("MEDISAATHI_BUILD_TAG", "dev"),
    }

    if args.as_json:
        print(json.dumps({"results": result_block, "cases": rows}, indent=2))
    else:
        ablation_note = ("A1 raw-read counterfactual: no gate, no formulary, no refusal"
                         if args.ablation == "A1" else
                         "A4 full pipeline (schema + gate + deterministic plane)")
        print(f"ablation={args.ablation}  ({ablation_note})")
        print(f"n={len(rows)}  brand_recall={brand_recall}  "
              + (f"frequency_recall={freq_recall}  " if freq_recall is not None else "")
              + f"verdict_agreement={verdict_agree}  refusal_precision={refusal_precision}  "
              f"latency_p50={result_block['latency_ms_p50']}ms")
        print(f"{'case':8} {'brands':28} {'verdict':22} expected")
        for r in rows:
            mark = "OK " if r["verdict_agree"] == "True" else "MISS"
            print(f"{mark} {r['sample_id']:8} {r['brands_extracted'] or '-':28} "
                  f"{r['verdict']:22} {r['verdict_expected']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
