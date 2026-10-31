// The motion plan of the participant screens (Phase 15): which shape each thing on a screen moves with, for how long, after how much
// delay and over what distance, as a TABLE keyed by the moment, the kind of question and the part of the screen, never as numbers in a
// component. Pure (no DOM, no timers), so `node --test` covers it (scripts/test-motion-plan.js); lib/motion/motion.ts only carries a
// recipe out. Modelled on lib/effects/effect-plan.js.
//
// It reads and writes nothing. It never names a CSS property: a recipe names a shape (a keyframe of lib/motion/motion-tokens.css) and the
// tokens it runs with, and the only numbers here are the tokens' own, which the CSS file declares too (a test holds the two equal).
//
// The level rule: level = the lowest of the client's switch (ThemeJson `motion.enabled`), the device (prefers-reduced-motion: no motion at
// all, as Phase 8 pinned), the support switch (`?motion=off`) and the governor (a device that drops frames during its first entrances is
// stepped down, and never back up, for the session). 'full' moves; 'reduced' only fades; 'none' shows the finished screen at once.

/** @typedef {'full' | 'reduced' | 'none'} Level */
/** @typedef {'forward' | 'back' | 'jump' | 'none'} Direction */
/** @typedef {'enter' | 'verdict'} Moment */
/** @typedef {'hero' | 'title' | 'rule' | 'meta' | 'question' | 'options' | 'actions' | 'card' | 'item'} Role */
/** @typedef {'correct' | 'incorrect' | 'revealed' | 'selected'} Verdict */
/** @typedef {'rise' | 'from-left' | 'from-right' | 'converge-left' | 'converge-right' | 'draw-x' | 'pop' | 'settle' | 'nudge' | 'fade' | 'none'} Shape */
/** @typedef {'instant' | 'quick' | 'base' | 'slow'} DurationToken */
/** @typedef {'enter' | 'exit' | 'standard' | 'pop'} EaseToken */
/** @typedef {'near' | 'far'} DistanceToken */
/**
 * @typedef {object} Recipe
 * @property {Shape} shape
 * @property {DurationToken} duration
 * @property {EaseToken} ease
 * @property {number} delay  In steps of the stagger token (0 = at once); motion.ts writes it as `--m-delay`.
 * @property {DistanceToken} distance
 * @property {number} [stretch]  Steps of the stagger added to its duration so that every part of a screen settles on the SAME frame (Phase 15:
 *   in Chromium each separate end of a transform animation costs a layout; staggered starts cost none). motion.ts writes it as `--m-stretch`.
 */

/** The ordered levels, lowest first. */
export const LEVELS = Object.freeze(/** @type {const} */ (['none', 'reduced', 'full']));

/**
 * The tokens' values. lib/motion/motion-tokens.css declares the same (`--motion-duration-base: 320ms` ...): the CSS is what the page uses, this is
 * what the tests and the budget read, and scripts/test-motion-plan.js fails if they differ.
 */
export const TOKENS = Object.freeze({
  duration: Object.freeze({ instant: 90, quick: 160, base: 320, slow: 400 }),
  ease: Object.freeze({
    enter: Object.freeze([0.2, 0.8, 0.2, 1]),
    exit: Object.freeze([0.4, 0, 1, 1]),
    // The keyword `ease` itself, so the components' existing press and colour changes keep their feel when they name the token.
    standard: Object.freeze([0.25, 0.1, 0.25, 1]),
    pop: Object.freeze([0.34, 1.4, 0.5, 1]),
  }),
  /** One step of stagger, ms; a step is never longer than this. */
  stagger: 50,
  /** The longest an item waits for its turn, ms: past it, the rest come in together. */
  staggerCap: 240,
  /** The shortest step a long list gets, as a share of a step. */
  staggerMin: 0.4,
  /** Container-relative distances: smaller on a narrow screen by construction (vw), bounded both ways. */
  distance: Object.freeze({ near: 'clamp(0.5rem, 3vw, 1.25rem)', far: 'clamp(1rem, 6vw, 2.5rem)' }),
  /** How far a wrong answer is shaken. */
  nudge: '0.375rem',
  /** The hub's moment (Prompt 24; the beats themselves are lib/participant/hub-moment-plan.js), ms. Each is a --motion-hub-* in the CSS. */
  hub: Object.freeze({ fade: 150, wave: 60, journey: 180, shackle: 220, crossfade: 260, shake: 280, stamp: 400, sweep: 500, pulse: 1200 }),
});

