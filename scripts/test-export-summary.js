// Phase 13, item B: the summary every export opens with (lib/export-summary.js), and the "only N answers" line of the chart model.
// Run: node --test scripts/test-export-summary.js (also part of npm test and npm run test:report)
//
// Every sentence below is worked out BY HAND from the fixtures' answers, in the comments beside it; nothing is compared with itself. The
// takeaway of an activity is chosen by a rule and made of the chart model's own words and numbers, so each test also checks that the numbers in
// the sentence are the numbers of the question it came from.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLeaderReport } from '../migration/src/lib/leader-report.js';
import { chartOf, fewAnswersLine, numberWords } from '../migration/src/lib/results-chart-model.js';
import * as summary from '../migration/src/lib/export-summary.js';
import { liveSections } from '../public/js/resultsExport.js';
import { harbourRecords } from './leader-report-fixtures.js';
import { krogerResults, vineResults } from './results-export-fixtures.js';

/** The live activities of a results tree, as the Live display's files hand them to the summary: each with its charts, nobody named. */
const liveActivities = (results) => liveSections(results).map((section) => ({ id: section.id, title: section.title, charts: section.questions.map((question) => chartOf(question, { names: null })) }));
/** The leader report's activities, its charts over its own counts. */
const reportActivities = (report) => report.activities.map((activity) => ({ id: activity.id, title: activity.title, off: activity.off, charts: activity.questions.map((question) => question.chart) }));

describe('the chart model says when a figure rests on few answers', () => {
  it('numbers one to nine in words, 10 and more as figures (language guide p. 40)', () => {
    assert.deepEqual([1, 2, 9, 10, 1240].map(numberWords), ['one', 'two', 'nine', '10', '1,240']);
  });

  it('"Only N answers." under five answers, nothing at five or more, nothing when nobody answered (NO_ANSWERS says that)', () => {
    assert.equal(fewAnswersLine(1), 'Only one answer.');
    assert.equal(fewAnswersLine(4), 'Only four answers.');
    assert.equal(fewAnswersLine(5), '');
    assert.equal(fewAnswersLine(0), '');
  });
});

