import {
  type DocumentBackend,
  type DocumentSource,
  type LoadProgress,
  loadDocument,
  type ReadletDocument,
  type ReadletError,
  toReadletError,
} from "@readlet/core";
import { useEffect, useRef, useState } from "react";

/**
 * The state that {@link useDocument} returns.
 *
 * @example
 * ```tsx
 * const doc = useDocument(src, { backend });
 * if (doc.status === "error") return <p>{doc.error.code}</p>;
 * ```
 */
export type DocumentState =
  | { status: "idle"; document: null; error: null; progress: null }
  | { status: "loading"; document: null; error: null; progress: LoadProgress | null }
  | { status: "ready"; document: ReadletDocument; error: null; progress: LoadProgress | null }
  | { status: "error"; document: null; error: ReadletError; progress: LoadProgress | null };

/**
 * Options for {@link useDocument}.
 *
 * @example
 * ```tsx
 * const pdf = createPdfBackend(); // module level, so it is stable
 * useDocument(src, { backend: pdf });
 * ```
 */
export interface UseDocumentOptions {
  /** The format backend. Keep it stable (create it at module level or with `useMemo`). */
  backend: DocumentBackend;
  /** Zero-based page to load first (see `LoadDocumentOptions.initialPage`). Read once per load. */
  initialPage?: number;
  /** `"lazy"` (default) or `"eager"` page sizes (see `LoadDocumentOptions.pageSizes`). */
  pageSizes?: "lazy" | "eager";
}

const IDLE: DocumentState = { status: "idle", document: null, error: null, progress: null };

/**
 * Loads a document and destroys it when `src` changes or the component unmounts.
 * `src = null` or `undefined` means "no document".
 *
 * @example
 * ```tsx
 * import { useDocument } from "@readlet/react";
 * import { createPdfBackend } from "@readlet/pdf";
 *
 * const pdf = createPdfBackend();
 *
 * function PageCount({ src }: { src: string }) {
 *   const doc = useDocument(src, { backend: pdf });
 *   return <span>{doc.status === "ready" ? doc.document.pageCount : "…"}</span>;
 * }
 * ```
 */
export function useDocument(
  src: DocumentSource | null | undefined,
  options: UseDocumentOptions,
): DocumentState {
  const { backend } = options;
  const [state, setState] = useState<DocumentState>(IDLE);
  const progressRef = useRef<LoadProgress | null>(null);
  // Read once per load: a change alone does not reload the document.
  const loadOptionsRef = useRef(options);
  loadOptionsRef.current = options;

  useEffect(() => {
    if (src === null || src === undefined) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    let loaded: ReadletDocument | null = null;
    let disposed = false;
    progressRef.current = null;
    setState({ status: "loading", document: null, error: null, progress: null });
    let frame = 0;
    const { initialPage, pageSizes } = loadOptionsRef.current;
    loadDocument(src, {
      backend,
      signal: controller.signal,
      ...(initialPage !== undefined ? { initialPage } : {}),
      ...(pageSizes !== undefined ? { pageSizes } : {}),
      onProgress: (progress) => {
        progressRef.current = progress;
        if (frame || disposed) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (disposed) return;
          setState((s) => (s.status === "loading" ? { ...s, progress: progressRef.current } : s));
        });
      },
    }).then(
      (doc) => {
        if (disposed) {
          void doc.destroy();
          return;
        }
        loaded = doc;
        setState({ status: "ready", document: doc, error: null, progress: progressRef.current });
      },
      (error: unknown) => {
        if (disposed) return;
        setState({
          status: "error",
          document: null,
          error: toReadletError(error),
          progress: progressRef.current,
        });
      },
    );
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      controller.abort();
      if (loaded) void loaded.destroy();
    };
  }, [src, backend]);

  return state;
}
