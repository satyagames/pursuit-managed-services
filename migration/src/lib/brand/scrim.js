// The dark layer over a client's background picture, worked out rather than guessed.
//
// White text must keep 4.5:1 (WCAG AA) wherever it sits, even if the photo under it is pure white, which
// is the worst a photo can be. Three kinds of white-ish text sit on the picture:
//   - words straight on the page                           white on  scrim over the photo
//   - words on a pill or tile (white at 14% over the page)  white on  14% white over (scrim over the photo)
//   - secondary text                                        --text-soft on  scrim over the photo
// The scrim is a flat layer of the page's near-black at some opacity. This finds the smallest opacity at
// which all three pass over pure white, by bisection on the real contrast function (theme.js), then
// rounds UP to a whole percent so what ships is never below the minimum. Plain JS, no DOM: unit-tested in
// scripts/test-brand.js, which also checks that one percent less would fail.

import { MIN_TEXT_CONTRAST, SURFACE_ALPHA, compositeOver, contrastRatio } from './theme.js';

/** The brightest a photo can be. */
export const WORST_PHOTO = '#FFFFFF';
/** The scrim's colour: the page's fixed top colour (tokens.css --bg-top). */
export const SCRIM_COLOUR = '#000102';
/** --text-soft in tokens.css: the dimmest text that is drawn straight on the page. */
export const SOFT_TEXT = '#D6E4FA';

/**
 * Contrast of the worst text over a photo of colour `photo` under a scrim of opacity `alpha`.
 * @param {number} alpha 0..1
 * @param {{ photo?: string, scrim?: string, surfaceAlpha?: number }} [options]
 */
export function worstTextContrast(alpha, { photo = WORST_PHOTO, scrim = SCRIM_COLOUR, surfaceAlpha = SURFACE_ALPHA } = {}) {
  const page = compositeOver(scrim, alpha, photo);
  return Math.min(
    contrastRatio('#FFFFFF', page),
    contrastRatio('#FFFFFF', compositeOver('#FFFFFF', surfaceAlpha, page)),
    contrastRatio(SOFT_TEXT, page),
  );
}

/**
 * The smallest scrim opacity (0..1, to 4 places) at which `worstTextContrast` reaches `minimum`.
 * @param {{ photo?: string, scrim?: string, surfaceAlpha?: number, minimum?: number }} [options]
 */
export function minimumScrimAlpha({ minimum = MIN_TEXT_CONTRAST, ...options } = {}) {
  if (worstTextContrast(0, options) >= minimum) return 0;
  let low = 0; // fails
  let high = 1; // passes
  if (worstTextContrast(1, options) < minimum) throw new RangeError('No scrim can make this text readable.');
  while (high - low > 1e-5) {
    const middle = (low + high) / 2;
    if (worstTextContrast(middle, options) >= minimum) high = middle;
    else low = middle;
  }
  return Math.ceil(high * 10_000) / 10_000;
}

/** The opacity the page uses: the minimum, rounded up to a whole percent. */
export const SCRIM_ALPHA = Math.ceil(minimumScrimAlpha() * 100) / 100;
