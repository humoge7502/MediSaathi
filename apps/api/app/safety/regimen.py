"""Longitudinal regimen safety state with read-uncertainty propagation.

This module extends the two-plane law from *one prescription in isolation* to the
patient's **time-composed regimen** — the set of medicines already active when a
new prescription arrives — and makes the gate operate on the *verdict* as well
as on the field.

Two mechanisms, deliberately coupled:

**A. Regimen state composition.**  The deterministic plane screens a new
prescription against the union of (a) the incoming, gated fields and (b) the
medications already active on the patient at ``as_of_day``.  Combination-class
harms that no single prescription can reveal — a triple whammy assembled from
two visits, a third QT-prolonger added later, the same molecule reached through
a different brand — become expressible.  Findings carry a ``crossing`` flag
recording whether they exist only because the two artifacts were composed.

**B. Verdict-level uncertainty propagation.**  A perception read is a
distribution, not a fact.  Each incoming field carries a mass distribution over
formulary identities: the resolved brand holds its reading confidence, and the
residual mass is spread over a *confusion neighbourhood* derived from brand
string similarity (dropping strength digits), with whatever cannot be absorbed
left as an explicit ``unknown`` mass.  Enumerating the (pruned) cross-product of
those distributions yields an exact verdict distribution.  Two derived
quantities matter:

* ``fragility`` — the mass of reads whose verdict differs from the nominal one.
  Read error could flip the decision, so the answer is not robust to it.
* ``worst_mass`` — the worst-case verdict reachable and the mass that reaches it.

The coupling is the point: **fragility above a threshold forces the confirm
queue**, so uncertainty the reader could not resolve deterministically halts
downstream automation exactly as a low-confidence field does.  A fragile read
is never reported as a confident ``pass``.

The module is deterministic (no sampling, no network) and reuses the existing
rule plane rather than re-implementing it.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from medisaathi_contracts import ExtractionField

from ..gate import CONFIRM, REFUSED, band_of, get_threshold_set
from .engine import SafetyEngine, _combination_rules, _split_atc, _split_molecules

#: verdict severity used to compare dispositions (harm order, not prevalence).
VERDICT_HARM = {"pass": 0, "duplicate_atc": 1, "interaction": 2, "contraindication": 3}

#: default stiffness of the fragility->queue coupling. A nominal verdict is only
#: published when read error has less than this mass chance of flipping it.
DEFAULT_FRAGILITY_THRESHOLD = 0.05

#: how many confusion competitors per field may enter the enumeration, and the
#: hard cap on worlds (the product is pruned by mass, never sampled).
DEFAULT_MAX_IDENTITIES = 4
MAX_WORLDS = 1024

#: similarity floor for a brand to count as a confusion neighbour of a read.
DEFAULT_SIMILARITY = 0.55


# ------------------------------------------------------------------ regimen state

@dataclass(frozen=True)
class ActiveMed:
    """One medicine already on the patient's regimen, with its active window."""

    brand: str
    molecules: tuple[str, ...]
    atc: str = ""
    daily_mg: float | None = None
    started_day: int = 0
    duration_days: int = 30
    source: str = "active-plan"

    def active_on(self, day: int) -> bool:
        return self.started_day <= day < self.started_day + self.duration_days

    def as_dict(self) -> dict:
        return {"brand": self.brand, "molecules": list(self.molecules),
                "atc": self.atc, "daily_mg": self.daily_mg,
                "started_day": self.started_day, "duration_days": self.duration_days,
                "source": self.source}


def active_med_from_row(row: dict, *, started_day: int = 0, duration_days: int = 30,
                        daily_mg: float | None = None, source: str = "active-plan") -> ActiveMed:
    """Build an ``ActiveMed`` from a formulary row (brands.csv)."""
    return ActiveMed(
        brand=row["brand"],
        molecules=tuple(_split_molecules(row["molecule"])),
        atc=row.get("atc", "") or "",
        daily_mg=daily_mg,
        started_day=started_day,
        duration_days=duration_days,
        source=source,
    )


