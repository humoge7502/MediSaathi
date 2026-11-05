/**
 * Theme gate (RES-33 slice 2) — what only a browser can prove about `.dark`.
 *
 * `tests/theme.test.ts` (26) pins the laws: every dark override names a real
 * token, both schemes declare `color-scheme`, the chrome hexes are the painted
 * backgrounds, `resolveTheme` beats the OS with a stored choice, the band tokens
 * are a fixed island, no component paints an `-ink` as a background, the boot
 * script is inert as markup, and the layout mounts it with a nonce. All of that
 * is source text and pure functions. None of it can see the four things this
 * file is for:
 *
 *   1. **First frame.** A dark-OS visitor must never receive a light pixel. The
 *      boot script's whole reason to exist is that it runs before paint, so the
 *      assertion is taken inside the first `requestAnimationFrame` — a callback
 *      that fires *after* the first frame is committed. A white flash would be
 *      in that frame and the class would not be.
 *   2. **Ordering against the `<meta>`, and against content.** The script
 *      rewrites `meta[theme-color]`, which only works if that tag is already
 *      parsed, and it has to run before anything paints. Head placement is the
 *      framework's choice, not ours: React 19 moves a script that is the first
 *      child of `<html>` to the *top of `<body>`*, which is still correct but
 *      fails a "before `<body>`" assertion. So the byte offsets are measured
 *      against the first element that could paint, not against `<body>`.
 *   3. **Chromium's OKLCH against ours.** `scripts/palette.ts` is the math every
 *      contrast number in this project derives from; the browser has its own. If
 *      the two disagree, the contrast table describes a page nobody renders. The
 *      comparison cannot read the token off CSSOM: Chromium serialises a computed
 *      `oklch()` as `lab()` — for properties *and* for custom properties — so
 *      `--background` comes back as `lab(5.37% -2.39 0.95)` and there is no
 *      `oklch(` in the string to parse. The colour is therefore pushed through
 *      the canvas 2D engine, which accepts any CSS `<color>` and gives back the
 *      sRGB bytes it would actually put on screen, and those bytes are compared
 *      with `THEME_CHROME` — our own conversion, which the unit tier pins to the
 *      same stylesheet.
 *   4. **CSP is real.** The nonce arrives through a per-request header from the
 *      proxy, and a script tag without the matching nonce is *silently dropped*
 *      — a failure (the light flash) that looks like a CSS bug. The raw response
 *      is checked against the `script-src` nonce.
 *   5. **Every surface, not the two that were easy.** `.dark` was reachable before
 *      it was audited, and auditing only the landing page is how a palette gets
 *      shipped as "checked" while six panels stay unmeasured. The tour at the end
 *      of this file exists for that, and it asserts its own coverage: a tab click
 *      is confirmed by `aria-current` *and* by an anchor only that panel renders,
 *      so a panel that failed to mount fails the run instead of being scanned as
 *      an empty shell.
 *
 * A note on how the assertions are written: `page.evaluate` ships the function's
 * *source* into the page, so a page-side callback cannot reference a constant
 * declared here — it dies with a ReferenceError that no typecheck sees. Every
 * browser-side reader below is self-contained, `readThemeState` is the one shared
 * by all of them, and the rasteriser is duplicated inside the init script rather
 * than shared for exactly that reason.
 *
 * Runs against the same standalone server as the rest of the suite
 * (`bun run e2e`), deterministic tier only, zero model calls.
 */
import { test, expect, request } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { DARK_CLASS, THEME_CHROME, THEME_STORAGE_KEY } from "../src/lib/theme";

const BASE = "http://localhost:3457";

type Rgb = [number, number, number];

type ThemeState = {
  dark: boolean;
  scheme: string;
  meta: string | null;
  /** Computed `background-color` of `<body>`, as Chromium serialises it. */
  bodyBg: string;
  /** The same colour as the bytes it paints — see header note 3. */
  bodyBgRgb: Rgb | null;
  /** Computed `--background`, which arrives as `lab(…)`, never as `oklch(…)`. */
  token: string;
  tokenRgb: Rgb | null;
};

/**
 * The theme state the browser holds, read at whatever moment is asked.
 *
 * Self-contained on purpose, and the class name is a literal: this runs in the
 * page, where it can import nothing and can close over nothing. The cost is one
 * string that `tests/theme.test.ts` already pins against `src/lib/theme.ts`.
 *
 * `rasterise` is declared *inside* this function rather than above it because
 * `page.evaluate` ships this body as source text: a helper in this file's scope
 * would not exist in the page. Lifting it out and reaching it with `eval` or
 * `new Function` is not an option either — this document's CSP is
 * `script-src 'nonce-…'` with no `'unsafe-eval'` (TD-2), so the page would
 * refuse to compile it. Same reason, different mechanism, as the flash.
 */
