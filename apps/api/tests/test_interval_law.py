"""The administration-interval law, tested where it is actually decided.

The parity corpus (eval/parity/golden.json) pins what the two planes *agree* on.
This file pins what they agree *about*, on the structured path the raw-line
harness cannot express: the two axes a frequency code carries, the refusal to
default an unreadable code, the never-event mandates, and the precedence rule
that makes a queued interval outrank a clinical finding.

Each test names the failure mode it guards, because every one of these was a
live defect rather than a hypothetical:

* `1/7` collapsed into a float rendered a weekly drug as one slot per day;
* an unreadable frequency defaulted to once-daily, inventing a schedule the
  prescription never asked for;
* oral methotrexate written "daily" carried no frequency at all, so no interval
  rule could fire on the classic ISMP fatal error;
* a mis-read strength queued the line in one plane and an interaction verdict in
  the other, and only `confirm_queue` blocks plan creation.
"""
from __future__ import annotations

import csv
import os
import re
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest  # noqa: E402
from app.safety.dosing import (  # noqa: E402  # noqa: E402
    _IU_BRAND_MOLECULES,
    _MCG_BRAND_MOLECULES,
    ADVISORY_MG,
    CAP_LOWERED_BY,
    DAILY_CAPS_MG,
    INTERVAL_MANDATES,
    LINE_FREQ_TOKENS,
    brand_label_strength,
    brand_strength,
    brand_strengths,
    daily_dose_mg,
    dose_warning,
    effective_cap,
    enrich_field,
    extract_line_frequency,
    interval_hazard,
    interval_mandate_for,
    parse_strength,
    strength_mismatch,
)
from app.safety.frequency import parse_frequency  # noqa: E402
from app.verdict import assemble  # noqa: E402
from medisaathi_contracts import (  # noqa: E402
    ExtractionField,
    ExtractionResult,
    FieldSource,
    VerdictKind,
)

DATA_DIR = os.environ.get(
    "MEDISAATHI_DATA_DIR",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "data")))

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
TS_FREQUENCY = os.path.join(REPO_ROOT, "apps", "web", "src", "lib", "safety", "frequency.ts")


@pytest.fixture(scope="module")
def engine():
    from app.safety.engine import SafetyEngine
    return SafetyEngine.load(DATA_DIR)


def _field(raw: str, **kw) -> ExtractionField:
    """One structured prescription line, at auto-confirmed confidence."""
    defaults = dict(raw_text=raw, brand_text=raw, confidence=0.97,
                    source=FieldSource.seed_fixture)
    defaults.update(kw)
    return ExtractionField(**defaults)


def _run(engine, *fields: ExtractionField, context: dict | None = None):
    result = ExtractionResult(sample_id="interval-law", fields=list(fields),
                              engine="test")
    report, items, _verified = engine.run(list(fields), context or {})
    verdict = assemble(engine, result, report, items)
    return report, items, verdict


# --------------------------------------------------------------- the two axes

@pytest.mark.parametrize("code,doses,interval", [
    ("OD", 1, 1), ("QD", 1, 1), ("DAILY", 1, 1), ("EVERY DAY", 1, 1),
    ("1-0-0", 1, 1), ("HS", 1, 1), ("BEDTIME", 1, 1), ("NOCTE", 1, 1),
    ("BD", 2, 1), ("BID", 2, 1), ("1-0-1", 2, 1), ("TWICE DAILY", 2, 1),
    ("TDS", 3, 1), ("1-1-1", 3, 1), ("QID", 4, 1), ("1-1-1-1", 4, 1),
    ("QOD", 1, 2), ("EVERY OTHER DAY", 1, 2), ("ALTERNATE DAYS", 1, 2),
    ("QWK", 1, 7), ("QW", 1, 7), ("WEEKLY", 1, 7), ("ONCE WEEKLY", 1, 7),
    ("ONCE A WEEK", 1, 7), ("7D", 1, 7),
    ("BIW", 2, 7), ("TWICE WEEKLY", 2, 7),
    ("Q2W", 1, 14), ("BIWEEKLY", 1, 14), ("Q3W", 1, 21),
    ("QM", 1, 30), ("MONTHLY", 1, 30), ("EVERY MONTH", 1, 30),
])
def test_frequency_carries_two_separate_axes(code, doses, interval):
    """The bug class this law exists for: one collapsed number.

    `doses_per_day / interval_days` as a single float made a weekly drug look
    like 0.14 doses/day, which any generator iterating calendar days renders as
    one dose every day. Both axes stay visible on the parsed value.
    """
    f = parse_frequency(code)
    assert f is not None, f"{code} must be legible"
    assert (f.doses_per_day, f.interval_days) == (doses, interval)


