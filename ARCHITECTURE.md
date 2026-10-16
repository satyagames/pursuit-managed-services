# Pursuits CEC: Architecture

> **This document describes the legacy app**, which left this branch in Phase 10c-1 and is kept only in the local tag `legacy-final`. Its entity model and its description of the local server and API are still right; the client side it describes (`public/js/app.js`, the screens, the legacy build) is history. It is replaced in Phase 10e. The current architecture is `ARCHITECTURE-10.md` (in git history at `7347c72`), and what the clean break removed is `CLEAN-BREAK-10C1.md` (in git history at `7347c72`).

An interactive, client-facing presentation that runs in Safari on an iPad. Vanilla
HTML, CSS and JavaScript (ES modules, no build step for local development), Chart.js for 2D charts, and
Three.js later. Local development uses Express and JSON files; deployed pages use
same-origin SharePoint REST and the browser's existing authenticated session.

## 1. Data flow

```
iPad (Safari)
  screens: public/screens/*, public/js/screens/*
      │  import { getSection, listQuestions, saveResponse, … }
      ▼
public/js/dataService.js ────── the only code that talks to a backend
      │  HTTP + JSON
      ▼
LOCAL:  Express API (server/, /api/*)            ──▶  JSON files (server/data/*.json)
HOSTED: SharePoint REST (site/_api/*)            ──▶  SharePoint lists
```

Screens ask dataService for domain objects and render them. dataService makes the
HTTP calls, joins related records by ID and returns plain objects. The Express
server does two separate jobs: it serves `public/` as static files, and it is a thin
JSON store (read, create, merge-update, delete) over `server/data/`. Both can be
replaced. `public/` is self-contained (Chart.js is copied into `public/vendor`
instead of being served from `node_modules`), so any static host can serve it. The
store is the part SharePoint replaces.

`npm run build` uses esbuild and an HTML parser to package `public/` as three
self-contained files: `build/index.html`, `build/admin.html`, and `build/setup.html`.
There are no deployment subfolders. JavaScript imports, CSS, screen templates,
export libraries and starter media are embedded; data and uploaded logos remain
in SharePoint. `assets.js` resolves embedded static assets with a normal source-file
fallback for local development. Static-asset reads are not backend calls. No private
seed data or participant records are embedded. `npm run test:build` checks packaging.

## 2. Why dataService.js is the single swap point

- **Screens never call `fetch()`** and never see a URL. Only dataService.js knows a
  backend exists, so the migration touches one file.
- **Its exports are the contract.** Names, arguments and return shapes stay the same
  whatever the backend: records are plain objects with a string `id`, `get*(id)`
  resolves to `null` for a missing record, and other failures throw.
- **The backend code is kept to one part of the file.** dataService.js has two parts. The
  *backend adapter* holds every URL and HTTP call: a `send()` transport, the
  operations a SharePoint list offers (get an item, get items by ID, query by field,
  list, create, merge-update, delete), a merge-update that only applies if the item
  is unchanged since it was read (`updateItemIfUnchanged`), and the theme and
  responses reads and writes. The *public API*, which screens import, is built only
  on that adapter. The migration rewrites the adapter; the public API and the
  screens stay as they are.
- **SharePoint adapter:** for the legacy pages, `public/config.js` enables `CEC_SHAREPOINT` only on the
  approved SharePoint origin. (The Svelte pages do not read that file since Phase 10b: each works out its
  site and its lists as it starts and calls `configure({ sharePoint })`; see SHAREPOINT-DEPLOYMENT.md,
  "Which site and which lists".) `dataService.js` translates the existing logical API
  operations to SharePoint REST, maps an explicit column allowlist, follows pagination,
  and obtains/caches the request digest for writes. It uses the browser's existing
  sign-in, not MSAL, app-only tokens or a separate server. AppId is required, indexed
  and unique on every list. Conditional MERGE/DELETE use native ETags; response and
  theme writes reread/retry conflicts, including first-item creation races. QR claims
  retain the caller's original ETag so only one claimant wins.
  `configure({ baseUrl })` selects local API mode for tests. An explicit
  `configure({ sharePoint: { siteUrl } })` selects direct REST. Production loads config
  before the entry modules, so no screen needs to configure its own backend.
