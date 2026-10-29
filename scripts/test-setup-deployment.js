// Phase 10b: what Setup says about this copy of the app (migration/src/lib/setup/setup-deployment.js), as plain cases, and its read-only
// look at where the lists are, against the mocked SharePoint REST. Run: node --test scripts/test-setup-deployment.js (part of `npm test`).
//
// The panel's rows are made from the resolver's own answer, so they are tested from it: nothing here builds a row by hand. Whether a
// real site answers `web/GetList`, or `$expand=RootFolder`, the way the mock does has not been seen: that is what the rows and the
// probe are for, on the first visit to a real site (QA-TESTING.md, item 92).
import './fresh-page.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { resolveSettings } from '../migration/src/lib/settings/deploy-settings.js';
import { copyRows, folderOf, listRows, readListAddresses, sameListByAddress, waysToFix } from '../migration/src/lib/setup/setup-deployment.js';
import { OTHER_PREFIX, STRAYS, TITLE, UNINDEXED, createSharePointFake } from './sharepoint-fake.js';

const ROOT = path.join(import.meta.dirname, '..');
const SITE = 'https://americas.internal.deloitteonline.com/sites/CreativeExpCOE';
const PAGE = `${SITE}/Shared%20Documents/p_cec_03/setup.html`;
const BUILD = 'pms-1a2b3c4';
const realFetch = globalThis.fetch;

let pages = 0;
const freshPage = async (settings) => {
  const page = await import(`../migration/src/lib/data/dataService.js?setup=${pages += 1}`);
  page.configure(settings);
  return page;
};

/** The panel's rows for a page that started with this file and these built-in values, as `Label | value | (source)`. */
async function panel(input, pageUrl = PAGE) {
  const found = resolveSettings({ pageUrl, ...input });
  const ds = await freshPage({ baseUrl: '/api' });
  const local = found.settings === null && found.problems.length === 0;
  const rows = copyRows(found, { pageUrl, local, titles: local ? null : ds.sharePointListTitles(found.known), build: BUILD });
  return rows.map((row) => `${row.label} | ${row.value} | ${row.source}`);
}