def regimen_state(engine: SafetyEngine, entries: list[dict], *, as_of_day: int = 0) -> list[ActiveMed]:
    """Resolve raw regimen entries against the formulary, dropping unknown brands.

    ``entries`` are the shape persisted by the product tier:
    ``{"brand": ..., "started_day": ..., "duration_days": ...}``.  An unknown
    brand is skipped here — it can only *add* exposure, and the incoming
    prescription's own gate is what refuses to auto-confirm unknown reads.
    """
    out: list[ActiveMed] = []
    for e in entries:
        row = engine.normalize(e.get("brand", ""))
        if row is None:
            continue
        med = active_med_from_row(
            row,
            started_day=int(e.get("started_day", 0)),
            duration_days=int(e.get("duration_days", 30)),
            daily_mg=(float(e["daily_mg"]) if e.get("daily_mg") is not None else None),
            source=str(e.get("source", "active-plan")),
        )
        if med.active_on(as_of_day):
            out.append(med)
    return out


# ------------------------------------------------------------------ identity mass

@dataclass(frozen=True)
class IdentityCandidate:
    """One possible identity of a read field, with its probability mass."""

    brand: str
    molecules: tuple[str, ...]
    atc: str
    mass: float
    kind: str  # resolved | neighbour | unknown

    def as_dict(self) -> dict:
        return {"brand": self.brand, "molecules": list(self.molecules),
                "atc": self.atc, "mass": self.mass, "kind": self.kind}


