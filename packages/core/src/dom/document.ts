import type {
  BackendDocument,
  BackendLoadOptions,
  BackendPage,
  DocumentBackend,
  LoadProgress,
} from "../model/backend";
import { Emitter, type Subscribable } from "../model/emitter";
import { ReadletError, toReadletError } from "../model/errors";
import { normalisePageText } from "../model/text-normalise";
import { rangeToText as modelRangeToText } from "../model/text-range";
import { rangeToRects as modelRangeToRects, type PageTextModel } from "../model/text-rects";
import type {
  DocumentSource,
  OutlineItem,
  PageInfo,
  PageLink,
  PageRect,
  TextRange,
} from "../model/types";
import { canvasMeasurer } from "./measure";

/**
 * Events of a {@link ReadletDocument}.
 *
 * @example
 * ```ts
 * doc.on("error", (e) => console.warn(e.code));
 * ```
 */
export interface DocumentEvents {
  /** A background operation (page or text fetch) failed. */
  error: ReadletError;
  /** The text of a page became available in the cache. */
  text: number;
  /**
   * The real size of a page arrived and replaced an estimate (lazy page sizes). The payload is
   * the new {@link PageInfo}.
   */
  pageinfo: PageInfo;
  destroy: undefined;
}

/**
 * Options for {@link loadDocument}.
 *
 * @example
 * ```ts
 * const options: LoadDocumentOptions = { backend: createPdfBackend(), onProgress: console.log };
 * ```
 */
export interface LoadDocumentOptions {
  /** The format backend, for example `createPdfBackend()` from `@readletjs/pdf`. */
  backend: DocumentBackend;
  /** Called while bytes load. */
  onProgress?: (progress: LoadProgress) => void;
  /** Aborts the load. The promise then rejects. */
  signal?: AbortSignal;
  /**
   * `"lazy"` (default): load only the size of `initialPage`; other pages start with that size and
   * `estimated: true`, and get their real size when they load. `"eager"`: load every page size
   * before the promise resolves (one backend page load per page).
   */
  pageSizes?: "lazy" | "eager";
  /** Zero-based page whose size is loaded first with lazy page sizes. Default `0`. */
  initialPage?: number;
}

/**
 * A loaded document. Owns the backend document, caches page metadata and page text.
 * Call {@link ReadletDocument.destroy} when done.
 *
 * @example
 * ```ts
 * const doc = await loadDocument("/paper.pdf", { backend });
 * console.log(doc.pageCount, doc.getPageInfo(0));
 * doc.destroy();
 * ```
 */
export class ReadletDocument implements Subscribable<DocumentEvents> {
  readonly #backend: BackendDocument;
  readonly #pages: PageInfo[];
  readonly #emitter = new Emitter<DocumentEvents>();
  readonly #text = new Map<number, PageTextModel>();
  readonly #textPending = new Map<number, Promise<PageTextModel>>();
  #outline: Promise<OutlineItem[]> | null = null;
  #destroyed = false;

  /** @internal Use {@link loadDocument}. */
  constructor(backend: BackendDocument, pages: readonly PageInfo[]) {
    this.#backend = backend;
    this.#pages = [...pages];
  }

  /** Number of pages. */
  get pageCount(): number {
    return this.#pages.length;
  }

  /** Information about every page. Estimated sizes are replaced as pages load. */
  get pages(): readonly PageInfo[] {
    return this.#pages;
  }

  /** `true` after {@link ReadletDocument.destroy}. */
  get destroyed(): boolean {
    return this.#destroyed;
  }

  /**
   * Information about one page. Throws a `RangeError` for an index outside the document.
   *
   * @example
   * ```ts
   * const { width, height } = doc.getPageInfo(0);
   * ```
   */
  getPageInfo(index: number): PageInfo {
    const info = this.#pages[index];
    if (!info) throw new RangeError(`Page index ${index} is outside 0..${this.#pages.length - 1}.`);
    return info;
  }

