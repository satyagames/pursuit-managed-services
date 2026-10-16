// Palette derivation for the participant theme (PMS-IMPLEMENTATION-PLAN.md, 2.2 and 4.4, in git history at 7347c72).
//
// Pure maths plus one DOM write (applyTheme). Plain JS with JSDoc so that both the Svelte
// app and `node --test` (scripts/test-theme.js) can import it without a build step.
//
//   deriveTheme('#045BCC')  ->  the mockup palette, exactly (Design-Docs/references/Operate_Experience_Prototype_Mockup.pdf, in git history at 7347c72)
//   deriveTheme(primary, accent?)  ->  the same relationships applied to another colour,
//                                       with white text kept at >= 4.5:1 (WCAG AA)
//
// The PRIMARY colours the page and every control (CTA, Next, Home, Retry, pills, tiles). The ACCENT
// is decoration only: the thin rule and the ring on the logo plate, and each of those only where
// the accent stands out from what it is drawn on. An accent never fills a control: a client's red
// accent on a button reads as the fixed red of a wrong answer.
//
// How the derived colours are chosen: the mockup gives one primary (#045BCC) and the colours
// sampled beside it (bottom of the gradient, the CTA, the locked pill). Rather than
// hard-coding those, each is expressed as the HSL change that turns the mockup primary into
// it, and that same change is applied to any other primary. So the mockup colour reproduces
// the mockup palette by construction and other colours keep its look.

/** @typedef {Record<string, string>} ThemeTokens CSS custom property name -> value. */
/**
 * @typedef {object} ThemeAdjustment
 * @property {string} token  The custom property that was changed.
 * @property {string} from   The colour that was asked for.
 * @property {string} to     The colour used instead.
 * @property {string} reason Why, in words an admin can read.
 */
/**
 * @typedef {object} Theme
 * @property {ThemeTokens} tokens
 * @property {{ surface: number, action: number }} contrast White text against the surface (the
 *   worst point of the gradient) and against the action colour, after adjustment.
 * @property {ThemeAdjustment[]} adjustments Empty when nothing had to change. An accent that could
 *   not be used for the rule or the ring is reported here too, with the reason.
 */

/** Lowest contrast allowed for normal-size text (WCAG 2.x AA). */
export const MIN_TEXT_CONTRAST = 4.5;
/** White overlay used by pills and tiles. 14% keeps white text above AA (plan 2.2). */
export const SURFACE_ALPHA = 0.14;
/** Lowest contrast allowed for a graphic against what it is drawn on (WCAG 2.x 1.4.11). */
export const MIN_GRAPHIC_CONTRAST = 3;
/** The primary the mockup was drawn with; the default theme. */
export const DEFAULT_PRIMARY = '#045BCC';
/** A colour whose hue is within this many degrees of the wrong-answer red reads as "wrong". */
export const DANGER_HUE_MARGIN = 30;

/** Every control fill: these follow the primary, or are fixed. Never the accent, and never a stored value (client-theme.js). */
export const CONTROL_TOKENS = Object.freeze(['--surface', '--surface-border', '--action', '--action-border', '--disabled', '--on-disabled']);
/** The only tokens the accent may colour, and the only places it shows: Divider and HeroPlate. */
export const ACCENT_TOKENS = Object.freeze(['--accent-rule', '--accent-ring']);

const WHITE = '#FFFFFF';

/** The two plates a client's logo can sit on (Brand Studio's "Plate"): white for dark logos, dark for white ones. */
export const PLATE_COLOURS = Object.freeze({ light: '#FFFFFF', dark: '#0B1F3A' });

/** Colours that never change with the client (plan 2.2: correct/wrong stay fixed, Deloitte green). */
const FIXED = Object.freeze({
  bgTop: '#000102',
  success: '#09FF53',
  onSuccess: '#000000',
  danger: '#E00000', // the mockup's #FF0000 is only 4.0:1 with white text
  dangerTint: '#4F3982',
  focus: '#86BC25', // Deloitte green
  progress: '#86BC25',
  plate: PLATE_COLOURS.light, // the white plate behind a client logo (tokens.css --plate)
  noRing: 'rgb(255 255 255 / 0)', // no accent, or one that does not show on the plate: no ring
});