def brand_core(brand: str) -> str:
    """Alphabetic core of a brand, strength digits/forms removed ('Levipil 500'
    -> 'levipil'). This is what look-alike confusion actually acts on."""
    core = "".join(ch for ch in (brand or "").lower() if ch.isalpha())
    return core


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        cur = [i]
        for j, cb in enumerate(b, start=1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def similarity(a: str, b: str) -> float:
    """Normalised similarity in [0, 1] over brand cores."""
    a, b = brand_core(a), brand_core(b)
    if not a or not b:
        return 0.0
    return 1.0 - levenshtein(a, b) / max(len(a), len(b))


def confusion_neighbours(engine: SafetyEngine, read_brand: str, *,
                         floor: float = DEFAULT_SIMILARITY,
                         limit: int = DEFAULT_MAX_IDENTITIES) -> list[tuple[float, dict]]:
    """Formulary brands close enough to a read to be plausible mis-reads.

    Derived from the data (brand-core string similarity), not a hand-written
    look-alike list, so the neighbourhood is auditable and moves with the
    formulary. The exact-match brand is excluded (it is the resolved candidate).
    """
    own = engine.normalize(read_brand)
    own_brand = own["brand"] if own else None
    scored: list[tuple[float, dict]] = []
    for _, row in engine.brands.items():
        if own_brand is not None and row["brand"] == own_brand:
            continue
        sim = similarity(read_brand, row["brand"])
        if sim >= floor:
            scored.append((sim, row))
    scored.sort(key=lambda kv: (-kv[0], kv[1]["brand"]))
    return scored[:limit]


def identity_distribution(engine: SafetyEngine, read_brand: str, confidence: float, *,
                          floor: float = DEFAULT_SIMILARITY,
                          max_identities: int = DEFAULT_MAX_IDENTITIES,
                          ) -> list[IdentityCandidate]:
    """Per-field distribution over formulary identities.

    * resolvable read  -> resolved brand at ``confidence``; residual
      ``1 - confidence`` spread over confusion neighbours ∝ similarity;
    * unresolvable read -> the whole confidence is residual, absorbed by
      neighbours or left as ``unknown``.
    * mass that no neighbour absorbs stays on an explicit ``unknown`` candidate
      (``molecules = ()``), which can never *add* a harm — it can only demote.
    """
    conf = 0.0 if confidence is None else max(0.0, min(1.0, float(confidence)))
    own = engine.normalize(read_brand)
    cands: list[IdentityCandidate] = []
    residual = conf
    if own is not None:
        cands.append(IdentityCandidate(
            brand=own["brand"], molecules=tuple(_split_molecules(own["molecule"])),
            atc=own.get("atc", "") or "", mass=conf, kind="resolved"))
        residual = 1.0 - conf

    neighbours = confusion_neighbours(engine, read_brand, floor=floor,
                                     limit=max_identities)
    total_sim = sum(s for s, _ in neighbours)
    absorbed = 0.0
    if total_sim > 0 and residual > 0:
        for sim, row in neighbours:
            mass = residual * (sim / total_sim)
            absorbed += mass
            cands.append(IdentityCandidate(
                brand=row["brand"], molecules=tuple(_split_molecules(row["molecule"])),
                atc=row.get("atc", "") or "", mass=mass, kind="neighbour"))

    leftover = max(0.0, residual - absorbed)
    if leftover > 1e-9:
        cands.append(IdentityCandidate(brand="", molecules=(), atc="",
                                       mass=leftover, kind="unknown"))
    # keep the highest-mass candidates, then renormalise so the field's
    # distribution sums to 1 (the pruned tail must not silently bias the result).
    cands.sort(key=lambda c: -c.mass)
    cands = cands[:max_identities]
    total = sum(c.mass for c in cands)
    if total <= 0:
        return [IdentityCandidate(brand="", molecules=(), atc="", mass=1.0, kind="unknown")]
    return [IdentityCandidate(c.brand, c.molecules, c.atc, round(c.mass / total, 9), c.kind)
            for c in cands]


# ------------------------------------------------------------------ union screening

@dataclass
class RegimenFinding:
    kind: str                 # interaction | combination | duplicate | contraindication
    molecules: tuple[str, ...]
    severity: str
    mechanism: str
    source: str
    crossing: bool            # only exists because active + incoming were composed
    mass: float               # read-mass that reaches this finding

    def as_dict(self) -> dict:
        return {"kind": self.kind, "molecules": list(self.molecules),
                "severity": self.severity, "mechanism": self.mechanism,
                "source": self.source, "crossing": self.crossing, "mass": self.mass}


def _screen_union(engine: SafetyEngine, active: list[ActiveMed],
                  incoming: list[IdentityCandidate], context: dict,
                  ) -> tuple[list[RegimenFinding], set[str]]:
    """Run the existing deterministic plane over the union of active + incoming.

    Returns ``(findings, union_molecules)``. Combination rules come from the
    same ``_combination_rules`` the single-prescription plane uses, so the two
    modes cannot drift.
    """
    active_mols: set[str] = set()
    for m in active:
        active_mols.update(m.molecules)
    incoming_mols: set[str] = set()
    for c in incoming:
        incoming_mols.update(c.molecules)
    union = active_mols | incoming_mols
    ordered = [m for m in union]

    findings: list[RegimenFinding] = []

    def crossing(mols: list[str]) -> bool:
        return any(m in active_mols for m in mols) and any(m in incoming_mols for m in mols)

    # 1. pairwise interactions over the union
    mol_list = sorted(union)
    for i in range(len(mol_list)):
        for j in range(i + 1, len(mol_list)):
            hit = engine.screen_pair(mol_list[i], mol_list[j])
            if hit:
                pair = [hit["molecule_a"].lower(), hit["molecule_b"].lower()]
                findings.append(RegimenFinding(
                    kind="interaction", molecules=tuple(pair),
                    severity=hit["severity"], mechanism=hit["mechanism"],
                    source=hit["source"], crossing=crossing(pair), mass=1.0))

    # 2. combination-class rules (pairwise-invisible)
    for f in _combination_rules(ordered):
        mols = tuple(_split_molecules(f.molecule_a)) + tuple(_split_molecules(f.molecule_b))
        findings.append(RegimenFinding(
            kind="combination", molecules=mols, severity=f.severity.value,
            mechanism=f.mechanism, source=f.source, crossing=crossing(list(mols)),
            mass=1.0))

    # 3. contraindications for the incoming identities against declared context
    for c in incoming:
        for mol in c.molecules:
            for rule in engine.contraindications_for(mol, context):
                findings.append(RegimenFinding(
                    kind="contraindication", molecules=(mol,),
                    severity=rule["severity"], mechanism=rule["note"],
                    source=rule.get("source", "curated contraindication"),
                    crossing=False, mass=1.0))

    # 4. duplicate ATC across the union (same molecule reached by a new brand)
    by_atc: dict[str, list[str]] = {}
    for med in active:
        for atc in _split_atc(med.atc):
            if atc:
                by_atc.setdefault(atc, []).append(med.brand)
    for c in incoming:
        for atc in _split_atc(c.atc):
            if atc:
                by_atc.setdefault(atc, []).append(c.brand or "unresolved read")
    for atc, brands in sorted(by_atc.items()):
        if len(brands) > 1:
            findings.append(RegimenFinding(
                kind="duplicate", molecules=tuple(sorted({b for b in brands})),
                severity="moderate",
                mechanism=f"Duplicate ATC class {atc} across the active regimen and the new prescription",
                source="ATC class table", crossing=True, mass=1.0))
    return findings, union


def _union_verdict(findings: list[RegimenFinding]) -> str:
    """Fixed precedence over the union finding stream (mirrors verdict.py)."""
    if any(f.kind == "contraindication" and f.severity == "severe" for f in findings):
        return "contraindication"
    if any(f.severity == "severe" for f in findings
           if f.kind in ("interaction", "combination")):
        return "interaction"
    if any(f.kind == "duplicate" for f in findings):
        return "duplicate_atc"
    if any(f.severity == "moderate" for f in findings
           if f.kind in ("interaction", "combination")):
        return "interaction"
    return "pass"


# ------------------------------------------------------------------ the screen

@dataclass
class RegimenScreen:
    verdict: str                       # published verdict: pass | ... | confirm_queue | refused
    nominal_verdict: str               # verdict of the highest-mass read assignment
    worst_verdict: str                 # highest-harm verdict reachable
    fragility: float                   # mass of reads whose verdict differs from nominal
    worst_mass: float                  # mass that reaches worst_verdict
    queued: bool                       # fragility forced the confirm queue
    verdict_mass: dict                 # full distribution over worlds
    findings: list[RegimenFinding]
    worlds: int
    gate_band: str                     # the incoming prescription's field-gate band
    provenance: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "verdict": self.verdict, "nominal_verdict": self.nominal_verdict,
            "worst_verdict": self.worst_verdict, "fragility": self.fragility,
            "worst_mass": self.worst_mass, "queued": self.queued,
            "verdict_mass": {k: round(v, 6) for k, v in sorted(self.verdict_mass.items())},
            "findings": [f.as_dict() for f in self.findings],
            "worlds": self.worlds, "gate_band": self.gate_band,
            "provenance": self.provenance,
        }


