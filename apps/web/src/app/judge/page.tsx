"use client";

import { useCallback, useEffect, useState } from "react";
import { api, speak, stopSpeaking, type PrescriptionState, type SpokenPlan } from "@/lib/api";

const STEPS = [
  { sid: "RX-001", beat: "Clean prescription", note: "Extraction, verdict, spoken plan (Tamil)" },
  { sid: "RX-002", beat: "Severe interaction", note: "Warfarin + aspirin, source cited" },
  { sid: "RX-009", beat: "Contraindication", note: "Doxycycline for a child" },
  { sid: "RX-006", beat: "The refusal moment", note: "Corrupted scan - refused, not guessed" },
];

export default function JudgePage() {
  const [step, setStep] = useState(-1);          // -1 = not started
  const [cached, setCached] = useState(true);    // cached mode default (per demo script)
  const [state, setState] = useState<PrescriptionState | null>(null);
  const [plan, setPlan] = useState<SpokenPlan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<{ refused_total: number; confirm_queue_total: number } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(90);

  const runStep = useCallback(async (sid: string, useCache: boolean) => {
    setErr(null);
    setPlan(null);
    stopSpeaking();
    try {
      let envState: PrescriptionState | null = null;
      let envPlan: SpokenPlan | null = null;
      if (useCache) {
        const bundle = await api.judgeCached(sid);
        const inner = bundle.data as
          | { state?: { data?: PrescriptionState | null }; plan?: { data?: SpokenPlan | null } }
          | undefined;
        const st = inner?.state?.data ?? null;
        const pl = inner?.plan?.data ?? null;
        if (st) { envState = st; setState(st); }
        if (pl) { envPlan = pl; setPlan(pl); }
      } else {
        const ctx = sid === "RX-009" ? "age_under_12" : "";
        const r = await api.start(sid, ctx);
        if (r.data) {
          envState = r.data;
          setState(r.data);
          if (r.data.verdict?.kind !== "refused" && r.data.verdict?.kind !== "confirm_queue") {
            const p = await api.plan(r.data.prescription_id, "ta");
            if (p.data) { envPlan = p.data; setPlan(p.data); }
          }
        }
      }
      void envState;
      void envPlan;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // auto-advance every 20s once the walkthrough starts
  useEffect(() => {
    if (step < 0 || step >= STEPS.length) return;
    const s = STEPS[step];
    void runStep(s.sid, cached);
    const t = setInterval(() => setSecondsLeft((x) => Math.max(0, x - 1)), 1000);
    const adv = setTimeout(() => setStep((x) => x + 1), 20000);
    return () => { clearInterval(t); clearTimeout(adv); };
  }, [step, cached, runStep]);

  useEffect(() => {
    api.metrics().then((m) => setMetrics({ refused_total: m.data?.refused_total ?? 0, confirm_queue_total: m.data?.confirm_queue_total ?? 0 })).catch(() => setMetrics(null));
  }, [step]);

  const v = state?.verdict;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--accent)" }}>
            Judge route - sealed cases
          </p>
          <h1 className="mt-2 text-2xl font-bold" style={{ color: "var(--primary)" }}>
            The 90-second walkthrough
          </h1>
        </div>
        <a href="/" className="text-sm underline" style={{ color: "var(--muted)" }}>Home</a>
      </div>

      <div className="mt-4 flex items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={cached} onChange={(e) => setCached(e.target.checked)} />
          Cached mode (zero network)
        </label>
        {step >= 0 && step < STEPS.length && (
          <span className="font-mono text-xs" style={{ color: "var(--muted)" }}>
            {secondsLeft}s left · auto-advance
          </span>
        )}
      </div>

      <ol className="mt-6 space-y-2">
        {STEPS.map((s, i) => (
          <li key={s.sid}
            className="rounded-xl border bg-white px-4 py-3"
            style={{
              borderColor: i === step ? "var(--accent)" : "var(--border)",
              opacity: step > i ? 0.65 : 1,
            }}>
            <div className="flex items-center justify-between">
              <button className="text-left" onClick={() => setStep(i)}>
                <span className="font-mono text-xs" style={{ color: "var(--accent)" }}>{s.sid}</span>
                <span className="ml-3 text-sm font-semibold">{s.beat}</span>
                <span className="block text-xs" style={{ color: "var(--muted)" }}>{s.note}</span>
              </button>
              {step > i && <span style={{ color: "var(--safe)" }}>✓</span>}
            </div>
            {i === step && v && (
              <div className="mt-3 rounded-lg p-3 text-sm text-white" style={{
                background: v.kind === "pass" ? "var(--safe)" : v.kind === "refused" ? "#5a7a96" : v.kind === "confirm_queue" ? "var(--warn)" : "var(--danger)",
              }}>
                <p className="font-bold">{v.headline}</p>
                <p className="mt-1 text-xs opacity-90">{v.detail}</p>
              </div>
            )}
            {i === step && plan && (
              <div className="mt-2">
                <p className="rounded bg-[var(--surface)] px-3 py-2 text-sm">{plan.script}</p>
                <button
                  className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                  style={{ background: "var(--primary)" }}
                  onClick={() => void speak(plan.segments, "ta")}>
                  ▶ Play Tamil audio
                </button>
              </div>
            )}
            {i === step && err && (
              <p className="mt-2 text-xs" style={{ color: "var(--danger)" }}>API error: {err}</p>
            )}
          </li>
        ))}
      </ol>

      {step >= STEPS.length && (
        <div className="mt-6 rounded-xl border p-4" style={{ borderColor: "var(--accent)", background: "var(--surface)" }}>
          <p className="text-sm font-bold">Walkthrough complete.</p>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            Refusals measured on this instance: <b>{metrics?.refused_total ?? "…"}</b> ·
            confirm-queue events: <b>{metrics?.confirm_queue_total ?? "…"}</b> ·
            the discipline is in the counters, not the claims.
          </p>
        </div>
      )}

      <div className="mt-8 flex gap-3">
        {step < 0 ? (
          <button onClick={() => { setStep(0); setSecondsLeft(90); }}
            className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
            style={{ background: "var(--primary)" }}>
            Start 90-second walkthrough
          </button>
        ) : (
          <button onClick={() => { setStep(-1); stopSpeaking(); }}
            className="rounded-lg border px-5 py-2.5 text-sm"
            style={{ borderColor: "var(--border)" }}>
            Reset
          </button>
        )}
      </div>
    </main>
  );
}
