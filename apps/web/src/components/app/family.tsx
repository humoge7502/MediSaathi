"use client";

/** Family panel — caregiver circle: join codes, escalation feed, acknowledgements.
 *
 *  Two views over one endpoint. The patient (owner) view links caregivers and
 *  can acknowledge; a caregiver opens the same panel with their join code and
 *  gets the feed read-only — which is what the code was issued for, and why the
 *  API never echoes a code back to a caller that only presented one.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, post, type FamilyPayload } from "@/lib/client";
import { Skeleton, SkeletonCard, SkeletonHeading, SkeletonRows } from "@/components/ui/skeleton";
import { AlertLine, StatusLine } from "@/components/ui/status-line";

export function FamilyPanel({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<FamilyPayload | null>(null);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("son");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [joinInput, setJoinInput] = useState("");
  const [viewerCode, setViewerCode] = useState<string | null>(null);
  // The one place a live credential exists in this component: the response to the
  // POST that minted it. Nothing on the read path can put a code here, because
  // `GET /api/family` no longer returns one — so a reload never re-discloses it.
  // It is cleared when the panel changes view, which is the moment the sharing
  // window closes; clearing it inside the fetch effect would instead wipe the
  // code in the same tick `link()` mints it, since linking asks for a reload.
  const [freshCode, setFreshCode] = useState<string | null>(null);

  // The payload is a function of the active view, so one effect owns the fetch
  // and `setReload` is how a mutation asks for it again. Stale-response
  // cancellation: when the view or `refreshKey` changes while a fetch is in
  // flight, the older response must never clobber the newer.
  const loadSeq = useRef(0);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const seq = ++loadSeq.current;
    const query = viewerCode ? `?code=${encodeURIComponent(viewerCode)}` : "";
    api<FamilyPayload>(`/api/family${query}`)
      .then((d) => {
        if (seq === loadSeq.current) setData(d);
      })
      .catch(() => {
        if (seq === loadSeq.current) setData(null);
      });
  }, [refreshKey, viewerCode, reload]);

  const isCaregiver = viewerCode !== null;

  async function link() {
    if (!name.trim()) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await post<{ joinCode: string }>("/api/family", { caregiverName: name, relation });
      setFreshCode(r.joinCode);
      // The code is shown exactly once, so the status line has to carry it: a
      // listener who is not looking at the big serif number at that instant
      // never gets the credential at all. Spelled with gaps so the reader says
      // the characters instead of pronouncing it as a word.
      setMsg(
        `Linked ${name.trim()} as ${relation}. Their code is ${r.joinCode.split("").join(" ")}. ` +
          "It is shown once and cannot be retrieved."
      );
      setName("");
      setReload((n) => n + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not link caregiver");
    } finally {
      setBusy(false);
    }
  }

  async function ack(eventId: string) {
    try {
      await post("/api/family", { action: "acknowledge", eventId });
      setReload((n) => n + 1);
    } catch (e) {
      // Swallowing this left the row looking acknowledged-by-attempt while the
      // escalation stayed open: a failed acknowledgement has to be louder.
      setErr(e instanceof Error ? e.message : "Could not acknowledge — the escalation is still open.");
    }
  }

  function openWithCode(e: FormEvent) {
    e.preventDefault();
    const code = joinInput.trim().toUpperCase();
    if (!code) return;
    setMsg(null);
    setErr(null);
    // Entering someone else's circle closes this window on the code just minted.
    setFreshCode(null);
    setViewerCode(code);
  }

  function leaveCaregiverView() {
    setFreshCode(null);
    setViewerCode(null);
    setJoinInput("");
    setMsg(null);
    setErr(null);
  }

  if (!data)
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <div className="space-y-4">
          <SkeletonCard>
            <SkeletonHeading />
            <Skeleton className="mt-3 h-9 w-2/3" />
            <Skeleton className="mt-3 h-3 w-full" />
          </SkeletonCard>
          <SkeletonCard>
            <SkeletonHeading />
            <SkeletonRows count={2} />
          </SkeletonCard>
        </div>
        <SkeletonCard>
          <SkeletonHeading />
          <SkeletonRows count={5} />
        </SkeletonCard>
      </div>
    );

  const open = data.events.filter((ev) => !ev.acknowledged);
  const resolved = data.events.filter((ev) => ev.acknowledged);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
      <div className="space-y-4">
        <div className="vy-hairline-card p-5">
          <p className="vy-eyebrow">{isCaregiver ? "Caregiver view" : "Family circle"}</p>
          {isCaregiver ? (
            <>
              <p className="vy-serif mt-2 text-2xl tracking-[0.25em]" style={{ color: "var(--vy-pine-ink)" }}>{viewerCode}</p>
              <p className="mt-2 text-sm text-muted-foreground">You are reading this circle with an invite code. The feed and today&apos;s adherence are open to you; acknowledgements stay with the patient.</p>
              <button
                onClick={leaveCaregiverView}
                className="mt-3 rounded-lg border px-3 py-1.5 text-xs transition-colors hover:bg-secondary"
              >
                Leave caregiver view
              </button>
            </>
          ) : data.links.length > 0 ? (
            <>
              <p className="vy-serif mt-2 text-4xl tracking-[0.3em]" style={{ color: "var(--vy-pine-ink)" }}>{freshCode ?? "••••••"}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {freshCode
                  ? "This code is shown once, right now, and never again by this app — write it down or send it before you leave the page. Their view shows the live escalation feed and today's adherence."
                  : "Every code was shown once, when its link was created. The list below carries a hint so you can recognise a link, not a usable credential — to re-share, link the person again."}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No circle yet. Link the first caregiver to generate a family code.</p>
          )}
          {!isCaregiver && (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Caregiver name"
                  aria-label="Caregiver name"
                  className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[color:var(--ring)]"
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
              <div className="mt-3 flex flex-col">
                <StatusLine text={msg} />
                <AlertLine text={err} />
              </div>
              {data.links.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {data.links.map((l) => (
                    <li key={l.id} className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                      <span>{l.caregiverName} · {l.relation}</span>
                      {l.hint && <span className="vy-numeral tracking-[0.2em]">{l.hint}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <div className="vy-hairline-card p-5">
          <p className="vy-eyebrow">Caregiver? enter your code</p>
          <form onSubmit={openWithCode} className="mt-3 flex gap-2">
            <input
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value)}
              placeholder="6-character invite"
              aria-label="Family join code"
              maxLength={8}
              className="vy-numeral flex-1 rounded-lg border bg-background px-3 py-2 text-sm uppercase tracking-[0.2em] outline-none focus:ring-2 focus:ring-[color:var(--ring)]"
            />
            <button
              type="submit"
              disabled={!joinInput.trim()}
              className="rounded-lg border px-3 py-2 text-xs font-semibold transition-colors hover:bg-secondary disabled:opacity-40"
            >
              Open feed
            </button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">Read-only. Nothing is sent anywhere; the demo build keeps all data on-device.</p>
        </div>
        {!isCaregiver && (
          <div className="vy-hairline-card p-5">
            <p className="vy-eyebrow">Escalation law</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              The circle is informed when: a dose is taken 2h+ late, a dose is skipped, a plan starts with safety
              findings, or adherence drops. Everything is timestamped and auditable — and nothing is sent anywhere;
              the demo build keeps all data on-device.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <p className="vy-eyebrow">Open escalations ({open.length})</p>
          {open.length === 0 && <p className="vy-hairline-card p-5 text-sm text-muted-foreground">Nothing needs attention. That&apos;s the goal.</p>}
          {open.map((ev) => (
            <EventRow key={ev.id} e={ev} onAck={isCaregiver ? null : () => ack(ev.id)} />
          ))}
        </div>
        {resolved.length > 0 && (
          <div className="space-y-2">
            <p className="vy-eyebrow">Acknowledged ({resolved.length})</p>
            <div className="vy-scroll max-h-56 space-y-2 overflow-y-auto pr-1 opacity-70">
              {resolved.map((ev) => <EventRow key={ev.id} e={ev} onAck={null} />)}
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
