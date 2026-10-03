# Readlet - project brief for agents

Oct 3, 2026 · @Jack Klimov

## What Readlet is

Readlet is an open source, MIT licensed TypeScript library for loading and rendering documents in the browser, starting with PDF, with EPUB planned. It renders pages on canvas, lays a selectable text layer over them, and exposes selection as stable, serialisable ranges that any app can store, sync or annotate.

It exists because the current options are a bad trade: pdf.js is powerful but low level and awkward to integrate, react-pdf wraps it thinly and breaks in ways that are hard to debug, and everything polished (PSPDFKit, Apryse, PDFTron) is paid and closed. Readlet is the drop-in middle ground: `npm install`, one component or one function, pages on screen.

Design principles, in priority order:

1. Drop-in. A working viewer in under 10 lines, no build config, no worker path fiddling by the consumer.
2. Framework-agnostic core. All rendering, layout and selection logic lives in a plain TypeScript package with zero framework dependencies. React is the first and only adapter in v0.1; Vue, Svelte and Web Components come later without touching the core.
3. Correct text selection. Selection must feel native: continuous across pages, matching the visible glyphs, copyable, and addressable by stable ranges. This is the feature that most libraries get wrong and the one Readlet is judged on.
4. Predictable, not clever. Explicit lifecycle (load, render, destroy), typed events, no hidden globals, no surprising re-renders.
5. Small surface. Ship what people need to build a reader, not a full editor. Say no to features that pull in editing, forms or signatures.

Readlet is not built for one product. Collaborative reading (shared cursors, shared selections) is a motivating use case and must be easy to build on top, but nothing collaboration-specific lives inside the library.

## Scope of v0.1

v0.1 is PDF only, React only, read only. It ships when all of the following work in Chrome, Firefox and Safari (latest two versions) on desktop and mobile:

- Load a PDF from a URL, `ArrayBuffer`, `Blob` or `File`, with progress and error events.
- Render pages to canvas at a given scale and device pixel ratio, crisp on retina.
- Two viewing modes behind one prop: continuous vertical scroll, and single page with next/previous.
- Virtualised rendering: only pages near the viewport are rendered; off-screen pages are released. A 1,000 page PDF must stay under 200 MB of heap and scroll without jank.
- A text layer over every rendered page that supports native browser selection, Ctrl/Cmd+C, double click to select a word, and selection that continues across page boundaries in scroll mode.
- A `TextRange` model: `{ start: {page, offset}, end: {page, offset} }` with character offsets into a per-page normalised text string. Ranges are stable across zoom, resize and re-render, and serialisable to JSON.
- Conversion both ways: DOM `Selection` to `TextRange`, and `TextRange` to on-screen rectangles (for drawing highlights or remote selections).
- Zoom (fit width, fit page, explicit scale) and rotation (0/90/180/270).
- Page navigation API: go to page, current page, page count, `onPageChange`.
- Outline (bookmarks) and link annotations: read the outline, click internal links to navigate. External links open in a new tab.
- Keyboard accessibility and `aria` labels on the viewer and pages.

Explicit non-goals for v0.1, and for the project unless stated otherwise:

- No editing, form filling, signatures or annotation authoring. Highlights are drawn from `TextRange`s the host app supplies; Readlet never stores them.
- No built-in toolbar UI. Ship headless primitives plus one minimal unstyled example viewer; let consumers build their own chrome.
- No server component, no file upload, no auth.
- No collaboration logic: no cursors, presence, websockets or CRDTs. Readlet only makes those easy to build by exposing `TextRange` and page geometry.
- No search in v0.1 (planned for v0.2).
- No printing, no download button.

## Architecture

A pnpm monorepo with three published packages and one private example app. The dependency direction is strict: adapters depend on core, core depends on nothing framework-shaped.

