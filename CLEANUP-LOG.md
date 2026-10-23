# Cleanup log

The record of what the Phase 14 cleanup removed, moved and kept, and why, so that nothing removed is added back by mistake and
nothing kept is removed without the reason being read first. Every verdict below rests on evidence: what references the file
(imports, `package.json` scripts, the Playwright and Vite configs, the tests, the documents, the release packager, `.gitignore`)
was searched, never guessed from a name. The search scripts were thrown away after use (no dependency was added).

**The rule of the cleanup:** a change in structure only. Each commit was proved by building the three pages with the baseline's
build name and comparing them, byte for byte, with the baseline package `pms-1ab63bd` (made from `1ab63bd`, the tip of `pms-13`),
and by the node gates. Where a change could not be proved neutral it was not made: see "Proposed, not done".

## Stage 1: what was done

### Deleted

| What | Bytes | Evidence | Commit |
|---|---:|---|---|
| `scripts/schema-baseline/codemod-list-keys.js` | 20,060 | The one-off codemod of Phase 10c-2b (it rewrote list titles into keys, once). No script, test, config or document names it. | `4c81aa4` |
| `public/css/.gitkeep` | 0 | Kept an empty folder that had three files in it. | `4c81aa4` |
| Seven exports nothing used, not even their own module: `sceneById` (`lib/brand/brand-sample.js`), `aspectOf` (`lib/brand/crop-math.js`), `usingKeyboard` (`lib/common/focus.ts`), `answerIsList` (`lib/participant/pager-logic.js`), `hasContext` (`lib/effects/sound-engine.ts`), `pdfSafe` (`lib/exports/resultsExport.js`: dead since Phase 13 embedded Open Sans in the pack), `loadAssetText` (`lib/brand/assets.js`: the last `fetch` outside the data layer and the settings reader) | 29 lines | A search of every tracked code file for each name, word-bounded; each had one occurrence, its own definition. The built pages are byte for byte the baseline's. | `4c81aa4` |

### Moved (`git mv`, so history follows: `git log --follow <file>`)

