import { Emitter, type Subscribable } from "../model/emitter";
import { clampRange, isCollapsed, makeRange, rangesEqual } from "../model/text-range";
import type { PageRect, TextPosition, TextRange } from "../model/types";
import { CLASS, TextLayer } from "./text-layer";
import type { Viewport } from "./viewport";

/**
 * Events of a {@link SelectionManager}.
 *
 * @example
 * ```ts
 * selection.on("change", (range) => share(range));
 * ```
 */
export interface SelectionEvents {
  /** The selection changed. `null` when nothing is selected. Debounced to one animation frame. */
  change: TextRange | null;
}

/**
 * Options for {@link createSelectionManager}.
 *
 * @example
 * ```ts
 * createSelectionManager(viewport, { handleCopy: false });
 * ```
 */
export interface SelectionManagerOptions {
  /**
   * Replace the clipboard text on copy with {@link SelectionManager.rangeToText}, so the copied
   * text equals the range text. Default `true`.
   */
  handleCopy?: boolean;
}

/**
 * Turns the native DOM selection inside a viewport into {@link TextRange}s and back.
 *
 * Create it with {@link createSelectionManager}.
 *
 * @example
 * ```ts
 * const selection = createSelectionManager(viewport);
 * selection.on("change", (range) => {
 *   if (range) console.log(selection.rangeToText(range));
 * });
 * ```
 */
export class SelectionManager implements Subscribable<SelectionEvents> {
  readonly viewport: Viewport;
  readonly #emitter = new Emitter<SelectionEvents>();
  #range: TextRange | null = null;
  /** A range set with `setRange` that is wider than the part that is rendered now. */
  #requested: TextRange | null = null;
  /** The DOM range we applied for `#requested`, to detect user changes. */
  #applied: Range | null = null;
  #frame = 0;
  #destroyed = false;
  #pointerDown = false;
  #prevDomRange: Range | null = null;
  #captured: TextRange | null = null;
  #cleanups: Array<() => void> = [];

