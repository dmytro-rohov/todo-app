const {test}=require('node:test');
const assert=require('node:assert/strict');
const {moveTask}=require('../ordering');
const rows=[{id:1,status:'todo',position:0},{id:2,status:'todo',position:1}];
function fake(){const calls=[];return {calls,connect:async()=>({query:async(sql,args)=>{calls.push([sql,args]);return {rows};},release(){calls.push(['release']);}})};}
test('move to empty column commits both lists with dense ordering',async()=>{const pool=fake();assert.equal((await moveTask(pool,{id:1,status:'done',beforeId:null,expected:rows})).status,200);assert.ok(pool.calls.some(([sql,args])=>sql.startsWith('UPDATE')&&args[0]==='done'&&args[2]===1));assert.ok(pool.calls.some(([sql])=>sql==='COMMIT'));});
test('stale snapshot rolls back without writes',async()=>{const pool=fake();assert.equal((await moveTask(pool,{id:1,status:'done',beforeId:null,expected:[]})).status,409);assert.ok(!pool.calls.some(([s])=>s.startsWith('UPDATE')));});
test('same-column move precedes target',async()=>{const pool=fake();assert.equal((await moveTask(pool,{id:2,status:'todo',beforeId:1,expected:rows})).status,200);assert.deepEqual(pool.calls.filter(([s])=>s.startsWith('UPDATE')).map(([,a])=>a[2]),[2,1]);});
test('duplicate snapshot ids rejected before connecting',async()=>{assert.equal((await moveTask({}, {id:1,status:'todo',beforeId:null,expected:[rows[0],rows[0]]})).status,400);});
