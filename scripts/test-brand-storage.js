// Phase 6: where Brand Studio's pictures go. uploadClientAsset() and removeClientAsset()
// (migration/src/lib/data/dataService.js, section 7) run against the mocked SharePoint REST (scripts/sharepoint-fake.js,
// which now has a ClientLogos library and counts every request) and against the real local server on a
// scratch copy of server/data with UPLOAD_DIR, and the two must behave alike. Run: npm run test:brand
// (also part of npm test).
//
// Like the storage suite this proves the adapter sends the requests it should, in the numbers it should.
// It is not the real tenant: whether a participant's browser can read a file in ClientLogos is something
// only the test site can show (QA-TESTING.md section 9).
import './fresh-page.js';
import assert from 'node:assert/strict';
import { freePort } from './free-port.js';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as ds from '../migration/src/lib/data/dataService.js';
import { ASSET_NAME } from '../server/api.js';
import { assetFileName } from '../migration/src/lib/brand/asset-names.js';
import { SAMPLE_PICTURE_NAMES } from '../migration/src/lib/setup/sample-pictures.js';
import { STRAYS, TITLE, UNINDEXED, createSharePointFake } from './sharepoint-fake.js';
import { dataLayerSource } from './data-layer-source.js';

const ROOT = path.join(import.meta.dirname, '..');
const realFetch = globalThis.fetch;
const measured = [];

// A tiny but real PNG and WebP and JPEG (signatures are what the adapter checks), differing in content.
const PNG = (extra = '') => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode(`IHDR..${extra}`)]);
const WEBP = (extra = '') => new Uint8Array([...new TextEncoder().encode('RIFF'), 20, 0, 0, 0, ...new TextEncoder().encode(`WEBPVP8 ${extra}`)]);
const JPEG = (extra = '') => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(`JFIF${extra}`)]);
const blobOf = (bytes, type) => new Blob([bytes], { type });
const named = (slug, slot, bytes, type) => assetFileName(slug, slot, bytes, type);

let pages = 0;
async function freshPage(settings) {
  const page = await import(`../migration/src/lib/data/dataService.js?brand-page=${pages += 1}`);
  page.configure(settings);
  return page;
}

describe('the picture names the adapter and the local server accept are the same', () => {
  it('one pattern in dataService.js, the server and asset-names.js', async () => {
    const service = await dataLayerSource();
    const inService = /const ASSET_NAME = (\/.*\/);/.exec(service)?.[1];
    assert.equal(inService, String(ASSET_NAME));
    const good = ['kroger-hero-0123456789.png', 'my-co-background-abcdef0123.jpg', 'a-tile-0000000000.webp', 'x1-logo-ffffffffff.webp'];
    const bad = ['kroger-hero-0123456789.gif', 'Kroger-hero-0123456789.png', 'kroger-hero-012345678.png', 'kroger-banner-0123456789.png', '../kroger-hero-0123456789.png', 'kroger-hero-0123456789.png/x', 'upload-123-abc.png', 'kroger-logo.svg'];
    for (const name of good) assert.ok(ASSET_NAME.test(name), name);
    for (const name of bad) assert.ok(!ASSET_NAME.test(name), name);
    for (const [slug, slot, type] of [['kroger', 'hero', 'image/png'], ['my-co', 'background', 'image/jpeg'], ['dominos', 'tile', 'image/webp']]) {
      assert.ok(ASSET_NAME.test(named(slug, slot, PNG('x'), type)), 'every name asset-names.js makes is accepted');
    }
  });

  it('the data layer stores and removes a picture by its name, and the older upload with no name is gone (Phase 10c-1)', () => {
    assert.equal(typeof ds.uploadClientLogo, 'undefined');
    assert.equal(typeof ds.uploadClientAsset, 'function');
    assert.equal(typeof ds.removeClientAsset, 'function');
  });
});

