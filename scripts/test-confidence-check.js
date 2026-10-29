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
    assert.equal(VERSION, 7); // (Prompt 21 raised it again, and its Phases 3 and 4: scripts/test-access.js, scripts/test-sessions-plan.js)
    assert.deepEqual(LISTS.sections.fields.kind, { column: 'Kind', kind: 'text' });
    assert.deepEqual(LISTS.sessions.fields.confidenceCheck, { column: 'ConfidenceCheck', kind: 'yesno' });
    assert.match(selectOf('sections'), /,Kind$/);
    // (Prompt 21, Phase 3: version 6's five follow it, scripts/test-sessions-plan.js.)
    assert.match(selectOf('sessions'), /,ConfidenceCheck,Title,StartTime,Sequence,Period,PlannedDate$/);
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

describe('Part 1: Setup brings a site of version 3 to version 4 (5 since Prompt 21) without losing anything', async () => {
  const { PHASE_20_COLUMNS, PHASE_21_COLUMNS, PHASE_21C_COLUMNS, PHASE_21D_COLUMNS, PHASE_21_LISTS } = await import('./sharepoint-fake.js');
  const { VERSION } = await import('../migration/src/lib/schema/pms-schema.js');
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
    // (Prompt 21: this build's settings item names version 5's two settings too, and its Phase 3 a session's four columns of version 6, so the site
    // keeps them while the records are written.)
    const fake = createSharePointFake({ listsVersion: 3, keepColumns: [...PHASE_20_COLUMNS, ...PHASE_21_COLUMNS, ...PHASE_21C_COLUMNS, ...PHASE_21D_COLUMNS] });
    const restore = fake.install();
    const { page } = await pageOn(fake);
    fake.item('appsettings', 'default').SchemaVersion = VERSION;
    await seedPack(page, samplePack());
    const { session } = await page.activateClient('c-kroger', DAY);
    const track = await page.beginVisit(crypto.randomUUID(), session.id, 'c-kroger');
    await page.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: 'c-kroger', responses: [record('q-trivia-1', 'q-trivia-1-a', { correct: true })] });
    fake.dropColumns([...PHASE_20_COLUMNS, ...PHASE_21_COLUMNS, ...PHASE_21C_COLUMNS, ...PHASE_21D_COLUMNS]);
    fake.item('appsettings', 'default').SchemaVersion = 3;
    fake.reset();
    return { fake, restore, session, track };
  }

  it('the pages stop with PMS-LST-011; Show the plan names the two columns (and version 5\'s three lists and two settings, and version 6\'s four session columns) and nothing else; Create adds them; Mark ready raises 3 to 7', async () => {
    const { fake, restore, session, track } = await versionThree();
    try {
      const participant = await pageOn(fake);
      await assert.rejects(participant.page.readParticipantWatch({ sessionId: session.id, trackId: track.id }), (error) => error.code === 'PMS-LST-011');
      assert.deepEqual(participant.stops, ['PMS-LST-011']);
      // The admin page's first read (a $batch of the settings item, the sessions and more) says the same, not the sessions' 400.
      const adminPage = await pageOn(fake);
      await assert.rejects(adminPage.page.readLists([{ list: 'appsettings' }, { list: 'clients' }, { list: 'sessions' }, { list: 'sections' }]), (error) => error.code === 'PMS-LST-011');
      const { page } = await pageOn(fake);
      const api = siteApi(page);
      const titles = page.sharePointListTitles();
      const { plan } = await showPlan(api, titles);
      // (Prompt 21: version 5's three lists, with every column of theirs, and the settings item's two columns come with the plan as well.)
      const newLists = PHASE_21_LISTS.map((key) => titles[key]);
      assert.deepEqual(plan.columns.filter((item) => !newLists.includes(item.list)).map((item) => `${item.list}.${item.name}`),
        [`${titles.sessions}.ConfidenceCheck`, `${titles.sessions}.StartTime`, `${titles.sessions}.Sequence`, `${titles.sessions}.Period`, `${titles.sessions}.PlannedDate`, `${titles.sections}.Kind`, `${titles.appsettings}.FiscalYearStartMonth`, `${titles.appsettings}.MinSample`, `${titles.visitorroster}.GuestGroup`]);
      assert.deepEqual(plan.lists.map((item) => item.list ?? item.title ?? item.key), newLists);
      assert.equal(plan.summary, '3 lists, 37 columns, 10 settings to create');
      assert.deepEqual(planLines(plan).filter((line) => !newLists.some((title) => line.startsWith(title)) && !line.startsWith('  ') && !/to create$/.test(line)),
        [`${titles.sessions} (exists)`, `${titles.sections} (exists)`, `${titles.appsettings} (exists)`, `${titles.visitorroster} (exists)`]);
      fake.reset();
      assert.equal((await create(api, plan, { gapMs: 0 })).ok, true);
      assert.deepEqual(fake.writes().filter((entry) => !PHASE_21_LISTS.includes(entry.list) && entry.list).map((entry) => `${entry.method} ${entry.list} ${entry.field ?? ''}`),
        // (Setup makes columns three lists at a time, so version 6's four interleave with the others.)
        ['POST sessions ConfidenceCheck', 'POST sections Kind', 'POST appsettings FiscalYearStartMonth', 'POST sessions StartTime', 'POST appsettings MinSample', 'POST visitorroster GuestGroup', 'POST sessions Sequence', 'POST sessions Period', 'POST sessions PlannedDate']);
      const ready = await markReady(api, titles, { check: () => page.checkSharePointSchema({ specs: schemaSpecs }) });
      assert.deepEqual([ready.ready, ready.wrote, ready.words], [true, 'raised', 'Raised the lists from version 3 to version 7.']);
      assert.equal(fake.item('appsettings', 'default').SchemaVersion, 7);
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

describe('Part 1: the sample check, and a new session\'s switch', () => {
  it('samplePack({ confidenceCheck: true }) gives each client one check of five steps, 1 to 5; samplePack() is as it was', async () => {
    const { CHECK_LABELS, CHECK_PROMPT } = await import('../migration/src/lib/setup/sample-clients.js');
    const plain = samplePack();
    const pack = samplePack({ confidenceCheck: true });
    assert.equal(plain.sections.some(isCheckActivity), false);
    const checks = pack.sections.filter(isCheckActivity);
    assert.deepEqual(checks.map((section) => section.clientId), ['c-kroger', 'c-dominos']);
    for (const section of checks) {
      const [question] = pack.questions.filter((each) => each.sectionId === section.id);
      assert.equal(question.prompt, CHECK_PROMPT);
      assert.equal(question.type, 'confidence-continuum');
      const options = question.optionIds.map((id) => pack.options.find((option) => option.id === id));
      assert.deepEqual(options.map((option) => [option.label, option.value]), CHECK_LABELS.map((label, at) => [label, at + 1]));
    }
    assert.deepEqual(CHECK_LABELS, ['Not confident at all', 'Slightly confident', 'Moderately confident', 'Confident', 'Very confident']);
    assert.deepEqual(pack.sections.filter((section) => !isCheckActivity(section)), plain.sections);
  });

  it('Go live makes a session that asks the check when its client has one with a question, and one that does not otherwise', async () => {
    for (const [withCheck, expected] of [[true, true], [false, false]]) {
      const fake = createSharePointFake();
      const restore = fake.install();
      try {
        ds.configure({ sharePoint: fake.settings });
        await seedPack(ds, samplePack({ confidenceCheck: withCheck }));
        const { session } = await ds.activateClient('c-kroger', DAY);
        assert.equal(session.confidenceCheck, expected);
        assert.equal((await ds.getSession(session.id)).confidenceCheck, expected, 'and it is stored');
        assert.equal(session.sectionIds.includes('sec-kroger-check'), withCheck, 'the check is one of the session\'s activities, as every activity of the client is');
      } finally {
        restore();
      }
    }
  });
});

describe('Part 3: a returning guest resumes on the right step (lib/participant/boot.js)', async () => {
  const { bootParticipant } = await import('../migration/src/lib/participant/boot.js');

  /** Kroger live with (or without) its check, a visit, and these answers saved. */
  async function resumed({ withCheck = true, switchedOn = true, answers = [] } = {}) {
    const fake = createSharePointFake();
    const restore = fake.install();
    ds.configure({ sharePoint: fake.settings });
    await seedPack(ds, samplePack({ confidenceCheck: withCheck }));
    const { session } = await ds.activateClient('c-kroger', DAY);
    if (!switchedOn) await ds.updateSession(session.id, { confidenceCheck: false });
    const track = await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger');
    if (answers.length) await ds.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: 'c-kroger', responses: answers });
    try {
      return await bootParticipant(ds, { trackId: track.id, path: '/' });
    } finally {
      restore();
    }
  }

  it('no Before yet: Before first', async () => {
    assert.equal((await resumed()).destination, '/check-in');
  });

  it('Before given: the hub; After given too: Thank you', async () => {
    assert.equal((await resumed({ answers: [record(beforeId('q-kroger-check'), 'o-kroger-check-2')] })).destination, '/agenda');
    assert.equal((await resumed({ answers: [record(beforeId('q-kroger-check'), 'o-kroger-check-2'), record(afterId('q-kroger-check'), 'o-kroger-check-4')] })).destination, '/thank-you');
  });

  it('a client without a check, or a session with it switched off: the hub, as always', async () => {
    assert.equal((await resumed({ withCheck: false })).destination, '/agenda');
    assert.equal((await resumed({ switchedOn: false })).destination, '/agenda');
  });
});

describe('Part 4: the golden-ratio tokens of the check screens hold their ratios (styles/check-tokens.css)', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../migration/src/styles/check-tokens.css', import.meta.url), 'utf8');
  const token = (name) => {
    const found = new RegExp(`--${name}:\\s*([\\d.]+)(px|%|dvh)?;`).exec(css);
    assert.ok(found, `--${name} is in the file`);
    return Number(found[1]);
  };
  const near = (actual, expected, what) => assert.ok(Math.abs(actual - expected) / expected <= 0.01, `${what}: ${actual} is not within 1% of ${expected}`);
  const PHI = (1 + Math.sqrt(5)) / 2;

  it('phi, and the two sections of a length', () => {
    near(token('check-phi'), PHI, 'phi');
    near(token('check-major') / 100, 1 / PHI, '61.8%');
    near(token('check-minor') / 100, 1 - 1 / PHI, '38.2%');
    near(token('check-panel-height') / 100, 1 - 1 / PHI, 'the panel is the lower 38.2% of the screen');
  });

  it('the spacing steps are Fibonacci, and each type size about phi times the last', () => {
    const steps = [1, 2, 3, 4, 5, 6].map((step) => token(`check-space-${step}`));
    assert.deepEqual(steps, [8, 13, 21, 34, 55, 89]);
    for (let at = 2; at < steps.length; at += 1) assert.equal(steps[at], steps[at - 1] + steps[at - 2]);
    const type = [1, 2, 3].map((step) => token(`check-type-${step}`));
    assert.deepEqual(type, [16, 26, 42]);
    near(type[1] / type[0], PHI, '26 / 16');
    near(type[2] / type[1], PHI, '42 / 26');
    assert.ok(type[0] >= 16, 'body text at least 16 px');
  });

  it('on the 768 x 1024 frame: the answer panel at 61.8% of the height, the question centred on 38.2%, the content width over phi is the button', () => {
    const [width, height] = [token('check-frame-width'), token('check-frame-height')];
    near(token('check-answers-top') / height, 1 / PHI, 'the answer panel top (633)');
    near(token('check-question-centre') / height, 1 - 1 / PHI, 'the question centre (391)');
    const content = width - 2 * token('check-margin');
    assert.equal(content, 658);
    near(content / token('check-button-width'), PHI, 'content / button (658 / 407)');
    assert.equal(token('check-button-height'), 55);
    assert.equal(token('check-header'), 55);
  });

  it('a card is a golden rectangle, and five with their gaps fill the content width', () => {
    const [cardWidth, cardHeight, gap] = [token('check-card-width'), token('check-card-height'), token('check-card-gap')];
    near(cardHeight / cardWidth, PHI, 'card 121 x 196');
    assert.ok(Math.abs(5 * cardWidth + 4 * gap - (token('check-frame-width') - 2 * token('check-margin'))) <= 1, 'five cards and four gaps are 658');
    assert.ok(token('check-card-stacked-min') >= 89 && token('check-card-row-min') >= 55, 'and well above the 44 px target');
  });
});

