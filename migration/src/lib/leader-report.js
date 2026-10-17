// The leader report and the participant CSV, as numbers and words: who took part, what each person answered first and last, and
// every count the PDF prints. No DOM, no request, no jsPDF: lib/leader-report-data.js reads the records, this file works everything
// out, lib/leader-report-layout.js places it on pages and lib/leader-report-pdf.js draws them. scripts/test-leader-report.js holds
// each rule below to a fixture whose answers are worked out by hand in the test.
//
// Plain JS with JSDoc, so `node --test` imports it.
//
// How each kind of question is stored in a participant's ResponsesJson record { questionId, answer, firstAnswer, attempts, correct,
// answeredAt } (and what readSessionResponses() hands on as { answer, firstAnswer, finalAnswer, attempts, correct, timestamp }):
//   single-select, true-false   answer = the option id they ended on; firstAnswer = the option id of the first pick. With a correct
//                               option the question is GRADED: attempts is 1 or 2, correct = "the first pick was right".
//                               Without one it is a poll: attempts 1, correct null.
//   multi-select                answer = an array of option ids (never graded).
//   confidence-continuum        answer = one option id; the option's `value` is its place on the scale (1, 2, 3 ...).
//   ranked-voting               answer = every option id, best first.
//   open-text-feedback          answer = the text, trimmed, 1000 characters at most.
// An answer record with no history (attempts and correct null, as an older page stored them) is counted as given: first and final are the one answer.

import { resolveClientTheme } from './client-theme.js';
import { masterColours } from './legacy-colours.js';
import { isGraded, isRecordSettled, MAX_WRONG_TRIES } from './pager-logic.js';
import { nameParticipants, ownerOf } from './participant-names.js';
import { summarizeActivity } from './export-summary.js';
import { chartOf } from './results-chart-model.js';
import { SAMPLE_REPORT_LINE, needsConfirmation } from './sample-notice.js';
import { unreadableNotice } from './unreadable.js';
import { compositeOver, contrastRatio, MIN_GRAPHIC_CONTRAST, MIN_TEXT_CONTRAST } from './theme.js';

/** @typedef {{ id: string, [key: string]: any }} Row */
/** @typedef {'graded' | 'choice' | 'multi' | 'scale' | 'ranking' | 'text'} Kind */
/**
 * @typedef {object} ReportRecords What lib/leader-report-data.js reads for one session.
 * @property {Row} session
 * @property {Row | null} [client]
 * @property {Row[]} [tracks]
 * @property {Row[]} [sections]
 * @property {Row[]} [questions]
 * @property {Row[]} [options]
 * @property {{ questionId: string, clientTrackId?: string | null, clientId?: string | null, answer: unknown, firstAnswer?: unknown, finalAnswer?: unknown, attempts?: number | null, correct?: boolean | null, timestamp?: string | null }[]} [answers]
 * @property {Row[]} [visits] UserVisitLogs of the session: where a staff sign-in name is kept.
 * @property {Row[]} [roster] VisitorRoster of the session.
 * @property {Row[]} [strayQuestions] Question records that still exist for answers outside the session's activities.
 * @property {Row[]} [strayOptions]
 * @property {{ id: string, reason: string }[]} [unreadable] Answer items the data service could not read (Phase 9b, DI-6): their answers are not in `answers` and not counted.
 */

// ---- The counting rules, as the report prints them ------------------------------------------------------------------------------

/** "About this report": how the numbers are counted. Each is a rule of this file, and has a test. */
export const COUNTING_RULES = Object.freeze([
  'Participants are everyone who opened the session, in the order they joined. Someone who joined twice is listed once for each visit, the later one as “Name (2)”.',
  'Names come from the guest QR code or the sign-in. Where none was recorded the person is “Unnamed participant 1, 2 …”; no name is guessed.',
  'Scores use each person’s first answer only, so trying again never raises a score. A score is the share of the graded questions a person answered that were right first time; “7 of 15 answered” shows where someone stopped early. The average is over the people who answered at least one graded question.',
  'Finished means a final answer to every question of every activity that is switched on. A wrong first answer that was never tried again is not final.',
  'When the facilitator restarted a participant, the answers that person had given were removed at that moment. Only what they answered after the restart exists and is counted, and their page says when it happened.',
  'Answers to a question that was later deleted, or taken out of the session, are listed under “Questions no longer in the activity”. They are in no score and no total.',
  'Someone who joined and answered nothing is listed, with “No answers recorded”.',
  'The wording of questions and answers, and which answer is correct, are read when the report is made, not as they stood when people answered.',
]);

