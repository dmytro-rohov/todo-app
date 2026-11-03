import { test } from "node:test";
import assert from "node:assert/strict";
import { bindOrdering } from "../js/ordering.js";

class Root {
  constructor() { this.listeners = {}; this.attributes = {}; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  async key(target, key) {
    const event = { target, key, prevented: false, preventDefault() { this.prevented = true; } };
    for (const fn of this.listeners.keydown || []) await fn(event);
    return event;
  }
}
function handle(id) {
  return { dataset: { move: String(id) }, closest(selector) { return selector === "[data-move]" ? this : null; }, focus() {} };
}
async function scenario(tasks, id, key) {
  const root = new Root(); const calls = [];
  globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return Response.json({ message: "ok" }); };
  bindOrdering(root, () => tasks, async () => {}, () => {});
  await root.key(handle(id), key);
  await new Promise(resolve => setTimeout(resolve, 0));
  return calls;
}

test("ArrowDown sends the exact insertion point for three, two, one, and empty columns", async () => {
  for (const tasks of [
    [{ id: 1, status: "todo", position: 0 }, { id: 2, status: "todo", position: 1 }, { id: 3, status: "todo", position: 2 }],
    [{ id: 1, status: "todo", position: 0 }, { id: 2, status: "todo", position: 1 }],
    [{ id: 1, status: "todo", position: 0 }], []
  ]) {
    if (!tasks.length) continue;
    const calls = await scenario(tasks, tasks[0].id, "ArrowDown");
    assert.equal(calls.length, tasks.length > 1 ? 1 : 0);
    if (calls.length) assert.equal(calls[0].beforeId, tasks.length > 2 ? tasks[2].id : null);
  }
});

test("ArrowUp, ArrowLeft, ArrowRight and column boundaries issue one or zero requests", async () => {
  const tasks = [
    { id: 1, status: "todo", position: 0 }, { id: 2, status: "todo", position: 1 },
    { id: 3, status: "in_progress", position: 0 }, { id: 4, status: "done", position: 0 }
  ];
  assert.equal((await scenario(tasks, 2, "ArrowUp"))[0].beforeId, 1);
  assert.equal((await scenario(tasks, 1, "ArrowDown"))[0].beforeId, null);
  assert.equal((await scenario(tasks, 1, "ArrowRight"))[0].status, "in_progress");
  assert.equal((await scenario(tasks, 3, "ArrowLeft"))[0].status, "todo");
  assert.equal((await scenario(tasks, 1, "ArrowUp")).length, 0);
  assert.equal((await scenario(tasks, 4, "ArrowRight")).length, 0);
});
test('successful move followed by failed reload does not announce refreshed success',async()=>{
 const root=new Root();const messages=[];
 globalThis.fetch=async()=>Response.json({message:'moved'});
 bindOrdering(root,()=>[{id:1,status:'todo',position:0}],async()=>false,message=>messages.push(message));
 await root.key(handle(1),'ArrowRight');
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(messages.some(message=>message.includes('odczyt tablicy')));
 assert.ok(!messages.includes('Zmieniono położenie zadania.'));
 assert.equal(root.attributes['aria-busy'],'false');
});

test('large boards use a bounded snapshot token instead of a growing payload', async () => {
  const tasks = Array.from({ length: 250 }, (_, index) => ({ id: index + 1, status: 'todo', position: index }));
  const calls = await scenario(tasks, 1, 'ArrowRight');
  assert.equal(calls.length, 1);
  assert.match(calls[0].expected, /^[a-f0-9]{64}$/);
  assert.ok(JSON.stringify(calls[0]).length < 10240);
});

test('keyboard navigation visits review between in-progress and done',async()=>{
 const tasks=[{id:1,status:'in_progress',position:0},{id:2,status:'needs_review',position:0},{id:3,status:'done',position:0}];
 assert.equal((await scenario(tasks,1,'ArrowRight'))[0].status,'needs_review');
 assert.equal((await scenario(tasks,2,'ArrowRight'))[0].status,'done');
 assert.equal((await scenario(tasks,3,'ArrowLeft'))[0].status,'needs_review');
});

test('pointer drag scrolls at the viewport edge, persists the drop, and stops scrolling',async()=>{
 const saved={document:globalThis.document,window:globalThis.window,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame,fetch:globalThis.fetch};
 const root=new Root();root.contains=()=>true;
 const target={dataset:{column:'needs_review'},classList:{add(){},remove(){}}};
 const element={closest:selector=>selector==='[data-column]'?target:null};
 const h=handle(1);h.setPointerCapture=()=>{};h.classList={add(){},remove(){}};
 const calls=[],scrolls=[],cancelled=[];let frame;
 globalThis.document={elementFromPoint:()=>element};
 globalThis.window={innerHeight:800,scrollBy:(x,y)=>scrolls.push(y)};
 globalThis.requestAnimationFrame=callback=>{frame=callback;return 7;};
 globalThis.cancelAnimationFrame=id=>cancelled.push(id);
 globalThis.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return Response.json({message:'ok'});};
 bindOrdering(root,()=>[{id:1,status:'todo',position:0}],async()=>true,()=>{});
 try{
  for(const fn of root.listeners.pointerdown)fn({target:h,button:0,pointerId:1,clientX:100,clientY:400,preventDefault(){}});
  for(const fn of root.listeners.pointermove)fn({clientX:100,clientY:790});
  frame();assert.deepEqual(scrolls,[12]);
  for(const fn of root.listeners.pointerup)fn();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(calls.length,1);assert.equal(calls[0].status,'needs_review');assert.equal(calls[0].beforeId,null);
  assert.deepEqual(cancelled,[7]);
  const previous=scrolls.length;frame();assert.equal(scrolls.length,previous);
 }finally{Object.assign(globalThis,saved);}
});
