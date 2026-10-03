import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Speed benchmark on heavy generated PDFs (scripts/make-bench-fixtures.mjs). Chromium only: the
// "mobile" scenario slows the CPU (×4) and the network (Chrome's "Fast 4G" profile) with the
// DevTools protocol, to act like a mid-range phone.
//
//   pnpm bench      (generates the files once, then runs this file with BENCH=1)
//
// Times are measured inside the page from `open(src)`, so the start of the example app on the
// Vite dev server is not included. Results go to test-results/benchmark.json.

const FILES = ["bench-images.pdf", "bench-vector.pdf", "bench-text.pdf"] as const;
const SCENARIOS = [
  { name: "desktop", cpu: 1, network: null },
  // 9 Mbit/s down, 1.5 Mbit/s up, 150 ms round trip.
  {
    name: "mobile",
    cpu: 4,
    network: { latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 },
  },
] as const;
const JUMPS = [3, 6, 9, 12, 15, 18, 21];
const RANGE_ORIGIN = "http://localhost:5174";
const NEW_DOC = '.rl-viewer[aria-label="Document, 24 pages"]';

/**
 * Generous upper limits that catch large regressions, not small ones (the latest numbers are in
 * PROGRESS.md; CI runners are about 2–3× slower than a laptop). On the slow network, loading the
 * whole file from a server without range support is slow by nature, so it has no limit.
 */
const BUDGET_MS = {
  desktop: { firstPage: 3_000, jumpMedian: 1_500 },
  mobile: { firstPage: 10_000, jumpMedian: 5_000 },
} as const;

interface Result {
  file: string;
  scenario: string;
  source: "whole-file" | "ranges";
  firstCanvasMs: number;
  firstTextMs: number;
  jumpMedianMs: number;
  jumpMaxMs: number;
  longTasks: number;
  longestTaskMs: number;
}

const results: Result[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(({ browserName }) => {
  test.skip(!process.env.BENCH, "Opt-in: run `pnpm bench`");
  test.skip(browserName !== "chromium", "CPU throttling needs Chromium");
  test.skip(
    !existsSync("fixtures/bench/bench-images.pdf"),
    "Run `node scripts/make-bench-fixtures.mjs` first",
  );
});

test.afterAll(async () => {
  if (!results.length) return;
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/benchmark.json", `${JSON.stringify(results, null, 2)}\n`);
  console.table(results);
});

/** Records long main-thread tasks (over 50 ms) from now on. */
async function watchLongTasks(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { longTasks: number[] };
    w.longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.longTasks.push(e.duration);
    }).observe({ type: "longtask" });
  });
}

/** Time from now until `selector` exists, measured in the page. */
async function timeUntil(page: Page, start: () => Promise<void>, selector: string) {
  await page.evaluate(() => {
    (window as unknown as { t0: number }).t0 = performance.now();
  });
  await start();
  await page.locator(selector).first().waitFor({ timeout: 60_000 });
  return page.evaluate(() => performance.now() - (window as unknown as { t0: number }).t0);
}

for (const scenario of SCENARIOS) {
  for (const file of FILES) {
    for (const source of ["whole-file", "ranges"] as const) {
      test(`${file}, ${scenario.name}, ${source}`, async ({ page }) => {
        test.setTimeout(180_000);
        // Start with a small document, so the app and the worker are ready.
        // "whole-file": range requests off, pdf.js downloads the whole file first.
        // "ranges": only the ranges that shown pages need (the default).
        await page.goto(`/?file=single-column.pdf${source === "whole-file" ? "&ranges=0" : ""}`);
        await expect(page.getByTestId("status")).toHaveText("ready");
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: scenario.cpu });
        if (scenario.network) {
          await cdp.send("Network.enable");
          await cdp.send("Network.emulateNetworkConditions", {
            offline: false,
            ...scenario.network,
          });
        }
        await watchLongTasks(page);

        // The S3-like range server on another origin.
        const src = `${RANGE_ORIGIN}/bench/${file}?t=${Math.random().toString(36).slice(2)}`;
        const open = () => page.evaluate((s) => window.readlet?.open(s), src);
        const firstCanvasMs = await timeUntil(
          page,
          open,
          // The 24-page viewer only, not page 0 of the document that was open before.
          `${NEW_DOC} .rl-page[data-page-index="0"][data-rendered] canvas`,
        );
        await page
          .locator(`${NEW_DOC} .rl-page[data-page-index="0"] .rl-text-layer span`)
          .first()
          .waitFor();
        const firstTextMs = await page.evaluate(
          () => performance.now() - (window as unknown as { t0: number }).t0,
        );

        // Jump to pages that are not rendered yet (more than the render buffer apart).
        const jumps: number[] = [];
        for (const index of JUMPS) {
          jumps.push(
            await timeUntil(
              page,
              () => page.evaluate((i) => window.readlet?.handle?.goToPage(i), index),
              `.rl-page[data-page-index="${index}"][data-rendered] .rl-text-layer span`,
            ),
          );
        }
        jumps.sort((a, b) => a - b);
        const longTasks = await page.evaluate(
          () => (window as unknown as { longTasks: number[] }).longTasks,
        );
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        await cdp.detach();

        const result: Result = {
          file,
          scenario: scenario.name,
          source,
          firstCanvasMs: Math.round(firstCanvasMs),
          firstTextMs: Math.round(firstTextMs),
          jumpMedianMs: Math.round(jumps[Math.floor(jumps.length / 2)] ?? 0),
          jumpMaxMs: Math.round(jumps[jumps.length - 1] ?? 0),
          longTasks: longTasks.length,
          longestTaskMs: Math.round(Math.max(0, ...longTasks)),
        };
        results.push(result);
        test.info().annotations.push({ type: "benchmark", description: JSON.stringify(result) });

        const budget = BUDGET_MS[scenario.name];
        if (scenario.network && source === "whole-file") return;
        expect(result.firstCanvasMs).toBeLessThan(budget.firstPage);
        expect(result.jumpMedianMs).toBeLessThan(budget.jumpMedian);
      });
    }
  }
}
