# The rule book

The detailed rules of this codebase, phase by phase: what each part must keep doing, and why. It was `AGENTS.md` until Phase 14. Start with
[CLAUDE.md](../CLAUDE.md) (the short version, and the commands); the decisions that still bind are listed one line each in [DECISIONS.md](DECISIONS.md),
with where each is enforced; what every gate proves is [TESTING.md](TESTING.md). Read the section of the part you are changing here before you change it.

**How to read it.** Each "Rules from Phase ..." section was written when its phase ended and says "keep them holding": they still bind unless a later
section changed them (the later section says so). Where a sentence and the code disagree, the code and its tests win; tell the owner. Every path,
script, link and list title in this file is held to the repository by `scripts/check-docs.js` (in `npm test`). The phase reports are in
[history/](history/), and [HISTORY.md](HISTORY.md) says what each phase left behind.

**Since Phase 14** the modules are in folders under `migration/src/lib/` ([MODULES.md](MODULES.md)), and the shared modules that were in `public/js`
are there too: the data layer is `migration/src/lib/data/dataService.js`, the schema `migration/src/lib/schema/`, the Live display's files
`migration/src/lib/exports/resultsExport.js`, the brand helpers `migration/src/lib/brand/branding.js` and `assets.js`, and the legacy sheets
`migration/src/styles/legacy/`. A rule below that says "`lib/<name>.js`" means the file of that name in its folder.

**There is one app.** The legacy vanilla app left the branch in Phase 10c-1 and is kept only in the local tag `legacy-final` (not in this copy of the
repository, which has no history before `2a84d29`). The reports of the phases before 10f left with `Design-Docs/` in Phase 10f (VJR's history, also not
in this copy): `ARCHITECTURE-10.md`, `REVIEW-9A.md`, `CLEAN-BREAK-10C1.md`, `DROPS-10C2A.md`, `SCHEMA-10C2B.md`, `PROVISION-10C3.md`, in git history at `7347c72`.
A mention of one here says so.

**What has met the real site.** Steps 1 to 9 of the runbook ran on PCOE (`pms-969bf16`, 14 Oct 2026), and later packages each ran a few steps there:
see the note for the PCOE site in the package's RUNBOOK.md and [HISTORY.md](HISTORY.md). Everything else has run against the local server, the mocked
SharePoint REST and the local PCOE site only.

## Commands

The commands and what each test proves are [TESTING.md](TESTING.md); the short list is in [CLAUDE.md](../CLAUDE.md).

## Server conventions (`server/`)

- `server/data/*.json` are the "database" and are **committed seed data**, not
  gitignored — they're read fresh on every request, so hand edits show up live.
- [server/store.js](../server/store.js) is the only file that touches disk: reads
  tolerate a missing file, writes are per-file queued and atomic (temp file + rename).
  Never read/write `server/data/*.json` directly from route handlers or scripts —
  go through `store.js`. Anything a test makes goes in a scratch copy (`DATA_DIR`), **and uploaded logos in a scratch
  folder too (`UPLOAD_DIR`)**: a test run must leave nothing in `server/data/` or `public/`, and `test-seeds.js` fails if a
  fixture client, guest or uploaded logo is there.
- [server/api.js](../server/api.js) implements generic CRUD per list plus ETag/`If-Match`
  optimistic concurrency (`etagOf`, `checkIfMatch`) — reuse these helpers for any new
  endpoint that needs safe concurrent read-check-write instead of inventing new locking.
- `participantresponses.json` is one item per participant (`id` = their track id). It is a list
  like any other (generic CRUD, unique id), plus `GET /api/participantresponses/page` for a
  session's items a page at a time. On SharePoint the same items are the Responses list. (The one item for each
  session that the legacy pages kept there is not read, written or cleared since Phase 10c-2a, and its
  local file, `responses.json`, is gone with its routes.)
- **Pictures** (`POST /api/uploads/logo`): without `?name=` it is exactly what it always was (a generated `upload-<time>-<id>` name, any
  of PNG, JPEG, GIF, WebP or SVG: the legacy admin used it, no page does now, and a test still makes an older-style upload with it). Brand Studio sends `?name=<slug>-<slot>-<10 hex>.<ext>`, the flat name
  SharePoint's ClientLogos library gets (`ASSET_NAME` in `server/api.js`, the same pattern as `dataService.js` and
  `lib/brand/asset-names.js`; a test says so): a named upload must be a PNG, JPEG or WebP whose extension is what it really is. `DELETE
  /api/uploads/logo/<name>` removes a file of that shape and nothing else (never a seeded logo or an older upload). Files go to
  `UPLOAD_DIR` when set, and a name with a hash is served `immutable`.
- Errors are thrown as `httpError(status, message)` and surface as `{ error }` JSON via
  the global handler in [server/index.js](../server/index.js) — don't `res.status().json()`
  ad hoc inside route bodies.

## The shared modules (the data layer, the schema, the Live display's files, the brand helpers)

Until Phase 14 these were in `public/` (`js/dataService.js`, `pms-schema.js`, `pms-schema-meta.js`, `assets.js`, `branding.js`, `resultsExport.js`;
`css/app.css`, `vfx.css`, `admin.css`). Phase 14 moved them into `migration/src/lib/data/`, `lib/schema/`, `lib/brand/`, `lib/exports/` and
`migration/src/styles/legacy/` with their code unchanged. `public/` now holds only the pictures the local server serves (`public/assets/images/clients/`)
and the brand files (the Open Sans TTFs the font generators read among them).

- **`dataService.js` is the only file allowed to call `fetch()` or know a backend
  exists.** Screens and admin panels import its functions and never see a URL. Add
  new backend needs as functions there, not inline fetches in screens. (One exception, since
  Phase 10b: `migration/src/lib/settings/settings-file.js` reads `pms-config.txt`, which has to happen before the data layer knows
  where to look. A test fails if any other file under `migration/src` fetches.)
- **`dataService.js` no longer "only grows" (Phase 10c-1).** That rule existed because the legacy pages were built
  from the same file; they are gone, and so are the 16 exports that only they, or nothing, called (`requestCount`,
  `getActiveSessionContext`, `setActiveSession`, `saveResponses`, `uploadClientLogo`, `assignActivitiesToClient`,
  `assignUnownedSections` and nine one-line list calls), with the internals only those reached.
  `scripts/test-participant-storage.js` pins the whole export list (104 names since Phase 10j, which added `prepareWrites`; 103 after 10c-3, 102 after 10c-2b, 104 after 10c-2a, 115 when 10c-1 ended): an export cannot appear or disappear
  without that test being edited on purpose. **All of this file is in the participant page**, so whatever is added
  here is paid for there: logic that only the admin or Setup needs goes in a module under `migration/src/lib` that is
  handed the data service (`picturesStillShown` in `lib/admin/admin-content.js` and `clientUsage` in `lib/admin/admin-clients.js` are the pattern). Since Phase 10c-2b every list and column the
  adapter reads or writes comes from the schema file (`migration/src/lib/schema/pms-schema.js`; see "Rules from Phase 10c-2b") and every column must
  exist: there is no optional column any more. Any new function needs both adapters (the local Express one and SharePoint) and a parity test.
- **The seven exports no page called are gone (Phase 10c-2a):** `joinSession`, `claimQrToken`, `saveResponse`,
  `getSessionResponses`, `getSessionResults`, `listVisitorRoster` and `listUserVisitLogs`, the legacy pages' own, and with
  them `setCurrentTrack`, `restartClientTrack`, `getTheme` and `updateTheme` (eleven exports in all). A test fails if a
  page, a shared module, a test or a helper names one of the seven again. A test sets up a visit with `beginVisit`, a
  scan with `(await openQrScan(id)).claim()`, an answer with `saveParticipantResponses`, and holds a result to numbers
  written out in the test or to the oracle: never to a copy of removed code. (`deleteClientTrack`, which no page called, left in
  Phase 10c-2b: a visit is removed with `removeEmptyVisit`.)
- **Section 5 of `dataService.js` (Phase 5) is the admin's:** `readLists([{ list, where }])` answers several list
  reads as ONE `$batch` request on SharePoint (reads only; plain reads where the site cannot batch; plain parallel reads
  locally; an empty `where` array matches nothing and sends nothing), `activateSession(sessionId)` makes an existing
  session live (it sets `ActiveClientId` too; the legacy setter that did not, `setActiveSession`, left in Phase 10c-1), and
  `checkSharePointSchema({ batch: true })` reads every list's columns in one request. No new SharePoint column.
- **Section 6 of `dataService.js` (Phase 5b) is Content's and Guests':** all of it is built from the generic list calls both
  adapters implement, so the local Express adapter and SharePoint take the same path, and `scripts/test-admin-content.js` runs each
  on both and compares the records. `runPaced(items, worker, { concurrency: 3, gapMs })` is the one way bulk writes are done
  (3 in flight, 120 ms between one lane's writes on SharePoint, a failure recorded not thrown, stop after 3 in a row; the
  adapter already waits out a 429 or 503 for as long as `Retry-After` asks). `readActivityContent(sections)` reads the questions
  and options of activities in one `$batch` (20 ids to a read). `planCopy()` is the whole of what a copy is, with no request: the
  Content screen shows it and `copyActivities()` then does exactly that: new ids (`<source id>~<client id>`, so copying twice meets
  the first copy; `ids: 'random'` and `retitle` make a duplicate), the target's `ClientId`, **not live**, appended after the
  client's last activity in the order given, and a layout, a picture or a description only when it has a value (a list without
  that column is never asked to hold one). An activity is written options, then questions, then its own record, so it appears whole
  or not at all; a failed write deletes what that activity had written, and a re-run skips what is whole and writes the rest (a
  record whose id is taken is written over). An activity is skipped when the client has one with that title, or one copied from it
  before (it may have been renamed). `deleteActivity` (the activity record first, so participants stop
  seeing it at once; recorded answers are never touched) and `addSectionsToLiveSession` (results are counted over
  `session.sectionIds`, which Go live fills: an activity made, copied or assigned while its client is live joins the live session
  here, and a delete leaves it) keep Results honest. `addGuests` and `provisionGuestCodes` check the session once (live, not ended,
  guests scan a personal QR) where `provisionQrToken` checks per guest, and make a code only for an enabled guest with no code that
  has not expired: pressing it twice, or after a failure, makes only what is missing. `guestNameKey` is the roster's comparison
  (`lib/admin/admin-content.js` `guestKey` must agree; a test says so). No new SharePoint column.
- **Section 7 of `dataService.js` (Phase 6) is the pictures':** `uploadClientAsset(blob, name)` stores a finished PNG, JPEG or WebP under
  its flat content-hashed name (`<slug>-<slot>-<hash>.<ext>`) and resolves `{ url, name }`; `removeClientAsset(url)` removes one of ours,
  best effort, and never throws. On SharePoint the file goes to the ClientLogos library (`Files/add(..., overwrite=true)`, safe to
  repeat because the same name is the same bytes; the library folder is asked for once per page, beside the write token; SVG is refused
  here as well as in the screen) and a removal is `recycle()`, into the recycle bin, and only for a file in that folder whose name is
  ours; locally it is the existing upload endpoint with `?name=`. The legacy `uploadClientLogo()` left in Phase 10c-1; the `uploads` route is untouched.
  No SharePoint column. Both adapters, with a parity test (`scripts/test-brand-storage.js`).
- **Section 8 of `dataService.js` (Phase 7) is what a page that stays open reads on a timer:** `readParticipantWatch({ sessionId, trackId,
  clientId })` (AppSettings, the session, the page's own track and, for the hub, the client's activities) and `readLiveFeed(sessionId,
  { sectionIds })` (the session, its tracks, every participant's answers, merged by the same `combineAnswers` that `readSessionResponses`
  uses, and the session's activities). Each is ONE `$batch` request on SharePoint (plain reads side by side locally), each returns
  `requests`, what it really cost, so a caller on a site that cannot batch can wait longer. **A busy answer (429, 503, 504) and any failure
  that is not "this site cannot batch" (no connection, a timeout, a 500) is thrown after one request, with `retryAfter` in
  milliseconds when SharePoint gave one: never retried here, never turned into plain reads** (the timer backs off; `spReadTogether`, which
  everything else uses, still falls back). A 400 or an unusable batch response turns batching off for the page, as it always did.
  (`readSessionResponses` only had its merge moved into `combineAnswers`.) No SharePoint column.
- **The admin's PIN check is `migration/src/lib/admin/admin-pin.js`** (`login(pin)`; `lib/admin/sha256.js` is its fallback where
  `crypto.subtle` is missing). It moved there from the legacy admin folder in Phase 10c-1 with its code unchanged: the
  same hash, the same comparison, the same answers. It is a mock local PIN: do not add real secrets to
  `adminusers.json`. How a PIN is hashed, stored and compared is left as it is (ARCHITECTURE-10.md, decision 10, in git history at `7347c72`).
- The legacy screens, admin panels, `app.js`, `kiosk.js`, `sfx.js` and `vfx.js` are gone, and so are their conventions
  (`render(container, context)`, `mount(container, ctx)`, `loadTemplate`). Sounds and confetti go through
  `migration/src/lib/effects/effects.ts`; `branding.js` is still how the Live display and the exports read a client's colours.

## Svelte app conventions (`migration/`)

The Svelte app is the app. The participant page still loads `migration/src/styles/legacy/app.css` and `vfx.css` (the legacy app's sheets, until Phase 10c-1); restyle by overriding
in `migration/src/`, not by editing them, so that what the tests measure stays where it is.

- **Product name**: user-visible text uses `APP_NAME` (`migration/src/lib/common/app-name.ts`); the
  HTML shells use `%APP_NAME%`. Internal identifiers keep their `cec` spelling (`cec.sound`,
  `CEC_SHAREPOINT`, `p_cec_01/02`, file names, package name, storage keys).
- **Colour and type**: use the custom properties in `src/styles/tokens.css`, never raw hex in a
  component. The defaults are the mockup palette and must equal `deriveTheme('#045BCC')`
  (tested). A client palette comes from `deriveTheme(primary, accent?)` and `applyTheme()` in
  `src/lib/brand/theme.js`, which keep white text at 4.5:1 or better. Body and option text is 16px or
  more; sizes use `clamp()`.
- **The accent never drives a control.** Every control fill (`CONTROL_TOKENS`: the CTA, Next, Home,
  Retry, pills, tiles) comes from the client's PRIMARY; `resolveClientTheme` works them out again
  on every load and ignores whatever a stored theme says for them. An accent colours only
  `--accent-rule` (`Divider`) and `--accent-ring` (`HeroPlate`), and each only where it has 3:1
  against what it is drawn on (the whole gradient; the white plate). A red accent on a button reads
  as the fixed red of a wrong answer: `scripts/test-theme.js` and `scripts/test-seeds.js` fail if
  an accent reaches a control, if any seeded client's control fill is within 30 degrees of the
  danger hue, or if another component reads the accent tokens.
- **Components** (`src/components/`): `AppShell`, `PillButton`, `HomeButton`, `OptionPill`,
  `ActivityPill`, `LogoTile`, `Divider`, `ProgressBar`, `DeloitteWordmark`, and (Phase 2) `ActionBar`,
  `CheckBadge`, `HeroPlate`, `SoundToggle`. Tap targets are at
  least 44px, focus is the green ring from `base.css`, and correct/wrong always carry an icon
  and a word. A heading that a screen focuses by script (a new screen, the next question) goes
  through `focusHeading()` in `lib/common/focus.ts` and nowhere else: it draws nothing for a pointer or
  touch user and the ring for a keyboard user, by one rule in `base.css` (never a component's own
  `:focus` rule; `:focus-visible` alone gets this wrong before the first input of a page load). Svelte scopes component CSS but cannot stop a *global* rule matching the markup,
  so avoid generic class names (`.option` and `.divider` already exist globally);
  `scripts/test-foundation.js` fails on a collision.
- **Participant flow** (`src/routes/`, `src/pager/`): Welcome, then the Activities hub (`#/agenda`),
  then the pager (`#/quiz/<id>`, one question per screen; its completion screen is part of the same
  route), then the finale (`#/thank-you`). `#/feedback/<id>` only redirects into the pager. The rules
  (graded Retry and reveal, validation, resume, first-try score, the sequential lock, the greeting)
  live in `lib/participant/pager-logic.js`, which has no DOM and is unit-tested by `scripts/test-pager.js`; the
  screens only render what it says. Route copy is user-visible text, so check it against the mockup
  (`Design-Docs/references/Operate_Experience_Prototype_Mockup.pdf`, in git history at `7347c72`) before changing it.
- **Saving answers goes through `lib/participant/participantData.ts` and nowhere else.** A screen calls
  `recordAnswer(sectionId, ...)` as each answer is given (a graded question at its FIRST pick, so a
  reload cannot hand out a fresh first try) and `flushActivity(sectionId)` once, on the activity's
  last step. The mechanics are `lib/participant/answer-store.js` (no DOM, unit-tested), which only
  `participantData.ts` imports:
  - **One Responses item per participant** (AppId = track id). The first save creates it; every
    later save is ONE request, a blind overwrite of the whole answer list (no read, no `If-Match`
    version), because only that participant's device writes the item. A create that meets an
    existing item (unique AppId) reads it, merges and updates instead.
  - **Next never waits.** `recordAnswer` returns at once and saves in the background: one request
    in flight per device, and answers given meanwhile ride on the next. Completion
    (`flushActivity`) is the one thing that waits for the saves. A failed save is retried with
    backoff and waits at least as long as a `Retry-After` asks; after 3 tries `flushActivity`
    throws `SaveFailedError`, nothing is lost, and the screen offers Retry.
  - **A first answer is never rewritten** (`mergeAnswerRecords`, and the store itself). `correct`
    means the first try was right. A record with `correct === false` and fewer than
    `MAX_WRONG_TRIES` attempts is an open question (`isRecordSettled`), not an answered one.
  - **One read restores a visit.** The boot sequence reads the participant's own item once (indexed
    `TrackId`) and hands it to `restoreAnswers`; no screen reads answers again. Unsaved answers
    alone are mirrored to sessionStorage (`cec-answers:<track>`), so a reload can finish saving them.
  - **A written answer is 1000 characters at most** (`MAX_TEXT_LENGTH`), validated in the pager,
    capped by the store and refused by the adapter, so the whole record fits one SharePoint text
    column; the adapter refuses a record over 60,000 characters rather than cutting it.
  - **A facilitator restart** removes the answers from the participant's item
    (`restartParticipantTrack`), and the device, on seeing it, drops them and rewrites its item
    (`applyRestart`), so a save that was already on its way cannot bring them back.
  - The finale has no "Start over" (a saved record is the participant's for the day); testers get it
    with `?debug=1`. The admin preview has no visit, so it cannot write.
- **The participant page is small, and has no results code (Phase 7).** `index.html` is about 155 KB gzip (153.5 KB when Phase 7c ended; Phase 8 added 1,882 B: the unsupported-browser notice, about 900 B, and the
  accessibility fixes, within a 2,048 B allowance that `test:bundle` holds) against a 400 KB target and a 450 KB
  ceiling (`scripts/test-bundle-budget.js` fails above the ceiling). It must not import `resultsExport.js`, Chart.js, jsPDF, PptxGenJS,
  html2canvas or the Results charts (`admin/charts/`, `lib/results/results-chart-model.js`); all of them are the admin page's (Chart.js is in no page since
  Phase 11a; the admin page is about 550 KB gzip against a 700 KB budget: see "Leader report" below). The leader report, its fonts and its buttons are on that list too. The old `#/master-results/<sessionId>` address is `routes/ResultsMoved.svelte`: a notice, no boot, no request, and a link to
  `admin.html#live-display/<sessionId>` built by `lib/common/admin-address.js` from the address it was opened at (the same folder, wherever it is
  hosted; nothing of the participant's own address is carried over). `migration/src/lib/exports/resultsExport.js` was shared with the legacy app and is kept as
  it was. (`resultsRenderer.js`, the Chart.js renderer of the Live display, left in Phase 11a: the charts are drawn by hand, see "Rules from Phase 11a".)
- **Polling (Phase 7): one timer, one request, the budgets in `lib/common/poll-schedule.js`.** An open participant page looks at what the
  facilitator did through `lib/common/page-watch.ts` (`createPageWatcher`, one `setTimeout` rescheduled after every look, never an interval) and
  `App.svelte`'s `checkServer()`, which makes ONE `readParticipantWatch` read. **While waiting (Welcome, the hub, the finale, "not live yet")
  it looks every 20 s (3 a minute; the budget is 4), with ±20% jitter on every wait; with a question or an activity's completion screen on
  screen it looks every 60 s; a hidden tab sends nothing and, shown again, looks once at once (not within 5 s of the last look);
  the network coming back looks at once.** A look that cost more than one request (a site that cannot batch) makes the next wait that many
  times longer, so the rate holds. A failure doubles the wait up to 5 minutes; a 429 or 503's `Retry-After` is a floor. The local server
  is looked at every 3 s, flat, with no jitter. A change of screen kind (`modeOf(router.location)`) calls `replan()`: leaving a question
  looks within 5 s if a wait has passed. **The hub has no timer of its own:** since Phase 10j it is drawn at once from what the page holds
  (`getKnownProgress`, no read), reads its activities and the enabled ones' questions and options once behind that, on arriving
  (`experience.refreshActivities`: one request where the site can batch), and then redraws from `experience.activitiesVersion`, which the
  page watcher raises (`adoptWatch`) when the activities or the session's flow changed. The facilitator's screens: Today every 10 s (one request), Content and Guests every 15 s, the Live
  display every 12 s (one request, and the structure every 5 minutes: 3 requests), Results every 15 s for the live session only (the
  local server: everything every 2.5 s). Admin polls use the same watcher with `adminDelay`, no jitter. A new timer needs a number in
  the polling table (MIGRATION-PLAN.md, "Phase 7").
- **End session reaches an open participant page (Phase 7).** The look also reads the session, and `Sessions.Status === 'completed'` sets
  `experience.ended` (`adoptWatch`; the field is the one `endSession()` has always written, nothing was added; AppSettings does not change on
  End, which is why the session is read). **While `experience.ended`, Welcome and the hub (`showsEndedNotice`: `/`, `/welcome`, `/agenda`)
  show `NotLive` as "This session has ended. Thank you. Your answers are saved." in place of themselves.** An activity under way (any
  `/quiz/<id>`, its completion screen included) is finished first and its answers still save; the finale is left as it is. Reopen clears
  the flag and the hub comes back with its progress. A page that boots on an ended session shows the same words (`reason:
  'session-ended'`), keeps looking at `experience.watchSessionId`, and starts again by itself when the session is reopened.
  The cost is one more read in the batch the page already sent and no more requests.
- **Today's client decides everything a participant sees.** `lib/participant/boot.js` (no DOM; only `App.svelte`
  imports it) reads AppSettings (and who is signed in), then the Client, Session and Sections(ClientId) side by side with, on the plain
  link, the session's Tracks (Phase 10j): **two rounds and 6 requests to the first screen on the staff link, 8 at most**, measured
  in `scripts/test-participant-waits.js`, `scripts/test-participant-storage.js` and, in a real browser, in
  `scripts/migration-tests/sharepoint.spec.ts`. (Since Phase 10b a page on SharePoint asks for one thing before them: its settings
  file, a small static file in its own folder. **8 list requests plus 1 file**; no file on the local server.) The visit log, the resume stamp and (for a resumed
  staff visit) "who is signed in" are sent only after that screen is drawn. Keep to this: a new
  read at boot must come out of that budget. `lib/participant/experience.svelte.ts` holds the result for the
  screens. With no active client, an archived one, or an ended session, every participant route
  shows `routes/NotLive.svelte`; the page checks AppSettings on its timer and turns live by itself.
  **Nothing is cached between page loads**: browser storage holds only unsaved answers, this tab's
  visit-log keys and the sound choice, and a test fails if that grows.
