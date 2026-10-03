import { describe, expect, it } from "vitest";
import { itemGeometry, itemSliceBox } from "../../src/model/text-geometry";
import { normalisePageText } from "../../src/model/text-normalise";
import { pageRangeRects, rangeToRects, sliceFractions } from "../../src/model/text-rects";
import { makeRange } from "../../src/model/text-range";
import { hItem, uniform } from "./helpers";

const p = (page: number, offset: number) => ({ page, offset });

describe("itemGeometry", () => {
  it("matches the pdf.js layout for horizontal text", () => {
    const g = itemGeometry(hItem("abcd", 10, 100, 10));
    expect(g).toMatchObject({ left: 10, top: 92, angle: 0, fontHeight: 10, length: 20 });
  });
  it("handles rotated text", () => {
    const item = hItem("ab", 50, 50, 10, { transform: [0, 10, 10, 0, 50, 50] });
    const g = itemGeometry(item);
    expect(g.angle).toBeCloseTo(Math.PI / 2);
    expect(g.left).toBeCloseTo(58);
    expect(g.top).toBeCloseTo(50);
    const box = itemSliceBox(g, 0, 1);
    expect(box.x).toBeCloseTo(48);
    expect(box.y).toBeCloseTo(50);
    expect(box.width).toBeCloseTo(10);
    expect(box.height).toBeCloseTo(10);
  });
  it("uses the height for vertical text and a default ascent", () => {
    const g = itemGeometry(hItem("ab", 0, 0, 10, { vertical: true, height: 33, ascent: Number.NaN }));
    expect(g.length).toBe(33);
    expect(g.angle).toBeCloseTo(Math.PI / 2);
  });
});

describe("sliceFractions", () => {
  it("uses the measurer", () => {
    expect(sliceFractions("abcd", 1, 3, "x", uniform, "ltr")).toEqual([0.25, 0.75]);
  });
  it("mirrors RTL", () => {
    expect(sliceFractions("abcd", 0, 1, "x", uniform, "rtl")).toEqual([0.75, 1]);
  });
  it("falls back to character counts when the measurer returns 0", () => {
    expect(sliceFractions("abcd", 2, 4, "x", () => 0, "ltr")).toEqual([0.5, 1]);
    expect(sliceFractions("", 0, 0, "x", () => 0, "ltr")).toEqual([0, 0]);
  });
});

describe("pageRangeRects", () => {
  const items = [
    hItem("Hello", 0, 100),
    hItem("world", 28, 100, 10, { hasEOL: true }),
    hItem("Second", 0, 114),
    hItem("line", 35, 114),
  ];
  const model = { items, normalised: normalisePageText(items) };
  // "Hello world\nSecond line"

  it("returns one rect per line", () => {
    const rects = pageRangeRects(makeRange(p(0, 2), p(0, 15)), 0, model, uniform);
    expect(rects).toHaveLength(2);
    expect(rects[0]).toMatchObject({ page: 0, x: 10, y: 92, height: 10 });
    expect(rects[0]?.width).toBeCloseTo(43);
    expect(rects[1]).toMatchObject({ page: 0, x: 0, y: 106, width: 15, height: 10 });
  });
  it("returns nothing for empty or foreign ranges", () => {
    expect(pageRangeRects(makeRange(p(0, 3), p(0, 3)), 0, model, uniform)).toEqual([]);
    expect(pageRangeRects(makeRange(p(1, 0), p(1, 3)), 0, model, uniform)).toEqual([]);
  });
  it("does not merge across a newline even when boxes would merge", () => {
    const its = [hItem("ab", 0, 100, 10, { hasEOL: true }), hItem("cd", 12, 100)];
    const m = { items: its, normalised: normalisePageText(its) };
    expect(m.normalised.text).toBe("ab\ncd");
    expect(pageRangeRects(makeRange(p(0, 0), p(0, 5)), 0, m, uniform)).toHaveLength(2);
  });
  it("covers several pages and skips unknown ones", () => {
    const rects = rangeToRects(makeRange(p(0, 18), p(2, 5)), (i) => (i === 1 ? undefined : model), uniform);
    expect(rects.map((r) => r.page)).toEqual([0, 2]);
  });
});
