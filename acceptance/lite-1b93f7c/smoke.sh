#!/usr/bin/env bash
# Verifies the exact prebuilt image against a disposable
# PostgreSQL: unit/security/integration tests inside the image, auth, CSRF,
# headers, non-root/read-only runtime, restart persistence, graceful stop,
# DB outage recovery, concurrent migrations and backup/restore.
# Requires Docker with Compose v2 and curl. Removes only this run's test resources.
set -euo pipefail
umask 077

cd "${SOURCE_DIR:?}/deploy"
# Explicit opt-in: integration tests DROP tables; cleanup removes this run's volume.
[[ "${TASKS_DISPOSABLE_APPROVED:-}" == yes ]] || {
  echo "Set TASKS_DISPOSABLE_APPROVED=yes only on an approved disposable Docker host" >&2
  exit 2
}
# Refuse mutable/missing images before creating resources or installing a trap.
[[ "${TEST_IMAGE:-}" =~ ^sha256:[a-f0-9]{64}$ || "${TEST_IMAGE:-}" =~ ^[^[:space:]]+@sha256:[a-f0-9]{64}$ ]] || {
  echo "TEST_IMAGE must be an immutable preloaded image ID or repository digest" >&2
  exit 2
}
[[ "${TEST_POSTGRES_IMAGE:-}" =~ ^docker.io/library/postgres@sha256:[a-f0-9]{64}$ ]] || {
  echo "TEST_POSTGRES_IMAGE must be the approved postgres:17-alpine@sha256 digest" >&2
  exit 2
}
export TEST_IMAGE TEST_POSTGRES_IMAGE
# Never reuse the fixed Compose project (or its database volume).
PROJECT="tasks-validation-$(date +%s)-$$-$RANDOM"
COMPOSE=(docker compose --env-file /dev/null -p "$PROJECT" -f "${PACKAGE_DIR:?}/compose.test.yaml")
BASE="http://127.0.0.1:${TEST_APP_PORT:-3101}"
AUTH_PASSWORD=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
export AUTH_PASSWORD
AUTH="owner:$AUTH_PASSWORD"
AUTH_PASSWORD_HASH=$(node -e 'require(process.env.SOURCE_DIR+"/backend/security").hashPassword(process.env.AUTH_PASSWORD).then(console.log)')
export AUTH_PASSWORD_HASH
SAME_ORIGIN=(-H "Sec-Fetch-Site: same-origin" -H "Content-Type: application/json")
WORK=$(mktemp -d)
# Hex credentials are generated anew per run and never printed.
OWNER_PASSWORD=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
APP_PASSWORD=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
RESTORE_PASSWORD=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
SUPER_PASSWORD=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
export OWNER_PASSWORD APP_PASSWORD RESTORE_PASSWORD SUPER_PASSWORD

