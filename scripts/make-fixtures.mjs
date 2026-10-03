#!/usr/bin/env node
// Generates the Readlet fixture PDFs into fixtures/.
//
//   node scripts/make-fixtures.mjs
//
// All text is original (CC0). Fonts are SIL OFL 1.1 and are downloaded from
// the google/fonts repository into scripts/.cache/ on first run. Fonts are
// embedded as subsets. Output is deterministic: fixed dates, fixed metadata and
// a seeded Math.random (pdf-lib uses Math.random for subset font name tags).

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import {
  beginText,
  degrees,
  endText,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
} from "pdf-lib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "scripts", ".cache");
const OUT = join(ROOT, "fixtures");

const FIXED_DATE = new Date("2026-01-01T00:00:00Z");
const LETTER = [612, 792];
const MARGIN = 72;
const INK = rgb(0.1, 0.1, 0.1);
const LINK_BLUE = rgb(0.05, 0.25, 0.75);

// ---------------------------------------------------------------------------
// Fonts (SIL OFL 1.1, google/fonts repository)
// ---------------------------------------------------------------------------

const GF = "https://raw.githubusercontent.com/google/fonts/main/ofl";
export const FONTS = {
  serif: {
    file: "CrimsonText-Regular.ttf",
    name: "Crimson Text Regular",
    url: `${GF}/crimsontext/CrimsonText-Regular.ttf`,
  },
  serifBold: {
    file: "CrimsonText-Bold.ttf",
    name: "Crimson Text Bold",
    url: `${GF}/crimsontext/CrimsonText-Bold.ttf`,
  },
  cjk: {
    file: "NotoSansSC-VF.ttf",
    name: "Noto Sans SC (variable, default instance)",
    url: `${GF}/notosanssc/NotoSansSC%5Bwght%5D.ttf`,
  },
  hebrew: {
    file: "NotoSansHebrew-VF.ttf",
    name: "Noto Sans Hebrew (variable, default instance)",
    url: `${GF}/notosanshebrew/NotoSansHebrew%5Bwdth,wght%5D.ttf`,
  },
};

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadFontBytes(key) {
  const f = FONTS[key];
  const path = join(CACHE, f.file);
  if (!(await exists(path))) {
    console.log(`downloading ${f.url}`);
    const res = await fetch(f.url);
    if (!res.ok) throw new Error(`download failed ${res.status} ${f.url}`);
    await mkdir(CACHE, { recursive: true });
    await writeFile(path, new Uint8Array(await res.arrayBuffer()));
  }
  return readFile(path);
}

// fontkit's TrueType subsetter copies raw glyph records and writes a short
// (offset / 2) loca table when the subset is small. Glyph records with an odd
// byte length (common in variable fonts such as Noto Sans SC) then shift every
// later glyph by one byte and the glyphs render as blanks. Pad every glyph
// record to an even length so the short loca offsets stay exact.
async function patchFontkitSubsetPadding() {
  const probe = fontkit.create(await loadFontBytes("serif"));
  const proto = Object.getPrototypeOf(probe.createSubset());
  if (proto.__readletPadded) return;
  const original = proto._addGlyph;
  proto._addGlyph = function addGlyphPadded(gid) {
    const idx = original.call(this, gid);
    const buf = this.glyf[idx];
    if (buf.length % 2 === 1) {
      // Use fontkit's own Buffer implementation (it may bundle a polyfill).
      const B = buf.constructor;
      const padded =
        typeof B.alloc === "function" ? B.alloc(buf.length + 1) : new B(buf.length + 1);
      buf.copy(padded, 0);
      padded[buf.length] = 0;
      this.glyf[idx] = padded;
      this.offset += 1;
    }
    return idx;
  };
  proto.__readletPadded = true;
}

// Ligatures are disabled for every fixture except ligatures.pdf so that the
// extracted text is plain ASCII.
const NO_LIGA = { liga: false, clig: false, dlig: false };

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function newDoc(title, seed) {
  Math.random = mulberry32(seed);
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  doc.setTitle(title);
  doc.setAuthor("Readlet fixtures");
  doc.setSubject("Readlet test fixture");
  doc.setProducer("Readlet fixtures");
  doc.setCreator("Readlet fixtures");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  return doc;
}

