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
| Chromium/browser | BLOCKED | Playwright absent, no approved running QA app |
| TLS/Caddy/security independent review | BLOCKED | no approved environment/reviewer |
| Trusted Validate | BLOCKED | only historical failed e8deeda metadata; no new result |

No assertion failures this Run. Historical trusted failure cannot be attributed
to npm infrastructure without its logs. Workflow operator must inspect deployed
Validate executor registry policy/patch, approve rollout of that infrastructure
fix if needed, then invoke trusted Validate on exact candidate. No such action is
available/allowed to this agent. Local registry success is unrelated evidence.

## Disposable acceptance execution

Operator provisions isolated runner, exact clean candidate checkout, approved
Node24/Postgres17 digests and network access to official registry. Do not use any
existing DEV/ORHEA/MOTO database. No host socket exposed to agent. The script uses
explicit image fetch authorization; smoke never pulls/builds images implicitly.
Do not inherit Docker production credentials/context: use a reviewed local daemon
and sanitized environment. Review source scripts before enabling destructive tests.

```bash
SOURCE_DIR=/operator/provided/clean-candidate \
TASKS_DISPOSABLE_APPROVED=yes ALLOW_IMAGE_FETCH=yes \
NODE_IMAGE=node:24-bookworm-slim@sha256:APPROVED_NODE_DIGEST \
TEST_POSTGRES_IMAGE=postgres:17-alpine@sha256:APPROVED_PG_DIGEST \
bash /path/to/package/acceptance.sh
```

Placeholders deliberately fail digest validation. Script verifies source, clean
status and free loopback ports, captures source/image/provenance/build/smoke logs.
Unique Compose project's own volumes/network only; failure cleanup is not hidden.
Smoke exposes PostgreSQL only on loopback for disposable tests, never publicly.
Production must not publish PostgreSQL. Restore is truly run by smoke once approved,
not by this Session. Inspect logs for each migration/backfill/grant/concurrent-move/
restart/outage/restore assertion. Explicit induced rollback/deadlock acceptance
remains a manual/integration gap; do not mark it PASS from fake-client tests.

Browser needs separate disposable app stack because smoke cleans its project.
Use candidate e2e/lite-acceptance.cjs with supplied Playwright/Chromium:
TASKS_DISPOSABLE_APPROVED=yes E2E_BASE=http://127.0.0.1:3101 node e2e/lite-acceptance.cjs
Record screenshots/traces and console. Script covers desktop/mobile/category/task/
keyboard/mouse/reload/409; manually exercise 401/403/500, network timeout, focus,
form validation, touch and CSRF. Missing automation is not accepted evidence.

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
   loopback ingress, Caddy HTTPS at task.mytko.dev. Use trusted pipeline, not agent.
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
