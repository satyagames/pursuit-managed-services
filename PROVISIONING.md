# Pursuits CEC: SharePoint Online List Provisioning

> **Replaced (Phase 10c-2b).** The lists of the new site are described in [SHAREPOINT-LISTS.md](SHAREPOINT-LISTS.md), which is generated from the app's one schema file (`public/js/pms-schema.js` and `pms-schema-meta.js`), and Setup will create them (Phase 10c-3). What follows describes the old site and is kept as a record: do not create lists from it.

> **This document describes the lists of the old site**, under their old names and in their old shape. The new build goes to a new site whose lists have new names (`PMS` and a meaningful name) and one improved shape, and Setup will create them: this document is replaced in Phase 10c-3 (and the README in Phase 10e). The legacy pages it mentions left this branch in Phase 10c-1 and are kept only in the local tag `legacy-final`. **Since Phase 10c-2a the new build uses twelve of these lists, not thirteen:** it does not check, read or write `ThemeConfig`, it does not use the one-item-per-session row of `Responses` (only the one item per participant), and Setup has no step that assigns activities. Those passages below are the old site's.

For the site owner configuring lists used directly by the signed-in browser via SharePoint
REST. No Graph app registration, certificate, or external server is required. This mirrors
`server/data/*.json` field-for-field — see
ARCHITECTURE.md section 3 for what the fields mean and how records relate.

## Conventions used across every list

- **App-level IDs are not the SharePoint `ID` column.** SharePoint gives every item an
  auto-incrementing integer `ID`; the app's own string ids (`"c-kroger"`, `"sec-straight-talk"`,
  a QR token's value, a track's UUID) go in a column called **`AppId`** — Single line of
  text, **Indexed**, **Enforce unique values = Yes**, required (including ThemeConfig,
  AppSettings, VisitorRoster and UserVisitLogs).
  Every item lookup in the adapter filters on `AppId`, never on
  SharePoint's `ID`.
