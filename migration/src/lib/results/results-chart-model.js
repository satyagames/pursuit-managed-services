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
import { nameParticipants, ownerOf, withNamesHidden } from './participant-names.js';
import { aopResults, byGroup, countedGrid, whereToStart } from './aop-math.js';

/** @typedef {{ id: string, label?: string, value?: unknown, correct?: boolean | null, count?: number, score?: number, [key: string]: any }} TallyOption */
/** @typedef {{ questionId?: string, clientTrackId?: string | null, clientId?: string | null, answer: unknown, timestamp?: string | null, [key: string]: any }} TallyAnswer */
/** @typedef {{ id: string, type: string, prompt?: string, respondents?: number, responses?: TallyAnswer[], options?: TallyOption[], [key: string]: any }} TallyQuestion */
/** @typedef {{ key: string, name: string, at: string | null, place?: number }} Who */

export const NO_ANSWERS = 'No answers yet.';
export const MULTI_CAPTION = 'People could pick several answers, so the bars add up to more than 100%.';
export const RANKING_CAPTION = '100 means everyone ranked it first; 0 means everyone ranked it last.';
export const WORDS_HEADING = 'Words that came up most';
/** The words shown for written answers, at most. */
export const TOP_WORDS = 8;
/** A word must be in at least this many different comments to be shown. */
const MIN_COMMENTS = 2;
/** Shorter words are left out. */
const MIN_LETTERS = 3;
/** How many comments are shown before "Show more". */
export const FIRST_COMMENTS = 20;

/**
 * Common English words that say nothing about what people meant, left out of "Words that came up most". Reviewed by hand: function words,
 * auxiliaries and their contractions (with a straight apostrophe; a curly one is made straight before the look-up). Words of one or two letters
 * are left out by length, so they are not listed. Sorted and in small letters (a test holds both).
 */
export const STOP_WORDS = Object.freeze(new Set([
  'about', 'above', 'after', 'again', 'against', 'ain\'t', 'all', 'also', 'and', 'any', 'are', 'aren', 'aren\'t', 'because', 'been', 'before',
  'being', 'below', 'between', 'both', 'but', 'can', 'can\'t', 'cannot', 'could', 'couldn', 'couldn\'t', 'did', 'didn', 'didn\'t', 'does',
  'doesn', 'doesn\'t', 'doing', 'don', 'don\'t', 'down', 'during', 'each', 'either', 'etc', 'even', 'ever', 'every', 'few', 'for', 'from',
  'further', 'get', 'gets', 'got', 'had', 'hadn', 'hadn\'t', 'has', 'hasn', 'hasn\'t', 'have', 'haven', 'haven\'t', 'having', 'he\'d', 'he\'ll',
  'he\'s', 'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s', 'i\'ll', 'i\'ve', 'into', 'isn', 'isn\'t',
  'it\'d', 'it\'ll', 'it\'s', 'its', 'itself', 'just', 'let', 'let\'s', 'many', 'may', 'might', 'more', 'most', 'much', 'must', 'mustn',
  'mustn\'t', 'myself', 'need', 'neither', 'nor', 'not', 'now', 'off', 'once', 'one', 'only', 'other', 'others', 'our', 'ours', 'ourselves',
  'out', 'over', 'own', 'quite', 'rather', 'really', 'same', 'shall', 'shan', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should',
  'should\'ve', 'shouldn', 'shouldn\'t', 'since', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', 'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'though', 'through', 'too',
  'under', 'until', 'upon', 'very', 'via', 'was', 'wasn', 'wasn\'t', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren', 'weren\'t', 'what',
  'what\'s', 'when', 'when\'s', 'where', 'where\'s', 'whether', 'which', 'while', 'who', 'who\'s', 'whom', 'whose', 'why', 'why\'s', 'will',
  'with', 'within', 'without', 'won', 'won\'t', 'would', 'wouldn', 'wouldn\'t', 'yet', 'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your',
  'yours', 'yourself', 'yourselves',
]));

