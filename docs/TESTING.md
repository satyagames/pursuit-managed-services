# Testing

What each gate proves, how long it takes on the development machine (a Windows laptop, Node 22), and how to run one part of it. The short list is in
[CLAUDE.md](../CLAUDE.md); the rule that goes with each part of the code is in [RULES.md](RULES.md).

## Before you run anything

- **Node 22** (`package.json` asks for 22.12 or later). On the Windows checkout the system Node is 20, under which a top-level `before()` of a
  `node --test` file does not run before a `describe`'s tests: run the suites with `.local/node22/node.exe`, and run npm through it
  (`.local/node22/node.exe "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" test`) so that its scripts get Node 22 too.
- **Line endings:** `git config core.autocrlf input`. A CRLF working tree builds pages that differ from an LF build by a few bytes.
- **Browsers:** `node node_modules/playwright/cli.js install chromium webkit firefox` once. Firefox does not start on the development Windows machine
  (`spawn UNKNOWN`): there the browser suites run in Chromium and WebKit only, and Firefox is not exercised.
- **pdf.js on Windows** needs `@napi-rs/canvas-win32-x64-msvc` at the lock file's version (`npm install --no-save`) when `node_modules` came from a Mac.

## The gates

| Gate | What it proves | Time |
|---|---|---:|
| `npm run check:svelte` | TypeScript and Svelte diagnostics: 0 errors, 0 warnings. | 6 s |
| `npm test` | Every node suite: the data layer on both adapters (the mocked SharePoint REST and the real local server), the request baselines, the bundle budgets, the counting rules, the exports read back, the schema, the documents (`scripts/check-docs.js`) and the module headers. | 20 s |
| `npm run test:baseline` | Every SharePoint request ten mocked suites send is the one recorded in `scripts/request-baseline/` (part of `npm test`). A difference is a finding, never a reason to re-record. | in `npm test` |
| `npm run test:bundle` | The three pages' sizes against their budgets, the participant page free of the admin's libraries, and each phase's recorded sizes (part of `npm test`). | 5 s |
| `npm run test:report` | The leader report, its PDF, the CSVs and the Live display's summary pack, held to sessions worked out by hand and read back with pdf.js. | 4 s |
| `npm run test:report:mutations` | The report's tests catch each of 64 deliberate breakages of the counting, drawing and wording. | 22 s |
| `npm run oracle -- --seeds 500` | 500 random sessions counted again by rules of the oracle's own, in four time zones, on both adapters: 0 differences. | 6 s |
| `npm run test:charts` | Every number a Results chart shows, the palette's contrast, the wall's address, where a tooltip goes. | 1 s |
| `npm run test:local-site` | The local PCOE stand-in answers as PCOE does, and Setup's self-test passes 11 of 11 on it (needs a release package). | 3 s |
| `npm run test:migration` | Builds the pages and runs every browser spec in Chromium, WebKit and Firefox: the participant flow, every admin screen, accessibility (axe), devices, effects, request budgets in a real browser. | about 45 min (two engines) |
| `npm run package:release` | Builds the release package from a clean committed tree in a fresh checkout, with its proofs and checksums. | 5 s |
| `npm run test:rehearsal` | RUNBOOK.md's steps on the mock with the newest package's pages, in three engines. Not part of `test:migration`. | |

**Known flakes:** two tests read a record back the moment the screen says it is saved, before the write has landed, and fail now and then on this
machine: `admin-today.spec.ts` "slugs" (3 of 3 on the untouched commit of Phase 13) and `brand-studio.spec.ts` "an answer tile's picture can be uploaded
in Content" (7 of 9 runs on the untouched `1ab63bd`, 6 of 9 on Phase 14's branch). Neither is a regression of a change unless it fails differently. Also on
this machine, before and after every change, in WebKit on Windows: 17 tests of `effects-audio.spec.ts`, `brand-smoke.spec.ts`, `flow.spec.ts` (a tile whose picture fails) and one `keyboard.spec.ts` test fail.

**One browser, one file:** `npx playwright test --config migration/playwright.config.ts --project=chromium scripts/migration-tests/flow.spec.ts`
(build the pages first: `npm run build:svelte:release`). What does not run in an engine, and why, is listed at the top of
`migration/playwright.config.ts`; nothing is skipped quietly.

**The local site** ([LOCAL-SITE.md](LOCAL-SITE.md)): `npm run local:site -- --open` serves the newest release package's own bytes at a stand-in of PCOE;
`npm run ux:shoot` photographs every screen on every device size into `ux-review/<date>/`. With `-- --matrix brief` it uses the seven sizes of `devices.spec.ts`, and with
`-- --measure` it also measures every picture's geometry (`scripts/local-site/align-probe.js`: sideways scroll, small targets, off-centre blocks, unequal widths
and heights, rings cut by an ancestor, overlaps) into `alignment.json`; `node scripts/local-site/align-report.js --date <date>` groups it (Phase 15,
[ALIGNMENT-REVIEW.md](history/ALIGNMENT-REVIEW.md)). `alignment.spec.ts` (in `npm run test:migration`) holds what that review fixed and the geometry of a question at those
seven sizes.

## Every command, and what it holds

- `npm install` — installs the dependencies and runs no script of this package (the `postinstall` that copied
  libraries into `public/vendor/` for the legacy pages left in Phase 10c-1; a `public/vendor/` or `build/` folder
  still on a machine is a leftover that nothing reads).
- **Running it locally is one command.** `npm run dev` ([scripts/dev.js](../scripts/dev.js)) starts the local server (the API under `/api`
  and the uploaded pictures) and the three pages from Vite (participant 5173, admin 5175, Setup 5176), which sends `/api` and `/assets`
  to the server, against a copy of `server/data` made into the git-ignored `.local-data/` (`-- --reset` makes it again). `npm run dev:api`
  is the server alone with `node --watch`, `npm run dev:svelte`, `dev:svelte:admin` and `dev:svelte:setup` are single pages, `npm start` is
  the server without watch. `npm run doctor` ([scripts/doctor.js](../scripts/doctor.js)) checks Node (22.12 or newer, `.nvmrc`), the install and the ports;
  [scripts/local-env.js](../scripts/local-env.js) holds what the three share (ports, quiet commands, git info, zip); [scripts/node-guard.js](../scripts/node-guard.js) gives a plain message, or uses `.local/node22` when it exists, instead of Vite's own error on an older Node. Known gap: on the local server the admin's
  participant link and QR codes point at the server's own port (`lib/admin/admin-links.ts`), where the legacy participant
  page used to be and no page is now; open the participant page at Vite's address instead (CLEAN-BREAK-10C1.md, in git history at `7347c72`).
