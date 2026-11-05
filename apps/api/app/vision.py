"""Perception plane: fixture-first, live-optional vision extraction.

LAW OF THE PIPELINE: this module returns per-field confidence and nothing
else enters the safety plane. If MEDISAATHI_VISION_KEY is set, a real
vision-LLM call is attempted; otherwise the sealed fixture corpus answers,
which is also the offline demo path (three-tier fallback, tiers 2-3).

Live provider contract (implemented, key-gated):
  * POSTs the image + a JSON schema to an OpenAI-compatible /chat/completions
    endpoint (works with OpenAI, Gemini OpenAI-compat, Groq, OpenRouter, vLLM,
    Ollama, ...). temperature 0, schema-constrained, one retry on schema
    failure, then a graceful fallback to the fixture tier.
  * A model answer saying "no prescription detected" raises RefusalCandidate -
    the refusal decision is the model's *sensor report*, the refusal verdict
    itself is still assembled deterministically by the verdict plane.
"""
from __future__ import annotations

import base64
import json
import os
import re
import time

import httpx
from medisaathi_contracts import (
    ExtractionField,
    ExtractionResult,
    FieldSource,
    LiveExtraction,
)

FIXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "fixtures")
LIVE_KEY = os.environ.get("MEDISAATHI_VISION_KEY", "")


def model_egress_disabled() -> bool:
    """Privacy kill switch (docs Ch.12 / roadmap W1): MEDISAATHI_DISABLE_MODEL_EGRESS=1
    hard-disables every outbound model call so a sensitive deployment can run
    the deterministic plane with zero third-party transmission — the degraded
    tier already proves the product works without egress."""
    return os.environ.get("MEDISAATHI_DISABLE_MODEL_EGRESS", "0") == "1"
LIVE_MODEL = os.environ.get("MEDISAATHI_VISION_MODEL", "gemini-2.0-flash")
LIVE_BASE_URL = os.environ.get(
    "MEDISAATHI_VISION_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai"
).rstrip("/")
LIVE_TIMEOUT_S = float(os.environ.get("MEDISAATHI_VISION_TIMEOUT_S", "30"))
# Retry policy (reliability audit): 1 retry by default (2 attempts total).
# Backoff doubles per attempt, capped so worst-case added latency stays bounded.
LIVE_MAX_ATTEMPTS = int(os.environ.get("MEDISAATHI_VISION_MAX_ATTEMPTS", "2"))
LIVE_BACKOFF_CAP_S = float(os.environ.get("MEDISAATHI_VISION_BACKOFF_CAP_S", "2"))


class RefusalCandidate(Exception):
    """Raised when the image cannot possibly contain a prescription."""


# Fixture ids are opaque tokens ("RX-001"), never paths. This was a confirmed
# traversal finding: sample_id=../../../../../apps/web/tsconfig escaped the
# fixture dir and read arbitrary .json files. Two independent gates:
#   1. character allow-list (no separators, no "..", bounded length)
#   2. realpath containment (even if a future caller forgets gate 1)
_FIXTURE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def _safe_fixture_path(sample_id: str) -> str:
    """Resolve a fixture id to a path that is provably inside FIXTURE_DIR."""
    if not _FIXTURE_ID_RE.fullmatch(sample_id or ""):
        raise FileNotFoundError(f"unknown fixture {sample_id!r}")
    path = os.path.abspath(os.path.join(FIXTURE_DIR, f"{sample_id}.json"))
    if os.path.commonpath([path, FIXTURE_DIR]) != FIXTURE_DIR:
        raise FileNotFoundError(f"unknown fixture {sample_id!r}")
    return path


# Observability: count schema-contract failures of the live vision call.
# Safe metadata only - no image bytes, no extracted health content (privacy law).
_schema_failures = 0


def schema_fail_count() -> int:
    return _schema_failures


def _record_schema_failure() -> None:
    global _schema_failures
    _schema_failures += 1


