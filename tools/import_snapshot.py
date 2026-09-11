"""Versioned knowledge-snapshot import (MED-027).

The knowledge layer currently ships curated CSV snapshots with recorded
provenance. This tool is the governed path for replacing them: it validates a
candidate snapshot against the schema, hashes it, diffs it against the live
table, and writes a review report. It **never mutates the live data unless
`--apply` is passed**, and even then it leaves a provenance entry behind.

    python tools/import_snapshot.py --kind interactions --source new_ddi.csv
    python tools/import_snapshot.py --kind brands --source new_brands.csv --apply

Schema (must match data/*.csv exactly):

    brands.csv            brand,molecule,form,atc,aware,jas_price_inr,source
    interactions.csv      molecule_a,molecule_b,severity,mechanism,source
    contraindications.csv molecule,condition_code,severity,note

Exit codes: 0 = valid (and applied if asked), 2 = schema/validation failure.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_DIR = os.path.join(ROOT, "data")
SNAPSHOT_DIR = os.path.join(DATA_DIR, "snapshots")

SCHEMAS: dict[str, tuple[str, ...]] = {
    "brands": ("brand", "molecule", "form", "atc", "aware", "jas_price_inr", "source"),
    "interactions": ("molecule_a", "molecule_b", "severity", "mechanism", "source"),
    "contraindications": ("molecule", "condition_code", "severity", "note"),
}

#: value domains the safety plane relies on; a bad value here is a silent
#: safety regression, so it fails the import rather than being coerced.
SEVERITIES = {"mild", "moderate", "severe", "absolute", "relative"}
AWARE = {"Access", "Watch", "Reserve"}


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def _read_csv(path: str) -> tuple[list[str], list[dict]]:
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader.fieldnames or []), [dict(r) for r in reader]


def validate(kind: str, header: list[str], rows: list[dict]) -> list[str]:
    problems: list[str] = []
    expected = SCHEMAS[kind]
    if tuple(header) != expected:
        problems.append(f"header mismatch: expected {list(expected)}, got {header}")
        return problems
    for i, row in enumerate(rows, start=2):
        if not any((v or "").strip() for v in row.values()):
            problems.append(f"line {i}: empty row")
            continue
        for col in expected:
            if (row.get(col) or "").strip() == "" and col not in ("jas_price_inr",):
                problems.append(f"line {i}: missing {col}")
        if kind == "brands":
            price = (row.get("jas_price_inr") or "").strip()
            if price:
                try:
                    if float(price) < 0:
                        problems.append(f"line {i}: negative price")
                except ValueError:
                    problems.append(f"line {i}: non-numeric jas_price_inr {price!r}")
            if (row.get("aware") or "").strip() not in AWARE:
                problems.append(f"line {i}: aware must be one of {sorted(AWARE)}")
        if kind in ("interactions", "contraindications"):
            sev = (row.get("severity") or "").strip().lower()
            if sev not in SEVERITIES:
                problems.append(f"line {i}: severity {sev!r} not in {sorted(SEVERITIES)}")
    return problems


def _key(kind: str, row: dict) -> tuple:
    if kind == "brands":
        return (row["brand"].strip().lower(),)
    if kind == "interactions":
        a, b = sorted((row["molecule_a"].strip().lower(), row["molecule_b"].strip().lower()))
        return (a, b)
    return (row["molecule"].strip().lower(), row["condition_code"].strip().lower())


def diff(kind: str, live: list[dict], candidate: list[dict]) -> dict:
    live_by_key = {_key(kind, r): r for r in live}
    cand_by_key = {_key(kind, r): r for r in candidate}
    added = sorted(set(cand_by_key) - set(live_by_key))
    removed = sorted(set(live_by_key) - set(cand_by_key))
    changed = sorted(
        k for k in set(live_by_key) & set(cand_by_key)
        if any((live_by_key[k].get(c) or "").strip().lower()
               != (cand_by_key[k].get(c) or "").strip().lower()
               for c in live_by_key[k])
    )
    return {
        "live_rows": len(live), "candidate_rows": len(candidate),
        "added": [list(k) for k in added],
        "removed": [list(k) for k in removed],
        "changed": [list(k) for k in changed],
        "unchanged": len(live_by_key) - len(changed),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--kind", required=True, choices=sorted(SCHEMAS))
    ap.add_argument("--source", required=True, help="candidate CSV path")
    ap.add_argument("--apply", action="store_true",
                    help="replace data/<kind>.csv with the candidate (leaves a report)")
    ap.add_argument("--out", default=None, help="report path (default data/snapshots/<kind>-<sha>.json)")
    ap.add_argument("--json", action="store_true", dest="as_json")
    args = ap.parse_args()

    if not os.path.exists(args.source):
        print(f"error: source not found: {args.source}", file=sys.stderr)
        return 2

    header, rows = _read_csv(args.source)
    problems = validate(args.kind, header, rows)
    if problems:
        print(f"INVALID: {len(problems)} problem(s) in {args.source}", file=sys.stderr)
        for p in problems[:25]:
            print(f"  - {p}", file=sys.stderr)
        if len(problems) > 25:
            print(f"  ... and {len(problems) - 25} more", file=sys.stderr)
        return 2

    live_path = os.path.join(DATA_DIR, f"{args.kind}.csv")
    _h, live_rows = _read_csv(live_path)
    report = {
        "kind": args.kind,
        "source": os.path.relpath(args.source, ROOT).replace(os.sep, "/"),
        "source_sha256": _sha256(args.source),
        "source_rows": len(rows),
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "schema_ok": True,
        "diff": diff(args.kind, live_rows, rows),
        "applied": False,
    }

    if args.apply:
        # Replace atomically, then record the provenance of what was applied.
        backup = live_path + ".bak"
        if os.path.exists(live_path):
            os.replace(live_path, backup)
        os.replace(args.source, live_path)
        report["applied"] = True
        report["applied_to"] = os.path.relpath(live_path, ROOT).replace(os.sep, "/")
        report["previous_sha256"] = _sha256(backup) if os.path.exists(backup) else None

    out = args.out or os.path.join(SNAPSHOT_DIR, f"{args.kind}-{report['source_sha256'][:12]}.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, sort_keys=True)
        f.write("\n")

    if args.as_json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        d = report["diff"]
        print(f"{args.kind}: schema OK ({report['source_rows']} rows, sha256 {report['source_sha256'][:12]})")
        print(f"  added {len(d['added'])} · removed {len(d['removed'])} · "
              f"changed {len(d['changed'])} · unchanged {d['unchanged']}")
        print(f"  {'APPLIED' if report['applied'] else 'dry run (pass --apply to replace the live table)'}")
        print(f"  report: {os.path.relpath(out, ROOT)}")
        if d["removed"]:
            print(f"  NOTE: {len(d['removed'])} row(s) would be REMOVED — a removed rule is a "
                  f"silent safety regression; review the diff before applying.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
