/** How an answer (a pill or a logo tile) looks. `correct` and `incorrect` also print a text label and an icon. */
export type AnswerState = 'default' | 'selected' | 'correct' | 'incorrect' | 'disabled';

/** How an activity on the hub looks: finished, started, open and not started, or locked. Each has an icon and a word as well as its colour. */
export type ActivityState = 'done' | 'progress' | 'ready' | 'locked';
