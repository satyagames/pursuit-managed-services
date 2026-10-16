// Where a Results chart's tooltip goes (Phase 11a-2). On the real site a confidence question's tooltip was cut off by its own chart, which had
// become a scrolling box, and it lay over the label of the column it was about. Since then the tooltip is drawn in a layer fixed to the window, so
// no card, chart or scrolling box can cut it off, and this decides where in the window: next to its mark, clear of the mark and of the mark's own
// label (above them, or under them when there is no room above), and moved along so that it stays inside the window. Plain JS, no DOM:
// scripts/test-results-chart-fit.js holds it to cases worked out by hand.

/** @typedef {{ left: number, top: number, right: number, bottom: number }} Box */

/** How far the tooltip keeps from what it is about, and from the edges of the window, in CSS pixels. */
export const TIP_GAP = 6;
export const TIP_MARGIN = 8;

/**
 * The box round several boxes (a mark and its label). Empty boxes (an element that is not drawn) are left out.
 * @param {Box[]} boxes
 * @returns {Box}
 */
export function around(boxes) {
  const drawn = boxes.filter((box) => box.right > box.left || box.bottom > box.top);
  if (drawn.length === 0) return { left: 0, top: 0, right: 0, bottom: 0 };
  return {
    left: Math.min(...drawn.map((box) => box.left)),
    top: Math.min(...drawn.map((box) => box.top)),
    right: Math.max(...drawn.map((box) => box.right)),
    bottom: Math.max(...drawn.map((box) => box.bottom)),
  };
}

/**
 * The tooltip's place in the window: centred across on `x`, above `clear` (the mark and its own label) when it fits there, else under it, and
 * when it fits on neither side (a very small window), on the side with more room, kept inside the window. It is never wider than the window
 * less its margins (its style says so), so across it always fits.
 * @param {{ width: number, height: number }} size the tooltip's own size
 * @param {Box} clear what it must not cover
 * @param {number} x where its middle goes, across
 * @param {{ width: number, height: number }} view the window
 * @returns {{ left: number, top: number, below: boolean }}
 */
export function placeTip(size, clear, x, view, { gap = TIP_GAP, margin = TIP_MARGIN } = {}) {
  const left = Math.max(margin, Math.min(x - size.width / 2, view.width - margin - size.width));
  const above = clear.top - gap - size.height;
  if (above >= margin) return { left, top: above, below: false };
  const below = clear.bottom + gap;
  if (below + size.height <= view.height - margin) return { left, top: below, below: true };
  const under = view.height - clear.bottom > clear.top;
  const top = under ? Math.min(below, view.height - margin - size.height) : above;
  return { left, top: Math.max(margin, Math.min(top, view.height - margin - size.height)), below: under };
}
