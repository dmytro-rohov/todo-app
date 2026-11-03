#!/usr/bin/env node
// Read-only pre-deploy check of the filled-in production env files for
// https://tasks.mytko.dev. Reuses the application's own configuration
// validation and adds release rules. Prints check names only, never values.
//
//   node deploy/check-env.cjs deploy/app.env deploy/migrate.env
//
// Exit 0 when every check passes, 1 otherwise. Changes nothing.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { isIP } = require('node:net');

const PUBLIC_ORIGIN = 'https://tasks.mytko.dev';
const APP_ROLE = 'tasks_app';
const OWNER_ROLE = 'tasks_owner';
const DATABASE = 'tasks';
const MIN_DB_PASSWORD = 24;
const MIN_SCRYPT_N = 16384;
const LOCAL_DB_HOSTS = new Set(['host.docker.internal', 'localhost', '127.0.0.1', '::1']);

// Compose env_file syntax: KEY=VALUE, optional surrounding quotes, # comments.
function parseEnvFile(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) throw new Error('malformed line (expected KEY=VALUE)');
    let value = line.slice(eq + 1);
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    values[line.slice(0, eq)] = value;
  }
  return values;
}

function privateFile(file) {
  const stat = fs.lstatSync(file);
  const uid = typeof process.getuid === 'function' ? process.getuid() : stat.uid;
  return stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && (stat.uid === uid || stat.uid === 0);
}

function isPrivateHost(host) {
  if (LOCAL_DB_HOSTS.has(host)) return true;
  if (isIP(host) !== 4) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function dbUrl(value) {
  try { return new URL(value); } catch { return null; }
}

function checkFiles(appFile, migrateFile) {
  const results = [];
  const check = (name, fn) => {
    let ok = false;
    try { ok = fn() === true; } catch { ok = false; }
    results.push({ name, ok });
  };

  check('app.env is a private regular file (mode 600, owned by operator or root)', () => privateFile(appFile));
  check('migrate.env is a private regular file (mode 600, owned by operator or root)', () => privateFile(migrateFile));
  let app = {}, migrate = {};
  check('app.env parses', () => { app = parseEnvFile(fs.readFileSync(appFile, 'utf8')); return true; });
  check('migrate.env parses', () => { migrate = parseEnvFile(fs.readFileSync(migrateFile, 'utf8')); return true; });
  check('no CHANGE_ME placeholders remain', () => ![...Object.values(app), ...Object.values(migrate)].some(v => /CHANGE_ME/.test(v)));

  check('application accepts app.env (production loadConfig)', () => {
    const { loadConfig } = require(path.join(__dirname, '..', 'backend', 'config.js'));
    const config = loadConfig({ ...app });
    return config.isProduction && config.database.applicationName === 'mytko-tasks-prod';
  });
  check('migrator accepts migrate.env', () => {
    const { loadDatabaseConfig } = require(path.join(__dirname, '..', 'backend', 'database-config.js'));
    return Boolean(loadDatabaseConfig({ ...migrate }, { migration: true }));
  });
  check(`PUBLIC_ORIGIN is exactly ${PUBLIC_ORIGIN}`, () => app.PUBLIC_ORIGIN === PUBLIC_ORIGIN);
  check('NODE_ENV=production in both files and AUTH_DISABLED unset', () =>
    app.NODE_ENV === 'production' && migrate.NODE_ENV === 'production' && app.AUTH_DISABLED === undefined);
  check('container listens on 0.0.0.0:3000 (published only on host loopback by compose)', () =>
    (app.HOST ?? '0.0.0.0') === '0.0.0.0' && (app.PORT ?? '3000') === '3000');
  check(`TRUST_PROXY is loopback plus at most the Docker bridge gateway as /32`, () => {
    const peers = (app.TRUST_PROXY || '').split(',').map(p => p.trim());
    return peers[0] === 'loopback' && peers.length <= 2 &&
      peers.slice(1).every(p => /^\d+\.\d+\.\d+\.\d+\/32$/.test(p) && isPrivateHost(p.slice(0, -3)));
  });
  check(`AUTH_PASSWORD_HASH is scrypt with N >= ${MIN_SCRYPT_N}`, () => {
    const parts = (app.AUTH_PASSWORD_HASH || '').split(':');
    return parts.length === 6 && parts[0] === 'scrypt' && Number(parts[1]) >= MIN_SCRYPT_N;
  });
  check('AUTH_USERNAME is set and is not a default', () => Boolean(app.AUTH_USERNAME) && !/^(admin|root|owner|user|test)$/i.test(app.AUTH_USERNAME));

  const appUrl = dbUrl(app.DATABASE_URL);
  const ownerUrl = dbUrl(migrate.MIGRATION_DATABASE_URL);
  check(`DATABASE_URL uses role ${APP_ROLE} on database ${DATABASE}`, () => appUrl.username === APP_ROLE && appUrl.pathname === `/${DATABASE}`);
  check(`MIGRATION_DATABASE_URL uses role ${OWNER_ROLE} on the same host/port/database`, () =>
    ownerUrl.username === OWNER_ROLE && ownerUrl.hostname === appUrl.hostname && ownerUrl.port === appUrl.port && ownerUrl.pathname === appUrl.pathname);
  check(`APP_DB_ROLE=${APP_ROLE}`, () => migrate.APP_DB_ROLE === APP_ROLE);
  check(`database passwords are at least ${MIN_DB_PASSWORD} characters and differ between roles`, () => {
    const a = decodeURIComponent(appUrl.password), o = decodeURIComponent(ownerUrl.password);
    return a.length >= MIN_DB_PASSWORD && o.length >= MIN_DB_PASSWORD && a !== o;
  });
  check('database passwords contain no unescaped $ (Compose interpolation)', () =>
    ![appUrl.password, ownerUrl.password].some(p => /(^|[^$])\$([^$]|$)/.test(decodeURIComponent(p).replace(/\$\$/g, ''))));
  check('sslmode is explicit; disable only for a host-local or private PostgreSQL', () => [appUrl, ownerUrl].every(url => {
    const mode = url.searchParams.get('sslmode');
    if (!mode) return false;
    return mode !== 'disable' || isPrivateHost(url.hostname.replace(/^\[|\]$/g, ''));
  }));
  return results;
}

module.exports = { parseEnvFile, checkFiles, PUBLIC_ORIGIN };

if (require.main === module) {
  const [appFile, migrateFile] = process.argv.slice(2);
  if (!appFile || !migrateFile) {
    console.error('usage: node deploy/check-env.cjs deploy/app.env deploy/migrate.env');
    process.exit(2);
  }
  const results = checkFiles(appFile, migrateFile);
  for (const { name, ok } of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  const failed = results.filter(r => !r.ok).length;
  console.log(failed ? `FAIL ${failed}/${results.length} checks` : `PASS ${results.length}/${results.length} checks`);
  process.exit(failed ? 1 : 0);
}