| From | To |
|---|---|
| `migration/src/lib/*` (91 files, flat) | `migration/src/lib/<folder>/`, eleven folders: `data`, `schema`, `settings`, `participant`, `common`, `admin`, `results`, `exports`, `brand`, `effects`, `setup` (docs/MODULES.md says what each holds) |
| `public/js/dataService.js` | `migration/src/lib/data/dataService.js` |
| `public/js/pms-schema.js`, `pms-schema-meta.js` | `migration/src/lib/schema/` |
| `public/js/resultsExport.js` | `migration/src/lib/exports/resultsExport.js` |
| `public/js/branding.js`, `assets.js` | `migration/src/lib/brand/` |
| `public/css/app.css`, `vfx.css`, `admin.css` | `migration/src/styles/legacy/` (the legacy app's sheets, kept as they were: override them, do not edit them) |

`public/` now holds only what the local server serves (the uploaded and sample pictures in `public/assets/images/clients/`) and the
brand files (see "Ask"). Every import, path string and path regex that named a moved file was rewritten (`d23f717`): a scripted pass,
then by hand the regexes with escaped paths (`lib\/x\.js`) and the lists of file names joined to a folder. How each kind was found:

- **A test that walked a folder without recursing** would have read fewer files after the move and passed quietly. There was one,
  `scripts/test-named-reads.js` (it listed `lib/` flat); it now recurses and reads every module, the data layer included.
- **A test that walks `migration/src`** now also sees the six modules that came from `public/js`. Each such check keeps the reach it had
  and names what it leaves out, with the reason: the data layer (it fetches and saves; it reads the old `CEC_` globals, see "Found"),
  and, for the product-name check, `branding.js`, `resultsExport.js` and `styles/legacy/app.css` (see "Found"). Every other moved file is
  now checked as well, which is more than before.
- **Six strings that ship in the pages** name a moved file: five developer errors (`layoutReport needs the Results palette
  (lib/results-palette.js).` and the like) and one CSS comment inside a Svelte `<style>` block (Svelte keeps those in the page). They keep
  their old path, so the pages do not change; see "Found, and left".

### Added

| What | Why |
|---|---|
| A header comment on `lib/participant/navigation.ts`, `lib/participant/session.svelte.ts`, `lib/setup/setupData.ts`, and new first lines on the six modules from `public/` (`branding.js` still named `app.js`, which left in Phase 10c-1) | Every module says what it owns, what it reads and writes, and what it must not do. |
| `scripts/test-module-headers.js` (in `npm test`) | Fails on a module under `migration/src/lib` with no header, or on a file at `lib/`'s top. It failed on the three modules above before their headers were written. |

### Kept, with the evidence

| What | Verdict | Why |
|---|---|---|
| `server/` (`index.js`, `api.js`, `store.js`, `data/`) and the `dev`/`start` scripts | keep | Not the legacy app: it is the local stand-in for SharePoint. `npm test` spins it up (`test-sessions.js` and every suite that compares both adapters), the browser tests start one per test (`admin-local.ts`, `migration-test-server.js`), and `npm run dev:svelte*` proxy `/api` and `/assets` to it. |
| `express`, `cors` | keep | `server/index.js`, `server/api.js`, `scripts/migration-test-server.js`. |
| `chart.js` (dev) | keep | No page uses it since Phase 11a; `scripts/test-bundle-budget.js` imports it into a deliberately leaky build to show the bundle check can fail. |
| `cheerio` (dev) | keep | `scripts/analyze-bundle.js` and the four `test:build:svelte*` tests (all four pass). |
| `esbuild` (dev) | keep | `scripts/migration-tests/effects-audio.spec.ts`. |
| `pdfjs-dist` (dev) | keep | `scripts/pdf-inspect.js` reads back every PDF the report and export tests make. |
| `lean-qr`, `canvas-confetti`, `jspdf`, `pptxgenjs`, `svelte-spa-router`, `svelte` | keep | Bundled into the pages. |
| `deployment.config.json` | keep | `scripts/deployment-config.js`, read by the Playwright configs and the test server: the folder the browser tests serve the pages from. No page reads it. |
| `scripts/schema-baseline/{translate,select,rename,fields,begin}-baselines.js`, `schema-before-10c2b.json`, `scripts/schema-snapshot.js` | keep | Each request baseline's header names the script that translated it: they are its provenance. `test-schema-baseline.js` reads the snapshot. |
| `scripts/export-sharepoint-seed.js` (`npm run export:sharepoint`) | keep | Makes the seed file Setup's "Moving content made on another copy" imports. |
| `scripts/go-live.js` | keep | A documented local shortcut (Today does the same). |
| `scripts/test-svelte-{build,admin-build,setup-build,release}.js` | keep | Run by `npm run test:build:svelte*`; all pass. |
| `lib/export-summary.js` (now `lib/results/`), `lib/results-chart-figure.js`, `lib/results-palette.js`, `EXPORT-DESIGN.md`, `npm run look:exports`, `scripts/print-contrast.js`, `scripts/mutate-leader-report.js` (64 mutations), `PHASE_13` | keep | Phase 13's; all in use. |
| `migration/src/routes/StagePlaceholder.svelte` | keep | The router's catch-all route (`'*'` in `App.svelte`). Its words are dated (see "Proposed, not done"). |
| 38 exports used only inside their own module (constants such as `COOL_DOWN_MS`, `SAVE_ATTEMPTS`, `TEMPLATE`, `isMost`, `readFace`...) | keep | Harmless (the bundler drops an unused export), and they name the rules the documents point at. Taking `export` off proves nothing and changes no byte. |
| The 55 `any` types | keep | JSDoc and Svelte types of untyped list records; replacing them is not a mechanical change. There is no `@ts-ignore` or `@ts-expect-error` anywhere. |

### Proposed, not done (each would change the shipped pages, or could not be proved neutral)

| What | Why not now |
|---|---|
| Delete the legacy stylesheets' rules that match no class the app writes (`styles/legacy/app.css`: 31 of 46 class names, the old Master screen's among them; `vfx.css`: 19 of 26; `legacy/admin.css`: 17 of 84) | Some class names are built at run time (`pill--${status}`), `scripts/test-foundation.js` reads the global names to catch collisions (`.divider`), and the participant page would change. Needs a screen-by-screen comparison in three engines. |
| Move the CSS comments out of Svelte `<style>` blocks (they ship in the pages) | Makes the pages smaller, but changes them; do it with a recorded size. |
| One `csvCell` (in `lib/admin/admin-content.js` and `lib/exports/leader-report.js`) | Not identical: the leader report's returns a number as it is; Content's would put an apostrophe before a negative number. |
| `StagePlaceholder.svelte` says "This screen is being migrated in the next stage" | Words a participant can see (an unknown address); changing them changes the page. |
| Rename `migration/` to `app/`, and the camelCase files (`dataService.js`, `adminData.ts`, `participantData.ts`, `setupData.ts`, `resultsExport.js`) to kebab-case | Pure churn across every document, config and test for a name; no byte or behaviour gain. |
| Split `lib/data/dataService.js` (2,800 lines) into `sharepoint/` parts (REST, batch, digest, paging, retry) | Its export list is pinned (104) and every recorded request baseline goes through it; a split is possible but large, and belongs in its own phase with the baselines as proof. |

