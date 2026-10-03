import type { Rotation, ZoomMode } from "./types";

/**
 * CSS pixels per point at scale 1 ("actual size").
 *
 * @example
 * ```ts
 * const cssWidth = page.width * scale * PT_TO_CSS;
 * ```
 */
export const PT_TO_CSS = 96 / 72;

/**
 * A width and height pair.
 *
 * @example
 * ```ts
 * const letter: Size = { width: 612, height: 792 };
 * ```
 */
export interface Size {
  width: number;
  height: number;
}

/**
 * The size after a user rotation. 90 and 270 swap width and height.
 *
 * @example
 * ```ts
 * rotateSize({ width: 612, height: 792 }, 90); // { width: 792, height: 612 }
 * ```
 */
export function rotateSize(size: Size, rotation: Rotation): Size {
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

/**
 * Positions of pages in a vertical column, in CSS pixels.
 *
 * @example
 * ```ts
 * const { tops, totalHeight } = columnLayout(sizes, { gap: 16, padding: 16 });
 * ```
 */
export interface ColumnLayout {
  /** Top edge of each page slot. */
  tops: number[];
  /** CSS size of each page slot. */
  sizes: Size[];
  /** Height of the full column, padding included. */
  totalHeight: number;
  /** Width of the widest page. */
  maxWidth: number;
}

/**
 * Lays out pages in one vertical column.
 *
 * @example
 * ```ts
 * const layout = columnLayout(sizes, { gap: 16, padding: 16 });
 * ```
 */
export function columnLayout(
  sizes: readonly Size[],
  opts: { gap: number; padding: number },
): ColumnLayout {
  const tops: number[] = [];
  let y = opts.padding;
  let maxWidth = 0;
  for (let i = 0; i < sizes.length; i++) {
    const s = sizes[i] as Size;
    if (i > 0) y += opts.gap;
    tops.push(y);
    y += s.height;
    if (s.width > maxWidth) maxWidth = s.width;
  }
  return { tops, sizes: sizes.map((s) => ({ ...s })), totalHeight: y + opts.padding, maxWidth };
}

/**
 * The index of the last page whose top is at or above `y`, or 0.
 *
 * @example
 * ```ts
 * const first = pageAtY(layout, scrollTop);
 * ```
 */
export function pageAtY(layout: ColumnLayout, y: number): number {
  const { tops } = layout;
  let lo = 0;
  let hi = tops.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((tops[mid] as number) <= y) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/**
 * The pages that intersect the band `[top - buffer, top + height + buffer]`, as an inclusive
 * index range. Returns `null` for an empty layout.
 *
 * @example
 * ```ts
 * const range = visiblePages(layout, el.scrollTop, el.clientHeight, el.clientHeight);
 * ```
 */
export function visiblePages(
  layout: ColumnLayout,
  top: number,
  height: number,
  buffer = 0,
): { first: number; last: number } | null {
  const n = layout.tops.length;
  if (n === 0) return null;
  const bandTop = top - buffer;
  const bandBottom = top + height + buffer;
  let first = pageAtY(layout, bandTop);
  // The page at bandTop can end above the band (inside a gap).
  const firstBottom = (layout.tops[first] as number) + (layout.sizes[first] as Size).height;
  if (firstBottom < bandTop && first < n - 1) first++;
  const last = Math.max(first, pageAtY(layout, bandBottom));
  return { first, last };
}

/**
 * The page with the largest visible height in the band `[top, top + height]`. Ties go to the
 * earlier page.
 *
 * @example
 * ```ts
 * const current = mostVisiblePage(layout, el.scrollTop, el.clientHeight);
 * ```
 */
export function mostVisiblePage(layout: ColumnLayout, top: number, height: number): number {
  const range = visiblePages(layout, top, height);
  if (!range) return 0;
  let best = range.first;
  let bestVisible = -1;
  for (let i = range.first; i <= range.last; i++) {
    const t = layout.tops[i] as number;
    const b = t + (layout.sizes[i] as Size).height;
    const visible = Math.min(b, top + height) - Math.max(t, top);
    if (visible > bestVisible + 0.5) {
      best = i;
      bestVisible = visible;
    }
  }
  return best;
}

/**
 * Resolves a zoom mode to a numeric scale. `pageSizes` are in points with the user rotation
 * applied. `container` is the free space in CSS pixels (padding already removed).
 *
 * @example
 * ```ts
 * const scale = resolveScale("fit-width", sizes, { width: 800, height: 600 }, current);
 * ```
 */
export function resolveScale(
  zoom: ZoomMode,
  pageSizes: readonly Size[],
  container: Size,
  currentPage: number,
  limits: { min: number; max: number } = { min: 0.1, max: 10 },
): number {
  let scale: number;
  if (typeof zoom === "number") {
    scale = zoom;
  } else {
    const ref =
      zoom === "fit-width"
        ? { width: Math.max(1, ...pageSizes.map((s) => s.width)), height: 1 }
        : (pageSizes[currentPage] ?? pageSizes[0] ?? { width: 1, height: 1 });
    const byWidth = container.width / (ref.width * PT_TO_CSS);
    scale =
      zoom === "fit-width"
        ? byWidth
        : Math.min(byWidth, container.height / (ref.height * PT_TO_CSS));
  }
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  return Math.min(limits.max, Math.max(limits.min, scale));
}

/**
 * The device pixel ratio to render with: the real one, capped at 3, and lowered further when the
 * canvas would exceed `maxPixels`.
 *
 * @example
 * ```ts
 * const dpr = effectiveDpr(window.devicePixelRatio, cssW, cssH, 16_777_216);
 * ```
 */
export function effectiveDpr(
  dpr: number,
  cssWidth: number,
  cssHeight: number,
  maxPixels: number,
): number {
  let ratio = Math.min(3, Math.max(1, Number.isFinite(dpr) ? dpr : 1));
  const area = cssWidth * cssHeight;
  if (area > 0 && area * ratio * ratio > maxPixels) {
    ratio = Math.sqrt(maxPixels / area);
  }
  return ratio;
}
