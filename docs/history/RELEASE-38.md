# Prompt 38: the admin page, calm and premium

Branch `pms-38`, from `pms-36` (0478393). Nothing pushed; nothing on `main`. The participant page is byte for byte the size it was (193,978 B
gzip) with the same Tailwind rules. The rules this leaves are in [RULES.md, "Rules from Prompt 38"](../RULES.md#rules-from-prompt-38-the-admin-page-calm-and-premium-keep-them-holding).

## What changed

- **The look.** `migration/src/styles/admin-tokens.css` is the brief's palette by name; the names the screens already used point at it, so every
  screen changed at once. `migration/src/admin-look.css` (the admin page only) holds the type scale, the 1,280 px grid, the cards, chips, folds,
  dialogs, the empty, loading and error states and the sticky bar, on the tokens and the spacing scale only. The header is light; the wordmark's
  letters are ink on it. The files (PDF, PowerPoint, leader report) keep their colours in `migration/src/styles/look-tokens.css`.
- **Icons.** `migration/src/admin/icons.js`, a 1.75 stroke, one meaning each (`admin/icon-meanings.js`), on the six tabs, the actions, the
  question types and readiness. No more ▲ ▼ ✕.
- **Today.** The readiness line first ("Ready to go live", "2 things to fix"), blockers then warnings, "6 checks passed" folded at every width;
  the live session and the session to go live in one card; the three settings as one line with Change; Share (the participant link, its QR, the wall
  link, each with Copy and Open); Go live (or Show the wall) in the sticky bar; End stays in Session settings.
- **Clients.** A new client needs its name; the rest is folded with a line of what it holds, and saving opens the client's page. Archive and Delete
  are in each row's more menu. Add session starts filled in ("{Client} · {date}", the next free day, the last start time) with Create session in
  the bar.
- **Content.** The order as a grip and a place, arrows to move, the row opens its questions, Rename, Duplicate and Delete in the more menu. The
  question editor: the question, its type and its answers first (four rows), the layout folded. Brand: the preview first, the contrast as chips,
  Save and Revert in the bar.
- **Guests and QR.** A guest by name; the group and picture folded; pasting a list folded. Each state a chip with its own icon and word. The QR
  sheet: A4 or US Letter (by the browser's language), 6 or 12 to a page (6 by default), Print in the bar.
- **Results.** Three figures first (guests, finished every activity, confidence shift) for the session shown; Delete in a Danger area at the foot;
  the Leadership filters behind one Filters button with a line of what they are.
- **People.** Give access in the list's header (it opens Add user, then the person's Give access); a name typed without a domain is offered at the
  signed-in person's; each role with its one line (`ROLE_SUMMARY`), also under the role in the bar's chip; History grouped by day, its filters
  folded.
- **Smart defaults** (`lib/admin/admin-defaults.js`), remembered per person in this browser (`pms.prefs.`, guarded).

## The audit, item by item

| # | Item | Status |
|---|---|---|
| 1 | Readiness: summary first, blockers, warnings, passes folded | Done |
| 2 | One primary action, in the sticky bar | Done (End stays in its card: destructive) |
| 3 | Three controls as a one-line summary with Change | Done. **Deferred:** a new session's defaults (guest QR, confidence off) are written by the data layer, which the participant page carries; changing them changes `index.html`, which the brief forbids. It still writes staff sign-in and the check when the client has one. |
| 4 | Share group with Copy and Open | Done |
| 5 | A new client: name first | Done |
| 6 | Add session pre-filled, Create session in the bar | Done. A session takes the client's activities, as before: there is no separate "activity set" to remember. |
| 7 | Activities: grip, row opens, delete in a more menu with confirm | Done. Moving is by the arrows (keyboard and iPad); no drag. |
| 8 | Question editor: basics first, the rest folded, defaults | Done. The editor has no feedback or scoring fields: only the layout is folded. |
| 9 | Brand Studio: preview first; contrast as a chip | Done |
| 10 | Add guest: name only, the rest folded, paste stays | Done (there are no file or notes fields) |
| 11 | Guest states as chips with icon and word | Done |
| 12 | QR sheet: Print in the bar, A4 or Letter, 6 to a page | Done |
| 13 | Results leads with three figures | Done, for the session shown: figures across every session would need new reads. |
| 14 | Chart kind chosen by question type | Already so (`chartKind`, `lib/results/results-chart-model.js`); no viewer choice exists |
| 15 | Delete and Restart away from Export, two-step | Delete: Done (Danger area, its two-step warning). Restart stays on each guest's row in the folded People list, with its own form. |
| 16 | Leadership: filters folded; default all guests, latest session | Folded: Done. **Deferred:** "latest session" is not a scope the dashboard counts by (it counts by year, quarter, month or dates); adding one changes what a leader's figures mean. |
| 17 | Roles with one line each; new users Producer | Done |
| 18 | Give access in the list header; the signed-in domain | Done |
| 19 | History: newest first, by day, filters folded | Done |
| 20 | Tabs: ink, lime underline, primary icon | Done |
| 21 | Identity chip: the one line of what you can do | Done (from 1,280 px; under it, in Your access) |
| 22 | Dialogs: order, Esc, focus, actions right | Actions stay at the dialog's foot, right-aligned, primary last; Esc closes (native dialogs and the more menu). Not rewritten dialog by dialog. |
| 23 | Empty states | Clients, Sessions, Results, Guests (two). Others not yet. |
| 24 | Errors on the danger wash with the triangle | Done (every `.error`) |
| 25 | Skeletons, not spinners | Today, Clients, Content, Guests, Results, People |

**Also deferred:** the chart gradients and the softened Low, Medium and High in the Results charts and on the wall. Every chart colour comes from
`results-tokens.css` (CLAUDE.md rule 8) and the same palette is drawn in the PDF and PowerPoint, which cannot draw a CSS gradient; changing the
page alone would split the page from its files. The gradients are tokens (`--adm-grad-*`) and shown in the styleguide, ready for that change.
**Type:** running text stays 16 px (CLAUDE.md rule 9), so Body and Small are 16 px, not 14 and 13. **Colours:** the brief's muted, warn and ok are
under 4.5:1 on white, so they are marks only and words take a darker ink beside each wash.

## Sizes (gzip -9)

| Page | Before (pms-36) | After |
|---|---:|---:|
| Participant | 193,978 B | 193,978 B |
| Admin | 703,193 B | 714,514 B |

The brief asked for the admin page under 700,000 B; it was 3,193 B over that before this work began. The budget in `scripts/bundle-budget.js`
is 710,000 B, and the page is 4,514 B over it, so `npm run test:bundle` fails (the Prompt 24 to 38 records and the negative control with it).
Open Sans was already embedded (400, 600, 700, Latin), and is not counted again. Raising the budget is the site owner's call; trimming further
means taking a feature out (the obvious candidates are in "Open").

## Tests

- New: `scripts/test-admin-icons.js`, `scripts/test-admin-look.js` (tokens, pairs, no colour of its own, the spacing scale),
  `scripts/test-admin-defaults.js`, Results' lead figures in `scripts/test-admin-results.js`, Today's lines in `scripts/test-today-view.js`;
  `scripts/migration-tests/admin-calm.spec.ts` (no sideways scroll at 1024, 1280, 1440; axe on every tab; icon-only controls named; the bar never
  covers the focused field; Esc closes; a client by name), pictures in `test-results/admin/calm/`.
- Changed on purpose: `admin-wide.spec.ts` (the 1,280 px content, Today's 8 + 4, the folded checks and settings, the Brand preview first);
  `scripts/brand-studio-markup.html` re-recorded with `PMS_RECORD_MARKUP=1`; the storage list (`pms.prefs`); the files' colours read from
  `look-tokens.css`.
- Run here: `npm run check:svelte`, `npm test` (only the budget fails), `admin-calm` and `admin-wide` in Chromium. Still to run: the rest of
  `test:migration` in Chromium and WebKit, `test:a11y`, forced colours, `perf`, `console:errors`, the package.

## Open

1. The admin budget (above).
2. The deferred items above.
3. On a real iPad: the sticky bar above the keyboard, and the QR sheet printed on A4 and on US Letter.
