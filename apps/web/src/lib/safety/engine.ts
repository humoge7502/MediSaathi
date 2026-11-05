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
  INTERACTIONS,
  MOLECULE_GROUPS,
  SNAPSHOT,
  type BrandRow,
  type InteractionRow,
} from "./dataset";
// Generated from data/reference/dose_caps.csv by tools/build_dose_caps.py. The
// caps used to be a literal here and a second literal in the Python engine, and
// they disagreed with the sourced table on 17 molecules (theophylline 450 vs a
// level-guided 900, ondansetron 32 = a withdrawn IV figure vs 24 oral). One
// table of record now, one build, and a drift test that fails if the two
// engines disagree on a single number.
import {
  ADVISORY_MG,
  CAP_BASIS,
  CAP_LOWERED_BY,
  DAILY_CAPS_MG,
  HARD_CAP_MG,
} from "./dose-caps.generated";
import {
  allBelowRefusal,
  bandOf,
  fusePrescription,
  getThresholdSet,
  type FieldDecision,
  type GateMetadata,
  type ThresholdSet,
} from "./gate";
import {
  dailyFactor,
  extractLineFrequency,
  frequencyPerDayCode,
  parseFrequency,
  type Frequency,
} from "./frequency";
import {
  brandLabelStrength,
  intervalHazard,
  intervalHazardNote,
  parseStrength,
  strengthMismatch,
} from "./schedule-rules";

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
  /**
   * How `brand` was obtained, and therefore whether the formulary confirms it.
   * "molecule" is a name-guess, not a match: the API tier's `normalize()`
   * returns None for exactly those lines and queues them as
   * "brand not in formulary map", so a guess must never count as resolvable
   * here either — see `formularyResolved`.
   */
  resolvedBy: "exact" | "containment" | "molecule" | null;
  brandConfidence: number;
  molecule: string;
  molecules: string[]; // expansion for combination brands
  form: string;
  atc: string;
  strengthMg: number | null;
  /** the strength exactly as written, unit included ("500 mcg") */
  strengthText: string;
  frequency: string; // OD/BD/TDS/QWK/... or 1-0-1
  /** parsed interval law result; null when the code is not legible */
  frequencyParsed: Frequency | null;
  /** doses per CALENDAR day (fractional for interval codes) */
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

/**
 * A never-event schedule: the line was read perfectly, resolved to a real
 * brand and may carry no interaction at all — but the regimen it describes is
 * one the approved label forbids (oral methotrexate once-daily). Mirrors
 * `DoseRuleFinding` in the shared contracts package.
 */
