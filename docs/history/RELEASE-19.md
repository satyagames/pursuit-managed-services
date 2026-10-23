# Prompt 19: SharePoint session resilience

Branch `pms-19`, made from `756ca3d` (the tip of `pms-18`, which is not merged). Not pushed. The problem: on the PCOE site the admin page sometimes
showed, in red under a screen's heading (seen on **Clients** right after opening the tab), `SharePoint (403): Access denied. You do not have
permission to perform this action or access this resource.` A reload cleared it, and it happened most often after the page had been open a while.

**What the code did.** `spHttp()` retried a 403 only when its words said "security validation" or "request digest" (a stale write token); any other
403 reached the screen as SharePoint's own words. `spReadTogether()` and `spReadOrBatch()` took a 403 on a `$batch` for a stale token and read with
plain GETs, which carry no token: when those were refused too, the cause was the sign-in, not the token. Nothing renewed the sign-in, retried the
read, said what to do, or kept anything to diagnose it with.

**The cause, ASSUMED** until QA-TESTING.md item 205 captures the error code and the SPRequestGuid: SharePoint Online renews its sign-in cookies when a
person navigates on the site, not reliably on a `fetch()`; the admin page is a static file that only calls `/_api` once it is open, so a tab left open
(or a laptop that slept, or a change of network) ends with a sign-in SharePoint no longer accepts, and a reload, a navigation, renews it. A tenant's
idle-session sign-out or Conditional Access sign-in frequency would do the same on purpose ([SHAREPOINT.md](../SHAREPOINT.md#sessions-tokens-and-the-403)).

## The classification, as built

One frozen rule book, `REFUSALS` in `migration/src/lib/data/session.js`; the first row a refusal matches is its kind, and a comment beside each row
says where it was seen. `scripts/test-session.js` holds each row to its own case.

| Kind | Recognised by | What happens |
|---|---|---|
| `digest` | 403 with SharePoint's code `-2130575252` (ASSUMED), or the words "security validation" / "request digest" | As before: the token is asked for again and the request sent once more. |
| `busy` | 429, 503, 504 | As before (`Retry-After`, the back-off). |
| `session` | 401; a sign-in page or any answer that is not JSON; 403 with code `-2147024891` (System.UnauthorizedAccessException, ASSUMED); 403 with the words "Access denied" or "You do not have permission" | The ladder. |
| `permission` | A `session` 403 that still happens once the sign-in has been proven to work (Step A's fresh token, or Step B's light read) | A plain sentence naming the list; that list is not recovered for again this visit. |
| `other` | Anything else | As before. |

`digest` and `busy` are tried first, so nothing they cover is ever taken for a sign-in, whatever its words (a test adds "Access denied" to each of
their cases and checks).

## The ladder

`spRefused()` in `lib/data/core.js`, for `spHttp()` and `spBatch()` (the only two calls of `fetch()` against `/_api`); SharePoint mode only.

1. **Evidence first.** In memory, the last 20: ms since the page loaded and since its last answer, `document.visibilityState`, the method, the list's
   key (never an item id, a name or an answer), the status, SharePoint's error code, `SPRequestGuid` and `X-SharePointHealthScore`. Never stored,
   never sent; shown in the banner's Details and listed under Setup's self-test.
2. **A page with no renewer stops here** and throws what it always threw. Every node suite is such a page, which is why the request baselines,
   the mocked suites and their messages are byte for byte as they were.
3. **One recovery** for every request refused meanwhile (`recoverSession()`, single flight); after one that failed, none for 5 s (the cooldown).
4. **Step A:** a jittered pause (0.25 to 0.75 s) and a fresh write token from `/contextinfo`, outside the ladder. If it comes, the sign-in works: a
   read is sent once more; a write is not (the account, not the sign-in, refused it), and a 403 then is a permission.
5. **Step B:** the renewer (`lib/common/session-renewer.ts`): a hidden frame, sandboxed (`allow-same-origin allow-scripts allow-forms`: no top
   navigation, no downloads), navigates to the page's own `pms-config.txt` with a query of its own, waits for `load` (10 s at most) and is removed;
   then `GET /_api/web?$select=Id` proves the sign-in, and the request is sent once more, a write too, because SharePoint refused it whole and it
   did not run. Chosen: `pms-config.txt`, because every account that can open the page can read it, it is a few hundred bytes, and the test harness
   serves it (a lightweight SharePoint page under the site is the second candidate the brief named; it was not needed on the fake and is not used).
6. **Step C:** `session-lost` (status 401), SharePoint's status and words only in `details`; the page's listeners hear "lost" once, and "back" at
   the next answer.
7. **Writes:** sent at most twice in all (a stale token's resend counts), never after a part of a `$batch` was refused (the hole is read with a
   plain GET, as before), a timeout or a 5xx.
8. `spReadTogether()` and `spReadOrBatch()` keep their 403 handling for the `digest` kind; a `session-lost` from the batch is thrown, not turned
   into three plain reads that would be refused too.

**Tested versus reasoned about.** Every step was proven on the mocked SharePoint (`scripts/test-session.js`, with a renewer the test supplies) and
in the browser against the built admin page (`session.spec.ts`, where Step B's real frame loads `pms-config.txt` and the "site" renews or does not).
**Step B was not proven on SharePoint Online**: whether a navigation in a hidden, sandboxed frame renews a real sign-in, or meets the sign-in
page's framing rules, is QA-TESTING.md items 206 and 207. The error code of the PCOE refusal is assumed (item 205).

## The words

- **Admin and Setup:** one banner (`admin/SessionBanner.svelte`), `role="alert"`, not taking focus: "Your SharePoint sign-in needs refreshing. Reload
  this page to carry on." with **Reload** and **Details** (status, code, SPRequestGuid, time since the last answer). With unsaved work on a screen
  (`hasUnsaved()` in `lib/admin/unsaved.ts`) it adds "Your unsaved changes here will be lost if you reload." and **Stay on this page**. Nothing reloads
  by itself. A later answer takes it away; the admin's toast says "Reconnected.".
- **Screens** that print their own error line (Clients, Content, Guests and QR, Results, the question editor, Brand, Today through `failureText`)
  print their own plain fallback for a lost sign-in, and the permission sentence, through one function, `errorText()` in
  `lib/admin/session-notice.js`. Toasts carry the error's message, which for a lost sign-in is the banner's sentence.
- **A permission:** "Your account cannot read PMSClients. Ask the site owner for Contribute access to the PMS lists." ("change" for a write; the
  list's title on this site, `spTitle()`), with the same Details line.
- **The participant page** keeps its own "Your sign-in has expired" screen and its answers not yet saved: `isSignedOut()` is true for `session-lost`.

## The keep-alive

`lib/common/session-keepalive.ts`, on the admin page only, SharePoint only, while unlocked: on `page-watch.ts`'s one timer, one `GET
/_api/web?$select=Id` when no request has been answered for `SESSION_LIMITS.idleMs` (10 minutes), at once when the tab is shown again after that
long, never while it is hidden; a failed check waits a whole idle time. A screen that refreshes (Today every 10 s, Results, the Live display) adds
nothing (`session-keepalive.spec.ts`, on Playwright's clock: 0 light reads in 11 minutes of Today).

## The evidence format

One line per refusal, as the banner's Details and Setup's list say it:
`403 · -2147024891 · GET clients · SPRequestGuid fa000012-0000-4000-8000-000000000019 · 12 min since the last answer` (with `health N` when SharePoint
sends `X-SharePointHealthScore`, and `tab hidden` when it was).

## Found while building, and what was done

- **The table's notes shipped in every page.** Written first as strings, the rows' "seen on" notes went into the participant page, and the release
  proof refused it for naming the site. They are comments now, as the brief asked.
- **"table" in a comment** added a Tailwind `.table` rule to the participant page (CLAUDE.md warns of it); reworded to "rule book".
- **Existing suites inject "Access denied" as a permanent refusal** (an account that may not create lists, a list participants may not write).
  With the ladder on, each would have sent one `/contextinfo` more and changed ten request baselines. The ladder runs only on a page with a
  renewer, which every real page has; the baselines are unchanged and were never amended.
- **A latent fault in `page-watch.ts`, not fixed here.** When `enabled()` returns false, the check's async body finishes at once, its `finally`
  clears `running` before `running` is assigned, and the watcher keeps a finished check as the one running: it never checks again. The keep-alive
  decides idle inside its check instead. The participant page and the Live display pass an `enabled()` that can be false: see "Proposed, not done".
- **Two structure pins moved with the design**, each saying why: `core.js` imports `encoding.js` and now `session.js` (both without state;
  `session.js` imports no part, a new assertion), and `session.js` is listed with `read-groups.js` as a helper that is not a part. The public surface
  is 112 names (`setSessionRenewer`, `onSessionChange`, `sessionEvidence`, `lastAnswerAt`, `checkSession`): `data-surface.json`, DECISIONS.md and
  `test-participant-storage.js`'s list changed with it.

## Gates, before and after

Before: `756ca3d` (the tip of `pms-18`) in a worktree of its own; after: this branch. Windows, Node 22.23.3 (`.local/node22`); Firefox does not
start on this machine (spawn UNKNOWN), so the browser runs are Chromium and WebKit.

| Gate | Before | After |
|---|---|---|
| `npm run check:svelte` | 0 errors, 0 warnings (404 files) | 0 errors, 0 warnings (410 files) |
| `npm test` | 1,513 of 1,513 | 1,539 of 1,539 (25 new in `test-session.js`, one new bundle test) |
| `npm run test:baseline` | 38 of 38 | 38 of 38, no baseline amended |
| `npm run test:bundle` | 43 of 43 | 44 of 44 |
| `npm run test:report` | 150 of 150 | 150 of 150 |
| `npm run test:report:mutations` | 64 of 64 caught | 64 of 64 caught |
| `npm run oracle -- --seeds 500` | 0 differences | 0 differences |
| `npm run test:local-site` | 26 of 26 | 26 of 26 |
| `npm run test:migration` (Chromium, WebKit) | 902 passed, 27 failed, 16 skipped (46.0 min) | 920 passed, 25 failed, 16 skipped (46.1 min) |

The 25 failures after are all among the 27 before: the known Windows WebKit faults (17 of `effects-audio.spec.ts`, `brand-smoke.spec.ts`,
`flow.spec.ts`'s header, one `keyboard.spec.ts` test), `admin-today.spec.ts` "slugs", and the admin layout checks that fail on the untouched tree
too (`contrast.spec.ts` every tab in each look, `devices.spec.ts` iPhone landscape, `reflow.spec.ts` 200% at 820 px in both engines). The two
failing only before are the two known flakes (`brand-studio.spec.ts`'s answer tile, `content-brand.spec.ts`'s switch). The 18 more passes are
the 16 new tests (`session.spec.ts` and `session-keepalive.spec.ts` in both engines) and those two flakes. Both new specs were run against the
Phase 18 pages first: 7 of their 8 tests failed (the eighth, that a busy screen adds no request, holds on both, as it should). `test-session.js`
on the old `core.js`: 10 of its first 21 tests failed (the others pin what must not change).

## Page sizes

| Page | Before (gzip -9) | After (gzip -9) | Change |
|---|---:|---:|---:|
| `index.html` (participant) | 158,392 B | 160,367 B | +1,975 B (ceiling 450,000 B, not raised; its Tailwind rules unchanged) |
| `admin.html` | 582,904 B | 585,277 B | +2,373 B (budget 700,000 B) |
| `setup.html` | 788,936 B | 791,218 B | +2,282 B (the rule book, the renewal and the banner) |

`PHASE_19` in `scripts/bundle-budget.js` records them, with allowances of 2,500 B (participant) and 3,500 B (admin).

## Proposed, not done

- **Fix `page-watch.ts`'s finished-check fault** (above): assign `running` before the body can finish, or let `finally` clear it only when it is
  still the same check. It changes when the participant page and the Live display look again after a screen that disables their check, so it needs
  its own tests and the polling specs.
- **A second renewal candidate** (a lightweight SharePoint page under the site), if item 206 shows that `pms-config.txt` in a frame does not renew a
  real sign-in.
- **Toasts** for writes (Clients, Content's activities, Results' Restart) still show the error's message: for a lost sign-in that is the banner's
  sentence, for a permission SharePoint's own words. Routing every toast through `errorText()` is a wider edit of each screen.
- **The PCOE error code** in `REFUSALS` is assumed: replace it with the one item 205 captures.

## What only the real site can show

QA-TESTING.md items 205 to 210: the captured refusal (its code and SPRequestGuid) before this package; whether an idle or sleeping laptop recovers by
itself or shows the banner, never the raw words; that unsaved Brand changes are warned about and nothing reloads; and IT's answer about idle-session
sign-out and Conditional Access, which decides whether the banner is expected after a fixed time.
