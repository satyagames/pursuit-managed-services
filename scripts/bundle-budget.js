// The page-size budgets and the "no export libraries on the participant page" rule, as data and one checking function, so
// scripts/test-bundle-budget.js can hold the real builds to them AND prove (negative controls) that the check can fail.
//
// Sizes are gzip -9 of the finished standalone page, in decimal kilobytes (1 kB = 1,000 B), the way PMS-IMPLEMENTATION-PLAN.md 4.3 (in git history at 7347c72) counts.

export const BUDGET = Object.freeze({
  /** The participant page's target. Over it is reported, not failed: the ceiling below is what fails. */
  participantTarget: 400_000,
  /** The participant page's hard ceiling. */
  participantCeiling: 450_000,
  /**
   * The admin page, which carries the Live display, the CSV, PDF and PowerPoint exports and (Phase 7b) the leader report with its two
   * embedded Open Sans faces. It is a facilitator's page and loads once a session; the page that matters is the participant page, which
   * stays at about 153.5 kB against its 400 kB target. Phase 7b left the admin page 1.1 kB under 600,000 B, which is inside the noise of
   * measuring gzip (the same file is about 599.6 kB with the system gzip and about 601.6 kB with another machine's zlib, so the old
   * budget could fail on a teammate's machine with no code change), and Phase 8 (accessibility fixes) needs room. Raised to 700,000 B in
   * Phase 7c. PowerPoint, both report faces and the jsPDF stubs are exactly as they were, and so is the way size is measured.
   */
  admin: 700_000,
});

/**
 * Phase 8 may add to the participant page the unsupported-browser notice and its script, and nothing else: at most 2,048 B gzip on top of
 * what the page was when Phase 7c ended. This is a separate rule from the ceiling above (which is not raised), checked by
 * scripts/test-bundle-budget.js on its own so that the negative controls for the ceiling stay what they were.
 */
export const PHASE_8 = Object.freeze({ participantBefore: 153_512, allowance: 2_048, participantAfter: 155_394 });

/**
 * Phase 9a (the independent review's fixes) may add to the participant page at most 2,048 B gzip on top of what it was when Phase 8
 * ended (155,394 B). What it adds: a way to begin a visit that makes one visit however often it is pressed (in the data service,
 * all of which the participant page carries), the removal of a cut-off QR try's track, the message for an expired sign-in and for
 * a page opened at the wrong address, an answer tile that falls back to its words, and sending unsaved answers again once the
 * server answers. Nothing was taken out to make room, and the ceiling above is not raised. The Phase 8 rule is kept as the record
 * of what that phase added (1,882 B); it can no longer be measured on its own, because the page has grown since.
 */
export const PHASE_9A = Object.freeze({ participantBefore: 155_394, allowance: 2_048, participantAfter: 156_606 });

/**
 * Phase 9b (the decided fixes) may add to the participant page at most 1,500 B gzip on top of where Phase 9a ended (156,606 B). What it adds: the
 * words for a damaged answer item and for a visit that is no longer on record, the tolerant answer readers and `removeEmptyVisit` in the data
 * service (all of which the participant page carries), and short reads; what it takes out: the drawn Kroger stand-in logo, which no Svelte page embeds
 * any more. The ceiling above is not raised, and the Phase 9a line is kept as the record of that phase (it can no longer be measured on its own).
 */
export const PHASE_9B = Object.freeze({ participantBefore: 156_606, allowance: 1_500, participantAfter: 157_359 });

/**
 * Phase 10b (deployment settings and the list namespace) may add to the participant page at most 1,500 B gzip on top of where Phase 9b
 * ended (157,359 B). What it adds: reading the settings file beside the page before anything else (one small request), deciding
 * which site and lists are this copy's (the rules of every setting, as yes or no), a short stop screen for a page that cannot tell,
 * the guard that refuses a request made before the page is set up, and the prefix and per-list titles in the data service (all of
 * which the participant page carries). What it takes out: public/config.js and the Phase 9a message for a page opened at an address
 * it was not built for, which the page's own address now settles. The six-part wording of each problem and the rules in words are
 * Setup's alone (lib/settings/deploy-problems.js, lib/settings/deploy-rules.js): they would not fit here. The ceiling above is not raised, and the
 * Phase 9b line is kept as the record of that phase (753 B; it can no longer be measured on its own). It ended at 158,807 B
 * (1,448 B; the assign fix that followed added nothing to this page).
 */
