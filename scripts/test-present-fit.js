// Phase 11a-3, item E: the full screen's type, a step at a time. Run: node --test scripts/test-present-fit.js (also part of npm test and
// npm run test:charts)
//
// A question with eight answers of about 90 characters was cut off in full screen on a screen held upright. migration/src/lib/present-fit.js is the
// step LiveDisplay.svelte takes while the card does not fit: every step makes the type smaller until it is SMALLEST, and then the card spills (the
// screen scrolls as one page). A card is never left cut at its edge. The browser side is results-charts-fit.spec.ts.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SMALLEST, nextFit, scaleOf } from '../migration/src/lib/present-fit.js';

/** The steps LiveDisplay takes for a card that never fits, at most 12 (its loop's limit): the scales drawn, and whether it then spills. */
function walk(presentScale) {
  let fitFactor = 1;
  const scales = [scaleOf(presentScale, fitFactor)];
  for (let step = 0; step < 12; step += 1) {
    const next = nextFit(presentScale, fitFactor);
    if (next === null) return { scales, spills: true };
    fitFactor = next;
    scales.push(scaleOf(presentScale, fitFactor));
  }
  return { scales, spills: false };
}

describe('the full screen type', () => {
  it('is presentScale times the fit factor, to a twentieth, never below 0.75', () => {
    assert.equal(SMALLEST, 0.75);
    assert.equal(scaleOf(1.2, 1), 1.2);
    assert.equal(scaleOf(2.4, 0.9), 2.15); // 2.16 to a twentieth
    assert.equal(scaleOf(1.2, 0.5), 0.75); // 0.6, held at 0.75
  });

  it('a card that never fits gets smaller at every step until 0.75 and then spills, at every width from 1,200 to 2,400 px and over', () => {
    // A window 1,200 px wide or less (an iPad upright, a phone, a 1080x1920 screen upright) draws 1.2; 2,160 px (a 4K screen upright) 2.15; 2,400 and
    // over 2.4. With 11a-2's floor of 0.5 the type stopped at 1.1 for 2.15 and 1.2 for 2.4 and never spilled: the card was cut at its edge.
    for (const presentScale of [1.2, 1.25, 1.5, 1.6, 1.65, 1.8, 2, 2.15, 2.4]) {
      const { scales, spills } = walk(presentScale);
      assert.ok(spills, `at ${presentScale} the card spills once the type is as small as it goes (scales ${scales.join(', ')})`);
      assert.equal(scales.at(-1), SMALLEST, `at ${presentScale} the last type is 0.75 (scales ${scales.join(', ')})`);
      for (let at = 1; at < scales.length; at += 1) assert.ok(scales[at] < scales[at - 1], `at ${presentScale} every step is smaller (scales ${scales.join(', ')})`);
    }
  });

  it('at 1.2, the iPad upright, it takes the steps it always took', () => {
    // 1.2 x 1, 0.9, 0.8, 0.7, 0.6: 1.2, 1.1 (1.08), 0.95 (0.96), 0.85 (0.84), 0.75 (0.72): then it spills.
    assert.deepEqual(walk(1.2), { scales: [1.2, 1.1, 0.95, 0.85, 0.75], spills: true });
  });
});
