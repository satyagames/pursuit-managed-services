# Phase 11a: Results charts, names on the charts, Deloitte colours

Date: 16 Oct 2026. Branch `pms-redesign`, on top of `656ee38` (Phase 10j, record). Nothing was pushed; `main` and the tag `legacy-final` (`2ad1520`) are untouched.

**In plain words.** With the package `pms-0a1c701` on the real site (PCOE) VJR saw Admin → Results → Live results as plain blue bars and totals only ("34 answers from 5
iPads"), and nothing showed what Mike A, a named guest who had joined by QR code and finished four activities, had picked. Each question is now a chart of its own kind,
drawn by hand (no chart library) in Deloitte's colours, with a sentence above it that says the result in words and a button that swaps it for its numbers. On the
facilitator's own view a bar opens the names of the people who picked it, with the time each answered; a switch hides them all. The wall display (full screen, and the page
"Open in a new tab" opens) has no participant's name anywhere in the page, and marks a quiz question's answer only when the presenter presses Show answer. Nothing else
changed: the exports, what is counted and stored, the lists (version 3), Setup and the participant page (byte for byte) are as they were, and no request was added. **These
pages have not run on the real site, an iPad or a projector** (QA-TESTING.md items 150 to 156).

## 1. The commits

| Part | Commit | Message |
|---|---|---|
| A | `4ff4837` | Phase 11a: one chart model for Results |
| B | `5a0613b` | Phase 11a: Deloitte palette for Results |
| C | `c37ee5f` | Phase 11a: the six charts |
| D | `8ce6398` | Phase 11a: names on the charts, admin only |
| E | `33374d1` | Phase 11a: alignment, colour and readability checks |
| F | (the commit of this file) | Phase 11a: record and package |

`git status` after F: nothing tracked is changed. The untracked brand guide, logos and Unity files under `public/assets`, `.local/` and `.claude/` are where they were, never
added (every commit was staged by name or with `git add -u`). Gate logs are in `test-results/phase-11a/` (git-ignored). The release package is made from F; since a package is named after the commit it is made from, its name and checksums are recorded in section 8 by one more commit, "Phase 11a: the package's checksums", which changes nothing else.

**Three questions were asked during the phase, and answered by VJR (16 Oct 2026):**

1. "Open in a new tab" opened the same address as the admin view, so the code could not tell them apart (as the brief foresaw): **a hash flag**. The new tab opens
   `admin.html#live-display/<sessionId>/wall` (`lib/live-wall.js`). A hash never reaches SharePoint with the page request.
2. The brand guide in `public/assets/BrandGuidelines` (the 2025 US style guide, page 42) names Deloitte Green `#86BC25` and Dark Green `#046A38`, but not the blue
   `#0076A8`, its tint `#6CB1D1`, the teal `#0097A9`, or the greys `#53565A`, `#75787B` and `#D0D0CE` (its blues are `#005587` and `#00A3E0`, its dark text `#282728`, its
   grey `#E6E6E6`): **the brief's validated set**, unchanged.
3. A staff sign-in name is in the visit log, which Results reads and the Live display did not: **no new request**. Results keeps what it read for the page's life, so a Live
   display opened from Results names staff; opened straight from its address it calls them "Unnamed participant N". (A guest's QR name, Mike A's case, is on the visit itself.)

## 2. What was found before starting (step 3 of the brief)

- **Names on the Live results page before this phase:** one place, the notice "N participants' answers could not be read ... : <names>" (`unreadableNotice`, from the QR name on
  each visit), shown in the admin view **and in full screen**. Nothing else on the page named a participant (the comments had no authors; the picker lists clients). Changed:
  on the wall that notice now says how many and no names.
- **How the three views were told apart:** full screen was the page's own state (`presenting`); "Open in a new tab" opened `admin.html#live-display/<id>` after a PIN, the same
  address and the same view as the facilitator's. They could not be told apart: the phase stopped and asked (question 1 above).
- **How each kind of answer is stored** (the record's `answer`, as `lib/leader-report.js` describes it): single choice and true or false, the option id (the first pick for a
  graded question); multiple choice, an array of option ids; a confidence scale, one option id whose option's `value` is its place (1, 2, 3 ...); a ranking, every option id,
  best first; written answers, the words (1,000 characters at most). **Ranking points are as the brief expected:** with n options, first place is n points and last 1, counted
  among the options the question has now (`lib/results-tally.js`).
