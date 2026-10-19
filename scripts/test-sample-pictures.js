// Phase 10f, part B: the sample clients have VJR's pictures. Run: node --test scripts/test-sample-pictures.js (part of `npm test`).
//
// The six files are what Brand Studio stored when VJR's pictures were chosen for their slots and saved (scripts/build-sample-pictures.js
// drives the built admin page to make them). This holds the committed files to their list (migration/src/lib/setup/sample-pictures.js) and to the
// slots' rules, and holds "Seed sample clients" (migration/src/lib/setup/sample-seed.js) to what it must do, on the mocked SharePoint REST and on the
// real local server: put a client's three pictures in the picture library BEFORE the client that points at them, never send a file that is
// there already, write the two themes (and LogoUrl) with the files' addresses, and send nothing at all on a second run. A recorded suite: it
// is run a second time on `Test` lists by scripts/test-list-namespace.js, so it names no prefix itself.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { SLOTS, extensionOf } from '../migration/src/lib/brand/asset-specs.js';
import { evaluateReadiness } from '../migration/src/lib/admin/admin-today.js';
import { draftFromClient } from '../migration/src/lib/brand/brand-studio.js';
import { resolveClientTheme } from '../migration/src/lib/brand/client-theme.js';
import { inspectFile } from '../migration/src/lib/brand/image-sniff.js';
import { samplePack } from '../migration/src/lib/setup/sample-clients.js';
import { SAMPLE_PICTURES, SAMPLE_PICTURE_NAMES } from '../migration/src/lib/setup/sample-pictures.js';
import { ALREADY_THERE, LOCAL_PICTURES, UPLOADED, localSamplePack, pictureAddresses, seedSampleClients } from '../migration/src/lib/setup/sample-seed.js';
import { seedPack } from '../migration/src/lib/setup/seed.js';
import { freePort } from './free-port.js';
import { STRAYS, UNINDEXED, createSharePointFake } from './sharepoint-fake.js';

const ROOT = path.join(import.meta.dirname, '..');
const PICTURES = path.join(ROOT, 'migration', 'src', 'assets', 'sample-pictures');
const UPLOADS = path.join(ROOT, 'public', 'assets', 'images', 'clients');
const realFetch = globalThis.fetch;
const BRAND = ['hero', 'logo', 'background'];
const CLIENTS = { 'c-kroger': 'kroger', 'c-dominos': 'dominos' };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** A sample picture's bytes, as the Setup page hands them to the seed (here from the committed file). */
const file = async (name, type) => new Blob([await readFile(path.join(PICTURES, name))], { type });

let pages = 0;
const freshPage = async (settings) => {
  const ds = await import(`../migration/src/lib/data/dataService.js?sample-pictures=${pages += 1}`);
  ds.configure(settings);
  return ds;
};
/** A fresh fake site whose lists exist and are empty, and a page configured for it. */
async function site(options = {}) {
  const fake = createSharePointFake(options);
  fake.install();
  return { fake, ds: await freshPage({ sharePoint: fake.settings }) };
}
const libraryAddress = (fake, name) => new URL(`${fake.libraryFolder}/${name}`, fake.settings.siteUrl).href;
const uploads = (fake) => fake.requests.filter((entry) => entry.path.includes('/Files/add('));
const listings = (fake) => fake.requests.filter((entry) => /\/RootFolder\/Files$/.test(entry.path));

// ---- The six files ------------------------------------------------------------------------------------------------------------------

