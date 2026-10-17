// Phase 10c-2b, part A: the snapshot of the schema as it was written by hand, before one file said it.
// Run: node --test scripts/test-schema-baseline.js (part of `npm test`). `node scripts/schema-snapshot.js` prints the snapshot's outline.
//
// What this holds: that scripts/schema-baseline/schema-before-10c2b.json is what the hand-kept tables of the tree said (the data layer's
// maps, Setup's table, the mocked SharePoint's, the local server's list, the seed checker's lists of words, and PROVISIONING.md), that
// its one-description half is made from its table half and nothing else, and that the copies agreed with each other by a few fixed
// rules, which is what lets one file stand for all of them. Parts C and D are proved against this file.
// What it does not hold: that any real SharePoint list has this shape. Nothing here has met the tenant.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SNAPSHOT_COMMIT, declared, normalise, provisioningTables, readSnapshot } from './schema-snapshot.js';

const snapshot = await readSnapshot();
const lists = Object.entries(snapshot.schema.lists);
const columns = lists.flatMap(([key, list]) => list.columns.map((column) => ({ key, title: list.title, ...column })));

describe('the snapshot is the schema the tree holds, written by hand in six places', () => {
  // (Until part C this read the hand-kept tables out of the tree itself. They left the tree there; `node scripts/schema-snapshot.js --verify`
  // reads them again out of the commit the snapshot names, and scripts/test-schema.js holds the schema file to the snapshot.)
  it('was read from the tree of the last commit before Phase 10c-2b, and the PROVISIONING.md part of it is still the document', async () => {
    assert.match(snapshot.readFrom, /^ec31ac9 /);
    assert.deepEqual(provisioningTables(await readFile(path.join(import.meta.dirname, '..', 'docs', 'history', 'PROVISIONING.md'), 'utf8').then((text) => text.replace(/\r\n/g, '\n'))), snapshot.tables['PROVISIONING.md']);
  });

  it('its one description is made from those tables and from nothing else', () => {
    assert.deepEqual(normalise(snapshot.tables), snapshot.schema);
    assert.equal(snapshot.readFrom, SNAPSHOT_COMMIT);
  });

  it('is twelve lists and 89 columns, 13 of them the ones added in Phase 4, and one picture library', () => {
    assert.deepEqual(lists.map(([key, list]) => `${key}=${list.title}`), [
      'clients=Clients', 'sessions=Sessions', 'sections=Sections', 'questions=Questions', 'options=Options', 'tracks=Tracks', 'qrtokens=QRTokens',
      'appsettings=AppSettings', 'visitorroster=VisitorRoster', 'uservisitlogs=UserVisitLogs', 'adminusers=AdminUsers', 'responses=Responses',
    ]);
    assert.equal(columns.length, 89);
    assert.deepEqual(columns.filter((column) => column.added).map((column) => `${column.title}.${column.column}`).sort(), [...snapshot.tables['scripts/sharepoint-fake.js'].ADDED_COLUMNS].sort());
    assert.equal(columns.filter((column) => column.added).length, 13);
    assert.equal(snapshot.schema.library, 'ClientLogos');
    for (const [key, list] of lists) assert.equal(list.columns[0].column, 'AppId', `${key} starts with AppId`);
  });

  it('the local server keeps a file for each list, under the list\'s key, except the answers (participantresponses)', () => {
    assert.deepEqual(lists.filter(([key, list]) => list.local !== key).map(([key, list]) => [key, list.local]), [['responses', 'participantresponses']]);
    assert.deepEqual([...snapshot.tables['server/api.js'].LISTS].sort(), lists.map(([, list]) => list.local).sort());
    assert.deepEqual([...snapshot.tables['scripts/validate-data.js'].lists].sort(), lists.map(([, list]) => list.local).sort(), 'and the seed checker reads the same twelve');
  });
});

