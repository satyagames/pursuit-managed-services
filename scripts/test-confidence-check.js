// Phase 20: the confidence check, Before and After. Run: node --test scripts/test-confidence-check.js (part of `npm test`).
//
// Part 0: the proof that the two answers can live in the answers the app already keeps (docs/DECISIONS.md, "The confidence check"): a record
// `<questionId>@before` and one `<questionId>@after` in the visit's ResponsesJson survive the save (participantFields), the merge
// (mergeAnswerRecords), the device's store (record, save, restore) and a restart, on the mocked SharePoint REST, and the session's results
// count every question exactly as they did without them.
// Part 2: the arithmetic of lib/results/confidence-shift.js, worked out by hand, and properties that hold for any answers.
// Part 3: every row of the flow table (board 14) against lib/participant/confidence-check.js nextStep().
import './fresh-page.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as ds from '../migration/src/lib/data/dataService.js';
import { createAnswerStore } from '../migration/src/lib/participant/answer-store.js';
import {
  CHECK_KIND, FLOW_RULES, STEP_PATHS, afterId, beforeId, checkOf, isCheckActivity, isCheckRecord, nextStep, parseCheckId, stepPath,
} from '../migration/src/lib/participant/confidence-check.js';
import {
  MIN_SAMPLE, confidenceCheckResults, confidenceIndex, confidenceLine, confidenceShift, confidentMin, distributionBeforeAfter, lowSample,
  movedToConfident, notConfidentMax, pairCheckAnswers, scaleMaxOf, shiftDivisor,
} from '../migration/src/lib/results/confidence-shift.js';
import { buildResults } from '../migration/src/lib/results/results-tally.js';
import { readSessionResults } from '../migration/src/lib/results/session-results.js';
import { samplePack } from '../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../migration/src/lib/setup/seed.js';
import { createSharePointFake } from './sharepoint-fake.js';

const DAY = '2026-10-27';
const record = (questionId, answer, extra = {}) => ({ questionId, answer, firstAnswer: answer, attempts: 1, correct: null, answeredAt: '2026-10-27T10:00:00.000Z', ...extra });
const memoryStorage = () => {
  const map = new Map();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: (key) => { map.delete(key); } };
};

/** A fake SharePoint with the sample clients seeded and Kroger live, and a visit begun. */
async function liveVisit() {
  const fake = createSharePointFake();
  const restore = fake.install();
  ds.configure({ sharePoint: fake.settings });
  await seedPack(ds, samplePack());
  const { session } = await ds.activateClient('c-kroger', DAY);
  const track = await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger');
  return { restore, fake, session, track, visit: { trackId: track.id, sessionId: session.id, clientId: 'c-kroger', restartedAt: null } };
}

// ---- Part 0 ----------------------------------------------------------------------------------------------------------------------

