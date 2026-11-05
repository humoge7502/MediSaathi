/**
 * The installable surface (bun test) — TD-27 slice 1.
 *
 * A service worker is the one part of this app written in a language the product
 * tier does not compile: `public/sw.js` is plain JavaScript the browser fetches
 * and runs on its own, and the manifest is read by an operating system before a
 * document exists. Both can be *described* in TypeScript and *implemented*
 * somewhere else, and no type checker would notice the difference. So this file
 * reads the other side as text and asserts the two agree:
 *
 *   1. **The reminder law does not fork.** Every payload the worker can show is
 *      built by `toScheduled()` from `planAlerts()` output, and the keys handed
 *      over are the keys the law returned, with `tag` set to the same string. A
 *      second copy of the wording or a second dedupe key is the defect that makes
 *      a guardian announce one dose twice.
 *   2. **The worker's literals are this build's literals.** The protocol tag, the
 *      timer horizon, the periodic-sync tag, the day-key shape, the message
 *      vocabulary and the click URL exist as JS constants in `sw.js`; each is
 *      compared against the module the app compiles from, so a rename on one side
 *      fails here instead of silently disconnecting delivery.
 *   3. **What the page believes about the worker is bounded by what the worker
 *      said.** `announcedKey` and `stateCounts` answer null for anything that is
 *      not this build's message, because an entry in the delivered set silences a
 *      real alert and a number the card prints is a promise to a patient.
 *   4. **The sentence about delivery cannot overclaim.** `backgroundSentence` is
 *      walked over every combination of its inputs and the claim it makes is
 *      checked against the facts that produced it.
 *   5. **The manifest and the icon are the design system, not a remembered
 *      picture.** Colours come from `THEME_CHROME` and from the tokens in
 *      `globals.css` converted with the same palette maths the contrast report
 *      uses, and the maskable claim is *measured* from the SVG's own geometry —
 *      which is how this file found the first version of the icon was 8 px outside
 *      the safe zone it claimed to sit in.
 *   6. **The headed tier's own skip has a boundary.** `displayAvailable` decides
 *      whether the five delivery gates run or report themselves as unmeasurable, and a
 *      predicate wrong in one direction hides a tier behind a green suite — so the
 *      pure function is pinned here, beside the constants the worker mirrors.
 *
 * What this tier cannot see is on purpose elsewhere: it never runs a worker, so
 * `e2e/pwa.spec.ts` owns registration, the handover and the offline shell, and
 * `e2e/pwa-delivery.spec.ts` owns the announcement itself.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import manifest from "@/app/manifest";
import {
  BACKGROUND_IDLE,
  PERIODIC_TAG,
  PROTOCOL,
  SW_URL,
  TIMER_HORIZON_MS,
  TODAY_URL,
  VERIFY_URL,
  announcedKey,
  backgroundSentence,
  cancelMessage,
  dayKey,
  isOurs,
  stateCounts,
  stateFired,
  syncMessage,
  toScheduled,
  type BackgroundLink,
  type BackgroundState,
  type PeriodicWake,
} from "@/lib/reminders-background";
import { hexFromLch, rgbFromLch, type Lch } from "../scripts/palette";
import { THEME_CHROME } from "@/lib/theme";
import {
  DEFAULT_SETTINGS,
  DELIVERY_GRACE_MS,
  planAlerts,
  type ReminderDose,
} from "@/lib/safety/reminders";
import { NO_DISPLAY, displayAvailable } from "../e2e/pwa-helpers";

// ---- reading the other sides as the source of truth ------------------------

const at = (rel: string) => resolve(import.meta.dir, "..", rel);
const sw = readFileSync(at("public/sw.js"), "utf8");
const contract = readFileSync(at("src/lib/reminders-background.ts"), "utf8");
const css = readFileSync(at("src/app/globals.css"), "utf8");
const icon = readFileSync(at("public/icons/icon.svg"), "utf8");
const workspaceSrc = readFileSync(at("src/components/workspace.tsx"), "utf8");
const pageSrc = readFileSync(at("src/app/page.tsx"), "utf8");
const proxySrc = readFileSync(at("src/proxy.ts"), "utf8");
const configSrc = readFileSync(at("next.config.ts"), "utf8");
const hookSrc = readFileSync(at("src/lib/use-reminders.ts"), "utf8");
const deliverySpec = readFileSync(at("e2e/pwa-delivery.spec.ts"), "utf8");

/**
 * `const NAME = <literal>;` in the worker, as text.
 *
 * Throws rather than returning undefined: a renamed or deleted constant is
 * precisely the drift this file exists to catch, and `undefined` compares equal
 * to nothing in a way that reads like a passing test.
 */
