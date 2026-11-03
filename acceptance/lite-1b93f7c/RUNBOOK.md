# Lite08 acceptance and first release — operator gates

Candidate: 1b93f7c228cacc569915f00a3b1258da68cc0926. Package is a separate source
change requiring its own commit approval; never amend/relabel candidate. Use package
outside a separate clean candidate checkout supplied by trusted Mytko management.
No instructions here authorize production. Full worktree untouched.

## Evidence matrix (2026-11-02 Session sandbox)

| Check | Result | Evidence |
|---|---|---|
| Exact candidate source, 101 SHA256 entries | PASS | python3 verify.py SOURCE_DIR |
| Backend 128 tests | PASS | evidence/local-validation.log |
| Frontend 52 tests | PASS | same log |
| npm ci both/build/audit | PASS, zero vulnerabilities | same log |
| Docker Compose contracts, no daemon | PASS within backend tests | same log |
| Shell syntax / diff check | PASS | bash -n acceptance.sh; git diff --check |
| PostgreSQL integration suite | SKIP | no TEST_* URLs, log; zero skipped individual tests |
| PG17, DB roles, migration/backfill/concurrency | BLOCKED | no approved disposable DB |
| Docker build/runtime/restart/outage | BLOCKED | socket /var/run/docker.sock absent |
| Real backup/restore | BLOCKED | same runner requirement |
| Chromium/browser | BLOCKED | runner prepared for central Playwright 1.61.0/Chromium 149; not executed in Session (no runtime, no stack) |
| Browser runner contracts | PASS | node --test package.test.cjs browser/runtime.test.cjs; python3 browser/stack_check.test.py |
| TLS/Caddy/security independent review | BLOCKED | no approved environment/reviewer |
| Trusted Validate | BLOCKED | only historical failed e8deeda metadata; no new result |

No assertion failures this Run. Historical trusted failure cannot be attributed
to npm infrastructure without its logs. Workflow operator must inspect deployed
Validate executor registry policy/patch, approve rollout of that infrastructure
fix if needed, then invoke trusted Validate on exact candidate. No such action is
available/allowed to this agent. Local registry success is unrelated evidence.

## Disposable acceptance execution

Operator provisions an isolated runner, an exact clean candidate checkout, and
preloads the approved Node24/Postgres17 digests. Do not use any existing
DEV/ORHEA/MOTO database or registry access. No host socket is exposed to this
agent. Preflight and execute verify the local RepoDigests and use pull-disabled
Docker operations throughout.
Do not inherit Docker production credentials/context: use a reviewed local daemon
and sanitized environment. Review source scripts before enabling destructive tests.

The package's `images.env` contains the approved immutable references; it is
configuration only and contains no credentials. From the clean candidate checkout
with this package at `acceptance/lite-1b93f7c/`, run the exact handoff below.

```bash
SOURCE_DIR="$PWD" TASKS_DISPOSABLE_APPROVED=yes \
MYTKO_PLAYWRIGHT=on MYTKO_PLAYWRIGHT_ROOT=/approved/central/runtime \
bash acceptance/lite-1b93f7c/acceptance.sh execute
```

The script verifies source, clean status, local RepoDigests, Linux/amd64 image
metadata and free loopback ports. It captures source/build/smoke evidence and all
Docker operations are explicitly pull-disabled. The browser stage runs before the
per-run stack cleanup, using the random password generated for that stack.
Unique Compose project's own volumes/network only; failure cleanup is not hidden.
Smoke exposes PostgreSQL only on loopback for disposable tests, never publicly.
Production must not publish PostgreSQL. Restore is truly run by smoke once approved,
not by this Session. Inspect logs for each migration/backfill/grant/concurrent-move/
restart/outage/restore assertion. Explicit induced rollback/deadlock acceptance
remains a manual/integration gap; do not mark it PASS from fake-client tests.

### Browser QA — central Workflow Playwright (MW-PLAYWRIGHT-01)

For TASKS-BROWSER-02 use [BROWSER-02-HANDOFF.md](BROWSER-02-HANDOFF.md), including
the pending manager-contract approval, separate agent/release authorization and
`browser-only-preflight` command. The examples below do not authorize changing
Workflow policy or its port allowlist. Browser QA remains an explicit release
acceptance action, not a required daily pipeline stage.

Playwright is resolved only from the central Mytko Workflow runtime declared in
`browser/runtime-contract.json`: exactly Playwright 1.61.0 (+ playwright-core
1.61.0) and Chromium major 149. No per-project install; `browser/package.json`
keeps the historical 1.56.1 pin for reference only and is never resolved.
Changing the version is a reviewed edit of the contract file. Env names below are
the package-side declaration; confirm them against the Workflow definition.

| Variable | Meaning |
|---|---|
| `MYTKO_PLAYWRIGHT=on` | Workflow policy switch. OFF/unset/other => exit 3 BLOCKED, never skipped |
| `MYTKO_PLAYWRIGHT_ROOT` | absolute central root containing `node_modules/playwright`; must be outside the checkout and package, owned by root/runner user, not group/world-writable, no symlinks |

`preflight` and `execute` launch Chromium (`--no-proxy-server`, headless) and
check its major version before any build or stack start; `execute` writes
`browser-runtime.json`. Full `execute` fails unless `browser/summary.json`
reports every mandatory scenario PASS. Report status is PASS, FAIL or BLOCKED.

