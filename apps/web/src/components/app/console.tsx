"use client";

/**
 * Review console (MED-012) — the human side of the gate law.
 *
 * The confidence gate routes uncertain fields to a persisted confirmation queue
 * that *deterministically blocks* therapy-plan generation. This panel is where a
 * human resolves them: it lists every open queue item across prescriptions, shows
 * the machine's read, its reading confidence and the fused score that routed it,
 * and offers three deliberate actions
 *
 *   confirm  -> the human read (or a corrected brand) becomes the field
 *   correct  -> a corrected brand must resolve against the formulary (422 otherwise)
 *   reject   -> the read is withdrawn; the plan stays blocked
 *
 * Every action is a single transition; a replay is refused, never applied. The
 * append-only transition log is shown underneath, because "who resolved what,
 * when, and why" is part of the safety record, not a debugging nicety.
 *
 * Nothing here diagnoses or advises. It is a review surface for readings.
 */

import { useCallback, useEffect, useState } from "react";
import { api, post } from "@/lib/client";

interface OpenItem {
  id: string;
  prescriptionId: string;
  fieldIndex: number;
  rawText: string;
  fused: number;
  band: string;
  why: string;
  state: string;
  createdAt: string;
  prescription: { verdict: string; confidence: number; rawText: string; createdAt: string };
}

interface OpenResponse {
  open: OpenItem[];
  count: number;
}

interface QueueStatusResponse {
  prescriptionId: string;
  pending: number;
  confirmed: number;
  rejected: number;
  blocked: boolean;
  blockedReason: string | null;
  items: {
    fieldIndex: number;
    rawText: string;
    fused: number;
    band: string;
    why: string;
    state: string;
    resolvedBrand: string | null;
    actor: string;
    note: string;
  }[];
}

interface HistoryResponse {
  transitions: {
    transitionId?: string;
    fieldIndex: number;
    fromState: string;
    toState: string;
    actor: string;
    note: string;
    createdAt: string;
  }[];
  count: number;
}

const STATE_STYLE: Record<string, string> = {
  pending: "vy-sev-moderate",
  confirmed: "vy-sev-pass",
  rejected: "vy-sev-severe",
};

