// Phase 10c-2b, part E: the version of the lists, read with the AppSettings item that every page reads first, and what a page does on
// lists of another version. Run: node --test scripts/test-schema-version.js (part of `npm test`).
//
// What this holds, on the mocked SharePoint REST: SchemaVersion on the item `default` of PMSAppSettings is read and never written; this
// build is for version 8 (7 until Prompt 21 Phase 5, 6 until its Phase 4, 5 until its Phase 3, 4 until Prompt 21, 3 until Phase 20, 2 until Phase 10i); a missing item, a missing list or no SchemaVersion is PMS-LST-010, a lower version PMS-LST-011 and a higher one
// PMS-LST-012, from every read of that item (getAppSettings, readLists, readParticipantWatch) and at no extra request; the data layer
// hands the code to the page's stop handler (lib/settings/start.ts) and throws it; the local server has no version. What it does not hold: what
// the real site answers. A page opened on the real site before Setup has run is QA-TESTING.md's to see.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VERSION } from '../migration/src/lib/schema/pms-schema.js';
import { STRAYS, TITLE, UNINDEXED, createSharePointFake } from './sharepoint-fake.js';

let copies = 0;
/** A data layer of its own (one module is one page), pointed at `fake`, with a stop handler that notes what it is handed. */
async function pageOn(fake) {
  const ds = await import(`../migration/src/lib/data/dataService.js?schema-version=${copies += 1}`);
  const stops = [];
  ds.configure({ sharePoint: fake.settings, onStop: (code) => stops.push(code) });
  return { ds, stops };
}
const site = (schemaVersion, options = {}) => {
  const fake = createSharePointFake({ schemaVersion, ...options });
  fake.install();
  return fake;
};
const coded = (code) => (error) => error.code === code && error.message === code;

