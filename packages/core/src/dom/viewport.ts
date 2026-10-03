import { Emitter, type Subscribable } from "../model/emitter";
import {
  type ColumnLayout,
  columnLayout,
  mostVisiblePage,
  PT_TO_CSS,
  resolveScale,
  rotateSize,
  visiblePages,
} from "../model/layout";
import type { PageLink, Rotation, ViewMode, ZoomMode } from "../model/types";
import type { ReadletDocument } from "./document";
import { PageView, type PageViewSettings } from "./page-view";
import { injectStyles } from "./styles";
import { CLASS, type TextLayer } from "./text-layer";

/**
 * Options for {@link createViewport}.
 *
 * @example
 * ```ts
 * const options: ViewportOptions = { container, mode: "scroll", zoom: "fit-width" };
 * ```
 */
export interface ViewportOptions {
  /** The scroll container. It must have a height. Readlet appends its viewer element to it. */
  container: HTMLElement;
  /** Layout mode. Default `"scroll"`. */
  mode?: ViewMode;
  /** Zoom. Default `"fit-width"`. */
  zoom?: ZoomMode;
  /** User rotation, added to each page's own rotation. Default `0`. */
  rotation?: Rotation;
  /** Zero-based page to show first. Default `0`. */
  initialPage?: number;
  /** Space between pages in CSS px. Default `16`. */
  gap?: number;
  /** Space around the pages in CSS px. Default `16`. */
  padding?: number;
  /**
   * How far outside the visible area pages are rendered, in viewport heights. Default `1`.
   * Pages further away than twice this distance are released.
   */
  buffer?: number;
  /** Upper bound for the pixels of one canvas. Default `16_777_216` (4096²). */
  maxCanvasPixels?: number;
  /** Build the selectable text layer. Default `true`. */
  textLayer?: boolean;
  /** Build clickable link areas. Default `true`. */
  links?: boolean;
  /** Add Readlet's base CSS to the page. Default `true`. */
  injectStyles?: boolean;
  /** Smallest and largest allowed scale. Default `{ min: 0.1, max: 10 }`. */
  scaleLimits?: { min: number; max: number };
  /**
   * Called before Readlet handles a link click. Call `event.preventDefault()` to stop the default
   * (navigate for internal links, new tab for external links).
   */
  onLinkClick?: (link: PageLink, event: MouseEvent) => void;
}

/**
 * Events of a {@link Viewport}.
 *
 * @example
 * ```ts
 * viewport.on("pagechange", (index) => console.log("page", index + 1));
 * ```
 */
export interface ViewportEvents {
  /** The current page changed. Payload: zero-based index. */
  pagechange: number;
  /** The resolved scale changed. */
  scalechange: number;
  /** Fired right before the layout changes (zoom, resize, rotation, mode). */
  beforelayout: undefined;
  /** Fired right after the layout changed. */
  layout: undefined;
  /** The set of pages in the render window changed. */
  visiblechange: readonly number[];
  /** A page canvas finished rendering. */
  pagerender: number;
  /** A text layer was built (`present: true`) or removed. */
  textlayer: { page: number; present: boolean };
  destroy: undefined;
}

/**
 * Options for {@link Viewport.goToPage}.
 *
 * @example
 * ```ts
 * viewport.goToPage(4, { top: 120, smooth: true });
 * ```
 */
export interface GoToPageOptions {
  /** Vertical position inside the page, in page coordinates. */
  top?: number | null;
  /** Use smooth scrolling. Default `false`. */
  smooth?: boolean;
}

const NAV_KEYS_PAGE_MODE: Record<string, "next" | "prev" | "first" | "last"> = {
  ArrowRight: "next",
  PageDown: "next",
  ArrowLeft: "prev",
  PageUp: "prev",
  Home: "first",
  End: "last",
};

/**
 * The viewer: lays out pages in a scroll container, renders only the pages near the visible area
 * (virtualisation), and handles zoom, rotation, navigation and keyboard.
 *
 * Create it with {@link createViewport}.
 *
 * @example
 * ```ts
 * const viewport = createViewport(doc, { container, mode: "scroll", zoom: "fit-width" });
 * viewport.goToPage(4);
 * viewport.destroy();
 * ```
 */
