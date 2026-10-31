import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { request, jsonOptions } from '../js/api/request.js';
import { request as legacyRequest, ApiError } from '../js/api/http.js';
import { getTasks, addTask, updateTask, deleteTask, deleteTaskByDate } from '../js/api/tasks.js';
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
test('active request helper returns JSON and preserves fetch options', async () => {
  const options = jsonOptions('POST', { title: 'Żółć' });
  globalThis.fetch = async (url, init) => { assert.equal(url, '/api/tasks'); assert.deepEqual(init, options); return Response.json({ id: 1 }); };
  assert.deepEqual(await request('/api/tasks', options), { id: 1 });
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(options.body), { title: 'Żółć' });
});
for (const status of [400, 401, 422, 500]) test(`active request exposes HTTP ${status}`, async () => {
  globalThis.fetch = async () => Response.json({ message: 'Validation failed' }, { status });
  await assert.rejects(request('/api/tasks'), /Validation failed/);
});
test('active helper handles non-JSON errors and empty success', async () => {
  globalThis.fetch = async () => new Response('<html>Error</html>', { status: 502 });
  await assert.rejects(request('/api/tasks'), /502/);
  globalThis.fetch = async () => new Response(null, { status: 204 });
  assert.deepEqual(await request('/api/tasks'), {});
});
test('network rejection propagates without retry', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError('offline'); };
  await assert.rejects(request('/api/tasks'), /offline/); assert.equal(calls, 1);
});
test('retained http helper exposes ApiError status and network errors', async () => {
  globalThis.fetch = async () => Response.json({ message: 'Invalid' }, { status: 400 });
  await assert.rejects(legacyRequest('/tasks'), e => e instanceof ApiError && e.status === 400 && e.message === 'Invalid');
  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(legacyRequest('/tasks'), e => e instanceof ApiError && e.status === 0);
});
test('task API contract uses same origin and exactly the requested mutations', async () => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => { calls.push([init.method || 'GET', url]); return Response.json([]); };
  await getTasks(); await addTask({ title: 'Test' }); await updateTask({ id: 7 }); await deleteTask(7); await deleteTaskByDate('2026-10-31');
  assert.deepEqual(calls, [['GET','/api/tasks'],['POST','/api/tasks'],['PUT','/api/tasks/7'],['DELETE','/api/tasks/7'],['DELETE','/api/tasks/date/2026-10-31']]);
});
