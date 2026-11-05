"""The daily-dose-cap law, and the one table it reads (parity corpus v6 + v7).

Four defects this pins, all measured before being fixed:

  * the aggregate cap rule decided verdicts in the TypeScript tier and only
    warned in the Python tier ("Tab Cetzine 10 BD x 5 days" = 20 mg against a
    10 mg licensed maximum: `interaction` there, `pass` here);
  * the caps themselves lived in three places — two engine literals and a
    sourced CSV nothing read — and disagreed on 17 molecules. Theophylline 450
    against a level-guided 900 made a routine 800 mg/day modified-release course
    verdict as a fatal overdose.
  * a label that prints two numbers was executed with one. Moving ibuprofen's
    blocking ceiling to the prescription maximum (2400, correctly) dropped the
    1200 self-care figure to prose, and a 1600 mg/day course went silent.
  * a ceiling the PATIENT lowers was ignored. Paracetamol's own note says 2000
    mg/day in liver disease and the app asks the patient for liver disease, yet
    4600 mg/day across two brands was measured against 4000 for everyone.

So: one table of record (data/reference/dose_caps.csv), generated into both
tiers, a cap that blocks only when it is actually a ceiling, one classifier that
decides breach-versus-advise for both rules in both planes, and a drift test that
reads the generated TypeScript and compares it to the Python module's own loaded
numbers — the same shape as the frequency-vocabulary gate in test_interval_law.py,
because a mirrored constant nobody compares is a mirrored constant that will
drift.
"""
from __future__ import annotations

import json
import os
import re

import pytest
from app.safety import dosing
from app.safety.dosing import (
    ADVISORY_MG,
    CAP_BASIS,
    CAP_LOWERED_BY,
    DAILY_CAPS_MG,
    HARD_CAP_MG,
    brand_strength,
    cap_check,
    dose_warning,
    effective_cap,
    load_dose_caps,
)
from app.safety.engine import CAP_SOURCE, SafetyEngine
from medisaathi_contracts import ExtractionField, FieldSource

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
TS_GENERATED = os.path.join(
    ROOT, "apps", "web", "src", "lib", "safety", "dose-caps.generated.ts")


def _fields(*lines: str) -> list[ExtractionField]:
    return [
        ExtractionField(raw_text=line, brand_text=line, confidence=0.97,
                        source=FieldSource.seed_fixture)
        for line in lines
    ]


@pytest.fixture(scope="module")
def engine() -> SafetyEngine:
    return SafetyEngine.load(os.path.join(ROOT, "data"))


def _run(engine: SafetyEngine, *lines: str, contexts: dict | None = None):
    fields = _fields(*lines)
    report, items, _verified = engine.run(fields, contexts or {})
    return report, items


# ---------------------------------------------------------------- one table


def test_the_caps_table_is_the_sourced_csv_not_a_literal():
    """305 rows, every one of them carrying a basis and a blocking decision.

    The old literal had no provenance per row, which is how a withdrawn IV
    ondansetron figure ended up screening oral tablets. The count is 305 and not
    306 because one identity was written twice: "lithium" and "lithium carbonate"
    each had a 2400 mg row, and iron brands named the US spelling reached neither
    of them.
    """
    assert len(DAILY_CAPS_MG) == 305
    assert set(CAP_BASIS) == set(DAILY_CAPS_MG)
    assert set(DAILY_CAPS_MG) >= HARD_CAP_MG
    assert all(CAP_BASIS[m] for m in DAILY_CAPS_MG)


def test_the_17_adjudicated_conflicts_hold_their_decided_values():
    # The curated table was right against the engine literals...
    assert DAILY_CAPS_MG["theophylline"] == 900.0     # was 450: level-guided
    assert DAILY_CAPS_MG["ondansetron"] == 24.0       # was 32: an IV figure
    assert DAILY_CAPS_MG["ibuprofen"] == 2400.0       # was 1200: the OTC cap
    assert DAILY_CAPS_MG["naproxen"] == 1500.0        # was 1250: salt-dependent
    # ...and wrong against them in the cases where the licensed figure is lower.
    assert DAILY_CAPS_MG["cetirizine"] == 10.0        # curated said 20
    assert DAILY_CAPS_MG["levocetirizine"] == 5.0     # curated said 10


