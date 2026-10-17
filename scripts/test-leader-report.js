// Phase 7b: the leader report's numbers and the participant CSV. Run: npm run test:report
//
// Every expected number here is WRITTEN OUT, worked from the fixture by hand (the working is in the comments), or, for the session
// of 60 people, counted again by a few lines in this file that do not call the code under test. Nothing is compared with itself.
// scripts/mutate-leader-report.js breaks the counting on purpose, one rule at a time, and checks that this file then fails
// (it points LEADER_REPORT_MODULE at the broken copy).
//
// The fixture (scripts/leader-report-fixtures.js), in short. Harbour has three activities that count:
//   Harbour History   Q1 "Which year...?" (1887 right), Q2 true/false (True right), Q3 "Who designed...?" (Ada Łęcka right)
//   Your Views        Q4 poll, Q5 choose any, Q6 confidence 1 to 3, Q7 ranking of three, Q8 written
//   Bonus Round       Q9 graded, SWITCHED OFF, with one answer (so it is shown)       [Never Run: off, no answers, left out]
// and seven visits, in the order they joined (first pick > last pick):
//   José Álvarez        Q1 1887 | Q2 True | Q3 Holm>Łęcka | Q4 Speed | Q5 Phone,App | Q6 Very | Q7 Quality,Cost,Speed | Q8 text | Q9 Eastbay (no retry) | + an answer to a question moved out of the session
//   Zoë Brontë          Q1 1901>1887 | Q2 True | Q3 Marín>Holm | Q4 Care | Q5 Email | Q6 Fairly | Q7 Quality,Speed,Cost | + an answer to a deleted question
//   Søren Kjær (staff)  Q1 1901>1923 | Q2 False>True | Q3 Holm>Łęcka | Q4 Care | Q5 Phone,Email,App | Q6 Very | Q7 Cost,Quality,Speed | Q8 text
//   Łukasz Żółć         RESTARTED. After it: Q1 1887 | Q2 True | Q3 Łęcka | Q4 Price | Q6 Fairly | Q8 text
//   (no name)           Q1 1923 (no retry)
//   José Álvarez again  nothing
//   (no name)           Q1 1887 | + a written answer to a deleted question

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BIG, DAY, bigComment, bigName, bigRecords, harbourRecords } from './leader-report-fixtures.js';
import { TITLE } from './sharepoint-fake.js';

const lib = await import(process.env.LEADER_REPORT_MODULE ?? '../migration/src/lib/exports/leader-report.js');
const { COUNTING_RULES, CSV_COLUMNS, NO_ANSWERS, STRAY_TITLE, answeredLine, buildLeaderReport, csvCell, kindOf, participantAnswersCsv, participantAnswersRows, printColours, reportFileName, reportParticipants, scoreLine, wholePercent } = lib;

