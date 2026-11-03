// Operator-only: invoked inside the approved disposable Compose network.
const assert = require('node:assert/strict');
if(process.env.TASKS_DISPOSABLE_APPROVED!=='yes' || process.env.SMOKE_BASE!=='http://app:3000') throw Error('Approved disposable app target required');
const base=process.env.SMOKE_BASE;
const headers={authorization:'Basic '+Buffer.from('owner:test-only-password').toString('base64'),'content-type':'application/json','sec-fetch-site':'same-origin'};
async function call(path,method='GET',body){const res=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await res.json();assert.ok(res.ok,`${method} ${path}: ${res.status}`);return data;}
(async()=>{
  const created=await call('/api/tasks','POST',{title:'Release domain probe',date:'2026-10-31',description:'<script>literal</script>',priority:'P1',status:'todo',dueDate:null});
  try {
    await call(`/api/tasks/${created.id}`,'PATCH',{status:'in_progress',dueDate:'2026-11-12'});
    const snapshot=await call('/api/tasks');
    await call('/api/tasks/move','POST',{id:created.id,status:'done',beforeId:null,expected:snapshot.map(({id,status,position})=>({id,status,position:Number(position)}))});
    const filtered=await call('/api/tasks?status=done&priority=P1');
    const stored=filtered.find(t=>t.id===created.id);
    assert.equal(stored.dueDate,'2026-11-12');assert.ok(stored.completedAt);assert.equal(stored.description,'<script>literal</script>');
    await call(`/api/tasks/${created.id}`,'PATCH',{status:'todo',dueDate:null});
    const reopened=(await call('/api/tasks')).find(t=>t.id===created.id);
    assert.equal(reopened.completedAt,null);assert.equal(reopened.dueDate,null);
    console.log('Kanban domain/order smoke PASS; archive/attachments/cleanup NOT IMPLEMENTED');
  } finally {await call(`/api/tasks/${created.id}`,'DELETE');}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
