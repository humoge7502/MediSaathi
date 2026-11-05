"use client";

/**
 * The delivery side of the reminder law.
 *
 * `src/lib/safety/reminders.ts` decides *what should be announced and when*; this
 * hook is the only place that touches `Notification`, and it holds exactly four
 * responsibilities on top of that decision:
 *  - a clock that advances on its own, because a reminder computed once at page
 *    load is a screenshot of a schedule rather than a reminder;
 *  - the set of alerts already announced today, kept in `localStorage` so a
 *    reload cannot re-arm a notification the patient already saw (and so a
 *    yesterday's log cannot suppress today's doses);
 *  - the permission handshake, which browsers only allow from a click, so
 *    nothing here asks until the patient presses *Turn reminders on*;
 *  - the handover to the service worker (`public/sw.js`), which is what keeps a
 *    dose announced after this tab is closed.
 *
 * There is still no push channel: nothing here can wake a device that has never
 * opened the app, and no message, SMS or notification leaves the machine on a
 * server's say-so. What the worker adds is *continuation* — the same
 * `Notification` API, driven by a queue this module built and this module keeps
 * deduped, held by a script that outlives the page. The worker is the first
 * announcer for what it was handed — the page holds its own firing until the worker
 * has answered once, because a reminder fired at 21:00 with the tab closed must not
 * pop again the moment the app is reopened. The page is the backstop for everything
 * past the worker's timer horizon and for every browser that refused to run one, and
 * both use `tag: alert.key`, so the browser's own dedupe means a patient who is
 * unlucky enough to have both alive at one moment sees one notification, not two.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { post } from "@/lib/client";
import {
  BACKGROUND_IDLE,
  PERIODIC_TAG,
  SW_URL,
  announcedKey,
  cancelMessage,
  dayKey,
  stateCounts,
  stateFired,
  syncMessage,
  type BackgroundState,
  type CancelMessage,
  type PeriodicWake,
  type SyncMessage,
} from "@/lib/reminders-background";
import {
  DEFAULT_SETTINGS,
  DELIVERY_GRACE_MS,
  describeGap,
  nextDue,
  planAlerts,
  type Alert,
  type ReminderDose,
  type ReminderSettings,
} from "@/lib/safety/reminders";

/** How often the schedule is re-evaluated. Derived from the law's delivery
 *  grace, so the two cannot drift apart: four ticks inside a grace window means
 *  an alert can never be stepped over. */
const TICK_MS = DELIVERY_GRACE_MS / 4;

/** How long the page waits for the worker's first answer before announcing on its
 *  own. A fraction of the delivery grace, so a worker that never replies costs a
 *  few seconds of lateness rather than the reminder — and so the wait is a bounded
 *  pause, not a dependency on a script the browser may have just killed. */
const WORKER_ANSWER_MS = 5_000;

const STORE_KEY = "vy.reminders.delivered.v1";

export type PermissionState = NotificationPermission | "unsupported";

// The background vocabulary lives in the contract module, not here: the worker
// mirror, the sentence builder and this hook all read the same four facts, and a
// second copy of `PeriodicWake` is how one of them ends up describing a state the
// others never produce.
export type { BackgroundLink, BackgroundState, PeriodicWake } from "@/lib/reminders-background";

export interface RemindersView {
  /** settings as the server holds them (defaults before the first save) */
  settings: ReminderSettings;
  loaded: boolean;
  saving: boolean;
  error: string | null;
  permission: PermissionState;
  /** every alert the law currently plans, past and future, in time order */
  schedule: Alert[];
  /** keys announced in this browser today */
  delivered: string[];
  next: ReminderDose | null;
  nextLabel: string;
  now: number;
  /** what will still be announced after this tab is closed, in the patient's numbers */
  background: BackgroundState;
  enable: () => Promise<PermissionState>;
  save: (patch: Partial<ReminderSettings>) => Promise<void>;
}

/** The shape Chromium exposes as `registration.periodicSync`, written out because
 *  it is not in the DOM types this project compiles against. Every use is behind
 *  a presence check, so a browser without it takes the `unsupported` branch. */
