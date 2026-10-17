// Which SharePoint site and which lists this copy of the app uses (Phase 10b). Plain JS, no DOM, so `node --test` imports it.
//
// One pure function, resolveSettings(): from the page's own address, the settings file beside the page (pms-config.txt, parsed, or
// absent) and the values built into the page, to the settings, where each came from, and what is wrong. For each setting the first
// of these that has it wins: the file, then what is built in, then (for the site alone) the page's own address. There is nothing
// after that: a page that cannot tell which lists are its own gets a problem, never a guess. ARCHITECTURE-10.md 2.1 to 2.5 (in git history at 7347c72).
//
// Every page carries this file, so it only decides: each rule answers yes or no, and a problem is a code with WHERE the settings are
// wrong ({ id: 'PMS-CFG-002', kind: 'invalid', at: 'lists.qrtokens' }). The words are elsewhere, and only Setup and the build load
// them: lib/settings/deploy-problems.js turns a problem into its six parts, and lib/settings/deploy-rules.js says which rule was broken; a test holds
// the rules here and there to the same answer for every case. The twelve lists and their usual titles are the data layer's own
// (sharePointListTitles): there is no second copy of them here.
import { sharePointListTitles } from '../data/dataService.js';
import { isLocalAddress } from './address-check.js';

export const SETTINGS_FILE = 'pms-config.txt';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value, most) => typeof value === 'string' && value !== '' && value.length <= most;
/** A list's title: 1 to 100 characters, none of those SharePoint will not have in one, no space at either end. */
const isTitle = (value) => isText(value, 100) && !/["#%&*:<>?/\\{}|~]/.test(value) && value === value.trim();
function isSite(value) {
  try {
    const url = new URL(value);
    return typeof value === 'string' && value.startsWith('https://') && !/[?#]|\/$/.test(value) && !url.username && !url.password;
  } catch { return false; }
}
/** true when `value` is an object whose every entry `ok` accepts; else the key of the first it refuses, or false for no object at all. */
const eachPart = (value, ok) => isObject(value) && (Object.keys(value).find((key) => !ok(key, value[key])) ?? true);
const USUAL = sharePointListTitles({});

/** One rule for each setting: true when the value will do; false, or the name of the part that will not, otherwise. */
const RULES = {
  configVersion: (value) => value === 1,
  siteUrl: isSite,
  listPrefix: (value) => typeof value === 'string' && /^([A-Za-z][A-Za-z\d]{0,15})?$/.test(value),
  lists: (value) => eachPart(value, (key, title) => key !== 'logoLibrary' && Object.hasOwn(USUAL, key) && isTitle(title)),
  logoLibrary: isTitle,
  batch: (value) => typeof value === 'boolean',
  support: (value) => eachPart(value, (key, entry) => (key === 'name' ? isText(entry, 60)
    : key === 'contact' && (isText(entry, 80) || (isText(entry, 300) && /^([^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/\S+)$/.test(entry))))),
  label: (value) => isText(value, 40),
};

/**
 * Where a set of settings (the file's, or the built-in ones) is wrong: the first setting that is, or the part of it
 * ("lists.qrtokens"); '*' when it is not an object at all; '' when nothing is. A key that is not a setting is wrong: a typo such as
 * "listPrefx" must stop the page, not be passed over.
 * @param {unknown} values
 */
export function wrongSetting(values) {
  if (!isObject(values)) return '*';
  for (const [key, value] of Object.entries(values)) {
    const ok = Object.hasOwn(RULES, key) && RULES[key](value);
    if (ok !== true) return ok ? `${key}.${ok}` : key;
  }
  return '';
}

/**
 * The site a page is on, from its own address: the first two parts of the path when the first is `sites` or `teams`, the host otherwise.
 * @param {URL} page
 */
export function siteOf(page) {
  const parts = page.pathname.split('/').filter(Boolean);
  return page.origin + (/^(sites|teams)$/i.test(parts[0] ?? '') && parts.length > 2 ? `/${parts[0]}/${parts[1]}` : '');
}

/**
 * Is the page inside this site? Its address must begin with the site's, whatever the case of the letters (SharePoint does not tell
 * upper case from lower). Both are compared as a browser writes them, so a space and %20 are the same.
 */
const isInside = (page, siteUrl) => `${page.origin}${page.pathname}`.toLowerCase().startsWith(`${new URL(siteUrl).href.replace(/\/$/, '')}/`.toLowerCase());

/**
 * The title of every list, by key, and of the picture library (`logoLibrary`), under these settings: what the data layer will ask
 * the site for (it is the data layer's own function).
 * @param {{ listPrefix?: string, lists?: Record<string, string>, logoLibrary?: string }} settings
 * @returns {Record<string, string>}
 */
export const listTitles = (settings) => sharePointListTitles(settings);

/**
 * @param {{ pageUrl: string, file?: unknown, built?: Record<string, unknown>, fileError?: { kind: string, status?: number } | null }} input
 *   `pageUrl` is the page's own address. `file` is pms-config.txt as parsed JSON, and `undefined` when there is none (HTTP 404).
 *   `built` is what the build put into the page (the PMS_ values, in the file's own shape). `fileError` is a file that is there, or may
 *   be, and could not be read: that is never "no file".
 * @returns {{ settings: object | null, sources: Record<string, string>, problems: { id: string, kind?: string, status?: number, at?: string }[], known?: object }}
 *   `settings` is what dataService.configure({ sharePoint }) takes: null on the local server (http, or this computer: nothing else is
 *   worked out there) and null when there is a problem. `sources` says
 *   where each value came from: 'file', 'built in', 'derived' or 'default'. `problems` holds at most one, the first: PMS-CFG-001
 *   (nothing names the lists), PMS-CFG-002 (the file could not be read, `kind` saying how, or the file or the built-in values are
 *   not valid, `at` saying where; two lists that would end under one title are `at: 'lists'`) or PMS-CFG-004 (the page is not
 *   inside the site the settings name). `known` is every value that could be worked out, problem or not, for Setup to show.
 */
export function resolveSettings({ pageUrl, file, built = {}, fileError = null }) {
  const page = new URL(pageUrl);
  if (isLocalAddress(page)) return { settings: null, sources: {}, problems: [] };

  const badFile = fileError || file === undefined ? '' : wrongSetting(file);
  const badBuilt = wrongSetting(built);
  // A file or a build that is wrong is not read any further: nothing in it is trusted.
  const given = [[fileError || badFile || file === undefined ? {} : file, 'file'], [badBuilt ? {} : built, 'built in']];
  const values = { siteUrl: siteOf(page), batch: true };
  const sources = { siteUrl: 'derived', batch: 'default' };
  // (Every setting but the first, configVersion, which only says what shape the file is.)
  for (const key of Object.keys(RULES).slice(1)) {
    const [from, source] = given.find(([settings]) => settings[key] !== undefined) ?? [];
    if (from) { values[key] = from[key]; sources[key] = source; }
  }
  if (values.listPrefix !== undefined && values.logoLibrary === undefined) {
    values.logoLibrary = sharePointListTitles(values).logoLibrary;
    sources.logoLibrary = 'default';
  }
  // Two of the fourteen under one title (SharePoint does not tell upper case from lower) would be one list read as two.
  const titles = Object.values(sharePointListTitles(values)).map((title) => title.toLowerCase());
  const wrong = (id, more) => ({ id: `PMS-CFG-00${id}`, ...more });
  const trouble = fileError ? wrong(2, fileError)
    : badFile ? wrong(2, { kind: 'invalid', at: badFile })
    : badBuilt ? wrong(2, { kind: 'built', at: badBuilt })
    : !isInside(page, values.siteUrl) ? wrong(4)
    : values.listPrefix === undefined ? wrong(1)
    : new Set(titles).size < titles.length ? wrong(2, { kind: 'invalid', at: 'lists' })
    : null;
  return { settings: trouble ? null : { configVersion: 1, ...values }, sources, problems: trouble ? [trouble] : [], known: values };
}
