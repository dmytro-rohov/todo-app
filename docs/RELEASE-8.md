# Release 8: people in shared spaces, invitation codes, profile pictures, sidebar like Finance

Production runs release 7 (`ede92c3`). **Migration `0012_space_members_avatars`** (additive: new tables
`space_members`, `space_invites`, `avatars`, their indexes and foreign keys).

## What changes
- Shared spaces are seen only by their creator and the accounts in them. The owner ticks accounts in **Osoby**;
  anybody can invite with a one-time code or link (`/#join=CODE`, 7 days). Leaving or being taken out sends the
  person's tasks and projects in the space back to their Prywatne.
- **Spaces shared before this release** stay visible to every account: at its first start the new version adds every
  account to them once (`adoptSharedSpaces`). The owner can then take people out in Osoby.
- Every account (the owner too) can set a profile picture, converted in the browser to a 256 px WebP/JPEG.
- The sidebar looks like Mytko Finance and Workflow (#34).

## Release
Through Mytko Workflow: Session → Prepare → Approve → **Migracja bazy** (TOTP) → Deploy (TOTP). Run the migration and
the deploy right after Approve (approval is valid for 10 minutes).
