# Phase 13: the Results exports, activity by activity, for Deloitte leadership

Branch `pms-13`, from the tip of `pms-12-fixes` (`8492ce8`). Nothing was pushed. The design brief is [EXPORT-DESIGN.md](EXPORT-DESIGN.md) (the guides' rules by page,
where the old files differed, the page maps, D3 to D5, and in its section 5 what building it changed). Items A to F are done; each change of behaviour was tested first and
the test was shown failing on the old code. **Nothing has been saved from the real site, opened in PowerPoint or Excel from there, projected or printed**: QA-TESTING.md items
171 to 176.

## 0. Where this started

- Node 22 is `.local/node22/node.exe` (the system Node is 20.13), `core.autocrlf input`, the canvas binary and Playwright's browsers in place (RELEASE-11A3.md section 0).
  Firefox will not start on this Windows machine (`spawn UNKNOWN`), as before.
- The guides were read with `pdftotext -layout` page by page from `public/assets/BrandGuidelines/` (not in git, not added). **Neither guide has any rule for charts or
  data visualisation**: every chart rule is this project's (`results-tokens.css`), and EXPORT-DESIGN.md says so.
- The Project documents the brief names are not in this repository or under `D:\Deloitte`, and were not updated (as in 11a-3 and 11b).

## 1. The items

| Item | Commit | What changed | Test first (failed on the old code) |
|---|---|---|---|
| A, the brief | `518e6dc` | EXPORT-DESIGN.md: 15 rules with page numbers (brand pp. 24 to 28, 36, 37, 42; language pp. 24, 28 to 31, 33, 40, 41), 7 differences seen in the before pictures, the three files' page maps, D3 to D5. | (a document) |
| B, the summary model | `36f7dfa` | `lib/export-summary.js`: each activity's takeaway, made of the chart model's own words and numbers by a rule (the average right first time and the most missed graded question; else the clearest single leader; else a tie, a ranking, the comments), its counts and graded scoreboard. The chart model gains `numberWords` and `fewAnswersLine` ("Only four answers." under five). | `scripts/test-export-summary.js`: the whole file failed (the module did not exist); every sentence worked out by hand from Vine, Harbour and Kroger, and a test holds every number in a takeaway to the question it names. |
| C, the leader report | `da306a6` | Page 1 "At a glance": four tiles (joined, answered, answers, finished), one takeaway per activity, the hardest and easiest question with the average first-try score, a three-line "How to read this report"; it never needs a second page ("And N more activities, each on its own pages."). Each activity starts a page under a band (title, purpose, "N questions · N answers · N of M finished", takeaway); each question is one framed card with "Only N answers." under five; a graded activity ends with its scoreboard. The client's colour is the title band only; rules are Deloitte Green, words the palette's black and `#53565A` (brand p. 37). The PDF's language is set. | `scripts/test-leader-report-glance.js`: 10 of 11 failed (the wordmark's clear space already held). Three tests of `test-leader-report-pdf.js` pinned the old cover and were changed with it; one (the spill of the hardest and easiest to page 2) went with that behaviour. |
| D, the summary pack | `babda4d` | The Live display's Export PDF and Export PPT: one layout of 16:9 pages (297 x 167 mm) in the embedded Open Sans's widths. Page 1: Session results, client, date, "N answers from M iPads", one takeaway per activity, nothing else. Then each live activity: title 28 pt, takeaway 18 pt, its numbers, a card per question (headline first, 18 pt), four a page at most, never split; nothing under 12 pt. The PDF puts each page on A4 landscape, embeds Open Sans, sets title and language; the PowerPoint is native text and shapes with speaker notes. | `scripts/test-results-pack.js`: 11 of 12 failed ("34 answers from 4 iPads" and "nobody named" already held). The 11b suite moved to the new API. |
| E, the CSV files | `fe848bb` | **Summary by activity (CSV)** replaces the eight-column file: one row per option in the screen's order, 14 columns in reading order, numbers as numbers, ISO date, the question's headline on its first row, comments last with no name, cells by `csvCell`. The Live display's Export CSV saves it (no extra read); each Results card has **Leader report (PDF)**, **Summary by activity (CSV)**, **All answers (CSV)** (the participant file, columns unchanged). | `scripts/test-results-csv.js`: 9 of 9 failed. A browser test downloads the summary from a card and walks the three buttons by keyboard. |
| F, print, accessibility, mutations | `1cf6796`, `1decad3` | 15 new mutations (64 in all); the two that survived at first exposed two missing tests, now written. The pack's page 1 says "1 participant's answers could not be counted." when an item could not be read (no name). `npm run look:exports` renders every export. Contrast (4.5:1 words, 3:1 marks) runs over the new pages of both PDFs with the existing `print-contrast.js`; the PowerPoint's text is asserted native from its XML. | The unreadable line failed first; the two survivors ("a poll's takeaway is its first question, not its clearest"; "more than four cards a page") each now fail a test. |
| Documents | `3efdcd8`, `757be5c` | RUNBOOK.md's PCOE note and step 9, RELEASE-NOTES.md "What changed since pms-d19bd14", `BRANCH = 'pms-13'`, QA items 171 to 176, AGENTS.md "Rules from Phase 13", `PHASE_13` in `scripts/bundle-budget.js`. | `scripts/test-release-docs.js` failed 2 of 15 on the old documents. |

