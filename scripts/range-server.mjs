#!/usr/bin/env node
// A small static server for the fixtures that behaves like S3 for pdf.js: it answers HTTP Range
// requests, sends `Accept-Ranges: bytes`, and sends the CORS headers that a cross-origin viewer
// needs. It counts the bytes that it sends, so the browser tests can check partial loading.
//
//   node scripts/range-server.mjs [port]      (default 5174)
//
// GET /<file>?t=<token>   serves fixtures/<file>; statistics are kept per token
// GET /__stats?t=<token>  returns { requests, bytes, ranges, uniqueBytes, rangeBytes, log } for that token;
//                         uniqueBytes counts each distinct range once (React StrictMode loads a
//                         document twice in development); rangeBytes is the same without
//                         the first, cancelled full request
//
// A response without a Range header is sent in 16 KB pieces with a short pause between them,
// like a network. pdf.js reads the headers of that first response and then cancels it when the
// server supports ranges; without the pause, a local server would send the whole file before
// the cancel arrives, which no real network does.

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const port = Number(process.argv[2] ?? 5174);
const stats = new Map();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD",
  "Access-Control-Allow-Headers": "Range",
  "Access-Control-Expose-Headers": "Accept-Ranges, Content-Range, Content-Length",
};

function statsFor(token) {
  let s = stats.get(token);
  if (!s) {
    s = { requests: 0, bytes: 0, ranges: 0, log: [] };
    stats.set(token, s);
  }
  return s;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const token = url.searchParams.get("t") ?? "";
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }
  if (url.pathname === "/__stats") {
    res.writeHead(200, {
      ...CORS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    const s = statsFor(token);
    const unique = new Map();
    for (const e of s.log) unique.set(e.range, Math.max(unique.get(e.range) ?? 0, e.sent));
    let uniqueBytes = 0;
    let rangeBytes = 0;
    for (const [range, sent] of unique) {
      uniqueBytes += sent;
      if (range !== "full") rangeBytes += sent;
    }
    res.end(JSON.stringify({ ...s, uniqueBytes, rangeBytes }));
    return;
  }
  const path = normalize(join(root, decodeURIComponent(url.pathname)));
  let size;
  try {
    if (!path.startsWith(root)) throw new Error("outside");
    size = statSync(path).size;
  } catch {
    res.writeHead(404, CORS).end();
    return;
  }
  const s = statsFor(token);
  s.requests++;
  const entry = { range: req.headers.range ?? "full", sent: 0 };
  s.log.push(entry);
  const headers = {
    ...CORS,
    "Accept-Ranges": "bytes",
    "Content-Type": "application/pdf",
    "Cache-Control": "no-store",
  };
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  let start = 0;
  let end = size - 1;
  if (range) {
    start = Number(range[1]);
    end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end) {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` }).end();
      return;
    }
    s.ranges++;
    res.writeHead(206, {
      ...headers,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": end - start + 1,
    });
  } else {
    res.writeHead(200, { ...headers, "Content-Length": size });
  }
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = createReadStream(path, {
    start,
    end,
    highWaterMark: range ? 64 * 1024 : 16 * 1024,
  });
  res.on("close", () => stream.destroy());
  stream.on("data", (chunk) => {
    if (res.destroyed) return;
    s.bytes += chunk.length;
    entry.sent += chunk.length;
    res.write(chunk);
    if (!range) {
      stream.pause();
      setTimeout(() => stream.resume(), 20);
    }
  });
  stream.on("end", () => res.end());
  stream.on("error", () => res.destroy());
});

server.listen(port, () => console.log(`range server on http://localhost:${port}`));
