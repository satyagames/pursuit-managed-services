// Phase 11a: one chart model for Results. Run: node --test scripts/test-results-chart-model.js (also part of npm test)
//
// migration/src/lib/results-chart-model.js turns a question's tally and its answers into what a chart shows: shares, a headline, who picked
// what, a scale's average and bands, a ranking's support scores and the words that came up most in written answers. Every expected number
// here is worked out BY HAND in the comments beside it, from the figures of VJR's run on the PCOE site (15 Oct 2026: four people), never by
// calling the code under test. The tally objects are written out as lib/results-tally.js hands them on ({ respondents, responses, options:
// [{ count, score? }] }); one test builds them with buildResults to show the two agree.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MULTI_CAPTION, NO_ANSWERS, RANKING_CAPTION, STOP_WORDS, TOP_WORDS, answerCounts, answersFrom, answersOf, bandOf, chartKind, chartOf, chartsOf, foldPlural,
  namesFor, people, removedLine, segmentsOf, supportScore, topWords, wholePercents, wordsIn,
} from '../migration/src/lib/results-chart-model.js';
import { resultRows } from '../migration/src/lib/admin-results.js';
import { buildResults } from '../migration/src/lib/results-tally.js';

const OPEN = String.fromCharCode(0x201C);
const CLOSE = String.fromCharCode(0x201D);
const CURLY = String.fromCharCode(0x2019);

// The four people of the run. Mike A joined by a guest's QR code (his name is on the visit); the others are made to test the names:
// accents, a name that starts with "=", and a staff visit with no name recorded anywhere.
const TRACKS = [
  { id: 't1', participantName: 'Mike A', createdAt: '2026-10-15T10:00:00.000Z' },
  { id: 't2', participantName: 'José Álvarez', createdAt: '2026-10-15T10:01:00.000Z' },
  { id: 't3', participantName: '=SUM(A1)', createdAt: '2026-10-15T10:02:00.000Z' },
  { id: 't4', sharePointUserId: 7, createdAt: '2026-10-15T10:03:00.000Z' },
];
const at = (minute) => `2026-10-15T10:${String(minute).padStart(2, '0')}:00.000Z`;
const answer = (track, questionId, value, minute) => ({ questionId, clientTrackId: track, answer: value, timestamp: at(minute) });

// Single choice: 4 answers split 1, 2, 1, 0.
const VINE = '1014 Vine Street, Cincinnati';
function addressQuestion({ graded = false } = {}) {
  return {
    id: 'q-address', type: 'single-select', prompt: 'Where is the head office?', respondents: 4,
    options: [
      { id: 'o1', label: '5th Street, Cincinnati', count: 1, correct: graded ? false : null },
      { id: 'o2', label: VINE, count: 2, correct: graded ? true : null },
      { id: 'o3', label: 'Main Street, Dayton', count: 1, correct: graded ? false : null },
      { id: 'o4', label: 'Elm Street, Columbus', count: 0, correct: graded ? false : null },
    ],
    responses: [answer('t1', 'q-address', 'o2', 10), answer('t2', 'q-address', 'o2', 12), answer('t3', 'q-address', 'o1', 11), answer('t4', 'q-address', 'o3', 13)],
  };
}

// Ranking: four voters, five options. The orders are A B C D E twice, B A C D E, and E C D B A. With five options a first place is 5 points
// and a last place 1, so:
//   A = 5 + 5 + 4 + 1 = 15     B = 4 + 4 + 5 + 2 = 15     C = 3 + 3 + 3 + 4 = 13     D = 2 + 2 + 2 + 3 = 9     E = 1 + 1 + 1 + 5 = 8
// (60 points in all = 4 voters x 15). First places: A 2, B 1, E 1.
// Support score = (points - voters) / (voters x (options - 1)) x 100, with 4 voters and 5 options the divisor is 4 x 4 = 16:
//   A (15 - 4) / 16 = 0.6875 -> 69     B 69     C (13 - 4) / 16 = 0.5625 -> 56     D (9 - 4) / 16 = 0.3125 -> 31     E (8 - 4) / 16 = 0.25 -> 25
// A and B share first place ("1="), then C 3, D 4, E 5.
const RANK = { A: 'Faster checkout', B: 'Better pay', C: 'More training', D: 'New uniforms', E: 'Longer breaks' };
function rankingQuestion() {
  return {
    id: 'q-rank', type: 'ranked-voting', prompt: 'Rank what matters most', respondents: 4,
    options: [{ id: 'A', label: RANK.A, count: 4, score: 15 }, { id: 'B', label: RANK.B, count: 4, score: 15 }, { id: 'C', label: RANK.C, count: 4, score: 13 }, { id: 'D', label: RANK.D, count: 4, score: 9 }, { id: 'E', label: RANK.E, count: 4, score: 8 }],
    responses: [answer('t1', 'q-rank', ['A', 'B', 'C', 'D', 'E'], 20), answer('t2', 'q-rank', ['A', 'B', 'C', 'D', 'E'], 21), answer('t3', 'q-rank', ['B', 'A', 'C', 'D', 'E'], 22), answer('t4', 'q-rank', ['E', 'C', 'D', 'B', 'A'], 23)],
  };
}

