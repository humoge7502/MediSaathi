"""Parity corpus v7 -> v8: one identity per drug, and the cases that proves.

v7 closed the dose ceiling's *provenance*. This version closes the ceiling's
*reach*, and the defect was not in either engine: it was in the keys.

  1. The same substance was filed under its salt, its British spelling and its
     US adopted name in different rows, and a lookup table can only find what it
     is keyed on. Measured on the pre-migration tables: `ferrous sulfate` brand
     rows reached **no** daily-dose ceiling at all, because the 325 mg iron cap
     was filed under `ferrous sulphate` — so P31, "T. Fefol 500 mg HS" beside a
     doxycycline, was labelled `pass` while the engine read the chelation row and
     nothing else. 500 mg/day of an ingredient that is a leading cause of
     paediatric poisoning death queued nothing in either plane.

  2. One regimen, two verdicts. `metronidazole + lithium` was documented `severe`
     under one identity and `moderate` under the other: the answer a patient got
     depended on the spelling printed on the strip they brought.

  3. The rule a brand could not reach was not always a small one. Lithium's
     pregnancy rule (Ebstein anomaly) is ABSOLUTE and sits under `lithium`, while
     the Jan Aushadhi and Lithosun rows said `lithium carbonate` — which reached
     4 contraindications, none of them pregnancy. P148 pins that half.

The rename is the fix; this corpus records what it changed in a verdict. P31 is
**relabelled on measurement**, not re-labelled by preference: the iron ceiling is
now reachable, so the case escalates, and the interaction it was originally
pinned for is still reported — under a stricter verdict, which is the only
direction a measured relabel is allowed to go. Its `expect_finding` moved from
"chelation" to "chelate" because the merged survivor of the two identical rules
states the mechanism as a verb; the web dataset row was aligned to that same
surviving sentence, so both planes now explain this interaction with the same
words and the same substring.

Run:  python tools/parity_v8.py       (idempotent; safe to re-run to append)
      python tools/parity_v8.py --check
"""
import json
import os

GOLDEN = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "eval", "parity", "golden.json")

NOTE_MARKER = "v8 (one identity per drug):"

NOTE_SUFFIX = (
    " v8 (one identity per drug): a drug has exactly one name in every table the "
    "engine indexes by, so a documented rule cannot be unreachable because of a "
    "spelling. The corpus gained P148 (lithium/pregnancy, ABSOLUTE, filed under "
    "the identity the strip does not print) and P31 was relabelled on measurement "
    "— the 325 mg iron ceiling became reachable from every ferrous sulfate brand, "
    "so a 500 mg/day course now queues in both planes where it passed in both. "
    "Relabels move toward the stricter verdict, never away, and every one carries "
    "the measurement that forced it."
)

# id, lines, contexts, expect, why, expect_finding, expect_not_finding
NEW_CASES = [
    ("P31", ["1. T. Fefol 500 mg HS x30d", "Cap. Doxy-1 BD X 10 DAYS"], [],
     "confirm_queue",
     "T. Fefol is ferrous SULFATE on the formulary, and the 325 mg/day iron "
     "ceiling was filed under the 'ferrous sulphate' spelling, so no iron brand "
     "could reach it: 500 mg/day queued nothing. Under one identity per drug the "
     "cap is found, and the chelation interaction this case was pinned for is "
     "still reported. expect_finding moved from 'chelation' to 'chelate': the "
     "merged row for doxycycline + ferrous sulfate states the mechanism as a "
     "verb, and the pin is that the interaction is still reported under a "
     "stricter verdict, not one row's inflection.",
     "chelate", None),
    ("P148", ["Tab Lithosun 300 1-0-0 x 30 days"], ["pregnancy"],
     "contraindication",
     "Lithium/pregnancy is an ABSOLUTE rule, but it was filed under 'lithium' "
     "while the brand row said 'lithium carbonate' — the strip a pregnant patient "
     "actually brings. Same drug, two identities, and the Ebstein anomaly rule "
     "was unreachable for the brand that prints the salt name.",
     "teratogenic", None),
]


def case(cid, lines, contexts, expect, why, finding, not_finding):
    c = {
        "id": cid,
        "lines": lines,
        "confidences": [0.97] * len(lines),
        "contexts": contexts,
        "expect": expect,
        "why": why,
    }
    if finding:
        c["expect_finding"] = finding
    if not_finding:
        c["expect_not_finding"] = not_finding
    return c


def main() -> None:
    check = "--check" in os.sys.argv
    with open(GOLDEN, encoding="utf-8") as f:
        doc = json.load(f)
    if str(doc["parity_version"]) not in ("7", "8"):
        raise SystemExit(f"expected parity_version 7 (or 8, to append), "
                         f"found {doc['parity_version']!r}")

    # P31 carries two confidence values for its two lines, which `case()` cannot
    # produce from a flat default; patch it after construction.
    overrides = {"P31": [0.97, 0.94]}

    by_id = {c["id"]: c for c in doc["cases"]}
    added = 0
    corrected = 0
    for (cid, lines, contexts, expect, why, finding, not_finding) in NEW_CASES:
        want = case(cid, lines, contexts, expect, why, finding, not_finding)
        if cid in overrides:
            want["confidences"] = overrides[cid]
        got = by_id.get(cid)
        if got is None:
            if not check:
                doc["cases"].append(want)
            added += 1
            continue
        if got != want:
            # A case that drifted from its measured expectation is the corpus
            # lying about the law, so --check reports it and a real run repairs it.
            corrected += 1
            if not check:
                doc["cases"][doc["cases"].index(got)] = want

    if check:
        if added or corrected:
            raise SystemExit(f"corpus is not at v8: {added} cases missing, "
                             f"{corrected} drifted")
        if NOTE_MARKER.strip() not in doc["note"]:
            raise SystemExit("corpus note does not record the v8 law")
        print(f"corpus at v8: {len(doc['cases'])} cases")
        return

    doc["parity_version"] = 8
    doc["note"] = doc["note"].split(NOTE_MARKER, 1)[0].rstrip() + NOTE_SUFFIX
    with open(GOLDEN, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write("\n")

    counts: dict[str, int] = {}
    for c in doc["cases"]:
        counts[c["expect"]] = counts.get(c["expect"], 0) + 1
    print(f"v8: +{added} cases, {corrected} corrected -> {len(doc['cases'])} total "
          + " ".join(f"{k}={v}" for k, v in sorted(counts.items())))


if __name__ == "__main__":
    main()
