// Prompt 23, Part 2: an Art of the Possible question's answer (lib/participant/aop-answer.js) and its numbers (lib/results/aop-math.js), held to sessions
// worked out by hand. The hand-worked oracle of the brief is the first describe: three guests, two rows, three criteria.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_MATRIX_ANSWER, cellsLeft, cycle, decodeAnswer, encodeAnswer, isComplete, nextEmpty } from '../migration/src/lib/participant/aop-answer.js';
import { aopResults, byGroup, criterionProfile, poolAop, whereToStart } from '../migration/src/lib/results/aop-math.js';

const V = { id: 'c-aaaaaa', label: 'Volume', direction: 'favours' };
const C = { id: 'c-bbbbbb', label: 'Compliance', direction: 'against' };
const S = { id: 'c-cccccc', label: 'Standardisation', direction: 'favours' };
const N = { id: 'c-dddddd', label: 'Interest', direction: 'none' };
const rows = [{ id: 'row-a', label: 'Row A', value: 20 }, { id: 'row-b', label: 'Row B', value: 10 }];
const L = 1; const M = 2; const H = 3;
const close = (actual, expected, what = '') => assert.ok(Math.abs(actual - expected) < 0.01, `${what}: ${actual} is not ${expected}`);

/** One guest's answer record, from { rowId: [V, C, S] } in `criteria`'s order. */
const answerOf = (key, cells, criteria = [V, C, S]) => {
  const grid = {};
  for (const [rowId, levels] of Object.entries(cells)) { grid[rowId] = {}; levels.forEach((level, at) => { if (level) grid[rowId][criteria[at].id] = level; }); }
  const answer = encodeAnswer(grid);
  return { clientTrackId: key, answer, firstAnswer: answer };
};
const three = [
  answerOf('g1', { 'row-a': [H, L, H], 'row-b': [L, H, M] }),
  answerOf('g2', { 'row-a': [H, M, M], 'row-b': [L, H, L] }),
  answerOf('g3', { 'row-a': [M, L, H], 'row-b': [M, H, M] }),
];

describe('the hand-worked session of the brief', () => {
  const result = aopResults({ rows, criteria: [V, C, S], answers: three });
  const [a, b] = result.rows;
  it('row A: means 2.667, 1.333, 2.667; aligned 2.667 each; opportunity 83.33, High; agreement 66.7%', () => {
    close(a.criteria[0].mean, 2.667, 'volume'); close(a.criteria[1].mean, 1.333, 'compliance'); close(a.criteria[2].mean, 2.667, 'standardisation');
    for (const criterion of a.criteria) close(criterion.aligned, 2.667, criterion.id);
    close(a.opportunity, 83.33, 'opportunity');
    assert.equal(a.band, 'High');
    close(a.agreement * 100, 66.67, 'agreement');
    assert.equal(a.split, false);
    assert.deepEqual(a.criteria[0].counts, { 1: 0, 2: 1, 3: 2 });
    assert.equal(a.criteria[0].n, 3);
  });
  it('row B: means 1.333, 3.000, 1.667; aligned 1.333, 1.000, 1.667; opportunity 16.67, Low; agreement 77.8%', () => {
    close(b.criteria[0].mean, 1.333); close(b.criteria[1].mean, 3); close(b.criteria[2].mean, 1.667);
    close(b.criteria[0].aligned, 1.333); close(b.criteria[1].aligned, 1); close(b.criteria[2].aligned, 1.667);
    close(b.opportunity, 16.67, 'opportunity');
    assert.equal(b.band, 'Low');
    close(b.agreement * 100, 77.78, 'agreement');
  });
  it('totals: 30 people in scope, 20 in High, a share of 66.7%, three guests', () => {
    assert.equal(result.fteInScope, 30);
    assert.equal(result.fteHigh, 20);
    close(result.shareHigh * 100, 66.67, 'share');
    assert.equal(result.respondents, 3);
    close(result.opportunityIndex, (20 * 83.333 + 10 * 16.667) / 30 / 100, 'index');
  });
});