function readThemeState(): ThemeState {
  /**
   * The sRGB bytes Chromium would put on screen for any CSS `<color>` string.
   *
   * Canvas is the only API in the page that commits to sRGB: the `fillStyle`
   * setter ignores a value it cannot parse and leaves the previous one in place,
   * so the sentinel below turns a silent rejection into a `null` instead of a
   * black pixel that would read as a theme failure.
   */
  function rasterise(color: string): [number, number, number] | null {
    if (!color) return null;
    const cv = document.createElement("canvas");
    cv.width = 1;
    cv.height = 1;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#010203";
    ctx.fillStyle = color;
    if (ctx.fillStyle === "#010203") return null;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }

  const cs = getComputedStyle(document.documentElement);
  const meta = document.querySelector('meta[name="theme-color"]');
  const bodyBg = document.body ? getComputedStyle(document.body).backgroundColor : "";
  const token = cs.getPropertyValue("--background").trim();
  return {
    dark: document.documentElement.classList.contains("dark"),
    scheme: cs.colorScheme,
    meta: meta ? meta.getAttribute("content") : null,
    bodyBg,
    bodyBgRgb: rasterise(bodyBg),
    token,
    tokenRgb: rasterise(token),
  };
}

/** `#rrggbb` — the form our own palette math commits to — as bytes. */
function hexToRgb(hex: string): Rgb {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  expect(m, `THEME_CHROME is not a 6-digit hex: ${hex}`).not.toBeNull();
  return [Number(`0x${m![1]}`), Number(`0x${m![2]}`), Number(`0x${m![3]}`)];
}

function expectSameColour(ours: Rgb | null, theirs: Rgb | null, why: string, tol = 2) {
  expect(ours, `${why}: our side produced no colour`).not.toBeNull();
  expect(theirs, `${why}: Chromium produced no colour`).not.toBeNull();
  for (let i = 0; i < 3; i += 1) {
    expect(
      Math.abs((ours as Rgb)[i] - (theirs as Rgb)[i]),
      `${why}: channel ${i} — ours ${(ours as Rgb)} vs Chromium ${(theirs as Rgb)}`
    ).toBeLessThanOrEqual(tol);
  }
}

test.describe("first paint for a dark-OS visitor", () => {
  test.use({ colorScheme: "dark" });

  test("the first frame is already dark — no light pixel, chrome included", async ({ page }) => {
    await page.addInitScript(() => {
      // In the page, so: no imports, no closure over this file.
      (window as unknown as { __firstFrame: unknown }).__firstFrame = null;
      requestAnimationFrame(() => {
        const cs = getComputedStyle(document.documentElement);
        const meta = document.querySelector('meta[name="theme-color"]');
        (window as unknown as { __firstFrame: unknown }).__firstFrame = {
          dark: document.documentElement.classList.contains("dark"),
          scheme: cs.colorScheme,
          meta: meta ? meta.getAttribute("content") : null,
          bodyBg: document.body ? getComputedStyle(document.body).backgroundColor : "",
        };
      });
    });
    await page.goto("/");
    // Two further rAFs: the capture callback is scheduled before the document
    // exists and runs when the first frame is presented; waiting on the next two
    // proves it has run, without a network-idle wait that could hide a
    // post-hydration repaint.
    const captured = await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve((window as unknown as { __firstFrame: unknown }).__firstFrame)
            )
          )
        )
    );
    const frame = captured as {
      dark: boolean;
      scheme: string;
      meta: string | null;
      bodyBg: string;
    };
    expect(frame.dark, "the boot script had not applied the dark class by the first frame").toBe(true);
    expect(frame.scheme).toBe("dark");
    // The meta is rewritten by the same script, so this also proves the tag was
    // already parsed when it ran — the ordering question the header raises.
    expect(frame.meta, "the browser chrome still says light on a dark first frame").toBe(THEME_CHROME.dark);

    // Not `expect(frame.bodyBg).toBe("rgb(14, 19, 16)")`, which is how this line
    // was first written and why it failed on a correct page: Chromium serialises
    // a computed OKLCH background as `lab(5.37082% -2.38625 0.94696)`, so no
    // `rgb()` literal ever appears. What the flash would actually be is a
    // *different* string at the first frame than once the page settles — so the
    // comparison is first frame against settled, in the browser's own notation.
    const settled = await page.evaluate(readThemeState);
    expect(frame.bodyBg, "the first frame was one colour and the settled page another — that is the flash").toBe(
      settled.bodyBg
    );
    expect(frame.bodyBg, "a computed colour came back as rgb(), which would make the comparison above a tautology").not.toMatch(
      /^rgba?\(/
    );
  });

  test("Chromium's colour engine agrees with scripts/palette.ts (dark)", async ({ page }) => {
    await page.goto("/");
    const state = await page.evaluate(readThemeState);
    expect(state.dark).toBe(true);
    // Two independent implementations of the same conversion. Left:
    // `THEME_CHROME.dark`, produced by `oklchToRgb` in `scripts/palette.ts` and
    // pinned to the `.dark --background` literal by `tests/theme.test.ts`. Right:
    // what Chromium's canvas puts on screen for that same token. If the two
    // diverge, every contrast ratio in this project describes a page nobody
    // renders — and axe, which measures Chromium, would disagree with the table.
    expectSameColour(hexToRgb(THEME_CHROME.dark), state.tokenRgb, "--background token");
    expectSameColour(hexToRgb(THEME_CHROME.dark), state.bodyBgRgb, "painted <body> background");
    // And the two Chromium sides agree with each other, which is what makes the
    // first-frame comparison above meaningful rather than two readings of luck.
    expectSameColour(state.tokenRgb, state.bodyBgRgb, "token vs painted background");
  });
});

