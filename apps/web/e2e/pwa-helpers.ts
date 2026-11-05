/**
 * Shared machinery for the two PWA browser files (`pwa.spec.ts`,
 * `pwa-delivery.spec.ts`).
 *
 * It is a module and not a copy because Playwright refuses `test.use({ headless })`
 * inside a `describe` — it forces a new worker — so the gates that need a real
 * notification message centre live in their own file, and both files need the same
 * handful of readers. Two copies of `askWorker` would be two definitions of "what
 * the worker said", which is the exact failure the rest of this tier is built to
 * catch.
 *
 * Two laws every function here obeys:
 *
 *  - **Every page callback is self-contained.** A `page.evaluate` body ships into
 *    the browser as *source text*, so a closure over a constant declared in this
 *    file dies with a `ReferenceError` no typecheck sees, and the document's nonce
 *    CSP rules out `eval` as a way around it. Values cross as arguments.
 *  - **A reader that cannot fail is not a reader.** `askWorker` rejects after 10 s
 *    rather than hanging, and `askWorkerWhen` polls on the fact being claimed,
 *    because the worker answers a bare `state` request immediately but replies to a
 *    `sync` only after an IndexedDB write — so one round trip can be answered before
 *    the handover a moment earlier has landed. Reading an empty queue at that moment
 *    and calling it a pass is the flake this prevents.
 */
import { test, expect, request, type APIRequestContext, type Page } from "@playwright/test";
import { PROTOCOL, SW_URL, stateFired, syncMessage } from "../src/lib/reminders-background";
import { DEFAULT_SETTINGS, planAlerts, type ReminderDose } from "../src/lib/safety/reminders";

export const BASE = "http://localhost:3457";

/** The row the two dose-driven gates are about, as `GET /api/plans` serves it. */
export type PlanDose = {
  id: string;
  medicationId: string;
  brand: string;
  doseMg: number;
  time: string;
  status: string;
  note?: string | null;
};

/** What the worker says back, as the page reads it. */
export type WorkerAlert = {
  key: string;
  at: number;
  title: string;
  options: { body?: string; tag?: string; data?: { key?: string; kind?: string; protocol?: string } };
};
export type WorkerState = {
  protocol: string;
  type: string;
  day: string;
  armed: WorkerAlert[];
  fired: string[];
  horizonMs: number;
  beyond: number;
};

/** Assigned by whichever spec is running. Playwright gives each file its own worker,
 *  so `connect` is called in that file's `beforeAll` and the returned context is
 *  this module's only route to the API: `nearDueDose` takes it as an argument rather
 *  than reading a module-level global, because a helper that quietly depends on
 *  somebody else's setup is a helper that works by accident. */
export async function connect(): Promise<APIRequestContext> {
  const context = await request.newContext({ baseURL: BASE });
  // The product seeds itself on a deep link; the gates depend on the same promise,
  // so they ask the same route rather than inventing a fixture the app never calls.
  const seeded = await context.post("/api/seed", { data: {} });
  expect(seeded.ok(), `POST /api/seed failed: ${await seeded.text()}`).toBeTruthy();
  return context;
}

/** Leave the server row the other journeys assume. `product.spec.ts` runs after
 *  these files in the same command and reads the stored settings, and the two
 *  dose-driven gates are the only place `leadMinutes` ever moves. */
export async function disconnect(api: APIRequestContext): Promise<void> {
  await api
    .post("/api/reminders", {
      data: { enabled: true, leadMinutes: 10, lateMinutes: 30, quiet: null, mutedMedications: [] },
    })
    .catch(() => undefined);
  await api.dispose();
}

/** Move the product's own early-nudge lead: the only lever a gate has over *when* an
 *  alert becomes due without inventing a dose time. A partial patch — the server
 *  merges it, so `lateMinutes` stays whatever the row already held. */
export async function setLead(api: APIRequestContext, leadMinutes: number): Promise<void> {
  const res = await api.post("/api/reminders", { data: { enabled: true, leadMinutes } });
  expect(res.ok(), `POST /api/reminders failed: ${await res.text()}`).toBeTruthy();
}

/**
 * Ask the live worker for its queue and wait for the reply.
 *
 * The reply is read from `navigator.serviceWorker`, which is where the worker's
 * `event.source.postMessage` lands — the same channel the product's own message
 * effect listens on, so this gate is not a second protocol. It is also why the
 * numbers the Today card prints are provable: the page and this reader hear the
 * same bytes.
 */
