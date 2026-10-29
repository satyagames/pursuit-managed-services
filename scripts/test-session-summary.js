// Prompt 21, Phase 5: a session's summary (lib/results/session-summary.js), the totals PMSSessionSummary keeps so that the Leadership dashboard reads
// one item a session and never every answer. Worked out by hand from a session of four guests. Run: node --test scripts/test-session-summary.js.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLeaderReport } from '../migration/src/lib/exports/leader-report.js';
import { FEEDBACK_QUOTES, summaryOf, summaryRecord, themesOf } from '../migration/src/lib/results/session-summary.js';

const option = (id, questionId, label, value = id) => ({ id, questionId, label, value, correct: false, imageUrl: null });
const answer = (trackId, questionId, given) => ({ questionId, clientTrackId: trackId, answer: given, firstAnswer: given, attempts: 1, correct: null });

/** Four guests. The check: Before 2, 3, 1 (t1 to t3), After 4, 3, 5 (t1, t2, t4). A poll, a ranking, and a Survey feedback question. */
export function fourGuests() {
  const session = { id: 'kroger-2026-10-27-0930', clientId: 'kroger', date: '2026-10-27', startTime: '09:30', title: 'Morning workshop', sectionIds: ['chk', 'act'], status: 'completed', confidenceCheck: true, period: '' };
  const sections = [
    { id: 'chk', title: 'Confidence check', kind: 'confidence-check', enabled: true, order: 0, questionIds: ['cq'], clientId: 'kroger' },
    { id: 'act', title: 'Priorities', enabled: true, order: 1, questionIds: ['q1', 'q2', 'q3'], clientId: 'kroger' },
  ];
  const questions = [
    { id: 'cq', sectionId: 'chk', type: 'confidence-continuum', prompt: 'How confident?', optionIds: ['c1', 'c2', 'c3', 'c4', 'c5'], order: 1 },
    { id: 'q1', sectionId: 'act', type: 'single-select', prompt: 'What matters most?', optionIds: ['a', 'b'], order: 1 },
    { id: 'q2', sectionId: 'act', type: 'ranked-voting', prompt: 'Rank these', optionIds: ['x', 'y'], order: 2 },
    { id: 'q3', sectionId: 'act', type: 'open-text-feedback', prompt: 'Anything else?', optionIds: [], order: 3 },
  ];
  const options = [
    ...[1, 2, 3, 4, 5].map((value) => option(`c${value}`, 'cq', `Step ${value}`, value)),
    option('a', 'q1', 'Speed'), option('b', 'q1', 'Cost'), option('x', 'q2', 'Trust'), option('y', 'q2', 'Speed'),
  ];
  const tracks = ['Asha', 'Ben', 'Chen', 'Dana'].map((name, at) => ({ id: `t${at + 1}`, sessionId: session.id, clientId: 'kroger', participantName: name, visitorId: `v${at + 1}`, joinedVia: 'qr', createdAt: `2026-10-27T09:3${at}:00.000Z` }));
  const answers = [
    answer('t1', 'cq@before', 'c2'), answer('t2', 'cq@before', 'c3'), answer('t3', 'cq@before', 'c1'),
    answer('t1', 'cq@after', 'c4'), answer('t2', 'cq@after', 'c3'), answer('t4', 'cq@after', 'c5'),
    answer('t1', 'q1', 'a'), answer('t2', 'q1', 'a'), answer('t3', 'q1', 'b'),
    answer('t1', 'q2', ['x', 'y']), answer('t2', 'q2', ['y', 'x']), answer('t4', 'q2', ['x', 'y']),
    answer('t1', 'q3', 'Great pace and great clarity'), answer('t2', 'q3', 'Clarity of the roadmap'),
  ];
  const roster = [
    { id: 'v1', sessionId: session.id, displayName: 'Asha', enabled: true, guestGroup: 'Executives' },
    { id: 'v2', sessionId: session.id, displayName: 'Ben', enabled: true, guestGroup: 'executives ' },
    { id: 'v3', sessionId: session.id, displayName: 'Chen', enabled: true, guestGroup: '' },
  ];
  return { session, client: { id: 'kroger', name: 'Kroger' }, tracks, sections, questions, options, answers, visits: [], roster, strayQuestions: [], strayOptions: [], unreadable: [] };
}

