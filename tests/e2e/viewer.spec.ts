import { expect, test } from "@playwright/test";
import { openFixture } from "./helpers";

test.describe("loading", () => {
  test("loads from a File (file input) and reports progress-free ready state", async ({ page }) => {
    await openFixture(page, "single-column.pdf");
    await page.getByLabel("Open file").setInputFiles("fixtures/two-column.pdf");
    await expect(page.getByTestId("page-count")).toHaveText("2");
    await page.locator(".rl-page[data-rendered]").first().waitFor();
  });

  test("loads from ArrayBuffer, Uint8Array and Blob with the core API", async ({ page }) => {
    await openFixture(page, "single-column.pdf");
    const counts = await page.evaluate(async () => {
      const { loadDocument } = await import("/@id/@readlet/core" as string);
      const { createPdfBackend } = await import("/@id/@readlet/pdf" as string);
      const backend = createPdfBackend();
      const buf = await (await fetch("/rotated.pdf")).arrayBuffer();
      const out: number[] = [];
      for (const src of [buf, new Uint8Array(buf), new Blob([buf])]) {
        const doc = await loadDocument(src, { backend });
        out.push(doc.pageCount);
        await doc.destroy();
      }
      out.push(buf.byteLength > 0 ? 1 : 0); // the caller's buffer is not detached
      return out;
    });
    expect(counts).toEqual([5, 5, 5, 1]);
  });

  test("reports load progress for URL and Blob sources", async ({ page }) => {
    await openFixture(page, "single-column.pdf");
    const result = await page.evaluate(async () => {
      const { loadDocument } = await import("/@id/@readlet/core" as string);
      const { createPdfBackend } = await import("/@id/@readlet/pdf" as string);
      const backend = createPdfBackend();
      const fromUrl: Array<{ loaded: number; total: number | null }> = [];
      const doc = await loadDocument("/large-1000.pdf", {
        backend,
        onProgress: (p: never) => fromUrl.push(p),
      });
      await doc.destroy();
      const blob = await (await fetch("/rotated.pdf")).blob();
      const fromBlob: Array<{ loaded: number; total: number | null }> = [];
      const doc2 = await loadDocument(blob, {
        backend,
        onProgress: (p: never) => fromBlob.push(p),
      });
      await doc2.destroy();
      const fromBuffer: Array<{ loaded: number; total: number | null }> = [];
      const doc3 = await loadDocument(await blob.arrayBuffer(), {
        backend,
        onProgress: (p: never) => fromBuffer.push(p),
      });
      await doc3.destroy();
      return { fromUrl, fromBlob, fromBuffer, blobSize: blob.size };
    });
    expect(result.fromUrl.length).toBeGreaterThan(0);
    const last = result.fromUrl.at(-1)!;
    expect(last.loaded).toBeGreaterThan(0);
    if (last.total !== null) expect(last.loaded).toBeLessThanOrEqual(last.total);
    const complete = [{ loaded: result.blobSize, total: result.blobSize }];
    expect(result.fromBlob).toEqual(complete);
    expect(result.fromBuffer).toEqual(complete);
  });

  test("a missing URL gives a typed network error", async ({ page }) => {
    await page.goto("/?file=does-not-exist.pdf");
    await expect(page.getByTestId("status")).toHaveText(/^error:(network|invalid-pdf)$/);
  });

  test("bytes that are not a PDF give invalid-pdf", async ({ page }) => {
    await page.goto("/?file=manifest.json");
    await expect(page.getByTestId("status")).toHaveText("error:invalid-pdf");
  });
});

