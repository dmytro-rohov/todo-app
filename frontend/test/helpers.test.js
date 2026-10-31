import { test } from "node:test";
import assert from "node:assert/strict";

import { escapeHtml, safeColor } from "../js/utils/helpers.js";
import { groupTasksByDate } from "../js/utils/date.js";

test("escapeHtml neutralises script tags", () => {
  assert.equal(
    escapeHtml("<script>alert(1)</script>"),
    "&lt;script&gt;alert(1)&lt;/script&gt;"
  );
});

test("escapeHtml neutralises event handler payloads", () => {
  const out = escapeHtml("<img src=x onerror=alert(1)>");
  assert.ok(!out.includes("<"));
  assert.ok(!out.includes(">"));
});

test("escapeHtml prevents breaking out of attributes", () => {
  assert.equal(escapeHtml("\" onmouseover=\"x"), "&quot; onmouseover=&quot;x");
  assert.equal(escapeHtml("' autofocus '"), "&#39; autofocus &#39;");
  assert.equal(escapeHtml("`x`"), "&#96;x&#96;");
});

test("escapeHtml escapes ampersands first (no double decoding)", () => {
  assert.equal(escapeHtml("&lt;b&gt;"), "&amp;lt;b&amp;gt;");
});

test("escapeHtml keeps ordinary text, Polish letters and emoji intact", () => {
  assert.equal(escapeHtml("Zrób zakupy 🛒"), "Zrób zakupy 🛒");
});

test("escapeHtml handles null, undefined and numbers", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(42), "42");
});

test("safeColor accepts hex colors only", () => {
  assert.equal(safeColor("#4e45e4"), "#4e45e4");
  assert.equal(safeColor("#ABC"), "#ABC");
  assert.equal(safeColor("red;background:url(x)"), "#ccc");
  assert.equal(safeColor("\" onclick=\"x"), "#ccc");
  assert.equal(safeColor(undefined), "#ccc");
  assert.equal(safeColor("nope", "#000"), "#000");
});

test("groupTasksByDate groups by date and skips empty entries", () => {
  const grouped = groupTasksByDate([
    { id: 1, date: "2026-10-30" },
    null,
    { id: 2, date: "2026-10-29" },
    { id: 3, date: "2026-10-30" }
  ]);
  assert.deepEqual(Object.keys(grouped).sort(), ["2026-10-29", "2026-10-30"]);
  assert.equal(grouped["2026-10-30"].length, 2);
});
