// Phase 10c-3: Setup prepares a site for the app (migration/src/lib/setup/provision.js). Run: node --test scripts/test-provision.js (part of `npm test`).
//
// Part B, the plan: read only, and the same answer every time. It is worked out from one read of the site's lists and one read of each existing
// list's columns, through the data layer (dataService.probeSharePointRead), against the mocked SharePoint REST (scripts/sharepoint-fake.js).
// What it does not hold is what the real site answers to those reads: QA-TESTING.md lists what the tenant has to show.
//
// Part C, Create: it only ever adds. It carries out exactly the plan it is handed, in four steps (the lists, then the columns, then indexes and
// uniqueness, then the lists' settings), paced with dataService.runPaced, every write through dataService.sendToSharePoint; it reads back each column
// it makes and stops at once, naming it, when SharePoint made something else; a 403 stops it with words a person can act on and the list of what
// was made; a run stopped part-way is finished by running it again. The request log is the proof, with every trap of ARCHITECTURE-10.md 6.3 (in git history at 7347c72) the
// fake can spring turned on.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ID, LISTS, VERSION } from '../migration/src/lib/schema/pms-schema.js';
import { META, columnsOf } from '../migration/src/lib/schema/pms-schema-meta.js';
import { BUSY_LISTS, MADE_BY, SETTINGS_PENDING, create, definition, makePlan, planLines, readSite, showPlan, siteApi } from '../migration/src/lib/setup/provision.js';
import { ACCESS_DENIED, ALL_TRAPS, STRAYS, TITLE, UNINDEXED, createSharePointFake } from './sharepoint-fake.js';

/** Every list of the schema and the picture library, by key: `without` all of them is a site with nothing of the app on it. */
const EVERYTHING = [...Object.keys(LISTS), 'logoLibrary'];
const KEYS = Object.keys(LISTS);