- `npm run build:svelte:release` — builds the three standalone pages (`index.html`, `admin.html`, `setup.html`) into
  `build-svelte/release/`. No subfolders are needed on SharePoint. `npm run build` ([scripts/build.js](../scripts/build.js)) runs it and
  gathers the four files to upload (the three pages and `pms-config.txt`) into `build-svelte/upload/` (`-- --zip` for `upload.zip`).
  The official package with checksums remains `npm run package:release`. (`npm run test:build` was the legacy build's test; it is gone.)
- `npm test` — the node suites listed in `package.json` (1,475 tests, about 20 seconds); the first is [scripts/test-sessions.js](../scripts/test-sessions.js), which spins up a
  real server against a scratch copy of `server/data/`, and drives it through
  `dataService` to exercise track merge/resume, admin restart, and QR token
  lifecycle. Run this after touching `server/`, `lib/data/`, or session/track logic.
- **Phase 17's suites** (all part of `npm test`): [scripts/test-data-surface.js](../scripts/test-data-surface.js) holds the data service's 107 public names, each
  with its kind and arity, to `scripts/data-surface.json` and its count in DECISIONS.md; [scripts/test-data-modules.js](../scripts/test-data-modules.js) holds the shape
  of `lib/data/` (one state instance per page, only `core.js` keeps state and fetches, the facade passes on exactly the surface, no app file imports a part,
  no import cycle under `migration/src`, `core.js` imports only `encoding.js`, no part over 600 lines, a header on each); [scripts/test-store.js](../scripts/test-store.js)
  holds the local server's store to a write that meets a read of the same list (Windows refuses a rename over an open file). A suite that opens fresh pages
  (`dataService.js?page=N`) imports [scripts/fresh-page.js](../scripts/fresh-page.js) first, an in-thread resolve hook that gives each page its own copy of every
  part; [scripts/data-layer-source.js](../scripts/data-layer-source.js) is the data layer's source for the suites that read it as text.
- `npm run validate:data` — runs [scripts/validate-data.js](../scripts/validate-data.js):
  checks `server/data/*.json` for duplicate IDs, dangling references, bidirectional
  section/question links, and valid enum values. Run after hand-editing any seed JSON.
- `npm run test:storage` — runs `scripts/test-participant-storage.js` and `scripts/test-seeds.js`
  (both also part of `npm test`): request budgets, races, resume, both response shapes, adapter
  parity, activation, the schema check and self-test, and the sample-client seeds, against the mocked
  SharePoint REST in [scripts/sharepoint-fake.js](../scripts/sharepoint-fake.js) and the real local
  server on a scratch data directory. It prints the measured request counts. Run it after touching
  `lib/data/`, `server/`, or `migration/src/lib/participant/` (`boot`, `answer-store`, `participantData`), `lib/setup/` (`seed`, `sample-clients`) or `lib/brand/client-theme.js`.
- `npm run go-live -- <clientId> [YYYY-MM-DD]` — makes a client today's client on the running local
  server (`activateClient`); with no argument it lists the clients. A local shortcut: the admin's
  **Today** screen does the same for a facilitator (Phase 5), on SharePoint too.
- `npm run test:admin` — runs [scripts/test-admin-today.js](../scripts/test-admin-today.js) (also part of `npm test`):
  the Today and Clients rules (readiness, what is live, the switch confirmation, slugs, the stored theme,
  contrast of the admin colours) and the request counts of Today's load, poll and Go live against the
  mocked SharePoint REST and the local server. Run it after touching `migration/src/lib/admin-*.js`,
  `readLists` or `activateSession`. The browser side is `admin-today.spec.ts` (local server),
  `admin-sharepoint.spec.ts` (budgets and the schema blockers against the fake) and `admin-smoke.spec.ts`
  (Chromium and WebKit); `npm run test:migration` runs them.
- `npm run test:content` — runs [scripts/test-admin-content.js](../scripts/test-admin-content.js) (also part of `npm test`): the
  Content and Guests rules (`migration/src/lib/admin/admin-content.js`: grouping, order, pasted names, guest status, CSV, the print sheet,
  what a copy is) and section 6 of the data layer, `lib/data/content-copy.js` and `guests.js` (copy, duplicate, assign, delete, bulk guests, bulk codes) against the mocked
  SharePoint REST (request counts, pacing, injected failures) and the real local server, which must leave the same records. Run it
  after touching section 6 or `admin-content.js`. The browser side is `admin-content.spec.ts` and `admin-guests.spec.ts` (local
  server; `admin-local.ts` is their shared harness, one scratch server per test, uploads in the scratch folder too) and
  `admin-content-sharepoint.spec.ts` (budgets against the fake, the QR address in SharePoint mode, and a smoke test that also runs
  on WebKit); it writes the measured counts to `test-results/budget/admin-content-sharepoint.json`.
- `node --test scripts/test-admin-results.js` (also part of `npm test`, Phase 16): Results' order (`newestFirst`, `keepShownOrder`, `rowsInOrder` in
  `migration/src/lib/admin/admin-results.js`): dates, ties, missing dates, stability, no change to the input, and that the leader report, the CSVs, the
  Live display and the oracle do not use it. The browser side is `results-order.spec.ts`.
- `node --test scripts/test-session-delete.js` (also part of `npm test`, Phase 16): Delete session (`migration/src/lib/admin/session-delete.js`) on the mocked
  SharePoint and the real local server: every list with a session id is in `SESSION_OWNED` or `KEPT` (and the check can fail), the order, the words, the
  live session refused, numbers read again, a second run, a stop at each list that leaves a session to delete again, a 403, the same id made again, and the
  requests for sessions of 0, 1, 60 and 200 iPads. The browser side is `session-delete.spec.ts` (the warning, Cancel, Escape, a double click, the live
  session, a 403 and Try again, axe, focus, a participant page and a guest code of the deleted session). Content's question editor in place and Results'
  Restart under its row are `content-edit-in-place.spec.ts` and `results-restart-inline.spec.ts` (the SharePoint mock, Chromium and WebKit).
