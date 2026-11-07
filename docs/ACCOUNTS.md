# Accounts

Mytko Tasks has one administrator: **the owner** (the `AUTH_USERNAME` login, or "Zaloguj kontem Mytko" as
`MYTKO_SSO_LOGIN`). The owner can create accounts for other people, e.g. a partner, in **Porządek → Konta**.

| | Owner (administrator) | Member account |
| --- | --- | --- |
| Tasks, board, list, calendar of tasks, archive | yes | yes |
| Own spaces, projects, labels, assignees | yes | yes (own) |
| Shared spaces (e.g. "Dom") | sees and edits | sees and edits |
| Clients, meetings, Google Calendars, booking | yes | no |
| Accounts (create, reset password, block, delete) | yes | no |
| Password | on the server (`AUTH_PASSWORD_HASH`) | own, "Zmień hasło" (lock icon) |

- **Data is separate**: a member sees only their own tasks and the spaces marked **Wspólna**; the owner does not see a
  member's private tasks either. Built-in spaces (Praca, Prywatne) are never shared.
- **Sharing**: tick "Wspólna" on your own space (Porządek → Przestrzenie). Unsharing sends the other accounts' tasks in
  it back to their Prywatne.
- **New account**: name, login, start password ("Wygeneruj" makes one); pass it on, the person can change it after
  signing in. "Nowe hasło" sets a new one and signs the account out everywhere; "Zablokuj" signs it out and blocks it.
- **Deleting** an account removes everything it created; the owner's tasks in its shared spaces return to the owner's
  Prywatne.

Data model: `users` (migration `0006_accounts`) and `user_id` on spaces, projects, labels, assignees, tasks and sessions;
`user_id NULL` is the owner (everything from before accounts). Visibility rules: `backend/access.js`.
Tests: `backend/test/accounts.integration.test.js`, `e2e/ui-run.sh <image> accounts … TEST=e2e/ui-accounts.mjs`.
