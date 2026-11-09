# Prompt 39: the admin page on the whole width

Branch `pms-39`, from `pms-38` (cb08557). Nothing pushed; nothing on `main`. Admin page only: the participant page is byte for byte the size it
was (193,978 B gzip) with the same Tailwind rules. The rules this leaves are in
[RULES.md, "Rules from Prompt 39"](../RULES.md#rules-from-prompt-39-the-admin-page-on-the-whole-width-the-bar-the-popover-results-charts-keep-them-holding).

## Where the side bands came from

Prompt 32 (e994b8d) had taken every cap off: the page ran edge to edge with `clamp(1rem, 2vw, 2rem)` at the sides. Prompt 38 (d5f03d1) brought
one back in `admin-look.css`: `.shell__body` at most `--adm-content-max` (1,280 px) plus 32 px each side, centred, so a 1,920 px window had
about 290 px of empty band on each side. Prompt 39 keeps Prompt 38's look and Prompt 32's width.

## What changed

- **The bar** (`AdminApp.svelte`, `admin-look.css`): one 56 px bar at every width, its edges the page's. "PMS Admin" beside the wordmark
  (`APP_SHORT_NAME`; a screen reader hears "Pursuit Managed Services Admin"; the page's title is unchanged); the copy-label pill is gone (the
  label is the brand's tooltip). The six tabs sit in the middle with 18 px icons, never a scrollbar, never cut, from 1,024 px; below it, a Menu
  button and its list. Prompt 32's two-row bar below 1,100 px and its subgrid are gone from `admin.css`.
- **The chip and Your access** (`IdentityChip.svelte`, `lib/access/identity-words.js`): the role alone below 1,280 px, the role and its reach
  from 1,280 px; no description line. The popover is 360 px with 20 px inside and no longer says "Signed in with your Deloitte account" or
  "Not available to you" (`notAvailable` is gone from `identityOf`).
- **The container and the grid**: `--adm-page-max` 1,920 px, `--adm-page-pad` `clamp(16px, 2vw, 32px)`, `--adm-bar-h` 56 px; `.adm-grid` and
  spans. The sticky bottom bar takes the same edges.
- **Today** 8 + 4 on the 12 columns; the side column sticks only while it fits (`lib/admin/sticky-fit.js`).
- **Clients**: the title row above both columns; with a client open, 4 (at least 340 px) + 8; the full list's actions on one line from 1,280 px.
- **Content**: the client's row, then Activities and Brand as two equal halves (no sideways scroll); activities 5 + questions 7; Brand's
  preview 7 + controls 5. Only the strip sticks now (Prompt 32 kept the client picker sticky beside it).
- **Guests and QR**: three equal steps; the guest list a table (guest, group, status, code, actions).
- **Results**: the view switch, Hide names, Refresh and the time in the title row; sessions 3 + session 9; two-line session rows; the pager on
  one line; the charts in `repeat(auto-fill, minmax(340px, 1fr))`, one height a row; each card's numbers button on its own row; bars with a
  72 px value column; Art of the Possible across the row (rows in the guests' order, criteria named across, a 320 px sticky first column, teal
  tiles `--viz-heat-1..4`, its controls in one row); Downloads in three columns from 1,280 px; the dashboard's six figures in one row and quiet
  "Not measured".
- **People**: the title row above both columns with Check site access in it; one filter row from 1,280 px; 4 + 8 with a person open.

## Decisions taken here, for the owner to confirm

- **The admin budget**: the brief asks for under 700,000 B; the page stood at 714,653 B before the work (Prompt 38's own record). It is now
  717,609 B, inside the 720,000 B budget (`PHASE_39`).
- **The copy's label** is the brand's tooltip and `data-label`, not a pill, so two folders can still be told apart.
- **Buttons stay 44 px** (the brief's 36) and "Not measured" 16 px (the brief's 14): CLAUDE.md rule 9.
- **No two-line clamp on a bar's label, no three-line clamp on a criterion's name**: at 200% text a clamp cut words (`reflow.spec.ts`).
- **The AoP sub-process column is 320 px fixed**: a fixed table takes no `clamp()` of a percentage. The data has no groups of sub-processes,
  so rows cannot fold by group. Below about 1,600 px wide the grid scrolls inside its card (its columns need about 1,300 px).
- **Prompt 32 and 11a-2 pins replaced by this brief**: End session is no longer forced into view at 1366 x 650 (the column scrolls with the
  page when it does not fit); a chart card beside one with its names open grows with its row on Results (the Live display keeps its own height);
  the Content client picker scrolls away.

## Tests

- New: `scripts/migration-tests/admin-full-width.spec.ts` (1024 to 1920 px, every screen, and Menu below 1,024 px; pictures of 1440 and 1920 in
  `test-results/admin/full-width/`, looked at, not pixel-compared: the dates on the pages change every day). Node: `test-identity-words.js`,
  `test-admin-look.js` (tokens, spacing, `sticky-fit.js`), `test-results-palette.js` (the heat tiles), `test-bundle-budget.js` (`PHASE_39`).
- Changed to the new layout: `identity-chip`, `setup-deployment`, `admin-calm`, `admin-wide`, `content-brand`, `results-charts-fit`,
  `admin-guests`, `a11y`, `reflow` specs (a Menu-aware `chooseTab` in `admin-local.ts`), `test-admin-results.js`, `test-ux-12.js`.
- Not yet run: WebKit; `npm run test:migration` in full; the oracle; the packager.
