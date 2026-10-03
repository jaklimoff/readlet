import type { TextItem } from "./backend";
import { type Box, itemGeometry, itemSliceBox } from "./text-geometry";
import type { NormalisedPageText } from "./text-normalise";
import { rangeOnPage } from "./text-range";
import type { PageRect, TextRange } from "./types";

/**
 * Measures the advance width of `text` in `fontFamily` at any fixed font size. Only ratios of
 * results are used. In the browser this is `CanvasRenderingContext2D.measureText`.
 *
 * @example
 * ```ts
 * const uniform: TextMeasurer = (text) => text.length; // every character is equally wide
 * ```
 */
export type TextMeasurer = (text: string, fontFamily: string) => number;

/**
 * The text model of one page: the backend items and their normalised text.
 */
export interface PageTextModel {
  items: readonly TextItem[];
  normalised: NormalisedPageText;
}

/**
 * The fractions of an item's length covered by characters `[from, to)` of its string.
 *
 * @example
 * ```ts
 * sliceFractions("Hello", 1, 3, "sans-serif", measure, "ltr"); // about [0.25, 0.6]
 * ```
 */
export function sliceFractions(
  text: string,
  from: number,
  to: number,
  fontFamily: string,
  measure: TextMeasurer,
  dir: TextItem["dir"],
): [number, number] {
  const total = measure(text, fontFamily);
  let a: number;
  let b: number;
  if (total > 0) {
    a = measure(text.slice(0, from), fontFamily) / total;
    b = measure(text.slice(0, to), fontFamily) / total;
  } else {
    a = text.length ? from / text.length : 0;
    b = text.length ? to / text.length : 0;
  }
  a = Math.min(1, Math.max(0, a));
  b = Math.min(1, Math.max(a, b));
  return dir === "rtl" ? [1 - b, 1 - a] : [a, b];
}

interface Fragment {
  box: Box;
  item: number;
}

function canMerge(a: Box, b: Box): boolean {
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlap = bottom - top;
  const minHeight = Math.min(a.height, b.height);
  if (minHeight <= 0 || overlap < 0.5 * minHeight) return false;
  const gap = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  return gap <= 1.5 * Math.max(a.height, b.height);
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/**
 * Computes the rectangles of the part of `range` on one page, one rectangle per line fragment.
 *
 * @example
 * ```ts
 * const rects = pageRangeRects(range, 2, model, measure);
 * ```
 */
export function pageRangeRects(
  range: TextRange,
  page: number,
  model: PageTextModel,
  measure: TextMeasurer,
): PageRect[] {
  const { normalised, items } = model;
  const slice = rangeOnPage(range, page, normalised.text.length);
  if (!slice || slice.from === slice.to) return [];

  const newlineAfter = new Set<number>();
  for (const sep of normalised.separators) {
    if (sep.char === "\n" && sep.offset >= slice.from && sep.offset < slice.to) {
      newlineAfter.add(sep.afterItem);
    }
  }

  const fragments: Fragment[] = [];
  for (let i = 0; i < normalised.items.length; i++) {
    const n = normalised.items[i];
    const item = items[i];
    if (!n || !item || n.text.length === 0) continue;
    const end = n.start + n.text.length;
    const from = Math.max(slice.from, n.start);
    const to = Math.min(slice.to, end);
    if (from >= to) continue;
    const [fa, fb] = sliceFractions(
      n.text,
      from - n.start,
      to - n.start,
      item.fontFamily,
      measure,
      item.dir,
    );
    fragments.push({ box: itemSliceBox(itemGeometry(item), fa, fb), item: i });
  }

  const rects: PageRect[] = [];
  let current: Fragment | null = null;
  for (const frag of fragments) {
    if (current) {
      let lineBreak = false;
      for (let k = current.item; k < frag.item; k++) {
        if (newlineAfter.has(k)) {
          lineBreak = true;
          break;
        }
      }
      if (!lineBreak && canMerge(current.box, frag.box)) {
        current = { box: union(current.box, frag.box), item: frag.item };
        continue;
      }
      rects.push({ page, ...current.box });
    }
    current = frag;
  }
  if (current) rects.push({ page, ...current.box });
  return rects;
}

/**
 * Computes the rectangles of a range on every page it touches, in page coordinates. Pages whose
 * text model is not known (`getModel` returns `undefined`) are skipped.
 *
 * @example
 * ```ts
 * const rects = rangeToRects(range, (i) => models.get(i), measure);
 * ```
 */
export function rangeToRects(
  range: TextRange,
  getModel: (page: number) => PageTextModel | undefined,
  measure: TextMeasurer,
): PageRect[] {
  const out: PageRect[] = [];
  for (let page = range.start.page; page <= range.end.page; page++) {
    const model = getModel(page);
    if (model) out.push(...pageRangeRects(range, page, model, measure));
  }
  return out;
}
