import {
  type BackendDocument,
  type BackendLoadOptions,
  type BackendPage,
  type BackendRenderParams,
  type DocumentBackend,
  type DocumentSource,
  type Matrix,
  type OutlineItem,
  type PageLink,
  ReadletError,
  type Rotation,
  type TextItem,
  toReadletError,
} from "@readlet/core";
import type {
  PageViewport,
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  PDFWorker as PDFWorkerType,
} from "pdfjs-dist";
import type { TextItem as PdfTextItem, TextContent } from "pdfjs-dist/types/src/display/api";

type PdfJs = typeof import("pdfjs-dist");

/**
 * Options for {@link createPdfBackend}. Every option is optional; the defaults need no
 * configuration.
 *
 * @example
 * ```ts
 * // Self-host the worker and the pdf.js assets (strict CSP, offline apps):
 * const backend = createPdfBackend({
 *   workerSrc: "/pdfjs/pdf.worker.min.mjs",
 *   assetsUrl: "/pdfjs",
 * });
 * ```
 */
export interface PdfBackendOptions {
  /**
   * URL of a pdf.js worker script (`pdf.worker.min.mjs` from the same `pdfjs-dist` version).
   * When not set, Readlet starts its bundled worker from a `blob:` URL.
   */
  workerSrc?: string;
  /**
   * An existing worker to use. The backend does not terminate a worker that you pass in.
   */
  workerPort?: Worker;
  /**
   * Base URL of the `pdfjs-dist` package files (`cmaps/`, `standard_fonts/`, `wasm/`,
   * `iccs/`). Defaults to jsDelivr, pinned to the bundled `pdfjs-dist` version.
   */
  assetsUrl?: string;
  /** Extra HTTP headers for URL sources. */
  httpHeaders?: Record<string, string>;
  /** Send cookies with cross-origin URL sources. */
  withCredentials?: boolean;
}

/** Loads the pdf.js main module once, lazily, so importing this package costs nothing. */
let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist");
  return pdfjsPromise;
}

