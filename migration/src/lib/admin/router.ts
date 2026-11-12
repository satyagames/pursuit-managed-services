// The admin page's addresses (Prompt 44): pure functions that read a hash, write one, and hold a screen to what the person's role opens.
// The addresses are the ones the page always had: `#today`, `#clients`, `#content` and `#content/brand` (and the old `#sections`), `#guests`,
// `#results`, `#users`, the guest QR sheet `#print-guests`, the Live display `#live-display` and `#live-display/<id>`, and the wall
// `#live-display/<id>/wall`. No DOM, no history, no request: AdminApp.svelte keeps the wiring (when to read, when to write the address).

import { liveDisplayHash, liveDisplayOfHash } from '../common/admin-address.js';
import { wallHash, wallOfHash } from './live-wall.js';
import { DEFAULT_VIEW, hashOfView, viewOfHash } from './admin-content-views.js';
import { DEFAULT_TAB } from './tabs.js';

/** The address of the guest QR sheet: a view of the page, not a tab; Back returns to Guests and QR. */
export const PRINT_HASH = '#print-guests';

/** The Live display an address asks for, and whether it is the wall; null when the address is not the Live display's. */
export function liveOfHash(hash: string): { sessionId: string; wall: boolean } | null {
  const wall = wallOfHash(hash);
  if (wall !== null) return { sessionId: wall, wall: true };
  const live = liveDisplayOfHash(hash);
  return live === null ? null : { sessionId: live, wall: false };
}

/** The address of the Live display for a session ('' for whichever is live), as the wall or not. */
export const liveHash = (sessionId: string, wall: boolean) => (wall ? wallHash(sessionId) : liveDisplayHash(sessionId));

/** The tab an address names, among the tabs shown (Content's addresses are its views'); null for any other address. */
export function tabOfHash<T extends string>(hash: string, shown: readonly { id: T }[]): T | null {
  if (viewOfHash(hash) !== null) return 'content' as T;
  return shown.find((tab) => `#${tab.id}` === hash.split('?')[0])?.id ?? null;
}

/** The address of a tab: Content's carries its view. */
export const hashOfTab = (tab: string, contentView: string = DEFAULT_VIEW) => (tab === 'content' ? hashOfView(contentView) : `#${tab}`);

/** Content's view an address asks for, or the default one. */
export const contentViewOf = (hash: string) => viewOfHash(hash) ?? DEFAULT_VIEW;

export type Screen<T extends string> = { tab: T | string; printing: boolean; liveDisplay: string | null; wall: boolean };

/**
 * Where the shell opens for an address: the QR sheet, the Live display (a view of Results), or a tab. An address for a screen the role does not
 * open is not followed (`allowed(tab)` says whether the role opens a tab; null when there is no access to ask): the first tab shown instead.
 */
export function openingScreen<T extends string>(hash: string, shown: readonly { id: T }[], allowed: ((tab: string) => boolean) | null): Screen<T> {
  let printing = hash === PRINT_HASH;
  const view = liveOfHash(hash);
  let liveDisplay = view?.sessionId ?? null;
  let wall = view?.wall ?? false;
  if (printing && allowed && !allowed('guests')) printing = false;
  if (liveDisplay !== null && allowed && !allowed('results')) { liveDisplay = null; wall = false; }
  const tab = printing ? 'guests' : liveDisplay !== null ? 'results' : tabOfHash(hash, shown) ?? shown[0]?.id ?? DEFAULT_TAB;
  return { tab, printing, liveDisplay, wall };
}

/** The tab an arrow, Home or End moves to in the bar (Left and Right wrap); null for any other key. */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
