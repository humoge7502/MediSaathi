"""Compile the seeded safety tables into the web tier (ADR-0012, two-plane law).

Until this tool existed the product tier ran a hand-copied extract of the tables
the API tier loads whole (measured against the loaded engine, not assumed):

    brands              99 / 2 836
    interactions        84 / 9 660
    contraindications   37 / 1 267

which is not merely "less data". A rule can only fire for a molecule the plane
can name, so the reachable surface was 86 molecules instead of 583, 865 of
9 660 interaction rows instead of 9 290, and 385 of 1 267 contraindications
instead of 1 237. Two engines that are supposed to be the same engine — the
parity gate pins their verdicts case by case — were deciding over tables that
differ by an order of magnitude, and parity passed because the shared corpus
only names brands the small copy happens to hold.

So this tool does for the safety tables what tools/build_dose_caps.py already
does for dose caps: read the CSVs once, apply the API tier's key rules exactly,
and emit the TypeScript tier's copy as a generated module. Three things keep it
honest:

    python tools/build_web_dataset.py --check   the file is stale, or does not
                                                decode back to the source rows
    apps/api/tests/test_web_dataset.py          the generated table holds exactly
                                                what SafetyEngine.load() can look
                                                up, in both planes' key form
    apps/web/tests/dataset-tables.test.ts       the TypeScript decoder
                                                re-expands rows that hash to the
                                                same value

The folding rules below are the API tier's, byte for byte, because a lookup key
that differs between planes is a rule that silently does not exist in one of
them:

  * brand key   = " ".join(v.replace("\u00a0", " ").strip().lower().split())
                  (11 catalog rows carry a non-breaking space; TypeScript's
                  toLowerCase() does not fold those, so the display name is
                  folded at build time and both planes key identically)
  * molecule    = split on "+" (a "," is read as "+"), each part stripped and
                  lowercased, empties dropped
  * pair key    = the unordered pair of lowercased molecule cells. Combination
                  granularity is KEPT as written: 176 interaction rows and 17
                  contraindication rows are documented for a combination
                  ("sacubitril+valsartan"), and the engine reaches them through
                  moleculeIdentities(), so folding them to components here would
                  destroy the rule rather than normalise it.
  * contra key  = the whole lowercased molecule cell, never split
  * severity, mechanism, source: verbatim. The absolute->severe / relative->
                  moderate mapping belongs to the rule engine, not the data, and
                  no row is filtered by source — the 3 084 rows whose mechanism
                  was authored from the DDInter coverage pattern rather than
                  copied from a pair page are live rules in the API tier, so they
                  are live here too.

Usage:
    python tools/build_web_dataset.py            # regenerate
    python tools/build_web_dataset.py --check    # fail if stale or undecodable
    python tools/build_web_dataset.py --report   # counts, reachability, size
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))

DATA = os.path.join(ROOT, "data")
OUT_PATH = os.path.join(ROOT, "apps", "web", "src", "lib", "safety",
                        "tables.generated.ts")

AWARE_VOCAB = {"Access", "Watch", "Reserve", "-"}
INTERACTION_SEVERITY = {"mild", "moderate", "severe"}
CONTRA_SEVERITY = {"absolute", "relative"}


class TableError(Exception):
    """The source tables are not in the shape both planes assume. Fix the data."""


def norm_key(value: str | None) -> str:
    r"""The API tier's brand key (`_norm_key` in app/safety/engine.py)."""
    return " ".join((value or "").replace("\u00a0", " ").strip().lower().split())


def fold_spaces(value: str) -> str:
    """Whitespace-fold a display name without touching its case.

    Only whitespace changes, so the emitted display string is still the
    catalog's own words — and its `toLowerCase()` is now exactly the key the
    Python tier stores, which a raw U+00A0 in the name would break.
    """
    return " ".join(value.replace("\u00a0", " ").strip().split())


def split_molecules(value: str | None) -> list[str]:
    """`_split_molecules` in app/safety/engine.py."""
    return [m.strip().lower()
            for m in (value or "").replace(",", "+").split("+") if m.strip()]


