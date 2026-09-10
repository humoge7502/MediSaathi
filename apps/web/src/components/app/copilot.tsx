"use client";

/** Copilot panel — grounded Q&A with citations, honest refusals, trap-question chips. */

import { useEffect, useRef, useState } from "react";
import { api, post, type CopilotResult } from "@/lib/client";

interface Msg {
  role: "user" | "assistant";
  text: string;
  result?: CopilotResult;
}

const TRAPS = [
  "What is metformin used for?",
  "Should I double my dose today?",
  "Can I drink beer with metronidazole?",
  "Who won the last IPL final?",
  "I have chest pain since morning",
];

export function CopilotPanel() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [kb, setKb] = useState<{ chunks: number; sources: string[] } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ chunks: number; sources: string[] }>("/api/copilot").then(setKb).catch(() => setKb(null));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setBusy(true);
    try {
      const history = messages.slice(-4).map((m) => ({ role: m.role, content: m.text }));
      const r = await post<CopilotResult>("/api/copilot", { question, history });
      setMessages((m) => [...m, { role: "assistant", text: r.answer, result: r }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: e instanceof Error ? e.message : "The service is unavailable." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <div className="vy-hairline-card flex min-h-[32rem] flex-col">
        <div className="vy-scroll flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="vy-serif text-4xl italic" style={{ color: "var(--vy-pine)" }}>Vaidya</div>
              <p className="max-w-sm text-sm text-muted-foreground">
                Ask about your medicines. Every answer comes from a curated, source-attributed knowledge base —
                and the copilot <em>refuses</em> what it cannot verify. Try a trap question on the right.
              </p>
            </div>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm text-white" style={{ background: "var(--vy-pine)" }}>
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div className={`max-w-[88%] rounded-2xl rounded-bl-md px-4 py-3 text-sm leading-relaxed ${kindClass(m.result?.kind)}`}>
                  <KindBadge kind={m.result?.kind} guarded={m.result?.guarded} />
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  {m.result && m.result.citations.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-2" style={{ borderColor: "color-mix(in oklch, var(--border) 70%, transparent)" }}>
                      {m.result.citations.map((c) => (
                        <span key={c.n} className="vy-numeral rounded-full border bg-background px-2 py-0.5 text-[10px] text-muted-foreground" title={c.title}>
                          [{c.n}] {c.title} — {c.source}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.result && (
                    <p className="vy-numeral mt-2 text-[10px] text-muted-foreground">
                      {m.result.kind} · retrieval [{m.result.retrievalScores.join(", ") || "—"}] · {m.result.latencyMs} ms
                    </p>
                  )}
                </div>
              </div>
            )
          )}
          {busy && <div className="text-sm text-muted-foreground">Vaidya is checking its sources…</div>}
          <div ref={endRef} />
        </div>
        <div className="border-t p-4">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask(input)}
              placeholder="Ask about a medicine, food, alcohol, missed doses…"
              aria-label="Ask the copilot"
              className="flex-1 rounded-full border bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[color:var(--vy-pine)]"
            />
            <button
              onClick={() => ask(input)}
              disabled={busy || !input.trim()}
              className="rounded-full px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: "var(--vy-pine)" }}
            >
              Ask
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="vy-hairline-card p-5">
          <p className="vy-eyebrow">Three gates, in order</p>
          <ol className="mt-3 list-decimal space-y-2 pl-4 text-sm text-muted-foreground">
            <li><strong className="text-foreground">Emergency triage</strong> — deterministic patterns redirect to urgent care before any generation.</li>
            <li><strong className="text-foreground">Scope refusal</strong> — personal dose changes are refused by rule, not by hope.</li>
            <li><strong className="text-foreground">Grounded generation</strong> — answers cite [n] sources; a post-check strips stray dosage instructions; low retrieval ⇒ refusal.</li>
          </ol>
        </div>
        <div className="vy-hairline-card p-5">
          <p className="vy-eyebrow">Try these</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {TRAPS.map((t) => (
              <button key={t} onClick={() => ask(t)} className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                {t}
              </button>
            ))}
          </div>
        </div>
        {kb && (
          <div className="vy-hairline-card p-5">
            <p className="vy-eyebrow">Knowledge base</p>
            <p className="mt-2 vy-numeral text-sm">{kb.chunks} curated chunks · sources: {kb.sources.join(", ")}</p>
            <p className="mt-2 text-xs text-muted-foreground">Generic patient-education content; the copilot cannot speak outside it.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function kindClass(kind?: string): string {
  switch (kind) {
    case "emergency": return "vy-banner-severe";
    case "refused_scope": return "vy-banner-moderate";
    case "refused_low_confidence": return "vy-banner-neutral";
    default: return "bg-card border";
  }
}

function KindBadge({ kind, guarded }: { kind?: string; guarded?: boolean }) {
  if (!kind) return null;
  const label =
    kind === "grounded" ? (guarded ? "grounded · post-check guarded" : "grounded") :
    kind === "emergency" ? "emergency redirect" :
    kind === "refused_scope" ? "refused — out of scope" :
    "refused — low retrieval confidence";
  return <p className="vy-eyebrow !text-[10px]">{label}</p>;
}
