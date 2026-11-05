// The rules behind the Art of Possibility's one calm screen (Prompt 35), with no DOM (scripts/test-aop-view.js): which view a guest starts in, the counts
// of the status strip, a finished row, and the per-box update. pager/MatrixRating.svelte draws what this says.
//
// The per-box update changes one box of the guest's grid in place (in the page the grid is Svelte state, so only that box, its row and the strip are
// drawn again) instead of copying the whole grid on every tap; lib/participant/aop-answer.js's encodeAnswer then stores exactly what a copy stored.

import { LEVELS } from './aop-answer.js';
import { TOKENS } from '../motion/motion-plan.js';

/** @typedef {import('./aop-answer.js').Grid} Grid */
/** @typedef {import('./aop-answer.js').Shape} Shape */

/**
 * The narrowest each part of the grid may be, px: the sub-process column, the People column, a criterion (whole words, Prompt 35), and the page's
 * gutters with the card's own padding on the stage this question uses.
 */
export const GRID_MIN_WIDTH = Object.freeze({ process: 112, people: 56, criterion: 96, frame: 52 });

/** The narrowest window, px, in which the grid of `criteria` criteria fits with no sideways scroll. @param {number} criteria */
export const gridWidthFor = (criteria) => GRID_MIN_WIDTH.process + GRID_MIN_WIDTH.people + criteria * GRID_MIN_WIDTH.criterion + GRID_MIN_WIDTH.frame;

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

/** How long a press is held before the level menu opens, ms: the motion token the ring fills in (lib/motion/motion-tokens.css --motion-aop-hold). */
export const HOLD_MS = TOKENS.aop.hold;
/** How long "Cleared. Undo" stays, ms. */
export const UNDO_MS = 8000;

/** @typedef {{ rowId: string, criterionId: string, level: number }} Cleared */

/**
 * The ratings a clear takes away: of `boxes` when given, else of every box of the question as it is now. An empty box gives nothing.
 * @param {Grid} grid @param {Shape} shape @param {{ rowId: string, criterionId: string }[]} [boxes] @returns {Cleared[]}
 */
export function clearedOf(grid, { rows, criteria }, boxes) {
  const list = boxes ?? rows.flatMap((row) => criteria.map((criterion) => ({ rowId: row.id, criterionId: criterion.id })));
  /** @type {Cleared[]} */
  const out = [];
  for (const { rowId, criterionId } of list) {
    const level = grid?.[rowId]?.[criterionId];
    if (LEVELS.includes(level)) out.push({ rowId, criterionId, level });
  }
  return out;
}

/** Undo: puts the cleared ratings back, each only where its box is still empty (a box rated since keeps that rating). Returns how many came back. @param {Grid} grid @param {Cleared[]} cleared */
export function restoreInto(grid, cleared) {
  let back = 0;
  for (const { rowId, criterionId, level } of cleared) {
    if (LEVELS.includes(grid?.[rowId]?.[criterionId])) continue;
    setCell(grid, rowId, criterionId, level);
    back += 1;
  }
  return back;
}
