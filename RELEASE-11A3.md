# Phase 11a-3: the polish batch after the 11a-2 real-site checks (draft, in progress)

Branch `pms-11a3`, from `3a8b32b` ("pms-283ad18 as deployed (VJR's tree)"). **Status: development done for items A, D(1), D(3), E and F, and G investigated;
B, C and the greeting of D(2) wait for VJR's decisions. None of the gates of the brief's section 5 has been run, no package has been made, and nothing has
met the real site.** You asked to leave the heavy testing for one final round; this report says what that round must run.

## 0. Where this started

- VJR's files arrived without their git history: this repository has no `pms-redesign`, no `283ad18`, `ecc58fb` or tag `legacy-final`. The brief's step 0 could
  not be done as written. In its place: the folder, built with `PMS_BUILD_ID=pms-283ad18` and its line endings made LF, gives `index.html`, `admin.html` and
  `setup.html` **byte for byte** equal to the deployed package `pms-283ad18` (`707beef9…`, `bf5513fd…`, `e97f28a1…`), and that package passes its own
  `SHA256SUMS.txt`; its zip is `8119e28a…cb6f`, as in the handover. That tree is commit `3a8b32b` on `pms-11a3` (never `main`).
- **Line endings.** This Windows checkout has `core.autocrlf=true`, so the working tree is CRLF. A page built from it differs from VJR's (LF) build only in CR
  characters; commits here are made with `core.autocrlf=input`. A release package built on this machine will therefore not equal one built from LF sources
  byte for byte. Decide before the final build whether to set `core.autocrlf input` (or a `.gitattributes`) for this repository.
