// Every Results export made from the test fixtures, for a person to LOOK at (Phase 13, EXPORT-DESIGN.md): the leader report, the Live display's
// summary pack (PDF and PowerPoint) and both CSV files, with each PDF page as a PNG and a greyscale copy. Not a test: it writes files and says
// where they are.
//
//   node scripts/look-exports.js [label]          (npm run look:exports)   ->  test-results/exports/<label>/  (default "now")
//
// The sessions: Vine (VJR's run in miniature: every kind of question, a tie for the top of a ranking, a scale with two answers), Kroger (34
// answers from 4 iPads, one visit unreadable), sixty people and fifteen questions with long answers, other scripts and emoji with a 1,000-character
// comment and a removed answer, an activity of ten questions nobody has answered yet; and the leader report for Harbour, for Harbour as a sample
// client with an unreadable item, and for sixty people. A PowerPoint cannot be drawn here: its text is checked from its XML by
// scripts/test-results-pack.js, and a person must open it in PowerPoint (QA-TESTING.md).

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { jsPDF } from 'jspdf';
import PptxGenJS from 'pptxgenjs';
import { participantAnswersCsv } from '../migration/src/lib/leader-report.js';
import { createMeasure, loadReportFonts } from '../migration/src/lib/report-fonts.js';
import { buildResults } from '../migration/src/lib/results-tally.js';
import * as resultsExport from '../public/js/resultsExport.js';
import { bigRecords, harbourRecords } from './leader-report-fixtures.js';
import { makeReport } from './leader-report-node.js';
import { renderPdfPages } from './render-pdf-pages.js';
import { bigResults, krogerResults, oddResults, vineResults } from './results-export-fixtures.js';
import { nodePalette } from './results-palette-node.js';

const label = process.argv[2] ?? 'now';
const out = path.join(import.meta.dirname, '..', 'test-results', 'exports', label);

/** An activity of ten questions that nobody has answered yet. */
function tenUnanswered() {
  const ids = Array.from({ length: 10 }, (_, index) => `n${index + 1}`);
  return buildResults({
    session: { id: 'ten-2026-10-16', clientId: 'c', date: '2026-10-16', sectionIds: ['a'] }, tracks: [],
    sections: [{ id: 'a', title: 'Ten questions, none answered yet', enabled: true, questionIds: ids }],
    questions: ids.map((id) => ({ id, type: 'single-select', prompt: `Question ${id.slice(1)} of ten?`, optionIds: [`${id}a`, `${id}b`] })),
    options: ids.flatMap((id) => [{ id: `${id}a`, label: 'Yes' }, { id: `${id}b`, label: 'No' }]), answers: [],
  });
}

const PACKS = [
  ['vine', vineResults, { name: 'Vine Street Partners', primaryColor: '#7A1F5C', secondaryColor: '#64748B' }],
  ['kroger', krogerResults, { name: 'Kroger', primaryColor: '#0C4EA2', secondaryColor: '#E31837' }],
  ['big', bigResults, { name: 'A client with a rather long name, Incorporated', primaryColor: '#F2C200' }],
  ['odd', oddResults, { name: 'Ünïcode 東京 😀', primaryColor: '#046A38' }],
  ['ten', tenUnanswered, { name: 'Northwind Trading', primaryColor: '#0B6E4F' }],
];

function noticed() {
  const records = harbourRecords({ name: 'Kroger' });
  records.client.theme.sample = { source: 'Seed sample clients' };
  records.unreadable = [{ id: 't-zoe', reason: 'not-json' }];
  records.answers = records.answers.filter((answer) => answer.clientTrackId !== 't-zoe');
  return records;
}
const REPORTS = [['report-harbour', harbourRecords], ['report-notices', noticed], ['report-big', bigRecords]];

await mkdir(out, { recursive: true });
const fonts = await loadReportFonts();
const browser = await chromium.launch();
const grey = await browser.newPage();
const lines = [];

async function pictures(name, bytes) {
  const shots = await renderPdfPages(bytes, { browser, scale: 1.4 });
  for (const { page, png } of shots) {
    await writeFile(path.join(out, `${name}-${page}.png`), png);
    await grey.setContent(`<img src="data:image/png;base64,${png.toString('base64')}" style="filter:grayscale(1);display:block">`);
    await grey.locator('img').screenshot({ path: path.join(out, `${name}-${page}-grey.png`) });
  }
  return shots.length;
}

for (const [name, make, brand] of PACKS) {
  const results = make();
  const report = resultsExport.buildReport(results, brand);
  const pages = resultsExport.layoutReport(report, null, nodePalette(), createMeasure(fonts));
  const bytes = new Uint8Array(resultsExport.pdfBytes(pages, report, { jsPDF, fonts }));
  await writeFile(path.join(out, `pack-${name}.pdf`), bytes);
  await writeFile(path.join(out, `pack-${name}.pptx`), await resultsExport.pptxFile(pages, report, { PptxGenJS, outputType: 'nodebuffer' }));
  await writeFile(path.join(out, `summary-${name}.csv`), resultsExport.summaryCsvFile(results, brand));
  lines.push(`pack-${name}: ${await pictures(`pack-${name}`, bytes)} pages (cards a page: ${pages.map((page) => page.items.filter((item) => item.role === 'card').length).join(', ')})`);
}
for (const [name, make] of REPORTS) {
  const made = await makeReport(make());
  await writeFile(path.join(out, `${name}.pdf`), made.bytes);
  await writeFile(path.join(out, `${name}-all-answers.csv`), participantAnswersCsv(made.report));
  lines.push(`${name}: ${await pictures(name, made.bytes)} pages`);
}
await browser.close();
console.log(`Written to ${path.relative(process.cwd(), out)}:\n  ${lines.join('\n  ')}`);