describe('an activity\'s takeaway (lib/export-summary.js)', () => {
  it('Vine, graded: the average share right first time over its graded questions, and the one most missed', () => {
    // v1: first picks Vine, Vine, 5th Street, Main Street: 2 of 4 right (50%). v3: True, True, False, True: 3 of 4 (75%).
    // The average of 50% and 75% is 62.5%, shown as 63%. The most missed is v1. Four people answered it: "Only four answers."
    const [activity] = summary.summarizeSession(liveActivities(vineResults())).activities;
    assert.equal(activity.takeaway, 'Across two graded questions, an average of 63% of first answers were right; the most missed was “Where is the head office?” (2 of 4 right first time). Only four answers.');
    assert.equal(activity.source, 'v1');
    assert.deepEqual(activity.scoreboard, { questions: 2, averagePercent: 63, mostMissed: { id: 'v1', prompt: 'Where is the head office?', right: 2, answered: 4, percent: 50 }, line: 'Average right first time: 63% over two graded questions. Most often missed: “Where is the head office?” (2 of 4).' });
    // Six questions; answers 4 + 4 + 4 + 2 + 4 + 4 = 22 (v4, the scale, has two).
    assert.equal(activity.questions, 6);
    assert.equal(activity.answers, 22);
  });

  it('Harbour History (the leader report\'s own counts): three graded questions, the lighthouse most missed', () => {
    // Q1: 3 of 6 right (50%), Q2: 3 of 4 (75%), Q3: 1 of 4 (25%), worked out in scripts/test-leader-report.js. The average is 50%.
    const report = buildLeaderReport(harbourRecords());
    const [history, views] = summary.summarizeSession(reportActivities(report)).activities;
    assert.equal(history.takeaway, 'Across three graded questions, an average of 50% of first answers were right; the most missed was “Who designed the lighthouse?” (1 of 4 right first time). Only four answers.');
    assert.equal(history.source, 'q3');
    // Your Views has no graded question. Its single-leader questions: q4 (Care 2 of 4, 50%: Speed and Price have 1 each). q5 (a three-way tie at 2 of 3)
    // and q6 (a tie at 2 of 4) have no single leader, and the ranking q7 and the comments q8 come after the questions with shares.
    assert.equal(views.takeaway, '“Which service matters most to you?” The top choice (50%) was Care. Only four answers.');
    assert.equal(views.source, 'q4');
    assert.equal(views.scoreboard, null);
  });

  it('Kroger: every question 100% Yes; the earliest of those with the most answers is taken', () => {
    // kq1 to kq8 have four answers (k1, k2, k4, k5), kq9 two (k1, k5). Every answer is Yes.
    const [activity] = summary.summarizeSession(liveActivities(krogerResults())).activities;
    assert.equal(activity.takeaway, '“Question 1”: Most people (100%) chose Yes. Only four answers.');
    assert.equal(activity.source, 'kq1');
  });

  it('polls: the clearest single leader wins, not the first question; a tie for the top only when nothing has one leader', () => {
    const poll = (id, prompt, answered, percents) => ({
      id, kind: 'choice', graded: false, answered, prompt, headline: `Headline of ${id}.`,
      options: percents.map((percent, index) => ({ id: `${id}${index}`, percent, count: percent, isTop: percent === Math.max(...percents) })),
    });
    // p1: 60 / 40 (one leader at 60%). p2: 90 / 10 (one leader at 90%). p3: a tie at 50 / 50. p2 is the clearest, though p1 comes first.
    const clearest = summary.summarizeActivity({ id: 'a', title: 'A', charts: [poll('p1', 'First?', 10, [60, 40]), poll('p2', 'Second?', 10, [90, 10]), poll('p3', 'Third?', 10, [50, 50])] });
    assert.equal(clearest.source, 'p2');
    assert.equal(clearest.takeaway, '“Second?” Headline of p2.');
    // Two with the same top share: the one more people answered (p5, 12), then the earlier.
    const tied = summary.summarizeActivity({ id: 'a', title: 'A', charts: [poll('p4', 'Four?', 8, [75, 25]), poll('p5', 'Five?', 12, [75, 25])] });
    assert.equal(tied.source, 'p5');
    // Only ties for the top: the highest of those.
    const ties = summary.summarizeActivity({ id: 'a', title: 'A', charts: [poll('p6', 'Six?', 10, [50, 50]), poll('p7', 'Seven?', 10, [40, 40, 20])] });
    assert.equal(ties.source, 'p6');
  });

  it('one graded question; every graded question right; written answers only; nothing answered', () => {
    const graded = (id, right, answered, prompt = 'Q?') => ({ id, kind: 'choice', graded: true, right, answered, prompt, headline: 'x', options: [] });
    const one = summary.summarizeActivity({ id: 'a', title: 'A', charts: [graded('g', 7, 9, 'Which year?')] });
    // 7 of 9 is 77.8%, shown as 78%.
    assert.equal(one.takeaway, 'On “Which year?”, 7 of 9 (78%) got it right first time.');
    const all = summary.summarizeActivity({ id: 'a', title: 'A', charts: [graded('g1', 6, 6), graded('g2', 12, 12)] });
    assert.equal(all.takeaway, 'Everyone who answered got both graded questions right first time.');
    const words = summary.summarizeActivity({ id: 'a', title: 'A', charts: [{ id: 't', kind: 'text', graded: false, answered: 6, prompt: 'Anything else?', headline: '6 comments. The word that came up most is “price”, in 3 of them.', comments: [], words: [], options: [] }] });
    assert.equal(words.takeaway, '“Anything else?” 6 comments. The word that came up most is “price”, in 3 of them.');
    const none = summary.summarizeActivity({ id: 'a', title: 'A', charts: [{ ...graded('g', 0, 0), headline: 'No answers yet.' }] });
    assert.equal(none.takeaway, 'No answers yet.');
    assert.equal(none.source, null);
  });

  it('every number in a takeaway is a number of the question it names', () => {
    for (const activities of [liveActivities(vineResults()), liveActivities(krogerResults()), reportActivities(buildLeaderReport(harbourRecords()))]) {
      for (const activity of summary.summarizeSession(activities).activities) {
        const chart = activities.flatMap((each) => each.charts).find((each) => each.id === activity.source);
        assert.ok(chart, `${activity.title}: its takeaway names a question of the session`);
        assert.ok(activity.takeaway.includes(`“${chart.prompt}”`), `${activity.title}: the takeaway quotes ${chart.prompt}`);
        const own = new Set([chart.answered, chart.right, ...(chart.options ?? []).flatMap((option) => [option.count, option.percent, option.score]), activity.scoreboard?.averagePercent, activity.scoreboard?.questions].filter((value) => value !== undefined).map(String));
        for (const figure of activity.takeaway.replace(/“[^”]*”/g, '').match(/\d+/g) ?? []) assert.ok(own.has(figure), `${activity.title}: ${figure} in "${activity.takeaway}" is not a number of ${chart.id}`);
      }
    }
  });
});

describe('the session as a whole', () => {
  it('counts the answers and the questions, and keeps the activities in the screen\'s order', () => {
    const session = summary.summarizeSession(liveActivities(krogerResults()));
    // 4 x 8 + 2 = 34 answers over nine questions.
    assert.equal(session.answers, 34);
    assert.equal(session.questions, 9);
    assert.deepEqual(session.activities.map((activity) => activity.title), ['Kroger']);
  });
});
