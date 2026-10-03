import type { TextPosition, TextRange } from "./types";

/**
 * Compares two positions. Returns a negative number when `a` comes first, 0 when equal, and a
 * positive number when `b` comes first.
 *
 * @example
 * ```ts
 * comparePositions({ page: 0, offset: 5 }, { page: 1, offset: 0 }); // < 0
 * ```
 */
export function comparePositions(a: TextPosition, b: TextPosition): number {
  return a.page - b.page || a.offset - b.offset;
}

/**
 * Makes a range from two positions in any order.
 *
 * @example
 * ```ts
 * makeRange(focus, anchor); // start is always the earlier position
 * ```
 */
export function makeRange(a: TextPosition, b: TextPosition): TextRange {
  return comparePositions(a, b) <= 0
    ? { start: { ...a }, end: { ...b } }
    : { start: { ...b }, end: { ...a } };
}

/**
 * `true` when the range contains no characters.
 *
 * @example
 * ```ts
 * if (isCollapsed(range)) return null;
 * ```
 */
export function isCollapsed(range: TextRange): boolean {
  return comparePositions(range.start, range.end) === 0;
}

/**
 * `true` when both ranges have the same start and end.
 *
 * @example
 * ```ts
 * if (!rangesEqual(prev, next)) emit("change", next);
 * ```
 */
export function rangesEqual(a: TextRange | null, b: TextRange | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return comparePositions(a.start, b.start) === 0 && comparePositions(a.end, b.end) === 0;
}

function isPosition(value: unknown): value is TextPosition {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Number.isInteger(v.page) &&
    (v.page as number) >= 0 &&
    Number.isInteger(v.offset) &&
    (v.offset as number) >= 0
  );
}

/**
 * Validates a value, for example parsed JSON, as a `TextRange` with `start` not after `end`.
 *
 * @example
 * ```ts
 * const parsed: unknown = JSON.parse(saved);
 * if (isTextRange(parsed)) selection.setRange(parsed);
 * ```
 */
export function isTextRange(value: unknown): value is TextRange {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return isPosition(v.start) && isPosition(v.end) && comparePositions(v.start, v.end) <= 0;
}

/**
 * Clamps a range to a document. `pageLength(i)` returns the length of the page string, or
 * `undefined` when it is not known yet (the offset is then kept). Returns `null` when the range
 * is fully outside the document.
 *
 * @example
 * ```ts
 * const safe = clampRange(range, doc.pageCount, (i) => texts[i]?.length);
 * ```
 */
export function clampRange(
  range: TextRange,
  pageCount: number,
  pageLength: (page: number) => number | undefined,
): TextRange | null {
  if (pageCount <= 0 || range.start.page >= pageCount) return null;
  const clampPos = (pos: TextPosition): TextPosition => {
    if (pos.page >= pageCount) {
      const last = pageCount - 1;
      return { page: last, offset: pageLength(last) ?? Number.MAX_SAFE_INTEGER };
    }
    const len = pageLength(pos.page);
    return { page: pos.page, offset: len === undefined ? pos.offset : Math.min(pos.offset, len) };
  };
  return makeRange(clampPos(range.start), clampPos(range.end));
}

/**
 * The part of a range that falls on one page, as `[from, to)` offsets, or `null` when the range
 * does not touch the page. `pageLength` is the length of the page string.
 *
 * @example
 * ```ts
 * const slice = rangeOnPage(range, 3, text.length);
 * if (slice) text.slice(slice.from, slice.to);
 * ```
 */
export function rangeOnPage(
  range: TextRange,
  page: number,
  pageLength: number,
): { from: number; to: number } | null {
  if (page < range.start.page || page > range.end.page) return null;
  const from = page === range.start.page ? Math.min(range.start.offset, pageLength) : 0;
  const to = page === range.end.page ? Math.min(range.end.offset, pageLength) : pageLength;
  return { from, to: Math.max(from, to) };
}

/**
 * Returns the text that a range covers. Pages are joined with a newline. Pages whose text is not
 * known (`getText` returns `undefined`) are skipped.
 *
 * @example
 * ```ts
 * rangeToText(range, (i) => doc.getCachedText(i)?.text);
 * ```
 */
export function rangeToText(
  range: TextRange,
  getText: (page: number) => string | undefined,
): string {
  const parts: string[] = [];
  for (let page = range.start.page; page <= range.end.page; page++) {
    const text = getText(page);
    if (text === undefined) continue;
    const slice = rangeOnPage(range, page, text.length);
    if (slice) parts.push(text.slice(slice.from, slice.to));
  }
  return parts.join("\n");
}
