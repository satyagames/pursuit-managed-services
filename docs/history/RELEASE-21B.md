# Prompt 21, Phase 2: Manage Users (the People tab)

Branch `pms-21-2`, made from `441ee98` (the tip of `pms-21-1`, which is not merged). Not pushed. Design source: boards 3 and 4 of the wireframes
approved on 27 Oct 2026 (the users list; add user, a person's page and Give access). Phase 2 of seven: the Super admin's screens for people. Phase 3
(clients and several sessions a day) was not started.

**No list, column or index changed**: the schema is still version 5, Setup has nothing new to do, and no request baseline moved (the admin page's
start-up requests are the ones Phase 1 recorded; the People tab reads only when it is opened).

## What was built

- **The People tab** (`admin/AdminPeople.svelte`): shown only to a person whose access has `users.view` (a Super admin; an Admin, who may look), never
  to a PIN's legacy admin (`shownTabs` in `AdminApp.svelte`, from `canView` over the role matrix). The list: search, the role chips (All, Super admins,
  Admins, Producers, Designers, Leadership), Client and Session filters (a client first, then its sessions by date, time and title), Status, pages of
  50, and for each person their roles and reach from their current assignment rows. Rules in `lib/access/people.js`.
- **Add user** (`UserAdd.svelte`, `UserPicker.svelte`; behaviour in `lib/access/picker.js`): search as you type against the firm's directory, from two
  characters, after a 250 ms pause, at most eight suggestions, one search in flight (a newer one aborts the older and its answer is dropped), Up and
  Down (round), Enter, Escape; a combobox with `aria-activedescendant` and a live line (`pickerWords`) for a screen reader. Where the site will not
  search, the screen says "unverified" and takes a full email typed by hand. Adding writes the person's row and one audit line, and **gives no access**.
- **A person's page** (`UserDetail.svelte`): turn access off or on; Super admin and Admin for all clients with the Admin's "also allowed to add people"
  extra (a Super admin's); **Access to clients and sessions** with **Give access** (`GiveAccess.svelte`: an existing person, a role on one client or
  one session, an optional last day, a Designer's "may also edit activities", and for a Super admin Leadership for all clients in a period) and
  **Remove** with a confirmation that says what they lose; a read-only history from the audit list. Operations in `lib/access/people-ops.js`.
- **The guards, also in the data layer**: `lib/data/access-people.js` (section 13: `searchDirectory`, `updateAccessRecord`, `removeAccessRecord`; the
  public surface is 120 names) reads both access lists and hands the row to the write guard's `record()` check (`lib/access/guard.js`:
  `revokeProblem`, `disableProblem` of `lib/access/grants.js`): not your own roles, not the last Super admin, an Admin never a Super admin or Admin
  row. A refusal is `AccessDenied` in words and nothing is sent.
- **Tests**: `scripts/test-users.js` (30 tests, written first and shown failing: the modules did not exist), `scripts/migration-tests/users.spec.ts`
  (5 specs on the built page: the list and filters, Add user by keyboard alone, Give access, Remove, a refused picker, who sees the tab, heading focus,
  axe on 7 screens and dialogs). `scripts/sharepoint-fake.js` gained `directory` and `pickerStatus`.

## Where the brief did not match the tree (said, as the brief asks)

1. **No index was added.** The brief's Phase 2 lists filters on client, session and status; the lists are read whole (four reads when the tab opens)
   and filtered in the page, since a site has hundreds of people, not thousands (ASSUMED), so no recorded request filters on a new column
   (`scripts/test-schema.js` allows only that). The history is also read whole from `PMSAuditLog` (ASSUMED far below 5,000 lines): when a phase filters
   it on the server, it indexes `TargetUser`. Phase 7 revisits both.
2. **Sessions have no time or title yet** (Phase 3 adds `StartTime` and `Title`): `sessionLabel` shows the date, and the time and title when a session
   has them, so Phase 3 changes no screen of this phase.
3. **The local server has no signed-in person**, so the tab does not show on `npm run dev` (the PIN, as before); it shows against the mocked SharePoint
   (the specs, the local PCOE site with a persona whose email is in `PMSUsers`).
4. **The component is `AdminPeople`**, not `AdminUsers`: `AdminUsers` is the retired list's old title and `scripts/test-shown-names.js` refuses it.
5. **`core.js` is at its 600 lines**, so its two changes sit on existing lines: the request function takes a caller's own `signal` (the people
   picker's stale search; `AbortSignal.any`, in Chromium 116 and Safari 17.4 or later, ASSUMED for the admin's laptops), and `currentAccessGuard`
   shares a line with `setAccessGuard`.