describe('"This copy of the app": the rows, and where each value came from', () => {
  it('the example of ARCHITECTURE-10.md 2.3 (in git history at 7347c72): a prefix and a support contact from the file, a label built in, the rest worked out', async () => {
    assert.deepEqual(await panel({ file: { configVersion: 1, listPrefix: 'PMS3', support: { name: 'Asha Rao', contact: 'asha.rao@example.com' } }, built: { label: 'Test, folder 3' } }), [
      `Opened from | ${SITE}/Shared Documents/p_cec_03/ | `,
      `Site | ${SITE} | from this page's address`,
      `Lists | PMS3${TITLE.clients}, PMS3${TITLE.sessions}, ... (16) | prefix "PMS3" from pms-config.txt`,
      `Picture library | PMS3${TITLE.logoLibrary} | default for this prefix`,
      'Grouped reads | on | default',
      'Support | Asha Rao, asha.rao@example.com | from pms-config.txt',
      'Label | Test, folder 3 | built in',
      `Build | ${BUILD} | built in`,
    ]);
  });

  it('every source is said: the file, the build, the address, a default; an empty prefix is said as "no prefix"; a list named on its own is listed', async () => {
    assert.deepEqual(await panel({ file: { listPrefix: '' } }), [
      `Opened from | ${SITE}/Shared Documents/p_cec_03/ | `,
      `Site | ${SITE} | from this page's address`,
      `Lists | ${TITLE.clients}, ${TITLE.sessions}, ... (16) | no prefix from pms-config.txt`,
      `Picture library | ${TITLE.logoLibrary} | default`,
      'Grouped reads | on | default',
      'Support | Not set | ',
      'Label | Not set | ',
      `Build | ${BUILD} | built in`,
    ]);
    assert.deepEqual(await panel({
      file: { lists: { qrtokens: 'GuestCodes', adminusers: 'Admin accounts' }, batch: false, label: 'From the file' },
      built: { siteUrl: SITE, listPrefix: 'PMS3', logoLibrary: 'Client Pictures', support: { contact: 'https://example.com/help' } },
    }), [
      `Opened from | ${SITE}/Shared Documents/p_cec_03/ | `,
      `Site | ${SITE} | built in`,
      `Lists | PMS3${TITLE.clients}, PMS3${TITLE.sessions}, ... (16) | prefix "PMS3" built in; 2 named on their own from pms-config.txt: qrtokens is GuestCodes, adminusers is Admin accounts`,
      'Picture library | Client Pictures | built in',
      'Grouped reads | off | from pms-config.txt',
      'Support | https://example.com/help | built in',
      'Label | From the file | from pms-config.txt',
      `Build | ${BUILD} | built in`,
    ]);
    assert.match((await panel({ file: { listPrefix: 'PMS3', lists: { qrtokens: 'GuestCodes' } } }))[2], /; 1 named on its own from pms-config\.txt: qrtokens is GuestCodes$/);
  });

  it('with a problem the rows still say what is known, and that nothing names the lists', async () => {
    assert.deepEqual(await panel({ file: { label: 'Folder 3' } }), [
      `Opened from | ${SITE}/Shared Documents/p_cec_03/ | `,
      `Site | ${SITE} | from this page's address`,
      'Lists | Not named yet | nothing gives a list prefix',
      'Picture library | Not named yet | it follows the list prefix',
      'Grouped reads | on | default',
      'Support | Not set | ',
      'Label | Folder 3 | from pms-config.txt',
      `Build | ${BUILD} | built in`,
    ]);
    // A file that could not be read: what is built in is shown as what is built in, though the page did not use it.
    const unread = await panel({ fileError: { kind: 'status', status: 503 }, built: { listPrefix: 'PMS3' } });
    assert.equal(unread[2], `Lists | PMS3${TITLE.clients}, PMS3${TITLE.sessions}, ... (16) | prefix "PMS3" built in`);
  });

  it('on the local server there is no site and no settings file: the panel says so and names the build', async () => {
    assert.deepEqual(await panel({}, 'http://192.168.1.20:3000/p_cec_02/setup.html'), [
      'Opened from | http://192.168.1.20:3000/p_cec_02/ | ',
      'Site | None: this is the local server | plain http, or this computer',
      "Lists | The local server's own files | no settings file is read here",
      `Build | ${BUILD} | built in`,
    ]);
  });

  it('the folder is the page\'s address without the page: query and # gone, a space shown as a space', () => {
    assert.equal(folderOf(`${PAGE}?x=1#today`), `${SITE}/Shared Documents/p_cec_03/`);
    assert.equal(folderOf('https://tenant.example/index.html'), 'https://tenant.example/');
  });

  it('the two ways to put it right name the file, the smallest one that works, the empty prefix on purpose, and the build value', () => {
    const [file, build] = waysToFix();
    assert.match(file, /Put a file called pms-config\.txt in the same folder as these three pages\./);
    assert.ok(file.includes('{ "configVersion": 1, "listPrefix": "PMS3" }'));
    assert.match(file, /say so on purpose with "listPrefix": ""\./);
    assert.match(build, /PMS_LIST_PREFIX=PMS3 npm run build:svelte:release/);
    assert.match(build, /A settings file, when there is one, still wins over what is built in\./);
    assert.equal(waysToFix().length, 2);
    assert.ok(waysToFix('TEST9')[0].includes('"listPrefix": "TEST9"') && waysToFix('TEST9')[0].includes('TEST9Clients'));
  });
});

