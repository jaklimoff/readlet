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
        const y = rect.top + rect.height / 2;
        if (edge === "start") return { x: rect.left + rect.width / 4, y };
        // Firefox snaps a drag end a little differently from its caret hit test, so a point just
        // inside a narrow end character (such as ".") can snap before it. When a next character
        // follows in the same span, aim a third of the way into it; that boundary is the nearest.
        if (at + 2 <= node.length) {
          r.setStart(node, at + 1);
          r.setEnd(node, at + 2);
          const next = r.getBoundingClientRect();
          if (next.width > 0 && Math.abs(next.top - rect.top) < rect.height / 2) {
            return { x: next.left + next.width / 3, y };
          }
        }
        return { x: rect.right - rect.width / 10, y };
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
  // Firefox and WebKit apply the last pointer move to the selection a little later. A real user
  // pauses before releasing the button; do the same, then move once more to the same point.
  await page.waitForTimeout(50);
  await page.mouse.move(to.x, to.y);
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

/**
 * Presses Ctrl/Cmd+C and returns the text that the copy produced. It reads the text from the
 * `copy` event (what the page put on the clipboard, or the native selection text when no handler
 * changed it), so it works in every browser without clipboard permissions.
 */
export async function copyToClipboard(page: Page): Promise<string> {
  await page.evaluate(() => {
    const w = window as unknown as { __copied?: string | null };
    w.__copied = null;
    window.addEventListener(
      "copy",
      (e) => {
        w.__copied = e.defaultPrevented
          ? (e.clipboardData?.getData("text/plain") ?? "")
          : (document.getSelection()?.toString() ?? "");
      },
      { once: true },
    );
  });
  await page.keyboard.press("ControlOrMeta+c");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copied?: string | null }).__copied))
    .not.toBeNull();
  return page.evaluate(() => (window as unknown as { __copied: string }).__copied);
}
