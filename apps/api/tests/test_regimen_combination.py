"""Combination granularity in the longitudinal plane.

The nominal screen learned to match a medication's *whole combination identity*
in addition to each component; this file pins that the regimen screen does the
same over the visit boundary, from the same law, and that it therefore cannot
invent a harm the single-prescription plane denies (ADR-0012 is one engine, not
two that happen to agree today).

Measured against the loaded tables, not assumed: 176 interaction rows and 17
contraindication rows are keyed on a whole combination, and 89 of the interaction
rows have no component-level counterpart at all — for those, the pair a patient
actually took was documented and simply never read.
"""
from __future__ import annotations

import pytest
from app.safety.engine import SafetyEngine, _molecule_identities, _split_molecules
from app.safety.regimen import (
    ActiveMed,
    _identities_of,
    _screen_union,
    active_med_from_row,
    identity_distribution,
    screen_regimen,
)
from app.verdict import assemble
from medisaathi_contracts import ExtractionField, ExtractionResult


@pytest.fixture(scope="module")
def engine() -> SafetyEngine:
    return SafetyEngine.load()


def _fields(*pairs: tuple[str, float]) -> list[ExtractionField]:
    return [ExtractionField(raw_text=b, brand_text=b, confidence=c) for b, c in pairs]


def _active(engine: SafetyEngine, *brands: str) -> list[ActiveMed]:
    out = []
    for b in brands:
        row = engine.normalize(b)
        assert row is not None, f"fixture brand not in formulary: {b}"
        out.append(active_med_from_row(row))
    return out


def _single_rx(engine: SafetyEngine, fields: list[ExtractionField],
               context: dict | None = None) -> str:
    report, items, _ = engine.run(fields, context or {})
    kind = assemble(engine, ExtractionResult(sample_id="t", fields=fields),
                    report, items).kind.value
    return "pass" if kind == "pass_" else kind


# -------------------------------------------------------------- one identity law


def test_the_two_screens_share_one_identity_law(engine: SafetyEngine) -> None:
    """``_identities_of`` is the same law as ``_molecule_identities``, not a cousin.

    The regimen plane carries already-split tuples where the nominal plane
    carries the raw catalog cell, so it needs its own function — which is exactly
    how a second implementation starts to drift. Every brand row in the catalog
    is fed through both, so a future change on one side fails here.
    """
    offenders = []
    for row in engine.brands.values():
        cell = row["molecule"]
        split = _split_molecules(cell)
        if _identities_of(tuple(split)) != _molecule_identities(cell):
            offenders.append((row["brand"], cell))
    assert not offenders, f"identity law diverged on {len(offenders)} rows: {offenders[:5]}"
    # the shape of the law itself
    assert _identities_of(("artemether", "lumefantrine")) == [
        "artemether", "lumefantrine", "artemether+lumefantrine"]
    assert _identities_of(("aspirin",)) == ["aspirin"], "a single drug has one identity"


# --------------------------------------------------- harms that cross two visits

@pytest.mark.parametrize(("active_brand", "incoming", "whole", "verdict"), [
    # A new anticonvulsant meets an antibiotic the patient is already taking.
    # The row is "sodium valproate x imipenem+cilastatin" and there is no
    # valproate x imipenem or valproate x cilastatin row to fall back on.
    ("Cilanem 500", "Encorate Chrono 300", "imipenem+cilastatin", "interaction"),
    # Ramping the enzyme-inducer against a combined oral contraceptive: the
    # failure (unintended pregnancy) is documented on the combination, not on
    # either hormone alone.
    ("Duoluton-L", "Carbamazepine 200", "ethinylestradiol+levonorgestrel", "interaction"),
    # Two QT-prolonging courses from two visits, one of them a fixed combination.
    ("Lumether 80/480", "Cordarone 200", "artemether+lumefantrine", "interaction"),
])
def test_a_combination_harm_crossing_two_visits_is_caught(
    engine: SafetyEngine, active_brand: str, incoming: str, whole: str, verdict: str
) -> None:
    active = _active(engine, active_brand)
    fields = _fields((incoming, 0.97))
    # The incumbent law sees one drug and passes it.
    assert _single_rx(engine, fields) == "pass", (
        f"{incoming} alone should not be the finding — the harm is the composition")
    screen = screen_regimen(engine, fields, active)
    assert screen.verdict == verdict
    hits = [f for f in screen.findings if whole in f.molecules]
    assert hits, f"no finding names the whole combination {whole}: {screen.findings}"
    assert any(f.crossing for f in hits), (
        f"{whole} reached only inside one side of the visit boundary")


