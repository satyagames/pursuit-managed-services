// The rules of the participant flow, with no DOM and no Svelte, so scripts/test-pager.js can
// exercise them with `node --test`. The screens (routes/ and pager/) only render what this says.
//
// Plain JS with JSDoc on purpose, like theme.js: node runs it directly and TypeScript still
// reads the types from the comments.

/** @typedef {{ id: string, label: string, correct?: boolean | null, imageUrl?: string | null }} Option */
/** @typedef {{ id: string, prompt: string, type: string, order?: number, layout?: string | null, options: Option[] }} Question */
/** @typedef {string | string[]} Answer */
/** @typedef {'choosing' | 'wrong' | 'correct' | 'revealed'} GradedPhase */
/** @typedef {{ phase: GradedPhase, attempts: number, firstAnswer: string | null, choice: string | null }} GradedState */
/** @typedef {'default' | 'selected' | 'correct' | 'incorrect' | 'disabled'} AnswerState */
/** @typedef {'default' | 'done' | 'locked'} ActivityState */

/** Wrong picks allowed on a graded question before the right answer is shown. */
export const MAX_WRONG_TRIES = 2;

/**
 * Open text is saved trimmed, and this long at most. All of a participant's answers share one
 * SharePoint text column (63,999 characters), so a written answer has to be bounded for the whole
 * record to fit; scripts/test-participant-storage.js proves the largest realistic record does.
 */
export const MAX_TEXT_LENGTH = 1000;

// ---- Question kinds --------------------------------------------------------------------------

/**
 * A graded question has one right answer the participant can discover: a single-answer type
 * whose options carry `correct` flags. Multi-select with flags stays ungraded (the flow only
 * grades single answers), and so does a question where no option is flagged correct.
 * @param {Question} question
 */
export function isGraded(question) {
  return (question.type === 'single-select' || question.type === 'true-false')
    && question.options.some((option) => option.correct === true);
}

const CHOICE_TYPES = ['single-select', 'multi-select', 'true-false'];

/**
 * How a question's answers are laid out: what its Layout says ('text-list' or 'image-grid'). A
 * question with no layout set is a list, unless it is a choice whose every answer has a picture,
 * which can only have been meant as tiles.
 * @param {Question} question
 * @returns {'text-list' | 'image-grid'}
 */
export function questionLayout(question) {
  if (question.layout === 'image-grid' || question.layout === 'text-list') return question.layout;
  const pictured = question.options.length > 0 && question.options.every((option) => typeof option.imageUrl === 'string' && option.imageUrl.trim() !== '');
  return pictured && CHOICE_TYPES.includes(question.type) ? 'image-grid' : 'text-list';
}

/** @param {Question} question */
export const isImageGrid = (question) => questionLayout(question) === 'image-grid';

/** Choice questions can be shown as a 2x2 grid of logo tiles; ranking and typing cannot. @param {Question} question */
export const usesTiles = (question) => isImageGrid(question) && CHOICE_TYPES.includes(question.type);

/** A-D before each answer: for lists of choices, not for True/False, a confidence scale or a ranking. @param {Question} question */
export const showsLetters = (question) => question.type === 'single-select' || question.type === 'multi-select';

/** A, B, C ... for the first 26 answers, then plain numbers. @param {number} index */
export const letterFor = (index) => (index >= 0 && index < 26 ? String.fromCharCode(65 + index) : String(index + 1));

/** @param {Question} question */
export const correctOptionIds = (question) => question.options.filter((option) => option.correct === true).map((option) => option.id);

// ---- Graded questions: pick, feedback, Retry, reveal ----------------------------------------

/** @returns {GradedState} */
export const startGraded = () => ({ phase: 'choosing', attempts: 0, firstAnswer: null, choice: null });

/**
 * The participant tapped an option. A right pick ends the question. A wrong pick asks for a
 * Retry, and the second wrong pick ends it too, with the right answer revealed.
 * @param {Question} question
 * @param {GradedState} state
 * @param {string} optionId
 * @returns {GradedState}
 */
export function chooseGraded(question, state, optionId) {
  if (state.phase !== 'choosing') return state;
  if (!question.options.some((option) => option.id === optionId)) return state;
  const attempts = state.attempts + 1;
  const right = question.options.find((option) => option.id === optionId)?.correct === true;
  /** @type {GradedPhase} */
  const phase = right ? 'correct' : attempts >= MAX_WRONG_TRIES ? 'revealed' : 'wrong';
  return { phase, attempts, firstAnswer: state.firstAnswer ?? optionId, choice: optionId };
}

/** Retry clears the choice. It does nothing unless the last pick was wrong and the question is still open. @param {GradedState} state @returns {GradedState} */
export const retryGraded = (state) => (state.phase === 'wrong' ? { ...state, phase: 'choosing', choice: null } : state);

