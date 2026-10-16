// Phase 11b: the leader report's "Results by activity" on the chart model and the Results palette. Run: node --test scripts/test-leader-report-charts.js
// (also part of npm test and npm run test:report)
//
// The report is made in node by the model, layout and writer the admin page uses (scripts/leader-report-node.js) and read back with pdf.js. What
// is held here: each question carries the Live display's headline and "N of M got it right first time" (lib/results-chart-model.js), its bars are
// drawn by lib/results-chart-figure.js in the colours of styles/results-tokens.css (the client's colour stays in the report's own structure: the
// title band, the rules, the completion bars), the correct answer has a tick and the word "Correct", and every number the report printed before
// this phase is still printed. Every expected sentence is worked out BY HAND from the Harbour fixture (scripts/leader-report-fixtures.js) in the
// comments beside it.

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import * as leaderReport from '../migration/src/lib/leader-report.js';
import { RANKING_CAPTION } from '../migration/src/lib/results-chart-model.js';
import { bigRecords, harbourRecords } from './leader-report-fixtures.js';
import { makeReport } from './leader-report-node.js';
import { inspectPdf, squash } from './pdf-inspect.js';
import { nodePalette } from './results-palette-node.js';
import { contrastOf } from './print-contrast.js';

const RESULTS = 'Results by activity';
const hex = (value) => String(value ?? '').replace('#', '').toUpperCase();

let small;
let resultsText;
let resultsItems;

before(async () => {
  small = await makeReport(harbourRecords());
  small.read = await inspectPdf(small.bytes);
  const at = small.pages.map((page, index) => (page.section === RESULTS ? index : -1)).filter((index) => index >= 0);
  resultsText = squash(at.map((index) => small.read.pages[index].text).join(' '));
  resultsItems = at.flatMap((index) => small.pages[index].items);
});

// Harbour's seven visits and their first answers (HARBOUR_PEOPLE): José, Zoë, Søren, Łukasz (after his restart), an unnamed visit, José again
// (nothing) and a visit that answered Q1 only.
const HEADLINES = [
  // Q1: first picks 1887 (José, Łukasz, the last visit), 1901 (Zoë, Søren), 1923 (unnamed): 3, 2, 1, 0 of 6. 3 of 6 is half, not most.
  'The top choice (50%) was 1887.', '3 of 6 got it right first time.',
  // Q2: True (José, Zoë, Łukasz), False (Søren): 3 of 4.
  'Most people (75%) said True.', '3 of 4 got it right first time.',
  // Q3: Søren Holm (José, Søren), José Marín (Zoë), Ada Łęcka (Łukasz): 2, 1, 1 of 4; Ada is the right one.
  'The top choice (50%) was Søren Holm.', '1 of 4 got it right first time.',
  // Q4, a poll: Speed (José), Care (Zoë, Søren), Price (Łukasz).
  'The top choice (50%) was Care.',
  // Q5, several answers: Phone (José, Søren), Email (Zoë, Søren), App (José, Søren): 2 each.
  'A tie between Phone, Email and App (2 each).',
  // Q6, a scale of 1 to 3: 3, 2, 3, 2: average 2.5; Fairly and Very confident 2 each.
  'Average 2.5 of 3. A tie between Fairly confident and Very confident (2 each).',
  // Q7, a ranking of three: Quality 3 + 3 + 2 = 8 points, Cost 2 + 1 + 3 = 6, Speed 1 + 2 + 1 = 4, over 3 rankers: (8 - 3) / (3 x 2) = 83.
  'Quality ranked highest, with a support score of 83.',
  // Q8, written: José, Søren and Łukasz; no word is in two comments.
  '3 comments.',
  // Q9 (switched off, but answered): José's Eastbay, 1 of 1; Northport is right.
  'Most people (100%) chose Eastbay.', '0 of 1 got it right first time.',
];