type PeriodicSyncManager = {
  register: (tag: string, options?: { minInterval?: number }) => Promise<void>;
  unregister: (tag: string) => Promise<void>;
  getTags: () => Promise<string[]>;
  readonly state?: "activated" | "disabled" | "denied";
  readonly minInterval?: number;
};

type RegistrationWithWake = ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager };

/** Post to whichever worker of this registration can take the message. `active`
 *  is the ordinary answer; on a first load or an update the queue goes to the
 *  worker that is still installing, and the browser holds it until that worker
 *  can run — which is why handing over a schedule does not mean waiting for a
 *  page to become controlled by a script it has not seen yet. */
function postToWorker(
  reg: ServiceWorkerRegistration | null,
  message: SyncMessage | CancelMessage
): boolean {
  const target = reg?.active ?? reg?.waiting ?? reg?.installing;
  if (!target) return false;
  try {
    target.postMessage(message);
    return true;
  } catch {
    return false;
  }
}

/** Ask for the one wake that can fire an alert while every tab is shut. It is a
 *  request, not a claim: Chromium answers `NotAllowedError` until the app is
 *  installed and the browser judges it engaged, so the caller records the answer
 *  and the card says what it means instead of hiding it. */
async function requestPeriodicWake(
  reg: RegistrationWithWake,
  report: (wake: PeriodicWake) => void
): Promise<void> {
  const manager = reg.periodicSync;
  if (!manager) {
    report("unsupported");
    return;
  }
  try {
    // The floor the browser itself publishes: asking for less is a throw, and
    // asking for more buys a schedule the patient does not need.
    await manager.register(PERIODIC_TAG, { minInterval: manager.minInterval ?? 3_600_000 });
    report(manager.state === "activated" ? "on" : "off");
  } catch {
    report("off");
  }
}

/** Yesterday's delivered set must not silence today's doses, so the log carries
 *  the day it belongs to and is discarded when that day has passed. A log that
 *  cannot be parsed is an empty log: the failure mode it is protecting against
 *  (a corrupt entry suppressing every alert) is worse than one duplicate nudge. */
function readDelivered(): string[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { day?: unknown; keys?: unknown };
    if (parsed.day === dayKey(Date.now()) && Array.isArray(parsed.keys)) {
      return parsed.keys.filter((k): k is string => typeof k === "string");
    }
  } catch {
    /* fall through to empty */
  }
  return [];
}

function writeDelivered(day: string, keys: string[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ day, keys }));
  } catch {
    /* private mode / quota: dedupe then lives for this page only */
  }
}

function permissionNow(): PermissionState {
  if (typeof window === "undefined" || typeof window.Notification === "undefined") return "unsupported";
  return window.Notification.permission;
}