@pytest.mark.parametrize("code,expected", [
    ("QWK", 1 / 7), ("WEEKLY", 1 / 7), ("BIW", 2 / 7),
    ("QOD", 1 / 2), ("QM", 1 / 30), ("OD", 1.0), ("QID", 4.0),
])
def test_daily_factor_is_an_exact_fraction_not_a_rounded_code(code, expected):
    assert parse_frequency(code).daily_factor == pytest.approx(expected)


def test_interval_codes_do_not_round_into_each_other():
    """1/7 exactly, not 0.14: the rounded value is what let a weekly schedule
    be laid out as one dose a day by a generator iterating calendar days."""
    weekly = parse_frequency("QWK")
    assert weekly.daily_factor == 1 / 7
    assert weekly.daily_factor != round(weekly.daily_factor, 2)
    assert (weekly.doses_per_day, weekly.interval_days) == (1, 7)
    assert parse_frequency("Q2W").interval_days == 14
    assert parse_frequency("QM").interval_days == 30


# --------------------------------------------------- never invent a schedule

@pytest.mark.parametrize("code", [
    "", None, "QODS", "TDS??", "OWC", "8-8-8", "75-1-0", "0-0-0",
    "every 999 days", "3x daily x", "DUBL",
])
def test_unlegible_frequency_is_none_never_a_default(code):
    """Defaulting an unread code to once-daily fabricates a regimen.

    The caller's contract is: None -> confirm queue. A default value here would
    be invisible in the verdict and visible only in the patient's dose times.
    """
    assert parse_frequency(code) is None


def test_tac_slot_counts_are_bounded_to_one_digit():
    """`1-0-1` is a schedule; `75-1-0` is a dose glued to a schedule.

    Without the bound, Tab Lyrica 75 - 1-0-1 read as 76 administrations a day.
    """
    assert parse_frequency("1-0-1").doses_per_day == 2
    assert parse_frequency("1-1-1-1").doses_per_day == 4
    assert parse_frequency("75-1-0") is None
    assert parse_frequency("0-0-0") is None


@pytest.mark.parametrize("prose,interval", [
    ("every 3 days", 3), ("q 3 days", 3), ("every 10 days", 10),
    ("every 2 weeks", 14), ("q 4 weeks", 28), ("every 3 weeks", 21),
    ("every 2 months", 60), ("q3d", 3), ("q2w", 14), ("q30d", 30),
])
def test_prose_intervals_convert_units_instead_of_dropping_them(
    prose, interval
):
    """Weeks and months appear on real lines; a days-only parser loses them, and
    a line with no frequency stops being screenable altogether."""
    f = parse_frequency(prose)
    assert f is not None, prose
    assert f.interval_days == interval


@pytest.mark.parametrize("code,doses", [("4 hourly", 6), ("6 hourly", 4), ("Q6H", 4)])
def test_hourly_codes_become_administrations_per_day(code, doses):
    assert parse_frequency(code).doses_per_day == doses


def test_hourly_code_that_does_not_divide_the_day_is_refused():
    """`5 hourly` is not a schedule any generator can lay out honestly."""
    assert parse_frequency("5 hourly") is None


@pytest.mark.parametrize("word", ["AT NIGHT", "NOCTE", "NIGHTLY", "BEDTIME", "AT BEDTIME"])
def test_bedtime_words_canonicalize_to_hs(word):
    """A bedtime dose must schedule at night, not at the generic 09:00 slot."""
    f = parse_frequency(word)
    assert f is not None and f.code == "HS" and f.doses_per_day == 1


def test_single_and_as_needed_codes_never_generate_a_recurring_schedule():
    for code in ("STAT", "ONCE", "X1"):
        f = parse_frequency(code)
        assert f.single and not f.as_needed, code
    for code in ("SOS", "PRN", "AS NEEDED"):
        f = parse_frequency(code)
        assert f.as_needed and not f.single, code


# ------------------------------------------------------ never-event mandates

def _mtx(freq: str, strength: str = "10 mg") -> ExtractionField:
    return _field(f"Tab Folitrax 10 {strength} {freq}", strength=strength,
                  frequency=freq)


