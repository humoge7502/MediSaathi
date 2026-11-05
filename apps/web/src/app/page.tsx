"use client";

/**
 * Vaidya — single-route application (landing story ⇄ live workspace).
 * Everything the judges see lives on this route; data flows through /api/*.
 */

import { use, useEffect, useState } from "react";
import { Landing } from "@/components/landing";
import { SiteHeader } from "@/components/site-header";
import { DEFAULT_TAB, isTabId, Workspace, type TabId } from "@/components/workspace";
import { api, post, type Metrics } from "@/lib/client";

/**
 * The parameter a deep link arrives on.
 *
 * Two places outside this file name it — the manifest shortcuts in
 * `src/app/manifest.ts` and the notification click in `public/sw.js` — and both
 * promise that `/?task=today` opens the Today panel. A promise made in another
 * file is only true if this one reads it, which is why `e2e/pwa.spec.ts` loads
 * each shortcut URL and checks the tab that answers, rather than checking that
 * the manifest *mentions* them.
 */
const TASK_PARAM = "task";

/** `searchParams` arrives as a Promise (Next 15+), so the value is read on the
 *  server render rather than from `window` after hydration. That is not a style
 *  preference: a link that only works once the client wakes up renders the landing
 *  story first, and a patient tapping *Today* on a launcher icon watches the
 *  homepage flash before the panel they asked for arrives. */
export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const requested = use(searchParams)[TASK_PARAM];
  const task = Array.isArray(requested) ? requested[0] : requested;
  // Narrowed once, into a value the state initialisers can use: `isTabId` is the
  // only thing between `?task=anything` and a tab no panel answers, so a value the
  // tab strip does not name is not a tab — it is no instruction at all.
  const linkedTab: TabId | null = isTabId(task) ? task : null;
  const [view, setView] = useState<"home" | "app">(linkedTab ? "app" : "home");
  const [tab, setTab] = useState<TabId>(linkedTab ?? DEFAULT_TAB);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  // One fetch, shared by the header/hero counters wherever they render; the
  // view in the deps re-runs it when the user returns from the workspace.
  useEffect(() => {
    api<Metrics>("/api/metrics").then(setMetrics).catch(() => undefined);
  }, [view]);

  // A link skipped the button that seeds the demo identity, so the guarantee
  // travels with the link: `linkedTab` only exists on a fresh document, which
  // makes this mount-once for a deep link and never-run for a normal visit.
  useEffect(() => {
    if (!linkedTab) return;
    void post("/api/seed", {}).catch(() => undefined);
  }, [linkedTab]);

  // The address bar mirrors the tab, so a workspace view is reloadable and
  // shareable, and so the URL a notification opens is the URL this page already
  // understands. `replaceState`, not `pushState`: seven tabs are seven views of
  // one app, and a Back button that walks every one of them is a Back button that
  // cannot leave.
  useEffect(() => {
    const wanted = view === "app" ? `/?${TASK_PARAM}=${tab}` : "/";
    const here = window.location.pathname + window.location.search;
    if (here !== wanted) window.history.replaceState(null, "", wanted);
  }, [view, tab]);

  function enterApp(next: TabId) {
    setTab(next);
    setView("app");
    // best-effort: ensure the demo identity exists so analytics work instantly
    void post("/api/seed", {}).catch(() => undefined);
  }

  return (
    <>
      {/* The bar sits before <main>, not inside it. That ordering is the difference
          between a skip link that bypasses the navigation and one that jumps to a
          container whose first child is the navigation — and it is the reason this
          page, not the layout, owns the `id="main"` the skip link names. */}
      {view === "home" && <SiteHeader onLaunch={() => enterApp(DEFAULT_TAB)} />}
      <main id="main" tabIndex={-1} className="min-h-screen">
        {view === "home" ? (
          <Landing onLaunch={() => enterApp(DEFAULT_TAB)} metrics={metrics} />
        ) : (
          <Workspace onExit={() => setView("home")} tab={tab} onTab={setTab} />
        )}
      </main>
    </>
  );
}
