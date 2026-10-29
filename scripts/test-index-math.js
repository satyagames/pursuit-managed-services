// Prompt 21, Phase 5: the Leadership dashboard's arithmetic (lib/results/index-math.js), worked out by hand, and properties that hold for any
// summaries. Run: node --test scripts/test-index-math.js (part of `npm test`). scripts/oracle-results.js recounts the same figures by rules of its own.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BASELINES, MIN_SAMPLE, baselineOf, change, clientIndex, firstChoiceShares, indexOf, lowSample, meanAfterOf, movedOf, periodRange, priorQuarter,
  pairedMeansOf, priorityIndex, sameQuarterLastYear, sessionIndex, shiftOf,
} from '../migration/src/lib/results/index-math.js';

/** A session's summary as PMSSessionSummary keeps it (only what the arithmetic reads). */
const summary = (id, clientId, period, afterCount, meanAfter, extra = {}) => ({
  id, clientId, period, guests: afterCount, answers: 0, completed: 0, beforeCount: 0, afterCount, pairedCount: 0, meanBefore: null, meanAfter, summary: {}, ...extra,
});

describe('indexOf: segment / baseline x 100', () => {
  it('is the ratio times 100', () => {
    assert.ok(Math.abs(indexOf(4.4, 4) - 110) < 1e-9);
    assert.equal(indexOf(3, 4), 75);
    assert.equal(indexOf(4, 4), 100);
  });
  it('guards a baseline of nothing: zero, missing or not a number gives null, never Infinity', () => {
    for (const baseline of [0, null, undefined, Number.NaN, -1]) assert.equal(indexOf(3, baseline), null);
    for (const segment of [null, undefined, Number.NaN]) assert.equal(indexOf(segment, 4), null);
    assert.equal(indexOf(0, 4), 0);
  });
});

describe('the confidence index of a client and of a session', () => {
  // Kroger: two sessions, 10 Afters at 4.0 and 30 at 3.0, so its mean After is (40 + 90) / 40 = 3.25.
  // Baseline: every session, Kroger's two and Acme's one of 40 Afters at 3.5: (40 + 90 + 140) / 80 = 3.375.
  const kroger = [summary('k1', 'kroger', 'FY27-Q2', 10, 4), summary('k2', 'kroger', 'FY27-Q2', 30, 3)];
  const acme = [summary('a1', 'acme', 'FY27-Q2', 40, 3.5)];
  it('a client\'s mean After weighs each session by its Afters', () => {
    assert.deepEqual(meanAfterOf(kroger), { mean: 3.25, n: 40 });
    assert.deepEqual(meanAfterOf([...kroger, ...acme]), { mean: 3.375, n: 80 });
    assert.deepEqual(meanAfterOf([]), { mean: null, n: 0 });
    assert.deepEqual(meanAfterOf([summary('x', 'x', 'FY27-Q2', 0, null)]), { mean: null, n: 0 });
  });
  it('client index = its mean After / the baseline\'s x 100', () => {
    assert.ok(Math.abs(clientIndex(kroger, [...kroger, ...acme]) - (3.25 / 3.375) * 100) < 1e-9);
    assert.ok(Math.abs(clientIndex(acme, [...kroger, ...acme]) - (3.5 / 3.375) * 100) < 1e-9);
    assert.equal(clientIndex([], acme), null);
  });
  it('session index is against the client\'s own average', () => {
    assert.ok(Math.abs(sessionIndex(kroger[0], kroger) - (4 / 3.25) * 100) < 1e-9);
    assert.ok(Math.abs(sessionIndex(kroger[1], kroger) - (3 / 3.25) * 100) < 1e-9);
  });
  it('the weighted average of the sessions\' indexes against their client is 100', () => {
    const weighted = kroger.reduce((sum, each) => sum + each.afterCount * sessionIndex(each, kroger), 0) / 40;
    assert.ok(Math.abs(weighted - 100) < 1e-9);
  });
});

describe('the priority index: share of first choices against the baseline\'s share', () => {
  const firsts = (counts) => ({ firstChoices: [{ questionId: 'q', prompt: 'Which first?', options: Object.entries(counts).map(([label, count]) => ({ label, count })) }] });
  // Segment: Speed 6, Cost 4 (shares 60% and 40%). Baseline: Speed 10, Cost 10, Trust 20 (25%, 25%, 50%).
  const segment = [summary('s', 'kroger', 'FY27-Q2', 0, null, { summary: firsts({ Speed: 6, Cost: 4 }) })];
  const baseline = [...segment, summary('b', 'acme', 'FY27-Q2', 0, null, { summary: firsts({ Speed: 4, cost: 6, Trust: 20 }) })];
  it('shares group options by their label, whatever its case and spaces', () => {
    const shares = firstChoiceShares(baseline);
    assert.equal(shares.total, 40);
    assert.deepEqual(shares.rows.map((row) => [row.label, row.count]), [['Trust', 20], ['Cost', 10], ['Speed', 10]], 'most chosen first, a tie by label');
  });
  it('is the segment\'s share / the baseline\'s share x 100', () => {
    assert.ok(Math.abs(priorityIndex('Speed', segment, baseline) - (0.6 / 0.25) * 100) < 1e-9);
    assert.ok(Math.abs(priorityIndex('cost ', segment, baseline) - (0.4 / 0.25) * 100) < 1e-9);
    assert.equal(priorityIndex('Trust', segment, baseline), 0);
    assert.equal(priorityIndex('Nobody chose this', segment, baseline), null);
    assert.equal(priorityIndex('Speed', [], baseline), null);
  });
});

