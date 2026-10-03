/**
 * A document source that Readlet can load.
 *
 * - `string` or `URL`: fetched over the network.
 * - `ArrayBuffer` or `Uint8Array`: raw bytes already in memory.
 * - `Blob` (and therefore `File`): bytes from a file input or a fetch response.
 *
 * @example
 * ```ts
 * const fromUrl: DocumentSource = "/paper.pdf";
 * const fromInput: DocumentSource = fileInput.files[0];
 * ```
 */
export type DocumentSource = string | URL | ArrayBuffer | Uint8Array | Blob;

/**
 * Information about one page.
 *
 * `width` and `height` are in page coordinates: PDF points (1/72 inch) with the page's intrinsic
 * rotation applied, at scale 1. They do not change with zoom or user rotation.
 *
 * With lazy page sizes (the default), pages that have not loaded yet have `estimated: true` and
 * the size of the first loaded page. The document emits `pageinfo` when the real value arrives.
 *
 * @example
 * ```ts
 * const { width, height } = doc.getPageInfo(0);
 * const aspect = width / height;
 * ```
 */
export interface PageInfo {
  /** Zero-based page index. */
  readonly index: number;
  /** Page width in points, intrinsic rotation applied. */
  readonly width: number;
  /** Page height in points, intrinsic rotation applied. */
  readonly height: number;
  /** The intrinsic rotation that the document itself sets on the page. */
  readonly rotation: Rotation;
  /** `true` while the size is a guess because the page has not loaded yet. */
  readonly estimated: boolean;
}

/**
 * A rotation in degrees, clockwise.
 *
 * @example
 * ```ts
 * viewport.setRotation(90 satisfies Rotation);
 * ```
 */
export type Rotation = 0 | 90 | 180 | 270;

/**
 * A position in the text of a document.
 *
 * `offset` is a character (UTF-16 code unit) index into the page's normalised text string.
 *
 * @example
 * ```ts
 * const pos: TextPosition = { page: 0, offset: 42 };
 * ```
 */
export interface TextPosition {
  /** Zero-based page index. */
  page: number;
  /** Character index into the normalised text of the page. */
  offset: number;
}

/**
 * A range of text, possibly across pages. `start` is inclusive, `end` is exclusive, and `start`
 * never comes after `end`. Ranges are plain JSON and stay valid across zoom, resize, rotation and
 * re-render.
 *
 * @example
 * ```ts
 * const range: TextRange = { start: { page: 2, offset: 100 }, end: { page: 3, offset: 12 } };
 * localStorage.setItem("last", JSON.stringify(range));
 * ```
 */
export interface TextRange {
  start: TextPosition;
  end: TextPosition;
}

/**
 * An axis-aligned rectangle in page coordinates (points, origin top-left, y down, intrinsic
 * rotation applied, user rotation not applied).
 *
 * @example
 * ```ts
 * // Convert to CSS pixels at the current scale:
 * const cssLeft = rect.x * scale * (96 / 72);
 * ```
 */
export interface PageRect {
  /** Zero-based page index. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A text range that the host app wants drawn over the pages. Readlet draws highlights but never
 * stores them.
 *
 * @example
 * ```ts
 * const remote: Highlight = { range, color: "rgba(255, 200, 0, 0.4)", id: "user-42" };
 * ```
 */
export interface Highlight {
  range: TextRange;
  /** Any CSS color. A translucent default is used when not set. */
  color?: string;
  /** A stable key for the host app, for example a user id. */
  id?: string;
}

/**
 * One entry of the document outline (bookmarks).
 *
 * @example
 * ```ts
 * for (const item of await doc.getOutline()) {
 *   if (item.pageIndex !== null) console.log(item.title, item.pageIndex + 1);
 * }
 * ```
 */
export interface OutlineItem {
  title: string;
  /** Target page, or `null` when the entry has no internal destination. */
  pageIndex: number | null;
  /** Vertical target in page coordinates, when the destination gives one. */
  top: number | null;
  /** External URL, when the entry links outside the document. */
  url: string | null;
  items: OutlineItem[];
}

/**
 * A link area on a page, in page coordinates.
 *
 * @example
 * ```ts
 * const internal = links.filter((l) => l.pageIndex !== null);
 * ```
 */
export interface PageLink {
  rect: Omit<PageRect, "page">;
  /** Target page for internal links, otherwise `null`. */
  pageIndex: number | null;
  /** Vertical target in page coordinates, when known. */
  top: number | null;
  /** External URL for external links, otherwise `null`. */
  url: string | null;
}

/**
 * How the viewer lays out pages.
 *
 * - `scroll`: all pages in one vertical column (continuous scroll).
 * - `page`: one page at a time with next / previous.
 *
 * @example
 * ```ts
 * viewport.setMode("page");
 * ```
 */
export type ViewMode = "scroll" | "page";

/**
 * How the viewer picks the scale.
 *
 * - `fit-width`: the widest page fills the container width.
 * - `fit-page`: the current page fits fully in the container.
 * - a number: explicit scale, where `1` is 100% (1 pt = 96/72 CSS px).
 *
 * @example
 * ```ts
 * viewport.setZoom(1.5);
 * viewport.setZoom("fit-width");
 * ```
 */
export type ZoomMode = "fit-width" | "fit-page" | number;
