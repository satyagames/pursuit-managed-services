// How much confetti, where from, in which colours, and the finale's petal shower (Prompt 36). Pure (no DOM, no canvas-confetti), so
// `node --test` covers it (scripts/test-effects.js, scripts/test-confetti-plan.js). confetti.ts hands the bursts to the library and draws
// the shower's pieces itself, with no library.

/**
 * @typedef {'small' | 'medium'} ConfettiSize
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
  return [
    { at: 0, count: count(60), angle: 60, spread: 55, startVelocity: 52, gravity: 1, ticks: 90, scalar: pieceSize * 1.25, origin: origin ?? { x: 0, y: 1 } },
    { at: 0, count: count(60), angle: 120, spread: 55, startVelocity: 52, gravity: 1, ticks: 90, scalar: pieceSize * 1.25, origin: origin ?? { x: 1, y: 1 } },
  ];
}

/** How long a plan runs, in milliseconds (the last piece's life is `ticks` frames of 1000/60 ms). @param {Burst[]} plan */
export const planDuration = (plan) => Math.max(...plan.map((burst) => burst.at + (burst.ticks * 1000) / 60));

export const CONFETTI_SIZES = /** @type {ConfettiSize[]} */ (['small', 'medium']);

// ---- The hub's sprays (Prompt 24) ------------------------------------------------------------------

/** The most small sparks alive at once in a hub moment. (All-done's one medium burst is confetti, as the brief asks, and is not counted here.) */
export const MAX_LIVE_SPARKS = 24;

/** How many of `wanted` sparks may be thrown with `live` still in the air. @param {number} live @param {number} wanted */
export const sparkAllowance = (live, wanted) => Math.max(0, Math.min(wanted, MAX_LIVE_SPARKS - live));

/**
 * A small spray from one element, or null below the full motion level. `stamp`: 6 round sparks all round the check badge, in the success green and
 * its tint. `unlock`: 12 fanning upward from the shackle, white and a tint of the client's colour (from buildPalette, so never red).
 * @param {'stamp' | 'unlock'} kind
 * @param {{ rect: { left: number, top: number, width: number, height: number } | null | undefined, viewport: { width: number, height: number },
 *   tokens: { success?: string, action?: string, primary?: string }, level: 'full' | 'reduced' | 'none' }} context
 * @returns {{ bursts: Burst[], colors: string[], shapes: ['circle'] } | null}
 */
export function sparkPlan(kind, { rect, viewport, tokens, level }) {
  if (level !== 'full') return null;
  const origin = originFromRect(rect, viewport);
  if (kind === 'stamp') {
    const green = parseColor(tokens.success ?? '') ?? /** @type {[number, number, number]} */ (parseColor(DELOITTE_GREEN));
    return {
      bursts: [{ at: 0, count: 6, angle: 90, spread: 360, startVelocity: 9, gravity: 0.5, ticks: 30, scalar: 0.7, origin }],
      colors: [toHex(green).toUpperCase(), toHex(tint(green, 0.55)).toUpperCase()],
      shapes: ['circle'],
    };
  }
  // buildPalette gives green, white and the success colour first; what follows it is the client's own tints.
  const tints = buildPalette(tokens).filter((colour) => ![DELOITTE_GREEN, WHITE, (tokens.success ?? '').toUpperCase()].includes(colour));
  return {
    bursts: [{ at: 0, count: 12, angle: 90, spread: 70, startVelocity: 14, gravity: 0.4, ticks: 36, scalar: 0.7, origin }],
    colors: [WHITE, ...(tints.length ? tints : [DELOITTE_GREEN])],
    shapes: ['circle'],
  };
}

// ---- The finale's petal shower (Prompt 36) ----------------------------------------------------------------------------------------
// Petals, discs and thin ribbons fall from above across the whole width in three waves, then a few slow petals drift for the afterglow.
// The waves are data; the loop in confetti.ts asks showerDue how many are due each frame, makes them with makePiece, moves them with
// stepPiece and fades them with pieceAlpha, never more than showerCap alive. A device that falls under 30 frames a second
// (showerStruggling) is cut to SHOWER.struggleCap pieces and spawns no more.

/**
 * @typedef {'petal' | 'disc' | 'ribbon'} PieceShape
 * @typedef {{ name: 'curtain' | 'fall' | 'centre' | 'afterglow', at: number, until: number, rate: number,
 *   region: { left: number, right: number }, sweep: boolean, boost: number, life: [number, number], fade: boolean }} Wave
 *   `at` and `until` in ms from the start; `rate` pieces a second; `region` the viewport fractions they fall over (a `sweep` moves left
 *   to right through it); `boost` scales a piece's speed and size; `life` its shortest and longest life, ms; `fade` fades it all its life.
 * @typedef {{ x: number, y: number, vx: number, vy: number, size: number, shape: PieceShape, color: string, sway: number, swayAmp: number,
 *   swaySpeed: number, rot: number, spin: number, flip: number, flipSpeed: number, born: number, life: number, fade: boolean }} Piece
 */

const GREEN_RGB = /** @type {[number, number, number]} */ (parseColor(DELOITTE_GREEN));

export const SHOWER = Object.freeze({
  /** The most pieces alive at once, and below `narrowWidth` px. */
  cap: 160, narrowCap: 90, narrowWidth: 560,
  /** What a struggling device is cut down to. */
  struggleCap: 40,
  /** The shower is over by this, ms; the afterglow drifts until `afterglowEnd`. */
  showerEnd: 4200, afterglowEnd: 8000,
  /** A narrow screen's rate, as a share. */
  narrowScale: 0.6,
  paleLime: toHex(tint(GREEN_RGB, 0.6)).toUpperCase(),
  paleYellow: '#FFE9A8',
});

