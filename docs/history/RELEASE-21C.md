# Prompt 21, Phase 3: clients, sessions several a day, and the team

Branch `pms-21-3`, made from `43a98d4` (the tip of `pms-21-2`, which is not merged). Not pushed. Design source: boards 5 and 6 of the wireframes
approved on 27 Oct 2026 (a client's sessions; the client team). Phase 3 of seven: an Admin plans a client's sessions, several in one day if needed,
and picks its team; a Producer starts a session. Phase 4 (role scoping: menus and screens from the role table) was not started.

**An existing admin's day does not change**: with nothing planned for a client that day, the PIN's legacy admin (and a Super admin) presses Go live on
Today as before, and it makes the day's session under its old id, `<slug>-<date>`. What changed for them: the site must first be brought to version 6
by Setup (four columns), a client's row on Clients has **Sessions and team**, the slug's help names the start time, and Today says plainly when going
live would take the place of another live session.

**Day one** (say it to the manager): existing clients and sessions keep their ids, and nothing is copied. Until a client has a team, only Super admins and
Admins will see it on the screens Phase 4 scopes by role: this phase writes the team rows; Phase 4 builds the menus and screens from them.

## What was built

- **Schema version 6** (`lib/schema/pms-schema.js`, `pms-schema-meta.js`; `SHAREPOINT-LISTS.md` regenerated): `PMSClientSessions.StartTime` (text
  `HH:mm`), `Sequence` (number), `Period` (text, `FY27-Q2`) and `PlannedDate` (Date & Time), all since 6, and a session's title in the built-in
  `Title`. Setup's plan creates them (Create: 16 lists, 125 columns, 57 settings on an empty site); a site of version 5 stops with PMS-LST-011 until
  then.
- **The data layer, section 14** (`lib/data/planning.js`): `planSession` (a planned session under the id the page gives it; a duplicate is tried again
  as `-2`, `-3`, up to `-9`) and `startSession` (the Producer's Start: the activities added since planning join it, the codes nobody scanned for the
  session it replaces stop working, the settings item names it). The public surface is 122 names (`scripts/data-surface.json`, docs/DECISIONS.md).
- **The rules**: `lib/admin/session-plan.js` (the period, the id, the New session form, the day's sessions and "1 of 2 today", Planned / Live / Ended,
  the one-live words, Today's session picker words) and `lib/access/team.js` (the client's team, the people it offers, the Add form, `addToTeam`, a
  session's team words). `LIST_WRITES.sessions.create` is `clients.manage` alone (it allowed `events.run` while Today made the day's session for anyone
  who could go live).
- **A client's page** (`admin/ClientWorkspace.svelte`, `ClientSessions.svelte`, `ClientTeam.svelte`), opened by **Sessions and team** on a client's
  row: the Sessions list (date and time, title, period, status, team), **New session**, the **Client team** (Add, Remove with what they lose).
- **Today**: when a client has sessions planned that day, a **Session** picker; Go live starts the one picked (`startPlannedSession`); an Admin is told
  "Only a Producer or a Super admin starts a session."; a Producer with nothing planned meets "No session is planned for <client> on <date>."; and
  "One session can be live at a time..." when another is live.
- **Found on the way**: Results read the visit log and the guest list of 20 sessions to an address, and 20 of the longer ids made 2,013 characters
  on the real site's address: it now reads 15 (`NAME_SOURCE_SESSIONS`). Content's "the confidence check may not be deleted" looked at the client's
  first open session only; with several open, it looks at all of them. In WebKit (Safari), a date field sends its change again when it loses the
  focus, so pressing Go live just after typing a date re-checked readiness under the press and the press was lost (found by the WebKit run of
  `client-sessions.spec.ts`): Today now ignores a date pick that did not change the date.
- **Tests**: `scripts/test-sessions-plan.js` (29 tests, written first and shown failing: the modules did not exist) and
  `scripts/migration-tests/client-sessions.spec.ts` (4 specs on the built page, in `npm run test:a11y`).

## Every place that builds or reads a session id (the brief asked for the list)

| Place | What it does with the id | Since this phase |
|---|---|---|
| `lib/data/today.js` `sessionIdFor`, `activateClient` | builds `<slug>-<date>`, the day's session of Go live | kept, for a day with nothing planned (an existing id) |
| `lib/admin/session-plan.js` `plannedSessionId` | builds `<slug>-<date>-<hhmm>` | new, the one place a new id is built |
| `lib/data/planning.js` `planSession` | adds `-2`, `-3` when refused | new |
| `lib/admin/admin-today.js` `loadReadinessInputs` | found the target by `sessionIdFor` | finds the day's picked session (`daySessionPick`) |
| `admin/AdminToday.svelte` | compared with `sessionIdFor` | the same, only to tell the day's session from a planned one |
| `lib/admin/admin-clients.js` (`SESSIONS_TO_A_READ`), `lib/admin/admin-results.js` (`NAME_SOURCE_SESSIONS`) | many ids in one address | 15 to a read (the longer id) |
| `lib/data/records.js` `provisionQrToken`, `qrUrl`; `lib/data/qr-scan.js` | a code carries its own id; the session is the live one | unchanged |
| `lib/exports/leader-report.js`, `resultsExport.js` | a file name made safe from the id | unchanged (opaque) |
| `scripts/go-live.js`, `server/` | the local convenience calls `activateClient`; the server keeps ids as given | unchanged |
| the tests' fixtures | `<slug>-<date>` | unchanged: an existing id keeps working |

## Today: every changed test, and why

- **None of `scripts/test-admin-today.js`'s tests changed**: with one session that day under its old id, Today picks it as before, and every request
  it sends is the one it sent (its baseline was translated for version 6's columns only).
- `scripts/migration-tests/admin-today.spec.ts` "slugs": the slug's help says "Session ids are the slug, the date and the start time" (it said "the slug
  and the date"): words a person reads changed.
- `scripts/test-today-view.js`: unchanged; `goLiveWhy` gained `mayRun` (default true), held by `scripts/test-sessions-plan.js`.
- New, in `scripts/test-sessions-plan.js` and `client-sessions.spec.ts`: an Admin cannot start, a Producer starts a planned session, the blocker with
  nothing planned, the day's session picked for its roster, the one-live words.

## Where the brief did not match the tree (said, as the brief asks)

1. **`Title` is not a new column**: every SharePoint list has it, and the data layer has always written a session's id into it. A session's title is
   that column (as an activity's is); a title equal to the id reads as none. So version 6 adds four columns, not five.
2. **`Period` is not indexed**: the repository's rule is exactly what a recorded request filters on (`scripts/test-schema.js`), and nothing filters on
   it yet. Phase 5 (the dashboard) indexes it with the first read that filters on it.
3. **`PlannedDate`** is read as "when the session was planned" (ASSUMED: the brief names the column only). `SessionDate` stays the session's day.
4. **`Sequence`** is the order the client's sessions of that day were planned in; the screens say "1 of 2 today" by start time, so a session planned
   later for an earlier time still reads first.
5. **Planned / Live / Ended**: Live is the session the settings item names; a session visited once and no longer live, but not ended, reads Planned
   (ASSUMED).
6. **"Use the client team"**: on, the whole-client rows cover the session and nothing is written; off, the team form opens on the new session (ASSUMED:
   the brief names the checkbox only).
7. **The day's session for those who may do both**: Today's "create a session" flow is now the Admin's plan and the Producer's start; for a day with
   nothing planned, the PIN's legacy admin and a Super admin still go live as before, under the old id, so that an existing admin keeps working until
   the switch-over. Every session planned on the client's page gets the new id.
8. **`PMSClients.Industry`, `Region` and `PMSGuestList.GuestGroup`** are left to Phases 4 and 5: no screen of this phase uses them.
9. **A Designer of selected sessions**: the role is written, but an activity belongs to its client, and the write guard does not let a session's role
   edit it (`can()`'s rule for a session's place). What such a Designer may change is Phase 4's to decide.

## Open items for the manager

The brief's six and Phases 1 and 2's (7 to 10) stand. New: 11. Whether the fiscal year is named by the year it ends in (FY27 = June 2026 to May 2027,
as built). 12. Whether a visited session that is no longer live should read Planned (as built) or another word. 13. Two sessions live at once is
the known limit, reported, not solved (`PMSAppSettings.ActiveSessionId`).

## Requests

Schema version 6 changed what the data layer sends in two ways only: every read of the sessions names five columns more at the end of its `$select`, and
Setup makes and reads back the four new columns. The request baselines followed by `scripts/schema-baseline/sessions-baselines.js`: every one of the 17
recorded suites run on `43a98d4`'s tree and on today's, request by request (the two Setup suites, whose lanes interleave, by count), then a fresh
recording equal to the translation in all 17; the browsers' three start-up baselines translated by the same `$select` rule. Then, as a change of its
own, Results' 15 sessions to a read: two baselines amended with `--amend --code` for the two tests that send it (`test-named-reads`'s long addresses,
`test-participant-names`'s twenty-one sessions, still one request). No baseline was recorded again. A client's page sends one `$batch` and two whole
reads when it opens; planning a session one read and one write; Go live on a planned session what Go live sent, by `startSession`.

## Gates, before and after

Before: `43a98d4`, in this checkout, before anything changed; after: this branch's last code commit. Windows, Node 22.23.3 (`.local/node22`). By the
owner's standing instruction (develop now, the heavy gates at the final build), only what the phase touches was run in a browser.

GATES_TABLE

## Page sizes (gzip -9)

| Page | Before (`43a98d4`) | After | Change |
|---|---:|---:|---|
| `index.html` (participant) | 166,085 B | 166,497 B | +412 B: section 14 of the data layer and a session's five columns in every read of the sessions (allowance 600 B; ceiling 450,000 B, not raised; its Tailwind rules unchanged; none of `lib/access` and none of the client's page) |
| `admin.html` | 608,919 B | 620,333 B | +11,414 B: the client's page, Today's picker, `session-plan.js`, `team.js` (allowance 13,000 B; budget 700,000 B) |

`PHASE_21C` in `scripts/bundle-budget.js` records them.

## Proven on the mock and in node, and only reasoned about

Proven (`scripts/test-sessions-plan.js`, `client-sessions.spec.ts`, and the suites above): version 6's columns and a site of version 5 stopping with
PMS-LST-011; Setup's upgrade from 2, 3 and 5 to 6; the period; the id and its `-2`, `-3` on the fake's duplicate; two sessions on one day for one client
and for two, with their QR codes and visits tied to their own session; starting a planned session; the form; the labels; the team (registered people
only, whole client or selected sessions, the extra, Remove, the audit lines); the Admin refused a start and the Producer refused a plan by the data
layer's guard (nothing sent); Today's blocker and picker; the built page in Chromium and WebKit for an Admin and a Producer, with axe finding nothing.

Only reasoned about: what the real PCOE site answers to a duplicate on `PMSClientSessions` (QA 231), its `Title` of an older session (QA 230), a real
iPad's and Safari's date field (QA 235), and how a screen reader speaks the new screens (QA 236).

**Known, not of this phase**: `admin-content-sharepoint.spec.ts` "Content loads in 4 requests from the PIN" counts 3 in Chromium, and does so on
`43a98d4` too (run there on 29 Oct 2026): since Phase 1 the write token is fetched by the sign-in step before the PIN, as RELEASE-21A.md said the
start-up counting specs would move. The final round decides its number. `admin-today.spec.ts` "slugs" failed once in three runs here: the known
flake of docs/TESTING.md.

## The final round must run

`npm run test:migration` in Chromium and WebKit (with `client-sessions.spec.ts`; `admin-content-sharepoint.spec.ts`'s start-up count, above);
`npm run test:a11y` (it now includes `client-sessions`); `focus.spec.ts` and `keyboard.spec.ts` may add the two new headings (`scripts/test-foundation.js`
counts 15); `request-baseline.spec.ts` against the translated browser baselines.

## The package

Made by `npm run package:release` from this branch's last commit, in a fresh checkout of it; its name is `pms-` and that commit, and its checksums
were verified against `SHA256SUMS.txt` (the session's report names it).