# Preserve checkout permissions; unprivileged containers read disposable copies.
mkdir "$WORK/tests"
cp ../backend/test/*.js "$WORK/tests/"
python3 - "$WORK/tests/release-smoke.js" <<'PYS'
import os,sys
from pathlib import Path
p=Path(sys.argv[1]);p.write_text(p.read_text().replace('test-only-password',os.environ['AUTH_PASSWORD']))
PYS
python3 - "$PACKAGE_DIR/initdb.sql" "$WORK/initdb.sql" <<'PYGEN'
import os,sys
from pathlib import Path
s=Path(sys.argv[1]).read_text()
for old,key in [('owner-test-only','OWNER_PASSWORD'),('app-test-only','APP_PASSWORD'),('restore-test-only','RESTORE_PASSWORD')]:s=s.replace(old,os.environ[key])
Path(sys.argv[2]).write_text(s)
PYGEN
chmod a+rx "$WORK" "$WORK/tests"
chmod a+r "$WORK"/tests/*.js "$WORK/initdb.sql"
export TEST_INITDB_SQL="$WORK/initdb.sql"

cleanup() {
  local result=$?
  trap - EXIT
  if [[ -n "${EVIDENCE_DIR:-}" ]]; then "${COMPOSE[@]}" logs --no-color > "$EVIDENCE_DIR/compose.log" 2>&1 || result=1; fi
  if ! python3 "$PACKAGE_DIR/ownership.py" "$PROJECT" "$ACCEPTANCE_RUN_ID"; then
    echo "Foreign ownership; cleanup refused; evidence retained: $WORK" >&2
    exit 1
  fi
  # Docker deletion has no atomic compare-label-and-delete contract. Fail closed.
  echo "Automatic Docker cleanup refused: inspect owned resources for project $PROJECT run $ACCEPTANCE_RUN_ID manually" >&2
  result=1
  rm -rf "$WORK"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; exit 1; }
expect() { # expect <description> <expected> <actual>
  if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1 (expected $2, got $3)"; fi
}
status() { curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "$@"; }
wait_ready() {
  for _ in $(seq 1 60); do
    [[ "$(status "$BASE/readyz")" == 200 ]] && return 0
    sleep 1
  done
  fail "app did not become ready"
}

# Both artifacts must already exist; never pull/build implicitly during smoke.
docker image inspect "$TEST_IMAGE" >/dev/null
docker image inspect "$TEST_POSTGRES_IMAGE" >/dev/null
"${COMPOSE[@]}" up -d --no-build --pull never app
wait_ready
pass "exact image starts, migrations run, app becomes ready"

NETWORK=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$("${COMPOSE[@]}" ps -q app)")
docker run --rm --pull never --network "$NETWORK" \
  -v "$WORK/tests:/app/backend/test:ro" \
  -e TEST_MIGRATION_DATABASE_URL=postgres://tasks_owner:${OWNER_PASSWORD}@db:5432/tasks_test \
  -e TEST_DATABASE_URL=postgres://tasks_app:${APP_PASSWORD}@db:5432/tasks_test \
  "$TEST_IMAGE" node --test backend/test/unit.test.js backend/test/security.test.js backend/test/integration.test.js
pass "node test suite (unit, security, integration) inside the image"
# deploy-contract.test.js inspects the checkout (Dockerfile, deploy/), not the image
if command -v node >/dev/null; then
  node --test ../backend/test/deploy-contract.test.js >/dev/null
  pass "deploy contract tests on the checkout"
fi
# the integration suite drops the schema; restore it
"${COMPOSE[@]}" run --rm --no-deps --pull never migrate >/dev/null

# Transaction-fault probe, isolated from destructive baseline integration suite.
cp "$PACKAGE_DIR/transaction.test.js" "$WORK/tests/transaction.test.js"
chmod a+r "$WORK/tests/transaction.test.js"
docker run --rm --pull never --network "$NETWORK" \
  -v "$WORK/tests:/app/backend/test:ro" \
  -e TEST_MIGRATION_DATABASE_URL=postgres://tasks_owner:${OWNER_PASSWORD}@db:5432/tasks_test \
  -e TEST_DATABASE_URL=postgres://tasks_app:${APP_PASSWORD}@db:5432/tasks_test \
  "$TEST_IMAGE" node --test backend/test/transaction.test.js

# New domain probe uses only this run's disposable app/network.
docker run --rm --pull never --network "$NETWORK" \
  -v "$WORK/tests:/app/backend/test:ro" \
  -e TASKS_DISPOSABLE_APPROVED=yes -e SMOKE_BASE=http://app:3000 \
  "$TEST_IMAGE" node backend/test/release-smoke.js

# --- health, auth, headers ---------------------------------------------------
expect "healthz is public" 200 "$(status "$BASE/healthz")"
expect "healthz body is minimal" '{"status":"ok"}' "$(curl --noproxy '*' -s "$BASE/healthz")"
expect "readyz body is minimal" '{"status":"ok"}' "$(curl --noproxy '*' -s "$BASE/readyz")"
expect "app shell requires auth" 401 "$(status "$BASE/")"
expect "API requires auth" 401 "$(status "$BASE/api/tasks")"
expect "wrong password rejected" 401 "$(status -u owner:wrong "$BASE/api/tasks")"
expect "app shell with auth" 200 "$(status -u "$AUTH" "$BASE/")"
expect "compiled stylesheet served" 200 "$(status -u "$AUTH" "$BASE/dist/style.css")"
curl --noproxy '*' -s -D - -o /dev/null -u "$AUTH" "$BASE/" | grep -qi "^content-security-policy: default-src 'self'" \
  && pass "CSP header present" || fail "CSP header present"

# --- CRUD + CSRF ---------------------------------------------------------------
CATEGORY_ID=$(curl --noproxy '*' -s -u "$AUTH" "${SAME_ORIGIN[@]}" -d '{"name":"Praca","color":"#4e45e4"}' "$BASE/api/categories" \
  | sed -E 's/.*"id":([0-9]+).*/\1/')
