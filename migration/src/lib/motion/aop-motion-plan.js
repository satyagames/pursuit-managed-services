// The Art of Possibility's motion (Prompt 35) as a plan: for each effect, at each level, the keyframes, length, curve and delay, or null for nothing. Pure
// (no DOM, no timers), so `node --test` covers it (scripts/test-aop-motion.js); lib/motion/motion.ts is the only file that plays one (`playEffect`, `flyOff`).
//
// Every effect moves transform and opacity only, and every length is a token (TOKENS.aop, declared again as --motion-aop-* in motion-tokens.css). At the
// reduced level an effect only fades, or does nothing when it is movement only (a pop, a bump, a ripple, a sheen, the wave, a pulse); at none it is nothing.
// The completion wave and Clear all's fly-away are spaced so that no more than MAX_CONCURRENT things move at once, and the milestones are the guest's
// 25, 50 and 75 percent, each said once.

import { MAX_CONCURRENT, TOKENS } from './motion-plan.js';

/** @typedef {'full' | 'reduced' | 'none'} Level */
/** @typedef {Record<string, string | number>} Frame */
/** @typedef {{ keyframes: Frame[], duration: number, easing: string, delay?: number }} Effect */
/** @typedef {{ x?: number, y?: number, width?: number, index?: number, delay?: number, random?: () => number }} Where */

const curve = (name) => `cubic-bezier(${TOKENS.ease[name].join(', ')})`;
const scale = (value) => `scale(${value})`;

/** How far a box flies when everything is cleared, px at most (and at least half of it). */
export const FLY_REACH = 48;

/**
 * The effects, each a recipe at the full level and, where it has one, a fade for the reduced level. `where` carries what an effect needs: a touch
 * point (`x`, `y`), the row's width, a place in a stagger (`index`), a delay, and the random source of a fly-away's path.
 * @type {Record<string, { full: (where: Where) => Omit<Effect, 'duration'>, reduced?: (where: Where) => Omit<Effect, 'duration'> }>}
 */
