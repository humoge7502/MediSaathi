"""Calibration and operating-point selection (MED-008 / experiment E-D).

Answers the question the thresholds 0.75 / 0.90 must answer to be patent
evidence rather than a guess: **is the confidence the system reports worth
anything, and does some operating point on that confidence beat the others on
the safety-burden curve?**

    ECE / Brier / reliability curve   -- is the fused score calibrated?
    threshold sweep 0.60-0.95         -- unsafe-auto-confirm rate vs queue rate
    operating-point selection         -- zero unsafe auto-confirms at the
                                          lowest human-review burden

Everything is deterministic and offline; the sweep runs the real Python plane
through the real gate module.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from app.gate import FusionWeights, ThresholdSet, register_threshold_set

# ------------------------------------------------------------------ metrics

def wilson_interval(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval for a proportion — honest CIs on small corpora."""
    if n == 0:
        return (0.0, 0.0)
    phat = successes / n
    denom = 1 + z * z / n
    centre = phat + z * z / (2 * n)
    spread = z * math.sqrt(phat * (1 - phat) / n + z * z / (4 * n * n))
    return (round(max(0.0, (centre - spread) / denom), 4),
            round(min(1.0, (centre + spread) / denom), 4))


def brier_score(confidences: list[float], correct: list[bool]) -> float:
    if not confidences:
        return 0.0
    return round(sum((c - (1.0 if ok else 0.0)) ** 2
                     for c, ok in zip(confidences, correct, strict=True))
                 / len(confidences), 4)


def reliability_curve(confidences: list[float], correct: list[bool],
                      n_bins: int = 10) -> list[dict]:
    """Equal-width bins of predicted confidence with empirical accuracy."""
    bins: list[dict] = []
    for i in range(n_bins):
        lo, hi = i / n_bins, (i + 1) / n_bins
        idx = [j for j, c in enumerate(confidences)
               if (lo <= c < hi) or (i == n_bins - 1 and c >= hi)]
        if not idx:
            bins.append({"lo": round(lo, 2), "hi": round(hi, 2), "n": 0,
                         "mean_confidence": None, "accuracy": None})
            continue
        bins.append({
            "lo": round(lo, 2), "hi": round(hi, 2), "n": len(idx),
            "mean_confidence": round(sum(confidences[j] for j in idx) / len(idx), 4),
            "accuracy": round(sum(1 for j in idx if correct[j]) / len(idx), 4),
        })
    return bins


def expected_calibration_error(confidences: list[float], correct: list[bool],
                               n_bins: int = 10) -> float:
    """ECE = sum over bins of (n_bin / n) * |accuracy - mean confidence|."""
    if not confidences:
        return 0.0
    total = len(confidences)
    ece = 0.0
    for b in reliability_curve(confidences, correct, n_bins):
        if not b["n"]:
            continue
        gap = abs((b["accuracy"] or 0.0) - (b["mean_confidence"] or 0.0))
        ece += (b["n"] / total) * gap
    return round(ece, 4)


def calibration_report(confidences: list[float], correct: list[bool],
                       n_bins: int = 10) -> dict:
    return {
        "n": len(confidences),
        "ece": expected_calibration_error(confidences, correct, n_bins),
        "brier": brier_score(confidences, correct),
        "bins": n_bins,
        "reliability": reliability_curve(confidences, correct, n_bins),
    }


# ------------------------------------------------------------------ sweep

@dataclass
class SweepPoint:
    threshold_set_id: str
    refuse_below: float
    confirm_below: float
    banding: str
    n: int
    unsafe_auto_confirm_rate: float
    unsafe_auto_confirms: int
    queue_rate: float
    refusal_rate: float
    verdict_agreement: float
    verdict_macro_f1: float
    missed_serious_rate: float
    review_burden_per_100: float
    ci: tuple[float, float] = (0.0, 0.0)

    def as_dict(self) -> dict:
        d = dict(self.__dict__)
        d["ci"] = list(self.ci)
        return d


def sweep_grid(refuse_values: list[float] | None = None,
               confirm_values: list[float] | None = None,
               banding: str = "reading") -> list[tuple[float, float]]:
    refuse_values = refuse_values or [round(0.60 + 0.05 * i, 2) for i in range(7)]
    confirm_values = confirm_values or [0.85, 0.90, 0.95]
    return [(r, c) for r in refuse_values for c in confirm_values if c >= r]


