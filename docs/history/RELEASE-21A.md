# Prompt 21, Phase 1: roles and access, the engine

Branch `pms-21-1`, made from `21cef34` (the tip of `pms-20`, which is not merged). Not pushed. Design source: the wireframe boards approved on
27 Oct 2026 (board 2, sign-in and access resolution; board 10, the roles and access matrix). Phase 1 of seven: the lists, the matrix, the one
check, the sign-in, the No access screen, the site owner's banner and Setup's copy of the old admins list. Phase 2 (Manage Users) is next and was
not started.

**The rule above all held**: with only legacy admins (nobody listed in `PMSUsers`), an admin who is not a site owner sees the PIN screen as before,
and the PIN opens every tab as before, Delete session included. What changed for them: "Checking your access..." for the two requests that find
nobody, then the PIN screen; and the site must first be brought to version 5 by Setup.

## What was built

- **Schema version 5** (`lib/schema/pms-schema.js`, `pms-schema-meta.js`; `SHAREPOINT-LISTS.md` regenerated): `PMSUsers` (AppId the email in lower
  case, FullName, Email, LoginName, JobTitle, Status `Active`/`Disabled`, Source `Directory`/`Typed`, AddedBy), `PMSRoleAssignments` (AppId
  `user|role|scope|place`, UserKey, Role, ScopeType `global`/`client`/`session`/`period`, ClientId, SessionId, PeriodFrom, PeriodTo, ValidUntil,
  Extras, GrantedBy), `PMSAuditLog` (AppId `audit-<UUID>`, Actor, Action, TargetUser, Role, ClientId, SessionId, Detail, OccurredAt), and
  `PMSAppSettings.FiscalYearStartMonth` and `MinSample`. Setup's plan creates them (Create: 16 lists, 121 columns, 57 settings on an empty site);
  its check and self-test read them like every list.
- **`lib/access/`**: `access-matrix.js` (board 10 cell by cell, the places each role may have, the extras, `LIST_WRITES`: the actions that allow
  each write), `can.js` (`can`, `canView`, `grantsOf`, `legacyAccess`), `access-denied.js`, `guard.js` (the write guard), `resolve.js`
  (`resolveAccess`, `signInStep`), `grants.js` (`grantRole`, `grantProblem`, `revokeProblem`, `superAdmins`), `audit.js` (`writeAudit`),
  `migrate-admins.js` (`migrateAdmins`, `makeMeSuperAdmin`), `access-words.js`.
- **The data layer**: `core.js` holds the page's write guard (`setAccessGuard`) and asks it before every write in `spHttp` and the local `send()`;
  `access-reads.js` (section 12: `readSignedInPerson`, `readAccessRows`, `listAccessRecords`, `addAccessRecord`); the surface is 117 names
  (`scripts/data-surface.json`, docs/DECISIONS.md). `records.js` reads the settings item's version alone when a site of an older version refuses
  the full read, so such a site stops with PMS-LST-011 (found by this phase's tests: without it the pages met SharePoint's raw 400).
- **The admin page**: the sign-in step before the PIN screen; No access (`admin/NoAccess.svelte`: who you are signed in as, whom to ask, Copy my
  details); the owner's banner; Lock only after a PIN.
- **Setup**: People and access under 3. Admins (`setup/AccessPanel.svelte`): the Super admins now, Make me a Super admin (site owner), and the copy
  of the PIN admins.
- **The local server** has the three lists, seeded with the brief's sample people (`server/data/users.json`, `roleassignments.json`,
  `auditlog.json`); the local server has no signed-in person, so the admin page there keeps its PIN.

## Where the brief did not match the tree (said, as the brief asks)

1. **`PMSAdminUsers` holds no email**: a name and a PIN hash. The copy cannot map an old admin to a person by itself, so Setup asks for each one's
   email; an admin left without one is skipped and keeps the PIN.
2. **Board 10's Admin may not run a session, edit content or see results**, yet "an existing admin keeps working (the migration maps them to
   Admin)". The PIN path therefore gives a *legacy admin* (everything the Phase 20 admin page did), and the copy gives Admin, Producer and
   Designer on all clients. **ASSUMED**, open item 7 below. Delete session becomes a Super admin's for a copied admin (decision E).
3. **Indexes**: the brief marks Email, the access lists' ClientId and SessionId, Actor and TargetUser as indexed. The repository's rule (exactly the
   columns a recorded request filters on, `scripts/test-schema.js`) allows only what Phase 1 filters on: every AppId and
   `PMSRoleAssignments.UserKey`. Each other index comes with the phase that first filters on it; Setup adds an index like any column.