- **Ordered arrays and small nested objects are JSON text**, not SharePoint Lookup columns:
  `sectionIds`, `questionIds`, `optionIds`, `industryTags`, and the responses blob. This
  keeps insertion order (Lookup columns don't reliably preserve it), avoids the 12-lookup-
  column-per-list ceiling, and matches the "JSON blob in a multi-line text column" design
  the Responses list already called for. Column type: **Multiple lines of text, plain text**
  (not "Rich text" — rich text HTML-encodes the JSON and corrupts it).
- Disable Content Approval and attachments unless your site's governance requires them.
  Keep versioning/retention aligned with organizational policy. Disable append-only text
  on JSON columns: the adapter replaces their complete JSON value on each update.
- **Create columns with their final internal name from the start.** SharePoint derives a
  column's internal name from the display name you type at creation time; renaming the
  display name later does *not* change the internal name, so a typo now means the REST/Graph
  field name and the visible column name disagree. The adapter uses those internal names.
  Use the setup page to check them before import.
- The app fills the built-in Title column on creation. Do not add extra required columns.
- Approve list-level access before importing real data (see "Permissions" below).

## Lists

### Clients

| Column | Type | Notes |
|---|---|---|
| AppId | Single line of text, indexed | e.g. `c-kroger` |
| Name | Single line of text | |
| LogoUrl | Single line of text | See "Logo uploads" below — becomes a document library URL |
| PrimaryColor | Single line of text | Hex, e.g. `#0060A9` |
| SecondaryColor | Single line of text | Hex |
| CreatedAt | Date and Time | |

### Sessions

| Column | Type | Notes |
|---|---|---|
| AppId | Single line of text, indexed | e.g. `s-kroger-kickoff` |
| ClientId | Single line of text, indexed | → Clients.AppId |
| SessionDate | Date and Time (date only) | `date` is a reserved-ish name in some tooling; call the column `SessionDate` |
| SectionIds | Multiple lines of text, plain | JSON array, ordered |
| ActiveSectionId | Single line of text | Optional |
| Status | Choice: `not-started`, `in-progress`, `completed` | |
| EndedAt | Date and Time | Optional |
| ParticipationMode | Choice: `staff`, `client-visit` | Optional for existing rows; missing values behave as `staff`; User Setup controls this per session |

### Sections

| Column | Type | Notes |
|---|---|---|
| AppId | Single line of text, indexed | |
| Title | Single line of text | |
| Order | Number | |
| Enabled | Yes/No | |
| IndustryTags | Multiple lines of text, plain | JSON array of strings |
| QuestionIds | Multiple lines of text, plain | JSON array, ordered |

### Questions

| Column | Type | Notes |
|---|---|---|
| AppId | Single line of text, indexed | |
| SectionId | Single line of text, indexed | |
| QuestionType | Choice: `single-select`, `multi-select`, `true-false`, `confidence-continuum`, `ranked-voting`, `open-text-feedback` | Named `QuestionType`, not `Type` — SharePoint reserves `ContentType` internals that collide with plain `Type` in some API surfaces |
| Prompt | Multiple lines of text, plain | |
| OptionIds | Multiple lines of text, plain | JSON array, ordered |
| Order | Number | |

### Options

| Column | Type | Notes |
|---|---|---|
| AppId | Single line of text, indexed | |
| QuestionId | Single line of text, indexed | |
| Label | Single line of text | |
| OptionValue | Single line of text | Named `OptionValue`, not `Value` (`Value` collides with an internal SharePoint field). Holds the value as text even when the app treats it as a number (confidence options: `"1"`, `"2"`, `"3"`) — the adapter coerces on read, same as it would coerce a JSON value today |
| Correct | Yes/No | Default No. The app only ever checks `=== true`, so "not applicable" and "false" collapsing into the same No is not a behavior change |

### Tracks

| Column | Type | Notes |
|---|---|---|
| AppId | Single line of text, indexed | The `clientTrackId`, a UUID |
| SessionId | Single line of text, indexed | |
| ClientId | Single line of text, indexed | |
| JoinedVia | Choice: `qr`, `manual` | |
| QrTokenId | Single line of text | Optional |
| VisitorId | Single line of text | Optional → VisitorRoster.AppId; set for an invited visitor |
| ParticipantName | Single line of text | Optional snapshot of the visitor's roster name at check-in |
| SharePointUserId | Single line of text | Optional numeric ID of the signed-in account for staff-mode visits; blank in Client Visit mode |
| CreatedAt | Date and Time | |
| ResumeCount | Number | |
| LastResumedAt | Date and Time | Optional |
| RestartedAt | Date and Time | Optional — iPads poll this to detect an admin restart |
| RestartSectionId | Single line of text | Optional |

### QRTokens

| Column | Type | Notes |
|---|---|---|
| AppId | Single line of text, indexed, **must allow the exact characters used when tokens are generated** | This value is literally the query-string parameter encoded in the printed QR code — keep it URL-safe (UUID or base62, no spaces/slashes) |
| ClientId | Single line of text, indexed | |
| SessionId | Single line of text, indexed | |
| Used | Yes/No | |
| CreatedAt | Date and Time | |
| UsedAt | Date and Time | Optional |
| ExpiredAt | Date and Time | Optional |
| ClientTrackId | Single line of text | Optional, set once scanned |
| VisitorId | Single line of text, indexed | Optional → VisitorRoster.AppId; present only for a visitor-specific code |

### AdminUsers

| Column | Type | Notes |
|---|---|---|
| AppId | Single line of text, indexed | |
| PinHash | Single line of text | SHA-256 PIN hash, never a raw PIN. Maps to the existing app property `pin`. Browser PIN gating is retained but is not authorization. |
| Name | Single line of text | |

### Responses (the old site: one item per session; since Phase 4 also one per participant, see below; since Phase 10c-2a the new build uses only the one per participant)

| Column | Type | Notes |
|---|---|---|
| AppId | Single line of text, indexed | Same value as SessionId — one row per session |
| SessionId | Single line of text, indexed | |
| ResponsesJson | Multiple lines of text, plain | JSON array of `{ questionId, clientId, clientTrackId, answer, timestamp }`. Every answer submitted rewrites this whole blob under `If-Match` (see ARCHITECTURE.md "Live tally") — at realistic event scale (a handful of iPads, tens of questions) this stays well under any SharePoint text-column size concern, but if a deployment ever runs many iPads through a very long question set, watch this column's size and split to one item per response if it gets close to the plain-text-column ceiling |

### ThemeConfig (single item; the old site only: the new build does not use it since Phase 10c-2a)

| Column | Type | Notes |
|---|---|---|
| AppId | Single line of text, indexed, unique, required | Always `"default"` — there is exactly one item in this list |
| ClientId | Single line of text | |
| LogoUrl | Single line of text | |
| PrimaryColor | Single line of text | |
| SecondaryColor | Single line of text | |
| FontFamily | Single line of text | |

### AppSettings (single item)

| Column | Type | Notes |
|---|---|---|
| AppId | Single line of text, indexed, unique, required | Always `default` |
| ActiveSessionId | Single line of text | Optional → Sessions.AppId; User Setup selects which one session participants can enter |

The admin creates this singleton through User Setup. It is site-wide; selecting a different active session changes what newly opened participant pages offer. Only one session is active for participant entry at a time, even if other sessions remain open in the Sessions list.

### VisitorRoster

| Column | Type | Notes |
|---|---|---|
| AppId | Single line of text, indexed, unique, required | Generated opaque roster ID; not the visitor's name |
| SessionId | Single line of text, indexed | → Sessions.AppId; used to filter the event roster |
| DisplayName | Single line of text | Name shown after that visitor's QR code is claimed |
| Enabled | Yes/No | Default Yes; disabling prevents an unclaimed visitor code from being claimed |

The Admin User Setup panel creates roster rows for one selected session. It does not import visitor rosters from the starter seed. A claimed track stores the roster ID and name snapshot for resume; used QR tokens remain single-use.

### UserVisitLogs

| Column | Type | Notes |
|---|---|---|
| AppId | Single line of text, indexed, unique, required | Per-tab visit key; retries do not create duplicate rows |
| SessionId | Single line of text, indexed | Optional → Sessions.AppId; used to query recent events by session |
| ClientId | Single line of text | Optional → Clients.AppId |
| Page | Single line of text | Initial entry surface, currently `participant` |
| EntryMode | Choice: `staff`, `client-visit` | How the participant was identified |
| SharePointUserId | Single line of text | Optional site user ID from `/_api/web/currentuser`; populated in Staff mode only |
| DisplayName | Single line of text | Signed-in account display name in Staff mode; blank in Client Visit mode |
| VisitorId | Single line of text | Optional → VisitorRoster.AppId |
| VisitorName | Single line of text | Visitor display-name snapshot in Client Visit mode; blank in Staff mode |
| TrackId | Single line of text | Optional → Tracks.AppId |
| VisitedAt | Date and Time | Client-observed timestamp for the UI; built-in Created/Author are SharePoint server metadata |

The app attempts one log row per browser-tab session and retries idempotently using AppId. This is operational visit history, not a compliance audit log. Do not use it to prove identity or access; SharePoint's built-in audit facilities are authoritative. Apply the organization's approved access, retention and privacy policy.

## Columns added for client scoping and per-participant responses (Phase 4)

Thirteen columns on seven of the lists above. **Create each one with exactly this internal
name and type, and do not make any of them required.** They are additive: nothing existing is
renamed or changed, and the legacy pages work whether or not these exist. The Setup page's
**Check Lists** names any that is missing or wrong, by internal name and type.

| List | Internal name | Type | Indexed | What it holds |
|---|---|---|---|---|
| Clients | `Slug` | Single line of text | no | Short name used in each day's session id, e.g. `dominos` |
| Clients | `ThemeJson` | Multiple lines of text, **plain text**, append-only off | no | The client's look and copy as JSON: `{ version, primary, accent, tokens, assets, copy }` |
| Clients | `ThemeVersion` | Number | no | Raised whenever `ThemeJson` is saved; read on every participant page load |
| Clients | `Status` | Choice: `active`, `archived` | no | An archived client cannot be made live and is shown to nobody |
| Sections | `ClientId` | Single line of text | **yes** | → Clients.AppId: the client the activity belongs to |
| Sections | `Description` | Multiple lines of text, **plain text**, append-only off | no | The one-line subtitle under the activity's title |
| Questions | `Layout` | Choice: `text-list`, `image-grid` | no | A–D pills, or a 2×2 grid of tiles |
| Options | `ImageUrl` | Single line of text | no | A tile's picture; empty shows the answer as text |
| Sessions | `ActivityFlow` | Choice: `sequential`, `open` | no | `sequential` (the default) locks each activity until the one before is finished |
| AppSettings | `ActiveClientId` | Single line of text | no | → Clients.AppId: today's client |
| AppSettings | `ActivatedAt` | Date and Time | no | When "Go live" was last pressed |
| Responses | `TrackId` | Single line of text | **yes** | → Tracks.AppId: whose answers the item holds |
| Responses | `ClientId` | Single line of text | no | → Clients.AppId |

Notes:

- A **Choice** column may be created as Single line of text instead: the app only writes those
  exact words, and the check accepts either. If it is a Choice, it must offer both values.
- The two **indexed** columns are what make the page's reads cheap (`Sections` by client,
  `Responses` by participant). Without the index they still work on a small list, and the check
  flags it.
