// Kiosk lock-down for the pages. It replaced the legacy pages' unconditional script, which locked every
// visitor down; that script left the branch with the legacy app in Phase 10c-1.
//
// The lock-down (no pinch zoom, no long-press menu, no text selection, no rubber-band
// scroll) is only right for a configured iPad running the page full-screen. Everywhere else
// people expect to zoom and select text, so it switches on only when
//   - the page runs as an installed web app (display-mode: standalone, or iOS navigator.standalone), or
//   - the address has ?kiosk=1 (a Safari tab that should still behave like the kiosk).
//
// Safari ignores user-scalable=no (an accessibility rule since iOS 10), so pinch can only be
// stopped from script, with the non-standard gesture events and multi-touch touchmove.

const TEXT_TARGET = 'input, textarea, [contenteditable]';

type KioskWindow = Pick<Window, 'location' | 'matchMedia'> & { navigator: Navigator & { standalone?: boolean } };

/** True when the page should behave like a locked-down kiosk. */
export function isKioskMode(win: KioskWindow = window): boolean {
  const flag = (query: string) => new URLSearchParams(query).get('kiosk') === '1';
  // ?kiosk=1 can sit before the hash (index.html?kiosk=1#/welcome) or inside it (#/welcome?kiosk=1).
  const hashQuery = win.location.hash.includes('?') ? win.location.hash.slice(win.location.hash.indexOf('?')) : '';
  if (flag(win.location.search) || flag(hashQuery)) return true;
  return win.matchMedia?.('(display-mode: standalone)').matches === true || win.navigator.standalone === true;
}

/**
 * Applies the lock-down when `isKioskMode()` and keeps it in step if the display mode
 * changes. Marks <html data-kiosk> so CSS can follow the same rule. Returns a function that
 * removes everything again.
 */
export function installKiosk(doc: Document = document, win: KioskWindow = window): () => void {
  const root = doc.documentElement;
  let remove: (() => void) | null = null;

  const preventDefault = (event: Event) => event.preventDefault();
  const preventPinch = (event: TouchEvent) => { if (event.touches.length > 1) event.preventDefault(); };
  const preventMenu = (event: Event) => {
    const target = event.target as Element | null;
    if (!target?.closest?.(TEXT_TARGET)) event.preventDefault();
  };

  function engage() {
    const gestures = ['gesturestart', 'gesturechange', 'gestureend'];
    for (const type of gestures) doc.addEventListener(type, preventDefault);
    // Non-passive on purpose: a passive listener cannot cancel the pinch.
    doc.addEventListener('touchmove', preventPinch, { passive: false });
    doc.addEventListener('contextmenu', preventMenu);
    root.setAttribute('data-kiosk', '');
    remove = () => {
      for (const type of gestures) doc.removeEventListener(type, preventDefault);
      doc.removeEventListener('touchmove', preventPinch);
      doc.removeEventListener('contextmenu', preventMenu);
      root.removeAttribute('data-kiosk');
      remove = null;
    };
  }

  function sync() {
    const wanted = isKioskMode(win);
    if (wanted && !remove) engage();
    else if (!wanted && remove) remove();
  }

  sync();
  const display = win.matchMedia?.('(display-mode: standalone)');
  display?.addEventListener?.('change', sync);

  return () => {
    display?.removeEventListener?.('change', sync);
    remove?.();
  };
}
