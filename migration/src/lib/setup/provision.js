// Preparing a site for the app (Phase 10c-3): the plan of what is missing, worked out from the site as it is. Plain JS with JSDoc and no
// DOM, and ONLY the Setup page imports it: what it needs to know of every column is migration/src/lib/schema/pms-schema-meta.js, which the participant and
// admin pages must not carry (`npm run test:bundle` holds that). Nothing here calls fetch(): the data layer does, through the two calls
// `siteApi()` takes from it.
//
// The plan (`readSite` then `makePlan`, or `showPlan`) reads and never writes, and gives the same answer every time for the same site. It is
// worked out from ONE read of the site's lists and ONE read of each existing list's columns (the schema's lists only, by their titles under
// this copy's settings: a list of another copy on the same site is never read, let alone changed). It names:
//   1. the lists, and the picture library, to create;
//   2. the columns to create, each with its type, its index, its uniqueness, a Yes/No default of No, a date shown as Date & Time, and a
//      several-lines column as plain text with no history of changes;
//   3. the settings to add: an index or uniqueness on an existing column, and on a list Setup makes, attachments off and content approval
//      off (and version history off on the four busiest lists, when the deployer ticks that, because their organisation allows it);
//   4. what it found and will NOT touch, each with its fix in plain words: a column of the wrong type, a several-lines column in rich text,
//      a date that shows the date only, a column whose internal name is not the one the app looks for, a required column the app does not
//      fill in, an index on a column nothing filters (harmless, and said so), and a column an earlier version used and this one does not
//      (Phase 10i: the DisplayName columns of version 2; harmless, and said so).
// SharePoint keeps a column's internal name and type as they were made, and Setup never deletes, renames or changes the type of anything
// (ARCHITECTURE-10.md 6.2, in git history at 7347c72): what is wrong is the deployer's to fix by hand, and the plan says how.
import { ID, LISTS, VERSION, selectOf } from '../schema/pms-schema.js';
import { LIBRARY_META, META, columnsOf, retiredColumn } from '../schema/pms-schema-meta.js';
import { typeLabel } from './setup-checks.js';

/** The key the picture library has among the titles (dataService.sharePointListTitles). */
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
const literal = (text) => `'${encodeURIComponent(String(text).replace(/'/g, "''"))}'`;
/** The address of a list by its title, as the data layer spells it. */
export const listAddress = (title) => `/web/lists/getbytitle(${literal(title)})`;
/** What a plan reads of the site's lists: the title, the template, and what Setup may have set. */
export const SITE_LISTS = '/web/lists?$select=Id,Title,BaseTemplate,Hidden,Description,EnableAttachments,EnableModeration,EnableVersioning';
const results = (data) => data?.results ?? data?.value ?? [];
const nextOf = (data) => data?.__next ?? data?.['@odata.nextLink'] ?? data?.['odata.nextLink'] ?? null;
const lower = (text) => String(text).toLowerCase();

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

// ---- The plan --------------------------------------------------------------------------------------------------------------------

const xml = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A column's definition, as SharePoint's createfieldasxml takes it: the internal name asked for three times (Name, StaticName and the display
 * name: the app reads a column by its internal name, and a person sees the same word), required for AppId alone, single-line text up to
 * SharePoint's 255 characters (the app keeps its own lower limits), plain text with no history for several lines, Date & Time for a date, and
 * a Yes/No that starts as No. No index and no uniqueness: those are later steps, the index first (ARCHITECTURE-10.md 6.3, in git history at 7347c72).
 * @param {ReturnType<typeof columnsOf>[number]} column
 */
export function definition(column) {
  const name = xml(column.name);
  const common = `Name="${name}" StaticName="${name}" DisplayName="${name}" Required="${column.required ? 'TRUE' : 'FALSE'}"`;
  switch (column.type) {
    case 'Text': return `<Field Type="Text" ${common} MaxLength="255" />`;
    case 'Note': return `<Field Type="Note" ${common} RichText="FALSE" AppendOnly="FALSE" NumLines="6" />`;
    case 'Number': return `<Field Type="Number" ${common} />`;
    case 'DateTime': return `<Field Type="DateTime" ${common} Format="DateTime" />`;
    case 'Boolean': return `<Field Type="Boolean" ${common}><Default>${column.default === 'Yes' ? 1 : 0}</Default></Field>`;
    default: throw new Error(`No definition for a column of type ${column.type}.`);
  }
}

