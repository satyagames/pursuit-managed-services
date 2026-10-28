// An in-memory stand-in for the SharePoint REST API that migration/src/lib/data/dataService.js talks to.
//
// It exists because the real tenant cannot be reached from here: it counts every request, enforces
// the two rules the response storage leans on (a unique AppId, and If-Match versions), and can be
// told to answer 409, 412, 429 or 503 (with Retry-After) on demand. It is NOT SharePoint: what it
// proves is that the adapter sends the requests it should and copes with those answers. Whether the
// real lists behave the same way is what the setup page's self-test is for.
//
// The ClientLogos document library is there too (Phase 6): its folder, adding a file (`fake.files`, a
// Map of server-relative path -> { bytes, type }), listing its files (Phase 10f), and recycling one (`fake.recycled`). Pictures are read
// back with `fake.file(path)`.
//
// A test names a list by its KEY, the name the data layer has for it (`sections`, `qrtokens`; the picture library is `logoLibrary`),
// never by its title (Phase 10c-2b): the title is worked out from the settings, so a list can be renamed without touching a test.
// `TITLE` (by key) is each list's title before any prefix, for a test that quotes what the app SAID about a list.
//
//   const fake = createSharePointFake();          // every list, with the full column set
//   fake.install();                               // node: replaces globalThis.fetch
//   const reply = await fake.handle(request);     // Playwright: answer a routed request
//
// `fake.requests` is the log, `fake.count()` and `fake.count(filter)` count it, `fake.reset()`
// empties it, and `fake.failNext({ status, retryAfter, times, when })` queues faults.
// `fake.rewriteMerges({ list, when, times, rewrite })` is the other kind of fault, a test tool that may change: a MERGE on
// `list` (a key) that SharePoint ANSWERS as done, 204, and stores `rewrite(changes, row)` instead of what was sent
// (`() => ({})` stores nothing; `(changes) => ({ ...changes, ClientId: 'c-x' })` stores another client). A write accepted and not kept.
//
// Two sets of lists (Phase 10b). A site can hold several copies of the app, each with its own lists, told apart by a prefix on
// their titles. So the fake always holds BOTH a set with plain titles (`Clients`) and a set with a prefix (`PMS3Clients`), and a
// test says which is its own: `createSharePointFake({ prefix: 'PMS3' })`, or no prefix for the plain set. `fake.settings` is what
// to configure the data layer with. Everything a test reads off the fake (`fake.lists`, `fake.item`, `fake.add`, `entry.list`) is
// about its OWN set and is keyed by the list's key, so the same test runs unchanged on either. The other set is real too: a
// request that reaches it is answered, exactly as a second copy's lists would answer on a real site, which is the failure that
// cannot otherwise be seen. Such a request has `entry.stray === true` and is kept in `fake.strays` (and in STRAYS, for a whole
// suite to check at its end); `entry.title` is the title a request named. `lists: { qrtokens: 'GuestCodes' }` gives one list of the
// test's own set a title of its own, and `logoLibrary` the picture library.
//
// Building a site (Phase 10c-3, Setup's Show the plan and Create). The fake answers `GET /web/lists` (every list and library on the site,
// with its template and its attachments, content approval and version history), creates a list (`POST /web/lists`, template 100) or the
// picture library (template 101) of the test's own set, creates a column from an XML definition (`fields/createfieldasxml`), reads one
// (`fields/getbyid('<id>')`, `fields/getbyinternalnameortitle('<name>')`), changes a column's index, uniqueness or required setting (a
// MERGE on either address, and nothing else: a type is never changed), and changes a list's settings (a MERGE on the list). A list created
// here has SharePoint's built-in Title column and SharePoint's defaults: attachments on, content approval off, version history on.
// `without: ['logoLibrary']` stands for a site with no picture library. Like SharePoint, a column whose internal name is taken gets a digit
// (`SortOrder0`), and a date column made without a format shows the date only. The traps of ARCHITECTURE-10.md 6.3 (in git history at 7347c72) that SharePoint may or
// may not spring are OPTIONS (`traps`, below; `ALL_TRAPS` turns on every one but `taken`). And two faults for any write: `fake.forbid(when)`
// refuses every write `when` accepts with SharePoint's "Access denied" (403), and `fake.failWrite({ at })` fails the at-th write from now
// (500). `fake.writes()` is every write of the log (no read, no write token, no $batch of reads). None of it is SharePoint: what each
// answer really is on the tenant is QA-TESTING.md's to see.
//
// Which columns an item read returns (Phase 10h). The real site (PCOE, 14 Oct 2026) left ClientId out of every PMSActivities item read
// that did not name its columns, and returned it to a read that did (`$select`); why, and which other columns or lists it does it to, is
// not known. So the fake answers as that tenant did: a read with `$select` gets exactly the columns it names (a column the row holds no
// value for is left out, as before), with `__metadata`, `Id` and `ID`, and a `$select` naming a column the list does not have is refused
// (400, as SharePoint is believed to answer: not seen); a read without one leaves out the columns in `leavesOut` (by default
// TENANT_LEAVES_OUT, ClientId on every list that has it), and so does the item a create returns (the same serialisation: assumed, not
// seen). And by default (`strict`) a read without `$select` is not answered at all: it is refused with UNNAMED_REFUSAL and noted in
// UNNAMED, so that every suite sees a read that does not name its columns. `strict: false` is the tenant as it was seen. The one unnamed
// read strict mode answers is `$top=1` and nothing else, the shape of Setup's probe of what this site leaves out (no page reads one item
// of a whole list). A `__next` link carries the `$select` it was asked with, as SharePoint's does.
//
// A column the site will not return by name (Phase 10i). The real site (PCOE, 15 Oct 2026) refused every PMSVisitLog item read whose $select
// named DisplayName, with 400 and "Value does not fall within the expected range." (REFUSED_WORDS), and left DisplayName out of a read that
// named no columns: `DisplayName` is also a property SharePoint gives every list item in REST (SP.ListItem.DisplayName), so a column of that
// name can be written and not read back. A list with no item to return (PMSGuestList, PMSGuestQRCodes there) answered the same read, so the
// fake refuses only a read that would return at least one row. `refusesByName` (default TENANT_REFUSES_BY_NAME, DisplayName on every list)
// is the columns it does this to, each refusal noted in REFUSED_BY_NAME; `leavesOut` now leaves DisplayName out too.
//
// A duplicate (Phase 10h). A create that meets a value a unique column already holds (AppId) is refused with DUPLICATE_WORDS. The real site
// (PCOE, 14 Oct 2026) said it with status 500, so the fake does by default; `duplicateStatus: 400` is what the fake said until Phase 10h (and
// what SharePoint is documented to say). `duplicateCode: true` adds SharePoint's error code for it, DUPLICATE_CODE, which is ASSUMED: the
// tenant's own `error.code` was not captured (QA-TESTING.md item 142).
//
// A sign-in SharePoint no longer accepts (Prompt 19). `fake.expireSession()` refuses every /_api request from then on, reads and the write token
// too, with 403, ACCESS_DENIED and SESSION_REFUSED_CODE, until `fake.renewSession()`: what the PCOE site answered an admin tab left open a while
// (the words were seen; the code is ASSUMED until QA-TESTING.md's capture). `GET /_api/web?$select=Id` is the site itself, the data layer's light
// proof that a sign-in works. Every answer carries an SPRequestGuid header, as SharePoint's do, so a refusal can be traced.

import { LIBRARY, LISTS, VERSION } from '../migration/src/lib/schema/pms-schema.js';
import { META, columnNamesAt, columnsOf } from '../migration/src/lib/schema/pms-schema-meta.js';

export const SITE_URL = 'https://tenant.example/sites/cec';

/** The prefix the other set has when a test's own lists have none, and the one the suites use for their second run (a test copy on the same site: `TestPMSClients`). */
export const OTHER_PREFIX = 'Test';
/**
 * The prefix a suite's fakes get when a test names none: empty, or PMS_TEST_LIST_PREFIX for the run in which every mocked suite
 * is repeated on prefixed lists (scripts/test-list-namespace.js starts those runs).
 */
