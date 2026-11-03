# TASKS-02RC — current validation candidate procedure

This is the only current procedure. Everything below the Historical record heading
is retained evidence and superseded instructions; do not execute its old checklists.
Branch: `mytko/implementacja-96f75bff`. Operator-confirmed GitHub main:
`4b123dcd5c8de4361773c76c400fc1f710feb8f6`; local main is stale.
Source before candidate commit: `adca093ceb636e40def4193ee06923e477edc59c`.
The candidate is not immutable/clean until the operator approves its commit.
No production release is authorized. PostgreSQL/container acceptance is pending.

## Current local checks (Session worktree)

```bash
set -euo pipefail
[[ $(git branch --show-current) == mytko/implementacja-96f75bff ]]
git status --short
export npm_config_cache="$PWD/.npm-cache"
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix frontend test
# No inherited database targets: integration suite must skip in this phase.
env -u TEST_DATABASE_URL -u TEST_MIGRATION_DATABASE_URL \
  NO_PROXY=127.0.0.1,localhost,::1 no_proxy=127.0.0.1,localhost,::1 npm --prefix backend test
npm --prefix backend audit --audit-level=high
npm --prefix frontend audit --audit-level=high
git diff --check
```

## Approved disposable Fujitsu runner only (operator)

Requires a clean reviewed commit supplied by Mytko, Node 24, npm, Bash, curl,
Docker/Compose/Buildx, unused loopback ports 3101/55432 and approved official
Node 24 bookworm-slim / PostgreSQL 17-alpine digests. Do not expose its Docker
socket to this Session. Do not use any existing database or ORHEA/MOTO resources.
Integration tests drop test tables; backup/restore acts only on the disposable DB.
No production environment files or credentials may be supplied.

Run the local checks above, then the following from the reviewed repository root:

```bash
set -euo pipefail
: "${EXPECTED_SOURCE_SHA:?full reviewed candidate commit from Mytko}"
: "${NODE_IMAGE:?approved official node:24-bookworm-slim@sha256 digest}"
: "${TEST_POSTGRES_IMAGE:?approved official postgres:17-alpine@sha256 digest}"
[[ $(git branch --show-current) == mytko/implementacja-96f75bff ]]
[[ $(git rev-parse HEAD) == "$EXPECTED_SOURCE_SHA" ]]
[[ -z $(git status --porcelain) ]]
[[ "$NODE_IMAGE" =~ ^node:24-bookworm-slim@sha256:[a-f0-9]{64}$ ]]
[[ "$TEST_POSTGRES_IMAGE" =~ ^postgres:17-alpine@sha256:[a-f0-9]{64}$ ]]
command -v curl
command -v ss
[[ -z $(docker ps -q --filter publish=3101) ]]
[[ -z $(docker ps -q --filter publish=55432) ]]
# Also check non-Docker listeners; stop if either command reports a listener.
! ss -H -ltn 'sport = :3101' | grep -q .
! ss -H -ltn 'sport = :55432' | grep -q .
export SOURCE_SHA="$EXPECTED_SOURCE_SHA" TEST_POSTGRES_IMAGE
export EVIDENCE_DIR
EVIDENCE_DIR=$(mktemp -d /tmp/tasks-rc-evidence.XXXXXX)
printf '%s\n' "$SOURCE_SHA" > "$EVIDENCE_DIR/source.txt"
docker buildx imagetools inspect "$NODE_IMAGE" > "$EVIDENCE_DIR/node-provenance.txt"
docker buildx imagetools inspect "$TEST_POSTGRES_IMAGE" > "$EVIDENCE_DIR/postgres-provenance.txt"
docker pull "$TEST_POSTGRES_IMAGE"
docker buildx build --load --build-arg NODE_IMAGE="$NODE_IMAGE" \
  --build-arg GIT_REVISION="$SOURCE_SHA" -t "mytko-tasks:validate-$SOURCE_SHA" . \
  2>&1 | tee "$EVIDENCE_DIR/build.log"
export TEST_IMAGE
TEST_IMAGE=$(docker image inspect --format '{{.Id}}' "mytko-tasks:validate-$SOURCE_SHA")
[[ "$TEST_IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$TEST_IMAGE") == "$SOURCE_SHA" ]]
docker image inspect "$TEST_IMAGE" > "$EVIDENCE_DIR/image-inspect.json"
TASKS_DISPOSABLE_APPROVED=yes bash deploy/smoke-test.sh 2>&1 | tee "$EVIDENCE_DIR/smoke.log"
git diff --exit-code
[[ -z $(git status --porcelain) ]]
```

