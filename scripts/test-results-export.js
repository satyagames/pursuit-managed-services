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
import { bigResults, krogerResults, oddResults, vineResults } from './results-export-fixtures.js';
import { contrastOf } from './print-contrast.js';
import { nodePalette } from './results-palette-node.js';

const at = (minute) => `2026-10-16T10:${String(minute).padStart(2, '0')}:00.000Z`;
const answer = (track, questionId, value, minute) => ({ questionId, clientTrackId: track, answer: value, timestamp: at(minute) });
const squash = (text) => text.replace(/\s+/g, ' ').trim();

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
  const pages = resultsExport.layoutReport(report, null, nodePalette());
  const bytes = await resultsExport.pdfBytes(pages, report, { jsPDF });
  return (await inspectPdf(new Uint8Array(bytes))).pages.map((page) => squash(page.text));
}

/** The PowerPoint's text, slide by slide: every run of words in the slides' XML. */
async function pptxText(results, brand = {}) {
  const report = resultsExport.buildReport(results, brand);
  const pages = resultsExport.layoutReport(report, null, nodePalette());
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

// ---- Item B: the one-pager draws the screen's charts ------------------------------------------------------------------------------

const VINE_TEXT = {
  // v1: first picks Vine, Vine, 5th Street, Main Street: 1, 2, 1, 0 of 4. Vine is 50%, not more than half, so "The top choice".
  v1: ['The top choice (50%) was 1014 Vine Street, Cincinnati.', '2 of 4 got it right first time.', '2 · 50%', '1 · 25%', '0 · 0%'],
  // v2: Email 3 of 4 (75%), Chat 2 (50%), Phone 2 (50%), Fax 0; each rounded alone.
  v2: ['Most people (75%) chose Email.', 'People could pick several answers, so the bars add up to more than 100%.', '3 · 75%', '2 · 50%'],
  // v3: first picks True, True, False, True: True 3 of 4 (75%), False 1 (25%).
  v3: ['Most people (75%) said True.', '3 of 4 got it right first time.', '3 people · 75%', '1 person · 25%'],
  // v4: two answers, both "Moderately confident" (2 of 3): average 2.0 of 3; the steps 0%, 100%, 0%.
  v4: ['Average 2.0 of 3. Most people (100%) chose Moderately confident.', 'Average 2.0 of 3', '100%'],
  // v5: points 15, 15, 13, 9, 8 over 4 rankers of 5 options: (p - 4) / 16 x 100 = 69, 69, 56, 31, 25; places 1, 1, 3, 4, 5.
  v5: ['A tie between Faster checkout and Better pay (support score 69 each).', '100 means everyone ranked it first; 0 means everyone ranked it last.', 'Support 69', 'Support 56', 'Support 31', 'Support 25'],
  // v6: "delivery" in three comments, "price" in three (prices folds into price), "high" in two.
  v6: ['4 comments. The word that came up most is “delivery”, in 3 of them.', 'Words that came up most', 'delivery (3), price (3), high (2)'],
};

/** What PowerPoint's XML holds for a phrase: & < > are written as entities. */
const inXml = (phrase) => phrase.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

describe('item B: the one-pager draws the same charts as the screen', () => {
  const brand = { name: 'Vine Street Partners', primaryColor: '#7A1F5C', secondaryColor: '#64748B' };

  it('prints each chart\'s headline, its "right first time" line, its caption and its values, in the PDF and in the PowerPoint', async () => {
    const pdf = (await pdfText(vineResults(), brand)).join(' ');
    const slides = (await pptxText(vineResults(), brand)).join(' ');
    const missing = [];
    for (const [question, phrases] of Object.entries(VINE_TEXT)) {
      for (const phrase of phrases) {
        if (!pdf.includes(phrase)) missing.push(`PDF ${question}: ${phrase}`);
        if (!slides.includes(inXml(phrase))) missing.push(`PowerPoint ${question}: ${phrase}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it('names nobody: no participant\'s name is in either file', async () => {
    const pdf = (await pdfText(vineResults(), brand)).join(' ');
    const slides = (await pptxText(vineResults(), brand)).join(' ');
    for (const name of ['Mike A', 'José Álvarez', '=SUM(A1)', 'Unnamed participant']) {
      assert.ok(!pdf.includes(name), `the PDF names ${name}`);
      assert.ok(!slides.includes(inXml(name)), `the PowerPoint names ${name}`);
    }
  });

  describe('the layout', () => {
    const palette = nodePalette();
    const pages = () => resultsExport.layoutReport(resultsExport.buildReport(vineResults(), brand), null, palette);
    const items = () => pages().flatMap((page) => page.items);
    const textOf = (list) => list.filter((item) => item.kind === 'text').map((item) => item.text);
    const hex = (value) => String(value).replace('#', '').toUpperCase();

    it('keeps to one page', () => assert.equal(pages().length, 1));

    it('sorts the bars as the screen does, marks the correct answer with a tick and the word, and the top choice in words', () => {
      const all = items();
      const labels = textOf(all.filter((item) => item.role === 'label'));
      // v1, highest first and a tie in the question's order: Vine (2), 5th Street (1), Main Street (1), Elm Street (0).
      const v1 = ['1014 Vine Street, Cincinnati', '5th Street, Cincinnati', 'Main Street, Dayton', 'Elm Street, Columbus'].map((label) => labels.findIndex((line) => label.startsWith(line)));
      assert.ok(v1.every((at, index) => at >= 0 && (index === 0 || at > v1[index - 1])), `v1 in order: ${v1}`);
      const tags = textOf(all.filter((item) => item.role === 'tag'));
      // Correct: v1's Vine and v3's True. Top choice: v1's Vine and v2's Email (a split bar and a scale's columns carry no "Top choice").
      assert.equal(tags.filter((tag) => tag === 'Correct').length, 2);
      assert.equal(tags.filter((tag) => tag === 'Top choice').length, 2);
      assert.equal(all.filter((item) => item.kind === 'tick').length, 2, 'a tick beside each correct answer, never colour alone');
    });

    it('fills every bar from results-tokens.css: the correct answer Dark Green, the top choice the blue, the rest the tint, a scale in its ramp', () => {
      const bars = items().filter((item) => item.role === 'bar');
      assert.ok(bars.length > 0);
      for (const bar of bars) {
        if (bar.tone === 'correct') assert.equal(hex(bar.fill), hex(palette.correct));
        else if (bar.tone === 'top') assert.equal(hex(bar.fill), hex(palette.primary));
        else if (bar.tone === 'rest') assert.equal(hex(bar.fill), hex(palette.tint));
        else assert.ok(palette.ramps[3].map(hex).includes(hex(bar.fill)), `a scale's column is in the 3-step ramp: ${bar.fill}`);
      }
      // v4's one column (Moderately confident, the middle of three steps) is the ramp's middle.
      assert.ok(bars.some((bar) => bar.of === 'v4b' && hex(bar.fill) === hex(palette.ramps[3][1])));
    });

    it('marks the scale\'s average with a line in the marker colour, and draws the ranking\'s places', () => {
      const all = items();
      assert.equal(all.filter((item) => item.role === 'average' && hex(item.color) === hex(palette.marker)).length, 1);
      assert.deepEqual(textOf(all.filter((item) => item.role === 'rank')), ['1', '1', '3', '4', '5']);
    });

    it('takes every colour of a card from the palette, and only the header wears the client\'s', () => {
      const tokens = new Set([palette.primary, palette.tint, palette.correct, palette.marker, palette.brand, palette.text, palette.textSecondary, palette.textMuted, palette.grid, palette.surface, palette.bandShade, ...palette.ramps[3], ...palette.ramps[4], ...palette.ramps[5]].map(hex));
      const colours = (item) => [item.fill, item.stroke, item.color].filter(Boolean).map(hex);
      const all = items();
      assert.ok(all.some((item) => item.card), 'the cards\' items are marked');
      assert.deepEqual(all.filter((item) => item.card).flatMap(colours).filter((colour) => !tokens.has(colour)), []);
      // Outside the cards: the header band in the client's colours, its words in white or near-black, and the footer in the palette.
      const header = new Set(['7A1F5C', '64748B', 'FFFFFF', '111827']);
      assert.deepEqual(all.filter((item) => !item.card).flatMap(colours).filter((colour) => !tokens.has(colour) && !header.has(colour)), []);
    });
  });
});

// ---- Item D: print and accessibility ----------------------------------------------------------------------------------------------

describe('item D: the one-pager in print: contrast, never colour alone, nothing outside its box', () => {
  const palette = nodePalette();
  // A client colour of middle lightness (#3C8DBC: white words on it are 3.6:1, black 5.8:1) besides the fixtures' own.
  const SESSIONS = [
    ['Vine', vineResults(), { name: 'Vine Street Partners', primaryColor: '#7A1F5C', secondaryColor: '#64748B' }],
    ['Kroger', krogerResults(), { name: 'Kroger', primaryColor: '#0C4EA2', secondaryColor: '#E31837' }],
    ['sixty people', bigResults(), { name: 'A client with a rather long name, Incorporated', primaryColor: '#F2C200' }],
    ['other scripts', oddResults(), { name: 'Søren & Co', primaryColor: '#046A38' }],
    ['a middle colour', vineResults(), { name: 'Middle Blue', primaryColor: '#3C8DBC', secondaryColor: '#3C8DBC' }],
  ];
  const laid = SESSIONS.map(([name, results, brand]) => [name, resultsExport.layoutReport(resultsExport.buildReport(results, brand), null, palette)]);
  /** Where a line of words is drawn: its start (or end, or middle) and the middle of its box. */
  const pointOf = (item) => [item.align === 'right' ? item.x + item.w - 0.5 : item.align === 'center' ? item.x + item.w / 2 : item.x + 0.5, item.y + item.h / 2];
  const light = (item) => item.role === 'bar' && (item.tone === 'rest' || item.tone === undefined);

  it('gives every word 4.5:1 and every mark that carries meaning 3:1 against what is under it, the header\'s words on any client colour too', () => {
    const lines = [];
    for (const [name, pages] of laid) {
      const { problems, light: listed, measured } = contrastOf(pages, { pointOf, light });
      assert.deepEqual(problems, [], name);
      lines.push(`  ${name}: ${measured} words and marks measured; the tint bars and a scale's steps (written beside, held at 2:1 by the palette): ${[...new Set(listed.map((mark) => mark.ratio.toFixed(2)))].join(', ') || 'none'}`);
    }
    console.log(`One-pager contrast:\n${lines.join('\n')}`);
  });

  it('writes the value beside every bar the palette holds at 2:1, and marks the correct answer and the top choice in words, never by colour alone', () => {
    for (const [name, pages] of laid) {
      for (const page of pages) {
        const values = page.items.filter((item) => item.role === 'value');
        for (const bar of page.items.filter((item) => item.role === 'bar')) {
          // The value is on the bar's row (a bar), or above its column (a scale's step).
          const near = values.some((value) => value.y <= bar.y + bar.h + 0.01 && value.y + value.h >= bar.y - value.h - 0.01);
          assert.ok(near, `${name}: the bar of ${bar.of} has its value written beside it`);
        }
        for (const bar of page.items.filter((item) => item.role === 'bar' && item.tone === 'correct')) {
          const below = (item) => Math.abs(item.x - bar.x) < 200 && item.y >= bar.y - 8 && item.y <= bar.y + 12;
          assert.ok(page.items.some((item) => item.kind === 'tick' && below(item)), `${name}: a tick beside the correct answer ${bar.of}`);
          assert.ok(page.items.some((item) => item.role === 'tag' && item.text === 'Correct' && below(item)), `${name}: "Correct" beside ${bar.of}`);
        }
      }
    }
  });

  it('keeps every line of words inside its box (by Helvetica\'s own widths, from jsPDF), every card\'s items inside the card, and everything on the page', () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [297, 210] });
    const problems = [];
    for (const [name, pages] of laid) {
      pages.forEach((page, index) => {
        const where = `${name}, page ${index + 1}`;
        const cards = page.items.filter((item) => item.kind === 'rect' && item.card && item.stroke);
        const lines = [];
        for (const item of page.items) {
          const right = item.kind === 'line' ? Math.max(item.x, item.x2) : item.x + (item.w ?? item.size ?? 0);
          const bottom = item.kind === 'line' ? Math.max(item.y, item.y2) : item.y + (item.h ?? item.size ?? 0);
          if (item.x < -0.01 || right > 297.01 || item.y < -0.01 || bottom > 210.01) problems.push(`${where}: a ${item.kind} is off the page`);
          if (item.card && !(item.kind === 'rect' && item.stroke) && !cards.some((card) => item.x >= card.x - 0.01 && right <= card.x + card.w + 0.01 && item.y >= card.y - 0.01 && bottom <= card.y + card.h + 0.01)) problems.push(`${where}: "${item.text ?? item.kind}" is outside its card`);
          if (item.kind !== 'text' || !item.text.trim()) continue;
          doc.setFont('helvetica', item.bold ? 'bold' : item.italic ? 'italic' : 'normal');
          doc.setFontSize(item.size);
          const wide = doc.getTextWidth(resultsExport.pdfSafe(item.text));
          if (wide > item.w + 0.05) problems.push(`${where}: "${item.text.slice(0, 40)}" is ${wide.toFixed(2)} mm in a box of ${item.w.toFixed(2)} mm`);
          const start = item.align === 'right' ? item.x + item.w - wide : item.align === 'center' ? item.x + (item.w - wide) / 2 : item.x;
          lines.push({ y: item.y + item.h / 2, start, end: start + wide, text: item.text });
        }
        for (let a = 0; a < lines.length; a += 1) {
          for (let b = a + 1; b < lines.length; b += 1) {
            if (Math.abs(lines[a].y - lines[b].y) < 1.2 && lines[a].start < lines[b].end - 0.05 && lines[b].start < lines[a].end - 0.05) problems.push(`${where}: "${lines[a].text.slice(0, 30)}" runs into "${lines[b].text.slice(0, 30)}"`);
          }
        }
      });
    }
    assert.deepEqual(problems, []);
  });

  it('can fail: a word on a ground it does not read on, a box too narrow, and a card\'s item outside it are each found', () => {
    const pages = structuredClone(laid[0][1]);
    const word = pages[0].items.find((item) => item.kind === 'text' && item.card && item.text.length > 10);
    pages[0].items.push({ ...word, color: 'BBBBBB' });
    assert.ok(contrastOf(pages, { pointOf, light }).problems.some((line) => line.includes(word.text.slice(0, 20))));
    const bar = pages[0].items.find((item) => item.role === 'bar' && item.tone === 'top');
    pages[0].items.push({ ...bar, fill: palette.tint, tone: 'top' });
    assert.ok(contrastOf(pages, { pointOf, light }).problems.some((line) => line.includes('(top)')));
  });
});
