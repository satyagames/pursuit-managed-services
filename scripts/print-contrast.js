// Phase 11b, item D: the contrast of what a laid-out page draws, measured against what is under it. Used by scripts/test-results-export.js (the
// Live display's one-page PDF and PowerPoint) and scripts/test-leader-report-charts.js (the leader report).
//
// Each word must have 4.5:1 against its ground and each mark that carries meaning (a bar, a column, a tick, a cross, the scale's average) 3:1, where
// the ground is the fill of the last rectangle drawn before it that holds the point the item is drawn at (else the white page). Two kinds of mark
// are measured and listed apart, never failed: a bar in the tint and a scale's light steps, which the Results palette holds at 2:1 or more
// (styles/results-tokens.css: "every bar has its value written beside it"); for those the test holds instead that the value IS written beside them.

import { contrastRatio } from '../migration/src/lib/brand/theme.js';

export const WORDS = 4.5;
export const MARKS = 3;

/** "0076a8", "#0076A8" as "#0076A8". */
export const colourOf = (value) => `#${String(value).replace(/^#/, '').toUpperCase()}`;

/**
 * @param {{ items: any[] }[]} pages
 * @param {{ pointOf: (item: any) => [number, number], light?: (item: any) => boolean }} options `pointOf` is where an item is drawn (its words'
 *   middle); `light` says whether a mark is one the palette holds at 2:1 with its value written beside it.
 * @returns {{ problems: string[], light: { what: string, ratio: number }[], measured: number }}
 */
export function contrastOf(pages, { pointOf, light = () => false }) {
  const problems = [];
  const lightMarks = [];
  let measured = 0;
  pages.forEach((page, index) => {
    const drawn = [];
    for (const item of page.items) {
      if (item.kind === 'rect' && item.fill) {
        const ground = groundAt(drawn, item.x + item.w / 2, item.y + item.h / 2);
        if (item.role === 'bar') check(item, colourOf(item.fill), ground, `page ${index + 1}: the bar of ${item.of ?? '?'} (${item.tone ?? 'step'})`);
        drawn.push(item);
        continue;
      }
      if (item.kind === 'text') {
        if (!String(item.text ?? '').trim()) continue;
        const [x, y] = pointOf(item);
        const ratio = contrastRatio(colourOf(item.color), groundAt(drawn, x, y));
        measured += 1;
        if (ratio < WORDS) problems.push(`page ${index + 1}: "${String(item.text).slice(0, 40)}" is ${ratio.toFixed(2)}:1 on ${groundAt(drawn, x, y)}`);
      } else if (item.kind === 'tick' || item.kind === 'cross') {
        check(item, colourOf(item.color), groundAt(drawn, item.x + item.size / 2, item.y + item.size / 2), `page ${index + 1}: a ${item.kind}`);
      } else if (item.kind === 'line' && item.role === 'average') {
        check(item, colourOf(item.color), groundAt(drawn, item.x, (item.y + item.y2) / 2), `page ${index + 1}: the scale's average`);
      }
    }
  });
  return { problems, light: lightMarks, measured };

  function check(item, colour, ground, what) {
    const ratio = contrastRatio(colour, ground);
    measured += 1;
    if (light(item)) { lightMarks.push({ what, ratio }); return; }
    if (ratio < MARKS) problems.push(`${what} is ${ratio.toFixed(2)}:1 on ${ground}`);
  }
}

/** The fill under (x, y): the last rectangle drawn so far that holds it, or the white page. */
function groundAt(drawn, x, y) {
  for (let at = drawn.length - 1; at >= 0; at -= 1) {
    const rect = drawn[at];
    if (x >= rect.x - 0.01 && x <= rect.x + rect.w + 0.01 && y >= rect.y - 0.01 && y <= rect.y + rect.h + 0.01) return colourOf(rect.fill);
  }
  return '#FFFFFF';
}
