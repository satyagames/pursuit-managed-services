// The grand finale's acts (Prompt 36) as a plan: for each part of the thank-you page, at each level, its keyframes, length, curve and delay from the
// start of the finale. Pure (no DOM, no timers), so `node --test` covers it (scripts/test-finale-motion.js); lib/motion/motion.ts is the only file that
// plays it (`playFinale`). The petal shower itself is lib/effects/ (confetti-plan.js, confetti.ts); this is everything else that moves.
//
//   1 Hush       0 to 0.35 s  a 35 percent veil fades in behind the page's content (no flash), and lifts from 3.6 s
//   3 Medal      1.1 to 2.5 s the medal lands with a spring (scale 0 to 1.12 to 1, a small tilt), its rays open and turn once, three soft rings
//                             spread out from it, and the check draws itself
//   4 Name       1.9 to 3.6 s the headline rises in (by 2.4 s; letter by letter was dropped to keep the page inside its budget); the cards rise one after
//                             another and count up from 0 over 800 ms; the sheen crosses the page once
//   5 Afterglow  from 3.6 s   "Celebrate again" appears
//
// Every length is a token (TOKENS.finale, declared again as --motion-finale-* in motion-tokens.css); every part moves transform and opacity only (the
// check its stroke); no more than MAX_CONCURRENT move at once. At the reduced level the medal, the name and the cards fade in together in 200 ms, with
// the check already drawn and the numbers already final, and a still garland of petals frames the top of the page until 6 s; at none, the final state
// is shown at once, with no garland.

import { TOKENS } from './motion-plan.js';

/** @typedef {'full' | 'reduced' | 'none'} Level */
/** @typedef {'veil' | 'medal' | 'ray' | 'ring' | 'check' | 'name' | 'card' | 'sheen' | 'again' | 'garland'} PartName */
/** @typedef {{ part: PartName, index: number, keyframes: Record<string, string | number>[], duration: number, delay: number, easing: string }} Part */

const curve = (/** @type {keyof typeof TOKENS.ease} */ name) => `cubic-bezier(${TOKENS.ease[name].join(', ')})`;
const T = TOKENS.finale;

/** When each act starts, ms from the start of the finale, and the veil's depth. */
export const FINALE = Object.freeze({
  veil: 0.35, veilIn: 350, veilLift: 3600,
  medal: 1100, rays: 1200, rings: 1150, ringGap: 150, check: 1500,
  name: 1900,
  cards: 2300, cardGap: 150, sheen: 3000, afterglow: 3600,
});

/**
 * Every part that moves at `level`, in no particular order. `cards` is how many cards there are, and `width` how far the sheen crosses, px.
 * @param {Level} level @param {{ cards: number, width: number }} counts
 * @returns {Part[]}
 */
export function finaleParts(level, { cards, width }) {
  /** @type {Part[]} */
  const parts = [];
  const add = (/** @type {PartName} */ part, /** @type {number} */ delay, /** @type {number} */ duration, /** @type {keyof typeof TOKENS.ease} */ ease,
    /** @type {Part['keyframes']} */ keyframes, index = 0) => parts.push({ part, index, keyframes, duration, delay, easing: curve(ease) });
  const rise = (/** @type {string} */ from) => [{ transform: `translateY(${from})`, opacity: 0 }, { transform: 'none', opacity: 1 }];
  if (level === 'reduced') {
    for (const part of /** @type {PartName[]} */ (['medal', 'name'])) add(part, 0, T.fade, 'standard', [{ opacity: 0 }, { opacity: 1 }]);
    for (let index = 0; index < cards; index += 1) add('card', 0, T.fade, 'standard', [{ opacity: 0 }, { opacity: 1 }], index);
    // In place of the shower, a still garland of petals along the top edge, shown at once and gone after 6 s.
    add('garland', 0, T.garland, 'standard', [{ opacity: 1 }, { opacity: 1, offset: 6000 / T.garland }, { opacity: 0 }]);
  }
  if (level !== 'full') return parts;
  add('veil', 0, T.hush, 'standard', [{ opacity: 0 }, { opacity: FINALE.veil, offset: FINALE.veilIn / T.hush }, { opacity: FINALE.veil, offset: FINALE.veilLift / T.hush }, { opacity: 0 }]);
  add('medal', FINALE.medal, T.medal, 'standard', [
    { transform: 'scale(0) rotate(-14deg)', opacity: 0 }, { transform: 'scale(1.12) rotate(4deg)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 },
  ]);
  add('ray', FINALE.rays, T.rays, 'enter', [{ transform: 'scale(0.4) rotate(0deg)', opacity: 0 }, { opacity: 1, offset: 0.25 }, { transform: 'scale(1) rotate(360deg)', opacity: 1 }]);
  for (let index = 0; index < 3; index += 1) {
    add('ring', FINALE.rings + index * FINALE.ringGap, T.ring, 'enter', [{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(0.8)', opacity: 0.55, offset: 0.1 }, { transform: 'scale(2.4)', opacity: 0 }], index);
  }
  add('check', FINALE.check, T.check, 'enter', [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }]);
  add('name', FINALE.name, T.name, 'enter', rise('0.4em'));
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
