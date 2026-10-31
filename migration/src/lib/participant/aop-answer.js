// An Art of the Possible answer (Prompt 23): what a guest's ratings are in the page, and how they are stored in `ResponsesJson`. Plain JS with JSDoc and no DOM,
// so `node --test` runs it (scripts/test-aop-math.js); pager/MatrixRating.svelte, lib/participant/pager-logic.js and lib/results/aop-math.js use it.
//
// In the page a guest's ratings are a grid: { rowId: { criterionId: 1 | 2 | 3 } } (Low, Medium, High; a box with no key is not rated). In the stored answer they
// are a list of strings, one for each rated row: `<optionId>:<criterionId>=<level>,<criterionId>=<level>`. `:` is the row's end because the app's id generators
// make none with one (a UUID, `c-` and hex, words with hyphens and underscores, and `~` in a copied id: checked over the seed data and every generator, Prompt 23);
// the row's id is whatever is before the last `:`, so even one that had a colon would read back. `=` and `,` occur in no id either.
//
// Decoding is tolerant, as lib/results/unreadable.js is about whole items: a damaged entry, an unknown row or criterion and a level outside 1 to 3 are dropped
// and counted, never thrown, so one bad cell costs that cell.

/** @typedef {Record<string, Record<string, number>>} Grid */
/** @typedef {{ rows: { id: string }[], criteria: { id: string }[] }} Shape */

export const MATRIX_TYPE = 'art-of-the-possible';
/** The most characters one stored answer may hold (the whole list), well over 25 rows by 6 criteria. lib/data/responses.js refuses a longer one. */
export const MAX_MATRIX_ANSWER = 6000;
export const LEVELS = Object.freeze([1, 2, 3]);

/** The answer to store. @param {Grid} grid @returns {string[]} */
export function encodeAnswer(grid) {
  const list = [];
  for (const [rowId, cells] of Object.entries(grid ?? {})) {
    const rated = Object.entries(cells ?? {}).filter(([, level]) => LEVELS.includes(level));
    if (rated.length > 0) list.push(`${rowId}:${rated.map(([criterionId, level]) => `${criterionId}=${level}`).join(',')}`);
  }
  return list;
}

/**
 * The grid of a stored answer. Without `shape` every well-made cell is kept; with it, those of its rows and criteria. A later rating of a cell wins.
 * @param {unknown} list @param {Partial<Shape>} [shape] @returns {{ grid: Grid, dropped: number }}
 */
export function decodeAnswer(list, shape = {}) {
  /** @type {Grid} */
  const grid = {};
  let dropped = 0;
  if (list === undefined || list === null) return { grid, dropped };
  if (!Array.isArray(list)) return { grid, dropped: 1 };
  const rows = shape.rows ? new Set(shape.rows.map((row) => String(row.id))) : null;
  const criteria = shape.criteria ? new Set(shape.criteria.map((criterion) => String(criterion.id))) : null;
  for (const entry of list) {
    const at = typeof entry === 'string' ? entry.lastIndexOf(':') : -1;
    if (at < 1) { dropped += 1; continue; }
    const rowId = entry.slice(0, at);
    if (rows && !rows.has(rowId)) { dropped += 1; continue; }
    for (const cell of entry.slice(at + 1).split(',')) {
      const [criterionId, text] = cell.split('=');
      const level = Number(text);
      if (!criterionId || !LEVELS.includes(level) || (criteria && !criteria.has(criterionId))) { dropped += 1; continue; }
      (grid[rowId] ??= {})[criterionId] = level;
    }
  }
  return { grid, dropped };
}

/** A tap: not rated, then Low, Medium, High, and not rated again. @param {number | undefined} level @returns {number | undefined} */
export const cycle = (level) => (level === 3 ? undefined : (level ?? 0) + 1);

/** The boxes still to rate, of the rows and criteria the question has now. @param {Grid} grid @param {Shape} shape */
export function cellsLeft(grid, { rows, criteria }) {
  let left = 0;
  for (const row of rows) for (const criterion of criteria) if (!LEVELS.includes(grid?.[row.id]?.[criterion.id])) left += 1;
  return left;
}

/** Every box rated. @param {Grid} grid @param {Shape} shape */
export const isComplete = (grid, shape) => shape.rows.length > 0 && shape.criteria.length > 0 && cellsLeft(grid, shape) === 0;

/**
 * The next box with no rating, across and then down: after `from` when it is given, going round to the top; null when none is left.
 * @param {Grid} grid @param {Shape} shape @param {{ rowId: string, criterionId: string } | null} [from]
 * @returns {{ rowId: string, criterionId: string } | null}
 */
export function nextEmpty(grid, { rows, criteria }, from = null) {
  const boxes = rows.flatMap((row) => criteria.map((criterion) => ({ rowId: row.id, criterionId: criterion.id })));
  const start = from ? boxes.findIndex((box) => box.rowId === from.rowId && box.criterionId === from.criterionId) + 1 : 0;
  for (let step = 0; step < boxes.length; step += 1) {
    const box = boxes[(start + step) % boxes.length];
    if (!LEVELS.includes(grid?.[box.rowId]?.[box.criterionId])) return box;
  }
  return null;
}
