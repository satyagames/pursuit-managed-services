// The confidence check, Before and After (Phase 20): where a guest's visit goes next, and how its two answers are named. Plain JS with JSDoc,
// no DOM and no request, so scripts/test-confidence-check.js holds every rule of the flow (board 14) with `node --test`. The participant
// screens (routes/ConfidenceCheck.svelte, Welcome, the hub, the pager's finish, Thank you), the boot sequence and the restart ask nextStep();
// the data layer and the results read the ids through parseCheckId().
//
// A client has at most one check: an activity whose Kind is `confidence-check` (PMSActivities.Kind; empty reads as `activity`), with one
// question. It is never one of the guest's activities. A session asks it when its ConfidenceCheck is Yes. The guest's two answers are two
// records in the visit's answers (PMSParticipantAnswers.ResponsesJson), under the question's id with `@before` and `@after` after it: every
// layer keys answers by questionId, so saving, retries, resume and restart treat them as they treat any answer, and a tally of the session's
// questions never meets them, since no question has such an id (docs/DECISIONS.md, "The confidence check").

/** PMSActivities.Kind of the client's check. */
export const CHECK_KIND = 'confidence-check';
/** PMSActivities.Kind of every other activity, and what an empty Kind reads as. */
export const ACTIVITY_KIND = 'activity';

/** A new check's five steps, lowest first (OptionValue 1 to 5): the approved wireframe's words (board 13), the content owner's to reword. */
export const CHECK_LABELS = Object.freeze(['Not confident at all', 'Slightly confident', 'Moderately confident', 'Confident', 'Very confident']);
/** A new check's question, as the wireframe asks it. */
export const CHECK_PROMPT = 'How confident are you that Deloitte has the capabilities to deliver this solution?';
/** A check activity's title and the line under it in Content. */
export const CHECK_TITLE = 'Confidence check';
export const CHECK_DESCRIPTION = 'Asked at the start and the end.';

const SUFFIX = /^(.+)@(before|after)$/;

/** The id of a guest's first answer to the check question. @param {string} questionId */
export const beforeId = (questionId) => `${questionId}@before`;
/** The id of a guest's second answer to the check question. @param {string} questionId */
export const afterId = (questionId) => `${questionId}@after`;

/**
 * `q@before` -> { questionId: 'q', phase: 'before' }; null for any id that is not a check answer's.
 * @param {unknown} id
 * @returns {{ questionId: string, phase: 'before' | 'after' } | null}
 */
export function parseCheckId(id) {
  if (typeof id !== 'string') return null;
  const found = SUFFIX.exec(id);
  return found ? { questionId: found[1], phase: /** @type {'before' | 'after'} */ (found[2]) } : null;
}

/** Is this answer record one of the check's two? @param {{ questionId?: unknown } | null | undefined} record */
export const isCheckRecord = (record) => parseCheckId(record?.questionId) !== null;

/** An activity's kind: `confidence-check`, or `activity` for anything else (an empty Kind included). @param {{ kind?: unknown } | null | undefined} section */
export const kindOf = (section) => (section?.kind === CHECK_KIND ? CHECK_KIND : ACTIVITY_KIND);

/** Is this the client's check, not one of its activities? @param {{ kind?: unknown } | null | undefined} section */
export const isCheckActivity = (section) => kindOf(section) === CHECK_KIND;

/**
 * The check a session asks: the client's check activity and its question, or null when the session has it switched off, the client has
 * none, or it has no question yet. With two (which Content does not make), the first in order.
 * @param {{ session: { confidenceCheck?: boolean | null } | null | undefined, sections: { id: string, kind?: unknown, questionIds?: string[], order?: number }[] | null | undefined }} input
 * @returns {{ section: any, questionId: string } | null}
 */
export function checkOf({ session, sections }) {
  if (session?.confidenceCheck !== true) return null;
  const section = (sections ?? []).filter(isCheckActivity).find((each) => (each.questionIds ?? []).length > 0);
  return section ? { section, questionId: /** @type {string[]} */ (section.questionIds)[0] } : null;
}

/** @typedef {'check-in' | 'activities' | 'check-out' | 'thank-you'} Step */

