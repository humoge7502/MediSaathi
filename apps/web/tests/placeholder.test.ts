/**
 * Placeholder law (bun test) — what a panel shows before it has anything.
 *
 * The five data panels each opened with a hairline card containing one pulsing
 * sentence ("Loading today…", "Running the engine suite…"). Two of the defects
 * that carried are certain and one is bounded: `animate-pulse` takes a node to
 * 50% opacity mid-cycle, so the pulse was prose falling under the AA floor for a
 * third of every second; a screen reader read the sentence and then read the
 * panel that replaced it; and the layout shift everyone assumes a skeleton fixes
 * turned out to be floored by `main { min-h-screen }` — measured at 1 280×720,
 * the one-line card held the document at 720 px and the skeletons hold it at
 * 800, against 1 590 loaded. The claim this tier can actually defend is column
 * alignment and silence, so those are the claims it makes.
 *
 * The rule the panels follow now:
 *
 *   1. a placeholder is geometry, and the geometry is the loaded panel's own —
 *      sizes are passed in by the panel, because the honest thing about a
 *      placeholder is that it is not a sentence.
 *   2. nothing a panel renders while loading is text. `aria-hidden` on the
 *      shapes, `aria-busy` on the shell.
 *   3. an empty state is a card with a name and an exit, and it comes from the
 *      shared primitive — the four hand-written ones had already drifted apart,
 *      and one of them set its headline in the card's own border colour.
 *   4. entrance motion transitions rather than keyframes, and never leaves
 *      residue: `animation: … both` keeps `transform` computed on the node after
 *      the last frame, which silently makes it a containing block.
 *
 * Like the status-message tier, this proves the DOM and CSS contract, not the
 * experience: `e2e/accessibility.spec.ts` is where a real browser measures it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

const SRC = resolve(import.meta.dir, "../src");
const COMPONENTS = join(SRC, "components");
const CSS_PATH = join(SRC, "app", "globals.css");
const SKELETON = join(COMPONENTS, "ui", "skeleton.tsx");
const EMPTY = join(COMPONENTS, "ui", "empty-state.tsx");

/** JSX/TS comments removed, so a docblock can never satisfy a structural gate. */
function markup(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/** Every component file except the two primitives being tested. */
const PANELS = walk(COMPONENTS)
  .filter((p) => p !== SKELETON && p !== EMPTY)
  .map((p) => [p, markup(readFileSync(p, "utf8"))] as const);

/** A card whose entire content is one ellipsis-ended sentence about waiting. */
const LOADING_PROSE = />\s*(?:Loading|Running|Fetching|Warming) [^<]*[…]\s*</;

describe("a placeholder is geometry, not prose", () => {
  test("the pulse lives in exactly one file", () => {
    const pulsing = PANELS.filter(([, src]) => /animate-pulse/.test(src)).map(([p]) => p);
    // ...and the one file allowed to pulse is the primitive, not a panel.
    expect(pulsing).toEqual([]);
    expect(markup(readFileSync(SKELETON, "utf8"))).toContain("animate-pulse");
  });

  test("no panel still renders a sentence as its loading state", () => {
    const offenders = PANELS.filter(([, src]) => LOADING_PROSE.test(src));
    expect(offenders.map(([p]) => p)).toEqual([]);
  });

  test("a panel that waits for data draws the loaded layout", () => {
    // The point of a skeleton is the height it reserves, so the gate is that a
    // loading branch imports the primitive at all — otherwise the next panel
    // written can quietly go back to a spinner and the suite stays green.
    const waiting = PANELS.filter(([, src]) => /\bif \((!data|loading|!open)\)/.test(src));
    expect(waiting.length).toBeGreaterThanOrEqual(5);
    for (const [path, src] of waiting) {
      expect(src, `${path}: waits for data without reserving its shape`).toContain("@/components/ui/skeleton");
    }
  });

  test("a skeleton block is invisible to assistive tech and says nothing", () => {
    const html = renderToStaticMarkup(createElement(Skeleton, { className: "h-4 w-24" }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/>[^<]+</); // no text node at all
    const shell = renderToStaticMarkup(createElement(SkeletonCard, null, createElement(Skeleton, { className: "h-4" })));
    expect(shell).toContain('aria-busy="true"');
  });

  test("the fill is mixed from a per-scheme pair, not a fixed grey", () => {
    // A literal colour in the stylesheet survives neither scheme: --muted sits 18
    // lightness steps apart in light and dark, which is why the fill mixes the
    // *foreground* hue into the card instead of borrowing either.
    const rule = /\.vy-skeleton\s*\{([^}]*)\}/.exec(readFileSync(CSS_PATH, "utf8"))?.[1] ?? "";
    expect(rule).toContain("color-mix");
    expect(rule).toContain("var(--muted-foreground)");
    expect(rule).toContain("var(--card)");
    expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe("an empty state is one card, not four", () => {
  test("no panel hand-builds the empty card again", () => {
    // The signature of the old duplicates: a hairline card that is a centred
    // flex column with a min-height. Two panels had exactly this — `flex min-h-64
    // flex-col items-center`, one `flex` not two — and one of them painted the
    // headline in the border colour. The first version of this gate asked for
    // `flex flex-col`, matched nothing, and passed while the falsification was
    // sitting in front of it.
    const offenders = PANELS.filter(([, src]) => /min-h-64[^"]*flex-col/.test(src));
    expect(offenders.map(([p]) => p)).toEqual([]);
  });

  test("the card is content: named, readable, and not hidden from assistive tech", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { title: "No analytics yet" }, createElement("em", null, "Start therapy plan"))
    );
    expect(html).toContain("No analytics yet");
    expect(html).toContain("<em>Start therapy plan</em>");
    expect(html).not.toContain('aria-hidden="true"');
    expect(html).toContain("vy-hairline-card");
  });

  test("an empty card names the way out", () => {
    // Empty without a route is a dead end: the copy has to point at the action
    // that fills the panel, which is the one thing the four variants disagreed on.
    const users = PANELS.filter(([, src]) => /<EmptyState\s/.test(src));
    expect(users.length).toBeGreaterThanOrEqual(2);
    for (const [path, src] of users) {
      const block = /<EmptyState\s+title="([^"]+)"[^>]*>([\s\S]*?)<\/EmptyState>/.exec(src);
      expect(block, `${path}: an EmptyState whose body is not inline copy`).toBeTruthy();
      const exit = /tab|press|Start|Run|Link|check in|reset/i;
      expect(block![2], `${path}: an empty state with no way out`).toMatch(exit);
    }
  });
});

describe("entrance motion leaves nothing behind", () => {
  const css = readFileSync(CSS_PATH, "utf8");

  test("the panel entrance is a @starting-style transition, not a keyframe", () => {
    const rule = /\.vy-enter\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("transition:");
    expect(rule).not.toContain("animation");
    const starting = /@starting-style\s*\{\s*\.vy-enter\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(starting).toContain("opacity: 0");
    expect(starting).toContain("transform: translateY(");
  });

  test("the wrapper that animates remounts per panel", () => {
    // `@starting-style` fires on a node's first style resolution. A wrapper that
    // outlives the panels it swaps would animate once and never again, so the key
    // is part of the mechanism, not decoration.
    const workspace = markup(readFileSync(join(COMPONENTS, "workspace.tsx"), "utf8"));
    expect(/<div\s+key=\{tab\}\s+className="vy-enter/.test(workspace)).toBe(true);
  });

  test("reduced motion collapses it", () => {
    // The universal guard already clamps transition-duration; assert it still
    // covers transitions, because `.vy-enter` is the first entrance built out of
    // one rather than the keyframe classes the guard listed by name.
    const guard = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(guard).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(guard).toMatch(/\*,\s*\*::before,\s*\*::after/);
  });
});