export async function askWorker(page: Page): Promise<WorkerState> {
  return page.evaluate(
    (protocol) =>
      new Promise<WorkerState>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("the worker never answered a state request")), 10_000);
        const on = (event: MessageEvent) => {
          const data = event.data as WorkerState | null;
          if (!data || data.protocol !== protocol || data.type !== "state") return;
          clearTimeout(timer);
          navigator.serviceWorker.removeEventListener("message", on);
          resolve(data);
        };
        navigator.serviceWorker.addEventListener("message", on);
        void navigator.serviceWorker.ready.then((reg) => {
          reg.active?.postMessage({ protocol, type: "state" });
        });
      }),
    PROTOCOL
  );
}

/** Ask the worker until its answer has the shape being claimed; see the header. */
export async function askWorkerWhen(
  page: Page,
  ready: (state: WorkerState) => boolean,
  what: string
): Promise<WorkerState> {
  await expect
    .poll(
      async () => {
        try {
          return ready(await askWorker(page));
        } catch {
          return false;
        }
      },
      { timeout: 20_000, message: `the worker never reported ${what}` }
    )
    .toBe(true);
  return askWorker(page);
}

/** Hand the worker a message exactly as the page would. */
export async function postToWorker(page: Page, message: unknown): Promise<void> {
  await page.evaluate(async (payload) => {
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage(payload);
  }, message);
}

/**
 * Register, then wait until *this* document is controlled by it.
 *
 * The default url is the landing on purpose: `useReminders` only mounts inside the
 * Today panel, so a landing document registers the worker without handing over a
 * plan of its own. Gates about *storage* need a queue nothing else will rewrite;
 * gates about the product's own handover navigate to `TODAY_URL` instead.
 */
export async function controlledPage(page: Page, url = "/"): Promise<void> {
  await page.goto(url);
  await page.evaluate(
    (swUrl) =>
      navigator.serviceWorker
        .register(swUrl, { scope: "/" })
        .then((reg) => reg.update())
        .then(() => navigator.serviceWorker.ready),
    SW_URL
  );
  await page.reload();
  await page
    .waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20_000 })
    .catch(() => undefined);
}

/**
 * Replace `window.Notification` with a recorder.
 *
 * The only honest way to assert "this page did not announce it": the platform list
 * is keyed by `tag`, so a duplicate *replaces* rather than appends and a count can
 * not see the second call. The recorder counts constructions and their tags, which
 * is what the delivery loop actually does.
 */
export async function recordPageAnnouncements(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: { title: string; body: string; tag: string }[] = [];
    const w = window as unknown as { __announced: typeof log };
    w.__announced = log;
    class RecordedNotification {
      static permission: NotificationPermission = "granted";
      static async requestPermission(): Promise<NotificationPermission> {
        return "granted";
      }
      constructor(title: string, options?: NotificationOptions) {
        log.push({ title, body: options?.body ?? "", tag: options?.tag ?? "" });
      }
    }
    Object.defineProperty(window, "Notification", { value: RecordedNotification, configurable: true });
  });
}

export const pageAnnouncementTags = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __announced: { title: string; tag: string }[] }).__announced.map((n) => n.tag)
  );

/** The notification platform's own list for this registration — worker-exclusive,
 *  which is what makes an entry there proof the *worker* put it there. */
export const platformNotifications = (page: Page) =>
  page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const list = await reg.getNotifications();
    return list.map((n) => ({ title: n.title, body: n.body ?? "", tag: n.tag ?? "" }));
  });

/** Read the card's one sentence about delivery after the tab closes. */
export const backgroundSentenceOn = (page: Page) =>
  page.locator("p.vy-eyebrow", { hasText: "After this tab closes" }).locator("+ p").innerText();

/**
 * The worker's answer and the sentence built from it, once both have stopped moving.
 *
 * The card quotes the counts from the last reply *the page* heard, and the page asks
 * again on every 15-second tick, so reading the two at different moments compares a
 * settled sentence against an unsettled number. This is the difference between a
 * gate and a flake, and the retry loop is what makes the claim about the pair.
 */
export async function settledDeliveryFacts(
  page: Page
): Promise<{ state: WorkerState; sentence: string; firedToday: ReturnType<typeof stateFired> }> {
  let last = "";
  for (let attempt = 0; attempt < 8; attempt++) {
    const state = await askWorker(page);
    const sentence = await backgroundSentenceOn(page);
    const pair = `${state.armed.length}|${state.beyond}|${state.fired.join(",")}|${sentence}`;
    if (pair === last) return { state, sentence, firedToday: stateFired(state) };
    last = pair;
    await new Promise((r) => setTimeout(r, 400));
  }
  const state = await askWorker(page);
  return { state, sentence: await backgroundSentenceOn(page), firedToday: stateFired(state) };
}

/** A dose the reminder law can be handed, in the shape `planAlerts` takes. */
export const dose = (doseId: string, scheduledAt: number): ReminderDose => ({
  doseId,
  medicationId: "gate-med",
  brand: "Telma 40",
  detail: "40 mg",
  scheduledAt,
  status: "pending",
});

