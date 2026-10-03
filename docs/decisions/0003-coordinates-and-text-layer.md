# 0003 — Page coordinates, zoom unit and text layer scaling

Status: accepted · 2026-10-03

**Problem.** `PageRect`, `TextRange` geometry and the text layer need one coordinate system that
does not change with zoom, resize or user rotation.

**Choice.**

- *Page coordinates* use PDF points (1/72 inch), origin at the top-left corner of the page, y goes
  down. The page's intrinsic `/Rotate` is applied; the user rotation is **not** applied. A page
  that is 612×792 pt with `/Rotate 90` has page coordinates 792×612.
- *Zoom unit.* `scale = 1` means "actual size" (100%): 1 pt = 96/72 CSS px, the same as pdf.js
  and desktop readers.
- *Text layer.* Spans are positioned in percentages of the page box, and font sizes use
  `calc(var(--rl-scale) * Npx)`, the same technique pdf.js uses. A zoom change only updates a CSS
  variable; the text DOM is not rebuilt, so a native selection survives zoom. User rotation is a
  CSS transform on the layer box. The `SelectionManager` still captures and restores the
  `TextRange` around layout changes as a safety net.
- *Rectangles from ranges* are computed from the text model (item geometry plus canvas
  `measureText` of glyph prefixes, the same measurement the text layer uses for its `scaleX`), not
  from DOM layout. So `rangeToRects` gives the same result for pages that are not rendered.
