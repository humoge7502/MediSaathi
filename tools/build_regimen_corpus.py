"""Build the cross-prescription regimen corpus (mechanism A+B evidence).

Deterministic, seeded, dependency-free. Run:

    python tools/build_regimen_corpus.py            # write data/corpus/regimen.jsonl
    python tools/build_regimen_corpus.py --report    # strata summary only

Why a second corpus: the 300-case corpus is *single-prescription*. It cannot
contain a harm that only exists because two prescriptions were composed, because
each case is screened alone. This corpus holds the patient's already-active
regimen fixed and varies the arriving prescription, so the incumbent
single-prescription law can be measured against the longitudinal plane.

Every case is constructed by intent and then **verified against both planes**:
a cross-prescription case is kept only if the incumbent law returns ``pass``
(it cannot see the harm) *and* the regimen plane flags it. Fragile cases are
kept only if the incumbent auto-confirms and the propagation gate queues. A case
whose construction intent and both engines cannot be reconciled is dropped and
counted — never silently relabelled.

Strata
------
cross_combination   triple whammy assembled from two visits
cross_qt            a third QT-prolonger added to two already active
cross_serotonin     SSRI + a second serotonergic added on top of the first
cross_bleeding      antithrombotic + SSRI, then an NSAID arrives
cross_duplicate     the same molecule reached through a different brand
fragile_confusable  the read could plausibly be a brand that changes the answer
clean_continuation  composed regimen is genuinely clean
incoming_harm       control: the harm is inside the new prescription itself
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))
sys.path.insert(0, os.path.join(ROOT, "packages", "contracts"))
sys.path.insert(0, ROOT)

from app.safety.engine import MOLECULE_GROUPS, SafetyEngine  # noqa: E402
from app.safety.regimen import DEFAULT_FRAGILITY_THRESHOLD  # noqa: E402

from ml import manifest as ds_manifest  # noqa: E402
from ml import regimen as regimen_eval  # noqa: E402

SEED = 20260911
CORPUS_DIR = os.path.join(ROOT, "data", "corpus")
OUT_PATH = os.path.join(CORPUS_DIR, "regimen.jsonl")

QUOTAS = {
    "cross_combination": 20,
    "cross_qt": 15,
    "cross_serotonin": 12,
    "cross_bleeding": 12,
    "cross_duplicate": 15,
    "fragile_confusable": 10,
    "clean_continuation": 20,
    "incoming_harm": 15,
}

#: labels that mean the case must NOT be auto-confirmed as a bare pass
HARMFUL = ("interaction", "contraindication", "duplicate_atc")

HARMFUL_LABEL = {
    "cross_combination": "interaction",
    "cross_qt": "interaction",
    "cross_serotonin": "interaction",
    "cross_bleeding": "interaction",
    "cross_duplicate": "duplicate_atc",
    "fragile_confusable": "confirm_queue",
    "clean_continuation": "pass",
    "incoming_harm": "interaction",
}


# ------------------------------------------------------------------ formulary helpers

def brand_rows(engine: SafetyEngine) -> list[dict]:
    return list(engine.brands.values())


def brands_for(engine: SafetyEngine, molecule: str) -> list[dict]:
    out = []
    for row in engine.brands.values():
        mols = [m.strip().lower() for m in row["molecule"].replace(",", "+").split("+")]
        if molecule in mols:
            out.append(row)
    return out


def group_brands(engine: SafetyEngine, group: str) -> list[dict]:
    out = []
    for mol in MOLECULE_GROUPS.get(group, ()):
        out.extend(brands_for(engine, mol))
    return out


def pick(rng: random.Random, pool: list[dict]) -> dict:
    return rng.choice(pool)


def incoming_lines(rng: random.Random, rows: list[dict], *,
                   confidence_range=(0.93, 0.99)) -> list[dict]:
    lines = []
    for row in rows:
        conf = round(rng.uniform(*confidence_range), 2)
        lines.append({
            "raw": f"Tab {row['brand']} - OD x 5 days",
            "read_brand": row["brand"],
            "true_brand": row["brand"],
            "confidence": conf,
        })
    return lines


# ------------------------------------------------------------------ case assembly

def make_case(case_id: str, stratum: str, active: list[dict], lines: list[dict],
              verdict: str, findings: list[dict], provenance: dict) -> dict:
    return {
        "case_id": case_id,
        "stratum": stratum,
        "intent": stratum,
        "as_of_day": 0,
        "context": [],
        "active": active,
        "artifact": {
            "kind": "text",
            "text": "\n".join(ln["raw"] for ln in lines),
            "lines": lines,
        },
        "labels": {
            "verdict": verdict,
            "crossing": stratum.startswith("cross_") or stratum == "fragile_confusable",
            "findings": findings,
        },
        "provenance": {
            "synthetic": True,
            "generator": "tools/build_regimen_corpus.py",
            "sources": ["data/brands.csv", "data/interactions.csv",
                        "data/contraindications.csv"],
            **provenance,
        },
    }


def active_entry(row: dict, *, started_day: int = -5, duration_days: int = 30) -> dict:
    return {"brand": row["brand"], "molecule": row["molecule"],
            "started_day": started_day, "duration_days": duration_days}


def verify(engine: SafetyEngine, case: dict) -> tuple[bool, dict]:
    """Keep only cases where both planes say what the stratum intends."""
    single = regimen_eval.run_case(engine, case, regimen_eval.ARM_SINGLE_RX)
    prop = regimen_eval.run_case(engine, case, regimen_eval.ARM_REGIMEN_PROP)
    no_prop = regimen_eval.run_case(engine, case, regimen_eval.ARM_REGIMEN)
    out = {"single": single["verdict"], "regimen": prop["verdict"],
           "regimen_no_prop": no_prop["verdict"], "fragility": prop["fragility"]}

    if case["stratum"] == "clean_continuation":
        return prop["verdict"] == "pass", out
    if case["stratum"] == "fragile_confusable":
        # incumbent auto-confirms (pass), propagation queues, and the queue is
        # caused by fragility rather than by a low-confidence field.
        ok = (single["verdict"] == "pass"
              and prop["verdict"] == "confirm_queue"
              and prop["fragility"] > DEFAULT_FRAGILITY_THRESHOLD
              and no_prop["verdict"] != "confirm_queue")
        return ok, out
    if case["stratum"] == "incoming_harm":
        return single["verdict"] != "pass" and prop["verdict"] != "pass", out
    # cross_*: the incumbent must MISS it (pass) and the regimen plane must catch it
    ok = single["verdict"] == "pass" and prop["verdict"] != "pass"
    return ok, out


# ------------------------------------------------------------------ strata builders

def build_cross_combination(engine, rng, want):
    out = []
    looks = 0
    while len(out) < want and looks < want * 200:
        looks += 1
        raas = pick(rng, group_brands(engine, "raas_blocker"))
        diu = pick(rng, group_brands(engine, "loop_or_thiazide"))
        nsaid = pick(rng, group_brands(engine, "nsaid"))
        if len({raas["brand"], diu["brand"], nsaid["brand"]}) != 3:
            continue
        active = [active_entry(raas), active_entry(diu)]
        lines = incoming_lines(rng, [nsaid])
        out.append((active, lines, [{"kind": "combination", "match": "triple whammy"}]))
    return out


def build_cross_qt(engine, rng, want):
    qt = group_brands(engine, "qt_prolonging")
    out = []
    looks = 0
    while len(out) < want and looks < want * 200:
        looks += 1
        picks = rng.sample(qt, 3) if len(qt) >= 3 else []
        if len({p["brand"] for p in picks}) != 3:
            continue
        active = [active_entry(picks[0]), active_entry(picks[1])]
        lines = incoming_lines(rng, [picks[2]])
        out.append((active, lines, [{"kind": "combination", "match": "QT"}]))
    return out


def build_cross_serotonin(engine, rng, want):
    ssri = group_brands(engine, "ssri")
    seroton = [b for b in group_brands(engine, "serotonergic")]
    out = []
    looks = 0
    while len(out) < want and looks < want * 200:
        looks += 1
        s = pick(rng, ssri)
        a = pick(rng, seroton)
        b = pick(rng, seroton)
        if len({s["brand"], a["brand"], b["brand"]}) != 3:
            continue
        active = [active_entry(s), active_entry(a)]
        lines = incoming_lines(rng, [b])
        out.append((active, lines, [{"kind": "combination", "match": "serotonin"}]))
    return out


def build_cross_bleeding(engine, rng, want):
    blood = group_brands(engine, "anticoagulant_or_antiplatelet")
    ssri = group_brands(engine, "ssri")
    nsaid = group_brands(engine, "nsaid")
    out = []
    looks = 0
    while len(out) < want and looks < want * 200:
        looks += 1
        bl, s, n = pick(rng, blood), pick(rng, ssri), pick(rng, nsaid)
        if len({bl["brand"], s["brand"], n["brand"]}) != 3:
            continue
        active = [active_entry(bl), active_entry(s)]
        lines = incoming_lines(rng, [n])
        out.append((active, lines, [{"kind": "combination", "match": "bleeding"}]))
    return out


def build_cross_duplicate(engine, rng, want):
    by_mol: dict[str, list[dict]] = {}
    for row in engine.brands.values():
        for mol in row["molecule"].lower().split("+"):
            by_mol.setdefault(mol.strip(), []).append(row)
    pools = [v for v in by_mol.values() if len(v) >= 2]
    out = []
    looks = 0
    while len(out) < want and looks < want * 200:
        looks += 1
        pool = pick(rng, pools)
        a, b = rng.sample(pool, 2)
        if a["brand"] == b["brand"]:
            continue
        active = [active_entry(a)]
        lines = incoming_lines(rng, [b])
        out.append((active, lines, [{"kind": "duplicate", "match": "duplicate"}]))
    return out


def build_fragile(engine, rng, want):
    """Data-driven: find reads whose confusion neighbourhood can flip the verdict.

    The active regimen is searched, not assumed: for each linked look-alike pair
    (read, neighbour) with different molecules, look for a single already-active
    medicine that the *neighbour* harms but the read does not. The incumbent
    auto-confirms such a read; propagation must queue it.
    """
    # linked pairs, derived exactly as the mechanism derives them
    from app.safety.regimen import confusion_neighbours
    pairs: list[tuple[dict, dict]] = []
    for row in engine.brands.values():
        for _sim, nb in confusion_neighbours(engine, row["brand"]):
            if set(row["molecule"].lower().split("+")) != set(nb["molecule"].lower().split("+")):
                pairs.append((row, nb))
    rng.shuffle(pairs)

    actives = list(engine.brands.values())
    rng.shuffle(actives)
    out = []
    for read, neighbour in pairs:
        if len(out) >= want:
            break
        for cand in actives[:60]:
            if cand["brand"] in (read["brand"], neighbour["brand"]):
                continue
            case = make_case("__probe__", "fragile_confusable",
                             [active_entry(cand)],
                             incoming_lines(rng, [read], confidence_range=(0.92, 0.94)),
                             "confirm_queue", [], {})
            ok, _out = verify(engine, case)
            if ok:
                out.append(([active_entry(cand)],
                            incoming_lines(rng, [read], confidence_range=(0.92, 0.94)),
                            [{"kind": "fragile_read", "match": "confusable",
                              "neighbour": neighbour["brand"]}]))
                break
    return out


def build_clean(engine, rng, want):
    out = []
    looks = 0
    while len(out) < want and looks < want * 200:
        looks += 1
        a, b = rng.sample(brand_rows(engine), 2)
        if a["brand"] == b["brand"]:
            continue
        active = [active_entry(a)]
        lines = incoming_lines(rng, [b])
        out.append((active, lines, []))
    return out


def build_incoming_harm(engine, rng, want):
    severe = [r for r in engine.interactions if r["severity"] == "severe"]
    out = []
    looks = 0
    while len(out) < want and looks < want * 100:
        looks += 1
        rule = pick(rng, severe)
        a = brands_for(engine, rule["molecule_a"].lower())
        b = brands_for(engine, rule["molecule_b"].lower())
        if not a or not b:
            continue
        ra, rb = pick(rng, a), pick(rng, b)
        if ra["brand"] == rb["brand"]:
            continue
        benign = [r for r in brand_rows(engine)
                  if r["brand"] not in (ra["brand"], rb["brand"])]
        active = [active_entry(pick(rng, benign))]
        lines = incoming_lines(rng, [ra, rb])
        out.append((active, lines, [{"kind": "interaction", "match": rule["mechanism"][:24].lower()}]))
    return out


# ------------------------------------------------------------------ assembly

def generate() -> tuple[list[dict], dict]:
    engine = SafetyEngine.load()
    rng = random.Random(SEED)
    builders = {
        "cross_combination": build_cross_combination,
        "cross_qt": build_cross_qt,
        "cross_serotonin": build_cross_serotonin,
        "cross_bleeding": build_cross_bleeding,
        "cross_duplicate": build_cross_duplicate,
        "fragile_confusable": build_fragile,
        "clean_continuation": build_clean,
        "incoming_harm": build_incoming_harm,
    }
    cases: list[dict] = []
    kept: dict[str, int] = {}
    dropped: dict[str, int] = {}
    seen: set[str] = set()
    for stratum in QUOTAS:
        for active, lines, findings in builders[stratum](engine, rng, QUOTAS[stratum] * 3):
            if kept.get(stratum, 0) >= QUOTAS[stratum]:
                break
            case = make_case("__pending__", stratum, active, lines,
                             HARMFUL_LABEL[stratum], findings, {})
            sig = json.dumps([case["active"], case["artifact"]["text"]], sort_keys=True)
            if sig in seen:
                continue
            ok, _out = verify(engine, case)
            if not ok:
                dropped[stratum] = dropped.get(stratum, 0) + 1
                continue
            seen.add(sig)
            kept[stratum] = kept.get(stratum, 0) + 1
            cases.append(case)

    order = list(QUOTAS)
    cases.sort(key=lambda c: (order.index(c["stratum"]), c["artifact"]["text"]))
    for i, case in enumerate(cases, start=1):
        case["case_id"] = f"R{i:03d}"
    report = {
        "n": len(cases),
        "seed": SEED,
        "strata": {s: sum(1 for c in cases if c["stratum"] == s) for s in order},
        "dropped_by_stratum": dropped,
        "cross_prescription_cases": sum(1 for c in cases if c["labels"]["crossing"]),
    }
    return cases, {"report": report}


def write_corpus(cases: list[dict], packed: dict) -> dict:
    os.makedirs(CORPUS_DIR, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        for c in cases:
            f.write(json.dumps(c, sort_keys=True) + "\n")
    return ds_manifest.write_manifest(extra={
        "regimen_corpus": {"cases": len(cases), "seed": SEED,
                           "generator": "tools/build_regimen_corpus.py",
                           "strata": packed["report"]["strata"]}
    })


def digest(cases: list[dict]) -> str:
    h = hashlib.sha256()
    for c in cases:
        h.update(json.dumps(c, sort_keys=True).encode())
    return h.hexdigest()[:16]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true", help="print the strata summary only")
    args = ap.parse_args()
    cases, packed = generate()
    if args.report:
        print(json.dumps(packed["report"], indent=2, sort_keys=True))
        return 0
    manifest = write_corpus(cases, packed)
    print(f"regimen corpus: {len(cases)} cases written to data/corpus/regimen.jsonl")
    print(f"digest: {digest(cases)}  manifest snapshot: {manifest['snapshot_id']}")
    print("strata:", json.dumps(packed["report"]["strata"], sort_keys=True))
    if packed["report"]["dropped_by_stratum"]:
        print("dropped (intent vs planes):",
              json.dumps(packed["report"]["dropped_by_stratum"], sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
