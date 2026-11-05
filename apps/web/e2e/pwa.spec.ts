/**
 * PWA gate, part 1 (TD-27 slice 1) — the served bytes and the worker's queue.
 *
 * `tests/pwa.test.ts` (33) pins the contract in source: every constant the worker
 * mirrors, the message vocabulary, the shape of a reply the page is allowed to
 * believe, the manifest colours against `globals.css`, the measured maskable
 * geometry, and the proxy matcher compiled so the `sw.js` exclusion is proven
 * semantically *and* proven necessary. All of that is text and pure functions. None
 * of it has ever run a worker.
 *
 * What this file proves, in the order the features depend on each other:
 *
 *   1. **The served bytes.** `/sw.js` and `/manifest.webmanifest` are answered by
 *      two different policies, and which one wins is decided by a regex in a config
 *      file. The unit tier can assert the header *strings*; only a request sees that
 *      `next.config.ts` actually set them on that route, that the document policy
 *      still carries a nonce, and that the manifest the OS reads at install time is
 *      the JSON the route returns.
 *   2. **That a worker starts.** Registration is the exact failure the CSP routing
 *      exists to prevent: under the document's `'strict-dynamic'` policy the worker's
 *      own body has no permission to run, `register()` rejects with a generic
 *      `SecurityError`, and every product-level promise about a closed tab becomes
 *      false while the UI still says "linked". A resolved registration plus a
 *      controlling document is the browser's answer, not ours.
 *   3. **That a queue outlives the document.** The handover is posted, every tab is
 *      closed, and the alerts must still be there when a page comes back — through
 *      IndexedDB, not through a page that happens to still be open. A message whose
 *      day the worker does not live in is discarded rather than merged, which is the
 *      same claim `stateFired`'s day guard makes from the page side.
 *   4. **The links an icon and a notification open.** Every shortcut the manifest
 *      advertises, and the URL the worker's `notificationclick` handler navigates to.
 *
 * Delivery itself — a notification reaching the platform with every tab closed, and
 * the page refusing to announce what the worker already announced — is in
 * `pwa-delivery.spec.ts`. It needs a real message centre, which headless Chromium
 * does not have (`Notification.permission` reports `"denied"` there even when the
 * content setting says "granted", so nothing can reach `showNotification`), and
 * Playwright refuses `test.use({ headless })` inside a `describe`. Two files, one
 * set of helpers in `pwa-helpers.ts`.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  TIMER_HORIZON_MS,
  TODAY_URL,
  cancelMessage,
  dayKey,
  syncMessage,
} from "../src/lib/reminders-background";
import { DEFAULT_SETTINGS, planAlerts } from "../src/lib/safety/reminders";
import { THEME_CHROME } from "../src/lib/theme";
import {
  BASE,
  askWorker,
  askWorkerWhen,
  connect,
  controlledPage,
  disconnect,
  dose,
  handover,
  postToWorker,
  type WorkerState,
} from "./pwa-helpers";

/** The tab strip, so a shortcut's name is compared to the control it claims to open
 *  and not to any other button on the page that happens to read "Today". */
const TAB_STRIP = "Workspace sections";

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await connect();
});

test.afterAll(async () => {
  await disconnect(api);
});

// ---- 1. the bytes an installer and a worker actually receive ----------------

