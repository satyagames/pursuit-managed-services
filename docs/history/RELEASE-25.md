# Prompt 25: tell the person giving access that SharePoint access is a separate step

Branch `pms-25`, made from `c3dbd2e` (the tip of `pms-24`). Not pushed. Package `pms-09ae183` (one commit older than this note).

Words and one document only. No access rule, list, column, request, dependency or permission changed: `can()` and the access matrix are untouched; no screen checks SharePoint.

## What was built

1. **Give access** (`admin/GiveAccess.svelte`): a line just above the buttons, and the same line after the grant's notice. Producer, Designer and Admin: "needs Edit access to this SharePoint site"; Leadership: "Read access is enough." Nothing when a person gives themselves a role.
2. **Add user** (`admin/UserAdd.svelte`): "Adding a person here does not give them access to the SharePoint site."
3. **No access** (`admin/NoAccess.svelte`): the existing "ask a Super admin" line first, then "If SharePoint itself said the item has not been shared with you, ask the site owner to add you to this site."
4. The strings are in `lib/access/access-words.js` (`siteAccessNote`, `SITE_ACCESS_ADD_USER`, `NO_ACCESS_SITE_LINE`); `scripts/test-site-access-words.js` (in `npm test`) was written first and shown failing.
5. **`docs/ONBOARDING.md`**, linked from `README.md`, `docs/SHAREPOINT.md` and `QA-TESTING.md` (item 293); `docs/MODULES.md` and `project-map.json` regenerated.

## Where the brief did not match the tree

| Where | Found | Decided |
|---|---|---|
| `claude/onboarding-sharepoint-access.md` | Not in the tree (no `claude/` folder, nowhere on the disk). | `docs/ONBOARDING.md` was written from the brief's outline and `docs/SHAREPOINT.md`; it says so at its top. Check the group names against the real site. |
| "PCOE" in the words | `scripts/release-proofs.js` stops a package whose page holds `PCOE`. | The screens say "this SharePoint site" and "this site". The document keeps "PCOE". The proof was not loosened. |
| A help sheet | The app has none. | "How to add them: docs/ONBOARDING.md." as plain text in the line. |
| "Admin" in the role list | The dialog offers Producer, Designer and Leadership only. | The Admin wording is in `siteAccessNote` for when the dialog offers it. |

## Gates

`check:svelte` 0 errors; `npm test` 2,073 of 2,073; `test:baseline` 38 of 38 (no request added); `test:bundle` 55 of 55. Participant page 181,511 B gzip (+0); admin page 675,100 B (+305). Checksums verified in the folder and in a fresh unzip (7 OK each). The axe and keyboard specs were not re-run (the dialogs gain a paragraph, no control).

## Proposed, not built

Setup listing the site's groups and the level each holds; Give access checking whether the person can already open the site (needs a permission read Admins may not be allowed); an "Invite by email" button that sends the site link.

## Real-site check for Satyadev

QA 293: give a test colleague a role, open Give access and read the line; add them to the site as Members; they open `admin.html` and the participant link.
