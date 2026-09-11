"""FHIR R4 MedicationRequest export (MED-028) — export-only mapping.

This is a **mapping and serialisation** module, not a live FHIR/ABDM integration.
The audit explicitly defers live integration ("vocabulary alignment only"): a
real integration needs identity, consent and an audited gateway, none of which
exist here. What this module proves is that a *verified* prescription maps
cleanly onto the standard resource shapes, so the data model is not the blocker
when integration is funded.

Two laws hold here exactly as in the rest of the system:

1. **Only verified fields are exported.** A field that sat in the refusal or
   human-confirmation band never becomes a `MedicationRequest`. Exporting an
   unverified read into a clinical record would be the same harm the gate
   exists to prevent, one hop downstream.
2. **A blocked prescription exports nothing.** If the confirm queue is
   non-empty the function raises, mirroring the plan-blocking law; the caller
   surfaces that as a 409 rather than a partial bundle.

FHIR shape: a `Bundle` (type ``collection``) of `MedicationRequest` resources,
plus a `Provenance` resource carrying the dataset snapshot and threshold set so
an imported record can be re-derived.
"""
from __future__ import annotations

from medisaathi_contracts import PrescriptionState

#: FHIR R4 value set: MedicationRequest.status
_STATUS_FOR_VERDICT = {
    "pass": "active",
    "interaction": "active",
    "contraindication": "active",
    "duplicate_atc": "active",
    "combination": "active",
    "moderate": "active",
    "confirm_queue": "draft",
    "refused": "draft",
}

#: FHIR R4 value set: timing/route for the frequencies the corpus uses.
_FREQ_PER_DAY = {"OD": 1, "HS": 1, "QHS": 1, "BD": 2, "TDS": 3, "QID": 4, "SOS": 1,
                 "QWK": 1 / 7}


class ExportBlockedError(Exception):
    """Raised when a prescription has unresolved fields or a refusal verdict."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _timing(frequency: str) -> dict | None:
    """Map a corpus frequency token to a FHIR Timing, or None if unparseable."""
    token = (frequency or "").strip().upper()
    if not token:
        return None
    per_day = _FREQ_PER_DAY.get(token)
    if per_day is None:
        # TAC codes 1-0-1 -> 2 doses/day; anything else is left unmapped rather
        # than guessed (an approximation in a dosage instruction is a safety bug).
        parts = token.split("-")
        if len(parts) == 3 and all(p.strip().isdigit() for p in parts):
            per_day = sum(int(p) for p in parts)
        else:
            return None
    if per_day <= 0:
        return None
    repeat = {"frequency": max(1, round(per_day)), "period": 1, "periodUnit": "d"}
    return {"repeat": repeat, "code": {"text": token}}


def _dosage_instruction(med, fields) -> list[dict]:
    dose = None
    for f in fields:
        if f.strength or f.dose:
            dose = (f.strength or f.dose)
            break
    instruction: dict = {"text": " ".join(
        p for p in [med.brand, med.molecule, dose or ""] if p)}
    timing = None
    for f in fields:
        timing = _timing(f.frequency)
        if timing:
            break
    if timing:
        instruction["timing"] = timing
    if dose:
        instruction["doseAndRate"] = [{
            "doseQuantity": {"value": _extract_mg(dose), "unit": "mg",
                             "system": "http://unitsofmeasure.org", "code": "mg"}
        }]
    return [instruction]


def _extract_mg(text: str) -> float | None:
    import re
    m = re.search(r"(\d+(?:\.\d+)?)\s*(mg|mcg|g)\b", (text or "").lower())
    if not m:
        return None
    value = float(m.group(1))
    unit = m.group(2)
    return value / 1000 if unit == "mcg" else value * 1000 if unit == "g" else value


def to_fhir_bundle(rx: PrescriptionState) -> dict:
    """Export a verified prescription as a FHIR R4 collection Bundle.

    Raises ``ExportBlockedError`` when the confirm queue is non-empty or the
    verdict is a refusal — an export must never launder an unverified read into
    a clinical record.
    """
    if rx.safety is None or rx.verdict is None:
        raise ExportBlockedError("prescription has no assembled verdict to export")
    if rx.confirm_queue:
        raise ExportBlockedError(
            f"{len(rx.confirm_queue)} field(s) awaiting human confirmation — "
            "resolve the confirm queue before exporting")
    kind = rx.verdict.kind.value
    if kind == "refused":
        raise ExportBlockedError("refused verdicts are not exported")

    entries: list[dict] = []
    for i, med in enumerate(rx.safety.medications):
        fields = [f for f in (rx.extraction.fields if rx.extraction else [])
                  if (f.brand_text or "").strip().lower() == med.brand.strip().lower()
                  or med.brand.strip().lower() in (f.raw_text or "").lower()]
        resource = {
            "resourceType": "MedicationRequest",
            "id": f"{rx.prescription_id}-{i + 1}",
            "status": _STATUS_FOR_VERDICT.get(kind, "unknown"),
            "intent": "order",
            "medicationCodeableConcept": {
                "text": med.brand,
                "coding": ([{"system": "http://www.whocc.no/atc", "code": med.atc}]
                           if med.atc else []),
            },
            "subject": {"reference": f"Patient/{rx.sample_id}"},
            # Export only: the prescribing clinician is not modelled here, and
            # inventing one would fabricate clinical provenance.
            "authoredOn": None,
            "dosageInstruction": _dosage_instruction(med, fields),
            "note": [{"text": f"MediSaathi verdict: {kind}; "
                              f"threshold set {rx.threshold_set_id or 'unrecorded'}. "
                              f"Information layer, not a medical device."}],
        }
        entries.append({"fullUrl": f"urn:uuid:{resource['id']}",
                        "resource": resource})

    entries.append({
        "fullUrl": f"urn:uuid:{rx.prescription_id}-provenance",
        "resource": {
            "resourceType": "Provenance",
            "id": f"{rx.prescription_id}-provenance",
            "target": [{"reference": f"urn:uuid:{rx.prescription_id}-{i + 1}"}
                       for i in range(len(rx.safety.medications))],
            "recorded": None,
            "agent": [{"who": {"display": "MediSaathi deterministic safety plane"},
                       "type": {"text": "assembler"}}],
            "entity": [{"role": "source", "what": {"display": (
                f"dataset_snapshot={rx.meta.get('snapshot', 'unrecorded')}; "
                f"threshold_set={rx.threshold_set_id or 'unrecorded'}; "
                f"prescription_fused={rx.prescription_fused}")}}],
        },
    })

    return {
        "resourceType": "Bundle",
        "id": rx.prescription_id,
        "type": "collection",
        "entry": entries,
        "meta": {
            "tag": [{
                "system": "https://medisaathi.example/fhir/export-provenance",
                "code": rx.meta.get("snapshot", "unrecorded"),
                "display": "MediSaathi dataset snapshot",
            }],
        },
    }