test.describe("what the origin serves", () => {
  test("the manifest route is the manifest the OS reads", async () => {
    const res = await api.get("/manifest.webmanifest");
    expect(res.ok()).toBeTruthy();
    // A launcher that sniffs the type refuses a JSON body served as text.
    expect(res.headers()["content-type"]).toContain("application/manifest+json");
    const served = (await res.json()) as {
      id: string;
      start_url: string;
      scope: string;
      display: string;
      theme_color: string;
      background_color: string;
      icons: { src: string; sizes: string; purpose?: string }[];
      shortcuts: { name: string; short_name: string; url: string }[];
    };
    // Installability inputs, asserted on the wire rather than in the module that
    // generates them: no id, no scope or no standalone display is an install that
    // silently falls back to a browser tab.
    expect(served.id).toBe("/");
    expect(served.scope).toBe("/");
    expect(served.start_url).toBe("/");
    expect(served.display).toBe("standalone");
    expect(served.theme_color).toBe(THEME_CHROME.light);
    expect(served.background_color).toBe(THEME_CHROME.light);
    expect(served.icons.map((i) => i.purpose).sort()).toEqual(["any", "maskable"]);
    expect(served.shortcuts.length).toBeGreaterThan(0);
    // The document has to point at it; a manifest nothing references is a file.
    const html = await (await api.get("/")).text();
    expect(html).toContain('rel="manifest"');
    expect(html).toContain("/manifest.webmanifest");
  });

  test("/sw.js is served under a policy a worker can run, and no nonce leaks in", async () => {
    const res = await api.get("/sw.js");
    expect(res.ok()).toBeTruthy();
    expect(res.headers()["content-type"]).toContain("javascript");
    const csp = res.headers()["content-security-policy"] ?? "";
    // The two things that would kill the body: a nonce (the worker has none) and
    // 'strict-dynamic' (which makes a conforming browser ignore 'self' entirely).
    expect(csp).toBeTruthy();
    expect(csp).not.toContain("nonce-");
    expect(csp).not.toContain("strict-dynamic");
    expect(csp).toContain("script-src 'self'");
    // An immutable worker is a worker that never updates.
    expect(res.headers()["cache-control"]).toContain("must-revalidate");

    // And the document policy is still the document's own — the exclusion must not
    // have become a hole in the page's CSP.
    const doc = await api.get("/");
    const docCsp = doc.headers()["content-security-policy"] ?? "";
    expect(docCsp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(docCsp).not.toBe(csp);
  });
});

// ---- 2. a worker that starts, and a queue that outlives the page ------------

test.describe("the worker runs and keeps its queue", () => {
  test("the browser registers the worker and lets it control the document", async ({ page }) => {
    await controlledPage(page);
    // `scope` is a property of the registration, not of the worker that holds it, so
    // "it controls *this* document" and "over this origin" are read from two
    // different objects — and both have to be true.
    const facts = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return {
        scriptURL: navigator.serviceWorker.controller?.scriptURL ?? null,
        state: navigator.serviceWorker.controller?.state ?? null,
        scope: reg.scope,
      };
    });
    expect(facts.scriptURL, "register() resolved but no worker controls the document").toBe(`${BASE}/sw.js`);
    expect(facts.state).toBe("activated");
    expect(facts.scope).toBe(`${BASE}/`);
  });

  test("a handed-over queue is still there with every tab closed", async ({ page }) => {
    // The claim is about *persistence*, so the alert is deliberately still in the
    // future when the tabs go: an alert the worker fired would have left `armed`,
    // and its presence in `fired` would prove storage rather than a live timer.
    await controlledPage(page);
    const message = handover("gate-dose", 4 * 60_000);
    expect(message.armed.length, "the law produced nothing to hand over").toBeGreaterThan(0);
    await postToWorker(page, message);

    const before = await askWorkerWhen(page, (s) => s.armed.length > 0, "the queue it was just handed");
    expect(before.day).toBe(dayKey(Date.now()));
    expect(before.armed.map((a) => a.key)).toEqual(message.armed.map((a) => a.key));

    await page.close();
    const second = await page.context().newPage();
    await controlledPage(second);
    const after = await askWorker(second);
    // Same keys, same moments, same wording — from IndexedDB, not from a page that
    // was still open to remember them.
    expect(after.armed.map((a) => `${a.key}@${a.at}`)).toEqual(before.armed.map((a) => `${a.key}@${a.at}`));
    expect(after.armed.map((a) => a.title)).toEqual(before.armed.map((a) => a.title));
    expect(after.fired).toEqual([]);
    await second.close();
  });

  test("a message from another day is discarded, and its silence with it", async ({ page }) => {
    // Dose ids belong to a plan and survive their day, so a `due` key carried over
    // from yesterday would hush today's alert for the same medicine at the same hour
    // with nothing in the UI to explain it. This is the worker's half of the guard
    // `stateFired` applies on the page.
    await controlledPage(page);
    const now = Date.now();
    const stale = {
      ...syncMessage(planAlerts([dose("stale", now + 60_000)], DEFAULT_SETTINGS, now), [], now),
      day: dayKey(now - 24 * 3_600_000),
      fired: ["stale:due"],
    };
    expect(stale.armed.map((a) => a.key)).toEqual(["stale:due"]);
    await postToWorker(page, stale);
    // Today's queue goes in second, so the reply that proves the first message was
    // *handled* is this one: the worker takes messages in the order they arrive.
    await postToWorker(page, handover("fresh", 5 * 60_000));

    const state = await askWorkerWhen(page, (s) => s.armed.some((a) => a.key === "fresh:due"), "today's alert");
    expect(state.day).toBe(dayKey(now));
    // Not merged, not kept under another day's label, and not allowed to rewrite the
    // worker's own idea of what day it is.
    expect(state.armed.map((a) => a.key)).toEqual(["fresh:due"]);
    expect(state.fired, "a discarded queue carried its do-not-repeat list into today").toEqual([]);
  });

  test("a cancel takes the alert out of the queue, timer and all", async ({ page }) => {
    await controlledPage(page);
    const alerts = planAlerts([dose("cancels", Date.now() + 5 * 60_000)], DEFAULT_SETTINGS, Date.now());
    await postToWorker(page, syncMessage(alerts, [], Date.now()));
    await askWorkerWhen(page, (s) => s.armed.length > 0, "the queue before the cancel");
    await postToWorker(page, cancelMessage(alerts.map((a) => a.key)));
    const after = await askWorkerWhen(page, (s: WorkerState) => s.armed.length === 0, "an empty queue after a cancel");
    expect(after.beyond).toBe(0);
    expect(after.fired, "a cancelled alert must not be recorded as announced").toEqual([]);
  });

  test("an alert past the horizon is counted, not quietly dropped", async ({ page }) => {
    // `TIMER_HORIZON_MS` is a platform limit the card quotes to a patient, so the
    // number has to come from the worker and not from arithmetic in the UI.
    await controlledPage(page);
    const message = handover("far-out", TIMER_HORIZON_MS + 5 * 60_000);
    // Split, not truncated: the law plans this dose's nudge 10 minutes before the
    // dose, so `upcoming` at +25 min gets a real timer while `due` at +35 min has
    // to wait for a wake. An earlier draft of this gate asserted every armed alert
    // is beyond the horizon, which the queue shape makes impossible — and which
    // would have passed a worker that counted nothing at all.
    const past = Date.now();
    const expectedBeyond = message.armed.filter((a) => a.at - past > TIMER_HORIZON_MS).length;
    expect(message.armed.length, "the law planned no alerts at all").toBeGreaterThan(0);
    expect(expectedBeyond, "this handover put nothing past the horizon, so it proves nothing").toBeGreaterThan(0);
    await postToWorker(page, message);
    const state = await askWorkerWhen(page, (s) => s.armed.length > 0, "the far-out queue");
    expect(state.horizonMs).toBe(TIMER_HORIZON_MS);
    expect(state.armed.length, "the worker stopped holding the alert instead of delaying it").toBe(
      message.armed.length
    );
    expect(state.beyond).toBe(expectedBeyond);
    expect(state.beyond, "the count covered the whole queue: something was dropped, not delayed").toBeLessThan(
      state.armed.length
    );
  });
});