export function settingsFor(leadMinutes: number) {
  return { ...DEFAULT_SETTINGS, enabled: true, leadMinutes, lateMinutes: 30, quiet: null, mutedMedications: [] };
}

/** Today's queue for one synthetic dose, built by the law rather than typed here. */
export function handover(doseId: string, millisOut: number) {
  const now = Date.now();
  return syncMessage(planAlerts([dose(doseId, now + millisOut)], DEFAULT_SETTINGS, now), [], now);
}

/**
 * The next pending dose that can be nudged inside this run, and the lead that does.
 *
 * `leadMinutes = floor((slot - now) / 60s) - 1` puts the nudge 60-120 s out: always
 * in the future (so the worker may hold a real timer for it), always inside
 * `TIMER_HORIZON_MS`, and always a whole number of minutes because the law only
 * accepts minutes. Nothing else in the product lets a caller choose a dose time —
 * `POST /api/plans` takes a prescription id and the slots come from the verified
 * schedule — which is why the lever is a setting and not a fixture.
 *
 * Null is the honest answer for 21:00-09:00: no pending dose of the seeded day is
 * ahead of the clock.
 */
export async function nearDueDose(
  api: APIRequestContext
): Promise<{ dose: ReminderDose; leadMinutes: number; millisToNudge: number } | null> {
  const res = await api.get("/api/plans");
  if (!res.ok()) throw new Error(`GET /api/plans failed: ${await res.text()}`);
  const payload = (await res.json()) as { data?: { doses?: PlanDose[] } };
  const now = Date.now();
  const first: ReminderDose | undefined = (payload.data?.doses ?? [])
    .filter((d) => d.status === "pending")
    .map((d) => ({
      doseId: d.id,
      medicationId: d.medicationId,
      brand: d.brand,
      detail: `${d.doseMg} mg${d.note ? ` · ${d.note}` : ""}`,
      scheduledAt: new Date(d.time).getTime(),
      status: "pending" as const,
    }))
    .filter((d) => d.scheduledAt - now >= 135_000 && d.scheduledAt - now <= 180 * 60_000)
    .sort((a, b) => a.scheduledAt - b.scheduledAt)[0];
  if (!first) return null;
  const leadMinutes = Math.max(1, Math.floor((first.scheduledAt - Date.now()) / 60_000) - 1);
  return {
    dose: first,
    leadMinutes,
    millisToNudge: first.scheduledAt - leadMinutes * 60_000 - Date.now(),
  };
}

/** The window the two dose-driven gates need, in the words the skip message uses. */
export const DOSE_WINDOW = "a seeded dose 2-180 minutes ahead of the real clock";

/** Why a run without a display is not a run of this tier. */
export const NO_DISPLAY =
  "no window server on this host: headed Chromium cannot open, and a headless browser has no notification platform to deliver to";

/**
 * Whether a **headed** Chromium can be opened here.
 *
 * The delivery file needs one for a reason that is not a preference: headless
 * Chromium reports `Notification.permission === "denied"` for this origin even when
 * the content setting says granted, so `showNotification` is never reached and every
 * gate in that file would assert that nothing was delivered. On Linux the same file
 * cannot even launch without an X server — Playwright's `--headed` path fails with
 * "Missing X server or $DISPLAY" — and CI gets one from `xvfb-run` (see
 * `.github/workflows/ci.yml`).
 *
 * The predicate takes its inputs so the unit tier can pin the law: a condition that
 * is wrong in one direction skips five gates forever while reading like a green
 * suite, and `test.skip` at file scope runs before any fixture, which is the only
 * place a guard can act *before* Playwright tries to launch.
 *
 * Linux is the only platform that is asked: macOS and Windows have a window server
 * for a GUI process whether or not anything is on screen, and on Linux `DISPLAY` —
 * not `WAYLAND_DISPLAY`, because Playwright launches X11 Chromium by default — is the
 * difference between a launch and an error string.
 */
export function displayAvailable(
  platform = process.platform,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (platform !== "linux") return true;
  return Boolean(env.DISPLAY);
}

/**
 * Skip a dose-driven gate, out loud.
 *
 * `test.skip(true, …)` is the only honest move here: the alternative is a test that
 * silently passes at 22:00 because nothing was armed, which is a gate that reports
 * success on a feature it never looked at. The warn goes to the reporter's output
 * and the reason names what to do about it, so the skip is actionable rather than
 * a footnote. The always-run worker gates in `pwa.spec.ts` cover the mechanism;
 * these two cover the product's own plan through the same worker.
 */
export function skipWithoutNearDose(what: string): void {
  console.warn(`SKIPPING ${what}: no pending dose is 2-180 min out — needs ${DOSE_WINDOW}. See docs/TESTING.md.`);
  test.skip(true, `no pending dose inside the reachable window (needs ${DOSE_WINDOW})`);
}
