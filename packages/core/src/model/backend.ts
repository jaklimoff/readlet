import type { DocumentSource, OutlineItem, PageLink, Rotation } from "./types";

/**
 * A 2D affine matrix `[a, b, c, d, e, f]`, the same layout as `DOMMatrix` and the PDF `cm`
 * operator.
 *
 * @example
 * ```ts
 * const identity: Matrix = [1, 0, 0, 1, 0, 0];
 * ```
 */
export type Matrix = readonly [number, number, number, number, number, number];

/**
 * One run of text from the backend, in page coordinates. Backends convert from their native space
 * so core never sees format-specific coordinates.
 *
 * @example
 * ```ts
 * // A 12 pt horizontal run with its baseline at (72, 100):
 * const item: TextItem = {
 *   str: "Hello", dir: "ltr", transform: [12, 0, 0, -12, 72, 100],
 *   width: 27.3, height: 12, hasEOL: false, fontFamily: "sans-serif", ascent: 0.8, vertical: false,
 * };
 * ```
 */
export interface TextItem {
  /** The raw glyph string as the backend extracted it. Readlet normalises it. */
  str: string;
  /** Text direction of the run. */
  dir: "ltr" | "rtl" | "ttb";
  /**
   * Maps glyph space (font size 1, baseline origin) to page coordinates (points, origin
   * top-left, y down, intrinsic rotation applied). `hypot(c, d)` is the font height.
   */
  transform: Matrix;
  /** Advance width of the run in page units (horizontal text). */
  width: number;
  /** Advance height of the run in page units (vertical text). */
  height: number;
  /** `true` when the backend knows that a line break follows the run. */
  hasEOL: boolean;
  /** A CSS font family used to lay out the invisible text, for example `"sans-serif"`. */
  fontFamily: string;
  /** Font ascent as a fraction of the font height, usually between 0.7 and 1. */
  ascent: number;
  /** `true` for vertical writing mode. */
  vertical: boolean;
}

/**
 * Parameters for {@link BackendPage.render}.
 *
 * @example
 * ```ts
 * await page.render({ canvas, scale: 2, rotation: 0, signal: controller.signal });
 * ```
 */
export interface BackendRenderParams {
  /** The target canvas. The backend sets its `width` and `height` in device pixels. */
  canvas: HTMLCanvasElement;
  /** Device pixels per point. */
  scale: number;
  /** User rotation, added to the intrinsic rotation of the page. */
  rotation: Rotation;
  /** Aborts the render. The promise then rejects with a `render-cancelled` error. */
  signal: AbortSignal;
}

/**
 * One loaded page from a backend.
 *
 * @example
 * ```ts
 * const page = await backendDoc.getPage(0);
 * const items = await page.getTextItems();
 * ```
 */
export interface BackendPage {
  readonly index: number;
  /** Width in points, intrinsic rotation applied. */
  readonly width: number;
  /** Height in points, intrinsic rotation applied. */
  readonly height: number;
  /** Intrinsic rotation. */
  readonly rotation: Rotation;
  /** Paints the page into the canvas. */
  render(params: BackendRenderParams): Promise<void>;
  /** Text runs in content order, in page coordinates. */
  getTextItems(): Promise<TextItem[]>;
  /** Link areas on the page. */
  getLinks(): Promise<PageLink[]>;
  /** Frees caches held for this page. The page can still be used after this. */
  cleanup(): void;
}

/**
 * A document that a backend has loaded.
 *
 * @example
 * ```ts
 * const backendDoc = await backend.load(src, { onProgress: (p) => console.log(p) });
 * console.log(backendDoc.pageCount);
 * ```
 */
export interface BackendDocument {
  readonly pageCount: number;
  getPage(index: number): Promise<BackendPage>;
  getOutline(): Promise<OutlineItem[]>;
  /** Frees every resource (worker ports, caches). */
  destroy(): Promise<void>;
}

/**
 * Options that core passes to {@link DocumentBackend.load}.
 *
 * @example
 * ```ts
 * const options: BackendLoadOptions = { onProgress: ({ loaded, total }) => {}, signal };
 * ```
 */
export interface BackendLoadOptions {
  onProgress?: (progress: LoadProgress) => void;
  signal?: AbortSignal;
}

/**
 * Load progress in bytes. `total` is `null` when the size is not known.
 *
 * @example
 * ```ts
 * const ratio = p.total ? p.loaded / p.total : null;
 * ```
 */
export interface LoadProgress {
  loaded: number;
  total: number | null;
}

/**
 * The interface that every document format implements. A backend is a stateless factory: one
 * backend can load many documents. Errors must be thrown as `ReadletError`.
 *
 * @example
 * ```ts
 * import { createPdfBackend } from "@readletjs/pdf";
 * const backend: DocumentBackend = createPdfBackend();
 * ```
 */
export interface DocumentBackend {
  /** A short format name, for example `"pdf"`. */
  readonly name: string;
  load(source: DocumentSource, options?: BackendLoadOptions): Promise<BackendDocument>;
}
