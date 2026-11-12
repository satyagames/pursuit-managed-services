# Prompt 44: the architecture refactor (behaviour-preserving)

Branch `pms-44`, from `pms-43` (`842d9e4`). Not pushed. The one rule: nothing the user sees, and no stored data, may change: same pixels, same
words, same requests to SharePoint, same stored answers, same exports. A change that would alter behaviour is not made; it is listed under
"Found, not changed".

## How a step is proved

- **The gate**, after every step: `npm run check:svelte`, `npm test`, `npm run test:bundle`, `npm run docs:modules`, `npm run docs:check`.
- **The pictures** (`npm run test:refactor`, `scripts/migration-tests/refactor-baseline.spec.ts`, its config `migration/playwright.refactor.config.ts`):
  31 full-page pictures of the built pages, motion off and the clock held, against seeded data: Today closed and with Session settings open at
  1280, 1440 and 1920; Clients, and with a client open; Content's Activities and Brand; Guests and QR; the QR sheet; Results with a session
  open, and its dashboard; People, and with a person open; the Live display; Setup; and on the participant page Welcome, the agenda, a question
  of each of the seven kinds (Art of the Possible empty), Art of the Possible rated, the confidence check, Thank you and Not live. The "before"
  pictures are kept in `test-results/refactor-before/` (not committed), recorded on `pms-43` and checked stable over two further runs; a page
  whose pixels differ by more than 0.1% fails.
- **The pages' bytes**: the three pages built on `pms-43` are kept (sha-256 below). A step that only moves code is proved when the pages are
  the same bytes; a step that changes the code the bundler sees is proved by the pictures, the request baselines and the suites.
- **The request baselines** (`scripts/request-baseline/*.txt`, 20 files) are never re-recorded; their sha-256 at the start is kept, and
  `npm test` (`scripts/test-request-baseline.js`) compares every recorded suite with them.

## Before (measured on `pms-43`, 12 Nov 2026)

