// Prompt 23, Part 6: Art of the Possible on every Results surface. The chart model, the tally, the leader report and its long CSV, the summary, the dashboard and the guest picture's
// privacy rules, all from the brief's session worked by hand (scripts/test-aop-math.js holds the formulas themselves).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { encodeAnswer } from '../migration/src/lib/participant/aop-answer.js';
import { buildResults } from '../migration/src/lib/results/results-tally.js';
import { chartKind, chartOf, chartsOf, picturesFor } from '../migration/src/lib/results/results-chart-model.js';
import { chartFigure } from '../migration/src/lib/results/results-chart-figure.js';
import { nameParticipants, withNamesHidden } from '../migration/src/lib/results/participant-names.js';
import { summaryOf, summaryRecord, summaryFromItem } from '../migration/src/lib/results/session-summary.js';
import { dashboardOf, reportCsv } from '../migration/src/lib/results/dashboard-model.js';
import { METRICS } from '../migration/src/lib/results/metric-words.js';
import { buildLeaderReport, COUNTING_RULES, MATRIX_RULE, matrixLongCsv, MATRIX_CSV_COLUMNS, participantAnswersCsv } from '../migration/src/lib/exports/leader-report.js';
import { buildReport, resultsToCsv } from '../migration/src/lib/exports/resultsExport.js';
import { readFileSync } from 'node:fs';
import { readPalette } from '../migration/src/lib/results/results-palette.js';

const palette = readPalette(readFileSync('migration/src/styles/results-tokens.css', 'utf8'));
const V = { id: 'c-aaaaaa', label: 'Volume', hint: 'High: a lot', direction: 'favours' };
const C = { id: 'c-bbbbbb', label: 'Compliance', hint: '', direction: 'against' };
const S = { id: 'c-cccccc', label: 'Standardisation', hint: '', direction: 'favours' };
const criteria = [V, C, S];
const L = 1; const M = 2; const H = 3;
const FACE = 'https://contoso.sharepoint.com/sites/pms/PMSClientImages/g-0123456789-abcdef0123.webp';
const grid = (cells) => Object.fromEntries(Object.entries(cells).map(([row, levels]) => [row, Object.fromEntries(levels.map((level, at) => [criteria[at].id, level]))]));
const at = '2026-10-30T10:00:00.000Z';
const answers = [['t1', { a: [H, L, H], b: [L, H, M] }], ['t2', { a: [H, M, M], b: [L, H, L] }], ['t3', { a: [M, L, H], b: [M, H, M] }]].map(([clientTrackId, cells]) => {
  const answer = encodeAnswer(grid(cells));
  return { questionId: 'q', clientTrackId, clientId: 'c-k', answer, firstAnswer: answer, finalAnswer: answer, attempts: 1, correct: null, timestamp: at };
});
const records = {
  session: { id: 's-1', clientId: 'c-k', date: '2026-10-30', sectionIds: ['sec'], status: 'completed', period: 'FY27-Q2' },
  client: { id: 'c-k', name: 'Kroger' },
  tracks: [
    { id: 't1', visitorId: 'v1', participantName: 'Priya Rao', createdAt: '2026-10-30T09:00:00Z' }, { id: 't2', visitorId: 'v2', participantName: 'Ben Carter', createdAt: '2026-10-30T09:01:00Z' },
    { id: 't3', visitorId: 'v3', participantName: 'Chen Wei', createdAt: '2026-10-30T09:02:00Z' },
  ],
  roster: [{ id: 'v1', displayName: 'Priya Rao', guestGroup: 'Finance', pictureUrl: FACE }, { id: 'v2', displayName: 'Ben Carter', guestGroup: 'Finance' }, { id: 'v3', displayName: 'Chen Wei' }],
  sections: [{ id: 'sec', title: 'Art', enabled: true, questionIds: ['q'] }],
  questions: [{ id: 'q', sectionId: 'sec', type: 'art-of-the-possible', prompt: 'Rate each sub-process', optionIds: ['a', 'b'], criteria }],
  options: [{ id: 'a', questionId: 'q', label: 'Row A', value: 20 }, { id: 'b', questionId: 'q', label: 'Row B', value: 10 }],
  answers, visits: [],
};
const tree = () => buildResults({ session: records.session, tracks: records.tracks, sections: records.sections, questions: records.questions, options: records.options, answers });