describe('Part 0: Before and After are two records in the answers the app already keeps', () => {
  it('the ids are the question id with @before and @after, and nothing else reads as one', () => {
    assert.equal(beforeId('q-check'), 'q-check@before');
    assert.equal(afterId('q-check'), 'q-check@after');
    assert.deepEqual(parseCheckId('q-check@before'), { questionId: 'q-check', phase: 'before' });
    assert.deepEqual(parseCheckId('q@x@after'), { questionId: 'q@x', phase: 'after' });
    for (const plain of ['q-check', 'q-check@', '@before', 'q-check@later', '', null, undefined, 7]) assert.equal(parseCheckId(plain), null, String(plain));
    assert.equal(isCheckRecord(record('q@before', 'o')), true);
    assert.equal(isCheckRecord(record('q-trivia-1', 'o')), false);
  });

  it('mergeAnswerRecords keeps both records beside the question\'s own, one per id', () => {
    const merged = ds.mergeAnswerRecords(
      [record('q-trivia-1', 'a'), record(beforeId('q-check'), 'o-2')],
      [record(afterId('q-check'), 'o-4', { answeredAt: '2026-10-27T11:00:00.000Z' }), record(beforeId('q-check'), 'o-3', { answeredAt: '2026-10-27T09:00:00.000Z' })],
    );
    assert.deepEqual(merged.map((each) => [each.questionId, each.answer]), [['q-trivia-1', 'a'], ['q-check@before', 'o-2'], ['q-check@after', 'o-4']]);
  });

  it('a save (participantFields) stores them, a fresh device restores them, and a restart of one activity keeps Before', async () => {
    const { restore, visit } = await liveVisit();
    try {
      const store = createAnswerStore({ api: ds, storage: memoryStorage(), sleep: async () => {} });
      await store.restore(visit, null);
      store.record(visit, 'sec-trivia', { questionId: 'q-trivia-1', answer: 'q-trivia-1-a', firstAnswer: 'q-trivia-1-a', attempts: 1, correct: true });
      store.record(visit, 'sec-check', { questionId: beforeId('q-check'), answer: 'o-2', firstAnswer: 'o-2', attempts: 1, correct: null });
      store.record(visit, 'sec-check', { questionId: afterId('q-check'), answer: 'o-4', firstAnswer: 'o-4', attempts: 1, correct: null });
      await store.flush(visit, 'sec-check');
      const saved = await ds.getParticipantResponses(visit.trackId);
      assert.deepEqual(saved.responses.map((each) => each.questionId).sort(), ['q-check@after', 'q-check@before', 'q-trivia-1']);

      const other = createAnswerStore({ api: ds, storage: memoryStorage(), sleep: async () => {} });
      await other.restore(visit);
      assert.equal(other.recordFor(visit, beforeId('q-check'))?.answer, 'o-2');
      assert.equal(other.recordFor(visit, afterId('q-check'))?.answer, 'o-4');

      // Restart at an activity: that activity's questions and After go; Before stays.
      await other.restart({ ...visit, restartedAt: '2026-10-27T12:00:00.000Z' }, ['q-trivia-1', afterId('q-check')]);
      await other.flush({ ...visit, restartedAt: '2026-10-27T12:00:00.000Z' }, 'sec-check');
      assert.deepEqual((await ds.getParticipantResponses(visit.trackId)).responses.map((each) => each.questionId), ['q-check@before']);
      // Restart from the very beginning: everything goes.
      await other.restart({ ...visit, restartedAt: '2026-10-27T13:00:00.000Z' }, null);
      await other.flush({ ...visit, restartedAt: '2026-10-27T13:00:00.000Z' }, 'sec-check');
      assert.deepEqual((await ds.getParticipantResponses(visit.trackId)).responses, []);
    } finally {
      restore();
    }
  });

  it('the facilitator\'s restart at an activity removes that activity\'s answers and After, and keeps Before', async () => {
    const { restore, visit } = await liveVisit();
    try {
      await ds.saveParticipantResponses({ ...visit, responses: [record('q-trivia-1', 'q-trivia-1-a', { correct: true }), record(beforeId('q-check'), 'o-2'), record(afterId('q-check'), 'o-4')] });
      await ds.restartParticipantTrack(visit.trackId, { sectionId: 'sec-trivia' });
      assert.deepEqual((await ds.getParticipantResponses(visit.trackId)).responses.map((each) => each.questionId), ['q-check@before']);
      await ds.restartParticipantTrack(visit.trackId, { sectionId: null });
      assert.deepEqual((await ds.getParticipantResponses(visit.trackId)).responses, []);
    } finally {
      restore();
    }
  });

  it('a session\'s results count every question as they did without the two records', async () => {
    const { restore, session, visit } = await liveVisit();
    try {
      const plain = [record('q-trivia-1', 'q-trivia-1-a', { correct: true })];
      await ds.saveParticipantResponses({ ...visit, responses: plain });
      const without = await readSessionResults(session.id);
      await ds.saveParticipantResponses({ ...visit, responses: [...plain, record(beforeId('q-trivia-1'), 'q-trivia-1-b'), record(afterId('q-trivia-1'), 'q-trivia-1-c')] });
      const withThem = await readSessionResults(session.id);
      const strip = (results) => results.sections.map((section) => section.questions.map((question) => [question.id, question.respondents, question.options.map((option) => [option.id, option.count, option.percent])]));
      assert.deepEqual(strip(withThem), strip(without));
      assert.deepEqual(withThem.unreadable, []);
    } finally {
      restore();
    }
  });
});

// ---- Part 2: the arithmetic ------------------------------------------------------------------------------------------------------

/** Answers as the results read them: one per guest and id, the option id as the answer. */
const answersOf = (rows) => rows.flatMap(([trackId, before, after]) => [
  ...(before === null ? [] : [{ questionId: beforeId('q'), clientTrackId: trackId, answer: `o${before}` }]),
  ...(after === null ? [] : [{ questionId: afterId('q'), clientTrackId: trackId, answer: `o${after}` }]),
]);
const scale = (top) => Array.from({ length: top }, (_, at) => ({ id: `o${at + 1}`, questionId: 'q', label: `L${at + 1}`, value: at + 1 }));
const scoreOf = (options) => {
  const values = new Map(options.map((option) => [option.id, Number(option.value)]));
  return (answer) => values.get(String(answer)) ?? null;
};
const pairsOf = (rows, top = 5) => pairCheckAnswers(answersOf(rows), { questionId: 'q', scoreOf: scoreOf(scale(top)) });