/** The settings a list Setup makes is given: attachments off, content approval off, and version history off when asked for (a busy list only). */
export function listSettings(key, { versioning = false } = {}) {
  return { EnableAttachments: false, EnableModeration: false, ...(versioning && BUSY_LISTS.includes(key) ? { EnableVersioning: false } : {}) };
}

/** A list's description: what it is for, then that Setup made it (and, until its settings are made, that they are still to come). */
export const descriptionOf = (key, pending = true) => `${key === LIBRARY_KEY ? LIBRARY_META.purpose : META[key].purpose} ${pending && key !== LIBRARY_KEY ? SETTINGS_PENDING : MADE_BY}`;

const SETTING_WORDS = { EnableAttachments: 'attachments off', EnableModeration: 'content approval off', EnableVersioning: 'version history off' };
const count = (number, one, many = `${one}s`) => `${number} ${number === 1 ? one : many}`;
/** A name as a person compares two: no case, no spaces or other signs, and SharePoint's `_x0020_` read as the space it stands for. */
const plain = (name) => lower(String(name ?? '').replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))).replace(/[^a-z0-9]/g, '');

/**
 * A column on the list that looks meant to be `wanted` but is not: called the same, spelled with a space (`Session_x0020_Id`), or the same
 * name with a digit after it (`SortOrder0`, a taken name). Columns SharePoint makes itself, hidden ones and the schema's own are never it.
 */
function lookAlike(fields, wanted, ours) {
  const target = plain(wanted);
  return fields.find((field) => !ours.has(field.InternalName) && field.InternalName !== 'Title' && !field.Hidden && !field.FromBaseType && !field.ReadOnlyField
    && (plain(field.InternalName) === target || plain(field.Title) === target || new RegExp(`^${wanted}\\d+$`).test(field.InternalName)));
}

/**
 * What would make `titles`' lists match the schema, from the site as `readSite` found it. Pure: the same site gives the same plan.
 * @param {{ lists: Map<string, any>, fields: Map<string, any[]> }} site
 * @param {Record<string, string>} titles
 * @param {{ versioning?: boolean }} [options] `versioning`: turn version history off on the four busy lists Setup makes
 */
