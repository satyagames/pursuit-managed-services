// The full screen's type, a step at a time (Phase 11a-3; until then these lines were inside LiveDisplay.svelte). Full screen shows one question,
// with type `presentScale` times its usual size (1.2 to 2.4, from the window's width). A card that does not fit has its type made smaller, a tenth
// of `presentScale` at a time, down to SMALLEST; a card that still does not fit there spills (the screen scrolls as one page). Plain JS, no DOM:
// scripts/test-present-fit.js holds it.

/** The type is never made smaller than this, whatever the question (the chart's own text is never drawn below 1 whatever it is told). */
export const SMALLEST = 0.75;

/** The type the full screen draws: `presentScale` times `fitFactor`, to a twentieth, and never below SMALLEST. */
export const scaleOf = (presentScale, fitFactor) => Math.max(SMALLEST, Math.round(presentScale * fitFactor * 20) / 20);

/**
 * The next step for a card that does not fit at `fitFactor`: the next, smaller fit factor, or null when the type is already as small as it can be
 * drawn (the card then spills). Its floor is the factor that gives SMALLEST: on a window wide enough for type of 1.6 or more, a floor of 0.5 (11a-2)
 * left the type above SMALLEST, so the card neither got smaller nor spilled, and was cut at its edge.
 * @param {number} presentScale
 * @param {number} fitFactor
 * @returns {number | null}
 */
export function nextFit(presentScale, fitFactor) {
  if (scaleOf(presentScale, fitFactor) <= SMALLEST) return null;
  return Math.max(SMALLEST / presentScale, Math.round((fitFactor - 0.1) * 100) / 100);
}
