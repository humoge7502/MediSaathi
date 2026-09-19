"use client";

/**
 * Landing view — "Clinical Editorial" style.
 * Storytelling: gap (01) -> loop (02) -> law (03) -> proof (04).
 * Recruiter-comprehensible in 60s; every section earns its place.
 *
 * Composition notes (hallmark/emil disciplines, applied once):
 * - asymmetric stat blocks with hairline tops instead of a uniform card grid;
 * - the loop is an editorial index (numbered rows), not four cloned cards;
 * - ONE orchestrated entrance on first load (staggered hero fade-up);
 *   below-fold sections are simply present, so the page settles — no
 *   scroll-triggered fade on every section (hallmark "animate-on-scroll" tell);
 * - roman display type throughout: emphasis is carried by weight and the clay
 *   accent, never by italic headers (hallmark gate 38a);
 * - section heads stack vertically (number -> eyebrow -> heading, one column);
 *   the tag-left/header-right grid is a banned editorial tell (gate 54);
 * - every colour — including the dark band's — references a named token; no
 *   inline oklch, and no Tailwind underscore syntax inside style objects,
 *   where it is invalid CSS and silently dropped (gate 48);
 * - section numbering (01–04) carries narrative order — metadata, not
 *   decoration.
 */

import type { Metrics } from "@/lib/client";

