// get random color for category
export function getRandomColor() {
  const colors = [
    "#4e45e4",
    "#22c55e",
    "#f59e0b",
    "#ef4444",
    "#3b82f6",
    "#a855f7"
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// escape user content before putting it into innerHTML templates
export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// only accept #rrggbb colors, anything else falls back to the default
export function safeColor(value, fallback = "#cccccc") {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}
