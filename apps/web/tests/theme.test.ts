/**
 * Theme law (bun test).
 *
 * The `.dark` palette in this app was dead code for as long as the design system
 * has existed: a full set of measured overrides with no control, no stored
 * preference and no `color-scheme` to apply them (RES-33). A dark-preference
 * visitor got light colours inside a browser chrome that `themeColor` had already
 * promised would be dark. So this file asserts what a screenshot cannot:
 *
 *   1. resolution — a stored choice beats the OS, and a corrupt stored value
 *      does not win at all. A hostile localStorage entry must not be able to put
 *      an arbitrary class on `<html>`.
 *   2. the boot script — it runs before React and is the only thing between first
 *      paint and the toggle, so its invariants (no `</`, no un-substituted
 *      template literal, storage read inside try/catch, whitelisted values only)
 *      are asserted as text.
 *   3. structure — every `.dark` override names a token `:root` declares, and the
 *      measured tokens exist in both schemes. The band tokens are the reverse:
 *      they must NOT appear in `.dark`, because the law section paints its own
 *      surface and would invert its own contrast if it followed the page.
 *   4. the ratios, recomputed from globals.css. `scripts/contrast.ts` prints the
 *      full report from literals the design was tuned against; this reads the
 *      stylesheet itself, so editing a colour fails a test instead of quietly
 *      making a documented number false.
 *   5. the wiring, including two name laws that came out of the two defects dark
 *      mode shipped with: a `-ink` token may never be a background, and a fill
 *      that `.dark` redefines must carry its own `-on` label colour — plus the
 *      typeface law, which keeps the mounted brand faces actually mounted and
 *      keeps the generated card inside the same palette (a display face that
 *      silently falls back is a design-system change nobody made, no screenshot
 *      tier runs on a contributor's machine, and the one surface a shared link
 *      shows is composed by a renderer that inherits no stylesheet at all).
 *
 * What this tier cannot see is on purpose elsewhere: it resolves no import and
 * renders nothing, so `e2e/theme.spec.ts` owns the first frame, the byte order,
 * Chromium's colour engine and axe in the dark scheme.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  alphaOver,
  contrastRatio,
  hexFromLch,
  mixOklch,
  rgbFromLch,
  type Lch,
  type Rgb,
} from "../scripts/palette";
import {
  DARK_CLASS,
  THEME_BOOT_SCRIPT,
  THEME_CHROME,
  THEME_STORAGE_KEY,
  isTheme,
  opposite,
  resolveTheme,
} from "@/lib/theme";

// ---- reading the stylesheet as the source of truth -------------------------

const CSS_PATH = resolve(import.meta.dir, "../src/app/globals.css");
const css = readFileSync(CSS_PATH, "utf8");

/** The body of one top-level rule block, braces counted (a nested `@media`
 *  inside a scheme would otherwise end the slice early). */
function blockOf(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`globals.css has no \`${selector} {}\` block`);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unbalanced braces after \`${selector}\``);
}

const ROOT_BODY = blockOf(":root");
const DARK_BODY = blockOf(".dark");

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

const SCHEMES = {
  light: declarations(ROOT_BODY),
  dark: declarations(DARK_BODY),
} as const;

/**
 * Resolve a custom property to the colour it paints, the way the cascade would:
 * `.dark` is an override layer, so a name it does not redeclare keeps its `:root`
 * value (`--vy-pine` is one of those — it stays deep because it is a fill).
 * `var()` indirection is followed, `oklch()` is parsed, and
 * `color-mix(in oklch, X p%, Y)` is mixed. Two schemes because a light
 * declaration that references `var(--card)` picks up the *dark* card when
 * `.dark` is on the same `<html>` element — which is why `--vy-watermark` is
 * declared twice.
 */
function raw(theme: keyof typeof SCHEMES, name: string): string {
  const value = SCHEMES[theme].get(name) ?? SCHEMES.light.get(name);
  if (!value) throw new Error(`${theme}: ${name} is not declared in either scheme`);
  return value;
}