export interface DoseHazardFinding {
  kind: "dose_hazard";
  molecule: string;
  brand: string;
  severity: Severity;
  /** what the prescription line says, verbatim ("OD") */
  observed: string;
  /** what the label requires ("no more often than every 7 days") */
  required: string;
  note: string;
  source: string;
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
  /** Never-event schedule violations. These block plan creation outright. */
  doseHazards: DoseHazardFinding[];
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

/** Provenance label carried by a daily-cap hazard. A verbatim mirror of
 * `CAP_SOURCE` in apps/api/app/safety/engine.py — the two planes must describe
 * the same rule with the same string, because the headline and the parity
 * finding text are both built from it. */
export const CAP_SOURCE = "label daily maximum";

/** Render a mg/day figure the way the Python tier's `f"{x:g}"` does.
 *
 * `Math.round` was inherited from the old literal rule and it was wrong for the
 * sub-milligram class: a levothyroxine breach printed "Aggregate 1 mg/day" where
 * the Python tier printed 0.5 — the same dose, two numbers, in the sentence that
 * tells a pharmacist what was found. Six significant digits, no trailing zeros. */
export function formatMg(value: number): string {
  return String(Number(value.toPrecision(6)));
}

/** The mg/day ceiling a line is actually measured against.
 *
 * A mirror of `effective_cap` in apps/api/app/safety/dosing.py: the patient can
 * declare a condition that the same label says lowers the maximum (paracetamol
 * 2 g/day under liver disease), and the lowest applicable figure then governs.
 * The engine has no serum level and no body weight, but it does have what the
 * person said about themselves — that is not a number it has to invent. */
export function effectiveCap(
  mol: string,
  contexts: readonly string[]
): { limit: number; lowering: string | null } {
  const standing = DAILY_CAPS_MG[mol];
  if (!standing) return { limit: Infinity, lowering: null };
  let best: { limit: number; lowering: string } | null = null;
  for (const [code, limit] of Object.entries(CAP_LOWERED_BY[mol] ?? {})) {
    if (!contexts.includes(code)) continue;
    if (!best || limit < best.limit) best = { limit, lowering: code };
  }
  if (best && best.limit < standing) return best;
  return { limit: standing, lowering: null };
}

export type CapOutcome = "clean" | "breach" | "advise";

/** Classify one molecule's mg/day against the limits the table gives it.
 * Mirror of `cap_check` in the Python tier; both planes and both rules route
 * through it so a regimen cannot warn in one tier and block in the other. */
export function capCheck(
  mol: string,
  totalMg: number,
  contexts: readonly string[]
): { outcome: CapOutcome; limit: number; lowering: string | null } {
  const standing = DAILY_CAPS_MG[mol];
  if (!standing) return { outcome: "clean", limit: 0, lowering: null };
  const { limit, lowering } = effectiveCap(mol, contexts);
  if (totalMg > limit) {
    return {
      outcome: HARD_CAP_MG.has(mol) ? "breach" : "advise",
      limit, lowering,
    };
  }
  const adv = ADVISORY_MG[mol];
  if (adv !== undefined && adv < limit && totalMg > adv) {
    return { outcome: "advise", limit: adv, lowering: null };
  }
  return { outcome: "clean", limit: 0, lowering: null };
}

const brandIndex: Map<string, (typeof BRANDS)[number]> = new Map(
  BRANDS.map((b) => [b.brand.toLowerCase(), b])
);

const moleculeIndex: Map<string, (typeof BRANDS)[number]> = new Map();
for (const b of BRANDS) {
  // No fold here on purpose: tools/build_web_dataset.py refuses to build if a
  // molecule cell is not already lowercase and space-free, so the split is
  // enough and the key is the same string the Python tier stored.
  for (const mol of b.molecule.split("+")) {
    if (!moleculeIndex.has(mol)) moleculeIndex.set(mol, b);
  }
}

/**
 * Match material for the candidate scan in `normalizeLine`, computed once: the
 * scan walks every formulary row for each line the exact lookup misses, and the
 * table has 2 836 of them.
 */
const brandCandidates: { row: BrandRow; key: string }[] = BRANDS.map((row) => ({
  row,
  key: row.brand.toLowerCase(),
}));

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

/**
 * Mirror of `_molecule_identities` in apps/api/app/safety/engine.py: the
 * components of a combination brand, then the whole string. 176 interaction
 * rows and 17 contraindication rows are documented at combination granularity
 * ("amiodarone + artemether+lumefantrine") and were unreachable while screening
 * walked components only.
 *
 * Exported because the longitudinal screen imports this one function rather than
 * keeping a second copy: one identity law, two screens (ADR-0012).
 */
export function moleculeIdentities(molecules: string[]): string[] {
  return molecules.length > 1 ? [...molecules, molecules.join("+")] : molecules;
}

function groupOf(molecule: string, group: string): boolean {
  return (MOLECULE_GROUPS[group] ?? []).includes(molecule);
}

// -------------------------------------------------- normalization

const STOPWORDS = new Set(["tab", "tablet", "cap", "capsule", "syp", "syrup", "inj", "injection", "od", "bd", "tds", "qid", "hs", "sos", "stat", "daily", "once", "twice", "thrice", "times", "day", "days", "week", "weeks", "for", "x", "mg", "mcg", "ml", "gm", "g"]);

/**
 * Normalise one prescription line into a med. Deterministic brand resolution:
 * exact key, then the longest formulary key the line contains, then a
 * molecule-name guess at 0.85. Confidence is recorded per line; below-gate
 * lines land in the confirm queue.
 */
export function normalizeLine(line: string, lineNo: number): NormalizedMed {
  const raw = line.trim().replace(/\s+/g, " ");
  const lower = raw.toLowerCase();

  // brand resolution (first: the strength fallback below needs the formulary row)
  let brand: BrandRow | null = null;
  let resolvedBy: NormalizedMed["resolvedBy"] = null;
  let brandConfidence = 0;
  const exact = brandIndex.get(lower);
  if (exact) {
    brand = exact;
    resolvedBy = "exact";
    brandConfidence = 1.0;
  } else {
    // Two kinds of evidence, and they are not equal. A brand key that appears
    // WHOLE in the line ("tab brufen 400 400 mg qid") states the strength its
    // own label carries. A bare core hit ("brufen") says nothing about strength,
    // and with the full formulary loaded most cores name several rows: Brufen
    // 200 and Brufen 400, Citalopram 10, 20 and 40. Taking the first core match
    // at 575 of the 1 909 ambiguous cores resolved a 400 mg line to Brufen 200,
    // and the strength rule below then queued a line the perception layer had
    // read perfectly — a real false alarm, and the wrong row either way.
    // So there is no core scan: the resolver takes exactly the longest key the
    // line contains, which is the Python tier's law (`_norm_key` + `brand in
    // key`), and a line nothing is contained in stays unbranded and queues.
    // The sweep that decided this: every corpus line plus every formulary name,
    // raw and written as "Tab <name> 1 OD x5d" — 6 365 lines. Both planes resolve
    // the same 6 265 of them, to the same row, and name the row with the same
    // string (this file folds the U+00A0 the catalog carries in 11 names at build
    // time; apps/api folds it at load). Disagreements after the change: zero.
    // Before, the core scan also made the planes disagree, which is worse than
    // slow: a line this plane resolves to the wrong strength is a line the
    // patient is asked to confirm under a drug name that is not the one on it.
    let contained: { key: string; row: BrandRow } | null = null;
    for (const candidate of brandCandidates) {
      if (lower.includes(candidate.key)) {
        if (!contained || candidate.key.length > contained.key.length) {
          contained = { key: candidate.key, row: candidate.row };
        }
      }
    }
    if (contained) {
      brand = contained.row;
      resolvedBy = "containment";
      brandConfidence = 0.92;
    } else {
      // molecule fallback: "warfarin 5mg" -> warfarin
      for (const [mol, row] of moleculeIndex) {
        if (mol.length >= 5 && lower.includes(mol)) {
          brand = row;
          resolvedBy = "molecule";
          brandConfidence = 0.85;
          break;
        }
      }
    }
  }

  // frequency: TAC "1-0-1" or word codes, resolved through the interval law.
  // The vocabulary itself lives in frequency.ts, next to the code tables it must
  // cover, and is pinned against the Python tier's identical list by a drift
  // test. Divergence here was measurable and dangerous: "every other day" queued
  // as a never-event in this plane while the Python plane read no frequency at
  // all and passed the same line.
  const frequency = extractLineFrequency(raw);
  const frequencyParsed = parseFrequency(frequency);

  // strength — unit-aware. Matching only the literal "mg" left every mcg and IU
  // medicine unscreened: a 500 mcg levothyroxine line (cap 0.3 mg/day) parsed to
  // null and passed.
  const strengthMatch = /(\d+(?:[.,]\d+)?)\s*(mg|milligram|mcg|µg|ug|iu|units?|g|gm)\b/.exec(lower);
  let strengthText = "";
  if (strengthMatch) {
    const unit = strengthMatch[2] === "milligram" ? "mg"
      : (strengthMatch[2] === "units" || strengthMatch[2] === "unit") ? "iu"
      : strengthMatch[2] === "gm" ? "g"
      : strengthMatch[2];
    strengthText = `${strengthMatch[1]} ${unit}`;
  }
  // No stated strength: the formulary brand's own label carries it
  // ("Cap. Folitrax 10 HS" is a 10 mg methotrexate course). Anchored to the end
  // of the brand name and unit-resolved exactly like the Python tier, so the
  // two planes screen the same milligrams.
  if (!strengthText && brand) {
    strengthText = brandLabelStrength(brand.brand, brand.molecule) ?? "";
  }
  const strengthMg = parseStrength(strengthText)?.mg ?? null;

  // duration (weeks and months normalize to days; the scheduler needs days)
  let durationDays: number | null = null;
  const dur = lower.match(/(\d+)\s*(day|days|week|weeks|month|months|d)\b/);
  if (dur) {
    const n = parseInt(dur[1], 10);
    durationDays = dur[2].startsWith("week") ? n * 7 : dur[2].startsWith("month") ? n * 30 : n;
  }

  return {
    line: lineNo,
    rawText: raw,
    brand: brand?.brand ?? null,
    resolvedBy,
    brandConfidence,
    molecule: brand?.molecule ?? "",
    molecules: brand ? brand.molecule.split("+").map((m) => m.trim()) : [],
    form: brand?.form ?? "",
    atc: brand?.atc ?? "",
    strengthMg,
    strengthText,
    frequency,
    frequencyParsed,
    timesPerDay: frequencyParsed === null ? null : dailyFactor(frequencyParsed),
    durationDays,
    instructions: raw,
  };
}

/**
 * Does the formulary confirm this line's identity? A molecule-name guess does
 * not: `SafetyEngine.normalize()` returns None for a line that names an
 * ingredient no brand key contains, and `app.gate.band_of` then routes it to the
 * human queue ("invented reads never auto-confirm"). Until now this plane
 * treated the same line as resolved and let a high perception confidence carry
 * it into an auto-confirmed verdict — one engine, two outcomes, in the unsafe
 * direction. The guess stays on the record (it is useful to a pharmacist); it
 * just no longer decides anything.
 */
function formularyResolved(med: NormalizedMed): boolean {
  return med.brand !== null && med.resolvedBy !== "molecule";
}

/**
 * Doses per calendar day for a frequency code, resolved through the interval
 * law. This used to be a hand-copied map containing `QWK: 0.14` — an
 * approximation of "once every 7 days" that the scheduler then read as
 * "roughly daily", which is how weekly medicines got scheduled every day.
 * Unknown codes return null, and null means "queue this line", never "assume
 * once daily".
 */
export function frequencyPerDay(freq: string): number | null {
  return frequencyPerDayCode(freq);
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
 * Boundary behavior (pinned by tests/proxy.security.test.ts's engine
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
  const doseHazards: DoseHazardFinding[] = [];

  const meds = input.rawLines
    .filter((l) => l.trim().length > 0)
    .map((l, i) => normalizeLine(l, i + 1));

  // 0. unusable input
  if (meds.length === 0) {
    return finish("refused", "No medication lines detected — refusing rather than guessing.", findings, confirmed, confirmQueue, [], {}, t0);
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
    gateDecisions = confs.map(({ med, conf }) => ({ ...bandOf(conf, formularyResolved(med), thresholds), line: med.line }));
    if (perceptionProvided && gateDecisions.length > 0 && allBelowRefusal(gateDecisions)) {
      return finish(
        "refused",
        "Refused — no line could be verified with confidence. In medication questions the system refuses rather than guesses.",
        findings,
        confirmed,
        confirmQueue,
        [],
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
          reason: !formularyResolved(med)
            ? "Not in formulary — needs human confirmation"
            : `Confidence ${Math.round(conf * 100)}% below auto-confirm threshold`,
          band: d.band, fused: d.fused, why: d.reason,
        });
      }
    }
  } else {
    // self-test mode: no perception layer, but unresolvable lines still queue
    for (const med of meds) {
      if (formularyResolved(med)) confirmed.push(med);
      else confirmQueue.push({ line: med.line, rawText: med.rawText, reason: "Not in formulary — needs human confirmation" });
    }
  }

