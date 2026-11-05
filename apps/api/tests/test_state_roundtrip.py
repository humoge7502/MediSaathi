"""The persisted-state round trip is the contract's only enforcement point.

`store.put()` writes `rx.model_dump_json()` and `store.get()` re-validates it,
so a value that violates a contract type is accepted by every in-process step
and only explodes when the prescription is read back — in a route, after the
pipeline finished, as a 500. That is exactly how RX-004 died in the demo gate:
`dosing.enrich_field()` rebuilds the field with `model_copy(update=...)`, which
skips validation, and a brand whose core carries no number ("Crocin Advance")
made it write `None` into two fields the contracts declare as `str`.

Nothing in the suite covered this because the only thing that read a persisted
prescription back was `tools/demo_check.py`. So this file (a) runs every sealed
fixture through the real route handler and re-reads it from the store — general,
so any future type violation in any field of any state shape fails here — (b)
keeps the HTTP route covered for the case that actually broke, and (c) pins the
enrichment rule the fix rests on.
"""
from __future__ import annotations

import glob
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.main import app
from app.routers.api import start_prescription
from app.safety.dosing import brand_label_strength, enrich_field
from app.store import get
from fastapi.testclient import TestClient
from medisaathi_contracts import ExtractionField, FieldSource

FIXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "..", "app", "data", "fixtures")
SAMPLE_IDS = sorted(os.path.basename(p)[:-len(".json")]
                    for p in glob.glob(os.path.join(FIXTURE_DIR, "*.json")))


def test_fixture_corpus_is_not_silently_shrinking():
    assert len(SAMPLE_IDS) >= 100, f"only {len(SAMPLE_IDS)} sealed fixtures found"


def test_every_sealed_fixture_survives_a_persisted_re_read():
    """Handler-level, not client-level: the middleware adds ~60 ms per call and
    the limiter would refuse the 60th sample — neither is what this asserts."""
    broken: list[str] = []
    for sid in SAMPLE_IDS:
        env = start_prescription(sample_id=sid)
        pid = env.data["prescription_id"]
        try:
            assert get(pid) is not None, "row missing after put"
        except Exception as err:
            broken.append(f"{sid}: {type(err).__name__}: {err}")
    assert not broken, "persisted state that will not re-read:\n" + "\n".join(broken)


def test_the_demo_case_explanation_route_answers_in_tamil():
    """The exact call that returned 500 (`GET /explanation?lang=ta` on RX-004)."""
    client = TestClient(app)
    r = client.post("/api/v1/prescriptions", params={"sample_id": "RX-004"})
    pid = r.json()["data"]["prescription_id"]
    plan = client.get(f"/api/v1/prescriptions/{pid}/explanation", params={"lang": "ta"})
    assert plan.status_code == 200, plan.text


def test_a_brand_core_with_no_number_leaves_the_strength_empty_not_null():
    """The regression itself: absence of evidence must stay an empty string."""
    field = ExtractionField(
        raw_text="2. Tab Crocin Advance - 1-0-1 x 3 days",
        brand_text="Tab Crocin Advance", strength="", dose="",
        frequency="1-0-1", duration="3 days", confidence=0.97,
        source=FieldSource.seed_fixture,
    )
    assert brand_label_strength("Crocin Advance", "paracetamol") is None
    out = enrich_field(field, brand="Crocin Advance", molecule="paracetamol")
    assert (out.strength, out.dose) == ("", "")
    assert isinstance(out.strength, str) and isinstance(out.dose, str)
    # The whole point: the field must survive the store's re-validation.
    ExtractionField.model_validate_json(out.model_dump_json())


def test_a_brand_core_with_a_number_still_supplies_the_strength():
    """The fallback this must NOT break: "Cap. Folitrax 10 HS" is a 10 mg course."""
    field = ExtractionField(
        raw_text="1. Cap. Folitrax 10 HS", brand_text="Cap. Folitrax 10",
        strength="", dose="", frequency="", duration="", confidence=0.97,
        source=FieldSource.seed_fixture,
    )
    out = enrich_field(field, brand="Folitrax 10", molecule="methotrexate")
    assert out.strength == "10 mg" and out.dose == "10 mg"
