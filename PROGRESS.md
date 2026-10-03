# Readlet — progress

This file tracks the work for v0.1. Read `PROJECT_BRIEF.md` for the scope and
`docs/decisions/` for the decisions.

Legend: `[x]` done · `[~]` in progress · `[ ]` to do

Current target: **v0.1 working in desktop Chrome (Chromium).** Firefox, Safari and mobile come
after the Chrome milestone.

**Status 2026-10-03:** desktop Chromium, Firefox and WebKit work. All five selection acceptance
tests from the brief pass in all three desktop browsers and in Pixel 7 / iPhone 15 emulation
(170 browser test runs: 164 pass, 6 skipped; the heap tests run only in Chromium), plus 59 unit tests.
CI is green on GitHub.

| Check                                     | Result                                  |
| ----------------------------------------- | --------------------------------------- |
| Unit tests / coverage on `core/src/model` | 59 pass / 98.6% statements, 100% lines  |
| Playwright, 5 projects (3 desktop, 2 mobile) | 164 pass, 6 skipped (CDP heap tests)  |
| Open page 500 of 1,000 from a range server | 96 KB, range requests only (17% of a small 580 KB file) |
| Heap, 1,000 pages after a full scroll     | about 17–23 MB (budget 200 MB)          |
| Load/destroy 500 pages × 10               | +13% over baseline (budget 20%), flat   |
| Scroll p95 frame, 1,000 pages             | under 50 ms (asserted)                  |
| Bundle gz: core / react / pdf             | 17.9 / 3.2 / 5.4 KB (budget 60 / 10 KB) |

Speed (`pnpm bench`, Chromium on an Apple M-class laptop; files from
`scripts/make-bench-fixtures.mjs`, 24 pages each; "mobile" = CPU ×4 and Fast 4G: 9 Mbit/s,
150 ms round trip). Times are from `open(src)` to the first canvas, and from `goToPage` to a page
with canvas and text layer (median of 7 jumps).

| File (size)                              | Desktop: first page / jump | Mobile, ranges: first page / jump | Mobile, whole file: first page / jump |
| ---------------------------------------- | -------------------------- | --------------------------------- | ------------------------------------- |
| images: 150 dpi JPEG per page (9.3 MB)   | 87 / 83 ms                 | 1.3 s / 1.3 s                     | 8.9 s / 0.09 s                        |
| vector: ~6,000 curves per page (2.6 MB)  | 83 / 130 ms                | 0.9 s / 0.9 s                     | 3.1 s / 0.5 s                         |
| text: ~7,000 glyphs per page (0.2 MB)    | 92 / 93 ms                 | 0.8 s / 0.35 s                    | 0.8 s / 0.35 s                        |

Ranges show the first page of a large file 3–7× sooner on a phone network; each jump to a far
page then costs a few round trips. Normal scrolling hides this, because the render buffer loads
the next pages early. Use `prefetch: true` when users jump around a lot in files of a few MB.

## Known issues and open points

- With the pointer in the viewer margin left or right of a page (outside the page box) on the
  anchor line, the selection extends to the start of that page, not of the line. Same in all three
  browsers; small.
- Firefox snaps a drag end at a character edge a fraction of a pixel differently from its caret
  hit test. Tests use points close to the edge; users do not notice.
- Real-device touch selection (long-press, handles) is not tested; only emulation.
- The text layer measures the ascent of the browser fallback font (like pdf.js), but
  `rangeToRects` uses the ascent of the PDF font. Highlights and the native selection colour can
  differ by 1–2 px vertically. This is intentional (highlights match the visible glyphs).
- Chrome's "minimum font size" setting can enlarge very small invisible text. pdf.js has a
  workaround; Readlet does not yet. The setting could not be reproduced in Playwright's Chromium
  (the profile preference has no effect), so no change was made without a test.
- On the slow-CPU profile, the vector file gives main-thread tasks of up to ~160 ms (×4, so
  ~40 ms at full speed). pdf.js draws on the main thread; it yields every 15 ms, but one drawing
  operation can take longer. Not Readlet code; rendering in a worker (OffscreenCanvas) could fix
  it later.
- The benchmark files are generated, not real-world PDFs.
- No React unit tests yet; React is covered by the browser tests through the example app.
- Vertical (`ttb`) text has no fixture yet.

## M0 — Repository setup

- [x] git, pnpm workspace, TypeScript 6 (strict, `noUncheckedIndexedAccess`), Biome
- [x] Package skeletons: `@readletjs/core`, `@readletjs/pdf`, `@readletjs/react`, `examples/vite-react`
- [x] Decision notes 0001–0004
- [x] LICENSE (MIT) and NOTICE (pdf.js Apache 2.0) at root and in each package
- [x] Changesets config
- [x] GitHub Actions CI (typecheck, lint, unit, build, size, e2e on all five projects). Green on
      GitHub: https://github.com/jaklimoff/readlet/actions

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

## M2 — PDF backend (`@readletjs/pdf`)

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

## M4 — React adapter (`@readletjs/react`)

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
- [x] Load from URL / ArrayBuffer / Blob / File; progress and error events
- [x] Virtualisation: 1,000 pages, heap < 200 MB
- [x] Load/destroy 500 pages × 10: heap back to baseline ± 20%
- [x] Rotation, zoom modes, outline, links, page mode navigation

