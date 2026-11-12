// What a Results chart shows, worked out from the tally and the answers, with no drawing in it (Phase 11a). The admin page's charts
// (migration/src/admin/charts/) draw what this returns, and the leader report (Phase 11b) will put the same numbers on paper, so every
// percentage, headline, rank and word lives here once. Plain JS with JSDoc, no DOM and no Svelte: `node --test` imports it, and
// scripts/test-results-chart-model.js holds each rule to numbers worked out by hand in the test.
//
// It counts nothing again: a question arrives as lib/results/results-tally.js built it (`respondents`, and each option's `count` and, for a
// ranking, its Borda `score`), with its answers (`responses`). What this adds is how those numbers are SHOWN:
//   - a share is a count over the people who answered the question. For single choice, true or false and a confidence scale (one answer
//     each) the shown whole percentages are rounded by the largest-remainder rule, so they add up to exactly 100 (with answers to an option
//     that has since been removed counted in that 100 and said under the chart). For multiple choice each is rounded alone, and they add up
//     to more than 100.
//   - a headline in plain words, from the data. "Most people" only when the top answer's share is more than half (Phase 11a-2: the real site said
//     "Most people (50%) chose ..."), and one stop at the end of a sentence that ends with an answer's own words (see sentence()).
//   - who picked what: the names come from lib/results/participant-names.js, the rule Admin → Results and the leader report name people by, so
//     a person is called the same thing everywhere. On the wall display there are no names at all: chartOf() is given none.
//   - a confidence scale's average, where it sits between the steps, and three bands by position.
//   - a ranking's support score (see supportScore) and its places (a shared place is the same number on two bars).
//   - for written answers, the words that came up most: repeated words, counted by comment, never a summary or a theme.

import { isGraded } from '../participant/pager-logic.js';
import { aopResults, byGroup, countedGrid, whereToStart } from './aop-math.js';
import { people, byTime, whoOf, wholePercents, listOf, labelOf } from './chart-answers.js';
import { topWords } from './chart-words.js';
// (Prompt 44: who answered and the shares are lib/results/chart-answers.js, the words of written answers lib/results/chart-words.js; their names are passed on here, as before.)
export { namesFor, picturesFor, answersOf, people, numberWords, FEW_ANSWERS, fewAnswersLine, answerCounts, answersFrom, wholePercents } from './chart-answers.js';
export { TOP_WORDS, FIRST_COMMENTS, STOP_WORDS, wordsIn, foldPlural, topWords, segmentsOf } from './chart-words.js';

/** @typedef {{ id: string, label?: string, value?: unknown, correct?: boolean | null, count?: number, score?: number, [key: string]: any }} TallyOption */
/** @typedef {{ questionId?: string, clientTrackId?: string | null, clientId?: string | null, answer: unknown, timestamp?: string | null, [key: string]: any }} TallyAnswer */
/** @typedef {{ id: string, type: string, prompt?: string, respondents?: number, responses?: TallyAnswer[], options?: TallyOption[], [key: string]: any }} TallyQuestion */
/** @typedef {{ key: string, name: string, at: string | null, place?: number }} Who */

export const NO_ANSWERS = 'No answers yet.';
export const MULTI_CAPTION = 'People could pick several answers, so the bars add up to more than 100%.';
export const RANKING_CAPTION = '100 means everyone ranked it first; 0 means everyone ranked it last.';
export const WORDS_HEADING = 'Words that came up most';
// ---- The headline in parts, and the hero figure (Prompt 34) ------------------------------------------------------------------------------
// The wall draws its one headline sentence with the figures in Bold and the measure's name underlined. Which words those are is the template's,
// never read from the words: each headline below is written as parts, `{ text, strong }` for a figure and `{ text, measure }` for the measure's
// name, and the headline is those parts joined. An answer, a label, a word people wrote or a name is always a plain part.

