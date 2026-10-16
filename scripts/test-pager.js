import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_TEXT_LENGTH, MAX_WRONG_TRIES, activityStates, chooseGraded, correctOptionIds, firstTryScore, firstUnansweredIndex, gradedAnnouncement,
  gradedOptionState, gradedRecord, gradedStateFromRecord, greetingName, hiLine, isAnswerComplete, isGraded, isGradedResolved,
  isRecordSettled, letterFor, normalizeAnswer, questionLayout, retryGraded, showsLetters, startGraded, toggleChoice, toggleRank, ungradedRecord, usesTiles,
} from '../migration/src/lib/pager-logic.js';

// The rules the participant pager follows, with no browser: graded feedback and Retry, validation
// of each question type, resume, the first-try score, the hub's sequential lock, the greeting.

const options = (...flags) => flags.map((correct, index) => ({ id: `o${index + 1}`, label: `Option ${index + 1}`, correct }));
const graded = (type = 'single-select') => ({ id: 'q-graded', type, prompt: 'Which?', options: options(false, true, false, false) });
const poll = (type = 'single-select', count = 3) => ({ id: `q-${type}`, type, prompt: 'Pick', options: options(...Array(count).fill(null)) });

test('a question is graded when a single answer type has a correct option', () => {
  assert.equal(isGraded(graded()), true);
  assert.equal(isGraded(graded('true-false')), true);
  assert.equal(isGraded(poll()), false, 'no correct flags');
  assert.equal(isGraded({ ...graded(), options: options(false, false) }), false, 'flags but none correct');
  assert.equal(isGraded(graded('multi-select')), false, 'multi-select is never graded');
  assert.equal(isGraded({ id: 'x', type: 'open-text-feedback', prompt: '?', options: [] }), false);
});

test('a correct first pick settles the question with one attempt', () => {
  const question = graded();
  const state = chooseGraded(question, startGraded(), 'o2');
  assert.deepEqual(state, { phase: 'correct', attempts: 1, firstAnswer: 'o2', choice: 'o2' });
  assert.equal(isGradedResolved(state), true);
  assert.deepEqual(gradedRecord(question, state), { questionId: 'q-graded', answer: 'o2', firstAnswer: 'o2', attempts: 1, correct: true });
});

test('a wrong pick asks for Retry; Retry clears the choice and keeps the first answer and the count', () => {
  const question = graded();
  const wrong = chooseGraded(question, startGraded(), 'o1');
  assert.deepEqual(wrong, { phase: 'wrong', attempts: 1, firstAnswer: 'o1', choice: 'o1' });
  assert.equal(isGradedResolved(wrong), false, 'Next stays off until the question is settled');
  const again = retryGraded(wrong);
  assert.deepEqual(again, { phase: 'choosing', attempts: 1, firstAnswer: 'o1', choice: null });
  // A right second pick settles it, but the FIRST try was wrong, so it never counts as first-try correct.
  const settled = chooseGraded(question, again, 'o2');
  assert.equal(settled.phase, 'correct');
  assert.equal(settled.attempts, 2);
  assert.deepEqual(gradedRecord(question, settled), { questionId: 'q-graded', answer: 'o2', firstAnswer: 'o1', attempts: 2, correct: false });
});

test('after two wrong tries the answer is revealed and Next is allowed', () => {
  assert.equal(MAX_WRONG_TRIES, 2);
  const question = graded();
  let state = chooseGraded(question, startGraded(), 'o1');
  state = chooseGraded(question, retryGraded(state), 'o3');
  assert.deepEqual(state, { phase: 'revealed', attempts: 2, firstAnswer: 'o1', choice: 'o3' });
  assert.equal(isGradedResolved(state), true);
  assert.equal(gradedOptionState(question, state, 'o3'), 'incorrect');
  assert.equal(gradedOptionState(question, state, 'o2'), 'correct', 'the right option is revealed');
  assert.equal(gradedOptionState(question, state, 'o4'), 'default');
  assert.deepEqual(gradedRecord(question, state), { questionId: 'q-graded', answer: 'o3', firstAnswer: 'o1', attempts: 2, correct: false });
  assert.match(gradedAnnouncement(question, state), /Incorrect\. The correct answer is Option 2\./);
  // An answer that ends in a full stop is not given another (Phase 8: a screen reader reads two as a stumble).
  const stopped = { ...question, options: question.options.map((option) => (option.correct === true ? { ...option, label: 'Great Western Tea co.' } : option)) };
  assert.equal(gradedAnnouncement(stopped, state), 'Incorrect. The correct answer is Great Western Tea co. Press Next to continue.');
});