### Found, and left (true of the code before this phase; nothing here changed them)

- `lib/data/dataService.js` still takes its first values from `globalThis.CEC_API_BASE` and `globalThis.CEC_SHAREPOINT`, the globals of the
  legacy `public/config.js`, which no page sets any more. Removing the two reads is behaviour-neutral in practice but changes every page.
- "Pursuits CEC" is still in `lib/brand/branding.js` (`DEFAULT_BRAND.name`, what `loadBrand` gives when there is no client name),
  in the PDF and PowerPoint files' producer field (`lib/exports/resultsExport.js`), and as the `content:` fallback of `.brand__name` in
  `styles/legacy/app.css`. The product name check never read them (they were in `public/`). Whether to change them is VJR's decision.
- Five developer error messages and one CSS comment that ship in the pages name the old flat paths (`lib/results-palette.js`,
  `lib/report-fonts.js`, `lib/scrim.js`, `migration/src/lib/export-stubs-unavailable.js`). Search by file name.

### Ask (for the owner)

| What | Size | Question |
|---|---:|---|
| `public/assets/BrandGuidelines/` (two PDFs), `public/assets/Logos/` (`.ai`, `.jpg`, `.png`, `.svg`), `public/assets/Font/open-sans/` (TTFs and Unity `.asset` and `.meta` files) | 48 MB, 34 MB, 5.7 MB | Tracked since the import commit `2a84d29`, although the rules of earlier phases said brand, Unity and `.claude/` files stay untracked, and nothing reads them except the font generators (`scripts/build-fonts.py` and `build-report-fonts.py` read `OpenSans-<Style>.ttf`). Untrack them (`git rm --cached`, and add them to `.gitignore`)? Not done: the brief forbids adding or deleting the guides or logos. History keeps them either way. |
| `.claude/settings.local.json` | 102 B | A local Claude Code permission, tracked since `2a84d29`. Untrack it? |
| `ux-review/` (git-ignored) | 629 MB | VJR's screenshots of the UX review. Left as it is. |
| `.local/` (git-ignored) | 110 MB | Node 22, VJR's pictures, earlier phases' notes. Left as it is. |
| `build/` and `public/vendor/` (git-ignored) | 29 MB, 1.4 MB | Leftovers of the legacy build; nothing reads them. Safe to delete on this machine. |
| `test-results/` (git-ignored) | 296 MB | Regenerated by every test run; may be deleted at any time. |

## Stage 2: the documents

| What | Where it is now | Why |
|---|---|---|
| `RELEASE-10F.md` to `RELEASE-13.md`, `MIGRATION-PLAN.md`, `UX-REVIEW.md`, `EXPORT-DESIGN.md` | `docs/history/`, unchanged | The record of the phases. `docs/HISTORY.md` says what each left behind. |
| `ARCHITECTURE.md` (the legacy app), `PROVISIONING.md` and `SHAREPOINT-DEPLOYMENT.md` (the old site) | `docs/history/`, unchanged | Their current facts are in `docs/DATA-FLOW.md` and `docs/SHAREPOINT.md`; the old site's are kept as the record. `scripts/test-schema-baseline.js` reads `docs/history/PROVISIONING.md`. |
| `Prompt_Lib/` (6 files) | `docs/history/Prompt_Lib/`, unchanged | A prompt library of 24 Sept 2026 for rebuilding the legacy app with another model. Nothing reads `PROJECT-CONFIG.json`; it describes the vanilla stack, so it is history, not a guide. |
| `AGENTS.md` (1,492 lines) | `docs/RULES.md`, with a new opening, its Commands section moved to `docs/TESTING.md`, three passages corrected and the rules of Phase 14 added; `AGENTS.md` is now a pointer to `CLAUDE.md` | One short entry for agents (`CLAUDE.md`), the detail where it is looked up. |
| `LOCAL-SITE.md` | `docs/LOCAL-SITE.md` | With the other documents. |
| `README.md` (980 lines, the legacy app) | rewritten, 281 lines | It described the old site and the legacy app. The old text is in git history. |
| `QA-TESTING.md`, `SHAREPOINT-LISTS.md` | stay at the root | Tests read QA items there; the pages name `SHAREPOINT-LISTS.md` in their messages. |