@pytest.mark.parametrize("freq", ["OD", "DAILY", "BD", "TDS", "QID", "1-0-1",
                                  "1-0-0", "HS", "QOD", "every 3 days", "6 hourly"])
def test_oral_methotrexate_on_any_interval_shorter_than_weekly_is_a_hazard(freq):
    """ISMP high-alert: oral methotrexate is weekly, never daily.

    Not expressible as a mg/day cap — 10 mg once daily is 10 mg/day, under the
    30 mg cap — so the minimum-interval rule is the only thing that catches it.
    """
    rule, f = interval_hazard(_mtx(freq), "methotrexate", "tablet")
    assert rule.molecule == "methotrexate"
    assert rule.min_interval_days == 7
    assert f.interval_days < 7


@pytest.mark.parametrize("freq", ["QWK", "QW", "WEEKLY", "ONCE WEEKLY",
                                  "q 3 weeks", "Q2W", "every 14 days"])
def test_weekly_methotrexate_is_not_a_hazard(freq):
    """Precision, not a blanket block: the labeled schedule must still pass."""
    assert interval_hazard(_mtx(freq), "methotrexate", "tablet") is None


@pytest.mark.parametrize("freq", ["SOS", "STAT"])
def test_a_hazardous_molecule_as_needed_or_single_is_not_a_hazard(freq):
    """PRN/stat lines have no steady-state schedule to violate."""
    assert interval_hazard(_mtx(freq), "methotrexate", "tablet") is None


def test_methotrexate_injection_is_not_covered_by_the_oral_mandate():
    """The mandate is scoped to the formulations where the error occurs (oral
    weekly-vs-daily); oncology IV protocols follow a different schedule."""
    assert interval_mandate_for("methotrexate", "injection", 15.0) is None
    assert interval_mandate_for("methotrexate", "tablet", 15.0) is not None


@pytest.mark.parametrize("molecule,form,mg,want_days", [
    ("alendronate", "tablet", 70.0, 7),
    ("risedronate", "tablet", 35.0, 7),
    ("ibandronate", "tablet", 150.0, 30),
    ("semaglutide", "injection", 1.0, 7),
])
def test_interval_mandates_carry_the_label_minimum(molecule, form, mg, want_days):
    rule = interval_mandate_for(molecule, form, mg)
    assert rule is not None and rule.min_interval_days == want_days


def test_mandates_do_not_fire_below_their_strength():
    """Alendronate 35/70 mg is weekly; a below-strength dose is a different
    product and the mandate must not invent a schedule for it."""
    assert interval_mandate_for("alendronate", "tablet", 10.0) is None
    assert interval_mandate_for("ibandronate", "tablet", 50.0) is None


def test_bisphosphonate_daily_dose_is_a_hazard_on_the_pure_rule():
    """The product formulary carries no alendronate brand yet (formulary
    asymmetry, TD-formulary-symmetry), so the rule is exercised directly."""
    fld = _field("Tab Alendronate 70 mg daily", strength="70 mg", frequency="daily")
    got = interval_hazard(fld, "alendronate", "tablet")
    assert got is not None
    _rule, f = got
    assert f.interval_days == 1


def test_an_iu_mandate_is_reachable_although_iu_is_not_mass():
    """The 60,000 IU sachet is the most-prescribed high-dose vitamin D course in
    the catalog and is labeled once weekly. A mandate table keyed only on mg can
    never see it: an IU strength has no mg equivalent, so `mg` arrives as None and
    every daily 60,000 IU line passed. The threshold is the dose size, so the low
    IU daily preparations a patient legitimately takes stay clean."""
    assert interval_mandate_for("cholecalciferol", "capsule", None, 60000.0) is not None
    assert interval_mandate_for("cholecalciferol", "sachet", None, 60000.0) is not None
    assert interval_mandate_for("cholecalciferol", "drops", None, 2000.0) is None
    # A mass rule must not fire on an IU dose, and vice versa.
    assert interval_mandate_for("alendronate", "tablet", None, 60000.0) is None
    assert interval_mandate_for("cholecalciferol", "capsule", 60000.0) is None


def test_a_daily_60000_iu_sachet_is_a_hazard_and_a_weekly_one_is_not():
    daily = _field("Cap Calcirol 60K 1-0-0 x 30 days",
                   strength="60000 iu", frequency="1-0-0")
    assert interval_hazard(daily, "cholecalciferol", "capsule") is not None
    weekly = _field("Cap Calcirol 60K once weekly x 8 weeks",
                    strength="60000 iu", frequency="once weekly")
    assert interval_hazard(weekly, "cholecalciferol", "capsule") is None