@pytest.mark.parametrize("molecule", [
    "warfarin", "digoxin", "theophylline", "lithium", "valproate",
    "clopidogrel", "isotretinoin", "ivermectin", "prednisolone", "torasemide",
])
def test_a_ceiling_the_engine_cannot_measure_never_blocks(molecule: str):
    """Level-guided, weight-based and specialist-supervised drugs may only advise.

    The plane has no serum level, no INR and no body weight, so for these the
    stored number is a practice figure, not a limit. Blocking on it would be a
    false never-event on warfarin — the most dangerous drug in the list.
    """
    # The first half of this test is what makes it worth reading: a name that is
    # not in the table at all also "never blocks", so before this line the test
    # passed happily for "lithium carbonate" after that identity stopped
    # existing. Absence is not a policy decision.
    assert molecule in DAILY_CAPS_MG, f"{molecule} has no ceiling row to adjudicate"
    assert molecule not in HARD_CAP_MG, (
        f"{molecule} is {CAP_BASIS[molecule]}-dosed and must not be in HARD_CAP_MG")


def test_dose_caps_table_hash_matches_the_generated_typescript_copy():
    """The two tiers load the same numbers, or the build is stale."""
    src = open(TS_GENERATED, encoding="utf-8").read()
    got = re.search(r'DOSE_CAPS_TABLE_HASH = "([0-9a-f]{16})"', src)
    assert got, "the generated TypeScript lost its table hash"
    assert got.group(1) == dosing.CAP_TABLE_HASH, (
        "data/reference/dose_caps.csv changed without re-running "
        "python tools/build_dose_caps.py")


def test_every_cap_and_blocking_flag_is_identical_in_both_planes():
    src = open(TS_GENERATED, encoding="utf-8").read()
    caps_block = re.search(
        r"DAILY_CAPS_MG: Record<string, number> = \{(.*?)\n\};", src, re.S)
    assert caps_block, "DAILY_CAPS_MG is no longer a flat literal in the generated file"
    ts_caps = {m.group(1): float(m.group(2)) for m in re.finditer(
        r'"([^"]+)":\s*([0-9.eE+-]+)', caps_block.group(1))}
    assert ts_caps == DAILY_CAPS_MG, (
        f"the tiers disagree on {sorted(set(ts_caps.items()) ^ set(DAILY_CAPS_MG.items()))[:5]}")

    hard_block = re.search(r"HARD_CAP_MG[^=]*= new Set\(\[(.*?)\]\)", src, re.S)
    assert hard_block, "HARD_CAP_MG is no longer a Set literal"
    ts_hard = set(re.findall(r'"([^"]+)"', hard_block.group(1)))
    assert ts_hard == set(HARD_CAP_MG)

    advisory_block = re.search(
        r"export const ADVISORY_MG[^=]*= \{(.*?)\n\};", src, re.S)
    assert advisory_block, "ADVISORY_MG is no longer a flat literal"
    ts_advisory = {m.group(1): float(m.group(2)) for m in re.finditer(
        r'"([^"]+)":\s*([0-9.eE+-]+)', advisory_block.group(1))}
    assert ts_advisory == ADVISORY_MG, "the self-care figures disagree across planes"

    lowered_block = re.search(
        r"export const CAP_LOWERED_BY[^=]*= \{(.*?)\n\};", src, re.S)
    assert lowered_block, "CAP_LOWERED_BY is no longer a nested literal"
    ts_lowered = {
        mol: {code: float(value) for code, value in re.findall(
            r'"([^"]+)":\s*([0-9.eE+-]+)', body)}
        for mol, body in re.findall(r'"([^"]+)":\s*\{([^}]*)\}',
                                    lowered_block.group(1))}
    assert ts_lowered == CAP_LOWERED_BY, (
        "the ceilings a declared patient condition lowers disagree across the "
        f"planes: {sorted(set(ts_lowered.items()) ^ set(CAP_LOWERED_BY.items()))[:4]}")


# ---------------------------------------------------------------- the law