**Every number of the leader report stayed as it was**: the oracle gives 0 differences over 500 seeds, `COUNTING_RULES` are the same eight, and "Answered by N of M." stays on every card
(the oracle reads it).

## 2. Decisions used

- **D3, the blues: the default.** Every colour is read from `results-tokens.css`. The guide forbids none of them; it does not list `#0076A8`, its tint or the ramps (p. 42 has
  `#005587`, `#00A3E0`, `#A0DCFF`). Proposed, not made: the guide's own blues, a change of that one file and its test.
- **D4, the logo: the default, partly.** The client's logo and name on the cover as before; the Deloitte wordmark stays in the leader report only (drawn from
  `DeloitteWordmark.svelte`, never `public/assets/Logos`), with one wordmark height of clear space around it (p. 27, a test). The pack has no Deloitte logo: PowerPoint would
  need it as a picture, the one non-native element of the slides.
- **D5, fonts: the default.** Both PDFs embed Open Sans Regular and Bold (`report-fonts.js`, already in the admin page). The subset has no Light, so headlines are Bold, not the
  Light p. 36 names. The PowerPoint names Open Sans; a machine without it shows Arial, which is narrower, so the text still fits.
- **New, for VJR:** the screen's own sentences that begin with a numeral ("2 of 4 got it right first time.", language p. 40) were left as they are, because changing them changes
  the Live display.

## 3. What the pictures showed

Rendered with `npm run look:exports` (pdf.js in Playwright's Chromium, every page in colour and greyscale): the pack for Vine (every kind of question, a tie at the top of a
ranking, a scale of two answers), Kroger (34 answers from 4 iPads, one visit unreadable), sixty people and fifteen questions with 90-character answers, other scripts and emoji
with a 1,000-character comment and a removed answer, and ten questions nobody had answered; the leader report for Harbour, for Harbour as a sample client with an unreadable
item, and for sixty people (42 pages). Every page was looked at.

- **Fixed after looking:** a tall card of the sixty-person pack ran into the footer (the box test checked only the page's edge; it now checks the footer, and a mutation
  proves it can fail); "(continued)" was cut off a long activity title; "4 answered. Only four answers." said it twice; the pack said nothing about Kroger's unreadable visit;
  the leader report's "And 1 more activity" now spells the number.
- **Seen and right:** page 1 of both files reads as the answer first; ticks and "Correct" beside every correct answer; "Top choice" in words; the ranking's "1", "1", "3"; in
  greyscale the correct and top bars are told apart by their words; the leader report's client colour only in its title band.
- **Four cards a slide is a maximum, not a promise** (EXPORT-DESIGN.md section 5): at 18 pt headlines and nothing under 12 pt, Kroger's short cards fit four, Vine's charts fit
  two. An activity whose first card does not fit under its takeaway gets a first slide of title, takeaway and numbers alone (the sixty-person pack).
- **Other scripts and emoji:** the pack's PDF now prints one replacement mark for each run (it used to drop them); the PowerPoint keeps every character; the CSV keeps them.
- **The PowerPoint was not opened in PowerPoint** this time: its text, shapes, 16:9 size, font and notes are asserted from its XML. A person must open it (QA item 172).

The summary CSV's first rows (Vine):

```
Client,Session date,Activity,Question number,Question,Question type,Option,Answers,Share of answers (%),Rank or score,Correct option,Top choice,Answers to this question,Takeaway
Vine Street Partners,2026-10-15,Getting to know us,1,Where is the head office?,Single choice,"1014 Vine Street, Cincinnati",2,50,,Yes,Yes,4,"The top choice (50%) was 1014 Vine Street, Cincinnati."
Vine Street Partners,2026-10-15,Getting to know us,1,Where is the head office?,Single choice,"5th Street, Cincinnati",1,25,,,,4,
Vine Street Partners,2026-10-15,Getting to know us,2,Which channels do you use with customers?,Multiple choice,Email,3,75,,,Yes,4,Most people (75%) chose Email.
```

A pivot test adds Kroger's Answers by activity to 34.

