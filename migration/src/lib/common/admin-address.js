// Where the facilitator's Live display is, as an address. Plain JS with no DOM and no imports, so the participant page can carry it
// (the old results address only has to point at the admin page) and scripts/test-polling.js can hold it.

/** The hash the admin page keeps for the Live display: `#live-display` (the live session), or `#live-display/<sessionId>`. @param {string} [sessionId] */
export const liveDisplayHash = (sessionId = '') => (sessionId ? `#live-display/${encodeURIComponent(sessionId)}` : '#live-display');

/**
 * The session a hash asks the Live display for: `null` when the hash is not the Live display's, '' for the live session,
 * otherwise a session id. @param {string} hash
 * @returns {string | null}
 */
export function liveDisplayOfHash(hash) {
  const match = /^#live-display(?:\/(.*))?$/.exec(hash ?? '');
  if (!match) return null;
  try { return match[1] ? decodeURIComponent(match[1]) : ''; } catch { return ''; }
}

/**
 * admin.html in the same folder as `pageUrl` (the participant page, wherever it is hosted: a SharePoint document folder, the local server,
 * a nested staging path), opened on the Live display for `sessionId` when there is one. Nothing of the participant's address is carried
 * over: no track, no code, no query.
 * @param {string} pageUrl @param {string} [sessionId]
 */
export function adminAddress(pageUrl, sessionId = '') {
  const url = new URL(pageUrl);
  url.pathname = `${url.pathname.replace(/[^/]*$/, '')}admin.html`;
  url.search = '';
  url.hash = liveDisplayHash(sessionId);
  return url.href;
}
