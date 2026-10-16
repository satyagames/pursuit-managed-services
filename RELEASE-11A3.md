# Phase 11a-3: the polish batch after the 11a-2 real-site checks

Branch `pms-11a3` (on GitHub, never merged into `main`), from `3a8b32b` ("pms-283ad18 as deployed (VJR's tree)"). Items A, D(3), E and F are fixed with tests written
first; D(1) is traced to the pictures, not the code; G is investigated; B, C and the greeting of D(2) need no change by VJR's decisions. Every gate of the brief's section 5
was run on this machine, before (`3a8b32b`) and after; what could not run here is said in section 4. **Nothing has met the real site, an iPad or a projector.**

## 0. Where this started

- VJR's files arrived without their git history: this repository has no `pms-redesign`, `283ad18`, `ecc58fb` or tag `legacy-final`, so the brief's step 0 could not be done as
  written. In its place: the folder, built with `PMS_BUILD_ID=pms-283ad18` and LF line endings, gives `index.html`, `admin.html` and `setup.html` **byte for byte** equal to the
  deployed package `pms-283ad18` (`707beef9…`, `bf5513fd…`, `e97f28a1…`), which passes its own `SHA256SUMS.txt` (zip `8119e28a…cb6f`, as in the handover). That tree is `3a8b32b`.
- **This Windows checkout, and what it needed** (none of it changes the app): `core.autocrlf` set to `input` and the working files rewritten LF as committed (a CRLF tree builds
  pages that differ from an LF build); the suites run with Node 22 directly (`npm` puts the system Node 20.13 first on the PATH, and under Node 20 a top-level `before` does not run
  before a `describe`'s tests, which cancelled whole suites); `@napi-rs/canvas-win32-x64-msvc@0.1.100` installed with `--no-save` (`node_modules` came from a Mac and had only the
  Mac binary, so pdf.js had no `DOMMatrix`: every PDF and oracle test failed); Playwright's three browsers installed. `test-named-reads.js` compared paths with `/` and failed on
  Windows, cancelling the namespace and request-baseline suites: fixed in `b1092a3`, a test-only change.

## 1. The items

