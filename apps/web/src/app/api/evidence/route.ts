import { ok } from "@/lib/api-helpers";
import { runEngineSuite, ENGINE_TEST_CASES } from "@/lib/safety/selftest";
import { INTERACTIONS, CONTRAINDICATIONS, BRANDS, MOLECULE_GROUPS, SNAPSHOT } from "@/lib/safety/dataset";
import { KNOWLEDGE } from "@/lib/ai/knowledge";
// Generated artifact (MED-013): `python tools/export_evidence.py` compiles the
// archived experiment runs into this file. It is NOT computed at request time —
// the numbers are the archived ones, with their dataset snapshot and engine SHA
// attached, so the panel can label exactly which run produced them.
import experimentEvidence from "@/data/evidence.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/evidence — the judge's evidence page endpoint.
 * Runs the deterministic engine self-test suite (no LLM, no network),
 * returns dataset provenance stats, and returns the compiled experiment
 * evidence (baseline ladder, ablations, calibration, parity, latency, HITL).
 */
export async function GET() {
  const suite = runEngineSuite();
  return ok({
    engine: {
      snapshot: SNAPSHOT,
      cases: suite.results,
      passRate: Math.round(suite.passRate * 1000) / 1000,
      suiteMs: suite.totalMs,
      n: ENGINE_TEST_CASES.length,
    },
    dataset: {
      brands: BRANDS.length,
      interactions: INTERACTIONS.length,
      contraindications: CONTRAINDICATIONS.length,
      combinationRules: Object.keys(MOLECULE_GROUPS).length,
      interactionSources: [...new Set(INTERACTIONS.map((i) => i.source))],
    },
    copilot: {
      knowledgeChunks: KNOWLEDGE.length,
      sources: [...new Set(KNOWLEDGE.map((k) => k.source))],
    },
    experiments: experimentEvidence,
  });
}
