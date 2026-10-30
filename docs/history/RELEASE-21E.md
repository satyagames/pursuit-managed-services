# Prompt 21, Phase 5: the Leadership dashboard and the index arithmetic

Branch `pms-21-5`, made from `ca3a16b` (the tip of `pms-21-4`, which is not merged). Not pushed. Design source: boards 9 and 12 of the wireframes
approved on 27 Oct 2026 (the dashboard, the glossary of its figures). Phase 5 of seven: Results as a leader's view, the arithmetic first and the screen
second. Phase 6 (polish) was not started.

**An existing admin's day does not change**: the PIN's legacy admin and every role that runs sessions open Results on **Sessions**, exactly as before; a
global role's requests are the ones it sent, but for the clients' two new columns in every read of the clients and the new list in Today's column check
(the request baselines are translated, below). What changed for everyone: the site must first be brought to version 8 by Setup (one list, two columns),
ending a session on Today now also writes its summary (one more read of that session and one write), Delete session removes that summary too, and Results
has a **Dashboard** view beside **Sessions**. What changed for Leadership: Results opens on the dashboard.

## What was built

- **The arithmetic** (`lib/results/index-math.js`, plain JS): `indexOf(segment, baseline)` = segment / baseline x 100 with the divide-by-zero guard (null,
  never Infinity), the client index (mean After of a group, each session weighed by its Afters, over the baseline's), the session index (against the
  client's own average), the priority index (an option's share of first choices over its share in the baseline, options grouped by label), change, low
  sample, the pooled confidence shift and moved to confident, and the quarters and four baselines (all-client average, the quarter before, the same quarter
  last year, one chosen client) from `FiscalYearStartMonth` (`periodRange`, `periodsBetween`, `priorQuarter`, `sameQuarterLastYear`).
- **A summary of each session** (`lib/results/session-summary.js`, schema version 8's `PMSSessionSummary`): from the leader report's model (its counting
  rules, first answers only) and its confidence check: guests, answers, finished, the Before, After and paired counts and means, and SummaryJson (title,
  time, writer, the paired means and scale, moved, the steps Before and After, first choices of polls and rankings, kinds of question, guest groups,
  Survey feedback themes and up to five comments with their author). Written by Today's **End session** and by the dashboard's **Rebuild summaries**
  (`lib/admin/session-summaries.js`); made, or written over on a duplicate (`saveSessionSummary`, `lib/data/summaries.js`, section 15).
- **The dashboard's reads** (`readSessionSummaries`, `readDashboard`): the summaries and the clients, two requests, whatever the answers. A global role reads
  the list whole; a client's role by `ClientId`, a session's by AppId, a Leadership period by `Period` (the quarters it touches; days outside it dropped in
  the page); the read check (`lib/access/owners.js`) refuses anything else before a request.
- **The dashboard** (`admin/LeaderDashboard.svelte`, board 9; `lib/results/dashboard-model.js`): the filters (period chips FY, Q1 to Q4, Month, Custom;
  Compare with; Clients; Industry; More filters: Facilitator, Activity type, Guest group, Minimum sample, Hide names; Save this view; Reset; Export report),
  the headline sentence built from the numbers, six tiles (sessions, guests, completion, confidence index, confidence shift, moved to confident), the index
  by client against a line at 100, the trend by quarter, **By client with an arrow that opens that client's sessions in place**, each with its own Export,
  the priority index, the confidence steps Before and After, and Survey feedback themes and comments. **An i button on every figure**
  (`admin/MetricInfo.svelte`): hover, focus or a press shows the formula, what it means and an example, worded once in `lib/results/metric-words.js`.
- **Results has two views** (`admin/ResultsTab.svelte`): Leadership opens on the dashboard, everyone else on Sessions; only the view shown is mounted.
- **Names follow decision B**: comments show names, **Hide names** gives Guest 1, Guest 2, `HIDE_NAMES_BY_DEFAULT` is the one setting that turns the default
  round, and a role without `results.names` never sees a name.
- **Prompt 20 has landed**, so the **Confidence shift** and **Moved to confident** tiles are there, from `confidence-shift.js`'s rules (the shift's divisor
  is that file's one line, open item 6).
- **Schema version 8**: `PMSSessionSummary` (13 columns, AppId unique, `ClientId` and `Period` indexed: what the dashboard reads it by) and
  `PMSClients.Industry` and `Region` (optional text, filtered in the page). Setup makes them; the self-test and Today's check know them.
- **Tests, written first and shown failing**: `scripts/test-index-math.js` (15: the module did not exist), `scripts/test-session-summary.js` (9, four
  guests worked by hand), `scripts/test-leader-dashboard.js` (14: the read check per role, the places, the mocked reads, **10,000 answers cost the same two
  requests as none**, the figures worked by hand, the filters, the CSV), the oracle's recount of the indexes (`scripts/oracle-results.js`, 0 differences over
  500 seeds, 4,447 summaries; three mutants of `index-math.js` caught), and `scripts/migration-tests/leader-dashboard.spec.ts` (5 on the built page in
  Chromium and WebKit: the heading focused, the scope, the expanded row, the tooltip by keyboard, the filters by keyboard, axe) in `npm run test:a11y`.

