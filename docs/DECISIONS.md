# Decisions that still bind

One line each: the decision, why, and what enforces it (a test fails if it is broken, unless it says "by hand"). The detail is in
[RULES.md](RULES.md); the history of each in [HISTORY.md](HISTORY.md). Changing one of these is a decision for the owner (VJR), not a refactor.

## Platform and deployment

| Decision | Why | Enforced by |
|---|---|---|
| Three single-file HTML pages (participant, admin, setup), everything inlined. | A SharePoint document folder is the only host: no server, no sub-folders, nothing to keep in step. | `scripts/build-svelte-release.js`, `scripts/test-svelte-release.js`, `npm run test:bundle` |
| No server, no app registration, no CDN, no external call: same-origin SharePoint REST with the person's own sign-in. | Corporate network; a CDN may be blocked; nothing leaves the tenant. | `scripts/test-settings-file.js` (only the data layer and the settings reader fetch), `scripts/test-bundle-budget.js` |
| The settings file is `pms-config.txt`; a `.json` is never read. | PCOE serves a `.json` file as a "File Not Found" page with status 200 (14 Oct 2026). | `scripts/test-settings-file.js`, `scripts/release-proofs.js` |
| No default list prefix; an unreadable settings file stops the page. | A page that guesses can quietly use another copy's lists. | `scripts/test-deploy-settings.js` |
| No site address, folder name or PIN hash inside a page. | One set of pages goes anywhere; a page must not leak a site. | `scripts/release-proofs.js` (`npm run test:bundle`, `npm run package:release`) |
| A release package is made only by `npm run package:release`, from a committed tree, and never committed. | What is uploaded is what was tested, with checksums. | `scripts/build-release-package.js` |

## The lists

