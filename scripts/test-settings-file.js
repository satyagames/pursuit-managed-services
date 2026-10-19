// Phase 10b: reading pms-config.txt at start-up (migration/src/lib/settings/settings-file.js), the data layer's guard against a request
// before set-up (dataService.requireConfiguration), and the order the three entries do things in.
// Run: node --test scripts/test-settings-file.js (part of `npm test`).
//
// The reader is tried on a stand-in for fetch: what a real SharePoint library answers for a file, for a missing one and for a signed-out
// browser has not been seen. The browser side is scripts/migration-tests/settings-file.spec.ts.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { readSettingsFile } from '../migration/src/lib/settings/settings-file.js';
import { SETTINGS_FILE, resolveSettings } from '../migration/src/lib/settings/deploy-settings.js';

const ROOT = path.join(import.meta.dirname, '..');
const PAGE = 'https://americas.internal.deloitteonline.com/sites/CreativeExpCOE/Shared%20Documents/p_cec_03/index.html';
const source = (file) => readFile(path.join(ROOT, file), 'utf8');

/** Reads the settings file for `pageUrl` with fetch answering `reply` (thrown, when it is an error). Resolves to what the reader made of it, and what was asked. */
async function reading(reply, pageUrl = PAGE) {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, options) => {
    asked.push({ url, options });
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply(url) : reply;
  };
  try { return { outcome: await readSettingsFile(pageUrl), asked }; } finally { globalThis.fetch = real; }
}
const named = (name) => Object.assign(new Error(name), { name });
const text = (body, status = 200, type = 'application/json') => new Response(body, { status, headers: { 'Content-Type': type } });

