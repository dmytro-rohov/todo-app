# Release 9: Porządek in the new style, a project shows its space

Production runs release 8 (`e7f8a31`). Frontend only, **no migration**.

## What changes
- Porządek: active tab lime on a soft green background, quiet rows (colour as a swatch, the name framed only when
  pointed at or edited, one hover per row), checkboxes lime only when ticked, the bin red only when pointed at,
  "Dodaj" solid lime.
- Projects: every project shows the space it is in; space, client and archive open under the row with the arrow.

## Release
Through Mytko Workflow: Session → Prepare → Approve → Deploy (TOTP). No database step; deploy right after Approve.
