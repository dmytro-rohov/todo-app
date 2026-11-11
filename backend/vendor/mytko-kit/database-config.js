// Configuration boundary: local environment today, approved Broker launcher later.
// No network access, provisioning or automatic credential discovery here.
//
// app: { id: "finance", envPrefix: "FINANCE" } — <PREFIX>_ENV picks dev/test/prod, <PREFIX>_TEST_DATABASE names a
// Workflow-provisioned DEV database that the tests may reset, and the connection is called "mytko-<id>-<environment>".
function loadDatabaseConfig(env = process.env, { app, migration = false } = {}) {
  if (!app || typeof app.envPrefix !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(app.envPrefix) || typeof app.id !== "string" || !app.id) throw new Error("loadDatabaseConfig needs the app ({ id, envPrefix })");
  const ENV = `${app.envPrefix}_ENV`;
  const TEST_DATABASE = `${app.envPrefix}_TEST_DATABASE`;
  const key = migration ? 'MIGRATION_DATABASE_URL' : 'DATABASE_URL';
  let url;
  try { url = new URL(env[key]); } catch { throw new Error(`${key} must be a PostgreSQL URL`); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || url.hash) throw new Error(`${key} must identify a PostgreSQL host and database`);
  const environment = env[ENV] || ({production:'prod',test:'test',development:'dev'}[env.NODE_ENV || 'development']);
  if (!['dev','test','prod'].includes(environment)) throw new Error(`${ENV} must be dev, test or prod`);
  if (env.NODE_ENV === 'production' && environment !== 'prod' && !['dev','test'].includes(env[ENV])) throw new Error('Invalid deployment environment');
  if (environment === 'test' && !testTargetAllowed(url, env[TEST_DATABASE])) throw new Error('Test database must be a dedicated local test target');
  // Reject libpq query overrides, including filesystem certificate/socket options.
  for (const key of url.searchParams.keys()) if (key !== 'sslmode') throw new Error('Unsupported PostgreSQL URL option');
  if (url.searchParams.getAll('sslmode').length > 1) throw new Error('Duplicate PostgreSQL sslmode');
  const tls = url.searchParams.get('sslmode');
  if (tls && !['disable','require','verify-ca','verify-full'].includes(tls)) throw new Error('Unsupported PostgreSQL sslmode');
  if (url.searchParams.has('host')) throw new Error('PostgreSQL host override is not allowed');
  function integer(key, fallback, min, max) {
    const value = env[key] === undefined || env[key] === '' ? fallback : Number(env[key]);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${key} is outside supported bounds`);
    return value;
  }
  return { connectionString: env[key], max: migration ? 1 : integer('PG_POOL_MAX',10,1,100),
    statementTimeoutMs: migration ? 0 : integer('PG_STATEMENT_TIMEOUT_MS',10000,1,300000),
    applicationName: `mytko-${app.id}-${environment}${migration ? '-migrate' : ''}` };
}
// A test run deletes and recreates every table, so its target must plainly be a test one: a local database with "test"
// in its name, or the project's own DEV/test database provisioned by Mytko Workflow on Fujitsu, named exactly in
// <PREFIX>_TEST_DATABASE (ending in _dev or _test, on a loopback or private address; production lives elsewhere).
const LOCAL_HOSTS = ['localhost','127.0.0.1','[::1]','db'];
function privateAddress(host) {
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)?.slice(1).map(Number);
  if (!parts || parts.some(part => part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
function testTargetAllowed(url, named) {
  let database;
  try { database = decodeURIComponent(url.pathname.slice(1)); } catch { return false; }
  const local = LOCAL_HOSTS.includes(url.hostname);
  if (local && /test/i.test(database)) return true;
  return Boolean(named) && named === database && /^[a-z0-9_]+_(dev|test)$/.test(database)
    && (local || privateAddress(url.hostname));
}
module.exports = { loadDatabaseConfig };
