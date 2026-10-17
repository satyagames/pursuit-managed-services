// Phase 10c-3: Setup's plan and Create on a copy of the app whose settings say `"listPrefix": "Test"`, on a site that also holds the lists of a copy
// with no prefix. Run: node --test scripts/test-provision-prefix.js (part of `npm test`).
//
// The whole of scripts/test-provision.js is also run a second time on Test lists by scripts/test-list-namespace.js, which fails if any request names a
// list without the prefix. These two tests name the prefix themselves, so they are kept out of that suite (whose recorded requests a second run on
// Test lists must match with the prefix taken off) and are not recorded in a request baseline.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LISTS } from '../migration/src/lib/schema/pms-schema.js';
import { create, showPlan, siteApi } from '../migration/src/lib/setup/provision.js';
import { STRAYS, TITLE, createSharePointFake } from './sharepoint-fake.js';

const KEYS = Object.keys(LISTS);
const EVERYTHING = [...KEYS, 'logoLibrary'];
let pages = 0;
async function siteWith(options) {
  const fake = createSharePointFake({ schemaVersion: null, prefix: 'Test', ...options });
  fake.install();
  const ds = await import(`../migration/src/lib/data/dataService.js?provision-prefix=${pages += 1}`);
  ds.configure({ sharePoint: fake.settings });
  return { fake, api: siteApi(ds), titles: ds.sharePointListTitles() };
}
const plan = async (site) => (await showPlan(site.api, site.titles)).plan;
const named = (fake) => fake.requests.map((entry) => entry.title ?? entry.path.replace(/^.*\/_api/, ''));

describe('"listPrefix": "Test", beside the lists of a copy with no prefix', () => {
  it('the plan names only Test... lists, and never reads the lists of the copy without a prefix', async () => {
    const site = await siteWith({ without: EVERYTHING });
    const made = await plan(site);
    assert.deepEqual(made.lists.map((item) => item.title), [...KEYS.map((key) => `Test${TITLE[key]}`), `Test${TITLE.logoLibrary}`]);
    assert.ok(made.columns.every((item) => item.list.startsWith('Test')) && made.settings.every((item) => item.list.startsWith('Test')));
    assert.ok(site.fake.otherLists.has(TITLE.clients), 'the other copy\'s lists are on the site');
    assert.deepEqual(site.fake.strays, []);
    const complete = await siteWith();
    assert.equal((await plan(complete)).summary, 'Nothing to create');
    assert.ok(named(complete.fake).every((title) => title === '/web/lists' || title.startsWith('Test')), 'it read the Test lists alone');
    assert.deepEqual(complete.fake.strays, []);
  });

  it('Create makes only Test... lists, and touches none of the lists without a prefix', async () => {
    const site = await siteWith({ without: EVERYTHING });
    const result = await create(site.api, await plan(site), { gapMs: 0 });
    assert.equal(result.ok, true, result.failure?.words);
    assert.ok(site.fake.writes().length > 100);
    assert.ok(site.fake.writes().every((entry) => entry.title?.startsWith('Test')), 'every write named a Test list');
    assert.deepEqual(site.fake.strays, [], 'and none reached the lists without a prefix');
    assert.ok([...site.fake.otherLists.values()].every((rows) => rows.every((row) => row.AppId === 'default')), 'their items are as they were');
    assert.equal((await plan(site)).summary, 'Nothing to create');
  });

  it('no request of this suite reached a list that is not its own', () => {
    assert.deepEqual(STRAYS, []);
  });
});