  /** @internal Use {@link createSelectionManager}. */
  constructor(viewport: Viewport, options: SelectionManagerOptions = {}) {
    this.viewport = viewport;
    const doc = viewport.container.ownerDocument;
    const onSelectionChange = () => {
      this.#updateSelectingClass();
      this.#schedule();
    };
    const onPointerDown = () => {
      this.#pointerDown = true;
    };
    const onPointerUp = () => {
      this.#pointerDown = false;
      this.#resetEndOfContent();
    };
    doc.addEventListener("selectionchange", onSelectionChange);
    doc.addEventListener("pointerdown", onPointerDown);
    doc.addEventListener("pointerup", onPointerUp);
    this.#cleanups.push(() => {
      doc.removeEventListener("selectionchange", onSelectionChange);
      doc.removeEventListener("pointerdown", onPointerDown);
      doc.removeEventListener("pointerup", onPointerUp);
    });
    if (options.handleCopy ?? true) {
      const onCopy = (e: ClipboardEvent) => this.#onCopy(e);
      viewport.container.addEventListener("copy", onCopy);
      this.#cleanups.push(() => viewport.container.removeEventListener("copy", onCopy));
    }
    this.#cleanups.push(
      viewport.on("beforelayout", () => {
        this.#captured = this.#range;
      }),
      viewport.on("layout", () => {
        const captured = this.#captured;
        this.#captured = null;
        if (captured && !rangesEqual(this.#readDom(), captured)) this.#apply(captured);
      }),
      viewport.on("textlayer", ({ page, present }) => {
        const req = this.#requested;
        if (present && req && page >= req.start.page && page <= req.end.page) this.#apply(req);
      }),
      viewport.on("destroy", () => this.destroy()),
    );
  }

  /**
   * The current selection as a range, or `null`.
   *
   * @example
   * ```ts
   * const range = selection.getRange();
   * if (range) save(JSON.stringify(range));
   * ```
   */
  getRange(): TextRange | null {
    return this.#range ? cloneRange(this.#range) : null;
  }

  /**
   * Selects a range in the DOM. Pages of the range that are not rendered are skipped without an
   * error; when they render later, the DOM selection grows to cover them. `null` clears the
   * selection.
   *
   * @example
   * ```ts
   * const saved: unknown = JSON.parse(localStorage.getItem("sel") ?? "null");
   * if (isTextRange(saved)) selection.setRange(saved);
   * ```
   */
  setRange(range: TextRange | null): void {
    if (this.#destroyed) return;
    const doc = this.viewport.document;
    const clamped = range
      ? clampRange(range, doc.pageCount, (p) => doc.getCachedTextModel(p)?.normalised.text.length)
      : null;
    if (!clamped || isCollapsed(clamped)) {
      this.#requested = null;
      this.#applied = null;
      const sel = this.#selection();
      if (sel && this.#readDom()) sel.removeAllRanges();
      this.#set(null);
      return;
    }
    this.#requested = clamped;
    this.#apply(clamped);
    this.#set(clamped);
    void doc.loadTextFor(clamped).catch(() => {});
  }

  /**
   * Rectangles of a range in page coordinates, one per line fragment. Pages whose text has not
   * loaded yet are skipped.
   *
   * @example
   * ```ts
   * for (const r of selection.rangeToRects(range)) drawBox(r.page, r);
   * ```
   */
  rangeToRects(range: TextRange): PageRect[] {
    return this.viewport.document.rangeToRects(range);
  }

  /**
   * The text of a range, pages joined with a newline. This is also what copy puts on the
   * clipboard.
   *
   * @example
   * ```ts
   * const text = selection.rangeToText(range);
   * ```
   */
  rangeToText(range: TextRange): string {
    return this.viewport.document.rangeToText(range);
  }

  /**
   * Converts a DOM `Selection` to a range inside this viewport, or `null` when it is collapsed
   * or outside the viewport.
   *
   * @example
   * ```ts
   * const range = selection.selectionToRange(document.getSelection()!);
   * ```
   */
  selectionToRange(sel: Selection): TextRange | null {
    if (sel.rangeCount === 0 || sel.isCollapsed) return null;
    const first = sel.getRangeAt(0);
    const last = sel.getRangeAt(sel.rangeCount - 1);
    const start = this.#position(first.startContainer, first.startOffset, "start");
    const end = this.#position(last.endContainer, last.endOffset, "end");
    if (!start || !end) return null;
    const range = makeRange(start, end);
    return isCollapsed(range) ? null : range;
  }

  on<K extends keyof SelectionEvents>(
    type: K,
    listener: (payload: SelectionEvents[K]) => void,
  ): () => void {
    return this.#emitter.on(type, listener);
  }

  off<K extends keyof SelectionEvents>(
    type: K,
    listener: (payload: SelectionEvents[K]) => void,
  ): void {
    this.#emitter.off(type, listener);
  }

  /**
   * Stops listening and unpins pages. Viewports destroy their selection managers.
   *
   * @example
   * ```ts
   * selection.destroy();
   * ```
   */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    cancelAnimationFrame(this.#frame);
    for (const fn of this.#cleanups) fn();
    this.#cleanups = [];
    if (!this.viewport.destroyed) this.viewport.setPinnedPages([]);
    this.#emitter.clear();
  }

  // ---- Internals -------------------------------------------------------------------------

  #selection(): Selection | null {
    return this.viewport.container.ownerDocument.getSelection();
  }

  #schedule(): void {
    if (this.#destroyed || this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#sync();
    });
  }

  #sync(): void {
    if (this.#destroyed) return;
    const sel = this.#selection();
    if (this.#requested && this.#applied && sel && sel.rangeCount > 0) {
      const now = sel.getRangeAt(0);
      if (
        now.compareBoundaryPoints(Range.START_TO_START, this.#applied) === 0 &&
        now.compareBoundaryPoints(Range.END_TO_END, this.#applied) === 0
      ) {
        return; // Still our programmatic selection: keep reporting the requested range.
      }
    }
    this.#requested = null;
    this.#applied = null;
    this.#set(this.#readDom());
  }

  #readDom(): TextRange | null {
    const sel = this.#selection();
    return sel ? this.selectionToRange(sel) : null;
  }

  #set(range: TextRange | null): void {
    if (rangesEqual(range, this.#range)) return;
    this.#range = range;
    const pinned: number[] = [];
    if (range) {
      for (let p = range.start.page; p <= range.end.page; p++) pinned.push(p);
      void this.viewport.document.loadTextFor(range).catch(() => {});
    }
    this.viewport.setPinnedPages(pinned);
    this.#emitter.emit("change", range ? cloneRange(range) : null);
  }

  #apply(range: TextRange): void {
    const sel = this.#selection();
    if (!sel) return;
    const layers = this.viewport
      .getTextLayers()
      .filter((l) => l.pageIndex >= range.start.page && l.pageIndex <= range.end.page);
    const first = layers[0];
    const last = layers[layers.length - 1];
    if (!first || !last) {
      this.#applied = null;
      return;
    }
    const startOffset = first.pageIndex === range.start.page ? range.start.offset : 0;
    const endOffset = last.pageIndex === range.end.page ? range.end.offset : last.textLength;
    const a = first.boundaryForOffset(startOffset, "forward");
    const b = last.boundaryForOffset(endOffset, "backward");
    if (!a || !b) return;
    sel.setBaseAndExtent(a.node, a.offset, b.node, b.offset);
    this.#applied = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  }

  /** Maps one DOM boundary point to a text position. */
  #position(node: Node, offset: number, side: "start" | "end"): TextPosition | null {
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const layerEl = el?.closest(`.${CLASS.textLayer}`);
    if (layerEl && this.viewport.element.contains(layerEl)) {
      const layer = TextLayer.of(layerEl);
      const o = layer?.offsetFromBoundary(node, offset);
      if (layer && o !== null && o !== undefined) return { page: layer.pageIndex, offset: o };
    }
    // The point is outside every text layer (between pages, or in a page without text).
    const layers = this.viewport.getTextLayers();
    if (layers.length === 0) return null;
    const doc = this.viewport.container.ownerDocument;
    const probe = doc.createRange();
    try {
      probe.setStart(node, offset);
    } catch {
      return null;
    }
    if (side === "start") {
      for (const layer of layers) {
        if (probe.comparePoint(layer.element, 0) >= 0) return { page: layer.pageIndex, offset: 0 };
      }
      return null;
    }
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i] as TextLayer;
      const endIndex = layer.element.childNodes.length;
      if (probe.comparePoint(layer.element, endIndex) <= 0) {
        return { page: layer.pageIndex, offset: layer.textLength };
      }
    }
    return null;
  }

  #onCopy(e: ClipboardEvent): void {
    const range = this.#readDom() ?? this.#range;
    if (!range || !e.clipboardData) return;
    e.clipboardData.setData("text/plain", this.rangeToText(range));
    e.preventDefault();
  }

  /** Marks text layers that the selection touches (pdf.js "selecting" technique). */
  #updateSelectingClass(): void {
    const sel = this.#selection();
    const layers = this.viewport.getTextLayers();
    if (!sel || sel.rangeCount === 0) {
      for (const l of layers) this.#reset(l);
      this.#prevDomRange = null;
      return;
    }
    const active = new Set<TextLayer>();
    for (let i = 0; i < sel.rangeCount; i++) {
      const r = sel.getRangeAt(i);
      for (const l of layers) if (!active.has(l) && r.intersectsNode(l.element)) active.add(l);
    }
    for (const l of layers) {
      if (active.has(l)) l.element.classList.add(CLASS.selecting);
      else this.#reset(l);
    }
    if (!this.#pointerDown) return;

    // In Chromium and WebKit, when the pointer is over empty space (the end-of-content element),
    // the selection jumps to cover everything up to that element. Moving the element right next
    // to the moving end of the selection limits the jump. Same technique as pdf.js.
    const range = sel.getRangeAt(0);
    const prev = this.#prevDomRange;
    const modifyStart =
      prev !== null &&
      (range.compareBoundaryPoints(Range.END_TO_END, prev) === 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, prev) === 0);
    let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
    if (!modifyStart && range.endOffset === 0 && anchor) {
      let node: Node | null = anchor;
      do {
        while (node && !node.previousSibling) node = node.parentNode;
        node = node?.previousSibling ?? null;
      } while (node && !node.childNodes.length);
      anchor = node;
    }
    const parentLayerEl = (anchor as Element | null)?.parentElement?.closest(`.${CLASS.textLayer}`);
    const layer = parentLayerEl ? TextLayer.of(parentLayerEl) : undefined;
    if (layer && anchor && anchor.parentNode === layer.element) {
      const eoc = layer.endOfContent;
      eoc.style.width = "100%";
      eoc.style.height = "100%";
      eoc.style.userSelect = "text";
      layer.element.insertBefore(eoc, modifyStart ? anchor : anchor.nextSibling);
    }
    this.#prevDomRange = range.cloneRange();
  }

  #reset(layer: TextLayer): void {
    const eoc = layer.endOfContent;
    if (eoc.parentNode !== layer.element || eoc.nextSibling) layer.element.append(eoc);
    eoc.style.width = "";
    eoc.style.height = "";
    eoc.style.userSelect = "";
    layer.element.classList.remove(CLASS.selecting);
  }

  #resetEndOfContent(): void {
    for (const l of this.viewport.getTextLayers()) {
      const eoc = l.endOfContent;
      if (eoc.nextSibling) l.element.append(eoc);
      eoc.style.width = "";
      eoc.style.height = "";
      eoc.style.userSelect = "";
    }
    this.#prevDomRange = null;
  }
}

function cloneRange(r: TextRange): TextRange {
  return { start: { ...r.start }, end: { ...r.end } };
}

/**
 * Creates a {@link SelectionManager} for a viewport.
 *
 * @example
 * ```ts
 * import { createSelectionManager } from "@readlet/core";
 *
 * const selection = createSelectionManager(viewport);
 * selection.on("change", (range) => console.log(range));
 * ```
 */
export function createSelectionManager(
  viewport: Viewport,
  options?: SelectionManagerOptions,
): SelectionManager {
  return new SelectionManager(viewport, options);
}
