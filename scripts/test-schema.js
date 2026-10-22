// Phase 10c-2b: one schema file, the PMS list names and schema v2, and every reader built on them.
// Run: node --test scripts/test-schema.js (part of `npm test`, and of `npm run test:schema`).
//
// What this holds: that migration/src/lib/schema/pms-schema.js (the names, every page) and migration/src/lib/schema/pms-schema-meta.js (everything else, Setup and the
// tests only) describe the same lists and columns; that the snapshot of the six hand-kept tables they replaced
// (scripts/schema-baseline/schema-before-10c2b.json), with the changes of this phase applied one by one, is exactly what they say (part
// C proved the same file at the old names and shape equal to the snapshot itself: that commit holds it); that the titles are the ones
// VJR chose; that exactly the columns a recorded request filters on are indexed; that each reader is built on the file; and that no
// hand-kept table comes back. What it does not hold: that a real SharePoint list has this shape. Nothing here has met the tenant.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ID, LIBRARY, LISTS } from '../migration/src/lib/schema/pms-schema.js';
import { LIBRARY_META, LOCAL_FILE, META, columnsOf } from '../migration/src/lib/schema/pms-schema-meta.js';
import { schemaSpecs } from '../migration/src/lib/setup/setup-checks.js';
import { dataLayerFiles } from './data-layer-source.js';
import { BASELINE_DIR } from './request-baseline.js';
import { readSnapshot, readTables } from './schema-snapshot.js';
import { createSharePointFake } from './sharepoint-fake.js';

const ROOT = path.join(import.meta.dirname, '..');
const snapshot = await readSnapshot();
const source = (file) => readFile(path.join(ROOT, file), 'utf8');

// ---- One shape for both sides ------------------------------------------------------------------------------------------------------------

/**
 * A schema as one plain description: the library's title, and for each list its title, its local file and its columns, each with
 * the field it holds, its kind, its SharePoint type, whether it is indexed, unique, required to exist and required to hold a value, and
 * the words it may hold. (Kinds as the adapter knew them before Phase 10c-2b: text and numbers alike are "plain".)
 */
const PLAIN = { text: 'plain', number: 'plain', plain: 'plain', yesno: 'yesno', date: 'date', array: 'array', object: 'object' };

/** The snapshot as that description: each column's type, index and uniqueness as the mock had them, the words as the document listed them. */
function shapeOfSnapshot() {
  const documented = snapshot.tables['PROVISIONING.md'];
  const wordsOf = (title, column) => {
    const cell = documented.lists[title]?.find((row) => row.column === column)?.type ?? documented.added.find((row) => row.list === title && row.column === column)?.type ?? '';
    return cell.startsWith('Choice:') ? [...cell.matchAll(/`([\w-]+)`/g)].map(([, word]) => word) : null;
  };
  return {
    library: snapshot.schema.library,
    lists: Object.fromEntries(Object.entries(snapshot.schema.lists).map(([key, list]) => [key, {
      title: list.title, local: list.local,
      columns: list.columns.map((column) => ({
        column: column.column, field: column.field, kind: PLAIN[column.kind], type: column.fake.type, indexed: column.fake.indexed, unique: column.fake.unique,
        mustExist: !column.added, required: false, values: wordsOf(list.title, column.column), format: null,
      })),
    }])),
  };
}

/** The schema file as that description. */
function shapeOfFile() {
  return {
    library: LIBRARY,
    lists: Object.fromEntries(Object.entries(LISTS).map(([key, { title }]) => [key, {
      title, local: LOCAL_FILE[key] ?? key,
      columns: columnsOf(key).map((column) => ({
        column: column.name, field: column.field, kind: PLAIN[column.kind], type: column.type, indexed: column.indexed, unique: column.unique,
        mustExist: column.mustExist, required: column.required, values: column.values, format: column.format,
      })),
    }])),
  };
}

// ---- What this phase changed, one change at a time ---------------------------------------------------------------------------------------

