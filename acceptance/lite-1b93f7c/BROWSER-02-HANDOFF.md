# TASKS-BROWSER-02 — operator handoff

Status: **BLOCKED**. Browser QA: **0/20 (0%) verified**.
Session: `96f75bff-c01a-414c-8b48-25e432f15f9b`.
Branch: `mytko/implementacja-96f75bff`.
Base package SHA: `f9f0cd9efb0e21ab480b126213b01e2afc5c9e80`.
Application candidate: `1b93f7c228cacc569915f00a3b1258da68cc0926`.
Changes for TASKS-BROWSER-02 are uncommitted; the operator must record the final
reviewed package SHA before execution. The application candidate is unchanged.

## Two separate uses

The agent browser tool is controlled by Workflow's project switch and port
allowlist (`browser_preview_ports`), under its sandbox. This package neither
implements that tool nor changes its permissions.

Release browser QA is an explicit operator-approved acceptance action on an
isolated runner. Approval to run acceptance is not permission to turn on a
disabled browser tool, widen its ports, use the host Docker socket from the agent,
or bypass the sandbox. If Workflow requires its manager to issue a separate
release-QA authorization, that interface must be verified before use. Do not
guess a new environment variable or reinterpret project OFF as release ON.

The current package still conservatively blocks OFF/unset via its package-side
`MYTKO_PLAYWRIGHT` declaration. This is not yet a verified manager interface.
No daily pipeline has been changed. Full release acceptance remains an explicit
command requiring browser PASS; preflight PASS alone is not browser QA PASS.

## Required inputs before execution

1. Supply the approved MW-PLAYWRIGHT-01 commit SHA and authorized contract files
   via Workflow context/snapshot. No matching context or snapshot access policy
   was available in this run. Verify policy modes, runtime root, permission and
   port enforcement, browser installation/cache layout, executable selection,
   Node requirements and audit evidence against `browser/runtime-contract.json`.
2. Review any required adapter change. Current declaration requires Playwright
   and playwright-core exactly 1.61.0, Chromium major 149, Node 24. It launches
   Playwright's bundled Chromium without channel/executable overrides and records
   the actual executable and full browser version. It does not use NODE_PATH or
   project-local Playwright. The declared release build 149.0.7827.55 is metadata;
   current enforcement checks major 149. Confirm the intended build policy with
   the manager; do not claim exact-build verification from this check.
3. Operator provides an exact clean candidate checkout (not this implementation
   HEAD), reviewed acceptance package outside that checkout, and explicit approval
   for read-only Docker inspection on the isolated runner. Stack creation and
   cleanup require separate authorization. No Docker command was run here.
4. Supply the existing stack's Compose project and acceptance run ID, its approved
   loopback app port, and a private owner-only mode-600 credential file through
   the operator's protected mechanism. The agent must not read that secret.
   Confirm the port is allowed by Workflow before issuing either command below.

## Exact sequence on the approved operator runner

Set the following in the protected operator environment after contract review.
These paths and identities are placeholders, not discovered or approved values:

```bash
export PACKAGE_DIR=/approved/reviewed-package/acceptance/lite-1b93f7c
export SOURCE_DIR=/approved/clean-lite-candidate
export BROWSER_STACK_PROJECT=tasks-validation-REPLACE
export ACCEPTANCE_RUN_ID=tasks-lite-REPLACE
export TEST_APP_PORT=3101
export AUTH_PASSWORD_FILE=/private/per-run-password
export TASKS_DISPOSABLE_APPROVED=yes
# Only after Workflow has authorized this mode and confirmed this interface:
export MYTKO_PLAYWRIGHT=on
export MYTKO_PLAYWRIGHT_ROOT=/approved/central/runtime

bash "$PACKAGE_DIR/acceptance.sh" browser-only-preflight
```

This command verifies candidate contents, exact HEAD and clean status, credential
file permissions (without reading it), central runtime ownership/permissions and
versions, and an actual headless Chromium launch. It then checks current resource
ownership labels, one running app, candidate image revision, sole loopback port
publication, PUBLIC_ORIGIN, `/readyz` 200 and anonymous `/` 401. HTTP probes have
bounded timeouts. Preflight stops before QA mutations; it does not create, stop
or remove a stack. It prints its private evidence directory before runtime/stack
checks. Runtime or availability failure is not browser PASS.

Only after successful preflight and explicit approval for test data mutations:

```bash
bash "$PACKAGE_DIR/acceptance.sh" browser-only
```

The execution repeats preflight checks against current state; earlier ownership
evidence is insufficient. The operator runner reads the protected password file.
No full E2E, Docker build, startup or cleanup is performed by browser-only.

## Evidence and acceptance

Preserve both printed evidence directories privately (directory 700, files 600).
Check `browser-runtime.json` for actual Playwright, Chromium, executable, Node and
runtime root. Browser QA must produce `browser/summary.json` with PASS and 20/20,
scenario screenshots, desktop/mobile trace ZIPs and `console-desktop.json` /
`console-mobile.json` with page errors, console errors and failed requests.
Console evidence is written even if a viewport scenario fails. A viewport that
never starts has no trace/console artifact; missing artifacts are not a pass.
Traces and logs may contain credentials or application data; do not publish them.

The 20 mandatory scenarios are two authentication-denial checks and nine checks
per viewport: login, assets, category/task creation, edit, move, persistence,
API errors, QA data cleanup, console errors. Preflight performs none of these
20 acceptance scenarios. Failure before launching Chromium means BLOCKED;
policy/runtime checks use exit 3. Failed scenario assertions mean FAIL, exit 1.
Missing source, required inputs or operator approval also prevent acceptance,
even where the shell exits 1/2 instead of 3. No browser launch means no QA PASS.

After actual 20/20 PASS, record final package SHA, candidate SHA, approved manager
SHA, stack identity, evidence location and results in one acceptance bundle.
Retain prior HTTP/PostgreSQL evidence with its original provenance; this browser
run does not rerun it or replace final independent security review.

## Local validation in TASKS-BROWSER-02

| Check | Result |
|---|---|
| Backend and frontend npm ci | PASS |
| Frontend CSS build | PASS |
| Backend tests with loopback NO_PROXY | PASS, 128/128 |
| Frontend tests | PASS, 52/52 |
| Package/runtime contract tests | PASS, 33/33 |
| Stack-check unit tests | PASS, 8/8 |
| Shell syntax and git diff --check | PASS |
| Actual runtime check | BLOCKED, exit 3; Workflow policy unset |
| Actual Chromium / 20 browser scenarios | SKIPPED, 0/20 verified |
| Real PostgreSQL, application health/static smoke | SKIPPED; no approved stack |

These contract/unit tests include stubs and do not prove Chromium launch or
stack ownership. This run did not access Docker, secrets, production, another
worktree, or a global NODE_PATH. It preserved BROWSER-RESUME-REPORT.md.
