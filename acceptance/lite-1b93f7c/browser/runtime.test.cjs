'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const runtime = require('./runtime.cjs');
const { MANDATORY, INJECTED_RESOURCE_ERROR, summarize, main } = require('./run.cjs');

const ON = { MYTKO_PLAYWRIGHT: 'on' };
const PASSWORD = 'a'.repeat(64);

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-runtime-'));
  fs.chmodSync(dir, 0o700);
  return dir;
}

// Minimal fake central runtime: <root>/node_modules/{playwright,playwright-core}.
function fakeRuntime({ version = '1.61.0', coreVersion = version, chromiumVersion = '149.0.7827.55', main = 'index.js' } = {}) {
  const root = tempDir();
  const modules = path.join(root, 'node_modules');
  for (const [name, v] of [['playwright', version], ['playwright-core', coreVersion]]) {
    fs.mkdirSync(path.join(modules, name), { recursive: true, mode: 0o755 });
    fs.writeFileSync(path.join(modules, name, 'package.json'), JSON.stringify({ name, version: v, main }));
  }
  fs.chmodSync(modules, 0o755);
  fs.writeFileSync(path.join(modules, 'playwright', 'index.js'), `
    const browser = { closed: false, version: () => ${JSON.stringify(chromiumVersion)},
      newPage: async () => ({ goto: async () => {}, close: async () => {} }), close: async () => { browser.closed = true; } };
    module.exports = { chromium: { launched: [], launch: async (o) => { module.exports.chromium.launched.push(o); return browser; }, executablePath: () => '/opt/fake/chrome' }, browser };
  `);
  return root;
}

test('contract pins exact Playwright 1.61.0 / Chromium 149 and keeps the previous pin explicit', () => {
  assert.equal(runtime.CONTRACT.contract, 'MW-PLAYWRIGHT-01');
  assert.equal(runtime.CONTRACT.playwright.version, '1.61.0');
  assert.match(runtime.CONTRACT.playwright.version, /^\d+\.\d+\.\d+$/, 'exact version, not a range');
  assert.equal(runtime.CONTRACT.chromium.major, 149);
  assert.match(runtime.CONTRACT.compatibility.previousPin, /^1\.56\.1 /);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert.equal(pkg.devDependencies.playwright, '1.56.1', 'legacy pin is not silently rewritten');
  for (const file of ['run.cjs', 'runtime.cjs']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, file), 'utf8'), /require\(['"]playwright['"]\)/, `${file} must not resolve a project-local copy`);
  }
});

test('Playwright OFF, unset or unknown policy blocks the runner', () => {
  for (const env of [{}, { MYTKO_PLAYWRIGHT: 'off' }, { MYTKO_PLAYWRIGHT: 'ON' }, { MYTKO_PLAYWRIGHT: '1' }]) {
    assert.throws(() => runtime.checkPolicy(env), runtime.BlockedError);
  }
  runtime.checkPolicy(ON);
});

test('runtime check CLI exits 3 (BLOCKED) when policy is OFF', () => {
  const dir = tempDir();
  const r = spawnSync(process.execPath, [path.join(__dirname, 'runtime.cjs'), 'check', dir], { env: { PATH: process.env.PATH, MYTKO_PLAYWRIGHT: 'off' }, encoding: 'utf8' });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /BLOCKED browser runtime: Playwright is OFF/);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'browser-runtime.json'), 'utf8'));
  assert.equal(report.status, 'BLOCKED');
  assert.equal(fs.statSync(path.join(dir, 'browser-runtime.json')).mode & 0o777, 0o600);
});

test('resolver accepts only the exact central runtime', () => {
  const root = fakeRuntime();
  const resolved = runtime.resolveRuntime({ ...ON, MYTKO_PLAYWRIGHT_ROOT: root });
  assert.equal(resolved.version, '1.61.0');
  assert.equal(resolved.root, fs.realpathSync(root));
  assert.ok(resolved.entry.startsWith(path.join(fs.realpathSync(root), 'node_modules', 'playwright') + path.sep));
});

