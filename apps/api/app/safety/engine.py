"""MediSaathi deterministic safety plane.

Zero-network, pure-Python rule engine loaded from seed CSVs at boot.
The LLM never sees this plane's decisions; this plane never calls a model.

New in this build:
  * dose-plausibility warnings (deterministic, from parsed dose/frequency)
  * same-brand duplicate detection (two lines of the same brand = double dose)
  * declared-context validation against the contracts vocabulary
"""
from __future__ import annotations

import csv
import os
from dataclasses import dataclass, field

from medisaathi_contracts import (
    ContraindicationFinding,
    DuplicateFinding,
    ExtractionField,
    InteractionFinding,
    NormalizedMedication,
    ProvenanceEntry,
    SafetyReport,
    Severity,
)
from medisaathi_contracts import CONTEXT_CODES

from .dosing import DAILY_CAPS_MG, daily_dose_mg, dose_warning

DATA_DIR = os.environ.get(
    "MEDISAATHI_DATA_DIR",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "data")),
)

SNAPSHOT = "2026-09"

# Confidence gate thresholds (product law: refuse below LOW, confirm between)
CONFIRM_BELOW = 0.90
REFUSE_BELOW = 0.75

SEV_RANK = {"none": 0, "mild": 1, "moderate": 2, "severe": 3}

# regulatory terms on the CSV -> pipeline Severity enum
CONTRA_SEV_MAP = {"absolute": "severe", "relative": "moderate"}