describe('the cases around it', () => {
  it('a row nobody rated is not in scope, and says so', () => {
    const more = [...rows, { id: 'row-c', label: 'Row C', value: 99 }];
    const result = aopResults({ rows: more, criteria: [V, C, S], answers: three });
    const c = result.rows[2];
    assert.deepEqual([c.n, c.opportunity, c.band, c.agreement, c.split, c.inScope], [0, null, null, null, false, false]);
    assert.equal(result.fteInScope, 30);
  });
  it('one guest who rated one row and not another counts only where they rated', () => {
    const answers = [...three, answerOf('g4', { 'row-b': [L, H, L] })];
    const result = aopResults({ rows, criteria: [V, C, S], answers });
    assert.equal(result.rows[0].n, 3);
    assert.equal(result.rows[1].n, 4);
    assert.equal(result.respondents, 4);
  });
  it('a criterion that is not in the score is shown and never scored', () => {
    const answers = [answerOf('g1', { 'row-a': [H, H] }, [V, N]), answerOf('g2', { 'row-a': [L, L] }, [V, N])];
    const [a] = aopResults({ rows, criteria: [V, N], answers }).rows;
    assert.equal(a.criteria[1].mean, 2);
    assert.equal(a.criteria[1].aligned, undefined);
    assert.equal(a.opportunity, 50);
    assert.equal(a.agreement, 0.5, 'agreement is over the scored criteria only');
    assert.equal(a.split, true);
  });
  it('only criteria that are not in the score: no opportunity and no band', () => {
    const [a] = aopResults({ rows, criteria: [N], answers: [answerOf('g1', { 'row-a': [H] }, [N])] }).rows;
    assert.deepEqual([a.opportunity, a.band, a.agreement], [null, null, null]);
    assert.equal(a.inScope, true, 'it was rated');
  });
  it('two criteria only', () => {
    const [a] = aopResults({ rows, criteria: [V, C], answers: [answerOf('g1', { 'row-a': [H, L] }, [V, C])] }).rows;
    assert.equal(a.opportunity, 100);
    assert.equal(a.band, 'High');
  });
  it('a deleted criterion\'s stored ratings are ignored, and counted as dropped', () => {
    const answers = [answerOf('g1', { 'row-a': [H, L, H] })];
    const result = aopResults({ rows, criteria: [V, S], answers });
    assert.deepEqual(result.rows[0].criteria.map((criterion) => criterion.id), [V.id, S.id]);
    assert.equal(result.rows[0].opportunity, 100);
    assert.equal(result.dropped, 1);
  });
  it('a row added after a guest answered is not counted for that guest, and a later answer fills only what the first left empty', () => {
    const before = answerOf('g1', { 'row-a': [H, L, H] });
    assert.equal(aopResults({ rows, criteria: [V, C, S], answers: [before] }).rows[1].n, 0);
    const later = answerOf('g1', { 'row-a': [L, H, L], 'row-b': [H, L, H] });
    const result = aopResults({ rows, criteria: [V, C, S], answers: [{ clientTrackId: 'g1', firstAnswer: before.answer, answer: later.answer }] });
    assert.equal(result.rows[0].criteria[0].mean, 3, 'row A keeps the first answer');
    assert.equal(result.rows[1].criteria[0].mean, 3, 'row B, which the first answer could not hold, comes from the later one');
  });
  it('all-equal ratings: full agreement, and the middle of the scale is Medium', () => {
    const answers = ['g1', 'g2', 'g3'].map((key) => answerOf(key, { 'row-a': [M, M, M] }));
    const [a] = aopResults({ rows, criteria: [V, C, S], answers }).rows;
    assert.deepEqual([a.opportunity, a.band, a.agreement, a.split], [50, 'Medium', 1, false]);
  });
  it('the bands are decided on the unrounded number: two thirds is High, one third is Medium', () => {
    // Aligned means of 7/3 over three criteria (H, M, M) is exactly 200/3; of 5/3 (M, L, M) is exactly 100/3.
    const high = aopResults({ rows, criteria: [V, S, { ...S, id: 'c-eeeeee' }], answers: [answerOf('g', { 'row-a': [H, M, M] }, [V, S, { ...S, id: 'c-eeeeee' }])] }).rows[0];
    const middle = aopResults({ rows, criteria: [V, S, { ...S, id: 'c-eeeeee' }], answers: [answerOf('g', { 'row-a': [M, L, M] }, [V, S, { ...S, id: 'c-eeeeee' }])] }).rows[0];
    assert.equal(high.band, 'High');
    assert.equal(middle.band, 'Medium');
  });
  it('one respondent: agreement 100%, flagged as one guest', () => {
    const [a] = aopResults({ rows, criteria: [V, C, S], answers: [answerOf('g1', { 'row-a': [H, L, H] })] }).rows;
    assert.deepEqual([a.agreement, a.single], [1, true]);
  });
  it('no answers at all: nothing in scope, and a share of nothing is null, not 0', () => {
    const result = aopResults({ rows, criteria: [V, C, S], answers: [] });
    assert.deepEqual([result.fteInScope, result.fteHigh, result.shareHigh, result.respondents, result.opportunityIndex], [0, 0, null, 0, null]);
  });
  it('rows of 0 people: in scope, and a share over 0 people is null', () => {
    const zero = [{ id: 'row-a', label: 'Row A', value: '' }];
    const result = aopResults({ rows: zero, criteria: [V], answers: [answerOf('g', { 'row-a': [H] }, [V])] });
    assert.deepEqual([result.fteInScope, result.shareHigh, result.rows[0].people], [0, null, 0]);
  });
  it('where to start: High-band rows by people, largest first; a split one is apart', () => {
    const many = [{ id: 'p', label: 'P', value: 5 }, { id: 'q', label: 'Q', value: 50 }, { id: 'r', label: 'R', value: 30 }, { id: 's', label: 'S', value: 1 }];
    // r is High on the mean of H,H,H and H,H,M but with criteria split between three guests: High overall and under 60% agreement.
    const criteria = [V, S];
    const answers = [
      answerOf('g1', { p: [H, H], q: [H, H], r: [H, M], s: [L, L] }, criteria),
      answerOf('g2', { p: [H, H], q: [H, H], r: [M, H], s: [L, L] }, criteria),
      answerOf('g3', { p: [H, H], q: [H, H], r: [H, M], s: [L, L] }, criteria),
      answerOf('g4', { p: [H, H], q: [H, H], r: [M, H], s: [L, L] }, criteria),
    ];
    const result = aopResults({ rows: many, criteria, answers });
    assert.equal(result.rows[2].band, 'High');
    assert.equal(result.rows[2].split, true);
    const where = whereToStart(result);
    assert.deepEqual(where.start.map((row) => row.id), ['q', 'p']);
    assert.deepEqual(where.discuss.map((row) => row.id), ['r']);
    assert.equal(where.line, '85 of 86 people (99%) are in High-band sub-processes');
  });
  it('byGroup: each group\'s answers, and a guest with none under "No group"', () => {
    const groups = byGroup(three, (key) => ({ g1: 'Finance', g2: 'Finance' }[key] ?? ''));
    assert.deepEqual(groups.map((group) => [group.group, group.answers.length]), [['Finance', 2], ['No group', 1]]);
  });
  it('the criterion profile is the mean of every cell of each criterion', () => {
    const profile = criterionProfile(aopResults({ rows, criteria: [V, C, S], answers: three }));
    assert.deepEqual(profile.map((each) => each.id), [V.id, C.id, S.id]);
    close(profile[0].mean, 2, 'volume over both rows');
    close(profile[1].mean, 2.167, 'compliance');
    assert.equal(profile[0].n, 6);
  });
});