describe('"Where the lists are": SharePoint\'s own answer for each title, and one list asked for by its address', () => {
  /** A site and a page on it; `read` is what Setup hands the module: one GET, never throwing. */
  async function site(options = {}) {
    const fake = createSharePointFake(options);
    fake.install();
    const page = await freshPage({ sharePoint: fake.settings });
    const read = (resource) => page.probeSharePointRead(null, resource);
    fake.reset();
    return { fake, page, read, titles: page.sharePointListTitles() };
  }
  const restore = () => { globalThis.fetch = realFetch; };

  it('before anything is asked there is a row for each of the sixteen lists (twelve until Prompt 21, fifteen until its Phase 5) and one for the picture library, with the title this copy asks by', async () => {
    const { page } = await site({ prefix: OTHER_PREFIX, lists: { qrtokens: 'GuestCodes' } });
    try {
      const rows = listRows(page.sharePointListTitles());
      assert.equal(rows.length, 17);
      assert.deepEqual(rows.map((row) => row.title).slice(0, 3), [`${OTHER_PREFIX}${TITLE.clients}`, `${OTHER_PREFIX}${TITLE.sessions}`, `${OTHER_PREFIX}${TITLE.sections}`]);
      assert.equal(rows.find((row) => row.key === 'qrtokens').title, 'GuestCodes');
      assert.deepEqual(rows.at(-1), { key: 'logoLibrary', title: `${OTHER_PREFIX}${TITLE.logoLibrary}`, library: true, asked: false, found: false, address: '', id: '', note: '' });
      assert.ok(rows.every((row) => !row.asked && !row.address && !row.id));
    } finally { restore(); }
  });

  for (const prefix of ['', OTHER_PREFIX]) {
    it(`${prefix || 'no'} prefix: one read for each title, all GET, nothing written, each at the address its title suggests; then one list by its address is the same list`, async () => {
      const { fake, read, titles } = await site({ prefix });
      try {
        const seen = [];
        const rows = await readListAddresses(read, titles, fake.siteUrl, (row) => seen.push(row.key));
        assert.equal(rows.length, 17);
        assert.deepEqual(seen, rows.map((row) => row.key), 'each row is handed over as its answer arrives');
        assert.ok(rows.every((row) => row.asked && row.found), JSON.stringify(rows.filter((row) => !row.found)));
        assert.equal(rows[0].address, `/sites/cec/Lists/${prefix}${TITLE.clients}`);
        assert.equal(rows.at(-1).address, `/sites/cec/${prefix}${TITLE.logoLibrary}`, 'a library is not under Lists/');
        assert.ok(rows.every((row) => row.note === 'At the address its title suggests.'), rows.map((row) => row.note).join(' | '));
        assert.ok(rows.every((row) => /^[0-9a-f-]{36}$/.test(row.id)));
        assert.equal(new Set(rows.map((row) => row.id)).size, 17, 'seventeen different lists (thirteen until Prompt 21, sixteen until its Phase 5)');
        assert.equal(fake.requests.length, 17);
        assert.ok(fake.requests.every((entry) => entry.method === 'GET'));

        const probe = await sameListByAddress(read, rows);
        assert.deepEqual(probe, { asked: true, same: true, words: `Asked for ${prefix}${TITLE.clients} by its title and by its address (/sites/cec/Lists/${prefix}${TITLE.clients}): the same list both ways (id ${rows[0].id}).` });
        assert.equal(fake.requests.length, 18); // (one read per title, sixteen since Prompt 21, seventeen since its Phase 5, and the one by address)
        assert.match(fake.requests.at(-1).path, new RegExp(`/web/GetList\\('/sites/cec/Lists/${prefix}${TITLE.clients}'\\)$`));
        assert.equal(fake.count((entry) => entry.method !== 'GET'), 0, 'it only reads');
        assert.deepEqual(fake.strays, []);
      } finally { restore(); }
    });
  }

  it('a list that is not there, and one that was renamed after it was made, are each said in words; a refused read is an answer, not an error', async () => {
    const { fake, read, titles } = await site({ prefix: OTHER_PREFIX, without: ['qrtokens'], addresses: { clients: 'Client' } });
    try {
      fake.failNext({ status: 503, times: 99, when: (entry) => entry.list === 'tracks' });
      const rows = await readListAddresses(read, titles, fake.siteUrl);
      const row = (key) => rows.find((each) => each.key === key);
      assert.deepEqual({ ...row('qrtokens') }, { key: 'qrtokens', title: `${OTHER_PREFIX}${TITLE.qrtokens}`, library: false, asked: true, found: false, address: '', id: '', note: 'There is no list with this title.' });
      assert.equal(row('clients').address, '/sites/cec/Lists/Client');
      assert.equal(row('clients').note, `At another address than its title suggests (/sites/cec/Lists/${OTHER_PREFIX}${TITLE.clients}): it was made under another name.`);
      assert.equal(row('tracks').found, false);
      assert.match(row('tracks').note, /^Could not be read \(503: /);
      assert.equal(row('sessions').note, 'At the address its title suggests.');

      // The probe asks for the first list that was found: the renamed one, by the address it really has.
      const probe = await sameListByAddress(read, rows);
      assert.equal(probe.same, true);
      assert.match(probe.words, new RegExp(`^Asked for ${OTHER_PREFIX}${TITLE.clients} by its title and by its address \\(\\/sites\\/cec\\/Lists\\/Client\\): the same list both ways`));
    } finally { restore(); }
  });

  it('the probe says so when SharePoint will not answer by address, when it answers with another list, and when there is nothing to ask', async () => {
    const { fake, read, titles } = await site({ prefix: '' });
    try {
      const rows = await readListAddresses(read, titles, fake.siteUrl);
      fake.failNext({ status: 404, when: (entry) => entry.path.includes('/web/GetList(') });
      const refused = await sameListByAddress(read, rows);
      assert.deepEqual([refused.asked, refused.same], [true, false]);
      assert.match(refused.words, new RegExp(`^Asked for ${TITLE.clients} by its address \\(\\/sites\\/cec\\/Lists\\/${TITLE.clients}\\): SharePoint did not answer it that way \\(404: .*\\)\\. The app asks by title, so nothing is wrong today\\.$`));

      const other = await sameListByAddress(read, [{ ...rows[0], id: '00000000-0000-4000-8000-000000000000' }]);
      assert.deepEqual([other.asked, other.same], [true, false]);
      assert.match(other.words, /NOT the same list \(by title 00000000-0000-4000-8000-000000000000, by address [0-9a-f-]{36}\)\. Tell the developer before anything is changed\.$/);

      assert.deepEqual(await sameListByAddress(read, rows.map((row) => ({ ...row, found: false }))), { asked: false, same: false, words: 'Not asked: no list was found by its title, so there is no address to ask by.' });
      assert.deepEqual(await sameListByAddress(read, [rows.at(-1)]), { asked: false, same: false, words: 'Not asked: no list was found by its title, so there is no address to ask by.' }, 'the library alone is not asked for this way');
    } finally { restore(); }
  });

  it('the read it is built on is the data layer\'s existing probe, given a whole address: SharePoint only, a GET, and never a throw', async () => {
    const { fake, page } = await site({ prefix: OTHER_PREFIX });
    try {
      const answer = await page.probeSharePointRead(null, `/web/lists/getbytitle('${OTHER_PREFIX}${TITLE.clients}')?$select=Id,Title`);
      assert.equal(answer.ok, true);
      assert.equal(answer.data.Title, `${OTHER_PREFIX}${TITLE.clients}`);
      assert.deepEqual(await page.probeSharePointRead(null, "/web/lists/getbytitle('Nothing')?$select=Id"), { ok: false, status: 404, message: 'List does not exist' });
      // With a list it is what it was (Phase 9b): the items of that list, counted.
      const items = await page.probeSharePointRead('clients', '$top=1');
      assert.deepEqual([items.ok, items.rows], [true, 0]);
      assert.ok(fake.requests.every((entry) => entry.method === 'GET'));
      const local = await freshPage({ baseUrl: '/api' });
      await assert.rejects(local.probeSharePointRead(null, '/web/lists'), /SharePoint mode is not enabled/);
    } finally { restore(); }
  });
});

describe('only Setup carries this', () => {
  it('the module, the two components and the wording are imported by the Setup page alone', async () => {
    const setup = await readFile(path.join(ROOT, 'migration/src/SetupApp.svelte'), 'utf8');
    for (const name of ['./lib/setup/setup-deployment.js', './setup/CopyPanel.svelte', './setup/ListAddresses.svelte', './lib/settings/deploy-problems.js', './lib/settings/deploy-rules.js']) assert.ok(setup.includes(`'${name}'`), `SetupApp imports ${name}`);
    for (const entry of ['App.svelte', 'AdminApp.svelte', 'main.ts', 'admin-main.ts', 'lib/settings/start.ts', 'lib/settings/deploy-settings.js']) {
      const code = (await readFile(path.join(ROOT, 'migration/src', entry), 'utf8')).replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      assert.doesNotMatch(code, /setup-deployment|CopyPanel|ListAddresses|deploy-problems|deploy-rules/, entry);
    }
  });

  it('no request of this suite reached a list that is not its own', () => {
    assert.deepEqual(STRAYS.map((entry) => `${entry.method} ${entry.title}`), []);
    assert.deepEqual(UNINDEXED.map((entry) => `${entry.list}.${entry.unindexed}`), [], 'and none filtered on a column the schema does not index');
  });
});
