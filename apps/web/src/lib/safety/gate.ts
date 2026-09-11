/**
 * The gate law — TypeScript mirror of `apps/api/app/gate.py` (ADR-0012/0014).
 *
 *     typed per-field confidence
 *       -> fusion with formulary resolvability
 *       -> three-band routing (refuse / human-confirm / auto-confirm)
 *       -> persisted confirmation queue blocking downstream plan generation
 *       -> deterministic plane assembles the verdict
 *
 * Both engines implement the same law on the same golden corpus; the parity
 * gate (`bun run parity`) fails the build on any divergence. Do not change one
 * side without the other: the threshold-set id and fusion weights here are the
 * ones persisted with every verdict as provenance.
 *
 * Design laws (identical to the Python module):
 *   1. The refusal band consumes perception confidence only.
 *   2. Confirm/auto consume the fused score (or the reading confidence when the
 *      frozen default set asks for it).
 *   3. Fusion can only demote (auto -> confirm), never promote.
 */

export type Band = "refused" | "confirm" | "auto";

export interface FusionWeights {
  formulary: number;
  reading: number;
}

export interface ThresholdSet {
  setId: string;
  refuseBelow: number;
  confirmBelow: number;
  fusion: FusionWeights;
  /** "reading" = band on raw confidence (frozen default); "fused" = alternative embodiment */
  banding: "reading" | "fused";
  calibration: Record<string, unknown>;
}

export interface FieldDecision {
  band: Band;
  fused: number;
  resolvable: boolean;
  readingConfidence: number;
  reason: string;
}

export interface GateMetadata {
  thresholdSetId: string;
  refuseBelow: number;
  confirmBelow: number;
  fusion: FusionWeights;
  banding: "reading" | "fused";
  prescriptionFused: number;
  prescriptionBand: Band;
  decisions: (FieldDecision & { line: number })[];
}

export const FUSION_WEIGHTS: FusionWeights = { formulary: 0.4, reading: 0.6 };
export const DEFAULT_THRESHOLD_SET_ID = "v1-2026-09";

function assertWeights(w: FusionWeights): FusionWeights {
  const total = w.formulary + w.reading;
  if (Math.abs(total - 1) > 1e-9) {
    throw new Error(`fusion weights must sum to 1.0, got ${total}`);
  }
  if (w.formulary < 0 || w.reading < 0) {
    throw new Error("fusion weights must be non-negative");
  }
  return w;
}

export const THRESHOLD_SETS: Record<string, ThresholdSet> = {
  "v1-2026-09": {
    setId: "v1-2026-09",
    refuseBelow: 0.75,
    confirmBelow: 0.9,
    fusion: assertWeights(FUSION_WEIGHTS),
    banding: "reading",
    calibration: { fittedOn: "hand-set (pre-calibration)", note: "audited default" },
  },
  "fused-2026-09": {
    setId: "fused-2026-09",
    refuseBelow: 0.75,
    confirmBelow: 0.9,
    fusion: assertWeights(FUSION_WEIGHTS),
    banding: "fused",
    calibration: { fittedOn: "calibration split of data/corpus v1" },
  },
};

export function getThresholdSet(setId?: string | null): ThresholdSet {
  const id = setId ?? DEFAULT_THRESHOLD_SET_ID;
  const set = THRESHOLD_SETS[id];
  if (!set) throw new Error(`unknown threshold set ${id}; known: ${Object.keys(THRESHOLD_SETS).join(", ")}`);
  return set;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

/** Fuse one field's reading confidence with its formulary resolvability. */
export function fuseField(readingConfidence: number, resolvable: boolean, weights: FusionWeights = FUSION_WEIGHTS): number {
  return round6(weights.formulary * (resolvable ? 1 : 0) + weights.reading * clamp01(readingConfidence));
}

/** Route one field into the refusal, human-confirmation or auto band. */
export function bandOf(readingConfidence: number, resolvable: boolean, thresholds: ThresholdSet = getThresholdSet()): FieldDecision {
  const conf = clamp01(readingConfidence);
  const fused = fuseField(conf, resolvable, thresholds.fusion);

  if (conf < thresholds.refuseBelow) {
    return {
      band: "refused",
      fused,
      resolvable,
      readingConfidence: conf,
      reason: `reading confidence ${conf.toFixed(2)} below refusal threshold ${thresholds.refuseBelow.toFixed(2)}`,
    };
  }
  if (!resolvable) {
    return {
      band: "confirm",
      fused,
      resolvable: false,
      readingConfidence: conf,
      reason: "brand not in formulary map — invented reads never auto-confirm",
    };
  }
  const gateValue = thresholds.banding === "fused" ? fused : conf;
  if (gateValue < thresholds.confirmBelow) {
    return {
      band: "confirm",
      fused,
      resolvable: true,
      readingConfidence: conf,
      reason: `${thresholds.banding === "fused" ? "fused score" : "confidence"} ${gateValue.toFixed(2)} below auto-confirm threshold ${thresholds.confirmBelow.toFixed(2)}`,
    };
  }
  return {
    band: "auto",
    fused,
    resolvable: true,
    readingConfidence: conf,
    reason: "resolvable read above the auto-confirm threshold",
  };
}

export function allBelowRefusal(decisions: FieldDecision[]): boolean {
  return decisions.length > 0 && decisions.every((d) => d.band === "refused");
}

/**
 * Prescription-level fused score (audit TD-F; mirrored by Python
 * `fuse_prescription`). Blends formulary ratio (0.4) with mean reading
 * confidence (0.6). Boundary behaviour pinned by tests:
 *   no lines -> 0 · all confirmed @1.0 -> 1.0 · none confirmed @1.0 -> 0.6 ·
 *   all confirmed @0.5 -> 0.7
 */
export function fusePrescription(
  confirmedCount: number,
  queueCount: number,
  lineConfidences: number[],
  weights: FusionWeights = FUSION_WEIGHTS
): number {
  const total = confirmedCount + queueCount;
  if (total === 0 || lineConfidences.length === 0) return 0;
  const ratio = confirmedCount / total;
  const mean = lineConfidences.reduce((a, c) => a + clamp01(c), 0) / lineConfidences.length;
  return Math.round((weights.formulary * ratio + weights.reading * mean) * 100) / 100;
}