// ---- Parts 5 and 6: Content, the producer's card, Results, the exports --------------------------------------------------------------

describe('Parts 5 and 6: the check in Content, on the Live display, on Results and in every export', async () => {
  const { activitiesOfClient, checkDeleteRefusal, checkOfClient } = await import('../migration/src/lib/admin/admin-content.js');
  const { checkProgress } = await import('../migration/src/lib/admin/live-view.js');
  const { checkSummary } = await import('../migration/src/lib/results/confidence-shift.js');
  const { CHECK_CSV_COLUMNS, CSV_COLUMNS, buildLeaderReport, participantAnswersCsv } = await import('../migration/src/lib/exports/leader-report.js');
  const { buildReport } = await import('../migration/src/lib/exports/resultsExport.js');
  const BOM = String.fromCharCode(0xFEFF);

  const sections = [
    { id: 's2', title: 'Two', order: 2, clientId: 'c', questionIds: ['q2'] }, { id: 's1', title: 'One', order: 1, clientId: 'c', questionIds: ['q1'] },
    { id: 'chk', title: 'Confidence check', order: 0, clientId: 'c', kind: CHECK_KIND, questionIds: ['q'] }, { id: 'x', title: 'Other', order: 1, clientId: 'd' },
  ];

  it('Content: the check is not one of the client\'s activities, is found on its own, and is not deleted while an open session asks it', () => {
    assert.deepEqual(activitiesOfClient(sections, 'c').map((section) => section.id), ['s1', 's2']);
    assert.equal(checkOfClient(sections, 'c')?.id, 'chk');
    assert.equal(checkOfClient(sections, 'd'), null);
    assert.match(checkDeleteRefusal({ status: 'in-progress', confidenceCheck: true }), /asked in an open session/);
    assert.equal(checkDeleteRefusal({ status: 'in-progress', confidenceCheck: false }), '');
    assert.equal(checkDeleteRefusal({ status: 'completed', confidenceCheck: true }), '');
    assert.equal(checkDeleteRefusal(null), '');
  });

  it('the producer\'s card: Before 28 of 34, After 0 of 34, counts only; nothing when the check is off', () => {
    assert.deepEqual(checkProgress({ measured: true, guests: 34, answeredBefore: 28, answeredAfter: 0 }), { guests: 34, before: { count: 28, percent: (28 / 34) * 100 }, after: { count: 0, percent: 0 } });
    assert.equal(checkProgress({ measured: false, guests: 34, answeredBefore: 28, answeredAfter: 0 }), null);
    assert.equal(checkProgress(null), null);
    assert.deepEqual(Object.keys(checkProgress({ measured: true, guests: 0, answeredBefore: 0, answeredAfter: 0 })).sort(), ['after', 'before', 'guests'], 'no name and no score');
  });

  it('Results: the shift signed, the means, N of M answered both, moved to confident, a low sample; "not measured" when off', () => {
    const check = { measured: true, guests: 4, answeredBoth: 3, lowSample: true, shift: { n: 3, beforeMean: 2, afterMean: 3.6, points: 1.6, percent: 32 }, moved: { started: 2, moved: 1, percent: 50 } };
    assert.deepEqual(checkSummary(check), { measured: true, shift: '+32%', from: '2.0 to 3.6', answered: '3 of 4 guests answered both', moved: '50% (1 of 2 who started not confident)', lowSample: true });
    assert.equal(checkSummary({ ...check, shift: { ...check.shift, percent: -8 } }).shift, '-8%');
    assert.equal(checkSummary({ ...check, shift: { ...check.shift, percent: -0.4 } }).shift, '0%');
    assert.equal(checkSummary({ measured: false }).shift, 'Not measured');
  });

  /** A session of client c: one activity of one question and the check, three guests. */
  const records = (confidenceCheck) => ({
    session: { id: 'c-2026-10-27', clientId: 'c', date: '2026-10-27', status: 'completed', sectionIds: ['chk', 's1'], confidenceCheck },
    client: { id: 'c', name: 'Client' },
    tracks: [{ id: 't1', createdAt: '2026-10-27T09:00:00.000Z' }, { id: 't2', createdAt: '2026-10-27T09:01:00.000Z' }, { id: 't3', createdAt: '2026-10-27T09:02:00.000Z' }],
    sections: [{ id: 's1', title: 'One', enabled: true, order: 1, clientId: 'c', questionIds: ['q1'] }, sections[2]],
    questions: [{ id: 'q1', sectionId: 's1', type: 'single-select', prompt: 'One?', optionIds: ['a', 'b'] }, { id: 'q', sectionId: 'chk', type: 'confidence-continuum', prompt: 'How confident?', optionIds: scale(5).map((option) => option.id) }],
    options: [{ id: 'a', questionId: 'q1', label: 'A', value: 'a', correct: null }, { id: 'b', questionId: 'q1', label: 'B', value: 'b', correct: null }, ...scale(5)],
    answers: [{ questionId: 'q1', clientTrackId: 't1', answer: 'a', timestamp: '2026-10-27T09:05:00.000Z' }, ...answersOf([['t1', 2, 4], ['t2', 1, 5], ['t3', 3, null]])],
  });

  it('the leader report: the check is not an activity, its records are not strays, its one line is on the summary, and the CSV adds two columns', () => {
    const report = buildLeaderReport(records(true), { generatedAt: '2026-10-27T12:00:00.000Z', timeZone: 'UTC' });
    assert.deepEqual(report.activities.map((activity) => activity.id), ['s1']);
    assert.deepEqual(report.strays, []);
    assert.equal(report.summary.answers, 1, 'the check\'s answers are not answers to a question');
    assert.equal(report.summary.confidence.line, 'Confidence moved 60% of the scale (1.5 to 4.5); 100% of guests who started not confident ended confident (n = 2 of 3 guests)');
    const csv = participantAnswersCsv(report).replace(BOM, '').split('\r\n');
    assert.equal(csv[0], [...CSV_COLUMNS, ...CHECK_CSV_COLUMNS].join(','));
    assert.deepEqual(CHECK_CSV_COLUMNS, ['Confidence before', 'Confidence after']);
    const rowOf = (index) => csv[index].split(',');
    assert.deepEqual(rowOf(1).slice(-2), ['2', '4']);
    assert.deepEqual(rowOf(3).slice(-2), ['3', ''], 'a guest with only a Before has it, and nothing after');
  });

  it('a session without the check: the report and its CSV are as they were (no line, the eleven columns)', () => {
    const plain = records(false);
    plain.session.sectionIds = ['s1'];
    plain.sections = [plain.sections[0]];
    plain.answers = plain.answers.filter((answer) => !isCheckRecord(answer));
    const report = buildLeaderReport(plain, { generatedAt: '2026-10-27T12:00:00.000Z', timeZone: 'UTC' });
    assert.equal(report.summary.confidence, null);
    assert.equal(participantAnswersCsv(report).replace(BOM, '').split('\r\n')[0], CSV_COLUMNS.join(','));
  });

  it('the Live display\'s one-page PDF and PowerPoint carry the same line, and nothing for a session without the check', () => {
    const tree = buildResults(records(true));
    assert.equal(buildReport(tree, { name: 'Client' }).confidence, 'Confidence moved 60% of the scale (1.5 to 4.5); 100% of guests who started not confident ended confident (n = 2 of 3 guests)');
    const plain = records(false);
    plain.session.sectionIds = ['s1'];
    assert.equal(buildReport(buildResults(plain), { name: 'Client' }).confidence, '');
  });
});

describe('Part 5: Today\'s readiness does not count the check as an activity', async () => {
  const { evaluateReadiness } = await import('../migration/src/lib/admin/admin-today.js');
  it('a client whose only live item is its check has no live activities; one activity beside it is one', () => {
    const client = { id: 'c-a', name: 'A', slug: 'a', status: 'active' };
    const check = { id: 'chk', title: 'Confidence check', enabled: true, order: 0, clientId: 'c-a', kind: CHECK_KIND, questionIds: ['q'] };
    const activity = { id: 's1', title: 'Trivia', enabled: true, order: 1, clientId: 'c-a', questionIds: ['q1'] };
    const base = { client, date: DAY, today: DAY, questions: [], options: [], sessions: [], clients: [client], target: null, roster: null, schema: null };
    const alone = evaluateReadiness({ ...base, sections: [check] }).find((row) => row.id === 'activities');
    assert.equal(alone.level, 'blocker');
    const both = evaluateReadiness({ ...base, sections: [check, activity] }).find((row) => row.id === 'activities');
    assert.equal(both.detail, '1 activity is live: Trivia.');
  });
});