/** Shapes the CSS defines, and nothing else (a recipe naming another is a test failure). */
export const SHAPES = Object.freeze(/** @type {const} */ (['rise', 'from-left', 'from-right', 'converge-left', 'converge-right', 'draw-x', 'pop', 'settle', 'nudge', 'fade', 'none']));

/** The kinds of question (Questions.QuestionType's allowed words, lib/schema/pms-schema-meta.js). */
export const QUESTION_TYPES = Object.freeze(['single-select', 'multi-select', 'true-false', 'confidence-continuum', 'ranked-voting', 'open-text-feedback', 'art-of-the-possible']);
export const ROLES = Object.freeze(/** @type {const} */ (['hero', 'title', 'rule', 'meta', 'question', 'options', 'actions', 'card', 'item']));
export const DIRECTIONS = Object.freeze(/** @type {const} */ (['forward', 'back', 'jump', 'none']));

/** At most this many things move at once; the rest appear without motion (motion.ts counts). */
export const MAX_CONCURRENT = 16;
/** The whole entrance of a screen (question and every option), ms: the budget of the performance contract. */
export const ENTRANCE_BUDGET = 700;
/** An option's words longer than this travel the near distance, not the far one. */
export const LONG_LABEL = 80;

// ---- The plan by part -----------------------------------------------------------------------------------------------------------------

/**
 * How the answers of each kind of question come in. `alternate`: from the left and the right in turn, staggered. `converge`: from opposite
 * sides at once. `in-order`: from the left, one after another (a scale reads left to right, low to high). `rise`: up into place.
 */
const OPTIONS_BY_TYPE = Object.freeze({
  'single-select': 'alternate',
  'multi-select': 'alternate',
  'true-false': 'converge',
  'confidence-continuum': 'in-order',
  'ranked-voting': 'alternate',
  'open-text-feedback': 'rise',
  'art-of-the-possible': 'rise', // (Prompt 23: one panel, which rises whole; no box moves by itself)
});

/** The entrance of each part of a screen, before direction is applied. `offset` is where its turn starts, in steps. */
const ENTER = Object.freeze({
  hero: { shape: 'fade', duration: 'slow', ease: 'enter', offset: 0, distance: 'near' },
  title: { shape: 'rise', duration: 'base', ease: 'enter', offset: 0, distance: 'near' },
  rule: { shape: 'draw-x', duration: 'base', ease: 'enter', offset: 1, distance: 'near' },
  meta: { shape: 'none', duration: 'base', ease: 'enter', offset: 0, distance: 'near' },
  question: { shape: 'rise', duration: 'base', ease: 'enter', offset: 0, distance: 'near' },
  options: { shape: 'from-left', duration: 'base', ease: 'enter', offset: 1, distance: 'far' },
  actions: { shape: 'none', duration: 'base', ease: 'enter', offset: 0, distance: 'near' },
  card: { shape: 'settle', duration: 'slow', ease: 'enter', offset: 0, distance: 'near' },
  item: { shape: 'rise', duration: 'base', ease: 'enter', offset: 0, distance: 'near' },
});

/** Feedback on an answer: right pops, wrong is nudged sideways (never a flash of red), a revealed answer pulses once, a choice (a poll, a tick, a rank) pops. */
const VERDICT = Object.freeze({
  correct: { shape: 'pop', duration: 'quick', ease: 'pop' },
  incorrect: { shape: 'nudge', duration: 'quick', ease: 'standard' },
  revealed: { shape: 'pop', duration: 'quick', ease: 'pop' },
  selected: { shape: 'pop', duration: 'quick', ease: 'pop' },
});

const MIRROR = Object.freeze({ 'from-left': 'from-right', 'from-right': 'from-left', 'converge-left': 'converge-right', 'converge-right': 'converge-left' });

// ---- Stagger --------------------------------------------------------------------------------------------------------------------

/** The cap in steps. */
export const capSteps = () => TOKENS.staggerCap / TOKENS.stagger;

/**
 * The step between two items of a list of `count`, as a share of a full step: a short list gets the whole step, a long one less, so a 2-option
 * question and a 9-option one both finish inside the cap; never under `staggerMin`; a narrow screen gets three quarters of it.
 * @param {number} count @param {{ narrow?: boolean }} [options]
 */
export function stepFor(count, { narrow = false } = {}) {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  const share = Math.min(1, Math.max(TOKENS.staggerMin, capSteps() / n));
  return round(narrow ? share * 0.75 : share);
}

