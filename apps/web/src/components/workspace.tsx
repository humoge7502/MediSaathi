"use client";

/** Workspace — the product view: tabs over Verify / Today / Insights / Copilot / Family / Evidence. */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { api, post, type TodayPayload } from "@/lib/client";
import { ThemeToggle } from "@/components/theme-toggle";
import { AlertLine, StatusLine } from "@/components/ui/status-line";

// Panels are lazy-loaded per tab: the landing page and workspace shell ship
// first, each panel chunk loads on first use (keeps first-load JS small).
const VerifyPanel = dynamic(() => import("@/components/app/verify").then((m) => m.VerifyPanel));
const TodayPanel = dynamic(() => import("@/components/app/today").then((m) => m.TodayPanel));
const InsightsPanel = dynamic(() => import("@/components/app/insights").then((m) => m.InsightsPanel));
const CopilotPanel = dynamic(() => import("@/components/app/copilot").then((m) => m.CopilotPanel));
const FamilyPanel = dynamic(() => import("@/components/app/family").then((m) => m.FamilyPanel));
const EvidencePanel = dynamic(() => import("@/components/app/evidence").then((m) => m.EvidencePanel));
const ReviewConsole = dynamic(() => import("@/components/app/console").then((m) => m.ReviewConsole));

const TABS = [
  { id: "verify", label: "Verify" },
  { id: "review", label: "Review" },
  { id: "today", label: "Today" },
  { id: "insights", label: "Insights" },
  { id: "copilot", label: "Copilot" },
  { id: "family", label: "Family" },
  { id: "evidence", label: "Evidence" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

/** The tab a visitor who asked for nothing gets: the thing the product is for. */
export const DEFAULT_TAB: TabId = "verify";

/**
 * Is `value` one of the tabs this strip can show?
 *
 * Exported because the deep link (`?task=…`) is written in three files —
 * `src/app/page.tsx`, the manifest shortcuts and the worker's notification click —
 * and none of them may invent an id. This is the one list, so a renamed tab is a
 * compile-time miss rather than a link that opens an empty panel.
 */
export function isTabId(value: unknown): value is TabId {
  return TABS.some((t) => t.id === value);
}

/**
 * `tab` and `onTab` come from the page rather than living here, because a tab is
 * no longer only a click: it is also the address the app was opened with, and
 * only the route can answer that.
 */
export function Workspace({
  onExit,
  tab,
  onTab,
}: {
  onExit: () => void;
  tab: TabId;
  onTab: (next: TabId) => void;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const [seedErr, setSeedErr] = useState<string | null>(null);
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
    setSeedMsg(null);
    setSeedErr(null);
    try {
      await post("/api/seed", { force: true });
      setSeedMsg("Demo data reset — Asha's plan and 14 days of history are loaded. Opening Insights.");
      onTab("insights");
      refresh();
    } catch (e) {
      // A 403 here is a policy answer, not an outage: the route names the
      // switch an operator would set, and "is the database running?" would
      // send the reader to the wrong tool.
      setSeedErr(e instanceof Error ? e.message : "Seeding failed — is the database running?");
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
          <ThemeToggle />
          <button
            onClick={seed}
            disabled={seeding}
            className="rounded-full border px-4 py-2 text-xs font-medium transition-colors hover:bg-secondary"
            title="Archive the current plan and restore Asha's demo plan with 14 days of history"
          >
            {seeding ? "Seeding demo…" : "Reset demo data"}
          </button>
          <button onClick={onExit} className="rounded-full border px-4 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary">
            ← Back to story
          </button>
        </div>
      </div>

      {/* The seed guidance used to exist only in this button's `title`, which is
          a hover tooltip: not announced, not reachable by keyboard, not shown on
          touch. It is a line on the page now, and a live region so a reset that
          finishes while the reader is elsewhere says so. */}
      <div className="mt-2 flex flex-col">
        <StatusLine text={seedMsg} />
        <AlertLine text={seedErr} />
      </div>

      <nav aria-label="Workspace sections" className="vy-scroll mt-5 flex gap-1 overflow-x-auto border-b pb-px">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
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

      {/* A tab swap is a mount, and a mount is the one case a transition cannot
          animate by itself — the node has no earlier style to move from. `key`
          remounts the wrapper per tab so `@starting-style` gets its first frame;
          without it the wrapper outlives every panel and the entrance would fire
          once per page load instead of once per panel. */}
      <div key={tab} className="vy-enter mt-6">
        {tab === "verify" && <VerifyPanel onPlanStarted={refresh} />}
        {tab === "review" && <ReviewConsole />}
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
