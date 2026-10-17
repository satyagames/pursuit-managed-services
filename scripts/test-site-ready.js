// Phase 10c-3, part D: the site is marked ready only when the check is clean. Run: node --test scripts/test-site-ready.js (part of `npm test`).
//
// "Mark the site as ready" (migration/src/lib/setup/provision.js, markReady) runs Setup's strict check (Check Lists, from pms-schema-meta.js) and looks for the
// picture library; only when both find nothing wrong does it write the version of the lists, the last thing Setup writes: the PMSAppSettings item
// `default` with Title `default` and SchemaVersion (this build's VERSION: 3 since Phase 10i; the other columns left empty), or SchemaVersion alone on an item that has none. A half-built or
// wrong site never claims to be ready. Before it, every page of the app stops with PMS-LST-010; after it, they work. Against the mocked SharePoint REST;
// what the real site answers is QA-TESTING.md's to see.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ID, LISTS, VERSION } from '../migration/src/lib/schema/pms-schema.js';
import { create, markReady, showPlan, siteApi } from '../migration/src/lib/setup/provision.js';
import { schemaSpecs } from '../migration/src/lib/setup/setup-checks.js';
import { STRAYS, UNINDEXED, createSharePointFake } from './sharepoint-fake.js';

const EVERYTHING = [...Object.keys(LISTS), 'logoLibrary'];
let pages = 0;
/** A data layer of its own (one module is one page), on a fake site; `check` is Setup's strict check, as the page runs it. */
async function siteWith(options = {}) {
  const fake = createSharePointFake({ schemaVersion: null, ...options });
  fake.install();
  const ds = await import(`../migration/src/lib/data/dataService.js?site-ready=${pages += 1}`);
  ds.configure({ sharePoint: fake.settings });
  const titles = ds.sharePointListTitles();
  return { fake, ds, api: siteApi(ds), titles, check: () => ds.checkSharePointSchema({ specs: schemaSpecs }) };
}
/** Show the plan and Create, as the page does them, without the pause between writes. */
async function built(options = {}) {
  const site = await siteWith({ without: EVERYTHING, ...options });
  const { plan } = await showPlan(site.api, site.titles);
  const result = await create(site.api, plan, { gapMs: 0 });
  assert.equal(result.ok, true, result.failure?.words);
  site.fake.reset();
  return site;
}
const ready = (site) => markReady(site.api, site.titles, { check: site.check });
const settingsItems = (fake) => fake.lists.get('appsettings') ?? [];