| Measure | Before |
|---|---|
| Lines in `migration/src` (`.svelte`, `.js`, `.ts`) | 49,954 (53,831 with the `.css`; the brief's 50,703 was counted another way) |
| Tracked files | 813 |
| `scripts/test-*.js` | 121 (210 test files with the `.spec.ts`) |
| `npm test` | 2,375 tests, 1 failing (`docs/MODULES.md` was stale on `pms-43`), 22.9 s |
| `check:svelte` | 515 files, 0 errors, 0 warnings |
| `.svelte` over 450 lines | 15 |
| `.js` / `.ts` over 500 lines | 7 |
| `admin.css` + `admin-look.css` | 1,267 + 1,101 lines; 47 selectors written in both, 40 classes with a top-level rule in both; 1 `!important` |
| Hex colours in admin code outside the token sheets | 4 values in 3 files (`BrandColours.svelte` 1, `live-view.js` 2, `ReportExports.svelte` 1), and 5 in comments |
| Participant page | 193,942 B gzip -9 |
| Admin page | 719,982 B gzip -9 (budget 720,000 B; the brief's 700,000 B was already passed before the work) |
| Setup page | 816,793 B gzip -9 |
| Pages (sha-256) | `index.html` `c05f0c72…`, `admin.html` `d6e7ec8f…`, `setup.html` `57fc59cb…` |

The 15 largest source files: `pager/MatrixRating.svelte` 1,497; `admin.css` 1,267; `admin-look.css` 1,101; `admin/AdminResults.svelte` 899;
`admin/LeaderDashboard.svelte` 781; `lib/exports/resultsExport.js` 716; `admin/AdminToday.svelte` 659; `lib/results/results-chart-model.js` 635;
`admin/LiveDisplay.svelte` 628; `lib/exports/leader-report-layout.js` 612; `lib/exports/leader-report.js` 592; `lib/data/core.js` 590;
`pager/ActivityPager.svelte` 567; `lib/setup/provision.js` 549; `lib/setup/list-permissions.js` 539.

## The plan and where it stands

- [x] **44a** Baselines: the picture spec, the pages' bytes, the request baselines, the bundle sizes, this file.
- [x] **44b** Scripts: one `perf` and one `console:errors`; `scripts/test-package-scripts.js`; `npm test` from `scripts/tests.manifest.json`.
- [x] **44c** Boundaries: the layers written down; a door, migration/src/preview/index.ts; scripts/test-boundaries.js.
- [x] **44d** One tab registry (lib/admin/tabs.js) and the router (lib/admin/router.ts).
- [x] **44e** The admin's shared primitives (admin/ui/), after an inventory.
- [ ] **44f** The oversized files split along their seams.
- [ ] **44g** The admin's styles in cascade layers under styles/admin/; tokens only for colour.
- [ ] **44h** scripts/check-unused-exports.js and the dead exports.
- [ ] **44i** The documents.

## Step notes

**44b.** The two `perf` keys and the two `console:errors` keys were the same command each; one of each is kept. `scripts/test-package-scripts.js`
reads package.json's text, so a key written twice is seen (it failed first on `perf` and `console:errors`). `npm test` is now
`node scripts/run-tests.js`, which runs in one `node --test` every file of the ten groups of `scripts/tests.manifest.json`: the 115 files of the
hand-written list, the same 115 (the test compares the two lists, pinned as they were on `pms-43`), and the tests this prompt adds
(`scripts/test-package-scripts.js` here). The 27 per-area scripts (`test:report`, `test:charts`, ...) read their own suite of the same manifest, and
their file lists are what they were. Six files are not in npm test, each with its reason in `excluded`: four that build or read a build with
Vite, the local site's, and `scripts/test-identity-words.js` (see "Found, not changed").

**44c.** The layers are written once, in `scripts/test-boundaries.js` (`LAYERS`), and in `docs/DECISIONS.md` ("The codebase"). The admin's
fifteen imports of the participant's pieces (`GuestAvatar` in six screens, `DeloitteWordmark` in two, and Brand Studio's and the activity
preview's `AppShell`, `HeaderGreeting`, `SoundToggle`, `ActivityPager`, `Agenda`, `Quiz`, `ThankYou`, `Welcome`) go through
`migration/src/preview/index.ts`, which only re-exports; no file moved. The test failed first on those fifteen and on two modules without a
header (`main.ts`, `components/index.ts`, which have one now). Eleven exceptions are allowed, each with its reason: the data layer reads three
formats defined higher up (a picture's name, the confidence check's record ids, an Art of the Possible answer), Results reads the fiscal period
from `lib/admin/session-plan.js` and the counting rules from the leader report, Setup's sample pictures are data in `setup/`, and the
styleguide is reached only under `import.meta.env.DEV`. Pages, built under one name: the participant page and Setup the same bytes; the
admin page 719,982 -> 719,818 B gzip (the modules' order changed). Pictures: no difference.

**44d.** `lib/admin/tabs.js` (`ADMIN_TABS`) is the one list of the six tabs: id, words, icon, the actions that open each (taken by id from
`TAB_ACTIONS` in `lib/access/scope.js`, which stays the role matrix's, so the layer below need not read the admin's list), order, and whether the
PIN's legacy admin sees it. `AdminApp.svelte` draws the bar, the Menu and the panel from it, and reads and writes every address through
`lib/admin/router.ts` (`liveOfHash`, `liveHash`, `tabOfHash`, `hashOfTab`, `contentViewOf`, `openingScreen`, `tabKeyTarget`, `PRINT_HASH`), the
functions it held inside, moved with no change of what they return. `scripts/test-admin-router.js` (9 tests: the addresses, the guards, the
keys, and that `AdminApp.svelte` has no list or address code of its own and a panel for every tab) failed first on `AdminApp.svelte`.
`scripts/test-admin-icons.js` now also reads `tabs.js`, so it still sees the tabs' icons. Not done as the brief has it: the registry holds no
component loader (the screens are a higher layer than `lib/admin`; a loader would also make each tab load later, which is a change), and the
identity popover's "What you can do" keeps its own order of the role matrix's modules (`lib/access/identity-words.js`, a lower layer).
Pages: the participant page and Setup the same bytes; the admin page 719,977 B (pms-43: 719,982 B). Pictures: no difference. In Chromium,
`content-brand`, `role-scoping`, `identity-chip` and the Menu test of `admin-full-width` (35 tests) pass.

**44e.** The inventory (markup or a component written in three admin screens or more), and what became of each:

| Pattern | Where | Done |
|---|---|---|
| A screen's title row: icon, h2, a line of words, actions | 12 screens | `admin/ui/PageHead.svelte`, in 9 (Today, Clients, Content, Guests and QR, Results, a client's page, the Leadership dashboard, Reporting settings, History of changes); People and a person's page keep their own, because their sheets style the row themselves (`.people__head`, `.detail__head h2`), which a child component's markup would not receive |
| Confirm dialog | 7 screens | already one component: moved to `admin/ui/ConfirmDialog.svelte` |
| Pager | 5 screens | moved to `admin/ui/Pager.svelte` |
| Sticky bar | 4 screens | moved to `admin/ui/StickyBar.svelte` |
| Breadcrumb | 4 screens | moved to `admin/ui/Breadcrumb.svelte` |
| Fold (disclosure) | 3 screens | moved to `admin/ui/Fold.svelte` |
| Other dialogs (`<dialog>` of their own) | 8 files | not extracted: each has its own class, sheet and closing rule (`oncancel` held while busy, or `onclose`), so one frame would change one of them |
| Segmented controls | Today's settings (radiogroup), the wall's look (pressed buttons), Results' view switch, Content's views (tabs) | not extracted: four different roles and keys; one control would change what a screen reader hears |
| Chip | 5 uses in 5 files, each a different look | not extracted |
| Empty state | 5 uses in 4 files, different words and shapes | not extracted |
| Field with label, master and detail | written as classes of the sheets, not as markup | left to the sheets (44g) |
| Disclosure toggles (`aria-expanded`) | 21 in 16 files: menus, popovers, the Change / Hide toggle, Fold | Fold is the one disclosure; the rest are menus and popovers, other patterns |

`PageHead` draws the markup each screen wrote (`header.panel__head`, the words in its first div, the heading then the line, the actions after),
so admin.css's rules reach it as before; a screen's own scoped rule does not reach a child component's element, and the one that did (Clients'
`.clients > *`, which spans the title row across the grid) now names it (`.clients > :global(.clients__head)`). The picture comparison found
that (the Clients screen 72 px taller) before it was fixed. `scripts/migration-tests/admin-ui.spec.ts` holds the title row's markup and focus
on every screen; it passes on the `pms-43` pages and on these. `scripts/test-foundation.js`, which counts the files with a heading focused by
script (23), reads `<PageHead ... focusable>` as such a heading, so it keeps its reach (it failed at 18 until it did). Icons: the two inline SVGs
of `AssetUploader.svelte` and `CropDialog.svelte` are not icons (see "Found, not changed"). Pages: the participant page and Setup the same bytes;
the admin page 719,980 B. Pictures: no difference.

## Found, not changed

- `scripts/test-identity-words.js` (Prompt 32's words beside the person's name, 30 tests, all passing) was in no npm script, although
  `docs/DECISIONS.md` names it as what enforces that decision. It is listed in the manifest's `excluded` with that reason, so that npm test runs
  the same files as before; adding it to a group is the owner's call.
- A race between two suites of `npm test`, seen once in this work: `scripts/test-motion-switch.js` writes and removes
  a copy of `client-theme.js` beside it (`.client-theme.pms14.tmp.js`) while `scripts/test-data-modules.js` walks the tree, which then fails on a file that has
  just gone (ENOENT). It is older than this prompt and passes when run again. `scripts/test-boundaries.js` skips files whose names start with a dot,
  so it cannot meet it; the two older suites were left as they are (a fix there is a change to tests that guard live behaviour).
- The two inline SVGs outside `admin/Icon.svelte` (`AssetUploader.svelte`, `CropDialog.svelte`) are the crop guide: an ellipse or a rectangle
  drawn from the picture slot's own geometry in a 0-to-1 box stretched over the picture. `Icon.svelte` draws a fixed path in a 24 px box, so
  drawing the guide with it would change what is drawn. They are left; the guide is in two files only, under the three-uses rule.
- Two tests of `scripts/migration-tests/admin-explains.spec.ts` fail in Chromium on the `pms-43` pages as on these: "every tab: ... the main
  action is green" (Today) and "Content: ... the chosen part is on the primary wash". They pinned colours that Prompt 41's palette changed; they
  were left as they are.

## Chosen not to do
- **Moving the eleven allowed modules to their right layer** (for example the stored formats of `confidence-check.js` and `aop-answer.js` to
  `lib/schema`, `periodOf` to `lib/results`). Each module also holds code its own layer uses (the check's flow, the pager's grid rules, the
  session plan), so a move is a split of the module, it changes the paths that 20 to 30 files and tests read, and Phase 17 pinned the data
  layer's parts and their imports. It is left as the allow-list, which only shrinks, for a commit of its own.
