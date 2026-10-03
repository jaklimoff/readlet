const CSS = `
.rl-viewer{position:relative;display:flow-root;margin:0;padding:0;box-sizing:border-box}
.rl-page{position:relative;margin:0;overflow:hidden;background:var(--rl-page-background,#fff);box-shadow:var(--rl-page-shadow,0 0 0 1px rgba(0,0,0,.08),0 1px 3px rgba(0,0,0,.16))}
.rl-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;user-select:none;-webkit-user-select:none}
.rl-layers{position:absolute;left:0;top:0;transform-origin:0 0}
.rl-overlay{position:absolute;inset:0;pointer-events:none;z-index:0}
.rl-text-layer{position:absolute;inset:0;overflow:clip;line-height:1;text-align:initial;-webkit-text-size-adjust:none;text-size-adjust:none;forced-color-adjust:none;caret-color:CanvasText;z-index:1}
.rl-text-layer span{position:absolute;white-space:pre;color:transparent;cursor:text;transform-origin:0 0;z-index:1}
.rl-text-layer ::selection{background:var(--rl-selection,rgba(0,96,255,.28))}
.rl-text-layer .rl-sep::selection{background:transparent}
.rl-eoc{display:block;position:absolute;inset:100% 0 0;z-index:0;cursor:default;user-select:none;-webkit-user-select:none}
.rl-text-layer.rl-selecting .rl-eoc{top:0}
.rl-link-layer{position:absolute;inset:0;z-index:2;pointer-events:none}
.rl-link-layer a{position:absolute;pointer-events:auto;cursor:pointer}
.rl-link-layer a:focus-visible{outline:2px solid Highlight;outline-offset:1px}
`;

const injected = new WeakSet<Document>();

/**
 * Adds Readlet's base CSS to a document once. Viewports call this unless `injectStyles: false`.
 * All rules use `rl-` classes and can be overridden; colors come from CSS variables
 * (`--rl-page-background`, `--rl-page-shadow`, `--rl-selection`).
 *
 * @example
 * ```ts
 * injectStyles(document);
 * ```
 */
export function injectStyles(doc: Document): void {
  if (injected.has(doc)) return;
  injected.add(doc);
  const style = doc.createElement("style");
  style.dataset.readlet = "";
  style.textContent = CSS;
  doc.head.prepend(style);
}

/**
 * The base CSS text, for apps that ship their own stylesheet.
 *
 * @example
 * ```ts
 * // With createViewport(doc, { container, injectStyles: false }):
 * writeFileSync("readlet.css", baseCss);
 * ```
 */
export const baseCss = CSS;
