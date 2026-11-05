/**
 * Status-message law (bun test) — WCAG 2.1 SC 4.1.3 (Status Messages).
 *
 * Eight surfaces in this product write to the server, and before this pass a
 * listener heard nothing from any of them: the guardrail that refuses a double
 * dose appeared in a card that mounted with its own text (rule 1 — a live region
 * announces text that changed inside a node the accessibility tree already had,
 * so a region and its first sentence in the same commit is the case screen
 * readers are documented to skip); the copilot transcript was not a `log`, so an
 * answer arriving below the aural cursor simply did not happen; the seed hint
 * lived only in a button's `title`; one caregiver flow displayed a join code
 * exactly once and never said it, which means a blind user could invite a
 * caregiver and could not complete it; the reminders card had a server error
 * string in its view model and rendered none of it, so a rejected settings write
 * looked like a control that had not been tapped; and `verify.tsx` had the
 * opposite bug — `aria-live` on the whole verdict column, re-reading every
 * medicine and finding on each mutation inside it.
 *
 * So this file asserts:
 *
 *   1. the primitive outlives its message — an empty region is still in the
 *      accessibility tree, and collapsing is done with height, never `display`.
 *   2. tone is a component choice, not a prop flipped on a live node.
 *   3. no panel is a live region it should not be: `aria-live` belongs to the
 *      primitive and to the copilot log, and every live region stays short
 *      enough to be a sentence rather than a transcript.
 *   4. every file that writes announces, and every failure it can show is
 *      assertive — including the one that used to be a policy answer parked in
 *      the error channel.
 *   5. no catch block in the UI layer is empty. A failure the user cannot see is
 *      a failure they will repeat.
 *
 * What this tier cannot do is prove a screen reader speaks the line: that needs
 * a real AT. It proves the DOM contract the AT reads — `e2e/accessibility.spec.ts`
 * adds the mutation and measures the region's length in the browser.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AlertLine, StatusLine } from "@/components/ui/status-line";

const COMPONENTS = resolve(import.meta.dir, "../src/components");
const PRIMITIVE = join(COMPONENTS, "ui", "status-line.tsx");

/** JSX/TS comments removed, so a docblock can never satisfy a structural gate. */
function markup(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Every `.tsx` under src/components except the primitive itself. */
function panelFiles(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".tsx") && path !== PRIMITIVE) out.set(path, markup(readFileSync(path, "utf8")));
    }
  };
  walk(COMPONENTS);
  return out;
}

const PANELS = panelFiles();

/** The opening tag an offset sits inside: from the last `<` before it that starts
 *  a tag, to the matching `>`. Attribute values are quoted, and a `>` inside a
 *  string literal (`<p>…{"a > b"}</p>`) would end the slice early, so quotes are
 *  skipped while scanning. */