describe('Phase 11b: Results by activity on the chart model', () => {
  it('prints each question\'s headline, and "N of M got it right first time" for a graded one, as the Live display says them', () => {
    const missing = HEADLINES.filter((line) => !resultsText.includes(squash(line)));
    assert.deepEqual(missing, []);
  });

  it('keeps every number it printed before: the bars\' counts and shares, the first-try facts, the scale\'s average and the ranking\'s points', () => {
    for (const phrase of [
      '3 · 50%', '2 · 33%', '1 · 17%', '0 · 0%', 'One correct answer. Answered by 6 of 7.', 'Right first time: 3 of 6 (50%)', 'Most common wrong first answer: 1901 (2 of 6)',
      'After a wrong first answer: 1 got it right on the second try, 1 was shown the answer, 1 did not try again.',
      'Average: 2.5 on a scale of 1 to 3 (4 answers)', 'Points: with 3 options, a first place earns 3, the next one fewer, the last 1.', 'Average place: Quality 1.3; Cost 2.0; Speed 2.7',
      'People could choose more than one answer',
    ]) assert.ok(resultsText.includes(squash(phrase)), phrase);
  });

  it('draws the ranking as the screen does: its places, its support scores (83, 50, 17) with the points beside them, and the caption', () => {
    assert.deepEqual(resultsItems.filter((item) => item.role === 'rank').map((item) => item.text), ['1', '2', '3']);
    // Cost (6 - 3) / 6 = 50; Speed (4 - 3) / 6 = 17.
    for (const phrase of ['Support 83 · 8 pts', 'Support 50 · 6 pts', 'Support 17 · 4 pts', RANKING_CAPTION]) assert.ok(resultsText.includes(squash(phrase)), phrase);
  });

  it('marks each correct answer with a tick and "Correct" in bold, and the top choice in words: never colour alone', () => {
    const tags = resultsItems.filter((item) => item.role === 'tag').map((item) => item.text);
    // Correct: Q1's 1887, Q2's True, Q3's Ada Łęcka, Q9's Northport.
    assert.equal(tags.filter((tag) => tag === 'Correct').length, 4);
    assert.ok(resultsItems.filter((item) => item.role === 'tag' && item.text === 'Correct').every((item) => item.bold));
    assert.equal(resultsItems.filter((item) => item.kind === 'tick').length, 4);
    // Top choice: Q1's 1887, Q3's Søren Holm, Q4's Care, Q5's Phone, Email and App (a tie), Q9's Eastbay (a split bar and a scale carry none).
    assert.equal(tags.filter((tag) => tag === 'Top choice').length, 7);
    const page = small.read.pages.find((entry) => entry.text.includes('Which year did the harbour open?') && entry.text.includes('Right first time'));
    assert.equal(page.items.find((item) => item.text === '1887').font, 'OpenSans-Bold', 'the correct answer\'s words are bold');
    assert.equal(page.items.find((item) => item.text === '1901').font, 'OpenSans-Regular');
    assert.ok(!resultsText.includes('(correct answer)'), 'the word "Correct" and the tick say it now');
  });

  it('draws the bars in the Results palette: Dark Green for the correct answer, the blue for the top choice, the tint for the rest, a scale in its ramp', () => {
    const palette = nodePalette();
    const bars = resultsItems.filter((item) => item.role === 'bar');
    assert.ok(bars.length >= 20);
    for (const bar of bars) {
      const want = { correct: palette.correct, top: palette.primary, rest: palette.tint }[bar.tone];
      if (want) assert.equal(hex(bar.fill), hex(want), `${bar.tone} bar`);
      else assert.ok(palette.ramps[3].map(hex).includes(hex(bar.fill)), `a scale's column: ${bar.fill}`);
    }
  });

  it('keeps the client\'s colour to the report\'s own structure: no mark or word of a chart wears it', () => {
    const palette = nodePalette();
    const tokens = new Set([palette.primary, palette.tint, palette.correct, palette.marker, palette.brand, palette.text, palette.textSecondary, palette.textMuted, palette.grid, palette.surface, palette.bandShade, ...palette.ramps[3], ...palette.ramps[4], ...palette.ramps[5]].map(hex));
    const charted = resultsItems.filter((item) => item.role);
    assert.ok(charted.length > 50);
    const strays = charted.flatMap((item) => [item.fill, item.stroke, item.color].filter(Boolean).map(hex)).filter((colour) => !tokens.has(colour));
    assert.deepEqual(strays, []);
    // The client's accent (Harbour's #1F5FA8, which has 3:1 on white as it is) is still the title band's.
    assert.ok(small.pages[0].items.some((item) => item.kind === 'rect' && hex(item.fill) === '1F5FA8'));
  });

  it('says on the last page, in one plain sentence, that the Live display\'s files count the iPads that answered', () => {
    assert.equal(typeof leaderReport.LIVE_FILES_NOTE, 'string');
    const last = squash(small.read.pages.at(-1).text);
    assert.ok(last.includes(squash(leaderReport.LIVE_FILES_NOTE)), last.slice(0, 300));
    assert.match(leaderReport.LIVE_FILES_NOTE, /iPads that answered/);
    // It is not a counting rule of this report: the rules are as they were.
    assert.ok(!leaderReport.COUNTING_RULES.includes(leaderReport.LIVE_FILES_NOTE));
    assert.equal(leaderReport.COUNTING_RULES.length, 8);
  });
});

