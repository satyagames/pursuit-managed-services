// Prompt 35: the Art of Possibility's motion as a plan (lib/motion/aop-motion-plan.js), with no DOM. Run: node --test scripts/test-aop-motion.js (also part of
// npm test). Every effect moves transform and opacity only, lasts its token, fades only at the reduced level and is nothing at none; the completion wave and
// Clear all's fly-away never have more than MAX_CONCURRENT moving at once; the milestones are 25, 50 and 75 percent, each once.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AOP_EFFECTS, FLY_REACH, MILESTONES, aopEffect, flyCount, flyPath, milestonePoints, milestonesCrossed, waveDelay, waveLength,
} from '../migration/src/lib/motion/aop-motion-plan.js';
import { MAX_CONCURRENT, TOKENS } from '../migration/src/lib/motion/motion-plan.js';

const seeded = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const propertiesOf = (keyframes) => [...new Set(keyframes.flatMap((frame) => Object.keys(frame)))].filter((key) => !['offset', 'easing'].includes(key));

describe('the effects (Prompt 35)', () => {
  const NAMES = ['pop', 'bump', 'ripple', 'sheen', 'check', 'glow', 'milestone', 'fly', 'wave', 'spring', 'pulse', 'rise'];

  it('are the brief\'s, and each lasts its token', () => {
    assert.deepEqual(Object.keys(AOP_EFFECTS).sort(), [...NAMES].sort());
    assert.deepEqual({ ...TOKENS.aop }, {
      hold: 650, advance: 600, pop: 160, bump: 120, ripple: 400, sheen: 450, check: 250, glow: 600, milestone: 1600, fly: 420, flyStagger: 30,
      wave: 120, waveStep: 40, spring: 160, pulse: 600, rise: 400, count: 700,
    });
    for (const name of NAMES) assert.equal(aopEffect(name, 'full', { x: 10, y: 10, width: 300 }).duration, TOKENS.aop[name], name);
  });

  it('move transform and opacity only, and every effect is under 1.2 seconds without a wait', () => {
    for (const name of NAMES) {
      for (const level of ['full', 'reduced']) {
        const effect = aopEffect(name, level, { x: 10, y: 10, width: 300, index: 3, random: seeded(1) });
        if (!effect) continue;
        assert.deepEqual(propertiesOf(effect.keyframes).filter((key) => !['transform', 'opacity'].includes(key)), [], `${name} at ${level}`);
        assert.ok(effect.duration + (effect.delay ?? 0) <= 1200 || name === 'milestone', `${name} is short`);
        assert.match(effect.easing, /^cubic-bezier\(/, `${name} names a token curve`);
      }
    }
    assert.ok(TOKENS.aop.milestone <= 1600, 'the milestone label rises and is gone by 1.6 s');
  });

  it('at the reduced level only fade (or do nothing), and at none do nothing', () => {
    for (const name of NAMES) {
      assert.equal(aopEffect(name, 'none', {}), null, `${name} at none`);
      const reduced = aopEffect(name, 'reduced', { x: 0, y: 0, width: 300, index: 0, random: seeded(2) });
      if (reduced) assert.deepEqual(propertiesOf(reduced.keyframes), ['opacity'], `${name} only fades at reduced`);
    }
    for (const name of ['pop', 'bump', 'ripple', 'sheen', 'wave', 'pulse']) assert.equal(aopEffect(name, 'reduced', {}), null, `${name} is movement only`);
    for (const name of ['check', 'milestone', 'fly', 'spring', 'glow', 'rise']) assert.ok(aopEffect(name, 'reduced', { random: seeded(3) }), `${name} fades at reduced`);
  });
});

describe('the completion wave and Clear all stay under the cap', () => {
  it('the wave runs corner to corner, about 0.8 s, with never more than MAX_CONCURRENT boxes moving (13 by 5, 25 by 6, 2 by 2)', () => {
    assert.equal(MAX_CONCURRENT, 16);
    for (const [rows, columns] of [[13, 5], [25, 6], [2, 2], [5, 13]]) {
      let most = 0;
      for (let t = 0; t <= waveLength(rows, columns); t += 5) {
        let moving = 0;
        for (let r = 0; r < rows; r += 1) for (let c = 0; c < columns; c += 1) {
          const start = waveDelay(r, c, rows, columns);
          if (t >= start && t < start + TOKENS.aop.wave) moving += 1;
        }
        most = Math.max(most, moving);
      }
      assert.ok(most <= MAX_CONCURRENT, `${rows} by ${columns}: ${most} at once`);
    }
    assert.equal(waveDelay(0, 0, 13, 5), 0);
    assert.ok(waveDelay(1, 0, 13, 5) === waveDelay(0, 1, 13, 5), 'a diagonal moves together');
    assert.ok(waveLength(13, 5) <= 1000, `${waveLength(13, 5)} ms`);
  });

  it('Clear all flies at most MAX_CONCURRENT boxes, a short way each, staggered; the rest only clear', () => {
    assert.equal(flyCount(65, 0), MAX_CONCURRENT);
    assert.equal(flyCount(65, 10), MAX_CONCURRENT - 10, 'room left by what is already moving');
    assert.equal(flyCount(5, 0), 5);
    const random = seeded(7);
    for (let index = 0; index < 16; index += 1) {
      const { dx, dy, turn } = flyPath(random);
      assert.ok(Math.hypot(dx, dy) <= FLY_REACH + 1e-9 && Math.hypot(dx, dy) >= FLY_REACH / 2, `a short path: ${dx}, ${dy}`);
      assert.ok(Math.abs(turn) <= 20);
      assert.equal(aopEffect('fly', 'full', { index, random }).delay, index * TOKENS.aop.flyStagger);
    }
  });
});

describe('the milestones', () => {
  it('are 25, 50 and 75 percent of the boxes, rounded up: 17, 33 and 49 of 65', () => {
    assert.deepEqual(MILESTONES.map((each) => each.words), ['A quarter done', 'Halfway', 'Nearly there']);
    assert.deepEqual(milestonePoints(65), [17, 33, 49]);
    assert.deepEqual(milestonePoints(4), [1, 2, 3]);
    assert.deepEqual(milestonePoints(150), [38, 75, 113]);
  });

  it('each fires once, going up; a jump past two says only the higher; one already passed when the page opened never fires', () => {
    const shown = new Set();
    assert.equal(milestonesCrossed(15, 16, 65, shown), null);
    assert.equal(milestonesCrossed(16, 17, 65, shown).words, 'A quarter done');
    assert.equal(milestonesCrossed(16, 17, 65, shown), null, 'once');
    assert.equal(milestonesCrossed(17, 0, 65, shown), null, 'going down says nothing');
    assert.equal(milestonesCrossed(0, 40, 65, shown).words, 'Halfway', 'Undo restoring 40: the higher one');
    assert.equal(milestonesCrossed(40, 49, 65, shown).words, 'Nearly there');
    assert.equal(milestonesCrossed(48, 49, 65, shown), null);
    const opened = new Set();
    assert.equal(milestonesCrossed(0, 50, 65, opened, { quietly: true }), null, 'the ratings a page opens with');
    assert.equal(milestonesCrossed(50, 51, 65, opened), null);
    assert.equal(milestonesCrossed(51, 55, 65, opened), null);
  });
});
