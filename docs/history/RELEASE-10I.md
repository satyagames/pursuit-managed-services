# Phase 10i: a column SharePoint will not return by name (`DisplayName`)

Date: 15 Oct 2026. Branch `pms-redesign`, on top of `e07d2e3` (Phase 10h). Nothing was pushed; `main` and the tag `legacy-final` (`2ad1520`) are untouched.

**In plain words.** On 15 Oct 2026 the package `pms-e250a36` ran on the real site (`https://internal.global.deloitteonline.com/sites/PCOE`, folder `Shared Documents/PMS`, Chrome
on Windows): the self-test passed, Content showed each client's activities, Domino's went live and a participant's visit worked to its end. Then **Admin → Results did not load**:
"SharePoint (400): Value does not fall within the expected range." The visit log's read named its columns, `DisplayName` among them, and that site will not return a column of that
name: `DisplayName` is also a property SharePoint gives every list item. This phase renames the two `DisplayName` columns (**schema version 3**: `PMSGuestList.GuestName`,
`PMSVisitLog.SignedInName`), lets Setup bring the PCOE site from version 2 to version 3 (it only adds, then raises the version), adds a self-test probe that asks a site which
columns it will not return by name, and makes a new package, `pms-da9fc8d`, whose runbook begins with a ten-step note for the PCOE site. **These pages have not run on the real
site yet**, and nothing has run on an iPad.

## 1. The commits

| Part | Commit | Message |
|---|---|---|
| A | `7d47ba7` | Phase 10i: the fake refuses DisplayName by name; a guard on column names (**red on purpose**, see 3) |
| B | `879e8cf` | Phase 10i: schema version 3 (SignedInName, GuestName) |
| C | `3cea078` | Phase 10i: Setup brings a version-2 site up to version 3 |
| D | `3d5459f` | Phase 10i: the self-test finds columns a site will not return by name |
| E | `da9fc8d` | Phase 10i: package and runbook |
| F | (this commit) | Phase 10i: record |

`git status` after F: nothing tracked is changed. The untracked brand, Unity and `.claude/` files, and `.local/`, are where they were, never added (every commit was staged with
`git add -u` and new files by name). Commit A's message was amended once, before anything was built on it, to say the red commit was the answer to a question asked in this session
rather than attributing it to VJR (`959f6f1` became `7d47ba7`; the tree is the same). No other commit was changed. Gate logs are in `test-results/phase-10i/` (git-ignored).

## 2. What the real site showed (15 Oct 2026)

VJR's report, not something the tests saw (QA-TESTING.md, "Phase 10i", has it in full).

- **Worked:** the self-test, "Passed: 10 of 10 steps, 37 requests", with the duplicate "Refused: AppId enforces unique values."; Content showing each client's activities; Go live with
  Domino's (the "Staff mode" warning only); the participant page in Chrome on Windows (Welcome greeting the person by their SharePoint name with the hero badge, both activities
  listed, the thank-you screen saying "2 activities completed, 3 of 8 right on the first try").
- **Results failed** with "SharePoint (400): Value does not fall within the expected range." The failing request was the visit log's read in `readNameSources`
  (`.../getbytitle('PMSVisitLog')/items?...&$select=Id,AppId,SessionId,ClientId,Page,EntryMode,SharePointUserId,DisplayName,VisitorId,...`).
- **A console check** read every custom column of every list on its own (`items?$select=Id,<column>&$top=1`): every list "all fine", no column whose `EntityPropertyName` differs
  from its internal name, **except** `PMSVisitLog`: `DisplayName: 400 Value does not fall within the expected range.` `PMSGuestList` (which also has `DisplayName`) and
  `PMSGuestQRCodes` passed but had no items. An unnamed read of `PMSVisitLog` returned SharePoint's own fields and the list's columns but neither `ClientId` nor `DisplayName`.

## 3. Part A: the mock behaves as PCOE, and a guard on column names (`7d47ba7`)

**A red commit, on purpose.** The brief split the failing tests (A) from the rename that fixes them (B). AGENTS.md says "a failing test first, never a red commit", so I asked before
committing A; the answer was **"A red, B green"**. At `7d47ba7`, `npm test` had **1,114 tests, 49 failing** (`test-results/phase-10i/A-npm-test-red.log`): the guard, the new suite's
two scenarios, and every suite that reads a guest or a visit-log row on the mock (`test-participant-storage`, `test-admin-content`, `test-participant-names`, `test-leader-report-pdf`,
`test-oracle`, `test-named-reads`, `test-duplicates`, the namespace rerun and the baseline comparison). Each failed with the site's own words. B made every one pass.

