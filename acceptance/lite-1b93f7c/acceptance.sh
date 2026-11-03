#!/usr/bin/env bash
# Run only by operator on an approved disposable runner, from repository root.
set -euo pipefail
umask 077
phase=preflight
MODE=${1:-run}
export PACKAGE_DIR
PACKAGE_DIR=$(cd "$(dirname "$0")" && pwd)
source "$PACKAGE_DIR/image-validation.sh"
if [[ $MODE == test-repo-digest ]]; then
  repo_digest_matches "$2" "$3"
  exit $?
fi
if [[ $MODE != preflight ]]; then [[ ${TASKS_DISPOSABLE_APPROVED:-} == yes ]] || { echo "Disposable runner approval required" >&2; exit 2; }; fi
phase=execute
export PACKAGE_DIR
PACKAGE_DIR=$(cd "$(dirname "$0")" && pwd)
: "${SOURCE_DIR:?clean exact candidate checkout supplied by Mytko}"
python3 "$PACKAGE_DIR/verify.py" "$SOURCE_DIR"
cd "$SOURCE_DIR"
EXPECTED_SOURCE_SHA=1b93f7c228cacc569915f00a3b1258da68cc0926
[[ $(git rev-parse HEAD) == "$EXPECTED_SOURCE_SHA" ]]
[[ -z $(git status --porcelain) ]]
# Loopback QA must never go through an inherited proxy (Node 24 NODE_USE_ENV_PROXY).
export NO_PROXY=127.0.0.1,localhost,::1 no_proxy=127.0.0.1,localhost,::1
start_evidence() { # start_evidence <prefix>: private evidence dir + JSON report on exit
  EVIDENCE_DIR=$(mktemp -d "/tmp/$1.XXXXXX")
  export EVIDENCE_DIR
  REPORT="$EVIDENCE_DIR/acceptance-report.json"
  trap 'code=$?; status=FAIL; [[ $code == 0 ]] && status=PASS; [[ $code == 3 ]] && status=BLOCKED; printf "{\"mode\":\"%s\",\"status\":\"%s\",\"phase\":\"%s\",\"error\":null}\n" "$MODE" "$status" "${phase:-unknown}" > "$REPORT"; exit "$code"' EXIT
  printf '%s\n' "$EXPECTED_SOURCE_SHA" > "$EVIDENCE_DIR/source.txt"
}
browser_runtime() { # Workflow Playwright policy, central module, real Chromium launch
  node "$PACKAGE_DIR/browser/runtime.cjs" check "${1:-}" || { local code=$?; echo "FAIL phase=$phase error=browser_runtime" >&2; exit "$code"; }
}
require_browser_pass() {
  python3 - "$EVIDENCE_DIR/browser/summary.json" <<'PY'
import json, sys
summary = json.load(open(sys.argv[1]))
print(f"browser summary {summary['status']} {summary['passed']}/{summary['total']}")
sys.exit(0 if summary['status'] == 'PASS' and summary['passed'] == summary['total'] else 1)
PY
}
if [[ $MODE == browser-only || $MODE == browser-only-preflight ]]; then
  # Browser QA only, on a stack started earlier by this package. NOT full E2E.
  phase=browser-only-preflight
  : "${BROWSER_STACK_PROJECT:?compose project of the approved running stack}" "${ACCEPTANCE_RUN_ID:?run id of that stack}"
  : "${AUTH_PASSWORD_FILE:?mode 600 file holding the per-run password of that stack}"
  E2E_BASE="http://127.0.0.1:${TEST_APP_PORT:-3101}"
  [[ -f $AUTH_PASSWORD_FILE && ! -L $AUTH_PASSWORD_FILE && -O $AUTH_PASSWORD_FILE && $(stat -c %a "$AUTH_PASSWORD_FILE") == 600 ]] \
    || { echo "BLOCKED phase=$phase error=auth_password_file_permissions" >&2; exit 3; }
  start_evidence tasks-browser-only-evidence
  printf 'Preserve evidence: %s\n' "$EVIDENCE_DIR"
  browser_runtime "$EVIDENCE_DIR"
  python3 "$PACKAGE_DIR/browser/stack_check.py" "$BROWSER_STACK_PROJECT" "$ACCEPTANCE_RUN_ID" "$E2E_BASE"
  [[ $(curl --noproxy '*' --connect-timeout 3 --max-time 10 -s -o /dev/null -w '%{http_code}' "$E2E_BASE/readyz") == 200 ]] || { echo "BLOCKED phase=$phase error=stack_not_ready" >&2; exit 3; }
  [[ $(curl --noproxy '*' --connect-timeout 3 --max-time 10 -s -o /dev/null -w '%{http_code}' "$E2E_BASE/") == 401 ]] || { echo "BLOCKED phase=$phase error=stack_not_protected" >&2; exit 3; }
  if [[ $MODE == browser-only-preflight ]]; then
    echo "PASS browser-only preflight; QA scenarios have not run"
    exit 0
  fi
  phase=browser
  AUTH_PASSWORD=$(<"$AUTH_PASSWORD_FILE")
  E2E_BASE="$E2E_BASE" AUTH_PASSWORD="$AUTH_PASSWORD" TASKS_DISPOSABLE_APPROVED=yes BROWSER_EVIDENCE_DIR="$EVIDENCE_DIR/browser" \
    node "$PACKAGE_DIR/browser/run.cjs"
  require_browser_pass
  printf 'Preserve evidence: %s\nBrowser-only PASS is not full E2E acceptance.\n' "$EVIDENCE_DIR"
  exit 0
