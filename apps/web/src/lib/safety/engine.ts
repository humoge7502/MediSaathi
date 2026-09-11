/**
 * Vaidya deterministic safety plane.
 *
 * Zero-network, zero-model rule engine over in-memory seed tables.
 * The LLM never sees this plane's decisions; this plane never calls a model.
 *
 * Pipeline: normalize -> interactions (pairwise) -> combination (graph)
 *           -> contraindications -> duplicate detection -> dose caps
 *           -> verdict assembly (the gate law).
 */

import {
  BRANDS,
  CONTRAINDICATIONS,
  DAILY_CAPS_MG,
  INTERACTIONS,
  MOLECULE_GROUPS,
  SNAPSHOT,
  type InteractionRow,
} from "./dataset";
import {
  allBelowRefusal,
  bandOf,
  fusePrescription,
  getThresholdSet,
  type FieldDecision,
  type GateMetadata,
  type ThresholdSet,
} from "./gate";

export type Severity = "none" | "mild" | "moderate" | "severe";

export type VerdictKind =
  | "pass"
  | "interaction"
  | "combination"
  | "contraindication"
  | "duplicate"
  | "confirm_queue"
  | "refused";

export interface NormalizedMed {
  line: number;
  rawText: string;
  brand: string | null;
  brandConfidence: number;
  molecule: string;
  molecules: string[]; // expansion for combination brands
  atc: string;
  strengthMg: number | null;
  frequency: string; // OD/BD/TDS/... or 1-0-1
  timesPerDay: number | null;
  durationDays: number | null;
  instructions: string;
}

export interface InteractionFinding {
  kind: "interaction";
  a: string;
  b: string;
  severity: Severity;
  mechanism: string;
  source: string;
}

export interface CombinationFinding {
  kind: "combination";
  rule: string;
  molecules: string[];
  severity: Severity;
  mechanism: string;
  source: string;
}

export interface ContraindicationFinding {
  kind: "contraindication";
  molecule: string;
  condition: string;
  severity: Severity;
  note: string;
}

export interface DuplicateFinding {
  kind: "duplicate";
  molecule: string;
  brands: string[];
  severity: Severity;
  note: string;
}

export interface DoseFinding {
  kind: "dose";
  molecule: string;
  note: string;
  severity: Severity;
}

export type Finding =
  | InteractionFinding
  | CombinationFinding
  | ContraindicationFinding
  | DuplicateFinding
  | DoseFinding;

export interface SafetyReport {
  verdict: VerdictKind;
  headline: string;
  findings: Finding[];
  confirmed: NormalizedMed[];
  confirmQueue: ConfirmItem[];
  aggregateDailyMg: Record<string, number>;
  snapshot: string;
  engineMs: number;
  /** Gate-law provenance (threshold set + fused score + per-field bands). */
  gate?: GateMetadata;
}

export interface ConfirmItem {
  line: number;
  rawText: string;
  reason: string;
  /** why-queued explainability (MED-014): the exact band + fused score. */
  band?: "refused" | "confirm" | "auto";
  fused?: number;
  why?: string;
}

// ---------------------------------------------------------------- tables

const brandIndex: Map<string, (typeof BRANDS)[number]> = new Map(
  BRANDS.map((b) => [b.brand.toLowerCase(), b])
);

const moleculeIndex: Map<string, (typeof BRANDS)[number]> = new Map();
for (const b of BRANDS) {
  for (const mol of b.molecule.split("+")) {
    if (!moleculeIndex.has(mol)) moleculeIndex.set(mol, b);
  }
}

const pairIndex: Map<string, InteractionRow> = new Map();
for (const row of INTERACTIONS) {
  pairIndex.set(pairKey(row.a, row.b), row);
}