# ------------------------------------------------- strength/unit reading laws

def test_mcg_strength_is_not_dropped_and_iu_is_not_mass():
    """Matching only the literal "mg" left every mcg and IU medicine unscreened:
    a 50 mcg levothyroxine line against a 0.3 mg/day cap parsed to None."""
    assert parse_strength("50 mcg").mg == pytest.approx(0.05)
    assert parse_strength("0.5 mg").mg == pytest.approx(0.5)
    assert parse_strength("60000 IU").mg is None
    assert parse_strength("60000 IU").unit == "iu"
    assert parse_strength("1 g").mg == pytest.approx(1000.0)


def test_brand_label_states_the_strength_the_line_omits():
    """"Cap. Folitrax 10 HS" names its strength only through the brand.
    Without this the line carries no strength, so neither the interval mandates
    nor the daily caps can screen it."""
    assert brand_label_strength("Folitrax 10") == "10 mg"
    # A bare trailing number is mcg only for the closed list of molecules whose
    # Indian labels state mcg; reading "Thyronorm 50" as 50 mg is a 1000x error.
    assert brand_label_strength("Thyronorm 50", "levothyroxine") == "50 mcg"
    assert brand_label_strength("Thyronorm 50") == "50 mg"
    assert brand_label_strength("Dolo 650") == "650 mg"


@pytest.mark.parametrize("brand,molecule,expected", [
    # The vitamin-D class is sold as "60K" meaning 60 000 IU. Inheriting the mg
    # default asserted a 60 000 mg cholecalciferol dose against a formulary entry
    # that does not exist in those units, and queued a routine weekly sachet.
    ("Calcirol 60K", "cholecalciferol", "60000 iu"),
    ("D-Rise 60K", "cholecalciferol", "60000 iu"),
    ("Cholecalciferol 60000iu", "cholecalciferol", "60000 iu"),
    # a label that prints its own unit wins over the molecule default
    ("Jan Aushadhi Desmopressin Tablets 0.1 mg", "desmopressin", "0.1 mg"),
    ("Thyronorm 50", "levothyroxine", "50 mcg"),
])
def test_the_bare_number_default_is_the_unit_the_molecule_uses(
        brand, molecule, expected):
    assert brand_label_strength(brand, molecule) == expected
    if expected.endswith(" iu"):
        # IU is not mg-convertible: the cap rule abstains rather than invent.
        assert parse_strength(expected).mg is None


@pytest.mark.parametrize("brand", ["Uprise-D3", "Uprise D3", "Septran DS"])
def test_a_letter_glued_digit_is_a_name_not_a_strength(brand):
    """"Uprise-D3" is cholecalciferol named after the vitamin, not a 3 mg dose."""
    assert brand_strength(brand) is None
    assert brand_label_strength(brand, "cholecalciferol") is None


@pytest.mark.parametrize("brand,items", [
    ("Levodopa+carbidopa 100/10", [(100.0, ""), (10.0, "")]),
    ("Amoxicillin+clavulanic acid 500/125", [(500.0, ""), (125.0, "")]),
    ("Dolo 650", [(650.0, "")]),
])
def test_a_combination_label_states_one_strength_per_component(brand, items):
    """Reading only the trailing half made a correct 100 mg levodopa line look
    tenfold wrong, and no scalar stands for "100/10"."""
    assert brand_strengths(brand) == items
    if len(items) > 1:
        assert brand_strength(brand) is None
        assert brand_label_strength(brand, "levodopa+carbidopa") is None
    else:
        assert brand_strength(brand) == items[0]


@pytest.mark.parametrize("read,brand,expect_queue", [
    ("100 mg", "Levodopa+carbidopa 100/10", False),   # names the levodopa half
    ("10 mg", "Levodopa+carbidopa 100/10", False),    # names the carbidopa half
    ("875 mg", "Amoxicillin+clavulanic acid 500/125", True),
    ("50 mg", "Ecosprin 1", False),                   # strip count, no strength
])
def test_a_ratio_label_matches_either_component(read, brand, expect_queue):
    got = strength_mismatch(_field("x", strength=read), brand)
    assert bool(got) is expect_queue, (read, brand, got)