describe('a session\'s summary, from the leader report\'s counts', () => {
  const records = fourGuests();
  const at = new Date('2026-10-27T12:00:00.000Z');
  const made = summaryOf(records, buildLeaderReport(records, { generatedAt: at }), { writtenBy: 'Rajeshwar Aedla', at, startMonth: 6 });

  it('the totals: guests, answers to the activities, those who finished, and the period of its date', () => {
    assert.equal(made.id, records.session.id);
    assert.equal(made.clientId, 'kroger');
    assert.equal(made.period, 'FY27-Q2');
    assert.equal(made.sessionDate, '2026-10-27');
    assert.equal(made.guests, 4);
    assert.equal(made.answers, 8, '3 + 3 + 2: the check is not an activity');
    assert.equal(made.completed, 2, 'Asha and Ben answered every question of every activity (the check is not one)');
  });
  it('the check: every Before and After, and the paired guests\' means apart', () => {
    assert.deepEqual([made.beforeCount, made.afterCount, made.pairedCount], [3, 3, 2]);
    assert.equal(made.meanBefore, 2);
    assert.equal(made.meanAfter, 4);
    assert.deepEqual([made.summary.scaleMax, made.summary.pairedBefore, made.summary.pairedAfter], [5, 2.5, 3.5]);
    assert.deepEqual(made.summary.moved, { started: 1, moved: 1 });
    assert.deepEqual(made.summary.distribution, { before: [1, 1, 1, 0, 0], after: [0, 0, 1, 1, 1] });
  });
  it('the first choices of the polls and rankings, by option', () => {
    assert.deepEqual(made.summary.firstChoices, [
      { questionId: 'q1', prompt: 'What matters most?', options: [{ label: 'Speed', count: 2 }, { label: 'Cost', count: 1 }] },
      { questionId: 'q2', prompt: 'Rank these', options: [{ label: 'Trust', count: 2 }, { label: 'Speed', count: 1 }] },
    ]);
  });
  it('Survey feedback: its themes and a few comments with their author', () => {
    assert.equal(made.summary.feedback.count, 2);
    assert.deepEqual(made.summary.feedback.themes, [{ word: 'clarity', count: 2 }, { word: 'great', count: 1 }, { word: 'pace', count: 1 }, { word: 'roadmap', count: 1 }]);
    assert.deepEqual(made.summary.feedback.quotes, [{ name: 'Asha', text: 'Great pace and great clarity' }, { name: 'Ben', text: 'Clarity of the roadmap' }]);
  });
  it('who it is about, for the filters: the guest groups that joined, the kinds of question, the title, time and writer', () => {
    assert.deepEqual(made.summary.groups, { Executives: 2 });
    assert.deepEqual(made.summary.kinds, { choice: 3, ranking: 3, text: 2 });
    assert.deepEqual([made.summary.title, made.summary.startTime, made.summary.facilitator, made.summary.builtAt], ['Morning workshop', '09:30', 'Rajeshwar Aedla', at.toISOString()]);
  });
  it('a session without the check measures nothing: no means, no counts', () => {
    const plain = { ...records, session: { ...records.session, confidenceCheck: false } };
    const none = summaryOf(plain, buildLeaderReport(plain, { generatedAt: at }), { writtenBy: '', at, startMonth: 6 });
    assert.deepEqual([none.beforeCount, none.afterCount, none.pairedCount, none.meanBefore, none.meanAfter], [0, 0, 0, null, null]);
    assert.equal(none.summary.moved, null);
  });
  it('the stored period wins over the date\'s, and the item holds the JSON in SummaryJson', () => {
    const stored = { ...records, session: { ...records.session, period: 'FY27-Q1' } };
    assert.equal(summaryOf(stored, buildLeaderReport(stored, { generatedAt: at }), { writtenBy: '', at, startMonth: 6 }).period, 'FY27-Q1');
    const item = summaryRecord(made);
    assert.equal(typeof item.summaryJson, 'object');
    assert.equal(item.summary, undefined);
    assert.equal(item.summaryJson.title, 'Morning workshop');
  });
});

describe('themes and quotes', () => {
  it('a theme is a word of four letters or more, counted once a comment, without the common words', () => {
    assert.deepEqual(themesOf(['The team, the TEAM!', 'Our team was really good', 'About this and that']), [{ word: 'team', count: 2 }, { word: 'good', count: 1 }, { word: 'really', count: 1 }]);
  });
  it('keeps at most FEEDBACK_QUOTES comments, each 200 characters at most', () => {
    const records = fourGuests();
    records.answers.push(...['t3', 't4'].map((id) => answer(id, 'q3', 'x'.repeat(500))));
    const made = summaryOf(records, buildLeaderReport(records), { writtenBy: '', at: new Date(), startMonth: 6 });
    assert.ok(made.summary.feedback.quotes.length <= FEEDBACK_QUOTES);
    assert.ok(made.summary.feedback.quotes.every((quote) => quote.text.length <= 200));
  });
});