describe('Phase 11b, item D: the leader report in print', () => {
  const PT = 25.4 / 72;
  /** Where a line of words is drawn: by its start (or end, or middle), a little above its baseline. */
  const pointOf = (item) => [item.align === 'right' ? item.x + item.w - 0.5 : item.align === 'center' ? item.x + item.w / 2 : item.x + 0.5, item.y - item.size * PT * 0.35];
  const light = (item) => item.role === 'bar' && (item.tone === 'rest' || item.tone === undefined);

  it('gives every word on every page 4.5:1 and every mark that carries meaning 3:1 against what is under it, for a small session and for sixty people', async () => {
    const big = await makeReport(bigRecords());
    const lines = [];
    for (const [name, pages] of [['Harbour', small.pages], ['sixty people', big.pages]]) {
      const { problems, light: listed, measured } = contrastOf(pages, { pointOf, light });
      assert.deepEqual(problems, [], name);
      lines.push(`  ${name}: ${measured} words and marks on ${pages.length} pages; the tint bars and a scale's steps (written beside, held at 2:1 by the palette): ${[...new Set(listed.map((mark) => mark.ratio.toFixed(2)))].join(', ') || 'none'}`);
    }
    console.log(`Leader report contrast:\n${lines.join('\n')}`);
  });

  it('writes the value beside every bar, and marks a correct answer with a tick and "Correct" beside it: in greyscale the words still say it', () => {
    small.pages.forEach((page, index) => {
      const values = page.items.filter((item) => item.role === 'value');
      for (const bar of page.items.filter((item) => item.role === 'bar')) {
        // On a bar's row (its baseline within the bar's height and a line under it), or above a scale's column.
        assert.ok(values.some((value) => value.y >= bar.y - 8 && value.y <= bar.y + bar.h + 6), `page ${index + 1}: the bar of ${bar.of} has its value written beside it`);
      }
      for (const bar of page.items.filter((item) => item.role === 'bar' && item.tone === 'correct')) {
        const near = (item) => item.y >= bar.y - 6 && item.y <= bar.y + 12;
        assert.ok(page.items.some((item) => item.kind === 'tick' && near(item)), `page ${index + 1}: a tick beside the correct answer ${bar.of}`);
        assert.ok(page.items.some((item) => item.role === 'tag' && item.text === 'Correct' && near(item)), `page ${index + 1}: "Correct" beside ${bar.of}`);
      }
    });
  });

  it('can fail: words that do not read on their ground are found', () => {
    const pages = structuredClone(small.pages);
    const word = pages[1].items.find((item) => item.role === 'headline');
    pages[1].items.push({ ...word, color: '#BBBBBB' });
    assert.ok(contrastOf(pages, { pointOf, light }).problems.some((line) => line.includes(word.text.slice(0, 20))));
  });
});