// ---- Who answered ---------------------------------------------------------------------------------------------------------------------

/**
 * Who is who, by the key an answer carries (its visit, see ownerOf): the names lib/results/participant-names.js gives, so the chart's names are the
 * Results rows' and the leader report's. `visits` and `roster` are what Admin → Results reads besides the tracks (lib/admin/admin-results.js
 * readNameSources); without them a staff sign-in is "Unnamed participant N" (a guest's QR name is on the track itself). With `hide` (the Hide names
 * switch, Prompt 21 decision B) everyone is "Guest N" in the same order.
 * @param {{ tracks?: any[], answers?: TallyAnswer[], visits?: any[], roster?: any[] }} records
 * @param {{ hide?: boolean }} [shown]
 * @returns {Map<string, string>}
 */
export function namesFor({ tracks = [], answers = [], visits = [], roster = [] }, { hide = false } = {}) {
  const named = nameParticipants({ tracks, visits, roster, answers: answers.map((answer) => ({ clientTrackId: answer.clientTrackId ?? null, clientId: answer.clientId ?? null })) });
  const people = hide ? withNamesHidden(named) : named;
  return new Map(people.map((person) => [person.key, person.name]));
}

/**
 * Whose picture is whose, by visit (Prompt 23): the same people as namesFor, and none at all when names are hidden, so a chart that is given this shows the silhouette for everyone
 * else. Only the admin view of Results calls this: the wall, the exports and the dashboard never do.
 * @param {{ tracks?: any[], visits?: any[], roster?: any[] }} records @param {{ hide?: boolean }} [shown] @returns {Map<string, string>}
 */
export function picturesFor({ tracks = [], visits = [], roster = [] }, { hide = false } = {}) {
  if (hide) return new Map();
  return new Map(nameParticipants({ tracks, visits, roster }).filter((person) => person.pictureUrl).map((person) => [person.key, person.pictureUrl]));
}

/** Every answer of a results tree ({ sections: [{ questions: [{ responses }] }] }), for namesFor(). @param {{ sections?: { questions?: TallyQuestion[] }[] }} results */
export const answersOf = (results) => (results.sections ?? []).flatMap((section) => (section.questions ?? []).flatMap((question) => question.responses ?? []));

/** "1 person", "2 people". @param {number} count */
export const people = (count) => `${count} ${count === 1 ? 'person' : 'people'}`;

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** A count in running words as the language guide (p. 40) has it: one to nine spelled out, 10 and more as figures with commas. @param {number} count */
export const numberWords = (count) => (Number.isInteger(count) && count >= 1 && count <= 9 ? SMALL[count] : count.toLocaleString('en-US'));

/** Under this many answers a share is said to rest on few (Phase 13): a percentage of three people must not read like one of three hundred. */
export const FEW_ANSWERS = 5;

/** "Only four answers." under FEW_ANSWERS; nothing at that many or more, and nothing for none (NO_ANSWERS says so). @param {number} answered */
export const fewAnswersLine = (answered) => (answered > 0 && answered < FEW_ANSWERS ? `Only ${numberWords(answered)} ${answered === 1 ? 'answer' : 'answers'}.` : '');