describe('the six pictures, as Brand Studio stored them', () => {
  it('a hero, a logo and a background for each sample client, each named <slug>-<slot>-<10 hex of the SHA-256 of its bytes>.<ext>', async () => {
    assert.deepEqual(Object.keys(SAMPLE_PICTURES), Object.keys(CLIENTS));
    assert.equal(SAMPLE_PICTURE_NAMES.length, 6);
    assert.equal(new Set(SAMPLE_PICTURE_NAMES).size, 6);
    for (const [id, slug] of Object.entries(CLIENTS)) {
      for (const slot of BRAND) {
        const picture = SAMPLE_PICTURES[id][slot];
        const bytes = await readFile(path.join(PICTURES, picture.name));
        assert.equal(picture.name, `${slug}-${slot}-${sha256(bytes).slice(0, 10)}.${extensionOf(picture.type)}`, `${picture.name}: the file is the one listed`);
        assert.equal(bytes.length, picture.bytes);
      }
    }
  });

  it('each fits its slot as Brand Studio makes it: a format the slot allows (by its bytes), under the slot\'s cap, at the slot\'s size or at most 25% smaller in its shape', async () => {
    for (const id of Object.keys(CLIENTS)) {
      for (const slot of BRAND) {
        const picture = SAMPLE_PICTURES[id][slot];
        const spec = SLOTS[slot];
        const bytes = new Uint8Array(await readFile(path.join(PICTURES, picture.name)));
        const verdict = inspectFile({ size: bytes.length, bytes });
        assert.equal(verdict.ok, true, `${picture.name}: ${verdict.message}`);
        assert.equal(verdict.mime, picture.type, `${picture.name} is really ${picture.type}`);
        assert.ok(spec.formats.includes(picture.type), `${picture.name}: ${picture.type} is a format of the ${slot}`);
        assert.ok(picture.bytes <= spec.maxBytes, `${picture.name}: ${picture.bytes} B is under the ${slot}'s ${spec.maxBytes} B`);
        assert.ok(picture.bytes <= 512 * 1024, 'and under what the data layer stores');
        assert.ok(picture.width <= spec.width && picture.width >= Math.round(spec.width * 0.75), `${picture.name}: ${picture.width} px wide`);
        assert.equal(Math.round((picture.width * spec.height) / spec.width), picture.height, `${picture.name}: the ${spec.ratio} shape`);
      }
      assert.deepEqual({ ...SAMPLE_PICTURES[id].backgroundFocus }, { x: 50, y: 50 }, 'the focal point Brand Studio stores when nobody moves it');
      assert.equal(SAMPLE_PICTURES[id].plate, 'light', 'both logos are on a light ground: the light plate');
    }
  });

  it('the local server\'s uploads hold the same six files, byte for byte, and no other sample picture', async () => {
    for (const name of SAMPLE_PICTURE_NAMES) {
      assert.deepEqual(await readFile(path.join(UPLOADS, name)), await readFile(path.join(PICTURES, name)), name);
    }
    const sample = /^(?:kroger|dominos)-(?:hero|logo|background)-[0-9a-f]{10}\.(?:webp|png|jpg)$/;
    assert.deepEqual((await readdir(UPLOADS)).filter((name) => sample.test(name)).sort(), [...SAMPLE_PICTURE_NAMES].sort());
    assert.deepEqual((await readdir(PICTURES)).sort(), [...SAMPLE_PICTURE_NAMES].sort());
  });

  it('Setup carries each of the six by its name, and nothing else of the folder (no glob)', async () => {
    const source = await readFile(path.join(ROOT, 'migration', 'src', 'setup', 'sample-picture-data.ts'), 'utf8');
    const imported = [...source.matchAll(/^import \w+ from '\.\.\/assets\/sample-pictures\/([^'?]+)\?inline';$/gm)].map((match) => match[1]);
    assert.deepEqual(imported.sort(), [...SAMPLE_PICTURE_NAMES].sort());
    assert.doesNotMatch(source, /import\.meta\.glob/);
  });
});

// ---- What a seeded client is ---------------------------------------------------------------------------------------------------------

describe('a sample client with its pictures', () => {
  const addressed = samplePack({ pictures: pictureAddresses((name) => `https://tenant.example/sites/x/PMSClientImages/${name}`) });

  it('has the three addresses in its theme, the focal point beside the background, and its logo in LogoUrl too, as Brand Studio\'s save writes them', () => {
    for (const client of addressed.clients) {
      const pictures = SAMPLE_PICTURES[client.id];
      assert.deepEqual(client.theme.assets, {
        hero: `https://tenant.example/sites/x/PMSClientImages/${pictures.hero.name}`,
        logo: `https://tenant.example/sites/x/PMSClientImages/${pictures.logo.name}`,
        background: `https://tenant.example/sites/x/PMSClientImages/${pictures.background.name}`,
        backgroundFocus: { x: 50, y: 50 },
        tile: null,
      });
      assert.equal(client.logoUrl, client.theme.assets.logo);
      assert.equal(client.theme.plate, undefined, 'the light plate is not written');
      // The rest of the record is the pack's as it was.
      const plain = samplePack().clients.find((each) => each.id === client.id);
      assert.deepEqual({ ...client, logoUrl: null, theme: { ...client.theme, assets: plain.theme.assets } }, plain);
    }
  });

  it('the participant page shows the hero (else the logo on the plate) and the background; Brand Studio opens with all three; readiness no longer says a logo is missing', () => {
    for (const client of addressed.clients) {
      const theme = resolveClientTheme(client);
      assert.equal(theme.assets.hero, client.theme.assets.hero);
      assert.equal(theme.assets.logo, client.theme.assets.logo);
      assert.equal(theme.assets.background, client.theme.assets.background);
      assert.deepEqual(draftFromClient(client).assets, { hero: client.theme.assets.hero, logo: client.theme.assets.logo, background: client.theme.assets.background });
      const rows = evaluateReadiness({
        client, date: '2026-10-14', today: '2026-10-14', sections: [], questions: [], options: [], sessions: [], clients: [client], target: null, roster: null, schema: null,
      });
      assert.equal(rows.some((row) => row.id === 'logo'), false, `${client.name}: no "no logo or hero image" warning`);
    }
    // (Without them, as before this phase, the warning is there: the rule did not change.)
    const bare = samplePack().clients[0];
    assert.equal(evaluateReadiness({ client: bare, date: '2026-10-14', today: '2026-10-14', sections: [], questions: [], options: [], sessions: [], clients: [bare], target: null, roster: null, schema: null })
      .find((row) => row.id === 'logo')?.level, 'warning');
  });
});

