/**
 * Active-regimen state from the persisted data path (TD-14).
 *
 * The longitudinal regimen screen (lib/safety/regimen.ts) needs the set of
 * medicines the patient is ALREADY taking. The product's real regimen state is
 * the active `TherapyPlan` and its `Medication` rows — read here, server-side,
 * never caller-supplied — so a new prescription is screened against what the
 * patient is actually on, not against an attacker-controllable list.
 *
 * Day arithmetic: day 0 is "now" (the verify call). A medication's start day is
 * derived from its own first scheduled dose relative to the plan's first dose
 * (today both are 0, but the derivation survives staggered starts). Expired
 * plans simply leave no active entries.
 */
import { db } from "@/lib/db";
import { frequencyPerDay, normalizeLine, type SafetyReport } from "@/lib/safety/engine";
import { screenRegimen, type RegimenEntry, type RegimenScreen } from "@/lib/safety/regimen";

const DAY_MS = 24 * 60 * 60 * 1000;

function dayFloor(d: Date): number {
  return Math.floor(d.getTime() / DAY_MS);
}

export async function activeRegimenEntries(): Promise<RegimenEntry[]> {
  const patient = await db.patient.findFirst();
  if (!patient) return [];

  const plan = await db.therapyPlan.findFirst({
    where: { patientId: patient.id, status: "active" },
    include: {
      medications: {
        include: { doses: { orderBy: { scheduledAt: "asc" }, take: 1 } },
      },
    },
  });
  if (!plan || plan.medications.length === 0) return [];

  // Plan start = the earliest first dose across medications (day 0 reference).
  const firstDoses = plan.medications
    .map((m) => m.doses[0]?.scheduledAt)
    .filter((d): d is Date => d instanceof Date);
  if (firstDoses.length === 0) return [];
  const planStartDay = Math.min(...firstDoses.map(dayFloor));

  const entries: RegimenEntry[] = [];
  for (const med of plan.medications) {
    const first = med.doses[0]?.scheduledAt;
    if (!first) continue;
    const startedDay = Math.max(0, dayFloor(first) - planStartDay);
    const perDay = frequencyPerDay(med.frequencyCode);
    entries.push({
      brand: med.brand,
      startedDay,
      durationDays: Math.max(1, med.durationDays),
      dailyMg: perDay != null && med.doseMg > 0 ? med.doseMg * perDay : null,
      source: "active-plan",
    });
  }
  return entries;
}

// ------------------------------------------------------ the escalation law

export interface RegimenEscalationResult {
  regimen: RegimenScreen | null;
  finalVerdict: string;
  /** Human-readable headline matching finalVerdict (promotion included). */
  finalHeadline: string;
  /** Field queue + (when escalated) the synthetic fieldIndex-0 row. */
  confirmQueue: SafetyReport["confirmQueue"];
  /** The regimen layer changed the outcome (verdict promotion or queue). */
  escalated: boolean;
}

/** Verdict→headline mapping, mirroring engine.ts headlineFor for promoted verdicts. */
function headlineForVerdict(v: string): string {
  switch (v) {
    case "interaction": return "Interaction found";
    case "duplicate": return "Duplicate medication detected";
    case "contraindication": return "Contraindication in declared context";
    default: return "Confirmation needed — cross-prescription screen";
  }
}

/**
 * The regimen escalation law — the ONE place it exists (verify and the queue
 * resolve path must apply it identically).
 *
 *   · a COMPOSED harm the single prescription cannot see (crossing finding
 *     from active+incoming) escalates the published verdict to the union
 *     verdict — the E-H result shipped end-to-end;
 *   · read UNCERTAINTY that could hide harm (fragility > threshold) escalates
 *     to the confirm queue — a fragile read is never published as a confident
 *     pass; the block is enforced in the plan transaction like every other
 *     queued field, and a human resolution records acceptance of the residual
 *     uncertainty (the E-G reviewed arm);
 *   · a same-brand duplicate is a REFILL, not a composed harm: re-verifying
 *     the medicine already on the plan keeps passing.
 *
 * Escalation only ever fires from a nominal `pass`: harmful verdicts already
 * route through the finding/queue state machine unchanged.
 */