// Confidence on three steps (values 1, 2, 3): two people answered, both "Moderately confident". Average (2 x 2) / 2 = 2.0, of 3.
function confidenceQuestion() {
  return {
    id: 'q-conf', type: 'confidence-continuum', prompt: 'How confident are you?', respondents: 2,
    options: [{ id: 'c1', label: 'Not confident', value: 1, count: 0 }, { id: 'c2', label: 'Moderately confident', value: 2, count: 2 }, { id: 'c3', label: 'Very confident', value: 3, count: 0 }],
    responses: [answer('t1', 'q-conf', 'c2', 30), answer('t2', 'q-conf', 'c2', 31)],
  };
}

const names = namesFor({ tracks: TRACKS, answers: [] });

describe('shares', () => {
  it('rounds single-choice shares by the largest remainder, so they add up to exactly 100', () => {
    // 1, 2, 1, 0 of 4 are exactly 25, 50, 25, 0.
    assert.deepEqual(wholePercents([1, 2, 1, 0], 4), [25, 50, 25, 0]);
    // 1, 1, 1 of 3 are 33.33 each: 33 + 33 + 33 = 99, and the one point left goes to the first of the equal remainders.
    assert.deepEqual(wholePercents([1, 1, 1], 3), [34, 33, 33]);
    // 2, 2, 3 of 7: 28.57, 28.57, 42.86 -> floors 28, 28, 42 = 98; the two points go to the largest remainders (.86 then .57, the first of the two).
    assert.deepEqual(wholePercents([2, 2, 3], 7), [29, 28, 43]);
    assert.deepEqual(wholePercents([0, 0], 0), [0, 0]);
  });

  it('single choice: 4 answers split 1, 2, 1, 0 are 25, 50, 25 and 0 percent, highest first, with a headline', () => {
    const chart = chartOf(addressQuestion(), { names });
    assert.equal(chart.kind, 'choice');
    assert.equal(chart.answered, 4);
    // Sorted by count, highest first; the two 1s keep the question's order (5th Street before Main Street).
    assert.deepEqual(chart.options.map((option) => [option.label, option.count, option.percent]), [[VINE, 2, 50], ['5th Street, Cincinnati', 1, 25], ['Main Street, Dayton', 1, 25], ['Elm Street, Columbus', 0, 0]]);
    assert.equal(chart.options.reduce((sum, option) => sum + option.percent, 0), 100);
    assert.deepEqual(chart.options.map((option) => option.isTop), [true, false, false, false]);
    assert.equal(chart.options[0].share, 0.5);
    // 2 of 4 is half, and half is not most (Phase 11a-2: the real site said "Most people (50%) chose ...").
    assert.equal(chart.headline, `The top choice (50%) was ${VINE}.`);
    assert.equal(chart.graded, false);
    assert.equal(chart.gradedLine, '');
  });

  it('a quiz question marks the correct answer and says how many got it right first time', () => {
    // Vine Street is correct; Mike A and José picked it first: 2 of 4.
    const chart = chartOf(addressQuestion({ graded: true }), { names });
    assert.equal(chart.graded, true);
    assert.deepEqual(chart.options.filter((option) => option.isCorrect).map((option) => option.label), [VINE]);
    assert.equal(chart.gradedLine, '2 of 4 got it right first time.');
    // Three of four right: the brief's own sentence.
    const three = { id: 'q3', type: 'single-select', prompt: 'p', respondents: 4, options: [{ id: 'r', label: 'Right', count: 3, correct: true }, { id: 'w', label: 'Wrong', count: 1, correct: false }], responses: [answer('t1', 'q3', 'r', 1), answer('t2', 'q3', 'r', 2), answer('t3', 'q3', 'r', 3), answer('t4', 'q3', 'w', 4)] };
    assert.equal(chartOf(three).gradedLine, '3 of 4 got it right first time.');
  });

  it('multiple choice: shares of people, not forced to 100, with the caption', () => {
    // Picks: Mike A and José a+b and a+c, the third person a alone, the fourth b+c. a 3 of 4 = 75%, b 2 = 50%, c 2 = 50%, d 0. 175 in all.
    const question = {
      id: 'q-multi', type: 'multi-select', prompt: 'Which do you use?', respondents: 4,
      options: [{ id: 'a', label: 'Email', count: 3 }, { id: 'b', label: 'Chat', count: 2 }, { id: 'c', label: 'Phone', count: 2 }, { id: 'd', label: 'Fax', count: 0 }],
      responses: [answer('t1', 'q-multi', ['a', 'b'], 1), answer('t2', 'q-multi', ['a', 'c'], 2), answer('t3', 'q-multi', ['a'], 3), answer('t4', 'q-multi', ['b', 'c'], 4)],
    };
    const chart = chartOf(question, { names });
    assert.deepEqual(chart.options.map((option) => [option.label, option.percent]), [['Email', 75], ['Chat', 50], ['Phone', 50], ['Fax', 0]]);
    assert.equal(chart.options.reduce((sum, option) => sum + option.percent, 0), 175);
    assert.equal(chart.caption, MULTI_CAPTION);
    assert.equal(chart.caption, 'People could pick several answers, so the bars add up to more than 100%.');
    // 3 of 4 people picked Email: more than half (Phase 11a-2: the same sentence as single choice, from the share of people).
    assert.equal(chart.headline, 'Most people (75%) chose Email.');
    assert.deepEqual(chart.options[1].who.map((who) => who.name), ['Mike A', 'Unnamed participant 1']);
  });

  it('true or false: True on the left whatever the order, the headline, the correct side marked', () => {
    // Stored False first on purpose. True 3 of 4 = 75%, False 25%; True is correct and the three who picked it were right first time.
    const question = {
      id: 'q-tf', type: 'true-false', prompt: 'The store opens at 8.', respondents: 4,
      options: [{ id: 'f', label: 'False', value: false, count: 1, correct: false }, { id: 't', label: 'True', value: true, count: 3, correct: true }],
      responses: [answer('t1', 'q-tf', 't', 1), answer('t2', 'q-tf', 't', 2), answer('t3', 'q-tf', 'f', 3), answer('t4', 'q-tf', 't', 4)],
    };
    const chart = chartOf(question, { names });
    assert.equal(chart.kind, 'truefalse');
    assert.deepEqual(chart.sides.map((side) => [side.label, side.percent, side.isCorrect]), [['True', 75, true], ['False', 25, false]]);
    assert.equal(chart.headline, 'Most people (75%) said True.');
    assert.equal(chart.gradedLine, '3 of 4 got it right first time.');
  });
});