/** @typedef {{ text: string, strong?: true, measure?: true }} HeadlinePart */
const plain = (/** @type {string} */ text) => ({ text });
const figure = (/** @type {string | number} */ text) => ({ text: String(text), strong: /** @type {const} */ (true) });
const measureOf = (/** @type {string} */ text) => ({ text, measure: /** @type {const} */ (true) });
/** The parts as one string. @param {HeadlinePart[]} parts */
export const joinParts = (parts) => parts.map((part) => part.text).join('');
/** The parts as a sentence: a full stop after the last unless the words already end with one (as `sentence`). @param {HeadlinePart[]} parts */
const asSentence = (parts) => (ENDS_A_SENTENCE.test(joinParts(parts)) ? parts : [...parts, plain('.')]);

/**
 * The one figure the wall shows largest on a question's card, and the line under it that says what it is: the top share of a choice, the average
 * of a scale, the top support score of a ranking, how many comments; null when nobody has answered, and for Art of the Possible (its grid is the figure).
 * @param {any} chart @returns {{ figure: string, context: string } | null}
 */
function heroOf(chart) {
  if (!(chart.answered > 0)) return null;
  if (chart.kind === 'scale') return chart.scale?.average === null || chart.scale?.average === undefined ? null : { figure: chart.scale.average.toFixed(1), context: `average, out of ${chart.scale.top}` };
  // (A ranking's headline names the support score; under the figure, only its scale, and "each" when two share the top. A longer line took
  // three lines on a 1280 by 800 wall and made the question's type smaller.)
  if (chart.kind === 'ranking') return chart.options[0] ? { figure: String(chart.options[0].score), context: chart.options[1]?.score === chart.options[0].score ? 'each, out of 100' : 'out of 100' } : null;
  if (chart.kind === 'text') return chart.comments.length > 0 ? { figure: String(chart.comments.length), context: chart.comments.length === 1 ? 'comment' : 'comments' } : null;
  if (chart.kind === 'matrix') return null;
  const leaders = (chart.options ?? []).filter((option) => option.isTop);
  if (leaders.length === 0) return null;
  return leaders.length > 1
    ? { figure: String(leaders[0].count), context: 'each, a tie for the top' } // (the shares of a tie can differ by one when rounded)
    : { figure: `${leaders[0].percent}%`, context: `chose the top answer · ${leaders[0].count} of ${chart.answered}` };
}

// ---- One question ---------------------------------------------------------------------------------------------------------------------

/** Which chart a question type gets. @param {string} type */
export function chartKind(type) {
  switch (type) {
    case 'multi-select': return 'multi';
    case 'true-false': return 'truefalse';
    case 'confidence-continuum': return 'scale';
    case 'ranked-voting': return 'ranking';
    case 'open-text-feedback': return 'text';
    case 'art-of-the-possible': return 'matrix';
    default: return 'choice'; // single-select, and any type added later
  }
}

/**
 * Everything one question's chart needs. `names` is who is who (namesFor); null on the wall display, where nobody's name is shown: then
 * every `who` is empty and no comment carries its author.
 * @param {TallyQuestion} question
 * @param {{ names?: Map<string, string> | null, pictures?: Map<string, string> | null, guests?: number | null, groups?: Map<string, string> | null }} [options] `pictures`: the admin view's faces (Prompt 23); `guests`, how many joined; `groups`, each visit's guest group.
 */
export function chartOf(question, { names = null, pictures = null, guests = null, groups = null } = {}) {
  const built = questionChart(question, { names, guests, groups });
  // (A headline written as one string, a matrix's or "No answers yet.", is one plain part.)
  const headlineParts = built.headlineParts ?? [plain(built.headline)];
  const chart = { ...built, headline: joinParts(headlineParts), headlineParts, hero: heroOf(built) };
  return pictures ? withPictures(chart, pictures) : chart;
}

