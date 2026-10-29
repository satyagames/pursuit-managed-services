// Phase 13, item E: the summary CSV ("Summary by activity (CSV)", from the Live display's Export CSV and from each Results card), for leadership
// and Excel pivoting. Run: node --test scripts/test-results-csv.js (also part of npm test and npm run test:report)
//
// One row per option, in the screen's order, with the client, the date, the question's number and type in words, numbers as numbers, the correct
// answer and the top choice marked, and the question's headline (the sentence the pack prints) on its first row; every written comment a row of its
// own in a last block, with no name. Every expected row is worked out BY HAND from the fixtures' answers in the comments beside it. "All answers
// (CSV)", the leader report's participant file, is not this file and keeps its columns (scripts/test-leader-report.js holds them).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { CSV_COLUMNS } from '../migration/src/lib/exports/leader-report.js';
import { buildResults } from '../migration/src/lib/results/results-tally.js';
import * as resultsExport from '../migration/src/lib/exports/resultsExport.js';
import { parseCsv } from './oracle-results.js';
import { krogerResults, vineResults } from './results-export-fixtures.js';

const HEADER = ['Client', 'Session date', 'Activity', 'Question number', 'Question', 'Question type', 'Option', 'Answers', 'Share of answers (%)', 'Rank or score', 'Correct option', 'Top choice', 'Answers to this question', 'Takeaway'];
const VINE = { name: 'Vine Street Partners' };
/** The file's rows as a spreadsheet reads them, by column name. */
const rowsOf = (text) => {
  const [head, ...rows] = parseCsv(text);
  return rows.map((row) => Object.fromEntries(head.map((name, index) => [name, row[index]])));
};

