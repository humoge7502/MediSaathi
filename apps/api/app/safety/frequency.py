"""The administration-interval law — one definition of what a frequency code means.

A frequency code carries two independent facts:

  * ``doses_per_day`` — how many administrations on an *administration day*
  * ``interval_days`` — how many calendar days between administration days

Collapsing the two into a single "doses per day" float is what allowed a weekly
drug to be scheduled daily: ``0.14 doses/day`` renders as one slot every day in
any generator that iterates over days. The axes stay separate here so the
scheduler, the dose-cap arithmetic and the parity corpus all read one truth.

Unknown codes resolve to ``None``. The caller must then route the line to the
confirm queue; defaulting an unread frequency to once-daily would invent a
schedule the prescription never asked for, which is the failure mode the whole
gate law exists to prevent.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Frequency:
    """One normalized frequency code."""

    code: str
    doses_per_day: int
    interval_days: int = 1
    #: taken when needed, on no fixed clock — must never generate slots
    as_needed: bool = False
    #: one administration total, then the schedule ends
    single: bool = False

    @property
    def daily_factor(self) -> float:
        """Doses per calendar day, exact (1/7 for weekly, not 0.14)."""
        if self.as_needed or self.single:
            return float(self.doses_per_day)
        return self.doses_per_day / self.interval_days

    @property
    def is_interval(self) -> bool:
        return self.interval_days > 1


_DAILY: dict[str, int] = {
    "OD": 1, "QD": 1, "Q.D.": 1, "Q.D": 1, "ONCE DAILY": 1, "1X DAILY": 1,
    "ONCE A DAY": 1, "ONE TIME DAILY": 1, "1 TIME DAILY": 1,
    "DAILY": 1, "EVERY DAY": 1, "ONCE EVERY DAY": 1,
    "HS": 1, "QHS": 1, "AT BEDTIME": 1,
    "BD": 2, "BID": 2, "B.D.": 2, "TWICE DAILY": 2, "1-0-1": 2, "1+0+1": 2,
    "TWICE A DAY": 2, "TWICE EVERY DAY": 2,
    "TDS": 3, "TID": 3, "T.D.S": 3, "THRICE DAILY": 3, "1-1-1": 3,
    "THREE TIMES A DAY": 3,
    "QID": 4, "Q.I.D.": 4, "FOUR TIMES DAILY": 4, "1-1-1-1": 4,
    "TWO TIMES DAILY": 2, "THREE TIMES DAILY": 3, "2 TIMES DAILY": 2,
    "3 TIMES DAILY": 3, "4 TIMES DAILY": 4,
    "1-0-0": 1, "1-0-1-0": 2, "1-1-0": 2, "0-0-1": 1, "0-1-1": 2,
}

#: code -> (doses per administration day, days between administration days)
_INTERVAL: dict[str, tuple[int, int]] = {
    "QOD": (1, 2), "ALT": (1, 2), "EVERY OTHER DAY": (1, 2), "1-0-0-1-0-0": (1, 2),
    "ALTERNATE DAYS": (1, 2), "ALTERNATE DAY": (1, 2), "ON ALTERNATE DAYS": (1, 2),
    "QWK": (1, 7), "QW": (1, 7), "WK": (1, 7), "WEEKLY": (1, 7),
    "1X WEEKLY": (1, 7), "ONCE WEEKLY": (1, 7), "7D": (1, 7),
    "ONCE A WEEK": (1, 7), "EVERY WEEK": (1, 7), "ONCE EVERY WEEK": (1, 7),
    "BIW": (2, 7), "TWICE WEEKLY": (2, 7),
    "Q2W": (1, 14), "EVERY 2 WEEKS": (1, 14), "14D": (1, 14), "BIWEEKLY": (1, 14),
    "Q3W": (1, 21), "EVERY 3 WEEKS": (1, 21),
    "QM": (1, 30), "MONTHLY": (1, 30), "OM": (1, 30), "EVERY MONTH": (1, 30),
    "30D": (1, 30), "ONCE MONTHLY": (1, 30), "ONCE A MONTH": (1, 30),
}

#: one administration, then stop.
_SINGLE = {"STAT", "ST", "IMMEDIATELY", "ONCE", "ONE DOSE", "SINGLE DOSE", "X1"}

#: as-needed / no fixed clock.
_AS_NEEDED = {"SOS", "PRN", "AS NEEDED", "WHENEVER REQUIRED", "NEED DOSE"}

#: Bedtime-dosing synonyms, canonicalized to HS so the scheduler puts the dose
#: at night instead of at 09:00. Indian prescriptions write all three.
_BEDTIME = {"AT NIGHT", "NOCTE", "NIGHTLY", "AT BEDTIME", "BEDTIME"}

#: A TAC slot code at the start of a frequency string, and whatever qualifies it:
#: "0-0-1" alone, or "0-0-1 weekly", where the code names the hours of the day and
#: the words name the interval between administration days. `parse_frequency`
#: composes the two instead of reading the code and dropping the qualifier.
_TAC_HEAD_RE = re.compile(r"^(\d+(?:\s*[-+.]\s*\d+){1,3})\s*(.*)$")
#: prose intervals. Days, weeks and months all appear on Indian prescriptions
#: ("every 3 days", "q 4 weeks", "every 2 months"), and a parser that only
#: understands days silently drops the other two — the line then carries no
#: frequency at all, so no interval rule can fire.
_EVERY_RE = re.compile(
    r"(?:every|q)\s*(\d+)\s*(days?|d\b|weeks?|w\b|months?|mo\b|m\b)", re.I)
_EVERY_UNIT_DAYS = {"d": 1, "day": 1, "days": 1, "w": 7, "week": 7, "weeks": 7,
                    "m": 30, "mo": 30, "month": 30, "months": 30}


def parse_frequency(freq: str | None) -> Frequency | None:
    """Resolve a raw frequency token, or ``None`` when it is not legible.

    Accepts Latin abbreviations (OD/TDS), TAC-style codes (1-0-1), and explicit
    intervals ("every 7 days"). Whitespace, case and trailing punctuation are
    insignificant. Anything unrecognised returns None so the caller queues the
    line instead of inventing a schedule.
    """
    raw = (freq or "").strip()
    if not raw:
        return None
    key = " ".join(raw.upper().replace("\u00a0", " ").split()).rstrip(".")
    if key.endswith("."):  # "Q.D." -> keep the dotted form in the table, strip once
        key = key[:-1]
    if key in _BEDTIME:
        key = "HS"

    if key in _SINGLE:
        return Frequency(key, 1, single=True)
    if key in _AS_NEEDED:
        return Frequency(key, 1, as_needed=True)

    if key in _DAILY:
        return Frequency(key, _DAILY[key])
    if key in _INTERVAL:
        n, gap = _INTERVAL[key]
        return Frequency(key, n, interval_days=gap)

    # TAC codes: 1-0-1, 1-1-1, 2-0-1. Sum is the count on an administration day.
    # Tried BEFORE the prose interval: "1-1-0 every 3 weeks" contains prose an
    # interval-only read would match first and report as ONE dose a day, because
    # the search never sees that the leading code already answered that question.
    tac = _TAC_HEAD_RE.match(raw.replace("\u00a0", " ").strip())
    if tac:
        head, qualifier = tac.group(1), tac.group(2).strip(" .")
        parts = [int(x) for x in re.findall(r"\d+", head)][:4]
        # A TAC slot count is a single small digit. "75-1-0" is a dose glued to
        # the code, not a regimen: reading it as a frequency would invent 76
        # administrations a day, so it is unlegible and goes to the queue.
        if any(p > 6 for p in parts):
            return None
        total = sum(parts)
        if total == 0:
            return None
        if not qualifier:
            return Frequency(key, total)
        # A slot code says WHICH hours of the day; the word after it says how
        # often that day comes around. "0-0-1 weekly" — the way a correct weekly
        # course is actually written on an Indian prescription — is one dose at
        # bedtime once a week, and reading the code alone scheduled it daily:
        # the interval law then flagged a prescription that was right.
        sub = parse_frequency(qualifier)
        if sub is None:
            return None
        if sub.as_needed or sub.single:
            return sub
        return Frequency(key, total, interval_days=sub.interval_days)

    # "every 7 days" / "q 3 weeks" / "every 2 months" style interval prose.
    m = _EVERY_RE.search(raw)
    if m:
        factor = _EVERY_UNIT_DAYS.get(m.group(2).lower())
        gap = int(m.group(1)) * factor if factor else 0
        if 1 <= gap <= 180:
            return Frequency(key, 1, interval_days=gap)

    # "4 hourly" / "6th hourly" / "q6h" -> doses per day from the hour gap.
    hm = re.fullmatch(r"(?:q\s*)?(\d+)\s*(?:hourly|hr\.?|h|hours?)", key, re.I)
    if hm:
        gap_h = int(hm.group(1))
        if gap_h >= 1 and 24 % gap_h == 0:
            return Frequency(key, max(1, 24 // gap_h))

    return None


def frequency_per_day(freq: str | None) -> float | None:
    """Doses per calendar day (fractional for interval codes).

    Backwards-compatible shim for callers that only need the rate. Returns
    ``None`` for illegible codes — never a guessed 1.0.
    """
    f = parse_frequency(freq)
    return None if f is None else f.daily_factor
