"""Build the single table of record for daily dose caps (ADR-0012, MED-007).

Before this tool existed the caps were three things at once: a 306-entry Python
literal in apps/api/app/safety/dosing.py, a second 306-entry literal in
apps/web/src/lib/safety/dataset.ts, and a 301-row sourced CSV in
data/reference/dose_caps.csv that no code ever read. The two live literals
agreed with each other and disagreed with the sourced table on 17 molecules,
and the disagreement was clinically real: the literals carry theophylline 450
where the curated table says 900 (level-guided, 5-15 mcg/mL), so a routine
modified-release 800 mg/day course verdicts as a fatal overdose, while the
literals carry warfarin 10 mg and digoxin 0.5 mg as if a once-daily figure were
a ceiling at all. It is not: those are level-guided drugs.

So this tool merges the three, applies the explicit adjudications below, and
emits two artifacts from one source:

    data/reference/dose_caps.csv          the table of record (reviewed by a
                                          human, not by me)
    apps/web/src/lib/safety/dose-caps.generated.ts
                                          the TypeScript tier's copy, generated

A drift test (apps/api/tests/test_dose_caps.py) re-reads the generated module
and fails if the two engines disagree on a single number, so the literals cannot
come back.

The two columns that make a cap usable by a rule are `basis` and `escalate`.
`basis` says what kind of limit the number is. `escalate` says whether crossing
1.5x of it may reach a human as a blocking hazard. Level-guided, weight-based and
specialist-supervised drugs are escalate=false: the engine has no blood level and
no body weight, so it cannot know the ceiling for THAT patient, and inventing one
produces a false never-event. Those lines still get an advisory warning.

`advisory_mg` and `lowered_by` carry the second number the same label prints.
`advisory_mg` is the warn-only figure below the blocking ceiling — the OTC
self-care cap that sits under a prescription maximum (ibuprofen 1200 under 2400),
so a 1600 mg/day course still says so out loud without queueing. `lowered_by` is
the ceiling the PATIENT lowers by declaring a context (paracetamol 2000 mg/day
under declared liver disease): the engine has no serum level, but it does have
what the person said about themselves, so the operative maximum becomes the lower
of the two and the blocking law applies to it.

Usage:
    python tools/build_dose_caps.py            # regenerate both artifacts
    python tools/build_dose_caps.py --check    # fail if they are stale
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.safety.dosing import DAILY_CAPS_MG as PY_LITERAL  # noqa: E402
from normalize_molecules import canonical  # noqa: E402

CSV_PATH = os.path.join(ROOT, "data", "reference", "dose_caps.csv")
TS_PATH = os.path.join(ROOT, "apps", "web", "src", "lib", "safety",
                       "dose-caps.generated.ts")

CURATED_SOURCE = "Adult oral label cap (DailyMed/BNF-level, curated)"

# Molecule identity is one name per drug, everywhere. tools/normalize_molecules.py
# owns the alias table and the curated tables are already migrated through it;
# this file writes dose_caps.csv, so the generator has to fold the same aliases
# or the next regeneration resurrects "lithium carbonate" as a ceiling no brand
# can look up. Measured on the pre-migration table: ADJUDICATIONS was keyed
# "lithium carbonate", the curated rows had BOTH "lithium" and "lithium
# carbonate", and PY_LITERAL had "ferrous sulphate", "lithium carbonate" and
# "calcium carbonate+vitamin d3" — three ceilings that the properly-named brands
# never reached.
_REVIEW_RANK = {"adjudicated": 2, "curated": 1, "needs_clinical_review": 0}


def _prefer(candidate: dict, incumbent: dict) -> bool:
    """An adjudicated row outranks a merely curated one; then the row whose own
    molecule cell is already the canonical spelling; then first seen."""
    a = _REVIEW_RANK.get((candidate.get("review_status") or "").strip(), 0)
    b = _REVIEW_RANK.get((incumbent.get("review_status") or "").strip(), 0)
    if a != b:
        return a > b
    return (candidate.get("molecule") or "") == canonical(candidate.get("molecule") or "") and \
        (incumbent.get("molecule") or "") != canonical(incumbent.get("molecule") or "")


def canon_map(mapping: dict, where: str) -> dict:
    """Re-key a name -> value mapping onto canonical molecule identities."""
    out: dict[str, object] = {}
    origins: dict[str, list[str]] = {}
    for name, value in mapping.items():
        c = canonical(name)
        origins.setdefault(c, []).append(name)
        incumbent = out.get(c)
        if incumbent is None:
            out[c] = value
        elif isinstance(value, dict) and isinstance(incumbent, dict) and _prefer(value, incumbent):
            out[c] = value
    for c, names in sorted(origins.items()):
        if len(names) > 1:
            print(f"  molecule merge [{where}]: {' + '.join(sorted(names))} -> {c}")
    return out

# Every conflict between the live literals and the sourced table, decided.
# `max` is the number the rule compares against; `escalate=False` means the rule
# may warn but may not block, because the true ceiling depends on a measurement
# or a decision the engine does not have.
ADJUDICATIONS: dict[str, dict] = {
    "allopurinol": {"max": 900.0, "basis": "renal-adjusted",
                    "escalate": False,
                    "why": "BNF maximum is renal-function dependent; 800 and 900 "
                           "are both defensible for a given patient, so the "
                           "engine cannot block on either."},
    "carbamazepine": {"max": 1600.0, "basis": "supervised",
                      "escalate": False,
                      "why": "1200 typical, 1600 licensed, 2000 under specialist "
                             "supervision - titration is the clinical decision."},
    "citalopram": {"max": 40.0, "basis": "licensed", "escalate": True,
                   "lowered_by": {"age_over_65": 20.0, "hepatic_severe": 20.0,
                                  "hepatic_moderate": 20.0},
                   "why": "40 mg/day licensed, 20 mg/day over 65 or in hepatic "
                          "impairment (QT). The curated note already states the "
                          "lower figure, and the app asks the patient for both "
                          "age band and liver disease as declared contexts, so for "
                          "those patients 40 is not the ceiling - see `lowered_by`."},
    "cetirizine": {"max": 10.0, "basis": "licensed",
                   "escalate": True,
                   "why": "10 mg/day is the licensed adult figure; the curated "
                          "table's 20 mg is specialist urticaria dosing. A "
                          "prescription reading 20 mg/day is worth a human look, "
                          "not a silent pass."},
    "clonazepam": {"max": 20.0, "basis": "supervised",
                   "escalate": False,
                   "why": "4 mg/day for panic, up to 20 mg/day in epilepsy under "
                           "supervision. The low figure blocks real epilepsy "
                           "prescriptions; the high one is not a ceiling."},
    "colchicine": {"max": 1.8, "basis": "indication-dependent",
                   "escalate": True,
                   "why": "1.5 mg/day prophylaxis, 1.8 mg on day 1 for a flare. "
                          "Above that is a genuine overdose risk with no "
                          "titration argument, so it stays blocking."},
    "fluconazole": {"max": 800.0, "basis": "indication-dependent",
                    "escalate": True,
                    "why": "400 mg covers most indications, 800 mg is used in "
                           "cryptococcal disease. 450 in the literals was too low "
                           "for the deep mycoses and too high for the rest."},
    "glibenclamide": {"max": 20.0, "basis": "licensed",
                      "escalate": True,
                      "why": "BNF ceiling 20 mg/day; 15 is a conservative practice "
                             "figure. Hypoglycaemia in an Indian outpatient is "
                             "severe enough that the higher figure stays blocking."},
    "ibuprofen": {"max": 2400.0, "basis": "otc-vs-prescription",
                  "escalate": True, "advisory": 1200.0,
                  "why": "1200 mg/day is the OTC self-care cap, 2400 is the "
                         "prescription maximum. A safety plane reading a "
                         "prescription must use the prescription figure, or every "
                         "legitimate 600 mg TDS course queues. The self-care "
                         "figure is kept as an advisory threshold so a 1600 mg/day "
                         "course still says so out loud."},
    "isotretinoin": {"max": 70.0, "basis": "weight-based",
                     "escalate": False,
                     "why": "0.5-1 mg/kg/day, and the target that matters is "
                            "cumulative mg/kg, not a daily ceiling."},
    "ivermectin": {"max": 18.0, "basis": "weight-based",
                   "escalate": False,
                   "why": "0.2-0.4 mg/kg. Neither 12 nor 24 is the ceiling for a "
                          "person whose weight the engine does not have."},
    "levocetirizine": {"max": 5.0, "basis": "licensed",
                       "escalate": True,
                       "why": "5 mg/day licensed; the curated 10 mg is not the "
                              "figure a routine prescription should pass at."},
    "loperamide": {"max": 16.0, "basis": "licensed", "escalate": True,
                   "advisory": 8.0,
                   "why": "16 mg/day is the label maximum; 8 mg/day is the "
                          "self-care figure kept as the advisory threshold. Above "
                          "either, the QT risk is the reason the number exists."},
    "metoprolol": {"max": 450.0, "basis": "salt-specific",
                   "escalate": True,
                   "why": "450 mg is the tartrate ceiling; the literals' 400 sat "
                          "between the two salts' figures without saying which."},
    "naproxen": {"max": 1500.0, "basis": "salt-specific",
                 "escalate": True, "advisory": 660.0,
                 "why": "660 OTC, 1000-1500 by prescription depending on the salt "
                        "(naproxen vs naproxen sodium). The ceiling is the top of "
                        "that range; 1000 blocked legitimate prescriptions. 660 is "
                        "kept as the self-care advisory threshold."},
    "ondansetron": {"max": 24.0, "basis": "qt-risk",
                    "escalate": True,
                    "why": "24 mg/day oral. The literals carried 32 mg, which is "
                           "the historic IV single-dose figure that was withdrawn "
                           "over QT prolongation - the wrong route's number."},
    "paracetamol": {"max": 4000.0, "basis": "licensed", "escalate": True,
                    "lowered_by": {"hepatic_severe": 2000.0,
                                   "hepatic_moderate": 2000.0,
                                   "alcohol": 2000.0},
                    "why": "4 g/day is the adult label maximum, and the ceiling the "
                           "engine blocks on for everyone else. The curated note "
                           "already carries the lower figure - 2 g/day in liver "
                           "disease, alcohol use or body weight under 50 kg - and "
                           "the patient declares liver disease and alcohol use as "
                           "contexts, so on those lines the operative ceiling is 2 g "
                           "and a 3 g/day stack of combination brands is a real "
                           "overdose, not an advisory. Weight is not collected, so "
                           "that half of the note stays unenforced and recorded."},
    "prednisolone": {"max": 100.0, "basis": "supervised",
                     "escalate": False,
                     "why": "Acute high-dose steroid is specialist-managed and "
                            "pulse regimens exceed any oral figure; long-term the "
                            "goal is the lowest possible dose. Neither is a "
                            "ceiling a plan-reading engine can enforce."},
    "tapentadol": {"max": 600.0, "basis": "licensed", "escalate": True,
                   "lowered_by": {"renal_moderate": 500.0, "renal_severe": 500.0},
                   "why": "600 mg/day label maximum; the curated note gives 500 mg "
                          "in moderate renal impairment, which the patient "
                          "declares, so the lower ceiling is the operative one for "
                          "those lines."},
    "theophylline": {"max": 900.0, "basis": "level-guided",
                     "escalate": False,
                     "why": "Dose is set by serum level (5-15 mcg/mL), not by a "
                            "daily ceiling. The literals' 450 made a routine "
                            "modified-release 800 mg/day course look lethal - "
                            "measured: parity case P42."},
    "torasemide": {"max": 200.0, "basis": "supervised",
                   "escalate": False,
                   "why": "40 mg is a heart-failure starting figure; 100-200 mg is "
                          "used in diuretic resistance under supervision."},
    "tramadol": {"max": 400.0, "basis": "licensed", "escalate": True,
                 "lowered_by": {"age_over_65": 300.0, "renal_moderate": 300.0,
                                "renal_severe": 300.0},
                 "why": "400 mg/day for immediate-release; the curated note gives "
                        "300 mg in the elderly and in renal impairment - both "
                        "declared contexts - so 400 is not the ceiling for those "
                        "patients."},
}

# Molecules the live literals knew and the sourced table did not.
ADDITIONS: dict[str, dict] = {
    "clopidogrel": {"max": 75.0, "basis": "maintenance",
                    "escalate": False, "advisory": 300.0,
                    "why": "75 mg/day is the MAINTENANCE dose, not a maximum: "
                           "300-600 mg loading at PCI is intentional and correct. "
                           "Treating 75 as a ceiling queued a legitimate loading "
                           "regimen - measured: parity case P88.",
                    "source": "Antiplatelet labelling (maintenance vs loading)"},
    "lithium carbonate": {"max": 2400.0, "basis": "level-guided",
                          "escalate": False,
                          "why": "Dose is serum-level driven (0.6-1.0 mmol/L); the "
                                 "mg figure is an output, not a limit.",
                          "source": "Mood-stabiliser labelling (level-guided)"},
    "salbutamol": {"max": 800.0, "basis": "supervised",
                   "escalate": False,
                   "why": "Oral salbutamol is titrated to response; the ceiling is "
                          "set by tolerance, not by a fixed maximum.",
                   "source": "Bronchodilator labelling (titrated)"},
    "valproate": {"max": 2500.0, "basis": "level-guided",
                 "escalate": False,
                 "why": "Weight-based start (10-15 mg/kg) then plasma-level "
                        "guided; no single daily ceiling applies.",
                 "source": "Anticonvulsant labelling (level-guided)"},
    "warfarin": {"max": 10.0, "basis": "level-guided",
                 "escalate": False,
                 "why": "Warfarin dose is set by INR. 10 mg/day is a common "
                        "upper practice figure, NOT a maximum - some patients "
                        "need far more. Blocking on it would be a false "
                        "never-event on the most dangerous drug in the list.",
                 "source": "Anticoagulant labelling (INR-guided)"},
}

# A cap the engine may block on is only useful if the limit is a limit. These
# note fragments, in the sourced table's own free text, mark the rows that are
# not ceilings.
NON_CEILING_HINTS = (
    "level-guided", "level guided", "mg/kg", "under supervision",
    "specialist", "weight-based", "titrate",
)


def load_curated() -> dict[str, dict]:
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        return {r["molecule"].strip().lower(): r for r in csv.DictReader(f)}


def basis_for(mol: str, note: str, adj: dict, add: dict) -> str:
    if mol in adj:
        return adj[mol]["basis"]
    if mol in add:
        return add[mol]["basis"]
    text = (note or "").lower()
    return "non-ceiling" if any(h in text for h in NON_CEILING_HINTS) else "licensed"


def escalate_for(mol: str, note: str, adj: dict, add: dict) -> bool:
    if mol in adj:
        return adj[mol]["escalate"]
    if mol in add:
        return add[mol]["escalate"]
    # Default: a stated ceiling is a ceiling. Only the note's own hedging
    # (levels, mg/kg, supervision) demotes it to advisory.
    return basis_for(mol, note, adj, add) != "non-ceiling"


def _number_or_blank(value: float | None) -> str:
    return "" if value is None else f"{value:g}"


def _lowered_text(value: dict[str, float] | None) -> str:
    """`context_code:mg;context_code:mg` - the machine-readable form of the note.

    A ceiling the patient's own declared context lowers is not a judgement call
    for the rule engine: it is the lower of two numbers it was given. Encoding it
    as data keeps the figure reviewable by a clinician in the CSV instead of
    buried in a sentence inside dosing.py.
    """
    if not value:
        return ""
    return ";".join(f"{code}:{_number_or_blank(mg)}"
                    for code, mg in sorted(value.items()))


def build_rows() -> list[dict]:
    curated = canon_map(load_curated(), "curated table")
    literal = canon_map(PY_LITERAL, "engine literal")
    adj = canon_map(ADJUDICATIONS, "adjudications")
    add = canon_map(ADDITIONS, "additions")
    molecules = sorted(set(curated) | set(literal) | set(adj) | set(add))
    rows: list[dict] = []
    for mol in molecules:
        adjud = adj.get(mol)
        addendum = add.get(mol)
        c = curated.get(mol)
        if adjud:
            value = adjud["max"]
            source = (c["source"] if c else CURATED_SOURCE)
            note = (c["note"] if c and c["note"] else "") or adjud["why"]
        elif addendum:
            value = addendum["max"]
            source = addendum["source"]
            note = addendum["why"]
        elif c:
            value = float(c["max_daily_mg"])
            source = c["source"]
            note = c["note"]
        else:
            # Only the literal knew this one. Keep the number, say where it came
            # from, and mark it for a human - silently laundering an unsourced
            # constant into a "curated" table is the thing that caused this.
            value = literal[mol]
            source = "engine literal, provenance not recorded"
            note = ""
        rows.append({
            "molecule": mol,
            "max_daily_mg": f"{value:g}",
            "advisory_mg": _number_or_blank((adjud or addendum or {}).get("advisory")),
            "lowered_by": _lowered_text((adjud or addendum or {}).get("lowered_by")),
            "basis": basis_for(mol, note, adj, add),
            "escalate": "true" if escalate_for(mol, note, adj, add) else "false",
            "note": note,
            "source": source,
            "review_status": "adjudicated" if (adjud or addendum) else
                             ("curated" if c else "needs_clinical_review"),
        })
    return rows


def write_csv(rows: list[dict]) -> None:
    fields = ["molecule", "max_daily_mg", "advisory_mg", "lowered_by", "basis",
              "escalate", "note", "source", "review_status"]
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def table_hash(rows: list[dict]) -> str:
    payload = [[r["molecule"], r["max_daily_mg"], r["advisory_mg"], r["lowered_by"],
                r["basis"], r["escalate"]] for r in rows]
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def write_ts(rows: list[dict]) -> None:
    h = table_hash(rows)
    caps = "\n".join(
        f'  "{r["molecule"]}": {r["max_daily_mg"]},' for r in rows)
    hard = sorted(r["molecule"] for r in rows if r["escalate"] == "true")
    basis = "\n".join(f'  "{r["molecule"]}": "{r["basis"]}",' for r in rows)
    advisory = "\n".join(
        f'  "{r["molecule"]}": {r["advisory_mg"]},' for r in rows if r["advisory_mg"])
    lowered = "\n".join(
        '  "{}": {{{}}},'.format(
            r["molecule"],
            ", ".join(f'"{part.split(":")[0]}": {part.split(":")[1]}'
                      for part in r["lowered_by"].split(";")))
        for r in rows if r["lowered_by"])
    src = f"""/* GENERATED - do not edit. Source: data/reference/dose_caps.csv
 * Build: python tools/build_dose_caps.py
 * Table hash: {h}
 *
 * The TypeScript tier's daily dose caps. These numbers used to be a literal
 * duplicated from the Python engine, and they disagreed with the sourced CSV on
 * 17 molecules; the disagreement was clinically real (theophylline 450 vs 900,
 * ondansetron 32 - an withdrawn IV figure - vs 24 oral). One table, one build,
 * one drift test.
 *
 * HARD_CAP_MG lists the molecules where crossing 1.5x the cap may BLOCK a plan
 * by sending the line to a human. Level-guided, weight-based and
 * specialist-supervised drugs are absent on purpose: the engine has no serum
 * level and no body weight, so a number it cannot verify is not a ceiling it
 * may enforce. Those lines still get an advisory finding.
 *
 * ADVISORY_MG is the lower, warn-only figure the same label carries - the OTC
 * self-care cap under a prescription maximum - and CAP_LOWERED_BY is the ceiling
 * the PATIENT lowers by declaring a context (liver disease, renal impairment,
 * age over 65). Neither is prose in the rule engine any more: both come from
 * columns of the table of record, so a clinician can audit the number without
 * reading code, and both planes read the same values.
 */