describe('reading pms-config.txt', () => {
  it('asks once, for the file in the page\'s own folder, never from a cache, with an 8-second limit', async () => {
    const { outcome, asked } = await reading(text('{"listPrefix":"PMS3"}'), `${PAGE}?qr=abc#/agenda`);
    assert.deepEqual(outcome, { file: { listPrefix: 'PMS3' } });
    assert.equal(asked.length, 1);
    assert.equal(asked[0].url, 'https://americas.internal.deloitteonline.com/sites/CreativeExpCOE/Shared%20Documents/p_cec_03/pms-config.txt');
    assert.equal(asked[0].options.cache, 'no-store');
    assert.ok([undefined, 'same-origin'].includes(asked[0].options.credentials), 'the page\'s own sign-in goes with it (what a request to the same origin does unless told otherwise)');
    assert.equal(asked[0].options.method ?? 'GET', 'GET');
    assert.ok(asked[0].options.signal instanceof AbortSignal);
    assert.match(await source('migration/src/lib/settings/settings-file.js'), /AbortSignal\.timeout\(8000\)/);
  });

  it('HTTP 404 means there is no file: that is an answer, and the built-in values are next', async () => {
    const { outcome } = await reading(text('<html><body>404 NOT FOUND</body></html>', 404, 'text/html'));
    assert.deepEqual(outcome, {});
    assert.equal(resolveSettings({ pageUrl: PAGE, ...outcome, built: { listPrefix: 'BUILT' } }).settings.listPrefix, 'BUILT');
  });

  it('asks for pms-config.txt, the name this kind of site hands out, and for no other: a pms-config.json beside it is neither asked for nor obeyed (Phase 10g)', async () => {
    const decoy = '{"listPrefix":"DECOY"}';
    const { outcome, asked } = await reading((url) => text(String(url).endsWith('.json') ? decoy : '{"listPrefix":""}'));
    assert.deepEqual(outcome, { file: { listPrefix: '' } });
    assert.deepEqual(asked.map((entry) => String(entry.url).split('/').pop()), ['pms-config.txt']);

    // With no pms-config.txt (a 404) the .json is no stand-in: it is not looked for, and the answer is "no file".
    const missing = await reading((url) => (String(url).endsWith('.json') ? text(decoy) : text('<html>404</html>', 404, 'text/html')));
    assert.deepEqual(missing.outcome, {});
    assert.equal(missing.asked.length, 1);
    assert.match(missing.asked[0].url, /\/pms-config\.txt$/);
  });

  it('a 404 that is SharePoint\'s error page is still "no file"; the same page with a success status is a file that could not be read (the status goes with it)', async () => {
    const page = '<!DOCTYPE html><html><body><h1>Sorry, something went wrong</h1><p>File Not Found</p></body></html>';
    assert.deepEqual((await reading(text(page, 404, 'text/html'))).outcome, {});
    assert.deepEqual((await reading(text(page, 200, 'text/html'))).outcome, { fileError: { kind: 'page', status: 200 } });
  });

  it('no code or help text under migration/ says pms-config.json: the one name is SETTINGS_FILE, and every sentence that names the file follows it', async () => {
    const files = [];
    for (const dir of ['migration/src']) {
      for (const name of await readdir(path.join(ROOT, dir), { recursive: true })) {
        if (/\.(ts|js|svelte|css|html)$/.test(name)) files.push(path.join(dir, name));
      }
    }
    assert.ok(files.length > 100, 'the folders were read');
    for (const file of files) assert.doesNotMatch(await source(file), /pms-config(\\)?\.json/, `${file} still says pms-config.json`);
    assert.equal(SETTINGS_FILE, 'pms-config.txt');
  });

  const failures = [
    ['no connection (fetch rejects)', new TypeError('Failed to fetch'), { kind: 'unreachable' }],
    ['no answer in 8 seconds', named('TimeoutError'), { kind: 'unreachable' }],
    ['the request was aborted', named('AbortError'), { kind: 'unreachable' }],
    ['503', text('Service Unavailable', 503, 'text/plain'), { kind: 'status', status: 503 }],
    ['500 with a JSON body', text('{"error":"x"}', 500), { kind: 'status', status: 500 }],
    ['403', text('', 403), { kind: 'status', status: 403 }],
    ['401', text('', 401), { kind: 'status', status: 401 }],
    ['a sign-in page, 200', text('<!DOCTYPE html><html><head><title>Sign in to your account</title></head></html>', 200, 'text/html'), { kind: 'page', status: 200 }],
    // (Phase 10g: what the first real site sent, with a success status, for a .json file that was in the folder: it would not hand that kind out.)
    ['SharePoint\'s own "File Not Found" page, 200, for a file the site will not hand out', text('<!DOCTYPE html><html><head><title>Error</title></head><body><h1>Sorry, something went wrong</h1><p>File Not Found</p></body></html>', 200, 'text/html'), { kind: 'page', status: 200 }],
    ['a page with a blank line first', text('\n  <html></html>', 200, 'text/html'), { kind: 'page', status: 200 }],
    ['JSON that is cut off', text('{"listPrefix":"PMS3"'), { kind: 'json', status: 200 }],
    ['an empty file', text(''), { kind: 'json', status: 200 }],
    ['a comment in the JSON', text('{ // the prefix\n "listPrefix": "PMS3" }'), { kind: 'json', status: 200 }],
    ['a body that cannot be read', () => ({ status: 200, ok: true, text: async () => { throw new TypeError('network error'); } }), { kind: 'unreachable' }],
    ['a body that stops arriving', () => ({ status: 200, ok: true, text: async () => { throw named('TimeoutError'); } }), { kind: 'unreachable' }],
  ];
  for (const [what, reply, fileError] of failures) {
    it(`${what} is not "no file": the page stops (PMS-CFG-002) and what is built in is not used`, async () => {
      const { outcome } = await reading(reply);
      assert.deepEqual(outcome, { fileError });
      const result = resolveSettings({ pageUrl: PAGE, ...outcome, built: { listPrefix: 'BUILT' } });
      assert.equal(result.settings, null);
      assert.deepEqual(result.problems, [{ id: 'PMS-CFG-002', ...fileError }]);
    });
  }

  it('whatever JSON the file holds is handed on as it is: judging it is the resolver\'s work', async () => {
    for (const body of ['null', '[]', '"PMS3"', '{"listPrefx":"PMS3"}']) {
      const { outcome } = await reading(text(body));
      assert.deepEqual(outcome, { file: JSON.parse(body) });
      assert.equal(resolveSettings({ pageUrl: PAGE, ...outcome }).problems[0].id, 'PMS-CFG-002', body);
    }
  });

  it('a file SharePoint serves as a download (another content type) or with a byte-order mark is read all the same', async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"listPrefix":""}')]);
    assert.deepEqual((await reading(new Response(bom, { headers: { 'Content-Type': 'application/octet-stream' } }))).outcome, { file: { listPrefix: '' } });
  });
});