describe('Part 2: the thresholds and the divisor are named, tested constants', () => {
  it('5 points: not confident is 1 or 2, confident 4 or 5; 3 points: 1 and 3; 4 points: 1 and 4', () => {
    assert.deepEqual([notConfidentMax(5), confidentMin(5)], [2, 4]);
    assert.deepEqual([notConfidentMax(3), confidentMin(3)], [1, 3]);
    assert.deepEqual([notConfidentMax(4), confidentMin(4)], [1, 4]);
    assert.deepEqual([notConfidentMax(10), confidentMin(10)], [4, 8]);
  });

  it('the shift is divided by the top of the scale (decision 2; one line to change)', () => {
    assert.equal(shiftDivisor(5), 5);
    assert.equal(shiftDivisor(3), 3);
  });

  it('the top of the scale is the question\'s highest OptionValue', () => {
    assert.equal(scaleMaxOf(scale(5)), 5);
    assert.equal(scaleMaxOf(scale(3)), 3);
    assert.equal(scaleMaxOf([{ value: '2' }, { value: 4 }, { value: 'x' }]), 4);
    assert.equal(scaleMaxOf([]), null);
    assert.equal(scaleMaxOf([{ value: 'high' }]), null);
  });

  it('the minimum sample is 10 (ASSUMED until the setting exists) and below it is a low sample', () => {
    assert.equal(MIN_SAMPLE, 10);
    assert.equal(lowSample({ n: 9 }), true);
    assert.equal(lowSample({ n: 10 }), false);
    assert.equal(lowSample({ n: 2, min: 3 }), true);
  });
});

