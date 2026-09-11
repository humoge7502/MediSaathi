"""API v1 routes: pipeline, plan, price, ADR draft, formulary search, upload."""
from __future__ import annotations

import os

from fastapi import APIRouter, File, HTTPException, UploadFile
from medisaathi_contracts import (
    ConfirmItem,
    Envelope,
    ExtractionResult,
    FieldSource,
    PriceReport,
    PriceRow,
    PriceSummary,
    SpokenPlan,
    VerdictKind,
)
from pydantic import BaseModel, Field

from ..nlg import build_spoken_plan
from ..safety.engine import SafetyEngine
from ..store import create, get, put
from ..verdict import assemble, refusal_from_exception
from ..vision import RefusalCandidate, extract, extract_live

DATA_DIR = os.environ.get(
    "MEDISAATHI_DATA_DIR",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "data")))

router = APIRouter(prefix="/api/v1")
engine = SafetyEngine.load(DATA_DIR)


# ------------------------------------------------------------------ models
class ConfirmRequest(BaseModel):
    field_index: int
    brand_text: str = Field(min_length=1)
    accepted: bool = True


class AdrDraft(BaseModel):
    prescription_id: str | None = None
    medicine: str
    reaction: str
    severity: str = "moderate"
    onset_days: int = 1
    outcome: str = "recovering"


# Upload hardening: declared content-type AND magic bytes must both say "image".
# (Regression hardening: the endpoint used to trust the declared MIME alone, so
# a JSON or HTML body with image/jpeg content-type would reach the vision path.)
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
MAX_IMAGE_BYTES = 12 * 1024 * 1024
_READ_CHUNK_BYTES = 1024 * 1024
_HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"}


def _sniff_image_mime(b: bytes) -> str | None:
    """Magic-byte sniff for supported formats; reject generic ISO-BMFF files."""
    if b[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(b) >= 12 and b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "image/webp"
    if len(b) >= 16 and b[4:8] == b"ftyp":  # HEIF/HEIC ISO-BMFF family
        major = b[8:12]
        compatible = {b[i:i + 4] for i in range(16, len(b) - 3, 4)}
        if major in _HEIF_BRANDS or compatible & _HEIF_BRANDS:
            return "image/heic"
    return None


def _mime_matches(declared: str, detected: str | None) -> bool:
    """Require the client declaration and signature to describe the same type."""
    if detected is None:
        return False
    if declared == detected:
        return True
    return declared == "image/heif" and detected == "image/heic"


async def _read_image_limited(image: UploadFile) -> bytes:
    """Read at most the limit plus one sentinel without trusting Content-Length."""
    chunks: list[bytes] = []
    total = 0
    while total <= MAX_IMAGE_BYTES:
        remaining = MAX_IMAGE_BYTES + 1 - total
        chunk = await image.read(min(_READ_CHUNK_BYTES, remaining))
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="image exceeds 12 MB")
        chunks.append(chunk)
    return b"".join(chunks)


def _parse_context(context: str) -> dict[str, bool]:
    """Declared context -> vocabulary-validated dict. Unknown keys are dropped,
    never guessed about (safety plane law)."""
    return SafetyEngine.validate_context(
        {k.strip(): True for k in context.split(",") if k.strip()})


# ------------------------------------------------------------------ pipeline
@router.post("/prescriptions")
def start_prescription(sample_id: str, context: str = "") -> Envelope:
    """Start the pipeline for a sample (fixture) prescription.

    `context` is a comma-separated patient-context key list, e.g.
    "pregnancy,peptic_ulcer" - consumed ONLY by the deterministic rule engine
    and validated against the contracts vocabulary.
    """
    rx = create(sample_id)
    ctx = _parse_context(context)
    rx.context = ctx  # persisted: confirm resolutions must re-screen with it
    try:
        result: ExtractionResult = extract(sample_id)
    except RefusalCandidate as e:
        rx.verdict = refusal_from_exception(engine, str(e))
        put(rx)
        return Envelope(data=rx.model_dump(), meta={"verdict": "refused"})
    except FileNotFoundError as err:
        # Deliberately do NOT echo sample_id back: it is attacker-controlled
        # input, and reflecting it in responses is a (minor) disclosure smell.
        raise HTTPException(status_code=404, detail="unknown sample") from err

    report, items, _all_verified = engine.run(result.fields, ctx)
    confirms = [ConfirmItem(**i) for i in items]
    rx.extraction = result
    rx.safety = report
    rx.confirm_queue = confirms
    rx.verdict = assemble(engine, result, report, rx.confirm_queue)
    put(rx)
    return Envelope(data=rx.model_dump(), meta={
        "verdict": rx.verdict.kind.value,
        "latency_ms": result.latency_ms,
        "checks": report.checks,
    })


