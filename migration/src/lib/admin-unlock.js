// What the admin page's PIN screen says when it could not check a PIN (Phase 12, F-02). Plain JS with JSDoc and no DOM, so `node --test`
// imports it; the admin page's alone. Until Phase 12 every failure was "Couldn't reach the server: ...", which sent an account that SharePoint
// refuses (403 on the admins list: it is not an owner of the site) to check its Wi-Fi.

import { isSignedOut } from './sign-in.js';

/**
 * @param {unknown} error What the PIN check threw.
 * @param {{ isUnreachable: (error: unknown) => boolean, adminsList: string, support?: { name?: string, contact?: string } | null }} context
 *   `adminsList` is the admins list's title under this copy's settings (dataService.sharePointListTitles().adminusers); `support` is
 *   pms-config.txt's, when it has one.
 */
export function unlockFailureText(error, { isUnreachable, adminsList, support = null }) {
  const status = /** @type {{ status?: number } | null} */ (error)?.status;
  if (status === 403) {
    const who = support?.name ? `${support.name}${support.contact ? ` (${support.contact})` : ''}` : '';
    return `This account may not open the admin page. SharePoint would not let it read the list of admins (${adminsList}). `
      + `Ask a site owner to give you access${who ? `, or ask ${who}` : ''}.`;
  }
  if (isSignedOut(error)) return 'Your sign-in has expired. Reload this page to sign in again.';
  if (isUnreachable(error)) return 'Couldn\'t reach the server. Check the connection, then try again.';
  return `The admin page could not check the PIN: ${error instanceof Error && error.message ? error.message : 'please try again.'}`;
}