test.describe("the SSR response a no-JS reader receives", () => {
  test("ships light chrome plus a nonced boot script that runs before anything paints", async ({ page }) => {
    const res = await page.request.get("/");
    expect(res.ok()).toBeTruthy();
    const html = await res.text();

    // The server cannot know the preference, so the default it prints is light —
    // which is the entire reason the script exists.
    expect(html).toContain(`<meta name="theme-color" content="${THEME_CHROME.light}"`);
    expect(html).not.toContain(`class="${DARK_CLASS}"`);

    const scriptAt = html.indexOf(THEME_STORAGE_KEY);
    expect(scriptAt, "the boot script is not in the document at all").toBeGreaterThan(-1);

    // The law is "inside the very top of the document, before any of the app's
    // own markup", not "before `<body>`". That second version failed twice on a
    // page that was behaving, and both lessons are worth keeping:
    //   • React 19 / Next 16 hoists an inline script that is the *first child of
    //     `<html>`* to the top of `<body>` rather than into `<head>` — measured
    //     here at byte 4099, with `<body` itself at 3884.
    //   • Next emits `<div hidden=""><!--$--><!--/$--></div>` as a Suspense marker
    //     ahead of it (byte 3973), and `<body>` carries the page background class,
    //     so a "first element" scan lands on things that cannot flash.
    // Byte offsets pin placement, which is deterministic and cheap. Whether the
    // first *frame* is actually dark is a rendering question no offset can answer,
    // and it is asserted where it can be — the rAF capture above.
    const bodyTagEnd = html.indexOf(">", html.indexOf("<body"));
    expect(bodyTagEnd).toBeGreaterThan(0);
    const NON_RENDERING = /^(script|template|style|link|meta|title)$/i;
    let firstContent = -1;
    for (const found of html.slice(bodyTagEnd + 1).matchAll(/<([a-z0-9]+)((?:"[^"]*"|'[^']*'|[^>])*)>/gi)) {
      if (NON_RENDERING.test(found[1])) continue;
      if (/\shidden(\s|=|>)/i.test(found[2])) continue;
      firstContent = bodyTagEnd + 1 + (found.index as number);
      break;
    }
    expect(firstContent, "no paintable element follows <body>, so there is nothing to order against").toBeGreaterThan(-1);
    expect(
      scriptAt,
      `the boot script sits after the app's own markup: script at ${scriptAt}, first content element at ${firstContent} (${html.slice(firstContent, firstContent + 60)})`
    ).toBeLessThan(firstContent);

    // The script rewrites the theme-color meta, so that tag has to be parsed
    // already. Byte order in the served document is the proof.
    const metaAt = html.indexOf('<meta name="theme-color"');
    expect(metaAt).toBeGreaterThan(-1);
    expect(
      metaAt,
      `the <meta> is at ${metaAt} but the script that rewrites it is at ${scriptAt}`
    ).toBeLessThan(scriptAt);

    // TD-2: `script-src` has no 'unsafe-inline'. On a nonced document route this
    // script must carry that nonce, or the browser drops it and the flash is
    // back — and the only symptom is a colour.
    const csp = res.headers()["content-security-policy"] ?? "";
    const cspNonce = /nonce-([^ '";]+)/.exec(csp)?.[1];
    expect(cspNonce, `no nonce in the CSP header: ${csp}`).toBeTruthy();
    const tagStart = html.lastIndexOf("<script", scriptAt);
    const tag = html.slice(tagStart, html.indexOf(">", tagStart) + 1);
    expect(tag, `the boot script tag is not nonced: ${tag}`).toContain(`nonce="${cspNonce}"`);

    // The script is a *string*, so nothing in the build ties the class it writes
    // to the module the control reads. `tests/theme.test.ts` pins that pair in
    // source; this pins that the bytes actually served still carry it.
    expect(html).toContain(`classList.toggle("${DARK_CLASS}",`);
  });
});

test.describe("choice, persistence and the OS", () => {
  test("the toggle beats the OS across a reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect
      .poll(async () => (await page.evaluate(readThemeState)).dark, {
        message: "a dark OS did not get a dark first paint",
      })
      .toBe(true);

    await page.getByRole("button", { name: /Switch to light theme/ }).click();
    expect(await page.evaluate((k) => localStorage.getItem(k), THEME_STORAGE_KEY)).toBe("light");
    expect((await page.evaluate(readThemeState)).dark).toBe(false);

    await page.reload();
    const state = await page.evaluate(readThemeState);
    // A stored choice wins even against the system: this is a patient having said
    // "not this" once, and the app must not overrule it on every visit.
    expect(state.dark).toBe(false);
    expect(state.meta).toBe(THEME_CHROME.light);
    expect(state.scheme).toBe("light");
    // The control labels its destination, not its own state.
    await expect(page.getByRole("button", { name: /Switch to dark theme/ })).toBeVisible();
  });

  test("nothing stored follows the OS live; storing a value stops it", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    expect((await page.evaluate(readThemeState)).dark).toBe(false);

    await page.emulateMedia({ colorScheme: "dark" });
    await expect
      .poll(async () => (await page.evaluate(readThemeState)).dark, {
        message: "the sunset switch never reached the app",
      })
      .toBe(true);
    expect(await page.evaluate((k) => localStorage.getItem(k), THEME_STORAGE_KEY)).toBeNull();

    // Now express a preference — light, against the system — and move the OS
    // again. The stored value has to suppress the follow, or the toggle is
    // something the operating system can undo.
    await page.getByRole("button", { name: /Switch to light theme/ }).click();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(300); // the change event is async; this is its window
    const state = await page.evaluate(readThemeState);
    expect(state.dark).toBe(false);
    expect(state.meta).toBe(THEME_CHROME.light);
    expect(state.scheme).toBe("light");
  });

  test("a browser that blocks storage degrades to the OS, not to a crash", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new Error("storage disabled for this page");
        },
      });
    });
    await page.goto("/");
    // Reading localStorage throws outright here, inside the script responsible
    // for the first paint. The degraded answer is the OS, not white.
    const state = await page.evaluate(readThemeState);
    expect(state.dark).toBe(true);
    expect(state.meta).toBe(THEME_CHROME.dark);
    // And the app still hydrated: a blocked store costs persistence, not the page.
    await expect(page.getByRole("button", { name: /Launch the live product/i })).toBeVisible();
    expect(errors, `uncaught errors with storage blocked: ${errors.join("\n")}`).toEqual([]);
  });
});

