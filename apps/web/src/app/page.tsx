"use client";

/**
 * Vaidya — single-route application (landing story ⇄ live workspace).
 * Everything the judges see lives on this route; data flows through /api/*.
 */

import { useEffect, useState } from "react";
import { Landing } from "@/components/landing";
import { Workspace } from "@/components/workspace";
import { api, post, type Metrics } from "@/lib/client";

export default function Page() {
  const [view, setView] = useState<"home" | "app">("home");
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    api<Metrics>("/api/metrics").then(setMetrics).catch(() => undefined);
  }, [view]);

  function launch() {
    setView("app");
    // best-effort: ensure the demo identity exists so analytics work instantly
    void post("/api/seed", {}).catch(() => undefined);
  }

  return (
    <main className="min-h-screen">
      {view === "home" ? (
        <>
          <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
              <div className="flex items-baseline gap-2">
                <span className="vy-serif text-xl font-semibold" style={{ color: "var(--vy-pine)" }}>वैद्य</span>
                <span className="text-sm font-semibold tracking-wide">VAIDYA</span>
              </div>
              <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex" aria-label="Sections">
                <a href="#gap" className="transition-colors hover:text-foreground">The gap</a>
                <a href="#loop" className="transition-colors hover:text-foreground">The loop</a>
                <a href="#law" className="transition-colors hover:text-foreground">The law</a>
              </nav>
              <button
                onClick={launch}
                className="rounded-full px-5 py-2 text-sm font-semibold text-white transition-transform hover:scale-[1.03]"
                style={{ background: "var(--vy-pine)" }}
              >
                Launch app
              </button>
            </div>
          </header>
          <Landing onLaunch={launch} />
        </>
      ) : (
        <Workspace onExit={() => setView("home")} />
      )}
    </main>
  );
}
