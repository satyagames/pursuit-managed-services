# Prompt 20: Confidence check, Before and After

Branch `pms-20`, made from `6240061` (the tip of `pms-19-page-watch`, which is not merged). Not pushed. Every guest answers the same confidence
question twice in a session, before the first activity ("Before we begin") and after the last ("Before you go"), and Results show how far guests
moved (**Confidence shift**) and how many went from not confident to confident (**Moved to confident**), beside "N of M guests answered both".
Design source: wireframe boards 9, 11, 12, 13 and 14 (approved 27 Oct 2026).

**The rule above all held**: a session with the check switched off, and every client without one, behaves as before: the same screens, results
and exports, and the same requests but for one column more named in each read of two lists (below, "Requests").

## Part 0: the storage, proved first

Decision 8 held. `scripts/test-confidence-check.js` Part 0 shows that two records `q@before` and `q@after` survive `participantFields` (the save),
`mergeAnswerRecords`, the device's store (record, save, a fresh device's restore) and both kinds of restart, on the mocked SharePoint REST, and that
`readSessionResults` over a session holding them counts every question exactly as without them. The places that assumed a `questionId` is a real
question's, and what was done:

- **The leader report** (`lib/exports/leader-report.js`): an answer to an id no question has was listed under "Questions no longer in the activity"
  as "Deleted question N", and counted in "answered something". Check records are now taken apart before that (`isCheckRecord`), and the check's
  activity is not one of the report's activities.
- **`buildResults`** and **"N answers from M iPads"** (`answerCounts`) count answers per question of the session's activities: they never met the
  records. The check's activity, which Go live lists in the session like every activity of the client, is lifted out into `confidenceCheck`.
- **The unreadable-answers check** looks at whole items, not ids: unchanged.
- **The participant answers CSV** is built from the report's rows: no row for a check record; two columns instead (below).
- **The facilitator's restart at an activity** removed that activity's question ids only; it now drops After too (on the device and in the list).

## The formulas, as built (`lib/results/confidence-shift.js`, and nowhere else)

| Measure | Rule | Constant |
|---|---|---|
| Confidence shift | (mean After − mean Before) / `shiftDivisor(scaleMax)` × 100, over guests with both answers | `shiftDivisor(scaleMax) = scaleMax` (ASSUMED: the manager may choose `scaleMax − 1`; one line) |
| Moved to confident | of paired guests with Before ≤ `notConfidentMax`, the share with After ≥ `confidentMin` | `notConfidentMax = floor(0.4 × scaleMax)`, `confidentMin = ceil(0.8 × scaleMax)`: 2 and 4 on 5 points, 1 and 3 on 3, 1 and 4 on 4 |
| `scaleMax` | the check question's highest OptionValue | a 3-point legacy question works |
| Confidence index | mean After of a group / mean After of the baseline × 100 | a function for the dashboard |
| Low sample | fewer paired guests than `MIN_SAMPLE` | 10 (ASSUMED: no setting may be added) |

A guest with only a Before counts in the Before totals and the "answered" line, never in a shift. The reports print one line:
"Confidence moved N% of the scale (X to Y); P% of guests who started not confident ended confident (n = M of K guests)" (`confidenceLine`).
Proved by hand-worked cases (one guest; Before only, After only and both; all unchanged = 0%; all 1 to 5 = 80%; a 3-point scale; ties on the
thresholds; an empty session), properties over 300 seeds (bounded; a Before-only guest never changes a shift; record order never matters), and a
block of the oracle (`scripts/oracle-results.js`: `generateCheck`, `checkOracle` with whole-number thresholds, `compareCheck` against `buildResults`
and the leader report), shown to catch a wrong divisor and a wrong pairing.

**Decisions read as**: the minimum sample is the dashboard's rule (decision 6, board 12). A single session's Results show the shift whatever its
size, with "N of M guests answered both" and a "Low sample" tag under 10 (QA item 212 expects a shift with three iPads). Before and After are **not**
counted in "N answers from M iPads".

## Schema version 4, and the requests

