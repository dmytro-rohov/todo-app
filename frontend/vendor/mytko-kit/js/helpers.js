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

// only plain hex colors may reach style properties or SVG attributes
export function safeColor(value, fallback = "#cccccc") {
  return typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
    ? value
    : fallback;
}

// "Dmytro Rohov" -> "DR"; only words that start with a letter or digit count ("Оля (тест)" -> "ОТ").
export function initials(name) {
  return String(name || "").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.slice(0, 2).map(word => word[0].toLocaleUpperCase()).join("") || "?";
}
