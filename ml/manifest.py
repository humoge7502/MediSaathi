"""Dataset manifests, sha256 pinning and run provenance (MED-004 / MED-017).

Two layers of provenance:

* **Dataset manifest** (`data/manifest.json`): sha256 of every knowledge and
  corpus file that a verdict depends on. A run cites the hashes of the bytes it
  read (`current_files()`), and `make data-check` fails when the recorded
  manifest and the disk diverge — so "the numbers came from this data" is
  checkable rather than asserted. Before the 2026-10-26 identity-repair pass
  neither half was true: runs cited the recorded map, the recorded map was only
  rewritten by the corpus builders, and `verify_manifest()` sat behind a flag no
  gate ran, so seven tracked files went stale without a single number failing.
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


def manifest_path() -> str:
    """The manifest location, resolved when it is used rather than at import.

    Every function below defaulted to a path bound at import time, so redirecting
    `ROOT` at call time (a test, or a tool checking a candidate tree) still wrote
    through to the live repo. The default is now late-bound and overridable.
    """
    return os.path.join(ROOT, "data", "manifest.json")

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
    # The reference tier is the table of record behind specific verdicts:
    # `dose_caps.csv` is read at import by `app/safety/dosing.py`, and
    # `qt_prolonging.csv` is the sourced list compiled into both engines. It is
    # tracked by directory rather than by name so that the next table added
    # beside them cannot escape the hash.
    for name in ("reference", "corpus"):
        tier = os.path.join(ROOT, "data", name)
        if not os.path.isdir(tier):
            continue
        for entry in sorted(os.listdir(tier)):
            if entry.endswith((".json", ".jsonl", ".csv")):
                out.append(f"data/{name}/{entry}")
    return out


def build_manifest(extra: dict | None = None) -> dict:
    files = current_files()
    return {
        "manifest_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "snapshot_id": combined_snapshot_id(files),
        "files": files,
        **(extra or {}),
    }


def write_manifest(path: str | None = None, extra: dict | None = None) -> dict:
    path = path or manifest_path()
    manifest = build_manifest(extra)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, sort_keys=True)
        f.write("\n")
    return manifest


def load_manifest(path: str | None = None) -> dict:
    path = path or manifest_path()
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def verify_manifest(path: str | None = None) -> tuple[bool, list[str]]:
    """Return (ok, problems). Missing manifest is a problem (fail-closed)."""
    path = path or manifest_path()
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


def current_files() -> dict[str, dict]:
    """The sha256 of every tracked data file AS IT SITS ON DISK right now.

    This, and not `load_manifest()`, is what a run must cite. The recorded
    manifest is written by the corpus builders, and a governed data update
    (`tools/import_snapshot.py --apply`) changes the bytes without changing it.
    Measured on the 2026-10-26 PMBJP identity pass: 226 rows of `data/brands.csv`
    were re-keyed, the manifest still recorded the pre-repair file, and every
    experiment run after it stamped `snapshot_id 38a7994f36e641b5` and a
    `data/brands.csv` sha of `f80a7fffc3a0` — a provenance claim about bytes the
    harness had not read. Seven tracked files were stale at once, and nothing
    failed, because `verify_manifest()` was only ever reachable behind a CLI flag.
    """
    return {
        rel: {"sha256": sha256_file(os.path.join(ROOT, rel)),
              "bytes": os.path.getsize(os.path.join(ROOT, rel))}
        for rel in dataset_files()
    }


def combined_snapshot_id(files: dict[str, dict]) -> str:
    return hashlib.sha256(
        "".join(f"{k}:{v['sha256']}" for k, v in sorted(files.items())).encode()
    ).hexdigest()[:16]


def refresh_manifest(path: str | None = None) -> dict:
    """Re-hash disk into the recorded manifest, keeping the builders' metadata.

    Called by the importer after an `--apply`, so a data update cannot leave the
    evidence chain pointing at superseded bytes. Everything the corpus builders
    wrote alongside the file map (seed, digest, report) is preserved; only the
    file map and `snapshot_id` are recomputed.
    """
    path = path or manifest_path()
    previous = load_manifest(path) if os.path.exists(path) else {}
    extra = {k: v for k, v in previous.items()
             if k not in {"files", "snapshot_id", "created_at", "manifest_version"}}
    files = current_files()
    manifest = {
        "manifest_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "snapshot_id": combined_snapshot_id(files),
        "files": files,
        **extra,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, sort_keys=True)
        f.write("\n")
    return manifest


def git_sha(short: bool = True) -> str:
    """Current engine commit, short by default. Falls back to 'unknown'.

    Two honesty details, both learned the hard way:

    * the `--short` flag and the rev must BOTH be present; passing only
      `--short` makes `git rev-parse` print usage and yield an empty string,
      which silently poisoned every run manifest with
      `engine_git_sha: "unknown"`;
    * when TRACKED files are modified, the commit alone does not identify the
      code that produced a run. Such a revision is reported as `<sha>-dirty`
      so a manifest can never claim a clean-tree provenance it does not have.
      Untracked files are ignored on purpose: the evidence artefacts (new run
      directories) are untracked by nature and are not engine code.
    """
    args = ["git", "rev-parse", "--short", "HEAD"] if short else ["git", "rev-parse", "HEAD"]
    try:
        out = subprocess.run(
            args, cwd=ROOT, capture_output=True, text=True, timeout=5, check=False)
        sha = out.stdout.strip() or "unknown"
        if sha == "unknown":
            return sha
        dirty = subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT,
            capture_output=True, text=True, timeout=5, check=False)
        return f"{sha}-dirty" if dirty.stdout.strip() else sha
    except Exception:  # pragma: no cover - only in odd environments
        return "unknown"


def environment() -> dict:
    return {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "machine": platform.machine(),
    }


def snapshot_id(path: str | None = None) -> str:
    """The dataset identity a run must cite — recomputed from the bytes on disk.

    It used to read `manifest.json`, which made the stamp a copy of whatever the
    last corpus build recorded. A data update that did not rebuild the corpus
    therefore stamped superseded bytes, and every number downstream inherited the
    wrong provenance. Recomputing costs ~11 file hashes; `ml/manifest.py` is
    already hashing them on every corpus write.
    """
    path = path or manifest_path()
    try:
        return combined_snapshot_id(current_files())
    except OSError:
        try:
            return load_manifest(path).get("snapshot_id", "unrecorded")
        except (FileNotFoundError, ValueError):
            return "unrecorded"
