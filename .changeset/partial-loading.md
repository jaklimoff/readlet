---
"@readletjs/core": minor
"@readletjs/pdf": minor
"@readletjs/react": minor
---

Load only what the shown pages need. URL sources use HTTP Range requests without background
prefetch (new `rangeRequests`, `prefetch` and `rangeChunkSize` options on `createPdfBackend`).
Page sizes are lazy by default: `PageInfo.estimated`, the `pageinfo` document event,
`ReadletDocument.loadPageInfo`, and the `pageSizes` and `initialPage` options of `loadDocument`
and `useDocument`. `<Viewer initialPage>` now loads that page first.

For on-demand range loading, Readlet makes the Range requests itself, so no request for the whole
file starts. Failed ranges are retried, then reported as `network` errors instead of waiting
forever.