| Decision | Why | Enforced by |
|---|---|---|
| One schema file names every list and column (`lib/schema/pms-schema.js`, `pms-schema-meta.js`); `SHAREPOINT-LISTS.md` is generated from it. | Six hand-kept tables used to disagree. | `scripts/test-schema.js`, `scripts/test-lists-reference.js` |
| Schema version 5 (3 until Prompt 20, 4 until Prompt 21); a page stops on another version (on a site of an older version that refuses the settings item's read, after reading its version alone); Setup raises an older one and never lowers. | A build must never write lists shaped for another build. | `scripts/test-schema-version.js`, `scripts/test-schema-upgrade.js` |
| The confidence check's two answers are records `<questionId>@before` and `<questionId>@after` in the visit's existing `ResponsesJson`: no answers column, no list. A client's check is an activity of `Kind` `confidence-check`; a session asks it when `ConfidenceCheck` is Yes (schema version 4). | Every layer keys answers by `questionId`, so saving, retries, resume and restart needed no change, and no tally meets an id no question has (Prompt 20, proved in Part 0). | `scripts/test-confidence-check.js` |
| No column named like a SharePoint list-item property (`DisplayName`...). | PCOE refused to return `DisplayName` by name (15 Oct 2026). | `scripts/test-schema.js` |
| Every item read names its columns (`$select`). | PCOE left `ClientId` out of a read that named none (14 Oct 2026). | `scripts/test-named-reads.js`, the strict mock |
| A duplicate is 409 whether SharePoint says 400, 409 or 500. | PCOE says 500. | `scripts/test-duplicates.js` |
| Setup only adds: it never deletes, renames or retypes a column. | A site owner's data and hand-made columns are safe. | `scripts/test-provision.js` |
| The request baselines are never re-recorded to make a test pass; they change only by `--amend` or a proved translation. | A changed request is a finding. | `scripts/test-request-baseline.js` |
| Facilitators need Contribute on PMSVisitLog (it includes deleting), for Delete session; the app changes no list's permissions. | Phase 16: a session's visit log is deleted with it. | `scripts/permissions.js` (the table in SHAREPOINT-LISTS.md and RUNBOOK.md) |
| `PMSAdminUsers` is unreadable to participant accounts. | It holds unsalted PIN hashes; the PIN is not authorization. | By hand (RUNBOOK.md step 11); the local site models it |
| The PIN check stays a mock: SHA-256, no lockout (decision 10 of the architecture). | Real sign-in would be SharePoint groups or Entra; out of scope until decided. | `lib/admin/admin-pin.js` (unchanged since Phase 10c-1) |

## The data layer

| Decision | Why | Enforced by |
|---|---|---|
| `lib/data/dataService.js` is the data layer's one door. Its public surface, 120 names (each with its kind and its arity), is listed in `scripts/data-surface.json`; a name added, taken away or renamed is a decision, recorded here with the new count in the same commit. Prompt 21 added five: `setAccessGuard` (the page's write guard, in `core.js`), `readSignedInPerson`, `readAccessRows`, `listAccessRecords` and `addAccessRecord` (`access-reads.js`); Prompt 21's Phase 2 added three for the people screens in `access-people.js`: `searchDirectory`, `updateAccessRecord` and `removeAccessRecord`. | 39 files of the app and 70 scripts import it: work behind it must not reach them (Phase 17). | `scripts/test-data-surface.js` |
| `dataService.js` holds no code: it passes on the public names of the parts of `lib/data` (`encoding.js`, `core.js`, `common.js`, `schema-check.js`, `records.js`, `today.js`, `responses.js`, `self-test.js`, `qr-scan.js`, `today-clients.js`, `content-copy.js`, `guests.js`, `pictures.js`, `watch.js`, `removal.js`, `list-titles.js`, `session-calls.js`, `access-reads.js`), and no file of the app imports a part directly (`read-groups.js` and `session.js`, helpers with no state, are not parts). | One file of 2,845 lines held every record type, the requests and the self-test; a reader had to load all of it to change any of it (Phase 17). | `scripts/test-data-modules.js` |
| All of the data layer's state (the backend, the write token, the lists' types and columns, whether `$batch` works, the request count, a QR scan not yet known to have landed, the sign-in ladder's state, the page's write guard) lives in `lib/data/core.js`, the only part that calls `fetch()`; no other part declares a variable or a cache at its top, and `openQrScan` writes its held scan through `holdScan()`. | One `configure()` resets everything, and a page is one instance of the data layer. | `scripts/test-data-modules.js`, `scripts/test-settings-file.js` |
| A part imports only parts before it (`core.js` only `encoding.js` and `session.js`, which have no state), nothing under `migration/src` imports in a cycle, and no part is over 600 lines. A part's functions were moved, not rewritten. | One-way layers stay readable; 600 lines is one sitting. | `scripts/test-data-modules.js` |
| Every refused request is classified in one rule book (`REFUSALS` in `lib/data/session.js`: a stale write token, a busy site, a refused sign-in, anything else) and recovered from in one place, the ladder in `lib/data/core.js` (Step A a fresh token, Step B a hidden frame that navigates and a light read, Step C the typed `session-lost`), once for every request refused meanwhile, with a cooldown; a write is sent again only after a renewal and only when SharePoint refused it whole; a 403 with the sign-in proven is a permission. A page with no renewer sends what it always did. | The PCOE admin page showed SharePoint's raw "403 Access denied" on a plain read after it had been open a while, and a reload cured it: a refused sign-in, not a permission (Prompt 19; [SHAREPOINT.md](SHAREPOINT.md#sessions-tokens-and-the-403)). | `scripts/test-session.js`, `session.spec.ts`, `session-keepalive.spec.ts` |
| A test opens a fresh page by importing `dataService.js?<tag>`; `scripts/fresh-page.js` (an in-thread resolve hook) hands the tag on to every part, so each page has its own state as it had its own single file. | Node gives each address its own module; untagged, the parts would be shared between test pages. | `scripts/test-data-modules.js` |

## Roles and access (Prompt 21)

| Decision | Why | Enforced by |
|---|---|---|
| The role matrix (`lib/access/access-matrix.js`) is board 10 of the wireframes the manager approved on 27 Oct 2026, cell by cell: reviewed data, not scattered checks. A changed cell is a decision with its test. | One place says who may do what; menus and routes will be built from it (Phase 4). | `scripts/test-access.js` (the matrix printed) |
| One check, `can()`; the data layer asks the page's write guard before every write and throws `AccessDenied` (no `status`, plain words); nothing refused is sent. Only the admin page installs a guard. | Decision K: screens never decide access alone. It is a guardrail, not a boundary, until the lists' permissions are hardened (Phase 7). | `scripts/test-access.js` |
| A signed-in person is found by two indexed reads (`PMSUsers` by AppId, `PMSRoleAssignments` by `UserKey`), in one `$batch`, kept for the page. | The cost stays the same whatever the number of people. | `scripts/test-access.js`, the request baselines |
| The site owner (a site collection administrator, or a member of the owners group: ASSUMED) is always a Super admin, with a banner until they have a row of their own; the last Super admin row cannot be removed. | Decision I: nobody is locked out. | `scripts/test-access.js` |
| Until Setup copies them, admins unlock with their PIN exactly as before and keep everything the Phase 20 admin page did (the legacy admin); a copied admin is Admin, Producer and Designer on all clients (ASSUMED), and Delete session is a Super admin's (decision E). | Board 10's Admin alone may not run a session, edit content or see results, and an existing admin must keep working. | `scripts/test-access.js` |
| People are disabled, never deleted, and every grant, removal, added person and disable is a line of `PMSAuditLog`, which only grows and holds no answer. | Decision J. | `scripts/test-access.js` (the guard refuses a change to a line) |
| Indexes are exactly what a request filters on: Phase 1 indexes `PMSRoleAssignments.UserKey` (and every AppId); the brief's other indexes come with the phase that first filters on them. | The repo's rule since Phase 10c-2b, held against the recorded requests. | `scripts/test-schema.js` |

