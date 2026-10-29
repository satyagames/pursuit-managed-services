# Prompt 21, Phase 4: scoping Events, Content and Guests by role

Branch `pms-21-4`, made from `dda6eb2` (the tip of `pms-21-3`, which is not merged). Not pushed. Design source: boards 7, 8 and 10 of the wireframes
approved on 27 Oct 2026 (the menus, the pickers, the capability matrix). Phase 4 of seven: every module shows only what the role and its assignments
allow. Phase 5 (the leader's dashboard and the index maths) was not started.

**An existing admin's day does not change**: the PIN's legacy admin and a global role (Super admin, Admin) send the requests they always sent (the
request baselines are translated for version 7's one column only, below), see all their tabs but People (the legacy admin), and every button they had.
What changed for everyone: the site must first be brought to version 7 by Setup (one column), the question type "Open text feedback" is "Survey
feedback", and Guests and QR has a group field. What changed for a Producer, a Designer or Leadership: they see their own menu, clients and sessions.

## What was built

- **The menu from the role matrix** (`lib/access/scope.js`, `TAB_ACTIONS`, `tabsFor`): Producer: Today, Content, Guests and QR, Results; Designer: Content;
  Leadership: Results; Admin: Clients and People; Super admin: all; the legacy admin: all but People. `AdminApp.svelte` opens on the first tab the role has
  and does not follow an address for another.
- **Content's two views, edit, view or none** (`contentModes`, `admin/ViewOnly.svelte`): a view a role may look at but not change is shown with "View only"
  and a disabled fieldset. A Producer edits the activities and looks at the brand; a Designer edits the brand and looks at the activities (and edits them with
  the extra). DECIDED: the client owns its activities and its brand, so a role given **one session** only looks at them.
- **Scoped reads** (`reachOf`, `readQueries`, `scopedReader`; `AdminContent`, `ContentActivities`, Today's `loadToday`/`pollToday`, `AdminGuests`,
  `AdminResults`): a role that holds some places reads those clients by `id`, their sessions and activities by `ClientId`, fifteen to an address, and nothing
  else; a global role sends the plain reads. A live session that is not theirs is "elsewhere" on Today and Guests and QR.
- **The guard reads and knows owners** (`lib/access/owners.js`, `guard.read`, `guard.learn`; `lib/data/read-scope.js` in `readLists`, `listItems`,
  `queryItems`): a scoped role's read that names no place, or another's, throws `AccessDenied` before a request is sent; a write is held to the real client
  of the item (a question's activity, an option's question, a session's start); an owner not known is nobody's. This settles Phase 1's ASSUMED
  ("a write that names no client is allowed when the role has the action anywhere") for every write whose body names an owner; a SharePoint delete
  has no body and is still held to the list (below).
- **Buttons only for actions a role has** (Results): Live display, Delete session, the exports, Remove and Restart a visit.
- **Guests with a group** (schema version 7, `PMSGuestList.GuestGroup`): a field on the form and on the paste, a `| group` (or tab) at the end of a pasted
  line, `addGuests` taking `{ name, group }`, a group tag on each row and a **Show guests in** filter.
- **Survey feedback**: the question editor's type, the CSV/PDF/PowerPoint exports' kind and the sample content say "Survey feedback"; the stored type
  `open-text-feedback` is unchanged.
- **Tests, written first and shown failing** (`scripts/test-scope.js`: the module did not exist; `scripts/test-guest-group.js`: neither did its functions):
  **one test for every cell of the capability matrix that is not "no"** (33 cells), **a forbidden write for every role** (`AccessDenied`, nothing sent),
  the menus, Content's modes, the pickers and day one, the scoped queries and reader, the guard's read check and owners, the data layer refusing a scoped
  read before any request, and `scripts/migration-tests/role-scoping.spec.ts` (8 specs on the built page in Chromium and WebKit, axe on the view-only
  screens, the network log of a Producer) in `npm run test:a11y`.

## Carry-overs from Phases 1 to 3, settled

| Carry-over | What was decided |
|---|---|
| The write guard was list-level for writes naming no client (ASSUMED) | The guard now takes the client from the body or the owners it has read; an owner not known is nobody's. Left list-level: a write with no body (a SharePoint delete). |
| `shownTabs` filtered People only | All the menus come from the role matrix (`TAB_ACTIONS`). |
| Day-one visibility | A client nobody was given to is covered by no client's role; only a global role sees it (tested). |
| A session-scoped Designer and client-owned activities | The client owns them; a role given one session only looks at them (View only), the extra included. |
| `GuestGroup` (and `Industry`, `Region`) | `GuestGroup` added (version 7); `Industry` and `Region` left to Phase 5, which reads them first. |
| "Open feedback" to "Survey feedback" | Done on screen and in the exports and the sample content; the stored key is unchanged. Phase 6 reviews the wording again. |
| `admin-content-sharepoint.spec` "Content loads in 4 requests" counts 3 | Still 3, as before Phase 4 (the write token is fetched by the sign-in step); the final round decides its number. |

## Where the brief did not match the tree (said, as the brief asks)

1. **An Admin and Today.** The brief's menu has no Today for an Admin (Clients, Users), but Phase 3's `client-sessions.spec.ts` test opened Today as an
   Admin and found Go live off with "Only a Producer or a Super admin starts a session". The menu follows the brief and the matrix (an Admin has no
   `events.run`); that test now asserts the tab is absent and no Go live is on the client's page. Today's words for someone who may not start stay in the code.
2. **The label "24 Oct 09:30 Morning workshop".** `pickerLabel` builds it (tested), but no picker in the tree lists sessions across dates: Today's picker is
   within one day (its words, "09:00, Morning, 2 of 3 today, Live", are pinned by Phase 3's tests), the client's team form and Results use their own pinned
   words. It is ready for the first cross-date session picker (Phase 5's dashboard filters).
3. **"Admin (Clients, Users with the extra)".** The matrix gives an Admin `users.view` (View) and `users.manage` only with the extra, so an Admin sees
   People always and adds people only with the extra, as Phase 2 built it.
4. **`PMSClients.Industry` and `Region`** are not added: nothing in this phase filters on them (the repository's rule: exactly what a recorded request filters
   on). Phase 5 adds them with the first read that filters on them.
5. **A delete names no client.** On SharePoint a delete request carries no body, so the guard cannot tell whose item it removes and holds it to the list. No
   screen offers a role another client's item, so there is nothing to press; the lists' own permissions are Phase 7's.
6. **The specialised readers** (`responses.js`, `session.js`, `qr-scan.js`, `watch.js`) read through `spItems`, not through the three calls that ask the
   guard. The screens call them only for sessions already listed for the role (Results filters its sessions first), and the browser spec shows no request
   naming another client; making every reader ask the guard is Phase 7's.
7. **Leadership for a period.** A period holder reads the sessions and clients lists whole (names and dates, no answers), then only the answers of the
   sessions inside the period (`sessionsFor`); Phase 5 gives it the dashboard and may narrow the metadata reads with an indexed `Period` filter.

## Open items for the manager

The earlier thirteen stand. New: 14. Whether an Admin should see Today read-only (as Phase 3 built it) rather than not at all (as the brief's menu and the
matrix have it). 15. Whether a Designer of one session should be allowed to edit the client's activities (as built: no).

## Requests

Schema version 7 changed what the data layer sends in two ways only: every read of the guest list names one column more at the end of its `$select`, and
Setup makes and reads back that column. The request baselines followed by `scripts/schema-baseline/guestgroup-baselines.js`: every one of the 17
recorded suites run on `dda6eb2`'s tree and on today's, request by request (the two Setup suites, whose lanes interleave, by count), then a fresh
recording equal to the translation in all 13 that changed; the browsers' three start-up baselines translated by the same `$select` rule. No baseline was
recorded again and none amended. The new read check sends nothing: a global role's requests are the ones it sent.

## Gates, before and after

Before: `dda6eb2`, the previous phase's record; after: this branch's last commit. Windows, Node 22.23.3 (`.local/node22`). By the owner's standing
instruction (develop now, the heavy gates at the final build), only what the phase touches was run in a browser.

| Gate | Before (`dda6eb2`) | After |
|---|---|---|
| `npm run check:svelte` | 0 errors, 0 warnings (442 files) | 0 errors, 0 warnings (446 files) |
| `npm test` | 1,715 of 1,715 | 1,805 tests, all but `scripts/test-store.js`'s two timing tests (a read meeting a write; Windows EPERM, they pass alone) |
| `npm run test:baseline`, `test:bundle` (in `npm test`) | 38 of 38; 48 of 48 | translated and proved (above); 49 of 49 |
| `scripts/migration-tests/role-scoping.spec.ts`, `client-sessions.spec.ts` | the second 4 of 4 | Chromium 8 of 8 and 4 of 4; WebKit 8 of 8 and 4 of 4 |
| Chromium: `users`, `admin-guests`, `admin-today`, `admin-sharepoint`, `admin-content`, `request-baseline`, `review-9b`, `session-delete`, `results-restart-inline` | Phase 3's record | 91 of 101 on the first run; the keyboard order of Guests (the two new fields) and the "slugs" flake passed after the first run; the rest below |
| `npm run test:report`, `test:report:mutations`, `test:charts`, `test:local-site`, `oracle -- --seeds 500` | 150; 64 of 64; 57; 26; 0 differences | 150; 64 of 64; 57; 26; 0 differences (5,620 participants, 9,865 guests) |
| `npm run test:migration`, `test:a11y` (all browsers), `test:devices` | Phase 20's record | not run in full: the final round (below) |

## Page sizes (gzip -9)

| Page | Before (`dda6eb2`) | After | Change |
|---|---|---|---|
| `index.html` (participant) | 166,497 B | 166,683 B | +186 B: the read check (`read-scope.js`) and the guest list's column in every read (allowance 400 B; ceiling 450,000 B, not raised; its Tailwind rules unchanged, none of `lib/access` and none of the screens) |
| `admin.html` | 620,335 B | 623,918 B | +3,583 B: `scope.js`, `owners.js`, `ViewOnly`, the scoped reads, the group field (allowance 6,000 B; budget 700,000 B) |

`PHASE_21D` in `scripts/bundle-budget.js` records them. (The word "table" in a comment of `scope.js` first added a Tailwind rule to the participant
page; `npm run test:bundle` found it, and the comment now says "matrix".)

## Proven on the mock and in node, and only reasoned about

Proven (`scripts/test-scope.js`, `test-guest-group.js`, `role-scoping.spec.ts` and the suites above): the menu of each role; Content's edit, view and
none; the pickers; day one; the scoped queries and what the guard refuses; the data layer sending nothing for a refused read; a write held to the real
client; every non-"no" cell and a forbidden write per role; the group, with and without one; version 7's upgrade from 2, 3 and 6 and a site of version 6
stopping with PMS-LST-011; the built page in Chromium and WebKit for each role, with axe finding nothing on the view-only screens; the network log of a
Producer naming no other client.

Only reasoned about: the real site's answers to the scoped `$batch` reads and to the new column (QA 237, 239), a screen reader on View only (QA 245), and
the lists' own permissions (Phase 7).

**Known, not of this phase** (run on the final tree, failing for reasons that predate it): `admin-content-sharepoint.spec.ts` "Content loads in 4 requests"
counts 3 (since Phase 1); `schema-upgrade.spec.ts` and `schema-version.spec.ts` carry versions 2, 4 and 5 in their expectations (words last updated for
Prompt 20) and fail against this build's version; `admin-today.spec.ts` "slugs" failed once and passed on a rerun (the known flake of docs/TESTING.md).
`scripts/test-store.js`'s two timing tests fail under the full run on this Windows checkout (EPERM on a rename) and pass alone.

## The final round must run

`npm run test:migration` (the whole browser suite, three engines: Firefox does not start on this machine, docs/TESTING.md), `npm run test:a11y`,
`npm run test:devices`, `npm run look:exports`, and the manual list: QA-TESTING.md items 237 to 245, item 237 first (the upgrade). Then push `pms-21-4`
only after they pass.

## For Phase 5

- Add `PMSClients.Industry` and `Region` (and index `Period`, `GuestGroup` when a read filters on them): version 8, with the proof script
  (`guestgroup-baselines.js` is the model; before = this branch's tip).
- Leadership's dashboard reads: `reachOf(access)` already gives its periods; `scopedReader` and `mayRead` hold a period's sessions by date once
  `guard.learn('sessions', ...)` has them; answers by `sessionId` only for sessions inside the period.
- `pickerLabel` ("24 Oct 09:30 Morning workshop") is ready for the dashboard's session filter.
- The Hide names switch (decision B) is the first use of `results.names`; the matrix already has it.
