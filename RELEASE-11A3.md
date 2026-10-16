# Phase 11a-3: the polish batch after the 11a-2 real-site checks

Branch `pms-11a3` (on GitHub, never merged into `main`), from `3a8b32b` ("pms-283ad18 as deployed (VJR's tree)"). Items A, D(3), E and F are fixed with tests written
first; D(1) is traced to the pictures, not the code; G is investigated; B, C and the greeting of D(2) need no change by VJR's decisions. Every gate of the brief's section 5
was run on this machine, before (`3a8b32b`) and after; what could not run here is said in section 4. **Nothing has met the real site, an iPad or a projector.**

## 0. Where this started

- VJR's files arrived without their git history: this repository has no `pms-redesign`, `283ad18`, `ecc58fb` or tag `legacy-final`, so the brief's step 0 could not be done as
  written. In its place: the folder, built with `PMS_BUILD_ID=pms-283ad18` and LF line endings, gives `index.html`, `admin.html` and `setup.html` **byte for byte** equal to the
  deployed package `pms-283ad18` (`707beef9…`, `bf5513fd…`, `e97f28a1…`), which passes its own `SHA256SUMS.txt` (zip `8119e28a…cb6f`, as in the handover). That tree is `3a8b32b`.
- **This Windows checkout, and what it needed** (none of it changes the app): `core.autocrlf` set to `input` and the working files rewritten LF as committed (a CRLF tree builds
  pages that differ from an LF build); the suites run with Node 22 directly (`npm` puts the system Node 20.13 first on the PATH, and under Node 20 a top-level `before` does not run
  before a `describe`'s tests, which cancelled whole suites); `@napi-rs/canvas-win32-x64-msvc@0.1.100` installed with `--no-save` (`node_modules` came from a Mac and had only the
  Mac binary, so pdf.js had no `DOMMatrix`: every PDF and oracle test failed); Playwright's three browsers installed. `test-named-reads.js` compared paths with `/` and failed on
  Windows, cancelling the namespace and request-baseline suites: fixed in `b1092a3`, a test-only change.

## 1. The items

