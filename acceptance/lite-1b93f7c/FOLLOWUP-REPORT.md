# Follow-up after Copilot — DB04 and runner corrections

HEAD7cae2bcdce4125bb529e2906d8ad38ae2fdcd8d1 already contains DB04 network fix.
Incoming6 dirty files preserved and corrected; no commit made without approval.
Application candidate1b93f7c immutable,101 hashes checked against Git bytes.

Fixed broken ownership verify import and unsafe deletion path: automatic Docker
removal is refused. Fixed preflight requiring live HTTP app before stack start.
Private temp dir stays0700/files0600; init roles via stdin instead of world-readable
secret SQL mount. Copied release probe uses env auth, not password in source.
Helper containers use host fixture-owner UID/GID, so no chmod a+r/a+rx needed.
Trap installed immediately after temp creation, secret files removed on exit,
resources retained. curl credentials use protected config. No raw Compose logs
persisted by cleanup. Compose network non-internal/no masquerading enables host
publishing while keeping app/DB communication; actual firewall still operator gate.

Actual follow-up:11 package Node tests PASS,8 db-only Python+2 ownership PASS,
frontend52/backend128 PASS, npm ci/build/audits PASS, zero vulnerabilities,
manifest101 and git diff --check PASS. No real Docker/PG/browser operation.
Copilot's contradictory cleanup test expected deletion text; corrected to refusal.

DB04 source fix READY FOR DB RETEST after operator approval. Already committed
SHA7cae2bc is not the SHA of these further dirty full-runner corrections.
Full runner still needs real build/Compose/browser acceptance; --pull=false alone
does not guarantee BuildKit will never resolve remote frontend/base metadata.
Do not treat this report as permission to run full acceptance or deploy.
For db-only use clean app checkout1b93f7c via SOURCE_DIR, package at reviewed SHA:
python3 acceptance/lite-1b93f7c/db-only preflight
Then explicit separate TASKS_DB_APPROVED=yes execution approval. Do not restart or
remove old pilot resources. Record binding, SQL bootstrap, migration/concurrency/
rollback/restore evidence. No PASS for those real steps inferred from unit tests.