- `node --test scripts/test-admin-content-views.js` (also part of `npm test`, Phase 18): Content's views list (`migration/src/lib/admin/admin-content-views.js`):
  every view complete with one default, the address round trip, `#content`, `#sections` and unknown segments, no other tab's address claimed, the
  badges' words, the strip's keys, and the remembered view in memory with no browser storage touched. `node --test scripts/test-brand-studio-embedded.js`
  (also part of `npm test`) renders Brand Studio on the server through Vite and compares it on its own with `scripts/brand-studio-markup.html`
  (recorded from Phase 17's file; `PMS_RECORD_MARKUP=1` records it again, for a deliberate change only), and embedded with its level 3 heading and no
  Back button. The browser side is `content-brand.spec.ts` (the strip, the address, Clients' Brand, a switch that keeps both views, the guards from a
  view out of sight, the bridge, the keyboard, requests, timers and memory, the sticky budget at 1366 by 768 and 1180 by 820, axe and reflow).
- `node --test scripts/test-confidence-check.js` (also part of `npm test`, Prompt 20): Part 0's proof that `@before`/`@after` records survive the save,
  the merge, the store and both restarts, and leave every tally as it was; the arithmetic of `lib/results/confidence-shift.js` worked by hand
  (3, 4 and 5 points, ties on the thresholds, an empty session), its properties over 300 seeds, and the oracle's check block caught when wrong;
  every row of board 14 against `nextStep()`; the schema (version 4, a site of version 3 brought up with nothing lost); the boot's resume step; the
  golden-ratio tokens to 1%; Content's rules, the producer's counts, Results' words, the leader report, its CSV and the pack. The request
  baselines followed the two columns by [scripts/schema-baseline/columns-baselines.js](../scripts/schema-baseline/columns-baselines.js)
  (`--order`, `--check`, `--write`): the suites run on the last commit's tree and on today's, request by request, and a fresh recording equal to the
  translation. The browser side is `confidence-check.spec.ts` (Chromium and WebKit; pictures in `test-results/confidence-check/`).
- `node --test scripts/test-access.js` (also part of `npm test`, Prompt 21, Phase 1): schema version 5 (the three access lists, the two settings, a
  site of version 4 without them); the role matrix printed and held to board 10, and every write of the app named in `LIST_WRITES`; `can()`
  for each role, scope, extra, `ValidUntil`, a disabled person, the site owner and the legacy admin; `AccessDenied` and the write guard on
  SharePoint's and the local server's requests, and in the data layer (nothing refused is sent; `configure()` takes the guard away);
  `resolveAccess()` in two round trips however many people the site has, kept and read again on demand, and without `$batch`; the sign-in
  step; grants, the last Super admin, your own roles, a duplicate grant, the audit list; Setup's copy of `PMSAdminUsers` (idempotent, counts) and
  "Make me a Super admin"; the words. `node --test scripts/test-schema-version.js` holds a site of version 4 stopping with `PMS-LST-011`. The
  request baselines followed version 5 by [scripts/schema-baseline/access-baselines.js](../scripts/schema-baseline/access-baselines.js)
  (`--order`, `--check`, `--write`): every recorded suite run on `21cef34`'s tree (where the branch began) and on today's, request by
  request, the settings' `$select` and the every-list column check translated, only requests of version 5 added, and a fresh recording equal to
  the translation.
- `node --test scripts/test-scope.js` (also part of `npm test`, Prompt 21, Phase 4): the menu of each role from the role matrix, Content's edit, view and none, the pickers and their "24 Oct 09:30 Morning workshop" labels, day one (a client nobody was given to is seen by global roles only), the scoped read queries and `scopedReader`, the guard's read check and owners (a session, an activity, a question), a write held to the real client, **one test for every cell of the capability matrix that is not "no"**, **a forbidden write for every role** (`AccessDenied`, nothing sent), the data layer refusing a scoped role's unfiltered or foreign read before any request, and the words "Survey feedback". `node --test scripts/test-guest-group.js`: schema version 7's `GuestGroup`, a pasted line's group, adding a guest with and without one on the mocked SharePoint. `scripts/migration-tests/role-scoping.spec.ts` runs the BUILT admin page signed in as a Producer, a Designer, Leadership, an Admin and a Super admin: each menu, "View only" with its controls off and axe on it, the extra, and the network log of a Producer (no request names the other client or its session); it is in `npm run test:a11y`. The request baselines followed version 7 by [scripts/schema-baseline/guestgroup-baselines.js](../scripts/schema-baseline/guestgroup-baselines.js) (every recorded suite on `dda6eb2`'s tree and on today's, request by request; only Setup's new column added; a fresh recording equal to the translation in all 13).
- `node --test scripts/test-index-math.js`, `scripts/test-session-summary.js` and `scripts/test-leader-dashboard.js` (all part of `npm test`, Prompt 21, Phase 5): the Leadership dashboard's arithmetic worked out by hand (an index and its divide-by-zero guard, the client, session and priority indexes, change, low sample, the pooled shift, the quarters and the four baselines, and properties over random summaries); a session's summary from the leader report's counts, from four guests worked by hand; who reads which summaries (the read check per role, the places asked for, the mocked reads by `ClientId`, AppId and `Period`); **the request budget: 10,000 answers cost the dashboard the same two requests as none**; and the figures (the tiles, the headline, by client and its sessions, the baselines, low sample, the trend, the priority index, the steps, the themes and names, the filters, the report's CSV). `scripts/oracle-results.js` recounts the indexes of a dashboard of its own for every seed from raw scores and choices (`generateIndexes`, `indexOracle`: 0 differences over 500 seeds). `scripts/migration-tests/leader-dashboard.spec.ts` runs the BUILT admin page as Leadership for a period, Leadership on one client and a Producer: the dashboard opens with its heading focused, nothing of another client and no answer is asked for, the arrow opens a client's sessions in place, the i button shows its words on focus and hides them on Escape, the keyboard reaches the filters, and axe finds nothing; it is in `npm run test:a11y`. The request baselines followed version 8 by [scripts/schema-baseline/summary-baselines.js](../scripts/schema-baseline/summary-baselines.js) (every recorded suite on `ca3a16b`'s tree and on today's, request by request; a fresh recording equal to the translation in all 17); `test-session-delete`'s was amended with `--amend --code` for the summary a delete removes.
- `node --test scripts/test-hide-names.js` and `scripts/test-access-recheck.js` (both part of `npm test`; the first in `npm run test:report` too, Prompt 21,
  Phase 6): Hide names over the leader report's Harbour session (everyone Guest 1 to Guest 7 in the order they joined, in the rows, the charts' names, the
  report, its comments, its PDF read back and All answers (CSV); no recorded name left; off, as before), and a person turned off while the page is open
  (five minutes between reads, `turned-off` and `role-removed`, never the site owner, every write refused, the words). `scripts/test-leader-dashboard.js`
  parts 4 and 5 hold the dashboard's empty states and its words. In the browser: `leader-report.spec.ts` (Hide names on Sessions, the PDF and the CSV),
  `role-scoping.spec.ts` (turned off while open, with the clock moved on five minutes), `leader-dashboard.spec.ts` (no summary yet; the switch shared with
  Sessions). Three failures of `npm run test:a11y` are older than this phase and fail the same on its starting commit (RELEASE-21F.md).