test('resolver blocks missing, relative, mismatched or project-local runtimes', () => {
  const blocked = (env, options) => assert.throws(() => runtime.resolveRuntime(env, options), runtime.BlockedError);
  blocked({});
  blocked({ MYTKO_PLAYWRIGHT_ROOT: 'relative/runtime' });
  blocked({ MYTKO_PLAYWRIGHT_ROOT: path.join(os.tmpdir(), 'does-not-exist-pw') });
  blocked({ MYTKO_PLAYWRIGHT_ROOT: fakeRuntime({ version: '1.56.1' }) });
  blocked({ MYTKO_PLAYWRIGHT_ROOT: fakeRuntime({ coreVersion: '1.60.0' }) });
  const root = fakeRuntime();
  blocked({ MYTKO_PLAYWRIGHT_ROOT: root }, { forbiddenRoots: [root] });
  blocked({ MYTKO_PLAYWRIGHT_ROOT: root }, { forbiddenRoots: [path.dirname(root)] });
});

test('resolver blocks writable, symlinked or escaping module layouts', () => {
  const writable = fakeRuntime();
  fs.chmodSync(path.join(writable, 'node_modules', 'playwright'), 0o777);
  assert.throws(() => runtime.resolveRuntime({ MYTKO_PLAYWRIGHT_ROOT: writable }), /group\/world-writable/);

  const linked = fakeRuntime();
  const elsewhere = fakeRuntime();
  fs.rmSync(path.join(linked, 'node_modules', 'playwright'), { recursive: true });
  fs.symlinkSync(path.join(elsewhere, 'node_modules', 'playwright'), path.join(linked, 'node_modules', 'playwright'));
  assert.throws(() => runtime.resolveRuntime({ MYTKO_PLAYWRIGHT_ROOT: linked }), /symlink/);

  const escaping = fakeRuntime({ main: '../../evil.js' });
  fs.writeFileSync(path.join(escaping, 'evil.js'), 'module.exports = {};');
  assert.throws(() => runtime.resolveRuntime({ MYTKO_PLAYWRIGHT_ROOT: escaping }), /outside the central runtime/);
});

test('Chromium launch check enforces the contract major and closes the browser', async () => {
  const pw = require(path.join(fakeRuntime(), 'node_modules', 'playwright', 'index.js'));
  const result = await runtime.checkChromium(pw.chromium);
  assert.equal(result.version, '149.0.7827.55');
  assert.equal(result.executablePath, '/opt/fake/chrome');
  assert.ok(pw.browser.closed);
  assert.deepEqual(pw.chromium.launched[0].args, ['--no-proxy-server']);

  const old = require(path.join(fakeRuntime({ chromiumVersion: '141.0.1' }), 'node_modules', 'playwright', 'index.js'));
  await assert.rejects(runtime.checkChromium(old.chromium), /does not match contract major 149/);
  assert.ok(old.browser.closed);

  await assert.rejects(runtime.checkChromium({ launch: async () => { throw new Error('missing libnss3\nmore'); } }), /Chromium failed to launch: missing libnss3$/);
});

test('prepare records version, Chromium and runtime root as evidence', async () => {
  const root = fakeRuntime();
  const { evidence } = await runtime.prepare({ ...ON, MYTKO_PLAYWRIGHT_ROOT: root });
  assert.equal(evidence.playwrightVersion, '1.61.0');
  assert.equal(evidence.chromiumVersion, '149.0.7827.55');
  assert.equal(evidence.runtimeRoot, fs.realpathSync(root));
  assert.equal(evidence.contract, 'MW-PLAYWRIGHT-01');
});

test('runner writes a BLOCKED summary instead of skipping when Playwright is OFF', async () => {
  const dir = tempDir();
  const code = await main({ TASKS_DISPOSABLE_APPROVED: 'yes', E2E_BASE: 'http://127.0.0.1:3101', AUTH_PASSWORD: PASSWORD, MYTKO_PLAYWRIGHT: 'off', BROWSER_EVIDENCE_DIR: dir });
  assert.equal(code, 3);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  assert.equal(summary.status, 'BLOCKED');
  assert.equal(summary.passed, 0);
  assert.equal(summary.total, MANDATORY.length);
  assert.ok(summary.scenarios.every(s => s.status === 'NOT_RUN'));
});