export function useReminders(doses: ReminderDose[], refreshKey: number): RemindersView {
  const [settings, setSettings] = useState<ReminderSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionState>("unsupported");
  const [delivered, setDelivered] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [background, setBackground] = useState<BackgroundState>(BACKGROUND_IDLE);
  // Bumped when a worker exists to talk to and when a different one has taken
  // over. It is state rather than a ref because the handover effect has to *run*
  // on those two events, not merely be allowed to.
  const [workerEpoch, setWorkerEpoch] = useState(0);
  // Whether the page holds every dedupe fact it is going to get. `false` means only
  // one thing: a worker exists and has not answered yet, so an alert the worker may
  // already have announced with this tab closed is not yet in `fired`. Both failure
  // paths (no worker API, registration refused) and the `WORKER_ANSWER_MS` deadline
  // move it, because a silent worker must not cost the patient their reminder.
  const [workerHasAnswered, setWorkerHasAnswered] = useState(false);

  // Two copies of the same fact, deliberately: `delivered` is state, so the panel
  // can render "already announced"; `fired` is a ref touched only inside effects,
  // so the firing loop has a synchronous guard that cannot lag a render behind.
  // (Reading a ref during render is the bug this split exists to avoid: React does
  // not re-render when a ref changes, so a schedule computed from one can be stale
  // forever.)
  const fired = useRef<Set<string>>(new Set());
  const seeded = useRef(false);

  // The worker's hand, in three refs for three different reasons. `regRef` is the
  // only route to a `postMessage`; `queueSig` is what stops a 15-second clock from
  // re-posting an unchanged queue (each post wakes the worker, and a queue that
  // wakes its own timer every tick is a battery drain, not a feature);
  // `armedKeys` is what a switch to *off* cancels, so muting reminders in one tab
  // cannot leave a dose armed in the background of another.
  const regRef = useRef<ServiceWorkerRegistration | null>(null);
  const queueSig = useRef("");
  const armedKeys = useRef<Set<string>>(new Set());
  const wakeAsked = useRef(false);

  // Everything the browser owns — the delivered log in `localStorage` and the
  // notification permission — is read from a timer callback, never synchronously
  // in the effect body. Two reasons: the render law React now lints against
  // (`set-state-in-effect`), and the fact that neither value exists during a
  // server render, so reading them at render time is a hydration mismatch.
  useEffect(() => {
    const sync = () => {
      if (!seeded.current) {
        seeded.current = true;
        // Merged, not replaced: if a storage write ever fails (private mode), the
        // in-memory set is still what stops a double announcement.
        for (const key of readDelivered()) fired.current.add(key);
        setDelivered([...fired.current]);
      }
      setPermission(permissionNow());
      setNow(Date.now());
    };
    const first = window.setTimeout(sync, 0);
    const t = window.setInterval(sync, TICK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, []);

  // --- background delivery (TD-27) -------------------------------------------
  // Registered once per page load, never per tick: `register` is a network and
  // storage operation, and the one thing its rejection tells the patient — "this
  // tab closing means nothing fires" — is not worth re-asking every 15 seconds.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      // From a timer, like every other client fact in this hook: a browser with no
      // worker has no background announcements to wait for, and the page must learn
      // that without the effect body setting state during a server render.
      const release = window.setTimeout(() => setWorkerHasAnswered(true), 0);
      return () => window.clearTimeout(release);
    }
    let alive = true;
    // Asked from a timer, exactly like the delivered log and the permission above:
    // whether *this browser* has a worker is a client fact, so answering it
    // synchronously in the effect body would report "unsupported" for a server
    // render — and the sentence the card builds from it is patient-facing, not
    // debug output.
    const ask = () => {
      navigator.serviceWorker
        .register(SW_URL, { scope: "/" })
        .then((reg) => {
          if (!alive) return;
          regRef.current = reg;
          setBackground((b) => ({ ...b, link: "linked" }));
          // Nothing has been handed over yet — there was no worker to hand it to —
          // so the effect that owns the handover gets one more run.
          setWorkerEpoch((e) => e + 1);
        })
        .catch(() => {
          if (!alive) return;
          setBackground((b) => ({ ...b, link: "unreachable" }));
          // A worker this browser will not run has no queue to have announced from.
          setWorkerHasAnswered(true);
        });
    };
    const first = window.setTimeout(ask, 0);

    // The bound on waiting for that first answer. Registration and one round trip
    // are milliseconds on a warm origin, so this only ever fires for a worker that
    // is installing, dead, or wedged — and the patient's alert goes out a few
    // seconds late rather than never.
    const deadline = window.setTimeout(() => {
      if (alive) setWorkerHasAnswered(true);
    }, WORKER_ANSWER_MS);

    // A new build taking over is a new worker whose in-memory queue is empty. It
    // restores what this origin persisted, but a page that is holding the live
    // plan must hand it over rather than let an update quietly cost the patient
    // the rest of today's doses — hence dropping the signature *and* running the
    // effect, because a ref alone would leave the queue unsent until a tick.
    const onControllerChange = () => {
      queueSig.current = "";
      setWorkerEpoch((e) => e + 1);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearTimeout(deadline);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  // What the worker says arrives on `navigator.serviceWorker`, and exactly two
  // kinds are acted on — an alert it announced, and its view of the queue. Every
  // reader (`announcedKey`, `stateCounts`, `stateFired`) is the module's, not local
  // shape checks, because a message this build does not recognise must not be able
  // to add an entry to the delivered set: an entry there silences a real alert.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const nav = navigator.serviceWorker;
    const onMessage = (event: MessageEvent) => {
      const key = announcedKey(event.data);
      if (key !== null) {
        // The same bookkeeping the page-side loop does, because it is the same
        // fact: this alert has been announced today, in this browser.
        fired.current.add(key);
        writeDelivered(dayKey(Date.now()), [...fired.current]);
        setDelivered([...fired.current]);
        return;
      }
      const counts = stateCounts(event.data);
      if (!counts) return;
      // The worker announced these with this tab closed, so they belong in the
      // delivered set the same way an `announced` message does. Day-guarded: a queue
      // the worker kept from yesterday must not silence today's doses.
      const firedToday = stateFired(event.data);
      if (firedToday && firedToday.day === dayKey(Date.now()) && firedToday.keys.length > 0) {
        let merged = false;
        for (const key of firedToday.keys) {
          if (!fired.current.has(key)) {
            fired.current.add(key);
            merged = true;
          }
        }
        if (merged) {
          writeDelivered(firedToday.day, [...fired.current]);
          setDelivered([...fired.current]);
        }
      }
      // Whatever it says, the worker has now said it: the page has every
      // announcement record this browser holds.
      setWorkerHasAnswered(true);
      setBackground((b) => ({ ...b, link: "linked", armed: counts.armed, beyond: counts.beyond }));
      if (wakeAsked.current) return;
      // A state reply means an active worker, which is the precondition the
      // periodic-sync request needs; asking earlier only earns a throw.
      wakeAsked.current = true;
      const reg = regRef.current as RegistrationWithWake | null;
      if (reg) {
        void requestPeriodicWake(reg, (wake) =>
          setBackground((b) => ({ ...b, periodicSync: wake }))
        );
      }
    };
    nav.addEventListener("message", onMessage);
    return () => nav.removeEventListener("message", onMessage);
  }, []);

  // Settings are a server truth: another device, or a second tab, edits the same
  // row. Stale-response cancellation, same law as the other panels.
  const loadSeq = useRef(0);
  useEffect(() => {
    const seq = ++loadSeq.current;
    fetch("/api/reminders", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ ok: boolean; data?: { settings: ReminderSettings } }>)
      .then((json) => {
        if (seq !== loadSeq.current) return;
        if (json.ok && json.data) setSettings(json.data.settings);
        setLoaded(true);
      })
      .catch(() => {
        if (seq === loadSeq.current) setLoaded(true);
      });
  }, [refreshKey]);

  const deliveredSet = useMemo(() => new Set(delivered), [delivered]);

  const schedule = useMemo(
    () => planAlerts(doses, settings, now, deliveredSet),
    // `now` is the whole point: the plan is a function of the clock.
    [doses, settings, now, deliveredSet]
  );

  // Delivery is on exactly when the patient asked for it *and* the browser will
  // let it happen. Both the handover below and the numbers the card prints use
  // this one answer, so a queue cannot be armed while the card says reminders are
  // off.
  const live = settings.enabled && permission === "granted";

  // Fire everything whose moment has arrived. Alerts the law planned but whose
  // time is still ahead stay in `schedule` for the panel to list.
  useEffect(() => {
    if (permission !== "granted") return;
    // Held until the worker has answered once. An alert whose moment passed with
    // every tab closed is already announced — by the worker, into a queue this page
    // cannot see — and `due` stays live for the whole late window, so without this
    // the same "Time for Telma 40" pops again on the first tick of every reopen.
    // Bounded by `WORKER_ANSWER_MS`, so a worker that never speaks cannot silence
    // the reminder it failed to hold.
    if (!workerHasAnswered) return;
    const due = schedule.filter((a) => a.at <= now && !fired.current.has(a.key));
    if (due.length === 0) return;
    const day = dayKey(now);
    for (const alert of due) {
      fired.current.add(alert.key);
      try {
        // `tag` is the browser's own dedupe key, so two tabs of the same patient
        // cannot stack two copies of one dose's alert.
        new window.Notification(alert.title, { body: alert.body, tag: alert.key });
      } catch {
        /* a browser that refuses to construct one still records the key: an
           alert it will not show must not become an infinite retry loop */
      }
    }
    writeDelivered(day, [...fired.current]);
    setDelivered([...fired.current]);
  }, [schedule, permission, now, workerHasAnswered]);

  // Hand the worker the plan — and only while the plan is real. An alert armed in
  // the background while reminders are off, or while the browser has not been
  // allowed to notify, is a notification the patient did not ask for, so *off*
  // sends a cancel for exactly the keys this page handed over rather than leaving
  // the worker to work it out. The queue goes across whole (`syncMessage` carries
  // the delivered set as the do-not-repeat list) and only when its shape changes:
  // a clock that ticks every 15 seconds must not wake a worker that has nothing
  // new to be told.
  useEffect(() => {
    const reg = regRef.current;
    if (!live) {
      const keys = [...armedKeys.current];
      armedKeys.current = new Set();
      if (keys.length > 0) postToWorker(reg, cancelMessage(keys));
      return;
    }
    const message = syncMessage(schedule, delivered, now);
    const sig = `${message.day}|${message.armed.map((a) => `${a.key}@${a.at}`).join(",")}|${message.fired.join(",")}`;
    if (sig === queueSig.current) return;
    // No worker to talk to yet is not a lost handover: `workerEpoch` moves when the
    // registration lands, and this effect runs again with the same queue.
    if (!postToWorker(reg, message)) return;
    queueSig.current = sig;
    armedKeys.current = new Set(message.armed.map((a) => a.key));
  }, [schedule, delivered, live, now, workerEpoch]);

  const enable = useCallback(async (): Promise<PermissionState> => {
    if (typeof window.Notification === "undefined") {
      setPermission("unsupported");
      return "unsupported";
    }
    const result = await window.Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  const save = useCallback(async (patch: Partial<ReminderSettings>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await post<{ settings: ReminderSettings }>("/api/reminders", patch);
      // The response, not the request: a value the server narrowed has to render
      // narrowed, or the control silently lies about what is in force.
      setSettings(res.settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save reminder settings");
    } finally {
      setSaving(false);
    }
  }, []);

  const next = useMemo(() => nextDue(doses, now), [doses, now]);
  const nextLabel = next ? describeGap(next.scheduledAt, now) : "";

  return {
    settings,
    loaded,
    saving,
    error,
    permission,
    schedule,
    delivered,
    next,
    nextLabel,
    now,
    // Reminders off is reminders off. The card must not print a worker's counts
    // for a queue this page has just cancelled, and zeroing them here — derived,
    // in render — is what makes that true for every branch that turns delivery
    // off, not only the one the cancel effect happens to know about.
    background: live ? background : { ...background, armed: 0, beyond: 0 },
    enable,
    save,
  };
}

/** A dose row as the reminder law wants it, from the payload the panel already has. */
const DOSE_STATUSES = new Set(["pending", "taken", "skipped", "missed"]);

export function toReminderDose(d: {
  id: string;
  medicationId: string;
  brand: string;
  doseMg: number;
  time: string;
  status: string;
  note?: string | null;
}): ReminderDose {
  return {
    doseId: d.id,
    medicationId: d.medicationId,
    brand: d.brand,
    detail: `${d.doseMg} mg${d.note ? ` · ${d.note}` : ""}`,
    scheduledAt: new Date(d.time).getTime(),
    // An unrecognised status is treated as pending — the one value that can only
    // ever *add* a reminder, never silence one.
    status: DOSE_STATUSES.has(d.status) ? (d.status as ReminderDose["status"]) : "pending",
  };
}
