// Phase 10c-3, part A: the mocked SharePoint REST (scripts/sharepoint-fake.js) can build a site, and springs the traps of ARCHITECTURE-10.md 6.3 (in git history at 7347c72)
// when a test asks it to. Run: node --test scripts/test-fake-site.js (part of `npm test`).
//
// This holds the TEST TOOL, with plain requests and no data layer: Setup's plan and Create are held to it in scripts/test-provision.js. What it
// does not hold is what the real site answers: every answer here is the fake's, and QA-TESTING.md lists what the tenant has to show.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LIBRARY, LISTS } from '../migration/src/lib/schema/pms-schema.js';
import { ACCESS_DENIED, ALL_TRAPS, OTHER_PREFIX, STRAYS, TITLE, UNIQUE_APART, UNIQUE_NEEDS_INDEX, createSharePointFake } from './sharepoint-fake.js';

const EMPTY = [...Object.keys(LISTS), 'logoLibrary'];
const api = (fake, address) => `${fake.siteUrl}/_api${address}`;
const byTitle = (title) => `/web/lists/getbytitle('${encodeURIComponent(title.replace(/'/g, "''"))}')`;
const WRITE = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose', 'X-RequestDigest': 'digest-token' };

/** One request to the fake, as the browser would send it; resolves to { status, data } (`data` is the `d` of a JSON answer, or the error's words). */
async function call(fake, method, address, body, headers = {}) {
  const verb = ['MERGE', 'DELETE'].includes(method) ? 'POST' : method;
  const response = await fake.fetch(api(fake, address), {
    method: verb, headers: { ...WRITE, ...(verb === method ? {} : { 'X-HTTP-Method': method, 'If-Match': '*' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  return { status: response.status, data: payload?.d ?? payload?.error?.message?.value ?? null };
}
const createList = (fake, Title, BaseTemplate = 100, more = {}) => call(fake, 'POST', '/web/lists', { __metadata: { type: 'SP.List' }, BaseTemplate, Title, ...more });
const createField = (fake, title, SchemaXml, Options = 8) =>
  call(fake, 'POST', `${byTitle(title)}/fields/createfieldasxml`, { parameters: { __metadata: { type: 'SP.XmlSchemaFieldCreationInformation' }, SchemaXml, Options } });
const changeField = (fake, title, name, changes) => call(fake, 'MERGE', `${byTitle(title)}/fields/getbyinternalnameortitle('${name}')`, { __metadata: { type: 'SP.Field' }, ...changes });

describe('the fake builds a site', () => {
  it('a site with nothing on it lists only the other copy\'s lists, and the test\'s own answer 404 until they are made', async () => {
    const fake = createSharePointFake({ prefix: '', without: EMPTY, schemaVersion: null });
    const { status, data } = await call(fake, 'GET', '/web/lists?$select=Title,BaseTemplate');
    assert.equal(status, 200);
    assert.deepEqual(data.results.map((list) => list.Title).sort(), [...Object.values(TITLE).map((title) => `${OTHER_PREFIX}${title}`)].sort(), 'the other copy\'s twelve lists and library');
    assert.equal((await call(fake, 'GET', `${byTitle(TITLE.clients)}/fields`)).status, 404);
    assert.equal((await call(fake, 'GET', `${byTitle(LIBRARY)}?$select=Id`)).status, 404, 'and the picture library too');
    assert.equal(fake.libraryPresent, false);
  });

  it('makes a list (template 100) with the built-in Title column and SharePoint\'s defaults, and the library (101); a second time is refused', async () => {
    const fake = createSharePointFake({ prefix: '', without: ['sections', 'logoLibrary'] });
    const made = await createList(fake, TITLE.sections, 100, { Description: 'Made by Setup.' });
    assert.equal(made.status, 201);
    assert.equal(made.data.Title, TITLE.sections);
    assert.equal(made.data.ListItemEntityTypeFullName, `SP.Data.${TITLE.sections}ListItem`);
    assert.deepEqual(fake.listSettings('sections'), { EnableAttachments: true, EnableModeration: false, EnableVersioning: true, Description: 'Made by Setup.' });
    assert.deepEqual(fake.fields.get('sections').map((field) => [field.InternalName, field.Required, field.FromBaseType]), [['Title', true, true]]);
    assert.equal(fake.requests.at(-1).list, 'sections', 'the log names the list it made, by key');
    assert.equal(fake.requests.at(-1).created, TITLE.sections);
    const again = await createList(fake, TITLE.sections);
    assert.equal(again.status, 500);
    assert.match(again.data, /already exists/);
    assert.equal((await createList(fake, LIBRARY, 100)).status, 400, 'the library is a document library, not a list');
    assert.equal((await createList(fake, LIBRARY, 101)).status, 201);
    assert.equal(fake.libraryPresent, true);
    assert.equal((await call(fake, 'GET', `${byTitle(LIBRARY)}/RootFolder`)).status, 200);
    assert.equal((await createList(fake, 'Somebody else\'s list')).status, 400, 'the mock makes only the schema\'s lists');
    assert.equal((await call(fake, 'POST', '/web/lists', { __metadata: { type: 'SP.List' }, BaseTemplate: 100, Title: 'X' }, { 'X-RequestDigest': 'stale' })).status, 403, 'a write needs the write token');
  });

  it('makes a column from its XML definition: the internal name asked for (with option 8), the type, plain text, Date & Time, a Yes/No default', async () => {
    const fake = createSharePointFake({ prefix: '', without: ['sections'] });
    await createList(fake, TITLE.sections);
    const text = await createField(fake, TITLE.sections, '<Field Type="Text" Name="ClientId" StaticName="ClientId" DisplayName="ClientId" MaxLength="255" />');
    assert.equal(text.status, 201);
    assert.equal(text.data.InternalName, 'ClientId');
    assert.equal(text.data.MaxLength, 255);
    assert.equal(fake.requests.at(-1).field, 'ClientId', 'the log names the column a request makes');
    const note = (await createField(fake, TITLE.sections, '<Field Type="Note" Name="Description" DisplayName="Description" RichText="FALSE" AppendOnly="FALSE" NumLines="6" />')).data;
    assert.deepEqual([note.TypeAsString, note.RichText, note.AppendOnly], ['Note', false, false]);
    const when = (await createField(fake, TITLE.sections, '<Field Type="DateTime" Name="When" DisplayName="When" Format="DateTime" />')).data;
    assert.equal(when.DisplayFormat, 1, 'Date & Time');
    const day = (await createField(fake, TITLE.sections, '<Field Type="DateTime" Name="Day" DisplayName="Day" />')).data;
    assert.equal(day.DisplayFormat, 0, 'with no format, SharePoint shows the date only');
    const yes = (await createField(fake, TITLE.sections, '<Field Type="Boolean" Name="Enabled" DisplayName="Enabled"><Default>0</Default></Field>')).data;
    assert.deepEqual([yes.TypeAsString, yes.DefaultValue], ['Boolean', '0']);
    const read = await call(fake, 'GET', `${byTitle(TITLE.sections)}/fields/getbyid('${yes.Id}')`);
    assert.deepEqual(read.data, yes, 'a column is read back by its id');
    assert.equal((await call(fake, 'GET', `${byTitle(TITLE.sections)}/fields/getbyinternalnameortitle('Enabled')`)).data.Id, yes.Id, 'or by its name');
    const spaced = (await createField(fake, TITLE.sections, '<Field Type="Text" DisplayName="Session Id" />', 0)).data;
    assert.equal(spaced.InternalName, 'Session_x0020_Id', 'without option 8 the internal name is made from the display name');
  });

  it('a taken internal name gets a digit, as SharePoint does it, and so does a name the `taken` trap marks', async () => {
    const fake = createSharePointFake({ prefix: '', without: ['sections'], traps: { taken: ['sections.SortOrder'] } });
    await createList(fake, TITLE.sections);
    assert.equal((await createField(fake, TITLE.sections, '<Field Type="Number" Name="SortOrder" DisplayName="SortOrder" />')).data.InternalName, 'SortOrder0');
    assert.equal((await createField(fake, TITLE.sections, '<Field Type="Text" Name="Title" DisplayName="Title" />')).data.InternalName, 'Title0', 'Title is the built-in column\'s');
  });

  it('the rich-text trap: a several-lines column made without saying otherwise is rich text; "always" ignores what the definition says', async () => {
    const fake = createSharePointFake({ prefix: '', without: ['sections', 'questions'], traps: ALL_TRAPS });
    await createList(fake, TITLE.sections);
    assert.equal((await createField(fake, TITLE.sections, '<Field Type="Note" Name="A" DisplayName="A" />')).data.RichText, true);
    assert.equal((await createField(fake, TITLE.sections, '<Field Type="Note" Name="B" DisplayName="B" RichText="FALSE" />')).data.RichText, false);
    const always = createSharePointFake({ prefix: '', without: ['sections'], traps: { richText: 'always' } });
    await createList(always, TITLE.sections);
    assert.equal((await createField(always, TITLE.sections, '<Field Type="Note" Name="B" DisplayName="B" RichText="FALSE" />')).data.RichText, true);
    const none = createSharePointFake({ prefix: '', without: ['sections'] });
    await createList(none, TITLE.sections);
    assert.equal((await createField(none, TITLE.sections, '<Field Type="Note" Name="A" DisplayName="A" />')).data.RichText, false, 'off unless asked for');
  });

  it('the uniqueness traps: refused on a column with no index, and refused in the same step as the index; index first, then uniqueness, works', async () => {
    const fake = createSharePointFake({ prefix: '', without: ['sections'], traps: ALL_TRAPS });
    await createList(fake, TITLE.sections);
    const both = await createField(fake, TITLE.sections, '<Field Type="Text" Name="AppId" DisplayName="AppId" Indexed="TRUE" EnforceUniqueValues="TRUE" />');
    assert.deepEqual([both.status, both.data], [400, UNIQUE_APART]);
    const alone = await createField(fake, TITLE.sections, '<Field Type="Text" Name="AppId" DisplayName="AppId" EnforceUniqueValues="TRUE" />');
    assert.deepEqual([alone.status, alone.data], [400, UNIQUE_NEEDS_INDEX]);
    assert.equal((await createField(fake, TITLE.sections, '<Field Type="Text" Name="AppId" DisplayName="AppId" Required="TRUE" />')).status, 201);
    assert.deepEqual(await changeField(fake, TITLE.sections, 'AppId', { EnforceUniqueValues: true }), { status: 400, data: UNIQUE_NEEDS_INDEX });
    assert.deepEqual(await changeField(fake, TITLE.sections, 'AppId', { Indexed: true, EnforceUniqueValues: true }), { status: 400, data: UNIQUE_APART });
    assert.equal((await changeField(fake, TITLE.sections, 'AppId', { Indexed: true })).status, 204);
    assert.equal((await changeField(fake, TITLE.sections, 'AppId', { EnforceUniqueValues: true })).status, 204);
    assert.deepEqual(['Indexed', 'EnforceUniqueValues', 'Required'].map((key) => fake.field('sections', 'AppId')[key]), [true, true, true]);
    assert.equal(fake.requests.at(-1).field, 'AppId');
  });

  it('never changes a column\'s type, and changes a list\'s settings only', async () => {
    const fake = createSharePointFake({ prefix: '' });
    assert.equal((await changeField(fake, TITLE.sections, 'SortOrder', { TypeAsString: 'Text' })).status, 400);
    assert.equal(fake.field('sections', 'SortOrder').TypeAsString, 'Number');
    const settings = await call(fake, 'MERGE', byTitle(TITLE.tracks), { __metadata: { type: 'SP.List' }, EnableAttachments: false, EnableModeration: false, EnableVersioning: false });
    assert.equal(settings.status, 204);
    assert.deepEqual(fake.listSettings('tracks'), { EnableAttachments: false, EnableModeration: false, EnableVersioning: false, Description: '' });
    assert.equal((await call(fake, 'MERGE', byTitle(TITLE.tracks), { __metadata: { type: 'SP.List' }, Title: 'Renamed' })).status, 400, 'a list is never renamed');
    assert.equal(fake.titleOf('tracks'), TITLE.tracks);
    assert.equal((await call(fake, 'MERGE', `${byTitle(`${OTHER_PREFIX}${TITLE.tracks}`)}`, { __metadata: { type: 'SP.List' }, EnableAttachments: false })).status, 400, 'nor the other copy\'s');
    assert.equal(fake.strays.length, 1);
    STRAYS.splice(STRAYS.indexOf(fake.strays[0]), 1); // (this test reached the other set on purpose)
  });

  it('forbid() refuses the writes it is told to with SharePoint\'s 403 and leaves reads alone; failWrite() fails the n-th write from now', async () => {
    const fake = createSharePointFake({ prefix: '', without: ['sections', 'questions', 'options'] });
    fake.forbid((entry) => entry.path.endsWith('/web/lists'));
    assert.deepEqual(await createList(fake, TITLE.sections), { status: 403, data: ACCESS_DENIED });
    assert.equal((await call(fake, 'GET', '/web/lists')).status, 200, 'a read is never refused');
    fake.clearFaults();
    fake.failWrite({ at: 2 });
    assert.equal((await createList(fake, TITLE.sections)).status, 201, 'the first write goes through');
    const second = await createList(fake, TITLE.questions);
    assert.equal(second.status, 500);
    assert.equal(fake.lists.has('questions'), false, 'a failed write leaves nothing');
    assert.equal((await createList(fake, TITLE.questions)).status, 201, 'and the next one goes through');
    assert.deepEqual(fake.writes().map((entry) => [entry.list, entry.faulted ?? 'done']), [['sections', 403], ['sections', 'done'], ['questions', 500], ['questions', 'done']]);
  });

  it('a list it made takes items like any other: its entity type, and the unique AppId once the column says so', async () => {
    const fake = createSharePointFake({ prefix: 'Test', without: ['adminusers'] });
    assert.equal((await createList(fake, `Test${TITLE.adminusers}`)).status, 201);
    for (const xml of ['<Field Type="Text" Name="AppId" DisplayName="AppId" Required="TRUE" />', '<Field Type="Text" Name="PinHash" DisplayName="PinHash" />', '<Field Type="Text" Name="Name" DisplayName="Name" />']) {
      assert.equal((await createField(fake, `Test${TITLE.adminusers}`, xml)).status, 201);
    }
    await changeField(fake, `Test${TITLE.adminusers}`, 'AppId', { Indexed: true });
    await changeField(fake, `Test${TITLE.adminusers}`, 'AppId', { EnforceUniqueValues: true });
    const item = { __metadata: { type: `SP.Data.Test${TITLE.adminusers}ListItem` }, Title: 'A', AppId: 'admin-a', PinHash: 'x', Name: 'A' };
    assert.equal((await call(fake, 'POST', `${byTitle(`Test${TITLE.adminusers}`)}/items`, item)).status, 201);
    // (With 500, as the real site refuses a duplicate: Phase 10h. `duplicateStatus: 400` is what the mock said before.)
    assert.equal((await call(fake, 'POST', `${byTitle(`Test${TITLE.adminusers}`)}/items`, item)).status, 500, 'the duplicate is refused');
    assert.equal(fake.lists.get('adminusers').length, 1);
    assert.deepEqual(fake.strays, []);
  });
});

describe('everything else is as it was', () => {
  it('a site set up as before has its lists and library, and a list reads with the same answer', async () => {
    const fake = createSharePointFake({ prefix: '' });
    assert.equal(fake.libraryPresent, true);
    const { data } = await call(fake, 'GET', `${byTitle(TITLE.clients)}?$select=ListItemEntityTypeFullName`);
    assert.deepEqual(Object.keys(data).sort(), ['Id', 'ListItemEntityTypeFullName', 'RootFolder', 'Title'], 'a list\'s own properties are what they were');
    const fields = (await call(fake, 'GET', `${byTitle(TITLE.clients)}/fields`)).data.results;
    assert.ok(fields.every((field) => !('Id' in field) && !('Title' in field)), 'and so are its columns');
  });

  it('no request of this suite reached a list that is not its own, except the one a test sent there on purpose', () => {
    assert.deepEqual(STRAYS, []);
  });
});