function swConst(name: string): string {
  const m = new RegExp(`^const ${name} = (.*);$`, "m").exec(sw);
  if (!m) throw new Error(`public/sw.js no longer declares \`const ${name} = …;\``);
  return m[1].trim();
}

/** The worker's value for a numeric constant, computed from its text instead of
 *  evaluated: only integer literals joined by `*` and `+` are allowed, which is
 *  every shape these constants take and nothing that could run code. */
function swNumber(name: string): number {
  const expr = swConst(name);
  if (!/^[\d\s_*+]+$/.test(expr)) {
    throw new Error(`public/sw.js \`${name}\` is not a plain arithmetic literal: ${expr}`);
  }
  return expr
    .split("+")
    .map((term) =>
      term
        .split("*")
        .map((f) => f.trim().replace(/_/g, ""))
        .reduce((acc, f) => {
          const n = Number(f);
          if (!Number.isFinite(n)) throw new Error(`bad factor in ${name}: ${f}`);
          return acc * n;
        }, 1)
    )
    .reduce((a, b) => a + b, 0);
}

/** The `oklch()` triple a `:root` token declares, as a real number triple.
 *
 * The slice runs from `:root {` to the first line that closes it, not to
 * `indexOf(".dark")`: the comment block above the light palette names `.dark`
 * four times before the selector does, so a `.dark`-terminated slice is empty
 * and every lookup in it fails — which reads as "the token does not exist". */
