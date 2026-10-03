# 0004 — Loading the pdf.js worker and assets without consumer config

Status: accepted · 2026-10-03

**Problem.** The consumer must never set `GlobalWorkerOptions.workerSrc` and must not need build
config. pdf.js also needs CMaps (CJK), standard font data and wasm decoders at runtime.

**Options.** (a) Ship the worker as a file and use `new URL("./worker.mjs", import.meta.url)`.
This breaks when Vite pre-bundles the dependency and in some bundlers. (b) Inline the worker
source as a string in a lazily imported chunk and start it from a `Blob` URL. This works in every
bundler and without a bundler. The cost is about 1.3 MB of JS that loads only when the first
document opens. The pdf.js size is outside the size budget.

**Choice: (b)**, with escape hatches: `createPdfBackend({ workerSrc })` (URL of a worker file) and
`createPdfBackend({ workerPort })` (an existing `Worker`). Strict CSP sites that block `blob:`
workers use `workerSrc`. Each backend owns its own worker (no `GlobalWorkerOptions` mutation, no
hidden globals). For CMaps, standard fonts and wasm, the default is the jsDelivr CDN pinned to the
exact `pdfjs-dist` version; `createPdfBackend({ assetsUrl })` points at a self-hosted copy.
