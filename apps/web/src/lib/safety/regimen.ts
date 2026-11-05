/**
 * Longitudinal regimen safety state with read-uncertainty propagation.
 *
 * TypeScript mirror of `apps/api/app/safety/regimen.py` (TD-12 in
 * docs/TECH_DEBT.md). The Python module is normative; this port keeps the law
 * identical — same mechanisms, same constants, same decision order — so a
 * future parity corpus can pin the two planes together (same rule as gate.ts).
 *
 * This module extends the two-plane law from *one prescription in isolation*
 * to the patient's **time-composed regimen** — the set of medicines already
 * active when a new prescription arrives — and makes the gate operate on the
 * *verdict* as well as on the field.
 *
 * Two mechanisms, deliberately coupled:
 *
 * **A. Regimen state composition.**  The deterministic plane screens a new
 * prescription against the union of (a) the incoming, gated fields and (b)
 * the medications already active on the patient. Combination-class harms that
 * no single prescription can reveal — a triple whammy assembled from two
 * visits, a third QT-prolonger added later, the same molecule reached through
 * a different brand — become expressible. Findings carry a `crossing` flag
 * recording whether they exist only because the two artifacts were composed.
 *
 * **B. Verdict-level uncertainty propagation.**  A perception read is a
 * distribution, not a fact. Each incoming field carries a mass distribution
 * over formulary identities: the resolved brand holds its reading confidence,
 * and the residual mass is spread over a *confusion neighbourhood* derived
 * from brand string similarity (dropping strength digits), with whatever
 * cannot be absorbed left as an explicit `unknown` mass. Enumerating the
 * (pruned) cross-product of those distributions yields an exact verdict
 * distribution. Two derived quantities matter:
 *
 * - `fragility` — the mass of reads whose verdict differs from the nominal
 *   one. Read error could flip the decision, so the answer is not robust to it.
 * - `worstMass` — the worst-case verdict reachable and the mass that reaches it.
 *
 * The coupling is the point: **fragility above a threshold forces the confirm
 * queue**, so uncertainty the reader could not resolve deterministically halts
 * downstream automation exactly as a low-confidence field does. A fragile read
 * is never reported as a confident `pass`.
 *
 * The module is deterministic (no sampling, no network) and reuses the
 * existing rule plane (engine.ts) rather than re-implementing it.
 */

import {
  BRANDS,
  CONTRAINDICATIONS,
  INTERACTIONS,
  MOLECULE_GROUPS,
  type InteractionRow,
} from "./dataset";
import { DEFAULT_THRESHOLD_SET_ID, getThresholdSet } from "./gate";
// The identity law is imported, not mirrored: the longitudinal screen and the
// single-prescription screen must match a medication under the same names, or a
// combination brand is adjudicated twice and answered differently (ADR-0012).
import { moleculeIdentities } from "./engine";

// ---------------------------------------------------------------- constants

/** Verdict severity used to compare dispositions (harm order, not prevalence). */
export const VERDICT_HARM: Record<string, number> = {
  pass: 0,
  duplicate_atc: 1,
  interaction: 2,
  contraindication: 3,
};

/** Default stiffness of the fragility→queue coupling (mirrors regimen.py). */
export const DEFAULT_FRAGILITY_THRESHOLD = 0.05;

/** How many confusion competitors per field may enter the enumeration. */
export const DEFAULT_MAX_IDENTITIES = 4;
export const MAX_WORLDS = 1024;

/** Similarity floor for a brand to count as a confusion neighbour of a read. */
export const DEFAULT_SIMILARITY = 0.55;

/** Contexts that map to "relative" contraindication severities stay moderate. */
const CONTRA_HARM_ORDER = ["contraindication", "combination", "interaction", "duplicate"] as const;

// ---------------------------------------------------------------- helpers

function splitMolecules(molecule: string): string[] {
  return (molecule || "")
    .split("+")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
}

