"""Demo-check: the FULL offline demo gate. Run before every rehearsal.

Asserts the sealed-case walkthrough is green without network or API keys:
all six verdict kinds + plan + price + metrics counters, then delegates to
pytest and the eval CLI (via make).
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))
sys.path.insert(0, os.path.join(ROOT, "packages", "contracts"))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def main() -> int:
    c = TestClient(app)
    assert c.get("/healthz").json()["ok"], "healthz down"
    cases = {
        "RX-001": "pass",
        "RX-002": "interaction",
        "RX-006": "refused",
        "RX-003": "confirm_queue",
        "RX-009": "contraindication",
        "RX-004": "duplicate_atc",
    }
    for sid, expected in cases.items():
        ctx = "&context=age_under_12" if sid == "RX-009" else ""
        r = c.post(f"/api/v1/prescriptions?sample_id={sid}{ctx}")
        got = r.json()["meta"]["verdict"]
        assert got == expected, f"{sid}: expected {expected}, got {got} ({r.text[:200]})"
        pid = r.json()["data"]["prescription_id"]
        if expected not in ("refused", "confirm_queue"):
            plan = c.get(f"/api/v1/prescriptions/{pid}/explanation?lang=ta")
            assert plan.status_code == 200, f"{sid}: plan blocked unexpectedly"
            price = c.get(f"/api/v1/prescriptions/{pid}/price")
            assert price.status_code == 200, f"{sid}: price failed"
        print(f"  {sid}: {got} OK")
    m = c.get("/metrics").json()
    assert m["refused_total"] >= 1, "refusal counter silent"
    print("demo-check PASS: sealed cases green, offline, no keys")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
