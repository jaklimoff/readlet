import { isReadletError } from "../model/errors";
import { effectiveDpr, PT_TO_CSS, rotateSize } from "../model/layout";
import type { PageInfo, PageLink, Rotation } from "../model/types";
import type { ReadletDocument } from "./document";
import { CLASS, TextLayer } from "./text-layer";

/** The state of a {@link PageView}. */
export type PageViewState = "idle" | "rendering" | "rendered";

/** Options that a {@link PageView} reads on every render. */
export interface PageViewSettings {
  scale: number;
  rotation: Rotation;
  textLayer: boolean;
  links: boolean;
  maxCanvasPixels: number;
  onLink: (link: PageLink, event: MouseEvent) => void;
}

const LAYER_TRANSFORM: Record<Rotation, string> = {
  0: "",
  90: "rotate(90deg) translateY(-100%)",
  180: "rotate(180deg) translate(-100%, -100%)",
  270: "rotate(270deg) translateX(-100%)",
};

/**
 * One page on screen. Owns the page slot element, its canvas, text layer and link layer.
 * Rendering is cancellable, and a stale render never paints over a newer one.
 *
 * @example
 * ```ts
 * const view = viewport.getPageView(0);
 * view?.element.scrollIntoView();
 * ```
 */
export class PageView {
  readonly index: number;
  readonly info: PageInfo;
  /** The page slot. It always exists, so the layout has the right height. */
  readonly element: HTMLDivElement;
  /** The box that holds the layers in page orientation (user rotation applied by CSS). */
  readonly layers: HTMLDivElement;
  /** An empty element over the page, in page orientation, for host overlays (highlights). */
  readonly overlay: HTMLDivElement;
  #doc: ReadletDocument;
  #canvas: HTMLCanvasElement | null = null;
  #canvasScale = 0;
  #canvasRotation: Rotation = 0;
  #textLayer: TextLayer | null = null;
  #linkLayer: HTMLDivElement | null = null;
  #abort: AbortController | null = null;
  #state: PageViewState = "idle";
  #generation = 0;
  #pending: { key: string; promise: Promise<void> } | null = null;
  #layersFailed = false;
  #settings: PageViewSettings;
  #onTextLayer: (view: PageView, layer: TextLayer | null) => void;

  constructor(
    doc: ReadletDocument,
    info: PageInfo,
    settings: PageViewSettings,
    onTextLayer: (view: PageView, layer: TextLayer | null) => void,
  ) {
    this.#doc = doc;
    this.info = info;
    this.index = info.index;
    this.#settings = settings;
    this.#onTextLayer = onTextLayer;
    const el = document.createElement("div");
    el.className = CLASS.page;
    el.dataset.pageIndex = String(info.index);
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", `Page ${info.index + 1} of ${doc.pageCount}`);
    this.element = el;
    const layers = document.createElement("div");
    layers.className = CLASS.layers;
    this.layers = layers;
    const overlay = document.createElement("div");
    overlay.className = CLASS.overlay;
    this.overlay = overlay;
    layers.append(overlay);
    el.append(layers);
    this.applySettings(settings);
  }

  get state(): PageViewState {
    return this.#state;
  }

  /** The text layer, when built. */
  get textLayer(): TextLayer | null {
    return this.#textLayer;
  }

  /** The CSS size of the page slot at the current scale and rotation. */
  get cssSize(): { width: number; height: number } {
    const { scale, rotation } = this.#settings;
    const s = rotateSize(this.info, rotation);
    return { width: s.width * scale * PT_TO_CSS, height: s.height * scale * PT_TO_CSS };
  }

  /** Updates sizes for new settings. Does not render; call {@link PageView.render}. */
  applySettings(settings: PageViewSettings): void {
    this.#settings = settings;
    const { scale, rotation } = settings;
    const css = this.cssSize;
    this.element.style.width = `${css.width}px`;
    this.element.style.height = `${css.height}px`;
    const ls = this.layers.style;
    ls.width = `${this.info.width * scale * PT_TO_CSS}px`;
    ls.height = `${this.info.height * scale * PT_TO_CSS}px`;
    ls.setProperty("--rl-scale", String(scale * PT_TO_CSS));
    ls.transform = LAYER_TRANSFORM[rotation];
    if (
      this.#pending &&
      this.#pending.key !== `${scale}|${rotation}` &&
      this.#state === "rendering"
    ) {
      // The running render is for old settings: stop it so that the next render starts at once.
      this.#generation++;
      this.#abort?.abort();
      this.#abort = null;
      this.#pending = null;
      this.#state = this.#canvas ? "rendered" : "idle";
    }
    if (this.#canvas && this.#canvasRotation !== rotation) {
      // A canvas painted for another rotation would look wrong while the new one renders.
      this.#canvas.style.visibility = "hidden";
    }
  }

  /** `true` when the canvas matches the current scale and rotation. */
  get upToDate(): boolean {
    return (
      this.#state === "rendered" &&
      this.#canvasScale === this.#settings.scale &&
      this.#canvasRotation === this.#settings.rotation
    );
  }

