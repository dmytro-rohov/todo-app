#!/usr/bin/env bash
# Verifies the exact prebuilt image against a disposable
# PostgreSQL: unit/security/integration tests inside the image, auth, CSRF,
# headers, non-root/read-only runtime, restart persistence, graceful stop,
# DB outage recovery, concurrent migrations and backup/restore.
# Requires Docker with Compose v2 and curl. Removes only this run's test resources.
set -euo pipefail

cd "$(dirname "$0")"
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
[[ "${TEST_POSTGRES_IMAGE:-}" =~ ^postgres:17-alpine@sha256:[a-f0-9]{64}$ ]] || {
  echo "TEST_POSTGRES_IMAGE must be the approved postgres:17-alpine@sha256 digest" >&2
  exit 2
}
export TEST_IMAGE TEST_POSTGRES_IMAGE
# Never reuse the fixed Compose project (or its database volume).
PROJECT="tasks-validation-$(date +%s)-$$-$RANDOM"
COMPOSE=(docker compose --env-file /dev/null -p "$PROJECT" -f compose.test.yaml)
BASE="http://127.0.0.1:${TEST_APP_PORT:-3101}"
AUTH=owner:test-only-password
SAME_ORIGIN=(-H "Sec-Fetch-Site: same-origin" -H "Content-Type: application/json")
WORK=$(mktemp -d)
# Preserve checkout permissions; unprivileged containers read disposable copies.
mkdir "$WORK/tests"
cp ../backend/test/*.js "$WORK/tests/"
cp test/initdb.sql "$WORK/initdb.sql"
chmod a+rx "$WORK" "$WORK/tests"
chmod a+r "$WORK"/tests/*.js "$WORK/initdb.sql"
export TEST_INITDB_SQL="$WORK/initdb.sql"

cleanup() {
  local result=$?
  trap - EXIT
  if ! "${COMPOSE[@]}" down -v --remove-orphans; then
    echo "Cleanup failed for isolated project $PROJECT; operator cleanup required" >&2
    result=1
  fi
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
  -e TEST_MIGRATION_DATABASE_URL=postgres://tasks_owner:owner-test-only@db:5432/tasks_test \
  -e TEST_DATABASE_URL=postgres://tasks_app:app-test-only@db:5432/tasks_test \
  "$TEST_IMAGE" node --test backend/test/unit.test.js backend/test/security.test.js backend/test/integration.test.js
pass "node test suite (unit, security, integration) inside the image"
# deploy-contract.test.js inspects the checkout (Dockerfile, deploy/), not the image
if command -v node >/dev/null; then
  node --test ../backend/test/deploy-contract.test.js >/dev/null
  pass "deploy contract tests on the checkout"
fi
# the integration suite drops the schema; restore it
"${COMPOSE[@]}" run --rm --no-deps --pull never migrate >/dev/null

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
  docker inspect "$APP_CONTAINER" > "$EVIDENCE_DIR/smoke-container-inspect.json"
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

# --- backup / restore ------------------------------------------------------------
"${COMPOSE[@]}" exec -T db pg_dump -U tasks_owner -d tasks_test -Fc >"$WORK/backup.dump"
[[ -s "$WORK/backup.dump" ]] && pass "pg_dump backup created" || fail "pg_dump backup created"
curl --noproxy '*' -s -o /dev/null -u "$AUTH" -X DELETE -H "Sec-Fetch-Site: same-origin" "$BASE/api/tasks/date/2026-10-30"
has_task && fail "task deleted before restore" || pass "task deleted before restore"
"${COMPOSE[@]}" exec -T db pg_restore -U tasks_owner -d tasks_test --clean --if-exists --single-transaction <"$WORK/backup.dump"
has_task && pass "restore brings the task back" || fail "restore brings the task back"
expect "app role still works after restore" 201 "$(status -u "$AUTH" "${SAME_ORIGIN[@]}" \
  -d '{"title":"After restore","date":"2026-10-31"}' "$BASE/api/tasks")"

echo "smoke test passed"