New: `CLAUDE.md`, `llms.txt`, `docs/SHAREPOINT.md`, `docs/DATA-FLOW.md`, `docs/MODULES.md` (generated), `docs/DECISIONS.md`, `docs/TESTING.md`,
`docs/HISTORY.md`, `docs/project-map.json` (generated), and the checks `scripts/check-docs.js`, `scripts/test-check-docs.js`,
`scripts/build-modules-map.js` with `scripts/test-modules-map.js`, `scripts/build-project-map.js` with `scripts/test-project-map.js`, and the lists at a
glance in `docs/SHAREPOINT.md` from `scripts/build-lists-reference.js`. Each test failed before what it checks was written.

## Phase 17: dead CSS, by measurement

**What was removed:** 72 selectors of the three stylesheets that nothing in the app can match: 7 of `migration/src/admin.css`, 20 of
`migration/src/styles/legacy/admin.css` and 45 of `migration/src/styles/legacy/app.css` (the list, with each selector's line and the class it
names that is nowhere, is `build-svelte/evidence-17/css-removed.json` on the machine that made it; the commit `81159d7` is the diff). They are the
legacy app's results screen (`master-*`, `results__*`), its agenda (`section-list`, `section-item__*`), question form, option lists, thank-you screen
and brand header (`brand__logo`, `brand__name`, whose `content:` fallback was the last "Pursuits CEC" in a stylesheet, see Stage 1's "Found, and left"),
the legacy admin's tally rows (`tally__*` but `.tally` and `.tally summary`), QR code list (`qr__codes`), logo editor (`logo-edit`, `logo--preview`),
dialog form, preview's empty state and user-setup controls, and their copies in `src/admin.css` (`adm-dialog__list` among them). A rule that also
had a live selector keeps it; four comments that described only removed rules went with them.

**The evidence (a selector was removed only when every check said no one could match it):**

- Not a token of any `.svelte`, `.ts`, `.js` or HTML shell under `migration/` (194 files, comments and `<style>` blocks left out), and not a class a
  piece could build (`check--{level}`, `btn--${kind}`, `'tile--' + kind`: 27 such prefixes, every class starting with one counted as used).
- Not in the DOM of any of the 955 screens and states that the local site's harness photographs (`npm run ux:shoot -- --matrix brief`, the seven
  sizes of `devices.spec.ts`): participant, guest, states, keyboard, tiles, admin, admin states, Live display, Setup, brand and Brand Studio, with
  `document.querySelectorAll('*')`'s classes and ids recorded at each picture (a throwaway change to the harness, reverted). 536 distinct names.
- Not named by a document as a contract, nor by a test: `.divider` (three selectors) is named in `docs/RULES.md` as a global class, and stays.
- No candidate was inside `@media print` or a `prefers-*` block; no custom property was touched.

**The proof that it was neutral:** the three pages' screenshots on the whole matrix, before (`pms-362b095`) and after (`pms-81159d7`), compared
picture by picture (RELEASE-17.md); `npm test` 1,475 of 1,475; the participant page 701 B gzip smaller, the admin page 186 B, Setup 315 B.

**`styles/legacy/` keeps its name.** What is left in it is still the legacy app's two sheets, overridden by `src/app.css` and `src/admin.css` rather
than edited, and several of their rules are live on every page (`:root`'s first tokens, `.btn`, `.field`, `.row`, `.pill`, `.option`, `.divider`).
Renaming the folder would change three entries' imports and the documents for no gain while that is so.

## Phase 18: what the move left unused

Brand Studio moved from a Clients row into the Content tab (docs/DECISIONS.md, "The Content tab"). Only what the move made unused was removed:

| What | Where | Evidence | Commit |
|---|---|---|---|
| The Brand Studio mount: `brandClient`, its `{#key}` block, the `BrandStudio` import, and the `onSaved` bookkeeping that put a saved look back into the list | `migration/src/admin/AdminClients.svelte` | The row's Brand button now opens Content's Brand view (`onNavigate`); `brandClient` had no other reader. The bookkeeping lives in `AdminContent.svelte`, which keeps the clients Brand saves into. | `70bd893` |
| The "← Clients" button, when Brand Studio is a view of Content | `migration/src/admin/BrandStudio.svelte` (`embedded`) | The strip and the top tabs are the ways out. Without `embedded` the button is there as before (`scripts/test-brand-studio-embedded.js`). | `71bcd4e` |

Kept: `BrandStudio`'s `onClose` prop and its Back button for the screen on its own (Setup does not mount it today; a test may), and the leave
dialog's title "Leave Brand Studio?" (the tool keeps its name inside the Brand view).