describe('headlines', () => {
  it('a tie names every leader, and no answers says so', () => {
    const tie = { id: 'q', type: 'single-select', prompt: 'p', respondents: 4, options: [{ id: 'x', label: 'Pizza', count: 2 }, { id: 'y', label: 'Pasta', count: 2 }, { id: 'z', label: 'Salad', count: 0 }], responses: [] };
    assert.equal(chartOf(tie).headline, 'A tie between Pizza and Pasta (2 each).');
    const three = { ...tie, respondents: 3, options: [{ id: 'x', label: 'Pizza', count: 1 }, { id: 'y', label: 'Pasta', count: 1 }, { id: 'z', label: 'Salad', count: 1 }] };
    assert.equal(chartOf(three).headline, 'A tie between Pizza, Pasta and Salad (1 each).');
    assert.deepEqual(chartOf(three).options.map((option) => option.isTop), [true, true, true]);
    const none = { ...tie, respondents: 0, options: tie.options.map((option) => ({ ...option, count: 0 })) };
    const empty = chartOf(none);
    assert.equal(empty.headline, NO_ANSWERS);
    assert.equal(empty.headline, 'No answers yet.');
    assert.deepEqual(empty.options.map((option) => [option.percent, option.isTop]), [[0, false], [0, false], [0, false]]);
    for (const type of ['multi-select', 'true-false', 'confidence-continuum', 'ranked-voting', 'open-text-feedback']) {
      assert.equal(chartOf({ ...none, type, options: type === 'true-false' ? none.options.slice(0, 2) : type === 'open-text-feedback' ? [] : none.options }).headline, 'No answers yet.', type);
    }
  });
});

