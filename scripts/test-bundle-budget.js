import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { PAGES, ROOT, analyzePage } from './analyze-bundle.js';
import { BUDGET, FORBIDDEN, PHASE_8, PHASE_9A, PHASE_9B, PHASE_10B, PHASE_10C1, PHASE_10C2A, PHASE_10C2B, PHASE_10C3, PHASE_10F, PHASE_10G, PHASE_10H, PHASE_10I, PHASE_10J, PHASE_11A, PHASE_11A3, PHASE_11B, PHASE_12, PHASE_13, PHASE_14, checkBudgets, utilityClasses } from './bundle-budget.js';
import { SAMPLE_PICTURE_NAMES } from '../migration/src/lib/setup/sample-pictures.js';
import { pageProblems } from './release-proofs.js';

// Phase 7: the participant page must stay small (it is what ten iPads load over one SharePoint account), and nothing that only the
// facilitator uses may be in it. This builds the three real pages into a scratch folder (never build-svelte/release), holds them to the
// budgets in scripts/bundle-budget.js, and then shows the check CAN fail: with the export libraries put into a real participant build,
// with the admin page's own text standing in for the participant page, and with sizes just over each limit.

let outRoot;
const built = {};
const page = (name) => PAGES.find((entry) => entry.name === name);

before(async () => {
  outRoot = await mkdtemp(path.join(os.tmpdir(), 'cec-bundle-budget-'));
  for (const entry of PAGES) built[entry.name] = await analyzePage(entry, { outRoot, keepHtml: true });
}, { timeout: 300_000 });

after(async () => { await rm(outRoot, { recursive: true, force: true }); });

/** "23.4%": how far under `limit` a size is, as a share of the limit. */
const headroom = (size, limit) => `${(((limit - size) / limit) * 100).toFixed(1)}%`;
const bytes = (value) => `${value.toLocaleString('en-US')} B`;

const measured = () => ({
  participantGzip: built.participant.htmlGzip,
  adminGzip: built.admin.htmlGzip,
  participantHtml: built.participant.html,
  participantModules: built.participant.modules.map((module) => module.id),
});

