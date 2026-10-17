# UX review of the shipped pages on the local PCOE site (Phase 12, Part 1)

**17 Oct 2026, branch `pms-12` (from `pms-11b`), pages of the package `pms-21462b6`, unchanged.** This part changed no application code (`git diff --stat
cd7faf3 -- migration public server` is empty). It built a local stand-in for the PCOE site ([LOCAL-SITE.md](LOCAL-SITE.md)), loaded VJR's dummy dataset and
pictures, photographed every flow on the review's devices, measured the pages, and wrote what it found here. **Nothing here is fixed yet: every item
waits for approval (Part 2).**

The pictures are in `ux-review/2026-10-17/` (git-ignored): `index.html` is the contact sheet, `ux-review.zip` the whole folder to share, `shots.json` each
picture's device, state and request count, `perf.json` the measurements. A picture is named `<flow>/<id>--<device>.png`; the register cites them that way.

Devices: iPad (10th gen) portrait and landscape, iPad Pro 11 and iPhone 15 in WebKit; Windows laptops 1366x768, 1536x864 at 125% and 1280x720 at 150% in
Chromium; a 1920x1080 projector in Chromium. **Firefox could not be started on this Windows machine** (`spawn UNKNOWN`, the known issue in AGENTS.md), so it
is missing. WebKit here is Playwright's WebKit on Windows: it uses Windows fonts and is not Safari on an iPad.

---

## 1. The three biggest findings

1. **A single-choice poll blocks Go live on SharePoint (F-01, blocker).** A poll's answers are written with `correct: null`, but the data layer stores a Yes/No
   column as `value === true`, so SharePoint holds No, and the page reads `false` back. Today's readiness rule treats "some answers `false`, none `true`" as a
   graded question with no right answer, a **blocker**, so Go live is switched off. VJR's dataset has no single-choice poll, which is why the real site has not
   met it; the first poll anyone adds in Content will.
2. **The admin page cannot tell a person why it refuses them, and the participant page sends a guest with a used code to a dead end (F-02, F-03).** An
   account that may not read PMSAdminUsers sees "Couldn't reach the server: SharePoint (403): Access denied..." (it is not a connection problem, and it does
   not say whom to ask). A used QR code says "Ask your facilitator for a new one, or select your client below", and there is nothing below.
3. **What a page weighs is mostly not the app (F-06, F-07, F-21).** The embedded fonts are 41% of the participant page (63.6 KB of 156.7 KB gzip); jsPDF,
   PptxGenJS, jszip, pako and the report's fonts are 47% of the admin page (about 260 KB gzip), and a single-file build downloads them with the page however
   "lazy" the `import()` looks; Setup is 82% sample pictures. Pictures: the 922 KB gingham could not be stored by any path (Brand Studio's best was 355 KB
   against a 350 KB cap, after 8.3 s; the data layer refuses anything over 512 KB).

---

## 2. Findings register

Severity: **blocker** (stops the event), **major** (people will be confused or misled), **minor**, **polish**. Every item is a visible change unless it says
otherwise, so every item needs approval. Effort: S (an hour or two), M (a day), L (more).