const eachColumn = (shape, change) => { for (const list of Object.values(shape.lists)) list.columns = list.columns.map((column) => change(column, list)); return shape; };
/** The titles VJR chose (13 and 14 Oct 2026). */
export const PMS_TITLES = Object.freeze({
  clients: 'PMSClients', sessions: 'PMSClientSessions', sections: 'PMSActivities', questions: 'PMSActivityQuestions', options: 'PMSAnswerOptions',
  tracks: 'PMSParticipants', responses: 'PMSParticipantAnswers', qrtokens: 'PMSGuestQRCodes', visitorroster: 'PMSGuestList', uservisitlogs: 'PMSVisitLog',
  adminusers: 'PMSAdminUsers', appsettings: 'PMSAppSettings',
});
export const PMS_LIBRARY = 'PMSClientImages';
/** Exactly the columns a request filters on, besides AppId (what the recorded requests say: see the last test of this file). */
const FILTERED = ['sessions.ClientId', 'sections.ClientId', 'options.QuestionId', 'tracks.SessionId', 'tracks.QrTokenId', 'qrtokens.SessionId',
  'qrtokens.VisitorId', 'visitorroster.SessionId', 'uservisitlogs.SessionId', 'responses.SessionId', 'responses.TrackId'];

export const CHANGES = [
  ['the lists are named PMS and a meaningful name, and the picture library PMSClientImages', (shape) => {
    for (const [key, list] of Object.entries(shape.lists)) list.title = PMS_TITLES[key];
    shape.library = PMS_LIBRARY;
    return shape;
  }],
  ['(5) an order is SortOrder, on activities and questions: SharePoint keeps Order for itself', (shape) => eachColumn(shape, (column) => (column.column === 'Order' ? { ...column, column: 'SortOrder' } : column))],
  ['(3) every column must exist', (shape) => eachColumn(shape, (column) => ({ ...column, mustExist: true }))],
  ['(6) a column of chosen words is single-line text; its words are in pms-schema-meta.js', (shape) => eachColumn(shape, (column) => (column.type === 'Choice' ? { ...column, type: 'Text' } : column))],
  ['(4) exactly the columns a request filters on are indexed: Tracks.QrTokenId gains one; Questions.SectionId, Tracks.ClientId and QRTokens.ClientId lose theirs',
    (shape) => { for (const [key, list] of Object.entries(shape.lists)) list.columns = list.columns.map((column) => ({ ...column, indexed: column.column === ID || FILTERED.includes(`${key}.${column.column}`) })); return shape; }],
  ['every date column is shown as Date & Time, SessionDate included (VJR\'s checklist: a date-only value can come back as the day before)',
    (shape) => eachColumn(shape, (column) => (column.type === 'DateTime' ? { ...column, format: 'Date & Time' } : column))],
  ['(1) PMSAppSettings has SchemaVersion, a number: the version of the lists, read by every page and written by Setup alone (part E)', (shape) => {
    shape.lists.appsettings.columns.push({ column: 'SchemaVersion', field: 'schemaVersion', kind: 'plain', type: 'Number', indexed: false, unique: false, mustExist: true, required: false, values: null, format: null });
    return shape;
  }],
  ['(2) AppId is required, indexed and unique on every list', (shape) => eachColumn(shape, (column) => (column.column === ID ? { ...column, indexed: true, unique: true, required: true } : column))],
  // (Phase 10i, schema version 3: the one change since 10c-2b.)
  ['(Phase 10i, v3) no column is named like a property SharePoint gives every list item: PMSGuestList.DisplayName is GuestName, PMSVisitLog.DisplayName is SignedInName', (shape) => {
    for (const [key, now] of [['visitorroster', 'GuestName'], ['uservisitlogs', 'SignedInName']]) {
      shape.lists[key].columns = shape.lists[key].columns.map((column) => (column.column === 'DisplayName' ? { ...column, column: now } : column));
    }
    return shape;
  }],
];