/** molecule -> maximum mg/day, from the table of record. */
export const DAILY_CAPS_MG: Record<string, number> = {{
{caps}
}};

/** Molecules whose cap is a real ceiling - the only ones that may block. */
export const HARD_CAP_MG: ReadonlySet<string> = new Set([
{chr(10).join(f'  "{m}",' for m in hard)}
]);

/** What each cap is, for the explainability string. */
export const CAP_BASIS: Record<string, string> = {{
{basis}
}};

/** Warn-only lower limit the same label carries; never blocks. */
export const ADVISORY_MG: Record<string, number> = {{
{advisory}
}};

/** Declared context -> the ceiling that context makes operative for that drug. */
export const CAP_LOWERED_BY: Record<string, Record<string, number>> = {{
{lowered}
}};

/** Changes with any edit to the source table; the Python tier asserts equality. */
export const DOSE_CAPS_TABLE_HASH = "{h}";
"""
    with open(TS_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)


def main() -> int:
    check = "--check" in sys.argv
    rows = build_rows()
    hard = sum(1 for r in rows if r["escalate"] == "true")
    print(f"{len(rows)} molecules | blocking {hard} | advisory-only "
          f"{len(rows) - hard} | adjudicated {sum(1 for r in rows if r['review_status'] == 'adjudicated')} "
          f"| needs clinical review {sum(1 for r in rows if r['review_status'] == 'needs_clinical_review')}")
    print(f"table hash {table_hash(rows)}")
    if check:
        current = open(TS_PATH, encoding="utf-8").read() if os.path.exists(TS_PATH) else ""
        want = re.search(r'DOSE_CAPS_TABLE_HASH = "([0-9a-f]{16})"', current)
        stale = not want or want.group(1) != table_hash(rows)
        if stale:
            raise SystemExit("generated dose-cap artifacts are stale; run "
                             "python tools/build_dose_caps.py")
        return 0
    # Back up the human-curated input before overwriting it: this table is a
    # clinical artifact, and an automated merge must not silently eat one.
    backup = CSV_PATH + ".before-dose-caps-merge"
    if not os.path.exists(backup):
        with open(CSV_PATH, encoding="utf-8") as f, open(backup, "w", encoding="utf-8", newline="") as g:
            g.write(f.read())
    write_csv(rows)
    write_ts(rows)
    print(f"wrote {CSV_PATH}\nwrote {TS_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
