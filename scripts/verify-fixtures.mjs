#!/usr/bin/env node
// Verifies fixtures/*.pdf against fixtures/manifest.json with pdf.js (legacy
// build, Node). Exits non-zero on any failure.
//
//   node scripts/verify-fixtures.mjs

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "fixtures");
const pdfjsPath = join(
  ROOT,
  "packages",
  "pdf",
  "node_modules",
  "pdfjs-dist",
  "legacy",
  "build",
  "pdf.mjs",
);
const pdfjs = await import(pathToFileURL(pdfjsPath).href);
const { getDocument, Util, OPS } = pdfjs;

const manifest = JSON.parse(await readFile(join(FIX, "manifest.json"), "utf8"));
const failures = [];
const notes = [];
let checks = 0;

function check(cond, msg) {
  checks++;
  if (!cond) failures.push(msg);
}

const collapse = (s) => s.replace(/\s+/g, " ").trim();
const strip = (s) => s.replace(/\s+/g, "");

async function pageText(page) {
  const tc = await page.getTextContent();
  return {
    items: tc.items.filter((i) => "str" in i),
    text: collapse(tc.items.map((i) => i.str ?? "").join(" ")),
  };
}

function containsLoose(text, needle) {
  return text.includes(collapse(needle)) || strip(text).includes(strip(needle));
}