def _prune_worlds(dists: list[list[IdentityCandidate]]) -> list[tuple[list[IdentityCandidate], float]]:
    """Cross-product of identity distributions, pruned to the highest-mass worlds.

    Deterministic: pruning is by mass then by brand name, never random. The
    surviving worlds' masses are renormalised, and the dropped mass is recorded
    by the caller as residual uncertainty.
    """
    worlds: list[tuple[list[IdentityCandidate], float]] = [([], 1.0)]
    for dist in dists:
        nxt: list[tuple[list[IdentityCandidate], float]] = []
        for chosen, mass in worlds:
            for cand in dist:
                nxt.append(([*chosen, cand], mass * cand.mass))
        nxt.sort(key=lambda w: (-w[1], tuple(c.brand for c in w[0])))
        worlds = nxt[:MAX_WORLDS]
    total = sum(m for _, m in worlds)
    if total <= 0:
        return [([], 1.0)]
    return [(w, m / total) for w, m in worlds]


def screen_regimen(engine: SafetyEngine, fields: list[ExtractionField],
                   active: list[ActiveMed], context: dict | None = None, *,
                   as_of_day: int = 0,
                   fragility_threshold: float = DEFAULT_FRAGILITY_THRESHOLD,
                   similarity_floor: float = DEFAULT_SIMILARITY,
                   max_identities: int = DEFAULT_MAX_IDENTITIES,
                   propagate: bool = True,
                   threshold_set_id: str | None = None,
                   ) -> RegimenScreen:
    """Screen an incoming prescription against the patient's active regimen.

    ``propagate=False`` is the ablation switch that isolates mechanism B: the
    regimen is composed exactly as before but each field is treated as certain
    (its resolved identity), so no fragility can be computed. Product code never
    sets it.
    """
    thresholds = get_threshold_set(threshold_set_id)
    context = {k: bool(v) for k, v in (context or {}).items()}

    # The field gate runs first and unchanged: refusal/queue semantics on the
    # incoming prescription are preserved bit-for-bit from the single-Rx law.
    _report, confirm_items, _all_verified = engine.run(
        fields, context, threshold_set_id=thresholds.set_id)
    bands = [band_of(f.confidence, engine.normalize(f.brand_text or f.raw_text) is not None,
                     thresholds) for f in fields]
    if bands and all(b.band == REFUSED for b in bands):
        gate_band = REFUSED
    elif any(b.band in (REFUSED, CONFIRM) for b in bands):
        gate_band = CONFIRM
    else:
        gate_band = "auto"

    dists = [
        identity_distribution(engine, (f.brand_text or f.raw_text), f.confidence,
                              floor=similarity_floor, max_identities=max_identities)
        if propagate else _certain_identity(engine, (f.brand_text or f.raw_text), f.confidence)
        for f in fields
    ]

    verdict_mass: dict[str, float] = {}
    worlds = _prune_worlds(dists) if dists else [([], 1.0)]
    findings_by_world: list[list[RegimenFinding]] = []
    for chosen, mass in worlds:
        # unknown-mass candidates carry no molecules and so can only demote
        findings, _union = _screen_union(engine, active, list(chosen), context)
        findings_by_world.append(findings)
        v = _union_verdict(findings)
        verdict_mass[v] = verdict_mass.get(v, 0.0) + mass

    nominal_idx = max(range(len(worlds)), key=lambda i: (worlds[i][1],
                                                         VERDICT_HARM[verdict_of(findings_by_world[i])]))
    nominal_verdict = _union_verdict(findings_by_world[nominal_idx])
    fragility = round(1.0 - worlds[nominal_idx][1], 6)
    worst_verdict = max(verdict_mass, key=lambda v: (VERDICT_HARM[v], verdict_mass[v]))
    worst_mass = round(verdict_mass[worst_verdict], 6)

    # The published finding stream is the union of the nominal world's findings
    # (the read we actually believe), each tagged with its reach across worlds.
    findings = _annotate_mass(findings_by_world, worlds)

    # The coupling, stated precisely: uncertainty forces a human only when it
    # could *hide* harm — i.e. the nominal verdict is less harmful than one the
    # read uncertainty can still reach. If the harmonic verdict is already the
    # worst reachable one, the harm is surfaced regardless of the read, so an
    # extra queue would buy nothing and would tax the reviewer for no reason.
    could_hide_harm = VERDICT_HARM[worst_verdict] > VERDICT_HARM[nominal_verdict]
    queued = gate_band == CONFIRM or (
        propagate and fragility > fragility_threshold and could_hide_harm)

    if gate_band == REFUSED:
        published = "refused"
    elif queued:
        published = "confirm_queue"
    else:
        published = nominal_verdict

    provenance = {
        "mode": "regimen+propagation" if propagate else "regimen-only (ablation B)",
        "threshold_set_id": thresholds.set_id,
        "fragility_threshold": fragility_threshold,
        "could_hide_harm": could_hide_harm,
        "similarity_floor": similarity_floor,
        "active_count": len(active),
        "as_of_day": as_of_day,
        "field_decisions_band": gate_band,
        "queue_items_from_field_gate": len(confirm_items),
    }
    return RegimenScreen(
        verdict=published, nominal_verdict=nominal_verdict, worst_verdict=worst_verdict,
        fragility=fragility, worst_mass=worst_mass, queued=queued,
        verdict_mass=verdict_mass, findings=findings, worlds=len(worlds),
        gate_band=gate_band, provenance=provenance)


