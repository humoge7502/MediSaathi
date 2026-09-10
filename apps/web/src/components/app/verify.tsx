"use client";

/** Verify panel — paste a prescription, run the pipeline, inspect the verdict. */

import { useState } from "react";
import { post, SAMPLE_RX, type VerifyResult, CONTEXT_LABELS } from "@/lib/client";
import { Button } from "@/components/ui/button";

const SEV_STYLE: Record<string, { cls: string; label: string }> = {
  severe: { cls: "vy-banner-severe", label: "SEVERE" },
  moderate: { cls: "vy-banner-moderate", label: "MODERATE" },
  mild: { cls: "vy-banner-neutral", label: "NOTE" },
  none: { cls: "vy-banner-neutral", label: "NOTE" },
};

const VERDICT_STYLE: Record<string, { cls: string; label: string }> = {
  pass: { cls: "vy-banner-pass", label: "All checks passed" },
  interaction: { cls: "vy-banner-severe", label: "Interaction found" },
  combination: { cls: "vy-banner-severe", label: "Dangerous combination" },
  contraindication: { cls: "vy-banner-severe", label: "Contraindication" },
  duplicate: { cls: "vy-banner-moderate", label: "Duplicate medicine" },
  confirm_queue: { cls: "vy-banner-moderate", label: "Confirmation needed" },
  refused: { cls: "vy-banner-neutral", label: "Refused — by design" },
};