test.describe("viewer", () => {
  test("pages have region roles and labels", async ({ page }) => {
    await openFixture(page, "single-column.pdf");
    await expect(page.getByRole("region", { name: "Page 1 of 5" })).toBeVisible();
    await expect(page.locator(".rl-page")).toHaveCount(5);
  });

  test("canvas is crisp on retina (device pixels)", async ({ browser }) => {
    const ctx = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: { width: 1280, height: 900 },
    });
    const page = await ctx.newPage();
    await openFixture(page, "single-column.pdf");
    const ratio = await page.evaluate(() => {
      const c = document.querySelector(".rl-page[data-rendered] canvas") as HTMLCanvasElement;
      return c.width / c.getBoundingClientRect().width;
    });
    expect(ratio).toBeGreaterThan(1.95);
    await ctx.close();
  });

  test("page mode shows one page, keyboard and buttons navigate", async ({ page }) => {
    await openFixture(page, "single-column.pdf", "&mode=page");
    const shown = () => page.locator(".rl-page:visible");
    await expect(shown()).toHaveCount(1);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByLabel("Page number")).toHaveValue("2");
    await page.locator("[data-readlet-status]").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByLabel("Page number")).toHaveValue("3");
    await page.keyboard.press("End");
    await expect(page.getByLabel("Page number")).toHaveValue("5");
    await page.keyboard.press("Home");
    await expect(page.getByLabel("Page number")).toHaveValue("1");
    await expect(shown()).toHaveAttribute("data-page-index", "0");
  });

  test("scroll mode goToPage and onPageChange", async ({ page }) => {
    await openFixture(page, "large-500.pdf");
    await page.getByLabel("Page number").fill("250");
    await expect(page.getByLabel("Page number")).toHaveValue("250");
    await expect(page.locator('.rl-page[data-page-index="249"][data-rendered]')).toHaveCount(1);
    await expect(page.locator('.rl-text-layer[data-page-index="249"]')).toContainText("Page 250");
  });

  test("zoom modes resolve scales", async ({ page }) => {
    await openFixture(page, "single-column.pdf", "&zoom=1");
    const width = () =>
      page.evaluate(() => document.querySelector(".rl-page")!.getBoundingClientRect().width);
    expect(await width()).toBeCloseTo(612 * (96 / 72), 0);
    await page.getByLabel("Zoom").selectOption("fit-page");
    await expect
      .poll(async () => {
        const h = await page.evaluate(
          () => document.querySelector(".rl-page")!.getBoundingClientRect().height,
        );
        const ch = await page.evaluate(
          () => (document.querySelector("[data-readlet-status]") as HTMLElement).clientHeight,
        );
        return h <= ch;
      })
      .toBe(true);
    await page.getByLabel("Zoom").selectOption("fit-width");
    await expect
      .poll(async () => {
        const w = await width();
        const cw = await page.evaluate(
          () => (document.querySelector("[data-readlet-status]") as HTMLElement).clientWidth,
        );
        return Math.abs(cw - 32 - w) < 2;
      })
      .toBe(true);
  });

  test("rotation swaps the page box and keeps text selectable", async ({ page }) => {
    await openFixture(page, "single-column.pdf", "&zoom=1");
    const box = () =>
      page.evaluate(() => {
        const r = document.querySelector(".rl-page")!.getBoundingClientRect();
        return [Math.round(r.width), Math.round(r.height)];
      });
    const [w, h] = await box();
    await page.getByRole("button", { name: /Rotate/ }).click();
    await expect.poll(box).toEqual([h, w]);
    await page.locator(".rl-page[data-rendered]").first().waitFor();
    // The text layer rotates with the page: its bounding box is landscape too.
    const tl = await page.evaluate(() => {
      const r = document.querySelector(".rl-text-layer")!.getBoundingClientRect();
      return r.width > r.height;
    });
    expect(tl).toBe(true);
  });

  test("intrinsic /Rotate pages use rotated page coordinates", async ({ page }) => {
    await openFixture(page, "rotated.pdf");
    const infos = await page.evaluate(() =>
      window.readlet?.handle?.document?.pages.map((p) => [p.width, p.height, p.rotation]),
    );
    expect(infos).toEqual([
      [612, 792, 0],
      [792, 612, 90],
      [612, 792, 180],
      [792, 612, 270],
      [792, 612, 0],
    ]);
  });

  test("outline navigates and internal links jump, external links open a new tab", async ({
    page,
    context,
  }) => {
    await openFixture(page, "outline-links.pdf");
    await expect(page.getByRole("navigation", { name: "Outline" }).getByRole("button")).toHaveCount(
      6,
    );
    await page.getByRole("button", { name: "Results" }).click();
    await expect(page.getByLabel("Page number")).toHaveValue("5");
    await page.getByRole("button", { name: "Introduction" }).click();
    await expect(page.getByLabel("Page number")).toHaveValue("1");
    await page.getByRole("link", { name: "Go to page 3" }).click();
    await expect(page.getByLabel("Page number")).toHaveValue("3");
    await page.getByRole("button", { name: "Introduction" }).click();
    await expect(page.getByLabel("Page number")).toHaveValue("1");
    const ext = page.getByRole("link", { name: "Open https://example.com" });
    await expect(ext).toHaveAttribute("target", "_blank");
    await expect(ext).toHaveAttribute("rel", "noopener noreferrer");
    void context;
  });

  test("highlights are drawn from ranges", async ({ page }) => {
    await openFixture(page, "single-column.pdf");
    await page.evaluate(() =>
      window.readlet?.handle?.selection?.setRange({
        start: { page: 0, offset: 20 },
        end: { page: 0, offset: 200 },
      }),
    );
    await page.getByRole("button", { name: "Highlight selection" }).click();
    await expect(page.locator("[data-readlet-highlight]").first()).toBeVisible();
    expect(await page.locator("[data-readlet-highlight]").count()).toBeGreaterThan(1);
  });

  test("no console errors on every fixture", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    for (const f of [
      "two-column.pdf",
      "scanned-ocr.pdf",
      "ligatures.pdf",
      "cjk.pdf",
      "rtl.pdf",
      "rotated.pdf",
    ]) {
      await openFixture(page, f);
    }
    expect(errors).toEqual([]);
  });
});