[[ "$CATEGORY_ID" =~ ^[0-9]+$ ]] && pass "create category" || fail "create category"
expect "create task" 201 "$(status -u "$AUTH" "${SAME_ORIGIN[@]}" \
  -d "{\"title\":\"Smoke task\",\"date\":\"2026-10-30\",\"categoryId\":$CATEGORY_ID}" "$BASE/api/tasks")"
expect "cross-site write rejected" 403 "$(status -u "$AUTH" -H "Sec-Fetch-Site: cross-site" \
  -H "Content-Type: application/json" -d '{"title":"csrf","date":"2026-10-30"}' "$BASE/api/tasks")"
has_task() { curl --noproxy '*' -s -u "$AUTH" "$BASE/api/tasks" | grep -q '"title":"Smoke task"'; }
has_task && pass "task readable" || fail "task readable"

# --- runtime hardening ---------------------------------------------------------
expect "runs as uid 1000" 1000 "$("${COMPOSE[@]}" exec -T app id -u)"
"${COMPOSE[@]}" exec -T app sh -c 'touch /app/backend/x 2>/dev/null' \
  && fail "application tree is read-only" || pass "application tree is read-only"
"${COMPOSE[@]}" exec -T app sh -c 'touch /x 2>/dev/null' \
  && fail "root filesystem is read-only" || pass "root filesystem is read-only"

APP_CONTAINER=$("${COMPOSE[@]}" ps -q app)
expect "memory limit 256 MiB" 268435456 "$(docker inspect -f '{{.HostConfig.Memory}}' "$APP_CONTAINER")"
expect "PID limit 128" 128 "$(docker inspect -f '{{.HostConfig.PidsLimit}}' "$APP_CONTAINER")"
expect "all capabilities dropped" '[ALL]' "$(docker inspect -f '{{.HostConfig.CapDrop}}' "$APP_CONTAINER")"
expect "no new privileges" '[no-new-privileges:true]' "$(docker inspect -f '{{.HostConfig.SecurityOpt}}' "$APP_CONTAINER")"
expect "app port bound only to loopback" '127.0.0.1' "$(docker inspect -f '{{range (index .HostConfig.PortBindings "3000/tcp")}}{{.HostIp}}{{end}}' "$APP_CONTAINER")"
if [[ -n "${EVIDENCE_DIR:-}" ]]; then
  docker inspect "$APP_CONTAINER" | python3 "$PACKAGE_DIR/redact.py" > "$EVIDENCE_DIR/smoke-container-inspect.json"
fi

# --- restart / graceful shutdown -----------------------------------------------
"${COMPOSE[@]}" restart app >/dev/null
wait_ready
has_task && pass "data survives app restart" || fail "data survives app restart"

"${COMPOSE[@]}" stop app >/dev/null
expect "SIGTERM exits cleanly" 0 "$(docker inspect -f '{{.State.ExitCode}}' "$("${COMPOSE[@]}" ps -aq app)")"
"${COMPOSE[@]}" start app >/dev/null
wait_ready

# --- database outage -----------------------------------------------------------
"${COMPOSE[@]}" stop db >/dev/null
sleep 2
expect "readyz reports outage" 503 "$(status "$BASE/readyz")"
expect "liveness unaffected by outage" 200 "$(status "$BASE/healthz")"
"${COMPOSE[@]}" start db >/dev/null
wait_ready
has_task && pass "recovers after database restart" || fail "recovers after database restart"

