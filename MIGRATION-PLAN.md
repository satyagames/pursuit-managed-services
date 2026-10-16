# Svelte Migration: Readiness and Execution Plan

> **Since Phase 10c-1 (2026-10-13) there is one app on this branch.** The legacy app this plan was written to migrate from has left it and is kept only in the local tag `legacy-final`; the new build goes to a new site with new lists. The sections below are the record of how the Svelte pages were built, phase by phase, and still say "legacy rollback" and "legacy compatibility" where that was true when they were written. The newest sections are "Phase 10c-1" and the ones just above it; the oldest material is at the end.

Reviewed against the working tree on 2026-10-09. This document supersedes the earlier chronological stage notes. It describes the current implementation, known gaps, and the order required to reach a release decision. It is not approval to deploy.

## Decision

Keep the legacy application as the release baseline. The Svelte implementation has participant, admin, setup, and results screens and a three-file candidate builder, but functionality and failure-path parity are not yet established. Resolve the code-level blockers below and add repeatable workflow tests before tenant staging or production cutover.

Migrating to Svelte does not itself reduce SharePoint REST response time. Until Phase 4 both implementations used the same read/merge/write Responses item per session; since Phase 4 the Svelte participant page stores answers one item per participant (next section) and the legacy pages still use the shared item. Performance acceptance must measure actual participant navigation and confirmed saves on the tenant, not framework choice or local build success.

## Phase 4 (2026-10-11): today's client and per-participant responses

What changed, and what it means for the legacy rollback. Detail is in [AGENTS.md](AGENTS.md) ("Svelte app conventions") and [PROVISIONING.md](PROVISIONING.md) ("Columns added for client scoping").

- **Additive schema.** Thirteen columns were added to seven existing lists (PROVISIONING.md). The adapter treats every one as optional: a list without them reads and writes exactly as before, and a write that needs a missing column fails by naming the column and its type. No list was renamed, no column changed, no record rewritten.
- **Today's client.** `activateClient(clientId, date)` finds or creates that client's session under a deterministic id (`<slug>-<yyyy-mm-dd>`) and sets `AppSettings.ActiveSessionId`, `ActiveClientId` and `ActivatedAt`. Since Phase 5 the admin's **Today** screen is the way to do it; the legacy User Setup "active session" selector still works but leaves a stale `ActiveClientId` (see Phase 5 findings), and the participant page then takes the client from the session only where `ActiveClientId` is empty.
- **Activities belong to a client** (`Sections.ClientId`). A participant sees the active client's enabled activities. Activities that have no client still follow the session that lists them, so a site that has not run Setup's "Assign existing activities to a client" keeps working; nothing assigns them automatically.
- **Responses: one item per participant.** `AppId` = the participant's track id (unique), `TrackId` (indexed), `SessionId`, `ClientId`, and `ResponsesJson` = an array of `{ questionId, answer, firstAnswer, attempts, correct, answeredAt }`. The first answer creates the item; every later save is one blind overwrite (`If-Match: *`), because only that participant's device writes it. The Svelte participant page no longer writes the session's shared item at all.
- **One reader.** `readSessionResponses(sessionId)` returns normalised answers from both shapes (one indexed query on SharePoint). The Svelte admin Results, live tally, restart, reference checks and the Master screen all read through it.

### Legacy compatibility: what the rollback can and cannot see

**The legacy app cannot read the per-participant items.** It reads and writes only the session's shared Responses item (`AppId` = session id), through `getSessionResponses`, `saveResponse(s)`, `getSessionResults` and `restartClientTrack`, all of which behave exactly as before. Consequences, if the legacy pages are ever put back in front of a session that the Svelte page has collected answers for:

| Legacy screen | What it shows for answers saved by the Svelte participant page |
| --- | --- |
| Master results and its CSV, PDF and PPT exports | Nothing: those participants look as if they have not answered |
| Admin Sessions ("N of M questions answered") | Zero for those participants |
| Admin restart of a track | Stamps the track, but the answers stay in the participant's own item |
| Admin delete of a question or client ("N recorded answers") | Does not count them |
| A participant resuming in the legacy page | Starts from no answers |

The answers themselves are not lost or altered: they stay in the Responses list, and the Svelte admin and Master screens read them. Going the other way is safe: the Svelte readers include everything the legacy pages wrote. A rollback mid-event therefore keeps collecting (into the shared item) but splits one session's results across two shapes that only the Svelte screens can show together. Roll back between events, not during one, or export results from the Svelte Master screen first.

Also not carried over: a visit that was in progress under the Phase 2 or 3 Svelte build (its answers are in the shared item) starts again from no answers in the Phase 4 page, because the page reads only the participant's own item. Its earlier answers remain visible to results.

### Verified here, and not verified

Everything in this phase was proven against the local Express adapter and against an in-memory SharePoint REST fake ([scripts/sharepoint-fake.js](scripts/sharepoint-fake.js)) that counts requests and injects 409, 412, 429 and 503. **Nothing was run against the real tenant.** The Setup page's self-test (create, single-write update, read by `TrackId`, duplicate create refused, list by session, two reads in one `$batch`, delete) is how the site owner checks the real list behaviour; see [QA-TESTING.md](QA-TESTING.md) section 9 for the full list of what is unverified.

## Phase 4 follow-ups (2026-10-11)

Four corrections from the Phase 4 review. None changes a list, a column or a stored record, and the legacy pages are untouched.

### The QR scan: 21 requests down to 8

The Kroger team arrives by QR code on firm iPads, so this is the main way in. In Phase 4 the Svelte page called the legacy `claimQrToken()` and then read today's experience again: 21 requests to the first screen, 25 for a session's first device. It now calls `openQrScan()`, a new function beside the old one. **`claimQrToken()` is unchanged, byte for byte, and remains what the legacy pages call** (`scripts/test-sessions.js` and `scripts/test-sharepoint.js` pass as before).

| # | Request, as Phase 4 sent it (a visitor's code, not the session's first device) | Why | Verdict | Now |
| --- | --- | --- | --- | --- |
| 1 | GET `/web/currentuser` | Who is signed in | Not needed: a visitor's track carries the visitor's name, never the account | Dropped for a visitor's code; for a staff code it rides in the batch |
| 2 | GET QRTokens (the code) | The code, its version | Needed | **1 request**, beside AppSettings and the write token |
| 3 | GET Sessions | Has the code's session ended? | Needed once | In the batch |
| 4 | GET AppSettings | Is that session the active one? | Needed once | **1 request** |
| 5 | GET VisitorRoster | Is the visitor still enabled; their name | Needed | In the batch |
| 6 | GET AppSettings | `joinSession()` checks again | Redundant: read at 4 | Dropped |
| 7 | GET Sessions | `joinSession()` checks again | Redundant: read at 3 | Dropped |
| 8 | GET Tracks (item type) | A new item must name its type | Needed once per page load | In the batch |
| 9 | GET Tracks `/fields` | Every column of the list, checked before any write | Redundant here: list metadata; a missing column is refused by SharePoint with its name | Dropped |
| 10 | POST `/contextinfo` | The write token | Needed once per page load | **1 request**, moved to the first round |
| 11 | POST Tracks | The visit's track | Needed | **1 request** |
| 12 | GET QRTokens | Find the code again, to write to it | Redundant: its item id came with 2 | Dropped |
| 13 | GET QRTokens (item type) | The type for the write | Redundant: it came with 2 | Dropped |
| 14 | GET QRTokens `/fields` | Every column of the list | Redundant: list metadata | Dropped |
| 15 | MERGE QRTokens, `If-Match` the version from 2 | **The claim. This is what makes a code single-use** | Needed, unchanged | **1 request** |
| 16 | GET AppSettings | `getLiveExperience()` | Redundant: read at 4 | Dropped |
| 17 | GET Clients | Today's client: name, theme | Needed | In the batch |
| 18 | GET Sessions | `getLiveExperience()` | Redundant: read at 3 | Dropped |
| 19 | GET Sections (ClientId) | The client's activities | Needed | In the batch |
| 20 | GET Questions | The first activity, so it opens at once | Needed | **1 request** |
| 21 | GET Options | The same | Needed | **1 request** |
| | *A session's first device, Phase 4:* GET Sessions, GET Sessions (item type), GET Sessions `/fields`, MERGE Sessions | Move the session to in-progress | Three reads redundant: the item, its type and its version came with 3 | **1 request**: the MERGE, `If-Match` the version read |
| | | | | POST `/$batch`: **1 request** carrying 3, 5, 8, 17 and 19 |

Before: 21, and 25 for the first device. After: **8, and 9 for the first device** (the ceilings asked for were 10 and 12). In four rounds: the code, AppSettings and the write token; the batch; the track beside the first activity's two reads; the claim. Measured in `scripts/test-participant-storage.js` and, in a real browser against the mock, in `scripts/migration-tests/sharepoint.spec.ts`. Ten devices on one account, 15 questions each, now take 371 requests (was 504); one whole visit in the browser 31 (was 47).

- **Single use is exact, and rests on the same one write** as before: a MERGE of the code that applies only if the code is still at the version it was read at. It is a plain request, never part of a batch. Proven with five devices claiming one code at once: one gets in, four get "already used" and leave no track. Repeated with an injected 412, 429 and 503 on the code, the track, the batch and the losers' clean-up; on the local server; and with five real browser pages.
- **`$batch` carries reads only, and nothing depends on it.** A part that fails is read again alone. A site that refuses the batch gets the same reads one by one (13 requests: the 12 that are the floor without a batch, and the refused one, once per page load; `batch: false` in `public/config.js` stops the page asking, 12). The Setup self-test has a step for it. What a batch saves for certain is round trips; whether SharePoint's throttling counts it as one request is not known (QA-TESTING.md section 9).
- **Two things are better than the legacy claim, on this path only.** A device that is refused, or never hears back, asks the code whose it is before deciding: its own write answered late is still its visit, where `claimQrToken()` would say "already used" about the device's own code (the known gap in ARCHITECTURE.md). And a device cut off mid-claim keeps its track in memory, so "Try again" on that page carries on rather than starting again. A full reload in that state behaves as the legacy does.
- **A refused or already-used code costs 7** (one more than before: the write token is asked for alongside the first reads, before the page knows it will not need it).
- Nothing is persisted: no data cache, and no new browser storage (the guard in the storage suite still passes unchanged).

### The accent no longer drives a control

Domino's accent `#E21737` used to fill "Click here to begin", Home, Next and Retry, nine degrees of hue from the fixed red of a wrong answer. Now every control fill comes from the client's **primary**, and `resolveClientTheme` derives them again on every load, so a theme stored under the old rule cannot bring the red buttons back. The accent colours two decorative things only, each only where it has 3:1 against what it is drawn on: the thin rule (against all three colours of the page gradient) and a ring on the white logo plate. For Domino's that is the ring; the rule stays white. Kroger has no accent and looks exactly as it did.

**Phase 6, Brand Studio, must warn when a chosen accent is within 30 degrees of the danger hue** (done: it warns, and warns about a primary that near the red too) (`isNearDangerHue()` in `migration/src/lib/theme.js`; `DANGER_HUE_MARGIN`). Both sample accents tried so far (`#E21737`, `#C8102E`) are. It must also say where the accent will and will not show: `deriveTheme()` reports that in `adjustments`. A client whose *primary* is red is a separate decision for that phase: nothing stops it today, and its controls would then be red too.

### Scripted heading focus

"Today's experience isn't live yet" showed a dark box: the page moves focus to the heading, the browser counted that as keyboard focus (no input had happened yet), and the general focus rule drew its halo. A heading focused by script now draws nothing for a pointer or touch user and the green ring for a keyboard user, on all four screens that do it (not-live, each question, activity complete, the finale), through one helper (`lib/focus.ts`) and one rule in `base.css`.

### Seed

Kroger's first answer reads "Kroger grocery and Baking co." (the mockup's "Banking" was a typo for the Kroger Grocery and Baking Company). Changed in `lib/sample-clients.js`, which the Setup page seeds from, and in `server/data`. **A site that was seeded before this keeps "Banking"**: seeding never changes an existing record. Correct it there in Admin → Content.

## Phase 5 (2026-10-11): the facilitator's Today and Clients screens

On the day of a client demo a facilitator opens Admin, picks the client and the date on one screen, presses **Go live**, and is told whether participants now see that client. Admins can also add, edit, archive and restore clients. Detail and the rules that must keep holding are in [AGENTS.md](AGENTS.md) ("Svelte app conventions"); the steps for a day are in [QA-TESTING.md](QA-TESTING.md) section 10, "Running a demo day". No SharePoint column was added (the thirteen from Phase 4 are the only ones), the legacy pages and `build/` are untouched, and `dataService.js` only grew.

### Where each capability of the old tabs went

| Old tab and capability | Now | Notes |
| --- | --- | --- |
| Sections: enable and disable, Preview | **Content** (Phase 5b; it was **Activities** in Phase 5) | See the Phase 5b map below |
| Content: questions, options, Preview | **Content** (Phase 5b: scoped by a client switcher) | See the Phase 5b map below |
| Clients: add, edit, logo upload, delete with reference protection | **Clients** | Adds slug, event title, subtitle, welcome line, archive and restore; delete is now also refused for a client that owns activities |
| Clients: the two colour pickers | **Clients → Edit → Results colours** (Phase 5b; it was a collapsed "Older colours" that read as an empty heading); since Phase 6 they are **Brand Studio → Colours** | The results display and its exports read the stored theme when there is one, and the older fields (which a Brand Studio save writes from the theme) otherwise |
| Clients: Generate QR (a code for an iPad, staff sign-in) | **Clients**, per row | Needs the client to be live: it says so and points to Today, where it used to pick an older open session on a site with no AppSettings |
| Sessions: each iPad, status, Restart..., live results, Master screen | **Results** | The same panel without End/Reopen |
| Sessions: End session, Reopen session | **Today → Controls** | Acts on the live session; a session that ended is reopened there, or from the readiness row, or from "All sessions" |
| User Setup: the active-session selector | **Today**: the client and date picker with Go live; **All sessions** for any session whose id is not `<slug>-<date>` | The old selector's `setActiveSession` leaves a stale `ActiveClientId` (see findings); `activateClient` and `activateSession` set the client too |
| User Setup: the staff / client-visit switch and its Save | **Today → Controls → How people are identified** | Applies at once; switching back to staff asks first because it retires unscanned guest codes |
| User Setup: roster, generate / show / replace / disable QR, QR image and link | **Guests and QR** | For the live session only: `provisionQrToken` refuses any other, as the old screen's Save did |
| User Setup: recent app entries | **Guests and QR** | |

**Two kinds of QR code, both reachable.** *Clients → Generate QR* makes a generic single-use code for an iPad in **staff sign-in** mode: no name, joins the live session. *Guests and QR → Generate QR* makes a named code for one guest in **guest** mode, and the participant page greets them by name. A session is in one mode at a time, so only one kind works for it; each screen says which when the other is asked for.

### What Today does

- **Status**: LIVE or NOT LIVE (with the reason in words), the client, date, session id, participants (tracks, read-only) and live since (`AppSettings.ActivatedAt`). It refreshes every 10 seconds, pauses while the tab is hidden, and a refresh that began before the facilitator acted is dropped.
- **Go live** is `activateClient(clientId, date)` and then one read of AppSettings; it says "Verified: participants now see <client>" only if that read names the session and the client. A double click is one call, and two admins end with one session and one AppSettings item (the session id is `<slug>-<date>` and `AppId` is unique).
- **Readiness**, before and after: blockers (Go live is disabled and says why) are an archived client, no live activity, a question with no answer options, a single-answer question flagged right or wrong with none right, a session for that date that has ended, and a missing or mis-typed SharePoint list or column. Warnings (shown, and Go live still works) are no logo or hero image, guest mode with no guests, one live activity, a live activity with no questions, another client's session on the date, a date that is not today, a missing index, and a schema check that could not run.
- **Switching** away from a client that has participants asks first, naming both clients and the count.
- Controls, the participant link with Copy and its QR image, Open participant view, Master screen, the notice for activities with no client (linking to the Setup assign step).

### What the confirmation tells the facilitator, and why it is true

It says: pages already open move on by themselves within about 10 seconds (each checks while it is on screen; a hidden one checks as soon as it comes back) and land on the new client's Welcome in its colours; anyone partway through an activity is taken out of it and starts again from Welcome; answers already saved stay in the old session and its results, nothing is deleted and that session is not ended (an answer given in the last moments, or while an iPad was offline, may not have been saved); and the old session's unscanned visitor codes stop working. Each clause is the participant page's behaviour, read from `App.svelte` (`watchTrack` every 10 s on SharePoint and 3 s locally, skipped while hidden, run again on `visibilitychange`; `followFacilitator` calls `clearTrack()` and goes to `/welcome`) and `activateClient` (it expires the codes), and held by a test that fails if those lines change. A browser test leaves a participant on a question, switches client, and sees them land on the new Welcome with the "facilitator changed the active session" notice, their saved answer still in the old session, that session still `in-progress`, and the unscanned code retired.

**One thing the participant page did NOT do in Phase 5, and Today said so:** an open page did not notice that a session was **ended**. It compared only AppSettings and its own track's session, which an End does not change. **Phase 7 changed this**: the look also reads the session, so an open page shows "This session has ended" by itself (see Phase 7). The wording of the status text and of the confirmation was updated with it.

### Request budgets, on SharePoint (the mocked REST; see "Not verified")

| Measure | Requests | Budget |
| --- | --- | --- |
| Today load, from the PIN (AdminUsers, then the write token and three `$batch` requests: AppSettings + Clients + Sessions + Sections; every list's columns; the picked client's questions and options with the live session's tracks) | **5** (Today itself 4) | 6 |
| Changing the picker | 1 | |
| A poll, every 10 s | **1** (one `$batch` of AppSettings, the live session and its tracks) | 2 |
| A poll that finds something else became live | 2 | 2 |
| A poll while the tab is hidden | 0 | |
| Go live, a client's first session of the day | **12** | |
| Go live, switching client (includes the check of who is live and how many) | 11 | |
| Go live, the same client and date again, through `goLive()` (the screen shows "Already live" and sends nothing) | 8, and no new session | |
| Today load where the site refuses `$batch` | about 24 | |

Go live's 12: `activateClient` reads the client, its activities and the session (3), makes the session (its list's two metadata reads and the POST), reads AppSettings three times and creates it (two metadata reads and the POST), then the one read-back. Two of those AppSettings reads are redundant inside `activateClient` (Phase 4 code that this phase did not change); the screen itself adds only the read-back.

### Findings along the way (none changes stored data)

- **`setActiveSession()` leaves a stale `ActiveClientId`.** On a site where Go live has been used once, the legacy User Setup selector (and `setActiveSession` generally) changes only `ActiveSessionId`; `getLiveExperience` then reads the old client, sees the session belongs to another, and the participant page shows "not live". The Svelte admin never calls it (Go live and `activateSession` set both). The legacy admin still does.
- **`provisionQrToken(clientId)` with no AppSettings at all** picks the client's older open session. The Clients screen now checks that the client is live first.
- **Admin page weight**: 134,271 B gzip -9 (was 82,087). Six Open Sans faces would add 61,784 B, over the 40 KB line, so the page inlines Regular, SemiBold and Bold only (30,644 B); the other 21 KB is the new screens. The participant page is 579,465 B (shared `dataService` additions) and setup 45,137 B.

### Verified here, and not verified

Proven in `scripts/test-admin-today.js` (rules and request counts against the mocked SharePoint REST and the local server), `admin-today.spec.ts` (the built pages against the real local server: create, pick, Go live, a second browser, the confirmation, double click and a parallel admin, every blocker and warning, archive and slugs, one test per moved capability, layout at 390, 820 and 1440, keyboard, screenshots in `test-results/admin/`), `admin-sharepoint.spec.ts` (budgets and the schema blockers in the built page against the fake) and `admin-smoke.spec.ts` (Chromium and WebKit). **Nothing ran against the real tenant.** What only the test site can show is listed in [QA-TESTING.md](QA-TESTING.md) section 9, items 16 to 20: above all that SharePoint accepts a `$batch` of thirteen `/fields` reads and lets this user read them, and the real request counts.

### Gate results at this commit

| Check | Result |
| --- | --- |
| `npm run check:svelte` | 0 errors, 0 warnings |
| `npm test` | 263 pass (222 before; 41 new in `test-admin-today.js`) |
| `npm run test:migration` | 193 pass (171 before): 22 new, one of them also on WebKit |
| `npm run test:styleguide` | 7 pass |
| `npm run test:build`, `npm run build`, `npm run build:svelte:release` | pass |

## Phase 5b (2026-10-11): Content by client, copying activities, guests and printing

A facilitator can build and edit each client's activities on their own, copy activities from one client to another, and set up named guests with personal QR codes that print. Detail and the rules that must keep holding are in [AGENTS.md](AGENTS.md) ("Svelte app conventions"); the steps for a day, now with guests and printing, are in [QA-TESTING.md](QA-TESTING.md) section 10. **No SharePoint column was added** (the thirteen from Phase 4 are all that is used), the legacy pages and `build/` are untouched, and `dataService.js` only grew (section 6, 14 new exports; the legacy app calls none of them, and a test says so).

### Where each capability of the old Activities and Content tabs went

The Activities tab is gone, after every capability was reachable in Content (each has a browser test: `admin-content.spec.ts`, "every capability of the old Activities tab is in Content", and the older tests in `participant.spec.ts`, with their selectors updated and none deleted).

| Old tab and capability | Now | Notes |
| --- | --- | --- |
| Activities: the list of activities with their question counts | **Content**: the selected client's activities on the left; **Unassigned activities** below for those with no client | Every activity is in exactly one of the two |
| Activities: the live switch (rolls back and says so when the write fails) | **Content**, on every row of both groups | Same code; creating, copying and assigning also join the live session's tally |
| Activities: Preview | **Content → Preview** on every row, and the Preview dialog's own Go live / Take offline | Now opens in the activity's client's colours (it did not before; see findings) |
| Activities: refresh every 4 s | **Content**: one read of the activities every 15 s while the tab is shown | Was 0.25 requests per second; now 0.07 |
| Content: the Activity picker | **Content**: click the activity on the left | |
| Content: add, edit, delete a question; all six types and their conversion; options (add, remove, reorder, correct); delete with a count of orphaned answers | **Content**, right pane | The editor is the same; it now also has Layout and each option's picture address |
| Content: Preview activity | **Content → Preview** on the row | |
| Setup: "Assign existing activities to a client" | **Content → Unassigned activities → Assign to client...**, and **Assign selected to client...** | The Setup step is unchanged and still works; Today's notice points to both |
| *(new)* | Add activity; Rename (name and description); Duplicate; Delete (counts answers); Move up and down; Layout and pictures; Copy from another client... | |

**Reordering uses `Sections.Order`, which already existed** (and `Questions.Order` for questions): no column was invented. Orders are per client; a move renumbers the client's list 1, 2, 3... and writes only the activities whose number changed.

### What it costs, on SharePoint (the mocked REST; `test-results/budget/admin-content-sharepoint.json`)

| Measure | Requests | Notes |
| --- | --- | --- |
| Content, from the PIN | **4** | AdminUsers, the write token, one `$batch` of AppSettings + Clients + Sections, one of the first activity's questions and options |
| Select another activity, or switch client | **1** each | One `$batch` of questions and options |
| Content refresh, every 15 s | **1** | One read of the activities; 0 while the tab is hidden |
| Copy 2 activities (6 questions, 24 options) to another client | **43**: 32 writes and 11 others | The 11: the client, its activities, the 2 list-metadata reads for each of the 3 lists (Options, Questions, Sections), the live-session check (2) and the screen's own refresh. About 1.3 s. Choosing the source costs 1 more (a batch) |
| Re-run after a failed copy, for the one activity that is missing | 31: 26 writes | Only what is missing is written |
| Guests and QR, from the PIN | **4** | |
| Add 10 pasted guests | **15**: 10 writes and 5 others | |
| **Generate all codes** for 12 guests | **18**: 12 writes and 6 others | The session check (one batch), the client, the roster and codes (one batch), the list's 2 metadata reads, and the refresh after. When nobody is missing a code the button is off, and Refresh is 1 request with no write |
| Print sheet | **2** | AppSettings, then one batch |
| Guests refresh, every 15 s | 1 (2 or more once a guest has joined) | Joined and Completed are read from the tracks and the answers |