test('picks are ignored once a question is settled or while Retry is pending, and unknown options are ignored', () => {
  const question = graded();
  const wrong = chooseGraded(question, startGraded(), 'o1');
  assert.equal(chooseGraded(question, wrong, 'o2'), wrong, 'a wrong pick must be retried first');
  const right = chooseGraded(question, startGraded(), 'o2');
  assert.equal(chooseGraded(question, right, 'o1'), right, 'a settled question does not change');
  assert.equal(retryGraded(right), right, 'Retry does nothing on a right answer');
  const fresh = startGraded();
  assert.equal(chooseGraded(question, fresh, 'nope'), fresh);
});

test('option states colour only the picked and revealed options, and say what to expect', () => {
  const question = graded();
  const start = startGraded();
  assert.deepEqual(question.options.map((option) => gradedOptionState(question, start, option.id)), ['default', 'default', 'default', 'default']);
  const wrong = chooseGraded(question, start, 'o4');
  assert.deepEqual(question.options.map((option) => gradedOptionState(question, wrong, option.id)), ['default', 'default', 'default', 'incorrect']);
  assert.equal(gradedAnnouncement(question, wrong), 'Incorrect. Press Retry to try again.');
  const right = chooseGraded(question, start, 'o2');
  assert.equal(gradedOptionState(question, right, 'o2'), 'correct');
  assert.equal(gradedAnnouncement(question, right), 'Correct. Press Next to continue.');
  assert.equal(gradedAnnouncement(question, start), '');
});

test('a reload can rebuild a settled graded question from its record', () => {
  const question = graded();
  assert.equal(gradedStateFromRecord(question, { answer: 'o2', firstAnswer: 'o2', attempts: 1 }).phase, 'correct');
  assert.equal(gradedStateFromRecord(question, { answer: 'o2', firstAnswer: 'o1', attempts: 2 }).phase, 'correct');
  const revealed = gradedStateFromRecord(question, { answer: 'o3', firstAnswer: 'o1', attempts: 2 });
  assert.deepEqual(revealed, { phase: 'revealed', attempts: 2, firstAnswer: 'o1', choice: 'o3' });
});

test('a reload cannot reset a first try: a wrong first pick comes back waiting for its Retry', () => {
  const question = graded();
  // The pager records the first pick the moment it is made, while the question is still open.
  const picked = chooseGraded(question, startGraded(), 'o1');
  const record = gradedRecord(question, picked);
  assert.deepEqual(record, { questionId: 'q-graded', answer: 'o1', firstAnswer: 'o1', attempts: 1, correct: false });
  assert.equal(isRecordSettled(record), false, 'it does not count as answered: the participant comes back to it');
  const restored = gradedStateFromRecord(question, record);
  assert.deepEqual(restored, picked, 'the same state as before the reload, first answer included');
  // From there the Retry behaves as it always does, and the first answer stays what it was.
  const second = chooseGraded(question, retryGraded(restored), 'o2');
  assert.deepEqual(gradedRecord(question, second), { questionId: 'q-graded', answer: 'o2', firstAnswer: 'o1', attempts: 2, correct: false });
  assert.equal(isRecordSettled(gradedRecord(question, second)), true);
  assert.equal(isRecordSettled({ correct: true, attempts: 1 }), true);
  assert.equal(isRecordSettled({ correct: false, attempts: MAX_WRONG_TRIES }), true, 'revealed');
  assert.equal(isRecordSettled({ correct: null, attempts: 1 }), true, 'an ungraded answer is final as soon as it is given');
});

