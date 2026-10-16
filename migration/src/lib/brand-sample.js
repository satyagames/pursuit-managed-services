// What Brand Studio's preview shows a client's look on: made-up, client-neutral content, so a preview
// reads the same for every client and never shows another client's words. Plain JS with JSDoc and no DOM.
//
// The WORDS that are the client's (event title, subtitle, welcome line, logo text) are not here: the
// preview takes those from the client's own stored theme.

/** @typedef {import('./pager-logic.js').Question} Question */

/** The name on Welcome and the finale. */
export const SAMPLE_NAME = 'Jane Doe';

/** The three hub states a participant meets, one of each: finished, open and waiting. */
export const SAMPLE_PILLS = Object.freeze([
  Object.freeze({ id: 'sample-1', title: 'Warm-up round', state: /** @type {const} */ ('done') }),
  Object.freeze({ id: 'sample-2', title: 'Guess the brand', state: /** @type {const} */ ('default') }),
  Object.freeze({ id: 'sample-3', title: 'Final round', state: /** @type {const} */ ('locked') }),
]);

/** @type {(id: string, prompt: string, answers: string[], right: number) => Question} */
const question = (id, prompt, answers, right) => ({
  id, prompt, type: 'single-select', order: Number(id.slice(-1)), layout: 'text-list',
  options: answers.map((label, index) => ({ id: `${id}-o${index + 1}`, label, correct: index === right })),
});

/** One activity of three questions, the first of which the preview shows. */
export const SAMPLE_ACTIVITY = Object.freeze({
  section: Object.freeze({ title: 'Sample activity', description: 'This is how a question looks to a participant.' }),
  questions: Object.freeze([
    question('sample-q1', 'Which planet is known as the Red Planet?', ['Venus', 'Mars', 'Jupiter', 'Mercury'], 1),
    question('sample-q2', 'How many sides does a hexagon have?', ['Five', 'Six', 'Seven', 'Eight'], 1),
    question('sample-q3', 'Which of these is a primary colour of light?', ['Green', 'Orange', 'Purple', 'Brown'], 0),
  ]),
});

/** The finale's summary. */
export const SAMPLE_FINALE = Object.freeze({ activities: 3, score: Object.freeze({ right: 7, total: 9 }) });

/** The screens the preview can show, in the order of the switcher. */
export const SCENES = Object.freeze([
  Object.freeze({ id: 'welcome', label: 'Welcome' }),
  Object.freeze({ id: 'activities', label: 'Activities' }),
  Object.freeze({ id: 'question', label: 'Question' }),
  Object.freeze({ id: 'correct', label: 'Correct answer' }),
  Object.freeze({ id: 'finale', label: 'Finale' }),
]);

/** @param {string} id */
export const sceneById = (id) => SCENES.find((scene) => scene.id === id) ?? SCENES[0];
