// The rules of the settings, in words (Phase 10b). Plain JS, no DOM, so `node --test` imports it.
//
// lib/settings/deploy-settings.js decides whether a set of settings will do, and where it will not; every page carries that. This file says
// WHAT is wrong there, as the end of a sentence a person can act on ("listPrefix" must be empty, or a letter followed by up to 15
// letters or digits). Only Setup, the build (scripts/site-override.js checks the PMS_ values with it) and the tests load it: the
// participant and admin pages send the person to Setup instead of carrying these sentences. Both files are run over the same
// cases by scripts/test-deploy-settings.js, which fails if one accepts what the other refuses, or names another place.
import { sharePointListTitles } from '../data/dataService.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value, most) => typeof value === 'string' && value.length >= 1 && value.length <= most;
const said = (name, why) => (why ? `"${name}" ${why}` : '');
const REFUSED = /["#%&*:<>?/\\{}|~]/; // what SharePoint will not have in a title
const USUAL = sharePointListTitles({});
const LIST_KEYS = Object.keys(USUAL).filter((key) => key !== 'logoLibrary');

/** Why `value` cannot be the title of a list; '' when it can. */
function titleProblem(value) {
  if (!isText(value, 100)) return 'must be 1 to 100 characters';
  if (REFUSED.test(value)) return `must not contain ${REFUSED.exec(value)[0]}`;
  return value === value.trim() ? '' : 'must not start or end with a space';
}

/** Why `value` cannot be a site address, in the words the build has always used; '' when it can. */
export function siteUrlProblem(value) {
  let url;
  try { url = new URL(typeof value === 'string' ? value : ''); } catch { return 'is not an address'; }
  if (!value.startsWith('https://')) return 'must start with https://';
  if (value.endsWith('/')) return 'must not end with a slash';
  if (/[?#]/.test(value)) return 'must not have a query (?...) or a # part';
  return url.username || url.password ? 'must not contain a user name or password' : '';
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One rule for each setting: '' when the value is acceptable, else what is wrong, naming the setting. */
const RULES = {
  configVersion: (value, name) => said(name, value === 1 ? '' : 'must be 1'),
  siteUrl: (value, name) => said(name, siteUrlProblem(value)),
  listPrefix: (value, name) => said(name, typeof value === 'string' && /^([A-Za-z][A-Za-z0-9]{0,15})?$/.test(value) ? '' : 'must be empty, or a letter followed by up to 15 letters or digits'),
  lists(value, name) {
    if (!isObject(value)) return said(name, 'must be an object such as { "qrtokens": "GuestCodes" }');
    for (const [key, title] of Object.entries(value)) {
      const why = LIST_KEYS.includes(key) ? titleProblem(title) : `is not one of this app's lists (${LIST_KEYS.join(', ')})`;
      if (why) return said(`${name}.${key}`, why);
    }
    return '';
  },
  logoLibrary: (value, name) => said(name, titleProblem(value)),
  batch: (value, name) => said(name, typeof value === 'boolean' ? '' : 'must be true or false'),
  support(value, name) {
    if (!isObject(value)) return said(name, 'must be an object with a name and a contact');
    for (const [key, entry] of Object.entries(value)) {
      const why = key === 'name' ? (isText(entry, 60) ? '' : 'must be 1 to 60 characters')
        : key !== 'contact' ? 'is not a setting this app knows'
          : isText(entry, 80) || (isText(entry, 300) && (EMAIL.test(entry) || /^https:\/\/\S+$/.test(entry))) ? '' : 'must be an email address, an https link, or up to 80 characters of text';
      if (why) return said(`${name}.${key}`, why);
    }
    return '';
  },
  label: (value, name) => said(name, isText(value, 40) ? '' : 'must be 1 to 40 characters'),
};

/** Two of the fourteen titles that would be one list (SharePoint does not tell upper case from lower), as the end of a sentence; '' when none. */
function sameTitle(settings) {
  const seen = new Map();
  const named = (key) => (key === 'logoLibrary' ? `"${key}"` : key in (settings.lists ?? {}) ? `"lists.${key}"` : `the ${USUAL[key]} list`);
  for (const [key, title] of Object.entries(sharePointListTitles(settings))) {
    const other = seen.get(title.toLowerCase());
    // The one a person wrote is named first: it is the one to change.
    if (other) return `${[key, other].map(named).sort((a, b) => (a < b ? -1 : 1)).join(' and ')} would both be "${title}"`;
    seen.set(title.toLowerCase(), key);
  }
  return '';
}

/**
 * The first thing wrong with a set of settings (the file's, or the built-in ones), as the end of a sentence; '' when nothing is.
 * `under` is what the set is laid over (the built-in values, for the file): two lists that end under one title are found in the
 * two together.
 * @param {unknown} values
 * @param {Record<string, unknown>} [under]
 */
export function settingsProblem(values, under = {}) {
  if (!isObject(values)) return 'it must be one JSON object, { ... }';
  for (const [key, value] of Object.entries(values)) {
    const why = Object.hasOwn(RULES, key) ? RULES[key](value, key) : said(key, 'is not a setting this app knows');
    if (why) return why;
  }
  return sameTitle({ ...under, ...values });
}

/**
 * A page's problem as Setup words it: when it is the settings that are not valid, with the rule spelled out, where every other page
 * only names the place. A file that could not be READ, and every other problem, keeps its words, but for what to do next: Setup is
 * reloaded, not "tried again", and it is itself the page the other two send people to.
 * @param {{ id: string, title: string, what: string, next: string, who: string, technical: string }} trouble
 * @param {{ file?: unknown, fileError?: object | null, built?: Record<string, unknown> }} read what the page started from
 */
export function spelledOut(trouble, { file, fileError = null, built = {} } = {}) {
  // Setup has no Try again (it is reloaded), and it is where the other pages send the person: its words say so.
  const here = { ...trouble, next: trouble.id === 'PMS-CFG-001' ? 'Use one of the two ways below to name them, then reload this page.' : trouble.next.replace(/, then press Try again\.$/, ', then reload this page.') };
  if (trouble.id !== 'PMS-CFG-002' || fileError) return here;
  const inBuilt = settingsProblem(built);
  const inFile = file === undefined ? '' : settingsProblem(file, inBuilt ? {} : built);
  if (inFile) return { ...here, what: `This page could not use its settings file, pms-config.txt: ${inFile}.`, next: "Correct pms-config.txt in this page's folder, then reload this page." };
  if (!inBuilt) return here;
  return { ...here, title: 'The settings built into this page cannot be used', what: `The settings built into this page are not valid: ${inBuilt}.`, next: 'Build the pages again with corrected PMS_ values, then upload them.' };
}
