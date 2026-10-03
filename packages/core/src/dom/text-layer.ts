import { itemGeometry } from "../model/text-geometry";
import type { PageTextModel } from "../model/text-rects";
import { fallbackAscent, measureAt } from "./measure";

/** CSS class names used in the DOM that Readlet builds. */
export const CLASS = {
  viewer: "rl-viewer",
  page: "rl-page",
  canvas: "rl-canvas",
  layers: "rl-layers",
  textLayer: "rl-text-layer",
  separator: "rl-sep",
  endOfContent: "rl-eoc",
  linkLayer: "rl-link-layer",
  overlay: "rl-overlay",
  selecting: "rl-selecting",
} as const;

/** One text node of the layer and the page string offset of its first character. */
export interface TextNodeEntry {
  offset: number;
  length: number;
  node: Text;
}

const layers = new WeakMap<Element, TextLayer>();

/**
 * The invisible, selectable text over one page. Spans are positioned in percentages of the page
 * box and sized with `var(--rl-scale)`, so a zoom change needs no rebuild.
 */
export class TextLayer {
  readonly element: HTMLDivElement;
  readonly pageIndex: number;
  readonly endOfContent: HTMLDivElement;
  readonly textLength: number;
  readonly #entries: TextNodeEntry[] = [];
  readonly #nodeOffsets = new WeakMap<Node, number>();

  constructor(pageIndex: number, model: PageTextModel, pageWidth: number, pageHeight: number) {
    this.pageIndex = pageIndex;
    this.textLength = model.normalised.text.length;
    const el = document.createElement("div");
    el.className = CLASS.textLayer;
    el.dataset.pageIndex = String(pageIndex);
    this.element = el;

    const fragment = document.createDocumentFragment();
    const { items, normalised } = model;
    const seps = normalised.separators;
    let sepIndex = 0;
    let lastBox: { left: number; top: number; fontHeight: number; angle: number; family: string } | null =
      null;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const n = normalised.items[i];
      if (!item || !n || n.text.length === 0) continue;
      while (sepIndex < seps.length && (seps[sepIndex]?.offset ?? 0) < n.start) {
        const sep = seps[sepIndex++];
        if (sep && lastBox) fragment.append(this.#separator(sep.offset, sep.char, lastBox, pageWidth, pageHeight));
      }
      const g = itemGeometry(item);
      const ascent = fallbackAscent(item.fontFamily, item.ascent);
      const left = g.originX + ascent * g.fontHeight * Math.sin(g.angle);
      const top = g.originY - ascent * g.fontHeight * Math.cos(g.angle);
      const span = document.createElement("span");
      const textNode = document.createTextNode(n.text);
      span.append(textNode);
      const style = span.style;
      style.left = `${(left / pageWidth) * 100}%`;
      style.top = `${(top / pageHeight) * 100}%`;
      style.fontSize = `calc(var(--rl-scale) * ${round(g.fontHeight)}px)`;
      style.fontFamily = item.fontFamily;
      if (item.dir === "rtl") span.dir = "rtl";
      const natural = measureAt(n.text, item.fontFamily, g.fontHeight);
      const transforms: string[] = [];
      if (g.angle !== 0) transforms.push(`rotate(${round(g.angle)}rad)`);
      if (natural > 0 && g.length > 0) transforms.push(`scaleX(${round(g.length / natural)})`);
      if (transforms.length) style.transform = transforms.join(" ");
      span.dataset.o = String(n.start);
      this.#register(textNode, n.start);
      fragment.append(span);
      const end = g.length;
      lastBox = {
        left: left + end * Math.cos(g.angle),
        top: top + end * Math.sin(g.angle),
        fontHeight: g.fontHeight,
        angle: g.angle,
        family: item.fontFamily,
      };
    }

    const eoc = document.createElement("div");
    eoc.className = CLASS.endOfContent;
    this.endOfContent = eoc;
    fragment.append(eoc);
    el.append(fragment);
    layers.set(el, this);
  }

  #separator(
    offset: number,
    char: " " | "\n",
    box: { left: number; top: number; fontHeight: number; angle: number; family: string },
    pageWidth: number,
    pageHeight: number,
  ): HTMLSpanElement {
    const span = document.createElement("span");
    span.className = CLASS.separator;
    const textNode = document.createTextNode(char);
    span.append(textNode);
    span.style.left = `${(box.left / pageWidth) * 100}%`;
    span.style.top = `${(box.top / pageHeight) * 100}%`;
    span.style.fontSize = `calc(var(--rl-scale) * ${round(box.fontHeight)}px)`;
    span.style.fontFamily = box.family;
    if (box.angle !== 0) span.style.transform = `rotate(${round(box.angle)}rad)`;
    span.dataset.o = String(offset);
    this.#register(textNode, offset);
    return span;
  }

  #register(node: Text, offset: number): void {
    this.#entries.push({ offset, length: node.data.length, node });
    this.#nodeOffsets.set(node, offset);
  }

  /** Text nodes in offset order. */
  get entries(): readonly TextNodeEntry[] {
    return this.#entries;
  }

  /**
   * Converts a DOM boundary point inside this layer to a page string offset. `null` when the
   * point is not inside the layer.
   */
  offsetFromBoundary(node: Node, offset: number): number | null {
    if (!this.element.contains(node)) return null;
    const direct = this.#nodeOffsets.get(node);
    if (direct !== undefined) return direct + Math.min(offset, (node as Text).data.length);
    // An element inside the layer: a span, the layer itself, or the end-of-content div.
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node as Element;
    if (el === this.element) return this.#offsetFrom(el.childNodes[offset] ?? null);
    const own = el.firstChild ? this.#nodeOffsets.get(el.firstChild) : undefined;
    if (own !== undefined) return offset === 0 ? own : own + (el.firstChild as Text).data.length;
    // The end-of-content element (or any other non-text child): use the next text.
    return this.#offsetFrom(el.nextSibling);
  }

  /** Offset of the first text at or after the layer child `child`. */
  #offsetFrom(child: Node | null): number {
    for (let n = child; n; n = n.nextSibling) {
      const o = n.firstChild ? this.#nodeOffsets.get(n.firstChild) : undefined;
      if (o !== undefined) return o;
    }
    return this.textLength;
  }

  /**
   * Finds the DOM boundary point for a page string offset. `bias` decides which node wins at a
   * node boundary: `"forward"` for range starts, `"backward"` for range ends.
   */
  boundaryForOffset(offset: number, bias: "forward" | "backward"): { node: Text; offset: number } | null {
    const entries = this.#entries;
    if (entries.length === 0) return null;
    // Last entry with entry.offset <= offset.
    let lo = 0;
    let hi = entries.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((entries[mid] as TextNodeEntry).offset <= offset) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (idx === -1) {
      const first = entries[0] as TextNodeEntry;
      return { node: first.node, offset: 0 };
    }
    const e = entries[idx] as TextNodeEntry;
    const local = offset - e.offset;
    if (local < e.length) return { node: e.node, offset: local };
    if (local === e.length) {
      const next = entries[idx + 1];
      if (bias === "forward" && next && next.offset === offset) return { node: next.node, offset: 0 };
      return { node: e.node, offset: e.length };
    }
    // The offset falls in a gap (an empty item). Use the neighbour in the bias direction.
    const next = entries[idx + 1];
    if (bias === "forward" && next) return { node: next.node, offset: 0 };
    return { node: e.node, offset: e.length };
  }

  /** The layer object that owns a layer element. */
  static of(element: Element): TextLayer | undefined {
    return layers.get(element);
  }
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
