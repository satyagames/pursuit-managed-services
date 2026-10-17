# Phase 10h: three fixes from the first real-site run

Date: 14 and 15 Oct 2026. Branch `pms-redesign`, on top of `5bc90fa` (Phase 10g). Nothing was pushed; `main` and the tag `legacy-final` (`2ad1520`) are untouched.

**In plain words.** On the evening of 14 Oct 2026 the package `pms-969bf16` ran steps 1 to 9 of its runbook on the real site (`https://internal.global.deloitteonline.com/sites/PCOE`,
folder `Shared Documents/PMS`, Chrome on Windows): Create made the 13 lists, Check Lists was all Ready, the site was marked ready, an admin was added, the samples were seeded with
their pictures, and `PMSAdminUsers` was locked. Three things were wrong, and this phase fixes them and nothing else:

1. **That site leaves `ClientId` out of an item read that does not name its columns.** Content and Today said Kroger and Domino's had no activities, although the four seeded
   activities were on the list with the right `ClientId`. **Every item read now names its columns** (`$select`), and the mock answers as that site did.
2. **That site refuses a duplicate with 500, not 400.** Setup's self-test said "Refused, but not as a duplicate", and every path that meets a record already there would have
   failed. **A duplicate refused with 500 is still a duplicate.**
3. **Setup's buttons could not be seen.** Setup never loaded the admin page's colours and type. **It does now.**

Setup also names the lists by their real titles, its self-test asks the site one more read-only question (which columns it leaves out of an unnamed read), and the new package is
`build-svelte/package/pms-e250a36/` with `pms-e250a36.zip` beside it (git-ignored). Its runbook begins with a note for the PCOE site: replace the three pages, keep `pms-config.txt`,
check Setup, run the self-test, look at Content, and carry on at step 12. **These pages have not run on the real site yet.**

## 1. The commits

| Part | Commit | Message |
|---|---|---|
| A | `e148e10` | Phase 10h: every item read names its columns |
| B | `9f088d0` | Phase 10h: a duplicate refused with 500 is still a duplicate |
| C | `f0d160e` | Phase 10h: Setup's buttons can be seen |
| D | `3e0e2ef` | Phase 10h: Setup names the real lists |
| E | `e250a36` | Phase 10h: package and runbook |
| F | (this commit) | Phase 10h: record |

`git status` after F: nothing tracked is changed. The untracked brand, Unity and `.claude/` files, and `.local/`, are where they were, never added (every commit was staged with
`git add -u` and new files by name). No commit was changed after it was made. Gate logs are in `test-results/phase-10h/` (git-ignored).

## 2. What the real site showed (14 Oct 2026, evening)

VJR's report, not something the tests saw.

