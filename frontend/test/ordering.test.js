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
