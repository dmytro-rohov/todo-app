// Short notices at the bottom, optionally with one action ("Cofnij").
import { escapeHtml } from "../utils/helpers.js";

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
  while (region.children.length > 3) region.firstElementChild.remove();
  setTimeout(close, timeout);
}