describe('the page budgets', () => {
  it('holds the real builds: participant under its ceiling, admin under its budget, and no export library on the participant page', () => {
    assert.deepEqual(checkBudgets(measured()), []);
  });

  it('reports the figures (and says whether the participant page meets its 400 kB target)', (t) => {
    const lines = Object.values(built).map((result) => `${result.name}: ${bytes(result.htmlGzip)} gzip -9 (${bytes(result.htmlBytes)} raw)`);
    t.diagnostic(lines.join('; '));
    // Printed as well as diagnosed, so that the next session sees how much room each page has whatever the reporter shows.
    const participant = built.participant.htmlGzip;
    const admin = built.admin.htmlGzip;
    console.log([
      '',
      'Page sizes, gzip -9 of the finished standalone page, against their budgets:',
      `  participant  ${bytes(participant).padStart(10)}   ${headroom(participant, BUDGET.participantTarget).padStart(6)} under its ${bytes(BUDGET.participantTarget)} target, ${headroom(participant, BUDGET.participantCeiling)} under its ${bytes(BUDGET.participantCeiling)} ceiling`,
      `  admin        ${bytes(admin).padStart(10)}   ${headroom(admin, BUDGET.admin).padStart(6)} under its ${bytes(BUDGET.admin)} budget (${bytes(BUDGET.admin - admin)} of room)`,
      `  setup        ${bytes(built.setup.htmlGzip).padStart(10)}   (no budget)`,
    ].join('\n'));
    if (participant > BUDGET.participantTarget) t.diagnostic(`The participant page is over its ${bytes(BUDGET.participantTarget)} target (the ceiling still holds).`);
    assert.ok(participant > 20_000, 'a participant page of nearly nothing means the build is not what it should be');
    assert.ok(admin > participant, 'the admin page carries the exports, so it is the larger');
  });

  it('keeps the participant bundle free of every module the facilitator alone uses (by the modules the bundler reports)', () => {
    const ids = built.participant.modules.map((module) => module.id);
    for (const { library, module } of FORBIDDEN) assert.equal(ids.some((id) => module.test(id)), false, `${library} is in the participant bundle`);
  });

  it('does carry the exports on the admin page: PDF, PowerPoint and the Results charts, nothing dropped, and no chart library', () => {
    const ids = built.admin.modules.map((module) => module.id);
    for (const part of ['node_modules/jspdf/', 'node_modules/pptxgenjs/', 'migration/src/lib/exports/resultsExport.js', 'migration/src/admin/charts/ResultCard.svelte', 'migration/src/lib/results/results-chart-model.js']) {
      assert.ok(ids.some((id) => id.replaceAll('\\', '/').includes(part)), `${part} is on the admin page`);
    }
    for (const marker of [/jsPDF/, /PptxGenJS/, /Words that came up most/]) assert.match(built.admin.html, marker);
    // Phase 11a: the charts are drawn by hand (SVG and HTML); Chart.js, which the Live display drew with until then, is in no page.
    assert.ok(!ids.some((id) => id.includes('node_modules/chart.js/')), 'Chart.js is not on the admin page');
    assert.doesNotMatch(built.admin.html, /_chartjs|chartjs-/);
  });

  it('carries the leader report on the admin page, with its two faces, and none of it on the participant page', () => {
    const ids = built.admin.modules.map((module) => module.id);
    for (const part of ['lib/exports/leader-report.js', 'lib/exports/leader-report-layout.js', 'lib/exports/leader-report-pdf.js', 'lib/exports/leader-report-data.js', 'lib/exports/report-fonts.js', 'assets/report-fonts/open-sans-report.js', 'admin/ReportExports.svelte', 'lib/results/export-summary.js']) {
      assert.ok(ids.some((id) => id.endsWith(part)), `${part} is on the admin page`);
    }
    // (Phase 13: "Participant answers (CSV)" is "All answers (CSV)", and "Summary by activity (CSV)" is beside it.)
    for (const marker of [/How the numbers are counted/, /OpenSans-Regular/, /OpenSans-Bold/, /Leader report \(PDF\)/, /Summary by activity \(CSV\)/, /All answers \(CSV\)/, /What each activity found/]) {
      assert.match(built.admin.html, marker);
      assert.doesNotMatch(built.participant.html, marker);
    }
  });

  it('is honest about what the admin build leaves out: only jsPDF\'s HTML and SVG paths, which no export calls', async () => {
    const source = await readFile(path.join(ROOT, 'migration/src/lib/exports/resultsExport.js'), 'utf8');
    // The admin build stubs html2canvas, canvg and dompurify (migration/vite.admin.config.ts); these are the calls that need them.
    assert.doesNotMatch(source, /\.html\(|addSvgAsImage|\.svg\(|html2canvas|canvg|dompurify/i, 'resultsExport.js must not use what the admin build stubs');
    for (const file of ['leader-report-pdf.js', 'leader-report-layout.js', 'leader-report.js', 'report-fonts.js']) {
      const report = await readFile(path.join(ROOT, 'migration/src/lib/exports', file), 'utf8');
      assert.doesNotMatch(report, /\.html\(|addSvgAsImage|\.svg\(|html2canvas|canvg|dompurify/i, `${file} must not use what the admin build stubs`);
    }
    const ids = built.admin.modules.map((module) => module.id);
    assert.ok(ids.some((id) => id.endsWith('export-stubs-unavailable.js')), 'the stub is what the page carries');
    assert.equal(ids.some((id) => /node_modules\/(html2canvas|canvg|dompurify)\//.test(id)), false);
  });
});

// Phase 10c-2b: the schema's names (migration/src/lib/schema/pms-schema.js) are in every page; everything else about the lists (pms-schema-meta.js: what
// each list and column is for, its type in words, who uses it, whether it is personal data) is Setup's alone.
describe('Phase 10c-2b: the schema\'s descriptions are on the Setup page only', () => {
  it('no sentence of pms-schema-meta.js is in the participant page or the admin page, and Setup carries them (the check can fail)', async () => {
    const { META } = await import('../migration/src/lib/schema/pms-schema-meta.js');
    // Every list's purpose and every column's: sentences long enough that they could not be in a page by chance, as the bundler writes
    // a string (an apostrophe may be escaped). (AppId's are made up as the file is read, from a few words each: left out.)
    const sentences = [...Object.values(META).flatMap((list) => [list.purpose,
      ...Object.entries(list.columns).filter(([name]) => name !== 'AppId').map(([, column]) => column.purpose)])];
    assert.ok(sentences.length > 80, `${sentences.length} sentences`);
    const inPage = (html, sentence) => html.includes(sentence) || html.includes(sentence.replaceAll("'", "\\'")) || html.includes(sentence.replaceAll("'", '&#39;'));
    for (const page of ['participant', 'admin']) {
      const found = sentences.filter((sentence) => inPage(built[page].html, sentence));
      assert.deepEqual(found, [], `pms-schema-meta.js is on the ${page} page`);
      assert.ok(!built[page].modules.some((module) => /pms-schema-meta\.js$/.test(module.id.replaceAll('\\', '/'))), `the ${page} page bundles pms-schema-meta.js`);
    }
    assert.ok(sentences.every((sentence) => inPage(built.setup.html, sentence)), 'the Setup page carries all of them: the check finds them where they are');
    assert.ok(built.participant.modules.some((module) => /pms-schema\.js$/.test(module.id.replaceAll('\\', '/'))), 'and every page carries the names');
  });
});

describe('Phase 8: the unsupported-browser notice, and nothing of the test tools, in the built pages', () => {
  it('grew the participant page by at most 2,048 B gzip over where Phase 7c left it (153,512 B): 1,882 B, as measured when Phase 8 ended', () => {
    // The page has grown since (Phase 9a, below), so this is the record of that phase and no longer a measurement of this build.
    assert.equal(PHASE_8.participantAfter - PHASE_8.participantBefore, 1_882);
    assert.ok(PHASE_8.participantAfter - PHASE_8.participantBefore <= PHASE_8.allowance);
    assert.equal(PHASE_9A.participantBefore, PHASE_8.participantAfter, 'Phase 9a is measured from where Phase 8 ended');
  });

  it('Phase 9a (the review\'s fixes) grew the participant page by at most 2,048 B gzip over where Phase 8 left it (155,394 B): 1,212 B, as measured when 9a ended', () => {
    // The page has grown since (Phase 9b, below), so this is the record of that phase and no longer a measurement of this build.
    assert.equal(PHASE_9A.participantAfter - PHASE_9A.participantBefore, 1_212);
    assert.ok(PHASE_9A.participantAfter - PHASE_9A.participantBefore <= PHASE_9A.allowance);
    assert.equal(PHASE_9B.participantBefore, PHASE_9A.participantAfter, 'Phase 9b is measured from where Phase 9a ended');
  });

  it('Phase 9b (the decided fixes) grew the participant page by at most 1,500 B gzip over where Phase 9a left it (156,606 B): 753 B, as measured when 9b ended', () => {
    // The page has grown since (Phase 10b, below), so this is the record of that phase and no longer a measurement of this build.
    assert.equal(PHASE_9B.participantAfter - PHASE_9B.participantBefore, 753);
    assert.ok(PHASE_9B.participantAfter - PHASE_9B.participantBefore <= PHASE_9B.allowance);
    assert.equal(PHASE_10B.participantBefore, PHASE_9B.participantAfter, 'Phase 10b is measured from where Phase 9b ended');
  });

  it('Phase 10b (deployment settings and the list namespace) grew the participant page by at most 1,500 B gzip over where Phase 9b left it (157,359 B): 1,448 B, as measured when 10b ended', () => {
    // The page has shrunk since (Phase 10c-1, below), so this is the record of that phase and no longer a measurement of this build.
    assert.equal(PHASE_10B.participantAfter - PHASE_10B.participantBefore, 1_448);
    assert.ok(PHASE_10B.participantAfter - PHASE_10B.participantBefore <= PHASE_10B.allowance);
    assert.equal(PHASE_10C1.participantBefore, PHASE_10B.participantAfter, 'Phase 10c-1 is measured from where Phase 10b ended');
  });

  it('Phase 10c-1 (the clean break) added nothing to the participant page: it is no larger than where Phase 10b left it (158,807 B), and ended 1,347 B smaller', (t) => {
    assert.equal(PHASE_10C1.allowance, 0, 'a phase that only removes has no allowance');
    assert.equal(PHASE_10C1.participantBefore - PHASE_10C1.participantAfter, 1_347, 'as measured when 10c-1 ended: the next phase starts from the smaller page');
    const grown = built.participant.htmlGzip - PHASE_10C1.participantBefore;
    const since = built.participant.htmlGzip - PHASE_10C1.participantAfter;
    t.diagnostic(`the participant page is ${bytes(built.participant.htmlGzip)}: ${grown >= 0 ? '+' : ''}${grown} B against where Phase 10b ended, ${since >= 0 ? '+' : ''}${since} B against where Phase 10c-1 ended`);
    console.log(`  Phase 10c-1: the participant page is ${grown >= 0 ? '+' : ''}${grown} B gzip against where Phase 10b ended (allowance ${PHASE_10C1.allowance} B), and ${since >= 0 ? '+' : ''}${since} B against where 10c-1 ended (${bytes(PHASE_10C1.participantAfter)}); now ${bytes(built.participant.htmlGzip)}`);
    assert.ok(grown <= PHASE_10C1.allowance, `the participant page is ${grown} B larger than before the clean break, which only removes`);
  });

  it('Phase 10c-2a (what the new project no longer has) added nothing to the participant page: as measured when it ended, no larger than where Phase 10c-1 left it (157,460 B), and 1,791 B smaller', () => {
    assert.equal(PHASE_10C2A.participantBefore, PHASE_10C1.participantAfter, 'Phase 10c-2a is measured from where Phase 10c-1 ended');
    assert.equal(PHASE_10C2A.allowance, 0, 'a phase that only removes has no allowance');
    assert.equal(PHASE_10C2A.participantBefore - PHASE_10C2A.participantAfter, 1_791, 'as measured when 10c-2a ended: the next phase starts from the smaller page');
    // (This test compared the build in the tree with those figures until Phase 10j, whose allowance goes past them: the newest phase's test below holds the build now.)
  });

  it('Phase 10c-2b (one schema file, the PMS names, schema v2 and its version check) grew the participant page by at most 600 B gzip net over where Phase 10c-2a left it (155,669 B): as measured when it ended', () => {
    assert.equal(PHASE_10C2B.participantBefore, PHASE_10C2A.participantAfter, 'Phase 10c-2b is measured from where Phase 10c-2a ended');
    assert.equal(PHASE_10C2B.allowance, 600);
    assert.ok(PHASE_10C2B.participantAfter - PHASE_10C2B.participantBefore <= PHASE_10C2B.allowance, 'as measured when 10c-2b ended');
    // (This test compared the build in the tree with those figures until Phase 10j, whose allowance goes past them: the newest phase's test below holds the build now.)
  });

  it('Phase 10c-3 (Setup prepares a new site) added nothing to the participant page: as measured when it ended, no larger than where Phase 10c-2b left it (155,574 B)', () => {
    assert.equal(PHASE_10C3.participantBefore, PHASE_10C2B.participantAfter, 'Phase 10c-3 is measured from where Phase 10c-2b ended');
    assert.equal(PHASE_10C3.allowance, 0, 'everything Setup does is Setup\'s alone');
    assert.ok(PHASE_10C3.participantAfter - PHASE_10C3.participantBefore <= PHASE_10C3.allowance, 'as measured when 10c-3 ended');
    // (This test compared the build in the tree with those figures until Phase 10j, whose allowance goes past them: the newest phase's test below holds the build now.)
  });

  it('Phase 10f (the sample pictures) added nothing to the participant page or the admin page: as measured when it ended, no larger than where Phase 10c-3 left them', () => {
    assert.equal(PHASE_10F.participantBefore, PHASE_10C3.participantAfter, 'Phase 10f is measured from where Phase 10c-3 ended');
    assert.equal(PHASE_10F.allowance, 0, 'the pictures and the seeding that uploads them are Setup\'s alone');
    assert.ok(PHASE_10F.participantAfter - PHASE_10F.participantBefore <= PHASE_10F.allowance, 'the participant page, as measured when 10f ended');
    assert.ok(PHASE_10F.adminAfter - PHASE_10F.adminBefore <= PHASE_10F.allowance, 'the admin page, as measured when 10f ended');
    // (This test compared the build in the tree with those figures until Phase 10g, whose allowance is not 0: the newest phase's test below holds the build now.)
  });

  it('Phase 10g (the settings file is pms-config.txt) grew the participant page by at most 100 B gzip over where Phase 10f left it (155,320 B), and the admin page by the same: as measured when it ended', () => {
    assert.equal(PHASE_10G.participantBefore, PHASE_10F.participantAfter, 'Phase 10g is measured from where Phase 10f ended');
    assert.equal(PHASE_10G.adminBefore, PHASE_10F.adminAfter);
    assert.equal(PHASE_10G.allowance, 100);
    assert.ok(PHASE_10G.participantAfter - PHASE_10G.participantBefore <= PHASE_10G.allowance, 'the participant page, as measured when 10g ended');
    assert.ok(PHASE_10G.adminAfter - PHASE_10G.adminBefore <= PHASE_10G.allowance, 'the admin page, as measured when 10g ended');
    // (This test compared the build in the tree with those figures until Phase 10h: the newest phase's test below holds the build now.)
  });

  it('Phase 10h (three fixes from the first real-site run) grew the participant page by at most 300 B gzip over where Phase 10g left it (155,328 B), and the admin page by the same: as measured when it ended', () => {
    assert.equal(PHASE_10H.participantBefore, PHASE_10G.participantAfter, 'Phase 10h is measured from where Phase 10g ended');
    assert.equal(PHASE_10H.adminBefore, PHASE_10G.adminAfter);
    assert.equal(PHASE_10H.allowance, 300);
    assert.ok(PHASE_10H.participantAfter - PHASE_10H.participantBefore <= PHASE_10H.allowance, 'the participant page, as measured when 10h ended');
    assert.ok(PHASE_10H.adminAfter - PHASE_10H.adminBefore <= PHASE_10H.allowance, 'the admin page, as measured when 10h ended');
    // (This test compared the build in the tree with those figures until Phase 10i: the newest phase's test below holds the build now.)
  });

  it('Phase 10i (schema version 3: GuestName and SignedInName) grew the participant page by at most 100 B gzip over where Phase 10h left it (155,495 B), and the admin page by the same: as measured when it ended', () => {
    assert.equal(PHASE_10I.participantBefore, PHASE_10H.participantAfter, 'Phase 10i is measured from where Phase 10h ended');
    assert.equal(PHASE_10I.adminBefore, PHASE_10H.adminAfter);
    assert.equal(PHASE_10I.allowance, 100);
    assert.ok(PHASE_10I.participantAfter - PHASE_10I.participantBefore <= PHASE_10I.allowance, 'the participant page, as measured when 10i ended');
    assert.ok(PHASE_10I.adminAfter - PHASE_10I.adminBefore <= PHASE_10I.allowance, 'the admin page, as measured when 10i ended');
    // (This test compared the build in the tree with those figures until Phase 10j: the newest phase's test below holds the build now.)
  });

  it('Phase 10j (fewer waits on the participant page) grew the participant page by at most 2,000 B gzip over where Phase 10i left it (155,503 B), and the admin page by the same', () => {
    assert.equal(PHASE_10J.participantBefore, PHASE_10I.participantAfter, 'Phase 10j is measured from where Phase 10i ended');
    assert.equal(PHASE_10J.adminBefore, PHASE_10I.adminAfter);
    assert.equal(PHASE_10J.allowance, 2_000);
    assert.ok(PHASE_10J.participantAfter - PHASE_10J.participantBefore <= PHASE_10J.allowance, 'the participant page, as measured when 10j ended');
    assert.ok(PHASE_10J.adminAfter - PHASE_10J.adminBefore <= PHASE_10J.allowance, 'the admin page, as measured when 10j ended');
  });

  it('Phase 11a (the Results charts) left the participant page as it was, to its Tailwind rules, and the admin page no larger than Phase 10j left it: as measured when it ended', () => {
    assert.equal(PHASE_11A.participantBefore, PHASE_10J.participantAfter, 'Phase 11a is measured from where Phase 10j ended');
    assert.equal(PHASE_11A.adminBefore, PHASE_10J.adminAfter);
    assert.equal(PHASE_11A.allowance, 0);
    assert.ok(PHASE_11A.participantAfter <= PHASE_11A.participantBefore, 'the participant page, as measured when 11a ended');
    assert.ok(PHASE_11A.adminAfter <= PHASE_11A.adminBefore, 'the admin page, as measured when 11a ended');
    // (This test compared the build in the tree with those figures until Phase 11a-3: the newest phase's test below holds the build now.)
  });

  it('Phase 11a-3 (the polish batch) grew the participant page by at most 500 B gzip over the deployed pms-283ad18 (156,695 B), to the same Tailwind rules, and the admin page by the same (553,987 B): as measured when it ended', () => {
    // (Measured from pms-283ad18, commit 3a8b32b: Phase 11a-2 grew the admin page after 11a recorded its figures, and recorded none of its own.)
    assert.equal(PHASE_11A3.participantBefore, 156_695);
    assert.equal(PHASE_11A3.adminBefore, 553_987);
    assert.ok(Math.abs(PHASE_11A3.participantBefore - PHASE_11A.participantAfter) < 100, 'the participant page did not change in 11a-2: the two figures differ only by where they were measured');
    assert.ok(PHASE_11A3.participantAfter - PHASE_11A3.participantBefore <= PHASE_11A3.allowance, 'the participant page, as measured when 11a-3 ended');
    assert.ok(PHASE_11A3.adminAfter - PHASE_11A3.adminBefore <= PHASE_11A3.allowance, 'the admin page, as measured when 11a-3 ended');
    assert.equal(PHASE_11A3.allowance, 500);
    // (This test compared the build in the tree with those figures until Phase 11b: the newest phase's test below holds the build now.)
  });

  it('Phase 11b (the leader report and the one-pager on the chart model) leaves the participant page byte for byte as 11a-3 left it, and grows the admin page by at most 12,000 B gzip over 554,263 B', (t) => {
    assert.equal(PHASE_11B.participantBefore, PHASE_11A3.participantAfter, 'Phase 11b is measured from where Phase 11a-3 ended');
    assert.equal(PHASE_11B.adminBefore, PHASE_11A3.adminAfter);
    assert.equal(PHASE_11B.participantAllowance, 0);
    assert.equal(PHASE_11B.adminAllowance, 12_000);
    assert.equal(PHASE_11B.participantAfter, 156_729, 'the participant page when 11b ended: 11a-3 left it, byte for byte');
    assert.ok(PHASE_11B.adminAfter - PHASE_11B.adminBefore <= PHASE_11B.adminAllowance, 'the admin page, as measured when 11b ended');
    // (This test compared the build in the tree with those figures, and the participant page's SHA-256, until Phase 12: the newest phase's test below holds the build now.)
    void t;
  });

  it('Phase 12 (the fixes approved from UX-REVIEW.md) grew the participant page by at most 600 B gzip and the admin page by at most 1,000 B over where 11b left them', () => {
    assert.equal(PHASE_12.participantBefore, PHASE_11B.participantAfter, 'Phase 12 is measured from where Phase 11b ended');
    assert.equal(PHASE_12.adminBefore, PHASE_11B.adminAfter);
    assert.ok(PHASE_12.participantAfter - PHASE_12.participantBefore <= PHASE_12.participantAllowance, 'the participant page, as measured when 12 ended');
    assert.ok(PHASE_12.adminAfter - PHASE_12.adminBefore <= PHASE_12.adminAllowance, 'the admin page, as measured when 12 ended');
    // (This test compared the build in the tree with those figures until Phase 13: the newest phase's test below holds the build now.)
  });

  it('Phase 13 (the Results exports for leadership) leaves the participant page byte for byte as 12 left it, and grows the admin page by at most 12,000 B gzip over where 12 left it', (t) => {
    assert.equal(PHASE_13.participantBefore, PHASE_12.participantAfter, 'Phase 13 is measured from where Phase 12 ended');
    assert.equal(PHASE_13.adminBefore, PHASE_12.adminAfter);
    assert.equal(PHASE_13.participantAllowance, 0);
    const sha = createHash('sha256').update(built.participant.html).digest('hex');
    const admin = built.admin.htmlGzip - PHASE_13.adminBefore;
    t.diagnostic(`participant ${sha.slice(0, 8)}, admin ${admin >= 0 ? '+' : ''}${admin} B against where 12 ended`);
    console.log(`  Phase 13: the participant page is ${sha === PHASE_13.participantSha256 ? 'byte for byte' : 'NOT'} the page 12 left (${bytes(built.participant.htmlGzip)}); the admin page is ${admin >= 0 ? '+' : ''}${admin} B gzip against where 12 ended (allowance ${PHASE_13.adminAllowance} B), now ${bytes(built.admin.htmlGzip)} of its ${bytes(BUDGET.admin)} budget`);
    assert.equal(sha, PHASE_13.participantSha256, 'the participant page is the one Phase 12 left, byte for byte');
    assert.deepEqual(utilityClasses(built.participant.html), [...PHASE_13.participantUtilities], "the participant page's Tailwind rules are the ones it had");
    assert.ok(admin <= PHASE_13.adminAllowance, `the admin page is ${admin} B larger than where 12 left it`);
    assert.ok(built.admin.htmlGzip < BUDGET.admin, `the admin page is under its ${bytes(BUDGET.admin)} budget`);
    assert.ok(PHASE_13.adminAfter - PHASE_13.adminBefore <= PHASE_13.adminAllowance, 'the admin page, as measured when 13 ended (562,606 B in this checkout)');
  });

  it('Phase 14 (structure and documents only) left the participant and the admin page byte for byte as Phase 13 left them', (t) => {
    assert.equal(PHASE_14.participantBefore, PHASE_13.participantAfter, 'Phase 14 is measured from where Phase 13 ended');
    assert.equal(PHASE_14.adminBefore, PHASE_13.adminAfter);
    assert.equal(PHASE_14.participantAllowance, 0);
    assert.equal(PHASE_14.adminAllowance, 0);
    const participant = createHash('sha256').update(built.participant.html).digest('hex');
    const admin = createHash('sha256').update(built.admin.html).digest('hex');
    t.diagnostic(`participant ${participant.slice(0, 8)}, admin ${admin.slice(0, 8)}`);
    console.log(`  Phase 14: the participant page is ${participant === PHASE_14.participantSha256 ? 'byte for byte' : 'NOT'} the page 13 left; the admin page is ${admin === PHASE_14.adminSha256 ? 'byte for byte' : 'NOT'} the page 13 left`);
    assert.equal(participant, PHASE_14.participantSha256, 'the participant page is the one Phase 13 left, byte for byte');
    assert.equal(admin, PHASE_14.adminSha256, 'the admin page is the one Phase 13 left, byte for byte');
    assert.equal(PHASE_14.participantAfter, PHASE_13.participantAfter);
    assert.equal(PHASE_14.adminAfter, PHASE_13.adminAfter);
  });

  it('the Tailwind rules check can fail: a rule added to the participant page, or one taken away, is found', () => {
    const html = built.participant.html;
    const added = html.replace('@layer utilities{', '@layer utilities{.table{display:table}');
    const removed = html.replace(/\.container\{[^}]*\}/g, ''); // (every rule of it, the ones inside the size queries too)
    assert.notDeepEqual(utilityClasses(added), [...PHASE_11B.participantUtilities]);
    assert.ok(utilityClasses(added).includes('table'));
    assert.notDeepEqual(utilityClasses(removed), [...PHASE_11B.participantUtilities]);
    assert.equal(utilityClasses('<p>no styles</p>').length, 0);
  });

  it('the six sample pictures are in the Setup page, whole, and in neither of the other two: not their bytes, their names, or the modules that seed them (Phase 10f)', async () => {
    const seeding = /lib\/setup\/(sample-seed|sample-pictures)\.js$|\/setup\/sample-picture-data\.ts$|\/assets\/sample-pictures\//;
    assert.ok(built.setup.modules.filter((module) => seeding.test(module.id.replaceAll('\\', '/'))).length >= 3, 'Setup carries the seeding, the list and the files');
    let weight = 0;
    for (const name of SAMPLE_PICTURE_NAMES) {
      const bytesOf = await readFile(path.join(ROOT, 'migration', 'src', 'assets', 'sample-pictures', name));
      weight += bytesOf.length;
      const encoded = bytesOf.toString('base64');
      assert.ok(built.setup.html.includes(encoded), `the Setup page carries ${name} whole`);
      for (const other of [built.participant, built.admin]) {
        assert.equal(other.html.includes(encoded.slice(0, 400)), false, `${other.name} carries ${name}`);
        assert.equal(other.html.includes(name), false, `${other.name} names ${name}`);
      }
    }
    for (const other of [built.participant, built.admin]) {
      assert.equal(other.modules.some((module) => seeding.test(module.id.replaceAll('\\', '/'))), false, `${other.name} bundles the sample seeding or its pictures`);
    }
    console.log(`  Phase 10f: the six sample pictures are ${bytes(weight)}; the Setup page is ${bytes(built.setup.htmlGzip)} gzip (${bytes(built.setup.htmlBytes)} raw)`);
    assert.ok(weight <= PHASE_10F.setupPictures, `the six pictures are ${bytes(weight)}, over the ${bytes(PHASE_10F.setupPictures)} Setup may carry`);
  });

  it('no page holds a site address, a folder name, a PIN hash, the demo PIN, p_cec_ or CreativeExpCOE: what a release package must not carry (Phase 10f)', () => {
    for (const result of Object.values(built)) assert.deepEqual(pageProblems(`${result.name}.html`, result.html), [], result.name);
  });

  it('the words of a settings problem, and the rules in words, are in the Setup page alone: the other two carry the decision and a code', () => {
    const spelled = /This copy of the app has not been set up yet|must be empty, or a letter followed by up to 15 letters or digits/;
    assert.match(built.setup.html, /This copy of the app has not been set up yet/);
    assert.match(built.setup.html, /must be empty, or a letter followed by up to 15 letters or digits/);
    // Setup's first panel, its rows of where the lists are and the probe are Setup's alone too (Phase 10b, part G).
    const setupOnly = /lib\/settings\/deploy-(problems|rules)\.js$|lib\/setup\/setup-deployment\.js$|\/setup\/(CopyPanel|ListAddresses)\.svelte$/;
    assert.equal(built.setup.modules.filter((module) => setupOnly.test(module.id.replaceAll('\\', '/'))).length, 5, 'Setup carries all five');
    assert.match(built.setup.html, /Where the lists are/);
    assert.match(built.setup.html, /This copy of the app/);
    for (const page of [built.participant, built.admin]) {
      assert.doesNotMatch(page.html, spelled, `${page.name} carries the wording`);
      assert.doesNotMatch(page.html, /Where the lists are|Read where the lists are|GetList\(/, `${page.name} carries Setup's list rows or its probe`);
      assert.equal(page.modules.some((module) => setupOnly.test(module.id.replaceAll('\\', '/'))), false, `${page.name} bundles something that is Setup's alone`);
      assert.match(page.html, /This page cannot start/, `${page.name}: the stop screen`);
      assert.match(page.html, /PMS-CFG-00/, `${page.name}: the codes`);
      assert.equal(page.modules.some((module) => /lib\/settings\/deploy-settings\.js$/.test(module.id.replaceAll('\\', '/'))), true, `${page.name}: the resolver`);
    }
  });

  it('Setup\'s plan for a site, what makes the lists, Add an admin and the seed-file import are in the Setup page alone (Phase 10c-3)', () => {
    const provisioning = /lib\/setup\/(provision|setup-admins|setup-import)\.js$|\/setup\/PlanView\.svelte$/;
    assert.equal(built.setup.modules.filter((module) => provisioning.test(module.id.replaceAll('\\', '/'))).length, 4, 'Setup carries all four');
    assert.match(built.setup.html, /Show the plan/);
    assert.match(built.setup.html, /Made by Setup/);
    assert.match(built.setup.html, /Another admin already has that PIN/);
    assert.match(built.setup.html, /Select a seed file produced by npm run export:sharepoint/);
    for (const page of [built.participant, built.admin]) {
      assert.equal(page.modules.some((module) => provisioning.test(module.id.replaceAll('\\', '/'))), false, `${page.name} bundles something that is Setup's alone`);
      assert.doesNotMatch(page.html, /Show the plan|Made by Setup|createfieldasxml|AddFieldInternalNameHint/, `${page.name} carries the plan's words or its definitions`);
      assert.doesNotMatch(page.html, /Another admin already has that PIN|Select a seed file produced by/, `${page.name} carries Add an admin or the seed-file import`);
    }
  });

  it('carries no drawn client logo: the Kroger stand-in is in none of the three pages (Phase 9b, SAM-1)', () => {
    for (const result of Object.values(built)) assert.doesNotMatch(result.html, /Kroger logo placeholder|kroger-logo\.svg/, `${result.name} embeds the drawn stand-in`);
  });

  it('carries the notice in all three pages: the sentence, the app name and the wordmark as text, the nomodule script, and the check that runs first', () => {
    for (const result of Object.values(built)) {
      const html = result.html;
      assert.match(html, /id="pms-unsupported"/, `${result.name}: the notice`);
      assert.match(html, />This page needs a recent browser\.</, `${result.name}: its heading`);
      assert.match(html, />Please open it in the latest Safari, Chrome, Edge or Firefox\.</, `${result.name}: its sentence`);
      assert.match(html, /Deloitte<span>\.<\/span><\/span> Pursuit Managed Services/, `${result.name}: the wordmark and the app name as text`);
      assert.match(html, /<script nomodule>/, `${result.name}: the nomodule script`);
      assert.match(html, /<noscript>/, `${result.name}: the scripting-off line`);
      assert.match(html, /w\.CSS\.registerProperty/, `${result.name}: the feature test`);
      // The stop is the first thing the module does: before the data layer exists, before the page looks for its settings, before any of the app.
      const module = html.slice(html.search(/<script type="module"/));
      const stop = module.indexOf('__pmsUnsupported');
      assert.ok(stop > 0, `${result.name}: the module checks the flag`);
      assert.ok(stop < module.indexOf('CEC_API_BASE'), `${result.name}: before the data layer is set up`);
      assert.ok(module.indexOf('pms-config.txt') > stop, `${result.name}: and before the page looks for its settings file`);
      assert.ok(module.indexOf('__pmsMounted') > stop, `${result.name}: and says it has mounted only after`);
    }
  });

  it('carries nothing of axe-core or the test tools in any page (they are dev dependencies; the pages are built from the app alone)', () => {
    for (const result of Object.values(built)) {
      assert.doesNotMatch(result.html, /axe-core|axe\.run|axe\.min|dequelabs|AxeBuilder|@axe-core/i, `${result.name}: no axe in the page text`);
      assert.equal(result.modules.some((module) => /node_modules\/(@axe-core|axe-core)\//.test(module.id.replaceAll('\\', '/'))), false, `${result.name}: no axe module`);
      assert.doesNotMatch(result.html, /@playwright|playwright-core|pdfjs-dist/, `${result.name}: no test tool`);
    }
  });
});

describe('negative controls: the check can fail', () => {
  it('fails when the admin page stands in for the participant page: every library is found, and the size is over the ceiling', () => {
    const broken = checkBudgets({ ...measured(), participantHtml: built.admin.html, participantGzip: built.admin.htmlGzip, participantModules: built.admin.modules.map((module) => module.id) });
    for (const library of ['jsPDF', 'PptxGenJS', 'html2canvas', 'the Results charts']) assert.ok(broken.some((line) => line.includes(library)), `${library} is reported`);
    assert.ok(broken.some((line) => /ceiling/.test(line)), 'and its size');
    assert.ok(broken.length >= 5, broken.join('\n'));
  });

  it('fails at one byte over each limit, and not at the limit', () => {
    const base = measured();
    assert.deepEqual(checkBudgets({ ...base, participantGzip: BUDGET.participantCeiling }), []);
    assert.equal(checkBudgets({ ...base, participantGzip: BUDGET.participantCeiling + 1 }).length, 1);
    assert.deepEqual(checkBudgets({ ...base, adminGzip: BUDGET.admin }), []);
    assert.equal(checkBudgets({ ...base, adminGzip: BUDGET.admin + 1 }).length, 1);
  });

  it('fails on a real participant build that imports the export libraries, a chart library and the Results charts', async () => {
    const leak = {
      name: 'leak-exports-into-the-participant-page',
      transform(code, id) {
        if (!id.endsWith('/migration/src/main.ts')) return null;
        return `${code}
import { jsPDF } from 'jspdf';
import PptxGenJS from 'pptxgenjs';
import Chart from 'chart.js/auto';
import ResultCard from './admin/charts/ResultCard.svelte';
import { downloadCsv } from './lib/exports/resultsExport.js';
globalThis.__leak = [jsPDF, PptxGenJS, Chart, ResultCard, downloadCsv];
`;
      },
    };
    const leaky = await analyzePage(page('participant'), { outRoot: path.join(outRoot, 'leak'), keepHtml: true, extraPlugins: [leak] });
    const broken = checkBudgets({ participantGzip: leaky.htmlGzip, adminGzip: built.admin.htmlGzip, participantHtml: leaky.html, participantModules: leaky.modules.map((module) => module.id) });
    for (const library of ['jsPDF', 'PptxGenJS', 'Chart.js', 'resultsExport', 'the Results charts']) assert.ok(broken.some((line) => line.includes(library)), `${library} is reported: ${broken.join(' | ')}`);
    assert.ok(leaky.htmlGzip > built.participant.htmlGzip + 150_000, 'and the leak is large');
  }, { timeout: 120_000 });

  it('fails on a real participant build that imports axe-core (so the rule that keeps it out of every page can fail)', async () => {
    const leak = {
      name: 'leak-axe-into-the-participant-page',
      transform(code, id) {
        if (!id.endsWith('/migration/src/main.ts')) return null;
        return `${code}
import axe from 'axe-core';
globalThis.__leak = [axe];
`;
      },
    };
    const leaky = await analyzePage(page('participant'), { outRoot: path.join(outRoot, 'leak-axe'), keepHtml: true, extraPlugins: [leak] });
    assert.ok(leaky.modules.some((module) => /node_modules\/axe-core\//.test(module.id.replaceAll('\\', '/'))), 'axe is in the leaky build, by its module');
    assert.match(leaky.html, /axe-core|axe\.run|dequelabs/i, 'and by its text');
  }, { timeout: 120_000 });

  it('fails on a real participant build that imports the leader report', async () => {
    const leak = {
      name: 'leak-the-leader-report-into-the-participant-page',
      transform(code, id) {
        if (!id.endsWith('/migration/src/main.ts')) return null;
        return `${code}
import { buildLeaderReport } from './lib/exports/leader-report.js';
import { loadReportFonts } from './lib/exports/report-fonts.js';
globalThis.__leak = [buildLeaderReport, loadReportFonts];
`;
      },
    };
    const leaky = await analyzePage(page('participant'), { outRoot: path.join(outRoot, 'leak-report'), keepHtml: true, extraPlugins: [leak] });
    const broken = checkBudgets({ participantGzip: leaky.htmlGzip, adminGzip: built.admin.htmlGzip, participantHtml: leaky.html, participantModules: leaky.modules.map((module) => module.id) });
    for (const library of ['the leader report (lib/exports/leader-report*.js)', 'embedded fonts']) assert.ok(broken.some((line) => line.includes(library)), `${library} is reported: ${broken.join(' | ')}`);
    assert.ok(leaky.htmlGzip > built.participant.htmlGzip + 25_000, 'the fonts alone are 26 kB');
  }, { timeout: 120_000 });
});
