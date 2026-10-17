# Export design (Phase 13): the Results files, activity by activity, for Deloitte leadership

Drafted 17 Oct 2026 on branch `pms-13` (from `pms-12-fixes`, `8492ce8`). This is item A of Phase 13: what the brand guides say, where the files
we make today differ from them, and what each file becomes. The person running the phase approves this first; the items after it (B to F) build
what it describes. Nothing here changes a number: what is counted, the counting rules and the lists stay as they are.

**The reader.** A Deloitte partner or director who was not in the room, has two minutes, and will forward the file. In order they need: what
happened (who took part, how much), what it means (one sentence per activity), the evidence (one picture per question) and what to look at
(the hardest question, the clearest split, the strongest comment). They must never have to read a table to find the point, and never be misled
by a percentage of three people.

## 1. What the guides say (and what they do not)

Read with `pdftotext -layout` and by page, from `public/assets/BrandGuidelines/` (in the working folder, not in git). Page numbers are the PDFs'
own. **Neither guide has any rule for charts, graphs, tables of figures or data visualisation**: "chart", "graph", "data visual" and "infographic"
do not occur in the brand guide, and the language guide speaks of graphics only for abbreviations (p. 33) and for full stops in graph titles
(p. 41). Every chart rule below is therefore this project's (`results-tokens.css`, Phase 11a), not the guide's, and is said so.

### US Brand Style Guide 2025 ("brand")