- `ThemeJson` is about 700 characters for the sample clients. `Slug` must be unique per client
  (the app derives one from the name when it is empty).

### Responses now holds two kinds of item

| Kind | AppId | TrackId | Who writes it |
|---|---|---|---|
| The session's shared item (as before) | the session id | empty | The legacy pages; older data |
| One item per participant (new) | the participant's track id | the same track id | The Svelte participant page, only that participant's own device |

Each participant item's `ResponsesJson` is an array of
`{ questionId, answer, firstAnswer, attempts, correct, answeredAt }`. Its first answer creates
the item; every later answer overwrites `ResponsesJson` with one request and no version check.
**`AppId` must keep "Enforce unique values = Yes"**: it is what stops one participant ever
having two items. A written answer is limited to 1000 characters and the app refuses a record
over 60,000, so the column's 63,999-character limit is not reached (the largest realistic
record, 40 questions with 5 written answers at the limit, is about 32,500).

Participants need to **add and edit items in Responses** (they already did, for the shared
item). They need no new permission. Because every participant on a shared account can edit any
item in the list, the per-participant item is an efficiency measure, not an isolation boundary;
the note under "Permissions" below still holds.

## Logo uploads

Create a document library named `ClientLogos` (not a folder in Shared Documents).
The signed-in browser uploads PNG/JPEG/GIF/WebP files under 1 MB through REST and stores
their URLs. SVG upload is disabled in SharePoint mode. Participants need read access to
render logos; facilitators uploading them need add permission. Existing trusted assets in
the static build remain usable. A missing library does not block list/schema checks.