/** Colours sampled from the mockup beside DEFAULT_PRIMARY. */
const MOCKUP = Object.freeze({
  bottom: '#0444A8',
  action: '#296CD4',
  disabled: '#034CB5',
  onDisabled: '#4D80D0',
});

// ---- Colour maths -----------------------------------------------------------------------

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * '#abc' or '#aabbcc' (any case) as '#AABBCC'.
 * @param {string} value
 * @returns {string}
 */
export function normalizeHex(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = HEX.exec(text);
  if (!match) throw new TypeError(`Expected a #rgb or #rrggbb colour, got ${JSON.stringify(value)}`);
  const digits = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join('') : match[1];
  return `#${digits.toUpperCase()}`;
}

/** @param {string} hex @returns {[number, number, number]} */
function channels(hex) {
  const digits = normalizeHex(hex).slice(1);
  return [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16));
}

/** @param {readonly number[]} rgb */
function toHex(rgb) {
  return `#${rgb.map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** WCAG relative luminance of a colour, 0 (black) to 1 (white). @param {string} hex */
export function relativeLuminance(hex) {
  const [red, green, blue] = channels(hex).map((value) => {
    const unit = value / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * WCAG contrast ratio between two opaque colours, 1 to 21, in either order.
 * @param {string} first
 * @param {string} second
 */
export function contrastRatio(first, second) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * What `foreground` at `alpha` looks like on top of `background`.
 * @param {string} foreground
 * @param {number} alpha 0..1
 * @param {string} background
 */
export function compositeOver(foreground, alpha, background) {
  const top = channels(foreground);
  const bottom = channels(background);
  return toHex(top.map((value, index) => value * alpha + bottom[index] * (1 - alpha)));
}

/** @param {string} hex @returns {{ h: number, s: number, l: number }} h in degrees, s and l in 0..1 */
function toHsl(hex) {
  const [red, green, blue] = channels(hex).map((value) => value / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === red) h = ((green - blue) / delta) % 6;
  else if (max === green) h = (blue - red) / delta + 2;
  else h = (red - green) / delta + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/** @param {{ h: number, s: number, l: number }} hsl */
function fromHsl({ h, s, l }) {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const spread = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const offset = l - chroma / 2;
  const sector = Math.floor(((h % 360) + 360) % 360 / 60);
  const [red, green, blue] = [
    [chroma, spread, 0], [spread, chroma, 0], [0, chroma, spread],
    [0, spread, chroma], [spread, 0, chroma], [chroma, 0, spread],
  ][sector];
  return toHex([red + offset, green + offset, blue + offset].map((value) => value * 255));
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/**
 * A function that gives any colour the relationship `target` has to DEFAULT_PRIMARY: the
 * same hue shift, and the same saturation and lightness ratios.
 * @param {string} target
 * @returns {(hex: string) => string}
 */
function followMockup(target) {
  const base = toHsl(DEFAULT_PRIMARY);
  const goal = toHsl(target);
  const hueShift = goal.h - base.h;
  const saturation = base.s === 0 ? 1 : goal.s / base.s;
  const lightness = base.l === 0 ? 1 : goal.l / base.l;
  return (hex) => {
    const { h, s, l } = toHsl(hex);
    return fromHsl({ h: (h + hueShift + 360) % 360, s: clamp01(s * saturation), l: clamp01(l * lightness) });
  };
}

const bottomOf = followMockup(MOCKUP.bottom);
const actionOf = followMockup(MOCKUP.action);
const disabledOf = followMockup(MOCKUP.disabled);
const onDisabledOf = followMockup(MOCKUP.onDisabled);

/**
 * `hex`, darkened in 0.5% lightness steps until `passes(colour)` holds (or it is black).
 * @param {string} hex
 * @param {(colour: string) => boolean} passes
 */
function darkenUntil(hex, passes) {
  let colour = hex;
  const { h, s } = toHsl(hex);
  let { l } = toHsl(hex);
  while (!passes(colour) && l > 0) {
    l = Math.max(0, l - 0.005);
    colour = fromHsl({ h, s, l });
  }
  return colour;
}

/** Contrast of white text on a pill/tile sitting on `background`. @param {string} background */
const whiteOnSurface = (background) => contrastRatio(WHITE, compositeOver(WHITE, SURFACE_ALPHA, background));

/**
 * A colour's hue in degrees (0 to 360), or null for a grey, which has none.
 * @param {string} hex
 * @returns {number | null}
 */
export function hueOf(hex) {
  const { h, s, l } = toHsl(hex);
  return s < 0.08 || l < 0.03 || l > 0.97 ? null : h;
}

/**
 * How far a colour's hue is from the wrong-answer red, in degrees (0 to 180). Infinity for a grey.
 * @param {string} hex
 */
export function dangerHueDistance(hex) {
  const hue = hueOf(hex);
  if (hue === null) return Infinity;
  const apart = Math.abs(hue - toHsl(FIXED.danger).h) % 360;
  return Math.min(apart, 360 - apart);
}

/**
 * True when a colour is close enough to the wrong-answer red to be mistaken for it. Brand Studio
 * must warn about an accent like this (MIGRATION-PLAN.md), and no control may be filled with one.
 * @param {string} hex
 */
export const isNearDangerHue = (hex) => dangerHueDistance(hex) <= DANGER_HUE_MARGIN;

// ---- Public API -------------------------------------------------------------------------

/**
 * Builds the palette for a client.
 *
 * @param {string} primaryHex  Page colour at the middle of the gradient. Darkened if a white
 *   overlay on it could not carry white text at 4.5:1.
 * @param {string} [accentHex] Optional decorative colour: the thin rule and the ring on the logo
 *   plate, each only where it has 3:1 against what it is drawn on (the whole page gradient, the
 *   plate). It never changes a control: the action colour always comes from the primary.
 * @param {{ plate?: 'light' | 'dark' }} [options] Which plate the ring is drawn on: the white one
 *   (the default) or the dark one a white logo needs. Nothing else depends on it.
 * @returns {Theme}
 * @throws {TypeError} when a colour is not #rgb or #rrggbb.
 */
export function deriveTheme(primaryHex, accentHex, { plate = 'light' } = {}) {
  const primary = normalizeHex(primaryHex);
  const accent = accentHex == null || accentHex === '' ? null : normalizeHex(accentHex);
  /** @type {ThemeAdjustment[]} */
  const adjustments = [];

  // The lightest part of the gradient is the middle (the primary) or, if the derived bottom
  // were lighter, the bottom, so both have to carry the overlay.
  const surfaceOk = (mid) => Math.min(whiteOnSurface(mid), whiteOnSurface(bottomOf(mid))) >= MIN_TEXT_CONTRAST;
  const mid = darkenUntil(primary, surfaceOk);
  if (mid !== primary) {
    adjustments.push({
      token: '--bg-mid', from: primary, to: mid,
      reason: `White text on the translucent pills needs ${MIN_TEXT_CONTRAST}:1; ${primary} is too light.`,
    });
  }
  const bottom = bottomOf(mid);

  const wantedAction = actionOf(mid);
  const action = darkenUntil(wantedAction, (colour) => contrastRatio(WHITE, colour) >= MIN_TEXT_CONTRAST);
  if (action !== wantedAction) {
    adjustments.push({
      token: '--action', from: wantedAction, to: action,
      reason: `White button text needs ${MIN_TEXT_CONTRAST}:1; ${wantedAction} is too light.`,
    });
  }

  // The accent, where it shows. The rule can sit anywhere on the gradient, so it has to stand
  // out from all three of its colours; the ring is drawn on the white plate.
  const clears = (/** @type {string[]} */ grounds) => accent !== null && grounds.every((ground) => contrastRatio(accent, ground) >= MIN_GRAPHIC_CONTRAST);
  const rule = clears([FIXED.bgTop, mid, bottom]) ? /** @type {string} */ (accent) : WHITE;
  const plateColour = PLATE_COLOURS[plate] ?? PLATE_COLOURS.light;
  const ring = clears([plateColour]) ? /** @type {string} */ (accent) : FIXED.noRing;
  if (accent !== null && rule !== accent) {
    adjustments.push({
      token: '--accent-rule', from: accent, to: rule,
      reason: `The thin rule needs ${MIN_GRAPHIC_CONTRAST}:1 against the page; ${accent} is ${Math.min(...[FIXED.bgTop, mid, bottom].map((ground) => contrastRatio(accent, ground))).toFixed(1)}:1 at its weakest, so the rule stays white.`,
    });
  }
  if (accent !== null && ring !== accent) {
    adjustments.push({
      token: '--accent-ring', from: accent, to: ring,
      reason: `The ring on the logo plate needs ${MIN_GRAPHIC_CONTRAST}:1 against ${plateColour === PLATE_COLOURS.light ? 'white' : 'the dark plate'}; ${accent} is ${contrastRatio(accent, plateColour).toFixed(1)}:1, so there is no ring.`,
    });
  }

  return {
    tokens: {
      '--bg-top': FIXED.bgTop,
      '--bg-mid': mid,
      '--bg-bottom': bottom,
      '--surface': `rgb(255 255 255 / ${SURFACE_ALPHA})`,
      '--surface-border': WHITE,
      '--action': action,
      '--action-border': 'rgb(255 255 255 / 0.7)',
      '--success': FIXED.success,
      '--on-success': FIXED.onSuccess,
      '--danger': FIXED.danger,
      '--danger-tint': FIXED.dangerTint,
      '--disabled': disabledOf(mid),
      '--on-disabled': onDisabledOf(mid),
      '--focus': FIXED.focus,
      '--progress': FIXED.progress,
      '--accent-rule': rule,
      '--accent-ring': ring,
    },
    contrast: {
      surface: Math.min(whiteOnSurface(mid), whiteOnSurface(bottom)),
      action: contrastRatio(WHITE, action),
    },
    adjustments,
  };
}

const TOKEN_NAME = /^--(?:bg-top|bg-mid|bg-bottom|surface|surface-border|action|action-border|success|on-success|danger|danger-tint|disabled|on-disabled|focus|progress|accent-rule|accent-ring)$/;
// Hex, or the rgb(r g b / a) form deriveTheme writes. Anything else never reaches the stylesheet.
const TOKEN_VALUE = /^(?:#[0-9a-f]{6}|rgb\(\s*\d{1,3}\s+\d{1,3}\s+\d{1,3}(?:\s*\/\s*(?:0|1|0?\.\d{1,3}))?\s*\))$/i;

/**
 * Writes theme tokens onto an element (default: <html>) as inline custom properties, which
 * beat the defaults in tokens.css. Tokens come from an admin form, so only the known names
 * and plain colour values are accepted; anything else throws and nothing is applied.
 *
 * @param {ThemeTokens} tokens
 * @param {{ style: { setProperty(name: string, value: string): void } }} [root]
 * @returns {string[]} the names that were set
 */
export function applyTheme(tokens, root = globalThis.document?.documentElement) {
  if (!root) throw new Error('applyTheme needs an element to write to.');
  const entries = Object.entries(tokens);
  for (const [name, value] of entries) {
    if (!TOKEN_NAME.test(name)) throw new TypeError(`Unknown theme token ${JSON.stringify(name)}`);
    if (typeof value !== 'string' || !TOKEN_VALUE.test(value.trim())) {
      throw new TypeError(`Theme token ${name} has an unsafe value ${JSON.stringify(value)}`);
    }
  }
  for (const [name, value] of entries) root.style.setProperty(name, value.trim());
  return entries.map(([name]) => name);
}

/**
 * Removes every inline theme token, so the defaults in tokens.css apply again.
 *
 * @param {{ style: { removeProperty(name: string): unknown } }} [root]
 */
export function resetTheme(root = globalThis.document?.documentElement) {
  if (!root) throw new Error('resetTheme needs an element to write to.');
  for (const name of Object.keys(deriveTheme(DEFAULT_PRIMARY).tokens)) root.style.removeProperty(name);
}