**Pacing.** Bulk writes (`runPaced` in `dataService.js`) run **3 at a time with 120 ms between one lane's writes** on SharePoint (none locally); the adapter already waits out a 429 or 503 for as long as `Retry-After` asks (up to 30 s, 3 times); a run stops after 3 failures in a row (a copy after 2 activities in a row), and can be stopped by the facilitator. The browser test sees at most 3 requests in flight, and a copy of 32 records takes at least the spacing it should. Three lanes with 120 ms between writes is no more than about 25 writes a second even if the tenant answered at once; the whole copy of two activities is 43 requests, 1.4% of the 3,000 per 5 minutes.

**What "resumable" and "idempotent" mean here.** A copy writes each activity options first, then questions, then the activity record, so the activity appears whole or not at all, and a failure deletes what that activity wrote. A copy's ids come from its source's and the client's (`sec-trivia~c-dominos`), so a re-run skips an activity that is whole (by title, or by id after a rename) and writes the rest, over an orphan if a delete could not clean up. Generate all codes makes a code only for an enabled guest with no code that has not expired, so pressing it twice, or after a failure, makes only what is missing. **One thing it cannot prevent:** two admins pressing Generate all in the same second can each make a code for the same guest (a code's id is a secret, so it cannot be derived); the later code is the guest's, and the earlier one stays valid until it is replaced or the session ends.

### Findings along the way (none changes stored data)