export class Viewport implements Subscribable<ViewportEvents> {
  readonly document: ReadletDocument;
  readonly container: HTMLElement;
  /** The element Readlet appended to the container. It holds the page slots. */
  readonly element: HTMLDivElement;
  readonly #emitter = new Emitter<ViewportEvents>();
  readonly #views: PageView[];
  readonly #opts: Required<Omit<ViewportOptions, "onLinkClick" | "container" | "initialPage">> & {
    onLinkClick?: ViewportOptions["onLinkClick"];
  };
  #layout: ColumnLayout = { tops: [], sizes: [], totalHeight: 0, maxWidth: 0 };
  /** The page sizes (points) that the current layout uses, to detect real sizes that differ. */
  #laidOut: Array<{ width: number; height: number }> = [];
  #relayoutQueued = false;
  #scale = 1;
  #current = 0;
  #window: number[] = [];
  #pinned = new Set<number>();
  #frame = 0;
  #rendering = 0;
  #destroyed = false;
  #resizeObserver: ResizeObserver | null = null;
  #lastSize = { width: 0, height: 0 };
  #restoreContainerStyle: (() => void) | null = null;
  #cleanups: Array<() => void> = [];

  /** @internal Use {@link createViewport}. */
  constructor(doc: ReadletDocument, options: ViewportOptions) {
    this.document = doc;
    this.container = options.container;
    this.#opts = {
      mode: options.mode ?? "scroll",
      zoom: options.zoom ?? "fit-width",
      rotation: options.rotation ?? 0,
      gap: options.gap ?? 16,
      padding: options.padding ?? 16,
      buffer: options.buffer ?? 1,
      maxCanvasPixels: options.maxCanvasPixels ?? 16_777_216,
      textLayer: options.textLayer ?? true,
      links: options.links ?? true,
      injectStyles: options.injectStyles ?? true,
      scaleLimits: options.scaleLimits ?? { min: 0.1, max: 10 },
      onLinkClick: options.onLinkClick,
    };
    this.#current = clampIndex(options.initialPage ?? 0, doc.pageCount);

    if (this.#opts.injectStyles) injectStyles(this.container.ownerDocument);
    this.#prepareContainer();

    const el = document.createElement("div");
    el.className = CLASS.viewer;
    el.setAttribute("role", "document");
    el.setAttribute("aria-roledescription", "document viewer");
    el.setAttribute("aria-label", `Document, ${doc.pageCount} pages`);
    this.element = el;

    const settings = this.#settings();
    this.#views = doc.pages.map(
      (info) => new PageView(doc, info, settings, (view, layer) => this.#onTextLayer(view, layer)),
    );
    const frag = document.createDocumentFragment();
    for (const v of this.#views) frag.append(v.element);
    el.append(frag);
    this.container.append(el);

    this.#listen();
    this.#relayout({ anchor: false });
    if (this.#current > 0) this.goToPage(this.#current);
    this.#scheduleUpdate();
  }

  // ---- Public state ----------------------------------------------------------------------

  /** Number of pages. */
  get pageCount(): number {
    return this.document.pageCount;
  }

  /** The current page (zero-based): the most visible page in scroll mode. */
  get currentPage(): number {
    return this.#current;
  }

  /** The resolved numeric scale (1 = 100%). */
  get scale(): number {
    return this.#scale;
  }

  /** The zoom setting as given (`"fit-width"`, `"fit-page"` or a number). */
  get zoom(): ZoomMode {
    return this.#opts.zoom;
  }

  get mode(): ViewMode {
    return this.#opts.mode;
  }

  get rotation(): Rotation {
    return this.#opts.rotation;
  }

  /** Pages in the render window (visible plus buffer), in order. */
  get visiblePages(): readonly number[] {
    return this.#window;
  }

  /** `true` after {@link Viewport.destroy}. */
  get destroyed(): boolean {
    return this.#destroyed;
  }

  /**
   * The view of one page. Every page has a view; only pages in the render window have a canvas.
   *
   * @example
   * ```ts
   * viewport.getPageView(0)?.overlay.append(myMarker);
   * ```
   */
  getPageView(index: number): PageView | undefined {
    return this.#views[index];
  }

  /** The text layers that exist now, in page order. */
  getTextLayers(): TextLayer[] {
    const out: TextLayer[] = [];
    for (const v of this.#views) if (v.textLayer) out.push(v.textLayer);
    return out;
  }

  // ---- Commands --------------------------------------------------------------------------

  /**
   * Sets the zoom.
   *
   * @example
   * ```ts
   * viewport.setZoom(viewport.scale * 1.25);
   * ```
   */
  setZoom(zoom: ZoomMode): void {
    if (this.#destroyed || zoom === this.#opts.zoom) return;
    this.#opts.zoom = zoom;
    this.#relayout({ anchor: true });
  }

  /**
   * Sets the user rotation.
   *
   * @example
   * ```ts
   * viewport.setRotation(((viewport.rotation + 90) % 360) as Rotation);
   * ```
   */
  setRotation(rotation: Rotation): void {
    if (this.#destroyed || rotation === this.#opts.rotation) return;
    this.#opts.rotation = rotation;
    this.#relayout({ anchor: true });
  }

  /**
   * Switches between continuous scroll and single page.
   *
   * @example
   * ```ts
   * viewport.setMode("page");
   * ```
   */
  setMode(mode: ViewMode): void {
    if (this.#destroyed || mode === this.#opts.mode) return;
    const page = this.#current;
    this.#opts.mode = mode;
    this.#relayout({ anchor: false });
    this.goToPage(page);
  }

  /**
   * Shows a page. In scroll mode it scrolls the page to the top of the container.
   *
   * @example
   * ```ts
   * viewport.goToPage(0);
   * ```
   */
  goToPage(index: number, options: GoToPageOptions = {}): void {
    if (this.#destroyed || this.pageCount === 0) return;
    const target = clampIndex(index, this.pageCount);
    const offset = this.#offsetInPage(target, options.top ?? null);
    if (this.#opts.mode === "page") {
      if (target !== this.#current) {
        this.#current = target;
        this.#relayout({ anchor: false });
        this.#emitter.emit("pagechange", target);
      }
      this.#scrollTo(offset, options.smooth);
    } else {
      const pageTop = this.#layout.tops[target] ?? 0;
      const top = pageTop + offset - (offset > 0 ? this.#opts.padding : this.#opts.padding / 2);
      this.#scrollTo(Math.max(0, top), options.smooth);
      this.#setCurrent(target);
    }
    this.#scheduleUpdate();
  }

  /** Next page. Does nothing on the last page. */
  nextPage(): void {
    if (this.#current < this.pageCount - 1) this.goToPage(this.#current + 1);
  }

  /** Previous page. Does nothing on the first page. */
  previousPage(): void {
    if (this.#current > 0) this.goToPage(this.#current - 1);
  }

  /**
   * Keeps the text layers of these pages when the pages leave the render window. The selection
   * manager pins the pages of the current selection, so the DOM selection survives scrolling.
   *
   * @example
   * ```ts
   * viewport.setPinnedPages([2, 3]);
   * ```
   */
  setPinnedPages(pages: Iterable<number>): void {
    const next = new Set(pages);
    const unpinned = [...this.#pinned].filter((p) => !next.has(p));
    this.#pinned = next;
    if (unpinned.length) this.#scheduleUpdate();
  }

  /**
   * Converts a rectangle in page coordinates to CSS pixels relative to the page's layer box
   * (before user rotation, which the layer box applies with a CSS transform).
   *
   * @example
   * ```ts
   * const css = viewport.toCss(rect);
   * ```
   */
  toCss(rect: { x: number; y: number; width: number; height: number }): {
    left: number;
    top: number;
    width: number;
    height: number;
  } {
    const k = this.#scale * PT_TO_CSS;
    return { left: rect.x * k, top: rect.y * k, width: rect.width * k, height: rect.height * k };
  }

  /**
   * Re-reads the container size and lays out again. Readlet calls this itself on resize.
   */
  refresh(): void {
    this.#relayout({ anchor: true });
  }

  on<K extends keyof ViewportEvents>(
    type: K,
    listener: (payload: ViewportEvents[K]) => void,
  ): () => void {
    return this.#emitter.on(type, listener);
  }

  off<K extends keyof ViewportEvents>(
    type: K,
    listener: (payload: ViewportEvents[K]) => void,
  ): void {
    this.#emitter.off(type, listener);
  }

  /**
   * Removes the viewer from the container and frees every canvas and listener. The document is
   * not destroyed; destroy it separately.
   *
   * @example
   * ```ts
   * viewport.destroy();
   * await doc.destroy();
   * ```
   */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    cancelAnimationFrame(this.#frame);
    for (const fn of this.#cleanups) fn();
    this.#cleanups = [];
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    for (const v of this.#views) v.destroy();
    this.element.remove();
    this.#restoreContainerStyle?.();
    this.#emitter.emit("destroy", undefined);
    this.#emitter.clear();
  }

  // ---- Internals -------------------------------------------------------------------------

  #settings(): PageViewSettings {
    return {
      scale: this.#scale,
      rotation: this.#opts.rotation,
      textLayer: this.#opts.textLayer,
      links: this.#opts.links,
      maxCanvasPixels: this.#opts.maxCanvasPixels,
      onLink: (link, event) => this.#handleLink(link, event),
    };
  }

  #prepareContainer(): void {
    const c = this.container;
    const style = getComputedStyle(c);
    const prev = {
      overflow: c.style.overflow,
      position: c.style.position,
      tabIndex: c.getAttribute("tabindex"),
    };
    if (style.overflowY === "visible" || style.overflowY === "") c.style.overflow = "auto";
    if (style.position === "static") c.style.position = "relative";
    if (prev.tabIndex === null) c.tabIndex = 0;
    this.#restoreContainerStyle = () => {
      c.style.overflow = prev.overflow;
      c.style.position = prev.position;
      if (prev.tabIndex === null) c.removeAttribute("tabindex");
    };
  }

  #listen(): void {
    const c = this.container;
    const onScroll = () => this.#scheduleUpdate();
    const onKey = (e: KeyboardEvent) => this.#onKey(e);
    c.addEventListener("scroll", onScroll, { passive: true });
    c.addEventListener("keydown", onKey);
    this.#cleanups.push(() => {
      c.removeEventListener("scroll", onScroll);
      c.removeEventListener("keydown", onKey);
    });
    // Lazy page sizes: when a page loads with a size other than its estimate, lay out again.
    // Changes are collected in a microtask, so one relayout runs before the next paint.
    this.#cleanups.push(
      this.document.on("pageinfo", (info) => {
        const used = this.#laidOut[info.index];
        if (used && used.width === info.width && used.height === info.height) return;
        if (this.#relayoutQueued) return;
        this.#relayoutQueued = true;
        queueMicrotask(() => {
          this.#relayoutQueued = false;
          this.#relayout({ anchor: true });
        });
      }),
    );
    if (typeof ResizeObserver !== "undefined") {
      this.#lastSize = { width: c.clientWidth, height: c.clientHeight };
      this.#resizeObserver = new ResizeObserver(() => {
        const size = { width: c.clientWidth, height: c.clientHeight };
        if (size.width === this.#lastSize.width && size.height === this.#lastSize.height) return;
        this.#lastSize = size;
        this.#relayout({ anchor: true });
      });
      this.#resizeObserver.observe(c);
    }
  }

  #onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement | null;
    if (target && target !== this.container && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      return;
    if (target?.isContentEditable) return;
    if (this.#opts.mode === "page") {
      const action = NAV_KEYS_PAGE_MODE[e.key];
      if (!action) return;
      e.preventDefault();
      if (action === "next") this.nextPage();
      else if (action === "prev") this.previousPage();
      else if (action === "first") this.goToPage(0);
      else this.goToPage(this.pageCount - 1);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      this.goToPage(e.key === "Home" ? 0 : this.pageCount - 1);
    }
  }

  #handleLink(link: PageLink, event: MouseEvent): void {
    this.#opts.onLinkClick?.(link, event);
    if (event.defaultPrevented) return;
    if (link.pageIndex !== null) {
      event.preventDefault();
      this.goToPage(link.pageIndex, { top: link.top });
    }
  }

  #offsetInPage(index: number, top: number | null): number {
    if (top === null || !Number.isFinite(top)) return 0;
    const info = this.document.pages[index];
    if (!info) return 0;
    const k = this.#scale * PT_TO_CSS;
    switch (this.#opts.rotation) {
      case 0:
        return Math.max(0, top * k);
      case 180:
        return Math.max(0, (info.height - top) * k);
      default:
        return 0;
    }
  }

  #scrollTo(top: number, smooth?: boolean): void {
    if (smooth && typeof this.container.scrollTo === "function") {
      this.container.scrollTo({ top, behavior: "smooth" });
    } else {
      this.container.scrollTop = top;
    }
  }

  #setCurrent(index: number): void {
    if (index === this.#current) return;
    this.#current = index;
    this.#emitter.emit("pagechange", index);
  }

  #relayout({ anchor }: { anchor: boolean }): void {
    if (this.#destroyed) return;
    this.#emitter.emit("beforelayout", undefined);
    const c = this.container;
    const { padding, gap, mode, rotation, zoom, scaleLimits } = this.#opts;

    // Remember what is at the top of the viewport so that zoom keeps it in place.
    // Inside the page the position is kept as a fraction of the page height; above the page
    // (in the gap that goToPage leaves) it is kept in pixels, so a page that changes height
    // does not move its own top.
    let anchorPage = this.#current;
    let anchorFraction = 0;
    let anchorGap = 0;
    if (anchor && mode === "scroll" && this.#layout.tops.length) {
      const y = c.scrollTop;
      anchorPage = mostVisiblePage(this.#layout, y, 1);
      const top = this.#layout.tops[anchorPage] ?? 0;
      const h = this.#layout.sizes[anchorPage]?.height ?? 1;
      if (y < top) anchorGap = y - top;
      else anchorFraction = (y - top) / h;
    }
    const xFraction =
      c.scrollWidth > c.clientWidth ? (c.scrollLeft + c.clientWidth / 2) / c.scrollWidth : 0.5;

    this.#laidOut = this.document.pages.map((p) => ({ width: p.width, height: p.height }));
    const rotated = this.document.pages.map((p) => rotateSize(p, rotation));
    const free = {
      width: Math.max(1, c.clientWidth - 2 * padding),
      height: Math.max(1, c.clientHeight - 2 * padding),
    };
    const scale = resolveScale(zoom, rotated, free, this.#current, scaleLimits);
    const scaleChanged = scale !== this.#scale;
    this.#scale = scale;

    const settings = this.#settings();
    for (const v of this.#views) v.applySettings(settings);

    const k = scale * PT_TO_CSS;
    const cssSizes = rotated.map((s) => ({ width: s.width * k, height: s.height * k }));
    if (mode === "page") {
      const size = cssSizes[this.#current] ?? { width: 0, height: 0 };
      this.#layout = columnLayout([size], { gap, padding });
    } else {
      this.#layout = columnLayout(cssSizes, { gap, padding });
    }
    const contentWidth = Math.max(c.clientWidth, this.#layout.maxWidth + 2 * padding);
    this.element.style.width = `${contentWidth}px`;
    this.element.style.height = `${this.#layout.totalHeight}px`;

    // Page slots are in normal block flow (not absolutely positioned): between two pages,
    // browsers then map the pointer to the nearest page, so a drag selection does not jump to
    // the start of the document. The margins give the same positions as `columnLayout`.
    this.element.style.paddingTop = `${padding}px`;
    this.element.style.paddingBottom = `${padding}px`;
    const last = mode === "page" ? this.#current : this.#views.length - 1;
    for (let i = 0; i < this.#views.length; i++) {
      const v = this.#views[i] as PageView;
      const size = cssSizes[i] as { width: number; height: number };
      const s = v.element.style;
      const shown = mode === "scroll" || i === this.#current;
      s.display = shown ? "" : "none";
      if (!shown) continue;
      s.marginBottom = i === last ? "0" : `${gap}px`;
      s.marginLeft = `${Math.max(padding, (contentWidth - size.width) / 2)}px`;
    }

    if (anchor && mode === "scroll") {
      const top = this.#layout.tops[anchorPage] ?? 0;
      const h = this.#layout.sizes[anchorPage]?.height ?? 0;
      c.scrollTop = top + anchorGap + anchorFraction * h;
    }
    if (c.scrollWidth > c.clientWidth) c.scrollLeft = xFraction * c.scrollWidth - c.clientWidth / 2;

    this.#emitter.emit("layout", undefined);
    if (scaleChanged) this.#emitter.emit("scalechange", scale);
    this.#scheduleUpdate();
  }

  #scheduleUpdate(): void {
    if (this.#destroyed || this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#update();
    });
  }

  #update(): void {
    if (this.#destroyed) return;
    const c = this.container;
    const n = this.pageCount;
    if (n === 0) return;
    const viewH = c.clientHeight || 1;
    let want: { first: number; last: number };
    let keep: { first: number; last: number };
    let visible: { first: number; last: number };
    if (this.#opts.mode === "page") {
      const cur = this.#current;
      visible = { first: cur, last: cur };
      want = { first: Math.max(0, cur - 1), last: Math.min(n - 1, cur + 1) };
      keep = want;
    } else {
      const top = c.scrollTop;
      visible = visiblePages(this.#layout, top, viewH) ?? { first: 0, last: 0 };
      want = visiblePages(this.#layout, top, viewH, viewH * this.#opts.buffer) ?? visible;
      keep = visiblePages(this.#layout, top, viewH, viewH * this.#opts.buffer * 2) ?? want;
      this.#setCurrent(mostVisiblePage(this.#layout, top, viewH));
    }

    const windowPages: number[] = [];
    for (let i = want.first; i <= want.last; i++) windowPages.push(i);
    if (!sameList(windowPages, this.#window)) {
      this.#window = windowPages;
      this.#emitter.emit("visiblechange", windowPages);
    }

    for (let i = 0; i < n; i++) {
      if (i >= keep.first && i <= keep.last) continue;
      const v = this.#views[i] as PageView;
      if (v.state !== "idle" || (v.textLayer && !this.#pinned.has(i)))
        v.release(this.#pinned.has(i));
    }

    // Render visible pages first (closest to the middle first), then the buffer.
    const mid = (visible.first + visible.last) / 2;
    const queue = windowPages
      .filter((i) => (this.#views[i] as PageView).needsRender)
      .sort((a, b) => {
        const av = a >= visible.first && a <= visible.last ? 0 : 1;
        const bv = b >= visible.first && b <= visible.last ? 0 : 1;
        return av - bv || Math.abs(a - mid) - Math.abs(b - mid);
      });
    this.#pump(queue);
  }

  #pump(queue: number[]): void {
    const MAX_PARALLEL = 2;
    while (this.#rendering < MAX_PARALLEL && queue.length) {
      const index = queue.shift() as number;
      const view = this.#views[index] as PageView;
      if (view.state === "rendering") continue;
      this.#rendering++;
      view
        .render()
        .then(() => {
          if (!this.#destroyed && view.upToDate) this.#emitter.emit("pagerender", index);
        })
        .finally(() => {
          this.#rendering--;
          if (!this.#destroyed && queue.length) this.#pump(queue);
          else if (!this.#destroyed) this.#scheduleUpdate();
        });
    }
  }

  #onTextLayer(view: PageView, layer: TextLayer | null): void {
    if (this.#destroyed) return;
    this.#emitter.emit("textlayer", { page: view.index, present: layer !== null });
  }
}

function clampIndex(index: number, count: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), Math.max(0, count - 1));
}

function sameList(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Creates a {@link Viewport} in a container.
 *
 * @example
 * ```ts
 * import { createViewport } from "@readletjs/core";
 *
 * const viewport = createViewport(doc, {
 *   container: document.getElementById("viewer")!,
 *   mode: "scroll",
 *   zoom: "fit-width",
 * });
 * viewport.on("pagechange", (i) => (pageLabel.textContent = `${i + 1} / ${viewport.pageCount}`));
 * ```
 */
export function createViewport(doc: ReadletDocument, options: ViewportOptions): Viewport {
  return new Viewport(doc, options);
}