const OPTIONS = { generatedAt: '2026-10-12T09:30:00.000Z', timeZone: 'UTC' };
const harbour = () => buildLeaderReport(harbourRecords(), OPTIONS);
const question = (report, number) => report.activities.flatMap((activity) => activity.questions).find((entry) => entry.number === number);
const person = (report, name) => report.participants.find((entry) => entry.name === name);
const counts = (entry) => Object.fromEntries(entry.options.map((option) => [option.label, option.count]));
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ''} expected ${expected}, got ${actual}`);

describe('who took part, and by what name', () => {
  it('lists every visit in the order it joined, with the recorded name and nothing else', () => {
    assert.deepEqual(harbour().participants.map((entry) => entry.name), [
      'José Álvarez',          // the name on the guest's QR code
      'Zoë Brontë',
      'Søren Kjær',            // staff: the sign-in name, kept in the visit log for the account
      'Łukasz Żółć',
      'Unnamed participant 1', // no name recorded anywhere
      'José Álvarez (2)',      // the same guest's second visit
      'Unnamed participant 2',
    ]);
  });

  it('never invents a name: not the client’s, not an id', () => {
    const report = harbour();
    const unnamed = report.participants.filter((entry) => entry.unnamed);
    assert.equal(unnamed.length, 2);
    for (const entry of report.participants) {
      assert.notEqual(entry.name, 'Harbour & Søn');
      assert.doesNotMatch(entry.name, /^t-|c-harbour/);
    }
  });

  it('takes a name from the roster, then from the visit log of that visit, then from the account, in that order', () => {
    const base = { answers: [], roster: [{ id: 'v1', displayName: '  Renée   Dvořák ' }] };
    const names = (tracks, visits = []) => reportParticipants({ ...base, tracks, visits }).map((entry) => entry.name);
    assert.deepEqual(names([{ id: 'a', visitorId: 'v1', participantName: null, createdAt: '1' }]), ['Renée Dvořák']);
    assert.deepEqual(names([{ id: 'a', visitorId: 'v1', participantName: 'As Scanned', createdAt: '1' }]), ['As Scanned']);
    assert.deepEqual(names([{ id: 'a', sharePointUserId: 9, createdAt: '1' }], [{ sharePointUserId: '9', displayName: 'Ana Staff', trackId: null, visitedAt: '1' }]), ['Ana Staff']);
    assert.deepEqual(names([{ id: 'a', sharePointUserId: 9, createdAt: '1' }], [{ sharePointUserId: '9', displayName: 'Ana Staff', trackId: null, visitedAt: '1' }, { displayName: 'By Visit', trackId: 'a', visitedAt: '2' }]), ['By Visit']);
    // A guest's visit is never given the name of the account the iPad happens to be signed in to.
    assert.deepEqual(names([{ id: 'a', visitorId: 'gone', sharePointUserId: 9, createdAt: '1' }], [{ sharePointUserId: '9', displayName: 'The iPad Account', trackId: null, visitedAt: '1' }]), ['Unnamed participant 1']);
  });

  it('lists someone whose visit record has gone but whose answers remain, without a name', () => {
    const records = harbourRecords();
    records.tracks = records.tracks.filter((track) => track.id !== 't-zoe');
    const report = buildLeaderReport(records, OPTIONS);
    assert.equal(report.summary.joined, 7);
    assert.deepEqual(report.participants.map((entry) => entry.name).slice(-2), ['Unnamed participant 2', 'Unnamed participant 3']);
    assert.equal(report.participants.at(-1).joined, 'Their visit record no longer exists');
    assert.equal(report.participants.at(-1).answered, 7);
  });
});

describe('results by question (worked by hand)', () => {
  it('a graded question counts FIRST answers: Q1', () => {
    // First picks: 1887 by José, Łukasz, unnamed 2 (3); 1901 by Zoë, Søren (2); 1923 by unnamed 1 (1); 1950 by nobody.
    const q1 = question(harbour(), 1);
    assert.equal(q1.kind, 'graded');
    assert.equal(q1.respondents, 6);
    assert.deepEqual(counts(q1), { 1887: 3, 1901: 2, 1923: 1, 1950: 0 });
    assert.deepEqual(q1.options.map((option) => option.correct), [true, false, false, false]);
    assert.deepEqual(q1.firstTry, { right: 3, answered: 6, percent: 50 });
    assert.deepEqual(q1.commonWrong, { label: '1901', count: 2 });
    // Of the three who missed: Zoë got it on the second try, Søren was shown the answer, unnamed 1 never tried again.
    assert.deepEqual(q1.retries, { later: 1, shown: 1, open: 1 });
    close(q1.options[1].percent, 100 * 2 / 6);
  });

  it('Q2 (true or false) and Q3', () => {
    const report = harbour();
    const q2 = question(report, 2);
    assert.equal(q2.kindLabel, 'True or false');
    assert.deepEqual(counts(q2), { True: 3, False: 1 });
    assert.deepEqual(q2.firstTry, { right: 3, answered: 4, percent: 75 });
    assert.deepEqual(q2.commonWrong, { label: 'False', count: 1 });
    assert.deepEqual(q2.retries, { later: 1, shown: 0, open: 0 });
    const q3 = question(report, 3);
    assert.deepEqual(counts(q3), { 'Ada Łęcka': 1, 'Søren Holm': 2, 'José Marín': 1 });
    assert.deepEqual(q3.firstTry, { right: 1, answered: 4, percent: 25 });
    assert.deepEqual(q3.commonWrong, { label: 'Søren Holm', count: 2 });
    assert.deepEqual(q3.retries, { later: 2, shown: 1, open: 0 }); // José and Søren got there; Zoë was shown
  });

  it('a poll is a distribution with no right answer: Q4', () => {
    const q4 = question(harbour(), 4);
    assert.equal(q4.kind, 'choice');
    assert.equal(q4.respondents, 4);
    assert.deepEqual(counts(q4), { Speed: 1, Price: 1, Care: 2 });
    assert.deepEqual(q4.options.map((option) => option.percent), [25, 25, 50]);
    assert.equal(q4.firstTry, null);
    assert.equal(q4.commonWrong, null);
    assert.ok(q4.options.every((option) => option.correct === false));
  });

  it('choose-any counts each choice once per person, as a share of the people: Q5', () => {
    // José: Phone, App. Zoë: Email. Søren: all three. Three people, two for each channel.
    const q5 = question(harbour(), 5);
    assert.equal(q5.kind, 'multi');
    assert.equal(q5.respondents, 3);
    assert.deepEqual(counts(q5), { Phone: 2, Email: 2, App: 2 });
    for (const option of q5.options) close(option.percent, 200 / 3);
    assert.match(q5.notes.join(' '), /more than 100%/);
  });

  it('a confidence question has its distribution and its average: Q6', () => {
    // Very (3), Fairly (2), Very (3), Fairly (2): 10 / 4 = 2.5.
    const q6 = question(harbour(), 6);
    assert.equal(q6.kind, 'scale');
    assert.deepEqual(counts(q6), { 'Not confident': 0, 'Fairly confident': 2, 'Very confident': 2 });
    assert.deepEqual(q6.average, { value: 2.5, min: 1, max: 3, answers: 4 });
  });

  it('a ranking is ordered by points: Q7', () => {
    // Three options, so 3, 2, 1 points. José: Quality, Cost, Speed. Zoë: Quality, Speed, Cost. Søren: Cost, Quality, Speed.
    //   Quality 3 + 3 + 2 = 8 (places 1, 1, 2: average 4/3)   Cost 2 + 1 + 3 = 6 (places 2, 3, 1: average 2)   Speed 1 + 2 + 1 = 4 (places 3, 2, 3: average 8/3)
    const q7 = question(harbour(), 7);
    assert.equal(q7.kind, 'ranking');
    assert.equal(q7.respondents, 3);
    assert.deepEqual(q7.ranking.map((option) => [option.label, option.score, option.firsts]), [['Quality', 8, 2], ['Cost', 6, 1], ['Speed', 4, 0]]);
    close(q7.ranking[0].averagePlace, 4 / 3);
    close(q7.ranking[1].averagePlace, 2);
    close(q7.ranking[2].averagePlace, 8 / 3);
    close(q7.ranking[0].percent, 800 / 18);
    close(q7.ranking[2].percent, 400 / 18);
  });

  it('a written question keeps every answer whole, with its author: Q8', () => {
    const report = harbour();
    assert.deepEqual(question(report, 8).comments, [
      { name: 'José Álvarez', text: 'Great day — thank you!' },
      { name: 'Søren Kjær', text: 'Søren says: more time for questions, please.\nAnd coffee.' },
      { name: 'Łukasz Żółć', text: '=SUM(A1:A9) "quoted", with a comma' },
    ]);
    assert.deepEqual(report.comments.map((entry) => [entry.number, entry.activity, entry.entries.length]), [[8, 'Your Views', 3]]);
    assert.equal(report.summary.commentCount, 3);
  });

  it('breaks a tie for the most common wrong answer by the options’ own order', () => {
    const records = harbourRecords();
    // Unnamed 2 now also picks 1923 first: 1901 has 2, 1923 has 2. 1901 comes first among the options.
    records.answers.find((answer) => answer.clientTrackId === 't-stray' && answer.questionId === 'q1').firstAnswer = 'o1c';
    assert.deepEqual(question(buildLeaderReport(records, OPTIONS), 1).commonWrong, { label: '1901', count: 2 });
  });

  it('says what kind each question is', () => {
    const report = harbour();
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => question(report, number).kind), ['graded', 'graded', 'graded', 'choice', 'multi', 'scale', 'ranking', 'text', 'graded']);
    assert.equal(kindOf({ type: 'true-false', options: [{ correct: null }, { correct: null }] }), 'choice');
    assert.equal(kindOf({ type: 'multi-select', options: [{ correct: true }] }), 'multi'); // never graded, as in the pager
    assert.equal(kindOf({ type: 'something-new', options: [] }), 'text');
  });
});

describe('each person (worked by hand)', () => {
  it('José: 9 of 9 answered, 2 of 4 first tries right, both live activities finished', () => {
    // Graded: Q1 right, Q2 right, Q3 wrong first, Q9 wrong first: 2 of 4 = 50%.
    const jose = person(harbour(), 'José Álvarez');
    assert.deepEqual([jose.answered, jose.questionCount, jose.gradedAnswered, jose.gradedRight, jose.scorePercent], [9, 9, 4, 2, 50]);
    assert.deepEqual(jose.activities.map((activity) => [activity.title, activity.status]), [['Harbour History', 'finished'], ['Your Views', 'finished'], ['Bonus Round', 'started']]);
    assert.deepEqual([jose.activitiesFinished, jose.activityCount, jose.finishedAll], [2, 2, true]);
    assert.equal(scoreLine(jose), '2 of 4 right first time (50%)');
    assert.equal(answeredLine(jose), '9 of 9 answered');
  });

  it('a Retry never raises a score: Zoë got Q1 right the second time and it still counts as wrong', () => {
    // Graded: Q1 wrong first (then right), Q2 right, Q3 wrong first (then wrong): 1 of 3.
    const zoe = person(harbour(), 'Zoë Brontë');
    assert.deepEqual([zoe.gradedAnswered, zoe.gradedRight], [3, 1]);
    close(zoe.scorePercent, 100 / 3);
    const q1 = zoe.activities[0].rows[0];
    assert.deepEqual([q1.first, q1.final, q1.verdict, q1.firstRight, q1.finalRight, q1.attempts], ['1901', '1887', 'wrong', false, true, 2]);
    assert.equal(q1.said, '1901 (wrong), then 1887 (right)');
    assert.equal(zoe.activities[0].rows[2].said, 'José Marín (wrong), then Søren Holm (wrong; answer shown)');
    assert.equal(zoe.activities[0].rows[1].said, 'True (right first time)');
    // The same wrong answer picked again is said once.
    const records = harbourRecords();
    Object.assign(records.answers.find((answer) => answer.clientTrackId === 't-zoe' && answer.questionId === 'q3'), { finalAnswer: 'o3c' });
    assert.equal(person(buildLeaderReport(records, OPTIONS), 'Zoë Brontë').activities[0].rows[2].said, 'José Marín (wrong twice; answer shown)');
    // Seven of nine answered: "7 of 9 answered" is what tells the reader she stopped early.
    assert.equal(answeredLine(zoe), '7 of 9 answered');
    assert.deepEqual(zoe.activities.map((activity) => activity.status), ['finished', 'started', 'not-started']);
    assert.deepEqual([zoe.activitiesFinished, zoe.finishedAll], [1, false]);
  });

  it('Søren: every first try wrong is 0%, and still finished', () => {
    const soren = person(harbour(), 'Søren Kjær');
    assert.deepEqual([soren.answered, soren.gradedAnswered, soren.gradedRight, soren.scorePercent, soren.finishedAll], [8, 3, 0, 0, true]);
    assert.equal(scoreLine(soren), '0 of 3 right first time (0%)');
    assert.equal(soren.joined, 'Joined at 1:02 PM');
  });

  it('a wrong first answer that was never tried again is not final, so the activity is not finished', () => {
    const unnamed = person(harbour(), 'Unnamed participant 1');
    assert.deepEqual([unnamed.answered, unnamed.gradedAnswered, unnamed.gradedRight, unnamed.scorePercent], [1, 1, 0, 0]);
    assert.equal(unnamed.activities[0].status, 'started');
    assert.equal(unnamed.activities[0].rows[0].open, true);
    assert.equal(unnamed.activities[0].rows[0].said, '1923 (wrong), did not try again');
    assert.equal(answeredLine(unnamed), '1 of 9 answered');
  });

  it('someone who joined and answered nothing is listed, with no score', () => {
    const report = harbour();
    const again = person(report, 'José Álvarez (2)');
    assert.deepEqual([again.answered, again.gradedAnswered, again.scorePercent, again.finishedAll, again.strays], [0, 0, null, false, 0]);
    assert.equal(scoreLine(again), 'No graded question answered');
    assert.ok(again.activities.every((activity) => activity.status === 'not-started'));
    assert.equal(report.summary.answeredNothing, 1);
    assert.equal(NO_ANSWERS, 'No answers recorded');
  });

  it('a restarted participant: what they answered after the restart counts, and their page says so', () => {
    // The fixture holds only what Łukasz answered AFTER the restart, because a restart removes the earlier answers from storage
    // (scripts/test-leader-report-pdf.js plays a real restart through the data service and gets these same numbers).
    const lukasz = person(harbour(), 'Łukasz Żółć');
    assert.deepEqual([lukasz.answered, lukasz.gradedAnswered, lukasz.gradedRight, lukasz.scorePercent], [6, 3, 3, 100]);
    assert.equal(lukasz.restart, 'Restarted by the facilitator at 1:40 PM, from the beginning. Answers given before that were removed then and are not in this report.');
    assert.deepEqual(harbour().participants.filter((entry) => entry.restart).map((entry) => entry.name), ['Łukasz Żółć']);
    assert.match(harbour().notes.join(' '), /1 participant was restarted by the facilitator/);
    // A restart from one activity names it.
    const records = harbourRecords();
    Object.assign(records.tracks.find((track) => track.id === 't-zoe'), { restartedAt: `${DAY}T14:05:00.000Z`, restartSectionId: 'a-views' });
    assert.match(person(buildLeaderReport(records, OPTIONS), 'Zoë Brontë').restart, /^Restarted by the facilitator at 2:05 PM, from “Your Views”\./);
  });
});

describe('the summary (worked by hand)', () => {
  it('joined, finished everything, the average first-try score', () => {
    // Scores: José 50, Zoë 33.33, Søren 0, Łukasz 100, unnamed 1 0, unnamed 2 100; José's second visit has none.
    // Average over the six who have one: 283.33 / 6 = 47.22.
    const { summary } = harbour();
    assert.equal(summary.joined, 7);
    assert.equal(summary.finishedAll, 2); // José and Søren
    assert.equal(summary.scored, 6);
    close(summary.averageScore, (50 + 100 / 3 + 0 + 100 + 0 + 100) / 6);
    assert.equal(wholePercent(summary.averageScore), '47%');
    assert.deepEqual([summary.questionCount, summary.gradedCount], [9, 4]);
  });

  it('completion by activity', () => {
    assert.deepEqual(harbour().summary.activities, [
      { title: 'Harbour History', off: false, questions: 3, finished: 4, started: 2, notStarted: 1 }, // unnamed 1 and 2 started; José's second visit did not
      { title: 'Your Views', off: false, questions: 5, finished: 2, started: 2, notStarted: 3 },      // José and Søren; Zoë and Łukasz part way
      { title: 'Bonus Round', off: true, questions: 1, finished: 0, started: 1, notStarted: 6 },
    ]);
  });

  it('the hardest and the easiest question, by the share right first time', () => {
    // Q1 50%, Q2 75%, Q3 25%. (Q9, in the switched-off activity, is not compared.)
    const { hardest, easiest, flat } = harbour().summary;
    assert.deepEqual(hardest, { number: 3, prompt: 'Who designed the lighthouse?', activity: 'Harbour History', right: 1, answered: 4, percent: 25 });
    assert.deepEqual(easiest, { number: 2, prompt: 'The first ship to dock was a steamer.', activity: 'Harbour History', right: 3, answered: 4, percent: 75 });
    assert.equal(flat, null);
  });

  it('a tie goes to the question more people answered; no contest when every question is level', () => {
    const records = harbourRecords();
    // Make Q2 50% as well: Zoë's first pick becomes False. Q1 is 3 of 6 and Q2 2 of 4: both 50%, and Q1 has more answers.
    Object.assign(records.answers.find((answer) => answer.clientTrackId === 't-zoe' && answer.questionId === 'q2'), { answer: 'o2f', firstAnswer: 'o2f', correct: false });
    const tied = buildLeaderReport(records, OPTIONS).summary;
    assert.equal(tied.easiest.number, 1);
    assert.equal(tied.hardest.number, 3);
    // Only Q1 answered at all: nothing to compare.
    const one = harbourRecords();
    one.answers = one.answers.filter((answer) => answer.questionId === 'q1');
    const flat = buildLeaderReport(one, OPTIONS).summary;
    assert.deepEqual([flat.hardest, flat.easiest], [null, null]);
    assert.deepEqual(flat.flat, { percent: 50, questions: 1 });
    const none = harbourRecords();
    none.answers = [];
    assert.deepEqual([buildLeaderReport(none, OPTIONS).summary.averageScore, buildLeaderReport(none, OPTIONS).summary.flat], [null, null]);
  });

  it('states the rules it counted by, and when it was made', () => {
    const report = harbour();
    assert.equal(report.rules, COUNTING_RULES);
    assert.equal(COUNTING_RULES.length, 8);
    const rules = COUNTING_RULES.join(' ');
    for (const phrase of ['Unnamed participant 1, 2', 'no name is guessed', 'first answer only', '7 of 15 answered', 'restarted', STRAY_TITLE, NO_ANSWERS, 'read when the report is made']) assert.ok(rules.includes(phrase), phrase);
    assert.equal(report.meta.generated, 'October 12, 2026 at 9:30 AM UTC');
    assert.equal(report.meta.dateText, 'October 11, 2026');
    assert.equal(report.meta.status, 'Ended October 11, 2026 at 4:30 PM UTC');
    assert.deepEqual([report.meta.clientName, report.meta.eventTitle], ['Harbour & Søn', 'Harbour Discovery Day']);
    const open = harbourRecords();
    Object.assign(open.session, { status: 'in-progress', endedAt: null });
    assert.match(buildLeaderReport(open, OPTIONS).meta.status, /^Not ended when this report was made/);
  });
});

describe('questions that are no longer in the activity', () => {
  it('lists their answers, by name, and counts them nowhere', () => {
    const report = harbour();
    assert.deepEqual(report.strays, [
      // The question still exists (it was moved out of the session), so its wording and the answer's wording can be read.
      { title: 'Which colour is the old pier?', known: true, entries: [{ name: 'José Álvarez', text: 'Blue' }] },
      // The question was deleted: a written answer is still readable; a choice is only an id, and an id is never printed.
      { title: 'Deleted question 1 (its wording is no longer stored)', known: false, entries: [
        { name: 'Zoë Brontë', text: 'An answer that can no longer be read (its question was deleted)' },
        { name: 'Unnamed participant 2', text: 'It was fine' },
      ] },
    ]);
    assert.deepEqual(report.participants.map((entry) => entry.strays), [1, 1, 0, 0, 0, 0, 1]);
    // Not in any score or total: the same numbers as a session without them.
    const without = harbourRecords();
    without.answers = without.answers.filter((answer) => !['q-moved', 'q-deleted'].includes(answer.questionId));
    const clean = buildLeaderReport(without, OPTIONS);
    assert.deepEqual(clean.strays, []);
    assert.deepEqual(clean.summary, report.summary);
    assert.deepEqual(clean.participants.map((entry) => [entry.answered, entry.gradedAnswered, entry.gradedRight]), report.participants.map((entry) => [entry.answered, entry.gradedAnswered, entry.gradedRight]));
    assert.equal(JSON.stringify(report).includes('o-old-2'), false, 'an id is never in the report');
  });

  it('a question deleted from an activity drops out of the results and into that list', () => {
    const records = harbourRecords();
    // The admin deletes Q3: the record goes and the activity no longer lists it. Its four answers stay in storage.
    records.questions = records.questions.filter((entry) => entry.id !== 'q3');
    records.sections.find((section) => section.id === 'a-history').questionIds = ['q1', 'q2'];
    const report = buildLeaderReport(records, OPTIONS);
    assert.deepEqual(report.activities[0].questions.map((entry) => entry.prompt), ['Which year did the harbour open?', 'The first ship to dock was a steamer.']);
    const stray = report.strays.find((entry) => entry.entries.length === 4);
    assert.equal(stray.known, false);
    assert.deepEqual(stray.entries.map((entry) => entry.name), ['José Álvarez', 'Zoë Brontë', 'Søren Kjær', 'Łukasz Żółć']);
    // José's score no longer has Q3 in it: Q1 right, Q2 right, Q9 wrong = 2 of 3.
    assert.deepEqual([person(report, 'José Álvarez').gradedAnswered, person(report, 'José Álvarez').gradedRight], [3, 2]);
    assert.equal(report.summary.questionCount, 8);
  });

  it('an answer without a participant (the oldest data) is said to be left out', () => {
    const records = harbourRecords();
    records.answers.push({ questionId: 'q4', clientId: null, clientTrackId: null, answer: 'o4a', firstAnswer: 'o4a', finalAnswer: 'o4a', attempts: null, correct: null, timestamp: null });
    const report = buildLeaderReport(records, OPTIONS);
    assert.equal(question(report, 4).respondents, 4);
    assert.match(report.notes.join(' '), /1 answer recorded without a participant, by an older version of the app, is not in this report/);
  });
});

describe('activities that are switched off, options that were removed, a key that was changed', () => {
  it('shows a switched-off activity that holds answers, leaves out one that holds none, and does not ask for it to be finished', () => {
    const report = harbour();
    assert.deepEqual(report.activities.map((activity) => [activity.title, activity.off]), [['Harbour History', false], ['Your Views', false], ['Bonus Round', true]]);
    assert.equal(question(report, 9).prompt, 'Bonus: what is the capital of the region?');
    assert.deepEqual(question(report, 9).retries, { later: 0, shown: 0, open: 1 });
    assert.match(report.notes.join(' '), /switched off now but holds answers is included/);
    // José left the bonus question open and is still "finished".
    assert.equal(person(report, 'José Álvarez').finishedAll, true);
  });

  it('an answer whose option was later removed is counted as answered, said to be removed, and judged by what was recorded', () => {
    const records = harbourRecords();
    // The admin deletes "1887" (the right answer) from Q1 and adds a new right one. Three people had picked it first, and were told they were right.
    records.options = records.options.filter((option) => option.id !== 'o1a');
    records.options.push({ id: 'o1z', questionId: 'q1', label: 'Eighteen eighty-seven', value: 'x', correct: true });
    records.questions.find((entry) => entry.id === 'q1').optionIds = ['o1z', 'o1b', 'o1c', 'o1d'];
    const q1 = question(buildLeaderReport(records, OPTIONS), 1);
    assert.equal(q1.respondents, 6);
    assert.equal(q1.removed, 3);
    assert.deepEqual(counts(q1), { 'Eighteen eighty-seven': 0, 1901: 2, 1923: 1, 1950: 0 });
    assert.deepEqual(q1.firstTry, { right: 3, answered: 6, percent: 50 }); // still right: that is what they were told on the day
    assert.match(q1.notes.join(' '), /3 answers chose answer options that were later removed/);
    assert.equal(person(buildLeaderReport(records, OPTIONS), 'José Álvarez').activities[0].rows[0].first, 'an answer option that was later removed');
  });

  it('uses the answer that is marked correct now, and says when that differs from the day', () => {
    const records = harbourRecords();
    // After the event the admin corrects Q2's key: False is right.
    records.options.find((option) => option.id === 'o2t').correct = false;
    records.options.find((option) => option.id === 'o2f').correct = true;
    const q2 = question(buildLeaderReport(records, OPTIONS), 2);
    assert.deepEqual(q2.firstTry, { right: 1, answered: 4, percent: 25 }); // only Søren picked False first
    assert.match(q2.notes.join(' '), /The correct answer was changed after 4 people answered/);
  });

});

describe('the participant CSV', () => {
  const csv = () => participantAnswersCsv(harbour());

  it('starts with a byte-order mark and the column names, and ends every line with CRLF', () => {
    const text = csv();
    assert.equal(text.charCodeAt(0), 0xFEFF);
    assert.deepEqual([...CSV_COLUMNS], ['Client', 'Date', 'Participant', 'Activity', 'Question', 'First answer', 'Final answer', 'Correct', 'Correct on first try', 'Attempts', 'Answered at']);
    assert.equal(text.slice(1).split('\r\n')[0], CSV_COLUMNS.join(','));
    assert.ok(text.endsWith('\r\n'));
    assert.equal(text.replace(/\r\n/g, '').includes('\r'), false);
    assert.deepEqual([...Buffer.from(text, 'utf8').subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
  });

  it('has one row for each participant and question, answered or not, then the answers to questions no longer in an activity', () => {
    const rows = participantAnswersRows(harbour());
    assert.equal(rows.length, 7 * 9 + 3);
    assert.ok(rows.every((row) => row.length === CSV_COLUMNS.length));
    assert.deepEqual(rows[0], ['Harbour & Søn', '2026-10-11', 'José Álvarez', 'Harbour History', 'Which year did the harbour open?', '1887', '1887', 'Yes', 'Yes', 1, '2026-10-11 13:45:00']);
    // First and final answer, and the two verdicts, for a wrong first try that was put right.
    assert.deepEqual(rows[2].slice(2), ['José Álvarez', 'Harbour History', 'Who designed the lighthouse?', 'Søren Holm', 'Ada Łęcka', 'Yes', 'No', 2, '2026-10-11 13:45:40']);
    // A poll has no right answer; a list is joined; a ranking is numbered.
    assert.deepEqual(rows[3].slice(5, 10), ['Speed', 'Speed', '', '', 1]);
    assert.deepEqual(rows[4].slice(5, 7), ['Phone; App', 'Phone; App']);
    assert.deepEqual(rows[6].slice(5, 7), ['1. Quality  2. Cost  3. Speed', '1. Quality  2. Cost  3. Speed']);
    // Someone who answered nothing is nine rows with no answer and 0 attempts.
    const again = rows.filter((row) => row[2] === 'José Álvarez (2)');
    assert.equal(again.length, 9);
    assert.ok(again.every((row) => row.slice(5).join('|') === '||||0|'));
    assert.deepEqual(rows.slice(-3).map((row) => [row[2], row[3], row[4], row[5]]), [
      ['José Álvarez', `(${STRAY_TITLE})`, 'Which colour is the old pier?', 'Blue'],
      ['Zoë Brontë', `(${STRAY_TITLE})`, 'Deleted question 1 (its wording is no longer stored)', 'An answer that can no longer be read (its question was deleted)'],
      ['Unnamed participant 2', `(${STRAY_TITLE})`, 'Deleted question 1 (its wording is no longer stored)', 'It was fine'],
    ]);
  });

  it('keeps accents, and quotes a comma, a quote and a line break inside an answer', () => {
    const text = csv();
    for (const name of ['José Álvarez', 'Zoë Brontë', 'Søren Kjær', 'Łukasz Żółć', 'Ada Łęcka']) assert.ok(text.includes(name), name);
    assert.ok(text.includes('"Søren says: more time for questions, please.\nAnd coffee."'), 'a line break stays inside its quoted cell');
    // The file still parses back to the same cells.
    const parsed = parseCsv(text.slice(1));
    assert.equal(parsed.length, 1 + 7 * 9 + 3 + 1); // header, rows, and the empty piece after the last CRLF
    assert.equal(parsed[0].length, CSV_COLUMNS.length);
    const cell = parsed.find((row) => row[2] === 'Søren Kjær' && row[4].startsWith('Is there anything'))[5];
    assert.equal(cell, 'Søren says: more time for questions, please.\nAnd coffee.');
  });

  it('guards against a formula: a cell that starts with = + - or @ gets an apostrophe', () => {
    assert.equal(csvCell('=SUM(A1:A9)'), "'=SUM(A1:A9)");
    assert.equal(csvCell('+44 20 7946 0000'), "'+44 20 7946 0000");
    assert.equal(csvCell('-2 for the coffee'), "'-2 for the coffee");
    assert.equal(csvCell('@everyone'), "'@everyone");
    assert.equal(csvCell('\tcmd'), "'\tcmd");
    assert.equal(csvCell('a = b'), 'a = b');           // only at the start
    assert.equal(csvCell(-2), '-2');                   // a number stays a number
    assert.equal(csvCell('say "hi", twice'), '"say ""hi"", twice"');
    assert.equal(csvCell(null), '');
    // Phase 9a: white space in front of the sign does not get it through, and neither does a semicolon or a tab inside the text
    // (a spreadsheet set to split on those begins a new cell there, whatever this file's commas and quotes say).
    assert.equal(csvCell(' =SUM(A1:A9)'), "' =SUM(A1:A9)");
    assert.equal(csvCell(`${String.fromCharCode(0x200B)}+1`), `'${String.fromCharCode(0x200B)}+1`);
    assert.equal(csvCell('fine;=SUM(A1:A9);also fine'), "fine;'=SUM(A1:A9);also fine");
    assert.equal(csvCell('one; two; three'), 'one; two; three');
    // Łukasz typed a formula with quotes and a comma: guarded, then quoted.
    assert.ok(csv().includes('"\'=SUM(A1:A9) ""quoted"", with a comma"'));
    // A participant named like a formula is guarded too.
    const records = harbourRecords();
    records.tracks[0].participantName = '=HYPERLINK("http://x","José")';
    assert.ok(participantAnswersCsv(buildLeaderReport(records, OPTIONS)).includes('"\'=HYPERLINK(""http://x"",""José"")"'));
  });

  it('names its files like the other exports', () => {
    assert.equal(reportFileName('leader-report', 'harbour-2026-10-11', 'pdf', '2026-10-12T09:30:00Z'), 'leader-report-harbour-2026-10-11-2026-10-12.pdf');
    assert.equal(reportFileName('participant-answers', 's kroger/kick off', 'csv', '2026-10-12T09:30:00Z'), 'participant-answers-s-kroger-kick-off-2026-10-12.csv');
  });
});

