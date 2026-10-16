# Phase 11b: the leader report and the Live display's one-page PDF and PowerPoint, on the shared chart model and palette

Branch `pms-11b`, made from the tip of `pms-11a3` (`168ca75`, which contains `e2fbfb6`, "a ranking's places are plain numbers"). Nothing was pushed. Items A to D are done,
each with tests written first and shown failing on the old code; every gate of the brief's section 6 was run with Node 22 on this Windows machine, before (`168ca75`, in a
separate worktree) and after. **Nothing has been saved from the real site, opened in PowerPoint from there, or printed**: QA-TESTING.md items 167 to 170.

**D3, the blues: the default was used.** Nobody had an answer when this ran, so the charts on paper use the validated palette of `migration/src/styles/results-tokens.css`
(`#0076A8` and its tint, `#046A38` for the correct answer, `#86BC25` as an accent only), and every colour of a chart on paper is read from that one file: moving to the brand
guide's `#005587` and `#00A3E0` is a change of that file alone (and of `scripts/test-results-palette.js`, which holds its values).

## 0. Where this started

- Branch `pms-11b` from `168ca75`. The machine notes of RELEASE-11A3.md section 0 held: Node 22 is `.local/node22/node.exe` (the system Node is 20.13), `core.autocrlf input`,
  the canvas binary and the three Playwright browsers installed. Nothing new was needed.
- The "before" gates ran in a worktree of `168ca75` (`D:\Deloitte\Projects\pms-before-11b`, `node_modules` linked) while the work went on here, so the two never mixed.
- The four project documents the brief names (`pms-handoff-status.md`, `pms-session-handover.md`, `pms-colleague-handover.md`, `pms-11a2-verification-status.md`) are not in this
  repository or anywhere under `D:\Deloitte`, and were not updated (as in 11a-3).

## 1. The items

