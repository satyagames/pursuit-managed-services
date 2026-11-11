// Prompt 35: the rules behind the Art of Possibility's one calm screen, with no DOM (lib/participant/aop-view.js). Run: node --test scripts/test-aop-view.js
// (also part of npm test). Which view a guest starts in, the three counts of the status strip, a finished row, and the per-box update that replaced
// the copy of the whole grid on every tap: it must store exactly what Prompt 34 stored for the same taps, so a reload, Send, Preview, the results and
// the exports all keep working.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import * as aopAnswer from '../migration/src/lib/participant/aop-answer.js';
import * as aopView from '../migration/src/lib/participant/aop-view.js';
import { ADVANCE_MS, GRID_MIN_WIDTH, advancesAfter, glanceOf, highestRated, highestSentence, defaultView, gridWidthFor, levelCounts, rowIsDone, setCell } from '../migration/src/lib/participant/aop-view.js';
import { MENU_CLOSED, MENU_GAP, MENU_SCROLL_CLOSE, headingParts, levelOfChoice, menuChoices, menuStep, placeMenu } from '../migration/src/lib/participant/aop-menu.js';
import { TOKENS } from '../migration/src/lib/motion/motion-plan.js';

const { decodeAnswer, encodeAnswer } = aopAnswer;

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

/** Prompt 34's tap (gone since Prompt 42, kept here only to replay old runs): not rated, Low, Medium, High, not rated. */
const oldCycle = (level) => (level === 3 ? undefined : (level ?? 0) + 1);

/** A small seeded random, so a failure can be run again. */
const seeded = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

