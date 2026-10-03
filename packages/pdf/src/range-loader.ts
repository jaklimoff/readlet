import { ReadletError } from "@readletjs/core";
import type { PDFDataRangeTransport } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");

/** What the first request found out about a URL. */
export type ProbeResult =
  /** The server answered with a range: load the rest on demand. */
  | { kind: "range"; length: number; initialData: Uint8Array }
  /** The server sent the whole file (no range support, or a small file). */
  | { kind: "data"; data: Uint8Array }
  /** The server sent a range but hid its total size (CORS): let pdf.js load the URL itself. */
  | { kind: "url" };

export interface FetchOptions {
  headers: Record<string, string>;
  credentials: RequestCredentials;
}

const RETRY_DELAYS_MS = [250, 1000];

/** A promise that rejects on request. Unhandled rejections are ignored: nobody may be waiting. */
function failureSignal(): { promise: Promise<never>; reject: (error: unknown) => void } {
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<never>((_, r) => {
    reject = r;
  });
  promise.catch(() => {});
  return { promise, reject };
}

function rangeHeaders(options: FetchOptions, begin: number, end: number): Record<string, string> {
  return { ...options.headers, Range: `bytes=${begin}-${end - 1}` };
}

async function readAll(
  response: Response,
  onProgress?: (loaded: number, total: number | null) => void,
): Promise<Uint8Array> {
  const total = Number(response.headers.get("Content-Length")) || null;
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    onProgress?.(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

function httpError(response: Response): ReadletError {
  return new ReadletError(
    "network",
    `The server answered ${response.status} ${response.statusText}`.trim(),
  );
}

/**
 * Requests the first `chunkSize` bytes of `url` with a Range header. pdf.js always starts with a
 * request for the whole file and cancels it when the headers show range support; until the
 * cancel, bytes of the whole file arrive. This probe asks for one chunk only.
 */
export async function probe(
  url: string,
  chunkSize: number,
  options: FetchOptions,
  signal: AbortSignal | undefined,
  onProgress?: (loaded: number, total: number | null) => void,
): Promise<ProbeResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: rangeHeaders(options, 0, chunkSize),
      credentials: options.credentials,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    throw new ReadletError("network", "The document could not be fetched.", { cause: error });
  }
  if (response.status === 200) {
    return { kind: "data", data: await readAll(response, onProgress) };
  }
  if (response.status !== 206) throw httpError(response);
  const total = /\/(\d+)\s*$/.exec(response.headers.get("Content-Range") ?? "")?.[1];
  if (total === undefined) {
    // Content-Range is not exposed to the page (CORS). pdf.js then decides from Accept-Ranges.
    void response.body?.cancel();
    return { kind: "url" };
  }
  const initialData = await readAll(response);
  const length = Number(total);
  onProgress?.(initialData.byteLength, length);
  if (initialData.byteLength >= length) return { kind: "data", data: initialData };
  return { kind: "range", length, initialData };
}

/**
 * Feeds pdf.js the byte ranges that it asks for, with HTTP Range requests. A failed range is
 * retried; when it still fails, waiting page operations reject with a `network` error (see
 * {@link RangeLoader.guard}) and the range is requested again by the next page operation.
 */
export class RangeLoader {
  readonly transport: PDFDataRangeTransport;
  #url: string;
  #options: FetchOptions;
  #abort = new AbortController();
  #failed = new Map<number, number>();
  #failure = failureSignal();

  constructor(
    pdfjs: PdfJs,
    url: string,
    result: Extract<ProbeResult, { kind: "range" }>,
    options: FetchOptions,
  ) {
    this.#url = url;
    this.#options = options;
    const loader = this;
    const Transport = class extends pdfjs.PDFDataRangeTransport {
      override requestDataRange(begin: number, end: number): void {
        void loader.#load(begin, end);
      }
      override abort(): void {
        loader.#abort.abort();
      }
    };
    // The first chunk goes in as initial data, so pdf.js does not request it again.
    this.transport = new Transport(result.length, result.initialData);
  }

  /**
   * Runs a page operation. Before it starts, failed ranges are requested again; when a range
   * fails while it runs, it rejects with a `network` error instead of waiting forever.
   */
  guard<T>(operation: () => Promise<T>): Promise<T> {
    this.#retryFailed();
    return Promise.race([operation(), this.#failure.promise]);
  }

  async #load(begin: number, end: number): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      if (this.#abort.signal.aborted) return;
      try {
        const response = await fetch(this.#url, {
          headers: rangeHeaders(this.#options, begin, end),
          credentials: this.#options.credentials,
          signal: this.#abort.signal,
        });
        if (response.status !== 206 && response.status !== 200) throw httpError(response);
        let bytes = await readAll(response);
        // A server that ignores Range sends the whole file with 200.
        if (response.status === 200) bytes = bytes.subarray(begin, end);
        if (this.#abort.signal.aborted) return;
        this.#failed.delete(begin);
        this.transport.onDataRange(begin, bytes);
        return;
      } catch (error) {
        if (this.#abort.signal.aborted) return;
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          this.#failed.set(begin, end);
          const failure = this.#failure;
          this.#failure = failureSignal();
          failure.reject(
            error instanceof ReadletError
              ? error
              : new ReadletError("network", "A part of the document could not be fetched.", {
                  cause: error,
                }),
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  #retryFailed(): void {
    const failed = [...this.#failed];
    this.#failed.clear();
    for (const [begin, end] of failed) void this.#load(begin, end);
  }
}
