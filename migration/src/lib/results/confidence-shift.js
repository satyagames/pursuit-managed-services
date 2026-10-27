// The confidence check's arithmetic (Phase 20): the one place its numbers are worked out. Results, the Live display, the exports and the
// leader report show what this gives and never count again. Plain JS with JSDoc, no DOM and no I/O; scripts/test-confidence-check.js holds
// it to cases worked out by hand and to properties, and scripts/oracle-results.js recounts it by rules of its own.
//
// The rules (docs/RULES.md, "The confidence check"), over the guests who gave BOTH answers ("paired"):
//   Confidence shift (percent)  = (mean of their After - mean of their Before) / shiftDivisor(scaleMax) * 100
//   Moved to confident          = of the paired guests whose Before was not confident (<= notConfidentMax), the share whose After is
//                                 confident (>= confidentMin)
//   Confidence index            = mean After of a group / mean After of the baseline * 100 (the dashboard's; a function only)
// A guest with only a Before counts in the Before totals and nowhere in a shift. `scaleMax` is the check question's highest OptionValue,
// so a 3-point question works as well as a 5-point one. A score is the OptionValue of the option a record names.

/**
 * The fewest paired guests a dashboard shows a shift or an index for; below it, "Low sample". ASSUMED: 10, until the setting exists (the
 * prompt allows no new pms-config.txt key, so it is a constant here). A single session's Results show the shift whatever its size, with
 * how many guests answered both.
 */
export const MIN_SAMPLE = 10;

/**
 * What the shift is divided by: the top of the scale (decision 2), so 1 point on 5 is 20%. ASSUMED until the manager decides: dividing by
 * `scaleMax - 1`, the largest possible move, would let a full 1-to-5 move read 100%. Changing that is this one line.
 * @param {number} scaleMax
 */
export const shiftDivisor = (scaleMax) => scaleMax;

/** The highest "not confident" score: 2 on a 5-point scale, 1 on a 3-point one (40% of the top, rounded down). @param {number} scaleMax */
export const notConfidentMax = (scaleMax) => Math.floor(0.4 * scaleMax + 1e-9);

/** The lowest "confident" score: 4 on a 5-point scale, 3 on a 3-point one (80% of the top, rounded up). @param {number} scaleMax */
export const confidentMin = (scaleMax) => Math.ceil(0.8 * scaleMax - 1e-9);

/**
 * The top of the check question's scale: its options' highest whole OptionValue, or null when none is a number.
 * @param {{ value?: unknown }[] | null | undefined} options
 */
