import { expect, test } from "@playwright/test";
import manifest from "../../fixtures/manifest.json" with { type: "json" };
import {
  copyToClipboard,
  currentRange,
  domRange,
  drag,
  openFixture,
  rangeRects,
  rangeText,
  textPoint,
} from "./helpers";

const single = manifest.files["single-column.pdf"];
const S = single.sentences;

test.describe("selection acceptance (brief)", () => {
  test("drag-select a sentence: rangeToText equals the clipboard", async ({ page }) => {
    await openFixture(page, "single-column.pdf");
    const from = await textPoint(page, 0, "The quick lighthouse", "start");
    const to = await textPoint(page, 0, "herons before breakfast.", "end");
    await drag(page, from, to);
    const range = await currentRange(page);
    expect(range).not.toBeNull();
    const text = await rangeText(page, range!);
    expect(text.replace(/\s+/g, " ")).toBe(S.page1Mid);
    expect(await copyToClipboard(page)).toBe(text);
  });

  test("drag from the bottom of page 3 to the top of page 4", async ({ page }) => {
    await openFixture(page, "single-column.pdf", "&zoom=0.75");
    await page.evaluate(() => window.readlet?.handle?.goToPage(2));
    // Scroll so that the end of page 3 and the start of page 4 are both visible.
    await page.evaluate(() => {
      const el = document.querySelector('.rl-page[data-page-index="3"]') as HTMLElement;
      const scroller = el.closest("[data-readlet-status]") as HTMLElement;
      scroller.scrollTop = el.offsetTop - scroller.clientHeight / 2;
    });
    await page.locator('.rl-text-layer[data-page-index="2"] span').first().waitFor();
    await page.locator('.rl-text-layer[data-page-index="3"] span').first().waitFor();
    const from = await textPoint(page, 2, "archivist", "start");
    const to = await textPoint(page, 3, "harbour", "end");
    await drag(page, from, to);
    const range = await currentRange(page);
    expect(range?.start.page).toBe(2);
    expect(range?.end.page).toBe(3);
    const text = await rangeText(page, range!);
    expect(text).toContain("archivist closed the ledger");
    expect(text).toContain("Morning fog rolled across the harbour");
    expect(await copyToClipboard(page)).toBe(text);
  });

  test("zoom from 100% to 200% keeps the range", async ({ page }) => {
    await openFixture(page, "single-column.pdf", "&zoom=1");
    const from = await textPoint(page, 0, "quick", "start");
    const to = await textPoint(page, 0, "herons", "end");
    await drag(page, from, to);
    const before = await currentRange(page);
    expect(before).not.toBeNull();
    await page.getByLabel("Zoom").selectOption("2");
    await expect.poll(() => page.evaluate(() => window.readlet?.handle?.viewport?.scale)).toBe(2);
    await page.waitForTimeout(300);
    expect(await currentRange(page)).toEqual(before);
    expect(await domRange(page)).toEqual(before);
  });

  test("serialise, reload, setRange: same rects in page coordinates", async ({ page }) => {
    await openFixture(page, "single-column.pdf");
    const from = await textPoint(page, 0, "Nobody", "start");
    const to = await textPoint(page, 0, "afternoon.", "end");
    await drag(page, from, to);
    const range = await currentRange(page);
    expect(range).not.toBeNull();
    const json = JSON.stringify(range);
    const rects = await rangeRects(page, range!);
    expect(rects.length).toBeGreaterThan(1);

    await page.reload();
    await openFixture(page, "single-column.pdf");
    await page.evaluate((j) => window.readlet?.handle?.selection?.setRange(JSON.parse(j)), json);
    expect(await currentRange(page)).toEqual(range);
    expect(await domRange(page)).toEqual(range);
    const after = await rangeRects(page, JSON.parse(json));
    expect(after.length).toBe(rects.length);
    after.forEach((r, i) => {
      const b = rects[i]!;
      expect(r.page).toBe(b.page);
      for (const k of ["x", "y", "width", "height"] as const) expect(r[k]).toBeCloseTo(b[k], 6);
    });
  });

  test("double click a word selects exactly that word", async ({ page }) => {
    await openFixture(page, "single-column.pdf");
    const a = await textPoint(page, 0, "aardvark", "start");
    const b = await textPoint(page, 0, "aardvark", "end");
    await page.mouse.dblclick((a.x + b.x) / 2, a.y);
    const range = await currentRange(page);
    expect(range).not.toBeNull();
    expect(await rangeText(page, range!)).toBe("aardvark");
  });
});

test("setRange on pages that are not rendered does not throw", async ({ page }) => {
  await openFixture(page, "large-500.pdf");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluate(() =>
    window.readlet?.handle?.selection?.setRange({
      start: { page: 0, offset: 0 },
      end: { page: 300, offset: 5 },
    }),
  );
  const range = await currentRange(page);
  expect(range).toEqual({ start: { page: 0, offset: 0 }, end: { page: 300, offset: 5 } });
  expect(errors).toEqual([]);
});

test("pointer in the gap between pages does not jump the selection to page 1", async ({ page }) => {
  await openFixture(page, "single-column.pdf", "&zoom=0.75");
  await page.evaluate(() => {
    const el = document.querySelector('.rl-page[data-page-index="3"]') as HTMLElement;
    const scroller = el.closest("[data-readlet-status]") as HTMLElement;
    scroller.scrollTop = el.offsetTop - scroller.clientHeight / 2;
  });
  await page.locator('.rl-text-layer[data-page-index="3"] span').first().waitFor();
  const from = await textPoint(page, 2, "archivist", "start");
  const gap = await page.evaluate(() => {
    const r = (
      document.querySelector('.rl-page[data-page-index="3"]') as HTMLElement
    ).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top - 8 };
  });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(gap.x, gap.y, { steps: 8 });
  const range = await currentRange(page);
  await page.mouse.up();
  expect(range?.start.page).toBe(2);
  expect(range?.end.page).toBeGreaterThanOrEqual(2);
});

test("native selection changes (as from touch selection handles) are tracked", async ({ page }) => {
  await openFixture(page, "single-column.pdf");
  // Touch selection handles change the DOM selection directly; no mouse events.
  await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.rl-text-layer[data-page-index="0"] span')];
    const span = spans.find((s) => s.textContent?.includes("aardvark")) as HTMLElement;
    const node = span.firstChild as Text;
    const i = node.data.indexOf("aardvark");
    document.getSelection()?.setBaseAndExtent(node, i, node, i + "aardvark".length);
  });
  const range = await currentRange(page);
  expect(range).not.toBeNull();
  expect(await rangeText(page, range!)).toBe("aardvark");
  // Extend the selection with the "handle" to the end of the word "afternoon.".
  await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.rl-text-layer[data-page-index="0"] span')];
    const span = spans.find((s) => s.textContent?.includes("afternoon.")) as HTMLElement;
    const node = span.firstChild as Text;
    document.getSelection()?.extend(node, node.data.indexOf("afternoon.") + "afternoon.".length);
  });
  const extended = await currentRange(page);
  expect(await rangeText(page, extended!)).toMatch(
    /^aardvark slept under the bakery counter every\s+afternoon\.$/,
  );
});
