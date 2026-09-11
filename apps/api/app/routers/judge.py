"""Judge route: sealed demo cases + zero-network cached responses."""
from __future__ import annotations

import json
import os

from fastapi import APIRouter, HTTPException

CACHE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "data", "judge_cache.json")
SEAL_ORDER = ["RX-001", "RX-002", "RX-009", "RX-006"]  # clean, severe, contra, refusal

judge = APIRouter(prefix="/api/v1/judge")


def _manifest() -> dict:
    manifest_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "data",
        "cases_manifest.json")
    with open(manifest_path, encoding="utf-8") as f:
        return {m["sample_id"]: m for m in json.load(f)}


def _flag() -> bool:
    """Judge route gate (audit MS-08): default CLOSED.

    Demo laptops opt in explicitly with MEDISAATHI_JUDGE_OPEN=1 (the compose
    file sets it); any deployment that forgets gets 403, not exposure. The
    old default-open behavior leaked demo internals to the public.
    """
    return os.environ.get("MEDISAATHI_JUDGE_OPEN", "0") == "1"


@judge.get("/cases")
def cases() -> dict:
    if not _flag():
        raise HTTPException(status_code=403, detail="judge route closed")
    manifest = _manifest()
    return {
        "sealed": [
            {"sample_id": sid, "description": manifest[sid]["description"],
             "expect_verdict": manifest[sid]["expected_verdict"]}
            for sid in SEAL_ORDER if sid in manifest
        ],
        "script_seconds": 90,
        "cached_mode_recommended": True,
    }


@judge.get("/cases/{sample_id}/cached")
def cached_case(sample_id: str) -> dict:
    """Pre-baked full response - the zero-network demo tier."""
    if not _flag():
        raise HTTPException(status_code=403, detail="judge route closed")
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, encoding="utf-8") as f:
            cache = json.load(f)
        if sample_id in cache:
            return cache[sample_id]
    raise HTTPException(status_code=404, detail=f"no cached response for {sample_id}")
