/**
 * WCAG 2.2, the three criteria a scanner pass cannot see.
 *
 * The axe gate in `accessibility.spec.ts` runs a fixed tag list, and originally every
 * rule in it was decidable from the accessibility tree of a page at rest. The list now
 * also carries `wcag22aa`, which tag-selects axe's experimental `target-size` rule — a
 * rule that measures laid-out boxes and honours the criterion's spacing allowance, not
 * the Inline-only reading measured below. Both run: axe scores every widget it can
 * match, and this file still measures what the box is. These three are what a
 * tree-only pass cannot see:
 *
 * - **1.4.10 Reflow** is a statement about a *layout at a width*. Nothing in the DOM
 *   says "this row cannot shrink"; a `flex` with seven chips and no `flex-wrap` is
 *   valid markup and valid CSS, and it fails only when the viewport is 320 px wide.
 *   Measured here, this file's first run found two panels asking for 382 px and
 *   420 px — Today's dose card and the Family relation picker — both fixed by
 *   letting the row wrap, which changes nothing at desktop width.
 * - **2.5.8 Target Size (Minimum)** is a statement about a *box*, and the box only
 *   exists after layout. A 20 px-tall nav link is not a missing `height`, it is a
 *   line-height. The header's four section links measured 20 px; they are 28 now.
 *   Links inside a sentence are exempt by the criterion's own Inline exception, so
 *   the gate walks the chrome, not the prose, and says why.
 * - **2.4.11 Focus Not Obscured (Minimum)** is a statement about *where the browser
 *   scrolled to* after a keypress, and about what is physically painted on top of it
 *   there. It can only be observed by pressing Tab and hit-testing the focused box:
 *   five points, because the criterion fails only when *no* pixel survives, and one
 *   point at the centre, which is this repo's stricter house rule. A rectangle
 *   arithmetic version of the same test is wrong in a way the skip link demonstrates
 *   on the first Tab stop: it sits inside the sticky header's band by design and is
 *   painted above it at a higher z-index, so any "is it under the header?" maths fails
 *   a control that is perfectly visible. Only the pixel answers.
 *
 * All three run against the deterministic standalone server, with the demo plan
 * force-seeded: an empty panel has nothing to overflow, so a gate that scans one
 * proves only that an empty page is narrow.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect, request } from "@playwright/test";

const BASE = "http://localhost:3457";
const TABS = ["verify", "review", "today", "insights", "copilot", "family", "evidence"] as const;

type Reflow = {
  scrollW: number;
  clientW: number;
  offenders: Array<{ tag: string; cls: string; w: number }>;
};
type Stop = {
  name: string;
  tag: string;
  centreCovered: string | null;
  visiblePoints: number;
};
type SmallTarget = { name: string; w: number; h: number };
type AfterSkip = { mains: number; targetExists: boolean; targetContainsHeader: boolean; focusOnTarget: boolean };
type NextStop = { name: string; inHeader: boolean; inMain: boolean };
type AnchorRest = { hash: string; top: number; headerBottom: number };

/** What a 320 px viewport is allowed to be asked for, per SC 1.4.10. */
const REFLOW = `(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
  offenders: [...document.querySelectorAll('main *')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > window.innerWidth + 1 && r.height > 0;
    })
    .filter((el) => {
      // A scroll container is allowed: the criterion is about the *page* reflowing,
      // and a table inside an overflow-x-auto wrapper scrolls itself rather than the document.
      let n = el.parentElement;
      while (n) {
        const o = getComputedStyle(n).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden') return false;
        n = n.parentElement;
      }
      return true;
    })
    .slice(0, 6)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 70),
      w: Math.round(el.getBoundingClientRect().width),
    })),
}))()`;

