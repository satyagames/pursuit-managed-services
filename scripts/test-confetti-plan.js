import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import {
  MAX_LIVE_SPARKS, SHOWER, SHOWER_SHAPES, confettiPlan, isRedish, originFromRect, parseColor, planDuration, showerAlive, showerCap, showerPalette,
  showerPlan, sparkAllowance, sparkPlan,
} from '../migration/src/lib/effects/confetti-plan.js';

// Prompt 24, Part 5: the hub's two small sprays, which need no browser. Counts, spread, colours from the palette, the origin from a rect, the cap,
// and nothing at all below the full level. That the overlay goes afterwards is seen in scripts/migration-tests/hub-states.spec.ts.

const root = path.join(import.meta.dirname, '..');
const tokens = { success: '#09FF53', action: '#296CD4', primary: '#0060A9' };
const rect = { left: 100, top: 200, width: 40, height: 40 };
const viewport = { width: 1000, height: 800 };

test('stamp sparks: 6 round ones all round the badge, in the success green and its tint, about 500 ms', () => {
  const plan = sparkPlan('stamp', { rect, viewport, tokens, level: 'full' });
  assert.equal(plan.bursts.length, 1);
  const [burst] = plan.bursts;
  assert.equal(burst.count, 6);
  assert.equal(burst.spread, 360);
  assert.deepEqual(burst.origin, originFromRect(rect, viewport));
  assert.ok(Math.abs(planDuration(plan.bursts) - 500) <= 40, `${planDuration(plan.bursts)}`);
  assert.deepEqual(plan.shapes, ['circle']);
  assert.equal(plan.colors[0], '#09FF53');
  assert.equal(plan.colors.length, 2);
});

test('unlock sparks: 12, a fan upward, white and the client\'s tint, low gravity, about 600 ms', () => {
  const plan = sparkPlan('unlock', { rect, viewport, tokens, level: 'full' });
  const [burst] = plan.bursts;
  assert.equal(burst.count, 12);
  assert.equal(burst.spread, 70);
  assert.equal(burst.angle, 90, 'upward');
  assert.ok(burst.gravity < 1);
  assert.ok(Math.abs(planDuration(plan.bursts) - 600) <= 40, `${planDuration(plan.bursts)}`);
  assert.equal(plan.colors[0], '#FFFFFF');
  assert.ok(plan.colors.length >= 2);
  assert.deepEqual(burst.origin, originFromRect(rect, viewport));
});

test('nothing is drawn below the full level', () => {
  for (const kind of ['stamp', 'unlock']) for (const level of ['reduced', 'none']) assert.equal(sparkPlan(kind, { rect, viewport, tokens, level }), null, `${kind} ${level}`);
});

test('a client in red gets white and green sparks, never red', () => {
  const plan = sparkPlan('unlock', { rect, viewport, tokens: { success: '#09FF53', action: '#C8102E', primary: '#E31837' }, level: 'full' });
  for (const colour of plan.colors) assert.equal(isRedish(parseColor(colour)), false, colour);
});

test(`at most ${MAX_LIVE_SPARKS} live sparks: what would pass the cap is cut, and at the cap none are thrown`, () => {
  assert.equal(MAX_LIVE_SPARKS, 24);
  assert.equal(sparkAllowance(0, 12), 12);
  assert.equal(sparkAllowance(18, 12), 6);
  assert.equal(sparkAllowance(24, 6), 0);
  assert.equal(sparkAllowance(30, 6), 0);
  // One stamp and one unlock, the usual moment, fit whole.
  assert.ok(6 + 12 <= MAX_LIVE_SPARKS);
});

test('a medium burst can come from an element (Finish, on all-done); without one it stays in both lower corners', () => {
  const origin = { x: 0.5, y: 0.8 };
  assert.deepEqual(confettiPlan('medium', { width: 820, origin }).map((burst) => burst.origin), [origin, origin]);
  assert.deepEqual(confettiPlan('medium', { width: 820 }).map((burst) => burst.origin), [{ x: 0, y: 1 }, { x: 1, y: 1 }]);
});