export function makePlan(site, titles, { versioning = false } = {}) {
  /** @type {{ lists: any[], columns: any[], settings: any[], untouched: any[], groups: any[], versioning: boolean, summary: string, toFix: number, empty: boolean }} */
  const plan = { lists: [], columns: [], settings: [], untouched: [], groups: [], versioning, summary: '', toFix: 0, empty: true };
  const group = (key, title, state) => {
    const entry = { key, title, state, purpose: key === LIBRARY_KEY ? LIBRARY_META.purpose : META[key].purpose, lists: [], columns: [], settings: [], untouched: [] };
    plan.groups.push(entry);
    return entry;
  };
  const add = (entry, kind, item) => { entry[kind].push(item); plan[kind].push(item); };
  const keep = (entry, column, found, fix, harmless = false) => add(entry, 'untouched', { key: entry.key, list: entry.title, column, found, fix, harmless });
  const createColumn = (entry, column) => add(entry, 'columns', {
    key: entry.key, list: entry.title, name: column.name, type: column.type, label: typeLabel(column), xml: definition(column),
    words: `${column.name}: ${typeLabel({ ...column, indexed: false, unique: false })}`,
  });
  const indexOn = (entry, column) => add(entry, 'settings', { kind: 'index', key: entry.key, list: entry.title, column: column.name, changes: { Indexed: true }, words: `Index ${column.name}.` });
  const uniqueOn = (entry, column) => add(entry, 'settings', { kind: 'unique', key: entry.key, list: entry.title, column: column.name, changes: { EnforceUniqueValues: true }, words: `Enforce unique values on ${column.name} (after its index).` });
  const settingsOf = (entry) => {
    const changes = listSettings(entry.key, { versioning });
    add(entry, 'settings', { kind: 'list', key: entry.key, list: entry.title, changes, words: `Turn ${Object.keys(changes).map((name) => SETTING_WORDS[name]).join(', ')}.` });
  };

  for (const key of Object.keys(LISTS)) {
    const title = titles[key];
    const columns = columnsOf(key);
    const found = site.lists.get(lower(title));
    if (!found) {
      const entry = group(key, title, 'new');
      add(entry, 'lists', { key, title, template: TEMPLATE.list, description: descriptionOf(key), words: `Create the list ${title}.` });
      for (const column of columns) if (column.name !== BUILT_IN) createColumn(entry, column);
      for (const column of columns) if (column.indexed) indexOn(entry, column);
      for (const column of columns) if (column.unique) uniqueOn(entry, column);
      settingsOf(entry);
      continue;
    }
    const entry = group(key, found.Title, 'exists');
    if (found.BaseTemplate !== TEMPLATE.list) {
      keep(entry, null, `${found.Title} is a ${found.BaseTemplate === TEMPLATE.library ? 'document library' : `site item of template ${found.BaseTemplate}`}, not a list.`,
        `Give it another title or delete it (if it holds nothing you need), then press Show the plan again: Create will then make the list ${title}.`);
      continue;
    }
    const fields = site.fields.get(key) ?? [];
    const byName = new Map(fields.map((field) => [field.InternalName, field]));
    const ours = new Set(columns.map((column) => column.name));
    const indexes = [];
    const uniques = [];
    for (const column of columns) {
      const field = byName.get(column.name);
      const wanted = typeLabel({ ...column, indexed: false, unique: false, required: false });
      if (!field && column.name === BUILT_IN) continue; // (SharePoint's own: every real list has it)
      if (!field) {
        const alike = lookAlike(fields, column.name, ours);
        if (alike) {
          keep(entry, column.name, `A column called "${alike.Title ?? alike.InternalName}" has the internal name ${alike.InternalName}; the app looks for ${column.name}.`,
            `A column's internal name is fixed when it is made. Delete "${alike.Title ?? alike.InternalName}" (on a new list it holds nothing), then press Show the plan again: Create will make ${column.name} (${wanted}).`);
          continue;
        }
        createColumn(entry, column);
        if (column.indexed) indexes.push(column);
        if (column.unique) uniques.push(column);
        continue;
      }
      const accepts = column.type === 'Number' ? ['Number', 'Integer'] : [column.type];
      if (!accepts.includes(field.TypeAsString)) {
        keep(entry, column.name, `${column.name} is of type ${field.TypeAsString}; the app needs ${wanted}.`,
          `A column's type is not changed here. In the list's settings, change ${column.name} to ${wanted}, or delete it (on a new list it holds nothing) and press Show the plan again: Create will make it.`);
        continue;
      }
      if (column.type === 'Note' && (field.RichText || field.AppendOnly)) {
        keep(entry, column.name, `${column.name} is ${field.RichText ? 'rich text' : ''}${field.RichText && field.AppendOnly ? ' and ' : ''}${field.AppendOnly ? 'set to append changes' : ''}; the app keeps plain text in it.`,
          `In the list's settings, edit ${column.name}: choose Plain text, and set "Append Changes to Existing Text" to No.`);
      }
      if (column.format === 'Date & Time' && field.DisplayFormat === 0) {
        keep(entry, column.name, `${column.name} shows the date only, which can bring a date back as the day before.`, `In the list's settings, edit ${column.name}: set "Date and Time Format" to Date & Time.`);
      }
      if (column.required && !field.Required) {
        keep(entry, column.name, `${column.name} is not required; every item must have one.`, `In the list's settings, edit ${column.name}: set "Require that this column contains information" to Yes.`);
      }
      if (!column.required && field.Required && column.name !== BUILT_IN) {
        keep(entry, column.name, `${column.name} is required, and the app leaves it empty in some items.`, `In the list's settings, edit ${column.name}: set "Require that this column contains information" to No.`);
      }
      if (column.indexed && !field.Indexed) indexes.push(column);
      if (!column.indexed && field.Indexed) {
        keep(entry, column.name, `${column.name} is indexed, though the app never filters on it.`, 'Harmless: leave it as it is, or remove the index if you like.', true);
      }
      if (column.unique && !field.EnforceUniqueValues) uniques.push(column);
    }
    for (const field of fields) {
      // (A column of an earlier version that this one no longer uses: never deleted here, and harmless. Phase 10i.)
      const old = retiredColumn(key, field.InternalName);
      if (old && !ours.has(field.InternalName)) {
        keep(entry, field.InternalName, `${field.InternalName} is no longer used since version ${old.lastIn + 1}: ${old.now} holds ${old.holds} now. (SharePoint gives every list item a property called ${old.name}, and would not return a column of that name when a read named it.)`,
          'Harmless: nothing reads or writes it. Leave it as it is, or a site owner may delete it by hand.', true);
      }
      if (field.Required && !field.ReadOnlyField && !field.FromBaseType && field.InternalName !== 'Title' && !ours.has(field.InternalName)) {
        keep(entry, field.InternalName, `${field.InternalName} is a required column the app does not know, so it never fills it in: every save would be refused.`,
          `In the list's settings, edit ${field.Title ?? field.InternalName}: set "Require that this column contains information" to No, or delete the column.`);
      }
    }
    for (const column of indexes) indexOn(entry, column);
    for (const column of uniques) uniqueOn(entry, column);
    // A list Setup made whose settings a stopped run never made: this run makes them. A list made by hand is never given settings.
    if (String(found.Description ?? '').endsWith(SETTINGS_PENDING)) settingsOf(entry);
  }

  const library = titles[LIBRARY_KEY];
  const shelf = site.lists.get(lower(library));
  if (!shelf) {
    const entry = group(LIBRARY_KEY, library, 'new');
    add(entry, 'lists', { key: LIBRARY_KEY, title: library, template: TEMPLATE.library, description: descriptionOf(LIBRARY_KEY), words: `Create the picture library ${library}.` });
  } else if (shelf.BaseTemplate !== TEMPLATE.library) {
    const entry = group(LIBRARY_KEY, shelf.Title, 'exists');
    keep(entry, null, `${shelf.Title} is a list, not a document library.`, `Give it another title or delete it (if it holds nothing you need), then press Show the plan again: Create will then make the picture library ${library}.`);
  } else {
    group(LIBRARY_KEY, shelf.Title, 'exists');
  }

  const toFix = plan.untouched.filter((item) => !item.harmless).length;
  const total = plan.lists.length + plan.columns.length + plan.settings.length;
  plan.summary = total === 0 ? 'Nothing to create'
    : `${count(plan.lists.length, 'list')}, ${count(plan.columns.length, 'column')}, ${count(plan.settings.length, 'setting')} to create`;
  plan.toFix = toFix;
  plan.empty = total === 0;
  return plan;
}

