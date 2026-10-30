// A session's summary (Prompt 21, Phase 5): the totals PMSSessionSummary keeps for each session, written when the session ends (Today's End session) and by
// the dashboard's Rebuild for older ones, so that the Leadership dashboard reads one item a session, never every answer. Every number is taken from the
// leader report's model (lib/exports/leader-report.js buildLeaderReport: its counting rules, first answers only) and its confidence check
// (lib/results/confidence-shift.js); nothing is counted again here except the words of the feedback themes. Plain JS with JSDoc, no DOM and no I/O
// (scripts/test-session-summary.js); lib/admin/session-summaries.js reads the records and writes the item.
//
// ASSUMED (docs/history/RELEASE-21E.md): MeanBefore and MeanAfter are over every Before and every After (the confidence index's mean, decision 4), the paired
// guests' means are in SummaryJson for the shift; a session that does not ask the check measures nothing; first choices are those of polls (a single choice
// with no correct answer) and of rankings (the option put first); a feedback theme is a word of four letters or more, once a comment, without common words;
// the facilitator is the person who wrote the summary (who ended the session, or rebuilt it).

import { periodOf } from '../admin/session-plan.js';

/** The fewest comments kept for the dashboard's Survey feedback panel, and the longest each may be. */
export const FEEDBACK_QUOTES = 5;
const QUOTE_LENGTH = 200;
const THEMES = 8;

/** Words too common to be a theme (all under four letters are left out anyway). */
const COMMON = new Set(['that', 'this', 'with', 'have', 'from', 'they', 'were', 'what', 'when', 'will', 'would', 'there', 'their', 'about', 'which', 'more',
  'very', 'much', 'also', 'been', 'into', 'just', 'than', 'then', 'them', 'some', 'such', 'only', 'other', 'could', 'should', 'your', 'ours', 'over']);

/**
 * The themes of some comments: each word of four letters or more (letters of any script), in lower case, counted once a comment, most often first (a tie by
 * the word), the first eight.
 * @param {string[]} comments @returns {{ word: string, count: number }[]}
 */
export function themesOf(comments) {
  const counts = new Map();
  for (const comment of comments) {
    const words = new Set(String(comment ?? '').toLowerCase().match(/\p{L}{4,}/gu) ?? []);
    for (const word of words) if (!COMMON.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts].map(([word, count]) => ({ word, count })).sort((left, right) => right.count - left.count || left.word.localeCompare(right.word)).slice(0, THEMES);
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const groupKey = (value) => text(value).replace(/\s+/g, ' ').toLowerCase();

/** The mean of a step count list [{ value, before, after }] on one side, and how many it rests on. */
function meanOn(distribution, side) {
  let total = 0; let n = 0;
  for (const step of distribution ?? []) { total += step.value * step[side]; n += step[side]; }
  return n ? total / n : null;
}

/**
 * A session's summary from its records (lib/exports/leader-report-data.js) and its leader report.
 * @param {any} records @param {any} report buildLeaderReport(records)
 * @param {{ writtenBy?: string, at?: Date, startMonth?: unknown }} [options]
 */
export function summaryOf(records, report, { writtenBy = '', at = new Date(), startMonth } = {}) {
  const session = records.session;
  const check = report.summary.confidence;
  const measured = Boolean(check?.measured);
  const questions = report.activities.flatMap((activity) => activity.questions);
  const firstChoices = [];
  const kinds = {};
  for (const question of questions) {
    if (question.respondents > 0) kinds[question.kind] = (kinds[question.kind] ?? 0) + question.respondents;
    const options = question.kind === 'choice' ? question.options.map((row) => ({ label: row.label, count: row.count }))
      : question.kind === 'ranking' ? (question.ranking ?? []).map((row) => ({ label: row.label, count: row.firsts })) : null;
    if (options) firstChoices.push({ questionId: question.id, prompt: question.prompt, options: options.filter((row) => row.count > 0).sort((left, right) => right.count - left.count) });
  }
  const comments = questions.filter((question) => question.kind === 'text').flatMap((question) => question.comments).filter((comment) => text(comment.text));
  // The guest groups of those who joined (a track's visitorId is its roster row), each spelt as it was first seen.
  const rosterOf = new Map((records.roster ?? []).map((row) => [String(row.id), row]));
  const groups = {};
  const spelling = new Map();
  for (const track of records.tracks ?? []) {
    const group = rosterOf.get(String(track.visitorId ?? ''))?.guestGroup;
    if (!groupKey(group)) continue;
    const name = spelling.get(groupKey(group)) ?? text(group).replace(/\s+/g, ' ');
    spelling.set(groupKey(group), name);
    groups[name] = (groups[name] ?? 0) + 1;
  }
  return {
    id: String(session.id), clientId: String(session.clientId), period: text(session.period) || periodOf(session.date ?? '', startMonth), sessionDate: String(session.date ?? '').slice(0, 10),
    guests: report.summary.joined, answers: report.summary.answers, completed: report.summary.finishedAll,
    beforeCount: measured ? check.answeredBefore : 0, afterCount: measured ? check.answeredAfter : 0, pairedCount: measured ? check.answeredBoth : 0,
    meanBefore: measured ? meanOn(check.distribution, 'before') : null, meanAfter: measured ? meanOn(check.distribution, 'after') : null,
    summary: {
      v: 1, title: text(session.title) === session.id ? '' : text(session.title), startTime: text(session.startTime), facilitator: text(writtenBy), builtAt: at.toISOString(),
      scaleMax: measured ? check.scaleMax : null, pairedBefore: check?.shift?.beforeMean ?? null, pairedAfter: check?.shift?.afterMean ?? null,
      moved: measured ? { started: check.moved.started, moved: check.moved.moved } : null,
      distribution: measured ? { before: check.distribution.map((step) => step.before), after: check.distribution.map((step) => step.after) } : null,
      firstChoices, kinds, groups,
      feedback: { count: comments.length, themes: themesOf(comments.map((comment) => comment.text)), quotes: comments.slice(0, FEEDBACK_QUOTES).map((comment) => ({ name: comment.name, text: text(comment.text).slice(0, QUOTE_LENGTH) })) },
    },
  };
}

/** The item the data layer writes: the summary's JSON under `summaryJson` (PMSSessionSummary.SummaryJson). @param {ReturnType<typeof summaryOf>} made */
export const summaryRecord = ({ summary, ...rest }) => ({ ...rest, summaryJson: summary });

/** A summary as the dashboard reads it from an item: `summary` from `summaryJson` (an object, else nothing). @param {any} item */
export const summaryFromItem = ({ summaryJson, ...rest }) => ({ ...rest, summary: summaryJson && typeof summaryJson === 'object' ? summaryJson : {} });
