/**
 * Contrast report for the Vaidya palette — light and dark.
 *
 * The maths (OKLCH→sRGB, the two compositing models, the ratio) lives in
 * `scripts/palette.ts`, because `tests/theme.test.ts` uses the same conversion
 * to prove the chrome hex values in `src/lib/theme.ts` still match the CSS
 * tokens. Read that file's header for why there are two compositing models.
 *
 * Prints the ratio axe will measure, for the pairs the chips, banners, numerals
 * and bars actually use.
 *
 *   bun scripts/contrast.ts
 */
import { alphaOver, contrastRatio, type Lch, mixOklch, oklchToRgb, rgbFromLch, type Rgb } from "./palette";

const tok = (L: number, C: number, H: number) => oklchToRgb(L, C, H);
const lch = (L: number, C: number, H: number): Lch => [L, C, H];
/** Convert a palette entry to RGB (an identity mix — no other colour involved). */
const c = rgbFromLch;
/** `color-mix(in oklch, A p%, B)` as RGB. */
const mixRgb = mixOklch;
/** An alpha layer over the card, as the chip tints paint it. */
const over = alphaOver;

const WHITE = lch(1, 0, 0);
const PAPER = lch(0.975, 0.004, 90);
const card = tok(1, 0, 0);

// ---- light scheme palette (mirrors `:root` in globals.css) ----
const LI = {
  pine: lch(0.45, 0.08, 175),
  pineInk: lch(0.32, 0.06, 175),
  clay: lch(0.55, 0.13, 55),
  severe: lch(0.5, 0.17, 25),
  warn: lch(0.68, 0.13, 75),
  safe: lch(0.55, 0.11, 155),
  severeInk: lch(0.42, 0.17, 25),
  warnInk: lch(0.45, 0.12, 75),
  safeInk: lch(0.42, 0.11, 155),
  safeOn: lch(1, 0, 0),
  mutedFg: lch(0.47, 0.012, 160),
  secondary: lch(0.955, 0.006, 95),
  card: WHITE,
};

// ---- dark scheme palette (mirrors `.dark`, including its ink overrides) ----
const DARK_BG = lch(0.18, 0.01, 160);
const DARK_CARD = lch(0.22, 0.012, 160);
const D = {
  pine: lch(0.45, 0.08, 175), // fills keep the deep brand hue in both schemes
  pineInk: lch(0.82, 0.07, 175),
  ring: lch(0.75, 0.09, 175),
  severe: lch(0.65, 0.16, 25),
  warn: lch(0.78, 0.13, 75),
  safe: lch(0.72, 0.12, 155),
  severeInk: lch(0.74, 0.14, 25),
  warnInk: lch(0.84, 0.11, 75),
  safeInk: lch(0.8, 0.1, 155),
  safeOn: lch(0.2, 0.01, 160),
  clay: lch(0.55, 0.13, 55),
  mutedFg: lch(0.7, 0.01, 160),
  foreground: lch(0.96, 0.005, 90),
  secondary: lch(0.26, 0.012, 160),
  chart1: lch(0.75, 0.09, 175),
  chart2: lch(0.7, 0.12, 55),
};

// The law band (`landing.tsx` section 03) is a fixed island: `--vy-band` and the
// tokens that sit on it are declared once in `:root` and never overridden in
// `.dark`, so these rows are the contract in both schemes. `--vy-band` exists
// because the band pointed at `--vy-pine-ink` — a TEXT ink that `.dark` lifts
// from L 0.32 to L 0.82 — and the rows below that say "band" are what the axe
// dark scan measured once the island got its own colour.
const BAND = {
  band: lch(0.32, 0.06, 175),
  panel: lch(0.27, 0.02, 170),
  mint: lch(0.8, 0.09, 175),
  ink: lch(0.96, 0.005, 90),
  inkSoft: lch(0.85, 0.01, 90),
  clayBright: lch(0.78, 0.13, 75),
};