// ---- Create: it only ever adds -----------------------------------------------------------------------------------------------------

/** What Create may change of a column that exists: the index or the uniqueness the plan named, and nothing else (never its type, never its name). */
export const FIELD_CHANGES = Object.freeze(['Indexed', 'EnforceUniqueValues']);
/** What Create may change of a list Setup made: its attachments, content approval, version history and description (never its title). */
export const LIST_CHANGES = Object.freeze(['EnableAttachments', 'EnableModeration', 'EnableVersioning', 'Description']);
/** What a person reads when SharePoint refuses a write for lack of permission (a 403), wherever it was. */
export const NOT_ALLOWED = 'Your account cannot create lists on this site. A site owner must press Create, or create the lists by hand from SHAREPOINT-LISTS.md.';
const AGAIN = 'Press Show the plan, then Create, to carry on from there.';

const only = (changes, allowed) => Object.fromEntries(Object.entries(changes).filter(([name]) => allowed.includes(name)));
const joined = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);
const elapsed = (ms) => `${(ms / 1000).toFixed(1)} s`;
const fieldAddress = (title, name) => `${listAddress(title)}/fields/getbyinternalnameortitle(${literal(name)})`;

/** Why Create stopped: the words a person reads, and one line for whoever can fix it. */
class Stop extends Error {
  constructor(words, technical) {
    super(words);
    this.words = words;
    this.technical = technical;
  }
}

/**
 * What SharePoint made of a column, against what was asked: null when it is what was asked, else the words for the difference. Only what the
 * app depends on and Setup cannot put right without changing a column: the internal name, the type, plain text for several lines, Date & Time.
 */
