import type { TextMeasurer } from "../model/text-rects";

const MEASURE_SIZE = 100;

let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
const widthCache = new Map<string, number>();
const ascentCache = new Map<string, number>();

function getContext(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  if (context !== undefined) return context;
  if (typeof OffscreenCanvas !== "undefined") {
    context = new OffscreenCanvas(1, 1).getContext("2d");
  } else if (typeof document !== "undefined") {
    context = document.createElement("canvas").getContext("2d");
  } else {
    context = null;
  }
  return context;
}

function measureWidth(text: string, fontFamily: string): number {
  if (text.length === 0) return 0;
  const key = `${fontFamily}\u0000${text}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;
  const ctx = getContext();
  let width = text.length * MEASURE_SIZE * 0.5;
  if (ctx) {
    ctx.font = `${MEASURE_SIZE}px ${fontFamily}`;
    width = ctx.measureText(text).width;
  }
  if (widthCache.size > 20_000) widthCache.clear();
  widthCache.set(key, width);
  return width;
}

/**
 * The text measurer that the text layer and `rangeToRects` share. It measures with a canvas at a
 * fixed font size, so results are ratios that do not depend on zoom.
 *
 * @example
 * ```ts
 * const measure = canvasMeasurer();
 * const w = measure("Hello", "sans-serif");
 * ```
 */
export function canvasMeasurer(): TextMeasurer {
  return measureWidth;
}

/** Width of `text` at a font size of `size` CSS px. */
export function measureAt(text: string, fontFamily: string, size: number): number {
  return (measureWidth(text, fontFamily) * size) / MEASURE_SIZE;
}

/**
 * The ascent of the browser font used for the invisible text, as a fraction of the font size.
 * The same approach as pdf.js: the glyph baseline in the text layer then matches the canvas.
 */
export function fallbackAscent(fontFamily: string, fallback: number): number {
  const cached = ascentCache.get(fontFamily);
  if (cached !== undefined) return cached;
  const ctx = getContext();
  let ratio = fallback;
  if (ctx) {
    ctx.font = `${MEASURE_SIZE}px ${fontFamily}`;
    const m = ctx.measureText("");
    const ascent = m.fontBoundingBoxAscent;
    const descent = Math.abs(m.fontBoundingBoxDescent);
    if (ascent > 0 && ascent + descent > 0) ratio = ascent / (ascent + descent);
  }
  ascentCache.set(fontFamily, ratio);
  return ratio;
}
