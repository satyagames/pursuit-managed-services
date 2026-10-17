# CLAUDE.md

Pursuit Managed Services (PMS): an interactive session app for Deloitte client visits. Participants answer short activities on iPads; a facilitator
runs the day from an admin page and shows live results on a projector; leaders get a PDF report, a summary pack and CSVs. It is three single-file
HTML pages (participant `index.html`, admin `admin.html`, `setup.html`), built with Svelte 5 from `migration/`, that run from one SharePoint document
folder and keep everything in twelve SharePoint lists, through the browser's own sign-in. No server, no CDN. A local Express + JSON server
(`server/`) stands in for SharePoint in development and in the tests.

`AGENTS.md` points here. The detail: [docs/RULES.md](docs/RULES.md) (the rule book, by part and phase), [docs/DECISIONS.md](docs/DECISIONS.md) (what
binds and what enforces it), [docs/MODULES.md](docs/MODULES.md) (the module map, generated), [docs/DATA-FLOW.md](docs/DATA-FLOW.md),
[docs/SHAREPOINT.md](docs/SHAREPOINT.md), [docs/TESTING.md](docs/TESTING.md), [docs/HISTORY.md](docs/HISTORY.md). A machine-readable summary is
[docs/project-map.json](docs/project-map.json).

## Commands (Node 22.12 or later)

On the Windows checkout the system Node is 20: run Node 22 from `.local/node22/node.exe`, and npm through it, or `node:test` hooks misbehave
([docs/TESTING.md](docs/TESTING.md)). Set `git config core.autocrlf input`.

| What | Command |
|---|---|
| Install | `npm install` |
| Local server (API, pictures, no page) | `npm run dev` |
| The pages, from Vite (with `npm run dev` running) | `npm run dev:svelte` (5173), `npm run dev:svelte:admin` (5175), `npm run dev:svelte:setup` (5176) |
| Build the three pages | `npm run build:svelte:release` (into `build-svelte/release/`) |
| Fast checks, after every change | `npm run check:svelte`, then `npm test` (about 20 s) |
| Results and exports | `npm run test:report`, `npm run test:report:mutations`, `npm run oracle -- --seeds 500`, `npm run test:charts` |
| Browsers | `npm run test:migration` (Chromium, WebKit, Firefox; about 45 min) |
| The local PCOE site | `npm run local:site -- --open`, `npm run test:local-site`, `npm run ux:shoot` |
| Release package | `npm run package:release` (clean committed tree only) |
| Documents | `npm run docs:check`, `npm run docs:modules`, `npm run build:lists-reference` |

## Where things are

| Path | What |
|---|---|
| `migration/src/main.ts`, `admin-main.ts`, `setup-main.ts` | The three entries; `App.svelte`, `AdminApp.svelte`, `SetupApp.svelte` the apps. |
| `migration/src/lib/<folder>/` | The modules, by folder: `data`, `schema`, `settings`, `participant`, `common`, `admin`, `results`, `exports`, `brand`, `effects`, `setup`. Every file starts with a header saying what it owns. |
| `migration/src/lib/data/dataService.js` | The data layer: the only module that talks to SharePoint (or the local server). Every page carries all of it. |
| `migration/src/lib/schema/pms-schema.js` | The one place a list or column is named. `pms-schema-meta.js` says everything else about them. |
| `migration/src/admin/`, `admin/charts/` | The admin page's screens and the hand-drawn Results charts. |
| `migration/src/routes/`, `pager/`, `components/` | The participant page's screens, the one-question-per-screen pager, its building blocks. |
| `migration/src/styles/` | Tokens, the focus ring, fonts, `results-tokens.css` (the chart palette), `legacy/` (old sheets: override, never edit). |
| `server/` | The local stand-in for SharePoint (`server/data/*.json` is committed seed data; only `server/store.js` touches it). |
| `scripts/` | Node tests (`test-*.js`), the mocked SharePoint (`sharepoint-fake.js`), the oracle, baselines, generators, the packager. |
| `scripts/migration-tests/` | The Playwright specs. |
| `docs/` | The documents; `docs/history/` is the record, kept as it was. |
| `QA-TESTING.md` | What only a real site, iPad, projector or printer can show; open items first. |
| `SHAREPOINT-LISTS.md` | Every list and column, generated from the schema (the pages cite it by name). |

## Rules you must not break

1. **Never commit to or push `main`.** Work on a branch; the owner pushes after testing on SharePoint. Never `git add -A`: untracked brand and local
   files must stay untracked. Commit with `git -c core.autocrlf=input`.
