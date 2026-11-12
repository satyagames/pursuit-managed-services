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
- [ ] **44b** Scripts: one `perf` and one `console:errors`; `scripts/test-package-scripts.js`; `npm test` from `scripts/tests.manifest.json`.
- [ ] **44c** Boundaries: the layers written down; `migration/src/preview/index.ts`; `scripts/test-boundaries.js`.
- [ ] **44d** One tab registry (`lib/admin/tabs.js`) and the router (`lib/admin/router.ts`).
- [ ] **44e** The admin's shared primitives (`admin/ui/`), after an inventory.
- [ ] **44f** The oversized files split along their seams.
- [ ] **44g** The admin's styles in cascade layers under `styles/admin/`; tokens only for colour.
- [ ] **44h** `scripts/check-unused-exports.js` and the dead exports.
- [ ] **44i** The documents.
