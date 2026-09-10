"use client";

/**
 * Landing view — "Clinical Editorial" style.
 * Storytelling: gap -> loop -> law -> proof. Recruiter-comprehensible in 60s.
 */

import { useEffect, useState } from "react";
import { api, type Metrics } from "@/lib/client";

interface Props {
  onLaunch: () => void;
}

const GAP_STATS = [
  {
    value: "≈51%",
    text: "of patients with chronic conditions in India take their medicines as prescribed — the other half doesn't (2023 adherence meta-analysis, PMC).",
  },
  {
    value: "$42B",
    text: "annual global cost of medication errors — WHO's Medication Without Harm initiative calls it one of the largest avoidable harms in health care.",
  },
  {
    value: "0",
    text: "reminder or pharmacy apps that verify a prescription against interactions before the first dose. Commerce sells; reminders ping. Nothing checks.",
  },
];

const LOOP = [
  { step: "1", title: "Verify", text: "Paste a prescription. The perception model reads it; a deterministic rule engine checks interactions, contraindications, duplicates and dose caps. Below the confidence gate, it refuses — by design." },
  { step: "2", title: "Schedule", text: "A verified plan becomes a dose schedule with times, durations and a built-in missed-dose guardrail that refuses to let anyone double up." },
  { step: "3", title: "Adhere", text: "Daily check-ins build an adherence record: percentage, medication possession ratio, streaks and a 14-day heatmap — the same numbers researchers use." },
  { step: "4", title: "Protect", text: "A family circle sees escalations: late doses, interaction alerts. A grounded copilot answers questions with citations — and refuses what it cannot verify." },
];