def test_uppercase_units_in_the_catalog_are_read():
    """12 rows print "IU" in caps; the unit test used to be case-sensitive, so
    the plane read no strength at all and abstained from the line entirely."""
    got = brand_strength("Jan Aushadhi Heparin Sodium Injection IP 25000 IU")
    assert got == (25000.0, "iu")
    got = brand_strength("Jan Aushadhi Vitamin A Capsule IP 25000 IU")
    assert got == (25000.0, "iu")


def test_closed_unit_lists_agree_with_the_catalog():
    """The mcg/IU defaults are the one place the engine asserts a unit the label
    never printed, so the agreement is measured over every bare-number row."""
    brands = list(csv.DictReader(
        open(os.path.join(DATA_DIR, "brands.csv"), encoding="utf-8")))
    offenders = []
    for row in brands:
        bs = brand_strength(row["brand"])
        if bs is None or bs[1]:
            continue                       # not a bare number: the label stated it
        mol = row["molecule"].lower()
        want = ("iu" if mol in _IU_BRAND_MOLECULES
                else "mcg" if mol in _MCG_BRAND_MOLECULES else "mg")
        got = (brand_label_strength(row["brand"], mol) or "").split(" ")[-1]
        if got != want:
            offenders.append((row["brand"], got, want))
    assert not offenders, offenders[:10]
    # the lists must still be doing real work, or they are dead code
    bare = [(row["brand"], row["molecule"].lower()) for row in brands
            if brand_strength(row["brand"]) and not brand_strength(row["brand"])[1]]
    mcg_rows = sum(1 for _, mol in bare if mol in _MCG_BRAND_MOLECULES)
    iu_rows = sum(1 for _, mol in bare if mol in _IU_BRAND_MOLECULES)
    assert mcg_rows > 0 and iu_rows > 0, (mcg_rows, iu_rows)


@pytest.mark.parametrize("read,brand,expect_queue", [
    ("500 mcg", "Thyronorm 50", True),      # 10x look-alike/different-strength
    ("50 mcg", "Thyronorm 50", False),      # matches the label
    ("650 mg", "Dolo 650", False),
    ("1300 mg", "Crocin 650", True),
])
def test_look_alike_different_strength_is_the_uncertainty(read, brand, expect_queue):
    got = strength_mismatch(_field("x", strength=read), brand)
    assert bool(got) is expect_queue, (read, brand, got)


# ------------------------------------------------------- raw-line enrichment

@pytest.mark.parametrize("line,frequency", [
    ("T. Folitrax 10 10 mg daily x 28d", "DAILY"),
    ("T. Folitrax 10 10 mg once weekly x 28d", "ONCE WEEKLY"),
    ("T. Folitrax 10 10 mg every other day x 28d", "EVERY OTHER DAY"),
    ("T. Folitrax 10 10 mg alternate days x 28d", "ALTERNATE DAYS"),
    ("T. Folitrax 10 10 mg every 3 days x 28d", "EVERY 3 DAYS"),
    ("T. Folitrax 10 10 mg q 3 weeks x 28d", "Q 3 WEEKS"),
    ("T. Folitrax 10 10 mg Q2W x 28d", "Q2W"),
    ("T. Folitrax 10 10 mg 6 hourly x 2d", "6 HOURLY"),
    ("T. Folitrax 10 10 mg bedtime x 28d", "BEDTIME"),
    ("Tab Dolo 650 - 1-0-1 x 5 days", "1-0-1"),
])
def test_the_interval_law_is_reachable_from_raw_line_text(line, frequency):
    """A rule the law contains but the text parser cannot see is not a rule.

    Every token class in the tables has to be reachable from a line written the
    way a prescriber writes it, or the line carries no frequency and nothing is
    screened. This is the exact gap that made "Folitrax daily" pass.
    """
    got = enrich_field(_field(line, raw_text=line, brand_text=line))
    assert got.frequency == frequency


@pytest.mark.parametrize("code,doses,gap", [
    ("0-0-1 weekly", 1, 7),
    ("1-0-1 alternate day", 2, 2),
    ("1-1-0 every 3 weeks", 2, 21),
    ("1-0-0 daily", 1, 1),
])
def test_a_slot_code_and_an_interval_word_are_one_instruction(code, doses, gap):
    """The code names the hours; the word names how often that day comes around.

    Reading only the code turned "0-0-1 weekly" into a daily schedule, which is
    how the interval law came to flag a correct eight-week methotrexate or
    vitamin-D course as a never-event.
    """
    got = parse_frequency(code)
    assert got is not None, code
    assert (got.doses_per_day, got.interval_days) == (doses, gap)