| Item | Commit | What changed | Test first (failed on the old code) |
|---|---|---|---|
| A, tooltip | `79c5d11` | `placeTip()` (`lib/tip-place.js`) takes `avoid`: the card's words and buttons (`data-tip-avoid` in `ResultCard`: headline, question, "N answered" line, Show answer, View as table, captions). Above, or above moved along while it still spans its mark, then under, or under moved along; where neither side is clear, the place that covers the fewest of their pixels. Always whole, inside the window, clear of the mark and its own label. | 4 tests in `scripts/test-results-chart-fit.js` (3 failed). In Chromium, `results-charts-fit.spec.ts` "the admin view …" passes, and with A's four files put back it fails with 12 tooltips over the question, "N answered · N of 4 got it right first time" or View as table "although there was room under its mark": the real-site defect. Pictures `test-results/11a3/A-*`. |
| B, name order | none | **No change, by VJR's decision D1 (16 Oct 2026):** names stay "Last, First" as the directory gives them, in Results, the charts, the report, the CSV and the greeting. | — |
| C, `/wall` header | none | **No change, by VJR's decision D2 (16 Oct 2026):** the wall page keeps the admin header, tabs, Lock and Export; Full screen is the projector view. | — |
| D(1), heroes | `b31c7fc` | **Not a code fault.** VJR's hero sources are JPEGs (no alpha), so the stored heroes are opaque squares; Brand Studio keeps a hero's transparency. `build:sample-pictures` takes `<client>-<slot>.png` when it is there. On PCOE a transparent PNG uploaded in Brand Studio fixes a hero with no new build. | None (tooling; the six pictures did not change). |
| D(2), greeting | none | No change (D1). | — |
| D(3), locked title | `e29d201`, `d6108d3` | A locked activity's title is white (`var(--text)`), as its caption and lock are; it was `--on-disabled` on `--disabled` (#4D80D0 on #034CB5, about 2:1). White has 4.5:1 or more on `--disabled` for every primary (6.05:1 at worst). `PHASE_11A3` holds the participant page. | `scripts/test-theme.js`: the rule and the contrast over 584 primaries (failed: no rule). |
| E, long answers in full screen | `613c8c5` | The fit step is `lib/present-fit.js`. Its floor is the factor that gives type 0.75; it was 0.5, so on a window 1,550 px wide or more the type stopped at 0.8 or above, neither smaller nor spilling, and the card was cut. At type 1.2 (an iPad upright, a phone) the steps are as they were. | `scripts/test-present-fit.js`, failed with a stand-in of the old floor. In Chromium the new spec passes (1920x600, 1600x700, 768x1024, 1080x1920) and with the old `LiveDisplay.svelte` fails: "1920x600, full screen, w1: the card's contents run 142px past its edge". Pictures `test-results/11a3/E-*` (cut after the fifth answer; all eight whole). **Whether this is what the real site showed is not known.** |
| F, the flake | `73f0b1b` | `lib/page-watch.ts` dropped an `online` that came while a look was on its way (and that look could have read the track before the test stamped the restart). Now it asks for one more look as soon as that one ends (never two at once; a `Retry-After` is still a floor). The test and its timeout are unchanged. | `scripts/test-page-watch.js` drives the real `page-watch.ts` (via Vite's esbuild): failed. `participant.spec.ts` passes in Chromium and WebKit. |
| G, the 403 | none | Investigated only; section 2. | — |

Also: the release documents (`8fe8bf1`: RUNBOOK.md's note for the PCOE site and "What changed since pms-283ad18" in RELEASE-NOTES.md, `scripts/test-release-docs.js` 15 of 15),
QA-TESTING.md items 161 to 166, VJR's decisions recorded (`9368ac9`), and the "Rules from Phase 11a-3" in AGENTS.md.

## 2. G: what the app does with a 403, and whether it can cause one

- **A write** (`spHttp`): a 403 whose words mention "security validation" or "request digest" gets a new write token and is tried once more; any other 403 is thrown as
  `SharePoint (403): <SharePoint's words>`, status 403.
- **A `$batch`** of reads (`spReadTogether`, `spReadOrBatch`): a 403 drops the write token and the same reads are made one by one; nothing is shown.
- **A plain read**: thrown as above. On a timer (the participant page's look, Content's and Guests' 15-second looks, the Live display) it is swallowed and the timer backs off; a
  403 is neither "signed out" (`lib/sign-in.js`) nor "unreachable", so the participant page shows nothing for it. The settings file answered 403 is `PMS-CFG-002`, `status 403`.
- **The words do not name the screen or the request**: SharePoint's own after "SharePoint (403):", with no list, address or screen. (Not changed: investigate only.)
- **What in the app could cause one:** a participant account opening `admin.html` (its PIN screen reads PMSAdminUsers, which those accounts must not read); a facilitator account
  without Contribute on a list the admin writes, or on PMSClientImages. A stale write token is handled. Nothing in the code builds a request SharePoint should refuse to a
  facilitator. The one 403 on record (QA-TESTING.md, after item 138) was a plain GET of PMSActivities that the console then read with 200: **nothing in the code explains it, and
  nothing more can be concluded without the time, the tab, and the Network panel's status and body.**

## 3. The gates, before (`3a8b32b`) and after (`pms-11a3`), Node 22, this Windows machine

| Gate | Before | After |
|---|---|---|
| `npm run check:svelte` | — | 0 errors, 0 warnings (359 files) |
| `npm test` (with the canvas binary, before the paths fix) | 1,194 of 1,227 pass; 1 fails, 32 cancelled (the Windows path in `test-named-reads.js`) | 1,205 of 1,238; the same 1 and 32, and nothing that fails only after |
| `npm test` (final) | — | **1,238 of 1,238** |
| `npm run test:baseline` (with namespace and named reads) | — | **83 of 83: no request baseline moved** |
| `npm run test:bundle` | — | 35 of 35. Participant 156,695 → **156,729 B (+34)**, admin 553,987 → **554,225 B (+238)**, Tailwind rules unchanged; ceilings 450,000 and 700,000 |
| `npm run test:migration`, Chromium | — | **every Chromium test passes** |
| `npm run test:migration`, WebKit | the same 20 fail (the five spec files rerun) | 20 fail: the 18 sound specs (`effects-audio`), `brand-smoke`, `flow.spec.ts:456`, `keyboard.spec.ts:314`; **identical before and after**: WebKit on Windows, not 11a-3 |
| `npm run test:migration`, Firefox | — | **not run**: Windows refuses to start Playwright's Firefox (`spawn UNKNOWN`, also outside the suite) |
| `npm run test:report:mutations` | — | **34 of 34 caught** |
| `npm run oracle -- --seeds 500` | — | **0 differences** (500 sessions, 5,620 participants, 50 on the local server, four time zones) |

The whole run of `test:migration` was 784 passed, 399 failed (378 of them Firefox's launch), 19 skipped and 16 did not run, in 42.7 minutes. The "before" column was not run for
every gate (the brief's step 2 was skipped at first, as asked); where a gate failed after, it was run before as well, and every such failure was there before.

## 4. What was not run, and what only the real site can show

- Firefox (refused by Windows here) and WebKit's sound and three other specs (failing before as after) need a Mac or another machine; `npm run test:rehearsal` was not run.
- **QA-TESTING.md items 161 to 166**: the tooltips on the laptop and the iPad, the heroes and a locked activity on an iPad, the long question in full screen on a projector, and the
  network coming back during a look.
- The project documents the brief names (`pms-handoff-status.md`, `pms-session-handover.md`, `pms-colleague-handover.md`, `pms-11a2-verification-status.md`) are not in this
  repository and were not updated.

## 5. The package

Made by `npm run package:release` from the commit that carries this report's gates; its name, checksums and the check from a fresh unzip follow.