## The participant page

| Decision | Why | Enforced by |
|---|---|---|
| The participant page may not grow beyond where the newest phase left it (each phase records its sizes); the target is 400 KB gzip, the ceiling 450 KB. | iPads on venue Wi-Fi; it is the page that matters. | `scripts/bundle-budget.js` (`PHASE_*`), `npm run test:bundle` |
| It carries no export library, chart, report or Setup module. | Size, and the admin's code is not the participant's. | `FORBIDDEN` in `scripts/bundle-budget.js` |
| Delete session's rules live in `lib/admin/session-delete.js`; the data service gains only two generic calls (`listItemKeys`, `deleteByKey`), about 130 B on the participant page. | Every page carries every export of the data service; the rules are the admin's alone. | `PHASE_16` in `scripts/bundle-budget.js`, `scripts/test-participant-storage.js` (the exports) |
| Nothing is cached between page loads; browser storage holds only unsaved answers, visit-log keys, the sound choice and, for the tab's session, how much the device may move (`pms.motion`). | A shared iPad must not show yesterday's data. | `scripts/test-participant-storage.js` |
| It never waits on a read for something it already holds; each moment's rounds are pinned. | PCOE was slow (15 Oct 2026). | `scripts/test-participant-waits.js` |
| Saving goes through `participantData.ts` only; a first answer is never rewritten; Next never waits. | Scores use the first try; a slow save must not stop a person. | `scripts/test-participant-storage.js` |
| Sound is off until the person turns it on; effects only through `effects.ts`; no confetti on a wrong answer. | A room of iPads; one door for Web Audio. | `scripts/test-effects.js` |
| Motion is planned in `lib/motion/motion-plan.js`, drawn by `motion-tokens.css` (transform and opacity only, the only durations and curves) and carried out only by `lib/motion/motion.ts`; every part of a screen settles on one frame. | Cheapest per frame; one place to change the feel; no layout pass per end (Phase 15). | `scripts/test-motion-plan.js`, `scripts/test-motion-engine.js`, `motion-perf.spec.ts` |
| The device's reduced motion wins over the client's Animations switch: no motion and no confetti. | Accessibility; Phase 8's rule. | `motion.spec.ts`, `scripts/test-motion-plan.js` |
| The Animations switch is an optional `motion` key of ThemeJson (absent = on), written alone with If-Match. | No new column or schema version; two admins never undo each other. | `scripts/test-motion-switch.js`, `motion-switch.spec.ts` |
| Open Sans embedded in every page, with a metric-matched local fallback. | The brand font on every device (VJR, 17 Oct 2026); iPadOS and Windows lack it, a CDN may be blocked. | `scripts/test-ux-12.js`, `foundation.spec.ts` (the page renders in Open Sans from inlined fonts) |
| The accent never drives a control; every control fill comes from the primary at 4.5:1. | A red accent reads as a wrong answer. | `scripts/test-theme.js`, `scripts/test-seeds.js` |
| A client's logo is never drawn or imitated: no logo shows the name in type. | Brand use. | `scripts/test-review-9b.js` (the retired drawn logo) |
| The `?preview=` address marks no right answer. | It has no PIN (SEC-1). | `scripts/test-review-9b.js` |
| Staff mode warns that each person needs their own sign-in, and never blocks Go live. | Two iPads on one account overwrite each other (DI-1). | `scripts/test-admin-today.js` |

## Results and exports