function paint(theme: keyof typeof SCHEMES, name: string, seen = 0): Rgb {
  const value = raw(theme, name);
  if (seen > 4) throw new Error(`${theme}: ${name} recurses through var() — check the token chain`);
  const indirect = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  if (indirect) return paint(theme, indirect[1], seen + 1);
  const triple = /oklch\(\s*([-\d.e+]+)\s+([-\d.e+]+)\s+([-\d.e+]+)/.exec(value);
  if (triple) return rgbFromLch([Number(triple[1]), Number(triple[2]), Number(triple[3])] satisfies Lch);
  const mix = /color-mix\(in oklch,\s*var\((--[a-z0-9-]+)\)\s+(\d+(?:\.\d+)?)%,\s*var\((--[a-z0-9-]+)\)/.exec(value);
  if (mix) return mixOklch(lchOf(theme, mix[1]), lchOf(theme, mix[3]), Number(mix[2]) / 100);
  throw new Error(`${theme}: ${name} is a colour form this test does not model (${value})`);
}

function lchOf(theme: keyof typeof SCHEMES, name: string): Lch {
  const triple = /oklch\(\s*([-\d.e+]+)\s+([-\d.e+]+)\s+([-\d.e+]+)/.exec(raw(theme, name));
  if (triple) return [Number(triple[1]), Number(triple[2]), Number(triple[3])];
  // Only tokens with a direct oklch() value may be mixed. Anything else — a
  // `var()` chain or a nested mix — would need the whole cascade to resolve, and
  // guessing here would print a ratio that no browser would ever paint.
  throw new Error(`${theme}: ${name} must be an oklch() literal to be color-mix()ed in this test`);
}

const TEXT = 4.5; // 12–14px body and labels
const LARGE = 3.0; // 24px+ numerals, and non-text graphics (WCAG 1.4.11)

describe("palette is reachable", () => {
  test("every dark override names a token the light scheme declares", () => {
    // The RES-33 shape: a rule that nothing can apply. In a `.dark` block a name
    // `:root` never declared is either a typo or an orphan — both are dead code.
    const orphans = [...SCHEMES.dark.keys()].filter((name) => !SCHEMES.light.has(name));
    expect(orphans).toEqual([]);
  });

  test("both schemes say which palette they are", () => {
    // Without `color-scheme` a dark page keeps light scrollbars, form controls
    // and autofill chips, however good the CSS colours are.
    expect(/color-scheme:\s*light/.test(ROOT_BODY)).toBe(true);
    expect(/color-scheme:\s*dark/.test(DARK_BODY)).toBe(true);
  });

  test("the measured tokens exist in both schemes", () => {
    // Someone re-tidying globals.css can delete the dark status inks and every
    // browser test still passes, because light reads fine. These are the tokens
    // the dark report was measured against.
    for (const name of [
      "--vy-pine-ink",
      "--vy-severe",
      "--vy-warn",
      "--vy-safe",
      "--vy-severe-ink",
      "--vy-warn-ink",
      "--vy-safe-ink",
      "--vy-watermark",
      "--background",
      "--foreground",
      "--card",
      "--secondary",
      "--muted-foreground",
      "--ring",
      "--chart-1",
      "--chart-2",
    ]) {
      expect(SCHEMES.light.has(name), `:root must declare ${name}`).toBe(true);
      expect(SCHEMES.dark.has(name), `.dark must declare ${name}`).toBe(true);
    }
  });

  test("the law band is a fixed island in both schemes", () => {
    // The band carries its own background, so every colour on it is already a
    // dark-surface value. A `.dark` override would make it follow the page and
    // break its own contrast — which is what happened when it borrowed
    // `--vy-pine-ink`, a token `.dark` is entitled to redefine because that one
    // *is* page text. `--vy-band` is the name that may not be overridden.
    const island = [
      "--vy-band",
      "--vy-mint",
      "--vy-dark-ink",
      "--vy-dark-ink-soft",
      "--vy-panel",
      "--vy-panel-border",
      "--vy-clay-bright",
    ];
    for (const name of island) {
      expect(SCHEMES.light.has(name), `:root must declare ${name}`).toBe(true);
      expect(SCHEMES.dark.has(name), `.dark must NOT redefine the band token ${name}`).toBe(false);
      // And the island resolves to one colour, whoever is looking at it.
      expect(paint("dark", name)).toEqual(paint("light", name));
    }
  });

  test("a fill that flips in dark carries its own label colour", () => {
    // `--vy-safe` lifts from L 0.55 to L 0.72 so the hue still reads on a dark
    // card, which is what dropped white-on-green from 4.60 to 2.36. Any token
    // used as a button background *and* redefined in `.dark` needs an `-on`
    // partner, or every white label on it fails in one scheme.
    for (const fill of ["--vy-safe", "--vy-clay", "--vy-pine"]) {
      const label = `${fill}-on`;
      if (SCHEMES.dark.has(fill)) {
        expect(SCHEMES.light.has(label), `${fill} flips in .dark, so it needs ${label}`).toBe(true);
        expect(SCHEMES.dark.has(label), `${label} must flip with ${fill}`).toBe(true);
      }
    }
  });
});

describe("browser chrome follows the rendered scheme", () => {
  test("THEME_CHROME is the painted page background, not a remembered hex", () => {
    // This replaced a metadata block that claimed #fbfaf7 / #141614 — neither of
    // which is any token in the stylesheet. If the background moves, this fails.
    expect(THEME_CHROME.light).toBe(hexFromLch(lchOf("light", "--vy-paper")));
    expect(THEME_CHROME.dark).toBe(hexFromLch(lchOf("dark", "--background")));
    // The token the page actually paints, through whatever indirection the
    // scheme declares, is the token the chrome is allowed to claim.
    expect(paint("light", "--background")).toEqual(paint("light", "--vy-paper"));
    expect(paint("dark", "--background")).toEqual(rgbFromLch(lchOf("dark", "--background")));
  });
});

describe("measured contrast holds after any stylesheet edit", () => {
  for (const theme of ["light", "dark"] as const) {
    const card = paint(theme, "--card");
    const bg = paint(theme, "--background");
    const secondary = paint(theme, "--secondary");

    test(`${theme}: text on its surfaces clears 4.5:1`, () => {
      const pairs: Array<[string, Rgb, Rgb]> = [
        ["foreground on card", paint(theme, "--foreground"), card],
        ["foreground on background", paint(theme, "--foreground"), bg],
        ["card-foreground on card", paint(theme, "--card-foreground"), card],
        ["muted-foreground on card", paint(theme, "--muted-foreground"), card],
        ["muted-foreground on background", paint(theme, "--muted-foreground"), bg],
        ["muted-foreground on secondary", paint(theme, "--muted-foreground"), secondary],
        ["secondary-foreground on secondary", paint(theme, "--secondary-foreground"), secondary],
        ["pine-ink on card", paint(theme, "--vy-pine-ink"), card],
        ["severe ink on card", paint(theme, "--vy-severe-ink"), card],
        ["warn ink on card", paint(theme, "--vy-warn-ink"), card],
        ["safe ink on card", paint(theme, "--vy-safe-ink"), card],
        ["label on primary fill", paint(theme, "--primary-foreground"), paint(theme, "--primary")],
        ["label on safe fill", paint(theme, "--vy-safe-on"), paint(theme, "--vy-safe")],
        // The law band. `--vy-safe-on` and these four are the pairs dark mode
        // broke and the unit tier could not see: `--vy-safe` is lifted in `.dark`
        // to keep the hue legible as a *fill*, and the band was painted with a
        // token `.dark` lifts for text. Both are a foreground/background pair
        // that only exists once a component chooses the token, which is why the
        // rows below say so rather than living only in the browser scan.
        ["band heading on the band", paint(theme, "--vy-dark-ink"), paint(theme, "--vy-band")],
        ["band body on the band", paint(theme, "--vy-dark-ink-soft"), paint(theme, "--vy-band")],
        ["band eyebrow on the band", paint(theme, "--vy-mint"), paint(theme, "--vy-band")],
        ["panel text on the panel", paint(theme, "--vy-dark-ink"), paint(theme, "--vy-panel")],
        ["panel body on the panel", paint(theme, "--vy-dark-ink-soft"), paint(theme, "--vy-panel")],
        ["gate line on the panel", paint(theme, "--vy-clay-bright"), paint(theme, "--vy-panel")],
      ];
      for (const [label, fg, b] of pairs) {
        expect(contrastRatio(fg, b), `${theme}: ${label}`).toBeGreaterThanOrEqual(TEXT);
      }
    });

    test(`${theme}: graphics clear 3:1 against what they sit on`, () => {
      // Focus outlines and chart bars are non-text content (SC 1.4.11), so the
      // floor is 3:1 — but they had no floor at all before this slice.
      const graphics: Array<[string, Rgb, Rgb]> = [
        ["ring as focus outline", paint(theme, "--ring"), card],
        ["chart-1 bar on its track", paint(theme, "--chart-1"), secondary],
        ["chart-2 marker on its track", paint(theme, "--chart-2"), secondary],
        ["verify watermark", paint(theme, "--vy-watermark"), card],
      ];
      for (const [label, fg, b] of graphics) {
        expect(contrastRatio(fg, b), `${theme}: ${label}`).toBeGreaterThanOrEqual(LARGE);
      }
    });
  }

  test("the raw brand and severity hues are not text colours in every scheme", () => {
    // Asserted as floor-breakers on purpose. Deep pine is 2.42:1 on a dark card
    // and amber 2.94:1 on a white one — pairs that look like a colour choice, not
    // like a defect, to anyone tuning by eye. Lightening the *fill* hues to dodge
    // this would change what a CTA and a chart read as in both schemes, so the law
    // is "text uses the ink", not "the palette gets darker".
    const notText: Array<[keyof typeof SCHEMES, string, string]> = [
      ["dark", "--vy-pine", "--card"],
      ["light", "--vy-warn", "--card"],
    ];
    for (const [theme, fg, b] of notText) {
      expect(contrastRatio(paint(theme, fg), paint(theme, b)), `${theme}: ${fg} on ${b}`).toBeLessThan(TEXT);
    }
  });

  test("severity rules paint with an ink and stay legible on their own banner", () => {
    // `.vy-sev-*` is a class, so nothing in the component tree says which colour
    // carries a finding. Read the pairing out of the stylesheet instead: each rule
    // names a colour, `.vy-banner-*` mixes the matching hue into the card at some
    // percentage, and the label must clear 4.5:1 on both the plain card and the
    // tint. Change a percentage and this re-measures rather than trusting a
    // comment.
    const rules = [...css.matchAll(/\.vy-sev-([a-z]+)\s*\{\s*color:\s*var\((--[a-z0-9-]+)\);/g)]
      .map((m) => ({ label: m[1], ink: m[2] }));
    expect(rules.map((r) => r.label).sort()).toEqual(["moderate", "pass", "severe"]);

    for (const { label, ink } of rules) {
      expect(ink.endsWith("-ink"), `.vy-sev-${label} paints with ${ink}, not an ink`).toBe(true);
      const hue = ink.replace(/-ink$/, "");
      const banner = new RegExp(
        `\\.vy-banner-${label}\\s*\\{[^}]*color-mix\\(in oklch,\\s*var\\(${hue}\\)\\s+(\\d+(?:\\.\\d+)?)%,\\s*var\\(--card\\)\\)`,
      ).exec(css);
      expect(banner, `.vy-banner-${label} must mix ${hue} into var(--card)`).not.toBeNull();
      const percent = Number(banner![1]) / 100;
      for (const theme of ["light", "dark"] as const) {
        const tint = mixOklch(lchOf(theme, hue), lchOf(theme, "--card"), percent);
        const fg = paint(theme, ink);
        expect(contrastRatio(fg, tint), `${theme}: .vy-sev-${label} on .vy-banner-${label} (${percent * 100}% ${hue})`)
          .toBeGreaterThanOrEqual(TEXT);
        expect(contrastRatio(fg, paint(theme, "--card")), `${theme}: .vy-sev-${label} on a plain card`)
          .toBeGreaterThanOrEqual(TEXT);
      }
    }
  });

  test("a status ink is legible on its own chip tint", () => {
    // The chips are `color-mix(in oklch, var(--vy-X) p%, transparent)` over the
    // card, i.e. an alpha layer (percentages as painted in console.tsx).
    const chips: Array<[string, string, number]> = [
      ["--vy-safe-ink", "--vy-safe", 0.18],
      ["--vy-severe-ink", "--vy-severe", 0.12],
      ["--vy-warn-ink", "--vy-warn", 0.16],
    ];
    for (const theme of ["light", "dark"] as const) {
      const card = paint(theme, "--card");
      for (const [inkKey, tintKey, alpha] of chips) {
        const tint = alphaOver(paint(theme, tintKey), alpha, card);
        expect(contrastRatio(paint(theme, inkKey), tint), `${theme}: ${inkKey} on ${tintKey} tint`)
          .toBeGreaterThanOrEqual(TEXT);
      }
    }
  });
});

describe("theme resolution", () => {
  test("a stored choice beats the OS", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  test("nothing stored follows the OS", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme(undefined, true)).toBe("dark");
  });

  test("a corrupt or hostile stored value is treated as nothing stored", () => {
    // The value comes from localStorage, which is attacker-writable by anything
    // running on the origin. It must select a scheme, never become markup or a
    // class name.
    for (const junk of ["dark alert(1)", "", "system", "DARK", 123, {}, [], true, " light "]) {
      expect(isTheme(junk)).toBe(false);
      expect(["light", "dark"]).toContain(resolveTheme(junk, false));
      expect(["light", "dark"]).toContain(resolveTheme(junk, true));
    }
  });

  test("opposite is an involution over both schemes", () => {
    for (const theme of ["light", "dark"] as const) expect(opposite(opposite(theme))).toBe(theme);
  });
});

describe("boot script invariants", () => {
  /** It is a *string* rendered into a nonced inline script, executed by the
   *  browser and never by bun — so the only way to test it is as text. */
  const script = THEME_BOOT_SCRIPT;

  test("it is inert as markup", () => {
    expect(script.includes("</")).toBe(false); // would close the <script> early
    expect(script.includes("${")).toBe(false); // an un-substituted template hole
    expect(script.includes("document.write")).toBe(false);
    expect(script.includes("innerHTML")).toBe(false);
    expect(script.includes("eval")).toBe(false);
  });

  test("the stored value only ever selects between two literals", () => {
    // classList.toggle(DARK_CLASS, <boolean>) — the two-argument form. A future
    // edit to `classList.add(s)` would put localStorage into the class list.
    expect(script.includes(`classList.toggle("${DARK_CLASS}",t==="dark")`)).toBe(true);
    expect(/classList\.(add|remove|toggle)\(\s*s\s*[,)]/.test(script)).toBe(false);
    expect(script.includes('s==="light"||s==="dark"')).toBe(true);
  });

  test("it names the same key, class and chrome colours the app uses", () => {
    // The SSR default and the toggle read these from the same module; the script
    // is built from them, so a drift here means one of the three painters is
    // applying a scheme the others do not recognise.
    expect(script).toContain(`"${THEME_STORAGE_KEY}"`);
    expect(script).toContain(THEME_CHROME.light);
    expect(script).toContain(THEME_CHROME.dark);
    expect(script).toContain(DARK_CLASS);
  });

  test("a blocked storage API degrades to the OS preference, not to a throw", () => {
    expect(script.includes("try{")).toBe(true);
    expect(script.match(/catch/g)?.length).toBeGreaterThanOrEqual(2); // outer + the getItem
    expect(script.includes("localStorage.getItem")).toBe(true);
    expect(script.includes("prefers-color-scheme: dark")).toBe(true);
  });
});

describe("wiring", () => {
  const srcDir = resolve(import.meta.dir, "../src");
  const sourceFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const at = join(dir, entry.name);
      if (entry.isDirectory()) walk(at);
      else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) sourceFiles.push(at);
    }
  };
  walk(srcDir);

  /** App code only: `src/components/ui` is vendored shadcn-style markup, whose
   *  Radix-owned variables are not this palette's business. */
  const appFiles = sourceFiles.filter(
    (f) => f.endsWith(".tsx") && !f.includes(join("src", "components", "ui")),
  );

  /** A law about rendered elements has no business reading prose: comments are
   *  stripped so an explanatory "it asked for `Georgia`" cannot itself satisfy
   *  or break a rule about what the file paints. Trailing comments are left
   *  alone on purpose — stripping them means parsing, and a regex that eats
   *  `https://` inside a string would make these laws quietly weaker rather
   *  than stronger. */
  const markup = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  test("the layout mounts the boot script with the per-request nonce", () => {
    const layout = readFileSync(join(srcDir, "app/layout.tsx"), "utf8");
    // CSP here has no 'unsafe-inline' for scripts (TD-2), so a boot script
    // without the nonce is a boot script that does not run — and the flash comes
    // back with it.
    expect(layout).toContain("THEME_BOOT_SCRIPT");
    expect(layout).toContain("x-nonce"); // the proxy hands the nonce over on a header
    expect(layout).toContain("suppressHydrationWarning");
    expect(layout).toMatch(/themeColor:\s*THEME_CHROME\.light/);
    // The specifier is load-bearing, not stylistic: `headers` is a `next/headers`
    // export and `next/server` does not carry it in Next 16, so the layout threw
    // on the *first* document request — every page 500 — while all 23 of these
    // tests stayed green, because reading the file cannot resolve a module.
    expect(layout).toMatch(/import\s*\{[^}]*\bheaders\b[^}]*\}\s*from\s*"next\/headers"/);
    expect(layout).not.toMatch(/import\s*\{[^}]*\bheaders\b[^}]*\}\s*from\s*"next\/server"/);
  });

  test("every brand token app code paints is declared in :root", () => {
    const missing = new Set<string>();
    for (const file of appFiles) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/var\((--vy-[a-z0-9-]+)\)/g)) {
        if (!SCHEMES.light.has(m[1])) missing.add(`${m[1]} (${file.replace(srcDir, "")})`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  test("nothing paints the deep brand pine as text or as a focus ring", () => {
    // Measured at 2.42:1 on a dark card and 3.10:1 as an outline. Fills behind a
    // white label are fine and stay; the two forms below are the ones that failed.
    const offenders: string[] = [];
    for (const file of appFiles) {
      const text = readFileSync(file, "utf8");
      if (/color:\s*"var\(--vy-pine\)"/.test(text) || /ring-\[color:var\(--vy-pine\)\]/.test(text)) {
        offenders.push(file.replace(srcDir, ""));
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no structural token is ever painted as text", () => {
    // A border colour is defined to be quieter than the faintest text, so the
    // moment one is borrowed as a *type* colour the sentence is invisible rather
    // than understated. This is how "Queue clear" reached the review console: the
    // heading was set in `--vy-hairline`, the token the card's own border reads,
    // and measured about 1.2:1 on the light card — a headline describing an empty
    // queue that no one could see. The quiet text token is `--muted-foreground`,
    // which the rows above hold to 4.5:1 in both schemes.
    const STRUCTURAL = ["--vy-hairline", "--border", "--input", "--sidebar-border"];
    const offenders: string[] = [];
    for (const file of appFiles) {
      const text = markup(readFileSync(file, "utf8"));
      for (const token of STRUCTURAL) {
        const asText =
          new RegExp(`(?:^|[^a-zA-Z])color\\s*[:=]\\s*"[^"]*var\\(${token}\\)[^"]*"`).exec(text) ??
          new RegExp(`text-\\[[^\\]]*var\\(${token}\\)[^\\]]*\\]`).exec(text);
        if (asText) offenders.push(`${file.replace(srcDir, "")} → ${asText[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no app code paints an -ink token as a background", () => {
    // The whole defect class behind the dark-mode contrast failures: an `-ink`
    // token exists because `.dark` has to flip it, and a surface that borrows it
    // silently flips too — the law band went to 1.06:1 on mint-on-mint. Text
    // tokens go on text; fills get their own name (`--vy-band`, `--primary`).
    const offenders: string[] = [];
    for (const file of appFiles) {
      const text = readFileSync(file, "utf8");
      // The value is one quoted string, so the match ends with its closing
      // quote: `background: "transparent", color: "var(--vy-pine-ink)"` is a
      // legal chip and must not be reported. It matched on the first attempt at
      // this test, which is why the bound is a quote and not a comma.
      const quoted = /(?:background|backgroundColor)\s*[:=]\s*"[^"]*var\(--[a-z0-9-]*ink\)[^"]*"/.exec(text);
      const arbitrary = /bg-\[[^\]]*var\(--[a-z0-9-]*ink\)[^\]]*\]/.exec(text);
      const at = quoted ?? arbitrary;
      if (at) offenders.push(`${file.replace(srcDir, "")} → ${at[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  test("the storage key belongs to this module alone", () => {
    // The reminder delivery log shares this browser profile, so a second literal
    // for the same key is how one feature starts reading another's value.
    const owners = sourceFiles
      .filter((f) => readFileSync(f, "utf8").includes(`"${THEME_STORAGE_KEY}"`))
      .map((f) => f.replace(srcDir, "").replace(/\\/g, "/"));
    expect(owners).toEqual(["/lib/theme.ts"]);
  });

  test("the display and wordmark faces are mounted, not merely declared", () => {
    const layout = markup(readFileSync(join(srcDir, "app/layout.tsx"), "utf8"));
    // `--font-display` and `--font-devanagari` exist only on the element that
    // carries the class next/font mints. Drop one of them from the body
    // className and every `.vy-serif` surface in the product reverts to Georgia
    // while each individual file still reads correctly — a brand face that
    // disappears with the whole suite green is the failure this gate exists for.
    expect(layout).toMatch(/import\s*\{[^}]*\bFraunces\b[^}]*\}\s*from\s*"next\/font\/google"/);
    expect(layout).toMatch(/import\s*\{[^}]*\bRozha_One\b[^}]*\}\s*from\s*"next\/font\/google"/);
    expect(layout).toMatch(/Fraunces\(\{[\s\S]*?variable:\s*"--font-display"/);
    expect(layout).toMatch(/Rozha_One\(\{[\s\S]*?variable:\s*"--font-devanagari"/);
    const body = /className=\{`([^`]*)`\}/.exec(layout);
    if (!body) throw new Error("layout.tsx no longer builds the body className as one template");
    for (const ref of ["geistSans", "geistMono", "fraunces", "rozha"]) {
      expect(body[1]).toContain(`${ref}.variable`);
    }
  });

  test("the serif chain resolves through the mounted variable and keeps a real serif under it", () => {
    const serif = blockOf(".vy-serif");
    const family = /font-family\s*:\s*([^;]+);/.exec(serif)?.[1].trim() ?? "";
    expect(family.startsWith("var(--font-display)")).toBe(true);
    // next/font resolves its file at build time, so an offline build has no font
    // at all; the chain has to end in a face the machine already has, and it has
    // to end in a *serif* — falling back to the body sans would change the
    // product's voice on a bad network day.
    expect(family).toContain("Georgia");
    expect(family).toMatch(/serif\s*$/);
    expect(serif).toContain("font-optical-sizing: auto");
    // The hero's character comes from two Fraunces-only axes. `opsz` has to be
    // spelled out inside `font-variation-settings` because that shorthand resets
    // every axis it does not name, which would silently undo the optical sizing
    // on the one line that depends on it most.
    const display = blockOf(".vy-display");
    expect(display).toMatch(/font-variation-settings:[^;]*"opsz"\s+\d+/);
    expect(display).toMatch(/font-variation-settings:[^;]*"WONK"\s+1/);
  });

  test("every rendered wordmark asks for the Devanagari face", () => {
    const WORDMARK = "वैद्य";
    // `next/og` composes its card from the fonts it hands to ImageResponse and
    // has no stylesheet to inherit from, so the generated card is outside a CSS
    // law by construction rather than by exemption.
    const carriers = appFiles
      .filter((f) => !f.endsWith("opengraph-image.tsx"))
      .filter((f) => markup(readFileSync(f, "utf8")).includes(WORDMARK));
    expect(carriers.length).toBeGreaterThanOrEqual(2);
    for (const file of carriers) {
      const text = markup(readFileSync(file, "utf8"));
      for (let at = text.indexOf(WORDMARK); at >= 0; at = text.indexOf(WORDMARK, at + WORDMARK.length)) {
        const open = Math.max(text.lastIndexOf("<span", at), text.lastIndexOf("<div", at));
        if (open < 0) throw new Error(`${file}: a wordmark with no opening tag before it`);
        expect(text.slice(open, at)).toContain("vy-devanagari");
      }
    }
    // …and the class has to resolve, or the loop above only proves intent.
    expect(blockOf(".vy-devanagari")).toContain("var(--font-devanagari)");
  });

  test("the generated card paints faces and colours the product actually owns", () => {
    const card = markup(readFileSync(join(srcDir, "app/opengraph-image.tsx"), "utf8"));
    // The card is composed by satori, which inherits no stylesheet: a family it
    // was not handed is painted in the runtime's bundled sans without a word
    // about it, and a hex is a frozen transcription of whatever the palette said
    // the day the file was written. Both were true at once — the file claimed a
    // Georgia serif it never received, and shipped five colours the theme pass
    // had already retired (`#0b6b5d` where `--vy-pine` resolves to `#0f6353`).
    const registered = [...card.matchAll(/\bname:\s*"([^"]+)"/g)].map((m) => m[1]);
    const painted = new Set([...card.matchAll(/fontFamily:\s*"([^"]+)"/g)].map((m) => m[1]));
    expect([...painted].filter((f) => !registered.includes(f))).toEqual([]);
    // …and a face registered but never painted is licence-encumbered bytes in
    // the image for nothing.
    expect(registered.filter((n) => !painted.has(n))).toEqual([]);
    for (const file of [...card.matchAll(/\bfile:\s*"([^"]+\.ttf)"/g)].map((m) => m[1])) {
      expect(existsSync(resolve(srcDir, "app", "fonts", file))).toBe(true);
      // Bundled, not fetched: a card that depends on a network call at render
      // time is a card that fails on the request it is meant to survive.
      expect(card).not.toContain("fonts.googleapis.com");
      expect(card).not.toContain("fetch(");
    }
    // The faces ship bytes, so the licence ships with them, and the standalone
    // server's cwd is not the source tree — the tracer has to be told.
    const fontDir = resolve(srcDir, "app", "fonts");
    const shipped = readdirSync(fontDir);
    const faces = shipped.filter((f) => f.endsWith(".ttf"));
    expect(faces.length).toBeGreaterThanOrEqual(2);
    // One licence per face: distributing OFL bytes without the notice beside
    // them is the clause the licence is actually there to protect.
    expect(shipped.filter((f) => f.endsWith(".txt")).length).toBe(faces.length);
    for (const licence of shipped.filter((f) => f.endsWith(".txt"))) {
      expect(readFileSync(join(fontDir, licence), "utf8")).toContain("SIL OPEN FONT LICENSE");
    }
    const config = readFileSync(resolve(srcDir, "..", "next.config.ts"), "utf8");
    expect(config).toContain("outputFileTracingIncludes");
    expect(config).toContain("./src/app/fonts/**");

    const owned = new Set<string>();
    for (const value of declarations(ROOT_BODY).values()) {
      const lch = /^oklch\(([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\)$/.exec(value);
      if (lch) owned.add(hexFromLch([+lch[1], +lch[2], +lch[3]] as Lch).toLowerCase());
    }
    const strays = [...card.matchAll(/"(#[0-9a-fA-F]{6})"/g)]
      .map((m) => m[1].toLowerCase())
      .filter((hex) => !owned.has(hex));
    expect(strays).toEqual([]);

    // The oversized claim is the hero's line, so it takes the hero's metrics —
    // transcribing them here instead of reading them is how the two would part.
    const display = blockOf(".vy-display");
    for (const [jsx, css] of [
      ["lineHeight", "line-height"],
      ["letterSpacing", "letter-spacing"],
    ] as const) {
      const value = new RegExp(`${css}:\\s*([^;]+);`).exec(display)?.[1].trim();
      if (!value) throw new Error(`.vy-display declares no ${css}`);
      // satori takes a unitless number or a string, so either spelling is the
      // same claim; what would be a lie is a third value.
      expect(card.includes(`${jsx}: "${value}"`) || card.includes(`${jsx}: ${value}`)).toBe(true);
    }
  });
});
