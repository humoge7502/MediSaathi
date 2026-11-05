/**
 * The page ↔ service-worker contract for background delivery (TD-27).
 *
 * Two laws live here, and they are the reason the worker can exist without the
 * reminder law forking:
 *
 *  1. **The worker is a timer, not a decision-maker.** It receives the exact
 *     objects `planAlerts()` produced — title, body, `tag` — and its only inputs
 *     are "what is still in the future" and "what has already been announced".
 *     `toScheduled()` is the *only* place a notification payload is built, so a
 *     second copy of the wording or the dedupe key cannot appear in a file the
 *     unit tier never imports. `tests/pwa.test.ts` asserts that the keys the
 *     worker is handed are the keys `planAlerts` returned, which is what makes
 *     "same module behind both paths" a checked claim instead of a comment.
 *
 *  2. **Nothing is armed past the worker's own life.** A service worker is killed
 *     whenever the browser wants, so a `setTimeout` for an alert eight hours out
 *     is a promise nobody keeps. Only alerts inside `TIMER_HORIZON_MS` get a
 *     timer; the rest wait for the next wake — a page tick, a periodic sync, or a
 *     navigation. The horizon is a real limit and the UI says what it means,
 *     rather than the worker silently dropping the schedule.
 *
 * The `protocol` tag is on every message in both directions: a worker left by an
 * older build answers messages on the page's own origin, and without a tag a
 * version mismatch is a silent misinterpretation of `fired` as `alerts` or
 * whatever shape the other side used.
 */
import type { Alert } from "@/lib/safety/reminders";

export const SW_URL = "/sw.js";
export const PROTOCOL = "vaidya-reminders-v1";

/** How far ahead the worker may hold a real timer. The number is a platform
 *  limit, not a scheduling one: a browser kills an idle worker well before most
 *  dose times, so a longer horizon would be a promise nothing keeps. Alerts
 *  beyond it are not dropped — they wait for the next wake (a page tick, a
 *  periodic sync, a navigation) — and `state()` counts them so the UI can say so
 *  instead of leaving the patient to discover the difference. */
export const TIMER_HORIZON_MS = 30 * 60_000;

/** The periodic-sync tag the worker answers, and the only wake that can fire an
 *  alert while every tab is shut. Chromium grants it to an installed web app that
 *  the browser judges engaged, so it is requested, never assumed. */
export const PERIODIC_TAG = "vaidya-reminders";

/** A payload the worker can hand straight to `showNotification`. */
export type ScheduledAlert = {
  key: string;
  at: number;
  title: string;
  options: NotificationOptions & { tag: string };
};

export type SyncMessage = {
  protocol: typeof PROTOCOL;
  type: "sync";
  /** the local day these alerts belong to; a yesterday's queue is discarded */
  day: string;
  /** the page's clock at send time, so the worker does not trust its own skew */
  now: number;
  armed: ScheduledAlert[];
  /** keys the page already announced — the worker must not repeat them */
  fired: string[];
};

export type CancelMessage = {
  protocol: typeof PROTOCOL;
  type: "cancel";
  keys: string[];
};

export type StateRequest = { protocol: typeof PROTOCOL; type: "state" };
export type StateReply = {
  protocol: typeof PROTOCOL;
  type: "state";
  day: string;
  armed: ScheduledAlert[];
  fired: string[];
  horizonMs: number;
  /** alerts the law planned that are real but past the horizon: scheduled by
   *  the next wake, not by a timer this worker holds */
  beyond: number;
};

/** The local-day key a queue belongs to. The worker mirrors this exact shape, and
 *  `tests/pwa.test.ts` pins the two together: a queue the page calls today and the
 *  worker calls differently is a queue that is discarded — or kept — at random. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Where a notification opens the app, and where a launcher shortcut does.
 *
 * Both are promises made in files the unit tier cannot import — `public/sw.js` and
 * the manifest route — and a promise about a route is only true if the page reads
 * the parameter (`src/app/page.tsx`) and the name is one the tab strip answers
 * (`src/components/workspace.tsx`). So the strings live here, are used from here,
 * and the worker's copy of them is compared against this one by test.
 */