function madeOtherwise(item, field) {
  if (field.InternalName !== item.name) return { what: `with the internal name ${field.InternalName}, not ${item.name}`, fix: `A column of that name is already taken on that list (perhaps by one nobody sees): delete ${field.InternalName} (it holds nothing), then make ${item.name} by hand as SHAREPOINT-LISTS.md says, and press Show the plan again.`, rename: true };
  const accepts = item.type === 'Number' ? ['Number', 'Integer'] : [item.type];
  if (!accepts.includes(field.TypeAsString)) return { what: `of type ${field.TypeAsString}, not ${item.type}`, fix: `Delete ${item.name} (it holds nothing) and make it by hand as SHAREPOINT-LISTS.md says, then press Show the plan again.` };
  if (item.type === 'Note' && (field.RichText || field.AppendOnly)) return { what: field.RichText ? 'as rich text, not plain text' : 'to append changes to existing text', fix: `Edit ${item.name} in the list's settings: choose Plain text, and set "Append Changes to Existing Text" to No; then press Show the plan again.` };
  if (item.type === 'DateTime' && field.DisplayFormat === 0) return { what: 'to show the date only, not Date & Time', fix: `Edit ${item.name} in the list's settings: set "Date and Time Format" to Date & Time; then press Show the plan again.` };
  return null;
}

/**
 * Carries out `plan` (makePlan's) on the site, and nothing else: the lists (and the library) first, then their columns, then indexes and
 * uniqueness (the index before the uniqueness, each its own write), then the settings of the lists Setup makes. A few lists at a time, each
 * list's own writes one after another, paced as every bulk write of the app is (dataService.runPaced). Each column is read back as soon as it is
 * made; if SharePoint made something else, Create stops at once and says which column and what SharePoint made, and guesses nothing. A 403
 * stops it at once too, in words a person can act on. Whatever stops it, it says what was made before it stopped, and running Show the plan and
 * Create again carries on from there. It never deletes, renames or changes the type of anything.
 * @param {ReturnType<typeof siteApi>} api
 * @param {ReturnType<typeof makePlan>} plan
 * @param {{ onProgress?: (line: string) => void, concurrency?: number, gapMs?: number | null, now?: () => number }} [options] `gapMs`: the pause
 *   between one lane's writes (null: the data layer's own, 120 ms on SharePoint; a test may make it 0)
 */
