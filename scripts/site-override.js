// The values a build can put into the three Svelte pages (Phase 9c, reworked in Phase 10b), from PMS_ environment variables.
//
//   PMS_SITE_URL=https://<host>/sites/<site>   the SharePoint site, when the page's own address would not give it (a sub-site)
//   PMS_LIST_PREFIX=PMS3                       what is in front of every list's title; PMS_LIST_PREFIX='""' (two quotation marks)
//                                              says "nothing in front, on purpose". Left out or blank, nothing is built in.
//   PMS_LOGO_LIBRARY=Client Pictures           the picture library, when it is not <prefix>ClientLogos
//   PMS_BATCH=false                            this site refuses grouped reads ($batch)
//   PMS_SUPPORT_NAME, PMS_SUPPORT_CONTACT      who to ask, for the "Who to ask" line of a problem
//   PMS_LABEL=Test, folder 3                   a short name for this copy, shown in the admin bar and on Setup
//
// They reach a page as ONE constant, `__PMS_BUILT__`, that the bundler defines (migration/vite-plugin-built-settings.ts) and
// migration/src/lib/settings/built-settings.ts reads: no text of any source file is searched for and replaced (until Phase 10b this was a
// search-and-replace of three exact strings of the legacy pages' settings file, which left the branch in Phase 10c-1). With no variable set the
// constant is `{}`. A page reads its settings file, pms-config.txt, first and uses these for what the file leaves out
// (lib/settings/deploy-settings.js), so a value built in is a fallback and never an override. The rules for each value are the ones the page
// itself applies (lib/settings/deploy-rules.js), so a build cannot put in what a page would refuse.
import { settingsProblem } from '../migration/src/lib/settings/deploy-rules.js';

/** The variable each setting comes from, for the words of a refusal. */
const VARIABLE = { siteUrl: 'PMS_SITE_URL', listPrefix: 'PMS_LIST_PREFIX', logoLibrary: 'PMS_LOGO_LIBRARY', batch: 'PMS_BATCH', 'support.name': 'PMS_SUPPORT_NAME', 'support.contact': 'PMS_SUPPORT_CONTACT', label: 'PMS_LABEL' };
/** How the empty prefix is written, so that a variable that is merely blank never means "use the lists that have no prefix". */
export const NO_PREFIX = '""';

/** @returns {{ origin: string, siteUrl: string } | null} null when PMS_SITE_URL is not set; throws a plain sentence for a bad one */
export function readSiteUrl(raw) {
  if (!raw) return null;
  const bad = (why) => new Error(`PMS_SITE_URL ${why} (got "${raw}"). Use a full address such as https://tenant.example.com/sites/TestSite.`);
  let url;
  try { url = new URL(raw); } catch { throw bad('is not an address'); }
  if (!raw.startsWith('https://')) throw bad('must start with https://');
  if (raw.endsWith('/')) throw bad('must not end with a slash');
  if (raw.includes('?') || raw.includes('#')) throw bad('must not have a query (?...) or a # part');
  if (url.username || url.password) throw bad('must not contain a user name or password');
  return { origin: url.origin, siteUrl: url.origin + (url.pathname === '/' ? '' : url.pathname) };
}

/**
 * What the environment asks to be built into the pages, in the shape of pms-config.txt; `{}` when it asks for nothing.
 * Throws a plain sentence for a value that cannot be used, so a build stops before it writes anything.
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ siteUrl?: string, listPrefix?: string, logoLibrary?: string, batch?: false, support?: { name?: string, contact?: string }, label?: string }}
 */
export function builtSettings(env = process.env) {
  const given = (name) => (env[name] ?? '').trim();
  const built = {};
  const site = readSiteUrl(given('PMS_SITE_URL'));
  if (site) built.siteUrl = site.siteUrl;
  if (given('PMS_LIST_PREFIX')) built.listPrefix = given('PMS_LIST_PREFIX') === NO_PREFIX ? '' : given('PMS_LIST_PREFIX');
  if (given('PMS_LOGO_LIBRARY')) built.logoLibrary = given('PMS_LOGO_LIBRARY');
  const batch = given('PMS_BATCH').toLowerCase();
  if (!['', 'true', 'false'].includes(batch)) throw new Error(`PMS_BATCH must be "false" or left out (got "${env.PMS_BATCH}").`);
  if (batch === 'false') built.batch = false;
  const support = { ...(given('PMS_SUPPORT_NAME') ? { name: given('PMS_SUPPORT_NAME') } : {}), ...(given('PMS_SUPPORT_CONTACT') ? { contact: given('PMS_SUPPORT_CONTACT') } : {}) };
  if (Object.keys(support).length) built.support = support;
  if (given('PMS_LABEL')) built.label = given('PMS_LABEL');

  // The same rules a page applies to its settings: a build cannot put in what the page would then refuse.
  const wrong = settingsProblem(built);
  if (wrong) {
    const named = wrong.replace(/"([A-Za-z.]+)"/g, (quoted, setting) => VARIABLE[setting] ?? quoted);
    const about = Object.values(VARIABLE).find((name) => named.startsWith(name));
    throw new Error(`${named}${about ? ` (got "${env[about]}")` : ''}.${about === 'PMS_LIST_PREFIX' ? ` For no prefix at all, on purpose, write PMS_LIST_PREFIX='${NO_PREFIX}'.` : ''}`);
  }
  return built;
}

/** The bundler constant that carries them: what to give Vite as `define`. */
export const builtDefine = (env = process.env) => ({ __PMS_BUILT__: JSON.stringify(builtSettings(env)) });
