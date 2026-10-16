// Phase 11b: the Live display's one-page PDF and PowerPoint (public/js/resultsExport.js). Run: node --test scripts/test-results-export.js
// (also part of npm test)
//
// The two files are one layout (layoutReport: rectangles, lines, text and pictures in millimetres) drawn by two writers, so this test lays a
// session out, writes it with jsPDF's and PptxGenJS's node builds, and reads back what a reader of each file gets: the PDF with pdf.js
// (scripts/pdf-inspect.js), the PowerPoint as the XML of its slides. Every expected figure is worked out by hand in the comments beside it.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { buildResults } from '../migration/src/lib/results-tally.js';
import * as resultsExport from '../public/js/resultsExport.js';
import { inspectPdf } from './pdf-inspect.js';

const at = (minute) => `2026-10-16T10:${String(minute).padStart(2, '0')}:00.000Z`;
const answer = (track, questionId, value, minute) => ({ questionId, clientTrackId: track, answer: value, timestamp: at(minute) });
const squash = (text) => text.replace(/\s+/g, ' ').trim();

/**
 * Kroger on the real site, 16 Oct 2026: five visits, which answered 9, 8, 0, 8 and 9 of nine questions (9 + 8 + 0 + 8 + 9 = 34 answers), and a
 * sixth whose saved answers could not be read (so none of its answers is among them). The four visits that answered are the iPads that answered.
 */
export function krogerResults() {
  const tracks = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'].map((id, index) => ({ id, createdAt: at(index), participantName: `Guest ${index + 1}` }));
  const answeredBy = { k1: 9, k2: 8, k3: 0, k4: 8, k5: 9 };
  const questionIds = Array.from({ length: 9 }, (_, index) => `kq${index + 1}`);
  const results = buildResults({
    session: { id: 'kroger-2026-10-16', clientId: 'c-kroger', date: '2026-10-16', sectionIds: ['ks'] }, tracks,
    sections: [{ id: 'ks', title: 'Kroger', enabled: true, questionIds }],
    questions: questionIds.map((id) => ({ id, type: 'single-select', prompt: `Question ${id.slice(2)}`, optionIds: [`${id}-a`, `${id}-b`] })),
    options: questionIds.flatMap((id) => [{ id: `${id}-a`, label: 'Yes' }, { id: `${id}-b`, label: 'No' }]),
    answers: Object.entries(answeredBy).flatMap(([track, count]) => questionIds.slice(0, count).map((questionId, index) => answer(track, questionId, `${questionId}-a`, index))),
  });
  return { ...results, unreadable: [{ id: 'k6', reason: 'not-json' }] };
}

/** One iPad, which answered one question once. */
function oneIPad() {
  return buildResults({
    session: { id: 'solo', clientId: 'c', sectionIds: ['s'] }, tracks: [{ id: 't1', createdAt: at(0) }],
    sections: [{ id: 's', title: 'Solo', enabled: true, questionIds: ['q'] }],
    questions: [{ id: 'q', type: 'single-select', prompt: 'One?', optionIds: ['a'] }],
    options: [{ id: 'a', label: 'A' }],
    answers: [answer('t1', 'q', 'a', 1)],
  });
}

/** The PDF's text, page by page, read back with pdf.js. */
async function pdfText(results, brand = {}) {
  const report = resultsExport.buildReport(results, brand);
  const pages = resultsExport.layoutReport(report, null);
  const bytes = await resultsExport.pdfBytes(pages, report, { jsPDF });
  return (await inspectPdf(new Uint8Array(bytes))).pages.map((page) => squash(page.text));
}

/** The PowerPoint's text, slide by slide: every run of words in the slides' XML. */
async function pptxText(results, brand = {}) {
  const report = resultsExport.buildReport(results, brand);
  const pages = resultsExport.layoutReport(report, null);
  const file = await resultsExport.pptxFile(pages, report, { PptxGenJS, outputType: 'nodebuffer' });
  const zip = await JSZip.loadAsync(file);
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => Number(a.match(/\d+/g).at(-1)) - Number(b.match(/\d+/g).at(-1)));
  return Promise.all(slides.map(async (name) => squash([...(await zip.file(name).async('string')).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((match) => match[1]).join(' '))));
}

describe('item A: the one-pager counts the iPads that answered, as the Live display does', () => {
  it('Kroger: 34 answers from 4 iPads (five visits began, one answered nothing; a sixth could not be read)', () => {
    const report = resultsExport.buildReport(krogerResults(), { name: 'Kroger' });
    assert.equal(report.answers, 34);
    assert.equal(report.iPads, 4, 'the visit that answered nothing, and the one whose answers could not be read, are not iPads that answered');
  });

  it('prints "34 answers from 4 iPads" in the PDF and in the PowerPoint', async () => {
    assert.equal(typeof resultsExport.pdfBytes, 'function', 'the PDF writer can be run in node');
    assert.equal(typeof resultsExport.pptxFile, 'function', 'the PowerPoint writer can be run in node');
    const [pdf] = await pdfText(krogerResults(), { name: 'Kroger' });
    const [slide] = await pptxText(krogerResults(), { name: 'Kroger' });
    assert.ok(pdf.includes('34 answers from 4 iPads'), pdf.slice(0, 200));
    assert.ok(slide.includes('34 answers from 4 iPads'), slide.slice(0, 200));
    assert.ok(!pdf.includes('5 iPads') && !slide.includes('5 iPads'));
  });

  it('says one iPad in the singular', async () => {
    const [pdf] = await pdfText(oneIPad());
    assert.ok(pdf.includes('1 answer from 1 iPad'), pdf.slice(0, 200));
    assert.ok(!pdf.includes('1 iPads') && !pdf.includes('1 answers'));
  });
});
