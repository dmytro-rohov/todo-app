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

// escape user-provided text before putting it into an HTML template
const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
  "`": "&#96;"
};

export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"'`]/g, char => HTML_ESCAPES[char]);
}

// only plain hex colors may reach inline style attributes
export function safeColor(value, fallback = "#ccc") {
  return typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
    ? value
    : fallback;
}
