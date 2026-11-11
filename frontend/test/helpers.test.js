import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, safeColor } from '../vendor/mytko-kit/js/helpers.js';
for (const [input, expected] of [['<script>', '&lt;script&gt;'], ['"\'`&', '&quot;&#39;&#96;&amp;'], [null, ''], [undefined, ''], ['Żółć 🎉', 'Żółć 🎉'], [7, '7']]) {
  test(`escapeHtml safely renders ${String(input)}`, () => assert.equal(escapeHtml(input), expected));
}
test('safeColor accepts current hex contract and rejects CSS injection', () => {
  for (const color of ['#abc', '#AABBCC']) assert.equal(safeColor(color), color);
  for (const color of ['red; background:url(x)', '" onmouseover="x', null, '#12345']) assert.equal(safeColor(color), '#cccccc');
});
