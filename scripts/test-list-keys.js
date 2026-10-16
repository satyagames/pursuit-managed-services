// Phase 10c-2b, part B: the tests name a list by its key ('sections'), never by its title ('Sections'), wherever they talk to the
// mocked SharePoint or about a request in its log, so that a list can be renamed without touching a test.
// Run: node --test scripts/test-list-keys.js (part of `npm test`).
//
// The mock refuses a name that is not a key where it is handed one (fake.item, fake.titleOf, fake.select({ list }), without,
// rewriteMerges). What it cannot see is a test comparing a logged request's `list` with a title itself (`entry.list === 'Sections'`):
// that comparison is simply never true, and an assertion that something was NOT sent passes for ever. This scan is for that.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { LIBRARY_KEY, PHASE_4_COLUMNS, TITLE, createSharePointFake } from './sharepoint-fake.js';

const ROOT = path.join(import.meta.dirname, '..');
const OLD = ['Clients', 'Sessions', 'Sections', 'Questions', 'Options', 'Tracks', 'QRTokens', 'AdminUsers', 'Responses', 'AppSettings', 'VisitorRoster', 'UserVisitLogs', 'ClientLogos'];
const WORD = `(?:${OLD.join('|')})`;
/** The ways a test can name a list to the mock or about its log, with a title in the place of a key. */
const BY_TITLE = [
  ['fake.item / fake.add / fake.titleOf', new RegExp(`\\.(?:item|add|titleOf)\\(\\s*['"\`]${WORD}['"\`]`)],
  ['fake.lists / fake.fields', new RegExp(`\\.(?:lists|fields)\\.(?:get|set|delete|has)\\(\\s*['"\`]${WORD}['"\`]`)],
  ['entry.list compared with a title', new RegExp(`\\b(?:entry|part|read|request|call|each|inner)\\.list\\s*[!=]==?\\s*['"\`]${WORD}['"\`]`)],
  ['{ list: <title> } given to fake.count / fake.select / rewriteMerges', new RegExp(`\\b(?:count|select|rewriteMerges)\\(\\{[^}]*\\blist:\\s*['"\`]${WORD}['"\`]`)],
  ['without: [<title>]', new RegExp(`\\bwithout:\\s*\\[[^\\]]*['"\`]${WORD}(?:\\.\\w+)?['"\`]`)],
  ['a request written as "METHOD <title>"', new RegExp(`['"\`](?:GET|POST|MERGE|DELETE) ${WORD}\\b`)],
];

async function testFiles() {
  const scripts = (await readdir(path.join(ROOT, 'scripts'))).filter((name) => name.endsWith('.js')).map((name) => `scripts/${name}`);
  const specs = (await readdir(path.join(ROOT, 'scripts', 'migration-tests'))).filter((name) => name.endsWith('.ts')).map((name) => `scripts/migration-tests/${name}`);
  // (This file, the snapshot of the old names and the tools that read the old tables say the old titles on purpose.)
  return [...scripts, ...specs].filter((file) => !/scripts\/(test-list-keys|schema-snapshot|test-schema-baseline|request-baseline|test-request-baseline)\.js$/.test(file));
}

describe('the tests name lists by key', () => {
  it('no test names a list to the mock, or reads the mock\'s log, by a title', async () => {
    const found = [];
    for (const file of await testFiles()) {
      const lines = (await readFile(path.join(ROOT, file), 'utf8')).split('\n');
      lines.forEach((line, index) => {
        const code = line.replace(/\/\/.*$/, '');
        for (const [what, pattern] of BY_TITLE) if (pattern.test(code)) found.push(`${file}:${index + 1}: ${what}: ${line.trim().slice(0, 140)}`);
      });
    }
    assert.deepEqual(found, []);
  });

  it('the scan can fail: each way of naming a list by its title is caught', () => {
    for (const line of [
      "fake.item('Sections', 'a')", "fake.lists.get('Tracks').length", "fake.requests.filter((entry) => entry.list === 'Responses')",
      "fake.count({ method: 'POST', list: 'UserVisitLogs' })", "createSharePointFake({ without: ['Clients.Slug'] })", "['GET AppSettings', 'GET Clients']",
    ]) assert.ok(BY_TITLE.some(([, pattern]) => pattern.test(line)), line);
    for (const line of ["fake.item('sections', 'a')", "entry.list === 'responses'", "`${TITLE.sections}.ClientId: Missing.`", "getByRole('tab', { name: 'Clients' })"]) {
      assert.ok(!BY_TITLE.some(([, pattern]) => pattern.test(line)), line);
    }
  });

  it('the mock refuses a name that is not a key, wherever it is handed one', () => {
    const fake = createSharePointFake();
    assert.throws(() => fake.item('Sections', 'a'), /knows no list "Sections": name a list by its key/);
    assert.throws(() => fake.titleOf('Tracks'), /knows no list "Tracks"/);
    assert.throws(() => fake.select({ method: 'GET', list: 'Responses' }), /knows no list "Responses"/);
    assert.throws(() => fake.rewriteMerges({ list: 'Clients' }), /knows no list "Clients"/);
    assert.throws(() => createSharePointFake({ without: ['Clients.Slug'] }), /knows no list "Clients"/);
    assert.equal(fake.item('sections', 'a'), undefined);
    assert.deepEqual(fake.select({ list: 'sections' }), []);
  });

  it('every list has a key and a title, and so does the picture library', () => {
    assert.deepEqual(Object.keys(TITLE), ['clients', 'sessions', 'sections', 'questions', 'options', 'tracks', 'qrtokens', 'appsettings', 'visitorroster', 'uservisitlogs', 'adminusers', 'responses', LIBRARY_KEY]);
    assert.ok(PHASE_4_COLUMNS.every((name) => /^[a-z]+\.[A-Z]\w+$/.test(name)), 'columns to take away, as `without` takes them');
    const fake = createSharePointFake({ prefix: 'PMS3' });
    assert.equal(fake.titleOf('qrtokens'), `PMS3${TITLE.qrtokens}`);
  });
});
