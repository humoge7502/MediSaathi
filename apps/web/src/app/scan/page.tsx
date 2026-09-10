"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  speak,
  stopSpeaking,
  type PrescriptionState,
  type PriceReport,
  type SpokenPlan,
} from "@/lib/api";

const SAMPLES = [
  { id: "RX-001", label: "Clean printed Rx (2 medicines)" },
  { id: "RX-002", label: "Warfarin + aspirin (severe interaction)" },
  { id: "RX-004", label: "Duplicate paracetamol brands" },
  { id: "RX-008", label: "Clopidogrel + omeprazole (moderate)" },
  { id: "RX-009", label: "Doxycycline for a child (contraindication)" },
  { id: "RX-003", label: "Handwritten - low confidence (confirm queue)" },
  { id: "RX-006", label: "Corrupted scan (refusal)" },
  { id: "RX-012", label: "Not a prescription (refusal)" },
];

const CONTEXTS = [
  { code: "pregnancy", label: "Pregnant" },
  { code: "age_under_12", label: "Child under 12" },
  { code: "peptic_ulcer", label: "Peptic ulcer" },
  { code: "renal_severe", label: "Severe kidney disease" },
  { code: "asthma_aspirin_sensitive", label: "Aspirin-sensitive asthma" },
];

const VERDICT_STYLE: Record<string, { bg: string; icon: string; label: string }> = {
  pass: { bg: "var(--safe)", icon: "✓", label: "All checks passed" },
  interaction: { bg: "var(--danger)", icon: "⚠", label: "Interaction found" },
  contraindication: { bg: "var(--danger)", icon: "⛔", label: "Contraindication" },
  duplicate_atc: { bg: "var(--warn)", icon: "⧉", label: "Duplicate medicines" },
  confirm_queue: { bg: "var(--warn)", icon: "?", label: "Confirmation needed" },
  refused: { bg: "#5a7a96", icon: "×", label: "Refused - cannot verify" },
};

type Stage = "pick" | "working" | "result";

