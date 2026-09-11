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
  experiments: ExperimentEvidence;
}

/** Shape of the generated artifact `apps/web/src/data/evidence.json` (MED-013). */
interface ExperimentEvidence {
  schema_version: number;
  generated_at: string;
  dataset_snapshot: string;
  engine_git_sha: string;
  missing_runs: string[];
  runs: Record<string, string | null>;
  baseline_ladder: {
    split: string | null;
    n: number | null;
    arms: Record<string, {
      verdict_agreement: number | null;
      verdict_macro_f1: number | null;
      unsafe_auto_confirm_rate: number | null;
      queue_rate: number | null;
      refusal_rate: number | null;
      ece_safety: number | null;
    }>;
  };
  ablations: { n: number | null; deltas: Record<string, { delta_verdict_agreement: number; delta_unsafe_rate: number; delta_queue_rate: number }> };
  robustness: {
    held_in_n: number | null;
    all_invariants_hold: boolean | null;
    invented_brand_auto_confirm_rate: number | null;
    replay_refusal_rate: number | null;
    corruption: Record<string, { unsafe_auto_confirm_rate: number; queue_rate: number; verdict_changed_rate: number }>;
    boundary_sensitivity: { delta?: number; flips_on_bump?: number; unsafe_flips_on_bump?: number; interpretation?: string };
  };
  calibration: {
    default_id: string | null;
    frozen_operating_point_id: string | null;
    promoted_fitted_point: boolean | null;
    finding: string | null;
    calibration_split_n: number | null;
    test_split_n: number | null;
    grid_points: number;
    within_review_target_15pct: unknown[];
    frozen_on_test: {
      verdict_agreement: number | null;
      unsafe_auto_confirm_rate: number | null;
      queue_rate: number | null;
      refusal_rate: number | null;
      ece_safety: number | null;
      brier_safety: number | null;
      reliability: { lo: number; hi: number; n: number; mean_confidence: number | null; accuracy: number | null }[];
    };
  };
  parity: { n: number | null; corpus: string | null; python_ok: boolean | null; typescript_ok: boolean | null; both_engines_agree: boolean | null };
  latency: {
    plane_n: number | null;
    plane_p50_ms: number | null;
    plane_p95_ms: number | null;
    within_budget: boolean | null;
    bench: { endpoint: string; p50_ms: number; p95_ms: number }[];
  };
  hitl: {
    reviewer: Record<string, unknown>;
    arms: Record<string, { task_accuracy: number; coverage: number; reviewed_fields: number; mean_seconds_per_case: number }>;
    acceptance: Record<string, boolean>;
  };
  honesty: string;
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

      {/* ---------- archived experiment evidence (MED-013) ---------- */}
      {data.experiments && <ExperimentEvidencePanel x={data.experiments} />}
    </div>
  );
}

