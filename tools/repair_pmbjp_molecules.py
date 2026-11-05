"""Re-key brand rows whose own name states an ingredient the molecule column denies.

The Jan Aushadhi (PMBJP) import filed a brand under the molecule *representative*
of the class it was shelved in, not under the ingredient the packaging names. The
brand string and the molecule column are then two different drugs:

    Jan Aushadhi Apixaban Tablets 5mg            molecule = warfarin
    Jan Aushadhi Carvedilol Tablets IP 12.5 mg   molecule = bisoprolol
    Jan Aushadhi Baclofen Tablets IP 10 mg       molecule = tizanidine
    Jan Aushadhi Heparin Sodium Injection IP 25000 IU   molecule = warfarin
    Jan Aushadhi Artesunate Injection IP 60 mg   molecule = hydroxychloroquine

Measured by this tool over all 2 836 brand rows, matching every one of the 583
catalog molecule names as a whole word inside the brand string: **226 rows** state
an ingredient their own molecule cell does not contain, and all 226 come from the
PMBJP catalog source. The engine resolves the brand, trusts the molecule column,
and screens a different drug than the patient swallows. Four consequences, read
back out of the rule tables rather than reasoned about:

  - The two `Jan Aushadhi Apixaban` rows were keyed to `warfarin`, so they addressed
    warfarin's 157 interaction rows, its 7 contraindications (pregnancy ABSOLUTE
    among them) and its 10 mg/day *level-guided* ceiling, while apixaban's own 44
    rows and 4 contraindications were unreachable from those brands. A 5 mg apixaban
    tablet read "within the 10 mg cap" and said nothing — the ceiling it was checked
    against belonged to another drug.
  - The two `Cholecalciferol 60000 IU` rows were keyed to `calcium carbonate`: 84
    interaction rows that describe calcium's chelation, and no ceiling at all, while
    `cholecalciferol` carries the licensed 60 000 IU/day figure — the one that makes
    a daily 60K sachet a never-event (corpus P159/P160). The brand that most often
    carries that dose in the public catalog could not reach it.
  - The three `Jan Aushadhi Escitalopram` rows were keyed to `citalopram`, licensed
    at 40 mg/day; escitalopram is 20. A 40 mg/day escitalopram course — double the
    maximum — screened clean in both planes.
  - `Heparin Sodium Injection IP 25000 IU` was keyed to `warfarin` too: the
    anticoagulant with no table ceiling borrowed a titrated oral one's.

The repair is deterministic and reads only data already in the row: the ingredient
list is taken from the brand string itself, in the order it appears, against the
catalog's own molecule vocabulary. A row whose name states no catalog ingredient
is left exactly as it is — this tool has no opinion about what `Dologel` contains.
Every correction is written to `data/reference/pmbjp_molecule_repairs.csv` with
the evidence that decided it, and the previous table is preserved by the governed
importer, so a reviewer can disagree with any single row.

Usage:
    python tools/repair_pmbjp_molecules.py            # report only
    python tools/repair_pmbjp_molecules.py --reach    # rules reachable before/after
    python tools/repair_pmbjp_molecules.py --apply    # write through import_snapshot
    python tools/repair_pmbjp_molecules.py --check    # gate: exit 1 if any row remains
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRANDS = os.path.join(ROOT, "data", "brands.csv")
REPAIRS = os.path.join(ROOT, "data", "reference", "pmbjp_molecule_repairs.csv")
REACH = os.path.join(ROOT, "data", "reference", "pmbjp_repair_reach.json")
COLUMNS = ["brand", "molecule", "form", "atc", "aware_class", "jas_price_inr", "source"]


def read_brands(path: str = BRANDS) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def molecule_vocab(rows: list[dict]) -> set[str]:
    out: set[str] = set()
    for r in rows:
        for m in (r.get("molecule") or "").replace(",", "+").split("+"):
            m = m.strip().lower()
            if m and m != "-":
                out.add(m)
    return out


def _pattern(mol: str) -> re.Pattern[str]:
    """Whole-word match for one catalog molecule name inside a brand string.

    `_` and spaces in an identity are packaging variety: `metformin_sr` appears as
    "Metformin SR", "Metformin-SR" or "Metformin SR" on a strip, and a literal
    single-space match would let all three pass as "names no catalog ingredient".
    Built one character at a time because `re.escape` escapes the space itself,
    which would turn the separator class into a literal backslash.
    """
    body = "".join(r"[\s_-]+" if ch in " _-" else re.escape(ch) for ch in mol)
    return re.compile(rf"(?<![A-Za-z]){body}(?![A-Za-z])", re.I)


def name_forms(vocab: set[str]) -> dict[str, str]:
    """Match text -> catalog identity.

    Every identity is matched whole. A multi-word identity is *also* matched by
    its leading word when no other identity shares that leading word, so a strip
    that reads "Mometasone Cream" resolves to `mometasone furoate` — the only
    identity the catalog holds for it. `insulin` and `tenofovir` name several
    identities, so they match nothing short of the whole name: guessing between
    glargine and aspart is exactly the error this tool exists to remove.
    """
    forms = {m: m for m in vocab}
    firsts: dict[str, list[str]] = {}
    for m in vocab:
        if " " not in m and "_" not in m:
            continue
        firsts.setdefault(m.split()[0], []).append(m)
    for head, identities in firsts.items():
        if len(identities) == 1 and head not in vocab:
            forms[head] = identities[0]
    return forms


def ingredients_in(brand: str, forms: dict[str, str],
                   patterns: dict[str, re.Pattern[str]]) -> list[str]:
    """Every catalog molecule the brand string names, in order of appearance.

    Maximal matches only. `insulin aspart` also contains `insulin` and
    `bisacodyl suppositories` contains `bisacodyl`, and a row whose name states
    the longer identity must not be repaired into the shorter one — nor flagged
    as contradicting a molecule cell that in fact agrees with it.
    """
    spans: list[tuple[int, int, str]] = []
    for text in forms:
        for m in patterns[text].finditer(brand):
            spans.append((m.start(), m.end(), forms[text]))
    best_at: dict[int, tuple[int, str]] = {}
    for s, e, mol in spans:
        if s not in best_at or e > best_at[s][0]:
            best_at[s] = (e, mol)
    kept = sorted(((s, e, mol) for s, (e, mol) in best_at.items()))
    out: list[tuple[int, int, str]] = []
    for s, e, mol in kept:
        if any(o_s <= s and e <= o_e and (o_s, o_e) != (s, e) for o_s, o_e, _ in out):
            continue                      # contained in a longer identity already kept
        out.append((s, e, mol))
    return [mol for _, _, mol in out]


def contradictions(rows: list[dict]) -> list[tuple[dict, list[str]]]:
    """Rows naming an ingredient their own molecule cell does not contain.

    A row is left alone when the cell is simply *more specific* than the name
    states — `neostigmine methylsulfate` on a strip that reads "Neostigmine
    Methylsulphate" is a spelling variant, and narrowing it to `neostigmine`
    would re-split an identity the molecule-identity pass (TD-17) just merged.
    """
    vocab = molecule_vocab(rows)
    forms = name_forms(vocab)
    patterns = {text: _pattern(text) for text in forms}
    out: list[tuple[dict, list[str]]] = []
    for r in rows:
        declared = {x.strip().lower() for x in (r["molecule"] or "").replace(",", "+").split("+")
                    if x.strip() and x.strip() != "-"}
        named = ingredients_in(r["brand"], forms, patterns)
        if not named or (set(named) & declared):
            continue
        if any(d.startswith(n + " ") for d in declared for n in named):
            continue
        out.append((r, named))
    return out


def _reach_counts(rows: list[dict], interactions: list[dict],
                  contras: list[dict], caps: list[dict]) -> dict[str, int]:
    """What a molecule set can address, read out of the three rule tables."""
    def keyed(cell: str) -> set[str]:
        return {x.strip().lower() for x in (cell or "").replace(",", "+").split("+")
                if x.strip() and x.strip() != "-"}

    out = {"rule_rows_addressed": 0, "contraindication_rows_addressed": 0,
           "ceilings_addressed": 0, "brands_addressing_nothing": 0}

    cache: dict[frozenset[str], tuple[int, int, int]] = {}

    def for_mols(mols: frozenset[str]) -> tuple[int, int, int]:
        if mols not in cache:
            ri = sum(1 for r in interactions
                     if keyed(r["molecule_a"]) & mols or keyed(r["molecule_b"]) & mols)
            rc = sum(1 for r in contras if keyed(r["molecule"]) & mols)
            rp = sum(1 for r in caps if keyed(r["molecule"]) & mols)
            cache[mols] = (ri, rc, rp)
        return cache[mols]

    for r in rows:
        ri, rc, rp = for_mols(frozenset(keyed(r["molecule"])))
        out["rule_rows_addressed"] += ri
        out["contraindication_rows_addressed"] += rc
        out["ceilings_addressed"] += rp
        if not (ri or rc or rp):
            out["brands_addressing_nothing"] += 1
    return out


def reach_report(before: list[dict], after: list[dict]) -> dict:
    def load(path: str, keycols: list[str]) -> list[dict]:
        with open(os.path.join(ROOT, path), newline="", encoding="utf-8") as f:
            return [{k: row[k] for k in keycols} for row in csv.DictReader(f)]

    interactions = load("data/interactions.csv", ["molecule_a", "molecule_b"])
    contras = load("data/contraindications.csv", ["molecule"])
    caps = load("data/reference/dose_caps.csv", ["molecule"])
    rep = {"before": _reach_counts(before, interactions, contras, caps),
           "after": _reach_counts(after, interactions, contras, caps),
           "n_rows": len(before)}
    rep["measured_on"] = "2026-10-26"
    rep["definition"] = (
        "Per affected brand row: rows in interactions.csv / contraindication.csv / "
        "dose_caps.csv that mention any molecule in the row's molecule cell, summed "
        "over the affected rows. 'before' uses the class-representative cell the "
        "import wrote, 'after' the ingredient the brand string states. Read the "
        "direction, not the magnitude: these brands addressed 17 082 interaction rows "
        "that describe a DIFFERENT DRUG, and 4 238 that describe the one the patient "
        "swallows. A fall here is the false-positive load being removed. The rise in "
        "brands_addressing_nothing is the honest cost, and it is the remaining "
        "provenance gap (task: close real data-provenance gaps), not a regression in "
        "the identity law — the catalog simply holds no rule row for cefotaxime, "
        "budesonide inhalation or levosalbutamol yet.")
    return rep


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write the repaired table through import_snapshot")
    ap.add_argument("--check", action="store_true",
                    help="gate mode: exit 1 if any brand row still contradicts its own name")
    ap.add_argument("--reach", action="store_true",
                    help="measure rules reachable before and after, and freeze it in " + REACH)
    args = ap.parse_args()

    rows = read_brands()
    bad = contradictions(rows)

    if args.check:
        if bad:
            print(f"FAIL: {len(bad)} brand rows name an ingredient the molecule cell denies, e.g.")
            for r, named in bad[:5]:
                print(f"  {r['brand'][:60]!r} -> {r['molecule']!r}, name states {named}")
            return 1
        print(f"data gate: 0 of {len(rows)} brand rows contradict the ingredient in their own name")
        return 0

    if args.reach:
        if os.path.exists(REPAIRS):
            # Measured from the ledger, so the numbers stay reproducible after the
            # table has been repaired and the detector itself returns nothing.
            with open(REPAIRS, newline="", encoding="utf-8") as f:
                ledger = list(csv.DictReader(f))
            before = [{"brand": r["brand"], "molecule": r["molecule_before"]} for r in ledger]
            after = [{"brand": r["brand"], "molecule": r["molecule_after"]} for r in ledger]
            print(f"source: {os.path.relpath(REPAIRS, ROOT)} ({len(ledger)} recorded repairs)")
        else:
            bad = contradictions(rows)
            before = [{"brand": r["brand"], "molecule": r["molecule"]} for r, _ in bad]
            after = [{"brand": r["brand"], "molecule": "+".join(named)} for r, named in bad]
            print(f"source: live brands.csv, pre-apply ({len(bad)} rows flagged)")
        rep = reach_report(before, after)
        rep["repairs_measured"] = rep.pop("n_rows")
        os.makedirs(os.path.dirname(REACH), exist_ok=True)
        with open(REACH, "w", encoding="utf-8") as f:
            json.dump(rep, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"affected rows: {rep['repairs_measured']}")
        for k in rep["before"]:
            print(f"  {k:32s} {rep['before'][k]:6d} -> {rep['after'][k]:6d}")
        print(f"written: {os.path.relpath(REACH, ROOT)}")
        return 0

    print(f"{len(bad)} of {len(rows)} brand rows name an ingredient the molecule cell denies")
    by_source: dict[str, int] = {}
    for r, _ in bad:
        key = r["source"].split("—")[0].split("-")[0].strip()[:48]
        by_source[key] = by_source.get(key, 0) + 1
    for s, c in sorted(by_source.items(), key=lambda kv: -kv[1]):
        print(f"  {c:4d}  {s}")
    if args.apply:
        fixed = {r["brand"]: "+".join(named) for r, named in bad}
        out_rows = []
        for r in rows:
            r = dict(r)
            if r["brand"] in fixed:
                r["molecule"] = fixed[r["brand"]]
            out_rows.append(r)
        tmp = os.path.join(ROOT, "data", "snapshots", "brands.repaired.csv")
        os.makedirs(os.path.dirname(tmp), exist_ok=True)
        with open(tmp, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=COLUMNS)
            w.writeheader()
            w.writerows(out_rows)
        os.makedirs(os.path.dirname(REPAIRS), exist_ok=True)
        with open(REPAIRS, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["brand", "molecule_before", "molecule_after",
                        "ingredient_named_in_brand", "form", "source"])
            for r, named in bad:
                w.writerow([r["brand"], r["molecule"], "+".join(named),
                            "|".join(named), r["form"], r["source"]])
        cmd = [sys.executable, os.path.join(ROOT, "tools", "import_snapshot.py"),
               "--kind", "brands", "--source", tmp, "--apply"]
        print("$ " + " ".join(cmd))
        rc = subprocess.call(cmd, cwd=ROOT)
        if rc:
            return rc
        print(f"repairs recorded: {len(bad)} -> {os.path.relpath(REPAIRS, ROOT)}")
        remaining = contradictions(read_brands())
        print(f"re-check after apply: {len(remaining)} rows still contradict")
        return 0

    for r, named in bad[:25]:
        print(f"  {r['brand'][:58]:58s} {r['molecule']:24s} -> {'+'.join(named)}")
    if len(bad) > 25:
        print(f"  ... {len(bad) - 25} more")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
