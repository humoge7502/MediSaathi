"""Labeled corpus loading, splits and strata (MED-005/MED-006).

The corpus is a **decision-layer** corpus: every case ships the perception
result it was built from (raw line + per-line confidence) plus adjudicated
labels for the field values, the verdict class and the findings. That makes the
A0-A4 ladder reproducible without a live model, and it is stated plainly in
`docs/patent/EXPERIMENTS.md`: perception *accuracy* on real images is a separate
open experiment (live model required).

Files:

    data/corpus/cases.jsonl     one JSON case per line
    data/corpus/splits.json     train / calibration / test case ids
    data/corpus/adversarial.jsonl  corruption-ladder cases (MED-010)

Corpus integrity is enforced against `data/manifest.json` (sha256).
"""
from __future__ import annotations

import json
import os

from .manifest import ROOT

CORPUS_DIR = os.path.join(ROOT, "data", "corpus")
CASES_PATH = os.path.join(CORPUS_DIR, "cases.jsonl")
SPLITS_PATH = os.path.join(CORPUS_DIR, "splits.json")
ADVERSARIAL_PATH = os.path.join(CORPUS_DIR, "adversarial.jsonl")

VERDICT_CLASSES = (
    "pass", "interaction", "contraindication", "duplicate_atc",
    "confirm_queue", "refused",
)

#: verdicts that a *safe* system must never issue as a bare "pass"
SAFETY_RELEVANT = ("interaction", "contraindication", "duplicate_atc",
                   "confirm_queue", "refused")


def load_cases(path: str = CASES_PATH) -> list[dict]:
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"corpus missing: {path} — run `python tools/build_corpus.py`")
    cases: list[dict] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                cases.append(json.loads(line))
    return cases


def load_splits(path: str = SPLITS_PATH) -> dict:
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"splits missing: {path} — run `python tools/build_corpus.py`")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def cases_by_id(path: str = CASES_PATH) -> dict[str, dict]:
    return {c["case_id"]: c for c in load_cases(path)}


def split_cases(name: str, *, cases: list[dict] | None = None,
                splits: dict | None = None) -> list[dict]:
    """Cases belonging to one split ('train' | 'calibration' | 'test')."""
    splits = splits or load_splits()
    ids = splits.get(name)
    if ids is None:
        raise KeyError(f"unknown split {name!r}; have {sorted(splits)}")
    by_id = {c["case_id"]: c for c in (cases or load_cases())}
    missing = [i for i in ids if i not in by_id]
    if missing:
        raise KeyError(f"split {name} references unknown cases: {missing[:5]}")
    return [by_id[i] for i in ids]


def strata(cases: list[dict] | None = None) -> dict[str, int]:
    counts: dict[str, int] = {}
    for c in cases or load_cases():
        counts[c["stratum"]] = counts.get(c["stratum"], 0) + 1
    return dict(sorted(counts.items()))


def verdict_distribution(cases: list[dict] | None = None) -> dict[str, int]:
    counts: dict[str, int] = {}
    for c in cases or load_cases():
        v = c["labels"]["verdict"]
        counts[v] = counts.get(v, 0) + 1
    return dict(sorted(counts.items()))


def assert_disjoint(cases: list[dict] | None = None) -> None:
    """Splits must partition the corpus — a leaked test split invalidates E-A."""
    splits = load_splits()
    seen: dict[str, str] = {}
    for name in ("train", "calibration", "test"):
        for cid in splits.get(name, []):
            if cid in seen:
                raise AssertionError(f"case {cid} in both {seen[cid]} and {name}")
            seen[cid] = name
    known = {c["case_id"] for c in (cases or load_cases())}
    if set(seen) != known:
        raise AssertionError(
            f"splits do not cover the corpus: missing {sorted(known - set(seen))[:5]}, "
            f"extra {sorted(set(seen) - known)[:5]}")