export const SUITE_PREFIX = process.env.PMS_TEST_LIST_PREFIX ?? '';
/** Every request, from any fake of this process, that reached a list which was not the test's own. A suite asserts it is empty. */
export const STRAYS = [];
/**
 * Every read, from any fake of this process, that filtered on a column the schema does not index (Phase 10c-2b: an index on exactly
 * the columns the data layer filters on). Such a read is refused, as SharePoint refuses one past 5,000 items, and noted here, because a
 * caller may swallow the refusal (a scan's look for an earlier try does): a suite asserts it is empty. Setup's read-only probes ask for
 * nothing but `Id` and are answered whatever they filter on.
 */
export const UNINDEXED = [];
/**
 * Every item read, from any fake of this process, that named no columns and was refused for it (strict mode, Phase 10h). A caller may
 * swallow the refusal (a scan's look for an earlier try, a screen's poll), so a suite asserts it is empty, as it does UNINDEXED.
 */
export const UNNAMED = [];
/**
 * Every item read, from any fake of this process, that named a column the site will not return by name and was refused for it (Phase 10i).
 * A caller may swallow the refusal (Guests' look, a scan's look for an earlier try), so a suite can assert it is empty.
 */
export const REFUSED_BY_NAME = [];
/**
 * The columns the real site was seen to leave out of an item read that does not name its columns: ClientId (PCOE, 14 Oct 2026) and
 * DisplayName (PMSVisitLog, 15 Oct 2026).
 */
export const TENANT_LEAVES_OUT = Object.freeze(['ClientId', 'DisplayName']);
/** The columns the real site refused to return by name, when there was an item to return (PCOE, 15 Oct 2026: DisplayName, on PMSVisitLog). */
export const TENANT_REFUSES_BY_NAME = Object.freeze(['DisplayName']);
/** What the real site said when it refused one (400). */
export const REFUSED_WORDS = 'Value does not fall within the expected range.';
/** What strict mode answers an item read that names no columns. */
/** What SharePoint says when a create meets a value of a unique column that is taken (seen on the real site, 14 Oct 2026, with status 500). */
export const DUPLICATE_WORDS = 'The list item could not be added or updated because duplicate values were found in the following field(s) in the list: [AppId].';
/** SharePoint's error code for a duplicate, as the fake gives it with `duplicateCode: true`. ASSUMED: the tenant's own code was not captured. */
export const DUPLICATE_CODE = '-2130575169, Microsoft.SharePoint.SPDuplicateValuesFoundException';
export const UNNAMED_REFUSAL = 'The mock refuses an item read that does not name its columns: name them with $select. (The real site leaves ClientId out of such a read: Phase 10h.)';
/**
 * What the app said, with the suite's prefix taken off the list titles in it (strings, arrays and plain objects, all the way down), so
 * that an assertion written with the plain titles holds on the second run too. With no prefix it changes nothing. That the app does
 * say the PREFIXED title is held, on purpose, by scripts/test-list-namespace.js.
 */
export function plainTitles(value, prefix = SUITE_PREFIX) {
  if (!prefix) return value;
  if (typeof value === 'string') return value.replace(new RegExp(`\\b${prefix}(${Object.values(TITLE).join('|')})\\b`, 'g'), '$1');
  if (Array.isArray(value)) return value.map((entry) => plainTitles(entry, prefix));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, plainTitles(entry, prefix)]));
  return value;
}

// The lists and their columns are the schema file's (migration/src/lib/schema/pms-schema.js and pms-schema-meta.js, Phase 10c-2b): this mock has no
// table of its own. Each list holds the columns META describes, with SharePoint's type, index and uniqueness for each.

/** The key the data layer has for each list title before any prefix: how a test names a list. */
const KEY_OF = Object.fromEntries(Object.entries(LISTS).map(([key, { title }]) => [title, key]));
/** The key a test names the picture library by: the setting that names it (`logoLibrary`). */
export const LIBRARY_KEY = 'logoLibrary';
/** Each list's title before any prefix, by key, and the picture library's: for a test that quotes what the app said about a list. */
export const TITLE = Object.freeze({ ...Object.fromEntries(Object.entries(LISTS).map(([key, { title }]) => [key, title])), [LIBRARY_KEY]: LIBRARY });
/**
 * Thirteen columns a test can take away (`without`) to stand for a site that lacks them: the ones added in Phase 4, which were optional
 * until schema v2 made every column required (Phase 10c-2b). Test data, by key.
 */
export const PHASE_4_COLUMNS = Object.freeze([
  'clients.Slug', 'clients.ThemeJson', 'clients.ThemeVersion', 'clients.Status', 'sections.ClientId', 'sections.Description', 'questions.Layout',
  'options.ImageUrl', 'sessions.ActivityFlow', 'appsettings.ActiveClientId', 'appsettings.ActivatedAt', 'responses.TrackId', 'responses.ClientId',
]);
/** The columns of a list the schema indexes, by key. */
const INDEXED = Object.fromEntries(Object.keys(LISTS).map((key) => [key, new Set(columnsOf(key).filter((column) => column.indexed).map((column) => column.name))]));

/** Refuses a name that is not a list's key: a test that still named a list by its title would otherwise ask about a list that is not there. */
function knownKey(key) {
  if (typeof key !== 'string' || !(key in TITLE)) throw new Error(`The mock knows no list "${key}": name a list by its key (${Object.keys(TITLE).join(', ')}).`);
  return key;
}

/** SharePoint's words when an account may not do what it asked (a 403): what `fake.forbid()` answers. */
export const ACCESS_DENIED = 'Access denied. You do not have permission to perform this action or access this resource.';
/** SharePoint's error code for a refused identity (System.UnauthorizedAccessException): what `fake.expireSession()` answers with. ASSUMED. */
export const SESSION_REFUSED_CODE = '-2147024891, System.UnauthorizedAccessException';
/** What the fake answers for uniqueness asked of a column with no index (the `uniqueNeedsIndex` trap). */
export const UNIQUE_NEEDS_INDEX = 'This field must be indexed to enforce unique values.';
/** What the fake answers for an index and uniqueness asked in one step (the `uniqueApart` trap). */
export const UNIQUE_APART = 'The index and the enforcement of unique values cannot be set on a column in the same request.';
/**
 * Every trap of ARCHITECTURE-10.md 6.3 (in git history at 7347c72) the fake can spring, but `taken` (which names columns): a several-lines column made without saying
 * otherwise is rich text, uniqueness is refused on a column with no index, and refused when it comes in the same step as the index.
 * `taken: ['sections.SortOrder']` makes that internal name taken on that list (by a column nobody sees), so a column asked for under it
 * gets a digit. `richText: 'always'` makes every several-lines column rich text, whatever its definition says.
 */
export const ALL_TRAPS = Object.freeze({ richText: 'default', uniqueNeedsIndex: true, uniqueApart: true });
/** SharePoint's settings of a list made by hand or through REST: attachments on, content approval off, version history on. */
const NEW_LIST = Object.freeze({ EnableAttachments: true, EnableModeration: false, EnableVersioning: true, Description: '' });
/** The settings of a list a request may change (a MERGE on the list, or the body that creates it). */
const LIST_SETTINGS = ['EnableAttachments', 'EnableModeration', 'EnableVersioning', 'Description'];
/** What a MERGE on a column may change: Setup only ever adds an index or uniqueness (and a test may make a column required). */
const FIELD_SETTINGS = ['Indexed', 'EnforceUniqueValues', 'Required'];
const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (text) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => XML_ENTITIES[name]);
/** The lists schema version 5 added (Prompt 21, Phase 1), by key: a site Setup made for an earlier version has none of them. */
export const PHASE_21_LISTS = Object.freeze(Object.keys(LISTS).filter((key) => META[key].since === 5));
/** The columns of an older list schema version 5 added (Prompt 21, Phase 1), as 'key.Column'. */
export const PHASE_21_COLUMNS = Object.freeze(['appsettings.FiscalYearStartMonth', 'appsettings.MinSample']);
/** The columns schema version 4 added (Phase 20), as 'key.Column': what a site Setup made for an earlier version lacks. */
export const PHASE_20_COLUMNS = Object.freeze(['sections.Kind', 'sessions.ConfidenceCheck']);

