# 0001 — Decisions made before v0.1

Status: accepted · 2026-10-03

These decisions come from the project brief. They are recorded here as the first entry.

1. **`@readlet/pdf` is a separate package from day one.** Core defines `DocumentBackend` and ships
   no backend. `@readlet/react` depends on core and takes a backend. The small amount of extra
   ceremony now is cheaper than a breaking change at 0.3 (EPUB).
2. **Canvas only.** No SVG render path (the pdf.js SVG back end is deprecated). The effective
   device pixel ratio is capped at 3 to bound memory at high zoom.
3. **`TextRange` offsets depend on Readlet's own normalisation algorithm**, not on the raw pdf.js
   output. The algorithm lives in `packages/core/src/model/text-normalise.ts`, is covered by
   snapshot tests on every fixture PDF, and any change to it is a breaking change under semver.
4. **License is MIT.** pdf.js is Apache 2.0, which permits redistribution of the bundled worker.
   The Apache notice is in `NOTICE` at the repo root and in each published package.