export const PHASE_10B = Object.freeze({ participantBefore: 157_359, allowance: 1_500, participantAfter: 158_807 });

/**
 * Phase 10c-1 (the clean break) may add NOTHING to the participant page: it only removes. It starts from where Phase 10b ended
 * (158,807 B) and ended at 157,460 B, 1,347 B smaller. What it took out: the three modules that inlined starter pictures from
 * public/assets/images (106 B), and, in the data service (all of which this page carries), the 16 exports that only the legacy pages
 * or nothing called, with the legacy upload and the several-answers writer only they reached (1,241 B). Seven more exports that no
 * page calls are still here, because tests of the pages use them (CLEAN-BREAK-10C1.md, part 5, in git history at 7347c72).
 * The next phase starts from `participantAfter`: its allowance is counted from the smaller page, not from the one before the break.
 */
export const PHASE_10C1 = Object.freeze({ participantBefore: 158_807, allowance: 0, participantAfter: 157_460 });

/**
 * Phase 10c-2a (what the new project no longer has) may add NOTHING to the participant page either. It starts from where Phase
 * 10c-1 ended (157,460 B) and ended at 155,669 B, 1,791 B smaller. What it took out of the data service (all of which this page
 * carries), as measured after each part: the seven exports that no page called (981 B), everything that read or cleared a
 * session's own answer item (548 B), ThemeConfig (151 B), and finding the live client through its session with the activities
 * that have no client (144 B). The query fixes then put 38 B back (a session's codes are read whole and `used` is tested in the
 * page, where the list used to be asked for `Used eq 'false'`), and the self-test's corrected sentence is 5 B shorter
 * (DROPS-10C2A.md, in git history at 7347c72). The next phase starts from `participantAfter`.
 */
export const PHASE_10C2A = Object.freeze({ participantBefore: 157_460, allowance: 0, participantAfter: 155_669 });

/**
 * Phase 10c-2b (one schema file, the PMS list names and schema v2) may add to the participant page at most 600 B gzip NET over where Phase
 * 10c-2a ended (155,669 B): the schema file (migration/src/lib/schema/pms-schema.js, which every page carries; pms-schema-meta.js is Setup's alone and a test
 * holds it out of this page) and the check of the lists' version on the AppSettings item. What it took out of the data layer, which this page
 * carries: the hand-kept maps (spLists, spAdded, the four kind sets, spBaseTypes, spBaseSpec, spTypeLabel), the optional-column code
 * (spRequireColumns), addedSharePointColumns and deleteClientTrack. It ended at 155,574 B, 95 B smaller (as measured after each part: C -110,
 * D -241, E +319, F -5, G -58). The next phase starts from `participantAfter`.
 */
export const PHASE_10C2B = Object.freeze({ participantBefore: 155_669, allowance: 600, participantAfter: 155_574 });

/**
 * Phase 10c-3 (Setup prepares a new site: the plan, Create, the version written last, Add an admin, the 255-character limit) may add NOTHING to the
 * participant page: it starts from where Phase 10c-2b ended (155,574 B). Everything that makes lists, marks a site ready, adds an admin or imports a
 * seed file is Setup's alone (lib/setup/provision.js, lib/setup/setup-admins.js, lib/setup/setup-import.js; scripts/test-bundle-budget.js holds them out of this page).
 * What it put in the data layer, which this page carries: sendToSharePoint (Setup's one way to write to the site, +49 B), the check that leaves
 * SharePoint's own Title alone (+6 B), addAdminUser, and the refusal of a single line over 255 characters before it is written (+133 B); what it took
 * out: the seed-file import, which moved to Setup (-442 B with addAdminUser). It ended at 155,320 B, 254 B smaller. The next phase starts from
 * `participantAfter`.
 */
export const PHASE_10C3 = Object.freeze({ participantBefore: 155_574, allowance: 0, participantAfter: 155_320 });

/**
 * Phase 10f (the sample clients get VJR's pictures; Design-Docs removed; the release package) may add NOTHING to the participant page or to the
 * admin page. It starts from where Phase 10c-3 ended (participant 155,320 B; admin 605,064 B, both measured in this checkout). The six pictures
 * and the seeding that uploads them are Setup's alone (lib/setup/sample-seed.js, lib/setup/sample-pictures.js, src/setup/sample-picture-data.ts;
 * scripts/test-bundle-budget.js holds them, and the bytes of every picture, out of the other two pages): a participant or a facilitator loads a
 * client's pictures from the picture library, as for any client. Setup grows by what the pictures weigh (they are already compressed, so gzip
 * gains little on them); `setupPictures` is the most that may be (about 1 MB, the brief's limit). The next phase starts from `participantAfter`.
 */
