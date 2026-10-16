# Phase 10j: fewer waits on the participant page

Date: 15 Oct 2026. Branch `pms-redesign`, on top of `c7848e5` (Phase 10i). Nothing was pushed; `main` and the tag `legacy-final` (`2ad1520`) are untouched.

**In plain words.** With the package `pms-da9fc8d` on the real site (PCOE, its lists of version 3) VJR said the participant page "responds slowly (showing loading)". The live
client has only a handful of activities, so the data is small. What cost was the number of requests the page waited for **one after another** (a *round*: requests sent side by
side are one) and the screens that waited on them. This phase made the page wait for fewer rounds: Welcome after 2 (4 before), "Click here to begin" after 2 once the page has
fetched ahead (7 or 8 before), the Activities hub drawn at once (1 before), an activity opened at once (1 before). Nothing about what is saved, or how, changed. A new package,
`pms-0a1c701`, has a runbook whose note for the PCOE site measures the page before and after, in Chrome. **These pages have not run on the real site yet**, and nothing has run on
an iPad.

## 1. The commits

| Part | Commit | Message |
|---|---|---|
| A | `88a41e4` | Phase 10j: a test that counts the participant page's waits |
| B | `0b1522d` | Phase 10j: the field check reads only what it checks |
| C | `f1ef922` | Phase 10j: beginning a visit waits for two rounds |
| D | `3dbe005` | Phase 10j: the first screen waits for two rounds |
| E | `4d77be0` | Phase 10j: the hub and activities open from what the page holds |
| F | `a02016b` | Phase 10j: package and runbook |
| fixes | `0a1c701` | Phase 10j: fixes from the final gates |
| G | (this commit) | Phase 10j: record |

`git status` after G: nothing tracked is changed. The untracked brand, Unity and `.claude/` files, and `.local/`, are where they were, never added (every commit was staged by name or
with `git add -u`). Commit A's message was amended once, before anything was built on it, so as not to attribute to VJR the answer to a question asked in this session
(`b9be6ac` became `88a41e4`; the tree is the same). No other commit was changed. Gate logs are in `test-results/phase-10j/` (git-ignored).

**Two questions were asked during the phase, and answered:**

1. *Commit A asserts targets that fail until later parts.* Answer: **targets as todo**. Each target not yet met was a node:test `todo` that printed its measured rounds; the part that
   met it turned it into a hard assertion in the same commit; no todo is left (`npm test`: 1,179 pass, 0 todo). No commit is red in `npm test`.