describe('headlines: "most" only above half, and one full stop (Phase 11a-2)', () => {
  // On the real site (16 Oct 2026) a single choice split 1, 2, 1, 0 read "Most people (50%) chose 1014 Vine Street, Cincinnati." (half is not most),
  // and an answer whose own words end with a full stop read "...chose Kroger grocery and Baking co.." (two full stops). Every sentence below is
  // written out by hand.
  const single = (counts, labels, respondents = counts.reduce((sum, count) => sum + count, 0)) => ({
    id: 'q', type: 'single-select', prompt: 'p', respondents, options: counts.map((count, index) => ({ id: `o${index}`, label: labels[index], count })), responses: [],
  });

  it('4 answers split 1, 2, 1, 0: half is the top choice, not most', () => {
    assert.equal(chartOf(addressQuestion(), { names }).headline, 'The top choice (50%) was 1014 Vine Street, Cincinnati.');
  });

  it('3 of 5 is most', () => {
    // 3 of 5 = 60%, 1 of 5 = 20% twice: 60 + 20 + 20 = 100.
    assert.equal(chartOf(single([3, 1, 1], ['1014 Vine Street, Cincinnati', 'Main Street, Dayton', 'Elm Street, Columbus'])).headline, 'Most people (60%) chose 1014 Vine Street, Cincinnati.');
  });

  it('a top share of 25% is the top choice', () => {
    // 8 answers over 7 answers: 2 of 8 = 25%, and 1 of 8 = 12.5% six times (floors 12, the three points left go to the first three of the
    // equal remainders: 13, 13, 13, 12, 12, 12). 25 + 39 + 36 = 100.
    const chart = chartOf(single([2, 1, 1, 1, 1, 1, 1], ['Kroger', 'Ralphs', 'Fred Meyer', 'King Soopers', 'Smith\'s', 'Fry\'s', 'QFC']));
    assert.deepEqual(chart.options.map((option) => option.percent), [25, 13, 13, 13, 12, 12, 12]);
    assert.equal(chart.headline, 'The top choice (25%) was Kroger.');
  });

  it('just over half, shown as 50%, is not called most: the sentence never says "Most people (50%)"', () => {
    // 51 of 101 = 50.495%, 50 of 101 = 49.505%: floors 50 and 49, and the one point left goes to the larger remainder (.505): 50 and 50.
    const chart = chartOf(single([51, 50], ['Yes, every week', 'No']));
    assert.deepEqual(chart.options.map((option) => option.percent), [50, 50]);
    assert.equal(chart.headline, 'The top choice (50%) was Yes, every week.');
  });

  it('an answer that ends with a full stop gets no second one', () => {
    // 3 of 4 = 75%; 2 of 4 = 50%.
    assert.equal(chartOf(single([3, 1], ['Kroger grocery and Baking co.', 'Ralphs'])).headline, 'Most people (75%) chose Kroger grocery and Baking co.');
    assert.equal(chartOf(single([2, 1, 1], ['Kroger grocery and Baking co.', 'Ralphs', 'QFC'])).headline, 'The top choice (50%) was Kroger grocery and Baking co.');
  });

  it('an answer that ends with ?, ! or an ellipsis gets no full stop either, and no sentence ever has two in a row', () => {
    // 2 of 3 = 66.67% -> 67 (1 of 3 = 33.33 -> 33).
    assert.equal(chartOf(single([2, 1], ['Why not both?', 'Neither'])).headline, 'Most people (67%) chose Why not both?');
    assert.equal(chartOf(single([2, 1], ['Absolutely!', 'Not really'])).headline, 'Most people (67%) chose Absolutely!');
    assert.equal(chartOf(single([2, 1], [`It depends${String.fromCharCode(0x2026)}`, 'No'])).headline, `Most people (67%) chose It depends${String.fromCharCode(0x2026)}`);
    assert.equal(chartOf(single([2, 1], ['Wait...', 'No'])).headline, 'Most people (67%) chose Wait...');
    // A closing quotation mark or bracket after the stop: the stop is already there.
    assert.equal(chartOf(single([2, 1], [`The one that says ${OPEN}Go.${CLOSE}`, 'No'])).headline, `Most people (67%) chose The one that says ${OPEN}Go.${CLOSE}`);
    assert.equal(chartOf(single([2, 1], ['Kroger (Inc.)', 'No'])).headline, 'Most people (67%) chose Kroger (Inc.)');
    // Words that merely contain a stop still get one at the end.
    assert.equal(chartOf(single([2, 1], ['St. Louis, Mo', 'No'])).headline, 'Most people (67%) chose St. Louis, Mo.');
    for (const kind of [['Co.', 'x'], ['Co.', 'Inc.']]) {
      for (const counts of [[2, 1], [1, 1], [3, 1], [1, 2]]) assert.ok(!chartOf(single(counts, kind)).headline.includes('..'), `${counts} ${kind}`);
    }
  });

  it('multiple choice follows the same rule, from the share of people', () => {
    // Four people: Email picked by 3 (75%), Chat by 2 (50%), Phone by 2 (50%). Then two people: Chat by 1 of 2 (50%), the rest by none.
    const base = { id: 'q', type: 'multi-select', prompt: 'p', responses: [] };
    assert.equal(chartOf({ ...base, respondents: 4, options: [{ id: 'a', label: 'Email', count: 3 }, { id: 'b', label: 'Chat', count: 2 }, { id: 'c', label: 'Phone', count: 2 }] }).headline, 'Most people (75%) chose Email.');
    assert.equal(chartOf({ ...base, respondents: 2, options: [{ id: 'a', label: 'Email', count: 0 }, { id: 'b', label: 'Chat', count: 1 }, { id: 'c', label: 'Phone', count: 0 }] }).headline, 'The top choice (50%) was Chat.');
    assert.equal(chartOf({ ...base, respondents: 4, options: [{ id: 'a', label: 'Email', count: 2 }, { id: 'b', label: 'Chat', count: 2 }] }).headline, 'A tie between Email and Chat (2 each).');
  });

  it('true or false: "Most people (72%) said True." or "The top answer (50%) was True."', () => {
    // 18 of 25 = 72%, 7 of 25 = 28%.
    const tf = (trueCount, falseCount, respondents) => ({ id: 'q', type: 'true-false', prompt: 'p', respondents, responses: [], options: [{ id: 't', label: 'True', value: true, count: trueCount }, { id: 'f', label: 'False', value: false, count: falseCount }] });
    assert.equal(chartOf(tf(18, 7, 25)).headline, 'Most people (72%) said True.');
    assert.equal(chartOf(tf(1, 3, 4)).headline, 'Most people (75%) said False.');
    // Four answered: 2 True, 1 False, and 1 to an answer that has since gone (it takes its 25% of the 100): True is the top answer at 50%.
    assert.equal(chartOf(tf(2, 1, 4)).headline, 'The top answer (50%) was True.');
    assert.equal(chartOf(tf(2, 2, 4)).headline, 'A tie between True and False (2 each).');
  });

  it('a confidence scale: the average, then the same rule', () => {
    assert.equal(chartOf(confidenceQuestion(), { names }).headline, 'Average 2.0 of 3. Most people (100%) chose Moderately confident.');
    // Five people on five steps 1..5: one at 1, two at 2, one at 3, one at 5. Average (1 + 4 + 3 + 5) / 5 = 13 / 5 = 2.6; the top step, 2, has 2 of 5 = 40%.
    const steps = [1, 2, 3, 4, 5].map((value, index) => ({ id: `s${value}`, label: ['Not at all', 'A little', 'Somewhat', 'Mostly', 'Completely'][index], value, count: [1, 2, 1, 0, 1][index] }));
    assert.equal(chartOf({ id: 'q', type: 'confidence-continuum', prompt: 'p', respondents: 5, options: steps, responses: [] }).headline, 'Average 2.6 of 5. The top choice (40%) was A little.');
  });

  it('no answers, and a tie, are as they were', () => {
    assert.equal(chartOf(single([0, 0], ['A', 'B'], 0)).headline, 'No answers yet.');
    assert.equal(chartOf(single([2, 2, 0], ['Pizza', 'Pasta', 'Salad'])).headline, 'A tie between Pizza and Pasta (2 each).');
    // A ranking and written answers keep their own sentences.
    assert.equal(chartOf(rankingQuestion(), { names }).headline, `A tie between ${RANK.A} and ${RANK.B} (support score 69 each).`);
  });
});

