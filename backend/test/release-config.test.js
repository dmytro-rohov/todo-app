// Release configuration for https://tasks.mytko.dev: production templates and
// the read-only deploy/check-env.cjs pre-deploy check. No Docker or database.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const CHECK = path.join(ROOT, "deploy", "check-env.cjs");
const { checkFiles, parseEnvFile, PUBLIC_ORIGIN } = require(CHECK);

const APP_PW = "a".repeat(32);
const OWNER_PW = "b".repeat(32);
const HASH = "scrypt:32768:8:1:c2FsdHNhbHRzYWx0c2FsdA==:aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g=";

function appEnv(overrides = {}) {
  return {
    NODE_ENV: "production", PORT: "3000", HOST: "0.0.0.0",
    DATABASE_URL: `postgres://tasks_app:${APP_PW}@host.docker.internal:5432/tasks?sslmode=disable`,
    PUBLIC_ORIGIN: "https://tasks.mytko.dev", TRUST_PROXY: "loopback,172.18.0.1/32",
    AUTH_USERNAME: "dima", AUTH_PASSWORD_HASH: HASH, ...overrides
  };
}
function migrateEnv(overrides = {}) {
  return {
    NODE_ENV: "production", APP_DB_ROLE: "tasks_app",
    MIGRATION_DATABASE_URL: `postgres://tasks_owner:${OWNER_PW}@host.docker.internal:5432/tasks?sslmode=disable`, ...overrides
  };
}
function write(values, mode = 0o600) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tasks-env-"));
  const file = path.join(dir, "x.env");
  fs.writeFileSync(file, Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  fs.chmodSync(file, mode);
  return file;
}
function failed(app = appEnv(), migrate = migrateEnv(), modes = [0o600, 0o600]) {
  return checkFiles(write(app, modes[0]), write(migrate, modes[1])).filter(r => !r.ok).map(r => r.name);
}