- **`ClientId` left out.** `.../getbytitle('PMSActivities')/items?$select=Id,Title,AppId,ClientId,Enabled&$top=20` returned `sec-trivia` and `sec-guess-the-brand` with `c-kroger`
  and the two Domino's activities with `c-dominos`, all enabled. The data layer's read, `items?$top=200`, returned every column of the list (`AppId`, `SortOrder`, `Enabled`,
  `IndustryTags`, `QuestionIds`, `Description`, `Title` and SharePoint's own) **but `ClientId`**, whose `InternalName`, `StaticName` and `EntityPropertyName` are all `ClientId`,
  type `Text`. Why, and what else that site leaves out, is not known. This very probably explains the 13 Oct report from the old site (an activity "assigned on the popup, not
  shown on Kroger's activities, no error"): the write worked and the read lost the column.
- **A duplicate refused with 500.** Setup's self-test step "A second create with the same AppId is refused": "Refused, but not as a duplicate: SharePoint (500): The list item could
  not be added or updated because duplicate values were found in the following field(s) in the list: [AppId]."
- **Invisible buttons.** The primary buttons (Create, Add an admin, Seed sample clients, Import) were white words on no background, the others looked like plain text, the face was
  a serif. The deployer pressed them with the keyboard.
- **Seen once, cause unknown:** a plain `GET .../getbytitle('PMSActivities')/items?$top=200` from the admin page (most likely Content's 15-second look, which swallows its errors)
  answered 403, where the same address from the console answered 200 a moment before. Recorded in QA-TESTING.md to watch; nothing was changed for it.

## 3. Part A: every item read names its columns (`e148e10`)

### 3.1 Tests first

`scripts/test-named-reads.js` (new, in `npm test`, a recorded suite) was written and run red before the data layer changed (`test-results/phase-10h/A-red-2.log`: 16 of 18
failing; a stand-in constant for the probe's name let the file load). On the mock in the site's mode (`strict: false`), today's code failed exactly as the site did:

- the Content tab's read (`readLists([{ list: 'sections' }])` and `activitiesOfClient`) gave Kroger **no** activities (expected `sec-trivia`, `sec-guess-the-brand`);
- Today's readiness said "**Kroger has no activities.**" (a blocker);
- Go live with Kroger failed with "**The session kroger-2026-10-15 belongs to a different client.** Give Kroger its own slug." (the session as its create returned it, and as a read
  gave it back, had no `ClientId`: on the real site the first Go live would have failed like this);
- Results could not be reached for the same reason;
- on the strict mock, the walk failed at its first read; the source check found every unnamed address.

### 3.2 The change, in one place

`public/js/pms-schema.js` `selectOf(key)`: `$select=` with SharePoint's `Id`, `AppId`, and every column the schema maps for that list, once each, `Title` where it is mapped (the
activities' title). In `public/js/dataService.js`, `spItems(list, query)` is the one way an item read's address is made, and it ends with `&` and the list's `selectOf`.

| Item read | What sends it | Since Phase 10h |
|---|---|---|
| `spFind` (an item by AppId) | `getItem`, `getItemWithVersion`, `spMutate`, `noteTrackResumed`, and every reader built on them | through `spByAppId`, named |
| the list GET of `spSend` | `listItems`, `queryItems`, `getItems` (all `list*`, `query*` and id reads of the public API) | `spItems`, named |
| `spByAppId` | the QR scan (the code, the session, the client, the visitor, a track met as a duplicate), `readParticipantWatch`, `readLiveFeed`'s session | named |
| `spItemsAddress` | `readLists` (Today, Content, Clients, Guests, Results, the Live display, the leader report, Setup), the scan's activities and earlier tries, the watch's activities, the live feed's visits and activities | named |
| `probeSharePointRead(list, query)` | Setup's probes | the list's columns added when the query names none; Setup's probes name `$select=Id` and are sent as they were |
| `provision.js` `markReady`, both reads of the settings item | Setup's Mark the site as ready | `&` + `selectOf('appsettings')` |
| `PARTICIPANT_SELECT` reads | a participant's own answers, a session's answers, the live feed's answers, the self-test's batch | **unchanged**: they always named their columns (`Id,AppId,SessionId,ClientId,TrackId,ResponsesJson`) |

Reads of a list itself (`?$select=ListItemEntityTypeFullName`, `/fields`, the library's folder and files) are not item reads and are unchanged.

**A create's reply** (`spMade`, used by `spCreate` and the QR scan's `createTrack`): the item a create returns is SharePoint's serialisation of the item, the same as an unnamed
read's, so it is assumed to leave `ClientId` out too (not seen: Go live had not been pressed on the site). Any column the reply leaves out is taken from what was written; what
the reply says still wins. On the site's mode the mock leaves it out, and the tests above hold Go live's session and a scan's visit to their `clientId`.

### 3.3 The mock (`scripts/sharepoint-fake.js`)

- An item read **with** `$select` gets exactly the named columns (a column the row holds no value for is left out, as before), with `__metadata`, `Id` and `ID`. A `$select` naming
  a column the list does not have is refused with 400, "The field or property 'X' does not exist." (as SharePoint is believed to answer; not seen).
- An item read **without** `$select` leaves out `leavesOut` (default `TENANT_LEAVES_OUT`, `['ClientId']`, on every list that has it), and so does the item a create returns.
- **Strict** (the default): an item read without `$select` is refused (`UNNAMED_REFUSAL`) and noted in `UNNAMED`, so that a read that does not name its columns fails in every suite and
  browser spec that uses the mock; every recorded suite's last test, and this suite's, hold `UNNAMED` empty. The one unnamed read strict mode answers is `$top=1` and nothing else, the shape
  of Setup's probe. `{ strict: false }` is the site as it was seen.
- A `__next` link keeps the `$select` it was asked with (a test holds it).

### 3.4 Setup's new probe

`migration/src/lib/setup-checks.js`, beside the two of Phase 9b: "Probe (read-only): columns this site leaves out of a read that names no columns". For each list with an item, it reads
one item without `$select` and the same one with the list's `selectOf`, and lists every column the first left out (and says so if the two reads returned different items). Read-only,
and never a failure. `selfTestProbes(probe, titles)` adds it when given the lists' titles, which Setup's page does; the self-test is 10 steps there. On the mock it says, for example:
"Left out of a read that names no columns: PMSActivities: ClientId; PMSParticipantAnswers: ClientId. Read one item of 7 lists; empty, so not read again: ... The app names its
columns in every read (Phase 10h), so nothing depends on this answer."

### 3.5 How long the addresses are now

Measured as a browser sends them (spaces and quotes encoded) on the PCOE site's own address, with every id as long as it can be (`scripts/test-named-reads.js` prints it):

| Read | Length | Without its `$select` |
|---|---:|---:|
| PMSParticipants by 15 sessions (Clients: what uses a client), the list with the most columns | **1,510** | 1,346 |
| PMSAnswerOptions by 20 questions (an activity's content: Results, the exports, the report, boot) | 1,540 | 1,477 |
| PMSVisitLog by 20 sessions (Results: who is who, `readNameSources`; over 1,500 since Phase 10c-2a, an open item) | **1,872** | 1,752 |

The `$select` is the same for every read of a list and does not grow with the content: 164 characters at most (`&` and `selectOf('tracks')`). The project's own guard was "1,500
characters at 15 or 60 questions" (`scripts/test-live-display.js`); it now holds the part that can grow with the content to 1,500 as before and the whole address to 1,700 (60 questions:
1,552 to 1,556 characters). SharePoint publishes no limit for a REST query string; community reports put it near 2,048 characters, and the self-test's probe "how long a `$filter` this
site accepts" asks the real site (its answer on PCOE is in the table VJR is asked to send back). The longest address of all, 1,872, is the open item of Phase 10c-2a, not this phase's.

### 3.6 The request baselines: translated, never recorded again

Every entry that read items without naming their columns was given `&$select=` and its list's columns at the end of its query, and a mock's `__next` link of such a read the same,
encoded, before its `$fakeskip` (`scripts/schema-baseline/select-baselines.js`, `selectLine`, unit-tested in `test-named-reads.js`). Nothing else moved; every count is what it was. Each
file's header says so. **384 entries** of 1,102:

| Baseline | Entries translated |
|---|---:|
| test-sharepoint | 32 of 73 |
| test-participant-storage | 73 of 183 |
| test-admin-today | 41 of 81 |
| test-admin-content | 104 of 208 |
| test-brand-storage | 0 of 11 |
| test-live-display | 47 of 103 |
| test-participant-names | 17 of 59 |
| test-leader-report-pdf | 13 of 62 |
| test-seeds | 14 of 36 |
| test-review-9a | 3 of 4 |
| test-provision | 0 of 74 |
| test-site-ready | 2 of 81 |
| test-setup-admins | 2 of 29 |
| test-text-limits | 0 of 10 |
| test-sample-pictures | 4 of 25 |
| browser-participant-start.chromium | 10 of 20 |
| browser-participant-start.webkit | 12 of 23 |
| browser-participant-start.firefox | 10 of 20 |

Three examples (before, then after):

```
17 x GET /sites/cec/_api/web/lists/getbytitle('PMSActivities')/items?$top=200
17 x GET /sites/cec/_api/web/lists/getbytitle('PMSActivities')/items?$top=200&$select=Id,AppId,Title,SortOrder,Enabled,IndustryTags,QuestionIds,ClientId,Description

4 x GET /sites/CreativeExpCOE/_api/web/lists/getbytitle('PMSAppSettings')/items?$filter=AppId%20eq%20%27default%27&$top=2
4 x GET /sites/CreativeExpCOE/_api/web/lists/getbytitle('PMSAppSettings')/items?$filter=AppId%20eq%20%27default%27&$top=2&$select=Id,AppId,ActiveSessionId,ActiveClientId,ActivatedAt,SchemaVersion

2 x GET /sites/cec/_api/web/lists/getbytitle('PMSActivities')/items?%24top=200&%24fakeskip=200
2 x GET /sites/cec/_api/web/lists/getbytitle('PMSActivities')/items?%24top=200&%24select=Id%2CAppId%2CTitle%2CSortOrder%2CEnabled%2CIndustryTags%2CQuestionIds%2CClientId%2CDescription&%24fakeskip=200
```

The proofs, each before the translation was written in place (logs in `test-results/phase-10h/`):

- **`--check`**: a fresh recording of every node suite equals its translated baseline exactly (`A-select-check.log`: "every fresh recording equals its translated baseline").
- **`--order`**, the number and the order: every node suite run on the last commit's whole tree and on today's, request by request, each of the last commit's translated against
  today's (`A-select-order.log`): **24,656 requests, the same, in the same number and order**. The only entries set aside are those the baselines already mark as timing-dependent
  (`~`): in `test-participant-storage` one, the participant page's watch, sent 145 times on one side and 147 on the other in that run; two runs of the last commit alone sent it 142 and
  146 times.
- **The browsers**: `request-baseline.spec.ts` pointed at the translated files (`PMS_BASELINE_DIR`) passed in Chromium, WebKit and Firefox (`A-browser-baseline-proof.log`), and
  failed against the untranslated ones (`A-browser-baseline-untranslated.log`), so the comparison can fail.

The new suite `test-named-reads` was then recorded with `--write` (a suite that had no baseline; `RECORDED_LATER` says when). No other baseline changed in any later part.

### 3.7 One thing that changed on a broken site

A `$select` that names a column the list does not have is refused (by the mock, and, it is believed, by SharePoint). So on a site where a column was **deleted by hand after Setup
marked it ready**, a page that reads that list now stops with SharePoint's words, which name the column. Today, which used to load and show such a column as a blocker, now says "Could not
load Today. ... The field or property 'Slug' does not exist." for a list it reads as it loads; a column missing from a list it does not read (such as `PMSGuestQRCodes.UsedAt`) is still a
blocker naming it, and Setup's Check Lists (which reads the lists' columns, not their items) names every one. `admin-sharepoint.spec.ts` was changed to say both. This is the one test
whose expectation changed in this phase for a behaviour of the pages; **it is a decision for VJR** whether that is acceptable (the alternative is a mock that ignores a missing column,
which would hide what SharePoint is believed to do). QA-TESTING.md item 141.

### 3.8 Other tests that changed with it

Assertions only, never what is sent: four scanned an address for a column name that now also appears in its `$select` (`ImageUrl`, `SessionId`, `VisitorId`, `QrTokenId`) and now look
at the `$filter` alone, or name their own columns where they read the mock directly; the "short addresses" guard as in 3.5; Setup's self-test spec counts 10 steps (34 requests).

## 4. Part B: a duplicate refused with 500 is still a duplicate (`9f088d0`)

### 4.1 Tests first

`scripts/test-duplicates.js` (new, in `npm test`, not a recorded suite: no baseline file changed in this part) with the mock answering a duplicate as the site does (500 and its
words) was run red (`B-red.log`: 10 of 13 failing). The self-test step failed with **exactly** the site's words: "Refused, but not as a duplicate: SharePoint (500): ...". The Go live
test passed on today's code at first because both "admins" were one module and shared Go live's own de-duplication; it was changed to call the data layer from two pages, and then
failed for the right reason (`B-red-goLive.log`).

### 4.2 The rule, exactly as written (`spHttp`, `public/js/dataService.js`)

```js
const duplicate = [400, 409, 500].includes(response.status)
  && (/SPDuplicateValuesFoundException/.test(payload?.error?.code) || /duplicate|unique value/i.test(message ?? ''));
throw Object.assign(spError(duplicate ? 409 : response.status, `SharePoint (${response.status}): ${message ?? response.statusText}`),
  { sharePointStatus: response.status }, retryAfter === undefined ? {} : { retryAfter });
```

A refusal is a duplicate (409) when SharePoint's status is 400, 409 or 500 and its error code names `SPDuplicateValuesFoundException` or its words match `/duplicate|unique value/i`.
Any other refusal keeps its status (a 500 stays a 500; a 503 is never a duplicate, whatever it says). Retries are unchanged (a 500 was never retried and is not now). Every refusal
keeps what SharePoint said in `sharePointStatus`, and its message still begins "SharePoint (500):", so a Details line stays true. Tested: 500 with the words; 400 with the words; 500
with the code and words in German; 500 with an unrelated message (stays 500); 400 unrelated (stays 400); 409; 503 whose words say "duplicate" (stays 503).

### 4.3 Every caller of 409, checked

| Caller | What 409 means there | Held by |
|---|---|---|
| `spMutate` (a PATCH that finds or creates) | the item appeared meanwhile: read again and merge | existing suites |
| `updateAppSettings` | the settings item is there: update it | existing suites |
| `recordUserVisit` | the visit's row is there already | existing suites |
| `activateClient` (Go live) | another admin made the session a moment ago: read it | test-duplicates (two pages at once) |
| `recordParticipantVisit` | this tab's visit row is there already | test-duplicates (the same visit twice) |
| `saveParticipantResponses` | a create whose reply was lost: read, merge, overwrite | test-duplicates (one item, every answer) |
| `runParticipantSelfTest` | the second create was refused as it must be | test-duplicates, setup.spec (Pass) |
| `spScan.createTrack` (QR scan) | an earlier try made the track: read it by AppId | test-duplicates (a 503 after the write, then one track) |
| `localScan.createTrack` | the local server's own 409 | unchanged (the local server says 409 itself) |
| `beginVisit` | an earlier press made the visit | existing suites |
| `createOrOverwrite` (copying activities) | a failed run's record: write over it | existing suites |
| `copyActivities` (the activity record) | copied here a moment ago: skipped | existing suites |
| `lib/seed.js` | someone else created it a moment ago | test-duplicates (seeding twice at once) |
| `lib/setup-import.js` | already present | existing suites |
| `lib/admin-clients.js` `createClientRecord` | the slug is taken | test-duplicates |

With the mock answering 500 by default, every existing suite that met a duplicate ran through the new rule too; all pass. `isUnreachable` (status 500 and above) no longer sees a
duplicate as "unreachable", which would have retried a participant's save three times and then said it could not save.

### 4.4 The mock

A duplicate is answered with 500 and `DUPLICATE_WORDS` by default; `duplicateStatus: 400` gives the old answer; `duplicateCode: true` adds `DUPLICATE_CODE`,
`-2130575169, Microsoft.SharePoint.SPDuplicateValuesFoundException`, which is **assumed**: the site's own `error.code` was not captured (QA-TESTING.md item 142 asks for it from the
browser's Network panel). Request baselines: unchanged.

## 5. Part C: Setup's buttons can be seen (`f0d160e`)

`migration/src/setup-main.ts` imports `./styles/tokens.css`, `./styles/fonts-admin.css` and `./styles/admin-tokens.css`, in `admin-main.ts`'s order. Nothing else needed fixing: the
admin tokens map the older stylesheet's variables (`--ink`, `--bg`, `--line`, `--accent`...) to the admin page's values, so Setup now looks like the admin page.

**Tests first.** `scripts/migration-tests/setup-look.spec.ts` (new, Chromium, WebKit and Firefox) measures every visible button the way a person sees it (colours painted on a canvas and
read back): each must have an edge (a background of its own that is not the page's, or a border), and each that can be pressed words of 4.5:1 or better against what is really behind
them; on a ready site after Check Lists with Add an admin, Seed sample clients and Import switched on, and on a site whose plan has something to make (Create on). On the build before
the change it failed in all three engines (`C-red.log`), for exactly the deployer's reasons: "Create", "Add an admin", "Seed sample clients" and "Import Missing Records" were white on
white (1:1), and every other button had no edge. Afterwards it passes in all three.

**axe.** Setup was already in `a11y.spec.ts` with colour contrast on, and passed, because axe skips a button that is switched off (the primary ones are, as the page opens), and reports
words exactly the colour of their background (1:1) as "needs review", never as a violation (they may be hidden on purpose). Setup is now scanned again with its primary buttons on, and on
Setup a 1:1 "needs review" is a failure: both Setup scans failed on the old build (`C-red-axe.log`) and pass now with no "needs review" item.

**Sizes.** Setup grew by 43,469 B raw and 33,182 B gzip (the three Open Sans faces, about 31 kB, and the tokens), far under the 300 kB the brief allowed; the participant and admin
pages were byte for byte the same. **The rehearsal's pictures**: the package of this commit was rehearsed in Chromium, and the plan (Create), Admins and Sample clients were looked at:
blue buttons with white words, the others outlined (Part E photographs steps 5, 8, 9 and 10 in every rehearsal now).

## 6. Part D: Setup names the real lists (`3e0e2ef`)

Searched: every Svelte file, plain module and the data layer a page is built from, for the old titles (Clients, Sessions, Sections, Questions, Options, Tracks, QRTokens, AppSettings,
VisitorRoster, UserVisitLogs, AdminUsers, Responses, ClientLogos, ThemeConfig) where a sentence names a list (`the X`, `X list`, `X item`, `X.Column`, or a two-word title anywhere),
outside comments. Six places a person can see, each changed to the schema's title under this copy's settings (prefix and all):

| Where | Was | Now |
|---|---|---|
| Setup, self-test paragraph | "Proves that the Responses list behaves..." | "Proves that the PMSParticipantAnswers list behaves..." |
| Setup, self-test paragraph | "... written three ways on `QRTokens.Used`" | "... on `PMSGuestQRCodes.Used`" (and "two read-only questions" became three, naming the new one) |
| Setup, the self-test's confirmation | "one test item in the Responses list of THIS site" | "... in the PMSParticipantAnswers list ..." |
| Setup, PMS-LST-010's details | "no SchemaVersion on the AppSettings item" | "... on the PMSAppSettings item" |
| Admin, Today, a Go live that could not be verified | "Not verified: AppSettings now names ..." | "Not verified: PMSAppSettings now names ..." |
| Admin, Results, Restart of an unreadable visit (its tip) | "... the damaged item in the Responses list." | "... in the PMSParticipantAnswers list." |

`scripts/test-shown-names.js` (new, in `npm test`) failed on those six and passes now; it shows it can fail. `setup.spec.ts` holds the self-test's words in a browser with no prefix
and with `Test` (three engines), and failed on the old build. The data layer's own messages already used the titles (`spTitle`). Not on a page, and left: the column descriptions in
`pms-schema-meta.js` still say "a Sections.AppId", "a Tracks.AppId" and the like, which SHAREPOINT-LISTS.md prints.

**The styleguide test** (`npm run test:styleguide`, failing since Phase 10c-3): it looked for "This copy of the app" without its number, and also still expected the list titles of
before Phase 10c-2b, thirteen lists and a ThemeConfig row; all four expectations follow the page now, and it passes, 8 of 8. The admin page grew 8 B; the participant page did not.

## 7. Part E: the package and its runbook (`e250a36`)

**RUNBOOK.md** begins with a note for the PCOE site (it already has its lists, the version, an admin, the samples and `PMSAdminUsers` locked): replace `index.html`, `admin.html` and
`setup.html`, keep `pms-config.txt`, change nothing else; open Setup ("This copy of the app" shows the new build, Check Lists stays all Ready, the buttons can be seen); run the self-test
(every step passes, the new probe lists what the site leaves out; send back the whole table); open the admin page (Content shows Kroger's two activities and Domino's two); continue at
step 12. It says, as observed, that this site refuses a duplicate with 500 and leaves `ClientId` out of unnamed reads. **A new optional step 10, the self-test** (safe on a new site with
no real answers, deletes what it makes, expect every step to pass, send back the whole table); the steps after it moved one on (permissions 11, support contact 12, Go live 13, iPad 14,
Results 15, remove setup.html 16), and every reference to them. QA items 139, 140 and 142 are mapped to steps, 141 to "later". **RELEASE-NOTES.md** says what changed since
`pms-969bf16` and why, and what is still not proven.

**The package**, `npm run package:release` on `e250a36`: `build-svelte/package/pms-e250a36/` and `pms-e250a36.zip` (git-ignored, not committed). `pms-config.txt` is exactly
`{"configVersion": 1, "listPrefix": "", "label": "PMS"}`; every proof passed (no page holds a site address, a folder name, a PIN hash, the demo PIN, `p_cec_` or `CreativeExpCOE`; no
`.json` file); `shasum -a 256 -c` passed in the folder (7 OK) and in a fresh unzip (7 OK), which holds exactly the folder's 8 files.

| File | Bytes | gzip -9 | SHA-256 |
|---|---:|---:|---|
| index.html | 369,252 | 155,484 | `901d763c4208ca58ff97a459d924c1991e4b751d98e70787c01ae69daa3c9757` |
| admin.html | 1,666,401 | 605,192 | `d1ff8c397f5e2b48d8b5f036f38218c8d2aef4b84c58ebf9b430beaafcf4198d` |
| setup.html | 1,167,483 | 791,060 | `8ee5a810e5ca3e76ec9ac03deb3e527128513e3224fbfb73781b5cf40ac69467` |
| pms-config.txt | 54 | | `04426124f56abad3973d69fb4a8608e673d86745419bf1cc41c5a70441cc607f` |
| THIRD-PARTY-NOTICES.txt | 43,737 | | `ef3e34fe640c11a126469c0a8e08af7d604c3b34a1a04a6e1e045af7391b528a` |
| RELEASE-NOTES.md | 7,593 | | `fb99b0cdcbdec8ab46c87cb0cff792502c7964844e90a71539f47f556ff3f85e` |
| RUNBOOK.md | 19,666 | | `dac89b6dc329c5e73e5d7f516733e67ba3a05d195e27d14a8202f1854a649e19` |
| **pms-e250a36.zip** | 1,571,572 | | **`40a4ef0017bfc5ff0291640b5582b37d28f66f3414651350d5c08391d96a8391`** |

`pms-config.txt` is byte for byte the file already in the PCOE folder (the same SHA-256 as in Phase 10g), which is why the note says to keep it.

**The rehearsal**, `PMS_PACKAGE=build-svelte/package/pms-e250a36 npm run test:rehearsal`: **9 of 9 passed** in 1.3 minutes (three rehearsals in Chromium, WebKit and Firefox), on the
mock answering as the site did (`strict: false`: `ClientId` left out of an unnamed read; a duplicate refused with 500): an empty site (steps 3 to 15), a hand-built site with a misnamed
column (the same), and **the note for the PCOE site** on a site that already has its lists, an admin and the samples with their pictures: Setup with the new build and every list Ready,
the buttons seen, the self-test (10 of 10, "Refused: AppId enforces unique values.", the probe naming `PMSActivities: ClientId` and `PMSParticipantAnswers: ClientId`), Content with
Kroger's two activities and Domino's two, then Go live, an iPad's activity and Results. Each rehearsal ends by holding that no item read went out without naming its columns. In WebKit the
self-test's `$batch` step fails, as it always has there (Playwright's WebKit drops the boundary of a fulfilled `$batch` reply), and the rehearsal says so; every other step passes there.
Screenshots of steps 3, 4, 5, 6, 7, 8, 9, 10, 13, 14 and 15, and of the note, are in `test-results/rehearsal/`.

## 8. The gates, before and after

"Before" is the untouched `5bc90fa`, in a fresh worktree; "after" is `e250a36` (the last commit with code; F adds documents only), in the same worktree.

| Gate | Before (`5bc90fa`) | After (`e250a36`) |
|---|---|---|
| `npm run check:svelte` | 411 files, 0 errors, 0 warnings | 411 files, 0 errors, 0 warnings |
| `npm test` | 1,065 pass, 0 fail | 1,103 pass, 0 fail (+38: the three new suites, and the tests added beside them: the new suite's recording and second run on `Test` lists, `PHASE_10H`, the runbook's step 10) |
| `npm run test:baseline` | 36 pass | 37 pass (the new recorded suite) |
| `npm run test:bundle` | 29 pass | 30 pass (the `PHASE_10H` check) |
| `npm run test:migration` | 1,127 tests: 1,100 passed, 26 skipped, **1 failed** (see below) | 1,137 tests: 1,110 passed, 26 skipped, **1 failed** (see below); Chromium 423, WebKit 326, Firefox 361 passed |
| `npm run test:report:mutations` | 34 of 34 caught | 34 of 34 caught (unchanged) |
| `npm run oracle -- --seeds 500` | 0 differences (5,620 participants, 50 on the local server, 4 zones) | 0 differences (the same 5,620 participants: unchanged) |
| `npm run test:styleguide` (not a gate) | 7 passed, 1 failed (since 10c-3) | 8 of 8 |
| `npm run test:rehearsal` | 6 of 6 (pms-969bf16) | 9 of 9 (pms-e250a36) |

**The one failure after:** `live-display.spec.ts:208` ("Full screen on a phone and a tablet") in **Firefox**: at 1440 wide the page still scrolled sideways 5 seconds after
the resize (the test itself says Firefox redraws a chart a frame or two late after a resize). Nothing of this phase touches the Live display's layout or its charts. It passed in
Chromium and WebKit in the same run, in Firefox in Part A's whole run and in the untouched baseline run, and **3 times of 3 when run alone on the same build** (`F-flake-recheck.log`).
It is reported here as the failure it was; the full suite was not run again to replace it.

The one failure before any change: `admin-today.spec.ts:421` ("slugs: ... locked once a session exists") in Chromium read a client back before its save had landed (`themeVersion` 1, not
2). It passed in WebKit and Firefox in the same run, and 3 times of 3 when run alone on the same untouched worktree (`base-flake-recheck.log`): a timing flake, not touched here. The
whole browser suite at Part A's commit `e148e10`: 1,101 passed, 26 skipped, 0 failed (36.6 min).

## 9. Page sizes (gzip)

As `npm run test:bundle` measures them in a fresh checkout of each commit (the gate worktree; the package is built the same way):

| Page | Before (`5bc90fa`) | After (`e250a36`) | Change |
|---|---:|---:|---|
| participant (`index.html`) | 155,318 | 155,484 | +166 B (parts A and B; the allowance was 300 B; C to F added nothing) |
| admin (`admin.html`) | 605,056 | 605,192 | +136 B (A and B 128 B, D 8 B) |
| Setup (`setup.html`) | 757,250 | 791,060 | +33,810 B (C: the three Open Sans faces and the tokens, 33,182 B; A, B and D: the probe, the rule and the words) |

In this checkout, whose three HTML shells are CRLF (so its builds are about 10 B larger), the participant page went from 155,328 to 155,495 B (+167) and the admin page from 605,066 to
605,202 B (+136): `PHASE_10H` in `scripts/bundle-budget.js` records those, as Phase 10g did, and the next phase starts from them.

## 10. What only the real site can show

- **What the site leaves out of an unnamed read, besides `ClientId` on PMSActivities** (QA-TESTING.md item 139): the self-test's new probe says, list by list. Nothing in the app depends on
  it any more.
- **Content, Today, Go live and Results with these pages** (item 140): Kroger's two activities and Domino's two; "2 activities are live"; "Verified: participants now see Kroger".
- **Whether a create's reply also leaves `ClientId` out** (assumed, and handled either way).
- **What SharePoint answers for a `$select` that names a column the list lacks** (item 141; believed 400; only matters on a site where a column was deleted by hand).
- **The site's error code for a duplicate** (item 142): its words were seen; the code the rule also accepts was assumed.
- **The 403 seen once** on Content's look: whether it comes back.
- Everything after step 9 of the runbook: the participant accounts' permissions, Go live, an iPad, Results, the leader report; and that a missing `pms-config.txt` is a 404 (item 138).

## 11. Found, and left

- The `readNameSources` read of 20 sessions is 1,872 characters at the longest (1,752 before this phase): over the project's 1,500 since Phase 10c-2a, an open item.
- The column descriptions of `pms-schema-meta.js` (in SHAREPOINT-LISTS.md) still name the lists of before 10c-2b ("a Sections.AppId"); no page shows them.
- Two flakes, each failing once in a whole run and passing alone (section 8): `admin-today.spec.ts:421` in Chromium (before any change) and `live-display.spec.ts:208` in Firefox (at the end).