def load_fixture(sample_id: str) -> dict:
    path = _safe_fixture_path(sample_id)
    if not os.path.exists(path):
        raise FileNotFoundError(f"unknown fixture {sample_id}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ------------------------------------------------------------------ parsing
# The seed corpus ships pre-segmented lines like
#   "1. Tab Dolo 650 - 1-0-1 x 5 days - after food"
# These light regexes exist so fixtures behave like real OCR output. The LIVE
# path replaces this parser with the schema-constrained model answer.

_LIST_NO = re.compile(r"^\d+\.\s*")                      # strip "1. "
_DURATION = re.compile(r"\bx\s*(\d+\s*(?:days?|weeks?|months?))", re.I)
_DURATION_WORD = re.compile(r"\b(\d+\s*(?:days?|weeks?|months?))\b", re.I)
_DOSE = re.compile(r"\b(\d+(?:\.\d+)?\s*(?:mg|g|ml|mcg|iu|units?))\b", re.I)

# Frequency parsing lives in ONE place: app.safety.dosing (audit code review:
# this file used to carry an identical copy — deduped, re-exported for the
# tests' public surface). The copy was not only duplicated, it was smaller: six
# word codes, and a TAC match that kept "0-0-1" and dropped the "weekly" written
# after it, so the eval path scheduled a weekly course daily.
from .safety.dosing import (  # noqa: E402, F401
    brand_strength,
    extract_line_frequency,
    parse_frequency_per_day,
)


def _strength_from(brand_text: str, dose: str) -> str:
    """The strength the line itself states, or "" when it states none.

    The brand-embedded number is NOT given a unit here. Stamping " mg" onto
    every trailing digit turned "Thyronorm 50" into a 50 mg levothyroxine
    course — a thousandfold over-read of a 50 mcg tablet, against a 0.3 mg/day
    cap — and read "Calcirol 60K" as "60 mg", dropping the kilo multiplier and
    the IU unit the preparation is actually sold in. A bare number's unit comes
    from the molecule, which perception does not know yet: `enrich_field`
    resolves it against the formulary row in the deciding plane, where the
    catalog lookup has happened.
    """
    if dose:
        return dose
    bs = brand_strength(brand_text)
    if bs is None:
        return ""
    value, unit = bs
    return f"{value:g} {unit}" if unit else ""


def _parse_line(text: str, conf: float, source: FieldSource) -> ExtractionField:
    """Regex-light line parser for seed fixtures (real parsing lives in the
    live vision path's JSON schema; fixtures ship pre-segmented lines)."""
    cleaned = _LIST_NO.sub("", text.strip())
    brand_text = cleaned.split(" - ")[0].strip()

    freq = extract_line_frequency(cleaned)

    duration = ""
    m = _DURATION.search(cleaned) or _DURATION_WORD.search(cleaned)
    if m:
        duration = re.sub(r"\s+", " ", m.group(1)).lower()

    dose = ""
    m = _DOSE.search(cleaned)
    if m:
        dose = m.group(1).lower().rstrip()

    strength = _strength_from(brand_text, dose)
    return ExtractionField(
        raw_text=text, brand_text=brand_text, strength=strength, dose=dose,
        frequency=freq, duration=duration, confidence=conf, source=source,
    )


def extract(sample_id: str) -> ExtractionResult:
    """Extract fields for a sample. Fixture path is deterministic and offline."""
    t0 = time.perf_counter()
    page = load_fixture(sample_id)
    if page.get("blank") or page.get("non_rx"):
        raise RefusalCandidate(
            "no prescription content detected in the image "
            "(blank scan or non-prescription document)")
    fields = [
        _parse_line(line["text"], float(line["conf"]), FieldSource.seed_fixture)
        for line in page.get("lines", [])
    ]
    latency = int((time.perf_counter() - t0) * 1000)
    return ExtractionResult(sample_id=sample_id, fields=fields,
                            engine="fixture-v0", latency_ms=latency)


# ------------------------------------------------------------------ live path

LIVE_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "medisaathi_extraction",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "prescription_detected": {"type": "boolean"},
                "refusal_reason": {
                    "type": ["string", "null"],
                    "enum": [None, "no_prescription_content", "unreadable_image"],
                },
                "lines": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "raw_text": {"type": "string"},
                            "brand_text": {"type": "string"},
                            "strength": {"type": "string"},
                            "dose": {"type": "string"},
                            "frequency": {"type": "string"},
                            "duration": {"type": "string"},
                            "confidence": {"type": "number"},
                        },
                        "required": ["raw_text", "brand_text", "strength", "dose",
                                     "frequency", "duration", "confidence"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["prescription_detected", "refusal_reason", "lines"],
            "additionalProperties": False,
        },
    },
}

