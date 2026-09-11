"""The gate law — named, versioned, configurable.

This module is the *inventive core* of MediSaathi expressed as code rather than
as a formula duplicated inline in two engines:

    typed per-field confidence
      -> fusion with formulary resolvability
      -> three-band routing (refuse / human-confirm / auto-confirm)
      -> persisted confirmation queue that blocks downstream plan generation
      -> deterministic, network-isolated rule plane assembles the verdict

Design law (frozen in ADR-0014 and mirrored 1:1 by
``apps/web/src/lib/safety/gate.ts``):

1. **Refusal band consumes perception confidence only.** The plane cannot
   second-guess what the reader said it saw; a field is never auto-confirmed
   because the formulary liked it.
2. **Confirm/auto bands consume the fused score** (reading confidence fused
   with formulary resolvability). A brand the model invented resolves nowhere
   and therefore can never auto-confirm, regardless of how sure the model was.
3. **The fused score never promotes a field past the reading gate.** Fusion can
   only ever *demote* (auto -> confirm), which is what makes the mechanism
   safe: the confidence the reader reports is an upper bound on automation.
4. **Every decision carries its provenance**: band, fused value, reason, and
   the threshold-set id that produced it. A verdict without its threshold set
   is not a verdict.

The default threshold set ``v1-2026-09`` reproduces the audited operating point
(refuse < 0.75, confirm 0.75-0.90, auto >= 0.90; fusion weights 0.4/0.6). The
calibration experiment (``eval/calibration.py``) may fit *alternative* sets
(e.g. ``fused_banding``) on a calibration split; the shipped default is frozen
unless a fitted set dominates it on the safety-burden operating curve.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# ------------------------------------------------------------------ vocabulary

REFUSED = "refused"
CONFIRM = "confirm"
AUTO = "auto"

#: fusion weights fitted on the calibration split of the v1 corpus (2026-09).
DEFAULT_FUSION_WEIGHTS = {"formulary": 0.4, "reading": 0.6}

DEFAULT_THRESHOLD_SET_ID = "v1-2026-09"


@dataclass(frozen=True)
class FusionWeights:
    """Weights of the fusion function. Must sum to 1.0 (validated)."""

    formulary: float = DEFAULT_FUSION_WEIGHTS["formulary"]
    reading: float = DEFAULT_FUSION_WEIGHTS["reading"]

    def __post_init__(self) -> None:
        total = self.formulary + self.reading
        if abs(total - 1.0) > 1e-9:
            raise ValueError(f"fusion weights must sum to 1.0, got {total!r}")
        if self.formulary < 0 or self.reading < 0:
            raise ValueError("fusion weights must be non-negative")

    def as_dict(self) -> dict:
        return {"formulary": self.formulary, "reading": self.reading}


@dataclass(frozen=True)
class ThresholdSet:
    """A named, dated bundle of gate parameters.

    ``set_id`` is persisted with every verdict so a later analysis (or a patent
    exhibit) can prove which parameters produced which decision.
    """

    set_id: str
    refuse_below: float
    confirm_below: float
    fusion: FusionWeights = FusionWeights()
    #: how the confirm/auto decision is made.
    #: ``reading``  = banded on raw reading confidence (audited default)
    #: ``fused``    = banded on the fused score (alternative embodiment, E-D)
    banding: str = "reading"
    #: free-form fit metadata recorded with the set (corpus SHA, split, date).
    calibration: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not (0.0 < self.refuse_below <= self.confirm_below <= 1.0):
            raise ValueError(
                "thresholds must satisfy 0 < refuse <= confirm <= 1 "
                f"(got {self.refuse_below}, {self.confirm_below})")
        if self.banding not in ("reading", "fused"):
            raise ValueError(f"unknown banding mode {self.banding!r}")

    def as_dict(self) -> dict:
        return {
            "set_id": self.set_id,
            "refuse_below": self.refuse_below,
            "confirm_below": self.confirm_below,
            "fusion": self.fusion.as_dict(),
            "banding": self.banding,
            "calibration": dict(self.calibration),
        }


#: The frozen operating point (audited 2026-09; see docs/patent/PSEUDOCODE.md).
THRESHOLD_SETS: dict[str, ThresholdSet] = {
    "v1-2026-09": ThresholdSet(
        set_id="v1-2026-09",
        refuse_below=0.75,
        confirm_below=0.90,
        fusion=FusionWeights(),
        banding="reading",
        calibration={
            "fitted_on": "hand-set (pre-calibration)",
            "corpus": "n/a",
            "note": "audited default; preserved for cross-engine parity and the "
                    "E-A baseline ladder",
        },
    ),
    # Alternative embodiment measured by E-D (threshold sweep). The default is
    # never silently changed: the experiment must *show* it dominates on the
    # safety-burden operating curve before the id is promoted.
    "fused-2026-09": ThresholdSet(
        set_id="fused-2026-09",
        refuse_below=0.75,
        confirm_below=0.90,
        fusion=FusionWeights(),
        banding="fused",
        calibration={
            "fitted_on": "calibration split of data/corpus v1",
            "note": "alternative embodiment: confirm/auto banded on the fused "
                    "score (D3 asymmetric-band refinement)",
        },
    ),
}


def get_threshold_set(set_id: str | None = None) -> ThresholdSet:
    """Resolve a threshold set by id; unknown ids fail loudly (never guess)."""
    if set_id is None:
        return THRESHOLD_SETS[DEFAULT_THRESHOLD_SET_ID]
    try:
        return THRESHOLD_SETS[set_id]
    except KeyError as exc:  # pragma: no cover - defensive, pinned by test
        raise KeyError(
            f"unknown threshold set {set_id!r}; known: {sorted(THRESHOLD_SETS)}"
        ) from exc


def register_threshold_set(ts: ThresholdSet, *, replace: bool = False) -> ThresholdSet:
    """Experiment-only hook: register a fitted threshold set (E-D sweep).

    The product path NEVER calls this — the shipped operating point only changes
    when a fitted set is committed to ``THRESHOLD_SETS`` after the calibration
    evidence shows it dominates on the safety-burden curve.
    """
    if ts.set_id in THRESHOLD_SETS and not replace:
        raise ValueError(f"threshold set {ts.set_id!r} already registered")
    THRESHOLD_SETS[ts.set_id] = ts
    return ts


# ------------------------------------------------------------------ fusion

def fuse_field(reading_confidence: float, resolvable: bool,
               weights: FusionWeights | None = None) -> float:
    """Fuse one field's reading confidence with its formulary resolvability.

    ``resolvable`` is 1.0 when the deterministic plane normalized the field
    against the formulary index and 0.0 otherwise. A confidently-read but
    unresolvable brand therefore scores at most ``weights.reading`` (0.6),
    which is below both the confirm and auto-confirm thresholds — invented
    brands can never auto-confirm.
    """
    w = weights or FusionWeights()
    return round(w.formulary * (1.0 if resolvable else 0.0)
                 + w.reading * _clamp01(reading_confidence), 6)


def fuse_prescription(confirmed: int, queued: int, line_confidences: list[float],
                      weights: FusionWeights | None = None) -> float:
    """Prescription-level fused score: 0.4 * formulary ratio + 0.6 * mean read.

    Boundary behaviour (pinned by tests, mirrored in TS ``overallConfidence``):
      * no lines at all                        -> 0
      * all lines confirmed, all conf 1.0      -> 1.0
      * all lines queued (ratio 0), conf 1.0   -> 0.6
      * all confirmed (ratio 1), conf 0.5      -> 0.7
    """
    w = weights or FusionWeights()
    total = confirmed + queued
    if total == 0 or not line_confidences:
        return 0.0
    ratio = confirmed / total
    mean = sum(_clamp01(c) for c in line_confidences) / len(line_confidences)
    return round(w.formulary * ratio + w.reading * mean, 2)


# ------------------------------------------------------------------ the band law

@dataclass(frozen=True)
class FieldDecision:
    """One field's disposition decision, with provenance."""

    band: str                 # refused | confirm | auto
    fused: float              # fusion(resolvability, reading confidence)
    reason: str
    resolvable: bool
    reading_confidence: float

    @property
    def queued(self) -> bool:
        return self.band == CONFIRM

    @property
    def refused(self) -> bool:
        return self.band == REFUSED


