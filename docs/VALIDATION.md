# MW-TASKS-VALIDATE-02 — executable operator checklist

Status: **NOT VALIDATED FOR RELEASE**. This procedure changes only an approved
throwaway checkout and disposable Docker resources on a trusted Fujitsu build
host. It does not deploy Tasks or modify production PostgreSQL, DNS or Caddy.
Never point TEST_* URLs at a real database: integration tests DROP tables.

## 1. Host and lockfile gate (operator)

Required: Bash, Git, Node 24/npm, trusted npm registry access, Docker daemon,
Compose v2, Buildx, curl, free loopback ports 3101 and 55432, space for images
and a database volume. Docker must be local (bind mounts use host paths).
No production env files, credentials or databases may be supplied.

Use a Mytko-provided checkout of the current Session branch. No branch creation,
reset, stash or direct push. First review existing modifications; do not overwrite.
Run these blocks from the repository root with Bash and stop at any failure.

```bash
set -euo pipefail
[[ $(git branch --show-current) == mytko/audit-foundation-afa14483 ]]
node --version
npm --version
docker info --format '{{.ServerVersion}}'
docker compose version
docker buildx version
command -v curl
# Stop if this reports existing containers; do not remove them.
[[ -z $(docker ps -q --filter publish=3101) ]]
[[ -z $(docker ps -q --filter publish=55432) ]]
```

The operator generated frontend/package-lock.json on Fujitsu with Node 24.21.0
and npm 11.19.0. It pins Sass 1.89.2; the RC review verified all 23 dependency
entries have integrity and registry.npmjs.org sources. Preserve this lockfile;
do not regenerate it during validation. The optional @parcel/watcher native
packages are platform-specific; lifecycle scripts remain disabled for installs.

```bash
node -e 'const p=require("./frontend/package-lock.json"); if(p.packages[""].devDependencies.sass!=="1.89.2" || p.packages["node_modules/sass"].version!=="1.89.2") process.exit(1)'
node -e 'const p=require("./frontend/package-lock.json"); for(const [n,v] of Object.entries(p.packages)) if(n && (!v.integrity || !v.resolved?.startsWith("https://registry.npmjs.org/"))) throw Error("Review dependency source: "+n)'
```

Do not repeat the sandbox's known 403 install. All installs below are operator-run
on the registry-enabled Fujitsu. The six baseline commits must remain ancestors.
Existing containers orhea-dev-db-1 and moto-training-platform-db-1 must never be
stopped, restarted, removed, attached to, or used for tests.

## 2. Freeze source, install, tests and security scan (operator)

```bash
set -euo pipefail
: "${EXPECTED_SOURCE_SHA:?set full reviewed commit SHA including frontend lockfile}"
[[ $(git rev-parse HEAD) == "$EXPECTED_SOURCE_SHA" ]]
[[ -z $(git status --porcelain) ]]
test -f frontend/package-lock.json
export SOURCE_SHA="$EXPECTED_SOURCE_SHA"
# Keep evidence outside the checkout and preserve it after smoke cleanup.
export EVIDENCE_DIR
EVIDENCE_DIR=$(mktemp -d /tmp/tasks-validation-evidence.XXXXXX)
printf '%s\n' "$SOURCE_SHA" > "$EVIDENCE_DIR/source.txt"
node --version > "$EVIDENCE_DIR/node.txt"
npm --version > "$EVIDENCE_DIR/npm.txt"
(cd backend && npm ci --ignore-scripts --no-audit --no-fund) 2>&1 | tee "$EVIDENCE_DIR/backend-ci.log"
(cd frontend && npm ci --ignore-scripts --no-audit --no-fund && npm run build:css) 2>&1 | tee "$EVIDENCE_DIR/frontend-ci.log"
# Do not inherit any test DB URLs. This phase covers unit + HTTP security tests.
env -u TEST_DATABASE_URL -u TEST_MIGRATION_DATABASE_URL \
  node --test backend/test/unit.test.js backend/test/security.test.js backend/test/deploy-contract.test.js \
  2>&1 | tee "$EVIDENCE_DIR/offline-security.log"
(cd backend && npm audit --audit-level=high) 2>&1 | tee "$EVIDENCE_DIR/backend-audit.log"
(cd frontend && npm audit --audit-level=high) 2>&1 | tee "$EVIDENCE_DIR/frontend-audit.log"
git diff --exit-code
[[ -z $(git status --porcelain) ]]
```

An unavailable advisory endpoint is BLOCKED, not a clean scan. High/critical
findings stop acceptance pending explicit review; never run npm audit fix here.

## 3. Build once, validate the exact artifact (operator)

Obtain approved immutable image references through the trusted executor. The
Node image must be official Node 24 bookworm-slim; PostgreSQL must be official
17-alpine. Verify registry/publisher and record the resolved platform/manifest
digests. A digest identifies bytes; it alone is not proof of publisher trust.