| Page | Rule | How the exports follow it |
|---|---|---|
| 36 | Open Sans is the primary typeface: Light for headlines, Regular for body copy, Bold for calls to action. Stix Two Text only as a one-word accent in a hero headline. | Both PDFs embed Open Sans Regular and Bold (`report-fonts.js`; the subset has no Light, see D5). The PowerPoint names Open Sans. No Stix: a results file has no hero headline. |
| 37 | On light backgrounds keep all text one colour, black or `#282728`. | Words are `--viz-text` (#000000) and the secondary grey `--viz-text-secondary` (#53565A, 7.4:1); see difference 3. |
| 42 | Palette: Deloitte Green `#86BC25` (primary), `#86EB22`, black, white, `#282728`, `#E6E6E6`, blues `#00A3E0`, `#A0DCFF`, `#005587`, greens `#26890D`, `#046A38`. "Deloitte green ... should be present in all communications ... All primary surfaces must include a prominent element of Deloitte Green ... Green should never be low contrast or dull." | Every page of every file carries the Deloitte Green rule (cards, section heads, the activity band); Dark Green `#046A38` is the correct answer. |
| 26 | The logo lockup is black with the green dot on light backgrounds, white with the green dot on dark. | The leader report's wordmark is drawn black with the green dot on the white page (unchanged). |
| 27 | Clear space around the logo lockup is the height of the Deloitte "D" (1 D for digital). The page is about the lockup (logo and tagline); it is the only clear-space rule in the guide. | Applied to the wordmark as the nearest rule: nothing within one "D" height of it (checked in item C's test). |
| 24, 25 | The lockup (logo with "Together makes progress") should generally not be used on documents shared with Restricted Entities. | The exports use the plain wordmark, never the lockup. |
| 28 | A logo stamp goes at the bottom of the canvas; "avoid using the stamp at the top". | About the lockup used as a stamp on a canvas (social, print, OOH). The leader report's wordmark sits top right on the cover as before (see D4 and difference 6). |

### Deloitte Language and Style Guide ("language", May 2026 edition)

| Page | Rule | How the exports follow it |
|---|---|---|
| 24 | Plain: simple, everyday words; short and to the point; a logical structure. Human: first and second person, conversational, avoid jargon. | Headings are what the reader is looking at ("At a glance", "What each activity found"); no "respondents", "Borda", "n=". |
| 30 | All headlines and subheads in sentence case. | Every heading, button and column name in sentence case ("Summary by activity (CSV)", "Share of answers (%)"). |
| 41 | No full stop after titles, subtitles, headings, graph and figure titles, column heads, or captions that are not complete sentences. | Headings and labels end without one; the chart sentences are complete sentences and keep theirs. |
| 41 | `%` with a numeral, no space; "percentage" in words. Do not begin a sentence with a percentage written as a numeral. | "58%". The headlines put the share inside the sentence ("Most people (58%) chose ..."), never first. |
| 40 | Spell out one to nine in running copy; numerals for 10 and up, and always for percentages and scores. Try not to begin a sentence with a number. | The figures in the exports are data (counts in tiles, bars and tables), which stay numerals. See difference 4 for the sentences that begin with a count. |
| 31 | A comma in numbers over 999. | "1,240 answers" (the files format counts with `toLocaleString('en-US')` where they can pass 999). |
| 33 | Dates: day month year for a global audience; US-only material uses the American style, month spelled out ("July 4, 2025"). | The app is the US firm's: "October 16, 2026", as today. The CSV writes ISO dates (2026-10-16) so a spreadsheet reads them as dates. |
| 28 | Avoid the ampersand in running text. | None is added; a client's own name keeps its own. |
| 29 | Bullets: start with a capital; full stops only when the items are sentences. | The leader report's "How to read this report" box. |

## 2. Where today's files differ (what the before pictures show)

The before pictures were made from `8492ce8` with the fixtures of section 6: `test-results/exports/before/` (git-ignored; `onepager/*.png` and
`report/*.png`, each with a greyscale copy, and the two old CSVs). To make them again, check out `8492ce8` and run the scratch scripts that
`scripts/look-exports.js` replaced.

1. **No page answers "what did this activity find?"** The leader report's page 1 has tiles, completion bars and the hardest and easiest
   question, but nothing per activity; the Live display's one-pager is a grid of cards with no summary at all (vine-1.png, kroger-1.png).
2. **The one-pager is a miniature of the screen**, five pages for the 60-person session (big-1..5.png), its cards at 7 to 9.5 pt: too small to
   project, and a slide of 3 cards across at that size does not read in a room.
3. **The client's colour is on structure it does not own.** In the leader report the section rules, the tiles' bars, the completion bars and the
   comment bars wear the client's primary (harbour-1.png, -2.png); brand p. 42 asks for Deloitte Green on every primary surface, and the Phase 11a
   rule keeps the client's colour to the header. Words are `#111827`/`#4B5563` there, not the guide's black or `#282728` (p. 37).
4. **Sentences that begin with a numeral** (language p. 40): the chart model's "2 of 4 got it right first time." and "4 comments. The word ...".
   They are the screen's words too (Phase 11a); changing them changes the Live display. **Not changed here**; listed for VJR (decision 6).
5. **Small numbers look like big ones**: "100%" over 2 answers (vine, the scale) reads the same as 100% of 300. No file says "only 2 answers".
6. **No language or title in the one-pager's PDF metadata**, and the one-pager's PDF uses Helvetica (no Open Sans, brand p. 36), dropping other
   scripts silently (odd-1.png: "東京 (Tokyo)" prints "(Tokyo)").
7. **The old CSV** (`Activity, Question, Type, Option, Count, Percentage, Score, Respondents`) has no client, date, question number, correct
   answer, top choice or sentence; types are code words (`single-select`); a ranking's Percentage is its share of points, a figure no screen shows.

## 3. The three files

### 3.1 Leader report (PDF, A4 portrait)

```
Page 1  At a glance                               Each activity (one spread, two pages at most)
┌──────────────────────────────────────┐          ┌──────────────────────────────────────┐
│ [client logo]              Deloitte. │          │ head: client, leader report | section │
│ ┌──────────────────────────────────┐ │          │ ▌Activity title          (grey band)  │
│ │ LEADER REPORT  (client colour)   │ │          │ ▌purpose line                         │
│ │ Client · event · date · session  │ │          │ ▌4 questions · 22 answers · 4 of 7 fin│
│ └──────────────────────────────────┘ │          │ ┌ card ────────────────────────────┐ │
│ At a glance                          │          │ │Q1 Question text                   │ │
│ [joined][answered][answers][finished]│          │ │Headline sentence (bold)           │ │
│ What each activity found             │          │ │[chart: bars / split / scale/words]│ │
│  ▌Activity 1 — takeaway sentence     │          │ │Answered by 6 of 7. Only 3 answers.│ │
│  ▌Activity 2 — takeaway sentence     │          │ │3 of 6 got it right first time.    │ │
│ Hardest | Easiest (with %)           │          │ │facts and notes                    │ │
│ ┌ How to read this report (3 lines)┐ │          │ └───────────────────────────────────┘ │
│ status, sample and unreadable notes  │          │ Scoreboard: average right first time, │
│ Confidential – internal · client · p1│          │ the question most often missed        │
└──────────────────────────────────────┘          └──────────────────────────────────────┘
then: What participants said · Participants · Questions no longer in the activity · How the numbers are counted (last)
```

- Page 1 never needs a second page: the takeaways are one line each (cut with an ellipsis if longer; the full sentence is on the activity's page).
- The four tiles: people who joined, people who answered, answers, finished every activity (with the average first-try score under it).
- Each activity starts on a new page, so it is a self-contained spread; each question is a card that is never split (a card longer than a page,
  which needs more than about 40 answer options, breaks between two bars, as Phase 11b allowed).
- The client's colour: the cover band only. Rules, tile marks, completion and comment bars are the Results palette's (Deloitte Green rule,
  Deloitte Blue bars). Words black and `#53565A`.
- Kept as they were: the cover's sample and unreadable notices, "Confidential – internal", "Page N of M" on every page, What participants said
  (every comment, with names), Participants, Questions no longer in the activity, and the last page's rules and `LIVE_FILES_NOTE`.

### 3.2 Live display: Export PDF and Export PPT (the summary pack)

One layout of primitives drawn by two writers, as since Phase 11b. The page is **16:9, 297 × 167 mm**; the PowerPoint is that size, and the PDF
puts it in the middle of an A4 landscape sheet (297 × 210 mm), so the PDF prints on A4 and the slide projects at 16:9 from the same layout.

```
Page 1  Summary                                    Each live activity (more than four questions: a second page)
┌──────────────────────────────────────────────┐   ┌──────────────────────────────────────────────┐
│ [logo plate]  Session results   (client band) │   │▀▀▀▀▀▀▀▀▀▀▀▀▀ client strip ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│
│               Client · date · 34 answers from │   │ Activity title (28 pt)                        │
│               4 iPads                         │   │ Takeaway sentence (18 pt)        ▬ green rule │
│ What each activity found (28 pt)              │   │ ┌ card ──────────────┐ ┌ card ─────────────┐ │
│ ▌Activity 1   takeaway (18 pt)                │   │ │headline (18 pt)    │ │                    │ │
│ ▌Activity 2   takeaway                        │   │ │question (14 pt)    │ │                    │ │
│                                               │   │ │chart (12 pt)       │ │                    │ │
│                                               │   │ └────────────────────┘ └────────────────────┘ │
│ Client · date                    Page 1 of 4  │   │ Client · date · activity         Page 2 of 4  │
└──────────────────────────────────────────────┘   └──────────────────────────────────────────────┘
```

- No text under 12 pt; headings 28 pt; the takeaway and each card's headline 18 pt; a question 14 pt; chart words, captions and the footer 12 pt.
- At most four cards (two by two) a page; a card that does not fit what is left of a page goes to the next one, never split. A card too tall for
  a page with two-line labels is laid out again with one-line labels (the full words are in the CSV and the speaker notes).
- PowerPoint: native text boxes and shapes (no pictures of the page); a title slide that is the summary, one slide per activity; speaker notes on
  each slide with each question, its answers and how it was counted, in sentences.
- The iPads line is `answersFrom()` (Phase 11b): a visit that answered nothing is not counted. No name is anywhere in either file.

### 3.3 The CSV files

1. **Summary by activity (CSV)**, from the Live display's Export CSV and from a new button on each Results card: one row per option, in the
   screen's order: `Client, Session date, Activity, Question number, Question, Question type, Option, Answers, Share of answers (%), Rank or score,
   Correct option, Top choice, Answers to this question, Takeaway`. Numbers are numbers; the date is ISO; Takeaway is the question's headline on
   its first row. A written-answer question's rows are the words that came up most; every comment is then a row of its own in a last block,
   `Question type = Comment`, with no name and no percentage.
2. **All answers (CSV)** is the old "Participant answers (CSV)" under a plain name, its columns unchanged.

**For anyone with a spreadsheet built on the old Live display CSV**: its eight columns are gone. `Count` is now `Answers`, `Percentage` is
`Share of answers (%)` (a whole number, as the screen shows it, where it was one decimal), `Score` is `Rank or score` (a ranking's support score,
0 to 100, where it was Borda points), `Respondents` is `Answers to this question`, `Type` is in words, and `Activity`, `Question` and `Option`
keep their names. A comment is no longer an option row with a count of 1: it is in the Comment block. The old names are not kept as aliases:
two names for one column in one header would read worse than one clear name.

## 4. Decisions

- **D3, the blues: the default.** Every colour is read from `migration/src/styles/results-tokens.css`. The guide does not forbid any colour the
  exports use; it does not list `#0076A8`, its tint or the ramps (p. 42 has `#005587`, `#00A3E0`, `#A0DCFF`). Proposed, not made: moving the bars to
  `#005587` (8.2:1 on white) and the tint to `#00A3E0` would put the charts on the guide's own blues; that is that one file and its test.
- **D4, the logo: the client's logo and name on the cover; the Deloitte wordmark only in the leader report, as now.** `public/assets/Logos` is not
  read (AGENTS.md: the report draws the wordmark from `DeloitteWordmark.svelte`); its clear space is held to one "D" height (p. 27). The summary pack
  carries no Deloitte logo: PowerPoint cannot take the wordmark's vector paths as a native shape without a picture of it, and a picture would be the
  only non-native element of the slides. Said, not hidden: the pack's Deloitte identity is the green rule and the type.
- **D5, fonts: the default.** Both PDFs embed Open Sans Regular and Bold (`report-fonts.js`, already in the admin page: no new bytes of font). The
  subset has no Light, so headlines are Bold, not the Light p. 36 names; adding Light would put a third embedded face in the admin page and is left
  for VJR. The PowerPoint names Open Sans; a machine without it shows Arial, which is narrower, so the text that fits in Open Sans fits in Arial.
- **Decision 6 (new, VJR's):** the screen's own sentences that begin with a numeral (difference 4).

## 5. What building it changed (added after items B to F)

- **Four cards a slide is a maximum, not a promise.** At the sizes a projected slide needs (headline 18 pt, nothing under 12 pt), four cards fit a 16:9 page only when their
  charts are short (Kroger's yes-or-no questions: 2, 4, 3 over three slides, under the activity's title, takeaway and numbers); Vine's four-answer charts fit two a slide. So
  "one slide per activity, two when it has more than four questions" became "as many slides as the activity needs, four cards on one at most". A card too tall for an empty
  slide is laid out compact (two lines of headline, one of question, one line a label, one comment; the full words are in the notes and the CSV). An activity whose first
  card does not fit under its takeaway has a first slide of its title, takeaway and numbers alone: a divider slide.
- **Under five answers a card says only "Only four answers."** ("4 answered. Only four answers." read twice); at five or more, "12 answered.".
- **The pack's page 1 says when answers could not be counted**, in the wall's words with no name ("1 participant's answers could not be counted."): without it Kroger's
  pack would have read as if every answer were there.
- **The leader report's cover tiles are four, the average first-try score moved** into the hardest-and-easiest block ("Average first-try score: 47%, over 6 participants.").
- The before and after pictures: `npm run look:exports before` on `8492ce8` (with the scratch scripts it replaced), `npm run look:exports after` on this branch, in
  `test-results/exports/` (git-ignored).