export function ReviewConsole() {
  const [open, setOpen] = useState<OpenItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<QueueStatusResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [brand, setBrand] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshOpen = useCallback(async () => {
    try {
      const r = await api<OpenResponse>("/api/queue");
      setOpen(r.open);
      setError(null);
      return r.open;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the queue");
      return [];
    }
  }, []);

  // Initial load uses the promise form (not an awaited call in the effect body)
  // so the lint rule against cascading renders stays satisfied.
  useEffect(() => {
    api<OpenResponse>("/api/queue")
      .then((r) => { setOpen(r.open); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the queue"));
  }, []);

  const loadDetail = useCallback(async (prescriptionId: string) => {
    setActiveId(prescriptionId);
    try {
      const [s, h] = await Promise.all([
        api<QueueStatusResponse>(`/api/queue?prescriptionId=${encodeURIComponent(prescriptionId)}`),
        api<HistoryResponse>(`/api/queue/history?prescriptionId=${encodeURIComponent(prescriptionId)}`),
      ]);
      setStatus(s);
      setHistory(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the queue detail");
    }
  }, []);

  async function resolve(item: OpenItem, accepted: boolean) {
    setBusy(true);
    setNotice(null);
    try {
      const r = await post<{ status: string; verdict?: string }>("/api/queue", {
        prescriptionId: item.prescriptionId,
        fieldIndex: item.fieldIndex,
        accepted,
        brandText: accepted && brand.trim() ? brand.trim() : undefined,
        note: note.trim() || undefined,
      });
      setNotice(
        r.status === "already_resolved"
          ? "Already resolved — the first transition won; the replay was refused."
          : accepted
            ? `Field confirmed. Prescription re-screened → verdict ${r.verdict}.`
            : "Field rejected — the read is withdrawn and the plan stays blocked."
      );
      setBrand("");
      setNote("");
      const remaining = await refreshOpen();
      if (activeId && !remaining.some((o) => o.prescriptionId === activeId)) {
        await loadDetail(activeId);
      } else if (activeId) {
        await loadDetail(activeId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resolve failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !open) {
    return <div className="vy-hairline-card p-6 text-sm vy-sev-severe">{error}</div>;
  }
  if (!open) {
    return <div className="vy-hairline-card animate-pulse p-10 text-center text-sm text-muted-foreground">Loading the review queue…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="vy-hairline-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="vy-eyebrow">Pharmacist review console</p>
            <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
              Every field the confidence gate routed to the human-confirmation band. While any row here is
              <strong className="text-foreground"> pending</strong>, the prescription cannot generate a therapy plan —
              the block is enforced in the plan transaction, not in the UI.
            </p>
          </div>
          <div className="text-right">
            <p className="vy-numeral vy-serif text-4xl" style={{ color: open.length ? "var(--vy-clay)" : "var(--vy-safe)" }}>{open.length}</p>
            <p className="vy-numeral text-xs text-muted-foreground">open item{open.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        {notice && <p className="vy-fade-up mt-3 rounded-md border px-3 py-2 text-xs text-muted-foreground">{notice}</p>}
        {error && <p className="mt-3 text-sm vy-sev-severe">{error}</p>}
      </div>

      {open.length === 0 ? (
        <div className="vy-hairline-card p-10 text-center">
          <p className="vy-serif text-2xl italic" style={{ color: "var(--vy-hairline)" }}>Queue clear</p>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            No readings are waiting for a human. Run a verification with an unknown or low-confidence line to see the
            gate route a field here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {open.map((item) => {
            const isActive = activeId === item.prescriptionId;
            return (
              <div key={item.id} className="vy-hairline-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="vy-eyebrow">Field {item.fieldIndex} · {item.prescription.verdict}</p>
                    <p className="mt-1 font-mono text-sm">{item.rawText || "(empty read)"}</p>
                    <p className="mt-1 text-xs vy-sev-moderate">{item.why}</p>
                  </div>
                  <div className="text-right vy-numeral text-xs text-muted-foreground">
                    <div>fused {item.fused.toFixed(3)}</div>
                    <div>band {item.band}</div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <input
                    aria-label={`Corrected brand for field ${item.fieldIndex}`}
                    value={isActive ? brand : ""}
                    onFocus={() => { setActiveId(item.prescriptionId); }}
                    onChange={(e) => { setActiveId(item.prescriptionId); setBrand(e.target.value); }}
                    placeholder="corrected brand (optional)"
                    className="rounded-full border bg-background px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[color:var(--vy-pine)]"
                  />
                  <input
                    aria-label={`Resolution note for field ${item.fieldIndex}`}
                    value={isActive ? note : ""}
                    onChange={(e) => { setActiveId(item.prescriptionId); setNote(e.target.value); }}
                    placeholder="reason code / note"
                    className="rounded-full border bg-background px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[color:var(--vy-pine)]"
                  />
                  <button
                    disabled={busy}
                    onClick={() => resolve(item, true)}
                    className="rounded-full px-4 py-1.5 text-xs font-semibold text-white transition-transform hover:scale-[1.02] disabled:opacity-40"
                    style={{ background: "var(--vy-pine)" }}
                  >
                    Confirm read
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => resolve(item, false)}
                    className="rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-secondary disabled:opacity-40"
                  >
                    Reject read
                  </button>
                  <button
                    onClick={() => loadDetail(item.prescriptionId)}
                    className="rounded-full border px-4 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary"
                  >
                    Audit trail
                  </button>
                </div>

                {isActive && status && (
                  <div className="vy-fade-up mt-4 rounded-lg border p-4">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs vy-numeral">
                      <span>pending {status.pending}</span>
                      <span className="vy-sev-pass">confirmed {status.confirmed}</span>
                      <span className="vy-sev-severe">rejected {status.rejected}</span>
                      <span className={status.blocked ? "vy-sev-moderate" : "vy-sev-pass"}>
                        plan {status.blocked ? "BLOCKED" : "unlocked"}
                      </span>
                    </div>
                    <table className="mt-3 w-full text-left text-xs">
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="py-1 font-medium">field</th>
                          <th className="py-1 font-medium">read</th>
                          <th className="py-1 font-medium">fused</th>
                          <th className="py-1 font-medium">state</th>
                          <th className="py-1 font-medium">actor</th>
                        </tr>
                      </thead>
                      <tbody className="vy-numeral">
                        {status.items.map((i) => (
                          <tr key={i.fieldIndex} className="border-t">
                            <td className="py-1.5">{i.fieldIndex}</td>
                            <td className="py-1.5 font-mono">{i.resolvedBrand ?? i.rawText}</td>
                            <td className="py-1.5">{i.fused.toFixed(3)}</td>
                            <td className={`py-1.5 font-semibold ${STATE_STYLE[i.state] ?? ""}`}>{i.state}</td>
                            <td className="py-1.5">{i.actor}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {history && history.transitions.length > 0 && (
                      <ol className="mt-3 space-y-1 text-[11px] text-muted-foreground">
                        {history.transitions.map((t, i) => (
                          <li key={i} className="vy-numeral">
                            {t.createdAt} · field {t.fieldIndex}: {t.fromState} → {t.toState} by {t.actor}
                            {t.note ? ` — ${t.note}` : ""}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Single-transition law: a resolved field can never be resolved again. Replays return
        <span className="vy-numeral"> already_resolved</span> as protocol, not an error.
      </p>
    </div>
  );
}