async function saveDoc(doc, name) {
  const bytes = await doc.save({ useObjectStreams: true });
  await writeFile(join(OUT, name), bytes);
  console.log(`wrote fixtures/${name} (${(bytes.length / 1024).toFixed(1)} KiB)`);
  return bytes.length;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function wrap(text, font, size, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Simple top-down layout cursor on one page. Records every drawn line. */
class Flow {
  constructor(
    page,
    { x = MARGIN, top = LETTER[1] - MARGIN, width = LETTER[0] - 2 * MARGIN, bottom = MARGIN } = {},
  ) {
    this.page = page;
    this.x = x;
    this.y = top;
    this.width = width;
    this.bottom = bottom;
    this.lines = [];
  }
  line(text, font, size, { color = INK, x = this.x } = {}) {
    this.page.drawText(text, { x, y: this.y, size, font, color });
    this.lines.push({ text, x, y: this.y, size, font });
    return this.lines[this.lines.length - 1];
  }
  heading(text, font, size = 18) {
    this.y -= size;
    this.line(text, font, size);
    this.y -= size * 0.9;
  }
  para(text, font, size = 11, leading = 15.5, after = 7) {
    for (const l of wrap(text, font, size, this.width)) {
      this.y -= leading;
      this.line(l, font, size);
    }
    this.y -= after;
  }
  paraHeight(text, font, size = 11, leading = 15.5) {
    return wrap(text, font, size, this.width).length * leading;
  }
}

/** Finds `needle` in the recorded lines and returns its position in page space. */
function locate(lines, needle, pageIndex) {
  for (const l of lines) {
    const i = l.text.indexOf(needle);
    if (i >= 0) {
      const x = l.x + l.font.widthOfTextAtSize(l.text.slice(0, i), l.size);
      return {
        page: pageIndex,
        x: round(x),
        baseline: round(l.y),
        width: round(l.font.widthOfTextAtSize(needle, l.size)),
        fontSize: l.size,
      };
    }
  }
  throw new Error(`could not locate "${needle}" on page ${pageIndex}`);
}

const round = (n) => Math.round(n * 100) / 100;

// Original filler prose (CC0).
const FILLER = [
  "The river bent twice before it reached the quiet market town.",
  "Every window on the narrow street held a small clay pot of herbs.",
  "A baker named Ilse opened her shutters an hour before the sun.",
  "Children chased paper boats along the gutter after the rain.",
  "The clock above the post office ran four minutes slow all winter.",
  "Nobody could remember who had planted the row of tall poplars.",
  "On market days the square smelled of apples, rope and wet wool.",
  "An old cartographer kept his maps rolled in a copper tube.",
  "He claimed that every road eventually returned to its own beginning.",
  "The schoolteacher wrote the date on the board in careful round letters.",
  "Pigeons gathered on the roof of the granary to watch the carts arrive.",
  "A violin could be heard most evenings from the house with green doors.",
  "The ferry crossed the lake six times a day, weather permitting.",
  "Its captain wore the same grey coat in summer and in snow.",
  "Travellers often asked for directions to a bridge that no longer existed.",
  "The innkeeper answered patiently and drew them a new route on a napkin.",
  "In autumn the hills turned the colour of rust and honey.",
  "Lanterns were hung along the harbour wall for the evening festival.",
  "A small brass band rehearsed in the barn behind the chapel.",
  "The librarian stamped each returned book with a satisfied nod.",
  "Snow arrived late that year and stayed until the middle of spring.",
  "The miller repaired his wheel with timber from a broken oak.",
  "Most letters to the town arrived on Tuesdays, carried by a tired mule.",
  "Someone painted a blue door at the end of the lane and left no name.",
  "Fishermen mended their nets in the long light of the evening.",
  "The bell tower leaned slightly to the north, like a listening ear.",
];

function filler(start, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(FILLER[(start + i) % FILLER.length]);
  return out.join(" ");
}

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
export function numberToWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
  if (n < 1000)
    return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberToWords(n % 100)}` : ""}`;
  return `${numberToWords(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${numberToWords(n % 1000)}` : ""}`;
}

const manifest = {
  $comment:
    "Generated by scripts/make-fixtures.mjs. Page indices are 0-based. Positions are in PDF user space (points, origin bottom-left, before /Rotate): x = left edge, baseline = text baseline y, width = advance width.",
  generatedBy: "scripts/make-fixtures.mjs",
  fonts: Object.fromEntries(
    Object.entries(FONTS).map(([k, v]) => [
      k,
      { name: v.name, url: v.url, license: "SIL OFL 1.1" },
    ]),
  ),
  files: {},
};

// ---------------------------------------------------------------------------
// 1. single-column.pdf
// ---------------------------------------------------------------------------

async function singleColumn() {
  const doc = await newDoc("Readlet fixture: single column", 1);
  const reg = await doc.embedFont(await loadFontBytes("serif"), {
    subset: true,
    features: NO_LIGA,
  });
  const bold = await doc.embedFont(await loadFontBytes("serifBold"), {
    subset: true,
    features: NO_LIGA,
  });

  const S = {
    page1Mid: "The quick lighthouse keeper counted seventeen silver herons before breakfast.",
    page3End: "The archivist closed the ledger and walked slowly toward the eastern stairwell.",
    page4Start: "Morning fog rolled across the harbour while the bells of the old mill rang twice.",
  };
  const W = {
    aardvark: {
      page: 0,
      sentence: "A tame aardvark slept under the bakery counter every afternoon.",
    },
    zephyr: { page: 1, sentence: "A warm zephyr carried the smell of bread across the square." },
    quixotic: {
      page: 2,
      sentence: "His quixotic plan to tunnel under the lake amused the whole town.",
    },
    pumpernickel: {
      page: 3,
      sentence: "The bakery sold pumpernickel loaves wrapped in brown paper.",
    },
    marmalade: { page: 4, sentence: "She sold marmalade in jars sealed with yellow wax." },
  };
  const headings = [
    "Chapter One: The Lighthouse",
    "Chapter Two: The Market Square",
    "Chapter Three: The Archive",
    "Chapter Four: The Harbour",
    "Chapter Five: The Long Winter",
  ];
  const positions = {};
  const pagesLines = [];

  for (let p = 0; p < 5; p++) {
    const page = doc.addPage(LETTER);
    const f = new Flow(page);
    const wordSentence = Object.values(W).find((w) => w.page === p).sentence;

    if (p === 3) {
      // Page 4 begins with the known sentence at the top margin, continuing
      // the paragraph that page 3 broke off.
      f.para(`${S.page4Start} ${filler(3, 3)}`, reg);
      f.y -= 6;
      f.heading(headings[p], bold);
    } else {
      f.heading(headings[p], bold);
    }

    if (p === 0) {
      f.para(filler(0, 5), reg);
      f.para(`${filler(5, 2)} ${wordSentence} ${filler(7, 3)}`, reg);
      f.para(filler(10, 4), reg);
      f.y -= 40; // push the known sentence toward the middle of the page
      f.para(`${S.page1Mid} ${filler(14, 4)}`, reg);
      f.para(filler(18, 5), reg);
      f.para(filler(23, 4), reg);
    } else if (p === 2) {
      // Fill the page with whole sentences, then put the known sentence as
      // the last line, close to the bottom margin.
      const lastBaseline = MARGIN + 6;
      f.para(`${filler(4, 3)} ${wordSentence} ${filler(8, 3)}`, reg);
      let k = 11;
      let para = [];
      const flush = () => {
        if (para.length) f.para(para.join(" "), reg);
        para = [];
      };
      while (true) {
        const candidate = [...para, FILLER[k % FILLER.length]].join(" ");
        const remaining = f.y - 7 - f.paraHeight(candidate, reg) - (lastBaseline + 15.5);
        if (remaining < 0) break;
        para.push(FILLER[k % FILLER.length]);
        k++;
        if (para.length === 5) flush();
      }
      flush();
      f.y = lastBaseline;
      f.line(S.page3End, reg, 11);
    } else {
      f.para(`${filler(p * 3, 4)} ${wordSentence} ${filler(p * 3 + 4, 3)}`, reg);
      f.para(filler(p * 5 + 1, 5), reg);
      f.para(filler(p * 5 + 7, 6), reg);
      f.para(filler(p * 5 + 13, 4), reg);
    }
    pagesLines.push(f.lines);
  }

  positions.page1Mid = locate(pagesLines[0], S.page1Mid, 0);
  positions.page3End = locate(pagesLines[2], S.page3End, 2);
  positions.page4Start = locate(pagesLines[3], S.page4Start, 3);
  const words = {};
  for (const [w, { page }] of Object.entries(W)) words[w] = locate(pagesLines[page], w, page);

  // Sanity: page3End is the last line on page 3 and page4Start the first on page 4.
  if (pagesLines[2].at(-1).text !== S.page3End) throw new Error("page3End is not last");
  if (!pagesLines[3][0].text.startsWith(S.page4Start)) throw new Error("page4Start is not first");

  const size = await saveDoc(doc, "single-column.pdf");
  manifest.files["single-column.pdf"] = {
    purpose:
      "Basic selection: drag-select a sentence, double-click a word, cross-page drag from page index 2 to 3.",
    bytes: size,
    pages: 5,
    pageSize: LETTER,
    rotations: [0, 0, 0, 0, 0],
    headings,
    sentences: S,
    words: Object.keys(W),
    positions: { ...positions, words },
    textChecks: [
      { page: 0, contains: [headings[0], S.page1Mid, W.aardvark.sentence] },
      { page: 1, contains: [headings[1], W.zephyr.sentence] },
      { page: 2, contains: [headings[2], W.quixotic.sentence], endsWith: S.page3End },
      { page: 3, contains: [headings[3], W.pumpernickel.sentence], startsWith: S.page4Start },
      { page: 4, contains: [headings[4], W.marmalade.sentence] },
    ],
  };
}

// ---------------------------------------------------------------------------
// 2. two-column.pdf
// ---------------------------------------------------------------------------

async function twoColumn() {
  const doc = await newDoc("Readlet fixture: two column", 2);
  const reg = await doc.embedFont(await loadFontBytes("serif"), {
    subset: true,
    features: NO_LIGA,
  });
  const bold = await doc.embedFont(await loadFontBytes("serifBold"), {
    subset: true,
    features: NO_LIGA,
  });
  const gutter = 24;
  const colW = (LETTER[0] - 2 * MARGIN - gutter) / 2;
  const titles = ["Notes on the Valley Survey", "The Valley Survey, Continued"];
  const S = {
    page1LeftStart: "The survey team left the station at dawn on the second of May.",
    page1RightStart: "Water samples from the upper stream were unusually clear.",
    page2LeftStart: "By the third week the team had mapped every path along the ridge.",
    page2RightStart: "The final report recommended a footbridge near the old ford.",
  };
  const words = { pelican: 0, gazetteer: 1 };
  const positions = {};
  const checks = [];

  for (let p = 0; p < 2; p++) {
    const page = doc.addPage(LETTER);
    const head = new Flow(page);
    head.heading(titles[p], bold, 22);
    const top = head.y - 10;
    const left = new Flow(page, { x: MARGIN, top, width: colW });
    const right = new Flow(page, { x: MARGIN + colW + gutter, top, width: colW });
    const ls = p === 0 ? S.page1LeftStart : S.page2LeftStart;
    const rs = p === 0 ? S.page1RightStart : S.page2RightStart;
    const wordLine =
      p === 0
        ? "A lone pelican watched the surveyors from a flat rock."
        : "Each village name was checked against the county gazetteer.";
    left.para(`${ls} ${filler(p * 7, 4)}`, reg, 10.5, 14.5);
    left.para(
      `${filler(p * 7 + 4, 3)} ${p === 0 ? wordLine : ""} ${filler(p * 7 + 7, 4)}`,
      reg,
      10.5,
      14.5,
    );
    left.para(filler(p * 7 + 11, 7), reg, 10.5, 14.5);
    left.para(filler(p * 7 + 18, 6), reg, 10.5, 14.5);
    right.para(`${rs} ${filler(p * 5 + 2, 4)}`, reg, 10.5, 14.5);
    right.para(
      `${filler(p * 5 + 6, 3)} ${p === 1 ? wordLine : ""} ${filler(p * 5 + 9, 4)}`,
      reg,
      10.5,
      14.5,
    );
    right.para(filler(p * 5 + 13, 7), reg, 10.5, 14.5);
    right.para(filler(p * 5 + 20, 6), reg, 10.5, 14.5);
    const k = p === 0 ? "page1" : "page2";
    positions[`${k}LeftStart`] = locate(left.lines, ls.split(" ").slice(0, 5).join(" "), p);
    positions[`${k}RightStart`] = locate(right.lines, rs.split(" ").slice(0, 5).join(" "), p);
    positions.title = positions.title ?? locate(head.lines, titles[0], 0);
    for (const [w, wp] of Object.entries(words))
      if (wp === p) positions[w] = locate([...left.lines, ...right.lines], w, p);
    checks.push({ page: p, contains: [titles[p], ls, rs, wordLine] });
  }
  const size = await saveDoc(doc, "two-column.pdf");
  manifest.files["two-column.pdf"] = {
    purpose: "Reading order and selection across two text columns with a full-width title.",
    bytes: size,
    pages: 2,
    pageSize: LETTER,
    rotations: [0, 0],
    columns: {
      left: { x: MARGIN, width: round(colW) },
      right: { x: round(MARGIN + colW + gutter), width: round(colW) },
    },
    titles,
    sentences: S,
    words: Object.keys(words),
    positions,
    textChecks: checks,
  };
}

// ---------------------------------------------------------------------------
// 3. scanned-ocr.pdf
// ---------------------------------------------------------------------------

/** Launches Playwright's Chromium; falls back to a system Chrome or any
 * Chromium build already in the Playwright cache. Only used to rasterise text. */
async function launchChromium(chromium) {
  try {
    return await chromium.launch();
  } catch (first) {
    try {
      return await chromium.launch({ channel: "chrome" });
    } catch {
      const { readdir } = await import("node:fs/promises");
      const { homedir } = await import("node:os");
      const cache =
        process.env.PLAYWRIGHT_BROWSERS_PATH ||
        join(homedir(), "Library", "Caches", "ms-playwright");
      const candidates = [];
      for (const d of (await readdir(cache).catch(() => []))
        .filter((d) => /^chromium-\d+$/.test(d))
        .sort()
        .reverse()) {
        candidates.push(
          join(cache, d, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
          join(cache, d, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
          join(cache, d, "chrome-linux", "chrome"),
          join(cache, d, "chrome-linux64", "chrome"),
        );
      }
      for (const executablePath of candidates) {
        if (await exists(executablePath)) return chromium.launch({ executablePath });
      }
      throw first;
    }
  }
}

async function scannedOcr() {
  const { chromium } = await import("@playwright/test");
  const doc = await newDoc("Readlet fixture: scanned with OCR layer", 3);
  const fontBytes = await loadFontBytes("serif");
  const reg = await doc.embedFont(fontBytes, { subset: true, features: NO_LIGA });
  const titles = ["Field Report Number Seven", "Field Report Number Seven, Part Two"];
  const S = {
    page1: "The old granary was measured at forty paces from end to end.",
    page2: "Rainfall in the northern valley exceeded the seasonal average.",
  };
  const word = "turnip";
  const bodies = [
    [
      `${filler(2, 2)} ${S.page1} ${filler(6, 3)}`,
      `A cart of turnip sacks blocked the gate for most of the morning. ${filler(12, 4)}`,
      filler(18, 5),
    ],
    [`${S.page2} ${filler(1, 4)}`, filler(9, 5), filler(15, 5)],
  ];
  const scale = 2; // 144 dpi raster
  const browser = await launchChromium(chromium);
  const ctxPage = await browser.newPage();
  await ctxPage.setContent("<html><body></body></html>");
  await ctxPage.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const ff = new FontFace("ScanSerif", bin);
    await ff.load();
    document.fonts.add(ff);
  }, fontBytes.toString("base64"));

  const positions = {};
  const checks = [];
  for (let p = 0; p < 2; p++) {
    // Lay out lines in PDF space using the same font metrics as the OCR layer.
    const lines = [];
    let y = LETTER[1] - MARGIN - 20;
    lines.push({ text: titles[p], x: MARGIN, y, size: 20 });
    y -= 20;
    for (const para of bodies[p]) {
      for (const l of wrap(para, reg, 12, LETTER[0] - 2 * MARGIN)) {
        y -= 17;
        lines.push({ text: l, x: MARGIN, y, size: 12 });
      }
      y -= 9;
    }
    // Word boxes: x offsets come from the font advances (no kerning, no
    // ligatures), exactly what the invisible text uses.
    const drawOps = [];
    for (const l of lines) {
      let off = 0;
      for (const part of l.text.split(/( )/)) {
        if (part && part !== " ") drawOps.push({ t: part, x: l.x + off, y: l.y, size: l.size });
        off += reg.widthOfTextAtSize(part, l.size);
      }
    }
    const dataUrl = await ctxPage.evaluate(
      ({ ops, W, H, scale, seed }) => {
        let a = seed;
        const rnd = () => {
          a = (a + 0x6d2b79f5) >>> 0;
          let t = a;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const c = document.createElement("canvas");
        c.width = W * scale;
        c.height = H * scale;
        const g = c.getContext("2d");
        g.fillStyle = "#f4f2ec";
        g.fillRect(0, 0, c.width, c.height);
        // light grey speckle noise
        for (let i = 0; i < 9000; i++) {
          const v = 150 + Math.floor(rnd() * 80);
          g.fillStyle = `rgba(${v},${v},${v},${0.25 + rnd() * 0.4})`;
          g.fillRect(rnd() * c.width, rnd() * c.height, 1 + rnd() * 2, 1 + rnd() * 2);
        }
        g.scale(scale, scale);
        g.fontKerning = "none";
        g.textBaseline = "alphabetic";
        g.fillStyle = "#262626";
        for (const o of ops) {
          g.font = `${o.size}px ScanSerif`;
          g.fillText(o.t, o.x, H - o.y);
        }
        return c.toDataURL("image/jpeg", 0.72);
      },
      { ops: drawOps, W: LETTER[0], H: LETTER[1], scale, seed: 1000 + p },
    );
    const jpg = await doc.embedJpg(Buffer.from(dataUrl.split(",")[1], "base64"));
    const page = doc.addPage(LETTER);
    page.drawImage(jpg, { x: 0, y: 0, width: LETTER[0], height: LETTER[1] });

    // Invisible OCR text layer (text render mode 3), one text object per line.
    page.setFont(reg);
    const key = page.fontKey;
    const ops = [
      pushGraphicsState(),
      beginText(),
      setTextRenderingMode(TextRenderingMode.Invisible),
    ];
    for (const l of lines) {
      ops.push(
        setFontAndSize(key, l.size),
        setTextMatrix(1, 0, 0, 1, l.x, l.y),
        showText(reg.encodeText(l.text)),
      );
    }
    ops.push(endText(), popGraphicsState());
    page.pushOperators(...ops);

    const rec = lines.map((l) => ({ ...l, font: reg }));
    positions[`page${p + 1}`] = locate(rec, S[`page${p + 1}`].split(" ").slice(0, 6).join(" "), p);
    if (p === 0) positions[word] = locate(rec, word, 0);
    checks.push({ page: p, contains: [titles[p], S[`page${p + 1}`], ...(p === 0 ? [word] : [])] });
  }
  await browser.close();
  const size = await saveDoc(doc, "scanned-ocr.pdf");
  manifest.files["scanned-ocr.pdf"] = {
    purpose:
      "Raster page image (JPEG, 144 dpi) with an invisible OCR text layer (3 Tr) aligned over the words.",
    bytes: size,
    pages: 2,
    pageSize: LETTER,
    rotations: [0, 0],
    rasterDpi: 72 * scale,
    textRenderMode: 3,
    titles,
    sentences: S,
    words: [word],
    positions,
    textChecks: checks,
  };
}

// ---------------------------------------------------------------------------
// 4/5. large-500.pdf, large-1000.pdf
// ---------------------------------------------------------------------------

async function large(n) {
  const name = `large-${n}.pdf`;
  const doc = await newDoc(`Readlet fixture: ${n} pages`, 4 + n);
  const reg = await doc.embedFont(await loadFontBytes("serif"), {
    subset: true,
    features: NO_LIGA,
  });
  const bold = await doc.embedFont(await loadFontBytes("serifBold"), {
    subset: true,
    features: NO_LIGA,
  });
  for (let i = 1; i <= n; i++) {
    const page = doc.addPage(LETTER);
    const f = new Flow(page);
    f.heading(`Page ${i}`, bold, 24);
    f.para(
      `This is page ${i} of ${n}. In words, this is page ${numberToWords(i)}. ${filler(i, 3)}`,
      reg,
    );
  }
  const size = await saveDoc(doc, name);
  manifest.files[name] = {
    purpose: "Virtualised scrolling, memory and page-number lookups on a long document.",
    bytes: size,
    pages: n,
    pageSize: LETTER,
    rotations: "all 0",
    pattern: {
      heading: "Page {N}",
      sentence: `This is page {N} of ${n}. In words, this is page {numberToWords(N)}.`,
      note: 'N is 1-based (page index + 1). numberToWords is exported from scripts/make-fixtures.mjs, e.g. 412 -> "four hundred twelve", 1000 -> "one thousand".',
    },
    textChecks: [1, 2, Math.floor(n / 2), n].map((N) => ({
      page: N - 1,
      contains: [
        `Page ${N}`,
        `This is page ${N} of ${n}.`,
        `In words, this is page ${numberToWords(N)}.`,
      ],
    })),
  };
}

// ---------------------------------------------------------------------------
// 6. rotated.pdf
// ---------------------------------------------------------------------------

/** Maps a point given in displayed (rotated) page space, measured from the
 * displayed top-left corner, into user space, plus the text angle. */
function displayToUser(rot, W, H, dx, dy) {
  switch (rot) {
    case 0:
      return { x: dx, y: H - dy, angle: 0 };
    case 90:
      return { x: dy, y: dx, angle: 90 };
    case 180:
      return { x: W - dx, y: dy, angle: 180 };
    case 270:
      return { x: W - dy, y: H - dx, angle: 270 };
    default:
      throw new Error(`bad rotation ${rot}`);
  }
}

async function rotated() {
  const doc = await newDoc("Readlet fixture: rotated pages", 6);
  const reg = await doc.embedFont(await loadFontBytes("serif"), {
    subset: true,
    features: NO_LIGA,
  });
  const bold = await doc.embedFont(await loadFontBytes("serifBold"), {
    subset: true,
    features: NO_LIGA,
  });
  const specs = [
    { size: [612, 792], rotate: 0 },
    { size: [612, 792], rotate: 90 },
    { size: [612, 792], rotate: 180 },
    { size: [612, 792], rotate: 270 },
    { size: [792, 612], rotate: 0 },
  ];
  const pages = [];
  const checks = [];
  specs.forEach((s, i) => {
    const page = doc.addPage(s.size);
    page.setRotation(degrees(s.rotate));
    const [W, H] = s.size;
    const swap = s.rotate % 180 !== 0;
    const DW = swap ? H : W;
    const heading =
      s.rotate === 0 && W > H
        ? "Landscape page, rotation 0 degrees"
        : `Portrait page, rotation ${s.rotate} degrees`;
    const sentence = `This text reads upright when the viewer applies the page rotation of ${s.rotate} degrees.`;
    const marker = ["alpha", "bravo", "charlie", "delta", "echo"][i];
    const markerLine = `Marker word for this page: ${marker}.`;
    let dy = MARGIN + 24;
    const draw = (text, font, size) => {
      const u = displayToUser(s.rotate, W, H, MARGIN, dy);
      page.drawText(text, { x: u.x, y: u.y, size, font, color: INK, rotate: degrees(u.angle) });
    };
    draw(heading, bold, 24);
    dy += 34;
    for (const t of [sentence, markerLine, filler(i * 4, 4), filler(i * 4 + 4, 4)]) {
      for (const l of wrap(t, reg, 12, DW - 2 * MARGIN)) {
        draw(l, reg, 12);
        dy += 17;
      }
      dy += 8;
    }
    pages.push({
      index: i,
      mediaBox: s.size,
      rotate: s.rotate,
      displaySize: swap ? [H, W] : [W, H],
      heading,
      marker,
    });
    checks.push({ page: i, contains: [heading, sentence, markerLine] });
  });
  const size = await saveDoc(doc, "rotated.pdf");
  manifest.files["rotated.pdf"] = {
    purpose:
      "Page /Rotate handling (0/90/180/270 and a landscape MediaBox). Text is drawn so that it reads upright after the viewer applies /Rotate.",
    bytes: size,
    pages: 5,
    rotations: specs.map((s) => s.rotate),
    pageSizes: specs.map((s) => s.size),
    pageInfo: pages,
    textChecks: checks,
  };
}

// ---------------------------------------------------------------------------
// 7. ligatures.pdf
// ---------------------------------------------------------------------------

async function ligatures() {
  const doc = await newDoc("Readlet fixture: ligatures", 7);
  const reg = await doc.embedFont(await loadFontBytes("serif"), {
    subset: true,
    features: { liga: true },
  });
  const bold = await doc.embedFont(await loadFontBytes("serifBold"), {
    subset: true,
    features: { liga: true },
  });
  const sentences = [
    "The official on the first floor was efficient and affable.",
    "A waffle and a soufflé were offered to the affluent visitors.",
    "The fluffy puffin shuffled off the cliff in a flurry of feathers.",
    "Fifty efficient staff baffled the officers with their flawless filing.",
    "It is difficult to find a fjord as deep as the one near the fishery.",
    "The chiffon scarf fluttered in the draft from the office window.",
    "Our staff offered coffee and waffles on the first floor before the briefing.",
  ];
  const words = [
    "official",
    "affluent",
    "first",
    "floor",
    "efficient",
    "waffle",
    "offered",
    "difficult",
    "shuffled",
    "baffled",
    "fluffy",
    "coffee",
  ];
  // Verify that the ligature glyphs are really used in the encoded content.
  const glyphCount = (s) => reg.encodeText(s).asString().length / 4;
  const ligCheck = {};
  for (const lig of ["fi", "fl", "ff", "ffi", "ffl"]) {
    ligCheck[lig] = glyphCount(lig);
    if (ligCheck[lig] !== 1) throw new Error(`"${lig}" did not form a ligature glyph`);
  }
  const page = doc.addPage(LETTER);
  const f = new Flow(page);
  f.heading("Office Ligature Specimen", bold, 22);
  for (const s of sentences) f.para(s, reg, 13, 19, 6);
  f.y -= 10;
  f.heading("Efficient waffles for the office", bold, 16);
  f.para(`${words.join(", ")}.`, reg, 13, 19, 6);
  const positions = {};
  for (const w of ["official", "efficient", "waffle"]) positions[w] = locate(f.lines, w, 0);
  const size = await saveDoc(doc, "ligatures.pdf");
  manifest.files["ligatures.pdf"] = {
    purpose:
      "Text with fi/fl/ff/ffi/ffl ligature glyphs (one glyph for several characters) to test selection offsets and copy.",
    bytes: size,
    pages: 1,
    pageSize: LETTER,
    rotations: [0],
    ligatureGlyphs:
      'Each of fi, fl, ff, ffi, ffl is drawn as one glyph (Crimson Text liga feature). The ToUnicode CMap maps each ligature glyph to its component letters, so pdf.js extracts plain "fi", "ffi", etc. (not U+FB01..U+FB04).',
    glyphsPerLigature: ligCheck,
    heading: "Office Ligature Specimen",
    sentences,
    words,
    positions,
    textChecks: [{ page: 0, contains: ["Office Ligature Specimen", ...sentences] }],
  };
}

// ---------------------------------------------------------------------------
// 8. cjk.pdf
// ---------------------------------------------------------------------------

async function cjk() {
  const doc = await newDoc("Readlet fixture: CJK", 8);
  const font = await doc.embedFont(await loadFontBytes("cjk"), { subset: true });
  const pagesText = [
    {
      heading: "中文测试页",
      lines: [
        "今天天气很好，我们去公园散步。",
        "这是一个用于测试文字选择的中文段落。",
        "小猫在窗台上晒太阳，看着外面的小鸟。",
        "图书馆的门口有一棵很高的银杏树。",
        "他每天早上骑自行车去学校。",
        "Mixed line: Readlet selects 中文 and English together.",
      ],
    },
    {
      heading: "日本語のテストページ",
      lines: [
        "これは日本語のテスト文書です。",
        "桜の花が春の風に揺れています。",
        "駅の前に小さなパン屋があります。",
        "週末は友達と山に登る予定です。",
        "カタカナとひらがなと漢字が混ざっています。",
        "Mixed line: Readlet で日本語を選択します。",
      ],
    },
  ];
  const checks = [];
  const positions = {};
  pagesText.forEach((pt, p) => {
    const page = doc.addPage(LETTER);
    const f = new Flow(page);
    f.heading(pt.heading, font, 22);
    for (const l of pt.lines) {
      f.y -= 26;
      f.line(l, font, 15);
    }
    positions[`page${p + 1}Line1`] = locate(f.lines, pt.lines[0], p);
    checks.push({ page: p, contains: [pt.heading, ...pt.lines] });
  });
  const size = await saveDoc(doc, "cjk.pdf");
  manifest.files["cjk.pdf"] = {
    purpose:
      "Horizontal Chinese (page 0) and Japanese (page 1) text, plus mixed Latin, for selection and word-boundary tests.",
    bytes: size,
    pages: 2,
    pageSize: LETTER,
    rotations: [0, 0],
    pagesText,
    positions,
    textChecks: checks,
  };
}

// ---------------------------------------------------------------------------
// 9. outline-links.pdf
// ---------------------------------------------------------------------------

async function outlineLinks() {
  const doc = await newDoc("Readlet fixture: outline and links", 9);
  const reg = await doc.embedFont(await loadFontBytes("serif"), {
    subset: true,
    features: NO_LIGA,
  });
  const bold = await doc.embedFont(await loadFontBytes("serifBold"), {
    subset: true,
    features: NO_LIGA,
  });
  const ctx = doc.context;
  const titles = [
    "Introduction",
    "Background",
    "Methods",
    "Sampling Details",
    "Results",
    "Appendix",
  ];
  const pages = titles.map((t, i) => {
    const page = doc.addPage(LETTER);
    const f = new Flow(page);
    f.heading(`Section ${i + 1}: ${t}`, bold, 20);
    if (i !== 0) {
      f.para(filler(i * 3, 6), reg);
      f.para(filler(i * 3 + 6, 6), reg);
    }
    return { page, flow: f };
  });
  const refs = pages.map((p) => p.page.ref);

  // Links on page 1.
  const p0 = pages[0];
  p0.flow.para(filler(0, 4), reg);
  const linkSpecs = [
    { text: "Go to page 3 (Methods)", kind: "dest", targetPage: 2, destType: "XYZ" },
    { text: "Go to page 5 (Results)", kind: "goto", targetPage: 4, destType: "Fit" },
    { text: "Visit https://example.com", kind: "uri", url: "https://example.com" },
  ];
  const annots = [];
  const links = [];
  for (const spec of linkSpecs) {
    p0.flow.y -= 24;
    const size = 13;
    const x = MARGIN;
    const y = p0.flow.y;
    p0.page.drawText(spec.text, { x, y, size, font: reg, color: LINK_BLUE });
    const w = reg.widthOfTextAtSize(spec.text, size);
    p0.page.drawLine({
      start: { x, y: y - 2 },
      end: { x: x + w, y: y - 2 },
      thickness: 0.6,
      color: LINK_BLUE,
    });
    const rect = [x - 2, y - 4, x + w + 2, y + size];
    const dict = { Type: "Annot", Subtype: "Link", Rect: rect.map(round), Border: [0, 0, 0] };
    const destArr = (pi, type) =>
      type === "XYZ"
        ? ctx.obj([refs[pi], PDFName.of("XYZ"), PDFNumber.of(0), PDFNumber.of(LETTER[1]), PDFNull])
        : ctx.obj([refs[pi], PDFName.of("Fit")]);
    const annot = ctx.obj(dict);
    if (spec.kind === "dest")
      annot.set(PDFName.of("Dest"), destArr(spec.targetPage, spec.destType));
    if (spec.kind === "goto") {
      annot.set(PDFName.of("A"), ctx.obj({ S: "GoTo" }));
      annot.lookup(PDFName.of("A")).set(PDFName.of("D"), destArr(spec.targetPage, spec.destType));
    }
    if (spec.kind === "uri") {
      annot.set(PDFName.of("A"), ctx.obj({ S: "URI" }));
      annot.lookup(PDFName.of("A")).set(PDFName.of("URI"), PDFString.of(spec.url));
    }
    annots.push(ctx.register(annot));
    links.push({
      text: spec.text,
      rect: rect.map(round),
      ...(spec.kind === "uri"
        ? { type: "uri", url: spec.url }
        : {
            type: spec.kind === "dest" ? "/Dest" : "/A GoTo",
            targetPage: spec.targetPage,
            destType: spec.destType,
          }),
    });
  }
  p0.page.node.set(PDFName.of("Annots"), ctx.obj(annots));
  p0.flow.y -= 20;
  p0.flow.para(filler(5, 6), reg);

  // Outline: Introduction, Background, Methods > Sampling Details, Results, Appendix.
  const outlineSpec = [
    { title: "Introduction", page: 0 },
    { title: "Background", page: 1 },
    { title: "Methods", page: 2, children: [{ title: "Sampling Details", page: 3 }] },
    { title: "Results", page: 4 },
    { title: "Appendix", page: 5 },
  ];
  const outlinesRef = ctx.nextRef();
  const build = (items, parentRef) => {
    const itemRefs = items.map(() => ctx.nextRef());
    let total = 0;
    items.forEach((it, i) => {
      const d = ctx.obj({});
      d.set(PDFName.of("Title"), PDFHexString.fromText(it.title));
      d.set(PDFName.of("Parent"), parentRef);
      d.set(
        PDFName.of("Dest"),
        ctx.obj([refs[it.page], PDFName.of("XYZ"), PDFNull, PDFNull, PDFNull]),
      );
      if (i > 0) d.set(PDFName.of("Prev"), itemRefs[i - 1]);
      if (i < items.length - 1) d.set(PDFName.of("Next"), itemRefs[i + 1]);
      total += 1;
      if (it.children) {
        const sub = build(it.children, itemRefs[i]);
        d.set(PDFName.of("First"), sub.first);
        d.set(PDFName.of("Last"), sub.last);
        d.set(PDFName.of("Count"), PDFNumber.of(sub.count)); // positive: open
        total += sub.count;
      }
      ctx.assign(itemRefs[i], d);
    });
    return { first: itemRefs[0], last: itemRefs.at(-1), count: total };
  };
  const top = build(outlineSpec, outlinesRef);
  const outlines = ctx.obj({ Type: "Outlines" });
  outlines.set(PDFName.of("First"), top.first);
  outlines.set(PDFName.of("Last"), top.last);
  outlines.set(PDFName.of("Count"), PDFNumber.of(top.count));
  ctx.assign(outlinesRef, outlines);
  doc.catalog.set(PDFName.of("Outlines"), outlinesRef);
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));

  const size = await saveDoc(doc, "outline-links.pdf");
  manifest.files["outline-links.pdf"] = {
    purpose:
      "Document outline (with one nested child) and link annotations: internal /Dest, internal GoTo action, external URI.",
    bytes: size,
    pages: 6,
    pageSize: LETTER,
    rotations: [0, 0, 0, 0, 0, 0],
    headings: titles.map((t, i) => `Section ${i + 1}: ${t}`),
    outline: outlineSpec,
    links: links.map((l) => ({ page: 0, ...l })),
    textChecks: [
      { page: 0, contains: ["Section 1: Introduction", ...linkSpecs.map((l) => l.text)] },
      ...titles.slice(1).map((t, i) => ({ page: i + 1, contains: [`Section ${i + 2}: ${t}`] })),
    ],
  };
}

// ---------------------------------------------------------------------------
// 10. rtl.pdf
// ---------------------------------------------------------------------------

async function rtl() {
  const doc = await newDoc("Readlet fixture: right-to-left", 10);
  const reg = await doc.embedFont(await loadFontBytes("serif"), {
    subset: true,
    features: NO_LIGA,
  });
  const bold = await doc.embedFont(await loadFontBytes("serifBold"), {
    subset: true,
    features: NO_LIGA,
  });
  const heb = await doc.embedFont(await loadFontBytes("hebrew"), { subset: true });
  const page = doc.addPage(LETTER);
  const f = new Flow(page);
  f.heading("Right-to-left sample", bold, 22);
  f.para(
    "The next lines contain Hebrew text. The first is Hebrew only; the second mixes Latin and Hebrew.",
    reg,
    12,
    17,
  );
  const hebLine = "הספר נמצא על השולחן";
  const hebWord = "שלום";
  const latinPrefix = "Greeting:";
  // fontkit lays out RTL runs in visual order, so the glyphs are stored
  // right-to-left in the content stream, as most RTL PDF producers do.
  f.y -= 30;
  const w1 = heb.widthOfTextAtSize(hebLine, 18);
  page.drawText(hebLine, { x: LETTER[0] - MARGIN - w1, y: f.y, size: 18, font: heb, color: INK });
  f.y -= 30;
  page.drawText(latinPrefix, { x: MARGIN, y: f.y, size: 18, font: reg, color: INK });
  page.drawText(hebWord, {
    x: MARGIN + reg.widthOfTextAtSize(`${latinPrefix} `, 18),
    y: f.y,
    size: 18,
    font: heb,
    color: INK,
  });
  f.y -= 20;
  f.para("End of the right-to-left sample.", reg, 12, 17);
  const size = await saveDoc(doc, "rtl.pdf");
  manifest.files["rtl.pdf"] = {
    purpose: "Optional: Hebrew (RTL) text, alone and mixed with Latin.",
    bytes: size,
    pages: 1,
    pageSize: LETTER,
    rotations: [0],
    hebrewLine: hebLine,
    hebrewWord: hebWord,
    latinPrefix,
    note: "Glyphs are stored in visual order (right-to-left). pdf.js getTextContent() reorders RTL runs into logical order, so the extracted string equals hebrewLine.",
    textChecks: [{ page: 0, contains: ["Right-to-left sample", hebLine, latinPrefix, hebWord] }],
  };
}

// ---------------------------------------------------------------------------

async function main() {
  await mkdir(OUT, { recursive: true });
  const realRandom = Math.random;
  await patchFontkitSubsetPadding();
  await singleColumn();
  await twoColumn();
  await scannedOcr();
  await large(500);
  await large(1000);
  await rotated();
  await ligatures();
  await cjk();
  await outlineLinks();
  await rtl();
  Math.random = realRandom;
  await writeFile(join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("wrote fixtures/manifest.json");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