export function scaleMaxOf(options) {
  const values = (options ?? []).map((option) => Number(option?.value)).filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

/** Fewer paired guests than the minimum? @param {{ n: number, min?: number }} input */
export const lowSample = ({ n, min = MIN_SAMPLE }) => n < min;

const mean = (/** @type {number[]} */ values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

/**
 * @typedef {object} Paired
 * @property {{ trackId: string, before: number, after: number }[]} pairs The guests who gave both, with their scores.
 * @property {number[]} before Every Before score (paired or not).
 * @property {number[]} after Every After score (paired or not).
 * @property {number} answeredBoth
 * @property {number} answeredBeforeOnly
 * @property {number} answeredAfterOnly
 */

/**
 * The check's answers of a session, guest by guest. `answers` are the session's answers as the results read them (each with its
 * `clientTrackId`); only the records `<questionId>@before` and `<questionId>@after` are looked at, and a record whose answer is not one
 * of the question's options is not a score.
 * @param {{ questionId: string, clientTrackId?: string | null, answer: unknown }[]} answers
 * @param {{ questionId: string, scoreOf: (answer: unknown) => number | null }} how
 * @returns {Paired}
 */
export function pairCheckAnswers(answers, { questionId, scoreOf }) {
  /** @type {Map<string, { before: number | null, after: number | null }>} */
  const guests = new Map();
  const ids = { [`${questionId}@before`]: 'before', [`${questionId}@after`]: 'after' };
  for (const answer of answers ?? []) {
    const phase = /** @type {'before' | 'after' | undefined} */ (ids[answer?.questionId]);
    if (!phase || !answer.clientTrackId) continue;
    const score = scoreOf(answer.answer);
    if (score === null || !Number.isFinite(score)) continue;
    const guest = guests.get(answer.clientTrackId) ?? { before: null, after: null };
    guest[phase] = score;
    guests.set(answer.clientTrackId, guest);
  }
  const rows = [...guests.entries()];
  const pairs = rows.filter(([, guest]) => guest.before !== null && guest.after !== null)
    .map(([trackId, guest]) => ({ trackId, before: /** @type {number} */ (guest.before), after: /** @type {number} */ (guest.after) }));
  return {
    pairs,
    before: rows.flatMap(([, guest]) => (guest.before === null ? [] : [guest.before])),
    after: rows.flatMap(([, guest]) => (guest.after === null ? [] : [guest.after])),
    answeredBoth: pairs.length,
    answeredBeforeOnly: rows.filter(([, guest]) => guest.before !== null && guest.after === null).length,
    answeredAfterOnly: rows.filter(([, guest]) => guest.before === null && guest.after !== null).length,
  };
}

/**
 * A score from an answer: the OptionValue of the option it names, or null for anything else.
 * @param {{ id: string, value?: unknown }[]} options
 * @returns {(answer: unknown) => number | null}
 */
export function scorerOf(options) {
  const values = new Map((options ?? []).map((option) => [String(option.id), Number(option.value)]));
  return (answer) => { const value = values.get(String(answer)); return value === undefined || !Number.isFinite(value) ? null : value; };
}

/**
 * Each guest's two scores (null where an answer is missing), by visit id: what the participant CSV prints beside each guest's rows.
 * @param {{ question: { id: string } | null, options: { id: string, value?: unknown }[], answers: { questionId: string, clientTrackId?: string | null, answer: unknown }[] }} input
 * @returns {Map<string, { before: number | null, after: number | null }>}
 */
export function checkScoresByGuest({ question, options, answers }) {
  const scores = new Map();
  if (!question) return scores;
  const scoreOf = scorerOf(options);
  const phases = { [`${question.id}@before`]: 'before', [`${question.id}@after`]: 'after' };
  for (const answer of answers ?? []) {
    const phase = phases[answer?.questionId];
    const score = phase && answer.clientTrackId ? scoreOf(answer.answer) : null;
    if (score === null) continue;
    const guest = scores.get(answer.clientTrackId) ?? { before: null, after: null };
    guest[phase] = score;
    scores.set(answer.clientTrackId, guest);
  }
  return scores;
}

/**
 * The confidence shift over the paired guests: their means, the move in points and as a percent of the scale; null with nobody paired or
 * no scale.
 * @param {{ pairs: { before: number, after: number }[], scaleMax: number | null }} input
 * @returns {{ n: number, beforeMean: number, afterMean: number, points: number, percent: number } | null}
 */
export function confidenceShift({ pairs, scaleMax }) {
  if (!pairs.length || !Number.isFinite(scaleMax) || /** @type {number} */ (scaleMax) <= 0) return null;
  const beforeMean = /** @type {number} */ (mean(pairs.map((pair) => pair.before)));
  const afterMean = /** @type {number} */ (mean(pairs.map((pair) => pair.after)));
  const points = afterMean - beforeMean;
  return { n: pairs.length, beforeMean, afterMean, points, percent: (points * 100) / shiftDivisor(/** @type {number} */ (scaleMax)) };
}

/**
 * Moved to confident: of the paired guests who started not confident, how many ended confident. `percent` is null when nobody started
 * not confident.
 * @param {{ pairs: { before: number, after: number }[], scaleMax: number | null }} input
 * @returns {{ started: number, moved: number, percent: number | null }}
 */
export function movedToConfident({ pairs, scaleMax }) {
  if (!Number.isFinite(scaleMax)) return { started: 0, moved: 0, percent: null };
  const low = notConfidentMax(/** @type {number} */ (scaleMax));
  const high = confidentMin(/** @type {number} */ (scaleMax));
  const started = pairs.filter((pair) => pair.before <= low);
  const moved = started.filter((pair) => pair.after >= high).length;
  return { started: started.length, moved, percent: started.length ? (moved * 100) / started.length : null };
}

/**
 * How many Befores and Afters sit on each step of the scale, 1 to scaleMax, and each as a share of its own answers: the "Before and After"
 * bars. Every answer counts here, paired or not.
 * @param {{ before: number[], after: number[], scaleMax: number | null }} input
 */
export function distributionBeforeAfter({ before, after, scaleMax }) {
  if (!Number.isFinite(scaleMax) || /** @type {number} */ (scaleMax) < 1) return [];
  return Array.from({ length: Math.floor(/** @type {number} */ (scaleMax)) }, (_, at) => {
    const value = at + 1;
    const inBefore = before.filter((score) => score === value).length;
    const inAfter = after.filter((score) => score === value).length;
    return {
      value, before: inBefore, after: inAfter,
      beforePercent: before.length ? (inBefore / before.length) * 100 : 0,
      afterPercent: after.length ? (inAfter / after.length) * 100 : 0,
    };
  });
}

/**
 * The confidence index of a group (decision 4): its mean After over the baseline's mean After, times 100. Null without both.
 * @param {{ afterMean: number | null, baselineMean: number | null }} input
 */
export const confidenceIndex = ({ afterMean, baselineMean }) => (
  Number.isFinite(afterMean) && Number.isFinite(baselineMean) && /** @type {number} */ (baselineMean) > 0
    ? (/** @type {number} */ (afterMean) / /** @type {number} */ (baselineMean)) * 100 : null);

/**
 * A session's check, as its results carry it (results-tally.js buildResults, `confidenceCheck`). `measured` is false when the session has
 * the check switched off: then there is no shift and nothing moved ("not measured").
 * @param {{ session: { confidenceCheck?: boolean | null }, section: { id: string }, question: { id: string, prompt?: string } | null, options: { id: string, label?: string, value?: unknown }[], tracks: unknown[], answers: { questionId: string, clientTrackId?: string | null, answer: unknown }[], minSample?: number }} input
 */
export function confidenceCheckResults({ session, section, question, options, tracks, answers, minSample = MIN_SAMPLE }) {
  const measured = session?.confidenceCheck === true && Boolean(question);
  const scaleMax = scaleMaxOf(options);
  const scoreOf = scorerOf(options);
  const paired = question ? pairCheckAnswers(answers, { questionId: question.id, scoreOf }) : pairCheckAnswers([], { questionId: '', scoreOf });
  return {
    measured,
    sectionId: section.id,
    questionId: question?.id ?? null,
    prompt: question?.prompt ?? '',
    scaleMax,
    labels: [...options].sort((left, right) => Number(left.value) - Number(right.value)).map((option) => option.label ?? ''),
    guests: tracks.length,
    answeredBefore: paired.before.length,
    answeredAfter: paired.after.length,
    answeredBoth: paired.answeredBoth,
    answeredBeforeOnly: paired.answeredBeforeOnly,
    answeredAfterOnly: paired.answeredAfterOnly,
    shift: measured ? confidenceShift({ pairs: paired.pairs, scaleMax }) : null,
    moved: measured ? movedToConfident({ pairs: paired.pairs, scaleMax }) : { started: 0, moved: 0, percent: null },
    distribution: distributionBeforeAfter({ before: paired.before, after: paired.after, scaleMax }),
    minSample,
    lowSample: lowSample({ n: paired.answeredBoth, min: minSample }),
  };
}

/** @typedef {ReturnType<typeof confidenceCheckResults>} ConfidenceCheck */

const whole = (/** @type {number} */ value) => String(Math.round(value) || 0);

/**
 * "N of M guests answered both", beside every shift.
 * @param {{ answeredBoth: number, guests: number }} check
 */
export const answeredBothLine = (check) => `${check.answeredBoth} of ${check.guests} ${check.guests === 1 ? 'guest' : 'guests'} answered both`;

/**
 * The one line the leader report, the pack and the one-page PDF print: "Confidence moved 32% of the scale (2.0 to 3.6); 50% of guests who
 * started not confident ended confident (n = 3 of 4 guests)".
 * @param {Partial<ConfidenceCheck> | null | undefined} check
 */
export function confidenceLine(check) {
  if (!check?.measured) return 'Confidence check: not measured';
  const n = `(n = ${check.answeredBoth} of ${check.guests} guests)`;
  if (!check.shift) return `Confidence check: no guest answered both ${n}`;
  const moved = check.moved?.percent === null || check.moved?.percent === undefined
    ? 'no guest started not confident'
    : `${whole(check.moved.percent)}% of guests who started not confident ended confident`;
  return `Confidence moved ${whole(check.shift.percent)}% of the scale (${check.shift.beforeMean.toFixed(1)} to ${check.shift.afterMean.toFixed(1)}); ${moved} ${n}`;
}