test.describe("axe in the scheme that could never be reached", () => {
  test.use({ colorScheme: "dark", reducedMotion: "reduce" });

  /** The gate's floor: a moderate violation is reported by axe and printed, but
   *  only these two severities fail the run — the same law `accessibility.spec.ts`
   *  runs in light, so the two schemes are held to one bar and not to two. */
  const isSerious = (v: { impact?: unknown }) => v.impact === "serious" || v.impact === "critical";

  // The dark palette shipped unreachable, so no scan had ever looked at it.
  // Landing first: it is the page an investor opens, and the most colour.
  test("landing page in dark: no serious or critical violations", async ({ page }) => {
    await page.goto("/");
    expect((await page.evaluate(readThemeState)).dark).toBe(true);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const serious = results.violations.filter(isSerious);
    if (serious.length > 0) {
      console.log(
        "axe violations (landing, dark):",
        JSON.stringify(serious.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 5).map((n) => n.target) })), null, 2)
      );
    }
    expect(serious).toEqual([]);
  });

  test("Today tab in dark (status chips on a dark surface): no serious or critical violations", async ({ page }) => {
    // Seed so the chips exist: once every dose of the day is answered the
    // timeline loses the colour-coded states this scan is here for.
    const api = await request.newContext({ baseURL: BASE });
    expect((await api.post("/api/seed", { data: { force: true } })).ok()).toBeTruthy();
    const body = (await (await api.get("/api/plans")).json()) as {
      data: { doses?: { id: string; time: string; status: string }[] };
    };
    const pending = [...(body.data.doses ?? [])]
      .sort((a, b) => a.time.localeCompare(b.time))
      .filter((d) => d.status === "pending");
    expect(pending.length).toBeGreaterThanOrEqual(2);
    await api.post("/api/doses/action", { data: { doseId: pending[pending.length - 1].id, action: "taken" } });
    await api.post("/api/doses/action", { data: { doseId: pending[0].id, action: "skipped" } });
    await api.dispose();

    await page.goto("/");
    await page.getByRole("button", { name: /Launch the live product/i }).click();
    await expect(page.getByRole("heading", { name: "Vaidya workspace" })).toBeVisible();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByText("Earlier today")).toBeVisible();
    const state = await page.evaluate(readThemeState);
    expect(state.dark).toBe(true);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const serious = results.violations.filter(isSerious);
    if (serious.length > 0) {
      console.log(
        "axe violations (today, dark):",
        JSON.stringify(
          serious.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.slice(0, 8).map((n) => ({ target: n.target, failure: n.failureSummary })),
          })),
          null,
          2
        )
      );
    }
    expect(serious).toEqual([]);
  });

  /**
   * The rest of the product, in dark. RES-33 landed the palette and the landing +
   * Today pair proved the method, but six panels were walked in dark by hand and
   * left ungated — which is the shape this repository has been calling "measured,
   * not pinned". So they are scanned now, one page and six real clicks: each tab
   * is a client-side mount of a lazily-imported chunk, and waiting on
   * `aria-current` **plus** a panel-specific anchor is what stops this test from
   * scoring the shell twice and calling it coverage. The violations are collected
   * across all six and asserted once, because a failure should name every surface
   * that has it, not only the first one axe happened to reach.
   */
  test("the remaining workspace panels in dark: no serious or critical violations", async ({ page }) => {
    test.setTimeout(90_000); // six axe injections in one page, on a shared dev server
    const api = await request.newContext({ baseURL: BASE });
    // Seeded, so the panels show real content: an empty Insights is a card that
    // says "No analytics yet", and scanning that would prove nothing about a
    // heatmap's colours. Same reason the Today scan answers two doses first.
    expect((await api.post("/api/seed", { data: { force: true } })).ok()).toBeTruthy();
    await api.dispose();

    await page.goto("/");
    await page.getByRole("button", { name: /Launch the live product/i }).click();
    await expect(page.getByRole("heading", { name: "Vaidya workspace" })).toBeVisible();
    expect((await page.evaluate(readThemeState)).dark).toBe(true);

    // Verify is the panel the workspace opens on, so it is scanned before the
    // first click rather than being reached through the loop.
    const panels = [
      { tab: "Verify", anchor: page.locator("#rx-text"), click: false },
      { tab: "Review", anchor: page.getByText("Pharmacist review console"), click: true },
      { tab: "Insights", anchor: page.getByText("Adherence (14d)"), click: true },
      { tab: "Copilot", anchor: page.getByRole("textbox", { name: "Ask the copilot" }), click: true },
      { tab: "Family", anchor: page.getByText("Escalation law"), click: true },
      { tab: "Evidence", anchor: page.getByText("Deterministic safety engine — self-test"), click: true },
    ];

    const findings: Array<{ tab: string; id: string; impact: unknown; nodes: unknown[] }> = [];
    for (const { tab, anchor, click } of panels) {
      if (click) {
        await page.getByRole("button", { name: tab, exact: true }).click();
        await expect(page.getByRole("button", { name: tab, exact: true })).toHaveAttribute("aria-current", "page");
      }
      await expect(
        anchor,
        `the ${tab} panel never rendered — an axe scan of a surface that is not there is a pass about nothing`
      ).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      for (const v of results.violations.filter(isSerious)) {
        findings.push({ tab, id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 5).map((n) => n.target) });
      }
      // The scheme has to survive the tour: a panel that repaints the document
      // back to light would make every scan above a scan of the wrong palette.
      expect((await page.evaluate(readThemeState)).dark, `${tab}: the document left the dark scheme`).toBe(true);
    }

    if (findings.length > 0) {
      console.log("axe violations (workspace, dark):", JSON.stringify(findings, null, 2));
    }
    expect(findings).toEqual([]);
  });
});