describe('Part 2: hand-worked cases', () => {
  it('one guest, 2 then 4 on 5 points: +2 points is 40%, and they moved to confident (1 of 1)', () => {
    const paired = pairsOf([['t1', 2, 4]]);
    assert.equal(paired.pairs.length, 1);
    assert.deepEqual(confidenceShift({ pairs: paired.pairs, scaleMax: 5 }), { n: 1, beforeMean: 2, afterMean: 4, points: 2, percent: 40 });
    assert.deepEqual(movedToConfident({ pairs: paired.pairs, scaleMax: 5 }), { started: 1, moved: 1, percent: 100 });
  });

  it('three guests: Before only, After only and both: only the pair is in the shift, Before counts both Befores', () => {
    const paired = pairsOf([['t1', 1, null], ['t2', null, 5], ['t3', 3, 4]]);
    assert.deepEqual([paired.answeredBoth, paired.answeredBeforeOnly, paired.answeredAfterOnly], [1, 1, 1]);
    assert.deepEqual(paired.before, [1, 3]);
    assert.deepEqual(paired.after, [5, 4]);
    assert.deepEqual(confidenceShift({ pairs: paired.pairs, scaleMax: 5 }), { n: 1, beforeMean: 3, afterMean: 4, points: 1, percent: 20 });
    // t3 started at 3, which is not "not confident": nobody to move.
    assert.deepEqual(movedToConfident({ pairs: paired.pairs, scaleMax: 5 }), { started: 0, moved: 0, percent: null });
  });

  it('everyone unchanged is 0%', () => {
    const paired = pairsOf([['a', 1, 1], ['b', 3, 3], ['c', 5, 5]]);
    assert.equal(confidenceShift({ pairs: paired.pairs, scaleMax: 5 }).percent, 0);
    assert.deepEqual(movedToConfident({ pairs: paired.pairs, scaleMax: 5 }), { started: 1, moved: 0, percent: 0 });
  });

  it('everyone from 1 to 5 is +4 points, 80% of the scale, and all moved', () => {
    const paired = pairsOf([['a', 1, 5], ['b', 1, 5], ['c', 1, 5], ['d', 1, 5]]);
    assert.deepEqual(confidenceShift({ pairs: paired.pairs, scaleMax: 5 }), { n: 4, beforeMean: 1, afterMean: 5, points: 4, percent: 80 });
    assert.deepEqual(movedToConfident({ pairs: paired.pairs, scaleMax: 5 }), { started: 4, moved: 4, percent: 100 });
  });

  it('a 3-point legacy scale: 1 to 3 is +2 of 3 points (66.67%); only the middle answer is neutral', () => {
    const paired = pairsOf([['a', 1, 3], ['b', 2, 3], ['c', 1, 2]], 3);
    const shift = confidenceShift({ pairs: paired.pairs, scaleMax: 3 });
    assert.equal(shift.beforeMean, 4 / 3);
    assert.equal(shift.afterMean, 8 / 3);
    assert.ok(Math.abs(shift.percent - (4 / 3 / 3) * 100) < 1e-9);
    assert.deepEqual(movedToConfident({ pairs: paired.pairs, scaleMax: 3 }), { started: 2, moved: 1, percent: 50 });
  });

  it('ties on the thresholds: 2 counts as not confident and 4 as confident; 3 is neither', () => {
    const paired = pairsOf([['a', 2, 4], ['b', 2, 3], ['c', 3, 4], ['d', 4, 2]]);
    assert.deepEqual(movedToConfident({ pairs: paired.pairs, scaleMax: 5 }), { started: 2, moved: 1, percent: 50 });
  });

  it('an empty session has no shift and nothing moved, and says how many of how many', () => {
    const paired = pairsOf([]);
    assert.equal(confidenceShift({ pairs: paired.pairs, scaleMax: 5 }), null);
    assert.deepEqual(movedToConfident({ pairs: paired.pairs, scaleMax: 5 }), { started: 0, moved: 0, percent: null });
    assert.equal(confidenceShift({ pairs: pairsOf([['a', 2, 3]]).pairs, scaleMax: null }), null);
  });

  it('the distributions count every Before and every After on each step of the scale', () => {
    const paired = pairsOf([['t1', 1, null], ['t2', null, 5], ['t3', 3, 4], ['t4', 3, 5]]);
    assert.deepEqual(distributionBeforeAfter({ before: paired.before, after: paired.after, scaleMax: 5 }), [
      { value: 1, before: 1, after: 0, beforePercent: (1 / 3) * 100, afterPercent: 0 },
      { value: 2, before: 0, after: 0, beforePercent: 0, afterPercent: 0 },
      { value: 3, before: 2, after: 0, beforePercent: (2 / 3) * 100, afterPercent: 0 },
      { value: 4, before: 0, after: 1, beforePercent: 0, afterPercent: (1 / 3) * 100 },
      { value: 5, before: 0, after: 2, beforePercent: 0, afterPercent: (2 / 3) * 100 },
    ]);
  });

  it('the confidence index is the After mean over the baseline\'s, times 100', () => {
    assert.equal(confidenceIndex({ afterMean: 4, baselineMean: 3.2 }), 125);
    assert.equal(confidenceIndex({ afterMean: 4, baselineMean: 0 }), null);
    assert.equal(confidenceIndex({ afterMean: null, baselineMean: 3 }), null);
  });

  it('an answer that is not an option of the question, or a second guest\'s record without a visit, is not a score', () => {
    const paired = pairCheckAnswers([
      { questionId: beforeId('q'), clientTrackId: 'a', answer: 'nope' }, { questionId: afterId('q'), clientTrackId: 'a', answer: 'o4' },
      { questionId: beforeId('q'), clientTrackId: null, answer: 'o1' }, { questionId: beforeId('other'), clientTrackId: 'b', answer: 'o1' },
      { questionId: 'q', clientTrackId: 'b', answer: 'o1' },
    ], { questionId: 'q', scoreOf: scoreOf(scale(5)) });
    assert.deepEqual([paired.answeredBoth, paired.answeredBeforeOnly, paired.answeredAfterOnly], [0, 0, 1]);
  });

  it('the line the reports print', () => {
    const check = { measured: true, guests: 4, answeredBoth: 3, shift: { n: 3, beforeMean: 2, afterMean: 3.6, points: 1.6, percent: 32 }, moved: { started: 2, moved: 1, percent: 50 } };
    assert.equal(confidenceLine(check), 'Confidence moved 32% of the scale (2.0 to 3.6); 50% of guests who started not confident ended confident (n = 3 of 4 guests)');
    assert.equal(confidenceLine({ ...check, shift: { ...check.shift, points: -0.4, percent: -8, afterMean: 1.6 } }).startsWith('Confidence moved -8% of the scale (2.0 to 1.6)'), true);
    assert.equal(confidenceLine({ ...check, moved: { started: 0, moved: 0, percent: null } }), 'Confidence moved 32% of the scale (2.0 to 3.6); no guest started not confident (n = 3 of 4 guests)');
    assert.equal(confidenceLine({ measured: true, guests: 4, answeredBoth: 0, shift: null, moved: { started: 0, moved: 0, percent: null } }), 'Confidence check: no guest answered both (n = 0 of 4 guests)');
    assert.equal(confidenceLine({ measured: false }), 'Confidence check: not measured');
    assert.equal(confidenceLine(null), 'Confidence check: not measured');
  });
});

