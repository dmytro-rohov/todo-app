const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {spawnSync}=require('node:child_process');const path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,n),'utf8');
test('restore targets dedicated DB only',()=>{const s=read('smoke.sh');for(const line of s.split('\n').filter(l=>l.includes('pg_restore')&&!l.includes('--version')))assert.ok(line.includes('-d tasks_restore_test'));assert.ok(s.includes('cmp "$WORK/source-before.json" "$WORK/source-after.json"'));});
test('approval gate blocks before Docker',()=>{const r=spawnSync('bash',[path.join(__dirname,'acceptance.sh')],{env:{PATH:process.env.PATH},encoding:'utf8'});assert.equal(r.status,2);assert.match(r.stderr,/approval required/);});
test('all package shell scripts parse',()=>{for(const n of ['smoke.sh','acceptance.sh'])assert.equal(spawnSync('bash',['-n',path.join(__dirname,n)]).status,0);});
test('inspect redaction never persists env or command secrets',()=>{
 const payload=JSON.stringify([{Id:'x',Config:{Env:['PASSWORD=private'],Cmd:['private'],Labels:{}}}]);
 const r=spawnSync('python3',[path.join(__dirname,'redact.py')],{input:payload,encoding:'utf8'});assert.equal(r.status,0);assert.ok(!r.stdout.includes('private'));
});
test('approved platform image refs are exact',()=>{
 const env=read('images.env');assert.match(env,/node@sha256:a43f7fc3/);assert.match(env,/postgres@sha256:e4cb9368/);
 assert.doesNotMatch(env,/:latest/);
});
test('browser auth rejects defaults and accepts approved random handoff',()=>{
 const {credentials}=require('./browser/auth.cjs');
 for(const env of [{},{TASKS_DISPOSABLE_APPROVED:'yes',AUTH_PASSWORD:'test-only-password'}])assert.throws(()=>credentials(env));
 assert.equal(credentials({TASKS_DISPOSABLE_APPROVED:'yes',AUTH_PASSWORD:'a'.repeat(64)}).password.length,64);
});
test('cleanup refuses non-atomic Docker removal',()=>{
 const script=read('smoke.sh');assert.ok(script.includes('Automatic Docker cleanup refused')); assert.ok(script.includes('ownership.py'));
 assert.doesNotMatch(script,/"\$\{COMPOSE\[@\]\}" down/);
 assert.doesNotMatch(script,/docker (?:system|volume) prune/);
});
test('db-only execute refuses without approval before invoking Docker',()=>{
 const r=spawnSync('python3',[path.join(__dirname,'db-only'),'execute'],{env:{PATH:process.env.PATH,SOURCE_DIR:process.cwd()},encoding:'utf8'});assert.equal(r.status,1);assert.match(r.stderr,/ValueError/);
});
test('db-only never pulls or automatically removes Docker resources',()=>{
 const code=read('db-only');assert.ok(code.includes('--pull=never'));assert.ok(!code.includes("'docker','pull'"));assert.ok(!code.includes("'docker','rm'"));assert.ok(!code.includes('prune'));assert.ok(code.includes('tasks_restore_test'));
});
test('private fixtures never embed auth password or mount generated init SQL',()=>{
 const script=read('smoke.sh');
 assert.doesNotMatch(script,/chmod a\+|os\.environ\['AUTH_PASSWORD'\]/);
 assert.ok(script.includes('--user "$HELPER_USER"'));
 assert.ok(script.includes('--env AUTH_PASSWORD'));
 assert.ok(script.includes('exec -T db psql -X'));
 assert.doesNotMatch(read('compose.test.yaml'),/docker-entrypoint-initdb/);
});
test('preflight does not require an application before it starts',()=>{
 const script=read('acceptance.sh');assert.doesNotMatch(script,/HTTP_BASE_required/);
});
