// Configuration boundary: local environment today, approved Broker launcher later.
// No network access, provisioning or automatic credential discovery here.
function loadDatabaseConfig(env = process.env, { migration = false } = {}) {
  const key = migration ? 'MIGRATION_DATABASE_URL' : 'DATABASE_URL';
  let url;
  try { url = new URL(env[key]); } catch { throw new Error(`${key} must be a PostgreSQL URL`); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || url.hash) throw new Error(`${key} must identify a PostgreSQL host and database`);
  const environment = env.TASKS_ENV || ({production:'prod',test:'test',development:'dev'}[env.NODE_ENV || 'development']);
  if (!['dev','test','prod'].includes(environment)) throw new Error('TASKS_ENV must be dev, test or prod');
  if (env.NODE_ENV === 'production' && environment !== 'prod' && !['dev','test'].includes(env.TASKS_ENV)) throw new Error('Invalid deployment environment');
  if (environment === 'test' && (!['localhost','127.0.0.1','[::1]','db'].includes(url.hostname) || !/test/i.test(url.pathname))) throw new Error('Test database must be a dedicated local test target');
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
    applicationName: `mytko-tasks-${environment}${migration ? '-migrate' : ''}` };
}
module.exports = { loadDatabaseConfig };