describe('the data layer refuses to be asked before it has been set up, for a page that opted in', () => {
  let pages = 0;
  const freshPage = () => import(`../migration/src/lib/data/dataService.js?guard=${pages += 1}`);
  /** Runs `work` with every request counted and answered with an empty list. */
  async function counting(work) {
    const real = globalThis.fetch;
    let sent = 0;
    globalThis.fetch = async () => { sent += 1; return new Response(JSON.stringify({ d: { results: [] } })); };
    try { await work(); } finally { globalThis.fetch = real; }
    return sent;
  }
  const calls = (page) => ({
    listClients: () => page.listClients(),
    getAppSettings: () => page.getAppSettings(),
    getClient: () => page.getClient('c-kroger'),
    getLiveExperience: () => page.getLiveExperience(),
    readLists: () => page.readLists([{ list: 'clients' }, { list: 'sessions' }]),
    readParticipantWatch: () => page.readParticipantWatch({ sessionId: 's', trackId: 't', clientId: 'c' }),
    openQrScan: () => page.openQrScan('00000000-0000-4000-8000-000000000000'),
    beginVisit: () => page.beginVisit('v', 's', 'c', {}),
    saveParticipantResponses: () => page.saveParticipantResponses({ trackId: 't', sessionId: 's', clientId: 'c' }, []),
    uploadClientAsset: () => page.uploadClientAsset(new Blob(['x'], { type: 'image/png' }), 'kroger-logo-0123456789.png'),
    recordParticipantVisit: () => page.recordParticipantVisit({ visitKey: 'k', sessionId: 's', clientId: 'c', page: 'participant', entryMode: 'staff' }),
    getLanUrls: () => page.getLanUrls(),
  });

  it('after requireConfiguration() and before configure(), every call that would send a request throws PMS-CFG-003 and sends none', async () => {
    const page = await freshPage();
    page.requireConfiguration();
    const sent = await counting(async () => {
      for (const [name, call] of Object.entries(calls(page))) {
        await assert.rejects(async () => call(), (error) => {
          assert.equal(error.code, 'PMS-CFG-003', `${name}: ${error.message}`);
          assert.equal(error.message, 'PMS-CFG-003', 'the code is the message; its words are with the other three (lib/settings/deploy-problems.js)');
          return true;
        }, name);
      }
      assert.throws(() => page.isSharePointMode(), { code: 'PMS-CFG-003' }, 'which backend this is has no answer yet either');
    });
    assert.equal(sent, 0, 'nothing reached the network');
  });

  it('configure() lifts it: for SharePoint with its settings, and for the local server with none', async () => {
    const sharePoint = await freshPage();
    sharePoint.requireConfiguration();
    sharePoint.configure({ sharePoint: { siteUrl: 'https://tenant.example/sites/cec', listPrefix: '' } });
    assert.equal(sharePoint.isSharePointMode(), true);
    assert.equal(await counting(() => sharePoint.listClients()), 1);

    const local = await freshPage();
    local.requireConfiguration();
    local.configure({ sharePoint: null });
    assert.equal(local.isSharePointMode(), false);
    assert.equal(await counting(() => local.listClients()), 1);

    // Asked for again (a second start), it holds again.
    local.requireConfiguration();
    assert.equal(await counting(() => assert.rejects(local.listClients(), { code: 'PMS-CFG-003' })), 0);
  });

  it('a page that never opted in is as it always was: every test that configures the service itself relies on it', async () => {
    const page = await freshPage();
    assert.equal(page.isSharePointMode(), false);
    assert.equal(await counting(() => page.listClients()), 1, 'the request goes to the local server, as before');
    // The modules the pages share (until Phase 14 in public/js) do not opt in themselves: only an entry does (lib/settings/start.ts). (Until Phase 10c-1 this
    // loop also read the legacy screens, which never opted in; they left the branch with the legacy app. resultsRenderer.js, the Live display's
    // Chart.js renderer, left in Phase 11a, when the Results charts were drawn by hand.)
    const shared = ['brand/assets.js', 'brand/branding.js', 'schema/pms-schema-meta.js', 'schema/pms-schema.js', 'exports/resultsExport.js'];
    for (const file of shared) {
      assert.doesNotMatch(await source(path.join('migration', 'src', 'lib', file)), /requireConfiguration|sharePointListTitles/, `${file} must not opt in`);
    }
  });
});

