"""One identity per drug (ADR-0012, MED-027, TD-17).

LAW UNDER TEST: a drug has exactly one name in the tables the engine reads. Not
a style rule — a lookup table can only find what it is keyed on, and until this
pass the same substance was filed under its salt, its British spelling and its
US adopted name in different rows.

Measured on the pre-migration tables (the numbers this file re-checks, so they
cannot quietly become folklore):

  - `ferrous sulfate` had no daily-dose cap at all. The 325 mg iron ceiling was
    filed under `ferrous sulphate`, so "Tab Fefol 500 mg HS" — 500 mg of an
    ingredient that is a leading cause of paediatric poisoning death — screened
    clean in BOTH planes. It now queues.
  - `lithium carbonate` reached 4 contraindications and no pregnancy rule;
    `lithium` reached 3, two of them ABSOLUTE, plus its 2400 mg ceiling. Lithosun
    300 was the brand that printed the salt.
  - `carvedilol phosphate` reached 0 of carvedilol's 28 interaction rows and
    missed bradycardia and heart_block, both ABSOLUTE for a beta-blocker.
  - `metronidazole + lithium` was stated `severe` under one identity and
    `moderate` under the other; the same regimen therefore verdicted differently
    depending on which brand the patient brought.
  - 9673 interaction rows held 13 pairs stating the same clinical rule twice,
    once under each identity — which the engine could not see as a collision,
    because a frozenset of two different names is two different keys. Renaming
    made them real collisions, and `interactions_by_pair` keeps whichever row
    was read last, so all 13 had to be adjudicated rather than renamed blindly.
    The pre-migration table itself had 0 duplicate engine keys.
"""
from __future__ import annotations

import csv
import json
import os
import sys
from collections import Counter

import pytest
from app.safety.engine import SafetyEngine, _molecule_identities
from medisaathi_contracts import ExtractionField, FieldSource, Severity

DATA_DIR = os.environ.get(
    "MEDISAATHI_DATA_DIR",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "data")))
sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.abspath(DATA_DIR)), "tools"))

from import_snapshot import SCHEMAS, _read_csv, validate  # noqa: E402
from normalize_molecules import ALIASES, NOT_MERGED, canonical  # noqa: E402

SEVERITY_RANK = {"mild": 0, "relative": 0, "moderate": 1, "severe": 2, "absolute": 2}

# The molecule column of every table the engine reads. A name in here is a key
# the engine will look up, so a retired alias in it is an unreachable rule.
MOLECULE_COLUMNS = {
    os.path.join("brands.csv"): ("molecule",),
    os.path.join("interactions.csv"): ("molecule_a", "molecule_b"),
    os.path.join("contraindications.csv"): ("molecule",),
    os.path.join("reference", "dose_caps.csv"): ("molecule",),
    os.path.join("reference", "rxnorm_molecule_map.csv"): ("molecule",),
}


@pytest.fixture(scope="module")
def engine() -> SafetyEngine:
    return SafetyEngine.load(DATA_DIR)


@pytest.fixture(scope="module")
def alias_law() -> dict[str, str]:
    """The retired aliases, read back from the artifact the engines are told."""
    path = os.path.join(DATA_DIR, "reference", "molecule_aliases.csv")
    with open(path, encoding="utf-8") as f:
        return {r["alias"]: r["canonical"] for r in csv.DictReader(f)
                if r["merged"] == "yes"}


@pytest.fixture(scope="module")
def non_merges() -> set[str]:
    """The names the audit file says were considered and deliberately left alone."""
    path = os.path.join(DATA_DIR, "reference", "molecule_aliases.csv")
    with open(path, encoding="utf-8") as f:
        return {r["alias"] for r in csv.DictReader(f) if r["merged"] == "no"}


