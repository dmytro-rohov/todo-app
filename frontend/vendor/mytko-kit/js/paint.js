// Colours and widths never go into style attributes (CSP style-src 'self'): elements carry data-c (a hex colour) or
// data-w (a percentage) and get a CSS variable from script.
import { safeColor } from "./helpers.js";

export function paint(element) {
  for (const node of element.querySelectorAll("[data-c]")) node.style.setProperty("--c", safeColor(node.dataset.c, "#7d8a80"));
  for (const node of element.querySelectorAll("[data-w]")) {
    const width = Math.max(0, Math.min(100, Number(node.dataset.w) || 0));
    node.style.setProperty("--w", `${width}%`);
  }
}