@router.post("/prescriptions/upload")
async def upload_prescription(image: UploadFile = File(...), context: str = "") -> Envelope:
    """Live camera path: multipart image -> live vision extraction.

    Key-gated (MEDISAATHI_VISION_KEY). Without the key this returns 503 with a
    precise reason instead of pretending - the offline demo uses sealed samples.
    """
    from ..vision import LIVE_KEY
    if not LIVE_KEY:
        raise HTTPException(status_code=503, detail=(
            "live extraction disabled: MEDISAATHI_VISION_KEY not set; "
            "use the sealed-sample demo path"))
    if image.content_type not in ALLOWED_MIME:
        raise HTTPException(
            status_code=415,
            detail=f"unsupported content type {image.content_type!r}; "
                   "expected an image (jpeg/png/webp/heic)")
    image_bytes = await _read_image_limited(image)
    if not image_bytes:
        raise HTTPException(status_code=422, detail="empty image")
    detected_mime = _sniff_image_mime(image_bytes)
    if not _mime_matches(image.content_type or "", detected_mime):
        raise HTTPException(
            status_code=422,
            detail="upload signature does not match its declared image type")
    rx = create("live")
    ctx = _parse_context(context)
    rx.context = ctx
    try:
        result = extract_live(image_bytes)
    except RefusalCandidate as e:
        rx.verdict = refusal_from_exception(engine, str(e))
        put(rx)
        return Envelope(data=rx.model_dump(), meta={"verdict": "refused"})
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    report, items, _ = engine.run(result.fields, ctx)
    rx.extraction = result
    rx.safety = report
    rx.confirm_queue = [ConfirmItem(**i) for i in items]
    rx.verdict = assemble(engine, result, report, rx.confirm_queue)
    put(rx)
    return Envelope(data=rx.model_dump(), meta={"verdict": rx.verdict.kind.value})


@router.get("/prescriptions/{prescription_id}")
def prescription_state(prescription_id: str) -> Envelope:
    rx = get(prescription_id)
    if rx is None:
        raise HTTPException(status_code=404, detail="unknown prescription")
    return Envelope(data=rx.model_dump(), meta={"verdict": (rx.verdict.kind.value if rx.verdict else "pending")})


@router.post("/prescriptions/{prescription_id}/confirm")
def confirm_field(prescription_id: str, body: ConfirmRequest) -> Envelope:
    rx = get(prescription_id)
    if rx is None:
        raise HTTPException(status_code=404, detail="unknown prescription")
    if rx.extraction is None or not (0 <= body.field_index < len(rx.extraction.fields)):
        raise HTTPException(status_code=422, detail="field_index out of range")
    if not body.accepted:
        raise HTTPException(status_code=422, detail="rejected fields go back to retake")

    fld = rx.extraction.fields[body.field_index]
    row = engine.normalize(body.brand_text)
    if row is None:
        raise HTTPException(status_code=422, detail="brand not in formulary map")
    fld.brand_text = row["brand"]
    fld.confidence = 1.0
    fld.source = FieldSource.user_confirmation
    rx.confirm_queue = [c for c in rx.confirm_queue if c.field_index != body.field_index]

    # Re-screen against the patient context the run STARTED with (regression:
    # this used to re-run with an empty context, silently dropping
    # contraindication screening after any human confirmation).
    report, items, _ = engine.run(rx.extraction.fields, rx.context or {})
    rx.safety = report
    rx.confirm_queue = [ConfirmItem(**i) for i in items]
    rx.verdict = assemble(engine, rx.extraction, report, rx.confirm_queue)
    put(rx)
    return Envelope(data=rx.model_dump(), meta={"verdict": rx.verdict.kind.value})


