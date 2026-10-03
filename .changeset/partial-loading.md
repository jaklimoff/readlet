---
"@readlet/core": minor
"@readlet/pdf": minor
"@readlet/react": minor
---

Load only what the shown pages need. URL sources use HTTP Range requests without background
prefetch (new `rangeRequests`, `prefetch` and `rangeChunkSize` options on `createPdfBackend`).
Page sizes are lazy by default: `PageInfo.estimated`, the `pageinfo` document event,
`ReadletDocument.loadPageInfo`, and the `pageSizes` and `initialPage` options of `loadDocument`
and `useDocument`. `<Viewer initialPage>` now loads that page first.