`PMSActivities.Kind` (single line; `activity` or `confidence-check`; empty reads as `activity`) and `PMSClientSessions.ConfidenceCheck` (Yes/No,
default No; a new session says Yes when its client has a check with a question). Setup's plan, Create and Mark the site as ready bring a site of
version 3 to 4 (proved: the plan names exactly the two columns, Create only adds, nothing is lost, and the pages stop with `PMS-LST-011` until then;
a read refused for a column the site lacks now asks the settings item first, so the participant's watch says `PMS-LST-011` and not a 400).

**Requests.** The prompt asked for `test:baseline` unchanged and never `--amend`. With two new columns that cannot hold: every item read names its
list's columns (rule 5), so each read of `PMSActivities` and `PMSClientSessions` names one more, and Setup makes two more columns. The baselines were
**translated and the translation proved**, as Phases 10h, 10i and 10j did (`scripts/schema-baseline/columns-baselines.js`): every node suite was run
on the last commit's tree and on today's, request by request (14 of 16 identical in order but for the `$select`; the two Setup suites, whose
lanes interleave, the same requests as many times, plus only the new columns' creates and read-backs), and a fresh recording of every suite equals
the translation. No request was added or taken away anywhere else; the Live display's refresh and the participant page's rounds are as they were.
The browsers' start-up baselines were translated by the same rule.

Tests that pinned the old shape and moved with it (each the extension the "add a column" recipe expects, listed here): `test-schema.js` (the
snapshot's changes gain the Phase 20 entry; the Yes/No and worded-column lists gain the two columns), `test-named-reads.js` (the activities'
`$select`), `test-provision.js` (89 to 91 columns, 149 to 151 writes, "4 of 8 columns"), `test-schema-version.js` (version 3 to 4; version 3 joins
the cases that stop), `test-site-ready.js` and `test-schema-upgrade.js` (a higher version is 5; the 10i site of version 2 is brought to 4, its plan
naming the two columns of each version; its records are written with the columns present and then taken off, `keepColumns`/`dropColumns` in the
mock), `test-column-names.js` (a site of today says 4), `test-participant-storage.js` (browser storage gains `cec-check-pick:`, the card picked and
not confirmed), `test-foundation.js` (ten focused headings), and the bundle test (Prompt 19's figures as measured; Prompt 20 holds the build).

## The participant flow and the screens

Routes `#/check-in` and `#/check-out`, one component (`routes/ConfidenceCheck.svelte`). The boot, Welcome, the hub (which sends a visit without Before
back to it, and offers Finish before every activity is done in an any-order session), the pager's last activity and Thank you all ask `nextStep()`.
Thank you shows "Your confidence moved up / stayed the same / moved down", "Before: 3 Moderately confident", "After: 4 Confident" once both exist.
The facilitator's preview shows both screens read-only.

The golden-ratio tokens are `styles/check-tokens.css` (a test holds the ratios to 1%). Where they and the page's rules differ, the page's win:
the side margin is the stage's gutter (622 px of content at 768 wide, not 658), so the cards are 114 × 185 (still 1 : 1.62) and the button is the
content's width over phi; the button is the page's primary button at 55 px, within the page's own button heights; the answer panel is the lower
38.2% of the screen to its foot (measured: within 1% of the 61.8% line at 768 × 1024). Landscape stacks the cards in the right 38.2%, each at least
89 px; under 600 px wide they are rows of at least 55 px. One `radiogroup` with `radio` cards (their names "2 Slightly confident"), one tab stop,
arrows move and pick, the picked card filled with the action colour, ringed, with a tick. Pictures: `test-results/confidence-check/`.

## The admin side

Content shows the client's check as a row of its own above the activities ("Asked at the start and the end."): Add a confidence check (the
wireframe's question and five steps), its question edited in the question editor, Delete refused while an open session asks it; it is never in
the activity list, never reordered among them, and not copied. Today's Controls switch it per session. The Live display's card ("Confidence
check, this session", Before and After, N of M, two bars) counts only, from the answers it already reads, never on the wall. Results show
Confidence shift, Moved to confident, "N of M guests answered both" and the Before and After bars. The one-page PDF and PowerPoint, and the leader
report's page 1, print `confidenceLine`; the participant answers CSV gains `Confidence before` and `Confidence after` (through `csvCell`) only for a
session that lists the check.

## Gates, before and after

Before: `6240061` (this branch's start), run in this checkout before anything changed; after: this branch. Windows, Node 22.23.3 (`.local/node22`);
Firefox does not start on this machine (spawn UNKNOWN), so the browser runs are Chromium and WebKit.

| Gate | Before | After |
|---|---|---|
| `npm run check:svelte` | 0 errors, 0 warnings | 0 errors, 0 warnings (415 files) |
| `npm test` | 1,540 of 1,540 | 1,610 of 1,610 (70 new: 69 in `test-confidence-check.js`, one bundle test) |
| `npm run test:baseline` | 38 of 38 | 38 of 38, the baselines translated and proved (above), none re-recorded or amended |
| `npm run test:bundle` | 44 of 44 | 45 of 45 |
| `npm run test:report` | 150 of 150 | 150 of 150 |
| `npm run test:report:mutations` | 64 of 64 caught | 64 of 64 caught (mutation 28 points at the CSV loop as it now reads) |
| `npm run test:charts` | 57 of 57 | 57 of 57 |
| `npm run test:storage` | 141 of 141 | 141 of 141 |
| `npm run test:foundation` | 70 of 70 | 70 of 70 |
| `npm run test:local-site` | 26 of 26 | 26 of 26 |
| `npm run oracle -- --seeds 500` | 0 differences (5,620 participants) | 0 differences (the same 5,620, and 9,865 guests of a confidence check) |
| `test:migration` (Chromium, WebKit) | not rerun at `6240061`; Prompt 19 recorded 920 passed, 25 failed, 16 skipped | 910 passed, 52 failed, 17 skipped (47.9 min); then every affected spec again, fixed |

The 52 failures of the full run: 26 are the known Windows faults Prompt 19 recorded (17 of `effects-audio.spec.ts`, `brand-smoke.spec.ts` and
`flow.spec.ts`'s header in WebKit, one `keyboard.spec.ts` test in WebKit, `admin-today.spec.ts` "slugs" in both, `contrast.spec.ts`,
`devices.spec.ts` iPhone landscape, `reflow.spec.ts` in both, and the known flake `brand-studio.spec.ts`'s answer tile); one was
`net::ERR_NO_BUFFER_SPACE` (the operating system, on a page load; the test passes alone); 25 were specs pinning this build's version, Setup's
column counts and Content's tab order (`schema-upgrade`, `schema-version`, `setup-provision`, `admin-content`'s keyboard order), which moved
with version 4 and the new "Add a confidence check" stop. The rerun of those specs, `confidence-check.spec.ts`, `request-baseline.spec.ts`
(the browsers' translated start-up), `keyboard`, `admin-today`, `live-display` and `results-order` in both engines found one more thing: an
un-upgraded site's admin page no longer stopped with `PMS-LST-011` (its first `$batch` failed on the sessions' new column first). `readLists`
now asks the settings item first after such a refusal, as the participant's watch does (a node test shows it failing before). After that, only
the known `admin-today` "slugs" (both) and WebKit `keyboard.spec.ts` remain. `confidence-check.spec.ts`: 9 of 9 in Chromium, 8 of 8 in WebKit (axe
runs once, in Chromium).

## Page sizes

| Page | Before | After | Change |
|---|---:|---:|---:|
| `index.html` (participant), gzip -9 | 160,367 B | 164,582 B | +4,215 B (ceiling 450,000 B, not raised; its Tailwind rules unchanged) |
| `admin.html`, gzip -9 | 585,277 B | 592,267 B | +6,990 B (budget 700,000 B) |
| `setup.html`, gzip -9 | | 792,450 B | the schema's two columns and the data layer |
| raw bytes | 383,543 / 1,614,695 / 1,182,538 | 400,893 / 1,635,752 / 1,185,936 | |

`PHASE_20` in `scripts/bundle-budget.js` records them, with allowances of 4,500 B (participant) and 7,500 B (admin).

## Proposed, not done

- **The multi-session Results dashboard** (boards 9 and 12) is not built. Its arithmetic is ready: `confidenceIndex`, `lowSample`, `MIN_SAMPLE`
  and `confidenceCheckResults` (the shape every session's results carry as `confidenceCheck`: counts, means, `shift`, `moved`, `distribution`,
  `labels`, `answeredBoth`, `answeredBeforeOnly`, `lowSample`).
- **Seeding the samples with the check.** `samplePack({ confidenceCheck: true })` gives Kroger and Domino's the wireframe's check, but Setup's
  "Seed sample clients", `server/data` and the tests use the pack as it was: seeding a site that already has the samples would have added a check
  to existing clients, which the prompt's first rule forbids. A check is added per client in Content. The pack has no "Template" client.
- **The shift on the Live display and the wall**: the Live display shows the producer's card only; the shift is on Results and in the files.
- **The styleguide** (`src/dev/Styleguide.svelte`), **`focus.spec.ts` / `keyboard.spec.ts`** and a **`look:` script** for the check screens were not
  extended; `confidence-check.spec.ts` covers the heading, the keyboard and the pictures at three sizes.
- **The runbook rehearsal** (`scripts/rehearsal-tests/runbook.spec.ts`, its own config, not part of `test:migration`) still pins version 3 and
  89 columns, and its version-2 site needs the `keepColumns`/`dropColumns` setup the node and browser upgrade tests now use. Not run or changed.
- **A restart in a browser**: both kinds are proved on the device's store and the data layer (node), not in a Playwright spec.

## What only the real site can show

QA-TESTING.md items 211 to 215: the upgrade of a test copy to version 4; a session with three iPads; reloads, restarts and an early end; the screen
upright and sideways on a real iPad; and the content owner's and the manager's answers on the labels, the 2 / 4 thresholds and the divisor.
