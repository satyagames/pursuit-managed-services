# Phase 11a-2: the charts fit their card, tooltips are never cut off, the headlines' words

Date: 16 Oct 2026. Branch `pms-redesign`, on top of `189a21e` (Phase 11a, the package's checksums). Nothing was pushed; `main` and the tag `legacy-final` (`2ad1520`) are
untouched.

**In plain words.** With `pms-3fb312a` on the real site (PCOE) a colleague opened the Live display on a Windows laptop in Chrome and VJR photographed the screens. In full
screen a confidence question had a scrollbar inside its chart, its tooltip was cut off and lay over the middle step's name, and the card had an empty space under the
chart; confidence columns were thin; the figures under the bars were off their gridlines; a headline said "Most people (50%)" and another ended "co.."; a card stretched
beside a card whose names were open; and Kroger's header said "34 answers from 5 iPads" although one visit had answered nothing. This phase fixes all of them: the last only
after stopping to ask, since the Live display's PDF and PowerPoint print the same figure, and VJR chose to count the iPads that answered on the two screens and leave those
files for Phase 11b (section 5). Nothing else changed: not the exports, what is counted or stored, the lists (version 3), Setup or the participant page (byte
for byte), and no request was added. **These pages have not run on the real site, that laptop, an iPad or a projector** (QA-TESTING.md items 157 to 160).

## 1. The cause of item 1 (the confidence question in full screen)

**Reproduced first**, before anything was changed, on the built 11a pages against the real local server, with VJR's run in miniature (its confidence question is counted
0, 2, 0: the photograph's "2 people · 100%"), in Chromium, WebKit and Firefox, at 1366x768, 1440x900, 1536x864, 1600x900, 1920x1080, 1280x800, 1024x768, 820x1180 and
390x844, and at 1536x864 with device scale 1.25 and 1.5, in full screen, on the wall page and on the admin view (`test-results/phase-11a2/repro/`, a scratch spec, with
the measurements of every size as JSON). **It happened at every size, every scale and in every engine**: it is a state (a pointer on a column), not a size.

- **The container and the rule:** the scale's own frame, `div.scale` in `migration/src/admin/charts/ScaleChart.svelte`, had **`overflow-x: auto`**. A box whose
  `overflow-x` is not `visible` computes its `overflow-y` to `auto` as well (CSS Overflow 3), so the frame was a scrolling box both ways, inside the card.
- **The tooltip was drawn inside that box** (`ChartTip`, `position: absolute` in the frame), and placed by `tipPlace()` (`chart-ui.ts`) *below* its mark whenever the
  mark's top was within 64px of the frame's top. A scale column is a button as tall as the plot, so its top is always 1.6em under the frame's top: **a column's tooltip
  always went below the column, over the step names**, and reached 8px (admin view) to 33px (full screen) past the frame's bottom. The frame grew a scroll range for it:
  its bottom was cut off (in Chromium at 1536x864 in full screen: scroll height 350 in a box 318 high; the tooltip's two bottom corners hit-tested as the card behind
  it) and it covered the hovered column's own label in every case.
- **Even with no pointer on it** the frame had a scroll range of 1px in Chromium at 1440x900, 1536x864 and 1920x1080 in full screen, and of 1 to 2px in Firefox at every
  size: the frame's height is a fraction (318.39px at 1536x864: `9rem x 1.55` plus the rows above and below the plot), the step names reach that fraction past its
  rounded client height, and `scrollHeight` rounds up. **Windows draws a 17px scrollbar with arrows for any scroll range**, which is the bar in the photograph.
- **The empty space under the chart:** in full screen the card is as tall as the screen allows (`.result-card--fit`, `height: 100%`) and its body grows (`flex: 1 0
  auto`), but the scale's plot had a fixed height (`--plot-height: 9rem x scale`), so the rest of the card was white: 26px at 1366x768, 112px at 1440x900, 29px at
  1536x864, 93px at 1920x1080, 495px at 820x1180. Bars and rankings had the same gap.
- **Why 11a's tests did not see it:** (1) no test measured a tooltip: the names walk points at every mark only to read the page for names, and the layout spec moves the
  pointer away before its pictures so that no tooltip is in them; (2) no test looked for a scrolling box inside a card: `fitProblems` compares the card's own
  `scrollHeight` with its height, and the overflow was contained by the scale's frame, inside the card; `chartProblems` checks words against the card's edge, and the
  step names were inside it; (3) **no picture could show the scrollbar**: Playwright starts Chromium with `--hide-scrollbars`, and macOS's WebKit and Firefox draw
  scrollbars only while scrolling (a Chromium launched without that flag, at 1536x864 and 125%, draws exactly the photograph:
  `test-results/phase-11a2/repro/chromium-scrollbars-1536x864@1.25-full-screen.png`); (4) the empty space was not measured at all. So it was not a size or a scale the
  tests missed: the tests did not look at that state, and could not have seen the scrollbar on a Mac.
- **The same box was elsewhere:** the numbers view's `div.numbers` had `overflow-x: auto` too (12 boxes on the admin view's numbers views), and the tooltips of
  bars had the same placing: a ranking's first bars (near the top of their frame) put their tooltip under the bar, which on the wall page ran past the bottom of the
  window (at 1536x864: the tooltip from 855 to 935 in a window 864 high).

