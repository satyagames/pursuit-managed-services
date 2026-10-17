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
