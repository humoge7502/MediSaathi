"""MediSaathi typed contracts (Pydantic v2).

The single source of truth for every boundary crossing. The TypeScript client
in apps/web mirrors these shapes (envelope + payload), so the frontend cannot
silently drift from the backend contract: every response is an `Envelope`.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

# ---------------------------------------------------------------- enums


class Severity(str, Enum):
    none = "none"
    mild = "mild"
    moderate = "moderate"
    severe = "severe"


class VerdictKind(str, Enum):
    pass_ = "pass"
    interaction = "interaction"
    contraindication = "contraindication"
    duplicate_atc = "duplicate_atc"
    confirm_queue = "confirm_queue"
    refused = "refused"


class FieldSource(str, Enum):
    vision = "vision"
    user_confirmation = "user_confirmation"
    seed_fixture = "seed_fixture"


class AudioSegmentKind(str, Enum):
    open = "open"
    medication = "medication"
    warning = "warning"
    contraindication = "contraindication"
    duplicate = "duplicate"
    close = "close"


# ---------------------------------------------------------------- perception plane


class ExtractionField(BaseModel):
    """One OCR/vision-extracted prescription line field with its confidence."""

    raw_text: str
    brand_text: str = ""
    strength: str = ""
    dose: str = ""
    frequency: str = ""
    duration: str = ""
    confidence: float = Field(ge=0.0, le=1.0)
    source: FieldSource = FieldSource.vision


class ExtractionResult(BaseModel):
    sample_id: str
    fields: list[ExtractionField]
    engine: str = "fixture-v0"          # or "live:<model>" when live
    latency_ms: int = 0


class LiveLine(BaseModel):
    """One line inside the JSON schema the live vision model must answer with."""

    raw_text: str
    brand_text: str = ""
    strength: str = ""
    dose: str = ""
    frequency: str = ""
    duration: str = ""
    confidence: float = Field(ge=0.0, le=1.0)


class LiveExtraction(BaseModel):
    """Schema-constrained answer envelope for the live vision path."""

    prescription_detected: bool
    refusal_reason: Optional[str] = None
    lines: list[LiveLine] = []


# ---------------------------------------------------------------- safety plane


class NormalizedMedication(BaseModel):
    brand: str
    molecule: str
    form: str = ""
    atc: str = ""
    aware_class: str = ""
    jas_price_inr: Optional[float] = None
    fields: list[ExtractionField] = []


class InteractionFinding(BaseModel):
    molecule_a: str
    molecule_b: str
    severity: Severity
    mechanism: str
    source: str


class ContraindicationFinding(BaseModel):
    molecule: str
    condition_code: str
    severity: Severity
    note: str


class DuplicateFinding(BaseModel):
    atc: str
    brands: list[str]
    note: str


class SafetyReport(BaseModel):
    medications: list[NormalizedMedication]
    interactions: list[InteractionFinding]
    contraindications: list[ContraindicationFinding]
    duplicates: list[DuplicateFinding]
    checks: dict[str, bool]  # rule_name -> executed_ok
    warnings: list[str] = []  # dose-plausibility notes (deterministic)


# ---------------------------------------------------------------- gate + verdict


class ConfirmItem(BaseModel):
    field_index: int
    raw_text: str
    confidence: float
    reason: str


class ProvenanceEntry(BaseModel):
    kind: str                      # extraction | safety_check | data_snapshot
    name: str
    source: str
    snapshot: str = "2026-09"


class Verdict(BaseModel):
    kind: VerdictKind
    headline: str
    detail: str = ""
    max_interaction_severity: Severity = Severity.none
    refusal_reason: Optional[str] = None
    provenance: list[ProvenanceEntry] = []


# ---------------------------------------------------------------- envelopes


class PlanSlot(BaseModel):
    slot: str
    value: str
    verified: bool


class AudioSegment(BaseModel):
    """One speakable sentence, traceable to the slots it rephrases."""

    kind: AudioSegmentKind
    text: str
    slot_refs: list[str] = []


class SpokenPlan(BaseModel):
    language: str = "en"
    slots: list[PlanSlot]
    segments: list[AudioSegment] = []
    script: str
    audio_url: Optional[str] = None
    disclaimer: str = (
        "MediSaathi is an information tool, not a doctor. "
        "Discuss every medicine with your pharmacist or doctor."
    )


class PriceRow(BaseModel):
    brand: str
    molecule: str
    unit_price_inr: Optional[float] = None
    generic_available: bool = False
    generic_price_inr: Optional[float] = None
    generic_brand: Optional[str] = None
    savings_inr: Optional[float] = None
    source: str = "Jan Aushadhi"


class PriceSummary(BaseModel):
    unit_total_inr: float = 0.0
    generic_total_inr: float = 0.0
    savings_total_inr: float = 0.0
    snapshot: str = "2026-09"


class PriceReport(BaseModel):
    rows: list[PriceRow] = []
    summary: PriceSummary = PriceSummary()


class PrescriptionState(BaseModel):
    prescription_id: str
    sample_id: str
    # Declared patient context (validated vocabulary keys -> bool). Persisted so
    # confirm-queue resolutions re-screen against the SAME context the run
    # started with - regression: context used to be dropped after any confirm.
    context: dict[str, bool] = {}
    extraction: Optional[ExtractionResult] = None
    safety: Optional[SafetyReport] = None
    verdict: Optional[Verdict] = None
    confirm_queue: list[ConfirmItem] = []
    spoken_plan: Optional[SpokenPlan] = None
    price_rows: list[PriceRow] = []
    meta: dict = {}


class Envelope(BaseModel):
    """Every API response is wrapped in this envelope."""

    ok: bool = True
    data: Optional[dict] = None
    error: Optional[str] = None
    meta: dict = {"api_version": "v1", "engines_version": "fixture-v0"}
