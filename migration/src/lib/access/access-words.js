// What the admin page says about access (Prompt 21, Phase 1): the No access screen (board 2) and the site owner's banner (board 10's edge states).
// Plain sentence case, no SharePoint words; the product's name is APP_NAME's. Plain JS with no DOM, so `node --test` holds the words.

/** The site owner's banner, until they have a Super admin row of their own (decision I). */
export const OWNER_BANNER = 'You can see everything because you own this site. Add yourself as a Super admin in Setup.';

/**
 * The No access screen's heading and line, by why there is no access: 'disabled' (a leaver), else no role (or none current).
 * @param {string} appName @param {'disabled' | 'no-roles' | string | null} reason
 */
export function noAccessWords(appName, reason) {
  // (Prompt 21, Phase 6: the two ways a page that was open loses its access, lib/access/resolve.js lostAccess.)
  if (reason === 'turned-off') {
    return { title: `Your access to ${appName} was turned off`, line: `This happened while the page was open, so nothing more can be changed here. What was saved before is kept. Ask a Super admin of ${appName} if you need it again.` };
  }
  if (reason === 'role-removed') {
    return { title: `Your access to ${appName} has changed`, line: `You no longer have a role that opens this page, so nothing more can be changed here. What was saved before is kept. Ask a Super admin of ${appName} if you need it.` };
  }
  if (reason === 'disabled') {
    return { title: `Your access to ${appName} is turned off`, line: `Ask a Super admin of ${appName} if you need it again.` };
  }
  return { title: `You do not have access to ${appName} yet`, line: `Ask a Super admin of ${appName} to give you access.` };
}

/** What "Copy my details" puts on the clipboard: the name and email a Super admin needs to add the person. */
export const myDetails = (person) => [person?.name, person?.email].filter(Boolean).join(', ');

// (Prompt 25: an app role does not open the SharePoint site. The words say "this site", never "PCOE": scripts/release-proofs.js keeps site names out of the pages. Words only; no screen checks SharePoint permissions.)

/** The document that says how to add a person to the PCOE site. */
export const ONBOARDING_DOC = 'docs/ONBOARDING.md';

/** The line under Add user's search. */
export const SITE_ACCESS_ADD_USER = 'Adding a person here does not give them access to the SharePoint site.';

/** The line the No access screen adds, after its own "ask an Admin" line: a person who sees it already has site access. */
export const NO_ACCESS_SITE_LINE = 'If SharePoint itself said the item has not been shared with you, ask the site owner to add you to this site.';

/**
 * Give access's line about the site: Producer, Designer and Admin need Edit access to the site, Leadership needs Read. Nothing when a person gives
 * themselves a role (they are in the site already).
 * @param {string} role @param {{ person?: { key?: string } | null, me?: { key?: string } | null }} who
 */
export function siteAccessNote(role, { person, me } = {}) {
  if (person?.key && person.key === me?.key) return '';
  const link = `How to add them: ${ONBOARDING_DOC}.`;
  if (role === 'Leadership') return `This person also needs access to this SharePoint site to open the pages. Read access is enough. Roles here do not give that. ${link}`;
  return `This person also needs Edit access to this SharePoint site to open the pages. Roles here do not give that. ${link}`;
}
