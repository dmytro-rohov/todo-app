const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {spawnSync}=require('node:child_process');const path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,n),'utf8');
const packageFiles=['acceptance.sh','images.env','verify.py','compose.test.yaml','smoke.sh','browser/auth.cjs','browser/run.cjs','browser/package.json','browser/package-lock.json','browser/runtime-contract.json','browser/runtime.cjs','browser/runtime.test.cjs','browser/stack_check.py','browser/stack_check.test.py'];
test('restore targets dedicated DB only',()=>{const s=read('smoke.sh');for(const line of s.split('\n').filter(l=>l.includes('pg_restore')&&!l.includes('--version')))assert.ok(line.includes('-d tasks_restore_test'));assert.ok(s.includes('cmp "$WORK/source-before.json" "$WORK/source-after.json"'));});
test('approval gate blocks before Docker',()=>{const r=spawnSync('bash',[path.join(__dirname,'acceptance.sh')],{env:{PATH:process.env.PATH},encoding:'utf8'});assert.equal(r.status,2);assert.match(r.stderr,/approval required/);});
test('all package shell scripts parse',()=>{for(const n of ['smoke.sh','acceptance.sh'])assert.equal(spawnSync('bash',['-n',path.join(__dirname,n)]).status,0);});
test('RepoDigest normalization accepts only approved official aliases and exact digests',()=>{
 const script=path.join(__dirname,'acceptance.sh');
 const nodeDigest='sha256:a43f7fc3e52e87d12a905f46eea0275def84ca8f2981a5b53fed44d7fb398ee0';
 const pgDigest='sha256:e4cb93687b062cd25a0e8f672d85a7708235009d70d31f8a7698d9370092a9c4';
 const digest=nodeDigest;
 const check=(image,repoDigest,expected)=>{
  const r=spawnSync('bash',[script,'test-repo-digest',image,repoDigest],{encoding:'utf8'});
  assert.equal(r.status,expected?0:1,`${image} ${repoDigest}`);
 };
 for(const [image,repositories] of [
  ['docker.io/library/node@'+digest,['docker.io/library/node','node']],
  ['node@'+digest,['docker.io/library/node','node']],
  ['docker.io/library/postgres@'+pgDigest,['docker.io/library/postgres','postgres']],
  ['postgres@'+pgDigest,['docker.io/library/postgres','postgres']]
 ]) for(const repo of repositories) check(image,repo+'@'+image.split('@')[1],true);
 check('docker.io/library/node@'+digest,'docker.io/library/other@'+digest,false);
 check('docker.io/library/node@'+digest,'docker.io/library/node@'+'b'.repeat(64),false);
 check('docker.io/library/node@'+digest,'docker.io/library/node',false);
 check('docker.io/library/node@'+digest,'sha256:'+digest.slice(7),false);
 check('docker.io/library/ubuntu@'+digest,'ubuntu@'+digest,false);
});
test('inspect redaction never persists env or command secrets',()=>{
 const payload=JSON.stringify([{Id:'x',Config:{Env:['PASSWORD=private'],Cmd:['private'],Labels:{}}}]);
 const r=spawnSync('python3',[path.join(__dirname,'redact.py')],{input:payload,encoding:'utf8'});assert.equal(r.status,0);assert.ok(!r.stdout.includes('private'));
});
test('git archive contains every required acceptance file',()=>{
 const root=path.resolve(__dirname,'../..');
 const archive=spawnSync('git',['archive','--format=tar','HEAD','acceptance/lite-1b93f7c'],{cwd:root,encoding:'buffer'});
 assert.equal(archive.status,0,archive.stderr?.toString());
 const listing=spawnSync('tar',['-tf','-'],{input:archive.stdout,encoding:'utf8'});
 assert.equal(listing.status,0,listing.stderr);
 for(const file of packageFiles) assert.ok(listing.stdout.split('\n').includes(`acceptance/lite-1b93f7c/${file}`),file);
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
test('execute is local-only and runs browser before cleanup',()=>{
 const script=read('acceptance.sh');
 assert.doesNotMatch(script,/docker (?:pull|buildx imagetools)/);
 assert.match(script,/--pull=false/);
 const smoke=read('smoke.sh');
 assert.match(smoke,/browser\/run\.cjs/);
 assert.match(smoke,/AUTH_PASSWORD=\"\$AUTH_PASSWORD\"/);
 assert.match(smoke,/node \"\$PACKAGE_DIR\/browser\/run\.cjs\"/);
});
test('preflight does not require an application before it starts',()=>{
 const script=read('acceptance.sh');assert.doesNotMatch(script,/HTTP_BASE_required/);
});
test('disposable stack origin matches the loopback browser origin',()=>{
 const compose=read('compose.test.yaml');
 assert.match(compose,/PUBLIC_ORIGIN: "http:\/\/127\.0\.0\.1:\$\{TEST_APP_PORT:-3101\}"/);
 assert.match(read('smoke.sh'),/BASE="http:\/\/127\.0\.0\.1:\$\{TEST_APP_PORT:-3101\}"/);
});
test('full execute requires browser runtime before build and browser PASS after smoke',()=>{
 const s=read('acceptance.sh');
 const runtimeAt=s.indexOf('browser_runtime "$EVIDENCE_DIR"\nphase=execute');
 assert.ok(runtimeAt>0 && runtimeAt<s.indexOf('docker buildx build'),'Chromium check precedes build');
 assert.ok(s.indexOf('require_browser_pass',s.indexOf('smoke.sh" 2>&1'))>0,'browser PASS gate after smoke');
 assert.match(s,/\$code == 3 \]\] && status=BLOCKED/);
 assert.doesNotMatch(s,/Browser QA and independent security review remain required/);
});
test('preflight launches Chromium through the central runtime',()=>{
 const s=read('acceptance.sh');const pre=s.slice(s.indexOf('if [[ $MODE == preflight ]]; then\n'));
 assert.match(pre.slice(0,200),/browser_runtime\n/);
});
test('browser-only refuses without approval and never starts or removes Docker resources',()=>{
 const r=spawnSync('bash',[path.join(__dirname,'acceptance.sh'),'browser-only'],{env:{PATH:process.env.PATH},encoding:'utf8'});
 assert.equal(r.status,2);assert.match(r.stderr,/approval required/);
 const s=read('acceptance.sh');const only=s.slice(s.indexOf('if [[ $MODE == browser-only ]]'),s.indexOf('source "$PACKAGE_DIR/images.env"'));
 assert.match(only,/stack_check\.py/);assert.match(only,/Browser-only PASS is not full E2E/);
 assert.doesNotMatch(only,/docker compose|COMPOSE\[|docker (?:run|start|stop|rm|restart)|smoke\.sh/);
 for(const call of read('browser/stack_check.py').match(/(?<!def )docker\([^)]*\)/g))assert.match(call,/^docker\('(?:ps|container|image|port)'/,call);
});
test('browser evidence directory and loopback proxy bypass are passed to the runner',()=>{
 const smoke=read('smoke.sh');
 assert.match(smoke,/BROWSER_EVIDENCE_DIR="\$\{EVIDENCE_DIR:\+\$EVIDENCE_DIR\/browser\}"/);
 assert.match(smoke,/NO_PROXY=127\.0\.0\.1,localhost,::1/);
});