describe('a confidence scale', () => {
  it('counts 0, 2, 0 give an average of 2.0 of 3, at the middle step, with three bands named from the question', () => {
    const chart = chartOf(confidenceQuestion(), { names });
    assert.equal(chart.kind, 'scale');
    assert.deepEqual(chart.options.map((step) => [step.count, step.percent]), [[0, 0], [2, 100], [0, 0]]);
    assert.equal(chart.scale.averageText, 'Average 2.0 of 3');
    assert.equal(chart.scale.average, 2);
    assert.equal(chart.scale.averageAt, 1);
    assert.deepEqual(chart.scale.bands.map((band) => [band.name, band.count]), [['Not confident', 0], ['Middle', 2], ['Very confident', 0]]);
    assert.equal(chart.headline, 'Average 2.0 of 3. Most people (100%) chose Moderately confident.');
  });

  it('puts each step in a third by its place, and an average between two steps between them', () => {
    // Places 0 .. n-1; the lowest third is a place under (n - 1) / 3, the top third one over 2 (n - 1) / 3.
    assert.deepEqual([0, 1, 2].map((index) => bandOf(index, 3)), [0, 1, 2]);
    assert.deepEqual([0, 1].map((index) => bandOf(index, 2)), [0, 2]);
    assert.deepEqual([0, 1, 2, 3].map((index) => bandOf(index, 4)), [0, 1, 1, 2]); // 0, 1/3, 2/3, 1
    assert.deepEqual([0, 1, 2, 3, 4].map((index) => bandOf(index, 5)), [0, 0, 1, 2, 2]); // 0, .25, .5, .75, 1
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((index) => bandOf(index, 7)), [0, 0, 1, 1, 1, 2, 2]);
    // Five steps 1..5: one person at 2 and one at 3 is an average of 2.5, half way between the second step (place 1) and the third (place 2).
    const five = { id: 'q5', type: 'confidence-continuum', prompt: 'p', respondents: 2, options: [1, 2, 3, 4, 5].map((value) => ({ id: `s${value}`, label: `Step ${value}`, value, count: value === 2 || value === 3 ? 1 : 0 })), responses: [] };
    const chart = chartOf(five);
    assert.equal(chart.scale.averageText, 'Average 2.5 of 5');
    assert.equal(chart.scale.averageAt, 1.5);
    assert.deepEqual(chart.scale.bands.map((band) => [band.name, band.from, band.to]), [['Step 1', 0, 1], ['Middle', 2, 2], ['Step 5', 3, 4]]);
    // Seven steps share the five colours in order: floor(place x 5 / 7) = 0, 0, 1, 2, 2, 3, 4.
    const seven = { ...five, options: [1, 2, 3, 4, 5, 6, 7].map((value) => ({ id: `s${value}`, label: `${value}`, value, count: 0 })) };
    assert.deepEqual(chartOf(seven).scale.steps.map((step) => step.tone), [0, 0, 1, 2, 2, 3, 4]);
    assert.equal(chartOf(seven).scale.tones, 5);
  });
});

