// Is this page on the developer's local server, or on a SharePoint site? Plain JS with JSDoc and no DOM, so `node --test` imports it.
//
// Until Phase 10b a page talked to SharePoint only at the one address it was built for and anywhere else fell back, without a word,
// to the local server (Phase 9a added a message for that: "This page is not set up for ..."). Since Phase 10b the page's own
// address decides: plain http, or this computer by any of its names, is the local server, and every other https address is
// SharePoint. lib/settings/deploy-settings.js then works out which site and lists, and a page that cannot tell stops and says so
// (PMS-CFG-001, PMS-CFG-004), so the older message has nothing left to say and is gone.

/**
 * @param {{ protocol: string, hostname: string }} location
 * @returns {boolean} true for the local server
 */
export function isLocalAddress(location) {
  const host = location.hostname;
  return location.protocol !== 'https:' || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
}