describe('Part 2: properties that hold for any answers', () => {
  // A small deterministic generator (the oracle's own is in scripts/oracle-results.js): the same seed, the same guests.
  const random = (seed) => () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
  const guests = (next, top, count) => Array.from({ length: count }, (_, at) => {
    const pick = () => (next() < 0.2 ? null : 1 + Math.floor(next() * top));
    return [`g${at}`, pick(), pick()];
  });

  it('the shift is never more than 100% either way, nor the moved share outside 0 to 100', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const next = random(seed);
      const top = 3 + Math.floor(next() * 5);
      const paired = pairsOf(guests(next, top, Math.floor(next() * 40)), top);
      const shift = confidenceShift({ pairs: paired.pairs, scaleMax: top });
      if (shift) assert.ok(Math.abs(shift.percent) <= 100, `seed ${seed}`);
      const moved = movedToConfident({ pairs: paired.pairs, scaleMax: top });
      if (moved.percent !== null) assert.ok(moved.percent >= 0 && moved.percent <= 100, `seed ${seed}`);
    }
  });

  it('a guest with only a Before never changes a shift, and the order of the records never matters', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const next = random(seed);
      const rows = guests(next, 5, 1 + Math.floor(next() * 30));
      const base = pairsOf(rows);
      const more = pairsOf([...rows, ['late', 2, null]]);
      assert.deepEqual(confidenceShift({ pairs: more.pairs, scaleMax: 5 }), confidenceShift({ pairs: base.pairs, scaleMax: 5 }), `seed ${seed}`);
      assert.deepEqual(movedToConfident({ pairs: more.pairs, scaleMax: 5 }), movedToConfident({ pairs: base.pairs, scaleMax: 5 }), `seed ${seed}`);
      const shuffled = answersOf(rows).sort(() => next() - 0.5);
      const again = pairCheckAnswers(shuffled, { questionId: 'q', scoreOf: scoreOf(scale(5)) });
      assert.deepEqual(confidenceShift({ pairs: again.pairs, scaleMax: 5 }), confidenceShift({ pairs: base.pairs, scaleMax: 5 }), `seed ${seed}`);
      assert.deepEqual([again.answeredBoth, again.answeredBeforeOnly, again.answeredAfterOnly], [base.answeredBoth, base.answeredBeforeOnly, base.answeredAfterOnly]);
    }
  });
});

// ---- Part 2: the results tree ----------------------------------------------------------------------------------------------------

describe('Part 2: buildResults carries the check beside the activities, and nothing else changes', () => {
  const activity = { id: 's1', title: 'Trivia', enabled: true, order: 1, questionIds: ['q1'], clientId: 'c' };
  const checkSection = { id: 'chk', title: 'Confidence check', kind: CHECK_KIND, enabled: true, order: 0, questionIds: ['q'], clientId: 'c' };
  const questions = [
    { id: 'q1', sectionId: 's1', type: 'single-select', prompt: 'One?', optionIds: ['a', 'b'] },
    { id: 'q', sectionId: 'chk', type: 'confidence-continuum', prompt: 'How confident?', optionIds: scale(5).map((option) => option.id) },
  ];
  const options = [{ id: 'a', questionId: 'q1', label: 'A', value: 'a', correct: true }, { id: 'b', questionId: 'q1', label: 'B', value: 'b', correct: false }, ...scale(5)];
  const tracks = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
  const answers = [
    { questionId: 'q1', clientTrackId: 't1', answer: 'a' }, { questionId: 'q1', clientTrackId: 't2', answer: 'b' },
    ...answersOf([['t1', 2, 4], ['t2', 3, null], ['t3', 1, 5]]),
  ];

  it('a session without a check activity is the tree it always was, with no confidenceCheck', () => {
    const session = { id: 'x', sectionIds: ['s1'] };
    const tree = buildResults({ session, tracks, sections: [activity], questions, options, answers });
    assert.equal('confidenceCheck' in tree, false);
    assert.deepEqual(tree.sections.map((section) => section.id), ['s1']);
    assert.equal(tree.sections[0].questions[0].respondents, 2);
  });

  it('with one, the check activity is not an activity of the results, and confidenceCheck holds its numbers', () => {
    const session = { id: 'x', sectionIds: ['chk', 's1'], confidenceCheck: true };
    const tree = buildResults({ session, tracks, sections: [activity, checkSection], questions, options, answers });
    assert.deepEqual(tree.sections.map((section) => section.id), ['s1']);
    assert.equal(tree.sections[0].questions[0].respondents, 2);
    const check = tree.confidenceCheck;
    assert.equal(check.measured, true);
    assert.equal(check.questionId, 'q');
    assert.equal(check.prompt, 'How confident?');
    assert.equal(check.scaleMax, 5);
    assert.deepEqual([check.guests, check.answeredBefore, check.answeredAfter, check.answeredBoth, check.answeredBeforeOnly, check.answeredAfterOnly], [3, 3, 2, 2, 1, 0]);
    assert.deepEqual(check.shift, { n: 2, beforeMean: 1.5, afterMean: 4.5, points: 3, percent: 60 });
    assert.deepEqual(check.moved, { started: 2, moved: 2, percent: 100 });
    assert.equal(check.lowSample, true);
    assert.deepEqual(check.distribution.map((row) => [row.value, row.before, row.after]), [[1, 1, 0], [2, 1, 0], [3, 1, 0], [4, 0, 1], [5, 0, 1]]);
    assert.deepEqual(check.labels, ['L1', 'L2', 'L3', 'L4', 'L5']);
  });

  it('switched off for the session, the check is not measured: no numbers, and still not an activity', () => {
    const session = { id: 'x', sectionIds: ['chk', 's1'], confidenceCheck: false };
    const tree = buildResults({ session, tracks, sections: [activity, checkSection], questions, options, answers });
    assert.deepEqual(tree.sections.map((section) => section.id), ['s1']);
    assert.equal(tree.confidenceCheck.measured, false);
    assert.equal(tree.confidenceCheck.shift, null);
    assert.equal(confidenceLine(tree.confidenceCheck), 'Confidence check: not measured');
  });

  it('confidenceCheckResults is what buildResults puts there', () => {
    const session = { id: 'x', sectionIds: ['chk', 's1'], confidenceCheck: true };
    const tree = buildResults({ session, tracks, sections: [activity, checkSection], questions, options, answers });
    assert.deepEqual(confidenceCheckResults({ session, section: checkSection, question: questions[1], options: scale(5), tracks, answers }), tree.confidenceCheck);
  });
});

