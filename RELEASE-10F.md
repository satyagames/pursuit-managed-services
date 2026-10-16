# Phase 10f: sample clients with real pictures, Design-Docs removed, and the package for the new site

Date: 14 Oct 2026. Branch `pms-redesign`, on top of `7347c72` (Phase 10c-3). Nothing was pushed; `main` and the tag `legacy-final` (`2ad1520`) are untouched.
This report is at the root because `Design-Docs/` is gone.

**In plain words.** The package VJR's colleague uploads is ready: `build-svelte/package/pms-50ae628/` and `pms-50ae628.zip` beside it (git-ignored), with a runbook of fifteen steps for
`https://internal.global.deloitteonline.com/sites/PCOE`, folder `Shared Documents/PMS`. The pages carry no address: each works out its site from where it is
opened and reads `pms-config.json` beside it. Kroger and Domino's now have their logos, a hero and a background each (VJR's six pictures, stored exactly as Brand
Studio stores them), and Setup's **Seed sample clients** puts those pictures in the picture library before it makes the clients. `Design-Docs/` is deleted. The
runbook was rehearsed on the mocked SharePoint with the package's own pages, twice, in three browser engines. **Everything ran against the local Express server and
the mocked SharePoint REST. Nothing has run on the real tenant or a real device**: the runbook's last line says so, and QA-TESTING.md items 102 to 137 are what
only the real site can show.

## 1. The commits

| Part | Commit | Message |
|---|---|---|
| A | `5b468a7` | Phase 10f: Design-Docs removed |
| B | `39b17ee` | Phase 10f: sample clients with VJR's pictures |
| C | `f797767` | Phase 10f: release package and runbook for the new site |
| D | `50ae628` | Phase 10f: the runbook rehearsed on the mock |
| E | (this commit) | Phase 10f: proof and report |

`git status` after E: nothing tracked is changed. The untracked brand, Unity and `.claude/` files, and `.local/`, are where they were, never added. Part B was amended before Part
C was made (the two WebKit-only test fixes its full browser run found, see 4.4, then its message); no other commit was changed after it was made.

## 2. Part A: Design-Docs removed

**Nothing was moved first.** Every file outside `Design-Docs/` that named it did so in a comment or a link: `scripts/build-third-party-notices.js` and its test
(a comment naming REVIEW-9A.md, and a list of dependencies written out in the test itself), `scripts/bundle-budget.js`, `scripts/test-participant-storage.js`,
`public/js/dataService.js` and `migration/src/lib/sample-clients.js` (comments), and the root documents. No code, test, build or notice script read a file there;
the licence texts the notices use are in `migration/src/assets/`. The device test sheet (`references/DEVICE-TEST-SHEET.md`) was the one file I weighed keeping: it
describes the old site's `p_cec_02` folder and the legacy Check Lists in admin, so it was not kept; RUNBOOK.md replaces it for the new site.

**Removed:** 42 files, **10,799,743 bytes** (git's sizes): the design guide (HTML, Markdown, PDF), the low- and high-fidelity wireframes (PDFs, HTML, JS, 15
previews), `generate-pdfs.mjs`, `validation.json`, and `references/` (ARCHITECTURE-10, CLEAN-BREAK-10C1 and its baselines, CLEANUP-INVENTORY-10, DEVICE-TEST-SHEET,
DROPS-10C2A and its baselines and inventory, FIX-ASSIGN-REPORT, Flow-1-overview.png, the 3.2 MB mockup PDF, PMS-IMPLEMENTATION-PLAN, PROVISION-10C3, REVIEW-9A,
SAMPLE-CLIENT-CONTENT, SCHEMA-10C2B). The list with sizes is `test-results/phase-10f/A-removed-files.txt` on this Mac.

**Links and mentions:** 72 lines in 31 files (the root documents, AGENTS.md, Prompt_Lib/README.md and code comments) now say "in git history at `7347c72`" (AGENTS.md says how: `git show 7347c72:Design-Docs/references/<name>`).
SHAREPOINT-LISTS.md was regenerated. One test name (`test-setup-deployment.js`, not a recorded suite) carries the note.

**Proof that no page changed:** the three pages built at `5b468a7` against those built at `7347c72`: `index.html` and `admin.html` byte for byte the same,
`setup.html` different only in its build name. The node gates were green at `5b468a7` (4.1); the browser suite was not run for A, since its pages are those bytes.

