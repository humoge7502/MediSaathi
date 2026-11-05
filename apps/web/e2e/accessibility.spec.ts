/**
 * Accessibility gate (TD-4) — automated axe-core scans of the core journeys.
 *
 * Scope: the whole landing page and the workspace's key panels, at the default
 * desktop viewport. Serious/critical violations fail the gate; moderate and
 * "incomplete" (needs-human-review) findings are reported but do not fail, so
 * the gate stays honest without blocking on scanner uncertainty.
 *
 * Scans run under `prefers-reduced-motion: reduce`: axe's color-contrast rule
 * snapshots mid-transition elements and can misread a 500ms opacity fade as a
 * contrast failure (observed as an order-dependent flake after scroll reveals
 * landed). Reduced motion collapses our animations to instant appearance —
 * stabilizing the scan AND exercising the reduced-motion experience, which is
 * the state a real assistive-tech user may be in.
 *
 * This file runs as part of the Playwright suite (`bun run e2e`) — it boots
 * the same deterministic-tier standalone server as product.spec.ts.
 */
import { test, expect, request } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const BASE = "http://localhost:3457";

/** Today's dose rows, oldest first, as the panel lists them. */
async function todaysDoses(api: import("@playwright/test").APIRequestContext) {
  const res = await api.get("/api/plans");
  const body = (await res.json()) as {
    data: { doses?: { id: string; time: string; status: string }[] };
  };
  return [...(body.data.doses ?? [])].sort((a, b) => a.time.localeCompare(b.time));
}