# --- migrations ----------------------------------------------------------------
"${COMPOSE[@]}" run --rm --no-deps --pull never migrate >"$WORK/m1.log" 2>&1 & M1=$!
"${COMPOSE[@]}" run --rm --no-deps --pull never migrate >"$WORK/m2.log" 2>&1 & M2=$!
wait "$M1" && wait "$M2" && pass "concurrent migrators both succeed" || fail "concurrent migrators both succeed"
grep -q "schema up to date" "$WORK/m1.log" && grep -q "schema up to date" "$WORK/m2.log" \
  && pass "re-running migrations is a no-op" || fail "re-running migrations is a no-op"

# --- backup / restore: never restore into source -----------------------------
"${COMPOSE[@]}" exec -T db pg_dump --version | grep -E ' 17\.'
"${COMPOSE[@]}" exec -T db pg_restore --version | grep -E ' 17\.'
source_snapshot() {
  "${COMPOSE[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U tasks_owner -d tasks_test -Atc "SELECT jsonb_build_object('tasks',(SELECT jsonb_agg(t ORDER BY id) FROM tasks t),'categories',(SELECT jsonb_agg(c ORDER BY id) FROM categories c),'ledger',(SELECT jsonb_agg(m ORDER BY version) FROM schema_migrations m));"
}
source_snapshot > "$WORK/source-before.json"
"${COMPOSE[@]}" exec -T db pg_dump -U tasks_owner -d tasks_test -Fc > "$WORK/backup.dump"
"${COMPOSE[@]}" exec -T db pg_restore -U tasks_restore_owner -d tasks_restore_test --no-owner --no-privileges --single-transaction < "$WORK/backup.dump"
"${COMPOSE[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U tasks_restore_owner -d tasks_restore_test -Atc "SELECT jsonb_build_object('tasks',(SELECT jsonb_agg(t ORDER BY id) FROM tasks t),'categories',(SELECT jsonb_agg(c ORDER BY id) FROM categories c),'ledger',(SELECT jsonb_agg(m ORDER BY version) FROM schema_migrations m));" > "$WORK/restored.json"
cmp "$WORK/source-before.json" "$WORK/restored.json"
source_snapshot > "$WORK/source-after.json"
cmp "$WORK/source-before.json" "$WORK/source-after.json"
# Invalid archive fails atomically and does not replace restored records.
if printf 'invalid backup' | "${COMPOSE[@]}" exec -T db pg_restore -U tasks_restore_owner -d tasks_restore_test --single-transaction; then fail "corrupt backup accepted"; fi
source_snapshot > "$WORK/source-after-corrupt.json"
cmp "$WORK/source-before.json" "$WORK/source-after-corrupt.json"
"${COMPOSE[@]}" exec -T db psql -X -v ON_ERROR_STOP=1 -U tasks_restore_owner -d tasks_restore_test -Atc "SELECT jsonb_build_object('tasks',(SELECT jsonb_agg(t ORDER BY id) FROM tasks t),'categories',(SELECT jsonb_agg(c ORDER BY id) FROM categories c),'ledger',(SELECT jsonb_agg(m ORDER BY version) FROM schema_migrations m));" > "$WORK/restore-after-corrupt.json"
cmp "$WORK/restored.json" "$WORK/restore-after-corrupt.json"
for database in tasks_test tasks_restore_test; do
  owner=tasks_owner; [[ $database == tasks_restore_test ]] && owner=tasks_restore_owner
  "${COMPOSE[@]}" exec -T db pg_dump -U "$owner" -d "$database" --schema-only --no-owner --no-privileges | sed '/^\\restrict /d; /^\\unrestrict /d' > "$WORK/$database.schema"
done
cmp "$WORK/tasks_test.schema" "$WORK/tasks_restore_test.schema"
pass "independent restore schema/data/ledger match; source unchanged; corrupt archive rejected"
if [[ -n "${EVIDENCE_DIR:-}" ]]; then
  cp "$WORK/source-before.json" "$WORK/restored.json" "$WORK/source-after.json" "$WORK/backup.dump" "$EVIDENCE_DIR/"
fi
echo "smoke test passed"
