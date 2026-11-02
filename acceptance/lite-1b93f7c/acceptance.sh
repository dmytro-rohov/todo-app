#!/usr/bin/env bash
# Run only by operator on an approved disposable runner, from repository root.
set -euo pipefail
umask 077
phase=preflight
MODE=${1:-run}
repo_digest_matches() {
  local image=$1
  local repo_digest=$2
  local image_repo=${image%@*}
  local expected_digest=${image##*@}
  local repo=${repo_digest%@*}
  local digest=${repo_digest##*@}

  case "$image_repo" in
    docker.io/library/node|node)
      [[ "$repo" == docker.io/library/node || "$repo" == node ]] || return 1
      ;;
    docker.io/library/postgres|postgres)
      [[ "$repo" == docker.io/library/postgres || "$repo" == postgres ]] || return 1
      ;;
    *)
      return 1
      ;;
  esac
  [[ "$expected_digest" =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
  [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
  [[ "$digest" == "$expected_digest" ]]
}
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
source "$PACKAGE_DIR/images.env"
export NODE_IMAGE TEST_POSTGRES_IMAGE
[[ $(uname -m) == x86_64 ]]
command -v ss
command -v curl
docker compose version
check_image() {
  local image=$1
  docker image inspect "$image" >/dev/null || { echo "FAIL phase=preflight error=image_not_local image=$image" >&2; exit 1; }
  [[ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" == linux/amd64 ]] || { echo "FAIL phase=preflight error=image_platform image=$image" >&2; exit 1; }
  local digest_match=0
  while IFS= read -r repo_digest; do
    if repo_digest_matches "$image" "$repo_digest"; then digest_match=1; break; fi
  done < <(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image")
  (( digest_match == 1 )) || { echo "FAIL phase=preflight error=image_digest image=$image" >&2; exit 1; }
}
check_image "$NODE_IMAGE"
check_image "$TEST_POSTGRES_IMAGE"
docker info >/dev/null
[[ -z $(docker ps -q --filter publish=3101) ]]
[[ -z $(docker ps -q --filter publish=55432) ]]
[[ -z $(ss -H -ltn 'sport = :3101') ]]
[[ -z $(ss -H -ltn 'sport = :55432') ]]
if [[ $MODE == preflight ]]; then echo "PASS read-only source/image/port preflight; HTTP readiness checked only after stack start"; exit 0; fi
export EVIDENCE_DIR
EVIDENCE_DIR=$(mktemp -d /tmp/tasks-lite07-evidence.XXXXXX)
REPORT="$EVIDENCE_DIR/acceptance-report.json"
trap 'code=$?; status=FAIL; [[ $code == 0 ]] && status=PASS; printf "{\"status\":\"%s\",\"phase\":\"%s\",\"error\":null}\n" "$status" "${phase:-unknown}" > "$REPORT"; exit "$code"' EXIT
printf '%s\n' "$EXPECTED_SOURCE_SHA" > "$EVIDENCE_DIR/source.txt"
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
phase=smoke
printf 'Preserve evidence: %s\nBrowser QA and independent security review remain required.\n' "$EVIDENCE_DIR"
