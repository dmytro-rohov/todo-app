# DB acceptance01 — source checkpoint, infrastructure NOT RUN

New independent entrypoint (same package):
SOURCE_DIR=/approved/clean/candidate python3 /package/db-only preflight
SOURCE_DIR=/approved/clean/candidate TASKS_DB_APPROVED=yes python3 /package/db-only execute

Preflight reads Docker metadata only, verifies source101 hashes, local PG image
RepoDigest/linux/amd64, local pg Node dependency and loopback55432 availability.
No downloads or host mutations in preflight. Execute requires separate approval.
Requires installed candidate backend node_modules (npm ci with approved registry),
Python3/Node24/local Docker and preloaded exact PG17 image specified in db-only.
No additional image required. No HTTP app, auth or Playwright invoked.

Creates tasks-db-<random> container, internal network and named data volume,
127.0.0.1:55432 only, random PostgreSQL passwords, source tasks_test, restore
 tasks_restore_test and dedicated roles. Passwords passed in environment/stdin,
never literal argv/log/evidence. No secret fixture files. Evidence directory0700,
result contains exact container/volume/network IDs and source SHA. No automatic
Docker stop/remove/prune, including on failure. Operator inspects retained IDs.
Test process and DB statements bounded. Source is disposable only; no ORHEA/MOTO
or populated DEV allowed. Internal network/published loopback reachability requires
real runner validation; no false infrastructure PASS.

Implemented suite: migrations001–003, baseline historical completed record,
ledger checksum equality/repeat migrate, SQL category CRUD/FK clearing, role DDL
denial, direct move/conflict/record preservation, rollback,55P03/57014, independent
backup restore schema/data/ledger compare, invalid archive refusal and both DBs
unchanged. HTTP deliberately absent. Diagnostics40P01 exists in package transaction
test but is NOT yet wired to db-only; full opposite-direction matrix/dense ordering
and partial-second-write rollback assertions still need completing. Therefore
this is not a complete PG acceptance claim and execute is not acceptance-ready.

Full runner P0 remain: smoke.sh curl -u argv and readable secret fixtures,
browser credential lifetime, implicit BuildKit pulls. db-only does not call those
paths. No code-level blocker requires inventing infrastructure approval; these
are unfinished implementation work. Do not approve full smoke as safe-ready.

Actual offline this Run:9 Node package tests +2 Python PASS; frontend52/backend128
PASS, npm ci/Sass/audits PASS (zero vulnerabilities), syntax/diff and101 manifest
PASS. PG integration suite SKIP. Docker/PG/browser NOT RUN. Candidate1b93f7c
unchanged, package untracked, no commit. No readiness claim for production.
Status BLOCKED for full acceptance; db-only preflight available for read-only review.

## DB-02 current implementation checkpoint (supersedes unfinished DB-only notes)

40P01 diagnostic now wired directly, both transactions rollback and locks rechecked;
20 deterministic concurrent-move cases cover same/different/opposite/same-task,
require [200,409] for actual changed snapshots, verify dense positions/IDs/readback
and stale snapshots. Mid-move second-update fault verifies status/position/
completed_at/updated_at rollback, reusable pool and safe retry after known rollback.
CRUD includes priority/deadline/completion/reopen and FK clearing. No HTTP involved.
Runtime statements bounded5s, diagnostic6s, whole suite180s. Failure test output
retained without raw SQL/credentials. PG target checks database session run marker
before test writes. Docker uses explicit local Engine socket only on operator host;
agent never invokes it. No image fetch or automatic resource removal.

Actual offline DB-02: 5 db-only Python +2 ownership Python +9 Node package tests
PASS, application frontend52/backend128 PASS, ci/Sass/audits/diff/manifest PASS.
Real PG NOT RUN. Full smoke/browser P0 remain separate and do not block the
independent DB-only pilot. Ready for source review/commit approval and read-only
operator DB preflight; not production GO. Existing older DB-only incomplete notes
are historical and superseded only for code now implemented.

### Git delivery without copying untracked files

Operator first approves package commit:
TASKS-DB: add isolated PostgreSQL acceptance and recovery tests
Agent stages reviewed acceptance/ only, excludes caches/node_modules/generated
secrets, reports full resulting PACKAGE_SHA. No commit authorized yet in this Run.
Mytko publishes approved commit through trusted mechanism. From an existing
operator-authorized repository containing both commits, these Bash commands create
an archive checkout rather than change any branch/worktree:

```bash
set -euo pipefail
read -r -p 'Full approved acceptance package commit SHA: ' PACKAGE_SHA
[[ "$PACKAGE_SHA" =~ ^[a-f0-9]{40}$ ]]
git cat-file -e "$PACKAGE_SHA^{commit}"
PILOT_DIR=$(mktemp -d /tmp/tasks-db-pilot.XXXXXX)
chmod 700 "$PILOT_DIR"
mkdir "$PILOT_DIR/package" "$PILOT_DIR/source"
git archive "$PACKAGE_SHA" acceptance/lite-1b93f7c | tar -x -C "$PILOT_DIR/package"
# verify.py requires a real clean Git checkout: ask Mytko to provide that exact
# candidate checkout and enter its actual directory (no automatic Git mutations).
read -r -e -p 'Mytko-provided clean candidate checkout directory: ' SOURCE_DIR
export SOURCE_DIR
PACKAGE_DIR="$PILOT_DIR/package/acceptance/lite-1b93f7c"
python3 "$PACKAGE_DIR/db-only" preflight
# Stop here and obtain explicit operator approval for listed resources.
TASKS_DB_APPROVED=yes python3 "$PACKAGE_DIR/db-only" execute
```

Preflight uses only local PG17 image inspect, source/dependency/port checks. It
creates nothing. It rejects DOCKER/PG/NODE target overrides; use a sanitized shell.
Execute creates random-labeled internal network, named DB volume, container and
loopback55432 publication, source/restore DBs and random roles. No extra tool image.
Evidence /tmp/tasks-db-evidence.* result.json contains exact IDs and status;
secrets absent. Interrupts retain resources intentionally. Operator verifies those
IDs and dev.mytko.acceptance labels by inspect, stops/removes that exact container,
then exact network and volume only after explicit cleanup approval. No global
prune, no project-wide selectors, no ORHEA/MOTO operations. Do not paste full
container inspect (Env secrets) into reports. Full independent security review
and real pilot evidence still required; READY FOR DB PREFLIGHT is not PG PASS.