/** The most pieces alive at once at this width. @param {number} width */
export const showerCap = (width) => (width < SHOWER.narrowWidth ? SHOWER.narrowCap : SHOWER.cap);

/** The shower's colours: the confetti palette (never red) plus a pale lime and a warm pale yellow. @param {{ success?: string, action?: string, primary?: string }} tokens */
export const showerPalette = (tokens) => [...new Set([...buildPalette(tokens), SHOWER.paleLime, SHOWER.paleYellow])];

/**
 * The waves, or null when there is no shower (any level below full, or the device's reduced motion).
 * @param {{ width: number, reducedMotion?: boolean, level?: 'full' | 'reduced' | 'none' }} context
 * @returns {Wave[] | null}
 */
export function showerPlan({ width, reducedMotion = false, level = 'full' }) {
  if (reducedMotion || level !== 'full') return null;
  const scale = width < SHOWER.narrowWidth ? SHOWER.narrowScale : 1;
  const whole = { left: 0, right: 1 };
  return [
    { name: 'curtain', at: 350, until: 1500, rate: 120 * scale, region: whole, sweep: true, boost: 1.1, life: [2200, 2800], fade: false },
    { name: 'fall', at: 1200, until: 3600, rate: 70 * scale, region: whole, sweep: false, boost: 1, life: [2200, 2800], fade: false },
    { name: 'centre', at: 2400, until: SHOWER.showerEnd, rate: 50 * scale, region: { left: 0.3, right: 0.7 }, sweep: false, boost: 0.9, life: [2000, 2600], fade: false },
    { name: 'afterglow', at: SHOWER.showerEnd, until: SHOWER.afterglowEnd, rate: 6, region: whole, sweep: false, boost: 0.55, life: [2000, 2600], fade: true },
  ];
}

/**
 * How many pieces each wave owes between `from` and `to` (ms), carrying the fractions over to the next frame.
 * @param {Wave[]} plan @param {number} from @param {number} to @param {number[]} carry
 */
export function showerDue(plan, from, to, carry) {
  const counts = [];
  const next = [];
  for (const [index, wave] of plan.entries()) {
    const overlap = Math.max(0, Math.min(to, wave.until) - Math.max(from, wave.at));
    const exact = (carry[index] ?? 0) + (wave.rate * overlap) / 1000;
    counts.push(Math.floor(exact));
    next.push(exact - Math.floor(exact));
  }
  return { counts, carry: next };
}

/**
 * One piece of `wave`, born at `now` just above the top edge.
 * @param {Wave} wave @param {number} now @param {{ width: number, height: number }} view @param {() => number} random @param {string[]} colors
 * @returns {Piece}
 */
export function makePiece(wave, now, view, random, colors) {
  const { left, right } = wave.region;
  let across;
  if (wave.sweep) {
    const progress = Math.max(0, Math.min(1, (now - wave.at) / (wave.until - wave.at)));
    across = left + (right - left) * progress + (random() - 0.5) * 0.24;
  } else {
    across = left + random() * (right - left);
  }
  const pick = random();
  const base = view.width < SHOWER.narrowWidth ? 9 : 12;
  return {
    x: Math.max(-0.02, Math.min(1.02, across)) * view.width,
    y: -(12 + random() * 60),
    vx: (random() - 0.5) * 0.04,
    vy: ((view.height * (0.34 + random() * 0.18)) / 1000) * wave.boost,
    size: base * (0.75 + random() * 0.6) * (0.8 + wave.boost * 0.2),
    shape: pick < 0.45 ? 'petal' : pick < 0.75 ? 'disc' : 'ribbon',
    color: colors[Math.floor(random() * colors.length) % colors.length] ?? DELOITTE_GREEN,
    sway: random() * Math.PI * 2,
    swayAmp: 10 + random() * 20,
    swaySpeed: 0.0015 + random() * 0.0015,
    rot: random() * Math.PI * 2,
    spin: (random() - 0.5) * 0.006,
    flip: random() * Math.PI * 2,
    flipSpeed: 0.004 + random() * 0.005,
    born: now,
    life: wave.life[0] + random() * (wave.life[1] - wave.life[0]),
    fade: wave.fade,
  };
}

/** Moves a piece `dt` ms on; false when it has gone (past its life, or below the bottom edge). @param {Piece} piece @param {number} dt @param {number} now @param {{ height: number }} view */
export function stepPiece(piece, dt, now, view) {
  if (now - piece.born >= piece.life) return false;
  piece.y += piece.vy * dt;
  piece.x += piece.vx * dt;
  piece.sway += piece.swaySpeed * dt;
  piece.rot += piece.spin * dt;
  piece.flip += piece.flipSpeed * dt;
  return piece.y < view.height + piece.size * 2;
}

/** How opaque a piece is at `now`: whole, then fading over its last second (an afterglow petal fades all its life). @param {Piece} piece @param {number} now */
export function pieceAlpha(piece, now) {
  const left = piece.born + piece.life - now;
  if (left <= 0) return 0;
  return Math.min(1, piece.fade ? left / piece.life : left / 1000);
}

/** Is the device under 30 frames a second? Judged on the last 20 frames, and not before there are 20. @param {number[]} deltas ms between frames */
export function showerStruggling(deltas) {
  if (deltas.length < 20) return false;
  const last = deltas.slice(-20);
  return last.reduce((sum, delta) => sum + delta, 0) / last.length > 1000 / 30;
}