describe('the version of the lists', () => {
  it('this build is for version 8 (7 until Prompt 21 Phase 5, 6 until its Phase 4, 5 until its Phase 3, 4 until Prompt 21, 3 until Phase 20, 2 until Phase 10i), and a site the mock sets up says 8 on its AppSettings item, as Setup will write it', () => {
    assert.equal(VERSION, 8);
    const fake = createSharePointFake();
    assert.deepEqual(fake.lists.get('appsettings').map((row) => [row.AppId, row.SchemaVersion]), [['default', 8]]);
    assert.equal(createSharePointFake({ schemaVersion: null }).lists.get('appsettings').length, 0, 'and a test can ask for a site Setup has not run on');
  });

  it('on version 8 every read of the item works, at the requests it always cost, and nothing stops', async () => {
    const fake = site(8);
    const { ds, stops } = await pageOn(fake);
    fake.reset();
    assert.equal((await ds.getAppSettings()).schemaVersion, 8);
    assert.equal(fake.count(), 1, 'one read, as before: the version comes with the item');
    fake.reset();
    const [settings] = await ds.readLists([{ list: 'appsettings' }, { list: 'clients' }]);
    assert.equal(settings[0].schemaVersion, 8);
    assert.equal(fake.count((entry) => entry.parts), 1, 'one $batch, as before');
    fake.reset();
    assert.equal((await ds.readParticipantWatch({})).settings.schemaVersion, 8);
    assert.equal(fake.count(), 1);
    assert.deepEqual(stops, []);
  });

  for (const [what, prepare, code] of [
    ['no AppSettings item at all', (fake) => fake.lists.get('appsettings').splice(0), 'PMS-LST-010'],
    ['an item with no SchemaVersion', (fake) => { delete fake.item('appsettings', 'default').SchemaVersion; }, 'PMS-LST-010'],
    ['version 1', (fake) => { fake.item('appsettings', 'default').SchemaVersion = 1; }, 'PMS-LST-011'],
    // (Version 2: the PCOE site before Setup adds what version 3 needs, Phase 10i.)
    ['version 2', (fake) => { fake.item('appsettings', 'default').SchemaVersion = 2; }, 'PMS-LST-011'],
    // (Version 3: a site before Setup adds what version 4 needs, Phase 20.)
    ['version 3', (fake) => { fake.item('appsettings', 'default').SchemaVersion = 3; }, 'PMS-LST-011'],
    // (Version 4: an item that says 4 on lists that have version 5's columns; a site Setup made for version 4 is the next test's.)
    ['version 4', (fake) => { fake.item('appsettings', 'default').SchemaVersion = 4; }, 'PMS-LST-011'],
    // (Version 5: an item that says 5 on lists that have version 6's columns; a site Setup made for version 5 is scripts/test-sessions-plan.js's.)
    ['version 5', (fake) => { fake.item('appsettings', 'default').SchemaVersion = 5; }, 'PMS-LST-011'],
    // (Version 6: an item that says 6 on lists that lack version 7's GuestGroup; a site Setup made for version 6 is scripts/test-schema-upgrade.js's.)
    ['version 6', (fake) => { fake.item('appsettings', 'default').SchemaVersion = 6; }, 'PMS-LST-011'],
    // (Version 7: an item that says 7 on lists that lack version 8's PMSSessionSummary and the clients' Industry and Region.)
    ['version 7', (fake) => { fake.item('appsettings', 'default').SchemaVersion = 7; }, 'PMS-LST-011'],
    ['version 9', (fake) => { fake.item('appsettings', 'default').SchemaVersion = 9; }, 'PMS-LST-012'],
  ]) {
    it(`${what}: every read of the item says ${code}, to the page's stop handler and as what it throws, at no extra request`, async () => {
      const fake = site(5);
      prepare(fake);
      const { ds, stops } = await pageOn(fake);
      fake.reset();
      await assert.rejects(ds.getAppSettings(), coded(code));
      assert.equal(fake.count(), 1);
      fake.reset();
      await assert.rejects(ds.readLists([{ list: 'appsettings' }, { list: 'clients' }]), coded(code));
      assert.equal(fake.count((entry) => entry.parts), 1);
      fake.reset();
      await assert.rejects(ds.readParticipantWatch({ sessionId: 's' }), coded(code));
      assert.equal(fake.count(), 1);
      assert.deepEqual(stops, [code, code, code]);
    });
  }

  it('a site Setup made for version 4 (Prompt 21: neither setting column, which every read of the item names): every read says PMS-LST-011, at one request more', async () => {
    const fake = site(4, { listsVersion: 4 });
    const { ds, stops } = await pageOn(fake);
    fake.reset();
    await assert.rejects(ds.getAppSettings(), (error) => coded('PMS-LST-011')(error) && error.version === 4 && error.wanted === 8);
    assert.equal(fake.count(), 2, 'the refused read, then the version alone');
    await assert.rejects(ds.readLists([{ list: 'appsettings' }, { list: 'clients' }]), coded('PMS-LST-011'));
    await assert.rejects(ds.readParticipantWatch({ sessionId: 's' }), coded('PMS-LST-011'));
    assert.deepEqual(stops, ['PMS-LST-011', 'PMS-LST-011', 'PMS-LST-011']);
  });

  it('a site with no AppSettings list at all (nothing has been made): PMS-LST-010, and the admin\'s first read, the facilitators, says so too', async () => {
    const fake = site(null, { without: ['appsettings', 'adminusers'] });
    const { ds, stops } = await pageOn(fake);
    await assert.rejects(ds.getAppSettings(), coded('PMS-LST-010'));
    await assert.rejects(ds.listAdminUsers(), coded('PMS-LST-010'));
    assert.deepEqual(stops, ['PMS-LST-010', 'PMS-LST-010']);
  });

  it('Go live on a site Setup has not run on is refused before anything is written; on a provisioned one it writes the item and leaves its version alone', async () => {
    const bare = site(null);
    const { ds } = await pageOn(bare);
    bare.add('clients', { AppId: 'c-a', Title: 'A', Name: 'A', Slug: 'a', Status: 'active' });
    await assert.rejects(ds.activateClient('c-a', '2026-10-14'), coded('PMS-LST-010'));
    assert.equal(bare.count((entry) => entry.method !== 'GET' && !entry.path.endsWith('/contextinfo')), 0, 'nothing was written');
    const ready = site(8);
    const page = await pageOn(ready);
    ready.add('clients', { AppId: 'c-a', Title: 'A', Name: 'A', Slug: 'a', Status: 'active' });
    await page.ds.activateClient('c-a', '2026-10-14');
    assert.deepEqual([ready.item('appsettings', 'default').ActiveClientId, ready.item('appsettings', 'default').SchemaVersion], ['c-a', 8], 'the version is read, never written');
  });

  it('a page with no stop handler (Setup, a test) is only thrown the code; and the local server has no version to check', async () => {
    const fake = site(1);
    const ds = await import(`../migration/src/lib/data/dataService.js?schema-version=${copies += 1}`);
    ds.configure({ sharePoint: fake.settings });
    await assert.rejects(ds.getAppSettings(), coded('PMS-LST-011'));
    const local = await import(`../migration/src/lib/data/dataService.js?schema-version=${copies += 1}`);
    local.configure({ baseUrl: 'http://local.invalid/api' });
    const real = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ id: 'default', activeSessionId: null }), { status: 200 });
    try { assert.deepEqual(await local.getAppSettings(), { id: 'default', activeSessionId: null }); } finally { globalThis.fetch = real; }
  });

  it('Setup says each case in full, in the words the brief gave (lib/settings/deploy-problems.js; the other pages show the code)', async () => {
    const { LISTS_PROBLEM_IDS, problem } = await import('../migration/src/lib/settings/deploy-problems.js');
    assert.deepEqual(LISTS_PROBLEM_IDS, ['PMS-LST-010', 'PMS-LST-011', 'PMS-LST-012']);
    const said = (id, version) => { const found = problem({ id, version, wanted: VERSION }); return `${found.title}. ${found.next}`; };
    assert.equal(said('PMS-LST-010', null), "This site's lists have not been set up for this app yet. Open Setup.");
    assert.equal(said('PMS-LST-011', 2), "This site's lists need an update before this version of the app can use them. Open Setup (setup.html, in the same folder as this page), press Show the plan, then Create, then Mark the site as ready: a clean Create does the last step by itself.");
    assert.equal(said('PMS-LST-012', 8), 'This site has been updated for a newer version of the app. Upload the newer files.');
    assert.equal(problem({ id: 'PMS-LST-011', version: 2, wanted: 3 }).technical, 'PMS-LST-011, SchemaVersion 2, this build needs 3');
    // What the data layer throws carries what Setup needs to say it.
    const fake = site(9);
    const { ds } = await pageOn(fake);
    await assert.rejects(ds.getAppSettings(), (error) => error.code === 'PMS-LST-012' && error.version === 9 && error.wanted === 8);
  });

  it('no request of this suite reached a list that is not its own, or filtered on a column with no index', () => {
    assert.deepEqual(STRAYS.map((entry) => `${entry.method} ${entry.title}`), []);
    assert.deepEqual(UNINDEXED.map((entry) => `${entry.list}.${entry.unindexed}`), []);
    assert.ok(TITLE.appsettings);
  });
});