export const TODAY_URL = "/?task=today";
export const VERIFY_URL = "/?task=verify";

/**
 * `planAlerts` output → what the worker may arm. Future-only (an alert whose
 * moment has passed is either announced or suppressed by the delivered set, never
 * replayed), ordered by `at`, and stripped to the fields `showNotification`
 * actually reads. `tag` is set to the alert key on both paths, which is the
 * browser's own dedupe: if the page and the worker are both alive at the moment
 * an alert is due, the second one replaces the first instead of stacking.
 */
export function toScheduled(alerts: Alert[], now: number): ScheduledAlert[] {
  return alerts
    .filter((a) => Number.isFinite(a.at) && a.at > now)
    .slice()
    .sort((a, b) => a.at - b.at)
    .map((a) => ({
      key: a.key,
      at: a.at,
      title: a.title,
      options: {
        body: a.body,
        tag: a.key,
        // Carried, not branched on: every reminder opens Today (see
        // `TODAY_URL`), so `kind` is here for a click handler that wants to
        // describe the alert, never to decide where the patient goes.
        data: { key: a.key, kind: a.kind, protocol: PROTOCOL },
      },
    }));
}

export function syncMessage(
  alerts: Alert[],
  delivered: Iterable<string>,
  now: number
): SyncMessage {
  const fired = [...new Set(delivered)];
  return {
    protocol: PROTOCOL,
    type: "sync",
    day: dayKey(now),
    now,
    armed: toScheduled(alerts, now).filter((a) => !fired.includes(a.key)),
    fired,
  };
}

export function cancelMessage(keys: Iterable<string>): CancelMessage {
  return { protocol: PROTOCOL, type: "cancel", keys: [...new Set(keys)] };
}

export const stateRequest = (): StateRequest => ({ protocol: PROTOCOL, type: "state" });

/** What the worker posts back when it announces something the page never fired. */
export type AnnouncedMessage = {
  protocol: typeof PROTOCOL;
  type: "announced";
  key: string;
};

/**
 * The only shape the page accepts *from* the worker: this build's protocol tag,
 * the `announced` type, and a non-empty string key. Anything else returns null —
 * a worker left by an older build, a message relayed from another frame, or a key
 * that is not a string must not be able to add an entry to the delivered set,
 * because an entry there silences a real alert.
 */
export function announcedKey(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Partial<AnnouncedMessage>;
  if (msg.protocol !== PROTOCOL || msg.type !== "announced") return null;
  return typeof msg.key === "string" && msg.key.length > 0 ? msg.key : null;
}

/** True when a message is one this build understands. Everything else is
 *  dropped: a worker of another version, or a script on the origin of another
 *  page, must not be able to make the queue do something unintended. */
export function isOurs(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { protocol?: unknown }).protocol === PROTOCOL
  );
}

/** Whether the page→worker handover exists. `unreachable` is not a guess: it is
 *  the promise from `register()` rejecting, which is what a CSP that refuses the
 *  script, an insecure context, or a user-agent policy looks like from the inside. */
export type BackgroundLink = "idle" | "unsupported" | "unreachable" | "linked";

/** What the browser answered when asked for a scheduled wake. `unknown` is the
 *  state before the worker has spoken, and it is a value rather than a default
 *  because the alternative is a sentence about a wake nobody has been offered.
 *  Chromium grants `on` to an installed web app it judges engaged, so `off` is
 *  the ordinary answer for a browser tab. */
export type PeriodicWake = "unknown" | "unsupported" | "off" | "on";

export type BackgroundState = {
  link: BackgroundLink;
  /** alerts the worker confirmed it holds a timer for */
  armed: number;
  /** alerts the law plans past the worker's timer horizon */
  beyond: number;
  periodicSync: PeriodicWake;
};

export const BACKGROUND_IDLE: BackgroundState = {
  link: "idle",
  armed: 0,
  beyond: 0,
  periodicSync: "unknown",
};