const cases: [string, Rgb, Rgb, number][] = [
  // [name, foreground, background, needed]
  ["taken chip, safe on 18% safe", tok(0.55, 0.11, 155), over(tok(0.55, 0.11, 155), 0.18, card), 4.5],
  ["taken chip, safe-ink candidate 0.42", tok(0.42, 0.11, 155), over(tok(0.55, 0.11, 155), 0.18, card), 4.5],
  ["taken chip, safe-ink candidate 0.40", tok(0.4, 0.11, 155), over(tok(0.55, 0.11, 155), 0.18, card), 4.5],
  ["missed chip, severe on 12% severe", tok(0.5, 0.17, 25), over(tok(0.5, 0.17, 25), 0.12, card), 4.5],
  ["missed chip, severe-ink 0.42", tok(0.42, 0.17, 25), over(tok(0.5, 0.17, 25), 0.12, card), 4.5],
  ["skipped chip, warn on 16% warn", tok(0.68, 0.13, 75), over(tok(0.68, 0.13, 75), 0.16, card), 4.5],
  ["skipped chip, warn-ink 0.45", tok(0.45, 0.12, 75), over(tok(0.68, 0.13, 75), 0.16, card), 4.5],
  ["skipped chip, warn-ink 0.42", tok(0.42, 0.12, 75), over(tok(0.68, 0.13, 75), 0.16, card), 4.5],
  ["pending chip, muted on secondary", tok(0.47, 0.012, 160), tok(0.955, 0.006, 95), 4.5],
  ["muted body text on card", tok(0.47, 0.012, 160), card, 4.5],
  ["muted body text on paper", tok(0.47, 0.012, 160), c(PAPER), 4.5],
  ["muted at 80% opacity over card", over(tok(0.47, 0.012, 160), 0.8, card), card, 4.5],
  ["pine on 6% pine band (eyebrow)", tok(0.32, 0.06, 175), over(tok(0.45, 0.08, 175), 0.06, card), 4.5],
  // Cross-checks against what axe measured on the running page (2.71 and 4.19).
  ["taken chip inside opacity-80", over(tok(0.55, 0.11, 155), 0.8, card), over(over(tok(0.55, 0.11, 155), 0.18, card), 0.8, card), 0],
  ["muted text inside opacity-80", over(tok(0.47, 0.012, 160), 0.8, card), card, 0],
  // The decorative prescription watermark in `verify.tsx` (5xl serif,
  // aria-hidden but still scanned by axe): large text, so the floor is 3:1.
  ["light: watermark pine 75% into card", mixRgb(LI.pine, LI.card, 0.75), c(LI.card), 3],

  // ---------- the law band: identical in both schemes ----------
  ["band: eyebrow (mint)", c(BAND.mint), c(BAND.band), 4.5],
  ["band: heading (dark-ink)", c(BAND.ink), c(BAND.band), 3],
  ["band: body (dark-ink-soft)", c(BAND.inkSoft), c(BAND.band), 4.5],
  ["band: gate line (clay-bright) on panel", c(BAND.clayBright), c(BAND.panel), 4.5],
  ["band: heading (dark-ink) on panel", c(BAND.ink), c(BAND.panel), 4.5],
  ["band: body (dark-ink-soft) on panel", c(BAND.inkSoft), c(BAND.panel), 4.5],
  // The button the dark scheme almost broke: `--vy-safe` is a FILL here, and
  // `.dark` lifts it to L 0.72 so the hue still reads, which is why the label
  // colour is its own token rather than `text-white`.
  ["light: Taken label (safe-on) on safe fill", c(LI.safeOn), c(LI.safe), 4.5],
  ["dark: Taken label (safe-on) on safe fill", c(D.safeOn), c(D.safe), 4.5],

  // ---------- dark scheme ----------
  // The `.dark` block existed for months with no way to reach it (RES-33), so
  // none of these pairs were ever gated. Now that a toggle applies the class,
  // every row below is a pair the axe dark scan also measures in the browser;
  // the light-theme ink values all fail here, which is exactly why `.dark`
  // carries its own status family.
  ["dark: foreground on background", c(D.foreground), c(DARK_BG), 4.5],
  ["dark: foreground on card", c(D.foreground), c(DARK_CARD), 4.5],
  ["dark: eyebrow (pine-ink) on background", c(D.pineInk), c(DARK_BG), 4.5],
  ["dark: eyebrow (pine-ink) on card", c(D.pineInk), c(DARK_CARD), 4.5],
  ["dark: muted-foreground on card", c(D.mutedFg), c(DARK_CARD), 4.5],
  ["dark: muted-foreground on background", c(D.mutedFg), c(DARK_BG), 4.5],
  ["dark: muted-foreground on secondary", c(D.mutedFg), c(D.secondary), 4.5],
  // Chips: `color-mix(… , transparent)` over the card, so the tint is an alpha
  // layer (over) whose base is the card, and the ink sits on that.
  ["dark: taken chip, safe-ink on 18% safe", c(D.safeInk), over(c(D.safe), 0.18, c(DARK_CARD)), 4.5],
  ["dark: missed chip, severe-ink on 12% severe", c(D.severeInk), over(c(D.severe), 0.12, c(DARK_CARD)), 4.5],
  ["dark: skipped chip, warn-ink on 16% warn", c(D.warnInk), over(c(D.warn), 0.16, c(DARK_CARD)), 4.5],
  ["dark: sev-severe text on card", c(D.severe), c(DARK_CARD), 4.5],
  ["dark: sev-moderate text on card", c(D.warn), c(DARK_CARD), 4.5],
  ["dark: sev-pass text on card", c(D.safe), c(DARK_CARD), 4.5],
  // Banners are oklch mixes into the card, not alpha layers — mixRgb models it.
  ["dark: sev-severe on 8% severe banner", c(D.severe), mixRgb(D.severe, DARK_CARD, 0.08), 4.5],
  ["dark: sev-moderate on 12% warn banner", c(D.warn), mixRgb(D.warn, DARK_CARD, 0.12), 4.5],
  ["dark: sev-pass on 9% safe banner", c(D.safe), mixRgb(D.safe, DARK_CARD, 0.09), 4.5],
  ["dark: banner body (foreground) on 8% severe", c(D.foreground), mixRgb(D.severe, DARK_CARD, 0.08), 4.5],
  ["dark: neutral band body on 6% pine banner", c(D.foreground), mixRgb(D.pine, DARK_CARD, 0.06), 4.5],
  // 3xl–4xl display numerals coloured by a status or brand hue (large-text floor).
  ["dark: clay numeral (console open count)", c(D.clay), c(DARK_BG), 3],
  ["dark: pine-as-text numeral — the value this slice replaced", c(D.pine), c(DARK_CARD), 3],
  ["dark: pine-ink numeral on card", c(D.pineInk), c(DARK_CARD), 3],
  ["dark: ring/primary as focus outline on card (3:1 non-text)", c(D.ring), c(DARK_CARD), 3],
  ["dark: chart-1 bar on secondary track (3:1 non-text)", c(D.chart1), c(D.secondary), 3],
  ["dark: chart-2 marker on secondary track", c(D.chart2), c(D.secondary), 3],
  ["dark: deep pine bar on secondary track", c(D.pine), c(D.secondary), 3],
  ["dark: watermark pine-ink 60% into card", mixRgb(D.pineInk, DARK_CARD, 0.6), c(DARK_CARD), 3],
  ["dark: white on pine CTA fill (unchanged pair)", tok(1, 0, 0), c(D.pine), 4.5],
  // The "before" rows: what the light-theme inks measure on a dark surface.
  // Quoted in the globals.css comment beside the overrides.
  ["dark-before: light pine-ink 0.32 as eyebrow", c(LI.pineInk), c(DARK_BG), 4.5],
  ["dark-before: light safe-ink 0.42 on 18% safe", c(LI.safeInk), over(c(D.safe), 0.18, c(DARK_CARD)), 4.5],
  ["dark-before: light severe-ink 0.42 on 12% severe", c(LI.severeInk), over(c(D.severe), 0.12, c(DARK_CARD)), 4.5],
  ["dark-before: light warn-ink 0.45 on 16% warn", c(LI.warnInk), over(c(D.warn), 0.16, c(DARK_CARD)), 4.5],
  ["dark-before: light watermark formula (pine 75% into dark card)", mixRgb(D.pine, DARK_CARD, 0.75), c(DARK_CARD), 3],
  // The two defects dark mode actually shipped with, both found by the axe scan
  // in `e2e/theme.spec.ts` and both the same mistake: a token `.dark` redefines
  // used as a BACKGROUND. Quoted so the numbers stay in the record.
  ["dark-before: band painted with the pine TEXT ink — mint on it", c(BAND.mint), c(D.pineInk), 4.5],
  ["dark-before: band painted with the pine TEXT ink — heading on it", c(BAND.ink), c(D.pineInk), 4.5],
  ["dark-before: band painted with the pine TEXT ink — body on it", c(BAND.inkSoft), c(D.pineInk), 4.5],
  ["dark-before: white on the dark-scheme safe fill", tok(1, 0, 0), c(D.safe), 4.5],
];

for (const [name, fg, bg, needed] of cases) {
  const r = contrastRatio(fg, bg);
  console.log(`${r >= needed ? "PASS" : "FAIL"}  ${r.toFixed(2).padStart(5)}  ${name}`);
}