async function open(name) {
  const data = new Uint8Array(await readFile(join(FIX, name)));
  const task = getDocument({ data, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  doc._task = task;
  return doc;
}

async function verifyCommon(name, spec, doc) {
  check(doc.numPages === spec.pages, `${name}: expected ${spec.pages} pages, got ${doc.numPages}`);
  const rotations = Array.isArray(spec.rotations) ? spec.rotations : null;
  const sizes = spec.pageSizes ?? null;
  const toCheck = rotations
    ? rotations.map((_, i) => i)
    : [0, Math.floor(doc.numPages / 2), doc.numPages - 1];
  for (const i of toCheck) {
    const page = await doc.getPage(i + 1);
    const rot = rotations ? rotations[i] : 0;
    check(page.rotate === rot, `${name} p${i}: rotate ${page.rotate} != ${rot}`);
    const [w, h] = sizes ? sizes[i] : spec.pageSize;
    const [x0, y0, x1, y1] = page.view;
    check(x1 - x0 === w && y1 - y0 === h, `${name} p${i}: size ${x1 - x0}x${y1 - y0} != ${w}x${h}`);
  }
  for (const tc of spec.textChecks ?? []) {
    const page = await doc.getPage(tc.page + 1);
    const { text } = await pageText(page);
    for (const s of tc.contains ?? [])
      check(containsLoose(text, s), `${name} p${tc.page}: text missing "${s}"`);
    if (tc.startsWith)
      check(
        text.startsWith(collapse(tc.startsWith)),
        `${name} p${tc.page}: text does not start with "${tc.startsWith}" (starts "${text.slice(0, 60)}")`,
      );
    if (tc.endsWith)
      check(
        text.endsWith(collapse(tc.endsWith)),
        `${name} p${tc.page}: text does not end with "${tc.endsWith}" (ends "${text.slice(-60)}")`,
      );
  }
}

/** Checks that each recorded position matches a text item in pdf.js. */
async function verifyPositions(name, doc, positions) {
  const flat = [];
  for (const [k, v] of Object.entries(positions ?? {})) {
    if (v && typeof v.page === "number") flat.push([k, v]);
    else if (v && typeof v === "object")
      for (const [k2, v2] of Object.entries(v)) flat.push([`${k}.${k2}`, v2]);
  }
  for (const [k, pos] of flat) {
    const page = await doc.getPage(pos.page + 1);
    const { items } = await pageText(page);
    const hit = items.find(
      (it) =>
        Math.abs(it.transform[5] - pos.baseline) < 0.5 &&
        pos.x >= it.transform[4] - 0.5 &&
        pos.x + pos.width <= it.transform[4] + it.width + 0.5,
    );
    check(!!hit, `${name}: position ${k} (${JSON.stringify(pos)}) does not match any text item`);
  }
}

async function opsOf(page) {
  return page.getOperatorList();
}

const handlers = {
  async "scanned-ocr.pdf"(name, _spec, doc) {
    for (let i = 0; i < doc.numPages; i++) {
      const ol = await opsOf(await doc.getPage(i + 1));
      const hasImage = ol.fnArray.some(
        (f) => f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject,
      );
      const modes = ol.fnArray.flatMap((f, j) =>
        f === OPS.setTextRenderingMode ? [ol.argsArray[j][0]] : [],
      );
      check(hasImage, `${name} p${i}: no raster image painted`);
      check(
        modes.length > 0 && modes.every((m) => m === 3),
        `${name} p${i}: text render modes ${JSON.stringify(modes)} (want 3)`,
      );
    }
  },
  async "ligatures.pdf"(name, spec, doc) {
    const page = await doc.getPage(1);
    const ol = await opsOf(page);
    const multi = new Set();
    for (let j = 0; j < ol.fnArray.length; j++) {
      if (ol.fnArray[j] !== OPS.showText) continue;
      for (const g of ol.argsArray[j][0])
        if (g && typeof g === "object" && g.unicode && g.unicode.length > 1) multi.add(g.unicode);
    }
    for (const lig of ["fi", "fl", "ff", "ffi", "ffl"])
      check(multi.has(lig), `${name}: no ligature glyph for "${lig}" (saw ${[...multi]})`);
    const { text } = await pageText(page);
    const presentation = /[ﬀ-ﬆ]/.test(text);
    notes.push(
      `ligatures.pdf: ligature glyphs used: ${[...multi].sort().join(", ")}; getTextContent() yields ${presentation ? "U+FB0x presentation forms" : 'decomposed letters ("fi", "ffi", ...)'}`,
    );
    for (const w of spec.words)
      check(text.includes(w), `${name}: word "${w}" not extracted as plain letters`);
  },
  async "rotated.pdf"(name, spec, doc) {
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const want = spec.pageInfo[i].displaySize;
      check(
        Math.round(vp.width) === want[0] && Math.round(vp.height) === want[1],
        `${name} p${i}: viewport ${vp.width}x${vp.height} != ${want}`,
      );
      const { items } = await pageText(page);
      for (const it of items.filter((x) => x.str.trim())) {
        const m = Util.transform(vp.transform, it.transform);
        // In viewport space (y down) upright left-to-right text has m = [s, 0, 0, -s, ...].
        const upright = m[0] > 0 && Math.abs(m[1]) < 1e-6 && Math.abs(m[2]) < 1e-6 && m[3] < 0;
        const inside = m[4] >= 0 && m[4] <= vp.width && m[5] >= 0 && m[5] <= vp.height;
        check(
          upright && inside,
          `${name} p${i}: item "${it.str.slice(0, 20)}" not upright/inside in viewport (m=${m.map((n) => n.toFixed(2))})`,
        );
      }
    }
  },
  async "outline-links.pdf"(name, spec, doc) {
    const outline = await doc.getOutline();
    const norm = async (items) =>
      Promise.all(
        (items ?? []).map(async (it) => {
          const dest = typeof it.dest === "string" ? await doc.getDestination(it.dest) : it.dest;
          const page = await doc.getPageIndex(dest[0]);
          const children = await norm(it.items);
          return { title: it.title, page, ...(children.length ? { children } : {}) };
        }),
      );
    const got = await norm(outline);
    check(
      JSON.stringify(got) === JSON.stringify(spec.outline),
      `${name}: outline ${JSON.stringify(got)} != ${JSON.stringify(spec.outline)}`,
    );
    const page = await doc.getPage(1);
    const annots = (await page.getAnnotations()).filter((a) => a.subtype === "Link");
    check(
      annots.length === spec.links.length,
      `${name}: ${annots.length} link annotations, want ${spec.links.length}`,
    );
    for (const link of spec.links) {
      const a = annots.find((x) => x.rect.every((v, k) => Math.abs(v - link.rect[k]) < 0.01));
      if (!a) {
        check(false, `${name}: no link with rect ${link.rect}`);
        continue;
      }
      if (link.type === "uri") {
        check(
          a.url === link.url || a.url === `${link.url}/`,
          `${name}: link url ${a.url} != ${link.url}`,
        );
      } else {
        const pi = Array.isArray(a.dest) ? await doc.getPageIndex(a.dest[0]) : -1;
        check(
          pi === link.targetPage,
          `${name}: link "${link.text}" goes to page ${pi}, want ${link.targetPage}`,
        );
        check(
          a.dest?.[1]?.name === link.destType,
          `${name}: link "${link.text}" dest type ${a.dest?.[1]?.name} != ${link.destType}`,
        );
      }
    }
  },
  async "rtl.pdf"(_name, _spec, doc) {
    const { items } = await pageText(await doc.getPage(1));
    const hebItem = items.find((i) => /[֐-׿]{3}/.test(i.str) && i.str.includes(" "));
    notes.push(`rtl.pdf: extracted Hebrew line "${hebItem?.str}" (dir=${hebItem?.dir})`);
  },
};

for (const [name, spec] of Object.entries(manifest.files)) {
  const before = failures.length;
  let doc;
  try {
    doc = await open(name);
  } catch (e) {
    failures.push(`${name}: failed to open: ${e.message}`);
    continue;
  }
  await verifyCommon(name, spec, doc);
  await verifyPositions(name, doc, spec.positions);
  if (handlers[name]) await handlers[name](name, spec, doc);
  const pages = doc.numPages;
  await doc._task.destroy();
  const size = (await readFile(join(FIX, name))).length;
  console.log(
    `${failures.length === before ? "ok  " : "FAIL"} ${name} (${pages} pages, ${(size / 1024).toFixed(1)} KiB)`,
  );
}

for (const n of notes) console.log(`note: ${n}`);
if (failures.length) {
  console.error(`\n${failures.length} failure(s) in ${checks} checks:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nall ${checks} checks passed`);