/**
 * The one sentence the Today card says about delivery after this tab closes.
 *
 * `public/sw.js` promises that the timer horizon is announced "in the patient's
 * words rather than left to be discovered", and a sentence written inline in a
 * component is a sentence no test can read. So the wording is composed here, from
 * the four facts, and `tests/pwa.test.ts` walks every combination of them: what
 * may be claimed is a function of what the platform answered, and the failure it
 * guards against is a guardian that implies more than it does.
 */
export function backgroundSentence(state: BackgroundState): string {
  if (state.link === "unsupported") {
    return "This browser cannot keep a reminder after the tab closes, so nothing is announced unless the app is open.";
  }
  if (state.link === "unreachable") {
    return "This browser refused the background scheduler, so a reminder only fires while this tab is open.";
  }
  if (state.link === "idle") {
    return "The background scheduler has not answered yet. Until it does, assume a reminder fires only while this tab is open.";
  }

  const queue =
    state.armed > 0
      ? `${state.armed} alert${state.armed === 1 ? "" : "s"} can fire with this tab closed`
      : "No alert is armed to fire with this tab closed yet";
  // Not "will be announced later": the honest version of a horizon is that the
  // browser, not the app, decides whether a wake ever comes for them.
  const wait =
    state.beyond > 0
      ? `; ${state.beyond} further out ${state.beyond === 1 ? "waits" : "wait"} for a wake this browser does not promise`
      : "";
  const wake =
    state.periodicSync === "on"
      ? ". The app also wakes on a schedule, so a dose is announced even with no tab open"
      : state.periodicSync === "off"
        ? ". Install the app — add it to the Home Screen or your desktop — and this browser will wake it on a schedule; until then an alert waits for the app to be opened"
        : state.periodicSync === "unsupported"
          ? ". This browser has no scheduled wake, so an alert whose moment passes with every tab closed is announced the next time the app is opened"
          : ". Until this browser has answered whether it can wake the app on a schedule, an alert may still wait for the app to be opened";
  return `${queue}${wait}${wake}.`;
}

/**
 * The two numbers the page renders from a worker reply, or null when the message
 * is not this build's state reply.
 *
 * The counts are read out of *checked arrays* rather than `data.armed.length`:
 * a string has a `length` too, and the sentence the UI builds from it
 * ("3 armed in the background") would be a number the browser never sent.
 */
export function stateCounts(data: unknown): { armed: number; beyond: number } | null {
  if (!isOurs(data)) return null;
  const msg = data as Partial<StateReply>;
  if (msg.type !== "state") return null;
  const armed = Array.isArray(msg.armed) ? msg.armed.length : 0;
  const beyond =
    typeof msg.beyond === "number" && Number.isFinite(msg.beyond) && msg.beyond > 0 ? msg.beyond : 0;
  return { armed, beyond };
}

/**
 * The keys the worker announced today, or null when the message is not this
 * build's state reply.
 *
 * This exists because the worker is a second announcer in the same browser, and
 * the delivered set — the one dedupe point the reminder law has — cannot see what
 * the worker fired while no document existed. Without it, a dose announced at
 * 21:00 with the tab closed is re-planned on the next open (`due` stays live for
 * the whole late window, half an hour by default) and the same "Time for Telma 40"
 * pops again on every reload until it expires. The worker's `fired` set is the only
 * record that it already spoke, so the page reads it from here rather than
 * inventing its own shape check.
 *
 * `day` is returned, not compared: the caller owns the clock, and a queue the
 * worker kept from yesterday must not silence today's doses. Non-string entries are
 * dropped rather than trusted — an entry in the delivered set suppresses a real
 * alert, so a malformed reply can cost a reminder but can never fake one.
 */
export function stateFired(data: unknown): { day: string; keys: string[] } | null {
  if (!isOurs(data)) return null;
  const msg = data as Partial<StateReply>;
  if (msg.type !== "state") return null;
  if (typeof msg.day !== "string" || msg.day.length === 0) return null;
  const keys = Array.isArray(msg.fired)
    ? msg.fired.filter((k): k is string => typeof k === "string" && k.length > 0)
    : [];
  return { day: msg.day, keys };
}
