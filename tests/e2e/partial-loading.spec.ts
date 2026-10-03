import { expect, test } from "@playwright/test";
import manifest from "../../fixtures/manifest.json" with { type: "json" };

// The range server (scripts/range-server.mjs) runs on another origin with S3-like CORS headers.
const RANGE_ORIGIN = "http://localhost:5174";

interface RangeStats {
  requests: number;
  bytes: number;
  ranges: number;
  /** Each distinct range counted once: React StrictMode loads the document twice in dev. */
  uniqueBytes: number;
  /** `uniqueBytes` without the first full request, which pdf.js cancels after the headers. */
  rangeBytes: number;
}

function token(): string {
  return Math.random().toString(36).slice(2);
}

test("page 500 of 1,000 from a range server downloads only a small part of the file", async ({
  page,
  request,
}, testInfo) => {
  const t = token();
  const url = `${RANGE_ORIGIN}/large-1000.pdf?t=${t}`;
  const started = Date.now();
  await page.goto(`/?file=${encodeURIComponent(url)}&page=499&chunk=8192`);
  await expect(page.getByTestId("status")).toHaveText("ready");
  await page
    .locator('.rl-page[data-page-index="499"][data-rendered] .rl-text-layer span')
    .first()
    .waitFor();
  const firstPageMs = Date.now() - started;
  expect(await page.evaluate(() => window.readlet?.handle?.viewport?.currentPage)).toBe(499);
  const text = await page.evaluate(() => window.readlet?.handle?.document?.getPageText(499));
  expect(text).toContain("This is page 500 of 1000.");

  const stats = (await (await request.get(`${RANGE_ORIGIN}/__stats?t=${t}`)).json()) as RangeStats;
  const size = manifest.files["large-1000.pdf"].bytes;
  testInfo.annotations.push({
    type: "partial-load",
    description: `${stats.rangeBytes} B in ranges, ${stats.uniqueBytes} of ${size} bytes (${Math.round((stats.uniqueBytes / size) * 100)}%), ${stats.requests} requests, first page in ${firstPageMs} ms`,
  });
  expect(stats.ranges).toBeGreaterThan(0);
  // In this small file the cross-reference data and object streams at the end are about 10% of
  // the file. The first full request is cancelled after its headers arrive; how much of its body
  // arrives first depends on the browser (16–80 KB here), so it has a looser limit.
  expect(stats.rangeBytes).toBeLessThan(size * 0.2);
  expect(stats.uniqueBytes).toBeLessThan(size * 0.5);

  // Pages that were not near the visible area keep estimated sizes: nothing loaded them.
  const estimated = await page.evaluate(
    () => window.readlet?.handle?.document?.pages.filter((p) => p.estimated).length ?? 0,
  );
  expect(estimated).toBeGreaterThan(900);
});

test("lazy page sizes: pages with another size get their real size and keep the reading position", async ({
  page,
}) => {
  // MediaBox sizes; /Rotate 90 or 270 shows a page with width and height swapped.
  const fixture = manifest.files["rotated.pdf"];
  const sizes = (fixture.pageSizes as Array<[number, number]>).map(([w, h], i) =>
    fixture.rotations[i] === 90 || fixture.rotations[i] === 270 ? [h, w] : [w, h],
  );
  await page.goto("/?file=rotated.pdf&zoom=1");
  await expect(page.getByTestId("status")).toHaveText("ready");

  // Go to page 3: landscape (/Rotate 270), while the first page, and so the estimate, is
  // portrait. Pages 1 (landscape) and 2 above it are estimated when the jump is made.
  const last = 3;
  await page.evaluate((i) => window.readlet?.handle?.goToPage(i), last);
  await page.locator(`.rl-page[data-page-index="${last}"][data-rendered]`).waitFor();
  await page.waitForTimeout(200);

  const result = await page.evaluate((i) => {
    const handle = window.readlet?.handle;
    const scroller = document.querySelector("[data-readlet-status]") as HTMLElement;
    const slot = document.querySelector(`.rl-page[data-page-index="${i}"]`) as HTMLElement;
    const info = handle?.document?.getPageInfo(i);
    return {
      estimated: info?.estimated,
      infoAspect: info ? info.width / info.height : 0,
      slotAspect: slot.offsetWidth / slot.offsetHeight,
      slotTopInView: slot.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
      current: handle?.viewport?.currentPage,
    };
  }, last);
  const [w, h] = sizes[last] as [number, number];
  expect(result.estimated).toBe(false);
  expect(result.infoAspect).toBeCloseTo(w / h, 3);
  expect(result.slotAspect).toBeCloseTo(w / h, 2);
  expect(result.current).toBe(last);
  // goToPage leaves half the padding (8 px) above the page. The real sizes that arrived
  // after the jump must not move it.
  expect(Math.abs(result.slotTopInView - 8)).toBeLessThan(1);

  // Scroll through the whole document: every page slot ends with the real aspect ratio.
  await page.evaluate(async () => {
    const scroller = document.querySelector("[data-readlet-status]") as HTMLElement;
    for (let y = 0; y <= scroller.scrollHeight; y += scroller.clientHeight / 2) {
      scroller.scrollTop = y;
      await new Promise((r) => setTimeout(r, 60));
    }
  });
  await page.waitForTimeout(200);
  const aspects = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".rl-page")].map(
      (el) => el.offsetWidth / el.offsetHeight,
    ),
  );
  aspects.forEach((a, i) => {
    const [pw, ph] = sizes[i] as [number, number];
    expect(a, `page ${i}`).toBeCloseTo(pw / ph, 2);
  });
});