**The mock** (`scripts/sharepoint-fake.js`):

- `refusesByName` (default `TENANT_REFUSES_BY_NAME`, `['DisplayName']`): an item read whose `$select` names such a column, case aside, and that would return at least one row, is
  refused with 400 and `REFUSED_WORDS`, "Value does not fall within the expected range.", and noted in `REFUSED_BY_NAME` (the new suites hold it empty). With no row to return it is
  answered, as PMSGuestList was. `refusesByName: []` turns it off.
- `TENANT_LEAVES_OUT` is `['ClientId', 'DisplayName']` (an unnamed read, and a create's reply).
- (B added `listsVersion: 2`: a site as Setup made it for version 2, with its `DisplayName` columns; its settings item says 2 unless `schemaVersion` says otherwise.)

**The guard** (`scripts/test-schema.js`): no column of `pms-schema.js` or META may be named, case aside, like

- a property SharePoint gives every list item in REST (`LIST_ITEM_PROPERTIES`, the brief's 33): `AttachmentFiles`, `Attachments`, `AuthorId`, `ComplianceAssetId`, `ComplianceInfo`,
  `ContentType`, `ContentTypeId`, `Created`, `DisplayName`, `EditorId`, `EffectiveBasePermissions`, `EffectiveBasePermissionsForUI`, `FieldValuesAsHtml`, `FieldValuesAsText`,
  `FieldValuesForEdit`, `File`, `FileSystemObjectType`, `FirstUniqueAncestorSecurableObject`, `Folder`, `GetDlpPolicyTip`, `GUID`, `HasUniqueRoleAssignments`, `ID`, `Id`,
  `LikedByInformation`, `Modified`, `OData__UIVersionString`, `ParentList`, `Properties`, `RoleAssignments`, `ServerRedirectedEmbedUri`, `ServerRedirectedEmbedUrl`, `Versions`;
- or the internal name of a column SharePoint puts on every list (`BUILT_IN_COLUMNS`, 35, added beyond the brief): `Title`, `Author`, `Editor`, `Order`, `FileRef`, `FileLeafRef`,
  `FileDirRef`, `FSObjType`, `UniqueId`, `ProgId`, `ScopeId`, `LinkTitle`, `LinkTitleNoMenu`, `SelectTitle`, `ItemChildCount`, `FolderChildCount`, `InstanceID`, `WorkflowVersion`,
  `WorkflowInstanceID`, `owshiddenversion`, `_UIVersionString`, `_UIVersion`, `_ModerationStatus`, `_ModerationComments`, `_Level`, `_IsCurrentVersion`, `MetaInfo`, `Edit`,
  `DocIcon`, `EncodedAbsUrl`, `BaseName`, `ServerUrl`, `PermMask`, `AppAuthor`, `AppEditor`.

The built-in `Title` is allowed (the activities' title IS that column). **On today's schema the guard named exactly two columns, `visitorroster.DisplayName` and
`uservisitlogs.DisplayName`, and no other** (`A-npm-test-red.log`); since B it names none. A second test shows it can fail (`DisplayName`, `created`, `ID`, `Order` caught;
`Title`, `SortOrder`, `SignedInName` not). Neither new name collides with anything on the two lists.

**The failing tests** (`scripts/test-column-names.js`, new, in `npm test`): Results and the leader report name a member of staff by the sign-in their visit was logged under (failed
at `readNameSources` with the site's words); a named guest is added, gets a code and checks in by QR (failed at the second read of the guest list, once the guest existed); the guard on
today's schema. In a browser, the existing `sharepoint.spec.ts` ("a first QR scan") and `live-display-sharepoint.spec.ts` ("Results names people") read the same lists.

## 4. Part B: schema version 3 (`879e8cf`)

**Every place the two columns were renamed:**

| Where | What |
|---|---|
| `public/js/pms-schema.js` | `visitorroster.displayName: 'GuestName'`, `uservisitlogs.displayName: 'SignedInName'`, `VERSION = 3` (and the header) |
| `public/js/pms-schema-meta.js` | `GuestName` and `SignedInName`, each with the reason for the rename in its text; `RETIRED` (the old `DisplayName` of each, `lastIn: 2`, `now`, `holds`), `retiredColumn()`, `columnNamesAt(key, version)`; SchemaVersion's text says `VERSION` |
| `SHAREPOINT-LISTS.md` | regenerated: the two columns, version 3, a new section "Columns no longer used" (`scripts/build-lists-reference.js`) |
| `scripts/sharepoint-fake.js` | the default version follows `VERSION`; `listsVersion` builds an older site from `columnNamesAt` |
| `scripts/oracle-results.js` | the raw rows it stores and the naming rule it reads them with (`GuestName`, `SignedInName`) |
| `scripts/test-sharepoint.js` | its own stub's rows and an assertion; its settings item says `VERSION` |
| `scripts/test-text-limits.js` | the guest name's limit is `META.visitorroster.columns.GuestName.max` |
| `scripts/migration-tests/admin-content-sharepoint.spec.ts` | two reads of the mock's guest rows |
| the version tests | `test-schema-version.js`, `test-site-ready.js`, `test-provision.js`, `schema-version.spec.ts`, `setup-provision.spec.ts`, `runbook.spec.ts`: version 2 is "older" now, 4 "newer"; "now says version 3" |
| `scripts/release-docs.js` | the runbook's "version 2" words follow `VERSION` |
| `QA-TESTING.md` | item 49 names `PMSVisitLog.SignedInName` |
| `scripts/test-schema.js` | the schema's named changes since the snapshot gain the rename (the snapshot test applies it) |
| 34 request-baseline entries | see below and the appendix |

**Not changed, on purpose:** `server/data/*.json`, the fixtures (`fixtures.ts`, `admin-local.ts`) and the seed export (`npm run export:sharepoint`) hold records by their FIELD,
`displayName`, which did not change (the export also leaves the guest list and the visit log out); `PROVISIONING.md` describes the old site and is kept as a record;
`scripts/schema-baseline/schema-before-10c2b.json` is the snapshot of before Phase 10c-2b.

**The request baselines, translated, never recorded again** (`scripts/schema-baseline/rename-baselines.js`, built like 10h's `select-baselines.js`). In each read of the items of a list
with a retired column, the list's `$select` of version 2 becomes today's, plain or encoded. Nothing else moves. **34 entries in 10 files** (42 lines, counting the reads a `$batch`
carried): `test-sharepoint` 3, `test-participant-storage` 7, `test-admin-content` 5, `test-live-display` 1, `test-participant-names` 6, `test-leader-report-pdf` 4,
`test-named-reads` 4, `browser-participant-start` 1 (Chromium), 1 (Firefox) and 2 (WebKit). Every one is a read of `PMSGuestList` (by AppId, or a session's guests) or of
`PMSVisitLog` (a session's visits), alone or carried in a `$batch`; the appendix lists them. Two examples (before, then after):

```
4 x GET /sites/cec/_api/web/lists/getbytitle('PMSGuestList')/items?$filter=AppId eq '<uuid>'&$top=2&$select=Id,AppId,SessionId,DisplayName,Enabled
4 x GET /sites/cec/_api/web/lists/getbytitle('PMSGuestList')/items?$filter=AppId eq '<uuid>'&$top=2&$select=Id,AppId,SessionId,GuestName,Enabled

1 x GET /sites/cec/_api/web/lists/getbytitle('PMSVisitLog')/items?$top=200&$filter=(SessionId eq 'parity-2026-12-01')&$select=Id,AppId,SessionId,ClientId,Page,EntryMode,SharePointUserId,DisplayName,VisitorId,VisitorName,TrackId,VisitedAt
1 x GET /sites/cec/_api/web/lists/getbytitle('PMSVisitLog')/items?$top=200&$filter=(SessionId eq 'parity-2026-12-01')&$select=Id,AppId,SessionId,ClientId,Page,EntryMode,SharePointUserId,SignedInName,VisitorId,VisitorName,TrackId,VisitedAt
```

**The version's number is in no entry**: a baseline records each request's method and address, never its body, and no address carries the version (it is read in `$select`'s
`SchemaVersion`, whose name did not change). So "entries that read the version change only by the number" amounted to none.

The proofs, each before the translation was written in place:

- **`--check`**: a fresh recording of every node suite equals its translated baseline exactly (`B-rename-check.log`: 1,146 entries, 30 renamed, "every fresh recording equals its
  translated baseline"). Its first run found one difference, in `test-site-ready`: I had made a version test loop over three versions where it looped over two, which sent one more
  check; the loop went back to two versions (2 and 4 in B; 4 and 0 since C), and nothing was amended for it.
- **`--order e07d2e3`**, the number and the order: every node suite run on `e07d2e3`'s whole tree (the last green commit: A is red) and on today's, request by request, the old
  translated against the new (`B-rename-order.log`): **26,178 requests, the same, in the same number and order**, the only entries set aside being those the baselines mark as
  timing-dependent (`~`: the participant page's watch, 145 and 143 times).
- **The browsers**: `request-baseline.spec.ts` against the translation (`PMS_BASELINE_DIR`) passed in Chromium, WebKit and Firefox (`B-browser-baseline-proof.log`), and failed in all
  three against the untranslated files (`B-browser-baseline-untranslated.log`).

## 5. Part C: Setup brings a version-2 site up to version 3 (`3cea078`)

**Show the plan** on a version-2 site names the two new columns and nothing else ("0 lists, 2 columns, 0 settings to create.") and, under what it will not touch, each old column,
harmless: "DisplayName is no longer used since version 3: GuestName holds the guest's name now. (SharePoint gives every list item a property called DisplayName, and would not return a
column of that name when a read named it.) Harmless: nothing reads or writes it. Leave it as it is, or a site owner may delete it by hand." (and the same for `SignedInName`).
**Create** adds the two columns and only adds (2 writes). **The strict check** counts the old columns as nothing: it flags a column it does not know only when that column is required,
and Setup made them optional (`test-schema-upgrade.js` holds Setup's check and Today's).

**The new Mark-ready rule, exactly as written** (`migration/src/lib/provision.js`, `markReady`, after the strict check and the picture library found nothing, and the settings item was
read):

```js
const raising = Number.isInteger(version) && version >= 1 && version < VERSION;
if (version !== undefined && version !== null && !raising) {
  if (version === VERSION) return { ready: true, wrote: null, words: `The site was already marked ready (version ${VERSION}). Nothing was written.`, problems, report };
  if (Number.isInteger(version) && version > VERSION) {
    return no(`Not marked ready: the settings item says version ${version}; this version of the app is for version ${VERSION}. Setup never lowers the version of the lists: upload the newer files.`);
  }
  return no(`Not marked ready: the settings item says version ${version}, which is no version of these lists. Setup does not change it.`);
}
// ... the MERGE of SchemaVersion alone (If-Match on the item as read), then the read back ...
if (raising) return { ready: true, wrote: 'raised', from: version, words: `Raised the lists from version ${version} to version ${VERSION}.`, problems, report };
```

In words: when the check of version 3 is clean, a lower version (1 or 2) is raised to 3 and the page says "Raised the lists from version 2 to version 3."; a higher version is never
lowered; a value that is no version is left; and while any problem remains nothing is written (that part is unchanged: the check comes first). A clean Create runs it by itself, as before.

**PMS-LST-011's words** (Setup's, `lib/deploy-problems.js`): "This site's lists need an update before this version of the app can use them. The lists on this site are version 2; this
version of the app needs version 3. Open Setup (setup.html, in the same folder as this page), press Show the plan, then Create, then Mark the site as ready: a clean Create does the last
step by itself. (PMS-LST-011, SchemaVersion 2, this build needs 3)". The participant and admin pages' stop screen is unchanged ("This site's lists are not the ones this version of
the app needs ... open Setup ... Details: PMS-LST-011"): their words cost bytes every participant pays, and they already send the person to Setup.

**Tests, red first** (`C-red.log`, then `C-green.log`): `scripts/test-schema-upgrade.js` (new, in `npm test`) on a version-2 site with its old columns, an admin, the samples, Domino's live,
a staff visit logged under `DisplayName` and a guest under it: the pages stop with PMS-LST-011 and write nothing; Setup's words; the plan is exactly two columns, the two old ones
harmless; Create writes exactly `POST visitorroster GuestName` and `POST uservisitlogs SignedInName`; Mark ready raises 2 to 3 with one write (`MERGE appsettings`) and leaves the rest
of the item; a second press writes nothing; then the pages work: a member of staff who visits now is named in Results, a named guest checks in by QR, Today's check is clean; version 4
is never lowered and a half-upgraded site is not raised. `scripts/migration-tests/schema-upgrade.spec.ts` (new) does the same in the built pages, in three engines; against B's build it
failed for the right reasons (the old PMS-LST-011 words, "Setup does not change a version it did not write"), and passes now.

**What the upgrade cannot bring back:** a value written to a retired column cannot be read (the site refuses it by name and leaves it out of an unnamed read). So the 15 Oct visit on
PCOE is "Unnamed participant 1" in Results after the upgrade, and a guest added before an upgrade would have no name (PCOE's guest list was empty). Everyone after it is named. The tests
and the runbook say so.

## 6. Part D: the self-test finds columns a site will not return by name (`3d5459f`)

`lib/setup-checks.js`, beside 10h's probe: **"Probe (read-only): columns this site will not return by name"**. For each list: one look (`$select=Id&$top=1`); for a list with an item,
its fields (its own columns: not hidden, not read-only, not SharePoint's base ones; the app's and any other, such as the `DisplayName` a version-2 list keeps), one item read naming all
of them, and only when that is refused, one read for each column alone. It reports the columns refused (each marked "no longer used since version 3" or "which the app reads"), the lists
it could not test because they are empty, and any list it could not read; it never fails. The self-test is eleven steps. Tests (`scripts/test-column-names.js`, red first, `D-red.log`):
on the PCOE site after the upgrade with a guest and a code it says "Refused when named: PMSGuestList.DisplayName (no longer used since version 3; 400: Value does not fall within the
expected range.); PMSVisitLog.DisplayName (no longer used since version 3; 400: ...). Read one item of 10 lists, naming every column; empty, so not tested: PMSAdminUsers,
PMSParticipantAnswers. No column of the app is among them ..." in 49 GETs; on a site of version 3 alone it names nothing; a refused column the app reads is named as such; a list it
cannot read is named. In a browser (`setup.spec.ts`): "Passed: 11 of 11 steps, 50 requests", the new row with 16 requests.

## 7. Part E: the package and its runbook (`da9fc8d`)

**RUNBOOK.md** begins with a note for the PCOE site, whose lists are version 2 with an admin, the samples and Domino's live: (1) replace the three pages, keep `pms-config.txt`;
(2) open Setup: version 2, this copy needs 3; (3) Show the plan: two columns to create, the old `DisplayName` columns as harmless; (4) Create; (5) "Raised the lists from version 2 to
version 3" (a clean Create marks the site ready by itself); (6) Check Lists, all Ready; (7) in admin.html, Today: "Guests scan a personal QR", then Guests and QR: one named guest and
one code, so the guest list and the codes have an item; (8) the self-test, the whole table, every step passing and both probes reporting; (9) Results shows the live session (the 15 Oct
visit "Unnamed participant 1"); (10) step 14 on an iPad by scanning the guest's code, Results again, then step 16. It says, as observed, that this SharePoint will not return a column named
`DisplayName`. For a new site the steps are unchanged but for the version (3) and the self-test (eleven steps, four questions). PMS-LST-011 in "What a code means" says what to press.
QA items 143 to 145 are mapped to the note's steps (`QA_BY_NOTE`). **RELEASE-NOTES.md** says what changed since `pms-e250a36`, and why.

**Two departures from the brief's wording, both to keep the runbook true.** The brief's step 9 says "Results shows today's session, with the participants named": the 15 Oct visit
cannot be named after the upgrade (5), so step 9 says it will be "Unnamed participant 1" and step 10 checks a named person in Results after the iPad. And step 7 needs the live session
switched to "Guests scan a personal QR" first: Guests and QR makes codes only in that mode.

**The package**, `npm run package:release` on `da9fc8d`: `build-svelte/package/pms-da9fc8d/` and `pms-da9fc8d.zip` (git-ignored, not committed). `pms-config.txt` is exactly
`{"configVersion": 1, "listPrefix": "", "label": "PMS"}`, byte for byte the file in the PCOE folder (the same SHA-256 as in Phases 10g and 10h). Every proof passed (no page holds a site
address, a folder name, a PIN hash, the demo PIN, `p_cec_` or `CreativeExpCOE`; no `.json` file); `shasum -a 256 -c` passed in the folder (7 OK) and in a fresh unzip (7 OK), which holds
exactly the folder's 8 files.

| File | Bytes | gzip -9 | SHA-256 |
|---|---:|---:|---|
| index.html | 369,251 | 155,492 | `05636fb5bdc7adcde7b17ac579b1f1275a796773f762cddf5dc1d4cd0fd6c0f9` |
| admin.html | 1,666,400 | 605,199 | `331817845de1f3446f098bcb5fe2e86adb27c65e6ca0ebf6918c1e62d9e1fb00` |
| setup.html | 1,171,219 | 792,336 | `9b21a1de78657798523844f5eaa1463f94b225bab5bac217093dada88c27bd26` |
| pms-config.txt | 54 | | `04426124f56abad3973d69fb4a8608e673d86745419bf1cc41c5a70441cc607f` |
| THIRD-PARTY-NOTICES.txt | 43,737 | | `ef3e34fe640c11a126469c0a8e08af7d604c3b34a1a04a6e1e045af7391b528a` |
| RELEASE-NOTES.md | 10,194 | | `372cbda926dfd0c1f41b31f76f4ecda97e7a27cae1d988bc0397c9cef7462e34` |
| RUNBOOK.md | 23,544 | | `b86f12126bcf8a721eacc94bdefdb25a00427cb96b921d22edc5fdd1a874414e` |
| **pms-da9fc8d.zip** | 1,574,452 | | **`d3578d5a6f8245be038fed8ddd1026c694d4797aa1f31cb76b753c1cf056aa6a`** |

**The rehearsal**, `PMS_PACKAGE=build-svelte/package/pms-da9fc8d npm run test:rehearsal`: **12 of 12 passed** in 1.6 minutes (`E-rehearsal.log`), on the mock in its PCOE modes
(`strict: false`: `ClientId` and `DisplayName` left out of an unnamed read; `DisplayName` refused by name; a duplicate refused with 500):

| Run | Chromium | WebKit | Firefox |
|---|---|---|---|
| 1. An empty site: steps 3 to 15 (the self-test eleven steps, the fourth probe naming nothing) | pass | pass | pass |
| 2. A hand-built site with a misnamed column: the plan reports it, Mark ready refuses, the fix, then steps 5 to 15 | pass | pass | pass |
| 3. A site that already has its lists of this version (the 10h note's case): three pages replaced, Setup, the self-test, Content, Go live to Results | pass | pass | pass |
| 4. **The note for the PCOE site of version 2** (new): PMS-LST-011, the plan (two columns, two harmless), Create, "Raised the lists from version 2 to version 3.", Check Lists, a guest and a code made in the admin page, the self-test (the fourth probe naming the two old columns), Results ("Unnamed participant 1"), an iPad checking in with the guest's code ("Hi Jordan Lee!", Domino's History to its end), Results again ("Jordan Lee") | pass | pass | pass |

In WebKit the self-test's `$batch` step fails, as it always has there (Playwright's WebKit drops the boundary of a fulfilled `$batch` reply), and the rehearsal says so; every other step
passes there. Each run ends by holding that no item read went out without naming its columns and nothing reached another copy's lists. Screenshots are in `test-results/rehearsal/`
(`pcoe-v2-*` for the fourth run: the plan, raised, the guest, Results before and after the iPad).

## 8. The gates, before and after

"Before" is the untouched `e07d2e3`, in a fresh worktree; "after" is `da9fc8d` (the last commit with code or scripts; F adds documents only), in the same worktree.

| Gate | Before (`e07d2e3`) | After (`da9fc8d`) |
|---|---|---|
| `npm run check:svelte` | 411 files, 0 errors, 0 warnings | 411 files, 0 errors, 0 warnings |
| `npm test` | 1,103 pass, 0 fail | 1,129 pass, 0 fail (+26: `test-column-names` 13, `test-schema-upgrade` 9, the guard 2, a version case, `PHASE_10I`) |
| `npm run test:baseline` | 37 pass | 37 pass (no new recorded suite) |
| `npm run test:bundle` | 30 pass | 31 pass (the `PHASE_10I` check) |
| `npm run test:migration` | 1,137 tests: 1,111 passed, 26 skipped, 0 failed (37.0 min); Chromium 423, WebKit 326, Firefox 362 passed | 1,146 tests: **1,120 passed, 26 skipped, 0 failed** (36.7 min); Chromium 426, WebKit 329, Firefox 365 passed (+3 each: `schema-upgrade.spec.ts`) |
| `npm run test:report:mutations` | 34 of 34 caught | 34 of 34 caught (unchanged) |
| `npm run oracle -- --seeds 500` | 0 differences (5,620 participants, 50 on the local server, 4 zones) | 0 differences (the same 5,620 participants: unchanged) |
| `npm run test:styleguide` (not a gate) | (not run) | 8 of 8 |
| `npm run test:rehearsal` | 9 of 9 (`pms-e250a36`, Phase 10h) | 12 of 12 (`pms-da9fc8d`) |

No test failed in either whole run of the browser suite, before or after. The node gates were also run at each commit before it was made (logs `B-*`, `C-*`, `D-*`, `E-*`).

At commit B (`879e8cf`) the whole browser suite ran once as well (`Bfull-test:migration.log`): 1,110 passed, 26 skipped and **1 failed**, `admin-today.spec.ts:747` ("keyboard: the tab
row is one stop ... Enter on Go live works") in Chromium, waiting for Go live's confirmation dialog, while I was running other suites alongside on the same machine. It is a local-server
test that nothing of this phase reaches. It passed in the final whole run, and 3 times of 3 when run alone on the final build (`F-flake-recheck.log`).

## 9. Page sizes (gzip)

As `npm run test:bundle` measures them in a fresh checkout (the gate worktree; the package is built the same way):

| Page | Before (`e07d2e3`) | After (`da9fc8d`) | Change |
|---|---:|---:|---|
| participant (`index.html`) | 155,484 | 155,492 | +8 B (B: the two column names and the version; the allowance was 100 B) |
| admin (`admin.html`) | 605,192 | 605,199 | +7 B (B) |
| Setup (`setup.html`) | 791,060 | 792,336 | +1,276 B (B: META's texts and `RETIRED`; C: the plan's words and the raise; D: the probe) |

In this checkout, whose three HTML shells are CRLF, the participant page went from 155,495 to 155,503 B (+8) and the admin page from 605,202 to 605,208 B (+6): `PHASE_10I` in
`scripts/bundle-budget.js` records those, and the next phase starts from them. The longest address grows by one character (`readNameSources` by 20 sessions on the PCOE address: 1,872 to
1,873; `SignedInName` is a letter longer than `DisplayName`).

## 10. What only the real site can show

- **That Setup brings PCOE from version 2 to version 3** (QA-TESTING.md item 145): the plan, the two columns made as asked (each is read back; Create stops and says so if not), the
  MERGE of `SchemaVersion` landing (it is read back), Check Lists all Ready, and Results loading.
- **Which columns the site will not return by name, with a guest and a code on it** (item 143): whether `PMSGuestList.DisplayName` is refused too once it has an item (the brief's "most
  likely"), and that no column of the app is.
- **The QR check-in of a named guest on PCOE** (item 144), and Guests and QR with a guest on it.
- **That the cause is the name** (`SP.ListItem.DisplayName`): the rename rests on it; the probe's answer (143) is the evidence.
- Still open from before: items 138 (a missing `pms-config.txt` is a 404), 139 (what an unnamed read leaves out besides `ClientId`: the 15 Oct console read shows `DisplayName` too),
  141 (a read naming a column the list lacks) and 142 (the duplicate's error code), the participant accounts' permissions, an iPad, the leader report on the site.

## 11. Found, and left

- **The 15 Oct visit's name on PCOE is lost to the app**: it is in `PMSVisitLog.DisplayName`, which the site will not return. Whether another REST shape (`FieldValuesAsText`) would
  return it was not tried: nothing reads a retired column, and the brief allows no other change.
- **The old `DisplayName` columns stay on PCOE.** Setup never deletes; a site owner may, by hand. Nothing depends on them.
- **`admin-today.spec.ts:747`** failed once at B (section 8); `PROVISIONING.md` still describes the old lists with `DisplayName` (a record of the old site).
- **The plan says "0 lists, 2 columns, 0 settings to create."** (the counts' wording, open since 10c-3).
- The `readNameSources` read of 20 sessions is 1,873 characters at the longest (over the project's 1,500 since Phase 10c-2a), an open item.

## Appendix: the 34 request-baseline entries amended in part B

Each changed only by `DisplayName` becoming `GuestName` (PMSGuestList) or `SignedInName` (PMSVisitLog) in the `$select` of the read(s) shown; every count is what it was.

| Baseline | Entry (count, and the renamed read in it) |
|---|---|
| browser-participant-start.chromium | 2 x a $batch carrying `PMSGuestList $filter=AppId eq '<uuid>'` |
| browser-participant-start.firefox | 2 x a $batch carrying `PMSGuestList $filter=AppId eq '<uuid>'` |
| browser-participant-start.webkit | 2 x GET `PMSGuestList $filter=AppId eq '<uuid>'` |
| browser-participant-start.webkit | 2 x a $batch carrying `PMSGuestList $filter=AppId eq '<uuid>'` |
| test-admin-content | 4 x GET `PMSGuestList $filter=AppId eq '<uuid>'` |
| test-admin-content | 7 x GET `PMSGuestList $filter=(SessionId eq 'kroger-2026-10-11')` |
| test-admin-content | 2 x a $batch carrying `PMSGuestList $filter=AppId eq '<uuid>'` |
| test-admin-content | 9 x a $batch carrying `PMSGuestList $filter=(SessionId eq 'kroger-2026-10-11')` |
| test-admin-content | 1 x a $batch carrying `PMSGuestList $filter=(SessionId eq 'kroger-2026-10-11')` |
| test-leader-report-pdf | 12 x GET `PMSGuestList $filter=AppId eq '<uuid>'` |
| test-leader-report-pdf | 3 x a $batch carrying `PMSVisitLog $filter=(SessionId eq 'harbour-2026-10-11')`, `PMSGuestList $filter=(SessionId eq 'harbour-2026-10-11')` |
| test-leader-report-pdf | 9 x a $batch carrying `PMSGuestList $filter=AppId eq '<uuid>'` |
| test-leader-report-pdf | 3 x a $batch carrying `PMSGuestList $filter=AppId eq '<uuid>'` |
| test-live-display | 2 x a $batch carrying `PMSVisitLog $filter=(SessionId eq 'kroger-2026-10-11')`, `PMSGuestList $filter=(SessionId eq 'kroger-2026-10-11')` |
| test-named-reads | 1 x GET `PMSVisitLog $filter=(SessionId eq 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-2026-1…` |
| test-named-reads | 1 x GET `PMSGuestList $filter=AppId eq '<uuid>'` |
| test-named-reads | 1 x a $batch carrying `PMSGuestList $filter=AppId eq '<uuid>'` |
| test-named-reads | 1 x a $batch carrying `PMSVisitLog $filter=(SessionId eq 'kroger-2026-10-15')`, `PMSGuestList $filter=(SessionId eq 'kroger-2026-10-15')` |
| test-participant-names | 12 x GET `PMSGuestList $filter=AppId eq '<uuid>'` |
| test-participant-names | 1 x a $batch carrying `PMSVisitLog $filter=(SessionId eq 'harbour-2026-10-11')`, `PMSGuestList $filter=(SessionId eq 'harbour-2026-10-11')` |
| test-participant-names | 9 x a $batch carrying `PMSGuestList $filter=AppId eq '<uuid>'` |
| test-participant-names | 3 x a $batch carrying `PMSGuestList $filter=AppId eq '<uuid>'` |
| test-participant-names | 1 x a $batch carrying `PMSVisitLog` and `PMSGuestList`, each by 20 session ids (`SessionId eq 'harbour-2026-10-11' or ...`), twice |
| test-participant-names | 5 x a $batch carrying `PMSVisitLog $filter=(SessionId eq 'harbour-2026-10-11')`, `PMSGuestList $filter=(SessionId eq 'harbour-2026-10-11')` |
| test-participant-storage | 50 x GET `PMSGuestList $filter=AppId eq '<uuid>'` |
| test-participant-storage | 2 x GET `PMSGuestList $filter=(SessionId eq 'kroger-2026-10-11')` |
| test-participant-storage | 1 x GET `PMSVisitLog $filter=(SessionId eq 'parity-2026-12-01')` |
| test-participant-storage | 3 x a $batch carrying `PMSGuestList $filter=AppId eq '<uuid>'` |
| test-participant-storage | 52 x a $batch carrying `PMSGuestList $filter=AppId eq '<uuid>'` |
| test-participant-storage | 2 x a $batch carrying `PMSGuestList $filter=AppId eq '<uuid>'` |
| test-participant-storage | 1 x a $batch carrying `PMSGuestList $filter=AppId eq '<uuid>'` |
| test-sharepoint | 7 x GET `PMSGuestList $filter=AppId eq 'visitor-a'` |
| test-sharepoint | 1 x GET `PMSGuestList $filter=(SessionId eq 'session-b')` |
| test-sharepoint | 1 x a $batch carrying `PMSGuestList $filter=AppId eq 'visitor-a'` |