describe("production templates target tasks.mytko.dev", () => {
  test("origin, Caddy site and compose comments use the new domain only", () => {
    assert.equal(PUBLIC_ORIGIN, "https://tasks.mytko.dev");
    assert.match(read("deploy/app.env.example"), /^PUBLIC_ORIGIN=https:\/\/tasks\.mytko\.dev$/m);
    assert.match(read("deploy/Caddyfile.example"), /^tasks\.mytko\.dev \{$/m);
    for (const file of ["deploy/app.env.example", "deploy/Caddyfile.example", "deploy/compose.yaml", "docs/PRODUCTION.md"]) {
      assert.doesNotMatch(read(file), /(?<!s)\btask\.mytko\.dev/, `${file} still names task.mytko.dev`);
    }
  });

  test("runbook covers the release checks for the new domain", () => {
    const doc = read("docs/PRODUCTION.md");
    for (const needle of ["node deploy/check-env.cjs deploy/app.env deploy/migrate.env", "TRUST_PROXY=loopback,<gateway>/32",
      "003_kanban", "PostgreSQL 17", "curl -sI https://tasks.mytko.dev/"]) {
      assert.ok(doc.includes(needle), needle);
    }
  });

  test("database roles are dedicated and unprivileged", () => {
    const sql = read("deploy/db-roles.sql.example");
    for (const role of ["tasks_owner", "tasks_app"]) {
      assert.match(sql, new RegExp(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`));
    }
    assert.match(sql, /password_encryption = 'scram-sha-256'/);
    assert.match(sql, /REVOKE ALL ON DATABASE tasks FROM PUBLIC/);
  });

  test("the image build context still excludes deploy configuration and env files", () => {
    const ignore = read(".dockerignore").split("\n").filter(l => l.startsWith("!"));
    assert.ok(ignore.every(l => !/deploy|env|docs/.test(l)), "deploy/docs never enter the image");
  });
});

describe("deploy/check-env.cjs", () => {
  test("a complete production configuration passes", () => {
    assert.deepEqual(failed(), []);
  });

  test("the template files fail (placeholders and wrong permissions are caught)", () => {
    const names = checkFiles(path.join(ROOT, "deploy", "app.env.example"), path.join(ROOT, "deploy", "migrate.env.example"))
      .filter(r => !r.ok).map(r => r.name);
    assert.ok(names.includes("no CHANGE_ME placeholders remain"));
  });

  const cases = [
    ["old domain", { app: { PUBLIC_ORIGIN: "https://task.mytko.dev" } }, "PUBLIC_ORIGIN is exactly https://tasks.mytko.dev"],
    ["origin with path", { app: { PUBLIC_ORIGIN: "https://tasks.mytko.dev/" } }, "application accepts app.env (production loadConfig)"],
    ["development mode", { app: { NODE_ENV: "development" } }, "NODE_ENV=production in both files and AUTH_DISABLED unset"],
    ["auth disabled", { app: { AUTH_DISABLED: "true" } }, "NODE_ENV=production in both files and AUTH_DISABLED unset"],
    ["broad proxy trust", { app: { TRUST_PROXY: "loopback,172.16.0.0/12" } }, "TRUST_PROXY is loopback plus at most the Docker bridge gateway as /32"],
    ["public proxy peer", { app: { TRUST_PROXY: "loopback,8.8.8.8/32" } }, "TRUST_PROXY is loopback plus at most the Docker bridge gateway as /32"],
    ["weak scrypt", { app: { AUTH_PASSWORD_HASH: HASH.replace(":32768:", ":1024:") } }, "AUTH_PASSWORD_HASH is scrypt with N >= 16384"],
    ["default username", { app: { AUTH_USERNAME: "admin" } }, "AUTH_USERNAME is set and is not a default"],
    ["superuser for the app", { app: { DATABASE_URL: `postgres://postgres:${APP_PW}@host.docker.internal:5432/tasks?sslmode=disable` } }, "DATABASE_URL uses role tasks_app on database tasks"],
    ["superuser for migrations", { migrate: { MIGRATION_DATABASE_URL: `postgres://postgres:${OWNER_PW}@host.docker.internal:5432/tasks?sslmode=disable` } }, "MIGRATION_DATABASE_URL uses role tasks_owner on the same host/port/database"],
    ["other project's database", { migrate: { MIGRATION_DATABASE_URL: `postgres://tasks_owner:${OWNER_PW}@host.docker.internal:5432/other?sslmode=disable` } }, "MIGRATION_DATABASE_URL uses role tasks_owner on the same host/port/database"],
    ["wrong grant target", { migrate: { APP_DB_ROLE: "postgres" } }, "APP_DB_ROLE=tasks_app"],
    ["short password", { app: { DATABASE_URL: "postgres://tasks_app:short@host.docker.internal:5432/tasks?sslmode=disable" } }, "database passwords are at least 24 characters and differ between roles"],
    ["shared password", { migrate: { MIGRATION_DATABASE_URL: `postgres://tasks_owner:${APP_PW}@host.docker.internal:5432/tasks?sslmode=disable` } }, "database passwords are at least 24 characters and differ between roles"],
    ["unescaped $", { app: { DATABASE_URL: `postgres://tasks_app:${APP_PW}$x@host.docker.internal:5432/tasks?sslmode=disable` } }, "database passwords contain no unescaped $ (Compose interpolation)"],
    ["implicit sslmode", { app: { DATABASE_URL: `postgres://tasks_app:${APP_PW}@host.docker.internal:5432/tasks` } }, "sslmode is explicit; disable only for a host-local or private PostgreSQL"],
    ["plaintext to a public host", { app: { DATABASE_URL: `postgres://tasks_app:${APP_PW}@db.example.com:5432/tasks?sslmode=disable` },
      migrate: { MIGRATION_DATABASE_URL: `postgres://tasks_owner:${OWNER_PW}@db.example.com:5432/tasks?sslmode=disable` } }, "sslmode is explicit; disable only for a host-local or private PostgreSQL"]
  ];
  for (const [label, change, expected] of cases) {
    test(`rejects ${label}`, () => {
      assert.ok(failed(appEnv(change.app), migrateEnv(change.migrate)).includes(expected), expected);
    });
  }

  test("TLS to a remote PostgreSQL passes with sslmode=require", () => {
    assert.deepEqual(failed(
      appEnv({ DATABASE_URL: `postgres://tasks_app:${APP_PW}@db.example.com:5432/tasks?sslmode=require` }),
      migrateEnv({ MIGRATION_DATABASE_URL: `postgres://tasks_owner:${OWNER_PW}@db.example.com:5432/tasks?sslmode=require` })
    ), []);
  });

  test("escaped $$ in a password is accepted", () => {
    assert.deepEqual(failed(appEnv({ DATABASE_URL: `postgres://tasks_app:${APP_PW}$$x@host.docker.internal:5432/tasks?sslmode=disable` })), []);
  });

  test("group/world-readable env files are rejected", () => {
    assert.ok(failed(appEnv(), migrateEnv(), [0o640, 0o600]).includes("app.env is a private regular file (mode 600, owned by operator or root)"));
    assert.ok(failed(appEnv(), migrateEnv(), [0o600, 0o644]).includes("migrate.env is a private regular file (mode 600, owned by operator or root)"));
  });

  test("CLI prints check names only, never secret values, and exits non-zero on failure", () => {
    const ok = spawnSync(process.execPath, [CHECK, write(appEnv()), write(migrateEnv())], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stdout);
    assert.match(ok.stdout, /^PASS \d+\/\d+ checks$/m);
    const bad = spawnSync(process.execPath, [CHECK, write(appEnv({ PUBLIC_ORIGIN: "https://task.mytko.dev" })), write(migrateEnv())], { encoding: "utf8" });
    assert.equal(bad.status, 1);
    for (const out of [ok.stdout + ok.stderr, bad.stdout + bad.stderr]) {
      for (const secret of [APP_PW, OWNER_PW, "c2FsdHNhbHRzYWx0c2FsdA==", "dima"]) assert.ok(!out.includes(secret), "secret leaked");
    }
  });

  test("env parser handles comments, blank lines and quotes", () => {
    assert.deepEqual(parseEnvFile("# c\n\nA=1\nB=\"two words\"\nC='x'\n"), { A: "1", B: "two words", C: "x" });
    assert.throws(() => parseEnvFile("NOT_AN_ASSIGNMENT\n"));
  });
});