describe('change, low sample and the pooled shift', () => {
  it('change is now minus then, in index points; null without both', () => {
    assert.equal(change(112, 104), 8);
    assert.equal(change(96, 100), -4);
    assert.equal(change(null, 100), null);
    assert.equal(change(100, null), null);
  });
  it('a figure is low sample below the minimum (10 unless the setting says otherwise)', () => {
    assert.equal(MIN_SAMPLE, 10);
    assert.equal(lowSample(9), true);
    assert.equal(lowSample(10), false);
    assert.equal(lowSample(4, 5), true);
    assert.equal(lowSample(5, 5), false);
    assert.equal(lowSample(3, 'not a number'), true);
  });
  it('the shift pools the paired guests of every session, each as a share of its own scale', () => {
    // 4 paired on a 5-point scale moving 2.0 to 3.0 (+20%), 6 paired on a 4-point scale moving 2.0 to 3.0 (+25%): (4 x 20 + 6 x 25) / 10 = 23.
    const one = summary('1', 'c', 'FY27-Q2', 4, 3, { pairedCount: 4, summary: { scaleMax: 5, pairedBefore: 2, pairedAfter: 3, moved: { started: 2, moved: 1 } } });
    const two = summary('2', 'c', 'FY27-Q2', 6, 3, { pairedCount: 6, summary: { scaleMax: 4, pairedBefore: 2, pairedAfter: 3, moved: { started: 2, moved: 2 } } });
    assert.deepEqual(shiftOf([one, two]), { percent: 23, n: 10 });
    assert.deepEqual(movedOf([one, two]), { percent: 75, started: 4, moved: 3 });
    assert.deepEqual(shiftOf([]), { percent: null, n: 0 });
    assert.deepEqual(movedOf([summary('3', 'c', 'FY27-Q2', 1, 3)]), { percent: null, started: 0, moved: 0 });
  });
  it('Prompt 22: the paired means the shift moved between, weighed by paired guests, only over sessions of one scale', () => {
    // 30 paired at 2.0 to 3.0 and 10 at 3.0 to 3.0, both on 5: Before (60 + 30) / 40 = 2.25, After (90 + 30) / 40 = 3.0; (3.0 - 2.25) / 5 = 15%, as shiftOf says.
    const one = summary('1', 'c', 'FY27-Q2', 30, 3, { pairedCount: 30, summary: { scaleMax: 5, pairedBefore: 2, pairedAfter: 3 } });
    const two = summary('2', 'c', 'FY27-Q2', 10, 3, { pairedCount: 10, summary: { scaleMax: 5, pairedBefore: 3, pairedAfter: 3 } });
    const beforeOnly = summary('3', 'c', 'FY27-Q2', 0, null, { beforeCount: 8, summary: { scaleMax: 5, pairedBefore: null, pairedAfter: null } });
    assert.deepEqual(pairedMeansOf([one, two, beforeOnly]), { before: 2.25, after: 3, n: 40, scaleMax: 5 });
    assert.equal(shiftOf([one, two]).percent, ((3 - 2.25) * 100) / 5);
    const four = summary('4', 'c', 'FY27-Q2', 6, 3, { pairedCount: 6, summary: { scaleMax: 4, pairedBefore: 2, pairedAfter: 3 } });
    assert.deepEqual(pairedMeansOf([one, four]), { before: null, after: null, n: 36, scaleMax: null }, 'means of two scales are not one mean');
    assert.deepEqual(pairedMeansOf([beforeOnly]), { before: null, after: null, n: 0, scaleMax: null });
  });
});

