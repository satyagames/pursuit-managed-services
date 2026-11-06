// How much confetti, where from, in which colours, and the finale's petal shower (Prompt 36). Pure (no DOM, no canvas-confetti), so
// `node --test` covers it (scripts/test-effects.js, scripts/test-confetti-plan.js). confetti.ts hands the bursts to the library and draws
// the shower's pieces itself, with no library.

/**
 * @typedef {'small' | 'medium'} ConfettiSize
 * @typedef {{ x: number, y: number }} Origin viewport fractions, 0..1 from the top-left
 * @typedef {{
 *   at: number, count: number, angle: number, spread: number, startVelocity: number,
 *   gravity: number, ticks: number, scalar: number, origin: Origin,
 *   drift?: number, decay?: number,
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
// Petals, discs and thin ribbons fall from just above the top edge across the whole width in three waves, then a few slow petals drift for the
// afterglow. The plan is a list of small bursts (the same Burst every other celebration uses, aimed down), one every SHOWER.step ms in each
// wave, so confetti.ts fires them on the one overlay through the same library: its pieces tilt and wobble as they fall, which reads as a petal
// turning over, and fade over their life. The plan counts what is alive and never lets it pass the cap.

/** @typedef {Burst & { wave: 'curtain' | 'fall' | 'centre' | 'afterglow', drift: number, decay: number }} Drop */

const GREEN_RGB = /** @type {[number, number, number]} */ (parseColor(DELOITTE_GREEN));

export const SHOWER = Object.freeze({
  /** The most pieces alive at once, and below `narrowWidth` px. */
  cap: 160, narrowCap: 90, narrowWidth: 560,
  /** The shower is over by this, ms; the afterglow drifts until `afterglowEnd`. */
  showerEnd: 4200, afterglowEnd: 8000,
  /** One burst every this many ms in each wave. */
  step: 120,
  paleLime: toHex(tint(GREEN_RGB, 0.6)).toUpperCase(),
  paleYellow: '#FFE9A8',
});

/** The petal (two curves to a point) and the ribbon, as paths about 10 units across with their own matrix, so the library never measures them. */
export const SHOWER_SHAPES = Object.freeze({
  petal: { path: 'M0 -5Q3.8 0 0 5Q-3.8 0 0 -5Z', matrix: [1, 0, 0, 1, 0, 0] },
  ribbon: { path: 'M-0.7 -5H0.7V5H-0.7Z', matrix: [1, 0, 0, 1, 0, 0] },
});

/** The most pieces alive at once at this width. @param {number} width */
export const showerCap = (width) => (width < SHOWER.narrowWidth ? SHOWER.narrowCap : SHOWER.cap);

/** The shower's colours: the confetti palette (never red) plus a pale lime and a warm pale yellow. @param {{ success?: string, action?: string, primary?: string }} tokens */
export const showerPalette = (tokens) => [...new Set([...buildPalette(tokens), SHOWER.paleLime, SHOWER.paleYellow])];

/** How many pieces of `plan` are alive at `now` ms. @param {Burst[]} plan @param {number} now */
export const showerAlive = (plan, now) => plan.reduce((sum, burst) => sum + (now >= burst.at && now < burst.at + (burst.ticks * 1000) / 60 ? burst.count : 0), 0);

/**
 * The shower's bursts in time order, or null when there is none (any level below full, or the device's reduced motion).
 * @param {{ width: number, height: number, reducedMotion?: boolean, level?: 'full' | 'reduced' | 'none', random?: () => number }} context
 * @returns {Drop[] | null}
 */
export function showerPlan({ width, height, reducedMotion = false, level = 'full', random = Math.random }) {
  if (reducedMotion || level !== 'full') return null;
  const narrow = width < SHOWER.narrowWidth;
  // A tenth held back: in a browser the timers fire a little late and a piece lives a number of frames, so the bursts overlap a little more than planned.
  const cap = Math.floor(showerCap(width) * 0.9);
  /** [wave, from, until, pieces a second, left, right, sweeps, speed, life ms] */
  const waves = /** @type {const} */ ([
    ['curtain', 350, 1500, 120, 0, 1, true, 1.1, 2500],
    ['fall', 1200, 3600, 70, 0, 1, false, 1, 2500],
    ['centre', 2400, SHOWER.showerEnd, 50, 0.3, 0.7, false, 0.9, 2300],
    ['afterglow', SHOWER.showerEnd, SHOWER.afterglowEnd, 6, 0, 1, false, 0.55, 2300],
  ]);
  /** @type {Drop[]} */
  const plan = [];
  for (const [wave, from, until, rate, left, right, sweeps, speed, life] of waves) {
    let owed = 0;
    for (let at = from; at < until; at += SHOWER.step) {
      owed += ((wave === 'afterglow' || !narrow ? rate : rate * 0.6) * SHOWER.step) / 1000;
      const ticks = Math.round(((life + (random() - 0.5) * 400) * 60) / 1000);
      // The most alive while these would be: at their start, and at the start of each burst already planned within their life.
      const end = at + (ticks * 1000) / 60;
      const peak = Math.max(showerAlive(plan, at), ...plan.filter((burst) => burst.at > at && burst.at < end).map((burst) => showerAlive(plan, burst.at)));
      const count = Math.min(Math.floor(owed), cap - peak);
      if (count < 1) continue;
      owed -= count;
      const across = sweeps ? left + (right - left) * ((at - from) / (until - from)) + (random() - 0.5) * 0.2 : left + random() * (right - left);
      plan.push({
        wave, at, count, ticks, angle: 270, spread: 50, startVelocity: 3, decay: 0.94, drift: (random() - 0.5) * 1.2,
        // The library moves a piece 3 x gravity px a frame: through about the screen's height in its life.
        gravity: (height * (0.95 + random() * 0.4) * speed) / (3 * ticks),
        scalar: (narrow ? 0.9 : 1.1) * (0.9 + speed * 0.2), origin: { x: Math.max(0, Math.min(1, across)), y: -0.05 },
      });
    }
  }
  return plan.sort((a, b) => a.at - b.at);
}