  /**
   * The backend page, for rendering. Most apps do not need this.
   *
   * @example
   * ```ts
   * const page = await doc.getPage(0);
   * ```
   */
  getPage(index: number): Promise<BackendPage> {
    this.#assertAlive();
    return this.#backend.getPage(index).then((page) => {
      this.#recordPage(page);
      return page;
    });
  }

  /**
   * The real information about one page. Loads the page when its size is still estimated.
   *
   * @example
   * ```ts
   * const { width, height } = await doc.loadPageInfo(42);
   * ```
   */
  async loadPageInfo(index: number): Promise<PageInfo> {
    const info = this.getPageInfo(index);
    if (!info.estimated) return info;
    await this.getPage(index);
    return this.getPageInfo(index);
  }

  /** Replaces an estimated page size with the real one and reports the change. */
  #recordPage(page: BackendPage): void {
    const old = this.#pages[page.index];
    if (!old?.estimated || this.#destroyed) return;
    const info = pageInfoOf(page);
    this.#pages[page.index] = info;
    this.#emitter.emit("pageinfo", info);
  }

  /**
   * The text model of a page (backend items plus normalised page string). Cached.
   *
   * @example
   * ```ts
   * const { normalised } = await doc.getTextModel(0);
   * console.log(normalised.text);
   * ```
   */
  getTextModel(index: number): Promise<PageTextModel> {
    const cached = this.#text.get(index);
    if (cached) return Promise.resolve(cached);
    let pending = this.#textPending.get(index);
    if (!pending) {
      pending = (async () => {
        this.#assertAlive();
        const page = await this.getPage(index);
        const items = await page.getTextItems();
        const model: PageTextModel = { items, normalised: normalisePageText(items) };
        if (!this.#destroyed) {
          this.#text.set(index, model);
          this.#emitter.emit("text", index);
        }
        return model;
      })().finally(() => this.#textPending.delete(index));
      this.#textPending.set(index, pending);
    }
    return pending;
  }

  /**
   * The cached text model of a page, or `undefined` when it has not loaded yet.
   *
   * @example
   * ```ts
   * const text = doc.getCachedTextModel(3)?.normalised.text;
   * ```
   */
  getCachedTextModel(index: number): PageTextModel | undefined {
    return this.#text.get(index);
  }

  /**
   * The normalised text of a page. `TextRange` offsets index into this string.
   *
   * @example
   * ```ts
   * const text = await doc.getPageText(0);
   * ```
   */
  async getPageText(index: number): Promise<string> {
    return (await this.getTextModel(index)).normalised.text;
  }

  /**
   * Loads the text of every page in the range so that the synchronous range helpers have it.
   *
   * @example
   * ```ts
   * await doc.loadTextFor(range);
   * const text = doc.rangeToText(range);
   * ```
   */
  async loadTextFor(range: TextRange): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    for (let p = range.start.page; p <= Math.min(range.end.page, this.pageCount - 1); p++) {
      jobs.push(this.getTextModel(p));
    }
    await Promise.all(jobs);
  }

  /**
   * The text that a range covers, pages joined with a newline. Uses cached page text only; pages
   * not loaded yet are skipped (see {@link ReadletDocument.loadTextFor}).
   *
   * @example
   * ```ts
   * navigator.clipboard.writeText(doc.rangeToText(range));
   * ```
   */
  rangeToText(range: TextRange): string {
    return modelRangeToText(range, (p) => this.#text.get(p)?.normalised.text);
  }

  /**
   * Rectangles of a range in page coordinates, one per line fragment. Uses cached page text only.
   *
   * @example
   * ```ts
   * const rects = doc.rangeToRects(range).filter((r) => r.page === 0);
   * ```
   */
  rangeToRects(range: TextRange): PageRect[] {
    return modelRangeToRects(range, (p) => this.#text.get(p), canvasMeasurer());
  }

  /**
   * The document outline (bookmarks), with page indexes resolved.
   *
   * @example
   * ```ts
   * const outline = await doc.getOutline();
   * ```
   */
  getOutline(): Promise<OutlineItem[]> {
    this.#assertAlive();
    this.#outline ??= this.#backend.getOutline().catch((error) => {
      this.#outline = null;
      throw toReadletError(error);
    });
    return this.#outline;
  }

  /**
   * Link areas of a page in page coordinates.
   *
   * @example
   * ```ts
   * const links = await doc.getLinks(0);
   * ```
   */
  async getLinks(index: number): Promise<PageLink[]> {
    const page = await this.getPage(index);
    return page.getLinks();
  }

  on<K extends keyof DocumentEvents>(
    type: K,
    listener: (payload: DocumentEvents[K]) => void,
  ): () => void {
    return this.#emitter.on(type, listener);
  }

  off<K extends keyof DocumentEvents>(
    type: K,
    listener: (payload: DocumentEvents[K]) => void,
  ): void {
    this.#emitter.off(type, listener);
  }

  /** @internal Reports a background error to listeners. */
  reportError(error: unknown): void {
    const e = toReadletError(error);
    if (e.code === "render-cancelled" || this.#destroyed) return;
    this.#emitter.emit("error", e);
  }

  /**
   * Frees every resource of the document. Safe to call more than once.
   *
   * @example
   * ```ts
   * viewport.destroy();
   * doc.destroy();
   * ```
   */
  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#text.clear();
    this.#emitter.emit("destroy", undefined);
    this.#emitter.clear();
    await this.#backend.destroy();
  }

  #assertAlive(): void {
    if (this.#destroyed) throw new ReadletError("destroyed", "The document was destroyed.");
  }
}

/**
 * Loads a document with a backend. Rejects with a {@link ReadletError}.
 *
 * @example
 * ```ts
 * import { loadDocument } from "@readletjs/core";
 * import { createPdfBackend } from "@readletjs/pdf";
 *
 * const doc = await loadDocument(file, {
 *   backend: createPdfBackend(),
 *   onProgress: ({ loaded, total }) => console.log(loaded, total),
 * });
 * ```
 */
export async function loadDocument(
  source: DocumentSource,
  options: LoadDocumentOptions,
): Promise<ReadletDocument> {
  const { backend, onProgress, signal, pageSizes = "lazy" } = options;
  const loadOptions: BackendLoadOptions = {};
  if (onProgress) loadOptions.onProgress = onProgress;
  if (signal) loadOptions.signal = signal;
  let backendDoc: BackendDocument;
  try {
    backendDoc = await backend.load(source, loadOptions);
  } catch (error) {
    throw toReadletError(error);
  }
  try {
    const count = backendDoc.pageCount;
    let pages: PageInfo[];
    if (pageSizes === "eager" || count === 0) {
      pages = await Promise.all(
        Array.from({ length: count }, async (_, index) =>
          pageInfoOf(await backendDoc.getPage(index)),
        ),
      );
    } else {
      const first = Math.min(Math.max(0, Math.trunc(options.initialPage ?? 0)), count - 1);
      const known = pageInfoOf(await backendDoc.getPage(first));
      pages = Array.from({ length: count }, (_, index) =>
        index === first ? known : { ...known, index, estimated: true },
      );
    }
    if (signal?.aborted) throw new ReadletError("network", "Load was aborted.");
    return new ReadletDocument(backendDoc, pages);
  } catch (error) {
    await backendDoc.destroy().catch(() => {});
    throw toReadletError(error);
  }
}

function pageInfoOf(page: BackendPage): PageInfo {
  return {
    index: page.index,
    width: page.width,
    height: page.height,
    rotation: page.rotation,
    estimated: false,
  };
}