const byTime = (a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')) || a.name.localeCompare(b.name);

/** @param {TallyAnswer} answer @param {Map<string, string> | null} names */
function whoOf(answer, names) {
  if (!names) return null;
  const key = ownerOf(answer);
  if (key === null) return null;
  return { key, name: names.get(key) ?? 'Unnamed participant', at: answer.timestamp ?? null };
}

/**
 * "N answers from M iPads" over `questions` (Phase 11a-2, part D, VJR's choice of 16 Oct 2026): N is the answers to them (each question's `respondents`),
 * and M the visits those answers came from (ownerOf), each once. A visit that answered nothing is not counted (on the real site Kroger's header said "34
 * answers from 5 iPads" with one visit that had answered nothing: it says 4 now), nor one whose answers could not be read (they are not among the answers,
 * and the notice above them says so). The Live display's header, each Results card's summary and (since Phase 11b) the Live display's one-page PDF and PowerPoint
 * say it this way; the leader report's "participants" are every visit, on purpose.
 * @param {TallyQuestion[]} questions
 */
export function answerCounts(questions) {
  const visits = new Set();
  let answers = 0;
  for (const question of questions) {
    answers += Number(question.respondents ?? (question.responses ?? []).length) || 0;
    for (const response of question.responses ?? []) {
      const key = ownerOf(response);
      if (key !== null) visits.add(key);
    }
  }
  return { answers, visits: visits.size };
}

/** "34 answers from 4 iPads", and in the singular "1 answer from 1 iPad" (Phase 11b: it said "1 answers from 1 iPads"). @param {{ answers: number, visits: number }} counts */
export const answersFrom = ({ answers, visits }) => `${answers} ${answers === 1 ? 'answer' : 'answers'} from ${visits} ${visits === 1 ? 'iPad' : 'iPads'}`;

// ---- Shares -----------------------------------------------------------------------------------------------------------------------------

/**
 * Whole percentages of `total` that add up to exactly 100 (the largest-remainder rule): each share is rounded down, and the points left over
 * go to the largest remainders, the larger count first and then the earlier one. All 0 when nobody answered. When the counts add up to less
 * than `total` (answers to an option that has gone), pass that rest as the last count: it takes its share of the 100 and the others stay honest.
 * @param {number[]} counts @param {number} total
 */
export function wholePercents(counts, total) {
  if (!(total > 0)) return counts.map(() => 0);
  const exact = counts.map((count) => (count * 100) / total);
  const floors = exact.map((value) => Math.floor(value + 1e-9));
  let left = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, rest: value - floors[index], count: counts[index] }))
    .sort((a, b) => b.rest - a.rest || b.count - a.count || a.index - b.index);
  for (const { index, rest } of order) {
    if (left <= 0) break;
    if (rest <= 1e-9) continue;
    floors[index] += 1;
    left -= 1;
  }
  return floors;
}

/** "X and Y", "X, Y and Z". @param {string[]} items */
const listOf = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

const labelOf = (option) => (typeof option.label === 'string' && option.label.trim() ? option.label.trim() : 'Untitled answer');

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
  const chart = questionChart(question, { names, guests, groups });
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
  chart.headline = answered === 0 ? NO_ANSWERS : headlineOf(kind, rows, leaders, answered, chart.scale);
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