describe('the tally and the chart model', () => {
  it('the type has its own kind, and is counted by aop-math, never as a bar chart of options', () => {
    assert.equal(chartKind('art-of-the-possible'), 'matrix');
    const [question] = tree().sections[0].questions;
    assert.equal(question.respondents, 3);
    assert.equal(question.aop.fteHigh, 20);
    assert.deepEqual(question.options.map((option) => option.count), [3, 3], 'a row\'s count is the guests who rated it');
  });
  it('the chart: its headline, its rows with rounded words, the band with its shape and word, and where to start', () => {
    const chart = chartOf(tree().sections[0].questions[0], { guests: 4 });
    assert.equal(chart.kind, 'matrix');
    assert.equal(chart.headline, '20 of 30 people (67%) are in High-band sub-processes.');
    assert.equal(chart.metaLine, '3 of 4 guests answered · 2 sub-processes · 30 people in scope');
    assert.equal(chart.wallLine, '3 of 4 have rated');
    assert.deepEqual(chart.rows.map((row) => [row.label, row.opportunityText, row.mark, row.band, row.agreementText, row.people]), [['Row A', '83', '▲', 'High', '67%', 20], ['Row B', '17', '▼', 'Low', '78%', 10]]);
    assert.deepEqual(chart.rows[0].criteria.map((cell) => cell.meanText), ['2.7', '1.3', '2.7']);
    assert.deepEqual(chart.where.start.map((row) => row.label), ['Row A']);
    assert.equal(chart.gradedLine, '');
  });
  it('a heat cell\'s shade follows the mean, in four steps', () => {
    const chart = chartOf(tree().sections[0].questions[0]);
    assert.deepEqual(chart.rows[1].criteria.map((cell) => cell.tone), [0, 3, 1]);
  });
  it('names: nobody without names; with them, who said High in an opened row, in the rules\' order; with pictures, each has one', () => {
    const question = tree().sections[0].questions[0];
    assert.deepEqual(chartOf(question).rows[0].criteria[0].who, []);
    const names = new Map([['t1', 'Priya Rao'], ['t2', 'Ben Carter'], ['t3', 'Chen Wei']]);
    const named = chartOf(question, { names });
    assert.deepEqual(named.rows[0].criteria[0].who.map((who) => who.name), ['Ben Carter', 'Priya Rao'], 'at one time, by name');
    assert.deepEqual(named.rows[0].criteria[0].who.map((who) => 'picture' in who), [false, false]);
    const pictures = picturesFor(records);
    const faced = chartOf(question, { names, pictures });
    assert.deepEqual(faced.rows[0].criteria[0].who.map((who) => who.picture), [null, FACE]);
  });
  it('the Group filter: the same numbers over each group\'s guests', () => {
    const chart = chartOf(tree().sections[0].questions[0], { groups: new Map([['t1', 'Finance'], ['t2', 'Finance']]) });
    assert.deepEqual(chart.views.map((view) => [view.group, view.respondents]), [['Finance', 2], ['No group', 1]]);
    assert.equal(chart.views[0].rows[0].n, 2);
  });
  it('a session with no answers says so, and its figure draws nothing', () => {
    const chart = chartOf({ ...records.questions[0], options: records.options, respondents: 0, responses: [] });
    assert.equal(chart.headline, 'No answers yet.');
    assert.equal(chart.rows[0].opportunityText, '');
    assert.equal(chart.rows[0].mark, '');
    assert.equal(chart.rows[0].bandText, 'No ratings');
  });
  it('every number has its words: Average rating, Opportunity, Band, Agreement, People in High band, Share of people', () => {
    for (const id of ['aop-average', 'aop-opportunity', 'aop-band', 'aop-agreement', 'aop-people-high', 'aop-share']) {
      assert.ok(METRICS[id]?.formula && METRICS[id]?.example, id);
    }
  });
  it('a question of another type has no matrix fields, so its chart is as it was', () => {
    const plain = chartOf({ id: 'p', type: 'single-select', prompt: 'P', respondents: 0, responses: [], options: [] });
    assert.equal('rows' in plain, false);
    assert.equal('where' in plain, false);
  });
});

