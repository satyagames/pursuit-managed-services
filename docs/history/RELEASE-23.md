# Prompt 23: "Art of the Possible" activity type, and an optional picture for each guest

Branch `pms-23`, made from `8f8937f` (the tip of `pms-22`, which holds `pms-20`, `pms-21-1` to `pms-21-7` and `pms-22`; none is pushed). Not pushed.

**Run Setup's upgrade before the pages are replaced.** Schema version 9 adds exactly two optional columns, `PMSActivityQuestions.Criteria` and `PMSGuestList.PictureUrl`. A page of this
build on a version 8 site stops with PMS-LST-011 until Setup has run. No new list, dependency, capability or `pms-config.txt` key. A session with no such question looks as it did; a guest
with no picture looks as today plus the silhouette.

## Every place that switches on a question type (Part 0)

| File | Change |
|---|---|
| `lib/schema/pms-schema-meta.js` | The word `art-of-the-possible` in `QuestionType`. |
| `admin/QuestionEditor.svelte` | A seventh type, `options: 'matrix'`, drawn by `admin/MatrixEditor.svelte`. |
| `admin/ContentQuestions.svelte` | The row's summary; no "N options". |
| `lib/participant/pager-logic.js` | An explicit case in `isAnswerComplete` and `normalizeAnswer`. |
| `pager/QuestionOptions.svelte`, `pager/ActivityPager.svelte` | `pager/MatrixRating.svelte`; Send says the boxes left. |
| `lib/results/results-tally.js` | An explicit branch: `aopResults`; a row's count is the guests who rated it. |
| `lib/results/results-chart-model.js` | `chartKind` gives `matrix`; `matrixChart`. |
| `lib/results/results-chart-figure.js` | `matrixFigure`, the heat map on paper. |
| `lib/exports/leader-report.js` | `KNOWN_TYPES`, `kindOf`, `KIND_LABEL`, `answerText`, no option counting, `matrixCells`, `matrixLongCsv`, `MATRIX_RULE`. |
| `lib/exports/leader-report-layout.js` | Where to start, and the disagreements. |
| `lib/exports/resultsExport.js` | `TYPE_WORDS`, `summaryRows`, `countingRule`, at most 10 rows in the pack. |
| `lib/results/session-summary.js`, `dashboard-model.js` | The `aop` block; `KIND_WORDS`; the section; the CSV's columns. |
| `lib/motion/motion-plan.js` | `QUESTION_TYPES` and `OPTIONS_BY_TYPE`. |
| `scripts/oracle-results.js`, `scripts/validate-data.js` | `generateAop`, `aopOracle`, `compareAop`; the word. |
| `scripts/test-pager.js`, `test-motion-plan.js`, `test-project-map.js`, the local site | Their cases and counts. |

## What was built

1. **Schema version 9**, and one set of limits (`lib/schema/aop-rules.js`) that the screen and the data layer both ask.
2. **The pure logic**: `lib/participant/aop-answer.js` (the answer) and `lib/results/aop-math.js`, the only place the formulas live.
3. **The Content editor**: criteria, directions, sub-processes, Paste from a spreadsheet, the notice when guests have rated, and the notice on a copied list.
4. **The participant exercise**: Grid and One at a time, keyboard, Next empty box, Send at none left, a draft kept for the tab, Change my ratings.
5. **The guest picture**: the dialog, 256 by 256 under 60 KB, a name with no name of a person, an audit line, removal with the picture and with Delete session.
6. **Results, the Live display, the exports and the dashboard.**
7. **The local site**: a new scenario, `art-of-the-possible`.

## Where the brief did not match the tree, and what was decided

