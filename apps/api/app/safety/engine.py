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
    CONTEXT_CODES,
    ContraindicationFinding,
    DoseRuleFinding,
    DuplicateFinding,
    ExtractionField,
    GateFieldDecision,
    GateMetadata,
    InteractionFinding,
    NormalizedMedication,
    ProvenanceEntry,
    SafetyReport,
    Severity,
)

from ..gate import (
    AUTO,
    CONFIRM,
    REFUSED,
    all_below_refusal,
    band_of,
    fuse_prescription,
    get_threshold_set,
)
from .dosing import (
    CAP_BASIS,
    DAILY_CAPS_MG,
    HARD_CAP_MG,
    cap_check,
    daily_dose_mg,
    dose_warning,
    enrich_field,
    interval_hazard,
    strength_mismatch,
)
from .frequency import parse_frequency

# Provenance label carried by a daily-cap hazard. A verbatim mirror of
# `CAP_SOURCE` in apps/web/src/lib/safety/engine.ts — the two planes describe the
# same rule with the same string, because the headline and the parity finding
# text are both built from it.
CAP_SOURCE = "label daily maximum"

DATA_DIR = os.environ.get(
    "MEDISAATHI_DATA_DIR",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "data")),
)

SNAPSHOT = "2026-09"

# Confidence gate thresholds (product law: refuse below LOW, confirm between).
# These are the *defaults of the frozen v1 threshold set*; the authoritative
# values now live in app.gate.THRESHOLD_SETS so both engines and every
# experiment read one source of truth (MED-003). Kept as module constants
# because callers and the parity corpus reference them by name.
from ..gate import DEFAULT_THRESHOLD_SET_ID as DEFAULT_THRESHOLD_SET_ID  # noqa: E402

CONFIRM_BELOW = 0.90
REFUSE_BELOW = 0.75

SEV_RANK = {"none": 0, "mild": 1, "moderate": 2, "severe": 3}

# regulatory terms on the CSV -> pipeline Severity enum
CONTRA_SEV_MAP = {"absolute": "severe", "relative": "moderate"}

