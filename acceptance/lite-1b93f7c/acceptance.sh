#!/usr/bin/env bash
# Run only by operator on an approved disposable runner, from repository root.
set -euo pipefail
umask 077
MODE=${1:-run}
if [[ $MODE != preflight ]]; then [[ ${TASKS_DISPOSABLE_APPROVED:-} == yes ]] || { echo "Disposable runner approval required" >&2; exit 2; }; fi
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
docker info >/dev/null
[[ -z $(docker ps -q --filter publish=3101) ]]
[[ -z $(docker ps -q --filter publish=55432) ]]
[[ -z $(ss -H -ltn 'sport = :3101') ]]
[[ -z $(ss -H -ltn 'sport = :55432') ]]
[[ $MODE != preflight ]] || { echo "PASS read-only preflight; images require approved fetch and local platform verification"; exit 0; }
export EVIDENCE_DIR
EVIDENCE_DIR=$(mktemp -d /tmp/tasks-lite07-evidence.XXXXXX)
printf '%s\n' "$EXPECTED_SOURCE_SHA" > "$EVIDENCE_DIR/source.txt"
bash scripts/validate-lite.sh 2>&1 | tee "$EVIDENCE_DIR/local-validation.log"
docker buildx imagetools inspect "$NODE_IMAGE" > "$EVIDENCE_DIR/node-provenance.txt"
docker buildx imagetools inspect "$TEST_POSTGRES_IMAGE" > "$EVIDENCE_DIR/postgres-provenance.txt"
[[ ${ALLOW_IMAGE_FETCH:-} == yes ]] || { echo 'Explicit approved image-fetch permission required' >&2; exit 2; }
docker pull "$NODE_IMAGE"
docker pull "$TEST_POSTGRES_IMAGE"
docker buildx build --load --build-arg NODE_IMAGE="$NODE_IMAGE" --build-arg GIT_REVISION="$EXPECTED_SOURCE_SHA" -t "mytko-tasks:qa-$EXPECTED_SOURCE_SHA" . 2>&1 | tee "$EVIDENCE_DIR/build.log"
export TEST_IMAGE TEST_POSTGRES_IMAGE
TEST_IMAGE=$(docker image inspect --format '{{.Id}}' "mytko-tasks:qa-$EXPECTED_SOURCE_SHA")
[[ $TEST_IMAGE =~ ^sha256:[a-f0-9]{64}$ ]]
[[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$TEST_IMAGE") == "$EXPECTED_SOURCE_SHA" ]]
docker image inspect "$TEST_IMAGE" | python3 "$PACKAGE_DIR/redact.py" > "$EVIDENCE_DIR/image.json"
export ACCEPTANCE_RUN_ID="tasks-lite-$(date +%s)-$$"
bash "$PACKAGE_DIR/smoke.sh" 2>&1 | tee "$EVIDENCE_DIR/smoke.log"
printf 'Preserve evidence: %s\nBrowser QA and independent security review remain required.\n' "$EVIDENCE_DIR"
