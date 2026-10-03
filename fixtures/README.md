# Readlet test fixtures

Small, freely licensed PDFs for the unit and Playwright tests. All files are
generated. Do not edit them by hand.

`manifest.json` lists, for each file, the page count, the page sizes and
rotations, and the exact strings that tests can use. For the key sentences and
words it also gives their positions in PDF user space (`x`, `baseline`,
`width`, `fontSize`; points, origin at the bottom-left, before `/Rotate`).
Page indices are 0-based.

## Files

| File | Pages | Purpose |
| --- | --- | --- |
| `single-column.pdf` | 5 | One column of ~11pt body text with a heading on each page. Page index 0 has a mid-page sentence (`sentences.page1Mid`) on one line for drag-select tests. Page index 2 ends with `sentences.page3End` on the last line near the bottom margin. Page index 3 starts with `sentences.page4Start` on the first line near the top margin (cross-page drag). Single words for double-click tests: `aardvark` (p0), `zephyr` (p1), `quixotic` (p2), `pumpernickel` (p3), `marmalade` (p4). |
| `two-column.pdf` | 2 | Full-width title and two text columns. The first sentence of each column and the words `pelican` (p0, left) and `gazetteer` (p1, right) are in the manifest. |
| `scanned-ocr.pdf` | 2 | Each page is a 144 dpi JPEG of text on a slightly grey, speckled background. An invisible OCR text layer (text render mode `3 Tr`) sits over the words. |
| `large-500.pdf` | 500 | Heading `Page N` and the sentence `This is page N of 500. In words, this is page <words>.` on every page (N = index + 1). One shared subset font. |
| `large-1000.pdf` | 1000 | Same as above with 1000 pages, for the heap and scroll performance test. |
| `rotated.pdf` | 5 | Portrait pages with `/Rotate` 0, 90, 180, 270, then a landscape (792x612) page with `/Rotate` 0. The text reads upright after the viewer applies `/Rotate`. Each page has a marker word (`alpha` to `echo`). |
| `ligatures.pdf` | 1 | Text full of fi, fl, ff, ffi and ffl words, drawn with the real ligature glyphs (one glyph for two or three letters). |
| `cjk.pdf` | 2 | Horizontal Simplified Chinese (p0) and Japanese (p1), with one mixed Latin line on each page. |
| `outline-links.pdf` | 6 | Document outline with one nested child, and three link annotations on page index 0: a `/Dest` link to page index 2 (`/XYZ`), a `GoTo` action to page index 4 (`/Fit`), and a URI link to `https://example.com`. Visible blue link text is under each link rectangle. |
| `rtl.pdf` | 1 | Optional: a Hebrew line and a mixed Latin and Hebrew line. |

### Notes for test authors

- **Ligatures.** The content stream uses the ligature glyphs. The ToUnicode
  map gives each ligature glyph its component letters, so pdf.js
  `getTextContent()` returns plain `fi`, `ffi`, and so on (not the U+FB01 to
  U+FB04 code points). One glyph therefore maps to two or three characters.
  All other fixtures turn ligatures off, so their text is plain ASCII.
- **OCR layer alignment.** The image and the invisible text use the same font
  (Crimson Text) and the same metrics. Each word in the image is drawn at the
  x position that the font advances give in the invisible text (no kerning, no
  ligatures). Thus the invisible glyphs sit on the visible words to within
  rasterisation error. There is one invisible text line for each visible line.
- **RTL.** The Hebrew glyphs are stored in visual order (right to left).
  pdf.js reorders the text into logical order (`dir: "rtl"`).
- **CJK font weight.** Noto Sans SC is a variable font. The embedded subset
  uses its default instance, which is a light weight.
- **Determinism.** The output is byte-for-byte the same on each run: fixed
  dates, producer and creator `Readlet fixtures`, and a seeded random number
  generator for the subset font name tags.

## Regenerate

```sh
node scripts/make-fixtures.mjs     # or: pnpm fixtures
node scripts/verify-fixtures.mjs   # checks every fixture with pdf.js
```

The generator downloads the fonts into `scripts/.cache/` (git-ignored) on the
first run. It uses `pdf-lib` and `@pdf-lib/fontkit` to write the PDFs. It
uses Playwright Chromium only to rasterise the page images for
`scanned-ocr.pdf`. If the Playwright browser for the installed version is
missing, it tries a system Chrome or another Chromium build in the Playwright
cache.

The verifier loads each file with the pdf.js legacy build
(`packages/pdf/node_modules/pdfjs-dist`). It checks the page counts, sizes,
rotations, the manifest strings in `getTextContent()`, the recorded positions,
upright text after `/Rotate`, the `3 Tr` OCR layer, the ligature glyphs, and
the outline and link targets. It exits with a non-zero code on failure.

## Licensing

- **Text.** All text in the fixtures is original text written for this
  project. It is dedicated to the public domain under
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
- **Fonts.** The fonts are licensed under the
  [SIL Open Font License 1.1](https://openfontlicense.org). They are embedded
  as subsets. The sources are:

  | Font | Used in | Source |
  | --- | --- | --- |
  | Crimson Text Regular | All Latin text | https://raw.githubusercontent.com/google/fonts/main/ofl/crimsontext/CrimsonText-Regular.ttf |
  | Crimson Text Bold | Headings | https://raw.githubusercontent.com/google/fonts/main/ofl/crimsontext/CrimsonText-Bold.ttf |
  | Noto Sans SC (variable) | `cjk.pdf` | https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf |
  | Noto Sans Hebrew (variable) | `rtl.pdf` | https://raw.githubusercontent.com/google/fonts/main/ofl/notosanshebrew/NotoSansHebrew%5Bwdth,wght%5D.ttf |

  The license text for each font is next to it in the google/fonts
  repository (`OFL.txt`).
