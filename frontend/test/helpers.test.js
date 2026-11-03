import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, safeColor } from '../js/utils/helpers.js';
for (const [input, expected] of [['<script>', '&lt;script&gt;'], ['"\'`&', '&quot;&#39;&#96;&amp;'], [null, ''], [undefined, ''], ['Żółć 🎉', 'Żółć 🎉'], [7, '7']]) {
  test(`escapeHtml safely renders ${String(input)}`, () => assert.equal(escapeHtml(input), expected));
}
test('safeColor accepts current hex contract and rejects CSS injection', () => {
  for (const color of ['#abc', '#AABBCC']) assert.equal(safeColor(color), color);
  for (const color of ['red; background:url(x)', '" onmouseover="x', null, '#12345']) assert.equal(safeColor(color), '#cccccc');
});
test('Kanban cards escape user text', async () => {
  const { card } = await import('../js/board.js');
  const html = card({id:1,title:'<script>x</script>',description:'<img src=x>',priority:'P2',categoryId:1,dueDate:null},[{id:1,name:'<svg>'}]);
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img')); assert.ok(html.includes('&lt;svg&gt;'));
});

test('task form callback sends the active PATCH contract', async () => {
  const { submitTaskForm } = await import('../js/board.js');
  const fields = { title: 'Updated', description: 'Details', status: 'done', priority: 'P1', categoryId: '4', dueDate: '', position: '2' };
  const form = {};
  globalThis.FormData = class { entries() { return Object.entries(fields); } [Symbol.iterator]() { return this.entries(); } };
  const calls = [];
  const send = async (...args) => { calls.push(args); return { id: 7 }; };
  await submitTaskForm(form, { id: 7 }, send);
  assert.equal(calls[0][0], '/api/tasks/7');
  assert.deepEqual(calls[0][1].body, { ...fields, categoryId: 4, dueDate: null, position: 2 });

  const historical = { title: 'x'.repeat(255), description: '', status: 'todo', priority: 'P2', categoryId: null, dueDate: null, position: 2 };
  globalThis.FormData = class { entries() { return Object.entries({ title: historical.title, description: '', status: 'done', priority: 'P2', categoryId: '', dueDate: '', position: '2' }); } [Symbol.iterator]() { return this.entries(); } };
  await submitTaskForm(form, historical, send);
  assert.deepEqual(calls[1][1].body, { status: 'done' });
});