- `node --test scripts/test-hardening.js` (part of `npm test`, Prompt 21, Phase 7): the access lists' permissions (the plan's four steps, the findings for
  a list that still inherits, a member who may change a people list, an audit list a member may edit or no one may add to, the self-test probe's six
  GETs and a refused read), the answer readers and the Live feed refusing a session not held before any request (and reading one held, and a global role
  as before), and History of changes (Super admin only; newest first; the filters; pages of 50; no answer shown). In the browser: `users.spec.ts` (History
  of changes: focus, axe, filters, no write; none for an Admin; now in `npm run test:a11y`) and `setup-provision.spec.ts` (the plan's four steps).
- `node --test scripts/test-sessions-plan.js` (also part of `npm test`, Prompt 21, Phase 3): schema version 6's session columns (and a site of version 5
  stopping with PMS-LST-011), the period from the fiscal start month, a planned session's id and its -2 and -3 on a duplicate, an old id still found,
  two sessions on one day for one client and for two (their QR codes and visits with their own session), starting a planned session (the activities
  added since), the New session form, Planned, Live and Ended, the one-live limit in words, the Client team (registered people only, whole client or
  selected sessions, the Designer's extra, a Producer refused), the Admin plans and the Producer starts (each refused the other's write, nothing
  sent), Today's readiness with nothing planned, the day's session picked, and a client's several open sessions. `scripts/migration-tests/client-sessions.spec.ts`
  runs the BUILT admin page signed in as an Admin and a Producer: planning two sessions on one day, the team (selected sessions, Remove), heading
  focus, an Admin's Go live off, a Producer picking and starting one of the day's two sessions, the one-live words, and axe on each screen (Chromium
  and WebKit, 29 Oct 2026); it is in `npm run test:a11y`. The request baselines followed version 6 by
  [scripts/schema-baseline/sessions-baselines.js](../scripts/schema-baseline/sessions-baselines.js) (every recorded suite on `43a98d4`'s tree and
  on today's, request by request; only Setup's four new columns added; a fresh recording equal to the translation in all 17), and two (test-named-reads,
  test-participant-names) were amended with `--amend --code` for Results' 15 sessions to a read.