export const PHASE_10F = Object.freeze({ participantBefore: 155_320, adminBefore: 605_064, allowance: 0, participantAfter: 155_320, adminAfter: 605_064, setupPictures: 1_000_000 });

/**
 * Phase 10g (the settings file is `pms-config.txt`, the first finding from the real site) may add at most 100 B gzip to the participant page. It starts
 * from where Phase 10f ended (participant 155,320 B; admin 605,064 B, both measured in this checkout: a fresh checkout measures 11 B less, so the
 * allowance holds in both). The name is the one constant `SETTINGS_FILE`, three characters different and the same length as before; what the pages
 * gained is the HTTP status that goes with a web page, or text that is not JSON, found in the file's place (lib/settings/settings-file.js), so that Setup's
 * Details line can say what the site answered. The admin page carries the same reader and is held to the same allowance. The next phase starts from
 * `participantAfter`.
 */
export const PHASE_10G = Object.freeze({ participantBefore: 155_320, adminBefore: 605_064, allowance: 100, participantAfter: 155_328, adminAfter: 605_066 });

/**
 * Phase 10h (three fixes from the first real-site run) may add at most 300 B gzip to the participant page in its parts A and B together, and the admin
 * page is held to the same: every item read names its columns (pms-schema.js `selectOf`, used by every address of an item read in dataService.js),
 * a create's reply is completed from what was written, and a duplicate refused with 500 is still a duplicate. It starts from where Phase 10g ended
 * (participant 155,328 B, admin 605,066 B, in this checkout). Its parts C to F add nothing to the participant page; part D adds 8 B to the admin page
 * (two sentences that named the lists of before take their titles from the schema file). `participantAfter` and `adminAfter` are the pages as
 * measured when the phase ended; the next phase starts from them.
 */
export const PHASE_10H = Object.freeze({ participantBefore: 155_328, adminBefore: 605_066, allowance: 300, participantAfter: 155_495, adminAfter: 605_202 });

/**
 * Phase 10i (a column SharePoint will not return by name: schema version 3, GuestName and SignedInName in place of DisplayName) may add at most
 * 100 B gzip to the participant page, and the admin page is held to the same. The pages carry the new column names and the version (pms-schema.js);
 * everything else of the phase (Setup raising a version-2 site, the self-test's probe) is Setup's alone. It starts from where Phase 10h ended
 * (participant 155,495 B, admin 605,202 B, in this checkout). `participantAfter` and `adminAfter` are the pages as measured when the phase ended;
 * the next phase starts from them.
 */
export const PHASE_10I = Object.freeze({ participantBefore: 155_495, adminBefore: 605_202, allowance: 100, participantAfter: 155_503, adminAfter: 605_208 });

/**
 * Phase 10j (fewer waits on the participant page: the column check names its properties, a visit begins in two rounds, the first screen waits for
 * two, and the hub and the activities open from what the page holds) may add at most 2,000 B gzip to the participant page, and the admin page is
 * held to the same. It starts from where Phase 10i ended (participant 155,503 B, admin 605,208 B, in this checkout). `participantAfter` and
 * `adminAfter` are the pages as measured when the phase ended; the next phase starts from them.
 */
export const PHASE_10J = Object.freeze({ participantBefore: 155_503, adminBefore: 605_208, allowance: 2_000, participantAfter: 156_710, adminAfter: 606_141 });

/**
 * Phase 11a (the Results charts, drawn by hand in Deloitte's colours, with names on the admin view) may not change the participant page at all:
 * allowance 0, and the page's Tailwind utility rules are exactly the ones it had (`participantUtilities`). Tailwind reads every file under
 * migration/ for class names, comments and words a page shows included, so a word in a new admin file could add a rule to the participant page, and
 * removing a file could take one away (the Live display's old card held "container"): the list catches both, whatever the line endings of the
 * checkout. The admin page may not grow past where Phase 10j left it: the charts replaced Chart.js, and it is about 54 kB smaller. It starts from
 * where Phase 10j ended (participant 156,710 B, admin 606,141 B, in this checkout); `participantAfter` and `adminAfter` are the pages when 11a ended.
 */