6. **Leadership for a period** is offered on Give access to a Super admin only (decision F), though the brief names "one client or one session"; it
   costs nothing and the grant rules already cover it.
7. **`PMSAccessRequests`** is still not in this release.

## Open items for the manager

The brief's six and Phase 1's two (7 and 8 there) stand. New: 9. Whether the People tab should be shown to an Admin who may not add people (it is, read
only, with Give access for team roles: board 10 gives an Admin `users.view`). 10. Whether the people picker may be used on PCOE (QA item 222): if it is
refused, Add user takes a typed email, marked "unverified".

## Requests

None of the admin page's start-up requests changed. Opening People sends: `PMSUsers`, `PMSRoleAssignments`, `PMSClients` and `PMSClientSessions`, each
read whole in pages (every item read names its columns); a person's page one more read, `PMSAuditLog`. A search is one `POST` per pause in typing. A
change reads `PMSUsers` and `PMSRoleAssignments` first (for the guards), then writes its item and its audit line.

## Gates, before and after

Before: `441ee98` (Phase 1's record, the same tree); after: this branch's last code commit. Windows, Node 22.23.3 (`.local/node22`). By the owner's
standing instruction (develop now, the heavy gates at the final build), only what the phase touches was run in a browser.

| Gate | Before | After |
|---|---|---|
| `npm run check:svelte` | 0 errors, 0 warnings (427 files) | 0 errors, 0 warnings (436 files) |
| `npm test` | 1,651 of 1,653 (the two `scripts/test-store.js` timing tests, EPERM from Windows under the full run) | 1,684 of 1,684 (the two store timing tests passed this time) |
| `npm run test:bundle` | 46 of 46 | 47 of 47 |
| `scripts/migration-tests/users.spec.ts` (Chromium) | does not exist | 5 of 5 |
| `npm run test:report`, `test:report:mutations`, `test:charts`, `test:local-site`, `oracle -- --seeds 500` | 150; 64 of 64; 57; 26; 0 differences | 150; 64 of 64; 57; 26; 0 differences (5,620 participants, 9,865 guests) |
| `npm run test:migration`, `test:a11y` (all browsers) | Phase 20's record | not run: the final round (below) |

## Page sizes (gzip -9)

| Page | Before (`441ee98`) | After | Change |
|---|---:|---:|---|
| `index.html` (participant) | 165,480 B | 166,085 B | +605 B: section 13 of the data layer and the request function's signal (allowance 1,000 B; ceiling 450,000 B, not raised; its Tailwind rules unchanged; none of `lib/access` and none of the People screens) |
| `admin.html` | 596,907 B | 608,919 B | +12,012 B: the People tab, `lib/access`'s people rules and picker (allowance 14,000 B; budget 700,000 B) |

`PHASE_21B` in `scripts/bundle-budget.js` records them.

## Proven on the mock and in node, and only reasoned about

Proven (`scripts/test-users.js`, `scripts/migration-tests/users.spec.ts`): the list's roles, reach, chips, filters and pages; the picker's debounce,
minimum, limit, abort of a stale search, keyboard and words; the directory search in the data layer (shape, limit, abort signal, a refusal, not a lost
sign-in, the guard letting it pass, the local server's none); adding (no role, one audit line, a duplicate), turning access off and on, removing (and
"already gone"), the extras, the history; the guards in the data layer sending nothing; the built page in Chromium for a Super admin, an Admin and a
Producer, by keyboard alone, with axe finding nothing on the list, the picker with a suggestion, the unverified picker, Give access and the Remove
confirmation.

Only reasoned about: what the real PCOE site answers to the people picker (QA 222), the real lists' behaviour for these writes (QA 223 to 227), the
screens in WebKit (the spec has not been run there), how a screen reader speaks them (QA 228), and the iPad. A refused search on the real site may
answer in a shape the mock does not (the screen treats any failure as "unverified").

## The final round must run

`npm run test:migration` in Chromium and WebKit (with `users.spec.ts`; the specs that count the admin page's start-up requests should not move);
`npm run test:a11y` with the People screens (the spec holds axe on them already); `focus.spec.ts` and `keyboard.spec.ts` may add the two new headings
(`scripts/test-foundation.js` counts 13).

## The package

Made by `npm run package:release` from this branch's last commit, in a fresh checkout of it; its name is `pms-` and that commit, and its checksums
were verified against `SHA256SUMS.txt` (the session's report names it).
