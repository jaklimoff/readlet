# 0002 — Clarifications of contradictions in the brief

Status: accepted · 2026-10-03

**Problem.** Some statements in the brief do not agree with each other.

1. *Core dependencies.* The architecture table says `@readlet/core` depends on `pdfjs-dist`, and
   the tooling section says "the only runtime dependency of core is `pdfjs-dist`". Decision 0001.1
   says core ships no backend. **Choice:** `@readlet/core` has **zero** runtime dependencies. Only
   `@readlet/pdf` depends on `pdfjs-dist`. The backend gives core plain, format-neutral data
   (page sizes, text items in page coordinates, links, outline), and core never imports pdf.js.
2. *Tier 1 one-liner has no backend.* `<Viewer src="/paper.pdf" />` cannot work if react does not
   depend on a backend. Options: (a) react depends on `@readlet/pdf` and uses it as a default;
   (b) a global backend registry; (c) an explicit `backend` prop. (a) breaks 0001.1 and
   tree-shaking, (b) is a hidden global (principle 4). **Choice: (c).** The quickstart stays under
   10 lines:

   ```tsx
   import { Viewer } from "@readlet/react";
   import { createPdfBackend } from "@readlet/pdf";
   const pdf = createPdfBackend();
   export const App = () => <Viewer src="/paper.pdf" backend={pdf} />;
   ```

   The same applies to Tier 3: `loadDocument(src, { backend })`.
3. *Backend shape.* The brief puts `load(source)` and `getPage()` on one interface. **Choice:**
   split it. `DocumentBackend` is a stateless factory with `load(source, options)`, which returns a
   `BackendDocument` (`pageCount`, `getPage`, `getOutline`, `destroy`). One backend object can then
   open many documents, and a loaded document has no "not loaded yet" state.