test('the sprays use the one overlay and library: no second canvas', async () => {
  const code = await readFile(path.join(root, 'migration/src/lib/effects/confetti.ts'), 'utf8');
  assert.equal(code.match(/createElement\('canvas'\)/g).length, 1);
  assert.match(code, /export async function sparks\(/);
});

// ---- Prompt 36: the finale's petal shower -------------------------------------------------------------------------------------------
// The plan is data: small bursts from just above the top edge, falling, in three waves (a curtain sweeping left to right, a full-width fall, a
// fall over the middle) and a slow afterglow, never more alive at once than the cap. confetti.ts fires them on the one overlay, through the
// same library as every other burst, in petal, ribbon and disc shapes.

/** A seeded random, so a plan is the same every run. @param {number} seed */
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const VIEW = { width: 1180, height: 820 };
const plan = (view = VIEW, seed = 1) => showerPlan({ ...view, level: 'full', random: seeded(seed) });
const of = (bursts, wave) => bursts.filter((burst) => burst.wave === wave);
const pieces = (bursts) => bursts.reduce((sum, burst) => sum + burst.count, 0);
const ends = (burst) => burst.at + (burst.ticks * 1000) / 60;

test('the shower: nothing below the full level or under reduced motion', () => {
  assert.equal(showerPlan({ ...VIEW, level: 'none' }), null);
  assert.equal(showerPlan({ ...VIEW, level: 'reduced' }), null);
  assert.equal(showerPlan({ ...VIEW, level: 'full', reducedMotion: true }), null);
  assert.ok(Array.isArray(plan()));
});

test('the shower: three waves then the afterglow, in the time ranges of the brief', () => {
  const bursts = plan();
  const range = (wave) => [Math.min(...of(bursts, wave).map((burst) => burst.at)), Math.max(...of(bursts, wave).map((burst) => burst.at))];
  const [curtain, fall, centre, afterglow] = ['curtain', 'fall', 'centre', 'afterglow'].map(range);
  assert.ok(curtain[0] >= 350 && curtain[0] < 500 && curtain[1] < 1500, `the curtain, 0.35 to 1.5 s (${curtain})`);
  assert.ok(fall[0] >= 1200 && fall[1] < 3600, `the full-width fall, 1.2 to 3.6 s (${fall})`);
  assert.ok(centre[0] >= 2400 && centre[1] < SHOWER.showerEnd, `the fall over the middle, 2.4 to 4.2 s (${centre})`);
  assert.equal(SHOWER.showerEnd, 4200, 'the shower is over by 4.2 s');
  assert.ok(afterglow[0] >= SHOWER.showerEnd && afterglow[1] < SHOWER.afterglowEnd, `then the afterglow (${afterglow})`);
  const rate = pieces(of(bursts, 'afterglow')) / ((SHOWER.afterglowEnd - SHOWER.showerEnd) / 1000);
  assert.ok(rate >= 4 && rate <= 8, `about six a second (${rate.toFixed(1)})`);
  assert.ok(bursts.every((burst, index) => index === 0 || burst.at >= bursts[index - 1].at), 'in time order');
  assert.ok(Math.max(...bursts.map(ends)) <= 11_000, 'and every piece is gone by 11 s');
});

test('the shower: from just above the top, falling, across the whole width; the curtain moves left to right, the last wave over the middle', () => {
  const bursts = plan();
  assert.ok(bursts.every((burst) => burst.origin.y < 0 && burst.angle === 270), 'from above, downwards');
  const xs = of(bursts, 'fall').map((burst) => burst.origin.x);
  assert.ok(Math.min(...xs) < 0.1 && Math.max(...xs) > 0.9, 'the whole width');
  const curtain = of(bursts, 'curtain').map((burst) => burst.origin.x);
  const mean = (list) => list.reduce((sum, x) => sum + x, 0) / list.length;
  const quarter = Math.ceil(curtain.length / 4);
  assert.ok(mean(curtain.slice(0, quarter)) < 0.35 && mean(curtain.slice(-quarter)) > 0.65, 'the curtain sweeps left to right');
  assert.ok(of(bursts, 'centre').every((burst) => burst.origin.x >= 0.3 && burst.origin.x <= 0.7), 'the last wave falls over the middle');
  assert.ok(of(bursts, 'afterglow').every((burst) => burst.gravity < Math.min(...of(bursts, 'fall').map((each) => each.gravity))), 'the afterglow drifts slower');
});

test('the shower: the live pieces never pass the cap at any size, a narrow screen gets fewer, and the caps are 160 and 90', () => {
  assert.deepEqual([showerCap(1180), showerCap(560), showerCap(559), showerCap(390)], [160, 160, 90, 90]);
  for (const view of [{ width: 1366, height: 650 }, VIEW, { width: 820, height: 1180 }, { width: 559, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    for (const seed of [1, 2, 3]) {
      const bursts = plan(view, seed);
      let most = 0;
      for (let now = 0; now <= 11_000; now += 20) most = Math.max(most, showerAlive(bursts, now));
      assert.ok(most <= showerCap(view.width), `${view.width} px: ${most} alive, cap ${showerCap(view.width)}`);
      assert.ok(most >= showerCap(view.width) * 0.5, `${view.width} px: a real shower (${most} at most)`);
    }
  }
  assert.ok(pieces(plan({ width: 390, height: 844 })) < pieces(plan()) * 0.7, 'fewer on a phone');
});

test('the shower falls through the screen in its life, whatever its height', () => {
  for (const view of [{ width: 1366, height: 650 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    for (const burst of of(plan(view), 'fall')) {
      const travel = burst.gravity * 3 * burst.ticks; // the library moves a piece 3 x gravity px a frame
      assert.ok(travel >= view.height * 0.7 && travel <= view.height * 1.6, `${view.width}x${view.height}: ${Math.round(travel)} px`);
    }
  }
});

test('the shower shapes: petals (two curves to a point), thin ribbons and discs, each petal and ribbon with its own size so nothing is measured at run time', () => {
  assert.deepEqual(Object.keys(SHOWER_SHAPES).sort(), ['petal', 'ribbon']);
  for (const shape of Object.values(SHOWER_SHAPES)) {
    assert.equal(shape.matrix.length, 6, 'a matrix: canvas-confetti would otherwise scan a 1000 x 1000 grid to size it');
    assert.match(shape.path, /^M/);
  }
  assert.equal((SHOWER_SHAPES.petal.path.match(/Q/g) ?? []).length, 2, 'two curves');
});

test('the shower colours: the palette plus a pale lime and a warm pale yellow, never red, for each seeded client', () => {
  for (const theme of [tokens, { success: '#09FF53', action: '#DA291C', primary: '#E4002B' }, { success: '#26890D', action: '#00A3E0', primary: '#012169' }]) {
    const colors = showerPalette(theme);
    assert.ok(colors.includes(SHOWER.paleLime) && colors.includes(SHOWER.paleYellow), 'lime and yellow');
    for (const colour of colors) assert.equal(isRedish(parseColor(colour)), false, `${colour} is red`);
  }
});
