# @readletjs/react

React components and hooks for [Readlet](https://github.com/jaklimoff/readlet): a PDF viewer with
real text selection that comes out as stable, serialisable `TextRange`s.

```sh
npm install @readletjs/react @readletjs/core @readletjs/pdf
```

```tsx
import { Viewer } from "@readletjs/react";
import { createPdfBackend } from "@readletjs/pdf";

const pdf = createPdfBackend();

export function App() {
  return (
    <div style={{ height: "100vh" }}>
      <Viewer src="/paper.pdf" backend={pdf} onSelectionChange={(range) => console.log(range)} />
    </div>
  );
}
```

Composable parts: `useDocument`, `useViewport`, `useSelection`, `<Page>`, `<HighlightLayer>`.

Documentation, examples and the other packages: https://github.com/jaklimoff/readlet

MIT licence. See `NOTICE` for the licence of pdf.js.