describe('the dashboard\'s pooling: people are a client\'s, so they are never added twice', () => {
  const session = (id, clientId, sessionDate, fteInScope, fteHigh, respondents, means) => ({ id, clientId, sessionDate, summary: { aop: { fteInScope, fteHigh, respondents, shareHigh: fteInScope ? fteHigh / fteInScope : null, criteria: [{ id: 'x', label: 'Volume', direction: 'favours', mean: means }], rowsRated: 3, opportunityIndex: 0.5 } } });
  it('a client with two sessions counts its most recent; a second client adds; criteria weigh each session by its guests', () => {
    const pooled = poolAop([session('a1', 'a', '2026-01-01', 100, 10, 10, 1), session('a2', 'a', '2026-06-01', 110, 55, 30, 3), session('b1', 'b', '2026-03-01', 40, 20, 10, 2)]);
    assert.equal(pooled.fteInScope, 150);
    assert.equal(pooled.fteHigh, 75);
    assert.equal(pooled.shareHigh, 0.5);
    assert.equal(pooled.criteria[0].mean, (1 * 10 + 3 * 30 + 2 * 10) / 50);
    assert.deepEqual(pooled.clients.map((client) => [client.clientId, client.fteHigh]), [['a', 55], ['b', 20]]);
  });
  it('no session with the question: null', () => {
    assert.equal(poolAop([{ id: 'x', clientId: 'a', sessionDate: '2026-01-01', summary: {} }]), null);
  });
});

