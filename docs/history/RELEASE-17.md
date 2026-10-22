# Release 17: the data layer in parts, and the stylesheets' dead rules removed

Branch `pms-17`, from `pms-16` at `c7ad1f5` plus the hardening of 19 Oct 2026, which was uncommitted on `pms-16` and is this branch's first commit
(`362b095`: `npm audit` at zero through the `image-size` override, the Node guard in `build-svelte-release.js`, `.editorconfig`). **Not pushed.** A
refactor with no change of behaviour: no data, list, column, setting, request or word changed. Nothing of it has met the real site or an iPad:
QA-TESTING.md items 195 to 197.

**Done:** Part 1 (`dataService.js` cut into sixteen parts behind it, the flaky QR-scan test hardened) and Part 3 (dead CSS removed by measurement).
**Not done:** Part 2 (slimming `AdminToday.svelte`, `LiveDisplay.svelte` and `BrandStudio.svelte`, and un-exporting the exports that no other file
uses) was left for later by the owner, part way through `AdminToday.svelte`; its drafts are in git-ignored `build-svelte/p17-part2-wip/`, and nothing of
it is in the tree.

Commits, one cause each: `56b47ae` the surface test; `52a2e9b` the fresh-page hook; `a031b64` the source-reading tests read all of `lib/data`; `e808aad`,
`f50b0d9`, `299f9b0` steps 1 to 3 of the split (`encoding.js`, `core.js`, `common.js`); `8905cd0` the local server's Windows rename race; `1545e25`, `9a82d5f`, `2aac600` steps 4 to 6 (`schema-check.js`, `records.js`,
`today.js`); `2e05f92` steps 7 to 15 together (see below); `dd4f708` step 16, the facade and
`test-data-modules.js`; `a97cedf` the QR-scan test; `81159d7` the dead CSS; `44c0266` `PHASE_17`; `5901114` the documents; then this report. Each
commit passes `npm run check:svelte` and `npm test` on its own.

## Before and after

The "before" was frozen in git-ignored `build-svelte/baseline-17/` of a separate worktree of `362b095` (so the browser run never saw a change of this
phase): every gate's log, the three pages, their sha256 and gzip sizes, and the data service's surface (`dataService-surface.json`: 107 names, kind and
arity) with each name's importers (78 files). The "after" logs are in `build-svelte/after-17/` and `build-svelte/evidence-17/`.

