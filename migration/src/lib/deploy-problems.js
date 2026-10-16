// What a page says when it cannot tell which site and lists are its own (Phase 10b). Plain JS, no DOM, so `node --test` imports it.
//
// Four problems, each in the six parts of ARCHITECTURE-10.md 7.2 (in git history at 7347c72): the code, a title, what happened, what to do next, who to ask and
// one technical line to copy. They are kept together here so that the error catalogue of Phase 10d can take them as they are.
// The reader is whoever published the app, so a file name may be spelled out; nothing else technical is in the sentences.
//
//   PMS-CFG-001  this copy has not been set up yet (nothing names its lists)
//   PMS-CFG-002  the settings file cannot be read, or is not valid (where it is wrong is named)
//   PMS-CFG-003  data was asked for before the page was set up (thrown by the data layer's guard; a bug, never a setting)
//   PMS-CFG-004  the page was opened from a different site than the settings name
//
// And since Phase 10c-2b, three about the lists themselves, found by the data layer on the AppSettings item every page reads first
// (its SchemaVersion; this build is for VERSION in public/js/pms-schema.js):
//
//   PMS-LST-010  the lists have not been set up for this app (no item, no list, or no SchemaVersion)
//   PMS-LST-011  the lists are of an older version than this build
//   PMS-LST-012  the lists are of a newer version than this build
//
// Only Setup loads this file. The participant and admin pages have a size to keep to, so they show one short stop screen with the
// code (lib/start.ts) that sends the person here; lib/deploy-settings.js, which they do carry, only codes what is wrong.

/** @typedef {{ id: string, title: string, what: string, next: string, who: string, technical: string }} Problem */

export const PUBLISHER = 'Whoever published the app';
export const PROBLEM_IDS = ['PMS-CFG-001', 'PMS-CFG-002', 'PMS-CFG-003', 'PMS-CFG-004'];
export const LISTS_PROBLEM_IDS = ['PMS-LST-010', 'PMS-LST-011', 'PMS-LST-012'];
const FILE = 'pms-config.txt';
const SETUP = 'Open Setup (setup.html, in the same folder as this page)';
const AGAIN = ', then press Try again.';
const CONNECTION = `Check the connection and that you are signed in to the site${AGAIN}`;
const SIGN_IN = `Sign in to the site in this browser${AGAIN}`;

/** Why the settings file could not be used, as the end of "This page could not use its settings file, pms-config.txt: ...". */
const REASON = {
  unreachable: () => 'there was no connection, or no answer within 8 seconds',
  status: ({ status }) => `the site answered ${status}`,
  // (An error page with a success status is what the first real site (14 Oct 2026) sent for a file it would not hand out: a .json, where a .txt was served.)
  page: () => "the site sent a web page in its place, usually its sign-in page, or an error page such as 'File Not Found' when the site will not hand out this kind of file",
  json: () => 'it is not valid JSON',
  invalid: ({ at }) => (at === '*' ? 'it is not one JSON object' : `"${at}" is not valid`),
};

/** For each code: (the coded problem, what the page started from) -> [title, what happened, what to do next, the technical line]. */
const PARTS = {
  'PMS-CFG-001': (found, { file, opened }) => ['This copy of the app has not been set up yet',
    'The app does not know which lists belong to it, so it has stopped rather than guess.',
    `${SETUP}. It shows the two ways to name this copy's lists.`,
    `no listPrefix: ${FILE} ${file === undefined ? 'was not found' : 'has none'} and none is built in, opened from ${opened}`],
  'PMS-CFG-002': (found, { opened }) => (found.kind === 'built'
    ? ['The settings built into this page cannot be used', `The settings built into this page are not valid ("${found.at}").`,
      'Build the pages again with corrected PMS_ values, then upload them.', `built in, not valid at ${found.at}, opened from ${opened}`]
    : ["The app's settings file cannot be used", `This page could not use its settings file, ${FILE}: ${REASON[found.kind](found)}. It has stopped rather than guess.`,
      found.kind === 'json' || found.kind === 'invalid' ? `${SETUP} to see what is wrong, correct the file${AGAIN}`
        : found.kind === 'page' || [401, 403].includes(found.status) ? SIGN_IN : CONNECTION,
      `${found.kind === 'invalid' ? `not valid at ${found.at}` : `${found.kind}${found.status ? ` ${found.status}` : ''}`}, ${new URL(FILE, opened).href}`]),
  'PMS-CFG-003': () => ['The page asked for data before it was set up',
    'A part of this page tried to read or save data before it knew which site and lists to use. Nothing was sent.',
    'Reload the page. If this comes back, send the details below to whoever published the app.', ''],
  'PMS-CFG-004': (found, { opened, siteUrl, source }) => ['This page was opened from the wrong address',
    'This copy of the app is set up for a different SharePoint site than the one it was opened from.',
    'Open it from its own site, or correct the site address in the settings.',
    `opened from ${opened}, siteUrl ${siteUrl} (${source === 'file' ? FILE : source})`],
  // (`found.version` is what the site's settings item says, `found.wanted` this build's, and `found.list` that list's title on this site.)
  'PMS-LST-010': (found) => ["This site's lists have not been set up for this app yet",
    'The app reads the version of the lists from their settings item, and this site has none: the lists, or that item, have not been made.',
    'Open Setup.', `no SchemaVersion on the ${found.list ?? 'settings'} item (or no item, or no list); this build needs ${found.wanted}`],
  // (Phase 10i: Setup adds what the newer version needs and raises the version; the words say what to press, in order.)
  'PMS-LST-011': (found) => ["This site's lists need an update before this version of the app can use them",
    `The lists on this site are version ${found.version}; this version of the app needs version ${found.wanted}.`,
    `${SETUP}, press Show the plan, then Create, then Mark the site as ready: a clean Create does the last step by itself.`, `SchemaVersion ${found.version}, this build needs ${found.wanted}`],
  'PMS-LST-012': (found) => ['This site has been updated for a newer version of the app',
    `The lists on this site are version ${found.version}; these files are for version ${found.wanted}.`,
    'Upload the newer files.', `SchemaVersion ${found.version}, this build needs ${found.wanted}`],
};

/**
 * One problem in six parts.
 * @param {{ id: string, kind?: string, status?: number, at?: string }} found what lib/deploy-settings.js (or the data layer's guard,
 *   for PMS-CFG-003) coded
 * @param {{ pageUrl?: string, file?: unknown, known?: { siteUrl?: string, support?: { name?: string, contact?: string } | null }, sources?: Record<string, string>, technical?: string }} [context]
 *   what the page started from: its address, the settings file as read (`undefined` for none), and what the resolver worked out.
 *   `technical` replaces the technical line's own detail.
 * @returns {Problem}
 */
export function problem(found, { pageUrl = 'https://unknown.invalid/', file, known = {}, sources = {}, technical } = {}) {
  const page = new URL(pageUrl);
  const [title, what, next, detail] = PARTS[found.id](found, { file, opened: page.origin + page.pathname, siteUrl: known.siteUrl, source: sources.siteUrl });
  const who = [known.support?.name, known.support?.contact].filter(Boolean).join(', ') || PUBLISHER;
  const line = technical ?? detail;
  return { id: found.id, title, what, next, who, technical: line ? `${found.id}, ${line}` : found.id };
}