## 3. Part B: the sample clients' pictures

### 3.1 The six pictures, as stored

Made by Brand Studio itself: `scripts/build-sample-pictures.js` builds the admin page, opens Brand Studio for each client in Chromium against a scratch local
server, chooses each of VJR's files for its slot, accepts the crop as it starts ("Use this picture") and saves; the files Brand Studio uploaded are the result.
`node scripts/build-sample-pictures.js --check` made them a second time: **byte for byte the same six** (Chromium 156.0.8078.4).

| Client | Slot | Stored as | Format | Bytes | Pixels | What Brand Studio said |
|---|---|---|---|---:|---|---|
| Kroger | hero | `kroger-hero-c17035ae16.webp` | WebP | 185,880 | 1200 x 1200 | |
| Kroger | logo | `kroger-logo-f14687c2a8.webp` | WebP | 23,658 | 800 x 400 | |
| Kroger | background | `kroger-background-e3df73ce01.webp` | WebP | 74,260 | 1536 x 2048 | enlarged from 1200 x 1600, "may look a little soft" |
| Domino's | hero | `dominos-hero-c2e5b9ab7e.webp` | WebP | 50,620 | 1200 x 1200 | |
| Domino's | logo | `dominos-logo-a336759dd8.webp` | WebP | 14,894 | 800 x 400 | |
| Domino's | background | `dominos-background-abf6eacaac.jpg` | **JPEG** | 328,388 | **1152 x 1536** | enlarged, and "To stay under 350 KB the picture is 1152 x 1536 px" |
| | | | | **677,700** | | |

**The gingham is a JPEG, not a WebP**, and at 75% of the slot's size: Brand Studio tries WebP first at every size, and the fabric's twill texture did not fit 350 KB
as WebP even at the lowest quality and the smallest size it allows (75% of the width); JPEG at that size did. That is exactly what an admin uploading it would get,
so it was not hand-tuned. The two backgrounds were supplied at 1200 x 1600 and are enlarged 1.28 times to the 1536 x 2048 slot (Brand Studio warns, and accepts).
The focal point is 50/50 (what Brand Studio stores when nobody moves it) and both logos sit on the light plate. **The heroes are JPEGs with a light grey ground, so
on Welcome they show as squares, not round badges**: a PNG with a transparent background would look like a badge (a choice for VJR, not a defect).

### 3.2 Where they are

- `migration/src/assets/sample-pictures/` holds the six; **only Setup carries them** (`src/setup/sample-picture-data.ts` imports each by name, never a glob).
  `migration/src/lib/sample-pictures.js` lists their names, types, sizes and pixel sizes (generated).
- The local server's uploads (`public/assets/images/clients/`) hold the same bytes and `server/data/clients.json` points at them (`/assets/images/clients/<name>`),
  so `npm run dev` shows them. Two copies, on purpose: a developer who replaces a sample picture in Brand Studio locally deletes the uploads copy, and the build
  must not break because of that. `scripts/test-sample-pictures.js` holds the two copies, the list and the names equal.
- The participant and admin pages carry none of it; they load a client's pictures from the library like any client's (`npm run test:bundle` checks the bytes,
  the names and the modules).

### 3.3 Seed sample clients

