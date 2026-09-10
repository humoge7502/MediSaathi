"use client";

/** Family panel — caregiver circle: join code, escalation feed, acknowledgements. */

import { useCallback, useEffect, useState } from "react";
import { api, post, type FamilyPayload } from "@/lib/client";

export function FamilyPanel({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<FamilyPayload | null>(null);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("son");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<FamilyPayload>("/api/family"));
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function link() {
    if (!name.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await post<{ joinCode: string }>("/api/family", { caregiverName: name, relation });
      setMsg(`Family code ${r.joinCode} — a caregiver opens this app, enters the code in the Family tab, and sees the live feed.`);
      setName("");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not link caregiver");
    } finally {
      setBusy(false);
    }
  }

  async function ack(eventId: string) {
    try {
      await post("/api/family", { action: "acknowledge", eventId });
      await load();
    } catch {
      /* non-fatal */
    }
  }

  if (!data) return <div className="vy-hairline-card animate-pulse p-10 text-center text-sm text-muted-foreground">Loading family circle…</div>;

  const open = data.events.filter((e) => !e.acknowledged);
  const resolved = data.events.filter((e) => e.acknowledged);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
      <div className="space-y-4">
        <div className="vy-hairline-card p-5">
          <p className="vy-eyebrow">Family circle</p>
          {data.joinCode ? (
            <>
              <p className="vy-serif mt-2 text-4xl tracking-[0.3em]" style={{ color: "var(--vy-pine)" }}>{data.joinCode}</p>
              <p className="mt-2 text-sm text-muted-foreground">Share this code with a caregiver. Their view shows the live escalation feed and today&apos;s adherence.</p>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted-foreground">No circle yet. Link the first caregiver to generate a family code.</p>
            </>
          )}
          <div className="mt-4 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Caregiver name"
              aria-label="Caregiver name"
              className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[color:var(--vy-pine)]"
            />
            <select
              value={relation}
              onChange={(e) => setRelation(e.target.value)}
              aria-label="Relation"
              className="rounded-lg border bg-background px-2 py-2 text-sm outline-none"
            >
              {["son", "daughter", "spouse", "nephew", "niece", "neighbour", "family"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button
              onClick={link}
              disabled={busy || !name.trim()}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: "var(--vy-pine)" }}
            >
              Link
            </button>
          </div>
          {msg && <p className="mt-3 text-xs text-muted-foreground">{msg}</p>}
          {data.links.length > 0 && (
            <ul className="mt-3 space-y-1">
              {data.links.map((l) => (
                <li key={l.id} className="text-xs text-muted-foreground">{l.caregiverName} · {l.relation}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="vy-hairline-card p-5">
          <p className="vy-eyebrow">Escalation law</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            The circle is informed when: a dose is taken 2h+ late, a dose is skipped, a plan starts with safety
            findings, or adherence drops. Everything is timestamped and auditable — and nothing is sent anywhere;
            the demo build keeps all data on-device.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <p className="vy-eyebrow">Open escalations ({open.length})</p>
          {open.length === 0 && <p className="vy-hairline-card p-5 text-sm text-muted-foreground">Nothing needs attention. That&apos;s the goal.</p>}
          {open.map((e) => (
            <EventRow key={e.id} e={e} onAck={() => ack(e.id)} />
          ))}
        </div>
        {resolved.length > 0 && (
          <div className="space-y-2">
            <p className="vy-eyebrow">Acknowledged ({resolved.length})</p>
            <div className="vy-scroll max-h-56 space-y-2 overflow-y-auto pr-1 opacity-70">
              {resolved.map((e) => <EventRow key={e.id} e={e} onAck={null} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ e, onAck }: { e: FamilyPayload["events"][number]; onAck: (() => void) | null }) {
  const sevCls = e.severity === "severe" ? "vy-banner-severe" : e.severity === "moderate" ? "vy-banner-moderate" : "";
  return (
    <div className={`vy-hairline-card flex items-start justify-between gap-3 p-4 ${sevCls}`}>
      <div>
        <p className="text-sm">{e.message}</p>
        <p className="vy-numeral mt-1 text-xs text-muted-foreground">
          {e.kind.replace(/_/g, " ")} · {new Date(e.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
      {onAck && (
        <button onClick={onAck} className="shrink-0 rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary">
          Acknowledge
        </button>
      )}
    </div>
  );
}
