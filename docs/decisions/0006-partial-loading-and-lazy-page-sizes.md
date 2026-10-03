# 0006 — Partial loading and lazy page sizes

Status: accepted · 2026-10-03

## Context

A user wants to open one page of a large PDF on S3 without downloading the whole file. pdf.js can
do this with HTTP Range requests. Two things in Readlet stopped it:

1. `createPdfBackend` used the pdf.js defaults. pdf.js then streams the whole file and keeps
   fetching in the background ("auto fetch") after the first page shows.
2. `loadDocument` read the size of every page before it resolved (one `getPage` per page). For a
   range-loaded file this touches every page object before the first paint.

pdf.js uses ranges only when the response has `Accept-Ranges: bytes`, a `Content-Length` larger
than two chunks, and no `Content-Encoding`. For a cross-origin URL, `Accept-Ranges` and
`Content-Range` must be in `Access-Control-Expose-Headers`, and `Range` in
`Access-Control-Allow-Headers`.

## Decision

### PDF backend: on-demand range loading by default

New `PdfBackendOptions`:

| Option           | Default  | pdf.js                                    |
| ---------------- | -------- | ----------------------------------------- |
| `rangeRequests`  | `true`   | `disableRange: !rangeRequests`            |
| `prefetch`       | `false`  | `disableStream` and `disableAutoFetch` = `!prefetch` |
| `rangeChunkSize` | `65536`  | `rangeChunkSize`                          |

The default fetches only the bytes that shown pages need. `prefetch: true` gives the pdf.js viewer
behaviour (the rest of the file loads in the background), which is better for small files on a
slow-latency link. When the server does not support ranges, pdf.js downloads the whole file, as
before. These options affect URL sources only.

### Core: lazy page sizes

- `PageInfo` gets `readonly estimated: boolean`. `true` means the size is a guess: the page has
  not loaded yet.
- `LoadDocumentOptions` gets `pageSizes?: "lazy" | "eager"` (default `"lazy"`) and
  `initialPage?: number` (default `0`).
  - `"lazy"`: `loadDocument` loads only `initialPage`. Every other page starts with the size and
    intrinsic rotation of that page, `estimated: true`.
  - `"eager"`: the old behaviour; every size is real when the promise resolves.
- `ReadletDocument.getPage(i)` records the real size of page `i` before it resolves. When the size
  or rotation is different from the estimate, or the page was estimated, the document emits a new
  event, `pageinfo`, with the new `PageInfo`. `doc.pages` and `doc.getPageInfo` always return the
  latest values (new objects; old `PageInfo` objects are not mutated).
- The `Viewport` listens to `pageinfo`. It collects changes in a microtask and runs one relayout
  that keeps the page at the top of the viewport in place (the same anchor as zoom), so a page
  that loads above or below the reading position does not move the visible text. The selection is
  captured and restored around the relayout as for any layout change.
- `<Viewer initialPage>` and `useDocument(src, { initialPage, pageSizes })` pass the options to
  `loadDocument`.

### Why lazy is the default for every source

For in-memory sources the old way cost one worker round trip per page at load (fast, but it grows
with the page count). Most documents have one page size, so the estimate is right and nothing
moves. Documents with mixed sizes get a relayout when a page with another size first comes near
the visible area; the anchor keeps the reading position stable. Apps that need exact sizes up
front (for example a custom thumbnail strip) use `pageSizes: "eager"`.

## Consequences

- `PageInfo` has one more field. Code that reads `PageInfo` is not affected; code that creates
  `PageInfo` objects (only Readlet itself) must set it.
- The total height of the scroll content can change while the user scrolls a mixed-size document.
  The scrollbar thumb can then move a little.
- `goToPage(i)` to a far page uses estimated sizes for the pages above it; this is exact for
  uniform documents. When page `i` loads with another size, the anchor keeps it at the top.
- Tests: a range server with S3-like CORS headers (`scripts/range-server.mjs`) serves the
  fixtures to the browser tests and counts the bytes sent per request.
