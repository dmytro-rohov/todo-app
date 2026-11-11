// Interface size (Settings → interface size): every size in the stylesheet is in rem, so one number scales everything.
// "auto" keeps the stylesheet's default (75% on computers, 70% on phones); a chosen size is kept on this device only
// ("mytko-<app>:ui-scale").
import { storageKey } from "./config.js";

const KEY = () => storageKey("ui-scale");
export const SCALES = ["auto", "0.7", "0.8", "0.9", "1"];

export function savedScale() {
  try {
    const value = localStorage.getItem(KEY());
    return SCALES.includes(value) ? value : "auto";
  } catch { return "auto"; }
}

export function applyScale(value = savedScale()) {
  const root = document.documentElement;
  if (value === "auto") root.style.removeProperty("--ui-scale");
  else root.style.setProperty("--ui-scale", value);
}

export function saveScale(value) {
  try {
    if (value === "auto") localStorage.removeItem(KEY());
    else localStorage.setItem(KEY(), value);
  } catch { /* storage unavailable: the size lasts until the page is reloaded */ }
  applyScale(value);
}

// px per rem / 16: the effective scale, for the few places that need CSS pixels (scroll positions).
export function uiScale() {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;
}