2. *Checks sent side by side also send a read the old order skipped when the first check refused.* Answer: **list them under kinds 5 and 2**, each named here, on three
   conditions, all held: (a) error precedence is unchanged: when AppSettings refuses, the person sees exactly the error they saw before (a test of every refusal path, which also
   passes on `c7848e5`'s data layer); (b) the boot's early read of the session's visits is used only when the session turns out live and for staff, otherwise dropped, never offered
   on Welcome, never kept; (c) if that read fails the first screen still comes up, as before.

## 2. What was reported, and what was found

Reported (15 Oct 2026, PCOE, `pms-da9fc8d`): the participant page "responds slowly (showing loading)". Cowork's reading of `c7848e5` (data layer only, on the mock) was
confirmed by part A's test, which measured exactly its rounds (section 3). The findings, each now changed:

1. **"Click here to begin"** read AppSettings, then the session; then the participants list's type and whole `/fields`, then the write token, then the visit; and for the session's
   first device the session again, the sessions list's type and `/fields`, then the write that marks it in progress. The press waited for all of it.
2. **The column check read `/fields` with no `$select`**: a real list answers that with every field, hidden ones too, each with all its properties and its SchemaXml.
3. **Boot, staff path**: four rounds, the last two being the earlier-visit lookup (which only needs AppSettings) and the first activity's content (which Welcome never shows).
4. **The hub read its activities on every arrival**, with its loading line in place of the screen.
5. **Each activity but the first read its questions and options when it was opened.**

## 3. The rounds, before and after, for every moment

Measured by `scripts/test-participant-waits.js` on the mocked SharePoint (the settings file aside). In brackets: the requests, and what the moment leaves going without waiting for it.

| Moment | Before (`c7848e5`) | After (`0a1c701`) | Target |
|---|---|---|---|
| Page open, staff link, up to Welcome | 4 (8) | **2** (6) | 2 |
| Page open, staff link, someone with an earlier visit today | 4 (7) | **3** (7) | 3 (its answers) |
| Page open by a first QR scan, the session's first device | 4 (9) | 4 (9) | no more than before |
| Page open by a first QR scan, a later device | 4 (8) | 4 (8) | no more than before |
| "Click here to begin", first device, after the fetch-ahead | 7 (9) | **2** (3 + 1 after) | 2 |
| "Click here to begin", later device, after the fetch-ahead | 4 (5) | **2** (3) | 2 |
| "Click here to begin", first device, pressed at once | 8 (10) | **4** (6 + 3 after) | 4 |
| "Click here to begin", later device, pressed at once | 5 (6) | **4** (6) | 4 |
| The hub, arriving (any arrival but one within 5 s of boot) | 1 (1) | **0** (0 + 1 after) | 0 before it is drawn |
| Opening an activity (before: any but the one boot fetched) | 1 (2) | **0** (0) | 0 |
| Next | 0 (0 + 1 after) | 0 (0 + 1 after) | 0 |
| Submit, the earlier answers saved | 1 (1) | 1 (1) | 1 |
| Submit, the visit's first save | 2 (2) | 1 (1) | (not a target) |

"Before" (`c7848e5`) on the first device, "after the fetch-ahead" means after the visit log (the only thing the page did after its first screen then). The count is the same on any
machine (a test measures one moment three times, and holds the gate itself to one round for two reads side by side and two for two one after the other).

## 4. The requests of a whole visit, before and after

| Visit | Before | After |
|---|---:|---:|
| Staff link: open, begin, Kroger's two activities, finish; the session's first device (node, `test-participant-waits.js`) | 33 | **30** |
| The same, a later device | 29 | **27** |
| The same on a site that cannot batch (`"batch": false`; nothing of this visit was batched before), first device / later | 33 / 29 | **34 / 31** |
| A guest by QR code: scan, four activities, the finale (browser, `sharepoint.spec.ts` "a whole visit", Chromium; no poll fell in it either time) | 31 | **25** |
| The staff link up to Welcome (browser, `sharepoint.spec.ts` "a first visit", Chromium) | 8 | **6** |

**On a site that cannot batch a whole visit costs a few more requests** (each arrival on the hub reads three lists there, where the old hub read one and each activity read two when it
was opened): a finding, left (the brief asked that the total not grow). Two steps keep it down: the hub reads no content once every activity is done, and the fetch-ahead fetches
only what the page will use (a later device does not fetch the sessions list's check; the answers list's type alone, never its columns, since the first save uses only its type).
PCOE batches (its self-test passed the batch step on 15 Oct 2026).

## 5. Part by part

**A, the test.** Every request is held by a stand-in for `fetch`; once the code has asked for everything it can (the queue has not grown for eight turns of the event loop), the
waiting ones are let go together: a wave. Each moment runs what the page runs at that moment, through the data layer (a module of its own per "page") and the page's plain modules
(`lib/boot.js`, `lib/answer-store.js`, `lib/activity-content.js`); where the page's code is a Svelte file, the moment says which calls it stands for, and a source check holds the
Svelte file to them (App.svelte's after-first-screen work, Welcome's `waitForSession: false`, the hub drawing before it reads, the loading lines).

**B, the column check.** `spMetadata` reads `/fields?$select=InternalName,TypeAsString,Indexed,EnforceUniqueValues,RichText,AppendOnly,Required,ReadOnlyField`; a source check holds
the properties it reads to that list; its four refusals keep their words (tested). The mock answers a read of a list's columns with the properties named, or, with no `$select`, every
property and a SchemaXml on each field (PMSParticipants on the mock: 2,690 B named, 15,902 B not; a real list has many more fields). **What reads `/fields` without going through
`spMetadata`, left alone:** `dataService.checkSharePointSchema` (the admin's Today, its readiness check, in one `$batch`; Setup's Check Lists, with `schemaSpecs`), Setup's plan
(`lib/provision.js`, each existing list's columns) and Setup's self-test probe "columns this site will not return by name" (`lib/setup-checks.js`, `fieldsOf`). (`checkSharePointLists`
goes through `spMetadata`, so it names the eight.)

**C, beginning a visit.** `beginVisit` reads AppSettings and the session side by side (`Promise.allSettled`, then the checks in their old order); the session is read as an item with
its version (`spFind`, or `getItemWithVersion` locally: the same request as before) and moved to in progress with that version (`spMerge` with If-Match, or the local PATCH with
If-Match); a 412 says nothing, any other failure is logged as before. `waitForSession: false` (Welcome) does not wait for that write; the default waits, so the requests of a test's
set-up stay in order. `dataService.prepareWrites` (new export, 104) fetches the write token, the item types and the column checks in the background, sharing the very promises the
writes use (`spDigest`, `spMetadata`; a type read it started is waited for by a write: `spEntityTypeAhead`); a failed one is forgotten. `lib/boot.js` `writesAhead` says what:
**the participants list (type and columns) where a visit can begin, the sessions list (type and columns) only where that visit would be the session's first, and the answers list's
type alone for a visit with no answer item** (a departure from the brief's words "the item type and field check of PMSParticipants, PMSParticipantAnswers and PMSClientSessions",
following its decision "each item type and field check that the page will use": the first save uses only the answers list's type, and a later device never writes the session; the
literal list would have cost every later device two more requests). Tests: the rounds; one read of the session; the write naming its version; two first devices at once (two visits,
one session in progress, no warning; on the mock and the local server); a press during the fetch-ahead sending nothing twice; a failed fetch-ahead forgotten; every refusal path's
code and words (the same test passes on `c7848e5`'s data layer).

**D, the first screen.** The staff path reads the session's visits in round 2, beside the client, the session and the activities, as side-by-side reads (round 2 was never a
`$batch` on this path); what it finds is used only for a live session of staff, otherwise dropped (tested: guests only, an ended session, an archived client), and a failed read lets
the first screen up (tested). `lib/activity-content.js` holds the questions and options of every enabled activity for the page's life, by question id, in memory only; the read is the
data layer's `getSectionQuestions` handed every id, 20 to an address (`READ_CHUNK`): **the longest address of that read, 45 questions on the PCOE address, is 1,304 characters**
(the longest read before this phase, 1,873, is the admin's `readNameSources`, unchanged). It replaces the boot's first-activity fetch and its five-minute window
(`FIRST_CONTENT_MS`). On the QR path the read goes beside the claim and is not waited for: still 4 rounds.

**E, the hub and the activities.** The hub is drawn at once from what the page holds and reads the activities and the enabled ones' content behind it, together, in one `readLists`
(one `$batch` where the site can batch); it redraws only if something changed; once every activity is done it reads the activities alone. A read that fails leaves what is held on the
screen; the loading line and Try again are for a hub that holds nothing. An activity opens from what is held, waits for a read on its way, and reads what is not held as before. A
wait that remains shows its loading line only after 300 ms. Tests: the hub's read in one request (three, in one round, where the site cannot batch); an edit in Content reaching the
next activity opened after the hub, and not the one open; an activity switched off or removed dropping out; a failed read keeping what is held; the first-try and resume tests
unchanged. Specs changed on purpose: `review-9a.spec.ts` ("the hub could not be loaded": now with nothing held, and a new test that a failed read behind the hub leaves the activities
there), `settings-file.spec.ts:250` (it waited only for the visit log; see section 12). **Fixed after the final gates on F** (`0a1c701`): drawing what is held reads
nothing unless this visit's answers were never read on this page (a staff member's earlier visit that Welcome found itself, when its answers' read had failed there); if that
read failed, the hub's read behind it never started and the hub stayed on "Loading activities..." with no Try again. The read behind now runs whatever the drawing did
(`sharepoint.spec.ts` "the hub still reads, and comes up, when drawing what it holds needs a read of the answers that fails", red against the unfixed hub, green in three engines).

**F, the package and its runbook.** See sections 9 and 10 (`pms-a02016b` was made from F, and `pms-0a1c701`, which replaces it, from the fix commit). RUNBOOK.md's note for the PCOE site: the timing check with the pages there now (the "before"); the three pages replaced,
`pms-config.txt` kept; Setup as it is (the lists stay at version 3); the timing check again (the "after"); then the 10i note's remaining steps (a named guest and a code if the guest
list is empty, the self-test, Results, an iPad by QR whose second activity opens at once). The timing check is in a block with no language label, exactly as given (a test holds it).

## 6. The request baselines

Every changed entry is one of the five kinds the brief allowed; a script compared every baseline at `c7848e5` with today's and found **no entry of any other kind** (the appendix lists
them all). Each file says so in its header ("Amended in Phase 10j, part B/C/D"). Each amendment was followed by a fresh recording equal to the amended file exactly:

- **Kind 1** (`/fields` reads gain the `$select`), part B: `scripts/schema-baseline/fields-baselines.js`: every node suite run on the last commit's tree and on today's, request by
  request: 26,035 requests the same in number and order but for 1,188 reads of a list's columns that name the eight properties now (`--order`); each `N x .../fields` split by that
  count; a fresh recording of every suite equal (`--check`). 107 entries in 12 files. The browsers' start-up reads no list's columns at boot.
- **Kind 5** (the second read of the session gone), part C: `scripts/schema-baseline/begin-baselines.js`, test by test (requests side by side may leave in either order, and a
  baseline has never held the order): 75 fewer reads of a session by its AppId in 65 tests; **and, as asked, in the 3 tests where AppSettings refuses the press (`session-not-active`)
  one more read of the session**, sent beside AppSettings and dropped: `test-sharepoint` "configured active session blocks stale visits, resumes and QR scans", `test-participant-storage`
  "SharePoint: it refuses with these codes and these words, and writes nothing", `test-named-reads` "a create whose reply leaves a column out ... still resolves to the record as it was
  written". 13 entries in 5 files.
- **Kind 4** (the fetch-ahead after the first screen), part C, by hand: in each browser's start-up, the answers list's type (3 starts end on Welcome) and, on the first staff visit,
  the participants and sessions lists' type and columns. `request-baseline.spec.ts` now waits for them before it closes the page. 15 entries in 3 files.
- **Kind 3** (the questions and options reads cover every enabled activity), part D: `test-participant-storage` by `--amend --code` for the 21 tests changed on purpose (they hand
  the boot the page's holder, as the page does; two renamed): each read of Kroger's History's questions (65 x) and options (65 x) and of Guess the Brand's (10 x each) became a
  read of both activities' (55 x each: a held activity opens with no read); the browsers' start-up by hand (each read of Kroger's History, 4 x, became a read of both). 18 entries.
- **Kind 2** (the tracks read moved into the boot's round 2): no entry changed but one, as asked: in `test-participant-storage` "an archived client is not shown", the session's
  visits are now read (1 x) before the page knows the client is archived, and dropped. (The read itself was already in every test that reached it; only its round moved.)

## 7. The gates, before and after

"Before" is the untouched `c7848e5`, in a fresh worktree; "after" is `0a1c701` (the last commit with code or scripts; G adds documents and the recorded end sizes), in the same worktree.

| Gate | Before (`c7848e5`) | After (`0a1c701`) |
|---|---|---|
| `npm run check:svelte` | 411 files, 0 errors, 0 warnings | 412 files, 0 errors, 0 warnings |
| `npm test` | 1,129 pass, 0 fail | 1,179 pass, 0 fail, 0 todo (+50: `test-participant-waits` 49, the `PHASE_10J` check) |
| `npm run test:baseline` | 37 pass | 37 pass |
| `npm run test:bundle` | 31 pass | 32 pass |
| `npm run test:migration` | 1,146 tests: 1,120 passed, 26 skipped, 0 failed (37.2 min) | 1,152 tests: 1,126 passed, 26 skipped, 0 failed (36.4 min; Chromium 428, WebKit 331, Firefox 367) |
| `npm run test:report:mutations` | 34 of 34 caught | 34 of 34 caught (unchanged) |
| `npm run oracle -- --seeds 500` | 0 differences (5,620 participants, 50 on the local server, 4 zones) | 0 differences (the same 5,620: unchanged) |
| `npm run test:rehearsal` | 12 of 12 (`pms-da9fc8d`, Phase 10i) | 15 of 15 (`pms-0a1c701`; and 15 of 15 with `pms-a02016b`) |

The whole browser suite also ran on part C (`f1ef922`): 1,117 passed, 26 skipped, **3 failed**: `settings-file.spec.ts:250` in the three engines (section 12), fixed in E. And on F
(`a02016b`), with every node gate there green as above (`npm test` 1,179, `test:baseline` 37, `test:bundle` 32, mutations 34 of 34, oracle 0): 1,119 passed, 26 skipped, **1 failed**:
`clients.spec.ts:120` in Chromium, which pinned the local boot's requests as the first activity's questions and options too (part D reads them once the first screen is up), fixed in
`0a1c701`.

## 8. Page sizes (gzip)

| Page | Before | After | Change |
|---|---:|---:|---|
| participant (`index.html`) | 155,492 | 156,699 | +1,207 B (allowance 2,000 B) |
| admin (`admin.html`) | 605,199 | 606,131 | +932 B |
| Setup (`setup.html`) | 792,336 | 792,620 | +284 B |

In a fresh checkout (the package, built the same way). In this checkout, whose three HTML shells are CRLF, the participant page went from 155,503 to 156,710 B (+1,207) and the admin
page from 605,208 to 606,141 B (+933): `PHASE_10J` in `scripts/bundle-budget.js` records those, and the next phase starts from them. Phase 10c-2a's, 10c-2b's, 10c-3's and 10i's
checks became recorded-numbers ones (this phase's allowance goes past the figures they compared the build with). The admin page carries the participant's pager for its previews, so
it carries the content holder too.

## 9. The package

`npm run package:release` on `0a1c701`: `build-svelte/package/pms-0a1c701/` and `pms-0a1c701.zip` (git-ignored, not committed). (`pms-a02016b`, made from F before the fixes,
passed the same proofs and the same rehearsal; `pms-0a1c701` replaces it.) `pms-config.txt` is exactly
`{"configVersion": 1, "listPrefix": "", "label": "PMS"}`, byte for byte the file of Phases 10g to 10i (the same SHA-256). Every proof passed (no page holds a site address, a folder
name, a PIN hash, the demo PIN, `p_cec_` or `CreativeExpCOE`; no `.json` file); `shasum -a 256 -c` passed in the folder (7 OK) and in a fresh unzip (7 OK), which holds exactly the
folder's 8 files.

| File | Bytes | gzip -9 | SHA-256 |
|---|---:|---:|---|
| index.html | 372,754 | 156,699 | `707beef98e236cc17a5299b0874325ca9a54d5f051284ff2a6889b2bd9d2f19c` |
| admin.html | 1,669,838 | 606,131 | `e37cda0de88a0b347bfbc1e7389c6b3ed19cc28448a0deb44d3bf4bacc13df92` |
| setup.html | 1,172,119 | 792,620 | `80dd1f898aabe57b51cd90d26ff2995f4731be03de734337b574dced49d0fd0f` |
| pms-config.txt | 54 | | `04426124f56abad3973d69fb4a8608e673d86745419bf1cc41c5a70441cc607f` |
| THIRD-PARTY-NOTICES.txt | 43,737 | | `ef3e34fe640c11a126469c0a8e08af7d604c3b34a1a04a6e1e045af7391b528a` |
| RELEASE-NOTES.md | 13,865 | | `e3546d16fd7c06bca1841f3e956fb153c1fb5570c98a35f96fcea6a181a32a71` |
| RUNBOOK.md | 24,295 | | `d0029d0b594ccecb2c85702be334f93a77f8656d26847dff77f51a909363daf4` |
| **pms-0a1c701.zip** | 1,578,240 | | **`d0b7885fc37fee8d50d3159e7e87c523355d1f4debffc901067f3d85fddfd261`** |

## 10. The rehearsal

`PMS_PACKAGE=build-svelte/package/pms-0a1c701 npm run test:rehearsal`: **15 of 15 passed** in 1.8 minutes (`fix-rehearsal.log`; and 15 of 15 with `pms-a02016b`, `F-rehearsal.log`), on the mock in its PCOE modes (`strict: false`;
`DisplayName` refused by name; a duplicate refused with 500):

| Run | Chromium | WebKit | Firefox |
|---|---|---|---|
| 1. An empty site: steps 3 to 15 | pass | pass | pass |
| 2. A hand-built site with a misnamed column | pass | pass | pass |
| 3. A site that already has its lists of this version (the 10h note's case) | pass | pass | pass |
| 4. A site of version 2 (the 10i note's case: the plan, Create, raised to 3, a guest, the self-test, Results, an iPad by QR) | pass | pass | pass |
| 5. **The note for the PCOE site of version 3** (new): the pages replaced, Setup writing nothing, a visit then **the timing check run in the page** (it printed its table and a summary line naming a read of a list's columns), a guest and a code, the self-test (the old `DisplayName` columns named), Results, an iPad by QR whose second activity opens with no read of its own questions | pass | pass | pass |

In WebKit the self-test's `$batch` step fails, as it always has there (Playwright's WebKit drops the boundary of a fulfilled `$batch` reply); every other step passes there.

## 11. What only the real site can show

- **The time of one request on PCOE**, which decides what a round costs: the timing check's median, before (`pms-da9fc8d`) and after (QA-TESTING.md item 146).
- **The size and time of a read of a list's columns there** (item 147): the summary line's "fields reads:", before (no `$select`) and after (eight properties).
- **Whether any request comes back 429 or 503** (item 148): the table's `status` column.
- That an activity opens at once on an iPad, and an edit made in Content reaches a participant at their next activity after the hub (item 149).
- Still open from before: items 138, 139, 142 to 145, the participant accounts' permissions, an iPad, the leader report on the site.

## 12. Found, and left

- **On a site that cannot batch a whole visit costs a few more requests** (34 and 31 where there were 33 and 29; section 4). PCOE batches.
- **Reads sent before the check they waited for** (as asked): a press that AppSettings refuses also reads the session; a boot of the plain link reads the session's visits before it
  knows the session is live and for staff (one more read on a page opened on a session that turns out ended, archived, or for guests).
- **Found by review after F, fixed in `0a1c701`:** the hub stayed on its loading line, with no Try again, when drawing what it holds needed a read of the answers that failed
  (section 5, E). And `clients.spec.ts:120` failed in the full run on F (section 7), fixed there too.
- **`settings-file.spec.ts:250` failed in the full browser run on part C**, in the three engines: it listed the lists the participant page had touched once the visit log was
  written, and part C's fetch-ahead (the answers list's type) came after it. Fixed in E (it waits for the fetch-ahead and the content read, and expects the answers list); part C's
  and D's commits keep that red spec in their history.
- **`participant.spec.ts:91`** ("activity changes and same-route restart reload what was saved") failed once in Chromium when run with seven other spec files, and then passed 20 of 20
  alone on E and on C, and in a second run of the same group: a timing flake of a test whose look happens on a 3 s timer against a 5 s wait. Not changed.
- The `readNameSources` read of 20 sessions is still 1,873 characters at the longest (an open item since Phase 10c-2a).

## Appendix: every request-baseline entry amended, by kind

Kinds: 1 the column check's `$select`; 2 the tracks read in the boot's round 2; 3 the questions and options of every enabled activity; 4 the fetch-ahead after the first screen; 5 the
second read of the session gone (and the session read beside AppSettings when AppSettings refuses). "-" is an entry that did not exist.

### Kind 1: 107 reads of a list's columns split (214 lines of the files) in 12 files

| Baseline | List | Before (`/fields`) | After, plain | After, named |
|---|---|---:|---:|---:|
| test-admin-content | PMSActivities | 24 | 0 | 24 |
| test-admin-content | PMSActivityQuestions | 24 | 0 | 24 |
| test-admin-content | PMSAnswerOptions | 26 | 0 | 26 |
| test-admin-content | PMSAppSettings | 8 | 0 | 8 |
| test-admin-content | PMSClientSessions | 10 | 0 | 10 |
| test-admin-content | PMSClients | 17 | 0 | 17 |
| test-admin-content | PMSGuestList | 6 | 0 | 6 |
| test-admin-content | PMSGuestQRCodes | 6 | 0 | 6 |
| test-admin-today | PMSActivities | 23 | 7 | 16 |
| test-admin-today | PMSActivityQuestions | 23 | 7 | 16 |
| test-admin-today | PMSAnswerOptions | 23 | 7 | 16 |
| test-admin-today | PMSAppSettings | 20 | 7 | 13 |
| test-admin-today | PMSClientSessions | 19 | 7 | 12 |
| test-admin-today | PMSClients | 28 | 7 | 21 |
| test-admin-today | PMSGuestQRCodes | 12 | 7 | 5 |
| test-admin-today | PMSParticipants | 11 | 7 | 4 |
| test-leader-report-pdf | PMSActivities | 3 | 0 | 3 |
| test-leader-report-pdf | PMSActivityQuestions | 3 | 0 | 3 |
| test-leader-report-pdf | PMSAnswerOptions | 3 | 0 | 3 |
| test-leader-report-pdf | PMSAppSettings | 3 | 0 | 3 |
| test-leader-report-pdf | PMSClientSessions | 3 | 0 | 3 |
| test-leader-report-pdf | PMSClients | 3 | 0 | 3 |
| test-leader-report-pdf | PMSGuestList | 3 | 0 | 3 |
| test-leader-report-pdf | PMSGuestQRCodes | 3 | 0 | 3 |
| test-leader-report-pdf | PMSParticipants | 3 | 0 | 3 |
| test-leader-report-pdf | PMSVisitLog | 3 | 0 | 3 |
| test-live-display | PMSActivities | 2 | 0 | 2 |
| test-live-display | PMSActivityQuestions | 2 | 0 | 2 |
| test-live-display | PMSAnswerOptions | 2 | 0 | 2 |
| test-live-display | PMSAppSettings | 2 | 0 | 2 |
| test-live-display | PMSClientSessions | 2 | 0 | 2 |
| test-live-display | PMSClients | 2 | 0 | 2 |
| test-live-display | PMSParticipants | 2 | 0 | 2 |
| test-live-display | PMSActivities | 23 | 0 | 23 |
| test-live-display | PMSActivityQuestions | 23 | 0 | 23 |
| test-live-display | PMSAnswerOptions | 22 | 0 | 22 |
| test-live-display | PMSAppSettings | 22 | 0 | 22 |
| test-live-display | PMSClientSessions | 22 | 0 | 22 |
| test-live-display | PMSClients | 22 | 0 | 22 |
| test-live-display | PMSParticipants | 18 | 0 | 18 |
| test-named-reads | PMSActivities | 1 | 0 | 1 |
| test-named-reads | PMSActivityQuestions | 1 | 0 | 1 |
| test-named-reads | PMSAnswerOptions | 1 | 0 | 1 |
| test-named-reads | PMSClients | 1 | 0 | 1 |
| test-named-reads | PMSActivities | 15 | 1 | 14 |
| test-named-reads | PMSActivityQuestions | 15 | 1 | 14 |
| test-named-reads | PMSAnswerOptions | 15 | 1 | 14 |
| test-named-reads | PMSAppSettings | 5 | 1 | 4 |
| test-named-reads | PMSClientSessions | 6 | 1 | 5 |
| test-named-reads | PMSClients | 15 | 1 | 14 |
| test-named-reads | PMSGuestList | 2 | 1 | 1 |
| test-named-reads | PMSGuestQRCodes | 2 | 1 | 1 |
| test-named-reads | PMSParticipants | 3 | 1 | 2 |
| test-participant-names | PMSActivities | 3 | 0 | 3 |
| test-participant-names | PMSActivityQuestions | 3 | 0 | 3 |
| test-participant-names | PMSAnswerOptions | 3 | 0 | 3 |
| test-participant-names | PMSAppSettings | 3 | 0 | 3 |
| test-participant-names | PMSClientSessions | 3 | 0 | 3 |
| test-participant-names | PMSClients | 3 | 0 | 3 |
| test-participant-names | PMSGuestList | 3 | 0 | 3 |
| test-participant-names | PMSGuestQRCodes | 3 | 0 | 3 |
| test-participant-names | PMSParticipants | 3 | 0 | 3 |
| test-participant-names | PMSVisitLog | 3 | 0 | 3 |
| test-participant-storage | PMSActivities | 82 | 6 | 76 |
| test-participant-storage | PMSActivityQuestions | 81 | 6 | 75 |
| test-participant-storage | PMSAnswerOptions | 80 | 6 | 74 |
| test-participant-storage | PMSAppSettings | 81 | 6 | 75 |
| test-participant-storage | PMSClientSessions | 85 | 6 | 79 |
| test-participant-storage | PMSClients | 82 | 6 | 76 |
| test-participant-storage | PMSGuestList | 28 | 6 | 22 |
| test-participant-storage | PMSGuestQRCodes | 30 | 6 | 24 |
| test-participant-storage | PMSParticipants | 49 | 6 | 43 |
| test-sample-pictures | PMSActivities | 5 | 0 | 5 |
| test-sample-pictures | PMSActivityQuestions | 5 | 0 | 5 |
| test-sample-pictures | PMSAnswerOptions | 5 | 0 | 5 |
| test-sample-pictures | PMSClients | 5 | 0 | 5 |
| test-seeds | PMSClients | 6 | 0 | 6 |
| test-seeds | PMSAnswerOptions | 6 | 0 | 6 |
| test-seeds | PMSActivityQuestions | 6 | 0 | 6 |
| test-seeds | PMSActivities | 6 | 0 | 6 |
| test-setup-admins | PMSActivities | 2 | 0 | 2 |
| test-setup-admins | PMSActivityQuestions | 2 | 0 | 2 |
| test-setup-admins | PMSAdminUsers | 4 | 0 | 4 |
| test-setup-admins | PMSAnswerOptions | 2 | 0 | 2 |
| test-setup-admins | PMSAppSettings | 2 | 0 | 2 |
| test-setup-admins | PMSClientSessions | 2 | 0 | 2 |
| test-setup-admins | PMSClients | 2 | 0 | 2 |
| test-setup-admins | PMSGuestList | 2 | 0 | 2 |
| test-setup-admins | PMSGuestQRCodes | 2 | 0 | 2 |
| test-setup-admins | PMSParticipantAnswers | 2 | 0 | 2 |
| test-setup-admins | PMSParticipants | 2 | 0 | 2 |
| test-setup-admins | PMSVisitLog | 2 | 0 | 2 |
| test-sharepoint | PMSActivities | 3 | 0 | 3 |
| test-sharepoint | PMSActivityQuestions | 3 | 0 | 3 |
| test-sharepoint | PMSAdminUsers | 3 | 0 | 3 |
| test-sharepoint | PMSAnswerOptions | 3 | 0 | 3 |
| test-sharepoint | PMSAppSettings | 4 | 0 | 4 |
| test-sharepoint | PMSClientSessions | 4 | 0 | 4 |
| test-sharepoint | PMSClients | 7 | 0 | 7 |
| test-sharepoint | PMSGuestList | 5 | 0 | 5 |
| test-sharepoint | PMSGuestQRCodes | 6 | 0 | 6 |
| test-sharepoint | PMSParticipantAnswers | 3 | 0 | 3 |
| test-sharepoint | PMSParticipants | 3 | 0 | 3 |
| test-sharepoint | PMSVisitLog | 4 | 0 | 4 |
| test-text-limits | PMSActivities | 1 | 0 | 1 |
| test-text-limits | PMSActivityQuestions | 1 | 0 | 1 |
| test-text-limits | PMSAnswerOptions | 1 | 0 | 1 |

### Kind 2: 1 entry in 1 file

| Baseline | Before | After | Entry |
|---|---:|---:|---|
| test-participant-storage | - | 1 | `GET PMSParticipants/items?$top=200&$filter=(SessionId eq 'dominos-2026-10-11')` |

### Kind 3: 18 entries in 4 files

| Baseline | Before | After | Entry |
|---|---:|---:|---|
| browser-participant-start.chromium | 4 | - | `GET PMSAnswerOptions/items, filter on q-trivia-1, q-trivia-2, q-trivia-3, q-trivia-4, q-trivia-5` |
| browser-participant-start.chromium | 4 | - | `GET PMSActivityQuestions/items, filter on q-trivia-1, q-trivia-2, q-trivia-3, q-trivia-4, q-trivia-5` |
| browser-participant-start.chromium | - | 4 | `GET PMSActivityQuestions/items, filter on q-trivia-1, q-trivia-2, q-trivia-3, q-trivia-4, q-trivia-5, q-brand-1` |
| browser-participant-start.chromium | - | 4 | `GET PMSAnswerOptions/items, filter on q-trivia-1, q-trivia-2, q-trivia-3, q-trivia-4, q-trivia-5, q-brand-1` |
| browser-participant-start.firefox | 4 | - | `GET PMSAnswerOptions/items, filter on q-trivia-1, q-trivia-2, q-trivia-3, q-trivia-4, q-trivia-5` |
| browser-participant-start.firefox | 4 | - | `GET PMSActivityQuestions/items, filter on q-trivia-1, q-trivia-2, q-trivia-3, q-trivia-4, q-trivia-5` |
| browser-participant-start.firefox | - | 4 | `GET PMSActivityQuestions/items, filter on q-trivia-1, q-trivia-2, q-trivia-3, q-trivia-4, q-trivia-5, q-brand-1` |
| browser-participant-start.firefox | - | 4 | `GET PMSAnswerOptions/items, filter on q-trivia-1, q-trivia-2, q-trivia-3, q-trivia-4, q-trivia-5, q-brand-1` |
| browser-participant-start.webkit | 4 | - | `GET PMSAnswerOptions/items, filter on q-trivia-1, q-trivia-2, q-trivia-3, q-trivia-4, q-trivia-5` |
| browser-participant-start.webkit | 4 | - | `GET PMSActivityQuestions/items, filter on q-trivia-1, q-trivia-2, q-trivia-3, q-trivia-4, q-trivia-5` |
| browser-participant-start.webkit | - | 4 | `GET PMSActivityQuestions/items, filter on q-trivia-1, q-trivia-2, q-trivia-3, q-trivia-4, q-trivia-5, q-brand-1` |
| browser-participant-start.webkit | - | 4 | `GET PMSAnswerOptions/items, filter on q-trivia-1, q-trivia-2, q-trivia-3, q-trivia-4, q-trivia-5, q-brand-1` |
| test-participant-storage | 10 | - | `GET PMSActivityQuestions/items, filter on q-brand-1` |
| test-participant-storage | 65 | - | `GET PMSActivityQuestions/items, filter on q-trivia-1, q-trivia-2, q-trivia-3, q-trivia-4, q-trivia-5` |
| test-participant-storage | 10 | - | `GET PMSAnswerOptions/items, filter on q-brand-1` |
| test-participant-storage | 65 | - | `GET PMSAnswerOptions/items, filter on q-trivia-1, q-trivia-2, q-trivia-3, q-trivia-4, q-trivia-5` |
| test-participant-storage | - | 55 | `GET PMSActivityQuestions/items, filter on q-trivia-1, q-trivia-2, q-trivia-3, q-trivia-4, q-trivia-5, q-brand-1` |
| test-participant-storage | - | 55 | `GET PMSAnswerOptions/items, filter on q-trivia-1, q-trivia-2, q-trivia-3, q-trivia-4, q-trivia-5, q-brand-1` |

### Kind 4: 15 entries in 3 files

| Baseline | Before | After | Entry |
|---|---:|---:|---|
| browser-participant-start.chromium | - | 1 | `GET PMSClientSessions/fields?$select=InternalName,...` |
| browser-participant-start.chromium | - | 1 | `GET PMSClientSessions?$select=ListItemEntityTypeFullName` |
| browser-participant-start.chromium | - | 3 | `GET PMSParticipantAnswers?$select=ListItemEntityTypeFullName` |
| browser-participant-start.chromium | - | 1 | `GET PMSParticipants/fields?$select=InternalName,...` |
| browser-participant-start.chromium | - | 1 | `GET PMSParticipants?$select=ListItemEntityTypeFullName` |
| browser-participant-start.firefox | - | 1 | `GET PMSClientSessions/fields?$select=InternalName,...` |
| browser-participant-start.firefox | - | 1 | `GET PMSClientSessions?$select=ListItemEntityTypeFullName` |
| browser-participant-start.firefox | - | 3 | `GET PMSParticipantAnswers?$select=ListItemEntityTypeFullName` |
| browser-participant-start.firefox | - | 1 | `GET PMSParticipants/fields?$select=InternalName,...` |
| browser-participant-start.firefox | - | 1 | `GET PMSParticipants?$select=ListItemEntityTypeFullName` |
| browser-participant-start.webkit | 2 | 3 | `GET PMSParticipants?$select=ListItemEntityTypeFullName` |
| browser-participant-start.webkit | - | 1 | `GET PMSClientSessions/fields?$select=InternalName,...` |
| browser-participant-start.webkit | - | 1 | `GET PMSClientSessions?$select=ListItemEntityTypeFullName` |
| browser-participant-start.webkit | - | 3 | `GET PMSParticipantAnswers?$select=ListItemEntityTypeFullName` |
| browser-participant-start.webkit | - | 1 | `GET PMSParticipants/fields?$select=InternalName,...` |

### Kind 5: 13 entries in 5 files

| Baseline | Before | After | Entry |
|---|---:|---:|---|
| test-admin-today | 16 | 13 | `GET PMSClientSessions/items?$filter=AppId eq 'dominos-2026-10-11'&$top=2` |
| test-admin-today | 9 | 6 | `GET PMSClientSessions/items?$filter=AppId eq 'kroger-2026-10-10'&$top=2` |
| test-admin-today | 41 | 37 | `GET PMSClientSessions/items?$filter=AppId eq 'kroger-2026-10-11'&$top=2` |
| test-live-display | 14 | 12 | `GET PMSClientSessions/items?$filter=AppId eq 'kroger-2026-10-11'&$top=2` |
| test-live-display | 117 | 99 | `GET PMSClientSessions/items?$filter=AppId eq 'kroger-2026-10-11'&$top=2` |
| test-named-reads | 15 | 13 | `GET PMSClientSessions/items?$filter=AppId eq 'kroger-2026-10-15'&$top=2` |
| test-named-reads | - | 1 | `GET PMSClientSessions/items?$filter=AppId eq 's-made'&$top=2` |
| test-participant-storage | 14 | 13 | `GET PMSClientSessions/items?$filter=AppId eq 'dominos-2026-10-11'&$top=2` |
| test-participant-storage | 319 | 279 | `GET PMSClientSessions/items?$filter=AppId eq 'kroger-2026-10-11'&$top=2` |
| test-participant-storage | 4 | 3 | `GET PMSClientSessions/items?$filter=AppId eq 'kroger-2026-12-01'&$top=2` |
| test-participant-storage | 4 | 3 | `GET PMSClientSessions/items?$filter=AppId eq 'kroger-2026-12-02'&$top=2` |
| test-participant-storage | 9 | 10 | `GET PMSClientSessions/items?$filter=AppId eq 'kroger-2026-12-03'&$top=2` |
| test-sharepoint | 8 | 9 | `GET PMSClientSessions/items?$filter=AppId eq 'session-a'&$top=2` |

### Kind OTHER (a finding): none

No entry of any baseline changed but in the five kinds above.