- **The sample and the wireframes were not read.** `art_of_the_possible_Final.html` is not in the repository, and boards 15 to 17 (a claude.ai address) were not opened in this session. The screens follow the brief's words. Kroger's list on the local site uses the four rows the brief names; the other nine are invented to add up to 113 (ASSUMED). **Compare the screens with the boards.**
- **"First answers only" and "adding a row asks those guests again" pull apart.** A first answer cannot hold a row added later. Decision: a box counts its first rating; a box the first answer left empty takes the guest's later answer. So a changed rating does not move a number, and a guest asked again about a new row is counted for it. The participant page offers Change my ratings all the same, as the brief asks. **A guest who changes a rating therefore changes nothing in Results: confirm with the manager.**
- **The hub does not know a row was added.** It reads no content for a finished activity, so its pill stays Done. The boxes are asked for when the guest opens the activity.
- **"No extra request is added anywhere" cannot hold for pictures in Results.** Results reads a session's roster only for a track with no name of its own, and a QR guest's name is on the track, so the address would never reach it. One read was added: when Live results is opened, for someone who may see names with Hide names off, once a session, and only if a guest has joined. The Group filter uses the same read. No pinned request moved. Results' browser budgets were not all re-run (see below).
- **"Until its rows are saved once" needs somewhere to live, and no column was allowed.** A copy's `Layout`, which this type has no other use for, holds `copied-from:<client>` until it is saved here.
- **The counting rule is added only to a report that has the question** (`MATRIX_RULE`), not to `COUNTING_RULES`: every other report is unchanged, and the rules are fixed (CLAUDE.md, rule 8).
- **Local-site counts:** no number changed. The activity is a scenario of its own, as the confidence check is, not part of `ready`.
- **Removing a guest:** the app has no such action (Disable only; Delete session removes guests). Nothing was added. Remove picture and Delete session take the file.
- **SharePoint "removes" a picture to the site's recycle bin**, as every picture removal does. A face therefore stays restorable there until the bin is emptied (93 days by default). **Tell the manager**; it bears on open question 3.
- **Send is always on the action bar**, in One at a time too, not only on the last row: it is off until none is left.
- **`--motion-duration-cell: 120ms`** is a new token, since durations live only in `motion-tokens.css`.
- **The audit list's `Action`**, a text column, gains `picture`; no version of its own.
- The admin page was 647,003 B on `8f8937f` as built here, not the 646,950 B recorded; the allowance is measured from the recorded figure.

## Proposed, not done

Faces on the wall as a "who has finished" ring; picture import in the bulk names paste; automatic removal of pictures when a session ends; a shared library of sub-process lists; an import of the list from an Excel file; weights per criterion; a "Not applicable" level; the activity as a chart in the one-page PowerPoint; two sessions live at once.

## Open questions for the manager (the default is built; each is one line to change)

1. Direction of the five criteria: Strategic value and Compliance / risk count against; the other three favour (`DEFAULT_CRITERIA`).
2. Every box to send, or gaps allowed? Every box.
3. How long are pictures kept? Until the session is deleted.
4. "FTE" or "people"? "people in scope"; the editor says "People (FTE)".
5. Dashboard measure: the share first, the index second.
6. Colours: a blue ramp for ratings, red-amber-green only for the band.

## Proved, and only reasoned about

**Proved in node:** the hand-worked session and its edges; every limit; paste; the copy notice; both adapters for pictures and Delete session; no picture address in any export's data or CSV; the pooling rule; the oracle over 500 seeds.

**Proved in the built pages** (`art-of-the-possible.spec.ts`, Chromium and WebKit on an iPad viewport): keyboard-only rating, Send, the draft across a reload, 25 by 6, axe in both views, target sizes, the picture's one request and its fallback, the editor and Results. **Chromium only:** a chosen picture through the crop to the library, since Playwright's WebKit on Windows cannot open one (the known `brand-smoke` fault). Firefox does not start on this machine.

**Only reasoned about, or not run:** a real iPad and camera; `capture="user"`; Safari's JPEG fallback in a real browser; the library's read permission for a guest's iPad; the PDF's look (read by tests' words, not looked at); the full `npm run test:migration`, which was not run: only the new spec. QA-TESTING.md items 279 to 286 are the real-site checks.

## Figures

GATES
