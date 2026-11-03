// Browser QA against the disposable loopback stack, using the central
// Workflow Playwright runtime (see runtime-contract.json). Writes screenshots,
// Playwright traces and summary.json. Exit codes: 0 PASS, 1 FAIL, 3 BLOCKED.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { credentials } = require('./auth.cjs');
const runtime = require('./runtime.cjs');

const BASE_PATTERN = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;
const VIEWPORTS = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }];
const PER_VIEWPORT = ['login_ok', 'assets_loaded', 'create_category_and_task', 'edit_task', 'move_between_columns',
  'reload_persists', 'api_errors', 'cleanup_data', 'console_clean'];
const MANDATORY = ['anonymous_denied', 'anonymous_denied_wrong_password', ...VIEWPORTS.flatMap(v => PER_VIEWPORT.map(s => `${v.name}:${s}`))];
// Console noise Chromium emits for responses this runner injects on purpose.
const INJECTED_RESOURCE_ERROR = /^Failed to load resource: (?:the server responded with a status of (?:400|409|500)|net::ERR_FAILED)/;

function evidenceDir(env) {
  const dir = env.BROWSER_EVIDENCE_DIR || (env.EVIDENCE_DIR ? path.join(env.EVIDENCE_DIR, 'browser') : fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-browser-')));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}

function createRecorder(dir) {
  const results = [];
  let shot = 0;
  async function screenshot(page, name) {
    const file = `${String(++shot).padStart(2, '0')}-${name.replace(/[^a-z0-9_-]/gi, '_')}.png`;
    await page.screenshot({ path: path.join(dir, file), fullPage: true });
    fs.chmodSync(path.join(dir, file), 0o600);
    return file;
  }
  async function scenario(name, page, fn) {
    const started = Date.now();
    try {
      await fn();
      results.push({ name, status: 'PASS', ms: Date.now() - started, screenshot: await screenshot(page, name) });
    } catch (error) {
      let file = null;
      try { file = await screenshot(page, `FAIL-${name}`); } catch { /* page may be gone */ }
      results.push({ name, status: 'FAIL', ms: Date.now() - started, error: String(error.message).split('\n')[0], screenshot: file });
      throw error;
    }
  }
  return { results, scenario };
}

function summarize(results, extra) {
  const byName = new Map(results.map(r => [r.name, r]));
  const scenarios = MANDATORY.map(name => byName.get(name) || { name, status: 'NOT_RUN' });
  const passed = scenarios.filter(s => s.status === 'PASS').length;
  return { status: passed === scenarios.length ? 'PASS' : 'FAIL', passed, total: scenarios.length, scenarios, ...extra };
}

async function anonymousDenied(browser, base, recorder) {
  let failure = null;
  for (const [label, httpCredentials] of [['anonymous', undefined], ['wrong password', { username: 'owner', password: 'wrong-password' }]]) {
    const context = await browser.newContext(httpCredentials ? { httpCredentials } : {});
    const page = await context.newPage();
    try {
      await recorder.scenario(label === 'anonymous' ? 'anonymous_denied' : 'anonymous_denied_wrong_password', page, async () => {
        const shell = await page.goto(base);
        assert.equal(shell.status(), 401, `${label}: app shell must be 401`);
        assert.equal(await page.locator('#new-task').count(), 0, `${label}: board must not render`);
        const api = await page.goto(`${base}/api/tasks`);
        assert.equal(api.status(), 401, `${label}: API must be 401`);
      });
    } catch (error) {
      failure = failure || error;
    } finally {
      await context.close();
    }
  }
  if (failure) throw failure;
}

async function viewportRun(browser, base, viewport, recorder, dir, httpCredentials) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, httpCredentials });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  let injected = 0;
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', r => failedRequests.push(`${r.method()} ${new URL(r.url()).pathname} ${r.failure()?.errorText}`));
  const step = (name, fn) => recorder.scenario(`${viewport.name}:${name}`, page, fn);
  const column = status => page.locator(`[data-column=${status}]`);
  const cardIn = (status, title) => column(status).locator('.board-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  const anyCard = title => page.locator('.board-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  const message = page.locator('#board-message');
  const categoryName = `QA category ${viewport.name}`;
  const renamedCategory = `${categoryName} updated`;
  const title = `QA task ${viewport.name}`;
  const editedTitle = `${title} edited`;

  try {
    await step('login_ok', async () => {
      const response = await page.goto(base);
      assert.equal(response.status(), 200);
      await page.getByRole('heading', { name: 'Mytko Tasks', level: 1 }).waitFor();
      await page.locator('#new-task').waitFor();
    });

    await step('assets_loaded', async () => {
      const assets = [];
      const listener = r => { const p = new URL(r.url()).pathname; if (p.startsWith('/dist/') || p.startsWith('/js/')) assets.push({ path: p, status: r.status(), type: r.headers()['content-type'] || '' }); };
      page.on('response', listener);
      await page.reload();
      await column('todo').waitFor();
      page.off('response', listener);
      const css = assets.find(a => a.path === '/dist/style.css');
      assert.ok(css && css.status === 200 && /text\/css/.test(css.type), 'compiled stylesheet served as CSS');
      for (const module of ['/js/main.js', '/js/board.js', '/js/api/http.js']) {
        const asset = assets.find(a => a.path === module);
        assert.ok(asset && asset.status === 200 && /javascript/.test(asset.type), `${module} served as JavaScript`);
      }
      assert.deepEqual(assets.filter(a => a.status >= 400), []);
      assert.ok(await page.evaluate(() => [...document.styleSheets].some(s => s.href && s.href.endsWith('/dist/style.css') && s.cssRules.length > 0)), 'stylesheet rules applied');
      assert.deepEqual(failedRequests, []);
    });

    await step('create_category_and_task', async () => {
      await page.getByText('Kategorie', { exact: true }).click();
      await page.locator('#category-form [name=name]').fill(categoryName);
      await page.locator('#category-form button').click();
      const row = page.locator('#category-list p').filter({ hasText: categoryName });
      await row.waitFor();
      assert.equal(await row.count(), 1);
      await row.getByRole('button', { name: 'Edytuj' }).click();
      await page.locator('#category-form [name=name]').fill(renamedCategory);
      await page.locator('#category-form button').click();
      await page.locator('#category-list p').filter({ hasText: renamedCategory }).waitFor();
      await page.locator('#new-task').click();
      await page.locator('#task-form [name=title]').fill(title);
      await page.locator('#task-form [name=categoryId]').selectOption({ label: renamedCategory });
      await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
      await cardIn('todo', title).waitFor();
      assert.equal(await anyCard(title).count(), 1, 'exactly one task created');
      assert.match(await cardIn('todo', title).innerText(), new RegExp(renamedCategory));
    });

    await step('edit_task', async () => {
      await anyCard(title).getByRole('button', { name: 'Edytuj' }).click();
      await page.locator('#task-form [name=title]').fill(editedTitle);
      await page.locator('#task-form [name=description]').fill('Edited by browser QA');
      await page.locator('#task-form [name=priority]').selectOption('P1');
      await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
      await cardIn('todo', editedTitle).waitFor();
      assert.equal(await anyCard(title).count(), 0, 'old title replaced');
      assert.match(await anyCard(editedTitle).innerText(), /Edited by browser QA[\s\S]*P1/);
    });

    await step('move_between_columns', async () => {
      await anyCard(editedTitle).locator('[data-move]').focus();
      await page.keyboard.press('ArrowRight');
      await cardIn('in_progress', editedTitle).waitFor();
    });

    await step('reload_persists', async () => {
      await page.reload();
      await cardIn('in_progress', editedTitle).waitFor();
      assert.equal(await anyCard(editedTitle).count(), 1);
      await page.locator('#category-list p').filter({ hasText: renamedCategory }).waitFor({ state: 'attached' });
    });

    await step('api_errors', async () => {
      // 409 on move: persisted column kept, conflict announced, no retry.
      let moveCalls = 0;
      await page.route('**/api/tasks/move', route => { moveCalls++; injected++; return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: 'QA conflict' }) }); }, { times: 1 });
      await anyCard(editedTitle).locator('[data-move]').focus();
      await page.keyboard.press('ArrowRight');
      await page.getByText('QA conflict', { exact: true }).waitFor();
      assert.equal(moveCalls, 1, 'conflicting move is not retried');
      assert.equal(await cardIn('in_progress', editedTitle).count(), 1);
      // 500 on refresh: message shown, rendered board preserved.
      await page.route('**/api/tasks', route => { injected++; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'QA server error' }) }); }, { times: 1 });
      await page.locator('#retry').click();
      await message.filter({ hasText: 'QA server error' }).waitFor();
      assert.equal(await cardIn('in_progress', editedTitle).count(), 1);
      // Network failure on refresh.
      await page.route('**/api/tasks', route => { injected++; return route.abort('failed'); }, { times: 1 });
      await page.locator('#retry').click();
      await message.filter({ hasText: /Brak połączenia z serwerem/ }).waitFor();
      // Validation error on save stays in the dialog.
      await page.route('**/api/tasks/*', route => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        injected++;
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'QA validation' }) });
      }, { times: 1 });
      await anyCard(editedTitle).getByRole('button', { name: 'Edytuj' }).click();
      await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
      await page.locator('#form-error').filter({ hasText: 'QA validation' }).waitFor();
      await page.locator('#cancel-task').click();
      // Recovery: a clean refresh clears the message.
      await page.locator('#retry').click();
      await page.waitForFunction(() => document.querySelector('#board-message').textContent === '');
      // Real mouse Pointer Events, same production handlers as touch pointers.
      const handle = await anyCard(editedTitle).locator('[data-move]').boundingBox();
      const destination = await column('done').boundingBox();
      assert.ok(handle && destination);
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(destination.x + destination.width / 2, destination.y + 10, { steps: 15 });
      await page.mouse.up();
      await cardIn('done', editedTitle).waitFor();
      await page.reload();
      await cardIn('done', editedTitle).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
    });

    await step('cleanup_data', async () => {
      page.once('dialog', d => d.accept());
      await anyCard(editedTitle).getByRole('button', { name: 'Edytuj' }).click();
      await page.getByRole('button', { name: 'Usuń', exact: true }).click();
      await anyCard(editedTitle).waitFor({ state: 'detached' });
      page.once('dialog', d => d.accept());
      await page.getByText('Kategorie', { exact: true }).click();
      await page.locator('#category-list p').filter({ hasText: renamedCategory }).getByRole('button', { name: 'Usuń' }).click();
      await page.locator('#category-list p').filter({ hasText: renamedCategory }).waitFor({ state: 'detached' });
    });

    await step('console_clean', async () => {
      assert.deepEqual(pageErrors, [], 'no uncaught page errors');
      const unexpected = consoleErrors.filter(text => !INJECTED_RESOURCE_ERROR.test(text));
      assert.deepEqual(unexpected, [], 'no unexpected console errors');
      assert.ok(consoleErrors.length <= injected, `console errors (${consoleErrors.length}) exceed injected failures (${injected})`);
    });
  } finally {
    runtime.writePrivate(path.join(dir, `console-${viewport.name}.json`), JSON.stringify({
      pageErrors, consoleErrors, failedRequests, injectedFailures: injected
    }, null, 2) + '\n');
    const trace = path.join(dir, `trace-${viewport.name}.zip`);
    await context.tracing.stop({ path: trace }).then(() => fs.chmodSync(trace, 0o600)).catch(() => {});
    await context.close();
  }
}