| Item | Commit | What changed | Test first (failed on the old code) |
|---|---|---|---|
| A, the iPads line | `3f4bc2d` | `buildReport` takes `answerCounts` from the chart model over the live activities' questions, and the header is `answersFrom()`: Kroger's five visits (9, 8, 0, 8, 9 answers) and a sixth whose answers could not be read are "34 answers from 4 iPads". **The screen said "1 answers from 1 iPads"**: `answersFrom` is singular for one now, on the screen and in the files ("1 answer from 1 iPad"; `admin-today.spec.ts` pinned the old words and was changed with it). The writers take their library (`pdfBytes`, `pptxFile`) so node can write and read both files. | `scripts/test-results-export.js` (new): 3 of 3 failed (the report said 6 iPads; no writer could run in node). `test-results-chart-model.js`: the singular test failed ("1 answers from 1 iPads"). |
| B, the one-pager's charts | `d58ebfc` | Each live question's card is the Live display's chart from `chartOf(question, { names: null })`: headline, question, "N answered", "N of M got it right first time", bars in the screen's order (correct Dark Green with a tick and "Correct", top choice blue with "Top choice", the rest the tint), a true-or-false split, a scale's columns against the tallest with shaded bands and the average line, a ranking's places and support scores, the words that came up most and the first three comments. No names. `lib/results-chart-figure.js` draws a chart as primitives for both files; `lib/results-palette.js` reads every colour from `results-tokens.css` (`?raw` on the admin page). One layout still, one page for a typical session. | 5 of 7 new tests failed (the headlines, captions and values missing, no ticks, tags, places or average line, colours not the palette's); the no-names guard and "one page" already held. |
| C, the leader report | `87d86df` | "Results by activity" prints each question's chart-model headline and "N of M got it right first time" and draws it with the same figure in the palette (`chartOfQuestion` in `lib/leader-report.js`: the model over the report's own counts, the first pick of a graded question, no times, no names). The facts under each question, the cover, the comments with names, the notices, "Confidential – internal" and the rules are as they were; the last page adds `LIVE_FILES_NOTE` after the rules. Bars sit on white with gridlines at 0, 50 and 100% (the screen's), and a long chart may carry on overleaf between two bars. | `scripts/test-leader-report-charts.js` (new): 6 of 7 failed; "every number it printed before" already held, as it must. The old test that pinned "1887 (correct answer)" and "1. Quality … 8 pts" now holds the new words. |
| D, print and accessibility | `e2ea2f5` | `scripts/print-contrast.js`: every word against the fill under it (4.5:1), every meaningful mark against its ground (3:1), over the one-pager (five sessions) and the leader report (Harbour, 60 people), with negative controls. **Found and fixed:** the one-pager's header put white words on a client colour of middle lightness at 3.67:1 (`#3C8DBC`; a fixed luminance threshold of 0.4); it now takes whichever of white and near-black has the more contrast. The one-pager's text boxes are held to Helvetica's own widths (jsPDF), inside their cards and the page; the leader report's existing layout guard covers the new items. Two paper-only pairs join `test-results-palette.js`. | The contrast test failed on the old header ("Session results" 3.67:1 on #3C8DBC). The report's contrast already held (no fault found there); its negative control shows the check can fail. |
| Mutations | `4b73c32` | 15 new mutations of the drawing and the words (49 in all), each naming its file and suites; the broken copy is swapped in by a resolve hook (`scripts/mutation-redirect.mjs`), never written over the file. The failed-test count is read from TAP too (it printed "?" when piped). | 49 of 49 caught; a copy identical to the file passes, a broken one fails (checked by hand). |
| Documents | `21462b6`, `07fefa7`, `bd62516` | RUNBOOK.md's PCOE note (a paragraph on what this package redraws, and step 9, the files), RELEASE-NOTES.md "What changed since pms-e2fbfb6", `BRANCH = 'pms-11b'`, QA items 167 to 170, AGENTS.md "Rules from Phase 11b". | `scripts/test-release-docs.js` 15 of 15. |

**Every number of the leader report stayed as it was**: `npm run oracle -- --seeds 500` gives 0 differences after as before, `COUNTING_RULES` are the same eight, and the report's own
test of the Harbour figures passes unchanged in its numbers. The bars' shares are the chart model's (largest remainder, as on the screen); for Harbour they are the same
figures as before ("3 · 50%", "2 · 33%", "1 · 17%", "0 · 0%"). One figure is no longer drawn as a bar: answers to an option that has since been removed had a bar row of their
own in the report; the chart model puts them "in no bar", and the report's own note under the question still says how many there were.

**Too many questions for one page** (the one-pager's present rule): the rule is unchanged. It tries two and three cards across and keeps the layout with the fewest pages, and a
row of cards that does not fit starts a new page. No fault was found in it. **But the cards are taller**, because they carry what the screen's cards carry (the headline, "N of M
got it right first time", tags under a label, labels on two lines where they were cut to one): Vine (six questions), Kroger (nine) and the other-scripts session are one page
before and after, and the 60-person session of 15 questions with 90-character answers is **5 pages where it was 3** (measured by laying both versions out). Cutting labels to
one line again would win some of that back at the cost of the screen's never-cut labels; that is a choice for VJR, and nothing was changed for it.

## 2. What the pictures showed (pdf.js in Chromium, and PowerPoint for the slide)

Rendered with `scripts/render-pdf-pages.js` (and a greyscale copy of every page) from the fixtures: Vine (VJR's run in miniature: all six kinds), Kroger (five visits and an
unreadable one), 60 people and 15 questions (90-character answers), other scripts and emoji with a 1,000-character comment and a removed option; the leader report for Harbour,
for Harbour as a sample client with an unreadable item (both notices on the cover), and for 60 people (39 pages). Every page was looked at, in colour and in greyscale.

- **Fixed after looking**: the scale's average line ran through the tallest column's "100%" (it now starts at the plot's top); the "got it right first time" line was cut when the
  activity's title was long (it has its own line now, never cut); the scale's columns were scaled to 100% rather than to the tallest, with no shaded bands (now as the screen);
  the bars had a grey track the screen does not have (now white with the screen's gridlines).
- **Seen and right**: headlines above every chart; ticks and "Correct" beside every correct answer; "Top choice" on every tied leader; the ranking's "1", "1", "3" places and
  "Support N"; the split bar with a white gap between its sides; in greyscale the correct and the top bars are nearly the same grey and are told apart by their words, as
  intended; the cover, the notices in bold, the counting rules and the new sentence on the last page.
- **The PowerPoint**: PowerPoint is installed here, so the Vine and other-scripts slides were exported to pictures by PowerPoint itself (read-only, no window): the slide matches
  the PDF, ticks and lines included. Its text was also checked from the slides' XML by the test.
- **Other scripts and emoji in the one-pager's PDF**: Helvetica cannot draw them and `pdfSafe` leaves them out, as it always did: "東京 (Tokyo)" prints as "(Tokyo)", the
  client "Ünïcode 東京 😀" as "Ünïcode", and a comment written only in Japanese as empty quotation marks. **Left as it is, and said here**: the PowerPoint keeps every
  character, the leader report prints one replacement mark for each and says so on its last page, and the CSV keeps them.
- **The tint**: the bars that are neither correct nor the top choice are `#6CB1D1`, 2.37:1 on white (a scale's lightest step 2.16:1 on its shaded band). The brief asks 3:1 of
  every mark that carries meaning; the palette holds these at 2:1 with the value written beside every one, as on the screen (11a), and the test holds that the value is there.
  **This needs VJR's word with D3**: meeting 3:1 for those bars means a darker tint (a change of `results-tokens.css`), or an outline on paper that the screen does not have.

## 3. The gates, before (`168ca75`) and after, Node 22, this Windows machine

| Gate | Before (`168ca75`) | After (`07fefa7` and the spec fix `bd62516`) |
|---|---|---|
| `npm run check:svelte` | 0 errors, 0 warnings (359 files) | 0 errors, 0 warnings (362 files) |
| `npm test` | 1,242 of 1,242 | **1,268 of 1,268** (26 new: the two new suites, the singular, the palette pairs, the docs) |
| `npm run test:baseline` | 37 of 37 | **37 of 37: no request baseline moved** |
| `npm run test:bundle` | 35 of 35; participant 156,729 B, admin 554,263 B | **36 of 36**; participant 156,729 B, **byte for byte** (sha256 `f7fbfd67…`, its Tailwind rules 11a's), admin **558,745 B (+4,482)**, under `PHASE_11B`'s 12,000 B and the 700,000 B budget |
| `npm run test:report` | 85 of 85 (three suites) | **109 of 109** (five suites: the two new ones join it) |
| `npm run test:report:mutations` | 34 of 34 caught | **49 of 49 caught** |
| `npm run oracle -- --seeds 500` | 0 differences (500 sessions, 5,620 participants) | **0 differences** (the same) |
| `npm run test:migration`, Chromium | 2 failed: `admin-today.spec.ts:421` (the known flake of 10h) and `brand-studio.spec.ts:1063` | first run: 5 failed. Three were specs that pinned the words this phase changed on purpose ("3 answers from 1 iPads", "6 answers from 1 iPads", "1887 (correct answer)"): `live-display-smoke.spec.ts:13`, `clients.spec.ts:120`, `leader-report.spec.ts:37`, changed to the new words (`bd62516`) and **passing** when run again. `admin-today.spec.ts:249` failed under load and **passes 3 of 3 alone, before and after**; `brand-studio.spec.ts:1063` and `:421` passed this time. |
| `npm run test:migration`, WebKit | 20 failed: the 18 sound specs, `brand-smoke`, `flow.spec.ts:456`, `keyboard.spec.ts:314` (as in 11a-3) | the same 20, and the same three word specs (passing after `bd62516`) and `participant.spec.ts:25` (a visit written 3 times where 2 were expected; the participant page did not change, and it **passes when run again**) |
| `npm run test:migration`, Firefox | **not run**: Windows refuses to start Playwright's Firefox (`spawn UNKNOWN`, 378 tests), as in 11a-3 | the same |
| Whole run | 785 passed, 400 failed, 19 skipped, 17 did not run (42.2 min) | 772 passed, 407 failed, 19 skipped, 23 did not run (42.0 min), before the spec fix; the spec fix's rerun: 11 passed, `admin-today.spec.ts:249` as above |

The before run's `test:report` gate was the three suites it had; the after run's is the five `npm run test:report` has now. The browser rerun after `bd62516` covered the five failing
tests in Chromium and WebKit, not the whole suite again.

## 4. The package

**`pms-21462b6`**, made from commit `21462b6` (the documents' commit) on 17 Oct 2026 by `npm run package:release` (a fresh checkout of that commit, Node 22, Windows), in
`build-svelte/package/pms-21462b6/` and `pms-21462b6.zip` (git-ignored, never committed). The commits after it (`07fefa7`, `bd62516` and this report) change only a
recorded figure, specs and this file: no page. `SHA256SUMS.txt` passes in the folder (7 OK) and in a fresh unzip (7 OK), checked by the script and again by hand with
`sha256sum -c`. The script also proved no page holds a site address, a folder name, a PIN hash, the demo PIN, `p_cec_` or `CreativeExpCOE`, and that `pms-config.txt` is
exactly the settings text and no file is a `.json`.

| File | Bytes | gzip -9 | SHA-256 |
|---|---:|---:|---|
| index.html | 372,890 | 156,729 | `f7fbfd67f27fe80da8c81746bcb3f871b09586b82cdd7f309d7c98928df75ef8` (byte for byte pms-618b8fc's to pms-e2fbfb6's) |
| admin.html | 1,536,281 | 558,745 | `4ec1ea7975bab831374f1ca60ed1c7d3c40c8a839494db70f53828911e0c6037` |
| setup.html | 1,172,119 | 788,833 | `06020d32b06acf283fe51d33fb2fb2a07aa3b1d698c267936e406275a866bdb3` |
| pms-config.txt | 54 | | `04426124f56abad3973d69fb4a8608e673d86745419bf1cc41c5a70441cc607f` |
| THIRD-PARTY-NOTICES.txt | 40,835 | | `e4ecfa86a85da94926f3f25b9f2b99791c38cc3ea100c5454bb333e620ec1eb4` |
| RELEASE-NOTES.md | 24,616 | | `6c8d863ba0aa31c7240715dae60db6115aaa6e1a6f9220ba274f092778572e31` |
| RUNBOOK.md | 31,760 | | `349f89520fce809a9cce6e2dc8034157688d0d357c44b156103b351a37f66ebd` |
| **pms-21462b6.zip** | 1,537,706 | | `f1670bdce3397734d8cbcf1b3032986580ad25390a160714b99b22a154279473` |

For the PCOE site: replace the three pages (RUNBOOK.md's note, steps 1 to 9). Nothing in Setup or the lists changes; the participant page is the one already there.

## 5. What was not done, and what only the real site can show

- **Nothing was saved from the admin page in a browser.** The files were made in node by the same model, layout and writers; the admin page's own buttons were not pressed in
  a browser with these changes, except as the existing specs press them (`live-display*.spec.ts`, `leader-report.spec.ts` in section 3).
- **QA-TESTING.md items 167 to 170**: the Export PDF and PPT for Kroger from the real site ("34 answers from 4 iPads", no names, PowerPoint opened in PowerPoint), the leader report
  for Kroger and Domino's in Edge or Acrobat, the leader report printed in black and white, and a session of one iPad.
- **D3** and the tint's contrast (section 2) are VJR's to decide.
- `npm run test:rehearsal` was not run (as in 11a-3).