/**
 * @typedef {object} FlowState What the rules look at.
 * @property {boolean} on The session asks the check (checkOf found one).
 * @property {boolean} before The guest has given Before.
 * @property {boolean} after The guest has given After.
 * @property {boolean} allDone Every activity with questions is done.
 * @property {boolean} open The session's activities may be done in any order (ActivityFlow `open`).
 * @property {boolean} ended The facilitator has ended the session.
 * @property {boolean} finishing The guest asked to finish: the pager's last activity, or Finish on the hub.
 */

/**
 * The flow of a visit (board 14), as a list of rules: the first rule whose `when` holds gives the step. Every situation of the board is one row, and
 * scripts/test-confidence-check.js has a case for each.
 * @type {readonly { situation: string, when: (state: FlowState) => boolean, step: Step }[]}
 */
export const FLOW_RULES = Object.freeze([
  { situation: 'The check is off for the session (or the client has none), and the last activity is finished: Thank you, as before', when: (s) => !s.on && s.finishing && s.allDone, step: 'thank-you' },
  { situation: 'The check is off for the session (or the client has none): the activities, as before', when: (s) => !s.on, step: 'activities' },
  { situation: 'After is given: the visit is over', when: (s) => s.after, step: 'thank-you' },
  { situation: 'No Before yet (a new guest, one who joins late, or a visit restarted from the very beginning): Before first, unless the session has ended', when: (s) => !s.before && !s.ended, step: 'check-in' },
  { situation: 'The session has ended and the guest finishes: Thank you, and After is not asked', when: (s) => s.ended && s.finishing, step: 'thank-you' },
  { situation: 'The session has ended: the hub, which says so; nothing is asked', when: (s) => s.ended, step: 'activities' },
  { situation: 'Any-order session, Finish pressed: After', when: (s) => s.open && s.finishing, step: 'check-out' },
  { situation: 'The last activity is finished: After, just before Thank you', when: (s) => s.finishing && s.allDone, step: 'check-out' },
  { situation: 'Otherwise (Before given, activities left; a visit restarted at an activity keeps Before): the activities', when: () => true, step: 'activities' },
]);

/** The screen of each step. */
export const STEP_PATHS = Object.freeze({ 'check-in': '/check-in', activities: '/agenda', 'check-out': '/check-out', 'thank-you': '/thank-you' });

/**
 * @typedef {object} StepInput
 * @property {{ questionId: string } | null | undefined} check The session's check (checkOf), or null when it asks none.
 * @property {Iterable<string | { questionId: string }> | null | undefined} [answers] The visit's answers, as records or their ids.
 * @property {boolean} [allDone] Every activity with questions is done.
 * @property {string | null} [flow] The session's ActivityFlow.
 * @property {boolean} [sessionEnded] The session has ended.
 * @property {boolean} [finishing] The guest asked to finish.
 */

/**
 * Where the visit goes next.
 * @param {StepInput} input
 * @returns {Step}
 */
export function nextStep({ check, answers = [], allDone = false, flow = 'sequential', sessionEnded = false, finishing = false }) {
  const ids = new Set([...(answers ?? [])].map((answer) => (typeof answer === 'string' ? answer : answer?.questionId)));
  /** @type {FlowState} */
  const state = {
    on: Boolean(check?.questionId),
    before: Boolean(check?.questionId) && ids.has(beforeId(/** @type {{ questionId: string }} */ (check).questionId)),
    after: Boolean(check?.questionId) && ids.has(afterId(/** @type {{ questionId: string }} */ (check).questionId)),
    allDone: allDone === true, open: flow === 'open', ended: sessionEnded === true, finishing: finishing === true,
  };
  return /** @type {{ step: Step }} */ (FLOW_RULES.find((rule) => rule.when(state))).step;
}

/** nextStep()'s screen. @param {StepInput} input */
export const stepPath = (input) => STEP_PATHS[nextStep(input)];

/**
 * The ids a restart drops on the guest's device: a restart at an activity drops that activity's questions and After (After is asked again
 * once the activity is done again); Before stays. (A restart from the very beginning drops everything and needs no list.)
 * @param {string[]} questionIds The restarted activity's questions.
 * @param {{ questionId: string } | null | undefined} check
 */
export const restartedIds = (questionIds, check) => (check?.questionId ? [...questionIds, afterId(check.questionId)] : [...questionIds]);
