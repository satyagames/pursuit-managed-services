# Alignment review (Phase 15, part 1)

What was measured, what was seen, what was fixed and what was left. The release report is [RELEASE-15.md](RELEASE-15.md); the findings of the earlier
review ([UX-REVIEW.md](UX-REVIEW.md), [RELEASE-12.md](RELEASE-12.md)) are not repeated here.

## How it was done

- **By measurement.** `npm run ux:shoot -- --matrix brief --measure` (flows participant, tiles, admin, setup, brand) on the local PCOE site with VJR's dataset and
  pictures and every persona, against the package of the untouched branch (`pms-85f6abb`, the pms-14 pages byte for byte), at the matrix of
  `scripts/migration-tests/devices.spec.ts`: iPhone 390x844 and 844x390, iPad 820x1180 and 1180x820 (WebKit), iPad Pro 1024x1366 (WebKit), laptop 1366x768 and
  desktop 1440x900 (Chromium), plus the 125% laptop (1536x864 at 1.25). Firefox was not exercised: it does not start on this machine (`spawn UNKNOWN`).
- At every one of the **962 pictures** `scripts/local-site/align-probe.js` read every box of the page in one pass (no write between two reads) and reported:
  sideways scroll, a touch control under 44 x 44 CSS px, a lone centred child more than 1 px off centre, boxes of one kind in a row whose heights differ, boxes of
  one kind stacked in a list whose widths differ, a button row off one axis, an icon off its words' line, text cut by its own box, a focus ring (3 px off, 9 px
  band) an ancestor would cut, two controls overlapping, and unequal gutters, each with 1 px of tolerance (2 px for an icon) so sub-pixel rounding and the
  Open Sans fallback metrics do not count. `scripts/local-site/align-report.js` groups the findings by kind and component into
  `ux-review/before-15/alignment-summary.md` (git-ignored): **41 groups over 472 pictures**.
- **By eye.** The participant screens at the iPhone (both ways), iPad (both ways), iPad Pro and laptop sizes, every question type and state, and the admin screens
  the probe flagged. The eye found A-01, which no rule of the probe looks for.

## Findings

| Id | Screen, state | Devices | What is wrong | Measured | Severity | Fix |
|---|---|---|---|---|---|---|
| A-01 | Participant: any lettered list (single choice poll, multiple choice) and the ranking, an answer picked | all | The letter (or rank) column is 1.1em wide on an answer and 1.6em on a picked one (its badge), so the words of picked and unpicked answers start at different edges, and an answer's words jump sideways the moment it is picked. | 10.7 px at 820 wide | Medium | One column width for every state (`OptionPill.svelte`: `.letter` 1.6em, centred, in every state; the badge only adds its colour). Closed: `alignment.spec.ts` "A-01". |
| A-02 | Admin, Results: a session's "Live results" summary, keyboard focus | all 7 | The card it fills (`.card`, `overflow: hidden` for its rounded corners) cuts the bottom and sides of the focus ring. | 8 px of the 9 px band | Medium | The ring of that summary is drawn just inside it (`admin.css`: green between two navy bands, the same ring turned inward). Closed: `alignment.spec.ts` "A-02". |
| A-03 | Admin, Live display in full screen: the pager buttons | iPhone landscape | The ring of Previous, Next and Auto-advance is cut by the full-screen section. | 1.02 px | Low | Proposed, not done: the full-screen layout's last row is pinned by `results-charts-fit.spec.ts`; a person rarely runs the Live display on a phone. |
| A-04 | Admin, Live display in full screen: a bar's row (a button) | iPhone landscape | Rows are 24 to 36 px tall on a touch screen. | 778 x 24 | Low | Proposed, not done: the chart's row height is the chart model's and is pinned (`test:charts`, the fit specs); the wall is for a projector. |
| A-05 | Setup: the links at the top (Admin, Participant) | iPhone, iPad | 49 x 24 on a touch screen. | 49 x 24 | Low | Proposed, not done: Setup is run on a laptop; a change is a change of Setup's layout (`setup-look.spec.ts`). |

### Measured, and a design or content decision (not "fixed")

- **The cards of a Live display row differ in height** (up to 301 px): deliberate, and pinned ("no card stretches", `results-charts-fit.spec.ts`).
- **Welcome's two buttons differ in width** (Continue and "Start a new visit"): the primary and the secondary button, sized by their words on purpose.
- **A locked activity's lock is centred on its two lines** (the title and "Finish the previous activity"), not on the first line: the pill's own layout since Phase 8.
- **Results' bar tags ("Correct", "Top choice") differ in width**, **Setup's buttons in a section differ in width**, **Brand Studio's Save, Revert and Copy differ
  in width**: buttons sized by their words.

### Measured, and not a fault (the probe's limits, kept here so nobody chases them)

- **Small radios and checkboxes** (Brand Studio's plate, Today's choices, Setup's checks; 20 to 22 px): each is inside a label of at least 44 px that takes the tap.
- **Controls "overlapping"** under Brand Studio's crop dialog: the dialog is modal; what is under it cannot be reached.
- **Rings "cut"** by the admin's tab strip on a phone and by the crop dialog: the controls were scrolled out of their own scroller.
- **The sticky action bar "overlapping" an answer or Clear ranking** on a phone: it is pinned to the bottom of the window over the page as it scrolls, and is the
  last thing in the column, so nothing ends under it (Phase 8).

## What the participant screens measure

511 pictures of participant screens: no sideways scroll at any size, no text cut, no centred block off centre, the column in the middle of the window, no touch
target under 44 px, every answer of a list one width, the action row on one axis. `alignment.spec.ts` holds those at the seven sizes on a question, after any
motion has ended, and `devices.spec.ts` and `reflow.spec.ts` keep holding the rest (320 px, 200% text, the safe areas).

Two more things were seen while measuring, and are not alignment: on Next the old page shows a small layout shift (0.0035 to 0.0065, the action bar moving
with the new question's height, within 500 ms of the tap, so not counted as CLS), with or without motion; and the old page left one finished step animation
attached (`animation-fill-mode: both`) after every question. The second is gone with Part 2.

## CSS bytes

The participant page's CSS is the same size after Part 1 (115,377 B raw, 70,535 B gzip); the admin page's grows by 97 B raw (the inward ring). Part 2 removes the
legacy motion sheet from the participant page (RELEASE-15.md).
