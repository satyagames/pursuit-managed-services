# Prompt 22: close the gaps found in the audit of Prompts 20 and 21

Branch `pms-22`, made from `1553f69` (the tip of `pms-21-7`, which holds `pms-20` and `pms-21-1` to `pms-21-7`; none is pushed). Not pushed.

**Nothing changes for a session with no summary, no check, or a role that does not see these screens.** No list, column or `pms-config.txt` key was
added (schema version 8); the audit list's `Action`, a text column, says two more words. The participant page is the same to the byte (`PHASE_22`).
No request baseline moved: the new writes (a settings save, a client's tags, moving stored quarters) are new tests.

## What was built

1. **The confidence shift per client and per session** (the manager's request). `lib/results/dashboard-model.js` gives each client row and each of
   its sessions `shift` and `moved` from `shiftOf` / `movedOf` of that group (no second formula), with `shiftLow` / `movedLow` by the tiles' rule. The
   card is **Confidence index and shift by client**: under each bar "Shift +24%", "8% moved to confident", "16 of 20 guests answered both", and "Low
   sample (n = x)" beside a low figure, which stays shown; the same in each client's row and session. Two i buttons head the column, and their words now
   say the shift **is not compared with the baseline** (it is the change on the scale itself; "Compare with" leaves it alone). Each i button's words have
   an id of their own (the same figure's i is now on the page more than once). The headline adds "Guests moved N% up the scale (X to Y), and P% of those
   who started not confident ended confident." only when measured (`pairedMeansOf` in `index-math.js` gives X and Y). Export report gains six columns.
   The oracle recounts every client's and session's shift and moved from raw pairs in whole numbers; a "plain mean of sessions" mutant of each is caught.
2. **The settings the dashboard reads now have screens.** `settings.manage` (Super admin only) is a new row of the matrix. **Reporting settings** (from
   the dashboard) sets the fiscal-year start month and the minimum sample; **About this client** (the client's page) sets Industry and Region for
   whoever has `clients.manage`, with the values in use as suggestions; labels show them on the client's page, its Clients row, its dashboard row and in
   Content (to read). The dashboard has a **Region** filter under More filters. `FIELD_WRITES` (access matrix) and `lib/access/field-values.js` make the
   write guard refuse another role (`AccessDenied`) and a value out of range (plain words) before anything is sent; every change is an audit line
   (`settings`, `client`; History of changes filters by both).
3. **The local site shows the check.** A new scenario, `confidence-check`: both clients ask it; two ended sessions (some guests Before only) with their
   summaries written by the dashboard's own code; Kroger live with it. Setup's real **Seed sample clients** and every other scenario are unchanged.
4. **Stale specs read their numbers** from the schema and from Setup's own plan, and the Setup specs tell a read from a write (`isRead`).

## Where the brief did not match the tree (said, as the brief asks)

- **The fiscal start month and Rebuild.** The brief says to offer "the existing Rebuild summaries so stored periods follow the new month". Rebuild
  cannot do that: it writes only the summaries that are missing, and `summaryOf` takes a session's stored `Period` before its date. So the screen offers
  **Move stored quarters** (`moveStoredPeriods`): each session's `Period`, then each summary written again whole with its new `Period`, only on the
  person's second yes, with one audit line. Nothing is moved otherwise.
- **The data layer's validation.** Every page carries `lib/data/`, so a value check there would have grown the participant page. The check is in the
  write guard (which the data layer asks before every write, and which only the admin page installs) and in the screens; the participant page and
  Setup write none of these columns.
- **The `server/data` seed was not changed.** About twenty node suites and specs count its rows (`scripts/test-seeds.js`, `test-admin-today.js` and the
  rest), so adding a check there would have changed numbers far from this prompt. The local site's new scenario shows the feature instead; `npm run dev`
  shows it after a check is added in Content.
- **The local site has no Producer persona.** Its personas are SharePoint accounts (owner, staff, guest, outsider); the admin unlocks with the local
  PIN. "The Producer card" is the Live display's check card, which the local-site test reads there.
- **The bisect's culprit is not Prompt 20.** See Part 4 below.
- `scripts/test-local-site.js` still expected "Passed: 11 of 11 steps" (12 since Prompt 21 Phase 7): fixed (the one local-site failure before).

## Part 2's finding: what follows the fiscal start month

Read when a page opens, so **at once**: the dashboard's FY and quarter chips and the days each covers, which sessions are in view (by their date), the
all-client and one-client baselines (the same days), the tiles, the index and shift by client, and the quarter given to every session planned after.
**Kept**: the `Period` stored on each session when it was planned and copied into its summary, so the trend by quarter, a client's change since the
quarter before, the quarter-before and same-quarter-last-year baselines, the Fiscal year list, and the quarters a Leadership period reads summaries by
keep the old months until the stored quarters are moved. The confirmation says this in plain words with the counts (`fiscalChangeWords`).

## Part 4: the stale specs, and the bisect

| Spec | Before (Chromium + WebKit) | After |
|---|---|---|
| `setup-provision.spec.ts` | 10 failed of 24 | 24 of 24 |
| `schema-version.spec.ts` | 8 failed of 20 | 22 of 22 (a version-7 case added) |
| `schema-upgrade.spec.ts` | 6 failed of 6 | 6 of 6 |
| `admin-content-sharepoint.spec.ts` | 1 failed (budgets run on Chromium only) | 8 run, 6 skipped by design |
| runbook rehearsal (`test:rehearsal`) | 11 failed of 12 (and Firefox does not start) | 12 of 12 |
| `setup.spec.ts` + `setup-deployment.spec.ts` | 9 failed of 26 | 26 of 26 |

- **Content's "4 requests"**: the write token is asked for as the page opens since Prompt 21 (the sign-in check is a `$batch`), so the PIN no longer
  asks for it: 3 from the PIN. The spec now proves the token was asked once, before.
- **The rehearsal's Results order**: newest first since Phase 16; the rehearsal still expected the older order.
- **The bisect.** `setup.spec.ts` and `setup-deployment.spec.ts` pass 26 of 26 on `6240061` (before Prompt 20) and on `pms-20` (`21cef34`), and fail 9 on
  `pms-21-1` (`441ee98`) and `pms-21-7` (`1553f69`). Inside Prompt 21 Phase 1: `514edf2` (the settings read after a refused read, the one the brief
  suspected) and `603209c` fail only on stale counts (12 lists, a request total); the requests "where nothing is expected" start at **`5dfd42f`**,
  Setup's **People and access**, which reads who is signed in and the owners group (a write token and a `$batch` of two GETs) and the people and their
  roles as Setup opens. They are reads; nothing is written. So the fix was in the specs, not the app: `isRead` counts a GET, the write token and a
  `$batch` of GETs as reads; the self-test spec waits for People and access before clearing its log (its 3 extra requests were that read landing late);
  the lists and the self-test's per-list probes are counted from the schema (63 requests = 31 + 2 x 16 lists; the first create costs 2 because the
  token is already held). The release notes' "older than Phase 7" was right; "two or three requests where nothing is expected" were reads.
- **Left alone, as the brief says** (not rerun here; their state is RELEASE-21G's): the Live display's focus ring at 1.64:1 (`contrast.spec.ts`),
  Content's client chip cut at 200% text (`reflow.spec.ts`), WebKit's keyboard never reaching "Open participant view" on Today (`keyboard.spec.ts`), the
  admin's Content strip over the home indicator on an iPhone in landscape (`devices.spec.ts`, Chromium), the audio spec in WebKit, and `admin-today`'s
  slugs flake.

## Gates, before and after

| Gate | Before (`1553f69`) | After |
|---|---|---|
| `npm run check:svelte` | 0 errors, 458 files | 0 errors, 464 files |
| `npm test` | 1,884 of 1,884 | 1,918 of 1,918 |
| `npm run test:baseline` | 38 of 38 | 38 of 38 (no baseline moved) |
| `npm run test:bundle` | 52 of 52 | 53 of 53 (`PHASE_22`) |
| `npm run test:report` | 158 of 158 | 158 of 158 |
| `npm run test:report:mutations` | 64 of 64 caught | 64 of 64 caught |
| `npm run oracle -- --seeds 500` | 0 differences | 0 differences (now each client's and session's shift and moved too) |
| `npm run test:charts` | 57 of 57 | 57 of 57 |
| `npm run test:local-site` | 25 of 26 (the self-test's "11 of 11 steps", stale since Phase 7) | 27 of 28 before the new package (the dashboard words are not in `pms-1553f69`, which the local site serves); run again on this prompt's package (see the final report) |
| Browser specs touched | see Part 4's table; `leader-dashboard.spec.ts` 7 + 7, `reporting-settings.spec.ts` 4 + 4, `client-sessions.spec.ts` 4 + 4 in Chromium + WebKit | all pass |

Not run in this prompt: the whole `npm run test:migration` (about 45 minutes) and `npm run test:a11y`; axe ran inside every spec touched.

## Page sizes (the budget's gzip)

| Page | `1553f69` | Now | Change |
|---|---|---|---|
| Participant | 167,109 B | 167,109 B | +0 (allowance 0; the same Tailwind rules; ceiling 450,000 B not raised) |
| Admin | 640,183 B | 646,950 B | +6,767 (allowance 10,000; budget 700,000 B) |
| Setup | 802,924 B | 803,193 B | +269 (no budget: the matrix row and the field rules it imports) |

## Proven in node, in the browser and on the local site, and only reasoned about

- **Proven in node**: the per-client and per-session shift and moved, hand-worked (a client of two sessions of 30 and 10 paired guests: 15%, not the
  plain 10%); the headline, the words, the CSV, the Region filter; the oracle over 500 seeds and its two mutants; the matrix row; the guarded columns on
  the local server and on SharePoint; the value rules; each save and its audit line; a refused role sends nothing; the stored quarters a new month leaves
  behind and moving them.
- **Proven in the built pages** (Chromium and WebKit, mocked SharePoint): the card, the rows, the i buttons by Tab, Enter, Space and Escape, no
  sideways scroll at 1280, 768 and 375, axe; Reporting settings by keyboard, the refused 0, the Low sample tag going at 3, both questions of a new
  month, the audit lines; who sees what; About this client and its suggestions; a Designer's labels in Content.
- **On the local site**: the scenario in node; Results, the Live display's Producer card and the dashboard in Chromium (once the new package is built).
- **Only reasoned about**: the real site (QA-TESTING.md 274 to 278); that SharePoint keeps a `$batch`'s write token as the mock does (the Content and
  Setup counts rest on it); that moving many stored quarters on PCOE stays within its request limits (two requests a summary, one a session).

## Proposed, not done

Per-client shift on the Live display and the wall; saved dashboard views kept between visits; a PDF of the dashboard; two sessions live at the same
moment; a "Template" sample client; a button in Setup that sets the access lists' permissions; a check in `server/data` (see above).

## Everything still open for the real site

1. QA-TESTING.md items 274 to 278 (no upgrade), after 216 to 273.
2. The manager answered item 278 (30 Oct 2026): the shift divides by the full scale (5), as built; a Low sample shift shows its number, as built;
   the headline's "(X to Y)" is shown with scales of different lengths, one for each scale (`pairedMeansByScale`; built after this note's gates,
   with its tests first: `test-index-math` and `test-leader-dashboard`).
3. Then push `pms-21-1` to `pms-21-7` and `pms-22` in order.

## Lessons

- `String.replace` reads `$\`` and `$'` in a replacement: an edit script that writes template literals passes a function (`() => text`).
- Tailwind reads every word under `migration/`: "absolute" in the i words added a rule to the participant page; the words were changed.
- A spec that counts "every non-GET" as a write breaks the day a page batches its reads.