/**
 * One plain sentence for the last page (Phase 11b), beside the rules and not one of them: the Live display's one-page PDF and PowerPoint, and its
 * screen, count "N answers from M iPads" over the iPads that ANSWERED, while this report counts everyone who opened the session, so a reader who
 * has both is not surprised by two figures.
 */
export const LIVE_FILES_NOTE = 'The Live display and its one-page PDF and PowerPoint count only the iPads that answered (“N answers from M iPads”), so their figure can be lower than the participants listed here, who are everyone who opened the session.';

export const NO_ANSWERS = 'No answers recorded';
/** Under a participant whose saved answers could not be read (Phase 9b): "No answers recorded" would not be true. */
export const UNREADABLE_PERSON = 'Saved answers could not be read, so none are counted here.';
export const STRAY_TITLE = 'Questions no longer in the activity';
const REMOVED_OPTION = 'an answer option that was later removed';
const UNREADABLE = 'An answer that can no longer be read (its question was deleted)';

const KIND_LABEL = Object.freeze({
  graded: 'One correct answer', choice: 'Poll, one answer', multi: 'Poll, any number of answers', scale: 'Confidence scale', ranking: 'Ranking', text: 'Written answer',
});

// ---- Small helpers ------------------------------------------------------------------------------------------------------------------

const words = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const share = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);
const byId = (rows) => new Map((rows ?? []).map((row) => [String(row.id), row]));
const list = (value) => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "58%": a share to the nearest whole percent. @param {number} value */
export const wholePercent = (value) => `${Math.round(value)}%`;

/**
 * The client's colour as an accent on a white page: itself when it has 3:1 against white (a bar, a band), and otherwise darkened
 * step by step until it has. `ink` is the text colour for words on it (4.5:1 or better: one of white and near-black always is).
 * @param {string | null | undefined} primary
 */
export function printColours(primary) {
  let accent = '#0F172A';
  try { accent = compositeOver(/** @type {string} */ (primary), 1, '#FFFFFF'); } catch { /* not a colour: the default ink */ }
  const chosen = accent;
  for (let step = 1; contrastRatio(accent, '#FFFFFF') < MIN_GRAPHIC_CONTRAST && step <= 50; step += 1) accent = compositeOver('#000000', step / 50, chosen);
  const ink = contrastRatio('#FFFFFF', accent) >= MIN_TEXT_CONTRAST ? '#FFFFFF' : '#111111';
  return { accent, ink, adjusted: accent !== chosen };
}