Mandatory scenarios (desktop 1440x900 and mobile 390x844): anonymous and wrong
password get 401 for shell and API; valid login renders the board; stylesheet and
ES modules load with correct MIME and applied rules; create + rename category and
create task; edit task; keyboard move between columns; reload persistence; API
errors (409 move without retry, 500 and network failure on refresh keep the board,
400 on save stays in the dialog, recovery clears the message) and mouse drag to
done; cleanup of QA data; no page errors and no console errors beyond the
injected failures. Evidence in `$EVIDENCE_DIR/browser/`: numbered screenshots
per scenario (FAIL screenshots on failure), `trace-desktop.zip`,
`trace-mobile.zip`, `summary.json` (versions, Chromium executable, per-scenario
status). Traces contain the per-run Basic credential: keep the evidence private
(mode 700/600) until that stack is removed.

The disposable stack sets `PUBLIC_ORIGIN` to the loopback browser origin.
Chromium sends `Origin` on same-origin writes, so the previous
`https://task.mytko.dev` value made CSRF reject every browser write (403). Stacks
started before this change cannot be used for browser QA.

Browser-only (not full E2E) on a stack already started by this package:

```bash
SOURCE_DIR="$PWD" TASKS_DISPOSABLE_APPROVED=yes MYTKO_PLAYWRIGHT=on \
MYTKO_PLAYWRIGHT_ROOT=/approved/central/runtime \
BROWSER_STACK_PROJECT=tasks-validation-... ACCEPTANCE_RUN_ID=tasks-lite-... \
AUTH_PASSWORD_FILE=/private/path/mode-600 \
bash acceptance/lite-1b93f7c/acceptance.sh browser-only
```

It first runs read-only `browser/stack_check.py`: ownership labels of every
resource, exactly one running app on the exact candidate image, published only on
`127.0.0.1:<port>`, no other publisher of that port, `PUBLIC_ORIGIN` equal to the
browser origin, then `/readyz` 200 and `/` 401. It never starts, stops or removes
Docker resources. Still manual: touch hardware, focus order review, CSRF from a
real cross-site page.

## OVH first publication — separate approval mandatory

1. Independent review of exact source and all above evidence; current main/PR checks.
   Mytko creates PR, approved merge and immutable release artifact; no Fast Track.
2. Operator prepares OVH host firewall/TLS/private network, dedicated PostgreSQL17
   persistent data volume, least-privilege tasks_app and schema owner tasks_owner.
   No other project membership/grants; verify public schema/CONNECT defaults.
3. Use reviewed deploy/db-roles.sql.example, compose.yaml, Caddyfile.example and
   env examples from candidate. Fill secrets through trusted protected channel,
   chmod600; no secrets in argv/logs/Git. Runtime app has no owner credentials.
   Production DB has no public port. Verify TLS/CA if crossing hosts, exact proxy peers.
4. Pin app image by digest and Node/PG provenance; pre-release pg_dump and actual
   scratch restore. Existing DB migration requires identity/backup approval;
   first empty DB still verify current_database/current_user and server17.
5. Approved migration service runs owner URL, ledger 001–003; inspect grants and
   readiness. App compose starts exact image with CPU/RAM/PIDs, nonroot/read-only,
   loopback ingress, Caddy HTTPS at tasks.mytko.dev. Use trusted pipeline, not agent.
6. Approved post-deploy: internal healthz/readyz; external HTTPS/auth challenge,
   authorized page/API/static CSP, create/read/edit/reopen/delete disposable task,
   ordering/reload, categories and error checks. Verify no readiness public exposure.
7. Observe resource/DB/disk/backup metrics and redacted logs. No runtime Fujitsu or
   Workflow call required. Operator alone controls rollout/rollback/Ship.
8. STOP on migration/readiness/security/data failure. Roll back image only if N-1
   schema compatibility was rehearsed. Otherwise forward repair or separately
   approved restore with write-loss assessment; no automatic down migration.
9. Hotfix via Mytko-assigned isolated branch, regression/Validate/review, immutable
   artifact and approval. Never live-edit production or reuse mutable release tags.

This is an executable preparation package, not proof of provisioned OVH resources.
PR readiness: source review possible. Publication: NO-GO until actual acceptance.


## Exact handoff

Run from the clean candidate checkout after placing this package at
`acceptance/lite-1b93f7c/`:

```bash
SOURCE_DIR="$PWD" TASKS_DISPOSABLE_APPROVED=yes \
MYTKO_PLAYWRIGHT=on MYTKO_PLAYWRIGHT_ROOT=/approved/central/runtime \
bash acceptance/lite-1b93f7c/acceptance.sh preflight
SOURCE_DIR="$PWD" TASKS_DISPOSABLE_APPROVED=yes \
MYTKO_PLAYWRIGHT=on MYTKO_PLAYWRIGHT_ROOT=/approved/central/runtime \
bash acceptance/lite-1b93f7c/acceptance.sh execute
```

Preflight is read-only and validates the exact local images. Execute builds with
`--pull=false`, starts the labeled disposable stack with `--pull never`, runs the
smoke and integrated browser stages, then preserves redacted evidence while
refusing automatic Docker cleanup. Do not declare E2E PASS until this command
completes on the approved disposable runner.