export const AOP_EFFECTS = Object.freeze({
  // A box takes its level: its content pops.
  pop: { full: () => ({ keyframes: [{ transform: scale(0.8) }, { transform: scale(1.08), offset: 0.6 }, { transform: scale(1) }], easing: curve('standard') }) },
  // A count pill changes.
  bump: { full: () => ({ keyframes: [{ transform: scale(1) }, { transform: scale(1.12), offset: 0.4 }, { transform: scale(1) }], easing: curve('standard') }) },
  // A soft circle grows from the touch point (one element for the whole grid, moved there).
  ripple: {
    full: ({ x = 0, y = 0 }) => ({
      keyframes: [{ transform: `translate(${x}px, ${y}px) scale(0)`, opacity: 0.35 }, { transform: `translate(${x}px, ${y}px) scale(1)`, opacity: 0 }],
      easing: curve('enter'),
    }),
  },
  // A finished row: a light sweeps across it once.
  sheen: {
    full: ({ width = 0 }) => ({
      keyframes: [{ transform: 'translateX(-120px)', opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: `translateX(${Math.round(width)}px)`, opacity: 0 }],
      easing: curve('standard'),
    }),
  },
  // A finished row's check badge arrives.
  check: {
    full: () => ({ keyframes: [{ transform: scale(0), opacity: 0 }, { transform: scale(1.15), opacity: 1, offset: 0.7 }, { transform: scale(1), opacity: 1 }], easing: curve('pop') }),
    reduced: () => ({ keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: curve('standard') }),
  },
  // The bar glows once at a milestone.
  glow: {
    full: () => ({ keyframes: [{ opacity: 0 }, { opacity: 0.9, offset: 0.3 }, { opacity: 0 }], easing: curve('standard') }),
    reduced: () => ({ keyframes: [{ opacity: 0 }, { opacity: 0.6, offset: 0.3 }, { opacity: 0 }], easing: curve('standard') }),
  },
  // A milestone's words rise from the bar, stay, and go.
  milestone: {
    full: () => ({
      keyframes: [
        { transform: 'translateY(8px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1, offset: 0.15 },
        { transform: 'translateY(0)', opacity: 1, offset: 0.8 }, { transform: 'translateY(-4px)', opacity: 0 },
      ],
      easing: curve('standard'),
    }),
    reduced: () => ({ keyframes: [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], easing: curve('standard') }),
  },
  // Clear all: a rated box flies a short way and fades, staggered.
  fly: {
    full: ({ index = 0, random = Math.random }) => {
      const { dx, dy, turn } = flyPath(random);
      return {
        keyframes: [{ transform: 'translate(0, 0) rotate(0deg)', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) rotate(${turn}deg)`, opacity: 0 }],
        easing: curve('exit'),
        delay: index * TOKENS.aop.flyStagger,
      };
    },
    reduced: ({ index = 0 }) => ({ keyframes: [{ opacity: 1 }, { opacity: 0 }], easing: curve('exit'), delay: index * TOKENS.aop.flyStagger }),
  },
  // Every box rated: each box swells once as the wave reaches it.
  wave: { full: ({ delay = 0 }) => ({ keyframes: [{ transform: scale(1) }, { transform: scale(1.12), offset: 0.5 }, { transform: scale(1) }], easing: curve('standard'), delay }) },
  // The level menu springs open.
  spring: {
    full: () => ({ keyframes: [{ transform: scale(0.72), opacity: 0 }, { transform: scale(1), opacity: 1 }], easing: curve('pop') }),
    reduced: () => ({ keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: curve('standard') }),
  },
  // "Your ratings at a glance" rises in under the grid.
  rise: {
    full: () => ({ keyframes: [{ transform: 'translateY(16px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], easing: curve('enter') }),
    reduced: () => ({ keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: curve('standard') }),
  },
  // The box Next empty box went to, and the first empty box, swell once, softly.
  pulse: { full: ({ delay = 0 }) => ({ keyframes: [{ transform: scale(1) }, { transform: scale(1.08), offset: 0.35 }, { transform: scale(1) }], easing: curve('standard'), delay }) },
});

/**
 * One effect at one level, or null for nothing. @param {string} name @param {Level} level @param {Where} [where] @returns {Effect | null}
 */
export function aopEffect(name, level, where = {}) {
  const recipe = AOP_EFFECTS[/** @type {keyof typeof AOP_EFFECTS} */ (name)];
  if (!recipe || level === 'none') return null;
  const make = level === 'full' ? recipe.full : recipe.reduced;
  if (!make) return null;
  return { duration: TOKENS.aop[/** @type {keyof typeof TOKENS.aop} */ (name)], ...make(where) };
}

/** A fly-away's short random path: a direction, between half and all of FLY_REACH, and a small turn. @param {() => number} random */
export function flyPath(random) {
  const angle = random() * 2 * Math.PI;
  const reach = FLY_REACH * (0.5 + random() * 0.5);
  return { dx: Math.round(Math.cos(angle) * reach * 10) / 10, dy: Math.round(Math.sin(angle) * reach * 10) / 10, turn: Math.round((random() * 2 - 1) * 20) };
}

/** How many of `rated` boxes fly when everything is cleared, with `moving` things already moving: the rest just clear. @param {number} rated @param {number} moving */
export const flyCount = (rated, moving) => Math.max(0, Math.min(rated, MAX_CONCURRENT - moving));

/** The wave's step between diagonals, ms: so that the diagonals moving together never hold more than MAX_CONCURRENT boxes. */
function waveStep(rows, columns) {
  const together = Math.max(1, Math.floor(MAX_CONCURRENT / Math.max(1, Math.min(rows, columns))));
  return Math.max(TOKENS.aop.waveStep, Math.ceil(TOKENS.aop.wave / together));
}

/** When the wave reaches box (r, c), ms: one diagonal at a time, from the top left. @param {number} r @param {number} c @param {number} rows @param {number} columns */
export const waveDelay = (r, c, rows, columns) => (r + c) * waveStep(rows, columns);

/** The whole wave, ms. @param {number} rows @param {number} columns */
export const waveLength = (rows, columns) => (rows + columns - 2) * waveStep(rows, columns) + TOKENS.aop.wave;

/** The milestones, in order: a share of the boxes, the words that rise from the bar, and the cue (lib/effects/sound-cues.js). */
export const MILESTONES = Object.freeze([
  Object.freeze({ key: 'quarter', share: 0.25, words: 'A quarter done', cue: 'milestoneQuarter' }),
  Object.freeze({ key: 'half', share: 0.5, words: 'Halfway', cue: 'milestoneHalf' }),
  Object.freeze({ key: 'nearly', share: 0.75, words: 'Nearly there', cue: 'milestoneNearly' }),
]);

/** The rated counts at which the milestones fall, rounded up: 17, 33 and 49 of 65. @param {number} total */
export const milestonePoints = (total) => MILESTONES.map((each) => Math.ceil(total * each.share));

/**
 * The milestone to say after the count went from `before` to `after`, or null. Each is said once (`shown`, kept by the caller for the visit); a jump past
 * two says the higher; `quietly` (the ratings a page opens with) marks what is passed without saying anything.
 * @param {number} before @param {number} after @param {number} total @param {Set<string>} shown @param {{ quietly?: boolean }} [options]
 * @returns {(typeof MILESTONES)[number] | null}
 */
export function milestonesCrossed(before, after, total, shown, { quietly = false } = {}) {
  const points = milestonePoints(total);
  /** @type {(typeof MILESTONES)[number] | null} */
  let said = null;
  MILESTONES.forEach((milestone, at) => {
    if (points[at] > after || shown.has(milestone.key)) return;
    shown.add(milestone.key);
    if (!quietly && before < points[at]) said = milestone;
  });
  return said;
}
