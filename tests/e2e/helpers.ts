import { expect, type Page } from "@playwright/test";
import type { PageRect, TextRange } from "@readlet/core";

export async function openFixture(page: Page, file: string, query = ""): Promise<void> {
  await page.goto(`/?file=${file}${query}`);
  await expect(page.getByTestId("status")).toHaveText("ready");
  await page.locator(".rl-page[data-rendered] .rl-text-layer span").first().waitFor();
}

/** Client coordinates of the start or end of `text` inside the text layer of page `pageIndex`. */
export async function textPoint(
  page: Page,
  pageIndex: number,
  text: string,
  edge: "start" | "end",
): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(
    ({ pageIndex, text, edge }) => {
      const layer = document.querySelector(`.rl-text-layer[data-page-index="${pageIndex}"]`);
      if (!layer) throw new Error(`No text layer for page ${pageIndex}`);
      const spans = [...layer.querySelectorAll("span:not(.rl-sep)")];
      for (const span of spans) {
        const node = span.firstChild as Text | null;
        if (!node) continue;
        const i = node.data.indexOf(text);
        if (i < 0) continue;
        const r = document.createRange();
        const at = edge === "start" ? i : i + text.length - 1;
        r.setStart(node, at);
        r.setEnd(node, at + 1);
        const rect = r.getBoundingClientRect();
        return {
          x: edge === "start" ? rect.left + 1 : rect.right - 1,
          y: rect.top + rect.height / 2,
        };
      }
      throw new Error(`"${text}" not found in one span on page ${pageIndex}`);
    },
    { pageIndex, text, edge },
  );
  return point;
}

export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

/** Waits for the selection change (one animation frame) and returns the manager's range. */
export async function currentRange(page: Page): Promise<TextRange | null> {
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  return page.evaluate(() => window.readlet?.handle?.selection?.getRange() ?? null);
}

export async function rangeText(page: Page, range: TextRange): Promise<string> {
  return page.evaluate((r) => window.readlet?.handle?.selection?.rangeToText(r) ?? "", range);
}

export async function rangeRects(page: Page, range: TextRange): Promise<PageRect[]> {
  return page.evaluate((r) => window.readlet?.handle?.selection?.rangeToRects(r) ?? [], range);
}

/** The range that the live DOM selection maps to right now. */
export async function domRange(page: Page): Promise<TextRange | null> {
  return page.evaluate(() => {
    const sel = document.getSelection();
    const m = window.readlet?.handle?.selection;
    return sel && m ? m.selectionToRange(sel) : null;
  });
}

export async function copyToClipboard(page: Page): Promise<string> {
  await page.keyboard.press("ControlOrMeta+c");
  return page.evaluate(() => navigator.clipboard.readText());
}
