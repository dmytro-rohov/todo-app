# Release 5: sort columns by priority, privacy policy page

Production runs release 4 (`f094e31`, migrations up to 0011). Frontend only, **no migration**.

## What changes
- A sort button next to each board column's count: by priority (Krytyczny on top) or the manual order, per column,
  remembered on the device.
- `https://tasks.mytko.dev/privacy.html`: the privacy policy that the shared Google Cloud project "Mytko" links on
  its OAuth consent screen (needed to keep the app published "In production").
- Service worker version 2: only the app's own navigations share the cached app shell.

## Release
Through Mytko Workflow: Session → Prepare → Approve → Deploy (TOTP). No database step. Run the deploy right after
Approve.

## After
- `https://tasks.mytko.dev/privacy.html` opens.
- Board: the sort button in each column header.
