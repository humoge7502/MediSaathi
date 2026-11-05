"""Parity corpus v6 -> v7: the two dose numbers the table carried and the rules dropped.

v6 made the ceiling one auditable law. Writing the drift tests then showed that
one law still had two figures in it that neither engine was using:

  1. The label prints two numbers for several drugs and the rule read one.
     Ibuprofen's own curated note says "OTC self-care cap 1200 mg/day;
     prescription max 2400". Once the blocking figure moved to the prescription
     maximum — correctly, or every 600 mg TDS course queues — the 1200 became
     prose nobody executed, and a 1600 mg/day course went from warning to silent.
     A cap that only ever fires at the ceiling is not the whole rule.

  2. The patient can lower a ceiling, and the engine knew it. Paracetamol's note
     carries "2000 mg in liver disease, alcohol use, or weight <50 kg" and the
     app *asks* the patient for liver disease and alcohol as declared contexts —
     yet the dose rule compared against 4000 regardless. The reason level-guided
     drugs may not block is that the engine has no serum level; that excuse does
     not apply to a figure the person supplied themselves. 4600 mg/day of
     paracetamol across two brands is an advisory line in a healthy adult and a
     blocked regimen in a patient with severe liver disease, and before this the
     two were indistinguishable.

So `advisory_mg` and `lowered_by` become columns of the table of record, generated
into both tiers, and one classifier (`cap_check` in dosing.py, `capCheck` in
engine.ts) decides breach-versus-advise for both rules in both planes.

P144 and P146 are the same two prescriptions read with and without the
declaration; they disagree because the patient did, which is the point. P143 and
P147 are the standing-ceiling controls, and P144's `expect_not_finding` pins that
lowering a ceiling does not silently block a dose that is still inside the
escalation law.

The Python runner's finding text gains `report.warnings` and the queue `reason`
strings: the advisory sentence is a `warnings` entry here and a `dose` finding
there, so an assertion about a self-care limit was only checkable in one plane.
The haystacks now hold the same claims.

Run:  python tools/parity_v7.py       (idempotent; safe to re-run to append)
      python tools/parity_v7.py --check
"""
import json
import os

GOLDEN = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "eval", "parity", "golden.json")

NOTE_MARKER = "v7 (the second cap figure and the ceiling the patient lowers):"

NOTE_SUFFIX = (
    "\n\nv7 (the second cap figure and the ceiling the patient lowers): labels "
    "carry two numbers for several molecules — a self-care figure under a "
    "prescription maximum — and the rule executed only the top one, so an "
    "ibuprofen course at 1600 mg/day stopped saying anything at all once the "
    "blocking ceiling moved to 2400. `advisory_mg` keeps the lower figure as a "
    "warn-only threshold. `lowered_by` does the same for the ceiling a declared "
    "condition lowers: paracetamol 2000 mg/day under liver disease, citalopram 20 "
    "under 65 or hepatic impairment, tramadol and tapentadol in renal "
    "impairment — all figures already sitting in the curated notes, none of them "
    "executed. The engine's excuse for level-guided drugs is that it has no serum "
    "level; it does not apply to a number the patient declares, so those lines "
    "are measured against the lower ceiling and the escalation law runs on it."
)

DOLOROUS = ["Tab Dolo 650 650 mg QID x 3 days",
            "Tab Crocin Advance 500 mg QID x 3 days"]

# id, lines, contexts, expect, why, expect_finding, expect_not_finding
NEW_CASES = [
    ("P142", DOLOROUS, ["hepatic_severe"], "confirm_queue",
     "Two paracetamol brands, 4600 mg/day between them. Against the standing "
     "4000 ceiling this is a warning (P143); the patient's declared severe liver "
     "disease lowers the operative maximum to 2000, so the same read is now past "
     "1.5x a real ceiling and must reach a human.",
     "the declared conditions on this patient lower it from 4000 mg/day", None),
    ("P143", DOLOROUS, [], "duplicate_atc",
     "The same prescription, no declaration: 4600 mg/day is over the 4000 "
     "ceiling but under the 6000 escalation line, so the dose rule advises, the "
     "duplicate rule decides, and nothing queues.",
     "exceeds the 4000 mg/day", None),
    ("P144", ["Tab Dolo 650 650 mg QID x 3 days"], ["hepatic_severe"],
     "contraindication",
     "One line, 2600 mg/day. Liver disease makes it a contraindication and "
     "lowers the ceiling to 2000, but 2600 is still under 1.5x of 2000 — the "
     "escalation law does not move just because the ceiling did.",
     "lower it from 4000 mg/day", "daily dose exceeds the label maximum"),
    ("P145", ["Tab Brufen 400 400 mg QID x 3 days"], [], "pass",
     "1600 mg/day ibuprofen: legal prescription strength, above the 1200 the "
     "same label gives for unprescribed use. Said out loud, verdict unchanged — "
     "the figure that used to be the only one the table had.",
     "is above the 1200 mg/day ibuprofen self-care limit", None),
    ("P146", ["Tab Citalopram 20 20 mg TID x 14 days"], ["age_over_65"],
     "confirm_queue",
     "60 mg/day of citalopram in a patient who declared being over 65, for whom "
     "the label's own figure is 20 — three times the ceiling that applies to "
     "them, and the QT dose that the maximum exists to police.",
     "lower it from 40 mg/day", None),
    ("P147", ["Tab Citalopram 20 20 mg TID x 14 days"], [], "pass",
     "The identical line with nothing declared: 60 is over the 40 ceiling and "
     "exactly at the 1.5x escalation boundary, so it advises and passes. The "
     "pair with P146 is what pins that the difference is the declaration.",
     "exceeds the 40 mg/day", None),
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
    if str(doc["parity_version"]) not in ("6", "7"):
        raise SystemExit(f"expected parity_version 6 (or 7, to append), "
                         f"found {doc['parity_version']!r}")

    by_id = {c["id"]: c for c in doc["cases"]}
    added = 0
    corrected = 0
    for (cid, lines, contexts, expect, why, finding, not_finding) in NEW_CASES:
        want = case(cid, lines, contexts, expect, why, finding, not_finding)
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
            raise SystemExit(f"corpus is not at v7: {added} cases missing, "
                             f"{corrected} drifted")
        print(f"corpus at v7: {len(doc['cases'])} cases")
        return

    doc["parity_version"] = 7
    doc["note"] = doc["note"].split(NOTE_MARKER, 1)[0].rstrip() + NOTE_SUFFIX
    with open(GOLDEN, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write("\n")

    counts: dict[str, int] = {}
    for c in doc["cases"]:
        counts[c["expect"]] = counts.get(c["expect"], 0) + 1
    print(f"v7: +{added} cases, {corrected} corrected -> {len(doc['cases'])} total "
          + " ".join(f"{k}={v}" for k, v in sorted(counts.items())))


if __name__ == "__main__":
    main()
