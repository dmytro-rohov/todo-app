const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const {moveTask}=require('../ordering');
test('real mid-move exception rolls back all prior row changes',{timeout:20000},async()=>{
 const owner=new Pool({connectionString:process.env.TEST_MIGRATION_DATABASE_URL,statement_timeout:5000});
 const app=new Pool({connectionString:process.env.TEST_DATABASE_URL,statement_timeout:5000});
 const url=new URL(process.env.TEST_DATABASE_URL);
 assert.equal(url.hostname,'db');assert.equal(url.pathname,'/tasks_test');
 try {
  await owner.query("DELETE FROM tasks");
  await owner.query("INSERT INTO tasks(title,date,status,position) VALUES ('Fault A',CURRENT_DATE,'todo',0),('Fault B',CURRENT_DATE,'todo',1)");
  const before=(await owner.query('SELECT id,status,position FROM tasks ORDER BY id')).rows;
  await owner.query("CREATE OR REPLACE FUNCTION acceptance_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title='Fault A' THEN RAISE EXCEPTION 'controlled fault' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$; CREATE TRIGGER acceptance_fault BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION acceptance_fault()");
  await assert.rejects(moveTask(app,{id:before[1].id,status:'todo',beforeId:before[0].id,expected:before.map(t=>({...t,position:Number(t.position)}))}),e=>e.code==='P0001');
  assert.deepEqual((await owner.query('SELECT id,status,position FROM tasks ORDER BY id')).rows,before);
 } finally {await owner.query('DROP TRIGGER IF EXISTS acceptance_fault ON tasks; DROP FUNCTION IF EXISTS acceptance_fault()');await app.end();await owner.end();}
});
test('real lock and statement timeouts report distinct SQLSTATE',{timeout:15000},async()=>{
 const url=new URL(process.env.TEST_MIGRATION_DATABASE_URL);assert.equal(url.hostname,'db');assert.equal(url.pathname,'/tasks_test');
 const pool=new Pool({connectionString:url.toString(),statement_timeout:5000});
 const a=await pool.connect(),b=await pool.connect();
 try {
  await a.query('BEGIN');await a.query('LOCK TABLE tasks IN ACCESS EXCLUSIVE MODE');
  await b.query("SET lock_timeout='100ms'");
  await assert.rejects(b.query('SELECT * FROM tasks'),e=>e.code==='55P03');
  await a.query('ROLLBACK');await b.query("SET statement_timeout='100ms'");
  await assert.rejects(b.query('SELECT pg_sleep(2)'),e=>e.code==='57014');
 }finally{await a.query('ROLLBACK');a.release();b.release();await pool.end();}
});
test('diagnostic deadlock produces 40P01, victim transaction rolls back',{timeout:15000},async()=>{
 const url=new URL(process.env.TEST_MIGRATION_DATABASE_URL);assert.equal(url.hostname,'db');assert.equal(url.pathname,'/tasks_test');
 const pool=new Pool({connectionString:url.toString(),statement_timeout:5000});const a=await pool.connect(),b=await pool.connect();
 try{
  await a.query('BEGIN');await b.query('BEGIN');
  await a.query('SELECT pg_advisory_xact_lock(90101)');await b.query('SELECT pg_advisory_xact_lock(90102)');
  const attempt=async(client,key)=>{try{await client.query('SELECT pg_advisory_xact_lock($1)',[key]);return 'ok';}catch(e){return e.code;}finally{await client.query('ROLLBACK');}};
  const results=await Promise.all([attempt(a,90102),attempt(b,90101)]);
  assert.deepEqual(results.sort(),['40P01','ok']);
 }finally{await a.query('ROLLBACK');await b.query('ROLLBACK');a.release();b.release();await pool.end();}
});
for(const mode of ['same-column','cross-column','opposite','same-task']) test(`HTTP concurrent ${mode} conflicts without losing tasks`,{timeout:20000},async()=>{
 const {startApp,SAME_ORIGIN_JSON}=require('./support');
 const url=new URL(process.env.TEST_DATABASE_URL);assert.equal(url.hostname,'db');assert.equal(url.pathname,'/tasks_test');
 const pool=new Pool({connectionString:url.toString(),statement_timeout:5000});
 const owner=new Pool({connectionString:process.env.TEST_MIGRATION_DATABASE_URL,statement_timeout:5000});let ctx;
 try{
  await owner.query('DELETE FROM tasks');
  await owner.query("INSERT INTO tasks(title,date,status,position) VALUES ('Concurrent A',CURRENT_DATE,'todo',0),('Concurrent B',CURRENT_DATE,'todo',1),('Concurrent C',CURRENT_DATE,'in_progress',0)");
  ctx=await startApp({pool});
  const snapshot=(await(await ctx.request('/api/tasks')).json()).map(({id,status,position})=>({id,status,position:Number(position)}));
  const a=snapshot.find(t=>t.status==='todo'), b=snapshot.find(t=>t.status==='in_progress');
  const first={id:a.id,status:mode==='same-column'?'todo':'in_progress',beforeId:null,expected:snapshot};
  const second={id:mode==='same-task'?a.id:b.id,status:mode==='same-task'?'done':'todo',beforeId:mode==='same-task'?null:a.id,expected:snapshot};
  const responses=await Promise.all([first,second].map(body=>ctx.request('/api/tasks/move',{method:'POST',headers:SAME_ORIGIN_JSON,body:JSON.stringify(body)})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const read=async()=>await(await ctx.request('/api/tasks')).json();const rows=await read();assert.deepEqual(await read(),rows);
  assert.equal(new Set(rows.map(t=>t.id)).size,3);
  for(const status of ['todo','in_progress','done'])assert.deepEqual(rows.filter(t=>t.status===status).map(t=>Number(t.position)).sort((a,b)=>a-b),rows.filter(t=>t.status===status).map((t,i)=>i));
 }finally{if(ctx)await ctx.close();await pool.end();await owner.end();}
});
