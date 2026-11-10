# Release 7: Ukrainian by default

Production runs release 6 (`30d6d88`). Frontend only, **no migration**.

## What changes
- A device that never chose a language opens Mytko Tasks in Ukrainian (login screen included). Polish stays in
  Porządek → Język and PL / УКР on the login screen; a device that chose a language keeps it.

## Release
Through Mytko Workflow: Session → Prepare → Approve → Deploy (TOTP). No database step; deploy right after Approve.
