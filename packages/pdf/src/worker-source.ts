// The pdf.js worker, inlined as a string so that consumers need no worker URL and no bundler
// config (decision 0004). This module is imported lazily, so its size is only paid when the first
// document is opened.
import source from "pdfjs-dist/build/pdf.worker.min.mjs?raw";

export default source;
