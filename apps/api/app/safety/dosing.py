"""Deterministic dose arithmetic and plausibility warnings.

Zero network, zero model. These rules exist to catch the failure mode
confidence alone cannot: a text line that was read *perfectly* but describes a
dangerous regimen (double paracetamol, TDS on an OD brand). Every warning is a
note for the human, never a verdict by itself.
"""
from __future__ import annotations

import re

from medisaathi_contracts import ExtractionField

DAILY_CAPS_MG = {
    "paracetamol": 4000.0,
    "ibuprofen": 1200.0,      # OTC cap; prescription cap is higher
    "diclofenac": 150.0,
    "aspirin": 4000.0,
    "tramadol": 400.0,
    "pregabalin": 600.0,
    "metformin": 3000.0,
    "levothyroxine": 0.3,
}

_DUR_RE = re.compile(r"(\d+)\s*day", re.I)

_DOSE_PER_DAY = {
    "OD": 1, "HS": 1, "QHS": 1, "BD": 2, "TDS": 3, "QID": 4, "SOS": 1,
}


def parse_frequency_per_day(freq: str) -> int | None:
    """TAC code 1-0-1 -> 2; BD -> 2; unknown -> None. Deterministic."""
    freq = (freq or "").strip()
    m = re.fullmatch(r"(\d+)\s*-\s*(\d+)\s*-\s*(\d+)", freq)
    if m:
        return sum(int(g) for g in m.groups())
    word = _DOSE_PER_DAY.get(freq.upper())
    if word:
        return word
    total = sum(int(x) for x in re.findall(r"\d+", freq))
    return total or None


def daily_dose_mg(field: ExtractionField) -> float | None:
    """strength (or dose) mg x occurrences per day, when both parse."""
    strength_txt = field.strength or field.dose
    m = re.search(r"(\d+(?:\.\d+)?)\s*mg", (strength_txt or "").lower())
    if not m:
        return None
    per_occurrence = float(m.group(1))
    per_day = parse_frequency_per_day(field.frequency)
    if per_day is None:
        return None
    return per_occurrence * per_day


def dose_warning(field: ExtractionField, molecule: str | None = None) -> str | None:
    """Return a human-readable warning, or None when the regimen parses clean.
    `molecule` (normalized, e.g. "paracetamol") sharpens cap matching; without
    it the rule falls back to brand-name heuristics."""
    mol_txt = ((molecule or "") + " " + (field.brand_text or "")).lower()
    strength_txt = (field.strength or field.dose or "").lower()

    # 1) TAC code sanity: any position > 2 occurrences at once is odd.
    m = re.fullmatch(r"(\d+)\s*-\s*(\d+)\s*-\s*(\d+)", (field.frequency or "").strip())
    if m and any(int(g) > 2 for g in m.groups()):
        return f"unusual frequency {field.frequency} - verify with the prescriber"

    # 2) Daily-dose cap check (needs mg + frequency).
    daily = daily_dose_mg(field)
    if daily is not None:
        for mol, cap in DAILY_CAPS_MG.items():
            if mol in mol_txt and daily > cap:
                return (f"computed daily dose {daily:g} mg exceeds the "
                        f"{mol} cap of {cap:g} mg/day")

    # 3) Long paracetamol courses without review.
    if "paracetamol" in mol_txt:
        dm = _DUR_RE.search(field.duration or "")
        if dm and int(dm.group(1)) > 10:
            return f"paracetamol for {dm.group(1)} days - pharmacist review advised"
    return None
