"""The web tier's table is the API tier's table (ADR-0012, task TD-9).

`apps/web/src/lib/safety/tables.generated.ts` is compiled from `data/*.csv` by
tools/build_web_dataset.py. This test decodes that module and compares it, row
by row, with what `SafetyEngine.load()` built from the same CSVs. It exists
because the product tier used to carry a 99-brand hand-copied formulary while the
API tier decided over 2 836, and every gate stayed green: parity only names
brands the small copy happened to hold, so the drift was invisible rather than
absent. A shared hash string would not have caught that either — the point is
that the two planes must agree on the *rows*, not on a claim.

Run: python -m pytest apps/api/tests/test_web_dataset.py -q
"""
from __future__ import annotations

import importlib.util
import os
import sys

HERE = os.path.abspath(os.path.dirname(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "apps", "api"))
sys.path.insert(0, os.path.join(ROOT, "packages", "contracts"))

from app.safety.engine import (  # noqa: E402
    CONTRA_SEV_MAP,
    MOLECULE_GROUPS,
    SafetyEngine,
    _split_molecules,
)


def _load_builder():
    """Import tools/build_web_dataset.py by path (tools/ is not a package)."""
    path = os.path.join(ROOT, "tools", "build_web_dataset.py")
    spec = importlib.util.spec_from_file_location("build_web_dataset", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


BUILD = _load_builder()
PAYLOAD = BUILD.build_payload()
GENERATED = BUILD.read_generated()


def _brand_index(rows: list[list]) -> dict[str, tuple]:
    return {BUILD.norm_key(r[0]): tuple(r) for r in rows}


def test_generated_module_is_not_stale() -> None:
    """The committed artifact says the same hash the source tables compute."""
    assert GENERATED["hash"] == BUILD.table_hash(PAYLOAD), (
        "apps/web/src/lib/safety/tables.generated.ts is stale: run "
        "python tools/build_web_dataset.py")
    assert GENERATED["counts"] == {
        "brands": len(PAYLOAD["brands"]),
        "interactions": len(PAYLOAD["interactions"]),
        "contraindications": len(PAYLOAD["contraindications"]),
    }, "DATASET_ROW_COUNTS does not match the source tables"


def test_both_planes_load_the_same_formulary() -> None:
    eng = SafetyEngine.load()
    assert len(GENERATED["brands"]) == len(eng.brands), (
        f"web tier has {len(GENERATED['brands'])} brands, API tier has "
        f"{len(eng.brands)} — the generator is stale or a row is unreachable")

    web = _brand_index(GENERATED["brands"])
    api = {key: (row["brand"], "+".join(_split_molecules(row["molecule"])),
                 row["form"].strip(), row["atc"].strip(),
                 row["aware_class"].strip(), f"{row['jas_price_inr']:.2f}")
           for key, row in eng.brands.items()}
    assert web.keys() == api.keys(), (
        "brand keys differ between planes: "
        f"web-only {sorted(web.keys() - api.keys())[:5]}, "
        f"api-only {sorted(api.keys() - web.keys())[:5]}")
    # One row at a time, so a mismatch names the drug instead of the table.
    bad = [key for key in web if web[key] != api[key]]
    assert not bad, f"formulary rows differ between planes: {bad[:5]}"


def test_both_planes_load_the_same_interaction_pairs() -> None:
    eng = SafetyEngine.load()
    web_pairs = {frozenset((r[0], r[1])): r[2] for r in GENERATED["interactions"]}
    api_pairs = {pair: row["severity"].strip().lower()
                 for pair, row in eng.interactions_by_pair.items()}
    assert web_pairs.keys() == api_pairs.keys(), (
        f"pair keys differ (web {len(web_pairs)}, api {len(api_pairs)})")
    assert all(web_pairs[p] == api_pairs[p] for p in web_pairs), (
        "an interaction pair carries a different severity in the two planes")


def test_both_planes_load_the_same_contraindications() -> None:
    eng = SafetyEngine.load()
    web: dict[tuple, int] = {}
    for molecule, condition, severity, _note in GENERATED["contraindications"]:
        # The data says absolute|relative; the API engine rewrites its own rows
        # to the finding vocabulary at load (CONTRA_SEV_MAP) and the web engine
        # does the same mapping per finding. Both are correct; compare after
        # applying it here, so a genuinely missing rule still fails.
        key = (molecule, condition, CONTRA_SEV_MAP.get(severity, severity))
        web[key] = web.get(key, 0) + 1
    api: dict[tuple, int] = {}
    for rules in eng.contraindications_by_molecule.values():
        for row in rules:
            key = (row["molecule"].strip().lower(), row["condition_code"].strip(),
                   row["severity"].strip().lower())
            api[key] = api.get(key, 0) + 1
    assert web == api, (
        f"contraindication rules differ between planes: "
        f"web-only {sorted(set(web) - set(api))[:3]}, "
        f"api-only {sorted(set(api) - set(web))[:3]}")


def test_both_planes_share_the_graph_rule_membership() -> None:
    assert GENERATED["groups"] == {g: list(m) for g, m in MOLECULE_GROUPS.items()}, (
        "MOLECULE_GROUPS differ — combination findings would be emitted in a "
        "different order, or with different members, in one plane")


def test_combination_granularity_survives_the_compile() -> None:
    """176 interaction rows and 17 contraindication rows are documented for a
    combination, not its components. If the compiler split them, the rule is
    destroyed while the count still looks right — so count them here."""
    combo_pairs = [r for r in GENERATED["interactions"]
                   if "+" in r[0] or "+" in r[1]]
    combo_contras = [r for r in GENERATED["contraindications"] if "+" in r[0]]
    assert len(combo_pairs) >= 170, f"only {len(combo_pairs)} combination-keyed pairs"
    assert len(combo_contras) >= 15, f"only {len(combo_contras)} combination-keyed contras"
    # and they are reachable: the engine screens `moleculeIdentities()`, which
    # includes the joined combination string
    eng = SafetyEngine.load()
    a, b = combo_pairs[0][0], combo_pairs[0][1]
    assert eng.screen_pair(a, b) is not None, f"{a} + {b} unreadable after compile"


def test_display_names_are_whitespace_clean_in_both_planes() -> None:
    """The catalog carries U+00A0 in 11 brand names. Both planes fold it — the
    generator at build time, apps/api at load — so a verdict cannot name one
    drug two ways depending on which engine answered."""
    web_names = [row[0] for row in GENERATED["brands"]]
    api_names = [row["brand"] for row in SafetyEngine.load().brands.values()]
    for display in web_names + api_names:
        assert display == " ".join(display.split()), repr(display)
    assert sorted(web_names) == sorted(api_names), (
        "the two planes spell the formulary differently")
