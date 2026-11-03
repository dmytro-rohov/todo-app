# MW-TASKS-SEC-DEPENDENCIES-01 (2026-10-31)

Baseline: 603a5533efc93dd3335b1572dad8626c5e519e78; seven existing Session
commits preserved. Worktree initially clean. No production access, service
activation, database provisioning, Caddy host changes or deployment occurred.

## Findings and minimal compatible fixes

`npm ls` and `npm explain` against installed backend dependencies confirm:

| Package | Old -> fixed | Dependency path | Runtime scope |
|---|---|---|---|
| proxy-addr | 2.0.7 -> **2.0.8** | express 5.2.1 -> proxy-addr | production, critical |
| body-parser | 2.2.2 -> **2.4.0** | express 5.2.1 -> body-parser | production, high |
| qs | 6.15.1 -> **6.16.2** | express and body-parser -> qs | production, moderate (also current low fix) |
| brace-expansion | 5.0.6 -> **5.0.12** | nodemon 3.1.14 -> minimatch 10.2.5 -> brace-expansion | dev only, high; fixed too |

All four pins satisfy the existing parents' semver ranges. They are temporary,
exact npm overrides, not new direct runtime dependencies. Express 5.2.1, pg
8.21.0, nodemon 3.1.14 and frontend Sass 1.89.2 remain unchanged. Remove or revise
overrides only with a reviewed lockfile and fresh audit. No audit fix/force or
blanket dependency update was used.

The body-parser/qs update also resolves supporting dependencies: iconv-lite
0.7.3, type-is 2.1.0, two nested content-type 2.1.0 entries, side-channel 1.1.1;
npm also refreshed es-object-atoms to 1.1.2 and hasown to 2.0.4 in that subtree.
The generated lockfile diff was reviewed; frontend manifest/lockfile and tracked
CSS/SCSS were not modified.

Primary advisory references:

- [proxy-addr GHSA-jqcg-44mw-7w3h](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h): patch 2.0.8.
- [body-parser GHSA-27r3-jxmh-p828](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828): patch 2.4.0; trailing compressed data can crash older parsers.
- [brace-expansion GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr): 5.0.12 also covers the earlier high recursion/allocation fixes (5.0.7–5.0.11).
- [qs GHSA-6pq8-jhm2-2vcw](https://github.com/ljharb/qs/security/advisories/GHSA-6pq8-jhm2-2vcw): moderate fixed in 6.16.1.
- [qs GHSA-w4cr-vjpx-p82q](https://github.com/ljharb/qs/security/advisories/GHSA-w4cr-vjpx-p82q): additional low fix backported to 6.16.2, avoiding a 6.17 upgrade.

## Proxy contract and protections

[Express documentation](https://expressjs.com/en/guide/behind-proxies/) requires
trust to match the actual topology. [Caddy defaults](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults)
ignore client-supplied X-Forwarded-* values and construct proxy headers. Keep
that default for the direct-client -> Caddy -> Tasks topology; no CDN or extra
trusted proxy is assumed. Do not enable broad global Caddy trusted_proxies as
an incidental fix. The existing repository Caddy example is unchanged here.

Production TRUST_PROXY now permits false/empty, loopback, explicit IPs or host
CIDRs (/32 IPv4, /128 IPv6). It rejects true, hop counts, uniquelocal, and broad
subnets, including the advisory's short mapped-IPv6 prefix. This is deliberately
stricter than proxy-addr itself. The prior plain private subnet configuration was
not the specific mapped-prefix vulnerability, but trusted more peers than needed.

The app.env template defaults conservatively to loopback. Host Caddy through
Docker commonly appears as a bridge gateway: the operator must establish its
actual source IP and add only that address, e.g. loopback,172.18.0.1/32 (example,
not a discovered value). Until set correctly, forwarded IPs are ignored and
users may share the peer's rate budget. Existing env files containing
"loopback, uniquelocal" must be corrected by the operator before release; the
new production config intentionally refuses them. Nothing edited host env files.
Only loopback publishing and the intended proxy may reach the production app.
Local/host processes remain within the trusted-host security boundary.

Rate-limit and login-failure keys canonicalize IPv6 and IPv4-mapped IPv6 using
Node's built-in SocketAddress, so alternate spellings cannot create new buckets.
No new dependency is needed. Tests verify untrusted direct XFF is ignored,
trusted chains stop at the nearest untrusted hop, equivalent mapped addresses
share both budgets, and proxy-addr rejects the advisory's short-prefix bypass.

JSON stays limited to **10 KiB (10240 bytes)**. Compressed request bodies are
not required for these small payloads and are explicitly rejected with 415
before decompression (inflate:false), in addition to installing patched
body-parser. Tests cover exact/over-limit, chunked bodies, compressed trailing
garbage, compressed expansion and rate accounting before parsing.

## Actual Session results

Registry metadata and npm advisory endpoints are now accessible through the
normal Session environment. No proxy/registry settings were changed for npm.

| Command / check | Result |
|---|---|
| npm ls / npm explain proxy-addr, body-parser, brace-expansion, qs | PASS, installed tree and parent ranges inspected |
| npm install --package-lock-only --ignore-scripts --no-audit --no-fund (backend) | PASS, generated compatible lockfile |
| npm ci --ignore-scripts --no-audit --no-fund (backend and frontend) | PASS |
| npm run build:css (frontend) | PASS; Sass @import deprecation warning only |
| Node unit / HTTP security / deployment tests | **85 PASS**, including nine new HTTP/dependency regressions |
| npm test (backend), test DB URLs unset | **85 PASS**; PostgreSQL integration suite explicitly skipped because URLs/resources absent |
| npm audit --audit-level=high (backend, all dependencies) | PASS, **0 vulnerabilities** |
| npm audit --omit=dev --audit-level=high (backend production) | PASS, **0 vulnerabilities** |
| npm audit --audit-level=high (frontend) | PASS, **0 vulnerabilities** |
| frontend tracked diff / compiled stylesheet present | PASS, frontend unchanged; generated dist stylesheet exists |
| Docker / real PostgreSQL smoke | BLOCKED: no Docker daemon socket or PostgreSQL server in Session |

The first HTTP test invocation failed because environment proxy routing sent
loopback fetches to a proxy that returned 403. Tests passed with NO_PROXY/no_proxy
set only for 127.0.0.1, localhost, ::1. This affects local test traffic only;
external registry requests still use the normal permitted environment. It is
not a dependency-security failure and was not counted as a passing first run.
Node also reports an existing frontend ES-module type warning; unrelated to
this remediation. Full database and image acceptance remains a release gate.

## Operator reproduction on Fujitsu (same Session worktree)

No further dependency updates are needed. From the reviewed commit, preserve
all work and do not regenerate either lockfile. These commands install only
locked dependencies and run local HTTP tests, never provision/use a database:

```bash
set -euo pipefail
[[ $(git branch --show-current) == mytko/audit-foundation-afa14483 ]]
[[ -z $(git status --porcelain) ]]
npm --prefix backend ci --ignore-scripts --no-audit --no-fund
npm --prefix frontend ci --ignore-scripts --no-audit --no-fund
npm --prefix frontend run build:css
env -u TEST_DATABASE_URL -u TEST_MIGRATION_DATABASE_URL \
  NO_PROXY=127.0.0.1,localhost,::1 no_proxy=127.0.0.1,localhost,::1 \
  npm --prefix backend test
npm --prefix backend ls proxy-addr body-parser brace-expansion qs express pg
npm --prefix backend audit --audit-level=high
npm --prefix backend audit --omit=dev --audit-level=high
npm --prefix frontend audit --audit-level=high
git diff --exit-code
[[ -z $(git status --porcelain) ]]
```

Then resume docs/VALIDATION.md with the **new source SHA**, approved image
digests and fresh build evidence. The old RC artifact is superseded; never
release it on the basis of these source tests. Do not touch ORHEA/MOTO containers,
production DBs, DNS or host Caddy. No push, merge or deployment is authorized.
