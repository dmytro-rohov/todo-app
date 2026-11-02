// Resolves Playwright from the central Mytko Workflow runtime (MW-PLAYWRIGHT-01)
// and proves Chromium launches before any browser QA. Never falls back to a
// project-local copy. Exit codes: 0 PASS, 3 BLOCKED.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const CONTRACT = JSON.parse(fs.readFileSync(path.join(__dirname, 'runtime-contract.json'), 'utf8'));
const BLOCKED_EXIT = 3;

class BlockedError extends Error {
  constructor(message) { super(message); this.name = 'BlockedError'; }
}

function checkPolicy(env = process.env, contract = CONTRACT) {
  const value = env[contract.policy.env];
  if (value !== contract.policy.on) {
    throw new BlockedError(`Playwright is OFF by Workflow policy (${contract.policy.env}=${value === undefined ? '<unset>' : JSON.stringify(value)})`);
  }
}

// Owned by root or the runner user, not writable by group/others, not a symlink.
function assertTrusted(target, label) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new BlockedError(`${label} must not be a symlink`);
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  if (stat.uid !== 0 && stat.uid !== uid) throw new BlockedError(`${label} has an untrusted owner`);
  if (stat.mode & 0o022) throw new BlockedError(`${label} is group/world-writable`);
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveRuntime(env = process.env, { contract = CONTRACT, forbiddenRoots = [] } = {}) {
  const configured = env[contract.runtime.rootEnv];
  if (!configured) throw new BlockedError(`${contract.runtime.rootEnv} is not set`);
  if (!path.isAbsolute(configured)) throw new BlockedError(`${contract.runtime.rootEnv} must be an absolute path`);
  let root;
  try { root = fs.realpathSync(configured); } catch { throw new BlockedError(`${contract.runtime.rootEnv} does not exist`); }
  for (const forbidden of forbiddenRoots.filter(Boolean)) {
    const real = fs.existsSync(forbidden) ? fs.realpathSync(forbidden) : path.resolve(forbidden);
    if (root === real || isInside(root, real) || isInside(real, root)) {
      throw new BlockedError('central runtime must be outside the source checkout and acceptance package');
    }
  }
  const moduleDir = path.join(root, 'node_modules', contract.playwright.module);
  const coreDir = path.join(root, 'node_modules', 'playwright-core');
  for (const [target, label] of [[root, 'runtime root'], [path.join(root, 'node_modules'), 'runtime node_modules'], [moduleDir, 'playwright package'], [coreDir, 'playwright-core package']]) {
    if (!fs.existsSync(target)) throw new BlockedError(`${label} not found in central runtime`);
    assertTrusted(target, label);
  }
  let entry;
  try { entry = fs.realpathSync(require.resolve(contract.playwright.module, { paths: [root] })); }
  catch { throw new BlockedError('playwright cannot be resolved from the central runtime'); }
  if (!isInside(entry, moduleDir)) throw new BlockedError('playwright resolved outside the central runtime');
  const version = JSON.parse(fs.readFileSync(path.join(moduleDir, 'package.json'), 'utf8')).version;
  const coreVersion = JSON.parse(fs.readFileSync(path.join(coreDir, 'package.json'), 'utf8')).version;
  if (version !== contract.playwright.version || coreVersion !== contract.playwright.version) {
    throw new BlockedError(`playwright ${version} / playwright-core ${coreVersion} does not match contract ${contract.playwright.version}`);
  }
  return { root, entry, version };
}

// Loopback QA must never be routed through an inherited proxy.
const LAUNCH_OPTIONS = { headless: true, args: ['--no-proxy-server'] };

async function checkChromium(chromium, contract = CONTRACT) {
  let browser;
  try {
    browser = await chromium.launch(LAUNCH_OPTIONS);
  } catch (error) {
    throw new BlockedError(`Chromium failed to launch: ${String(error.message).split('\n')[0]}`);
  }
  try {
    const version = browser.version();
    const major = Number(String(version).split('.')[0]);
    if (major !== contract.chromium.major) {
      throw new BlockedError(`Chromium ${version} does not match contract major ${contract.chromium.major}`);
    }
    const page = await browser.newPage();
    await page.goto('about:blank');
    await page.close();
    return { version, executablePath: chromium.executablePath() };
  } finally {
    await browser.close();
  }
}

// Policy, resolution and a real launch; returns the loaded module and evidence.
async function prepare(env = process.env, options = {}) {
  checkPolicy(env, options.contract);
  const runtime = resolveRuntime(env, options);
  const playwright = require(runtime.entry);
  const chromium = await checkChromium(playwright.chromium, options.contract);
  return {
    playwright,
    evidence: {
      contract: CONTRACT.contract,
      playwrightVersion: runtime.version,
      runtimeRoot: runtime.root,
      chromiumVersion: chromium.version,
      chromiumExecutable: chromium.executablePath,
      node: process.version,
      checkedAt: new Date().toISOString()
    }
  };
}

function writePrivate(file, content) {
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

module.exports = { CONTRACT, BLOCKED_EXIT, BlockedError, LAUNCH_OPTIONS, checkPolicy, resolveRuntime, checkChromium, prepare, writePrivate };

if (require.main === module) {
  const [mode, evidenceDir] = process.argv.slice(2);
  if (mode !== 'check') {
    console.error('usage: runtime.cjs check [EVIDENCE_DIR]');
    process.exit(2);
  }
  const forbiddenRoots = [process.env.SOURCE_DIR, path.resolve(__dirname, '..')];
  prepare(process.env, { forbiddenRoots }).then(({ evidence }) => {
    const report = { status: 'PASS', ...evidence };
    if (evidenceDir) writePrivate(path.join(evidenceDir, 'browser-runtime.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  }).catch(error => {
    const blocked = error instanceof BlockedError;
    const report = { status: blocked ? 'BLOCKED' : 'FAIL', error: error.message, contract: CONTRACT.contract };
    if (evidenceDir) writePrivate(path.join(evidenceDir, 'browser-runtime.json'), JSON.stringify(report, null, 2) + '\n');
    console.error(`${report.status} browser runtime: ${error.message}`);
    process.exit(blocked ? BLOCKED_EXIT : 1);
  });
}