test.use({ colorScheme: "light" });
test.describe("accessibility (TD-4 axe gate)", () => {
  test.use({ reducedMotion: "reduce" });

  test("landing page: no serious or critical violations", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    if (serious.length > 0) {
      console.log(
        "axe violations (landing):",
        JSON.stringify(
          serious.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.slice(0, 5).map((n) => n.target),
          })),
          null,
          2
        )
      );
    }
    expect(serious).toEqual([]);
  });

  test("workspace: verify panel has no serious or critical violations", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Launch the live product/i }).click();
    await expect(page.getByRole("heading", { name: "Vaidya workspace" })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    if (serious.length > 0) {
      console.log(
        "axe violations (workspace):",
        JSON.stringify(
          serious.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.slice(0, 5).map((n) => n.target),
          })),
          null,
          2
        )
      );
    }
    expect(serious).toEqual([]);
  });

  // The reminders card is the densest control surface in the product: two
  // switches, two segmented groups, a time pair, mute chips and a live list, all
  // at 11-12px. It is where an accessibility regression is most likely and least
  // visible, so it gets its own scan rather than riding on the default tab.
  test("today tab (reminders card + dose timeline) has no serious or critical violations", async ({ page }) => {
    // Build the day this scan needs. Without a seed the panel shows whatever the
    // last run left — and once every dose of the day has an outcome, the status
    // chips (the densest colour-code surface in the product) are not on the page
    // at all and the scan quietly stops covering them.
    const api = await request.newContext({ baseURL: BASE });
    expect((await api.post("/api/seed", { data: { force: true } })).ok()).toBeTruthy();
    const doses = (await todaysDoses(api)).filter((d) => d.status === "pending");
    expect(doses.length).toBeGreaterThanOrEqual(2);
    // The last slot of the day is never too close to the next dose, so it is
    // recorded as taken rather than rewritten by the catch-up guardrail; the
    // first is skipped outright. Both chip states, whatever hour this runs at.
    await api.post("/api/doses/action", { data: { doseId: doses[doses.length - 1].id, action: "taken" } });
    await api.post("/api/doses/action", { data: { doseId: doses[0].id, action: "skipped" } });
    await api.dispose();

    await page.goto("/");
    await page.getByRole("button", { name: /Launch the live product/i }).click();
    await expect(page.getByRole("heading", { name: "Vaidya workspace" })).toBeVisible();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByText("Active plan")).toBeVisible();
    await expect(page.getByText("Earlier today")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    if (serious.length > 0) {
      console.log(
        "axe violations (today):",
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

  test("evidence tab (the judge-facing data surface) has no serious violations", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Launch the live product/i }).click();
    await page.getByRole("button", { name: "Evidence", exact: true }).click();
    await expect(page.getByText("Deterministic safety engine — self-test")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(serious).toEqual([]);
  });

  // ---- SC 4.1.3, the part a resting scan cannot see --------------------------
  // axe inspects the DOM it is handed, and every status message in this product
  // exists only after a write. These two tests perform the write.

  test("a verification announces one sentence, from a region that was already there", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Launch the live product/i }).click();
    await expect(page.getByRole("heading", { name: "Vaidya workspace" })).toBeVisible();

    // Mark every polite region on the page. If the summary later arrives in a
    // region that was created together with it, the mark is missing — and that
    // is the exact defect, because assistive tech is not obliged to report a
    // region and its first sentence in the same commit.
    await page.getByRole("status").evaluateAll((nodes) => {
      for (const n of nodes) n.setAttribute("data-vy-before", "1");
    });
    expect(await page.getByRole("status").count()).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Warfarin + aspirin" }).click();
    await page.getByRole("button", { name: "Run verification" }).click();

    const spoken = page.getByRole("status").filter({ hasText: "Verification finished" });
    await expect(spoken).toHaveCount(1);
    await expect(spoken).toContainText(/confidence/);
    expect(await spoken.getAttribute("data-vy-before")).toBe("1");

    // The burial law. The result column used to be `aria-live` end to end, so a
    // listener heard the verdict, every medicine, every finding and every queue
    // row on each mutation inside it. A live region is a sentence here, with
    // room for the longest one the product can produce.
    const longest = await page
      .locator("[aria-live]")
      .evaluateAll((nodes) => Math.max(...nodes.map((n) => (n.textContent ?? "").trim().length)));
    expect(longest).toBeLessThan(240);
  });

  /**
   * The placeholder law, measured. Five panels used to pulse one sentence while
   * they loaded — prose taken to 50% opacity mid-cycle by the same animation that
   * shimmers a shape, and read aloud once before the panel that replaced it was
   * read again. That state lasts a few milliseconds on a warm standalone server,
   * so the static tier can describe the rule but only a browser can see the
   * exception: the plan request is held open until every measurement below is
   * taken.
   *
   * What this does *not* claim is a layout-shift win. Measured at the 1 280×720
   * viewport, the old one-line card put the document at 720 px and the skeletons
   * put it at 800, against 1 590 px loaded — `main` carries `min-h-screen`, so a
   * placeholder of almost any size is floored at one viewport and the page never
   * collapses. The defect that was real is the one asserted here: text where text
   * had no business being, pulsing below the contrast floor and doubled into a
   * listener's stream.
   */
  test("a panel that is still loading says nothing, and pulses no prose", async ({ page }) => {
    const api = await request.newContext({ baseURL: BASE });
    // Seeded, so the loaded Today panel is the full one and not the empty card.
    expect((await api.post("/api/seed", { data: { force: true } })).ok()).toBeTruthy();
    await api.dispose();

    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/plans", async (route) => {
      await hold;
      await route.continue();
    });

    try {
      // The deep link opens the workspace on the tab it names, so there is no
      // Launch button to press on this path — and no click landing between the
      // load and the panel's first request, which is the window being measured.
      await page.goto("/?task=today");
      await expect(page.getByRole("heading", { name: "Vaidya workspace" })).toBeVisible();

      const busy = page.locator('[aria-busy="true"]');
      await expect(busy.first()).toBeVisible();
      expect(await busy.count()).toBeGreaterThanOrEqual(2);

      const texts = await busy.evaluateAll((nodes) => nodes.map((n) => (n.textContent ?? "").trim()));
      expect(texts, `the placeholder carried text: ${JSON.stringify(texts)}`).toEqual(texts.map(() => ""));
      expect(await page.locator(".vy-skeleton").count()).toBeGreaterThan(10);
      const pulses = await page.locator('[class*="animate-pulse"]').allTextContents();
      expect(pulses.length, "the loading panel pulsed nothing at all").toBeGreaterThan(0);
      expect(pulses.every((t) => t.trim() === ""), `a pulsing node held prose: ${JSON.stringify(pulses)}`).toBe(true);
      // and every pulsing shape is out of the accessibility tree, so the region
      // a listener lands on says *busy* rather than reading a caption about it.
      const shaped = await page.locator(".vy-skeleton").count();
      const hidden = await page
        .locator(".vy-skeleton")
        .evaluateAll((nodes) => nodes.filter((n) => n.closest('[aria-hidden="true"]') !== null).length);
      expect(hidden, `${hidden} of ${shaped} skeleton blocks are hidden from assistive tech`).toBe(shaped);

      release();
      await expect(page.locator(".vy-eyebrow").filter({ hasText: /Active plan/i })).toBeVisible();
    } finally {
      release();
    }
  });

  // The copilot tab had no scan at all before this: the workspace scan stops at
  // whichever tab is default, so the panel with the densest live behaviour was
  // the one the gate never opened.
  test("copilot tab: the transcript is a named log, answers land in it, axe is clean", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Launch the live product/i }).click();
    await page.getByRole("button", { name: "Copilot", exact: true }).click();

    const log = page.getByRole("log", { name: "Conversation with the copilot" });
    await expect(log).toHaveCount(1);

    await page.getByRole("button", { name: "Should I double my dose today?" }).click();
    await expect(log).toContainText(/refused — out of scope/i);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    if (serious.length > 0) {
      console.log(
        "axe violations (copilot):",
        JSON.stringify(serious.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 5).map((n) => n.target) })), null, 2)
      );
    }
    expect(serious).toEqual([]);
  });
});