| Decision | Why | Enforced by |
|---|---|---|
| The counting rules are fixed (`COUNTING_RULES` in `lib/exports/leader-report.js`) and printed on the report's last page; scores use first answers only. | Leaders compare sessions; the numbers must mean the same every time. | `scripts/test-leader-report.js`, `npm run test:report:mutations`, `npm run oracle` |
| Every number a chart shows is worked out once, in `lib/results/results-chart-model.js`. | The screen, the PDF, the PowerPoint and the CSV must agree. | `scripts/test-results-chart-model.js`, `scripts/test-results-export.js` |
| Names are on the facilitator's own view only; the wall and the Live display's files have none. | The wall is projected to the room. | `results-charts-names.spec.ts`, `results-charts-wall-mutation.spec.ts`, `scripts/test-results-export.js` |
| Names are "Last, First" as the directory gives them. | VJR, 16 Oct 2026. | By hand (QA item 162) |
| The wall page keeps the admin header, tabs, Lock and Export. | VJR, 16 Oct 2026. | By hand (QA item 163) |
| Every colour of a chart comes from `migration/src/styles/results-tokens.css` (Deloitte's validated palette); the client's colour stays in the heading and the report's title band. | Charts read the same for every client; Dark Green means correct and nothing else. | `scripts/test-results-palette.js`, `scripts/test-leader-report-charts.js` |
| "N answers from M iPads" counts the iPads that answered; the leader report counts everyone who opened the session, and says so. | VJR's choice after Phase 11a-2. | `scripts/test-results-export.js` |
| Right and wrong are a mark and a word, never colour alone; every word 4.5:1 in print. | Greyscale printing and accessibility. | `scripts/print-contrast.js` in the report tests |
| A CSV cell never starts a formula. | Excel formula injection. | `scripts/test-review-9a.js`, `scripts/test-results-csv.js` |
| A poll (no answer marked right) is never a readiness blocker. | Content saves "not correct" as No (Phase 12). | `scripts/test-ux-12.js` |
| The blues of the palette (D3) are VJR's to decide. | Not in the 2025 brand guide. | Open |
| Results shows the newest session first (by date, then the latest visit, then the later item), and a refresh never moves a card that is on the screen. | Today's session was at the bottom (Phase 16). | `scripts/test-admin-results.js`, `results-order.spec.ts` |
| In a Results card the newest iPad is first, so the live session shows who just arrived; `ROW_ORDER` in `lib/admin/admin-results.js` flips it back to join order. | Phase 16; VJR may prefer join order. | `scripts/test-admin-results.js` |
| Delete session deletes a session's data permanently: no soft delete, archive or undo in the app. | The owner, 19 Oct 2026. | `scripts/test-session-delete.js` |
| It deletes every item keyed by the session's id in the lists of `SESSION_OWNED`, children first and the session item last, and stops at the first list it could not finish. | A stopped delete leaves a session that is still on Results and can be deleted again, never items nobody can see. | `scripts/test-session-delete.js` |
| The live session is refused; a session in progress that is not live may be deleted. | Test sessions are often left in progress. | `scripts/test-session-delete.js`, `session-delete.spec.ts` |
| The warning plus a button that says what it does ("Delete permanently") is the confirming step: no typed confirmation. One prop of `ConfirmDialog.svelte`, `confirmText`, adds one if the owner wants more friction. | Phase 16, as agreed. | `session-delete.spec.ts` |
| A deleted session's printed guest code says "This QR code isn't recognized." as any unknown code does: no words of its own. | Its own words would grow the participant page. | `session-delete.spec.ts` |

## The Content tab (Phase 18)

A designer works on one client at a time and goes back and forth between what its participants read (activities, questions, options) and how
it looks (colours, logo, hero art, background, animations). Brand Studio moved from a Clients row into the Content tab, beside the client's
activities. Nothing it does, saves or asks changed. The sources, as the Phase 18 brief summed them up on 22 Oct 2026 (not read again for this
record): Nielsen Norman Group, *Tabs vs. Accordions* (tabs for a few long sections, accordions for many short ones);
designmonks.co, *nested tab UI* (two levels at most, the second styled differently, switching never wipes input, focus moves to the new
panel); saasui.design, *workspace organization switcher UX patterns* (one place to switch, the current context's name and logo, the last one
remembered, a stable order, everything switches together); Shopify's changelog, *Redesigned theme editor navigation* (the preview stays in
front, with as little chrome as possible).

