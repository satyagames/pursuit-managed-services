// A phone or an iPad turned over in the middle of a question. The page is laid out again for the new shape, and the scroll position, which is a number of
// pixels, no longer means what it did: the answer the person had just chosen, that was on the screen, can end up above or below it (Phase 8: on an iPhone
// turned to landscape it was off the screen). This keeps what the person was looking at in view.
//
// It remembers whether the thing was on the screen as of the last scroll, tap or focus, and when the window changes size it puts the thing back in the
// middle of the screen if it was. If it was not on the screen (the person had scrolled away to re-read the question), nothing moves.

const inView = (element: Element) => {
  const { top, bottom } = element.getBoundingClientRect();
  return bottom > 0 && top < innerHeight;
};

/**
 * @param find what to keep in view: the answer chosen, or what has focus; called each time, because it changes
 * @returns a function that stops it
 */
export function keepInView(find: () => Element | null | undefined): () => void {
  let seen = false;
  let frame = 0;
  const note = () => { const element = find(); seen = !!element && inView(element); };
  // Two frames: the layout for the new shape has been made and painted before the thing is put back.
  const back = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { const element = find(); if (seen && element && !inView(element)) element.scrollIntoView({ block: 'center' }); }); });
  };
  const hear: [string, () => void][] = [['scroll', note], ['click', note], ['focusin', note], ['resize', back]];
  for (const [type, listener] of hear) addEventListener(type, listener, { passive: true });
  return () => { cancelAnimationFrame(frame); for (const [type, listener] of hear) removeEventListener(type, listener); };
}
