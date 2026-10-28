// What the admin page says about access (Prompt 21, Phase 1): the No access screen (board 2) and the site owner's banner (board 10's edge states).
// Plain sentence case, no SharePoint words; the product's name is APP_NAME's. Plain JS with no DOM, so `node --test` holds the words.

/** The site owner's banner, until they have a Super admin row of their own (decision I). */
export const OWNER_BANNER = 'You can see everything because you own this site. Add yourself as a Super admin in Setup.';

/**
 * The No access screen's heading and line, by why there is no access: 'disabled' (a leaver), else no role (or none current).
 * @param {string} appName @param {'disabled' | 'no-roles' | string | null} reason
 */
export function noAccessWords(appName, reason) {
  if (reason === 'disabled') {
    return { title: `Your access to ${appName} is turned off`, line: `Ask a Super admin of ${appName} if you need it again.` };
  }
  return { title: `You do not have access to ${appName} yet`, line: `Ask a Super admin of ${appName} to give you access.` };
}

/** What "Copy my details" puts on the clipboard: the name and email a Super admin needs to add the person. */
export const myDetails = (person) => [person?.name, person?.email].filter(Boolean).join(', ');
