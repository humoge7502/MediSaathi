"use client";

/** Evidence panel — the judge magnet.
 *  1. Deterministic engine self-test (18 labeled cases, no LLM, no network).
 *  2. Copilot evaluation suite (groundedness / safety rubric judge).
 *  Nothing here is claimed to be clinical validation — it is engineering telemetry.
 */

import { useEffect, useState } from "react";
import { api, post } from "@/lib/client";

interface EvidenceData {
  engine: {
    snapshot: string;
    cases: { id: string; label: string; expected: string; actual: string; pass: boolean; findingHit: boolean; engineMs: number }[];
    passRate: number;
    suiteMs: number;
    n: number;
  };
  dataset: { brands: number; interactions: number; contraindications: number; combinationRules: number; interactionSources: string[] };
  copilot: { knowledgeChunks: number; sources: string[] };
}

interface EvalOutcome {
  rows: { id: string; expected: string; actual: string; typePass: boolean; mentionPass: boolean | null; groundedness: number; safety: number; helpfulness: number; latencyMs: number }[];
  means: { typeAccuracy: number | null; groundedness: number | null; safety: number | null; helpfulness: number | null; latencyMs: number | null };
  judgeAvailable: boolean;
  totalMs: number;
}

export function EvidencePanel() {
  const [data, setData] = useState<EvidenceData | null>(null);
  const [evalOutcome, setEvalOutcome] = useState<EvalOutcome | null>(null);
  const [evalBusy, setEvalBusy] = useState(false);
  const [evalErr, setEvalErr] = useState<string | null>(null);

  useEffect(() => {
    api<EvidenceData>("/api/evidence").then(setData).catch(() => setData(null));
  }, []);

  async function runEvals() {
    setEvalBusy(true);
    setEvalErr(null);
    setEvalOutcome(null);
    try {
      setEvalOutcome(await post<EvalOutcome>("/api/evals", {}));
    } catch (e) {
      setEvalErr(e instanceof Error ? e.message : "Evaluation failed");
    } finally {
      setEvalBusy(false);
    }
  }

  if (!data) return <div className="vy-hairline-card animate-pulse p-10 text-center text-sm text-muted-foreground">Running the engine suite…</div>;

  const failed = data.engine.cases.filter((c) => !c.pass);

  return (
    <div className="space-y-6">
      {/* ---------- deterministic engine ---------- */}
      <div className="vy-hairline-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="vy-eyebrow">Deterministic safety engine — self-test</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.engine.n} labeled prescriptions through the full rule pipeline. No LLM, no network.
              This is the plane that would carry safety if every model vanished.
            </p>
          </div>
          <div className="text-right">
            <p className="vy-numeral vy-serif text-4xl" style={{ color: data.engine.passRate === 1 ? "var(--vy-safe)" : "var(--vy-warn)" }}>
              {Math.round(data.engine.passRate * 100)}%
            </p>
            <p className="vy-numeral text-xs text-muted-foreground">{data.engine.n} cases · {data.engine.suiteMs} ms total</p>
          </div>
        </div>
        <div className="vy-scroll mt-4 max-h-80 overflow-y-auto rounded-lg border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-secondary text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Case</th>
                <th className="px-3 py-2 font-medium">Expected</th>
                <th className="px-3 py-2 font-medium">Actual</th>
                <th className="px-3 py-2 font-medium">ms</th>
                <th className="px-3 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="vy-numeral">
              {data.engine.cases.map((c) => (
                <tr key={c.id} className="border-t" title={failed.find((f) => f.id === c.id) ? "case or finding did not match" : ""}>
                  <td className="px-3 py-2 text-muted-foreground">{c.id}</td>
                  <td className="px-3 py-2">{c.label}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.expected}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.actual}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.engineMs}</td>
                  <td className={`px-3 py-2 font-semibold ${c.pass ? "vy-sev-pass" : "vy-sev-severe"}`}>{c.pass ? "PASS" : "FAIL"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- dataset provenance ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Provenance label="Brand formulary" value={`${data.dataset.brands}`} sub="Jan Aushadhi-derived, INR prices" />
        <Provenance label="Interaction rules" value={`${data.dataset.interactions}`} sub={`sources: ${data.dataset.interactionSources.join(" · ")}`} />
        <Provenance label="Contraindication rules" value={`${data.dataset.contraindications}`} sub={`${data.dataset.combinationRules} combination-rule groups`} />
        <Provenance label="Copilot knowledge" value={`${data.copilot.knowledgeChunks}`} sub={`sources: ${data.copilot.sources.join(" · ")}`} />
      </div>

      {/* ---------- copilot evaluation ---------- */}
      <div className="vy-hairline-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="vy-eyebrow">Copilot evaluation suite</p>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              10 labeled questions (grounded answers, scope refusals, an emergency redirect, an out-of-scope trap)
              run through the full three-gate pipeline, then scored by an automated rubric judge.
              <strong className="text-foreground"> This is engineering telemetry, not clinical validation.</strong>
            </p>
          </div>
          <button
            onClick={runEvals}
            disabled={evalBusy}
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02] disabled:opacity-40"
            style={{ background: "var(--vy-clay)" }}
          >
            {evalBusy ? "Running 10 cases…" : "Run evaluation"}
          </button>
        </div>
        {evalErr && <p className="mt-3 text-sm vy-sev-severe">{evalErr}</p>}
        {evalOutcome && (
          <div className="vy-fade-up mt-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <EvalKPI label="Type accuracy" value={pct(evalOutcome.means.typeAccuracy)} />
              <EvalKPI label="Groundedness" value={score(evalOutcome.means.groundedness)} />
              <EvalKPI label="Safety" value={score(evalOutcome.means.safety)} />
              <EvalKPI label="Avg latency" value={evalOutcome.means.latencyMs != null ? `${Math.round(evalOutcome.means.latencyMs)} ms` : "—"} />
            </div>
            <div className="vy-scroll mt-4 max-h-80 overflow-y-auto rounded-lg border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-secondary text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">ID</th>
                    <th className="px-3 py-2 font-medium">Expected</th>
                    <th className="px-3 py-2 font-medium">Actual</th>
                    <th className="px-3 py-2 font-medium">Grounded</th>
                    <th className="px-3 py-2 font-medium">Safe</th>
                    <th className="px-3 py-2 font-medium">Helpful</th>
                    <th className="px-3 py-2 font-medium">Latency</th>
                    <th className="px-3 py-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody className="vy-numeral">
                  {evalOutcome.rows.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2 text-muted-foreground">{r.id}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.expected}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.actual}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.groundedness >= 0 ? r.groundedness.toFixed(2) : "judge n/a"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.safety >= 0 ? r.safety.toFixed(2) : "judge n/a"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.helpfulness >= 0 ? r.helpfulness.toFixed(2) : "judge n/a"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.latencyMs} ms</td>
                      <td className={`px-3 py-2 font-semibold ${r.typePass ? "vy-sev-pass" : "vy-sev-severe"}`}>{r.typePass ? "PASS" : "DIFF"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Judge: automated rubric (GLM), single-sample, no human review yet. DIFF rows are engineering signals —
              the honest display of a disagreement matters more than a green table.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Provenance({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="vy-hairline-card p-5">
      <p className="vy-eyebrow">{label}</p>
      <p className="vy-numeral vy-serif mt-2 text-4xl" style={{ color: "var(--vy-pine)" }}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function EvalKPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="vy-numeral text-2xl font-semibold">{value}</p>
    </div>
  );
}

function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}
function score(v: number | null): string {
  return v == null ? "—" : v.toFixed(2);
}
