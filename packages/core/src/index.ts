// Model: pure logic, no DOM.
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
export { ReadletError, type ReadletErrorCode, isReadletError, toReadletError } from "./model/errors";
export {
  PT_TO_CSS,
  type ColumnLayout,
  type Size,
  columnLayout,
  effectiveDpr,
  mostVisiblePage,
  resolveScale,
  rotateSize,
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
export { type PageTextModel, type TextMeasurer, pageRangeRects, rangeToRects } from "./model/text-rects";
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

// DOM: rendering, text layer, viewport, selection.
export {
  type DocumentEvents,
  type LoadDocumentOptions,
  ReadletDocument,
  loadDocument,
} from "./dom/document";
export { canvasMeasurer } from "./dom/measure";
export { PageView, type PageViewState } from "./dom/page-view";
export {
  type SelectionEvents,
  SelectionManager,
  type SelectionManagerOptions,
  createSelectionManager,
} from "./dom/selection";
export { baseCss, injectStyles } from "./dom/styles";
export { CLASS as classNames, TextLayer } from "./dom/text-layer";
export {
  type GoToPageOptions,
  Viewport,
  type ViewportEvents,
  type ViewportOptions,
  createViewport,
} from "./dom/viewport";
