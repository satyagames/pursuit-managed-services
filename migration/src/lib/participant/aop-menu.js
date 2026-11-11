// The Art of Possibility's level menu (Prompt 42), with no DOM (scripts/test-aop-view.js): one tap on a box opens it, and nothing else does; which
// choices it offers; where it opens; and the criterion heading's name apart from a qualifier in brackets. pager/MatrixRating.svelte draws what this says.
//
// The menu is the only way a tap rates a box: a tap opens the menu (or closes it, on the same box), and a choice in it sets exactly that level. One menu
// is open at a time; Escape, a tap outside, a choice, focus leaving it and a scroll of more than MENU_SCROLL_CLOSE px close it.

import { LEVELS } from './aop-answer.js';

/** How far the page may scroll, px, before an open menu closes. */
export const MENU_SCROLL_CLOSE = 24;
/** The space between a box and its menu, px: the menu never covers its box. */
export const MENU_GAP = 6;

/** @typedef {{ r: number, c: number }} At */
/** @typedef {{ at: At | null, scrollY: number }} MenuState */
/**
 * @typedef {{ type: 'tap' | 'open', at: At, scrollY: number } | { type: 'scroll', scrollY: number } | { type: 'escape' | 'outside' | 'pick' | 'leave' }} MenuEvent
 */

/** @type {MenuState} */
export const MENU_CLOSED = Object.freeze({ at: null, scrollY: 0 });

const same = (/** @type {At | null} */ a, /** @type {At | null} */ b) => !!a && !!b && a.r === b.r && a.c === b.c;

/**
 * The menu after an event. A tap toggles its own box's menu and moves an open one to another box; `open` (the keyboard) opens without toggling.
 * @param {MenuState} state @param {MenuEvent} event @returns {MenuState}
 */
export function menuStep(state, event) {
  switch (event.type) {
    case 'tap':
      return same(state.at, event.at) ? MENU_CLOSED : { at: { ...event.at }, scrollY: event.scrollY };
    case 'open':
      return same(state.at, event.at) ? state : { at: { ...event.at }, scrollY: event.scrollY };
    case 'scroll':
      return state.at && Math.abs(event.scrollY - state.scrollY) > MENU_SCROLL_CLOSE ? MENU_CLOSED : state;
    default:
      return MENU_CLOSED;
  }
}

/** The menu's rows for a box at `level`: Low, Medium, High, and Clear (0) only when the box has a rating. @param {number | undefined} level */
export const menuChoices = (level) => (LEVELS.includes(/** @type {number} */ (level)) ? [1, 2, 3, 0] : [1, 2, 3]);

/** The level a choice sets: 1 to 3, or undefined (an empty box) for Clear. @param {number} choice */
export const levelOfChoice = (choice) => (LEVELS.includes(choice) ? choice : undefined);

/** @typedef {{ top: number, bottom: number, left: number, right: number }} Edges */

/**
 * Where the menu opens: below its box unless it would leave the card or the screen there and fits above (when neither fits, the side with more
 * room); from the box's right edge on the last columns or when it would run past the card or the screen on the right.
 * @param {{ box: Edges, menu: { width: number, height: number }, card: Edges, viewport: { width: number, height: number }, last?: boolean }} input
 * @returns {{ above: boolean, end: boolean }}
 */
export function placeMenu({ box, menu, card, viewport, last = false }) {
  const floor = Math.min(card.bottom, viewport.height);
  const ceiling = Math.max(card.top, 0);
  const below = floor - (box.bottom + MENU_GAP);
  const above = box.top - MENU_GAP - ceiling;
  const fitsBelow = below >= menu.height;
  const fitsAbove = above >= menu.height;
  const right = Math.min(card.right, viewport.width);
  return {
    above: !fitsBelow && (fitsAbove || above > below),
    end: last || box.left + menu.width > right,
  };
}

/**
 * A criterion heading's name and its qualifier: a bracket at the very end of the label ("Strategic value (counts against)") is the qualifier, kept in
 * its exact words for the heading's note and its accessible name; a bracket inside the name stays in it, and a label that is only a bracket is its name.
 * @param {string} label @returns {{ name: string, qualifier: string }}
 */
export function headingParts(label) {
  const text = String(label ?? '').trim();
  const match = /^(.*\S)\s*(\([^()]*\))$/.exec(text);
  return match ? { name: match[1], qualifier: match[2] } : { name: text, qualifier: '' };
}
