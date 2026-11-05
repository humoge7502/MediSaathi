/*
 * Vaidya service worker — background delivery of dose reminders (TD-27).
 *
 * This file is plain JavaScript on purpose: it is the script the browser
 * registers, so it cannot import the TypeScript modules the product tier is
 * built from. That is the one place this design could fork the reminder law, and
 * the way it is prevented is that the worker decides *nothing*:
 *
 *   - the title, body and `tag` of every notification arrive from the page,
 *     already built by `toScheduled()` in `src/lib/reminders-background.ts`;
 *   - the worker only holds timers for what is still in the future, refuses what
 *     the page says it already announced, and persists the queue so a wake can
 *     re-arm it;
 *   - the message vocabulary and the horizon are duplicated here as literals
 *     *and pinned by `tests/pwa.test.ts`*, which reads this file as text and
 *     compares every constant against the module the app compiles from. A rename
 *     on one side fails the suite instead of silently disconnecting delivery.
 *
 * Two things this worker does not pretend to do:
 *
 *   1. It has no push channel. There is no VAPID key in this repository and no
 *      server that could send one, so an alert reaches a device that has never
 *      opened the app since the plan started only when something wakes the worker
 *      — a periodic sync where the browser grants it (Chromium: installed PWAs),
 *      a navigation, or the next page tick. The card in the Today panel says this
 *      in the patient's words rather than leaving it to be discovered.
 *   2. It does not serve a stale document online. Document routes are rendered
 *      per request and carry a CSP nonce minted for that response
 *      (`src/proxy.ts`, TD-2), so a cached HTML body replayed against a fresh
 *      header would have nonces that no longer match and would execute no script.
 *      Navigations are therefore network-first, and the cache answers only when
 *      the network is actually gone.
 */

/* --- constants mirrored from src/lib/reminders-background.ts (pinned by test) --- */
const PROTOCOL = "vaidya-reminders-v1";
const TIMER_HORIZON_MS = 30 * 60_000;
const PERIODIC_TAG = "vaidya-reminders";
const SHELL_CACHE = "vaidya-shell-v1";
const ASSET_CACHE = "vaidya-assets-v1";
const SHELL_URLS = ["/", "/icons/icon.svg"];

/* --- the queue ------------------------------------------------------------- */
/* One day's worth of state. A queue from yesterday is discarded rather than
 * compared: dose ids are per plan and a stale key would suppress a real alert,
 * which is the failure mode the delivered-set exists to avoid. */
let state = { day: "", armed: new Map(), fired: new Set() };
const timers = new Map();

const DB_NAME = "vaidya-reminders";
const STORE = "queue";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persist() {
  try {
    const db = await openDb();
    const payload = {
      day: state.day,
      armed: [...state.armed.values()],
      fired: [...state.fired],
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(payload, "queue");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* no storage: delivery still works for as long as this instance lives */
  }
}

async function restore() {
  try {
    const db = await openDb();
    const loaded = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const get = tx.objectStore(STORE).get("queue");
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    db.close();
    if (!loaded || typeof loaded !== "object") return;
    if (loaded.day !== state.day) {
      // A restore from another day is an empty restore — see the note above.
      state = { day: state.day, armed: new Map(), fired: new Set() };
      return;
    }
    if (!state.armed.size && Array.isArray(loaded.armed)) {
      state.armed = new Map(loaded.armed.map((a) => [a.key, a]));
    }
    if (Array.isArray(loaded.fired)) {
      for (const key of loaded.fired) state.fired.add(key);
    }
  } catch {
    /* first run, or a browser that refuses storage */
  }
}

/* --- timers ---------------------------------------------------------------- */

function clearTimer(key) {
  const t = timers.get(key);
  if (t !== undefined) {
    clearTimeout(t);
    timers.delete(key);
  }
}

function arm(alert, now) {
  clearTimer(alert.key);
  const wait = alert.at - now;
  if (!Number.isFinite(wait) || wait <= 0) return false;
  // Past the horizon the worker would be promising a timer it cannot keep: the
  // browser kills idle workers long before most dose times. Those alerts wait for
  // the next wake, and `state()` reports how many are waiting that way.
  if (wait > TIMER_HORIZON_MS) return false;
  timers.set(
    alert.key,
    setTimeout(() => announce(alert.key), wait)
  );
  return true;
}

function rearmAll() {
  const now = Date.now();
  let beyond = 0;
  for (const alert of state.armed.values()) {
    if (state.fired.has(alert.key)) {
      state.armed.delete(alert.key);
      clearTimer(alert.key);
      continue;
    }
    if (!arm(alert, now)) beyond += 1;
  }
  return beyond;
}

async function announce(key) {
  const alert = state.armed.get(key);
  timers.delete(key);
  if (!alert || state.fired.has(key)) return;
  state.fired.add(key);
  state.armed.delete(key);
  try {
    await self.registration.showNotification(alert.title, alert.options);
  } catch {
    /* a browser that denies the call still records the key: an alert it will not
       show must not become a retry loop */
  }
  await persist();
  // Tell every open client what left this worker, so the panel can say
  // "already announced" for an alert the page itself never fired.
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) {
    try {
      client.postMessage({ protocol: PROTOCOL, type: "announced", key });
    } catch {
      /* a client on its last legs needs no handling */
    }
  }
}

