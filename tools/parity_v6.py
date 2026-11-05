"""Parity corpus v5 -> v6: the daily-dose cap rule becomes one auditable law.

v5 closed the interval law's *reach*. This version closes the dose *ceiling*'s,
and the two defects found there were both measured before either engine was
touched:

  1. Divergent verdict on the same read. "Tab Cetzine 10 BD x 5 days" is 20 mg
     of cetirizine against a 10 mg/day licensed maximum. The TypeScript tier
     escalated that to an `interaction` verdict; the Python tier appended a
     string to `warnings` and returned `pass`. Same line, same tables, opposite
     answers — the aggregate-cap rule had simply never been mirrored at the
     verdict level, and the corpus had no case that exercised it, so 134/134
     agreement was real about everything except this.

  2. Three copies of the caps, disagreeing. dosing.py held a 306-entry literal,
     dataset.ts held another, and data/reference/dose_caps.csv — the only copy
     with a source cited per row — was read by nothing. They conflicted on 17
     molecules, and the conflicts were clinically real: the literals said
     theophylline 450 mg/day against the curated table's level-guided 900, so a
     routine modified-release 800 mg/day course verdicted as a fatal overdose
     (P42); ondansetron 32 mg was the historic *IV* single dose withdrawn over
     QT prolongation, applied to tablets; warfarin 10 mg and digoxin 0.5 mg were
     stored as ceilings when both are titrated to a measured value.

So the cap now travels the same route as a forbidden interval: hazard plus
confirm-queue item in BOTH tiers when the molecule's limit is a real limit and
the aggregate passes 1.5x of it, advisory in both tiers when it is not
(`HARD_CAP_MG`, generated from the CSV). Three relabels are measured, not
chosen: P41 and P89 were never overdoses at all — they are a brand label
carrying a *decimal* strength ("Alprax 0.5", "Digoxin 0.25") contradicted by the
milligram figure on the line, and the different-strength guard was blind to them
because its magnitude test rejected every bare number under 2, which is exactly
where the tenfold errors kill. P57 (simvastatin 20 mg QID = 80 mg/day, double the
maximum, beside gemfibrozil) is a true finding and now reaches a human.

Two new law-pins, one of them negative: P81 asserts that the engine no longer
*invents* 380 mg/day of atorvastatin from an aspirin-75 line, because a
combination brand stating one strength cannot donate it to every molecule it
expands to. The corpus gains `expect_not_finding` for that — a wrong verdict is
catchable by an expected label, but fabricated evidence is only catchable by
asserting it is absent.

Three of the four documented non-cases for this rule retire here: the cap
arithmetic, the cap *source*, and the level-guided exemption were all listed as
"per-tier unit test, not comparable across engines". They are comparable, they
were compared, and they disagreed.

Run:  python tools/parity_v6.py       (idempotent; safe to re-run to append)
      python tools/parity_v6.py --check
"""
import json
import os

GOLDEN = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "eval", "parity", "golden.json")

NOTE_MARKER = "v6 (dose-cap law and its ceiling's provenance):"

NOTE_SUFFIX = (
    "\n\nv6 (dose-cap law and its ceiling's provenance): the aggregate daily-cap "
    "rule was the last verdict-affecting rule that existed in only one plane. "
    "'Tab Cetzine 10 BD x 5 days' (20 mg against a 10 mg licensed maximum) "
    "verdicted interaction in the TypeScript tier and pass in the Python tier. "
    "The three caps tables also disagreed: two engine literals and one sourced "
    "CSV that no code read, conflicting on 17 molecules including theophylline "
    "(450 vs a level-guided 900, which made a routine 800 mg/day modified-release "
    "course read as a fatal overdose in P42) and ondansetron (32 = a withdrawn IV "
    "figure, vs 24 oral). One table of record now, generated to both tiers, with a "
    "`basis` and an `escalate` flag: a cap the engine cannot verify for THIS "
    "patient — level-guided, weight-based, specialist-supervised — advises and "
    "never blocks. P41/P89 relabel because the bug they were masking is a "
    "different-strength misread: the guard's magnitude test threw away every bare "
    "decimal under 2 mg, blinding it to Alprax 0.5 and Digoxin 0.25, the "
    "sub-2 mg class where a tenfold error is fatal. P81 gains "
    "expect_not_finding: applying one stated strength to every molecule of a "
    "combination brand invented 380 mg/day of atorvastatin on a statin+aspirin "
    "line, and only a negative assertion pins that the number stopped being made "
    "up."
)

# Measured relabels. Each is the SAME prescription read by the SAME tables, with
# the bug removed — not a re-judgement of the law.
RELABELS = {
    "P41": ("confirm_queue", "a 20x difference",
            "Alprax 0.5 states 10 mg on the line; 0.5 mg in the label. The old "
            "label (interaction) was computed from an invented 10 mg/day "
            "alprazolam course."),
    "P57": ("confirm_queue", "exceeds the 40 mg/day simvastatin cap",
            "Simvotin 20 QID = 80 mg/day, double the maximum, beside gemfibrozil. "
            "A true overdose now reaches a human instead of printing an "
            "interaction card."),
    "P89": ("confirm_queue", "a 2000x difference",
            "Digoxin 0.25 states 500 mg on the line. The invented 1000 mg/day "
            "aggregate is gone; the contradiction is what queues it."),
}

