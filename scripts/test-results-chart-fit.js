// Phase 11a-2: where a Results chart's tooltip goes. Run: node --test scripts/test-results-chart-fit.js (also part of npm test and npm run test:charts)
//
// migration/src/lib/tip-place.js decides where in the window a tooltip is drawn: centred on its mark, above the mark and the mark's own label, under
// them when there is no room above, and always inside the window. Every expected place is worked out by hand in the comments beside it. The browser
// side, at every size and in all three engines, is scripts/migration-tests/results-charts-fit.spec.ts.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TIP_GAP, TIP_MARGIN, around, placeTip } from '../migration/src/lib/tip-place.js';

const WINDOW = { width: 1536, height: 864 };
const TIP = { width: 200, height: 60 };

describe('the box round a mark and its label', () => {
  it('is the smallest box holding them all, leaving out what is not drawn', () => {
    // A column 700..740 across and 400..600 down, its label under it 650..830 and 610..640: the box is 650..830 across and 400..640 down.
    assert.deepEqual(around([{ left: 700, top: 400, right: 740, bottom: 600 }, { left: 650, top: 610, right: 830, bottom: 640 }, { left: 0, top: 0, right: 0, bottom: 0 }]), { left: 650, top: 400, right: 830, bottom: 640 });
    assert.deepEqual(around([]), { left: 0, top: 0, right: 0, bottom: 0 });
  });
});

describe('a tooltip', () => {
  it('goes above its mark, centred on it, 6px clear', () => {
    assert.equal(TIP_GAP, 6);
    assert.equal(TIP_MARGIN, 8);
    // The middle column of the photograph at 1536x864: its count's top at 440. Above: 440 - 6 - 60 = 374. Centred on 768: 768 - 100 = 668.
    assert.deepEqual(placeTip(TIP, { left: 650, top: 440, right: 886, bottom: 730 }, 768, WINDOW), { left: 668, top: 374, below: false });
  });

  it('goes under the mark and its label when there is no room above, never over the label', () => {
    // A mark at the top of the window, 30..80, its label under it to 110: above would be 30 - 66 = -36 (off the window); under: 110 + 6 = 116.
    assert.deepEqual(placeTip(TIP, { left: 100, top: 30, right: 300, bottom: 110 }, 200, WINDOW), { left: 100, top: 116, below: true });
    // Exactly room above: top 74 - 66 = 8, the margin itself.
    assert.deepEqual(placeTip(TIP, { left: 100, top: 74, right: 300, bottom: 110 }, 200, WINDOW).below, false);
    assert.deepEqual(placeTip(TIP, { left: 100, top: 73, right: 300, bottom: 110 }, 200, WINDOW).below, true);
  });

  it('is moved along to stay inside the window at either edge', () => {
    // Centred on 20 it would start at -80: it starts at the margin, 8. Centred on 1530 it would end at 1630: it ends at 1536 - 8, so starts at 1328.
    assert.equal(placeTip(TIP, { left: 0, top: 400, right: 40, bottom: 500 }, 20, WINDOW).left, 8);
    assert.equal(placeTip(TIP, { left: 1500, top: 400, right: 1536, bottom: 500 }, 1530, WINDOW).left, 1328);
  });

  it('in a window too small for either side, takes the side with more room and stays inside the window', () => {
    // A window 200 high and a mark 40..170: above would be 40 - 66 = -26, under 176 + 60 = 236 > 192. More room above (40) than under (30), so
    // above, held at the margin: 8.
    const small = { width: 400, height: 200 };
    assert.deepEqual(placeTip(TIP, { left: 100, top: 40, right: 200, bottom: 170 }, 150, small), { left: 50, top: 8, below: false });
    // A mark 20..150: under has more room (50 > 20); under would be 156, held so that it ends at 192: 132.
    assert.deepEqual(placeTip(TIP, { left: 100, top: 20, right: 200, bottom: 150 }, 150, small), { left: 50, top: 132, below: true });
  });
});
