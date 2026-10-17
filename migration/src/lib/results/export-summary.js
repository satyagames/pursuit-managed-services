// What every Results export opens with (Phase 13): for each activity one sentence, its takeaway, and the numbers behind it; for a session the
// answers and questions in all. The leader report's "At a glance" page and its activity bands, the Live display's summary pack (PDF and
// PowerPoint) and the summary CSV all take their sentences from here, so the same session reads the same in every file.
//
// It counts nothing. An activity arrives as its charts (lib/results/results-chart-model.js chartOf: the Live display's tally, or the leader report's own
// counts through chartOfQuestion), and a takeaway is one of those charts' numbers and words, chosen by a rule:
//   1. An activity with a graded question that was answered: the average share right first time over those questions, and the one most missed
//      (the lowest share right; a tie goes to the question more people answered, then the earlier one). With one graded question, that one.
//   2. Otherwise the question with the clearest single leader: the highest share of the top answer among single choice, true or false, a
//      scale and multiple choice, with one top answer (a tie goes to more answers, then the earlier question). Then a tie for the top, a
//      ranking, and written answers, in that order. The takeaway is the question in quotation marks and its chart's own headline.
//   3. Nothing answered: the model's NO_ANSWERS.
// A takeaway that rests on fewer than FEW_ANSWERS answers ends with "Only N answers." Plain JS with JSDoc and no DOM; admin page only.

import { NO_ANSWERS, fewAnswersLine, numberWords } from './results-chart-model.js';

/** @typedef {{ id: string, kind: string, graded?: boolean, right?: number, answered: number, prompt: string, headline: string, options?: any[], [key: string]: any }} Chart */
/** @typedef {{ id: string, title: string, description?: string, off?: boolean, charts: Chart[] }} ActivityCharts */

const SHARES = new Set(['choice', 'truefalse', 'scale', 'multi']);

/** A share right first time, as a whole percentage. @param {number} right @param {number} answered */
const percentOf = (right, answered) => (answered > 0 ? Math.round((right * 100) / answered) : 0);

/** The question in quotation marks, then its own sentence: a colon between them when the question does not end with a stop of its own. @param {Chart} chart */
const quoted = (chart) => `“${chart.prompt}”${/[?.!…]$/u.test(chart.prompt) ? ' ' : ': '}${chart.headline}`;

/** The share of the top answer, and whether one answer alone has it. @param {Chart} chart */
function lead(chart) {
  const tops = (chart.options ?? []).filter((option) => option.isTop);
  return { percent: Math.max(0, ...tops.map((option) => Number(option.percent) || 0)), single: tops.length === 1 };
}

/** The earlier of two equal candidates wins: a stable sort over the charts' own order. */
const best = (charts, score) => charts.map((chart, order) => ({ chart, order, score: score(chart) }))
  .sort((a, b) => b.score - a.score || b.chart.answered - a.chart.answered || a.order - b.order)[0]?.chart ?? null;

/**
 * The graded questions' scoreboard: how many, their average share right first time, and the one most missed. Null without an answered graded question.
 * @param {Chart[]} charts
 */
export function scoreboardOf(charts) {
  const graded = charts.filter((chart) => chart.graded && chart.answered > 0);
  if (graded.length === 0) return null;
  const shares = graded.map((chart) => (chart.right ?? 0) / chart.answered);
  const averagePercent = Math.round((shares.reduce((sum, value) => sum + value, 0) / shares.length) * 100);
  const missed = graded.map((chart, order) => ({ chart, order, share: shares[order] }))
    .sort((a, b) => a.share - b.share || b.chart.answered - a.chart.answered || a.order - b.order)[0].chart;
  const mostMissed = { id: missed.id, prompt: missed.prompt, right: missed.right ?? 0, answered: missed.answered, percent: percentOf(missed.right ?? 0, missed.answered) };
  const questions = graded.length;
  return {
    questions, averagePercent, mostMissed,
    line: `Average right first time: ${averagePercent}% over ${numberWords(questions)} graded ${questions === 1 ? 'question' : 'questions'}. Most often missed: “${mostMissed.prompt}” (${mostMissed.right} of ${mostMissed.answered}).`,
  };
}

/**
 * One activity: its takeaway, the question it comes from (`source`, a chart's id, or null), its counts and its graded scoreboard.
 * @param {ActivityCharts} activity
 */
export function summarizeActivity(activity) {
  const charts = activity.charts ?? [];
  const answered = charts.filter((chart) => chart.answered > 0);
  const scoreboard = scoreboardOf(charts);
  let takeaway = NO_ANSWERS;
  let source = null;
  if (scoreboard) {
    const { mostMissed, averagePercent, questions } = scoreboard;
    source = mostMissed.id;
    if (questions === 1) takeaway = `On “${mostMissed.prompt}”, ${mostMissed.right} of ${mostMissed.answered} (${mostMissed.percent}%) got it right first time.`;
    else if (mostMissed.right === mostMissed.answered) takeaway = `Everyone who answered got ${questions === 2 ? 'both' : `all ${numberWords(questions)}`} graded questions right first time.`;
    else takeaway = `Across ${numberWords(questions)} graded questions, an average of ${averagePercent}% of first answers were right; the most missed was “${mostMissed.prompt}” (${mostMissed.right} of ${mostMissed.answered} right first time).`;
    const few = fewAnswersLine(mostMissed.answered);
    if (few) takeaway += ` ${few}`;
  } else if (answered.length > 0) {
    const shared = answered.filter((chart) => SHARES.has(chart.kind));
    const chart = best(shared.filter((each) => lead(each).single), (each) => lead(each).percent)
      ?? best(shared, (each) => lead(each).percent)
      ?? best(answered.filter((each) => each.kind === 'ranking'), (each) => Math.max(0, ...(each.options ?? []).map((option) => option.score ?? 0)))
      ?? best(answered, (each) => each.answered);
    source = chart.id;
    takeaway = quoted(chart);
    const few = fewAnswersLine(chart.answered);
    if (few) takeaway += ` ${few}`;
  }
  return {
    id: activity.id, title: activity.title, description: activity.description ?? '', off: activity.off === true,
    questions: charts.length, answers: charts.reduce((sum, chart) => sum + (chart.answered || 0), 0),
    takeaway, source, scoreboard,
  };
}

/**
 * The session: each activity's summary in the order given (the screen's), and the answers and questions in all.
 * @param {ActivityCharts[]} activities
 */
export function summarizeSession(activities) {
  const summaries = activities.map(summarizeActivity);
  return {
    activities: summaries,
    answers: summaries.reduce((sum, activity) => sum + activity.answers, 0),
    questions: summaries.reduce((sum, activity) => sum + activity.questions, 0),
  };
}