function stateMessage() {
  const now = Date.now();
  let beyond = 0;
  for (const alert of state.armed.values()) {
    if (!state.fired.has(alert.key) && alert.at - now > TIMER_HORIZON_MS) beyond += 1;
  }
  return {
    protocol: PROTOCOL,
    type: "state",
    day: state.day,
    armed: [...state.armed.values()],
    fired: [...state.fired],
    horizonMs: TIMER_HORIZON_MS,
    beyond,
  };
}

/* --- lifecycle -------------------------------------------------------------- */

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // A shell that cannot be cached must not abort the install: the app is
      // usable online, and offline coverage is whatever succeeded.
      await Promise.allSettled(SHELL_URLS.map((url) => cache.add(new Request(url, { cache: "reload" }))));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await clients.claim();
      state.day = localDay(Date.now());
      await restore();
      rearmAll();
      const keys = (await caches.keys()).filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE);
      await Promise.all(keys.map((k) => caches.delete(k)));
    })()
  );
});

/* Local-day key, shaped exactly like `dayKey()` in the module above. */
function localDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.protocol !== PROTOCOL || typeof data.type !== "string") return;
  const reply = event.source && event.source.postMessage
    ? event.source.postMessage.bind(event.source)
    : () => {};

  if (data.type === "sync") {
    event.waitUntil(
      (async () => {
        if (data.day !== localDay(Date.now())) {
          // A message whose day this worker does not live in says nothing about
          // today's queue — and least of all about its do-not-repeat list, where a
          // carried-over key silences a real alert today. The page stamps every
          // handover with its own live clock, so a rejected day is a frozen or
          // replayed message, never a schedule this patient is actually on; nothing
          // is armed, nothing is cleared, and the reply is the queue this worker
          // really holds. The worker's day changes when *it* wakes (activate,
          // periodicsync), not because a document said so.
          reply(stateMessage());
          return;
        }
        for (const key of data.fired || []) state.fired.add(key);
        const seen = new Set((data.armed || []).map((a) => a.key));
        for (const alert of data.armed || []) {
          if (state.fired.has(alert.key)) continue;
          state.armed.set(alert.key, alert);
        }
        // Anything the page dropped from its plan leaves the queue too, with its
        // timer: a dose resolved in another tab must not announce from this one.
        for (const key of [...state.armed.keys()]) {
          if (!seen.has(key)) {
            state.armed.delete(key);
            clearTimer(key);
          }
        }
        const beyond = rearmAll();
        await persist();
        reply({ protocol: PROTOCOL, type: "state", day: state.day, armed: [...state.armed.values()], fired: [...state.fired], horizonMs: TIMER_HORIZON_MS, beyond });
      })()
    );
    return;
  }

  if (data.type === "cancel") {
    event.waitUntil(
      (async () => {
        for (const key of data.keys || []) {
          state.armed.delete(key);
          clearTimer(key);
        }
        await persist();
        reply(stateMessage());
      })()
    );
    return;
  }

  if (data.type === "state") {
    event.waitUntil((async () => reply(stateMessage()))());
    return;
  }
});