**Brand Studio (Phase 6)** stores each client's hero badge, logo and background in the same library, as flat
files named `<slug>-<slot>-<hash>.<ext>` (PNG, JPEG or WebP, at most 350 KB each; the browser crops and shrinks
them first), and writes their addresses into `Clients.ThemeJson`. No column was added. What it needs from the
library: the users who open the admin page must be able to **add files** (`Files/add` with overwrite, into the
library's root folder) and **recycle** them (a replaced picture is moved to the Recycle Bin, best effort), and
every account that opens the participant page, including a firm iPad's signed-in account, must be able to
**read** them. If a picture cannot be read the participant page still works and shows its fallbacks (the name in
type on the plate, the gradient). None of this has been run against the real tenant; QA-TESTING.md section 9,
items 29 to 32, says what to check on the test site.

## Permissions

Use the existing signed-in user's SharePoint permissions. There are no app-only grants.
Have the site owner approve scoped access for participants and facilitators; see the
current [deployment guide](SHAREPOINT-DEPLOYMENT.md) for operations needed by each flow.
Participants need reads for AppSettings, the active session/client/content/theme, and
visitor roster when using client-visit mode; the existing Tracks/Responses/token
operations (add, edit and delete Tracks; add and edit Responses; edit QRTokens); and permission to add UserVisitLogs
items plus the list metadata reads the adapter requires. The Svelte participant page also tries to set
`Sessions.Status` to `in-progress` for a session's first participant and carries on if it may not (the legacy pages
require it). The deployment guide has the full table, list by list, and what such an account can do outside the app.
Participant logging does not read UserVisitLogs items. Facilitators
need UserVisitLogs read and User Setup/roster/session write access. Do not grant
participants update/delete rights to visitor roster or visit-log rows. The app's UI
controls are not authorization.
Do not expose AdminUsers to general site visitors: its hashes can be attacked offline.
The shared Responses item is not per-participant isolation, and PIN gating does not
prevent direct list access by a user who already has SharePoint write permission.

