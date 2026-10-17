# Phase 10g: the settings file is pms-config.txt (the first finding from the real site)

Date: 14 Oct 2026. Branch `pms-redesign`, on top of `98c9e03` (Phase 10f). Nothing was pushed; `main` and the tag `legacy-final` (`2ad1520`) are untouched.

**In plain words.** The first run on the real site found one thing, and it was a name. The site (`https://internal.global.deloitteonline.com/sites/PCOE`, a classic SharePoint,
folder `Shared Documents/PMS`) will not serve `.json` files from a document library. The settings file is now **`pms-config.txt`**: the same JSON inside, the same rules,
one name, and the pages read that file and nothing else. The new package is `build-svelte/package/pms-969bf16/` with `pms-969bf16.zip` beside it (git-ignored). Its runbook
has a note for the PCOE site, which already has the old upload: replace the three pages, keep the `pms-config.txt` that is there, delete `pms-config.json`. **Everything else
has still not run on the real site**: the lists, Setup's plan, Create, Mark ready, Add an admin, Go live and the iPad.

## 1. The commits

| Part | Commit | Message |
|---|---|---|
| A | `5c65289` | Phase 10g: the settings file is pms-config.txt |
| B | `969bf16` | Phase 10g: package and runbook with pms-config.txt |
| C | (this commit) | Phase 10g: record |

`git status` after C: nothing tracked is changed. The untracked brand, Unity and `.claude/` files, and `.local/`, are where they were, never added (every commit was staged with
`git add -u`). B was amended once, before the package was built from it (see 4.4); no other commit was changed after it was made.

## 2. What the real site showed (14 Oct 2026)

This is VJR's report, not something the tests saw. The package `pms-50ae628` was uploaded to `Shared Documents/PMS`.

1. The three pages open as pages. `setup.html` started, derived the site from its own address, and reported the build `pms-50ae628`.
2. `setup.html` stopped with `PMS-CFG-002` ("the site sent a web page in its place").
3. Opening `.../Shared%20Documents/PMS/pms-config.json` directly shows SharePoint's own "Sorry, something went wrong: File Not Found" page, **although the file is in the folder**.
   The page's request received that page with a success status, so `settings-file.js` classed it as `page`, not as a 404.
4. The same file renamed `pms-config.txt`, in the same folder, **is served as its text**.

The file is byte for byte the same under the new name (SHA-256 `04426124...c607f` for the old `pms-config.json` and the new `pms-config.txt`), which is why the runbook says the
`pms-config.txt` already in the folder can stay.

## 3. Part A: one name (`5c65289`)

### 3.1 Tests first (red, then green)

Written and run red before any code changed (the two node test files: 90 of 159 failing):

- **The page reads `pms-config.txt` and nothing else.** `scripts/test-settings-file.js`: a stand-in for `fetch` serves a decoy `.json` with another prefix; the reader asks once, for the
  `.txt`, and the decoy is neither asked for nor obeyed. With the `.txt` missing (a 404) the `.json` is no stand-in: the answer is "no file", and only one request was sent.
  `settings-file.spec.ts` does it in a browser, in Chromium, WebKit and Firefox: a decoy `.json` route that would put the page on `DECOY` lists is served beside the file and
  is requested zero times, by all three pages; and with no `.txt` the page stops with `PMS-CFG-001` and asks the lists for nothing.
- **A page instead of the file still stops with PMS-CFG-002.** Both the sign-in page and SharePoint's own "File Not Found" page, with a 200, in node and in a browser; a 404 that is
  the same error page is still "no file".
- **No file under `migration/` or `public/js` says `pms-config.json`** (a source guard; `SETTINGS_FILE` is the one place the code spells the name).
- The tests that serve the file serve it as `text/plain`, as the tenant does (`sharepoint.ts`, `https-site.ts`, the rehearsal).

### 3.2 The change

`SETTINGS_FILE` is `pms-config.txt`. Every message, help text, comment, fixture, script, document and generated file follows it (35 files, 255 insertions and 138 deletions), and
`pms-config.example.json` is `pms-config.example.txt` (`git mv`). `SHAREPOINT-LISTS.md` is regenerated (`npm run build:lists-reference`).

### 3.3 PMS-CFG-002: one more cause, and the status

- `deploy-problems.js` words a web page in the file's place as: "the site sent a web page in its place, usually its sign-in page, or an error page such as 'File Not Found' when the
  site will not hand out this kind of file". This is Setup's wording; the participant page's stop screen is as it was.