test('runner refuses non-loopback targets and default credentials before launching', async () => {
  await assert.rejects(main({ TASKS_DISPOSABLE_APPROVED: 'yes', E2E_BASE: 'https://task.mytko.dev', AUTH_PASSWORD: PASSWORD, ...ON }), runtime.BlockedError);
  await assert.rejects(main({ TASKS_DISPOSABLE_APPROVED: 'yes', E2E_BASE: 'http://127.0.0.1:3101', AUTH_PASSWORD: 'test-only-password', ...ON }), /Approved random auth handoff/);
});

test('mandatory scenarios cover the browser QA checklist for both viewports', () => {
  for (const name of ['anonymous_denied', 'anonymous_denied_wrong_password']) assert.ok(MANDATORY.includes(name));
  for (const viewport of ['desktop', 'mobile']) {
    for (const s of ['login_ok', 'assets_loaded', 'create_category_and_task', 'edit_task', 'move_between_columns', 'reload_persists', 'api_errors', 'console_clean']) {
      assert.ok(MANDATORY.includes(`${viewport}:${s}`), `${viewport}:${s}`);
    }
  }
});

test('summary is PASS only when every mandatory scenario passed', () => {
  const all = MANDATORY.map(name => ({ name, status: 'PASS' }));
  assert.equal(summarize(all, {}).status, 'PASS');
  assert.equal(summarize(all.slice(1), {}).status, 'FAIL');
  assert.equal(summarize(all.slice(1), {}).scenarios[0].status, 'NOT_RUN');
  assert.equal(summarize([...all.slice(1), { name: MANDATORY[0], status: 'FAIL' }], {}).status, 'FAIL');
});

test('console allowlist only covers failures the runner injects', () => {
  for (const text of ['Failed to load resource: the server responded with a status of 409 (Conflict)', 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)', 'Failed to load resource: net::ERR_FAILED']) {
    assert.match(text, INJECTED_RESOURCE_ERROR);
  }
  for (const text of ['Failed to load resource: the server responded with a status of 404 (Not Found)', 'Failed to load resource: the server responded with a status of 403 (Forbidden)', 'Uncaught TypeError: x is undefined', 'Refused to execute inline script']) {
    assert.doesNotMatch(text, INJECTED_RESOURCE_ERROR);
  }
});

// Regression (TASKS-LITE-RELEASE-01): on mobile the Kanban columns stack
// vertically, so the drop column is off-screen when the drag starts. The
// verified fix scrolls it into view while the pointer is down, resolves the
// coordinates afterwards and proves the column is under the pointer before
// release. Order matters; a stale pre-drag bounding box drops nowhere.
test('mobile drag scrolls the drop column into view and verifies the target before release', () => {
  const src = fs.readFileSync(path.join(__dirname, 'run.cjs'), 'utf8');
  const step = src.slice(src.indexOf("const handleLocator = anyCard(editedTitle).locator('[data-move]')"), src.indexOf("await cardIn('done', editedTitle).waitFor();"));
  assert.ok(step.length > 0, 'drag step present');
  const order = [
    'await handleLocator.scrollIntoViewIfNeeded();',
    'await page.mouse.down();',
    "await column('done').evaluate(el =>",
    "const destination = await column('done').boundingBox();",
    "document.elementFromPoint(x, y)?.closest('[data-column]')?.dataset.column",
    "assert.equal(target, 'done', 'drop target is visible under pointer');",
    'await page.mouse.move(x, y, { steps: 15 });',
    'await page.mouse.up();'
  ].map(needle => [needle, step.indexOf(needle)]);
  for (const [needle, at] of order) assert.ok(at >= 0, `missing: ${needle}`);
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1][1] < order[i][1], `order: ${order[i - 1][0]} before ${order[i][0]}`);
  assert.match(step, /scrollIntoView\(\{ block: 'center'/);
  assert.doesNotMatch(step, /page\.touchscreen|dispatchEvent|dragTo\(/, 'real mouse Pointer Events, not synthetic drag');
  assert.equal((src.match(/'mobile', width: 390, height: 844/g) || []).length, 1, 'mobile viewport still exercised');
});
