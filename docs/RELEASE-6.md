# Release 6: finished cards look inactive

Production runs release 5 (`0ea11bf`). CSS only, **no migration**.

## What changes
- A card in Zakończone has its title crossed out and is paler and greyer (inactive); hovering or focusing it makes it
  clearer for reading.

## Release
Through Mytko Workflow: Session → Prepare → Approve → Deploy (TOTP). No database step; deploy right after Approve.
