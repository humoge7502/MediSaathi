"""A run must cite the bytes it read, not the bytes someone recorded (MED-004).

WHY THIS FILE EXISTS: the evidence spine's one law is "no number without a run
manifest", and the manifest's dataset half was a copy of `data/manifest.json` —
a file only the corpus builders rewrite. The 2026-10-26 identity repair replaced
226 rows of `data/brands.csv` through the governed importer, and the next
experiment battery stamped `snapshot_id 38a7994f36e641b5` together with
`data/brands.csv: f80a7fffc3a0`, a hash of a table the harness had not read.
Seven tracked files were stale at once. `ml/manifest.py`'s own docstring said the
loader verifies hashes and CI fails on mismatch: `verify_manifest()` existed, was
correct, and was reachable only behind a CLI flag nothing ran.

So the law here is two lines: a run hashes disk, and a gate compares disk with
what was recorded. Both are tested below, and the stale state itself is
reproduced — a test that only checks agreement cannot tell a fix from a vacuous
pass.

Run: python -m pytest apps/api/tests/test_dataset_manifest.py -q
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys

import pytest

HERE = os.path.abspath(os.path.dirname(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))
sys.path.insert(0, os.path.join(ROOT, "packages", "contracts"))

from ml import manifest as ds  # noqa: E402


def _make_tree(root: str, files: dict[str, str]) -> None:
    for rel, text in files.items():
        path = os.path.join(root, *rel.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)


@pytest.fixture()
def tree(tmp_path, monkeypatch):
    """A repo-shaped tree with three tracked tables, one reference table and one
    corpus file."""
    repo = tmp_path / "repo"
    (repo / "data" / "corpus").mkdir(parents=True)
    _make_tree(str(repo), {
        "data/brands.csv": "brand,molecule\nTab A,paracetamol\n",
        "data/interactions.csv": "molecule_a,molecule_b\nparacetamol,warfarin\n",
        "data/reference/dose_caps.csv": "molecule,max_daily_mg\nparacetamol,4000\n",
        "data/corpus/cases.jsonl": '{"case_id":"C001"}\n',
    })
    monkeypatch.setattr(ds, "ROOT", str(repo))
    return str(repo)


def test_recorded_manifest_matches_the_bytes_on_disk() -> None:
    """The committed artifact is current: `make data-check` asserts this too."""
    ok, problems = ds.verify_manifest()
    assert ok, "\n".join(problems)


def test_snapshot_id_follows_the_file_not_the_record(tree: str) -> None:
    """Mutate a tracked table without rewriting the manifest — the exact shape
    of the 2026-10-26 repair — and the dataset identity must move with it."""
    manifest_path = os.path.join(tree, "data", "manifest.json")
    written = ds.write_manifest(manifest_path)
    stale_id = written["snapshot_id"]

    with open(os.path.join(tree, "data/brands.csv"), "w", encoding="utf-8") as f:
        f.write("brand,molecule\nTab A,paracetamol\nTab B,ibuprofen\n")

    assert ds.snapshot_id(manifest_path) != stale_id, (
        "snapshot_id still reports the recorded digest: a run after a data "
        "update would cite bytes it never read")
    assert ds.snapshot_id(manifest_path) == ds.combined_snapshot_id(ds.current_files())
    ok, problems = ds.verify_manifest(manifest_path)
    assert not ok and any("brands.csv" in p for p in problems), (
        "a stale manifest must be reported as a problem, not silently believed")


def test_editing_a_dose_cap_moves_the_dataset_identity(tree: str) -> None:
    """`data/reference/dose_caps.csv` is the table of record for the daily-cap
    verdict — `apps/api/app/safety/dosing.py` reads it at import — yet the file
    map never listed the `data/reference/` tier at all. So a governed update to a
    cap, or a hand edit, left `snapshot_id` exactly where it was and
    `verify_manifest()` stayed green: the number a report cites would continue to
    vouch for a dose limit whose bytes it had never hashed.

    Same shape as the 2026-10-26 `brands.csv` break above, one directory over."""
    manifest_path = os.path.join(tree, "data", "manifest.json")
    written = ds.write_manifest(manifest_path)
    stale_id = written["snapshot_id"]

    with open(os.path.join(tree, "data/reference/dose_caps.csv"), "w", encoding="utf-8") as f:
        f.write("molecule,max_daily_mg\nparacetamol,3000\n")

    assert ds.snapshot_id(manifest_path) != stale_id, (
        "a dose-cap table can change without moving the dataset identity that "
        "every reported number cites")
    ok, problems = ds.verify_manifest(manifest_path)
    assert not ok and any("dose_caps.csv" in p for p in problems), (
        f"editing the cap table left the record believed: {problems}")


def test_the_committed_manifest_hashes_the_verdict_bearing_reference_tables() -> None:
    """Disk, not the fixture: the shipped `data/manifest.json` must already carry
    the tables the engine reads to decide a dose cap and a QT stack. Naming the
    two paths here is deliberate — the break is a future reference table added
    beside them and silently left out of the hash because the tracking rule only
    knows `data/corpus/`."""
    recorded = ds.load_manifest()
    for rel in ("data/reference/dose_caps.csv", "data/reference/qt_prolonging.csv"):
        assert rel in recorded["files"], (
            f"{rel} is not hashed, so no run manifest can prove which bytes it read")
        assert recorded["files"][rel]["sha256"] == ds.sha256_file(os.path.join(ROOT, rel))


def test_run_manifest_cites_disk_hashes(tmp_path, tree: str, monkeypatch) -> None:
    """`ml.runner` used to copy the recorded file map into every run manifest.
    It must hash disk instead, and a stale record must not leak into the run."""
    import ml.runner as runner

    manifest_path = os.path.join(tree, "data", "manifest.json")
    ds.write_manifest(manifest_path)
    recorded_brands = ds.load_manifest(manifest_path)["files"]["data/brands.csv"]["sha256"]
    with open(os.path.join(tree, "data/brands.csv"), "w", encoding="utf-8") as f:
        f.write("brand,molecule\nTab A,paracetamol\nTab C,aspirin\n")

    runs = str(tmp_path / "runs")
    path = runner.write_run("TEST", {"k": 1}, {"m": 2}, runs_dir=runs)
    with open(os.path.join(path, "manifest.json"), encoding="utf-8") as f:
        emitted = json.load(f)

    assert emitted["dataset"]["files"]["data/brands.csv"] != recorded_brands
    assert emitted["dataset"]["files"] == {
        rel: meta["sha256"] for rel, meta in ds.current_files().items()}
    assert emitted["dataset"]["snapshot_id"] == ds.snapshot_id(manifest_path)


def test_refresh_preserves_the_builders_metadata(tree: str) -> None:
    """The corpus builders seed a report and a digest alongside the file map; a
    refresh may re-hash disk but must not delete what they recorded."""
    manifest_path = os.path.join(tree, "data", "manifest.json")
    ds.write_manifest(manifest_path, extra={"corpus_digest": "deadbeef", "seed": 20260911})
    with open(os.path.join(tree, "data/interactions.csv"), "w", encoding="utf-8") as f:
        f.write("molecule_a,molecule_b\nparacetamol,warfarin\nibuprofen,warfarin\n")

    refreshed = ds.refresh_manifest(manifest_path)
    assert refreshed["corpus_digest"] == "deadbeef"
    assert refreshed["seed"] == 20260911
    assert refreshed["snapshot_id"] == ds.snapshot_id(manifest_path)
    ok, problems = ds.verify_manifest(manifest_path)
    assert ok, problems


def test_the_importer_refreshes_the_manifest_after_apply(tmp_path, monkeypatch) -> None:
    """The gate is only honest if the path that changes data also updates the
    record — otherwise every governed import reopens the window this fixes."""
    from ml import manifest as live_ds

    repo = tmp_path / "repo"
    (repo / "data" / "snapshots").mkdir(parents=True)
    live = repo / "data" / "brands.csv"
    live.write_text("brand,molecule,form,atc,aware_class,jas_price_inr,source\n"
                    "Tab A,paracetamol,tablet,-,Access,1.0,test\n", encoding="utf-8")
    source = tmp_path / "incoming.csv"
    source.write_text("brand,molecule,form,atc,aware_class,jas_price_inr,source\n"
                      "Tab A,paracetamol,tablet,-,Access,1.0,test\n"
                      "Tab B,ibuprofen,tablet,-,Access,2.0,test\n", encoding="utf-8")
    manifest_path = repo / "data" / "manifest.json"

    spec = importlib.util.spec_from_file_location(
        "import_snapshot", os.path.join(ROOT, "tools", "import_snapshot.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "ROOT", str(repo))
    monkeypatch.setattr(mod, "DATA_DIR", str(repo / "data"))
    monkeypatch.setattr(mod, "SNAPSHOT_DIR", str(repo / "data" / "snapshots"))
    # The importer reaches the manifest through the ml package, whose ROOT this
    # test redirects, so the refresh lands in the candidate tree and not the repo.
    monkeypatch.setattr(live_ds, "ROOT", str(repo))
    before = live_ds.combined_snapshot_id(live_ds.current_files())
    monkeypatch.setattr(sys, "argv", [
        "import_snapshot.py", "--kind", "brands", "--source", str(source),
        "--apply", "--out", str(repo / "data" / "snapshots" / "report.json")])
    assert mod.main() == 0

    after = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert after["snapshot_id"] != before
    assert after["files"]["data/brands.csv"]["sha256"] == live_ds.sha256_file(str(live))
