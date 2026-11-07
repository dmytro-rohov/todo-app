#!/bin/bash
# Runs a Tasks image on 127.0.0.1:3197 against a disposable test database, seeds it, then takes headless Chrome
# screenshots or runs a browser test; the container is removed on exit. Loopback only; test databases only.
#
#   TEST_MIGRATION_DATABASE_URL=postgres://tasks_owner:…@127.0.0.1:55440/tasks_test \
#   TEST_DATABASE_URL=postgres://tasks_app:…@127.0.0.1:55440/tasks_test \
#   e2e/ui-run.sh <image> <app|login> <out-prefix> [WxH ...]
#
#   CALENDAR=1 also turns on the booking API for a form served on 127.0.0.1:3198 (e2e/ui-booking.mjs).
#   Modes: app (no login, seeded), login (login screen), accounts (owner / owner-test-password, not seeded).
#   SEED=0 skips seeding (EXTRA=1 / PLANS=1 are passed to ui-seed.sh); LINKS="list calendar task-4" adds one
#   screenshot per #link at the first size; TEST=e2e/ui-smoke.mjs runs that test instead of screenshots.
set -euo pipefail
IMG=$1; MODE=$2; OUT=$3; shift 3
SIZES=${*:-1672x941}
HERE=$(cd "$(dirname "$0")" && pwd)
: "${TEST_MIGRATION_DATABASE_URL:?}" "${TEST_DATABASE_URL:?}"
case "$TEST_MIGRATION_DATABASE_URL$TEST_DATABASE_URL" in *test*) ;; *) echo "refusing: not a test database" >&2; exit 2;; esac
psql "$TEST_MIGRATION_DATABASE_URL" -qc "DROP TABLE IF EXISTS users, clients, calendar_events, calendar_accounts, auth_sessions, task_history, task_time_entries, task_subtasks, task_notes, task_labels, tasks, projects, spaces, assignees, categories CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE;" 2>&1 | grep -v NOTICE || true
docker run --rm --network host --read-only -e MIGRATION_DATABASE_URL="$TEST_MIGRATION_DATABASE_URL" -e APP_DB_ROLE=tasks_app "$IMG" node backend/migrate.js >/dev/null
AUTH=(-e AUTH_DISABLED=true)
CAL=()
if [ -n "${CALENDAR:-}" ]; then
  # CALENDAR=1: a fake Google on 127.0.0.1:3299 and a connected calendar for the Praca space (see ui-seed.sh).
  node "$HERE/fake-google.mjs" & FAKE=$!
  CAL=(-e GOOGLE_CLIENT_ID=dev -e GOOGLE_CLIENT_SECRET=dev -e "TASKS_SECRET_KEY=${TASKS_SECRET_KEY:=$(head -c 32 /dev/urandom | base64)}" -e GOOGLE_DEV_BASE=http://127.0.0.1:3299 -e BOOKING_ORIGINS=http://127.0.0.1:3198)
  export TASKS_SECRET_KEY
fi
[ "$MODE" = login ] && AUTH=(-e AUTH_USERNAME=owner -e "AUTH_PASSWORD_HASH=scrypt:1024:8:1:c2FsdHNhbHQ=:aGFzaGhhc2g=")
# accounts: a real owner login (owner / owner-test-password) for tests that sign in, e.g. e2e/ui-accounts.mjs.
if [ "$MODE" = accounts ]; then
  HASH=$(printf '%s' owner-test-password | docker run --rm -i "$IMG" node backend/scripts/hash-password.js)
  AUTH=(-e AUTH_USERNAME=owner -e "AUTH_PASSWORD_HASH=$HASH")
fi
docker rm -f tasks-ui-run >/dev/null 2>&1 || true
docker run -d --name tasks-ui-run --network host --read-only --tmpfs /tmp -e NODE_ENV=development -e HOST=127.0.0.1 -e PORT=3197 \
  -e DATABASE_URL="$TEST_DATABASE_URL" -e PUBLIC_ORIGIN=http://127.0.0.1:3197 "${AUTH[@]}" "${CAL[@]}" "$IMG" >/dev/null
trap 'docker rm -f tasks-ui-run >/dev/null 2>&1; [ -n "${FAKE:-}" ] && kill "$FAKE" 2>/dev/null' EXIT
for _ in $(seq 1 30); do curl -fs http://127.0.0.1:3197/readyz >/dev/null 2>&1 && break; sleep 1; done
[ "$MODE" = app ] && [ "${SEED:-1}" != 0 ] && bash "$HERE/ui-seed.sh" >/dev/null
if [ -n "${TEST:-}" ]; then rm -rf /tmp/tasks-e2e-profile; node "$TEST"; exit $?; fi
for size in $SIZES; do
  google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size="${size/x/,}" \
    --virtual-time-budget=4000 --screenshot="$OUT-$size.png" http://127.0.0.1:3197/ >/dev/null 2>&1
done
first=${SIZES%% *}
for link in ${LINKS:-}; do
  google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size="${first/x/,}" \
    --virtual-time-budget=4000 --screenshot="$OUT-$link.png" "http://127.0.0.1:3197/#$link" >/dev/null 2>&1
done
ls "$OUT"-*.png