describe('on paper', () => {
  const measure = { wrap: (text) => [text], width: (text) => text.length, lineHeight: (size) => size * 0.5 };
  it('the figure is the heat map: one rectangle for each cell, the numbers, the band\'s shape and word', () => {
    const chart = chartOf(tree().sections[0].questions[0]);
    const figure = chartFigure(chart, { x: 0, width: 180, palette, measure });
    const texts = figure.items.filter((item) => item.kind === 'text').map((item) => item.text);
    for (const word of ['Row A', '2.7', '83', '▲ High', '▼ Low', '20', 'Volume', 'Opportunity', 'Band', 'People']) assert.ok(texts.includes(word), word);
    assert.equal(figure.items.filter((item) => item.role === 'heat').length, 6);
    assert.ok(figure.h > 0);
    for (const item of figure.items.filter((each) => each.role === 'heat')) assert.ok(palette.ramps[4].includes(item.fill), item.fill);
  });
  it('the summary pack shows at most 10 rows', () => {
    const many = Array.from({ length: 13 }, (_, n) => ({ id: `r${n}`, questionId: 'q', label: `R${n}`, value: 1 }));
    const chart = chartOf({ ...records.questions[0], options: many, responses: [], respondents: 0 });
    const figure = chartFigure(chart, { x: 0, width: 180, palette, measure, matrixRows: 10 });
    const labels = figure.items.filter((item) => item.role === 'label').map((item) => item.text);
    assert.equal(labels.length, 10);
    assert.ok(figure.items.some((item) => item.text === 'And 3 more sub-processes.'));
  });
});

describe('the leader report', () => {
  const report = buildLeaderReport(records, { generatedAt: at, timeZone: 'UTC' });
  const [question] = report.activities[0].questions;
  it('counts it as its own kind, with the hand-worked numbers', () => {
    assert.equal(question.kind, 'matrix');
    assert.equal(question.kindLabel, 'Art of the Possible');
    assert.equal(question.respondents, 3);
    assert.equal(question.removed, 0, 'ratings are not "an answer option that was removed"');
    assert.equal(question.chart.headline, '20 of 30 people (67%) are in High-band sub-processes.');
    assert.deepEqual(question.notes, []);
  });
  it('a person\'s page says how much they rated, and never shows an id', () => {
    const row = report.participants[0].activities[0].rows[0];
    assert.equal(row.said, 'Rated 2 sub-processes');
    assert.ok(!JSON.stringify(report.participants.map((person) => person.activities)).includes('c-aaaaaa'));
  });
  it('the counting rules say first answers only, and that rows nobody rated are not in scope', () => {
    assert.ok(/first/.test(MATRIX_RULE) && /not in scope/.test(MATRIX_RULE));
    assert.equal(report.rules.at(-1), MATRIX_RULE);
    assert.equal(report.rules.length, COUNTING_RULES.length + 1);
    assert.equal(buildLeaderReport({ ...records, sections: [{ id: 'sec', title: 'Art', enabled: true, questionIds: [] }], answers: [] }, { generatedAt: at }).rules, COUNTING_RULES, 'a report without the type says what it always said');
  });
  it('the long CSV: one line for each guest, sub-process and criterion, with the same names; Hide names applies; a formula never starts a cell', () => {
    const csv = matrixLongCsv(report).replace(/^﻿/, '').trim().split('\r\n');
    assert.deepEqual(csv[0].split(','), [...MATRIX_CSV_COLUMNS]);
    assert.deepEqual([...MATRIX_CSV_COLUMNS], ['Client', 'Date', 'Participant', 'Activity', 'Sub-process', 'People', 'Criterion', 'Rating', 'Answered at']);
    assert.equal(csv.length, 1 + 3 * 2 * 3);
    assert.equal(csv[1], 'Kroger,2026-10-30,Priya Rao,Art,Row A,20,Volume,High,2026-10-30 10:00:00');
    const hidden = matrixLongCsv(buildLeaderReport(records, { generatedAt: at, timeZone: 'UTC', hideNames: true }));
    assert.ok(hidden.includes('Guest 1') && !hidden.includes('Priya'));
    const nasty = { ...records, options: [{ ...records.options[0], label: '=SUM(A1)' }, records.options[1]] };
    assert.ok(matrixLongCsv(buildLeaderReport(nasty, { generatedAt: at, timeZone: 'UTC' })).includes("'=SUM(A1)"));
  });
  it('no answer, no line; a session without the type has an empty file\'s header only', () => {
    const none = { ...records, answers: [] };
    assert.equal(matrixLongCsv(buildLeaderReport(none, { generatedAt: at, timeZone: 'UTC' })).trim().split('\r\n').length, 1);
  });
});