| Gate | Before (`362b095`) | After (`pms-17`) |
|---|---|---|
| `npm run doctor` | all good (Node 22.23.3 from `.local/node22`, Vite 8.3.4, Playwright 1.64.0, ports free) | |
| `npm run check:svelte` | 0 errors, 0 warnings | 0 errors, 0 warnings |
| `npm test` | 1,460 pass (one run of two had 1 failure: the known race below) | 1,476 pass (new: `test-data-surface.js` 3, `test-data-modules.js` 8, `test-store.js` 3, `PHASE_17` 1, the rounds' control 1) |
| `npm run test:baseline` | 38 pass | 38 pass: **every baseline unchanged**, never re-recorded or amended |
| `npm run test:bundle` | 41 pass | 42 pass (`PHASE_17`, allowance 0) |
| `npm run test:report`, `test:report:mutations` | 150 pass, 64 of 64 caught | 150 pass, 64 of 64 caught |
| `npm run oracle -- --seeds 500` | 0 differences | 0 differences |
| `npm run test:charts` | 57 pass | 57 pass |
| `npm run test:local-site` | (see the package) | (see the package) |
| `npm run test:migration` (Chromium, WebKit) | 880 passed, 23 failed, 16 skipped (44.6 min) | 881 passed, 22 failed, 16 skipped (44.4 min) |

The 22 failures after are exactly 22 of the 23 before (the same test names): this machine's known ones (docs/TESTING.md), the WebKit faults of
`effects-audio.spec.ts`, `brand-smoke.spec.ts`, the `flow.spec.ts` header test and one `keyboard.spec.ts` test, and the known flakes. The 23rd before, WebKit
`content-edit-in-place.spec.ts:91`, passed after. **Firefox was not exercised**: it does not start on this machine (`spawn UNKNOWN`).

**Sizes (gzip -9, as `npm run test:bundle` measures).** Participant 159,093 → **158,392 B** (−701); admin 576,279 → **576,093 B** (−186); Setup 789,238
→ **788,923 B** (−315). The split alone cost the participant page 40 B gzip (22 B raw; −1 B by the `gzip -9` command): the bundler lays the same code out
in another order, and `core.js`'s `holdScan()` is new. The dead CSS took 741 B off it. `PHASE_17` holds both pages to where Phase 16 left them with
an allowance of 0; the ceiling (450,000 B) and the Tailwind rules are unchanged.

## Part 1: `dataService.js` in parts, behind the same door

| Section of the old file (2,845 lines) | Part now | Lines |
|---|---|---:|
| The top, 1 (helpers with no state), 6 (`chunked`, `distinct`, `READ_CHUNK`) | `encoding.js` | 77 |
| 1. Backend adapter, with all of the state; `spBatch`, `spReadTogether` (4), `spReadOrBatch` (8), `spRefs` (3), `logoFolders` (7) | `core.js` | 556 |
| Shared reads and pacing: `spOne`, `spWrite` (4), `spItemsAddress`, `localFilter` (5), `spAllRows` (8), `runPaced` (6) | `common.js` | 89 |
| 1, its end: the schema check | `schema-check.js` | 107 |
| 2. The records | `records.js` | 335 |
| 3. Today's client, and `noteTrackResumed` | `today.js` | 197 |
| 3. Answers, one item per participant | `responses.js` | 346 |
| 3. Setup's probe, request and self-test | `self-test.js` | 141 |
| 4. A first QR scan, a visit begun from Welcome | `qr-scan.js` | 313 |
| 5. The admin's Today and Clients | `today-clients.js` | 81 |
| 6. Content per client, copying activities | `content-copy.js` | 317 |
| 6. Guests in bulk | `guests.js` | 105 |
| 7. Pictures | `pictures.js` | 108 |
| 8. Pages that stay open | `watch.js` | 115 |
| 9. Removing a visit, deleting by key | `removal.js` | 74 |
| 10. Which lists are this copy's | `list-titles.js` | 21 |
| The door: header and 16 `export { } from` lists, 107 names | `dataService.js` | 97 |

**Moved, not rewritten.** A script cut each top-level declaration out of the old file with the comments above it and on its last line and pasted it,
byte for byte, into its part; only import lines, the part's header, an `export { }` list of the names other parts use, and the facade were written new.
A second script compares all 223 declarations of the old file with the new parts at every step: **223 of 223 the same, but five lines**, all in
`openQrScan`, whose writes of `unfinishedScan` (`unfinishedScan = x;`) became `holdScan(x);`: another module cannot assign an imported binding, and that
state had to stay with the rest in `core.js`, where `configure()` forgets it. Every banner, narrative and JSDoc line of the old file is in a part.
No importer changed a line (39 files of the app, 70 scripts).

**What could not work through the facade, and what was done.** (1) 23 suites open a "fresh page" by importing `dataService.js?page=N`; Node gives
each address its own module, but the facade's imports of its parts carry no query, so every page would have shared one `core.js`.
`scripts/fresh-page.js` (an in-thread resolve hook, `module.registerHooks`) hands the query on to the parts; each of those files gained one import
line. With the loader-thread hook (`module.register`) `test-participant-waits.js` cancelled 15 tests, because an import inside a moment it measures
took more turns of the event loop than it allows: the in-thread hook adds none. (2) Five suites read the data layer's source as text; each now reads
all of it (`scripts/data-layer-source.js`) or skips all of it, and `test-settings-file.js` names `core.js` as the file that fetches and reads the old
globals: paths, never assertions. (3) `test-schema.js` holds every part to the no-hand-kept-table rule `dataService.js` was held to (stricter).

**Steps 7 to 15 are one commit** because the participant page's gzip size moves with the order the bundler lays the parts out: measured at each step
it was 159,204, 159,194, 159,180, 159,166, 159,168, 159,180, 159,175 and 159,221 B (over Phase 16's allowance at steps 7 to 14), and 159,134 B with
all nine out. Each of steps 1 to 6 and 16 is its own commit.

**The built pages, compared.** Built from `362b095` and from `a97cedf` (Part 1 alone) without minifying, the bundler's per-module regions: **every
module outside `lib/data` is byte for byte the same** on the participant page (123 modules) and the admin page (218). The data layer's 223 top-level
statements match one for one but five: `openQrScan` and the new `holdScan` (as above), and `READ_CHUNK`, which the bundler now writes as `20` at its
three uses (`getSectionQuestions`, `readActivityContent`, `readLiveFeed`) and drops, since it is a constant exported from another module. So the
Part-1-only participant page is the old one in another order, with that constant inlined and `holdScan`.

**The flaky QR-scan test.** `test-participant-storage.js` held a first scan's rounds by position (`sent[3]`, `sent.slice(4, 7)`). `roundsOf()` reads
them from what each request waits for (round 1 everything before the `$batch`, round 4 the writes that need the new track), with every count, kind
and round as before and a new check that each such write follows the track; a new test shows an interleaving the slices refused and the rounds accept.
**It could not be made to fail here:** 0 of 30 runs with the fake's answers delayed 0 to 15 ms at random, 20 of them beside a busy process on each of
32 cores. These requests are sent in microtask order, not by timing. The one clock-dependent assertion of that describe is Retry-After's
(`fake.requests[at + 1].at - fake.requests[at].at >= 1000`, by `Date.now`), which a timer firing a millisecond early could fail; left as it is.

**Found on the way, and fixed: the local server's Windows race.** `server/store.js` renames a temporary file over a list's file; Windows refuses a
rename over a file that is open, and every read of a list opens it (279 of 300 renames failed on this machine with four readers running). A write
that met a read of the same list was a 500 that SharePoint never gives. `test-sessions.js`'s six simultaneous scans met it 0 of 25 runs before the
split and 6 of 15 at step 4, **with the very same 380 requests** (logged and compared): only their timing had shifted. The rename is now tried again
every 5 ms for up to two seconds (`8905cd0`, `scripts/test-store.js`, which failed before); the local server is the test stand-in, in no page.

**Also seen:** `test-effects.js` scans the source folders while `test-motion-switch.js` writes a temporary copy of a module into one of them: a run
of `npm test` now and then fails with ENOENT on `.client-theme.pms14.tmp.js` (once on the untouched tree, twice during this phase). And once a local
server a suite spawned "exited early" under load. Neither is a change of this phase.

## Part 3: dead CSS, by measurement

72 of the 381 selectors of `src/admin.css`, `styles/legacy/admin.css` and `styles/legacy/app.css` were removed: the legacy app's results screen,
agenda, question form, option lists, thank-you screen and brand header, the legacy admin's tally rows, QR list, logo editor and dialog form, and their
copies. The evidence for each, and why `styles/legacy/` keeps its name, is in CLEANUP-LOG.md ("Phase 17"). In short: no token of the source names it
(comments and style blocks left out; classes built from pieces counted), it is in the DOM of none of the 955 screens and states the local site's
harness photographs at the seven sizes of `devices.spec.ts`, and no document or test names it as a contract (`.divider` stays: RULES.md names it).

**The screenshots, before and after.** The whole matrix photographed from the package before (`pms-362b095`) and after (`pms-81159d7`, the CSS commit),
958 pictures, compared file by file and pixel by pixel:

| Flow | Same | Different | Why the different ones differ |
|---|---:|---:|---|
| admin, admin states, brand | 195 | 0 | |
| participant guest, keyboard, states, tiles | 168 | 0 | |
| participant | 217 | 56 | confetti: two runs of the *before* package differ on exactly the same 56 pictures |
| Live display | 119 | 1 | a chart tooltip's moment: two before runs also differed there |
| Brand Studio | 26 | 59 (5 missing) | its crop flow picks sample pictures at random: two before runs differed on 60 (6 missing) |
| Setup | 0 | 37 | the build name it prints (`pms-362b095` against `pms-81159d7`), a box of about 60 by 13 px, the same place on each |

No pixel moved because of the removed rules.

## Rules held, and what was not done

- No dependency added (madge, which the prompt names, is not one: `test-data-modules.js` has its own cycle check, zero cycles before and after).
- `test:baseline` never re-recorded or amended; no test that guards behaviour loosened or deleted; each new test written first and seen to fail
  (`test-data-modules.js` 5 of 8 before the split; `test-store.js` 2 of 3 before its fix; `test-release-docs.js` 3 of 15 before the documents).
- **Prompt assumptions that did not hold:** the participant page does not drop the admin-only data calls: it imports the data service as a whole
  (`import * as dataService`), so every one of the 107 names is in `index.html` today, as before the split (Phase 16 measured the same). Making
  that page leave them out would change what it carries, and is not a refactor of this phase.

## What only the real site can show

That the pages behave there as `pms-07eb42b`'s did, screen for screen, and that the first QR scan still costs 8 requests in a real browser on the
real site: QA-TESTING.md items 195 to 197 (a full pass on a test folder: the self-test, a QR join and a manual join, every kind of question, Results,
the Live display, every export, Brand Studio, Delete session; the network tab for the scan; then production and the push).

## The package

`pms-7417da3` (`build-svelte/package/pms-7417da3/`, `build-svelte/package/pms-7417da3.zip`), made by `npm run package:release` from the committed tree
in a fresh checkout of `7417da3` (the commit that added this report); `shasum -a 256 -c` passes in the folder (7 OK) and in a fresh unzip (7 OK), and
`sha256sum -c SHA256SUMS.txt` again by hand (7 OK); no page holds a site address, a folder name, a PIN hash, the demo PIN, `p_cec_` or `CreativeExpCOE`.
`npm run test:local-site` on it: 26 of 26 (26 before). RUNBOOK.md's note says this package changes nothing a person sees ("no data, list, setting or
behaviour changed, and the pages were rebuilt from the restructured source") and adds step 13 (QA 195 to 197); RELEASE-NOTES.md has what changed since
pms-07eb42b.

| File | Bytes | gzip -9 | SHA-256 |
|---|---:|---:|---|
| index.html | 377,583 | 158,392 | `1ed02967a5e1df6f9e515025a12962e870e2f58163887d4a76a9594f39af4ea2` |
| admin.html | 1,583,302 | 576,093 | `d0095fd80cb76ee0e95cd5cb9dece0ce5814ca49da6041302df8a1665e91bb9a` |
| setup.html | 1,172,703 | 788,919 | `0cf21480292b2f384798a4e2a567448e01bc2ccdd2db8feec99533f2d8aa62ce` |
| pms-config.txt | 54 | | `04426124f56abad3973d69fb4a8608e673d86745419bf1cc41c5a70441cc607f` |
| THIRD-PARTY-NOTICES.txt | 40,835 | | `e4ecfa86a85da94926f3f25b9f2b99791c38cc3ea100c5454bb333e620ec1eb4` |
| RELEASE-NOTES.md | 35,417 | | `35794eeb4d2ee4fcd2717a2097d70715dcac378ac80c38893376f8abd787db31` |
| RUNBOOK.md | 39,504 | | `4046d0cd3d753769b5a8295e4b467304e5e62876de9e4033e49311fbf52d16a2` |
| **pms-7417da3.zip** | 1,562,569 | | `02f7e0fac62f0e85070df06580d8cfe2f2a81576fc0e8d6547e7664d90e3b14d` |

The pages of this package are byte for byte those of the commit after it, which adds only this section.