function multiply(m1: readonly number[], m2: readonly number[]): Matrix {
  const [a1 = 0, b1 = 0, c1 = 0, d1 = 0, e1 = 0, f1 = 0] = m1;
  const [a2 = 0, b2 = 0, c2 = 0, d2 = 0, e2 = 0, f2 = 0] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function toRotation(value: number): Rotation {
  const r = (((Math.round(value / 90) * 90) % 360) + 360) % 360;
  return r as Rotation;
}

function mapPdfError(error: unknown): ReadletError {
  if (error instanceof ReadletError) return error;
  const name = (error as { name?: string } | null)?.name;
  const message = error instanceof Error ? error.message : String(error);
  switch (name) {
    case "InvalidPDFException":
      return new ReadletError("invalid-pdf", message, { cause: error });
    case "PasswordException":
      return new ReadletError("password-required", message, { cause: error });
    case "ResponseException":
    case "MissingPDFException":
    case "UnexpectedResponseException":
      return new ReadletError("network", message, { cause: error });
    case "RenderingCancelledException":
    case "AbortException":
      return new ReadletError("render-cancelled", message, { cause: error });
    default:
      if (error instanceof TypeError && /fetch|network/i.test(message)) {
        return new ReadletError("network", message, { cause: error });
      }
      return toReadletError(error, "unknown");
  }
}

/**
 * Owns the pdf.js worker of one backend. The worker starts on the first load and is terminated
 * when the last document of the backend is destroyed, so a destroyed viewer leaves no worker.
 */
class WorkerHost {
  #options: PdfBackendOptions;
  #worker: PDFWorkerType | null = null;
  #ownedWorker: Worker | null = null;
  #blobUrl: string | null = null;
  #users = 0;

  constructor(options: PdfBackendOptions) {
    this.#options = options;
  }

  async acquire(pdfjs: PdfJs): Promise<PDFWorkerType> {
    this.#users++;
    try {
      if (!this.#worker) this.#worker = await this.#start(pdfjs);
      return this.#worker;
    } catch (error) {
      this.#users--;
      throw new ReadletError("worker-failed", "The pdf.js worker could not start.", {
        cause: error,
      });
    }
  }

  release(): void {
    this.#users = Math.max(0, this.#users - 1);
    if (this.#users > 0) return;
    this.#worker?.destroy();
    this.#worker = null;
    this.#ownedWorker?.terminate();
    this.#ownedWorker = null;
    if (this.#blobUrl) URL.revokeObjectURL(this.#blobUrl);
    this.#blobUrl = null;
  }

  async #start(pdfjs: PdfJs): Promise<PDFWorkerType> {
    let port = this.#options.workerPort;
    if (!port) {
      let url = this.#options.workerSrc;
      if (!url) {
        const { default: source } = await import("./worker-source");
        this.#blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        url = this.#blobUrl;
      }
      port = new Worker(url, { type: "module", name: "readlet-pdfjs" });
      this.#ownedWorker = port;
    }
    const worker = new pdfjs.PDFWorker({ port: port as never });
    await worker.promise;
    return worker;
  }
}

async function sourceToParams(
  source: DocumentSource,
  onProgress: BackendLoadOptions["onProgress"],
): Promise<{ url: string } | { data: Uint8Array }> {
  if (typeof source === "string") return { url: source };
  if (source instanceof URL) return { url: source.href };
  // pdf.js transfers the buffer to the worker; copy it so the caller's buffer stays usable.
  if (source instanceof ArrayBuffer) return { data: new Uint8Array(source.slice(0)) };
  if (source instanceof Uint8Array) return { data: source.slice() };
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    const data = new Uint8Array(await source.arrayBuffer());
    onProgress?.({ loaded: data.byteLength, total: data.byteLength });
    return { data };
  }
  throw new ReadletError("invalid-pdf", "Unsupported document source.");
}

interface DestTarget {
  pageIndex: number | null;
  top: number | null;
}

class PdfPage implements BackendPage {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: Rotation;
  #page: PDFPageProxy;
  #doc: PdfDocument;
  #pdfjs: PdfJs;
  #baseViewport: PageViewport;

  constructor(page: PDFPageProxy, doc: PdfDocument, pdfjs: PdfJs) {
    this.#page = page;
    this.#doc = doc;
    this.#pdfjs = pdfjs;
    this.index = page.pageNumber - 1;
    this.#baseViewport = page.getViewport({ scale: 1 });
    this.width = this.#baseViewport.width;
    this.height = this.#baseViewport.height;
    this.rotation = toRotation(page.rotate);
  }

  async render({ canvas, scale, rotation, signal }: BackendRenderParams): Promise<void> {
    if (signal.aborted) throw new ReadletError("render-cancelled", "Render was cancelled.");
    const viewport = this.#page.getViewport({
      scale,
      rotation: (this.rotation + rotation) % 360,
    });
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const task = this.#page.render({
      canvas,
      viewport,
      annotationMode: this.#pdfjs.AnnotationMode.ENABLE,
    });
    const onAbort = () => task.cancel();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await task.promise;
    } catch (error) {
      throw mapPdfError(error);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  async getTextItems(): Promise<TextItem[]> {
    let content: TextContent;
    try {
      // Raw strings: Readlet applies its own normalisation (decision 0001.3).
      content = await this.#page.getTextContent({ disableNormalization: true });
    } catch (error) {
      throw mapPdfError(error);
    }
    const vt = this.#baseViewport.transform;
    const out: TextItem[] = [];
    for (const raw of content.items) {
      if (!("str" in raw)) continue;
      const item = raw as PdfTextItem;
      const style = content.styles[item.fontName];
      let ascent = 0.8;
      if (style?.ascent) ascent = style.ascent;
      else if (style?.descent) ascent = 1 + style.descent;
      out.push({
        str: item.str,
        dir: item.dir === "rtl" ? "rtl" : item.dir === "ttb" ? "ttb" : "ltr",
        transform: multiply(vt, item.transform as number[]),
        width: item.width,
        height: item.height,
        hasEOL: item.hasEOL,
        fontFamily: style?.fontFamily || "sans-serif",
        ascent,
        vertical: style?.vertical ?? false,
      });
    }
    return out;
  }

  async getLinks(): Promise<PageLink[]> {
    let annotations: Array<Record<string, unknown>>;
    try {
      annotations = await this.#page.getAnnotations({ intent: "display" });
    } catch (error) {
      throw mapPdfError(error);
    }
    const links: PageLink[] = [];
    for (const a of annotations) {
      if (a.subtype !== "Link" || !Array.isArray(a.rect)) continue;
      const [rx1 = 0, ry1 = 0, rx2 = 0, ry2 = 0] = a.rect as number[];
      const [x1, y1] = this.#baseViewport.convertToViewportPoint(rx1, ry1) as number[];
      const [x2, y2] = this.#baseViewport.convertToViewportPoint(rx2, ry2) as number[];
      const rect = {
        x: Math.min(x1 ?? 0, x2 ?? 0),
        y: Math.min(y1 ?? 0, y2 ?? 0),
        width: Math.abs((x2 ?? 0) - (x1 ?? 0)),
        height: Math.abs((y2 ?? 0) - (y1 ?? 0)),
      };
      const url = typeof a.url === "string" ? a.url : null;
      if (url) {
        links.push({ rect, pageIndex: null, top: null, url });
        continue;
      }
      if (a.dest !== undefined && a.dest !== null) {
        const target = await this.#doc.resolveDest(a.dest);
        if (target.pageIndex !== null) links.push({ rect, ...target, url: null });
      }
    }
    return links;
  }

  /** Converts a y value in PDF user space into page coordinates. */
  pdfYToPage(x: number, y: number): number {
    return (this.#baseViewport.convertToViewportPoint(x, y) as number[])[1] ?? 0;
  }

  cleanup(): void {
    this.#page.cleanup();
  }
}

class PdfDocument implements BackendDocument {
  readonly pageCount: number;
  #doc: PDFDocumentProxy;
  #task: PDFDocumentLoadingTask;
  #pdfjs: PdfJs;
  #release: () => void;
  #pages = new Map<number, Promise<PdfPage>>();
  #destroyed = false;

  constructor(
    doc: PDFDocumentProxy,
    task: PDFDocumentLoadingTask,
    pdfjs: PdfJs,
    release: () => void,
  ) {
    this.#doc = doc;
    this.#task = task;
    this.#pdfjs = pdfjs;
    this.#release = release;
    this.pageCount = doc.numPages;
  }

  getPage(index: number): Promise<PdfPage> {
    if (this.#destroyed)
      return Promise.reject(new ReadletError("destroyed", "Document was destroyed."));
    let page = this.#pages.get(index);
    if (!page) {
      page = this.#doc.getPage(index + 1).then(
        (p) => new PdfPage(p, this, this.#pdfjs),
        (error) => {
          this.#pages.delete(index);
          throw mapPdfError(error);
        },
      );
      this.#pages.set(index, page);
    }
    return page;
  }

  async resolveDest(dest: unknown): Promise<DestTarget> {
    try {
      let explicit: unknown = dest;
      if (typeof dest === "string") explicit = await this.#doc.getDestination(dest);
      if (!Array.isArray(explicit) || explicit.length === 0) return { pageIndex: null, top: null };
      const [ref, kind, ...args] = explicit as [
        unknown,
        { name?: string } | undefined,
        ...unknown[],
      ];
      let pageIndex: number;
      if (Number.isInteger(ref)) pageIndex = ref as number;
      else if (ref && typeof ref === "object")
        pageIndex = await this.#doc.getPageIndex(ref as never);
      else return { pageIndex: null, top: null };
      if (pageIndex < 0 || pageIndex >= this.pageCount) return { pageIndex: null, top: null };

      let top: number | null = null;
      const name = kind?.name;
      let pdfX = 0;
      let pdfY: unknown = null;
      if (name === "XYZ") {
        pdfX = typeof args[0] === "number" ? args[0] : 0;
        pdfY = args[1];
      } else if (name === "FitH" || name === "FitBH") {
        pdfY = args[0];
      } else if (name === "FitR") {
        pdfX = typeof args[0] === "number" ? args[0] : 0;
        pdfY = args[3];
      }
      if (typeof pdfY === "number") {
        const page = await this.getPage(pageIndex);
        top = Math.max(0, page.pdfYToPage(pdfX, pdfY));
      }
      return { pageIndex, top };
    } catch {
      return { pageIndex: null, top: null };
    }
  }

  async getOutline(): Promise<OutlineItem[]> {
    let raw: Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>;
    try {
      raw = await this.#doc.getOutline();
    } catch (error) {
      throw mapPdfError(error);
    }
    const convert = async (items: typeof raw): Promise<OutlineItem[]> =>
      Promise.all(
        (items ?? []).map(async (item) => {
          const target = item.dest
            ? await this.resolveDest(item.dest)
            : { pageIndex: null, top: null };
          return {
            title: item.title,
            pageIndex: target.pageIndex,
            top: target.top,
            url: item.url ?? null,
            items: await convert(item.items),
          };
        }),
      );
    return convert(raw);
  }

  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#pages.clear();
    try {
      await this.#task.destroy();
    } finally {
      this.#release();
    }
  }
}

/**
 * Creates the PDF backend. Create it once (for example at module level) and pass it to
 * `loadDocument` or `<Viewer backend>`. It starts a worker on the first load and stops it when
 * the last document is destroyed.
 *
 * @example
 * ```ts
 * import { loadDocument } from "@readlet/core";
 * import { createPdfBackend } from "@readlet/pdf";
 *
 * const pdf = createPdfBackend();
 * const doc = await loadDocument("/paper.pdf", { backend: pdf });
 * ```
 */
export function createPdfBackend(options: PdfBackendOptions = {}): DocumentBackend {
  const host = new WorkerHost(options);
  return {
    name: "pdf",
    async load(source, loadOptions = {}) {
      const { onProgress, signal } = loadOptions;
      if (signal?.aborted) throw new ReadletError("network", "Load was aborted.");
      const pdfjs = await loadPdfJs();
      const params = await sourceToParams(source, onProgress);
      const worker = await host.acquire(pdfjs);
      const assets = (
        options.assetsUrl ?? `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}`
      ).replace(/\/+$/, "");
      let task: PDFDocumentLoadingTask | null = null;
      const onAbort = () => void task?.destroy();
      try {
        task = pdfjs.getDocument({
          ...params,
          worker,
          httpHeaders: options.httpHeaders,
          withCredentials: options.withCredentials ?? false,
          cMapUrl: `${assets}/cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${assets}/standard_fonts/`,
          wasmUrl: `${assets}/wasm/`,
          iccUrl: `${assets}/iccs/`,
          enableXfa: false,
        });
        if (onProgress) {
          task.onProgress = ({ loaded, total }: { loaded: number; total?: number }) =>
            onProgress({ loaded, total: total && total > 0 ? total : null });
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        const doc = await task.promise;
        return new PdfDocument(doc, task, pdfjs, () => host.release());
      } catch (error) {
        void task?.destroy();
        host.release();
        if (signal?.aborted)
          throw new ReadletError("network", "Load was aborted.", { cause: error });
        throw mapPdfError(error);
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
