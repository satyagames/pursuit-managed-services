// The look of the exported files (Prompt 34): the colours the session pack (PDF and PowerPoint, lib/exports/resultsExport.js) and the leader
// report (lib/exports/leader-report*.js) draw with, and the pairs they are held to. The values are the admin page's own tokens
// (migration/src/styles/admin-tokens.css, Prompt 31), written here once as hex because jsPDF and PptxGenJS cannot read CSS; each one is named
// after its token in LOOK_TOKENS, and scripts/test-admin-today.js fails when a value here and its token differ, so the page and the files cannot
// drift. No colour is added: a file draws with these and nothing else. Plain JS, no DOM.
//
// The rules the files keep with them:
//   - Lime and sky are marks, never words on white (2.3:1 and 2.8:1): a lime bar or a sky rule under words always has a word or a label beside it.
//   - The highlighter is black words on lime (9.2:1); the dark text token on lime is only 7.7:1, under the 7.9:1 the owner asked for.
//   - On black (the wall, and a dark figures page) words and figures are white or lime, both 7:1 or better.
//   - Charts take CHART_ORDER in order: deep green, lime, sky, teal, link blue.

import { contrastRatio } from '../brand/theme.js';

/** Each colour of the files, by the admin token it equals. */
export const LOOK_TOKENS = Object.freeze({
  page: 'adm-card',
  black: 'adm-bar-black',
  wash: 'adm-wash',
  cardLine: 'adm-card-line',
  text: 'adm-text',
  textMuted: 'adm-text-muted',
  onDeep: 'adm-on-deep',
  deep: 'adm-deep',
  green: 'adm-green',
  lime: 'adm-lime',
  greenWash: 'adm-green-wash',
  teal: 'adm-teal',
  tealWash: 'adm-teal-wash',
  link: 'adm-link',
  sky: 'adm-sky',
});

/** The colours, as "#RRGGBB". */
export const LOOK = Object.freeze({
  page: '#FFFFFF',
  black: '#000000',
  wash: '#F5F7F4',
  cardLine: '#BFD6A8',
  text: '#1A1A1A',
  textMuted: '#4D5651',
  onDeep: '#FFFFFF',
  deep: '#046A38',
  green: '#237F0C',
  lime: '#86BC25',
  greenWash: '#E9F3DF',
  teal: '#0B7684',
  tealWash: '#E3F3F5',
  link: '#0076A8',
  sky: '#00A3E0',
});

/** The order a chart's series take (Prompt 31): deep green, lime, sky blue, teal, link blue. */
export const CHART_ORDER = Object.freeze(['deep', 'lime', 'sky', 'teal', 'link']);

/** Words on their surfaces in the files: 4.5:1. [ink, ground]. */
export const TEXT_PAIRS = Object.freeze([
  ['text', 'page'], ['textMuted', 'page'], ['deep', 'page'], ['link', 'page'], ['teal', 'page'],
  ['text', 'greenWash'], ['textMuted', 'greenWash'], ['deep', 'greenWash'], ['text', 'wash'], ['deep', 'wash'],
  ['onDeep', 'deep'], ['onDeep', 'green'], ['onDeep', 'black'], ['lime', 'black'],
]);

/** Marks that carry meaning (a check mark, a badge's line, a bar with no fill beside it): 3:1. */
export const MARK_PAIRS = Object.freeze([['green', 'page'], ['deep', 'page'], ['teal', 'page'], ['link', 'page'], ['deep', 'greenWash'], ['lime', 'black']]);

/** The wall's words and figures on black, read from the back of a room: 7:1. */
export const WALL_PAIRS = Object.freeze([['onDeep', 'black'], ['lime', 'black']]);

/** The highlighter: black words on a lime block, 7.9:1 or better. */
export const HIGHLIGHT_PAIR = Object.freeze(['black', 'lime']);

/**
 * Every pair of `look` under its least, as "ink on ground: 4.42 (needs 4.5)"; [] when all pass.
 * @param {Record<string, string>} look
 */
export function lookFailures(look) {
  const failures = [];
  for (const [pairs, least] of /** @type {const} */ ([[TEXT_PAIRS, 4.5], [MARK_PAIRS, 3], [WALL_PAIRS, 7], [[HIGHLIGHT_PAIR], 7.9]])) {
    for (const [ink, ground] of pairs) {
      const ratio = contrastRatio(look[ink], look[ground]);
      if (!(ratio >= least)) failures.push(`${ink} on ${ground}: ${ratio.toFixed(2)} (needs ${least})`);
    }
  }
  return failures;
}

/** A colour as the writers take it: "#046A38" as "046A38" (PptxGenJS), or as [r, g, b] (jsPDF). */
export const hexOf = (/** @type {string} */ colour) => colour.slice(1);
export const rgbOf = (/** @type {string} */ colour) => [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16));
