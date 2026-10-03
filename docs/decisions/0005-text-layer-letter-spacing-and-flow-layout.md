# 0005 — Text spans use letter-spacing; page slots use normal flow

Status: accepted · 2026-10-03

**Problem.** Two cross-page selection bugs showed up in Firefox and WebKit:

1. pdf.js matches each text span to the width of the glyph run with `transform: scaleX(k)`.
   When a drag selection starts on one page and continues on the next, Firefox ignores that
   transform for the new page: the selection end lands at about `k ×` the real offset, so it
   lags behind the pointer (seen: offset 72 instead of 81 at the end of a line).
2. Page slots were absolutely positioned. With the pointer in the gap between two pages,
   Firefox and WebKit mapped the selection focus to the start of the document, so the selection
   jumped to page 1 during the drag.

**Options.** (a) Keep pdf.js's technique and accept the bugs; (b) browser-specific code paths;
(c) change the technique for all browsers.

**Choice: (c).**

1. Spans get `letter-spacing: calc(var(--rl-scale) * Spx)` with
   `S = (runWidth − measuredWidth) / characterCount` and no `scaleX`. Hit testing then works in
   every browser. A rotation transform is still used for rotated runs. Glyph positions inside a
   span change a little (spacing is uniform, not proportional); the text is invisible, and
   `rangeToRects` is computed from the text model, so highlights do not change.
2. Page slots are `position: relative` in normal block flow, with margins that give the same
   positions as `columnLayout`. Between two pages, browsers now map the pointer to the nearest
   page.

Both are covered by browser tests in Chromium, Firefox and WebKit.
