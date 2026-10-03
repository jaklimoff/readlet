import type { ReadletDocument, Viewport } from "@readlet/core";
import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";
import type { PageHandle } from "./use-viewport";

/**
 * What a component inside {@link Page} can read with {@link usePage}.
 *
 * @example
 * ```tsx
 * const { page, viewport }: PageContextValue = usePage();
 * ```
 */
export interface PageContextValue {
  page: PageHandle;
  viewport: Viewport;
  document: ReadletDocument;
}

const PageContext = createContext<PageContextValue | null>(null);

/**
 * The page that the calling component is rendered in. Throws outside {@link Page}.
 *
 * @example
 * ```tsx
 * function PageNumber() {
 *   const { page } = usePage();
 *   return <span>{page.index + 1}</span>;
 * }
 * ```
 */
export function usePage(): PageContextValue {
  const value = useContext(PageContext);
  if (!value) throw new Error("usePage() must be used inside <Page>.");
  return value;
}

/**
 * Props of {@link Page}.
 *
 * @example
 * ```tsx
 * <Page page={handle} viewport={viewport}>{overlay}</Page>
 * ```
 */
export interface PageProps {
  page: PageHandle;
  viewport: Viewport;
  children?: ReactNode;
}

/**
 * Renders children over one page, in page orientation, scaled with the page. Readlet's core owns
 * the page DOM (canvas, text layer); `Page` portals your overlay content into it. Positions in
 * percentages of the page box stay correct at every zoom and rotation.
 *
 * @example
 * ```tsx
 * {vp.visiblePages.map((p) => (
 *   <Page key={p.index} page={p} viewport={vp.viewport!}>
 *     <HighlightLayer highlights={remote} />
 *   </Page>
 * ))}
 * ```
 */
export function Page({ page, viewport, children }: PageProps): ReactNode {
  return createPortal(
    <PageContext.Provider value={{ page, viewport, document: viewport.document }}>
      {children}
    </PageContext.Provider>,
    page.view.overlay,
    `rl-page-${page.index}`,
  );
}
