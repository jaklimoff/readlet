import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openFixture } from "./helpers";

test("the viewer has no axe violations", async ({ page }) => {
  await openFixture(page, "outline-links.pdf");
  const results = await new AxeBuilder({ page }).include("[data-readlet-status]").analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
  expect(summary).toEqual([]);
});

test("the text layer exposes the page text to assistive technology", async ({ page }) => {
  await openFixture(page, "single-column.pdf");
  const region = page.getByRole("region", { name: "Page 1 of 5" });
  await expect(region).toContainText("The quick lighthouse keeper counted seventeen silver herons");
  // The canvas is decorative; the text layer carries the content.
  await expect(region.locator("canvas")).toHaveAttribute("aria-hidden", "true");
});