describe('the copies agreed with each other, by rules one file can follow', () => {
  it('every column of the data layer is a column of the mocked SharePoint, and the other way round', () => {
    assert.deepEqual(columns.filter((column) => !column.fake).map((column) => `${column.title}.${column.column}`), []);
    for (const [, list] of lists) {
      const mocked = snapshot.tables['scripts/sharepoint-fake.js'].SCHEMA[list.title].split(' ').map((entry) => entry.split(':')[0]);
      assert.deepEqual([...mocked].sort(), list.columns.map((column) => column.column).sort(), list.title);
    }
  });

  it('the type the strict check names is the mocked column\'s type, except that an original column of chosen words is checked as text', () => {
    const differ = columns.filter((column) => column.check.expect !== column.fake.type);
    assert.deepEqual(differ.map((column) => `${column.title}.${column.column}: ${column.check.expect} / ${column.fake.type}`), [
      'Sessions.Status: Text / Choice', 'Sessions.ParticipationMode: Text / Choice', 'Questions.QuestionType: Text / Choice',
      'Tracks.JoinedVia: Text / Choice', 'UserVisitLogs.EntryMode: Text / Choice',
    ]);
    assert.ok(differ.every((column) => !column.added));
  });

  it('eight columns hold one of a few words: three of the added ones offer them as choices, the document lists the others', () => {
    const chosen = columns.filter((column) => column.fake.type === 'Choice');
    assert.deepEqual(chosen.map((column) => `${column.title}.${column.column}`), [
      'Clients.Status', 'Sessions.Status', 'Sessions.ParticipationMode', 'Sessions.ActivityFlow', 'Questions.QuestionType', 'Questions.Layout',
      'Tracks.JoinedVia', 'UserVisitLogs.EntryMode',
    ]);
    assert.deepEqual(chosen.filter((column) => column.fake.choices).map((column) => column.column), ['Status', 'ActivityFlow', 'Layout']);
    for (const column of chosen) {
      assert.deepEqual(column.check.choices, column.fake.choices, `${column.title}.${column.column}: the check and the mock offer the same words`);
      assert.equal(column.added, column.fake.choices !== null, `${column.title}.${column.column}: only an added column offers its words`);
      // The document names the words of all eight, in its type cell.
      const cell = snapshot.tables['PROVISIONING.md'].lists[column.title].find((row) => row.column === column.column)?.type
        ?? snapshot.tables['PROVISIONING.md'].added.find((row) => row.list === column.title && row.column === column.column).type;
      assert.match(cell, /^Choice: `[\w-]+`(, `[\w-]+`)+$/);
      if (column.fake.choices) assert.deepEqual([...cell.matchAll(/`([\w-]+)`/g)].map(([, word]) => word), column.fake.choices);
    }
  });

  it('the strict check compares the type of AppId, of a JSON list and of every added column, and of nothing else', () => {
    assert.deepEqual(columns.filter((column) => column.check.compared !== (column.column === 'AppId' || column.kind === 'array' || column.added)), []);
    // (The one JSON object, Clients.ThemeJson, is an added column, so it is compared too.)
    assert.deepEqual(columns.filter((column) => column.kind === 'object').map((column) => [column.column, column.added]), [['ThemeJson', true]]);
  });

  it('Setup\'s table has every original column the strict check does not compare, with the mocked column\'s type and index', () => {
    for (const column of columns) {
      const expected = !column.added && !column.check.compared;
      assert.equal(column.byEye !== null, expected, `${column.title}.${column.column}`);
      if (column.byEye) assert.deepEqual(column.byEye, { type: column.fake.type, indexed: column.fake.indexed }, `${column.title}.${column.column}`);
    }
  });

  it('an index: AppId everywhere (unique too), and thirteen other columns; the strict check asks for two of them', () => {
    const indexed = columns.filter((column) => column.fake.indexed && column.column !== 'AppId').map((column) => `${column.title}.${column.column}`);
    assert.deepEqual(indexed, [
      'Sessions.ClientId', 'Sections.ClientId', 'Questions.SectionId', 'Options.QuestionId', 'Tracks.SessionId', 'Tracks.ClientId',
      'QRTokens.ClientId', 'QRTokens.SessionId', 'QRTokens.VisitorId', 'VisitorRoster.SessionId', 'UserVisitLogs.SessionId', 'Responses.SessionId', 'Responses.TrackId',
    ]);
    assert.deepEqual(columns.filter((column) => column.fake.unique).map((column) => column.column), lists.map(() => 'AppId'));
    assert.deepEqual(columns.filter((column) => column.check.indexed && column.column !== 'AppId').map((column) => `${column.title}.${column.column}`), ['Sections.ClientId', 'Responses.TrackId']);
    for (const column of columns.filter((each) => each.check.indexed)) assert.equal(column.fake.indexed, true);
  });

  it('the kind the adapter treats a field as goes with its column\'s type', () => {
    const typesOf = (kind) => [...new Set(columns.filter((column) => column.kind === kind).map((column) => column.fake.type))].sort();
    assert.deepEqual(typesOf('array'), ['Note']);
    assert.deepEqual(typesOf('object'), ['Note']);
    assert.deepEqual(typesOf('yesno'), ['Boolean']);
    assert.deepEqual(typesOf('date'), ['DateTime']);
    assert.deepEqual(typesOf('plain'), ['Choice', 'Note', 'Number', 'Text'], 'text of one line or several, a number, or one of a few words: the adapter passes them through');
    // The same field name is the same kind in every list (the adapter's sets are by field name, not by list).
    const kinds = new Map();
    for (const column of columns.filter((each) => each.field)) kinds.set(column.field, new Set([...(kinds.get(column.field) ?? []), `${column.kind}/${column.fake.type}`]));
    // (`status` is an added column of chosen words on Clients and an original one on Sessions: the same kind and the same type.)
    assert.deepEqual([...kinds].filter(([, seen]) => seen.size > 1).map(([field, seen]) => [field, [...seen].sort()]), []);
    assert.deepEqual([...kinds.get('status')], ['plain/Choice']);
  });

  it('the seed checker\'s lists of allowed words are the document\'s', () => {
    const { enums, QUESTION_TYPES } = snapshot.tables['scripts/validate-data.js'];
    const documented = (title, column) => {
      const cell = snapshot.tables['PROVISIONING.md'].lists[title].find((row) => row.column === column)?.type
        ?? snapshot.tables['PROVISIONING.md'].added.find((row) => row.list === title && row.column === column).type;
      return [...cell.matchAll(/`([\w-]+)`/g)].map(([, word]) => word);
    };
    assert.deepEqual(enums['client.status'], documented('Clients', 'Status'));
    assert.deepEqual(enums['session.status'], documented('Sessions', 'Status'));
    assert.deepEqual(enums['session.participationMode'], documented('Sessions', 'ParticipationMode'));
    assert.deepEqual(enums['session.activityFlow'], documented('Sessions', 'ActivityFlow'));
    assert.deepEqual(enums['question.layout'], documented('Questions', 'Layout'));
    assert.deepEqual(QUESTION_TYPES, documented('Questions', 'QuestionType'));
  });

  it('the stub that scripts/test-sharepoint.js builds for itself has the original columns of every list, and none of the added ones', () => {
    const stub = snapshot.tables['scripts/test-sharepoint.js'].columns;
    assert.deepEqual(Object.keys(stub).sort(), lists.map(([, list]) => list.title).sort());
    for (const [, list] of lists) {
      assert.deepEqual(stub[list.title].split(' ').sort(), list.columns.filter((column) => !column.added).map((column) => column.column).sort(), list.title);
    }
  });

  it('the document describes one list more (ThemeConfig, which the new build dropped) and the same columns for the rest', () => {
    const { lists: documented, added } = snapshot.tables['PROVISIONING.md'];
    assert.deepEqual(Object.keys(documented).filter((title) => !lists.some(([, list]) => list.title === title)), ['ThemeConfig']);
    for (const [, list] of lists) {
      const inDocument = [...documented[list.title].map((row) => row.column), ...added.filter((row) => row.list === list.title).map((row) => row.column)];
      assert.deepEqual([...inDocument].sort(), list.columns.map((column) => column.column).sort(), list.title);
    }
  });
});