function ExperimentEvidencePanel({ x }: { x: ExperimentEvidence }) {
  const arms = Object.entries(x.baseline_ladder.arms);
  const abls = Object.entries(x.ablations.deltas);
  const reliability = x.calibration.frozen_on_test.reliability ?? [];
  const cal = x.calibration;

  return (
    <div className="vy-hairline-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="vy-eyebrow">Archived experiment evidence (E-A..E-G)</p>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Compiled from the run archive by <span className="font-mono">tools/export_evidence.py</span>. These are the
            stored numbers with their provenance — not recomputed at request time. Every row traces to a run
            directory under <span className="font-mono">eval/runs/</span>.
          </p>
        </div>
        <div className="text-right vy-numeral text-xs text-muted-foreground">
          <div>snapshot {x.dataset_snapshot}</div>
          <div>engine {x.engine_git_sha}</div>
          <div>{x.generated_at}</div>
        </div>
      </div>

      {x.missing_runs.length > 0 && (
        <p className="mt-3 rounded-md border px-3 py-2 text-xs vy-sev-moderate">
          Missing runs (reported as — rather than invented): {x.missing_runs.join(", ")}
        </p>
      )}

      {/* headline operating point */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <EvalKPI label="Frozen threshold set" value={cal.frozen_operating_point_id ?? "—"} />
        <EvalKPI label="Unsafe auto-confirms (test split)" value={fmtPct(cal.frozen_on_test.unsafe_auto_confirm_rate)} />
        <EvalKPI label="Review burden (queue rate)" value={fmtPct(cal.frozen_on_test.queue_rate)} />
        <EvalKPI label="Calibration ECE (safety)" value={fmt(cal.frozen_on_test.ece_safety, 4)} />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {cal.finding} · sweep over {cal.grid_points} grid points on the calibration split ({cal.calibration_split_n} cases), frozen point evaluated once on the held-out test split ({cal.test_split_n} cases).
      </p>

      {/* safety x burden ladder */}
      <div className="vy-scroll mt-5 overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-xs">
          <thead className="bg-secondary text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">arm (E-A, n={x.baseline_ladder.n})</th>
              <th className="px-3 py-2 font-medium">verdict agreement</th>
              <th className="px-3 py-2 font-medium">macro F1</th>
              <th className="px-3 py-2 font-medium">unsafe auto-confirm</th>
              <th className="px-3 py-2 font-medium">queue rate</th>
              <th className="px-3 py-2 font-medium">refusal rate</th>
            </tr>
          </thead>
          <tbody className="vy-numeral">
            {arms.map(([arm, a]) => (
              <tr key={arm} className={`border-t ${arm === "A4" ? "font-semibold" : ""}`}>
                <td className="px-3 py-2">{arm}{arm === "A4" ? " (shipped)" : ""}</td>
                <td className="px-3 py-2">{fmt(a.verdict_agreement, 3)}</td>
                <td className="px-3 py-2">{fmt(a.verdict_macro_f1, 3)}</td>
                <td className={`px-3 py-2 ${a.unsafe_auto_confirm_rate ? "vy-sev-severe" : "vy-sev-pass"}`}>{fmt(a.unsafe_auto_confirm_rate, 3)}</td>
                <td className="px-3 py-2">{fmt(a.queue_rate, 3)}</td>
                <td className="px-3 py-2">{fmt(a.refusal_rate, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ablations + reliability */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border p-4">
          <p className="vy-eyebrow">Ablations (E-B) — necessity of each stage</p>
          <table className="mt-3 w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr><th className="py-1 font-medium">removed</th><th className="py-1 font-medium">Δ agreement</th><th className="py-1 font-medium">Δ unsafe</th></tr>
            </thead>
            <tbody className="vy-numeral">
              {abls.map(([arm, d]) => (
                <tr key={arm} className="border-t">
                  <td className="py-1.5">{arm.replace("A4_minus_", "−")}</td>
                  <td className={`py-1.5 ${d.delta_verdict_agreement < 0 ? "vy-sev-severe" : ""}`}>{d.delta_verdict_agreement >= 0 ? "+" : ""}{d.delta_verdict_agreement.toFixed(3)}</td>
                  <td className={`py-1.5 ${d.delta_unsafe_rate > 0 ? "vy-sev-severe" : ""}`}>{d.delta_unsafe_rate >= 0 ? "+" : ""}{d.delta_unsafe_rate.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border p-4">
          <p className="vy-eyebrow">Reliability (E-D) — does 0.9 mean 0.9?</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Reported confidence vs empirical safety on the automated set. ECE {fmt(cal.frozen_on_test.ece_safety, 4)} · Brier {fmt(cal.frozen_on_test.brier_safety, 4)}.</p>
          <div className="mt-3 space-y-1">
            {reliability.filter((b) => b.n > 0).map((b) => (
              <div key={`${b.lo}`} className="flex items-center gap-2 text-[11px]">
                <span className="vy-numeral w-16 text-muted-foreground">{b.lo.toFixed(1)}–{b.hi.toFixed(1)}</span>
                <div className="relative h-3 flex-1 overflow-hidden rounded bg-secondary" title={`n=${b.n} confidence=${b.mean_confidence} accuracy=${b.accuracy}`}>
                  <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${(b.mean_confidence ?? 0) * 100}%`, background: "var(--vy-pine)" }} />
                  <div className="absolute inset-y-0 w-0.5 rounded" style={{ left: `${(b.accuracy ?? 0) * 100}%`, background: "var(--vy-clay)" }} />
                </div>
                <span className="vy-numeral w-20 text-right text-muted-foreground">n={b.n}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">bar = mean confidence · tick = empirical accuracy</p>
        </div>
      </div>

      {/* robustness, parity, latency */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <EvidenceStat
          label="Robustness (E-C)"
          value={x.robustness.all_invariants_hold ? "invariants hold" : "see report"}
          sub={`${x.robustness.held_in_n} cases × 6 corruption levels · invented brands auto-confirmed ${fmt(x.robustness.invented_brand_auto_confirm_rate, 3)}`}
        />
        <EvidenceStat
          label={`Cross-engine parity (E-E)`}
          value={x.parity.both_engines_agree ? `${x.parity.n}/${x.parity.n}` : "divergence"}
          sub={x.parity.corpus ?? ""}
        />
        <EvidenceStat
          label="Deterministic plane latency (E-F)"
          value={`${fmt(x.latency.plane_p50_ms, 3)} ms p50`}
          sub={`p95 ${fmt(x.latency.plane_p95_ms, 3)} ms over ${x.latency.plane_n} cases · offline delta 0`}
        />
      </div>

      <p className="mt-4 rounded-md border bg-background/60 px-3 py-2 text-[11px] text-muted-foreground">
        {x.honesty}
      </p>
    </div>
  );
}

function EvidenceStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="vy-eyebrow">{label}</p>
      <p className="vy-numeral mt-1 text-xl font-semibold">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground vy-numeral">{sub}</p>
    </div>
  );
}

function fmt(v: number | null | undefined, digits = 3): string {
  return v == null ? "—" : v.toFixed(digits);
}
function fmtPct(v: number | null | undefined): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
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
