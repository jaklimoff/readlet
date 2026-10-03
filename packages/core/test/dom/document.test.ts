import { describe, expect, it } from "vitest";
import { loadDocument } from "../../src/dom/document";
import type { BackendPage, DocumentBackend } from "../../src/model/backend";
import type { PageInfo, Rotation } from "../../src/model/types";

/** A backend whose pages have the given sizes; it records which pages were loaded. */
function fakeBackend(sizes: Array<[number, number, Rotation?]>) {
  const loaded: number[] = [];
  const backend: DocumentBackend = {
    name: "fake",
    async load() {
      return {
        pageCount: sizes.length,
        async getPage(index): Promise<BackendPage> {
          const size = sizes[index];
          if (!size) throw new RangeError(`no page ${index}`);
          loaded.push(index);
          return {
            index,
            width: size[0],
            height: size[1],
            rotation: size[2] ?? 0,
            render: async () => {},
            getTextItems: async () => [],
            getLinks: async () => [],
            cleanup: () => {},
          };
        },
        getOutline: async () => [],
        destroy: async () => {},
      };
    },
  };
  return { backend, loaded };
}

describe("loadDocument page sizes", () => {
  it("lazy (default): loads only the initial page and estimates the others from it", async () => {
    const { backend, loaded } = fakeBackend([
      [612, 792],
      [792, 612, 90],
      [612, 792],
    ]);
    const doc = await loadDocument("x.pdf", { backend, initialPage: 1 });
    expect(loaded).toEqual([1]);
    expect(doc.pages).toEqual([
      { index: 0, width: 792, height: 612, rotation: 90, estimated: true },
      { index: 1, width: 792, height: 612, rotation: 90, estimated: false },
      { index: 2, width: 792, height: 612, rotation: 90, estimated: true },
    ]);
  });

  it("clamps initialPage into the document", async () => {
    const { backend, loaded } = fakeBackend([
      [100, 100],
      [200, 200],
    ]);
    await loadDocument("x.pdf", { backend, initialPage: 99 });
    expect(loaded).toEqual([1]);
  });

  it("eager: loads every page before it resolves", async () => {
    const { backend, loaded } = fakeBackend([
      [100, 100],
      [200, 300],
    ]);
    const doc = await loadDocument("x.pdf", { backend, pageSizes: "eager" });
    expect(loaded.sort()).toEqual([0, 1]);
    expect(doc.pages.every((p) => !p.estimated)).toBe(true);
    expect(doc.getPageInfo(1)).toMatchObject({ width: 200, height: 300 });
  });

  it("replaces an estimate when the page loads and emits pageinfo once", async () => {
    const { backend } = fakeBackend([
      [100, 100],
      [200, 300],
    ]);
    const doc = await loadDocument("x.pdf", { backend });
    const events: PageInfo[] = [];
    doc.on("pageinfo", (info) => events.push(info));
    const before = doc.getPageInfo(1);
    expect(before.estimated).toBe(true);

    await doc.getPage(1);
    await doc.getPage(1);
    expect(events).toEqual([{ index: 1, width: 200, height: 300, rotation: 0, estimated: false }]);
    expect(doc.getPageInfo(1)).toBe(events[0]);
    // The old object is not mutated.
    expect(before).toMatchObject({ width: 100, estimated: true });
  });

  it("loadPageInfo returns the real info and loads the page only when needed", async () => {
    const { backend, loaded } = fakeBackend([
      [100, 100],
      [200, 300],
    ]);
    const doc = await loadDocument("x.pdf", { backend });
    expect(await doc.loadPageInfo(1)).toMatchObject({ width: 200, height: 300, estimated: false });
    expect(await doc.loadPageInfo(0)).toMatchObject({ width: 100, estimated: false });
    expect(loaded).toEqual([0, 1]);
  });

  it("loading the text of a page also records its size", async () => {
    const { backend } = fakeBackend([
      [100, 100],
      [200, 300],
    ]);
    const doc = await loadDocument("x.pdf", { backend });
    await doc.getTextModel(1);
    expect(doc.getPageInfo(1).estimated).toBe(false);
  });

  it("handles an empty document", async () => {
    const { backend } = fakeBackend([]);
    const doc = await loadDocument("x.pdf", { backend });
    expect(doc.pageCount).toBe(0);
  });
});