describe('a ranking', () => {
  it('4 voters, 5 options, points 15, 15, 13, 9, 8: support scores 69, 69, 56, 31, 25 and places 1, 1, 3, 4, 5', () => {
    const chart = chartOf(rankingQuestion(), { names });
    assert.equal(chart.kind, 'ranking');
    assert.deepEqual(chart.options.map((item) => [item.label, item.points, item.score, item.rank, item.tied]), [
      [RANK.A, 15, 69, 1, true], [RANK.B, 15, 69, 1, true], [RANK.C, 13, 56, 3, false], [RANK.D, 9, 31, 4, false], [RANK.E, 8, 25, 5, false],
    ]);
    // A place is its number alone (Phase 11a-3: "1=" for a shared place read as a typo on the real site, beside "3."); two bars sharing a number, and the
    // headline, say it is a tie.
    assert.deepEqual(chart.options.map((item) => item.rankLabel), ['1', '1', '3', '4', '5']);
    assert.deepEqual(chart.options.map((item) => item.firsts), [2, 1, 0, 0, 1]);
    assert.equal(chart.options.reduce((sum, item) => sum + item.points, 0), 60);
    assert.equal(chart.caption, RANKING_CAPTION);
    assert.equal(chart.headline, `A tie between ${RANK.A} and ${RANK.B} (support score 69 each).`);
    // Who ranked "Longer breaks", first places first: the fourth person put it first; the others last (place 5).
    assert.deepEqual(chart.options[4].who.map((who) => [who.name, who.place]), [['Unnamed participant 1', 1], ['Mike A', 5], ['José Álvarez', 5], ['=SUM(A1)', 5]]);
  });

  it('the support score is 100 for everyone first and 0 for everyone last', () => {
    // 3 voters, 4 options: all first = 3 x 4 = 12 points -> (12 - 3) / (3 x 3) = 1; all last = 3 points -> 0.
    assert.equal(supportScore(12, 3, 4), 100);
    assert.equal(supportScore(3, 3, 4), 0);
    assert.equal(supportScore(0, 0, 4), 0);
  });
});

