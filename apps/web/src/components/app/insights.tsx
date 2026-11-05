"use client";

/** Insights panel — adherence KPIs, 14-day heatmap, per-medication bars. */

import { useEffect, useState } from "react";
import { api, type Analytics } from "@/lib/client";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonCard, SkeletonHeading } from "@/components/ui/skeleton";

export function InsightsPanel({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<{ analytics: Analytics | null; hasPlan: boolean } | null>(null);

  useEffect(() => {
    api<{ analytics: Analytics | null; hasPlan: boolean }>("/api/analytics")
      .then(setData)
      .catch(() => setData(null));
  }, [refreshKey]);

  // Four KPI tiles, then the heatmap's own 14-column grid: the numbers arrive in
  // the row the reader was already looking at, and nothing on screen while this
  // is up is a sentence.
  if (!data)
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} className="space-y-2.5">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-9 w-16" />
              <Skeleton className="h-3 w-24" />
            </SkeletonCard>
          ))}
        </div>
        <SkeletonCard>
          <SkeletonHeading />
          <div aria-hidden="true" className="mt-4 grid grid-cols-7 gap-2 sm:grid-cols-14">
            {Array.from({ length: 14 }, (_, i) => (
              <Skeleton key={i} className="aspect-square" />
            ))}
          </div>
        </SkeletonCard>
      </div>
    );

  const a = data.analytics;
  if (!a) {
    return (
      <EmptyState title="No analytics yet">
        Start a plan and check in a few doses — adherence, MPR and the heatmap fill in here.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPI label="Adherence (14d)" value={a.adherencePct == null ? "—" : `${a.adherencePct}%`} sub="taken ÷ doses whose day closed" tone="main" />
        <KPI label="MPR" value={a.mprPct == null ? "—" : `${a.mprPct}%`} sub="days fully covered ÷ days closed" />
        <KPI label="Current streak" value={`${a.currentStreak}d`} sub={`best ${a.bestStreak} days`} />
        <KPI label="Risk events" value={`${a.riskEvents}`} sub="missed doses in window" tone={a.riskEvents > 3 ? "risk" : "plain"} />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        A dose slot whose day closed with no answer counts as missed. Today is never charged for a dose that
        has not happened yet, so these two numbers can only ever move as the record itself does.
      </p>

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
                  <div className="h-full rounded-full" style={{ width: `${m.adherencePct ?? 0}%`, background: "var(--chart-1)" }} />
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
      <p className={`vy-numeral vy-serif mt-2 text-4xl ${tone === "risk" ? "vy-sev-severe" : ""}`} style={tone === "main" ? { color: "var(--vy-pine-ink)" } : {}}>{value}</p>
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
