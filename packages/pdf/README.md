# @readletjs/pdf

The PDF backend of [Readlet](https://github.com/jaklimoff/readlet), built on pdf.js. The pdf.js
worker is bundled and starts by itself: no worker path and no bundler configuration. URL sources
load with HTTP Range requests, so a viewer that opens page 500 of a large file on S3 downloads
only what that page needs.

```sh
npm install @readletjs/pdf @readletjs/core
```

```ts
import { loadDocument } from "@readletjs/core";
import { createPdfBackend } from "@readletjs/pdf";

const pdf = createPdfBackend(); // create once, share between documents
const doc = await loadDocument("https://bucket.s3.amazonaws.com/book.pdf", { backend: pdf });
```

Documentation, examples and the other packages: https://github.com/jaklimoff/readlet

MIT licence. See `NOTICE` for the licence of pdf.js.