  const activeMeds = confirmed;

  // 1b. schedule rules — hazards confidence-based routing structurally cannot
  // see, because both are properties of the regimen the line describes, not of
  // how well the line was read. A line can be read perfectly, resolve to a real
  // brand, carry no interaction, and still prescribe oral methotrexate once a
  // day (an ISMP high-alert never-event). Neither is a warning: both queue the
  // line, which blocks plan creation.
  const queuedLines = new Set(confirmQueue.map((c) => c.line));
  for (const med of meds) {
    // Mirror of apps/api: an unresolvable line is queued and the loop moves on,
    // so the strength, frequency and interval guards below never run on a line
    // the formulary does not confirm — their findings would be about a drug the
    // engine only guessed at.
    if (med.brand === null || !formularyResolved(med)) continue;

    // Look-alike / different-strength guard: the substring resolver matches the
    // formulary `Thyronorm 50` for a line reading "500 mcg". The contradiction
    // IS the uncertainty. The raw line goes too, for the variant where the
    // mis-read lives inside the brand name and never reaches strengthText.
    const mm = strengthMismatch(med.strengthText, med.brand, med.rawText);
    if (mm && !queuedLines.has(med.line)) {
      queuedLines.add(med.line);
      confirmQueue.push({
        line: med.line,
        rawText: med.rawText,
        reason: "Strength does not match the formulary entry",
        band: "confirm",
        why: `${med.brand}: ${mm}`,
      });
    }

    // A stated frequency the interval law cannot read is the worst kind of
    // uncertainty: the schedule is unknown, and the scheduler refuses to invent
    // one. Mirror of the same rule in apps/api/app/safety/engine.py.
    if (med.frequency && !med.frequencyParsed && !queuedLines.has(med.line)) {
      queuedLines.add(med.line);
      confirmQueue.push({
        line: med.line,
        rawText: med.rawText,
        reason: "Dosing frequency is not a recognized code",
        band: "confirm",
        why: `${med.brand}: '${med.frequency}' is not an administration code this ` +
          "engine knows, and the scheduler will not guess one.",
      });
    }

    const hz = intervalHazard(med.frequency, med.strengthText, med.molecule, med.form);
    if (hz === null) continue;
    const note = intervalHazardNote(med.brand, med.molecule, med.strengthText, med.frequency, hz.rule);
    doseHazards.push({
      kind: "dose_hazard",
      molecule: med.molecule,
      brand: med.brand,
      severity: "severe",
      observed: med.frequency.trim(),
      required: `no more often than every ${hz.rule.minIntervalDays} days`,
      note,
      source: hz.rule.source,
    });
    if (!queuedLines.has(med.line)) {
      queuedLines.add(med.line);
      confirmQueue.push({
        line: med.line,
        rawText: med.rawText,
        reason: "Never-event dosing interval",
        band: "confirm",
        why: note,
      });
    }
  }