# Molecule groups for the combination (graph) rules — ported 1:1 from the TS
# safety plane (apps/web/src/lib/safety/dataset.ts, MOLECULE_GROUPS) under
# ADR-0012 so both engines run the same law on the same corpus.
#
# qt_prolonging (snapshot 2026-09-18): CredibleMeds "Known risk" molecules that
# are present in the expanded Indian formulary, plus ofloxacin (Conditional
# risk, kept because the fluoroquinolone class carries a QT signal and the
# pre-expansion plane already screened it — removing it would be a silent
# safety regression). The 31 remaining Conditional-risk molecules ship as
# reference data (05_qt_drugs/qt_prolonging_drugs.csv) and do NOT trigger the
# severe >=3 stack rule: conditional risk manifests only under overdose,
# hypokalemia or interacting co-meds, so auto-firing would cost specificity.
MOLECULE_GROUPS: dict[str, tuple[str, ...]] = {
    "nsaid": ("ibuprofen", "diclofenac", "naproxen", "aceclofenac", "aspirin"),
    "raas_blocker": ("enalapril", "ramipril", "lisinopril", "losartan", "telmisartan"),
    "loop_or_thiazide": ("furosemide", "torasemide", "hydrochlorothiazide"),
    "qt_prolonging": ("amiodarone", "amitriptyline", "azithromycin",
                      "chlorpromazine", "ciprofloxacin", "citalopram",
                      "clarithromycin", "chloroquine", "cotrimoxazole",
                      "erythromycin", "fluoxetine",
                      "gefitinib", "haloperidol", "hydroxychloroquine",
                      "ivabradine", "levofloxacin", "moxifloxacin",
                      "ofloxacin", "ondansetron", "quinine",
                      "ranolazine", "risperidone", "sertraline",
                      "sotalol", "tetrabenazine", "voriconazole",
                      "ziprasidone"),
    "ssri": ("sertraline", "fluoxetine", "citalopram"),
    "serotonergic": ("tramadol", "sumatriptan", "amitriptyline"),
    "anticoagulant_or_antiplatelet": ("warfarin", "aspirin", "clopidogrel"),
    "benzodiazepine": ("alprazolam", "clonazepam"),
}


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
    def load(cls, data_dir: str | None = None) -> SafetyEngine:
        data_dir = data_dir or DATA_DIR
        eng = cls()
        with open(os.path.join(data_dir, "brands.csv"), encoding="utf-8") as f:
            for row in csv.DictReader(f):
                row["jas_price_inr"] = _f(row.get("jas_price_inr"))
                # Fold the DISPLAY name too, not just its key. The web tier
                # compiles the same CSV through the identical fold
                # (``fold_spaces`` in tools/build_web_dataset.py), so 11 catalog
                # rows whose name carries a U+00A0 would otherwise be resolved
                # to the same row by both planes and then *named* differently in
                # the verdict — one engine, two spellings of one drug.
                row["brand"] = _fold_spaces(row["brand"])
                eng.brands[_norm_key(row["brand"])] = row
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
        key = _norm_key(brand_text)
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
            context: dict | None = None,
            threshold_set_id: str | None = None,
            skip_gate: bool = False,
            ) -> tuple[SafetyReport, list, bool]:
        """Returns (report, confirm_items, all_fields_verified).

        all_fields_verified is False when any field sits below the gate.
        The caller (verdict assembly) MUST route unverified fields away from
        spoken/rendered safety output - that is the product's core law.

        The band decision for every field is delegated to ``app.gate.band_of``
        so the gate law exists exactly once per tier and carries its fused
        score + threshold-set id into the report's provenance.

        ``skip_gate`` is the experiment-only switch (A3 / ablations in
        ``ml/ladder.py``): resolvable fields are treated as auto-confirmed so
        the rule plane can be measured on its own. The product path never sets
        it; the TS mirror exposes the same flag as ``EngineInput.skipGate``.
        """
        thresholds = get_threshold_set(threshold_set_id)
        context = self.validate_context(context or {})
        meds: list[NormalizedMedication] = []
        # meds is built from a filtered pass over fields, so a med's position in
        # it is not its line number. The cap rule below queues the *lines* that
        # contribute to a breach, and needs the original field index.
        med_indices: list[int] = []
        confirm_items: list = []
        warnings: list[str] = []
        hazards: list[DoseRuleFinding] = []
        decisions: list[GateFieldDecision] = []
        band_decisions: list = []  # app.gate.FieldDecision (raw band objects)
        for i, fld in enumerate(fields):
            row = self.normalize(fld.brand_text or fld.raw_text)
            # Enrich AFTER the formulary lookup: a line that states its strength
            # only through the brand ("Cap. Folitrax 10 HS") needs the resolved
            # row to know it is a 10 mg methotrexate course.
            fld = enrich_field(
                fld,
                brand=row["brand"] if row else None,
                molecule=row["molecule"].lower() if row else None,
            )
            resolvable = row is not None
            reading_conf = 1.0 if (skip_gate and resolvable) else fld.confidence
            decision = band_of(reading_conf, resolvable, thresholds)
            band_decisions.append(decision)
            decisions.append(GateFieldDecision(
                field_index=i, band=decision.band, fused=decision.fused,
                resolvable=resolvable,
                reading_confidence=decision.reading_confidence,
                reason=decision.reason))
            if row is None:
                confirm_items.append({
                    "field_index": i, "raw_text": fld.raw_text,
                    "confidence": fld.confidence,
                    "reason": "brand not in formulary map",
                    "band": decision.band, "fused": decision.fused,
                    "why": decision.reason,
                })
                continue
            meds.append(NormalizedMedication(
                brand=row["brand"], molecule=row["molecule"], form=row["form"],
                atc=row["atc"], aware_class=row.get("aware_class", row.get("aware", "")),
                jas_price_inr=row["jas_price_inr"], fields=[fld],
            ))
            med_indices.append(i)
            if decision.queued or decision.refused:
                confirm_items.append({
                    "field_index": i, "raw_text": fld.raw_text,
                    "confidence": fld.confidence,
                    "reason": "low field confidence",
                    "band": decision.band, "fused": decision.fused,
                    "why": decision.reason,
                })
            w = dose_warning(fld, row["molecule"].lower(), context)
            if w:
                warnings.append(f"{row['brand']}: {w}")

            # Look-alike / different-strength guard. The substring resolver
            # matches "Thyronorm 50" for a line reading 500 mcg; the strength
            # contradiction IS the uncertainty, so it queues rather than passing.
            mm = strength_mismatch(fld, row["brand"])
            if mm and not any(c.get("field_index") == i for c in confirm_items):
                confirm_items.append({
                    "field_index": i, "raw_text": fld.raw_text,
                    "confidence": fld.confidence,
                    "reason": "strength does not match the formulary entry",
                    "band": CONFIRM, "fused": decision.fused,
                    "why": f"{row['brand']}: {mm}",
                })

            # A frequency the perception layer states but the interval law cannot
            # read is the worst kind of uncertainty: the schedule is unknown, and
            # the scheduler refuses to invent one. That belongs in the human
            # queue, not in a warning nobody has to clear before a plan starts.
            if (fld.frequency or "").strip() and parse_frequency(fld.frequency) is None \
                    and not any(c.get("field_index") == i for c in confirm_items):
                confirm_items.append({
                    "field_index": i, "raw_text": fld.raw_text,
                    "confidence": fld.confidence,
                    "reason": "dosing frequency is not a recognized code",
                    "band": CONFIRM, "fused": decision.fused,
                    "why": f"{row['brand']}: '{fld.frequency.strip()}' is not an "
                           f"administration code this engine knows, and the "
                           f"scheduler will not guess one.",
                })

            # Never-event schedule check. A line can be read perfectly, resolve
            # to a real brand, carry no interaction and still describe a lethal
            # regimen (oral methotrexate once-daily). Confidence-based routing
            # cannot see this, and a mg/day cap cannot express it — so it gets
            # its own rule, and it BLOCKS instead of warning.
            hz = interval_hazard(fld, row["molecule"].lower(), row.get("form"))
            if hz is not None:
                rule, freq = hz
                found = interval_text(fld, row, rule, freq)
                hazards.append(DoseRuleFinding(
                    molecule=row["molecule"], brand=row["brand"],
                    severity=Severity.severe,
                    observed=fld.frequency.strip(),
                    required=f"no more often than every {rule.min_interval_days} days",
                    note=found,
                    source=rule.source))
                if not any(c.get("field_index") == i for c in confirm_items):
                    confirm_items.append({
                        "field_index": i, "raw_text": fld.raw_text,
                        "confidence": fld.confidence,
                        "reason": "never-event dosing interval",
                        "band": CONFIRM, "fused": decision.fused,
                        "why": found,
                    })

        interactions: list[InteractionFinding] = []
        seen_pairs: set = set()
        for i in range(len(meds)):
            for j in range(i + 1, len(meds)):
                for mol_a in _molecule_identities(meds[i].molecule):
                    for mol_b in _molecule_identities(meds[j].molecule):
                        hit = self.screen_pair(mol_a, mol_b)
                        if hit:
                            # One finding per documented row. A combination brand
                            # crosses several identities against one partner
                            # (component + whole string), and the same pair can
                            # also arrive from another line pairing; the reviewer
                            # card is not served twice for one mechanism.
                            key = (min(hit["molecule_a"].lower(), hit["molecule_b"].lower()),
                                   max(hit["molecule_a"].lower(), hit["molecule_b"].lower()))
                            if key in seen_pairs:
                                continue
                            seen_pairs.add(key)
                            interactions.append(InteractionFinding(
                                molecule_a=hit["molecule_a"], molecule_b=hit["molecule_b"],
                                severity=Severity(hit["severity"]),
                                mechanism=hit["mechanism"], source=hit["source"]))

        contras: list[ContraindicationFinding] = []
        seen_contras: set = set()
        for m in meds:
            for mol in _molecule_identities(m.molecule):
                for rule in self.contraindications_for(mol, context):
                    key = (mol, rule["condition_code"])
                    if key in seen_contras:
                        continue
                    seen_contras.add(key)
                    contras.append(ContraindicationFinding(
                        molecule=mol, condition_code=rule["condition_code"],
                        severity=Severity(rule["severity"]), note=rule["note"]))

        # 3. combination (graph) rules — dangers that are pairwise-invisible.
        # Ported from the TS plane (ADR-0012); emitted as InteractionFindings so
        # the verdict law consumes one finding stream. Group order mirrors TS.
        mol_list: list[str] = []
        seen_mols: set[str] = set()
        for m in meds:
            for mol in _split_molecules(m.molecule):
                if mol not in seen_mols:
                    seen_mols.add(mol)
                    mol_list.append(mol)
        interactions.extend(_combination_rules(mol_list))

        duplicates = self.find_duplicates(meds)

        # Aggregate daily-cap rule: two paracetamol brands can each sit under
        # the cap while the combination blows through it. Sum per molecule.
        totals: dict[str, float] = {}
        contribs: dict[str, list[int]] = {}          # molecule -> position in meds
        for k, m in enumerate(meds):
            mols = _split_molecules(m.molecule)
            if not m.fields:
                continue
            d = daily_dose_mg(m.fields[0])
            if d is None:
                continue
            if len(mols) == 1:
                totals[mols[0]] = totals.get(mols[0], 0.0) + d
                contribs.setdefault(mols[0], []).append(k)
            else:
                # A combination line states ONE strength ("T. Ecospirin AV 75
                # 75 mg" = aspirin 75 + atorvastatin 10). Applying that 75 mg to
                # every expanded molecule invented 300 mg/day of atorvastatin and
                # queued a routine statin+aspirin regimen for a 380 mg/day
                # "overdose". The sum is only honest when one molecule owns the
                # one stated strength, so a combination line contributes nothing
                # until brands.csv carries per-component strengths; say so
                # instead of guessing.
                capped = [mol for mol in mols if mol in DAILY_CAPS_MG]
                if capped:
                    warnings.append(
                        f"{m.brand}: combination product, per-component strengths "
                        f"are not in the formulary, so the {', '.join(capped)} "
                        "daily cap could not be checked for this line")

        for mol, total in sorted(totals.items()):
            outcome, limit, lowering = cap_check(mol, total, context)
            if outcome == "clean":
                continue
            note = (f"aggregate {total:g} mg/day exceeds the {limit:g} mg/day "
                    f"{mol} cap")
            if lowering:
                note += (f" - the declared conditions on this patient lower it from "
                         f"{DAILY_CAPS_MG[mol]:g} mg/day")
            if outcome == "advise" and mol not in HARD_CAP_MG:
                # Not a ceiling at all — level-guided, weight-based or
                # specialist-supervised. warfarin's "10 mg" is an INR-titrated
                # practice figure, theophylline's is a serum level, isotretinoin's
                # is mg/kg. The engine cannot know the right number for THIS
                # patient, so it says so and does not touch the verdict.
                warnings.append(
                    f"{note} - {CAP_BASIS.get(mol, 'advisory')}-dosed, so this is "
                    "advisory, not a maximum")
                continue
            if outcome == "advise":
                # Only the label's lower figure was passed — the OTC self-care cap
                # that sits under a prescription maximum. Dropping that second
                # number is how a 1600 mg/day ibuprofen course began passing in
                # silence: the ceiling it really breached was 1200, not 2400.
                warnings.append(
                    f"aggregate {total:g} mg/day is above the {limit:g} mg/day "
                    f"{mol} self-care limit; the label maximum is "
                    f"{DAILY_CAPS_MG[mol]:g} mg/day, so this is advisory, not a "
                    "maximum")
                continue
            warnings.append(f"combined {mol} daily dose {total:g} mg from "
                            f"{len(contribs[mol])} line(s) exceeds the "
                            f"{limit:g} mg/day cap")
            # Past half again a real label maximum this is the same class of error
            # as a forbidden interval: the read is clean, the regimen is not, and a
            # mg/day string in `warnings` changes no verdict. It becomes a hazard
            # and queues the contributing lines — mirroring the TS tier, which
            # escalated it to an "interaction" verdict while this tier passed it
            # ("Tab Cetzine 10 BD" = 20 mg against a 10 mg cap).
            if total <= limit * 1.5:
                continue
            hazards.append(DoseRuleFinding(
                # The table's own spelling, not a display-cased paraphrase of it:
                # the TS tier emits `mol` verbatim, so `.title()` here meant the
                # same hazard read "Ferrous Sulfate" on one plane and
                # "ferrous sulfate" on the other. Verdicts matched, so parity
                # never saw it. One identity, one spelling, everywhere.
                molecule=mol,
                brand=" + ".join(dict.fromkeys(meds[k].brand for k in contribs[mol])),
                severity=Severity.severe,
                observed=f"{total:g} mg/day",
                required=f"no more than {limit:g} mg/day",
                note=note,
                source=CAP_SOURCE))
            for k in contribs[mol]:
                field_index = med_indices[k]
                if any(c.get("field_index") == field_index for c in confirm_items):
                    continue
                fld = fields[field_index]
                confirm_items.append({
                    "field_index": field_index,
                    "raw_text": fld.raw_text,
                    "confidence": fld.confidence,
                    "reason": "daily dose exceeds the label maximum",
                    "band": CONFIRM, "fused": decisions[field_index].fused,
                    "why": note,
                })

        # Gate provenance: the fused score (formulary resolvability + reading
        # confidence) and the band it lands in, persisted with the verdict.
        if all_below_refusal(band_decisions):
            prescription_band = REFUSED
        elif confirm_items:
            prescription_band = CONFIRM
        else:
            prescription_band = AUTO
        gate = GateMetadata(
            threshold_set_id=thresholds.set_id,
            refuse_below=thresholds.refuse_below,
            confirm_below=thresholds.confirm_below,
            fusion=thresholds.fusion.as_dict(),
            banding=thresholds.banding,
            prescription_fused=fuse_prescription(
                len(meds), len(confirm_items),
                [f.confidence for f in fields], thresholds.fusion),
            prescription_band=prescription_band,
            decisions=decisions)

        report = SafetyReport(
            medications=meds, interactions=interactions, contraindications=contras,
            duplicates=duplicates, warnings=warnings, gate=gate,
            dose_hazards=hazards,
            checks={
                "normalize": True, "interaction_graph": True,
                "combination_rules": True,
                "contraindication_rules": True, "duplicate_atc": True,
                "aware_tagging": True, "dose_plausibility": True,
                "interval_mandates": True,
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


def _molecule_identities(s: str) -> list[str]:
    """Every name one med can be matched under: components, then the whole.

    Some table rows are documented at combination granularity — "amiodarone +
    artemether+lumefantrine", "artemether+lumefantrine" contraindicated in
    pregnancy — while screening has always walked components, which left 176
    interaction rows and 17 contraindication rows unreachable (measured against
    the loaded tables, not assumed). Components come first so an existing
    finding keeps its position and text; the combination identity is appended
    only for a real combination.
    """
    parts = _split_molecules(s)
    if len(parts) > 1:
        return [*parts, "+".join(parts)]
    return parts


def _group_members(group: str, molecules: list[str]) -> list[str]:
    """Molecules of `molecules` that belong to `group`, in group-declaration
    order (mirrors the TS plane's filter-then-index behavior)."""
    present = set(molecules)
    return [m for m in MOLECULE_GROUPS.get(group, ()) if m in present]


def _combination_rules(molecules: list[str]) -> list[InteractionFinding]:
    """Graph rules over the ACTIVE molecule set (ported 1:1 from the TS plane,
    ADR-0012). Each rule catches a danger the pairwise table cannot express:
    triple whammy (ARB/ACEi + diuretic + NSAID -> AKI), QT stacks (>=3
    prolongers), serotonin stacks (SSRI + >=2 serotonergic), and the bleeding
    stack (antithrombotic + SSRI + NSAID). All are severe by definition.
    """
    out: list[InteractionFinding] = []
    raas = _group_members("raas_blocker", molecules)
    diu = _group_members("loop_or_thiazide", molecules)
    nsaid = _group_members("nsaid", molecules)
    qt = _group_members("qt_prolonging", molecules)
    ssri = _group_members("ssri", molecules)
    seroton = [m for m in _group_members("serotonergic", molecules) if m not in ssri]
    blood = _group_members("anticoagulant_or_antiplatelet", molecules)

    if raas and diu and nsaid:
        out.append(InteractionFinding(
            molecule_a=raas[0], molecule_b=" + ".join([diu[0], nsaid[0]]),
            severity=Severity.severe,
            mechanism="RAAS blocker + diuretic + NSAID (triple whammy) - acute kidney injury risk",
            source="BMJ/AKI guidance"))
    if len(qt) >= 3:
        out.append(InteractionFinding(
            molecule_a=qt[0], molecule_b=" + ".join(qt[1:]),
            severity=Severity.severe,
            mechanism=f"{len(qt)} QT-prolonging medicines together - torsades risk",
            source="CredibleMeds"))
    if ssri and len(seroton) >= 2:
        out.append(InteractionFinding(
            molecule_a=ssri[0], molecule_b=" + ".join(seroton),
            severity=Severity.severe,
            mechanism="SSRI with multiple serotonergic agents - serotonin syndrome risk",
            source="FDA/Stockley"))
    if blood and ssri and nsaid:
        out.append(InteractionFinding(
            molecule_a=blood[0], molecule_b=" + ".join([ssri[0], nsaid[0]]),
            severity=Severity.severe,
            mechanism="Antithrombotic + SSRI + NSAID - compounded GI bleeding risk",
            source="BMJ"))
    return out


def interval_text(fld, row: dict, rule, freq) -> str:
    """The human-facing sentence for a never-event schedule violation."""
    strength = (fld.strength or fld.dose or "").strip()
    return (
        f"{row['brand']} ({row['molecule']}{f' {strength}' if strength else ''}) "
        f"is prescribed {fld.frequency.strip()}, but this formulation is labeled "
        f"for administration no more often than every {rule.min_interval_days} days. "
        f"A daily schedule here is a known never-event, so the plan is blocked "
        f"until a human confirms the interval.")


def _norm_key(s: str | None) -> str:
    """Normalized brand key: NBSP-safe, case- and whitespace-insensitive.

    The expanded Jan Aushadhi catalog contains non-breaking spaces (U+00A0,
    e.g. "15\\u00a0IU"); ``str.split()`` already splits those, but the stored
    keys must be built the same way as query keys or exact lookup misses.
    """
    return " ".join((s or "").replace("\u00a0", " ").strip().lower().split())


def _fold_spaces(s: str | None) -> str:
    """Display-name fold: case untouched, exotic whitespace and doubles are not.

    Mirrors ``fold_spaces`` in tools/build_web_dataset.py, which applies the
    same fold to the web tier's copy of this table. Only whitespace changes, so
    the name is still the catalog's own words.
    """
    return " ".join((s or "").replace("\u00a0", " ").strip().split())


def _split_atc(s: str) -> list[str]:
    """ATC codes keep their original case (codes are uppercase by convention)."""
    return [m.strip() for m in (s or "").replace(",", "+").split("+") if m.strip()]


def _f(x):
    try:
        return round(float(x), 2)
    except (TypeError, ValueError):
        return None
