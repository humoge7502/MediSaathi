/**
 * PWA gate, part 2 (TD-27 slice 1) — the patient is told, once.
 *
 * This file is the half of the PWA tier that cannot run headless, and it is a
 * separate file because Playwright refuses `test.use({ headless })` inside a
 * `describe` (it forces a new worker). The served bytes, the worker's queue and the
 * deep links are in `pwa.spec.ts`; the machinery both files share is in
 * `pwa-helpers.ts`.
 *
 * Headed is not a preference here. Measured on this build:
 *
 *  - headless Chromium reports `Notification.permission === "denied"` for this origin
 *    even after `context.grantPermissions(["notifications"])`, which makes
 *    `permissions.query({name:"notifications"})` answer "granted". A denied origin
 *    never reaches `showNotification`, so a headless run of these gates would assert
 *    that a notification was *not* shown — a gate that can only pass on a browser
 *    that has no message centre.
 *  - `ServiceWorkerRegistration.getNotifications()` does **not** list notifications a
 *    page constructed with `new Notification()`. It is a worker-exclusive observation
 *    channel, which is what makes an entry there proof of *who* announced — and it is
 *    why the page's side of the pair needs the recorder in
 *    `recordPageAnnouncements`, not a count of platform notifications.
 *  - a worker's own `setTimeout` does fire with every tab closed, and the
 *    notification it shows is still in `getNotifications()` when a page comes back.
 *
 * A headed browser needs a window server, which a CI runner does not have by default:
 * on Linux `ubuntu-latest` a headed Chromium fails to launch with "Missing X server or
 * $DISPLAY". The `web-e2e` job therefore runs under `xvfb-run`, and this file skips
 * *out loud* (`displayAvailable`) rather than crashing when there is no display, so a
 * machine that cannot open a window reports what it did not measure.
 *
 * The two dose-driven gates also care what time it is. A service worker keeps real
 * timers and `page.clock` does not reach into one — the page tier of
 * `product.spec.ts` uses the fake clock precisely because nothing there has to
 * survive a closed tab — so the near-due lever is a product setting: `leadMinutes`
 * chosen from the next pending dose's real slot, which puts the nudge 60-120 s out
 * and inside the worker's 30-minute horizon. Outside the window where a seeded dose
 * is 2-180 min ahead, those two gates skip **out loud** (`skipWithoutNearDose`) with
 * the reason naming what to do about it. They never pass silently, and the always-run
 * worker gates in `pwa.spec.ts` keep covering the mechanism itself.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { TODAY_URL, backgroundSentence, dayKey, stateFired, syncMessage, toScheduled } from "../src/lib/reminders-background";
import { planAlerts, type Alert } from "../src/lib/safety/reminders";
import {
  BASE,
  askWorkerWhen,
  connect,
  controlledPage,
  disconnect,
  displayAvailable,
  handover,
  nearDueDose,
  NO_DISPLAY,
  pageAnnouncementTags,
  platformNotifications,
  postToWorker,
  recordPageAnnouncements,
  settledDeliveryFacts,
  setLead,
  settingsFor,
  skipWithoutNearDose,
} from "./pwa-helpers";

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await connect();
});

test.afterAll(async () => {
  await disconnect(api);
});

// Headed, and only headed: see the header note. `grantPermissions` is per origin and
// has to happen before the document asks, so it is a `beforeEach` on this file.
test.use({ headless: false });

// A file-scope skip is the only place a guard can act *before* Playwright launches a
// browser: a `beforeEach` that touches `context` already instantiated one, and on a
// Linux host with no window server the run would die with "Missing X server or
// $DISPLAY" instead of reporting five skips. CI gives the job an X server (`xvfb-run`,
// see `.github/workflows/ci.yml`) precisely so this line never fires there.
test.skip(!displayAvailable(), NO_DISPLAY);

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["notifications"], { origin: BASE });
});

test("the browser lets this origin notify, which is what the delivery gates rest on", async ({ page }) => {
  // Not a delivery gate — the precondition gate. Every claim below is only about
  // delivery if the platform said yes to notifications first, and a run that silently
  // had no permission would report "no notification appeared" as a pass. This is the
  // measurement that would otherwise be a comment, made a test.
  await page.goto("/");
  const permission = await page.evaluate(() => Notification.permission);
  expect(permission, "headed Chromium still refused notifications for this origin").toBe("granted");
});

test("the worker announces an armed alert while no tab is open", async ({ page }) => {
  // Lawful payload, spec-driven handover: `toScheduled()` builds the title, body and
  // tag, so what lands on the platform is the wording `planAlerts` chose for a dose
  // 90 s out — not a fixture this file invented.
  test.setTimeout(120_000);
  await controlledPage(page);
  const now = Date.now();
  const alert: Alert = {
    key: "silent:dose:upcoming",
    doseId: "silent:dose",
    kind: "upcoming",
    at: now + 8_000,
    title: "Telma 40 in 1 min",
    body: "40 mg — take it soon.",
  };
  const [scheduled] = toScheduled([alert], now);
  if (!scheduled) throw new Error("the law's own alert was not future-only");
  await postToWorker(page, syncMessage([alert], [], now));
  const armed = await askWorkerWhen(page, (s) => s.armed.length > 0, "the 8-second alert");
  expect(armed.armed.map((a) => a.key)).toEqual([alert.key]);
  expect(armed.armed[0].title).toBe(scheduled.title);
  expect(armed.armed[0].options.tag).toBe(scheduled.options.tag);
  // The tag is the key on both paths — that is what makes the browser's own dedupe
  // do the work instead of a race between two announcers.
  expect(armed.armed[0].options.tag).toBe(armed.armed[0].key);

  await page.close();
  // Every tab is gone. The timer is the worker's own, and the announcement below is
  // the proof that no document was involved in making it.
  await new Promise((r) => setTimeout(r, 12_000));

  const reopened = await page.context().newPage();
  await controlledPage(reopened);
  const notes = await platformNotifications(reopened);
  expect(
    notes,
    "no notification on the platform: the worker did not reach showNotification with every tab closed"
  ).toContainEqual({ title: scheduled.title, body: scheduled.options.body ?? "", tag: alert.key });
  const fired = await askWorkerWhen(reopened, (s) => s.fired.includes(alert.key), `the announced key ${alert.key}`);
  expect(fired.armed.map((a) => a.key)).not.toContain(alert.key);
  await reopened.close();
});

test("what the worker was handed is what the page's own law produced", async ({ page }) => {
  // The anti-fork claim, measured on the real path: the product's plan → the
  // product's handover → the worker's queue, compared byte for byte against the same
  // two modules imported here. `tests/pwa.test.ts` can only compare the modules with
  // themselves; this is the round trip through a browser, with the product's own hook
  // as the sender.
  test.setTimeout(90_000);
  const target = await nearDueDose(api);
  if (!target) {
    skipWithoutNearDose("the dose-driven handover gate");
    return;
  }
  await setLead(api, target.leadMinutes);

  await controlledPage(page, TODAY_URL);
  const state = await askWorkerWhen(page, (s) => s.armed.length > 0, "the page's own handover");
  const expected = toScheduled(planAlerts([target.dose], settingsFor(target.leadMinutes), Date.now()), Date.now());
  expect(expected.length, "the law planned no alert for the dose this gate is about").toBeGreaterThan(0);
  const mine = state.armed.filter((a) => a.key.startsWith(`${target.dose.doseId}:`));
  expect(mine.map((a) => a.key).sort()).toEqual(expected.map((a) => a.key).sort());
  for (const want of expected) {
    const got = mine.find((a) => a.key === want.key);
    expect(got, `the worker was never handed ${want.key}`).toBeTruthy();
    // Byte-identical, because a second implementation of the wording is the failure
    // this whole module exists to prevent.
    expect(got?.title).toBe(want.title);
    expect(got?.options.body).toBe(want.options.body);
    expect(got?.at).toBe(want.at);
    expect(got?.options.tag).toBe(got?.key);
  }

  // The card's sentence is built from the worker's reply, so the numbers it prints
  // are the numbers the worker sent — and nothing else about delivery.
  const facts = await settledDeliveryFacts(page);
  const legal = (["unknown", "unsupported", "off", "on"] as const).map((wake) =>
    backgroundSentence({
      link: "linked",
      armed: facts.state.armed.length,
      beyond: facts.state.beyond,
      periodicSync: wake,
    })
  );
  expect(legal, `the card says "${facts.sentence}", which is not a sentence the platform facts produce`).toContain(
    facts.sentence
  );
  expect(facts.sentence).toContain(`${facts.state.armed.length} alert`);
  if (facts.state.beyond > 0) expect(facts.sentence).toContain(`${facts.state.beyond} further out`);
});

test("a reminder the worker announced is not announced again on reopen", async ({ page, context }) => {
  // The bug this gate exists for. The delivered set is the reminder law's only dedupe
  // point, and it could not see what the worker fired while no document existed: the
  // dose announced at 21:00 with the tab closed was re-planned on the next open, and
  // `due` stays live for the whole late window — so the same "Time for Telma 40" came
  // back on every reload for half an hour. The page now holds its firing until the
  // worker has answered once, and merges what the worker fired into the same set.
  test.setTimeout(240_000);
  const target = await nearDueDose(api);
  if (!target) {
    skipWithoutNearDose("the double-announce gate");
    return;
  }
  await setLead(api, target.leadMinutes);

  // Hand the plan over with the real product panel running, then close the tab, so
  // the only announcer left is the worker.
  await controlledPage(page, TODAY_URL);
  const nudgeKey = `${target.dose.doseId}:upcoming`;
  await askWorkerWhen(page, (s) => s.armed.some((a) => a.key === nudgeKey), `the nudge ${nudgeKey}`);
  await page.close();
  // Past the nudge's moment, and inside the law's 60 s grace: the reopen happens
  // while the alert is still live, which is exactly when the duplicate used to fire.
  await new Promise((r) => setTimeout(r, target.millisToNudge + 4_000));

  const reopened = await context.newPage();
  await recordPageAnnouncements(reopened);
  await controlledPage(reopened, TODAY_URL);
  // `stateFired` is the reader the page uses, run here against bytes that came out of
  // a real worker through `postMessage` rather than an object literal typed by a test
  // — the only way to know the unit tier's fixtures look like the wire.
  const state = await askWorkerWhen(
    reopened,
    (s) => s.fired.includes(nudgeKey),
    `the announced key ${nudgeKey}`
  );
  const firedToday = stateFired(state);
  expect(firedToday, "the page's own reader rejects a real worker's reply").toBeTruthy();
  expect(firedToday?.day).toBe(dayKey(Date.now()));
  expect(firedToday?.keys).toContain(nudgeKey);

  // The page has now heard that answer, so its hold is over and it may fire — which is
  // what makes "it did not fire" a measured result rather than an untested pause.
  expect(await pageAnnouncementTags(reopened), "the page re-announced a reminder the worker already fired").not.toContain(
    nudgeKey
  );
  // …and the patient's own record of it is on the panel, not in a test's ledger.
  await expect(reopened.getByText(/[1-9][0-9]* announced in this browser today/)).toBeVisible();

  // The dose itself is still coming, and must still be armed after the reopen.
  expect(state.armed.map((a) => a.key)).toContain(`${target.dose.doseId}:due`);
  await reopened.close();
});

test("a dose resolved in another tab stops announcing here", async ({ page, context }) => {
  // The other half of the handover: `syncMessage` sends the whole live plan, and the
  // worker drops keys the page no longer names. Without it a dose marked taken in one
  // window would still be announced from the background of another — the post-*Taken*
  // notification, which is the failure the reminder law exists to prevent.
  test.setTimeout(90_000);
  await controlledPage(page);
  const first = handover("two-tabs", 5 * 60_000);
  await postToWorker(page, first);
  await askWorkerWhen(page, (s) => s.armed.length > 0, "the queue from the first window");

  // A second document, planning the same dose but announcing it as already delivered.
  const second = await context.newPage();
  await controlledPage(second);
  await postToWorker(second, { ...first, fired: ["two-tabs:due"], armed: [] });
  const state = await askWorkerWhen(second, (s) => s.armed.length === 0, "an empty queue after a resolved dose");
  expect(state.fired).toContain("two-tabs:due");

  // …and the first window's worker timer is gone too, because it is one worker.
  const back = await askWorkerWhen(page, (s) => s.armed.length === 0, "the same answer in the first window");
  expect(back.fired).toContain("two-tabs:due");
  await second.close();
});
