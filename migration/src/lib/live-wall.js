// The wall display's address (Phase 11a). "Open in a new tab" on the Live display opens the admin page at `#live-display/<sessionId>/wall`, which
// is the wall: the same results with no participant's name anywhere in the page, no Names switch, and Show answer on each graded question. The
// facilitator's own view stays `#live-display/<sessionId>`, with names. The flag is in the hash, so it never reaches SharePoint with the page
// request (VJR's choice, 16 Oct 2026). Full screen, from either, is the wall too; that is the page's own state and has no address.
//
// Plain JS with no DOM, and its own file: lib/admin-address.js is carried by the participant page, which must not change.

import { adminAddress, liveDisplayHash } from './admin-address.js';

export const WALL_SUFFIX = '/wall';

/** `#live-display/<sessionId>/wall`. @param {string} sessionId */
export const wallHash = (sessionId) => `${liveDisplayHash(sessionId)}${WALL_SUFFIX}`;

/**
 * The session a wall address is for, or null when the hash is not a wall's (so the caller reads it as the Live display's, or a tab's).
 * @param {string} hash
 * @returns {string | null}
 */
export function wallOfHash(hash) {
  const match = /^#live-display\/([^/]+)\/wall$/.exec(hash ?? '');
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

/**
 * admin.html beside `pageUrl`, opened on the wall display of `sessionId`.
 * @param {string} pageUrl @param {string} sessionId
 */
export function wallAddress(pageUrl, sessionId) {
  const url = new URL(adminAddress(pageUrl, sessionId));
  url.hash = wallHash(sessionId);
  return url.href;
}