| Package               | Depends on                         | Responsibility                                                                                                                                                                                                                         |
| --------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@readlet/core`       | `pdfjs-dist` only                  | Document loading, page model, canvas rendering, text extraction, text layer DOM, selection and `TextRange` logic, virtualisation scheduler, event emitter. No React, no JSX, no global state.                                          |
| `@readlet/react`      | `@readlet/core`, `react` as a peer | Hooks and components that bind core to React: `<Viewer>`, `<Page>`, `useDocument`, `useSelection`, `useViewport`. Thin: no rendering logic of its own.                                                                                 |
| `@readlet/pdf`        | `pdfjs-dist`                       | The PDF backend behind a `DocumentBackend` interface. Split out so an EPUB backend can be added as `@readlet/epub` later and so consumers can tree-shake the one they do not use. Separate from day one so core never ships a backend. |
| `examples/vite-react` | both                               | A minimal runnable viewer used for manual testing and as the README demo. Private, never published.                                                                                                                                    |

Core concepts, all in `@readlet/core`:

- `DocumentBackend`: the interface every format implements. `load(source)`, `getPageCount()`, `getPage(index)`, `getOutline()`, `destroy()`.
- `ReadletDocument`: the loaded document. Owns the backend, caches page metadata (size, rotation), emits `load`, `progress`, `error`.
- `PageView`: one page on screen. Owns its canvas and text layer, exposes `render(scale, dpr)`, `release()`, and page-local geometry helpers. Rendering is cancellable; a stale render never paints over a newer one.
- `Viewport`: knows the scroll container, computes which pages are visible plus a configurable buffer, and drives `PageView.render` and `release`. This is the virtualisation scheduler.
- `TextLayer`: builds the positioned, transparent text spans for one page from the backend's text content, in the same approach pdf.js uses, and maps between DOM nodes and character offsets.
- `SelectionManager`: listens to `selectionchange` on the document, resolves the DOM selection to a `TextRange` across pages, and exposes `getRange()`, `setRange(range)`, `rangeToRects(range)` and a `change` event.

Rules for agents working in this repo:

- Nothing in core may import from `react`, `react-dom`. Within core, DOM-free and DOM-touching code are separated: pure logic in `core/src/model`, DOM-touching code in `core/src/dom`. Model code must be unit-testable in Node without jsdom.
- pdf.js is an implementation detail. No `pdfjs-dist` type leaks into the public API of core or react. Wrap and re-export.
- The pdf.js worker is bundled and configured by Readlet. The consumer never sets `GlobalWorkerOptions.workerSrc`. Provide an escape hatch prop for custom worker URLs.
- Every public type is exported from the package root and documented with TSDoc.

## Text layer and selection

This is the hardest part and the reason the library exists, so it gets the most explicit requirements.

Text layer:

- For each page, extract text content from the backend as a list of items with glyph string, transform matrix, width and font. Build one absolutely positioned `<span>` per item inside a page-sized container with `color: transparent`, scaled with `transform: scale()` so spans match glyph widths exactly, the same technique pdf.js uses.
- Concatenate the items into a single normalised page string in reading order. Insert a space or newline between items only when the geometry implies one (large horizontal gap or a new line). Record, per item, its start offset into the page string. This string is the only thing `TextRange` offsets refer to.
- The text layer is rebuilt on zoom, but offsets do not change, because the page string is derived from content, not layout.
- Right-to-left and vertical scripts: do not break them. Preserve the backend's item order and direction flags; selection across them may be imperfect in v0.1 but must never throw.

`TextRange` and `SelectionManager`:

- `TextRange = { start: TextPosition, end: TextPosition }`, `TextPosition = { page: number, offset: number }`, page is zero-based, offset is a character index into that page's normalised string, end is exclusive. A range may span pages.
- `selectionToRange(sel: Selection): TextRange | null` walks the anchor and focus nodes up to their span, reads the span's item start offset, adds the in-node offset, and normalises so start precedes end.
- `rangeToRects(range): PageRect[]` returns rectangles in page coordinates (not screen pixels) per page the range touches, one rect per line fragment. The React layer converts page coordinates to CSS using the current scale. This is what a host app uses to draw highlights and remote users' selections.
- `setRange(range)` programmatically applies a DOM selection. If a page in the range is not currently rendered, the manager must still succeed for the rendered portion and not throw.
- `rangeToText(range): string` returns the selected text, which is what the clipboard copy also produces. Copy across pages joins with a newline.
- `change` event fires on every user selection change with the new `TextRange` or `null`, debounced within one animation frame.
- Selection must survive zoom and resize: the DOM selection is recaptured as a `TextRange` before re-render and restored after.

Acceptance tests that must pass before v0.1 ships, using Playwright on the example app with a fixed set of fixture PDFs (single column, two column, scanned-with-OCR-layer, 500 pages, rotated pages, a PDF with ligatures and one with CJK text):

- Drag-select a sentence; `rangeToText` equals what the browser copies to clipboard.
- Drag from the bottom of page 3 to the top of page 4 in scroll mode; the range has `start.page = 2`, `end.page = 3`.
- Zoom from 100% to 200% with a selection active; the range is identical before and after.
- Serialise a range to JSON, reload the page, `setRange` the parsed JSON; `rangeToRects` returns the same rectangles in page coordinates.
- Double click a word; the range covers exactly that word.

## Public API sketch

The shape below is the target, not a contract. Agents may refine names but must keep the three tiers: a one-liner, composable parts, and the headless core.

Tier 1, the one-liner most consumers want:

```tsx
import { Viewer } from "@readlet/react";

<Viewer
  src="/paper.pdf"
  mode="scroll" // 'scroll' | 'page'
  zoom="fit-width" // 'fit-width' | 'fit-page' | number
  onSelectionChange={(range) => setShared(range)}
  highlights={remoteSelections} // TextRange[] with optional color
/>;
```

Tier 2, composable parts for custom layouts and chrome:

```tsx
const doc = useDocument(src); // { status, document, error, progress }
const viewport = useViewport(containerRef, doc.document, { mode, zoom });
const selection = useSelection(viewport); // { range, text, rects, setRange }

<div ref={containerRef}>
  {viewport.visiblePages.map((p) => (
    <Page key={p.index} page={p} viewport={viewport}>
      <HighlightLayer ranges={remoteSelections} />
    </Page>
  ))}
