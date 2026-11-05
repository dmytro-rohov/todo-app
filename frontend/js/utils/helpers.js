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
export function safeColor(value, fallback = "#cccccc") {
  return typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
    ? value
    : fallback;
}
