"use client";

/**
 * Vaidya — single-route application (landing story ⇄ live workspace).
 * Everything the judges see lives on this route; data flows through /api/*.
 */

import { useEffect, useState } from "react";
import { Landing } from "@/components/landing";
import { SiteHeader } from "@/components/site-header";
import { Workspace } from "@/components/workspace";
import { api, post, type Metrics } from "@/lib/client";

export default function Page() {
  const [view, setView] = useState<"home" | "app">("home");
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  // One fetch, shared by the header/hero counters wherever they render; the
  // view in the deps re-runs it when the user returns from the workspace.
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
          <SiteHeader onLaunch={launch} />
          <Landing onLaunch={launch} metrics={metrics} />
        </>
      ) : (
        <Workspace onExit={() => setView("home")} />
      )}
    </main>
  );
}