describe('the client’s colour as an accent on white', () => {
  const luminance = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((unit) => (unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4)).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

  it('keeps a colour that shows on white and darkens one that does not, to 3:1; the words on it have 4.5:1', () => {
    for (const colour of ['#045BCC', '#0B1F3A', '#FFD100', '#F5F5F5', '#FFFFFF', '#86BC25', '#E21737', '#7FD4FF', '#000000', '#FF8C00']) {
      const { accent, ink, adjusted } = printColours(colour);
      assert.ok(contrast(accent, '#FFFFFF') >= 3, `${colour} -> ${accent}: ${contrast(accent, '#FFFFFF').toFixed(2)} against white`);
      assert.ok(contrast(ink, accent) >= 4.5, `${colour} -> ${ink} on ${accent}: ${contrast(ink, accent).toFixed(2)}`);
      assert.equal(adjusted, contrast(colour, '#FFFFFF') < 3, `${colour} adjusted`);
      if (!adjusted) assert.equal(accent, colour);
    }
    assert.equal(printColours('#FFD100').ink, '#111111'); // a darkened yellow is still light: dark words on it
    assert.equal(printColours('#0B1F3A').ink, '#FFFFFF');
    assert.equal(printColours('not a colour').accent, '#0F172A');
    assert.equal(printColours(null).accent, '#0F172A');
  });

  it('takes the colour and the logo from the client’s saved theme', () => {
    const report = buildLeaderReport(harbourRecords({ primary: '#0B1F3A', plate: 'dark', logo: '/assets/images/clients/harbour-logo-abc.png' }), OPTIONS);
    assert.equal(report.brand.plate, 'dark');
    assert.equal(report.brand.logoUrl, '/assets/images/clients/harbour-logo-abc.png');
    assert.ok(contrast(report.brand.accent, '#FFFFFF') >= 3);
    assert.equal(harbour().brand.logoUrl, null);
  });
});

