# Prompt 21, Phase 7: hardening and the real-site pass

Branch `pms-21-7`, made from `576e8b6` (the tip of `pms-21-6`, which is not merged). Not pushed. Phase 7 of seven, the last of Prompt 21: move the
access check from a guardrail towards a boundary, and say exactly what the real site must show.

**Nothing changes for a person who does not open the new screen**: no list, column or setting changed (schema version 8), no request baseline moved, and
the participant page differs only by one call to the read check, which asks nothing there (no guard is installed on it). What changed: Setup's plan names
the access lists' own permissions and its self-test reads them; every reader of a session's answers asks the read check; People has **History of changes**
for a Super admin, read only; and QA-TESTING.md has the real-site pass for the whole of Prompt 21.

## What was built

- **The access lists' permissions in Setup's plan** (brief item 1). `lib/setup/list-permissions.js`: `PMSUsers` and `PMSRoleAssignments` written only by
  a SharePoint group "PMS access managers" (the Super admins and the Admins) and the site's owners, read by the members; `PMSAuditLog` taking new lines
  from the members through a custom permission level "PMS add only" (View Items, Add Items, Open; no Edit, no Delete). `permissionSteps` is the four
  steps Setup's plan now ends with ("Who may change the access lists (by hand)", `setup/PlanView.svelte`); `permissionProbe` is a new self-test step,
  "Probe (read-only): who may change the access lists", which reads each list's `HasUniqueRoleAssignments` and role assignments (two GETs a list, no
  item, nothing written) and says, list by list, "as planned" or what differs (`permissionFindings`). **ASSUMED** until tried on PCOE: the two names,
  that the owners' group's name ends in "Owners" (SharePoint's default), and that a site owner may make a permission level there (QA item 263).
- **Written down honestly** (brief item 2): Producers and Designers must write the content, session, guest and answer lists to do their work, and a list's
  permission is the same for every item in it, so the separation between clients there is the app's (`can()`, the write guard, the read check). Holding
  it against someone who goes around the page needs a server component between the page and the lists, which this app does not have by design
  ([SHAREPOINT.md](../SHAREPOINT.md#who-may-do-what), [RULES.md](../RULES.md)).
- **History of changes** (brief item 3). `admin/AuditReview.svelte`, opened from People by a Super admin (`audit.view`, a new row of the matrix: Super
  admin Yes, every other role no). It reads `PMSAuditLog` once, writes nothing, and shows every line newest first in words ("Turned off: Gone, Leaver",
  "29 Oct 2026 09:00 UTC, by Satyadev, Vedala Venkata. Where: c-kroger"), filtered by what was done, by a person (who did it or to whom, by name or
  email) and by days, 50 to a page (`lib/access/audit-review.js`); a detail that looks like an answer is never shown.
- **The specialised readers ask the read check** (Phase 4's carry-over). `readAnswers` (so `readSessionResponses`, `readSessionResponsesChecked` and the
  leader report), `listSessionParticipants` and the Live display's `readLiveFeed` call `askRead` (`lib/data/responses.js`) before their first request:
  a session the person does not hold is `AccessDenied` and nothing is sent, as the plain reads have been since Phase 4.
- **The real-site checklist** (brief item 4): QA-TESTING.md items 262 to 273 and the runbook's step 21: the permissions set by hand and what they refuse,
  the people screens under the lock, directory search, the site-owner group, the legacy admins' copy, two sessions in a day, Leadership's scope, a
  disabled user, the sign-in renewal of Prompt 19 with the new reads, and History of changes.
- **Tests, written first and shown failing**: `scripts/test-hardening.js` (17; the modules did not exist, then the readers' test failed on the old data
  layer: a session not held reached the site), `scripts/test-access.js` (the printed matrix gains `audit.view`), `scripts/test-scope.js` (the
  completeness list names it), `scripts/test-foundation.js` (heading focus 17), `scripts/test-release-docs.js` (twenty-one steps), `scripts/test-bundle-budget.js`
  (`PHASE_21G`; Phase 6's test now holds its own figures, as every earlier phase's does); in the browser `users.spec.ts` (History of changes: focus, axe,
  the filters, no write, no button for an Admin; now in `npm run test:a11y`) and `setup-provision.spec.ts` (the plan's four steps; failed on the old build).

## Where the brief did not match the tree (said, as the brief asks)

1. **"Only a small SharePoint group may write `PMSUsers`, `PMSRoleAssignments`"**: an Admin gives team roles (`team.assign`) and, with the extra, adds
   people, so the group holds the Admins as well as the Super admins. Everyone must still **read** both lists: sign-in reads the person's own row and roles.
2. **"In Setup's plan"**: the plan names the permissions; Setup does not set them. Breaking a list's inheritance and making a permission level on a live
   site, untried, is easy to get wrong and hard to undo by a page; a site owner does the four steps by hand once, and the self-test reads the result. If
   PCOE allows it, a later phase may make it a button.
3. **"A disabled user is refused on the next call"**: turning someone off is a row in `PMSUsers`, which SharePoint does not read, so the lists themselves do
   not refuse a disabled person; the page does, at the next tab within five minutes (Phase 6) and at once on reload. A person who must lose all access is
   also removed from the site by its owner (QA item 271). Checking `PMSUsers` before every write would cost a request a write; not done (ASSUMED enough).
4. **The audit list is read whole** (as a person's history is since Phase 2), ASSUMED far below 5,000 lines; `TargetUser` and `Actor` stay unindexed
   because no recorded request filters on them (the repository's rule).
5. **The readers not checked**: `getParticipantResponses` (one visit's answers, by its id) and the QR scan's reads are the participant page's, which has
   no guard and no sign-in; the guard cannot hold a guest.

## Gates, before and after

Before: `576e8b6`, frozen at the start of this phase; after: this branch's last commit. Windows, Node 22 (`.local/node22`). This is the final build, so
the full browser run (`npm run test:migration`) ran as well.

| Gate | Before (`576e8b6`) | After |
|---|---|---|
| `npm run check:svelte` | 0 errors, 0 warnings (455 files) | 0 errors, 0 warnings (458 files) |
| `npm test` | 1,865 of 1,865 | 1,884 of 1,884 |
| `npm run test:bundle` (in `npm test`) | 51 of 51 | 52 of 52 |
| `npm run test:baseline` | 38 of 38 | 38 of 38 (no baseline moved) |
| `npm run test:report`, `test:report:mutations`, `test:charts`, `test:local-site` | 158; 64 of 64; 57; 26 | 158; 64 of 64; 57; 26 |
| `npm run oracle -- --seeds 500` | 0 differences | 0 differences (5,620 participants, 9,865 guests, 4,447 session summaries) |
| `npm run test:migration` (Chromium, WebKit; Firefox does not start here) | Phase 6 ran the specs it touched | 956 passed, 545 failed, 23 skipped, 17 did not run (52.8 min). 484 of the failures are Firefox, which does not start here. Of the 61 in Chromium and WebKit, every one is older than this phase (below); the one that was this phase's to look at, `users.spec.ts`'s "Add user, by keyboard alone" in WebKit, was a race of the test since Phase 2 and is fixed (48 of 48 with four workers) |
| `npm run test:a11y` | 145 of 149 (Phase 6) | 157 passed, 74 failed (69 Firefox; in Chromium and WebKit the four known faults below and the WebKit race above, since fixed), 3 skipped |

**The Chromium and WebKit failures of the full run, all older than this phase.** These specs were run on `576e8b6`'s tree (a `git archive` sharing
`node_modules`): `setup.spec.ts` (three tests: Setup sends two or three requests where "nothing" is expected, Chromium and WebKit), `setup-deployment.spec.ts`
(two), `flow.spec.ts`'s header in WebKit, `brand-studio.spec.ts`'s answer tile in Chromium and `reflow.spec.ts` fail there in the same words. The rest are
on the known list: `contrast.spec.ts` (the Live display's focus ring, 1.64:1), `reflow.spec.ts` (Content's chip at 200% text), `keyboard.spec.ts` in WebKit
(Today's "Open participant view"), `devices.spec.ts` (the Content strip on an iPhone in landscape), `schema-upgrade.spec.ts` and `schema-version.spec.ts`
(versions 2, 4 and 5 hard-coded), `setup-provision.spec.ts` ("91 columns" where the plan now says 100, "version 4"), `admin-content-sharepoint.spec.ts`
("4 requests", 3 since Phase 1), `admin-today.spec.ts`'s slugs flake, and `effects-audio.spec.ts` in WebKit (the audio of this machine). This phase's
own line in `setup.spec.ts` (the self-test's fifth probe: 12 of 12 steps, 56 requests) sits after the line that already fails there, so it is not seen run.

## Page sizes (the budget's gzip)

| Page | Before (`576e8b6`) | After | Change |
|---|---|---|---|
| `index.html` (participant) | 167,081 B | 167,109 B | +28 B: `askRead` in the answer readers (allowance 100 B; the same Tailwind rules; ceiling 450,000 B, not raised) |
| `admin.html` | 638,134 B | 640,183 B | +2,049 B: History of changes, its rules, `audit.view` (allowance 4,000 B; budget 700,000 B) |

`PHASE_21G` in `scripts/bundle-budget.js` records them.

## Proven on the mock and in node, and only reasoned about

Proven: the four steps and every finding of the permission check over SharePoint's own permission masks (Full Control, Contribute, Read, an add-only
level); the self-test probe's six GETs and a refused read said, not failed; Setup's plan showing the steps in the built page and writing nothing; a scoped
Producer's answer reads and Live feed of a session not held refused before any request on the mocked SharePoint, a session held read, a global role and
a page with no guard as before; History of changes in the built page (focus, axe, filters, no write; no button for an Admin).

Only reasoned about: everything SharePoint itself does with the permissions (whether PCOE allows a custom level, how the owners' group is named, what a
member is refused), whether `/roleassignments` with `$expand=Member,RoleDefinitionBindings` answers a site owner there as the mock does, and how a screen
reader speaks History of changes. All of it is QA items 262 to 273.

## Prompt 21, all seven phases: what was built

| Phase | Branch, last commit | What |
|---|---|---|
| 1 | `pms-21-1`, `441ee98` | The access engine: `PMSUsers`, `PMSRoleAssignments`, `PMSAuditLog` (schema 5), the role matrix and `can()`, sign-in resolution (site owner, listed person, legacy PIN, No access), the write guard and `AccessDenied`, the audit writer, Setup's copy of the old admins. [RELEASE-21A.md](RELEASE-21A.md) |
| 2 | `pms-21-2`, `43a98d4` | Manage Users: People (search, role chips, client and session filters, pages of 50), Add user with the people picker, a person's page (global roles, Give access, Remove, turn off, history). [RELEASE-21B.md](RELEASE-21B.md) |
| 3 | `pms-21-3`, `dda6eb2` | Clients and several sessions a day (schema 6): the client's page, New session, ids `<slug>-<date>-<hhmm>` with -2 on a duplicate, the period, the Client team, the Producer starts. [RELEASE-21C.md](RELEASE-21C.md) |
| 4 | `pms-21-4`, `ca3a16b` | Role scoping (schema 7): menus from the matrix, Content's View only, scoped reads and the read check, guest groups, Survey feedback. [RELEASE-21D.md](RELEASE-21D.md) |
| 5 | `pms-21-5`, `52cc8cf` | The Leadership dashboard (schema 8): the index arithmetic held to an oracle, `PMSSessionSummary` written at End session and by Rebuild, the dashboard of board 9 with its i buttons. [RELEASE-21E.md](RELEASE-21E.md) |
| 6 | `pms-21-6`, `576e8b6` | Polish: one Hide names switch for every Results surface and export, a person turned off while the page is open, empty states, words. [RELEASE-21F.md](RELEASE-21F.md) |
| 7 | `pms-21-7`, this branch | Hardening: the access lists' permissions (by hand, checked by the self-test), every answer reader asking the read check, History of changes, the real-site checklist. |

None is pushed: the owner pushes after testing on SharePoint, the branches in order (each is cut from the one before, so `pms-21-7` holds them all).

## Everything still open for the real site

1. **QA-TESTING.md items 216 to 273, in order, on a test copy first** (the open-now list names them by phase). The upgrade from version 3 or 4 to 8 is
   items 216, 229, 237 and 246 (one Setup run raises the lists to 8 at once: runbook step 2). Item 263 decides whether the lock holds on PCOE.
2. **For the manager** (the brief's section F and the release notes' open items): decision B's default (`HIDE_NAMES_BY_DEFAULT`); the fiscal-year start
   month (June ASSUMED); the index as a ratio and the minimum sample of 10; Industry and Region on clients (columns exist; the Region filter is not built);
   two sessions live at the same moment (not supported: one live session at a time); the confidence shift's divisor; the one-client Leadership baseline
   (open item 16); a saved view kept between visits (17); a PDF of the dashboard (18); whether five minutes before a turned-off person is stopped is
   acceptable (19).
3. **ASSUMED and to be seen on PCOE**: what "site owner" means there (item 221), the people picker (222), a duplicate session id answered as 500 (231), the
   permission level and the owners' group's name (263), and the browsers of the admin's laptops for `AbortSignal.any` (RELEASE-21B.md).
4. **Known faults older than this phase**, left as they were: the Live display's focus ring at 1.64:1 (`contrast.spec.ts`), Content's client chip cut
   at 200% text (`reflow.spec.ts`), WebKit's keyboard never reaching "Open participant view" on Today (`keyboard.spec.ts`), the admin's Content strip
   over the home indicator on an iPhone in landscape (`devices.spec.ts`, Chromium), and specs pinned to old schema numbers (`setup-provision.spec.ts`'s
   "91 columns" and "version 4", `schema-upgrade.spec.ts`, `schema-version.spec.ts`), `admin-content-sharepoint.spec.ts`'s "4 requests" (3 since Phase 1).
   None is a behaviour this prompt changed; each needs its own small change and a run on the real site.

## Lessons

- The command tool halves backslashes, even inside a quoted heredoc: an edit script with a regular expression goes through the Write or Edit tool.
- A release page may not name the site ("PCOE"): the words of a new Setup screen say "a real site".
- An Admin gives team roles, so "only Super admins write the roles list" would have locked out a matrix cell; read the matrix before naming a group.
