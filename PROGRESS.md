# Readlet — progress

This file tracks the work for v0.1. Read `PROJECT_BRIEF.md` for the scope and
`docs/decisions/` for the decisions.

Legend: `[x]` done · `[~]` in progress · `[ ]` to do

Current target: **v0.1 working in desktop Chrome (Chromium).** Firefox, Safari and mobile come
after the Chrome milestone.

**Status 2026-10-03:** desktop Chromium, Firefox and WebKit work. All five selection acceptance
tests from the brief pass in all three browsers (65 browser test runs, 4 heap tests are
Chromium-only), plus 52 unit tests.

| Check                                     | Result                                  |
| ----------------------------------------- | --------------------------------------- |
| Unit tests / coverage on `core/src/model` | 52 pass / 98.6% statements, 100% lines  |
| Playwright (Chromium, Firefox, WebKit)    | 65 pass, 4 skipped (CDP heap tests)     |
| Heap, 1,000 pages after a full scroll     | about 17–23 MB (budget 200 MB)          |
| Load/destroy 500 pages × 10               | +13% over baseline (budget 20%), flat   |
| Scroll p95 frame, 1,000 pages             | under 50 ms (asserted)                  |
| Bundle gz: core / react / pdf             | 17.3 / 3.1 / 3.6 KB (budget 60 / 10 KB) |

## Known issues and open points

- With the pointer in the viewer margin left or right of a page (outside the page box) on the
  anchor line, the selection extends to the start of that page, not of the line. Same in all three
  browsers; small.
- Firefox snaps a drag end at a character edge a fraction of a pixel differently from its caret
  hit test. Tests use points close to the edge; users do not notice.
- Mobile touch selection is not tested.
- The text layer measures the ascent of the browser fallback font (like pdf.js), but
  `rangeToRects` uses the ascent of the PDF font. Highlights and the native selection colour can
  differ by 1–2 px vertically. This is intentional (highlights match the visible glyphs).
- Chrome's "minimum font size" setting can enlarge very small invisible text. pdf.js has a
  workaround; Readlet does not yet.
- `goToPage(index, { top })` ignores `top` when the user rotation is 90° or 270°.
- All page sizes are read at load (one `getPage` per page). Fast enough for 1,000 pages; a lazy
  size scheme can come later if needed.
- The built worker chunk contains a comment with the absolute build path (esbuild namespace
  comment). Cosmetic; fix before publishing.
- No React unit tests yet; React is covered by the browser tests through the example app.
- Vertical (`ttb`) text has no fixture yet.

## M0 — Repository setup

- [x] git, pnpm workspace, TypeScript 6 (strict, `noUncheckedIndexedAccess`), Biome
- [x] Package skeletons: `@readlet/core`, `@readlet/pdf`, `@readlet/react`, `examples/vite-react`
- [x] Decision notes 0001–0004
- [x] LICENSE (MIT) and NOTICE (pdf.js Apache 2.0) at root and in each package
- [x] Changesets config
- [~] GitHub Actions CI (typecheck, lint, unit, build, size, e2e). Only Chromium in the e2e matrix
      for now. Not run on GitHub yet (no remote).

## M1 — Core model (pure, Node-testable, `core/src/model`)

- [x] Public types: `DocumentSource`, `PageInfo`, `TextRange`, `TextPosition`, `PageRect`,
      `Highlight`, `OutlineItem`, `ReadletError`, `ViewMode`, `ZoomMode`
- [x] `DocumentBackend` / `BackendDocument` / `BackendPage` interfaces
- [x] Typed event emitter
- [x] Text normalisation (`text-normalise.ts`): page string plus item offsets
- [x] Text item geometry (same maths as the pdf.js text layer)
- [x] `TextRange` helpers: normalise order, compare, clamp, JSON validation
- [x] `rangeToText`, `rangeToRects` (with an injected text measurer)
- [x] Layout maths: page offsets, visible range with buffer, fit-width / fit-page scale
- [x] Unit tests, coverage ≥ 90% on `core/src/model`

