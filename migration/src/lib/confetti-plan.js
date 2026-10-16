// How much confetti, where from, in which colours. Pure (no DOM, no canvas-confetti), so
// `node --test` covers it (scripts/test-effects.js). confetti.ts hands the result to the library.

/**
 * @typedef {'small' | 'medium' | 'large'} ConfettiSize
 * @typedef {{ x: number, y: number }} Origin viewport fractions, 0..1 from the top-left
 * @typedef {{
 *   at: number, count: number, angle: number, spread: number, startVelocity: number,
 *   gravity: number, ticks: number, scalar: number, origin: Origin,
 * }} Burst `at` is milliseconds after the plan starts; `ticks` is the life of a piece in frames (about 16.7 ms each)
 */

export const DELOITTE_GREEN = '#86BC25';
const WHITE = '#FFFFFF';

/** Below this viewport width the counts are scaled down (a phone has less room, and less GPU). */
export const NARROW_WIDTH = 500;
export const NARROW_SCALE = 0.6;

// ---- Colour --------------------------------------------------------------------------------------

/** @param {string} value @returns {[number, number, number] | null} */
export function parseColor(value) {
  const text = String(value ?? '').trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)?.[1];
  if (hex) {
    const full = hex.length === 3 ? hex.split('').map((digit) => digit + digit).join('') : hex.slice(0, 6);
    return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16));
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(text);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])].map((channel) => Math.max(0, Math.min(255, Math.round(channel))));
  return null;
}

/** @param {[number, number, number]} rgb */
export const toHex = (rgb) => `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

/** Hue 0..360, saturation 0..1, lightness 0..1. @param {[number, number, number]} rgb */
export function toHsl([red, green, blue]) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0, lightness };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const sector = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { hue: (sector * 60 + 360) % 360, saturation, lightness };
}

/** Red, and the pinks and brick-oranges that belong to it: never used, because red means "wrong" here. @param {[number, number, number]} rgb */
export function isRedish(rgb) {
  const { hue, saturation } = toHsl(rgb);
  return saturation >= 0.15 && (hue >= 335 || hue <= 20);
}

/** Mixes a colour towards white. `amount` 0 keeps it, 1 is white. @param {[number, number, number]} rgb @param {number} amount @returns {[number, number, number]} */
export const tint = (rgb, amount) => /** @type {[number, number, number]} */ (rgb.map((channel) => Math.round(channel + (255 - channel) * amount)));

/**
 * The confetti colours: Deloitte green, white, the page's --success, and light tints of --action
 * and the client's primary. Anything that is (or tints to) red is left out; anything unreadable is
 * skipped. There are always at least the green and the white.
 *
 * @param {{ success?: string, action?: string, primary?: string }} tokens CSS values as read from the page
 * @returns {string[]} hex colours, no duplicates
 */
export function buildPalette({ success, action, primary } = {}) {
  /** @type {[number, number, number][]} */
  const candidates = [];
  const green = /** @type {[number, number, number]} */ (parseColor(DELOITTE_GREEN));
  candidates.push(green, /** @type {[number, number, number]} */ (parseColor(WHITE)));
  const ok = parseColor(success ?? '');
  if (ok) candidates.push(ok);
  for (const value of [action, primary]) {
    const rgb = parseColor(value ?? '');
    if (rgb) candidates.push(tint(rgb, 0.55));
  }
  const colors = candidates.filter((rgb) => !isRedish(rgb)).map(toHex);
  return [...new Set(colors)].map((hex) => hex.toUpperCase());
}

// ---- Plans ---------------------------------------------------------------------------------------

export const defaultOrigin = /** @type {Origin} */ ({ x: 0.5, y: 0.62 });

/** Where a burst comes from, given the feedback pill: its right end (where "Correct" is printed). @param {{ left: number, top: number, width: number, height: number } | null | undefined} rect @param {{ width: number, height: number }} viewport @returns {Origin} */
export function originFromRect(rect, viewport) {
  if (!rect || !viewport.width || !viewport.height || (rect.width === 0 && rect.height === 0)) return defaultOrigin;
  const clamp = (/** @type {number} */ value) => Math.max(0.05, Math.min(0.95, value));
  return {
    x: clamp((rect.left + rect.width * 0.8) / viewport.width),
    y: clamp((rect.top + rect.height / 2) / viewport.height),
  };
}

/**
 * The bursts for one celebration, or null when there should be none (reduced motion).
 *   small   about 40 pieces, 0.8 s, from near the feedback pill
 *   medium  about 120 pieces from both lower corners, 1.5 s
 *   large   3 bursts over about 2.5 s, about 250 pieces in all
 * Counts are scaled by 0.6 below 500 px wide.
 *
 * @param {ConfettiSize} size
 * @param {{ width: number, reducedMotion?: boolean, origin?: Origin | null }} context
 * @returns {Burst[] | null}
 */
export function confettiPlan(size, { width, reducedMotion = false, origin = null }) {
  if (reducedMotion) return null;
  const scale = width < NARROW_WIDTH ? NARROW_SCALE : 1;
  const count = (/** @type {number} */ base) => Math.max(1, Math.round(base * scale));
  const pieceSize = width < NARROW_WIDTH ? 0.85 : 1;

  if (size === 'small') {
    return [{
      at: 0, count: count(40), angle: 90, spread: 80, startVelocity: 20, gravity: 1.1, ticks: 48, scalar: pieceSize * 1.15,
      origin: origin ?? defaultOrigin,
    }];
  }
  if (size === 'medium') {
    return [
      { at: 0, count: count(60), angle: 60, spread: 55, startVelocity: 52, gravity: 1, ticks: 90, scalar: pieceSize * 1.25, origin: { x: 0, y: 1 } },
      { at: 0, count: count(60), angle: 120, spread: 55, startVelocity: 52, gravity: 1, ticks: 90, scalar: pieceSize * 1.25, origin: { x: 1, y: 1 } },
    ];
  }
  return [
    { at: 0, count: count(90), angle: 90, spread: 100, startVelocity: 55, gravity: 1, ticks: 90, scalar: pieceSize * 1.25, origin: { x: 0.5, y: 0.9 } },
    { at: 500, count: count(80), angle: 60, spread: 60, startVelocity: 55, gravity: 1, ticks: 90, scalar: pieceSize * 1.25, origin: { x: 0, y: 0.95 } },
    { at: 1000, count: count(80), angle: 120, spread: 60, startVelocity: 55, gravity: 1, ticks: 90, scalar: pieceSize * 1.25, origin: { x: 1, y: 0.95 } },
  ];
}

/** How long a plan runs, in milliseconds (the last piece's life is `ticks` frames of 1000/60 ms). @param {Burst[]} plan */
export const planDuration = (plan) => Math.max(...plan.map((burst) => burst.at + (burst.ticks * 1000) / 60));

export const CONFETTI_SIZES = /** @type {ConfettiSize[]} */ (['small', 'medium', 'large']);