- **Setup:** `setup.html` checks schema, then explicitly imports missing starter records
  through dataService. The seed is exported locally through store.js and never included
  in the static build. No participant history is imported. PIN gating is unchanged;
  SharePoint permissions determine actual read/write authority, not the PIN screen.

## 3. Entities and relationships

```
sessions ──sectionIds[]──▶ sections ──questionIds[]──▶ questions ──optionIds[]──▶ options
appsettings: singleton; activeSessionId ──▶ sessions
visitorroster: sessionId ──▶ sessions; one QR invitation per visitor

tracks: one per iPad; the id is the `clientTrackId`. A track points at its session,
        the session doesn't list its tracks (see "Sessions, client tracks and QR tokens")
  sessionId ──────────▶ sessions
  clientId  ──────────▶ clients
  visitorId ─────────▶ visitorroster (optional for visitor-mode tracks)

qrtokens: a one-time check-in code
  clientId ──▶ clients     sessionId ──▶ sessions     clientTrackId ──▶ tracks (once scanned)
  visitorId ──▶ visitorroster (optional; roster-linked single-use invitation)

uservisitlogs: one idempotent app-entry event per browser-tab session
  sessionId ──▶ sessions (optional)    visitorId ──▶ visitorroster (optional)
  trackId ──▶ tracks (optional)

responses: one blob per session, shared by all of its tracks
  sessionId ──────────▶ sessions
  responses[]: { questionId    ──▶ questions
                 clientId      ──▶ clients
                 clientTrackId ──▶ tracks
                 answer        ──▶ options (choice questions), or the value itself
                 timestamp }
```

- **Parents reference children by ID** in ordered arrays: `session.sectionIds`,
  `section.questionIds`, `question.optionIds`. Array order is presentation order,
  and a child can be reused by several parents.
- **Responses store IDs, never text.** No question, option or section text is copied
  into `responses.json`. For a choice question, `answer` is an option ID (an array of
  IDs for multi-select); for free text or a rating it is the value itself.

  ```json
  [
    {
      "sessionId": "s-q3-review",
      "responses": [
        { "questionId": "q-priority", "clientId": "c-jlee", "clientTrackId": "6f1c…", "answer": "o-cloud", "timestamp": "2026-09-18T15:04:05.000Z" }
      ]
    }
  ]
  ```