describe('the snapshot of the old schema, with this phase\'s changes, is the schema file', () => {
  it('each change, applied in turn to the snapshot, and nothing else, gives exactly what the two files say', () => {
    let shape = shapeOfSnapshot();
    for (const [, change] of CHANGES) shape = change(structuredClone(shape));
    assert.deepEqual(shape, shapeOfFile());
  });

  it('every change is needed: leave any one out and the result is not the file', () => {
    for (const [index, [what]] of CHANGES.entries()) {
      let shape = shapeOfSnapshot();
      for (const [, change] of CHANGES.filter((_, at) => at !== index)) shape = change(structuredClone(shape));
      assert.notDeepEqual(shape, shapeOfFile(), what);
    }
  });

  it('the titles are the ones VJR chose, the library is PMSClientImages, and the logical keys are what they were', () => {
    assert.deepEqual(Object.fromEntries(Object.entries(LISTS).map(([key, list]) => [key, list.title])), { ...PMS_TITLES, ...Object.fromEntries(Object.keys(LISTS).map((key) => [key, PMS_TITLES[key]])) });
    assert.deepEqual(Object.keys(LISTS).sort(), Object.keys(PMS_TITLES).sort());
    assert.deepEqual(Object.keys(LISTS), Object.keys(snapshot.schema.lists), 'the keys, in the order they always had');
    assert.equal(LIBRARY, PMS_LIBRARY);
    assert.equal(LIBRARY_META.title, LIBRARY);
  });

  it('a Yes/No column defaults to No, and a single line of text holds 255 characters at most (VJR\'s checklist)', () => {
    const yesNo = Object.keys(LISTS).flatMap((key) => columnsOf(key).filter((column) => column.type === 'Boolean').map((column) => [`${key}.${column.name}`, column.default]));
    assert.deepEqual(yesNo, [['sections.Enabled', 'No'], ['options.Correct', 'No'], ['qrtokens.Used', 'No'], ['visitorroster.Enabled', 'No']]);
    for (const key of Object.keys(LISTS)) for (const column of columnsOf(key).filter((each) => each.type === 'Text')) assert.ok(column.max > 0 && column.max <= 255, `${key}.${column.name}: at most 255`);
  });

  it('no column is a Choice, none but AppId is required, and every one must exist', () => {
    for (const key of Object.keys(LISTS)) {
      for (const column of columnsOf(key)) {
        assert.notEqual(column.type, 'Choice', `${key}.${column.name}`);
        assert.equal(column.mustExist, true, `${key}.${column.name}`);
        assert.equal(column.required, column.name === ID, `${key}.${column.name}`);
        if (column.values) assert.equal(column.type, 'Text', `${key}.${column.name}: a column of chosen words is text`);
      }
    }
    const worded = Object.keys(LISTS).flatMap((key) => columnsOf(key).filter((column) => column.values).map((column) => `${LISTS[key].title}.${column.name}`));
    assert.deepEqual(worded, ['PMSClients.Status', 'PMSClientSessions.Status', 'PMSClientSessions.ParticipationMode', 'PMSClientSessions.ActivityFlow',
      'PMSActivityQuestions.QuestionType', 'PMSActivityQuestions.Layout', 'PMSParticipants.JoinedVia', 'PMSVisitLog.EntryMode']);
  });
});

// ---- No column is named like a property SharePoint gives every list item (Phase 10i) ------------------------------------------------------

/**
 * The properties SharePoint gives every list item in REST (SP.ListItem, and what an item read that names no columns returns): a column with one
 * of these names can be written and not read back by name. The real site (PCOE, 15 Oct 2026) refused every PMSVisitLog item read whose $select
 * named DisplayName ("Value does not fall within the expected range."), and an unnamed read of that list returned Id, ServerRedirectedEmbedUri,
 * ServerRedirectedEmbedUrl, ContentTypeId, Title, ComplianceAssetId, the list's own columns but DisplayName and ClientId, ID, Modified, Created,
 * AuthorId, EditorId, OData__UIVersionString and GUID.
 */
export const LIST_ITEM_PROPERTIES = Object.freeze([
  'AttachmentFiles', 'Attachments', 'AuthorId', 'ComplianceAssetId', 'ComplianceInfo', 'ContentType', 'ContentTypeId', 'Created', 'DisplayName',
  'EditorId', 'EffectiveBasePermissions', 'EffectiveBasePermissionsForUI',
  'FieldValuesAsHtml', 'FieldValuesAsText', 'FieldValuesForEdit', 'File', 'FileSystemObjectType', 'FirstUniqueAncestorSecurableObject', 'Folder',
  'GetDlpPolicyTip', 'GUID', 'HasUniqueRoleAssignments', 'ID', 'Id', 'LikedByInformation', 'Modified', 'OData__UIVersionString',
  'ParentList', 'Properties', 'RoleAssignments', 'ServerRedirectedEmbedUri', 'ServerRedirectedEmbedUrl', 'Versions',
]);
/**
 * And the internal names of the columns SharePoint puts on every list it makes, which a column of the app cannot have either: SharePoint gives
 * the new column another name (`Order0`; that is why an order is SortOrder, Phase 10c-2b). Title is one of them, and the schema uses it on purpose:
 * the activities' title IS that column.
 */
