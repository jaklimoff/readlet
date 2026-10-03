/**
 * Readlet's text normalisation algorithm.
 *
 * `TextRange` offsets are indexes into the string that this module builds. ANY change to the
 * output of this module is a breaking change under semver (decision 0001.3). Bump
 * {@link NORMALISATION_VERSION} and update the snapshot tests when you change it.
 *
 * Algorithm, version 1:
 *
 * 1. Each item string is normalised on its own: Unicode NFC, Latin ligatures U+FB00–U+FB06 are
 *    expanded (for example "ﬁ" → "fi"), tab / CR / LF / NBSP become a space, other C0 and C1
 *    control characters are removed.
 * 2. Items keep the backend's content order. Items whose normalised string is empty add no text,
 *    but their `hasEOL` flag carries over to the next item.
 * 3. Between two non-empty items, one separator can be added:
 *    - `"\n"` when the previous item has `hasEOL`, when the two items have different
 *      directions (angle difference over 1°), or when the baselines are apart by more than half
 *      of the larger font height across the text direction;
 *    - otherwise `" "` when the gap between the two runs along the text direction is more than
 *      0.15 × the larger font height, and neither side already has whitespace at the joint;
 *    - otherwise nothing.
 *    No separator is added before the first non-empty item.
 */

import type { TextItem } from "./backend";
import { itemGeometry } from "./text-geometry";

/**
 * The version of the normalisation algorithm. Stored ranges are only valid for the version that
 * made them.
 *
 * @example
 * ```ts
 * save({ range, normalisation: NORMALISATION_VERSION });
 * ```
 */
export const NORMALISATION_VERSION = 1;

/**
 * The text of one item inside the page string.
 *
 * @example
 * ```ts
 * const { start, text } = normalised.items[3];
 * normalised.text.slice(start, start + text.length) === text; // true
 * ```
 */
export interface NormalisedItem {
  /** Offset of the first character of this item in the page string. */
  start: number;
  /** The normalised item string. Its length can be zero. */
  text: string;
}

/**
 * A separator that the algorithm inserted between two items.
 *
 * @example
 * ```ts
 * const lineBreaks = normalised.separators.filter((s) => s.char === "\n").length;
 * ```
 */
export interface NormalisedSeparator {
  /** Offset of the separator in the page string. */
  offset: number;
  char: " " | "\n";
  /** Index of the item that comes before the separator. */
  afterItem: number;
}

/**
 * The normalised text of one page.
 *
 * @example
 * ```ts
 * const page = normalisePageText(items);
 * page.text.slice(range.start.offset, range.end.offset);
 * ```
 */
export interface NormalisedPageText {
  /** The page string. `TextRange` offsets index into it. */
  text: string;
  /** One entry per input item, same order and length as the input. */
  items: NormalisedItem[];
  /** Inserted separators, in offset order. */
  separators: NormalisedSeparator[];
}

const LIGATURES: Record<string, string> = {
  ﬀ: "ff",
  ﬁ: "fi",
  ﬂ: "fl",
  ﬃ: "ffi",
  ﬄ: "ffl",
  ﬅ: "st",
  ﬆ: "st",
};

const SPACE_LIKE = /[\t\n\r ]/g;
// C0 controls except tab, LF, CR (handled above), DEL, and C1 controls.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to remove them.
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const LIGATURE_CHARS = /[ﬀ-ﬆ]/g;

/**
 * Normalises one item string (step 1 of the algorithm).
 *
 * @example
 * ```ts
 * normaliseItemString("ﬁrst oor"); // "first oor"
 * ```
 */
export function normaliseItemString(str: string): string {
  return str
    .normalize("NFC")
    .replace(LIGATURE_CHARS, (ch) => LIGATURES[ch] ?? ch)
    .replace(SPACE_LIKE, " ")
    .replace(CONTROLS, "");
}

const ANGLE_EPSILON = (1 * Math.PI) / 180;
const LINE_FACTOR = 0.5;
const SPACE_FACTOR = 0.15;

/**
 * Decides the separator between two items (step 3 of the algorithm).
 *
 * @example
 * ```ts
 * separatorBetween(prevItem, item, prevText, text); // " ", "\n" or ""
 * ```
 */
export function separatorBetween(
  prev: TextItem,
  cur: TextItem,
  prevText: string,
  curText: string,
  prevHasEOL = prev.hasEOL,
): "" | " " | "\n" {
  if (prevHasEOL) return "\n";
  const p = itemGeometry(prev);
  const c = itemGeometry(cur);
  const angleDiff = Math.abs(normaliseAngle(p.angle - c.angle));
  if (angleDiff > ANGLE_EPSILON) return "\n";

  const fontHeight = Math.max(p.fontHeight, c.fontHeight);
  const cos = Math.cos(p.angle);
  const sin = Math.sin(p.angle);
  const dx = c.originX - p.originX;
  const dy = c.originY - p.originY;
  const across = -dx * sin + dy * cos;
  if (Math.abs(across) > LINE_FACTOR * fontHeight) return "\n";

  // Interval gap along the direction. Works for both LTR and RTL runs.
  const curStart = dx * cos + dy * sin;
  const curEnd = curStart + c.length;
  const gap = Math.max(curStart - p.length, 0 - curEnd);
  if (gap <= SPACE_FACTOR * fontHeight) return "";
  if (/\s$/.test(prevText) || /^\s/.test(curText)) return "";
  return " ";
}

function normaliseAngle(angle: number): number {
  let a = angle % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Builds the page string from the backend's text items.
 *
 * @example
 * ```ts
 * const { text, items } = normalisePageText(await page.getTextItems());
 * ```
 */
export function normalisePageText(input: readonly TextItem[]): NormalisedPageText {
  let text = "";
  const items: NormalisedItem[] = [];
  const separators: NormalisedSeparator[] = [];
  let prevIndex = -1;
  let prevText = "";
  let pendingEOL = false;

  for (let i = 0; i < input.length; i++) {
    const item = input[i] as TextItem;
    const itemText = normaliseItemString(item.str);
    if (itemText.length === 0) {
      items.push({ start: text.length, text: "" });
      if (item.hasEOL && prevIndex >= 0) pendingEOL = true;
      continue;
    }
    if (prevIndex >= 0) {
      const prev = input[prevIndex] as TextItem;
      const sep = separatorBetween(prev, item, prevText, itemText, prev.hasEOL || pendingEOL);
      if (sep) {
        separators.push({ offset: text.length, char: sep, afterItem: prevIndex });
        text += sep;
      }
    }
    items.push({ start: text.length, text: itemText });
    text += itemText;
    prevIndex = i;
    prevText = itemText;
    pendingEOL = false;
  }
  return { text, items, separators };
}