# P81 keeps its verdict but gains the negative assertion: no invented statin dose.
NEGATIVE_ASSERTS = {
    "P81": "exceeds the 80 mg/day atorvastatin cap",
}

NEW_CASES = [
    # --- the ceiling itself, both directions
    ("P135", ["Tab Cetzine 10 BD x 5 days"], "confirm_queue",
     "20 mg/day cetirizine against a 10 mg licensed maximum: the line that "
     "verdicted pass in one plane and interaction in the other.",
     "exceeds the 10 mg/day cetirizine cap"),
    ("P136", ["Tab Cetzine 10 OD x 5 days"], "pass",
     "Exactly at the cap, same brand same day: proves the rule is a ceiling and "
     "not a blanket block on the molecule.", None),
    ("P137", ["Tab Pan 40 TDS x 5 days"], "pass",
     "120 mg/day pantoprazole against an 80 mg cap = 1.5x, below the escalation "
     "line. Advisory in both planes, verdict unchanged.", None),
    # --- aggregate across lines, not within one
    ("P138", ["Tab Storvas 20 QID x 5 days"], "pass",
     "One line at exactly the atorvastatin maximum: no breach, no queue.", None),
    ("P139", ["Tab Storvas 20 QID x 5 days", "Tab Storvas 20 QID x 5 days"],
     "confirm_queue",
     "Two lines that are each AT the cap and therefore individually clean; only "
     "the aggregate breaches it. The rule exists for this, so it is pinned at the "
     "verdict level in both engines.",
     "exceeds the 80 mg/day atorvastatin cap"),
    # --- the ceiling that is not a ceiling
    ("P140", ["1. T. Alprax 0.5 10 mg once daily x30d"], "confirm_queue",
     "The decimal brand strength the different-strength guard used to discard: "
     "0.5 mg in the label, 10 mg on the line, a 20x contradiction to resolve.",
     "a 20x difference"),
    ("P141", ["Cap. Digoxin 0.25 500 mg BD x 5 days"], "confirm_queue",
     "Same class, narrower index: digoxin is titrated to a serum level, so its "
     "0.5 mg/day figure may only advise — what queues this line is the 2000x "
     "strength contradiction, not an invented microgram overdose.",
     "a 2000x difference"),
]


def case(cid, lines, expect, why, finding=None):
    c = {
        "id": cid,
        "lines": lines,
        "confidences": [0.97] * len(lines),
        "contexts": [],
        "expect": expect,
        "why": why,
    }
    if finding:
        c["expect_finding"] = finding
    return c


def main() -> None:
    check = "--check" in os.sys.argv
    with open(GOLDEN, encoding="utf-8") as f:
        doc = json.load(f)
    if str(doc["parity_version"]) not in ("5", "6"):
        raise SystemExit(f"expected parity_version 5 (or 6, to append), "
                         f"found {doc['parity_version']!r}")

    by_id = {c["id"]: c for c in doc["cases"]}
    relabelled = 0
    for cid, (expect, finding, why) in RELABELS.items():
        c = by_id.get(cid)
        if c is None:
            raise SystemExit(f"{cid} vanished from the corpus")
        if c["expect"] != expect:
            if not check:
                c["expect"] = expect
                c["expect_finding"] = finding
                c["why"] = f"{c.get('why', '').rstrip('. ')}. {why}"
            relabelled += 1
        if c.get("expect_finding") != finding and not check:
            c["expect_finding"] = finding

    negated = 0
    for cid, needle in NEGATIVE_ASSERTS.items():
        c = by_id.get(cid)
        if c is None:
            raise SystemExit(f"{cid} vanished from the corpus")
        if c.get("expect_not_finding") != needle:
            negated += 1
            if not check:
                c["expect_not_finding"] = needle

    added = 0
    for cid, lines, expect, why, finding in NEW_CASES:
        if cid in by_id:
            continue
        doc["cases"].append(case(cid, lines, expect, why, finding))
        added += 1

    if check:
        if relabelled or added or negated:
            raise SystemExit(f"corpus is not at v6: {relabelled} relabels, "
                             f"{negated} negative asserts, {added} cases missing")
        print(f"corpus at v6: {len(doc['cases'])} cases")
        return

    doc["parity_version"] = 6
    # Derived, not accumulated: re-running to append a case must not paste the
    # version section in twice.
    doc["note"] = doc["note"].split(NOTE_MARKER, 1)[0].rstrip() + NOTE_SUFFIX
    with open(GOLDEN, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write("\n")

    counts: dict[str, int] = {}
    for c in doc["cases"]:
        counts[c["expect"]] = counts.get(c["expect"], 0) + 1
    print(f"v6: +{added} cases, {relabelled} relabelled, {negated} negative "
          f"asserts -> {len(doc['cases'])} total "
          + " ".join(f"{k}={v}" for k, v in sorted(counts.items())))


if __name__ == "__main__":
    main()
