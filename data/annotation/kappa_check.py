"""Cohen's kappa for the dual-annotation sheets (closes MED-005).

Usage:
    python kappa_check.py cases_annotation_sheet.csv
    python kappa_check.py regimen_annotation_sheet.csv

Reads annotator1_verdict / annotator2_verdict columns, reports raw agreement
and Cohen's kappa (po < pe handling per standard formula). Exit 0 when
kappa >= 0.7 (MED-005 target), 1 otherwise.
"""
import csv
import sys
from collections import Counter


def kappa(a: list[str], b: list[str]) -> tuple[float, float]:
    pairs = [(x.strip().lower(), y.strip().lower()) for x, y in zip(a, b)
             if x.strip() and y.strip()]
    if not pairs:
        return 0.0, 0.0
    n = len(pairs)
    po = sum(1 for x, y in pairs if x == y) / n
    ca, cb = Counter(x for x, _ in pairs), Counter(y for _, y in pairs)
    pe = sum((ca[k] / n) * (cb.get(k, 0) / n) for k in ca)
    if pe == 1.0:
        return po, 1.0 if po == 1.0 else 0.0
    k = (po - pe) / (1 - pe)
    return po, k


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    with open(sys.argv[1], encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    a = [r.get("annotator1_verdict", "") for r in rows]
    b = [r.get("annotator2_verdict", "") for r in rows]
    filled = sum(1 for x, y in zip(a, b) if x.strip() and y.strip())
    po, k = kappa(a, b)
    print(f"sheets compared: {filled}/{len(rows)} rows with both annotations")
    print(f"raw agreement: {po:.3f}   Cohen's kappa: {k:.3f}   (MED-005 target >= 0.70)")
    return 0 if k >= 0.70 else 1


if __name__ == "__main__":
    raise SystemExit(main())