export function VerifyPanel({ onPlanStarted }: { onPlanStarted: () => void }) {
  const [text, setText] = useState("");
  const [contexts, setContexts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planMsg, setPlanMsg] = useState<string | null>(null);
  const [planBusy, setPlanBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    setPlanMsg(null);
    try {
      const r = await post<VerifyResult>("/api/verify", { text, contexts });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  async function startPlan() {
    if (!result?.prescriptionId) return;
    setPlanBusy(true);
    setPlanMsg(null);
    try {
      const r = await post<{ planId: string; medications: number; dosesScheduled: number }>("/api/plans", {
        prescriptionId: result.prescriptionId,
      });
      setPlanMsg(`Plan started — ${r.medications} medicines, ${r.dosesScheduled} doses scheduled. See the Today tab.`);
      onPlanStarted();
    } catch (e) {
      setPlanMsg(e instanceof Error ? e.message : "Could not start plan");
    } finally {
      setPlanBusy(false);
    }
  }

  function toggleContext(code: string) {
    setContexts((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  const vs = result ? VERDICT_STYLE[result.verdict] : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
      {/* -------- input -------- */}
      <div className="space-y-4">
        <div className="vy-hairline-card p-5">
          <label htmlFor="rx-text" className="vy-eyebrow">Prescription text</label>
          <textarea
            id="rx-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            placeholder={"e.g.\nTelma 40 mg OD 30 days\nGlycomet 500 mg BD 30 days"}
            className="vy-scroll mt-3 w-full resize-none rounded-lg border bg-background p-4 font-mono text-sm leading-relaxed outline-none focus:ring-2 focus:ring-[color:var(--vy-pine)]"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {SAMPLE_RX.map((s) => (
              <button
                key={s.id}
                onClick={() => { setText(s.text); setContexts(s.contexts); setResult(null); setPlanMsg(null); }}
                className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="vy-hairline-card p-5">
          <p className="vy-eyebrow">Declared context</p>
          <p className="mt-1 text-xs text-muted-foreground">Contraindications are checked against these.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {CONTEXT_LABELS.map((c) => (
              <button
                key={c.code}
                onClick={() => toggleContext(c.code)}
                aria-pressed={contexts.includes(c.code)}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${contexts.includes(c.code) ? "text-white" : "text-muted-foreground hover:bg-secondary"}`}
                style={contexts.includes(c.code) ? { background: "var(--vy-pine)", borderColor: "var(--vy-pine)" } : {}}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <Button
          onClick={run}
          disabled={busy || text.trim().length < 3}
          className="w-full rounded-full py-6 text-sm font-semibold"
          style={{ background: busy ? "var(--muted)" : "var(--vy-pine)" }}
        >
          {busy ? "Running the pipeline…" : "Run verification"}
        </Button>
        {error && <p className="text-sm vy-sev-severe">{error}</p>}
      </div>

      {/* -------- result -------- */}
      <div className="space-y-4">
        {!result && !busy && (
          <div className="vy-hairline-card flex h-full min-h-72 flex-col items-center justify-center p-10 text-center">
            <div className="vy-serif text-5xl italic" style={{ color: "var(--vy-hairline)" }}>Rx</div>
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              Run a verification. The verdict, every finding, the confidence gate and the plan button all appear here.
            </p>
          </div>
        )}

        {result && vs && (
          <div className="vy-fade-up space-y-4">
            <div className={`vy-hairline-card p-5 ${vs.cls}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="vy-eyebrow">Verdict</p>
                  <p className="vy-serif mt-1 text-2xl">{vs.label}</p>
                </div>
                <div className="text-right vy-numeral">
                  <div className="text-2xl font-semibold">{Math.round(result.confidence * 100)}%</div>
                  <div className="text-xs text-muted-foreground">confidence</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground vy-numeral">
                <span>perception: {result.extractionEngine}</span>
                <span>engine: {result.engineMs ?? "?"} ms</span>
                <span>pipeline: {result.pipelineMs ?? "?"} ms</span>
                <span>snapshot: {result.snapshot ?? "—"}</span>
              </div>
              {result.extractionNote && (
                <p className="mt-3 rounded-md border bg-background/60 px-3 py-2 text-xs text-muted-foreground">{result.extractionNote}</p>
              )}
            </div>

            {result.confirmed.length > 0 && (
              <div className="vy-hairline-card p-5">
                <p className="vy-eyebrow">Confirmed medications ({result.confirmed.length})</p>
                <ul className="mt-3 space-y-2">
                  {result.confirmed.map((m) => (
                    <li key={m.line} className="flex items-center justify-between gap-3 rounded-lg border bg-background/50 px-3 py-2 text-sm">
                      <div>
                        <span className="font-medium">{m.brand}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{m.molecule}</span>
                      </div>
                      <div className="vy-numeral text-xs text-muted-foreground">
                        {[m.strengthMg != null ? `${m.strengthMg} mg` : null, m.frequency, m.durationDays ? `${m.durationDays}d` : null].filter(Boolean).join(" · ")}
                      </div>
                    </li>
                  ))}
                </ul>
                {Object.keys(result.aggregateDailyMg).length > 0 && (
                  <p className="mt-3 text-xs text-muted-foreground vy-numeral">
                    aggregate/day: {Object.entries(result.aggregateDailyMg).map(([k, v]) => `${k} ${Math.round(v)}mg`).join(" · ")}
                  </p>
                )}
              </div>
            )}

            {result.findings.length > 0 && (
              <div className="space-y-2">
                {result.findings.map((f, i) => {
                  const st = SEV_STYLE[f.severity] ?? SEV_STYLE.none;
                  const title =
                    f.kind === "interaction" ? `${f.a} × ${f.b}` :
                    f.kind === "combination" ? f.rule?.replace(/_/g, " ") :
                    f.kind === "contraindication" ? `${f.molecule} × ${f.condition?.replace(/_/g, " ")}` :
                    f.kind === "duplicate" ? `${f.molecule} × ${f.brands?.length} brands` :
                    `${f.molecule} dose`;
                  return (
                    <div key={i} className={`vy-hairline-card p-4 ${st.cls}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold capitalize">{title}</p>
                        <span className={`vy-numeral text-xs font-bold ${f.severity === "severe" ? "vy-sev-severe" : f.severity === "moderate" ? "vy-sev-moderate" : ""}`}>
                          {st.label}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{f.mechanism ?? f.note}</p>
                      {f.source && <p className="mt-1 text-xs text-muted-foreground/70">source: {f.source}</p>}
                    </div>
                  );
                })}
              </div>
            )}

            {result.confirmQueue.length > 0 && (
              <div className="vy-hairline-card p-5">
                <p className="vy-eyebrow">Confirm queue ({result.confirmQueue.length})</p>
                <ul className="mt-3 space-y-2">
                  {result.confirmQueue.map((c) => (
                    <li key={c.line} className="rounded-lg border px-3 py-2 text-sm">
                      <span className="font-mono text-xs">{c.rawText}</span>
                      <span className="ml-2 text-xs vy-sev-moderate">{c.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.prescriptionId && (
              <div className="vy-hairline-card p-5">
                <button
                  onClick={startPlan}
                  disabled={planBusy || result.verdict === "refused"}
                  className="w-full rounded-full py-3 text-sm font-semibold text-white transition-transform hover:scale-[1.01] disabled:opacity-40"
                  style={{ background: "var(--vy-clay)" }}
                >
                  {planBusy ? "Scheduling…" : "Start therapy plan from this prescription →"}
                </button>
                {planMsg && <p className="mt-3 text-sm text-muted-foreground">{planMsg}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