describe('the answer', () => {
  const criteria = [V, C];
  const shape = { rows, criteria };
  it('encodes one string a rated row, and decodes back', () => {
    const grid = { 'row-a': { [V.id]: 3, [C.id]: 1 }, 'row-b': { [V.id]: 2 } };
    const list = encodeAnswer(grid);
    assert.deepEqual(list, ['row-a:c-aaaaaa=3,c-bbbbbb=1', 'row-b:c-aaaaaa=2']);
    assert.deepEqual(decodeAnswer(list, shape), { grid, dropped: 0 });
  });
  it('a copied id, with its ~, survives', () => {
    const id = 'o-kroger-1~c-dominos';
    const list = encodeAnswer({ [id]: { [V.id]: 2 } });
    assert.deepEqual(decodeAnswer(list, { rows: [{ id }], criteria }).grid, { [id]: { [V.id]: 2 } });
  });
  it('is tolerant: a damaged entry, an unknown row or criterion and a level outside 1 to 3 are dropped and counted, never thrown', () => {
    const list = ['row-a:c-aaaaaa=3,c-bbbbbb=9', 'row-a', 'gone:c-aaaaaa=1', 'row-b:c-zzzzzz=2', 42, null, 'row-b:c-aaaaaa=x', ''];
    const { grid, dropped } = decodeAnswer(list, shape);
    assert.deepEqual(grid, { 'row-a': { [V.id]: 3 } });
    assert.equal(dropped, 8);
    assert.deepEqual(decodeAnswer('not a list', shape), { grid: {}, dropped: 1 });
    assert.deepEqual(decodeAnswer(undefined, shape), { grid: {}, dropped: 0 });
  });
  it('a later rating of the same cell wins, as an edit would', () => {
    assert.equal(decodeAnswer(['row-a:c-aaaaaa=1', 'row-a:c-aaaaaa=3'], shape).grid['row-a'][V.id], 3);
  });
  it('cycles unset, Low, Medium, High, unset', () => {
    assert.deepEqual([cycle(undefined), cycle(1), cycle(2), cycle(3), cycle(0)], [1, 2, 3, undefined, 1]);
  });
  it('counts what is left, is complete at none, and finds the next empty box from where it is', () => {
    const grid = { 'row-a': { [V.id]: 1 } };
    assert.equal(cellsLeft(grid, shape), 3);
    assert.equal(isComplete(grid, shape), false);
    assert.deepEqual(nextEmpty(grid, shape), { rowId: 'row-a', criterionId: C.id });
    assert.deepEqual(nextEmpty({ ...grid, 'row-a': { [V.id]: 1, [C.id]: 2 } }, shape), { rowId: 'row-b', criterionId: V.id });
    const full = { 'row-a': { [V.id]: 1, [C.id]: 1 }, 'row-b': { [V.id]: 1, [C.id]: 1 } };
    assert.equal(cellsLeft(full, shape), 0);
    assert.equal(isComplete(full, shape), true);
    assert.equal(nextEmpty(full, shape), null);
    assert.deepEqual(nextEmpty({ 'row-b': { [V.id]: 1 } }, shape, { rowId: 'row-b', criterionId: V.id }), { rowId: 'row-b', criterionId: C.id }, 'after this box');
  });
  it('a row added since is a box left; a removed row is not; ratings of a removed row do not make it complete', () => {
    const grid = { gone: { [V.id]: 1, [C.id]: 1 }, 'row-a': { [V.id]: 1, [C.id]: 1 } };
    assert.equal(cellsLeft(grid, shape), 2);
  });
  it('25 rows by 6 criteria stay under the cap, even with long copied ids', () => {
    const long = Array.from({ length: 25 }, (_, at) => ({ id: `${crypto.randomUUID()}~c-a-rather-long-client-${at}` }));
    const six = Array.from({ length: 6 }, (_, at) => ({ id: `c-${String(at).repeat(6)}` }));
    const grid = Object.fromEntries(long.map((row) => [row.id, Object.fromEntries(six.map((criterion) => [criterion.id, 3]))]));
    const list = encodeAnswer(grid);
    assert.ok(list.join('').length < MAX_MATRIX_ANSWER, `${list.join('').length}`);
    assert.equal(MAX_MATRIX_ANSWER, 6000);
    assert.equal(isComplete(decodeAnswer(list, { rows: long, criteria: six }).grid, { rows: long, criteria: six }), true);
  });
});