/** A column's internal name made from a display name, as SharePoint makes it when no name is asked for: a space is `_x0020_`. */
const encodedName = (display) => [...String(display)].map((character) => (/[A-Za-z0-9_]/.test(character) ? character : `_x${character.charCodeAt(0).toString(16).padStart(4, '0')}_`)).join('');

/**
 * A list's columns as SharePoint describes them (its /fields), from the schema: type, index, uniqueness, (AppId alone) required, and a date shown
 * as Date & Time (DisplayFormat 1). `version`: the columns as Setup made them for that version of the lists (Phase 10i: version 2 had DisplayName
 * where 3 has GuestName and SignedInName, of the same type; Phase 20: version 3 had neither PMSActivities.Kind nor PMSClientSessions.ConfidenceCheck).
 */
const fieldsFor = (key, version = VERSION) => columnsOf(key).map((column, index) => ({
  InternalName: columnNamesAt(key, version)[index], TypeAsString: column.type, Indexed: column.indexed, EnforceUniqueValues: column.unique,
  RichText: false, AppendOnly: false, Required: column.required, ReadOnlyField: false, ...(column.type === 'DateTime' ? { DisplayFormat: 1 } : {}),
})).filter((field) => field.InternalName !== null);

/** What a field of a real list carries besides what the app reads (Phase 10j): every read of a list's columns that names none gets all of it. */
const FIELD_EXTRAS = Object.freeze({
  AutoIndexed: false, CanBeDeleted: true, ClientSideComponentId: '00000000-0000-0000-0000-000000000000', ClientSideComponentProperties: null,
  ClientValidationFormula: null, ClientValidationMessage: null, CustomFormatter: null, DefaultFormula: null, Description: '', Direction: 'none',
  Filterable: true, Group: 'Custom Columns', IndexStatus: 0, JSLink: 'clienttemplates.js', PinnedToFiltersPane: false, Scope: '/sites/cec/Lists',
  Sealed: false, ShowInFiltersPane: 0, Sortable: true, TypeDisplayName: 'Single line of text', TypeShortDescription: 'Single line of text',
  ValidationFormula: null, ValidationMessage: null,
});
/**
 * A column as a read of a list's `/fields` returns it (Phase 10j): with `$select`, the properties named (and its `__metadata`), as SharePoint answers;
 * without, every property, its SchemaXml (the column's whole definition) among them. A real list answers a read that names nothing with every field it
 * has, hidden ones too, each like this: that read is what the data layer's column check made before every list's first write until Phase 10j.
 */
const fieldAsRead = (select) => (field) => {
  if (select !== null) {
    const named = select.split(',').map((name) => name.trim()).filter((name) => name in field);
    return { __metadata: { type: 'SP.Field' }, ...Object.fromEntries(named.map((name) => [name, field[name]])) };
  }
  const xml = [`Type="${field.TypeAsString}"`, `DisplayName="${field.Title ?? field.InternalName}"`, `Required="${field.Required ? 'TRUE' : 'FALSE'}"`,
    `EnforceUniqueValues="${field.EnforceUniqueValues ? 'TRUE' : 'FALSE'}"`, `Indexed="${field.Indexed ? 'TRUE' : 'FALSE'}"`,
    `ID="{${field.Id ?? '00000000-0000-4000-8000-000000000000'}}"`, 'SourceID="{11111111-2222-4333-8444-555555555555}"',
    `StaticName="${field.InternalName}"`, `Name="${field.InternalName}"`, 'ColName="nvarchar7"', 'RowOrdinal="0"', 'Version="1"',
    ...(field.TypeAsString === 'Note' ? ['NumLines="6"', `RichText="${field.RichText ? 'TRUE' : 'FALSE'}"`, 'RichTextMode="Compatible"', 'IsolateStyles="FALSE"', `AppendOnly="${field.AppendOnly ? 'TRUE' : 'FALSE'}"`, 'UnlimitedLengthInDocumentLibrary="FALSE"'] : []),
    ...(field.TypeAsString === 'DateTime' ? [`Format="${field.DisplayFormat === 1 ? 'DateTime' : 'DateOnly'}"`, 'FriendlyDisplayFormat="Disabled"'] : []),
    ...(field.TypeAsString === 'Text' ? [`MaxLength="${field.MaxLength ?? 255}"`] : []),
    'Customization=""', 'CustomFormatter=""'].join(' ');
  return { __metadata: { type: 'SP.Field' }, ...FIELD_EXTRAS, ...field, SchemaXml: `<Field ${xml} />` };
};

/**
 * @param {{ without?: string[], user?: { Id: number, Title: string }, siteUrl?: string, prefix?: string, lists?: Record<string, string>, logoLibrary?: string }} [options]
 *   `without` drops columns (as `key.Column`) or whole lists (as `key`), to stand for a site
 *   where they have not been created. `siteUrl` is only what `fake.siteUrl` reports: requests are
 *   recognised by their path, whatever site they name. `prefix`, `lists` and `logoLibrary` say which
 *   lists are the test's own (see the top of the file). `addresses` (by key) gives a list another
 *   last part to its address than its title: a list that was made under one name and renamed since. `schemaVersion` is what the
 *   AppSettings item `default` says when the site is set up, as Setup writes it when it makes the lists (Phase 10c-2b): this build's VERSION by default (3 since Phase 10i);
 *   another number for a site of another version; null for a site Setup has not run on (no item at all). `listsVersion` (Phase 10i) is the
 *   version the lists' columns are of, this build's unless a test says otherwise: `listsVersion: 2` is a site Setup made for version 2, with its
 *   DisplayName columns, and its settings item says 2 unless `schemaVersion` says otherwise; `keepColumns` ('key.Column', Phase 20) are columns a later
 *   version added that such a site has all the same, for a test to write its records with this build's data layer before it takes them off
 *   (dropColumns). The item takes no id of the
 *   sequence the test's own items get, so their addresses are what they always were. `traps` (Phase 10c-3) are the traps of
 *   ARCHITECTURE-10.md 6.3 (in git history at 7347c72) the fake springs when a column is made or changed: see ALL_TRAPS. `strict` and
 *   `leavesOut` (Phase 10h) are what an item read that names no columns gets: see the top of the file. `{ strict: false }` is the tenant.
 *   `duplicateStatus` and `duplicateCode` (Phase 10h) are how a duplicate is refused: see the top of the file. `refusesByName` (Phase 10i)
 *   is the columns an item read may not name when it would return a row: see the top of the file; `[]` answers every one.
 *   `ownerGroupId` (Prompt 21) is the id of the site's owners group, `/web/AssociatedOwnerGroup`: an account whose `Groups` holds it is a site owner.
 *   `keepColumns` may also name a whole list (by key) that a later version added, for a site of an earlier version that has it all the same.
 */