- **The preview did not use the client's colours.** The admin page never applies a theme, so Preview drew every client in the standard blue. It now puts the activity's client's resolved theme on the preview frame; a test compares Domino's and Kroger's backgrounds and the unassigned look.
- **A preview closed quickly after "Go live" lost the update.** The dialog read its callbacks after an `await`, and a Svelte prop read after the component is gone throws, silently: the activity switched on but the list kept saying Off. It reads them first now. (This was in the Phase 4 and 5 code too.)
- **A save in the question pane followed the next click.** The pane read "the selected activity" at each step of a save, so picking another activity while a question was being written would have sent the rest of the write (the activity's list of questions) to that other activity. The pane now keeps the id it was opened with, and a test saves slowly and clicks away.
- **A new activity did not count in the live session's results.** Results are tallied over `session.sectionIds`, which only Go live fills, so an activity made while its client was live showed no results until the next Go live. Add, duplicate, copy and assign now join the live session, and delete leaves it.
- **A first test of the bulk code caught a bug of its own:** `results.some(...)` on a sparse array skips the gaps, so a stopped run looked finished. `runPaced` now returns a dense array.
- **Test uploads leaked into the repository.** The logo-upload test wrote real files to `public/assets/images/clients/` (four were found, 70 bytes each, and removed). The server takes `UPLOAD_DIR`, the browser tests use it, and `test-seeds.js` fails if a fixture client, guest or uploaded logo is in `server/data` or `public`. "Blocked Co" and "Draft Co" were never in the seed or the server data (they are created in each test's scratch copy); the tests that showed them now use ordinary sample names.
- **"Older colours" read as an empty heading**: it was a collapsed `<details>` with no marker. It is now "Results colours", always shown, with what the two colours do. The Clients intro no longer says colours "move to Brand Studio" (which does not exist yet); it says what is true: participant colours come from each client's stored theme (a new client starts with the standard blue) and cannot be changed in the admin yet.
- **Admin page weight**: 154,244 B gzip -9 (was 134,271), the Content, Guests and print screens. The participant page is 582,277 B (was 579,465, the shared `dataService` additions) and setup 49,129. The 400 KB participant target of the plan is Phase 7's.

### Verified here, and not verified

Proven in `scripts/test-admin-content.js` (the rules, and section 6 on the mocked SharePoint REST and on the local server, which leave the same records), `admin-content.spec.ts` and `admin-guests.spec.ts` (the built pages against the real local server: scoping, every activity action, delete protection, Layout and pictures through to the participant pager, Preview colours, unassigned and bulk assign, copy with skips and a failure and a re-run, bulk guests, Generate all, statuses from real answers, the print sheet at A4 and US Letter as DOM geometry and as Chromium's PDF, CSV, layout at 390, 820 and 1440, keyboard order and focus, screenshots in `test-results/admin/`) and `admin-content-sharepoint.spec.ts` (the budgets above, the QR address on SharePoint, and a smoke test on Chromium and WebKit). **Nothing ran against the real tenant, or on an iPad.** What only the test site and a real iPad can show is listed in [QA-TESTING.md](QA-TESTING.md) section 9, items 21 to 28: above all the throttling of bulk writes, `~` in copied ids, the length of a 20-id read inside a `$batch` part, iPadOS Safari's Print and Save as PDF, and whether a printed 32 mm QR code scans.

### Gate results at this commit

| Check | Result |
| --- | --- |
| `npm run check:svelte` | 0 errors, 0 warnings |
| `npm test` | 302 pass (263 before; 38 new in `test-admin-content.js`, 1 in `test-seeds.js` for the fixture guard) |
| `npm run test:migration` | 231 pass, 6 skipped (193 before): 38 new: 37 on Chromium (`admin-content` 17, `admin-guests` 13, `admin-content-sharepoint` 7) and 1 on WebKit (the smoke test); the 6 skipped are the Chromium-only budget tests under the WebKit project |
| `npm run test:styleguide` | 7 pass |
| `npm run test:build`, `npm run build`, `npm run build:svelte:release` (and `test:build:svelte:release`) | pass |

## Phase 6 (2026-10-11): Brand Studio

An administrator sets each client's colours, logo, hero art and background from **Clients → Brand**, sees them on the real participant screens at the real size of an iPhone, an iPad and a desktop window before anything goes live, and checks the saved look on a real iPad through a link. Detail and the rules that must keep holding are in [AGENTS.md](AGENTS.md) ("Svelte app conventions", the Brand Studio and Pictures bullets); the steps are in [QA-TESTING.md](QA-TESTING.md) section 10, "Setting up a new client's look". **No SharePoint column was added** (the thirteen from Phase 4 are all that is used: `ThemeJson` holds the pictures' addresses and the plate), the legacy pages and `build/` are untouched, and `dataService.js` only grew (section 7, two exports; the legacy app calls neither, and a test says so).

### What Brand Studio can do

| Capability | How |
| --- | --- |
| Colours | Primary (hex, picker, eight presets starting with the standard blue), optional accent, and a Light or Dark logo plate. Everything is derived with `deriveTheme`; the page shows the gradient, the contrast of every text and control pairing against its background, "adjusted for readability" with before and after and an Auto-fix, and warnings that never block: an accent or a primary within 30° of the wrong-answer red, a very light or dark primary, an accent that fails 3:1 where it is drawn, a logo whose pixels are mostly very light on the light plate (or very dark on the dark one) |
| Pictures | Hero badge 1200×1200 (300 KB), client logo 800×400 (150 KB), background 1536×2048 (350 KB) with a focal point; one `AssetUploader` that is also in Content for an answer tile (480×320, 60 KB). Specs, a safe-area guide and the limits are on each card. PNG, JPEG and WebP only, judged by the file's bytes; SVG, GIF, animated PNG/WebP, a truncated file, a non-picture and a file over 10 MB are refused in plain words. "Crop and fit" (pointer, wheel, slider, arrow keys); the result is exactly the slot's size, EXIF orientation applied, metadata gone. Compress to the cap: WebP first, PNG, then smaller in steps to 75% of the width, then it says what to do |
| Preview | The real `Welcome`, `Agenda`, `ActivityPager` and `ThankYou`, drawn from the unsaved draft, in a frame of the device's exact size (iPhone 390×844, iPad portrait 820×1180, iPad landscape 1180×820, desktop 1440×900), for Welcome, Activities, Question, Correct answer and Finale. Read-only |
| Save | Uploads the new pictures, writes the client once (theme at version + 1 with the tokens re-derived, `ThemeVersion`, the older `PrimaryColor`/`SecondaryColor` from the theme, `LogoUrl` from the logo), then removes the pictures it replaced. Revert, Reset to standard blue, Copy colours from another client, and a confirmation before leaving with unsaved changes or overwriting someone else's save |
| On a real iPad | `index.html?preview=<clientId>` shows that client's saved Welcome and read-only activities, marked Preview, whether or not it is live |
| Master and exports | Read the stored theme's colours when there is one, the older fields otherwise |

### Where each older capability went

| Was | Now |
| --- | --- |
| Clients → Edit → Logo (URL field and Upload) | Brand Studio → Client logo (a client's older `LogoUrl` shows as its logo until one is chosen, and is not copied into the theme) |
| Clients → Edit → Results colours | Brand Studio → Colours; a save writes the two older fields from the theme |
| Content → an option's picture address | Still there (a pasted address is allowed); an Upload button beside it uploads and crops to 480×320 |

### What a save does to participants

A page that is already open keeps its old look until it is reloaded; a page opened or reloaded afterwards shows the new one; nothing is pushed. This is the participant code's behaviour: a page reads its client and theme when it loads, and afterwards only follows AppSettings (`activeSessionId`, `activeClientId`, `activatedAt`), which a save does not change. Brand Studio says so after every save, a test fails if `App.svelte` stops being that way, and a browser test saves with a page open, waits through two of its checks, sees it unchanged, reloads and sees the new look. (Going live again would also send everyone back to Welcome, so it is not suggested.)

### The participant page: fast and safe

- **Nothing waits for a picture.** The gradient is there at first paint. The hero badge reserves its square, decodes off the main thread at high fetch priority and fades in; if it fails, or has not arrived after 1.5 s, the logo on the plate (or the name in type) takes its place and the badge takes over if it comes later. The background fades in after it loads and is simply absent if it fails. Proven by a test that aborts every image request (the page is interactive in no more time than with images, and the fallbacks show) and one that delays the hero by four seconds. Alt text is the client's name.
- **The scrim is computed.** `lib/scrim.js` finds, by bisection on the real contrast function, the least flat opacity at which white text keeps 4.5:1 over a pure white picture, for words on the page, words on a translucent pill (white at 14% over the page, which is what sets the limit) and `--text-soft`: 0.6241, used as **63%**. The 60% to 78% gradient the shell had before gave 4.19:1 under a pill. A test samples the pixels of Welcome, the hub and a question over a white picture and fails with the old scrim.
- **Precedence on Welcome**: hero badge, else logo on the plate, else the name in type, else initials (before, a hero or a logo both went on the plate).

### Request budgets, on SharePoint (the mocked REST; `test-results/budget/brand-studio-sharepoint.json`)

| Measure | Requests | Notes |
| --- | --- | --- |
| Clients tab, from the PIN | **3** | AdminUsers, then one `$batch` for AppSettings, Clients, Sessions and Sections (the write token was already held) |
| **Open Brand Studio** from a client's row | **0** | The client is already on the page; the preview needs no data; the fonts are in the page |
| Save a colour change | **5** | One read of the client (has anyone else saved?), then the write: the item, and the list's two metadata reads the first time on a page |
| Save with one new picture | **5** | The same, and the library folder (once per page) and the file; cropping and compressing send nothing |
| Save replacing that picture | **5** | The same, plus the removal of the old file (`recycle()`) |
| **One upload**, as its own cost | **2** (folder, file) | **3** on a page's first write (the write token too); the first Save on a page, with a picture, is **7** in all |
| Participant page, first screen | unchanged | No picture is requested before the first screen is drawn; the hero is one request, the background one |

The costs the mock cannot show: throttling, and whether `Files/add` and `recycle()` are as cheap on the tenant.

### Findings along the way (none changes stored data)

- **A preview in a shadow root cannot show a device.** The participant page sizes itself from the viewport (`vw`, `dvh`, media queries), which a shadow root takes from the admin window. The preview is a same-origin frame of the device's exact size, scaled down to fit.
- **A sandboxed frame breaks the preview in WebKit.** Safari refuses to run the page's own event handlers on elements inside a `sandbox`ed frame, so the hero never reached "ready" (found by the WebKit smoke test). The frame is not sandboxed; the only code in it is the page's own, on content it built.
- **An effect keyed on a prop re-runs when its parent object is rebuilt.** The hero badge was put back to "loading" every time an unrelated draft field changed and never recovered. Its state is keyed on a `$derived` of the address now (and `AppShell`'s).
- **Safari cannot encode WebP**, so a photographic hero over 300 KB as a PNG is refused there, with the reason. Flat artwork fits at the full size; Chromium makes WebP.
- **A truncated PNG decodes** in Chromium (the part that arrived is drawn), so a cut-short download would have been accepted as a picture. Files are checked for their end (PNG `IEND`, JPEG end marker, WebP length).
- **The `.preview__frame` class** already existed in `admin.css` (the Content preview) and capped the new frame's height at 65vh; the new classes are `bprev`.
- **Playwright's WebKit cannot read a Blob request body to forward it**, so the WebKit smoke test sends the upload on with `route.continue`; the app is not at fault.
- **Master used the older colour fields whatever the theme said**; it reads the theme now (one extra read of the client on that screen).
- **Page weight**: the **participant page is 585,280 B** gzip -9 (was 582,288: **+2,992 B**, about 2.9 KB; the budget was 10 KB). Of that, **`?preview=<clientId>` costs 560 B** (584,685 B before the route was added, 585,245 B after: well under the 3 KB it was allowed, so it was built). The **admin page is 220,079 B** (was 154,325: +65.8 KB): about 31 KB is the three more Open Sans faces the preview frame needs (inlined in the page, not decoded or put in the frame until Brand Studio opens, because a single-file page has nowhere else to fetch them from), Tailwind's reset for the frame about 2 KB, and the rest is Brand Studio. The setup page is 50,271 B (was 49,151: the shared `dataService`)

### Verified here, and not verified

Proven in `scripts/test-brand.js` (the rules, 52 tests) and `scripts/test-brand-storage.js` (uploads and removals on the mocked SharePoint REST and on the real local server, which must behave alike, 14 tests), `brand-studio.spec.ts` (the built pages against the real local server: layout at 390, 820 and 1440, every device and screen with screenshots, colours and warnings, every refusal, exact sizes and caps per slot, transparency, EXIF orientation, crop by keyboard, mouse and slider, save, replace, remove, revert, reset, copy, the unsaved-changes guard, a concurrent edit, what open pages do, Master, the scrim over white, blocked and slow images, preview fidelity against the real page, `?preview=`, and Content's tile upload), `brand-smoke.spec.ts` (Chromium and WebKit) and `brand-studio-sharepoint.spec.ts` (the budgets, ClientLogos, a participant reading the file back). **Nothing ran against the real tenant, or on an iPad.** What only the test site and a real iPad can show is listed in [QA-TESTING.md](QA-TESTING.md) section 9, items 29 to 37: above all that the signed-in user may add and recycle files in ClientLogos, that every participant account may read them, and the crop gestures, the camera-roll photo and the preview QR code on an iPad.

### Gate results at this commit

| Check | Result |
| --- | --- |
| `npm run check:svelte` | 0 errors, 0 warnings |
| `npm test` | 367 pass (302 before; `test-brand.js` 52 and `test-brand-storage.js` 14 are new, and the accent-reader guard, the seeds and the watcher check were updated for Brand Studio) |
| `npm run test:migration` | 265 pass, 6 skipped (231 pass, 6 skipped before): 34 new: 29 in `brand-studio`, 3 in `brand-studio-sharepoint`, and `brand-smoke` on Chromium and on WebKit; the 6 skipped are the Chromium-only budget tests under the WebKit project. Three older tests had their selectors updated (the Clients form's logo upload and colour fields moved to Brand Studio): two in `participant.spec.ts`, one in `admin-today.spec.ts`, with the same coverage |
| `npm run test:styleguide` | 7 pass (the HeroPlate section gained the dark plate) |
| `npm run test:build`, `npm run build`, `npm run build:svelte:release` (and `test:build:svelte:release`) | pass |
| `npm run validate:data` | pass (`server/data` was not touched) |

## Phase 7 (2026-10-11): the participant page's size, results in the admin page, and a polling budget

The participant page was 585 KB gzip against a 400 KB budget because the facilitator's results display and its exports (jsPDF, PptxGenJS, html2canvas, Chart.js)
lived in it, and every idle iPad polled about 2 requests every 10 seconds, which is 20% of the 3,000 requests SharePoint allows an account when ten iPads share it.
Detail and the rules that must keep holding are in [AGENTS.md](AGENTS.md) ("Svelte app conventions"); the steps for a day, with the new "Projecting the Live display",
are in [QA-TESTING.md](QA-TESTING.md) section 10. **No SharePoint column was added**, the legacy pages and `build/` are untouched, and `dataService.js` only grew
(section 8, two exports, plus `readSessionResponses`'s merge step moved into `combineAnswers`, which they share).

### Where Results and the exports went

| Was (participant page) | Now |
| --- | --- |
| `#/master-results/<sessionId>`: live tally per question, answer and iPad counts, brand colours | **Admin → Results → Live display** (also Today's **Live display** button, each Results card, `admin.html#live-display[/<id>]`), same tally and counts, the client's colours on the display itself |
| (nothing) | **Full screen** for projecting: covers the window, large type, no navigation, a way out that fades |
| Export CSV, PDF, PPT (header of the Master screen) | The same three buttons on the Live display; `getSessionResults`, so `readSessionResponses`; the files are the same (CSV byte for byte, tested on the local server and the mock) |
| Session picker when the address had no session | The same, when nothing is live and no session is named |
| `#/master-results/<id>` | A notice, "Results have moved to the admin page", with a link built from the current address to `admin.html` in the same folder; no boot, no request, no heavy import |

Two things changed that the brief did not ask for, and one was dropped on purpose. (1) The Master screen was a window of its own (a link that opened a new tab); the display is now a
view inside the admin page, so *Open in a new tab* is on it (a new tab asks for the PIN again). (2) The admin page does not restyle itself in a client's colours, so the display wears
them on its own element and the charts read them from there. (3) html2canvas, canvg and dompurify (about 80 KB gzip) are replaced in the **admin** build by a stub, because jsPDF loads
them only for HTML-to-PDF and SVG-to-PDF, which no export uses (`scripts/test-bundle-budget.js` fails if `resultsExport.js` starts to call them). **PowerPoint was not dropped**: with the
stub the admin page is 554,299 B gzip, 46 KB under its 600 KB budget. Measured with throwaway builds: **without the stub it is 658,217 B (58 KB over)**, and **PowerPoint alone (PptxGenJS and JSZip) costs 121,750 B** (432,549 B without it).
So it is the stub, not the removal of PowerPoint, that keeps the page inside the budget; had the stub not been possible, dropping PowerPoint (or the options below) would have been the cost of staying under 600 KB. (Phase 7c later raised the budget to 700 KB; PowerPoint is still there.)
Options if the budget is ever pressed: drop the Chart.js controllers the renderer does not use (about 20 KB), load the export libraries from a second file (a build
subfolder SharePoint does not have today), or build the PowerPoint from a template instead of PptxGenJS.
`public/js/resultsRenderer.js` (shared with the frozen legacy app) gained one optional input, `--chart-scale`, default 1, so that the projector view can draw larger chart text; at 1 every size is what it was.

### Sizes, before and after (gzip -9 of the finished standalone page; `npm run analyze:bundle`)

| Page | Before | After | Budget |
| --- | ---: | ---: | --- |
| Participant `index.html` | **585,280** | **153,512** (raw 1,739,632 to 367,160) | target 400,000, ceiling 450,000 (met by 247 KB) |
| Admin `admin.html` | 220,079 | **554,299** (raw 561,378 to 1,578,343) | 600,000 (700,000 since Phase 7c) |
| Setup `setup.html` | 50,271 | 50,936 (`dataService` section 8) | none |

What the participant page held before (estimated shares of the page; the full tables are `test-results/bundle/before.md` and `after.md`): jsPDF 89.9 KB, PptxGenJS 80.8, Chart.js 69.3,
html2canvas 46.6, Svelte 29.4, JSZip 24.5, canvg 23.8, `dataService.js` 21.9, core-js 19.9, pako 16.3, `migration/src/lib` 15.0, DOMPurify 11.8; inlined fonts 62.0 (the page's own
styles 7.5). **After:** Svelte 24.3, `dataService.js` 18.8, `migration/src/lib` 13.0, the six inlined Open Sans faces 62.5 (40.7% of the page), components 6.4, routes 5.1, the pager 5.0,
confetti 3.7. What the admin page now carries: jsPDF 97.5 KB, PptxGenJS 87.7, Chart.js 75.2, `migration/src/admin` 61.6, JSZip 26.6, pako 17.7, the three inlined fonts 30.8, Svelte 32.7,
`dataService.js` 24.7 (the admin screens' own code is 34.3 KB in `lib` and the rest of `admin`).

### Budgets are tests

`scripts/test-bundle-budget.js` (in `npm test`, `npm run test:bundle`) builds the real pages into a scratch folder and fails if the participant page is over 450,000 B, the admin page over
600,000 B (700,000 B since Phase 7c), or the participant page contains jsPDF, PptxGenJS, html2canvas, Chart.js, `resultsExport.js`, `resultsRenderer.js` or `ResultQuestion` (by the modules the bundler reports and by text). Negative
controls: the same check on the admin page standing in for the participant page (every library found, size over), at one byte over each limit, and on a **real participant build that imports the libraries** (it
fails, and the leak adds over 150 KB).

### The polling audit and the new budget (requests a minute for one device, SharePoint mode)

| Timer | What it reads | Before | After | Notes |
| --- | --- | --- | --- | --- |
| Participant page, with a visit, waiting (Welcome, hub, finale) | AppSettings, the track | 2 requests every 10 s = **12** | **3** (one `$batch` of AppSettings, the session, the track every ~20 s ±20%) | 3 parts a look |
| Participant page, no visit (Welcome, "not live yet") | AppSettings | 1 per 10 s = **6** | **3** (AppSettings and the session) | |
| Activities hub | the client's activities (+ the session) | **+12** (2 per 10 s) | **0** extra: the activities ride in the same look (4 parts), the hub reads once on arriving | `experience.activitiesVersion` |
| Participant page, a question on screen | AppSettings, the track | **12** | **1** (one look a minute, ~48 to 72 s) | answers saved are the traffic then |
| Participant page, hidden tab | | 0 | 0 (one look when shown) | |
| Participant page, a site that cannot batch | | | 3 plain reads every ~60 s = **3** | the wait grows with what the look cost |
| Participant page, 429 or 503 | | retried inline | waits at least `Retry-After`, then doubles up to 5 min | adapter no longer replays a busy batch |
| Admin Today | AppSettings, the live session, tracks | 6 (one `$batch` / 10 s) | **6** | unchanged |
| Admin Content | the client's activities | 4 (one read / 15 s) | **4** | unchanged |
| Admin Guests and QR | roster, codes, tracks (and answers once a guest joined) | 4 to 8 | **4 to 8** | unchanged |
| Admin Results | every session in full, every 2.5 s | **~3 + 6 a session, every 2.5 s** (hundreds a minute) | **4.6** (the live session's one-request feed every 15 s, its structure once at 5 minutes); the other sessions only when opened or on Refresh | found by this audit |
| Admin Live display (new; was the participant page's Master screen: `getSessionResults` every 10 s = ~36) | the session, tracks, every answer, activities | ~36 | **5.6** (one request every 12 s, the structure, 3 requests, every 5 minutes); budget 6 | |
| Setup page | no timers | 0 | 0 | |
| Legacy pages (`public/`, frozen) | | unchanged | unchanged | not Svelte |

Measured in the built pages against the mocked SharePoint REST with Playwright's clock (`polling.spec.ts`, `live-display-sharepoint.spec.ts`; numbers in `test-results/budget/`):
a waiting page 2.8 a minute (14 looks in 5 minutes), the hub 3 (15), a question 0.8 (4), the Live display 28 requests in 5 minutes (5.6 a minute), Results 23 (4.6), Today 30 (6),
Content 4, Guests 4. The waits' jitter measured 16.2 to 24.1 s, mean 19.8 s; a 429 or 503 asking 90 s was honoured (the next look came 95.8 and 104.2 s later); three failures in a row waited
37, 87 and 165 s, then 20 s again after a good look.

**The ten-device simulation now counts idle polling.** `scripts/test-participant-storage.js`: ten devices, QR scan to finale, 15 answers each = 371 requests (12.4%, unchanged); then each sits on the hub for
five minutes, looking every ~20 s: **147 requests (4.9% of 3,000)**; together 518 (17.3%), under the 20% it was held to. In the browser (`polling.spec.ts`), ten real pages idle for five minutes: **138 requests, 4.6% of 3,000**,
at most 14 from any one device (2.8 a minute), their looks spread over many different seconds.

### End session reaches an open participant page

An End session sets `Sessions.Status` to `completed` and `EndedAt`; it never touched AppSettings or a track, which is why Phase 5 said an open page could not notice. **Design: the session is read in the look the page
already makes** (it was added to the one `$batch`: AppSettings, the session, the track; the hub's activities too). That is one more read in the batch and **no more requests**, and no column: it uses the field `endSession` has always written.
The alternatives that were considered and not built: writing AppSettings on End (it would drop an iPad that is mid-activity, break Today's idea of what is live, and change what the legacy pages see), and stamping every track
(N writes). The trade-off is the wait: a page on Welcome or the hub shows the notice within about 25 seconds, one with a question on screen up to about 72 seconds, and it is seen when it is shown again after a hidden tab or a sleeping iPad.
A page mid-activity finishes it (answers still save, tested), and sees "This session has ended. Thank you. Your answers are saved." in place of the hub when it goes back to the activities; the finale is left as it is; Reopen
brings the hub back with its progress; a page opened or reloaded after the end shows the same words, and keeps looking so that a Reopen starts it again by itself. If a site cannot batch, the session is a fourth plain read and the look is
3 to 4 times as long (the rate holds).

### Findings along the way

- **The hero screenshot of Phase 6** (`brand-participant-hero-background`) was a mid-fade capture, not a bug: the badge fades in over 320 ms and the background over 400 ms and the test waited only for `complete`. Settled, the hero is fully opaque.
  The test now waits for every CSS transition to finish and asserts, from pixels (a screenshot of the hero against the picture drawn on a canvas), that the hero is the picture (mean difference under 10 of 255), with a negative control at 35% opacity (over 40).
- **Results was polling every 2.5 s and reading every session in full each time** (a cost of about 3 + 6 requests a session a tick on SharePoint): the biggest poll in the admin by far, found by the audit. It now refreshes only the live session, 15 s apart.
  Its open cost, 3 + 6 requests a session, still grows with the sessions a site has ever had (QA-TESTING.md section 9, item 45).
- **Under Playwright's WebKit a fulfilled `$batch` response loses its `boundary=`**, so the page finds batching unusable and reads plain: the fallback (and its slower cadence) works on WebKit, and the clock-driven specs therefore run on Chromium only. The WebKit smoke covers the Live display, Full screen and all three exports.
- **`online` is looked at at once** (it was the tests' way to trigger a check, and it is the moment the page most needs one); a returning tab is not looked at again within 5 s of the last look.
- A 400 from `$batch` or an unusable response still turns batching off; a timeout, no connection or a 500 on a look is now thrown after one request instead of being replayed as three plain reads.
- The participant `?preview=` page and the admin screens other than Results were not changed.

### Not done, and not verified

The **leader PDF report** of the plan (section 4.6) was not part of this brief and was not built; the exports are the three that existed (it was built next: "Phase 7b" below). **Nothing ran against the real tenant or on an iPad**: the list is QA-TESTING.md section 9, items 38 to 45,
above all that SharePoint accepts a `$batch` of AppSettings, the session, the track and the activities from a participant account, and whether its throttling counts a batch as one request or one per part (if per part, a waiting iPad is 9 to 12 units a minute, still inside the budget).

### Gate results at this commit

| Check | Result |
| --- | --- |
| `npm run check:svelte` | 0 errors, 0 warnings |
| `npm test` | 417 pass (367 before; `test-bundle-budget.js` 8, `test-polling.js` 21 and `test-live-display.js` 21 are new, and the ten-device simulation in `test-participant-storage.js` counts five idle minutes) |
| `npm run test:migration` | 308 pass, 6 skipped (265 pass, 6 skipped before): 43 new: `live-display` 12, `live-display-sharepoint` 8, `polling` 13, `end-session` 6, and `live-display-smoke` 2 on Chromium and 2 on WebKit; the 6 skipped are the Chromium-only budget tests under the WebKit project. Existing specs migrated, none deleted: the Master tests (`participant`, `clients`, `brand-studio`, `admin-today`) now drive the admin Live display, the ended wording, the card selector, the 20 s look. One racy assertion in `admin-content.spec.ts` (an option's cleared picture read at the instant of a toast) is polled |
| `npm run test:styleguide` | 7 pass |
| `npm run test:build`, `npm run build`, `npm run build:svelte:release` (and the three `test:build:svelte*`), `npm run validate:data` | pass |

## Phase 7b (2026-10-12): the leader PDF report and the participant CSV

Section 4.6 of the implementation plan: a report a leader who was not at the event can read on paper or on an iPad, and a CSV with a row
for each participant and question. Both are made in the admin page from the day's saved answers, on demand, and stored nowhere. Detail and
the rules that must keep holding are in [AGENTS.md](AGENTS.md) ("Leader report and participant CSV"); what a person should look at is in
[QA-TESTING.md](QA-TESTING.md) (section 1, and section 10 step 11). **No SharePoint column, no change to saved data, no change to
`dataService.js`** (the reads are calls the admin already had), **and the participant page is byte for byte what it was** (153,512 B gzip).
The Live display's Export CSV / PDF / PPT are untouched.

### What was built

| | |
| --- | --- |
| **Where** | Admin → Results: **Leader report (PDF)** and **Participant answers (CSV)** under each session card's heading, so for today's session or any past one (`admin/ReportExports.svelte`) |
| **Cover and summary** | The client's logo (from the saved theme; on its dark plate when the look has one; nothing in its place when there is none) and the Deloitte wordmark; a band in the client's colour with the client's name, the event title and the session's date; "About this report" (when it was made, which session, whether it had ended, the counting rules); participants joined, finished every activity, average first-try score; completion by activity; the hardest and the easiest question by the share right first time |
| **Results by activity** | Each question: its words, every answer with a bar, a count and a percentage; the correct answer in bold with a tick and "(correct answer)"; "Right first time: N of M"; the most common wrong first answer; what became of the wrong first tries (second try right, shown the answer, never tried again). A poll is a distribution. A confidence question has its distribution and its average on its own scale. A ranking is in order of points, with the average place |
| **What participants said** | Every written answer, word for word, under its question, with the writer's name. A line break someone typed is a line break; a long answer wraps and carries on overleaf, and is never cut |
| **Participants** | One block a person, in the order they joined: name, activities finished, first-try score and "N of M answered", when they joined, a restart if there was one, then every question with their answer (a tick or a cross and "(right first time)", "(wrong), then X (right)", "(wrong twice; answer shown)", "did not try again"), their poll, confidence and ranking choices, and their own words. A block stays on one page unless it is longer than a page; short ones share a page |
| **Questions no longer in the activity** | Only when there are any: answers to a question that was deleted or taken out of the session, by name, counted nowhere |
| **Every page** | "Confidential – internal", the client's name, "Page N of M"; white paper; right and wrong by a mark and words, never by colour |
| **CSV** | UTF-8 with a byte-order mark, CRLF: Client, Date, Participant, Activity, Question, First answer, Final answer, Correct, Correct on first try, Attempts, Answered at. One row for each participant and question (unanswered ones too), then the answers to questions no longer in an activity. A cell that starts with `=`, `+`, `-` or `@` gets an apostrophe |

How each kind of question is stored in `ResponsesJson` (`{ questionId, answer, firstAnswer, attempts, correct, answeredAt }`), written
down before the report was designed: **single-select** and **true-false**: `answer` is the option id they ended on and `firstAnswer` the
first pick; with a correct option the question is graded (`attempts` 1 or 2, `correct` = the first pick was right), without one it is a poll
(`correct` null). **multi-select**: an array of option ids, never graded. **confidence-continuum**: one option id, whose `value` is its
place on the scale. **ranked-voting**: every option id, best first. **open-text-feedback**: the words, 1000 characters at most. An answer
from a session's older shared item has no history (`attempts` and `correct` null). The seeds use three of the six kinds; the code has all six.

### The counting rules, as the report prints them

1. Participants are everyone who opened the session, in the order they joined. Someone who joined twice is listed once for each visit, the later one as "Name (2)".
2. Names come from the guest QR code or the sign-in. Where none was recorded the person is "Unnamed participant 1, 2 …"; no name is guessed.
3. Scores use each person's first answer only, so trying again never raises a score. A score is the share of the graded questions a person answered that were right first time; "7 of 15 answered" shows where someone stopped early. The average is over the people who answered at least one graded question.
4. Finished means a final answer to every question of every activity that is switched on. A wrong first answer that was never tried again is not final.
5. When the facilitator restarted a participant, the answers that person had given were removed at that moment. Only what they answered after the restart exists and is counted, and their page says when it happened.
6. Answers to a question that was later deleted, or taken out of the session, are listed under "Questions no longer in the activity". They are in no score and no total.
7. Someone who joined and answered nothing is listed, with "No answers recorded".
8. The wording of questions and answers, and which answer is correct, are read when the report is made, not as they stood when people answered.

Decided from the code, and stated in the report where they apply: a **restart** (`restartParticipantTrack`) deletes the answers from the
participant's item before it stamps the track, so "which attempt counts" has only one possible answer, the one after it (a test plays a real
restart on both adapters and finds nothing of the earlier answers); an activity that is **switched off** but holds answers is shown, marked,
and not needed to count as finished (the rule behind Guests' "Completed"); an answer whose **option was later removed** is counted as answered,
said to be removed, and judged by the `correct` that was recorded on the day; a **correct answer changed after the event** is used as it is
now, and the question says how many people answered before the change; the hardest and easiest question compare switched-on activities only.

### Fonts, and the size of the admin page

A PDF embeds TrueType outlines, and nothing in a browser turns the WOFF2 the admin page already inlines back into TrueType, so the report
carries its own faces. `scripts/build-report-fonts.py` subsets **Open Sans Regular and Bold** (Basic Latin, Latin-1 Supplement, Latin
Extended-A, common punctuation, U+FFFD: 337 characters a face; no hinting, kerning or layout tables; the copyright and Apache-2.0 licence
records kept inside each face and the licence text beside the module), joins the two, deflates them as one stream and writes base64. The page
inflates it with `DecompressionStream` when a report is made, and jsPDF subsets again into each PDF (a 38-page report is 175 kB).

**Admin page, gzip -9 (`npm run analyze:bundle`): 554,299 B before, 598,886 B after, against the 600,000 B ceiling: it fits, by 1,114 B.** (That margin was inside the noise of measuring gzip, and Phase 7c raised the ceiling to 700,000 B.)
Of the 44.6 kB added, the two faces are 26.1 kB and the report's code (counting, layout, the writer, the buttons) about 18.5 kB. The ceiling
was not raised. **The admin page is now full**: the next feature on it needs room made first. (Phase 7c: the budget is now 700,000 B, with nothing dropped.)

Measured on the way (the two faces in the gzipped page unless said otherwise):

| What | Size | |
| --- | ---: | --- |
| Base64 of the raw TrueType | about 33.2 kB | first measurement, not used |
| Each face deflated by itself, then base64 | 28.1 kB | the first build: **the admin page was 601,057 B, 1,057 B over** |
| Both faces deflated as one stream | 26.5 kB | the second face repeats much of the first |
| ... and punctuation the brief never asked for (per mille, primes) left out | **26.1 kB** | as built |
| One face (Regular only) | 13.7 kB | no real bold |
| Three faces (with Italic) | 41.9 kB | would be about 14 kB over the ceiling |
| Four faces (with Semibold) | 55.7 kB | |
| Two faces without Latin Extended-A | about 5 kB less | Łukasz would print as a replacement mark |

**If room is needed on the admin page**, what each way is worth: fetch the font data from a file beside the page when a report is made, 26.1 kB
(a second file to upload to SharePoint, which today has only the three pages, and the report fails if it is missing); one face instead of
two, 12.4 kB (bold would have to be faked or dropped); the Chart.js parts the renderer does not use, about 20 kB (Phase 7's estimate, not
measured again); PowerPoint export out, 121.7 kB (Phase 7's measurement); one set of TrueType faces for both the admin page's own text and
the PDF, about 20 kB (an estimate; the page's fonts would then load by script, which needs a look on WebKit).

**A finding about the participant page.** After the first build it had grown by 22 bytes though nothing it imports had changed: Tailwind
reads every file under `migration/` for class names, comments included, and the words `table`, `absolute` and `invisible` in the new
files each added a utility rule to both pages. They were reworded; the page is 153,512 B again, raw 367,160 B, exactly as before.

### What it costs, and how long it takes

| Measure | Result |
| --- | --- |
| Requests to read a session for either file, mocked SharePoint | **4** (the session; one `$batch` of its activities, client, tracks, visit log and roster; one `$batch` of questions and options; the answers), **5** when an answer points at a question outside the session's activities. Nothing is written |
| 60 people, 15 questions: the report in node (count, lay out, write) | 117 ms (2 / 10 / 88 at the last run), 38 pages, 175 kB |
| The same in Chromium, through the real buttons, local server | **297 ms in the page, 331 ms from the click to the file** (306 and 353 in an earlier run) |
| The same in WebKit | **339 ms in the page, 376 ms from the click to the file** |
| The CSV for the same session (900 rows), click to file | 55 ms Chromium, 47 ms WebKit |
| Limit in the brief | 10 seconds |

With longer answers a person's block no longer shares a page: the same session with answers four or five words long ("The Great Western Tea
Company") came to 66 pages, and with one-word answers 38. The page count follows the content.

### Tests

- **`scripts/test-leader-report.js`** (42 tests): every number against Harbour, a session of seven visits and nine questions whose results are
  worked out by hand in the test's comments (first-try share, most common wrong answer and its tie-break, what became of wrong tries, a poll,
  choose-any, the confidence average, ranking points and order, each person's score and what they finished, the average, completion by
  activity, hardest and easiest and their tie-break), each counting rule, a deleted question, a removed option, a changed key, answers from
  the older shared item, the CSV (byte-order mark, CRLF, accents, a comma, a quote and a line break inside a cell, formula injection, it reads
  back), the accent's contrast for ten colours, and 60 people by 15 questions counted again by the fixture's rule in a few lines of the test.
- **`scripts/test-leader-report-pdf.js`** (30 tests): the fonts (coverage, the licence inside each face, size, widths equal to jsPDF's own);
  the layout guard over three reports, with a negative control that shows it can fail (a box too narrow, a line off the page, two pieces of
  text colliding); the PDF read back with pdf.js (A4, Open Sans embedded twice and nothing else, the footer and the right "Page N of M" on
  every page, every item inside the margins by pdf.js's own measure, the cover's words, accented names, the correct answer in bold, every
  comment whole including 2,000 characters and one longer than a page, a replacement mark and its note, a block never split and 29 pages
  shared); speed, progress and Cancel; a logo on its plate; and the records read from the mocked SharePoint REST and from the real local
  server giving the report that was worked by hand, with a real restart.
- **`scripts/migration-tests/leader-report.spec.ts`** (8 tests; 5 of them on WebKit as well): both buttons and both downloads, the PDF read
  back from the file the browser saved; 60 by 15 under ten seconds; the progress line and Cancel with the page's clock held; a session that
  has gone; the buttons at 390, 820 and 1440 wide; and the pictures in `test-results/report/`.
- **Mutations** (`npm run test:report:mutations`): 28 of 28 caught. A question's first-try count, a person's score and the bars each using
  the LAST answer; a score out of every graded question; the average including people with no graded answer; the most common wrong answer
  being the least common, or the right one; an open answer counting as final; "finished" needing one answer; a switched-off activity being
  required, or being left out; a deleted question's answers dropped; unnamed numbering from 0; a second visit not told apart; a guest taking
  the iPad account's name; newest first; a restart not mentioned; ranking points one too few; the confidence average dividing by one too
  many; a percentage as a share of picks; hardest and easiest swapped; a switched-off question as "the hardest"; a removed option judged
  wrong whatever was recorded; no formula guard; no byte-order mark; people who answered nothing left out of the CSV; the CSV's two verdict
  columns swapped; a light colour used as it is.
- **The budget test** now also fails if the leader report, its fonts or its buttons are in the participant page (with a negative control: a
  real participant build that imports them).

### Done differently from the brief, and why

- **Two faces, Regular and Bold**, and no italic: three would not fit the admin page's budget (41.9 kB against 26.1), and the brief asks for
  bold and for accents, not for italic. This is the "two weights only" option, taken because it loses nothing that was asked for.
- **Lines and paths, as well as rectangles, text and pictures.** The tick and the cross are two strokes each, and the Deloitte wordmark is
  drawn from the paths of the app's own `DeloitteWordmark` component (black letters on white, the green dot), so it is sharp at any size and
  costs no picture in the page. Nothing is rendered from HTML and html2canvas is not used.
- **No function was added to `dataService.js`**: the existing reads were enough.
- **The score is over the graded questions a person answered**, with "N of M answered" beside it, and the average is the mean of people's
  own percentages. The brief left both open; the About box says which.
- **Two rules the brief did not list** are stated in the report because the data has them: a second visit under one name is "Name (2)",
  and a switched-off activity that holds answers is shown and marked.
- **The pictures are drawn by pdf.js in Playwright's Chromium**, not pdftoppm or mutool: neither is installed here, and this way the test
  runs wherever the browser tests run.
- **The wording read at export time includes which answer is correct**, with a note under a question whose key changed after people answered.

### Not verified

Nothing ran against the real tenant or on a real iPad: QA-TESTING.md section 9, items 46 to 52 (the two downloads in iPad Safari and how
the PDF and CSV open there; the time on an iPad against SharePoint; the four reads on the tenant; staff names from a real sign-in; a logo
from ClientLogos drawn on a canvas; paper, in colour and in greyscale; scripts the font does not have). The numbers are held by tests; whether
the report reads well to a leader is a judgement only a person can make, from the pictures and from a real session.

### Gate results at this commit

| Check | Result |
| --- | --- |
| `npm run check:svelte` | 0 errors, 0 warnings |
| `npm test` | 491 pass (417 before: `test-leader-report.js` 42, `test-leader-report-pdf.js` 30, and 2 more in `test-bundle-budget.js`) |
| `npm run test:report:mutations` | 28 of 28 caught |
| `npm run test:migration` | 321 pass, 9 skipped (308 pass, 6 skipped before): 13 new in `leader-report.spec.ts`, 8 on Chromium and 5 on WebKit; the 3 more skipped are its picture tests under the WebKit project (the pictures are drawn once, in Chromium). No existing spec was changed |
| `npm run test:styleguide` | 7 pass |
| `npm run test:bundle` | pass: participant 153,512 B, admin 598,886 B, setup 50,936 B |
| `npm run test:build`, `npm run build`, `npm run build:svelte:release` (and the `test:build:svelte*` checks), `npm run validate:data` | pass (`server/data` and `public/` were not touched) |

## Phase 7c (2026-10-12): polish from the 7b review

Four items found when the 7b output was reviewed, and nothing else. **No counting rule and no rule text changed, the participant page is byte for byte what it was
(153,512 B gzip, 367,160 B raw), and `dataService.js`, saved data and the SharePoint columns are untouched.** Detail and the rules that must keep holding are in
[AGENTS.md](AGENTS.md); what a person should check on real hardware is [QA-TESTING.md](QA-TESTING.md), "Phase 7c" (items 53 to 58). The brief calls the earlier phases
7a and 7b; in this file 7a is "Phase 7".

### 1. The admin page's budget: 600,000 B to 700,000 B

| Page (gzip -9, the project's counter) | Before 7c | After 7c | Budget | Headroom |
| --- | ---: | ---: | --- | --- |
| Participant `index.html` | 153,512 | **153,512** (raw 367,160, unchanged) | target 400,000, ceiling 450,000 | 61.6% under the target, 65.9% under the ceiling |
| Admin `admin.html` | 598,886 | **600,863** (raw 1,660,507; it was 1,653,774) | 600,000 → **700,000** | **14.2%** under (99,137 B of room) |
| Setup `setup.html` | 50,936 | 50,936 | none | |

The admin page is now 863 B over the old 600,000 B line (it grew 1,977 B: the Results naming and the Live display's one-question view), which is the case for the raise. Why: the admin page is for facilitators and loads once a session (the participant page is the one that matters); the 7b margin (1,114 B) was inside the noise of
measuring gzip (the same file is about 599.6 kB with the system `gzip` and about 601.6 kB with another machine's Node zlib, so the budget could fail on a teammate's
machine with no code change); and Phase 8 needs room for accessibility fixes. **Nothing was dropped to make room**: PowerPoint, both Open Sans faces and the jsPDF stubs
are as they were, and size is measured as it always was. `scripts/test-bundle-budget.js` now prints both pages' sizes and their headroom as a percentage (it did not before: it
only passed or failed). The participant page was measured after every item and did not move by a byte.

### 2. The leader report: the summary comes first

Page 1 is now the client's logo and the Deloitte wordmark, the title band, **Summary** (the three tiles, completion by activity, the hardest and easiest question), and one line:
"Made on {date and time} from the answers saved for this session. How the numbers are counted is on the last page." The "About this report" box (the "Session: ..." line, every
counting rule exactly as worded, the notes) moved to a final section, **How the numbers are counted**, after Participants and "Questions no longer in the activity". The 42
hand-worked counting tests and all 28 mutations pass unchanged; the PDF tests that moved were the ones about *where* text is (the cover, the missing-character note, the stray section
no longer being the last page), and one participant line changed, because "see the last section" would now point at the wrong section ("listed near the end of this report").

- **If the hardest and easiest do not fit page 1** they go to the top of page 2, with the "Made on" line (it stays with the block above it: a page is never just that line). The tiles and completion stay on page 1 (completion breaks between rows rather than moving whole). A test lays out 1 to 30 activities:
  the line is always on the page of the block above it, and from 14 activities the block moves.
- **Pages**: Harbour (7 people, 9 questions) 9 pages before and after; 60 people and 15 questions 38 pages before and after (175,158 B to 175,396 B).
- **Pictures to look at**, written by `leader-report.spec.ts` to `test-results/report/`: for the light, dark and sixty fixtures, `*-cover.png`, `*-last.png` and `*-participants.png`
  (and the results, comments and no-longer-in-activity pages as before).

### 3. One naming rule, on the screen and in the report

Admin → Results labelled a nameless visit with the client's name ("Harbour & Søn · Visit 1") and a second visit "· Visit 2"; the report said "Unnamed participant 1" and "José Álvarez (2)".
The rule moved, unchanged and verbatim, into `lib/participant-names.js` (`nameParticipants`; `leader-report.js` re-exports it as `reportParticipants`, which the tests use), and
`AdminResults.svelte` takes its rows from `lib/admin-results.js` `resultRows()`, which calls it. Status chips, "joined 4:40 PM via QR code" and Restart are as they were; only the name changed.

- **The screen needs what the report reads.** A staff sign-in name is in the visit log and a roster name is in the roster, not on the track, so showing the same names means reading them.
  `readNameSources()` is two lists in ONE `$batch` for up to 20 sessions, **only for a session with a track that has no name of its own**: **+1 request when Results opens or is refreshed**,
  none for a session of guests with QR names. On the live session's 15-second timer, someone who joined in the last two minutes and is still unnamed is looked for again (their sign-in is
  written a moment after their first screen), twice for each person at most. Counted against the mocked SharePoint (`test-results/budget/live-display-sharepoint.json`): Results left open for five minutes is
  24 requests, 4.8 a minute (it was 23, 4.6): the 20 refreshes, the structure (3) and ONE look for names (the three nameless iPads of the test site); a staff iPad that joins is named
  within two refreshes, and nothing is read after that. This is the one place Phase 7c changed a request count, and the budget is still under 6 a minute.
- **Test** (`scripts/test-participant-names.js`, 7 tests, also in `npm run test:report`): the Harbour session (a guest named by the QR code, staff named by the visit log, a name from the
  roster, two visits with no name anywhere, the same guest twice) is played through the data service on the mocked SharePoint and on the real local server; the names from the Results
  screen's code, from the report, from the CSV and from the PDF read back with pdf.js are asserted equal, in the same order, and equal to a list written out by hand. The mutation script
  now patches the file the rule lives in (mutations 13 to 16 are caught there).

### 4. The Live display: one question fits a wall screen

**First, does full screen scroll or fit? It scrolled** (`overflow: auto`): at 1920x1080 the first card (a two-line question and four options) was taller than the window and its axis labels
ran past the bottom (the "before" picture is the Phase 7 `live-display-fullscreen-1920x1080.png`). A projector has no scroll wheel and the pointer hides after 3 idle seconds.

In full screen the display now shows **one question at a time**, with the whole card on the screen: the card takes the height between the heading and the controls (`ResultQuestion` `fit`), the
chart takes what the prompt and the "N answered" line leave (a CSS override of the renderer's fixed box height; `resultsRenderer.js` itself is unchanged), a written-answers question shows the
rows that fit and says "N more written answers are not shown", and the type still scales with the window (1.2 to 2.4). A card that cannot fit even so (a 1,700-character question) has its type
made smaller a step at a time, to a floor of 0.75, until it is whole. **Previous and Next and the left and right arrow keys** move and go round at either end; **Auto-advance** (a switch, off by
default and off again each time full screen is entered) moves on every 15 seconds, goes round, restarts the 15 seconds after a move by hand and waits while the tab is hidden. The controls fade
with the way out when the pointer is idle and keep their room. **The request budget is unchanged**: none of this reads anything (seven moves with the clock held send no request) and the SharePoint
specs for one request every 12 seconds, and none while hidden, pass as they were. Outside full screen the display is as it was.

- **Measured** (`live-display.spec.ts`, Chromium; `test-results/admin/live-display-fit-*.png`): at 1920x1080, 1366x768, 1280x720 and 1024x768, for every one of the 10 questions of the Kroger
  fixture (bar charts, a ranking, written answers), the card's bounding box is inside the window, nothing in it is cut by its own edge, the display does not scroll, and the chart is over 140 px
  high. A stress session (a 1,700-character question, a ranking of eight, forty written answers) fits at 1280x720 and 1024x768, with the long one smaller than the others. WebKit smoke: one card, the
  arrow keys, the card inside a 1280x720 window.
- **Auto-advance** is tested with Playwright's clock, on Chromium only, as the other clock-driven specs are.

### Tests

| | |
| --- | --- |
| `npm test` | 499 pass (491 before: `test-participant-names.js` 7 and one more PDF test; the 42 counting tests are unchanged, three PDF tests had assertions about *where* text sits moved, the budget test now prints the sizes) |
| `npm run test:report:mutations` | 28 of 28 caught |
| Existing browser specs changed | `participant.spec.ts`: the two Results *Restart* tests find the iPad's row as "Unnamed participant 1" (it was the client's name, the fallback this phase removed); `live-display.spec.ts`: the full-screen test no longer expects the chart to be 1.7 times its normal height (it takes the room the one card leaves) |
| New browser specs | `live-display.spec.ts` 5 (the fit at four sizes for every question, the stress session, Previous and Next and the keys, the fade, Auto-advance), `live-display-sharepoint.spec.ts` 1 (names on Results, the staff iPad that joins), the WebKit smoke extended, the report pictures gain the last page |

### Done differently from the brief, and why

- **Page 1's order has the "Made on" line after the highlights, and it travels with them.** The brief says "if the hardest and easiest do not fit page 1, they go at the top of page 2" and puts
  the line after them; keeping the line with that block is what stops a page that is only that line.
- **The last page's heading is "How the numbers are counted" over a box that is still titled "About this report"**; the box's own "Made on" line and its "How the numbers are counted" sub-heading are
  gone from it (the first is on the cover, the second is now the section's title). Every rule is word for word as before.
- **A participant block's pointer "see the last section" became "listed near the end of this report"**: it would have pointed at the wrong section. Not a counting rule.
- **The session line and the notes are on the last page, not the cover**, as asked. That includes "Not ended when this report was made, so answers may still arrive" and the note about a
  character the font cannot print. A leader who reads only page 1 will not see them; QA-TESTING.md item 56 asks whether the cover needs a line for them.
- **Results reads the visit log and the roster** (one more request on open): the brief asked for the same names on the screen and in the report, and a staff name cannot be had without them.
  The brief did not say the request count of Results could change; it did, by one, and the 5-minute budget test says so.
- **Previous and Next go round at either end** (the brief asked it of Auto-advance only); a wall that stops at the last question would need a way back.
- **No Page Up and Page Down** (a presenter's clicker often sends them): the brief asked for the arrows.
- **The type in the Live display can be made smaller for a very long question** (not in the brief): without it a long question would be cut at its card's edge, which is what the item was about.
- **The browser harness retries a stale socket up to four times (not once) and takes its ports one after another (not at random)** (`admin-local.ts`, test plumbing only). Full runs of
  `test:migration` failed on a different unrelated spec each time (a picture tile after a reload; "Today" controls; deleting an activity; the print sheet) with `fetch failed ... other
  side closed` raised in the test process before the page was involved: each test starts a scratch server on a port picked at random from 400, Node's connection pool can hand a new test a
  dead connection from an earlier test that had the same port, and one retry was not always enough. Those specs pass when run alone (four times in a row) and the full run was green after
  the change. It was not measured on `HEAD` whether the same flake happens there, so it may be older than this phase.
- **The mutation script patches two files now** (`participant-names.js` as well as `leader-report.js`): the mutations themselves, and the text they find and replace, are unchanged.

### Not verified

Nothing ran against the real tenant, a real projector or TV, or a real iPad (QA-TESTING.md items 53 to 58): the display on real hardware (overscan, resolution, the back row's view, a clicker),
the report on an iPad, the visit-log and roster reads for names on the tenant, and the admin page's load time at 601 KB. Everything above is against the mocked SharePoint and the local server.

### Gate results at this commit

| Check | Result |
| --- | --- |
| `npm run check:svelte` | 0 errors, 0 warnings (385 files) |
| `npm test` | 499 pass (491 before) |
| `npm run test:report:mutations` | 28 of 28 caught |
| `npm run test:migration` | 327 pass, 9 skipped, 0 failed (321 pass, 9 skipped before): 6 new (5 in `live-display.spec.ts`, 1 in `live-display-sharepoint.spec.ts`), the WebKit smoke extended; the 9 skipped are the same Chromium-only specs under the WebKit project |
| `npm run test:styleguide` | 7 pass |
| `npm run test:bundle` | pass: participant 153,512 B (byte for byte), admin 600,863 B (14.2% under 700,000 B), setup 50,936 B |
| `npm run test:build`, `npm run build:svelte:release` (both run by `test:migration`), `npm run test:build:svelte`, `:admin`, `:setup`, `:release`, `npm run validate:data` | pass (`server/data` and `public/` were not touched) |

## Phase 8 (2026-10-12): browsers, devices, accessibility, performance, an unsupported-browser page, and a device test sheet

A pass over three engines, seven device shapes, WCAG 2.1 A and AA, the keyboard, the zoom, contrast, reduced motion and speed, a plain page for a browser that cannot run the app, and a
printable sheet for the real devices. **Everything ran against the mocked SharePoint REST and a local server, on Playwright's own Chromium, WebKit and Firefox on a Mac. No real iPad,
iPhone, projector, printer, screen reader or SharePoint site has been involved, and Edge was not run** (it is Chromium, which is a belief and not an observation). What a person must check
on the real things is `DEVICE-TEST-SHEET.md` (in git history at `7347c72`) and [QA-TESTING.md](QA-TESTING.md), items 59 to 68. **No counting rule, no
`dataService.js`, no saved data and no SharePoint column was changed; the admin ceiling (700,000 B) and the participant ceiling were not raised, and the participant page grew by
1,882 B gzip in all (the allowance is 2,048 B, held by `test:bundle`).** The rules that must keep holding are in [AGENTS.md](AGENTS.md).

### The baseline, before anything was changed

`npm run test:migration` on `a289aca` (Phase 7c): **327 passed, 9 skipped, 0 failed, 9.6 minutes** (log kept). The "`fetch failed ... other side closed`" that 7c saw in a different spec in each full run
did not happen in that run, so the baseline cannot say which spec it hits. It did happen later (see finding 2), and its cause is not what 7c thought.

### What was found, and what was done (every one is fixed in this commit)

| # | Found by | What it was | The fix |
| ---: | --- | --- | --- |
| 1 | the brief (7c item 56) | A leader reading only page 1 of a report made during the event would not learn that answers were still arriving | Page 1 says, under "Made on", "This session had ended when the report was made." or, in bold, "This session had not ended when the report was made, so answers may still arrive." (`SESSION_ENDED`, `SESSION_NOT_ENDED`; `meta.ended`). The full "Session: ..." line is still on the last page. 1 PDF test (both wordings, order, bold, never alone on a page for 1 to 30 activities), 2 browser tests in 3 engines, the picture `test-results/report/not-ended-cover.png`. The 42 hand-worked counting tests and all 28 mutations are unchanged |
| 2 | the stale-socket log, then reproduced | **"other side closed" was a port collision.** The scratch servers took a random port from 5200-5599, which contains 5432, and PostgreSQL listens on 127.0.0.1:5432 and ::1. `server/index.js` binds the wildcard address, so it started without an error and printed "running", but every request to 127.0.0.1:5432 went to PostgreSQL, which closed the connection. About one start in 400, so about one full run in three, a different spec each time, and no retry could help (all four attempts met PostgreSQL). Reproduced on purpose: a server on `PORT=5432` prints "running" and the request fails with exactly that message | `scripts/free-port.js` asks the OS for a free port, and every test that started a server (the browser harness, `clients.spec.ts`, `admin-today.spec.ts` and nine node suites) uses it. `startLocal()` checks that its own server answers on the port. The fetch wrapper in `admin-local.ts` **no longer retries** (Phase 7c's four retries are gone): a request that fails that way fails the test and is written to `test-results/.stale-socket.log`. It did not fire in the final runs |
| 3 | WebKit, "fits" specs | A `<select>` in the admin is drawn natively by WebKit at about 27 px whatever `min-height` says (a 44 px target missed, and its focus halo ignored) | `.select` is drawn by us (`appearance: none`, a chevron, 44 px), in every engine |
| 4 | `contrast.spec.ts`, from pixels | **The focus ring touched the page.** A 2 px halo with a 1 px gap left the green ring against the page itself: 2.8:1 on the lighter part of a client's gradient, 2.3:1 on the admin's white | A band of dark on each side of the green with no gap: `box-shadow: 0 0 0 3px dark, 0 0 0 9px dark`. Now about 9:1 (participant) and 7:1 (admin). `base.css`, `admin.css` |
| 5 | the ring's picture | The admin's tab row scrolls sideways, so it clipped the ring at the top and bottom of a tab | Padding for the ring's room |
| 6 | the ring's picture | The admin's tab row is sticky, so the first Tab on Results scrolled "Refresh" under it, half its ring hidden | `html { scroll-padding-top: 5.5rem }` |
| 7 | `keyboard.spec.ts` | **Welcome and the hub did not move focus to their heading** (the question, completion, finale and not-live screens did) | `focusHeading()` on both. A screen reader hears the heading and Tab carries on from it |
| 8 | `keyboard.spec.ts` | In the admin, focus fell to the page after Unlock and after Lock, and after a wrong PIN | Focus goes to the first panel's heading after Unlock, to the PIN screen's heading after Lock, and back to the PIN field after a wrong PIN |
| 9 | axe ("needs review") | Two fields (Clients' name, the activity's name) had `aria-describedby` pointing at an error line that exists only after a failed submit | The attribute is set only then |
| 10 | axe (`color-contrast`) | Brand Studio's contrast report printed "Aa" in each pairing's colours, which for a pair that fails is text nobody can read (Domino's and the light look, at 1280 and 390 wide) | A swatch (a bar of the words' colour on the background colour), a picture only: the ratio and the result are in words beside it |
| 11 | `aria.spec.ts`, the live region's log | The reveal said "...Great Western Tea co.. Press Next" (an answer ending in a full stop got a second) | `gradedAnnouncement` adds a stop only if there is none |
| 12 | `reflow.spec.ts` | At 200% text size on a phone the answer pills reached 57 px past the edge (letter, words and verdict in one row); the activity pills the same at 320 px; the header's greeting was cut to "Hi Casey..." at 320 px; the admin's PIN card and brand block reached 70 px past a 320 px window (their padding was not counted) and the bar's title and name were cut at 200% | The verdict and the dot or lock go under the words when the line is short; the participant header wraps (the greeting and the sound switch on a second row); the admin card and bar count their padding and wrap. (A first attempt shrank the greeting to a letter a line: it passed the overflow check and was unreadable, which the pictures showed; the header wraps instead) |
| 13 | `devices.spec.ts` | **A device turned over in the middle of a question left the chosen answer off the screen** (an iPhone, portrait to landscape) | `lib/keep-in-view.ts`: if the chosen answer (or what has focus) was on the screen at the last scroll, tap or focus, it is put back in the middle after the window changes size |
| 14 | WebKit, `admin-guests.spec.ts` | The print sheet at 390 wide was measured a frame before its own zoom was applied (not a bug in the page) | The spec waits for the sheet to be brought onto the screen |
| 15 | the first three-engine run | Test plumbing: in Firefox a script's `focus()` is not a keyboard focus unless the last focus was one (`admin-content`, `live-display`); a `.or()` locator matched two elements (`admin-sharepoint`); Firefox's real full screen is its screen's size; Firefox draws a chart a frame late after a resize; two copies of the route proxy could throw when a page closed (`admin-today`, `clients`) | Each spec says what it does now (Tab instead of `focus()`, `.first()`, the window's own size, wait for the resize to settle, the same guard `admin-local.ts` has) |

### The engines (B)

The projects are Chromium, WebKit and Firefox; what does not run in an engine, and why, is four lists at the top of `migration/playwright.config.ts` (`CHROMIUM_ONLY_FILES`, `WEBKIT_NOT_RUN`,
`FIREFOX_NOT_RUN`, `ONLY_IN_CHROMIUM`), printed here as the matrix. Skipped and not-run are different: a test in a list never starts; a skip happens inside a spec with its reason.

| Spec | Chromium | WebKit | Firefox |
| --- | --- | --- | --- |
| `a11y.spec.ts` | 14 pass | not run | not run |
| `admin-content.spec.ts` | 17 pass | 16 pass | 17 pass |
| `admin-content-sharepoint.spec.ts` | 7 pass | 1 pass, 6 skipped | 1 pass, 6 skipped |
| `admin-guests.spec.ts` | 13 pass | 11 pass, 1 skipped | 12 pass, 1 skipped |
| `admin-sharepoint.spec.ts` | 5 pass | not run | 5 pass |
| `admin-smoke.spec.ts` | 1 pass | 1 pass | 1 pass |
| `admin-today.spec.ts` | 15 pass | 13 pass | 15 pass |
| `aria.spec.ts` | 2 pass | 2 pass | 2 pass |
| `brand-smoke.spec.ts` | 1 pass | 1 pass | 1 pass |
| `brand-studio.spec.ts` | 29 pass | 20 pass | 29 pass |
| `brand-studio-sharepoint.spec.ts` | 3 pass | not run | 3 pass |
| `clients.spec.ts` | 5 pass | 5 pass | 5 pass |
| `contrast.spec.ts` | 6 pass | not run | not run |
| `devices.spec.ts` | 20 pass | 20 pass | 20 pass |
| `effects.spec.ts` | 17 pass | 17 pass | 17 pass |
| `effects-audio.spec.ts` | 17 pass | 17 pass | 17 pass |
| `end-session.spec.ts` | 6 pass | not run | not run |
| `flow.spec.ts` | 34 pass | 33 pass | 34 pass |
| `focus.spec.ts` | 5 pass | 5 pass | 5 pass |
| `foundation.spec.ts` | 9 pass | 4 pass | 4 pass |
| `keyboard.spec.ts` | 3 pass | 3 pass | 3 pass |
| `latency.spec.ts` | 1 pass | not run | not run |
| `leader-report.spec.ts` | 10 pass | 7 pass, 3 skipped | 7 pass, 3 skipped |
| `live-display.spec.ts` | 17 pass | 14 pass, 1 skipped | 15 pass, 1 skipped |
| `live-display-sharepoint.spec.ts` | 9 pass | not run | 9 pass |
| `live-display-smoke.spec.ts` | 2 pass | 2 pass | 2 pass |
| `motion.spec.ts` | 3 pass | 2 pass, 1 skipped | 2 pass, 1 skipped |
| `participant.spec.ts` | 30 pass | 30 pass | 30 pass |
| `performance.spec.ts` | 1 pass | not run | not run |
| `polling.spec.ts` | 13 pass | not run | not run |
| `reflow.spec.ts` | 10 pass | 10 pass | 10 pass |
| `setup.spec.ts` | 9 pass | 7 pass | 9 pass |
| `sharepoint.spec.ts` | 8 pass | 7 pass | 8 pass |
| `unsupported.spec.ts` | 15 pass | 15 pass | 15 pass |
| **Total** | 357 pass | 263 pass, 12 skipped | 298 pass, 12 skipped |

What does not run, and why:

- **WebKit, the three SharePoint budget files** (`admin-sharepoint`, `brand-studio-sharepoint`, `live-display-sharepoint`) and three tests (the QR-scan budget and the two Setup self-tests): Playwright's WebKit drops the `boundary=` of a
  fulfilled `$batch`, so the page finds batching unusable and sends plain reads, and the request counts these specs assert are not what the page sends. Known and not "fixed". **Firefox does run them, and they pass**, so the budgets
  are held in two engines.
- **WebKit, seven keyboard walks** (the three Phase 5 and 5b admin ones, the participant pager's, the crop dialog's, and Full screen's two): Safari on a Mac does not Tab to buttons unless its own setting is on. `keyboard.spec.ts` covers WebKit with
  Alt+Tab, which is what Safari offers.
- **WebKit, nine tests that choose a photograph as a hero or logo** (`brand-studio.spec.ts`, one in `admin-today.spec.ts`): Safari cannot encode WebP, and says so in words when a photograph does not fit as a PNG (documented in AGENTS.md).
  `brand-smoke.spec.ts` runs the pipeline in WebKit with flat artwork and checks the message.
- **Firefox, one test** (Full screen at 1920x1080): Firefox's real full screen makes the window its virtual screen's 1366x768. The fit of every card at four sizes runs in Chromium, and the smoke spec runs full screen in all three.
- **WebKit and Firefox, five `foundation.spec.ts` tests**: the kiosk probe builds `TouchEvent` and `GestureEvent` objects (only Chromium has them) and one test reads the painted font through the DevTools protocol.
  `reflow.spec.ts` checks the same pinch rules with plain events in all three.
- **Chromium only, by file:** `end-session` and `polling` (Playwright's clock), `performance` and `latency` (the DevTools protocol), `a11y` (axe reads the DOM, which is the same in every engine) and `contrast` (arithmetic on pixels).

**The device shapes** (`devices.spec.ts`; all three engines): iPhone portrait 390x844 and landscape 844x390, iPad portrait 820x1180 and landscape 1180x820, iPad Pro portrait 1024x1366, a 1366x768 laptop and a 1440x900 desktop. On every participant
screen and state (welcome, hub with a current and a locked activity, a question unanswered, wrong, revealed and right, the activity done, the hub again with a finished one, tiles, every other kind of question, the finale, not live, ended) and
on every admin tab and the Live display: no sideways scroll, nothing sticking out of the window or cut off by its own box, 44x44 px on the touch profiles. **Safe areas**: Chromium was given emulated insets by the DevTools protocol
(`Emulation.setSafeAreaInsetsOverride`: iPhone portrait top 47 and bottom 34, landscape left and right 47 and bottom 21; every page of the device has them), and the header, greeting and Next bar were checked against them; WebKit and
Firefox cannot emulate insets, so for them the test shows that the stylesheets use `env(safe-area-inset-*)` on all four edges. **Turning the device over** (a resize in the middle of a question, with a right answer chosen and with a wrong one,
three turns, and back): the same question, the same choice, the action still there, the chosen answer still in view, nothing clipped (finding 13). Pictures: `test-results/devices/` (for example `iphone-portrait-participant-question-wrong-with-Retry.png`).

### Accessibility (C)

**axe-core at WCAG 2.1 A and AA** (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`; `@axe-core/playwright` 4.13.0, a dev dependency pinned exactly, MPL-2.0, and in no page: `test:bundle` checks all three, with a negative control):
**149 screens and states in all**: on the participant page (every screen and state above, in the default look, Kroger's and Domino's sample themes and a light-primary look, an extra pass on a phone, the "server cannot be reached" page and the
`?preview=<client>` page), the unsupported-browser notice on all three pages, and in the admin the PIN gate (and a wrong PIN), Today (nothing live, a client picked, live), Clients and its form, Brand Studio for all four looks, Content with its
Add and Copy dialogs, Guests and QR with guests, the print sheet, Results, the Live display and its full screen in all four looks, at 1280 and 390 wide, and the Setup page. A negative control (an image with no text, a button with no name, a field with no label and faint text) is
found by the same call.

| Rule | Where | Result |
| --- | --- | --- |
| `color-contrast` (serious) | Brand Studio's contrast report, the "Aa" sample of a failing pair (Domino's and light looks, 1280 and 390 wide) | **fixed** (finding 10) |
| `aria-valid-attr-value` (needs review) | the name field of the Add client form and of the activity form | **fixed** (finding 9) |
| anything else | the participant page in every state, every other admin screen | **none found** |
| **waived** | | **none** |

axe also returned 127 "needs review" items that are not failures, 127 of them `color-contrast` where it cannot decide (a gradient or picture behind the text, or an element partly under another), which is why contrast is also measured from pixels below.

**Keyboard** (`keyboard.spec.ts`, three engines; WebKit with Alt+Tab): the whole participant flow (Welcome, the hub, a graded activity with a wrong try, Retry and a reveal, tiles, a multiple choice with two picked by Space and the arrows, true or false, confidence, a ranking, a
written answer typed, the finale) and PIN, the tab row and Today to Go live in the admin, with the green ring (3px solid Deloitte green) on every stop, after each change of screen focus on the new heading and the ring on it, and no trap: two
off-screen buttons bracket the page, and Tab from the first must reach the last through every control that can be reached (a radio group is one stop, a date field's parts are several) and Shift+Tab must get back. Findings 7 and 8.

**Screen readers** (`aria.spec.ts`, three engines, `ariaSnapshot`): Welcome, the hub (a locked activity says why inside its own button, `aria-disabled`), a question unanswered, wrong, revealed and right, the activity's end and the finale: the banner, the `main`, the heading levels, the name of every button, the
answer `group` named by the question's own heading, the chosen answers `aria-pressed`, the progress as a `progressbar` with its numbers, and "Correct" and "Incorrect" as **text with an icon in the pill and a polite `role="status"` line**
(never colour alone). The live region's log over the whole walk: each wrong try announced once, the reveal once, each right answer announced. It is the tree each engine builds, not VoiceOver (QA item 64).

**Zoom and reflow** (`reflow.spec.ts`, three engines): the viewport tag of all three pages is `width=device-width, initial-scale=1, viewport-fit=cover`: **no `user-scalable=no` and no `maximum-scale`** (the plan found it blocking zoom; it does not now), and a pinch (WebKit's gesture events and a
two-finger `touchmove`) is not cancelled in a normal tab, no element sets a `touch-action` that forbids it, and `html` is not marked as a kiosk. With `?kiosk=1` all of those are cancelled, so the check can fail. At **200% text size** (390 and 820 px wide) and at **320 CSS px
wide** (what 1280 px is at 400% zoom): no sideways scroll, nothing sticking out, nothing cut off, on every participant state and every admin tab (finding 12; the 320 px at 200% text size case, stricter than WCAG asks, only has to not overflow). Pictures:
`test-results/a11y/reflow/`.

**Contrast** (`contrast.spec.ts`, Chromium): each piece of visible text (one box per line) is found, all text is then made transparent, the page is photographed, and the text's colour is compared with the **worst pixel behind it**; 4.5:1, or 3:1 for large text. The focus ring is
measured against the pixel on each side of it, in the second-lowest of four sides (a neighbouring control can sit in one side's band). Disabled controls are exempt; a locked activity's caption is measured and reported anyway. The lowest ratio found, per look:

| Look | Pieces of text | Lowest, normal text | Lowest, large text | Locked caption (exempt) | Focus ring, lowest | Where it is |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| default | 215 | **4.74** | 4.8 | 7.76 | 9.19 | "C" (span.letter, question, unanswered) |
| kroger | 216 | **4.74** | 4.8 | 7.76 | 9.19 | "C" (span.letter, question, unanswered) |
| dominos | 204 | **4.81** | 5.11 | 7.93 | 9.19 | "Check again" (button.pill-button, not live) |
| light | 215 | **4.58** | 4.58 | 7.17 | 9.19 | "C" (span.letter, question, unanswered) |
| admin | 1045 | **4.58** | 15.25 |  | 7.26 | "Answer pill" (span.brand__strip-pill, Brand Studio, light) |

(The light-primary look is Lemon Co, `#FFD400`, which the theme darkens until white words have 4.5:1; the "admin" row is every admin tab, Brand Studio in four looks and the Live display in four looks.) A negative control (faint text, a ring with a light band) is caught.

**Reduced motion** (`motion.spec.ts`): with `prefers-reduced-motion: reduce`, a whole participant walk (first-try right answers, a wrong try, four activities done, the finale) adds **no canvas at all** and runs **no animation or transition longer than 20 ms** (a recorder watches every frame);
with `no-preference` the same walk draws confetti and animates, so the check can fail. The Live display's Auto-advance still moves every 15 s, with no transition on the card, the controls or the display (Chromium: Playwright's clock).

### The unsupported-browser notice (D)

A short plain page, "This page needs a recent browser. Please open it in the latest Safari, Chrome, Edge or Firefox.", with the app name and the Deloitte wordmark as text, on all three pages (`migration/src/unsupported/`, `vite-plugin-unsupported.ts`, `lib/support.ts`; how it works is in AGENTS.md). Shown by `<script nomodule>`, by a feature test that runs
before the app (the six newest things it needs), by an `error` before the app has mounted (a module that cannot be parsed, or that throws at the top), and by `<noscript>`. **Tested in three engines on all three pages** (`unsupported.spec.ts`: each feature taken away by an init script; the module made inert and `nomodule` lifted, because no engine here lacks
module scripts; a broken module; a module that throws; scripting off; an ordinary browser never sees it, and an error long after mount does not bring it up), by 15 plain-logic tests (`test:unsupported`), and by axe. Pictures: `test-results/unsupported/` (`participant-webkit-820x1180.png`, `admin-firefox-390x844.png`, `participant-chromium-no-javascript.png`).
**Sizes (gzip -9, the project's counter):** participant **155,394 B** (153,512 B at the end of 7c: +1,882 B, of which the notice is about 900 B and the accessibility fixes the rest; allowance 2,048 B), admin **603,577 B** (13.8% under its 700,000 B budget), setup 52,012 B.

### Performance (E)

Chromium through the DevTools protocol: `Emulation.setCPUThrottlingRate` 4x, and `Network.emulateNetworkConditions` "Slow 4G" as Lighthouse defines it (1.6 Mbit/s down, 750 kbit/s up, 150 ms of round trip). The pages are sent gzip-compressed over a **real local HTTPS connection** at the approved host's own name (`https-site.ts`:
a Node server, a one-day certificate from `openssl`, `--host-rules`), and every SharePoint REST call is answered by the mocked site over that same connection, so the throttle applies to all of it (Playwright's `route.fulfill` bypasses it). Five cold runs for each (a new browser context each), the median reported with the fastest and slowest;
"usable" is the frame after the Welcome's "Click here to begin" is on screen and enabled (participant), and after Today is drawn (admin: the PIN is typed as soon as its field is usable). The mocked site answers at once: only the network's and the CPU's cost is in the numbers.

| Page | Condition | Median s (fastest to slowest) | PIN screen, s | Longest task, ms | Blocking, ms | Page KB sent | Flag |
| --- | --- | --- | ---: | --- | ---: | ---: | --- |
| participant (Welcome) | no throttling | **0.07** (0.07 to 0.14) |  | 0 (max 0) | 0 | 155.4 |  |
| participant (Welcome) | 4x CPU | **0.20** (0.20 to 0.21) |  | 51 (max 55) | 1 | 155.4 |  |
| participant (Welcome) | 4x CPU + Slow 4G | **1.69** (1.68 to 1.69) |  | 58 (max 71) | 8 | 155.4 |  |
| admin (Today) | no throttling | **0.19** (0.19 to 0.42) | 0.07 | 0 (max 0) | 0 | 603.6 |  |
| admin (Today) | 4x CPU | **0.58** (0.56 to 0.60) | 0.31 | 131 (max 140) | 191 | 603.6 |  |
| admin (Today) | 4x CPU + Slow 4G | **4.33** (4.33 to 4.36) | 3.22 | 143 (max 145) | 195 | 603.6 | OVER 3 s |

Nothing is clearly bad, so nothing was optimised. The one number over 3 s is the facilitator's page on Slow 4G with a 4x slower CPU: 4.33 s, of which 3.2 s is getting its 604 kB to the PIN screen (604 kB at 1.6 Mbit/s is 3.0 s), once a session, cold. The participant page, which ten iPads load, is usable in 1.7 s in the same conditions.
**Slow SharePoint** (`latency.spec.ts`): every request answered 800 ms late and the first write of an answer answered 429 with `Retry-After: 2`: Next showed the next question in under 600 ms every time (the save is in the background), the first answer was saved once (the refused write waited its two seconds and was retried, one create went through), the saves that were
out at the last answer were all done before the completion screen appeared, and there was one Responses item with one record for each question, also after a reload. **The earlier request budgets** (boot 8, QR scan 8 or 9, polling, Results, the Live display, the admin screens) are asserted by the same specs as before and pass in Chromium and Firefox (WebKit cannot batch).

### The device test sheet (F)

`DEVICE-TEST-SHEET.md` (in git history at `7347c72`): how to open the three test-site pages (`p_cec_02`), the day's set-up, then one page each for iPad Safari (24 checks), iPhone Safari (15), Safari on a Mac (12), Chrome (12), Edge (11) and Firefox (11), each a table of Check, How, Expected, Pass, Fail
and Notes, citing QA-TESTING.md's items, ending with "What to send back". It includes the printed QR scan, the name on Welcome, sound with the ringer switch on silent (iPadOS 17 or later), a right and a wrong answer, Retry and confetti, closing the tab and resuming, turning mid-question, pinch-zoom, a logo from Photos
(and a HEIC photo), the print sheet through the print dialog, the Live display full screen on the iPad and on a TV or projector, the report PDF and the CSV on the iPad and how they open, two iPads answering at once, Wi-Fi off and on, and an expired sign-in.

### Done differently from the brief, and why

- **The unsupported notice's heading is `role="heading" aria-level="1"`, not an `<h1>`.** The first version had an `<h1>` that was hidden and came first in the page, and two existing specs that look for "the page's first `h1`" found it (Brand Studio's preview-against-the-real-page comparison and the kiosk rule for Admin and Setup): both failed in WebKit and Firefox in the first three-engine run. The notice also is not hidden with the `hidden` attribute (Tailwind's layered `!important` rule beat the scripting-off rule).
- **The notice's feature test lists six things, not a dozen**: each is the newest of a group that implies the rest in every engine (`AbortSignal.timeout` implies `fetch`, `Promise.allSettled` and `URL`; `color-mix()` implies `:focus-visible`). It was trimmed for bytes, to leave margin under 2,048 B.
- **Edge was not run.** Playwright's `msedge` channel needs Edge installed; the sheet has an Edge page.
- **The performance spec serves the page over HTTPS from a small Node server** (and `openssl` makes its certificate) instead of fulfilling it from a route, because a fulfilled route is not throttled by the DevTools network profile. The latency spec does use routes (it needs only a delay).
- **The Tab walk in `keyboard.spec.ts` uses two off-screen sentinel buttons**, because engines disagree about what is focused once Tab has left the page; and a radio group is one stop.
- **Turning the device over is a resize** (`setViewportSize`), the nearest a desktop engine gets.
- **axe runs only in Chromium** and **contrast only in Chromium** (see above); the keyboard, aria, reflow, device and unsupported specs run in all three.
- **The old `fetch` retry was removed**, not extended (finding 2).
- **One CSS change was a mistake and was undone** (the greeting shrunk to a sliver, finding 12). The pictures are why it was seen.
- **Existing specs changed** (test plumbing and expectations, all listed in the table): `admin-content` (a keyboard focus, Firefox), `admin-sharepoint` (`.first()`), `admin-guests` (wait for the sheet's zoom), `live-display` (wait for a resize, Tab instead of `focus()`, the window's own size), `admin-today` and `clients` (the guard on `fulfill`, the free port),
  `focus.spec.ts` (+1 test), `leader-report.spec.ts` (+2 tests, 4 runs), `test-foundation.js` (7 files focus a heading, were 4), `test-pager.js` (+1 assertion), `test-leader-report-pdf.js` (+1 test), `test-bundle-budget.js` (+5 tests), nine node suites (the free port).

### Not verified

Nothing ran against the real tenant, on a real iPad or iPhone, with a real screen reader, on a projector, on paper, or in Edge or a real Safari: QA-TESTING.md items 59 to 68 (the engines are Playwright's; the safe areas are emulated in Chromium only; turning the device over is a resize; a real pinch;
no real old browser has met the notice; no screen reader was listened to; the contrast on a real display; the performance numbers are the mock's; the slow-SharePoint numbers are the mock's; VoiceOver on the two new heading focuses).

### Gate results at this commit

| Check | Result |
| --- | --- |
| `npm run check:svelte` | 0 errors, 0 warnings (387 files) |
| `npm test` | 519 pass (499 before: `test-unsupported.js` 15, one more PDF test, five more in `test-bundle-budget.js`) |
| `npm run test:report:mutations` | 28 of 28 caught |
| `npm run test:migration` | **918 pass, 24 skipped, 0 failed**, 32.3 minutes, three projects (the baseline was 327 pass, 9 skipped, 0 failed in 9.6 minutes, two). The 24 skipped are the specs that skip themselves in an engine, listed in the matrix. The first full run of this commit had 917 pass and 1 failed (a `route.fulfill` that threw when a page closed, in two specs' own copy of the proxy, in WebKit); fixed, the two specs passed in all three engines, and the whole suite was run again |
| `npm run test:styleguide` | 7 pass |
| `npm run test:bundle` | pass: participant **155,394 B** (+1,882 B against the 2,048 B Phase 8 allowance; ceiling 450,000 B and target 400,000 B unchanged), admin **603,577 B** (13.8% under 700,000 B), setup 52,012 B; no axe-core and no test tool in any page, with negative controls |
| `npm run test:build`, `npm run build:svelte:release` (both run by `test:migration`), `npm run test:build:svelte`, `:admin`, `:setup`, `:release`, `npm run validate:data` | pass (`server/data`, `public/` and `dataService.js` were not touched) |

## Phase 9a (2026-10-13): independent review and fixes

A fresh session reviewed Phases 1 to 8 as claims to test, not as evidence. The full list (each finding with its evidence, what was
reproduced and how, what is open and why, the decisions needed, the dependency and licence table, the audit and the sample-content
list) is `REVIEW-9A.md` (in git history at `7347c72`). In short:

- **Two High findings need a decision and were not changed**: staff mode on devices that share one sign-in puts two people on one
  visit (DI-1), and a signed-in device can read other clients' content and today's answer key, through `?preview=<clientId>` or
  SharePoint's own addresses (SEC-1). The runbook now says how to run a day without meeting the first.
- **Fixed, each with a test that failed first**: "Click here to begin" makes one visit however often it is pressed and no longer
  needs to write the session (`beginVisit`); a cut-off QR scan leaves no visit behind; a graded question that loses its key no
  longer strands a participant; ranking points after an option was removed; the Results screen's "completed"; an expired sign-in,
  a failed load and a page at the wrong address each say what happened; unsent answers go out when the server next answers; a
  shared tile picture is kept and a tile without its picture shows words; the CSV guard; a bounded `Retry-After`.
- **An independent oracle** (`scripts/oracle-results.js`, `npm run oracle`) recomputes every figure from raw stored rows and
  compares it with the report, its CSV and PDF, the Results screen and the Live display: 2,000 random sessions, 23,175
  participants, four time zones, 0 differences after the fixes (9 in the first 200 before, all the ranking points).
- `public/js/dataService.js`: one new export (`beginVisit`) and a change inside `openQrScan` (Phase 4's own; the legacy pages do
  not call it). Every function the legacy app uses is as it was. No SharePoint column was added.
- Sizes: participant 156,606 B gzip (+1,212; a `PHASE_9A` allowance of 2,048 B over Phase 8's 155,394 B), admin 605,002 B, setup 52,303 B.
- A QR scan on a site that cannot batch is 14 requests (13 with `batch: false`): one more than the 13 and 12 in the Phase 4
  follow-ups above. Where the site can batch it is still 8 and 9.

Nothing ran on the real tenant or a real device: QA-TESTING.md items 69 to 79.

## Phase 9b (2026-10-13): the decided fixes from the review

VJR decided what to do about the review's open items (`REVIEW-9A.md`, in git history at `7347c72`, has each finding's status). This phase applied those decisions and
nothing else. Everything ran against the local server and the mocked SharePoint REST; the real tenant and a real iPad were not involved.

- **A. DI-1, staff mode on a shared sign-in: a rule and a warning.** Today says, beside "How people are identified" and as a readiness warning that never blocks Go live,
  that staff mode needs one sign-in per person and that iPads sharing one must use Guests scan a personal QR. `boot.js` and the visit logic are unchanged.
- **B. SEC-1, `?preview=<clientId>` marks no right answer;** the iPads are locked on the day (SHAREPOINT-DEPLOYMENT.md: Guided Access, or a managed single-app profile; the route
  still shows other clients' questions to anyone who can type an address). The Phase 6 test that asserted the marks now asserts their absence, on purpose.
- **C. DI-6, one damaged answer item no longer stops a session's results.** Additive reads return the readable answers and an `unreadable` list; Results, the Live display and the
  leader report say "N participant(s)' answers could not be read and are not counted: ...". The oracle damages items at random. (Results is now built on `buildResults`.)
- **D. DI-9, Remove a visit that has no answers,** from Results, with a re-read first, never on an ended session, never touching a QR code or the roster; a page that holds the
  removed visit says what to do next.
- **E. SAM-1 and SAM-2.** Kroger has no logo (and the old address counts as none on a site seeded earlier); the two sample clients say "Sample content" until confirmed (who and
  when stored in `ThemeJson`), and the leader report's cover says so too.
- **F. DEP-1,** Setup's Check Lists lists "Please check by eye": type and index warnings, never blocks, with a note on `Order` versus `Order0`.
- **G. Short addresses and two tenant probes.** Reads of many ids go in groups of 20 (at most 1,500 characters at 15 and at 60 questions, on both adapters); Setup's Run self-test
  asks the tenant two read-only questions (a Yes/No filter written three ways; how long a `$filter` it accepts).
- `public/js/dataService.js` only grew: `readSessionResponsesChecked`, `removeEmptyVisit`, `probeSharePointRead`, a `tolerant` option on `readLiveFeed`, `withFields` on
  `checkSharePointSchema`, extra steps for `runParticipantSelfTest`, and `getSectionQuestions` reads in groups of 20 beyond 20 questions. No legacy function changed
  (`getSessionResults`, `getSessionResponses`, `deleteClientTrack`, `getSectionContent`). No SharePoint column was added.
- Left open on purpose: DI-2, DI-8, SEC-4 and SEC-6 to SEC-9. SEC-2 (the PIN) is replaced by hand with the runbook's command before the event.

Tests changed on purpose, because the behaviour they pinned was decided away: `brand-studio.spec.ts`'s `index.html?preview=<clientId>` test (it asserted the right answer was marked; it now asserts that nothing is), the specs and fixtures that used Kroger's drawn logo (`clients.spec.ts`, `aria.spec.ts`, `brand-studio.spec.ts`'s older-logo test, `test-seeds.js`, `test-brand.js`), the Content keyboard order (`admin-content.spec.ts`: "Mark as confirmed" is a stop), the readiness warning count (`admin-today.spec.ts`: three, not two) and the self-test's steps (`setup.spec.ts`: nine steps, 20 requests).

| Gate | At Phase 9a (`32822b8`) | At Phase 9b |
| --- | --- | --- |
| `npm run check:svelte` | 0 errors, 0 warnings (390 files) | 0 errors, 0 warnings (398 files) |
| `npm test` | 573 pass | **650 pass, 0 fail** (77 more than at 9a: `test-review-9b.js` is new, with 25; the rest are in `test-participant-storage.js`, `test-live-display.js`, `test-admin-today.js`, `test-oracle.js`, `test-leader-report.js` and `test-bundle-budget.js`; a test inside a loop over both adapters counts twice) |
| `npm run test:migration` | 933 pass, 24 skipped | **973 pass, 26 skipped, 0 fail** (33.3 min). The two new skips are the axe test in WebKit and Firefox, which skips itself (axe reads the DOM, the same in every engine) |
| `npm run test:styleguide` | 7 pass | 7 pass |
| `npm run test:bundle` | participant 156,606 B, admin 605,002 B, setup 52,303 B | participant **157,359 B** (+753 B against the 1,500 B `PHASE_9B` allowance; ceiling 450,000 B unchanged), admin **607,575 B** (budget 700,000 B), setup **54,920 B** (+2,617 B: it carries the by-eye table, the probes, and the data service's additions) |
| `npm run test:report:mutations` | 30 of 30 caught | 34 of 34 caught (four for this phase's report rules) |
| `npm run oracle -- --seeds 500` | 0 differences | **0 differences** (5,620 participants; 114 of the 500 sessions have a damaged participant item and 11 a damaged shared item, and the app named exactly the damaged ones in the report, on Results and on the Live display, on both adapters) |
| `npm run validate:data` | pass | pass (`server/data` changed only in Kroger's logo, the `sample` marker on both clients, and `theme.json`'s logo) |

Each new or changed browser test was run five times in each of the three engines (ten times for the Phase C and D specs) before it was called done; the axe test runs in Chromium only.
Every figure comes from the local server and the mocked SharePoint REST on one Mac; none of it came from the real tenant, a real Safari or a real iPad.

Nothing ran on the real tenant or a real device: QA-TESTING.md items 80 to 87.

## Phase 9c (2026-10-13): the release package

No behaviour changed: `scripts/site-override.js` (`PMS_SITE_URL` / `PMS_BATCH`, build-time only), `scripts/build-third-party-notices.js` (LIC-1, a proposal) and a release package `build-svelte/package/pms-<hash>/` with checksums and release notes (SHAREPOINT-DEPLOYMENT.md, "Using the release package"); the three pages are byte for byte what the Phase 9b tree builds, `npm test` 668 pass, and nothing here met the real tenant or a real device.

## Phase 10b (2026-10-13): deployment settings and the list namespace

One set of built pages can now be uploaded anywhere, with its own lists and no source edit. VJR's decisions 1 to 4 of
`ARCHITECTURE-10.md` (in git history at `7347c72`) section 10 were made as recommended (the legacy app stays frozen and the commit this phase started
from is tagged `legacy-final`, locally; a list prefix with per-list overrides, `PMS3` for the first deployment and none built in; settings in
`pms-config.json` beside the pages over values built into them, never a silent default; Setup creating lists is Phase 10c and none of it is here).

**What has and has not been proven.** Everything here ran against the local Express server and a mocked SharePoint REST. None of it has met the real
tenant or a real device. The failure this phase exists to prevent is silent (a page that reads another copy's lists and works), so most of the new
tests are about making that visible; whether a real document library serves the settings file to a page at all is QA-TESTING.md item 88.

### What changed, part by part

| Part | Commit | What |
|---|---|---|
| A | `5a7afa5` | **The request baseline, before any change.** Every SharePoint REST request ten mocked node suites send (20,413 requests, 842 distinct) and the built participant page's start-up in three engines, recorded at `2ad1520` into `scripts/request-baseline/`, with a test that compares a fresh recording (`scripts/test-request-baseline.js`, `request-baseline.spec.ts`). The recorder is a preload; no suite and no mock was edited to be recorded. |
| B | `b69613f` | **The settings resolver** (`lib/deploy-settings.js`): one pure function from the page's address, the settings file and the built-in values to the settings, where each came from, and what is wrong. `pms-config.example.json`. |
| D | `48a7bf6` | **The namespace in the data layer**, additive: a list's title is `settings.lists[key]`, else `settings.listPrefix` and the usual title, from one function that every address and every message uses; the picture library defaults to `<prefix>ClientLogos`. The fake holds a plain and a prefixed set of lists. Setup's check-by-eye table is keyed by list key. |
| C | `ba74e4f` | **Reading the file, and the guard.** The three entries read `pms-config.json`, resolve, configure the data layer, then mount; a stop screen on a problem; Setup opens anyway with its actions off; `dataService.requireConfiguration()`. The entries no longer import `public/config.js`. |
| E | `1f62a3f` | **Build values without string replacement**: seven `PMS_` values as one bundler constant, each held to the rule a page applies. `scripts/test-svelte-release.js` no longer pins the production host. |
| F | `2a4ea48` | **The tests of the namespace**: every mocked suite states its settings and ends with a no-stray test; nine run a second time on `PMS3` lists; browser cases; budgets restated. |
| G | `711f7bf` | **What the deployer sees**: Setup's "This copy of the app", "Where the lists are" with the probe by address, the label in the admin bar. |
| H | this commit | Documents. |

**D was done before C, on purpose.** As first built, C would have left a commit in which pages accepted `"listPrefix": "PMS3"` while the data layer
still ignored it: exactly the silent failure, at a commit boundary. So the data layer learned the prefix first. Part of E (the bundler constant, for
the two values that already existed) had to land with C for the same kind of reason: removing the import of `public/config.js` is what disables the
old search-and-replace, and a build with `PMS_SITE_URL` set would otherwise have been ignored without a word.

### The request baseline: identical

With no prefix in the settings, the data layer sends character for character what it sent before. The comparison (method, address without host,
and the reads inside each `$batch`, as a count for each distinct request; UUIDs and instants are placeholders; order is not compared) was run after
every part that touched the data layer or the start-up, and never showed a difference:

| After | Node suites (10) | Participant start-up in a browser (Chromium, WebKit, Firefox) |
|---|---|---|
| D (the namespace) | identical | identical, 15 of 15 runs |
| C (the start-up) | identical | identical, 15 of 15 runs (the page's one request for its settings file is not a REST request and is not in the log) |
| F, G and the end gate | identical | identical |

One count in one suite depends on timing (a poll that fits one more look into a test on a faster run: 142 to 148 times over eleven recordings) and is
marked `~` in `test-participant-storage.txt`; its address is still held. No baseline was regenerated. A stronger form of the same check is in
`scripts/test-list-namespace.js`: nine suites run again on `PMS3` lists send **exactly the baseline's requests with `PMS3` in front of each title**, and
nothing else differs.

**The negative control, by hand.** With one list (Tracks) made to forget its prefix in `dataService.js`: on plain lists nothing failed, in any suite.
On `PMS3` lists the storage suite failed 15 tests, and the Today and Live display suites failed **only** their "no request of this suite reached a
list that is not its own" test, 48 and 32 other tests passing on the wrong lists. That is what the two-set fake and the last test of every mocked suite
are for.

### What differs from the brief and from ARCHITECTURE-10.md (in git history at `7347c72`), and why

1. **The legacy build's bytes changed** (ARCHITECTURE-10.md 3.6 (in git history at `7347c72`) and the brief say they must not). They cannot stay: the legacy pages bundle
   `public/js/dataService.js`, which this phase had to change. What did not change is their source (`public/config.js`, the pages,
   `public/js/screens`, `scripts/build.js`: `git diff legacy-final -- public scripts/build.js` shows `public/js/dataService.js` and nothing else) and
   their requests (the baseline, which includes the legacy functions' own suite). SHA-256 of `build/` at each step, to the first eight characters:
   at `legacy-final` `beb725b3` / `53a9f09b` / `0e96eee1` (index, admin, setup); after D `8541e5f4` / `317ac2fe` / `d4ef71e2`; after C `50e0d45d` /
   `e5797bdf` / `01eb654a`; **after E, unchanged** (the build-values work touches nothing the legacy build reads, with or without `PMS_` values in
   the environment); after G `50e0d45d` / `2ca11cd9` / `01eb654a` (the read-only probe gained an argument; only the legacy admin page keeps every
   export). `npm run test:build` passes at each.
2. **The participant and admin pages do not carry the six-part wording.** Carrying the resolver with every rule in words, the four problems in six
   parts and a styled stop screen cost 4,076 B gzip on the participant page against a 1,500 B allowance. So every page carries only what DECIDES
   (yes or no for each rule, and a problem as a code and a place), and shows one short stop screen: "This page cannot start", one sentence, "open
   Setup (setup.html, in this folder) to see what is wrong", **Try again**, and `Details: PMS-CFG-002 invalid lists.qrtokens`. The four problems in six
   parts (`lib/deploy-problems.js`) and the rules in words (`lib/deploy-rules.js`) are Setup's, where that screen sends the person. A test puts every
   case to both and fails where they disagree. The stop screen therefore has no "who to ask" line; Setup has it.
3. **The resolver has no list of the thirteen lists.** It takes the keys and usual titles from the data layer (`sharePointListTitles`), so there is
   one copy fewer of the schema, and the brief's "a test fails if the two lists differ" became "a test holds that the resolver accepts exactly the
   data layer's keys".
4. **Rules added to section 2.1's table:** two lists (or a list and the picture library) that would end under one title are refused, comparing as
   SharePoint does (no case); a title may not start or end with a space; a key that is inherited and not a setting (`toString`) is refused like any
   unknown key (a test found the deciding file accepting it).
5. **Smaller things.** A read that timed out and one that had no connection are one kind (`unreachable`). **Try again** reloads the page (nothing has
   started that a reload could lose). The site check compares addresses as a browser writes them, whatever the case of the letters; it does not treat
   `%28` and `(` as the same. The empty prefix as a build value is two quotation marks (`PMS_LIST_PREFIX='""'`), because a variable that is merely
   blank must not mean "production's lists". Setup's Build row names the build (`pms-<commit>`) and no schema version: that is Phase 10c's.
6. **"The four looks."** The stop screen and Setup do not wear a client's look: each has one. axe ran on the stop screen on both pages at two widths
   each, on Setup's panel in order, with each problem and on the local server, on the list rows after reading, and on the admin bar with a label, with
   no finding and no waiver; and on the styleguide's samples of the panel and the rows under each of its four palettes.

### Tests whose meaning or expectation changed

- `scripts/test-review-9a.js` and `review-9a.spec.ts`, finding FH-3: they held the message "This page is not set up for ...", which Phase 9a showed when
  a page was opened at an address other than the one in `public/config.js`. A page is no longer built for one address, so the message is gone; the
  tests now hold what replaced it (any `https` address that is not this computer is SharePoint; with nothing naming its lists the page stops with
  `PMS-CFG-001` before either app is mounted, having asked for its settings file and nothing else).
- `scripts/test-svelte-release.js`: it required the production host inside every page. It now requires the opposite (no site and no prefix built
  in) and that each page looks for its settings file and can say it has not been set up.
- `scripts/test-site-override.js`: rewritten for the bundler constant (the plugin it tested no longer exists); the refusals for `PMS_SITE_URL` and
  `PMS_BATCH` are the same sentences.
- `scripts/test-bundle-budget.js`: Phase 9b's allowance became a record (753 B) and Phase 10b has the live one; "before public/config.js runs" became
  "before the page looks for its settings file".
- `scripts/test-foundation.js`: eight screens focus a heading by script, not seven (the stop screen).
- `scripts/test-participant-storage.js`: the list of exports gained `requireConfiguration` and `sharePointListTitles`. In it and nine other suites the
  data layer is configured with `fake.settings` (an explicit prefix) where it was `{ siteUrl }`, a dozen assertions that spelled a plain list title
  compare through `plainTitles()`, and each suite gained the no-stray test.
- `sharepoint.spec.ts`: the budgets also assert one request for the settings file.

### Budgets and sizes

The participant's first screen on SharePoint is **8 list requests plus 1 for the settings file** (a small static file from the page's own folder, on
every load, before anything else); a first QR scan 8 plus 1; the device that starts a session on a QR scan **9 plus 1**; where a site cannot batch,
14 plus 1. No file is asked for on the local server. Whether SharePoint counts that file toward throttling the way it counts list requests is not
known.

| | At Phase 10a (`2ad1520`) | At Phase 10b (the code of `711f7bf`) | Budget |
|---|---|---|---|
| Participant page, gzip | 157,359 B | **158,807 B** (+1,448) | +1,500 B for this phase (`PHASE_10B`); ceiling 450,000 B, target 400,000 B |
| Admin page, gzip | 607,575 B | 609,327 B (+1,752) | 700,000 B (the brief asked for under 612,000) |
| Setup page, gzip | 54,920 B | 62,502 B (+7,582: the panel, the list rows, the probe and all the wording) | none |

The participant page is 52 B inside its allowance. That took three rounds: 4,076 B over the Phase 10a size as first built, 1,696 B once the
wording was Setup's alone, 1,448 B after the reader, the stop screen and the site check were made smaller. Anything more that every page must
carry has to be paid for.

| Gate | At Phase 10a | At Phase 10b |
|---|---|---|
| `npm run check:svelte` | 0 errors, 0 warnings (398 files) | 0 errors, 0 warnings (406 files) |
| `npm test` | 668 pass | **894 pass**, 0 fail |
| `npm run test:migration` (Chromium, WebKit, Firefox) | not re-run in 10a (973 pass, 26 skipped at 9b) | **1,033 pass, 26 skipped, 0 fail** of 1,059, in 35.3 min |
| `npm run test:styleguide` | 7 pass | 8 pass |
| `npm run test:bundle` | pass | 19 pass |
| `npm run test:build` (the legacy pages' packaging) | pass | 4 pass |
| `npm run test:build:svelte:release` | fails any page not built for the production host | 1 pass (it now holds the opposite) |
| `npm run test:report:mutations` | 34 of 34 | 34 of 34 |
| `npm run oracle -- --seeds 500` | 0 differences | 0 differences (5,620 participants, four time zones, 50 sessions also on the local server) |

Every new or changed browser test was run five times in each of the three engines before its part was committed: `request-baseline.spec.ts`
(15 of 15, after A, D and C), `settings-file.spec.ts`, `setup-deployment.spec.ts` and `sharepoint.spec.ts` (310 of 310 and 255 of 255), and the stop
screen's tests in `focus.spec.ts`, `keyboard.spec.ts` and `review-9a.spec.ts` (60 of 60).

### What is open

- **Nothing here has met the real site** (QA-TESTING.md, items 88 to 96): that the library serves `pms-config.json` to a page's request, what it
  answers for a missing file (the page needs a plain 404 to fall back to built-in values; anything else stops it, which is the safe side), what a
  signed-out browser gets, the list address rows and the probe, and the throttling of one more request per load.
- **The `PMS3...` lists do not exist anywhere.** Creating them is Phase 10c. Until then a copy with that prefix can only show Setup's panel and report
  its lists missing.
- **Two copies with the same prefix share their lists**, and nothing can prevent that (a copied folder with a copied file). The label and Setup's panel
  make it visible.
- **Package `pms-8fe2daa` is superseded**: the three Svelte pages' bytes and checksums changed in this phase. The next package is Phase 10f's; a
  scratch package for a read-only look is described in the report of this phase and is not committed.
- One run of the full browser suite, started while other work was going on at the same machine, failed one test once (the focus ring's contrast in the
  "light" look, a pixel measurement); it passed seven times out of seven alone and in the end gate. Noted here in case it is seen again.

## Fix (2026-10-13): assigning activities proves what it did

**The report.** A tester on the p_cec_03 site: "Unable to assign activities to Kroger client. It shows assigned on the popup, but they are not shown on
Kroger's activities. No error shown either."

**What was found** (read from the code, then reproduced against the mocked SharePoint by the tests that open this fix; the six points of the brief were each
checked, and all six hold):

1. The flow is `AdminContent.svelte` `confirmAssign()` -> `dataService.assignActivitiesToClient()` -> one `updateItem('sections', id, { clientId, order })`
   each, then the screen reads the activities again. Setup's button, `assignUnownedSections()`, has the same shape.
2. With SharePoint behaving like the mock the logic is right. What it could not do was notice when it was not. An activity another admin had assigned a moment
   earlier was skipped and the toast never mentioned it; an activity deleted meanwhile was dropped with a `console.warn` and appeared nowhere; both ended as
   "Assigned 0 activities to Kroger. Switch the client above to see them." in the green style.
3. Nothing was read back, so a write SharePoint answered as done and did not keep was reported as assigned. **This is the one that fits "shows assigned, is not
   there, no error"** and the only one that needs nothing else to go wrong; it is also the one nothing here could show on the real list.
4. A failure to add the activities to the live session was swallowed (`.catch(() => {})`); copying reports it as `liveSessionSynced`, assigning did not.
5. The activities were read with one address that grew about 53 characters per id: 60 UUID ids on the longest site address were 3,185 characters (the code's own
   safe limit is about 2,000; every other read uses groups of 20).
6. The 15-second look at the activities checked `assign` when it started but not when its answer came back, and `confirmAssign` did not set `busy`: an answer
   that was slow (a throttled read waits `Retry-After`) could put the old list back after the assign.

**What changed**, in the order of the commits:

| Commit | What |
|---|---|
| `485cceb` | The tests, red on purpose (14 of 20 failed, each on the bug it describes): `scripts/test-admin-assign.js`, and `fake.rewriteMerges()` in `scripts/sharepoint-fake.js` (a MERGE answered as done that stores nothing, or something else; a test tool). |
| `f7aae43` | **`migration/src/lib/admin-assign.js`** `assignActivities(api, ids, clientId)`: reads in groups of 20 with the client's own activities in one `$batch`, reports `missing` and `takenBy`, **reads the writes back** and moves any activity the list does not hold into `failed` with a plain message naming the activity, the list and the `ClientId` column, reports `liveSessionSynced` (true, false or null) and `checked`. **`lib/setup-assign.js`**: Setup's button with the same read-back (`unconfirmed`). **`assignOutcome()`** in `admin-content.js`: the toast. The new suite is recorded in `scripts/request-baseline.js`. |
| `fe7a015` | The screens: Content calls the above, sets `busy` for the assign and drops an out-of-date look (an `epoch` that every assign bumps, besides the `assign` and `assignBusy` checks); Setup lists what was not kept under the button. Two browser tests in `admin-content.spec.ts`, one in `setup.spec.ts`. |
| this commit | Documents: this section, QA-TESTING.md items 97 and 98, AGENTS.md, and `FIX-ASSIGN-REPORT.md` (in git history at `7347c72`). |

**Where the code is, and why not in `dataService.js`.** The brief put it there. A prototype cost **+400 B gzip** on the participant page, which carries all of
`dataService.js` and had **52 B** left of the Phase 10b allowance (158,807 B against 158,859 B), so `test:bundle` failed; and the read-back adds requests that
change the recorded request baseline of two suites (`test-admin-content`, `test-participant-storage`). Nothing was raised or re-recorded: the logic is admin-only,
built from the data service's public calls (`getClient`, `readLists`, `updateSection`, `runPaced`, `addSectionsToLiveSession`, `listSections`,
`sharePointListTitles`), which the modules are handed and do not import (a test says so). `public/js/dataService.js` is byte-identical to Phase 10b's;
the participant page is unchanged at 158,807 B; all ten earlier request baselines compare identical. **`dataService.assignActivitiesToClient` and
`assignUnownedSections`, and their tests, are left as they were. No screen calls them any more; they are removed in the next phase.**

**The words.** Everything assigned: unchanged (`Assigned 1 activity to Kroger. Switch the client above to see it.`). Some left out: `Assigned 2 to Kroger. 1 was
not assigned: it already belongs to Domino's.` (or `it no longer exists`). Nothing assigned: never green and never "Assigned 0": `Nothing was assigned. The 2
activities already belong to Domino's, so someone else may have just assigned them. The list on screen has been refreshed.` A live client whose session could not
be updated gets the sentence the copy uses, and the toast is then blue, not green. The list is read again after every assign, also when nothing was assigned.

**Measured (mocked SharePoint).** Three activities: 13 requests before and 13 after (one `$batch` of two reads replaces two plain reads; the read-back is one
plain read). Sixty UUID-id activities on the longest site address: longest address 1,381 characters (3,185 before). Admin page 611,153 B gzip (+1,826 B, 88,847 B
under its budget); Setup 62,987 B (+496 B); participant unchanged.

**What is not proven.** Nothing here has run on the real tenant, so **it is not known which of the six was the tester's.** What is true is that the screen now
tells the truth in each case, and that when SharePoint accepts a change and does not keep it, it says so and names the list and the column. QA-TESTING.md items 97
and 98 are the manual checks: assign two activities on the real site and look at the `ClientId` column of the `Sections` list. Also not done: the other long
actions on Content (duplicate, delete, reorder, the live switches) have the same kind of out-of-date-look hazard as the assign had and were not changed; and the
refresh guard was shown to fail without it by hand (the guard taken out, the test red), not by a test that removes it.

## Phase 10c-1 (2026-10-13): the clean break

**In plain words.** The repository now builds, tests and documents one app. The frozen legacy app, which had been kept beside the Svelte pages as a way back,
left the branch: VJR decided on 13 Oct 2026 (evening) that the new build is a new project on a new SharePoint site with new lists, that no data moves from the
old site, and that the old site keeps running the files already uploaded there. This phase removed code and moved code. **It changed no behaviour of the new
pages**: no list title, no column, no request, not the PIN check, Setup, Go live, the participant flow or the report. The full account, with every file, every
test and every baseline entry, is `CLEAN-BREAK-10C1.md` (in git history at `7347c72`). The decisions are recorded in
`ARCHITECTURE-10.md` (in git history at `7347c72`), section 10.

**Where the legacy app lives now.** In the local tag `legacy-final` (`2ad1520`) and nowhere on the branch. The tag was not moved and nothing was pushed. To build
the legacy pages again: `git worktree add ../pms-legacy legacy-final`, and follow that copy's own documents. The old site (`CreativeExpCOE`, folders `p_cec_01` and
`p_cec_02`) is not touched by anything here.

### What went

| | Files | B |
|---|---|---|
| The three legacy page shells and the manifest | 4 | 5,585 |
| The screen templates (`public/screens`) | 14 | 16,253 |
| The legacy screens and admin panels (`public/js/screens`) | 16 | 92,242 |
| `public/js/app.js`, `kiosk.js`, `sfx.js`, `vfx.js`, `sharepointSetup.js` | 5 | 33,931 |
| The placeholder audio | 12 | 45,924 |
| The drawn Kroger stand-in (the folder stays, with a `.gitkeep`) | 1 | 344 |
| `public/config.js` | 1 | 271 |
| The legacy build and its test (`scripts/build.js`, `test-build.js`, `copy-vendor.js`) | 3 | 10,929 |
| The three modules that inlined pictures from `public/assets/images` into the pages | 3 | 1,726 |
| **Removed** | **59** | **207,205** |

With them: the `npm` scripts `build`, `test:build` and `postinstall`; the legacy build at the start of `npm run test:migration`; the `/p_cec_legacy` route of the
test server; two Playwright tests that opened the legacy pages (six runs, in three engines); and eleven unit tests whose whole subject was the legacy app or a
function only it called.

**From the data layer** (`public/js/dataService.js`, 131 exports to 115, 126 lines): the ten exports nothing called, the four only the legacy pages called
(`getActiveSessionContext`, `setActiveSession`, `saveResponses`, `uploadClientLogo`), the two old assign functions that the assign fix had replaced, and the
internals only those reached (the legacy upload to the picture library, the writer of several answers at once). The rule that this file "only ever grows" went
with the legacy app; `scripts/test-participant-storage.js` now pins the whole export list.

### What moved

| From | To | Changed |
|---|---|---|
| `public/js/screens/admin/auth.js` | `migration/src/lib/admin-pin.js` | its import of the data layer, and two old names in its opening comment. The hash, the comparison and the answers are what they were. |
| `public/js/screens/admin/sha256.js` | `migration/src/lib/sha256.js` | nothing: byte for byte the same |

The five modules and three style sheets the pages still import from `public/` stay there until Phase 10e decides the layout, and say at their top whose they are.

### The proof that nothing a page does changed

The request baselines (`scripts/request-baseline/`, `npm run test:baseline`). A baseline is never regenerated to make a comparison pass, so a test that is removed
needed a narrow way to take its own requests out: `node scripts/request-baseline.js --amend <suite> --tests '<pattern>'`, which refuses unless the suite as last
committed still sends its baseline and every test that was not named sends what it sent, and prints every entry it changes. The work was ordered so that the two
cannot be confused: first the tests, in commits that touch no code (five amendments, 215 entries in four files, every one listed in the report), then the code, in
a commit where all eleven suites are identical and no baseline file is touched.

### Gate results

| Gate | Before (`84b802d`) | After the data layer shrank (`0b665fc`) |
|---|---|---|
| `npm run check:svelte` | 408 files, 0 errors, 0 warnings | 405 files, 0 errors, 0 warnings |
| `npm test` | 917 pass | 914 pass, 0 fail (11 tests removed, 8 added: six for the amend operation, one for the pinned exports' guard, one for this phase's budget) |
| `npm run test:baseline` | identical | identical |
| Participant page, gzip | 158,807 B | **157,460 B** (1,347 B smaller) |
| Admin page, gzip | 611,153 B | 609,507 B |
| Setup page, gzip | 62,973 B | about 61,750 B (it carries the build's name, so it differs by a few bytes from commit to commit) |
| `npm run test:migration` | 1,068 tests: 1,042 pass, 26 skipped | 1,062 tests: 1,036 pass, 26 skipped, 0 failed. Chromium 397, WebKit 302, Firefox 337 |

`PHASE_10C1` in `scripts/bundle-budget.js` records the smaller participant page (no allowance: the phase only removes), so the next phase is counted from it.
The final run of every gate, with the mutation and oracle results, is in the report.

### Found on the way

- **Seven exports of the data layer that no page calls could not go.** `joinSession`, `claimQrToken`, `saveResponse`, `getSessionResponses`, `getSessionResults`,
  `listVisitorRoster` and `listUserVisitLogs` are the set-up or the reference of tests of the new build (about 70 call sites in six recorded suites). Removing them
  means those tests send other requests, which is a re-recording of most baselines and not a clean break. **A decision for VJR**; recommended with Phase 10c-2,
  which records every baseline again for the new list names. A test fails if a page calls one.
- **One flaky browser test, which was a race in the test.** `keyboard.spec.ts` counted the Tab stops of Today before Today had finished loading (1 failure in 1,062,
  then 15 passes in 15 repeats). It now waits. This is the one change of the phase that is not part of the clean break.
- **One timing-sensitive unit test failed once in about ten runs** (`test-participant-storage.js`, "recording never waits for the network": it allows 50 ms of wall
  clock, and failed while eleven suites were being recorded at the same time). Not changed; noted.
- **The modules that inlined pictures were a hazard**, not only dead: a release built on a machine where someone had uploaded a logo through the local server would
  have carried that logo inside all three pages. Two corner cases behave differently without them (an address the browser cannot parse; an address that is the name of
  a built-in method); neither is a picture anyone has.
- **Setup's self-test still says "set batch: false in public/config.js"** when `$batch` is refused. That file was the legacy pages'; the setting is `"batch": false` in
  `pms-config.json`. Wrong since Phase 10b; Setup's wording was not this phase's to change.
- **The local admin's participant link points at the local server's port**, where the legacy participant page used to be and no page is now (`lib/admin-links.ts`).
  Local development only; SharePoint is not affected.

### What is not proven

Everything ran against the local Express server and the mocked SharePoint REST. Nothing has run on the real tenant or on a real device, and the new site has not
been touched. `npm install` was not run (on this Mac it removes hand-restored binaries): that `npm install` works with no `postinstall` was established by reading
what the script did, and VJR should confirm it on a clean copy (QA-TESTING.md item 99). Items 100 and 101 are the PIN after the move and local development without
the legacy pages.

## Phase 10c-2a (2026-10-14): what the new project no longer has

**In plain words.** The new build goes to a new SharePoint site with new, empty lists. Some code existed only because the app once shared its lists and its
data with the legacy app and the old site: functions only the legacy pages called, the one answer item a session used to have, the legacy look's list, and ways
of coping with records that only older data could hold. This phase took those out, and it changed three queries that the architecture review had flagged. **It
kept today's list titles and column names** (the new names are Phase 10c-2b), added no schema file, no provisioning and no redesign, did not touch the PIN, and
did not change how answers are counted: the oracle (500 generated sessions, counted again by rules of its own) found 0 differences before and after, and the 34
mutations of the leader report are still all caught. The full account, with every call site, every test and what became of it, is
`DROPS-10C2A.md` (in git history at `7347c72`); every request-baseline entry that moved is in
`DROPS-10C2A-BASELINES.md` (in git history at `7347c72`).

**Everything ran against the local server and the mocked SharePoint REST. Nothing has run on the real tenant or a real device.**

### What went

| Part | What | In numbers |
|---|---|---|
| B | The seven exports of the data layer that no page called (`joinSession`, `claimQrToken`, `saveResponse`, `getSessionResponses`, `getSessionResults`, `listVisitorRoster`, `listUserVisitLogs`), with what only they reached, and `setCurrentTrack`. Tests now take the steps a page takes and hold results to numbers written in the test or to the oracle. | exports 115 to 107 |
| C | Everything that read, cleared or created a session's own item in `Responses` (the legacy pages' answer storage): Restart, Remove a visit, the results reads, the Live display's feed, the local server's routes and seed file, the oracle's own rule for it. | a restart on SharePoint: 14 requests to 9; a visit removed: 6 to 5 |
| D | `ThemeConfig`: the list, its two calls, the seed import, the mock, the local file. The Live display takes its colours from the session's client, else the built-in default; the delete protection on Clients says "today's live session". | twelve lists; exports 106 to 104 |
| E | Finding the live client through the session when AppSettings names none; activities with no client everywhere (the participant's fallback, Today's notice, Content's Unassigned group and both assign buttons, Setup's assign panel, `lib/admin-assign.js`, `lib/setup-assign.js`, `npm run test:assign`). Copy from another client and Duplicate stay. | 21 node tests and 7 browser tests removed with what they tested |

### The three queries, and one sentence

| | Before | Now |
|---|---|---|
| F1 | five calls asked `QRTokens` for `Used eq 'false'`, a filter on a Yes/No column | they read the session's codes by the indexed `SessionId` and test `Used` in the page; the same number of requests |
| F2 | before removing a replaced tile picture, the editor asked `Options` for `ImageUrl eq '...'`, a column with no index, once for each picture | it reads the activities and their answers by question and compares the addresses itself: two requests however many pictures |
| F3 | deleting a client read every session, visit and QR code there is; the check-in dialog read every code to list six | the client's sessions by `ClientId`, then their visits and codes by `SessionId` (2 requests where it was 4, before the answers); the dialog reads one session's codes. Results keeps its read of every code: it shows every session |
| G | the self-test said "set batch: false in public/config.js", a file that no longer exists | `"batch": false in pms-config.json` |

Each of these, and each replacement in D and E, had a test that was written first and failed on the code before; the failures are quoted in the report. No commit is red.

### The request baselines

A baseline is still never regenerated. Phase 10c-1's `--amend` follows a test that was removed or changed; this phase changes what the CODE sends on purpose,
which that tool rightly refused. It gained one flag, `--code` (the "before" is the last commit's whole tree), and a read-only `--explain` that says which test
each difference belongs to. 584 entries were amended in eight steps, each for the tests named, and one baseline was deleted with its suite. Part B was two
commits (tests, then code with every suite identical), and so was part C.

### Gate results

| Gate | Before (`97fd499`) | After |
|---|---|---|
| `npm run check:svelte` | 405 files, 0 errors | 402 files, 0 errors |
| `npm test` | 914 pass | 894 pass, 0 fail, 0 skipped |
| `npm run test:baseline` | eleven suites identical | ten suites identical |
| Participant page, gzip | 157,460 B | **155,669 B** (1,791 B smaller; `PHASE_10C2A`, allowance 0) |
| Admin page, gzip | 609,507 B | 605,049 B |
| Setup page, gzip | 61,743 B | 57,771 B |
| Oracle, 500 seeds | 0 differences | 0 differences |
| Report mutations | 34 of 34 | 34 of 34 |
| `npm run test:migration` | 1,062 tests: 1,036 pass, 26 skipped | 1,038 tests: 1,012 pass, 26 skipped (the same 26), 0 failed. Chromium 389, WebKit 294, Firefox 329. The 24 fewer are the eight removed tests in three engines |
| `dataService.js` | 115 exports, 3,117 lines | 104 exports, 2,805 lines |

### Found on the way, and left open

- **A restart used to create an empty item for the session on SharePoint** (the clearing made it when it was not there). It held no answer, and it went with the clearing.
- **One browser test's number depended on a seed file that went** (the Content delete warning counted the older-shape answers of the seeded Kroger session). The test
  now makes its own answer. No counting rule and no per-participant count changed. The seeded local session `s-kroger-kickoff` shows visits and no answers since.
- **The browser tests' mock was itself shaped like older data** (a live session with no client named, activities with no client), so the participant specs had
  relied on both fallbacks. It now holds what Go live writes.
- **Visible:** the check-in code dialog on Clients lists the newest six codes of the session the code joins; it used to list the client's newest six of any day.
- **Left for a decision:** `deleteClientTrack` (exported, called by no page); Results' read of the whole QRTokens list (it shows every session); Results'
  `readNameSources`, 20 sessions to a read (over 1,500 characters with the longest session ids); the local admin's participant link (from Phase 10c-1).

### What is not proven

Nothing has met the real site. QA-TESTING.md, "Phase 10c-2a", items 102 to 109: that no item for a session appears in `Responses`; what the real list sends for
`Used` on a code nobody scanned (the app takes false and nothing as unscanned; the mock sends a real true or false); whether the `$batch` of every activity's
answers is accepted on a site with many activities; the reads by `ClientId` and by 15 session ids; Check Lists with twelve lists; `ActiveClientId` after the first
Go live. `PROVISIONING.md` and `SHAREPOINT-DEPLOYMENT.md` describe the old site and got only a note and the lines that had become untrue.

## Phase 10c-2b (2026-10-14): one schema file, the PMS list names, schema v2

**In plain words.** One file now says what every SharePoint list and column is (`public/js/pms-schema.js` for the names, carried by every page;
`public/js/pms-schema-meta.js` for everything else, carried by Setup alone), and the data layer, Setup's check, the tests' mocked SharePoint, the local server and
the seed checker all read it. The lists have VJR's names (`PMSClients`, `PMSClientSessions`, `PMSActivities`, `PMSActivityQuestions`, `PMSAnswerOptions`,
`PMSParticipants`, `PMSParticipantAnswers`, `PMSGuestQRCodes`, `PMSGuestList`, `PMSVisitLog`, `PMSAdminUsers`, `PMSAppSettings`, the library `PMSClientImages`)
and schema v2: every column must exist, `SortOrder` for an order, words kept as text, an index on exactly the filtered columns, AppId required, indexed and
unique, every date shown as Date & Time, Yes/No defaulting to No, and a `SchemaVersion` that every page checks at no extra request (PMS-LST-010 to 012).
[SHAREPOINT-LISTS.md](SHAREPOINT-LISTS.md) is generated from the file. **Nothing of it has met the real tenant.** The account is
`SCHEMA-10C2B.md` (in git history at `7347c72`).

**How it was proved.** A snapshot of the seven hand-kept copies before any change (A); the tests moved to list keys by a script that decided every one of 905
mentions (B); the schema file, at the old names and shape, equal to the snapshot and every request baseline identical (C); the new names proved as a
translation: every fresh recording, in 10 node suites and three browsers, equal to its translated baseline before the baselines were replaced (D, 827 node
entries and 869 in all); the version check costing no request, the baselines following E's provisioned mock only through `--amend --code` (150 entries) and a
proved id shift in the browsers (E). Gates: `npm test` 946, `check:svelte` 0/0, mutations 34/34, oracle 500 = 0 differences, the browser suite as before
(1,012 passed, 26 skipped). Participant page 155,574 B gzip (`PHASE_10C2B`: 95 B smaller, allowance 600 B net), admin 604,996, setup 60,966.

**Left open.** Two admin inputs can write more than a single-line column holds (an answer's text, a client's name: over 255 characters SharePoint refuses the
write); a 255 limit with a message is recommended. Setup's Create (10c-3) writes the lists and the `SchemaVersion`; until then the lists are made by hand from
SHAREPOINT-LISTS.md. QA-TESTING.md items 110 to 117.

## Phase 10c-3 (2026-10-14): Setup creates and completes the lists, and adds the first admin

**In plain words.** Setup can now prepare a SharePoint site for the app, in steps: **Show the plan** (reads the site and says what is missing and what it will
not touch, with the fix for each), **Create** (makes exactly that, and only adds), **Mark the site as ready** (writes the version of the lists, last, and only on
a clean check), **Add an admin** (the PIN stored as the admin page checks it; the seed-file import no longer brings the demo admin). An answer's text and a
client's name stop at the 255 characters SharePoint holds. **Nothing of it has met the real tenant** (QA-TESTING.md items 118 to 132). The account is
`PROVISION-10C3.md` (in git history at `7347c72`); the steps for a deployer are SHAREPOINT-DEPLOYMENT.md, "Preparing a new site".

**What exists.** `migration/src/lib/provision.js` (the plan: one read of the site's lists and one of each existing list's columns; Create: lists, then columns,
then indexes and uniqueness, then the lists' settings, paced with `runPaced`, every column read back, a stop at once on a difference or a 403; `markReady`),
`lib/setup-admins.js`, `lib/setup-import.js` (the seed-file import, moved out of the data layer), `src/setup/PlanView.svelte`, all Setup's alone. In the data layer:
`sendToSharePoint` (Setup's one way to write to the site), `addAdminUser`, the check leaving SharePoint's own Title alone, and a single line over 255 refused before
it is written (`long` in `pms-schema.js` marks text of several lines). The fake builds a site, with the traps of ARCHITECTURE-10.md 6.3 (in git history at `7347c72`) behind options.

**Numbers.** A whole empty site: 13 lists, 89 columns, 47 settings, 149 writes and 239 requests, 6.6 s on the fake at the real pace; marking it ready 17
requests and 1 write. Gates: `npm test` 1,026 (946 before), `check:svelte` 408 files 0/0, `test:baseline` 35, `test:bundle` 25, mutations 34/34, oracle 500 = 0 differences, the browser suite 1,081 passed and 26 skipped of 1,107 (1,039 and 26 of 1,065 before). Participant page 155,320 B gzip (`PHASE_10C3`: allowance 0, 254 B smaller than 155,574), admin 605,064, setup 71,909.

**Found on the way.** The strict check called SharePoint's own Title "Must not be required" on PMSActivities: no Setup-made (or hand-made) site could have been
marked ready, and Today would have blocked Go live (fixed, red test first). Two browser selectors of mine, committed in B and C, also matched the "Where the
lists are" rows (fixed in D). Left: "1 of 1 columns" in a progress line; a seed record over 60,000 characters is refused when written, no longer before the
import starts.

## Phase 10f (2026-10-14): sample clients with real pictures, Design-Docs removed, and the package for the new site

**In plain words.** This phase makes what VJR's colleague uploads. The planned error-code catalogue, README rewrite and clean-up phase (10d) was skipped (VJR,
14 Oct 2026). The new site is `https://internal.global.deloitteonline.com/sites/PCOE`; the pages go in `Shared Documents/PMS`; the lists are `PMS...` with no
prefix, built by hand by VJR from a checklist that matches the schema file. **No address is built into the pages.** The report is [RELEASE-10F.md](RELEASE-10F.md).
**Everything ran against the local server and the mocked SharePoint REST; nothing has run on the real tenant or a real device** (QA-TESTING.md items 102 to 137).

**What changed, part by part.**

- **A. `Design-Docs/` removed** (VJR's decision): 42 files, 10,799,743 bytes. Nothing in it was needed to build, test or ship, so nothing was moved first. Every
  link to a report and every mention of one now says it is in git history at `7347c72`.
- **B. The sample clients have VJR's pictures**: the clients' real logos (supplied by VJR for this internal app, used as files, never redrawn), a hero and a
  background each, 677,700 B in all, each exactly what Brand Studio stores (made by driving the built Brand Studio, `npm run build:sample-pictures`; made twice, byte
  for byte the same). Domino's gingham background is a JPEG at 1152 x 1536, Brand Studio's own answer for a picture too detailed for WebP under 350 KB. Setup's
  **Seed sample clients** puts a new client's pictures in PMSClientImages first (one read of the library's files; a file already there is not sent again), then the
  clients with the addresses in their theme and LogoUrl; a second run uploads and writes nothing. `server/data` and the local server's uploads hold the same pictures.
  The participant and admin pages carry none of it (`PHASE_10F`, allowance 0).
- **C. The release package** (`npm run package:release`): from a committed tree, built in a fresh worktree, into `build-svelte/package/pms-<commit>/` and a zip
  (git-ignored): the three pages, `pms-config.json` (`{"configVersion": 1, "listPrefix": "", "label": "PMS"}`), the notices, RELEASE-NOTES.md, RUNBOOK.md and
  SHA256SUMS.txt. It proves that no page holds a site address, a folder name, a PIN hash, the demo PIN, `p_cec_` or `CreativeExpCOE`, and that the checksums verify
  in the folder and in a fresh unzip. RUNBOOK.md has fifteen steps with the real addresses and what to send back under each, the codes, the QR codes, and the QA item
  each step answers; its permissions table comes from META's readers and writers (and is in SHAREPOINT-LISTS.md): participant accounts write five lists, only read
  seven, and must not read PMSAdminUsers.
- **D. The runbook rehearsed on the mock** (`npm run test:rehearsal`) with the package's own pages at the new site's folder address, steps 3 to 14, on an empty site
  and on a hand-built one with `Session_x0020_Id` beside a missing `SessionId` (the plan reports it, Mark ready refuses, and after the fix it is ready), in Chromium,
  WebKit and Firefox. Where the runbook and the pages disagreed, the runbook was fixed. Step 10 (permissions) cannot be rehearsed: the mock has none.

**Numbers.** The package `pms-50ae628` (from `50ae628`; zip SHA-256 `838b972e...a8ac`, every file's checksum in the report). Gates: `npm test` 1,058 (1,026
before), `check:svelte` 411 files 0/0, `test:baseline` 36, `test:bundle` 28, mutations 34/34, oracle 500 = 0 differences, the browser suite 1,095 passed and 26
skipped of 1,121 (1,081 and 26 of 1,107 before), `test:rehearsal` 6 of 6. Participant page 155,320 B gzip and admin 605,064 B, both unchanged (`PHASE_10F`, allowance
0); Setup 757,231 B (71,909 before), almost all of it the six pictures.

**Found on the way.** The package's proof caught the sample pictures' full SHA-256 in the Setup page (the list of pictures carried it; it now holds the names
only). Playwright's WebKit hands a route an empty body for a Blob upload, so the mocked SharePoint cannot store a picture uploaded from WebKit: Setup's upload is
checked byte for byte in Chromium and Firefox, and WebKit reads pictures seeded from the test's own process. A site seeded before this phase keeps its sample
clients without pictures (the seed never changes an existing record). The plan says "0 lists, 1 column, 1 setting to create." THIRD-PARTY-NOTICES.txt does not
list the six pictures (content, not code: for whoever owns licence compliance to confirm).

## Phase 10g (2026-10-14): the settings file is pms-config.txt

**In plain words.** The first run on the real site (`https://internal.global.deloitteonline.com/sites/PCOE`, the package `pms-50ae628` in `Shared Documents/PMS`) was the first
thing to meet a real tenant. The three pages opened, and `setup.html` worked out its site from its own address and reported its build. Then it stopped with `PMS-CFG-002`:
that SharePoint will not serve `.json` files from a document library. `pms-config.json` was in the folder, and its address showed SharePoint's own "File Not Found" page, which a
page's request receives with a success status. The same file renamed `pms-config.txt` is served as its text. So the settings file is **`pms-config.txt`**, with one name (the pages
read it and nothing else), the same JSON content and the same rules. No other behaviour changed. The report is [RELEASE-10G.md](RELEASE-10G.md). **Everything else still
has not run on the real site**: the lists, Setup's plan, Create, Mark ready, Add an admin, Go live and the iPad (QA-TESTING.md items 102 to 138).

**What changed, part by part.**

- **A (`5c65289`). One name.** `SETTINGS_FILE` is `pms-config.txt`; every page, message, help text, fixture, script, document and generated file follows it, and
  `pms-config.example.json` is `pms-config.example.txt`. Tests first (red: 90 of the 159 tests in the two node settings files failed before the code): the page reads `pms-config.txt` and nothing else; a decoy `.json`
  beside it is neither asked for nor obeyed (a stand-in for fetch, and a browser with a decoy route, in three engines), nor is it a stand-in for a missing `.txt`; and no
  file under `migration/` or `public/js` says `pms-config.json`. The tests that serve the file serve it as `text/plain`, as the tenant does. PMS-CFG-002 has one more cause in
  words ("or an error page such as 'File Not Found' when the site will not hand out this kind of file") and its Details line carries the HTTP status for a web page or text that
  is not JSON (`page 200`, as `status 503` always did). QA-TESTING.md records the finding as observed and adds item 138 (a missing `pms-config.txt` comes back as a 404), still to see.
  `PHASE_10G`: the participant page may grow by 100 B gzip; it grew 8 B (admin 2 B). No request baseline moved.
- **B (`969bf16`). The package and its runbook.** RUNBOOK.md has a note before the steps for a site that already has the earlier upload (replace the three pages, the
  `pms-config.txt` there may stay, delete `pms-config.json`), says as observed that this site does not serve `.json` files, uploads `pms-config.txt` in step 2 and checks it
  opens as text in a browser, names it in step 11, and says what `PMS-CFG-002` with `page 200` means. RELEASE-NOTES.md says what changed since `pms-50ae628` and why. The
  package script proves the folder and the zip hold `pms-config.txt` exactly and no `.json` file. `pms-969bf16` was built from this commit and rehearsed (6 of 6, three engines),
  the rehearsal now serving the package's own `pms-config.txt`.
- **C (this commit). The record:** this section, AGENTS.md ("Rules from Phase 10g", and the file's name where it is named), SHAREPOINT-DEPLOYMENT.md, RELEASE-10G.md.

**Numbers.** `npm test` 1,065 (1,058 before), `check:svelte` 411 files 0/0, `test:baseline` 36, `test:bundle` 29 (28), `test:rehearsal` 6 of 6, and the whole browser suite 1,101 passed and 26 skipped of 1,127 (1,095 and 26 of 1,121 before), 0 failed.
Participant page 155,328 B gzip in this checkout (+8 B; allowance 100) and admin 605,066 B (+2 B); in the fresh checkout the package is made from: 155,318 B and 605,056 B.

**Found on the way.** `npm run test:styleguide` fails one test at the commit before this phase as well (Phase 10c-3 numbered Setup's headings; the test still looks for the old
words): not touched here. Earlier phase sections of this file still say `pms-config.json`, as it was named then.

## Phase 10h (2026-10-14 and 15): three fixes from the first real-site run

**In plain words.** `pms-969bf16` ran steps 1 to 9 of its runbook on the real site (PCOE, `Shared Documents/PMS`, Chrome on Windows, 14 Oct 2026, evening): the 13 lists made,
all Ready, the site marked ready, an admin, the samples with their pictures, `PMSAdminUsers` locked. Three things were wrong. (1) **That site leaves `ClientId` out of an item read
that does not name its columns**, so Content and Today said Kroger and Domino's had no activities (the activities were there; a read with `$select` returned `ClientId`); Go live
would have failed next. (2) **It refuses a duplicate with 500**, where the data layer expected 400, so Setup's self-test said "Refused, but not as a duplicate" and every path that
meets a record already there would have failed. (3) **Setup's buttons could not be seen**: Setup never loaded the admin page's tokens. All three are fixed, Setup names the lists by
their real titles, and the self-test asks the site which columns it leaves out. The report is [RELEASE-10H.md](RELEASE-10H.md). **These pages have not run on the real site yet.**

**What changed, part by part.**

- **A (`e148e10`). Every item read names its columns.** `pms-schema.js` `selectOf(key)` (Id, AppId and every mapped column); `dataService.js` builds every item read through
  `spItems` (spFind, spSend's list GET, spByAppId, spItemsAddress and so readLists, and the probe helper when its query names none); Setup's two reads of the settings item name
  theirs; `PARTICIPANT_SELECT` was already named and is unchanged. A create's reply is completed from what was written (`spMade`), in case the site leaves the column out of it too
  (assumed). The mock answers as the site did (`strict: false`: `ClientId` left out of an unnamed read and of a create's reply) and by default refuses an unnamed read
  (`UNNAMED`, held empty by every recorded suite). Tests first: `scripts/test-named-reads.js` (16 of 18 red: Content gave Kroger no activities, readiness said "Kroger has no
  activities", Go live said "belongs to a different client"). Setup's self-test has a third read-only probe (which columns this site leaves out of an unnamed read). The request
  baselines were **translated**, not recorded again (`scripts/schema-baseline/select-baselines.js`: 384 entries gained their `$select`, nothing else moved; a fresh recording equalled
  the translation in every node suite and in three browsers; 24,656 requests in the same number and order as the last commit's). The longest address is 1,872 characters (PMSVisitLog
  by 20 sessions, over 1,500 since 10c-2a); the list with the most columns, PMSParticipants by 15 sessions, is 1,510. One behaviour changed on a broken site only: a column deleted
  by hand from a list Today reads stops Today with SharePoint's words, where it was a blocker (a decision for VJR; QA-TESTING.md item 141).
- **B (`9f088d0`). A duplicate refused with 500 is still a duplicate.** `spHttp`: a refusal is 409 when SharePoint says 400, 409 or 500 and its error code names
  `SPDuplicateValuesFoundException` or its words match `/duplicate|unique value/i`; any other 500 stays a 500; `sharePointStatus` keeps what it said. The mock answers 500 by default
  (`duplicateStatus: 400` the old answer; `duplicateCode: true` an assumed code). Tests first: `scripts/test-duplicates.js` (the self-test failed with the site's own words).
  Every caller of 409 checked (RELEASE-10H.md 4.3). No baseline changed.
- **C (`f0d160e`). Setup's buttons can be seen.** `setup-main.ts` imports `tokens.css`, `fonts-admin.css` and `admin-tokens.css` as `admin-main.ts` does. Tests first:
  `setup-look.spec.ts` (three engines: every button has an edge, every enabled one 4.5:1 against what is behind it; it failed on the old build with white on white, 1:1) and
  `a11y.spec.ts` (Setup scanned with its primary buttons on; a 1:1 "needs review" is a failure there, because axe never fails it). Setup +33 kB gzip (the three faces).
- **D (`3e0e2ef`). Setup names the real lists.** Six sentences a person reads (the self-test's paragraph and confirmation, PMS-LST-010's details, Today's unverified Go live,
  Results' Restart tip) take the titles from the schema file under this copy's settings. `scripts/test-shown-names.js` holds no old title in what a page shows. The styleguide test
  passes again (8 of 8).
- **E (`e250a36`). The package and its runbook.** RUNBOOK.md has a note for the PCOE site (replace the three pages, keep `pms-config.txt`, check Setup, the self-test, Content,
  continue at step 12) and the self-test as an optional step 10 (the steps after it moved one on); RELEASE-NOTES.md says what changed since `pms-969bf16`. `pms-e250a36` (zip
  SHA-256 `40a4ef00...8391`) passed every proof and the rehearsal, 9 of 9 in three engines, on the mock answering as the site did, including the PCOE note on an already set-up site.
- **F (this commit). The record:** this section, AGENTS.md ("Rules from Phase 10h"), RELEASE-10H.md.

**Numbers.** `npm test` 1,103 (1,065 before), `check:svelte` 411 files 0/0, `test:baseline` 37, `test:bundle` 30, mutations 34/34, oracle 500 seeds 0 differences, the whole browser
suite 1,110 passed, 26 skipped and **1 failed** of 1,137 (`live-display.spec.ts:208` in Firefox, a chart redrawn late after a resize: it passed 3 of 3 alone on the same
build, and in Part A's whole run; the untouched `5bc90fa` had a different flake, `admin-today.spec.ts:421` in Chromium), styleguide 8 of 8, rehearsal 9 of 9. Participant page +166 B gzip and admin +136 B (fresh checkout; allowance 300 B for A and B), Setup +33,810 B.

**Still to see on the real site:** QA-TESTING.md items 138 to 142 (what it leaves out besides `ClientId`, Content to Results with these pages, a column deleted by hand, the
duplicate's error code), the 403 seen once, and everything after step 9 of the runbook.

## Phase 10i (2026-10-15): a column SharePoint will not return by name

**In plain words.** `pms-e250a36` ran on the real site (PCOE, Chrome on Windows, 15 Oct 2026): the self-test passed (10 of 10, the duplicate "Refused: AppId enforces unique
values."), Content showed each client's activities, Domino's went live, and a participant's visit worked to its end. Then **Admin → Results did not load**: "SharePoint (400): Value
does not fall within the expected range." The visit log's read (`readNameSources`) named `DisplayName`, and that site refuses every read of `PMSVisitLog` that names it: read one
column at a time, every custom column of every list came back but that one. `DisplayName` is also a property SharePoint gives every list item in REST. `PMSGuestList.DisplayName`
passed only because the list was empty; with a guest on it the QR check-in of a named guest and Guests and QR would have failed too. So **schema version 3** renames the two
columns (`GuestName`, `SignedInName`), Setup brings a site of version 2 up to version 3 (it only adds, and raises the version once the check is clean), and the self-test asks the
site which columns it will not return by name. The report is [RELEASE-10I.md](RELEASE-10I.md). **These pages have not run on the real site yet.**

**What changed, part by part.**

- **A (`7d47ba7`, red on purpose: asked, the answer was "A red, B green").** The mock refuses an item read naming `DisplayName` when it would return a row (`refusesByName`,
  default `['DisplayName']`; 400 and the site's words; `REFUSED_BY_NAME`), and leaves `DisplayName` out of an unnamed read beside `ClientId`. A guard in `scripts/test-schema.js`
  fails on any column named like a SharePoint list-item property or a built-in column (`LIST_ITEM_PROPERTIES`, 33 names; `BUILT_IN_COLUMNS`, 35); on today's schema it named
  exactly the two `DisplayName` columns. `scripts/test-column-names.js` (new): Results and the leader report name a member of staff, a named guest checks in by QR. At A, `npm test`
  had 49 failing tests, every one in a suite that reads a guest or a visit-log row, plus the guard.
- **B (`879e8cf`). Schema version 3.** `PMSGuestList.GuestName`, `PMSVisitLog.SignedInName`, `VERSION = 3`; the record field is `displayName` as before. META says why in each
  column's text, and `RETIRED` names the old columns (`retiredColumn`, `columnNamesAt`); SHAREPOINT-LISTS.md has "Columns no longer used". The mock's default version follows
  `VERSION`; `listsVersion: 2` builds a version-2 site. The oracle's raw rows, the stub of `test-sharepoint.js`, two specs and the version tests follow. The request baselines were
  **translated** (`scripts/schema-baseline/rename-baselines.js`): 34 entries in 10 files, each only the column in a `$select`; `--check` equal in every node suite; `--order e07d2e3`
  26,178 requests in the same number and order; the browsers' start-up equal in three engines (and red against the untranslated files). `PHASE_10I`: participant +8 B, admin +6 B.
- **C (`3cea078`). Setup brings a version-2 site up to version 3.** The plan names the two new columns and lists the old `DisplayName` columns under what it will not touch, as
  harmless; Create adds them; Mark the site as ready, once the check of version 3 is clean, raises a lower version (1 or 2) and says "Raised the lists from version 2 to version 3.";
  it never lowers a higher one and writes nothing while a problem remains. PMS-LST-011's words say what to press. `scripts/test-schema-upgrade.js` and `schema-upgrade.spec.ts`
  (three engines) hold it on the PCOE site of version 2, red first. A visit logged before the upgrade keeps its name only in the old column, which the site will not return: Results
  calls it "Unnamed participant N".
- **D (`3d5459f`). The self-test finds columns a site will not return by name.** A fourth read-only probe: for each list with an item, its own columns (from its fields), one item
  naming them all, and only when refused each alone. Eleven steps; it reports and never fails.
- **E (`da9fc8d`). The package and its runbook.** RUNBOOK.md's note for PCOE is now for its lists of version 2 (ten steps, from replacing the pages to an iPad checking in with a
  guest's code); QA items 143 to 145; RELEASE-NOTES.md says what changed since `pms-e250a36`. `pms-da9fc8d` (zip SHA-256 `d3578d5a...6aa6a`) passed every proof; the rehearsal
  passed 12 of 12 (four runs, three engines), the fourth being the note on a version-2 PCOE site.
- **F (this commit). The record:** this section, AGENTS.md ("Rules from Phase 10i"), QA-TESTING.md (15 Oct observed, items 143 to 145), RELEASE-10I.md.

**Numbers.** `npm test` 1,129 (1,103 before), `check:svelte` 411 files 0/0, `test:baseline` 37, `test:bundle` 31, mutations 34/34, oracle 500 seeds 0 differences (unchanged), the whole browser
suite 1,120 passed, 26 skipped, 0 failed of 1,146 (Chromium 426, WebKit 329, Firefox 365; at B one keyboard test, `admin-today.spec.ts:747`, failed once and passed 3 of 3 alone), styleguide
8 of 8, rehearsal 12 of 12. Participant page +8 B gzip and admin +7 B (fresh checkout; allowance 100 B), Setup +1,276 B.

**Still to see on the real site:** QA-TESTING.md items 143 to 145 (the fourth probe's answer with a guest and a code on the site, the QR check-in of a named guest, the upgrade from
version 2 to version 3 and Results after it), 138, 139 and 142, and everything after the note's steps.

## Non-Negotiable Constraints

- Keep the approved SharePoint site, existing list titles/columns, indexed unique `AppId` contract, stored records, and `ClientLogos` library unchanged. The confirmed User Setup feature adds three lists (`AppSettings`, `VisitorRoster`, `UserVisitLogs`) and optional fields on Sessions, Tracks, and QRTokens; provision these additions explicitly without repurposing or rewriting existing data.
- Use [deployment.config.json](deployment.config.json) to keep `p_cec_01` as production and `p_cec_02` as the staging document folder. This config selects harness paths only; release HTML remains folder-relative and both folders still access the same lists. (Since Phase 10b a Svelte copy uses the lists its own `pms-config.json` names: the same lists as production only when that file says `"listPrefix": ""`.)
- Continue using [public/config.js](public/config.js) (the legacy pages' only, since Phase 10b: the Svelte pages find their settings as they start) and [public/js/dataService.js](public/js/dataService.js). Existing browser sign-in and SharePoint permissions remain the authorization boundary; the admin PIN only gates navigation.
- Preserve `index.html`, `admin.html`, `setup.html`, `?qr=<token>`, and `#/route?t=<track>` URL contracts. Keep `Shared Documents/p_cec_01` as the production folder until explicit cutover approval.
- Do not alter ETag checks, QR single-claim rules, restart ordering, or response ownership as an incidental UI refactor. (The lean QR scan of 2026-10-11 was a deliberate change with its own tests, and keeps the single-claim rule: the same `If-Match` write to the code.)
- Do not upload private seed exports or embed participant records. Starter-media URLs must remain normal URLs in persisted records, not data URLs.
- No broad cache of live responses, session state, track restarts, or section enablement. Any new reuse policy needs explicit freshness and invalidation tests. (Phase 4 added none: browser storage holds only answers not yet saved, this tab's visit-log id, and the sound choice; `scripts/test-participant-storage.js` fails if that list grows.)
- The additive `AppSettings`, `VisitorRoster` and `UserVisitLogs` schema is specified in [PROVISIONING.md](PROVISIONING.md), but must be provisioned and permissioned manually by the SharePoint owner. No production upload, live provisioning/write, destructive cleanup, or forced dependency upgrade is authorized here.

## Current Architecture

| Layer | Current implementation | Implication |
| --- | --- | --- |
| Legacy UI | Vanilla ES modules and templates under `public/` | Still built by `npm run build` into `build/` |
| Migrated UI | Svelte 5, TypeScript, svelte-spa-router under `migration/` | Parallel implementation, not the default production build |
| Styling | Tailwind 4 integration plus legacy and migration custom CSS | Visual parity and stylesheet interaction require device checks |
| Data and auth | Shared JavaScript data service and existing PIN lookup | Adds current SharePoint user read, admin-selected session/mode, visitor roster, visitor-linked QR/track identity, idempotent visit events, and active-session guards; no new API server. TS wrappers assert existing shapes rather than validate runtime data |
| Results | Shared Chart.js renderer and CSV/PDF/PPT report writers, in the admin page only since Phase 7 | The participant page no longer carries them (153 KB gzip against 585 KB); the admin page does (554 KB) |
| Local backend | Express 5 with JSON store | Use a scratch data directory for workflow tests; not a production hosting dependency |
| Candidate build | Three separate Vite single-file builds assembled by [scripts/build-svelte-release.js](scripts/build-svelte-release.js) | Emits `build-svelte/release/{index,admin,setup}.html`; portable to any document folder; local browser harness mounts under configured staging folder |

## Implementation Inventory

Status below means code exists, not that all parity gates passed.

| Area | Owning code | Verified status and remaining scope |
| --- | --- | --- |
| Shell, QR, resume, track watch | [migration/src/App.svelte](migration/src/App.svelte), [migration/src/lib/session.svelte.ts](migration/src/lib/session.svelte.ts) | Loads signed-in account and site-wide active session; visit logging is idempotent per tab/session; visitor QR claims retain roster identity; active-session heartbeat redirects connected tracks; URL history and reconnect coverage remain |
| Welcome | [migration/src/routes/Welcome.svelte](migration/src/routes/Welcome.svelte) | Rebuilt for the PMS mockup (Phase 6: hero badge as it is, else logo on a light or dark plate, else the name in type; never waits for a picture): client logo on a white plate, "Hi {name}!", "Click here to begin" or "Activities"; no client selector; staff greeting/resume and visitor-name QR confirmation are browser-tested; visit-log failure does not block a valid visit |
| Agenda (Activities hub) | [migration/src/routes/Agenda.svelte](migration/src/routes/Agenda.svelte) | Activity pills with a completion dot and sequential unlock (`session.activityFlow`, `open` disables it); fresh reads and scoped handoff implemented; depends on complete post-submit snapshot |
| Quiz (pager) | [migration/src/routes/Quiz.svelte](migration/src/routes/Quiz.svelte), [migration/src/pager/](migration/src/pager/) | One question per screen with graded Retry/reveal, logo tiles, ungraded types, resume from saved plus pending answers, one save per activity through [participantData.ts](migration/src/lib/participantData.ts) with retry and a visible Retry state, and a read-only preview; all browser-tested against built files. In-flight navigation during the final save is not covered |
| Feedback | [migration/src/routes/Feedback.svelte](migration/src/routes/Feedback.svelte) | Only redirects `#/feedback/<id>` into the pager, where open text is a step; the old link, trimmed text and failed-save retry are browser-tested |
| Thank You (finale) | [migration/src/routes/ThankYou.svelte](migration/src/routes/ThankYou.svelte) | Thank-you message with a summary (activities finished, first-try score); not reachable early; failed reads render recovery UI; retry verified without another answer save; Start over kept |
| Admin Activities (merged into Content in Phase 5b; the file is gone) | [AdminContent.svelte](migration/src/admin/AdminContent.svelte) | Preview wired; normal-pointer live-toggle failure rollback/retry and preview cleanup browser-tested (`participant.spec.ts`, now against Content); the 15-second refresh is tested for its request count |
| Admin Guests and QR (was User Setup) | [migration/src/admin/AdminGuests.svelte](migration/src/admin/AdminGuests.svelte); the legacy admin keeps [public/js/screens/admin/user-setup.js](public/js/screens/admin/user-setup.js) | The Svelte admin: the live session's visitor roster, QR generate/show/replace/disable, recent visits; the session and the staff/visitor mode moved to Today. Browser-tested here and against the legacy artifact |
| Admin Brand Studio (Phase 6) | [BrandStudio.svelte](migration/src/admin/BrandStudio.svelte), [BrandPreview.svelte](migration/src/admin/BrandPreview.svelte), [AssetUploader.svelte](migration/src/admin/AssetUploader.svelte), [CropDialog.svelte](migration/src/admin/CropDialog.svelte); rules in [brand-studio.js](migration/src/lib/brand-studio.js), [asset-specs.js](migration/src/lib/asset-specs.js), [crop-math.js](migration/src/lib/crop-math.js), [asset-compress.js](migration/src/lib/asset-compress.js), [scrim.js](migration/src/lib/scrim.js) | Colours, pictures, a real-screen preview at device sizes, save, and the participant side's picture handling; browser-tested on Chromium and WebKit against the local server and the mocked SharePoint REST; real uploads to ClientLogos and an iPad are not |
| Admin Today, Clients, Content, Results | [AdminToday.svelte](migration/src/admin/AdminToday.svelte), [AdminClients.svelte](migration/src/admin/AdminClients.svelte), [AdminContent.svelte](migration/src/admin/AdminContent.svelte), [AdminResults.svelte](migration/src/admin/AdminResults.svelte) (was AdminSessions), logic in [admin-today.js](migration/src/lib/admin-today.js) and [admin-clients.js](migration/src/lib/admin-clients.js) | Phase 5: Go live with readiness and a verified read-back, the switch confirmation, controls, End/Reopen, add/edit/archive clients with slugs, and the built tests listed under Phase 5. Earlier coverage kept: partial question-create rollback/draft retention, question type conversion/edit/delete with option unlinking, referenced-client delete protection, oversized/denied logo upload, QR create/rotate/show, scoped track restart, and end/reopen races (now on Today). Broader reference cases, copy/expiry, and restart failure parity remain |
| Content Preview | [migration/src/admin/ActivityPreview.svelte](migration/src/admin/ActivityPreview.svelte) | Both Content and Activities mount real Quiz in Shadow DOM using saved content; read-only, Close, Escape, and forced tab teardown tested; unsaved drafts are outside scope |
| Setup | [migration/src/SetupApp.svelte](migration/src/SetupApp.svelte) | Built-page schema rejection, confirmation/cancel, malformed/oversized JSON, existing-ID skip, partial failure, and retry browser-tested with intercepted SharePoint REST; real permissions are untested |
| Live display and exports (Phase 7; was Master results) | [LiveDisplay.svelte](migration/src/admin/LiveDisplay.svelte), [ResultQuestion.svelte](migration/src/admin/ResultQuestion.svelte), [live-session.js](migration/src/lib/live-session.js), [results-tally.js](migration/src/lib/results-tally.js); the participant route is [ResultsMoved.svelte](migration/src/routes/ResultsMoved.svelte) | In the admin page (Results). The tally, counts, colours, Full screen and the three exports, browser-tested on Chromium and WebKit, Chromium against the SharePoint mock; real tenant and iPad not |
| Asset embedding | [migration/src/lib/embedded-assets.ts](migration/src/lib/embedded-assets.ts), [public/js/assets.js](public/js/assets.js) | Document-relative mapping implemented; validate nested paths, external uploaded logos, and all built entries |

## Confirmed Code-Level Gaps

These observations came from source inspection. The dispositions below reflect repairs on 2026-10-09; remaining items still require focused regressions. Do not mistake a clean type check for behavioral proof.

| Priority | Observation | Required check and correction |
| --- | --- | --- |
| P0 resolved | Quiz completion handoff now retains all saved question IDs, not only current-module answers | Built-browser regression verifies Module A remains complete immediately after submitting Module B and no redundant Responses read occurs |
| P0 resolved | Shell synchronizes shared branding; PDF/PPT export explicitly loads the exported session's client brand and refuses an unmatched fallback | Built-browser regression inspects PPT slide XML for two sessions' distinct client names and colors |
| P0 resolved | Thank You renders a visible retry/Agenda state after failed progress reads | Built-browser regression verifies recovery and zero additional response saves |
| P1 repaired | Quiz renders the form before VFX initialization, with an active-instance guard | Built-browser regression verifies the fieldset receives its VFX variant; broader animation teardown remains to be assessed |
| P1 repaired | Routed screens are keyed by path and restart timestamp, remounting on activity change and same-route restart | Built-browser regression verifies A-to-B navigation and cleared answers after same-activity restart |
| P1 repaired, stress QA pending | Track watcher has an in-flight guard; branding effects discard stale completions | Still inject slow/reordered network completions to verify overlap and teardown cases |
| P1 repaired, stress QA pending | Results discards stale refresh/export completions and renders missing-session/retry state | Built-browser regression covers missing session and branded session switches; disconnect/in-flight teardown checks remain |
| P1 resolved | Activities Preview is wired to the shared saved-content preview | Built-browser regression opens it with normal pointer interaction; unsaved-draft preview remains outside scope |
| P1 repaired | Preview submit handler is guarded, missing preview content cannot navigate, and preview no longer changes document title | Built-browser regressions verify no response saves, title preservation, Close/Escape cleanup, and programmatically forced tab teardown; the modal correctly prevents normal background-tab clicks |
| P1 repaired, restart stress QA pending | Admin Sessions uses one generation-guarded refresh path; polls pause during actions and outdated completions are discarded | Built-browser regressions delay a pre-end poll through the action, test failed end/reopen retry, and suppress action completion toasts after switching tabs; restart ordering remains covered only by shared adapter tests |
| P1 partly resolved | Node floor is `>=22.12`; reconciled lockfile includes migration/browser tooling; DOMPurify patched | Isolated `npm ci` with project postinstall passes; vendor output, Svelte compilation, and native esbuild execution verified. npm warns about unapproved dependency lifecycle scripts for core-js/esbuild. Audit remains 5 high, 0 low; owner disposition required |

## Verification Evidence and Limits

- Earlier conversation smoke tests are historical manual observations, not tenant certification. New persisted [scripts/migration-tests/participant.spec.ts](scripts/migration-tests/participant.spec.ts) tests execute the built files with synthetic intercepted APIs: progress snapshot, Thank You retry, activity changes/restart, save failure/retry, responsive sizing, session-specific PPT branding, Activities Preview, and missing Results sessions.
- Additional built-browser tests exercise failed live-toggle rollback/retry, partial Content creation rollback with draft preservation, delayed Sessions polls during end/reopen, and action completion after tab teardown. [scripts/migration-tests/setup.spec.ts](scripts/migration-tests/setup.spec.ts) serves built Setup HTML at a synthetic approved-host URL and intercepts every network request; no request reaches the real tenant. Schema rejection, cancellation, malformed/oversized files, partial failure, and retry skipping existing IDs are exercised through the actual UI and shared REST adapter.
- [scripts/test-svelte-release.js](scripts/test-svelte-release.js) checks file names, inlined scripts/styles, presence of configuration text/setup link strings, and absence of one known seed identifier. It does not execute the built pages, validate every asset, prove no sensitive data is bundled, or test workflows.
- `npm run test:sharepoint` exercises the shared adapter with mocked REST. Passing it does not test the migrated Svelte event handlers, device UI, authenticated tenant permissions, or real request latency.
- `npm test` passes 59/59 on the latest isolated run. The earlier CSV failure remains fixture-only: the test enables and restores its expected activity through the scratch API without changing production live-only export behavior.
- The reconciled dependency graph reports five high dependency findings across two transitive chains (`braces`/`micromatch`/`vite-plugin-singlefile` and `image-size`/`pptxgenjs`). DOMPurify was updated to 3.4.16; the low findings are gone. See the review below; no forced audit fix or risk waiver was applied.
- Browser click/keyboard timeouts were previously worked around with dispatched DOM events. Kiosk causation was not established; reproduce normal pointer, keyboard, and Safari touch interaction instead of classifying these as harmless harness issues.
- Thirty-one automated Chromium tests pass against built legacy and Svelte artifacts, including staff and visitor Welcome, active-session switching, roster/QR revocation, User Setup, all choice question formats, Feedback retry, admin workflows and mocked Setup import failures. These are not actual iPad Safari or authenticated tenant tests. No live SharePoint writes occurred.
- Parallel Windows `npm test` runs can intermittently hit `EPERM` renaming scratch JSON files; the latest isolated rerun passed 58/58. Run the shared suite serially if this filesystem lock recurs.
- Parallel Windows `npm test` runs can intermittently hit `EPERM` renaming scratch JSON files; the latest isolated rerun passed 59/59. Run the shared suite serially if this filesystem lock recurs.

## Dependency Review

Review on 2026-10-09: `npm audit --json` exits 1 with five high dependency findings, zero low and zero critical. This is not security approval.

| Chain | Observed exposure | Disposition |
| --- | --- | --- |
| DOMPurify via jsPDF | Low sanitization advisories affected the previous resolved version | Updated the lockfile to 3.4.16 using `npm update dompurify`; rebuilt both packages and reran browser export regressions. No forced upgrades |
| braces via micromatch / vite-plugin-singlefile | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): deeply nested patterns can exhaust the stack. This is a build dependency. The installed plugin only calls micromatch when `inlinePattern.length` is nonzero; all three Vite configs call `viteSingleFile()` with the default empty pattern. Current builds do not take that matcher path | Latest published braces is still 3.0.3. Audit proposes downgrading the plugin to 0.9.0, not a compatible patch. Retain the tested toolchain pending an owner-approved fix or documented exception; do not introduce untrusted build patterns |
| image-size via PptxGenJS | [JXL/HEIF](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) and [ICNS](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) parser infinite loops. Installed PptxGenJS maps `image-size` to `false` for browser builds; application exports run in the browser. The package still remains in the installed dependency graph | Latest published PptxGenJS is still 4.0.1; audit proposes a downgrade to 4.0.0. No override/downgrade applied. Obtain owner disposition and re-evaluate if adding Node-side export or untrusted image-processing paths |

Reachability observations reduce the identified exposure of the current paths but do not remove audit findings or certify every bundled path. Dependency changes require renewed packaging and export tests. npm's dependency lifecycle-script approval policy is unchanged; the clean install ran the project vendor-copy postinstall, while npm warned that core-js/esbuild lifecycle scripts were not approved. The installed native esbuild executable nevertheless passed a transform smoke check.

## Ordered Execution Plan

### 1. Establish a Repeatable Baseline

Run `npm run check:svelte`, `npm test`, `npm run test:build`, and `npm run test:build:svelte:release`. Record outcomes and known failures below. Inspect dependency audit and engine compatibility. Keep source seed JSON unchanged; create synthetic test records only through the data service against a scratch store.

Exit: current toolchain/build results are reproducible; test failures and dependency exceptions have owners and a disposition.

### 2. Repair Participant Correctness First

Fix P0 progress snapshot, export branding, and Thank You recovery with focused regressions. Then fix route reuse/restart refresh, initialization timing, stale async completion, and overlapping Track watches. Preserve confirmed-save-before-navigation and answer isolation between tracks.

Exit: two-module completion, all choice formats, feedback prefill/retry, save retry/double-submit, same-route restart, reload/back/forward, session switching, and disconnect recovery pass repeatably. Remaining local gaps include double-submit, feedback in-flight navigation, route history, delayed requests, and reconnect behavior.

### 3. Finish Admin and Preview Parity

Wire Activities Preview; test saved-content preview without participant writes. Cover question/option add/edit/delete, all type conversions, label/correct-answer rules, reference-safe client deletion, actual logo upload failures, QR create/show/copy/claim/expiry, track restart scope, and session end/reopen. Review poll cancellation and partial multi-record failures. Keep Preview's extra unsaved-draft behavior outside the migration requirement unless approved.

Exit: normal pointer/keyboard controls work; destructive operations affect only intended synthetic records; failure paths retain editable state and show visible errors. Newly covered locally: selected create rollback, question type conversion/edit/delete, client create/edit/reference protection, logo upload failures, QR create/rotate/show, active-session switching, visitor disable/revocation, visit-log failure behavior, session restart scope, and end/reopen failures. Other question conversions, wider dependency-reference combinations, QR copy presentation and restart failure UI remain open.

### 4. Prove Built-Artifact and Setup Behavior

Serve the legacy `build/` and Svelte `build-svelte/release/` outputs under distinct nested paths with synthetic API fixtures. Automate participant, admin, results, and setup navigation in built artifacts, not only Vite dev. Assert no external static dependencies, all referenced starter images/audio resolve, uploaded logo URLs stay intact, charts release resources, and downloads contain correct branded data. Test Setup schema mismatch, import confirmation/cancel, malformed/oversized files, existing-ID skip, partial failure, and safe retry using mocked SharePoint.

Exit: all three built artifacts pass packaging and executable workflow gates; each important failure path has a repeatable test.

### 5. Measure Latency Before Claiming Improvement

Capture legacy and Svelte on the same device/network/tenant with equivalent synthetic sessions. Measure click-to-interactive activity, click-to-confirmed-save, and confirmed-save-to-Agenda at median and p95; record request count, retry/status codes, and payload size. Test expected concurrent participants and admin polling.

Agree on numeric latency/concurrency targets with the owner before approval. The shared session Responses blob and serial REST reads are unchanged, so local speed or a smaller bundle cannot prove better SharePoint saves. Consider batching or changed freshness policies only as separately tested, approved work; list-schema/API changes remain outside this migration.

### 6. Owner-Approved Staging

After local correctness gates, obtain approval for a staging document folder on the same site. Staging pages still point to the same lists: use explicitly designated synthetic client/session records and never run a starter import against live data merely to test the new UI. Verify participant/admin/setup identities, actual same-origin writes and ETags, QR scan/deep links, two-device answer merge/restart isolation, Safari/iPad orientation/safe areas/kiosk behavior, and all downloads.

Exit: written parity, permission, device, and performance sign-off; no unexplained console/network failures or unapproved dependency risks.

### 7. Controlled Cutover and Rollback

Preserve a verified copy of the currently deployed legacy HTML files before rebuilding or replacing them. Record hashes, release version, approved upload window, and responsible owner. Upload only the three approved candidate pages to `p_cec_01`; reload tabs and smoke-test existing resume/QR links. Restrict/remove Setup according to site governance after use.

Rollback restores the three legacy HTML files at the same URLs. It does not reset SharePoint lists or reverse data writes. If a data-affecting defect occurred, handle that separately with the site owner; never delete lists, tokens, tracks, or responses as a rollback shortcut.

## Commands and Outputs

| Purpose | Command | Output or verification |
| --- | --- | --- |
| Shared local API | `npm run dev` / `npm start` | Express; use a scratch `DATA_DIR` for tests |
| Make a client live locally | `npm run go-live -- <clientId> [YYYY-MM-DD]`, or Admin → Today | Calls `activateClient` on the running local server; with no argument it lists the clients. Today does the same, with checks, in the browser |
| Brand Studio | `npm run test:brand` | The slot specs, file sniffing, crop maths, the compress loop with a fake encoder, the scrim, file names, the draft and its checks, what a save writes, `deriveTheme` for 30 primaries; and uploads to the mocked ClientLogos library and the local server. The browser side is `brand-*.spec.ts` under `npm run test:migration` |
| Admin Today and Clients | `npm run test:admin` | Readiness, what is live, the switch confirmation, slugs, the stored theme, colour contrast, and Today's request counts against the mocked SharePoint REST and the local server |
| Storage, budgets and seeds | `npm run test:storage` | Request budgets, races, resume, both response shapes, adapter parity, seeds; mocked SharePoint REST and the local server |
| Svelte source previews | `npm run dev:svelte`, `npm run dev:svelte:admin`, `npm run dev:svelte:setup` | Defaults 5173/5175/5176; availability depends on running servers |
| Type/accessibility diagnostics | `npm run check:svelte` | Migration TS/Svelte diagnostics, not runtime parity |
| Built browser regressions | `npm run test:migration` | Rebuilds candidate; Playwright serves nested-path HTML, intercepts synthetic API data, and shuts down its server on completion |
| Local/shared adapter regressions | `npm test` | Session/server and mocked SharePoint suites |
| Legacy package | `npm run test:build` | Rebuilds `build/` and checks legacy packaging |
| Svelte candidate | `npm run test:build:svelte:release` | Rebuilds `build-svelte/release/`; exactly three HTML files |
| Adapter-only check | `npm run test:sharepoint` | Mocked list mapping, digests, concurrency, QR/import contracts |

## Current Review Gate Results

Fresh checks on 2026-10-09, using Node v26.10.0:

| Check | Result | Meaning |
| --- | --- | --- |
| `npm run check:svelte` | 0 errors, 0 warnings | Type/accessibility diagnostics pass; runtime parity not established |
| `npm test` | 59/59 passed | Scratch sessions and mocked SharePoint contracts pass; parallel runs can hit intermittent Windows temp-file EPERM |
| `npm run test:migration` | 31/31 passed | Builds both legacy and Svelte artifacts; participant/admin/Setup browser scenarios run against synthetic APIs, including both Welcome/User Setup implementations |
| `npm run test:build` | 4/4 passed | Current legacy three-page packaging passes |
| `npm run test:build:svelte:release` | 1/1 passed | Candidate packages three standalone files; no executable browser workflow gate in this test |
| `npm audit --json` | 5 high, 0 low; exit 1 | DOMPurify patched; two residual high transitive chains reviewed above, not waived |
| Toolchain/lockfile | Node floor and lockfile reconciled; isolated script-enabled `npm ci` passed | Project postinstall/vendor output and Svelte/esbuild compiler execution verified without disturbing locked workspace modules; dependency lifecycle-script policy remains unchanged |

The P0 runtime defects and selected P1 defects are repaired and browser-tested. User Setup is implemented across both frontends with active-session selection, staff identity greeting, visitor roster/QR check-in, visit history, idempotent logging, and active-session/QR revocation guards. Thirty-one built-browser regressions now cover both frontends; 59 shared tests, Svelte diagnostics, local data validation, and both package checks pass. Three new SharePoint lists and optional columns must still be provisioned and permissioned by the site owner; no live SharePoint writes occurred. Five high dependency findings, authenticated tenant permission/concurrency checks, privacy/retention approval, physical iPad Safari validation, and measured performance acceptance remain. Overall status is **implemented and locally verified; not approved for production cutover**.