/** The delay of item `index` of `count`, in steps, after its role's offset; never past the cap. @param {number} index @param {number} count @param {{ narrow?: boolean }} [options] */
export function staggerSteps(index, count, options) {
  const i = Math.max(0, Math.floor(Number(index) || 0));
  return round(Math.min(i * stepFor(count, options), capSteps()));
}

const round = (value) => Math.round(value * 1000) / 1000;

// ---- Levels ----------------------------------------------------------------------------------------------------------------------

/** The lower of two levels. @param {Level} a @param {Level} b @returns {Level} */
export const lowerLevel = (a, b) => (LEVELS.indexOf(a) <= LEVELS.indexOf(b) ? a : b);

/** A stored or typed level, or 'full' for anything else. @param {unknown} value @returns {Level} */
export const asLevel = (value) => (LEVELS.includes(/** @type {Level} */ (value)) ? /** @type {Level} */ (value) : 'full');

/**
 * The one level rule. The device's reduced-motion setting always wins (no animation at all, Phase 8's rule) and no switch can bring motion
 * back; a client's switch that is off, the support switch and the governor can each only lower it.
 * @param {{ enabled?: unknown, reduced?: boolean, governor?: Level, diagnostic?: boolean }} inputs
 * @returns {Level}
 */
export function resolveLevel({ enabled = true, reduced = false, governor = 'full', diagnostic = false } = {}) {
  let level = /** @type {Level} */ ('full');
  if (enabled === false) level = 'none';
  if (reduced) level = 'none';
  if (diagnostic) level = 'none';
  return lowerLevel(level, asLevel(governor));
}

// ---- The recipe ------------------------------------------------------------------------------------------------------------------

/**
 * What one thing on a screen does at one moment, or null for nothing (the finished screen, at once).
 * @param {{ moment?: Moment, type?: string | null, role: Role, index?: number, count?: number, direction?: Direction, level?: Level,
 *   verdict?: Verdict, long?: boolean, narrow?: boolean }} input
 * @returns {Recipe | null}
 */
export function motionRecipe(input) {
  const recipe = placed(input);
  if (!recipe || (input.moment ?? 'enter') !== 'enter' || recipe.shape === 'fade' || !STRETCHED.includes(input.role)) return recipe;
  const { type = null, count = 1, direction = 'jump', narrow = false } = input;
  const end = type ? entranceLength(type, count, { direction, narrow })
    : Math.max(0, ...[placed({ role: 'title', direction }), placed({ role: 'rule', direction }), placed({ role: 'item', index: Math.max(0, count - 1), count, direction, narrow })].map(recipeEnd));
  return { ...recipe, stretch: round(Math.max(0, end - recipeEnd(recipe)) / TOKENS.stagger) };
}

/** The parts of a screen that are stretched to settle together (a card, a picture and a verdict are each alone). */
const STRETCHED = Object.freeze(['title', 'rule', 'question', 'options', 'item']);

/** A recipe with its own start and length, before the stretch. @param {Parameters<typeof motionRecipe>[0]} input @returns {Recipe | null} */
function placed({ moment = 'enter', type = null, role, index = 0, count = 1, direction = 'jump', level = 'full', verdict, long = false, narrow = false }) {
  if (level === 'none') return null;
  if (moment === 'verdict') {
    const plan = verdict ? VERDICT[verdict] : undefined;
    // A verdict is a change of state that is already shown in words and colour: at the reduced level it does not move at all.
    if (!plan || level !== 'full') return null;
    return { ...plan, delay: 0, distance: 'near' };
  }
  if (direction === 'none') return null;
  const base = ENTER[role];
  if (!base) return null;
  /** @type {Shape} */
  let shape = base.shape;
  let delay = base.offset;
  /** @type {DistanceToken} */
  let distance = base.distance;
  if (role === 'question') {
    // Moving through an activity: the next question comes from the side the person is going to.
    if (direction === 'forward') shape = 'from-right';
    else if (direction === 'back') shape = 'from-left';
  }
  if (role === 'options') {
    const kind = OPTIONS_BY_TYPE[/** @type {keyof typeof OPTIONS_BY_TYPE} */ (type ?? '')] ?? 'alternate';
    if (kind === 'alternate') { shape = index % 2 === 0 ? 'from-left' : 'from-right'; delay += staggerSteps(index, count, { narrow }); }
    else if (kind === 'converge') { shape = index % 2 === 0 ? 'converge-left' : 'converge-right'; distance = 'near'; }
    else if (kind === 'in-order') { shape = 'from-left'; distance = 'near'; delay += staggerSteps(index, count, { narrow }); }
    else { shape = 'rise'; distance = 'near'; }
    if (long) distance = 'near';
    // On a question page the options start after the question; on the first question of an activity, after the rule under the title too.
    if (direction === 'jump') delay += 1;
  }
  if (role === 'question' && direction === 'jump') delay += 1;
  if (role === 'item') delay += staggerSteps(index, count, { narrow });
  // Back mirrors the answers' sides (the question's own side was chosen by direction above).
  if (direction === 'back' && role !== 'question' && MIRROR[shape]) shape = MIRROR[shape];
  if (shape === 'none') return null;
  if (level === 'reduced') return { shape: 'fade', duration: 'quick', ease: 'standard', delay: 0, distance: 'near' };
  return { shape, duration: base.duration, ease: base.ease, delay: round(delay), distance };
}

