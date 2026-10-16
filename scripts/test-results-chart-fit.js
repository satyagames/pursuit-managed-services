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

// Phase 11a-3, item A: on the real site (PCOE, pms-283ad18, 16 Oct 2026) a tooltip lay over the question, the "got it right first time" line and the
// Show answer / View as table buttons above its mark. `avoid` is those words and buttons: the tooltip keeps clear of them where the window has room,
// and where it has none it is still whole, inside the window and clear of the mark and its own label, covering as little of them as it can.
describe('a tooltip and the words of its card', () => {
  // The card's words over the top bar: the question 100..1436 across and 300..340 down, the "N answered" line 100..700 and the buttons 1200..1436,
  // both 350..390 down. The top bar's row is 100..1436 across and 400..440 down, and its tooltip is centred on 768.
  const QUESTION = { left: 100, top: 300, right: 1436, bottom: 340 };
  const META = { left: 100, top: 350, right: 700, bottom: 390 };
  const TOOLS = { left: 1200, top: 350, right: 1436, bottom: 390 };
  const ROW = { left: 100, top: 400, right: 1436, bottom: 440 };
  const overlaps = (tip, box) => Math.min(tip.left + TIP.width, box.right) > Math.max(tip.left, box.left) && Math.min(tip.top + TIP.height, box.bottom) > Math.max(tip.top, box.top);

  it('with nothing to avoid, is placed exactly as before', () => {
    assert.deepEqual(placeTip(TIP, ROW, 768, WINDOW, { avoid: [] }), placeTip(TIP, ROW, 768, WINDOW));
  });

  it('goes under its mark when above it would lie over the question or the "N answered" line', () => {
    // Above: 400 - 6 - 60 = 334, which lies over the question (to 340) and the line (350..390). Under: 440 + 6 = 446, clear of all three.
    const at = placeTip(TIP, ROW, 768, WINDOW, { avoid: [QUESTION, META, TOOLS] });
    assert.deepEqual(at, { left: 668, top: 446, below: true });
    for (const box of [QUESTION, META, TOOLS, ROW]) assert.equal(overlaps(at, box), false);
  });

  it('stays above, moved along, when that clears the words and the mark is still under it', () => {
    // Only the buttons are in the way: a column 1290..1330 across and 420..600 down, centred on 1310. Above: 420 - 66 = 354, from 1210 to 1410, over the
    // buttons (1200..1436, 350..390). Moved to end 6 short of the buttons: 1200 - 6 - 200 = 994, which ends at 1194 and does not cover 1310 any more.
    // So the other side: the buttons' right edge 1436 + 6 = 1442, which ends at 1642, outside the window. Above cannot be cleared: under, 606.
    const column = { left: 1290, top: 420, right: 1330, bottom: 600 };
    assert.deepEqual(placeTip(TIP, column, 1310, WINDOW, { avoid: [TOOLS] }), { left: 1210, top: 606, below: true });
    // Buttons that are narrow, 1250..1300: moved to their right, 1306, the tooltip ends at 1506 and still covers 1310: above, clear of them.
    const narrow = { left: 1250, top: 350, right: 1300, bottom: 390 };
    assert.deepEqual(placeTip(TIP, column, 1310, WINDOW, { avoid: [narrow] }), { left: 1306, top: 354, below: false });
  });

  it('where neither side is clear, takes the side that covers less of the words, still whole and clear of its mark', () => {
    // A window 520 high and a caption under the chart, 503..520. Under the row (446..506) the tooltip lies over the caption by 3 rows of its 200
    // across: 600 pixels. Above (334..394, 668..868) it lies over the question by 6 rows (1,200) and the line by 40 rows of 32 (1,280); moved to the
    // line's right (706..906) it is still over the question by 6 rows: 1,200. Under covers least, and is taken.
    const short = { width: 1536, height: 520 };
    const caption = { left: 100, top: 503, right: 1436, bottom: 520 };
    const at = placeTip(TIP, ROW, 768, short, { avoid: [QUESTION, META, TOOLS, caption] });
    assert.deepEqual(at, { left: 668, top: 446, below: true });
    assert.equal(overlaps(at, ROW), false);
  });
});