/** Dates and times in one zone (the browser's, unless a test names one). @param {string | undefined} timeZone @param {string} locale */
function clock(timeZone, locale) {
  const make = (options) => new Intl.DateTimeFormat(locale, { timeZone, ...options });
  const when = (value) => { const date = new Date(/** @type {any} */ (value)); return value && !Number.isNaN(date.getTime()) ? date : null; };
  const time = make({ hour: 'numeric', minute: '2-digit' });
  const stamp = make({ year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const digits = make({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const calendar = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
  return {
    time: (value) => { const date = when(value); return date ? time.format(date) : ''; },
    stamp: (value) => { const date = when(value); return date ? stamp.format(date) : ''; },
    /** "2026-10-11 14:05:09", which a spreadsheet reads as a date and time. */
    sortable: (value) => {
      const date = when(value);
      if (!date) return '';
      const part = Object.fromEntries(digits.formatToParts(date).map(({ type, value: text }) => [type, text]));
      return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}:${part.second}`;
    },
    /** A session's own date ("2026-10-11") is a day on the calendar, whatever the zone. */
    day: (value) => { const date = when(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T12:00:00Z` : null); return date ? calendar.format(date) : words(String(value ?? '')); },
  };
}

// ---- Who took part --------------------------------------------------------------------------------------------------------------------

// The rule that names a participant is lib/participant-names.js, shared with Admin → Results so that the screen, the PDF and the CSV give
// the same session the same names in the same order. It is re-exported under the name this file always had.
export { nameParticipants as reportParticipants } from './participant-names.js';

// ---- Questions and answers ---------------------------------------------------------------------------------------------------------

const KNOWN_TYPES = new Set(['single-select', 'true-false', 'multi-select', 'confidence-continuum', 'ranked-voting', 'open-text-feedback']);

/** @param {{ type: string, options: Row[] }} question @returns {Kind} */
export function kindOf(question) {
  if (question.type === 'open-text-feedback' || (!KNOWN_TYPES.has(question.type) && question.options.length === 0)) return 'text';
  if (question.type === 'ranked-voting') return 'ranking';
  if (question.type === 'multi-select') return 'multi';
  if (question.type === 'confidence-continuum') return 'scale';
  return isGraded(/** @type {any} */ (question)) ? 'graded' : 'choice';
}

const optionOf = (question, id) => (typeof id === 'string' ? question.options.find((option) => option.id === id) : undefined);
const labelOf = (question, id) => words(optionOf(question, id)?.label) || REMOVED_OPTION;

/** Was this pick right? By the option as it is marked now; for an option that has since been removed, by what was recorded then. */
function isRight(question, id, record) {
  const option = optionOf(question, id);
  return option ? option.correct === true : record.first === id && record.stored === true;
}

/** A graded answer is final once it is right, the tries are used up, or it has no history to say otherwise. */
const isFinal = (question, record) => isRecordSettled({ correct: record.stored, attempts: record.attempts ?? MAX_WRONG_TRIES }) || isRight(question, record.final, record);

/** The places on a confidence scale: each option's own number, or 1, 2, 3 ... when the options do not all carry one. */
function scaleValues(question) {
  const own = question.options.map((option) => (option.value === null || option.value === '' ? NaN : Number(option.value)));
  return new Map(question.options.map((option, index) => [option.id, own.every(Number.isFinite) ? own[index] : index + 1]));
}

/** An answer in words, with nothing that is an id. @param {any} question @param {Kind} kind @param {unknown} value */
function answerText(question, kind, value) {
  if (kind === 'text') return String(value ?? '');
  if (kind === 'ranking') return list(value).map((id, index) => `${index + 1}. ${labelOf(question, id)}`).join('  ');
  if (kind === 'multi') return list(value).map((id) => labelOf(question, id)).join('; ');
  if (kind === 'scale') {
    const values = scaleValues(question);
    return optionOf(question, value) ? `${labelOf(question, value)} (${values.get(/** @type {string} */ (value))} of ${Math.max(...values.values())})` : REMOVED_OPTION;
  }
  return labelOf(question, value);
}

/** Everything the report says about one question, from the records of the people who answered it. */
function questionResults(question, kind, given) {
  const respondents = given.length;
  const rows = question.options.map((option) => ({ id: option.id, label: words(option.label), correct: kind === 'graded' && option.correct === true, count: 0, percent: 0 }));
  const rowOf = new Map(rows.map((row) => [row.id, row]));
  const notes = [];
  let removed = 0;
  // What is counted: the first pick of a graded question, the answer of every other kind (each option of a list once).
  for (const { record } of given) {
    for (const id of kind === 'graded' ? [record.first] : [...new Set(list(record.counted))]) {
      if (rowOf.has(id)) rowOf.get(id).count += 1;
      else if (kind !== 'text') removed += 1;
    }
  }
  for (const row of rows) row.percent = share(row.count, respondents);
  if (removed > 0) notes.push(`${plural(removed, 'answer')} chose ${removed === 1 ? REMOVED_OPTION : 'answer options that were later removed'}.`);
  const result = { respondents, options: rows, removed, notes, firstTry: null, commonWrong: null, retries: null, average: null, ranking: null };

  if (kind === 'graded') {
    const right = given.filter(({ record }) => isRight(question, record.first, record)).length;
    result.firstTry = { right, answered: respondents, percent: share(right, respondents) };
    // The wrong answer most people gave first; with a tie, the one that comes first among the options.
    const wrong = rows.filter((row) => !row.correct && row.count > 0).sort((a, b) => b.count - a.count)[0];
    if (wrong) result.commonWrong = { label: wrong.label, count: wrong.count };
    const missed = given.filter(({ record }) => !isRight(question, record.first, record));
    const later = missed.filter(({ record }) => isRight(question, record.final, record)).length;
    const open = missed.filter(({ record }) => !isFinal(question, record)).length;
    if (missed.length > 0) result.retries = { later, shown: missed.length - later - open, open };
    const changed = given.filter(({ record }) => typeof record.stored === 'boolean' && optionOf(question, record.first) && record.stored !== (optionOf(question, record.first).correct === true)).length;
    if (changed > 0) notes.push(`The correct answer was changed after ${plural(changed, 'person', 'people')} answered. This report uses the answer that is marked correct now.`);
  }
  if (kind === 'multi') notes.push('People could choose more than one answer, so the percentages can add up to more than 100%.');
  if (kind === 'scale') {
    const values = scaleValues(question);
    const chosen = given.map(({ record }) => values.get(/** @type {string} */ (record.counted))).filter((value) => value !== undefined);
    if (chosen.length > 0) {
      const places = [...values.values()];
      result.average = { value: chosen.reduce((sum, value) => sum + value, 0) / chosen.length, min: Math.min(...places), max: Math.max(...places), answers: chosen.length };
    }
  }
  if (kind === 'ranking') {
    // Borda points: with n options a first place earns n, the next n - 1, and so on. The places are among the options the question
    // has now: one that was removed after people answered no longer holds a place, so the rest keep their order (Phase 9a).
    const size = question.options.length;
    const ranked = rows.map((row, order) => {
      const places = given.map(({ record }) => list(record.counted).filter((id) => rowOf.has(id)).indexOf(row.id) + 1).filter((place) => place > 0);
      return { label: row.label, order, score: places.reduce((sum, place) => sum + (size - place + 1), 0), firsts: places.filter((place) => place === 1).length, averagePlace: places.length ? places.reduce((sum, place) => sum + place, 0) / places.length : null };
    });
    const points = ranked.reduce((sum, row) => sum + row.score, 0);
    result.ranking = ranked.map((row) => ({ ...row, percent: share(row.score, points) }))
      .sort((a, b) => b.score - a.score || (a.averagePlace ?? Infinity) - (b.averagePlace ?? Infinity) || a.order - b.order);
  }
  return result;
}

/**
 * How the Live display shows this question (Phase 11b): the chart model (lib/results-chart-model.js) handed the counts worked out above, so the
 * report's bars, headline and "N of M got it right first time" are the screen's words over this report's own numbers. A graded question's answer
 * is the first pick (what the bars count); nobody is named. Nothing here is counted again.
 */
function chartOfQuestion(question, counted, given) {
  const graded = question.kind === 'graded';
  const points = new Map((counted.ranking ?? []).map((row) => [row.order, row.score]));
  // An option's value as the chart needs it, and the same from either storage (a list holds it as text, the local server as it was written):
  // a scale's place is the one this report averages (scaleValues), a true-or-false side says which is true, and nothing else needs one.
  const places = question.kind === 'scale' ? scaleValues(question) : null;
  const valueOf = (option) => {
    if (places) return places.get(option.id);
    if (question.type === 'true-false') return option.value === true || String(option.value).toLowerCase() === 'true';
    return undefined;
  };
  return chartOf({
    id: String(question.id),
    type: question.kind === 'text' ? 'open-text-feedback' : question.type,
    prompt: words(question.prompt) || 'Untitled question',
    respondents: counted.respondents,
    options: question.options.map((option, index) => ({
      id: option.id, label: words(option.label), value: valueOf(option), correct: graded ? option.correct === true : null, count: counted.options[index].count,
      ...(question.kind === 'ranking' ? { score: points.get(index) ?? 0 } : {}),
    })),
    // (No times: the report prints none of the chart's comments, which keep the order of the people, and a report reads the same whenever it is made.)
    responses: given.map(({ person, record }) => ({ questionId: String(question.id), clientTrackId: person.key, answer: graded ? record.first : record.counted })),
  }, { names: null });
}

/** One person's answer to one question, as their page and the CSV show it. */
function answerRow(question, kind, record) {
  if (!record) return { answered: false, first: '', final: '', said: '', verdict: null, firstRight: null, finalRight: null, attempts: 0, at: null, open: false };
  const graded = kind === 'graded';
  const firstRight = graded ? isRight(question, record.first, record) : null;
  const finalRight = graded ? isRight(question, record.final, record) : null;
  const open = graded && !isFinal(question, record);
  const first = answerText(question, kind, graded ? record.first : record.counted);
  const final = answerText(question, kind, graded ? record.final : record.counted);
  // What their page says: the first answer and whether it was right, then what became of a wrong one.
  let said = first;
  if (graded && firstRight) said = `${first} (right first time)`;
  else if (graded && open) said = `${first} (wrong), did not try again`;
  else if (graded && record.attempts !== null && record.attempts > 1) said = !finalRight && first === final ? `${first} (wrong twice; answer shown)` : `${first} (wrong), then ${final} (${finalRight ? 'right' : 'wrong; answer shown'})`;
  else if (graded) said = `${first} (wrong)`;
  return { answered: true, first, final, said, verdict: graded ? (firstRight ? 'right' : 'wrong') : null, firstRight, finalRight, attempts: record.attempts, at: record.at, open };
}

// An id, as this app makes them (a UUID, or words joined by hyphens, underscores or tildes): what a stored answer is when its
// question was a choice. Anything else that was typed is a written answer and is shown as it is.
const LOOKS_LIKE_ID = /^[A-Za-z0-9]+(?:[-_~.:][A-Za-z0-9]+)+$/;

// ---- The report -----------------------------------------------------------------------------------------------------------------------

/**
 * The whole report as data.
 * @param {ReportRecords} records
 * @param {{ generatedAt?: Date | string | number, timeZone?: string, locale?: string }} [options]
 */
export function buildLeaderReport(records, { generatedAt = new Date(), timeZone, locale = 'en-US' } = {}) {
  const { session, client = null, sections = [], questions = [], options = [], answers = [], strayQuestions = [], strayOptions = [], unreadable = [] } = records;
  const at = clock(timeZone, locale);
  const people = nameParticipants(records);

  // One record per person and question. `counted` is the answer the tallies have always used (the first try of a graded question).
  /** @type {Map<string, Map<string, { counted: unknown, first: unknown, final: unknown, attempts: number | null, stored: boolean | null, at: string | null }>>} */
  const held = new Map(people.map((person) => [person.key, new Map()]));
  let unattributed = 0;
  for (const answer of answers) {
    const owner = ownerOf(answer);
    if (owner === null) { unattributed += 1; continue; }
    held.get(owner)?.set(String(answer.questionId), {
      counted: answer.answer, first: answer.firstAnswer === undefined ? answer.answer : answer.firstAnswer, final: answer.finalAnswer === undefined ? answer.answer : answer.finalAnswer,
      attempts: Number.isInteger(answer.attempts) ? /** @type {number} */ (answer.attempts) : null, stored: typeof answer.correct === 'boolean' ? answer.correct : null, at: answer.timestamp ?? null,
    });
  }
  const answeredIds = new Set([...held.values()].flatMap((mine) => [...mine.keys()]));

  // The activities: the session's own, in its order, when switched on, or switched off but holding answers.
  const sectionIndex = byId(sections);
  const questionIndex = byId(questions);
  const optionIndex = byId(options);
  const shape = (question, index) => {
    const own = list(question.optionIds).map((id) => index.get(String(id))).filter(Boolean);
    const whole = { ...question, options: own };
    return { ...whole, kind: kindOf(whole) };
  };
  let number = 0;
  const activities = [];
  for (const id of list(session.sectionIds)) {
    const section = sectionIndex.get(String(id));
    if (!section) continue;
    const own = list(section.questionIds).map((questionId) => questionIndex.get(String(questionId))).filter(Boolean);
    const on = section.enabled === true;
    if (!on && !own.some((question) => answeredIds.has(String(question.id)))) continue;
    activities.push({
      id: String(section.id), title: words(section.title) || 'Untitled activity', description: words(section.description), off: !on,
      questions: own.map((question) => ({ ...shape(question, optionIndex), number: number += 1 })),
    });
  }
  const placed = new Set(activities.flatMap((activity) => activity.questions.map((question) => String(question.id))));
  const allQuestions = activities.flatMap((activity) => activity.questions);

  // Answer items that could not be read (Phase 9b): the people they belong to are marked, and the cover says so in bold.
  const unreadableIds = new Set(unreadable.map((entry) => String(entry.id)));

  // Each person: their answers, what they finished, their first-try score.
  const participants = people.map((person) => {
    const mine = /** @type {Map<string, any>} */ (held.get(person.key));
    let answered = 0;
    let gradedAnswered = 0;
    let gradedRight = 0;
    const own = activities.map((activity) => {
      const rows = activity.questions.map((question) => {
        const row = answerRow(question, question.kind, mine.get(String(question.id)));
        if (row.answered) answered += 1;
        if (row.answered && question.kind === 'graded') { gradedAnswered += 1; if (row.firstRight) gradedRight += 1; }
        return { number: question.number, questionId: String(question.id), prompt: words(question.prompt), kind: question.kind, ...row };
      });
      const given = rows.filter((row) => row.answered).length;
      const final = rows.filter((row) => row.answered && !row.open).length;
      return { id: activity.id, title: activity.title, off: activity.off, rows, status: rows.length > 0 && final === rows.length ? 'finished' : given > 0 ? 'started' : 'not-started' };
    });
    const required = own.filter((activity) => !activity.off && activity.rows.length > 0);
    const track = person.track;
    const restartedFrom = track?.restartedAt ? (track.restartSectionId ? words(sectionIndex.get(String(track.restartSectionId))?.title) : '') : '';
    return {
      key: person.key, name: person.name, unnamed: person.unnamed, unreadable: unreadableIds.has(person.key),
      joined: track?.createdAt ? `Joined at ${at.time(track.createdAt)}${track.joinedVia === 'qr' ? ' with a QR code' : ''}` : 'Their visit record no longer exists',
      restart: track?.restartedAt
        ? `Restarted by the facilitator at ${at.time(track.restartedAt)}, ${track.restartSectionId ? `from ${restartedFrom ? `“${restartedFrom}”` : 'an activity that has since been deleted'}` : 'from the beginning'}. Answers given before that were removed then and are not in this report.`
        : '',
      answered, questionCount: allQuestions.length, gradedAnswered, gradedRight,
      scorePercent: gradedAnswered > 0 ? share(gradedRight, gradedAnswered) : null,
      activities: own, activitiesFinished: required.filter((activity) => activity.status === 'finished').length, activityCount: required.length,
      finishedAll: required.length > 0 && required.every((activity) => activity.status === 'finished'),
      strays: 0,
    };
  });
  const personOf = new Map(participants.map((person) => [person.key, person]));
  const unreadableNames = new Map(participants.map((person) => [person.key, person.name]));
  const unreadableText = unreadableNotice(unreadable, unreadableNames);

  // Each question: the tally, and for written answers every comment with its author.
  const results = activities.map((activity) => {
    const mine = participants.map((person) => person.activities.find((own) => own.id === activity.id));
    return {
      id: activity.id, title: activity.title, description: activity.description, off: activity.off,
      finished: mine.filter((own) => own?.status === 'finished').length, started: mine.filter((own) => own?.status === 'started').length,
      questions: activity.questions.map((question) => {
        const given = people.flatMap((person) => { const record = held.get(person.key)?.get(String(question.id)); return record ? [{ person: /** @type {any} */ (personOf.get(person.key)), record }] : []; });
        const counted = questionResults(question, question.kind, given);
        return {
          number: question.number, id: String(question.id), prompt: words(question.prompt) || 'Untitled question', kind: question.kind, kindLabel: question.type === 'true-false' ? `True or false${question.kind === 'graded' ? '' : ' (poll)'}` : KIND_LABEL[question.kind],
          ...counted,
          comments: question.kind === 'text' ? given.map(({ person, record }) => ({ name: person.name, text: String(record.counted ?? '') })) : [],
          chart: chartOfQuestion(question, counted, given),
        };
      }),
    };
  });

  // Each activity's takeaway and scoreboard (Phase 13), from the charts above: the sentences the Live display's files print for the same counts.
  for (const activity of results) activity.summary = summarizeActivity({ id: activity.id, title: activity.title, description: activity.description, off: activity.off, charts: activity.questions.map((question) => question.chart) });

  // Answers to questions that are in none of those activities: listed, and counted nowhere.
  const strayIndex = byId(strayQuestions);
  const strayOptionIndex = byId(strayOptions);
  /** @type {Map<string, { title: string, known: boolean, entries: { name: string, text: string }[] }>} */
  const strays = new Map();
  let deleted = 0;
  for (const person of people) {
    for (const [questionId, record] of /** @type {Map<string, any>} */ (held.get(person.key))) {
      if (placed.has(questionId)) continue;
      const found = strayIndex.get(questionId) ?? questionIndex.get(questionId);
      if (!strays.has(questionId)) strays.set(questionId, { title: found ? words(found.prompt) || 'Untitled question' : `Deleted question ${deleted += 1} (its wording is no longer stored)`, known: Boolean(found), entries: [] });
      let text;
      if (found) { const question = shape(found, strayOptionIndex.size ? strayOptionIndex : optionIndex); text = answerText(question, question.kind, record.counted); }
      else text = typeof record.counted === 'string' && !LOOKS_LIKE_ID.test(record.counted.trim()) ? record.counted : UNREADABLE;
      /** @type {any} */ (strays.get(questionId)).entries.push({ name: /** @type {any} */ (personOf.get(person.key)).name, text });
      /** @type {any} */ (personOf.get(person.key)).strays += 1;
    }
  }

  // The summary.
  // (Only activities that are switched on are compared: one stray answer to a switched-off question is not "the hardest".)
  const graded = results.filter((activity) => !activity.off).flatMap((activity) => activity.questions.map((question) => ({ ...question, activity: activity.title })))
    .filter((question) => question.firstTry && question.firstTry.answered > 0);
  const highlight = (question) => (question ? { number: question.number, prompt: question.prompt, activity: question.activity, right: question.firstTry.right, answered: question.firstTry.answered, percent: question.firstTry.percent } : null);
  // Hardest: the lowest share right first time; easiest: the highest. A tie goes to the question more people answered, then the earlier one.
  const ranked = (direction) => [...graded].sort((a, b) => direction * (a.firstTry.percent - b.firstTry.percent) || b.firstTry.answered - a.firstTry.answered || a.number - b.number)[0];
  const flat = graded.length > 0 && graded.every((question) => question.firstTry.percent === graded[0].firstTry.percent);
  const scored = participants.filter((person) => person.scorePercent !== null);
  const comments = results.flatMap((activity) => activity.questions.filter((question) => question.kind === 'text').map((question) => ({ activity: activity.title, number: question.number, prompt: question.prompt, entries: question.comments })));
  const theme = resolveClientTheme(client);
  const clientName = words(client?.name) || 'Client';
  const restarted = participants.filter((person) => person.restart).length;
  const notes = [];
  if (restarted > 0) notes.push(`${plural(restarted, 'participant was', 'participants were')} restarted by the facilitator during the session.`);
  if (results.some((activity) => activity.off)) notes.push('An activity that is switched off now but holds answers is included, marked “switched off”. It is not needed to count as finished.');
  if (unreadableText) notes.push(unreadableText);
  if (unattributed > 0) notes.push(`${plural(unattributed, 'answer')} recorded without a participant, by an older version of the app, ${unattributed === 1 ? 'is' : 'are'} not in this report.`);

  return {
    meta: {
      clientName, eventTitle: theme.copy.eventTitle, sessionId: String(session.id), date: words(session.date), dateText: at.day(session.date),
      ended: session.status === 'completed',
      unreadableNotice: unreadableText,
      // A sample client's cover says so until somebody confirms the content with the client team (Phase 9b, SAM-2).
      sampleNotice: needsConfirmation(client) ? SAMPLE_REPORT_LINE : '',
      status: session.status === 'completed' ? `Ended${session.endedAt ? ` ${at.stamp(session.endedAt)}` : ''}` : 'Not ended when this report was made, so answers may still arrive',
      generated: at.stamp(generatedAt), generatedIso: new Date(/** @type {any} */ (generatedAt)).toISOString(),
    },
    brand: { ...printColours(masterColours(client).primaryColor), logoUrl: theme.assets.logo, plate: theme.plate },
    rules: COUNTING_RULES, notes,
    summary: {
      // (Somebody whose saved answers could not be read has not "answered nothing": nobody knows what they answered.)
      joined: participants.length, answeredSomething: participants.filter((person) => person.answered > 0 || person.strays > 0).length,
      answers: results.reduce((sum, activity) => sum + activity.questions.reduce((all, question) => all + question.respondents, 0), 0),
      finishedAll: participants.filter((person) => person.finishedAll).length, answeredNothing: participants.filter((person) => person.answered === 0 && person.strays === 0 && !person.unreadable).length,
      scored: scored.length, averageScore: scored.length > 0 ? scored.reduce((sum, person) => sum + /** @type {number} */ (person.scorePercent), 0) / scored.length : null,
      questionCount: allQuestions.length, gradedCount: allQuestions.filter((question) => question.kind === 'graded').length, commentCount: comments.reduce((sum, question) => sum + question.entries.length, 0),
      activities: results.map((activity) => ({ title: activity.title, off: activity.off, questions: activity.questions.length, finished: activity.finished, started: activity.started, notStarted: participants.length - activity.finished - activity.started })),
      hardest: flat ? null : highlight(ranked(1)), easiest: flat ? null : highlight(ranked(-1)),
      flat: flat ? { percent: graded[0].firstTry.percent, questions: graded.length } : null,
    },
    activities: results, comments, participants, strays: [...strays.values()],
    // (No `reason`: SharePoint can tell invalid JSON from "not a list" and the local server cannot, and a report must read the same from both.)
    unreadable: unreadable.map((entry) => ({ id: String(entry.id), name: unreadableNames.get(String(entry.id)) ?? null })),
    at,
  };
}

/** @typedef {ReturnType<typeof buildLeaderReport>} LeaderReport */

/** "7 of 9 right first time (78%)", or what to say when nothing was graded. @param {LeaderReport['participants'][number]} person */
export const scoreLine = (person) => (person.scorePercent === null
  ? 'No graded question answered'
  : `${person.gradedRight} of ${person.gradedAnswered} right first time (${wholePercent(person.scorePercent)})`);

/** "7 of 15 answered". @param {LeaderReport['participants'][number]} person */
export const answeredLine = (person) => `${person.answered} of ${person.questionCount} answered`;

// ---- The participant CSV ----------------------------------------------------------------------------------------------------------------

/** The byte-order mark that makes a spreadsheet read the file as UTF-8. Written as a number: the character itself does not show in an editor. */
const BOM = String.fromCharCode(0xFEFF);

export const CSV_COLUMNS = Object.freeze(['Client', 'Date', 'Participant', 'Activity', 'Question', 'First answer', 'Final answer', 'Correct', 'Correct on first try', 'Attempts', 'Answered at']);

// White space a spreadsheet ignores in front of a formula's sign: what \s matches, and the zero-width space (written as a number:
// the character itself does not show in an editor).
const BLANK = `[\\s${String.fromCharCode(0x200B)}]*`;
const FORMULA_AT_START = new RegExp(`^${BLANK}[=+\\-@]|^[\\t\\r]`);
const FORMULA_AFTER_SPLIT = new RegExp(`([;\\t])(?=${BLANK}[=+\\-@])`, 'g');

/**
 * One CSV cell. Text that would start a formula in a spreadsheet (= + - @, or a tab or carriage return) gets a leading
 * apostrophe, because names and comments come from the audience; a number stays a number. White space in front of the sign does
 * not get it through, and neither does a semicolon or a tab inside the text (a spreadsheet set to split on those would begin a new
 * cell there, whatever this file's own commas and quotes say): the sign after one gets the apostrophe too.
 * @param {unknown} value
 */
export function csvCell(value) {
  if (typeof value === 'number') return String(value);
  let text = String(value ?? '').replace(FORMULA_AFTER_SPLIT, "$1'");
  if (FORMULA_AT_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * One row for each participant and question (an unanswered question is a row with no answer and 0 attempts, so someone who
 * joined and answered nothing is still in the file), then the answers to questions no longer in an activity.
 * @param {LeaderReport} report
 */
export function participantAnswersRows(report) {
  const yes = (value) => (value === null ? '' : value ? 'Yes' : 'No');
  const head = [report.meta.clientName, report.meta.date];
  const rows = [];
  for (const person of report.participants) {
    for (const activity of person.activities) {
      for (const row of activity.rows) {
        rows.push([...head, person.name, activity.title, row.prompt, row.first, row.final, row.answered ? yes(row.finalRight) : '', row.answered ? yes(row.firstRight) : '', row.attempts ?? '', report.at.sortable(row.at)]);
      }
    }
  }
  for (const stray of report.strays) {
    for (const entry of stray.entries) rows.push([...head, entry.name, `(${STRAY_TITLE})`, stray.title, entry.text, entry.text, '', '', '', '']);
  }
  return rows;
}

/** The file's text: a byte-order mark (so a spreadsheet reads accented names as UTF-8), a header row, CRLF line ends. @param {LeaderReport} report */
export const participantAnswersCsv = (report) => `${BOM}${[CSV_COLUMNS, ...participantAnswersRows(report)].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** "leader-report-kroger-2026-10-11-2026-10-12.pdf": like exportFileName() in resultsExport.js, safe on every OS. */
export function reportFileName(prefix, sessionId, extension, now = new Date()) {
  return `${prefix}-${String(sessionId).replace(/[^\w-]+/g, '-')}-${new Date(now).toISOString().slice(0, 10)}.${extension}`;
}
