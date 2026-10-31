# Prompt 26: speed, paging and scale

Branch `pms-26`, made from `c39b40d` (the tip of `pms-25`). Not pushed. Package `pms-806f04a` (its pages are this branch's; the commits after it change a test, a figure and this note). Nothing here has been run on the real site.

Behaviour, permissions, saved data and every number on a screen are as they were, with the exceptions listed under "What a person will see". No new list, column, dependency or `pms-config.txt` key.

## What was found

| Finding | Where | What replaced it |
|---|---|---|
| The repeated 37.8 kB `$batch` of the photos is the hub's read of the activities, questions and options, on **every arrival at the hub**. | `refreshActivities`, `refreshWith` | `hubRead`: what is held stands until the page's watch reports a change, or five minutes pass. Try again still forces it. |
| Every row carried `__metadata`, every write first asked each list's item type, and the participant page asked for two lists' columns ahead of a write. | `core.js` | Plain rows, no item type, no column read on the participant page. |
| **Today read every property of every field of all 16 lists on every load**, hidden fields and `SchemaXml` too: the largest read of any screen (224 kB on the fake, much more on a real list). | `schema-check.js` | It names what it reads, and a good report stands ten minutes. |
| The hub's look read every activity row every 20 seconds. | `readParticipantWatch` | Each activity's id and `Modified`; the activities only when those moved. |
| Results read all of every session on open (110 requests for 20 sessions). | `AdminResults.svelte` | An index, five to a page, a session read when its card opens. |
| 2 to 3 KB of the participant page was the words of its own CSS comments. | Svelte keeps a style's comment in the page | Stripped at the source (`migration/svelte.config.js`). |

**The three red errors: not found.** `npm run console:errors` shows a clean console on all three pages on the local site, at boot, on the hub and on one saved answer. So they are the real site's alone, and I could not read their text from the photo. A browser prints any refused request as `index.html:1` because the page is one line. Ruled out on the local site: a missing settings file (the package carries it; without it, it would be one 404), a probe that is expected to be refused (none on the participant's path), the icon and the fonts (inline). Not ruled out: a Content-Security-Policy line of SharePoint's own, or a refusal only the real lists give. **Satyadev: please send the three lines (Console, right-click, Save as). `EXPECTED` in `scripts/console-errors.js` stays empty.**

## The measures

The fake, with 0.4 s on every request; the real site's are QA-TESTING.md item 294's.

| Journey | Requests before, after | Chain before, after | kB before, after |
|---|---|---|---|
| Participant boot, a QR scan | 12, 10 | 4, 4 | 22.4, 12.3 |
| Welcome, its first minute | 14, 13 | 2, 2 | 26.6, 15.9 |
| The hub: Welcome, hub, quiz, hub, finale | 15, 12 | 2, 2 | 57.1, 14.5 |
| Answering (each of seven kinds) | 3, 3 | 1, 1 | 1.4 to 2.5, 1.1 to 2.2 |
| The finale | 1, 1 | 1, 1 | 1.2, 0.6 |
| Admin sign-in | 3, 3 | 3, 3 | 1.0, 1.1 |
| Today | 4, 4 | 3, 3 | 223.7, 49.1 |
| Clients | 2, 2 | 2, 2 | 17.9, 7.0 |
| Content, one client | 3, 3 | 2, 2 | 21.3, 10.8 |
| Guests, 30 guests | 3, 3 | 3, 3 | 38.2, 17.1 |
| Results, Sessions, 20 sessions | 110, 9 | 5, 2 | 567.9, 27.1 |
| Results, Dashboard, 40 summaries | 3, 3 | 2, 2 | 44.8, 32.7 |
| People, 60 users | 4, 2 | 1, 2 | 63.6, 19.1 |
| Live display, one refresh | 2, 2 | 2, 2 | 13.6, 9.9 |

**Targets missed, and why** ([perf/TARGETS.md](../perf/TARGETS.md)):