/** Every focusable box on the page, sized — the 24 px floor is SC 2.5.8's. */
const SMALL_TARGETS = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('main button, main a, header a, header button')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (el.disabled === true) continue;
    // SC 2.5.8's own Inline exception: a target inside a run of text is sized by
    // the text, so the prose links in the closing strip are excluded here rather
    // than reported as failures they are not.
    const cs = getComputedStyle(el);
    if (cs.display === 'inline' && el.closest('p, li')) continue;
    if (r.width < 24 || r.height < 24) {
      out.push({
        name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
  }
  return out;
})()`;

/**
 * One Tab stop, hit-tested at its centre and at its four corners — but only after
 * the frame that paints the new focus state has committed.
 *
 * The settle is not ceremony. Read immediately after the keypress, the focused
 * element can report styles the engine has not recalculated yet: a probe of this
 * page returned the skip link matching `:focus-visible` while `getComputedStyle`
 * still said `left: -9999px`, one run in twelve, and the gate called that "entirely
 * hidden by an overlay". SC 2.4.11 is a rule about where focus comes to rest on
 * screen, so the measurement belongs after the frame that puts it there — which also
 * retires the travelling-rectangle read this file first papered over by taking every
 * obscuring verdict twice.
 */
const WALK = `(async () => {
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  const hitsSelf = (x, y) => {
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  };
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const points = [
    [r.left + 2, r.top + 2],
    [r.right - 2, r.top + 2],
    [r.left + 2, r.bottom - 2],
    [r.right - 2, r.bottom - 2],
    [cx, cy],
  ];
  const hitEl = hitsSelf(cx, cy) ? null : document.elementFromPoint(cx, cy);
  return {
    name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 32),
    tag: el.tagName.toLowerCase(),
    centreCovered: !hitEl ? null : hitEl.tagName.toLowerCase() + '.' + (hitEl.className || '').toString().split(' ').slice(0, 3).join('.'),
    visiblePoints: points.filter(([x, y]) => hitsSelf(x, y)).length,
  };
})()`;

/**
 * What a jump actually landed on, read after the frame that performs it.
 *
 * Two mechanisms live here and each has its own measurement, because the first one
 * hid the second. `html { scroll-padding-top: 4.5rem }` exists so the sticky bar
 * does not sit on the top of a section the page just scrolled to — and it is
 * invisible to the Tab walk above, because Chrome scrolls a focused element to the
 * *nearest* edge, which for a downward tab is the bottom of the viewport, nowhere
 * near the bar. Zeroing the padding therefore changes nothing that the walk can see;
 * only an in-page anchor link moves the target, and only a probe of one showed the
 * padding holding a section at `top: 72` against a bar that ends at `65`.
 *
 * The same probe found the skip link bypassing nothing. Its `#main` target *began*
 * with the navigation bar, so activating it and pressing Tab returned to the header
 * links it claims to jump over — and `<main>` was nested inside a second `<main>`, so
 * the landmark the target names is not the one the reader is in. Both are structural,
 * both are invisible to a scanner at rest, and both are asserted below.
 */
const AFTER_SKIP = `(async () => {
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  const target = document.getElementById('main');
  return {
    mains: document.querySelectorAll('main').length,
    targetExists: !!target,
    targetContainsHeader: !!target && !!target.querySelector('header'),
    focusOnTarget: document.activeElement === target,
  };
})()`;

