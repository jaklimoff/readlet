# Readlet

Open source (MIT) TypeScript library to show documents in the browser. It starts with PDF.
Pages render on canvas. A selectable text layer sits on top, and the selection comes out as
stable, serialisable `TextRange`s that your app can store, sync or annotate.

> Status: **0.1.0** on npm (`@readletjs/core`, `@readletjs/pdf`, `@readletjs/react`). The API
> can still change before 1.0. Tested in Chromium, Firefox and WebKit (Safari) on desktop, and
> in Android and iPhone emulation. See [PROGRESS.md](PROGRESS.md).

## Quickstart (React)

```sh
npm install @readletjs/react @readletjs/core @readletjs/pdf
```

```tsx
import { Viewer } from "@readletjs/react";
import { createPdfBackend } from "@readletjs/pdf";

const pdf = createPdfBackend();

export default function App() {
  return (
    <div style={{ height: "100vh" }}>
      <Viewer src="/paper.pdf" backend={pdf} onSelectionChange={(range) => console.log(range)} />
    </div>
  );
}
```

No worker path, no bundler config. The pdf.js worker is bundled and starts by itself.

## Three tiers

1. **One component:** `<Viewer src backend mode zoom rotation highlights onSelectionChange />`.
2. **Composable parts:** `useDocument`, `useViewport`, `useSelection`, `<Page>`,
   `<HighlightLayer>`.
3. **Headless core**, for any framework or plain JS:

```ts
import { createSelectionManager, createViewport, loadDocument } from "@readletjs/core";
import { createPdfBackend } from "@readletjs/pdf";

const doc = await loadDocument("/paper.pdf", { backend: createPdfBackend() });
const viewport = createViewport(doc, { container, mode: "scroll", zoom: "fit-width" });
const selection = createSelectionManager(viewport);
selection.on("change", (range) => console.log(range && selection.rangeToText(range)));
viewport.goToPage(4);
```

## Text ranges

```ts
type TextRange = { start: { page: number; offset: number }; end: { page: number; offset: number } };
```

`page` starts at 0. `offset` is a character index into the normalised text of the page, and `end`
is exclusive. Ranges stay the same across zoom, resize, rotation and re-render.

- `selection.getRange()` / `selection.setRange(range)`: DOM selection to range, and back.
- `selection.rangeToText(range)`: the text. Copy (Ctrl/Cmd+C) puts the same text on the clipboard.
- `selection.rangeToRects(range)`: rectangles in page coordinates (points, top-left origin), to
  draw highlights or remote users' selections.

When you store ranges, store `NORMALISATION_VERSION` (from `@readletjs/core`) next to them. The
offsets depend on how Readlet builds the page text; a change to that algorithm increases the
version and is a breaking change. `normalisePageText` builds the same page text on a server.

## Large files and S3: load only the pages you show

For a URL source, Readlet downloads only the bytes that the shown pages need. It uses HTTP Range
requests, and it reads a page size only when the page loads. Opening page 500 of a 1,000-page
file needs a few small requests, not the whole file:

```tsx
<Viewer src={presignedUrl} backend={pdf} initialPage={499} />
```

The server must support Range requests. S3, CloudFront, GCS and most static servers do. For a
bucket on another origin, set CORS rules like this:

```json
[
  {
    "AllowedOrigins": ["https://your.app"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"],
    "ExposeHeaders": ["Accept-Ranges", "Content-Range", "Content-Length"]
  }
]
```

- Do not store the object with `Content-Encoding: gzip`. pdf.js cannot use ranges then.
- Linearized PDFs ("Fast Web View") show the first page with the fewest requests.
- If the server does not support ranges, the whole file downloads, and everything still works.
- A failed range request is retried two times. If it still fails, the page shows nothing and the
  document emits an `error` event with code `network`; the next render tries again.
- `createPdfBackend({ prefetch: true })` also downloads the rest of the file in the background,
  as the pdf.js viewer does. `rangeRequests: false` turns range requests off.
- Use `loadDocument(src, { pageSizes: "eager" })` if you need every page size before the first
  render. By default, pages that have not loaded yet use the size of the first loaded page, and
  the viewer keeps your reading position when a real size arrives. See
  [decision 0006](docs/decisions/0006-partial-loading-and-lazy-page-sizes.md).

## Not yet supported

- Vertical (top-to-bottom) writing, as in some Japanese books: the code handles it, but no test
  covers it yet.
- Password-protected PDFs (planned for 0.2; loading one gives the error code
  `password-required`).
- Annotation editing, forms and signatures (out of scope).

## Packages

| Package          | What it does                                                         |
| ---------------- | -------------------------------------------------------------------- |
| `@readletjs/core`  | Rendering, text layer, selection, virtualisation. Zero dependencies. |
| `@readletjs/pdf`   | The PDF backend (pdf.js).                                            |
| `@readletjs/react` | React hooks and components.                                          |

## Develop

```sh
pnpm install
pnpm dev          # example app at http://localhost:5173 (fixtures from ./fixtures)
pnpm test         # unit tests
pnpm test:e2e     # Playwright browser tests
pnpm bench        # speed benchmark on heavy generated PDFs (Chromium; desktop and slow phone)
pnpm build && pnpm size
```

Design decisions are in [`docs/decisions/`](docs/decisions/).

## License

MIT. Readlet bundles pdf.js (Apache 2.0); see [NOTICE](NOTICE).