2. **No new dependency** without asking. Nothing loaded from a CDN or any external address.
3. **The participant page may not grow** beyond where the newest phase left it (`scripts/bundle-budget.js`); it must not carry the admin's libraries,
   the Results charts, the exports or Setup's modules. Tailwind reads every file under `migration/` for class names, comments included: words like
   `table`, `hidden`, `absolute` in a new file can add rules to it. Run `npm run test:bundle`.
4. **Behaviour the tests pin stays pinned.** Write the failing test first and show it failing; never loosen or delete a test that guards live
   behaviour; never re-record a request baseline to make it pass (`--amend` only, see [docs/TESTING.md](docs/TESTING.md)).
5. **SharePoint:** every item read names its columns (`selectOf`); a duplicate is 409 for 400, 409 or 500; no column named like a list-item property
   (`DisplayName`); a list title only through `spTitle()` / `sharePointListTitles()`; schema version 3; the settings file is `pms-config.txt`.
6. **Only `lib/data/dataService.js` fetches** (and `lib/settings/settings-file.js`, the settings file). Sounds and confetti only through
   `lib/effects/effects.ts`. Saving answers only through `lib/participant/participantData.ts`.
7. **Names are on the facilitator's view only**: never on the wall display, in the Live display's PDF, PowerPoint or summary CSV.
8. **The counting rules are fixed** (`COUNTING_RULES` in `lib/exports/leader-report.js`, first answers only). Every number a chart shows comes from
   `lib/results/results-chart-model.js`; every chart colour from `migration/src/styles/results-tokens.css`.
9. **CSV cells never start a formula** (`csvCell`). Right and wrong are a mark and a word, never colour alone. Body text at least 16 px, targets 44 px,
   axe finds nothing (`npm run test:a11y`).
10. **User-visible words** use `APP_NAME` for the product name and match the existing screens; a change to them is a change of behaviour.
11. **Documents state only what the code does.** `scripts/check-docs.js` (in `npm test`) fails on a dead path, link, anchor, script or list title.

## How to make a common change

- **A list column:** one entry in `lib/schema/pms-schema.js` and its description in `pms-schema-meta.js` (same order), the code that uses it,
  `npm run build:lists-reference`, `npm run test:schema`, `npm run test:baseline`. A rename is a new `VERSION` and an entry in `RETIRED`; Setup
  brings an older site up. See [SHAREPOINT-LISTS.md](SHAREPOINT-LISTS.md#how-to-change-a-list).
- **A question type:** the types are spelled in `lib/schema/pms-schema-meta.js` (allowed words of `QuestionType`), the pager's rules
  (`lib/participant/pager-logic.js`, `src/pager/QuestionOptions.svelte`), Content's editor (`src/admin/ContentQuestions.svelte`), the tally
  (`lib/results/results-tally.js`), the chart model (`chartKind` in `lib/results/results-chart-model.js`) and a chart in `src/admin/charts/`, the
  report's counting (`lib/exports/leader-report.js`, its "how each kind of answer is stored" note) and the takeaways (`lib/results/export-summary.js`),
  the pack (`lib/exports/resultsExport.js`), the oracle (`scripts/oracle-results.js`), `scripts/validate-data.js`, and their fixtures and tests.
- **A participant screen:** a route in `migration/src/routes/`, registered in `App.svelte`; focus its heading with `focusHeading()`; add it to the
  styleguide (`src/dev/Styleguide.svelte`); keep the boot budget (`node --test scripts/test-participant-waits.js`); run `npm run test:a11y` and
  `npm run test:devices`.
- **An admin screen:** a component in `migration/src/admin/`, its rules as plain JS with tests in `lib/admin/`, its reads inside the screen's request
  budget (`scripts/test-admin-today.js` and the `*-sharepoint.spec.ts` specs count them), a timer only through `lib/common/page-watch.ts`.
- **An export:** build on the chart model and `lib/results/export-summary.js`; draw with primitives (no `doc.html()`, no html2canvas); load the
  library with `import()` in the admin page only; add read-back tests and mutations; look at the pages (`npm run look:exports`).
- **A module:** put it in the right folder of `migration/src/lib/` with a header comment, then `npm run docs:modules`.

## When something fails

- `npm test` red after a move or rename: a test that reads source by path (`scripts/test-*.js`), a request baseline, or a document
  (`npm run docs:check`). `node --test scripts/<file>.js` runs one suite.
- A page "cannot start": `PMS-CFG-*` is the settings file, `PMS-LST-*` the lists' version ([docs/SHAREPOINT.md](docs/SHAREPOINT.md)).
- A browser spec fails: check the known Windows faults and the two known flakes in [docs/TESTING.md](docs/TESTING.md) first; Firefox does not start here.
- A bundle budget fails: `npm run analyze:bundle` lists what each page carries, by folder.
- A count looks wrong: `npm run oracle -- --seeds 500` recounts with independent rules; `lib/results/results-tally.js` is the shared tally.
