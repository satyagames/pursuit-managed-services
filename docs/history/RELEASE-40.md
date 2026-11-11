# Prompt 40: tab dividers, a list and its detail side by side, Brand edit left, labels in line

Branch `pms-40`, from `pms-39` (17b268c). Nothing pushed; nothing on `main`. Admin page only: the participant page is byte for byte the size it
was (193,978 B gzip) with the same Tailwind rules. The rules this leaves are in
[RULES.md, "Rules from Prompt 40"](../RULES.md#rules-from-prompt-40-tab-dividers-a-list-and-its-detail-kept-side-by-side-edit-left-and-preview-right-labels-in-line-keep-them-holding).

## What changed

- **The bar's tabs** (`admin-look.css`, `admin-tokens.css`): a 1 x 20 px divider in `--adm-line` between each two neighbouring tabs, drawn as
  `.tab + .tab::before` (never read, none at the ends, never touching the underline); 14 px inside each tab (`--adm-tab-pad`), 9 px between two
  (`--adm-tab-gap`: 4, the divider, 4), 8 px from icon to word, the primary wash on hover. To stay one line: 12 px inside each tab and 12 px
  between the bar's parts from 1,280 to 1,365 px; 4 px inside and 4 px between tabs from 1,024 to 1,279 px. No dividers in the Menu's list.
- **A list and its detail side by side** (`.adm-sticky-col`, `.adm-selected`, `.adm-context` in `admin-look.css`; `scrollToShow` and
  `showInColumn` in `lib/admin/sticky-fit.js`): Clients' list and People's list hold under the bar, 16 px down, as tall as the window leaves
  them, and scroll inside themselves while the client or person scrolls with the page; the open row is the primary 3 px edge on the wash and is
  brought into the list's view without moving the page. A client's page (`ClientWorkspace.svelte`) starts with a 48 px strip held at the top of
  its column: the logo, the name, Active or Archived, and Back to clients (moved there from the title row, so there is one).
- **Content's activities** (`ContentActivities.svelte`, `ContentQuestions.svelte`, `admin.css`): from 960 px both columns hold under Content's
  strip and scroll inside themselves, so the chosen activity's questions are beside it wherever it is; the page does not move and the focus stays
  on the row. The questions' head is the activity's place and name ("5 · Straight Talk") with Add question, held at the top of its column. The
  chosen activity is the same edge and wash as the open client. A long list of activities fades at its foot. A row's more menu opens upward
  when below would run past its column (`MoreMenu.svelte`). On a view-only screen the columns scroll with the page: nothing in them can take
  the focus, so the keyboard could not scroll them (axe, `role-scoping.spec.ts`).
- **Brand** (`BrandStudio.svelte`): the controls 5 of 12 on the left, the preview 7 on the right (held under the strip, 16 px down); Pictures,
  then Colours, then Animations folded to one line ("On for participants"); the page's order is the same, so reading and Tab follow it. Below
  1,100 px the preview is under the controls (it was above them below 820 px). The sticky bar already had where Brand stands on the left and
  Revert and Save on the right: unchanged.
- **Field labels** (`admin-look.css`): `.field__label` starts `--adm-field-inset` (13 px: the field's border and padding) in, so it lines up
  with the field's words on every filter, editor and dialog; Content's Client label, beside its picker, has none. The selects in People's
  filters, History of changes, Give access and Reporting settings were native (`class="input"`), whose words Chromium draws 4 px inside the
  padding; they are the page's drawn `.select` now (`.select--block`, the field's width).

## Decisions for the owner to confirm

- Labels stay 16 px (not the brief's 12 / 16) and fields 44 px (not 40): CLAUDE.md rule 9.
- The brief's 14 px tabs did not fit one line at 1,280 px next to "Super admin · All clients": 12 px there, as above.
- The questions panel's head has Add question; Edit and Delete stay on each question's row (the brief placed them in the head).
- The client and person still replace the list below 1,100 px, as before, not below 1,024 px.
- The tab divider is the brief's `#E7EBE3` on white: about 1.2:1, so it is felt more than seen, as intended; QA 405 asks how it looks on a
  projector.
- The bundle: the brief asked for under 700,000 B gzip; the admin page stood at 717,588 B before the work and is 718,558 B after (+970 B)
  (under its 720,000 B budget, `PHASE_40` in `scripts/bundle-budget.js`).

## Tests

- New: `scripts/migration-tests/admin-related.spec.ts` (1280, 1440, 1920 px): five dividers with equal room each side; Clients' list, strip and
  open row in the window 800 px down; the last of eight activities opened with its questions in the window and no page jump; Brand's Pictures
  then Colours, the controls left of the preview, the preview in view 600 px down; People's four labels at their fields' words, on one
  baseline, every select drawn. Pictures in `test-results/admin/related/`. It fails on 17b268c, at its first check (no dividers).
- New in `scripts/test-admin-look.js`: the three tokens; `scrollToShow`.
- Changed for the swapped Brand: `brand-studio.spec.ts` (controls first; the preview under them below 1,100 px), `admin-wide.spec.ts`,
  `admin-full-width.spec.ts` (the split pair's order), `motion-switch.spec.ts` (opens the Animations fold).
- Run here (Chromium): the new spec and every admin spec it touches (admin-full-width, admin-wide, brand-studio, motion-switch, content-brand, clients, admin-content, content-edit-in-place, keyboard, focus, aria, a11y, reflow, role-scoping, users, people-wide and the rest of the admin set): all pass but one, `reflow.spec.ts` at 200% text, Content's client chip "D" cut short, which was already open after Prompt 39. `test:bundle` passes.
- **For the final round**: `npm test`, `npm run test:migration` (WebKit and Firefox not run here; Firefox does not start on this machine),
  `npm run test:a11y`, `npm run perf -- --check`, `npm run console:errors`, the package.
