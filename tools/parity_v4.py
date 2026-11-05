"""One-shot migration: cross-engine parity corpus v3 -> v4.

Why the corpus is wrong, not the engines
----------------------------------------
Eight curated cases (P44, P45, P55, P56, P62, P63, P64, P65) prescribe ORAL
methotrexate (Folitrax) on a daily, twice-daily or four-times-daily regimen and
label the outcome "interaction". The interaction is real and both engines still
report it — but oral methotrexate for a non-oncologic indication is a weekly
drug, and a daily regimen is an ISMP high-alert never-event whose expected
outcome is death, not a warning. The label "interaction" caps the finding at the
least blocking verdict that still lets a plan be built and doses scheduled.

The corpus therefore under-reported the severity of its own eight most dangerous
cases. v4 relabels them confirm_queue, which is the only verdict that blocks
plan creation pending a human, and adds the interval-frequency coverage the
corpus never had (v3 contained zero weekly/alternate-day administration codes).

Every new label below was MEASURED from both planes before being written, not
asserted. See tools/_probe_interval.py (deleted after this lands).
"""
import json
import os

GOLDEN = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                      "eval", "parity", "golden.json")

FLIP = {
    "P44": "Folitrax (oral methotrexate) OD, plus an NSAID. Weekly-only drug dosed daily.",
    "P45": "Folitrax QID plus aspirin. Four oral MTX doses a day is the classic fatal error.",
    "P55": "Folitrax 1-0-0 (one tablet each morning) plus aspirin.",
    "P56": "Folitrax HS plus aspirin — a correct *time of day* on a wrong *interval*.",
    "P62": "Folitrax BD plus Combiflam BD.",
    "P63": "Folitrax BD plus aspirin at night.",
    "P64": "Folitrax OD plus an Ecospirin AV TAC line.",
    "P65": "Folitrax at night plus Ecosprin 75.",
}

# Measured agreement cases added in v4. Labels are the verdict BOTH planes
# produce for these lines; the point of the set is that the interval law is
# precise, so the legal side of the line must also be pinned.
NEW_CASES = [
    {"id": "P111", "lines": ["T. Folitrax 10 10 mg QWK x 28d"], "confidences": [0.97],
     "contexts": [], "expect": "pass",
     "interval_case": "Oral methotrexate ONCE WEEKLY is the label-correct regimen; the "
                      "hazard must not become a blanket block on the molecule."},
    {"id": "P112", "lines": ["T. Folitrax 10 10 mg QWK x 28d", "Cap. Combiflam OD X 7 DAYS"],
     "confidences": [0.97, 0.97], "contexts": [], "expect": "interaction",
     "expect_finding": "reduces renal m",
     "interval_case": "Weekly methotrexate + NSAID: the renal-clearance interaction still "
                      "fires on a legal interval, so P111/P112 bracket the hazard."},
    {"id": "P113", "lines": ["Tab Thyronorm 50 mcg OD 30 days"], "confidences": [0.97],
     "contexts": [], "expect": "pass",
     "interval_case": "mcg-unit strength must canonicalise, not mismatch its own formulary "
                      "row (Thyronorm 50 is a 50 mcg tablet)."},
    {"id": "P114", "lines": ["Tab Thyronorm 500 mcg OD 30 days"], "confidences": [0.97],
     "contexts": [], "expect": "confirm_queue",
     "interval_case": "A look-alike/different-strength read: the resolver matches the 50 mcg "
                      "row from a line reading 500 mcg. Identity unconfirmed outranks the "
                      "aggregate dose-cap finding computed on top of it."},
    {"id": "P115", "lines": ["Tab Folitrax 10 10 mg 1-0-0 x5d",
                             "1. T. Ecosprin 75 75 mg 1-0-0 x3d"],
     "confidences": [0.97, 0.97], "contexts": [], "expect": "confirm_queue",
     "expect_finding": "toxic",
     "interval_case": "The never-event arrives through a TAC slot code, not a word code — "
                      "proves the hazard reads both notations."},
    {"id": "P116", "lines": ["T. Folitrax 10 10 mg QW x 28d"], "confidences": [0.97],
     "contexts": [], "expect": "pass",
     "interval_case": "QW is an accepted synonym of QWK; an alias that failed to canonicalise "
                      "would pass nothing and would have queued the drug."},
    {"id": "P117", "lines": ["T. Folitrax 10 10 mg QWK x 28d",
                             "Tab Aspirin 75 75 mg 1-0-1 x 7d"],
     "confidences": [0.97, 0.97], "contexts": [], "expect": "interaction",
     "expect_finding": "toxic",
     "interval_case": "Weekly MTX + aspirin written as a TAC code: interaction, not hazard."},
    {"id": "P118", "lines": ["Tab Dolo 650 QOD 30 days"], "confidences": [0.97],
     "contexts": [], "expect": "pass",
     "interval_case": "Alternate-day dosing is a real interval the scheduler must space by "
                      "two days rather than collapse to daily."},
]

NOTE_SUFFIX = (
    " v4 (2026-10-25): the interval law. v3 labelled eight oral-methotrexate lines "
    "(P44, P45, P55, P56, P62, P63, P64, P65) merely 'interaction'. They dose a weekly-only "
    "drug daily or worse, which is an ISMP high-alert never-event, and 'interaction' is a "
    "verdict a plan can be built from. They are confirm_queue now; the interaction findings "
    "they were labelled for are still asserted via expect_finding and still fire, so the "
    "relabelling is an escalation, not a replacement. v3 held no interval-frequency cases at "
    "all; P111-P118 pin the law on both sides (weekly MTX passes, daily MTX queues) so a "
    "future scheduler that collapses 1/7 into one-slot-per-day fails the corpus instead of "
    "shipping."
)


def main() -> None:
    with open(GOLDEN, encoding="utf-8") as f:
        doc = json.load(f)

    assert doc["parity_version"] == 3, f"expected v3, found {doc['parity_version']}"
    by_id = {c["id"]: c for c in doc["cases"]}
    assert set(FLIP) <= set(by_id), f"unknown flip ids: {set(FLIP) - set(by_id)}"

    for pid, why in FLIP.items():
        case = by_id[pid]
        assert case["expect"] == "interaction", f"{pid} was relabelled already"
        case["expect"] = "confirm_queue"
        case["interval_case"] = why

    existing = set(by_id)
    for new in NEW_CASES:
        assert new["id"] not in existing, f"{new['id']} already exists"
        doc["cases"].append(new)

    doc["parity_version"] = 4
    doc["note"] = doc["note"] + NOTE_SUFFIX

    with open(GOLDEN, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write("\n")

    counts: dict[str, int] = {}
    for c in doc["cases"]:
        counts[c["expect"]] = counts.get(c["expect"], 0) + 1
    print(f"v4 written: {len(doc['cases'])} cases "
          + " ".join(f"{k}={v}" for k, v in sorted(counts.items())))


if __name__ == "__main__":
    main()
