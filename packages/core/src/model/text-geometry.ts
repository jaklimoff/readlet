import type { TextItem } from "./backend";

/**
 * The box of one text item in page coordinates, the same geometry the pdf.js text layer uses.
 * The box starts at (`left`, `top`), runs `length` along `angle`, and is `fontHeight` thick.
 */
export interface ItemGeometry {
  left: number;
  top: number;
  /** Rotation of the run in radians, clockwise in y-down page space. */
  angle: number;
  fontHeight: number;
  /** Length of the run along its direction. */
  length: number;
  /** Baseline origin of the run. */
  originX: number;
  originY: number;
}

/**
 * Computes the box of a text item.
 *
 * @example
 * ```ts
 * const g = itemGeometry(item);
 * span.style.left = `${(g.left / pageWidth) * 100}%`;
 * ```
 */
export function itemGeometry(item: TextItem): ItemGeometry {
  const [a, b, c, d, e, f] = item.transform;
  let angle = Math.atan2(b, a);
  if (item.vertical) angle += Math.PI / 2;
  const fontHeight = Math.hypot(c, d);
  const ascent = fontHeight * clampAscent(item.ascent);
  let left: number;
  let top: number;
  if (angle === 0) {
    left = e;
    top = f - ascent;
  } else {
    left = e + ascent * Math.sin(angle);
    top = f - ascent * Math.cos(angle);
  }
  return {
    left,
    top,
    angle,
    fontHeight,
    length: item.vertical ? item.height : item.width,
    originX: e,
    originY: f,
  };
}

function clampAscent(ascent: number): number {
  if (!Number.isFinite(ascent) || ascent <= 0 || ascent > 1.5) return 0.8;
  return ascent;
}

/** An axis-aligned box. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The axis-aligned bounding box of the part of an item between fractions `from` and `to` of its
 * length (0 = start of the run, 1 = end).
 *
 * @example
 * ```ts
 * const whole = itemSliceBox(itemGeometry(item), 0, 1);
 * ```
 */
export function itemSliceBox(g: ItemGeometry, from: number, to: number): Box {
  const cos = Math.cos(g.angle);
  const sin = Math.sin(g.angle);
  const s0 = g.length * from;
  const s1 = g.length * to;
  // Corners: along the direction (cos, sin), across the direction (-sin, cos).
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of [s0, s1]) {
    for (const t of [0, g.fontHeight]) {
      xs.push(g.left + s * cos - t * sin);
      ys.push(g.top + s * sin + t * cos);
    }
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