function splitAtc(s: string): string[] {
  return (s || "")
    .replace(/,/g, "+")
    .split("+")
    .map((m) => m.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------- regimen state

/** One medicine already on the patient's regimen, with its active window. */
export interface ActiveMed {
  brand: string;
  molecules: string[];
  atc: string;
  dailyMg: number | null;
  startedDay: number;
  durationDays: number;
  source: string;
}

function activeOn(med: ActiveMed, day: number): boolean {
  return med.startedDay <= day && day < med.startedDay + med.durationDays;
}

/** Build an `ActiveMed` from a formulary row (BRANDS entry). */
export function activeMedFromRow(
  row: (typeof BRANDS)[number],
  opts: { startedDay?: number; durationDays?: number; dailyMg?: number | null; source?: string } = {}
): ActiveMed {
  return {
    brand: row.brand,
    molecules: splitMolecules(row.molecule),
    atc: row.atc || "",
    dailyMg: opts.dailyMg ?? null,
    startedDay: opts.startedDay ?? 0,
    durationDays: opts.durationDays ?? 30,
    source: opts.source ?? "active-plan",
  };
}

/**
 * Raw regimen entry as persisted by the product tier (Medication rows):
 * the brand text plus the active window. Unknown brands are dropped here —
 * they can only *add* exposure, and the incoming prescription's own gate is
 * what refuses to auto-confirm unknown reads.
 */
export interface RegimenEntry {
  brand: string;
  startedDay?: number;
  durationDays?: number;
  dailyMg?: number | null;
  source?: string;
}

const brandIndex: Map<string, (typeof BRANDS)[number]> = new Map(
  BRANDS.map((b) => [b.brand.toLowerCase(), b])
);

/** Resolve raw regimen entries against the formulary, keeping only active ones. */
export function regimenState(entries: RegimenEntry[], asOfDay = 0): ActiveMed[] {
  const out: ActiveMed[] = [];
  for (const e of entries) {
    const row = brandIndex.get((e.brand || "").trim().toLowerCase());
    if (!row) continue;
    const med = activeMedFromRow(row, {
      startedDay: e.startedDay ?? 0,
      durationDays: e.durationDays ?? 30,
      dailyMg: e.dailyMg ?? null,
      source: e.source ?? "active-plan",
    });
    if (activeOn(med, asOfDay)) out.push(med);
  }
  return out;
}

// ---------------------------------------------------------------- identity mass

/** One possible identity of a read field, with its probability mass. */
export interface IdentityCandidate {
  brand: string;
  molecules: string[];
  atc: string;
  mass: number;
  kind: "resolved" | "neighbour" | "unknown";
}

/** Alphabetic core of a brand, strength digits/forms removed ("Levipil 500" -> "levipil"). */
export function brandCore(brand: string): string {
  return [...(brand || "").toLowerCase()].filter((ch) => ch >= "a" && ch <= "z").join("");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Normalised similarity in [0, 1] over brand cores. */
export function similarity(a: string, b: string): number {
  const ca = brandCore(a);
  const cb = brandCore(b);
  if (!ca || !cb) return 0;
  return 1 - levenshtein(ca, cb) / Math.max(ca.length, cb.length);
}

/** Formulary brands close enough to a read to be plausible mis-reads. */
export function confusionNeighbours(
  readBrand: string,
  floor = DEFAULT_SIMILARITY,
  limit = DEFAULT_MAX_IDENTITIES
): { sim: number; row: (typeof BRANDS)[number] }[] {
  const own = brandIndex.get(readBrand.trim().toLowerCase());
  const ownBrand = own?.brand ?? null;
  const scored: { sim: number; row: (typeof BRANDS)[number] }[] = [];
  for (const row of BRANDS) {
    if (ownBrand !== null && row.brand === ownBrand) continue;
    const sim = similarity(readBrand, row.brand);
    if (sim >= floor) scored.push({ sim, row });
  }
  scored.sort((x, y) => y.sim - x.sim || x.row.brand.localeCompare(y.row.brand));
  return scored.slice(0, limit);
}

/**
 * Per-field distribution over formulary identities.
 *
 * - resolvable read → resolved brand at `confidence`; residual `1 - confidence`
 *   spread over confusion neighbours ∝ similarity;
 * - unresolvable read → the whole confidence is residual, absorbed by
 *   neighbours or left as `unknown`;
 * - mass that no neighbour absorbs stays on an explicit `unknown` candidate
 *   (no molecules), which can never *add* a harm — it can only demote.
 */
export function identityDistribution(
  readBrand: string,
  confidence: number,
  floor = DEFAULT_SIMILARITY,
  maxIdentities = DEFAULT_MAX_IDENTITIES
): IdentityCandidate[] {
  const conf = Math.max(0, Math.min(1, Number(confidence) || 0));
  const own = brandIndex.get(readBrand.trim().toLowerCase());
  const cands: IdentityCandidate[] = [];
  let residual = conf;

  if (own) {
    cands.push({
      brand: own.brand,
      molecules: splitMolecules(own.molecule),
      atc: own.atc || "",
      mass: conf,
      kind: "resolved",
    });
    residual = 1 - conf;
  }

  const neighbours = confusionNeighbours(readBrand, floor, maxIdentities);
  const totalSim = neighbours.reduce((a, n) => a + n.sim, 0);
  let absorbed = 0;
  if (totalSim > 0 && residual > 0) {
    for (const { sim, row } of neighbours) {
      const mass = residual * (sim / totalSim);
      absorbed += mass;
      cands.push({
        brand: row.brand,
        molecules: splitMolecules(row.molecule),
        atc: row.atc || "",
        mass,
        kind: "neighbour",
      });
    }
  }

  const leftover = Math.max(0, residual - absorbed);
  if (leftover > 1e-9) {
    cands.push({ brand: "", molecules: [], atc: "", mass: leftover, kind: "unknown" });
  }

  cands.sort((a, b) => b.mass - a.mass);
  const kept = cands.slice(0, maxIdentities);
  const total = kept.reduce((a, c) => a + c.mass, 0);
  if (total <= 0) {
    return [{ brand: "", molecules: [], atc: "", mass: 1.0, kind: "unknown" }];
  }
  return kept.map((c) => ({
    ...c,
    mass: Math.round((c.mass / total) * 1e9) / 1e9,
  }));
}

// ---------------------------------------------------------------- union screening

export type RegimenFindingKind = "interaction" | "combination" | "duplicate" | "contraindication";

export interface RegimenFinding {
  kind: RegimenFindingKind;
  molecules: string[];
  severity: "mild" | "moderate" | "severe";
  mechanism: string;
  source: string;
  /** Only exists because active + incoming were composed. */
  crossing: boolean;
  /** Read-mass that reaches this finding. */
  mass: number;
}

interface IncomingIdentity {
  brand: string | null;
  molecules: string[];
  atc: string;
}

const pairIndex: Map<string, InteractionRow> = new Map();
for (const row of INTERACTIONS) {
  pairIndex.set([row.a, row.b].sort().join("|"), row);
}

const contraByMolecule: Map<string, (typeof CONTRAINDICATIONS)[number][]> = new Map();
for (const row of CONTRAINDICATIONS) {
  const list = contraByMolecule.get(row.molecule) ?? [];
  list.push(row);
  contraByMolecule.set(row.molecule, list);
}

function groupOf(molecule: string, group: string): boolean {
  return (MOLECULE_GROUPS[group] ?? []).includes(molecule);
}

/** The existing deterministic rule plane over the union of active + incoming. */
function screenUnion(
  active: ActiveMed[],
  incoming: IncomingIdentity[],
  contexts: string[]
): { findings: RegimenFinding[]; union: string[] } {
  const activeMols = new Set<string>();
  for (const m of active) for (const mol of m.molecules) activeMols.add(mol);
  const incomingMols = new Set<string>();
  for (const c of incoming) for (const mol of c.molecules) incomingMols.add(mol);
  const union = [...new Set([...activeMols, ...incomingMols])];

  const findings: RegimenFinding[] = [];

  const crossing = (mols: string[]): boolean =>
    mols.some((m) => activeMols.has(m)) && mols.some((m) => incomingMols.has(m));

  // 1. pairwise interactions, walked over *medication pairs* with each side
  // expanded through the same identity law the single-Rx plane uses. The pooled
  // component walk this replaces could only ever name a component, so the 176
  // interaction rows keyed on a whole combination stayed dead code here even
  // after the nominal plane learned to reach them — and a pooled walk also pairs
  // a drug's own components with each other, which is not an interaction.
  const bySide: { molecules: string[]; active: boolean }[] = [
    ...active.map((m) => ({ molecules: m.molecules, active: true })),
    ...incoming.map((c) => ({ molecules: c.molecules, active: false })),
  ];
  const pairPos = new Map<string, number>();
  for (let i = 0; i < bySide.length; i++) {
    for (let j = i + 1; j < bySide.length; j++) {
      const a = moleculeIdentities(bySide[i].molecules);
      const b = moleculeIdentities(bySide[j].molecules);
      const crosses = bySide[i].active !== bySide[j].active;
      for (const molA of a) {
        for (const molB of b) {
          const hit = pairIndex.get([molA, molB].sort().join("|"));
          if (!hit) continue;
          // One finding per documented row: a combination brand crosses several
          // identities against one partner (component + whole string) and the
          // same row can arrive from another pair of lines. The crossing flag is
          // OR-ed, because a row reached across the visit boundary is the
          // visit-boundary finding even if an identical pair sits inside one side.
          const pair = [hit.a.toLowerCase(), hit.b.toLowerCase()];
          const key = [...pair].sort().join("|");
          const pos = pairPos.get(key);
          if (pos === undefined) {
            pairPos.set(key, findings.length);
            findings.push({
              kind: "interaction",
              molecules: pair,
              severity: hit.severity,
              mechanism: hit.mechanism,
              source: hit.source,
              crossing: crosses,
              mass: 1.0,
            });
          } else if (crosses && !findings[pos].crossing) {
            findings[pos] = { ...findings[pos], crossing: true };
          }
        }
      }
    }
  }

  // 2. combination-class rules (pairwise-invisible) — same groups the single-Rx plane uses
  findings.push(...combinationRules(union, crossing));

  // 3. contraindications for the incoming identities against declared context.
  // Identities, not components: the 17 combination-keyed rows — artemether+
  // lumefantrine in pregnancy, ethinylestradiol+levonorgestrel in pregnancy —
  // are absolute, and naming only their components could never address them.
  for (const c of incoming) {
    for (const mol of moleculeIdentities(c.molecules)) {
      const rules = contraByMolecule.get(mol) ?? [];
      for (const rule of rules) {
        if (contexts.includes(rule.condition)) {
          findings.push({
            kind: "contraindication",
            molecules: [mol],
            severity: rule.severity === "absolute" ? "severe" : "moderate",
            mechanism: rule.note,
            source: "curated contraindication",
            crossing: false,
            mass: 1.0,
          });
        }
      }
    }
  }

  // 4. duplicate ATC across the union (same molecule reached by a new brand)
  const byAtc: { atc: string; brands: string[] }[] = [];
  const atcMap: Map<string, string[]> = new Map();
  for (const med of active) {
    for (const atc of splitAtc(med.atc)) {
      const list = atcMap.get(atc) ?? [];
      list.push(med.brand);
      atcMap.set(atc, list);
    }
  }
  for (const c of incoming) {
    for (const atc of splitAtc(c.atc)) {
      const list = atcMap.get(atc) ?? [];
      list.push(c.brand ?? "unresolved read");
      atcMap.set(atc, list);
    }
  }
  for (const [atc, brands] of [...atcMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (brands.length > 1) {
      byAtc.push({ atc, brands });
      findings.push({
        kind: "duplicate",
        molecules: [...new Set(brands)].sort(),
        severity: "moderate",
        mechanism: `Duplicate ATC class ${atc} across the active regimen and the new prescription`,
        source: "ATC class table",
        crossing: true,
        mass: 1.0,
      });
    }
  }

  return { findings, union };
}

/**
 * Combination rules over a molecule set — the same rules as engine.ts
 * (`combinationRules`), kept structurally identical so the two cannot drift.
 */
function combinationRules(
  molecules: string[],
  crossing: (mols: string[]) => boolean
): RegimenFinding[] {
  const out: RegimenFinding[] = [];
  const has = (g: string) => molecules.filter((m) => groupOf(m, g));

  // Triple whammy: RAAS blocker + diuretic + NSAID -> AKI risk
  const raas = has("raas_blocker");
  const diu = has("loop_or_thiazide");
  const nsaid = has("nsaid");
  if (raas.length && diu.length && nsaid.length) {
    const mols = [raas[0], diu[0], nsaid[0]];
    out.push({
      kind: "combination",
      molecules: mols,
      severity: "severe",
      mechanism: "RAAS blocker + diuretic + NSAID (triple whammy) — acute kidney injury risk",
      source: "BMJ/AKI guidance",
      crossing: crossing(mols),
      mass: 1.0,
    });
  }

  // QT stack: >= 3 QT-prolonging molecules
  const qt = has("qt_prolonging");
  if (qt.length >= 3) {
    out.push({
      kind: "combination",
      molecules: qt,
      severity: "severe",
      mechanism: `${qt.length} QT-prolonging medicines together — torsades risk`,
      source: "CredibleMeds",
      crossing: crossing(qt),
      mass: 1.0,
    });
  }

  // Serotonin stack: SSRI + >= 2 other serotonergic
  const ssri = has("ssri");
  const seroton = has("serotonergic").filter((m) => !ssri.includes(m));
  if (ssri.length && seroton.length >= 2) {
    const mols = [...ssri, ...seroton];
    out.push({
      kind: "combination",
      molecules: mols,
      severity: "severe",
      mechanism: "SSRI with multiple serotonergic agents — serotonin syndrome risk",
      source: "FDA/Stockley",
      crossing: crossing(mols),
      mass: 1.0,
    });
  }

  // Bleeding stack: anticoagulant/antiplatelet + SSRI + NSAID
  const blood = has("anticoagulant_or_antiplatelet");
  if (blood.length >= 1 && ssri.length >= 1 && nsaid.length >= 1) {
    const mols = [...blood, ...ssri, ...nsaid];
    out.push({
      kind: "combination",
      molecules: mols,
      severity: "severe",
      mechanism: "Antithrombotic + SSRI + NSAID — compounded GI bleeding risk",
      source: "BMJ",
      crossing: crossing(mols),
      mass: 1.0,
    });
  }

  return out;
}

/** Fixed precedence over the union finding stream (mirrors verdict.py). */
export function unionVerdict(findings: RegimenFinding[]): string {
  if (findings.some((f) => f.kind === "contraindication")) return "contraindication";
  if (findings.some((f) => (f.kind === "interaction" || f.kind === "combination") && f.severity === "severe"))
    return "interaction";
  if (findings.some((f) => f.kind === "duplicate")) return "duplicate_atc";
  if (findings.some((f) => (f.kind === "interaction" || f.kind === "combination") && f.severity === "moderate"))
    return "interaction";
  return "pass";
}

// ---------------------------------------------------------------- the screen

export interface RegimenScreen {
  /** Published verdict: pass | interaction | duplicate_atc | contraindication | confirm_queue | refused */
  verdict: string;
  /** Verdict of the highest-mass read assignment. */
  nominalVerdict: string;
  /** Highest-harm verdict reachable. */
  worstVerdict: string;
  /** Mass of reads whose verdict differs from the nominal one. */
  fragility: number;
  /** Mass that reaches worstVerdict. */
  worstMass: number;
  /** Fragility forced the confirm queue. */
  queued: boolean;
  /** Full distribution over worlds. */
  verdictMass: Record<string, number>;
  findings: RegimenFinding[];
  worlds: number;
  /** The incoming prescription's field-gate band. */
  gateBand: "refused" | "confirm" | "auto";
  provenance: Record<string, unknown>;
}

/** Cross-product of identity distributions, pruned to the highest-mass worlds. */
function pruneWorlds(
  dists: IdentityCandidate[][]
): { chosen: IdentityCandidate[]; mass: number }[] {
  let worlds: { chosen: IdentityCandidate[]; mass: number }[] = [{ chosen: [], mass: 1.0 }];
  for (const dist of dists) {
    const nxt: { chosen: IdentityCandidate[]; mass: number }[] = [];
    for (const { chosen, mass } of worlds) {
      for (const cand of dist) {
        nxt.push({ chosen: [...chosen, cand], mass: mass * cand.mass });
      }
    }
    nxt.sort(
      (a, b) =>
        b.mass - a.mass ||
        a.chosen.map((c) => c.brand).join(">").localeCompare(b.chosen.map((c) => c.brand).join(">"))
    );
    worlds = nxt.slice(0, MAX_WORLDS);
  }
  const total = worlds.reduce((a, w) => a + w.mass, 0);
  if (total <= 0) return [{ chosen: [], mass: 1.0 }];
  return worlds.map((w) => ({ chosen: w.chosen, mass: w.mass / total }));
}

/** Merge findings across worlds, summing the read-mass that reaches each. */
function annotateMass(
  findingsByWorld: RegimenFinding[][],
  worlds: { mass: number }[]
): RegimenFinding[] {
  const merged: Map<string, RegimenFinding> = new Map();
  for (let w = 0; w < findingsByWorld.length; w++) {
    const mass = Math.round(worlds[w].mass * 1e6) / 1e6;
    for (const f of findingsByWorld[w]) {
      const key = `${f.kind}|${f.mechanism}`;
      const cur = merged.get(key);
      if (!cur) {
        merged.set(key, { ...f, mass });
      } else {
        merged.set(key, { ...cur, mass: Math.round((cur.mass + mass) * 1e6) / 1e6 });
      }
    }
  }
  return [...merged.values()].sort(
    (a, b) =>
      CONTRA_HARM_ORDER.indexOf(a.kind as (typeof CONTRA_HARM_ORDER)[number]) -
        CONTRA_HARM_ORDER.indexOf(b.kind as (typeof CONTRA_HARM_ORDER)[number]) ||
      b.mass - a.mass ||
      a.mechanism.localeCompare(b.mechanism)
  );
}

export interface RegimenScreenInput {
  /** Incoming fields: brand text (or raw text) + reading confidence, 0-1. */
  fields: { brandText: string; rawText?: string; confidence: number }[];
  /** Patient's active regimen (already window-filtered or raw entries). */
  active: ActiveMed[] | RegimenEntry[];
  contexts?: string[];
  asOfDay?: number;
  fragilityThreshold?: number;
  propagate?: boolean;
  thresholdSetId?: string;
}

/**
 * Screen an incoming prescription against the patient's active regimen.
 *
 * The field gate runs first and unchanged: refusal/queue semantics on the
 * incoming prescription are preserved bit-for-bit from the single-Rx law.
 * `propagate: false` is the ablation switch that isolates mechanism B (the
 * regimen is composed but each field is treated as certain) — used by tests.
 */
export function screenRegimen(input: RegimenScreenInput): RegimenScreen {
  const {
    fields,
    active: rawActive,
    contexts = [],
    asOfDay = 0,
    fragilityThreshold = DEFAULT_FRAGILITY_THRESHOLD,
    propagate = true,
    thresholdSetId = DEFAULT_THRESHOLD_SET_ID,
  } = input;

  const thresholds = getThresholdSet(thresholdSetId);
  const active: ActiveMed[] = rawActive.length
    ? ("brand" in rawActive[0] && "molecules" in rawActive[0]
        ? (rawActive as ActiveMed[])
        : regimenState(rawActive as RegimenEntry[], asOfDay))
    : [];

  // Field gate band over the incoming prescription (the same three bands the
  // single-Rx law uses: refusal below REFUSE_BELOW on reading confidence;
  // confirm for anything not auto-confirmed).
  const confs = fields.map((f) => Math.max(0, Math.min(1, f.confidence)));
  const bands = confs.map((conf, i) => {
    const brandText = fields[i].brandText || fields[i].rawText || "";
    const resolvable = brandIndex.has(brandText.trim().toLowerCase());
    if (conf < thresholds.refuseBelow) return "refused" as const;
    if (conf < thresholds.confirmBelow || !resolvable) return "confirm" as const;
    return "auto" as const;
  });
  const gateBand: RegimenScreen["gateBand"] = bands.every((b) => b === "refused")
    ? "refused"
    : bands.some((b) => b === "refused" || b === "confirm")
      ? "confirm"
      : "auto";

  const dists: IdentityCandidate[][] = fields.map((f, i) => {
    const brandText = f.brandText || f.rawText || "";
    if (!propagate) return certainIdentity(brandText);
    return identityDistribution(brandText, confs[i]);
  });

  const worlds = pruneWorlds(dists);
  const verdictMass: Record<string, number> = {};
  const findingsByWorld: RegimenFinding[][] = [];
  for (const { chosen, mass } of worlds) {
    const incoming: IncomingIdentity[] = chosen.map((c) => ({
      brand: c.kind === "unknown" ? null : c.brand,
      molecules: c.molecules,
      atc: c.atc,
    }));
    const { findings } = screenUnion(active, incoming, contexts);
    findingsByWorld.push(findings);
    const v = unionVerdict(findings);
    verdictMass[v] = Math.round(((verdictMass[v] ?? 0) + mass) * 1e9) / 1e9;
  }

  // Nominal world: highest mass; ties broken toward the more harmful verdict
  // (mirrors the Python key `(mass, VERDICT_HARM[verdict])` maximisation).
  let nominalIdx = 0;
  for (let i = 1; i < worlds.length; i++) {
    const a = [worlds[i].mass, VERDICT_HARM[unionVerdict(findingsByWorld[i])] ?? 0];
    const b = [worlds[nominalIdx].mass, VERDICT_HARM[unionVerdict(findingsByWorld[nominalIdx])] ?? 0];
    if (a[0] > b[0] + 1e-12 || (Math.abs(a[0] - b[0]) <= 1e-12 && a[1] > b[1])) nominalIdx = i;
  }
  const nominalVerdict = unionVerdict(findingsByWorld[nominalIdx]);
  const fragility = Math.round((1 - worlds[nominalIdx].mass) * 1e6) / 1e6;
  const worstVerdict = Object.keys(verdictMass).reduce((worst, v) => {
    const vh = (a: string, b: string) =>
      (VERDICT_HARM[a] ?? 0) - (VERDICT_HARM[b] ?? 0) || (verdictMass[a] ?? 0) - (verdictMass[b] ?? 0);
    return vh(v, worst) > 0 ? v : worst;
  }, Object.keys(verdictMass)[0] ?? "pass");
  const worstMass = verdictMass[worstVerdict] ?? 0;

  const findings = annotateMass(findingsByWorld, worlds);

  // The coupling, stated precisely: uncertainty forces a human only when it
  // could *hide* harm — i.e. the nominal verdict is less harmful than one the
  // read uncertainty can still reach. If the nominal verdict is already the
  // worst reachable one, the harm is surfaced regardless of the read, so an
  // extra queue would buy nothing and would tax the reviewer for no reason.
  const couldHideHarm = (VERDICT_HARM[worstVerdict] ?? 0) > (VERDICT_HARM[nominalVerdict] ?? 0);
  const queued =
    gateBand === "confirm" || (propagate && fragility > fragilityThreshold && couldHideHarm);

  let published: string;
  if (gateBand === "refused") published = "refused";
  else if (queued) published = "confirm_queue";
  else published = nominalVerdict;

  return {
    verdict: published,
    nominalVerdict,
    worstVerdict,
    fragility,
    worstMass,
    queued,
    verdictMass,
    findings,
    worlds: worlds.length,
    gateBand,
    provenance: {
      mode: propagate ? "regimen+propagation" : "regimen-only (ablation B)",
      thresholdSetId: thresholds.setId,
      fragilityThreshold,
      couldHideHarm,
      similarityFloor: DEFAULT_SIMILARITY,
      activeCount: active.length,
      asOfDay,
      fieldDecisionsBand: gateBand,
    },
  };
}

/** Ablation-B identity: the resolved brand only (no confusion mass). */
function certainIdentity(readBrand: string): IdentityCandidate[] {
  const own = brandIndex.get(readBrand.trim().toLowerCase());
  if (!own) return [{ brand: "", molecules: [], atc: "", mass: 1.0, kind: "unknown" }];
  return [
    {
      brand: own.brand,
      molecules: splitMolecules(own.molecule),
      atc: own.atc || "",
      mass: 1.0,
      kind: "resolved",
    },
  ];
}