// ---- Seeding on SharePoint (mocked REST) -----------------------------------------------------------------------------------------------

describe('Seed sample clients on SharePoint (mocked REST)', () => {
  after(() => { globalThis.fetch = realFetch; });

  it('an empty site: six files in the picture library, then two clients whose themes and LogoUrl point at them', async () => {
    const { fake, ds } = await site();
    const progress = [];
    const results = await seedSampleClients(ds, { file, siteUrl: fake.settings.siteUrl, onProgress: (result) => progress.push(result) });
    assert.deepEqual(progress, results);
    assert.deepEqual(results.slice(0, 6), SAMPLE_PICTURE_NAMES.map((name) => ({ list: fake.libraryTitle, id: name, status: UPLOADED })));
    assert.equal(results.filter((result) => result.status === 'Created').length, 76, 'and the pack: 2 clients, 4 activities, 14 questions, 56 answers');
    // The files, whole.
    assert.equal(fake.files.size, 6);
    for (const name of SAMPLE_PICTURE_NAMES) {
      const stored = fake.file(`${fake.libraryFolder}/${name}`);
      assert.ok(stored, `${name} is in the library`);
      assert.equal(sha256(stored.bytes), sha256(await readFile(path.join(PICTURES, name))), `${name}, byte for byte`);
    }
    // The two themes.
    for (const [id] of Object.entries(CLIENTS)) {
      const item = fake.item('clients', id);
      const theme = JSON.parse(item.ThemeJson);
      for (const slot of BRAND) assert.equal(theme.assets[slot], libraryAddress(fake, SAMPLE_PICTURES[id][slot].name), `${id} ${slot}`);
      assert.deepEqual(theme.assets.backgroundFocus, { x: 50, y: 50 });
      assert.equal(item.LogoUrl, theme.assets.logo);
    }
    // The order: one read of the library's files, the six uploads, and only then the first client.
    const order = fake.requests.map((entry) => (/\/RootFolder\/Files$/.test(entry.path) ? 'list files' : entry.path.includes('/Files/add(') ? 'upload'
      : entry.method === 'POST' && entry.list === 'clients' ? 'create client' : null)).filter(Boolean);
    assert.deepEqual(order, ['list files', ...Array(6).fill('upload'), 'create client', 'create client']);
    assert.equal(listings(fake).length, 1);
  });

  it('a second run sends no upload, reads no library, and writes nothing at all', async () => {
    const { fake, ds } = await site();
    await seedSampleClients(ds, { file, siteUrl: fake.settings.siteUrl });
    fake.reset();
    const results = await seedSampleClients(ds, { file, siteUrl: fake.settings.siteUrl });
    assert.deepEqual(uploads(fake), []);
    assert.deepEqual(listings(fake), []);
    assert.equal(fake.count((entry) => entry.method !== 'GET'), 0, 'not one write');
    assert.equal(results.filter((result) => result.status === 'Skipped existing').length, 76);
    assert.equal(results.some((result) => result.status === UPLOADED || result.status === ALREADY_THERE), false);
  });

  it('a run that stopped after the uploads is finished by running it again, and no file is sent twice', async () => {
    const { fake, ds } = await site();
    // The first client's create fails (a 500 at the first write after the token and the six uploads).
    fake.failNext({ status: 500, when: (entry) => entry.method === 'POST' && entry.list === 'clients', times: 1 });
    await assert.rejects(seedSampleClients(ds, { file, siteUrl: fake.settings.siteUrl }));
    assert.equal(fake.files.size, 6, 'the pictures went first');
    assert.equal(fake.lists.get('clients').length, 0, 'no client points at anything yet');
    fake.reset();
    const results = await seedSampleClients(ds, { file, siteUrl: fake.settings.siteUrl });
    assert.deepEqual(uploads(fake), [], 'every picture is there already: none is sent again');
    assert.deepEqual(results.slice(0, 6).map((result) => result.status), Array(6).fill(ALREADY_THERE));
    for (const id of Object.keys(CLIENTS)) {
      assert.equal(JSON.parse(fake.item('clients', id).ThemeJson).assets.hero, libraryAddress(fake, SAMPLE_PICTURES[id].hero.name));
    }
  });

  it('a site seeded before this phase (clients with themes and no pictures) is left as it is: no upload, no change', async () => {
    const { fake, ds } = await site();
    await seedPack(ds, samplePack());
    const before = fake.lists.get('clients').map((item) => ({ ...item }));
    fake.reset();
    await seedSampleClients(ds, { file, siteUrl: fake.settings.siteUrl });
    assert.deepEqual(uploads(fake), []);
    assert.equal(fake.count((entry) => entry.method !== 'GET'), 0);
    assert.deepEqual(fake.lists.get('clients'), before);
  });

  it('one client missing: only its three pictures are sent, and only it is created', async () => {
    const { fake, ds } = await site();
    await seedPack(ds, { ...samplePack(), clients: samplePack().clients.filter((client) => client.id === 'c-kroger') });
    fake.reset();
    const results = await seedSampleClients(ds, { file, siteUrl: fake.settings.siteUrl });
    assert.deepEqual(results.slice(0, 3).map((result) => result.id), BRAND.map((slot) => SAMPLE_PICTURES['c-dominos'][slot].name));
    assert.equal(uploads(fake).length, 3);
    assert.equal(JSON.parse(fake.item('clients', 'c-kroger').ThemeJson).assets.hero, null, 'Kroger, which existed, is not changed');
    assert.equal(JSON.parse(fake.item('clients', 'c-dominos').ThemeJson).assets.hero, libraryAddress(fake, SAMPLE_PICTURES['c-dominos'].hero.name));
  });

  it('a site with no picture library stops before anything is written, and says so', async () => {
    const { fake, ds } = await site({ without: ['logoLibrary'] });
    await assert.rejects(seedSampleClients(ds, { file, siteUrl: fake.settings.siteUrl }), /does not exist|not found/i);
    assert.equal(fake.count((entry) => entry.method !== 'GET'), 0);
  });

  it('no request of this suite reached a list that is not its own, and none filtered on a column the lists do not index', () => {
    assert.deepEqual(STRAYS, []);
    assert.deepEqual(UNINDEXED, []);
  });
});