describe('the reader of a hand-kept table', () => {
  it('reads a literal out of a file\'s text, to the end of its declaration, whatever brackets, strings and comments it holds', () => {
    const text = "import x from 'y';\nconst OTHER = 1;\nexport const TABLE = {\n  a: 'one; two', // not the end; nor is this\n  b: [1, 2, { c: \"}\" }],\n};\nconst AFTER = 2;\n";
    assert.deepEqual(declared(text, 'TABLE'), { a: 'one; two', b: [1, 2, { c: '}' }] });
    assert.equal(declared(text, 'AFTER'), 2);
    assert.deepEqual(declared("const WORDS = new Set(['a', 'b']);\n", 'WORDS'), ['a', 'b']);
  });

  it('fails, in words, on a table that is not there: a snapshot is never made from a table it could not find', () => {
    assert.throws(() => declared('const OTHER = 1;\n', 'TABLE'), /There is no "const TABLE ="/);
    assert.throws(() => declared('const TABLE = { a: 1 }\n', 'TABLE'), /does not end/);
  });

  it('reads the column tables of the document: a list\'s own, and the one of added columns', () => {
    const text = ['### Clients', '', '| Column | Type | Notes |', '|---|---|---|', '| AppId | Single line of text, indexed | e.g. `c-x` |', '| Name | Single line of text | |', '',
      '### Notes', '', 'No table here.', '', '## Columns added for client scoping', '', 'Words.', '', '| List | Internal name | Type | Indexed | What |', '|---|---|---|---|---|',
      '| Clients | `Slug` | Single line of text | no | x |', '| Sections | `ClientId` | Single line of text | **yes** | y |', '', 'Create a document library named `ClientLogos` (not a folder).'].join('\n');
    assert.deepEqual(provisioningTables(text), {
      lists: { Clients: [{ column: 'AppId', type: 'Single line of text, indexed' }, { column: 'Name', type: 'Single line of text' }] },
      added: [{ list: 'Clients', column: 'Slug', type: 'Single line of text', indexed: false }, { list: 'Sections', column: 'ClientId', type: 'Single line of text', indexed: true }],
      library: 'ClientLogos',
    });
  });
});

