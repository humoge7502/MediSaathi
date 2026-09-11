"""Verdict assembly: the gate law lives here.

Decision order (first match wins):
  1. image unusable (RefusalCandidate)            -> refused
  2. all fields below REFUSE_BELOW (0.75)         -> refused
  3. any field below REFUSE_BELOW                 -> confirm_queue
  4. no formulary match at all                    -> confirm_queue
  5. any low-confidence / unmatched fields        -> confirm_queue
  6. any contraindication                         -> contraindication
  7. severe interaction                           -> interaction (severe)
  8. duplicate ATC / same-brand                   -> duplicate_atc
  9. moderate interaction                         -> interaction (moderate)
 10. otherwise                                    -> pass

The verdict NEVER exposes unverified fields to the spoken plan; if the queue
is non-empty, the plan endpoint returns 409 until a human resolves the queue.
"""
from __future__ import annotations

from medisaathi_contracts import (
    ConfirmItem,
    ProvenanceEntry,
    Severity,
    Verdict,
    VerdictKind,
)
from medisaathi_contracts.models import ExtractionResult, SafetyReport

from .safety.engine import REFUSE_BELOW, SafetyEngine

_SEV_ORDER = {Severity.none: 0, Severity.mild: 1, Severity.moderate: 2, Severity.severe: 3}


def assemble(engine: SafetyEngine, extraction: ExtractionResult,
             report: SafetyReport, confirm_items: list[ConfirmItem],
             *, enable_refusal: bool = True, enable_queue: bool = True,
             queue_unmatched: bool = True) -> Verdict:
    """Assemble the verdict under the gate law (first match wins).

    The keyword switches exist ONLY for the ablation harness (E-B in
    `ml/ladder.py`): the product path never passes them. Each one removes one
    component of the claimed mechanism so its necessity can be measured:

      ``enable_refusal``    False -> the refusal band is removed
      ``enable_queue``      False -> the queue becomes advisory, not blocking
      ``queue_unmatched``   False -> the fusion's formulary term is removed
                                     (an invented brand no longer queues)
    """
    prov = engine.provenance()
    prov.append(ProvenanceEntry(
        kind="extraction", name="field extraction",
        source=f"{extraction.engine}; per-field confidence recorded",
        snapshot="live"))
    # Gate provenance (MED-003): record the threshold set and fused score that
    # produced this verdict. A verdict is only reproducible with its parameters.
    if report.gate is not None:
        g = report.gate
        bands = {d.band for d in g.decisions}
        prov.append(ProvenanceEntry(
            kind="gate_law", name="confidence gate + fusion",
            source=(
                f"threshold set {g.threshold_set_id} "
                f"(refuse<{g.refuse_below:g}, confirm<{g.confirm_below:g}, "
                f"banding={g.banding}); "
                f"fused={g.prescription_fused:.2f}; bands={sorted(bands) or ['none']}"
            ),
            snapshot=g.threshold_set_id))

    if enable_refusal and extraction.fields and all(
            f.confidence < REFUSE_BELOW for f in extraction.fields):
        return Verdict(
            kind=VerdictKind.refused,
            headline="Refused: image could not be verified",
            detail=("No prescription content was detected. MediSaathi does not guess "
                    "from unusable images. Retake the photo in even light, flat and "
                    "in focus."),
            refusal_reason="all_fields_below_refusal_threshold",
            provenance=prov)

    if enable_refusal and any(f.confidence < REFUSE_BELOW for f in extraction.fields):
        return _queue(confirm_items, prov, "fields below refusal threshold")

    if queue_unmatched and not report.medications:
        return _queue(confirm_items, prov, "no medicine matched the formulary map")

    if enable_queue and confirm_items:
        return _queue(confirm_items, prov, "low-confidence fields await confirmation")

    if report.contraindications:
        c = report.contraindications[0]
        return Verdict(
            kind=VerdictKind.contraindication,
            headline=f"Contraindication flagged: {c.molecule}",
            detail=f"{c.condition_code}: {c.note}",
            max_interaction_severity=Severity.severe,
            provenance=prov)

    sev = Severity.none
    if report.interactions:
        sev = max((i.severity for i in report.interactions), key=lambda s: _SEV_ORDER[s])
        if sev == Severity.severe:
            worst = next(i for i in report.interactions if i.severity == sev)
            return Verdict(
                kind=VerdictKind.interaction,
                headline=f"Severe interaction: {worst.molecule_a} + {worst.molecule_b}",
                detail=worst.mechanism,
                max_interaction_severity=sev,
                provenance=prov)

    if report.duplicates:
        d = report.duplicates[0]
        return Verdict(
            kind=VerdictKind.duplicate_atc,
            headline=f"Duplicate medicines: {' + '.join(d.brands)}",
            detail=d.note,
            provenance=prov)

    if sev == Severity.moderate:
        worst = next(i for i in report.interactions if i.severity == sev)
        return Verdict(
            kind=VerdictKind.interaction,
            headline=f"Moderate interaction: {worst.molecule_a} + {worst.molecule_b}",
            detail=worst.mechanism,
            max_interaction_severity=sev,
            provenance=prov)

    return Verdict(
        kind=VerdictKind.pass_,
        headline="All checks passed",
        detail="Every medicine was matched, normalized, and screened. "
               "No interactions, contraindications, or duplicates found.",
        provenance=prov)


def refusal_from_exception(engine: SafetyEngine, reason: str) -> Verdict:
    """Refusal verdict for unusable images (refusal-as-feature)."""
    detail = {
        "no_prescription_content":
            "No prescription content was detected in the image. MediSaathi refuses "
            "rather than guess - point the camera at the prescription panel in even "
            "light, flat and in focus.",
        "unreadable_image":
            "The image is too dark, blurred, or glare-covered to read reliably. "
            "MediSaathi refuses rather than guess - retake the photo flat, in focus, "
            "with the flash off.",
    }.get(reason)
    if detail is None:
        detail = f"{reason} MediSaathi refuses rather than guesses."
    return Verdict(
        kind=VerdictKind.refused,
        headline="Refused: image could not be verified",
        detail=detail,
        refusal_reason=reason if reason in {
            "no_prescription_content", "unreadable_image", "all_fields_below_refusal_threshold",
        } else "no_prescription_content",
        provenance=engine.provenance())


def _queue(items: list[ConfirmItem], prov: list[ProvenanceEntry],
           reason: str) -> Verdict:
    return Verdict(
        kind=VerdictKind.confirm_queue,
        headline="Confirmation needed",
        detail=f"{reason}. {len(items)} field(s) need a human yes/no before the "
               "safety verdict is issued. This queue is the product working, "
               "not failing.",
        refusal_reason=None,
        provenance=prov)
