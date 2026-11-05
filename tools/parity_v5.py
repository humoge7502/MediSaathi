"""Corpus migration v4 -> v5: give the interval law its raw-text vocabulary.

The interval law itself was already mirrored in both planes (OD/BD/TDS/QID/QOD/
QWK/Q2W/QM and the never-event mandates). What was NOT mirrored was the
raw-line *vocabulary* that feeds it: the Python tier read one set of word codes
out of a prescription line, the TypeScript tier read a different set, and neither
read the plain English most Indian prescriptions actually use.

Measured before this migration, on identical lines:

  line written                     Python plane        TS plane
  ----------------------------------------------------------------
  "... every other day x 28d"     no frequency (pass)  QOD -> never-event queue
  "... every 3 days x 28d"        interval 3 -> queue  no frequency (pass)
  "... daily x 28d"               no frequency (pass)  no frequency (pass)

The first two are cross-engine divergences on the same law — precisely the drift
risk the corpus exists to close. The third is worse than both: bare "daily" is
the most common way an oral-methotrexate never-event is written on paper (ISMP
names the error as "daily instead of weekly"), and *neither* plane saw a
frequency at all, so no interval rule could fire on it.

Every case below was labelled from measured output of both planes after the
vocabulary was aligned; the two negative controls (weekly / q-3-weeks / q2w) are
there to prove the rule is interval-specific rather than molecule-blanketing, and
"Dolo daily" / "Thyronorm daily" prove plain-English codes did not become a
default block for drugs that are legitimately taken once a day.
"""
import json
import os

GOLDEN = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "eval", "parity", "golden.json")

MTX = "T. Folitrax 10 10 mg"

NOTE_MARKER = "v5 (interval-law reach):"

NOTE_SUFFIX = (
    "\n\nv5 (interval-law reach): the interval *rules* were mirrored across the two "
    "planes but the raw-line *vocabulary* that feeds them was not, and neither list "
    "carried the plain English prescriptions are written in. Three lines were "
    "measured divergent or blind before this version: \"every other day\" queued a "
    "methotrexate never-event in the TS plane while the Python plane read no "
    "frequency and passed it; \"every 3 days\" did the reverse; and \"daily\" — the "
    "single most common way an oral-methotrexate fatal schedule is written — carried "
    "no frequency in either plane, so no interval rule could fire. Both planes now "
    "read one ordered token list (LINE_FREQ_TOKENS, mirrored verbatim) plus prose "
    "day/week/month and hourly forms, and this version pins one case per token class. "
    "The negative controls (once weekly, q 3 weeks, Q2W) and the plain-English daily "
    "lines for paracetamol and levothyroxine are in the corpus so the fix cannot "
    "silently become a blanket block. P133/P134 also retire the last entry on the "
    "runner's documented non-case list: a frequency the law cannot read IS reachable "
    "from a raw line (\"Q5H\" — five hours does not divide a day; \"every 999 days\" "
    "— a legible shape carrying a nonsense value), so the queue rule for a "
    "stated-but-unreadable code is now a cross-engine case rather than a per-tier "
    "unit test."
)


def case(cid, lines, expect, why, finding=None):
    c = {
        "id": cid,
        "lines": lines,
        "confidences": [0.97] * len(lines),
        "contexts": [],
        "expect": expect,
        "interval_case": why,
    }
    if finding:
        c["expect_finding"] = finding
    return c


