"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { API_BASE, type Envelope } from "@/lib/api";

function AdrForm() {
  const params = useSearchParams();
  const [medicine, setMedicine] = useState(params.get("med") ?? "");
  const [reaction, setReaction] = useState("");
  const [severity, setSeverity] = useState("moderate");
  const [onsetDays, setOnsetDays] = useState(1);
  const [outcome, setOutcome] = useState("recovering");
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!medicine.trim() || !reaction.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/adr-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prescription_id: params.get("pid") ?? undefined,
          medicine, reaction, severity,
          onset_days: Number(onsetDays) || 1, outcome,
        }),
      });
      const env: Envelope<Record<string, string>> = await res.json();
      setDraft(env.data ?? null);
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded border px-3 py-2 text-sm";
  const border = { borderColor: "var(--border)" };

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <a href="/scan" className="text-sm underline" style={{ color: "var(--muted)" }}>← Back</a>
      <h1 className="mt-3 text-2xl font-bold" style={{ color: "var(--primary)" }}>
        Report a suspected side effect
      </h1>
      <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
        One tap builds a structured PvPI (PvMICC) draft. Nothing is auto-submitted - it is
        handed to your pharmacist or doctor to review.
      </p>

      <div className="mt-6 grid gap-3">
        <input className={field} style={border} placeholder="Medicine name"
          value={medicine} onChange={(e) => setMedicine(e.target.value)} />
        <input className={field} style={border} placeholder="What happened? (reaction)"
          value={reaction} onChange={(e) => setReaction(e.target.value)} />
        <div className="grid grid-cols-3 gap-3">
          <select className={field} style={border} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="mild">Mild</option>
            <option value="moderate">Moderate</option>
            <option value="severe">Severe</option>
          </select>
          <input className={field} style={border} type="number" min={0}
            value={onsetDays} onChange={(e) => setOnsetDays(Number(e.target.value))} />
          <select className={field} style={border} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="recovering">Recovering</option>
            <option value="recovered">Recovered</option>
            <option value="ongoing">Ongoing</option>
          </select>
        </div>
        <button
          onClick={submit} disabled={busy || !medicine.trim() || !reaction.trim()}
          className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--primary)" }}>
          {busy ? "Building draft…" : "Build PvPI draft"}
        </button>
      </div>

      {draft && (
        <div className="mt-6 rounded-xl border bg-white p-4" style={border}>
          <p className="text-sm font-bold">Draft (review before submission)</p>
          <dl className="mt-2 space-y-1 text-xs">
            {Object.entries(draft).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="w-40 shrink-0 font-mono" style={{ color: "var(--muted)" }}>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </main>
  );
}

export default function AdrPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-2xl px-6 py-12">Loading…</main>}>
      <AdrForm />
    </Suspense>
  );
}