let pages = 0;
/** Every MERGE body Create handed the data layer in this suite: of a column (`fields`) and of a list (`lists`). */
const changes = { fields: [], lists: [], get length() { return this.fields.length + this.lists.length; } };
/** A data layer of its own (one module is one page), pointed at a fake site set up with `options`. `sent` is what Create handed it to write. */
async function siteWith(options = {}) {
  const fake = createSharePointFake({ schemaVersion: null, ...options });
  fake.install();
  const ds = await import(`../migration/src/lib/data/dataService.js?provision=${pages += 1}`);
  ds.configure({ sharePoint: fake.settings });
  const api = siteApi(ds);
  const sent = [];
  const write = api.write;
  api.write = (method, resource, body, headers) => {
    sent.push({ method, resource, body });
    if (method === 'MERGE') (/\/fields\//.test(resource) ? changes.fields : changes.lists).push(body);
    return write(method, resource, body, headers);
  };
  return { fake, ds, api, sent, titles: ds.sharePointListTitles() };
}
const plan = async ({ api, titles }, options) => (await showPlan(api, titles, options)).plan;
const lists = (fake) => fake.requests.map((entry) => entry.title ?? entry.path.replace(/^.*\/_api/, ''));

describe('Show the plan: a site with nothing on it', () => {
  it('plans every list of the schema, the picture library, every column of META and every setting, from ONE read, and writes nothing', async () => {
    const site = await siteWith({ without: EVERYTHING });
    const { plan: made, site: read } = await showPlan(site.api, site.titles);
    assert.equal(read.reads, 1, 'one read of the site\'s lists, and no list to read the columns of');
    assert.equal(site.fake.count(), 1);
    assert.equal(site.fake.writes().length, 0);
    assert.deepEqual(made.lists.map((item) => [item.title, item.template]), [...KEYS.map((key) => [site.titles[key], 100]), [site.titles.logoLibrary, 101]]);
    for (const key of KEYS) {
      assert.deepEqual(made.columns.filter((item) => item.key === key).map((item) => item.name), columnsOf(key).map((column) => column.name).filter((name) => name !== 'Title'),
        `${key}: every column of META, in its order, but SharePoint's own Title (the activities' title is that column, and every list is made with it)`);
    }
    assert.equal(made.columns.length, 125); // (89 until Phase 20 added PMSActivities.Kind and PMSClientSessions.ConfidenceCheck; 91 until Prompt 21 added the three access lists' 28 and the settings' 2; 121 until its Phase 3 added a session's StartTime, Sequence, Period and PlannedDate, its title being the built-in Title)
    const settings = (kind) => made.settings.filter((item) => item.kind === kind).map((item) => `${item.key}.${item.column ?? ''}`);
    assert.deepEqual(settings('index'), KEYS.flatMap((key) => columnsOf(key).filter((column) => column.indexed).map((column) => `${key}.${column.name}`)));
    assert.equal(settings('index').length, 27, 'AppId on fifteen lists and the twelve columns the app filters on (23 until Prompt 21: its three lists\' AppId and UserKey)');
    assert.deepEqual(settings('unique'), KEYS.map((key) => `${key}.${ID}`));
    assert.deepEqual(settings('list'), KEYS.map((key) => `${key}.`));
    assert.ok(made.settings.filter((item) => item.kind === 'list').every((item) => JSON.stringify(item.changes) === '{"EnableAttachments":false,"EnableModeration":false}'), 'attachments off and content approval off; version history left as it is');
    assert.deepEqual(made.untouched, []);
    assert.equal(made.summary, '16 lists, 125 columns, 57 settings to create'); // (13, 91 and 47 until Prompt 21; 121 columns until its Phase 3)
  });

  it('each column is defined as META says: its internal name three times, its type, required for AppId alone, plain text, Date & Time, a Yes/No that starts as No', () => {
    const lines = KEYS.flatMap((key) => columnsOf(key).map((column) => definition(column)));
    assert.equal(definition(columnsOf('clients')[0]), '<Field Type="Text" Name="AppId" StaticName="AppId" DisplayName="AppId" Required="TRUE" MaxLength="255" />');
    assert.equal(definition(columnsOf('clients').find((column) => column.name === 'ThemeJson')), '<Field Type="Note" Name="ThemeJson" StaticName="ThemeJson" DisplayName="ThemeJson" Required="FALSE" RichText="FALSE" AppendOnly="FALSE" NumLines="6" />');
    assert.equal(definition(columnsOf('sessions').find((column) => column.name === 'SessionDate')), '<Field Type="DateTime" Name="SessionDate" StaticName="SessionDate" DisplayName="SessionDate" Required="FALSE" Format="DateTime" />');
    assert.equal(definition(columnsOf('sections').find((column) => column.name === 'Enabled')), '<Field Type="Boolean" Name="Enabled" StaticName="Enabled" DisplayName="Enabled" Required="FALSE"><Default>0</Default></Field>');
    assert.equal(definition(columnsOf('sections').find((column) => column.name === 'SortOrder')), '<Field Type="Number" Name="SortOrder" StaticName="SortOrder" DisplayName="SortOrder" Required="FALSE" />');
    assert.equal(lines.filter((line) => line.includes('Required="TRUE"')).length, 15, 'AppId of each list, and nothing else');
    assert.ok(lines.every((line) => !/Indexed|EnforceUniqueValues/.test(line)), 'no index and no uniqueness in a definition: they are later steps');
    assert.equal(lines.filter((line) => line.includes('Format="DateTime"')).length, 16); // (11 until Prompt 21: PeriodFrom, PeriodTo, ValidUntil, OccurredAt; 15 until its Phase 3: PlannedDate)
    assert.equal(lines.filter((line) => line.includes('<Default>0</Default>')).length, 5); // (ConfidenceCheck: Phase 20)
    assert.equal(lines.filter((line) => line.includes('RichText="FALSE" AppendOnly="FALSE"')).length, 8);
  });

});

describe('Show the plan: a complete site, and one with something missing', () => {
  it('a complete site plans nothing and reports nothing: one read of its lists, one of each list\'s columns', async () => {
    const site = await siteWith({ schemaVersion: VERSION });
    const { plan: made, site: read } = await showPlan(site.api, site.titles);
    assert.equal(made.summary, 'Nothing to create');
    assert.equal(made.empty, true);
    assert.deepEqual([made.lists, made.columns, made.settings, made.untouched], [[], [], [], []]);
    assert.equal(read.reads, 16); // (13 until Prompt 21)
    assert.deepEqual(site.fake.requests.map((entry) => entry.method), Array(16).fill('GET'));
    assert.deepEqual(planLines(made), ['Nothing to create']);
  });

  it('a site missing three columns and one list: exactly those, with their indexes and the new list\'s settings', async () => {
    const site = await siteWith({ without: ['clients.Slug', 'sections.ClientId', 'responses.TrackId', 'uservisitlogs'] });
    const made = await plan(site);
    assert.deepEqual(made.lists.map((item) => item.key), ['uservisitlogs']);
    assert.deepEqual(made.columns.map((item) => `${item.key}.${item.name}`), [
      'clients.Slug', 'sections.ClientId', ...columnsOf('uservisitlogs').map((column) => `uservisitlogs.${column.name}`), 'responses.TrackId',
    ]);
    assert.deepEqual(made.settings.map((item) => `${item.kind} ${item.key}.${item.column ?? ''}`), [
      'index sections.ClientId', 'index uservisitlogs.AppId', 'index uservisitlogs.SessionId', 'unique uservisitlogs.AppId', 'list uservisitlogs.', 'index responses.TrackId',
    ]);
    assert.deepEqual(made.untouched, []);
    assert.equal(made.summary, '1 list, 14 columns, 6 settings to create');
    assert.equal(site.fake.writes().length, 0);
    assert.deepEqual(planLines(made), [
      `${site.titles.clients} (exists)`, '  Create 1 column: Slug.',
      `${site.titles.sections} (exists)`, '  Create 1 column: ClientId.', '  Index ClientId.',
      `${site.titles.uservisitlogs} (new)`, `  Create the list ${site.titles.uservisitlogs}.`,
      `  Create 11 columns: ${columnsOf('uservisitlogs').map((column) => column.name).join(', ')}.`,
      '  Index AppId.', '  Index SessionId.', '  Enforce unique values on AppId (after its index).', '  Turn attachments off, content approval off.',
      `${site.titles.responses} (exists)`, '  Create 1 column: TrackId.', '  Index TrackId.',
      '1 list, 14 columns, 6 settings to create',
    ]);
  });

  it('an existing column with no index, and AppId without uniqueness, are settings to add; the list made by hand is given no list settings', async () => {
    const site = await siteWith();
    site.fake.field('tracks', 'SessionId').Indexed = false;
    Object.assign(site.fake.field('adminusers', ID), { Indexed: false, EnforceUniqueValues: false });
    const made = await plan(site);
    assert.deepEqual(made.settings.map((item) => `${item.kind} ${item.key}.${item.column}`), ['index tracks.SessionId', 'index adminusers.AppId', 'unique adminusers.AppId']);
    assert.equal(made.summary, '0 lists, 0 columns, 3 settings to create');
  });

  it('the picture library alone missing: the library is planned (template 101), nothing else', async () => {
    const made = await plan(await siteWith({ without: ['logoLibrary'] }));
    assert.deepEqual(made.lists.map((item) => [item.key, item.template]), [['logoLibrary', 101]]);
    assert.equal(made.summary, '1 list, 0 columns, 0 settings to create');
  });
});

describe('Show the plan: what it finds and will not touch', () => {
  it('a column of the wrong type and a several-lines column in rich text are reported, with their fixes, and planned for nothing', async () => {
    const site = await siteWith();
    site.fake.field('sections', 'SortOrder').TypeAsString = 'Text';
    site.fake.field('clients', 'ThemeJson').RichText = true;
    const made = await plan(site);
    assert.equal(made.summary, 'Nothing to create');
    assert.equal(made.toFix, 2);
    assert.deepEqual(made.untouched.map((item) => [item.key, item.column, item.harmless]), [['clients', 'ThemeJson', false], ['sections', 'SortOrder', false]]);
    assert.match(made.untouched[0].found, /ThemeJson is rich text; the app keeps plain text in it\./);
    assert.match(made.untouched[0].fix, /choose Plain text/);
    assert.match(made.untouched[1].found, /SortOrder is of type Text; the app needs Number\./);
    assert.match(made.untouched[1].fix, /A column's type is not changed here/);
    assert.equal(site.fake.writes().length, 0);
  });

  it('a column whose internal name differs (Session_x0020_Id, SortOrder0) is reported, and the right one is not planned beside it', async () => {
    const site = await siteWith({ without: ['tracks.SessionId', 'questions.SortOrder'] });
    site.fake.fields.get('tracks').push({ InternalName: 'Session_x0020_Id', Title: 'Session Id', TypeAsString: 'Text', Indexed: false, EnforceUniqueValues: false, Required: false, ReadOnlyField: false, Hidden: false, FromBaseType: false });
    site.fake.fields.get('questions').push({ InternalName: 'SortOrder0', Title: 'SortOrder', TypeAsString: 'Number', Indexed: false, EnforceUniqueValues: false, Required: false, ReadOnlyField: false, Hidden: false, FromBaseType: false });
    const made = await plan(site);
    assert.deepEqual(made.columns, []);
    assert.deepEqual(made.settings, [], 'and no index for a column it does not make');
    assert.deepEqual(made.untouched.map((item) => item.found), [
      'A column called "SortOrder" has the internal name SortOrder0; the app looks for SortOrder.',
      'A column called "Session Id" has the internal name Session_x0020_Id; the app looks for SessionId.',
    ]);
    assert.match(made.untouched[1].fix, /internal name is fixed when it is made\. Delete "Session Id" \(on a new list it holds nothing\), then press Show the plan again: Create will make SessionId/);
  });

  it('a required column the app does not know, AppId not required, another column required, a date that shows the date only, and a harmless index', async () => {
    const site = await siteWith();
    site.fake.fields.get('clients').push({ InternalName: 'Owner', Title: 'Owner', TypeAsString: 'Text', Required: true, ReadOnlyField: false, Hidden: false, FromBaseType: false });
    site.fake.field('adminusers', ID).Required = false;
    site.fake.field('adminusers', 'Name').Required = true;
    site.fake.field('tracks', 'CreatedAt').DisplayFormat = 0;
    site.fake.field('questions', 'SectionId').Indexed = true;
    const made = await plan(site);
    assert.equal(made.summary, 'Nothing to create');
    assert.deepEqual(made.untouched.map((item) => [item.key, item.column, item.harmless]), [
      ['clients', 'Owner', false], ['questions', 'SectionId', true], ['tracks', 'CreatedAt', false], ['adminusers', ID, false], ['adminusers', 'Name', false],
    ]);
    assert.equal(made.toFix, 4, 'the index is harmless, and said so');
    assert.match(made.untouched[1].fix, /^Harmless/);
    assert.match(made.untouched[2].fix, /Date & Time/);
    assert.match(made.untouched[0].found, /required column the app does not know/);
  });

  it('a list where the library should be, and a library where a list should be, are reported and not planned', async () => {
    const site = await siteWith({ without: ['logoLibrary'] });
    // (Made through the fake's own REST, as a person would have made them by hand.)
    const write = { method: 'POST', headers: { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose', 'X-RequestDigest': 'digest-token' } };
    const other = await siteWith({ without: ['logoLibrary', 'adminusers'] });
    await other.fake.fetch(`${other.fake.siteUrl}/_api/web/lists`, { ...write, body: JSON.stringify({ __metadata: { type: 'SP.List' }, BaseTemplate: 101, Title: other.titles.logoLibrary }) });
    assert.equal(site.fake.libraryPresent, false);
    const made = await plan(other);
    assert.deepEqual(made.lists.map((item) => item.key), ['adminusers']);
    const wrong = makePlan({ lists: new Map([[other.titles.logoLibrary.toLowerCase(), { Title: other.titles.logoLibrary, BaseTemplate: 100 }], [other.titles.clients.toLowerCase(), { Title: other.titles.clients, BaseTemplate: 101 }]]), fields: new Map() }, other.titles);
    assert.match(wrong.untouched.find((item) => item.key === 'clients').found, /is a document library, not a list/);
    assert.match(wrong.untouched.find((item) => item.key === 'logoLibrary').found, /is a list, not a document library/);
    assert.ok(!wrong.lists.some((item) => ['clients', 'logoLibrary'].includes(item.key)));
  });
});

describe('Show the plan: the same answer every time, and the choices', () => {
  it('two plans of the same site are the same, and a plan made again from the same reads sends nothing', async () => {
    const site = await siteWith({ without: ['clients.Slug', 'uservisitlogs'] });
    const first = await showPlan(site.api, site.titles);
    const second = await showPlan(site.api, site.titles);
    assert.deepEqual(second.plan, first.plan);
    const before = site.fake.count();
    assert.deepEqual(makePlan(first.site, site.titles), first.plan);
    assert.equal(site.fake.count(), before);
  });

  it('version history: off on the four busy lists only when the deployer ticks it, and only on lists Setup makes', async () => {
    const site = await siteWith({ without: EVERYTHING });
    const read = await readSite(site.api.read, site.titles);
    const off = makePlan(read, site.titles, { versioning: true });
    assert.deepEqual(off.settings.filter((item) => item.changes.EnableVersioning === false).map((item) => item.key), ['tracks', 'qrtokens', 'uservisitlogs', 'responses']);
    assert.deepEqual(BUSY_LISTS.map((key) => TITLE[key]), ['PMSParticipants', 'PMSParticipantAnswers', 'PMSGuestQRCodes', 'PMSVisitLog'], 'the four lists the brief names');
    assert.match(off.settings.find((item) => item.key === 'tracks' && item.kind === 'list').words, /Turn attachments off, content approval off, version history off\./);
    assert.ok(makePlan(read, site.titles).settings.every((item) => !('EnableVersioning' in (item.changes ?? {}))), 'unticked by default');
    const complete = await siteWith();
    assert.equal(makePlan(await readSite(complete.api.read, complete.titles), complete.titles, { versioning: true }).summary, 'Nothing to create', 'a list made by hand is never given it');
  });

  it('a list Setup made whose settings a stopped run never made is given them by the next plan; one made by hand is not', async () => {
    const site = await siteWith();
    const read = await readSite(site.api.read, site.titles);
    read.lists.get(site.titles.tracks.toLowerCase()).Description = `${META.tracks.purpose} ${SETTINGS_PENDING}`;
    const made = makePlan(read, site.titles, { versioning: true });
    assert.deepEqual(made.settings.map((item) => [item.kind, item.key, item.changes]), [['list', 'tracks', { EnableAttachments: false, EnableModeration: false, EnableVersioning: false }]]);
  });
});

// ---- Part C: Create -----------------------------------------------------------------------------------------------------------------

/** What a site holds that Create could have made: every list's columns as SharePoint describes them, its settings, and the library. */
function stateOf(fake) {
  const shape = (field) => [field.InternalName, field.TypeAsString, field.Indexed, field.EnforceUniqueValues, field.Required, field.RichText, field.AppendOnly, field.DisplayFormat ?? null, field.DefaultValue ?? null].join(' ');
  return {
    lists: Object.fromEntries(KEYS.filter((key) => fake.lists.has(key)).map((key) => [key, { columns: fake.fields.get(key).map(shape).sort(), settings: fake.listSettings(key) }])),
    library: fake.libraryPresent,
  };
}
/**
 * Create carried out for the plan of the site as it is now, with the progress lines it gave. Without the pause between one lane's writes that
 * SharePoint gets (120 ms), unless a test asks for it (`gapMs: null`): the first test of Create measures a whole site at the real pace.
 */
async function createNow(site, options = {}) {
  const made = await plan(site, options);
  const progress = [];
  const result = await create(site.api, made, { onProgress: (line) => progress.push(line), gapMs: 0, ...options });
  return { made, result, progress };
}
/** The writes of the log as `METHOD what`: the list it made, the column it made or changed, or the list whose settings it changed. */
const writes = (fake) => fake.writes().map((entry) => {
  if (entry.path.endsWith('/web/lists')) return `create list ${entry.list}`;
  if (entry.path.endsWith('/createfieldasxml')) return `create column ${entry.list}.${entry.field}`;
  if (/\/fields\//.test(entry.path)) return `change column ${entry.list}.${entry.field}`;
  return `${entry.method === 'MERGE' ? 'change list' : `${entry.method} item`} ${entry.list}`;
});

describe('Create: a site with nothing on it', () => {
  it('makes every list, the library, every column, index, uniqueness and setting, in four steps, with every trap on, and the next plan is "Nothing to create"', async () => {
    const site = await siteWith({ without: EVERYTHING, traps: ALL_TRAPS });
    const { made, result, progress } = await createNow(site, { gapMs: null });
    assert.equal(result.ok, true, result.failure?.words);
    console.log(`  a whole site on the mocked SharePoint, at the real pace (3 lists at a time, 120 ms between one lane's writes): ${result.writes} writes and ${site.fake.count()} requests in ${(result.ms / 1000).toFixed(1)} s`);
    assert.deepEqual([result.done.lists.length, result.done.columns.length, result.done.settings.length], [16, 125, 57]);
    assert.equal(result.writes, 198, '16 lists, 125 columns, 57 settings: one write each (151 until Prompt 21; 194 until its Phase 3)');
    const log = writes(site.fake);
    assert.equal(log.length, 198); // (149 until Phase 20; 151 until Prompt 21; 194 until its Phase 3)
    const last = (prefix) => log.findLastIndex((line) => line.startsWith(prefix));
    const first = (prefix) => log.findIndex((line) => line.startsWith(prefix));
    assert.ok(last('create list') < first('create column'), 'the lists first');
    assert.ok(last('create column') < first('change column'), 'then the columns');
    assert.ok(last('change column') < first('change list'), 'then indexes and uniqueness, then the lists\' settings');
    for (const key of KEYS) {
      const appId = log.filter((line) => line === `change column ${key}.${ID}`);
      assert.equal(appId.length, 2, `${key}.AppId: its index, then its uniqueness, in two steps`);
    }
    assert.equal(site.fake.count((entry) => entry.method === 'GET' && /\/fields\/getbyid\(/.test(entry.path)), 125, 'each column read back once');
    assert.ok(site.fake.requests.every((entry) => ['GET', 'POST', 'MERGE'].includes(entry.method)), 'no DELETE, ever');
    assert.ok(progress.includes(`Creating ${site.titles.sections}: 4 of 8 columns...`), progress.join('\n')); // (of 7 until Phase 20 added Kind)
    assert.equal(progress.at(-1), result.summary);
    assert.match(result.summary, /^Created 16 lists, 125 columns and 57 settings in [\d.]+ s \(198 writes\)\.$/);
    assert.deepEqual(made.untouched, []);
    for (const key of KEYS) assert.deepEqual(site.fake.listSettings(key), { EnableAttachments: false, EnableModeration: false, EnableVersioning: true, Description: `${META[key].purpose} ${MADE_BY}` });
    assert.equal(site.fake.libraryPresent, true);
    const again = await plan(site);
    assert.equal(again.summary, 'Nothing to create');
    assert.deepEqual(again.untouched, [], 'and nothing to fix: SharePoint\'s own Title, required as it makes it, is not reported');
  });

  it('a second run plans nothing and sends no write', async () => {
    const site = await siteWith({ without: EVERYTHING });
    await createNow(site);
    site.fake.reset();
    const { made, result } = await createNow(site);
    assert.equal(made.summary, 'Nothing to create');
    assert.equal(result.writes, 0);
    assert.equal(site.fake.writes().length, 0);
    assert.equal(result.summary, 'Nothing to create: nothing was written.');
  });

  it('version history goes off on the four busy lists only when the deployer ticks it; unticked, every list keeps SharePoint\'s default', async () => {
    const ticked = await siteWith({ without: EVERYTHING });
    await createNow(ticked, { versioning: true });
    assert.deepEqual(KEYS.filter((key) => ticked.fake.listSettings(key).EnableVersioning === false), ['tracks', 'qrtokens', 'uservisitlogs', 'responses']);
    const unticked = await siteWith({ without: EVERYTHING });
    await createNow(unticked);
    assert.deepEqual(KEYS.filter((key) => unticked.fake.listSettings(key).EnableVersioning === false), []);
    const handMade = await siteWith();
    const { result } = await createNow(handMade, { versioning: true });
    assert.equal(result.writes, 0, 'a list made by hand is never given it');
  });

});

describe('Create: a site with something there already', () => {
  it('a site missing three columns and one list: exactly those are made, with their indexes and the new list\'s settings, and nothing else is sent a write', async () => {
    const site = await siteWith({ without: ['clients.Slug', 'sections.ClientId', 'responses.TrackId', 'uservisitlogs'], traps: ALL_TRAPS });
    const { result } = await createNow(site);
    assert.equal(result.ok, true, result.failure?.words);
    // (Three lists at a time: the order between lists is not fixed, the order of the four steps and of each list's own writes is.)
    const log = writes(site.fake);
    const STEPS = ['create list', 'create column', 'change column', 'change list'];
    const step = (line) => STEPS.findIndex((each) => line.startsWith(each));
    assert.deepEqual(log.map(step), [...log.map(step)].sort(), 'the four steps in order');
    assert.deepEqual([...log].sort(), [
      'create list uservisitlogs',
      'create column clients.Slug', 'create column sections.ClientId',
      ...columnsOf('uservisitlogs').map((column) => `create column uservisitlogs.${column.name}`), 'create column responses.TrackId',
      'change column sections.ClientId', 'change column uservisitlogs.AppId', 'change column uservisitlogs.SessionId', 'change column uservisitlogs.AppId', 'change column responses.TrackId',
      'change list uservisitlogs',
    ].sort());
    assert.deepEqual(log.filter((line) => line.startsWith('create column uservisitlogs.')), columnsOf('uservisitlogs').map((column) => `create column uservisitlogs.${column.name}`), 'a list\'s own columns in their order');
    assert.deepEqual(site.sent.filter(({ resource }) => resource.includes(`'${site.titles.uservisitlogs}'`) && resource.includes('/fields/getbyinternalnameortitle')).map(({ resource, body }) => `${resource.match(/\('(\w+)'\)$/)[1]} ${Object.keys(body)[1]}`),
      ['AppId Indexed', 'SessionId Indexed', 'AppId EnforceUniqueValues'], 'its indexes, then its uniqueness');
    assert.match(result.summary, /^Created 1 list, 14 columns and 6 settings in/);
    assert.equal((await plan(site)).summary, 'Nothing to create');
  });

  it('a column of the wrong type and a rich-text column are reported, and the log shows nothing sent to them', async () => {
    const site = await siteWith({ without: ['clients.Slug'] });
    site.fake.field('sections', 'SortOrder').TypeAsString = 'Text';
    site.fake.field('clients', 'ThemeJson').RichText = true;
    const { made, result } = await createNow(site);
    assert.equal(made.untouched.length, 2);
    assert.deepEqual(writes(site.fake), ['create column clients.Slug']);
    assert.ok(!site.fake.requests.some((entry) => ['SortOrder', 'ThemeJson'].includes(entry.field)), 'not a read, not a write');
    assert.equal(site.fake.field('sections', 'SortOrder').TypeAsString, 'Text', 'left as it was');
    assert.equal(result.ok, true);
    assert.match(result.summary, /2 things Setup will not touch still need fixing by hand\.$/);
  });

  it('the only change it makes to a column that exists is the index or uniqueness the plan named', async () => {
    const site = await siteWith();
    site.fake.field('tracks', 'SessionId').Indexed = false;
    Object.assign(site.fake.field('adminusers', ID), { Indexed: false, EnforceUniqueValues: false });
    const before = structuredClone(site.fake.fields.get('tracks'));
    await createNow(site);
    assert.deepEqual(writes(site.fake), ['change column tracks.SessionId', 'change column adminusers.AppId', 'change column adminusers.AppId']);
    assert.deepEqual(site.sent.map(({ method, body }) => [method, body]), [
      ['MERGE', { __metadata: { type: 'SP.Field' }, Indexed: true }], ['MERGE', { __metadata: { type: 'SP.Field' }, Indexed: true }], ['MERGE', { __metadata: { type: 'SP.Field' }, EnforceUniqueValues: true }],
    ]);
    assert.deepEqual(site.fake.fields.get('tracks').map((field) => ({ ...field, Indexed: false })), before.map((field) => ({ ...field, Indexed: false })), 'nothing else about the list changed');
  });
});

describe('Create: when SharePoint makes something else, refuses, or fails part-way', () => {
  it('a column SharePoint gives another internal name (a taken name gets a digit): it stops at once, names the column and what SharePoint made, and guesses nothing', async () => {
    const site = await siteWith({ without: ['sections'], traps: { taken: ['sections.SortOrder'] } });
    const { result } = await createNow(site, { concurrency: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.failure.words, `Create stopped: SharePoint made the column SortOrder of ${site.titles.sections} with the internal name SortOrder0, not SortOrder. Setup does not guess or rename. A column of that name is already taken on that list (perhaps by one nobody sees): delete SortOrder0 (it holds nothing), then make SortOrder by hand as SHAREPOINT-LISTS.md says, and press Show the plan again.`);
    assert.deepEqual(writes(site.fake), ['create list sections', 'create column sections.AppId', 'create column sections.SortOrder'], 'nothing after it');
    assert.equal(result.failure.created, `Made before it stopped: the list ${site.titles.sections}; AppId and SortOrder0 of ${site.titles.sections}. Press Show the plan, then Create, to carry on from there.`);
    const next = await plan(site);
    assert.match(next.untouched.find((item) => item.column === 'SortOrder').found, /internal name SortOrder0; the app looks for SortOrder/, 'the next plan reports it, and plans nothing for it');
  });

  it('a several-lines column SharePoint makes as rich text whatever it was asked: it stops at once, at that column', async () => {
    const site = await siteWith({ without: ['questions'], traps: { richText: 'always' } });
    const { result } = await createNow(site, { concurrency: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.failure.words, `Create stopped: SharePoint made the column Prompt of ${site.titles.questions} as rich text, not plain text. Setup does not guess or change it. Edit Prompt in the list's settings: choose Plain text, and set "Append Changes to Existing Text" to No; then press Show the plan again.`);
    assert.equal(writes(site.fake).at(-1), 'create column questions.Prompt');
  });

  it('a 403 on the first write stops at once with words a person can act on; nothing was made', async () => {
    const site = await siteWith({ without: EVERYTHING });
    site.fake.forbid();
    const { result } = await createNow(site);
    assert.equal(result.ok, false);
    assert.equal(result.failure.words, 'Your account cannot create lists on this site. A site owner must press Create, or create the lists by hand from SHAREPOINT-LISTS.md.');
    assert.equal(result.failure.created, 'Nothing was made before it stopped.');
    assert.equal(result.failure.technical, `403 at: create the list ${site.titles.clients}. ${ACCESS_DENIED}`);
    assert.equal(site.fake.writes().length, 1, 'one refused write, and no other');
    assert.equal(site.fake.lists.size, 0);
  });

  it('a 403 part-way (on the columns) stops at once, and says what was made before it stopped', async () => {
    const site = await siteWith({ without: ['adminusers', 'appsettings'] });
    site.fake.forbid((entry) => entry.path.endsWith('/createfieldasxml') && entry.field === 'PinHash');
    const { result } = await createNow(site, { concurrency: 1 });
    assert.equal(result.ok, false);
    assert.match(result.failure.words, /^Your account cannot create lists on this site\./);
    assert.equal(result.failure.created, `Made before it stopped: the lists ${site.titles.appsettings} and ${site.titles.adminusers}; AppId, ActiveSessionId, ActiveClientId, ActivatedAt, SchemaVersion, FiscalYearStartMonth and MinSample of ${site.titles.appsettings}; AppId of ${site.titles.adminusers}. Press Show the plan, then Create, to carry on from there.`);
  });

  it('a failure part-way (the 43rd write; the 40th until Prompt 21), then a second run: the same site as one clean run', async () => {
    const clean = await siteWith({ without: EVERYTHING, traps: ALL_TRAPS });
    await createNow(clean);
    const broken = await siteWith({ without: EVERYTHING, traps: ALL_TRAPS });
    // (The 43rd write: the column the 40th was until Prompt 21 made three lists more first, so the run still stops at the same column.)
    broken.fake.failWrite({ at: 43 });
    const first = await createNow(broken);
    assert.equal(first.result.ok, false);
    assert.match(first.result.failure.words, /^Create stopped at: create the column \w+ of \w+\. SharePoint said: Something went wrong\. \(an injected failure\)$/);
    assert.match(first.result.failure.created, /Press Show the plan, then Create, to carry on from there\.$/);
    const second = await createNow(broken);
    assert.equal(second.result.ok, true, second.result.failure?.words);
    assert.ok(second.result.writes < 196 && second.result.writes > 140, `it carried on: ${second.result.writes} writes`); // (a full run is 198 since Prompt 21, Phase 3; 194 and 151 before)
    assert.deepEqual(stateOf(broken.fake), stateOf(clean.fake));
    assert.equal((await plan(broken)).summary, 'Nothing to create');
  });

  it('a stop between a list and its settings: the next run gives that list its settings (and only Setup\'s lists)', async () => {
    const site = await siteWith({ without: ['tracks', 'visitorroster'] });
    site.fake.forbid((entry) => entry.method === 'MERGE' && !entry.path.includes('/fields/'));
    const first = await createNow(site, { versioning: true });
    assert.equal(first.result.ok, false);
    assert.equal(site.fake.listSettings('tracks').Description, `${META.tracks.purpose} ${SETTINGS_PENDING}`);
    site.fake.clearFaults();
    const { made, result } = await createNow(site, { versioning: true });
    assert.deepEqual(made.settings.map((item) => [item.kind, item.key]), [['list', 'tracks'], ['list', 'visitorroster']]);
    assert.equal(result.ok, true);
    assert.deepEqual(site.fake.listSettings('tracks'), { EnableAttachments: false, EnableModeration: false, EnableVersioning: false, Description: `${META.tracks.purpose} ${MADE_BY}` });
    assert.equal(site.fake.listSettings('visitorroster').EnableVersioning, true, 'not a busy list');
  });
});

describe('Create: the one door it writes through', () => {
  it('dataService.sendToSharePoint sends what it is handed, with the write token, and throws SharePoint\'s answer with its status', async () => {
    const site = await siteWith({ without: ['sections'] });
    const made = await site.ds.sendToSharePoint('POST', '/web/lists', { __metadata: { type: 'SP.List' }, BaseTemplate: 100, Title: site.titles.sections });
    assert.equal(made.Title, site.titles.sections);
    assert.deepEqual(site.fake.requests.map((entry) => `${entry.method} ${entry.path.replace(/^.*\/_api/, '')}`), ['POST /contextinfo', 'POST /web/lists']);
    site.fake.forbid();
    await assert.rejects(site.ds.sendToSharePoint('POST', '/web/lists', { __metadata: { type: 'SP.List' }, BaseTemplate: 100, Title: site.titles.questions }),
      (error) => error.status === 403 && error.message === `SharePoint (403): ${ACCESS_DENIED}`);
  });

  it('is SharePoint\'s alone: on the local server it refuses, and sends nothing', async () => {
    const ds = await import(`../migration/src/lib/data/dataService.js?provision=${pages += 1}`);
    ds.configure({ baseUrl: 'http://127.0.0.1:9/api' });
    await assert.rejects(ds.sendToSharePoint('POST', '/web/lists', {}), /SharePoint mode is not enabled on this page\./);
  });
});

describe('Create: what the module may send', () => {
  it('its source sends POST and MERGE only: no DELETE, no recycle, nothing that changes a column\'s type or renames a list', async () => {
    const source = await readFile(path.join(import.meta.dirname, '..', 'migration/src/lib/setup/provision.js'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /'DELETE'|"DELETE"|`DELETE`/, 'no DELETE');
    assert.doesNotMatch(code, /recycle|deleteObject|breakRoleInheritance/i, 'no recycle');
    assert.doesNotMatch(code, /FieldTypeKind|TypeAsString\s*:/, 'no change of a column\'s type');
    assert.equal((code.match(/SchemaXml/g) ?? []).length, 1, 'a definition is sent once: to create a column');
    assert.deepEqual([...new Set([...code.matchAll(/\bsend\(\s*'([A-Z]+)'/g)].map(([, verb]) => verb))].sort(), ['MERGE', 'POST']);
    assert.match(code, /FIELD_CHANGES = Object\.freeze\(\['Indexed', 'EnforceUniqueValues'\]\)/, 'a column is changed only in its index or uniqueness');
    assert.match(code, /LIST_CHANGES = Object\.freeze\(\['EnableAttachments', 'EnableModeration', 'EnableVersioning', 'Description'\]\)/, 'and a list only in these');
  });

  it('every write of every run above went through the data layer, and every column change carried only an index or uniqueness', () => {
    assert.ok(changes.length > 0);
    for (const body of changes.fields) assert.ok(Object.keys(body).filter((key) => key !== '__metadata').every((key) => ['Indexed', 'EnforceUniqueValues'].includes(key)), JSON.stringify(body));
    for (const body of changes.lists) assert.ok(Object.keys(body).filter((key) => key !== '__metadata').every((key) => ['EnableAttachments', 'EnableModeration', 'EnableVersioning', 'Description'].includes(key)), JSON.stringify(body));
  });
});

describe('the suite', () => {
  it('no request of this suite reached a list that is not its own, and none filtered on a column the lists do not index', () => {
    assert.deepEqual(STRAYS, []);
    assert.deepEqual(UNINDEXED, []);
  });
});