describe('the Live display\'s files', () => {
  it('the summary CSV has the type\'s word and a line for each row, with no name', () => {
    const csv = resultsToCsv(tree(), { name: 'Kroger' });
    assert.match(csv, /Art of the Possible/);
    assert.match(csv, /Row A,3,,83,,Yes/);
    assert.ok(!csv.includes('Priya'));
  });
  it('the pack\'s report carries the chart', () => {
    assert.equal(buildReport(tree(), { name: 'Kroger' }).questions[0].chart.kind, 'matrix');
  });
});

describe('a guest\'s picture goes where a name may go, and nowhere else', () => {
  it('Hide names removes it: everyone is the silhouette and Guest N', () => {
    const named = nameParticipants(records);
    assert.equal(named[0].pictureUrl, FACE);
    assert.equal('pictureUrl' in withNamesHidden(named)[0], false);
    assert.equal(picturesFor(records, { hide: true }).size, 0);
    assert.equal(picturesFor(records).get('t1'), FACE);
  });
  it('a guest with no picture has no such key, so a row is what it was', () => {
    assert.equal('pictureUrl' in nameParticipants(records)[1], false);
  });
  it('it is in no export: the leader report\'s data, its CSVs, the pack and the summary hold no address of it', () => {
    const report = buildLeaderReport(records, { generatedAt: at, timeZone: 'UTC' });
    const { at: _clock, ...plain } = report;
    const files = [JSON.stringify(plain), participantAnswersCsv(report), matrixLongCsv(report), resultsToCsv(tree(), { name: 'Kroger' }), JSON.stringify(buildReport(tree(), { name: 'Kroger' })), JSON.stringify(summaryOf(records, report, { at: new Date(at) }))];
    for (const file of files) { assert.ok(!file.includes('g-0123456789'), file.slice(0, 60)); assert.ok(!file.includes('PictureUrl') && !file.includes('pictureUrl'), file.slice(0, 60)); }
  });
  it('the wall\'s charts are given no names and so no pictures', () => {
    const [{ charts: [chart] }] = chartsOf(tree(), { names: null });
    assert.ok(!JSON.stringify(chart).includes('g-0123456789'));
    assert.deepEqual(chart.rows[0].criteria[0].who, []);
  });
});