describe('quarters and baselines, from the fiscal-year start month', () => {
  it('the quarter before and the same quarter a year before', () => {
    assert.equal(priorQuarter('FY27-Q2'), 'FY27-Q1');
    assert.equal(priorQuarter('FY27-Q1'), 'FY26-Q4');
    assert.equal(priorQuarter('FY00-Q1'), 'FY99-Q4');
    assert.equal(sameQuarterLastYear('FY27-Q2'), 'FY26-Q2');
    assert.equal(priorQuarter('not a period'), '');
  });
  it('a period\'s days, with June as the start (FY27 is June 2026 to May 2027)', () => {
    assert.deepEqual(periodRange('FY27-Q1', 6), { from: '2026-06-01', to: '2026-08-31' });
    assert.deepEqual(periodRange('FY27-Q2', 6), { from: '2026-09-01', to: '2026-11-30' });
    assert.deepEqual(periodRange('FY27-Q4', 6), { from: '2027-03-01', to: '2027-05-31' });
    assert.deepEqual(periodRange('FY27', 6), { from: '2026-06-01', to: '2027-05-31' });
    assert.deepEqual(periodRange('FY27-Q1', 1), { from: '2027-01-01', to: '2027-03-31' });
    assert.deepEqual(periodRange('FY28-Q1', 2), { from: '2027-02-01', to: '2027-04-30' });
    assert.deepEqual(periodRange('FY28-Q4', 2), { from: '2027-11-01', to: '2028-01-31' });
    assert.equal(periodRange('nonsense', 6), null);
  });
  it('the four baselines pick their summaries', () => {
    const all = [
      summary('a', 'kroger', 'FY27-Q2', 1, 3), summary('b', 'acme', 'FY27-Q2', 1, 3), summary('c', 'kroger', 'FY27-Q1', 1, 3),
      summary('d', 'acme', 'FY26-Q2', 1, 3), summary('e', 'acme', 'FY27-Q2', 1, 3),
    ];
    const ids = (list) => list.map((each) => each.id).sort().join('');
    assert.deepEqual(BASELINES.map((baseline) => baseline.id), ['all', 'prior-quarter', 'last-year', 'client']);
    assert.equal(ids(baselineOf(all, { kind: 'all', periods: ['FY27-Q2'] })), 'abe');
    assert.equal(ids(baselineOf(all, { kind: 'prior-quarter', periods: ['FY27-Q2'] })), 'c');
    assert.equal(ids(baselineOf(all, { kind: 'last-year', periods: ['FY27-Q2'] })), 'd');
    assert.equal(ids(baselineOf(all, { kind: 'client', periods: ['FY27-Q2'], clientId: 'acme' })), 'be');
    assert.equal(ids(baselineOf(all, { kind: 'all', periods: null })), 'abcde');
    assert.equal(ids(baselineOf(all, { kind: 'unknown', periods: ['FY27-Q2'] })), 'abe');
  });
});

describe('properties over random summaries', () => {
  it('scaling every mean After scales nothing: an index is a ratio', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const rand = (n) => ((seed * 9301 + n * 49297) % 233280) / 233280;
      const list = Array.from({ length: 1 + (seed % 7) }, (_, at) => summary(`s${at}`, at % 2 ? 'a' : 'b', 'FY27-Q2', 1 + Math.floor(rand(at) * 40), 1 + rand(at + 50) * 4));
      const doubled = list.map((each) => ({ ...each, meanAfter: each.meanAfter * 2 }));
      const one = clientIndex(list.filter((each) => each.clientId === 'a'), list);
      const two = clientIndex(doubled.filter((each) => each.clientId === 'a'), doubled);
      assert.ok(one === null ? two === null : Math.abs(one - two) < 1e-9, `seed ${seed}`);
      assert.ok(Math.abs(clientIndex(list, list) - 100) < 1e-9, `seed ${seed}: the whole against itself is 100`);
    }
  });
});

describe('Prompt 22: the oracle recounts each client\'s and each session\'s shift, and catches a shift pooled the wrong way', async () => {
  const math = await import('../migration/src/lib/results/index-math.js');
  const { compareIndexes, generateIndexes, indexOracle } = await import('./oracle-results.js');
  const diffsOver = (indexMath, seeds = 60) => Array.from({ length: seeds }, (_, at) => generateIndexes(at + 1))
    .flatMap((fixture) => compareIndexes(fixture, indexOracle(fixture), { indexMath }));
  const plain = (each) => (each.length ? each.reduce((total, value) => total + value, 0) / each.length : null);

  it('the app and the oracle agree, client by client and session by session', () => {
    assert.deepEqual(diffsOver(math), []);
  });
  it('a mutant that pools a client\'s shift by a plain mean of its sessions\' percents is caught', () => {
    const shiftOf = (summaries) => {
      const percents = summaries.map((each) => math.shiftOf([each])).filter((each) => each.percent !== null);
      return { percent: plain(percents.map((each) => each.percent)), n: percents.reduce((total, each) => total + each.n, 0) };
    };
    assert.ok(diffsOver({ ...math, shiftOf }).some((line) => /'s shift is /.test(line)), 'the plain mean went unseen');
  });
  it('a mutant that pools moved to confident by a plain mean of its sessions\' percents is caught', () => {
    const movedOf = (summaries) => {
      const each = summaries.map((one) => math.movedOf([one])).filter((one) => one.percent !== null);
      return { percent: plain(each.map((one) => one.percent)), started: 0, moved: 0 };
    };
    assert.ok(diffsOver({ ...math, movedOf }).some((line) => /moved to confident is /.test(line)), 'the plain mean went unseen');
  });
});