  const molecules = new Set<string>();
  for (const m of activeMeds) for (const mol of m.molecules) molecules.add(mol);

  // 2. pairwise interactions — across meds, never across one combination
  //    brand's own components, and one finding per documented row.
  const molList = [...molecules];
  const identities = activeMeds.map((m) => moleculeIdentities(m.molecules));
  const seenPairs = new Set<string>();
  for (let i = 0; i < identities.length; i++) {
    for (let j = i + 1; j < identities.length; j++) {
      for (const a of identities[i]) {
        for (const b of identities[j]) {
          const hit = pairIndex.get(pairKey(a, b));
          if (!hit) continue;
          const key = pairKey(hit.a, hit.b);
          if (seenPairs.has(key)) continue;
          seenPairs.add(key);
          findings.push({ kind: "interaction", a: hit.a, b: hit.b, severity: hit.severity, mechanism: hit.mechanism, source: hit.source });
        }
      }
    }
  }

  // 3. combination (graph) rules — these catch dangers that are pairwise-invisible
  findings.push(...combinationRules(molList));

  // 4. contraindications against declared context — per med identity, which
  //    includes the whole-combination string, one finding per rule.
  const seenContras = new Set<string>();
  for (const idents of identities) {
    for (const mol of idents) {
      for (const rule of contraByMolecule.get(mol) ?? []) {
        if (!input.contexts.includes(rule.condition)) continue;
        const key = `${mol}|${rule.condition}`;
        if (seenContras.has(key)) continue;
        seenContras.add(key);
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
  const contributors: Record<string, NormalizedMed[]> = {};
  for (const m of activeMeds) {
    if (m.strengthMg == null || m.timesPerDay == null) continue;
    const perLine = m.strengthMg * m.timesPerDay;
    if (m.molecules.length !== 1) {
      // Mirror of the same guard in apps/api/app/safety/engine.py. A combination
      // line states ONE strength ("T. Ecospirin AV 75 75 mg" = aspirin 75 +
      // atorvastatin 10); applying it to every expanded molecule invented
      // 300 mg/day of atorvastatin and queued a routine statin+aspirin regimen
      // for a "380 mg/day overdose". A combination line contributes nothing to a
      // cap total until brands.csv carries per-component strengths.
      const capped = m.molecules.filter((mol) => DAILY_CAPS_MG[mol] !== undefined);
      if (capped.length) {
        findings.push({
          kind: "dose",
          molecule: capped.join("+"),
          severity: "mild",
          note: `${m.brand}: combination product — per-component strengths are not ` +
            `in the formulary, so the ${capped.join(", ")} daily cap could not be ` +
            "checked for this line",
        });
      }
      continue;
    }
    const mol = m.molecules[0];
    aggregate[mol] = (aggregate[mol] ?? 0) + perLine;
    (contributors[mol] ??= []).push(m);
  }
  for (const [mol, total] of Object.entries(aggregate)) {
    const { outcome, limit, lowering } = capCheck(mol, total, input.contexts);
    if (outcome === "clean") continue;
    const standing = DAILY_CAPS_MG[mol];
    const note =
      `Aggregate ${formatMg(total)} mg/day exceeds the ${limit} mg/day ${mol} cap` +
      (lowering
        ? ` — the declared conditions on this patient lower it from ${standing} mg/day`
        : "");
    // Not a ceiling at all — level-guided, weight-based or specialist-supervised
    // (warfarin's 10 mg is INR-titrated, theophylline's is a serum level,
    // isotretinoin's is mg/kg). This engine has no level and no weight, so it
    // says so and leaves the verdict alone. Mirror of HARD_CAP_MG in
    // apps/api/app/safety/engine.py.
    if (outcome === "advise" && !HARD_CAP_MG.has(mol)) {
      findings.push({
        kind: "dose", molecule: mol, severity: "mild",
        note: `${note} — ${CAP_BASIS[mol] ?? "advisory"}-dosed, so this is advisory, not a maximum`,
      });
      continue;
    }
    // Only the label's lower figure was passed — the OTC self-care cap that sits
    // under a prescription maximum (ibuprofen 1200 under 2400). Said out loud,
    // never blocking. Mirror of ADVISORY_MG in the Python tier.
    if (outcome === "advise") {
      findings.push({
        kind: "dose", molecule: mol, severity: "mild",
        note: `Aggregate ${formatMg(total)} mg/day is above the ${limit} mg/day ` +
          `${mol} self-care limit; the label maximum is ${standing} mg/day, so this ` +
          "is advisory, not a maximum",
      });
      continue;
    }
    // Below half again the maximum the prescriber may have a reason, so it stays
    // advisory in BOTH planes. Past 1.5x it is a never-event of the same class as
    // a forbidden interval, and it must reach a human rather than print "all
    // checks passed": the same hazard-plus-queue shape the interval law uses.
    // Measured divergence this closes: "Tab Cetzine 10 BD x 5 days" (20 mg against
    // a 10 mg cap) used to verdict pass in the Python tier and interaction here.
    if (total <= limit * 1.5) {
      findings.push({ kind: "dose", molecule: mol, severity: "moderate", note });
      continue;
    }
    const brands = [...new Set(contributors[mol].map((m) => m.brand ?? m.rawText))];
    doseHazards.push({
      kind: "dose_hazard",
      molecule: mol,
      brand: brands.join(" + "),
      severity: "severe",
      observed: `${formatMg(total)} mg/day`,
      required: `no more than ${limit} mg/day`,
      note,
      source: CAP_SOURCE,
    });
    for (const m of contributors[mol]) {
      if (queuedLines.has(m.line)) continue;
      queuedLines.add(m.line);
      confirmQueue.push({
        line: m.line,
        rawText: m.rawText,
        reason: "Daily dose exceeds the label maximum",
        band: "confirm",
        why: note,
      });
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
  return finish(verdict, headlineFor(verdict, findings, confirmQueue, doseHazards), findings, confirmed, confirmQueue, doseHazards, aggregate, t0, gate);
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
 *   1. anything in confirm queue   -> confirm_queue
 *   2. contraindication            -> contraindication
 *   3. severe interaction/combination -> interaction
 *   4. duplicate                   -> duplicate
 *   5. moderate interaction        -> interaction
 *   6. severe dose breach          -> interaction
 *   7. otherwise                   -> pass
 * Dose findings below "severe" are notes for the human, never verdicts.
 *
 * The queue outranks every clinical finding, which is also the Python tier's
 * order (apps/api/app/verdict.py steps 3-5 precede steps 6-9). Two independent
 * reasons, and the planes must not disagree about either:
 *
 *   * A queued line is an *unresolved* line. Findings computed on top of it are
 *     built on an identity or a dose we have not confirmed, so they cannot be
 *     the last word; and a verdict other than confirm_queue would let a plan be
 *     built from a med a human has not yet accepted.
 *   * A never-event interval is not a warning. A methotrexate + NSAID pair does
 *     not stop being an interaction because the interval is wrong — the
 *     interaction is still computed and still shown — but no plan may be
 *     generated from the line until a human confirms the interval.
 *
 * Because every dose hazard also enqueues its line, the hazard needs no rule of
 * its own here: queue-first already covers it, and one precedence rule cannot
 * drift out of sync with a second one.
 */
function assembleVerdict(
  findings: Finding[],
  queue: ConfirmItem[]
): VerdictKind {
  if (queue.length) return "confirm_queue";
  if (findings.some((f) => f.kind === "contraindication")) return "contraindication";
  if (findings.some((f) => (f.kind === "interaction" || f.kind === "combination") && f.severity === "severe")) return "interaction";
  if (findings.some((f) => f.kind === "duplicate")) return "duplicate";
  if (findings.some((f) => (f.kind === "interaction" || f.kind === "combination") && f.severity === "moderate")) return "interaction";
  // No dose slot: a dangerous dose reaches a human through the queue above, the
  // same route the interval law uses, instead of being mislabelled an "interaction".
  return "pass";
}

function headlineFor(
  v: VerdictKind,
  findings: Finding[],
  queue: ConfirmItem[],
  hazards: DoseHazardFinding[] = []
): string {
  switch (v) {
    case "pass": return "All checks passed";
    case "interaction":
    case "combination": return "Interaction found";
    case "contraindication": return "Contraindication in declared context";
    case "duplicate": return "Duplicate medication detected";
    case "confirm_queue":
      if (hazards.length) {
        return hazards[0].source === CAP_SOURCE
          ? `${hazards[0].brand}: the daily dose exceeds the label maximum — confirm before scheduling`
          : `${hazards[0].brand}: dosing interval contradicts the label — confirm before scheduling`;
      }
      return queue.length ? "Confirmation needed before this plan is spoken aloud" : "Confirmation needed";
    case "refused": return "Refused — cannot verify this prescription";
  }
}

function finish(
  verdict: VerdictKind,
  headline: string,
  findings: Finding[],
  confirmed: NormalizedMed[],
  confirmQueue: ConfirmItem[],
  doseHazards: DoseHazardFinding[],
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
    doseHazards,
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