describe('the comparison can fail', () => {
  const changed = (change) => { const tables = structuredClone(snapshot.tables); change(tables); return tables; };

  it('a column renamed in one copy only is a difference', () => {
    const tables = changed((each) => { each['public/js/dataService.js'].spLists.sections[1].order = 'SortOrder'; });
    assert.notDeepEqual(normalise(tables), snapshot.schema);
    const column = normalise(tables).lists.sections.columns.find((each) => each.field === 'order');
    assert.deepEqual([column.column, column.fake, column.byEye], ['SortOrder', null, null], 'the mock and Setup\'s table do not have it under that name');
  });

  it('a list retitled, a kind changed, an index dropped and a word added are each a difference', () => {
    for (const change of [
      (each) => { each['public/js/dataService.js'].spLists.tracks[0] = 'Participants'; },
      (each) => { each['public/js/dataService.js'].spBooleans.push('status'); },
      (each) => { each['scripts/sharepoint-fake.js'].SCHEMA.Tracks = each['scripts/sharepoint-fake.js'].SCHEMA.Tracks.replace('SessionId:Text!', 'SessionId:Text'); },
      (each) => { each['scripts/sharepoint-fake.js'].CHOICES['Clients.Status'].push('paused'); },
      (each) => { delete each['public/js/dataService.js'].spAdded.options; },
      (each) => { each['migration/src/lib/setup-checks.js'].PROVISIONED.options += ' ImageUrl:Text'; },
    ]) assert.notDeepEqual(normalise(changed(change)), snapshot.schema);
  });
});
