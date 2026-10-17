# Phase 14: the code in folders, the documents rewritten and checked, and the final build

Branch `pms-14` (from `1ab63bd`, the tip of `pms-13`), 17 Oct 2026, by Claude for Satyadev. **A change in structure only**: nothing a person sees,
nothing counted or stored, and no list, column, request, address or word on a screen changed. What was removed, moved and kept, with the evidence
for each, is [CLEANUP-LOG.md](CLEANUP-LOG.md); the rules this phase adds are in
[docs/RULES.md](docs/RULES.md#rules-from-phase-14-structure-and-documents-keep-them-holding). Nothing was pushed.

## 0. Where it started

- The untouched branch was measured first, on this machine (Windows, Node 22 from `.local/node22`, `core.autocrlf input`), into the git-ignored
  folder `build-svelte/baseline-14/`: every gate, the package `pms-1ab63bd` with its hashes, the export names of every module
  (`build-svelte/baseline-14/exports.txt`, 719 names) and the list of `npm run` scripts.
- The work was done in a git worktree (`../pms-14-wt`, branch `pms-14-wt`) while the baseline's browser run used the main checkout, then `pms-14` was
  fast-forwarded to it. A power cut paused the work once; nothing was lost.
- The first baseline browser run overlapped other tests and was discarded (539 passed, 238 did not run); it was run again alone, and matched Phase 13's
  report exactly.
- **Firefox does not start on this machine** (`spawn UNKNOWN`), before and after: Firefox was not exercised. `npm run test:rehearsal` was not run (as in
  Phases 11a-3 to 13).

## 1. Stage 1: cleanup and structure

| What | Commit | Proof |
|---|---|---|
| Seven exports nothing used, not even their own module (`sceneById`, `aspectOf`, `usingKeyboard`, `answerIsList`, `hasContext`, `pdfSafe`, and `loadAssetText`, the last `fetch` outside the data layer), the finished 10c-2b codemod (20,060 B) and an empty `.gitkeep` removed | `4c81aa4` | the three pages byte for byte the baseline's |
| `migration/src/lib` (91 flat files) into eleven folders by module; `public/js` (six modules) and `public/css` (three sheets) moved into it and `styles/legacy/`, with `git mv` (100 renames) | `d23f717` | byte for byte; `npm test` 1,328 of 1,328 |
| A header on every module (three had none, six described a move of 10c-1); `scripts/test-module-headers.js` | `f01ba07`, `6618416` | the test failed on the three first |
| The schema snapshot of 10c-2b put back as the record it is (the move had rewritten its keys) | `288fff4` | `test-schema*.js` green |
| `PHASE_14`: both pages pinned byte for byte, allowance 0 | `a2b21ab` | the test failed first (no `PHASE_14`) |

**How the move was proved.** After each step the three pages were built with the baseline's build name (`PMS_BUILD_ID=pms-1ab63bd`) and compared
with the baseline package byte for byte, and they were equal. The first build after the move was not: a CSS comment inside a Svelte `<style>`
block (Svelte keeps those in the page) and five developer error messages name the old paths, and the codemod had updated them. They keep their old
words, so the pages stay equal, and CLEANUP-LOG.md lists them.

**What the move could have weakened, and was checked.** One test listed `lib/` without recursing (`test-named-reads.js`): it would have read fewer
files after the move and passed. It now recurses and reads every module, the data layer included. Every check that walks `migration/src` now also sees
the six modules from `public/js`; each keeps the reach it had and names what it leaves out, with the reason. That turned up three things, all left as they
are (CLEANUP-LOG.md, "Found, and left"):

- the data layer still reads the legacy `CEC_API_BASE` and `CEC_SHAREPOINT` globals, which nothing sets;
- "Pursuits CEC" survives in `DEFAULT_BRAND`, in the PDF and PowerPoint producer field and in a `content:` fallback of the legacy sheet. Changing them
  is VJR's decision;
- the codemod also rewrote a historical record, the schema snapshot's keys. That was caught and put back.

**Dependencies:** none removed. Every one is used: `express` and `cors` run the local stand-in that `npm test` and the browser tests use; Chart.js is
the bundle test's deliberately leaky build; `cheerio`, `esbuild` and `pdfjs-dist` are test tools. **Deleted in all:** 3 files (20,060 B) and 29 lines
of dead code.

**Proposed, not done** (each would change a shipped page, or could not be proved neutral): the legacy sheets' unused rules; the CSS comments that
ship in the pages; one `csvCell` (the two copies differ on negative numbers); the placeholder screen's words; renaming `migration/` or the camelCase
files; splitting the data layer. The table in CLEANUP-LOG.md says why for each.

**Ask (for the owner):** untrack the brand guides, logos and Unity font files (88 MB, tracked since the import commit `2a84d29`) and
`.claude/settings.local.json`; delete the local leftovers `build/` and `public/vendor/`. Nothing was deleted from `ux-review/` (629 MB) or `.local/`.

## 2. Stage 2: the documents

| Document | What it is | How its facts are checked |
|---|---|---|
| [README.md](README.md) (281 lines, was 980) | For a person who has never seen the project: the parts listed in section 4 | `scripts/check-docs.js`; the versions are `package.json`'s |
| [CLAUDE.md](CLAUDE.md) (98 lines), `AGENTS.md` (a pointer), [llms.txt](llms.txt) | For coding agents: commands, folder map, rules, how to make a common change, where to look when it fails | `scripts/check-docs.js` (the docs check) |
| [docs/SHAREPOINT.md](docs/SHAREPOINT.md) | The lists at a glance (generated), the rules every list keeps, permissions, `pms-config.txt`, Setup, what SharePoint does as PCOE showed it, deploying and rolling back | the docs check; the table by `scripts/build-lists-reference.js` (`npm run docs:lists`); each SharePoint behaviour against the data layer's code |
| [docs/DATA-FLOW.md](docs/DATA-FLOW.md) | From a tap to a list item to a chart to a file, in Mermaid; polling, caching, saving, failure modes | the docs check; the numbers are the ones the tests pin |
| [docs/MODULES.md](docs/MODULES.md) | Every folder and module, its exports, what it imports and what imports it, the node suites that guard it | generated from the import graph (`npm run docs:modules`); `scripts/test-modules-map.js` fails when stale |
| [docs/DECISIONS.md](docs/DECISIONS.md) | What still binds, one line each, with what enforces it | the docs check |
| [docs/TESTING.md](docs/TESTING.md) | What each gate proves and takes; every command (AGENTS.md's Commands, corrected) | the docs check |
| [docs/HISTORY.md](docs/HISTORY.md), [docs/history/](docs/history/) | One line per phase from 10f; the reports, the migration plan, the old site's documents and the prompt library, unchanged | the docs check (history itself is not read) |
| [docs/RULES.md](docs/RULES.md) | AGENTS.md's rules, with a new opening and the rules of Phase 14 | the docs check |
| [docs/project-map.json](docs/project-map.json) | The project for a machine: stack (from `package.json`), pages, lists, question types with their charts, commands, gates, folders | generated (`npm run docs:project-map`); `scripts/test-project-map.js` |
| [QA-TESTING.md](QA-TESTING.md) | Opens with what is open (171 to 176 first); items 177 to 181 for this release | `scripts/test-release-docs.js` |

**The guard against drift** is `scripts/check-docs.js`, in `npm test` and `npm run docs:check`: every path, link, anchor, `npm run` script and list
title in every document must exist. What a document names on purpose although it is gone is in its `GONE` list, each with why. It caught a dead path in
this report's own first draft. Its test shows it catching each kind of problem.

**The release documents** name `pms-14`; RELEASE-NOTES.md has "What changed since pms-757be5c" (nothing a person sees, the sizes) and RUNBOOK.md's
PCOE note says the package changes nothing a person sees and ends with step 10, a smoke test of ten checks (Note 10: QA items 177 to 181).

## 3. The gates, before and after (Node 22, this machine)

| Gate | Before (`1ab63bd`) | After (`pms-14`) |
|---|---|---|
| `check:svelte` | 0 errors, 0 warnings, 364 files | 0 errors, 0 warnings, 364 files |
| `npm test` | 1,328 of 1,328 | **1,342 of 1,342** (the new suites: headers, the docs check, the module map, the project map, the SharePoint guide's table, `PHASE_14`) |
| `test:baseline` (in `npm test`) | 37 of 37 | 37 of 37; **no request baseline changed** (`git diff 1ab63bd -- scripts/request-baseline` is empty) |
| `test:bundle` | 38 of 38 | 39 of 39: participant and admin **byte for byte** (`PHASE_14`) |
| `test:report` | 150 of 150 | 150 of 150 |
| `test:report:mutations` | 64 of 64 | 64 of 64 |
| `oracle -- --seeds 500` | 0 differences | 0 differences |
| `test:charts` | 57 of 57 | 57 of 57 |
| `test:local-site` | 26 of 26 | 26 of 26 (on the new package; Setup's self-test 11 of 11) |
| `test:migration`, Chromium and WebKit | 787 passed, 13 skipped, 21 failed (39.4 min) | **787 passed, 13 skipped, 21 failed** (39.4 min) |
| Firefox | does not start (`spawn UNKNOWN`) | does not start |

The 21 failures before are the ones Phase 13 reported: 20 in WebKit on Windows (17 in `effects-audio.spec.ts`, `brand-smoke.spec.ts`,
`flow.spec.ts` (a tile whose picture fails), one `keyboard.spec.ts` test) and `admin-today.spec.ts` "slugs" in Chromium (the known flake). After, the same
20 in WebKit, and in Chromium "slugs" passed while `brand-studio.spec.ts` "an answer tile's picture can be uploaded in Content" failed. That test reads
an answer back the moment the screen says "Saved". Run alone on both trees, nine times each, it **failed 7 of 9 on the untouched `1ab63bd`** (in a separate
worktree, its own build) and 6 of 9 on `pms-14`: a flake of the same kind as "slugs", not a regression. Both are now listed in
[docs/TESTING.md](docs/TESTING.md).

## 4. The README's outline

What it is and who uses it (with a text diagram); features by role; the six question types, how each is counted and charted; the technology (versions
from `package.json`); how it fits together (a Mermaid diagram and the module table); SharePoint at a glance (lists, permissions); quick start; repository
layout; quality gates and what is proven on the real site; a wish list of proposals (grouped, each sized S, M or L, ◆ where it needs the owner); the ten
most common problems; security and privacy; licence and notices; contributing. No "phase", "candidate" or "migration" in its words.

## 5. The package

PACKAGE

## 6. What only the real site can show

QA-TESTING.md items 177 to 181, in a test folder first: the new pages there, Setup's build name and self-test, a guest's visit answering each type of
question, the facilitator's screens and every file, then production and the push. The earlier open items (171 to 176 first) are as they were.

## 7. Push, after the SharePoint test

```bash
git push -u origin pms-14
```

Suggested pull request (into `main`, when the owner chooses): **"Phase 14: code in folders by module, documents rewritten and checked, final build"**.
The description is in section 1 to 3 above, ending with the attribution line.