export const PHASE_11A = Object.freeze({
  participantBefore: 156_710, adminBefore: 606_141, allowance: 0, participantAfter: 156_710, adminAfter: 552_083,
  participantUtilities: Object.freeze(['backdrop-filter', 'block', 'border', 'border-collapse', 'collapse', 'container', 'contents', 'filter', 'fixed', 'flex', 'flex-wrap', 'grid', 'hidden', 'inline', 'invert', 'italic', 'outline', 'relative', 'resize', 'ring', 'rounded', 'shadow', 'shrink', 'sr-only', 'static', 'sticky', 'text-wrap', 'transform', 'transition', 'visible']),
});

/**
 * Phase 11a-3 (the polish batch after the 11a-2 real-site checks) changes the participant page on purpose (a locked activity's title in white, and
 * what VJR decides on the greeting and the hero pictures), so it has a rule of its own rather than a looser 11a: at most 500 B gzip over where
 * Phase 11a left it, and the page's Tailwind utility rules still exactly the ones it had (`participantUtilities`, 11a's list). The admin page is
 * held to the same allowance. It starts from the pages of pms-283ad18, the package on the real site when it began (commit 3a8b32b, measured in
 * Satyadev's checkout with Node 22: participant 156,695 B, admin 553,987 B). Phase 11a-2 grew the admin page by about 2,158 B and recorded no
 * figure here (11a's 552,083 B is the admin page before 11a-2), so 11a-3 is measured from the deployed pages, not from 11a's. `participantAfter`
 * and `adminAfter` are the pages when the phase ended (+34 B and +276 B); the next phase starts from them.
 */
export const PHASE_11A3 = Object.freeze({
  participantBefore: 156_695, adminBefore: 553_987, allowance: 500, participantAfter: 156_729, adminAfter: 554_263,
  participantUtilities: PHASE_11A.participantUtilities,
});

/**
 * Phase 11b (the leader report and the Live display's one-page PDF and PowerPoint on the chart model and the Results palette) changes the admin page
 * only: the participant page must be BYTE FOR BYTE what Phase 11a-3 left (`participantSha256`, the SHA-256 of index.html as the brief recorded it at
 * e2fbfb6, and its Tailwind rules 11a's), and the admin page may grow by at most `adminAllowance` over where 11a-3 left it (554,263 B): the files'
 * new drawing (lib/results/results-chart-figure.js, lib/results/results-palette.js and results-tokens.css as text) is the admin page's, and stays far under its
 * 700,000 B budget. `participantAfter` and `adminAfter` are the pages when the phase ended; the next phase starts from them.
 */
export const PHASE_11B = Object.freeze({
  participantBefore: PHASE_11A3.participantAfter, adminBefore: PHASE_11A3.adminAfter, participantAllowance: 0, adminAllowance: 12_000,
  participantSha256: 'f7fbfd67f27fe80da8c81746bcb3f871b09586b82cdd7f309d7c98928df75ef8',
  participantAfter: 156_729, adminAfter: 558_745,
  participantUtilities: PHASE_11A.participantUtilities,
});

/**
 * Phase 12, Part 2 (the fixes approved from UX-REVIEW.md) changes both pages a little: the participant page gets the measured fallback face for Open Sans
 * (Open Sans stays embedded), a chosen answer's ring and badge, a plate behind tile pictures, the phone's bar, a switched-off button's edge, "Loading...",
 * clearing confetti when an activity opens and two lines in its head; the admin page the PIN screen's words, the wall's notice, Results' order, the chart
 * tags and Content's columns. Each page may grow by at most its allowance over where 11b left it, and the participant page keeps 11a's Tailwind rules.
 * `participantAfter` and `adminAfter` are the pages when the phase ended (this checkout, gzip -9); the next phase starts from them.
 */
export const PHASE_12 = Object.freeze({
  participantBefore: PHASE_11B.participantAfter, adminBefore: PHASE_11B.adminAfter, participantAllowance: 600, adminAllowance: 1_000,
  participantAfter: 156_998, adminAfter: 559_085,
  participantUtilities: PHASE_11A.participantUtilities,
});

