// Setup's view of the site as it is (Phase 10c-3): the names it gives the lists and the library, and one read of every list and of each
// existing list's columns and settings. Moved out of provision.js unchanged (Prompt 44), which passes these names on. It only reads.

import { LISTS } from '../schema/pms-schema.js';

export const LIBRARY_KEY = 'logoLibrary';
/** The four lists that change with every visit and every answer: version history may be turned off on them (schema v2 change 8, opt-in). */
export const BUSY_LISTS = Object.freeze(['tracks', 'responses', 'qrtokens', 'uservisitlogs']);
/** The end of a list's description once Setup has made it and its settings: how a later run knows the list is Setup's and finished. */
export const MADE_BY = 'Made by Setup.';
/**
 * The end of a list's description from the moment Setup makes it until its settings are made: a run that stops part-way leaves it, and the
 * next run's plan finishes that list's settings (and only for lists like it: a list made by hand is never given settings).
 */
export const SETTINGS_PENDING = 'Made by Setup; its settings are not made yet.';
/** SharePoint's templates: a generic list, and a document library. */
export const TEMPLATE = Object.freeze({ list: 100, library: 101 });
/**
 * The options a column is created with (SP.AddFieldOptions): AddToDefaultContentType (1), AddFieldInternalNameHint (8: make the internal name
 * the Name asked for, not one made from the display name) and AddFieldToDefaultView (16, so a person looking at the list sees it).
 */
export const FIELD_OPTIONS = 1 | 8 | 16;

// ---- The site as it is: one read of its lists, one read of each existing list's columns -----------------------------------------------

/**
 * SharePoint's own Title column, which every list has from the moment it is made (required, as SharePoint makes it): the schema's activity title
 * is that column (pms-schema-meta.js), so it is never created, and the app writes a Title into every item it makes, so its being required is
 * harmless.
 */
export const BUILT_IN = 'Title';

/** OData quotes a quote by doubling it, and the title is then encoded as part of the address. */
export const literal = (text) => `'${encodeURIComponent(String(text).replace(/'/g, "''"))}'`;
/** The address of a list by its title, as the data layer spells it. */
export const listAddress = (title) => `/web/lists/getbytitle(${literal(title)})`;
/** What a plan reads of the site's lists: the title, the template, and what Setup may have set. */
const SITE_LISTS = '/web/lists?$select=Id,Title,BaseTemplate,Hidden,Description,EnableAttachments,EnableModeration,EnableVersioning';
export const results = (data) => data?.results ?? data?.value ?? [];
const nextOf = (data) => data?.__next ?? data?.['@odata.nextLink'] ?? data?.['odata.nextLink'] ?? null;
export const lower = (text) => String(text).toLowerCase();

/**
 * The calls Setup's plan and Create make of the data layer: a read (one GET of the site's REST API, the address after `/_api`, which throws
 * with `status` and SharePoint's words when refused), a write (dataService.sendToSharePoint: it carries the write token), and the pacing every
 * bulk write of the app uses (dataService.runPaced: a few at a time, a pause between one lane's writes on SharePoint). Built on dataService's own
 * calls, so nothing here calls fetch() itself.
 * @param {{ probeSharePointRead: Function, sendToSharePoint: Function, runPaced: Function }} dataService
 */
export function siteApi(dataService) {
  return {
    /** @param {string} resource */
    async read(resource) {
      const answer = await dataService.probeSharePointRead(null, resource);
      if (answer.ok) return answer.data;
      throw Object.assign(new Error(answer.message), { status: answer.status });
    },
    /** @param {'POST' | 'MERGE'} method @param {string} resource @param {object} body @param {Record<string, string>} [headers] */
    write: (method, resource, body, headers) => dataService.sendToSharePoint(method === 'MERGE' ? 'POST' : method, resource, body,
      method === 'MERGE' ? { 'X-HTTP-Method': 'MERGE', 'IF-MATCH': '*', ...headers } : headers),
    paced: (items, worker, options) => dataService.runPaced(items, worker, options),
  };
}

/** Every page of a read that SharePoint may page (`__next`). A next page's address is absolute; the data layer accepts it on the same site. */
async function readAll(read, resource) {
  const rows = [];
  for (let address = resource; address;) {
    const data = await read(address);
    rows.push(...results(data));
    address = nextOf(data);
  }
  return rows;
}

/**
 * The site as the plan needs it: every list and library on it, by title (case does not matter to SharePoint), and the columns of each of this
 * copy's lists that exists. Reads only: one read of the lists, one of each existing list's columns.
 * @param {(resource: string) => Promise<any>} read
 * @param {Record<string, string>} titles every list's title by key, and the library's (`logoLibrary`), under this copy's settings
 * @returns {Promise<{ lists: Map<string, any>, fields: Map<string, any[]>, reads: number }>}
 */
export async function readSite(read, titles) {
  let reads = 0;
  const counted = (resource) => { reads += 1; return read(resource); };
  const lists = new Map((await readAll(counted, SITE_LISTS)).map((list) => [lower(list.Title), list]));
  const fields = new Map();
  for (const key of Object.keys(LISTS)) {
    const found = lists.get(lower(titles[key]));
    if (!found || found.BaseTemplate !== TEMPLATE.list) continue;
    try {
      fields.set(key, await readAll(counted, `${listAddress(found.Title)}/fields`));
    } catch (cause) {
      throw Object.assign(new Error(`The columns of ${found.Title} could not be read: ${cause.message}`), { status: cause.status });
    }
  }
  return { lists, fields, reads };
}
