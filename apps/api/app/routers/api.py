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

from .. import consent, queue
from ..fhir import ExportBlockedError, to_fhir_bundle
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


class QueueResolveRequest(BaseModel):
    field_index: int
    accepted: bool = True
    brand_text: str | None = None
    actor: str = "pharmacist"
    note: str = ""


class AdrDraft(BaseModel):
    prescription_id: str | None = None
    medicine: str
    reaction: str
    severity: str = "moderate"
    onset_days: int = 1
    outcome: str = "recovering"


class ConsentRequest(BaseModel):
    """ABDM-vocabulary consent request (MED-025). Pseudonymous by construction."""

    patient_ref: str = Field(min_length=1, description="pseudonymous reference, never PII")
    purpose: str = Field(description="ABDM purpose code, e.g. CAREMGT")
    hi_types: list[str] = Field(default_factory=lambda: ["Prescription"])
    ttl_days: int = Field(default=30, gt=0, le=365)
    signature_ref: str = ""


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


def _record_gate(rx, report) -> None:
    """Persist the gate-law provenance (threshold-set id + fused score)."""
    if report.gate is not None:
        rx.threshold_set_id = report.gate.threshold_set_id
        rx.prescription_fused = report.gate.prescription_fused


def _rescreen_and_assemble(rx) -> None:
    """Re-run the deterministic plane against the run's ORIGINAL context and
    re-assemble the verdict, then reconcile the persisted confirm queue.

    Every human resolution (or rejection) must re-screen: a confirmation that
    unlocks a molecule the earlier read hid can *create* a contraindication.
    """
    if rx.extraction is None:
        return
    report, items, _ = engine.run(rx.extraction.fields, rx.context or {})
    rx.safety = report
    rx.confirm_queue = [ConfirmItem(**i) for i in items]
    rx.verdict = assemble(engine, rx.extraction, report, rx.confirm_queue)
    _record_gate(rx, report)
    queue.sync(rx.prescription_id, [c.model_dump() for c in rx.confirm_queue])


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
    _record_gate(rx, report)
    queue.sync(rx.prescription_id, [c.model_dump() for c in confirms])
    put(rx)
    return Envelope(data=rx.model_dump(), meta={
        "verdict": rx.verdict.kind.value,
        "latency_ms": result.latency_ms,
        "checks": report.checks,
        "threshold_set_id": rx.threshold_set_id,
        "prescription_fused": rx.prescription_fused,
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
    _record_gate(rx, report)
    queue.sync(rx.prescription_id, [c.model_dump() for c in rx.confirm_queue])
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

    # The human decision IS the queue transition (first transition wins).
    queue.resolve(rx.prescription_id, body.field_index, accepted=True,
                  resolved_brand=row["brand"], actor="user_confirmation",
                  note="field confirmed against the formulary")
    # Re-screen against the patient context the run STARTED with (regression:
    # this used to re-run with an empty context, silently dropping
    # contraindication screening after any human confirmation).
    _rescreen_and_assemble(rx)
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


# ------------------------------------------------------------------ confirm queue
@router.get("/prescriptions/{prescription_id}/queue")
def queue_state(prescription_id: str) -> Envelope:
    """List the persisted confirmation queue + the plan-block state (MED-011)."""
    if get(prescription_id) is None:
        raise HTTPException(status_code=404, detail="unknown prescription")
    state = queue.status(prescription_id)
    return Envelope(data=state, meta={"blocked": state["blocked"]})


@router.get("/prescriptions/{prescription_id}/queue/history")
def queue_history(prescription_id: str) -> Envelope:
    """Append-only transition audit for the confirm queue (MED-011)."""
    if get(prescription_id) is None:
        raise HTTPException(status_code=404, detail="unknown prescription")
    rows = queue.history(prescription_id)
    return Envelope(data={"transitions": [r.model_dump() for r in rows]},
                    meta={"count": len(rows)})


@router.post("/prescriptions/{prescription_id}/queue/resolve")
def queue_resolve(prescription_id: str, body: QueueResolveRequest) -> Envelope:
    """Resolve one queued field. First transition wins; replays are refused."""
    rx = get(prescription_id)
    if rx is None:
        raise HTTPException(status_code=404, detail="unknown prescription")
    # First transition wins: a replay against a terminal row is a protocol
    # outcome, never an error and never a second mutation. Checked before any
    # brand validation so a replay never depends on payload shape.
    existing = next((i for i in queue.list_items(prescription_id)
                     if i.field_index == body.field_index), None)
    if existing is None:
        raise HTTPException(status_code=404, detail="no queue row for that field index")
    if existing.state.value != "pending":
        return Envelope(data={
            "status": "already_resolved",
            "item": existing.model_dump(),
            "queue": queue.status(prescription_id),
            "verdict": rx.verdict.kind.value if rx.verdict else "pending",
        }, meta={"replayed": True})

    resolved_brand: str | None = None
    if body.accepted:
        # A human read may correct the brand (the whole point of the queue), or
        # simply accept the machine's read. Either way the result must resolve
        # against the formulary: an invented brand is never confirmed.
        fld_candidate = ""
        if rx.extraction is not None and 0 <= body.field_index < len(rx.extraction.fields):
            f = rx.extraction.fields[body.field_index]
            fld_candidate = f.brand_text or f.raw_text
        row = engine.normalize(body.brand_text or fld_candidate)
        if row is None:
            raise HTTPException(
                status_code=422,
                detail="brand not in formulary map; supply the corrected brand name")
        resolved_brand = row["brand"]
    try:
        item, replayed = queue.resolve(
            prescription_id, body.field_index, body.accepted,
            resolved_brand=resolved_brand, actor=body.actor, note=body.note)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if not replayed and rx.extraction is not None \
            and 0 <= body.field_index < len(rx.extraction.fields):
        fld = rx.extraction.fields[body.field_index]
        if body.accepted:
            fld.brand_text = resolved_brand or fld.brand_text
            fld.confidence = 1.0  # a human read is the highest confidence there is
            fld.source = FieldSource.user_confirmation
        else:
            # A rejected field cannot be verified -> the read is withdrawn, the
            # band collapses to refusal, and the plan stays blocked.
            fld.confidence = 0.0
        _rescreen_and_assemble(rx)
        put(rx)

    return Envelope(data={
        "status": "already_resolved" if replayed else "resolved",
        "item": item.model_dump(),
        "queue": queue.status(prescription_id),
        "verdict": rx.verdict.kind.value if rx.verdict else "pending",
    }, meta={"replayed": replayed})


# ------------------------------------------------------------------ plan
@router.get("/prescriptions/{prescription_id}/explanation")
def explanation(prescription_id: str, lang: str = "en") -> Envelope:
    rx = get(prescription_id)
    if rx is None:
        raise HTTPException(status_code=404, detail="unknown prescription")
    # Plan blocking is evaluated against PERSISTED queue state, not against the
    # in-memory verdict only (MED-002): the block survives a restart and cannot
    # be bypassed by a stale verdict object.
    reason = queue.blocked_reason(prescription_id)
    if reason:
        raise HTTPException(status_code=409, detail=reason)
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
@router.get("/prescriptions/{prescription_id}/fhir")
def export_fhir(prescription_id: str) -> Envelope:
    """Export a VERIFIED prescription as a FHIR R4 collection Bundle (MED-028).

    Export-only mapping: there is no live FHIR/ABDM gateway. A prescription whose
    confirm queue is non-empty, or whose verdict is a refusal, exports nothing
    (409) — an unverified read must never be laundered into a clinical record.
    """
    rx = get(prescription_id)
    if rx is None:
        raise HTTPException(status_code=404, detail="unknown prescription_id")
    try:
        bundle = to_fhir_bundle(rx)
    except ExportBlockedError as exc:
        raise HTTPException(status_code=409, detail=exc.reason) from exc
    return Envelope(data={"bundle": bundle, "note": "export-only mapping; not a live FHIR integration"})


@router.post("/consent")
def grant_consent(req: ConsentRequest) -> Envelope:
    """Create a consent artefact (ABDM vocabulary). Stub, not a live gateway.

    No patient identifiers are accepted; the artefact references a pseudonymous
    `patient_ref` only, and expires (fail-closed on expiry and revocation).
    """
    try:
        artefact = consent.grant(
            patient_ref=req.patient_ref, purpose=req.purpose,
            hi_types=req.hi_types, ttl_days=req.ttl_days,
            signature_ref=req.signature_ref)
    except consent.ConsentError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Envelope(data=artefact)


@router.get("/consent/{consent_id}")
def get_consent(consent_id: str) -> Envelope:
    artefact = consent.get(consent_id)
    if artefact is None:
        raise HTTPException(status_code=404, detail="unknown consent_id")
    return Envelope(data=artefact)


@router.post("/consent/{consent_id}/revoke")
def revoke_consent(consent_id: str) -> Envelope:
    artefact = consent.revoke(consent_id)
    if artefact is None:
        raise HTTPException(status_code=404, detail="unknown consent_id")
    return Envelope(data=artefact)


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