export async function applyRegimenEscalation(
  report: SafetyReport,
  extraction: { lines?: { raw: string; confidence: number }[]; engine?: string },
  contexts: string[],
  thresholdSetId?: string,
  opts: { zeroResolved?: boolean } = {}
): Promise<RegimenEscalationResult> {
  let regimen: RegimenScreen | null = null;
  try {
    const activeEntries = await activeRegimenEntries();
    if (activeEntries.length > 0) {
      // Field identity = the brand the engine RESOLVED from each line (exact
      // formulary text — the raw line would never exact-match), with the same
      // confidence the gate consumed; unresolved lines keep their raw text so
      // the confusion neighbourhood can absorb or unknown-mass them.
      regimen = screenRegimen({
        fields: (extraction.lines ?? []).map((l, i) => {
          const med = normalizeLine(l.raw, i + 1);
          const confidence =
            extraction.engine === "llm" ? l.confidence : med.brandConfidence;
          return { brandText: med.brand ?? l.raw, confidence };
        }),
        active: activeEntries,
        contexts,
        thresholdSetId,
      });
    }
  } catch {
    regimen = null; // regimen state is additive; its failure must not break verify
  }

  const confirmQueue = [...report.confirmQueue];
  let finalVerdict: string = report.verdict;
  let finalHeadline = report.headline;
  let escalated = false;

  // A crossing duplicate whose molecule list dedupes to ONE brand name is the
  // refill signature ("Losar 50" while "Losar 50" is active): not a harm.
  // A cross-brand duplicate (Clopilet while Deplatt active) lists TWO brands.
  const crossingFindings = regimen ? regimen.findings.filter((f) => f.crossing) : [];
  const refillOnly =
    crossingFindings.length > 0 &&
    crossingFindings.every((f) => f.kind === "duplicate" && f.molecules.length === 1);
  const eligible =
    regimen !== null && report.verdict === "pass" && report.confirmQueue.length === 0;

  if (eligible && regimen) {
    if (
      // A recorded human resolution of the escalation row (or one happening
      // right now) is the E-G reviewed arm: the acceptance of the residual
      // uncertainty stands, so the fragility queue must not re-fire — that
      // would deadlock the decision behind an unchanged fragility. Publish
      // the nominal verdict the reviewer effectively signed off on.
      opts.zeroResolved
    ) {
      finalVerdict =
        regimen.nominalVerdict === "duplicate_atc" ? "duplicate" : regimen.nominalVerdict;
      if (finalVerdict !== "pass") finalHeadline = headlineForVerdict(finalVerdict);
      escalated = finalVerdict !== report.verdict;
    } else if (regimen.queued) {
      // Mechanism B: fragile read — never publish a confident pass the read
      // error could flip. Rides the persisted queue (fieldIndex 0).
      finalVerdict = "confirm_queue";
      finalHeadline = "Confirmation needed — cross-prescription screen";
      confirmQueue.push({
        line: 0,
        rawText: "cross-prescription screen",
        reason: regimen.fragility > 0
          ? `Regimen uncertainty: read could flip the verdict (fragility ${regimen.fragility.toFixed(2)})`
          : `Regimen screen: verify against the active plan (${regimen.provenance.activeCount} active medicine(s))`,
        band: "confirm",
        why: regimen.worstVerdict !== "pass"
          ? `worst reachable verdict under read error: ${regimen.worstVerdict}`
          : "cross-prescription composition queued this read",
      });
      escalated = true;
    } else if (!refillOnly) {
      // Mechanism A, believed world: a composed harm the single prescription
      // cannot see. Promote to the screen's union verdict.
      finalVerdict = regimen.verdict === "duplicate_atc" ? "duplicate" : regimen.verdict;
      if (finalVerdict !== "pass") finalHeadline = headlineForVerdict(finalVerdict);
      escalated = finalVerdict !== report.verdict;
    }
    // else: refill-only composition — the patient re-received their own
    // medicine; the single-Rx pass stands.
  }

  return { regimen, finalVerdict, finalHeadline, confirmQueue, escalated };
}