4. **`PMSAuditLog` has `OccurredAt`** (not in the brief's columns): the time of the line, by the device's clock (SharePoint's Created says the same by
   the site's).
5. **`Extras` is plain text** (comma-separated words), not a column of chosen words: a single word check cannot hold two.
6. **"Site owner"** is read as a site collection administrator (`IsSiteAdmin`) or a member of the site's owners group
   (`/_api/web/AssociatedOwnerGroup`): **ASSUMED** (QA item 221).
7. **The order of sign-in**: the brief puts the site owner first, board 2 a listed person first; both hold, since the owner is always a Super admin
   (decision I) and their own rows add to that.
8. **No access** shows no list of Super admins (board 2 does): a person without access may not be able to read `PMSUsers` once Phase 7 locks it.
   "Request access" is hidden: `PMSAccessRequests` is not in this release. Until `PMSAdminUsers` is retired, a person with no row gets the PIN screen,
   as before, rather than No access.

## Open items for the manager

The brief's six (decision B's default, the fiscal-year start month, the index as a ratio, Industry and Region, two sessions live at once, the
confidence shift's divisor) are untouched by this phase; `FiscalYearStartMonth` reads as 6 and `MinSample` as 10 when empty (ASSUMED). New:

7. The roles a copied PIN admin gets (Admin, Producer and Designer on all clients), and whether Delete session should stay with them.
8. What "site owner" means on PCOE (item 6 above).

## Requests

The admin page on SharePoint sends, before its first screen, one `$batch` (who is signed in, the owners group) and, for a person with an email, one
`$batch` carrying the two indexed reads; then what it sent before. Every item read names its columns. The request baselines followed version 5 by
`scripts/schema-baseline/access-baselines.js`: every one of the 17 recorded suites run on `21cef34`'s tree and on today's, request by request
(the two Setup suites, whose lanes interleave, by count), the settings item's `$select` (two columns more) and the every-list column check (three
lists more, in the same batch) translated, only requests of version 5 added (the three lists, the two settings' columns, the version read on an
older site, a list made by Setup), and then a fresh recording equal to the translation in all 17. No baseline was recorded again. The browsers'
three start-up baselines were translated by the same `$select` rule; `request-baseline.spec.ts` proves them in the final round.

## Gates, before and after

Before: `21cef34`, in this checkout, before anything changed; after: this branch. Windows, Node 22.23.3 (`.local/node22`). By the owner's standing
instruction (develop now, the heavy gates at the final build), the browser runs were not made in this phase.

| Gate | Before | After |
|---|---|---|
| `npm run check:svelte` | 0 errors, 0 warnings (415 files) | 0 errors, 0 warnings (427 files) |
| `npm test` | 1,610 of 1,610 | 1,651 of 1,653: the two that failed are `scripts/test-store.js`'s timing tests (fifty writes, and a read meeting a write), with EPERM from Windows on a rename, in both full runs; alone they pass 3 of 3, twice (below) |
| `npm run test:baseline` (in `npm test`) | 38 of 38 | translated and proved (above); in `npm test` |
| `npm run test:bundle` | 45 of 45 (Phase 20's record) | 46 of 46 |
| `npm run test:report` | 150 of 150 (Phase 20's record) | 150 of 150 |
| `npm run test:report:mutations` | 64 of 64 caught (Phase 20's record) | 64 of 64 caught |
| `npm run test:charts` | 57 of 57 (Phase 20's record) | 57 of 57 |
| `npm run test:local-site` | 26 of 26 (Phase 20's record) | 26 of 26 |
| `npm run oracle -- --seeds 500` | 0 differences (Phase 20's record) | 0 differences (the same 5,620 participants and 9,865 guests of a check) |
| `test:migration`, `test:a11y` (browsers) | Phase 20's record | not run: the final round (below) |

The "before" of the slower gates is Phase 20's record at `21cef34` (RELEASE-20.md), the same tree; `check:svelte` and `npm test` were run again here.

**The two store tests.** `scripts/test-store.js` writes a temporary `tracks.json` in a folder of its own and touches nothing of this phase. In both full
runs here four of its fifty writes met EPERM (Windows refusing a rename over a file something holds) after the store's retries; run alone, the suite
passed 3 of 3 twice. Writes to the repository's own files met the same refusal now and then during this phase (a file a test had just read), which
points at something on this machine holding files for a moment (a scanner, ASSUMED), not at the store. The final round should run it again.

## Page sizes (gzip -9)

| Page | Before (`21cef34`) | After | Change |
|---|---:|---:|---|
| `index.html` (participant) | 164,582 B | 165,480 B | +898 B: the schema's three lists, the write hook, `access-reads.js`, the version read (allowance 1,500 B; ceiling 450,000 B, not raised; its Tailwind rules unchanged; none of `lib/access`) |
| `admin.html` | 592,267 B | 596,907 B | +4,640 B: `lib/access`, No access, the banner, the sign-in step (budget 700,000 B) |

`PHASE_21A` in `scripts/bundle-budget.js` records them.

## Proven on the mock and in node, and only reasoned about

Proven (`scripts/test-access.js`, 40 tests, and the suites above): the matrix; `can()` for every role, scope, extra, ValidUntil, a disabled person,
the site owner and the legacy admin; the guard on SharePoint's and the local server's requests and inside the data layer (nothing refused is sent);
two round trips however many people (300 extra in the test); a site that will not batch; the sign-in step; grants, a duplicate grant, the last Super
admin, your own roles; the audit list; the copy (idempotent, counts, refused to anyone else, no PIN hash); Make me a Super admin; a site of version 4
stopping with PMS-LST-011; the words.

Only reasoned about: the screens themselves in a browser (No access, the banner, Checking your access..., Setup's panel: `check:svelte` only; no
browser spec was written or run in this phase), what the real site answers for `/web/currentuser?$expand=Groups` and
`/web/AssociatedOwnerGroup`, and whether an account that is not an owner may read `PMSUsers` and `PMSRoleAssignments` (if it may not, it gets the
PIN screen, which is the old behaviour). QA-TESTING.md items 216 to 221.

## The final round must run

`npm run test:migration` in Chromium and WebKit (expect specs that count the admin page's start-up requests, the PIN screen's first paint, Setup's
column and list counts and the version to move with this phase, as Phase 20's did); `npm run test:a11y` with No access and Setup's People and access
added; `request-baseline.spec.ts` against the translated browser baselines; `focus.spec.ts` and `keyboard.spec.ts` for No access's heading
(`scripts/test-foundation.js` counts it).

## The package

Made by `npm run package:release` from this branch's last commit, in a fresh checkout of it; its name is `pms-` and that commit, and its
checksums were verified against `SHA256SUMS.txt` (the session's report names it).