## 2. What "N iPads" counts (step 4 of the brief)

"34 answers from 5 iPads" is `results.tracks.length`: **every visit (track) of the session, whether it answered or not**, and the answers are the sum of each live
question's `respondents`. It is worked out separately, by the same rule, in three places:

| Where | Code | Who sees it |
|---|---|---|
| The Live display's header | `migration/src/admin/LiveDisplay.svelte` (the `.live__meta` line) | the admin view and the wall |
| Each Results card's "Live results · N answers from M iPads" | `migration/src/admin/AdminResults.svelte` (the `<summary>` of the card's charts) | Results (the sentence VJR quoted) |
| **The Live display's one-page PDF and PowerPoint exports** | `public/js/resultsExport.js`, `buildReport()` (`iPads = results.tracks.length`), printed in the header band | the exported files |

Not in it: the tally (`lib/results-tally.js` hands the visits on and counts nothing about them), the Live display's CSV (it has each question's respondents), the oracle
(it checks the leader report, the CSV, Results' rows and the Live display's tally, not this sentence). The leader report counts the same population under another name:
"Participants are everyone who opened the session ... Someone who joined and answered nothing is listed" (`COUNTING_RULES`). A browser test holds the rule as it is:
`live-display.spec.ts`, "A fourth iPad joins: the count is the iPads' count" (a visit that has not answered raises the header from 3 to 4).

**So part D stopped and asked** (section 5): an export prints the same figure, which is the brief's case for leaving the counting alone. VJR chose option (a), and
part D was then done (`6613d9c`).

## 3. The commits