## M7 — Release readiness

- [x] npm organisation `readletjs` (the `readlet` organisation belongs to another account;
      decision 0007); packages renamed to `@readletjs/*`
- [x] Release workflow: Changesets version PR, `scripts/release.mjs`, Trusted Publishing,
      `RELEASING.md`; package READMEs; clean published `exports`
- [x] First publish: 0.1.0 of all three packages on npm (2026-10-03). Checked from npm in a fresh
      Vite 8 + React 19 app: README quickstart as is, dev and production build, selection works,
      no console messages
- [x] Trusted Publishing for the three packages (`jaklimoff/readlet`, `release.yml`, permission
      "npm publish"; no dist-tag permission). Proven by 0.1.1: CI published all three packages with
      signed provenance, with no token.
- [x] API review before the first publish (decision 0008): internals removed from the exports
      and stripped from the published types; `aborted` error code; `textload` event; core is a
      peer of the React package; React re-exports its types; consumer type check on the built
      `.d.ts` in CI
- [x] React 18: CI job `react18` runs typecheck and the Chromium tests with React 18.3

- [x] Partial loading (decision 0006): HTTP Range requests without background prefetch by
      default, lazy page sizes, `initialPage` loads first; tested with an S3-like range server

- [x] TSDoc with an example on every export (`pnpm tsdoc` checks it in CI)
- [~] README with a 30-second quickstart. Verified: packed tarballs in a fresh Vite 8 React app,
      zero config, dev (with dependency pre-bundling) and production build both render.
- [x] Bundle size check: core < 60 KB gz (without pdf.js), react < 10 KB gz
- [x] Firefox and WebKit pass (desktop, Playwright Firefox 155 / WebKit 26.6)
- [~] Mobile: Pixel 7 and iPhone 15 emulation pass every test, including native selection changes
      as touch handles make them. A real long-press on a real device is not tested (Playwright
      cannot emulate the OS selection UI).

## Log

- 2026-10-03 — 0.1.1 (npm keywords) released from CI with Trusted Publishing and provenance.
  Found and fixed: a release run while npm still processes a version got E409; the script now
  skips such versions. GitHub actions updated to versions that run on Node 24.

- 2026-10-03 — Released 0.1.0. The first `npm publish` failed (E403: the npm account had no 2FA);
  after 2FA was turned on it worked. npm processes new packages for about 3 minutes before they
  can be installed (a `0.0.0-stage` placeholder shows meanwhile).

- 2026-10-03 — API review (decision 0008) and React 18 job. All desktop tests pass with React
  18.3.1. `goToPage({ top })` at 90°/270° is correct as it is (documented). Vertical text is
  listed as not tested in the README. One "initial release" changeset for 0.1.0.

- 2026-10-03 — Created the npm organisation `readletjs` and renamed the packages (decision 0007).
  Release workflow with Changesets and npm Trusted Publishing; dry-run release in CI. The pdf
  package no longer ships the worker source maps (1.6 MB → 0.8 MB packed).

- 2026-10-03 — Speed benchmark (`pnpm bench`, CI job `bench` with a JSON artifact): generated
  image, vector and text PDFs; desktop and slow-phone profiles (CPU and network emulation);
  whole-file against range loading. The range test server no longer slows full responses down
  (that was only needed while pdf.js started with a full request).

- 2026-10-03 — Range loader: Readlet requests the first chunk itself and feeds pdf.js through a
  `PDFDataRangeTransport`, so no request for the whole file starts (pdf.js began with one and
  cancelled it late on busy machines). Failed ranges are retried, then waiting operations reject
  with `network` and the next operation retries (text and link layers too). Tests: transient
  failure, permanent failure, recovery after an outage,
  CORS that hides `Content-Range`.

- 2026-10-03 — Partial loading (decision 0006). URL sources now fetch only the ranges that shown
  pages need (pdf.js streamed and pre-fetched the whole file before). Page sizes are lazy:
  `loadDocument` loads only `initialPage`; other pages are estimated and replaced as they load,
  with a relayout that keeps the reading position. Fixed on the way: the zoom/relayout anchor
  scaled the gap above a page with the page height. New `scripts/range-server.mjs` (Range + CORS
  like S3, byte counts) for the tests.

- 2026-10-03 — Published the public repo https://github.com/jaklimoff/readlet (history checked for
  secrets and local paths first). First CI runs found three Linux-only problems, all fixed: Vitest
  did not use the `readlet-source` condition in its SSR environment (it needed a build first); the
  zoom test dragged outside a phone screen; and Firefox with the runner fonts snapped a drag end just
  inside a narrow "." to before it (end points now aim into the next character). CI retries once
  and reports flaky tests.

- 2026-10-03 — TSDoc audit with a CI check; progress event test (in-memory sources now report
  exactly one complete event); resize test; axe accessibility test (no violations); pdf.js logs
  errors only; no build paths in the dist files.
- 2026-10-03 — Added mobile emulation projects. The example app is now responsive (the viewer had
  zero width on a phone). Added a test for native selection changes (touch handles).
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
