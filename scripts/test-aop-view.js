// Prompt 35: the rules behind the Art of Possibility's one calm screen, with no DOM (lib/participant/aop-view.js). Run: node --test scripts/test-aop-view.js
// (also part of npm test). Which view a guest starts in, the three counts of the status strip, a finished row, and the per-box update that replaced
// the copy of the whole grid on every tap: it must store exactly what Prompt 34 stored for the same taps, so a reload, Send, Preview, the results and
// the exports all keep working.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cycle, decodeAnswer, encodeAnswer } from '../migration/src/lib/participant/aop-answer.js';
import { GRID_MIN_WIDTH, defaultView, gridWidthFor, levelCounts, rowIsDone, setCell } from '../migration/src/lib/participant/aop-view.js';

const shapeOf = (rows, criteria) => ({
  rows: Array.from({ length: rows }, (_, at) => ({ id: `o-${at + 1}` })),
  criteria: Array.from({ length: criteria }, (_, at) => ({ id: `c-${String(at).repeat(6)}` })),
});

/** Prompt 34's set(), as it was (MatrixRating.svelte at dc7a6f8): a copy of the whole grid, changed, then encoded. */
function oldSet(grid, rowId, criterionId, level) {
  const next = structuredClone(grid);
  if (level === undefined) { delete next[rowId]?.[criterionId]; } else (next[rowId] ??= {})[criterionId] = level;
  return next;
}

/** A small seeded random, so a failure can be run again. */
const seeded = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

describe('the view a guest starts in (Prompt 35)', () => {
  it('the grid on a laptop or an iPad in landscape, one at a time on a phone or an iPad in portrait', () => {
    assert.equal(defaultView({ width: 1180, height: 820, criteria: 5 }), 'grid', 'iPad landscape');
    assert.equal(defaultView({ width: 1366, height: 650, criteria: 5 }), 'grid', 'laptop');
    assert.equal(defaultView({ width: 820, height: 1180, criteria: 5 }), 'single', 'iPad portrait');
    assert.equal(defaultView({ width: 390, height: 844, criteria: 5 }), 'single', 'phone');
    assert.equal(defaultView({ width: 700, height: 600, criteria: 5 }), 'grid', '700 px and landscape is the threshold');
    assert.equal(defaultView({ width: 699, height: 500, criteria: 5 }), 'single');
  });

  it('never starts in a grid that would not fit the width without a sideways scroll', () => {
    assert.equal(GRID_MIN_WIDTH.criterion, 96);
    assert.ok(gridWidthFor(6) > gridWidthFor(5));
    assert.equal(defaultView({ width: gridWidthFor(6) - 1, height: 500, criteria: 6 }), 'single');
    assert.equal(defaultView({ width: Math.max(700, gridWidthFor(6)), height: 500, criteria: 6 }), 'grid');
  });

  it('a choice this visit wins', () => {
    assert.equal(defaultView({ width: 390, height: 844, criteria: 5, chosen: 'grid' }), 'grid');
    assert.equal(defaultView({ width: 1366, height: 650, criteria: 5, chosen: 'single' }), 'single');
  });
});

describe('the status strip and a finished row', () => {
  const shape = shapeOf(3, 2);
  const [a, b] = shape.criteria.map((each) => each.id);
  const grid = { 'o-1': { [a]: 1, [b]: 3 }, 'o-2': { [a]: 2 }, 'o-9': { [a]: 3 } };

  it('counts Low, Medium and High of the rows and criteria the question has now', () => {
    assert.deepEqual(levelCounts(grid, shape), { 1: 1, 2: 1, 3: 1 }, 'a row the question no longer has is not counted');
    assert.deepEqual(levelCounts({}, shape), { 1: 0, 2: 0, 3: 0 });
  });

  it('a row is finished when every criterion has a rating', () => {
    assert.equal(rowIsDone(grid, shape, 'o-1'), true);
    assert.equal(rowIsDone(grid, shape, 'o-2'), false);
    assert.equal(rowIsDone(grid, shape, 'o-3'), false);
  });
});

describe('the per-box update stores what Prompt 34 stored', () => {
  it('any run of taps, clears and keys gives the same answer, every step of the way (13 rows by 5, 25 by 6, 2 by 2)', () => {
    for (const [rows, criteria, seed] of [[13, 5, 1], [25, 6, 2], [2, 2, 3], [13, 5, 4]]) {
      const shape = shapeOf(rows, criteria);
      const random = seeded(seed);
      let before = {};
      const after = {};
      for (let step = 0; step < 400; step += 1) {
        const rowId = shape.rows[Math.floor(random() * rows)].id;
        const criterionId = shape.criteria[Math.floor(random() * criteria)].id;
        const roll = random();
        const level = roll < 0.6 ? cycle(before[rowId]?.[criterionId]) : roll < 0.8 ? undefined : 1 + Math.floor(random() * 3);
        before = oldSet(before, rowId, criterionId, level);
        setCell(after, rowId, criterionId, level);
        assert.deepEqual(encodeAnswer(after), encodeAnswer(before), `step ${step} of ${rows} by ${criteria}`);
      }
    }
  });

  it('starting from a stored answer, as a reload does, and a golden answer of Prompt 34 reads back the same', () => {
    const golden = ['o-2:c-111111=3,c-000000=1', 'o-1:c-000000=2', 'o-13:c-444444=1,c-333333=2,c-222222=3,c-111111=1,c-000000=2'];
    const shape = shapeOf(13, 5);
    const grid = decodeAnswer(golden, shape).grid;
    assert.deepEqual(encodeAnswer(grid), golden, 'the order of rows and of boxes is kept');
    const old = oldSet(grid, 'o-1', 'c-111111', 3);
    setCell(grid, 'o-1', 'c-111111', 3);
    assert.deepEqual(encodeAnswer(grid), encodeAnswer(old));
    setCell(grid, 'o-1', 'c-000000', undefined);
    setCell(grid, 'o-1', 'c-111111', undefined);
    assert.deepEqual(encodeAnswer(grid), ['o-2:c-111111=3,c-000000=1', 'o-13:c-444444=1,c-333333=2,c-222222=3,c-111111=1,c-000000=2'], 'an emptied row is not stored');
  });
});