/**
 * Phase 13 (the Results exports redesigned for leadership, EXPORT-DESIGN.md) changes the admin page alone: the leader report's "At a glance" and activity
 * pages, the summary pack (lib/results/export-summary.js, the pack's layout and its two writers in migration/src/lib/exports/resultsExport.js) and the summary CSV. The participant
 * page does not change, byte for byte (its SHA-256 is the deployed pms-d19bd14 page's), with 11a's Tailwind rules; the admin page may grow by at most
 * its allowance over where 12 left it, and stays under its 700,000 B budget. `adminAfter` is the page when the phase ended (this checkout); the next phase
 * starts from it.
 */
export const PHASE_13 = Object.freeze({
  participantBefore: PHASE_12.participantAfter, adminBefore: PHASE_12.adminAfter, participantAllowance: 0, adminAllowance: 12_000,
  participantSha256: '9cae99e5bf091d27acabc75a4a469c6a5bc7995d6ef28237594daa5c1bca3557',
  participantAfter: PHASE_12.participantAfter, adminAfter: 562_606,
  participantUtilities: PHASE_11A.participantUtilities,
});

/**
 * The class names of the Tailwind utility rules in a built page (its `@layer utilities` block), sorted, each once.
 * @param {string} html
 */
export function utilityClasses(html) {
  const start = html.indexOf('@layer utilities{');
  if (start < 0) return [];
  let depth = 0;
  let end = start;
  for (let at = start + '@layer utilities'.length; at < html.length; at += 1) {
    if (html[at] === '{') depth += 1;
    else if (html[at] === '}') { depth -= 1; if (depth === 0) { end = at; break; } }
  }
  return [...new Set([...html.slice(start, end + 1).matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)(?=[{:,\s])/g)].map((match) => match[1]))].sort();
}

/**
 * What must not be anywhere in the participant page. Each library has the strings that survive minification: a class or property
 * name the library keeps (jsPDF, PptxGenJS, html2canvas, Chart.js's `_chartjs` key), and the module ids the bundler reports.
 */