def run_sweep(cases: list[dict], evaluate, *,
              grid: list[tuple[float, float]] | None = None,
              banding: str = "reading") -> list[SweepPoint]:
    """Run the A4 pipeline once per grid point and collect the operating curve.

    ``evaluate(cases, threshold_set_id)`` must return the metric dict produced
    by `ml.ladder.evaluate` (or any callable with the same keys).
    """
    points: list[SweepPoint] = []
    for refuse, confirm in (grid or sweep_grid()):
        set_id = f"sweep-r{refuse:.2f}-c{confirm:.2f}-{banding}"
        ts = ThresholdSet(set_id=set_id, refuse_below=refuse, confirm_below=confirm,
                          banding=banding,
                          calibration={"fitted_on": "threshold sweep (E-D)",
                                       "grid": [refuse, confirm]})
        register_threshold_set(ts, replace=True)
        m = evaluate(cases, set_id)
        n = m["n"]
        unsafe = m["unsafe_auto_confirms"]
        points.append(SweepPoint(
            threshold_set_id=set_id, refuse_below=refuse, confirm_below=confirm,
            banding=banding, n=n,
            unsafe_auto_confirm_rate=m["unsafe_auto_confirm_rate"],
            unsafe_auto_confirms=unsafe,
            queue_rate=m["queue_rate"], refusal_rate=m["refusal_rate"],
            verdict_agreement=m["verdict_agreement"],
            verdict_macro_f1=m["verdict_macro_f1"],
            missed_serious_rate=m["missed_serious_rate"],
            review_burden_per_100=round(m["queue_rate"] * 100, 2),
            ci=wilson_interval(unsafe, n),
        ))
    return points


def pareto_frontier(points: list[SweepPoint]) -> list[SweepPoint]:
    """Points not dominated on (unsafe rate up, queue rate up)."""
    frontier: list[SweepPoint] = []
    for p in points:
        dominated = any(
            (q.unsafe_auto_confirm_rate <= p.unsafe_auto_confirm_rate
             and q.queue_rate <= p.queue_rate
             and (q.unsafe_auto_confirm_rate < p.unsafe_auto_confirm_rate
                  or q.queue_rate < p.queue_rate))
            for q in points)
        if not dominated:
            frontier.append(p)
    return sorted(frontier, key=lambda p: (p.unsafe_auto_confirm_rate, p.queue_rate))


def select_operating_point(points: list[SweepPoint], *,
                           max_unsafe: float = 0.0,
                           max_queue_rate: float = 0.15) -> SweepPoint | None:
    """Choose the operating point: zero unsafe auto-confirms, least review load.

    Ties are broken in the safety-first direction: among points with the same
    review burden, prefer the one that refuses the most (highest
    ``refuse_below``) and only then automates the least (highest
    ``confirm_below``). A fitted point is never promoted to the shipped default
    by this function alone — the runner additionally requires that it *strictly*
    beat the default on burden at equal-or-better safety.

    Returns ``None`` when no grid point achieves the safety budget — a negative
    result the evidence binder records honestly rather than hiding.
    """
    feasible = [p for p in points
                if p.unsafe_auto_confirm_rate <= max_unsafe
                and p.queue_rate <= max_queue_rate]
    if not feasible:
        return None
    return sorted(feasible, key=lambda p: (p.queue_rate, p.refusal_rate,
                                           -p.refuse_below, -p.confirm_below,
                                           -p.verdict_macro_f1))[0]


def weight_sensitivity(evaluate, *, base_id: str = "v1-2026-09",
                       refuse_below: float = 0.75, confirm_below: float = 0.90,
                       grids: list[tuple[float, float]] | None = None) -> list[dict]:
    """MED-023: how much does the fusion weighting matter?

    The frozen default bands on raw reading confidence, so the fusion weights
    only change the *fused provenance score* — unless the alternative
    ``banding="fused"`` embodiment is selected, where they move the decision
    boundary itself. This runs the alternative embodiment across a weight grid
    so the choice of 0.4/0.6 is shown to be insensitive (or not) rather than
    asserted.

    ``evaluate(cases, threshold_set_id)`` must return the metric dict from
    ``ml.ladder.evaluate``. Returns one row per grid point, including the
    shipped 0.4/0.6 pair, so the comparison is legible in the binder.
    """
    grids = grids or [(0.3, 0.7), (0.4, 0.6), (0.5, 0.5), (0.6, 0.4)]
    rows: list[dict] = []
    for formulary, reading in grids:
        set_id = f"fused-w{formulary:.1f}{reading:.1f}-{base_id}"
        ts = ThresholdSet(set_id=set_id, refuse_below=refuse_below,
                          confirm_below=confirm_below, banding="fused",
                          fusion=FusionWeights(formulary=formulary, reading=reading),
                          calibration={"fitted_on": "weight sensitivity (E-D/MED-023)",
                                       "weights": {"formulary": formulary,
                                                   "reading": reading}})
        register_threshold_set(ts, replace=True)
        m = evaluate(None, set_id)
        rows.append({
            "formulary_weight": formulary,
            "reading_weight": reading,
            "threshold_set_id": set_id,
            "shipped_default": (formulary, reading) == (0.4, 0.6),
            "unsafe_auto_confirm_rate": m["unsafe_auto_confirm_rate"],
            "queue_rate": m["queue_rate"],
            "verdict_agreement": m["verdict_agreement"],
            "ece_safety": (m.get("calibration_safety") or {}).get("ece"),
        })
    return rows


def suggestion_from_sweep(frontier: list[SweepPoint]) -> dict:
    """A committable summary of the sweep for the evidence binder."""
    return {
        "frontier_size": len(frontier),
        "frontier": [p.as_dict() for p in frontier],
        "best_zero_unsafe": (select_operating_point(frontier) or None)
        and select_operating_point(frontier).as_dict(),
    }