test('every question type keeps its existing validation', () => {
  assert.equal(isAnswerComplete(poll(), undefined), false);
  assert.equal(isAnswerComplete(poll(), ''), false);
  assert.equal(isAnswerComplete(poll(), 'o2'), true);
  assert.equal(isAnswerComplete(poll(), 'not-an-option'), false);
  assert.equal(isAnswerComplete(poll('true-false', 2), 'o1'), true);
  assert.equal(isAnswerComplete(poll('confidence-continuum', 5), 'o5'), true);

  assert.equal(isAnswerComplete(poll('multi-select'), []), false, 'at least one box');
  assert.equal(isAnswerComplete(poll('multi-select'), ['o1', 'o3']), true);
  assert.equal(isAnswerComplete(poll('multi-select'), 'o1'), false, 'a multi answer is a list');

  const ranked = poll('ranked-voting', 3);
  assert.equal(isAnswerComplete(ranked, ['o1', 'o2']), false, 'every option must be ranked');
  assert.equal(isAnswerComplete(ranked, ['o1', 'o1', 'o2']), false, 'each rank once');
  assert.equal(isAnswerComplete(ranked, ['o3', 'o1', 'o2']), true);
  assert.equal(isAnswerComplete(ranked, ['o3', 'o1', 'zzz']), false);

  const text = { id: 'q-text', type: 'open-text-feedback', prompt: 'Say', options: [] };
  assert.equal(isAnswerComplete(text, '   '), false, 'blank is not feedback');
  assert.equal(isAnswerComplete(text, ' Great '), true);
  assert.equal(isAnswerComplete(text, 'x'.repeat(MAX_TEXT_LENGTH)), true, 'exactly the limit is allowed');
  assert.equal(isAnswerComplete(text, 'x'.repeat(MAX_TEXT_LENGTH + 1)), false, 'one over the limit is not');
  assert.equal(isAnswerComplete(text, `  ${'x'.repeat(MAX_TEXT_LENGTH)}  `), true, 'the limit applies to what is saved, after trimming');
});

test('saved answers keep their shape: lists copied, open text trimmed and capped', () => {
  const text = { id: 'q-text', type: 'open-text-feedback', prompt: 'Say', options: [] };
  assert.equal(normalizeAnswer(text, '  Updated feedback  '), 'Updated feedback');
  assert.equal(MAX_TEXT_LENGTH, 1000, "all of a participant's answers share one SharePoint text column");
  assert.equal(normalizeAnswer(text, 'x'.repeat(5000)).length, 1000);
  const draft = ['o2', 'o1'];
  const saved = normalizeAnswer(poll('ranked-voting'), draft);
  assert.deepEqual(saved, ['o2', 'o1']);
  assert.notEqual(saved, draft);
  assert.equal(normalizeAnswer(poll(), 'o1'), 'o1');
});