# ------------------------------------------------------------------ formulary
@router.get("/formulary/search")
def formulary_search(q: str, limit: int = 8) -> Envelope:
    """Prefix + substring search over the brand map - powers the confirm
    autocomplete. Read-only over the seed formulary; never invents brands."""
    q = q.strip().lower()
    if not q:
        return Envelope(data={"results": []})
    scored: list[tuple[int, str, dict]] = []
    for brand, row in engine.brands.items():
        if brand.startswith(q):
            scored.append((0, brand, row))
        elif q in brand:
            scored.append((1, brand, row))
        elif q in row["molecule"].lower():
            scored.append((2, brand, row))
    scored.sort(key=lambda t: (t[0], t[1]))
    results = [
        {"brand": r["brand"], "molecule": r["molecule"], "form": r["form"],
         "jas_price_inr": r["jas_price_inr"]}
        for _, _, r in scored[: max(1, min(limit, 25))]]
    return Envelope(data={"results": results}, meta={"count": len(results)})


# ------------------------------------------------------------------ plan
@router.get("/prescriptions/{prescription_id}/explanation")
def explanation(prescription_id: str, lang: str = "en") -> Envelope:
    rx = get(prescription_id)
    if rx is None:
        raise HTTPException(status_code=404, detail="unknown prescription")
    if rx.verdict and rx.verdict.kind in (VerdictKind.refused, VerdictKind.confirm_queue):
        raise HTTPException(status_code=409, detail="plan blocked until verdict is verified")
    if rx.safety is None or rx.extraction is None:
        raise HTTPException(status_code=409, detail="pipeline not finished")
    lang = lang if lang in ("en", "ta", "hi") else "en"
    plan: SpokenPlan = build_spoken_plan(lang, rx.safety.medications, rx.safety)
    plan.audio_url = None  # spoken client-side via Web Speech API from segments
    rx.spoken_plan = plan
    put(rx)
    return Envelope(data=plan.model_dump(), meta={"slots_verified": all(s.verified for s in plan.slots)})


# ------------------------------------------------------------------ price
@router.get("/prescriptions/{prescription_id}/price")
def price(prescription_id: str) -> Envelope:
    rx = get(prescription_id)
    if rx is None:
        raise HTTPException(status_code=404, detail="unknown prescription")
    if rx.safety is None:
        raise HTTPException(status_code=409, detail="pipeline not finished")
    # molecule-level lowest generic price across the formulary (Jan Aushadhi)
    best: dict[str, tuple[float, str]] = {}
    for row in rx.safety.medications:
        for mol in row.molecule.split("+"):
            mol = mol.strip().lower()
            for b in engine.brands.values():
                mols = [m.strip().lower() for m in b["molecule"].split("+")]
                if mol in mols and b.get("jas_price_inr"):
                    cur = best.get(mol)
                    if cur is None or b["jas_price_inr"] < cur[0]:
                        best[mol] = (b["jas_price_inr"], b["brand"])
    rows = []
    unit_total = generic_total = 0.0
    for m in rx.safety.medications:
        mol = m.molecule.split("+")[0].strip().lower()
        gen = best.get(mol)
        savings = None
        if gen and m.jas_price_inr is not None:
            savings = round(max(0.0, m.jas_price_inr - gen[0]), 2)
        rows.append(PriceRow(
            brand=m.brand, molecule=m.molecule, unit_price_inr=m.jas_price_inr,
            generic_available=gen is not None,
            generic_price_inr=gen[0] if gen else None,
            generic_brand=gen[1] if gen else None,
            savings_inr=savings,
            source="Jan Aushadhi; snapshot 2026-09").model_dump())
        if m.jas_price_inr is not None:
            unit_total += m.jas_price_inr
        if gen:
            generic_total += gen[0]
    report = PriceReport(
        rows=[PriceRow(**r) for r in rows],
        summary=PriceSummary(
            unit_total_inr=round(unit_total, 2),
            generic_total_inr=round(generic_total, 2),
            savings_total_inr=round(max(0.0, unit_total - generic_total), 2),
            snapshot="2026-09"))
    return Envelope(data=report.model_dump(), meta={"snapshot": "2026-09"})


# ------------------------------------------------------------------ ADR
@router.post("/adr-reports")
def adr_draft(body: AdrDraft) -> Envelope:
    """One-tap structured PvPI-format adverse-event draft (information layer)."""
    draft = {
        "report_type": "suspected adverse drug reaction",
        "patient_age_group": "not-collected (privacy)",
        "suspected_medicine": body.medicine,
        "reaction": body.reaction,
        "seriousness": body.severity,
        "onset_days_after_start": body.onset_days,
        "outcome": body.outcome,
        "channel": "PvPI (PvMICC) paper/online form draft - review before submission",
        "disclaimer": "Draft for your pharmacist or doctor to review and submit.",
    }
    return Envelope(data=draft, meta={"format": "pvpi-draft-v0"})