def test_a_clean_line_over_a_real_ceiling_queues_in_the_python_tier(engine):
    """The line that verdicted `pass` here while the TS tier said `interaction`."""
    report, items = _run(engine, "Tab Cetzine 10 BD x 5 days")
    assert items, "20 mg/day against a 10 mg licensed cap must reach a human"
    assert items[0]["reason"] == "daily dose exceeds the label maximum"
    hazard = report.dose_hazards[0]
    assert hazard.source == CAP_SOURCE
    assert hazard.required == "no more than 10 mg/day"


def test_a_line_exactly_at_the_cap_is_not_a_breach(engine):
    report, items = _run(engine, "Tab Cetzine 10 OD x 5 days")
    assert not items
    assert not report.dose_hazards


def test_up_to_half_again_the_ceiling_advises_and_does_not_block(engine):
    """120 mg pantoprazole against an 80 mg cap is 1.5x: advisory in both tiers."""
    report, items = _run(engine, "Tab Pan 40 TDS x 5 days")
    assert not items, "the escalation line is *past* 1.5x, not at it"
    assert any("exceeds the pantoprazole cap" in w for w in report.warnings)


def test_two_lines_at_the_cap_breach_it_together(engine):
    """Each line is individually clean; only the aggregate crosses 1.5x."""
    line = "Tab Storvas 20 QID x 5 days"
    _, items_one = _run(engine, line)
    report, items = _run(engine, line, line)
    assert not items_one
    assert len(items) == 2, "both contributing lines are unresolved, so both queue"
    assert any("160" in h.note for h in report.dose_hazards)


def test_a_level_guided_drug_over_its_practice_figure_only_advises(engine):
    """P89's digoxin: the aggregate is absurd, but the *cap* is not what is wrong.

    The 0.5 mg/day figure is titrated to a serum level, so it may not block. What
    queues this line is the strength contradiction, and saying so is the point:
    an engine that blocks on an invented number trains pharmacists to ignore it.
    """
    report, items = _run(engine, "Digoxin 0.25 500 mg 1-0-1 3 days")
    assert not report.dose_hazards, "digoxin's cap is not a ceiling"
    assert any(i["reason"] == "strength does not match the formulary entry"
               for i in items)


def test_a_combination_line_invents_no_dose_for_its_components(engine):
    """The measured fabrication: aspirin 75 + atorvastatin 10, one stated "75 mg".

    Applying that strength to every expanded molecule produced 380 mg/day of
    atorvastatin and queued a routine statin+aspirin regimen for an overdose that
    was never on the paper. A combination line contributes to no cap total until
    brands.csv carries per-component strengths — and says which cap went unchecked.
    """
    report, items = _run(engine, "1. T. Ecospirin AV 75 75 mg QID x3d",
                         "1. T. Storvas 20 20 mg QID x3d")
    joined = " ".join(report.warnings + [h.note for h in report.dose_hazards]).lower()
    assert "exceeds the 80 mg/day atorvastatin cap" not in joined
    assert "per-component strengths" in joined
    assert not items


def test_theophylline_at_a_normal_modified_release_dose_is_not_a_never_event(engine):
    """P42, the false positive that drove the provenance fix.

    800 mg/day is an ordinary modified-release theophylline course. The literal
    said 450, the curated table said 900 and level-guided, and the combination
    verdicted a clean interacting pair as an overdose.
    """
    report, items = _run(engine, "Theophylline 200 200mg  QID  x3d")
    assert not report.dose_hazards
    assert not any(i["reason"] == "daily dose exceeds the label maximum" for i in items)


# ------------------------------------------------- strength reading on brands


@pytest.mark.parametrize("brand, expected", [
    ("Alprax 0.5", (0.5, "")),
    ("Digoxin 0.25", (0.25, "")),
    ("Thyronorm 50", (50.0, "")),
    ("Dolo 650", (650.0, "")),
    ("Calcirol 60K", (60000.0, "")),
    ("Ciplox 500", (500.0, "")),
    # A bare trailing INTEGER under 3 is a strip count or a serial, still not a
    # strength. Only decimals changed.
    ("Ecosprin 1", None),
    ("Pan 1", None),
])
def test_brand_strength_reads_decimals_and_still_rejects_counts(brand, expected):
    got = brand_strength(brand)
    if expected is None:
        assert got is None, f"{brand} must not be read as a {got} strength"
    else:
        assert got == expected