## Carry-overs from Phase 4, settled

| Carry-over | What was decided |
|---|---|
| `PMSClients.Industry` and `Region` | Added (version 8) with the dashboard's Industry filter; filtered in the page, so not indexed (the repository's index rule). Region has no filter on board 9's first row: it is kept for the next one (ASSUMED). |
| Index `Period` when a read filters on it | The dashboard filters the summaries, so `PMSSessionSummary.Period` is indexed; `PMSClientSessions.Period` stays unindexed (nothing filters on it). |
| Leadership period holders read the sessions and clients lists whole | The dashboard reads neither the sessions nor any answer: the summaries by `Period` and the clients (names and tags). Results' Sessions view still reads as before. |
| `pickerLabel` ("24 Oct 09:30 Morning workshop") | The expanded row labels each session in those words, from its summary. |
| The Hide names switch (decision B) | Built, with one setting for the default. |

## Where the brief did not match the tree (said, as the brief asks)

1. **`PMSSessionSummary.SessionId`** is the list's AppId: every list is keyed by AppId (unique, indexed), so a second unique column holding the same id
   would be one more thing to keep equal. **`SessionDate`** is added (not in the brief's columns) for the Month and Custom filters, which a period cannot
   answer.
2. **MeanBefore and MeanAfter** are over every Before and every After (the confidence index's mean, `confidence-shift.js` decision 4); the paired guests'
   means, which the shift needs, are in SummaryJson (ASSUMED).
3. **"All-client average" for a person who holds one client** is the average of what they may read: their own client, so its index is 100 (ASSUMED; the
   alternative, letting them read other clients' totals, is a decision for the manager, open item 16).
4. **Facilitator** has no column of its own in any list: the filter uses the summary's writer, the person who ended the session or rebuilt it (ASSUMED).
   **Activity type** keeps the sessions that asked that kind of question; **Guest group** the sessions a guest of that group joined.
5. **Save this view** keeps the filters while the page is open (across its tabs), not between visits: the repository keeps nothing in the browser
   between page loads (`scripts/test-participant-storage.js`), and no new `pms-config.txt` key is allowed. A view kept across visits needs a place of its
   own (a column or a list): open item 17.
6. **Export report** is a CSV of the dashboard (one row a session, by client, with both indexes, through `csvCell`); each session's own Export (the
   leader report, the CSVs) is in its row. A PDF of the dashboard itself was not built (ASSUMED enough for now; Phase 6 may add it).
7. **The trend by quarter** shows the four quarters up to the one in view, each against their mean (an index against the all-client average of the same
   quarter would read 100 for every quarter when every client is chosen). The **change** of a client is its index now less its index in the quarter
   before, against that quarter's all-client average. The **confidence steps** add up the sessions of the most common scale (ASSUMED).
8. **The rebuild cost**: Rebuild writes the summaries of the ended sessions the person may run that have none, one after another; each reads that
   session's records as the leader report does (about five requests on SharePoint: the session, its activities, tracks, visits and roster in one
   `$batch`, its questions and options, its answers) and writes one item. A site with 200 old sessions costs about 1,200 requests, paced one session at a
   time; it says so before it starts, and a session that fails is counted and the rest carry on.
9. **Leadership's Results** opened on the session cards in Phase 4's `role-scoping.spec.ts`; it now opens on the dashboard, and that test presses
   **Sessions** first. The heading-focus count of `scripts/test-foundation.js` is 16 (the dashboard focuses its heading when it opens and after Reset).
10. **The injected failure in Setup's part-way test** (`scripts/test-provision.js`) moved from the 43rd write to the 44th: version 8 makes one list more
    before it, and the test still stops at the same column (AppId of `PMSActivityQuestions`), as Prompt 21, Phase 1 moved it from the 40th.

## Open items for the manager

The earlier fifteen stand (decision B's default, the fiscal start month, the index as a ratio and the minimum sample, Industry and Region, two sessions
live at once, the shift's divisor among them). New: 16. Whether Leadership of one client may compare against other clients' totals (as built: no, the
baseline is what they may read). 17. Where a saved view of the dashboard should live between visits (as built: only while the page is open).
18. Whether the dashboard needs a PDF of its own beside the CSV.

## Requests

Schema version 8 changed what the data layer sends in three ways only: every read of the clients names two columns more at the end of its `$select`; a
read of every list's columns (Today's check, the self-test's) carries the new list after the fifteen; and requests that name the new list, or make or
read back the clients' two columns, are new. The request baselines followed by `scripts/schema-baseline/summary-baselines.js` (the model is Phase 1's
`access-baselines.js`): every one of the 17 recorded suites run on `ca3a16b`'s tree and on today's, request by request (the two Setup suites, whose lanes
interleave, by count), then a fresh recording equal to the translation in all 17; the browsers' three start-up baselines translated by the same `$select`
rule. Then one deliberate change of code: **Delete session removes the summary**, so `test-session-delete`'s baseline was amended with
`node scripts/request-baseline.js --amend test-session-delete --code` for the tests whose scene or delete changed (84 entries: the summary's read and
delete, the scene's two summaries, item numbers one higher). No baseline was recorded again. Today's End session writes a summary in the page (one more
read of that session and one write); no node suite records it, and the browser specs that end or delete a session pass.

## Gates, before and after

Before: `ca3a16b`, frozen at the start of this phase; after: this branch's last commit. Windows, Node 22.23.3 (`.local/node22`). By the owner's standing
instruction (develop now, the heavy gates at the final build), only what the phase touches was run in a browser.

| Gate | Before (`ca3a16b`) | After |
|---|---|---|
| `npm run check:svelte` | 0 errors, 0 warnings (446 files) | 0 errors, 0 warnings (455 files) |
| `npm test` | 1,803 of 1,805 (`scripts/test-store.js`'s two timing tests: Windows EPERM, they pass alone) | 1,846 of 1,847 on the final run: one of the same two timing tests (a run before had both, and the heading-focus count before its fix) |
| `npm run test:baseline`, `test:bundle` (in `npm test`) | 38 of 38; 49 of 49 | translated and proved (above); 50 of 50 |
| `npm run test:report`, `test:report:mutations`, `test:charts`, `test:local-site` | 150; 64 of 64; 57; 26 | 150; 64 of 64; 57; 26 |
| `npm run oracle -- --seeds 500` | 0 differences (5,620 participants, 9,865 guests) | 0 differences (the same, and 4,447 session summaries of a dashboard) |
| `leader-dashboard.spec.ts`, `role-scoping.spec.ts`, `client-sessions.spec.ts` | the second 8 of 8, the third 4 of 4 | Chromium and WebKit: 5, 8 and 4 of each, 34 of 34 |
| Chromium: `admin-today`, `end-session`, `session-delete`, `review-9b`, `clients` | Phase 4's record | 47 of 47 |
| `npm run test:migration`, `test:a11y` (all browsers), `test:devices` | Phase 20's record | not run in full: the final round (below) |

## Page sizes (gzip -9)

| Page | Before (`ca3a16b`) | After | Change |
|---|---|---|---|
| `index.html` (participant) | 166,683 B | 167,081 B | +398 B: the data layer's summaries part (`lib/data/summaries.js`), the clients' two columns in every read and the new list in the schema file (allowance 600 B; ceiling 450,000 B, not raised; its Tailwind rules unchanged; none of the dashboard) |
| `admin.html` | 623,918 B | 636,734 B | +12,816 B: the dashboard, its model, arithmetic and words, the summary and its reads (allowance 30,000 B; budget 700,000 B) |

`PHASE_21E` in `scripts/bundle-budget.js` records them.

## Proven on the mock and in node, and only reasoned about

Proven (the suites above): every index, baseline, quarter and shift worked by hand and recounted by the oracle; a summary from the leader report's counts;
a summary made and written over; each role reading only its summaries, and the read check refusing the rest before a request; 10,000 answers costing two
requests; every figure and filter of the board; the CSV with no formula; version 8's upgrade from 2, 3 and 7, and a site of version 7 stopping with
PMS-LST-011; Delete session removing the summary, on the mocked SharePoint and the local server; the built page in Chromium and WebKit for Leadership of a
period, Leadership of one client and a Producer, with axe finding nothing.

Only reasoned about: the real site's answers to a summary's create, its 409 and the write over it, and to the reads by `Period` (QA 246, 247, 249); the cost
of Rebuild on a site with many old sessions (QA 248); a screen reader on the dashboard (QA 254); touch on the i buttons (QA 252).

**Known, not of this phase** (from Phase 4's record, not re-run in full here): `admin-content-sharepoint.spec.ts` "Content loads in 4 requests" counts 3;
`schema-upgrade.spec.ts` and `schema-version.spec.ts` carry versions 2, 4 and 5 in their expectations; `admin-today.spec.ts` "slugs" is the known flake.

## The final round must run

`npm run test:migration` (the whole browser suite: Firefox does not start on this machine, docs/TESTING.md), `npm run test:a11y`, `npm run test:devices`,
`npm run look:exports`, and the manual list: QA-TESTING.md items 246 to 254, item 246 first (the upgrade). Then push `pms-21-5` only after they pass.

## For Phase 6

- The wording review of the dashboard (its tile names, the headline, the i buttons) with the manager; decision B's default (`HIDE_NAMES_BY_DEFAULT`).
- The Hide names switch in every other Results surface and export (the dashboard has it; the Sessions view and the exports do not yet).
- Empty, loading and error states: a Leadership user with no scope (the dashboard says "No session in ... has a summary yet"), a summary that failed to
  write (Today says so; Rebuild mends it), a disabled user mid-session.
- A PDF of the dashboard, if the manager wants one (open item 18); Region as a filter.
