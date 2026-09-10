"use client";

/** Workspace — the product view: tabs over Verify / Today / Insights / Copilot / Family / Evidence. */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { api, post, type TodayPayload } from "@/lib/client";

// Panels are lazy-loaded per tab: the landing page and workspace shell ship
// first, each panel chunk loads on first use (keeps first-load JS small).
const VerifyPanel = dynamic(() => import("@/components/app/verify").then((m) => m.VerifyPanel));
const TodayPanel = dynamic(() => import("@/components/app/today").then((m) => m.TodayPanel));
const InsightsPanel = dynamic(() => import("@/components/app/insights").then((m) => m.InsightsPanel));
const CopilotPanel = dynamic(() => import("@/components/app/copilot").then((m) => m.CopilotPanel));
const FamilyPanel = dynamic(() => import("@/components/app/family").then((m) => m.FamilyPanel));
const EvidencePanel = dynamic(() => import("@/components/app/evidence").then((m) => m.EvidencePanel));

const TABS = [
  { id: "verify", label: "Verify" },
  { id: "today", label: "Today" },
  { id: "insights", label: "Insights" },
  { id: "copilot", label: "Copilot" },
  { id: "family", label: "Family" },
  { id: "evidence", label: "Evidence" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Workspace({ onExit }: { onExit: () => void }) {
  const [tab, setTab] = useState<TabId>("verify");
  const [refreshKey, setRefreshKey] = useState(0);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  useEffect(() => {
    // check whether a plan exists to auto-suggest seeding
    api<TodayPayload>("/api/plans")
      .then((p) => {
        if (!p.plan) setSeedMsg("No active plan yet — reset demo data to restore Asha's plan with a 14-day history.");
      })
      .catch(() => undefined);
  }, [refreshKey]);

  async function seed() {
    setSeeding(true);
    try {
      await post("/api/seed", { force: true });
      setSeedMsg(null);
      setTab("insights");
      refresh();
    } catch {
      setSeedMsg("Seeding failed — is the database running?");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-6 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="vy-eyebrow">Live product</p>
          <h2 className="vy-serif text-2xl">Vaidya workspace</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={seed}
            disabled={seeding}
            className="rounded-full border px-4 py-2 text-xs font-medium transition-colors hover:bg-secondary"
            title={seedMsg ?? "Archive the current plan and restore Asha's demo plan with 14 days of history"}
          >
            {seeding ? "Seeding demo…" : "Reset demo data"}
          </button>
          <button onClick={onExit} className="rounded-full border px-4 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary">
            ← Back to story
          </button>
        </div>
      </div>

      <nav aria-label="Workspace sections" className="vy-scroll mt-5 flex gap-1 overflow-x-auto border-b pb-px">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`whitespace-nowrap rounded-t-lg px-4 py-2.5 text-sm transition-colors ${
              tab === t.id ? "border-x border-t bg-card font-semibold" : "text-muted-foreground hover:text-foreground"
            }`}
            style={tab === t.id ? { borderColor: "var(--border)", borderBottomColor: "var(--card)" } : {}}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "verify" && <VerifyPanel onPlanStarted={refresh} />}
        {tab === "today" && <TodayPanel refreshKey={refreshKey} />}
        {tab === "insights" && <InsightsPanel refreshKey={refreshKey} />}
        {tab === "copilot" && <CopilotPanel />}
        {tab === "family" && <FamilyPanel refreshKey={refreshKey} />}
        {tab === "evidence" && <EvidencePanel />}
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Vaidya is an information layer — not a doctor, not a medical device. In an emergency, contact local emergency services.
      </p>
    </div>
  );
}