export async function create(api, plan, { onProgress = () => {}, concurrency = 3, gapMs = null, now = () => Date.now() } = {}) {
  const started = now();
  const done = { lists: [], columns: [], settings: [] };
  const made = [];
  let writes = 0;
  let stop = null;
  const controller = new AbortController();
  const halt = (error) => {
    stop ??= error;
    controller.abort();
    throw stop;
  };
  // The first write goes alone and the others wait for its answer: an account that may not create lists is refused once, not three times.
  let first = null;
  /** One write, named for the person reading why Create stopped. Nothing is sent once something has stopped Create. */
  const send = async (method, resource, body, what) => {
    if (first) await first.catch(() => {});
    if (stop) throw stop;
    writes += 1;
    const sent = api.write(method, resource, body);
    first ??= sent;
    try {
      return await sent;
    } catch (cause) {
      // (SharePoint's own words, without the data layer's "SharePoint (403):" in front of them.)
      const said = String(cause.message).replace(/^SharePoint \(\d+\):\s*/, '');
      const technical = `${cause.status ?? 'no answer'} at: ${what}. ${said}`;
      return halt(cause.status === 403 ? new Stop(NOT_ALLOWED, technical) : new Stop(`Create stopped at: ${what}. SharePoint said: ${said}`, technical));
    }
  };
  const inTurn = async (items, worker, lanes) => {
    const { results } = await api.paced(items, worker, { concurrency: lanes, gapMs, stopAfterFailures: 1, signal: controller.signal });
    const failed = results.find((result) => result && !result.ok);
    if (failed) halt(failed.error);
  };
  const byList = (items) => [...new Set(items.map((item) => item.list))].map((list) => items.filter((item) => item.list === list));

  try {
    // 1. The lists, and the picture library.
    await inTurn(plan.lists, async (item) => {
      onProgress(`Creating the ${item.template === TEMPLATE.library ? 'picture library' : 'list'} ${item.title}...`);
      const list = await send('POST', '/web/lists', { __metadata: { type: 'SP.List' }, BaseTemplate: item.template, Title: item.title, Description: item.description },
        `create the ${item.template === TEMPLATE.library ? 'picture library' : 'list'} ${item.title}`);
      if (list?.Title && list.Title !== item.title) halt(new Stop(`Create stopped: SharePoint made the list ${item.title} under the title ${list.Title}. Setup does not guess or rename. Give it the title ${item.title} in its settings, then press Show the plan again.`, `asked ${item.title}, made ${list.Title}`));
      done.lists.push(item);
      made.push({ list: item.title, what: 'list' });
    }, concurrency);

    // 2. The columns: a few lists at a time, each list's columns one after another, each read back as soon as it is made.
    await inTurn(byList(plan.columns), async (columns) => {
      await inTurn(columns, async (item, index) => {
        onProgress(`Creating ${item.list}: ${index + 1} of ${columns.length} columns...`);
        const field = await send('POST', `${listAddress(item.list)}/fields/createfieldasxml`,
          { parameters: { __metadata: { type: 'SP.XmlSchemaFieldCreationInformation' }, SchemaXml: item.xml, Options: FIELD_OPTIONS } }, `create the column ${item.name} of ${item.list}`);
        const back = await api.read(field?.Id ? `${listAddress(item.list)}/fields/getbyid('${encodeURIComponent(field.Id)}')` : fieldAddress(item.list, item.name)).catch((cause) => {
          throw new Stop(`Create stopped: the column ${item.name} of ${item.list} could not be read back: ${cause.message}`, `${cause.status ?? 'no answer'} reading back ${item.list}.${item.name}`);
        });
        made.push({ list: item.list, what: back.InternalName ?? item.name });
        const other = madeOtherwise(item, back);
        if (other) halt(new Stop(`Create stopped: SharePoint made the column ${item.name} of ${item.list} ${other.what}. Setup does not guess or ${other.rename ? 'rename' : 'change it'}. ${other.fix}`, `asked ${item.xml}; made ${back.InternalName} ${back.TypeAsString}${back.RichText ? ' rich text' : ''}${back.AppendOnly ? ' append-only' : ''}${back.DisplayFormat === 0 ? ' date only' : ''}`));
        done.columns.push(item);
      }, 1);
    }, concurrency);

    // 3. Indexes and uniqueness: on each list in the plan's order, which puts a column's index before its uniqueness.
    const columnSettings = plan.settings.filter((item) => item.kind !== 'list');
    await inTurn(byList(columnSettings), async (settings) => {
      await inTurn(settings, async (item, index) => {
        onProgress(`Setting up ${item.list}: ${index + 1} of ${settings.length} indexes and unique values...`);
        await send('MERGE', fieldAddress(item.list, item.column), { __metadata: { type: 'SP.Field' }, ...only(item.changes, FIELD_CHANGES) },
          `${item.kind === 'index' ? 'index' : 'enforce unique values on'} ${item.column} of ${item.list}`);
        done.settings.push(item);
        made.push({ list: item.list, what: `${item.kind === 'index' ? 'the index' : 'unique values'} on ${item.column}` });
      }, 1);
    }, concurrency);

    // 4. The settings of the lists Setup makes; the description then says the list is finished.
    await inTurn(plan.settings.filter((item) => item.kind === 'list'), async (item) => {
      onProgress(`Setting up ${item.list}: ${item.words.replace(/^Turn /, 'turning ').replace(/\.$/, '')}...`);
      await send('MERGE', listAddress(item.list), { __metadata: { type: 'SP.List' }, ...only({ ...item.changes, Description: descriptionOf(item.key, false) }, LIST_CHANGES) },
        `change the settings of ${item.list}`);
      done.settings.push(item);
      made.push({ list: item.list, what: 'settings' });
    }, concurrency);
  } catch (error) {
    stop ??= error instanceof Stop ? error : new Stop(`Create stopped: ${error.message}`, String(error.message));
  }

  const ms = now() - started;
  const leftToFix = plan.toFix ? ` ${count(plan.toFix, 'thing')} Setup will not touch still ${plan.toFix === 1 ? 'needs' : 'need'} fixing by hand.` : '';
  const summary = stop ? stop.words
    : writes === 0 ? `Nothing to create: nothing was written.${leftToFix}`
      : `Created ${count(done.lists.length, 'list')}, ${count(done.columns.length, 'column')} and ${count(done.settings.length, 'setting')} in ${elapsed(ms)} (${count(writes, 'write')}).${leftToFix}`;
  onProgress(summary);
  return { ok: !stop, done, writes, ms, summary, failure: stop ? { words: stop.words, technical: stop.technical, created: madeBefore(made) } : null };
}