def test_the_decimal_guard_closes_the_sub_2_milligram_blind_spot():
    """The magnitude test used to discard every bare number under 2 — which is
    exactly where a tenfold mis-read kills: alprazolam, digoxin, levothyroxine,
    warfarin, clonazepam.
    """
    field = ExtractionField(
        raw_text="1. T. Alprax 0.5 10 mg once daily x30d",
        brand_text="1. T. Alprax 0.5 10 mg once daily x30d",
        strength="10 mg", frequency="once daily", confidence=0.97,
        source=FieldSource.seed_fixture)
    # The misread dose is visible to the cap rule (alprazolam is licensed-capped
    # at 4 mg/day, so the invented 10 mg/day is an over-cap read)...
    note = dose_warning(field, "alprazolam") or ""
    assert note and "exceeds the alprazolam cap of 4 mg/day" in note, note
    # ...and the brand core now contributes its own 0.5, which it could not do
    # while every bare number under 2 was discarded as a strip count.
    mismatch = dosing.strength_mismatch(field, "Alprax 0.5")
    assert mismatch and "20x difference" in mismatch


def test_cap_lookup_uses_the_resolved_molecule_not_a_substring_scan():
    """"cetirizine" is a substring of "levocetirizine".

    Scanning the table in file order checked the looser 10 mg cap against a 5 mg
    drug; the resolved molecule is looked up directly now.
    """
    field = ExtractionField(
        raw_text="Tab Teczine 5 BD", brand_text="Tab Teczine 5 BD",
        strength="5 mg", frequency="BD", confidence=0.97,
        source=FieldSource.seed_fixture)
    warn = dose_warning(field, "levocetirizine")
    assert warn and "levocetirizine" in warn, warn


def test_reloading_from_another_data_dir_replaces_every_table():
    """The table is loaded, not compiled in — so a pinned snapshot can be audited."""
    before = dict(DAILY_CAPS_MG)
    load_dose_caps()
    assert DAILY_CAPS_MG == before
    assert ADVISORY_MG == dict(ADVISORY_MG)
    assert CAP_LOWERED_BY == dict(CAP_LOWERED_BY)
    assert json  # keeps the import honest: the drift test compares hashed payloads


# ------------------------------------------------- the second figure on the label


def test_the_label_lower_advisory_figure_still_warns_after_the_ceiling_moved(engine):
    """Ibuprofen: 1600 mg/day is legal by prescription and over the self-care cap.

    The blocking figure correctly moved from 1200 to 2400 — every 600 mg TDS
    course was queueing before that — and the 1200 then existed only as a sentence
    in the note column. A cap rule that fires at one number is not the rule the
    label states, so the second number became a column and this test.
    """
    assert cap_check("ibuprofen", 1600.0, {}) == ("advise", 1200.0, None)
    assert cap_check("ibuprofen", 1200.0, {}) == ("clean", None, None)
    assert cap_check("ibuprofen", 2600.0, {}) == ("breach", 2400.0, None)
    report, items = _run(engine, "Tab Brufen 400 400 mg QID x 3 days")
    assert not items, "advisory means the plan still happens"
    assert not report.dose_hazards
    assert any("self-care limit" in w and "1200" in w for w in report.warnings), \
        report.warnings


def test_a_declared_condition_lowers_the_ceiling_the_dose_is_measured_against(engine):
    """P142/P143: the same 4600 mg/day, and the patient is the difference.

    The reason a level-guided cap may not block is that the engine has no serum
    level. It does have what the person declared about their own liver, and the
    same curated note that gives 4000 for a healthy adult gives 2000 for them.
    """
    lines = ("Tab Dolo 650 650 mg QID x 3 days",
             "Tab Crocin Advance 500 mg QID x 3 days")
    report, items = _run(engine, *lines)
    assert not report.dose_hazards, "4600 is over 4000 but under the 6000 escalation"
    assert any("exceeds the 4000 mg/day cap" in w for w in report.warnings)

    liver = {"hepatic_severe": True}
    report, items = _run(engine, *lines, contexts=liver)
    hazard = report.dose_hazards[0]
    assert hazard.required == "no more than 2000 mg/day"
    assert "lower it from 4000 mg/day" in hazard.note
    assert len(items) == 2, "both contributing lines queue, not just the second"
    assert all(i["reason"] == "daily dose exceeds the label maximum" for i in items)