- **A QR scan's chain is 4** (5 with the settings file), not 3: the code and settings, the batch, the new visit, then the claim. A code is single use, so the visit is not the guest's until the claim lands: the page does not say otherwise before it has. Drawing Welcome early would change what a guest can be told. Left as it is.
- **Any first screen has the settings file before it**, so the plain link's chain is 3 in all. The file names the lists, so it cannot be read side by side with them.
- **Welcome makes 13 requests in its first minute, not 12** (14 with the settings file). Batching its questions and options would save one, and it moved ten pins of `test-participant-waits.js`. Not done; say if the one request is worth it.
- **Bytes down 40% is missed** on the answers (12% to 22%: the row is the person's own answers, and it must be read), Admin sign-in (+5%, 57 B: one row with its version), the Dashboard (27%: its tiles use fields inside `SummaryJson`, and the schema has no columns for them) and the Live display (27%: the answers themselves).
- **Clients still reads each client and activity whole**, one request, since Content takes those same rows through and the brand view needs them. Only sessions became an index. The rows drawn are five.

## What a person will see

- People, Clients, Results sessions and the dashboard's By client: 5 to a page. Guests: 20, with a search that shows above 20. History: 10. All in one constant (`PER_PAGE`).
- A Results card is shut until opened (Open, or Delete session..., which reads it for its warning). The first of a page opens by itself, and the live session.
- The i bubble is whole in the window and closes on a scroll or a tap elsewhere.
- A signed-out participant page says "Saved on this iPad. It will send when you are signed in again.", with **Sign in again** beside Reload. The admin banner has Sign in again too.
- An edit to a question's words with the same questions listed reaches a page within five minutes (it reached it at the next arrival at the hub). A change to an activity reaches it at the next look or two.
- The same answer given again writes nothing; the same answer changed again within 300 ms of a write shares the next write.

## Where the brief did not match the tree, and what I decided

| Where | Found | Decided |
|---|---|---|
| `claude/devtools-network-monitoring.md` | Not in the tree. | `docs/DEVTOOLS-NETWORK.md` written from scratch; linked from `README.md` and `docs/TESTING.md`, and from `docs/SHAREPOINT.md`. |
| `signed-in.html` | A new file changes the four-file upload. | The page itself, `?signed-in=1`: no new file, and one the site is known to serve as a page. |
| `components/Pager.svelte` | That folder is the participant's too. | `admin/Pager.svelte`. |
| Column check "in Setup and the self-test" | Tests pin that an admin write to a wrong-shaped list is refused first, and removing it would weaken the unique `AppId` check. | Off on the participant page only (`skipColumnChecks`); Setup, Today and other pages keep it. |
| History "keyset" | Its filters run over the whole list. | Index pattern, 10 a page. **No keyset paging anywhere**: every long list has search or filters. It still reads the whole audit list. |
| Content's client picker, 5 at a time with search | A plain select. | **Not done**: clients are few, and it is one read already. |
| `$select` per caller, "a column the screen never reads" | Rows decode by list, and `Id` and `ID` both come back whatever is asked. | Not trimmed per call site beyond index reads. |
| A separate "changes that land in two looks" | The first design read the activities in a second request. | The next look carries them, so every look stays one request (`polling.spec.ts`). |

## Proved, and only reasoned about

- **Proved on the fake and the local site:** the formats (the fake answers by `Accept`), 412 for a second writer, a sign-in lost and four answers saved once, 6,000 rows, the bubble at two sizes, the Pager by keyboard with axe.
- **ASSUMED until the real site:** that a row read with `minimalmetadata` carries `odata.etag` (item 299), that a plain write needs no type, and that single sign-on works in the small window (item 298). If the first is wrong, a client edit says "did not return an ETag" rather than overwriting: it fails safe. The formats are SharePoint's documented JSON Light; the fake's shape is not the tenant's word.
- **The size warning's sentence** says "Ask Satyadev to run Housekeeping", as the brief wrote it, and Housekeeping is not built.

## The pins that moved

- 17 of 17 node request baselines, by `scripts/schema-baseline/format-baselines.js`: requests for `ListItemEntityTypeFullName` gone, alone or in a batch; the schema check's reads name their properties. A fresh recording equals the translation. `test-provision` needed no change.
- The browsers' start-up baselines, by the same translation (Chromium checked by `request-baseline.spec.ts`).
- `test-participant-storage.js`, `test-participant-waits.js`, `test-site-ready.js`: the removed requests. The self-test's Create is 2 requests. The public surface is 130 names.
- `test-sharepoint.js`'s mock: `odata.etag`, and it asserts no `__metadata` in a body.
- `test-users.js`, `test-hardening.js`: pages of 5 and 10. `test-foundation.js`: 20 focused headings. `test-ux-12.js`: looks at the opened card.
- `users.spec.ts`, `session-delete.spec.ts`, `participant.spec.ts`, `flow.spec.ts` (`allSaved` before the fixture rewrites answers; the retry's write waits 300 ms), `review-9a.spec.ts`, `setup.spec.ts` (13 steps).
- `PHASE_24`'s test compares its own recorded sizes, as a later phase's growth is `PHASE_26`'s.

## Page sizes (gzip)

| Page | Before | After |
|---|---|---|
| Participant | 181,605 B | 180,279 B |
| Admin | 675,595 B | 673,935 B |

## Proposed, not done

Bearer tokens through MSAL.js; an SPFx build; the Azure Function relay; Housekeeping; a service worker for the participant page; an offline outbox beyond memory and `sessionStorage`; virtual scrolling; read replicas or a search index.

## Open questions for the manager

1. Is 5 to a page right for People, Clients, Results sessions and dashboard clients? Guests 20 and History 10 are proposed. One constant each.
2. Will IT say whether sign-in frequency or idle session sign-out applies to the site and the iPads?
3. Are pop-ups allowed on the iPads' browsers for the firm's site?

## Gates

| Gate | Before | After |
|---|---|---|
| `check:svelte` | 0 errors, 0 warnings | 0 errors, 0 warnings |
| `npm test` (holds `test:baseline`, `test:bundle`) | 2,073 pass | 2,127 tests; 2,127 pass. One later run: 2 failures of `test-store.js` (a read meeting a write on Windows), which passed 3 of 3 alone. Not changed by this prompt: **watch it** |
| `test:report` | 158 pass | 158 pass |
| `test:report:mutations` | 71 of 71 | 71 of 71 |
| `oracle -- --seeds 500` | 0 differences | 0 differences |
| `test:charts` | 57 pass | 67 pass |
| `test:local-site` | not run | 29 of 29 |
| `console:errors` | clean | clean, on the package's pages |
| Page sizes | above | above |

**Browsers: Chromium only, the whole suite: 593 of 603 passed** on the commit before the last fixes. Of the ten: five were this prompt's pins in specs (`request-baseline`, `settings-file`, `setup`, `sharepoint` twice), now passing. Five are not this prompt's: `admin-today` "slugs" (a known flake), `contrast` (the Live display's ring, 1.64:1), `devices` (Content's strip on an iPhone in landscape), `reflow` (Content's chip at 200%), all recorded in RELEASE-22 or RELEASE-24, and `confidence-check` "axe on Before and After", which **also fails on pms-25's own pages** (run in this prompt) and is recorded nowhere before now.

**Not run:** WebKit, so the Pager, the bubble and the sign-in words are unproved on Safari's engine; Firefox does not start here; `test:rehearsal`. The pop-up has a unit test with a stand-in window and has never opened in a browser: `users.spec.ts` and the rest do not press Sign in again. A `test-store.js` run and the WebKit run belong to the final round.