const contraByMolecule: Map<string, (typeof CONTRAINDICATIONS)[number][]> = new Map();
for (const row of CONTRAINDICATIONS) {
  const list = contraByMolecule.get(row.molecule) ?? [];
  list.push(row);
  contraByMolecule.set(row.molecule, list);
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function groupOf(molecule: string, group: string): boolean {
  return (MOLECULE_GROUPS[group] ?? []).includes(molecule);
}

// -------------------------------------------------- normalization

const STOPWORDS = new Set(["tab", "tablet", "cap", "capsule", "syp", "syrup", "inj", "injection", "od", "bd", "tds", "qid", "hs", "sos", "stat", "daily", "once", "twice", "thrice", "times", "day", "days", "week", "weeks", "for", "x", "mg", "mcg", "ml", "gm", "g"]);

/**
 * Normalize one prescription line into a med. Deterministic brand resolution:
 * exact match, then prefix/substring match against the brand + molecule index.
 * Confidence is recorded per line; below-gate lines land in the confirm queue.
 */
export function normalizeLine(line: string, lineNo: number): NormalizedMed {
  const raw = line.trim().replace(/\s+/g, " ");
  const lower = raw.toLowerCase();

  // frequency: TAC "1-0-1" or word codes
  let frequency = "";
  const tac = lower.match(/(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/);
  if (tac) {
    frequency = `${tac[1]}-${tac[2]}-${tac[3]}`;
  } else {
    for (const code of ["qd", "od", "bid", "bd", "tid", "tds", "qid", "hs", "sos", "stat", "qwk", "once daily", "twice daily", "thrice daily"]) {
      if (new RegExp(`\\b${code}\\b`).test(lower)) {
        frequency = code === "qd" || code === "od" || code === "once daily" ? "OD"
          : code === "bid" || code === "bd" || code === "twice daily" ? "BD"
          : code === "tid" || code === "tds" || code === "thrice daily" ? "TDS"
          : code.toUpperCase();
        break;
      }
    }
  }

  // strength
  let strengthMg: number | null = null;
  const mgMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:mg|milligram)/);
  if (mgMatch) strengthMg = parseFloat(mgMatch[1]);

  // duration
  let durationDays: number | null = null;
  const dur = lower.match(/(\d+)\s*(?:day|days|d)\b/);
  if (dur) durationDays = parseInt(dur[1], 10);

  // brand resolution
  let brand: (typeof BRANDS)[number] | null = null;
  let brandConfidence = 0;
  const exact = brandIndex.get(lower);
  if (exact) {
    brand = exact;
    brandConfidence = 1.0;
  } else {
    // scored substring match: brand token coverage. Short brand cores
    // ("Pan 40" -> core "pan") are too false-match-prone as bare substrings,
    // so they match only as a FULL brand token ("pan 40 ...") — parity with
    // the Python engine's exact/substring resolver, pinned by corpus case P03.
    let best: { row: (typeof BRANDS)[number]; score: number } | null = null;
    for (const row of BRANDS) {
      const bLower = row.brand.toLowerCase();
      const core = bLower.replace(/\s*\d+.*$/, "").trim(); // "Dolo 650" -> "dolo"
      const matched =
        core.length >= 4
          ? new RegExp(`\\b${escapeRe(core)}\\b`).test(lower)
          : new RegExp(`\\b${escapeRe(bLower)}\\b`).test(lower);
      if (matched) {
        const score = core.length >= 4 ? core.length / Math.max(bLower.length, 1) + 0.4 : 0.9;
        if (!best || score > best.score) best = { row, score };
      }
    }
    if (best) {
      brand = best.row;
      brandConfidence = Math.min(0.92, best.score);
    } else {
      // molecule fallback: "warfarin 5mg" -> warfarin
      for (const [mol, row] of moleculeIndex) {
        if (mol.length >= 5 && lower.includes(mol)) {
          brand = row;
          brandConfidence = 0.85;
          break;
        }
      }
    }
  }

  const timesPerDay = frequencyPerDay(frequency);
  return {
    line: lineNo,
    rawText: raw,
    brand: brand?.brand ?? null,
    brandConfidence,
    molecule: brand?.molecule ?? "",
    molecules: brand ? brand.molecule.split("+").map((m) => m.trim()) : [],
    atc: brand?.atc ?? "",
    strengthMg,
    frequency,
    timesPerDay,
    durationDays,
    instructions: raw,
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function frequencyPerDay(freq: string): number | null {
  const f = (freq || "").trim();
  const tac = f.match(/^(\d+)\s*-\s*(\d+)\s*-\s*(\d+)$/);
  if (tac) return parseInt(tac[1]) + parseInt(tac[2]) + parseInt(tac[3]);
  const map: Record<string, number> = { OD: 1, QD: 1, HS: 1, QHS: 1, BD: 2, BID: 2, TDS: 3, TID: 3, QID: 4, STAT: 1, SOS: 1, QWK: 0.14 };
  if (map[f.toUpperCase()] !== undefined) return map[f.toUpperCase()];
  return null;
}

/**
 * Overall prescription confidence (audit TD-F — named, documented, tested).
 *
 * Blends two factors:
 *   · formulary ratio (weight 0.4): share of parsed lines the plane CONFIRMED
 *     against the formulary. A brand the model invents resolves nowhere and
 *     drags this down — invented lines are worse than blurry ones.
 *   · mean line reading confidence (weight 0.6): how sure perception was of
 *     what it read.
 *
 * Rationale for the weighting: the plane can recover from a fuzzy read
 * (formulary re-normalization), but NOT from a confidently wrong brand, so
 * reading confidence matters more — yet a 100%-unreadable formulary mismatch
 * must never average out to "trustworthy". Rounded to 2 decimals.
 *
 * Boundary behavior (pinned by tests/middleware.security.test.ts's engine
 * sibling, scripts/selftest.ts, and the route integration suite):
 *   · no lines at all                          -> 0
 *   · all lines confirmed, all conf 1.0        -> 1.0
 *   · all lines queued (ratio 0), conf 1.0     -> 0.6
 *   · all confirmed (ratio 1), conf 0.5        -> 0.7
 */
export function overallConfidence(
  confirmedCount: number,
  queueCount: number,
  lineConfidences: number[]
): number {
  // The formula itself now lives in the gate module (single source of truth
  // alongside the threshold set); this export is kept because callers and the
  // route-integration suite reference it by name.
  return fusePrescription(confirmedCount, queueCount, lineConfidences);
}

// -------------------------------------------------- the plane

export interface EngineInput {
  rawLines: string[];
  contexts: string[];
  /** per-line extraction confidence from the perception layer (0-1) */
  lineConfidence?: number[];
  /** skip the confidence gate (engine self-tests run without a perception layer) */
  skipGate?: boolean;
  /** threshold-set id for the gate law (default: frozen v1 set) */
  thresholdSetId?: string;
}

export function runSafetyPlane(input: EngineInput): SafetyReport {
  const t0 = performance.now();
  const findings: Finding[] = [];
  const confirmed: NormalizedMed[] = [];
  const confirmQueue: ConfirmItem[] = [];

  const meds = input.rawLines
    .filter((l) => l.trim().length > 0)
    .map((l, i) => normalizeLine(l, i + 1));

  // 0. unusable input
  if (meds.length === 0) {
    return finish("refused", "No medication lines detected — refusing rather than guessing.", findings, confirmed, confirmQueue, {}, t0);
  }

  // 1. confidence gate — the gate law (first match wins, mirroring
  // apps/api/app/verdict.py and pinned by the cross-engine parity corpus):
  //    all lines in the refusal band -> refused (never guess)
  //    any line refused / below CONFIRM / unmatched -> confirm_queue
  //
  // The refusal band consumes PERCEPTION confidence only: the plane cannot
  // second-guess what the reader said it saw. When the deterministic splitter
  // runs (no LLM), there is no perception confidence — undefined lineConfidence
  // means the gate falls back to formulary brandConfidence for the
  // confirm/auto-confirm bands, but never for the refusal band: an unmatched
  // formulary line in the offline tier is exactly what the human confirm queue
  // exists for (decision B9: "garbage still queues"), NOT a refusal.
  //
  // All band decisions are delegated to lib/safety/gate.ts so the law exists
  // exactly once per tier (MED-003) and carries fused scores + threshold id.
  const thresholds = getThresholdSet(input.thresholdSetId);
  let gateDecisions: (FieldDecision & { line: number })[] = [];
  if (!input.skipGate) {
    const perceptionProvided = input.lineConfidence !== undefined;
    const confs = meds.map((med, i) => ({
      med,
      conf: perceptionProvided ? (input.lineConfidence?.[i] ?? med.brandConfidence) : med.brandConfidence,
    }));
    gateDecisions = confs.map(({ med, conf }) => ({ ...bandOf(conf, !!med.brand, thresholds), line: med.line }));
    if (perceptionProvided && gateDecisions.length > 0 && allBelowRefusal(gateDecisions)) {
      return finish(
        "refused",
        "Refused — no line could be verified with confidence. In medication questions the system refuses rather than guesses.",
        findings,
        confirmed,
        confirmQueue,
        {},
        t0,
        buildGate(gateDecisions, confs.map((c) => c.conf), 0, confs.length, thresholds)
      );
    }
    for (let i = 0; i < confs.length; i++) {
      const { med, conf } = confs[i];
      const d = gateDecisions[i];
      if (d.band === "auto") {
        confirmed.push(med);
      } else if (d.band === "refused") {
        confirmQueue.push({
          line: med.line, rawText: med.rawText,
          reason: `Low reading confidence (${Math.round(conf * 100)}%)`,
          band: d.band, fused: d.fused, why: d.reason,
        });
      } else {
        confirmQueue.push({
          line: med.line, rawText: med.rawText,
          reason: !med.brand ? "Not in formulary — needs human confirmation" : `Confidence ${Math.round(conf * 100)}% below auto-confirm threshold`,
          band: d.band, fused: d.fused, why: d.reason,
        });
      }
    }
  } else {
    // self-test mode: no perception layer, but unresolvable lines still queue
    for (const med of meds) {
      if (med.brand) confirmed.push(med);
      else confirmQueue.push({ line: med.line, rawText: med.rawText, reason: "Not in formulary — needs human confirmation" });
    }
  }

  const activeMeds = confirmed;
  const molecules = new Set<string>();
  for (const m of activeMeds) for (const mol of m.molecules) molecules.add(mol);

  // 2. pairwise interactions
  const molList = [...molecules];
  for (let i = 0; i < molList.length; i++) {
    for (let j = i + 1; j < molList.length; j++) {
      const hit = pairIndex.get(pairKey(molList[i], molList[j]));
      if (hit) {
        findings.push({ kind: "interaction", a: hit.a, b: hit.b, severity: hit.severity, mechanism: hit.mechanism, source: hit.source });
      }
    }
  }

  // 3. combination (graph) rules — these catch dangers that are pairwise-invisible
  findings.push(...combinationRules(molList));

  // 4. contraindications against declared context
  for (const mol of molList) {
    const rules = contraByMolecule.get(mol) ?? [];
    for (const rule of rules) {
      if (input.contexts.includes(rule.condition)) {
        findings.push({ kind: "contraindication", molecule: mol, condition: rule.condition, severity: rule.severity === "absolute" ? "severe" : "moderate", note: rule.note });
      }
    }
  }

  // 5. duplicates: same molecule twice (two brands, or combination brands overlapping)
  const molBrands: Map<string, string[]> = new Map();
  for (const m of activeMeds) {
    for (const mol of m.molecules) {
      const list = molBrands.get(mol) ?? [];
      list.push(m.brand ?? m.rawText);
      molBrands.set(mol, list);
    }
  }
  for (const [mol, brands] of molBrands) {
    if (brands.length > 1) {
      findings.push({ kind: "duplicate", molecule: mol, brands, severity: "moderate", note: `Same molecule from ${brands.length} brands — double-dosing risk` });
    }
  }

  // 6. aggregate dose caps (across all lines and brands)
  const aggregate: Record<string, number> = {};
  for (const m of activeMeds) {
    if (m.strengthMg == null || m.timesPerDay == null) continue;
    const perLine = m.strengthMg * m.timesPerDay;
    for (const mol of m.molecules) {
      aggregate[mol] = (aggregate[mol] ?? 0) + perLine;
    }
  }
  for (const [mol, total] of Object.entries(aggregate)) {
    const cap = DAILY_CAPS_MG[mol];
    if (cap && total > cap) {
      findings.push({ kind: "dose", molecule: mol, severity: total > cap * 1.5 ? "severe" : "moderate", note: `Aggregate ${Math.round(total)} mg/day exceeds the ${cap} mg/day cap` });
    }
  }

  // 7. verdict assembly (first match wins)
  const verdict = assembleVerdict(findings, confirmQueue);
  const gate = gateDecisions.length
    ? buildGate(
        gateDecisions,
        input.lineConfidence ?? meds.map((m) => m.brandConfidence),
        confirmed.length,
        confirmQueue.length,
        thresholds
      )
    : undefined;
  return finish(verdict, headlineFor(verdict, findings, confirmQueue), findings, confirmed, confirmQueue, aggregate, t0, gate);
}

/** Assemble the gate provenance block persisted with every verdict. */
function buildGate(
  decisions: (FieldDecision & { line: number })[],
  lineConfidences: number[],
  confirmedCount: number,
  queueCount: number,
  ts: ThresholdSet
): GateMetadata {
  const prescriptionBand: "refused" | "confirm" | "auto" = allBelowRefusal(decisions)
    ? "refused"
    : queueCount > 0
      ? "confirm"
      : "auto";
  return {
    thresholdSetId: ts.setId,
    refuseBelow: ts.refuseBelow,
    confirmBelow: ts.confirmBelow,
    fusion: ts.fusion,
    banding: ts.banding,
    prescriptionFused: fusePrescription(confirmedCount, queueCount, lineConfidences, ts.fusion),
    prescriptionBand,
    decisions,
  };
}

function combinationRules(molecules: string[]): Finding[] {
  const out: Finding[] = [];
  const has = (g: string) => molecules.filter((m) => groupOf(m, g));

  // Triple whammy: RAAS blocker + diuretic + NSAID -> AKI risk
  const raas = has("raas_blocker");
  const diu = has("loop_or_thiazide");
  const nsaid = has("nsaid");
  if (raas.length && diu.length && nsaid.length) {
    out.push({
      kind: "combination",
      rule: "triple_whammy",
      molecules: [raas[0], diu[0], nsaid[0]],
      severity: "severe",
      mechanism: "RAAS blocker + diuretic + NSAID (triple whammy) — acute kidney injury risk",
      source: "BMJ/AKI guidance",
    });
  }

  // QT stack: >= 3 QT-prolonging molecules
  const qt = has("qt_prolonging");
  if (qt.length >= 3) {
    out.push({
      kind: "combination",
      rule: "qt_stack",
      molecules: qt,
      severity: "severe",
      mechanism: `${qt.length} QT-prolonging medicines together — torsades risk`,
      source: "CredibleMeds",
    });
  }

  // Serotonin stack: SSRI + >= 2 other serotonergic
  const ssri = has("ssri");
  const seroton = has("serotonergic").filter((m) => !ssri.includes(m));
  if (ssri.length && seroton.length >= 2) {
    out.push({
      kind: "combination",
      rule: "serotonin_stack",
      molecules: [...ssri, ...seroton],
      severity: "severe",
      mechanism: "SSRI with multiple serotonergic agents — serotonin syndrome risk",
      source: "FDA/Stockley",
    });
  }

  // Bleeding stack: anticoagulant/antiplatelet + SSRI + NSAID (any two of three classes beyond the pairwise)
  const blood = has("anticoagulant_or_antiplatelet");
  if (blood.length >= 1 && ssri.length >= 1 && nsaid.length >= 1) {
    out.push({
      kind: "combination",
      rule: "bleeding_stack",
      molecules: [...blood, ...ssri, ...nsaid],
      severity: "severe",
      mechanism: "Antithrombotic + SSRI + NSAID — compounded GI bleeding risk",
      source: "BMJ",
    });
  }

  return out;
}

/**
 * The gate law — decision order, first match wins:
 *   1. contraindication            -> contraindication
 *   2. severe interaction/combination -> interaction
 *   3. duplicate                   -> duplicate
 *   4. moderate interaction        -> interaction
 *   5. severe dose breach          -> interaction
 *   6. anything in confirm queue   -> confirm_queue
 *   7. otherwise                   -> pass
 * Dose findings below "severe" are notes for the human, never verdicts.
 */
function assembleVerdict(findings: Finding[], queue: ConfirmItem[]): VerdictKind {
  if (findings.some((f) => f.kind === "contraindication")) return "contraindication";
  if (findings.some((f) => (f.kind === "interaction" || f.kind === "combination") && f.severity === "severe")) return "interaction";
  if (findings.some((f) => f.kind === "duplicate")) return "duplicate";
  if (findings.some((f) => (f.kind === "interaction" || f.kind === "combination") && f.severity === "moderate")) return "interaction";
  if (findings.some((f) => f.kind === "dose" && f.severity === "severe")) return "interaction";
  if (queue.length) return "confirm_queue";
  return "pass";
}

function headlineFor(v: VerdictKind, findings: Finding[], queue: ConfirmItem[]): string {
  switch (v) {
    case "pass": return "All checks passed";
    case "interaction":
    case "combination": return "Interaction found";
    case "contraindication": return "Contraindication in declared context";
    case "duplicate": return "Duplicate medication detected";
    case "confirm_queue": return queue.length ? "Confirmation needed before this plan is spoken aloud" : "Confirmation needed";
    case "refused": return "Refused — cannot verify this prescription";
  }
}

function finish(
  verdict: VerdictKind,
  headline: string,
  findings: Finding[],
  confirmed: NormalizedMed[],
  confirmQueue: ConfirmItem[],
  aggregate: Record<string, number>,
  t0: number,
  gate?: GateMetadata
): SafetyReport {
  return {
    verdict,
    headline,
    findings,
    confirmed,
    confirmQueue,
    aggregateDailyMg: aggregate,
    snapshot: SNAPSHOT,
    engineMs: Math.round((performance.now() - t0) * 10) / 10,
    gate,
  };
}

export function formularySearch(q: string, limit = 8): (typeof BRANDS)[number][] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const scored = BRANDS.map((b) => {
    const bl = b.brand.toLowerCase();
    const ml = b.molecule.toLowerCase();
    let score = -1;
    if (bl.startsWith(needle)) score = 3;
    else if (bl.includes(needle)) score = 2;
    else if (ml.includes(needle)) score = 1;
    return { b, score };
  }).filter((x) => x.score > 0);
  scored.sort((a, b2) => b2.score - a.score || a.b.brand.localeCompare(b2.b.brand));
  return scored.slice(0, limit).map((x) => x.b);
}
