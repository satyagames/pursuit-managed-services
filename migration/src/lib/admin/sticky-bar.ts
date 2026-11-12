// The admin's sticky bottom bar and an iPad's keyboard (Prompt 38). When the on-screen keyboard opens, the visual viewport shrinks and a bar fixed
// to the layout's foot would sit under the keys; this writes how much the keyboard covers into --adm-keyboard on <html>, which admin-look.css adds
// to the bar's bottom, and puts it back to 0 when the keyboard closes. No timer: the viewport's own resize and scroll events. The admin page's alone.

/** How many CSS pixels at the foot of the layout the keyboard (or anything else) hides: 0 when nothing does. */
function coveredBelow(layoutHeight: number, viewportHeight: number, viewportTop: number): number {
  const covered = Math.round(layoutHeight - (viewportHeight + viewportTop));
  return covered > 0 ? covered : 0;
}

/** Follows the visual viewport while a bar is shown; returns the function that stops it. */
export function followKeyboard(): () => void {
  const viewport = typeof window === 'undefined' ? null : window.visualViewport;
  if (!viewport) return () => {};
  const root = document.documentElement;
  const update = () => {
    root.style.setProperty('--adm-keyboard', `${coveredBelow(window.innerHeight, viewport.height, viewport.offsetTop)}px`);
  };
  update();
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  return () => {
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
    root.style.removeProperty('--adm-keyboard');
  };
}
