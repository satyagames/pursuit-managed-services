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
import { LIBRARY_KEY, TEMPLATE, FIELD_OPTIONS, literal, listAddress, results, readSite } from './provision-site.js';
import { descriptionOf, count, makePlan } from './provision-plan.js';
// (Prompt 44: reading the site is lib/setup/provision-site.js, the plan lib/setup/provision-plan.js; their names are passed on here, as before. Create stays here.)
export { LIBRARY_KEY, BUSY_LISTS, MADE_BY, SETTINGS_PENDING, TEMPLATE, listAddress, siteApi, readSite } from './provision-site.js';
export { definition, listSettings, makePlan } from './provision-plan.js';

/** The key the picture library has among the titles (dataService.sharePointListTitles). */
// ---- Create: it only ever adds -----------------------------------------------------------------------------------------------------

/** What Create may change of a column that exists: the index or the uniqueness the plan named, and nothing else (never its type, never its name). */
export const FIELD_CHANGES = Object.freeze(['Indexed', 'EnforceUniqueValues']);
/** What Create may change of a list Setup made: its attachments, content approval, version history and description (never its title). */
export const LIST_CHANGES = Object.freeze(['EnableAttachments', 'EnableModeration', 'EnableVersioning', 'Description']);
/** What a person reads when SharePoint refuses a write for lack of permission (a 403), wherever it was. */
const NOT_ALLOWED = 'Your account cannot create lists on this site. A site owner must press Create, or create the lists by hand from SHAREPOINT-LISTS.md.';
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
      await api.write('MERGE', `${address}/items(${item.Id})`, { [VERSION_COLUMN]: VERSION }, { 'IF-MATCH': item['odata.etag'] ?? '*' });
    } else {
      await api.write('POST', `${address}/items`, { Title: SETTINGS_ITEM, [ID]: SETTINGS_ITEM, [VERSION_COLUMN]: VERSION });
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