describe('the view a guest starts in (Prompt 35)', () => {
  it('the grid on a laptop or an iPad in landscape, one at a time on a phone or an iPad in portrait', () => {
    assert.equal(defaultView({ width: 1180, height: 820, criteria: 5 }), 'grid', 'iPad landscape');
    assert.equal(defaultView({ width: 1366, height: 650, criteria: 5 }), 'grid', 'laptop');
    assert.equal(defaultView({ width: 820, height: 1180, criteria: 5 }), 'single', 'iPad portrait');
    assert.equal(defaultView({ width: 390, height: 844, criteria: 5 }), 'single', 'phone');
    assert.equal(defaultView({ width: 700, height: 600, criteria: 3 }), 'grid', '700 px and landscape is the threshold (for criteria that fit it: Prompt 42 made a criterion 112 px)');
    assert.equal(defaultView({ width: 699, height: 500, criteria: 3 }), 'single');
  });

  it('never starts in a grid that would not fit the width without a sideways scroll', () => {
    assert.equal(GRID_MIN_WIDTH.criterion, 112, 'Prompt 42: the five criteria columns are equal from 112 px');
    assert.ok(gridWidthFor(6) > gridWidthFor(5));
    // (Prompt 42) The sample's five criteria fit an iPad in portrait (820 px) at 112 px each, the first column narrowed to 100 px; six criteria narrow to
    // Prompt 35's 96 px (and an 86 px first column), so they still fit there.
    assert.deepEqual({ ...GRID_MIN_WIDTH, dense: { ...GRID_MIN_WIDTH.dense } }, { process: 100, people: 52, criterion: 112, frame: 105, dense: { from: 6, process: 86, criterion: 96 } });
    assert.ok(gridWidthFor(5) <= 820 && gridWidthFor(6) <= 820);
    assert.equal(gridWidthFor(7), 86 + 52 + 7 * 96 + 105);
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
        const level = roll < 0.6 ? oldCycle(before[rowId]?.[criterionId]) : roll < 0.8 ? undefined : 1 + Math.floor(random() * 3);
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

describe('One at a time (Prompt 35)', () => {
  it('One at a time moves on 600 ms after a sub-process\'s last box (the motion token), never from the last one, never with motion off', () => {
    assert.equal(ADVANCE_MS, 600);
    assert.equal(ADVANCE_MS, TOKENS.aop.advance);
    assert.equal(advancesAfter({ wasDone: false, isDone: true, at: 3, count: 13, level: 'full' }), true);
    assert.equal(advancesAfter({ wasDone: false, isDone: true, at: 3, count: 13, level: 'reduced' }), true);
    assert.equal(advancesAfter({ wasDone: false, isDone: true, at: 3, count: 13, level: 'none' }), false, 'with motion off it waits for Next');
    assert.equal(advancesAfter({ wasDone: false, isDone: true, at: 12, count: 13, level: 'full' }), false, 'the last sub-process');
    assert.equal(advancesAfter({ wasDone: true, isDone: true, at: 3, count: 13, level: 'full' }), false, 'a change on a finished one');
    assert.equal(advancesAfter({ wasDone: false, isDone: false, at: 3, count: 13, level: 'full' }), false);
  });

});

describe('your ratings at a glance (Prompt 35)', () => {
  const shape = { rows: [{ id: 'o-1', label: 'GL' }, { id: 'o-2', label: 'AP / AR' }, { id: 'o-3', label: 'Tax' }], criteria: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };

  it('the highest-rated sub-process is the first row with the most Highs', () => {
    assert.deepEqual(highestRated({ 'o-1': { a: 3, b: 1, c: 1 }, 'o-2': { a: 3, b: 3, c: 2 }, 'o-3': { a: 3, b: 3, c: 1 } }, shape), { label: 'AP / AR', highs: 2 }, 'a tie: the first in the list');
    assert.deepEqual(highestRated({ 'o-1': { a: 1 }, 'o-3': { c: 3 } }, shape), { label: 'Tax', highs: 1 });
    assert.equal(highestRated({ 'o-1': { a: 1, b: 2 } }, shape), null, 'no High: nothing to say');
    assert.equal(highestRated({}, { rows: [], criteria: [] }), null);
  });

  it('says it in one fixed sentence, with no judgement words', () => {
    assert.equal(highestSentence({ label: 'Payroll', highs: 5 }), 'Your highest-rated sub-process was Payroll (5 High).');
    assert.equal(highestSentence({ label: 'Tax', highs: 1 }), 'Your highest-rated sub-process was Tax (1 High).');
    assert.equal(highestSentence(null), '');
    assert.doesNotMatch(highestSentence({ label: 'Tax', highs: 1 }), /good|strong|best|great/i);
  });
});

describe('the visit\'s ratings summary for the thank-you (Prompt 35; the hub\'s mosaic went in Prompt 42)', () => {
  it('holds how many boxes are rated, of the rows and criteria the question has', () => {
    const shape = { rows: [{ id: 'o-1' }, { id: 'o-2' }], criteria: [{ id: 'a' }, { id: 'b' }] };
    assert.deepEqual(glanceOf({ 'o-1': { a: 3, b: 1 }, 'o-2': { b: 2 }, 'o-9': { a: 3 } }, shape), { total: 3 });
    assert.deepEqual(glanceOf({}, { rows: [], criteria: [] }), { total: 0 });
  });
});

describe('one tap opens the choices (Prompt 42)', () => {
  const A = { r: 0, c: 0 };
  const B = { r: 3, c: 4 };

  it('a tap opens the menu on its box; a second tap on the same box closes it; a tap on another box moves it there (one menu at a time)', () => {
    let state = menuStep(MENU_CLOSED, { type: 'tap', at: A, scrollY: 100 });
    assert.deepEqual(state.at, A);
    assert.equal(state.scrollY, 100);
    state = menuStep(state, { type: 'tap', at: B, scrollY: 140 });
    assert.deepEqual(state.at, B, 'opening another box closes the first');
    assert.equal(state.scrollY, 140);
    state = menuStep(state, { type: 'tap', at: { ...B }, scrollY: 140 });
    assert.equal(state.at, null, 'a second tap on the same box closes it');
  });

  it('Escape, a tap outside, a choice and focus leaving close it; a closed menu stays closed', () => {
    for (const type of ['escape', 'outside', 'pick', 'leave']) {
      assert.equal(menuStep({ at: A, scrollY: 0 }, { type }).at, null, type);
      assert.equal(menuStep(MENU_CLOSED, { type }).at, null, `${type} on a closed menu`);
    }
    assert.deepEqual(menuStep(MENU_CLOSED, { type: 'open', at: B, scrollY: 7 }), { at: B, scrollY: 7 }, 'the keyboard opens it without toggling');
    assert.deepEqual(menuStep({ at: B, scrollY: 7 }, { type: 'open', at: B, scrollY: 7 }).at, B, 'and opening it again keeps it open');
  });

  it('a scroll of more than 24 px closes it, a smaller one does not', () => {
    assert.equal(MENU_SCROLL_CLOSE, 24);
    const open = { at: A, scrollY: 500 };
    assert.deepEqual(menuStep(open, { type: 'scroll', scrollY: 524 }).at, A, '24 px keeps it');
    assert.deepEqual(menuStep(open, { type: 'scroll', scrollY: 480 }).at, A);
    assert.equal(menuStep(open, { type: 'scroll', scrollY: 525 }).at, null, 'down 25 px');
    assert.equal(menuStep(open, { type: 'scroll', scrollY: 470 }).at, null, 'up 30 px');
    assert.equal(menuStep(MENU_CLOSED, { type: 'scroll', scrollY: 9999 }).at, null);
  });

  it('offers Low, Medium and High, and Clear only when the box has a rating; a choice sets exactly that level', () => {
    assert.deepEqual(menuChoices(undefined), [1, 2, 3]);
    assert.deepEqual(menuChoices(0), [1, 2, 3]);
    for (const level of [1, 2, 3]) assert.deepEqual(menuChoices(level), [1, 2, 3, 0], `rated ${level}`);
    assert.deepEqual([1, 2, 3, 0].map(levelOfChoice), [1, 2, 3, undefined], 'Clear (0) empties the box');
    const shape = shapeOf(2, 2);
    for (const choice of [1, 2, 3]) {
      const grid = { 'o-1': { [shape.criteria[0].id]: 2 } };
      setCell(grid, 'o-2', shape.criteria[1].id, levelOfChoice(choice));
      assert.deepEqual(grid, { 'o-1': { [shape.criteria[0].id]: 2 }, 'o-2': { [shape.criteria[1].id]: choice } }, `choice ${choice} sets only that box, to that level`);
    }
  });

  it('opens below the box with a 6 px gap, above when there is no room below, never off the card or the screen, and from the right edge near the end', () => {
    assert.equal(MENU_GAP, 6);
    const viewport = { width: 1180, height: 820 };
    const card = { top: 200, bottom: 1600, left: 30, right: 1150 };
    const menu = { width: 180, height: 216 };
    const box = (top, left) => ({ top, bottom: top + 48, left, right: left + 160 });
    assert.deepEqual(placeMenu({ box: box(300, 300), menu, card, viewport }), { above: false, end: false });
    assert.deepEqual(placeMenu({ box: box(700, 300), menu, card, viewport }), { above: true, end: false }, 'no room under it on the screen');
    assert.deepEqual(placeMenu({ box: box(300, 300), menu, card: { ...card, top: 0, bottom: 500 }, viewport }), { above: true, end: false }, 'no room under it in the card');
    assert.deepEqual(placeMenu({ box: box(300, 1000), menu, card, viewport }), { above: false, end: true }, 'it would run past the card on the right');
    assert.deepEqual(placeMenu({ box: box(300, 300), menu, card, viewport, last: true }), { above: false, end: true }, 'the last columns open from the right edge');
    assert.equal(placeMenu({ box: box(100, 300), menu, card: { ...card, top: 0, bottom: 400 }, viewport: { width: 1180, height: 420 } }).above, false, 'neither fits: the side with more room');
  });
});

describe('a heading is the name; a qualifier in brackets goes to its note (Prompt 42)', () => {
  it('splits a trailing bracket from the name and keeps its exact words', () => {
    assert.deepEqual(headingParts('Strategic value (counts against)'), { name: 'Strategic value', qualifier: '(counts against)' });
    assert.deepEqual(headingParts('Compliance / risk  (counts against) '), { name: 'Compliance / risk', qualifier: '(counts against)' });
    assert.deepEqual(headingParts('Outsourcing suitability'), { name: 'Outsourcing suitability', qualifier: '' });
    assert.deepEqual(headingParts('Cost (FTE) per year'), { name: 'Cost (FTE) per year', qualifier: '' }, 'a bracket inside the name stays');
    assert.deepEqual(headingParts('(only a bracket)'), { name: '(only a bracket)', qualifier: '' }, 'never an empty heading');
  });
});

describe('no tap changes a rating without a choice (Prompt 42)', () => {
  const grid = readFileSync(new URL('../migration/src/pager/MatrixRating.svelte', import.meta.url), 'utf8');

  it('the tap-to-cycle rule, the hold and Undo are gone from the rules and the grid', () => {
    assert.equal('cycle' in aopAnswer, false, 'aop-answer.js has no cycle');
    for (const name of ['HOLD_MS', 'UNDO_MS', 'clearedOf', 'restoreInto']) assert.equal(name in aopView, false, `aop-view.js has no ${name}`);
    assert.equal('hold' in TOKENS.aop, false, 'no hold token');
    assert.doesNotMatch(grid, /\bcycle\b|HOLD_MS|holdTimer|aopHoldOpen|data-holding|undoClear|Press and hold/);
  });

  it('a box click only opens or closes its menu', () => {
    assert.match(grid, /onclick=\{\(\) => onBoxClick\(/, "a box's click goes to onBoxClick");
    const from = grid.indexOf('function onBoxClick');
    assert.ok(from > 0);
    const body = grid.slice(from, grid.indexOf('\n  }\n', from));
    assert.doesNotMatch(body, /\bset\(|setCell|rateSingle/, 'onBoxClick never rates');
  });
});
