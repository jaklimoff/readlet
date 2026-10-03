# 0008 — API review before the first release (0.1.0)

Status: accepted · 2026-10-03

## Context

The first published version fixes the API that users write code against. Changes are allowed in
0.x, but each one costs every user an upgrade. This review went through every export of the three
packages before 0.1.0.

## Findings and decisions

### 1. Core exports too many internals

The root of `@readletjs/core` exported layout maths (`columnLayout`, `effectiveDpr`,
`mostVisiblePage`, `resolveScale`, `rotateSize`, `visiblePagesInLayout`, `PT_TO_CSS`), text
geometry (`itemGeometry`), normalisation steps (`normaliseItemString`), `pageRangeRects`,
`Emitter`, `canvasMeasurer` and the `TextLayer` class. No other package, test or example uses
them, and each one would be a promise to keep it stable.

Decision: they are no longer exported. They stay unit-tested inside core.

Kept on purpose:

- `normalisePageText`, `NORMALISATION_VERSION` and the `Normalised*` types: a server can compute
  the same page strings as the browser (for example to index text or check stored ranges).
- The pure `rangeToText` and `rangeToRects` with `PageTextModel` and `TextMeasurer`, and the
  `TextRange` helpers: they work without a DOM.
- `classNames`, `baseCss` and `injectStyles`: for custom styles and strict CSP.
- `PageView`, as the type of `viewport.getPageView(i)`, for `element` and `overlay`.

### 2. Internal members are hidden from the published types

Some members must be public in JavaScript because core's own modules call them
(`ReadletDocument.reportError`, `Viewport.setPinnedPages`, `Viewport.getTextLayers`, the
`PageView` constructor, `render`, `release`, `applySettings` and others). They are marked
`@internal`, and the declaration build uses `stripInternal`, so they are not in the `.d.ts` files.

### 3. An aborted load is not a network error

`loadDocument` with an aborted `signal` rejected with code `network`. An app would then show a
network error when the user only opened another file. New code: `aborted`.

### 4. Document event `text` is renamed `textload`

`text` did not say what happened. `textload` (payload: page index) matches the other event names.

### 5. `@readletjs/react` has core as a peer dependency

`@readletjs/pdf` had core as a peer dependency, but `@readletjs/react` had it as a normal
dependency. With a normal dependency, an app with another core version gets two copies of core:
`instanceof ReadletError` fails and documents from one copy do not work with the other. Both
adapters now have core as a peer dependency (the README already installs all three packages).

### 6. React re-exports the types of its own signatures

`ViewerProps`, `ViewerHandle` and the hook results use `ReadletDocument`, `Viewport`,
`SelectionManager`, `PageLink`, `LoadProgress`, `DocumentBackend` and `GoToPageOptions`. These are
now re-exported as types from `@readletjs/react`, so a React app can type its code from one
import.

### 7. `goToPage` options are the same everywhere

`ViewerHandle.goToPage(index)` had no options, while `useViewport().goToPage` had an inline type.
Both now take `GoToPageOptions` (`top`, `smooth`), like `Viewport.goToPage`.

### 8. `goToPage({ top })` at 90° and 270° is documented, not changed

At a user rotation of 90° or 270°, `top` is ignored, and this was listed as a bug. It is correct:
after the rotation, a horizontal line of the page runs vertically on screen, and its screen
position depends on x, not on `top`. No vertical scroll position can put that line at the top.
The viewer goes to the top of the page, and `GoToPageOptions.top` now says so.

### Not changed

- `TextRange` keeps the shape of the brief and has no version field. Apps that store ranges should
  store `NORMALISATION_VERSION` next to them (README).
- Event names stay lowercase DOM style (`pagechange`, `scalechange`, …).
- `ReadletDocument.getPage` (the backend page) stays public for advanced use, as documented.
- Password-protected PDFs (an option to give a password) are planned for 0.2; the
  `password-required` code already exists.