describe('the three entries find their settings before anything asks for data', () => {
  const ENTRIES = ['migration/src/main.ts', 'migration/src/admin-main.ts', 'migration/src/setup-main.ts'];

  it('each imports the start-up module straight after the browser check, and no longer imports public/config.js', async () => {
    for (const file of ENTRIES) {
      const imports = [...(await source(file)).matchAll(/^import .*?['"]([^'"]+)['"];?\r?$/gm)].map((match) => match[1]);
      assert.equal(imports[0], './lib/settings/support.js', `${file}: the browser check stays first`);
      assert.equal(imports[1], './lib/settings/start.js', `${file}: then the settings, before any module that could ask for data`);
      assert.ok(!imports.some((name) => name.endsWith('public/config.js')), `${file} still imports public/config.js`);
    }
  });

  it('the start-up module turns the guard on as it loads, and mounts only once the data layer is configured', async () => {
    const start = (await source('migration/src/lib/settings/start.ts')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const guard = start.indexOf('dataService.requireConfiguration()');
    assert.ok(guard !== -1 && guard < start.indexOf('export '), 'requireConfiguration() runs at the top of the module, before anything is exported or called');
    // (Since Phase 10c-2b it also hands the data layer what to do on lists of another version: put the stop screen up, once the app is mounted.)
    assert.match(start, /if \(!found\.problems\.length\) dataService\.configure\(\{ sharePoint: found\.settings, onStop: \(code: string\) => stopForLists\?\.\(code\) \}\);/, 'the data layer is configured only when nothing is wrong');
    assert.match(start, /const \[trouble\] = \(await findSettings\(\)\)\.problems;\s+if \(trouble\) showStop\(target, trouble\);\s+else \{\s+const app = mount\(App, \{ target \}\);/, 'and the app is mounted only then: otherwise the stop screen is');
    assert.doesNotMatch(start, /localStorage|sessionStorage|indexedDB/, 'the settings are never kept in browser storage');
  });

  it('nothing under migration/src imports the legacy pages\' settings file or reads its globals, and that file is gone', async () => {
    const files = (await readdir(path.join(ROOT, 'migration', 'src'), { recursive: true })).filter((name) => /\.(ts|js|svelte)$/.test(name));
    for (const file of files) {
      // (Phase 14: the data layer, in public/js until then and outside this check, still takes its first values from those globals, which no page
      // sets: RELEASE-14.md, "Found, and left".)
      if (/lib[\\/]data[\\/]dataService\.js$/.test(file)) continue;
      const code = (await source(path.join('migration', 'src', file))).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      assert.doesNotMatch(code, /public\/config\.js|CEC_SHAREPOINT|CEC_API_BASE/, file);
    }
    // Until Phase 10c-1 the file was held to a checksum here, because the legacy pages loaded it. They left the branch, and it with them.
    await assert.rejects(stat(path.join(ROOT, 'public', 'config.js')), { code: 'ENOENT' });
  });

  it('the settings file is the one thing a Svelte page fetches for itself: every other request is the data layer\'s', async () => {
    const files = (await readdir(path.join(ROOT, 'migration', 'src'), { recursive: true })).filter((name) => /\.(ts|js|svelte)$/.test(name) && !name.startsWith('assets'));
    const fetching = [];
    for (const file of files) {
      const code = (await source(path.join('migration', 'src', file))).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      if (/\bfetch\b|XMLHttpRequest|sendBeacon/.test(code)) fetching.push(file.split(path.sep).join('/'));
    }
    // The data layer itself is in migration/src since Phase 14 (it was public/js/dataService.js).
    assert.deepEqual(fetching.sort(), ['lib/data/dataService.js', 'lib/settings/settings-file.js']);
    const reader = await source('migration/src/lib/settings/settings-file.js');
    assert.equal([...reader.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').matchAll(/\bfetch\(/g)].length, 1, 'one request, to one address');
    assert.match(reader, /fetch\(new URL\(SETTINGS_FILE, pageUrl\)\.href, \{ cache: 'no-store', signal: AbortSignal\.timeout\(8000\) \}\)/);
  });
});
