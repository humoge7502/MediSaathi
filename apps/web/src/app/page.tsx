"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function Home() {
  const [metrics, setMetrics] = useState<{
    pipeline_started_total: number;
    refused_total: number;
  } | null>(null);
  const [contrast, setContrast] = useState(false);

  useEffect(() => {
    setContrast(document.documentElement.classList.contains("contrast"));
    api.metrics()
      .then((m) => setMetrics({ pipeline_started_total: m.data?.pipeline_started_total ?? 0, refused_total: m.data?.refused_total ?? 0 }))
      .catch(() => setMetrics(null));
  }, []);

  function toggleContrast() {
    const next = !contrast;
    setContrast(next);
    document.documentElement.classList.toggle("contrast", next);
    try { localStorage.setItem("medisaathi-contrast", next ? "1" : "0"); } catch { }
  }

  return (
    <main id="main" className="mx-auto max-w-3xl px-8 py-20">
      <div className="flex items-center justify-between">
        <p className="text-sm uppercase tracking-[0.2em]" style={{ color: "var(--accent)" }}>
          MediSaathi
        </p>
        <button onClick={toggleContrast}
          className="rounded-full border px-3 py-1 text-xs"
          style={{ borderColor: "var(--border)" }}>
          {contrast ? "☀ Standard view" : "◐ High contrast"}
        </button>
      </div>
      <h1 className="mt-4 text-5xl font-bold leading-tight" style={{ color: "var(--primary)" }}>
        Every prescription,<br />understood.
      </h1>
      <p className="mt-6 text-lg" style={{ color: "var(--muted)" }}>
        Snap the prescription. Get back a verified, spoken medicine plan - screened for
        interactions, priced against generics, and refused instead of guessed when
        confidence drops.
      </p>
      <div className="mt-10 flex flex-wrap gap-3">
        <a href="/scan" className="rounded-lg px-6 py-3 font-semibold text-white" style={{ background: "var(--primary)" }}>
          Scan a prescription
        </a>
        <a href="/judge" className="rounded-lg border px-6 py-3 font-semibold" style={{ borderColor: "var(--primary)", color: "var(--primary)" }}>
          90-second judge walkthrough
        </a>
      </div>

      <section className="mt-16 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border bg-white p-5" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm font-bold">1 · The model reads</p>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            A vision model transcribes each line with an honest per-field confidence -
            under a strict JSON schema, temperature 0.
          </p>
        </div>
        <div className="rounded-xl border bg-white p-5" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm font-bold">2 · The rules decide</p>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            A deterministic engine screens interactions, contraindications, duplicates and
            dose caps on public data. Zero LLM, zero network.
          </p>
        </div>
        <div className="rounded-xl border bg-white p-5" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm font-bold">3 · The plan speaks</p>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            English, Tamil or Hindi audio - every word traceable to a verified slot. Below
            the confidence gate, it refuses instead of guessing.
          </p>
        </div>
        <div className="rounded-xl border bg-white p-5" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm font-bold">4 · Refusal is a feature</p>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {metrics
              ? `${metrics.refused_total} of ${metrics.pipeline_started_total} runs on this instance were refused - measured, not claimed.`
              : "When verification fails, the counter ticks. The discipline is measured on /metrics."}
          </p>
        </div>
      </section>
    </main>
  );
}