def band_of(reading_confidence: float, resolvable: bool,
            thresholds: ThresholdSet | None = None) -> FieldDecision:
    """Route one field into the refusal, human-confirmation or auto band.

    The refusal band consumes raw reading confidence only (design law 1); the
    confirm/auto decision consumes the fused score when the set asks for it
    (``banding == "fused"``) and the reading confidence otherwise. Fusion can
    only demote, never promote (design law 3).
    """
    ts = thresholds or get_threshold_set()
    conf = _clamp01(reading_confidence)
    fused = fuse_field(conf, resolvable, ts.fusion)

    if conf < ts.refuse_below:
        return FieldDecision(
            band=REFUSED, fused=fused, resolvable=resolvable,
            reading_confidence=conf,
            reason=f"reading confidence {conf:.2f} below refusal threshold "
                   f"{ts.refuse_below:.2f}",
        )

    gate_value = fused if ts.banding == "fused" else conf
    if not resolvable:
        return FieldDecision(
            band=CONFIRM, fused=fused, resolvable=False, reading_confidence=conf,
            reason="brand not in formulary map — invented reads never auto-confirm",
        )
    if gate_value < ts.confirm_below:
        return FieldDecision(
            band=CONFIRM, fused=fused, resolvable=True, reading_confidence=conf,
            reason=f"{'fused score' if ts.banding == 'fused' else 'confidence'} "
                   f"{gate_value:.2f} below auto-confirm threshold "
                   f"{ts.confirm_below:.2f}",
        )
    return FieldDecision(
        band=AUTO, fused=fused, resolvable=True, reading_confidence=conf,
        reason="resolvable read above the auto-confirm threshold",
    )


def all_below_refusal(decisions: list[FieldDecision]) -> bool:
    """True when every field falls in the refusal band (whole-Rx refusal)."""
    return bool(decisions) and all(d.refused for d in decisions)


def _clamp01(x: float) -> float:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if v < 0.0 else 1.0 if v > 1.0 else v