## Validate the schema

Upload the approved build, open its `setup.html`, then click **Check Lists**. This is
read-only. It checks all twelve lists (thirteen until Phase 10c-2a: `ThemeConfig` is no longer one of them), every internal column the app uses (the original
ones and the thirteen added in Phase 4), unique indexed AppId values, plain JSON text
types, and the types, indexes and choices of the added columns. Every problem is listed
under "What to fix" with the list, the internal column name, the type to create it as, and
what is wrong. It does not create columns, change permissions, or prove write access.
Refresh the page after changing a list.

Since Phase 9b it also lists, apart and under **Please check by eye**, what the strict check
does not test: the type of every other original column (for example `Enabled` or `Correct` made as
text, `SessionDate` as text, `Prompt` as a single line) and the indexes this document asks for on
`SessionId`, `QuestionId`, `SectionId` and the like, each as `Check: <list>.<column> is <found>,
expected <expected>.` These are **warnings**: every row can still say Ready, Go live is never
blocked by them, and nothing was seen against the real tenant (the mocked REST reports what the
test says it does). It also says when a list has a column called `Order0` or its own hidden
`Order`: SharePoint reserves the name `Order`, so a column you create with it is named `Order0`
inside SharePoint, and the app (which writes the field named `Order`) does not use it.

The other actions on that page each ask before they write:

- **Import Missing Records**: the private starter seed file, as before; never visitor roster
  or visit logs.
- **Seed sample clients**: creates Kroger and Domino's with their sample activities. It only
  creates what is missing. A record that already exists is never changed, except that a field
  which is empty and did not exist before Phase 4 (client, description, layout, theme, slug,
  status) is filled in. Run it as often as you like.
- **Run self-test** (**test site only**): creates one test participant item in Responses,
  updates it with a single write, reads it back by `TrackId`, checks that a second item with
  the same `AppId` is refused, lists it by session, reads two things in one `$batch` request,
  and deletes everything it made. It prints pass or fail and the number of requests for each
  step. This is the check that the real lists behave the way saving depends on; nothing else in
  the project can make it. The `$batch` step is what a QR scan relies on to reach Welcome in 8
  requests. If it alone fails, scanning still works (the page reads one by one, 14 requests):
  put `"batch": false` in the `pms-config.txt` beside the pages (or build with `PMS_BATCH=false`), so that
  the Svelte pages stop asking for a batch at all (13). (The sentence the self-test prints names this setting since Phase 10c-2a.) Since Phase 9b it also runs two **read-only probes** of this
  tenant, which only report (a refusal is a finding, not a failure of the self-test, and nothing is
  written): (1) a Yes/No filter written three ways on `QRTokens.Used` (`eq 'false'`, `eq 0`,
  `eq false`), saying which the site accepts. The app sends `eq 'false'` when it looks for codes
  nobody scanned (End session, Go live, disabling a guest), and until now only the mocked REST has
  seen it; (2) a `$filter` of 1,000, 1,500, 2,000, 2,500, 3,000 and 4,000 characters on the
  one-item AppSettings list, saying the longest the site answered. The app's own reads keep every
  address under 1,500 characters (groups of 20 ids), so this is what shows how much room there is.
  The probes are not run on the local server.
