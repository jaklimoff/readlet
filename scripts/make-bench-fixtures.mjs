#!/usr/bin/env node
// Generates heavy PDFs for the speed benchmark (tests/e2e/benchmark.spec.ts) into
// fixtures/bench/. The files are large, so they are not in git; they are the same on every run
// (fixed random seed). Each kind of page stresses a different part of rendering:
//
//   bench-images.pdf  24 pages, one photo-like full-page JPEG each, 150 dpi (image decoding)
//   bench-vector.pdf  24 pages, about 6,000 curve segments each, like a map (path filling)
//   bench-text.pdf    24 pages, about 7,000 glyphs each in small type (text layer build)
//
//   node scripts/make-bench-fixtures.mjs [--force]

import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "bench");
const PAGES = 24;
const W = 612;
const H = 792;

/** Mulberry32: a small seeded PRNG, so the files are the same on every run. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A photo-like image as JPEG (quality 80): soft colour fields, a few shapes and fine grain. */
function photoJpeg(width, height, seed) {
  const rand = prng(seed);
  const blobs = Array.from({ length: 12 }, () => ({
    x: rand() * width,
    y: rand() * height,
    r: (0.1 + rand() * 0.4) * width,
    c: [rand() * 255, rand() * 255, rand() * 255],
  }));
  const data = Buffer.alloc(width * height * 4);
  let o = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 40 + (x / width) * 80;
      let g = 60 + (y / height) * 90;
      let b = 120;
      for (const blob of blobs) {
        const d = Math.hypot(x - blob.x, y - blob.y) / blob.r;
        if (d < 1) {
          const k = (1 - d) * (1 - d);
          r += (blob.c[0] - r) * k;
          g += (blob.c[1] - g) * k;
          b += (blob.c[2] - b) * k;
        }
      }
      const grain = (rand() - 0.5) * 24;
      data[o++] = Math.max(0, Math.min(255, r + grain));
      data[o++] = Math.max(0, Math.min(255, g + grain));
      data[o++] = Math.max(0, Math.min(255, b + grain));
      data[o++] = 255;
    }
  }
  return jpeg.encode({ data, width, height }, 80).data;
}

async function images() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < PAGES; i++) {
    const page = doc.addPage([W, H]);
    // 1275 × 1650 px: a letter page at 150 dpi, like a scan or a photo page.
    const image = await doc.embedJpg(photoJpeg(1275, 1650, 1000 + i));
    page.drawImage(image, { x: 0, y: 0, width: W, height: H });
    page.drawText(`Image page ${i + 1}`, { x: 36, y: H - 48, size: 18, font, color: rgb(1, 1, 1) });
  }
  return doc;
}

async function vector() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < PAGES; i++) {
    const rand = prng(2000 + i);
    const page = doc.addPage([W, H]);
    // 300 random-walk "contour lines" of 20 cubic segments each: about 6,000 segments.
    for (let l = 0; l < 300; l++) {
      let x = rand() * W;
      let y = rand() * H;
      let d = `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      for (let s = 0; s < 20; s++) {
        const nx = x + (rand() - 0.5) * 60;
        const ny = y + (rand() - 0.5) * 60;
        d += ` C ${(x + (rand() - 0.5) * 40).toFixed(1)} ${(y + (rand() - 0.5) * 40).toFixed(1)} ${(nx + (rand() - 0.5) * 40).toFixed(1)} ${(ny + (rand() - 0.5) * 40).toFixed(1)} ${nx.toFixed(1)} ${ny.toFixed(1)}`;
        x = nx;
        y = ny;
      }
      // drawSvgPath uses SVG coordinates (y down) relative to (x, y) = top-left.
      page.drawSvgPath(d, {
        x: 0,
        y: H,
        borderColor: rgb(rand() * 0.6, rand() * 0.6, rand() * 0.6),
        borderWidth: 0.4 + rand(),
        ...(l % 4 === 0 ? { color: rgb(rand(), rand(), rand()), opacity: 0.25 } : {}),
      });
    }
    page.drawText(`Vector page ${i + 1}`, { x: 36, y: H - 48, size: 18, font });
  }
  return doc;
}

const WORDS =
  "the archive of the harbour town kept records of ships cargo weather and the names of every keeper who watched the light through long winter nights while storms moved over the grey water".split(
    " ",
  );

async function text() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const size = 7;
  const leading = 8.4;
  const colWidth = (W - 36 * 2 - 18) / 2;
  for (let i = 0; i < PAGES; i++) {
    const rand = prng(3000 + i);
    const page = doc.addPage([W, H]);
    page.drawText(`Text page ${i + 1}`, { x: 36, y: H - 40, size: 14, font });
    for (let col = 0; col < 2; col++) {
      const x0 = 36 + col * (colWidth + 18);
      for (let y = H - 64; y > 40; y -= leading) {
        let line = "";
        for (;;) {
          const word = WORDS[Math.floor(rand() * WORDS.length)];
          const next = line ? `${line} ${word}` : word;
          if (font.widthOfTextAtSize(next, size) > colWidth) break;
          line = next;
        }
        page.drawText(line, { x: x0, y, size, font });
      }
    }
  }
  return doc;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const force = process.argv.includes("--force");
await mkdir(OUT, { recursive: true });
for (const [name, make] of [
  ["bench-images.pdf", images],
  ["bench-vector.pdf", vector],
  ["bench-text.pdf", text],
]) {
  const path = join(OUT, name);
  if (!force && (await exists(path))) {
    console.log(`exists  ${name}`);
    continue;
  }
  const started = Date.now();
  const doc = await make();
  doc.setProducer("readlet bench fixtures");
  doc.setCreator("scripts/make-bench-fixtures.mjs");
  const bytes = await doc.save();
  await writeFile(path, bytes);
  console.log(
    `wrote   ${name}: ${(bytes.length / 1e6).toFixed(1)} MB in ${Date.now() - started} ms`,
  );
}