const NEXT_STOP = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return { name: '(body)', inHeader: false, inMain: false };
  const r = el.getBoundingClientRect();
  return {
    name: ((el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 22) + ' @' + Math.round(r.top)),
    inHeader: !!el.closest('header'),
    inMain: !!el.closest('main'),
  };
})()`;

const ANCHOR_REST = `(async () => {
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  const hash = location.hash;
  const el = hash ? document.querySelector(hash) : null;
  const header = document.querySelector('header');
  if (!el || !header) return null;
  return {
    hash,
    top: Math.round(el.getBoundingClientRect().top),
    headerBottom: Math.round(header.getBoundingClientRect().bottom),
  };
})()`;

test.describe("the geometry a scanner cannot see (WCAG 2.2)", () => {
  // Same reason the axe file gives it: with `scroll-behavior: smooth` live, a Tab press
  // animates the scroll, and a hit-test taken mid-flight reads a rectangle that is
  // still travelling. The criterion is about where focus comes to rest, so the walk
  // measures the resting state; the reduced-motion guard is also the state a real
  // AT user is most likely to be in.
  test.use({ reducedMotion: "reduce" });

  test.beforeAll(async () => {
    const api = await request.newContext({ baseURL: BASE });
    const res = await api.post("/api/seed", { data: { force: true } });
    expect(res.ok(), "the deterministic seed must answer for the geometry gates").toBeTruthy();
    await api.dispose();
  });

  test.describe("1.4.10 reflow, at the width a patient's phone actually reports", () => {
    test.use({ viewport: { width: 320, height: 568 } });

    test("the landing page never asks for a wider page than the viewport", async ({ page }) => {
      await page.goto("/");
      const m = await page.evaluate<Reflow>(REFLOW);
      expect(m.offenders, JSON.stringify(m.offenders)).toEqual([]);
      expect(m.scrollW, `document is ${m.scrollW} wide in a ${m.clientW} viewport`).toBeLessThanOrEqual(m.clientW + 1);
    });

    for (const tab of TABS) {
      test(`${tab}: no content is wider than the phone that has to show it`, async ({ page }) => {
        await page.goto(`/?task=${tab}`);
        // Measure the loaded panel, not the skeleton. This gate first shipped with an
        // `expect.poll` on the document width and passed while a 420 px row was live,
        // because the first poll tick ran against the placeholder geometry — a page
        // that is narrow by construction. `aria-busy` is the placeholder's own signal
        // (see the placeholder law), so its absence is what makes the measurement real.
        await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
        const m = await page.evaluate<Reflow>(REFLOW);
        expect(m.offenders, `${tab}: ${JSON.stringify(m.offenders)}`).toEqual([]);
        expect(m.scrollW, `${tab}: document is ${m.scrollW} wide in a ${m.clientW} viewport`).toBeLessThanOrEqual(
          m.clientW + 1
        );
      });
    }
  });

  test.describe("2.5.8 target size, on the chrome the app itself lays out", () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test("every header and landing control is at least a 24 px square", async ({ page }) => {
      // A scan that quietly drops `wcag22aa` stays green: axe's `target-size` rule is
      // disabled by default and only runs because that tag selects it. So the tag list
      // is read back out of both spec files, the way the worker contract is read out of
      // `public/sw.js`, rather than trusted to stay.
      const tagLists = ["accessibility.spec.ts", "theme.spec.ts"].flatMap((file) => {
        const text = fs.readFileSync(path.join(process.cwd(), "e2e", file), "utf8");
        return [...text.matchAll(/\.withTags\(\[([^\]]*)\]\)/g)].map((m) => ({ file, tags: m[1] }));
      });
      expect(tagLists.length, "no axe tag list found — the scan pattern moved").toBeGreaterThanOrEqual(8);
      for (const list of tagLists) {
        expect(list.tags, `${list.file} does not tag its scan wcag22aa`).toContain('"wcag22aa"');
      }

      await page.goto("/");
      const small = await page.evaluate<SmallTarget[]>(SMALL_TARGETS);
      expect(small, JSON.stringify(small)).toEqual([]);
    });

    test("a tab, a dose action and a theme switch are all hittable at 320 px too", async ({ page }) => {
      await page.goto("/?task=today");
      await expect(page.getByText("Active plan").first()).toBeVisible();
      await page.setViewportSize({ width: 320, height: 568 });
      const small = await page.evaluate<SmallTarget[]>(SMALL_TARGETS);
      expect(small, JSON.stringify(small)).toEqual([]);
    });
  });

  test.describe("2.4.11 focus not obscured, measured by pressing Tab", () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    for (const target of ["/", "/?task=today"]) {
      test(`nothing that takes focus on ${target} ends up under an overlay`, async ({ page }) => {
        await page.goto(target);
        const stops: string[] = [];
        for (let i = 0; i < 45; i++) {
          await page.keyboard.press("Tab");
          const info = await page.evaluate<Stop | null>(WALK);
          if (!info) continue;
          const key = `${info.tag}:${info.name}`;
          if (stops.includes(key)) break;
          stops.push(key);
          // Centre first: an element painted over the middle of a focused control
          // fails this repo's stricter house rule even when a corner survives.
          expect(info.centreCovered, `${key}: another element is on top of its centre`).toBeNull();
          // SC 2.4.11 (AA) itself fails only when *no* pixel of the focused element
          // is visible, so that is the second, looser threshold.
          expect(info.visiblePoints, `${key}: entirely hidden by an overlay`).toBeGreaterThan(0);
        }
        // A walk that stopped after one stop measured nothing, so the walk itself is gated.
        expect(stops.length).toBeGreaterThan(4);
      });
    }

    test("the skip link skips the navigation instead of re-presenting it", async ({ page }) => {
      await page.goto("/");
      // Deep first: a jump that only moves the viewport is invisible on a page that
      // was already at the top, and a passing gate must not be able to measure 0 px.
      await page.evaluate(`(() => window.scrollTo(0, 2500))()`);
      await page.keyboard.press("Tab");
      const first = await page.evaluate(`(() => (document.activeElement || {}).className || '')()`);
      expect(first, "the first Tab stop must be the skip link for this to test anything").toContain("vy-skip-link");
      await page.keyboard.press("Enter");
      const after = await page.evaluate<AfterSkip | null>(AFTER_SKIP);
      expect(after, "the page must expose a #main target").not.toBeNull();
      expect(after!.targetExists, "there must be an element with id main for the skip link to name").toBe(true);
      expect(after!.mains, `a second nested main gives a reader two landmarks to trip over (found ${after!.mains})`).toBe(1);
      expect(after!.targetContainsHeader, "#main still begins with the navigation bar, so nothing is bypassed").toBe(false);
      // Then the tab order itself, which is the only part a keyboard user feels.
      await page.keyboard.press("Tab");
      const next = await page.evaluate<NextStop | null>(NEXT_STOP);
      expect(next!.inHeader, `Tab after the skip link went back into the navigation (${next!.name})`).toBe(false);
      expect(next!.inMain, `Tab after the skip link landed outside the main landmark (${next!.name})`).toBe(true);
    });

    test("each nav anchor comes to rest below the sticky bar, not under it", async ({ page }) => {
      await page.goto("/");
      for (const label of ["The gap", "The loop", "The law", "The proof"]) {
        await page.evaluate(`(() => window.scrollTo(0, 0))()`);
        await page.locator("header").getByRole("link", { name: label, exact: true }).click();
        const rest = await page.evaluate<AnchorRest | null>(ANCHOR_REST);
        expect(rest, `${label}: the link did not land on an element with that id`).not.toBeNull();
        // The bar is sticky, so it paints wherever the scroll ends up. A section that
        // comes to rest above its bottom edge has its opening lines covered, which is
        // the whole reason the padding exists — and 4.5rem of padding against a 65 px
        // bar is 7 px of margin, so a one-rem cut here is a real failure, not a fuss.
        expect(rest!.top, `${label}: ${rest!.hash} rests at ${rest!.top}, the bar ends at ${rest!.headerBottom}`).toBeGreaterThanOrEqual(
          rest!.headerBottom - 1
        );
      }
    });
  });
});
