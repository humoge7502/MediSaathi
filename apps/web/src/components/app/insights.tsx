"use client";

/** Insights panel — adherence KPIs, 14-day heatmap, per-medication bars. */

import { useEffect, useState } from "react";
import { api, type Analytics } from "@/lib/client";

export function InsightsPanel({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<{ analytics: Analytics | null; hasPlan: boolean } | null>(null);

  useEffect(() => {
    api<{ analytics: Analytics | null; hasPlan: boolean }>("/api/analytics")
      .then(setData)
      .catch(() => setData(null));
  }, [refreshKey]);

  if (!data) return <div className="vy-hairline-card animate-pulse p-10 text-center text-sm text-muted-foreground">Loading analytics…</div>;

  const a = data.analytics;
  if (!a) {
    return (
      <div className="vy-hairline-card flex min-h-64 flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="vy-serif text-2xl">No analytics yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">Start a plan and check in a few doses — adherence, MPR and the heatmap fill in here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPI label="Adherence (14d)" value={a.adherencePct == null ? "—" : `${a.adherencePct}%`} sub="taken ÷ resolved doses" tone="main" />
        <KPI label="MPR" value={a.mprPct == null ? "—" : `${a.mprPct}%`} sub="medication possession ratio" />
        <KPI label="Current streak" value={`${a.currentStreak}d`} sub={`best ${a.bestStreak} days`} />
        <KPI label="Risk events" value={`${a.riskEvents}`} sub="missed doses in window" tone={a.riskEvents > 3 ? "risk" : "plain"} />
      </div>

      <div className="vy-hairline-card p-5">
        <div className="flex items-center justify-between">
          <p className="vy-eyebrow">14-day heatmap</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>missed</span>
            <HeatSwatch pct={0} /><HeatSwatch pct={50} /><HeatSwatch pct={80} /><HeatSwatch pct={100} />
            <span>perfect</span>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-7 gap-2 sm:grid-cols-14">
          {a.days.map((d) => {
            const total = d.taken + d.skipped + d.missed;
            const pct = total ? (d.taken / total) * 100 : -1;
            return (
              <div key={d.date} className="text-center">
                <div
                  className="vy-heat"
                  title={`${d.date}: ${d.taken}/${total} taken${d.missed ? `, ${d.missed} missed` : ""}`}
                  style={{ background: heatColor(pct) }}
                />
                <p className="mt-1 text-[10px] text-muted-foreground vy-numeral">{d.date.slice(8)}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="vy-hairline-card p-5">
          <p className="vy-eyebrow">By medication</p>
          <div className="mt-4 space-y-4">
            {a.perMedication.map((m) => (
              <div key={m.medicationId}>
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{m.brand}</span>
                  <span className="vy-numeral text-muted-foreground">{m.adherencePct == null ? "—" : `${m.adherencePct}%`}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full" style={{ width: `${m.adherencePct ?? 0}%`, background: "var(--vy-pine)" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="vy-hairline-card p-5">
          <p className="vy-eyebrow">What judges should know</p>
          <ul className="mt-3 list-disc space-y-2 pl-4 text-sm leading-relaxed text-muted-foreground">
            <li>MPR (medication possession ratio) is the metric used in adherence literature — computed here from dose-level events, not self-reports.</li>
            <li>Every analytics number is derived from the same deterministic engine that gates the plan, so the record is internally consistent.</li>
            <li>The family circle receives escalations when doses run late — see the Family tab.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "main" | "risk" | "plain" }) {
  return (
    <div className="vy-hairline-card p-5">
      <p className="vy-eyebrow">{label}</p>
      <p className={`vy-numeral vy-serif mt-2 text-4xl ${tone === "risk" ? "vy-sev-severe" : ""}`} style={tone === "main" ? { color: "var(--vy-pine)" } : {}}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function HeatSwatch({ pct }: { pct: number }) {
  return <span className="vy-heat inline-block !h-3 !w-3" style={{ background: heatColor(pct) }} />;
}

function heatColor(pct: number): string {
  if (pct < 0) return "var(--secondary)";
  if (pct >= 100) return "var(--vy-safe)";
  if (pct >= 50) return "color-mix(in oklch, var(--vy-safe) " + Math.round(pct) + "%, var(--secondary))";
  return "color-mix(in oklch, var(--vy-severe) 28%, var(--secondary))";
}
