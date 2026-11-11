// The rules behind the Art of Possibility's one calm screen (Prompt 35), with no DOM (scripts/test-aop-view.js): which view a guest starts in, the counts
// of the summary, a finished row, and the per-box update. pager/MatrixRating.svelte draws what this says.
//
// The per-box update changes one box of the guest's grid in place (in the page the grid is Svelte state, so only that box, its row and the strip are
// drawn again) instead of copying the whole grid on every tap; lib/participant/aop-answer.js's encodeAnswer then stores exactly what a copy stored.

import { LEVELS, cellsLeft } from './aop-answer.js';
import { TOKENS } from '../motion/motion-plan.js';

/** @typedef {import('./aop-answer.js').Grid} Grid */
/** @typedef {import('./aop-answer.js').Shape} Shape */

/**
 * The narrowest each part of the grid may be, px: the sub-process column, the People column, a criterion (112 px, equal, a heading in at most two lines
 * of whole words: Prompt 42), and the page's gutters with the card's own padding (32 px each side; the 8 px kept beside the first and last columns is
 * inside those columns). Six criteria or more (`dense`, past the brief's five) may narrow to Prompt 35's 96 px, with a narrower first column.
 * MatrixRating.svelte's narrow-screen columns are these numbers.
 */
export const GRID_MIN_WIDTH = Object.freeze({ process: 100, people: 52, criterion: 112, frame: 105, dense: Object.freeze({ from: 6, process: 86, criterion: 96 }) });

/** The narrowest window, px, in which the grid of `criteria` criteria fits with no sideways scroll. @param {number} criteria */
export function gridWidthFor(criteria) {
  const { process, criterion } = criteria >= GRID_MIN_WIDTH.dense.from ? GRID_MIN_WIDTH.dense : GRID_MIN_WIDTH;
  return process + GRID_MIN_WIDTH.people + criteria * criterion + GRID_MIN_WIDTH.frame;
}

/** The width from which a landscape window starts in the grid. */
export const GRID_FROM = 700;

/**
 * The view a guest starts in: the grid on a laptop or an iPad in landscape (700 px or wider, wider than tall, and wide enough for this many
 * criteria), one at a time otherwise. What they chose this visit wins.
 * @param {{ width: number, height: number, criteria: number, chosen?: 'grid' | 'single' | null }} input
 * @returns {'grid' | 'single'}
 */
export function defaultView({ width, height, criteria, chosen = null }) {
  if (chosen) return chosen;
  return width >= GRID_FROM && width > height && width >= gridWidthFor(criteria) ? 'grid' : 'single';
}

/** How many boxes are Low, Medium and High, of the rows and criteria the question has now. @param {Grid} grid @param {Shape} shape */
export function levelCounts(grid, { rows, criteria }) {
  /** @type {Record<number, number>} */
  const counts = { 1: 0, 2: 0, 3: 0 };
  for (const row of rows) for (const criterion of criteria) {
    const level = grid?.[row.id]?.[criterion.id];
    if (LEVELS.includes(level)) counts[level] += 1;
  }
  return counts;
}

/** Every criterion of the row has a rating. @param {Grid} grid @param {Shape} shape @param {string} rowId */
export const rowIsDone = (grid, { criteria }, rowId) => criteria.length > 0 && criteria.every((criterion) => LEVELS.includes(grid?.[rowId]?.[criterion.id]));

/**
 * Changes one box in place: a level sets it, undefined clears it. @param {Grid} grid @param {string} rowId @param {string} criterionId
 * @param {number | undefined} level
 */
export function setCell(grid, rowId, criterionId, level) {
  if (level === undefined) { if (grid[rowId]) delete grid[rowId][criterionId]; return; }
  (grid[rowId] ??= {})[criterionId] = level;
}

/** How long One at a time shows a finished sub-process before the next, ms (the motion token --motion-aop-advance). */
export const ADVANCE_MS = TOKENS.aop.advance;

/**
 * Whether One at a time moves on by itself: the rating just finished this sub-process, it is not the last, and motion is on (with motion off the guest
 * moves on with Next, so nothing changes under them). @param {{ wasDone: boolean, isDone: boolean, at: number, count: number, level: 'full' | 'reduced' | 'none' }} input
 */
export const advancesAfter = ({ wasDone, isDone, at, count, level }) => !wasDone && isDone && at < count - 1 && level !== 'none';

/**
 * "Your ratings at a glance" (Prompt 35): the guest's highest-rated sub-process, the first row with the most Highs, or null when no row has one. Made on
 * the device from the draft, stored nowhere and shown to no one else. @param {Grid} grid @param {{ rows: { id: string, label: string }[], criteria: { id: string }[] }} shape
 * @returns {{ label: string, highs: number } | null}
 */
export function highestRated(grid, { rows, criteria }) {
  /** @type {{ label: string, highs: number } | null} */
  let best = null;
  for (const row of rows) {
    const highs = criteria.filter((criterion) => grid?.[row.id]?.[criterion.id] === 3).length;
    if (highs > 0 && highs > (best?.highs ?? 0)) best = { label: row.label, highs };
  }
  return best;
}

/** The card's one sentence, from a fixed template with no judgement words; '' when there is nothing to say. @param {{ label: string, highs: number } | null} best */
export const highestSentence = (best) => (best ? `Your highest-rated sub-process was ${best.label} (${best.highs} High).` : '');

/** @typedef {{ total: number }} Glance */

/**
 * A grid's rated boxes as the thank-you keeps them for the visit ("65 ratings", lib/participant/aop-glance.svelte.ts). @param {Grid} grid @param {Shape} shape
 * @returns {Glance}
 */
export const glanceOf = (grid, shape) => ({ total: shape.rows.length * shape.criteria.length - cellsLeft(grid, shape) });
