// Moving focus to a heading by script: a new screen, or the next question. It is how a screen
// reader hears where it now is, and where the keyboard carries on from. Every screen that does it
// goes through focusHeading(), and nothing else calls .focus() on a heading.
//
// A heading is not a control, so it shows the focus ring only to someone who is using the
// keyboard; after a tap or a click, focus moves there silently. The browser's own `:focus-visible`
// cannot decide this: before the first input of a page load it treats scripted focus as keyboard
// focus, which is what drew a box round "Today's experience isn't live yet" on an untouched iPad.
// So the last kind of input is tracked here, and the heading is marked when it was the keyboard.
// The rule that reads the mark is in styles/base.css.

/** The attribute a scripted heading focus carries when it should show the ring. */
export const KEYBOARD_FOCUS = 'data-keyboard-focus';

let keyboard = false;
let marked: HTMLElement | null = null;

if (typeof window !== 'undefined') {
  // A key pressed with Ctrl, Alt or Cmd is a shortcut, not someone finding their way by keyboard.
  window.addEventListener('keydown', (event) => { if (!event.ctrlKey && !event.altKey && !event.metaKey) keyboard = true; }, true);
  for (const type of ['pointerdown', 'mousedown', 'touchstart']) {
    window.addEventListener(type, () => {
      keyboard = false;
      // A heading can also take focus from a tap on it; it must not keep the ring from earlier.
      marked?.removeAttribute(KEYBOARD_FOCUS);
      marked = null;
    }, { capture: true, passive: true });
  }
}

/** Moves focus to `heading` (which needs tabindex="-1") without scrolling. The ring shows only for a keyboard user. */
export function focusHeading(heading: HTMLElement | null | undefined) {
  if (!heading) return;
  if (marked && marked !== heading) marked.removeAttribute(KEYBOARD_FOCUS);
  heading.toggleAttribute(KEYBOARD_FOCUS, keyboard);
  marked = keyboard ? heading : null;
  heading.focus({ preventScroll: true });
}
