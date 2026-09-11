"""Run manifests: every experiment run is archived with its full provenance.

    eval/runs/<timestamp>-<name>/
        manifest.json   config, dataset SHAs, git SHA, environment, seeds
        metrics.json    the numbers (machine-readable)
        cases.jsonl     per-case outcomes (optional, for error analysis)

No number is quoted in the docs without one of these directories behind it
(reproducibility law). Writing is local-only; nothing is uploaded.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone

from . import manifest as ds_manifest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RUNS_DIR = os.path.join(ROOT, "eval", "runs")


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def new_run_dir(name: str, *, runs_dir: str = RUNS_DIR, suffix: str | None = None) -> str:
    run_id = f"{_stamp()}-{name}"
    if suffix:
        run_id = f"{run_id}-{suffix}"
    path = os.path.join(runs_dir, run_id)
    os.makedirs(path, exist_ok=True)
    return path


def write_run(name: str, config: dict, metrics: dict, *,
              cases: list[dict] | None = None,
              runs_dir: str = RUNS_DIR, run_id: str | None = None) -> str:
    """Archive one run. Returns the run directory (also usable as a run tag)."""
    path = (os.path.join(runs_dir, run_id) if run_id else new_run_dir(
        name, runs_dir=runs_dir, suffix=uuid.uuid4().hex[:6]))
    os.makedirs(path, exist_ok=True)

    manifest = {
        "run_id": os.path.basename(path),
        "experiment": name,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataset": {
            "snapshot_id": ds_manifest.snapshot_id(),
            "files": {
                rel: meta.get("sha256")
                for rel, meta in ds_manifest.load_manifest().get("files", {}).items()
            } if os.path.exists(ds_manifest.MANIFEST_PATH) else {},
        },
        "engine_git_sha": ds_manifest.git_sha(),
        "environment": ds_manifest.environment(),
        "config": config,
    }
    with open(os.path.join(path, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, sort_keys=True)
        f.write("\n")
    with open(os.path.join(path, "metrics.json"), "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2, sort_keys=True)
        f.write("\n")
    if cases:
        with open(os.path.join(path, "cases.jsonl"), "w", encoding="utf-8") as f:
            for row in cases:
                f.write(json.dumps(row, sort_keys=True) + "\n")
    return path


def latest_run(name: str | None = None, *, runs_dir: str = RUNS_DIR) -> str | None:
    """Most recent archived run (optionally filtered by experiment name)."""
    if not os.path.isdir(runs_dir):
        return None
    candidates = sorted(
        d for d in os.listdir(runs_dir)
        if os.path.isdir(os.path.join(runs_dir, d)) and (name is None or name in d))
    return os.path.join(runs_dir, candidates[-1]) if candidates else None


def load_metrics(run_dir: str) -> dict:
    with open(os.path.join(run_dir, "metrics.json"), encoding="utf-8") as f:
        return json.load(f)