- `node --test scripts/test-users.js` (also part of `npm test`, Prompt 21, Phase 2): the People rules and calls on the mocked SharePoint: the list
  (roles and reach from current rows, the chips, search, Client and Session, Status, pages of 50), the people picker's state machine (two
  characters, the pause, eight suggestions, a stale search aborted and dropped, Up, Down, Enter, Escape, "unverified", the words a screen reader is
  told), the directory search through the data layer (at most eight, the abort signal reaches the request, a refusal is not a lost sign-in, the
  local server has none), adding a person (no role, one audit line, "already there"), turning access off and on, removing a role (its words, "already
  gone"), the extras, the history, and the guards in the data layer (nothing refused is sent). `scripts/migration-tests/users.spec.ts` runs the BUILT
  admin page signed in as a Super admin, an Admin and a Producer: the list and its filters, Add user by keyboard alone, Give access, Remove with its
  confirmation, a refused picker, who sees the tab, heading focus, and axe on each screen (Chromium: 5 of 5 on 29 Oct 2026; not yet run in WebKit).
  `scripts/sharepoint-fake.js` takes `directory` and `pickerStatus` for the people picker.
- `node --test scripts/test-session.js` (also part of `npm test`, Prompt 19): the rule book of refusals (`REFUSALS` in
  `migration/src/lib/data/session.js`, each row against its own case, and nothing of a stale write token or a busy site taken for a sign-in), and the
  ladder on the mocked SharePoint with a renewer the test supplies: a stale token as before, a sign-in mended at Step A, one that needs Step B, one
  that is never renewed (the typed error, the banner's words, Details), a list refused with the sign-in proven (a permission, not tried again), ten
  refused reads and one renewal (single flight), the cooldown, a write sent at most twice and never after a part of a `$batch` was refused, a page
  with no renewer and the local server sending what they always did, 429 and 503 as before, the evidence (20 at most, no item id); and the admin
  page's keep-alive on the real `page-watch.ts` with a stand-in window. `scripts/sharepoint-fake.js` gives every suite `fake.expireSession()` and
  `fake.renewSession()`. The browser side is `session.spec.ts` (Chromium and WebKit: Step B with a real frame against the built admin page, the banner,
  Details with the SPRequestGuid, "Reconnected.", Reload, unsaved Brand changes kept, axe and the keyboard) and `session-keepalive.spec.ts`
  (Playwright's clock: one light read after ten idle minutes, none on a screen that refreshes, none while hidden).
- `npm run check:svelte` — type and accessibility diagnostics for the Svelte app in
  `migration/`. `npm run test:foundation` runs the theme and design-foundation unit tests
  (also part of `npm test`); `npm run test:migration` rebuilds and runs the built-page
  Playwright suite (its `flow.spec.ts` walks the participant flow and writes screenshots at 390x844,
  820x1180 and 1440x900 to `test-results/flow/`); `npm run test:styleguide` audits the dev-only
  `#/styleguide` and writes screenshots to `test-results/styleguide/`. `npm test` also runs
  `scripts/test-pager.js` (the pager rules) and `scripts/test-effects.js` (cue table, effect mapping, confetti
  plan, and the guard that keeps Web Audio and canvas-confetti behind `effects.ts`).
- `npm run test:brand` — runs [scripts/test-brand.js](../scripts/test-brand.js) and `scripts/test-brand-storage.js` (both also part of
  `npm test`): Brand Studio's plain functions (slot specs, file sniffing, crop maths, the compress loop with a fake encoder, the scrim, file
  names and SHA-256, the draft, the checks, what a save writes, `deriveTheme` contrast for 30 primaries) and where the pictures go (the
  picture library, PMSClientImages, on the mocked SharePoint REST, `UPLOAD_DIR` on the real local server). The browser side is `brand-studio.spec.ts`
  (Chromium; generated test images in `brand-images.ts`), `brand-smoke.spec.ts` (Chromium and WebKit) and
  `brand-studio-sharepoint.spec.ts` (request budgets, written to `test-results/budget/brand-studio-sharepoint.json`); screenshots of
  every device and screen are in `test-results/admin/brand-*.png`. Run it after touching `migration/src/lib/brand/` (the asset, crop,
  sniffing, scrim, brand, colour and theme modules), `migration/src/admin/{BrandStudio,BrandColours,BrandPreview*,AssetUploader,
  CropDialog,CopyBrandDialog}`, `HeroPlate`, `AppShell` or `lib/data/pictures.js`.
- `npm run test:effects` — rebuilds the release page and runs the sound and confetti specs
  (`scripts/migration-tests/effects*.spec.ts`) on Chromium and WebKit. WebKit is installed once with
  `node node_modules/playwright/cli.js install webkit`. The audio spec writes every cue as a WAV to
  `test-results/sound/` for listening, and `test-results/sound/report.<browser>.json` holds the measurements.
  `npm run test:migration` runs `focus.spec.ts` (the heading focus ring) on WebKit as well as Chromium.
- **Three engines (Phase 8).** `npm run test:migration` runs Chromium, **WebKit and Firefox** (Playwright's own builds, on this machine; one-time
  setup `node node_modules/playwright/cli.js install webkit firefox`). Chromium runs every spec. What does not run in WebKit or Firefox, and why, is the
  lists at the top of [migration/playwright.config.ts](../migration/playwright.config.ts) (`CHROMIUM_ONLY_FILES`, `WEBKIT_NOT_RUN`, `FIREFOX_NOT_RUN`,
  `ONLY_IN_CHROMIUM`): nothing is skipped quietly, and a new entry needs its reason. Known and not "fixed": Playwright's WebKit drops the `boundary=` of a
  fulfilled `$batch` (the request-budget specs and the clock specs stay in Chromium), macOS WebKit does not Tab to buttons (`keyboard.spec.ts` presses
  Alt+Tab there), and Safari cannot encode WebP (a photographic hero is refused, in words).
- `npm run test:a11y` — the Phase 8 accessibility specs: `a11y.spec.ts` (axe-core at WCAG 2.1 A and AA on every participant screen and state in four looks,
  the unsupported notice and every admin tab, dialog and view; **Chromium only, and it fails on any violation: there are no silent waivers**),
  `keyboard.spec.ts` (the whole participant flow and PIN → Today → Go live with the keyboard alone, the ring on every stop, no trap, focus on the new
  heading; all three engines), `aria.spec.ts` (`ariaSnapshot` of Welcome, the hub, a question right and wrong, the finale, and what the live region says),
  `reflow.spec.ts` (viewport tag, pinch, 200% text, 320 px), `contrast.spec.ts` (every piece of text and the focus ring measured from pixels, per look),
  `motion.spec.ts` (reduced motion) and `unsupported.spec.ts`. Reports go to `test-results/a11y/`. `@axe-core/playwright` is a dev dependency and in no page
  (`test:bundle` checks every page for it).
- **Motion (Phase 15).** `scripts/test-motion-plan.js` (the plan, the budget, the tokens against the CSS, and the guard: no duration or curve outside them),
  `scripts/test-motion-engine.js` (`lib/motion/motion.ts` on a stand-in page, frame by frame) and `scripts/test-motion-switch.js` (ThemeJson `motion`, the previous
  build reading it, two admins at once on both backends) are in `npm test`. `motion-types.spec.ts` records every shape the page writes and holds each kind of
  question's sides, Back against Next, a tap during an entrance, three quick Nexts, no replay on a re-render, compositor properties only and the end geometry
  against `?motion=off`; `motion-switch.spec.ts` the two switches; `motion.spec.ts` the switch off for a participant. **`motion-perf.spec.ts`** (Chromium, 4x
  CPU) prints a table per entrance, motion on and off: layouts and style recalculations (`Performance.getMetrics`), script ms, long tasks, layout shift, the
  tap's event time, frames (p95, longest run of dropped ones); it holds that motion adds at most one layout, no long task and no shift of its own, and that
  200 presses leave nothing behind. Its style recalculations are inflated by its own frame recorder (any frame callback makes Chromium update running
  animations on the main thread). `PMS_PAGES=<folder>` measures another build. `node scripts/motion-bench.js` is the micro-benchmark of RELEASE-15.md;
  `node scripts/local-site/filmstrip.js` photographs the motion every 50 ms. `?motion=off` on the participant address turns motion off for one device.
- `npm run test:devices` — `devices.spec.ts`: iPhone and iPad in both orientations, iPad Pro, a 1366x768 laptop and a 1440x900 desktop, on every participant
  screen and every admin tab (no sideways scroll, nothing cut off, 44 px on touch, the safe areas on the iPhone: Chromium emulates the insets, the other
  engines show the stylesheets use them) and turning the device over mid-question. `npm run test:perf` — `performance.spec.ts` and `latency.spec.ts`
  (Chromium: 4x CPU and Slow 4G through the DevTools protocol over a real local HTTPS connection, and an 800 ms mocked SharePoint with one 429); the table is
  written to `test-results/perf/perf.json`. `npm run test:unsupported` — the notice's feature test as plain logic (also part of `npm test`).
- Scratch servers get their port from the OS (`scripts/free-port.js`), never from a range: 5432 is inside the old 5200-5599 range and PostgreSQL listens
  there, which was the "fetch failed ... other side closed" that failed a different spec in each full run (Phase 8). The fetch wrapper in `admin-local.ts` no longer
  retries; a failure like that fails the test and is written to `test-results/.stale-socket.log`.
- `npm run analyze:bundle` — [scripts/analyze-bundle.js](../scripts/analyze-bundle.js) builds the three pages into a scratch folder
  (`build-svelte/.analysis`, removed after; `build-svelte/release` is never touched) and prints the top contributors by size for each, from
  a ~20-line Rollup plugin it injects (no dependency). `--label before` also saves `test-results/bundle/before.json`. Group sizes are
  estimates scaled to add up to the page's exact gzip; the page totals are exact.
- `npm run test:bundle` — [scripts/test-bundle-budget.js](../scripts/test-bundle-budget.js) (also part of `npm test`): builds the real pages and holds
  them to the budgets in [scripts/bundle-budget.js](../scripts/bundle-budget.js) (participant gzip ceiling 450,000 B with a 400,000 B target,
  admin 700,000 B since Phase 7c, and prints each page's size and its headroom), checks that no export library (jsPDF, PptxGenJS, html2canvas, Chart.js, `resultsExport.js`,
  the Results charts of Phase 11a) is anywhere in the participant page (by the modules the bundler reports and by text), and has negative controls: the
  check is run against the admin page standing in for the participant page, at one byte over each limit, and against a real participant
  build into which the libraries are imported. Run it after touching `migration/src/main.ts`, `App.svelte`, an import in a participant
  route, `vite*.config.ts`, or a shared module under `migration/src/lib/` that the participant page imports.
- `npm run test:polling` — [scripts/test-polling.js](../scripts/test-polling.js) (also part of `npm test`): every rule of
  `lib/common/poll-schedule.js` as numbers (waits, jitter, backoff, Retry-After, cost scaling, five minutes of ten devices), the admin-address
  helpers, and source checks that the participant page has one timer and one read.
- `npm run test:live` — [scripts/test-live-display.js](../scripts/test-live-display.js) (also part of `npm test`): the Live display's own tally
  and Results' (`readSessionResults`) are held to a tally worked out by hand in the test (five kinds of question, three people), and its feed
  equals `readSessionResponses`, on the mocked SharePoint REST and the local server; the request
  counts of `readParticipantWatch` and `readLiveFeed` (one request where the site can batch, the cost they report where it cannot, a busy
  answer or a 500 thrown after one request, a 400 turning batching off); five minutes of refreshes under 6 a minute.
  The browser side is `live-display.spec.ts` (local server), `live-display-sharepoint.spec.ts` (budgets for the Live display, Results and
  every admin poll, a hidden tab, a 429, the exports on SharePoint), `polling.spec.ts` and `end-session.spec.ts` (the participant page on the
  SharePoint fake with Playwright's clock: five minutes in a moment, requests counted and timed in the page's own clock;
  `polling-support.ts` is their harness) and `live-display-smoke.spec.ts` (Chromium and WebKit). The clock-driven specs run on Chromium
  only: Playwright's WebKit drops the `boundary=` of a fulfilled `$batch` response, so the page there correctly finds batching unusable
  and falls back to plain reads (which `polling.spec.ts` tests on purpose, with a 400 from the batch endpoint). Their numbers are written to
  `test-results/budget/{polling,end-session,live-display-sharepoint}.json`.
- `npm run test:report` — [scripts/test-leader-report.js](../scripts/test-leader-report.js), `scripts/test-leader-report-pdf.js` and
  `scripts/test-participant-names.js` (Phase 7c: Admin → Results, the report, its CSV and its PDF name one session's people alike, on both
  adapters; all three also part
  of `npm test`). The first holds every number of the leader report and of the participant CSV to a session worked out BY HAND in the
  test (the working is in its comments; nothing is compared with itself), and to a session of 60 people and 15 questions counted again by
  a few lines of the test. The second makes the PDF in node with the page's own model, layout and writer and reads it back with pdf.js
  (`scripts/pdf-inspect.js`; `pdfjs-dist` is a dev dependency and is in no page): embedded fonts, accented names, every comment whole, the
  footer and "Page N of M" on every page, no text outside its box or the page (a very long name, a 2,000-character comment, a comment
  longer than a page), a block never split, Cancel, the time for 60 x 15, and the same report from the mocked SharePoint REST and from the
  real local server, with a REAL facilitator restart. It prints what it measured. `npm run test:report:mutations`
  ([scripts/mutate-leader-report.js](../scripts/mutate-leader-report.js)) breaks the counting on purpose, 28 ways, in a copy, and fails if the
  tests do not notice (not part of `npm test`; add a mutation when you add a rule). The browser side is `leader-report.spec.ts` (Chromium
  and WebKit: both downloads, 60 x 15 under ten seconds, progress and Cancel with Playwright's clock); it writes pictures of the pages to
  `test-results/report/` (`light-*.png`, `dark-*.png`, `sixty-*.png`) with [scripts/render-pdf-pages.js](../scripts/render-pdf-pages.js) (pdf.js
  inside Playwright's Chromium, no system tool; also `node scripts/render-pdf-pages.js <file.pdf>`) and its times to
  `test-results/report/browser.json`. Run it after touching `migration/src/lib/exports/` (`leader-report*.js`, `report-fonts.js`),
  `admin/ReportExports.svelte` or `scripts/build-report-fonts.py`, and LOOK at the pictures.
- `npm run build:report-fonts` — `python3 scripts/build-report-fonts.py` (needs `pip install fonttools`): subsets Open Sans Regular and Bold
  for the leader report's PDF into `migration/src/assets/report-fonts/open-sans-report.js` (generated, committed, with the licence text
  beside it). Re-run only when the source TTFs or the ranges change; builds never need Python.
- `npm run oracle -- --seeds 500` — [scripts/oracle-results.js](../scripts/oracle-results.js) (Phase 9a): makes random sessions from seeds, stores them as raw list rows, works every figure out again with rules of its own (it imports no counting code of the app) and compares them with the leader report's model, CSV and PDF text, the Results rows and the Live display tally, on the mocked SharePoint REST and the local server, in four time zones; it prints each difference with its seed. `npm run test:oracle` ([scripts/test-oracle.js](../scripts/test-oracle.js), also part of `npm test`) runs 48 seeds and proves the comparison can fail. Run both after touching a counting rule, `lib/results/results-tally.js`, `lib/admin/admin-results.js`, `lib/results/participant-names.js` or the CSV.
- `node --test scripts/test-review-9a.js` (also part of `npm test`) — the Phase 9a review's other fixes: the wrong-address message, the CSV guard, unsent answers, the expired sign-in, in-place retry, the bounded wait, start-up reads, the tile fallback, Results' "completed"; the browser side is `scripts/migration-tests/review-9a.spec.ts` (the wrong-address message, the sign-in banner and the hub's retry in place, in all three engines) and one test in `flow.spec.ts` (a tile whose picture fails). The findings, what is open and what needs a decision are in `REVIEW-9A.md` (in git history at `7347c72`).
- `PMS_LIST_PREFIX=PMS3 PMS_LABEL="Test, folder 3" npm run build:svelte:release` (any of `PMS_SITE_URL`, `PMS_LIST_PREFIX`, `PMS_LOGO_LIBRARY`, `PMS_BATCH`, `PMS_SUPPORT_NAME`, `PMS_SUPPORT_CONTACT`, `PMS_LABEL`; none is needed) — values built into the three Svelte pages (`scripts/site-override.js`, Phase 9c, reworked in Phase 10b: one constant the bundler defines, no source text is searched and replaced, and each value is held to the rule a page applies to its settings). With none set the pages have nothing built in and find their settings in `pms-config.txt` beside them: see "Rules from Phase 10b"; `npm run build:notices -- <file>` writes `THIRD-PARTY-NOTICES.txt` (`scripts/build-third-party-notices.js`, LIC-1, a proposal for whoever owns licence compliance, an extra file and not part of the three-file build); `npm run test:release-package` runs both tests (also part of `npm test`). A release package is `build-svelte/package/pms-<hash>/`, never committed, made by `npm run package:release` (Phase 10f: see the commands below and "Rules from Phase 10f").
- `npm run test:settings` — [scripts/test-deploy-settings.js](../scripts/test-deploy-settings.js), `test-settings-file.js`, `test-setup-deployment.js` and `test-site-override.js` (Phase 10b; all also part of `npm test`): which site and lists a copy of the app uses, as rows (every source, the order, every rule, each problem; the deciding file and the wording put to the same cases), the reader of `pms-config.txt` on a stand-in for fetch, the data layer's guard, Setup's panel and its read-only list rows, and the `PMS_` build values. Run it after touching `migration/src/lib/settings/`, `lib/setup/setup-deployment.js`, `migration/src/setup/`, an entry (`main.ts`, `admin-main.ts`, `setup-main.ts`), `scripts/site-override.js` or `migration/vite-plugin-built-settings.ts`. The browser side is `settings-file.spec.ts` and `setup-deployment.spec.ts`.
- `npm run test:provision` — Setup prepares a site (Phase 10c-3; all also part of `npm test`): [scripts/test-fake-site.js](../scripts/test-fake-site.js) (the mocked
  SharePoint builds a site, with the traps of ARCHITECTURE-10.md 6.3 (in git history at `7347c72`) behind options), [scripts/test-provision.js](../scripts/test-provision.js) (Show the plan and
  Create, with the request log as proof), `test-provision-prefix.js` (the same on `"listPrefix": "Test"`), [scripts/test-site-ready.js](../scripts/test-site-ready.js)
  (Mark the site as ready), [scripts/test-setup-admins.js](../scripts/test-setup-admins.js) (Add an admin, the import without admins) and
  [scripts/test-text-limits.js](../scripts/test-text-limits.js) (the 255-character limit). Run it after touching `migration/src/lib/{provision,setup-admins,
  setup-import,setup-checks}.js`, `src/setup/`, `SetupApp.svelte`, `sendToSharePoint`, `addAdminUser`, `checkSharePointSchema` or `scripts/sharepoint-fake.js`.
  The browser side is `setup-provision.spec.ts` (the plan, Create, ready, admins and a whole new site, in three engines) and `text-limits.spec.ts`.
- `npm run test:namespace` — [scripts/test-list-namespace.js](../scripts/test-list-namespace.js) (also part of `npm test`): the list prefix and per-list titles in the data layer, on a mocked SharePoint that holds a plain AND a prefixed set of lists and answers both. It also runs nine mocked suites a second time on `Test` lists, a test copy on the same site (`PMS_TEST_LIST_PREFIX=Test node scripts/test-admin-today.js` does one by hand; it was `PMS3` until Phase 10c-2b). Run it after touching anything in `migration/src/lib/data/dataService.js` that builds an address or spells a list title, or `scripts/sharepoint-fake.js`.
- `npm run test:baseline` — [scripts/test-request-baseline.js](../scripts/test-request-baseline.js) (also part of `npm test`): every SharePoint REST request ten mocked suites send, compared with `scripts/request-baseline/*.txt`, which were recorded at `2ad1520` (the local tag `legacy-final`) before the list namespace existed. `node scripts/request-baseline.js` prints the differences. **A difference is a finding: never regenerate a baseline to make it pass** (the writer refuses to overwrite one). A test that is REMOVED, or changed on purpose, is followed with `node scripts/request-baseline.js --amend <suite> --tests '<pattern of test names>'` (Phase 10c-1), run after the test file is edited and BEFORE any code is: it refuses unless the suite as last committed still sends its baseline and every test that was not named sends what it sent, and it prints each entry it changes, old and new. Four baselines were amended that way in Phase 10c-1 (the list is in CLEAN-BREAK-10C1.md, in git history at `7347c72`) and say so in their headers. **A change in the CODE that changes what is sent on purpose** (a read that is no longer made, a filter that lost a term), or in a helper several tests share, is amended with `--code` added (Phase 10c-2a): the "before" is then the last commit's whole tree (an export of `HEAD` in a temporary folder), so it is run with the tests and the code both in the working tree, before they are committed together, and it refuses unless the last commit sends its baseline and every test that was not named sends today what it sent then. `node scripts/request-baseline.js --explain <suite>` only reads: it lists, test by test, what each test sends that it did not send at the last commit. Use it to find the names for `--tests`, and keep what it prints. Every entry amended in Phase 10c-2a (584, part by part and test by test) is in `DROPS-10C2A-BASELINES.md` (in git history at `7347c72`). The browser side is `request-baseline.spec.ts` (the participant page's start-up, per engine).
- `npm run build:sample-pictures` — [scripts/build-sample-pictures.js](../scripts/build-sample-pictures.js) (Phase 10f): makes the sample clients' six pictures
  from VJR's files in the git-ignored `.local/sample-images/` (`<client>-<slot>.jpg`) by driving the BUILT admin page's Brand Studio in Chromium, so the files are
  exactly what Brand Studio stores; it writes them to `migration/src/assets/sample-pictures/` and `public/assets/images/clients/`, and writes
  `migration/src/lib/setup/sample-pictures.js` and `migration/src/setup/sample-picture-data.ts` (both generated). `-- --check` makes them again and says whether they are
  the committed six, byte for byte (they were, in Chromium 156). `npm run test:sample-pictures` runs [scripts/test-sample-pictures.js](../scripts/test-sample-pictures.js)
  (also part of `npm test`, and a recorded suite): the files against their list and the slots' rules, and "Seed sample clients" on the mocked SharePoint REST and the
  real local server. The browser side is `sample-pictures.spec.ts`.
- `npm run package:release` — [scripts/build-release-package.js](../scripts/build-release-package.js) (Phase 10f): the release package for the new site, from a
  clean committed tree, built in a fresh worktree of HEAD (so its pages are what a fresh clone builds), into `build-svelte/package/pms-<commit>/` and a zip beside
  it (git-ignored): the three pages, `pms-config.txt` (`{"configVersion": 1, "listPrefix": "", "label": "PMS"}`), `THIRD-PARTY-NOTICES.txt`, `RELEASE-NOTES.md`,
  `RUNBOOK.md` and `SHA256SUMS.txt`. It stops if a page holds a site address, a folder name, a PIN hash (any 64 hex digits), the demo PIN, `p_cec_` or
  `CreativeExpCOE` (`scripts/release-proofs.js`), and checks the checksums in the folder and in a fresh unzip. The documents are `scripts/release-docs.js`; the
  permissions table is `scripts/permissions.js` (from META's readers and writers; SHAREPOINT-LISTS.md has it too). `scripts/test-release-docs.js` (in `npm test`
  and `npm run test:release-package`) holds them and shows each proof can fail; `npm run test:bundle` holds the three freshly built pages to the same proofs. `npm run test:rehearsal` ([migration/playwright.rehearsal.config.ts](../migration/playwright.rehearsal.config.ts),
  `scripts/rehearsal-tests/`) rehearses RUNBOOK.md steps 3 to 15, and its note for the PCOE site, on the mock (answering as that site did: Phase 10h) with the newest package's pages
  at the new site's folder address (or `PMS_PACKAGE=<folder>`), in Chromium, WebKit and Firefox; it is not part of `npm run test:migration`, which has no package to use.
- **Phase 10h's suites** (all part of `npm test`): [scripts/test-named-reads.js](../scripts/test-named-reads.js) (every item read names its columns: Content, Today, Go live and Results on the
  mock answering as PCOE did, a walk on the strict mock, a source check, the longest addresses, the baselines' translation, Setup's new probe; a recorded suite),
  [scripts/test-duplicates.js](../scripts/test-duplicates.js) (a duplicate refused with 400, 409 or 500 is a duplicate; every path that meets one) and
  [scripts/test-shown-names.js](../scripts/test-shown-names.js) (no text a page shows names a list by a title it no longer has). The browser side is `setup-look.spec.ts` (every button on Setup
  has an edge and 4.5:1, three engines), `a11y.spec.ts` (Setup with its primary buttons on) and `setup.spec.ts`. [scripts/schema-baseline/select-baselines.js](../scripts/schema-baseline/select-baselines.js)
  is how the request baselines followed the `$select` (`--check`, `--order`, `--to <dir>`, `--write`; see "Rules from Phase 10h").
- **Phase 10i's suites** (all part of `npm test`; neither is a recorded suite): [scripts/test-column-names.js](../scripts/test-column-names.js) (the mock refuses a column the site will not
  return by name; Results and the leader report name a member of staff; a named guest gets a code and checks in by QR; Setup's fourth probe) and
  [scripts/test-schema-upgrade.js](../scripts/test-schema-upgrade.js) (the PCOE site of version 2 brought to version 3 by Setup: the plan, Create, Mark ready raising the version, the pages
  after it, a version 4 never lowered). The guard on column names is in `scripts/test-schema.js`. The browser side is `schema-upgrade.spec.ts` (three engines), `schema-version.spec.ts`
  and `setup.spec.ts` (eleven self-test steps). [scripts/schema-baseline/rename-baselines.js](../scripts/schema-baseline/rename-baselines.js) is how the request baselines followed the two
  renamed columns (`--check`, `--order <commit>`, `--to <dir>`, `--write`; see "Rules from Phase 10i").
- **Phase 10j's suite** (part of `npm test`; not a recorded suite): [scripts/test-participant-waits.js](../scripts/test-participant-waits.js) counts the **rounds** the participant waits
  at each moment (page open, a first QR scan, "Click here to begin", the hub, an activity, Next, Submit): every request is held and the waiting ones are let go together, in
  waves, and a moment's rounds are the waves it needs, so nothing is timed. It prints the table before (`c7848e5`) and now and holds the targets, and holds the column check's
  `$select`, the fetch-ahead, the boot's second round, the activities' content held for the page's life and the hub's read. **The participant page never waits on a read for
  something it already holds; `test-participant-waits.js` pins the rounds of each moment, and a change that adds a round must say why.** The request baselines followed by
  [scripts/schema-baseline/fields-baselines.js](../scripts/schema-baseline/fields-baselines.js) (part B: `--order`, `--check`, `--write`) and
  [scripts/schema-baseline/begin-baselines.js](../scripts/schema-baseline/begin-baselines.js) (part C, test by test), by `--amend --code` (part D) and by hand for the browsers'
  start-up (parts C and D); see "Rules from Phase 10j".
- **Phase 11a's suites** (the node ones part of `npm test`, and `npm run test:charts` alone; none is a recorded suite): [scripts/test-results-chart-model.js](../scripts/test-results-chart-model.js)
  (every number a chart shows, worked out by hand from VJR's run), [scripts/test-results-palette.js](../scripts/test-results-palette.js) (reads `styles/results-tokens.css` and holds
  every pair to its contrast) and [scripts/test-results-wall.js](../scripts/test-results-wall.js) (the wall's address). The browser side, in `npm run test:migration`:
  `results-charts-names.spec.ts` (the names, and no name anywhere on the wall, three engines), `results-charts-wall-mutation.spec.ts` (the wall's check can fail: Chromium),
  `results-charts-layout.spec.ts` (alignment and readability at five sizes, three engines), `results-charts-a11y.spec.ts` (axe in every state) and
  `results-charts-greyscale.spec.ts` (Chromium); the fixtures are [scripts/results-charts-fixtures.js](../scripts/results-charts-fixtures.js), pictures go to `test-results/charts/`.
  Phase 11a-2 added [scripts/test-results-chart-fit.js](../scripts/test-results-chart-fit.js) (where a tooltip goes; part of `npm test` and `npm run test:charts`) and
  `results-charts-fit.spec.ts` (nothing scrolls or is cut inside a card, every tooltip whole and clear of its label, the chart fills its card, the spill, cards that keep
  their own height, a refresh that leaves full screen as it was: nine sizes and two scalings, full screen and the wall page, three engines; pictures `test-results/charts/fit-*.png`).
- **Phase 11b's suites** (both part of `npm test` and `npm run test:report`; neither is a recorded suite): [scripts/test-results-export.js](../scripts/test-results-export.js) (the Live
  display's one-page PDF and PowerPoint, written in node with jsPDF and PptxGenJS and read back: the iPads line, every chart's words, no names, the layout's colours and order,
  contrast, nothing outside its box by Helvetica's own widths) and [scripts/test-leader-report-charts.js](../scripts/test-leader-report-charts.js) (the leader report's results on the
  chart model and the palette, worked by hand from Harbour, the last page's sentence, contrast on every page). Their fixtures are
  [scripts/results-export-fixtures.js](../scripts/results-export-fixtures.js); the palette in node is `scripts/results-palette-node.js`; the contrast of a laid-out page is
  `scripts/print-contrast.js`. `npm run test:report:mutations` has 49 mutations since 11b, 15 of them of the drawing and the words (`scripts/mutation-redirect.mjs`).
- **Phase 13's suites** (all part of `npm test` and `npm run test:report`; none is a recorded suite): [scripts/test-export-summary.js](../scripts/test-export-summary.js) (each
  activity's takeaway and scoreboard, and "Only N answers.", worked by hand from Vine, Harbour and Kroger), [scripts/test-leader-report-glance.js](../scripts/test-leader-report-glance.js)
  (the leader report's At a glance and activity pages), [scripts/test-results-pack.js](../scripts/test-results-pack.js) (the Live display's summary pack, both files read back) and
  [scripts/test-results-csv.js](../scripts/test-results-csv.js) (Summary by activity (CSV)). `npm run look:exports [label]` ([scripts/look-exports.js](../scripts/look-exports.js)) writes every
  export for the fixtures to `test-results/exports/<label>/`, each PDF page as a PNG and a greyscale copy. `npm run test:report:mutations` has 64 mutations since Phase 13.
- No linter or formatter is configured: match the existing style by hand. `migration/tsconfig.json` type-checks the TypeScript and Svelte files
  (`npm run check:svelte`); the plain JavaScript modules are not type-checked (`checkJs` is off) and carry JSDoc types instead.