/** @param {string} kind @param {any[]} rows @param {any[]} leaders @param {number} answered @param {any} [scale] */
function headlineOf(kind, rows, leaders, answered, scale) {
  const average = scale?.averageText ? `${scale.averageText}. ` : '';
  if (leaders.length === 0) return `${average}None of the answers given is still on the question.`;
  if (leaders.length > 1) return `${average}A tie between ${listOf(leaders.map((row) => row.label))} (${leaders[0].count} each).`;
  const [lead] = leaders;
  const most = isMost(lead, answered);
  if (kind === 'truefalse') return sentence(most ? `Most people (${lead.percent}%) said ${lead.label}` : `The top answer (${lead.percent}%) was ${lead.label}`);
  return `${average}${sentence(most ? `Most people (${lead.percent}%) chose ${lead.label}` : `The top choice (${lead.percent}%) was ${lead.label}`)}`;
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
  let headline = NO_ANSWERS;
  if (answered > 0 && leaders.length === 1) headline = `${leaders[0].label} ranked highest, with a support score of ${leaders[0].score}.`;
  else if (answered > 0 && leaders.length > 1) headline = `A tie between ${listOf(leaders.map((item) => item.label))} (support score ${leaders[0].score} each).`;
  return { options: ranked, caption: RANKING_CAPTION, headline };
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

// ---- Written answers ------------------------------------------------------------------------------------------------------------------

// A word: letters, marks and digits in any script, with an apostrophe inside it ("don't", "l'été").
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;
const DIGITS = /^[\p{N}'’]+$/u;

/**
 * The words of a text, each with where it is: `{ start, end, word }`, `word` in small letters with a straight apostrophe. Numbers, words of
 * fewer than MIN_LETTERS letters and STOP_WORDS are left out.
 * @param {string} text
 */
export function wordsIn(text) {
  const found = [];
  for (const match of String(text).matchAll(WORD)) {
    const word = match[0].toLocaleLowerCase('en').replace(/’/g, '\'');
    if (DIGITS.test(word) || [...word.replace(/'/g, '')].length < MIN_LETTERS || STOP_WORDS.has(word)) continue;
    found.push({ start: /** @type {number} */ (match.index), end: /** @type {number} */ (match.index) + match[0].length, word });
  }
  return found;
}

/**
 * The singular a simple plural folds into, when that singular is itself among `known` words: "prices" with "price", "boxes" with "box",
 * "parties" with "party". A plural whose singular nobody wrote stays as it is (so "news" is never "new" unless someone wrote "new").
 * @param {string} word @param {Set<string>} known
 */
export function foldPlural(word, known) {
  if (!word.endsWith('s') || word.endsWith('ss') || word.endsWith('us') || word.endsWith('is') || word.endsWith('\'s')) return word;
  const candidates = [];
  if (word.endsWith('ies') && word.length > 4) candidates.push(`${word.slice(0, -3)}y`);
  if (/(?:s|x|z|ch|sh)es$/.test(word)) candidates.push(word.slice(0, -2));
  candidates.push(word.slice(0, -1));
  return candidates.find((candidate) => candidate.length >= MIN_LETTERS && known.has(candidate)) ?? word;
}

/**
 * The words that came up most in a set of comments: each word (a plural folded into its singular when both were written) counted once per
 * comment, kept when it is in at least MIN_COMMENTS comments, the TOP_WORDS most common first (a tie in the order of the alphabet), each
 * with the comments that hold it and where it is in each.
 * @param {{ id: string, text: string }[]} comments
 */
export function topWords(comments) {
  const tokens = comments.map((comment) => ({ id: comment.id, words: wordsIn(comment.text) }));
  const known = new Set(tokens.flatMap((entry) => entry.words.map((token) => token.word)));
  /** @type {Map<string, { word: string, comments: Map<string, [number, number][]> }>} */
  const byWord = new Map();
  for (const { id, words } of tokens) {
    for (const token of words) {
      const key = foldPlural(token.word, known);
      const entry = byWord.get(key) ?? { word: key, comments: new Map() };
      entry.comments.set(id, [...(entry.comments.get(id) ?? []), [token.start, token.end]]);
      byWord.set(key, entry);
    }
  }
  return [...byWord.values()]
    .filter((entry) => entry.comments.size >= MIN_COMMENTS)
    .sort((a, b) => b.comments.size - a.comments.size || a.word.localeCompare(b.word))
    .slice(0, TOP_WORDS)
    .map((entry) => ({ word: entry.word, count: entry.comments.size, commentIds: [...entry.comments.keys()], spans: Object.fromEntries(entry.comments) }));
}

/**
 * A text cut into the parts a highlighted word makes: `[{ text, hit }]`, in order, joined back the text as it was.
 * @param {string} text @param {[number, number][]} [spans]
 */
export function segmentsOf(text, spans = []) {
  const parts = [];
  let at = 0;
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (start < at) continue;
    if (start > at) parts.push({ text: text.slice(at, start), hit: false });
    parts.push({ text: text.slice(start, end), hit: true });
    at = end;
  }
  if (at < text.length || parts.length === 0) parts.push({ text: text.slice(at), hit: false });
  return parts;
}

/** @param {TallyAnswer[]} responses @param {Map<string, string> | null} names @param {number} answered */
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
  let headline = answered === 0 || count === 0 ? NO_ANSWERS : `${count} ${count === 1 ? 'comment' : 'comments'}.`;
  if (words.length > 0) headline += ` The word that came up most is “${words[0].word}”, in ${words[0].count} of them.`;
  return { comments, words, headline, options: [] };
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