</div>;
```

Tier 3, the headless core, usable from any framework or vanilla JS:

```ts
import {
  loadDocument,
  createViewport,
  createSelectionManager,
} from "@readlet/core";

const doc = await loadDocument("/paper.pdf", { onProgress });
const viewport = createViewport(doc, {
  container,
  mode: "scroll",
  zoom: "fit-width",
});
const selection = createSelectionManager(viewport);
selection.on("change", (range) => {
  /* ... */
});
viewport.goToPage(4);
viewport.destroy();
```

Core types exported from `@readlet/core`: `DocumentSource`, `ReadletDocument`, `PageInfo`, `Viewport`, `ViewMode`, `ZoomMode`, `TextRange`, `TextPosition`, `PageRect`, `Highlight`, `OutlineItem`, `ReadletError`. Errors are typed (`ReadletError` with a `code` union: `invalid-pdf`, `password-required`, `network`, `render-cancelled`, `worker-failed`) so hosts can branch without string matching.

## Engineering requirements

Tooling:

- TypeScript everywhere, `strict: true`, `noUncheckedIndexedAccess: true`, no `any` in public types. Build with tsup to ESM and CJS with `.d.ts`. `sideEffects: false` so bundlers can tree-shake.
- pnpm workspaces, Changesets for versioning, Biome for lint and format, Vitest for unit tests, Playwright for browser tests, Storybook or the Vite example app for manual checks.
- Node 20+, pnpm 9+. CI on GitHub Actions: typecheck, lint, unit, browser tests on Chromium, Firefox and WebKit, and a bundle size check.
- Peer dependency on React 18 and 19. The only runtime dependency of core is `pdfjs-dist`, pinned to a minor and upgraded deliberately.

Quality bar:

- `@readlet/core` gzipped under 60 KB excluding pdf.js. `@readlet/react` gzipped under 10 KB.
- Unit test coverage on `core/src/model` at 90% or above. Browser tests cover every acceptance case in the selection section.
- No memory leaks: destroying a viewer releases every canvas, worker message port and listener. A Playwright test loads and destroys a 500 page document 10 times and asserts heap returns to baseline within 20%.
- Every exported function and type has TSDoc with at least one example. README has a 30 second quickstart that works when copied verbatim into a fresh Vite React app.
- Accessible by default: pages have `role="region"` and `aria-label="Page N of M"`, the viewer is keyboard navigable, text layer is readable by screen readers.
- Errors surface as typed `ReadletError`s through events and React state, never as uncaught promises or console noise.

Working conventions for agents:

- Open a short design note in `docs/decisions/` before any change to a public type or a new package. One paragraph: the problem, the options, the choice.
- Small PRs, one concern each. A PR that touches core and react together should be the exception.
- Never commit a workaround for a pdf.js bug without a comment linking the upstream issue.
- Fixture PDFs live in `fixtures/` and must be freely licensed. Do not add copyrighted documents.
- Commit messages follow Conventional Commits so Changesets can derive release notes.

## Roadmap after v0.1

Each version is gated on the previous one being stable in at least one real production app.

| Version | Theme                 | Headline items                                                                                                                                                                                                                                            |
| ------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.2     | Finding things        | Full text search with hit ranges as `TextRange[]`, next/previous hit, thumbnails sidebar primitive, password-protected PDFs                                                                                                                               |
| 0.3     | Second format         | `@readlet/epub` backend implementing `DocumentBackend`. EPUB is reflowable, so `PageInfo` gains a `reflowable` flag and the viewport learns to paginate HTML. `TextRange` offsets map to CFI-like locators so ranges stay stable across font size changes |
| 0.4     | Beyond React          | `@readlet/vue` and a Web Component wrapper, both generated from the same core, proving the adapter boundary                                                                                                                                               |
| 0.5     | Annotation primitives | Read existing PDF annotations (highlights, notes) as data, still no authoring. Headless `AnnotationLayer` that renders host-supplied annotations                                                                                                          |
| 1.0     | Stability             | Public API frozen, semver guarantees, documented upgrade path from react-pdf and pdf.js viewer                                                                                                                                                            |

Decisions already made (record each as the first entry in \`docs/decisions/\`):

- `@readlet/pdf` is a separate package from day one. Core defines `DocumentBackend` and ships no backend; `@readlet/react` depends on core and takes a backend. The small amount of extra ceremony now is cheaper than a breaking change at 0.3.
- Canvas only. No SVG render path; pdf.js's SVG back end is deprecated. Cap the effective device pixel ratio at 3 to bound memory at high zoom.
- `TextRange` offsets depend on Readlet's own normalisation algorithm, not on pdf.js's raw output. The algorithm lives in `core/src/model/text-normalise.ts`, is covered by snapshot tests on every fixture PDF, and any change to it is a breaking change under semver.
- License is MIT. pdf.js is Apache 2.0, which permits redistribution of the bundled worker; include the Apache notice in `NOTICE` at the repo root and in each published package.