| Item | Commit | What changed | Test first (failed on the old code) |
|---|---|---|---|
| A, tooltip | `79c5d11` | `placeTip()` (`lib/tip-place.js`) takes `avoid`: the card's words and buttons (`data-tip-avoid` in `ResultCard`: headline, question, "N answered" line, Show answer, View as table, captions). Above, or above moved along while it still spans its mark, then under, or under moved along; where neither side is clear, the place that covers the fewest of their pixels. Always whole, inside the window, clear of the mark and its own label. | 4 tests in `scripts/test-results-chart-fit.js` (3 failed). In Chromium, `results-charts-fit.spec.ts` "the admin view …" passes, and with A's four files put back it fails with 12 tooltips over the question, "N answered · N of 4 got it right first time" or View as table "although there was room under its mark": the real-site defect. Pictures `test-results/11a3/A-*`. |
| A2, tooltip over other bars' figures | `d12af50` | **Seen on PCOE with pms-618b8fc** (16 Oct 2026, Satyadev's photographs): in full screen a ranking's last bar ("Reduce cost") could not put its tooltip under it (the caption is there) and put it above, over the figures of the two bars above it. `placeTip` now also takes `soft` (the other marks' figures and label text, `data-tip-soft`), kept clear of after the card's words, and `span` (the mark's track), along which it may move. | 4 tests in `scripts/test-results-chart-fit.js` on the photograph's layout (2 failed). A spec points at every bar of VJR's ranking in full screen at 1536x864 and 1920x1080: on the old code "bar 5: the tooltip lies over 56, 31" (the photograph) and eight more; now none. Pictures `test-results/11a3/rank-*`. |
| B, name order | none | **No change, by VJR's decision D1 (16 Oct 2026):** names stay "Last, First" as the directory gives them, in Results, the charts, the report, the CSV and the greeting. | — |
| C, `/wall` header | none | **No change, by VJR's decision D2 (16 Oct 2026):** the wall page keeps the admin header, tabs, Lock and Export; Full screen is the projector view. | — |
| D(1), heroes | `b31c7fc` | **Not a code fault.** VJR's hero sources are JPEGs (no alpha), so the stored heroes are opaque squares; Brand Studio keeps a hero's transparency. `build:sample-pictures` takes `<client>-<slot>.png` when it is there. On PCOE a transparent PNG uploaded in Brand Studio fixes a hero with no new build. | None (tooling; the six pictures did not change). |
| D(2), greeting | none | No change (D1). | — |
| D(3), locked title | `e29d201`, `d6108d3` | A locked activity's title is white (`var(--text)`), as its caption and lock are; it was `--on-disabled` on `--disabled` (#4D80D0 on #034CB5, about 2:1). White has 4.5:1 or more on `--disabled` for every primary (6.05:1 at worst). `PHASE_11A3` holds the participant page. | `scripts/test-theme.js`: the rule and the contrast over 584 primaries (failed: no rule). |
| E, long answers in full screen | `613c8c5` | The fit step is `lib/present-fit.js`. Its floor is the factor that gives type 0.75; it was 0.5, so on a window 1,550 px wide or more the type stopped at 0.8 or above, neither smaller nor spilling, and the card was cut. At type 1.2 (an iPad upright, a phone) the steps are as they were. | `scripts/test-present-fit.js`, failed with a stand-in of the old floor. In Chromium the new spec passes (1920x600, 1600x700, 768x1024, 1080x1920) and with the old `LiveDisplay.svelte` fails: "1920x600, full screen, w1: the card's contents run 142px past its edge". Pictures `test-results/11a3/E-*` (cut after the fifth answer; all eight whole). **Whether this is what the real site showed is not known.** |
| F, the flake | `73f0b1b` | `lib/page-watch.ts` dropped an `online` that came while a look was on its way (and that look could have read the track before the test stamped the restart). Now it asks for one more look as soon as that one ends (never two at once; a `Retry-After` is still a floor). The test and its timeout are unchanged. | `scripts/test-page-watch.js` drives the real `page-watch.ts` (via Vite's esbuild): failed. `participant.spec.ts` passes in Chromium and WebKit. |
| G, the 403 | none | Investigated only; section 2. | — |

Also: the release documents (`8fe8bf1`: RUNBOOK.md's note for the PCOE site and "What changed since pms-283ad18" in RELEASE-NOTES.md, `scripts/test-release-docs.js` 15 of 15),
QA-TESTING.md items 161 to 166, VJR's decisions recorded (`9368ac9`), and the "Rules from Phase 11a-3" in AGENTS.md.

## 2. G: what the app does with a 403, and whether it can cause one

- **A write** (`spHttp`): a 403 whose words mention "security validation" or "request digest" gets a new write token and is tried once more; any other 403 is thrown as
  `SharePoint (403): <SharePoint's words>`, status 403.
- **A `$batch`** of reads (`spReadTogether`, `spReadOrBatch`): a 403 drops the write token and the same reads are made one by one; nothing is shown.
- **A plain read**: thrown as above. On a timer (the participant page's look, Content's and Guests' 15-second looks, the Live display) it is swallowed and the timer backs off; a
  403 is neither "signed out" (`lib/sign-in.js`) nor "unreachable", so the participant page shows nothing for it. The settings file answered 403 is `PMS-CFG-002`, `status 403`.
- **The words do not name the screen or the request**: SharePoint's own after "SharePoint (403):", with no list, address or screen. (Not changed: investigate only.)
- **What in the app could cause one:** a participant account opening `admin.html` (its PIN screen reads PMSAdminUsers, which those accounts must not read); a facilitator account
  without Contribute on a list the admin writes, or on PMSClientImages. A stale write token is handled. Nothing in the code builds a request SharePoint should refuse to a
  facilitator. The one 403 on record (QA-TESTING.md, after item 138) was a plain GET of PMSActivities that the console then read with 200: **nothing in the code explains it, and
  nothing more can be concluded without the time, the tab, and the Network panel's status and body.**

## 3. The gates, before (`3a8b32b`) and after (`pms-11a3`), Node 22, this Windows machine

| Gate | Before | After |
|---|---|---|
| `npm run check:svelte` | — | 0 errors, 0 warnings (359 files) |
| `npm test` (with the canvas binary, before the paths fix) | 1,194 of 1,227 pass; 1 fails, 32 cancelled (the Windows path in `test-named-reads.js`) | 1,205 of 1,238; the same 1 and 32, and nothing that fails only after |
| `npm test` (final) | — | **1,238 of 1,238** |
| `npm run test:baseline` (with namespace and named reads) | — | **83 of 83: no request baseline moved** |
| `npm run test:bundle` | — | 35 of 35. Participant 156,695 → **156,729 B (+34)**, admin 553,987 → **554,225 B (+238)**, Tailwind rules unchanged; ceilings 450,000 and 700,000 |
| `npm run test:migration`, Chromium | — | **every Chromium test passes** |
| `npm run test:migration`, WebKit | the same 20 fail (the five spec files rerun) | 20 fail: the 18 sound specs (`effects-audio`), `brand-smoke`, `flow.spec.ts:456`, `keyboard.spec.ts:314`; **identical before and after**: WebKit on Windows, not 11a-3 |
| `npm run test:migration`, Firefox | — | **not run**: Windows refuses to start Playwright's Firefox (`spawn UNKNOWN`, also outside the suite) |
| `npm run test:report:mutations` | — | **34 of 34 caught** |
| `npm run oracle -- --seeds 500` | — | **0 differences** (500 sessions, 5,620 participants, 50 on the local server, four time zones) |

The whole run of `test:migration` was 784 passed, 399 failed (378 of them Firefox's launch), 19 skipped and 16 did not run, in 42.7 minutes. The "before" column was not run for
every gate (the brief's step 2 was skipped at first, as asked); where a gate failed after, it was run before as well, and every such failure was there before.

## 4. What was not run, and what only the real site can show

- Firefox (refused by Windows here) and WebKit's sound and three other specs (failing before as after) need a Mac or another machine; `npm run test:rehearsal` was not run.
- **QA-TESTING.md items 161 to 166**: the tooltips on the laptop and the iPad, the heroes and a locked activity on an iPad, the long question in full screen on a projector, and the
  network coming back during a look.
- The project documents the brief names (`pms-handoff-status.md`, `pms-session-handover.md`, `pms-colleague-handover.md`, `pms-11a2-verification-status.md`) are not in this
  repository and were not updated.

## 5. The package

Made by `npm run package:release` from the commit that carries this report's gates; its name, checksums and the check from a fresh unzip follow.

**`pms-618b8fc`**, made from commit `618b8fc` on 16 Oct 2026 by `npm run package:release` (a fresh checkout of that commit, Node 22, Windows). In
`build-svelte/package/pms-618b8fc/` and `pms-618b8fc.zip` (git-ignored, never committed). `SHA256SUMS.txt` passes in the folder (7 OK) and in a fresh unzip (7 OK), which
holds exactly the folder's 8 files; the release proofs pass (no site address, folder name, PIN hash, demo PIN, `p_cec_` or `CreativeExpCOE` in any page; `pms-config.txt` is the
settings text exactly; no `.json` file).

| File | Bytes | gzip -9 | SHA-256 |
|---|---:|---:|---|
| index.html | 372,890 | 156,729 | `f7fbfd67f27fe80da8c81746bcb3f871b09586b82cdd7f309d7c98928df75ef8` |
| admin.html | 1,523,473 | 554,225 | `ae4ba715136389298bc0edf0e689626eac6136df207d08f240dcb8e0e52add55` |
| setup.html | 1,172,119 | 788,832 | `0fe96cd979323191fcd6c3a6e2bfbb90611cc12a36fc03c232c4b7e2f6d8abef` |
| pms-config.txt | 54 | | `04426124f56abad3973d69fb4a8608e673d86745419bf1cc41c5a70441cc607f` |
| THIRD-PARTY-NOTICES.txt | 40,835 | | `e4ecfa86a85da94926f3f25b9f2b99791c38cc3ea100c5454bb333e620ec1eb4` |
| RELEASE-NOTES.md | 21,963 | | `9a4d06e73ba6771889c524ed94f2bfeee4d2593e4aa32ea2ceee6ecefa831575` |
| RUNBOOK.md | 29,559 | | `91d4baa460cdc5dcc4719422e7025169e5af8b7434364f2c8749ff41a6384a46` |
| **pms-618b8fc.zip** | 1,532,901 | | `be6c15aaa3046a6bd767ead7e35e7ff601fe23c5c7339d2b5d1ada7ec9ef2186` |

The zip is made by Windows' `tar.exe` (bsdtar), the package script's Windows path (`5761a75`, `91d07fe`, `618b8fc`). Its first try, at `5761a75`, deleted the contents of `node_modules`
through the worktree's junction; they were reinstalled from the lock file with `npm ci` (and the rolldown binary npm skipped, `--no-save`), the gates rerun (`npm test` 1,238 of
1,238, `check:svelte` 0 errors), and since `91d07fe` the script removes the link first. On PCOE: replace `index.html`, `admin.html`
and `setup.html` in `Shared Documents/PMS`, keep `pms-config.txt`; Setup then shows the build `pms-618b8fc` (RUNBOOK.md, the note for the PCOE site).


## 6. Seen on PCOE with pms-618b8fc (16 Oct 2026, photographed by Satyadev), and the package after it

**Passed:** Setup shows `pms-618b8fc (built in)` and "The lists are the version this app needs."; a single choice's tooltip sits under its bar, clear of the question,
"4 answered · 0 of 4 got it right first time" and View as table, on the admin view, in full screen and on the iPad (QA item 161); Show answer and Hide answer; View as table and
back; "Who picked" with "Satyadev, Vedala Venkata" and "(2)" (VJR's D1); the wall page keeps the admin header and has no Names switch (D2); "34 answers from 4 iPads"; with the
laptop's Wi-Fi off the Live display keeps its charts and says "Connection lost. Retrying…", and comes back when it is on. **Found:** the ranking's tooltip over other bars'
figures (A2 above). **Not yet seen:** a locked activity on the iPad hub (164), Wi-Fi off and on during a restart on a participant iPad (166), eight long answers on a projector (165).

**`pms-70ad955`**, made from commit `70ad955` by `npm run package:release` (a fresh checkout, Node 22, Windows): `SHA256SUMS.txt` passes in the folder (7 OK) and in a fresh
unzip (7 OK), which holds exactly the folder's 8 files; the release proofs pass. Gates for A2: `npm test` 1,242 of 1,242; the charts, Live display and participant specs 145
passed in Chromium and WebKit (1 skipped); `check:svelte` 0 errors; `test:bundle` 35 of 35 (participant 156,729 B, unchanged; admin 554,264 B, +277 B in 11a-3). Its
`index.html` is byte for byte `pms-618b8fc`'s.

| File | Bytes | gzip -9 | SHA-256 |
|---|---:|---:|---|
| index.html | 372,890 | 156,729 | `f7fbfd67f27fe80da8c81746bcb3f871b09586b82cdd7f309d7c98928df75ef8` |
| admin.html | 1,523,825 | 554,264 | `5577d957f3212e43ad6285b21e4c265025512f821cd925a90332e96f0ee5d372` |
| setup.html | 1,172,119 | 788,832 | `57f6e5a9e338f69c6680d2443a0c27877aeee6d12256c0a94568e5faa690ee8b` |
| pms-config.txt | 54 | | `04426124f56abad3973d69fb4a8608e673d86745419bf1cc41c5a70441cc607f` |
| THIRD-PARTY-NOTICES.txt | 40,835 | | `e4ecfa86a85da94926f3f25b9f2b99791c38cc3ea100c5454bb333e620ec1eb4` |
| RELEASE-NOTES.md | 22,150 | | `2ade67e55f1171cea1ea678129d72a8a9ee3fb043f9d7abaf4f0cd1f311082f5` |
| RUNBOOK.md | 29,662 | | `0f48a39982b2064d1506f647e653f4a2cbea54736b4fba56ad1a63fdd23dbe7a` |
| **pms-70ad955.zip** | 1,533,064 | | `35c981b7102cee7b42b9ba1c62ba505db5d0234b894bdc1f57fb06c55547f4b2` |

## 7. A ranking's places, and the package after it

**Seen on PCOE with pms-70ad955** (16 Oct 2026, Satyadev's photograph): a ranking's places read "1=", "1=", "3.", "4.", "5.", and "1=" looked like a typo. Since
`e2fbfb6` the place is its number alone, "1", "1", "3", "4", "5" (`rankLabel` in `results-chart-model.js`); two bars sharing a number, and the headline, say it is a tie.
Test first (`scripts/test-results-chart-model.js`, failed on the old code). Gates: `npm test` 1,242 of 1,242; the charts and Live display specs 91 passed in Chromium and
WebKit (1 skipped); `check:svelte` 0 errors; admin 554,263 B (+276 B in 11a-3), participant unchanged. The three device checks (164, 165, 166) are left for later, as asked.

**`pms-e2fbfb6`**, from commit `e2fbfb6`: `SHA256SUMS.txt` passes in the folder (7 OK) and in a fresh unzip (7 OK); the release proofs pass. `index.html` is byte for byte
the one in `pms-618b8fc` and `pms-70ad955`.

| File | Bytes | gzip -9 | SHA-256 |
|---|---:|---:|---|
| index.html | 372,890 | 156,729 | `f7fbfd67f27fe80da8c81746bcb3f871b09586b82cdd7f309d7c98928df75ef8` |
| admin.html | 1,523,817 | 554,263 | `43faa57994d86b4e73f734b28496bbed85efdf845217e93eb95f5051835e9898` |
| setup.html | 1,172,119 | 788,832 | `8250659406a1d829bc0645dc7678e469dad11918410c41bd849e3e27630b5280` |
| pms-config.txt | 54 | | `04426124f56abad3973d69fb4a8608e673d86745419bf1cc41c5a70441cc607f` |
| THIRD-PARTY-NOTICES.txt | 40,835 | | `e4ecfa86a85da94926f3f25b9f2b99791c38cc3ea100c5454bb333e620ec1eb4` |
| RELEASE-NOTES.md | 22,385 | | `c4ccf020120326aec8c6fa9b1d773b4c30744f5d67ede25abedff286193229ea` |
| RUNBOOK.md | 29,662 | | `c18be44a04dd58b5f0e44f79ea71003492b8317ff5ca937754835082a70b7131` |
| **pms-e2fbfb6.zip** | 1,533,139 | | `8b745b0559762f8f707297bb813f7e044c2e9dd67442da2e0c417cf34f666fdb` |
