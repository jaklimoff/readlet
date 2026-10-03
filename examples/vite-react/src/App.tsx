import { type OutlineItem, type Rotation, type TextRange, isTextRange } from "@readlet/core";
import { createPdfBackend } from "@readlet/pdf";
import { type Highlight, Viewer, type ViewerHandle, type ViewMode, type ZoomMode } from "@readlet/react";
import { useEffect, useRef, useState } from "react";

// Create the backend once, at module level.
const pdf = createPdfBackend();

const FIXTURES = [
  "single-column.pdf",
  "two-column.pdf",
  "scanned-ocr.pdf",
  "rotated.pdf",
  "ligatures.pdf",
  "cjk.pdf",
  "rtl.pdf",
  "outline-links.pdf",
  "large-500.pdf",
  "large-1000.pdf",
];

declare global {
  interface Window {
    /** Test hook for Playwright. Not part of the library. */
    readlet?: { handle: ViewerHandle | null; lastRange: TextRange | null; pageChanges: number[] };
  }
}

const params = new URLSearchParams(location.search);

export function App() {
  const ref = useRef<ViewerHandle>(null);
  const [src, setSrc] = useState<string | File>(params.get("file") ?? FIXTURES[0] ?? "");
  const [mode, setMode] = useState<ViewMode>((params.get("mode") as ViewMode) ?? "scroll");
  const [zoom, setZoom] = useState<ZoomMode>(() => {
    const z = params.get("zoom");
    return z === null ? "fit-width" : Number.isNaN(Number(z)) ? (z as ZoomMode) : Number(z);
  });
  const [rotation, setRotation] = useState<Rotation>(0);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [range, setRange] = useState<TextRange | null>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    window.readlet = { handle: null, lastRange: null, pageChanges: [] };
  }, []);

  const selectionText = range ? (ref.current?.selection?.rangeToText(range) ?? "") : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 8, borderBottom: "1px solid #ccc" }}>
        <select
          aria-label="Fixture"
          value={typeof src === "string" ? src : ""}
          onChange={(e) => setSrc(e.target.value)}
        >
          {typeof src !== "string" ? <option value="">{src.name}</option> : null}
          {FIXTURES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <input
          type="file"
          accept="application/pdf"
          aria-label="Open file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) setSrc(file);
          }}
        />
        <select aria-label="Mode" value={mode} onChange={(e) => setMode(e.target.value as ViewMode)}>
          <option value="scroll">scroll</option>
          <option value="page">page</option>
        </select>
        <select
          aria-label="Zoom"
          value={String(zoom)}
          onChange={(e) => {
            const v = e.target.value;
            setZoom(v.startsWith("fit") ? (v as ZoomMode) : Number(v));
          }}
        >
          <option value="fit-width">fit width</option>
          <option value="fit-page">fit page</option>
          {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((z) => (
            <option key={z} value={String(z)}>
              {z * 100}%
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setRotation(((rotation + 90) % 360) as Rotation)}>
          Rotate ({rotation}°)
        </button>
        <button type="button" onClick={() => ref.current?.viewport?.previousPage()}>
          Previous
        </button>
        <label>
          Page{" "}
          <input
            aria-label="Page number"
            type="number"
            min={1}
            max={pageCount}
            value={page + 1}
            style={{ width: 56 }}
            onChange={(e) => ref.current?.goToPage(Number(e.target.value) - 1)}
          />{" "}
          / <span data-testid="page-count">{pageCount}</span>
        </label>
        <button type="button" onClick={() => ref.current?.viewport?.nextPage()}>
          Next
        </button>
        <button type="button" disabled={!range} onClick={() => range && setHighlights((h) => [...h, { range }])}>
          Highlight selection
        </button>
        <button type="button" disabled={!range} onClick={() => localStorage.setItem("readlet:range", JSON.stringify(range))}>
          Save range
        </button>
        <button
          type="button"
          onClick={() => {
            const saved: unknown = JSON.parse(localStorage.getItem("readlet:range") ?? "null");
            if (isTextRange(saved)) ref.current?.selection?.setRange(saved);
          }}
        >
          Restore range
        </button>
        <span data-testid="status">{status}</span>
      </header>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <nav aria-label="Outline" style={{ width: 200, overflow: "auto", borderRight: "1px solid #ccc", padding: 8 }}>
          <strong>Outline</strong>
          <OutlineList items={outline} onPick={(i) => ref.current?.goToPage(i)} />
        </nav>
        <main style={{ flex: 1, minWidth: 0, background: "#eee" }}>
          <Viewer
            ref={(h) => {
              ref.current = h;
              if (window.readlet) window.readlet.handle = h;
            }}
            src={src}
            backend={pdf}
            mode={mode}
            zoom={zoom}
            rotation={rotation}
            highlights={highlights}
            loading={<p style={{ padding: 16 }}>Loading…</p>}
            error={(e) => <p style={{ padding: 16, color: "crimson" }}>Error: {e.code}</p>}
            onLoad={(doc) => {
              setStatus("ready");
              setPageCount(doc.pageCount);
              doc.getOutline().then(setOutline, () => setOutline([]));
            }}
            onError={(e) => setStatus(`error:${e.code}`)}
            onPageChange={(i) => {
              setPage(i);
              window.readlet?.pageChanges.push(i);
            }}
            onSelectionChange={(r) => {
              setRange(r);
              if (window.readlet) window.readlet.lastRange = r;
            }}
          />
        </main>
        <aside style={{ width: 260, overflow: "auto", borderLeft: "1px solid #ccc", padding: 8 }}>
          <strong>Selection</strong>
          <pre data-testid="range" style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(range)}
          </pre>
          <pre data-testid="selection-text" style={{ whiteSpace: "pre-wrap" }}>
            {selectionText}
          </pre>
        </aside>
      </div>
    </div>
  );
}

function OutlineList({ items, onPick }: { items: OutlineItem[]; onPick: (page: number) => void }) {
  if (items.length === 0) return null;
  return (
    <ul style={{ paddingLeft: 16 }}>
      {items.map((item, i) => (
        <li key={`${item.title}-${i}`}>
          {item.pageIndex !== null ? (
            <button type="button" onClick={() => onPick(item.pageIndex as number)}>
              {item.title}
            </button>
          ) : (
            item.title
          )}
          <OutlineList items={item.items} onPick={onPick} />
        </li>
      ))}
    </ul>
  );
}