NEW_CASES = [
    case("P119", [f"{MTX} daily x 28d"], "confirm_queue",
         "Bare 'daily' on oral methotrexate: the ISMP never-event as it is actually "
         "written on paper. Before v5 neither plane saw a frequency here."),
    case("P120", [f"{MTX} ONCE DAILY x 28d"], "confirm_queue",
         "The same line with the two-word code. Ordering matters: 'ONCE DAILY' must "
         "win over the bare 'DAILY' inside it, and both must reach the same verdict."),
    case("P121", ["Cap. Folitrax 10 daily x 28d"], "confirm_queue",
         "'daily' with the strength stated only by the brand label — the brand-label "
         "fallback and the interval law have to compose for the hazard to fire."),
    case("P122", [f"{MTX} once weekly x 28d"], "pass",
         "Negative control in plain English: weekly is the labeled schedule, so this "
         "must pass rather than queue."),
    case("P123", [f"{MTX} every other day x 28d"], "confirm_queue",
         "Prose alternate-day methotrexate. Measured divergence: the TS plane blocked "
         "this while the Python plane read no frequency and passed it."),
    case("P124", [f"{MTX} alternate days x 28d"], "confirm_queue",
         "The Indian-English spelling of the same schedule; must not be a synonym the "
         "law cannot see."),
    case("P125", [f"{MTX} every 3 days x 28d"], "confirm_queue",
         "Prose numeric interval shorter than the 7-day mandate. The other half of the "
         "measured divergence (Python blocked, TS passed)."),
    case("P126", [f"{MTX} q 3 weeks x 28d"], "pass",
         "Prose interval in WEEKS, not days: 21 >= 7, so this is a legal schedule."),
    case("P127", [f"{MTX} Q2W x 28d"], "pass",
         "Abbreviated two-week code, present in the TS vocabulary and absent from the "
         "old Python one; both planes now read it and both pass it."),
    case("P128", [f"{MTX} 6 hourly x 2d"], "confirm_queue",
         "Hourly prose on a weekly-only molecule: four administrations a day, the "
         "classic fatal regimen, reached through the hourly vocabulary."),
    case("P129", [f"{MTX} bedtime x 28d"], "confirm_queue",
         "Bedtime prose canonicalizes to HS, which is a once-daily schedule, so the "
         "mandate bites — the bedtime read must not become 'no frequency'."),
    case("P130", [f"{MTX} once weekly x 28d", "1. T. Ecosprin 75 75 mg daily x 28d"],
         "interaction",
         "Weekly MTX with daily aspirin: the interaction is still found and still "
         "reported, and the aspirin line's plain 'daily' is not a hazard.", "clearance"),
    case("P131", ["Tab Dolo 650 daily x 5 days"], "pass",
         "Precision control: paracetamol once daily is correct dosing. Adding 'daily' "
         "to the vocabulary must not turn a legal plain-English line into a block."),
    case("P132", ["Tab Thyronorm 50 mcg daily 30 days"], "pass",
         "Precision control: levothyroxine once daily is correct dosing, in mcg."),
    case("P133", ["Tab Dolo 650 Q5H x 5 days"], "confirm_queue",
         "A code the line parser offers and the interval law refuses: five hours "
         "does not divide a day, so no generator can lay this out. Stated + unreadable "
         "is the queue's case, not a default to 09:00."),
    case("P134", ["Tab Dolo 650 every 999 days x 5 days"], "confirm_queue",
         "The same rule from the prose side: legible shape, nonsense value. This is "
         "the case previously documented as a parity NON-CASE on the theory that a "
         "garbage code is never extracted from a raw line — true of 'QODS', false of "
         "a code that parses as a shape and fails as a schedule."),
]


def main() -> None:
    with open(GOLDEN, encoding="utf-8") as f:
        doc = json.load(f)
    if str(doc["parity_version"]) not in ("4", "5"):
        raise SystemExit(f"expected parity_version 4 (or 5, to append), found {doc['parity_version']}")
    existing = {c["id"] for c in doc["cases"]}
    added = 0
    for c in NEW_CASES:
        if c["id"] in existing:
            continue
        doc["cases"].append(c)
        added += 1
    doc["parity_version"] = 5
    # The note is derived, not accumulated: re-running this migration (to append a
    # case) must not paste the version section in twice.
    doc["note"] = doc["note"].split(NOTE_MARKER, 1)[0].rstrip() + NOTE_SUFFIX
    with open(GOLDEN, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write("\n")
    counts: dict[str, int] = {}
    for c in doc["cases"]:
        counts[c["expect"]] = counts.get(c["expect"], 0) + 1
    print(f"v5: +{added} cases -> {len(doc['cases'])} total "
          + " ".join(f"{k}={v}" for k, v in sorted(counts.items())))


if __name__ == "__main__":
    main()