describe('the summary and the dashboard', () => {
  const report = buildLeaderReport(records, { generatedAt: at, timeZone: 'UTC' });
  const made = summaryOf(records, report, { at: new Date(at) });
  it('the summary\'s aop block: its numbers, the criteria\'s means and the top rows, with no name', () => {
    const { aop } = made.summary;
    assert.deepEqual([aop.questionId, aop.fteInScope, aop.fteHigh, aop.respondents, aop.rowsRated], ['q', 30, 20, 3, 2]);
    assert.ok(Math.abs(aop.shareHigh - 2 / 3) < 1e-9);
    assert.deepEqual(aop.criteria.map((each) => [each.label, each.direction]), [['Volume', 'favours'], ['Compliance', 'against'], ['Standardisation', 'favours']]);
    assert.deepEqual(aop.top.map((row) => [row.name, row.people, row.band]), [['Row A', 20, 'High'], ['Row B', 10, 'Low']]);
    assert.ok(!JSON.stringify(aop).includes('Priya'));
    assert.equal(made.summary.kinds.matrix, 3);
  });
  it('a session without the type has no such block', () => {
    const plain = { ...records, sections: [{ id: 'sec', title: 'Art', enabled: true, questionIds: [] }], answers: [] };
    assert.equal('aop' in summaryOf(plain, buildLeaderReport(plain, { generatedAt: at }), { at: new Date(at) }).summary, false);
  });
  const row = (id, clientId, sessionDate, aop) => ({ id, clientId, sessionDate, period: 'FY27-Q2', guests: 5, completed: 5, afterCount: 0, pairedCount: 0, summary: { startTime: '', aop } });
  const aop = (fteInScope, fteHigh, respondents, name, opportunityIndex = 0.5) => ({ questionId: 'q', fteInScope, fteHigh, shareHigh: fteInScope ? fteHigh / fteInScope : null, respondents, rowsRated: 3, opportunityIndex, criteria: [{ id: 'x', label: 'Volume', direction: 'favours', mean: 2, agreement: 0.8 }, { id: 'y', label: 'Risk', direction: 'against', mean: 1, agreement: 0.5 }], top: [{ name, people: 5, opportunity: 80, band: 'High' }] });
  const clients = [{ id: 'a', name: 'Kroger' }, { id: 'b', name: 'Domino\'s' }];
  const filters = { period: 'FY27-Q2', year: 'FY27', span: 'q2', compare: 'all', clientIds: [] };
  it('the section: people counted once for a client with two sessions, a second client adds, and its tiles', () => {
    const summaries = [row('a1', 'a', '2026-10-01', aop(100, 10, 12, 'Old')), row('a2', 'a', '2026-10-20', aop(110, 55, 12, 'GL')), row('b1', 'b', '2026-10-10', aop(40, 20, 12, 'Ops'))];
    const board = dashboardOf({ summaries, clients, filters });
    assert.deepEqual([board.aop.fteInScope, board.aop.fteHigh], [150, 75]);
    assert.equal(board.aop.tiles.find((tile) => tile.id === 'aop-people-high').text, '75 of 150 (50%)');
    assert.equal(board.aop.tiles.find((tile) => tile.id === 'aop-rated').text, '9');
    assert.equal(board.aop.tiles.find((tile) => tile.id === 'aop-agreed').text, 'Volume');
    assert.deepEqual(board.aop.byClient.map((client) => [client.name, client.top, client.fteHigh, client.shareText, client.indexText]), [['Domino\'s', 'Ops', 20, '50%', '0.50'], ['Kroger', 'GL', 55, '50%', '0.50']]);
  });
  it('a low sample says so, and sessions with no block are counted for the note', () => {
    const summaries = [row('a1', 'a', '2026-10-01', aop(10, 5, 3, 'GL')), row('a2', 'a', '2026-10-02', undefined)];
    const board = dashboardOf({ summaries, clients, filters });
    assert.equal(board.aop.tiles[0].low, true);
    assert.equal(board.aop.waiting, 1);
  });
  it('no session in view has it: no section, and the file is as it was', () => {
    const board = dashboardOf({ summaries: [row('a1', 'a', '2026-10-01', undefined)], clients, filters });
    assert.equal(board.aop, null);
    assert.ok(!reportCsv(board).includes('High-band'));
  });
  it('the dashboard\'s file gains the columns when it has them', () => {
    const board = dashboardOf({ summaries: [row('a1', 'a', '2026-10-01', aop(10, 5, 12, 'GL'))], clients, filters });
    const [head, first] = reportCsv(board).trim().split('\r\n');
    assert.ok(head.endsWith('Top sub-process,People in High band,People in scope,Share in High band %,Opportunity index'), head);
    assert.ok(first.endsWith('GL,5,10,50,0.5'), first);
  });
  it('a summary keeps its block through the list and back', () => {
    assert.equal(summaryFromItem(summaryRecord(made)).summary.aop.fteHigh, 20);
  });
});