def test_an_absolute_combination_contraindication_reaches_the_regimen_screen(
    engine: SafetyEngine
) -> None:
    """artemether+lumefantrine is contraindicated in pregnancy — at combination
    granularity. Walking components would look up "artemether" and "lumefantrine"
    and find nothing, which is how a first-trimester course passes review."""
    fields = _fields(("Lumether 80/480", 0.97))
    screen = screen_regimen(engine, fields, [], {"pregnancy": True})
    assert screen.verdict == "contraindication"
    kinds = {(f.kind, f.molecules, f.severity) for f in screen.findings}
    assert ("contraindication", ("artemether+lumefantrine",), "severe") in kinds, kinds
    # and the same read with no declared pregnancy is not a contraindication:
    # the rule is context-driven, not always-on.
    assert screen_regimen(engine, fields, [], {}).verdict == "pass"


# ------------------------------------------------------------------ screen laws

def test_one_finding_per_documented_row(engine: SafetyEngine) -> None:
    """A combination brand meets its partner through three identities (component,
    component, whole) against three documented rows. Each row is a mechanism; the
    reviewer is not shown the same card twice, and is shown all three once."""
    active = _active(engine, "Augmentin 625")
    incoming = list(identity_distribution(engine, "Folitrax 10", 0.97))
    findings, _union = _screen_union(engine, active, incoming, {})
    pairs = [f.molecules for f in findings if f.kind == "interaction"]
    assert len(pairs) == len({frozenset(p) for p in pairs}), pairs
    assert ("amoxicillin+clavulanic acid", "methotrexate") in {tuple(sorted(p)) for p in pairs}


def test_a_brand_never_interacts_with_its_own_halves(engine: SafetyEngine) -> None:
    """A pooled molecule walk pairs everything with everything, including the
    components of one fixed-dose combination. Four catalog rows carry an internal
    documented pair, so the regimen plane reported a self-interaction the nominal
    plane refuses to report — same patient, two answers."""
    brand = ("Jan Aushadhi Benedipine (4mg) + Telmisartan (40mg) + "
             "Chlorthalidone (6.25mg) Tablets")
    row = engine.normalize(brand)
    assert row is not None, "fixture brand left the formulary"
    comps = _split_molecules(row["molecule"])
    assert comps == ["telmisartan", "chlorthalidone"]
    assert engine.screen_pair(*comps) is not None, (
        "this test is only worth keeping while the internal pair is documented")
    screen = screen_regimen(engine, _fields(("Cetzine 10", 0.97)), _active(engine, brand))
    self_pairs = [f for f in screen.findings
                  if f.kind == "interaction" and set(f.molecules) == set(comps)]
    assert not self_pairs, f"one brand reported an interaction with itself: {self_pairs}"
    assert screen.verdict == "pass", screen.findings


def test_reachability_measured_not_assumed(engine: SafetyEngine) -> None:
    """The count that justified the change, recomputed from the shipped tables.

    176 interaction rows are keyed on a whole combination; 89 of them have no
    component-level counterpart for the same partner, so a component-only walk
    could not have reached them from any brand pair in the catalog.
    """
    combo_rows = [r for r in engine.interactions
                  if "+" in r["molecule_a"] or "+" in r["molecule_b"]]
    assert len(combo_rows) == 176, len(combo_rows)
    carrier = {i for row in engine.brands.values()
               for i in _molecule_identities(row["molecule"]) if "+" in i}
    unreachable_wholes = {r["molecule_a"].lower() for r in combo_rows if "+" in r["molecule_a"]} \
        | {r["molecule_b"].lower() for r in combo_rows if "+" in r["molecule_b"]}
    assert unreachable_wholes <= carrier, (
        f"combination rows keyed on a name no brand carries: {unreachable_wholes - carrier}")
    orphan = 0
    for r in combo_rows:
        a, b = r["molecule_a"].lower(), r["molecule_b"].lower()
        big, small = (a, b) if "+" in a else (b, a)
        if "+" in a and "+" in b:
            orphan += 1
            continue
        if not any(engine.screen_pair(comp, small) for comp in _split_molecules(big)):
            orphan += 1
    assert orphan == 89, orphan
    assert len([c for c in engine.contraindications if "+" in c["molecule"]]) == 17
