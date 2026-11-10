# Mytko Tasks — production release through Mytko

How a change reaches `tasks.mytko.dev` on `mary-vps`. Nothing in this repository deploys; the steps below run in
Mytko Workflow and on the operator's phone.

1. **Session** — the change is made in a Mytko Session of this project and goes through Validate, Push, Review and
   Merge to `main`.
2. **Prepare** — in the Session's "Wydanie produkcyjne" panel the operator starts the release:
   - `build-attest.yml` (mode `build`) builds the merged commit into `ghcr.io/dmytro-rohov/todo-app@sha256:…` and
     signs it, together with the build inputs it measured;
   - Mytko pins that image in the deploy profile and records the release;
   - `build-attest.yml` (mode `attest`) signs the release statement (commit, source archive, profile, image, build
     inputs);
   - Mytko verifies the signature against the pinned CI identity.
3. **Approve** — the operator approves the release.
4. **Deploy** — the operator previews the exact commit, image and target, then types the 6-digit code from the
   authenticator. The deploy peer on Fujitsu checks the code and the image signature itself, then the target helper
   on `mary-vps` replaces only the `app` container (`docker compose up -d --no-deps app`), waits for `/readyz` and
   checks that the new image serves.
5. **Recover** — if the outcome is uncertain, the operator can restore the previous image with a fresh code.

**Database migrations.** When the release brings new Drizzle migrations, the panel shows a "Migracja bazy" step
between approval and deploy: the pending migrations (each one must be additive: new tables, columns, indexes, foreign
keys), checked by Mytko against the database. With a separate 6-digit code the deploy host takes a named backup,
checks that the image would apply exactly that plan, runs this image's `migrate` service once and reads the schema
afterwards. The running version keeps working on the extended schema; the new version is deployed after that.
A failed migration leaves the application unchanged; restoring the backup is a separate, explicit operator action.

What a release never does: touch the database outside that migration step, its volume or the daily backups, Caddy,
DNS, or other applications. Schema changes go through the approved Drizzle migration path
(see [PRODUCTION.md](PRODUCTION.md)).

The workflow takes no secret as an input; the image is public on GHCR and verification needs no registry credential.

**Changes merged outside a Mytko Session.** A pull request merged on GitHub (for example 2060c2f, the layout fixes
and the installable app) has no Session, so it gets none of the release steps above. It reaches production through a
short technical Mytko Session started from that `main`: Validate, Push, Review, Merge, then "Wydanie produkcyjne" as
usual. The release then contains exactly that `main` plus the Session's own small change.

**Release 2** (calendars, clients, accounts, Poczta, briefs, Workflow ToDo; migrations 0004–0009): see
[RELEASE-2.md](RELEASE-2.md).

**Release 3** (Ukrainian, board fixes, Cele / Marzenia; migration 0010): see [RELEASE-3.md](RELEASE-3.md).

**Release 4** (tasks to Workflow by hand or by AI, AI and Workflow switches; migration 0011): see [RELEASE-4.md](RELEASE-4.md).

**Release 5** (sort columns by priority, privacy policy page; no migration): see [RELEASE-5.md](RELEASE-5.md).

**Release 6** (finished cards look inactive; no migration): see [RELEASE-6.md](RELEASE-6.md).