describe('written answers', () => {
  const comments = [
    'The prices are too high, and delivery is slow.',
    'Price matters; delivery took 3 days.',
    `Delivery boxes arrived damaged. Don${CURLY}t like the box.`,
    'Café staff were friendly; the café was clean.',
    'Friendly café, but prices high.',
  ];
  const question = { id: 'q-text', type: 'open-text-feedback', prompt: 'Anything else?', respondents: 5, options: [], responses: comments.map((text, index) => answer(TRACKS[index % 4].id, 'q-text', text, 40 + index)) };

  it('keeps the words that came up in at least two comments, plurals folded, common words and numbers left out', () => {
    // Words kept, comment by comment (the, are, too, and, is, but, were, was, don't and the number 3 are left out):
    //   1 prices high delivery slow   2 price matters delivery took days   3 delivery boxes arrived damaged like box
    //   4 café staff friendly café clean   5 friendly café prices high
    // "prices" folds into "price" and "boxes" into "box" (both singulars were written); "matters" and "days" stay (nobody wrote "matter", "day").
    // By comment: delivery 1, 2, 3 = 3; price 1, 2, 5 = 3; café 4, 5 = 2; friendly 4, 5 = 2; high 1, 5 = 2; box only in 3 (twice) = 1.
    const chart = chartOf(question, { names });
    assert.deepEqual(chart.words.map((word) => [word.word, word.count]), [['delivery', 3], ['price', 3], ['café', 2], ['friendly', 2], ['high', 2]]);
    assert.deepEqual(chart.words[1].commentIds, ['c1', 'c2', 'c5']);
    assert.equal(chart.headline, `5 comments. The word that came up most is ${OPEN}delivery${CLOSE}, in 3 of them.`);
    // Where "price" is in the first comment: "prices", from 4 to 10.
    const [first] = chart.words[1].spans.c1;
    assert.equal(comments[0].slice(first[0], first[1]), 'prices');
    assert.deepEqual(segmentsOf(comments[0], chart.words[1].spans.c1), [{ text: 'The ', hit: false }, { text: 'prices', hit: true }, { text: ' are too high, and delivery is slow.', hit: false }]);
    // The comments themselves, verbatim, in the order they were written, with their authors.
    assert.deepEqual(chart.comments.map((comment) => comment.text), comments);
    assert.deepEqual(chart.comments.map((comment) => comment.name), ['Mike A', 'José Álvarez', '=SUM(A1)', 'Unnamed participant 1', 'Mike A']);
  });

  it('keeps the top 8, and reads any script', () => {
    const many = Array.from({ length: 10 }, (_, index) => `alpha${String.fromCharCode(97 + index)}`);
    const twice = [{ id: 'x', text: many.join(' ') }, { id: 'y', text: many.join(' ') }];
    assert.equal(topWords(twice).length, TOP_WORDS);
    assert.deepEqual(wordsIn(`Привет мир 2025 ok l${CURLY}été`).map((token) => token.word), ['привет', 'мир', 'l\'été']);
    assert.equal(foldPlural('parties', new Set(['party'])), 'party');
    assert.equal(foldPlural('news', new Set()), 'news');
    assert.equal(foldPlural('class', new Set(['clas'])), 'class');
  });

  it('a written answer of 1,000 characters is shown whole', () => {
    const long = 'Faster delivery matters. '.repeat(40);
    assert.equal(long.length, 1000);
    const chart = chartOf({ id: 'q', type: 'open-text-feedback', prompt: 'p', respondents: 2, options: [], responses: [answer('t1', 'q', long, 1), answer('t2', 'q', 'delivery was slow', 2)] });
    assert.equal(chart.comments[0].text, long);
    assert.deepEqual(chart.words.map((word) => [word.word, word.count]), [['delivery', 2]]);
    assert.equal(chart.words[0].spans.c1.length, 40);
  });

  it('the stop words are a sorted list in small letters', () => {
    const list = [...STOP_WORDS];
    assert.deepEqual(list, [...list].sort());
    assert.ok(list.every((word) => word === word.toLocaleLowerCase('en') && word.length >= 3), 'small letters, three or more');
  });
});

describe('names', () => {
  it('are the names Admin → Results shows: the QR name, accents and "=" as they were typed, and "Unnamed participant N"', () => {
    assert.deepEqual([...names.values()], ['Mike A', 'José Álvarez', '=SUM(A1)', 'Unnamed participant 1']);
    const rows = resultRows({ session: { id: 's', sectionIds: [] }, tracks: TRACKS, sections: [], unreadable: [] });
    assert.deepEqual(rows.map((row) => row.name), [...names.values()]);
    const who = chartOf(addressQuestion(), { names }).options[0].who;
    assert.deepEqual(who.map((entry) => [entry.name, entry.at]), [['Mike A', at(10)], ['José Álvarez', at(12)]]);
    assert.equal(people(1), '1 person');
    assert.equal(people(2), '2 people');
  });

  it('a name used twice is "(2)", exactly as on the Results cards', () => {
    const twice = [...TRACKS, { id: 't5', participantName: 'Mike A', createdAt: '2026-10-15T11:00:00.000Z' }];
    assert.equal(namesFor({ tracks: twice }).get('t5'), 'Mike A (2)');
  });

  it('the wall display gets no names at all', () => {
    for (const question of [addressQuestion(), rankingQuestion(), confidenceQuestion(), { id: 'q-text', type: 'open-text-feedback', prompt: 'p', respondents: 1, options: [], responses: [answer('t1', 'q-text', 'Fine', 1)] }]) {
      const chart = chartOf(question, { names: null });
      const text = JSON.stringify(chart);
      for (const name of ['Mike A', 'José Álvarez', '=SUM(A1)', 'Unnamed participant']) assert.ok(!text.includes(name), `${question.type}: ${name}`);
      assert.ok((chart.options ?? []).every((option) => option.who.length === 0));
      assert.ok((chart.comments ?? []).every((comment) => comment.name === null));
    }
  });
});

describe('answers to an answer that has since been removed', () => {
  it('count in no bar, take their share of the 100, and are said under the chart', () => {
    // Four answered: A, B, B, and X, which has since been removed. Shares of 4: A 25, B 50, X 25; A and B are drawn, 75 between them.
    const question = { id: 'q', type: 'single-select', prompt: 'p', respondents: 4, options: [{ id: 'A', label: 'Kept A', count: 1 }, { id: 'B', label: 'Kept B', count: 2 }], responses: [answer('t1', 'q', 'A', 1), answer('t2', 'q', 'B', 2), answer('t3', 'q', 'B', 3), answer('t4', 'q', 'X', 4)] };
    const chart = chartOf(question, { names });
    assert.deepEqual(chart.options.map((option) => [option.label, option.percent]), [['Kept B', 50], ['Kept A', 25]]);
    assert.equal(chart.removed, 1);
    assert.equal(chart.removedLine, '1 person chose an answer that has since been removed; it is in no bar.');
    assert.equal(removedLine(2, true), '2 picks were of answers that have since been removed, and are in no bar.');
    assert.equal(chart.headline, 'The top choice (50%) was Kept B.');
  });
});

