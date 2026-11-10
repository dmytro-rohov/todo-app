# Accounts

Mytko Tasks has one administrator: **the owner** (the `AUTH_USERNAME` login, or "Zaloguj kontem Mytko" as
`MYTKO_SSO_LOGIN`). The owner can create accounts for other people, e.g. a partner, in **Porządek → Konta**.

| | Owner (administrator) | Member account |
| --- | --- | --- |
| Tasks, board, list, calendar of tasks, archive | yes | yes |
| Own spaces, projects, labels, assignees | yes | yes (own) |
| Shared spaces (e.g. "Dom") | own ones + those joined | own ones + those added to / joined |
| Adding accounts to a shared space from a list | yes (own spaces) | no (invitation codes only) |
| Invitation codes / links for an own shared space | yes | yes |
| Profile picture | yes | yes |
| Clients, meetings, Google Calendars, booking | yes | no |
| Accounts (create, reset password, block, delete) | yes | no |
| Password | on the server (`AUTH_PASSWORD_HASH`) | own, "Zmień hasło" (lock icon) |

- **Data is separate**: an account sees only its own tasks and the shared spaces it is in; the owner does not see a
  member's private tasks either. Built-in spaces (Praca, Prywatne) are never shared.
- **Sharing**: tick "Wspólna" on your own space (or when adding it) in Porządek → Przestrzenie; "Osoby" then shows who is
  in it. Only those people (and the space's creator) see and edit it. The owner ticks accounts from the list of their
  accounts; anybody (owner or member) can invite with **a one-time code or its link** (`/#join=CODE`): 12 characters,
  7 days, only its sha256 is stored, 20 waiting per space, 10 wrong codes per account in 15 minutes. "Mam kod
  zaproszenia" joins with a code; a link opened signed out is kept for after signing in. A member is never shown which
  accounts exist.
- **Leaving / taking out / unsharing**: the person's tasks in the space go back to their Prywatne (without the project);
  unsharing also removes the space's people and waiting codes.
- **Before this release** a shared space was seen by every account: at the first start the server puts every account
  in those spaces once (`adoptSharedSpaces`, flag `spaces.members` in `app_settings`), so nobody loses a space.
- **Profile picture**: click your avatar (bottom left). Any photo is cropped in a circle and saved by the browser as a
  256 px WebP (JPEG where WebP cannot be written) of at most ~110 KB; the server accepts only WebP/JPEG ≤ 120 KB. Seen by
  the account, the owner and the people it shares a space with.
- **New account**: name, login, start password ("Wygeneruj" makes one); pass it on, the person can change it after
  signing in. "Nowe hasło" sets a new one and signs the account out everywhere; "Zablokuj" signs it out and blocks it.
- **Deleting** an account removes everything it created; the owner's tasks in its shared spaces return to the owner's
  Prywatne.

Data model: `users` (migration `0006_accounts`) and `user_id` on spaces, projects, labels, assignees, tasks and sessions;
`user_id NULL` is the owner (everything from before accounts). `space_members`, `space_invites` and `avatars` (migration
`0012_space_members_avatars`; an avatar's key is `owner` or `user:<id>`). Visibility rules: `backend/access.js`;
spaces, people and codes: `backend/routes/spaces.js`; pictures: `backend/routes/avatars.js`.
Tests: `backend/test/accounts.integration.test.js`, `e2e/ui-run.sh <image> accounts … TEST=e2e/ui-accounts.mjs`.
