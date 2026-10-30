// Deployment contract checks that need no npm dependencies, Docker or
// PostgreSQL: healthcheck behaviour, image/compose/Caddy invariants and
// absence of secrets in templates.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const HEALTHCHECK = path.join(ROOT, "backend", "scripts", "healthcheck.js");

function runHealthcheck(port) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [HEALTHCHECK], {
      env: { PATH: process.env.PATH, PORT: String(port) },
      stdio: "ignore"
    });
    child.on("exit", code => resolve(code));
  });
}

async function withStub(status, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, method: req.method, headers: req.headers });
    res.writeHead(status, { "content-type": "application/json" }).end("{}");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    return { code: await fn(server.address().port), seen };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe("container healthcheck script", () => {
  test("probes GET /readyz on loopback without credentials; 200 -> exit 0", async () => {
    const { code, seen } = await withStub(200, runHealthcheck);
    assert.equal(code, 0);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, "GET");
    assert.equal(seen[0].url, "/readyz");
    assert.equal(seen[0].headers.authorization, undefined);
  });

  test("503 -> exit 1", async () => {
    assert.equal((await withStub(503, runHealthcheck)).code, 1);
  });

  test("401 (auth wrongly in front of /readyz) -> exit 1", async () => {
    assert.equal((await withStub(401, runHealthcheck)).code, 1);
  });

  test("nothing listening -> exit 1", async () => {
    const port = await new Promise(resolve => {
      const s = http.createServer().listen(0, "127.0.0.1", () => {
        const p = s.address().port;
        s.close(() => resolve(p));
      });
    });
    assert.equal(await runHealthcheck(port), 1);
  });
});

describe("app wiring", () => {
  test("health routes are registered before Basic auth", () => {
    const app = read("backend/app.js");
    const auth = app.indexOf("app.use(auth)");
    assert.ok(auth > 0);
    assert.ok(app.indexOf('app.get("/healthz"') < auth);
    assert.ok(app.indexOf('app.get("/readyz"') < auth);
    // liveness is exempt from the rate limiter, readiness is not
    assert.ok(app.indexOf('app.get("/healthz"') < app.indexOf("app.use(limiter)"));
    assert.ok(app.indexOf('app.get("/readyz"') > app.indexOf("app.use(limiter)"));
  });
});

describe("Dockerfile", () => {
  const dockerfile = read("Dockerfile");

  test("non-root runtime with readiness HEALTHCHECK", () => {
    assert.match(dockerfile, /^USER node$/m);
    assert.match(dockerfile, /HEALTHCHECK[\s\S]*CMD \["node", "backend\/scripts\/healthcheck\.js"\]/);
    assert.match(dockerfile, /^ENV NODE_ENV=production/m);
  });

  test("reproducible installs only; base image overridable for digest pinning", () => {
    assert.match(dockerfile, /^ARG NODE_IMAGE=node:24-/m);
    assert.doesNotMatch(dockerfile, /npm install/);
    assert.equal((dockerfile.match(/npm ci /g) || []).length, 2);
    assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts/);
  });

  test("build context is an allowlist that excludes env files", () => {
    const ignore = read(".dockerignore").split("\n").filter(l => l && !l.startsWith("#"));
    assert.equal(ignore[0], "*");
    assert.ok(ignore.every(l => !/env/.test(l)));
  });
});

describe("production compose", () => {
  const compose = read("deploy/compose.yaml");

  test("image must be supplied explicitly (digest per release)", () => {
    assert.match(compose, /image: \$\{APP_IMAGE:\?/);
    assert.doesNotMatch(compose, /^\s+build:/m);
  });

  test("hardening and least privilege", () => {
    assert.match(compose, /read_only: true/);
    assert.match(compose, /cap_drop: \[ALL\]/);
    assert.match(compose, /no-new-privileges:true/);
    assert.match(compose, /user: "1000:1000"/);
    assert.doesNotMatch(compose, /privileged|network_mode: host|docker\.sock/);
    assert.doesNotMatch(compose, /^\s+volumes:/m, "no data volume: state lives in PostgreSQL");
  });

  test("only loopback port publishing, matching the Caddy upstream", () => {
    const ports = [...compose.matchAll(/^\s+- "([^"]+:\d+)"$/gm)].map(m => m[1]);
    assert.deepEqual(ports, ["127.0.0.1:${APP_PORT:-3100}:3000"]);
    assert.match(read("deploy/Caddyfile.example"), /reverse_proxy 127\.0\.0\.1:3100/);
  });

  test("app health check uses the same contract as the image", () => {
    assert.match(compose, /test: \["CMD", "node", "backend\/scripts\/healthcheck\.js"\]/);
    assert.match(compose, /condition: service_completed_successfully/);
  });
});

describe("Caddy reference", () => {
  const caddy = read("deploy/Caddyfile.example");

  test("active health check uses /readyz but it is not served publicly", () => {
    assert.match(caddy, /health_uri \/readyz/);
    assert.match(caddy, /respond \/readyz 404/);
    assert.doesNotMatch(caddy, /basic_?auth/i, "auth is enforced by the app, not bypassed or duplicated here");
  });
});

describe("templates contain no secrets", () => {
  const SECRET_KEYS = /^(AUTH_PASSWORD_HASH|DATABASE_URL|MIGRATION_DATABASE_URL|AUTH_USERNAME)=(.*)$/gm;

  for (const file of ["deploy/app.env.example", "deploy/migrate.env.example", "backend/.env.example"]) {
    test(file, () => {
      for (const [, key, value] of read(file).matchAll(SECRET_KEYS)) {
        if (key === "AUTH_USERNAME") {
          assert.equal(value, "CHANGE_ME", key);
        } else if (key === "AUTH_PASSWORD_HASH") {
          assert.equal(value, "scrypt:32768:8:1:CHANGE_ME:CHANGE_ME", key);
        } else {
          assert.match(value, /^postgres:\/\/[a-z_]+:CHANGE_ME@/, key);
        }
      }
    });
  }

  test("db roles template uses placeholders", () => {
    const sql = read("deploy/db-roles.sql.example");
    for (const [, pw] of sql.matchAll(/PASSWORD '([^']*)'/g)) {
      assert.match(pw, /^CHANGE_ME/);
    }
  });
});
