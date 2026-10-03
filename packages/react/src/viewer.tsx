import type {
  DocumentBackend,
  DocumentSource,
  Highlight,
  LoadProgress,
  PageLink,
  ReadletDocument,
  ReadletError,
  Rotation,
  SelectionManager,
  TextRange,
  ViewMode,
  Viewport,
  ZoomMode,
} from "@readlet/core";
import {
  type CSSProperties,
  type ForwardedRef,
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { HighlightLayer } from "./highlight-layer";
import { Page } from "./page";
import { useDocument } from "./use-document";
import { useSelection } from "./use-selection";
import { useViewport } from "./use-viewport";

/**
 * Props of {@link Viewer}.
 */
export interface ViewerProps {
  /** The document: a URL, `ArrayBuffer`, `Uint8Array`, `Blob` or `File`. */
  src: DocumentSource | null | undefined;
  /** The format backend, for example `createPdfBackend()`. Keep it stable. */
  backend: DocumentBackend;
  /** `"scroll"` (default) or `"page"`. */
  mode?: ViewMode;
  /** `"fit-width"` (default), `"fit-page"` or a number (1 = 100%). */
  zoom?: ZoomMode;
  /** User rotation. Default `0`. */
  rotation?: Rotation;
  /** Zero-based page to open at. Read once per document. */
  initialPage?: number;
  /** Highlights to draw, for example remote users' selections. */
  highlights?: ReadonlyArray<Highlight | TextRange>;
  onLoad?: (document: ReadletDocument) => void;
  onError?: (error: ReadletError) => void;
  onProgress?: (progress: LoadProgress) => void;
  onPageChange?: (index: number) => void;
  onSelectionChange?: (range: TextRange | null) => void;
  /** See `ViewportOptions.onLinkClick`. */
  onLinkClick?: (link: PageLink, event: MouseEvent) => void;
  /** Shown while loading. */
  loading?: ReactNode;
  /** Shown when loading fails. */
  error?: ReactNode | ((error: ReadletError) => ReactNode);
  className?: string;
  style?: CSSProperties;
  /** Accessible name of the viewer. Default `"Document viewer"`. */
  "aria-label"?: string;
  /** Extra overlay content for every rendered page (it can use `usePage()`). */
  renderPageOverlay?: (pageIndex: number) => ReactNode;
}

/**
 * The imperative handle of {@link Viewer}, through `ref`.
 *
 * @example
 * ```tsx
 * const ref = useRef<ViewerHandle>(null);
 * <button onClick={() => ref.current?.goToPage(0)}>First page</button>
 * ```
 */
export interface ViewerHandle {
  document: ReadletDocument | null;
  viewport: Viewport | null;
  selection: SelectionManager | null;
  goToPage: (index: number) => void;
}

function ViewerImpl(props: ViewerProps, ref: ForwardedRef<ViewerHandle>): ReactNode {
  const {
    src,
    backend,
    mode = "scroll",
    zoom = "fit-width",
    rotation = 0,
    initialPage,
    highlights,
    onLoad,
    onError,
    onProgress,
    onPageChange,
    onSelectionChange,
    onLinkClick,
    loading,
    error,
    className,
    style,
    renderPageOverlay,
  } = props;
  const containerRef = useRef<HTMLElement>(null);
  const callbacks = useRef({
    onLoad,
    onError,
    onProgress,
    onPageChange,
    onSelectionChange,
    onLinkClick,
  });
  callbacks.current = { onLoad, onError, onProgress, onPageChange, onSelectionChange, onLinkClick };

  const doc = useDocument(src, { backend });
  const vp = useViewport(containerRef, doc.document, {
    mode,
    zoom,
    rotation,
    ...(initialPage !== undefined ? { initialPage } : {}),
    onLinkClick: (link, event) => callbacks.current.onLinkClick?.(link, event),
  });
  const selection = useSelection(vp.viewport);

  useEffect(() => {
    if (doc.status === "ready") callbacks.current.onLoad?.(doc.document);
    if (doc.status === "error") callbacks.current.onError?.(doc.error);
  }, [doc.status, doc.document, doc.error]);
  useEffect(() => {
    if (doc.progress) callbacks.current.onProgress?.(doc.progress);
  }, [doc.progress]);
  useEffect(() => {
    const document = doc.document;
    if (!document) return;
    return document.on("error", (e) => callbacks.current.onError?.(e));
  }, [doc.document]);
  useEffect(() => {
    if (vp.viewport) callbacks.current.onPageChange?.(vp.currentPage);
  }, [vp.viewport, vp.currentPage]);
  useEffect(() => {
    callbacks.current.onSelectionChange?.(selection.range);
  }, [selection.range]);

  useImperativeHandle(
    ref,
    () => ({
      document: doc.document,
      viewport: vp.viewport,
      selection: selection.manager,
      goToPage: (index: number) => vp.viewport?.goToPage(index),
    }),
    [doc.document, vp.viewport, selection.manager],
  );

  return (
    <section
      ref={containerRef}
      className={className}
      style={{ height: "100%", overflow: "auto", position: "relative", ...style }}
      aria-label={props["aria-label"] ?? "Document viewer"}
      aria-busy={doc.status === "loading"}
      data-readlet-status={doc.status}
    >
      {doc.status === "loading" ? loading : null}
      {doc.status === "error" ? (typeof error === "function" ? error(doc.error) : error) : null}
      {vp.viewport && ((highlights && highlights.length > 0) || renderPageOverlay)
        ? vp.visiblePages.map((p) => (
            <Page key={p.index} page={p} viewport={vp.viewport as Viewport}>
              {highlights && highlights.length > 0 ? (
                <HighlightLayer highlights={highlights} />
              ) : null}
              {renderPageOverlay?.(p.index)}
            </Page>
          ))
        : null}
    </section>
  );
}

/**
 * The one-component viewer: loads a document, renders it with virtualisation, a selectable text
 * layer, links, zoom and rotation, and reports selection as {@link TextRange}s.
 *
 * @example
 * ```tsx
 * import { Viewer } from "@readlet/react";
 * import { createPdfBackend } from "@readlet/pdf";
 *
 * const pdf = createPdfBackend();
 *
 * export function App() {
 *   return (
 *     <div style={{ height: "100vh" }}>
 *       <Viewer src="/paper.pdf" backend={pdf} onSelectionChange={console.log} />
 *     </div>
 *   );
 * }
 * ```
 */
export const Viewer = forwardRef<ViewerHandle, ViewerProps>(ViewerImpl);
Viewer.displayName = "Viewer";
