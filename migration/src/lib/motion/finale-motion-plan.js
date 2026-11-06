// The grand finale's acts (Prompt 36) as a plan: for each part of the thank-you page, at each level, its keyframes, length, curve and delay from the
// start of the finale. Pure (no DOM, no timers), so `node --test` covers it (scripts/test-finale-motion.js); lib/motion/motion.ts is the only file that
// plays it (`playFinale`). The petal shower itself is lib/effects/ (confetti-plan.js, confetti.ts); this is everything else that moves.
//
//   1 Hush       0 to 0.8 s   a 35 percent veil fades in behind the page's content (no flash), and lifts from 3.6 s
//   3 Medal      1.1 to 2.5 s the medal lands with a spring (scale 0 to 1.12 to 1, a small tilt), its rays open and turn once, three soft rings
//                             spread out from it, and the check draws itself
//   4 Name       1.9 to 3.6 s the headline rises letter by letter (38 ms apart, closer for a long name, all in by 3 s); the cards rise one after
//                             another and count up from 0 over 800 ms; the sheen crosses the page once
//   5 Afterglow  from 3.6 s   "Celebrate again" appears
//
// A name longer than FINALE.lettersMax letters: the rest rise together as the last one, so the letters never crowd the cap.
//
// Every length is a token (TOKENS.finale, declared again as --motion-finale-* in motion-tokens.css); every part moves transform and opacity only (the
// check its stroke); no more than MAX_CONCURRENT move at once. At the reduced level the medal, the name and the cards fade in together in 200 ms, with
// the check already drawn and the numbers already final; at none, the final state is shown at once.

import { TOKENS } from './motion-plan.js';

/** @typedef {'full' | 'reduced' | 'none'} Level */
/** @typedef {'veil' | 'medal' | 'ray' | 'ring' | 'check' | 'letter' | 'name' | 'card' | 'sheen' | 'again'} PartName */
/** @typedef {{ part: PartName, index: number, keyframes: Record<string, string | number>[], duration: number, delay: number, easing: string }} Part */

const curve = (/** @type {keyof typeof TOKENS.ease} */ name) => `cubic-bezier(${TOKENS.ease[name].join(', ')})`;
const T = TOKENS.finale;

/** When each act starts, ms from the start of the finale, and the veil's depth. */
export const FINALE = Object.freeze({
  /** The veil starts at once and is in by 0.8 s, not the brief's 0.35 s: faster, it dims the page by more than 10 percent in each of three
   *  100 ms steps, which the no-flashing check (finale-perf.spec.ts) counts as flashing. */
  veil: 0.35, veilIn: 800, veilLift: 3600,
  medal: 1100, rays: 1200, rings: 1150, ringGap: 150, check: 1500,
  letters: 1900, letterGap: 38, lettersDone: 3000,
  /** The most letters that rise one by one; in a longer name, the rest rise together as the last one (the caller wraps them in one element). */
  lettersMax: 24,
  cards: 2300, cardGap: 150, sheen: 3000, afterglow: 3600,
});

/** The step between two letters of a name of `count`: 38 ms, closer for a long name so that every letter is in by 3 s. @param {number} count */
export function letterGap(count) {
  count = Math.min(count, FINALE.lettersMax);
  if (count <= 1) return FINALE.letterGap;
  const room = FINALE.lettersDone - FINALE.letters - T.letter;
  return Math.min(FINALE.letterGap, room / (count - 1));
}

/**
 * Every part that moves at `level`, in no particular order. `letters` is how many letters (and spaces) the headline has, `cards` how many cards, and
 * `width` how far the sheen crosses, px.
 * @param {Level} level @param {{ letters: number, cards: number, width: number }} counts
 * @returns {Part[]}
 */
export function finaleParts(level, { letters, cards, width }) {
  /** @type {Part[]} */
  const parts = [];
  const add = (/** @type {PartName} */ part, /** @type {number} */ delay, /** @type {number} */ duration, /** @type {keyof typeof TOKENS.ease} */ ease,
    /** @type {Part['keyframes']} */ keyframes, index = 0) => parts.push({ part, index, keyframes, duration, delay, easing: curve(ease) });
  const rise = (/** @type {string} */ from) => [{ transform: `translateY(${from})`, opacity: 0 }, { transform: 'none', opacity: 1 }];
  if (level === 'reduced') {
    for (const part of /** @type {PartName[]} */ (['medal', 'name'])) add(part, 0, T.fade, 'standard', [{ opacity: 0 }, { opacity: 1 }]);
    for (let index = 0; index < cards; index += 1) add('card', 0, T.fade, 'standard', [{ opacity: 0 }, { opacity: 1 }], index);
  }
  if (level !== 'full') return parts;
  add('veil', 0, T.hush, 'standard', [{ opacity: 0, easing: 'linear' }, { opacity: FINALE.veil, offset: FINALE.veilIn / T.hush }, { opacity: FINALE.veil, offset: FINALE.veilLift / T.hush }, { opacity: 0 }]);
  add('medal', FINALE.medal, T.medal, 'standard', [
    { transform: 'scale(0) rotate(-14deg)', opacity: 0 }, { transform: 'scale(1.12) rotate(4deg)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 },
  ]);
  add('ray', FINALE.rays, T.rays, 'enter', [{ transform: 'scale(0.4) rotate(0deg)', opacity: 0 }, { opacity: 1, offset: 0.25 }, { transform: 'scale(1) rotate(360deg)', opacity: 1 }]);
  for (let index = 0; index < 3; index += 1) {
    add('ring', FINALE.rings + index * FINALE.ringGap, T.ring, 'enter', [{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(0.8)', opacity: 0.55, offset: 0.1 }, { transform: 'scale(2.4)', opacity: 0 }], index);
  }
  add('check', FINALE.check, T.check, 'enter', [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }]);
  const gap = letterGap(letters);
  for (let index = 0; index < Math.min(letters, FINALE.lettersMax); index += 1) add('letter', FINALE.letters + index * gap, T.letter, 'enter', rise('0.45em'), index);
  for (let index = 0; index < cards; index += 1) add('card', FINALE.cards + index * FINALE.cardGap, T.card, 'enter', rise('12px'), index);
  add('sheen', FINALE.sheen, T.sheen, 'standard', [{ transform: 'translateX(-120px)', opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: `translateX(${Math.round(width)}px)`, opacity: 0 }]);
  add('again', FINALE.afterglow, T.again, 'enter', rise('6px'));
  return parts;
}

/** When card `index` counts up, and for how long; null when the number is simply shown (below the full level). @param {Level} level @param {number} index */
export function finaleCount(level, index) {
  if (level !== 'full') return null;
  return { delay: FINALE.cards + index * FINALE.cardGap, duration: T.count };
}

/** The number a card shows `progress` (0 to 1) of the way through its count-up: easing out, never back, exactly `to` at the end. @param {number} to @param {number} progress */
export function countValue(to, progress) {
  const p = Math.max(0, Math.min(1, progress));
  return p >= 1 ? to : Math.floor(to * (1 - (1 - p) ** 3));
}