/** When a recipe has finished, ms from the moment it starts. @param {Recipe | null} recipe */
export const recipeEnd = (recipe) => (recipe ? (recipe.delay + (recipe.stretch ?? 0)) * TOKENS.stagger + TOKENS.duration[recipe.duration] : 0);

/**
 * The whole entrance of a question screen of `type` with `count` options, ms: the latest end of the question and every option. The budget
 * (ENTRANCE_BUDGET) holds for every type and 1 to 12 options, in both directions and the jump from the hub.
 * @param {string} type @param {number} count @param {{ direction?: Direction, narrow?: boolean }} [options]
 */
export function entranceLength(type, count, { direction = 'forward', narrow = false } = {}) {
  const parts = [placed({ role: 'question', type, direction }), ...(direction === 'jump' ? [placed({ role: 'title', direction }), placed({ role: 'rule', direction })] : [])];
  for (let index = 0; index < count; index += 1) parts.push(placed({ role: 'options', type, index, count, direction, narrow }));
  return Math.max(0, ...parts.map(recipeEnd));
}

// ---- The governor ----------------------------------------------------------------------------------------------------------------

/** A frame longer than this, ms, is a dropped one (three at 60 Hz). */
export const LONG_FRAME = 50;
/** An entrance with this many long frames (its first two frames, which carry the new screen's own drawing, not counted) was not smooth. */
export const LONG_FRAMES_PER_BAD_ENTRANCE = 3;
/** Rough entrances that step the level down once. */
export const BAD_ENTRANCES_PER_STEP = 2;
/** Smooth entrances after which the governor stops watching for the rest of the session. */
export const CLEAN_ENTRANCES_TO_STOP = 3;
/** How long one entrance is watched for, at most, ms. */
export const WATCH_WINDOW = ENTRANCE_BUDGET;

/** @typedef {{ level: Level, bad: number, clean: number, watching: boolean }} Governor */

/** @returns {Governor} */
export const startGovernor = (level = /** @type {Level} */ ('full')) => ({ level: asLevel(level), bad: 0, clean: 0, watching: asLevel(level) !== 'none' });

/**
 * One watched entrance: the times between its frames, ms. Two rough entrances step the level down one (and the count starts again); three
 * smooth ones in all stop the watching. It never steps up.
 * @param {Governor} state @param {number[]} deltas
 * @returns {Governor}
 */
export function governorStep(state, deltas) {
  if (!state.watching) return state;
  const long = deltas.slice(2).filter((delta) => delta > LONG_FRAME).length;
  if (long >= LONG_FRAMES_PER_BAD_ENTRANCE) {
    const bad = state.bad + 1;
    if (bad < BAD_ENTRANCES_PER_STEP) return { ...state, bad };
    const level = LEVELS[Math.max(0, LEVELS.indexOf(state.level) - 1)];
    return { level, bad: 0, clean: state.clean, watching: level !== 'none' };
  }
  const clean = state.clean + 1;
  return { ...state, clean, watching: clean < CLEAN_ENTRANCES_TO_STOP };
}

/** The governor as kept for the session (key `pms.motion`), or a fresh one. @param {string | null | undefined} text @returns {Governor} */
export function readGovernor(text) {
  try {
    const value = text ? JSON.parse(text) : null;
    if (!value || typeof value !== 'object') return startGovernor();
    const level = asLevel(value.level);
    return { level, bad: Math.max(0, Number(value.bad) || 0), clean: Math.max(0, Number(value.clean) || 0), watching: value.watching !== false && level !== 'none' };
  } catch {
    return startGovernor();
  }
}

/** Whether the participant address asks for no motion (`?motion=off`, for support staff with one janky phone). @param {string} search */
export const diagnosticOff = (search) => /(?:^|[?&])motion=off(?:&|$)/.test(String(search ?? ''));