@dataclass
class SafetyEngine:
    """Rule engine over in-memory seed tables. Loads once, answers forever."""

    brands: dict = field(default_factory=dict)          # lowercase brand -> row
    molecules: dict = field(default_factory=dict)       # lowercase molecule -> row
    interactions: list = field(default_factory=list)
    interactions_by_pair: dict = field(default_factory=dict)
    contraindications: list = field(default_factory=list)
    contraindications_by_molecule: dict = field(default_factory=dict)

    # -------------------------------------------------------------- loading
    @classmethod
    def load(cls, data_dir: str | None = None) -> "SafetyEngine":
        data_dir = data_dir or DATA_DIR
        eng = cls()
        with open(os.path.join(data_dir, "brands.csv"), encoding="utf-8") as f:
            for row in csv.DictReader(f):
                row["jas_price_inr"] = _f(row.get("jas_price_inr"))
                eng.brands[row["brand"].strip().lower()] = row
                for mol in _split_molecules(row["molecule"]):
                    eng.molecules.setdefault(mol, row)
        with open(os.path.join(data_dir, "interactions.csv"), encoding="utf-8") as f:
            for row in csv.DictReader(f):
                eng.interactions.append(row)
                pair = frozenset((row["molecule_a"].lower(), row["molecule_b"].lower()))
                eng.interactions_by_pair[pair] = row
        with open(os.path.join(data_dir, "contraindications.csv"), encoding="utf-8") as f:
            for row in csv.DictReader(f):
                row["severity"] = CONTRA_SEV_MAP.get(row["severity"], row["severity"])
                eng.contraindications.append(row)
                eng.contraindications_by_molecule.setdefault(
                    row["molecule"].lower(), []).append(row)
        return eng

    # -------------------------------------------------------------- rules
    def normalize(self, brand_text: str) -> dict | None:
        """Brand name -> canonical formulary row. Fuzzy on whitespace/case."""
        key = " ".join((brand_text or "").strip().lower().split())
        if key in self.brands:
            return self.brands[key]
        # longest-brand-substring fallback: "tab dolo 650" -> "dolo 650"
        for brand, row in sorted(self.brands.items(), key=lambda kv: -len(kv[0])):
            if brand in key:
                return row
        return None

    def screen_pair(self, mol_a: str, mol_b: str) -> dict | None:
        return self.interactions_by_pair.get(frozenset((mol_a.lower(), mol_b.lower())))

    def contraindications_for(self, molecule: str, context: dict) -> list:
        """Rules whose condition_code is present in the patient context dict."""
        hits = []
        for rule in self.contraindications_by_molecule.get(molecule.lower(), []):
            code = rule["condition_code"]
            if context.get(code) or context.get(code.replace("_under_", "_")):
                hits.append(rule)
        return hits

    def find_duplicates(self, meds: list[NormalizedMedication]) -> list[DuplicateFinding]:
        by_atc: dict[str, list[str]] = {}
        for m in meds:
            for atc in _split_atc(m.atc):
                if not atc:
                    continue
                by_atc.setdefault(atc, []).append(m.brand)
        return [
            DuplicateFinding(atc=atc, brands=names,
                             note="Duplicate ATC class - cumulative dose risk")
            for atc, names in sorted(by_atc.items()) if len(names) > 1
        ]

    # -------------------------------------------------------------- full pass
    def run(self, fields: list[ExtractionField],
            context: dict | None = None) -> tuple[SafetyReport, list, bool]:
        """Returns (report, confirm_items, all_fields_verified).

        all_fields_verified is False when any field sits below the gate.
        The caller (verdict assembly) MUST route unverified fields away from
        spoken/rendered safety output - that is the product's core law.
        """
        context = self.validate_context(context or {})
        meds: list[NormalizedMedication] = []
        confirm_items: list = []
        warnings: list[str] = []
        for i, fld in enumerate(fields):
            row = self.normalize(fld.brand_text or fld.raw_text)
            if row is None:
                confirm_items.append({
                    "field_index": i, "raw_text": fld.raw_text,
                    "confidence": fld.confidence,
                    "reason": "brand not in formulary map",
                })
                continue
            meds.append(NormalizedMedication(
                brand=row["brand"], molecule=row["molecule"], form=row["form"],
                atc=row["atc"], aware_class=row["aware_class"],
                jas_price_inr=row["jas_price_inr"], fields=[fld],
            ))
            if fld.confidence < CONFIRM_BELOW:
                confirm_items.append({
                    "field_index": i, "raw_text": fld.raw_text,
                    "confidence": fld.confidence,
                    "reason": "low field confidence",
                })
            w = dose_warning(fld, row["molecule"].lower())
            if w:
                warnings.append(f"{row['brand']}: {w}")

        interactions: list[InteractionFinding] = []
        for i in range(len(meds)):
            for j in range(i + 1, len(meds)):
                for mol_a in _split_molecules(meds[i].molecule):
                    for mol_b in _split_molecules(meds[j].molecule):
                        hit = self.screen_pair(mol_a, mol_b)
                        if hit:
                            interactions.append(InteractionFinding(
                                molecule_a=hit["molecule_a"], molecule_b=hit["molecule_b"],
                                severity=Severity(hit["severity"]),
                                mechanism=hit["mechanism"], source=hit["source"]))

        contras: list[ContraindicationFinding] = []
        for m in meds:
            for mol in _split_molecules(m.molecule):
                for rule in self.contraindications_for(mol, context):
                    contras.append(ContraindicationFinding(
                        molecule=mol, condition_code=rule["condition_code"],
                        severity=Severity(rule["severity"]), note=rule["note"]))

        duplicates = self.find_duplicates(meds)

        # Aggregate daily-cap rule: two paracetamol brands can each sit under
        # the cap while the combination blows through it. Sum per molecule.
        totals: dict[str, float] = {}
        for m in meds:
            for mol in _split_molecules(m.molecule):
                if m.fields:
                    d = daily_dose_mg(m.fields[0])
                    if d is not None:
                        totals[mol] = totals.get(mol, 0.0) + d
        for mol, total in sorted(totals.items()):
            cap = DAILY_CAPS_MG.get(mol)
            if cap is not None and total > cap:
                warnings.append(
                    f"combined {mol} daily dose {total:g} mg from "
                    f"{len(meds)} line(s) exceeds the {cap:g} mg/day cap")

        report = SafetyReport(
            medications=meds, interactions=interactions, contraindications=contras,
            duplicates=duplicates, warnings=warnings,
            checks={
                "normalize": True, "interaction_graph": True,
                "contraindication_rules": True, "duplicate_atc": True,
                "aware_tagging": True, "dose_plausibility": True,
            })
        all_verified = bool(meds) and len(confirm_items) == 0 and all(
            f.confidence >= REFUSE_BELOW for f in fields)
        return report, confirm_items, all_verified

    # -------------------------------------------------------------- context
    @staticmethod
    def validate_context(context: dict) -> dict:
        """Declared context is filtered against the contracts vocabulary;
        unknown keys are dropped, not guessed about."""
        return {k: bool(v) for k, v in context.items() if k in CONTEXT_CODES}

    # -------------------------------------------------------------- provenance
    def provenance(self) -> list[ProvenanceEntry]:
        return [
            ProvenanceEntry(kind="data_snapshot", name="brand-molecule formulary",
                            source="Jan Aushadhi + published formularies", snapshot=SNAPSHOT),
            ProvenanceEntry(kind="data_snapshot", name="interaction graph",
                            source="DDInter (versioned snapshot)", snapshot=SNAPSHOT),
            ProvenanceEntry(kind="data_snapshot", name="AWaRe classification",
                            source="WHO AWaRe 2023", snapshot=SNAPSHOT),
            ProvenanceEntry(kind="safety_check", name="verdict engine",
                            source="deterministic rules; no LLM in the loop", snapshot=SNAPSHOT),
        ]


def _split_molecules(s: str) -> list[str]:
    return [m.strip().lower() for m in (s or "").replace(",", "+").split("+") if m.strip()]


def _split_atc(s: str) -> list[str]:
    """ATC codes keep their original case (codes are uppercase by convention)."""
    return [m.strip() for m in (s or "").replace(",", "+").split("+") if m.strip()]


def _f(x):
    try:
        return round(float(x), 2)
    except (TypeError, ValueError):
        return None