| ID | Screen, device, state | Sev. | What is wrong (evidence) | Cause in the code | Proposed fix | Effort / risk |
|---|---|---|---|---|---|---|
| F-01 | Admin, Today, any device, a client with a single-choice poll | **blocker** | Readiness: "...is marked as graded but no answer is marked correct", Go live disabled (`admin/02-today-live`, event-day's late poll) | `dataService.js` `spEncode`: `kind === 'yesno' ? value === true` stores null as No; `lib/admin-today.js` rule `no-correct` counts `correct === false` | Treat a single-choice question whose answers are all not-correct as a poll (as the pager and Content already do: `isGraded`, "Leave Correct off for a poll"); keep the blocker for true-or-false only. Test on the mock that stores No | S / low |
| F-02 | Admin PIN, persona `outsider` | major | "Couldn't reach the server: SharePoint (403): Access denied..." (`admin-states/05-outsider-unlock`) | `AdminApp.svelte:84` words every failure as a lost connection | For a 403 on PMSAdminUsers: "This account may not open the admin page. Ask a site owner to add you to the PCOE owners." (and the support line from `pms-config.txt` when set) | S / low |
| F-03 | Participant, a used QR code, iPad and phone | major | "...or select your client below." with nothing below (`participant-guest/02-qr-used`) | `dataService.js:1778` `token-used` words (pinned by the storage suite's words test) | "This QR code has already been used. Ask your facilitator for a new code." Change the pinned words with it | S / low |
| F-04 | Live display full screen and the wall, projector | major | The admin's notice "1 participant's answers could not be read... Correct or delete the damaged item in the PMSParticipantAnswers list" is shown to the room (`live-display/01-fullscreen-q01--projector`) | `LiveDisplay.svelte` shows `unreadableNotice` in every view | Show it on the admin view only; on the wall, at most a quiet "1 answer could not be counted" in the footer | S / low |
| F-05 | Participant, picture tiles, every device | major | Transparent logo tiles sit on the page's background picture with no plate: green "HOME CHEF" is barely readable (`tiles/01-tiles`); the wrong tile turns purple | `LogoTile` draws the picture on the tile's translucent fill | A white (or the client's plate) card behind each tile picture; keep the state ring and word | M / low |
| F-06 | Participant page, every device | major (weight) | Fonts are 63,594 B of 156,729 B gzip (41%) | `styles/fonts.css`: six base64 WOFF2 faces | **Keep embedding** (section 6: VJR's decision is Open Sans everywhere) and make it cheaper and steadier: see section 6 | M / low |
| F-07 | Admin page | major (weight) | jsPDF 101 KB, PptxGenJS 90 KB (with a 1920x1383 placeholder PNG inside it), jszip 28 KB, pako 18 KB, report fonts 23 KB (gzip): 47% of 558,745 B. Brand Studio's three extra faces (31 KB) ride in the page although "loaded only when Brand Studio opens" | `vite-plugin-singlefile` inlines every `import()` (`Promise.resolve().then(...)` in the build): bytes are paid at load, only running is deferred | See section 5, item 3: what single-file allows and what it does not | M / medium |
| F-08 | Admin, Results, laptop, 60 visits | major | The 60-row list comes first; the charts are a closed `<details>` at the bottom of a 5,500 px page (`admin/07-results`) | `AdminResults.svelte:254` | Live results first and open for the live session; the people list collapsible, with a count | M / low |
| F-09 | Admin Results and Guests after a question is added mid-session | minor (rule) | Every finished person becomes "In progress"; Guests says "45 joined, 0 completed" | "Finished" is a final answer to every question of every switched-on activity (AGENTS.md: the shared rule) | Question for VJR: keep, or count "finished" against the questions that existed when the person finished | — |
| F-10 | Participant, first load on a slow network | minor | A black page with "Restoring your session..." for 1 to 3 s, also on a first visit (`participant-states/06-slow-loading`) | `App.svelte:439` | "Loading..." and the Deloitte wordmark on the neutral gradient; "Restoring..." only when there is a visit to restore | S / low |
| F-11 | Participant, ranking, every device | minor | A ranked answer looks like an unranked one except for "1" against "–" (`participant/03-1-straight-talk-q1-ranking-partly`) | `QuestionOptions.svelte` rank state | The ranked pill filled (as a chosen answer is), the number in a circle | S / low |
| F-12 | Participant header and finale, staff sign-in | minor | "Hi Okafor, Jamie!", "Thank you, Okafor, Jamie!" (`participant/01-welcome`, `06-finale`) | `greetingName` uses the directory's "Last, First" (VJR kept that for names on Results, 16 Oct) | Greet by the part after the comma ("Hi Jamie!"); keep "Last, First" on Results and the report | S / low |
| F-13 | Participant, phone, a background picture | minor | The sticky Next/Submit bar draws a solid primary band over the picture (`mockups/01-reveal-line--iphone-15`, `participant/03-1-...--iphone-15`) | `ActionBar.svelte` background | A translucent scrim band, or none | S / low |
| F-14 | Results and Live display, graded bar | minor | "✓ Correct" and "Top choice" run together on one line, on different baselines (`live-display/02-fullscreen-q07-answer`) | `admin/charts/BarChart.svelte` labels | A gap and one baseline, or the tag under the label | S / low |
| F-15 | Admin, Content, laptop | minor | Six buttons per activity card: Delete wraps alone; the right half of the page is empty (`admin/05-content`) | `AdminContent.svelte` card layout | Delete into a "More" menu or the row end; a wider left column | S / low |
| F-16 | Admin, Today, staff mode | polish | The staff-mode warning is shown twice (Controls and Readiness) (`admin-states/03-today-gone-live`) | `AdminToday.svelte` | Once, in readiness | S / low |
| F-17 | Participant and admin, disabled Next/Submit over a picture | polish | Nearly invisible (`brand/kroger-03-question`) | `PillButton` disabled style | A visible outline at 3:1 | S / low |
| F-18 | Participant, a client with a light background | minor (design) | The scrim (63%, computed for a white picture) turns Domino's light blue into grey (`brand/dominos-02-hub`) | `lib/scrim.js` (correct for contrast) | Question for VJR: accept, or let a light background use dark words and a light scrim | M / medium |
| F-19 | Participant Welcome, a client with a hero and a logo | minor (product) | The logo is never shown when there is a hero: Kroger's logo appears nowhere a participant looks (`brand/kroger-01-welcome`) | `HeroPlate` order: hero, else logo | Question for VJR: show the logo small in the header beside the Deloitte wordmark | M / low |
| F-20 | Participant, an activity done quickly | polish | Confetti from the completion screen still falls on the next activity's first question (`participant/03-3-open-feedback-q1-answered--laptop-1366`, first run) | `confetti.ts` burst outlives the route | Clear the canvas on a route change | S / low |
| F-21 | Brand Studio, background | major (content) | The 922 KB gingham: "too detailed to fit in 350 KB... smallest 355 KB at 1152 × 1536 px", after 8.3 s on this laptop; the data layer's upload refuses anything over 512 KB | `asset-specs.js` background 350 KB; `ASSET_MAX_BYTES` 512 KB | Not used (Kroger wears the stripes: VJR, 17 Oct). Propose a picture brief for content owners (section 7) | — |
| F-22 | Participant, a page that reopens a logged visit | polish (no visible change) | Each reload sends a visit-log create that SharePoint refuses as a duplicate (500), read as "already logged" | `recordUserVisit` uses the unique AppId as its check | Leave it (one request, harmless), or remember the logged key in sessionStorage | S / low |
| F-23 | Participant, iPad portrait | polish | Retry and Home sit at the bottom, far from the answers (`participant/03-4-mcq-q1-wrong-1--ipad-portrait`) | `ActionBar` is fixed to the bottom on purpose (thumb reach) | Question: keep (thumb reach on a held iPad) or put the bar under the answers on a tall screen | S / low |
| F-24 | Participant page `<head>` | polish | No `robots noindex` (admin and Setup have it), no favicon (a browser asks `/favicon.ico`), no `color-scheme` | `migration/index.html` | Add the three | S / low |
| F-25 | Admin, Brand Studio preview | info | The preview greets "Hi Jane Doe!" | `brand-sample.js` | None (it is sample content, on purpose) | — |

**What works well and should be kept:** the graded states (colour, icon and word), Retry and the reveal; the offline notice ("Your answers are kept on this
device... Couldn't save, Retry", `participant-states/03-offline-submit`) and recovery; a 503 at start recovering by itself; the full screen's fit at 1920x1080
and at 125% (every question card whole, `live-display/`); text at 200% reflowing; Brand Studio's refusals in plain words (a 480x320 tile as a hero:
"too small... enlarged 3.8 times"); the contrast table and the accent warnings; every destructive action confirmed in words that say what is lost (End
session, Restart, Remove a visit, switching mode).

---

## 3. VJR's dataset: how it maps, and its gaps

Loaded as data (`scripts/local-site/datasets/pms-content-pack.json`, one loader, the app's own `seedPack`): **3 clients, 15 activities, 28 questions**, in the
dataset's order, curly quotes, `°` and brackets unchanged (tests hold all of it, and that every record passes the admin's own rules and the pager's).

| Activity | Stored as | Note |
|---|---|---|
| Straight talk | `ranked-voting`, one question, five options | The participant screen says "Tap your choices in order: the first you tap is your top choice", while the activity's description says "Vote on...". **Question for VJR: is a ranking what "vote" means?** (PCOE shows it as a ranking with support scores today.) The bracketed Kroger and Domino's options (50 to 70 characters) wrap to two lines on a phone and fit on an iPad held upright; nothing is cut (`participant/03-1-...`). |
| Confidence continuum | `confidence-continuum`, values 1, 2, 3 | Labels spelt correctly ("Moderately confident"); the live site still has "Modarately confidence" (the `pcoe-16oct` scenario keeps that typo on purpose). |
| Open feedback | `open-text-feedback` | No follow-up field: the Template's one question and three follow-ups are **four questions**, in order. Kroger and Domino's have three each. |
| MCQ | `single-select`, graded, one `Correct` | The Template's "London (1845)": the answer is **London**; 1845 is a fact for a reveal and is not stored. |
| Guess the brand | `single-select`, graded, `text-list` | The riddle's blank (a run of underscores) shows as a line, and a screen reader reads it as "underscore" or nothing depending on the reader: say "blank" in the words, or use "…". **The Template's riddle answers Kroger**, so the Template is not client-neutral there. |

**What the model cannot hold:**

1. **The reveal line** (shown after Guess the brand). No column holds it, so the app cannot show it. Kept in `data/<scenario>/reveals.json` and on the control page.
   A **mock-up** of the screen (drawn into the page by the harness and labelled on the picture) is `mockups/01-reveal-line--{ipad-portrait,iphone-15}.png`.
   Showing it means **a new column, `PMSActivityQuestions.Reveal` (Note), schema version 4**: an entry in `pms-schema.js` and `pms-schema-meta.js`, Setup's plan,
   Create and Mark ready raising 3 to 4, the upgrade tests, the request baselines by translation (`$select` grows by one column), Content's editor, the pager
   (after a right answer or the reveal) and the Live display's Show answer. **Question for VJR: is the reveal screen wanted?** If yes, it is its own phase.
2. **Purposes** of the five activities: facilitator guidance, stored nowhere. In LOCAL-SITE.md.
3. **Descriptions missing from the pack:** Kroger "Open feedback" and "Guess the brand", Domino's "Open feedback" and "Guess the brand". The Template's are
   used ("Tell us what would make this partnership a success", "Name the brand behind the riddle"). **For the content owner to confirm.**
4. **Facts** (Deloitte founded in London in 1845, "Together makes progress", Kroger's headquarters and 84.51°, Domino's headquarters and "Piece of the Pie
   Rewards", the riddles) are the author's: dummy data until checked.

**Should Setup's "Seed sample clients" create this pack instead of the older one?** Recommendation: yes, once the facts are checked and the logos cleared:
it is the content the sessions really use. It changes `lib/sample-clients.js`, `server/data`, the sample pictures and their tests (`test-seeds`,
`test-sample-pictures`): a Part 2 decision for VJR, after logo clearance.

**The test-only sixth Kroger activity** ("Guess the brand: picture tiles", scenario `tiles`) is not VJR's content; it exists to show the picture-tile layout.

---

## 4. VJR's pictures: the assignment and their weight

Final assignment (`scripts/local-site/datasets/branding.json`): **Kroger** logo `logo-kroger`, hero `hero-fresh-sticker`, background **`bg-dark-blue-stripes`**
(changed from the gingham on VJR's word, 17 Oct); **Domino's** logo `logo-dominos`, hero `hero-red-blue-ball`, background `bg-light-blue-grain`; **Template**
background `bg-dark-blue-stripes` only. Tiles 6 to 9 are the test activity's four answers. The files are never committed or packaged (a test holds it).

| Picture | Size | Bytes | Slot cap | Through Brand Studio (Chromium, this laptop) |
|---|---|---:|---:|---|
| bg-red-white-gingham | 1536x2048 | 945,024 | background 350 KB | **Refused**: best 355 KB at 1152x1536, after 8.3 s. The data layer refuses over 512 KB too. Not used. |
| bg-light-blue-grain | 1280x1707, RGBA (opaque) | 426,502 | 350 KB | Fits after cropping and compressing, 2.2 s. (The local site's loader stores the original, 426 KB; Brand Studio would store less.) |
| bg-dark-blue-stripes | 1536x2048 | 33,194 | 350 KB | Fits, 1.1 s |
| hero-fresh-sticker | 1200x1200, 26% transparent | 128,600 | hero 300 KB | Fits, 1.0 s |
| hero-red-blue-ball | 1200x1200, 37% transparent | 71,992 | 300 KB | Fits, 1.1 s |
| logo-kroger / logo-dominos | 800x400 | 16,892 / 12,872 | logo 150 KB | Fit, 0.8 s |
| tile-home-chef, -murrays, -bloom-haus, -smart-way | 480x320 | 21,120 / 27,166 / 17,436 / 9,642 | tile 60 KB | (Content's slot; a tile tried as a hero is refused in words) |

What a participant's iPad downloads on entry (measured, `perf.json`): **167 KB of pictures and the page's reads with the stripes; 1,079 KB with the
gingham.** Proposed for content owners (a picture brief, not a code change): background under 350 KB means a simple or blurred picture, not a fine
texture; a WebP of 1536x2048; no transparency for a background (`bg-light-blue-grain` carries an alpha channel it does not use).

**The brand matrix** (`brand/<client>-0{1..4}-*` on five devices): see F-05, F-13, F-17, F-18, F-19. The Template (no logo, no hero) falls back cleanly: its
name in type on the plate, the stripes behind (`brand/template-01-welcome`).

---

## 5. Web performance (measured)

Chromium, CPU four times slower, the local site at PCOE's latency (about 350 ms a request) or the slow profile (about 1,500 ms), `event-day` (60 visits)
and `stress` (400 visits, 30 questions). Pages over a real HTTPS connection, gzip as SharePoint sends them.

| Moment | PCOE latency | Slow network |
|---|---:|---:|
| Participant: open to "Click here to begin" | 1.02 s (LCP 0.93 s, FCP 0.18 s, CLS 0.0003, no long task) | 3.57 s (LCP 3.39 s) |
| Participant: "Click here to begin" to the hub | 1.33 s | 4.88 s |
| Participant: open an activity (held content) | 0.04 s | 0.04 s |
| Participant: Submit (the answers saved) | 0.86 s | 2.41 s |
| Admin: PIN screen | 0.11 s | |
| Admin: Unlock to Today | 0.88 s (3 long tasks, longest 99 ms) | |
| Admin: Results, 60 visits / 400 visits | 2.42 s / 4.09 s (longest task 383 ms) | |
| Live display, a minute of refreshes, 60 / 400 visits | 63 ms / 405 ms of script (longest task 484 ms) | |

Page sizes (gzip, `npm run analyze:bundle`): participant **156,729 B** (fonts 39.9%, Svelte 15.6%, the data layer 10.9%); admin **558,745 B** (jsPDF 18.1%,
PptxGenJS 16.1%, admin screens 14.7%); Setup **788,842 B** (sample pictures 82.4%). The budgets (450,000 and 700,000 B) hold.

1. **Fonts:** section 6.
2. **Dead code:** `chart.js` is a dev dependency only (the bundle test's negative control); it is in no page. `Styleguide` is absent from builds. No source map,
   no `eval`, no `new Function` in any page. The admin page has 48 `console.log` calls, all inside libraries (jsPDF, PptxGenJS), none in the app.
3. **Heavy libraries "loaded only when used":** in a single-file page they are not: every `import()` became `Promise.resolve().then(...)`, so jsPDF,
   PptxGenJS, jszip, pako, the report's fonts and Brand Studio's extra faces are downloaded with the admin page (about 290 KB gzip). Only their running is
   deferred: the admin page's load shows 3 long tasks and 0.18 s of script at 4x CPU, so the cost is bytes, not time. **What single-file allows:** nothing can
   be split into a second file unless SharePoint serves it; a `.json` it does not, and whether it serves a `.js` from a document library is not known
   (a QA item). Proposals, in order of safety: (a) leave it (the admin page is a facilitator's, loaded once, at 0.9 s to Today); (b) drop the PptxGenJS
   placeholder picture and other unused parts (a build-time stub, as the jsPDF stubs are); (c) only if the site serves `.js`: put the exports in
   `exports.js` beside the pages. The participant page has none of this (the bundle test holds it).
4. **Images:** handled by Brand Studio (crop, compress to the slot's cap, WebP where the browser can encode it); the hero has `decoding="async"`,
   `fetchpriority="high"`, a reserved square (CLS 0.0003). The local site's own loader bypasses Brand Studio (F-21's table).
5. **Requests:** every request was same-origin (the harness records any other: there were none). The only failures were the deliberate ones (F-22, Setup's probes).
   Request counts per screen are in `shots.json`; the baselines did not change (no app change).
6. **Rendering:** Results with 400 visits and 30 questions: 4.1 s to show, a 383 ms long task; the Live display's refresh at 400 visits is 405 ms of script a
   minute, the longest task 484 ms. Acceptable on a laptop; `content-visibility: auto` on Results' session cards would help the 400-visit case (M, low risk).
7. **Document hygiene:** F-24. Every page has `lang`, its own `<title>`, the viewport tag with `viewport-fit=cover`, `theme-color`. The Build line is on Setup.
8. **Single-file reality:** stated in 3.

---

## 6. The font question (VJR, 17 Oct 2026: **Open Sans, the approved brand font, on every device**)

**Measured:** the participant and admin pages each carry six base64 WOFF2 faces, **63.6 KB gzip** of the participant page (41%) and 63.5 KB of the admin
page; Setup carries three (32.9 KB). A variant with no embedded font (built in a scratch worktree, never committed) is 93,135 B gzip for the participant page.

**Pictures (a)/(b)/(c)** are `fonts/0{1..5}-*--{a-embedded,b-variant-installed,c-variant-absent}--*`: the hub, the ranking, Results, the QR sheet and the Live
display's full screen, on the laptop, the projector and the iPad. With a fallback measured from the TrueType files (`scripts/local-site/font-metrics.js`:
Arial `size-adjust: 104.46%`, `ascent-override: 102.32%`, `descent-override: 28.05%`), (c) breaks every line where (a) does and nothing overflows; what
changes is the look: Arial has no Light weight (the descriptions get heavier) and no ExtraBold (the titles get lighter).

**What decides it: stock iPadOS and Windows do not have Open Sans.** Without the embedded faces, the brand font would show only on a device where someone
installed it. So the only method that shows Open Sans in every browser on every device, with no install, no third-party request and no file SharePoint may
refuse to serve, is the one the pages use now: **embedding it**.

**Recommendation (for Part 2): keep embedding Open Sans, and make it cheaper and steadier.**

1. **Keep the six faces in the participant page** (it is the client-facing one), with `font-display: swap`.
2. **Add the measured fallback face** (`"Open Sans Fallback"`, Arial with the overrides above) second in `--font-sans`, so the moment before the
   faces are decoded draws in the same space and nothing moves when Open Sans takes over (today the stack falls to `system-ui`, whose widths differ).
3. **Admin page:** keep its three faces; the three extra faces (Light, ExtraBold, ExtraBold Italic, 31 KB gzip) are there only for Brand Studio's preview of
   the participant screens. Keep them (the preview must look like the iPad) or accept the fallback in the preview only: VJR's choice.
4. **An experiment worth measuring in Part 2:** Open Sans as one variable font (weights 300 to 800 in one file, plus the italic) subset to the same
   characters, against the six static faces. Adopt it only if it is smaller and looks the same.
5. **No CDN** (Google Fonts would be a third-party request, which the Firm network or Guided Access may block, and the harness fails on one) and **no font file
   in the SharePoint folder** (a library may not serve it, as it did not serve `.json`).
6. The leader report keeps its own embedded Open Sans for the PDF (`lib/report-fonts.js`); the one-page PDF and PowerPoint use Helvetica/Arial;
   `THIRD-PARTY-NOTICES.txt` stays as it is (Open Sans still ships).
7. The Setup "Font" line (`document.fonts.check`) is then not needed to decide anything; it remains a cheap check that the faces decoded on a real device.

---

## 7. Ranked short list of recommended fixes

| Rank | Finding | Effort | Risk |
|---|---|---|---|
| 1 | F-01 a poll blocks Go live | S | low |
| 2 | F-02 the outsider's 403 words | S | low |
| 3 | F-03 the used-code dead end | S | low |
| 4 | F-04 the admin notice on the projector | S | low |
| 5 | F-05 tile pictures need a plate | M | low |
| 6 | F-08 Results: charts first | M | low |
| 7 | Fonts: the measured fallback face (section 6, item 2) | S | low |
| 8 | F-10 the first-load words | S | low |
| 9 | F-11 ranking's chosen state | S | low |
| 10 | F-12 greet by first name | S | low |
| 11 | F-13, F-14, F-15, F-16, F-17, F-20, F-24 (polish together) | M | low |

Questions rather than fixes: F-09, F-18, F-19, F-23, the reveal line, the dataset as the shipped sample, Straight talk as a ranking.

---

## 8. What the local site could not show

Real SharePoint permissions beyond PMSAdminUsers, throttling, `$batch` limits, versioning, the recycle bin, and whether a document library serves `.js` or
font files; Safari on a real iPad, Guided Access, the Firm iPad's MDM, fonts and keyboard (Playwright's WebKit on Windows uses Windows fonts and has no
on-screen keyboard); sound; a real network (latency only); Firefox on this machine; the 2,048-character query limit of PCOE (assumed); the Setup self-test's
Yes/No probe (the mock reads `Used eq 0` as no filter, so its row counts mean nothing locally).

---

## 9. Questions for the approvers

1. Which finding IDs to fix in Part 2 (section 7 is the recommended order)?
2. Fonts: keep embedding with the measured fallback (recommended); keep or drop Brand Studio's three extra faces on the admin page; run the variable-font experiment?
3. F-09: does adding a question mid-session un-finish everyone (today's rule), or not?
4. F-12: greet staff by first name ("Hi Jamie!")?
5. F-18 and F-19: a light background with dark words; the logo in the header when there is a hero?
6. The reveal line: wanted (a schema-version-4 phase of its own) or not?
7. Should Setup's "Seed sample clients" create VJR's pack instead of the older one (after the facts are checked and the logos cleared)? Should VJR's
   pictures replace the shipped sample pictures?
8. Straight talk: a ranking (as now) or multi-select ("vote")?

---

## 10. Gates

Run, as asked (only the local site's tests during development): `npm run test:local-site` **26 of 26 pass** (Node 22), including Setup's own self-test,
"Passed: 11 of 11 steps", in Chromium on the local site. `scripts/test-fake-site.js` and `scripts/test-named-reads.js` (30 of 30) after the opt-in change
to the mock. **Not run** (the final round runs them): `check:svelte`, `npm test`, `test:baseline`, `test:bundle`, `test:migration`, and a fresh
`package:release` to prove the package byte for byte. No application file changed, so none of them can have moved; the proof is the empty diff above.