function enclosingTag(src: string, offset: number): string {
  let start = -1;
  for (let i = offset - 1; i >= 0; i--) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") continue;
    if (c === "<") {
      start = i;
      break;
    }
  }
  if (start < 0) throw new Error(`no opening tag before offset ${offset}`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unterminated tag at offset ${start}`);
}

/** The body of the block that follows an offset, braces counted. */
function blockBody(src: string, openBrace: number): string {
  let depth = 0;
  for (let i = openBrace; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return src.slice(openBrace + 1, i);
  }
  throw new Error(`unbalanced block at ${openBrace}`);
}

describe("the live region outlives its message", () => {
  test("an empty region is still in the accessibility tree", () => {
    const html = renderToStaticMarkup(createElement(StatusLine, { text: null }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    // Collapsed by height, not by removal: `display:none` and the `hidden`
    // attribute both take the node out of the tree and put the bug back.
    expect(html).toContain("h-0");
    expect(html).not.toMatch(/display:\s*none/);
    expect(html).not.toMatch(/\bhidden\b/);
    expect(html).not.toMatch(/aria-hidden/);
  });

  test("the assertive variant interrupts and the polite one does not", () => {
    const status = renderToStaticMarkup(createElement(StatusLine, { text: "Marked taken." }));
    const alert = renderToStaticMarkup(createElement(AlertLine, { text: "Guardrail refused this action." }));
    expect(status).toContain('aria-live="polite"');
    expect(status).toContain("Marked taken.");
    expect(status).not.toMatch(/\bh-0\b/);
    expect(alert).toContain('role="alert"');
    expect(alert).toContain('aria-live="assertive"');
    expect(alert).toContain("Guardrail refused this action.");
    // Two different roles: one component flipping `role` on a node already in
    // the tree is not something assistive tech is obliged to re-register.
    expect(status).not.toContain('role="alert"');
    expect(alert).not.toContain('aria-live="polite"');
  });

  test("tone is a component, not a prop", () => {
    const src = markup(readFileSync(PRIMITIVE, "utf8"));
    expect(src).not.toMatch(/\btone\b/);
    expect(src).not.toMatch(/role=\{/);
    expect(src).not.toMatch(/aria-live=\{/);
    // Neither variant may be conditionally rendered by its own file.
    expect(src).not.toMatch(/text\s*&&/);
    expect(src).not.toMatch(/return null/);
  });
});

describe("no panel is a live region it should not be", () => {
  test("every aria-live node carries a status, alert or log role", () => {
    for (const [path, src] of PANELS) {
      for (const m of src.matchAll(/aria-live/g)) {
        const tag = enclosingTag(src, m.index ?? 0);
        expect(
          /role="(status|alert|log)"/.test(tag),
          `${path}: aria-live on a node with no live role — a bare region announces nothing`
        ).toBe(true);
      }
    }
  });

  test("only the primitive and the copilot transcript are live", () => {
    // The verify column used to be `aria-live="polite"` over the whole verdict.
    // Any new live region outside these two files is that defect re-arriving.
    for (const [path, src] of PANELS) {
      const live = [...src.matchAll(/aria-live/g)];
      if (path.endsWith(join("app", "copilot.tsx"))) {
        expect(live.length, `${path}: the transcript is a log, so it needs its live role`).toBe(1);
        expect(enclosingTag(src, live[0].index ?? 0)).toContain('role="log"');
      } else {
        expect(live.length, `${path}: a panel must not make its result column live`).toBe(0);
      }
    }
  });

  test("the copilot log is named and keyboard-reachable", () => {
    const src = PANELS.get(join(COMPONENTS, "app", "copilot.tsx")) ?? "";
    const m = /aria-live/g.exec(src);
    expect(m).toBeTruthy();
    const tag = enclosingTag(src, m!.index);
    expect(tag).toContain("aria-label=");
    // axe wants a scrollable region to be reachable (scrollable-region-focusable).
    expect(tag).toContain("tabIndex={0}");
  });
});

describe("every write announces", () => {
  /** Files that send a mutation: `post(…)` over the API, or `save(…)` on the
   *  local reminder store. Derived from the tree, so a new panel is covered the
   *  day it is written rather than the day someone remembers to list it. */
  function writers(): [string, string][] {
    return [...PANELS.entries()].filter(([, src]) => /\bpost[<(]/.test(src) || /\bsave\(/.test(src));
  }

  test("the mutation set is the one this gate was written for", () => {
    const names = writers().map(([p]) => p.slice(COMPONENTS.length + 1)).sort();
    expect(names).toEqual([
      join("app", "console.tsx"),
      join("app", "copilot.tsx"),
      join("app", "evidence.tsx"),
      join("app", "family.tsx"),
      join("app", "reminders.tsx"),
      join("app", "today.tsx"),
      join("app", "verify.tsx"),
      "workspace.tsx",
    ].sort());
  });

  test("each writer announces, through a status line or a log", () => {
    expect(writers().length).toBeGreaterThan(0);
    for (const [path, src] of writers()) {
      if (src.includes("@/components/ui/status-line")) {
        expect(src, `${path}: imports the primitive but renders no region`).toMatch(/<(StatusLine|AlertLine)\s/);
      }
      const announced = /<StatusLine\s/.test(src) || /role="log"/.test(src);
      expect(announced, `${path}: writes without announcing`).toBe(true);
      if (/role="log"/.test(src)) {
        // A nameless live region tells a listener something changed, not what.
        expect(enclosingTag(src, src.indexOf('role="log"'))).toContain("aria-label=");
      }
    }
  });

  test("a writer that puts a failure on screen puts it on an assertive region", () => {
    for (const [path, src] of writers()) {
      const showsFailure = /set[A-Za-z]*(Err|Error)\(/.test(src) || /state\s*=\s*"[^\"]*fail/i.test(src);
      if (showsFailure) {
        expect(src, `${path}: a failure shown only as text is a failure a listener never hears`).toMatch(/<AlertLine\s/);
      }
    }
  });

  test("no catch block in the UI layer is empty", () => {
    // Block-form handlers only: `.catch(() => …)` is a call expression, and the
    // promise arms that ignore a probe failure are deliberate and read as such.
    let blocks = 0;
    for (const [path, src] of PANELS) {
      for (const m of src.matchAll(/\bcatch\s*(\([^)]*\))?\s*\{/g)) {
        const brace = (m.index ?? 0) + m[0].length - 1;
        blocks++;
        const body = blockBody(src, brace).trim();
        expect(body.length, `${path}: an empty catch swallows a failure the user would otherwise see`).toBeGreaterThan(0);
      }
    }
    expect(blocks).toBeGreaterThanOrEqual(8);
  });

  test("the dose guardrail refuses assertively and a clean tap does not", () => {
    // The one message in the product whose ignoring has a clinical cost: a
    // refused "taken" that would double a dose. Tone here is not decoration.
    const src = PANELS.get(join(COMPONENTS, "app", "today.tsx")) ?? "";
    const alert = src.match(/<AlertLine\s+text=\{([^}]+)\}/);
    const status = src.match(/<StatusLine\s+text=\{([^}]+)\}/);
    expect(alert).toBeTruthy();
    expect(status).toBeTruthy();
    expect(alert![1]).toContain("guarded");
    expect(alert![1]).not.toContain("!feedback.guarded");
    expect(status![1]).toContain("!feedback.guarded");
  });

  test("a join code shown once is also spoken once", () => {
    // `GET /api/family` never returns a code, by design — the minting response is
    // the only time it exists on screen. If the announcement does not carry it,
    // a user who is not looking at that instant cannot share the circle at all.
    const src = PANELS.get(join(COMPONENTS, "app", "family.tsx")) ?? "";
    expect(src).toMatch(/setMsg\(\s*`[^`]*\$\{r\.joinCode/);
    expect(src).toMatch(/joinCode\.split\(""\)\.join\(" "\)/);
  });
});
