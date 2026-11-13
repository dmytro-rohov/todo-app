# Release 10: every account is its own assignee

Production runs release 9 (`f02be55`). **Migration `0013_self_assignee`** (additive: column `assignees.account` and its
unique index).

## What changes
- Every account (the owner too) is on its own Wykonawcy list from the start, first, with its picture; it cannot be
  deleted. The owner's entry is called "Administrator" until renamed.
- A new task goes to the account itself by default; "Bez wykonawcy" can still be chosen.
- People who share a space see each other's own entries and can give each other tasks there.
- "To ja" turns an assignee made by hand for oneself into the account (its tasks move over, it is deleted).

## Release
Through Mytko Workflow: Session → Prepare → Approve → **Migracja bazy** (TOTP) → Deploy (TOTP). Run the migration and
the deploy right after Approve (approval is valid for 10 minutes).