The script uses explicit Compose file/project and `/dev/null` dotenv input,
fixed disposable database URLs/roles, a private internal network and project-owned
volume. No host networking, external volumes, production env_file or socket mounts.
Port binding errors abort; cleanup removes only this unique project. Cleanup
failure is reported as failure, not success. Interrupted runs attempt cleanup;
SIGKILL cannot be trapped, so operator may need to remove only the reported unique
project after checking ownership. Never use global Docker prune.
Images must already exist for smoke; all starts and helper runs prohibit pulls.
The script checks migrations, HTTP/auth/API, restart persistence, outage recovery,
concurrent migration no-op and backup/restore. These are planned acceptance steps,
not claimed PASS until the operator supplies evidence.

---

# Historical record — superseded procedures, do not execute

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
| App env | NODE_ENV=production, DATABASE_URL (tasks_app), PUBLIC_ORIGIN=https://tasks.mytko.dev, AUTH_USERNAME, AUTH_PASSWORD_HASH, HOST=0.0.0.0, PORT=3000 |
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


## 7. Dependency security follow-up

The RC source was superseded by MW-TASKS-SEC-DEPENDENCIES-01; see
[SECURITY-DEPENDENCIES.md](SECURITY-DEPENDENCIES.md) for exact versions, audit
results and reproduction. Use the new reviewed commit for EXPECTED_SOURCE_SHA.
Production TRUST_PROXY now accepts only false/loopback/explicit proxy peer IPs
or host CIDRs. Do not reuse the former broad private-subnet value. Test Compose
uses TRUST_PROXY=false because smoke connects directly. Full Docker/PostgreSQL
smoke is still required for a freshly built image from the new commit.

## 8. Session runtime revalidation (2026-10-31)

Source checked: `adca093ceb636e40def4193ee06923e477edc59c`, Session branch
`mytko/implementacja-96f75bff`. Worktree was clean before validation.
The earlier registry restriction is no longer present in this Session:
Node 24.21.0, npm 11.19.0, registry ping and actual backend/frontend installs PASS.
Both installs reported zero audit vulnerabilities. The existing frontend lockfile
was unchanged by `install --package-lock-only` and subsequent `ci`.
Sass build PASS; frontend asset tests: 6 PASS, 0 FAIL, 0 SKIP.

Backend HTTP tests initially failed because the inherited proxy intercepted
loopback requests (CONNECT 403). Local-only proxy exclusions resolve this:

```bash
NO_PROXY=127.0.0.1,localhost,::1 no_proxy=127.0.0.1,localhost,::1 npm --prefix backend test
```

Result: 85 tests PASS, 0 FAIL. PostgreSQL integration suite was separately
SKIPPED because TEST_MIGRATION_DATABASE_URL / TEST_DATABASE_URL were not supplied;
the runner reports zero skipped individual tests because that suite did not run.
No database, Docker, migrations, deployment or production operations were performed.
Host Node executable write access returned EROFS; /var/run/docker.sock was absent.
Cache was explicitly placed in ignored worktree `.npm-cache/`; node_modules and
built CSS remain ignored. npm warned about unapproved optional @parcel/watcher
install scripts; no approval or global install was performed, and Sass built.

This evidence supersedes older sandbox registry/backend-runtime blockers only.
Full PostgreSQL/container acceptance, image provenance and browser acceptance
remain unverified. Status: PARTIAL, not validated for release. The operator must
provide approved disposable database/image resources for the remaining checklist.


## 9. TASKS-02DB local acceptance evidence (2026-10-31)