- **What could not run on this machine:** Playwright's browsers were not installed at first (Chromium was installed later the same day; WebKit and Firefox are not); and
  under Node 20.13 a `before` hook at the top of a test file does not run before a `describe`'s tests, so `npm run test:bundle` fails here before it builds anything
  (sizes below were measured with `scripts/analyze-bundle.js`'s `analyzePage` directly). The recorded numbers were made with a newer Node; use Node 22 for the gates.

## 1. The items

| Item | Commit | What changed | Test first (failed on the old code) |
|---|---|---|---|
| A, tooltip | `79c5d11` | `placeTip()` (`lib/tip-place.js`) takes `avoid`: the card's words and buttons (`data-tip-avoid` in `ResultCard`: headline, question, "N answered" line, Show answer, View as table, captions). Above, or above moved along while it still spans its mark, then under, or under moved along; where neither side is clear, the place that covers the fewest of their pixels. Always whole, inside the window, clear of the mark and its own label; with nothing to avoid, where it always was. | 4 tests in `scripts/test-results-chart-fit.js` (3 failed). `tipProblems()` in `results-charts-support.ts` now fails a tooltip over the card's words when the place under its mark was clear (not run: no browsers). |
| D(3), locked title | `e29d201`, `d6108d3` | A locked activity's title is white (`var(--text)`), as its caption and lock are; it was `--on-disabled` on `--disabled` (#4D80D0 on #034CB5, about 2:1). White has 4.5:1 or more on `--disabled` for every primary (6.05:1 at worst). | `scripts/test-theme.js`: the rule, and the contrast over 584 primaries (failed: no rule). |
| D(1), heroes | `b31c7fc` | **Not a code fault.** VJR's hero sources are JPEGs (`.local/sample-images/*-hero.jpg`, no alpha), so the stored heroes are opaque squares; Brand Studio keeps a hero's transparency. `build:sample-pictures` now takes `<client>-<slot>.png` when it is there. The six committed pictures are unchanged until transparent PNGs are supplied and the generator is run. On PCOE, a transparent PNG uploaded in Brand Studio fixes a hero with no new build. | None (tooling; the pictures did not change). |
| E, long answers in full screen | `613c8c5` | The fit step is `lib/present-fit.js` (`nextFit`, `scaleOf`, `SMALLEST`). Its floor is the factor that gives type 0.75; it was 0.5, so on a window 1,550 px wide or more (type 1.6 to 2.4) the type stopped at 0.8 or above, neither smaller nor spilling, and the card was cut at its edge. At type 1.2 (iPad upright, phone) the steps are what they were. | `scripts/test-present-fit.js` with a stand-in of the old floor: "at 1.6 … scales 1.6, 1.45, 1.3, 1.1, 0.95, 0.8, 0.8, …". A browser test in `results-charts-fit.spec.ts` (1920x600, 1600x700, 768x1024, 1080x1920; not run). **Whether this is what the real site showed is not known**: the report did not say which screen. |
| F, the flake | `73f0b1b` | The cause was the page: `lib/page-watch.ts` dropped an `online` event that came while a look was on its way (and that look could have read the track before the test stamped the restart), so the page waited for its next look. Now `online` during a look asks for one more look as soon as it ends (never two at once; a `Retry-After` is still a floor). The test and its timeout are unchanged. | `scripts/test-page-watch.js` drives the real `page-watch.ts` (via Vite's esbuild) with a stand-in window: failed ("a second look follows the first at once"). |
| G, the 403 | none | Investigated only; section 3. | — |
| B, C, D(2) greeting | none | **Skipped: VJR's decisions D1 ("Last, First") and D2 (`/wall` header) are not made.** | — |

**Seen in a browser (Chromium only, Playwright 1.64's own build, installed 16 Oct 2026):**

- A: `results-charts-fit.spec.ts` "the admin view: every tooltip …" **passes**; with item A's four source files put back as they were (`79c5d11^`) it **fails** with 12
  tooltips over the question, "N answered · N of 4 got it right first time" or View as table "although there was room under its mark" (1280x800 and 390x844): the
  real-site defect, reproduced. In the pictures (`test-results/11a3/A-v1-*.png`, `A-v4-*.png`) the tooltip of v1's top bar now sits under the bar, clear of the card's
  words; it covers the next rows' bars and figures instead (marks are not on the brief's list of things to keep clear of).
- E: the new test "eight answers of 90 characters in full screen are never cut off …" **passes**; with `LiveDisplay.svelte` put back as it was (`613c8c5^`) it **fails**:
  "1920x600, full screen, w1: the card's contents run 142px past its edge". Pictures `test-results/11a3/E-w1-1920x600-before.png` (cut after the fifth answer) and
  `-after.png` (all eight answers whole).
- Not run: WebKit and Firefox, the rest of `test:migration`, and the full-screen and wall tests of `results-charts-fit.spec.ts` at all eleven sizes.

New suites are in `npm test`; `test-present-fit.js` is also in `npm run test:charts`, `test-page-watch.js` in `npm run test:polling`. Run here: `check:svelte` (0 errors),
`test:charts` (52 of 52), `test-theme.js` (15 of 15), `test-polling.js` and `test-page-watch.js` (23 of 23). Nothing else.

## 2. Page sizes (gzip, measured with `analyzePage`, this checkout)

| | before (`3a8b32b`) | now (`b31c7fc`) |
|---|---|---|
| participant | 156,717 B (11a recorded 156,710 B on VJR's machine) | 156,745 B (+28 B; Tailwind utility rules unchanged) |
| admin | not measured at `3a8b32b` (11a recorded 552,083 B on VJR's machine; 554,240 B here with item A in) | 554,247 B |

`PHASE_11A3` (`scripts/bundle-budget.js`): at most 500 B over where 11a left each page, the participant page's Tailwind rules exactly 11a's; 11a's check became a
recorded-numbers one. `participantAfter` and `adminAfter` are filled in when the phase ends. (Found on the way: **a comment inside a Svelte `<style>` block is kept in
the built page**: the first version of D(3)'s comment cost about 100 B; it is in the script block now.)

## 3. G: what the app does with a 403, and whether it can cause one

- **A write** (`spHttp`): a 403 whose words mention "security validation" or "request digest" gets a new write token and is tried once more; any other 403 is thrown as
  `SharePoint (403): <SharePoint's words>`, status 403.
- **A `$batch`** of reads (`spReadTogether`, `spReadOrBatch`): a 403 drops the write token and the same reads are made one by one; nothing is shown.
- **A plain read**: thrown as above. On a timer (the participant page's look, Content's and Guests' 15-second looks, the Live display) it is swallowed and the timer
  backs off; a 403 is not "signed out" (`lib/sign-in.js`) and not "unreachable", so the participant page shows nothing for it. The settings file answered 403 is
  `PMS-CFG-002` with `status 403`, worded as a sign-in.
- **The words do not name the screen or the request**: the message is SharePoint's own after "SharePoint (403):", with no list, address or screen. (Not changed: the
  brief says investigate only.)
- **What in the app could cause one:** a participant account opening `admin.html` (its PIN screen reads PMSAdminUsers, which those accounts must not read); a
  facilitator account without Contribute on a list the admin writes, or on PMSClientImages; a stale write token is handled. Nothing in the code builds a request that
  SharePoint should refuse to a facilitator's account. The one 403 on record (QA-TESTING.md, after item 138) was a plain GET of PMSActivities that the console then
  read with 200: **nothing in the code explains it, and nothing more can be concluded without the time, the tab and the Network panel's status and body.**

## 4. To run in the final round (brief, section 5)

On Node 22, after `npx playwright install` (and `node node_modules/playwright/cli.js install webkit firefox`): `npm run check:svelte`, `npm test`,
`npm run test:baseline` (no request was added; it should be unchanged), `npm run test:bundle`, `npm run test:migration` (three browsers: the new tests in
`results-charts-fit.spec.ts`, and `participant.spec.ts` and `polling.spec.ts` with the page-watch change), `npm run test:report:mutations`, `npm run oracle -- --seeds 500`,
then `npm run package:release`, the checksums from the folder and a fresh unzip, and a runbook note. Then set `PHASE_11A3.participantAfter` and `adminAfter`.

## 5. Only the real site can show

QA-TESTING.md items 161 to 166. The project documents the brief names (`pms-handoff-status.md`, `pms-session-handover.md`, `pms-colleague-handover.md`,
`pms-11a2-verification-status.md`) are not in this repository and were not updated.