// ---- 3. the links an icon and a notification open ----------------------------

test.describe("deep links and offline", () => {
  test("a launcher shortcut opens the panel it names, with no click", async ({ page }) => {
    const manifest = (await (await api.get("/manifest.webmanifest")).json()) as {
      shortcuts: { name: string; short_name: string; url: string }[];
    };
    expect(manifest.shortcuts.length).toBeGreaterThan(0);
    for (const shortcut of manifest.shortcuts) {
      const task = new URL(shortcut.url, BASE).searchParams.get("task");
      expect(task, `${shortcut.name} does not name a task`).toBeTruthy();
      await page.goto(shortcut.url);
      await expect(page.getByRole("heading", { name: "Vaidya workspace" })).toBeVisible();
      await expect(
        page.getByRole("navigation", { name: TAB_STRIP }).getByRole("button", { name: shortcut.short_name, exact: true })
      ).toHaveAttribute("aria-current", "page");
      // The address bar mirrors the tab, so what the launcher opened is reloadable.
      expect(new URL(page.url()).searchParams.get("task")).toBe(task);
    }
  });

  test("the URL a notification click opens is the panel the reminder is about", async ({ page }) => {
    // `public/sw.js` navigates to this string from a `notificationclick`, and the unit
    // tier pins the literal. What only a browser shows is that the literal is a route
    // a patient lands on with the right tab answering.
    await page.goto(TODAY_URL);
    await expect(
      page.getByRole("navigation", { name: TAB_STRIP }).getByRole("button", { name: "Today", exact: true })
    ).toHaveAttribute("aria-current", "page");
  });

  test("a task that is not a tab is no instruction at all", async ({ page }) => {
    // `insights` is a tab the strip answers, so the link is honoured; the second is a
    // stale bookmark or a mistyped link and must not land a patient in a panel that
    // answers nothing.
    await page.goto("/?task=insights");
    await expect(page.getByRole("heading", { name: "Vaidya workspace" })).toBeVisible();
    await page.goto("/?task=doctors-appointment");
    await expect(page.getByRole("heading", { name: "Vaidya workspace" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Launch the live product/i })).toBeVisible();
  });

  test("a deep link survives a reload", async ({ page }) => {
    await page.goto(TODAY_URL);
    await expect(page.getByText("After this tab closes")).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("navigation", { name: TAB_STRIP }).getByRole("button", { name: "Today", exact: true })
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("After this tab closes")).toBeVisible();
  });

  test("the shell opens offline, the data does not", async ({ page, context }) => {
    await controlledPage(page, TODAY_URL);
    // The install precaches the landing; this navigation caches the panel's own
    // document. Both are needed: one is the offline answer for a launcher tap, the
    // other is the offline answer for the screen the patient was actually on.
    await expect(page.getByRole("heading", { name: "Vaidya workspace" })).toBeVisible();

    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("navigation", { name: TAB_STRIP }).getByRole("button", { name: "Today", exact: true })
    ).toBeVisible();
    const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
    expect(controlled, "the offline document arrived with no worker to answer for it").toBeTruthy();

    // `/api/*` is never answered from a cache: a stale plan is a plan a patient
    // could act on.
    const status = await page.evaluate(async () => {
      try {
        const res = await fetch("/api/plans", { cache: "no-store" });
        return res.status;
      } catch {
        return "network-error";
      }
    });
    expect(status).toBe("network-error");

    // The landing is the other offline door — the one an installed icon opens.
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Launch the live product/i })).toBeVisible();
    await context.setOffline(false);
  });
});
