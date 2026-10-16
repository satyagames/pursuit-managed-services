// The Results palette for paper (Phase 11b): the colours of styles/results-tokens.css, read from that file's own text, so the Live display's
// one-page PDF and PowerPoint and the leader report's charts wear exactly what the screen wears, and a change of colour is a change of that one
// file. The admin page hands the file's text in (lib/results-palette-source.ts imports it as text); a node test reads it from disk
// (scripts/results-palette-node.js). Nothing here holds a colour of its own. Plain JS with JSDoc and no DOM.

/** Which token each colour of the palette is. */
export const PALETTE_TOKENS = Object.freeze({
  primary: '--viz-primary',
  tint: '--viz-primary-tint',
  correct: '--viz-correct',
  marker: '--viz-marker',
  brand: '--viz-brand',
  text: '--viz-text',
  textSecondary: '--viz-text-secondary',
  textMuted: '--viz-text-muted',
  grid: '--viz-grid',
  surface: '--viz-surface',
  bandShade: '--viz-band-shade',
});

/** @typedef {{ [K in keyof typeof PALETTE_TOKENS]: string } & { ramps: Record<3 | 4 | 5, string[]> }} Palette */

/**
 * The palette, from the text of results-tokens.css. Every colour is "#RRGGBB" in capitals. A token that is missing (or not a six-digit colour)
 * is refused by name: a file drawn with a guessed colour would be worse than no file.
 * @param {string} css
 * @returns {Palette}
 */
export function readPalette(css) {
  const found = Object.fromEntries([...String(css).matchAll(/(--viz-[a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)].map((match) => [match[1].toLowerCase(), match[2].toUpperCase()]));
  const get = (token) => {
    const value = found[token];
    if (!value) throw new Error(`results-tokens.css has no colour ${token}`);
    return value;
  };
  const named = Object.fromEntries(Object.entries(PALETTE_TOKENS).map(([key, token]) => [key, get(token)]));
  const ramps = Object.fromEntries([3, 4, 5].map((steps) => [steps, Array.from({ length: steps }, (_, index) => get(`--viz-ramp-${steps}-${index + 1}`))]));
  return /** @type {Palette} */ (Object.freeze({ ...named, ramps: Object.freeze(ramps) }));
}

/** The fill of a bar: the correct answer, the top choice, or the rest (the screen's BarChart and SplitBar). @param {Palette} palette @param {'correct' | 'top' | 'rest'} tone */
export const toneFill = (palette, tone) => (tone === 'correct' ? palette.correct : tone === 'top' ? palette.primary : palette.tint);

/**
 * The blue of step `tone` (0 is the lowest) of a scale with `tones` colours: as admin/charts/chart-ui.ts rampColour() picks it on the screen.
 * @param {Palette} palette @param {number} tone @param {number} tones
 */
export function rampFill(palette, tone, tones) {
  if (tones <= 2) return tone === 0 ? palette.ramps[3][0] : palette.ramps[3][2];
  const steps = /** @type {3 | 4 | 5} */ (Math.min(5, tones));
  return palette.ramps[steps][Math.min(steps, tone + 1) - 1];
}