- The Details line carries the HTTP status that came back for a web page or text that is not JSON: `PMS-CFG-002, page 200, <address of the file>` (`json 200` likewise), as
  `status 503` always did. `settings-file.js` hands `fileError.status` back for those two as well; the stop screen already printed `kind` and `status`, so it shows
  `Details: PMS-CFG-002 page 200` with no change of its own.

### 3.4 Request baselines

None moved. `npm run test:baseline` passes (36) with nothing amended: the settings file is fetched by `settings-file.js` alone, which no recorded suite sends through.

### 3.5 Sizes

`PHASE_10G` in `scripts/bundle-budget.js`: the participant page may grow by at most 100 B gzip. It grew **8 B** (admin **2 B**, held to the same allowance). See section 7. Phase 10f's
test had compared the build in the tree with figures that this phase moves past (allowance 0), so it became a recorded-numbers check, as the earlier growth phases already are; the
newest phase's test holds the build.

### 3.6 QA-TESTING.md

The finding is recorded as observed on this tenant (`.json` not served, `.txt` served, 14 Oct), item 88's "unknown until tried" is answered, and **item 138** is added, still to see:
"a missing `pms-config.txt` comes back as a 404".

## 4. Part B: the package and its runbook (`969bf16`)

### 4.1 The package

`npm run package:release` on `969bf16`: `build-svelte/package/pms-969bf16/`, and the zip beside it. The package script refuses a dirty tracked tree, and a package is made from a
commit, so the runbook (generated by `scripts/release-docs.js`) was changed and committed first, and the package made from that commit.

| File | Bytes | gzip -9 | SHA-256 |
|---|---:|---:|---|
| `index.html` | 368,943 | 155,318 | `08790f07cc91960564e7e0ad9d276d403daa1e88c682cfc918cf82a5398b3559` |
| `admin.html` | 1,666,068 | 605,056 | `aa7c2e7bb3428a8bc3f6fd33a8f90c7d26448294f2fcc293dddc664342aab5c4` |
| `setup.html` | 1,122,218 | 757,250 | `650a0d5d5069a1b892c890f4842fb92823f969d5170d0a53695ad98b0a20811e` |
| `pms-config.txt` | 54 | | `04426124f56abad3973d69fb4a8608e673d86745419bf1cc41c5a70441cc607f` |
| `THIRD-PARTY-NOTICES.txt` | 43,737 | | `ef3e34fe640c11a126469c0a8e08af7d604c3b34a1a04a6e1e045af7391b528a` |
| `RELEASE-NOTES.md` | 4,789 | | `2ca308f52ce68a12db08fc8a5290c62696612d27b8bb648904d140c0f731128b` |
| `RUNBOOK.md` | 17,293 | | `49a4230f76b24f0baf850e0de963ff895cd058f414f144f7fd552c91abc1eadc` |
| `SHA256SUMS.txt` | 562 | | `53d16ea3013c3a8bba335a320ca9ec7b66671f153bdf9307b9740b1c998d19d9` |
| `pms-969bf16.zip` | 1,533,702 | | `ff0c3eb07952283331aabc7152557bf24dd51b58bb1e1a50c182001d50f3e8e7` |

Checked, by the script and again by hand:

- `pms-config.txt` holds exactly `{"configVersion": 1, "listPrefix": "", "label": "PMS"}` (54 bytes, no newline), and **no file in the folder or the zip is a `.json`** (the script now
  stops if one is; `listingProblems` in `scripts/release-proofs.js`, shown to be able to fail in `scripts/test-release-docs.js`).
- Every page proof passes: no site address, folder name, PIN hash, demo PIN, `p_cec_` or `CreativeExpCOE`. The three pages say `pms-config.txt` (2, 2 and 6 times) and never `.json`.
- `shasum -a 256 -c SHA256SUMS.txt` passes in the folder (7 OK) and in a fresh unzip of the zip in an empty directory (7 OK); the zip holds exactly the folder's 8 files.
- Against `pms-50ae628`: `index.html` and `admin.html` are 12 bytes longer each, `setup.html` 101 bytes (the wording, and its own build name); `THIRD-PARTY-NOTICES.txt` is byte for byte
  the same; `pms-config.json` is now `pms-config.txt`, byte for byte the same.

### 4.2 RUNBOOK.md and RELEASE-NOTES.md