def verdict_of(findings: list[RegimenFinding]) -> str:
    return _union_verdict(findings)


def _certain_identity(engine: SafetyEngine, read_brand: str, confidence: float,
                      ) -> list[IdentityCandidate]:
    """Ablation-B identity: the resolved brand only (no confusion mass)."""
    own = engine.normalize(read_brand)
    if own is None:
        return [IdentityCandidate(brand="", molecules=(), atc="", mass=1.0, kind="unknown")]
    return [IdentityCandidate(brand=own["brand"],
                              molecules=tuple(_split_molecules(own["molecule"])),
                              atc=own.get("atc", "") or "", mass=1.0, kind="resolved")]


def _annotate_mass(findings_by_world: list[list[RegimenFinding]],
                   worlds: list[tuple[list[IdentityCandidate], float]],
                   ) -> list[RegimenFinding]:
    """Merge findings across worlds, summing the read-mass that reaches each.

    Findings are keyed by (kind, mechanism) so a rule that fires in more read
    assignments accumulates more mass — that is the "how robust is this finding
    to the read?" number the verdict interval needs.
    """
    merged: dict[tuple[str, str], RegimenFinding] = {}
    for findings, (_chosen, mass) in zip(findings_by_world, worlds, strict=False):
        for f in findings:
            key = (f.kind, f.mechanism)
            cur = merged.get(key)
            if cur is None:
                merged[key] = RegimenFinding(
                    f.kind, f.molecules, f.severity, f.mechanism, f.source,
                    f.crossing, round(mass, 6))
            else:
                merged[key] = RegimenFinding(
                    cur.kind, cur.molecules, cur.severity, cur.mechanism,
                    cur.source, cur.crossing, round(cur.mass + mass, 6))
    order = {"contraindication": 0, "combination": 1, "interaction": 2, "duplicate": 3}
    return sorted(merged.values(), key=lambda f: (order.get(f.kind, 9), -f.mass, f.mechanism))