Preserved section 8 and all prior evidence. Current Session HEAD is adca093;
local main is 6fc7e55 and cached origin/main is 4b123dc (no fetch/sync performed).
adca093, 603a5533 and f4cbe97c all exist. Only adca093 is an ancestor of
Session HEAD; none is an ancestor of either local main or cached origin/main.
603a5533 and f4cbe97c are on the separate audit lineage. Current remote main
and PR status are NOT VERIFIED: the GitHub connector PR search returned 422
(resource not searchable or permission unavailable). No Git credentials accessed.

Frontend count comparison against 57c1997: the old wildcard script ran 25 tests
across api.test.js, helpers.test.js and assets.test.js. HEAD deletes the first two
files and runs only assets.test.js (6 tests). Backend unit.test.js now covers
escapeHtml/safeColor, and security.test.js covers HTTP validation and failures.
This is a changed suite boundary, not proof of equivalent coverage: earlier
frontend request-wrapper and single-POST regression tests are no longer executed.
Actual browser/form submission coverage remains unverified.

Repeated checks: Sass build PASS; frontend 6 PASS / 0 FAIL / 0 SKIP; backend
85 PASS / 0 FAIL, with the PostgreSQL integration suite skipped for missing
TEST_MIGRATION_DATABASE_URL and TEST_DATABASE_URL (zero skipped individual tests).
Both npm audits returned zero vulnerabilities. git diff --check PASS.
Backend tests used NO_PROXY/no_proxy for loopback as documented in section 8.

Docker CLI 29.8.2 is present, but an explicit local unix-socket version check
failed: /var/run/docker.sock does not exist. No Docker resources were created.
Same-project context search exposed no approved database allocation or executor.
PostgreSQL 17, Docker build, smoke, persistence, restart and outage acceptance
are BLOCKED, not PASS. No database target was contacted or written.

### Operator handoff for the approved disposable Fujitsu runner

Use this Session source and preserve its uncommitted documentation. Sections 1–3
above are an operator procedure, not agent authorization. Their historical branch
guard refers to the audit Session; for this handoff require
`mytko/implementacja-96f75bff` instead. Do not switch/reset branches to satisfy it.
After review, Mytko must supply a clean immutable source revision and approved
Node/PostgreSQL base image digests. Do not run integration tests against an
existing database: they drop test tables. Use only the disposable Compose stack.

```bash
# On the approved isolated runner only, from the reviewed checkout:
set -euo pipefail
[[ $(git branch --show-current) == mytko/implementacja-96f75bff ]]
: "${EXPECTED_SOURCE_SHA:?Mytko-reviewed full source revision}"
[[ $(git rev-parse HEAD) == "$EXPECTED_SOURCE_SHA" ]]
[[ -z $(git status --porcelain) ]]
export SOURCE_SHA="$EXPECTED_SOURCE_SHA"
: "${NODE_IMAGE:?approved node:24-bookworm-slim@sha256 digest}"
: "${TEST_POSTGRES_IMAGE:?approved postgres:17-alpine@sha256 digest}"
export TEST_POSTGRES_IMAGE
# Execute section 2 installs/tests/audits, then section 3 build/provenance/smoke.
# Section 3 invokes the existing reviewed script exactly as follows:
TASKS_DISPOSABLE_APPROVED=yes \
TEST_IMAGE="${TEST_IMAGE:?immutable preloaded application image ID}" \
TEST_POSTGRES_IMAGE="$TEST_POSTGRES_IMAGE" bash deploy/smoke-test.sh
```

The existing smoke script uses a unique Compose project, project-owned volume
and network, loopback ports and test-only roles; it checks CRUD, readiness,
restart persistence, database outage recovery, hardening and backup/restore.
It never reuses ORHEA/MOTO resources. Its cleanup deletes only its own disposable
volume. Review section 3 and the script before operator execution; no host socket
needs to be exposed to this Session. Save evidence before accepting the release.
Status: PARTIAL. No commit, push, merge or deploy performed.

