# TASKS-06 — security checkpoint, PARTIAL

Session branch mytko/implementacja-96f75bff; base HEAD eeb1035. Incoming TASKS-03,
04 and 05 modifications retained. No production or infrastructure operation.

## Audit and authentication decision

Retain single-owner HTTP Basic over mandatory HTTPS. Salted scrypt hashes,
timing-safe comparisons and short-lived keyed credential digest cache already
exist. Challenge is HTTP 401 with WWW-Authenticate. All application/static/API
routes follow auth middleware; only minimal healthz/readyz precede auth.
No cookies, session identifiers, localStorage passwords/tokens or Workflow auth
integration added. Session fixation is inapplicable to this stateless mechanism.
Native browser login suits desktop/mobile MVP, but reliable app logout and PWA
credential-prompt UX are not guaranteed; do not claim PWA acceptance. A future
session implementation requires separate review if those UX requirements become
mandatory. Closing a tab does not guarantee browser Basic credential eviction.

Existing: strict CSP, nosniff, no-referrer, frame denial, permissions restrictions,
production HSTS, JSON-only writes, Fetch Metadata/Origin CSRF, no permissive CORS,
bounded JSON body, IP rate limits and failed-login lockout. Production config
requires DB/auth/origin and disallows disabled auth. TRUST_PROXY defaults to false;
production permits loopback/explicit proxy peers, not broad private subnet trust.
Only the trusted TLS proxy should reach the loopback-published application port.
In-memory limits require single replica and reset at process restart.
Readiness checks schema/DB with deadline, liveness is independent, graceful shutdown
marks unavailable and drains HTTP before closing DB. Existing deployment manifests
support self-contained OVH hosting; no runtime Fujitsu dependency introduced.

## Changes

CSRF independently rejects foreign Origin even when Fetch Metadata says same-origin.
Default no-store also covers authentication challenges and private HTML/assets.
Database/request error logs now use generic event messages instead of raw driver
messages or user-controlled request paths. Client errors remain generic JSON.

Added tests for anonymous move/PATCH/archive/attachment/export/static paths,
challenge/no-store/no-cookie, conflicting origin metadata and absent CORS grants.
Archive/attachment/export are NOT implemented: these tests only establish the
shared middleware protects unknown paths; they are not feature/download acceptance.
Existing tests cover traversal, auth failure/lockout, proxy spoofing, SQL parameter
validation, headers, malformed/oversized/compressed bodies and generic errors.

## Actual checks this Run

Sass build PASS; frontend 30 PASS / 0 FAIL; backend 122 PASS / 0 FAIL; both npm
audits zero vulnerabilities; git diff --check PASS. PostgreSQL suite skipped.
No real HTTPS/Caddy/OVH tests: BLOCKED awaiting approved infrastructure.
No real attachment filesystem security tests: TASKS-05 upload not implemented.
No DB migration/persistence acceptance: no approved database. No browser/PWA PASS.

## Rotation procedure for operator (not executed)

Use an approved secret entry channel and backend/scripts/hash-password.js as
specified by the production runbook; never put a password in argv, source, logs,
chat or shell history. Store only the hash in protected runtime configuration.
Update the single app credential through Mytko's trusted release mechanism and
restart/recreate the app to clear the verified-credential cache. Verify new
credentials succeed and old credentials receive 401. Rotate any exposed database
credential through the database owner, update runtime secrets and verify readiness;
never rotate from this Session. Basic browser credential caches may need explicit
clearing. No secret values inspected or changed.

## Remaining risks

TASKS-03/04 API/browser/concurrency acceptance and TASKS-05 attachments/archive
are incomplete. Rate limits are per-IP, so reverse proxy trust must match topology;
shared IP lockout can deny the owner. TLS termination and firewall isolation need
real acceptance. Basic Auth is unsuitable for sharing devices without credential
clearing. Health paths reveal availability and must follow the reviewed Caddy policy.
No production readiness claimed. No commit, push, merge or deploy performed.
