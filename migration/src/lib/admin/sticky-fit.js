// A side column that sticks under the bar only while it fits the window (Prompt 39): Today's Session settings and Share, a split view's list.
// The column is marked data-sticky="true" when its whole height, the 56 px bar, the sticky bottom bar (when the page has one) and 16 px above and
// below fit the window's height; the page's CSS makes only that column sticky. A taller column scrolls with the page, so nothing of it is ever
// out of reach or under the bottom bar. Watches the column's size and the window's: no timer, no read. Plain JS; the admin page's alone.

/** The bar's height and the gaps, in px: the 56 px bar, 16 px under it and 16 px above the bottom bar. */
export const STICKY_ROOM = 56 + 16 + 16;

/**
 * Whether a column of `height` px fits a window `windowHeight` px high, with a bottom bar `bottomBar` px high (0 for none).
 * @param {number} height @param {number} windowHeight @param {number} [bottomBar]
 */
export const fitsWindow = (height, windowHeight, bottomBar = 0) => height > 0 && height + STICKY_ROOM + bottomBar <= windowHeight;

/** A Svelte action: keeps `node.dataset.sticky` true while the column fits. @param {HTMLElement} node */
export function stickyIfFits(node) {
  const check = () => {
    const bottomBar = document.querySelector('.adm-bar')?.getBoundingClientRect().height ?? 0;
    node.dataset.sticky = String(fitsWindow(node.scrollHeight, window.innerHeight, bottomBar));
  };
  const watch = new ResizeObserver(check);
  watch.observe(node);
  window.addEventListener('resize', check);
  check();
  return {
    destroy() {
      watch.disconnect();
      window.removeEventListener('resize', check);
    },
  };
}