test('tap-to-rank appends, removes and shifts; tick boxes toggle', () => {
  assert.deepEqual(toggleRank([], 'a'), ['a']);
  assert.deepEqual(toggleRank(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleRank(['a', 'b', 'c'], 'b'), ['a', 'c'], 'removing one moves the later ones up');
  assert.deepEqual(toggleChoice(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleChoice(['a', 'b'], 'a'), ['b']);
});

test('the layout rules: tiles for choice questions only, letters for plain lists', () => {
  const grid = { ...graded(), layout: 'image-grid' };
  assert.equal(usesTiles(grid), true);
  assert.equal(usesTiles({ ...poll('multi-select'), layout: 'image-grid' }), true);
  assert.equal(usesTiles({ ...poll('ranked-voting'), layout: 'image-grid' }), false);
  assert.equal(usesTiles({ id: 't', type: 'open-text-feedback', prompt: '', options: [], layout: 'image-grid' }), false);
  assert.equal(usesTiles(graded()), false);
  assert.equal(usesTiles({ ...graded(), layout: 'text-list' }), false);
  // Questions.Layout decides. With none set: a list, unless every answer of a choice has a picture.
  const pictured = { ...graded(), options: graded().options.map((option) => ({ ...option, imageUrl: `/img/${option.id}.png` })) };
  assert.equal(questionLayout(graded()), 'text-list');
  assert.equal(questionLayout({ ...graded(), layout: null }), 'text-list');
  assert.equal(questionLayout({ ...graded(), layout: 'carousel' }), 'text-list', 'an unknown layout is treated as none set');
  assert.equal(questionLayout(pictured), 'image-grid', 'no layout, every answer pictured');
  assert.equal(questionLayout({ ...pictured, layout: 'text-list' }), 'text-list', 'an explicit layout wins over the pictures');
  assert.equal(questionLayout({ ...pictured, options: [...pictured.options.slice(1), { ...pictured.options[0], imageUrl: '' }] }), 'text-list', 'one answer without a picture: a list');
  assert.equal(questionLayout({ ...pictured, type: 'ranked-voting' }), 'text-list', 'a ranking is never tiles');
  assert.equal(usesTiles(pictured), true);
  assert.equal(showsLetters(graded()), true);
  assert.equal(showsLetters(poll('true-false', 2)), false);
  assert.equal(showsLetters(poll('confidence-continuum', 5)), false);
  assert.deepEqual([0, 1, 3, 25, 26].map(letterFor), ['A', 'B', 'D', 'Z', '27']);
  assert.deepEqual(correctOptionIds(graded()), ['o2']);
});

test('resume lands on the first question with no saved or pending answer', () => {
  const questions = ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'single-select', prompt: id, options: [] }));
  assert.equal(firstUnansweredIndex(questions, []), 0);
  assert.equal(firstUnansweredIndex(questions, ['a', 'b']), 2);
  assert.equal(firstUnansweredIndex(questions, new Set(['a', 'c'])), 1, 'the first gap, not the last answer');
  assert.equal(firstUnansweredIndex(questions, ['a', 'b', 'c', 'd', 'elsewhere']), -1);
  assert.equal(firstUnansweredIndex([], []), -1);
});

test('the first-try score counts saved first answers, so Retry cannot raise it', () => {
  const questions = [graded(), { ...graded(), id: 'q2' }, { ...graded(), id: 'q3' }, poll()];
  // The saved answer for a graded question is its firstAnswer: q-graded right, q2 wrong, q3 not answered.
  const answers = new Map([['q-graded', 'o2'], ['q2', 'o1']]);
  assert.deepEqual(firstTryScore(questions, answers), { right: 1, total: 3 });
  assert.deepEqual(firstTryScore([poll()], new Map([['q-single-select', 'o1']])), { right: 0, total: 0 }, 'a poll has no score');
});

test('sequential unlock: only the first unfinished activity is open; "open" locks nothing', () => {
  const sections = [
    { id: 'a', complete: true, questionIds: ['q1'] },
    { id: 'b', complete: false, questionIds: ['q2'] },
    { id: 'c', complete: false, questionIds: ['q3'] },
    { id: 'd', complete: true, questionIds: ['q4'] },
  ];
  assert.deepEqual(activityStates(sections, undefined).map((section) => section.state), ['done', 'default', 'locked', 'done'], 'sequential is the default');
  assert.deepEqual(activityStates(sections, 'sequential').map((section) => section.state), ['done', 'default', 'locked', 'done']);
  assert.deepEqual(activityStates(sections, 'open').map((section) => section.state), ['done', 'default', 'default', 'done']);
  assert.deepEqual(activityStates(sections.map((section) => ({ ...section, complete: false })), null).map((section) => section.state), ['default', 'locked', 'locked', 'locked']);
  assert.deepEqual(activityStates(sections.map((section) => ({ ...section, complete: true })), null).map((section) => section.state), ['done', 'done', 'done', 'done']);
  assert.deepEqual(activityStates([], null), []);
});