- **The biggest confidence scale:** the seeds have one scale, of 3 steps (`server/data`; the sample clients have none); Content starts a new scale at 3 and allows 2 or more with
  no maximum. The model takes any number; the blue ramp has five shades and a longer scale shares them out in order.
- **A dark surface:** full screen's page is dark (black to the client's colour), but every chart was, and is, drawn on a white card. So no dark values were added.
- **Did the Live display mark a correct answer?** No: Chart.js drew every bar in the client's primary colour, on the Live display and on Results' cards alike.

## 3. The gates, before and after

| Gate | Before (`656ee38`, a fresh worktree) | After (F's tree) |
|---|---|---|
| `npm run check:svelte` | 0 errors, 0 warnings (412 files) | 0 errors, 0 warnings (357 files: Chart.js's own type files are no longer read) |
| `npm test` | 1,179 passed | 1,209 passed (+19 the chart model, +6 the palette, +2 the wall's address, +2 the bundle's Phase 11a checks, +1 the notices) |
| `npm run test:baseline` | 37 passed | 37 passed; **no request baseline changed** (`git status scripts/request-baseline` is empty) |
| `npm run test:bundle` | passed | passed (34 tests) |
| `npm run test:report:mutations` | 34 of 34 caught | 34 of 34 caught |
| `npm run oracle -- --seeds 500` | 0 differences | 0 differences |
| `npm run test:migration` | 1,126 passed, 26 skipped, 0 failed (Chromium 428; WebKit 331 + 13 skipped; Firefox 367 + 13 skipped) | 1,161 passed, 26 skipped, 4 failed of 1,191 (Chromium 441 + 2 failed; WebKit 342 + 13 skipped + 1 failed; Firefox 378 + 13 skipped + 1 failed). The four: the DI-6 test of `review-9b.spec.ts` in each engine still read the old Results tally ("2 of 4 answered") and was missed in C, now fixed (it reads the new card's "2 answered"); and `participant.spec.ts:91` in Chromium, a timing flake (5.1 s against its 5 s, on a participant page that is byte for byte as it was), which then passed 3 times of 3 alone. **Re-run on F's tree** after that fix and one more (Show answer and View as table no longer carry `aria-pressed`: a toggle changes its words or its pressed state, never both): `review-9b`, every `results-charts-*` and `live-display*` spec and `a11y` in three engines, **164 passed, 4 skipped, 0 failed** (Chromium 72; WebKit 41 + 2 skipped; Firefox 51 + 2 skipped), and `check:svelte`, `npm test`, `test:bundle` again (below). |

The exports were not touched: their tests (Export CSV, PDF and PPT in `live-display.spec.ts` and `live-display-smoke.spec.ts`, the leader report and the participant CSV
in `npm test` and `leader-report.spec.ts`) pass, and the oracle finds 0 differences.

## 4. Page sizes (gzip -9)

| Page | Before (this checkout) | After (this checkout) | Change |
|---|---:|---:|---:|
| participant (`index.html`) | 156,710 B | 156,710 B | **0 B, byte for byte** (sha-256 `44e0277a...` before and after, built from this checkout) |
| admin (`admin.html`) | 606,141 B | 552,083 B | −54,058 B (Chart.js out, the charts in), under its 700,000 B budget by 147,917 B |
| setup (`setup.html`) | 792,620 B (fresh) | identical but for the build's name | 0 B |

`PHASE_11A` (`scripts/bundle-budget.js`) holds the participant page at 0 B of allowance **and to its exact Tailwind rules** (`participantUtilities`, 30 class names): Tailwind
reads every file under `migration/` for class names, comments and words a page shows included. Twice during the phase a new file changed the participant page that way
(`@container` from a size query, `.table` from the words "View as table" in a comment) and once a removed file did (the old card held the word "container", and without it the
page lost its `.container` rule); each was put right and is now a failing test. `scripts/test-bundle-budget.js` still forbids every export library in the participant page,
and now the Results charts too.

## 5. Part by part

**A, the chart model** (`migration/src/lib/results-chart-model.js`, plain JS, no DOM): `chartOf(question, { names })` returns what a chart needs, by kind (`choice`, `multi`,
`truefalse`, `scale`, `ranking`, `text`): every answer with `id`, `label`, `count`, `share`, `percent`, `who` (names and times), `isCorrect` and `isTop`; a headline; and the
kind's extras. Shares are counts over the people who answered; single choice, true or false and a confidence scale (one answer each) are rounded by the largest-remainder rule
to exactly 100, and an answer to an option that has since been removed takes its share of that 100 and is said under the chart; multiple choice is rounded alone and says
"People could pick several answers, so the bars add up to more than 100%." Headlines: "Most people (50%) chose 1014 Vine Street, Cincinnati.", "A tie between X and Y (2
each).", "No answers yet.", "3 of 4 got it right first time.", "Picked most: Email, by 3 of 4 people (75%).", "75% said True.", "Average 2.0 of 3. Most people (100%) chose
Moderately confident.", "A tie between Faster checkout and Better pay (support score 69 each).", "4 comments. The word that came up most is “delivery”, in 3 of them." The
support score is **the brief's formula**, `(points − answered) ÷ (answered × (options − 1)) × 100`, rounded, where "answered" is the people who ranked that option: the same
number whenever everyone ranked every option (it differs only for an option added after some people answered, whose rankers are fewer). The tests, worked out by hand from
VJR's figures (`scripts/test-results-chart-model.js`): 1, 2, 1, 0 of 4 are 25, 50, 25, 0; points 15, 15, 13, 9, 8 of four voters are scores 69, 69, 56, 31, 25, ranked 1=, 1=,
3, 4, 5 (the four rankings that give those points are in the test); counts 0, 2, 0 average 2.0 of 3; a multiple choice of 175%; a tie; no answers; an unnamed participant;
accents and a name that starts with "="; an answer removed after it was given; a written answer of 1,000 characters. Four mutations of the module were each caught
(`test-results/phase-11a/A-mutations.log`).

**B, the palette** (`migration/src/styles/results-tokens.css`, the admin page's alone): as the brief gave it. `scripts/test-results-palette.js` reads the file and holds every
pair to its stated contrast; changed tokens were caught by name (`test-results/phase-11a/B-mutations.log`). Its output:

```
   5.05:1  (at least 4.5:1)  the blue bars on the card
   5.05:1  (at least 4.5:1)  white words on the blue
   2.37:1  (at least 2:1)    the tint bars on the card (each bar has its value written beside it)
   2.13:1  (at least 2:1)    the tint against the blue
   8.85:1  (at least 4.5:1)  black words on the tint
   6.72:1  (at least 4.5:1)  the correct answer on the card
   6.72:1  (at least 4.5:1)  white words on the correct answer
   6.72:1  (at least 3:1)    the average marker and thin lines
   9.23:1  (at least 4.5:1)  black words on Deloitte Green
   6.00:1  (at least 4.5:1)  black words on the teal (and white on it is held under 4.5:1: never used)
  21.00:1  (at least 4.5:1)  the main words
   7.38:1  (at least 4.5:1)  the secondary words
   6.70:1  (at least 4.5:1)  the secondary words on a scale's shaded band
   4.44:1  (at least 3:1)    the muted words, at 18px or bold 14px and more only
  ramps: 3 steps light end 2.37:1, hue spread 7.4 degrees; 4 steps 2.15:1, 7.6; 5 steps 2.15:1, 8.5 (each step darker, 1.3:1 apart or more)
```

**C, the charts** (`migration/src/admin/charts/`): `ResultCard` (the headline, the question, "N answered", a 4px Deloitte Green rule, View as table, Show answer on the wall),
`BarChart` (single and multiple choice, and a ranking's support scores with its places), `SplitBar` (true or false: True on the left in Deloitte Blue, False on the right
in the tint, each side labelled "True 72%"), `ScaleChart` (a column for each step on the blue ramp, three light bands behind them, the average as a Dark Green line at its
true place and a pointer on the axis), `WordsChart` (the words that came up most, each a button; the comments, word for word, the chosen word bold and underlined; "Showing 3
of 12 comments", 20 and then Show more), `ChartTable` (the numbers view, right-aligned), `NamesPanel` and `ChartTip` (the value first, then the label). Bars are at most 24px
thick (scaled on the wall as Phase 7c scales it), rounded at the value's end and square on the baseline, with hairline gridlines at every quarter; a bar draws in once (400
ms) and then moves smoothly on each refresh; `prefers-reduced-motion` stops both. The Live display draws them in its grid and one at a time in full screen; each Results card's
"Live results" draws them when it is opened. They replaced `public/js/resultsRenderer.js` (Chart.js) and `ResultQuestion.svelte`, which are removed; `chart.js` moved to the
dev dependencies (only the bundle test's negative control imports it) and left THIRD-PARTY-NOTICES. Six browser specs that read the old canvases read the new cards (`live-display`, its smoke and SharePoint specs, `a11y`, `contrast`, `motion`).

**D, names.** On the admin view every mark opens `Who picked: <answer> (N people)` under its card, each name with its time ("How people ranked" for a ranking, with each
person's place); as many names as the mark counts; open through a refresh (kept by answer), closed by Esc (the card the keyboard is in, else the most recent: Safari does not
focus a clicked button) and by its close button, focus back to the mark; `aria-expanded` and a live count. **Names shown** (on, one press to hide) takes every name out of the
page. On the wall the charts are made from a model given no names. `results-charts-names.spec.ts` walks each wall mode (full screen from the admin view, the wall page, and full
screen from it), every question, a pointer on every mark, every mark pressed, every word chosen, Show answer and every numbers view, and reads
`document.documentElement.outerHTML` for Mike A, José Álvarez and =SUM(A1) (and "Unnamed participant 1" in everything but the page's own scripts, which hold those words for
the leader report's rules): none, in three engines. `results-charts-wall-mutation.spec.ts` builds the admin page with `withNames` no longer asking whether this is the wall, and
the same walk finds 224 names (Chromium). No request was added: the request baselines are unchanged, and the SharePoint budget spec still holds the Live display's opening to
its 6 requests from the PIN.

**E, alignment, colour and readability** (VJR's run in miniature, `scripts/results-charts-fixtures.js`, and a large session: 60 people, 15 questions, 90-character answers,
eight to a question, a 100-character name, accents, a name that starts with "="):

- `results-charts-layout.spec.ts`, three engines, at 390x844, 820x1180, 1280x800, 1024x768 and 1920x1080: no sideways scroll; no words cut by a card or on top of other words
  (every line's box, pairwise); the labels on one left edge and the bars on one baseline (the gridline baseline too); True and False at their bar's ends; a scale's labels
  under their columns; every numbers view right-aligned; nothing under 12px; on the wall the type as Phase 7c sizes it (1.2 to 2.4 times the window, smaller only for a card
  that would not fit, never under 0.75) and one question whole on the screen.
- `results-charts-a11y.spec.ts` (Chromium): axe at WCAG 2.1 A and AA, colour contrast on, on Live results for both sessions as drawn, with a names panel open on every chart
  and a word chosen, every numbers view, the names hidden; the wall page with every answer shown and its full screen question by question; and Results' card with a panel, a
  word and a numbers view: **nothing found.**
- `results-charts-greyscale.spec.ts` (Chromium): each chart photographed, made grey, and the two marks measured:

```
  3.61:1  choice: the correct answer (Dark Green) against the tint (greys 70 and 160)
  2.72:1  choice-top: the top choice (Deloitte Blue) against the tint (greys 88 and 160)
  2.72:1  multi: the top choice against the tint (greys 88 and 160)
  3.61:1  truefalse: True, the correct answer (Dark Green), against False (the tint) (greys 70 and 160)
  2.72:1  truefalse-wall: True (Deloitte Blue, the answer not shown yet) against False (greys 88 and 160)
  2.72:1  ranking: the top place against the tint (greys 88 and 160)
  4.53:1  scale: the high end of the ramp against the low end (greys 63 and 170)
```

  (1.5:1 asked. The greys match what the hexes give by hand: `#0076A8` is 88, `#6CB1D1` 160.)

**The pictures** are in `test-results/charts/`: each kind on the admin view and the wall, at a phone and a laptop (`admin-*`, `wall-*`), Results' card with a names panel open
(`results-names-panel-*`), and the grey ones (`grey-*`); the names panel at 1280 and on an iPad-sized touch screen is in `test-results/admin/charts-names-panel-*.png`.
**What was changed after measuring and looking:**

1. A scale's step labels were off their columns (a gap between the labels' columns that the plot did not have).
2. The ranking's numbers view ran past a phone's card: the rank and the answer are one column now, and the headings over numbers wrap.
3. In full screen a chart could shrink under its own words (on a phone the caption of a multiple choice was drawn over its last bar), where the fit could not see it: the
   chart now never takes less room than it needs, so a card too tall is made smaller instead.
4. Written answers in full screen on a phone had room for no comment ("Showing 0 of 4"): the words sit above the comments on a screen held upright, and the comments keep room
   for one, so the type is made smaller until one fits.
5. Bars in full screen keep the brief's 24px hit area instead of the admin page's 44px target (a bar opens nothing on the wall), so eight 90-character answers fit 1024x768.
6. A scale's columns are drawn to the tallest, not as a share of everyone (12 of 60 people at each of five steps were stubs at the foot of an empty plot).
7. On a phone a bar is under its label, at the card's whole width (beside it, a full bar was a few dozen pixels and the scale's "50%" and "100%" touched).

And from the first look in the browser (C): View as table beside "N answered" instead of a row of its own; the average line behind the columns, the counts on their band's
colour and a pointer on the axis (the line ran through the middle column's count); a scale's band names under the axis only when a band holds more than one step (with three
steps they repeated the step labels); 44px targets on the admin view (an AGENTS.md rule the first spec run held).

## 6. Every decision not in the brief

1. **Names as the Results cards print them: "Mike A (2)"**, not "· Visit 1/2". The brief asks for the Results cards' names, and since Phase 7c those cards print
   `lib/participant-names.js`'s "Name (2)" ("· Visit 1" was the label it replaced).
2. **Each Results card's "Live results" draws the same charts**, with names (the words VJR quoted, "Live results · 34 answers from 5 iPads", are that section's), when it is
   opened; Results already reads every name source, so no request.
3. **The charts were wired into the page in C**, not F, so that D and E could test the real page; F moved the Results grid's rules out of `src/admin.css` (Setup loads it).
4. **`resultsRenderer.js` and `ResultQuestion.svelte` were removed**, `chart.js` moved to the dev dependencies, and THIRD-PARTY-NOTICES no longer names chart.js or
   @kurkle/color (a test now says so); the tests that listed the renderer were updated.
5. **A ranking's names panel lists everyone who ranked the answer, with the place they gave it** ("How people ranked: X (4 people)"), first places first.
6. A confidence scale's shares are rounded by the largest remainder too (one answer each, as single choice).
7. The headlines for multiple choice, true or false, a scale, a ranking and written answers (the brief gave the single-choice, tie and no-answer ones), and "N people chose an
   answer that has since been removed; it is in no bar." under a chart.
8. The bars are a share of 0 to 100% with gridlines at every quarter and "0%, 50%, 100%" under them (a ranking: 0, 50, 100); a scale's columns are to the tallest.
9. Labels are to the left of their bars from 560px wide and above them below it (where the gridlines and the scale are left out: they would run through the labels).
10. Every mark is a `<button>`; pressing it shows its tooltip, and opens its names where names are shown. Several cards can have their names open at once.
11. Show answer is a toggle (Hide answer); on the wall "N of M got it right first time" is said only once the answer is shown.
12. The wall page is the Live display's grid with no names, headed "Live results · Wall display", with its own Full screen; its ← Results button stays.
13. The Names shown switch is on each time the Live display opens (kept in memory only), and the note beside it says to hide the names before sharing the screen.
14. Written answers: comments oldest first, each with its author and time on the admin view; Show more adds 20.
15. The specs that walk the wall run with the display's own cover (as on an iPad): Playwright's WebKit often ends its own element full screen a moment after it began, in a
    headless window, and the display rightly follows it out. Native full screen is still exercised by `live-display-smoke.spec.ts` in three engines.
16. `npm run test:charts` runs the three node suites of this phase.
17. The runbook's note for the PCOE site (section 8) keeps the 10j timing check as its last step, for whoever has not sent it; QA items 145 and 155 are listed as "later".

## 7. The palette and the brand guide

See question 2 in section 1: only Deloitte Green and Dark Green of the palette are in the 2025 guide; the rest is the set VJR validated on 15 Oct 2026, kept on 16 Oct. The
client's colours do not recolour the data: the client's logo, name and colour stay in the Live display's heading.

## 8. The package and the runbook note

**`pms-3fb312a`**, made from `3fb312a` (F) by `npm run package:release` in a fresh worktree of that commit: `build-svelte/package/pms-3fb312a/` and `pms-3fb312a.zip`
(git-ignored, never committed).

| File | Bytes | gzip -9 | SHA-256 |
|---|---:|---:|---|
| index.html | 372,754 | 156,699 | `707beef98e236cc17a5299b0874325ca9a54d5f051284ff2a6889b2bd9d2f19c` |
| admin.html | 1,514,947 | 552,073 | `57b0385cb525565911bf34fd8504345ef8a2747b6333e56d8a23e7133cc17f4f` |
| setup.html | 1,172,119 | 792,620 | `ac79016f5ed1b6455df48b1021a231f778a0b5712dcf600d34a5c83b2e3b75ea` |
| pms-config.txt | 54 | | `04426124f56abad3973d69fb4a8608e673d86745419bf1cc41c5a70441cc607f` |
| THIRD-PARTY-NOTICES.txt | 40,835 | | `e4ecfa86a85da94926f3f25b9f2b99791c38cc3ea100c5454bb333e620ec1eb4` |
| RELEASE-NOTES.md | 16,935 | | `47e55ad56f6ca7e07a51f78f98228739c6bcfa6670c89cdef222957dc7a6265d` |
| RUNBOOK.md | 25,229 | | `0a4610197aba8eacf6b0864c10e1e8fb67342f84be5a0c0ce64a8c145e6633b9` |
| **pms-3fb312a.zip** | 1,523,284 | | `494f4162c17a0db2314a9b7849d4c63c0a941a3bc6ec73c2fc0beeead938c51c` |

Proved by the package script: no page holds a site address, a folder name, a PIN hash, the demo PIN, `p_cec_` or `CreativeExpCOE`; `pms-config.txt` is exactly
`{"configVersion": 1, "listPrefix": "", "label": "PMS"}` and no file is a `.json`; `shasum -a 256 -c SHA256SUMS.txt` passes in the folder (7 OK) and in a fresh unzip (7 OK,
exactly the folder's 8 files). Both checks were also run again by hand: 7 OK each. `index.html` is byte for byte `pms-0a1c701`'s; `setup.html` is too, but for the build's
name; `admin.html` is 1,514,947 B where `pms-0a1c701`'s is 1,669,838 B. **The rehearsal** (`npm run test:rehearsal`, the newest package): 18 of 18 passed in 2.0 minutes,
six rehearsals in each of Chromium, WebKit and Firefox, the sixth following this note (pictures in `test-results/rehearsal/pcoe-11a-*.png`).

**The note for the runbook** (RUNBOOK.md, before the steps, for the PCOE site): replace `index.html`, `admin.html` and `setup.html` in `Shared Documents/PMS` with the three
from the package and keep `pms-config.txt` as it is; nothing else changes, and the lists stay at version 3. Setup should then show the new build and say "The lists are the
version this app needs." without anything being pressed. Then a named guest checks in by QR code on an iPad and answers an activity; on the Live display the bar of an answer
they picked names them; full screen and the page "Open in a new tab" opens show no name, and a quiz question's answer only after Show answer; the iPad in Safari and the
projector are looked at; and the 10j timing check is run if it is still owed. A sixth rehearsal (`npm run test:rehearsal`) follows that note on the mocked site with the
package's own pages, in three engines.

## 9. What only the real site can show

QA-TESTING.md items 150 to 156: a named guest on the right bar on PCOE; no names in full screen and on the wall page there; Show answer; the table view; the charts on an iPad
in Safari (and a tap opening the names); a staff sign-in name on the Live display (opened from Results, and straight from its address); Deloitte's colours on the room's
projector. Still owed from Phase 10j: items 146 to 149 (the timing check before and after).

## 10. Found, and left

- **A very long question in full screen on a phone or an upright iPad is cut at its card's edge.** Sixty people's eight 90-character answers do not fit a 390x844 or 820x1180
  full screen even at the smallest type (0.75): the card keeps its width, nothing is cut sideways, and the bottom of the chart is cut, as Phase 7c decided for a card that
  cannot fit. Those are not walls; at the three landscape sizes every question of that session fits.
- **A staff sign-in name on a Live display opened straight from its address** is "Unnamed participant N" (question 3; QA item 155).
- **"Most people (25%) chose X."** is the brief's wording whatever the share; with many answers and a low top share it reads oddly. Left as asked.
- **Playwright's WebKit ends its own element full screen by itself** in a headless window (see decision 15); real Safari on a Mac, and an iPad (which only has the cover),
  are not known to.
- **Older type errors** in `scripts/rehearsal-tests/runbook.spec.ts` line 161 (three, on the sample pictures' theme), from before this phase; Playwright does not type-check.
- The unreadable-answers notice names the list by its title without the copy's prefix (`UNREADABLE_FIX`), as it did before this phase.
