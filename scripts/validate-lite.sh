#!/usr/bin/env bash
# Local validation only; no database provisioning, Docker daemon or trusted action.
set -euo pipefail
cd "$(dirname "$0")/.."
export npm_config_cache="$PWD/.npm-cache"
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix frontend test
env -u TEST_DATABASE_URL -u TEST_MIGRATION_DATABASE_URL \
  NO_PROXY=127.0.0.1,localhost,::1 no_proxy=127.0.0.1,localhost,::1 npm --prefix backend test
npm --prefix backend audit --audit-level=high
npm --prefix frontend audit --audit-level=high
bash -n deploy/smoke-test.sh
node --check e2e/lite-acceptance.cjs
git diff --check
