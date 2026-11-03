const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, fakePool, SAME_ORIGIN_JSON } = require('./support');
const { validateTaskPatch } = require('../task-domain');
const { withTaskLabels } = require('../task-labels');
const createDirectoryRouter = require('../routes/directories');

test('V2 directory CRUD is authenticated, validated, parameterized and CSRF protected',async()=>{
  for(const table of ['projects','assignees']) {
    const rows=[]; const calls=[];
    const pool=fakePool({[table]:(sql,p)=>{
      calls.push([sql,p]);
      if(sql.startsWith('INSERT')){const row={id:rows.length+1,name:p[0]};rows.push(row);return {rows:[row],rowCount:1};}
      if(sql.startsWith('UPDATE')){const row=rows.find(r=>r.id===p[1]);if(row)row.name=p[0];return {rows:row?[row]:[],rowCount:row?1:0};}
      if(sql.startsWith('DELETE')){const i=rows.findIndex(r=>r.id===p[0]);if(i>=0)rows.splice(i,1);return {rows:[],rowCount:i>=0?1:0};}
      return {rows:[...rows],rowCount:rows.length};
    }});
    const ctx=await startApp({pool});
    const call=(method,path='',body,extra={})=>ctx.request('/api/'+table+path,{method,headers:SAME_ORIGIN_JSON,...(body?{body:JSON.stringify(body)}:{}),...extra});
    try{
      assert.equal((await call('GET','',null,{auth:null})).status,401);
      assert.equal((await call('POST','',{name:'Entry'},{headers:{...SAME_ORIGIN_JSON,'sec-fetch-site':'cross-site'}})).status,403);
      for(const name of ['', 'a', 'x'.repeat(81), 5])assert.equal((await call('POST','',{name})).status,400);
      const name="A name'); DROP TABLE tasks; --";
      assert.equal((await call('POST','',{name})).status,201);
      assert.equal((await (await call('GET')).json())[0].name,name);
      assert.ok(calls.some(([sql,p])=>sql.includes('VALUES ($1)')&&p[0]===name));
      assert.equal((await call('PUT','/1',{name:'Updated'})).status,200);
      assert.equal((await call('PUT','/999',{name:'Missing'})).status,404);
      assert.equal((await call('DELETE','/bad')).status,400);
      assert.equal((await call('DELETE','/1')).status,200);
      assert.equal((await call('DELETE','/1')).status,404);
    }finally{await ctx.close();}
  }
  assert.throws(()=>createDirectoryRouter({},'tasks; DROP TABLE tasks'),/Unknown directory/);
});
test('V2 metadata validation keeps historical title independent and rejects invalid labels',()=>{
  assert.equal(validateTaskPatch({status:'needs_review',projectId:2,assigneeId:null}).error,undefined);
  assert.deepEqual(validateTaskPatch({labelIds:[3,4]}).value,{labelIds:[3,4],categoryId:3});
  assert.deepEqual(validateTaskPatch({labelIds:[]}).value,{labelIds:[],categoryId:null});
  for(const body of [{projectId:0},{assigneeId:-1},{labelIds:[1,1]},{labelIds:['1']},{labelIds:[-1]},{labelIds:[1],categoryId:2},{labelIds:Array.from({length:51},(_,i)=>i+1)}])assert.ok(validateTaskPatch(body).error);
});
test('task label replacement is atomic and rolls back task write if an additional label fails',async()=>{
  for(const fail of [false,true]){
    const calls=[];
    const client={async query(sql,p){calls.push([sql,p]);if(fail&&sql.startsWith('INSERT INTO task_labels'))throw Object.assign(new Error('bad label'),{code:'23503'});},release(){calls.push(['release']);}};
    const pool={connect:async()=>client};
    const write=async db=>{assert.equal(db,client);calls.push(['task write']);return {rows:[{id:7}],rowCount:1};};
    if(fail)await assert.rejects(()=>withTaskLabels(pool,[3,4],write),/bad label/);
    else assert.deepEqual((await withTaskLabels(pool,[3,4],write)).rows[0].labelIds,[3,4]);
    assert.ok(calls.some(([sql])=>sql===(fail?'ROLLBACK':'COMMIT')));
    assert.equal(calls.at(-1)[0],'release');
    assert.deepEqual(calls.find(([sql])=>sql.startsWith('DELETE FROM task_labels'))[1],[7]);
  }
});
test('task API supports review, metadata filters and assignment PATCH without revalidating titles',async()=>{
  const calls=[];
  const pool=fakePool({ 'UPDATE tasks':(sql,p)=>{calls.push([sql,p]);return {rows:[{id:1}],rowCount:1};}, 'SELECT':(sql,p)=>{calls.push([sql,p]);return {rows:[],rowCount:0};} });
  const ctx=await startApp({pool});
  try{
    const res=await ctx.request('/api/tasks?status=needs_review&projectId=2&assigneeId=3&categoryId=4');
    assert.equal(res.status,200);
    assert.ok(calls.some(([sql,p])=>sql.includes('EXISTS (SELECT 1 FROM task_labels')&&p.includes('2')&&p.includes('needs_review')));
    assert.equal((await ctx.request('/api/tasks?projectId=2%20OR%201=1')).status,400);
    const patch=await ctx.request('/api/tasks/1',{method:'PATCH',headers:SAME_ORIGIN_JSON,body:JSON.stringify({status:'needs_review',projectId:2,assigneeId:null})});
    assert.equal(patch.status,200);
    const [sql,p]=calls.find(([sql])=>sql.startsWith('UPDATE'));
    assert.ok(sql.includes('project_id = $')&&sql.includes('assignee_id = $')&&!sql.includes('title ='));
    assert.ok(p.includes(false),'needs_review is incomplete');
    assert.equal((await ctx.request('/api/me',{auth:null})).status,401);
    assert.equal((await (await ctx.request('/api/me')).json()).name,'owner');
  }finally{await ctx.close();}
});
