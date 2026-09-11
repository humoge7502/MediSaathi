"""Dataset manifests, sha256 pinning and run provenance (MED-004 / MED-017).

Two layers of provenance:

* **Dataset manifest** (`data/manifest.json`): sha256 of every knowledge and
  corpus file that a verdict depends on. The loader verifies hashes and CI
  fails on mismatch, so "the numbers came from this data" is checkable rather
  than asserted.
* **Run manifest** (`eval/runs/<id>/manifest.json`): config JSON + dataset
  SHAs + engine git SHA + metrics for one experiment execution. Every reported
  number cites one of these.

No third-party dependencies; sha256 + json only.
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MANIFEST_PATH = os.path.join(ROOT, "data", "manifest.json")

#: Files whose bytes determine experimental results. Corpus files are included
#: dynamically (see `dataset_files`).
TRACKED_DATA_FILES = (
    "data/brands.csv",
    "data/interactions.csv",
    "data/contraindications.csv",
    "data/sources.json",
    "data/cases_manifest.json",
    "data/eval_labels.csv",
)

CHUNK = 1 << 20


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()


def dataset_files() -> list[str]:
    """Every tracked data file that exists, relative to the repo root."""
    out: list[str] = []
    for rel in TRACKED_DATA_FILES:
        if os.path.exists(os.path.join(ROOT, rel)):
            out.append(rel)
    corpus_dir = os.path.join(ROOT, "data", "corpus")
    if os.path.isdir(corpus_dir):
        for name in sorted(os.listdir(corpus_dir)):
            if name.endswith(".json") or name.endswith(".jsonl") or name.endswith(".csv"):
                out.append(f"data/corpus/{name}")
    return out


def build_manifest(extra: dict | None = None) -> dict:
    files = {
        rel: {"sha256": sha256_file(os.path.join(ROOT, rel)),
              "bytes": os.path.getsize(os.path.join(ROOT, rel))}
        for rel in dataset_files()
    }
    combined = hashlib.sha256(
        "".join(f"{k}:{v['sha256']}" for k, v in sorted(files.items())).encode()
    ).hexdigest()[:16]
    return {
        "manifest_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "snapshot_id": combined,
        "files": files,
        **(extra or {}),
    }


def write_manifest(path: str = MANIFEST_PATH, extra: dict | None = None) -> dict:
    manifest = build_manifest(extra)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, sort_keys=True)
        f.write("\n")
    return manifest


def load_manifest(path: str = MANIFEST_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def verify_manifest(path: str = MANIFEST_PATH) -> tuple[bool, list[str]]:
    """Return (ok, problems). Missing manifest is a problem (fail-closed)."""
    if not os.path.exists(path):
        return False, [f"manifest missing: {os.path.relpath(path, ROOT)}"]
    recorded = load_manifest(path)
    problems: list[str] = []
    for rel, meta in recorded.get("files", {}).items():
        abs_path = os.path.join(ROOT, rel)
        if not os.path.exists(abs_path):
            problems.append(f"missing file: {rel}")
            continue
        actual = sha256_file(abs_path)
        if actual != meta.get("sha256"):
            problems.append(
                f"hash mismatch: {rel} (recorded {meta.get('sha256')[:12]}, now {actual[:12]})")
    known = set(recorded.get("files", {}))
    for rel in dataset_files():
        if rel not in known:
            problems.append(f"untracked data file: {rel} (run tools/build_corpus.py)")
    return (not problems), problems


def git_sha(short: bool = True) -> str:
    """Current engine commit, short by default. Falls back to 'unknown'.

    NOTE: the `--short` flag and the rev must BOTH be present; passing only
    `--short` makes `git rev-parse` print usage and yield an empty string, which
    silently poisoned every run manifest with `engine_git_sha: "unknown"`.
    """
    args = ["git", "rev-parse", "--short", "HEAD"] if short else ["git", "rev-parse", "HEAD"]
    try:
        out = subprocess.run(
            args, cwd=ROOT, capture_output=True, text=True, timeout=5, check=False)
        return out.stdout.strip() or "unknown"
    except Exception:  # pragma: no cover - only in odd environments
        return "unknown"


def environment() -> dict:
    return {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "machine": platform.machine(),
    }


def snapshot_id(path: str = MANIFEST_PATH) -> str:
    try:
        return load_manifest(path).get("snapshot_id", "unrecorded")
    except FileNotFoundError:
        return "unrecorded"
