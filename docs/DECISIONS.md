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
| Schema version 3; a page stops on another version; Setup raises an older one and never lowers. | A build must never write lists shaped for another build. | `scripts/test-schema-version.js`, `scripts/test-schema-upgrade.js` |
| No column named like a SharePoint list-item property (`DisplayName`...). | PCOE refused to return `DisplayName` by name (15 Oct 2026). | `scripts/test-schema.js` |
| Every item read names its columns (`$select`). | PCOE left `ClientId` out of a read that named none (14 Oct 2026). | `scripts/test-named-reads.js`, the strict mock |
| A duplicate is 409 whether SharePoint says 400, 409 or 500. | PCOE says 500. | `scripts/test-duplicates.js` |
| Setup only adds: it never deletes, renames or retypes a column. | A site owner's data and hand-made columns are safe. | `scripts/test-provision.js` |
| The request baselines are never re-recorded to make a test pass; they change only by `--amend` or a proved translation. | A changed request is a finding. | `scripts/test-request-baseline.js` |
| `PMSAdminUsers` is unreadable to participant accounts. | It holds unsalted PIN hashes; the PIN is not authorization. | By hand (RUNBOOK.md step 11); the local site models it |
| The PIN check stays a mock: SHA-256, no lockout (decision 10 of the architecture). | Real sign-in would be SharePoint groups or Entra; out of scope until decided. | `lib/admin/admin-pin.js` (unchanged since Phase 10c-1) |

## The participant page

| Decision | Why | Enforced by |
|---|---|---|
| The participant page may not grow beyond where the newest phase left it (each phase records its sizes); the target is 400 KB gzip, the ceiling 450 KB. | iPads on venue Wi-Fi; it is the page that matters. | `scripts/bundle-budget.js` (`PHASE_*`), `npm run test:bundle` |
| It carries no export library, chart, report or Setup module. | Size, and the admin's code is not the participant's. | `FORBIDDEN` in `scripts/bundle-budget.js` |
| Nothing is cached between page loads; browser storage holds only unsaved answers, visit-log keys and the sound choice. | A shared iPad must not show yesterday's data. | `scripts/test-participant-storage.js` |
| It never waits on a read for something it already holds; each moment's rounds are pinned. | PCOE was slow (15 Oct 2026). | `scripts/test-participant-waits.js` |
| Saving goes through `participantData.ts` only; a first answer is never rewritten; Next never waits. | Scores use the first try; a slow save must not stop a person. | `scripts/test-participant-storage.js` |
| Sound is off until the person turns it on; effects only through `effects.ts`; no confetti on a wrong answer. | A room of iPads; one door for Web Audio. | `scripts/test-effects.js` |
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

## The codebase

| Decision | Why | Enforced by |
|---|---|---|
| One app: the legacy vanilla app is not brought back. | Phase 10c-1's clean break. | `scripts/test-foundation.js` (the legacy files stay gone) |
| Modules live in folders by module under `migration/src/lib`, each with a header. | An unfamiliar developer or model finds the right file in minutes. | `scripts/test-module-headers.js`, `scripts/test-modules-map.js` |
| The documents name only what is there. | Documents that drift mislead. | `scripts/check-docs.js` (`npm test`) |
| A failing test first, never loosened; no new dependency without asking; never commit to `main`; the owner pushes. | Every change is proved; the owner controls what ships. | By hand |