// ---- Seeding on the local server -------------------------------------------------------------------------------------------------------

describe('Seed sample clients on the local server', () => {
  const children = [];
  const scratch = [];
  after(async () => {
    for (const child of children) child.kill();
    globalThis.fetch = realFetch;
    for (const dir of scratch) await rm(dir, { recursive: true, force: true });
  });
  async function localServer(dataDir) {
    const port = await freePort();
    const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, UPLOAD_DIR: path.join(dataDir, 'uploads') }, stdio: ['ignore', 'pipe', 'inherit'],
    });
    children.push(child);
    await new Promise((resolve, reject) => {
      child.once('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
      child.stdout.on('data', (chunk) => String(chunk).includes('running') && resolve());
    });
    globalThis.fetch = realFetch;
    return freshPage({ baseUrl: `http://localhost:${port}/api` });
  }

  it('server/data holds the two clients with their pictures at the local server\'s address, as the seed makes them there', async () => {
    const stored = JSON.parse(await readFile(path.join(ROOT, 'server', 'data', 'clients.json'), 'utf8'));
    assert.deepEqual(stored, localSamplePack().clients);
    for (const client of stored) for (const slot of BRAND) assert.ok(client.theme.assets[slot].startsWith(LOCAL_PICTURES), `${client.id} ${slot}`);
  });

  it('an empty local server: the six files go to its uploads, byte for byte, and the clients are what server/data holds', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pms-sample-pictures-'));
    scratch.push(dir);
    await cp(path.join(ROOT, 'server', 'data'), dir, { recursive: true });
    for (const list of ['clients', 'sections', 'questions', 'options']) await writeFile(path.join(dir, `${list}.json`), '[]');
    const ds = await localServer(dir);
    const results = await seedSampleClients(ds, { file });
    assert.deepEqual(results.slice(0, 6).map((result) => [result.id, result.status]), SAMPLE_PICTURE_NAMES.map((name) => [name, UPLOADED]));
    for (const name of SAMPLE_PICTURE_NAMES) assert.deepEqual(await readFile(path.join(dir, 'uploads', name)), await readFile(path.join(PICTURES, name)), name);
    assert.deepEqual(await ds.listClients(), localSamplePack().clients);
    // A second run sends nothing.
    const again = await seedSampleClients(ds, { file });
    assert.equal(again.some((result) => result.status === UPLOADED), false);
  });
});