describe('Summary by activity (CSV)', () => {
  it('has its columns in reading order, and is UTF-8 with a byte-order mark and CRLF line ends', () => {
    const text = resultsExport.summaryCsvFile(vineResults(), VINE);
    assert.equal(text.charCodeAt(0), 0xFEFF, 'a byte-order mark first, so Excel reads it as UTF-8');
    assert.deepEqual(parseCsv(text)[0], HEADER);
    assert.ok(text.endsWith('\r\n') && !/[^\r]\n/.test(text), 'every line ends CRLF');
  });

  it('a single choice: one row per answer, highest first, the correct answer and the top choice marked, the headline on the first row', () => {
    // v1: first picks Vine, Vine, 5th Street, Main Street: 2, 1, 1, 0 of 4 (50, 25, 25, 0). Vine is right and the top choice.
    const v1 = rowsOf(resultsExport.summaryCsvFile(vineResults(), VINE)).filter((row) => row['Question number'] === '1');
    assert.deepEqual(v1.map((row) => [row.Option, row.Answers, row['Share of answers (%)'], row['Correct option'], row['Top choice']]), [
      ['1014 Vine Street, Cincinnati', '2', '50', 'Yes', 'Yes'], ['5th Street, Cincinnati', '1', '25', '', ''], ['Main Street, Dayton', '1', '25', '', ''], ['Elm Street, Columbus', '0', '0', '', ''],
    ]);
    assert.deepEqual([v1[0].Client, v1[0]['Session date'], v1[0].Activity, v1[0].Question, v1[0]['Question type'], v1[0]['Answers to this question']], ['Vine Street Partners', '2026-10-15', 'Getting to know us', 'Where is the head office?', 'Single choice', '4']);
    assert.equal(v1[0].Takeaway, 'The top choice (50%) was 1014 Vine Street, Cincinnati.');
    assert.deepEqual(v1.slice(1).map((row) => row.Takeaway), ['', '', ''], 'once per question');
  });

  it('a ranking, a scale and true or false, in words; the ranking\'s support score in "Rank or score"', () => {
    const rows = rowsOf(resultsExport.summaryCsvFile(vineResults(), VINE));
    const of = (number) => rows.filter((row) => row['Question number'] === String(number) && row['Question type'] !== 'Comment');
    // v3: True 3 of 4 (75%, right), False 1 (25%).
    assert.deepEqual(of(3).map((row) => [row['Question type'], row.Option, row.Answers, row['Share of answers (%)'], row['Correct option']]), [['True or false', 'True', '3', '75', 'Yes'], ['True or false', 'False', '1', '25', '']]);
    // v4: two answers, both Moderately confident (step 2 of 3); a step's place is its "score".
    assert.deepEqual(of(4).map((row) => [row['Question type'], row.Option, row.Answers, row['Share of answers (%)'], row['Rank or score']]), [['Confidence scale', 'Not confident', '0', '0', '1'], ['Confidence scale', 'Moderately confident', '2', '100', '2'], ['Confidence scale', 'Very confident', '0', '0', '3']]);
    // v5: support scores 69, 69, 56, 31, 25, each ranked by all four; the two at 69 share the top.
    assert.deepEqual(of(5).map((row) => [row['Question type'], row.Option, row.Answers, row['Share of answers (%)'], row['Rank or score'], row['Top choice']]), [
      ['Ranking', 'Faster checkout', '4', '', '69', 'Yes'], ['Ranking', 'Better pay', '4', '', '69', 'Yes'], ['Ranking', 'More training', '4', '', '56', ''], ['Ranking', 'New uniforms', '4', '', '31', ''], ['Ranking', 'Longer breaks', '4', '', '25', ''],
    ]);
    // v2, multiple choice: shares each of the four who answered, so they add up to more than 100.
    assert.deepEqual(of(2).map((row) => [row['Question type'], row.Option, row['Share of answers (%)']]), [['Multiple choice', 'Email', '75'], ['Multiple choice', 'Chat', '50'], ['Multiple choice', 'Phone', '50'], ['Multiple choice', 'Fax', '0']]);
  });

  it('written answers: the words that came up most, then every comment a row of its own in a last block, with nobody\'s name', () => {
    const rows = rowsOf(resultsExport.summaryCsvFile(vineResults(), VINE));
    const words = rows.filter((row) => row['Question type'] === 'Survey feedback');
    assert.deepEqual(words.map((row) => [row.Option, row.Answers]), [['delivery', '3'], ['price', '3'], ['high', '2']]);
    assert.equal(words[0].Takeaway, '4 comments. The word that came up most is “delivery”, in 3 of them.');
    const comments = rows.filter((row) => row['Question type'] === 'Comment');
    assert.deepEqual(comments.map((row) => row.Option), ['The prices are too high, and delivery is slow.', 'Price matters; delivery took 3 days.', 'Delivery boxes arrived damaged. Don’t like the box.', 'Friendly café, but prices high.']);
    assert.deepEqual(comments.map((row) => [row.Answers, row['Share of answers (%)'], row['Question number']]), comments.map(() => ['', '', '6']));
    assert.equal(rows.indexOf(comments[0]), rows.length - comments.length, 'the comments are the last block');
    const text = resultsExport.summaryCsvFile(vineResults(), VINE);
    for (const name of ['Mike A', 'José Álvarez', 'Unnamed participant']) assert.ok(!text.includes(name), name);
  });

  it('writes numbers as numbers: no % sign, no quotes, the date in ISO', () => {
    const text = resultsExport.summaryCsvFile(vineResults(), VINE);
    assert.ok(!/\d%,/.test(text.replace(/“[^”]*”|"[^"]*"/g, '')), 'no percent sign in a number');
    for (const row of rowsOf(text)) {
      for (const column of ['Answers', 'Share of answers (%)', 'Rank or score', 'Answers to this question', 'Question number']) assert.match(row[column], /^(\d+)?$/, `${column}: ${row[column]}`);
      assert.equal(row['Session date'], '2026-10-15');
    }
    assert.match(text, /\r\nVine Street Partners,2026-10-15,Getting to know us,1,Where is the head office\?,Single choice,"1014 Vine Street, Cincinnati",2,50,,Yes,Yes,4,/);
  });

  it('pivots: the answers of Kroger\'s one activity add up to 34, as the Live display says', () => {
    // Nine single-choice questions; kq1 to kq8 answered by four, kq9 by two: 4 x 8 + 2 = 34.
    const rows = rowsOf(resultsExport.summaryCsvFile(krogerResults(), { name: 'Kroger' }));
    const byActivity = new Map();
    for (const row of rows) byActivity.set(row.Activity, (byActivity.get(row.Activity) ?? 0) + Number(row.Answers || 0));
    assert.deepEqual([...byActivity], [['Kroger', 34]]);
    // Each question's own rows add up to its "Answers to this question" (one answer each).
    for (const number of new Set(rows.map((row) => row['Question number']))) {
      const own = rows.filter((row) => row['Question number'] === number);
      assert.equal(own.reduce((sum, row) => sum + Number(row.Answers), 0), Number(own[0]['Answers to this question']), `question ${number}`);
    }
  });

  it('keeps a comment that would start a formula as text, whatever its first sign', () => {
    const at = (minute) => `2026-10-16T10:${String(minute).padStart(2, '0')}:00.000Z`;
    const said = ['=HYPERLINK("http://x","y")', '+1+1', '-2', '@SUM(A1)', '\tTabbed', '\rReturned', 'safe; =1+1'];
    const results = buildResults({
      session: { id: 's', clientId: 'c', date: '2026-10-16', sectionIds: ['a'] }, tracks: said.map((_, index) => ({ id: `t${index}`, createdAt: at(index) })),
      sections: [{ id: 'a', title: '=Activity', enabled: true, questionIds: ['q'] }],
      questions: [{ id: 'q', type: 'open-text-feedback', prompt: '-Anything?', optionIds: [] }], options: [],
      answers: said.map((text, index) => ({ questionId: 'q', clientTrackId: `t${index}`, answer: text, timestamp: at(index) })),
    });
    const rows = rowsOf(resultsExport.summaryCsvFile(results, { name: '@Client' }));
    const comments = rows.filter((row) => row['Question type'] === 'Comment').map((row) => row.Option);
    assert.deepEqual(comments.slice(0, 6), said.slice(0, 6).map((text) => `'${text}`));
    assert.equal(comments[6], "safe;' =1+1", 'a sign after a semicolon too (leader-report.js csvCell)');
    assert.deepEqual([rows[0].Client, rows[0].Activity, rows[0].Question], ["'@Client", "'=Activity", "'-Anything?"]);
  });

  it('prints the same headlines the pack prints, in the same order', () => {
    const report = resultsExport.buildReport(vineResults(), VINE);
    const takeaways = rowsOf(resultsExport.summaryCsvFile(vineResults(), VINE)).map((row) => row.Takeaway).filter(Boolean);
    assert.deepEqual(takeaways, report.questions.map((question) => question.chart.headline));
  });

  it('is the Live display\'s Export CSV, and "All answers (CSV)" keeps the participant file\'s columns', async () => {
    assert.deepEqual([...CSV_COLUMNS], ['Client', 'Date', 'Participant', 'Activity', 'Question', 'First answer', 'Final answer', 'Correct', 'Correct on first try', 'Attempts', 'Answered at']);
    const live = await readFile(new URL('../migration/src/admin/LiveDisplay.svelte', import.meta.url), 'utf8');
    assert.match(live, /downloadCsv\(current, \{ name: /, 'the Live display hands the client\'s name to the summary CSV');
    const buttons = await readFile(new URL('../migration/src/admin/ReportExports.svelte', import.meta.url), 'utf8');
    const labels = [...buttons.matchAll(/'(Leader report \(PDF\)|Summary by activity \(CSV\)|All answers \(CSV\))'/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(labels)], ['Leader report (PDF)', 'Summary by activity (CSV)', 'All answers (CSV)'], 'the three buttons, in this order');
    assert.ok(!buttons.includes('Participant answers (CSV)'));
  });
});