- **dataService joins at render time.** `listQuestions(sectionId)` resolves
  `section.questionIds`. `getSectionContent(sectionId)` returns the section and its
  questions with joined options, using one read per list (plus pagination) instead
  of rereading each parent. Quiz screens load saved answers concurrently and reuse
  these reads when handing off to Feedback. No session data is cached.
  Screen HTML templates are cached in memory until page reload and cloned for each
  render; failed template loads can be retried. Agenda and quiz templates load in
  parallel with their data.
  `getSessionResults(sessionId)` fetches the session, its
  sections, questions and options (one request per list) plus its responses and
  tracks, and returns the joined tree with a `count` on each option (see "Live
  tally" below).
- `saveResponse(sessionId, questionId, answer)` adds the `clientId` and
  `clientTrackId` (set once per device with `setCurrentTrack()`) and the
  `timestamp`. A track's new answer to a question replaces its earlier one, so two
  iPads for the same client keep separate answers; anonymous answers (no track, no
  client) are appended.
- `saveResponses(sessionId, answers)` accepts `{ questionId, answer }` entries for
  a whole module. SharePoint merges them in one ETag-protected write, rereading and
  retrying on conflicts so other tracks' answers are retained. The local adapter
  uses the existing per-answer endpoint sequentially. Submit waits for successful
  persistence before navigating and ignores duplicate submissions while saving.
- **Other files:** `clients.json` (who answers; referenced by `clientId`),
  `tracks.json` (one record per iPad, see below),
  `qrtokens.json` (a token's `id` is the value encoded in its QR code),
  `adminusers.json` (PIN navigation gate, retained on SharePoint as AdminUsers;
  list permissions, not the PIN, control data access), `theme.json`
  (one settings object, not an array).
- **IDs are strings.** The server generates UUIDs; readable hand-written IDs such as
  `"q-priority"` work too.

### Since Phase 4: clients own activities, and each participant has one responses item

The sections above describe the model the legacy pages use, and it is all still true for them.
The Svelte app (`migration/`) adds to it; nothing above was changed.

```
appsettings: activeSessionId, activeClientId, activatedAt     "today": one client, one session
clients:     slug, theme { version, primary, accent, tokens, assets, copy }, themeVersion, status
sessions:    activityFlow ('sequential' | 'open')             id is <client slug>-<yyyy-mm-dd> when made by activateClient()
sections:    clientId ──▶ clients, description                 an activity belongs to one client
questions:   layout ('text-list' | 'image-grid')
options:     imageUrl
participantresponses: one item per participant                id = trackId
  { id, trackId ──▶ tracks, sessionId ──▶ sessions, clientId ──▶ clients,
    responses[]: { questionId, answer, firstAnswer, attempts, correct, answeredAt } }
```

- **Today's client.** `activateClient(clientId, date)` finds or creates that client's session
  for the day and points `appsettings` at it. A participant page reads AppSettings, then the
  Client, the Session and the client's Sections side by side, and shows that client's theme,
  copy and enabled activities, or "Today's experience isn't live yet" when there is none.
- **Answers, one item per participant.** The Svelte participant page writes each answer as it
  is given into the participant's own item: the first creates it (its id is the track id, so
  it cannot be created twice) and every later one overwrites `responses` in a single request.
  `firstAnswer` and `correct` record the FIRST try, which is what results count. The session's
  shared blob above is no longer written by the Svelte page.
- **One reader for both.** `readSessionResponses(sessionId)` returns
  `{ questionId, clientId, clientTrackId, answer, firstAnswer, finalAnswer, attempts, correct, timestamp }`
  from the per-participant items and the shared blob together (`answer` is the one that counts).
  `getSessionResults(id, { everyShape: true })` tallies from it; without the option it reads
  the blob alone, as the legacy pages need. On SharePoint both shapes are items of the one
  Responses list (a participant item has `TrackId`; the shared item's `AppId` is the session id).

## Local API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | Empty `200` |
| GET | `/api/:list` | All items. `?field=value` filters; repeat a field to match any of several values (`?id=a&id=b`) |
| GET | `/api/:list/:id` | One item, or `404` |
| POST | `/api/:list` | Create. `id` is generated unless supplied (`409` if taken); `201` |
| PATCH | `/api/:list/:id` | Merge fields into the item; `id` can't change |
| DELETE | `/api/:list/:id` | `204` |
| GET | `/api/responses/:sessionId` | The session's blob (empty until the first answer) |
| POST | `/api/responses/:sessionId` | Save one answer: `{ questionId, clientId, clientTrackId, answer, timestamp }`. Replaces that track's earlier answer to the question |
| DELETE | `/api/responses/:sessionId?clientTrackId=…` | Remove one track's answers (an admin restart); repeat `&questionId=…` to remove only those. `{ "removed": n }` |
| GET | `/api/participantresponses/page?sessionId=…&top=…&skip=…` | One page of a session's per-participant items: `{ items, next }` (`next` is the following `skip`, or `null`). The items themselves are an ordinary `:list` (`GET ?id=<trackId>`, `POST` with `id` = the track id, `PATCH` to overwrite `responses`, `DELETE`) |
| GET, PATCH | `/api/theme` | Read the theme, or merge changes into it |
| POST | `/api/uploads/logo` | Store a logo: the raw image as the body, `Content-Type` `image/png`, `jpeg`, `gif`, `webp` or `svg+xml`, up to 1 MB, and the bytes must match the type. `201 { url }`, a file in `public/assets/images/clients/`. SVGs are served with a sandboxing CSP |
| GET | `/api/host` | `{ lanUrls }`: addresses the iPads can reach this server at (dev-server extra, for QR codes) |

`:list` is `clients`, `sessions`, `sections`, `questions`, `options`, `tracks`,
`qrtokens`, `adminusers`, `appsettings`, `visitorroster`, `uservisitlogs` or
`participantresponses`.
Errors come back as `{ "error": "…" }`.

- **ETag / `If-Match`.** `GET /api/:list/:id` sends an `ETag`. `PATCH` and `DELETE`
  honor an `If-Match` header and answer `412` if the item changed since that ETag
  was read. This is what makes a read-check-write safe when iPads race, such as two
  scanning the same QR code, and it is the local stand-in for SharePoint's ETag.

- Files are re-read on every request, so hand edits to `server/data/*.json` show up
  without a restart.
- Writes are serialized per file and atomic (temp file, then rename). Simultaneous
  answers from several iPads can't overwrite each other, and a crash can't leave
  half-written JSON.
- There is no authentication, and the server listens on the LAN so the iPad can
  reach it. Use it for development and demos only, and keep passwords and other
  secrets out of `adminusers.json`. Access control comes from Microsoft Entra ID /
  SharePoint permissions after the migration.

## Sessions, client tracks and QR tokens

**Tracks.** A session is the shared event; every iPad in it runs its own *client
track*, a record in `tracks.json`:

```json
{ "id": "6f1c…", "sessionId": "s-kroger-kickoff", "clientId": "c-kroger",
  "joinedVia": "qr", "qrTokenId": "5710…", "createdAt": "2026-09-18T15:25:00.000Z",
  "resumeCount": 1, "lastResumedAt": "…", "restartedAt": null, "restartSectionId": null }
```

Two iPads for the same client are two tracks. Progress isn't stored; it is derived
from a track's answers. A track points at its session (`tracks.sessionId`) and the
session doesn't list its tracks: creating a record can't clash with another iPad
joining at the same moment, while appending to a shared array could drop one of
them. `session.status` becomes `in-progress` when the first track joins and
`completed` when an admin ends the session.

**Live tally.** Every track writes into the session's one responses blob, and an
answer lands there the moment it is submitted; nothing waits for the other tracks to
finish. `getSessionResults()` computes the tally from that list on every read, so it
is current the instant any track saves and can't drift from the answers (a restart or
a hand edit shows on the next read). Per option it gives `count`; per question,
`respondents` (compare with `tracks.length`: "3 of 4 iPads answered"); and for
ranked-voting a Borda `score`; per option, `percent` (its share: `count` over
`respondents`, or for ranked-voting its `score` over all points awarded), so the charts
and the CSV export show the same numbers. The Master screen reads this. Admin → Sessions shows
the same data as "Live results".

**Resume.** Session state stays in memory, but the track id rides in the URL hash
(`#/quiz/sec-trivia?t=<clientTrackId>`), which `navigate()` maintains. On load,
`restoreSession()` in `app.js` acts on what the URL carries:

| URL | What happens |
|---|---|
| `#…?t=<track>` | `resumeClientTrack()` finds the track; the app carries on at the screen in the hash, with the track's saved answers filled in. Unknown track: Welcome, "we couldn't find your session". Session ended: Welcome, "this session has ended", and the id stays in the URL so a reopen makes a reload work again |
| `?qr=<token>` | `claimQrToken()` (below); on success the address becomes `#/agenda?t=<track>` |
| neither | Welcome |

A server outage during either lookup shows "Try again" and leaves the URL alone, so a
QR code isn't burned. On Welcome, the manual "Select Client" fallback starts a fresh
track, exactly as a scan would; if that client already has tracks in the session it
lists them to resume, next to "Start a new session".

**Restart.** Admin → Sessions → Restart… on a track calls
`restartClientTrack(id, { sectionId })`: it removes that track's answers to the
module's questions (or all of its answers), then stamps `restartedAt` and
`restartSectionId` on the track. Other tracks and their answers are untouched. Each
iPad watches its own track record (every 3 s, and at once when the page becomes
visible again): when `restartedAt` changes it jumps to the start of that module (the
Agenda if the module isn't live) with a notice, and if its track no longer exists it
returns to Welcome.

**QR tokens.** A code is provisioned, scanned once, and dies with its session:

```
unused ──scan──▶ used     (used: true, usedAt, clientTrackId)
unused ──session ends──▶ expired  (used: true, expiredAt)
```

- Admin → Clients → Generate QR calls `provisionQrToken(clientId)`, which creates
  `{ id, clientId, sessionId, used: false, … }` for the client's open session, and shows the
  code as a QR image (the vendored `lean-qr` library, drawn as SVG) and as the link it
  encodes, `qrUrl(id, base)` = `<base>/?qr=<id>`. `base` defaults to the admin page's own
  origin, or the server's LAN address when the page is open on `localhost`, and can be edited.
- `claimQrToken(id)` reads the token with its ETag, rejects it if it is unknown, used
  or expired, creates a fresh track, then marks the token used with an `If-Match`
  write. If another iPad got there first (`412`) it undoes its track and rejects, so
  of any number of simultaneous scans exactly one wins.
- A used code can't start another track. An iPad that reloads reconnects through the
  track id in its hash, or through Select Client and Resume, not by scanning again.
- `endSession()` marks every unscanned code of the session used and expired;
  `reopenSession()` doesn't revive them (provision new ones).
- Known gap: if the response to the final claim write is lost on Wi-Fi, the code is
  spent while the iPad never learned its track. The track exists, so Select Client
  then Resume picks it up.
- The Svelte participant page does not call `claimQrToken()`. It calls `openQrScan(id)`, which
  makes the same checks in the same order with the same answers, reads each record once, and
  hands back today's experience from those same reads (AGENTS.md, "Today's client decides
  everything"). What makes a code single-use is the same `If-Match` write. It also closes the
  gap above: a device whose claim was refused, or whose reply went missing, asks the code whose
  it is before deciding. `claimQrToken()` itself is unchanged and is what `app.js` calls.

## Layout

```
server/
  index.js            Express app: CORS, JSON bodies, /api, static public/
  api.js              REST endpoints
  store.js            JSON file reads and writes (per-file lock, atomic writes)
  data/               the JSON "database"
scripts/
  copy-vendor.js      runs on npm install: copies the ES modules of Chart.js and the
                      QR generator (lean-qr) into public/vendor
  validate-data.js    checks the references between the data files (npm run validate:data)
  test-sessions.js    integration test of tracks, tally, resume, restart, QR tokens (npm test)
public/
  index.html          client app shell and import map ('chart.js' → ./vendor/…)
  admin.html          facilitator page (see Admin screen); its import map has 'lean-qr'
  js/dataService.js   the only backend access
  js/app.js           hash router; holds the session and client track in memory, and
                      restores them from the URL on load
  js/resultsRenderer.js  draws one question's results (Chart.js today); the Master
                      screen's only door to the charts, see "Master / Results screen"
  js/branding.js      per-client brand (colors, logo, name) set as CSS variables on <html>, see "Branding"
  js/resultsExport.js CSV export of a session's results, plus the branded PDF and PPT one-pager
  js/screens/         per-screen logic: welcome, agenda, quiz-poll, feedback,
                      thank-you, master-results, plus _shared.js helpers and admin/
  screens/            per-screen markup, same names
  js/vfx.js, js/sfx.js  motion and sound for the client screens, see "Motion and sound"
  css/                app.css (client screens), vfx.css (motion + sound switch), admin.css
  assets/audio/       bg-loop.mp3 and the sfx-*.mp3 cues (silent placeholders, see its README)
  assets/images/
  vendor/             generated by npm install; not committed
```

## Client screens

`js/app.js` is a hash router with no framework. Each screen is a module in
`js/screens/` whose `render(container, { state, params, navigate, adoptTrack, clearTrack })`
builds its markup from `screens/<name>.html` (loaded by `loadTemplate()` in
`_shared.js`, the only `fetch()` in the screens, and it fetches markup, never data) and
gets all data from `dataService`.

| Route | Screen | Notes |
|---|---|---|
| `#/welcome` (default) | welcome | Branded like every screen (see "Branding"). A scanned QR code is claimed before this screen renders. The "Select Client" dropdown is the manual fallback: it starts a fresh client track in that client's open session, as a scan would, or lists the client's existing tracks to resume. Shows why a code or track was refused |
| `#/agenda` | agenda | The session's sections with `enabled === true`, sorted by `order`. A section is marked complete once this client track has answered every one of its questions. "I'm finished" appears when all are complete |
| `#/quiz/<sectionId>` | quiz-poll | Every question in the section on one page, with this track's saved answers filled in. Submit saves each answer with `saveResponse()`, then returns to the Agenda. A section made only of `open-text-feedback` questions renders `feedback.js` instead |
| `#/thank-you` | thank-you | Reachable only when every section is complete. "Start over" lets go of the track (its answers stay in the results) |

- **Session state lives in memory, and the URL carries the way back.** `app.js` keeps
  `{ sessionId, clientId, clientTrackId }` in a plain object, not in localStorage. The
  track id is appended to every route as `?t=<clientTrackId>`, so a reload finds the
  same track and resumes it (see "Sessions, client tracks and QR tokens"). It later
  maps onto SharePoint session state. A screen that needs a session and has none
  redirects to Welcome.
- **The shell watches the track.** While a track is active, `app.js` reads its record
  every 3 s (and when the page becomes visible again) to react to an admin restart or
  removal; `showNotice()` puts a short banner over the current screen.
- **Answer shapes** saved by quiz-poll and feedback: an option ID for `single-select`,
  `true-false` and `confidence-continuum`; an array of option IDs for `multi-select`;
  an array of option IDs, best rank first, for `ranked-voting`; the trimmed text for
  `open-text-feedback`. `getSessionResults()` counts a ranked option once per answer
  (`count`) and also gives it a Borda `score` from the ranking.

## Admin screen

`/admin.html` is a separate page for the facilitator's own iPad. It shares only
`dataService.js` with the client app. Code lives in `public/js/screens/admin/`
(markup in `public/screens/admin/`, styles in `public/css/admin.css`).

- **Login** retains the PIN check against local `adminusers.json` or SharePoint
  AdminUsers.PinHash, mapped to the app's `pin` property. It carries a pure-JS SHA-256 because
  `crypto.subtle` doesn't exist on a plain-http LAN page.
- **Sections** toggles `section.enabled` through dataService. The client Agenda polls
  every 3 s and repaints on change. In production that is a SharePoint list update,
  read by the existing polling loop.
- **Content** is CRUD for questions and options. It keeps `section.questionIds`,
  `question.optionIds` and the child `sectionId`/`questionId` fields in step, with
  best-effort rollback on create. Run `npm run validate:data` after heavy editing.
- **Preview** renders the real `quiz-poll.js` screen (inert, in a shadow root with
  `app.css`) for any section, enabled or not, and writes nothing.
- **Clients** is CRUD for name, logo and colors, plus **Generate QR**: it creates a
  one-time check-in code for the client and shows it as a scannable QR image and as the
  link it encodes, with an editable address for the iPads, an Open link (to try a scan in
  another tab) and the client's recent codes with their status. Deleting a client that
  sessions, tracks, tokens, the theme or answers refer to is refused.
- **Sessions** shows every client track of every session with its live status (derived
  from its answers), how it joined and how often it resumed. **Restart…** sends one track
  back to the start of a module, or to the very beginning, and nothing is chosen by default.
  **End session** / **Reopen session** control the session's lifecycle, and **Live
  results** is the merged tally, the same data the Master screen reads.

A screen's `render()` may return a cleanup function; `app.js` runs it on navigation.

## Master / Results screen

`#/master-results/<sessionId>` (`js/screens/master-results.js`, markup in
`screens/master-results.html`) is the facilitator's live view for the big display. It
has no client track: it is about a session, and shows every question of the session's
enabled sections. Without an id it lists the sessions to choose from. Admin → Sessions
has a **Master screen** button on each session that opens it in a new tab.

> **Phase 7 (Svelte app):** this section describes the frozen legacy app. In the Svelte app the Master screen is the **Live display** in the
> admin page (Results, or Today's **Live display** button) with a Full screen view and the same CSV, PDF and PowerPoint exports; the participant
> page's `#/master-results/<id>` is only a notice that links to it, and no longer carries Chart.js, jsPDF or PptxGenJS. See MIGRATION-PLAN.md, Phase 7.

```
master-results.js ── getSessionResults() ──▶ dataService    fetch, merge, tally, percent
        │  polls every 2 s (skips a hidden page; first paint always runs)
        ├── renderResults(question, containerEl) ──▶ resultsRenderer.js ──▶ Chart.js
        └── downloadCsv(results) ──────────────────▶ resultsExport.js
```

- **The renderer is a seam.** `resultsRenderer.js` exports `renderResults(questionData,
  containerEl)` and `destroyResults(containerEl)`; the Master screen imports nothing
  else about drawing. `questionData` is one question of `getSessionResults()`, and the
  renderer computes nothing. A Three.js renderer will export the same two functions, and
  the switch is one changed `import` line in `master-results.js`. The contract, and what
  to keep out of the renderer, is in the comment block at the top of the file.
- **By type:** single-select, multi-select and true-false get an animated bar chart;
  confidence-continuum a segmented horizontal bar (each option's share, plus the average
  when the option values are numbers); ranked-voting horizontal bars sorted by Borda score,
  which slide to their new place when the order changes; open-text-feedback the comments.
  Calling `renderResults()` again for the same container updates it in place, which is
  what animates the change. Colors come from the CSS variables, so the client's branding applies.
- **Live update.** Polling `getSessionResults()` is the local stand-in for a push: the
  iPads are separate devices, so an in-memory event couldn't reach this page. In
  production a SharePoint webhook notification, or a timed refresh of the responses list,
  triggers the same refresh; only dataService changes. The screen hands the renderer only
  the questions whose data changed.
- **Export.** **Export CSV** re-reads the tally, then downloads
  `results-<sessionId>-<date>.csv`, one row per option: Section, Question, Type, Option,
  Count, Percentage, Score (ranked only), Respondents. Open-text comments are one row each,
  in the Option column. Text starting with `=`, `+`, `-` or `@` gets a leading apostrophe so
  Excel doesn't run an audience comment as a formula, and the file starts with a UTF-8 byte-order
  mark so Excel reads accents correctly. **Export PDF** and **Export PPT** make the same branded
  one-pager from the same tally: a header band in the client's primary color with its logo
  (on a white plate), name, session date and answer count, then a card per live question
  with its option table and bars (open-text: the first three comments). It is laid out once
  (`layoutReport()`: rectangles, text lines and images on A4 landscape, in mm) and drawn by
  a thin jsPDF or PptxGenJS writer, so the two files match. It aims for one page (it tries
  two and three cards across) and continues on more pages for a big session. Bars are drawn
  shapes, not chart images, so they stay sharp; the PPT shapes and text are editable. The
  libraries are the self-contained browser bundles (`public/vendor/jspdf`, `pptxgenjs`),
  loaded on the first export. The logo is drawn onto a canvas to get a PNG (it is often an
  SVG); if it can't be read (another site's image), the report goes out without it. The PDF's
  standard font is Latin-1 only, so emoji in comments are dropped there (the PPT keeps them).

## Branding

`js/branding.js` gives every screen the client's look without the screen doing anything.
On each route, `app.js` runs `loadBrand()` and `applyBrand()` before the screen builds,
which sets four custom properties on `<html>`: `--brand-primary`, `--brand-secondary`,
`--brand-logo-url` (`url("…")` or `none`) and `--brand-name` (a quoted string). CSS does the
rest: `.brand__logo` paints the logo as a background, `.brand__name::before` prints the
name, buttons, borders and the charts read the colors. A new screen needs only the markup
(`<span class="brand__logo">`, `<p class="brand__name">`).

- **Which client:** the iPad's own (its track), else the client of the session in the address
  (the Master screen), else `theme.clientId`.
- **Source:** that client's record in `clients.json`, which the admin edits, in full. A logo
  the admin clears stays cleared. `theme.json` only names the default client, and its own
  logo and colors apply when no client is found. Colors must be hex, or the default is used.
- **Fresh:** it is re-read on every route change, so an admin's edit shows on the next screen
  (a Master screen already open keeps its look until it is reopened).
- **Admin:** the client editor takes a logo URL or an uploaded image (PNG, JPEG, GIF, WebP,
  SVG, up to 1 MB) with a live preview, and the two colors. An upload goes to
  `POST /api/uploads/logo` and comes back as a URL to save in `logoUrl`.

## Motion and sound

Screens hold no animation or audio logic; they call two modules. Styles for the motion live
in `css/vfx.css` (linked after `app.css`, so it only adds to it).

- **`vfx.js`** — `enhanceQuestion({ fieldset, question, options, index })` (called by
  quiz-poll for every question) picks a variant with `variantFor()` and returns `{ sync() }`,
  which repaints the selection after an answer is set in code (a saved answer shown again).
  `staggerIn()` (Agenda's first paint) and `celebrate()` (Thank-you confetti) are the other exports.

  | Variant | Chosen when | Motion |
  |---|---|---|
  | `straight-talk` | `single-select`, section/question id contains `straight-talk`, or 5 ungraded options | options fan in; the pick locks in (fill + pulse) |
  | `confidence` | `confidence-continuum` | cool-to-warm scale fills to the chosen point, easing there |
  | `true-false` | `true-false` (two options) | a thumb slides between True and False |
  | `choice` | every other single/multi-select, trivia included | options glance in turn when the question scrolls into view |
  | `ranked` | `ranked-voting` | shared button feedback only |

  Every button and option tile also lifts on hover and presses on tap (CSS only), and
  `prefers-reduced-motion` turns the movement off.
- **`sfx.js`** — the background loop, the cues (`CUES` maps a cue name to a file in
  `assets/audio/`) and the iPhone-style **Sound** switch (top-right, added by `app.js`).
  **Everything is muted until the switch is turned on**; the choice lives in `sessionStorage`,
  so a reload of the tab keeps it and a new tab starts muted. Turning it on also "unlocks" every
  cue (iPad Safari only lets an element play later if a tap started it once), which is why the
  trivia verdict can sound after the network save. The switch and all sound are off on the
  Master screen. Cues: `click`/`hover` (any `.btn`/option, via document listeners; hover is
  mouse-only), `select`, `lockIn`, `scaleMove` (pitch rises with confidence), `submit` (after a
  successful save), `correct`/`incorrect` (one verdict per submit, only when a question's
  options carry `correct` flags: all right is `correct`), and `complete` (Thank-you).
  Replace a placeholder file by name and nothing else changes.

## Kiosk mode (iPad Safari)

Meant to be opened from **Add to Home Screen**, which runs it full screen with no Safari chrome.

- **Meta and manifest.** `index.html` and `admin.html` carry `apple-mobile-web-app-capable`,
  `viewport-fit=cover` and a status-bar style; `index.html` links `manifest.webmanifest`
  (`display: fullscreen`). There are no icons yet: add a 180×180 `apple-touch-icon` PNG for a proper
  home-screen icon.
- **Locking it down.** `app.css`/`admin.css` set `overscroll-behavior: none`, `touch-action: manipulation`
  (no double-tap zoom), no text selection or long-press callout outside text fields, and pad `#app` by
  the safe-area insets. `js/kiosk.js` stops pinch zoom and the long-press menu, since Safari ignores
  `user-scalable=no`. Form fields must stay at 16px or more, or iOS zooms the page on focus.
- **Touch targets** are at least 44×44 pt everywhere (the audit snippet is in QA-TESTING.md, section 7).
- **Failure handling.** `dataService.isUnreachable(error)` says whether a failure is the connection
  (offline, timeout, 5xx). In `app.js`: a screen that can't be built shows a retry screen, which retries
  itself every 5 s when the cause is the connection; a run of failed track polls shows a persistent
  "Can't reach the server" bar without touching the screen; an unhandled connection failure shows a
  notice. Each iPad handles this on its own, so one iPad's outage never affects another. The admin shows a
  retry box in place of a panel that failed to load.

## Running locally

```sh
npm install     # also copies Chart.js and the QR generator into public/vendor
npm run dev     # http://localhost:3000; restarts on server changes; prints the iPad (LAN) URL
npm test        # starts the server on a scratch copy of the data and runs the session logic
```

`curl -i http://localhost:3000/api/health` returns `200` with an empty body. Set
`PORT` or `DATA_DIR` to override the defaults. The import map needs iPadOS 16.4 or
later.

To try two iPads without a second device: open the client app in two browser tabs
and choose the same client in both (the second tab offers "Start a new session"), or
use Admin → Clients → Generate QR twice and open each link in its own tab. Admin →
Sessions → Live results shows the merged tally as each tab submits.
