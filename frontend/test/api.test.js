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
test('HTTP helper aborts a stalled response body without retry', async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    return { ok: true, text: () => new Promise((resolve,reject) => init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true})) };
  };
  // AbortSignal.timeout timers are unref'ed in Node; keep this test alive.
  const keepAlive = setTimeout(()=>{},1000);
  try { await assert.rejects(legacyRequest('/api/tasks',{timeoutMs:10}),e=>e instanceof ApiError && e.status===0 && /czas/.test(e.message)); assert.equal(calls,1); }
  finally { clearTimeout(keepAlive); }
});
test('HTTP helper translates response stream failure into ApiError', async()=>{
  globalThis.fetch=async()=>({ok:true,text:async()=>{throw new Error('stream failed');}});
  await assert.rejects(legacyRequest('/api/tasks'),e=>e instanceof ApiError && e.status===0);
});
for (const status of [400,401,403,404,409,500,503]) test(`ApiError preserves HTTP ${status} without retry`, async()=>{
  let calls=0; globalThis.fetch=async()=>{calls++;return Response.json({message:'Controlled error'},{status});};
  await assert.rejects(legacyRequest('/api/tasks',{method:'POST',body:{title:'test'}}),e=>e instanceof ApiError && e.status===status && e.message==='Controlled error');assert.equal(calls,1);
});
test('caller AbortController cancels request without retry',async()=>{
 const controller=new AbortController();let calls=0;
 globalThis.fetch=async(url,init)=>{calls++;return new Promise((resolve,reject)=>{if(init.signal.aborted)reject(init.signal.reason);else init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});};
 const pending=legacyRequest('/api/tasks',{signal:controller.signal});controller.abort();
 await assert.rejects(pending,e=>e instanceof ApiError && e.status===0);assert.equal(calls,1);
});
test('request header wait is bounded by same deadline',async()=>{
 globalThis.fetch=async(url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
 const keepAlive=setTimeout(()=>{},1000);try{await assert.rejects(legacyRequest('/api/tasks',{timeoutMs:10}),e=>e instanceof ApiError && /czas/.test(e.message));}finally{clearTimeout(keepAlive);}
});