| Option | Verdict |
|---|---|
| A. Activities and Brand stacked on one scrolling page, or as accordions | Rejected: several screens long, with content hidden behind clicks. |
| **B. One client workspace: a client header, then two views (Activities, Brand) as tabs; a view stays open once opened** | **Chosen.** Two long sections, two levels at most, no lost work, both views' state shown at once. |
| C. A sidebar inside Content | Rejected for now: heavy for two sections, and it takes width from Brand's preview. A third view is one more row of the views list. |
| D. One screen with a permanent preview of the client's real questions in the draft look | Proposed, not done: a new feature (a preview that mixes the draft look with real content). |

| Decision | Why | Enforced by |
|---|---|---|
| Content's views are one list (`CONTENT_VIEWS` in `lib/admin/admin-content-views.js`: id, label, address segment, component key, badge, one default). The strip, its keys, the address and the badges read only it. | A third view is one row; no label, order or address is typed twice. | `scripts/test-admin-content-views.js` |
| `#content` is Activities, `#content/brand` is Brand; `#sections` and an unknown segment land on Activities. The Content tab comes back to the view last shown this visit, kept in memory as the last client is (the admin page writes nothing to browser storage). | Reload keeps the view through the address, as the top tabs do. | `scripts/test-admin-content-views.js`, `content-brand.spec.ts` |
| A view is mounted the first time it is opened and then kept, hidden with the `hidden` attribute, until the client changes or Content is left. Switching views asks nothing. | Designers switch all day; a prompt on every switch, or a lost draft, would both be wrong. | `content-brand.spec.ts` |
| The guards are the screens' own (`setLeaveGuard`), and more than one can be open at once (`lib/admin/unsaved.ts` asks each in turn). A guard in a hidden view shows its view before it asks. Changing client asks them too. | A dialog inside a hidden view opens at 0 by 0 and blocks the page (measured in Chromium and WebKit, 22 Oct 2026). | `content-brand.spec.ts` |
| A hidden view does no timed work: the activities' 15-second read of the live switches waits while Brand is showing. | Opening, switching and keeping a view make no request that Brand Studio on Clients did not make. | `content-brand.spec.ts` (request count) |
| The client header and the strip are one sticky block on a wide, tall enough window (from 1100 by 700 CSS pixels: one row); elsewhere only the strip sticks. With the top tabs the sticky part takes at most a fifth of the window's height at 1366 by 768 and 1180 by 820. Its heights are custom properties (`--adm-nav-height`, `--adm-content-sticky`) that Brand's sticky preview and the scroll padding allow for. | The picker and the strip stay in reach without taking the room of a long question list or the preview. | `content-brand.spec.ts` (geometry) |
| Brand's own preview keeps client-neutral sample words; "Preview an activity in this look..." opens the existing activity preview, which shows the saved look, so it is off while Brand has unsaved changes and says why. | No screen shows another client's words, and no preview mixes a draft with saved content. | `content-brand.spec.ts` |

## The codebase

| Decision | Why | Enforced by |
|---|---|---|
| One app: the legacy vanilla app is not brought back. | Phase 10c-1's clean break. | `scripts/test-foundation.js` (the legacy files stay gone) |
| Modules live in folders by module under `migration/src/lib`, each with a header. | An unfamiliar developer or model finds the right file in minutes. | `scripts/test-module-headers.js`, `scripts/test-modules-map.js` |
| The documents name only what is there. | Documents that drift mislead. | `scripts/check-docs.js` (`npm test`) |
| An editor opens where its item is: Content's question editor inside the question's row (Add question: a new row at the end), Results' Restart form under its iPad's row; one at a time, focus in and back. Clients' and Guests' editors still open below their list (RELEASE-16.md, proposed). | With ten questions the form was off the screen and the person lost their place (Phase 16). | `content-edit-in-place.spec.ts`, `results-restart-inline.spec.ts` |
| `npm audit` is kept at zero: `overrides` holds `image-size` at `^2.0.4` (it came in through `pptxgenjs`, whose Node-only image reader it is; the browser build leaves it out and no page contains it), and `vite-plugin-singlefile` is at a version without `braces`. A bundler (`vite`, `rolldown`) is changed only on purpose, because it changes the pages. | A site's security scan reads the lock file, not the pages. | `npm audit` and `npm run test:bundle` (by hand before a release) |
| Every build command that loads Vite first checks Node 22.12 or newer (`scripts/node-guard.js`: `npm run dev`, `build`, `doctor`, `build:svelte:release`). | Vite 8 fails inside itself on an older Node with a message that does not name the cause. | By hand (`npm run doctor`) |
| A failing test first, never loosened; no new dependency without asking; never commit to `main`; the owner pushes. | Every change is proved; the owner controls what ships. | By hand |
