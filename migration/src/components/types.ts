/** How an answer (a pill or a logo tile) looks. `correct` and `incorrect` also print a text label and an icon. */
export type AnswerState = 'default' | 'selected' | 'correct' | 'incorrect' | 'disabled';

/** How an activity on the hub looks. `locked` shows a lock and why. */
export type ActivityState = 'default' | 'done' | 'locked';
