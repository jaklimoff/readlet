import { describe, expect, it } from "vitest";
import {
  clampRange,
  comparePositions,
  isCollapsed,
  isTextRange,
  makeRange,
  rangeOnPage,
  rangesEqual,
  rangeToText,
} from "../../src/model/text-range";

const p = (page: number, offset: number) => ({ page, offset });

describe("text-range", () => {
  it("compares positions", () => {
    expect(comparePositions(p(0, 5), p(1, 0))).toBeLessThan(0);
    expect(comparePositions(p(1, 5), p(1, 2))).toBeGreaterThan(0);
    expect(comparePositions(p(1, 2), p(1, 2))).toBe(0);
  });
  it("makes ordered ranges", () => {
    expect(makeRange(p(2, 1), p(1, 9))).toEqual({ start: p(1, 9), end: p(2, 1) });
    expect(makeRange(p(1, 1), p(1, 9))).toEqual({ start: p(1, 1), end: p(1, 9) });
  });
  it("detects collapsed and equal ranges", () => {
    expect(isCollapsed(makeRange(p(0, 1), p(0, 1)))).toBe(true);
    expect(rangesEqual(null, null)).toBe(true);
    expect(rangesEqual(makeRange(p(0, 1), p(0, 2)), null)).toBe(false);
    expect(rangesEqual(makeRange(p(0, 1), p(0, 2)), makeRange(p(0, 2), p(0, 1)))).toBe(true);
    expect(rangesEqual(makeRange(p(0, 1), p(0, 2)), makeRange(p(0, 1), p(0, 3)))).toBe(false);
  });
  it("validates JSON ranges", () => {
    expect(isTextRange(JSON.parse(JSON.stringify(makeRange(p(0, 1), p(3, 4)))))).toBe(true);
    expect(isTextRange({ start: p(1, 0), end: p(0, 0) })).toBe(false);
    expect(isTextRange({ start: p(-1, 0), end: p(0, 0) })).toBe(false);
    expect(isTextRange({ start: { page: 0.5, offset: 0 }, end: p(0, 0) })).toBe(false);
    expect(isTextRange({ start: p(0, 0) })).toBe(false);
    expect(isTextRange(null)).toBe(false);
    expect(isTextRange("x")).toBe(false);
    expect(isTextRange({ start: null, end: p(0, 0) })).toBe(false);
  });
  it("clamps to the document", () => {
    const len = (i: number) => [10, 20, undefined][i];
    expect(clampRange(makeRange(p(0, 5), p(1, 50)), 3, len)).toEqual(makeRange(p(0, 5), p(1, 20)));
    expect(clampRange(makeRange(p(0, 5), p(2, 99)), 3, len)).toEqual(makeRange(p(0, 5), p(2, 99)));
    expect(clampRange(makeRange(p(1, 5), p(9, 1)), 2, len)).toEqual(makeRange(p(1, 5), p(1, 20)));
    expect(clampRange(makeRange(p(0, 5), p(9, 1)), 3, len)).toEqual(
      makeRange(p(0, 5), p(2, Number.MAX_SAFE_INTEGER)),
    );
    expect(clampRange(makeRange(p(5, 0), p(6, 0)), 3, len)).toBeNull();
    expect(clampRange(makeRange(p(0, 0), p(0, 0)), 0, len)).toBeNull();
  });
  it("slices a range per page", () => {
    const r = makeRange(p(1, 3), p(3, 2));
    expect(rangeOnPage(r, 0, 10)).toBeNull();
    expect(rangeOnPage(r, 1, 10)).toEqual({ from: 3, to: 10 });
    expect(rangeOnPage(r, 2, 10)).toEqual({ from: 0, to: 10 });
    expect(rangeOnPage(r, 3, 10)).toEqual({ from: 0, to: 2 });
    expect(rangeOnPage(makeRange(p(0, 20), p(0, 30)), 0, 10)).toEqual({ from: 10, to: 10 });
  });
  it("joins page text with newlines", () => {
    const texts = ["page zero", "page one", undefined, "page three"];
    const get = (i: number) => texts[i];
    expect(rangeToText(makeRange(p(0, 5), p(1, 4)), get)).toBe("zero\npage");
    expect(rangeToText(makeRange(p(1, 5), p(3, 4)), get)).toBe("one\npage");
    expect(rangeToText(makeRange(p(0, 0), p(0, 4)), get)).toBe("page");
  });
});