def read_rows(name: str) -> list[dict]:
    with open(os.path.join(DATA, name), newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


# ------------------------------------------------------------------ payload
def build_brands() -> list[list]:
    rows: list[list] = []
    seen: dict[str, str] = {}
    for row in read_rows("brands.csv"):
        display = fold_spaces(row["brand"])
        key = norm_key(row["brand"])
        if not key:
            raise TableError("brands.csv has a row with an empty brand name")
        rival = seen.get(key)
        if rival is not None:
            raise TableError(
                f"brands.csv keys collide after folding: {rival!r} and {display!r} "
                f"are both {key!r}; one brand, one row")
        seen[key] = display
        molecules = split_molecules(row["molecule"])
        if not molecules:
            raise TableError(f"{display}: molecule cell {row['molecule']!r} names nothing")
        if row["molecule"] != "+".join(molecules):
            # The TypeScript resolver splits on "+" and does not re-fold, so a
            # cell that needs folding here ("Ibuprofen + Paracetamol") would key
            # differently from the one the API tier stored. Refuse it at the gate
            # rather than ship a table that matches in only one plane.
            raise TableError(
                f"{display}: molecule cell {row['molecule']!r} is not already "
                f"lowercase and space-free (canonical form {'+'.join(molecules)!r})")
        aware = row["aware_class"].strip()
        if aware not in AWARE_VOCAB:
            raise TableError(f"{display}: AWaRe class {aware!r} is not in {sorted(AWARE_VOCAB)}")
        try:
            price = round(float(row["jas_price_inr"]), 2)
        except (TypeError, ValueError) as e:
            raise TableError(
                f"{display}: jas_price_inr {row['jas_price_inr']!r} is not a number") from e
        rows.append([display, "+".join(molecules), row["form"].strip(),
                     row["atc"].strip(), aware, f"{price:.2f}"])
    return rows


def build_interactions() -> list[list]:
    rows: list[list] = []
    pairs: dict[frozenset, str] = {}
    for row in read_rows("interactions.csv"):
        a, b = row["molecule_a"].strip().lower(), row["molecule_b"].strip().lower()
        if row["molecule_a"] != a or row["molecule_b"] != b:
            raise TableError(
                f"interaction {row['molecule_a']} + {row['molecule_b']}: molecule "
                "cells must already be lowercase and space-free, or the pair key "
                "differs between the planes")
        if a == b:
            # Python keys a pair as a frozenset, which collapses a self-pair to
            # one element, while TypeScript sorts and joins to "a|a". A self-pair
            # row would be reachable in one plane and not the other.
            raise TableError(f"interaction {a} + {b} is a self-pair; the two key schemes cannot share it")
        key = frozenset((a, b))
        if key in pairs:
            raise TableError(
                f"interaction rows collide: {pairs[key]!r} and {a}+{b} are the same "
                "unordered pair; the pair index keeps one and the planes would "
                "disagree on which")
        pairs[key] = f"{a}+{b}"
        sev = row["severity"].strip().lower()
        if sev not in INTERACTION_SEVERITY:
            raise TableError(f"interaction {a}+{b}: severity {sev!r} is not mild|moderate|severe")
        rows.append([a, b, sev, row["mechanism"].strip(), row["source"].strip()])
    return rows


def build_contraindications() -> list[list]:
    from medisaathi_contracts import CONTEXT_CODES  # the declarable vocabulary

    rows: list[list] = []
    for row in read_rows("contraindications.csv"):
        mol = row["molecule"].strip().lower()
        if row["molecule"] != mol:
            raise TableError(
                f"contraindication {row['molecule']}: molecule cell must already "
                "be lowercase and space-free")
        if not mol:
            raise TableError("contraindications.csv has a row with an empty molecule")
        code = row["condition_code"].strip()
        if code not in set(CONTEXT_CODES):
            # `SafetyEngine.validate_context` refuses an undeclared code, so a
            # rule keyed on one can never fire — dead data pretending to be a
            # safeguard.
            raise TableError(
                f"contraindication {mol}: condition_code {code!r} is not in the "
                "contracts CONTEXT_CODES vocabulary, so no patient can declare it")
        sev = row["severity"].strip().lower()
        if sev not in CONTRA_SEVERITY:
            raise TableError(f"contraindication {mol}/{code}: severity {sev!r} is not absolute|relative")
        if not row["note"].strip():
            raise TableError(f"contraindication {mol}/{code}: an empty note cannot be reviewed")
        rows.append([mol, code, sev, row["note"].strip()])
    return rows


def build_payload() -> dict:
    from app.safety.engine import MOLECULE_GROUPS  # the graph-rule membership

    return {
        "brands": build_brands(),
        "interactions": build_interactions(),
        "contraindications": build_contraindications(),
        "groups": {g: list(m) for g, m in MOLECULE_GROUPS.items()},
    }


def table_hash(payload: dict) -> str:
    """A hash over the values that decide a verdict, in source order.

    Deliberately excluded: the brand display name's case, and the mechanism,
    note and source prose. Those are review material, not rule input — a
    reworded mechanism must not look like a changed safety table to a build
    gate, while a changed severity, a moved molecule or a new row must.
    """
    decided = {
        "brands": [[norm_key(r[0]), r[1], r[4], r[5]] for r in payload["brands"]],
        "interactions": [[r[0], r[1], r[2]] for r in payload["interactions"]],
        "contraindications": payload["contraindications"],
        "groups": payload["groups"],
    }
    return hashlib.sha256(json.dumps(decided, sort_keys=True).encode()).hexdigest()[:16]


# ------------------------------------------------------------------- emit
def js(value: object) -> str:
    """JSON is a subset of TypeScript for the literals this file emits."""
    return json.dumps(value, ensure_ascii=True)


def lines(items: list[str]) -> str:
    return "\n".join(f"  {item}," for item in items[:-1]) + f"\n  {items[-1]},\n" if items else ""


class Pool:
    """Intern every string once; a row stores indices, not copies.

    The interaction table repeats itself badly — 3 014 distinct mechanisms
    written 9 660 times — and a generated module is parsed on every cold start,
    so the copy that travels with the app is stored as tuples and re-expanded
    once at load. Nothing outside the generated file knows or cares.
    """

    def __init__(self) -> None:
        self.values: list[str] = []
        self.index: dict[str, int] = {}

    def of(self, value: str) -> int:
        if value not in self.index:
            self.index[value] = len(self.values)
            self.values.append(value)
        return self.index[value]


def build_source(payload: dict) -> str:
    h = table_hash(payload)
    pool = Pool()
    brands = [[pool.of(r[0]), pool.of(r[1]), pool.of(r[2]), pool.of(r[3]), pool.of(r[4]), r[5]]
              for r in payload["brands"]]
    inter = [[pool.of(r[0]), pool.of(r[1]), pool.of(r[2]), pool.of(r[3]), pool.of(r[4])]
             for r in payload["interactions"]]
    contra = [[pool.of(r[0]), pool.of(r[1]), pool.of(r[2]), pool.of(r[3])]
              for r in payload["contraindications"]]
    groups = [[pool.of(g), [pool.of(m) for m in members]]
              for g, members in payload["groups"].items()]

    header = """/* GENERATED - do not edit.
 * Sources: data/brands.csv, data/interactions.csv, data/contraindications.csv,
 *          MOLECULE_GROUPS in apps/api/app/safety/engine.py
 * Build:   python tools/build_web_dataset.py
 * Table hash: HASHPLACEHOLDER
 *
 * This is the whole safety table, not an extract of it. The hand-curated copy
 * this file replaced held 99 of the 2 836 brands, 84 of the 9 660 interaction
 * pairs and 37 of the 1 267 contraindication rules, so the TypeScript plane was
 * deciding over 86 nameable molecules where the Python plane had 583 - and could
 * not address 88% of the documented interaction rows however confident its read.
 * One table, loaded by both tiers.
 *
 * Strings live once in DATASET_STRINGS and rows reference them by index,
 * because 3 014 distinct mechanisms are written 9 660 times in the source CSV
 * and this module is parsed on every cold start. BRANDS, INTERACTIONS and
 * CONTRAINDICATIONS below are re-expanded at load, so the rest of the tier sees
 * ordinary rows.
 *
 * Key law, mirrored exactly from apps/api/app/safety/engine.py - a lookup key
 * that differs between the planes is a rule that does not exist in one of them:
 *   brand key   whitespace- and case-folded, U+00A0 folded to a space (the
 *               catalog carries 11 of those and toLowerCase() leaves them be)
 *   pair key    unordered pair of lowercased molecule cells
 *   contra key  the whole lowercased molecule cell, never split
 *   combination granularity is KEPT: 176 interaction rows and 17
 *               contraindication rows are documented for a combination
 *               ("sacubitril+valsartan") and reached through
 *               moleculeIdentities(), so components are not substituted for them
 *   severity / mechanism / source are verbatim: the absolute->severe and
 *               relative->moderate mapping belongs to the rule engine, not the
 *               data, and no row is filtered by source.
 */
"""
    src = header.replace("HASHPLACEHOLDER", h) + """
export interface BrandRow {
  brand: string;
  molecule: string; // may be a combination "a+b", lowercase and space-free
  form: string;
  atc: string;
  aware: "Access" | "Watch" | "Reserve" | "-";
  priceInr: number;
}

export interface InteractionRow {
  a: string;
  b: string;
  severity: "mild" | "moderate" | "severe";
  mechanism: string;
  source: string;
}

export interface ContraindicationRow {
  molecule: string;
  condition: string; // context code
  severity: "absolute" | "relative";
  note: string;
}

/** [brand, molecule, form, atc, aware] as DATASET_STRINGS indices, then price. */
type BrandTuple = readonly [number, number, number, number, number, string];
/** [molecule_a, molecule_b, severity, mechanism, source]. */
type InteractionTuple = readonly [number, number, number, number, number];
/** [molecule, condition_code, severity, note]. */
type ContraindicationTuple = readonly [number, number, number, number];
/** [group name, member molecules]. */
type GroupTuple = readonly [number, readonly number[]];

const DATASET_STRINGS: readonly string[] = [
""" + lines([js(s) for s in pool.values]) + """];

const BRAND_ROWS: readonly BrandTuple[] = [
""" + lines([js([r[0], r[1], r[2], r[3], r[4], r[5]]) for r in brands]) + """];

const INTERACTION_ROWS: readonly InteractionTuple[] = [
""" + lines([js(r) for r in inter]) + """];

const CONTRA_ROWS: readonly ContraindicationTuple[] = [
""" + lines([js(r) for r in contra]) + """];

const GROUP_ROWS: readonly GroupTuple[] = [
""" + lines([js(g) for g in groups]) + """];

/** Row counts of the source tables. A decode that drops a line fails here first. */
export const DATASET_ROW_COUNTS = {
  brands: BRAND_COUNTPLACEHOLDER,
  interactions: INTER_COUNTPLACEHOLDER,
  contraindications: CONTRA_COUNTPLACEHOLDER,
} as const;

/** Changes with any edit to a value that decides a verdict. */
export const DATASET_TABLE_HASH = "HASHPLACEHOLDER";

export const BRANDS: BrandRow[] = BRAND_ROWS.map(
  ([brand, molecule, form, atc, aware, priceInr]) => ({
    brand: DATASET_STRINGS[brand],
    molecule: DATASET_STRINGS[molecule],
    form: DATASET_STRINGS[form],
    atc: DATASET_STRINGS[atc],
    aware: DATASET_STRINGS[aware] as BrandRow["aware"],
    priceInr: Number(priceInr),
  }),
);

export const INTERACTIONS: InteractionRow[] = INTERACTION_ROWS.map(
  ([a, b, severity, mechanism, source]) => ({
    a: DATASET_STRINGS[a],
    b: DATASET_STRINGS[b],
    severity: DATASET_STRINGS[severity] as InteractionRow["severity"],
    mechanism: DATASET_STRINGS[mechanism],
    source: DATASET_STRINGS[source],
  }),
);

export const CONTRAINDICATIONS: ContraindicationRow[] = CONTRA_ROWS.map(
  ([molecule, condition, severity, note]) => ({
    molecule: DATASET_STRINGS[molecule],
    condition: DATASET_STRINGS[condition],
    severity: DATASET_STRINGS[severity] as ContraindicationRow["severity"],
    note: DATASET_STRINGS[note],
  }),
);

/**
 * Molecule groups for the combination (graph) rules. Group order is the Python
 * tier's declaration order, because both planes emit combination findings in
 * group order and a diff there is a real disagreement, not formatting.
 */
export const MOLECULE_GROUPS: Record<string, string[]> = {};
for (const [name, members] of GROUP_ROWS) {
  MOLECULE_GROUPS[DATASET_STRINGS[name]] = members.map((i) => DATASET_STRINGS[i]);
}
"""
    return (src
            .replace("BRAND_COUNTPLACEHOLDER", str(len(brands)))
            .replace("INTER_COUNTPLACEHOLDER", str(len(inter)))
            .replace("CONTRA_COUNTPLACEHOLDER", str(len(contra)))
            .replace("HASHPLACEHOLDER", h))


def write(payload: dict) -> None:
    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(build_source(payload))


# ---------------------------------------------------------------- read back
SECTIONS = {
    "pool": r"const DATASET_STRINGS: readonly string\[\] = \[\n(.*?)^];",
    "brands": r"const BRAND_ROWS: readonly BrandTuple\[\] = \[\n(.*?)^];",
    "interactions": r"const INTERACTION_ROWS: readonly InteractionTuple\[\] = \[\n(.*?)^];",
    "contraindications": r"const CONTRA_ROWS: readonly ContraindicationTuple\[\] = \[\n(.*?)^];",
    "groups": r"const GROUP_ROWS: readonly GroupTuple\[\] = \[\n(.*?)^];",
}


def parse_section(src: str, name: str) -> list:
    block = re.search(SECTIONS[name], src, re.S | re.M)
    if not block:
        raise TableError(f"the generated module lost its {name} section")
    return [json.loads(line.rstrip(",")) for line in block.group(1).split("\n") if line.strip()]


def read_generated(path: str = OUT_PATH) -> dict:
    """Decode the generated module the way the TypeScript decoder does.

    Used by --check, so a broken emitter cannot write a file that only looks
    fine, and by the API-tier drift test, so the two planes are compared on
    their *tables* rather than on a shared hash string.
    """
    src = open(path, encoding="utf-8").read()
    pool = parse_section(src, "pool")

    def str_at(index: int) -> str:
        return pool[index]

    brands = [[str_at(r[0]), str_at(r[1]), str_at(r[2]), str_at(r[3]), str_at(r[4]), r[5]]
              for r in parse_section(src, "brands")]
    inter = [[str_at(r[0]), str_at(r[1]), str_at(r[2]), str_at(r[3]), str_at(r[4])]
             for r in parse_section(src, "interactions")]
    contra = [[str_at(r[0]), str_at(r[1]), str_at(r[2]), str_at(r[3])]
              for r in parse_section(src, "contraindications")]
    groups = {str_at(g): [str_at(m) for m in members]
              for g, members in parse_section(src, "groups")}
    got = re.search(r'DATASET_TABLE_HASH = "([0-9a-f]{16})"', src)
    if not got:
        raise TableError("the generated module lost its table hash")
    counts = re.search(r"DATASET_ROW_COUNTS = \{\n(.*?)^} as const;", src, re.S | re.M)
    if not counts:
        raise TableError("the generated module lost its row counts")
    declared = {k: int(v) for k, v in re.findall(r"(\w+): (\d+)", counts.group(1))}
    return {"brands": brands, "interactions": inter, "contraindications": contra,
            "groups": groups, "hash": got.group(1), "counts": declared,
            "strings": len(pool)}


def check(payload: dict) -> int:
    if not os.path.exists(OUT_PATH):
        raise SystemExit(f"{OUT_PATH} does not exist; run python tools/build_web_dataset.py")
    want = table_hash(payload)
    got = read_generated()
    if got["hash"] != want:
        raise SystemExit(
            f"generated web dataset is stale: the module says {got['hash']}, the "
            f"source tables say {want}. Run python tools/build_web_dataset.py")
    for name in ("brands", "interactions", "contraindications", "groups"):
        if got[name] != payload[name]:
            raise SystemExit(
                f"the generated {name} section does not decode back to the source "
                f"rows ({len(got[name])} vs {len(payload[name])}); the emitter and "
                "the reader disagree")
    declared = {"brands": len(payload["brands"]),
                "interactions": len(payload["interactions"]),
                "contraindications": len(payload["contraindications"])}
    if got["counts"] != declared:
        raise SystemExit(f"DATASET_ROW_COUNTS {got['counts']} disagrees with {declared}")
    return 0


def report(payload: dict) -> None:
    from app.safety.engine import SafetyEngine, _split_molecules

    eng = SafetyEngine.load()
    mols = set()
    for row in eng.brands.values():
        mols.update(_split_molecules(row["molecule"]))
    pairs = sum(1 for k in eng.interactions_by_pair if len(k) == 2 and k <= mols)
    contras = sum(len(v) for m, v in eng.contraindications_by_molecule.items() if m in mols)
    size = os.path.getsize(OUT_PATH) if os.path.exists(OUT_PATH) else 0
    print(f"brands            {len(payload['brands']):5}   molecules nameable  {len(mols):4}")
    print(f"interactions      {len(payload['interactions']):5}   addressable       {pairs:4}")
    print(f"contraindications {len(payload['contraindications']):5}   addressable       {contras:4}")
    print(f"groups            {len(payload['groups'])}   table hash        {table_hash(payload)}")
    print(f"generated module  {size / 1024:.0f} KB at "
          f"{os.path.relpath(OUT_PATH, ROOT).replace(os.sep, '/')}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the web tier's safety tables")
    parser.add_argument("--check", action="store_true",
                        help="fail if the generated module is stale or undecodable")
    parser.add_argument("--report", action="store_true",
                        help="print counts, reachability and artifact size")
    args = parser.parse_args(argv)
    payload = build_payload()
    if args.check:
        return check(payload)
    if args.report:
        report(payload)
        return 0
    write(payload)
    check(payload)
    report(payload)
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except TableError as e:
        raise SystemExit(f"data gate: {e}") from e
    raise SystemExit(code)
