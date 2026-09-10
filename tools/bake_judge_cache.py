"""Bake the judge cache: run the sealed demo cases through the REAL pipeline
once, and persist the full envelopes as the zero-network demo tier.

The cache hides nothing: it is byte-for-byte what the live pipeline answered
when it was baked, stamped with a bake time and build tag. Re-run after any
change to the pipeline or seed data (make bake-judge).

Usage (repo root):  python tools/bake_judge_cache.py
"""
from __future__ import annotations

import json
import os
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))
sys.path.insert(0, os.path.join(ROOT, "packages", "contracts"))

from app.main import app  # noqa: E402
from app.routers.judge import SEAL_ORDER  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

CACHE_PATH = os.path.join(ROOT, "apps", "api", "app", "data", "judge_cache.json")


def main() -> int:
    c = TestClient(app)
    cache: dict = {}
    for sid in SEAL_ORDER:
        ctx = "&context=age_under_12" if sid == "RX-009" else ""
        r = c.post(f"/api/v1/prescriptions?sample_id={sid}{ctx}")
        assert r.status_code == 200, r.text
        body = r.json()
        pid = body["data"]["prescription_id"]
        plan = c.get(f"/api/v1/prescriptions/{pid}/explanation?lang=ta").json()
        price = c.get(f"/api/v1/prescriptions/{pid}/price").json()
        cache[sid] = {
            "state": body,
            "plan": plan,
            "price": price,
            "baked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "build_tag": os.environ.get("MEDISAATHI_BUILD_TAG", "dev"),
        }
        print(f"  baked {sid}: verdict={body['meta']['verdict']}")
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)
    print(f"judge cache baked -> {CACHE_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