describe('"N answers from M iPads" (Phase 11a-2, part D)', () => {
  // Kroger on the real site, 16 Oct 2026: five visits, which answered 9, 8, 0, 8 and 9 of nine questions. 9 + 8 + 0 + 8 + 9 = 34 answers, from the four
  // visits that answered: the header said "34 answers from 5 iPads", counting the visit that answered nothing (VJR chose to count the visits that answered).
  const tracks = ['k1', 'k2', 'k3', 'k4', 'k5'].map((id, index) => ({ id, createdAt: at(index) }));
  const answeredBy = { k1: 9, k2: 8, k3: 0, k4: 8, k5: 9 };
  const questionIds = Array.from({ length: 9 }, (_, index) => `kq${index + 1}`);
  const results = buildResults({
    session: { id: 'kroger-day', sectionIds: ['ks'] }, tracks,
    sections: [{ id: 'ks', title: 'Kroger', enabled: true, questionIds }],
    questions: questionIds.map((id) => ({ id, type: 'single-select', prompt: id, optionIds: [`${id}-a`] })),
    options: questionIds.map((id) => ({ id: `${id}-a`, label: 'A' })),
    // Each visit answers its first N questions.
    answers: Object.entries(answeredBy).flatMap(([track, count]) => questionIds.slice(0, count).map((questionId, index) => answer(track, questionId, `${questionId}-a`, index))),
  });
  const questions = results.sections.flatMap((section) => section.questions);

  it('Kroger: 34 answers from the 4 visits that answered, not the 5 that began', () => {
    assert.equal(results.tracks.length, 5, 'five visits began');
    assert.deepEqual(answerCounts(questions), { answers: 34, visits: 4 });
    assert.equal(answersFrom(answerCounts(questions)), '34 answers from 4 iPads');
  });

  it('counts each visit once, however many answers it gave, and only over the questions it is given', () => {
    // Over the first question alone: k1, k2, k4 and k5 answered it (k3 answered nothing): 4 answers from 4 iPads. Over none: 0 from 0.
    assert.deepEqual(answerCounts(questions.slice(0, 1)), { answers: 4, visits: 4 });
    assert.deepEqual(answerCounts([]), { answers: 0, visits: 0 });
    // The ninth question was answered by k1 and k5 only (they answered all nine; k2 and k4 stopped at eight): 2 answers from 2 iPads.
    assert.deepEqual(answerCounts(questions.slice(8)), { answers: 2, visits: 2 });
  });

  it('says one answer and one iPad in the singular (Phase 11b), and every other number in the plural', () => {
    assert.equal(answersFrom({ answers: 1, visits: 1 }), '1 answer from 1 iPad');
    assert.equal(answersFrom({ answers: 3, visits: 1 }), '3 answers from 1 iPad');
    assert.equal(answersFrom({ answers: 0, visits: 0 }), '0 answers from 0 iPads');
    assert.equal(answersFrom({ answers: 34, visits: 4 }), '34 answers from 4 iPads');
  });

  it('an answer whose visit record has gone still came from an iPad; one with no visit at all from none', () => {
    const question = { id: 'q', type: 'single-select', prompt: 'p', respondents: 3, options: [], responses: [answer('k1', 'q', 'a', 1), answer('gone', 'q', 'a', 2), { questionId: 'q', answer: 'a', clientTrackId: null, timestamp: at(3) }] };
    assert.deepEqual(answerCounts([question]), { answers: 3, visits: 2 });
  });
});

describe('a session', () => {
  it('agrees with the tally lib/results-tally.js builds, section by section', () => {
    // The same four answers to the address question, counted by buildResults: 1, 2, 1, 0.
    const question = addressQuestion();
    const results = buildResults({
      session: { id: 's', sectionIds: ['sec'] }, tracks: TRACKS,
      sections: [{ id: 'sec', title: 'Office', questionIds: [question.id] }],
      questions: [{ id: question.id, type: question.type, prompt: question.prompt, optionIds: question.options.map((option) => option.id) }],
      options: question.options.map(({ count, ...option }) => option),
      answers: question.responses,
    });
    const [section] = chartsOf(results, { names: namesFor({ tracks: TRACKS, answers: answersOf(results) }) });
    assert.equal(section.title, 'Office');
    assert.deepEqual(section.charts[0].options.map((option) => [option.count, option.percent]), [[2, 50], [1, 25], [1, 25], [0, 0]]);
    assert.equal(chartKind('single-select'), 'choice');
    assert.equal(chartKind('something-new'), 'choice');
  });
});