export const BUILT_IN_COLUMNS = Object.freeze([
  'Title', 'Author', 'Editor', 'Order', 'FileRef', 'FileLeafRef', 'FileDirRef', 'FSObjType', 'UniqueId', 'ProgId', 'ScopeId', 'LinkTitle', 'LinkTitleNoMenu',
  'SelectTitle', 'ItemChildCount', 'FolderChildCount', 'InstanceID', 'WorkflowVersion', 'WorkflowInstanceID', 'owshiddenversion', '_UIVersionString', '_UIVersion',
  '_ModerationStatus', '_ModerationComments', '_Level', '_IsCurrentVersion', 'MetaInfo', 'Edit', 'DocIcon', 'EncodedAbsUrl', 'BaseName', 'ServerUrl', 'PermMask',
  'AppAuthor', 'AppEditor',
]);
/** Each column of `lists` (by key: a list of column names) named like one of the two, case aside, as `key.Column`; the built-in Title is allowed. */
export const namedLikeAProperty = (lists) => {
  const taken = new Set([...LIST_ITEM_PROPERTIES, ...BUILT_IN_COLUMNS].map((name) => name.toLowerCase()));
  return Object.entries(lists).flatMap(([key, columns]) => columns.filter((name) => name !== 'Title' && taken.has(name.toLowerCase())).map((name) => `${key}.${name}`));
};

describe('no column is named like a property SharePoint gives every list item (Phase 10i)', () => {
  it('no column of the schema, in pms-schema.js or in META, has such a name, but the built-in Title the activities use on purpose', () => {
    const fromSchema = Object.fromEntries(Object.entries(LISTS).map(([key, list]) => [key, Object.values(list.fields).map((field) => field.column)]));
    const fromMeta = Object.fromEntries(Object.keys(META).map((key) => [key, Object.keys(META[key].columns)]));
    assert.deepEqual(namedLikeAProperty(fromSchema), [], 'pms-schema.js');
    assert.deepEqual(namedLikeAProperty(fromMeta), [], 'pms-schema-meta.js');
  });

  it('the guard can fail: a column called DisplayName, created, ID or Order is caught, whatever its case; Title and a name of the app\'s own are not', () => {
    assert.deepEqual(namedLikeAProperty({ a: ['DisplayName', 'created', 'ID', 'Order', 'Title', 'SortOrder', 'SignedInName'], b: ['displayname'] }),
      ['a.DisplayName', 'a.created', 'a.ID', 'a.Order', 'b.displayname']);
    assert.ok(LIST_ITEM_PROPERTIES.length >= 33 && BUILT_IN_COLUMNS.includes('Title'));
  });
});