| Part | Commit | Message |
|---|---|---|
| A | `03a8781` | Phase 11a-2: headline wording |
| B | `21a832a` | Phase 11a-2: charts fit the card, tooltips never clipped |
| C | `7e5580f` | Phase 11a-2: confidence columns and axis labels |
| D | `6613d9c` | Phase 11a-2: iPads counted from visits with answers (after VJR's choice of option (a): section 5) |
| E | `d1e7b68` | Phase 11a-2: record and package (amended once, for the rehearsal: section 9) |
| | `603552a` | Phase 11a-2: the package's checksums (of `pms-d1e7b68`, before part D; superseded) |
| F | (after D) | Phase 11a-2: record part D and package |
| | (after F) | Phase 11a-2: the package's checksums |

`git status` after E: nothing tracked is changed; the untracked brand guide, logos and Unity files under `public/assets`, `.local/` and `.claude/` are where they were,
never added (every commit was staged by name). Gate logs, the reproduction and the red runs are in `test-results/phase-11a2/` (git-ignored). The package is named after
E, so its checksums are recorded by one more commit, "Phase 11a-2: the package's checksums", which changes nothing else (as in 11a). After part D the same was done
again: F records it, the package is made from F, and the last commit records its checksums and the final gates.

## 4. The new tests: red on the code before, green after

Every browser test below was first run against the pages **as built from the commit before it** (a copy kept in `test-results/phase-11a2/release-pre` for 11a and
`release-B` for part B), served on a port of their own, so nothing was taken back in the code; the logs are `A-red.log`, `B-red-final-*.log` and `C-red-*.log`.

**A, the headlines** (`scripts/test-results-chart-model.js`, node): ten new tests, every sentence written out by hand (1, 2, 1, 0 of 4 is "The top choice (50%) was
1014 Vine Street, Cincinnati."; 3 of 5 is "Most people (60%) chose ..."; "Kroger grocery and Baking co." with one full stop; "?", "!", an ellipsis, three dots, a closing
quotation mark and bracket; a top share of 25%; 51 of 101 shown as 50%; multiple choice; true or false at 72%, 75% and 50%; the scale's "Average 2.0 of 3. Most people
(100%) chose ..." and "Average 2.6 of 5. The top choice (40%) was A little."; no answers; a tie; a ranking). Four existing sentences were changed, narrowly: the single
choice of 1, 2, 1, 0 ("Most people (50%) chose ..." to "The top choice (50%) was ..."), multiple choice ("Picked most: Email, by 3 of 4 people (75%)." to "Most people
(75%) chose Email."), true or false ("75% said True." to "Most people (75%) said True.") and the answer that has since been removed ("Most people (50%) chose Kept B." to
"The top choice (50%) was Kept B."), and the example in QA-TESTING.md's Live display item. No request baseline holds a sentence. **Red: 12 failing** (the tie and no-answer
test passed, as it should); **green: 29 of 29**; seven mutations of the rules each caught (`A-mutations.log`).

**B, the fit** (`scripts/migration-tests/results-charts-fit.spec.ts`, seven tests, three engines, nine sizes and 1536x864 at 1.25 and 1.5, full screen and the wall page,
VJR's scale and ranking and the large session's eight answers of 90 characters; and `scripts/test-results-chart-fit.js`, node, five tests of where a tooltip goes, four
mutations caught). On the 11a pages, in Chromium, each test alone:

| Test | Problems found on 11a |
|---|---|
| full screen, VJR's scale and ranking | 132: 66 tooltip corners not seen (cut off), 33 tooltips over their mark's label, 22 charts with empty room under them, 11 `div.scale` scrolling boxes |
| full screen, eight answers of 90 characters | 12: 10 charts with empty room under them, and on a phone the card cut off its own chart (2) |
| the wall page, VJR's run | 206: 118 tooltip corners not seen, 33 tooltips over their label, 27 cards stretched, 17 tooltips past the window, 11 `div.scale` scrolling boxes |
| the wall page, eight answers | 89: 45 cards stretched, 22 `div.scale` scrolling boxes, 16 tooltip corners not seen, 6 tooltips past the window |
| the admin view, every tooltip | 51: 26 tooltip corners not seen, 14 scrolling boxes (12 `div.numbers`, 2 `div.scale`), 6 tooltips over their label, 5 past the window |
| a card beside one with its names open | the card beside grew from 411 to 553px |
| a refresh leaves full screen as it was | 15 changes in six seconds: the type 1.2, 1.1, 0.95, 0.85, 0.75, three times |

**Green: 21 of 21** (seven in each engine; `C-fit-final.log`, on the final pages). The layout spec of 11a no longer excuses a card cut off on a screen held upright.

**C, the columns and the axis** (in `chartProblems`, so at every size the layout spec measures, the admin view and the wall, both sessions, three engines; and a new
layout test of the average's line and pointer, the bands and their names). On part B's pages: "0%" 8.6px right of its gridline, "100%" 16.0px left, a ranking's "0"
3.2px right and "100" 10.7px left (the photograph showed about 8px); every column 24px where 40% of its step was due (42.1px at a phone, 65.6px at a laptop).
**Green**: the layout spec in Chromium, WebKit and Firefox (`C-green-chromium.log`, 72 passed with the other chart, Live display, a11y and contrast specs;
`C-green-wf.log`, 26 passed).

**D, the iPads** (after VJR's choice): `scripts/test-results-chart-model.js`, three tests worked out by hand from Kroger's five visits (9, 8, 0, 8 and 9 answers: "34
answers from 4 iPads"; each visit once; only over the questions given; an answer whose visit has gone counts, one with no visit does not); red without the function,
green 32 of 32, three mutations caught (`D-mutations.log`). `live-display.spec.ts`, "A fourth iPad joins", now holds that a visit that has begun and answered nothing is
not counted through two refreshes, and is once it answers; `review-9b.spec.ts` expects the two readable visits that answered where it expected 4. On part C's pages
both failed ("7 answers from 4 iPads", "3 answers from 4 iPads": `D-red-browser.log`); on part D's, the Live display, review-9b, Today and Clients specs passed in three
engines, 165 passed and 4 skipped as before (`D-green-browser.log`).

## 5. Part D: stopped, the options, and VJR's choice

The figure is not the display layer's alone: the Live display's PDF and PowerPoint exports print "N answers from M iPads" from the same rule (section 2), and the brief
says to leave the counting alone in that case. The phase stopped there and put these options, with what each touches:

| Option | What it says for Kroger | What it touches |
|---|---|---|
| **(a) The two screens only** | the Live display and Results: "34 answers from 4 iPads"; the PDF and PowerPoint: "from 5 iPads" | `LiveDisplay.svelte`, `AdminResults.svelte`, one small function beside the chart model and a node test with Kroger's figures (5 visits; 9, 8, 0, 8 and 9 answers), and `live-display.spec.ts`, "A fourth iPad joins" (the fourth visit counts once it has answered) |
| **(b) The screens and the one-page export together** | "from 4 iPads" everywhere | (a), and `public/js/resultsExport.js` `buildReport()` (an export: outside this phase), with a test of the exported header, which no test reads today |
| **(c) Both numbers, in words** | "34 answers from 4 of 5 iPads" (or "... from 4 iPads; 5 joined") on the two screens; the PDF's "5 iPads" still agrees | the two screens and the same spec; no count changes |
| **(d) Leave it** | "34 answers from 5 iPads": "iPads" are visits, as the leader report's "participants" are | nothing; QA item 160 becomes the explanation |

Phase 11b redesigns the one-page Export PDF on the same chart model, so (a) now with the export following in 11b leaves the screens and the files apart for one phase; (b)
keeps them together from now. Either way the leader report's "participants" (every visit, one that answered nothing listed as such) is a different figure on purpose.

**VJR chose (a), 16 Oct 2026**: "count only the visits that answered on the Live display header and the Results card summary, with Kroger's figures as the test; leave
the PDF/PowerPoint export for 11b." Done in `6613d9c`: `answerCounts(questions)` beside the chart model counts the answers to the questions a screen shows and the
distinct visits they came from (`ownerOf`, the key the names already use), and `answersFrom()` words them as before ("34 answers from 4 iPads"); the Live display's header
uses its live activities' questions and each Results card all of its own, as each did for the answers. `resultsExport.js` is untouched: the one-page PDF and PowerPoint
still say "from 5 iPads" for Kroger, which is QA item 160's last line and Phase 11b's to change.

## 6. Every decision not in the brief

1. **"Most people" needs the top share above half both as counted and as shown** (`isMost`): 51 of 101 is 50.5%, shown as 50% by the largest-remainder rounding, and
   "Most people (50%)" is the very sentence VJR objected to, so it says "The top choice (50%) was ...".
2. **Multiple choice now says the single-choice sentence** ("Most people (75%) chose Email." / "The top choice (50%) was Chat."): it said "Picked most: Email, by 3 of
   4 people (75%).", which the brief's "the same rule for multi-select" could not apply to as it was worded.
3. **A closing quotation mark or bracket after a stop counts as the end** ("Kroger (Inc.)", "... “Go.”"): no stop is added after it.
4. **The true-or-false headline is a plain sentence**: the card used to set the "75%" of "75% said True." in large type by reading the headline's first word; the new
   sentence ("Most people (75%) said True.") has none to read. The split bar's own labels ("True 75%") are still large.
5. **The tooltip keeps clear of the scale's "Average 2.0 of 3" as well as the column's own label**, after looking at the pictures (it covered the average's label).
6. **A column's tooltip is placed against what is drawn** (its count and its fill), not the whole column button, which is as tall as the plot: above the count first.
7. **The tooltip layer is `position: fixed`** (no ancestor of a chart has a transform or a filter), at z-index 50 (over the admin page's sticky bar and tabs at 5, under
   its toast at 100), its place rounded to whole pixels; it follows its mark when the page scrolls or the window changes size.
8. **In full screen a chart of bars keeps its bars' thickness** (24px times the size of type) and the rows share out the height; **a true-or-false split keeps its
   thickness and sits in the middle of its room** (it has no plot to grow); written answers are as they were.
9. **The spill**: the controls (Previous, Next, Auto-advance) stay in view at the foot while the screen scrolls, and "More below" floats over the page just above them
   (it lets the pointer through, and takes no room, so nothing moves when it goes); `scroll-padding-bottom` keeps a mark brought into view clear of them.
10. **A scale with more steps than its card holds at 44px shares the width out** instead of scrolling: the one case in which a column is under the admin page's 44px.
11. **The numbers view's box no longer scrolls sideways**: its words wrap, and the layout spec measures every numbers view at five sizes.
12. **Full screen fits the card again when what it shows changes** under the same question (its numbers in place of its chart), so the numbers view is never cut.
13. **A fault the brief did not name was fixed**: every refresh of the Live display put full screen's type back to full size for a moment (found by a test that was flaky
   for that reason; the new refresh test records every change the page makes).
14. **The gridlines of a bar chart are elements** (`.bars__gridline`, each a pixel wide at `at x (100% - 1px)`), so the test measures them in the DOM; each figure's
   middle is at `at x (100% - 1px) + 0.5px`.
15. **Part D stopped and asked** (section 5): the Live display's PDF and PowerPoint print the same figure. After VJR's choice: **a visit whose answers could not be
   read is not counted among the iPads** (its answers are not among the N, and the notice above them names it), so `review-9b.spec.ts` says 2 where it said 4; and **the
   iPads are counted over the same questions as the answers** on each screen (the Live display's live activities, a Results card's every activity).
16. **AGENTS.md has "Rules from Phase 11a-2"**, as each earlier phase has its rules there; the runbook's note for the PCOE site has a new step 6 (the laptop; the iPad and
   the projector are step 7, the timing check step 8), and QA item 160 is listed as "later" (a decision).
17. **The sixth rehearsal follows the new step** on the mocked site at 1536x864: no box that scrolls in a card, every tooltip whole, no "Most people (50%)" or "..", and
   cards at their own height (Domino's sample content has no confidence question, so the scale is the fit spec's).
18. **The tooltip's corners are hit-tested 3px in from each edge** (its corners are rounded at 0.4rem; 2px in landed outside the curve when the place was a fraction
   of a pixel), with the tooltip made to catch the pointer for the moment of the test (it lets the pointer through, so that it never hides a neighbouring mark).
19. **A confidence column on the wall page is the admin page's size** (the type there is at 1); in full screen it is 24px to 72px times the size of type.
20. **The red runs** of the browser tests were run against a copy of the previous commit's built pages, served on a port of their own (`test-results/phase-11a2/`), not
   by taking the code back.

## 7. The gates, before and after

Both columns were run in a fresh worktree of the commit (`../pms-11a2-base`, its `node_modules` linked), one gate after another; the logs are
`test-results/phase-11a2/base-*.log` and `after-*.log`. **Part D came after these** (section 5): the column "Final" is every gate run again on F's tree, with part D, one
after another with nothing else running (`finalD-*.log`).

| Gate | Before (`189a21e`) | After (`7e5580f`, the code of E) | Final (`283ad18`, F: with part D) |
|---|---|---|---|
| `npm run check:svelte` | 0 errors, 0 warnings (357 files) | 0 errors, 0 warnings (358 files: `lib/tip-place.js`) | 0 errors, 0 warnings (358 files) |
| `npm test` | 1,209 passed | 1,224 passed (+10 the headlines, +5 where a tooltip goes) | 1,227 passed (+3 Kroger's iPads) |
| `npm run test:baseline` | 37 passed | 37 passed; **no request baseline changed** (`git diff 189a21e 7e5580f -- scripts/request-baseline` is empty) | 37 passed; **no request baseline changed** (`git diff 189a21e 283ad18 -- scripts/request-baseline` is empty) |
| `npm run test:bundle` | 34 passed | 34 passed | 34 passed |
| `npm run test:report:mutations` | 34 of 34 caught | 34 of 34 caught | 34 of 34 caught |
| `npm run oracle -- --seeds 500` | 0 differences | 0 differences | 0 differences |
| `npm run test:migration` | 1,165 passed, 26 skipped, 0 failed (Chromium 443; WebKit 343 + 13 skipped; Firefox 379 + 13 skipped) | 1,188 passed, 26 skipped, 1 failed (Chromium 450 + 1 failed; WebKit 351 + 13 skipped; Firefox 387 + 13 skipped): +24, the seven fit tests and the new scale test in three engines. The one: `participant.spec.ts:91` in Chromium ("Question A" not visible within 5 s), the timing flake 11a recorded, on a participant page byte for byte this one's; it passed 3 times of 3 alone on the same build (`after-participant91-x3.log`). That run shared the machine with the rehearsal's dry runs, so **the whole suite was run again** on E's tree (`d1e7b68`) with nothing else running: **1,189 passed, 26 skipped, 0 failed** (Chromium 451; WebKit 351 + 13 skipped; Firefox 387 + 13 skipped; 48.9 minutes; `final-test:migration.log`). | **1,189 passed, 26 skipped, 0 failed** (Chromium 451; WebKit 351 + 13 skipped; Firefox 387 + 13 skipped; 49.2 minutes; `finalD-test:migration.log`): the same tests as before part D, two of them changed (section 4) |

E changes no page (its files are documents, the release documents' generator and two tests): the pages E's package is built from are those of `7e5580f`, byte for byte
(section 9). `npm test` was run again on E's tree for `scripts/test-release-docs.js` (it holds the runbook's note).

**Sizes** (gzip -9, as `npm run test:bundle` measures them):

| Page | Before | After | Change |
|---|---:|---:|---:|
| participant (`index.html`) | 156,710 B (this checkout), 156,699 B (a fresh one) | the same | **0 B, byte for byte** (sha-256 `44e0277a...` before and after, and its Tailwind rules, `PHASE_11A`) |
| admin (`admin.html`) | 552,083 B (this checkout), 552,073 B (a fresh one) | 554,176 B, 554,165 B after A to C; **554,241 B, 554,231 B with D** | +2,158 B (in both), under its 700,000 B budget by 145,759 B (D added 65 B) |
| setup (`setup.html`) | 792,621 B (fresh) | 792,620 B (fresh) | the build's name only |

The admin page grew by the tooltip's layer and its placing, the gridlines as elements, the spill and the fit of each chart. No `PHASE_` constant was added:
`PHASE_11A`'s rules (the participant page at 0 B and its exact Tailwind rules; the admin page under where Phase 10j left it) still hold the pages.

## 8. What was fixed after looking at the pictures

The pictures are in `test-results/charts/` (`fit-full-*`, `fit-wall-page-*` and `fit-spill-*` new in this phase; `admin-*`, `wall-*` and `grey-*` taken again), and the
reproduction's in `test-results/phase-11a2/repro/`. Looked at closely at 1536x864 (also at 125%) and 1366x768, and on a phone and an upright iPad for the spill:

1. **The tooltip covered "Average 2.0 of 3"** above the middle column (1536x864, full screen and the wall page): it now keeps clear of the average's label too.
2. **"More below", hidden at the end of the page, kept its room** and left an empty band at the top of the controls' dark ground (390x844): it now floats over the page
   just above the controls and takes no room.
3. **The card's words showed through behind Previous and Next** while the screen spilled (the ground was 88% opaque): it is solid.
4. **A strip of the card showed under the controls** (a sticky box keeps clear of its scroller's padding): the controls' ground now reaches the screen's edge.
5. Before part C, the same pictures showed the thin columns and the figures off their gridlines that part C fixed; after it, the column at 1536x864 in full screen is
   about 112px in a step of 470px, on the admin view 66px in 164px, on a phone 42px in 105px, and "0", "50" and "100" sit on their lines.

## 9. The package and the runbook note

**The package to upload is `pms-283ad18`**, made from `283ad18` (F, with part D) by `npm run package:release` in a fresh worktree of that commit:
`build-svelte/package/pms-283ad18/` and `pms-283ad18.zip` (git-ignored, never committed).

| File | Bytes | gzip -9 | SHA-256 |
|---|---:|---:|---|
| index.html | 372,754 | 156,699 | `707beef98e236cc17a5299b0874325ca9a54d5f051284ff2a6889b2bd9d2f19c` |
| admin.html | 1,522,472 | 554,231 | `bf5513fdb66aa2943a32a001acc092eecb6ae77b721dc9722850004df04588db` |
| setup.html | 1,172,119 | 792,620 | `e97f28a185a81bbda0359407ea345621a458eb363fbb164ee1e3e60a4e2a7a72` |
| pms-config.txt | 54 | | `04426124f56abad3973d69fb4a8608e673d86745419bf1cc41c5a70441cc607f` |
| THIRD-PARTY-NOTICES.txt | 40,835 | | `e4ecfa86a85da94926f3f25b9f2b99791c38cc3ea100c5454bb333e620ec1eb4` |
| RELEASE-NOTES.md | 19,897 | | `cc22352d8a9c26628d158721ebda4bc500b3ce65f1b32dfcf6e154e2ab25ea69` |
| RUNBOOK.md | 27,292 | | `627a1129bc7ad44150b85d0a2c3299811e57d7f24d83dd9a7411fe058e89b8b0` |
| **pms-283ad18.zip** | 1,527,192 | | `8119e28ab0060814f64d6487ccf6f6f3959b73e6a768effae8cf9dcecd66cb6f` |

Proved by the package script, and again by hand: the same proofs as below (no site address, folder name, PIN hash, demo PIN, `p_cec_` or `CreativeExpCOE` in a page;
`pms-config.txt` exactly the settings text; no `.json`); `shasum -a 256 -c SHA256SUMS.txt` 7 OK in the folder and 7 OK in a fresh unzip, which holds exactly the
folder's 8 files. **`index.html` is byte for byte pms-3fb312a's** (and pms-0a1c701's); **all three pages are byte for byte the ones the final browser suite ran
on** (built from `283ad18` in the worktree). The admin page is 2,158 B larger (gzip) than pms-3fb312a's 552,073 B, as
RELEASE-NOTES.md says. **The rehearsal** with this package: **18 of 18 passed** in 2.7 minutes, in Chromium, WebKit and Firefox.

The package made earlier from E, before part D, follows for the record; it is superseded (its admin page counts every visit) and was removed from `build-svelte/package/`.

**The package is made from E** (the commit of this file) by `npm run package:release`, in a fresh worktree of that commit; since a package is named after its commit, its
name, its files' checksums and the zip's are recorded by the next commit, "Phase 11a-2: the package's checksums", which changes nothing else, with the rehearsal and the
second whole run of the browser suite (section 7).

**`pms-d1e7b68`**, made from `d1e7b68` (E) by `npm run package:release` in a fresh worktree of that commit: `build-svelte/package/pms-d1e7b68/` and `pms-d1e7b68.zip`
(git-ignored, never committed).

| File | Bytes | gzip -9 | SHA-256 |
|---|---:|---:|---|
| index.html | 372,754 | 156,699 | `707beef98e236cc17a5299b0874325ca9a54d5f051284ff2a6889b2bd9d2f19c` |
| admin.html | 1,522,347 | 554,165 | `0d4a31df0e460247a5d36c961fa99756a860523e473112f36a6443b1905c4ea5` |
| setup.html | 1,172,119 | 792,620 | `5e601b8ba709881ebffdc4489ecf4e6ac6458b83e7dd0138e97a7d946440833b` |
| pms-config.txt | 54 | | `04426124f56abad3973d69fb4a8608e673d86745419bf1cc41c5a70441cc607f` |
| THIRD-PARTY-NOTICES.txt | 40,835 | | `e4ecfa86a85da94926f3f25b9f2b99791c38cc3ea100c5454bb333e620ec1eb4` |
| RELEASE-NOTES.md | 19,757 | | `b71a3ebff2082f5c213531cac2d0a6fafdaa4a1e0dcc886ae0c042d4589dad29` |
| RUNBOOK.md | 27,284 | | `2d3e1195cb0d97a3e6653b8afeeb33d0aa3b24c9bce71041590188a7aa5391ab` |
| **pms-d1e7b68.zip** | 1,527,134 | | `2c161b367207d8310fddbe0fc30792eb2cd1132709ae69486f286d1f8a440669` |

Proved by the package script: no page holds a site address, a folder name, a PIN hash, the demo PIN, `p_cec_` or `CreativeExpCOE`; `pms-config.txt` is exactly
`{"configVersion": 1, "listPrefix": "", "label": "PMS"}` and no file is a `.json`; `shasum -a 256 -c SHA256SUMS.txt` passes in the folder (7 OK) and in a fresh unzip (7 OK,
exactly the folder's 8 files). Both checks were also run again by hand: 7 OK each. **`index.html` is byte for byte pms-3fb312a's** (and pms-0a1c701's: the same
sha-256), **`admin.html` is byte for byte the one the whole browser suite ran on** (built from `7e5580f`), and `setup.html` is too, but for the build's name. The admin page
is 2,092 B larger (gzip) than pms-3fb312a's 552,073 B, as RELEASE-NOTES.md says.

**The rehearsal** (`npm run test:rehearsal` with this package): **18 of 18 passed** in 2.7 minutes, six rehearsals in each of Chromium, WebKit and Firefox; the sixth follows
the note, its new step 6 included (pictures in `test-results/rehearsal/pcoe-11a2-*-note6-laptop.png`; each is taken the moment the screen goes round to the first question
again, before its bars draw in, so the bars there are empty: the step's checks are made half a second after each question appears). Its first run with the package of the first E (`56f928e`, since
replaced) failed in Firefox alone: the step resized the admin page while the tab "Open in a new tab" had opened was in front, and **Firefox does not resize a page whose
tab is behind another**, so the call waited until the test's time ran out. The step now closes that tab first; E was amended with that change (it touches no page), the
package made again from it, and rehearsed again: the 18 above.

**The note for the runbook** (RUNBOOK.md, before the steps, for the PCOE site): replace `index.html`, `admin.html` and `setup.html` in `Shared Documents/PMS` with the three
from the package and keep `pms-config.txt` as it is; nothing else changes, and the lists stay at version 3. Setup should then show the new build and say "The lists are the
version this app needs." without anything being pressed. Then, on the Windows laptop that showed the fault, full screen on a confidence question has no scrollbar inside
the card, its plot reaches down to the step names, and pointing at a column shows its tooltip whole and clear of the step's name; the figures under the bars sit on their
gridlines; the wall page ("Open in a new tab") is the same and its cards keep their own heights; and the headlines say "Most people" only above half and end with one
full stop; and the line under "Live results" counts only the iPads that answered (Kroger's "34 answers from 4 iPads"). (The note's steps 1 to 5 and 7 to 8 are 11a's: a named guest's visit by QR code, their name on the bar, the wall with no names, the iPad and the projector,
and the timing check if it is still owed.)

## 10. What only the real site can show, and what was found and left

**QA-TESTING.md items 157 to 160**: the confidence question in full screen on the Windows laptop that showed the fault (no scrollbar in the card, the tooltip whole, the
plot down to the step names, the figures on their gridlines); the wall page there and on the projector; the headlines' words for a top share of half and for an answer
that ends with a full stop; and "N iPads" counting the iPads that answered (Kroger's "34 answers from 4 iPads"; the PDF and PowerPoint still say 5 until 11b). Still owed from earlier phases: items 146 to 149 (the timing check) and 150 to
156 (the names on the bars, the wall, Show answer, the table view, an iPad, a staff name, the projector).

**Found, and left:**

- **Playwright's own scrollbars are not Windows'.** Headless Chromium on a Mac draws a scrollbar without arrows when it is launched without `--hide-scrollbars`; the
  reproduction's picture shows the bar and the cut tooltip, not the arrows of the photograph. The tests measure scroll ranges, so they do not depend on how a scrollbar
  is drawn.
- **A tooltip may lie over the words above its mark** (the question, the "N answered" line): it keeps clear of the mark's own label and a scale's average, and it lets
  the pointer through. Elsewhere it is, as tooltips are, on top for as long as the pointer is there.
- **On a phone held upright the large session's questions spill at the smallest type** (0.75): the screen scrolls as one page. Those are not walls; every landscape
  size the brief lists fits every question tested with nothing to scroll.
- **The Live display's one-page PDF and PowerPoint still count every visit** ("from 5 iPads" for Kroger), as VJR chose: Phase 11b redesigns them.
- Older and unrelated, still as they were: the type errors in `scripts/rehearsal-tests/runbook.spec.ts` near the sample pictures' theme (Playwright does not type-check);
  the local admin's participant link to the server's port; the unreadable-answers notice naming the list without the copy's prefix.
