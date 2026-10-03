# @readletjs/react

## 0.1.1

### Patch Changes

- 6043563: Add npm keywords so that the packages show up in npm search.
- Updated dependencies [6043563]
  - @readletjs/core@0.1.1

## 0.1.0

### Minor Changes

- 5bd92eb: First release of Readlet: a PDF viewer for the web with native text selection.
  
  - Load from a URL, `ArrayBuffer`, `Uint8Array`, `Blob` or `File`, with progress. URLs load with
    HTTP Range requests, so only the shown pages are downloaded (works with S3 and CDNs).
  - Canvas rendering in scroll and page modes, with virtualisation (1,000 pages in about 20 MB of
    heap), zoom (`fit-width`, `fit-page`, numbers) and rotation.
  - A selectable text layer: native selection, copy, double click, and selection across pages.
  - Selections as stable, serialisable `TextRange`s, with conversion to text and to rectangles in
    page coordinates for highlights and remote selections.
  - Outline, internal and external links, keyboard navigation and ARIA labels.
  - Typed errors (`ReadletError` with a `code`).
  - React: `<Viewer>`, `useDocument`, `useViewport`, `useSelection`, `<Page>` and
    `<HighlightLayer>`. React 18 and 19.

### Patch Changes

- Updated dependencies [5bd92eb]
  - @readletjs/core@0.1.0
