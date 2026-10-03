import type { TextItem } from "../../src/model/backend";

/** A horizontal LTR item at baseline (x, y) with font size `size`; 0.5 em per character. */
export function hItem(
  str: string,
  x: number,
  y: number,
  size = 10,
  extra: Partial<TextItem> = {},
): TextItem {
  return {
    str,
    dir: "ltr",
    transform: [size, 0, 0, -size, x, y],
    width: str.length * size * 0.5,
    height: size,
    hasEOL: false,
    fontFamily: "sans-serif",
    ascent: 0.8,
    vertical: false,
    ...extra,
  };
}

export const uniform = (text: string) => text.length;