```bash
: "${NODE_IMAGE:?node:24-bookworm-slim@sha256:approved-digest}"
: "${TEST_POSTGRES_IMAGE:?postgres:17-alpine@sha256:approved-digest}"
[[ "$NODE_IMAGE" =~ ^node:24-bookworm-slim@sha256:[a-f0-9]{64}$ ]]
[[ "$TEST_POSTGRES_IMAGE" =~ ^postgres:17-alpine@sha256:[a-f0-9]{64}$ ]]
export TEST_POSTGRES_IMAGE
printf '%s\n%s\n' "$NODE_IMAGE" "$TEST_POSTGRES_IMAGE" > "$EVIDENCE_DIR/base-images.txt"
docker buildx imagetools inspect "$NODE_IMAGE" > "$EVIDENCE_DIR/node-provenance.txt"
docker buildx imagetools inspect "$TEST_POSTGRES_IMAGE" > "$EVIDENCE_DIR/postgres-provenance.txt"
docker pull "$TEST_POSTGRES_IMAGE"
docker buildx build --load --build-arg NODE_IMAGE="$NODE_IMAGE" \
  --build-arg GIT_REVISION="$SOURCE_SHA" --tag "mytko-tasks:validate-$SOURCE_SHA" \
  . 2>&1 | tee "$EVIDENCE_DIR/build.log"
export TEST_IMAGE
TEST_IMAGE=$(docker image inspect --format '{{.Id}}' "mytko-tasks:validate-$SOURCE_SHA")
[[ "$TEST_IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$TEST_IMAGE") == "$SOURCE_SHA" ]]
docker image inspect "$TEST_IMAGE" > "$EVIDENCE_DIR/image-inspect.json"
printf '%s\n' "$TEST_IMAGE" > "$EVIDENCE_DIR/local-image-id.txt"
export TASKS_DISPOSABLE_APPROVED=yes
bash deploy/smoke-test.sh 2>&1 | tee "$EVIDENCE_DIR/smoke.log"
docker image save -o "$EVIDENCE_DIR/tasks-$SOURCE_SHA.docker.tar" "$TEST_IMAGE"
sha256sum "$EVIDENCE_DIR/tasks-$SOURCE_SHA.docker.tar" > "$EVIDENCE_DIR/archive.sha256"
git diff --exit-code
[[ -z $(git status --porcelain) ]]
```

Smoke creates a unique Compose project; only its containers/network/DB volume
are deleted by the EXIT trap. It uses disposable test credentials, loopback
ports and PostgreSQL 17. The supplied TEST_IMAGE is never rebuilt or pulled. Both TEST_IMAGE and the
approved PostgreSQL 17 digest are mandatory; both images must already be loaded.
Compose ignores dotenv files; application/migrator URLs are fixed test-only
values pointing to service db on this run's private network. Host DATABASE_URL
and MIGRATION_DATABASE_URL are not forwarded. Curl bypasses ambient proxies.
Port collisions must be resolved by choosing unused TEST_APP_PORT/TEST_DB_PORT,
not stopping unrelated resources. Run only one test suite per chosen port pair.
Docker images and evidence remain for review; no broad prune/cleanup is allowed.

Acceptance exercised by smoke: real Express security tests and PostgreSQL tests,
readiness before/after migration, advisory locking/checksums/rollback, app-role
DDL denial, CRUD, public minimal health, Basic challenge/wrong password,
CSRF, CSP header, stylesheet availability, uid/read-only filesystem, process
SIGTERM, app/database restart persistence and pg_dump/delete/pg_restore.
A failing command is FAIL; a prerequisite that prevents execution is BLOCKED.

Additional acceptance before release (record each separately):

- Browser against a disposable instance: rendering, category/task CRUD, one POST
  per action, no DOM XSS and no CSP errors; touch/keyboard behaviour. A 200 CSS
  response does not establish visual correctness.
- Disposable reverse-proxy test: public /readyz and route variants must be
  inaccessible; upstream loopback /readyz must be 200. Basic unauthenticated
  paths remain 401; public /healthz is minimal. The app itself does not restrict
  readiness by source IP; proxy filtering and loopback publishing are mandatory.
  Check /readyz/, /READYZ and encoded path variants, because Express routing is
  case-insensitive/non-strict by default. The reference proxy now covers case
  and optional trailing slash; real Caddy behaviour remains to be tested.
- Inspect running test container: memory 256 MiB, pids 128, no public port,
  cap_drop ALL, no-new-privileges. Smoke asserts these settings and, when EVIDENCE_DIR is supplied, writes
  smoke-container-inspect.json before destroying its disposable containers.
- TLS/certificate/HSTS on the real hostname remains NOT VERIFIED until a later
  authorized deployment. This task does not change host Caddy or DNS.

## 4. External executor handoff (no deployment in this task)

Attach logs and mark all unexecuted checks SKIP/BLOCKED. Supply:

| Field | Required value |
|---|---|
| Source | full reviewed SOURCE_SHA, clean source and reviewed frontend lockfile |
| Build inputs | Node digest, PostgreSQL 17 digest, architecture, Docker/Buildx versions |
| Artifact | tasks-SOURCE_SHA.docker.tar plus archive SHA256 and local image ID |
| OCI manifest digest | **PENDING until trusted executor imports/publishes this exact artifact**; local image ID and archive hash are not registry manifest digests |
| Release reference | registry/repository@sha256:manifest; verify revision label/source association after publication; do not rebuild between acceptance and release |
| Migrator | same immutable release image; command node backend/migrate.js |
| Migration env | MIGRATION_DATABASE_URL (tasks_owner), APP_DB_ROLE=tasks_app; never pass owner URL to app |
| App env | NODE_ENV=production, DATABASE_URL (tasks_app), PUBLIC_ORIGIN=https://task.mytko.dev, AUTH_USERNAME, AUTH_PASSWORD_HASH, HOST=0.0.0.0, PORT=3000 |
| Operational env | TRUST_PROXY restricted to actual proxy, PG_POOL_MAX=10, PG_STATEMENT_TIMEOUT_MS=10000, SHUTDOWN_TIMEOUT_MS=10000; rate limits as app.env.example |
| Ports | container 3000; production host 127.0.0.1:3100 only; database private, not publicly published |
| Health | public GET /healthz; private upstream GET /readyz, unauthenticated, minimal JSON; readiness must not be publicly routed |
| Persistence | external PostgreSQL only; no attachments implemented; off-host backups and restore evidence |
| Shutdown | SIGTERM, 20 s Compose grace > 10 s application timeout |
| Rollback | no down migrations; previous image only after schema compatibility review; pre-release DB restore loses newer writes; never assume readiness proves backward compatibility |

Trusted executor must record the OCI digest, preserve the tested image, and
rerun artifact smoke by immutable reference if publication changes representation.
Publishing and Validate → Push → Review → Merge belong exclusively to Mytko.
This procedure performs none of those actions. Deployment needs separate approval.

## 5. Evidence from this Session

Baseline source d5dfead266eaf35dc880499c23276174cd4af00f; six Session commits;
initial worktree clean. Agent: Codex (the task labels Claude, but this Run is Codex).
Node 24.21.0 exists. Baseline unit + deployment-contract tests: 34 PASS.
After isolation fixes: 36 PASS; RC-01 adds lockfile, artifact guard and rendered
Compose isolation tests (results recorded in the RC handoff). Bash syntax: PASS. Docker info: BLOCKED (socket
absent). Backend node_modules and PostgreSQL server absent. Registry 403 is a
known environment constraint; no install retried. Frontend lockfile subsequently generated by operator and reviewed in RC-01.
Full HTTP security, PostgreSQL integration, Docker build/smoke, provenance,
OCI digest and browser acceptance: NOT RUN/BLOCKED, not PASS.

Exact legacy password comparison across tracked working-tree files: zero matches.
Current DB config uses environment URLs; templates contain placeholders or
explicit disposable credentials. This is not an inspection of production secrets
or generated images. Historical password remains in Git history. If ever used,
operator must rotate it on every affected database; actual use is UNKNOWN.


## 6. RC-01 finalization (2026-10-31)

Operator-reported Fujitsu host capabilities: Node 24.21.0, npm 11.19.0,
Docker Engine 29.8.2, Compose 5.6.0, registry access and 171 GB free. This
Session independently confirms Node/npm/Compose CLI, but cannot access the
Docker daemon or PostgreSQL server. No npm installs were retried here.

RC changes remove the smoke build fallback, require immutable preloaded app and
PostgreSQL 17 images, disable dotenv loading, and bypass HTTP proxies for all
loopback requests. The rendered Compose test deliberately supplies unrelated
ORHEA/MOTO URLs and verifies they do not enter service configuration; it checks
private project-owned network/volume, fixed disposable URLs and loopback ports.
The DB healthcheck uses TCP so it cannot mistake initdb's temporary Unix-only
server for the final ready server. No existing host container is modified.

Executed in this Session: 39 unit/deployment-contract tests PASS (including
rendered Compose without a daemon), all repository JavaScript syntax PASS,
smoke/checklist Bash syntax PASS, lockfile validation PASS, disposable Basic
password/hash match PASS, git diff --check PASS. Full security HTTP suite is
BLOCKED by absent installed backend dependencies; Docker/PostgreSQL acceptance,
Caddy execution, browser checks, build provenance and OCI digest remain BLOCKED
or NOT VERIFIED. Applied SQL migrations were reviewed, not executed here.

Run sections 1–3 in order from the clean RC checkout; set EXPECTED_SOURCE_SHA
to the full RC commit supplied in the handoff, and use approved real base-image
digests. After the exact image has been built and both images loaded (section 3),
the acceptance invocation is:

```bash
TASKS_DISPOSABLE_APPROVED=yes \
TEST_IMAGE="${TEST_IMAGE:?exact built image ID from section 3}" \
TEST_POSTGRES_IMAGE="${TEST_POSTGRES_IMAGE:?approved loaded PostgreSQL 17 digest}" \
bash deploy/smoke-test.sh
```

This invocation does not replace npm ci/audit/build in sections 2–3. It needs no
production credentials or host service changes. A successful run is required
before production readiness can be considered by reviewers and the operator.