export function Landing({ onLaunch }: Props) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    api<Metrics>("/api/metrics").then(setMetrics).catch(() => setMetrics(null));
  }, []);

  return (
    <div>
      {/* ---------------- hero ---------------- */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-20 md:pt-24 md:pb-28">
        <p className="vy-eyebrow">VMEDITHON V3.0 · Bio × Engineering</p>
        <h1 className="vy-serif mt-5 text-5xl leading-[1.05] md:text-7xl" style={{ color: "var(--vy-pine-ink)" }}>
          Every medicine,<br />
          <span className="italic">checked. Every dose,</span><br />
          remembered.
        </h1>
        <p className="mt-7 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Vaidya is a closed-loop medication guardian: it <strong className="text-foreground">verifies</strong> prescriptions
          with a deterministic safety engine, <strong className="text-foreground">schedules</strong> the therapy,
          <strong className="text-foreground"> measures</strong> adherence, and <strong className="text-foreground">explains</strong> —
          in plain language, with citations — while refusing, never guessing, when confidence drops.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-4">
          <button
            onClick={onLaunch}
            className="rounded-full px-7 py-3 text-sm font-semibold text-white transition-transform hover:scale-[1.02] active:scale-[0.99]"
            style={{ background: "var(--vy-pine)" }}
          >
            Launch the live product →
          </button>
          <div className="flex items-center gap-5 text-xs text-muted-foreground vy-numeral">
            <span><strong className="text-foreground">{metrics?.dataset?.interactions ?? "—"}</strong> interaction rules</span>
            <span><strong className="text-foreground">{metrics?.dataset?.brands ?? "—"}</strong>-brand formulary</span>
            <span><strong className="text-foreground">{metrics?.verifications ?? 0}</strong> verifications run</span>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Information layer only — not a doctor. Every screen says so. That is the product working as designed.
        </p>
      </section>

      {/* ---------------- the gap ---------------- */}
      <section id="gap" className="border-y bg-card">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <p className="vy-eyebrow">The gap</p>
          <h2 className="vy-serif mt-3 text-3xl md:text-4xl">Everyone sells or reminds.<br />Nobody verifies.</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {GAP_STATS.map((s) => (
              <div key={s.value} className="vy-hairline-card p-6">
                <div className="vy-numeral vy-serif text-4xl" style={{ color: "var(--vy-pine)" }}>{s.value}</div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- the loop ---------------- */}
      <section id="loop" className="mx-auto max-w-6xl px-6 py-16">
        <p className="vy-eyebrow">The product</p>
        <h2 className="vy-serif mt-3 text-3xl md:text-4xl">A closed loop, not a chatbot.</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-4">
          {LOOP.map((l) => (
            <div key={l.step} className="vy-hairline-card relative p-6">
              <span className="vy-serif absolute -top-5 left-5 bg-card px-1 text-3xl italic" style={{ color: "var(--vy-clay)" }}>{l.step}</span>
              <h3 className="mt-3 text-lg font-semibold">{l.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{l.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- the law ---------------- */}
      <section id="law" className="border-y" style={{ background: "var(--vy-pine-ink)" }}>
        <div className="mx-auto max-w-6xl px-6 py-16 text-[oklch(0.96_0.005_90)]">
          <p className="vy-eyebrow" style={{ color: "oklch(0.8_0.09_175)" }}>The law</p>
          <h2 className="vy-serif mt-3 text-3xl md:text-4xl">The model reads.<br />The rules decide.</h2>
          <div className="mt-8 grid gap-10 md:grid-cols-2">
            <div className="space-y-4 text-sm leading-relaxed text-[oklch(0.85_0.01_90)]">
              <p>
                An LLM reads the prescription and proposes structured lines with an honest confidence for each.
                It never decides anything that touches safety. That happens in a deterministic engine:
                brand→molecule normalization against a {metrics?.dataset?.brands ?? 95}-brand formulary, then
                interaction pairs, combination rules, contraindications, duplicate-molecule detection and
                aggregate dose-cap arithmetic — all computed in under ten milliseconds, offline, with zero network.
              </p>
              <p>
                Below 75% confidence the system <em>refuses</em> — and refusal is a designed success state, not an
                error. In medication, a confident wrong answer is worse than an honest one. Between 75% and 90%,
                a human confirms. Above 90%, the plan proceeds. The gate law is property-tested on a labeled suite
                you can run yourself, live, in the Evidence tab.
              </p>
            </div>
            <div className="rounded-xl border p-6 font-mono text-xs leading-relaxed" style={{ borderColor: "oklch(0.4_0.03_175)", background: "oklch(0.27_0.02_170)" }}>
              <div style={{ color: "oklch(0.8_0.09_175)" }}>photo / pasted Rx</div>
              <div className="ml-4 border-l pl-4" style={{ borderColor: "oklch(0.4_0.03_175)" }}>
                <div>PERCEPTION · LLM proposes lines + confidence</div>
                <div className="mt-2" style={{ color: "oklch(0.78_0.13 75)" }}>GATE · refuse &lt; 0.75 · confirm &lt; 0.90</div>
                <div className="mt-2">SAFETY PLANE · deterministic · 0 network</div>
                <div className="ml-4 border-l pl-4" style={{ borderColor: "oklch(0.4_0.03_175)" }}>
                  <div>interactions → combinations → contraindications</div>
                  <div>→ duplicates → aggregate dose caps</div>
                </div>
                <div className="mt-2">PLAN → schedule → adherence → family circle</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <h2 className="vy-serif text-3xl md:text-5xl">Judge it running,<br />not just described.</h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Verify a real-world-style prescription, start a plan, check a dose, ask the copilot a trap question and watch it
          refuse, then run the evaluation suite — all on this page.
        </p>
        <button
          onClick={onLaunch}
          className="mt-8 rounded-full px-8 py-3.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02]"
          style={{ background: "var(--vy-clay)" }}
        >
          Open Vaidya →
        </button>
      </section>

      <footer className="border-t bg-card">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-xs text-muted-foreground md:flex-row">
          <p><strong className="text-foreground">Vaidya</strong> · वैद्य — built for VMEDITHON V3.0 at VIT Chennai. Education and information only; not a medical device, not a doctor.</p>
          <p className="vy-numeral">engine snapshot {metrics?.dataset?.snapshot ?? "2026-09-vm3"} · {metrics?.dataset?.interactions ?? "—"} DDInter/Stockley/FDA-derived rules</p>
        </div>
      </footer>
    </div>
  );
}