**For a spreadsheet built on the old Live display CSV:** Count is now Answers, Percentage is Share of answers (%) as a whole number (it was one decimal), Score is Rank or
score (a ranking's support score, 0 to 100, where it was Borda points), Respondents is Answers to this question, Type is in words, and a comment is a row in the last block
(it was an option row with a count of 1). The old names were not kept as aliases. The file's name is `summary-by-activity-<session>-<date>.csv` (it was `results-...`).

## 4. The gates (Node 22, this Windows machine)

| Gate | Before (`8492ce8`) | After (`757be5c`) |
|---|---|---|
| `check:svelte` | 0 errors, 0 warnings, 363 files | 0 errors, 0 warnings, 364 files |
| `npm test` | 1,286 of 1,286 | **1,328 of 1,328** (one full run during the phase failed `test-list-namespace.js` once under load; it passes alone, 27 of 27, and in the final run) |
| `test:baseline` | 37 of 37 (inside `npm test`) | 37 of 37: **no request baseline moved** |
| `test:bundle` | 37 of 37 | 38 of 38; participant page **byte for byte** pms-d19bd14's (`9cae99e5…`, 157,027 B); admin **562,606 B, +3,521 B** over 12 (allowance 12,000 B, budget 700,000 B) |
| `test:report` | 109 of 109 | 150 of 150 (four new suites) |
| `test:report:mutations` | 49 of 49 | **64 of 64** |
| `oracle -- --seeds 500` | 0 differences | **0 differences** |
| `test:charts` | 57 of 57 | 57 of 57 |
| `test:local-site` | 26 of 26 (RELEASE-12, the same commit; not run again before) | 26 of 26 |
| `test:migration`, Chromium and WebKit | 785 passed, 13 skipped, 21 failed (RELEASE-12, the same commit; not run again before) | **787 passed, 13 skipped, 21 failed**: the same 21. 20 are WebKit on this Windows machine (the 18 sound specs, `brand-smoke`, `flow.spec.ts:456`, `keyboard.spec.ts:314`); one is `admin-today.spec.ts:421` "slugs", which also **fails 3 of 3 on the untouched `8492ce8`** in a separate worktree (a read-back before the save landed: `themeVersion` 1 where 2 was expected). |
| **Not run** | Firefox (Windows refuses to start it); `test:rehearsal` (as in 11a-3 and 11b) | the same |

## 5. The package

**`pms-757be5c`**, made by `npm run package:release` from commit `757be5c` in a fresh checkout. `SHA256SUMS.txt` passes in the folder (7 OK) and in a fresh unzip (7 OK),
checked by the script and again by hand. The script also proved no page holds a site address, a folder name, a PIN hash, the demo PIN, `p_cec_` or `CreativeExpCOE`.

| File | Bytes | gzip -9 | SHA-256 |
|---|---:|---:|---|
| index.html | 374,368 | 157,027 | `9cae99e5bf091d27acabc75a4a469c6a5bc7995d6ef28237594daa5c1bca3557` (byte for byte pms-d19bd14's) |
| admin.html | 1,548,894 | 562,606 | `04e64562f598981d3ee6dc1eb846395e1cbf0432c9df69c0cd755023fb230c1b` |
| setup.html | 1,172,836 | 788,959 | `6099e36392e536bf8f413244ea694a1c0e98b7de9ba4687a0222491be34b9cf4` (it differs from pms-d19bd14's only by the build name Setup shows) |
| pms-config.txt | 54 | | `04426124f56abad3973d69fb4a8608e673d86745419bf1cc41c5a70441cc607f` |
| THIRD-PARTY-NOTICES.txt | 40,835 | | `e4ecfa86a85da94926f3f25b9f2b99791c38cc3ea100c5454bb333e620ec1eb4` |
| RELEASE-NOTES.md | 29,084 | | `84017edf049856d816aa1c8f76ee8291645a58ab5ac8e81796b77ef8f47bec0b` |
| RUNBOOK.md | 33,385 | | `458adeb3a4ccb4af6b6202e3a4303131b56cc4083d48a0e02d61364d451357a8` |
| **pms-757be5c.zip** | 1,543,649 | | `1a848083550f1b593d11f8f9c026cb9c06b7063506119f54e9ef4077317d456d` |

For the PCOE site: replace the three pages (RUNBOOK.md's note, steps 1 to 9). Nothing in Setup or the lists changes; the participant page is the one already there.

## 6. What only the real site, PowerPoint, Excel, a projector or a printer can show

QA-TESTING.md items 171 to 176: the pack from Kroger's real session; the .pptx in PowerPoint (editable, 16:9, nothing off a slide, notes) and in slide show on a projector;
the summary CSV in Excel (numbers as numbers, a PivotTable by Activity, an "=" comment as text); the leader report in Edge, Acrobat and black and white; one iPad and an
activity switched off; and a reader who was not in the room reading page 1 in two minutes. Items 167 to 170 of Phase 11b still stand where they do not differ.