describe('sixty people, fifteen questions (counted again here, by the fixture’s rule)', () => {
  // The rule (leader-report-fixtures.js): person i's first pick for graded question j is right when (i + j) % 4 === 0; people 55 to 59
  // answer only the first activity (graded questions 0 to 4); everyone else answers all fifteen. A wrong first pick is followed by a
  // second pick, so every graded answer is final.
  const report = buildLeaderReport(bigRecords(), OPTIONS);
  const asked = (i) => (i >= 55 ? 5 : 10);
  const rightOf = (i) => { let right = 0; for (let j = 0; j < asked(i); j += 1) if ((i + j) % 4 === 0) right += 1; return right; };

  it('has everyone, by name', () => {
    assert.equal(report.summary.joined, BIG.people);
    assert.equal(report.participants.length, 60);
    assert.deepEqual(report.participants.map((entry) => entry.name), Array.from({ length: 60 }, (_unused, i) => bigName(i)));
    assert.equal(report.summary.questionCount, BIG.questions);
    assert.equal(report.summary.gradedCount, 10);
  });

  it('scores each person on their first tries', () => {
    for (let i = 0; i < 60; i += 1) {
      const entry = report.participants[i];
      assert.deepEqual([entry.gradedAnswered, entry.gradedRight, entry.answered], [asked(i), rightOf(i), i >= 55 ? 5 : 15], bigName(i));
      close(entry.scorePercent, (rightOf(i) / asked(i)) * 100, bigName(i));
    }
    let total = 0;
    for (let i = 0; i < 60; i += 1) total += (rightOf(i) / asked(i)) * 100;
    close(report.summary.averageScore, total / 60);
    assert.equal(report.summary.scored, 60);
  });

  it('counts each question', () => {
    const percents = [];
    for (let j = 0; j < 10; j += 1) {
      const people = j < 5 ? 60 : 55;
      let right = 0;
      const firsts = [0, 0, 0, 0];
      for (let i = 0; i < people; i += 1) { firsts[(i + j) % 4] += 1; if ((i + j) % 4 === 0) right += 1; }
      const entry = question(report, j + 1);
      assert.equal(entry.respondents, people);
      assert.deepEqual(entry.options.map((option) => option.count), firsts);
      assert.deepEqual([entry.firstTry.right, entry.firstTry.answered], [right, people]);
      percents.push((right / people) * 100);
      // Wrong first: an even person then picks the right one, an odd person the same wrong one again.
      let later = 0;
      let shown = 0;
      for (let i = 0; i < people; i += 1) if ((i + j) % 4 !== 0) { if (i % 2 === 0) later += 1; else shown += 1; }
      assert.deepEqual(entry.retries, { later, shown, open: 0 });
    }
    // The hardest and the easiest, found here by looking (ties: more answers, then the earlier question).
    const order = percents.map((percent, j) => ({ percent, answered: j < 5 ? 60 : 55, number: j + 1 }));
    const hardest = [...order].sort((a, b) => a.percent - b.percent || b.answered - a.answered || a.number - b.number)[0];
    const easiest = [...order].sort((a, b) => b.percent - a.percent || b.answered - a.answered || a.number - b.number)[0];
    assert.equal(report.summary.hardest.number, hardest.number);
    assert.equal(report.summary.easiest.number, easiest.number);
  });

  it('counts completion, the other kinds and every comment', () => {
    assert.equal(report.summary.finishedAll, 55);
    assert.deepEqual(report.summary.activities.map((activity) => [activity.finished, activity.started, activity.notStarted]), [[60, 0, 0], [55, 0, 5], [55, 0, 5]]);
    // The poll and the confidence scale: person i picks option i % 3, for i below 55: 19, 18, 18.
    assert.deepEqual(question(report, 11).options.map((option) => option.count), [19, 18, 18]);
    close(question(report, 12).average.value, (19 * 1 + 18 * 2 + 18 * 3) / 55);
    // The ranking: person i puts option (i + place) % 3 in each place. Points for option k: 3 where i % 3 === k, 2 where (i + 1) % 3 === k, 1 where (i + 2) % 3 === k.
    const points = [0, 1, 2].map((k) => { let score = 0; for (let i = 0; i < 55; i += 1) for (let place = 0; place < 3; place += 1) if ((i + place) % 3 === k) score += 3 - place; return score; });
    assert.deepEqual(Object.fromEntries(question(report, 13).ranking.map((option) => [option.label, option.score])), { Cost: points[0], Quality: points[1], Speed: points[2] });
    assert.equal(points.reduce((sum, value) => sum + value, 0), 55 * 6);
    // Choose-any: an even person picks Phone and App, an odd one Email. 28 even and 27 odd below 55.
    assert.deepEqual(question(report, 14).options.map((option) => option.count), [28, 27, 28]);
    assert.equal(report.summary.commentCount, 55);
    assert.deepEqual(report.comments[0].entries.map((entry) => entry.text), Array.from({ length: 55 }, (_unused, i) => bigComment(i)));
    assert.equal(participantAnswersRows(report).length, 60 * 15);
  });
});