// Phase 11a-3, after the photographs of pms-618b8fc (16 Oct 2026): in full screen the tooltip of a ranking's last bar ("Reduce cost") could not go under
// it (the caption "100 means everyone ranked it first" is there, one of the card's words) and went above, over the figures of the two bars above it ("56"
// cut, Scale talent model's hidden). `soft` is the other marks' figures and labels: kept clear of where there is room, after the card's words (covering a
// word costs far more than covering a figure). And the tooltip may move along its mark's whole track (`span`), not only so far that it still covers `x`.
describe("a tooltip and the other bars' figures", () => {
  // The photograph, in its own pixels: a window 1600x900, a tooltip 410x100. The last bar's row 150..1350 across and 666..712 down, its track (where the
  // bars are drawn) 705..1350, centred on 1028. "56", the figure of the third bar, 1070..1105 and 540..565; the fourth bar's figure 895..935 and
  // 602..632; the caption 150..1350 and 770..795.
  const BIG = { width: 410, height: 100 };
  const VIEW = { width: 1600, height: 900 };
  const LAST = { left: 150, top: 666, right: 1350, bottom: 712 };
  const TRACK = { left: 705, right: 1350 };
  const FIFTY_SIX = { left: 1070, top: 540, right: 1105, bottom: 565 };
  const FOURTH = { left: 895, top: 602, right: 935, bottom: 632 };
  const CAPTION = { left: 150, top: 770, right: 1350, bottom: 795 };
  const covers = (at, box) => Math.min(at.left + BIG.width, box.right) > Math.max(at.left, box.left) && Math.min(at.top + BIG.height, box.bottom) > Math.max(at.top, box.top);

  it('without them, lies over both figures (the photograph)', () => {
    // Under: 712 + 6 = 718, over the caption. Above: 666 - 6 - 100 = 560, centred on 1028: 823..1233, over "56" and the fourth figure.
    const at = placeTip(BIG, LAST, 1028, VIEW, { avoid: [CAPTION] });
    assert.deepEqual(at, { left: 823, top: 560, below: false });
    assert.ok(covers(at, FIFTY_SIX) && covers(at, FOURTH));
  });

  it('with them, moves along its track until it covers neither, still above and clear of the caption', () => {
    // Moved to end 6 short of "56": 1070 - 6 - 410 = 654..1064, still over the fourth figure. To start 6 past it: 1111..1521, which covers neither, is
    // inside the window and still over the track (705..1350): taken. (It no longer covers 1028, the track's middle: `span` allows that.)
    const at = placeTip(BIG, LAST, 1028, VIEW, { avoid: [CAPTION], soft: [FIFTY_SIX, FOURTH], span: TRACK });
    assert.deepEqual(at, { left: 1111, top: 560, below: false });
    for (const box of [FIFTY_SIX, FOURTH, CAPTION, LAST]) assert.equal(covers(at, box), false);
  });

  it('covers a figure rather than a word when it must cover one', () => {
    // No room to move along (the track is only the mark's own width) and a figure right above: above covers the figure, under covers the caption.
    // Above is taken: a word outweighs a figure.
    const narrow = { left: 1000, right: 1056 };
    const figure = { left: 1000, top: 600, right: 1056, bottom: 640 };
    const at = placeTip(BIG, LAST, 1028, VIEW, { avoid: [CAPTION], soft: [figure], span: narrow });
    assert.equal(at.below, false);
    assert.ok(covers(at, figure));
  });

  it('with no span, moves along only so far that it still covers x, as before', () => {
    // The same as above without `span`: 1111..1521 does not cover 1028, so it is not a place. Those that are: centred, 823..1233, over both figures;
    // 654..1064, over the fourth figure (40 x 30 = 1,200 pixels); 941..1351 (6 past the fourth figure), over the bottom 5 rows of "56" (35 x 5 = 175).
    // The one covering least is taken: 941.
    const at = placeTip(BIG, LAST, 1028, VIEW, { avoid: [CAPTION], soft: [FIFTY_SIX, FOURTH] });
    assert.deepEqual(at, { left: 941, top: 560, below: false });
  });
});