describe('Mark the site as ready', () => {
  it('on a site Create has just made: the check passes with nothing to fix, and the item is written last, Title and SchemaVersion and nothing else', async () => {
    const site = await built({ traps: { richText: 'default', uniqueNeedsIndex: true, uniqueApart: true } });
    const report = await site.check();
    assert.deepEqual(report.filter((list) => !list.ready).map((list) => [list.list, list.problems]), [], 'SharePoint\'s own Title, required as SharePoint makes it, is not a problem');
    const today = await site.ds.checkSharePointSchema({ batch: true });
    assert.deepEqual(today.filter((list) => !list.ready).map((list) => [list.list, list.problems]), [], 'nor for the admin\'s Today, which would otherwise block Go live');
    site.fake.reset();
    const result = await ready(site);
    assert.equal(result.ready, true, result.words);
    assert.equal(result.wrote, 'created');
    assert.equal(result.words, `The site is marked ready: every list passed the check, and the settings item of ${site.titles.appsettings} now says version ${VERSION}.`);
    const writes = site.fake.writes();
    assert.equal(writes.length, 1, 'one write');
    assert.equal(writes[0].method, 'POST');
    assert.equal(writes[0], site.fake.requests.findLast((entry) => entry.method !== 'GET' && !entry.path.endsWith('/contextinfo')), 'and it is the last request but the check that it landed');
    assert.deepEqual(settingsItems(site.fake).map(({ Id, __metadata, ...item }) => item), [{ Title: 'default', [ID]: 'default', SchemaVersion: VERSION }], 'the other columns empty');
    assert.equal((await site.ds.getAppSettings()).schemaVersion, VERSION, 'every page now finds the version it needs');
  });

  it('an item that exists without a version (made by hand, against the advice) gets SchemaVersion alone', async () => {
    const site = await built();
    site.fake.add('appsettings', { AppId: 'default', Title: 'default', ActiveSessionId: 'kept' });
    const result = await ready(site);
    assert.equal(result.wrote, 'version');
    const merge = site.fake.writes().find((entry) => entry.method === 'MERGE');
    assert.ok(merge, 'a MERGE of the item');
    assert.equal(site.fake.writes().length, 1);
    assert.equal(settingsItems(site.fake).length, 1);
    assert.deepEqual([settingsItems(site.fake)[0].SchemaVersion, settingsItems(site.fake)[0].ActiveSessionId], [VERSION, 'kept'], 'what it held is kept');
  });

  it('a second press writes nothing: the site is already marked ready', async () => {
    const site = await built();
    await ready(site);
    site.fake.reset();
    const again = await ready(site);
    assert.deepEqual([again.ready, again.wrote], [true, null]);
    assert.equal(again.words, `The site was already marked ready (version ${VERSION}). Nothing was written.`);
    assert.equal(site.fake.writes().length, 0);
  });

  it('never on a site with one wrong column: nothing is written, and the problem is named', async () => {
    const site = await built();
    site.fake.field('sections', 'SortOrder').TypeAsString = 'Text';
    const result = await ready(site);
    assert.deepEqual([result.ready, result.wrote], [false, null]);
    assert.equal(result.words, 'Not marked ready: the check found 1 problem. Fix it (it is listed below, with what Setup will not touch), then press Mark the site as ready again.');
    assert.deepEqual(result.problems.map((problem) => [problem.list, problem.column, problem.problem]), [[site.titles.sections, 'SortOrder', 'Wrong type: it is Single line of text.']]);
    assert.equal(site.fake.writes().length, 0);
    assert.equal(settingsItems(site.fake).length, 0);
    await assert.rejects(site.ds.getAppSettings(), (error) => error.code === 'PMS-LST-010', 'and every page still stops');
  });

  it('never on a half-built site: a missing list, a missing column, or no picture library', async () => {
    for (const [without, expected] of [[['clients.Slug'], 1], [['uservisitlogs'], 1], [['logoLibrary'], 1]]) {
      const site = await siteWith({ without });
      const result = await ready(site);
      assert.equal(result.ready, false, without.join());
      assert.equal(result.problems.length, expected, `${without}: ${JSON.stringify(result.problems)}`);
      assert.equal(site.fake.writes().length, 0);
    }
    const shelf = await siteWith({ without: ['logoLibrary'] });
    assert.deepEqual((await ready(shelf)).problems, [{ list: shelf.titles.logoLibrary, column: null, type: null, problem: `The picture library "${shelf.titles.logoLibrary}" does not exist.` }]);
  });

  // (Phase 10i: a LOWER version, 1 or 2, is raised once the check is clean; scripts/test-schema-upgrade.js holds that on the PCOE site of version 2.)
  it('never lowers a higher version (4), and leaves a value that is no version of these lists (0) as it is', async () => {
    for (const [version, words] of [[4, 'Setup never lowers the version of the lists: upload the newer files.'], [0, null]]) {
      const site = await siteWith({ schemaVersion: version });
      const result = await ready(site);
      assert.deepEqual([result.ready, result.wrote], [false, null]);
      assert.equal(result.words, words ? `Not marked ready: the settings item says version ${version}; this version of the app is for version ${VERSION}. ${words}`
        : `Not marked ready: the settings item says version ${version}, which is no version of these lists. Setup does not change it.`);
      assert.equal(site.fake.writes().length, 0);
      assert.equal(site.fake.item('appsettings', 'default').SchemaVersion, version);
    }
  });

  it('two items called default: it writes nothing and says so', async () => {
    const site = await built();
    site.fake.add('appsettings', { AppId: 'default', Title: 'default' });
    site.fake.add('appsettings', { AppId: 'default', Title: 'default' });
    const result = await ready(site);
    assert.equal(result.ready, false);
    assert.match(result.words, /two items with the AppId default/);
    assert.equal(site.fake.writes().length, 0);
  });
});

describe('the pages, before and after', () => {
  it('before it every page stops with PMS-LST-010; after it, they read the lists', async () => {
    const site = await built();
    const stops = [];
    site.ds.configure({ sharePoint: site.fake.settings, onStop: (code) => stops.push(code) });
    await assert.rejects(site.ds.getAppSettings(), (error) => error.code === 'PMS-LST-010');
    await assert.rejects(site.ds.readParticipantWatch({}), (error) => error.code === 'PMS-LST-010');
    assert.deepEqual(stops, ['PMS-LST-010', 'PMS-LST-010']);
    site.ds.configure({ sharePoint: site.fake.settings });
    await ready(site);
    site.ds.configure({ sharePoint: site.fake.settings, onStop: (code) => stops.push(code) });
    assert.equal((await site.ds.getAppSettings()).schemaVersion, VERSION);
    assert.equal((await site.ds.readParticipantWatch({})).settings.schemaVersion, VERSION);
    assert.deepEqual(await site.ds.listAdminUsers(), []);
    assert.equal(stops.length, 2, 'no stop after it');
  });
});

describe('the suite', () => {
  it('no request of this suite reached a list that is not its own, and none filtered on a column the lists do not index', () => {
    assert.deepEqual(STRAYS, []);
    assert.deepEqual(UNINDEXED, []);
  });
});
