// A consumer of the published types. It must compile against packages/*/dist (see tsconfig.json).
import {
  createSelectionManager,
  createViewport,
  isReadletError,
  loadDocument,
  NORMALISATION_VERSION,
  normalisePageText,
  type PageInfo,
  type ReadletErrorCode,
  type TextRange,
} from "@readletjs/core";
import { createPdfBackend } from "@readletjs/pdf";
import {
  type GoToPageOptions,
  useDocument,
  useSelection,
  useViewport,
  Viewer,
  type ViewerHandle,
} from "@readletjs/react";
import { useRef } from "react";

const pdf = createPdfBackend({ prefetch: false, rangeChunkSize: 65536 });

export async function headless(container: HTMLElement): Promise<string> {
  try {
    const doc = await loadDocument("/paper.pdf", {
      backend: pdf,
      initialPage: 2,
      pageSizes: "lazy",
    });
    const info: PageInfo = await doc.loadPageInfo(2);
    doc.on("pageinfo", (p) => p.estimated);
    doc.on("textload", (index: number) => index);
    const viewport = createViewport(doc, { container, zoom: "fit-width" });
    viewport.goToPage(3, { top: 100, smooth: true });
    viewport.getPageView(0)?.overlay.append(document.createElement("div"));
    const selection = createSelectionManager(viewport);
    const range: TextRange = { start: { page: 0, offset: 0 }, end: { page: 0, offset: 5 } };
    selection.setRange(range);
    const stored = { range, normalisation: NORMALISATION_VERSION };
    normalisePageText([]);
    return `${info.width} ${selection.rangeToText(stored.range)}`;
  } catch (error) {
    if (isReadletError(error)) {
      const code: ReadletErrorCode = error.code;
      if (code === "aborted") return "";
    }
    throw error;
  }
}

export function App() {
  const ref = useRef<ViewerHandle>(null);
  const options: GoToPageOptions = { top: 20 };
  return (
    <Viewer
      ref={ref}
      src="/paper.pdf"
      backend={pdf}
      initialPage={1}
      onSelectionChange={(r) => r?.start.page}
      onLoad={(doc) => ref.current?.goToPage(doc.pageCount - 1, options)}
    />
  );
}

export function Custom({ src }: { src: string }) {
  const container = useRef<HTMLDivElement>(null);
  const doc = useDocument(src, { backend: pdf, initialPage: 0 });
  const vp = useViewport(container, doc.document, { mode: "scroll" });
  const sel = useSelection(vp.viewport);
  return <div ref={container}>{sel.text}</div>;
}
