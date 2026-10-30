# Prompt 21, Phase 6: polish

Branch `pms-21-6`, made from `52cc8cf` (the tip of `pms-21-5`, which is not merged). Not pushed. Phase 6 of seven: tie the loose ends of Phases 1 to 5.
Phase 7 (hardening and the real-site pass) was not started.

**Nothing changes for a person who does not use the new switches**: no list, column or setting changed (schema version 8), no request of a normal visit
changed (no request baseline moved), and the participant page is the one Phase 5 left, to the byte. What changed: Results has one **Hide names** switch for
the dashboard, Sessions and every session's exports; the admin page notices, at the next tab after five minutes, that a person was turned off or lost
their last role while it was open; and the dashboard says why it has nothing to show.

## What was built

- **Hide names in every Results surface and export** (brief item 3). `withNamesHidden` (`lib/results/participant-names.js`, the one rule that names a
  participant) numbers everyone "Guest 1", "Guest 2" ... in the order they joined. `namesFor` and `resultRows` take `{ hide }` (Sessions' rows and each
  chart's names); `buildLeaderReport(records, { hideNames })` renames the participants, their comments and their answers to removed questions, adds
  `NAMES_HIDDEN_NOTE` to the notes and says how people are shown above What participants said; All answers (CSV) follows, being made from the report.
  The switch is one, held by `admin/ResultsTab.svelte` while the page is open (from `HIDE_NAMES_BY_DEFAULT`), shown in the dashboard's More filters and
  in Sessions' head beside Refresh, and given to every `ReportExports`. A role without `results.names` never sees a name and is not offered it. The wall,
  the Live display's PDF and PowerPoint and the summary CSV have no names already; `COUNTING_RULES` is unchanged.
- **The Survey feedback rename in exports and the leader report** (brief item 2) was found done by Phase 4 (the leader report's kind, the pack, the
  content pack, the editor; the dashboard says Survey feedback). A search of the source for "Open feedback", "open text" and "Written answer" as shown
  words finds none. Nothing to change.
- **Empty, loading and error states** (brief item 4):
  - *A user disabled mid-session.* `lib/access/resolve.js`: `RECHECK_AFTER_MS` (five minutes, ASSUMED), `recheckDue`, `lostAccess` (`turned-off`,
    `role-removed`; never the site owner) and `withoutGrants`. The admin page reads the access again when a tab is opened or the page is shown again, at
    most once in that time; a person who may no longer enter is stopped (every write refused, no tab row) and No access says, in plain words, that it
    happened while the page was open and that what was saved is kept. A changed role changes the menu.
  - *A Leadership user with no scope.* Such a person cannot reach the dashboard: `grantsOf` drops a role row that names no place, so sign-in shows No
    access ("You do not have access ... yet"), as Phase 1 built it. The dashboard guards it anyway (`emptyStateOf`: "No clients to show yet", nothing read).
  - *A session with no answers.* Its summary reads "None yet" and "Not measured" on the tiles and in the headline, never NaN (a test now holds it).
  - *No summary yet.* The dashboard shows "No session has ended yet", or "No summaries yet" with Rebuild when ended sessions wait, instead of empty filters
    and figures; Export report is off.
- **Wording review** (brief item 1) of the new screens (People, a person's page, Give access, the client's page and team, the dashboard, the i buttons, No
  access, View only). Two changes: Rebuild's question no longer speaks of "requests" (`rebuildQuestion`), and Export report's file is named like the other
  exports, "dashboard-fy27-q2-2026-10-29.csv" (`dashboardFileName`), not "PMS dashboard FY27 Q2.csv". Every other new screen's words were already plain
  and in sentence case.
- **Prompt 20** (brief item 5) had already run (Phase 20, `pms-20`): nothing to run.
- **Tests, written first and shown failing**: `scripts/test-hide-names.js` (8: the module's export did not exist; the PDF's line failed before the layout
  changed), `scripts/test-access-recheck.js` (4: the exports did not exist), `scripts/test-leader-dashboard.js` parts 4 and 5 (6: `emptyStateOf`,
  `rebuildQuestion`, `dashboardFileName` did not exist; the "no summaries yet" case failed before it was added; the no-answers case passed at once and is
  kept as a guard of what held), `scripts/test-bundle-budget.js` (`PHASE_21F`), and three browser tests: `leader-report.spec.ts` (Hide names on Sessions, in
  the PDF and the CSV), `role-scoping.spec.ts` (turned off while open, with the page's clock moved on five minutes), `leader-dashboard.spec.ts` (no summary
  yet; the switch shared with Sessions).

## Carry-overs from Phase 5, settled

| Carry-over | What was decided |
|---|---|
| Hide names in the Sessions view and the exports | Built: one switch for all of Results (above). |
| Wording review of the dashboard | Done: Rebuild's question and the export's file name. |
| Empty and error states | Built: no summary, waiting for Rebuild, no scope (guarded), no answers, turned off while open. |
| A PDF of the dashboard (open item 18) | Not built: the brief's Phase 6 does not ask for it; the CSV and each session's leader report stand. Open item 18 stays. |
| A Region filter | Not built: board 9's filters have none, and Phase 6 adds no screen. Region stays a tag for a later filter (ASSUMED). |
| Save this view kept only while the page is open (open item 17) | Unchanged; Hide names is kept the same way. |
| A one-client Leadership baseline is itself (open item 16) | Unchanged. |

## Where the brief did not match the tree (said, as the brief asks)

1. **"A Leadership user with no scope"** cannot exist in the tree: a role row with no client, session or period is no grant (`grantsOf`), and a person
   with no grant meets No access at sign-in. The dashboard's guard (`emptyStateOf`, "No clients to show yet") is there for a page whose access changes
   under it, and is held by a test.
2. **"A user disabled mid-session"**: the page read its access once, at sign-in, so a disabled person kept working until a reload. The brief's Phase 1
   says "re-read on demand"; this phase reads again on a tab or on coming back, at most every five minutes (ASSUMED), so a normal visit sends nothing more
   and no request baseline changes. On SharePoint the lists still accept a disabled person's writes made outside the page: Phase 7.
3. **The rename** was done by Phase 4 (above).
4. **Prompt 20** had run before Prompt 21 (Phase 20).
5. **Screenshots at iPad sizes for the participant page**: the page is byte for byte Phase 5's (`PHASE_21F`, +0 B), so `devices.spec.ts` was run in
   Chromium and WebKit on it (below) rather than new pictures taken by hand.

## Open items for the manager

The earlier eighteen stand. New: 19. Whether five minutes is short enough for a person turned off while their page is open to be stopped (QA item 258),
until Phase 7's list permissions make the lists refuse them.

## Requests

No request baseline changed: nothing a recorded suite does sends anything new. Hide names works on what was already read. The access is read again only
after five minutes and only on SharePoint with a signed-in person: three requests (who is signed in, then the row and the roles, two indexed reads
together), the same as at sign-in (`scripts/test-access.js` counts them). No browser spec's request count changed.

## Gates, before and after

Before: `52cc8cf`, frozen at the start of this phase; after: this branch's last commit. Windows, Node 22.23.3 (`.local/node22`). By the owner's standing
instruction (develop now, the heavy gates at the final build), the browser specs this phase touched ran in Chromium and WebKit, with `test:a11y`.

| Gate | Before (`52cc8cf`) | After |
|---|---|---|
| `npm run check:svelte` | 0 errors, 0 warnings (455 files) | 0 errors, 0 warnings (455 files) |
| `npm test` | 1,847 of 1,847 | 1,864 of 1,865 on the final run: `scripts/test-data-modules.js`'s import-cycle walk read a temporary file another suite made and removed at that moment (ENOENT, `.client-theme.pms14.tmp.js`); it passes alone, 8 of 8 |
| `npm run test:bundle` (in `npm test`) | 50 of 50 | 51 of 51 |
| `npm run test:report`, `test:report:mutations`, `test:charts`, `test:local-site` | 150; 64 of 64; 57; 26 | 158; 64 of 64; 57; 26 |
| `npm run oracle -- --seeds 500` | 0 differences | 0 differences (5,620 participants, 9,865 guests, 4,447 session summaries) |
| `leader-report.spec.ts`, `leader-dashboard.spec.ts`, `role-scoping.spec.ts` | Phase 5's record | Chromium and WebKit: all pass (33 of 33 for the first two; role-scoping 9 of 9 in each) |
| `npm run test:a11y` specs (Chromium and WebKit) | not run in full by Phase 5 | 145 of 149 (3 skipped): four failing tests, the three faults below, all older than this phase |
| `devices.spec.ts` (iPad sizes, Chromium and WebKit) | Phase 20's record | 39 of 40: the participant page on every iPad and iPhone profile passes in both engines; the one failure is the admin's Content strip on an iPhone in landscape in Chromium (Activities and Brand end 10 px from the bottom, over the home indicator), a screen this phase did not change (not run on `52cc8cf`) |

**Three a11y failures older than this phase.** Each was run on `52cc8cf`'s tree (a `git archive` with the same `node_modules`) and fails there in the same
words: `contrast.spec.ts` (the Live display's focus ring in the default look, 1.64:1 beside "Plain Co Live results 2"), `reflow.spec.ts` (Content's client
chip "D" cut off at 200% text at 820 px, Chromium and WebKit), and `keyboard.spec.ts` in WebKit (Today's "Open participant view" never reached by Tab). They
are left for the final round. One a11y failure *was* this phase's and is fixed: Results' head placed Hide names between the refresh time, which changes as
the live session refreshes, and Refresh, so the contrast check measured the label while it moved (3.64:1); the switch and Refresh are now one group.

## Page sizes (gzip -9)

| Page | Before (`52cc8cf`) | After | Change |
|---|---|---|---|
| `index.html` (participant) | 167,081 B | 167,081 B | +0 B (allowance 0 B; the same Tailwind rules; ceiling 450,000 B, not raised) |
| `admin.html` | 636,734 B | 638,134 B | +1,400 B: the switch and its rule, the report's option, the access read again, the empty states and words (allowance 4,000 B; budget 700,000 B) |

`PHASE_21F` in `scripts/bundle-budget.js` records them.

## Proven on the mock and in node, and only reasoned about

Proven: Hide names over a session of seven visits (named by QR code, sign-in and roster, two with no name, one person twice) in the rows, the charts'
names, the report, its comments and removed questions, its PDF read back and the CSV, with no recorded name left, and off as before; the switch shared
between the dashboard and Sessions in the built page; a person turned off, or left with no role, while the page is open stopped at the next tab after five
minutes on the mocked SharePoint, with axe finding nothing; the site owner never stopped; the dashboard with no summary, in the built page; a session
with no answers giving no NaN.

Only reasoned about: SharePoint's own answer to the reads made again (the same as at sign-in, proven there in Phase 1); a real tab left in the background
and shown again (`visibilitychange`); how a screen reader speaks No access and the empty states (QA 258 to 261).

## Lessons

- A page's own guard counts: the counting rules' fixed words ("Unnamed participant 1, 2 ...") are on every report, so a test that no hidden name is left
  must look for the recorded names, not the fallback's words.
- An empty state can hide a control another spec expected (Hide names under More filters on a dashboard with no summary): put a check where its data is.
- A label placed in a row that spaces its items evenly moves when a neighbour's text changes; group a control with its own button.