/* A periodic wake is the only route to an alert while every tab is shut, and it
 * is granted only where the app is installed. So: try, and say nothing when the
 * browser declines — the page tick is the fallback the UI describes. */
self.addEventListener("periodicsync", (event) => {
  if (event.tag !== PERIODIC_TAG) return;
  event.waitUntil(
    (async () => {
      state.day = localDay(Date.now());
      await restore();
      rearmAll();
    })()
  );
});

/* A click on a reminder opens the panel the reminder is about.
 *
 * `/?task=today` is mirrored from `TODAY_URL` in
 * `src/lib/reminders-background.ts`, and `tests/pwa.test.ts` fails if the two
 * ever disagree — the same law as every other literal in this file. Routing on
 * `data.kind` instead was the first draft and it was wrong in a way a patient
 * feels: the late re-nudge's own body says "Open Today", and sending someone who
 * is thirty minutes late for a dose to the prescription verifier is the classic
 * reminder-app betrayal of opening the app on the wrong screen. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = "/?task=today";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});

/* --- fetch: immutable assets cache-first, documents network-first ---------- */

/* Open this event's lifetime for a cache write that has not happened yet.
 *
 * A fire-and-forget `caches.open(…).then(c => c.put(…))` is dropped: the browser
 * may retire the worker the instant it has handed the document over, and a
 * dropped write is a screen that never becomes reachable offline while reading as
 * perfectly fine online — measured against `/?task=today`, where a real
 * navigation left the shell holding only its two precached entries, so the
 * offline reload answered with `/` and opened the landing page instead of the
 * doses the patient was looking at.
 *
 * `waitUntil` is the cure but accepts a promise only while the event is still
 * dispatching, so the promise that stands for the write is opened *here* and
 * settled by the write later. `store` keeps the page from waiting for a disk
 * write (it returns the response first); `done` closes the event on a path where
 * there is nothing to store, because a promise nobody settles holds this worker
 * open for no reason.
 */
function deferredWrite(event) {
  let finishWrite;
  event.waitUntil(new Promise((done) => { finishWrite = done; }));
  return {
    store(cacheName, req, res) {
      // Cloned synchronously: once the page starts reading `res` its body is
      // locked, and a clone attempted after that throws.
      const copy = res && res.ok ? res.clone() : null;
      if (!copy) {
        finishWrite();
        return;
      }
      caches
        .open(cacheName)
        .then((cache) => cache.put(req, copy))
        // A cache this browser refuses is a miss, not a failed navigation.
        .then(finishWrite, finishWrite);
    },
    done() {
      finishWrite();
    }
  };
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // data is never served from a cache

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    const write = deferredWrite(event);
    const answered = caches.open(ASSET_CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) {
        write.done();
        return hit;
      }
      const res = await fetch(req);
      write.store(ASSET_CACHE, req, res);
      return res;
    });
    // A rejected read still reaches the page as a failed fetch; this handler only
    // makes sure that failure cannot leave the event unsettled.
    answered.then(undefined, () => write.done());
    event.respondWith(answered);
    return;
  }

  if (req.mode === "navigate") {
    const write = deferredWrite(event);
    event.respondWith(
      fetch(req)
        .then((res) => {
          write.store(SHELL_CACHE, req, res);
          return res;
        })
        .catch(async () => {
          write.done();
          // The precached landing is the fallback for a screen this visit has not
          // yet written: an installed icon tapped for the first time offline. It is
          // an answer, not a match — the address bar moves — which is exactly why
          // the store above is what makes the patient's *own* screen come back
          // under its own URL.
          const hit = await caches.match(req) || (await caches.match("/"));
          return hit || Response.error();
        })
    );
  }
});