fi
source "$PACKAGE_DIR/images.env"
export NODE_IMAGE TEST_POSTGRES_IMAGE
[[ $(uname -m) == x86_64 ]]
command -v ss
command -v curl
docker compose version
check_image "$NODE_IMAGE"
check_image "$TEST_POSTGRES_IMAGE"
docker info >/dev/null
[[ -z $(docker ps -q --filter publish=3101) ]]
[[ -z $(docker ps -q --filter publish=55432) ]]
[[ -z $(ss -H -ltn 'sport = :3101') ]]
[[ -z $(ss -H -ltn 'sport = :55432') ]]
if [[ $MODE == preflight ]]; then
  browser_runtime
  echo "PASS read-only source/image/port/browser-runtime preflight; HTTP readiness checked only after stack start"
  exit 0
fi
start_evidence tasks-lite07-evidence
phase=browser-runtime
browser_runtime "$EVIDENCE_DIR"
phase=execute
bash scripts/validate-lite.sh 2>&1 | tee "$EVIDENCE_DIR/local-validation.log"
docker buildx build --pull=false --platform linux/amd64 --load --build-arg NODE_IMAGE="$NODE_IMAGE" --build-arg GIT_REVISION="$EXPECTED_SOURCE_SHA" -t "mytko-tasks:qa-$EXPECTED_SOURCE_SHA" . 2>&1 | tee "$EVIDENCE_DIR/build.log"
export TEST_IMAGE TEST_POSTGRES_IMAGE
TEST_IMAGE=$(docker image inspect --format '{{.Id}}' "mytko-tasks:qa-$EXPECTED_SOURCE_SHA")
[[ $TEST_IMAGE =~ ^sha256:[a-f0-9]{64}$ ]]
[[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$TEST_IMAGE") == "$EXPECTED_SOURCE_SHA" ]]
docker image inspect "$TEST_IMAGE" | python3 "$PACKAGE_DIR/redact.py" > "$EVIDENCE_DIR/image.json"
export ACCEPTANCE_RUN_ID="tasks-lite-$(date +%s)-$$"
phase=smoke
bash "$PACKAGE_DIR/smoke.sh" 2>&1 | tee "$EVIDENCE_DIR/smoke.log"
# Full E2E requires every mandatory browser scenario to PASS.
phase=browser-verify
require_browser_pass
printf 'Preserve evidence: %s\nIndependent security review remains required.\n' "$EVIDENCE_DIR"