- **A note before the steps, "If this site already has the earlier upload (pms-50ae628): the PCOE site does"**: replace `index.html`, `admin.html` and `setup.html`; the
  `pms-config.txt` already in the folder has the right content and can stay (or be replaced by the package's copy); delete `pms-config.json` if it is still there; carry on from
  step 3. It says, as observed, that this site does not serve `.json` files from a document library.
- **Step 2** uploads `pms-config.txt`, says why it is a `.txt`, and has a check: open its address in a browser, it must show the line as text. **Step 11** (the support contact)
  names `pms-config.txt`. "What a code means" says what `PMS-CFG-002` with `page 200` is and what to look at.
- **RELEASE-NOTES.md** has a section "What changed since pms-50ae628 (the first upload to the new site, 14 Oct 2026)", and "What is not proven" now says that only the first start
  of the pages has been seen on a real site and that the 404 for a missing file is QA item 138. The runbook's last line said nothing here had run on a real SharePoint site before,
  which is no longer true; it now says only the first start of the pages has been seen there.

### 4.3 The rehearsal

`PMS_PACKAGE=build-svelte/package/pms-969bf16 npm run test:rehearsal`: **6 of 6**, in Chromium, WebKit and Firefox (RUNBOOK.md steps 3 to 14, on an empty site and on a hand-built one with a
misnamed column), with the new package's pages at the PCOE folder address.

### 4.4 One change to the rehearsal, and the amend

The rehearsal served the generator's constant as the body of `pms-config.txt`, not the package's own file. It now reads the file out of the package and checks it is exactly the settings
text (`packageSettings` in `runbook.spec.ts`), so the file that will be uploaded is the file the rehearsal served. That change was made after a first package (`pms-97a7688`) and its
rehearsal had passed, so B was amended, that package was deleted, and `pms-969bf16` was built from the amended commit and rehearsed again. `pms-97a7688` is not a package to use.

## 5. Part C: the record

This file; the Phase 10g section of `MIGRATION-PLAN.md`; `AGENTS.md` ("Rules from Phase 10g", and the file's name where it is named); `SHAREPOINT-DEPLOYMENT.md` (why the file is a
`.txt`, how to upgrade a folder that has the earlier upload, the new words of `PMS-CFG-002`).

## 6. Gates, before and after

Before is `98c9e03` in a clean worktree; after is `969bf16` in another (so the figures are of the committed tree, not of this working copy). Every gate ran sequentially.

| Gate | Before (`98c9e03`) | After (`969bf16`) |
|---|---|---|
| `npm run check:svelte` | 411 files, 0 errors, 0 warnings | 411 files, 0 errors, 0 warnings |
| `npm test` | 1,058 pass | **1,065 pass** (+7: three in `test-settings-file.js`, one more failure case there, the 10g size test, the `.json` listing proof, the upgrade-note test) |
| `npm run test:baseline` | 36 pass | 36 pass, nothing amended |
| `npm run test:bundle` | 28 pass | 29 pass (`PHASE_10G`) |
| `npm run test:rehearsal` | 6 of 6 (`pms-50ae628`, in 10f) | **6 of 6** (`pms-969bf16`) |
| the named specs (`settings-file`, `setup-deployment`, `sharepoint.spec`, `review-9a`, `focus.spec`), three engines | not run | 146 passed, 12 skipped (the lists in `playwright.config.ts`), 1 failed (my own new spec, a race in the test, fixed; `settings-file.spec.ts` then 42 of 42 in the three engines) |
| `npm run test:migration` (the whole browser suite) | 1,095 passed, 26 skipped of 1,121 (recorded in RELEASE-10F.md; not run again) | **1,101 passed, 26 skipped, 0 failed** of 1,127, in 37.2 min, in Chromium, WebKit and Firefox (+6 passed: the two new settings-file specs, three engines each; the 26 skipped are the lists in `playwright.config.ts`, unchanged) |

The first of the named-spec runs failed once, in Firefox, in a test I had just written: it counted REST requests after three pages had been opened, and a late request from an earlier page
landed after the count. The missing-file case is its own test now, with a fresh counter. Nothing in the app was involved.

Also run: `test:build:svelte:release` (1 of 1) and `test:styleguide` (7 of 8; the one failure is not this phase's, see 8).

## 7. Page sizes (gzip -9)

| Page | Phase 10f | Phase 10g | Allowance |
|---|---:|---:|---|
| participant, this working copy | 155,320 B | **155,328 B** (+8 B) | `PHASE_10G`: 100 B; ceiling 450,000 |
| participant, a fresh checkout (the package) | 155,309 B | **155,318 B** (+9 B) | |
| admin, this working copy | 605,064 B | **605,066 B** (+2 B) | 100 B; budget 700,000 |
| admin, a fresh checkout (the package) | 605,055 B | **605,056 B** (+1 B) | |
| Setup, a fresh checkout | 757,207 B | 757,250 B | no budget |

The working copy measures about 10 B more than a fresh clone because its three HTML shells have Windows line ends, which a build carries as a few carriage-return bytes
(AGENTS.md, "Line endings"; the package script builds in a fresh checkout for that reason). The allowance holds in both.

## 8. Where `.json` is still said, and why

`git grep pms-config.json` finds it in these places, none of them a name the app asks for:

- **Tests that name it on purpose** (`scripts/test-settings-file.js`, `scripts/migration-tests/settings-file.spec.ts`, `scripts/test-release-docs.js`): the decoy `.json` that must be neither
  asked for nor obeyed, the guard that no source says it, and the proof that the package holds none.
- **`scripts/release-docs.js`** (RUNBOOK.md and RELEASE-NOTES.md): the note for a site that has the earlier upload tells the colleague to delete `pms-config.json`, and says why.
- **Documents about this phase** (`QA-TESTING.md`, `SHAREPOINT-DEPLOYMENT.md`, `AGENTS.md`, this file, the Phase 10g section of `MIGRATION-PLAN.md`): the finding itself, and the upgrade.
- **History, left as it was written:** the Phase 10b, 10c-1, 10c-2a and 10f sections of `MIGRATION-PLAN.md`, and `RELEASE-10F.md` (a report of what was true then).
- The ```` ```json ```` fence around the example in `SHAREPOINT-DEPLOYMENT.md` and the support-contact step of RUNBOOK.md names the language of the content, which is still JSON; the file is `.txt`.

## 9. What I found different from the brief, or did not expect

- **The order of B.** The brief runs the package and then changes the runbook. The runbook is generated from `scripts/release-docs.js` and a package can only be made from a committed tree, so
  the generator was changed and committed, and the package was made from that commit. The package is `pms-969bf16`, from B, as `pms-50ae628` was from 10f's D.
- **The participant page grew, so Phase 10f's check had to change.** It compared the build with figures that were true when 10f ended (allowance 0). With a phase that may add 100 B it
  failed at +8 B, so it became a recorded-numbers check, and `PHASE_10G` holds the build now. I did not raise a budget.
- **The brief counts about 37 files that spell the name.** 33 of them are in A, which also renames the example file and touches `bundle-budget.js` (35 in all); `AGENTS.md`,
  `MIGRATION-PLAN.md` and `SHAREPOINT-DEPLOYMENT.md` are C's; `RELEASE-10F.md` is a report of what was true then, and is untouched.
- **`sharepoint` as a spec pattern** matches every `*-sharepoint.spec.ts`, so the named run covered many more specs than five (159 tests in three engines).
- **The runbook's last line and "what is not proven"** said nothing had run on a real site, which stopped being true on 14 Oct; they say what was seen.
- **A pre-existing failure:** `npm run test:styleguide` fails "Setup's pieces (Phase 10b)" at `98c9e03` as well. Phase 10c-3 numbered Setup's headings ("1. This copy of the app") and that test
  still looks for the exact old words. Not part of any gate in AGENTS.md and not touched; a separate task has been suggested.
- No request baseline moved, and nothing in the lists, the counting or the requests a page sends changed.

## 10. What only the real site can show

QA-TESTING.md has the list; for this phase:

1. **That a page's own request is handed `pms-config.txt` with a success status and its text.** The site shows the text in a browser address bar; step 3 of the runbook (Setup's "This copy of
   the app") is where a page proves it.
2. **That a missing `pms-config.txt` comes back as a 404** (item 138). If this site answers a missing `.txt` with its "File Not Found" page and a 200, as it did for the `.json`, a page then
   stops with `PMS-CFG-002 page 200` and a value built into the page can never be the fallback on that site.
3. Everything after the settings file: the hand-built lists against Setup's strict check, Create's column definitions, the uploads to `PMSClientImages`, the permissions, Go live, and one
   activity on an iPad (items 102 to 137).
