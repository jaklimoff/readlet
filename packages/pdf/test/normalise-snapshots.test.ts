// Snapshot tests of Readlet's text normalisation on every fixture PDF (decision 0001.3).
// A change in these snapshots changes TextRange offsets: it is a breaking change.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NORMALISATION_VERSION, normalisePageText } from "@readletjs/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { convertTextContent } from "../src/backend";

const FIXTURES = join(import.meta.dirname, "../../../fixtures");
const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".pdf") && !f.startsWith("large-"));

describe(`text normalisation v${NORMALISATION_VERSION}`, () => {
  for (const file of files) {
    it(file, async () => {
      const data = new Uint8Array(readFileSync(join(FIXTURES, file)));
      const task = getDocument({ data, verbosity: 0 });
      const doc = await task.promise;
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent({ disableNormalization: true });
        const items = convertTextContent(content, page.getViewport({ scale: 1 }).transform);
        const { text, items: offsets } = normalisePageText(items);
        for (const it of offsets)
          expect(text.slice(it.start, it.start + it.text.length)).toBe(it.text);
        pages.push(text);
      }
      await task.destroy();
      await expect(pages.join("\n\f\n")).toMatchFileSnapshot(`./__snapshots__/${file}.txt`);
    });
  }

  it("large-500.pdf (first and last pages)", async () => {
    const data = new Uint8Array(readFileSync(join(FIXTURES, "large-500.pdf")));
    const task = getDocument({ data, verbosity: 0 });
    const doc = await task.promise;
    const out: string[] = [];
    for (const i of [1, 250, 500]) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent({ disableNormalization: true });
      out.push(
        normalisePageText(convertTextContent(content, page.getViewport({ scale: 1 }).transform))
          .text,
      );
    }
    await task.destroy();
    await expect(out.join("\n\f\n")).toMatchFileSnapshot("./__snapshots__/large-500.pdf.txt");
  });
});