`migration/src/lib/sample-seed.js` (Setup's alone): for each sample client whose theme it writes (one that does not exist, or one whose theme is empty), **one GET
of the library's files**, then each picture not already there through the data layer's own `uploadClientAsset` (as Brand Studio's save), then the clients with
the addresses in their theme (and the focal point) and the logo in `LogoUrl`. A client that exists gets nothing, pictures included, so **a second run uploads and
writes nothing**. A failed upload stops it before any client is written; running it again sends no file twice. On the local server there is no listing: a file is
written again under its own name, the same bytes. Setup's status line adds "Pictures: 6 uploaded, 0 already in the library." On the mocked SharePoint, a first
seed on an empty site is the 76 records it always was, plus 1 listing, 1 folder read and 6 uploads.

**A judgement call:** a site that already has the sample clients (seeded before this phase) is left as it is, so it does not get the pictures: the seed's first
rule is that nothing an admin may have edited is changed. On the new site the clients do not exist yet. If VJR wants existing sample clients to gain the pictures,
that is a change to that rule.

### 3.4 Tests, red first

The new tests failed on the old behaviour before anything was implemented (`test-results/phase-10f/B-red-seed.log`: 7 failing with a stand-in for Setup's old seed
and the old `server/data`; `B-red-bundle.log`: the Setup page without the pictures). `scripts/test-sample-pictures.js` (15 tests, a recorded suite, its baseline
recorded with `--write` and run again on `Test` lists by the namespace suite), `test:bundle` (`PHASE_10F` and the pictures in Setup alone), and
`sample-pictures.spec.ts` (local and fake; participant Welcome, Brand Studio's three cards, Today's readiness). Tests that assumed the sample clients had no
pictures now say what holds (`test-review-9b.js` SAM-1: the logo is VJR's file, not a drawing; `test-brand-storage.js`; `test-seeds.js`; `brand-studio.spec.ts`,
nine tests; `setup.spec.ts`; `brand-smoke.spec.ts`). One of them was a race the empty slot had hidden (the crop test read the card's picture before the new one
replaced the saved one). The browser tests' scratch servers start with the six pictures in their uploads, as the real local server's uploads hold them.

## 4. Part C: the release package

### 4.1 The package

**`build-svelte/package/pms-50ae628/`**, made from `50ae628` (Part D: the last commit that changes the pages or the runbook; Part E adds two tests and documents).
**`pms-50ae628.zip`: 1,532,343 B, SHA-256 `838b972e6575890dc568ad9a2e7e7081b07baa079ad865bd3c8e6eea7df4e8ac`.**

| File | Bytes | gzip -9 | SHA-256 |
|---|---:|---:|---|
| `index.html` | 368,931 | 155,309 | `5685d5e9ba75b8556aee57e50f2baa204cc75b6ec304f2ad707235d03650c0f6` |
| `admin.html` | 1,666,056 | 605,055 | `2594a93a81c4cfa8faca787302b79837f040441ef5811b497dc4023eca2b6ceb` |
| `setup.html` | 1,122,117 | 757,207 | `4f1468ec61c5f4e5db565fd80d66fb30ab794ed836626d70e4675782294d1917` |
| `pms-config.json` | 54 | | `04426124f56abad3973d69fb4a8608e673d86745419bf1cc41c5a70441cc607f` |
| `THIRD-PARTY-NOTICES.txt` | 43,737 | | `ef3e34fe640c11a126469c0a8e08af7d604c3b34a1a04a6e1e045af7391b528a` |
| `RELEASE-NOTES.md` | 3,160 | | `a627e3d3842b0d0d637e500cfc74ae77b0d407179933feec4b91c0716f7687e5` |
| `RUNBOOK.md` | 15,007 | | `cca790c4f992029eafd3bdfb8b8b5113c0f6efde2adb27bf81d828eb0ba8a4d8` |
| `SHA256SUMS.txt` | | | the seven lines above, as `shasum -a 256` writes them |

Only the four files of step 2 are uploaded (`index.html`, `admin.html`, `setup.html`, `pms-config.json`). An earlier package of Part C, `pms-f797767`, has the
same `index.html` and `admin.html`, an older runbook and a `setup.html` that differs only in its build name; use `pms-50ae628`.

`npm run package:release` made it from a clean, committed tree, in a fresh worktree of the commit (so its pages are what a fresh clone builds: no carriage returns
from this Mac's CRLF shells), with no `PMS_` value set. `pms-config.json` is exactly `{"configVersion": 1, "listPrefix": "", "label": "PMS"}`.

**Proved by the script** (it stops otherwise): no page holds a site address (`deloitteonline.com`, `sharepoint.com`, `/sites/PCOE`, `PCOE`), a folder name
(`Shared Documents`, `Shared%20Documents`, `/PMS/`, `staging-test`), `p_cec_`, `CreativeExpCOE`, a PIN hash (any 64 hex digits in a row, the demo PIN's hash
included) or the demo PIN (`1234` not inside a longer run of digits); the bytes a page carries as base64 (pictures, fonts) are not read as words, since random
base64 holds "1234" by chance. `shasum -a 256 -c SHA256SUMS.txt` passes in the folder (7 OK) and in a fresh unzip of the zip (7 OK), which holds exactly the
folder's 8 files. `scripts/test-release-docs.js` shows each proof can fail.

**The proof found something real:** the first build of Setup held the six pictures' full SHA-256 (the list of pictures carried them). They are not PIN hashes,
but the rule that a page holds no 64-hex string is the right one, so the list now holds the name only (which ends with the hash's first 10 digits).

### 4.2 RUNBOOK.md and RELEASE-NOTES.md

Both are written by `scripts/release-docs.js` (and held by `scripts/test-release-docs.js`). RUNBOOK.md: the addresses; fifteen numbered steps with a line under
each for what to send back (checksums; upload the four files; This copy of the app; Show the plan; Create only if it lists something; Check Lists until Ready;
Mark the site as ready; Add an admin, no demo PIN; Seed sample clients; permissions; optionally a support contact, with the exact JSON; Go live; one iPad; Results;
remove or restrict setup.html); what to send back (screenshots at 3, 4, 6, 7, 12, 13 and 14 and any page showing a code with its Details line); what the codes mean;
the printed QR codes; which QA item each step answers (102 to 137, and the eight no step reaches, with what shows them later); and the last line, "Nothing here has
run on a real SharePoint site before." RELEASE-NOTES.md: what it is, the commit, each file with its checksum, what changed since the 9c package (the new site, the
`PMS` lists, Setup prepares the site, one app, the sample pictures) and what is not proven.

### 4.3 The permissions table

Worked out from `pms-schema-meta.js`'s readers and writers by `scripts/permissions.js`; the same table is in RUNBOOK.md step 10 and SHAREPOINT-LISTS.md,
"Permissions". **META agrees with VJR's three groups**; the one change it needed was the picture library's own line: Setup now reads it and writes to it (the seed),
which META did not say (changed in Part B).

| List | Participant accounts (the iPads) | Facilitators (admin.html) |
|---|---|---|
| PMSClients | Read | Contribute |
| PMSClientSessions | **Contribute** | Contribute |
| PMSActivities | Read | Contribute |
| PMSActivityQuestions | Read | Contribute |
| PMSAnswerOptions | Read | Contribute |
| PMSParticipants | **Contribute** | Contribute |
| PMSGuestQRCodes | **Contribute** | Contribute |
| PMSAppSettings | Read | Contribute |
| PMSGuestList | Read | Contribute |
| PMSVisitLog | **Contribute** | Read |
| PMSAdminUsers | **No access** | Read |
| PMSParticipantAnswers | **Contribute** | Contribute |
| PMSClientImages | Read | Contribute (add and recycle files) |

Setup is run by a site owner (Full Control). Two things for VJR to know: SharePoint has no "write but not read", so participant accounts can read the five lists
they write (PMSVisitLog included, which the page itself never reads); and a facilitator who also opens the participant page needs the participant rights too.

### 4.4 Part B's full browser run, and the two WebKit fixes

Part B's commit ran the whole browser suite: 1,091 passed, 26 skipped, **2 failed, both WebKit**: the Brand Studio smoke test expected "Not set" after Safari refuses
a photograph (Kroger now has a saved hero, so "Saved" is right), and the new fake test of Setup's upload, where **Playwright's WebKit hands a route an empty body
for a Blob upload** (a diagnostic run showed all six stored with 0 bytes; the project already knew it, `brand-smoke.spec.ts` says so). The fix, amended into Part B
before Part C: the smoke test expects "Saved"; the fake test is two tests, Setup's upload checked byte for byte (Chromium and Firefox; WebKit excluded with its reason
in `playwright.config.ts`, as the project's rule asks) and a participant reading the pictures from the library seeded from the test's own process (all three
engines). The changed specs then passed in all three engines (17 of 17).

## 5. Part D: the runbook rehearsed on the mock

`npm run test:rehearsal` runs steps 3 to 14 with the **package's own pages and its pms-config.json**, served at
`https://internal.global.deloitteonline.com/sites/PCOE/Shared%20Documents/PMS/`, in Chromium, WebKit and Firefox. **With `pms-50ae628`: 6 passed** (two sites in each of three engines), 57.5 s; a
screenshot of every step that asks for one is in `test-results/rehearsal/` on this Mac (51). (The rehearsal was first made with Part C's `pms-f797767`.)

| | An empty site | A hand-built site with `Session_x0020_Id` beside a missing `SessionId` |
|---|---|---|
| Before Setup | | `index.html`: "This page cannot start", PMS-LST-010 |
| 3 This copy of the app | site "(from this page's address)", lists "(no prefix from pms-config.json)", label PMS, build = the package's name | the same |
| 4 Show the plan | "13 lists, 89 columns, 47 settings to create." | "Nothing to create. 1 thing Setup will not touch needs fixing by hand (below).": "A column called "Session Id" has the internal name Session_x0020_Id; the app looks for SessionId." with the fix |
| Mark the site as ready, too early | | refused: "Not marked ready: the check found 1 problem."; no version written |
| (the fix) | | the column deleted, as the runbook says; the plan: "0 lists, 1 column, 1 setting to create." |
| 5 Create (confirmed) | "Created 13 lists, 89 columns and 47 settings in ... s (149 writes)." and marked ready by itself | "Created 0 lists, 1 column and 1 setting in ... s (2 writes)." and marked ready |
| 6 Check Lists | "All list schemas ready." | the same |
| 7 Mark the site as ready | "The site was already marked ready (version 2). Nothing was written." | (done by Create) |
| 8 Add an admin | "Admins on this site: Asha Rao." | the same |
| 9 Seed sample clients | "Complete: 76 created, 0 completed, 0 already present. Pictures: 6 uploaded, 0 already in the library." | the same |
| 11 Support contact | the runbook's JSON accepted; Setup shows it | the same |
| 12 Go live | no logo warning (one expected warning: Staff mode); "Verified: participants now see Kroger"; participant link = the folder's `index.html`, with its QR | the same |
| 13 An iPad (820 x 1180) | Kroger's hero and background loaded from `/sites/PCOE/PMSClientImages/`; Kroger's History "5 of 5 right on the first try" | the same |
| 14 Results | today's session: "Casey Example" (the iPad's sign-in), "5 of 6 questions answered" | the same |

**Not rehearsable on the mock:** step 1 (the package script does it, in the folder and a fresh unzip), step 2 (upload), **step 10 (the mock has no permissions)**
and step 15. In WebKit the six uploads reach the mock empty (above): the rehearsal checks the names and puts the committed bytes in their place for steps 13 and 14;
Chromium and Firefox check every byte.

**Where the runbook and the pages disagreed, the runbook was fixed** (Part D): step 3 names the panel's rows as the page shows them; step 5 says Create asks to be
confirmed and how it ends; step 6 gives the expected line; step 7 says what the button says after a clean Create (already marked ready) and on a refusal; step 12
names the expected "Staff mode" warning and the participant link; step 14 says how the participant is named; "Details line" (the stop screen's line is not folded);
steps 10 to 15 are indented under their numbers, so the table and the JSON stay inside them. **Found in the pages, left:** the plan says "0 lists, 1 column, 1
setting to create." (it counts lists even when there are none).

## 6. Gates, before and after

| Gate | Before (`7347c72`, a fresh worktree) | After (the code at `50ae628`, a fresh worktree; E's two tests in this checkout) |
|---|---|---|
| `npm run check:svelte` | 408 files, 0 errors, 0 warnings | 411 files, 0 errors, 0 warnings |
| `npm test` | 1,026 pass | 1,058 pass at E. (At `50ae628`: 1,057 and 1 fail, my own test from C that read `build-svelte/release`, which in the worktree was a build left from Part B, made before the full hashes were dropped. A test must not depend on a leftover build: E moved that proof into `test:bundle`, which builds the pages fresh.) |
| `npm run test:baseline` | 35 pass | 36 pass (the new suite) |
| `npm run test:bundle` | 25 pass | 28 pass at E (27 at `50ae628`): `PHASE_10F`, the pictures in Setup alone, and every built page held to the package's proofs |
| `npm run test:migration` | 1,107 tests: 1,081 passed, 26 skipped, 0 failed (Chromium 412, WebKit 317 + 13 skipped, Firefox 352 + 13 skipped), 35.7 min | **1,121 tests: 1,095 passed, 26 skipped (the same 26), 0 failed** (Chromium 417, WebKit 321 + 13 skipped, Firefox 357 + 13 skipped), 36.0 min; the 14 more are `sample-pictures.spec.ts` (5, 4 and 5) |
| `npm run test:report:mutations` | 34 of 34 caught | 34 of 34 caught |
| `npm run oracle -- --seeds 500` | 0 differences (5,620 participants) | 0 differences (5,620 participants) |
| `npm run test:rehearsal` | (did not exist) | 6 passed with `pms-50ae628` |

Each part's own gates: A's node gates and the build comparison at `5b468a7`; B's node gates and full browser suite at its first commit (two WebKit failures, fixed
and amended, 4.4); C's and D's node gates and the specs they touch. Logs are in `test-results/phase-10f/` on this Mac (git-ignored).

The oracle (500 sessions, 5,620 participants, four time zones: 0 differences) and the mutations (34 of 34) are unchanged: no counting rule was touched.

**Request baselines:** one new suite, `test-sample-pictures`, recorded with `--write` once green (`RECORDED_LATER`; 29 entries, run a second time on `Test` lists).
No existing baseline was regenerated or amended: every existing suite sends exactly what it sent. The fake gained one answer (the library's files), which no
existing suite asks for.

## 7. Page sizes (gzip -9)

| Page | Before (7347c72) | After | Budget |
|---|---|---|---|
| participant | 155,320 B (155,309 in a fresh checkout) | **155,320 B** (155,309 in the package): unchanged | `PHASE_10F`: allowance 0; ceiling 450,000 |
| admin | 605,064 B (605,055 fresh) | **605,064 B** (605,055 in the package): unchanged | `PHASE_10F`: allowance 0; budget 700,000 |
| setup | 71,909 B (71,879 fresh) | **757,231 B** (757,207 in the package), raw 1,122,117 B | none; the six pictures (677,700 B) at most 1,000,000 B |

**Setup grew by what the pictures weigh** (they are already compressed, so gzip gains almost nothing on them; as base64 inside the page they add a third raw).
It is under the brief's "about 1 MB", so the pictures were not moved out to files beside the pages. The participant and admin pages are unchanged to the byte.

## 8. What I found different from the brief, or did not expect

1. **Design-Docs held nothing the build, tests or notices need**, so nothing was moved (the brief expected there might be a licence text).
2. **The gingham ended as a JPEG at 1152 x 1536**, not a WebP: that is Brand Studio's own answer for it (3.1).
3. **The six files are in two places** (Setup's copy and the local server's uploads), so local Brand Studio use cannot break the build (3.2).
4. **The package's proof caught the pictures' full hashes in Setup** (4.1), and **Playwright's WebKit stores a Blob upload empty** (4.4, 5): neither is a page
   fault, both are handled and said where they are.
5. **A site already seeded keeps sample clients without pictures** (3.3), by the seed's first rule.
6. **THIRD-PARTY-NOTICES.txt does not list the six pictures.** They are content, not code: the logos are the clients' trademarks, supplied by VJR for this internal
   app, and the heroes and backgrounds are VJR's (their source is not recorded here). Whoever owns licence compliance should confirm their use.
7. **The heroes are square JPEGs on a light grey ground** (3.1).
8. **A test of mine in Part C read a leftover build** (`build-svelte/release`) and failed in the final run on a build from an older commit; the proof now runs in
   `test:bundle` on pages it builds itself (Part E).
9. **Small things left:** the plan's "0 lists"; Create's "1 of 1 columns" progress line (from 10c-3).

## 9. What only the real site can show

All UNPROVEN until the new site shows them; RUNBOOK.md says which step answers which, and QA-TESTING.md has the items:

- that the document library serves `pms-config.json` to a page (items 88, 93), and that "This copy of the app" names the site from the page's address (111);
- that VJR's hand-built lists pass Show the plan and the strict check (110, 114, 115, 116, 125, 129), and, if Create runs, that SharePoint accepts its definitions,
  honours internal names, takes the index and uniqueness, and how long it takes (118 to 124, 127, 128);
- the version item and the pages before and after Mark the site as ready (112, 126); Add an admin and that 1234 opens nothing (100, 130);
- **the six pictures in PMSClientImages**: the listing read, the uploads, a second press sending nothing (133), and the pages loading them with each account's own
  sign-in (132, 134);
- **the permissions of step 10**, above all that a participant account cannot read PMSAdminUsers and can still do everything a participant does (135);
- **the folder address in the participant link and the printed QR codes** (136);
- one activity end to end on an iPad, Results, and the two report downloads (137), and Go live naming the client (108);
- and everything later, with the site in use: 102 to 106, 109, 131.

Nothing here has run on a real SharePoint site before.
