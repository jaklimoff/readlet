import {
  createSelectionManager,
  type PageRect,
  type SelectionManager,
  type SelectionManagerOptions,
  type TextRange,
  type Viewport,
} from "@readletjs/core";
import { useEffect, useMemo, useState } from "react";

/**
 * The state that {@link useSelection} returns.
 *
 * @example
 * ```tsx
 * const { range, text, setRange }: SelectionState = useSelection(viewport);
 * ```
 */
export interface SelectionState {
  /** The current selection, or `null`. */
  range: TextRange | null;
  /** The selected text (pages joined with a newline). Empty when nothing is selected. */
  text: string;
  /** Rectangles of the selection in page coordinates. */
  rects: PageRect[];
  /** Selects a range programmatically, or clears the selection with `null`. */
  setRange: (range: TextRange | null) => void;
  /** The core selection manager, or `null` before it exists. */
  manager: SelectionManager | null;
}

/**
 * Tracks the text selection inside a viewport as a {@link TextRange}.
 *
 * @example
 * ```tsx
 * const selection = useSelection(vp.viewport);
 * return <pre>{JSON.stringify(selection.range)}</pre>;
 * ```
 */
export function useSelection(
  viewport: Viewport | null,
  options: SelectionManagerOptions = {},
): SelectionState {
  const [manager, setManager] = useState<SelectionManager | null>(null);
  const [range, setRangeState] = useState<TextRange | null>(null);
  const [textVersion, setTextVersion] = useState(0);
  const handleCopy = options.handleCopy ?? true;

  useEffect(() => {
    if (!viewport || viewport.destroyed) return;
    const m = createSelectionManager(viewport, { handleCopy });
    const off = m.on("change", setRangeState);
    const offText = viewport.document.on("text", () => setTextVersion((v) => v + 1));
    setManager(m);
    return () => {
      off();
      offText();
      m.destroy();
      setManager(null);
      setRangeState(null);
    };
  }, [viewport, handleCopy]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: textVersion re-reads loaded text.
  const derived = useMemo(() => {
    if (!manager || !range) return { text: "", rects: [] as PageRect[] };
    return { text: manager.rangeToText(range), rects: manager.rangeToRects(range) };
  }, [manager, range, textVersion]);

  return {
    range,
    text: derived.text,
    rects: derived.rects,
    setRange: (r) => manager?.setRange(r),
    manager,
  };
}
