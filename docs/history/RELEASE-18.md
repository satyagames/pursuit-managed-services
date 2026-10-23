# Phase 18: Brand Studio in the Content tab

Branch `pms-18`, made from `8e156b6` (the tip of `pms-17`, which is not merged). Not pushed. The owner's request: "I want to keep Brand Studio in
the Content section. Designers need to design brand elements and content depending on the client. Think like a UX/UI designer and arrange
both under the Content tab, without changing any functionality. Don't hardcode."

## The design as built

The decision, the options (A to D) and the sources are in [DECISIONS.md](../DECISIONS.md#the-content-tab-phase-18); the rules that bind are in
[RULES.md](../RULES.md#rules-from-phase-18-brand-studio-in-the-content-tab-keep-them-holding). In short:

- **Content is one client's workspace.** At the top, the client header: an identity chip (the client's logo through `withoutRetiredLogo` and
  `embeddedAssetUrl`, or its initial on a neutral chip, never another client's logo), the native picker `#content-client` (clients in name order,
  as before; the last one picked remembered for the visit, as before), and Live now or Archived. Beside it (one row from 1100 by 700 CSS pixels),
  or under it, the strip of views.
- **The views are one list**, `CONTENT_VIEWS` in `migration/src/lib/admin/admin-content-views.js`: Activities (the default) and Brand. The strip,
  its arrow keys, the address (`#content`, `#content/brand`; `#sections` and an unknown segment land on Activities), the badges and the focus target
  read only it. A third view is one row.
- **Badges in words, from memory:** "5 · 3 live"; "Standard look" or "Custom look" (`resolveClientTheme(client).source`), and "Unsaved changes" with a
  dot while Brand holds unsaved work, also while Activities shows.
- **Keep-alive.** A view is made the first time it is opened, then kept and put out of sight with the `hidden` attribute (`ContentView.svelte`, a tab
  panel). A switch asks nothing and loses nothing: Brand's draft, device, screen and pictures; Activities' selection, page position and an open
  question editor. Both are made afresh on a change of client, after their guards have asked.
- **Guards.** `lib/admin/unsaved.ts` holds a list of guards, asked in turn. A guard inside a view out of sight brings its view into sight before its
  dialog (`provideReveal` / `revealer`), because a modal dialog under a `hidden` element opens with no size and blocks the page (measured in
  Chromium and WebKit before building). Changing client, another top tab, Lock and closing the page all ask, from either view.
- **The bridge.** On Activities: "Look: Standard|Custom" and **Open Brand**. Under Brand: **Preview an activity in this look...**, a picker of the
  client's activities that opens the existing `ActivityPreview` (the saved look): off while Brand has unsaved changes, with the reason in words
  ("Save to preview your activities in this look."). Neither `ActivityPreview.svelte` nor `BrandPreviewPanel.svelte` changed.
- **Brand view.** `BrandStudio` has `embedded`: a level 3 heading "Brand · <client>" under Content's level 2 and no Back button. On its own its
  markup is what Phase 17 left (`scripts/test-brand-studio-embedded.js`). `onSaved` updates Content's clients, so the chip, the badges, the Look line,
  the activity preview and the copy dialog see a saved look with no reload.
- **Sticky chrome with a budget.** The header and the strip stick under the top tabs as one row where they fit; elsewhere only the strip sticks.
  Heights are custom properties (`--adm-nav-height`, `--adm-content-sticky`, `--adm-sticky-top`, `--adm-sticky-room`), so Brand's sticky preview and
  the page's scroll padding allow for them. With the top tabs the sticky part ends at 125 px of 768 (1366 by 768) and of 820 (1180 by 820): within a
  fifth (`content-brand.spec.ts`).
- **From Clients.** A row's **Brand** opens Content's Brand view on that client (archived ones too), handing Content the three lists Clients has just
  read, so that no request is made, as before. The Clients header's sentence takes the view's label from the list.

## What moved

| What | From | To |
|---|---|---|
| The activities list, the questions, the dialogs and the 15-second read of the live switches | `AdminContent.svelte` | `ContentActivities.svelte`, unchanged but for the Look line and a pause of the read while Activities is out of sight |
| The client picker and the Live now / Archived pills | Content's bar | the client header (`AdminContent.svelte`) |
| Brand Studio's mount, its `{#key}` and the saved-record bookkeeping | `AdminClients.svelte` | `AdminContent.svelte` (CLEANUP-LOG.md, "Phase 18") |

## Specs edited (their assertions about what Brand Studio and Content do are unchanged)

| Spec | Why |
|---|---|
| `admin-content.spec.ts`, `admin-content-sharepoint.spec.ts` | The pills are in `.content-client`, not `.content-bar`; the top tabs are counted inside their navigation (the strip has tabs too); the keyboard order has two more stops after the picker (the strip's chosen view and Open Brand), and walks two more steps so that every stop it checked before is still checked. |
| `brand-studio.spec.ts`, `brand-studio-sharepoint.spec.ts`, `motion-switch.spec.ts`, `sample-pictures.spec.ts` | The heading is "Brand · <client>". |
| `brand-studio.spec.ts`, `a11y.spec.ts`, `contrast.spec.ts`, `admin-today.spec.ts` | No Back button: the Clients tab is the way back. In the guard test, Keep editing stays on Content (where Brand is), and leaving by another top tab is Today (Content is now Brand's own tab). |

New: `content-brand.spec.ts` (13 tests), `scripts/test-admin-content-views.js`, `scripts/test-brand-studio-embedded.js`. Each was run first against
the old code and failed: the spec against the Phase 17 pages (13 of 13 failed), the node tests against no module or the old markup.

## Found while building, and what was done

- **The guard held one screen.** `unsaved.ts` had a single slot; with both views alive, the question editor's guard would have replaced Brand's
  and then removed it. It is a list now.
- **A request pin.** `brand-studio-sharepoint.spec.ts` pins that opening Brand Studio from Clients sends nothing. Going to Content would have read
  its three lists; Clients hands over what it has just read instead.
- **A storage pin.** `brand-studio.spec.ts` pins that the admin page writes nothing to browser storage. The brief asked for the last view "with the
  same storage helper as the last client", but the last client is remembered in memory; the view is too, for the visit (a reload keeps it through
  the address).
- **"Edit brand" collided** with twelve `name: 'Edit'` lookups in four specs (a substring match); the button reads **Open Brand** (the view's label).
- **The bridge's line said "Domino's's".** It no longer names the client.
- **A ResizeObserver loop on WebKit** (the local site's iPad landscape pictures, twice in two runs, never on the Phase 17 pages): out of sight, Brand's
  preview pane measured 0 and its frame shrank to 160 px, to grow back on the way in. `BrandPreview.svelte` keeps the last width above 0.
- **Changing client with a question open** used to drop the typed text silently; it now asks, as the brief requires of a client change.
- **The keyboard.** The arrow keys, Home and End move between the strip's tabs and keep focus there (as the top tabs do); a click or Enter puts
  focus on the view's heading, with the page where it was.

## Proposed, not done

- **Option D**: one screen with the editor beside a permanent preview of the client's real questions in the draft look. A new feature: it needs a
  preview that mixes a draft look with saved content.
- **Brand Studio's card headings** (Colours, Pictures, Animations) are level 3, the same level as "Brand · <client>" now that it is embedded. Making
  them level 4 inside Content changes Brand Studio's markup and the asset cards'; left for the owner.
- **The admin page's size.** The brief guessed a few hundred bytes; it is 4,702 B gzip larger than Phase 17 left it (the header, the strip, the bridge
  and their styles, a view panel, the views list, the guards' list). `PHASE_18` in `scripts/bundle-budget.js` records it with a 5,000 B allowance.
  The participant page is byte for byte as it was; Setup too, but for its build stamp.

## Screenshots

`npm run ux:shoot -- --only admin,brand` on the Phase 17 pages (`ux-review/p18-before/`) and these (`ux-review/p18-after/`), 170 pictures each (Firefox
does not start on this machine), compared pixel by pixel. 132 identical. The ones that differ: Clients (its sentence); Brand Studio (now Content's Brand
view: the client header and strip above it, a level 3 heading, no Back button, the bridge under it); Content (the client header and strip above the
Activities view, the Look line); Brand Studio's picture uploads at 1366 (the same dialogs, lower on the page under the header); and a few dozen pixels
of the known noise between runs (the Live display, Results, the projector). The Activities view and the Brand view are otherwise as before.