/** The question is settled (right, or revealed): Next / Submit is allowed. @param {GradedState} state */
export const isGradedResolved = (state) => state.phase === 'correct' || state.phase === 'revealed';

/**
 * What an option looks like. Only `correct` and `incorrect` are ever coloured, and the
 * components print a word and an icon for both.
 * @param {Question} question
 * @param {GradedState} state
 * @param {string} optionId
 * @returns {AnswerState}
 */
export function gradedOptionState(question, state, optionId) {
  if (state.choice === optionId) return state.phase === 'correct' ? 'correct' : 'incorrect';
  if (state.phase === 'revealed' && correctOptionIds(question).includes(optionId)) return 'correct';
  return 'default';
}

/**
 * What the pager says to a screen reader after a pick (the visible words are on the options).
 * @param {Question} question
 * @param {GradedState} state
 */
export function gradedAnnouncement(question, state) {
  if (state.phase === 'correct') return 'Correct. Press Next to continue.';
  if (state.phase === 'wrong') return 'Incorrect. Press Retry to try again.';
  if (state.phase === 'revealed') {
    const answers = question.options.filter((option) => option.correct === true).map((option) => option.label).join(', ');
    // (An answer that already ends in a full stop, like "Great Western Tea co.", is not given a second one: a screen reader reads ".." as a stumble.)
    return `Incorrect. The correct answer is ${answers}${/[.!?]$/.test(answers) ? '' : '.'} Press Next to continue.`;
  }
  return '';
}

/**
 * The record the pager hands to participantData.recordAnswer. `correct` means the FIRST try
 * was right, because first tries drive the score and a Retry must never raise it.
 * @param {Question} question
 * @param {GradedState} state
 */
export function gradedRecord(question, state) {
  const first = question.options.find((option) => option.id === state.firstAnswer);
  return {
    questionId: question.id,
    answer: /** @type {string} */ (state.choice),
    firstAnswer: /** @type {string} */ (state.firstAnswer),
    attempts: state.attempts,
    correct: first?.correct === true,
  };
}

/**
 * Rebuilds a graded question from its stored record, after a reload or on another device: right
 * if the answer it ended on is right, revealed once the tries are used up, and otherwise still
 * waiting for its Retry, with the first try kept. That last case is why a record is written at the
 * first pick: reloading cannot hand out a fresh first try.
 * @param {Question} question
 * @param {{ answer: Answer, firstAnswer: Answer, attempts: number }} record
 * @returns {GradedState}
 */
export function gradedStateFromRecord(question, record) {
  const choice = typeof record.answer === 'string' ? record.answer : null;
  const right = question.options.find((option) => option.id === choice)?.correct === true;
  return {
    phase: right ? 'correct' : record.attempts >= MAX_WRONG_TRIES ? 'revealed' : 'wrong',
    attempts: record.attempts,
    firstAnswer: typeof record.firstAnswer === 'string' ? record.firstAnswer : choice,
    choice,
  };
}

/**
 * Is this stored answer final? Only a graded question can be left open: its first pick was wrong
 * and the Retry has not been used. This reads the record alone (the hub has no questions loaded),
 * which is sound because a wrong first try can only end with a second pick, right or revealed, so
 * `correct === false` with fewer than MAX_WRONG_TRIES attempts always means "still open".
 * scripts/test-pager.js walks every pick sequence to hold this to isGradedResolved().
 * @param {{ correct: boolean | null, attempts: number }} record
 */
export const isRecordSettled = (record) => record.correct !== false || record.attempts >= MAX_WRONG_TRIES;

/**
 * The record for an answer to a question that is not graded: one try, nothing right or wrong. One case needs care: the question
 * WAS graded when this person first answered it, wrongly, and has lost its answer key since (the facilitator edited it while the
 * Retry was still waiting). The stored first try is never rewritten, and with one attempt it would read as "still open" for ever:
 * the activity could not be finished and, in a sequential session, nothing after it could be opened. So this answer is the try
 * that settles it.
 * @param {Question} question
 * @param {Answer} answer
 * @param {{ correct: boolean | null, attempts: number } | null} [earlier] What is held for the question already, if anything.
 */
export function ungradedRecord(question, answer, earlier = null) {
  const open = Boolean(earlier) && !isRecordSettled(/** @type {{ correct: boolean | null, attempts: number }} */ (earlier));
  return { questionId: question.id, answer, firstAnswer: answer, attempts: open ? MAX_WRONG_TRIES : 1, correct: null };
}

// ---- Ungraded questions: validation and the saved shape --------------------------------------

/** Ranked and multi answers are lists; open text and the rest are one string. @param {Question} question */
export const answerIsList = (question) => question.type === 'multi-select' || question.type === 'ranked-voting';