/** Each name in a chart with its picture, or null for the silhouette (Prompt 23). */
function withPictures(chart, pictures) {
  const faced = (who = []) => who.map((person) => ({ ...person, picture: pictures.get(person.key) ?? null }));
  const rows = (list) => list.map((row) => ({ ...row, criteria: row.criteria.map((cell) => ({ ...cell, who: faced(cell.who) })) }));
  return {
    ...chart,
    ...(chart.options ? { options: chart.options.map((option) => (option.who ? { ...option, who: faced(option.who) } : option)) } : {}),
    ...(chart.sides ? { sides: chart.sides.map((side) => ({ ...side, who: faced(side.who) })) } : {}),
    ...(chart.rows ? { rows: rows(chart.rows) } : {}),
    ...(chart.views ? { views: chart.views.map((view) => ({ ...view, rows: rows(view.rows) })) } : {}),
  };
}

function questionChart(question, { names, guests, groups }) {
  const type = String(question.type ?? '');
  let kind = chartKind(type);
  const options = question.options ?? [];
  // A true-or-false question has two sides; one that somehow has another number of answers is drawn as bars.
  if (kind === 'truefalse' && options.length !== 2) kind = 'choice';
  const responses = question.responses ?? [];
  const answered = Number(question.respondents ?? responses.length) || 0;
  const base = {
    id: String(question.id),
    type,
    kind,
    prompt: typeof question.prompt === 'string' && question.prompt.trim() ? question.prompt.trim() : 'Untitled question',
    answered,
    graded: false,
    headline: answered === 0 ? NO_ANSWERS : '',
    gradedLine: '',
    caption: '',
    removedLine: '',
  };
  if (kind === 'matrix') return { ...base, ...matrixChart(question, options, responses, { names, guests, groups, answered }) };
  if (kind === 'text') return { ...base, ...textChart(responses, names, answered) };
  if (kind === 'ranking') return { ...base, ...rankingChart(options, responses, names, answered) };
  return { ...base, ...choiceChart(kind, question, options, responses, names, answered) };
}

/**
 * Single choice, multiple choice, true or false and a confidence scale: bars of the share of people who picked each answer.
 * @param {string} kind @param {TallyQuestion} question @param {TallyOption[]} options @param {TallyAnswer[]} responses
 * @param {Map<string, string> | null} names @param {number} answered
 */
function choiceChart(kind, question, options, responses, names, answered) {
  const multi = kind === 'multi';
  const present = new Set(options.map((option) => String(option.id)));
  const picks = (response) => [response.answer].flat().map(String);
  // Answers to an option that is no longer on the question: counted in nobody's bar, and said under the chart.
  const removed = multi
    ? responses.reduce((sum, response) => sum + picks(response).filter((id) => !present.has(id)).length, 0)
    : responses.filter((response) => picks(response).length > 0 && !picks(response).some((id) => present.has(id))).length;
  const counts = options.map((option) => Number(option.count) || 0);
  const percents = multi
    ? counts.map((count) => (answered > 0 ? Math.round((count * 100) / answered) : 0))
    : wholePercents(removed > 0 ? [...counts, removed] : counts, answered).slice(0, counts.length);
  const graded = (kind === 'choice' || kind === 'truefalse') && isGraded({ type: question.type, options: options.map((option) => ({ ...option, correct: option.correct ?? null })) });
  const correctIds = new Set(graded ? options.filter((option) => option.correct === true).map((option) => String(option.id)) : []);
  const top = Math.max(0, ...counts);
  const rows = options.map((option, index) => ({
    id: String(option.id),
    label: labelOf(option),
    value: option.value,
    count: counts[index],
    share: answered > 0 ? counts[index] / answered : 0,
    percent: percents[index],
    isCorrect: correctIds.has(String(option.id)),
    isTop: top > 0 && counts[index] === top,
    order: index,
    who: /** @type {Who[]} */ (names ? responses.filter((response) => picks(response).includes(String(option.id))).map((response) => whoOf(response, names)).filter(Boolean).sort(byTime) : []),
  }));
  // Single and multiple choice are drawn highest first (a tie keeps the question's order); true or false keeps its sides, and a scale its steps.
  const shown = kind === 'choice' || kind === 'multi' ? [...rows].sort((a, b) => b.count - a.count || a.order - b.order) : rows;
  const leaders = rows.filter((row) => row.isTop);
  const right = graded ? responses.filter((response) => picks(response).some((id) => correctIds.has(id))).length : 0;

  /** @type {Record<string, any>} */
  const chart = {
    graded,
    options: shown,
    removed,
    removedLine: removedLine(removed, multi),
    caption: multi ? MULTI_CAPTION : '',
    gradedLine: graded && answered > 0 ? `${right} of ${answered} got it right first time.` : '',
    right,
  };
  if (kind === 'truefalse') {
    const truth = rows.findIndex((row) => row.value === true || row.value === 'true');
    const at = truth >= 0 ? truth : 0;
    chart.sides = [rows[at], rows[1 - at]];
    chart.options = chart.sides;
  }
  if (kind === 'scale') chart.scale = scaleOf(rows, answered);
  chart.headlineParts = answered === 0 ? [plain(NO_ANSWERS)] : headlineOf(kind, rows, leaders, answered, chart.scale);
  chart.headline = joinParts(chart.headlineParts);
  return chart;
}

