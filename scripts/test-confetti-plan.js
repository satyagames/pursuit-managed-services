import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import {
  MAX_LIVE_SPARKS, SHOWER, confettiPlan, isRedish, makePiece, originFromRect, parseColor, pieceAlpha, planDuration, showerCap, showerDue,
  showerPalette, showerPlan, showerStruggling, sparkAllowance, sparkPlan, stepPiece,
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
// The plan is data: three waves (a curtain sweeping left to right, a full-width fall, a fall over the middle) and a slow afterglow, plus the
// pure pieces of the loop (how many are due, each piece, its step, when the device is struggling). confetti.ts only draws them.

/** A seeded random, so a simulation is the same every run. @param {number} seed */
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

test('the shower: nothing below the full level or under reduced motion', () => {
  assert.equal(showerPlan({ width: 1180, level: 'none' }), null);
  assert.equal(showerPlan({ width: 1180, level: 'reduced' }), null);
  assert.equal(showerPlan({ width: 1180, level: 'full', reducedMotion: true }), null);
  assert.ok(Array.isArray(showerPlan({ width: 1180, level: 'full' })));
});

test('the shower: three waves then the afterglow, in order, in the brief\'s time ranges', () => {
  const plan = showerPlan({ width: 1180, level: 'full' });
  assert.deepEqual(plan.map((wave) => wave.name), ['curtain', 'fall', 'centre', 'afterglow']);
  const [curtain, fall, centre, afterglow] = plan;
  assert.deepEqual([curtain.at, curtain.until], [350, 1500]);
  assert.ok(curtain.sweep && curtain.region.left === 0 && curtain.region.right === 1, 'the curtain sweeps the whole width, left to right');
  assert.deepEqual([fall.at, fall.until], [1200, 3600]);
  assert.deepEqual([fall.region.left, fall.region.right], [0, 1], 'the fall is full width');
  assert.deepEqual([centre.at, centre.until], [2400, 4200]);
  assert.ok(centre.region.left >= 0.25 && centre.region.right <= 0.75, 'the last wave falls over the middle');
  assert.ok(plan.every((wave, index) => index === 0 || wave.at >= plan[index - 1].at), 'in order of start');
  assert.ok(Math.max(...plan.slice(0, 3).map((wave) => wave.until)) <= SHOWER.showerEnd && SHOWER.showerEnd <= 4200, 'the shower is over by 4.2 s');
  assert.ok(afterglow.at >= SHOWER.showerEnd && afterglow.fade, 'the afterglow follows, fading');
  assert.ok(afterglow.rate <= 8 && afterglow.rate >= 4, `about six a second (${afterglow.rate})`);
  for (const wave of plan) assert.ok(wave.until + wave.life[1] <= 11_000, `${wave.name}: nothing left after 11 s`);
});

test('the shower: a narrow screen spawns fewer and has the lower cap', () => {
  const due = (width) => showerPlan({ width, level: 'full' }).reduce((sum, wave) => sum + (wave.rate * (wave.until - wave.at)) / 1000, 0);
  assert.ok(due(390) < due(1180) * 0.7, `${due(390)} at 390 px, ${due(1180)} at 1180 px`);
  assert.equal(showerCap(1180), 160);
  assert.equal(showerCap(560), 160);
  assert.equal(showerCap(559), 90);
  assert.equal(showerCap(390), 90);
  assert.equal(SHOWER.struggleCap, 40);
});

test('the shower: the live pieces never pass the cap at any width, and the last piece is gone by 11 s', () => {
  for (const [width, height] of [[1366, 650], [1180, 820], [820, 1180], [559, 900], [390, 844], [320, 568]]) {
    const plan = showerPlan({ width, level: 'full' });
    const cap = showerCap(width);
    const random = seeded(width);
    const colors = showerPalette(tokens);
    /** @type {any[]} */
    let alive = [];
    let carry = plan.map(() => 0);
    let most = 0;
    let lastAlive = 0;
    for (let now = 16; now <= 12_000; now += 16) {
      const due = showerDue(plan, now - 16, now, carry);
      carry = due.carry;
      for (const [index, count] of due.counts.entries()) {
        for (let n = 0; n < count && alive.length < cap; n += 1) alive.push(makePiece(plan[index], now, { width, height }, random, colors));
      }
      alive = alive.filter((piece) => stepPiece(piece, 16, now, { width, height }));
      most = Math.max(most, alive.length);
      if (alive.length) lastAlive = now;
    }
    assert.ok(most <= cap, `${width} px: ${most} alive, cap ${cap}`);
    assert.ok(most >= cap * 0.5, `${width} px: it is a real shower (${most} at most)`);
    assert.ok(lastAlive <= 11_000, `${width} px: the last piece went at ${lastAlive} ms`);
  }
});

test('the shower: pieces start above the top edge, across the region, and flip as they fall', () => {
  const plan = showerPlan({ width: 1180, level: 'full' });
  const random = seeded(7);
  const view = { width: 1180, height: 820 };
  const pieces = Array.from({ length: 400 }, () => makePiece(plan[1], 1500, view, random, showerPalette(tokens)));
  assert.ok(pieces.every((piece) => piece.y < 0), 'from above');
  assert.ok(Math.min(...pieces.map((piece) => piece.x)) < view.width * 0.1 && Math.max(...pieces.map((piece) => piece.x)) > view.width * 0.9, 'the whole width');
  assert.deepEqual([...new Set(pieces.map((piece) => piece.shape))].sort(), ['disc', 'petal', 'ribbon']);
  const curtain = (at) => makePiece(plan[0], at, view, seeded(3), ['#FFFFFF']).x;
  assert.ok(curtain(400) < curtain(1450), 'the curtain moves left to right');
  const piece = makePiece(plan[1], 0, view, seeded(9), ['#FFFFFF']);
  const widths = [];
  for (let now = 16; now < 1200; now += 16) { stepPiece(piece, 16, now, view); widths.push(Math.abs(Math.cos(piece.flip))); }
  assert.ok(Math.min(...widths) < 0.2 && Math.max(...widths) > 0.9, 'it narrows as it turns');
  assert.ok(piece.y > 0, 'and falls');
});

test('the shower: a piece fades in its last second, and goes below the bottom edge or at the end of its life', () => {
  const plan = showerPlan({ width: 1180, level: 'full' });
  const view = { width: 1180, height: 820 };
  const piece = makePiece(plan[1], 0, view, seeded(11), ['#FFFFFF']);
  assert.equal(pieceAlpha(piece, 100), 1);
  assert.ok(pieceAlpha(piece, piece.born + piece.life - 500) < 0.6);
  assert.equal(stepPiece({ ...piece, y: view.height + 100 }, 16, 200, view), false, 'below the bottom edge');
  assert.equal(stepPiece({ ...piece }, 16, piece.born + piece.life + 1, view), false, 'past its life');
  const glow = makePiece(plan[3], 5000, view, seeded(12), ['#FFFFFF']);
  assert.ok(pieceAlpha(glow, 5000 + glow.life / 2) < 0.9, 'an afterglow petal fades all the way down');
});

test('the shower\'s colours: the palette plus a pale lime and a warm pale yellow, never red, for each seeded client', () => {
  for (const theme of [tokens, { success: '#09FF53', action: '#DA291C', primary: '#E4002B' }, { success: '#26890D', action: '#00A3E0', primary: '#012169' }]) {
    const colors = showerPalette(theme);
    assert.ok(colors.includes(SHOWER.paleLime) && colors.includes(SHOWER.paleYellow), 'lime and yellow');
    for (const colour of colors) assert.equal(isRedish(parseColor(colour)), false, `${colour} is red`);
  }
});

test('the shower: a device under 30 frames a second is struggling; a smooth one, or one hitch, is not', () => {
  assert.equal(showerStruggling(Array(40).fill(16.7)), false);
  assert.equal(showerStruggling(Array(40).fill(40)), true);
  assert.equal(showerStruggling([...Array(30).fill(16.7), ...Array(4).fill(60)]), false, 'one hitch is not struggling');
  assert.equal(showerStruggling(Array(10).fill(40)), false, 'too soon to say');
});