## M2 — PDF backend (`@readlet/pdf`)

- [x] Load from URL, `ArrayBuffer`, `Uint8Array`, `Blob`, `File`, with progress
- [x] Inline worker from Blob URL; `workerSrc` / `workerPort` escape hatches
- [x] Typed errors: `invalid-pdf`, `password-required`, `network`, `worker-failed`
- [x] Page render to canvas (cancellable), text content in page coordinates
- [x] Outline with resolved page indexes; link annotations (internal and external)

## M3 — Core DOM (`core/src/dom`)

- [x] `ReadletDocument` + `loadDocument`
- [x] `PageView`: canvas (DPR capped at 3, max canvas pixels), stale-render guard, release
- [x] `TextLayer`: spans + separators, DOM ↔ offset mapping, end-of-content trick
- [x] Link layer: internal navigation, external links in a new tab
- [x] `Viewport`: scroll and page modes, virtualisation, zoom, rotation, `goToPage`, events
- [x] `SelectionManager`: `getRange`, `setRange`, `rangeToRects`, `rangeToText`, `change`
      (rAF debounced), copy handler, capture/restore around layout changes
- [x] Keyboard navigation and aria labels

## M4 — React adapter (`@readlet/react`)

- [x] `useDocument`, `useViewport`, `useSelection`
- [x] `<Viewer>`, `<Page>`, `<HighlightLayer>`
- [x] StrictMode safe (double mount), no leaks on unmount (checked with heap snapshots)

## M5 — Example app (`examples/vite-react`)

- [x] Minimal unstyled viewer with mode, zoom, rotation, outline, page nav, selection readout
- [x] Test hooks on `window` for Playwright

## M6 — Browser tests (Playwright, Chromium first)

- [x] Fixture PDFs (freely licensed, generated by `scripts/make-fixtures.mjs`)
- [x] Drag-select a sentence: `rangeToText` equals clipboard
- [x] Drag across page 3 → 4: `start.page = 2`, `end.page = 3`
- [x] Zoom 100% → 200% with a selection: range unchanged
- [x] Serialise → reload → `setRange` → same rects
- [x] Double click a word: range covers exactly that word
- [~] Load from URL / ArrayBuffer / Blob / File and error events (done); progress event not asserted yet
- [x] Virtualisation: 1,000 pages, heap < 200 MB
- [x] Load/destroy 500 pages × 10: heap back to baseline ± 20%
- [x] Rotation, zoom modes, outline, links, page mode navigation

## M7 — Release readiness

- [~] TSDoc with an example on every export (most done; audit open)
- [~] README with a 30-second quickstart. Verified: packed tarballs in a fresh Vite 8 React app,
      zero config, dev (with dependency pre-bundling) and production build both render.
- [x] Bundle size check: core < 60 KB gz (without pdf.js), react < 10 KB gz
- [x] Firefox and WebKit pass (desktop, Playwright Firefox 155 / WebKit 26.6)
- [ ] Mobile (touch selection) checks

## Log

- 2026-10-03 — Added Firefox and WebKit. Two cross-page selection bugs found and fixed
  (decision 0005): Firefox ignores `scaleX` on spans when a drag continues on another page (spans
  now use letter-spacing), and absolutely positioned page slots made the selection jump to page 1
  when the pointer was in the gap (slots now use normal flow). Copy test reads the `copy` event,
  so it needs no clipboard permission.
- 2026-10-03 — Built M1–M6 for Chromium. Found and fixed: spans needed `z-index: 1` above the
  end-of-content element (drag selection collapsed); a running render restarted on every scroll
  frame; React portals added ~280 listeners per page (portals now only render when they have
  content); tsup treated the `?raw` worker import as external. The "leak" in the first heap test
  was Playwright `waitForSelector` element handles; tests now use `locator().waitFor()`.
- 2026-10-03 — Read the brief. Set up the repo. Recorded decisions 0001–0004 (see
  `0002-brief-clarifications.md` for the contradictions found in the brief and how they were
  resolved).
