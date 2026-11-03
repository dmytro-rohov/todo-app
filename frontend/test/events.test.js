import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
// Minimal DOM contract: production modules and registered callbacks run unchanged.
class Element {
  constructor() { this.value = ''; this.innerHTML = ''; this.children = []; this.style = {}; this.dataset = {}; this.listeners = {}; this.classList = { add() {}, remove() {}, contains: () => false }; }
  addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
  async emit(type, target = this) { for (const callback of this.listeners[type] || []) await callback({ target }); }
  querySelector() { return new Element(); }
  querySelectorAll() { return []; }
  appendChild(child) { this.children.push(child); }
  setAttribute() {}
}
const elements = new Map();
const doc = new Element();
doc.querySelector = selector => { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); };
doc.querySelectorAll = () => [];
doc.createElement = () => new Element();
doc.body = new Element(); doc.documentElement = { clientWidth: 100 };
globalThis.document = doc;
globalThis.window = { scrollTo() {}, scrollY: 0, innerWidth: 100 };
let alerts = [];
globalThis.alert = message => alerts.push(message);
const { state } = await import('../js/state/state.js');
const { initListeners } = await import('../js/events/listeners.js');
const { renderCategoriesModal } = await import('../js/ui/renderCategories.js');
initListeners();
let calls;
beforeEach(() => {
  calls = []; alerts = []; state.tasksArr = []; state.categoriesArr = []; state.selectedCategoryId = 1;
  doc.querySelector('.modal-input').value = ' Kup mleko ';
  globalThis.fetch = async (url, init = {}) => { calls.push({ url, method: init.method || 'GET', body: init.body }); return Response.json(init.method ? {} : []); };
});
test('real modal confirmation callback sends one POST, refreshes, and no DELETE', async () => {
  await doc.querySelector('.confirm-btn').emit('click');
  assert.deepEqual(calls.map(c => [c.method,c.url]), [['POST','/api/tasks'],['GET','/api/tasks']]);
  assert.equal(JSON.parse(calls[0].body).title, 'Kup mleko');
  assert.equal(state.selectedCategoryId, null);
});
test('modal validation failure alerts without retry or refresh', async () => {
  globalThis.fetch = async (url, init) => { calls.push(init.method); return Response.json({ message: 'Title too short' }, { status: 400 }); };
  await doc.querySelector('.confirm-btn').emit('click');
  assert.deepEqual(calls, ['POST']); assert.deepEqual(alerts, ['Title too short']);
});
test('empty title and missing category never submit', async () => {
  doc.querySelector('.modal-input').value = ' '; await doc.querySelector('.confirm-btn').emit('click');
  doc.querySelector('.modal-input').value = 'Test'; state.selectedCategoryId = null; await doc.querySelector('.confirm-btn').emit('click');
  assert.equal(calls.length, 0); assert.equal(alerts.length, 1);
});
test('category delete click does not trigger delegated task deletion', async () => {
  const button = new Element(); button.classList.contains = name => name === 'delete-one';
  button.closest = () => ({ dataset: { id: '3' }, classList: button.classList });
  await doc.querySelector('.modal-categories').emit('click', button);
  await doc.emit('click', button);
  assert.deepEqual(calls.filter(c => c.method === 'DELETE').map(c => c.url), ['/api/categories/3']);
});
test('modal category renderer escapes hostile text', () => {
  state.categoriesArr = [{ id: 1, name: '<img src=x onerror="alert(1)">' }];
  renderCategoriesModal();
  const html = doc.querySelector('.modal-categories').innerHTML;
  assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('<img')); assert.ok(html.includes('&quot;'));
});
test('task renderer escapes task and category text and normalizes attribute ids', async () => {
  const { renderAllTasks } = await import('../js/ui/renderTasks.js');
  state.tasksArr = [{ id: '1" onfocus="x', title: '<svg onload="x">', date: '2026-10-31', categoryId: 1 }];
  state.categoriesArr = [{ id: 1, name: '<script>x</script>', color: 'red; background:url(x)' }];
  const created = [];
  const originalCreate = doc.createElement;
  doc.createElement = () => { const el = new Element(); created.push(el); return el; };
  try {
    renderAllTasks();
    const task = created.find(el => el.innerHTML.includes('checkbox-wrapper'));
    assert.ok(task.innerHTML.includes('&lt;svg'));
    assert.ok(task.innerHTML.includes('&lt;script&gt;'));
    assert.ok(!task.innerHTML.includes('<svg'));
    assert.ok(!task.innerHTML.includes('onfocus='));
    assert.ok(!task.innerHTML.includes('background:url'));
  } finally { doc.createElement = originalCreate; }
});
