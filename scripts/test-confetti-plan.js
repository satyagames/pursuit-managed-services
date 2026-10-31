import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import {
  MAX_LIVE_SPARKS, confettiPlan, isRedish, originFromRect, parseColor, planDuration, sparkAllowance, sparkPlan,
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