// ---- Part 3: the flow ------------------------------------------------------------------------------------------------------------

describe('Part 3: the flow table (board 14) against nextStep', () => {
  const check = { section: { id: 'chk' }, questionId: 'q' };
  const both = [beforeId('q'), afterId('q')];
  const step = (state) => nextStep({ check, answers: [], allDone: false, flow: 'sequential', sessionEnded: false, finishing: false, ...state });

  // [situation, state, step]
  const rows = [
    ['check switched off: the hub, as today', { check: null }, 'activities'],
    ['check switched off, the last activity finished: Thank you, as today', { check: null, allDone: true, finishing: true }, 'thank-you'],
    ['check switched off, Finish pressed early: the hub', { check: null, finishing: true }, 'activities'],
    ['joins (or joins late): Before first', {}, 'check-in'],
    ['joins late with every activity done already: still Before first', { allDone: true }, 'check-in'],
    ['Before given: the activities', { answers: [beforeId('q')] }, 'activities'],
    ['Before given, the last activity finished (in order): After', { answers: [beforeId('q')], allDone: true, finishing: true }, 'check-out'],
    ['Before given, Finish pressed before every activity is done (in order): the hub', { answers: [beforeId('q')], finishing: true }, 'activities'],
    ['any-order session, Finish on the hub: After', { answers: [beforeId('q')], flow: 'open', finishing: true }, 'check-out'],
    ['any-order session, every activity done, not finishing: the hub', { answers: [beforeId('q')], flow: 'open', allDone: true }, 'activities'],
    ['both given: Thank you', { answers: both }, 'thank-you'],
    ['both given, on the hub again: Thank you', { answers: both, allDone: true }, 'thank-you'],
    ['session already ended, finishing: Thank you, no After', { answers: [beforeId('q')], sessionEnded: true, allDone: true, finishing: true }, 'thank-you'],
    ['session already ended, no Before: the hub (its ended notice), never Before', { sessionEnded: true }, 'activities'],
    ['restarted from the very beginning (nothing kept): Before again', { answers: [] }, 'check-in'],
    ['restarted at an activity (Before kept, After cleared): carries on', { answers: [beforeId('q')] }, 'activities'],
    ['an After without a Before (a device that lost its Before): Thank you, nothing asked twice', { answers: [afterId('q')] }, 'thank-you'],
  ];
  for (const [situation, state, expected] of rows) it(situation, () => assert.equal(step(state), expected));

  it('answers may be records or ids, and the table has a rule for every step', () => {
    assert.equal(step({ answers: [record(beforeId('q'), 'o1')] }), 'activities');
    assert.deepEqual([...new Set(FLOW_RULES.map((rule) => rule.step))].sort(), ['activities', 'check-in', 'check-out', 'thank-you']);
    for (const rule of FLOW_RULES) assert.equal(typeof rule.situation, 'string');
  });

  it('each step has its screen', () => {
    assert.deepEqual(STEP_PATHS, { 'check-in': '/check-in', activities: '/agenda', 'check-out': '/check-out', 'thank-you': '/thank-you' });
    assert.equal(stepPath({ check, answers: [] }), '/check-in');
  });

  it('checkOf finds the client\'s check activity only when the session has the check on and the activity has a question', () => {
    const sections = [{ id: 's1', questionIds: ['q1'] }, { id: 'chk', kind: CHECK_KIND, questionIds: ['q'] }];
    assert.deepEqual(checkOf({ session: { confidenceCheck: true }, sections }), { section: sections[1], questionId: 'q' });
    assert.equal(checkOf({ session: { confidenceCheck: false }, sections }), null);
    assert.equal(checkOf({ session: {}, sections }), null);
    assert.equal(checkOf({ session: { confidenceCheck: true }, sections: [{ id: 'chk', kind: CHECK_KIND, questionIds: [] }] }), null);
    assert.equal(checkOf({ session: null, sections }), null);
    assert.equal(isCheckActivity(sections[1]), true);
    assert.equal(isCheckActivity(sections[0]), false);
  });
});

