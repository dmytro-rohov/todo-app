# Mytko Tasks — architecture for the Mytko Workflow OVH deploy system

Why this exists: Mytko Workflow's external deployment (`ExternalDeploymentService`, release ledger, closed
`DeployProfile`, digest-bound operator confirmation) does not deploy "a directory on a host". It deploys an
**immutable, registry-pinned image** into **namespaced resources**, behind a **loopback route**, with the
**database as a named resource** and **migrations as an explicit step**. Mytko Tasks is shaped for that contract.

## What the contract demands and how Tasks meets it
| Contract rule (`parse_profile`) | Tasks |
| --- | --- |
| image is `repository@sha256:<digest>` inside the approved registry, no tags | `deploy/deploy-profile.template.json` + `scripts/render-deploy-profile.cjs` fill ONLY the digest; the release workflow publishes to `ghcr.io/dmytro-rohov/mytko-tasks` |
| every network/volume/container name starts with the project namespace | namespace `mytko-tasks`; container `mytko-tasks-app`, network `mytko-tasks-private`; no volumes (the app stores nothing on disk) |
| non-root numeric user, read-only rootfs, resource limits | `1000:1000`, `read_only: true`, 0.5 CPU / 256 MiB / 128 pids (matches `deploy/compose.yaml`) |
| ports only on `127.0.0.1`, route to a published loopback port | `127.0.0.1:3100 → 3000`, route `tasks.mytko.dev → 3100` (Caddy) |
| health check path | `/healthz` (static, no DB); `/readyz` (DB) stays off the public route |
| secrets are names only | `env_refs` list names; values live in the operator secret store |
| database is a named logical resource; migration `none|required` | resource `tasks`, migration `required` (`backend/migrate.js`, ledger + checksums + advisory lock, owner role separate from the app role) |

## Verified, not assumed
The rendered profile was parsed by the real `mytko.domain.remote_deploy.parse_profile` of Mytko Workflow (digest
`sha256:de79a57e…` for the all-`a` test digest). `backend/test/deploy-profile.test.js` mirrors those rules so the
profile cannot drift; the authoritative check remains that parser.

## Current production vs this architecture (the gap)
The running app image `mytko-tasks:a561813e` was **built on the host** (no registry digest, no attestation). That
cannot be bound to the external deploy contract. Closing the gap needs, in order, operator decisions:
1. Registry: this change assumes **GHCR** (`ghcr.io/dmytro-rohov`) because the repository is on GitHub. Change
   `registry` and the workflow if you choose otherwise.
2. Run `release-image` (manual workflow) for a reviewed `main` SHA → image digest + rendered `deploy-profile.json`.
3. Register environment `production` for project `todo-mytko-tasks`, bind host `mary-vps` with that profile.
4. Host-side: evidence helper, trusted deploy runtime and target file (see Mytko Workflow
   `docs/external-deploy-mytko-tasks.md`).

## Open contract question (not invented here)
`database.migration: required` tells the planner that a schema change may happen. How the trusted runtime runs
`node backend/migrate.js` (the same image, `MIGRATION_DATABASE_URL`, owner role) **before** the new container takes
traffic is a runtime-adapter responsibility. `deploy/compose.yaml` already encodes "schema first, code second"
(`migrate` → `service_completed_successfully` → `app`) and stays the manual fallback.