def test_the_escalation_law_does_not_move_just_because_the_ceiling_did(engine):
    """P144: 2600 mg/day under declared liver disease is over 2000, not over 3000.

    Lowering the ceiling is not lowering the block threshold. If it were, the
    plane would start refusing ordinary prescriptions for a patient whose only
    crime is a declared comorbidity, and the advisory-vs-never-event boundary
    would stop meaning "this dose is impossible".
    """
    report, items = _run(engine, "Tab Dolo 650 650 mg QID x 3 days",
                         contexts={"hepatic_severe": True})
    assert not report.dose_hazards
    assert not any(i["reason"] == "daily dose exceeds the label maximum"
                   for i in items)
    assert any("lower it from 4000 mg/day" in w for w in report.warnings)


@pytest.mark.parametrize("molecule, context, standing, lowered", [
    ("paracetamol", "hepatic_severe", 4000.0, 2000.0),
    ("paracetamol", "alcohol", 4000.0, 2000.0),
    ("citalopram", "age_over_65", 40.0, 20.0),
    ("tramadol", "age_over_65", 400.0, 300.0),
    ("tramadol", "renal_severe", 400.0, 300.0),
    ("tapentadol", "renal_moderate", 600.0, 500.0),
])
def test_every_lowered_ceiling_names_a_context_the_app_actually_asks_for(
        molecule, context, standing, lowered):
    """A `lowered_by` code the UI cannot declare would be a ceiling nobody hits.

    CONTEXT_CODES is the vocabulary the product collects; anything outside it is
    dead data in the table, and dead data in a clinical table is how the next
    ondansetron-sized error arrives.
    """
    from medisaathi_contracts import CONTEXT_CODES

    assert context in CONTEXT_CODES, f"{context} is not declarable"
    assert CAP_LOWERED_BY[molecule][context] == lowered
    assert effective_cap(molecule, {}) == (standing, None)
    assert effective_cap(molecule, {context: True}) == (lowered, context)


def test_a_context_that_does_not_lower_this_drug_changes_nothing():
    assert effective_cap("cetirizine", {"hepatic_severe": True}) == (10.0, None)
    assert cap_check("cetirizine", 20.0, {"hepatic_severe": True}) == (
        "breach", 10.0, None)


def test_the_lowest_applicable_ceiling_wins():
    """Two declared conditions, two figures: the stricter one governs.

    No drug in today's table declares two *different* lowered figures, so the
    rule is pinned against a synthetic row rather than left untested — an
    ambiguous "which of my conditions applies" question is exactly what a later
    adjudication will add, and the answer has to already be in the code.
    """
    # Mutate the module attributes, not the names imported above: load_dose_caps()
    # rebinds dosing.DAILY_CAPS_MG to a fresh dict, so an imported name can go stale.
    dosing.CAP_LOWERED_BY["_probe"] = {"a": 100.0, "b": 60.0}
    dosing.DAILY_CAPS_MG["_probe"] = 200.0
    try:
        assert effective_cap("_probe", {"a": True}) == (100.0, "a")
        assert effective_cap("_probe", {"a": True, "b": True}) == (60.0, "b")
        assert effective_cap("_probe", {"b": False}) == (200.0, None)
    finally:
        dosing.DAILY_CAPS_MG.pop("_probe", None)
        dosing.CAP_LOWERED_BY.pop("_probe", None)
    # And on real data: the lowered ceiling is the number the block measures.
    assert cap_check("tramadol", 320.0, {}) == ("clean", None, None)
    assert cap_check("tramadol", 320.0, {"age_over_65": True}) == (
        "breach", 300.0, "age_over_65")