// ---- Part 1: the schema ----------------------------------------------------------------------------------------------------------

describe('Part 1: two columns and schema version 4', async () => {
  const { LISTS, VERSION, selectOf } = await import('../migration/src/lib/schema/pms-schema.js');
  const { META, columnNamesAt, columnsOf } = await import('../migration/src/lib/schema/pms-schema-meta.js');

  it('PMSActivities.Kind (text) and PMSClientSessions.ConfidenceCheck (Yes/No) are read with every item, and the lists are version 4', () => {
    assert.equal(VERSION, 4);
    assert.deepEqual(LISTS.sections.fields.kind, { column: 'Kind', kind: 'text' });
    assert.deepEqual(LISTS.sessions.fields.confidenceCheck, { column: 'ConfidenceCheck', kind: 'yesno' });
    assert.match(selectOf('sections'), /,Kind$/);
    assert.match(selectOf('sessions'), /,ConfidenceCheck$/);
  });

  it('their meta: words, defaults, who reads and writes them, and since which version', () => {
    const kind = columnsOf('sections').find((column) => column.name === 'Kind');
    assert.deepEqual([kind.type, kind.values, kind.since, kind.indexed], ['Text', ['activity', 'confidence-check'], 4, false]);
    assert.match(kind.default, /empty reads as activity/);
    const check = columnsOf('sessions').find((column) => column.name === 'ConfidenceCheck');
    assert.deepEqual([check.type, check.since, check.default], ['Boolean', 4, 'No']);
    assert.deepEqual(check.writes, ['admin']);
    assert.ok(META.sections.columns.Kind.purpose.includes('confidence check'));
  });

  it('a site of version 3 has neither column; one of version 4 has both', () => {
    assert.equal(columnNamesAt('sections', 3).includes('Kind'), false);
    assert.equal(columnNamesAt('sessions', 3).includes('ConfidenceCheck'), false);
    assert.equal(columnNamesAt('sections', 4).includes('Kind'), true);
    assert.equal(columnNamesAt('sessions').includes('ConfidenceCheck'), true);
    assert.equal(columnNamesAt('sections', 3).length, columnsOf('sections').length, 'aligned with columnsOf: a column a site lacks is null');
  });
});