function tokenTriple(name: string): Lch {
  const start = css.indexOf(":root {");
  if (start < 0) throw new Error("globals.css has no `:root {` block");
  const root = css.slice(start, css.indexOf("\n}", start));
  const m = new RegExp(`${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`).exec(root);
  if (!m) throw new Error(`globals.css :root does not declare \`${name}: oklch(…)\``);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const hexChannel = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
const lchString = (x: Lch) => `oklch(${x[0]} ${x[1]} ${x[2]})`;

// ---- 2. the worker mirrors the contract, not a memory of it ----------------

describe("the worker mirrors the contract", () => {
  test("protocol, periodic tag and timer horizon are the same values", () => {
    expect(JSON.parse(swConst("PROTOCOL"))).toBe(PROTOCOL);
    expect(JSON.parse(swConst("PERIODIC_TAG"))).toBe(PERIODIC_TAG);
    expect(swNumber("TIMER_HORIZON_MS")).toBe(TIMER_HORIZON_MS);
  });

  test("the URL the page registers is a file that ships", () => {
    expect(SW_URL).toBe("/sw.js");
    expect(existsSync(at(`public${SW_URL}`))).toBe(true);
    // The manifest and the shell cache name the same install icon, and a cached
    // URL that 404s is an install that looks fine and offline that does not.
    expect(sw).toContain(`"/icons/icon.svg"`);
    expect(existsSync(at("public/icons/icon.svg"))).toBe(true);
  });

  test("every message type the module can send is one the worker answers", () => {
    const sent = [...contract.matchAll(/type: "(sync|cancel|state|announced)"/g)].map((m) => m[1]);
    expect([...new Set(sent)].sort()).toEqual(["announced", "cancel", "state", "sync"]);
    for (const type of ["sync", "cancel", "state"]) {
      expect(sw).toContain(`data.type === "${type}"`);
    }
    // …and the one thing it says back is in the module's vocabulary too.
    expect(sw).toContain(`type: "announced"`);
  });

  test("every state reply carries what the page has to know", () => {
    // `stateMessage()` and the `sync` reply are two constructions of one shape, and
    // the page now reads `fired` out of it to learn what the worker announced with
    // this tab closed. A reply that drops `day` or `fired` is a merge that silently
    // stops happening — which reads as a reminder firing twice on every reopen.
    const replies = [...sw.matchAll(/type: "state"/g)];
    expect(replies.length).toBeGreaterThanOrEqual(2);
    for (const found of replies) {
      const chunk = sw.slice(found.index, found.index + 260);
      expect(chunk, `a \`type: "state"\` reply does not carry the day: ${chunk}`).toContain("day: state.day");
      expect(chunk, `a \`type: "state"\` reply does not carry what it fired: ${chunk}`).toContain(
        "fired: [...state.fired]"
      );
    }
  });

  test("a message from another build is dropped, not guessed at", () => {
    // The worker checks its own tag before it reads a `type`, so a stale worker
    // cannot interpret today's shapes.
    const guard = sw.indexOf('data.protocol !== PROTOCOL');
    const typeRead = sw.indexOf('typeof data.type');
    expect(guard).toBeGreaterThan(-1);
    expect(typeRead).toBeGreaterThan(guard);
  });

  test("the day key the worker compares is the shape the page writes", () => {
    // Line-for-line: a queue stored under one shape and read under another is a
    // queue discarded every day, which reads as "reminders stopped working".
    const SERIAL = "`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`";
    expect(contract).toContain(SERIAL);
    expect(sw).toContain(SERIAL);
    expect(dayKey(new Date(2026, 9, 28, 13, 5).getTime())).toBe("2026-10-28");
  });

  test("a sync from a day the worker does not live in changes nothing", () => {
    // The first draft reset the queue *and* adopted the message's own day — `state =
    // { day: data.day, … }` one line above `for (const key of data.fired)`, which
    // then re-added that day's do-not-repeat list. Dose ids survive their day (the
    // seeded plan keeps its rows), so yesterday's `d:due` in that set silences today's
    // alert for the same medicine at the same hour, and nothing in the UI explains why
    // reminders stopped. `e2e/pwa.spec.ts` runs a real worker through this message;
    // this gate keeps the fast tier from accepting a refactor back to the poison.
    const guard = sw.indexOf("if (data.day !== localDay(Date.now()))");
    expect(guard).toBeGreaterThan(-1);
    // Bounded slices, because a whole-file `not.toContain` prints the entire worker
    // into the failure output and tells the reader nothing they can act on.
    const branch = sw.slice(guard, guard + 900);
    expect(branch, "the day-mismatch branch adopts the message's own day").not.toContain("day: data.day");
    const beforeReturn = sw.slice(guard, sw.indexOf("return;", guard));
    expect(beforeReturn).toContain("reply(stateMessage())");
    expect(beforeReturn).not.toContain("state =");
    expect(beforeReturn).not.toContain("state.fired");
    expect(beforeReturn).not.toContain("state.armed");
    // The worker's own clock is the only writer of its calendar: a page cannot move it.
    const writers = [...sw.matchAll(/state\.day = /g)];
    expect(writers.length).toBeGreaterThanOrEqual(2);
    for (const found of writers) {
      expect(sw.slice(found.index, found.index + 40)).toContain("localDay(Date.now())");
    }
  });

  test("the worker holds no timer past its own life, and says so", () => {
    expect(sw).toContain(`if (wait > TIMER_HORIZON_MS) return false;`);
    // …but the page still sends those alerts, because `beyond` is a number the
    // card prints rather than a queue silently truncated at the client.
    const now = Date.now();
    const doses = [dose("d-far", "Telma 40", now + 6 * 3_600_000)];
    const armed = syncMessage(planAlerts(doses, DEFAULT_SETTINGS, now), [], now).armed;
    expect(armed.map((a) => a.key)).toContain("d-far:due");
  });

  test("a service worker has no localStorage, and this one does not pretend", () => {
    // The queue survives a kill through IndexedDB; `localStorage` is undefined in
    // a worker and a reference to it is a TypeError on the first wake.
    expect(sw).not.toContain("localStorage");
    expect(sw).toContain("indexedDB.open");
  });

  test("a runtime cache write is held open by the event that started it", () => {
    // Measured before it was written down: `caches.open(SHELL_CACHE).then(c =>
    // c.put(req, res.clone()))` left outside `waitUntil` is dropped when the
    // browser retires the worker after handing over the document, so the screen
    // the patient is on never enters the shell and an offline reload answers with
    // the precached `/` — the landing page, at a different URL, instead of today's
    // doses. The behavioural proof is `e2e/pwa.spec.ts`; this keeps the fast tier
    // from accepting a refactor back to the unawaited write.
    const puts = [...sw.matchAll(/cache\.put\(/g)];
    expect(puts.length, "a second writer means a second chance to drop it").toBe(1);
    const helperStart = sw.indexOf("function deferredWrite(event)");
    const helper = sw.slice(helperStart, sw.indexOf('self.addEventListener("fetch"'));
    expect(helperStart).toBeGreaterThan(-1);
    // Created and handed over during dispatch, which is the only moment it is legal.
    expect(helper).toContain("event.waitUntil(new Promise(");
    expect(helper).toContain(".then(finishWrite, finishWrite)");
    const handler = sw.slice(sw.indexOf('self.addEventListener("fetch"'));
    expect(handler).toContain("write.store(SHELL_CACHE, req, res)");
    expect(handler).toContain("write.store(ASSET_CACHE, req, res)");
    // Every path that stores nothing must still close the event: an unsettled
    // promise holds this worker open for no reason at all.
    expect(handler.match(/write\.done\(\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  test("a reminder click opens the panel the reminder is about", () => {
    expect(TODAY_URL).toBe("/?task=today");
    expect(sw).toContain(`const url = "${TODAY_URL}"`);
    // Routing on `kind` would send a late dose to the prescription verifier.
    expect(sw).not.toContain("payload.kind");
  });
});

// ---- 1. the law does not fork ---------------------------------------------

function dose(doseId: string, brand: string, scheduledAt: number): ReminderDose {
  return {
    doseId,
    medicationId: `m-${doseId}`,
    brand,
    detail: "40 mg",
    scheduledAt,
    status: "pending",
  };
}

describe("the handover carries the law, not a copy of it", () => {
  const now = new Date(2026, 9, 28, 8, 0, 0).getTime();
  const doses = [
    dose("d1", "Telma 40", now + 20 * 60_000),
    dose("d2", "Metformin 500", now + 90 * 60_000),
    dose("d3", "Ecosprin 75", now - 5 * 60_000),
  ];
  const plan = planAlerts(doses, DEFAULT_SETTINGS, now);

  test("the keys the worker is handed are the keys the law returned", () => {
    const armed = toScheduled(plan, now);
    const future = plan.filter((a) => a.at > now);
    expect(armed.map((a) => a.key)).toEqual(future.map((a) => a.key));
    expect(armed.map((a) => a.at)).toEqual([...armed.map((a) => a.at)].sort((x, y) => x - y));
    // Past alerts never re-enter the queue: an alert whose moment passed is
    // announced or suppressed, not replayed at the patient on a reload.
    expect(armed.some((a) => a.at <= now)).toBe(false);
  });

  test("the wording and the dedupe key are the law's own", () => {
    for (const a of toScheduled(plan, now)) {
      const source = plan.find((p) => p.key === a.key)!;
      expect(a.title).toBe(source.title);
      expect(a.options.body).toBe(source.body);
      // One key for both delivery paths, which is what makes the browser's own
      // dedupe the thing that stops a page and a worker stacking two copies.
      expect(a.options.tag).toBe(source.key);
      expect(a.key).toBe(`${source.doseId}:${source.kind}`);
    }
  });

  test("a delivered key is absent from the queue and present in the do-not-repeat list", () => {
    const msg = syncMessage(plan, ["d1:due"], now);
    expect(msg.armed.map((a) => a.key)).not.toContain("d1:due");
    expect(msg.fired).toEqual(["d1:due"]);
    expect(msg.day).toBe(dayKey(now));
    // A duplicate in the delivered set is not a second cancel of anything.
    expect(syncMessage(plan, ["d1:due", "d1:due"], now).fired).toEqual(["d1:due"]);
  });

  test("cancel names the keys it means and nothing else", () => {
    expect(cancelMessage(["a", "a", "b"])).toEqual({ protocol: PROTOCOL, type: "cancel", keys: ["a", "b"] });
  });
});

// ---- 3. what the page may believe about a message -------------------------

describe("a message the page accepts is a message this build sent", () => {
  test("announcedKey answers null for everything that is not ours", () => {
    const ours = { protocol: PROTOCOL, type: "announced", key: "d1:due" };
    expect(announcedKey(ours)).toBe("d1:due");
    for (const junk of [
      null,
      undefined,
      "announced",
      7,
      [],
      {},
      { type: "announced", key: "d1:due" }, // no protocol: another build
      { protocol: "vaidya-reminders-v0", type: "announced", key: "d1:due" },
      { protocol: PROTOCOL, type: "state", key: "d1:due" },
      { protocol: PROTOCOL, type: "announced", key: "" },
      { protocol: PROTOCOL, type: "announced", key: 42 },
      { protocol: PROTOCOL, type: "announced" },
    ]) {
      expect(announcedKey(junk)).toBeNull();
    }
    // An entry in the delivered set silences a real alert, so a key that would
    // match nothing must still not be able to write one.
    expect(announcedKey({ protocol: PROTOCOL, type: "announced", key: "__proto__" })).toBe("__proto__");
    expect(isOurs(ours)).toBe(true);
    expect(isOurs({ protocol: "other" })).toBe(false);
  });

  test("stateCounts reads numbers it can print", () => {
    const base = { protocol: PROTOCOL, type: "state", day: "2026-10-28", horizonMs: TIMER_HORIZON_MS };
    expect(stateCounts({ ...base, armed: [{ key: "a" }, { key: "b" }], fired: [], beyond: 3 })).toEqual({
      armed: 2,
      beyond: 3,
    });
    // A string has a `length`; "2 armed in the background" must not come from one.
    expect(stateCounts({ ...base, armed: "ab", fired: [], beyond: 0 })).toEqual({ armed: 0, beyond: 0 });
    for (const junk of [null, undefined, [], "state", { protocol: PROTOCOL, type: "announced" }]) {
      expect(stateCounts(junk)).toBeNull();
    }
    // A negative or non-finite `beyond` is not a count a card may print.
    expect(stateCounts({ ...base, armed: [], fired: [], beyond: -2 })?.beyond).toBe(0);
    expect(stateCounts({ ...base, armed: [], fired: [], beyond: NaN })?.beyond).toBe(0);
  });

  test("stateFired hands back only string keys and a day to compare", () => {
    const base = { protocol: PROTOCOL, type: "state", armed: [], horizonMs: TIMER_HORIZON_MS };
    expect(stateFired({ ...base, day: "2026-10-28", fired: ["d1:due", "d1:overdue"] })).toEqual({
      day: "2026-10-28",
      keys: ["d1:due", "d1:overdue"],
    });
    // A non-string entry would occupy the delivered set and suppress nothing, so it
    // is dropped — but the rest of the reply still counts, because losing a real
    // announcement to a malformed neighbour is the worse error.
    expect(stateFired({ ...base, day: "2026-10-28", fired: ["d1:due", 7, "", null] })).toEqual({
      day: "2026-10-28",
      keys: ["d1:due"],
    });
    expect(stateFired({ ...base, day: "2026-10-28", fired: "d1:due" })).toEqual({ day: "2026-10-28", keys: [] });
    // No day is not today's day: the caller cannot guard against a queue from
    // yesterday if the reply does not say which day it is.
    expect(stateFired({ ...base, fired: ["d1:due"] })).toBeNull();
    expect(stateFired({ ...base, day: "", fired: ["d1:due"] })).toBeNull();
    for (const junk of [null, undefined, [], "state", { protocol: "vaidya-reminders-v0", type: "state" }]) {
      expect(stateFired(junk)).toBeNull();
    }
    // A state reply *and* nothing else: an `announced` message carries one key and
    // goes through `announcedKey`, not this reader.
    expect(stateFired({ ...base, day: "2026-10-28", fired: [], type: "announced" })).toBeNull();
  });

  test("the page waits for the worker before it announces anything", () => {
    // Behaviour proven in `e2e/pwa.spec.ts`; pinned here because every piece of it
    // lives in a file the unit tier otherwise never imports.
    //  1. the firing loop holds until the worker has answered once,
    expect(hookSrc).toContain("if (!workerHasAnswered) return;");
    //  2. the answer it merges is read with the module's reader, not a shape check,
    expect(hookSrc).toContain("stateFired(event.data)");
    expect(hookSrc).toContain("firedToday.day === dayKey(Date.now())");
    //  3. and the hold is bounded by a deadline well inside the delivery grace, so
    //     a worker that never speaks cannot be what cost the patient the reminder.
    const deadline = /const WORKER_ANSWER_MS = ([\d_]+);/.exec(hookSrc);
    if (!deadline) throw new Error("use-reminders.ts no longer declares WORKER_ANSWER_MS");
    const ms = Number(deadline[1].replace(/_/g, ""));
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(DELIVERY_GRACE_MS);
    expect(hookSrc).toContain("}, WORKER_ANSWER_MS)");
  });
});

// ---- 4. the sentence about delivery cannot overclaim ----------------------

describe("the card says what the platform answered", () => {
  const LINKS: BackgroundLink[] = ["idle", "unsupported", "unreachable", "linked"];
  const WAKES: PeriodicWake[] = ["unknown", "unsupported", "off", "on"];
  const COUNTS = [0, 1, 3];

  /** Words a guardian may not use about its own delivery. */
  const FORBIDDEN = [
    "always",
    "guarantee",
    "guaranteed",
    "never miss",
    "100%",
    "definitely",
    "push", // there is no push channel and no VAPID key in this repository
    "sms",
    "email",
  ];

  const all: BackgroundState[] = [];
  for (const link of LINKS) {
    for (const periodicSync of WAKES) {
      for (const armed of COUNTS) {
        for (const beyond of COUNTS) all.push({ link, periodicSync, armed, beyond });
      }
    }
  }

  test("the cross product is the whole state space, not a sample", () => {
    expect(all.length).toBe(LINKS.length * WAKES.length * COUNTS.length * COUNTS.length);
    expect(all.length).toBeGreaterThan(80);
  });

  test("no sentence claims more than the four facts behind it", () => {
    for (const state of all) {
      const text = backgroundSentence(state);
      const lower = text.toLowerCase();

      expect(text.length).toBeGreaterThan(20);
      expect(text.endsWith(".")).toBe(true);
      expect(lower).not.toContain("undefined");
      expect(lower).not.toContain("nan");
      for (const word of FORBIDDEN) expect(lower.includes(word)).toBe(false);

      // A scheduled wake is claimed if and only if the browser granted one *and*
      // the worker that was granted it is the one answering. The three
      // limitation links return before the wake clause: a browser can grant a
      // periodic wake that this session never reaches because its worker was
      // refused, and "it wakes on a schedule" would then be a promise the app
      // cannot keep. `linked` is also the precondition for the wake being asked
      // at all — `use-reminders.ts` registers the wake on the registration a
      // resolved registration yielded — so the cross product's `on` rows for the
      // other links are states the page cannot be in, and the sentence says so.
      expect(lower.includes("wakes on a schedule")).toBe(state.link === "linked" && state.periodicSync === "on");

      // Firing with the tab closed is claimed if and only if a worker is linked
      // and it confirmed it holds something. The phrase tested is the
      // affirmative one: with `armed: 0` the sentence says "No alert is armed
      // to fire with this tab closed yet", which shares the substring
      // "with this tab closed" while denying the claim — a gate on the shared
      // tail would pass on a sentence that means the opposite.
      expect(lower.includes("can fire with this tab closed")).toBe(state.link === "linked" && state.armed > 0);
      if (state.link === "linked" && state.armed === 0) expect(lower).toContain("no alert is armed");

      // Anything that cannot deliver unattended names the fallback instead.
      if (state.link !== "linked") expect(lower).toContain("open");
      if (state.link === "linked" && state.periodicSync !== "on") expect(lower).toContain("open");

      // The horizon is a number, printed as a number, when there is one.
      if (state.link === "linked" && state.beyond > 0) expect(text).toContain(`${state.beyond} further out`);
      if (state.link !== "linked") expect(text).not.toContain("further out");
    }
  });

  test("the grammar follows the count, not the other way round", () => {
    expect(backgroundSentence({ ...BACKGROUND_IDLE, link: "linked", armed: 1 })).toContain("1 alert can fire");
    expect(backgroundSentence({ ...BACKGROUND_IDLE, link: "linked", armed: 2 })).toContain("2 alerts can fire");
    expect(backgroundSentence({ ...BACKGROUND_IDLE, link: "linked", armed: 1, beyond: 1 })).toContain("1 further out waits");
    expect(backgroundSentence({ ...BACKGROUND_IDLE, link: "linked", armed: 1, beyond: 2 })).toContain("2 further out wait");
  });

  test("before the worker answers, the card assumes nothing", () => {
    const text = backgroundSentence(BACKGROUND_IDLE).toLowerCase();
    expect(text).toContain("has not answered");
    expect(text).toContain("only while this tab is open");
    expect(text).not.toContain("can fire with this tab closed");
  });
});

// ---- 5. the manifest and the icon are the design system -------------------

describe("the manifest is generated, not remembered", () => {
  const m = manifest();

  test("its colours are the chrome the light scheme paints", () => {
    // The manifest is read at install time, before a document exists to resolve a
    // scheme, so it carries the light chrome — and `tests/theme.test.ts` already
    // pins `THEME_CHROME` to the tokens each scheme actually paints.
    expect(m.theme_color).toBe(THEME_CHROME.light);
    expect(m.background_color).toBe(THEME_CHROME.light);
    expect(m.theme_color).toBe("#f8f7f4");
  });

  test("it is installable in the way the app is actually built", () => {
    expect(m.id).toBe("/");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.lang).toBe("en-IN");
    expect((m.icons ?? []).length).toBeGreaterThan(0);
    for (const icon of m.icons ?? []) {
      expect(icon.src.startsWith("/")).toBe(true);
      expect(existsSync(at(`public${icon.src}`))).toBe(true);
    }
    // Both purposes, because a launcher that wants a masked icon and a launcher
    // that wants the artwork are two different requests for one file.
    expect((m.icons ?? []).map((i) => i.purpose).sort()).toEqual(["any", "maskable"]);
  });

  test("every shortcut names a tab the workspace can actually show", () => {
    const tabIds = [...workspaceSrc.matchAll(/\{ id: "([a-z]+)", label: /g)].flatMap((x) => (x[1] ? [x[1]] : []));
    expect(tabIds.length).toBeGreaterThanOrEqual(7);
    const shortcuts = m.shortcuts ?? [];
    expect(shortcuts.length).toBe(2);
    for (const s of shortcuts) {
      const task = /\/\?task=([a-z]+)$/.exec(s.url)?.[1];
      if (!task) throw new Error(`a manifest shortcut does not point at a ?task=<tab>: ${s.url}`);
      expect(tabIds).toContain(task);
    }
    expect(shortcuts.map((s) => s.url)).toEqual([TODAY_URL, VERIFY_URL]);
    // The page has to read the parameter the shortcut writes, or the shortcut is
    // a lie the launcher tells the patient.
    expect(pageSrc).toContain('const TASK_PARAM = "task"');
    expect(pageSrc).toContain("isTabId(task)");
  });
});

describe("the install icon is a token and a maskable shape", () => {
  const CLASSES: Record<string, string> = {
    band: "--vy-band",
    mark: "--vy-mint",
    moment: "--vy-clay-bright",
  };

  const rules = [...icon.matchAll(/\.(\w+)\s*\{\s*fill:\s*(#\w{6});\s*fill:\s*oklch\(([^)]+)\);/g)];

  test("each colour is a stylesheet token, hex fallback first", () => {
    expect(rules.length).toBe(3);
    for (const rule of rules) {
      const [, cls, hex, triple] = rule;
      const tokenName = CLASSES[cls];
      expect(tokenName).toBeDefined();
      const token = tokenTriple(tokenName);
      // Fallback order matters: the *later* valid declaration wins, so a UA that
      // parses CSS Color 4 gets the token and an older one keeps the nearest sRGB.
      expect(`oklch(${triple})`).toBe(lchString(token));
      const expected = rgbFromLch(token);
      for (let i = 0; i < 3; i++) {
        // ±1 per channel: Lightning CSS and `hexFromLch` round a tie differently,
        // and a tie is not the defect this is looking for.
        expect(Math.abs(hexChannel(hex, i) - Math.round(expected[i] * 255))).toBeLessThanOrEqual(1);
      }
      expect(hexFromLch(token)).not.toBe("#000000");
    }
  });

  /** A piece of this file's geometry, or a message naming what moved. A bare
   *  `!` on a re-shaped SVG is a TypeError that reads like a broken test. */
  function shape(pattern: RegExp, what: string): RegExpExecArray {
    const m = pattern.exec(icon);
    if (!m) throw new Error(`public/icons/icon.svg no longer has ${what}`);
    return m;
  }

  test("the mark sits inside the central 60%, which is what maskable means", () => {
    const size = Number(shape(/viewBox="0 0 (\d+) (\d+)"/, "a square viewBox")[1]);
    expect(size).toBe(512);
    // Full bleed: a masked launcher composites the icon onto its own shape, so
    // any transparent margin becomes a visible gap.
    const band = shape(/<rect class="band"[^>]*>/, "a full-bleed band")[0];
    for (const attr of ["x", "y"]) expect(band).toContain(`${attr}="0"`);
    expect(band).toContain(`width="${size}"`);
    expect(band).toContain(`height="${size}"`);

    // Safe zone is the central 60% of the canvas (64 of 108 dp in the spec's own
    // units), and it is measured here from the geometry rather than believed.
    const lo = size * 0.2;
    const hi = size * 0.8;
    const path = shape(/<path class="mark" d="([^"]+)"\s*\/>/, "the mark path")[1];
    const verts = [...path.matchAll(/[ML](\d+) (\d+)/g)].map((x) => [Number(x[1]), Number(x[2])]);
    expect(verts.length).toBeGreaterThanOrEqual(3);
    const circle = shape(/<circle class="moment" cx="(\d+)" cy="(\d+)" r="(\d+)"\s*\/>/, "the dose moment");
    const cx = Number(circle[1]);
    const cy = Number(circle[2]);
    const r = Number(circle[3]);
    const box = {
      minX: Math.min(...verts.map((v) => v[0]), cx - r),
      maxX: Math.max(...verts.map((v) => v[0]), cx + r),
      minY: Math.min(...verts.map((v) => v[1]), cy - r),
      maxY: Math.max(...verts.map((v) => v[1]), cy + r),
    };
    expect(box.minX).toBeGreaterThanOrEqual(lo);
    expect(box.maxX).toBeLessThanOrEqual(hi);
    expect(box.minY).toBeGreaterThanOrEqual(lo);
    expect(box.maxY).toBeLessThanOrEqual(hi);
  });
});

// ---- the CSP routing that lets the worker exist at all --------------------

describe("the worker script is served under a policy that permits it", () => {
  /** Every regex-shaped entry in `config.matcher`, compiled as the router compacts it.
   *
   * Next matches these strings itself, so asserting on the file's bytes would
   * only prove the bytes are still there. Each entry is read out of the array
   * literal and unescaped exactly as the JS parser unescapes it (`JSON.parse`),
   * then the `/((?!…).*)` form is compiled into a `RegExp`. That is what makes
   * the next test a gate rather than a caption: delete the exclusion term from
   * the source and the compiled pattern matches `sw.js`.
   */
  function matcherRegexes(source: string): RegExp[] {
    const block = /matcher: \[([\s\S]*?)\]/.exec(source);
    if (!block) throw new Error("src/proxy.ts no longer declares a `matcher: [...]` array");
    const entries = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string);
    return entries.filter((e) => e.startsWith("/((")).map((e) => new RegExp(`^${e.slice(1)}$`));
  }

  test("the proxy does not put the document nonce policy on /sw.js", () => {
    // `'strict-dynamic'` makes a conforming browser ignore every source
    // expression, and a worker script body has no nonce to be evaluated with,
    // so a document policy on the worker's response is a generic SecurityError
    // with nothing in the console naming the cause.
    const patterns = matcherRegexes(proxySrc);
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    for (const re of patterns) expect(re.test("sw.js")).toBe(false);
    // …and it is the exclusion term doing the work, not an accident of shape.
    const without = proxySrc.replace(/sw\\\\\.js\$\|/, "");
    if (without === proxySrc) throw new Error("the matcher no longer excludes sw.js with an alternation term");
    const regressed = matcherRegexes(without);
    expect(regressed.some((re) => re.test("sw.js"))).toBe(true);
    // The exclusion is one file, not a class: a document still gets the policy,
    // and a static asset still skips it for the reason it always had.
    for (const re of patterns) {
      expect(re.test("dashboard")).toBe(true);
      expect(re.test("verify")).toBe(true);
      expect(re.test("icons/icon.svg")).toBe(false);
      expect(re.test("sw.js.map")).toBe(true);
    }
    expect(proxySrc).toContain('"/api/:path*"');
  });

  test("the response carries a policy that does allow same-origin script", () => {
    const array = /const SERVICE_WORKER_CSP = (\[[^\]]*\])\.join/.exec(configSrc)?.[1];
    if (!array) throw new Error("next.config.ts no longer builds SERVICE_WORKER_CSP as a joined array");
    const csp = [...array.matchAll(/"([^"]+)"/g)].map((x) => JSON.parse(`"${x[1]}"`)).join("; ");
    expect(csp).not.toContain("strict-dynamic");
    expect(csp).not.toContain("nonce");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(configSrc).toContain('source: "/sw.js"');
    // A worker that never revalidates is a worker that never updates.
    expect(configSrc).toContain("must-revalidate");
  });
});

// ---- the headed tier's own boundary ---------------------------------------

describe("the delivery tier can name a host it cannot run on", () => {
  test("only a Linux host without an X display is a host without a window server", () => {
    expect(displayAvailable("linux", { DISPLAY: ":99" })).toBe(true);
    expect(displayAvailable("linux", {})).toBe(false);
    // An empty variable is not a display: `DISPLAY=""` is what a non-login shell hands
    // over, and Playwright fails on it exactly as it fails on an unset one.
    expect(displayAvailable("linux", { DISPLAY: "" })).toBe(false);
    // Wayland alone is not enough either: Playwright launches X11 Chromium by default,
    // so a Wayland-only host is precisely the launch failure this guard exists to name.
    expect(displayAvailable("linux", { WAYLAND_DISPLAY: "wayland-0" })).toBe(false);
    // macOS and Windows always have a window server for a GUI process, whether or not
    // anything is on screen. Returning false there would skip five gates on the one
    // machine a developer is certain to run them on.
    for (const other of ["darwin", "win32", "freebsd"] as const) expect(displayAvailable(other, {})).toBe(true);
    // And the no-argument call is the host the spec runs on, so the pinned law and the
    // guard in `pwa-delivery.spec.ts` cannot drift apart.
    expect(displayAvailable()).toBe(process.platform === "linux" ? Boolean(process.env.DISPLAY) : true);
  });

  test("the headed file asks that law before a browser exists, and says what went unmeasured", () => {
    // A `beforeEach` that touches the `context` fixture has already launched Chromium,
    // so on a display-less Linux host the run would die on "Missing X server or
    // $DISPLAY" — a red job that reports no product defect and no honest skip.
    const guard = deliverySpec.indexOf("test.skip(!displayAvailable(), NO_DISPLAY)");
    expect(guard, "pwa-delivery.spec.ts no longer skips the whole file for a missing display").toBeGreaterThan(-1);
    expect(deliverySpec.indexOf("test.use({ headless: false })")).toBeLessThan(guard);
    expect(deliverySpec.slice(guard).indexOf("test.beforeEach")).toBeGreaterThan(-1);
    expect(deliverySpec.match(/^test\.skip\(/m), "the guard is not at file scope").toBeTruthy();
    // The reason names the consequence, because a skip a reader cannot interpret is a
    // tier that quietly stopped being measured.
    expect(NO_DISPLAY).toContain("window server");
    expect(NO_DISPLAY).toContain("headed Chromium cannot open");
  });

  test("CI gives the job the display the guard asks for", () => {
    const workflow = readFileSync(at("../../.github/workflows/ci.yml"), "utf8");
    const job = /  web-e2e:\n([\s\S]*?)(?=\n  \w)/.exec(workflow)?.[1];
    if (!job) throw new Error("the web-e2e job is gone from ci.yml");
    expect(job).toContain("xvfb");
    expect(job).toMatch(/run: xvfb-run -a bun run e2e/);
  });
});