SYSTEM_PROMPT = (
    "You are the perception sensor of a medication-verification system. "
    "Transcribe ONLY what is legible in the image. For every medicine line "
    "return the brand text, embedded strength, dose, TAC frequency "
    "(morning-noon-night, e.g. 1-0-1) or shorthand (OD/BD/TDS), and duration. "
    "Set confidence honestly per line: below 0.55 if barely legible. If the "
    "image is not a prescription or is unreadable, set prescription_detected "
    "to false and give the refusal_reason. NEVER invent a medicine name you "
    "cannot actually read."
)


def _image_data_url(image_bytes: bytes) -> str:
    b64 = base64.b64encode(image_bytes).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def _live_call(image_bytes: bytes, *, model: str, base_url: str, api_key: str) -> LiveExtraction:
    """One schema-constrained call to an OpenAI-compatible endpoint."""
    payload = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": [
                {"type": "text", "text": "Extract the prescription lines."},
                {"type": "image_url", "image_url": {"url": _image_data_url(image_bytes)}},
            ]},
        ],
        "response_format": LIVE_SCHEMA,
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    last_error: Exception | None = None
    for attempt in range(LIVE_MAX_ATTEMPTS):  # one retry on schema failure, per plan
        if attempt:
            # Exponential backoff with jitter cap: 0.5s, 1s, 2s... — bounded by
            # the caller's timeout budget. Pure time.sleep: no extra dependency.
            time.sleep(min(0.5 * 2 ** (attempt - 1), LIVE_BACKOFF_CAP_S))
        try:
            with httpx.Client(timeout=LIVE_TIMEOUT_S) as client:
                resp = client.post(f"{base_url}/chat/completions",
                                   json=payload, headers=headers)
                resp.raise_for_status()
                body = resp.json()
            content = body["choices"][0]["message"]["content"]
            return LiveExtraction.model_validate_json(content)
        except (httpx.HTTPError, KeyError, ValueError) as e:  # schema fail / net fail
            _record_schema_failure()
            last_error = e
            continue
    raise RuntimeError(f"live vision failed after retry: {last_error}")


def extract_live(image_bytes: bytes) -> ExtractionResult:
    """Live vision-LLM path. Key-gated; NOT used in the offline demo.
    Below-threshold fields NEVER bypass the confirm queue - the confidence
    numbers flow straight into the same gate as fixture fields."""
    if model_egress_disabled():
        raise RuntimeError("model egress disabled by MEDISAATHI_DISABLE_MODEL_EGRESS")
    if not LIVE_KEY:
        raise RuntimeError("live vision requires MEDISAATHI_VISION_KEY")
    t0 = time.perf_counter()
    answer = _live_call(image_bytes, model=LIVE_MODEL,
                        base_url=LIVE_BASE_URL, api_key=LIVE_KEY)
    if not answer.prescription_detected:
        raise RefusalCandidate(
            answer.refusal_reason or "no_prescription_content"
        )
    fields = [
        ExtractionField(
            raw_text=ln.raw_text, brand_text=ln.brand_text, strength=ln.strength,
            dose=ln.dose, frequency=ln.frequency, duration=ln.duration,
            confidence=ln.confidence, source=FieldSource.vision,
        )
        for ln in answer.lines
    ]
    latency = int((time.perf_counter() - t0) * 1000)
    return ExtractionResult(sample_id="live", fields=fields,
                            engine=f"live:{LIVE_MODEL}", latency_ms=latency)
