const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,n),'utf8');
test('acceptance overlays regression suite without changing image application',()=>{assert.ok(read('smoke.sh').includes('cp "$PACKAGE_DIR/integration.test.js"'));assert.ok(read('integration.test.js').includes("error.code === '23502'"));});
test('date assertions use PostgreSQL date formatting, not JS timezone conversion',()=>{const text=read('integration.test.js');assert.ok(text.includes("TO_CHAR(due_date, 'YYYY-MM-DD') AS due_date"));assert.ok(!text.includes('toISOString().slice'));});
test('browser execution is mandatory before success',()=>{const smoke=read('smoke.sh');assert.ok(smoke.indexOf('node "$PACKAGE_DIR/browser/run.cjs"')>0);assert.ok(smoke.indexOf('node "$PACKAGE_DIR/browser/run.cjs"')<smoke.indexOf('echo "smoke test passed"'));});
