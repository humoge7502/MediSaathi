"use client";

/** Today panel — the daily dose timeline with catch-up guardrails. */

import { useCallback, useEffect, useState } from "react";
import { api, post, type TodayPayload } from "@/lib/client";

interface ActionFeedback {
  doseId: string;
  message: string;
  guarded: boolean;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function statusChip(status: string): { label: string; style: React.CSSProperties } {
  switch (status) {
    case "taken": return { label: "taken", style: { background: "color-mix(in oklch, var(--vy-safe) 18%, transparent)", color: "var(--vy-safe)" } };
    case "missed": return { label: "missed", style: { background: "color-mix(in oklch, var(--vy-severe) 12%, transparent)", color: "var(--vy-severe)" } };
    case "skipped": return { label: "skipped", style: { background: "color-mix(in oklch, var(--vy-warn) 16%, transparent)", color: "var(--vy-warn)" } };
    default: return { label: "pending", style: { background: "var(--secondary)", color: "var(--muted-foreground)" } };
  }
}

export function TodayPanel({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<TodayPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyDose, setBusyDose] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<TodayPayload>("/api/plans"));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function act(doseId: string, action: "taken" | "skipped") {
    setBusyDose(doseId);
    setFeedback(null);
    try {
      const r = await post<{ status: string; message?: string; guidance?: { action: string; text: string } }>("/api/doses/action", { doseId, action });
      if (r.status === "guarded") {
        setFeedback({ doseId, message: r.message ?? "Guardrail refused this action.", guarded: true });
      } else if (r.guidance) {
        setFeedback({ doseId, message: `${r.guidance.action === "take_now" ? "Catch-up note" : "Guidance"}: ${r.guidance.text}`, guarded: false });
      }
      await load();
    } catch (e) {
      setFeedback({ doseId, message: e instanceof Error ? e.message : "Action failed", guarded: true });
    } finally {
      setBusyDose(null);
    }
  }

  if (loading) return <div className="vy-hairline-card animate-pulse p-10 text-center text-sm text-muted-foreground">Loading today…</div>;

  if (!data?.plan) {
    return (
      <div className="vy-hairline-card flex min-h-64 flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="vy-serif text-2xl">No active plan yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Verify a prescription in the Verify tab and press <em>Start therapy plan</em> — the dose schedule appears here.
        </p>
      </div>
    );
  }

  const doses = [...(data.doses ?? [])].sort((a, b) => a.time.localeCompare(b.time));
  const nowT = Date.now();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const pendingNow = doses.filter((d) => d.status === "pending" && new Date(d.time).getTime() <= nowT + 30 * 60000);
  const upcoming = doses.filter((d) => d.status === "pending" && new Date(d.time).getTime() > nowT + 30 * 60000 && new Date(d.time) < endOfToday);
  const futureDays = doses.filter((d) => d.status === "pending" && new Date(d.time) >= endOfToday).length;
  const resolved = doses.filter((d) => d.status !== "pending");

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-4">
        <div className="vy-hairline-card p-5">
          <p className="vy-eyebrow">Active plan</p>
          <p className="vy-serif mt-1 text-xl">{data.plan.label}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.medications.length} medicines · verdict at start: {data.plan.prescriptionVerdict ?? "—"} · patient {data.patient?.name ?? "—"}
          </p>
        </div>

        {pendingNow.length > 0 && (
          <div className="space-y-2">
            <p className="vy-eyebrow">Due now</p>
            {pendingNow.map((d) => (
              <DoseCard key={d.id} d={d} busy={busyDose === d.id} onAct={act} highlight />
            ))}
          </div>
        )}

        {upcoming.length > 0 && (
          <div className="space-y-2">
            <p className="vy-eyebrow">Upcoming today</p>
            <div className="vy-scroll max-h-64 space-y-2 overflow-y-auto pr-1">
              {upcoming.map((d) => <DoseCard key={d.id} d={d} busy={busyDose === d.id} onAct={act} />)}
            </div>
          </div>
        )}

        {futureDays > 0 && (
          <p className="vy-numeral px-1 text-xs text-muted-foreground">+ {futureDays} scheduled doses on later days.</p>
        )}

        {resolved.length > 0 && (
          <div className="space-y-2">
            <p className="vy-eyebrow">Earlier today</p>
            <div className="vy-scroll max-h-56 space-y-2 overflow-y-auto pr-1 opacity-80">
              {resolved.map((d) => <DoseCard key={d.id} d={d} busy={false} onAct={act} />)}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {feedback && (
          <div className={`vy-hairline-card p-5 ${feedback.guarded ? "vy-banner-moderate" : "vy-banner-neutral"}`}>
            <p className="vy-eyebrow">{feedback.guarded ? "Guardrail" : "Note"}</p>
            <p className="mt-2 text-sm leading-relaxed">{feedback.message}</p>
          </div>
        )}
        <div className="vy-hairline-card p-5">
          <p className="vy-eyebrow">Medications</p>
          <ul className="mt-3 space-y-3">
            {data.medications.map((m) => (
              <li key={m.id} className="border-b pb-3 last:border-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{m.brand}</span>
                  <span className="vy-numeral text-xs text-muted-foreground">{m.doseMg} mg · {m.frequency}</span>
                </div>
                <p className="text-xs text-muted-foreground">{m.molecule} · {m.times.map((t) => fmtTime(`${new Date().toISOString().slice(0, 10)}T${t}:00`)).join(", ")}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="vy-hairline-card p-5">
          <p className="vy-eyebrow">Missed-dose law</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Under 2h late → take now. Next dose within 4h → skip and continue. Never two doses together.
            The guardrail enforces this: it will refuse a &quot;taken&quot; tap that would double a dose.
          </p>
        </div>
      </div>
    </div>
  );
}

function DoseCard({ d, busy, onAct, highlight }: { d: TodayPayload["doses"][number]; busy: boolean; onAct: (id: string, a: "taken" | "skipped") => void; highlight?: boolean }) {
  const chip = statusChip(d.status);
  return (
    <div className={`vy-hairline-card flex items-center justify-between gap-3 p-4 ${highlight && d.status === "pending" ? "vy-banner-neutral" : ""}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="vy-numeral text-sm font-semibold">{fmtTime(d.time)}</span>
          <span className="truncate text-sm">{d.brand}</span>
          <span className="vy-numeral rounded px-1.5 py-0.5 text-xs" style={chip.style}>{chip.label}</span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{d.molecule} · {d.doseMg} mg{d.note ? ` · ${d.note}` : ""}</p>
      </div>
      {d.status === "pending" && (
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => onAct(d.id, "taken")}
            disabled={busy}
            className="rounded-full px-4 py-2 text-xs font-semibold text-white transition-transform hover:scale-105 disabled:opacity-40"
            style={{ background: "var(--vy-safe)" }}
          >
            Taken
          </button>
          <button
            onClick={() => onAct(d.id, "skipped")}
            disabled={busy}
            className="rounded-full border px-4 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40"
          >
            Skip
          </button>
        </div>
      )}
    </div>
  );
}