/** What is said under a chart when some answers were to an answer that has since been removed. @param {number} removed @param {boolean} multi */
export function removedLine(removed, multi) {
  if (removed === 0) return '';
  if (multi) return removed === 1 ? '1 pick was of an answer that has since been removed, and is in no bar.' : `${removed} picks were of answers that have since been removed, and are in no bar.`;
  return removed === 1 ? '1 person chose an answer that has since been removed; it is in no bar.' : `${removed} people chose answers that have since been removed; they are in no bar.`;
}

// A sentence's own stop is already there when the words end with one: a full stop, a question or exclamation mark or an ellipsis, perhaps followed
// by a closing quotation mark or bracket ("Kroger grocery and Baking co.", "Why not both?", "Kroger (Inc.)").
const ENDS_A_SENTENCE = /[.?!\u2026]["'\u2019\u201D)\]]*$/u;

/** `text` as the end of a sentence: with a full stop, unless its own words already end with a stop. Never two in a row. @param {string} text */
export const sentence = (text) => (ENDS_A_SENTENCE.test(text) ? text : `${text}.`);

/**
 * Is the top answer chosen by most people? Only when its share is more than half, as counted (`count` of `answered`) and as shown (`percent`):
 * 51 of 101 is shown as 50%, and "Most people (50%)" would read as half (Phase 11a-2).
 * @param {{ count: number, percent: number }} lead @param {number} answered
 */
export const isMost = (lead, answered) => lead.count * 2 > answered && lead.percent > 50;

/**
 * The headline of a choice, true or false or scale, in parts (Prompt 34; joined, the words are as they were). A scale's average leads, its
 * measure "Average" and its figures; otherwise the measure is "Most people", "top choice" or "top answer" and the figure the share.
 * @param {string} kind @param {any[]} rows @param {any[]} leaders @param {number} answered @param {any} [scale] @returns {HeadlinePart[]}
 */
function headlineOf(kind, rows, leaders, answered, scale) {
  const averaged = Boolean(scale?.averageText);
  const average = averaged ? [measureOf('Average'), plain(' '), figure(scale.average.toFixed(1)), plain(' of '), figure(scale.top), plain('. ')] : [];
  // (One measure underlined: after a scale's average, the rest of its sentence names none.)
  const name = (/** @type {string} */ text) => (averaged ? plain(text) : measureOf(text));
  if (leaders.length === 0) return [...average, plain('None of the answers given is still on the question.')];
  if (leaders.length > 1) return [...average, plain(`A tie between ${listOf(leaders.map((row) => row.label))} (`), figure(leaders[0].count), plain(' each).')];
  const [lead] = leaders;
  const most = isMost(lead, answered);
  const share = figure(`${lead.percent}%`);
  if (kind === 'truefalse') return asSentence(most ? [name('Most people'), plain(' ('), share, plain(') said '), plain(lead.label)] : [plain('The '), name('top answer'), plain(' ('), share, plain(') was '), plain(lead.label)]);
  return [...average, ...asSentence(most ? [name('Most people'), plain(' ('), share, plain(') chose '), plain(lead.label)] : [plain('The '), name('top choice'), plain(' ('), share, plain(') was '), plain(lead.label)])];
}

// ---- A confidence scale ---------------------------------------------------------------------------------------------------------------

/** The colour steps of a scale: up to 5; a longer scale shares them out in order (Phase 11a: the blue ramp has five steps at most). */
const MAX_TONES = 5;

/**
 * Which third of the scale a step is in, by its place: 0 the lowest third, 1 the middle, 2 the top. With three steps each step is a band;
 * with two there is no middle. @param {number} index @param {number} steps
 */
export function bandOf(index, steps) {
  if (steps <= 1) return 1;
  if (3 * index < steps - 1) return 0;
  if (3 * index > 2 * (steps - 1)) return 2;
  return 1;
}

/** @param {any[]} rows @param {number} answered */
function scaleOf(rows, answered) {
  const steps = rows.length;
  const values = rows.map((row) => Number(row.value));
  const numeric = steps > 0 && values.every((value) => Number.isFinite(value));
  const counted = rows.reduce((sum, row) => sum + row.count, 0);
  let average = null;
  let averageAt = null;
  let top = null;
  if (numeric && counted > 0) {
    average = rows.reduce((sum, row, index) => sum + values[index] * row.count, 0) / counted;
    top = Math.max(...values);
    // Where the average sits along the steps (0 is the first step's middle, steps - 1 the last's), between the two values it falls between.
    averageAt = 0;
    for (let index = 0; index < steps - 1; index += 1) {
      const [low, high] = [values[index], values[index + 1]];
      if ((average >= low && average <= high) || (average <= low && average >= high)) {
        averageAt = high === low ? index : index + (average - low) / (high - low);
        break;
      }
      averageAt = index + 1;
    }
  }
  const tones = Math.min(steps, MAX_TONES);
  const bands = [0, 1, 2].map((band) => {
    const members = rows.map((row, index) => ({ row, index })).filter(({ index }) => bandOf(index, steps) === band);
    const name = band === 0 ? rows[0]?.label : band === 2 ? rows[steps - 1]?.label : 'Middle';
    const count = members.reduce((sum, { row }) => sum + row.count, 0);
    return { band, name: name ?? '', from: members[0]?.index ?? null, to: members.at(-1)?.index ?? null, count, share: answered > 0 ? count / answered : 0 };
  }).filter((band) => band.from !== null);
  return {
    steps: rows.map((row, index) => ({ ...row, band: bandOf(index, steps), tone: steps <= MAX_TONES ? index : Math.floor((index * MAX_TONES) / steps) })),
    tones,
    average,
    top,
    averageAt,
    averageText: average === null ? '' : `Average ${average.toFixed(1)} of ${top}`,
    bands,
  };
}

// ---- A ranking ------------------------------------------------------------------------------------------------------------------------

/**
 * The support score of an option, 0 to 100: `(points - rankers) / (rankers * (options - 1)) * 100`, rounded. Points are the Borda points
 * lib/results/results-tally.js counts (with n options, a first place is n points and a last place 1), and `rankers` the people who ranked it (everyone
 * who answered, unless the option was added after some of them did). 100 means everyone who ranked it put it first; 0, last.
 * @param {number} points @param {number} rankers @param {number} optionCount
 */
export function supportScore(points, rankers, optionCount) {
  if (!(rankers > 0)) return 0;
  if (optionCount <= 1) return 100;
  return Math.round(((points - rankers) / (rankers * (optionCount - 1))) * 100);
}

/** @param {TallyOption[]} options @param {TallyAnswer[]} responses @param {Map<string, string> | null} names @param {number} answered */
function rankingChart(options, responses, names, answered) {
  const ids = options.map((option) => String(option.id));
  // Each person's order among the options the question has now (the tally scores the same way).
  const orders = responses.map((response) => ({ response, order: [response.answer].flat().map(String).filter((id) => ids.includes(id)) }));
  const items = options.map((option, index) => {
    const id = String(option.id);
    const placed = orders.filter(({ order }) => order.includes(id));
    const points = Number(option.score) || 0;
    return {
      id,
      label: labelOf(option),
      points,
      rankers: placed.length,
      firsts: placed.filter(({ order }) => order[0] === id).length,
      score: supportScore(points, placed.length, ids.length),
      order: index,
      who: /** @type {Who[]} */ (names ? placed.map(({ response, order }) => ({ ...whoOf(response, names), place: order.indexOf(id) + 1 })).filter((who) => who.key).sort((a, b) => a.place - b.place || byTime(a, b)) : []),
    };
  });
  const sorted = [...items].sort((a, b) => b.score - a.score || a.order - b.order);
  const ranked = sorted.map((item) => {
    const rank = 1 + sorted.filter((other) => other.score > item.score).length;
    const tied = sorted.filter((other) => other.score === item.score).length > 1;
    // The place is its number alone, shared or not (Phase 11a-3: "1=" read as a typo on the real site, beside "3.").
    return { ...item, rank, tied, rankLabel: String(rank) };
  });
  const leaders = ranked.filter((item) => item.rank === 1);
  let headlineParts = [plain(NO_ANSWERS)];
  if (answered > 0 && leaders.length === 1) headlineParts = [plain(`${leaders[0].label} ranked highest, with a `), measureOf('support score'), plain(' of '), figure(leaders[0].score), plain('.')];
  else if (answered > 0 && leaders.length > 1) headlineParts = [plain(`A tie between ${listOf(leaders.map((item) => item.label))} (`), measureOf('support score'), plain(' '), figure(leaders[0].score), plain(' each).')];
  return { options: ranked, caption: RANKING_CAPTION, headline: joinParts(headlineParts), headlineParts };
}

// ---- Art of the Possible (Prompt 23) --------------------------------------------------------------------------------------------------

const MARKS = Object.freeze({ High: '▲', Medium: '●', Low: '▼' });
/** A mean's shade, of the four steps of the blue ramp: a rating of 1 is the lightest and 3 the darkest. @param {number} mean */
const heatTone = (mean) => Math.min(3, Math.floor(((mean - 1) / 2) * 4));

/** A question's rows as they are shown, over some answers: every number is lib/results/aop-math.js's, and here it is rounded and given its words. */
function matrixRows(question, options, responses, names) {
  const criteria = question.criteria ?? [];
  const result = aopResults({ rows: options, criteria, answers: responses });
  const shape = { rows: options, criteria };
  const grids = names ? responses.map((response) => ({ response, grid: countedGrid(response, shape).grid })) : [];
  const rows = result.rows.map((row) => ({
    ...row,
    label: labelOf(row),
    opportunityText: row.opportunity === null ? '' : String(Math.round(row.opportunity)),
    agreementText: row.agreement === null ? '' : `${Math.round(row.agreement * 100)}%`,
    mark: row.band ? MARKS[row.band] : '',
    bandText: row.band ?? 'No ratings',
    criteria: row.criteria.map((cell) => ({
      ...cell,
      meanText: cell.mean === null ? '' : cell.mean.toFixed(1),
      tone: cell.mean === null ? null : heatTone(cell.mean),
      who: /** @type {Who[]} */ (grids.filter(({ grid }) => grid[row.id]?.[cell.id] === 3).map(({ response }) => whoOf(response, names)).filter(Boolean).sort(byTime)),
    })),
  }));
  return { result, rows };
}

/**
 * An Art of the Possible question's chart: its rows (each criterion's mean and shade, opportunity, band, agreement, people), where to start, and each guest group's own rows.
 * @param {TallyQuestion} question @param {TallyOption[]} options @param {TallyAnswer[]} responses
 * @param {{ names: Map<string, string> | null, guests: number | null, groups: Map<string, string> | null, answered: number }} shown
 */
function matrixChart(question, options, responses, { names, guests, groups, answered }) {
  const { result, rows } = matrixRows(question, options, responses, names);
  const where = whereToStart(result);
  const scope = `${rows.length} ${rows.length === 1 ? 'sub-process' : 'sub-processes'} · ${result.fteInScope} ${result.fteInScope === 1 ? 'person' : 'people'} in scope`;
  return {
    aop: result,
    criteria: result.criteria,
    rows,
    where: { line: where.line, start: where.start.map((row) => rows.find((each) => each.id === row.id)), discuss: where.discuss.map((row) => rows.find((each) => each.id === row.id)) },
    views: groups ? byGroup(responses, (key) => groups.get(key)).map(({ group, answers }) => ({ group, respondents: answers.length, rows: matrixRows(question, options, answers, names).rows })) : [],
    metaLine: `${guests === null ? answered : `${answered} of ${guests}`} ${guests === 1 || (guests === null && answered === 1) ? 'guest' : 'guests'} answered · ${scope}`,
    wallLine: `${guests === null ? answered : `${answered} of ${guests}`} ${answered === 1 && guests === null ? 'has' : 'have'} rated`,
    caption: '',
    headline: answered === 0 ? NO_ANSWERS : sentence(where.line),
    options: [],
  };
}

function textChart(responses, names, answered) {
  const written = responses
    .map((response, index) => ({ response, index, text: typeof response.answer === 'string' ? response.answer : String(response.answer ?? '') }))
    .filter((entry) => entry.text.trim() !== '')
    .sort((a, b) => String(a.response.timestamp ?? '').localeCompare(String(b.response.timestamp ?? '')) || a.index - b.index);
  const comments = written.map((entry, index) => {
    const who = whoOf(entry.response, names);
    return { id: `c${index + 1}`, text: entry.text, name: who?.name ?? null, at: entry.response.timestamp ?? null };
  });
  const words = topWords(comments);
  const count = comments.length;
  // (The word that came up most is people's own: always a plain part.)
  const headlineParts = answered === 0 || count === 0 ? [plain(NO_ANSWERS)] : [figure(count), plain(` ${count === 1 ? 'comment' : 'comments'}.`)];
  if (words.length > 0) headlineParts.push(plain(` The word that came up most is “${words[0].word}”, in `), figure(words[0].count), plain(' of them.'));
  return { comments, words, headline: joinParts(headlineParts), headlineParts, options: [] };
}

// ---- A whole session --------------------------------------------------------------------------------------------------------------------

/**
 * Every question's chart, section by section, for a results tree (lib/results/results-tally.js buildResults). `names` as for chartOf.
 * @param {{ sections?: { id: string, title?: string, questions?: TallyQuestion[] }[], tracks?: any[] }} results
 * @param {{ names?: Map<string, string> | null, pictures?: Map<string, string> | null, groups?: Map<string, string> | null }} [options]
 */
export function chartsOf(results, { names = null, pictures = null, groups = null } = {}) {
  const guests = /** @type {any} */ (results).tracks?.length ?? null;
  return (results.sections ?? []).map((section) => ({ id: String(section.id), title: section.title ?? '', charts: (section.questions ?? []).map((question) => chartOf(question, { names, pictures, guests, groups })) }));
}