/** What was made before Create stopped, in words: the lists, then the columns of each list, then the rest. */
function madeBefore(made) {
  if (!made.length) return 'Nothing was made before it stopped.';
  const lists = made.filter((item) => item.what === 'list').map((item) => item.list);
  const columns = [...new Set(made.filter((item) => item.what !== 'list' && item.what !== 'settings' && !item.what.includes(' on ')).map((item) => item.list))]
    .map((list) => `${joined(made.filter((item) => item.list === list && item.what !== 'list' && item.what !== 'settings' && !item.what.includes(' on ')).map((item) => item.what))} of ${list}`);
  const settings = made.filter((item) => item.what === 'settings' || item.what.includes(' on ')).map((item) => (item.what === 'settings' ? `the settings of ${item.list}` : `${item.what} of ${item.list}`));
  const parts = [lists.length ? `the ${lists.length === 1 ? 'list' : 'lists'} ${joined(lists)}` : '', ...columns, ...settings].filter(Boolean);
  return `Made before it stopped: ${parts.join('; ')}. ${AGAIN}`;
}

// ---- Ready: the version of the lists, written last ----------------------------------------------------------------------------------

/** The one item of PMSAppSettings, and the column that says the version of the lists (pms-schema.js). */
const SETTINGS_ITEM = 'default';
const VERSION_COLUMN = LISTS.appsettings.fields.schemaVersion.column;

/**
 * Marks the site as ready for this build, and only when nothing is wrong: Setup's strict check (`check`: Check Lists, from pms-schema-meta.js) must
 * find no problem in any list, and the picture library must be there. Then, and only then, it writes the version of the lists (pms-schema.js
 * VERSION) on the PMSAppSettings item `default`: a new item with Title `default` and SchemaVersion, the other columns left empty, or SchemaVersion
 * alone on an item that has none. It is the last thing Setup writes, so a half-built or wrong site never claims to be ready; every page of the app
 * stops (PMS-LST-010) until it is written. A second press writes nothing.
 *
 * An earlier version (Phase 10i): when the check of THIS version is clean (so Create has added what it needs), a lower version (1 or 2) is raised
 * to this one, SchemaVersion alone, on the item as it was read (If-Match), and the words say so: "Raised the lists from version 2 to version 3."
 * A higher version is never lowered, and a value that is no version Setup knows is left as it is.
 * @param {ReturnType<typeof siteApi>} api
 * @param {Record<string, string>} titles
 * @param {{ check: () => Promise<{ list: string, ready: boolean, problems: { column: string | null, type: string | null, problem: string }[] }[]> }} options
 * @returns {Promise<{ ready: boolean, wrote: 'created' | 'version' | 'raised' | null, from?: number, words: string, problems: { list: string, column: string | null, type: string | null, problem: string }[], report: any[] }>}
 */