/**
 * Whether the draft may be submitted. Kept from the old Quiz: every option ranked exactly once,
 * at least one box ticked, an option chosen, some text typed.
 * @param {Question} question
 * @param {Answer | undefined} draft
 */
export function isAnswerComplete(question, draft) {
  const ids = new Set(question.options.map((option) => option.id));
  switch (question.type) {
    case 'ranked-voting':
      return Array.isArray(draft) && draft.length === question.options.length
        && new Set(draft).size === draft.length && draft.every((id) => ids.has(id));
    case 'multi-select':
      return Array.isArray(draft) && draft.length > 0 && draft.every((id) => ids.has(id));
    case 'open-text-feedback':
      return typeof draft === 'string' && draft.trim().length > 0 && draft.trim().length <= MAX_TEXT_LENGTH;
    default:
      return typeof draft === 'string' && ids.has(draft);
  }
}

/** What gets saved for a draft: open text is trimmed and capped, lists are copied. @param {Question} question @param {Answer} draft @returns {Answer} */
export function normalizeAnswer(question, draft) {
  if (question.type === 'open-text-feedback') return String(draft).trim().slice(0, MAX_TEXT_LENGTH);
  return Array.isArray(draft) ? [...draft] : draft;
}

/** Tap-to-rank: a tapped option joins the end of the ranking; tapping a ranked one removes it. @param {string[]} order @param {string} optionId */
export const toggleRank = (order, optionId) => (order.includes(optionId) ? order.filter((id) => id !== optionId) : [...order, optionId]);

/** Multi-select: tick or untick, keeping the options' own order out of it. @param {string[]} chosen @param {string} optionId */
export const toggleChoice = (chosen, optionId) => (chosen.includes(optionId) ? chosen.filter((id) => id !== optionId) : [...chosen, optionId]);

// ---- Resume ----------------------------------------------------------------------------------

/**
 * Index of the first question with no answer, saved or pending; -1 once every one has an answer.
 * @param {Question[]} questions
 * @param {Iterable<string>} answeredIds
 */
export function firstUnansweredIndex(questions, answeredIds) {
  const answered = new Set(answeredIds);
  return questions.findIndex((question) => !answered.has(question.id));
}

// ---- Score -----------------------------------------------------------------------------------

/**
 * How many graded questions were right on the first try. `answers` is questionId -> answer; for a
 * graded question that answer IS the first answer (participantData hands out firstAnswer), so
 * the same count works from a fresh submit and from a reload.
 * @param {Question[]} questions
 * @param {Map<string, Answer>} answers
 */
export function firstTryScore(questions, answers) {
  const graded = questions.filter(isGraded);
  const right = graded.filter((question) => {
    const answer = answers.get(question.id);
    return typeof answer === 'string' && question.options.find((option) => option.id === answer)?.correct === true;
  }).length;
  return { right, total: graded.length };
}

// ---- Hub -------------------------------------------------------------------------------------

/**
 * The hub's pills. Sequential (the default, and anything that is not 'open'): an unfinished
 * activity is locked while an earlier one is unfinished. An activity with no questions can never
 * be finished, so it neither blocks nor is blocked. 'open': nothing is locked.
 * @template {{ complete: boolean, questionIds?: string[] }} S
 * @param {S[]} sections
 * @param {string | null | undefined} flow session.activityFlow
 * @returns {(S & { state: ActivityState })[]}
 */
export function activityStates(sections, flow) {
  const sequential = flow !== 'open';
  let blocked = false;
  return sections.map((section) => {
    const empty = (section.questionIds ?? []).length === 0;
    /** @type {ActivityState} */
    let state = 'default';
    if (section.complete) state = 'done';
    else if (sequential && blocked && !empty) state = 'locked';
    if (sequential && !section.complete && !empty) blocked = true;
    return { ...section, state };
  });
}

// ---- Greeting --------------------------------------------------------------------------------

/**
 * The name for "Hi {name}!": the visitor's roster name (from their QR), else the signed-in
 * SharePoint name for staff, else nothing. A visit that is not staff never shows the iPad's
 * own account name, which would be the firm's, not the visitor's.
 * @param {{ participantName?: string | null, sharePointDisplayName?: string | null, participationMode?: string | null, visitorId?: string | null }} who
 */
export function greetingName({ participantName, sharePointDisplayName, participationMode, visitorId }) {
  const visitor = (participantName ?? '').trim();
  if (visitor) return visitor;
  if (visitorId || participationMode === 'client-visit') return '';
  return (sharePointDisplayName ?? '').trim();
}

/** "Hi Jane!" or "Hi there!". @param {string} name */
export const hiLine = (name) => `Hi ${name || 'there'}!`;
