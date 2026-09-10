"""MediSaathi deterministic safety plane (zero LLM, zero network)."""
from medisaathi_contracts import Severity  # noqa: F401

CONFIRM_BELOW = 0.90
REFUSE_BELOW = 0.75

from .engine import SafetyEngine, SNAPSHOT  # noqa: E402,F401