def _rows(rel: str) -> list[dict]:
    with open(os.path.join(DATA_DIR, rel), encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _field(raw: str, conf: float = 0.97) -> ExtractionField:
    return ExtractionField(raw_text=raw, brand_text=raw, confidence=conf,
                           source=FieldSource.seed_fixture)


# --------------------------------------------------------------------------- data

def test_no_table_names_a_retired_alias(alias_law: dict[str, str]) -> None:
    """`--check` is a CLI gate; this is the same law inside the suite.

    Without it, a snapshot imported without running the tool re-splits an
    identity and the rules filed under the other name go unreachable again —
    silently, because every verdict still lands on a verdict.
    """
    offenders: list[str] = []
    for rel, cols in MOLECULE_COLUMNS.items():
        for i, row in enumerate(_rows(rel), start=2):
            for col in cols:
                for part in (row[col] or "").split("+"):
                    if part.strip().lower() in alias_law:
                        offenders.append(f"{rel} line {i} {col}={row[col]!r}")
    assert not offenders, f"retired alias identities are back in the tables: {offenders[:6]}"


def test_the_tool_and_the_data_state_the_same_law(alias_law: dict[str, str],
                                                 non_merges: set[str]) -> None:
    assert alias_law == {a: c for a, (c, _, _) in ALIASES.items()}, (
        "tools/normalize_molecules.py and data/reference/molecule_aliases.csv "
        "disagree; the audit file is what a reviewer reads, so it must match")
    # The non-merges are the half of the law a reviewer most needs: a suffix-
    # stripping rule would happily merge these, and the tables alone do not
    # show that anyone decided otherwise.
    assert non_merges == {n for p in NOT_MERGED for n in p[:2]}, (
        "a deliberate non-merge is missing from the audit file")


def test_canonical_is_idempotent_over_every_table() -> None:
    """canonical(canonical(x)) == canonical(x) for every key the engine reads.

    A one-step rename that leaves "lithium carbonate carbonate" would pass the
    alias-absence test above and break every lookup.
    """
    for rel, cols in MOLECULE_COLUMNS.items():
        for row in _rows(rel):
            for col in cols:
                once = canonical(row[col])
                assert canonical(once) == once, f"{rel}: {row[col]!r} -> {once!r} -> unstable"


@pytest.mark.parametrize("a,b,why",
                         [pytest.param(*p, id=f"{p[0]}/{p[1]}") for p in NOT_MERGED])
def test_two_drugs_that_differ_by_one_letter_stay_two_drugs(a: str, b: str, why: str) -> None:
    assert canonical(a) == a and canonical(b) == b, f"{a} / {b} were merged: {why}"


def test_engine_lookup_keys_are_unique(engine: SafetyEngine) -> None:
    """No two rows of one table may share the key the engine indexes by.

    `interactions_by_pair` is a dict keyed by frozenset, so a second row on the
    same pair is not a duplicate — it is a rule that silently loses to whichever
    was read last. The rename created 13 such pairs; adjudication removed them.
    """
    pair_keys = [frozenset((r["molecule_a"].lower(), r["molecule_b"].lower()))
                 for r in _rows("interactions.csv")]
    dupes = [k for k, n in Counter(pair_keys).items() if n > 1]
    assert not dupes, f"duplicate interaction keys, decided by row order: {[sorted(d) for d in dupes[:5]]}"

    contra_keys = [(r["molecule"].lower(), r["condition_code"].lower())
                   for r in _rows("contraindications.csv")]
    assert not [k for k, n in Counter(contra_keys).items() if n > 1], \
        "duplicate contraindication keys for one molecule and condition"

    brand_keys = [r["brand"].strip().lower() for r in _rows("brands.csv")]
    assert not [k for k, n in Counter(brand_keys).items() if n > 1], \
        "one brand maps to two formulary rows"

    cap_keys = [r["molecule"].lower() for r in _rows(os.path.join("reference", "dose_caps.csv"))]
    assert not [k for k, n in Counter(cap_keys).items() if n > 1], \
        "one molecule has two daily-dose ceilings"


def test_every_merge_kept_the_stronger_statement() -> None:
    """Re-adjudicate the audit artifact, do not trust the tool's own report.

    A merge may raise a severity (moderate -> severe) but may never lower one,
    and a cap merge may not change the number it compares against.
    """
    path = os.path.join(DATA_DIR, "reference", "molecule_merges.csv")
    if not os.path.exists(path):
        pytest.skip("no merge audit artifact: the identity pass has not been applied")
    with open(path, encoding="utf-8") as f:
        merges = list(csv.DictReader(f))
    assert merges, "the identity pass collapsed at least 19 rows, so this cannot be empty"
    for m in merges:
        kept, dropped = json.loads(m["kept_row"]), json.loads(m["dropped_row"])
        if "severity" in kept:
            assert SEVERITY_RANK[kept["severity"].lower()] >= \
                   SEVERITY_RANK[dropped["severity"].lower()], (
                f"{m['table']} {m['key']}: merge weakened "
                f"{dropped['severity']} -> {kept['severity']}")
        if "max_daily_mg" in kept:
            assert kept["max_daily_mg"] == dropped["max_daily_mg"], (
                f"merge changed the ceiling for {m['key']}: "
                f"{dropped['max_daily_mg']} -> {kept['max_daily_mg']}")


# ------------------------------------------------------------- what the law buys

def test_iron_brands_reach_the_iron_cap(engine: SafetyEngine) -> None:
    """The defect this pass exists for, as a test that cannot pass vacuously."""
    from app.safety.dosing import DAILY_CAPS_MG
    assert DAILY_CAPS_MG["ferrous sulfate"] == 325
    assert "ferrous sulphate" not in DAILY_CAPS_MG
    row = engine.normalize("Fefol")
    assert row["molecule"] == "ferrous sulfate"
    assert row["molecule"] in DAILY_CAPS_MG, "the brand resolves to an uncapped identity"


def test_a_500_mg_iron_course_queues(engine: SafetyEngine) -> None:
    """Tab Fefol 500 mg HS: 500 mg/day against a 325 mg/day ceiling.

    Passes nothing else needs to fire for this to matter — the reading is clean,
    the confidence is high, and only the cap can see the dose.
    """
    report, items, _ = engine.run([_field("Tab Fefol 500 mg HS x30d")])
    assert report.dose_hazards, "500 mg/day of iron raised no hazard"
    hazard = report.dose_hazards[0]
    assert hazard.molecule == "ferrous sulfate", (
        "the hazard carries a display-cased paraphrase of the identity, which the "
        "TS plane does not: same finding, two spellings")
    assert hazard.severity == Severity.severe
    assert items and items[0]["reason"] == "daily dose exceeds the label maximum"


def test_lithium_reaches_its_pregnancy_rule_whatever_the_strip_says(engine: SafetyEngine) -> None:
    """Lithosun 300 (lithium carbonate) with a declared pregnancy."""
    rules = engine.contraindications_for("lithium", {"pregnancy": True})
    preg = [r for r in rules if r["condition_code"] == "pregnancy"]
    # The loader maps the table's ABSOLUTE onto the engine's `severe`, so this is
    # the rule reaching a verdict class, not a string surviving from the CSV.
    assert preg and preg[0]["severity"] == "severe", (
        "lithium/pregnancy is filed ABSOLUTE and must arrive severe")
    row = engine.normalize("Lithosun 300")
    assert row["molecule"] == "lithium"
    report, _, _ = engine.run([_field("Tab Lithosun 300 1-0-0 x 30 days")],
                              {"pregnancy": True})
    assert report.contraindications, "the teratogenic rule did not reach the report"


def test_carvedilol_phosphate_brands_reach_carvedilol_rules(engine: SafetyEngine) -> None:
    brand = next(r for r in _rows("brands.csv")
                 if "carvedilol phosphate" in r["brand"].lower())
    row = engine.normalize(brand["brand"])
    assert row["molecule"] == "carvedilol"
    hit = engine.screen_pair("carvedilol", "diltiazem")
    assert hit and hit["severity"] == "severe", (
        "two negative chronotropes must not screen empty for a phosphate brand")
    codes = {r["condition_code"] for r in
             engine.contraindications_for("carvedilol", {"bradycardia": True, "heart_block": True})}
    assert {"bradycardia", "heart_block"} <= codes


def test_the_severity_conflict_the_split_hid_is_resolved_upwards(engine: SafetyEngine) -> None:
    """metronidazole + lithium: one row, stated severe, in either order.

    Before the pass the pair existed twice — `severe` under one identity,
    `moderate` under the other — so which one a patient got depended on the
    brand name on their strip.
    """
    for a, b in (("metronidazole", "lithium"), ("lithium", "metronidazole")):
        hit = engine.screen_pair(a, b)
        assert hit is not None and hit["severity"] == "severe", f"{a}+{b}: {hit}"
    rows = [r for r in _rows("interactions.csv")
            if {r["molecule_a"], r["molecule_b"]} == {"metronidazole", "lithium"}]
    assert len(rows) == 1


# ------------------------------------------------------- combination identities

def test_a_combination_brand_is_also_an_identity(engine: SafetyEngine) -> None:
    """Combination rows are documented at combination granularity.

    176 interaction rows and 17 contraindication rows are keyed on a string like
    "amoxicillin+clavulanic acid" or "artemether+lumefantrine". Screening that
    walked only components could never reach them; the identity set is the
    components AND the whole.
    """
    ident = "amoxicillin+clavulanic acid"
    assert ident in _molecule_identities(ident), "the whole string must be an identity"
    assert set(_molecule_identities("amoxicillin+clavulanic acid")) == {
        "amoxicillin", "clavulanic acid", ident}
    hit = engine.screen_pair(ident, "methotrexate")
    assert hit and hit["severity"] == "moderate"
    row = engine.normalize("Moxikind-CV 625")
    assert row["molecule"] == ident


def test_a_combination_never_pairs_with_its_own_components(engine: SafetyEngine) -> None:
    """The components of one brand are not a drug interaction with each other.

    Parity case P81 pins this: two brands of the same combination are a duplicate
    and an ATC collision, never a self-interaction.
    """
    identities = _molecule_identities("aceclofenac+paracetamol")
    assert set(identities) == {"aceclofenac", "paracetamol", "aceclofenac+paracetamol"}
    # ...but the engine screens across meds, so one brand alone reports nothing.
    report, _, _ = engine.run([_field("Tab Zerodol P BD x 5 days")])
    assert not report.interactions, (
        "a single combination brand reported an interaction between its own halves")


# --------------------------------------------------- the gate that keeps the law true

def _problems(kind: str, rows: list[dict]) -> list[str]:
    return validate(kind, list(SCHEMAS[kind]), rows)


def test_the_live_tables_pass_the_gate_a_new_snapshot_must_pass() -> None:
    """The shipped tables re-import through their own validator, clean.

    This runs the retired-identity and one-key-one-row checks over every row of
    all three tables on every test run, so a hand-edit that splits an identity
    again fails here even if nobody remembers to run
    `tools/normalize_molecules.py --check` first.
    """
    for kind in sorted(SCHEMAS):
        header, rows = _read_csv(os.path.join(DATA_DIR, f"{kind}.csv"))
        assert tuple(header) == SCHEMAS[kind], f"{kind}.csv header drifted from its schema"
        problems = _problems(kind, rows)
        assert not problems, f"{kind}.csv fails its own import gate: {problems[:3]}"


@pytest.mark.parametrize("alias", sorted(ALIASES))
def test_the_importer_rejects_every_name_the_law_retires(alias: str) -> None:
    """Not a spot-check on two favourites: every retired name is tried.

    The gate reads data/reference/molecule_aliases.csv, so a name added to the
    tool and not the data (or vice versa) fails the same-law test above; a name
    in both that the importer still lets through fails here.
    """
    problems = _problems("brands", [{"brand": "Probe Tab", "molecule": alias,
                                     "form": "tab", "atc": "A01AA",
                                     "aware_class": "Access", "jas_price_inr": "",
                                     "source": "gate probe"}])
    assert any("retired identity" in p for p in problems), (
        f"{alias!r} is retired by the molecule law but the governed import path "
        f"would let a snapshot name it: {problems}")


def test_the_importer_rejects_a_retired_component_inside_a_combination() -> None:
    """""+" is one identity, not a split the gate may check only on its first half."""
    problems = _problems("interactions", [
        {"molecule_a": "ferrous sulphate+ascorbic acid", "molecule_b": "levofloxacin",
         "severity": "moderate", "mechanism": "chelation", "source": "gate probe"}])
    assert any("retired identity" in p for p in problems), problems


def test_the_importer_rejects_two_rows_on_one_engine_key() -> None:
    """The loader keeps whichever row it reads last, so the loser never exists.

    Both orders count: interactions are keyed by frozenset, so (a, b) and (b, a)
    are one rule stated twice, and the pair may carry two different severities.
    """
    row = {"molecule_a": "warfarin", "molecule_b": "aspirin", "severity": "severe",
           "mechanism": "bleeding", "source": "gate probe"}
    flipped = {"molecule_a": "aspirin", "molecule_b": "warfarin", "severity": "moderate",
               "mechanism": "bleeding", "source": "gate probe"}
    problems = _problems("interactions", [row, flipped])
    assert any("restates the engine key" in p for p in problems), problems
    same = _problems("contraindications", [
        {"molecule": "lithium", "condition_code": "pregnancy", "severity": "absolute",
         "note": "teratogenic"},
        {"molecule": "lithium", "condition_code": "pregnancy", "severity": "relative",
         "note": "weaker restatement of the same rule"}])
    assert any("restates the engine key" in p for p in same), same