- **A first QR scan is inside the same budget: 8 requests, 9 for a session's first device.** The
  page calls `openQrScan(tokenId)` (dataService, section 4), (`claimQrToken()`, the
  legacy pages' way in 14 requests, left in Phase 10c-2a). The rounds: the code and AppSettings
  beside the write token; ONE `$batch` request for Session, Client, Sections, the visitor (or the
  signed-in user, for a staff code) and the Tracks item type; the new Track beside the read of every
  enabled activity's questions and options (Phase 10j: held, not waited for); then `claim()`. Rules that must keep holding:
  - **Single use is one write**: a MERGE of the code with `If-Match` on the version it was read at.
    Never `*`, never inside a batch. `$batch` carries reads only, and every batched read falls back
    to a plain GET (a failed part alone; a refused batch altogether, once per page load, or never
    asked with `"batch": false` in the folder's `pms-config.txt`, or `PMS_BATCH=false` on the build): it may cost requests, never a
    failed page.
  - The checks, their order, the seven codes and their words are written out in the storage suite
    ("openQrScan refuses with these codes and these words"), which holds them on both adapters, from the scan and from `claim()`.
  - A device that loses removes the track it wrote. A device that cannot learn whether its claim
    landed asks the code whose it is; if that fails too it throws the connection error and keeps
    the track in memory (`unfinishedScan`, never stored), so "Try again" carries on with it.
  - Each "device" in a race test is its own module instance (`freshPage()` in
    `scripts/test-participant-storage.js`): one module is one page, and holds one write token.
- **The theme is the client's stored one** (`Clients.ThemeJson`: `{ version, primary, accent, tokens,
  assets, copy }`), resolved by `lib/brand/client-theme.js` and applied with `applyTheme` before any client
  colour is painted: `index.html` starts with `data-theme-pending`, under which the shell shows only
  `--bg-top`. Stored tokens pass `applyTheme`'s own checks or are derived again from the stored
  `primary`/`accent`; a client with no stored theme wears the default look. `ThemeVersion` is read on
  every boot, and tokens stored for another version are not trusted. The hub's title and subtitle,
  the Welcome line and the logo-plate text come from `theme.copy`; an activity's subtitle from
  `Sections.Description`; the layout from `Questions.Layout` (`questionLayout` falls back to a list,
  or tiles when every answer has a picture); a tile's picture from `Options.ImageUrl`, with the
  answer as text when there is none; the hub's lock from `Sessions.ActivityFlow`.
- **Never draw or imitate a client's logo.** A client with no logo file shows its name in type on
  the plate (`HeroPlate` `text`, from `theme.copy.logoText`).
- **Results are read through `readSessionResponsesChecked`** (via `lib/admin/adminData.ts` and `lib/results/session-results.js`: since Phase 9b the tolerant form of
  `readSessionResponses`, which reads each participant's own item and names an item it cannot read instead of
  stopping). The Live display's timer reads the same records through
  `readLiveFeed` with `tolerant` (same merge, a parity test); Results and the CSV, PDF and PowerPoint exports call `getSessionResults` from `adminData.ts`, which is
  `readSessionResults` (`lib/results/session-results.js`, built on `buildResults`; `scripts/test-live-display.js` holds it and the Live display's tally to a tally worked out by
  hand, and the oracle holds both to rules of its own). **Nothing reads, writes or clears a session's own item in Responses** (`AppId` = the session's id, no `TrackId`:
  the legacy pages' storage). Since Phase 10c-2a an item with no `TrackId` is nobody's: not read, not counted, not reported.
- **Pictures on the participant page never hold it up** (`HeroPlate.svelte`, `AppShell.svelte`). Welcome shows the hero badge as it is
  (no plate), else the logo on the plate (white, or dark: `ThemeJson.plate`), else the name in type, else initials. The square the hero
  fills is reserved at once; the hero is `decoding="async"` with `fetchpriority="high"` and fades in on load; if it fails or has not
  arrived after 1.5 s the next choice is shown (and the badge takes over if it comes later). The background is an `<img>` that fades in
  after it loads (`object-position` is the focal point); until then, and always if it fails, the gradient is all there is. Alt text
  comes from the client's name; the background is decorative. **The scrim is computed, not chosen** (`lib/brand/scrim.js`): the least flat
  opacity at which white words (on the page, on a translucent pill, and `--text-soft`) keep 4.5:1 over a pure white picture, rounded
  up to a whole percent (63%; the 60-78% gradient the shell had before did not hold under a pill). A test samples the pixels. In an
  effect, key an image's state on a `$derived` of its address, not on the prop: a rebuilt parent object re-runs an effect that reads
  the prop, and an image that is already showing would be put back to "loading".
- **Sample clients** (Kroger, Domino's) are `lib/setup/sample-clients.js`; `lib/setup/seed.js` creates what is
  missing and never changes an existing record, except to fill a field that is empty and did not
  exist before Phase 4 (`FILLABLE`). `server/data` holds the same pack (`scripts/test-seeds.js`
  keeps them in step), and the Setup page's "Seed sample clients" runs the same code on SharePoint.
  Change sample content in `sample-clients.js` and then in `server/data` to match. Each carries `theme.sample` (see "Rules from Phase 9b"). Since Phase 10f each has a
  logo, a hero and a background: VJR's pictures, the logos the clients' real ones, as files (see "Rules from Phase 10f"); `samplePack()` alone has none, which is what
  the tests build their sites from, and `server/data` holds `localSamplePack()` (`lib/setup/sample-seed.js`).
- **Sounds and confetti go through `lib/effects/effects.ts` and nowhere else.** Screens announce what happened with
  `answerFeedback({ correct, firstTry, revealed, anchor })`, `pick()`, `activityComplete()` and `finale()`; the
  switch uses `setSound(on)`, `soundState()` and `onSoundChange()`; Welcome's begin tap calls `unlockAudio()`;
  Phase 5 wires a per-session default through `setSoundDefault(on)`. A screen never names a cue, a note or a
  burst. Which moment makes which effect is `lib/effects/effect-plan.js`; the sounds are DATA in `lib/effects/sound-cues.js`
  (notes, waveform, envelope, a `gain` trim); `lib/effects/sound-engine.ts` turns them into Web Audio and
  `lib/effects/confetti.ts` drives canvas-confetti; the plan and palette are `lib/effects/confetti-plan.js`. Only `effects.ts`
  imports those, and `scripts/test-effects.js` fails if any other file under `migration/src` uses
  `AudioContext`, an audio element or `canvas-confetti` (it also still refuses an import of the legacy `sfx.js`/`vfx.js`, which no longer exist).
  - **Rules that must keep holding.** Sound is off until the person turns it on (key `pms.sound` in
    localStorage). The one shared `AudioContext` is created or resumed only inside a tap (the switch, the
    Welcome begin tap, or the next tap while sound is on) and never at page load; `suspended` and Safari's
    `interrupted` states are resumed on the next tap and when the page becomes visible. Turning sound on plays
    the chime at once and asks for the `playback` audio session (`navigator.audioSession`, iOS 17+) so the
    ringer switch on silent does not mute it; off puts it back to `auto`. The same cue within 80 ms is
    ignored and at most 3 cues sound at once. Next, Back and Home make no sound. Where Web Audio is missing or
    throws, the app works silently and the switch is disabled with "Sound isn't available in this browser".
  - **Confetti** is one fixed, full-viewport canvas with `pointer-events: none` and `aria-hidden`, removed when
    the burst ends, drawn by canvas-confetti (ISC, no Web Worker) loaded by a dynamic `import()`. Small
    (first-try correct only) is about 40 pieces, medium (activity complete) about 120 from both lower corners,
    large (finale) about 250 in three bursts; all scale by 0.6 below 500 px wide. The palette is Deloitte green,
    white, `--success` and light tints of `--action` and the client primary, and never red. Under
    `prefers-reduced-motion` there is no overlay at all (the cue still plays). No confetti on a wrong answer, a
    right answer after a Retry, or a reveal.
  - **Changing a cue.** Edit its notes in `sound-cues.js`, then run `npm run test:effects` and read the table it
    prints: peak must stay at or below -5 dBFS (the brief asks -6; the finale sits near -7), duration within the
    brief, and A-weighted level within 2 dB of the other cues. Adjust that cue's `gain` from the report. The
    tests measure level, length, pitch order, clicks and brightness; they cannot say whether it sounds good, so
    listen to the WAVs and then on a real iPad (`QA-TESTING.md`, "Sound and confetti on a real iPad").
  - **Auditioning.** `#/styleguide` (dev server only) has a "Sound and confetti" section with a button per cue and
    per confetti size. Those buttons use `auditionCue` / `auditionConfetti` from `effects.ts`, which release
    builds drop (`foundation.spec.ts` checks the section is absent).
- **Admin shell** (`AdminApp.svelte`): five tabs in this order, **Today, Clients, Content, Guests and QR, Results**
  (`#today`, `#clients`... keep the tab through a reload, after the PIN; the old `#sections` lands on Content; `#print-guests` is the
  QR sheet, a view of the page and not a tab; `#live-display` and `#live-display/<sessionId>` are the Live display, a view of Results; the
  page follows a `hashchange` too, so an address pasted into an open tab works). The page imports `styles/tokens.css`, `styles/fonts-admin.css`
  (Open Sans 400, 600 and 700 only: all six faces would add 62 KB gzip, three add 31) and `styles/admin-tokens.css` (the light
  surfaces and status tints, every text pair held to 4.5:1 by `scripts/test-admin-today.js`) over
  `migration/src/styles/legacy/admin.css`, which was the legacy admin's sheet and is left as it is; `src/admin.css` overrides it. The bar is navy because the
  Deloitte wordmark is white. Targets are 44px, focus is the green ring with a navy halo, no page scrolls sideways at 390 wide.
- **Today** (`admin/AdminToday.svelte`, logic in `lib/admin/admin-today.js`, no DOM, unit-tested): the status panel, the
  picker (active clients; the date starts as today in the browser's local time), Go live, readiness, controls on the live session
  (identification mode, activity flow, End session, Reopen), the participant link and its QR, and "All sessions" (any session
  whose id is not `<slug>-<date>`, made live through `activateSession`). Rules that must keep holding:
  - **Request budgets on SharePoint**: the load is 4 requests (the write token, then one `$batch` of AppSettings, Clients,
    Sessions and Sections, one of every list's columns, and one of the picked client's questions and options with the live
    session's tracks); a poll every 10 s is ONE `$batch` of AppSettings, the live session and its tracks, and two when something
    else became live; a hidden tab sends nothing. Changing the picker costs one request. A new read on Today must come out of these.
  - **Go live is `activateClient(clientId, date)` and one read of AppSettings** (`goLive()`), shown as "Verified: participants
    now see <client>" only if that read names the session and the client. A second call from the same page for the same client and
    date gets the first one's answer; two admins end with one session because the id is `<slug>-<date>` and `AppId` is unique.
    Every action bumps an epoch, and a poll that began before it is dropped, so a slow read can never put back what was just changed.
  - **The confirmation** (`switchDialog()`) appears only when a different session is live with participants, reads the count
    from a fresh poll, and says only what the participant page does: it looks every 20 s while waiting (within about 25 s with the jitter) and every 60 s with a
    question on screen (about a minute and a half), and when a hidden page returns, `followFacilitator` drops the visit and lands on
    Welcome, saved answers stay in the old session, which is not ended, and `activateClient` retires its unscanned codes.
    `scripts/test-admin-today.js` reads `poll-schedule.js`, `page-watch.ts` and `App.svelte`, so changing the participant page's behaviour fails
    the test until the words are changed too.
  - **Readiness** (`evaluateReadiness()`): blockers are an archived client, no live activity, a question with no answer
    options (open text has none by design; a poll with no answer marked right is never one, Phase 12), a session for that date
    that has ended (Reopen beside it), and a SharePoint list or column that is missing or mis-typed; warnings are no logo or
    hero image, guest mode with no guests, one live activity, a live activity with no questions, another client's session the
    same date, a date that is not today, a missing index, and a schema check that could not run. Go live is disabled while any
    blocker exists.
- **Clients** (`admin/AdminClients.svelte`, rules in `lib/admin/admin-clients.js`): a slug is `a-z0-9` words joined by single hyphens, at
  most 40, unique among all clients (archived too; a client with no stored slug uses the one its name makes, as `sessionIdFor`
  does), and locked once any session of the client exists. A new client's id is `c-<slug>`, so two admins adding one slug together
  cannot both succeed. A new client gets `deriveTheme('#045BCC')`; an edit keeps the stored palette, accent and pictures and takes
  the new words, through `reviseClientTheme()` (a stored accent is read in `client-theme.js` only), and sets `ThemeVersion` and
  `theme.version` to the old version plus one. A live client cannot be archived (asked of the server at the click); an archived one
  is hidden from Today and cannot go live. Delete protection (now also by activities) and the check-in QR for iPads are kept; the QR
  needs the client to be live. Delete reads what uses the client through `clientUsage()` (`lib/admin/admin-clients.js`: AppSettings and the client's sessions by `ClientId` in
  one request, then those sessions' visits and codes by `SessionId`, 15 sessions to a read, in one more; the answers of those sessions only; never a whole list), and
  the check-in dialog lists the newest six codes of the session the code joins (`recentCodes()`, one read by `SessionId`). **Colours, the logo, hero art and the background are Brand Studio's** (next bullet): the form has the
  name, slug and words only, and each row has a **Brand** button. A new client's older colour fields come from the default palette
  (`legacyColours`).
- **Brand Studio** (`admin/BrandStudio.svelte`, opened from a client's row on Clients; rules in `lib/brand/brand-studio.js`, `lib/brand/legacy-colours.js`,
  `lib/asset-*.js`, `lib/brand/crop-math.js`, `lib/brand/image-sniff.js`, `lib/brand/brand-devices.js`, `lib/brand/brand-sample.js`, `lib/brand/scrim.js`, all plain JS
  with unit tests; `lib/brand/asset-image.ts` is the only part that needs a canvas). Rules that must keep holding:
  - **The stored shape** is `ThemeJson { version, primary, accent, plate?, tokens, assets: { hero, logo, background, backgroundFocus?, tile },
    copy }`. `plate` is written only as `'dark'` (absent is the light plate) and `backgroundFocus` ({ x, y } percentages) only with a
    background, so a theme that uses neither is stored exactly as before; `assets.tile` stays reserved and unused. `deriveTheme(primary,
    accent, { plate })` re-derives the tokens at save time; the plate only decides whether the accent ring is drawn (3:1 against the
    plate). Fixed colours (correct, incorrect, the wordmark) are not in the draft at all.
  - **Save order** (`save()`): read the client (someone else saved meanwhile: a confirmation, then "Save mine anyway"), upload each
    newly chosen picture (a picture that fails stops the save before anything changes), write the client once (theme at version + 1,
    `ThemeVersion`, the older `PrimaryColor`/`SecondaryColor` from the theme, and `LogoUrl` if the logo changed), and only then remove the
    pictures it replaced, and only ones whose name is this client's own (`isOwnUpload`). If the write fails, the files just uploaded are
    removed again. **A picture is not uploaded when it is chosen**, so Revert and an abandoned edit leave no file behind and an old file
    is never removed before its replacement is in use. A copy of colours from another client never copies pictures (a file belongs to one
    client). The older logo (`Clients.LogoUrl`, for a client that never had one here) shows as the logo and is not copied into the theme.
  - **Colours**: primary (hex, picker, presets), optional accent, plate. The report (`brandReport`) lists the contrast of every pairing, shows
    "adjusted for readability" with before and after and an Auto-fix that puts the adjusted colour in the field, and warns (never blocks)
    about an accent or a primary within 30 degrees of the wrong-answer red, a very light or dark primary, an accent that fails 3:1 where
    it is used, and a logo whose drawn pixels are mostly very light on the light plate (or very dark on the dark one).
  - **Pictures** (`AssetUploader.svelte`, `CropDialog.svelte`): PNG, JPEG and WebP only, decided by the file's bytes (`inspectFile`), with a
    10 MB input cap; SVG, GIF, animated PNG/WebP, a truncated file and a non-picture are each refused in words. Slots (`lib/brand/asset-specs.js`):
    hero 1200x1200 (300 KB), logo 800x400 (150 KB), background 1536x2048 (350 KB, with a focal point), tile 480x320 (60 KB). A picture
    enlarged more than twice is refused, more than 1x warned. The crop dialog moves and zooms inside a frame locked to the slot's shape
    (pointer, wheel, slider, arrow keys with `+` `-` Home End); the output is drawn at exactly the slot's size, EXIF orientation applied by
    the decoder and everything but pixels dropped by the canvas. `compressToCap` tries WebP first (a browser that answers with a PNG,
    as Safari does, is noticed and not asked again), then PNG, then steps the size down to 75% of the width at the lowest, then
    says what to do. **Safari cannot encode WebP**, so a photographic hero or logo that is over its cap as a PNG is refused there with that
    explanation; flat artwork fits.
  - **The preview** (`BrandPreview.svelte`) is the real participant screens, drawn from the unsaved draft in a same-origin frame of exactly
    the device's size (390x844, 820x1180, 1180x820, 1440x900; scaled down to fit), because the participant page sizes itself from the
    viewport and a shadow root would use the admin window's. The screens are the real `Welcome`, `Agenda`, `ThankYou` and
    `ActivityPager`, each given a `preview` (or `demo`) prop that makes it draw from what it is handed, read nothing, write nothing,
    skip effects and titles, and do nothing when pressed (the root is `inert`). Tailwind's preflight (in a layer, as on the participant
    page), `tokens.css`, `base.css` and Open Sans go into the frame; the three faces the admin page does not use are loaded when Brand
    Studio opens. **The frame is not sandboxed**: WebKit refuses to run the page's own event handlers on elements inside a sandboxed frame
    (the heroes never became "ready"); the only code in it is this page's, on content it built.
  - **After a save, open participant pages keep the old look until reloaded.** A page reads its client and theme when it loads or when
    AppSettings says something else is live (`keyOf`: session, client, activation time); a save changes none of those. `OPEN_PAGES_NOTE`
    says so, and `scripts/test-brand.js` reads `App.svelte` and `experience.svelte.ts` to fail if that stops being true (going live again
    would also send everyone back to Welcome, so Brand Studio does not suggest it).
  - **Unsaved changes**: leaving by tab, Back or Lock asks first (`lib/admin/unsaved.ts`: in memory, no storage), and `beforeunload` covers
    closing and reloading.
  - **The Live display and the exports** read the stored theme when there is one (`masterColours`, through `lib/admin/master-brand.ts`) and the older
    fields otherwise; `legacy-colours.js` is separate from `brand-studio.js`.
  - **`?preview=<clientId>`** (`routes/PreviewRoot.svelte`): that client's Welcome, activities and read-only questions, in its saved look,
    whether or not it is live, marked "Preview", reading the client and its activities and nothing else (no AppSettings, no visit, no
    track, no storage). Brand Studio shows the address, with Copy, Open and a QR code. **It marks no right answer** (Phase 9b, SEC-1: it has no PIN):
    only the PIN-gated Content preview passes `showKey`.
- **Content** (`admin/AdminContent.svelte` with `ContentQuestions`, `ActivityFormDialog`, `CopyActivitiesDialog`;
  rules in `lib/admin/admin-content.js`, no DOM) is the old Activities and Content tabs in one, scoped by a client switcher that opens on
  the live client (a client picked this visit is kept while the live client has not changed). Rules that must keep holding:
  - **Everything on the left is `Sections.ClientId` and `Sections.Order`** (the order field existed; reorder is ▲ ▼ and renumbers
    1, 2, 3... writing only what moved). An activity with no client is shown to nobody and listed nowhere (Phase 10c-2a: the
    Unassigned group, both assign buttons and Setup's assign step are gone; every activity is made for a client). A title is unique within a
    client (copying skips by title).
  - **Request budget on SharePoint**: 4 requests from the PIN (AdminUsers, the write token, one `$batch` of AppSettings, Clients and
    Sections, one of the selected activity's questions and options); selecting an activity or a client is 1; the live switches are one
    read of the activities every 15 s while the tab is shown (none hidden, none while something is being changed). A new read must
    come out of these.
  - **Delete warns with a count**: `answersToQuestions()` (`adminData.ts`) counts recorded answers through `readSessionResponses`,
    over the activity's client's sessions and any session that lists the activity. The confirmation is `window.confirm` (the
    browser tests answer it).
  - **Layout and pictures** (`ContentQuestions.svelte`): Layout applies to single, multiple and true/false; `image-grid` shows an
    address field and a preview on each option, and an option with none is a text tile (the participant pager does that). An address
    is http(s) or a path on this site, at most 255 characters (`imageUrlProblem`). `layout` and `imageUrl` are written only when set
    or to clear a stored one. **Upload** is the same `AssetUploader` (compact) beside the address field with the `tile` spec (480x320,
    3:2, 60 KB): the picture is uploaded when it is chosen (the address field is the draft), stored as `<client slug>-tile-<hash>`,
    and the files this editing session replaced or abandoned are removed after Save or Cancel (`tidy()`); a pasted address is still allowed and is
    never touched. Before it removes a file, `tidy()` asks `picturesStillShown()` (`lib/admin/admin-content.js`) which of them another answer still shows (a duplicate, or a
    copy for another client, shows the same file): the activities and then their answers by question, two requests on SharePoint however many pictures, and never a
    filter on `ImageUrl`, a column with no index. When that cannot be told, no file is removed.
  - **Preview** (`ActivityPreview.svelte`) takes the activity's client and puts its resolved theme on the preview frame
    (custom properties inherit into the shadow root); a client with no stored theme gets the standard look. It reads its callbacks before
    its first `await`: the dialog can close before a write returns, and a prop that reads the screen's selection throws once it is gone.
    `ContentQuestions` likewise keeps the activity id it was opened with (`untrack`), because `section` there follows the selection and
    would send the tail of a slow save to whatever was clicked next.
  - **Dialogs** are real `<dialog>`s opened with `showModal()`; each gives focus back to what opened it, because Svelte removes
    the element and the browser cannot.
- **Guests and QR** (`admin/AdminGuests.svelte`, `PrintSheet.svelte`; data in `adminData.ts` `loadGuestState` and
  `refreshGuestState`) works on the LIVE session only (`provisionQrToken` and `provisionGuestCodes` refuse any other). Load is 4
  requests on SharePoint; a refresh every 15 s is 1, and 2 or more once a guest has joined (the answers are read to tell Joined
  from Completed). Status is real data: **No code** (no code that has not expired), **Not scanned**, **Joined** (a track exists, or
  the code was used), **Completed** (a settled answer to every question of every live activity: `completedTrackIds`), **Disabled**.
  Paste names: lines and commas separate names, names are cut to 60 letters, repeats and roster names are skipped, and the preview
  says so before anything is saved. The QR address is `qrUrl(token, participantPageUrl())` (the same base as Today's link, the LAN
  address on localhost); `data-qr-url` on each card is what the picture encodes, and a test regenerates the QR from it. **The print
  sheet is a view of the admin page** (hash `#print-guests`, so it survives a reload and works from iPad Safari's Share, Print):
  cards are 61 mm square, 3 by 4, 4 mm apart, 12 to a `.print-page` that has `break-after: page`, which fits inside the 8 mm margins
  of both A4 and US Letter; a card is `break-inside: avoid`. Keep those numbers together if one changes. **Results**
  (`admin/AdminResults.svelte`) is the old Sessions panel without End/Reopen, which are on Today. On SharePoint it reads every session in
  full when it opens, on Refresh and after a restart (5 requests a session since Phase 9b), and keeps only the LIVE session fresh, with the
  Live display's one-request feed every 15 s (`data-session` on each card is the test hook). The local server refreshes everything every 2.5 s.
  **A person's name on this screen is `lib/results/participant-names.js`, the one rule the leader report (PDF and CSV) names people by (Phase 7c):**
  the name on the guest's QR code (the track's `participantName`), else the visit log's name for that visit, else the roster's, else the
  account's sign-in name, else "Unnamed participant N" (never the client's name), and a repeated name as "Name (2)". It used to say
  "Client · Visit 1". The rows are `lib/admin/admin-results.js` `resultRows()` (plain JS; `scripts/test-participant-names.js` holds them equal to the
  report on both adapters). The visit log and the roster are not on a track, so the screen reads them (`readNameSources()`: two lists in ONE
  `$batch`, for up to 20 sessions) only for a session with a track that has no name of its own: **+1 request when Results opens or is
  refreshed, none for a session of guests with QR names**, and, on the live session's timer, one more look for someone who joined in the last two
  minutes and is still unnamed (their sign-in is written a moment after their first screen), twice at most for each person
  (`rowsToLookForAgain`). Status, "joined ... via ...", the QR counts and Restart are as they were.
- **Live display** (`admin/LiveDisplay.svelte`, the charts in `admin/charts/` since Phase 11a; loading in `lib/admin/live-session.js`, the tally in `lib/results/results-tally.js`,
  both plain JS) is what the participant page's Master screen was, in the admin page: a chart for each question of the session's
  enabled activities, the answer count and the iPad count, the client's colours in its header (`masterColours`, set on the display's own element and
  not on the admin page; since Phase 11a the charts themselves are in Deloitte's colours), **Full screen**, and the CSV, PDF and PowerPoint exports (`adminData.getSessionResults`, which is `readSessionResults`, so `readSessionResponsesChecked`;
  PDF and PowerPoint are loaded by `import()` when first used). Reached from Today's **Live display** button, from each Results card, by
  `#live-display[/<sessionId>]` (no id: the live session, or a picker when none is), and from the old participant address.
  - **Request budget on SharePoint**: opening is 3 requests for the structure (the session; the activities with the client; the
    questions and options) and 1 for the first feed; then ONE request every 12 s (`readLive`: the session, its tracks, every answer,
    its activities) and 3 more every 5 minutes (the structure again), 5.6 a minute in all (budget 6); none while the tab is hidden, one
    when it is shown; a 429 or 503 waits at least `Retry-After`. A change in the activities (one switched off, a question added) is found
    in the feed and re-reads the structure; an edit to a question's words waits for the 5-minute read or Refresh. The tally is
    `lib/results/results-tally.js`, which Results' `readSessionResults` is built on too (`scripts/test-live-display.js` holds both to a tally worked out by hand, on both adapters).
  - **Full screen** covers the window (`position: fixed`, the admin bar and tabs `inert`) and **shows ONE question at a time, sized so the whole
    card is on the screen (Phase 7c)**: a projector has no scroll wheel and the pointer is hidden, and before 7c the 1920x1080 display scrolled
    (the first card's axis labels ran past the bottom). Nothing scrolls now: the card (`ResultCard` `fit`, Phase 11a) takes the height between the
    heading and the controls, the chart takes what the prompt and the count leave and never less than it needs (so a card too tall overflows where the fit can see it),
    and written answers show the comments that fit with "N more written answers are not shown". The type still scales
    with the window (1.2 to 2.4 times, cards and chart text: `--chart-scale`); for a question that cannot fit even so (a very long prompt) it is
    made smaller a step at a time, down to 0.75 (the chart's own text is never drawn below 1), until the card is whole. **Previous and Next and
    the left and right arrow keys** (no modifier) move through the questions and go round at either end; **Auto-advance** (a switch, off by
    default and off again each time full screen is entered) moves to the next every 15 seconds and goes round, starts a fresh 15 seconds after a
    move by hand, and waits while the tab is hidden. None of it reads anything: **the request budget is unchanged** (a test with the clock holds
    six moves to no request, and the SharePoint specs hold the 12-second refresh). The way out and the controls fade together after 3 idle seconds
    (a control reached by the keyboard stays) and the room they take is kept, so the card never moves. The browser's own Fullscreen API is used
    where it is offered and is not needed (the cover alone works, and is all iPad Safari does for an element); Escape, the button, or the
    browser ending its full screen leaves it. Outside full screen the display is as it was: every question's card, in a grid.
  - A session that no longer exists says so with Try again; a logo that cannot load leaves no empty chip.
- **Leader report and participant CSV (Phase 7b)** (`admin/ReportExports.svelte`: two buttons, **Leader report (PDF)** and **Participant
  answers (CSV)**, under each session card's heading on Results, so for today's session or any past one; the Live display and its
  three exports are as they were). Five plain-JS files with no DOM: `lib/exports/leader-report-data.js` reads, with calls the admin already
  had (the session; one `$batch` of its activities, client, tracks, visit log and roster; the questions and options beside
  `readSessionResponses`: **4 requests on SharePoint, 5 when an answer points outside the session's activities**; nothing was added to
  `dataService.js`); `lib/exports/leader-report.js` counts and makes the CSV; `lib/exports/leader-report-layout.js` places everything on A4 pages as
  rectangles, lines and single lines of text, in millimetres; `lib/exports/leader-report-pdf.js` draws them with jsPDF; `lib/exports/report-fonts.js`
  unpacks the fonts and measures text. The report is made on demand in the page and stored nowhere. Rules that must keep holding:
  - **The counting rules are `COUNTING_RULES` in `leader-report.js`, printed in the report's "About this report" box, which since Phase 7c is the
    last section, "How the numbers are counted"; each has a test and a mutation.** Participants are every visit (track) in the order it joined,
    a repeated name as "Name (2)". The naming rule is `lib/results/participant-names.js` (shared with Admin → Results; the mutation script patches it
    there). A name is what was recorded
    (the guest's QR name on the track, else the roster's, else the sign-in name UserVisitLogs holds for that visit or that account), or
    "Unnamed participant N": never the client's name, never an id, and a guest's visit never takes the iPad account's name. Scores use
    `firstAnswer` only: right first time over the graded questions the person ANSWERED, with "7 of 15 answered" beside it; the average is
    over the people with at least one graded answer. Right or wrong is judged by the option marked correct NOW (an answer whose option
    was removed falls back to what was recorded then, and a key that was changed afterwards is said under the question). Finished = a
    final answer to every question of every activity that is switched on (`isRecordSettled`, the rule behind Guests' "Completed"). A
    restart removed the earlier answers from storage (`restartParticipantTrack`), so only what came after it exists; the person's block
    says when. An activity that is switched off but holds answers is shown, marked, and not needed to finish; one with none is left out.
    Answers to a question in none of the session's activities go under "Questions no longer in the activity" and into no score or total
    (a deleted question's choice is only an id, and an id is never printed). Hardest and easiest compare switched-on activities only; a tie
    goes to the question with more answers, then the earlier one.
  - **How each kind of answer is stored** is written at the top of `leader-report.js` (single-select and true-false: option ids, graded
    when an option is correct; multi-select: an array; confidence: an option whose `value` is its place on the scale; ranking: every
    option id, best first; open text: the words).
  - **Fonts.** A PDF embeds TrueType, and nothing in a browser turns the page's own WOFF2 back into it, so the report carries Open Sans
    Regular and Bold of its own (`scripts/build-report-fonts.py`: Basic Latin, Latin-1 Supplement, Latin Extended-A, common punctuation
    and U+FFFD; no hinting, kerning or layout tables; the two faces deflated as ONE stream and written as base64, 26.1 kB of the gzipped
    page, inflated with `DecompressionStream` only when a report is made). jsPDF subsets them again into each file. A character the faces
    lack (an emoji, another script) is printed as ONE U+FFFD, the notes on the last page then say so, and the CSV keeps it. The layout measures text from
    the same bytes (`readFace`; a test holds it equal to jsPDF's own widths), which is what lets a node test check every line against its box.
  - **Drawn, not rendered.** Rectangles, lines, text, the client's logo as a picture, and two things that are paths: the tick and cross
    beside an answer, and the Deloitte wordmark, whose shapes are read from the mounted `DeloitteWordmark` component (the white letters
    drawn black for a white page, the dot green). Never `doc.html()`, `addSvgAsImage` or html2canvas (the admin build stubs them; a test
    fails), and never a file from `public/assets/Logos`. The client's colour is an accent only (the title band, the completion bars, rules; since Phase 11b a question's bars are the Results palette's, see "Rules from Phase 11b"):
    `printColours()` darkens it until it has 3:1 on white and puts white or near-black words on it at 4.5:1. Right and wrong are a mark
    and words, never colour alone, so the page prints in greyscale. A logo drawn for the dark plate keeps a dark plate; a client with no
    logo has its name in type and nothing drawn in a logo's place.
  - **The order of the pages (Phase 7c): the answer comes first.** Page 1 is the client's logo and the Deloitte wordmark, the title band, then
    **Summary**: the three tiles, completion by activity, and the hardest and easiest question; then one line, "Made on ... from the answers
    saved for this session. How the numbers are counted is on the last page." If the hardest and easiest (with that line, which is never alone
    on a page) do not fit page 1, they are the top of page 2; the tiles and completion stay on page 1. Then Results by activity, What
    participants said, Participants, Questions no longer in the activity (only when there are any), and last **How the numbers are counted**:
    the "About this report" box with the "Session: ..." line (which says whether the session had ended), every counting rule exactly as
    worded, and the notes (restarts, a switched-off activity, answers with no participant, a character the font lacks). Do not move the
    summary back below the rules: a leader reads the answer first.
  - **Layout.** Rows flow down the page; a block stays whole when it fits a page and otherwise breaks between rows. A comment is one row
    a line, so it carries on overleaf and is never cut: `fit()`, which ends a line with an ellipsis, is for headings and labels and never
    for a comment or an answer. A person's block is not split unless it is longer than a page. Every page has "Confidential – internal",
    the client's name and "Page N of M". The page is A4 (`PAGE` in the layout file).
  - **Progress and Cancel.** The writer says which page it is about to draw (`onProgress`), draws it, and waits on a timer before the
    next, so the line "Preparing page 12 of 40" is painted and Cancel is heard; `signal` stops it and nothing is saved. 60 people and 15
    questions is 38 pages in about 0.3 s in a browser (0.12 s in node).
  - **The CSV** is UTF-8 with a byte-order mark and CRLF line ends: one row for each participant and question (an unanswered one has no
    answer and 0 attempts, so someone who answered nothing is still in the file), then the answers to questions no longer in an activity.
    A cell that starts with `=`, `+`, `-` or `@` (or a tab or carriage return) gets an apostrophe. "Answered at" is the local time of the
    browser that made the file, as `YYYY-MM-DD HH:MM:SS`.
  - **The admin page's budget is 700,000 B (Phase 7c; it was 600,000 B).** It is 600,863 B gzip, raw 1,660,507 (554,299 B before Phase 7b: the two faces are
    26.1 kB and the report's code about 18 kB). Phase 7b left it 1,114 B under 600,000 B, which is inside the noise of measuring gzip (the same
    file is about 599.6 kB with the system gzip and about 601.6 kB with another machine's zlib, so the budget could fail on a teammate's
    machine with no code change); it is a facilitator's page that loads once a session, the participant page (about 153.5 kB against its
    400 kB target) is the one that matters, and Phase 8 needs room for accessibility fixes. Nothing was dropped to make the room: PowerPoint,
    both faces and the jsPDF stubs are as they were, and size is measured as it always was. `npm run test:bundle` prints each page's size and
    its headroom. Past 700,000 B, make room first (MIGRATION-PLAN.md, "Phase 7b", has what each way is worth); do not raise it again to fit.
  - **Tailwind reads every file under `migration/` for class names, comments included.** The words `table`, `absolute` and `invisible`
    in the new files each added a utility rule to BOTH pages (22 bytes on the participant page) until they were reworded. After adding
    a file there, check that the participant page is still the size it was (`npm run test:bundle` prints it).
- **Brand Studio's preview** is a frame, not a shadow root (see Brand Studio above); the Content activity preview below is unchanged.
- **Admin preview** mounts the same pager (`routes/Quiz.svelte` with `preview`) inside a shadow root,
  where the page's stylesheets do not reach, so component CSS is injected (`compilerOptions.css:
  'injected'` in `migration/svelte.config.js`) and `ActivityPreview.svelte` supplies the tokens (the client's own, see Content).
  The preview must stay read-only: no `recordAnswer`, no `flushActivity`, no navigation.
- **Unsupported browsers (Phase 8).** All three pages carry a plain notice, "This page needs a recent browser. Please open it in the latest Safari, Chrome, Edge or
  Firefox.", with the app name and the Deloitte wordmark as text. It is `src/unsupported/page.html` and `support-check.js` (a classic ES5 script: it must run
  in a browser too old for the app), put in by `vite-plugin-unsupported.ts` at `%UNSUPPORTED_PAGE%` in each HTML shell. It is shown (1) by `<script nomodule>`
  in a browser with no module scripts, (2) by the feature test (`AbortSignal.timeout`, `structuredClone`, `Array.at`, `<dialog>`, `CSS.registerProperty`, `color-mix()`:
  the newest things the app really uses, each of which implies the older ones in every engine, not a version number), after which `lib/settings/support.ts`, the FIRST
  import of every entry, throws so that nothing of the app runs over it, (3) by any script `error` before `mounted()` is called after `mount()` (a module
  that cannot be parsed, or that throws at the top), and (4) by a `<noscript>` rule. It is shown with `style.display`, never the `hidden` attribute (Tailwind's
  layered `[hidden]{display:none!important}` beats an unlayered rule), its heading is `role="heading"` and not an `<h1>` (a page-wide `h1` selector in a
  test would find it first), and **it may add at most 2,048 B gzip to the participant page** (`PHASE_8` in `scripts/bundle-budget.js`; it added 1,064 B). Keep
  words like `hidden` and `table` out of files under `migration/` (Tailwind reads them).
- **Accessibility rules that must keep holding (Phase 8).**
  - **The focus ring is a band of dark on each side of the green** (`base.css`, `admin.css`): `outline: 3px solid var(--focus); outline-offset: 3px;
    box-shadow: 0 0 0 3px <dark>, 0 0 0 9px <dark>`. The old 2px halo with a 1px gap left the ring touching the page (2.8:1 on the lighter part of a client's
    gradient, 2.3:1 on the admin's white). `contrast.spec.ts` measures it (3:1 on both sides; it is about 9:1 now). Do not put a gap back.
  - **Every change of screen moves focus to the new heading** through `focusHeading()`: Welcome, the hub, each question, the completion screen, the finale,
    "not live", and in the admin the screen after Unlock (the first panel heading) and the PIN screen after Lock. A wrong PIN puts focus back in the field.
  - **No `aria-describedby` may name an element that is not there** (the error line of a field exists only after a failed submit: set the attribute then).
  - **A `<select>` in the admin is drawn by us** (`appearance: none`, a chevron, 44 px): WebKit draws it natively at 27 px whatever `min-height` says.
  - **Text must reflow** (`reflow.spec.ts`): the answer pill's verdict and the activity pill's dot or lock go under the words when the line is short, the
    participant header wraps (greeting and sound switch on a second row) instead of cutting the greeting, the admin bar and PIN card count their own padding.
    A 200% text size at 390 and 820 px and 320 px at 100% are the tested sizes (320 px at 200% is stricter than WCAG asks and only has to not overflow).
  - **A sticky bar must not cover the focused control**: the admin tab row is sticky, so `html { scroll-padding-top: 5.5rem }`; it scrolls sideways, so its padding
    is the ring's room.
  - **A device turned over keeps what was in view** (`lib/participant/keep-in-view.ts`, used by the pager): if the chosen answer (or what has focus) was on the screen it
    is put back after the resize.
  - **A spoken answer does not end in two full stops** (`gradedAnnouncement`).
  - A contrast swatch in Brand Studio is a picture (a bar of the words' colour on the background colour), never text in a failing pair.
- **Styleguide**: `#/styleguide` exists only under `npm run dev:svelte` (it is behind
  `import.meta.env.DEV` and absent from builds; a test checks). Add each new component and
  state there.
- **Fonts**: `styles/fonts-participant-extra.css` is the three faces (Light, ExtraBold, ExtraBold Italic) that the admin page does not
  use, imported only by Brand Studio's preview frame (the admin page's own three stay as they are). Open Sans is inlined from `src/assets/fonts/*.woff2`. Regenerate with
  `python3 scripts/build-fonts.py` (needs `pip install fonttools brotli`) only when the source
  TTFs or glyph ranges change.
- **Kiosk lock-down** (no pinch zoom, long-press menu, text selection) comes from
  `src/lib/common/kiosk.ts` and applies only in an installed web app or with `?kiosk=1`. (The legacy pages' always-on
  script left in Phase 10c-1; a test fails if it comes back.)
- **Line endings**: the working tree may be CRLF (Windows checkout) while git stores LF. When
  inspecting or staging, use `git -c core.autocrlf=input diff` / `add`, or every line looks changed.

## Rules from the Phase 9a review (keep them holding)

- **"Click here to begin" is `beginVisit(visitId, ...)`, never `joinSession()`** (the legacy pages' own, removed in Phase 10c-2a): the id comes from `lib/participant/visit-id.js`
  (kept for that session until the visit is known to have begun, then forgotten), so a press whose reply was lost finds the visit it made and a later
  "Start a new visit" is a new one; the write that moves the session to in-progress is tried, not required. A test fails if anything
  names `joinSession` again.
- **The device that gets a QR code removes the tracks an earlier, cut-off try of that code left** (`openQrScan`: the `earlier` read rides in the scan's one
  batch and is never required). A scan is still 8 requests (9 for a session's first device); 14 where the site cannot batch, 13 with `batch: false`.
- **An answer to a question that is not graded goes through `ungradedRecord()`** (`lib/participant/pager-logic.js`): a wrong first try whose question then lost its
  answer key is settled by it, instead of staying open for ever.
- **Every look that reaches the server resumes saving** (`resumePendingSaves()` in `App.svelte`'s `checkServer`): the answer store has no timer of its own.
- **An expired sign-in is not a lost connection** (`lib/participant/sign-in.js`): `participant.signedOut` shows its own banner with Reload; a failed load says why in
  words (`loadFailure()` in `participantData.ts`) and "Try again" retries in place, never `location.reload()`. The hub still must not import `dataService`.
- **A page never falls back to the local server because of where it was opened** (FH-3; replaced in Phase 10b). Phase 9a's fix was a message ("This page
  is not set up for ..."); the cause is gone now: a page is not built for one address. `lib/settings/address-check.js` is only `isLocalAddress()` (plain http, or this
  computer, is the local server; every other https address is SharePoint), and a SharePoint page that cannot tell which lists are its own stops before either
  app is mounted (`lib/settings/start.ts`). `scripts/test-review-9a.js` and `review-9a.spec.ts` hold that.
- **Ranking points are counted among the options a question has now.** The Svelte admin reads results through `adminData.getSessionResults`, which since Phase 9b
  is `readSessionResults` (`lib/results/session-results.js`: `buildResults`, which scores among the options that exist; `rescoreRanked` is gone);
  (`dataService.getSessionResults`, the legacy pages' own, left in Phase 10c-2a.)
- **Results' "completed" is a final answer to every question** (`isRecordSettled`), as the participant's hub, Guests and the report have it.
- **A CSV cell cannot start a formula**: at its start after white space, and after a `;` or a tab inside it (`csvCell` in `leader-report.js` and
  `admin-content.js`; `migration/src/lib/exports/resultsExport.js` was the legacy app's too and has only the first-character guard).
- **A tile picture is removed only when no other answer shows it** (`ContentQuestions.tidy` asks `picturesStillShown()` first: see Content), and a tile whose picture fails shows
  its answer in words (`LogoTile`: done on the elements, because that component has a prop called `state` and so cannot hold a `$state` rune).
- **A `Retry-After` is obeyed for 15 minutes at most** (`POLL.maxRetryAfterMs`).
- **The participant page may grow by 2,048 B gzip over where Phase 8 left it** (`PHASE_9A` in `scripts/bundle-budget.js`; it is 156,606 B, +1,212). All of
  `dataService.js` is in that page, so every byte added to it counts there.
- **A `\uXXXX` escape typed into a tool call arrives as the character itself**, in a heredoc as well as in a written file: build such characters with
  `String.fromCharCode` (JS) or `chr()` (a Python patch file), and check new files for invisible characters.
- The leader report's mutation list has 30 entries (`npm run test:report:mutations`).

## Rules from Phase 9b (the decided fixes; keep them holding)

- `npm run test:9b` runs `scripts/test-review-9b.js` (also part of `npm test`): the source guards and plain rules of this phase. The browser side is
  `scripts/migration-tests/review-9b.spec.ts` (damaged items, Remove a visit, sample content) and `review-9b-setup.spec.ts` (Check Lists, by eye).
  Everything of this phase ran against the local server and the mocked SharePoint REST; none of it has met the real tenant or an iPad.
- **A damaged answer item never stops a session's results (DI-6).** The Svelte admin reads answers through `dataService.readSessionResponsesChecked` and
  `readLiveFeed(..., { tolerant: true })`, which return `unreadable: [{ id, reason }]` and leave that item out; `lib/results/unreadable.js` words it
  (`unreadableNotice`), once, for Results, the Live display and the leader report (`records.unreadable` -> `report.unreadable`, `meta.unreadableNotice`, bold on the cover).
  `readSessionResponses` and the participant's own reads still throw as they did; the participant's own item says `code: 'responses-unreadable'`
  in words. The oracle (`scripts/oracle-results.js`) damages items at random and compares the lists and the counts with its own rules. Somebody whose answers
  could not be read is not counted as "answered nothing" (the cover tile) and has no Restart.
- **Removing a visit (DI-9) is `dataService.removeEmptyVisit` and nothing else** (never `deleteClientTrack`, which also unlinks the QR code): it re-reads the visit's own
  item, refuses on an answer, an ended session or an unreadable item, deletes the Tracks item and then an empty Responses item, and never touches a
  QR code or the roster. A participant page that holds a removed visit says `visitGoneNotice` (`lib/participant/visit-notice.js`): staff start again, a guest asks the facilitator.
- **Answers are never marked at `?preview=` (SEC-1).** `showKey` is off by default in `ActivityPager`, `QuestionOptions` and `Quiz`; `ActivityPreview.svelte` alone turns it on
  (`scripts/test-review-9b.js` reads the source for it). Brand Studio's device preview draws `lib/brand/brand-sample.js`, never the client's answers.
- **Staff mode says its rule (DI-1):** `STAFF_MODE_WARNING` in `lib/admin/admin-today.js`, beside "How people are identified" and as the readiness row `staff-signin`
  (a warning: it never blocks Go live). `boot.js` and how a staff device finds its earlier visit are unchanged.
- **Sample content (SAM-1, SAM-2).** `lib/brand/retired-logos.js`: the drawn Kroger address counts as no logo wherever a logo is read (`withoutRetiredLogo` in `client-theme.js`,
  `brand-studio.js`, `admin-today.js`, `master-brand.ts`, `LiveDisplay`, `AdminClients`); the file itself left with the legacy app in Phase 10c-1, and so did the three modules
  that inlined pictures from `public/assets/images` into the pages (`test:bundle` fails if the stand-in is in a built page, and a test fails if a module globs `public/assets` again). `lib/admin/sample-notice.js`: a client is a sample
  when `theme.sample` exists or its id and `createdAt` are the seeds' (`SAMPLE_ORIGINS`); `Mark as confirmed` (`adminData.confirmSampleClient`) writes `theme.sample.confirmedBy`
  and `confirmedAt` into `Clients.ThemeJson` after re-reading the client (no new column, no version bump), and **`buildClientTheme` carries `sample` over, so every writer that
  rebuilds a theme must pass it** (`reviseClientTheme` and Brand Studio's `changesForSave` do). The leader report's cover says "Sample content, not yet confirmed with the client." until then.
- **Check Lists (DEP-1), since Phase 10c-2b strict.** Phase 9b listed apart, "Please check by eye", what the strict check did not compare; since schema v2
  Setup's check (`schemaSpecs` in `lib/setup/setup-checks.js`, from `pms-schema-meta.js`, handed to `checkSharePointSchema({ specs })`) compares every column's type,
  index, uniqueness, required and date format, and there is nothing left to check by eye (see "Rules from Phase 10c-2b").
- **No request address grows with the content (G).** Everything that reads many ids does it in groups of 20 (`lib/data/read-groups.js`, `readActivityContent`, `getSectionQuestions`
  for more than 20 questions, `readLiveFeed`'s activities): at most 1,500 characters at 15 or 60 questions of four options without its `$select`, and 1,700 with it (Phase 10h), on both adapters
  (`scripts/test-live-display.js`). (The legacy `dataService.getSessionResults`, which still made the long address, left in Phase 10c-2a.) A new read by SESSION id is 15 to a read (`clientUsage`): a
  session id is up to 51 characters, longer than the ids 20 was sized for. Setup's Run self-test adds two read-only probes
  (`PROBE_YESNO`, `PROBE_LENGTH` in `lib/setup/setup-checks.js`, run through `probeSharePointRead`); they only report and are not run on the local server. Since Phase 10c-2a
  nothing depends on what the Yes/No probe finds: the app does not filter on a Yes/No column.
- **The participant page may grow by 1,500 B gzip over where Phase 9a left it** (`PHASE_9B` in `scripts/bundle-budget.js`; 156,606 B before). Since the page carries all of
  `dataService.js`, anything only the Setup page needs lives in a Setup-only module (`lib/setup/setup-checks.js`) and `dataService.js` keeps a small primitive.

## Rules from Phase 10b (deployment settings and the list namespace; keep them holding)

Everything of this phase ran against the local server and a mocked SharePoint REST that holds two sets of lists. None of it has met the real tenant or a
real device: whether a document library serves the settings file to a page, what it answers for a missing one, and whether `web/GetList` behaves as the
mock does are QA-TESTING.md items 88 to 96 (the first of these was answered on the real site on 14 Oct 2026: it would not serve the file as `pms-config.json`,
which is why the file has been `pms-config.txt` since Phase 10g; see "Rules from Phase 10g"). The failure this phase exists to prevent is silent: a page that
reads another copy's lists and works.

- **One set of built pages goes anywhere.** A Svelte page finds its settings as it starts (`lib/settings/start.ts`, the SECOND import of every entry, straight after
  the browser check): on an `https` address that is not this computer it reads `pms-config.txt` from its own folder (`lib/settings/settings-file.js`: once per
  load, `cache: 'no-store'`, 8 seconds, never kept in browser storage), resolves (`lib/settings/deploy-settings.js`), calls `configure({ sharePoint })` and only then
  mounts. For each setting the file wins, then the values built into the page (`PMS_` variables), then, for the site alone, the page's own address. There is
  no default list prefix. `public/config.js` was the legacy pages' and left with them in Phase 10c-1 (a test fails if a Svelte file imports it or reads its globals).
- **A missing file is an answer; a failed read is not.** HTTP 404 means "no file" and the built-in values are next. No connection, a time-out, any other
  status, a web page in the file's place and text that is not JSON all STOP the page (`PMS-CFG-002`): never fall through on an error, that is how a page ends
  up on the wrong lists. A key that is not a setting is refused by name, and so are two lists that would end under one title.
- **Three files, on purpose.** `lib/settings/deploy-settings.js` is in every page and only DECIDES (each rule answers yes or no; a problem is a code and a place:
  `{ id: 'PMS-CFG-002', kind: 'invalid', at: 'lists.qrtokens' }`). `lib/settings/deploy-problems.js` (the four problems in six parts each, kept together for
  Phase 10d) and `lib/settings/deploy-rules.js` (which rule was broken, in words; the build checks `PMS_` values with it) are loaded by **Setup alone**: the
  participant page could not carry the wording inside its allowance. `scripts/test-deploy-settings.js` puts every case to both and fails where they
  disagree or name different places; add a rule to both, with a row.
- **The stop screen** of the participant and admin pages is a few plain elements made by `lib/settings/start.ts` ("This page cannot start", the code, **Try again**,
  which reloads), in the page's own colours and its own button class (`.button` on the participant page, `.btn` on the admin's: the older stylesheet the
  participant page loads, `migration/src/styles/legacy/app.css`, gives `.btn` a focus ring that is not the green one). Setup opens anyway, says the problem in full, and switches every action off.
- **`dataService.requireConfiguration()`** (opt-in; the three Svelte entries call it before anything else): until `configure()` is called, anything that
  would send a request, and `isSharePointMode()`, throws `PMS-CFG-003` and sends nothing. A test that configures the service itself never calls it. A new module that asks for data
  as it is imported will meet it in the tests, which is the point.
- **A list's title comes from one function.** In `dataService.js`, `spTitle(list)` is `settings.lists?.[key] ?? (settings.listPrefix ?? '') + <usual title>`;
  every address (`spListPath`) and every message uses it, and the picture library defaults to `<prefix>PMSClientImages` (`spLibraryIn`; `<prefix>ClientLogos` until Phase 10c-2b). Never spell a list
  title in a message or build `getbytitle(` anywhere else (a test counts them). Settings with no prefix give the usual titles, so the requests
  are character for character what they were before Phase 10b: `scripts/request-baseline/` holds them, and **a baseline is never regenerated to make a comparison pass**.
  `getbytitle` is kept; asking by address (`web/GetList`) waits for what a real site reports (Setup's rows).
- **The fake holds two sets of lists** (`scripts/sharepoint-fake.js`): the plain ones and the prefixed ones, whichever is the test's own (`createSharePointFake({
  prefix: 'PMS3' })`; `fake.settings` is what to configure the data layer with). A request to the other set is ANSWERED, as a second copy's lists would
  answer, and recorded (`fake.strays`, `STRAYS`). Every mocked suite ends with "no request of this suite reached a list that is not its own" and is run a
  second time on `PMS3` lists by `scripts/test-list-namespace.js`. Keep that last test in a new mocked suite: with one list made to forget its prefix, the
  Today and Live display suites failed nothing else. `plainTitles()` takes the prefix off what the app said, for an assertion written with plain titles.
- **Build values are one bundler constant** (`__PMS_BUILT__`, `migration/vite-plugin-built-settings.ts`, read only by `lib/settings/built-settings.ts`), validated with
  the rules a page applies. A blank `PMS_LIST_PREFIX` builds nothing in; the empty prefix, on purpose, is two quotation marks (`PMS_LIST_PREFIX='""'`). What is
  built in is a fallback: a settings file still wins, setting by setting. `__PMS_BUILD__` is the build's name (`pms-<commit>`), which only Setup reads.
- **Setup's panel, list rows and probe are Setup's own modules** (`lib/setup/setup-deployment.js`, `src/setup/`): `scripts/test-bundle-budget.js` fails if they, or
  the wording, are in the participant or admin page. "This copy of the app" is made from the resolver's own answer and the data layer's own titles
  (`sharePointListTitles`), so it cannot disagree with what the page does. "Where the lists are" only reads (fourteen GETs since Phase 10c-2a, fifteen before, through `probeSharePointRead(null,
  address)`), and is not shown on the local server. The label of a copy is in the admin bar and nowhere else.
- **The participant page may grow by 1,500 B gzip over where Phase 9b left it** (`PHASE_10B` in `scripts/bundle-budget.js`; 157,359 B before). It ended
  52 B inside that. Phase 10c-1 then made the page 1,347 B smaller and set the next phase's starting point (`PHASE_10C1`, below); anything added to
  `dataService.js`, `lib/settings/start.ts`, `lib/settings/deploy-settings.js` or `lib/settings/settings-file.js` is still paid for by every participant.
- (Until Phase 10c-1 the last rule here was about the legacy pages, which bundled `migration/src/lib/data/dataService.js`. They left the branch; see the next section.)

## Rules from Phase 10c-1 (the clean break; keep them holding)

Everything of this phase ran against the local server and the mocked SharePoint REST. Nothing has met the real tenant or a real device, and the new
site has not been touched. The full account is `CLEAN-BREAK-10C1.md` (in git history at `7347c72`).

- **One app.** No legacy page, screen, build or legacy-only test is on the branch. They are in the local tag `legacy-final` (`2ad1520`), which is never
  moved and never pushed. Do not bring a legacy file back; a test asserts that `public/js/kiosk.js`, `public/config.js` and the Kroger stand-in are gone.
- **It changed no behaviour of the pages.** No list title, column or request of a page changed: the request baselines are the proof, and the only entries
  that moved are those of tests that were removed or (the assign tests) pointed at the new modules, each listed in the report.
- **A baseline follows a removed or changed test only through `--amend`** (see `npm run test:baseline` above): tests first, in a commit that touches no
  code, then the code, in a commit where every baseline is identical.
- **`dataService.js`**: the export list is pinned (115 then; 104 since Phase 10c-2a, which took out the seven exports no page called: see "The shared code left in `public/`").
- **The participant page starts the next phase at 157,460 B gzip** (`PHASE_10C1` in `scripts/bundle-budget.js`: 158,807 B before, no allowance, 1,347 B
  smaller after). The next phase's allowance is counted from the smaller page. (Phase 10c-2a ended at 155,669 B: `PHASE_10C2A`.)
- **No page takes a picture from the repository.** The modules that inlined `public/assets/images/**` into the pages are gone: on a clean checkout they
  embedded nothing, and on a machine with a local upload they would have put that upload inside a release page. A client's pictures are uploaded (Brand Studio).
  (Phase 10f: the one exception is the Setup page, which carries the six sample pictures from `migration/src/assets/sample-pictures/`, each imported by its name, never
  a glob, and never from `public/`; the participant and admin pages carry none, and `npm run test:bundle` holds that.)
- **Found, and still left:** the local admin's participant link points at the local server's port, where no page is served any more
  (`lib/admin/admin-links.ts`). (The other thing found here, the self-test's sentence that named `public/config.js`, was corrected in Phase 10c-2a.)

## Rules from Phase 10c-2a (what the new project no longer has; keep them holding)

Everything of this phase ran against the local server and the mocked SharePoint REST. Nothing has met the real tenant or a real device. The full account
is `DROPS-10C2A.md` (in git history at `7347c72`); every request-baseline entry that moved, with its test, is
`DROPS-10C2A-BASELINES.md` (in git history at `7347c72`). (Its list titles and column names were the old ones; Phase 10c-2b gave them the PMS names.)

- **Twelve lists.** `ThemeConfig` is gone from the data layer, the mocked SharePoint, the local server (`theme.json`, its routes) and Setup. The Live display's
  brand (`migration/src/lib/brand/branding.js` `loadBrand`) is the client it is given, else the client of the session it is given, else `DEFAULT_BRAND`. A seed file that still
  has `theme` is accepted and that key is not read.
- **A session has no answer item of its own.** Nothing reads, writes or clears the item whose `AppId` is a session's id. A restart is
  `restartParticipantTrack` alone: it clears the participant's own item, checks the visit and stamps it (it used to create an empty item for the session on
  SharePoint). The oracle (`scripts/oracle-results.js`) no longer makes such an item; its generator still makes the draws that chose it, so every seed is the
  session it always was. Do not "tidy" those draws away: the seeds would all change.
- **The live client is the one AppSettings names** (`ActiveClientId`), never the one found through the live session. With no client named nothing is live
  (`client-missing`), in the participant's read, a scan, Today, Clients, Content and Guests. A test or a mock that makes a session live sets both, as Go live
  does (`scripts/migration-tests/fixtures.ts` was shaped like older data until this phase, and the participant specs relied on the fallback without saying so).
- **An activity belongs to a client.** One with no client is shown to nobody, costs no read, and no screen lists or assigns it. Copy from another client and
  Duplicate are how an activity reaches another client. `duplicateActivity` still refuses an activity with no client.
- **No request filters on a Yes/No column or on a picture's address.** The five calls that retire a session's unscanned codes (`setVisitorEnabled`,
  `setSessionParticipationMode`, `endSession`, `activateClient`, `activateSession`) read the codes by `SessionId` (and `VisitorId` for one guest) and use
  `unscanned()` in `dataService.js`; a code with no stored `used` counts as unscanned, as `qrTokenStatus` has it. Which pictures are still shown is
  `picturesStillShown()`. Tests fail on `Used eq` in any request of those five and on `where: { imageUrl` anywhere under `migration/src`.
- **Codes and visits are read by session, never as whole lists.** The one exception is Results (`AdminResults.refreshNow`, `listQrTokens()`): that screen shows a
  card for every session with its code counts, so it needs every session's rows, and it changes when the screen does. No page calls `listClientTracks()`
  without a session id.
- **The participant page may not grow**: 155,669 B gzip when this phase ended (`PHASE_10C2A` in `scripts/bundle-budget.js`: 157,460 B before, no allowance,
  1,791 B smaller after). The export list is 104.
- **A failing test first, never a red commit.** For a change of behaviour the test is written and run red (the output is kept), and the test and its fix are
  committed together. To see a new plain function fail for the right reason, give the test a stand-in that does it the old way, run it, and take the stand-in out.
- **Never `git add -A` here.** The untracked brand, Unity and `.claude/` files under `public/assets` and elsewhere must stay untracked: use `git add -u` and name
  new files.
- **Left open:** `deleteClientTrack` (exported, no page calls it); the seeded local session `s-kroger-kickoff` has six visits and no answers since the older-shape
  seed file went; Results' whole-list read of the codes; `readNameSources` reads 20 sessions to a read, which is over 1,500 characters with the longest session
  ids; the local admin's participant link (from Phase 10c-1).

## Rules from Phase 10c-2b (one schema file, the PMS list names, schema v2; keep them holding)

Everything of this phase ran against the local server and the mocked SharePoint REST. Nothing has met the real tenant or a real device. The full account is
`SCHEMA-10C2B.md` (in git history at `7347c72`); the reference to every list and column is [SHAREPOINT-LISTS.md](../SHAREPOINT-LISTS.md).

- **The schema file is the one place a list or a column is named.** `migration/src/lib/schema/pms-schema.js` (`LISTS`, `ID`, `LIBRARY`, `VERSION`; every page carries it,
  so keep it small) says each list's title before any prefix and, for each field of a record, its column, its kind (text, `number`, `yesno`, `date`,
  `array`, `object`) and `indexed` where the data layer filters on it. `migration/src/lib/schema/pms-schema-meta.js` (`META`, `columnsOf`, `LIBRARY_META`, `LOCAL_FILE`) says
  everything else: SharePoint type, unique, required, allowed words, longest value, default, date format, purpose, who reads and writes it, personal data,
  each list's purpose and growth. Only Setup, the tests and the generators import META, and `npm run test:bundle` fails if its words are in the participant
  or the admin page. The data layer, Setup's check (`schemaSpecs`), the mock (`scripts/sharepoint-fake.js`), the stub of `test-sharepoint.js`, the local
  server (`LIST_FILES`) and `scripts/validate-data.js` are built on it; `scripts/test-schema.js` fails if a hand-kept table comes back or a reader spells a title.
- **To add or change a column:** one entry in `pms-schema.js` and its description in `pms-schema-meta.js` (same list, same order: `test-schema.js` holds the
  two together), the code that uses the field, then `npm run build:lists-reference` (SHAREPOINT-LISTS.md is generated; `scripts/test-lists-reference.js`
  fails when it is stale) and `npm run test:schema`. A list: a new key in both files, its functions, a `server/data/<key>.json`. An index is said once, in
  `pms-schema.js` (`indexed`); META derives it. Raise `VERSION` when an older build cannot work with the change. **No column may be named like a SharePoint list-item property**
  (or a column SharePoint puts on every list): the schema test lists them (`LIST_ITEM_PROPERTIES`, `BUILT_IN_COLUMNS` in `scripts/test-schema.js`) and fails on one (Phase 10i).
- **The lists are `PMS` and a meaningful name** (`PMSClients`, `PMSClientSessions`, `PMSActivities`, `PMSActivityQuestions`, `PMSAnswerOptions`,
  `PMSParticipants`, `PMSParticipantAnswers`, `PMSGuestQRCodes`, `PMSGuestList`, `PMSVisitLog`, `PMSAdminUsers`, `PMSAppSettings`; the library
  `PMSClientImages`). The keys (`clients`, `sections`...) did not change. The prefix still goes in front (`"listPrefix": "Test"` gives `TestPMSClients`), and a
  page must be told its prefix (`""` on purpose).
- **Schema v2:** every column must exist (no optional columns; a list that lacks one is refused before anything is written); an order is `SortOrder`
  (SharePoint keeps `Order`); the eight columns of chosen words are single-line text, their words in META; an index on exactly the columns a request filters
  on (11 besides AppId), and `scripts/test-schema.js` holds that against every recorded request while the mock refuses, and records in `UNINDEXED`, a read on a
  column with no index (Setup's `$select=Id` probes aside); AppId required, indexed and unique, no other column required; every date column shown as
  Date & Time; Yes/No columns default to No. Setup's check reads META alone and is strict; Today's check is strict by kind and index, without the words.
- **The lists' version.** `SchemaVersion` (Number) on the PMSAppSettings item `default`, this build `VERSION` 2: read on the reads of that item that already
  happen (`getAppSettings`, `readLists`, `readParticipantWatch`; `listAdminUsers` for a site with no lists), never written (Setup writes it, 10c-3; no item
  is made by hand). A missing item, list or version is PMS-LST-010, lower 011, higher 012: the data layer tells the page (`configure({ onStop })`) and
  throws the code; `lib/settings/start.ts` puts up the stop screen on the participant and admin pages; Setup opens and says the case (`readListsVersion`, the words in
  `lib/settings/deploy-problems.js`). It costs the participant page no request, the admin none, Setup one GET as it opens. Go live reads AppSettings first.
- **Tests name lists by key, never by title** (`fake.item('sections', id)`, `entry.list === 'responses'`, `without: ['clients.Slug']`); a test that quotes
  what the app said writes `${TITLE.<key>}` (`scripts/sharepoint-fake.js`). The mock refuses a name that is not a key, and `scripts/test-list-keys.js` scans
  for a title where a key belongs. A site the mock sets up is provisioned (`schemaVersion: 2`, the AppSettings item under an id outside the test's own
  sequence); `schemaVersion: null` is a site Setup has not run on. `OTHER_PREFIX` is `Test`. `PHASE_4_COLUMNS` is test data: thirteen columns to take away.
- **The request baselines were translated, not re-recorded:** each old title to its PMS name, `ClientLogos` to `PMSClientImages`, `Order` to `SortOrder`
  (`scripts/schema-baseline/translate-baselines.js`), only after a fresh recording equalled the translation exactly in every node suite and the three
  browsers. The rule stands: a baseline follows a change only by `--amend` (and `--code`) or a translation that a fresh recording proves.
- **The snapshot of the schema before this phase** is `scripts/schema-baseline/schema-before-10c2b.json` (`node scripts/schema-snapshot.js --verify` reads it
  again out of `ec31ac9`); `scripts/test-schema.js` regenerates the schema file from it and this phase's named changes, and fails if any one is left out.
- **The participant page may grow by 600 B gzip net over where Phase 10c-2a left it** (`PHASE_10C2B` in `scripts/bundle-budget.js`; it ended at 155,574 B,
  95 B smaller). The export list is 102.
- **Left open then, fixed in Phase 10c-3:** two admin inputs wrote a single-line column with no length limit (an answer's text, `PMSAnswerOptions.Label` and the
  `OptionValue` made from it; a client's name, `PMSClients.Name`). Nothing has met the real site.

## Rules from Phase 10c-3 (Setup creates and completes the lists, and adds the first admin; keep them holding)

Everything of this phase ran against the local server and the mocked SharePoint REST. **Nothing has met the real tenant or a real device**: QA-TESTING.md items 118
to 132 are what only the real site can show. The full account is `PROVISION-10C3.md` (in git history at `7347c72`); the steps for a
deployer are SHAREPOINT-DEPLOYMENT.md, "Preparing a new site".

- **Setup's page is in steps:** 1. This copy of the app; 2. Lists (Show the plan, Create, Check Lists, Mark the site as ready); 3. Admins; 4. Sample clients
  (optional); 5. SharePoint self-test (optional); then "Where the lists are" and, last, "Moving content made on another copy" (the seed-file import). The check and
  the import each have their own status line (`lists-status`, `import-status`).
- **The plan reads and never writes** (`migration/src/lib/setup/provision.js`, Setup's alone; `npm run test:bundle` holds it, `setup-admins.js`, `setup-import.js` and
  `src/setup/PlanView.svelte` out of the participant and admin pages): ONE read of the site's lists and ONE of each existing list's columns, the schema's lists
  only, under this copy's titles. The same site gives the same plan (`makePlan` is pure; the version-history choice is worked out again from the same reads).
  SharePoint's own Title is never created (the activities' title is that column).
- **Create only ever adds.** It carries out exactly the plan it is handed: lists, then columns, then indexes and uniqueness (index first, each its own write),
  then the settings of lists Setup made. It never deletes, renames or changes a column's type (a test reads its source; the fake refuses a type change). The only
  change to an existing column is an index or uniqueness the plan named (`FIELD_CHANGES`), and to a list its attachments, content approval, version history and
  description (`LIST_CHANGES`), only on lists Setup made (their description says so until the settings are made: that is how a stopped run is finished). Paced
  with `runPaced` (three lists at a time, each list's writes in turn); the first write goes alone. Every column is read back; a different internal name, type,
  rich text or date-only stops Create at once with the column named. A 403 stops it with "Your account cannot create lists on this site. A site owner must press
  Create, or create the lists by hand from SHAREPOINT-LISTS.md." Every stop lists what was made before it.
- **The version of the lists is written last, and only on a clean check** (`markReady`): Setup's strict check finds nothing and the picture library is there, then
  the PMSAppSettings item `default` gets Title `default` and `SchemaVersion` (a new item) or `SchemaVersion` alone (an item without one). Never over another
  version, never with two items called default, nothing on a second press. A clean Create runs it by itself.
- **The data layer's check leaves SharePoint's built-in Title alone** (it is required on every list SharePoint makes): before this phase the strict check called
  it "Must not be required" on PMSActivities, which would have kept a Setup-made site from being marked ready and blocked Go live on Today.
- **One door for Setup's writes to the site itself:** `dataService.sendToSharePoint(method, resource, body, headers)`, SharePoint only. Setup's reads go through
  `probeSharePointRead(null, address)`. Nothing else under `migration/src` fetches.
- **Admins are added in Setup, and only there** (`lib/setup/setup-admins.js`): a name and a PIN of 6 to 12 digits typed twice, stored as `{ id: admin-<8 hex>, name, pin:
  <hash> }` through `dataService.addAdminUser` with the hash `lib/admin/admin-pin.js` compares (`hashPin`, exported; `login` unchanged: decision 10). The PIN is never
  stored, sent, logged or shown, and a PIN another admin has is refused. Setup lists the admins by name only (one read as it opens on lists of this version).
- **The seed-file import brings no admins**, and it is Setup's alone (`lib/setup/setup-import.js`, built on the data layer's own calls; `importSharePointSeed` left
  `dataService.js`). A file's `adminusers` are left out and the page says so.
- **A single line of text holds 255 characters.** The data layer refuses a longer one before anything is sent, on both adapters (`fits` in `createItem` and
  `updateItem`; text kept in several lines is marked `long` in `pms-schema.js`, and a test holds `long` to META's Note). The admin's inputs take META's limits
  through constants a test holds equal to META (`MAX_OPTION_TEXT`, `MAX_CLIENT_NAME`, and the older `MAX_ACTIVITY_TITLE`, `MAX_GUEST_NAME`, `MAX_IMAGE_URL`,
  `SLUG_MAX`), with a plain message at the limit.
- **The fake can build a site** (`scripts/sharepoint-fake.js`): `GET`/`POST /web/lists`, `fields/createfieldasxml`, a column by id or name, MERGEs of a column's
  index, uniqueness or required and of a list's settings; `traps` (`ALL_TRAPS`; `taken` names a column's internal name as taken), `forbid(when)` (a 403),
  `failWrite({ at })`, `writes()`, `listSettings(key)`, `field(key, name)`, `without: ['logoLibrary']`. The other copy's lists stay on the site whatever `without`
  says. A test that names the `Test` prefix itself stays out of a recorded suite (the namespace suite reruns recorded suites on `Test` lists).
- **The participant page may not grow** (`PHASE_10C3`, allowance 0, from 155,574 B): it ended at 155,320 B. The export list is 103.
- **Found, and left:** the progress line says "1 of 1 columns"; a seed file's record over 60,000 characters is now refused when it is written, no longer before the
  import starts (the import moved out of the data layer, which checked it as it encoded).

## Rules from Phase 10f (the sample pictures and the release package for the new site; keep them holding)

Everything of this phase ran against the local server and the mocked SharePoint REST. **Nothing has met the real tenant or a real device**: QA-TESTING.md items 133 to
137, and the earlier ones the release package's RUNBOOK.md names. The report is [RELEASE-10F.md](history/RELEASE-10F.md). The new site is
`https://internal.global.deloitteonline.com/sites/PCOE`, folder `Shared Documents/PMS`, lists `PMS...` with no prefix; **no address is built into the pages**.

- **`Design-Docs/` is gone** (see the top of this file). A mention of a report in it says "in git history at `7347c72`".
- **The six sample pictures are what Brand Studio stores**, made by Brand Studio itself (`npm run build:sample-pictures`), never by a second copy of its rules:
  Kroger's and Domino's logo (800x400), hero (1200x1200) and background (1536x2048, or smaller to fit 350 KB: Domino's gingham is a JPEG at 1152x1536). The
  canonical files are `migration/src/assets/sample-pictures/`; the local server's uploads (`public/assets/images/clients/`) hold the same bytes, and
  `server/data/clients.json` points at them; `scripts/test-sample-pictures.js` holds the two copies, the list and the names together. The logos are the clients'
  real logos, supplied by VJR for this internal app: files only, never redrawn or imitated. To change one: replace the source in `.local/sample-images/`, run the
  generator, and commit both copies and the two generated modules.
- **"Seed sample clients" puts the pictures in the library first** (`lib/setup/sample-seed.js`, Setup's alone): for each client whose theme it writes (one that does not
  exist, or an empty theme), one GET of the library's files, then each picture not already there (`uploadClientAsset`, as Brand Studio's save), then the clients
  with the addresses in their theme and LogoUrl and the focal point Brand Studio stored. A client that exists gets nothing, its pictures included, so a second run
  uploads and writes nothing. A failed upload stops it before any client is written. On the local server there is no listing: a file is written again, the same bytes.
- **The participant and admin pages may not grow** (`PHASE_10F`, allowance 0, from 155,320 B and 605,064 B in this checkout; Phase 10g then took 100 B each, see its section). Setup carries the pictures (about
  757 kB gzip; at most 1 MB of pictures, `setupPictures`). The list of pictures holds no full hash: **no page may hold 64 hex digits in a row** (a PIN hash looks
  like that; `npm run test:bundle` and the package script check every page).
- **The scratch servers of the browser tests start with the six sample pictures in their `UPLOAD_DIR`** (`admin-local.ts`), as the real local server's uploads
  hold them, so a test that replaces one removes the scratch copy and never the file in `public/`. A test that needs a client with no picture says so and clears
  them (`brand-studio.spec.ts`, the older logo).
- **A release package is made by `npm run package:release` and nothing else**, from a committed tree, and is never committed. Its `pms-config.txt` is exactly
  `{"configVersion": 1, "listPrefix": "", "label": "PMS"}`. Its RUNBOOK.md is generated (`scripts/release-docs.js`): change the words there, with
  `scripts/test-release-docs.js`, not in a package. The permissions come from META's `reads` and `writes` (`scripts/permissions.js`): participant accounts write
  five lists, only read seven, and must not read PMSAdminUsers.
- **Rehearse a package before it is handed over:** `npm run test:rehearsal` (steps 3 to 15 of RUNBOOK.md, on an empty site and on a hand-built one with a misnamed
  column, and since Phase 10h the note for the PCOE site on a site already set up, in three engines). Step 11 (permissions; step 10 until Phase 10h) cannot be rehearsed: the mock has none. **Playwright's WebKit hands a route an EMPTY body for a Blob upload**, so the
  mock cannot store a picture uploaded from WebKit: Setup's upload is checked byte for byte in Chromium and Firefox (`playwright.config.ts` says why not WebKit), and in
  WebKit the rehearsal checks the names and puts the committed bytes in place (it fails, on purpose, if WebKit ever sends the body).
- **A test must not depend on a build lying in the tree** (`build-svelte/release` may be from another commit): the proofs on real pages are in `test:bundle`, which builds
  its own.

## Rules from Phase 10g (the settings file is pms-config.txt; keep them holding)

The first run on the real site (`https://internal.global.deloitteonline.com/sites/PCOE`, a classic SharePoint; the package `pms-50ae628` in `Shared Documents/PMS`,
14 Oct 2026, reported by VJR) is the first thing that has met a real tenant: the three pages opened, and `setup.html` worked out its site from its own address and
reported its build. Then it stopped with `PMS-CFG-002`: **this site will not serve `.json` files from a document library**. Opening `.../PMS/pms-config.json`
showed SharePoint's own "Sorry, something went wrong: File Not Found" page although the file was in the folder, and a page's request receives that page with a success
status (which `settings-file.js` classes as `page`, not as a 404). The same file renamed `pms-config.txt` is served as its text. Everything else (the lists, Setup's plan,
Create, Mark ready, Add an admin, Go live, an iPad) has still not run on the real site. The report is [RELEASE-10G.md](history/RELEASE-10G.md).

- **The settings file is `pms-config.txt`, and that is its only name.** `SETTINGS_FILE` in `lib/settings/deploy-settings.js` is the one place the code spells it. Its content is
  still JSON and its rules (`configVersion`, `listPrefix`, `lists`, `logoLibrary`, `batch`, `support`, `label`, `siteUrl`) are unchanged. The pages read it and nothing else:
  a `pms-config.json` in the folder is never asked for, never read and never a stand-in for a missing `.txt` (a 404 for the `.txt` is "no file", PMS-CFG-001, whatever else is
  there). Do not read both, so there is never a question of which wins. `scripts/test-settings-file.js` (a stand-in for fetch with a decoy `.json`),
  `settings-file.spec.ts` (a decoy `.json` served in a browser, in three engines) and a source guard (no file under `migration/` or `public/js` says `pms-config.json`)
  hold that. The example file is `pms-config.example.txt`. Tests that serve the file serve it as `text/plain`, as the tenant does.
- **PMS-CFG-002's Details carry the HTTP status for a web page or text that is not JSON** (`page 200`, `json 200`, as `status 503` always did): `settings-file.js` hands
  `fileError.status` back for those two as well, and `deploy-problems.js` words a web page in the file's place as "usually its sign-in page, or an error page such as
  'File Not Found' when the site will not hand out this kind of file". The participant page's stop screen is as it was (it already printed `kind` and `status`).
- **The package script proves the folder and the zip hold `pms-config.txt` exactly (`{"configVersion": 1, "listPrefix": "", "label": "PMS"}`) and no `.json` file**
  (`listingProblems` in `scripts/release-proofs.js`, shown to be able to fail in `scripts/test-release-docs.js`), and the rehearsal serves the package's own
  `pms-config.txt`, not a constant (`packageSettings` in `runbook.spec.ts`). RUNBOOK.md has a note before the steps for a site that already has the earlier upload (replace
  the three pages, the `pms-config.txt` there may stay, delete `pms-config.json`); change those words in `scripts/release-docs.js`, not in a package.
- **The participant page may grow by 100 B gzip in this phase and no more** (`PHASE_10G`: from 155,320 B, it is 155,328 B in this checkout, +8 B; the admin page 605,066 B,
  +2 B, held to the same allowance; a fresh checkout measures about 11 B less). The next phase starts from `participantAfter`/`adminAfter`. Phase 10f's check became a
  recorded-numbers one (it compared the build with figures the newest phase has moved past); the newest phase's test holds the build.
- **No request baseline moved**: the settings file is fetched by `settings-file.js` alone, which no recorded suite sends through.
- **Found, and left:** `npm run test:styleguide` fails one test, "Setup's pieces (Phase 10b)", at `98c9e03` as well as here: Phase 10c-3 numbered Setup's steps, so the
  heading is "1. This copy of the app" and the test still looks for "This copy of the app" exactly (`styleguide.spec.ts:201`). It is not part of any gate in this file and was not
  touched here (Phase 10h fixed it). QA-TESTING.md item 138 (a missing `pms-config.txt` comes back as a 404) is still to see.

## Rules from Phase 10h (three fixes from the first real-site run; keep them holding)

The real site (PCOE, `pms-969bf16`, steps 1 to 9 of the runbook on 14 Oct 2026) showed three things, and this phase fixed them and nothing else. The report is
[RELEASE-10H.md](history/RELEASE-10H.md). **These pages have not run on the real site yet**: QA-TESTING.md items 138 to 142.

- **Every item read names its columns.** That site left `ClientId` out of every PMSActivities item read that did not say which columns to return (`items?$top=200`) and returned it to one
  that did; why, and what else it leaves out, is not known (the self-test's third probe asks it, QA item 139). `migration/src/lib/schema/pms-schema.js` `selectOf(key)` is the `$select` of a list (`Id`,
  `AppId` and every column the schema maps, once), and in `dataService.js` every item read's address is made by `spItems(list, query)`, which ends with it (`spFind`, the list GET of
  `spSend`, `spByAppId`, `spItemsAddress` and so `readLists`, and `probeSharePointRead` when its query names none). `PARTICIPANT_SELECT` was named before and is kept as it is.
  Setup's reads of items name theirs too (`provision.js`). `scripts/test-named-reads.js` checks the source (every `/items?` address names its columns) and walks the pages on the
  strict mock. The one read that names no columns on purpose is the probe's `$top=1` (`setup-checks.js`).
- **The mock answers an item read as that site did** (`scripts/sharepoint-fake.js`): with `$select`, exactly the named columns and `__metadata`, `Id`, `ID` (a column the list lacks is
  refused, 400, as SharePoint is believed to answer); without it, the columns in `leavesOut` (default `TENANT_LEAVES_OUT`, `ClientId`) left out, and the same for the item a create
  returns (assumed). By default it is **strict**: an item read without `$select` is refused (`UNNAMED_REFUSAL`) and noted in `UNNAMED`, which every recorded suite's last test holds empty
  beside `STRAYS` and `UNINDEXED` (add it to a new suite). `{ strict: false }` is the site as it was seen (the rehearsal runs on it). A `__next` link keeps its `$select`.
- **A create's reply is completed from what was written** (`spMade`, in `spCreate` and the scan's `createTrack`): a column the reply leaves out is taken from the record that was sent;
  what the reply says wins. Do not read a column of a create's reply that the caller did not write.
- **A duplicate is 409 however SharePoint says it** (`spHttp`): status 400, 409 or 500, and its error code names `SPDuplicateValuesFoundException` or its words match
  `/duplicate|unique value/i`. Any other refusal keeps its status (a 500 is a 500, a 503 is never a duplicate). Every refusal carries `sharePointStatus`, what SharePoint said, and its
  message still begins `SharePoint (<status>):`. The mock refuses a duplicate with 500 and the site's words by default (`DUPLICATE_WORDS`); `duplicateStatus: 400` is the old answer;
  `duplicateCode: true` adds `DUPLICATE_CODE`, which is ASSUMED (QA item 142). Every caller of 409 is listed in RELEASE-10H.md 4.3.
- **Setup carries the admin page's tokens** (`setup-main.ts` imports `tokens.css`, `fonts-admin.css` and `admin-tokens.css` in `admin-main.ts`'s order). A page that uses `admin.css`
  must import them: every rule there reads a token. `setup-look.spec.ts` measures every button (an edge, and 4.5:1 when it can be pressed) because axe passes a switched-off button and
  calls words the colour of their background (1:1) "needs review"; on Setup `a11y.spec.ts` fails such an item.
- **A page names a list by its title under this copy's settings, never by a spelled name** (`dataService.sharePointListTitles()`, Setup's `listTitles()`; `scripts/test-shown-names.js`).
- **The request baselines followed the `$select` by translation, never by a new recording** (`scripts/schema-baseline/select-baselines.js`: each item read that named no columns gets
  `&$select=` and its list's columns at the end, a mock's `__next` link the same before its `$fakeskip`; `--check` held every node suite's fresh recording equal to it, `--order` held
  the number and order of every request to the last commit's, and the browser spec was pointed at `--to <dir>` in three engines before `--write`). A new item read is amended with
  `--amend ... --code` as before; never re-record.
- **Addresses**: the `$select` adds at most 164 characters to a read (PMSParticipants has the most columns); the part that grows with the content is still held to 1,500 characters, the
  whole to 1,700 (`scripts/test-live-display.js`). The longest is the open item of 10c-2a, `readNameSources` by 20 sessions, 1,872 on the PCOE address.
- **On a site where a column was deleted by hand after Setup marked it ready**, a page that reads that list now stops with SharePoint's words naming the column (Today used to show it as a
  readiness blocker): the decision is VJR's (QA item 141). Setup's Check Lists names it either way.
- **The participant page may grow by 300 B gzip in this phase and no more** (`PHASE_10H`: parts A and B, +167 B in this checkout, 155,495 B; the admin page 605,202 B, +136 B; C to F
  add nothing to the participant page). The next phase starts from `participantAfter`/`adminAfter`. Phase 10g's check became a recorded-numbers one.
- **RUNBOOK.md has sixteen steps** (the self-test is the optional step 10) and a note for the PCOE site before them; QA items 139 to 142 are new. A package is still made from a committed
  tree and rehearsed (`npm run test:rehearsal`: 9 rehearsals, three engines).
- **Found, and left:** two flakes, each failing once and passing alone: `admin-today.spec.ts:421` ("slugs") in Chromium on the untouched `5bc90fa` (a read-back before the save
  landed), and `live-display.spec.ts:208` (full screen on a phone and a tablet) in Firefox at `e250a36` (a chart redrawn late after a resize). The column
  descriptions in `pms-schema-meta.js` (SHAREPOINT-LISTS.md) still name the lists of before 10c-2b; no page shows them.

## Rules from Phase 10i (a column SharePoint will not return by name; keep them holding)

The real site (PCOE, `pms-e250a36`, 15 Oct 2026) passed the self-test (10 of 10), showed each client's activities, went live with Domino's and ran a participant's whole visit in
Chrome; then Admin → Results did not load: "SharePoint (400): Value does not fall within the expected range." The request was the visit log's read in `readNameSources`, which named
`DisplayName`. Read one column at a time, every custom column of every list came back but `PMSVisitLog.DisplayName`, and an unnamed read left it out: `DisplayName` is also a property
SharePoint gives every list item in REST (`SP.ListItem.DisplayName`). The report is [RELEASE-10I.md](history/RELEASE-10I.md). **These pages have not run on the real site yet**: QA-TESTING.md
items 143 to 145.

- **No column may be named like a SharePoint list-item property; the schema test lists them** (`LIST_ITEM_PROPERTIES`: the properties of `SP.ListItem` and what an unnamed read
  returns, and `BUILT_IN_COLUMNS`: the internal names SharePoint puts on every list, `Order` among them; case aside, the built-in `Title` allowed). Before 10i only the two `DisplayName`
  columns matched.
- **Schema version 3** (`VERSION = 3`): `PMSGuestList.GuestName` (a guest's name) and `PMSVisitLog.SignedInName` (a staff sign-in's name); the record field is `displayName` as it was.
  `pms-schema-meta.js` `RETIRED` names the columns an earlier version had (the two `DisplayName` columns, last in version 2, and what holds their value now); `retiredColumn()` and
  `columnNamesAt(key, version)` read it. Nothing reads or writes a retired column, the strict check does not look at it (it flags an extra column only when it is required), and
  Setup never deletes it.
- **Setup brings an older site up** (`lib/setup/provision.js`): the plan lists a retired column under what it will not touch, as harmless; Create adds the new columns and only adds; and
  **Mark the site as ready, once the check of this version is clean, raises a lower version (1 or 2) to `VERSION`** (SchemaVersion alone, If-Match on the item as read, read back)
  and says "Raised the lists from version 2 to version 3."; it never lowers a higher version ("Setup never lowers the version of the lists: upload the newer files."), leaves a
  value that is no version as it is, and writes nothing while a problem remains. A clean Create runs it by itself. PMS-LST-011's words in Setup say what to press (Show the plan,
  Create, Mark the site as ready); the stop screen of the other two pages is unchanged.
- **What was written to a retired column cannot be read back**: on PCOE the 15 Oct visit's sign-in name is in `PMSVisitLog.DisplayName`, so after the upgrade Results names that
  visit "Unnamed participant N"; a guest added before an upgrade would have no name. Visits after it are named.
- **The mock answers as the site did** (`scripts/sharepoint-fake.js`): `refusesByName` (default `TENANT_REFUSES_BY_NAME`, `['DisplayName']`) refuses an item read whose `$select` names
  such a column when it would return a row (400, `REFUSED_WORDS`, noted in `REFUSED_BY_NAME`; with no row it is answered, as PMSGuestList was); `leavesOut` is `['ClientId',
  'DisplayName']`; `listsVersion: 2` builds a site as Setup made it for version 2 (its settings item says 2 unless `schemaVersion` says otherwise); the default version follows `VERSION`.
- **Setup's self-test is eleven steps on SharePoint**: a fourth read-only probe, "columns this site will not return by name" (`lib/setup/setup-checks.js`): for each list with an item, its
  own columns from its fields, one item naming them all, and only when that is refused each alone. It reports and never fails.
- **The request baselines followed the rename by translation** (`scripts/schema-baseline/rename-baselines.js`): 34 entries in 10 files, each only the column in a `$select`; a fresh
  recording equalled it in every node suite (`--check`), 26,178 requests in the same number and order as `e07d2e3` (`--order e07d2e3`: part A was red, so the last green commit is
  the "before"), and the three browsers' start-up passed against it and failed against the untranslated files. No entry carries the version's number (bodies are not recorded).
- **Part A was committed red on purpose** (`7d47ba7`: the mock's new default and the guard, with the failing tests): asked at the start of the phase, the answer was "A red, B green".
  The rule "a failing test first, never a red commit" otherwise stands.
- **The participant page may grow by 100 B gzip in this phase and no more** (`PHASE_10I`: +8 B in this checkout, 155,503 B; the admin page 605,208 B, +6 B). The next phase starts
  from `participantAfter`/`adminAfter`. Phase 10h's check became a recorded-numbers one.
- **RUNBOOK.md's note for the PCOE site is now for its lists of version 2** (ten steps, up to the iPad by a guest's QR code); the self-test is eleven steps; QA items 143 to 145 are
  new (`QA_BY_NOTE`). The rehearsal has four runs (the fourth is that note), twelve in three engines.
- **Found, and left:** see RELEASE-10I.md, section "Found, and left".

## Rules from Phase 10j (fewer waits on the participant page; keep them holding)

On the real site (PCOE, `pms-da9fc8d`, its lists of version 3, 15 Oct 2026) VJR said the participant page "responds slowly (showing loading)". The live client has a handful of
activities: the data is small, and what cost was the number of requests the page waited for one after another (rounds) and the screens that waited on them. This phase made the
page wait for fewer of them, and changed nothing of what is saved or how. The report is [RELEASE-10J.md](history/RELEASE-10J.md). **These pages have not run on the real site yet**:
QA-TESTING.md items 146 to 149 (the timing check before and after, among them).

- **The participant page never waits on a read for something it already holds; `test-participant-waits.js` pins the rounds of each moment, and a change that adds a round must
  say why.** The targets: page open on the staff link 2 rounds (3 with an earlier visit today: its answers), a first QR scan no more than 4, "Click here to begin" 2 once the page has
  fetched ahead and 4 without, the hub drawn after 0, an activity opened from held content 0, Next 0, Submit (the earlier answers saved) 1.
- **The column check reads only what it checks** (`spMetadata`): `/fields?$select=InternalName,TypeAsString,Indexed,EnforceUniqueValues,RichText,AppendOnly,Required,ReadOnlyField`.
  A property the check reads must be in that list (a source check holds it). The schema checks (`checkSharePointSchema`: Today's, in one `$batch`, and Setup's), Setup's plan and
  its self-test probe still read every property. The mock answers `/fields` with the properties named, or, with no `$select`, every property and a SchemaXml on each field.
- **Beginning a visit** (`beginVisit`): AppSettings and the session are read side by side, and their checks keep their order and words (what AppSettings says wins over anything the
  session read says; tested on every refusal path). The session is moved to in progress with the version the check read (If-Match), so it is not read again; a 412 says nothing. With
  `waitForSession: false` (Welcome) the press does not wait for that write; the default waits, which keeps a test's set-up in order.
- **Fetching ahead** (`dataService.prepareWrites`, `lib/participant/boot.js` `writesAhead`; App.svelte after the visit log): the write token, the participants list's type and columns where a visit
  can begin, the sessions list's where it would be the session's first, the answers list's type for a visit with no answer item. They are the requests the writes make, shared
  (`spDigest`, `spMetadata`, and a type read prepareWrites started); a failed one is forgotten. Nothing is fetched that the page will not use (a later device does not fetch the
  sessions list's check).
- **The boot reads the session's visits in its second round**, beside the client, the session and the activities, before it knows the session is live and for staff: what that read
  finds is used only if it is, and is otherwise dropped, never offered on Welcome. If it fails, the first screen still comes up and Welcome looks for itself.
- **The activities' questions and options are held for the page's life** (`lib/participant/activity-content.js`, `experience.activityContent`): read for every enabled activity in one go (the data
  layer's `getSectionQuestions` handed every id: 20 to an address) once the first screen is up, beside a QR code's claim, or when an activity is opened before anything was read. An
  activity opens from them; a read on its way is waited for, never sent twice; what is not held (a new activity, a question added, a read that failed) is read when it opens.
  `FIRST_CONTENT_MS` and the boot's `content` are gone. Held by question id, in memory only: nothing of it is kept between page loads.
- **The hub draws at once from what the page holds, then reads behind it** (`experience.refreshActivities`, `activityContent.refreshWith`: the client's activities and the enabled ones'
  questions and options in one `readLists`, ONE `$batch` where the site can batch): an edit made in Content reaches a participant at the next activity they open after visiting the
  hub, and an activity already open keeps what it opened with. Once every activity is done the read is of the activities alone. A read that fails leaves what is held on the
  screen; the loading line and Try again are for a hub that holds no activity, and the read behind runs even when drawing what is held failed (it needs a read of the
  answers only when this page never read them). The reader within `HANDOFF_MS` of boot still takes boot's own read.
- **A wait that remains shows its loading line only after `LOADING_DELAY_MS` (300 ms)**, on the hub and in the pager.
- **The request baselines followed five kinds of change and no other** (each file's header says so; every entry is listed in RELEASE-10J.md): 1. the column check's `$select`
  (part B, by `fields-baselines.js`); 2. the boot's tracks read in round 2 (also sent, and dropped, where the session is not live: as asked during this phase); 3. the questions and
  options of every enabled activity, read once (part D, `--amend --code`, and by hand for the browsers); 4. the fetch-ahead after the first screen (the browsers, by hand); 5. the
  second read of the session gone, and the session read beside AppSettings even when AppSettings refuses (part C, `begin-baselines.js`, test by test). A fresh recording equalled each.
- **The whole visit** (open, begin, Kroger's two activities, finish) is 30 requests where it was 33 for the session's first device, 27 where it was 29 after it; **on a site that
  cannot batch it is 34 and 31** (each arrival on the hub reads three lists there): known, and left. PCOE batches.
- **The participant page may grow by 2,000 B gzip in this phase and no more** (`PHASE_10J`: +1,207 B in this checkout, 156,710 B; the admin page 606,141 B, +933 B; Setup
  +284 B in a fresh checkout, the data layer it carries). Phase 10c-2a's, 10c-2b's, 10c-3's and 10i's checks became recorded-numbers ones. The export list is 104 (`prepareWrites`).
- **Found, and left:** see RELEASE-10J.md, section "Found, and left".

## Rules from Phase 11a (the Results charts, names on the charts, Deloitte's colours; keep them holding)

On the real site (PCOE, `pms-0a1c701`, 15 Oct 2026) VJR saw Results' Live results as plain blue bars and totals, and nothing showed what a named guest who had joined by QR
code and finished four activities had picked. This phase changed how Results are drawn on the admin page and nothing else: not the exports, not what is counted or stored,
not the lists, Setup or the participant page. The report is [RELEASE-11A.md](history/RELEASE-11A.md). **These pages have not run on the real site, an iPad or a projector**:
QA-TESTING.md items 150 to 156.

- **One chart model, no drawing in it** (`migration/src/lib/results/results-chart-model.js`, plain JS): every share, headline, average, band, support score, rank and word a chart
  shows. Phase 11b's leader report builds on it; a number shown on the screen is worked out there and nowhere else. Its rules, each with a hand-worked test: shares are counts
  over the people who answered; single choice, true or false and a scale are rounded by the largest remainder to exactly 100 (answers to an answer that has gone take their
  share and are said under the chart); multiple choice is rounded alone; the support score is `(points - rankers) / (rankers x (options - 1)) x 100` (with every voter
  ranking every option, the brief's formula); equal scores share a place, shown as the same number on both bars ("1", "1", "3": since Phase 11a-3, "1=" before); a scale's three bands are by place (`bandOf`); the words that came up most are counted by
  comment, a plural folded only into a singular someone wrote, from a reviewed list of stop words, and are never called themes.
- **The charts are `migration/src/admin/charts/`, drawn by hand from HTML and SVG: no chart library** (Chart.js left the admin page with `public/js/resultsRenderer.js` and
  `ResultQuestion.svelte`; it is a dev dependency now, for the bundle test's negative control alone). `ResultCard` is the card: the headline, the question, "N answered", a
  4px Deloitte Green rule, the numbers view (the accessible twin of the chart), and on the wall Show answer. Bar rows and scale columns are 44px targets on the admin view
  and 24px (`--mark-target`) in full screen, where a bar opens nothing.
- **Names are on the admin view only.** The names a chart shows are `lib/results/participant-names.js`'s (as on the Results rows and in the report: "Name (2)", "Unnamed participant
  N"), through `namesFor`. **The wall (full screen, and `#live-display/<id>/wall`, which "Open in a new tab" opens: `lib/admin/live-wall.js`) is given a model with no names**, so
  no name is in its DOM: `LiveDisplay.svelte`'s `withNames` is `!wall && namesShown`, and `results-charts-wall-mutation.spec.ts` builds a page without that and shows the check
  finds names. `lib/common/admin-address.js` (carried by the participant page) is not where the wall's address is.
- **No request was added for names.** A guest's QR name is on the visit; a staff sign-in name is in the visit log, which Results reads and the Live display does not: Results
  keeps what it read for the page's life (`holdNameSources` in `lib/admin/admin-results.js`), so a Live display opened from Results names staff, and one opened straight from its
  address calls them "Unnamed participant N" (VJR's choice, 16 Oct 2026). The request baselines did not change.
- **The colours are `styles/results-tokens.css`** (the admin page's alone), held by `scripts/test-results-palette.js`: one series is one colour (the top choice Deloitte Blue
  with "Top choice", the rest the tint), Dark Green means correct and nothing else (with a tick and the word), Deloitte Green is the card's rule and never a bar, words never
  wear a data colour, the client's colours stay in the heading and never recolour a mark. Every chart sits on a white card, so there are no dark values. Most of the palette
  is not in the 2025 US brand style guide (page 42: only Deloitte Green and Dark Green are; the PDF is kept outside the repository); VJR kept the validated set.
- **The participant page may not change at all, to its Tailwind rules** (`PHASE_11A`: allowance 0, and `participantUtilities`, the class names of its `@layer utilities`, must
  be exactly what they were). Tailwind reads every file under `migration/` for class names, words a page shows and comments included: "View as table" is spelt in two parts in
  `admin/charts/chart-ui.ts`, no file there uses a size query (`@container` is a class to Tailwind), and `chart-ui.ts` keeps the word "container" on purpose (it was in the
  removed card, and without it the participant page loses its `.container` rule). Check a new file under `migration/` with `npm run test:bundle`.
- **The admin page may not grow past where Phase 10j left it** (606,141 B in this checkout; it is 552,083 B, 54,058 B smaller). Setup is byte for byte as it was (the Results
  grid's rules are in `AdminResults.svelte`, not `src/admin.css`, which Setup loads too).
- **Full screen's fit**: the card's chart never shrinks below what it needs (so a card too tall overflows where the fit loop sees it and makes the type smaller, instead of
  drawing over its own words); written answers keep at least one comment's room. The wall specs run with the display's own cover (as on an iPad): Playwright's WebKit often
  ends its own element full screen by itself in a headless window.
- **Found, and left:** see RELEASE-11A.md, section "Found, and left".

## Rules from Phase 11a-2 (the charts fit their card, tooltips are never cut off, the headlines' words; keep them holding)

On the real site (PCOE, `pms-3fb312a`, 16 Oct 2026) a colleague's Windows laptop in Chrome showed a confidence question in full screen with a scrollbar inside its chart, its
tooltip cut off and over a step's label, and an empty space under the chart; a card stretched beside one with its names open; thin columns; figures off their gridlines; and
"Most people (50%)" and "co.."; and "34 answers from 5 iPads" with a visit that answered nothing. This phase fixed those and nothing else. The report is [RELEASE-11A2.md](history/RELEASE-11A2.md). **These pages have not run on the real site, the
laptop, an iPad or a projector**: QA-TESTING.md items 157 to 160.

- **Nothing inside a result card scrolls**: no `overflow: auto` or `scroll` on anything in `admin/charts/` (an `overflow-x: auto` makes a box scroll both ways, and a
  fraction of a pixel is enough for Windows to draw a scrollbar with arrows; Playwright's Chromium hides scrollbars and macOS draws them only while scrolling, which is why
  11a's tests never showed it). A scale of more steps than its card holds at 44px shares the width out. `results-charts-fit.spec.ts` fails on any such box, at nine sizes
  and at 125% and 150% scaling, in three engines.
- **A tooltip is drawn in a layer fixed to the window** (`ChartTip.svelte`, `lib/results/tip-place.js`, unit-tested by `scripts/test-results-chart-fit.js`): clear of its mark
  and the mark's own label (`data-label-of`), above them or under them, moved along to stay in the window, following its mark on scroll; z-index 50, over the sticky bar.
  A chart hands ChartTip the elements, never a place it worked out itself.
- **In full screen the chart takes the room its card gives it** (`fit` on BarChart, ScaleChart and SplitBar): the bars share out the height, a scale's plot grows, a
  true-or-false split sits in its middle. A question that cannot fit even at the smallest type **spills**: the card is as tall as it needs and the screen scrolls as one
  page, with "More below" floating above the controls, which stay in view (`scroll-padding-bottom` keeps a scrolled-to mark clear of them).
- **The full screen's effects follow the question by its id** (`currentId`), never `current?.id` read through the object: a refresh hands the page new objects for the
  same question, and the effects took it for a new one (the type jumped back to full size at every refresh; a test records every change).
- **Grids of result cards align their cards to the top** (`align-items: start` on the Live display's and Results' grids): a card never stretches to its neighbour.
- **A confidence column is 40% of its step**, at least 24px and at most 72px, times the size of type, never wider than its step. **Every figure of a bar chart's scale is
  centred on its gridline**, the ends too; the gridlines are elements (`.bars__gridline`, `data-at`) at `at x (100% - 1px)`, and `chartProblems` holds both to a pixel.
- **Headlines** (`results-chart-model.js`): "Most people (N%) chose X." only when the top share is more than half as counted and as shown (`isMost`; 51 of 101 is shown
  as 50%), else "The top choice (N%) was X."; true or false "Most people (N%) said X." / "The top answer (N%) was X."; multiple choice the same as single choice;
  `sentence()` adds no stop to words that end with one. Phase 11b prints these sentences.
- **"N answers from M iPads" counts the iPads that answered** (`answerCounts`/`answersFrom` in `results-chart-model.js`, VJR's choice after the phase stopped to ask):
  the distinct visits (`ownerOf`) of the answers counted, over the same questions as the answers (the Live display's live activities; a Results card's all). A visit that
  answered nothing is not counted, nor one whose answers could not be read. **The Live display's one-page PDF and PowerPoint (`resultsExport.js`) still print every visit**
  until Phase 11b redesigns them; the leader report's "participants" are every visit on purpose. QA item 160.
- **The participant page did not change**, byte for byte and in its Tailwind rules (`PHASE_11A`); words such as "grow", "absolute", "invisible" and "table" in a new file
  under `migration/` can still add a rule to it: run `npm run test:bundle`.

## Rules from Phase 11a-3 (the polish batch after the 11a-2 real-site checks; keep them holding)

On the real site (PCOE, `pms-283ad18`, 16 Oct 2026, photographed by Satyadev on the Windows laptop and an iPad) a chart's tooltip could lie over the question, the
"got it right first time" line and the Show answer / View as table buttons, client heroes were squares and a locked activity's title was too faint. The work was done on
Satyadev's Windows checkout of VJR's files, which has none of the earlier history: `pms-11a3` starts at `3a8b32b`, proven to build into `pms-283ad18`'s pages byte for byte.
The report is [RELEASE-11A3.md](history/RELEASE-11A3.md). **These pages have not run on the real site, an iPad or a projector**: QA-TESTING.md items 161 to 166.

- **A tooltip keeps clear of its card's words and buttons where there is room** (`placeTip(..., { avoid })` in `lib/results/tip-place.js`; ResultCard marks them `data-tip-avoid`):
  above, or above moved along while it still spans its mark, then under, or under moved along; with no room on either side, the place covering the fewest of their pixels.
  It is still always whole, inside the window and clear of its mark and the mark's own label. `tipProblems` fails a tooltip over the card's words when the place under its mark was clear.
- **The full screen's type steps are `lib/results/present-fit.js`** (`nextFit`, `scaleOf`, `SMALLEST`): the fit factor's floor is the one that gives 0.75 (it was 0.5, which left a window
  1,550 px wide or more stopped above 0.75, neither smaller nor spilling, and the card cut at its edge).
- **`online` during a look asks for one more look as soon as it ends** (`lib/common/page-watch.ts`, `scripts/test-page-watch.js`; a `Retry-After` is still a floor). Dropping it was the
  real cause of the `participant.spec.ts:91` flake.
- **A ranking's place is its number alone** ("1", "1", "3", "4", "5"; `rankLabel` in `results-chart-model.js`): "1=" for a shared place read as a typo on the
  real site, beside "3.".
- **A locked activity's title is white** (`ActivityPill`), as its caption and lock are. **A comment inside a Svelte style block is kept in the built page**: explain CSS in the script block.
- **VJR's decisions (16 Oct 2026):** names stay "Last, First" as the directory gives them; the wall page keeps the admin header, tabs, Lock and Export. **Heroes are squares when the
  uploaded picture has no transparency** (the sample sources were JPEGs); `build:sample-pictures` takes `<client>-<slot>.png` before `.jpg`.
- **`PHASE_11A3`** (`scripts/bundle-budget.js`): measured from the deployed `pms-283ad18` (participant 156,695 B, admin 553,987 B in that checkout), not from 11a, because 11a-2 grew
  the admin page and recorded no figure; allowance 500 B each; it ended at +34 B and +276 B, and the participant page's Tailwind rules are 11a's exactly. The next phase starts from
  `participantAfter`/`adminAfter`.
- **On a Windows checkout:** run the suites with Node 22 directly (`npm` puts its own Node first on the PATH, and under Node 20 a top-level `before` does not run before a
  `describe`'s tests); `node_modules` copied from a Mac lacks `@napi-rs/canvas-win32-x64-msvc`, which pdf.js needs (`npm install --no-save` at the lock file's version); set
  `core.autocrlf input`, or the pages built differ from an LF build; WebKit's sound specs and three others fail there before and after 11a-3 alike, and Firefox may be refused by Windows
  (`spawn UNKNOWN`). `test-named-reads.js` compares paths with `/` on every system.
- **The release documents** name the branch `pms-11a3` (`BRANCH` in `scripts/release-docs.js`) and say what changed since pms-283ad18, newest first. (Since Phase 11b: `pms-11b`, since pms-e2fbfb6.)

## Rules from Phase 11b (the leader report and the Live display's one-page PDF and PowerPoint on the chart model and palette; keep them holding)

Phase 11a-2 left the Live display's one-page PDF and PowerPoint counting every visit as an iPad (Kroger: "34 answers from 5 iPads" where the screen said 4) and drawing plain bars,
and the leader report's results in its own words and the client's colour. This phase put the three files on the screen's chart model and palette and changed nothing else: not the
lists, Setup, what is counted or stored, the CSV files, a request (the baselines did not move) or the participant page (byte for byte). The report is [RELEASE-11B.md](history/RELEASE-11B.md).
**None of it has been saved from the real site, opened in PowerPoint from there, or printed**: QA-TESTING.md items 167 to 170.

- **The one-pager is the Live display's chart, on paper** (`migration/src/lib/exports/resultsExport.js`): `buildReport` takes `chartOf(question, { names: null })` for each live question and
  `answerCounts` over them; the card is the headline, the question, "N answered", "N of M got it right first time" and the chart. **No name is in either file**: the model is made
  with no names. The PDF and the PowerPoint are still ONE layout of primitives (`rect`, `line`, `tick`, `text`, `image`), and still aim for one page with two or three cards
  across. The writers take their library (`pdfBytes(pages, report, { jsPDF })`, `pptxFile(pages, report, { PptxGenJS })`) so a node test writes and reads both files.
- **"N answers from M iPads" is `answersFrom(answerCounts(...))`, singular for one** ("1 answer from 1 iPad"), on the screen and in the files: the iPads that answered. The leader
  report counts everyone who opened the session, on purpose, and its last page says so (`LIVE_FILES_NOTE` in `lib/exports/leader-report.js`, after the rules and not one of them).
- **A chart on paper is `lib/results/results-chart-figure.js`** (`chartFigure`), shared by the one-pager and the leader report: it draws what the screen's charts draw (bars on white with
  gridlines at 0, 50 and 100%, the screen's order, the correct answer Dark Green with a tick and "Correct" in bold, the top choice blue with "Top choice", the rest the tint; a
  true-or-false split; a scale's columns against the tallest, every other band shaded, its average as a line; a ranking's places and support scores; the words that came up most) as
  neutral items each caller turns into its own (a text item is one line, `y` the top of its box). It counts nothing. A bar chart reports `breaks`, so the report can carry a long
  chart overleaf between two bars. Items carry a `role` (`bar`, `label`, `value`, `tag`, `rank`, `average` ...) that the tests read and the writers ignore.
- **Every colour of a chart on paper is read from `styles/results-tokens.css`** (`lib/results/results-palette.js` `readPalette` parses the file's text; the admin page imports it with
  `?raw` in `lib/results/results-palette-source.ts`, node reads it from disk in `scripts/results-palette-node.js`). A missing token is refused by name. `layoutReport` and
  `layoutLeaderReport` refuse to lay out without the palette. The client's colours stay in the one-pager's header and the report's structure (title band, rules, tiles, completion
  bars); D3 (the blues) is still VJR's to decide, and changing them is that one file.
- **The leader report's "Results by activity"** prints each question's `chart.headline` and `chart.gradedLine` (`chartOfQuestion` in `lib/exports/leader-report.js`: the chart model
  over the report's OWN counts, a graded question's first pick, no times and no names, so a report reads the same from either storage) and draws it with the figure. Every
  figure it printed before is still printed (the facts under each question, the bars' counts and shares, the points and average places); `COUNTING_RULES` are as they were and
  the oracle finds 0 differences. A ranking's bar value is "Support N · N pts". The correct answer's words are bold with a tick and "Correct" (it was "1887 (correct answer)").
- **Print**: `scripts/print-contrast.js` holds every word of a laid-out page to 4.5:1 against the fill under it and every meaningful mark to 3:1; a tint bar and a scale's light
  steps (the palette's 2:1, as on the screen) are listed with their ratios and must have their value written beside them. Nothing relies on colour alone: a test finds the tick and
  "Correct" beside every correct bar. The one-pager's header words are whichever of white and near-black reads better on the client's colour (a fixed threshold gave 3.7:1).
- **Mutations** (`npm run test:report:mutations`, 49): a mutation of a file other than `leader-report.js` names its file and the suites that hold it, and the broken copy is swapped
  in by a resolve hook (`scripts/mutation-redirect.mjs`), never written over the file. Add one when you add a rule of drawing or wording.
- **`PHASE_11B`** (`scripts/bundle-budget.js`): the participant page byte for byte (`participantSha256`, `f7fbfd67…`) and its Tailwind rules 11a's; the admin page at most
  12,000 B over 554,263 B. The next phase starts from `participantAfter`/`adminAfter`.
- **The PDF of the one-pager was Helvetica until Phase 13** (now Open Sans, embedded: see "Rules from Phase 13"; `pdfSafe` left in Phase 14): words in other scripts and emoji were left out of it; the PowerPoint keeps them. A comment written only in
  another script shows as empty quotation marks there. Known, and left (RELEASE-11B.md).
- **The release documents** name the branch `pms-11b` and say what changed since pms-e2fbfb6; RUNBOOK.md's note for the PCOE site has a ninth step, the files (QA items 167 to 170).

## Rules from Phase 12 (the local PCOE site and the approved UX fixes; keep them holding)

The local stand-in for PCOE is [LOCAL-SITE.md](LOCAL-SITE.md) (`npm run local:site -- --open`, `npm run test:local-site`, `npm run ux:shoot`); the review is
[UX-REVIEW.md](history/UX-REVIEW.md). Part 2 (branch `pms-12-fixes`) fixed F-01 to F-05, F-08, F-10, F-11, F-13 to F-15, F-17, F-20, F-24 and the font fallback, each test
first (`scripts/test-ux-12.js`, part of `npm test`). **Nothing of Part 2 has met the real site or a real device, and the heavy gates have not run.**

- **A poll is never a readiness blocker.** SharePoint stores the null Content writes for "not correct" as No, so a poll reads back with every answer `false`.
- **Open Sans stays embedded in every page** (VJR, 17 Oct 2026: the brand font on every device). `styles/fonts-fallback.css` (local Arial, measured overrides) is
  second in `--font-sans` so nothing moves while Open Sans decodes; its figures are held by `scripts/test-ux-12.js`.
- The wall says only how many answers could not be counted (`wallUnreadableNotice`); the admin view keeps the full notice.
- Confetti is cleared through `effects.ts` `clearEffects()` when an activity opens.
- **`PHASE_12`** (`scripts/bundle-budget.js`): participant +269 B, admin +340 B gzip over 11b (allowances 600 and 1,000); the next phase starts from its `*After`.
- F-16 (the staff-mode warning twice) is kept on purpose (Phase 9b, DI-1).

## Rules from Phase 13 (the Results files redesigned for leadership; keep them holding)

The brief is [EXPORT-DESIGN.md](history/EXPORT-DESIGN.md) (the brand and language guides' rules by page, the page maps, D3 to D5); the report is [RELEASE-13.md](history/RELEASE-13.md). **None of it
has been saved from the real site, opened in PowerPoint or Excel from there, projected or printed**: QA-TESTING.md items 171 to 176.

- **Every file opens with the answer, from one model.** `lib/results/export-summary.js` (`summarizeActivity`, `summarizeSession`, `scoreboardOf`) is each activity's takeaway, made of
  the chart model's own words and numbers by a rule (the average right first time and the most missed graded question; else the clearest single leader; else a tie, a
  ranking, the comments), with "Only N answers." under `FEW_ANSWERS` (5, in `results-chart-model.js` with `numberWords`: one to nine in words). It counts nothing; a test holds
  every number in a takeaway to the question it names. The leader report, the pack and the summary CSV print the same sentences.
- **The leader report's page 1 is "At a glance" and never needs a second page** (four tiles, one takeaway per activity, the hardest and easiest question, "How to read this
  report"; a list too long ends "And N more activities, each on its own pages."). Each activity starts a page under a band (title, purpose, "N questions · N answers · N of M
  finished", takeaway); each question is ONE framed card (`role: 'card'`) that is never split unless it is longer than a page; a graded activity ends with its scoreboard. The
  client's colour is the title band only (`role: 'title-band'`); rules and marks are the palette's (Deloitte Green), words black and `#53565A`. "Answered by N of M." stays
  on every card: the oracle reads it. The PDF's language is set.
- **The Live display's Export PDF and Export PPT are the summary pack** (`migration/src/lib/exports/resultsExport.js`): one layout of 16:9 pages (`PACK_PAGE`, 297 x 167 mm) measured in the
  embedded Open Sans (`layoutReport(report, logo, palette, measure)`), drawn by two writers: the PDF puts each page in the middle of an A4 landscape sheet and embeds Open Sans
  (`pdfBytes(..., { jsPDF, fonts })`), the PowerPoint is 16:9 native text and shapes with speaker notes (`page.notes`). Page 1 is the summary only; then each live activity.
  **No word under 12 pt; titles 28, takeaways and headlines 18.** Four cards a page is the MOST (at these sizes taller charts fit two); a row that does not fit goes to the next
  page; a card too tall for an empty page is laid out compact; nothing but the footer goes below `PACK_BODY_BOTTOM`. No name anywhere; the wall's unreadable notice on page 1.
- **Summary by activity (CSV)** (`summaryRows`, `resultsToCsv`, `summaryCsvFile`, `downloadCsv(results, { name })`) replaced the eight-column Live display CSV: `SUMMARY_COLUMNS` in
  reading order, numbers as numbers (whole shares, the screen's), ISO date, the headline once per question, comments last with no name, cells by `csvCell`. The Live display's
  Export CSV and the Results card's button save the same file. **All answers (CSV)** is the old "Participant answers (CSV)", its `CSV_COLUMNS` unchanged.
- **`PHASE_13`** (`scripts/bundle-budget.js`): the participant page byte for byte (`participantSha256`, the deployed pms-d19bd14 page's), the admin page at most 12,000 B
  over 12's. The next phase starts from its `*After`.
- **On this Windows checkout, write JavaScript with backslashes or newline escapes through a file or the editor**, never through `node -e` or a heredoc: the escapes arrive
  changed (Phase 9a already said so of `\uXXXX`); `node --check` the file after.

## Rules from Phase 14 (structure and documents; keep them holding)

A change in structure only: the three pages were proved byte for byte the earlier build's after each step, and the gates matched the untouched branch.
The report is [RELEASE-14.md](../RELEASE-14.md); what was removed, moved and kept, with the evidence, is [CLEANUP-LOG.md](../CLEANUP-LOG.md).

- **The modules are in folders by module** under `migration/src/lib/` (`data`, `schema`, `settings`, `participant`, `common`, `admin`, `results`,
  `exports`, `brand`, `effects`, `setup`), and the shared modules that were in `public/js` and `public/css` are among them
  (`lib/data/dataService.js`, `lib/schema/`, `lib/exports/resultsExport.js`, `lib/brand/branding.js` and `assets.js`, `styles/legacy/`). No file sits at
  `lib/`'s top, and **every module starts with a header** saying what it owns, what it reads and writes, and what it must not do
  (`scripts/test-module-headers.js`). A new module goes in its folder with a header; then `npm run docs:modules`.
- **A check that walks `migration/src`** now also sees the modules that were in `public/js`. Each such check keeps the reach it had and names what it
  leaves out, with the reason (the data layer fetches and saves by design; `branding.js`, `resultsExport.js` and `styles/legacy/app.css` still say
  "Pursuits CEC", which is left for VJR to decide). A scan of a folder recurses: one that did not would read fewer files after a move and pass quietly.
- **A move is proved by the build**: build with the baseline's name (`PMS_BUILD_ID=pms-<commit>`) and compare the three pages with the baseline package byte
  for byte. A comment inside a Svelte `<style>` block and a thrown message ship in the pages: a path in one is a byte of the page.
- **A record is not rewritten**: `docs/history/`, the request baselines and the schema snapshot of 10c-2b
  (`scripts/schema-baseline/schema-before-10c2b.json`) say what was; `scripts/schema-snapshot.js` follows a moved file only where the tree has nothing at
  the old place.
- **The documents name only what is there**: `scripts/check-docs.js` (in `npm test`, and `npm run docs:check`) fails on a path, link, anchor, npm script
  or list title in a document that the repository does not have; what a document names on purpose although it is gone is in its `GONE` list, with why.
  `docs/MODULES.md` (`npm run docs:modules`), `docs/project-map.json` (`npm run docs:project-map`), `SHAREPOINT-LISTS.md` and the lists at a glance in
  `docs/SHAREPOINT.md` (`npm run build:lists-reference`) are generated, and a test fails when one is stale.
- **Where things are said**: [CLAUDE.md](../CLAUDE.md) is the short version for agents (`AGENTS.md` points to it); [DECISIONS.md](DECISIONS.md) holds what
  binds, one line each, with what enforces it; this file the detail; [HISTORY.md](HISTORY.md) the phases. Say a fact once and link to it.
- **The release documents** name the branch `pms-14` and say what changed since pms-757be5c; RUNBOOK.md's PCOE note has a tenth step, the smoke test
  (QA items 177 to 181).
- **Found, and left:** see CLEANUP-LOG.md, "Found, and left" and "Proposed, not done".

## Before finishing a change

- Always: `npm run check:svelte` and `npm test` (the documents, the module map and the project map among it). If you added, moved or renamed a
  module or a file a document names: `npm run docs:modules`, `npm run docs:project-map`, and `npm run docs:check` (see "Rules from Phase 14").
- If you touched session/track/response flow: run `npm test`.
- If you touched `migration/src/lib/data/dataService.js`: all of it is in the participant page, and every mocked suite sends its requests through it, so also run
  `npm run test:bundle`, `npm run test:baseline` and `npm run test:migration`. If you removed or changed a test on purpose, or changed on purpose what the code sends, see `--amend`, `--code` and `--explain` under `npm run test:baseline`.
- If you touched how a page starts, its settings, a `PMS_` build value, or anything in `migration/src/lib/data/dataService.js` that builds an address or spells a list
  title: run `npm run test:settings`, `npm run test:namespace`, `npm run test:baseline` and `npm run test:bundle` (the participant page has no allowance of its own
  to spend: it may not grow beyond where the newest phase left it, `PHASE_10J`), then `settings-file.spec.ts`, `setup-deployment.spec.ts` and `request-baseline.spec.ts` in
  all three engines.
- If you touched what the participant page reads or writes, when it reads it, or what a screen waits for (`lib/participant/boot.js`, `lib/participant/activity-content.js`, `experience.svelte.ts`,
  `participantData.ts`, `answer-store.js`, `App.svelte`, `Welcome.svelte`, `Agenda.svelte`, `ActivityPager.svelte`, or a participant path of `migration/src/lib/data/dataService.js`): run
  `node --test scripts/test-participant-waits.js` and read its table; a moment that takes another round needs a reason (see "Rules from Phase 10j").
- If you added or changed an item read (in `migration/src/lib/data/dataService.js`, or anywhere under `migration/src`): it must name its columns, through `selectOf` (see "Rules from Phase 10h"); run
  `node --test scripts/test-named-reads.js`, `npm run test:baseline` and `npm run test:namespace`, and the strict mock will refuse it in every suite if it does not.
- If you touched `spHttp`'s reading of a refusal, or a caller of 409: run `node --test scripts/test-duplicates.js` and `npm test`.
- If you named a new column, or renamed one: no column may be named like a SharePoint list-item property (`npm run test:schema` lists them); a rename is a new `VERSION`, an entry in
  `RETIRED`, and Setup's plan, Create and Mark ready bring an older site up (`node --test scripts/test-schema-upgrade.js`); the request baselines follow it by translation, never by a
  new recording (see "Rules from Phase 10i").
- If you touched a sentence a page shows that names a list: take the title from `sharePointListTitles()` (or `listTitles()` on Setup), never spell it; run
  `node --test scripts/test-shown-names.js`.
- If you touched `migration/src/lib/results/results-chart-model.js`, `admin/charts/`, `styles/results-tokens.css`, `LiveDisplay.svelte` or `AdminResults.svelte`: run `npm run test:charts`,
  `npm run test:bundle` (the participant page's Tailwind rules) and the `results-charts-*` and `live-display*` specs in all three engines, and look at `test-results/charts/`.
- If you touched any `server/data/*.json` by hand: run `npm run validate:data`.
- If you touched Setup's plan, Create, Mark the site as ready, Add an admin, the seed-file import or the fake's site building: run `npm run test:provision`,
  `npm run test:baseline`, `npm run test:namespace` and `npm run test:bundle`, then `setup-provision.spec.ts` and `setup.spec.ts` in all three engines, and see
  "Rules from Phase 10c-3".
- If you touched a list or a column: change `migration/src/lib/schema/pms-schema.js` and `pms-schema-meta.js` together, run `npm run build:lists-reference`,
  `npm run test:schema`, `npm run test:baseline` and `npm run test:bundle` (the participant page carries `pms-schema.js`), and see "Rules from Phase 10c-2b".
- If you touched the sample pictures, `lib/setup/sample-seed.js`, `lib/setup/sample-clients.js` or Setup's seed: run `npm run test:sample-pictures`, `npm run test:baseline`,
  `npm run test:namespace` and `npm run test:bundle`, then `sample-pictures.spec.ts`, `setup.spec.ts` and `brand-studio.spec.ts`.
- If you touched the release package, its documents or the permissions: run `npm run test:release-package`, then `npm run package:release` and
  `npm run test:rehearsal` on a committed tree.
- If you touched Brand Studio, a picture slot, `HeroPlate`, `AppShell`, `theme.js`, `client-theme.js` or section 7 of `dataService.js`: run
  `npm run test:brand` and `npm run test:migration`, and look at the screenshots `brand-*.png` in `test-results/admin/`.
- If you touched the leader report, its fonts or the participant CSV: run `npm run test:report`, `npm run test:report:mutations`,
  `npm run test:bundle` and `npm run test:migration`, and look at the pictures in `test-results/report/`.
- If you touched `migration/src/lib/exports/resultsExport.js`, `lib/results/results-chart-figure.js`, `lib/results/results-palette*.{js,ts}` or the report's results section: run `npm run test:report` (it holds the
  one-pager and the report's charts), `npm run test:report:mutations`, `npm run test:charts`, `npm run oracle -- --seeds 500` and `npm run test:bundle`, and LOOK at the pages
  (`npm run look:exports` renders every export, in greyscale too; `scripts/render-pdf-pages.js` renders any PDF; see "Rules from Phase 11b" and "Rules from Phase 13").
- If you touched any markup or CSS a person sees, a focus rule, a heading, a colour or a screen change in `migration/`: run `npm run test:a11y` (axe must find
  nothing: fix it, do not waive it) and `npm run test:devices`, and look at `test-results/a11y/reflow/` and `test-results/devices/`. If you touched an HTML shell,
  `src/unsupported/`, an entry's imports or the Vite configs: run `npm run test:unsupported`, `npm run test:bundle` and look at `test-results/unsupported/`.
- If you touched `migration/`: run `npm run check:svelte`, `npm run test:foundation` and
  `npm run test:migration`; after changing a component, tokens or `app.css`, also
  `npm run test:styleguide` and look at the screenshots it writes.
- For UI/UX changes, check [QA-TESTING.md](../QA-TESTING.md) for the relevant manual
  checklist section (kiosk behavior, offline/reconnect, simultaneous-client merge, etc.) —
  most of this can't be caught by automated tests.