describe('Part 1: Setup brings a site of version 3 to version 4 without losing anything', async () => {
  const { PHASE_20_COLUMNS } = await import('./sharepoint-fake.js');
  const { create, markReady, planLines, showPlan, siteApi } = await import('../migration/src/lib/setup/provision.js');
  const { schemaSpecs } = await import('../migration/src/lib/setup/setup-checks.js');
  let pages = 0;
  const pageOn = async (fake) => {
    const page = await import(`../migration/src/lib/data/dataService.js?confidence-upgrade=${pages += 1}`);
    const stops = [];
    page.configure({ sharePoint: fake.settings, onStop: (code) => stops.push(code) });
    return { page, stops };
  };
  /** A site of version 3 with Kroger live and a visit that answered: its records written first, then the two columns taken off. */
  async function versionThree() {
    const fake = createSharePointFake({ listsVersion: 3, keepColumns: PHASE_20_COLUMNS });
    const restore = fake.install();
    const { page } = await pageOn(fake);
    fake.item('appsettings', 'default').SchemaVersion = 4;
    await seedPack(page, samplePack());
    const { session } = await page.activateClient('c-kroger', DAY);
    const track = await page.beginVisit(crypto.randomUUID(), session.id, 'c-kroger');
    await page.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: 'c-kroger', responses: [record('q-trivia-1', 'q-trivia-1-a', { correct: true })] });
    fake.dropColumns(PHASE_20_COLUMNS);
    fake.item('appsettings', 'default').SchemaVersion = 3;
    fake.reset();
    return { fake, restore, session, track };
  }

  it('the pages stop with PMS-LST-011; Show the plan names the two columns and nothing else; Create adds them; Mark ready raises 3 to 4', async () => {
    const { fake, restore, session, track } = await versionThree();
    try {
      const participant = await pageOn(fake);
      await assert.rejects(participant.page.readParticipantWatch({ sessionId: session.id, trackId: track.id }), (error) => error.code === 'PMS-LST-011');
      assert.deepEqual(participant.stops, ['PMS-LST-011']);
      const { page } = await pageOn(fake);
      const api = siteApi(page);
      const titles = page.sharePointListTitles();
      const { plan } = await showPlan(api, titles);
      assert.deepEqual(plan.columns.map((item) => `${item.list}.${item.name}`), [`${titles.sessions}.ConfidenceCheck`, `${titles.sections}.Kind`]);
      assert.equal(plan.summary, '0 lists, 2 columns, 0 settings to create');
      assert.deepEqual(planLines(plan), [`${titles.sessions} (exists)`, '  Create 1 column: ConfidenceCheck.', `${titles.sections} (exists)`, '  Create 1 column: Kind.', '0 lists, 2 columns, 0 settings to create']);
      fake.reset();
      assert.equal((await create(api, plan, { gapMs: 0 })).ok, true);
      assert.deepEqual(fake.writes().map((entry) => `${entry.method} ${entry.list} ${entry.field ?? ''}`), ['POST sessions ConfidenceCheck', 'POST sections Kind']);
      const ready = await markReady(api, titles, { check: () => page.checkSharePointSchema({ specs: schemaSpecs }) });
      assert.deepEqual([ready.ready, ready.wrote, ready.words], [true, 'raised', 'Raised the lists from version 3 to version 4.']);
      assert.equal(fake.item('appsettings', 'default').SchemaVersion, 4);
      // Nothing was lost, and the session made before reads as one without the check.
      const after = await pageOn(fake);
      const read = await after.page.getSession(session.id);
      assert.deepEqual([read.id, read.sectionIds, read.confidenceCheck ?? false], [session.id, session.sectionIds, false]);
      assert.equal((await after.page.getParticipantResponses(track.id)).responses[0].questionId, 'q-trivia-1');
      const sections = await after.page.listClientSections('c-kroger');
      assert.ok(sections.length > 0 && sections.every((section) => !isCheckActivity(section)), 'every activity made before reads as an activity');
      assert.deepEqual(after.stops, []);
    } finally {
      restore();
    }
  });
});

describe('Part 2: the oracle recounts the check, and its comparison can fail', async () => {
  const { checkOracle, compareCheck, generateCheck, loadApp } = await import('./oracle-results.js');
  const app = await loadApp();

  it('60 seeded checks agree with the app', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const fixture = generateCheck(seed);
      assert.deepEqual(compareCheck(fixture, checkOracle(fixture), app), [], `seed ${seed}`);
    }
  });

  it('an app that divided by the largest move (scaleMax - 1), or counted a Before-only guest as paired, is caught', () => {
    const wrongDivisor = { ...app, buildResults: (records) => { const tree = app.buildResults(records); const check = tree.confidenceCheck; return { ...tree, confidenceCheck: { ...check, shift: check.shift && { ...check.shift, percent: (check.shift.points * 100) / (check.scaleMax - 1) } } }; } };
    const wrongPairs = { ...app, buildResults: (records) => { const tree = app.buildResults(records); return { ...tree, confidenceCheck: { ...tree.confidenceCheck, answeredBoth: tree.confidenceCheck.answeredBefore } }; } };
    let caughtDivisor = 0;
    let caughtPairs = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const fixture = generateCheck(seed);
      const truth = checkOracle(fixture);
      if (compareCheck(fixture, truth, wrongDivisor).some((line) => line.includes('the shift is'))) caughtDivisor += 1;
      if (compareCheck(fixture, truth, wrongPairs).some((line) => line.includes('answeredBoth'))) caughtPairs += 1;
    }
    assert.ok(caughtDivisor > 30, `the divisor: ${caughtDivisor} of 60`);
    assert.ok(caughtPairs > 30, `the pairs: ${caughtPairs} of 60`);
  });
});