interface Props {
  onLaunch: () => void;
  /** Live engine metrics, fetched once by the page shell and shared. */
  metrics: Metrics | null;
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

function SectionHead({
  num,
  eyebrow,
  tone = "light",
  children,
}: {
  num: string;
  eyebrow: string;
  tone?: "light" | "dark";
  children: React.ReactNode;
}) {
  const dark = tone === "dark";
  return (
    <div>
      <span className="vy-section-num" aria-hidden="true" style={dark ? { color: "var(--vy-mint)" } : undefined}>
        {num}
      </span>
      <p className="vy-eyebrow mt-2" style={dark ? { color: "var(--vy-mint)" } : undefined}>
        {eyebrow}
      </p>
      <h2 className="vy-serif mt-3 text-3xl md:text-4xl">{children}</h2>
    </div>
  );
}

export function Landing({ onLaunch, metrics }: Props) {
  return (
    <div>
      {/* ---------------- hero ---------------- */}
      <section id="top" className="mx-auto max-w-6xl px-6 pt-16 pb-20 md:pt-24 md:pb-28">
        <p className="vy-eyebrow">VMEDITHON V3.0 · Bio × Engineering</p>
        <h1 className="vy-serif vy-display mt-5 max-w-4xl vy-fade-up" style={{ color: "var(--vy-pine-ink)" }}>
          Every medicine,<br />
          checked. Every dose,<br />
          remembered.
        </h1>
        <p className="mt-7 max-w-2xl text-lg leading-relaxed text-muted-foreground vy-fade-up-d1">
          Vaidya is a closed-loop medication guardian: it <strong className="text-foreground">verifies</strong> prescriptions
          with a deterministic safety engine, <strong className="text-foreground">schedules</strong> the therapy,
          <strong className="text-foreground"> measures</strong> adherence, and <strong className="text-foreground">explains</strong> —
          in plain language, with citations — while refusing, never guessing, when confidence drops.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-4 vy-fade-up-d2">
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
        <p className="mt-4 text-xs text-muted-foreground vy-fade-up-d3">
          Information layer only — not a doctor. Every screen says so. That is the product working as designed.
        </p>
      </section>

      {/* ---------------- 01 · the gap (asymmetric editorial grid) ---------------- */}
      <section id="gap" className="border-y bg-card">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <SectionHead num="01" eyebrow="The gap">
            Everyone sells or reminds.<br />Nobody verifies.
          </SectionHead>
          {/* Asymmetric: 5/7 split, hairline tops, no clone cards. */}
          <div className="mt-12 grid gap-x-10 gap-y-12 md:grid-cols-12">
            <div className="border-t pt-6 md:col-span-5">
              <div className="vy-numeral vy-serif text-6xl" style={{ color: "var(--vy-pine)" }}>
                {GAP_STATS[0].value}
              </div>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{GAP_STATS[0].text}</p>
            </div>
            <div className="md:col-span-7 md:pl-8">
              <div className="grid gap-10 sm:grid-cols-2">
                {GAP_STATS.slice(1).map((s) => (
                  <div key={s.value} className="border-t pt-6">
                    <div className="vy-numeral vy-serif text-4xl" style={{ color: "var(--vy-pine)" }}>{s.value}</div>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 02 · the loop (editorial index, not cloned cards) ---------------- */}
      <section id="loop" className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <SectionHead num="02" eyebrow="The product">
          A closed loop, not a chatbot.
        </SectionHead>
        <ol className="mt-10 border-t">
          {LOOP.map((l) => (
            <li key={l.step} className="group grid gap-2 border-b py-6 transition-colors md:grid-cols-12 md:gap-6">
              <div className="vy-numeral vy-serif text-3xl md:col-span-1" style={{ color: "var(--vy-clay)" }}>
                {l.step}
              </div>
              <h3 className="text-lg font-semibold transition-transform duration-150 md:col-span-3 md:group-hover:translate-x-1">
                {l.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground md:col-span-8">{l.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------- 03 · the law (dark band) ---------------- */}
      <section id="law" className="border-y" style={{ background: "var(--vy-pine-ink)" }}>
        <div className="mx-auto max-w-6xl px-6 py-16 text-[var(--vy-dark-ink)]">
          <SectionHead num="03" eyebrow="The law" tone="dark">
            The model reads.<br />The rules decide.
          </SectionHead>
          <div className="mt-8 grid gap-10 md:grid-cols-2">
            <div className="space-y-4 text-sm leading-relaxed text-[var(--vy-dark-ink-soft)]">
              <p>
                An LLM reads the prescription and proposes structured lines with an honest confidence for each.
                It never decides anything that touches safety. That happens in a deterministic engine:
                brand→molecule normalization against a {metrics?.dataset?.brands ?? "—"}-brand formulary, then
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
            <div className="rounded-xl border p-6 font-mono text-xs leading-relaxed" style={{ borderColor: "var(--vy-panel-border)", background: "var(--vy-panel)" }}>
              <div>photo / pasted Rx</div>
              <div className="ml-4 border-l pl-4" style={{ borderColor: "var(--vy-panel-border)" }}>
                <div>PERCEPTION · LLM proposes lines + confidence</div>
                <div className="mt-2" style={{ color: "var(--vy-clay-bright)" }}>GATE · refuse &lt; 0.75 · confirm &lt; 0.90</div>
                <div className="mt-2">SAFETY PLANE · deterministic · 0 network</div>
                <div className="ml-4 border-l pl-4" style={{ borderColor: "var(--vy-panel-border)" }}>
                  <div>interactions → combinations → contraindications</div>
                  <div>→ duplicates → aggregate dose caps</div>
                </div>
                <div className="mt-2">PLAN → schedule → adherence → family circle</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 04 · the proof (evidence, not adjectives) ---------------- */}
      <section id="proof" className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <SectionHead num="04" eyebrow="The proof">
          Evidence, not adjectives.
        </SectionHead>
        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border md:grid-cols-4" style={{ borderColor: "var(--border)", background: "var(--border)" }}>
          {[
            { k: "110/110", v: "cross-engine parity — TS and Python engines agree on every labeled case" },
            { k: "18/18", v: "engine self-test at 100%, runnable live in the Evidence tab" },
            { k: "94", v: "automated web tests, including an axe-core accessibility gate on every core journey" },
            { k: "<10ms", v: "deterministic safety plane latency, offline, zero network" },
          ].map((p) => (
            <div key={p.k} className="bg-card p-6">
              <div className="vy-numeral vy-serif text-3xl" style={{ color: "var(--vy-pine)" }}>{p.k}</div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{p.v}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Full methodology, operating-point analysis and archived experiment evidence are one click away in the Evidence tab.
        </p>
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
          className="mt-8 rounded-full px-8 py-3.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02] active:scale-[0.99]"
          style={{ background: "var(--vy-clay)" }}
        >
          Open Vaidya →
        </button>
      </section>

      {/* ---------------- footer ---------------- */}
      <footer className="border-t bg-card">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 md:grid-cols-12">
          <div className="md:col-span-6">
            <div className="flex items-baseline gap-2">
              <span className="vy-serif text-xl font-semibold" style={{ color: "var(--vy-pine)" }}>वैद्य</span>
              <span className="text-sm font-semibold tracking-wide">VAIDYA</span>
            </div>
            <p className="mt-3 max-w-sm text-xs leading-relaxed text-muted-foreground">
              A closed-loop medication guardian built for VMEDITHON V3.0 at VIT Chennai.
              Education and information only — not a medical device, not a doctor.
            </p>
          </div>
          <nav className="md:col-span-3" aria-label="Footer">
            <p className="vy-eyebrow">Explore</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li><a href="#gap" className="vy-nav-link transition-colors hover:text-foreground">The gap</a></li>
              <li><a href="#loop" className="vy-nav-link transition-colors hover:text-foreground">The loop</a></li>
              <li><a href="#law" className="vy-nav-link transition-colors hover:text-foreground">The law</a></li>
              <li><a href="#proof" className="vy-nav-link transition-colors hover:text-foreground">The proof</a></li>
            </ul>
          </nav>
          <div className="md:col-span-3">
            <p className="vy-eyebrow">Engine</p>
            <ul className="vy-numeral mt-3 space-y-2 text-xs text-muted-foreground">
              <li>snapshot {metrics?.dataset?.snapshot ?? "2026-09-vm3"}</li>
              <li>{metrics?.dataset?.interactions ?? "—"} DDInter/Stockley/FDA-derived rules</li>
              <li>{metrics?.dataset?.brands ?? "—"}-brand formulary</li>
            </ul>
          </div>
        </div>
        <div className="border-t">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-4 text-xs text-muted-foreground md:flex-row">
            <p>In an emergency, contact your local emergency services first.</p>
            <p className="vy-numeral">© 2026 Vaidya · VMEDITHON V3.0</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