export default function ScanPage() {
  const [stage, setStage] = useState<Stage>("pick");
  const [state, setState] = useState<PrescriptionState | null>(null);
  const [plan, setPlan] = useState<SpokenPlan | null>(null);
  const [price, setPrice] = useState<PriceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contexts, setContexts] = useState<string[]>([]);
  const [lang, setLang] = useState<"en" | "ta" | "hi">("en");
  const [speakingIdx, setSpeakingIdx] = useState<number>(-1);
  const [confirmText, setConfirmText] = useState<Record<number, string>>({});
  const [searchOpen, setSearchOpen] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const contextParam = contexts.join(",");

  const loadDetail = useCallback(async (pid: string) => {
    const [p, pr] = await Promise.allSettled([api.plan(pid, lang), api.price(pid)]);
    if (p.status === "fulfilled" && p.value.data) setPlan(p.value.data);
    else setPlan(null);
    if (pr.status === "fulfilled" && pr.value.data) setPrice(pr.value.data);
    else setPrice(null);
  }, [lang]);

  const run = useCallback(async (fn: () => Promise<{ data: PrescriptionState | null; meta: Record<string, unknown> }>) => {
    setStage("working");
    setError(null);
    setPlan(null);
    setPrice(null);
    stopSpeaking();
    const t0 = performance.now();
    try {
      const env = await fn();
      const st = env.data;
      if (!st) throw new Error("empty response");
      setState(st);
      setStage("result");
      void loadDetail(st.prescription_id);
      const ms = Math.round(performance.now() - t0);
      console.info(`verdict=${env.meta.verdict} client_latency_ms=${ms}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("pick");
    }
  }, [loadDetail]);

  const confirmField = useCallback(async (fieldIndex: number, brandText: string) => {
    if (!state) return;
    try {
      const env = await api.confirm(state.prescription_id, {
        field_index: fieldIndex,
        brand_text: brandText,
        accepted: true,
      });
      if (env.data) {
        setState(env.data);
        void loadDetail(env.data.prescription_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [state, loadDetail]);

  const playPlan = useCallback(async () => {
    if (!plan) return;
    void speak(plan.segments, lang, setSpeakingIdx);
  }, [plan, lang]);

  const style = (k: string) => VERDICT_STYLE[k] ?? VERDICT_STYLE.refused;
  const verdict = state?.verdict;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: "var(--primary)" }}>
          Scan a prescription
        </h1>
        <a href="/" className="text-sm underline" style={{ color: "var(--muted)" }}>Home</a>
      </div>

      {stage === "pick" && (
        <section className="mt-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => cameraRef.current?.click()}
              className="rounded-xl border-2 border-dashed px-6 py-8 text-left hover:border-[var(--accent)]"
              style={{ borderColor: "var(--border)" }}
            >
              <span className="text-2xl">📷</span>
              <p className="mt-2 font-semibold">Take a photo</p>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Live vision path (needs API key on the server)
              </p>
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-xl border-2 border-dashed px-6 py-8 text-left hover:border-[var(--accent)]"
              style={{ borderColor: "var(--border)" }}
            >
              <span className="text-2xl">🖼️</span>
              <p className="mt-2 font-semibold">Upload an image</p>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                JPEG/PNG up to 12 MB
              </p>
            </button>
          </div>
          <input
            ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) run(() => api.upload(f, contextParam));
            }}
          />
          <input
            ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) run(() => api.upload(f, contextParam));
            }}
          />

          <fieldset className="mt-8">
            <legend className="text-sm font-semibold">Patient context (stays on-device, declares facts - never inferred)</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {CONTEXTS.map((c) => (
                <label key={c.code}
                  className="cursor-pointer rounded-full border px-3 py-1 text-sm"
                  style={{
                    borderColor: contexts.includes(c.code) ? "var(--accent)" : "var(--border)",
                    background: contexts.includes(c.code) ? "var(--surface)" : "white",
                  }}>
                  <input type="checkbox" className="mr-2" checked={contexts.includes(c.code)}
                    onChange={() =>
                      setContexts((cs) =>
                        cs.includes(c.code) ? cs.filter((x) => x !== c.code) : [...cs, c.code])}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>

          <p className="mt-8 text-sm font-semibold" style={{ color: "var(--muted)" }}>
            …or pick a sealed demo sample (fully offline):
          </p>
          <ul className="mt-3 grid gap-2">
            {SAMPLES.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => run(() => api.start(s.id, contextParam))}
                  className="w-full rounded-xl border bg-white px-5 py-3 text-left hover:border-[var(--accent)]"
                >
                  <span className="font-mono text-xs" style={{ color: "var(--accent)" }}>{s.id}</span>
                  <span className="ml-3 text-sm">{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
          {error && (
            <p className="mt-4 rounded-lg px-4 py-3 text-sm text-white" style={{ background: "var(--danger)" }}>
              {error}
            </p>
          )}
        </section>
      )}

      {stage === "working" && (
        <section className="mt-16 animate-pulse text-center">
          <p className="text-4xl">🔎</p>
          <p className="mt-4 font-semibold">Reading the prescription…</p>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Extraction with per-field confidence → deterministic safety screen.
          </p>
        </section>
      )}

      {stage === "result" && verdict && state && (
        <section className="mt-6">
          <div className="rounded-2xl p-6 text-white" style={{ background: style(verdict.kind).bg }}
            role="status" aria-live="polite">
            <p className="text-3xl" aria-hidden="true">{style(verdict.kind).icon}</p>
            <h2 className="mt-2 text-xl font-bold">{verdict.headline}</h2>
            <p className="mt-2 text-sm opacity-90">{verdict.detail}</p>
          </div>

          {state.extraction && (
            <div className="mt-4 rounded-xl border bg-white p-4" style={{ borderColor: "var(--border)" }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Extracted fields · engine {state.extraction.engine} · {state.extraction.latency_ms} ms
              </p>
              <ul className="mt-2 space-y-2">
                {state.extraction.fields.map((f, i) => {
                  const queued = state.confirm_queue.some((c) => c.field_index === i);
                  const color = f.confidence >= 0.9 ? "var(--safe)" : f.confidence >= 0.75 ? "var(--warn)" : "var(--danger)";
                  return (
                    <li key={i} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)" }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm">{f.brand_text || f.raw_text}</span>
                        <span className="font-mono text-xs" style={{ color }}>
                          {(f.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                      {(f.frequency || f.duration || f.strength) && (
                        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                          {[f.strength, f.frequency, f.duration].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {queued && (
                        <div className="mt-2 rounded-md p-2" style={{ background: "var(--surface)" }}>
                          <p className="text-xs" style={{ color: "var(--warn)" }}>
                            Needs confirmation: {state.confirm_queue.find((c) => c.field_index === i)?.reason}
                          </p>
                          <div className="mt-2 flex gap-2">
                            <input
                              className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"
                              style={{ borderColor: "var(--border)" }}
                              placeholder="Type the correct brand…"
                              aria-label={`Corrected brand name for ${f.brand_text || f.raw_text}`}
                              value={confirmText[i] ?? ""}
                              onFocus={() => setSearchOpen(i)}
                              onChange={(e) => setConfirmText((t) => ({ ...t, [i]: e.target.value }))}
                            />
                            <button
                              className="rounded px-3 py-1 text-sm font-semibold text-white"
                              style={{ background: "var(--primary)" }}
                              onClick={() => {
                                const val = confirmText[i]?.trim();
                                if (val) void confirmField(i, val);
                              }}
                            >
                              Confirm
                            </button>
                          </div>
                          {searchOpen === i && (confirmText[i]?.length ?? 0) >= 2 && (
                            <SearchList q={confirmText[i]} onPick={(brand) => {
                              setConfirmText((t) => ({ ...t, [i]: brand }));
                              setSearchOpen(null);
                            }} />
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {state.safety && state.safety.interactions.length > 0 && (
            <div className="mt-4 rounded-xl border p-4" style={{ borderColor: "var(--danger)", background: "#fdf3f2" }}>
              <p className="text-sm font-bold" style={{ color: "var(--danger)" }}>Interactions (deterministic screen)</p>
              <ul className="mt-2 space-y-2 text-sm">
                {state.safety.interactions.map((it, i) => (
                  <li key={i}>
                    <span className="font-semibold">{it.molecule_a} + {it.molecule_b}</span>
                    <span className="ml-2 rounded px-1.5 py-0.5 text-xs font-bold text-white"
                      style={{ background: it.severity === "severe" ? "var(--danger)" : "var(--warn)" }}>
                      {it.severity}
                    </span>
                    <span className="block text-xs" style={{ color: "var(--muted)" }}>
                      {it.mechanism} · {it.source}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {state.safety && state.safety.warnings.length > 0 && (
            <div className="mt-4 rounded-xl border p-4" style={{ borderColor: "var(--warn)", background: "#fdf9ef" }}>
              <p className="text-sm font-bold" style={{ color: "var(--warn)" }}>Dose notes</p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {state.safety.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {verdict.kind === "confirm_queue" && (
            <p className="mt-4 rounded-lg px-4 py-3 text-sm" style={{ background: "var(--surface)" }}>
              The plan and price unlock after every queued field is confirmed - that is the gate working, not failing.
            </p>
          )}

          {plan && verdict.kind !== "confirm_queue" && (
            <div className="mt-4 rounded-xl border bg-white p-4" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold">Spoken plan</p>
                <div className="flex gap-1">
                  {(["en", "ta", "hi"] as const).map((l) => (
                    <button key={l}
                      onClick={() => { setLang(l); }}
                      className="rounded-full px-3 py-1 text-xs font-semibold"
                      style={{
                        background: lang === l ? "var(--primary)" : "var(--surface)",
                        color: lang === l ? "white" : "var(--text)",
                      }}>
                      {l === "en" ? "English" : l === "ta" ? "தமிழ்" : "हिन्दी"}
                    </button>
                  ))}
                </div>
              </div>
              <ul className="mt-3 space-y-1.5">
                {plan.segments.map((s, i) => (
                  <li key={i}
                    className="rounded px-2 py-1 text-sm transition-colors"
                    style={{ background: speakingIdx === i ? "var(--surface)" : "transparent" }}>
                    {s.kind !== "medication" && (
                      <span className="mr-2 text-xs font-bold uppercase" style={{ color: "var(--muted)" }}>
                        {s.kind}
                      </span>
                    )}
                    {s.text}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <button onClick={playPlan}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
                  style={{ background: "var(--primary)" }}>
                  ▶ Play plan aloud
                </button>
                <button onClick={stopSpeaking}
                  className="rounded-lg border px-4 py-2 text-sm"
                  style={{ borderColor: "var(--border)" }}>
                  ■ Stop
                </button>
              </div>
              <p className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>{plan.disclaimer}</p>
            </div>
          )}

          {price && verdict.kind !== "confirm_queue" && (
            <div className="mt-4 rounded-xl border bg-white p-4" style={{ borderColor: "var(--border)" }}>
              <p className="text-sm font-bold">Generic price check · Jan Aushadhi</p>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs" style={{ color: "var(--muted)" }}>
                    <th className="py-1">Brand</th><th>Unit ₹</th><th>Generic</th><th>Savings</th>
                  </tr>
                </thead>
                <tbody>
                  {price.rows.map((r, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: "var(--border)" }}>
                      <td className="py-1.5">{r.brand}</td>
                      <td>{r.unit_price_inr != null ? `₹${r.unit_price_inr.toFixed(2)}` : "-"}</td>
                      <td>{r.generic_available ? `${r.generic_brand} · ₹${r.generic_price_inr?.toFixed(2)}` : "n/a"}</td>
                      <td style={{ color: "var(--safe)" }}>
                        {r.savings_inr ? `₹${r.savings_inr.toFixed(2)}` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                Total: ₹{price.summary.unit_total_inr.toFixed(2)} → generic ₹{price.summary.generic_total_inr.toFixed(2)}
                {" "}· save ₹{price.summary.savings_total_inr.toFixed(2)} per unit cycle · snapshot {price.summary.snapshot}
              </p>
            </div>
          )}

          {verdict.provenance && verdict.provenance.length > 0 && (
            <details className="mt-4 rounded-xl border bg-white p-4" style={{ borderColor: "var(--border)" }}>
              <summary className="cursor-pointer text-sm font-bold">Provenance - every decision, sourced</summary>
              <ul className="mt-2 space-y-1 text-xs" style={{ color: "var(--muted)" }}>
                {verdict.provenance.map((p, i) => (
                  <li key={i}>
                    <span className="font-mono">{p.kind}</span> · {p.name} · {p.source} · snapshot {p.snapshot}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="mt-6 flex gap-3">
            <button onClick={() => { setStage("pick"); setState(null); stopSpeaking(); }}
              className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
              style={{ background: "var(--primary)" }}>
              Scan another
            </button>
            {verdict.kind === "pass" && (
              <a href={`/adr?pid=${state.prescription_id}&med=${encodeURIComponent(state.safety?.medications[0]?.brand ?? "")}`}
                className="rounded-lg border px-5 py-2.5 text-sm"
                style={{ borderColor: "var(--border)" }}>
                Report a side effect (ADR)
              </a>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

function SearchList({ q, onPick }: { q: string; onPick: (brand: string) => void }) {
  const [results, setResults] = useState<{ brand: string; molecule: string }[]>([]);

  // Fetch on query change (effect, not render phase - the previous
  // render-phase setState pattern could loop under concurrent React).
  useEffect(() => {
    let alive = true;
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    api.search(q)
      .then((r) => { if (alive) setResults(r.data?.results ?? []); })
      .catch(() => { if (alive) setResults([]); });
    return () => { alive = false; };
  }, [q]);

  if (results.length === 0) return null;
  return (
    <ul className="mt-2 max-h-40 overflow-auto rounded border bg-white" style={{ borderColor: "var(--border)" }}>
      {results.map((r) => (
        <li key={r.brand}>
          <button className="w-full px-2 py-1.5 text-left text-sm hover:bg-[var(--surface)]"
            onClick={() => onPick(r.brand)}>
            <span className="font-semibold">{r.brand}</span>
            <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>{r.molecule}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
