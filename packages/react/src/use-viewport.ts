import {
  createViewport,
  type PageInfo,
  type PageView,
  type ReadletDocument,
  type Rotation,
  type ViewMode,
  type Viewport,
  type ViewportOptions,
  type ZoomMode,
} from "@readlet/core";
import { type RefObject, useEffect, useLayoutEffect, useMemo, useState } from "react";

/**
 * A page in the render window, as {@link useViewport} returns it.
 *
 * @example
 * ```tsx
 * viewport.visiblePages.map((p) => <Page key={p.index} page={p} viewport={viewport} />);
 * ```
 */
export interface PageHandle {
  index: number;
  info: PageInfo;
  view: PageView;
}

/**
 * Options for {@link useViewport}. `mode`, `zoom` and `rotation` can change at any time; the
 * other options are read once when the viewport is created.
 *
 * @example
 * ```tsx
 * useViewport(ref, doc, { mode: "page", zoom: 1.25 });
 * ```
 */
export type UseViewportOptions = Omit<ViewportOptions, "container">;

/**
 * The state that {@link useViewport} returns.
 */
export interface ViewportState {
  /** The core viewport, or `null` before it exists. */
  viewport: Viewport | null;
  currentPage: number;
  pageCount: number;
  scale: number;
  visiblePages: PageHandle[];
  goToPage: (index: number, options?: { top?: number | null; smooth?: boolean }) => void;
  nextPage: () => void;
  previousPage: () => void;
}

/**
 * Creates a core viewport in a container element and keeps it in sync with React.
 *
 * @example
 * ```tsx
 * const ref = useRef<HTMLDivElement>(null);
 * const doc = useDocument(src, { backend });
 * const vp = useViewport(ref, doc.document, { mode: "scroll", zoom: "fit-width" });
 * return <div ref={ref} style={{ height: "100vh" }} />;
 * ```
 */
export function useViewport(
  containerRef: RefObject<HTMLElement | null>,
  document: ReadletDocument | null,
  options: UseViewportOptions = {},
): ViewportState {
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [, setTick] = useState(0);
  const { mode, zoom, rotation } = options;

  // biome-ignore lint/correctness/useExhaustiveDependencies: other options are read once on purpose.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !document || document.destroyed) return;
    const vp = createViewport(document, { ...options, container });
    const bump = () => setTick((t) => t + 1);
    const offs = [
      vp.on("pagechange", bump),
      vp.on("scalechange", bump),
      vp.on("visiblechange", bump),
    ];
    setViewport(vp);
    return () => {
      for (const off of offs) off();
      vp.destroy();
      setViewport(null);
    };
  }, [containerRef, document]);

  useEffect(() => {
    if (viewport && mode) viewport.setMode(mode as ViewMode);
  }, [viewport, mode]);
  useEffect(() => {
    if (viewport && zoom !== undefined) viewport.setZoom(zoom as ZoomMode);
  }, [viewport, zoom]);
  useEffect(() => {
    if (viewport && rotation !== undefined) viewport.setRotation(rotation as Rotation);
  }, [viewport, rotation]);

  const visible = viewport?.visiblePages ?? [];
  const visibleKey = visible.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: visibleKey captures the content.
  const visiblePages = useMemo<PageHandle[]>(() => {
    if (!viewport) return [];
    return visible.flatMap((index) => {
      const view = viewport.getPageView(index);
      return view ? [{ index, info: view.info, view }] : [];
    });
  }, [viewport, visibleKey]);

  return {
    viewport,
    currentPage: viewport?.currentPage ?? 0,
    pageCount: document?.pageCount ?? 0,
    scale: viewport?.scale ?? 1,
    visiblePages,
    goToPage: (index, opts) => viewport?.goToPage(index, opts),
    nextPage: () => viewport?.nextPage(),
    previousPage: () => viewport?.previousPage(),
  };
}
