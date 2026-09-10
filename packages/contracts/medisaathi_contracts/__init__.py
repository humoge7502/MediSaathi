"""MediSaathi typed contracts."""
from medisaathi_contracts.models import (  # noqa: F401
    AudioSegment,
    AudioSegmentKind,
    ConfirmItem,
    ContraindicationFinding,
    DuplicateFinding,
    Envelope,
    ExtractionField,
    ExtractionResult,
    FieldSource,
    InteractionFinding,
    LiveExtraction,
    LiveLine,
    NormalizedMedication,
    PlanSlot,
    PrescriptionState,
    PriceReport,
    PriceRow,
    PriceSummary,
    ProvenanceEntry,
    SafetyReport,
    Severity,
    SpokenPlan,
    Verdict,
    VerdictKind,
)

__version__ = "0.2.0"

# Patient-context codes the deterministic contraindication engine understands.
# The product contract: context is DECLARED by the user, never inferred by a model.
CONTEXT_CODES = (
    "pregnancy",
    "active_bleeding",
    "age_under_12",
    "age_under_16",
    "age_under_18",
    "peptic_ulcer",
    "asthma_aspirin_sensitive",
    "renal_severe",
    "hepatic_severe",
    "hyperkalemia",
    "hypoglycemia_unaware",
    "iodinated_contrast_48h",
    "myasthenia_gravis",
)