## 10. TASKS-02R regression recovery (current Run, 2026-10-31)

All earlier sections are historical evidence, preserved without deletion.
START GATE confirmed Session branch mytko/implementacja-96f75bff and HEAD
adca093ceb636e40def4193ee06923e477edc59c. Only this document was dirty initially.

Git graph: adca093 has parent 57c1997, which has parent 6fc7e55. Cached
origin/main=4b123dc is a merge with parents 6fc7e55 and 57c1997. Thus TASKS-02
contains the TASKS-01 source commit, but was based directly on the Session tip,
not the later main merge commit. Their merge base is 57c1997. Local main remains
6fc7e55. The audit lineage 603a553 -> f4cbe97 diverges at 6fc7e55 and was never
merged into this Session history. No evidence supports claiming those commits
are ancestors merely because related code exists in adca093. Independent review
must assess the resulting tree; no history repair was attempted.

These refs are local observations, not live GitHub state. Operator/Mytko should
check the repository's authenticated GitHub main branch SHA and relevant PR
merged/head/base SHAs using the trusted UI, or run in its authorized environment:
`git ls-remote --heads origin main` (read-only, no local ref updates). Compare
with cached 4b123dc; do not sync/reset/rebase automatically. Previous connector
422 remains historical, not a new successful remote verification.

Recovered frontend tests target the active request.js helper and /api routes,
while separately testing retained http.js/ApiError. They cover JSON options,
HTTP 400/401/422/500, non-JSON failure, empty success, network rejection, task
API mutation contracts, actual registered modal callback single POST, rejected
validation without retry, empty/missing inputs, category-delete bubbling without
extra task DELETE, production renderers' escaping, helper edge cases and safeColor.
Minimal DOM objects execute production modules/callbacks unchanged; this is not
a browser acceptance test. Current safeColor accepts both three- and six-digit
hex, unlike the older test assumption. No application behavior was changed.

Default frontend npm test now discovers all test/*.test.js files: assets, API,
helpers and events. Final result: 28 PASS, 0 FAIL, 0 SKIP. Backend default npm test:
85 PASS, 0 FAIL; PostgreSQL suite skipped for absent approved TEST_* URLs (no
skipped individual test count). Backend tests use loopback NO_PROXY as above.
Both npm ci commands PASS, Sass build PASS, both npm audits report zero
vulnerabilities, git diff --check PASS. Optional watcher lifecycle warning remains;
no scripts were approved, and build succeeded. Lockfiles unchanged.

PostgreSQL and Docker acceptance remain BLOCKED, not PASS. Current scope is ready
for independent code review; full TASKS-02 acceptance remains PARTIAL. No commit,
push, merge, reset, cherry-pick, rebase or deployment performed.


## 11. TASKS-02RC current Run evidence (2026-10-31)

Current procedure is now exclusively at the top of this document; older numbered
sections are historical and must not be used as alternative checklists.
Preserved all previous observations and the five incoming changed files.
Smoke review fixed silent cleanup failure and implicit helper image pulls;
Compose test network is internal. Added regression assertions and rendered
Compose network checks. Port collision fails the Compose start before HTTP smoke;
only the unique project is cleaned. Full race-free port reservation is not claimed.
No Docker daemon, infrastructure or database operation was performed.

Executed: backend/frontend npm ci PASS, Sass build PASS, frontend 28/28 PASS,
backend 86/86 PASS (including daemon-free deployment contracts), both npm audits
zero vulnerabilities, shell syntax PASS, git diff --check PASS. PostgreSQL suite
was skipped with TEST_* URLs explicitly removed. Runner reports zero skipped
individual tests because no tests inside that suite executed. Lockfiles unchanged.
The deployment-contract suite was also executed separately without a daemon.

Prepared logical commit: "TASKS-02RC: recover frontend regressions and finalize isolated validation".
Commit not created: AGENTS.md requires explicit operator approval. Candidate
remains dirty pending that approval; use its eventual full SHA on Fujitsu.
Status READY FOR COMMIT for this source patch; full DB/Docker acceptance BLOCKED.