async function main(env = process.env) {
  if (env.TASKS_DISPOSABLE_APPROVED !== 'yes' || !BASE_PATTERN.test(env.E2E_BASE || '')) {
    throw new runtime.BlockedError('Disposable loopback acceptance target required');
  }
  const httpCredentials = credentials(env);
  const dir = evidenceDir(env);
  const recorder = createRecorder(dir);
  let runtimeEvidence = null;
  let failure = null;
  try {
    const { playwright, evidence } = await runtime.prepare(env, { forbiddenRoots: [env.SOURCE_DIR, path.resolve(__dirname, '..')] });
    runtimeEvidence = evidence;
    const browser = await playwright.chromium.launch(runtime.LAUNCH_OPTIONS).catch(error => {
      throw new runtime.BlockedError(`QA Chromium failed to launch: ${String(error.message).split('\n')[0]}`);
    });
    try {
      try { await anonymousDenied(browser, env.E2E_BASE, recorder); }
      catch (error) { failure = failure || error; }
      for (const viewport of VIEWPORTS) {
        try { await viewportRun(browser, env.E2E_BASE, viewport, recorder, dir, httpCredentials); }
        catch (error) { failure = failure || error; }
      }
    } finally {
      await browser.close();
    }
  } catch (error) {
    failure = failure || error;
  }
  const blocked = failure instanceof runtime.BlockedError;
  const summary = summarize(recorder.results, { runtime: runtimeEvidence, evidenceDir: dir, error: failure ? String(failure.message).split('\n')[0] : null,
    note: 'Traces contain this run\'s Basic credential; keep the evidence directory private until the stack is removed.' });
  if (blocked) summary.status = 'BLOCKED';
  runtime.writePrivate(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`browser QA ${summary.status}: ${summary.passed}/${summary.total} scenarios; evidence ${dir}`);
  for (const s of summary.scenarios.filter(s => s.status !== 'PASS')) console.log(`  ${s.status} ${s.name}${s.error ? `: ${s.error}` : ''}`);
  return summary.status === 'PASS' ? 0 : blocked ? runtime.BLOCKED_EXIT : 1;
}

module.exports = { MANDATORY, INJECTED_RESOURCE_ERROR, summarize, main };

if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    const blocked = error instanceof runtime.BlockedError;
    console.error(`${blocked ? 'BLOCKED' : 'FAIL'} browser QA: ${error.message}`);
    process.exitCode = blocked ? runtime.BLOCKED_EXIT : 1;
  });
}