test('an activity with no questions neither blocks the next one nor is locked itself', () => {
  const sections = [
    { id: 'a', complete: false, questionIds: [] },
    { id: 'b', complete: false, questionIds: ['q'] },
    { id: 'c', complete: false, questionIds: [] },
    { id: 'd', complete: false, questionIds: ['q2'] },
  ];
  assert.deepEqual(activityStates(sections, 'sequential').map((section) => section.state), ['default', 'default', 'default', 'locked']);
});

test('the greeting uses the visitor name, else the staff SharePoint name, else "there"', () => {
  assert.equal(greetingName({ participantName: 'Jordan Lee', sharePointDisplayName: 'iPad Account', participationMode: 'client-visit', visitorId: 'v1' }), 'Jordan Lee');
  assert.equal(greetingName({ participantName: ' Jordan Lee ' }), 'Jordan Lee');
  assert.equal(greetingName({ participantName: '', sharePointDisplayName: 'Casey Example', participationMode: 'staff' }), 'Casey Example');
  assert.equal(greetingName({ sharePointDisplayName: 'Casey Example' }), 'Casey Example', 'no mode yet counts as staff');
  // A visit is never greeted with the firm iPad's account name.
  assert.equal(greetingName({ sharePointDisplayName: 'iPad Account', participationMode: 'client-visit' }), '');
  assert.equal(greetingName({ sharePointDisplayName: 'iPad Account', visitorId: 'v1' }), '');
  assert.equal(greetingName({}), '');
  assert.equal(hiLine('Jane Doe'), 'Hi Jane Doe!');
  assert.equal(hiLine(''), 'Hi there!');
});

// ---- Phase 9a: a graded question that lost its answer key while someone had an open wrong first try ------------------------------

test('an answer to a question that is not graded is one try, nothing right or wrong', () => {
  const question = poll();
  assert.deepEqual(ungradedRecord(question, 'o2'), { questionId: 'q-single-select', answer: 'o2', firstAnswer: 'o2', attempts: 1, correct: null });
  assert.deepEqual(ungradedRecord(question, 'o2', null).attempts, 1);
  const settled = { questionId: 'q-single-select', answer: 'o1', firstAnswer: 'o1', attempts: 1, correct: null };
  assert.equal(ungradedRecord(question, 'o2', settled).attempts, 1, 'an earlier answer that was final changes nothing');
});

test('a wrong first try on a question that then lost its key is settled by the next answer, not left open for ever', async () => {
  const { createAnswerStore } = await import('../migration/src/lib/answer-store.js');
  const api = { getParticipantResponses: async () => null, saveParticipantResponses: async (input) => ({ ref: 1, responses: input.responses }), mergeAnswerRecords: (_held, incoming) => incoming, isUnreachable: () => false };
  const store = createAnswerStore({ api });
  const visit = { trackId: 't', sessionId: 's', clientId: 'c', restartedAt: null };
  let question = graded();
  store.record(visit, 'sec', gradedRecord(question, chooseGraded(question, startGraded(), 'o1'))); // wrong, and Retry not pressed yet
  assert.equal(isRecordSettled(store.recordFor(visit, 'q-graded')), false, 'an open question, as it should be');

  // The facilitator edits the question: no answer is marked correct any more, so the pager now shows it as a poll.
  question = { ...question, options: question.options.map((option) => ({ ...option, correct: false })) };
  assert.equal(isGraded(question), false);
  store.record(visit, 'sec', ungradedRecord(question, normalizeAnswer(question, 'o3'), store.recordFor(visit, 'q-graded')));
  const held = store.recordFor(visit, 'q-graded');
  assert.equal(isRecordSettled(held), true, 'the activity can be finished');
  assert.equal(held.firstAnswer, 'o1', 'the first try is still the first try');
  assert.equal(held.correct, false);
  assert.equal(held.answer, 'o3');
  assert.equal(held.attempts, MAX_WRONG_TRIES);
  await store.flush(visit, 'sec');
});
