# Lite13 — PARTIAL, not ready to execute

Source1b93f7c unchanged,101 manifest hashes PASS. Package work preserved.
No foreign worktree, Docker, PostgreSQL or browser accessed. No commit.

P0-1 OPEN: smoke.sh still creates initdb/test fixtures with random secrets and
uses world-readable permissions for container users. No approved UID/ACL contract
has been implemented. Passwords in curl -u argv are another concrete open leak.
Required fix must remove those channels, not merely change documentation.
P0-2 FIXED via fail-closed refusal: ownership labels inspected, but no automated
Docker deletion is performed. Docker lacks atomic compare-label-and-delete here;
cleanup reports project/run and exits failure for manual inspection. No claim race
eliminated. Resources remain until trusted operator verifies IDs and removes them.
Regression asserts no Compose down/prune in package smoke.
P0-3 PARTIAL/OPEN: browser/auth.cjs enforces approved64-hex random credential and
run.cjs consumes it; default test password removed. Two negative/default checks
and valid handoff tested offline. Full same-process browser lifetime/credential
handoff execution remains incomplete; browser was not run.
P0-4 OPEN: exact refs present, but local architecture validation and prevention of
implicit BuildKit resolution for every build stage not completed. No false claim
from operator-provided digest alone.

Actual offline:7 Node package tests +2 Python tests PASS; frontend52/backend128
PASS, both npm ci, Sass/audits PASS with zero vulnerabilities, diff check PASS.
No failed assertions. PostgreSQL suite skipped; real infrastructure BLOCKED.
Read-only operator preflight remains:
SOURCE_DIR=/approved/clean/candidate bash /package/acceptance.sh preflight
Acceptance must NOT run while P0-1/P0-3/P0-4 remain open. No approved execution
command is provided as safe-ready. Potential resources: unique tasks-validation-*
project, internal network, dbdata, app/db/migrate/helpers, two disposable DBs,
loopback3101/55432. Existing ORHEA/MOTO resources must never be selected.
Commit approval still required, but do not freeze this as complete acceptance.
