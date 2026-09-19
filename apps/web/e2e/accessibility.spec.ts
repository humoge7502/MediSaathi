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
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ colorScheme: "light" });
test.describe("accessibility (TD-4 axe gate)", () => {
  test.use({ reducedMotion: "reduce" });

  test("landing page: no serious or critical violations", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
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
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
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

  test("evidence tab (the judge-facing data surface) has no serious violations", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Launch the live product/i }).click();
    await page.getByRole("button", { name: "Evidence", exact: true }).click();
    await expect(page.getByText("Deterministic safety engine — self-test")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(serious).toEqual([]);
  });
});
