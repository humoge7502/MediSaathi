"""The catalog may not key a brand to a drug its own name denies (ADR-0012, TD-20).

`tools/repair_pmbjp_molecules.py` re-keyed 226 Jan Aushadhi rows that had been
filed under the molecule *representative* of the class they were shelved in:
apixaban under warfarin, cholecalciferol 60K under calcium carbonate, escitalopram
under citalopram, heparin under warfarin. Each test below is one of the measured
consequences of that mis-keying, asserted on the row that caused it, so the defect
cannot come back on the next catalog import.

Run: python -m pytest apps/api/tests/test_pmbjp_identity.py -q
"""
from __future__ import annotations

import csv
import os
import sys

HERE = os.path.abspath(os.path.dirname(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))
sys.path.insert(0, os.path.join(ROOT, "tools"))

import pytest  # noqa: E402
import repair_pmbjp_molecules as repair  # noqa: E402
from app.safety.dosing import (  # noqa: E402
    ADVISORY_MG,
    DAILY_CAPS_MG,
    cap_check,
    interval_mandate_for,
)
from app.safety.engine import SafetyEngine, _norm_key  # noqa: E402
from app.vision import ExtractionField  # noqa: E402

LEDGER = os.path.join(ROOT, "data", "reference", "pmbjp_molecule_repairs.csv")
APIXABAN = "Jan Aushadhi Apixaban Tablets 5mg"
VITD = "Jan Aushadhi Cholecalciferol Soft Gelatin Capsule 60000 IU"
ESCITALOPRAM = "Jan Aushadhi Escitalopram Tablets IP 10 mg"
HEPARIN = "Jan Aushadhi Heparin Sodium Injection IP 25000 IU"


@pytest.fixture(scope="module")
def engine() -> SafetyEngine:
    return SafetyEngine.load()


def ledger() -> list[dict]:
    with open(LEDGER, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def field(text: str) -> ExtractionField:
    return ExtractionField(raw_text=text, brand_text=text, confidence=0.97, source="seed_fixture")


def molecule(engine: SafetyEngine, brand: str) -> str:
    row = engine.brands.get(_norm_key(brand))
    assert row is not None, f"{brand} is not in the loaded formulary"
    return row["molecule"].lower()


class TestTheGate:
    def test_no_brand_row_names_an_ingredient_its_molecule_cell_denies(self):
        """`make data-check` runs the same call; this keeps it inside `make test`."""
        bad = repair.contradictions(repair.read_brands())
        assert bad == [], f"{len(bad)} rows still keyed to another drug: " \
                          f"{bad[0][0]['brand']!r} -> {bad[0][0]['molecule']!r}"

    def test_the_repair_is_a_fixed_point_of_the_ledger(self):
        eng = SafetyEngine.load()
        entries = ledger()
        assert len(entries) == 226
        for entry in entries:
            assert molecule(eng, entry["brand"]) == entry["molecule_after"], entry["brand"]

    def test_every_recorded_repair_is_evidenced_by_the_brand_name_itself(self):
        for entry in ledger():
            assert entry["molecule_before"] != entry["molecule_after"]
            stated = entry["ingredient_named_in_brand"].lower().replace("|", "+")
            brand = entry["brand"].lower().replace("_", " ")
            # The identity's leading word must appear verbatim: `ketorolac
            # tromethamine` is reached from a strip that reads "Ketorolac", and a
            # repair that no word in the name supports is not this tool's work.
            assert all(part.split()[0] in brand for part in stated.split("+")), entry["brand"]


class TestWrongDrugRowsAreGone:
    """The four consequences the tool's docstring measures, as verdicts."""

    def test_apixaban_is_not_measured_against_warfarins_ceiling(self, engine):
        assert molecule(engine, APIXABAN) == "apixaban"
        # Warfarin is dosed to an INR and carries a 10 mg/day level-guided figure;
        # apixaban is fixed-dose and has no ceiling in the table at all. Keyed to
        # warfarin, a 5 mg DOAC tablet was checked against another drug's number,
        # and the report cited that drug's mechanism and source.
        assert "apixaban" not in DAILY_CAPS_MG
        assert cap_check("apixaban", 5.0) == ("clean", None, None)
        assert DAILY_CAPS_MG["warfarin"] == pytest.approx(10.0)
        rep, items, _ = engine.run(
            [field(f"Tab {APIXABAN} 5 mg OD x 30 days")], {"pregnancy": True})
        cited = {c.molecule for c in rep.contraindications}
        assert cited == {"apixaban"}, f"the rule cited {cited} for a row that names apixaban"
        assert all("warfarin" not in c.note.lower() for c in rep.contraindications)
        assert items == []

    def test_the_60k_brand_reaches_the_iu_interval_mandate(self, engine):
        assert molecule(engine, VITD) == "cholecalciferol"
        assert interval_mandate_for("cholecalciferol", "capsule", None, 60000.0) is not None
        report, items, _ = engine.run([field(f"Cap {VITD} 1-0-0 x 30 days")], {})
        assert any(i["reason"] == "never-event dosing interval" for i in items), items
        assert any("60000 iu" in h.observed.replace(" ", "") or "1-0-0" in h.observed
                   for h in report.dose_hazards), [h.observed for h in report.dose_hazards]

    def test_the_weekly_60k_course_the_same_brand_states_still_passes(self, engine):
        report, items, _ = engine.run(
            [field(f"Cap {VITD} 0-0-1 weekly x 8 weeks")], {})
        assert not any(i["reason"] == "never-event dosing interval" for i in items)
        assert not report.dose_hazards

    def test_escitalopram_borrows_citaloprams_40_mg_ceiling_no_longer(self, engine):
        assert molecule(engine, ESCITALOPRAM) == "escitalopram"
        assert DAILY_CAPS_MG["escitalopram"] == pytest.approx(20.0)
        assert DAILY_CAPS_MG["citalopram"] == pytest.approx(40.0)
        # 20 mg twice daily is double the licensed escitalopram maximum and inside
        # the citalopram figure these rows used to be keyed to: it screened clean.
        assert cap_check("escitalopram", 40.0)[0] == "breach"
        report, items, _ = engine.run(
            [field("Tab Jan Aushadhi Escitalopram 20 mg BD x 30 days")], {})
        assert any("exceeds the escitalopram cap of 20 mg/day" in w for w in report.warnings), \
            report.warnings
        assert any(i["reason"] == "daily dose exceeds the label maximum" for i in items), items

    def test_heparin_is_not_keyed_to_warfarin(self, engine):
        assert molecule(engine, HEPARIN) == "heparin"
        assert "heparin" not in DAILY_CAPS_MG or ADVISORY_MG.get("heparin") is None
        assert "warfarin" not in str(engine.brands[_norm_key(HEPARIN)])


class TestTheIdentityLawStillHolds:
    def test_the_repair_did_not_reopen_a_retired_alias(self):
        """normalize_molecules --check is the gate; this is the same claim from a
        different table, because a repair that writes a retired spelling would
        pass the ledger check and break the identity law."""
        import subprocess
        rc = subprocess.call([sys.executable, os.path.join(ROOT, "tools", "normalize_molecules.py"),
                              "--check"], cwd=ROOT)
        assert rc == 0

    def test_the_compiled_web_table_is_not_stale(self):
        import subprocess
        rc = subprocess.call([sys.executable, os.path.join(ROOT, "tools", "build_web_dataset.py"),
                              "--check"], cwd=ROOT)
        assert rc == 0, "apps/web/src/lib/safety/tables.generated.ts still carries the wrong molecule"
