const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const source=process.env.SOURCE_DIR;const requireApp=require('node:module').createRequire(path.join(source,'backend/package.json'));
const {Pool}=requireApp('pg');const {runMigrations,listMigrations}=requireApp('./migrations');const {moveTask}=requireApp('./ordering');
if(!/^tasks-db-[a-f0-9]{24}$/.test(process.env.TASKS_DB_RUN||''))throw Error('Scoped runner required');
for(const key of ['TEST_DATABASE_URL','TEST_MIGRATION_DATABASE_URL']){const u=new URL(process.env[key]);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55432');assert.equal(u.pathname,'/tasks_test');}
const owner=new Pool({connectionString:process.env.TEST_MIGRATION_DATABASE_URL,statement_timeout:5000}),app=new Pool({connectionString:process.env.TEST_DATABASE_URL,statement_timeout:5000});
(async()=>{
 const dir=path.join(source,'backend/migrations'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tasks-migrations-'));
 try{
  assert.equal((await owner.query("SELECT current_setting('tasks.acceptance_run') AS run")).rows[0].run,process.env.TASKS_DB_RUN);
  assert.match((await owner.query('SHOW server_version')).rows[0].server_version,/^17\./);
  for(const name of ['001_baseline.sql','002_task_integrity.sql'])fs.copyFileSync(path.join(dir,name),path.join(tmp,name));
  await runMigrations(owner,{dir:tmp,appRole:'tasks_app',log:()=>{}});
  await owner.query("INSERT INTO tasks(title,completed,date) VALUES('Historical',true,'2020-01-01')");
  await runMigrations(owner,{dir,appRole:'tasks_app',log:()=>{}});assert.deepEqual(await runMigrations(owner,{dir,appRole:'tasks_app',log:()=>{}}),[]);
  const ledger=(await owner.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows;
  assert.deepEqual(ledger,listMigrations(dir).map(({version,checksum})=>({version,checksum})));
  const old=(await app.query('SELECT status,due_date::text FROM tasks')).rows[0];assert.equal(old.status,'done');assert.equal(old.due_date,'2020-01-01');
  const c=(await app.query("INSERT INTO categories(name,color) VALUES('Test','#112233') RETURNING id")).rows[0].id;
  await app.query("UPDATE categories SET name='Changed' WHERE id=$1",[c]);
  await app.query("INSERT INTO tasks(title,date,category_id,status,position) VALUES('Task A',CURRENT_DATE,$1,'todo',0),('Task B',CURRENT_DATE,$1,'todo',1)",[c]);
  await app.query('DELETE FROM categories WHERE id=$1',[c]);assert.equal((await app.query('SELECT count(*)::int AS n FROM tasks WHERE category_id IS NOT NULL')).rows[0].n,0);
  const editable=(await app.query("SELECT id FROM tasks WHERE title='Task A'")).rows[0].id;
  await app.query("UPDATE tasks SET priority='P0',due_date='2030-01-01',description='SQL CRUD',status='done' WHERE id=$1",[editable]);
  const updated=(await app.query('SELECT priority,due_date::text,status,completed_at FROM tasks WHERE id=$1',[editable])).rows[0];
  assert.equal(updated.priority,'P0');assert.equal(updated.due_date,'2030-01-01');assert.ok(updated.completed_at);
  await app.query("UPDATE tasks SET status='todo' WHERE id=$1",[editable]);assert.equal((await app.query('SELECT completed_at FROM tasks WHERE id=$1',[editable])).rows[0].completed_at,null);
  await app.query('DELETE FROM tasks WHERE id=$1',[editable]);assert.equal((await app.query('SELECT id FROM tasks WHERE id=$1',[editable])).rowCount,0);
  await assert.rejects(app.query('CREATE TABLE should_fail(id int)'),e=>e.code==='42501');
  const snapshot=async()=>(await app.query('SELECT id,status,position,completed_at,updated_at FROM tasks ORDER BY position,id')).rows.map(t=>({...t,position:Number(t.position)}));
  function check(rows,ids){
   assert.deepEqual(rows.map(t=>t.id).sort((a,b)=>a-b),ids.slice().sort((a,b)=>a-b));
   for(const status of ['todo','in_progress','done']) {
    const positions=rows.filter(t=>t.status===status).map(t=>t.position).sort((a,b)=>a-b);
    assert.deepEqual(positions,positions.map((_,i)=>i));
   }
  }
  for(let repeat=0;repeat<5;repeat++)for(const mode of ['same-column','different-columns','opposite','same-task']){
   await owner.query('DELETE FROM tasks');
   await owner.query("INSERT INTO tasks(title,date,status,position) VALUES ('A',CURRENT_DATE,'todo',0),('B',CURRENT_DATE,'todo',1),('C',CURRENT_DATE,'in_progress',0),('D',CURRENT_DATE,'in_progress',1)");
   const rows=await snapshot(),[a,b]=rows.filter(t=>t.status==='todo'),[c,d]=rows.filter(t=>t.status==='in_progress');
   const moves=mode==='same-column' ? [[a.id,'todo',null],[b.id,'todo',a.id]] : mode==='different-columns' ? [[a.id,'todo',null],[c.id,'in_progress',null]] : mode==='opposite' ? [[a.id,'in_progress',null],[c.id,'todo',null]] : [[a.id,'in_progress',null],[a.id,'done',null]];
   const result=await Promise.all(moves.map(([id,status,beforeId])=>moveTask(app,{id,status,beforeId,expected:rows})));
   assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);
   const final=await snapshot();check(final,rows.map(t=>t.id));assert.deepEqual(await snapshot(),final);
   assert.equal((await moveTask(app,{id:rows[0].id,status:'done',beforeId:null,expected:rows})).status,409);
   console.log('PASS concurrency',mode,repeat);
  }
  await owner.query('DELETE FROM tasks');
  await owner.query("INSERT INTO tasks(title,date,status,position) VALUES ('Rollback A',CURRENT_DATE,'todo',0),('Rollback B',CURRENT_DATE,'todo',1)");
  const before=await snapshot();
  await owner.query("CREATE FUNCTION db_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title='Rollback A' THEN RAISE EXCEPTION 'fault' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$; CREATE TRIGGER db_fault BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION db_fault()");
  await assert.rejects(moveTask(app,{id:before[1].id,status:'todo',beforeId:before[0].id,expected:before}),e=>e.code==='P0001');assert.deepEqual(await snapshot(),before);
  await owner.query('DROP TRIGGER db_fault ON tasks; DROP FUNCTION db_fault()');
  assert.equal((await app.query('SELECT 1 AS n')).rows[0].n,1);
  assert.equal((await moveTask(app,{id:before[1].id,status:'todo',beforeId:before[0].id,expected:before})).status,200);
  const a=await owner.connect(),b=await owner.connect();try{
   await a.query('BEGIN');await a.query('LOCK TABLE tasks IN ACCESS EXCLUSIVE MODE');await b.query("SET lock_timeout='50ms'");await assert.rejects(b.query('SELECT * FROM tasks'),e=>e.code==='55P03');await a.query('ROLLBACK');await b.query("SET statement_timeout='50ms'");await assert.rejects(b.query('SELECT pg_sleep(1)'),e=>e.code==='57014');
  }finally{await a.query('ROLLBACK');a.release();b.release();}
  const x=await owner.connect(),y=await owner.connect();
  try {
   for(const client of [x,y]) {await client.query("SET lock_timeout='4s'; SET statement_timeout='6s'");await client.query('BEGIN');}
   await x.query('SELECT pg_advisory_xact_lock(762401)');await y.query('SELECT pg_advisory_xact_lock(762402)');
   const blocked=async(client,key)=>{try {await client.query('SELECT pg_advisory_xact_lock($1)',[key]);return 'ok';}catch(e){return e.code;}finally{await client.query('ROLLBACK');}};
   assert.deepEqual((await Promise.all([blocked(x,762402),blocked(y,762401)])).sort(),['40P01','ok']);
   for(const key of [762401,762402]){assert.equal((await x.query('SELECT pg_try_advisory_xact_lock($1) AS ok',[key])).rows[0].ok,true);}
  }finally{await x.query('ROLLBACK');await y.query('ROLLBACK');x.release();y.release();}
  console.log('PASS diagnostic 40P01, rollback and released locks');
  console.log('PASS migrations/backfill/ledger/CRUD/roles/move/conflicts/rollback/55P03/57014');
 }finally{fs.rmSync(tmp,{recursive:true,force:true});await app.end();await owner.end();}
})().catch(()=>{console.error('FAIL database acceptance (details withheld)');process.exitCode=1;});