export async function markReady(api, titles, { check }) {
  const report = [...await check()];
  // (Check Lists reads the twelve lists; the picture library must be there too.)
  const library = titles[LIBRARY_KEY];
  const shelf = await api.read(`${listAddress(library)}?$select=Id,BaseTemplate`).catch((cause) => {
    if (cause.status === 404) return null;
    throw cause;
  });
  const shelfProblem = !shelf ? `The picture library "${library}" does not exist.`
    : shelf.BaseTemplate !== undefined && shelf.BaseTemplate !== TEMPLATE.library ? `"${library}" is a list, not a document library.` : null;
  if (shelfProblem) report.push({ list: library, ready: false, problems: [{ column: null, type: null, problem: shelfProblem }] });
  const problems = report.flatMap((list) => list.problems.map((problem) => ({ list: list.list, ...problem })));
  const no = (words) => ({ ready: false, wrote: null, words, problems, report });
  if (problems.length) {
    return no(`Not marked ready: the check found ${count(problems.length, 'problem')}. Fix ${problems.length === 1 ? 'it (it is' : 'them (they are'} listed below, with what Setup will not touch), then press Mark the site as ready again.`);
  }

  const settings = titles.appsettings;
  const address = listAddress(settings);
  // (Both reads of the item name its columns, as every item read does since Phase 10h: the real site leaves some out of a read that does not.)
  const items = results(await api.read(`${address}/items?$filter=${ID} eq ${literal(SETTINGS_ITEM)}&$top=2&${selectOf('appsettings')}`));
  if (items.length > 1) return no(`Not marked ready: ${settings} has two items with the AppId ${SETTINGS_ITEM}. Delete the one that is not needed (on a new site both are empty), then press Mark the site as ready again.`);
  const [item] = items;
  const version = item?.[VERSION_COLUMN];
  const raising = Number.isInteger(version) && version >= 1 && version < VERSION;
  if (version !== undefined && version !== null && !raising) {
    if (version === VERSION) return { ready: true, wrote: null, words: `The site was already marked ready (version ${VERSION}). Nothing was written.`, problems, report };
    if (Number.isInteger(version) && version > VERSION) {
      return no(`Not marked ready: the settings item says version ${version}; this version of the app is for version ${VERSION}. Setup never lowers the version of the lists: upload the newer files.`);
    }
    return no(`Not marked ready: the settings item says version ${version}, which is no version of these lists. Setup does not change it.`);
  }
  try {
    if (item) {
      await api.write('MERGE', `${address}/items(${item.Id})`, { __metadata: { type: item.__metadata?.type }, [VERSION_COLUMN]: VERSION }, { 'IF-MATCH': item.__metadata?.etag ?? '*' });
    } else {
      const { ListItemEntityTypeFullName: type } = await api.read(`${address}?$select=ListItemEntityTypeFullName`);
      await api.write('POST', `${address}/items`, { __metadata: { type }, Title: SETTINGS_ITEM, [ID]: SETTINGS_ITEM, [VERSION_COLUMN]: VERSION });
    }
  } catch (cause) {
    const said = String(cause.message).replace(/^SharePoint \(\d+\):\s*/, '');
    return no(cause.status === 403 ? `Not marked ready: your account cannot change ${settings}. A site owner must press Mark the site as ready. (${said})` : `Not marked ready: SharePoint refused the write: ${said}`);
  }
  // (Read back, as every page will read it.)
  const [landed] = results(await api.read(`${address}/items?$filter=${ID} eq ${literal(SETTINGS_ITEM)}&$top=2&${selectOf('appsettings')}`));
  if (landed?.[VERSION_COLUMN] !== VERSION) return no(`Not marked ready: SharePoint answered the write, but the settings item does not say version ${VERSION}. Press Mark the site as ready again.`);
  if (raising) return { ready: true, wrote: 'raised', from: version, words: `Raised the lists from version ${version} to version ${VERSION}.`, problems, report };
  return { ready: true, wrote: item ? 'version' : 'created', words: `The site is marked ready: every list passed the check, and the settings item of ${settings} now says version ${VERSION}.`, problems, report };
}

/**
 * The plan for this copy's lists: reads the site (`readSite`) and works it out (`makePlan`). Reads only.
 * @param {{ read: (resource: string) => Promise<any> }} api siteApi(dataService)
 * @param {Record<string, string>} titles dataService.sharePointListTitles()
 * @param {{ versioning?: boolean }} [options]
 */
export async function showPlan(api, titles, options = {}) {
  const site = await readSite(api.read, titles);
  return { site, plan: makePlan(site, titles, options) };
}

/** The plan in lines a person can read, for a test or a log: one line for each list, then each thing. */
export function planLines(plan) {
  const lines = [];
  for (const entry of plan.groups) {
    if (!entry.lists.length && !entry.columns.length && !entry.settings.length && !entry.untouched.length) continue;
    lines.push(`${entry.title} (${entry.state === 'new' ? 'new' : 'exists'})`);
    for (const item of entry.lists) lines.push(`  ${item.words}`);
    if (entry.columns.length) lines.push(`  Create ${count(entry.columns.length, 'column')}: ${entry.columns.map((item) => item.name).join(', ')}.`);
    for (const item of entry.settings) lines.push(`  ${item.words}`);
    for (const item of entry.untouched) lines.push(`  Will not touch${item.harmless ? ' (harmless)' : ''}: ${item.found} ${item.fix}`);
  }
  lines.push(plan.summary);
  return lines;
}

