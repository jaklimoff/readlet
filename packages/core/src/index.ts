// Model: pure logic, no DOM.

// DOM: rendering, text layer, viewport, selection.
export {
  type DocumentEvents,
  type LoadDocumentOptions,
  loadDocument,
  ReadletDocument,
} from "./dom/document";
export { PageView, type PageViewState } from "./dom/page-view";
export {
  createSelectionManager,
  type SelectionEvents,
  SelectionManager,
  type SelectionManagerOptions,
} from "./dom/selection";
export { baseCss, injectStyles } from "./dom/styles";
export { CLASS as classNames } from "./dom/text-layer";
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
export type { Listener, Subscribable } from "./model/emitter";
export {
  isReadletError,
  ReadletError,
  type ReadletErrorCode,
  toReadletError,
} from "./model/errors";
export {
  NORMALISATION_VERSION,
  type NormalisedItem,
  type NormalisedPageText,
  type NormalisedSeparator,
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
export { type PageTextModel, rangeToRects, type TextMeasurer } from "./model/text-rects";
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