describe('the two files', () => {
  it('describe the same lists and the same columns, in the same order, and agree on each column\'s kind', () => {
    assert.deepEqual(Object.keys(META), Object.keys(LISTS));
    const allowed = { text: ['Text', 'Note'], number: ['Number'], yesno: ['Boolean'], date: ['DateTime'], array: ['Note'], object: ['Note'] };
    for (const [key, { fields }] of Object.entries(LISTS)) {
      const named = Object.values(fields).map((field) => field.column);
      const described = Object.keys(META[key].columns);
      assert.deepEqual(described.filter((name) => name !== ID), named.filter((name) => name !== ID), `${key}: the same columns, in the same order`);
      assert.equal(described[0], ID, `${key} starts with ${ID}`);
      for (const field of Object.values(fields)) assert.ok(allowed[field.kind].includes(META[key].columns[field.column].type), `${key}.${field.column}: a ${field.kind} is not kept as ${META[key].columns[field.column].type}`);
      for (const spec of Object.values(META[key].columns)) assert.equal('indexed' in spec, false, `${key}: an index is the names file's to say, once`);
    }
  });

  it('say, for every list and every column, what it is for, who uses it and how fast it grows', () => {
    const roles = ['participant', 'admin', 'setup'];
    for (const [key, list] of Object.entries(META)) {
      assert.match(list.purpose, /^[A-Z].{20,}\.$/, `${key}: what it is for, as a sentence`);
      assert.ok(list.reads.every((role) => roles.includes(role)) && list.writes.every((role) => roles.includes(role)), key);
      assert.ok(list.growth.perEvent && list.growth.perYear, key);
      for (const column of columnsOf(key)) {
        assert.match(column.purpose, /^[A-Z`].{10,}\.$/, `${key}.${column.name}: what it is for, as a sentence`);
        assert.ok(['Text', 'Note', 'Number', 'DateTime', 'Boolean'].includes(column.type), `${key}.${column.name}`);
        assert.ok([...column.reads, ...column.writes].every((role) => roles.includes(role)), `${key}.${column.name}`);
        assert.equal(typeof column.personal, 'boolean');
      }
    }
  });
});

describe('every reader is built on the schema file', () => {
  it('the mock: each list\'s columns are the schema\'s, with its type, index, uniqueness and (AppId alone) required', () => {
    const fake = createSharePointFake({ prefix: '' });
    for (const key of Object.keys(LISTS)) {
      assert.deepEqual(fake.fields.get(key).map((field) => ({ column: field.InternalName, type: field.TypeAsString, indexed: field.Indexed, unique: field.EnforceUniqueValues, required: field.Required, format: field.DisplayFormat ?? null })),
        columnsOf(key).map((column) => ({ column: column.name, type: column.type, indexed: column.indexed, unique: column.unique, required: column.required, format: column.format ? 1 : null })), key);
    }
  });

  it('Setup\'s check: every column, its exact type, its index, AppId unique and required, with the words to make each', () => {
    for (const key of Object.keys(LISTS)) {
      assert.deepEqual(schemaSpecs(key).map((spec) => [spec.column, spec.accepts[0], spec.indexed, spec.unique, spec.required]),
        columnsOf(key).map((column) => [column.name, column.type, column.indexed, column.unique, column.required]), key);
    }
    const label = (key, name) => schemaSpecs(key).find((spec) => spec.column === name).type;
    assert.equal(label('clients', ID), 'Single line of text, indexed, enforce unique values, required');
    assert.equal(label('clients', 'Status'), 'Single line of text');
    assert.equal(label('sections', 'ClientId'), 'Single line of text, indexed');
    assert.equal(label('sections', 'SortOrder'), 'Number');
    assert.equal(label('sessions', 'SessionDate'), 'Date and Time, shown as Date & Time');
    assert.equal(label('clients', 'ThemeJson'), 'Multiple lines of text, plain text');
  });

  it('the local server serves a file for each list, and the seed checker reads the schema', async () => {
    const { LIST_FILES } = await import('../server/api.js');
    assert.deepEqual([...LIST_FILES].sort(), Object.keys(LISTS).map((key) => LOCAL_FILE[key] ?? key).sort());
    assert.match(await source('scripts/validate-data.js'), /from '\.\.\/migration\/src\/lib\/schema\/pms-schema(-meta)?\.js'/);
  });

  it('no hand-kept table is left: each reader that had one has none, and spells no list title, old or new', async () => {
    // (The data layer was dataService.js alone until Phase 17 cut it into parts: each of them is held to what it was held to.)
    const dataLayer = /\bconst (?:spLists|spAdded|spColumns|spArrays|spObjects|spBooleans|spDates|spBaseTypes|spBaseSpec)\b/;
    const tables = {
      ...Object.fromEntries((await dataLayerFiles()).map((file) => [path.relative(ROOT, file).split(path.sep).join('/'), dataLayer])),
      'migration/src/lib/setup/setup-checks.js': /\bconst (?:PROVISIONED|STRICT)\b/,
      'scripts/sharepoint-fake.js': /\b(?:const|export const) (?:SCHEMA|CHOICES|ADDED_COLUMNS)\b/,
      'server/api.js': /\bconst LISTS = \[/,
      'scripts/validate-data.js': /\[\s*'clients', 'sessions'/,
      'scripts/test-sharepoint.js': /\bconst columns = \{/,
    };
    const titles = [...Object.values(snapshot.schema.lists).map((list) => list.title), snapshot.schema.library, ...Object.values(PMS_TITLES), PMS_LIBRARY];
    const spelled = new RegExp(`['"\`](?:${titles.join('|')})['"\`]`);
    for (const [file, table] of Object.entries(tables)) {
      const text = await source(file);
      assert.doesNotMatch(text, table, `${file} has a table of its own again`);
      assert.doesNotMatch(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''), spelled, `${file} spells a list title`);
      assert.doesNotMatch(text, /'\w+:(?:Text|Note|Number|DateTime|Boolean|Choice)!*\s/, `${file} writes columns as Name:Type`);
    }
    await assert.rejects(readTables(), /There is no "const spLists ="/, 'and the tables part A read are not there to read');
  });
});

describe('the seed checker holds server/data to the schema (part G)', () => {
  const check = async (dir) => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { NODE_TEST_CONTEXT: _runner, ...env } = process.env;
    return promisify(execFile)(process.execPath, [path.join(ROOT, 'scripts', 'validate-data.js')], { env: { ...env, ...(dir ? { DATA_DIR: dir } : {}) } })
      .then(({ stdout }) => ({ ok: true, text: stdout }), (error) => ({ ok: false, text: `${error.stdout}${error.stderr}` }));
  };

  it('server/data passes: every field is a field of its list, of its kind, holding one of its words and fitting its column', async () => {
    const found = await check(null);
    assert.ok(found.ok, found.text);
  });

  it('and it names a field the lists do not have (an old Order), a wrong kind, a word that is not allowed and a name too long for one line', async () => {
    const { cp, mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const os = await import('node:os');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pms-validate-'));
    try {
      await cp(path.join(ROOT, 'server', 'data'), dir, { recursive: true });
      const edit = async (file, change) => { const rows = JSON.parse(await readFile(path.join(dir, `${file}.json`), 'utf8')); change(rows); await writeFile(path.join(dir, `${file}.json`), JSON.stringify(rows)); };
      await edit('sections', (rows) => { rows[0].Order = 3; rows[0].enabled = 'yes'; });
      await edit('questions', (rows) => { rows[0].layout = 'grid'; });
      await edit('clients', (rows) => { rows[0].name = 'x'.repeat(256); });
      const found = await check(dir);
      assert.equal(found.ok, false);
      assert.match(found.text, /"Order" is not a field of the PMSActivities list/);
      assert.match(found.text, /"enabled" should be yesno, is "yes"/);
      assert.match(found.text, /"layout" is "grid", not one of text-list, image-grid/);
      assert.match(found.text, /"name" is 256 characters, longer than its column's 255/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the index rule, against every request the suites recorded', () => {
  it('every column a recorded request filters on is indexed, and every indexed column is filtered on by one (Setup\'s probes, which ask for Id alone, aside)', async () => {
    const filtered = new Set();
    for (const file of (await readdir(BASELINE_DIR)).filter((name) => name.endsWith('.txt'))) {
      for (const line of (await readFile(path.join(BASELINE_DIR, file), 'utf8')).split('\n')) {
        if (line.startsWith('#')) continue;
        const address = decodeURIComponent(line.replace(/^~?\d+ x /, '').replace(/^\s+carries /, ''));
        const read = /getbytitle\('([^']+)'\)\/items\?(.*)$/.exec(address);
        if (!read || /(?:^|&)\$select=Id(?:&|$)/.test(read[2])) continue;
        const key = Object.keys(LISTS).find((each) => LISTS[each].title === read[1]);
        assert.ok(key, `a recorded request names ${read[1]}, which is not a list of the schema`);
        for (const [, column] of (/\$filter=([^&]*)/.exec(read[2])?.[1] ?? '').matchAll(/(\w+) eq /g)) filtered.add(`${key}.${column}`);
      }
    }
    const indexed = Object.keys(LISTS).flatMap((key) => columnsOf(key).filter((column) => column.indexed).map((column) => `${key}.${column.name}`));
    assert.deepEqual([...filtered].filter((name) => !indexed.includes(name)), [], 'filtered on, and not indexed');
    assert.deepEqual(indexed.filter((name) => !filtered.has(name) && !name.endsWith(`.${ID}`)), [], 'indexed, and filtered on by nothing');
    assert.deepEqual([...filtered].filter((name) => !name.endsWith(`.${ID}`)).sort(), [...FILTERED].sort());
  });

  it('the mock refuses a read that filters on a column with no index, and notes it; a probe that asks for Id alone is answered', async () => {
    const { UNINDEXED } = await import('./sharepoint-fake.js');
    const fake = createSharePointFake({ prefix: '' });
    const before = UNINDEXED.length;
    const site = 'https://tenant.example/sites/cec/_api/web/lists';
    const refused = await fake.fetch(`${site}/getbytitle('${LISTS.qrtokens.title}')/items?$filter=${encodeURIComponent("Used eq 'false'")}&$top=200`);
    assert.equal(refused.status, 400);
    assert.equal(UNINDEXED.length, before + 1);
    UNINDEXED.splice(before);
    const probe = await fake.fetch(`${site}/getbytitle('${LISTS.qrtokens.title}')/items?$select=Id&$top=100&$filter=${encodeURIComponent("Used eq 'false'")}`);
    assert.equal(probe.status, 200);
    assert.equal((await fake.fetch(`${site}/getbytitle('${LISTS.tracks.title}')/items?$filter=${encodeURIComponent("QrTokenId eq 'x'")}&$select=Id,AppId,QrTokenId`)).status, 200);
    assert.equal(UNINDEXED.length, before);
  });
});