  /** `true` when {@link PageView.render} has work to do (canvas or layers missing). */
  get needsRender(): boolean {
    if (!this.upToDate) return true;
    if (this.#layersFailed) return false;
    return (
      (this.#settings.textLayer && !this.#textLayer) || (this.#settings.links && !this.#linkLayer)
    );
  }

  /**
   * Renders the canvas (and builds the text and link layers once). Resolves when done. A newer
   * call or {@link PageView.release} cancels it; a cancelled render resolves without painting.
   */
  render(): Promise<void> {
    if (this.upToDate) return this.#ensureLayers();
    const key = `${this.#settings.scale}|${this.#settings.rotation}`;
    if (this.#state === "rendering" && this.#pending?.key === key) return this.#pending.promise;
    const promise = this.#render();
    this.#pending = { key, promise };
    return promise;
  }

  async #render(): Promise<void> {
    this.#abort?.abort();
    const abort = new AbortController();
    this.#abort = abort;
    const generation = ++this.#generation;
    this.#state = "rendering";
    const { scale, rotation, maxCanvasPixels } = this.#settings;
    try {
      const page = await this.#doc.getPage(this.index);
      if (generation !== this.#generation) return;
      void this.#ensureLayers();

      const css = this.cssSize;
      const dpr = effectiveDpr(
        globalThis.devicePixelRatio ?? 1,
        css.width,
        css.height,
        maxCanvasPixels,
      );
      const canvas = document.createElement("canvas");
      canvas.className = CLASS.canvas;
      canvas.setAttribute("aria-hidden", "true");
      await page.render({ canvas, scale: scale * PT_TO_CSS * dpr, rotation, signal: abort.signal });
      if (generation !== this.#generation || abort.signal.aborted) {
        freeCanvas(canvas);
        return;
      }
      const old = this.#canvas;
      this.element.insertBefore(canvas, this.element.firstChild);
      if (old) {
        old.remove();
        freeCanvas(old);
      }
      this.#canvas = canvas;
      this.#canvasScale = scale;
      this.#canvasRotation = rotation;
      this.#state = "rendered";
      this.element.dataset.rendered = "true";
    } catch (error) {
      if (generation === this.#generation) this.#state = this.#canvas ? "rendered" : "idle";
      if (
        isReadletError(error) &&
        (error.code === "render-cancelled" || error.code === "destroyed")
      )
        return;
      this.#doc.reportError(error);
    }
  }

  async #ensureLayers(): Promise<void> {
    const { textLayer, links } = this.#settings;
    const generation = this.#generation;
    if (textLayer && !this.#textLayer) {
      try {
        const model = await this.#doc.getTextModel(this.index);
        if (generation !== this.#generation || this.#textLayer || this.#state === "idle") return;
        const layer = new TextLayer(this.index, model, this.info.width, this.info.height);
        this.layers.insertBefore(layer.element, this.overlay.nextSibling);
        this.#textLayer = layer;
        this.#onTextLayer(this, layer);
      } catch (error) {
        this.#layersFailed = true;
        this.#doc.reportError(error);
      }
    }
    if (links && !this.#linkLayer) {
      try {
        const pageLinks = await this.#doc.getLinks(this.index);
        if (generation !== this.#generation || this.#linkLayer || this.#state === "idle") return;
        this.#linkLayer = this.#buildLinks(pageLinks);
        this.layers.append(this.#linkLayer);
      } catch (error) {
        this.#layersFailed = true;
        this.#doc.reportError(error);
      }
    }
  }

  #buildLinks(links: PageLink[]): HTMLDivElement {
    const layer = document.createElement("div");
    layer.className = CLASS.linkLayer;
    const { width, height } = this.info;
    for (const link of links) {
      const a = document.createElement("a");
      a.style.left = `${(link.rect.x / width) * 100}%`;
      a.style.top = `${(link.rect.y / height) * 100}%`;
      a.style.width = `${(link.rect.width / width) * 100}%`;
      a.style.height = `${(link.rect.height / height) * 100}%`;
      if (link.url) {
        a.href = link.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.setAttribute("aria-label", `Open ${link.url}`);
      } else if (link.pageIndex !== null) {
        a.href = `#page=${link.pageIndex + 1}`;
        a.setAttribute("aria-label", `Go to page ${link.pageIndex + 1}`);
        a.dataset.pageIndex = String(link.pageIndex);
      }
      a.addEventListener("click", (event) => this.#settings.onLink(link, event));
      layer.append(a);
    }
    return layer;
  }

  /**
   * Frees the canvas. With `keepText`, the text layer stays (so a DOM selection that uses it
   * survives); otherwise the text and link layers are removed too.
   */
  release(keepText = false): void {
    this.#generation++;
    this.#abort?.abort();
    this.#abort = null;
    this.#pending = null;
    if (this.#canvas) {
      this.#canvas.remove();
      freeCanvas(this.#canvas);
      this.#canvas = null;
    }
    this.#canvasScale = 0;
    this.#state = "idle";
    delete this.element.dataset.rendered;
    if (!keepText) this.#removeLayers();
  }

  #removeLayers(): void {
    if (this.#textLayer) {
      this.#textLayer.element.remove();
      this.#textLayer = null;
      this.#onTextLayer(this, null);
    }
    this.#linkLayer?.remove();
    this.#linkLayer = null;
  }

  /** Releases everything and detaches the slot. */
  destroy(): void {
    this.release(false);
    this.element.remove();
  }
}

function freeCanvas(canvas: HTMLCanvasElement): void {
  // Shrinking first frees the backing store at once (Safari keeps it otherwise).
  canvas.width = 0;
  canvas.height = 0;
}