export const FORBIDDEN = Object.freeze([
  { library: 'jsPDF', text: /jsPDF/, module: /node_modules\/jspdf\// },
  { library: 'PptxGenJS', text: /PptxGenJS/, module: /node_modules\/pptxgenjs\// },
  { library: 'html2canvas', text: /html2canvas/, module: /node_modules\/html2canvas\// },
  { library: 'the vendored chart library (Chart.js)', text: /_chartjs|chartjs-/, module: /node_modules\/chart\.js\// },
  { library: 'the export writer (migration/src/lib/exports/resultsExport.js)', text: null, module: /migration\/src\/lib\/exports\/resultsExport\.js$/ },
  // Phase 11a: the Results charts (drawn by hand: no chart library is in any page since then) and their model are the admin page's alone. They
  // replaced public/js/resultsRenderer.js, which drew with Chart.js, and the Live display's question card that used it (ResultQuestion).
  { library: 'the Results charts (admin/charts, lib/results/results-chart-model.js)', text: /Words that came up most/, module: /migration\/src\/admin\/charts\/|migration\/src\/lib\/results\/results-chart-model\.js$/ },
  // Phase 7b: the leader report, its writer, and the TrueType faces it embeds (26 kB), are the admin page's alone.
  { library: 'the leader report (lib/exports/leader-report*.js)', text: /How the numbers are counted/, module: /migration\/src\/lib\/exports\/leader-report[^/]*\.js$/ },
  { library: 'the leader report\'s embedded fonts (report-fonts)', text: /OpenSans-Regular/, module: /report-fonts(?:\.js|\/open-sans-report\.js)$/ },
  { library: 'the leader report buttons (ReportExports)', text: null, module: /ReportExports\.svelte$/ },
]);

/**
 * @param {{ participantGzip: number, adminGzip: number, participantHtml: string, participantModules?: string[] }} measured
 * @returns {string[]} one sentence for each rule broken; empty when every budget holds
 */
export function checkBudgets({ participantGzip, adminGzip, participantHtml, participantModules = [] }) {
  const broken = [];
  if (participantGzip > BUDGET.participantCeiling) {
    broken.push(`The participant page is ${participantGzip.toLocaleString('en-US')} B gzip, over its ${BUDGET.participantCeiling.toLocaleString('en-US')} B ceiling.`);
  }
  if (adminGzip > BUDGET.admin) {
    broken.push(`The admin page is ${adminGzip.toLocaleString('en-US')} B gzip, over its ${BUDGET.admin.toLocaleString('en-US')} B budget.`);
  }
  for (const { library, text, module } of FORBIDDEN) {
    if (text && text.test(participantHtml)) broken.push(`The participant page contains ${library} (found in the page text).`);
    const found = participantModules.find((id) => module.test(id.replaceAll('\\', '/')));
    if (found) broken.push(`The participant page bundles ${library} (module ${found}).`);
  }
  return broken;
}

/**
 * Phase 14 changed the structure of the code and the documents, and no page: the participant and the admin page are byte for byte the pages
 * Phase 13 left (pms-757be5c's, as the baseline package pms-1ab63bd measured them), and neither may grow in this phase. The next phase starts
 * from participantAfter and adminAfter.
 */
export const PHASE_14 = Object.freeze({
  participantBefore: PHASE_13.participantAfter, adminBefore: PHASE_13.adminAfter, participantAllowance: 0, adminAllowance: 0,
  participantSha256: PHASE_13.participantSha256,
  adminSha256: '04e64562f598981d3ee6dc1eb846395e1cbf0432c9df69c0cd755023fb230c1b',
  participantAfter: PHASE_13.participantAfter, adminAfter: PHASE_13.adminAfter,
});

/**
 * Phase 15 (alignment, the motion system and the client's Animations switch) changed the participant page on purpose: it carries
 * lib/motion/ (the plan and the engine, about 2.2 kB gzip) and lib/motion/motion-tokens.css, and no longer the legacy motion sheet
 * (styles/legacy/vfx.css), so its CSS is smaller than before; its Tailwind rules are the ones it had. The admin page carries the same
 * motion files for Brand Studio's preview, the switch and the client writer. Measured when the phase ended; the next phase starts from
 * participantAfter and adminAfter.
 */
export const PHASE_15 = Object.freeze({
  participantBefore: PHASE_14.participantAfter, adminBefore: PHASE_14.adminAfter, participantAllowance: 2_000, adminAllowance: 8_000,
  participantAfter: 158_965, adminAfter: 569_520,
  participantUtilities: PHASE_11A.participantUtilities,
});

/**
 * Phase 16 (Results newest first, Delete session..., questions edited in place) is admin work. The participant page carries every export of the
 * data service, which no build leaves out, so the two small generic calls Delete session needs (dataService.listItemKeys and deleteByKey) are on
 * it too, about 130 B gzip: the rules of the delete (lib/admin/session-delete.js) and every screen change are the admin page's alone. Its
 * Tailwind rules are the ones it had, and the ceiling is not raised. Measured when the phase ended; the next phase starts from participantAfter
 * and adminAfter.
 */
export const PHASE_16 = Object.freeze({
  participantBefore: PHASE_15.participantAfter, adminBefore: PHASE_15.adminAfter, participantAllowance: 200, adminAllowance: 12_000,
  participantAfter: 159_093, adminAfter: 576_279,
  participantUtilities: PHASE_11A.participantUtilities,
});

/**
 * Phase 17 (a refactor with no change of behaviour) may not grow the participant page: its allowance is 0. lib/data/dataService.js became a facade
 * over sixteen parts, every function moved unchanged; the bundler lays the same code out in another order, which cost 40 B gzip on the
 * participant page (22 B raw: core.js's holdScan() and the seams between the parts). The 72 selectors that nothing can match left
 * styles/legacy/app.css (participant), styles/legacy/admin.css and src/admin.css (admin, Setup): with Parts 1 and 3 (pms-7417da3) the participant
 * page was 701 B smaller than Phase 16 left it, the admin page 186 B, Setup 315 B. Its Tailwind rules are the ones it had, and the ceiling is
 * not raised. Its Part 2 cut the admin's Today, Live display and Brand Studio screens into thirteen child components: each is a function of its
 * own with its own scoped styles (a few rules in two of them, word for word), 2,108 B gzip in all on the admin page, which alone carries them
 * (adminAllowance); the participant page stayed byte for byte as it was. Measured when the phase ended: participantAfter and adminAfter, where
 * the next phase starts.
 */
export const PHASE_17 = Object.freeze({
  participantBefore: PHASE_16.participantAfter, adminBefore: PHASE_16.adminAfter, participantAllowance: 0, adminAllowance: 2_000,
  participantAfter: 158_392, adminAfter: 578_201,
  participantUtilities: PHASE_11A.participantUtilities,
});