// ---- Phase 9b: answer items that could not be read, and sample content (held by two mutations each, scripts/mutate-leader-report.js) ----

describe('Phase 9b: what the report says about answers it could not read, and about sample content', () => {
  const at = { generatedAt: '2026-10-12T09:30:00.000Z', timeZone: 'UTC' };
  /** Harbour with Søren's saved answers unreadable: they are not in what was read, and his item is named. */
  const damaged = () => {
    const records = harbourRecords();
    records.answers = records.answers.filter((answer) => answer.clientTrackId !== 't-soren');
    records.unreadable = [{ id: 't-soren', reason: 'its saved answers are not valid JSON' }];
    return records;
  };

  it('names the people whose answers could not be read, in the cover notice and the notes, and marks them', () => {
    const report = lib.buildLeaderReport(damaged(), at);
    assert.equal(report.meta.unreadableNotice, `1 participant's answers could not be read and are not counted: Søren Kjær. Correct or delete the damaged item in the ${TITLE.responses} list, then reload.`);
    assert.deepEqual(report.participants.filter((person) => person.unreadable).map((person) => person.name), ['Søren Kjær']);
    assert.ok(report.notes.includes(report.meta.unreadableNotice));
    assert.equal(lib.buildLeaderReport(harbourRecords(), at).meta.unreadableNotice, '');
  });

  it('does not say somebody "answered nothing" when their answers could not be read', () => {
    const clean = lib.buildLeaderReport(harbourRecords(), at);
    const report = lib.buildLeaderReport(damaged(), at);
    // Søren answered in the clean report; with his item unreadable he has no answers, and the cover must not call that "answered nothing".
    assert.equal(report.summary.answeredNothing, clean.summary.answeredNothing, 'only people who really recorded nothing are "answered nothing"');
    assert.equal(report.participants.find((person) => person.name === 'Søren Kjær').answered, 0);
  });

  it('a sample client\'s cover carries the line until it is confirmed, and no other client\'s does', () => {
    const base = harbourRecords();
    const sample = { ...base, client: { ...base.client, id: 'c-kroger', createdAt: '2026-09-18T00:00:00.000Z', theme: { ...base.client.theme, sample: { source: 'Seed sample clients' } } } };
    assert.equal(lib.buildLeaderReport(sample, at).meta.sampleNotice, 'Sample content, not yet confirmed with the client.');
    assert.equal(lib.buildLeaderReport(base, at).meta.sampleNotice, '');
    const confirmed = { ...sample, client: { ...sample.client, theme: { ...sample.client.theme, sample: { source: 'Seed sample clients', confirmedBy: 'Casey', confirmedAt: '2026-10-13T09:30:00.000Z' } } } };
    assert.equal(lib.buildLeaderReport(confirmed, at).meta.sampleNotice, '');
  });
});

/** A small CSV reader (RFC 4180), for checking that what was written reads back. */
function parseCsv(text) {
  const rows = [[]];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; } else if (char === '"') quoted = false; else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { rows.at(-1).push(cell); cell = ''; } else if (char === '\r' && text[index + 1] === '\n') { rows.at(-1).push(cell); cell = ''; rows.push([]); index += 1; } else cell += char;
  }
  rows.at(-1).push(cell);
  return rows;
}
