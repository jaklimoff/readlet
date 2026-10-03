import { expect, type Page, test } from "@playwright/test";
import { openFixture } from "./helpers";

test.describe.configure({ mode: "serial" });
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "Heap metrics use the Chrome DevTools Protocol.",
);

async function heapMB(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  await cdp.detach();
  return usedSize / 1024 / 1024;
}

test("1,000 pages: virtualised, heap under 200 MB, smooth scroll", async ({ page }) => {
  test.setTimeout(120_000);
  await openFixture(page, "large-1000.pdf");
  await expect(page.getByTestId("page-count")).toHaveText("1000");

  // Scroll through the document in steps and record frame times.
  const result = await page.evaluate(async () => {
    const scroller = document.querySelector("[data-readlet-status]") as HTMLElement;
    const frames: number[] = [];
    let last = performance.now();
    let maxCanvases = 0;
    const total = scroller.scrollHeight - scroller.clientHeight;
    for (let i = 0; i <= 300; i++) {
      scroller.scrollTop = (total * i) / 300;
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      frames.push(now - last);
      last = now;
      maxCanvases = Math.max(maxCanvases, document.querySelectorAll(".rl-page canvas").length);
    }
    frames.sort((a, b) => a - b);
    return {
      p95: frames[Math.floor(frames.length * 0.95)] ?? 0,
      maxCanvases,
      canvasesAtEnd: document.querySelectorAll(".rl-page canvas").length,
      textLayers: document.querySelectorAll(".rl-text-layer").length,
    };
  });
  console.log("scroll", result);
  expect(result.maxCanvases).toBeLessThan(12);
  expect(result.textLayers).toBeLessThan(12);
  expect(result.p95).toBeLessThan(50);
  await expect(page.locator('.rl-page[data-page-index="999"][data-rendered]')).toHaveCount(1);
  const heap = await heapMB(page);
  console.log("heap MB", heap.toFixed(1));
  expect(heap).toBeLessThan(200);
});

test("load and destroy a 500 page document 10 times: heap returns to baseline", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openFixture(page, "single-column.pdf");
  const baseline = await heapMB(page);
  for (let i = 0; i < 10; i++) {
    await page.getByLabel("Fixture").selectOption("large-500.pdf");
    await expect(page.getByTestId("page-count")).toHaveText("500");
    await page.locator(".rl-page[data-rendered]").first().waitFor();
    await page.getByLabel("Fixture").selectOption("single-column.pdf");
    await expect(page.getByTestId("page-count")).toHaveText("5");
    await page.locator(".rl-page[data-rendered]").first().waitFor();
  }
  await page.waitForTimeout(500);
  const after = await heapMB(page);
  const pages = await page.locator(".rl-page").count();
  console.log("heap MB baseline", baseline.toFixed(1), "after", after.toFixed(1));
  expect(pages).toBe(5);
  expect(after).toBeLessThan(baseline * 1.2);
});
