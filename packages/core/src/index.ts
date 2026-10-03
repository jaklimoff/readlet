// Model: pure logic, no DOM.

// DOM: rendering, text layer, viewport, selection.
export {
  type DocumentEvents,
  type LoadDocumentOptions,
  loadDocument,
  ReadletDocument,
} from "./dom/document";
export { canvasMeasurer } from "./dom/measure";
export { PageView, type PageViewState } from "./dom/page-view";
export {
  createSelectionManager,
  type SelectionEvents,
  SelectionManager,
  type SelectionManagerOptions,
} from "./dom/selection";
export { baseCss, injectStyles } from "./dom/styles";
export { CLASS as classNames, TextLayer } from "./dom/text-layer";
export {
  createViewport,
  type GoToPageOptions,
  Viewport,
  type ViewportEvents,
  type ViewportOptions,
} from "./dom/viewport";
export type {
  BackendDocument,
  BackendLoadOptions,
  BackendPage,
  BackendRenderParams,
  DocumentBackend,
  LoadProgress,
  Matrix,
  TextItem,
} from "./model/backend";
export { Emitter, type Listener, type Subscribable } from "./model/emitter";
export {
  isReadletError,
  ReadletError,
  type ReadletErrorCode,
  toReadletError,
} from "./model/errors";
export {
  type ColumnLayout,
  columnLayout,
  effectiveDpr,
  mostVisiblePage,
  PT_TO_CSS,
  resolveScale,
  rotateSize,
  type Size,
  visiblePages as visiblePagesInLayout,
} from "./model/layout";
export { type ItemGeometry, itemGeometry } from "./model/text-geometry";
export {
  NORMALISATION_VERSION,
  type NormalisedItem,
  type NormalisedPageText,
  type NormalisedSeparator,
  normaliseItemString,
  normalisePageText,
} from "./model/text-normalise";
export {
  clampRange,
  comparePositions,
  isCollapsed,
  isTextRange,
  makeRange,
  rangeOnPage,
  rangesEqual,
  rangeToText,
} from "./model/text-range";
export {
  type PageTextModel,
  pageRangeRects,
  rangeToRects,
  type TextMeasurer,
} from "./model/text-rects";
export type {
  DocumentSource,
  Highlight,
  OutlineItem,
  PageInfo,
  PageLink,
  PageRect,
  Rotation,
  TextPosition,
  TextRange,
  ViewMode,
  ZoomMode,
} from "./model/types";