describe('on SharePoint (mocked REST)', () => {
  let fake;
  let page;
  before(async () => {
    fake = createSharePointFake();
    fake.install();
    page = await freshPage({ sharePoint: fake.settings });
  });
  after(() => { globalThis.fetch = realFetch; ds.configure({ baseUrl: '/api' }); });

  it('stores a picture in the ClientLogos library under its flat name: 3 requests for the first, 1 for the next', async () => {
    const bytes = WEBP('first');
    const name = named('kroger', 'hero', bytes, 'image/webp');
    fake.reset();
    const stored = await page.uploadClientAsset(blobOf(bytes, 'image/webp'), name);
    assert.deepEqual(stored.name, name);
    assert.equal(stored.url, `https://tenant.example${fake.libraryFolder}/${name}`);
    assert.deepEqual(fake.requests.map((entry) => `${entry.method} ${entry.path.split('/_api')[1]}`), [
      `GET /web/lists/getbytitle('${fake.libraryTitle}')/RootFolder`,
      'POST /contextinfo',
      `POST /web/GetFolderByServerRelativeUrl('${fake.libraryFolder}')/Files/add(url='${name}',overwrite=true)`,
    ]);
    assert.deepEqual([...fake.file(`${fake.libraryFolder}/${name}`).bytes], [...bytes], 'the bytes arrived whole');
    assert.equal(fake.file(`${fake.libraryFolder}/${name}`).type, 'image/webp');
    measured.push(['First picture uploaded to ClientLogos (write token, library folder, the file)', fake.count()]);

    const second = WEBP('second');
    const secondName = named('kroger', 'hero', second, 'image/webp');
    fake.reset();
    await page.uploadClientAsset(blobOf(second, 'image/webp'), secondName);
    assert.equal(fake.count(), 1, 'the token and the folder are asked for once per page');
    measured.push(['Each picture after the first on the same page', fake.count()]);
  });

  it('writes the same name over itself (the same picture again is harmless)', async () => {
    const bytes = PNG('again');
    const name = named('kroger', 'logo', bytes, 'image/png');
    const one = await page.uploadClientAsset(blobOf(bytes, 'image/png'), name);
    const two = await page.uploadClientAsset(blobOf(bytes, 'image/png'), name);
    assert.equal(one.url, two.url);
    assert.equal([...fake.files.keys()].filter((key) => key.endsWith(name)).length, 1);
  });

  it('a 503 on the upload is tried again, because the same name is the same bytes', async () => {
    const bytes = JPEG('flaky');
    const name = named('kroger', 'background', bytes, 'image/jpeg');
    fake.failNext({ status: 503, when: (entry) => entry.path.includes('/Files/add'), times: 1 });
    fake.reset();
    const stored = await page.uploadClientAsset(blobOf(bytes, 'image/jpeg'), name);
    assert.ok(stored.url.endsWith(name));
    assert.equal(fake.count((entry) => entry.path.includes('/Files/add')), 2);
  });

  it('refuses what it should before any request: SVG, GIF, a name that is not ours, a type that is not the name\'s, empty, and too big', async () => {
    fake.reset();
    const refused = async (file, name, pattern) => assert.rejects(page.uploadClientAsset(file, name), pattern);
    await refused(blobOf(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'), 'kroger-logo-0123456789.png', /SVG upload is disabled/);
    await refused(blobOf(new TextEncoder().encode('GIF89a'), 'image/gif'), 'kroger-logo-0123456789.png', /PNG, JPEG or WebP/);
    await refused(blobOf(PNG(), 'image/png'), 'kroger-logo.png', /not a picture file name/);
    await refused(blobOf(PNG(), 'image/png'), '../kroger-logo-0123456789.png', /not a picture file name/);
    await refused(blobOf(PNG(), 'image/png'), 'kroger-logo-0123456789.webp', /PNG, JPEG or WebP/);
    await refused(blobOf(new Uint8Array(), 'image/png'), 'kroger-logo-0123456789.png', /empty/);
    await refused(blobOf(new Uint8Array(513 * 1024), 'image/png'), 'kroger-logo-0123456789.png', /too big/);
    await refused(blobOf(new TextEncoder().encode('not really a png'), 'image/png'), 'kroger-logo-0123456789.png', /does not match/);
    assert.equal(fake.count((entry) => entry.path.includes('/Files/add')), 0, 'nothing was sent');
  });

  it('removes only its own pictures, from the library, into the recycle bin', async () => {
    const bytes = PNG('to remove');
    const name = named('acme', 'hero', bytes, 'image/png');
    const { url } = await page.uploadClientAsset(blobOf(bytes, 'image/png'), name);
    fake.reset();
    assert.equal(await page.removeClientAsset(url), true);
    assert.equal(fake.count(), 1, 'one request: the folder and the token are already known');
    assert.equal(fake.file(`${fake.libraryFolder}/${name}`), undefined);
    assert.equal(fake.recycled.at(-1).path, `${fake.libraryFolder}/${name}`, 'recycled, so it can be restored');
    measured.push(['Removing the old picture (best effort)', fake.count()]);
    assert.equal(await page.removeClientAsset(url), false, 'already gone: false, no throw');

    fake.reset();
    for (const refusedUrl of [
      `https://tenant.example${fake.libraryFolder}/kroger-logo.svg`,
      `https://tenant.example/sites/cec/${TITLE.logoLibrary}/upload-1760000000000-ab12cd34.png`,
      `https://elsewhere.example${fake.libraryFolder}/${name}`,
      `https://tenant.example/sites/cec/Shared%20Documents/${name}`,
      '/assets/images/clients/kroger-logo.svg', '', null, undefined,
    ]) assert.equal(await page.removeClientAsset(refusedUrl), false, String(refusedUrl));
    assert.equal(fake.count((entry) => entry.path.includes('recycle')), 0, 'none of them reached SharePoint');
  });

  it('a failed removal is not an error', async () => {
    const bytes = PNG('stubborn');
    const name = named('acme', 'logo', bytes, 'image/png');
    const { url } = await page.uploadClientAsset(blobOf(bytes, 'image/png'), name);
    fake.failNext({ status: 403, when: (entry) => entry.path.includes('recycle'), times: 1 });
    const warn = console.warn;
    console.warn = () => {};
    try { assert.equal(await page.removeClientAsset(url), false); } finally { console.warn = warn; }
    assert.ok(fake.file(`${fake.libraryFolder}/${name}`), 'still there');
  });

  it('a site without the ClientLogos library says so on upload instead of failing silently', async () => {
    const lonely = createSharePointFake();
    const original = globalThis.fetch;
    globalThis.fetch = (url, options) => lonely.fetch(url, { ...options, ...(String(url).includes('RootFolder') ? { method: 'GET' } : {}) });
    try {
      const other = await freshPage({ sharePoint: { ...lonely.settings, logoLibrary: 'Missing Library' } });
      await assert.rejects(other.uploadClientAsset(blobOf(PNG('x'), 'image/png'), named('acme', 'hero', PNG('x'), 'image/png')));
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('on the local server (UPLOAD_DIR)', () => {
  let server;
  let dataDir;
  let local;
  let base;
  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'cec-brand-'));
    await cp(path.join(ROOT, 'server', 'data'), dataDir, { recursive: true });
    const port = await freePort();
    server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, UPLOAD_DIR: path.join(dataDir, 'uploads') }, stdio: ['ignore', 'pipe', 'inherit'],
    });
    await new Promise((resolve, reject) => {
      server.once('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
      server.stdout.on('data', (chunk) => String(chunk).includes('running') && resolve());
    });
    base = `http://127.0.0.1:${port}`;
    local = await freshPage({ baseUrl: `${base}/api` });
  });
  after(async () => {
    server?.kill();
    globalThis.fetch = realFetch;
    ds.configure({ baseUrl: '/api' });
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });
  const uploads = () => readdir(path.join(dataDir, 'uploads')).catch(() => []);
  /** A picture sent to the upload endpoint with no name, as uploads were before Brand Studio: resolves to the address it was given. */
  const olderUpload = async (bytes) => (await (await realFetch(`${base}/api/uploads/logo`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes })).json()).url;

  it('stores a picture under its flat name in UPLOAD_DIR and serves it with a cache that never goes stale', async () => {
    const bytes = WEBP('local');
    const name = named('kroger', 'hero', bytes, 'image/webp');
    const stored = await local.uploadClientAsset(blobOf(bytes, 'image/webp'), name);
    assert.deepEqual(stored, { name, url: `/assets/images/clients/${name}` });
    assert.deepEqual(await uploads(), [name]);
    const response = await realFetch(`${base}${stored.url}`);
    assert.equal(response.status, 200);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...bytes]);
    assert.match(response.headers.get('cache-control') ?? '', /immutable/);
    // An older upload (sent with no name, so with no hash in the name it is given) is not given that cache. dataService.uploadClientLogo
    // made these until Phase 10c-1; the endpoint still takes one, and is asked directly.
    const old = await olderUpload(PNG('older'));
    assert.match(old, /^\/assets\/images\/clients\/upload-\d+-[0-9a-f]{8}\.png$/, 'an upload without a name is exactly what it was');
    assert.doesNotMatch((await realFetch(`${base}${old}`)).headers.get('cache-control') ?? '', /immutable/);
  });

  it('writes the same name over itself, and refuses what the SharePoint adapter refuses', async () => {
    const bytes = PNG('twice');
    const name = named('kroger', 'logo', bytes, 'image/png');
    await local.uploadClientAsset(blobOf(bytes, 'image/png'), name);
    await local.uploadClientAsset(blobOf(bytes, 'image/png'), name);
    assert.equal((await uploads()).filter((file) => file === name).length, 1);
    await assert.rejects(local.uploadClientAsset(blobOf(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'), 'kroger-logo-0123456789.png'), /SVG upload is disabled/);
    await assert.rejects(local.uploadClientAsset(blobOf(PNG(), 'image/png'), 'kroger-logo-0123456789.webp'), /PNG, JPEG or WebP/);
    // The server itself is the second wall: it checks the name and the type even when the adapter is bypassed.
    const raw = (query, type, body) => realFetch(`${base}/api/uploads/logo${query}`, { method: 'POST', headers: { 'Content-Type': type }, body });
    assert.equal((await raw('?name=../x-logo-0123456789.png', 'image/png', PNG())).status, 400);
    assert.equal((await raw('?name=kroger-logo-0123456789.png', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>')).status, 415);
    assert.equal((await raw('?name=kroger-logo-0123456789.jpg', 'image/png', PNG())).status, 415, 'the name must end with what the picture is');
    assert.equal((await raw('?name=kroger-logo-0123456789.png', 'image/png', 'not a png')).status, 400);
    assert.equal((await raw('', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>')).status, 201, 'without a name the endpoint is what it always was');
  });

  it('removes only its own pictures', async () => {
    const bytes = JPEG('remove me');
    const name = named('acme', 'background', bytes, 'image/jpeg');
    const { url } = await local.uploadClientAsset(blobOf(bytes, 'image/jpeg'), name);
    assert.ok((await uploads()).includes(name));
    assert.equal(await local.removeClientAsset(url), true);
    assert.ok(!(await uploads()).includes(name));
    assert.equal(await local.removeClientAsset(url), false, 'already gone');
    const old = await olderUpload(PNG('older 2'));
    for (const refused of ['/assets/images/clients/kroger-logo.svg', old, 'https://elsewhere.example/other/kroger-hero-0123456789.png', '', null]) {
      assert.equal(await local.removeClientAsset(refused), false, String(refused));
    }
    assert.ok((await uploads()).some((file) => old.endsWith(file)), 'an older upload is never removed');
    assert.equal((await realFetch(`${base}/api/uploads/logo/..%2Fclients.json`, { method: 'DELETE' })).status, 400);
    assert.equal((await realFetch(`${base}/api/uploads/logo/kroger-logo.svg`, { method: 'DELETE' })).status, 400);
    assert.equal(JSON.parse(await readFile(path.join(dataDir, 'clients.json'), 'utf8')).length > 0, true);
  });

  it('left nothing in the repository: the local server\'s uploads hold the six sample pictures and nothing a test made (Phase 10f)', async () => {
    const seeded = await readdir(path.join(ROOT, 'public', 'assets', 'images', 'clients'));
    assert.deepEqual(seeded.filter((file) => (ASSET_NAME.test(file) && !SAMPLE_PICTURE_NAMES.includes(file)) || /^upload-/.test(file)), []);
  });
});

describe('measured', () => {
  it('prints what was measured', () => {
    console.log('\nMeasured against the mocked SharePoint REST:');
    for (const [what, count] of measured) console.log(`  ${String(count).padStart(4)}  ${what}`);
  });
});

// Phase 10b: every fake also holds the other set of lists (the prefixed ones; or the plain ones, when this suite is run a second time
// with PMS_TEST_LIST_PREFIX and its own lists are the prefixed ones). A request to them is answered, as a second copy's lists would
// answer on a real site, so nothing else in this suite would notice one: this does.
it('no request of this suite reached a list that is not its own', () => {
  assert.deepEqual(STRAYS.map((entry) => `${entry.method} ${entry.title}`), []);
  assert.deepEqual(UNINDEXED.map((entry) => `${entry.list}.${entry.unindexed}`), [], 'and none filtered on a column the schema does not index');
});
