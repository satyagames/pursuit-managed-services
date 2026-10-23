// What the admin page and Setup say about a refused SharePoint request (Prompt 19). Plain JS with JSDoc and no DOM (scripts/test-session.js).
// The data layer classifies every refusal (lib/data/session.js) and recovers what it can; what it cannot is one of two errors, and this says
// them in words:
//   - a sign-in it could not renew (`code: 'session-lost'`): the shell's banner says what to do (sessionBanner), so a screen that prints its
//     own error line prints its own plain fallback instead of SharePoint's words (errorText);
//   - a permission (`kind: 'permission'`, a 403 that still happened once the sign-in was proven to work): a sentence naming the list and whom
//     to ask (permissionText). The only case where "access" may still reach a person.
// Anything else is said as it always was. Reads nothing and writes nothing.

const isLost = (cause) => /** @type {{ code?: string } | null} */ (cause)?.code === 'session-lost';

/**
 * The sentence for a refused list. `listTitle` is the list's title on this site (the data layer's spTitle(), as sharePointListTitles() gives it).
 * @param {{ listTitle?: string | null, method?: string }} refusal
 */
export function permissionText({ listTitle, method }) {
  return `Your account cannot ${method === 'GET' ? 'read' : 'change'} ${listTitle ?? 'the PMS lists'}. Ask the site owner for Contribute access to the PMS lists.`;
}

/**
 * What a screen prints for an error it caught: its own `fallback` for a lost sign-in (the banner says the rest), the permission sentence with its
 * Details, else the error's own words as before.
 * @param {unknown} cause
 * @param {string} fallback
 */
export function errorText(cause, fallback) {
  if (isLost(cause)) return fallback;
  const refusal = /** @type {{ kind?: string, details?: string, listTitle?: string, method?: string }} */ (cause);
  if (refusal?.kind === 'permission') return `${permissionText(refusal)}${refusal.details ? ` Details: ${refusal.details}.` : ''}`;
  return cause instanceof Error ? cause.message : fallback;
}

/**
 * The banner for a lost sign-in, or null for any other error: its sentence, the warning when a screen holds unsaved work, and its Details line
 * (status, SharePoint's code, the SPRequestGuid, how long since the last answer).
 * @param {unknown} cause
 * @param {{ unsaved: boolean }} state
 */
export function sessionBanner(cause, { unsaved }) {
  if (!isLost(cause)) return null;
  const lost = /** @type {{ message: string, details?: string }} */ (cause);
  return { text: lost.message, warning: unsaved ? 'Your unsaved changes here will be lost if you reload.' : '', details: lost.details ?? '' };
}