export function createSharePointFake({ without = [], user = { Id: 42, Title: 'Casey Example' }, ownerGroupId = 3, siteUrl = SITE_URL, prefix = SUITE_PREFIX, lists: named = {}, logoLibrary, addresses = {}, listsVersion = VERSION, schemaVersion = listsVersion, keepColumns = [], traps = {}, strict = true, leavesOut = TENANT_LEAVES_OUT, refusesByName = TENANT_REFUSES_BY_NAME, duplicateStatus = 500, duplicateCode = false, realShape = null } = {}) {
  const fields = new Map();
  const lists = new Map();
  /** The other set's rows, by the title a request names: empty unless something went to the wrong lists. */
  const otherLists = new Map();
  /** The title a request names -> the key of the list it is, and whether that list is the test's own. */
  const titles = new Map();
  const strays = [];
  for (const entry of without) knownKey(entry.split('.')[0]);
  for (const key of Object.keys(addresses)) knownKey(key);
  for (const [key, { title }] of Object.entries(LISTS)) {
    const own = named[key] ?? prefix + title;
    // (Known by its key even when the test left the list out of its site: `entry.list` names it, and asking for it is a 404.)
    titles.set(own, { key, own: true });
    // Both usual titles exist on the site whichever is the test's own: the plain one and the prefixed one. (The other copy's lists are
    // there whatever `without` says, which is about the test's own: Phase 10c-3's plan must leave them alone on a site where its own are missing.)
    for (const other of [title, (prefix || OTHER_PREFIX) + title]) {
      if (other === own) continue;
      titles.set(other, { key, own: false });
      otherLists.set(other, []);
    }
    if (without.includes(key)) continue;
    // (Prompt 21: a list a later version added is not on a site of an earlier one, unless the test keeps it, by key, in `keepColumns`.)
    if ((META[key].since ?? 0) > listsVersion && !keepColumns.includes(key)) continue;
    fields.set(key, [...fieldsFor(key, listsVersion), ...fieldsFor(key).filter((column) => keepColumns.includes(`${key}.${column.InternalName}`) && !fieldsFor(key, listsVersion).some((held) => held.InternalName === column.InternalName))]
      .filter((column) => !without.includes(`${key}.${column.InternalName}`)));
    lists.set(key, []);
  }
  /** What dataService.configure({ sharePoint }) takes for this site. */
  const settings = { siteUrl, listPrefix: prefix, ...(Object.keys(named).length ? { lists: named } : {}), ...(logoLibrary ? { logoLibrary } : {}) };
  /** The title of each of the test's own lists as the site spells it, by key. */
  const titleOf = (key) => [...titles].find(([, entry]) => entry.key === knownKey(key) && entry.own)?.[0];
  const requests = [];
  const faults = [];
  const rewrites = [];
  /** The picture library: server-relative path -> { bytes, type }. Files recycled land in `recycled`. */
  const libraryTitle = logoLibrary ?? `${prefix}${LIBRARY}`;
  const otherLibraries = [LIBRARY, `${prefix || OTHER_PREFIX}${LIBRARY}`].filter((title) => title !== libraryTitle);
  const sitePath = new URL(siteUrl).pathname.replace(/\/+$/, '');
  const libraryFolder = `${sitePath}/${libraryTitle}`;
  const files = new Map();
  const recycled = [];
  let nextId = 1;
  let version = 0;
  const hooks = { beforeCreate: null, beforeMerge: null };
  /** Whether the test's own picture library exists (`without: ['logoLibrary']` is a site where it has not been made). */
  let libraryPresent = !without.includes(LIBRARY_KEY);
  /** Each list's and library's settings, by title, once something has set them (else NEW_LIST, as SharePoint made it). */
  const listSettings = new Map();
  /** The write that `failWrite` fails, counted among the writes from when it was asked for. */
  const writeFaults = [];
  let writesSeen = 0;
  let nextFieldId = 1;
  /** expireSession() was called and renewSession() has not been since: every /_api request is refused (Prompt 19). */
  let sessionExpired = false;
  let nextGuid = 1;

  // SharePoint makes a list's item type from the name the list was created under: for a prefixed list, with the prefix.
  const typeOf = (title) => `SP.Data.${title}ListItem`;
  // A list's id (made from its title, so that it is the same every time a test runs) and its address, which SharePoint fixes when the
  // list is created: `<site>/Lists/<the name it was created under>`. Setup reads both (Phase 10b, "Where the lists are").
  const idOf = (title) => {
    const hex = [...title].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, '0');
    return `${hex}-0000-4000-8000-${hex}${hex.slice(0, 4)}`;
  };
  const addressOf = (title) => `${sitePath}/Lists/${titles.get(title)?.own && addresses[titles.get(title).key] ? addresses[titles.get(title).key] : title}`;
  const properties = (title) => ({ Id: idOf(title), Title: title, ListItemEntityTypeFullName: typeOf(title), RootFolder: { ServerRelativeUrl: addressOf(title) } });
  const isLibrary = (title) => title === libraryTitle || otherLibraries.includes(title);
  /** One list or library as `GET /web/lists` describes it: its template, settings and address. */
  const siteEntry = (title) => (isLibrary(title)
    ? { Id: idOf(title), Title: title, BaseTemplate: 101, Hidden: false, ...NEW_LIST, EnableAttachments: false, ...listSettings.get(title), ListItemEntityTypeFullName: `SP.Data.${title}Item`, RootFolder: { ServerRelativeUrl: `${sitePath}/${title}` } }
    : { ...properties(title), BaseTemplate: 100, Hidden: false, ...NEW_LIST, ...listSettings.get(title) });
  /** Every list and library on the site: the test's own that exist, and the other set's, which always do. */
  const siteTitles = () => [...[...lists.keys()].map((key) => titleOf(key)), ...otherLists.keys(), ...(libraryPresent ? [libraryTitle] : []), ...otherLibraries];
  /** SharePoint's built-in Title column, which every list made through REST has (required, as SharePoint makes it). */
  const builtInTitle = () => ({ Id: `00000000-0000-4000-8000-${String(nextFieldId++).padStart(12, '0')}`, InternalName: 'Title', StaticName: 'Title', Title: 'Title', TypeAsString: 'Text', Indexed: false, EnforceUniqueValues: false, Required: true, ReadOnlyField: false, Hidden: false, FromBaseType: true, RichText: false, AppendOnly: false, MaxLength: 255, DefaultValue: null });
  const isWrite = (entry) => entry.method !== 'GET' && !/\/(contextinfo|\$batch)$/.test(entry.path);
  const yes = (value) => /^true$/i.test(String(value ?? ''));
  // (`realShape`, the local site's alone (Phase 12): an item also carries SharePoint's Created and Modified, and its __metadata the id and uri a
  // real one has. Off by default, so every suite's items are what they always were.)
  const stamp = (title, item) => {
    const etag = `"${version += 1}"`;
    if (!realShape) return { ...item, __metadata: { etag, type: typeOf(title) } };
    const now = realShape.now();
    const uri = `${siteUrl}/_api/Web/Lists(guid'${idOf(title)}')/Items(${item.Id})`;
    return { ...item, Created: item.Created ?? now, Modified: now, __metadata: { id: uri, uri, etag, type: typeOf(title) } };
  };
  /** An item as SharePoint returns it without being told which columns: without `leavesOut` (Phase 10h). */
  const leftOut = (row) => Object.fromEntries(Object.entries(row).filter(([column]) => !leavesOut.includes(column)));
  /** Puts an item straight into one of the test's own lists (by key), as if it had always been there. Only that list's columns. */
  const add = (key, item) => {
    const known = new Set(['Id', 'Title', '__metadata', ...(fields.get(key) ?? []).map((column) => column.InternalName)]);
    const stray = Object.keys(item).find((column) => !known.has(column));
    if (stray) throw new Error(`The mock's ${key} list has no column ${stray}: a row is put in with the list's own columns only.`);
    const row = stamp(titleOf(key), { Id: nextId++, ...item });
    lists.get(key).push(row);
    return row;
  };

  const reply = (status, data, headers = {}) => ({
    status, headers: { 'Content-Type': 'application/json', ...headers }, body: data === null ? '' : JSON.stringify(data),
  });
  const ok = (data, status = 200) => reply(status, { d: data });
  const error = (status, message, headers, code) => reply(status, { error: { ...(code ? { code } : {}), message: { value: message } } }, headers);

  // `A eq 'x'` comparisons; a parenthesised group is OR inside, groups are AND together.
  const comparisons = (text) => [...text.matchAll(/(\w+) eq '((?:''|[^'])*)'/g)].map(([, column, value]) => [column, value.replace(/''/g, "'")]);
  function matcher(filter) {
    if (!filter) return () => true;
    const groups = [...filter.matchAll(/\(([^()]+)\)/g)].map(([, group]) => comparisons(group));
    const loose = filter.replace(/\([^()]+\)/g, '');
    // Outside parentheses the adapter only ever joins with `and`.
    for (const comparison of comparisons(loose)) groups.push([comparison]);
    return (row) => groups.every((group) => group.some(([column, value]) => String(row[column]) === value));
  }

  const lower = (headers) => Object.fromEntries(Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));

  /** One request of the log: what was asked, of which list. A read inside a $batch has `batched: true` and is not in `requests`. */
  function describe(request, headers, extra = {}) {
    const method = headers['x-http-method'] ?? request.method;
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname);
    // (A quote inside a title travels doubled, as OData asks: `getbytitle('Guest''s codes')`.)
    let title = path.match(/getbytitle\('((?:''|[^'])+)'\)/)?.[1].replace(/''/g, "'") ?? null;
    // A list being created names itself in its body (Phase 10c-3): the log says which, and whether it is the test's own.
    let body = null;
    if (method === 'POST' && (/\/web\/lists$/.test(path) || /\/fields\/createfieldasxml$/.test(path))) { try { body = JSON.parse(request.body ?? ''); } catch { /* not JSON */ } }
    if (/\/web\/lists$/.test(path) && typeof body?.Title === 'string') title = body.Title;
    // The column a request makes or changes: the name it asked for (an XML definition's Name) or the one in its address.
    const field = path.match(/\/fields\/getbyinternalnameortitle\('((?:''|[^'])+)'\)/)?.[1].replace(/''/g, "'")
      ?? (typeof body?.parameters?.SchemaXml === 'string' ? /\bName="([^"]*)"/.exec(body.parameters.SchemaXml)?.[1] : undefined);
    // `list` is the key of the list a request is for, whichever set it reached; `title` is what the request named.
    const known = title === null ? null : titles.get(title) ?? (title === libraryTitle ? { key: LIBRARY_KEY, own: true } : otherLibraries.includes(title) ? { key: LIBRARY_KEY, own: false } : null);
    const entry = { method, list: known?.key ?? title, title, url: request.url, path, query: decodeURIComponent(url.search), ifMatch: headers['if-match'] ?? null, at: Date.now(), ...(field === undefined ? {} : { field }), ...extra };
    if (known && !known.own) {
      entry.stray = true;
      strays.push(entry);
      STRAYS.push(entry);
    }
    // The AppId a create or update carries, so a fault can be aimed at one record.
    if (method !== 'GET' && request.body && !path.endsWith('/$batch')) { try { entry.appId = JSON.parse(request.body).AppId ?? null; } catch { /* not JSON */ } }
    return entry;
  }

  /** @param {{ method: string, url: string, headers?: Record<string, string>, body?: string | null, bodyBuffer?: Buffer }} request */
  async function handle(request) {
    const headers = lower(request.headers);
    const entry = describe(request, headers);
    requests.push(entry);
    const guid = `fa${String(nextGuid++).padStart(6, '0')}-0000-4000-8000-000000000019`;
    entry.guid = guid;
    if (sessionExpired) {
      entry.faulted = 403;
      entry.refusedSession = true;
      return error(403, ACCESS_DENIED, { SPRequestGuid: guid }, SESSION_REFUSED_CODE);
    }
    const result = await answer(request, headers, entry);
    return { ...result, headers: { ...result.headers, SPRequestGuid: guid } };
  }

  /**
   * POST /_api/$batch: an OData multipart body, one `application/http` part per operation, answered
   * as `multipart/mixed` with one part per operation in the same order. It is ONE request in the
   * log, whose `parts` are the operations it carried. Like SharePoint it is strict about the
   * envelope (the write token, the boundary, the part headers, an absolute and fully encoded
   * address) and answers a part in Atom XML unless that part asks for JSON. Only reads are
   * supported: a write outside a change set is refused, as OData requires.
   */
  async function batch(request, headers, entry) {
    if (headers['x-requestdigest'] !== 'digest-token') return error(403, 'The security validation for this page is invalid.');
    const boundary = /^multipart\/mixed;\s*boundary="?([^";]+)"?$/i.exec(headers['content-type'] ?? '')?.[1];
    if (!boundary) return error(400, 'The batch request must have a "Content-Type" header of multipart/mixed with a boundary.');
    const pieces = String(request.body ?? '').split(`--${boundary}`);
    if (pieces.length < 3 || pieces[0].trim() !== '' || !pieces.at(-1).startsWith('--')) return error(400, 'The message is not a valid batch: a boundary is missing.');
    entry.parts = [];
    const mark = `batchresponse_${crypto.randomUUID()}`;
    const out = [];
    for (const piece of pieces.slice(1, -1)) {
      const [envelope, requestLine = '', ...rest] = piece.replace(/^\r?\n/, '').split(/\r?\n\r?\n/);
      const partHeaders = lower(Object.fromEntries(envelope.split(/\r?\n/).filter(Boolean).map((line) => line.split(/:\s*/, 2))));
      const [first, ...innerLines] = requestLine.split(/\r?\n/);
      const words = first.split(' ');
      let part;
      if (partHeaders['content-type'] !== 'application/http' || partHeaders['content-transfer-encoding'] !== 'binary') {
        part = error(400, 'Each part of a batch needs Content-Type: application/http and Content-Transfer-Encoding: binary.');
      } else if (words.length !== 3 || words[2] !== 'HTTP/1.1' || !/^https:\/\//.test(words[1])) {
        part = error(400, 'A request line in the batch is not "METHOD absolute-url HTTP/1.1" (is the address encoded?).');
      } else if (words[0] !== 'GET') {
        part = error(400, 'A write in a batch must be inside a change set.');
      } else {
        const innerHeaders = lower(Object.fromEntries(innerLines.filter(Boolean).map((line) => line.split(/:\s*/, 2))));
        const inner = describe({ method: 'GET', url: words[1], body: rest.join('\r\n\r\n') || null }, innerHeaders, { batched: true });
        entry.parts.push(inner);
        part = await answer({ method: 'GET', url: words[1], body: null }, innerHeaders, inner);
        // Without an Accept line asking for JSON, a part comes back as an Atom feed.
        if (part.status === 200 && !/application\/json/.test(innerHeaders.accept ?? '')) {
          part = { ...part, headers: { 'Content-Type': 'application/atom+xml;type=feed;charset=utf-8' }, body: '<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>' };
        }
      }
      const reason = { 200: 'OK', 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 429: 'Too Many Requests', 503: 'Service Unavailable' }[part.status] ?? 'Error';
      out.push(`--${mark}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', '',
        `HTTP/1.1 ${part.status} ${reason}`, ...Object.entries(part.headers).map(([name, value]) => `${name.toUpperCase()}: ${value}`), '', part.body);
    }
    out.push(`--${mark}--`, '');
    return { status: 200, headers: { 'Content-Type': `multipart/mixed; boundary=${mark}` }, body: out.join('\r\n') };
  }

  /** Answers one operation: a request of its own, or one read out of a batch. */
  async function answer(request, headers, entry) {
    const { method, list, title, path } = entry;
    const url = new URL(request.url);

    if (!entry.batched && isWrite(entry)) {
      writesSeen += 1;
      const failing = writeFaults.findIndex((candidate) => candidate.at === writesSeen);
      if (failing !== -1) {
        const [due] = writeFaults.splice(failing, 1);
        entry.faulted = due.status;
        return error(due.status, due.message);
      }
    }
    const fault = faults.find((candidate) => candidate.times > 0 && candidate.when(entry));
    if (fault) {
      fault.times -= 1;
      entry.faulted = fault.status;
      return error(fault.status, fault.message ?? `Injected ${fault.status}`, fault.retryAfter === undefined ? {} : { 'Retry-After': String(fault.retryAfter) });
    }

    if (path.endsWith('/_api/$batch') && !entry.batched) return method === 'POST' ? batch(request, headers, entry) : error(405, 'The batch endpoint only accepts POST.');
    if (path.endsWith('/contextinfo')) return ok({ GetContextWebInformation: { FormDigestValue: 'digest-token', FormDigestTimeoutSeconds: 1800 } });
    // (`user` may be a function, asked on every request: the local site's personas, Phase 12.)
    if (path.endsWith('/web/currentuser')) return ok(typeof user === 'function' ? user() : user);
    // The site's owners group (Prompt 21: a member of it is a site owner, and so a Super admin): its id, which a signed-in account's groups are compared with.
    if (path.endsWith('/web/AssociatedOwnerGroup') && method === 'GET') return ok({ Id: ownerGroupId });
    // The site itself: the light read that proves a sign-in works (Prompt 19).
    if (/\/_api\/web$/.test(path) && method === 'GET') return ok({ Id: idOf(siteUrl) });
    // The site's lists (Phase 10c-3): what Setup's plan reads, and where Create makes a list or the library.
    if (/\/web\/lists$/.test(path)) return method === 'GET' ? ok({ results: siteTitles().map(siteEntry) }) : createList(request, headers, entry);
    if (list === LIBRARY_KEY && !entry.stray && !libraryPresent) return error(404, 'List does not exist. The page you selected contains a list that does not exist. It may have been deleted by another user.');
    if (list === LIBRARY_KEY && method === 'MERGE' && !path.includes('/RootFolder')) return changeList(title, request, headers);
    // The library's files (Phase 10f: "Seed sample clients" sends a sample picture only when no file of that name is there). The other copy's library is empty.
    if (list === LIBRARY_KEY && /\/RootFolder\/Files$/.test(path)) {
      const here = entry.stray ? [] : [...files.keys()].filter((key) => key.startsWith(`${libraryFolder}/`));
      return ok({ results: here.map((key) => ({ Name: key.slice(libraryFolder.length + 1), ServerRelativeUrl: key })) });
    }
    if (list === LIBRARY_KEY && path.includes('/RootFolder')) return ok({ ServerRelativeUrl: entry.stray ? `${sitePath}/${title}` : libraryFolder });
    // The library itself, asked for by its title (Setup's row for it): its id and where it is.
    if (list === LIBRARY_KEY) return ok({ Id: idOf(title), Title: title, RootFolder: { ServerRelativeUrl: entry.stray ? `${sitePath}/${title}` : libraryFolder } });
    // A list asked for by its address, not its title: `web/GetList('<server-relative address>')`. Whichever set it is in, it answers.
    const located = /\/web\/GetList\('((?:''|[^'])+)'\)$/.exec(path);
    if (located) {
      const wanted = located[1].replace(/''/g, "'");
      const found = [...titles.keys()].find((each) => addressOf(each) === wanted && (titles.get(each).own ? lists.has(titles.get(each).key) : otherLists.has(each)));
      return found ? ok(properties(found)) : error(404, 'File Not Found.');
    }
    const adding = /GetFolderByServerRelativeUrl\('([^']+)'\)\/Files\/add\(url='((?:''|[^'])+)',overwrite=(true|false)\)/.exec(path);
    if (adding) {
      if (headers['x-requestdigest'] !== 'digest-token') return error(403, 'The security validation for this page is invalid.');
      const [, folder, rawName, overwrite] = adding;
      const name = rawName.replace(/''/g, "'");
      if (folder !== libraryFolder || !libraryPresent) return error(404, 'File Not Found.');
      if (files.has(`${folder}/${name}`) && overwrite !== 'true') return error(400, `The file ${name} already exists.`);
      const bytes = request.bodyBuffer ? new Uint8Array(request.bodyBuffer) : new TextEncoder().encode(String(request.body ?? ''));
      files.set(`${folder}/${name}`, { bytes, type: headers['content-type'] ?? 'application/octet-stream' });
      return ok({ ServerRelativeUrl: `${folder}/${name}`, Name: name, Length: String(bytes.length) });
    }
    const recycling = /GetFileByServerRelativeUrl\('((?:''|[^'])+)'\)\/recycle\(\)/.exec(path);
    if (recycling) {
      if (headers['x-requestdigest'] !== 'digest-token') return error(403, 'The security validation for this page is invalid.');
      const target = recycling[1].replace(/''/g, "'");
      if (!files.has(target)) return error(404, 'File Not Found.');
      recycled.push({ path: target, ...files.get(target) });
      files.delete(target);
      return ok({ Recycle: crypto.randomUUID() });
    }
    if (!list) return error(404, 'Not found');
    // The test's own list, or the same list of the other set: it answers too, and the request is already marked as a stray.
    const rows = entry.stray ? otherLists.get(title) : titles.get(title)?.own ? lists.get(list) : undefined;
    if (!rows) return error(404, 'List does not exist');
    // (The other copy's list has the schema's columns even where the test's own list was left out: Phase 10c-3.)
    const columnsHere = fields.get(list) ?? fieldsFor(list);
    if (path.endsWith('/fields')) return ok({ results: columnsHere.map(fieldAsRead(url.searchParams.get('$select'))) });
    // One column, its creation from a definition, and a change to its settings (Phase 10c-3). Never on the other set's lists.
    if (/\/fields\/(createfieldasxml|getbyid\('[^']*'\)|getbyinternalnameortitle\('(?:''|[^'])+'\))$/.test(path)) {
      if (entry.stray && method !== 'GET') return error(400, 'The mock does not change the columns of the other copy\'s lists.');
      return fieldRequest(list, title, request, headers, entry);
    }
    if (!path.includes('/items') && method === 'MERGE') {
      if (entry.stray) return error(400, 'The mock does not change the settings of the other copy\'s lists.');
      return changeList(title, request, headers);
    }
    if (!path.includes('/items')) return ok(properties(title));

    if (method === 'GET') {
      const filter = url.searchParams.get('$filter');
      const unknown = filter && [...filter.matchAll(/(\w+) eq '/g)].map(([, column]) => column)
        .find((column) => !columnsHere.some((field) => field.InternalName === column));
      if (unknown) return error(400, `Column '${unknown}' does not exist. It may have been deleted by another user.`);
      const unindexed = filter && url.searchParams.get('$select') !== 'Id' && [...filter.matchAll(/(\w+) eq '/g)].map(([, column]) => column)
        .find((column) => !INDEXED[list]?.has(column));
      if (unindexed) {
        entry.unindexed = unindexed;
        UNINDEXED.push(entry);
        return error(400, `The query filters on ${unindexed}, which this list does not index. (The schema indexes exactly the columns the app filters on.)`);
      }
      // Which columns come back (Phase 10h; the top of the file).
      const select = url.searchParams.get('$select');
      const asked = select === null ? [] : select.split(',').map((name) => name.trim());
      let shown;
      if (select === null) {
        const probe = [...url.searchParams.keys()].join() === '$top' && url.searchParams.get('$top') === '1';
        if (strict && !probe) {
          entry.unnamed = true;
          UNNAMED.push(entry);
          return error(400, UNNAMED_REFUSAL);
        }
        shown = (row) => ({ ...leftOut(row), ID: row.Id });
      } else {
        const missing = asked.find((name) => !['Id', 'ID', 'Title'].includes(name) && !columnsHere.some((field) => field.InternalName === name));
        if (missing) return error(400, `The field or property '${missing}' does not exist.`);
        shown = (row) => ({ __metadata: row.__metadata, Id: row.Id, ID: row.Id, ...Object.fromEntries(asked.filter((name) => name !== 'ID' && name in row).map((name) => [name, row[name]])) });
      }
      const matches = rows.filter(matcher(filter));
      const top = Number(url.searchParams.get('$top')) || 100;
      const skip = Number(url.searchParams.get('$fakeskip')) || 0;
      const page = matches.slice(skip, skip + top);
      // (A column the site will not return by name: refused only when there is a row to return, as the real site did. Phase 10i.)
      const refused = page.length ? asked.find((name) => refusesByName.some((each) => each.toLowerCase() === name.toLowerCase())) : undefined;
      if (refused) {
        entry.refusedByName = refused;
        REFUSED_BY_NAME.push(entry);
        return error(400, REFUSED_WORDS);
      }
      const more = skip + top < matches.length;
      if (more) url.searchParams.set('$fakeskip', String(skip + top));
      return ok({ results: page.map(shown), ...(more ? { __next: url.href } : {}) });
    }

    if (headers['x-requestdigest'] !== 'digest-token') return error(403, 'The security validation for this page is invalid.');
    const itemId = Number(path.match(/items\((\d+)\)/)?.[1]);
    const { __metadata, ...changes } = request.body ? JSON.parse(request.body) : {};
    const known = new Set(['Title', ...columnsHere.map((field) => field.InternalName)]);
    const stray = Object.keys(changes).find((column) => !known.has(column));
    if (stray) return error(400, `The property '${stray}' does not exist on type '${typeOf(title)}'.`);

    if (method === 'MERGE' || method === 'DELETE') {
      if (method === 'MERGE' && hooks.beforeMerge) {
        const hook = hooks.beforeMerge;
        hooks.beforeMerge = null;
        hook(rows, entry);
      }
      const index = rows.findIndex((row) => row.Id === itemId);
      if (index === -1) return error(404, 'Item does not exist. It may have been deleted by another user.');
      if (!entry.ifMatch) return error(400, 'An If-Match header is required.');
      if (entry.ifMatch !== '*' && rows[index].__metadata.etag !== entry.ifMatch) return error(412, 'The request ETag value does not match the object\'s ETag value.');
      if (method === 'DELETE') rows.splice(index, 1);
      else {
        const rewrite = rewrites.find((candidate) => candidate.times > 0 && candidate.list === list && candidate.when(entry));
        if (rewrite) rewrite.times -= 1;
        const stored = rewrite ? rewrite.rewrite(changes, rows[index]) : changes;
        // (Nothing stored: the item is left exactly as it was, its version too.)
        if (Object.keys(stored).length) rows[index] = stamp(title, { ...rows[index], ...stored });
      }
      return reply(204, null);
    }

    if (hooks.beforeCreate) {
      const hook = hooks.beforeCreate;
      hooks.beforeCreate = null;
      hook(list, changes);
    }
    if (__metadata?.type !== typeOf(title)) return error(400, 'A type named in __metadata could not be resolved.');
    const appId = columnsHere.find((field) => field.InternalName === 'AppId');
    if (appId?.EnforceUniqueValues && rows.some((row) => row.AppId === changes.AppId)) {
      return error(duplicateStatus, DUPLICATE_WORDS, undefined, duplicateCode ? DUPLICATE_CODE : undefined);
    }
    const row = stamp(title, { Id: nextId++, ...changes });
    rows.push(row);
    // (The item a create returns is serialised as an unnamed read is: what that read leaves out, it is assumed to leave out too. Phase 10h.)
    return ok(leftOut(row), 201);
  }

  // ---- Building a site (Phase 10c-3) -------------------------------------------------------------------------------------------

  const parsed = (request) => { try { return JSON.parse(request.body ?? '') ?? {}; } catch { return null; } };
  const noDigest = () => error(403, 'The security validation for this page is invalid.');

  /** POST /web/lists: one of the test's own lists (template 100), or its picture library (101), made empty with SharePoint's defaults. */
  function createList(request, headers, entry) {
    if (headers['x-requestdigest'] !== 'digest-token') return noDigest();
    const body = parsed(request);
    if (body?.__metadata?.type !== 'SP.List') return error(400, 'A type named in __metadata could not be resolved.');
    const { __metadata, Title: title, BaseTemplate: template, AllowContentTypes, ContentTypesEnabled, ...rest } = body;
    const unknown = Object.keys(rest).find((property) => !LIST_SETTINGS.includes(property));
    if (unknown) return error(400, `The property '${unknown}' does not exist on type 'SP.List'.`);
    if (typeof title !== 'string' || !title) return error(400, 'A list must have a title.');
    if (siteTitles().some((each) => each.toLowerCase() === title.toLowerCase())) {
      return error(500, 'A list, survey, discussion board, or document library with the specified title already exists in this Web site.  Please choose another title.');
    }
    if (title === libraryTitle) {
      if (template !== 101) return error(400, `The mock makes "${title}" a document library (template 101), not template ${template}.`);
      libraryPresent = true;
    } else {
      const known = titles.get(title);
      if (!known?.own) return error(400, `The mock knows no list titled "${title}" on this site.`);
      if (template !== 100) return error(400, `The mock makes "${title}" a generic list (template 100), not template ${template}.`);
      lists.set(known.key, []);
      fields.set(known.key, [builtInTitle()]);
    }
    listSettings.set(title, { ...NEW_LIST, ...rest });
    entry.created = title;
    return ok(siteEntry(title), 201);
  }

  /** A MERGE on a list or the library: its attachments, content approval, version history or description, and nothing else. */
  function changeList(title, request, headers) {
    if (headers['x-requestdigest'] !== 'digest-token') return noDigest();
    const body = parsed(request);
    if (body?.__metadata?.type !== 'SP.List') return error(400, 'A type named in __metadata could not be resolved.');
    const { __metadata, ...changes } = body;
    const unknown = Object.keys(changes).find((property) => !LIST_SETTINGS.includes(property));
    if (unknown) return error(400, `The mock does not change '${unknown}' on a list.`);
    listSettings.set(title, { ...NEW_LIST, ...listSettings.get(title), ...changes });
    return reply(204, null);
  }

  /** Makes a column from its XML definition, as SharePoint does, with the traps the test asked for. */
  function createField(key, request) {
    const body = parsed(request);
    const info = body?.parameters;
    if (info?.__metadata?.type !== 'SP.XmlSchemaFieldCreationInformation') return error(400, 'A type named in __metadata could not be resolved.');
    const xml = String(info.SchemaXml ?? '');
    const tag = /^\s*<Field\b((?:\s+\w+="[^"]*")*)\s*(\/>|>[\s\S]*<\/Field>)\s*$/.exec(xml);
    if (!tag) return error(400, 'The field schema is not valid XML.');
    const attributes = Object.fromEntries([...tag[1].matchAll(/(\w+)="([^"]*)"/g)].map(([, name, value]) => [name, unescapeXml(value)]));
    const fallback = /<Default>([^<]*)<\/Default>/.exec(tag[2])?.[1];
    // With AddFieldInternalNameHint (8) SharePoint starts from the Name asked for; without it, from the display name.
    const wanted = Number(info.Options ?? 0) & 8 ? attributes.Name ?? attributes.StaticName : attributes.DisplayName && encodedName(attributes.DisplayName);
    if (!attributes.Type || !wanted) return error(400, 'A column needs a type and a name.');
    const columns = fields.get(key);
    const taken = (name) => columns.some((column) => column.InternalName === name) || (traps.taken ?? []).includes(`${key}.${name}`);
    let internal = wanted;
    for (let digit = 0; taken(internal); digit += 1) internal = `${wanted}${digit}`;
    const indexed = yes(attributes.Indexed);
    const unique = yes(attributes.EnforceUniqueValues);
    if (unique && indexed && traps.uniqueApart) return error(400, UNIQUE_APART);
    if (unique && !indexed && traps.uniqueNeedsIndex) return error(400, UNIQUE_NEEDS_INDEX);
    const type = attributes.Type;
    const richText = type === 'Note' && (traps.richText === 'always' || (attributes.RichText === undefined ? traps.richText === 'default' : yes(attributes.RichText)));
    const column = {
      Id: `00000000-0000-4000-8000-${String(nextFieldId++).padStart(12, '0')}`, InternalName: internal, StaticName: internal, Title: attributes.DisplayName ?? internal,
      TypeAsString: type, Indexed: indexed, EnforceUniqueValues: unique, Required: yes(attributes.Required), ReadOnlyField: false, Hidden: false, FromBaseType: false,
      RichText: richText, AppendOnly: yes(attributes.AppendOnly), DefaultValue: fallback ?? null,
      ...(type === 'Text' ? { MaxLength: Number(attributes.MaxLength ?? 255) } : {}),
      // (A date column made without a format shows the date only: SharePoint's default.)
      ...(type === 'DateTime' ? { DisplayFormat: attributes.Format === 'DateTime' ? 1 : 0 } : {}),
    };
    columns.push(column);
    return ok(column, 201);
  }

  /** A column of the list `key`: made from a definition, read by its id or name, or changed (an index, uniqueness or required, never its type). */
  function fieldRequest(key, title, request, headers, entry) {
    const { method, path } = entry;
    if (method !== 'GET' && headers['x-requestdigest'] !== 'digest-token') return noDigest();
    if (/\/createfieldasxml$/.test(path)) return method === 'POST' ? createField(key, request) : error(405, 'createfieldasxml only accepts POST.');
    const id = /\/getbyid\('([^']*)'\)$/.exec(path)?.[1];
    const name = entry.field;
    const columns = fields.get(key) ?? fieldsFor(key);
    const column = id ? columns.find((each) => each.Id === id) : columns.find((each) => each.InternalName === name) ?? columns.find((each) => each.Title === name);
    if (!column) return error(404, `Column '${id ?? name}' does not exist. It may have been deleted by another user.`);
    if (method === 'GET') return ok(column);
    if (method !== 'MERGE') return error(405, 'The mock only reads a column or changes its settings.');
    const body = parsed(request);
    const { __metadata, ...changes } = body ?? {};
    const unknown = Object.keys(changes).find((property) => !FIELD_SETTINGS.includes(property));
    if (unknown) return error(400, `The mock does not change '${unknown}' on a column: Setup only adds an index or uniqueness.`);
    if (changes.EnforceUniqueValues === true && changes.Indexed === true && traps.uniqueApart) return error(400, UNIQUE_APART);
    if (changes.EnforceUniqueValues === true && !(changes.Indexed ?? column.Indexed) && traps.uniqueNeedsIndex) return error(400, UNIQUE_NEEDS_INDEX);
    Object.assign(column, changes);
    entry.field = column.InternalName;
    return reply(204, null);
  }

  /** A `fetch` that answers from the fake. */
  async function fetchLike(url, options = {}) {
    const binary = typeof Blob !== 'undefined' && options.body instanceof Blob;
    const result = await handle({
      method: options.method ?? 'GET', url: String(url), headers: options.headers ?? {},
      body: binary ? null : options.body ?? null, bodyBuffer: binary ? Buffer.from(await options.body.arrayBuffer()) : undefined,
    });
    return new Response(result.status === 204 ? null : result.body, { status: result.status, headers: result.headers });
  }

  const select = (filter) => {
    if (filter && typeof filter === 'object' && 'list' in filter && filter.list !== null) knownKey(filter.list);
    return typeof filter === 'function' ? requests.filter(filter)
      : filter ? requests.filter((entry) => Object.entries(filter).every(([key, value]) => entry[key] === value)) : requests;
  };

  if (schemaVersion !== null && lists.has('appsettings')) {
    lists.get('appsettings').push(stamp(titleOf('appsettings'), { Id: 100_000, AppId: 'default', Title: 'default', SchemaVersion: schemaVersion }));
    // (The other copy's lists are a provisioned site too: a page sent to them by mistake reads and works, which is the failure to see.)
    for (const [title, entry] of titles) {
      if (entry.key === 'appsettings' && !entry.own) otherLists.get(title)?.push(stamp(title, { Id: 100_000, AppId: 'default', Title: 'default', SchemaVersion: schemaVersion }));
    }
  }

  return {
    siteUrl,
    /** What to configure the data layer with: `dataService.configure({ sharePoint: fake.settings })`. */
    settings,
    /** The prefix of the test's own lists ('' for the plain set). */
    prefix,
    lists,
    /** The lists that are NOT the test's own, by the title a request names. Every one stays empty unless a request went astray. */
    otherLists,
    /** The requests that reached a list of the other set (also in `requests`, with `stray: true`). */
    strays,
    /** The title one of the test's own lists has on the site, by key: `fake.titleOf('clients')` is `PMS3Clients` with that prefix. */
    titleOf,
    fields,
    requests,
    hooks,
    files,
    recycled,
    /** The title of the test's own picture library. */
    libraryTitle,
    /** The server-relative address of the test's own picture library. */
    libraryFolder,
    /** A file in the library by its server-relative path (what a browser asks for when it shows a picture), or undefined. */
    file: (serverRelativePath) => files.get(serverRelativePath),
    add,
    handle,
    fetch: fetchLike,
    /** Requests so far; with a filter (a predicate, or `{ method, list }`), those that match. */
    count: (filter) => select(filter).length,
    select,
    reset() { requests.length = 0; },
    /** Queues a fault for the next `times` requests that `when(entry)` accepts. */
    failNext({ status, retryAfter, times = 1, when = () => true, message }) { faults.push({ status, retryAfter, times, when, message }); },
    /** Queues a write that is answered as done and stored differently (see the top of the file). `list` is a key. */
    rewriteMerges({ list, times = Infinity, when = () => true, rewrite = () => ({}) }) { rewrites.push({ list: knownKey(list), times, when, rewrite }); },
    clearFaults() { faults.length = 0; rewrites.length = 0; writeFaults.length = 0; },
    /** Refuses every write `when(entry)` accepts as SharePoint refuses an account without the permission: 403, "Access denied" (Phase 10c-3). */
    forbid(when = () => true) { faults.push({ status: 403, times: Infinity, when: (entry) => isWrite(entry) && when(entry), message: ACCESS_DENIED }); },
    /** Fails the at-th write from now (1 is the next one) with `status` (500): a run that stops part-way (Phase 10c-3). */
    failWrite({ at = 1, status = 500, message = 'Something went wrong. (an injected failure)' } = {}) { writeFaults.push({ at: writesSeen + at, status, message }); },
    /** Every write of the log: no read, no write token, no $batch of reads. */
    writes: () => requests.filter(isWrite),
    /** From now on every /_api request is refused as a sign-in SharePoint no longer accepts: 403, ACCESS_DENIED, SESSION_REFUSED_CODE (Prompt 19). */
    expireSession() { sessionExpired = true; },
    /** The sign-in is good again (what a page navigation does on the real site, ASSUMED). */
    renewSession() { sessionExpired = false; },
    get sessionExpired() { return sessionExpired; },
    /** A list's settings as SharePoint reports them (attachments, content approval, version history, description), by key; the library's by `logoLibrary`. */
    listSettings: (key) => {
      const title = knownKey(key) === LIBRARY_KEY ? libraryTitle : titleOf(key);
      return siteTitles().includes(title) ? (({ EnableAttachments, EnableModeration, EnableVersioning, Description }) => ({ EnableAttachments, EnableModeration, EnableVersioning, Description }))(siteEntry(title)) : undefined;
    },
    /** One column of one of the test's own lists (by key and internal name), to look at or to change by hand; undefined when it is not there. */
    field: (key, name) => fields.get(knownKey(key))?.find((column) => column.InternalName === name),
    /** Whether the test's own picture library exists. */
    get libraryPresent() { return libraryPresent; },
    /** Node only: routes globalThis.fetch to the fake. Returns the function that puts the real one back. */
    install() {
      const original = globalThis.fetch;
      globalThis.fetch = fetchLike;
      return () => { globalThis.fetch = original; };
    },
    /** The stored item with this AppId in one of the test's own lists (by key), or undefined. */
    item: (list, appId) => lists.get(knownKey(list))?.find((row) => row.AppId === appId),
    /**
     * Phase 20: takes columns ('key.Column') off the test's own lists, and their values off every item, as if the site had never had them: a
     * site an older Setup made, holding the records a test wrote there first with this build's data layer (which names every column it reads).
     * @param {string[]} names
     */
    dropColumns(names) {
      for (const name of names) {
        const [key, column] = name.split('.');
        fields.set(knownKey(key), (fields.get(knownKey(key)) ?? []).filter((field) => field.InternalName !== column));
        for (const row of lists.get(knownKey(key)) ?? []) delete row[column];
      }
    },
    /**
     * The whole site as plain data (Phase 12, the local site's persistence): the test's own lists, their columns and settings, the library's
     * files (base64) and the counters, so `importState` on a fake made with the same options puts it back exactly, ids and versions included.
     */
    exportState: () => ({
      lists: Object.fromEntries(lists), fields: Object.fromEntries(fields), listSettings: Object.fromEntries(listSettings), libraryPresent,
      files: [...files].map(([key, { bytes, type }]) => [key, { type, base64: Buffer.from(bytes).toString('base64') }]),
      counters: { nextId, version, nextFieldId },
    }),
    /** Replaces the site with what `exportState` gave. */
    importState(state) {
      lists.clear();
      for (const [key, rows] of Object.entries(state.lists)) lists.set(knownKey(key), rows);
      fields.clear();
      for (const [key, columns] of Object.entries(state.fields)) fields.set(knownKey(key), columns);
      listSettings.clear();
      for (const [title, value] of Object.entries(state.listSettings ?? {})) listSettings.set(title, value);
      libraryPresent = Boolean(state.libraryPresent);
      files.clear();
      for (const [key, { type, base64 }] of state.files ?? []) files.set(key, { type, bytes: new Uint8Array(Buffer.from(base64, 'base64')) });
      ({ nextId, version, nextFieldId } = state.counters);
    },
  };
}
