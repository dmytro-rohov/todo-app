# Cele / Marzenia

A tab with lists of goals and dreams for a **month** or for a **whole year**. Each account has its own lists; the
owner does not see a member's lists, and a member does not see the owner's.

- **Miesiąc / Rok**: choose the period with the switch, the month and year menus, or the arrows. A new list starts
  empty and is created when its first item is added.
- **Item**: a heading (required, up to 160 characters), an optional description and an optional deadline. **Cel** or
  **Marzenie** is chosen in the add form (it stays chosen for the next item) and can be switched on the item itself.
  Goals are green, dreams violet.
- **Done**: the checkbox crosses the item out and dims it. The item stays in the list, so a period can be looked back
  on: what was planned, what worked out, what did not. The summary counts done items, separately for goals and dreams.
- **Order**: drag with the mouse, use the arrows next to an item (phones), or Alt+↑/↓ on a focused item.
- **Inne listy**: the other periods that have a list, with how much of each was done. Click one to open it.
- **Edit / delete**: the pencil opens the item. Enter on a focused item does the same.

API (session or Basic auth, same-origin like the rest of `/api`):

| Method | Path | |
|---|---|---|
| GET | `/api/goals?year=2026&month=12` | a month's list (`month` omitted: the year's list), in order |
| GET | `/api/goals/periods` | periods with a list: `year`, `month` (null = year), `total`, `done`, `dreams`, `dreamsDone` |
| POST | `/api/goals` | `{ year, month?, title, description?, deadline?, kind: "goal" \| "dream" }`, added at the end (max 200 per list) |
| PATCH | `/api/goals/:id` | any of `title`, `description`, `deadline`, `kind`, `done` (true keeps the first time it was done) |
| PUT | `/api/goals/order` | `{ year, month?, ids }`: every id of that list, top to bottom (409 if the list changed) |
| DELETE | `/api/goals/:id` | |

Migration `0010_goals` creates the `goals` table (additive; deleting an account deletes its lists).