def test_a_slot_code_with_an_unreadable_qualifier_stays_unreadable():
    """The qualifier is not decoration: an attached word the law cannot read
    makes the whole schedule unknown, and an unknown schedule must not silently
    fall back to daily."""
    assert parse_frequency("0-0-1 after food") is None


def test_a_prn_qualifier_on_a_slot_code_is_still_prn():
    got = parse_frequency("0-1-1 SOS")
    assert got is not None and got.as_needed


def test_the_line_carries_the_qualifier_with_the_code():
    """RX-038 is written this way, and the extractor dropped the word: the pair
    has to survive to `parse_frequency` or the composition cannot happen."""
    weekly = enrich_field(_field(
        "Tab Calcirol 60K - 0-0-1 weekly x 8 weeks",
        raw_text="Tab Calcirol 60K - 0-0-1 weekly x 8 weeks",
        brand_text="Tab Calcirol 60K - 0-0-1 weekly x 8 weeks"))
    assert weekly.frequency == "0-0-1 WEEKLY"
    # A duration is not a qualifier: "1-0-0 x 30 days" stays a daily code.
    plain = enrich_field(_field(
        "Tab Dolo 650 - 1-0-0 x 30 days",
        raw_text="Tab Dolo 650 - 1-0-0 x 30 days", brand_text="Tab Dolo 650 - 1-0-0 x 30 days"))
    assert plain.frequency == "1-0-0"


@pytest.mark.parametrize("line,code", [
    ("Tab Amlong 5 - 1-0-0 x 90 days", "1-0-0"),
    ("Tab Lyrica 75 - 1-0-1 x 30 days", "1-0-1"),
    ("Tab Crocin 650 - 1 - 0 - 1 SOS", "1-0-1 SOS"),
    ("Tab Storvas 20 - 0-0-1 x 90 days", "0-0-1"),
])
def test_the_line_separates_the_dose_from_the_regimen(line, code):
    """A spaced dash is the line's separator, not a slot join.

    "Amlong 5 - 1-0-0" otherwise starts a legal slot code at the 5 and reads 1+5
    = 6 administrations a day: the aggregate cap rule then reported a 30 mg/day
    amlodipine course from a 5 mg prescription, and the line queued for a dose
    nobody wrote.
    """
    assert extract_line_frequency(line) == code


def test_a_stated_but_unreadable_frequency_queues_and_blocks_the_verdict(engine):
    """Perception states a code; the law cannot read it; the line queues.

    Two entry paths, same rule. The structured one carries "QODS", which the
    raw-line parser would never have extracted; the text one carries "Q5H", a
    legible shape whose value no generator can lay out (24 % 5 != 0). Both are
    the worst kind of uncertainty — the schedule is unknown and the scheduler
    will not guess one — so both are queue rows, not warnings nobody must clear.
    """
    fld = _field("Tab Dolo 650 1-0-1 x 5 days", frequency="QODS")
    report, items, verdict = _run(engine, fld)
    assert items, "an unreadable stated frequency must queue the line"
    assert any("not a recognized code" in i["reason"] for i in items), items
    assert verdict.kind == VerdictKind.confirm_queue
    assert "not a recognized dosing code" in report.warnings[0]

    for line in ["Tab Dolo 650 Q5H x 5 days", "Tab Dolo 650 every 999 days x 5 days"]:
        _rep, its, v = _run(engine, _field(line, raw_text=line, brand_text=line))
        assert v.kind == VerdictKind.confirm_queue, line
        assert any("not a recognized code" in i["reason"] for i in its), (line, its)


def test_a_never_event_queues_even_when_the_read_is_confident_and_clean(engine):
    """Confidence-based routing structurally cannot see a lethal regimen.

    The line is read perfectly (0.97), resolves to a real brand, and carries no
    interaction at all — and it still prescribes oral methotrexate once daily.
    """
    fld = _field("Tab Folitrax 10 - 10 mg - OD - 28 days",
                 strength="10 mg", frequency="OD", duration="28 days")
    report, items, verdict = _run(engine, fld)
    assert report.dose_hazards, "never-event interval must be a hazard"
    hz = report.dose_hazards[0]
    assert hz.molecule == "Methotrexate" or hz.molecule.lower() == "methotrexate"
    assert hz.required == "no more often than every 7 days"
    assert items and items[0]["reason"] == "never-event dosing interval"
    assert items[0]["band"] == "confirm"
    assert verdict.kind == VerdictKind.confirm_queue


