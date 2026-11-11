// Short notices at the bottom, optionally with one action (e.g. undo).
import { escapeHtml } from "./helpers.js";

let region = null;

export function toast(message, { tone = "info", action = null, onAction = null, timeout = 6000 } = {}) {
  if (!region) {
    region = document.createElement("div");
    region.className = "toasts";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }
  const item = document.createElement("div");
  item.className = `toast toast--${tone}`;
  item.innerHTML = `<span>${escapeHtml(message)}</span>${action ? `<button type="button">${escapeHtml(action)}</button>` : ""}`;
  const close = () => item.remove();
  item.querySelector("button")?.addEventListener("click", () => { close(); onAction?.(); });
  region.append(item);
  // at most three: plain notices go first, so a burst of errors does not take away a "Cofnij" still on screen
  while (region.children.length > 3) ([...region.children].find(child => !child.querySelector("button")) || region.firstElementChild).remove();
  setTimeout(close, timeout);
}
