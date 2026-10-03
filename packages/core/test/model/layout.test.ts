import { describe, expect, it } from "vitest";
import {
  PT_TO_CSS,
  columnLayout,
  effectiveDpr,
  mostVisiblePage,
  pageAtY,
  resolveScale,
  rotateSize,
  visiblePages,
} from "../../src/model/layout";

const sizes = [100, 100, 200, 100].map((h) => ({ width: 50, height: h }));
const layout = columnLayout(sizes, { gap: 10, padding: 5 });

describe("layout", () => {
  it("rotates sizes", () => {
    expect(rotateSize({ width: 1, height: 2 }, 90)).toEqual({ width: 2, height: 1 });
    expect(rotateSize({ width: 1, height: 2 }, 180)).toEqual({ width: 1, height: 2 });
    expect(rotateSize({ width: 1, height: 2 }, 270)).toEqual({ width: 2, height: 1 });
  });
  it("lays out a column", () => {
    expect(layout.tops).toEqual([5, 115, 225, 435]);
    expect(layout.totalHeight).toBe(540);
    expect(layout.maxWidth).toBe(50);
  });
  it("finds pages by y", () => {
    expect(pageAtY(layout, 0)).toBe(0);
    expect(pageAtY(layout, 120)).toBe(1);
    expect(pageAtY(layout, 10_000)).toBe(3);
  });
  it("finds visible pages with a buffer", () => {
    expect(visiblePages(layout, 0, 50)).toEqual({ first: 0, last: 0 });
    expect(visiblePages(layout, 108, 5)).toEqual({ first: 1, last: 1 });
    expect(visiblePages(layout, 120, 200)).toEqual({ first: 1, last: 2 });
    expect(visiblePages(layout, 120, 10, 200)).toEqual({ first: 0, last: 2 });
    expect(visiblePages(columnLayout([], { gap: 0, padding: 0 }), 0, 10)).toBeNull();
  });
  it("picks the most visible page", () => {
    expect(mostVisiblePage(layout, 100, 200)).toBe(1);
    expect(mostVisiblePage(layout, 200, 250)).toBe(2);
    expect(mostVisiblePage(layout, 0, 50)).toBe(0);
    expect(mostVisiblePage(columnLayout([], { gap: 0, padding: 0 }), 0, 10)).toBe(0);
  });
  it("resolves scales", () => {
    const pages = [
      { width: 600, height: 800 },
      { width: 300, height: 400 },
    ];
    expect(resolveScale(1.5, pages, { width: 1, height: 1 }, 0)).toBe(1.5);
    expect(resolveScale("fit-width", pages, { width: 600 * PT_TO_CSS, height: 10 }, 1)).toBeCloseTo(1);
    expect(resolveScale("fit-page", pages, { width: 1000, height: 400 * PT_TO_CSS }, 1)).toBeCloseTo(1);
    expect(resolveScale("fit-page", [], { width: 100, height: 100 }, 0)).toBe(10);
    expect(resolveScale(-1, pages, { width: 1, height: 1 }, 0)).toBe(1);
    expect(resolveScale(100, pages, { width: 1, height: 1 }, 0)).toBe(10);
  });
  it("caps the device pixel ratio", () => {
    expect(effectiveDpr(2, 100, 100, 1e9)).toBe(2);
    expect(effectiveDpr(5, 100, 100, 1e9)).toBe(3);
    expect(effectiveDpr(Number.NaN, 100, 100, 1e9)).toBe(1);
    expect(effectiveDpr(2, 1000, 1000, 1e6)).toBe(1);
  });
});
