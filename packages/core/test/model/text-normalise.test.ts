import { describe, expect, it } from "vitest";
import {
  normaliseItemString,
  normalisePageText,
  separatorBetween,
} from "../../src/model/text-normalise";
import { hItem } from "./helpers";

describe("normaliseItemString", () => {
  it("expands ligatures", () => {
    expect(normaliseItemString("ﬁrst ﬂoor ﬃce ﬄe ﬀ ﬅ ﬆ")).toBe("first floor ffice ffle ff st st");
  });
  it("turns tabs, newlines and NBSP into spaces and drops controls", () => {
    expect(normaliseItemString("a\tb\nc d\u0000e\u0085f")).toBe("a b c def");
  });
  it("applies NFC", () => {
    expect(normaliseItemString("é")).toBe("é");
  });
});

describe("separatorBetween", () => {
  it("adds nothing for touching runs", () => {
    const a = hItem("Hel", 0, 100);
    const b = hItem("lo", 15, 100);
    expect(separatorBetween(a, b, "Hel", "lo")).toBe("");
  });
  it("adds a space for a word gap", () => {
    const a = hItem("Hello", 0, 100);
    const b = hItem("world", 28, 100);
    expect(separatorBetween(a, b, "Hello", "world")).toBe(" ");
  });
  it("adds no space when one side already has whitespace", () => {
    const a = hItem("Hello ", 0, 100);
    const b = hItem("world", 40, 100);
    expect(separatorBetween(a, b, "Hello ", "world")).toBe("");
    expect(
      separatorBetween(hItem("Hello", 0, 100), hItem(" world", 40, 100), "Hello", " world"),
    ).toBe("");
  });
  it("adds a newline for a new line", () => {
    expect(separatorBetween(hItem("a", 0, 100), hItem("b", 0, 112), "a", "b")).toBe("\n");
  });
  it("keeps superscripts on the same line", () => {
    expect(separatorBetween(hItem("x", 0, 100), hItem("2", 5, 97, 6), "x", "2")).toBe("");
  });
  it("adds a newline after hasEOL", () => {
    expect(
      separatorBetween(hItem("a", 0, 100, 10, { hasEOL: true }), hItem("b", 5, 100), "a", "b"),
    ).toBe("\n");
  });
  it("adds a newline when the direction changes", () => {
    const rotated = hItem("b", 5, 100, 10, { transform: [0, 10, 10, 0, 5, 100] });
    expect(separatorBetween(hItem("a", 0, 100), rotated, "a", "b")).toBe("\n");
  });
  it("handles RTL runs laid out right to left", () => {
    const right = hItem("abc", 100, 100, 10, { dir: "rtl" });
    const left = hItem("def", 50, 100, 10, { dir: "rtl" });
    expect(separatorBetween(right, left, "abc", "def")).toBe(" ");
  });
});

describe("normalisePageText", () => {
  it("builds the page string and offsets", () => {
    const items = [
      hItem("Hello", 0, 100),
      hItem("world", 28, 100, 10, { hasEOL: true }),
      hItem("", 0, 0),
      hItem("Next", 0, 114),
    ];
    const out = normalisePageText(items);
    expect(out.text).toBe("Hello world\nNext");
    expect(out.items.map((i) => i.start)).toEqual([0, 6, 11, 12]);
    expect(out.items[2]?.text).toBe("");
    expect(out.separators).toEqual([
      { offset: 5, char: " ", afterItem: 0 },
      { offset: 11, char: "\n", afterItem: 1 },
    ]);
  });
  it("carries hasEOL of empty items", () => {
    const items = [hItem("a", 0, 100), hItem("", 5, 100, 10, { hasEOL: true }), hItem("b", 5, 100)];
    expect(normalisePageText(items).text).toBe("a\nb");
  });
  it("ignores an EOL before any text", () => {
    const items = [hItem("", 0, 100, 10, { hasEOL: true }), hItem("b", 5, 100)];
    expect(normalisePageText(items).text).toBe("b");
  });
  it("returns an empty string for no items", () => {
    expect(normalisePageText([])).toEqual({ text: "", items: [], separators: [] });
  });
  it("offsets match each item's text", () => {
    const items = [hItem("ﬁne", 0, 100), hItem("day", 30, 100)];
    const out = normalisePageText(items);
    for (const it of out.items)
      expect(out.text.slice(it.start, it.start + it.text.length)).toBe(it.text);
    expect(out.text).toBe("fine day");
  });
});
