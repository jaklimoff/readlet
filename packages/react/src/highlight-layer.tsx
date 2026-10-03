import type { Highlight, TextRange } from "@readletjs/core";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";
import { usePage } from "./page";

/**
 * Props of {@link HighlightLayer}.
 *
 * @example
 * ```tsx
 * const props: HighlightLayerProps = { highlights: [range], color: "rgba(0,200,255,.3)" };
 * ```
 */
export interface HighlightLayerProps {
  /** Highlights (or bare ranges) to draw. Only the parts on this page are drawn. */
  highlights: ReadonlyArray<Highlight | TextRange>;
  /** Default color for highlights without one. */
  color?: string;
  /** Extra class for each highlight rectangle. */
  className?: string;
}

const DEFAULT_COLOR = "rgba(255, 214, 0, 0.45)";

function toHighlight(h: Highlight | TextRange): Highlight {
  return "range" in h ? h : { range: h };
}

/**
 * Draws host-supplied highlights on the page it is rendered in. Must be inside {@link Page}.
 *
 * @example
 * ```tsx
 * <Page page={p} viewport={viewport}>
 *   <HighlightLayer highlights={[{ range, color: "rgba(0,200,255,.35)", id: "bob" }]} />
 * </Page>
 * ```
 */
export function HighlightLayer({ highlights, color, className }: HighlightLayerProps): ReactNode {
  const { page, document } = usePage();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (document.getCachedTextModel(page.index)) return;
    const off = document.on("text", (index) => {
      if (index === page.index) setVersion((v) => v + 1);
    });
    void document.getTextModel(page.index).catch(() => {});
    return off;
  }, [document, page.index]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version re-reads loaded text.
  const boxes = useMemo(() => {
    const { width, height } = page.info;
    const out: Array<{ key: string; style: CSSProperties }> = [];
    highlights.forEach((h, i) => {
      const hl = toHighlight(h);
      if (page.index < hl.range.start.page || page.index > hl.range.end.page) return;
      const rects = document.rangeToRects(hl.range).filter((r) => r.page === page.index);
      rects.forEach((r, j) => {
        out.push({
          key: `${hl.id ?? i}-${j}`,
          style: {
            position: "absolute",
            left: `${(r.x / width) * 100}%`,
            top: `${(r.y / height) * 100}%`,
            width: `${(r.width / width) * 100}%`,
            height: `${(r.height / height) * 100}%`,
            background: hl.color ?? color ?? DEFAULT_COLOR,
            mixBlendMode: "multiply",
            pointerEvents: "none",
          },
        });
      });
    });
    return out;
  }, [highlights, color, document, page.index, page.info, version]);

  return (
    <>
      {boxes.map((b) => (
        <div key={b.key} className={className} data-readlet-highlight="" style={b.style} />
      ))}
    </>
  );
}