def test_weekly_methotrexate_passes_the_same_engine_path(engine):
    """The same fixture with the correct schedule must pass, or the rule is a
    molecule blanket rather than an interval law."""
    fld = _field("Tab Folitrax 10 - 10 mg - QWK - 28 days",
                 strength="10 mg", frequency="QWK", duration="28 days")
    report, items, verdict = _run(engine, fld)
    assert not report.dose_hazards
    assert not items
    assert verdict.kind == VerdictKind.pass_


def test_the_queue_outranks_a_real_clinical_interaction(engine):
    """Verdict precedence law, on the structured path.

    Methotrexate daily + aspirin is both a never-event interval AND a genuine
    interaction. The finding must still be computed and shown — the interaction
    does not stop existing because the schedule is wrong — but the verdict is
    confirm_queue, because only confirm_queue blocks plan creation, and findings
    computed on an unconfirmed identity cannot be the last word.
    """
    mtx = _field("Tab Folitrax 10 - 10 mg - QID - 28 days",
                 strength="10 mg", frequency="QID", duration="28 days")
    aspirin = _field("Tab Ecosprin 75 - 75 mg - 1-0-1 - 28 days",
                     strength="75 mg", frequency="1-0-1", duration="28 days")
    report, _items, verdict = _run(engine, mtx, aspirin)
    assert report.interactions, "the interaction must still be found and shown"
    assert report.dose_hazards
    assert verdict.kind == VerdictKind.confirm_queue


def test_weekly_methotrexate_plus_aspirin_is_an_interaction_not_a_queue(engine):
    """The control for the test above: same pair, correct interval -> the
    interaction is the verdict, because nothing is unresolved."""
    mtx = _field("Tab Folitrax 10 - 10 mg - QWK - 28 days",
                 strength="10 mg", frequency="QWK", duration="28 days")
    aspirin = _field("Tab Ecosprin 75 - 75 mg - 1-0-1 - 28 days",
                     strength="75 mg", frequency="1-0-1", duration="28 days")
    report, items, verdict = _run(engine, mtx, aspirin)
    assert not report.dose_hazards and not items
    assert report.interactions
    assert verdict.kind == VerdictKind.interaction


def test_aggregate_daily_cap_is_reached_from_one_raw_line(engine):
    """The dose-cap arithmetic used to be a documented parity non-case because
    the Python plane had nothing to feed it. Enrichment closes that: 4 x 10 mg
    methotrexate is 40 mg/day, over the 30 mg/day cap.
    """
    fld = _field("T. Folitrax 10 10 mg 6 hourly x 2d")
    report, _items, _verdict = _run(engine, fld)
    assert daily_dose_mg(enrich_field(fld)) == pytest.approx(40.0)
    assert any("exceeds" in w for w in report.warnings), report.warnings
    assert report.dose_hazards, "the cap breach and the interval hazard both fire"


def test_daily_cap_table_keeps_both_ibuprofen_figures():
    """Two thresholds, one table: the ceiling blocks, the self-care figure warns.

    This table used to hold only 1200 — the OTC self-care maximum — so every
    legitimate 600 mg TDS prescription (2400 mg/day) queued as an overdose. The
    other half of that loss was quieter: when the blocking figure moved to the
    prescription maximum, the 1200 became a column instead of being dropped, and
    a 1600 mg/day course still has to say so out loud.
    """
    assert DAILY_CAPS_MG["ibuprofen"] == 2400.0
    assert ADVISORY_MG["ibuprofen"] == 1200.0
    assert DAILY_CAPS_MG["paracetamol"] == 4000.0
    assert DAILY_CAPS_MG["methotrexate"] == 30.0
    # The patient's own declared condition lowers a ceiling; that is the one
    # number the engine is told rather than has to guess.
    assert CAP_LOWERED_BY["paracetamol"]["hepatic_severe"] == 2000.0
    assert effective_cap("paracetamol", {}) == (4000.0, None)
    assert effective_cap("paracetamol", {"hepatic_severe": True}) == (2000.0,
                                                                     "hepatic_severe")


