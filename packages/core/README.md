# @readletjs/core

The framework-free core of [Readlet](https://github.com/jaklimoff/readlet): document model, a
virtualised viewport (scroll and page modes, zoom, rotation), a selectable text layer, and
selections as stable, serialisable `TextRange`s. No runtime dependencies. Use it with a format
backend such as [`@readletjs/pdf`](https://www.npmjs.com/package/@readletjs/pdf).

```sh
npm install @readletjs/core @readletjs/pdf
```

```ts
import { createSelectionManager, createViewport, loadDocument } from "@readletjs/core";
import { createPdfBackend } from "@readletjs/pdf";

const doc = await loadDocument("/paper.pdf", { backend: createPdfBackend() });
const viewport = createViewport(doc, { container, zoom: "fit-width" });
const selection = createSelectionManager(viewport);
selection.on("change", (range) => console.log(range && selection.rangeToText(range)));
```

Documentation, examples and the other packages: https://github.com/jaklimoff/readlet

MIT licence. See `NOTICE` for the licence of pdf.js.
