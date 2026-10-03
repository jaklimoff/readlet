#!/usr/bin/env node
// A small static server for the fixtures that behaves like S3 for pdf.js: it answers HTTP Range
// requests, sends `Accept-Ranges: bytes`, and sends the CORS headers that a cross-origin viewer
// needs. It counts the bytes that it sends, so the browser tests can check partial loading.
//
//   node scripts/range-server.mjs [port]      (default 5174)
//
// GET /<file>?t=<token>   serves fixtures/<file>; statistics are kept per token
//   &fail=<n>             the first n range requests that do not start at byte 0 answer 503
//   &expose=0             do not expose Content-Range and Accept-Ranges to the page (CORS)
// GET /__fail?t=<token>&n=<n>  from now on, fail the next n range requests of that token
// GET /__stats?t=<token>  returns { requests, bytes, ranges, uniqueBytes, rangeBytes, log } for that token;
//                         uniqueBytes counts each distinct range once (React StrictMode loads a
//                         document twice in development); rangeBytes is the same without
//                         the first, cancelled full request

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
    s = { requests: 0, bytes: 0, ranges: 0, failed: 0, log: [] };
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
  if (url.pathname === "/__fail") {
    const s = statsFor(token);
    s.failLimit = s.failed + Number(url.searchParams.get("n") ?? 0);
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
    for (const e of s.log) {
      if (e.sent >= 0) unique.set(e.range, Math.max(unique.get(e.range) ?? 0, e.sent));
    }
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
  const cors =
    url.searchParams.get("expose") === "0"
      ? { ...CORS, "Access-Control-Expose-Headers": "Content-Length" }
      : CORS;
  const headers = {
    ...cors,
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
    s.failLimit ??= Number(url.searchParams.get("fail") ?? 0);
    if (start > 0 && s.failed < s.failLimit) {
      s.failed++;
      entry.sent = -1;
      res.writeHead(503, cors).end();
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
  const stream = createReadStream(path, { start, end, highWaterMark: 64 * 1024 });
  res.on("close", () => stream.destroy());
  stream.on("data", (chunk) => {
    if (res.destroyed) return;
    s.bytes += chunk.length;
    entry.sent += chunk.length;
    if (!res.write(chunk)) {
      stream.pause();
      res.once("drain", () => stream.resume());
    }
  });
  stream.on("end", () => res.end());
  stream.on("error", () => res.destroy());
});

server.listen(port, () => console.log(`range server on http://localhost:${port}`));