def test_warning_text_names_the_unreadable_code_not_just_says_invalid():
    fld = _field("Tab Dolo 650 1-0-1 x 5 days", frequency="TDS??")
    w = dose_warning(fld, "paracetamol")
    assert w and "TDS??" in w


# ------------------------------------------------------ cross-plane drift gate

def _ts_token_block() -> list[str]:
    """Read the TS mirror's token array, in order, out of its source file.

    Deliberately marker-based rather than AST-parsed: the markers are the
    contract, and if someone edits the block so the markers no longer delimit a
    `readonly string[]` literal this test fails loudly instead of silently
    comparing two empty lists.
    """
    src = open(TS_FREQUENCY, encoding="utf-8").read()
    if "LINE_FREQ_TOKENS BEGIN" not in src or "LINE_FREQ_TOKENS END" not in src:
        raise AssertionError(
            "the TS mirror lost its LINE_FREQ_TOKENS markers; the drift gate "
            "cannot read a list it cannot locate")
    between = src.split("LINE_FREQ_TOKENS BEGIN", 1)[1].split("LINE_FREQ_TOKENS END", 1)[0]
    literal = re.search(r"readonly string\[\]\s*=\s*\[(.*?)\]\s*;", between, re.S)
    if literal is None:
        raise AssertionError("LINE_FREQ_TOKENS is no longer a readonly string[] literal")
    return re.findall(r'"([^"]+)"', literal.group(1))


def test_raw_line_frequency_vocabulary_is_identical_in_both_planes():
    """The divergence this gate exists for, measured before corpus v5:

      line written                 Python              TS
      "... every other day x 28d"  no frequency->pass   QOD->never-event queue
      "... every 3 days x 28d"     interval 3->queue    no frequency->pass

    Same law, different reach, opposite verdicts on one prescription. The token
    ORDER is part of the contract, not just the set: alternation is
    first-match-wins, so "DAILY" before "ONCE DAILY" misreads the schedule.
    """
    assert _ts_token_block() == list(LINE_FREQ_TOKENS)


def test_prose_frequency_pattern_is_identical_in_both_planes():
    from app.safety.dosing import _LINE_FREQ_PROSE
    src = open(TS_FREQUENCY, encoding="utf-8").read()
    got = re.search(r"LINE_FREQ_PROSE = String\.raw`([^`]*)`", src)
    assert got, "the TS prose-pattern mirror is missing"
    assert got.group(1) == _LINE_FREQ_PROSE


def test_every_table_code_is_reachable_from_a_raw_line_or_a_structured_field():
    """No code may sit in the tables and be invisible to both entry paths.

    The raw-line list is a deliberate subset of the table vocabulary (no 2-letter
    noise like OM/WK/BIW, which ragged OCR produces constantly), and the tables
    are a superset because a structured field arrives already segmented. So the
    guard runs one way: everything a line can offer must be something the law can
    read. A token added to the line vocabulary without its table entry would be
    silently unreadable — worse, it reads as "no frequency" rather than an error.
    """
    from app.safety.frequency import (
        _AS_NEEDED,
        _BEDTIME,
        _DAILY,
        _INTERVAL,
        _SINGLE,
    )
    known = set(_DAILY) | set(_INTERVAL) | _BEDTIME | _SINGLE | _AS_NEEDED
    for token in LINE_FREQ_TOKENS:
        assert token in known, f"{token} is matched off a line but not in the tables"
    for token in LINE_FREQ_TOKENS:
        assert parse_frequency(token) is not None, f"{token} does not parse"


def test_mandate_tables_are_mirrored_across_planes_in_number_and_name():
    """The Python and TS interval mandates must be the same rules, not rules
    that happen to agree today."""
    src = open(os.path.join(REPO_ROOT, "apps", "web", "src", "lib", "safety",
                             "schedule-rules.ts"), encoding="utf-8").read()
    block = src.split("INTERVAL_MANDATES", 1)[1]
    for rule in INTERVAL_MANDATES:
        assert f'molecule: "{rule.molecule}"' in block, rule.molecule
        assert f"minIntervalDays: {rule.min_interval_days}" in block, rule.molecule
        assert f"minMg: {rule.min_mg:g}" in block, rule.molecule
        # An IU mandate is the one shape a mg-only mirror cannot express, so a
        # row added on one side alone has to be visible to this guard.
        if rule.min_iu is not None:
            assert f"minIu: {rule.min_iu:g}" in block, rule.molecule
