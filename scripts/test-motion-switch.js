// Phase 15, part 3: the client's Animations switch, ThemeJson `motion.enabled`. Run: node --test scripts/test-motion-switch.js (also part of
// npm test).
//
// It holds: the value is read fail-safe (absent, damaged or anything but `false` is On) and nothing else a theme says changes with it; every
// writer that rebuilds a theme carries it over (Brand Studio's save, the Clients screen's edit, Mark as confirmed), and one that never had it
// stores exactly what it stored before; the previous build's participant code (pms-14, read from git) reads a theme with the key exactly as it
// reads one without; the switch writes `motion` and nothing else, does not touch ThemeVersion, costs two requests on SharePoint, and, on the
// mocked SharePoint REST and on the real local server, two admins at once (one saves a colour, one flips the switch, in either order and in the
// middle of each other's save) both keep their change; a failed save changes nothing.

import './fresh-page.js';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { freePort } from './free-port.js';
import * as ds from '../migration/src/lib/data/dataService.js';
import { buildClientTheme, motionEnabled, resolveClientTheme, reviseClientTheme, withMotion } from '../migration/src/lib/brand/client-theme.js';
import { changesForSave, cloneDraft, draftFromClient } from '../migration/src/lib/brand/brand-studio.js';
import { confirmedTheme } from '../migration/src/lib/admin/sample-notice.js';
import { createSharePointFake } from './sharepoint-fake.js';

const ROOT = path.join(import.meta.dirname, '..');
const realFetch = globalThis.fetch;
const STORED = Object.freeze(buildClientTheme({ primary: '#0B648F', accent: '#E21737', plate: 'dark', version: 3, copy: { eventTitle: 'Supply chain day' }, assets: { hero: '/h.png', logo: '/l.png', background: '/b.jpg', backgroundFocus: { x: 30, y: 60 } }, sample: { by: 'Setup' } }));

describe('the stored value', () => {
  it('is On unless it is exactly { enabled: false }: absent, damaged or strange values never turn motion off', () => {
    assert.equal(motionEnabled(STORED), true, 'a theme from before Phase 15');
    assert.equal(motionEnabled({ ...STORED, motion: { enabled: false } }), false);
    assert.equal(motionEnabled({ ...STORED, motion: { enabled: true } }), true);
    for (const motion of [null, 'off', false, 0, [], {}, { enabled: 'false' }, { enabled: 0 }, { enabled: null }]) assert.equal(motionEnabled({ ...STORED, motion }), true, JSON.stringify(motion));
    for (const theme of [undefined, null, 'x', 42, []]) assert.equal(motionEnabled(theme), true, String(theme));
  });

  it('the participant page reads it beside the rest, and the rest is exactly as it was', () => {
    const before = resolveClientTheme({ name: 'Acme', theme: STORED, themeVersion: 3 });
    const off = resolveClientTheme({ name: 'Acme', theme: { ...STORED, motion: { enabled: false } }, themeVersion: 3 });
    const junk = resolveClientTheme({ name: 'Acme', theme: { ...STORED, motion: 'garbage' }, themeVersion: 3 });
    assert.deepEqual(before.motion, { enabled: true });
    assert.deepEqual(off.motion, { enabled: false });
    assert.deepEqual(junk.motion, { enabled: true });
    const { motion: a, ...restBefore } = before;
    const { motion: b, ...restOff } = off;
    void a; void b;
    assert.deepEqual(restOff, restBefore, 'tokens, words, pictures, plate, version and source do not change with the switch');
    assert.equal(resolveClientTheme(null).motion.enabled, true, 'nothing live: the default look moves');
  });

  it('withMotion changes the switch and nothing else, not even the theme\'s version', () => {
    const off = withMotion(STORED, false);
    assert.deepEqual(off, { ...STORED, motion: { enabled: false } });
    assert.equal(off.version, STORED.version);
    assert.deepEqual(withMotion(off, true), { ...STORED, motion: { enabled: true } });
    assert.deepEqual(withMotion(null, false), { motion: { enabled: false } });
    assert.notEqual(withMotion(STORED, false), STORED, 'a copy');
  });
});

describe('every writer that rebuilds a theme carries the switch over', () => {
  const off = { ...STORED, motion: { enabled: false } };

  it('a theme that never had one is stored exactly as before Phase 15 (no motion key)', () => {
    assert.equal('motion' in STORED, false);
    assert.equal('motion' in reviseClientTheme(STORED, { version: 4, copy: { eventTitle: 'New' } }), false);
    const client = { id: 'c', name: 'Acme', theme: STORED, themeVersion: 3 };
    const draft = draftFromClient(client);
    assert.equal('motion' in changesForSave(client, { ...cloneDraft(draft), primary: '#166534' }, draft).theme, false);
  });

  it('Brand Studio\'s save keeps it (and keeps it from the copy it is written over, not the one read before the uploads)', () => {
    const client = { id: 'c', name: 'Acme', theme: off, themeVersion: 3 };
    const draft = draftFromClient(client);
    const changes = changesForSave(client, { ...cloneDraft(draft), primary: '#166534' }, draft);
    assert.deepEqual(changes.theme.motion, { enabled: false });
    assert.equal(changes.theme.primary, '#166534');
    assert.deepEqual(changes.theme.sample, STORED.sample);
  });

  it('the Clients screen\'s edit and Mark as confirmed keep it', () => {
    assert.deepEqual(reviseClientTheme(off, { version: 4, copy: { eventTitle: 'New' } }).motion, { enabled: false });
    assert.deepEqual(confirmedTheme(off, { by: 'Casey' }).motion, { enabled: false });
  });

  it('buildClientTheme writes it only when given, and only as { enabled }', () => {
    assert.deepEqual(buildClientTheme({ primary: '#045BCC', motion: { enabled: false, extra: 1 } }).motion, { enabled: false });
    assert.deepEqual(buildClientTheme({ primary: '#045BCC', motion: { enabled: 'no' } }).motion, { enabled: true });
    assert.equal('motion' in buildClientTheme({ primary: '#045BCC', motion: 'off' }), false);
  });
});

describe('the previous build reads a theme with the switch as it reads one without', () => {
  const copyPath = path.join(ROOT, 'migration/src/lib/brand/.client-theme.pms14.tmp.js');
  let previous;
  before(async () => {
    // pms-14's own file, next to the modules it imports, so the previous page's code is what reads the value.
    const source = execFileSync('git', ['show', '6aaa87e:migration/src/lib/brand/client-theme.js'], { cwd: ROOT, encoding: 'utf8' });
    await writeFile(copyPath, source);
    previous = await import(pathToFileURL(copyPath).href);
  });
  after(async () => { await rm(copyPath, { force: true }); });

  it('pms-14\'s resolveClientTheme: the same look, words and pictures with motion on, off or damaged', () => {
    const plain = previous.resolveClientTheme({ name: 'Acme', theme: STORED, themeVersion: 3 });
    for (const motion of [{ enabled: false }, { enabled: true }, 'garbage']) {
      assert.deepEqual(previous.resolveClientTheme({ name: 'Acme', theme: { ...STORED, motion }, themeVersion: 3 }), plain, JSON.stringify(motion));
    }
  });

  it('pms-14\'s Clients edit drops nothing it knew about from a theme with the key (and the new code reads its result as On)', () => {
    const revised = previous.reviseClientTheme({ ...STORED, motion: { enabled: false } }, { version: 4, copy: {} });
    assert.equal(revised.primary, STORED.primary);
    assert.equal(motionEnabled(revised), true, 'an older admin page that rebuilds the theme loses the key, which reads as On: fail safe');
  });
});

// ---- The switch on both backends ------------------------------------------------------------------------------------------------------

/** The switch's write, exactly as lib/admin/adminData.ts saveClientMotion composes it (a test below holds the source to this). */
const flip = (page, id, enabled) => page.updateClientWith(id, (client) => ({ theme: withMotion(client.theme, enabled) }));
/** Brand Studio's save as BrandStudio.svelte makes it: changes worked out from the client as it is at the write. */
const brandSave = (page, id, primary, during = async () => {}) => page.getClient(id).then(async (opened) => {
  const draft = draftFromClient(opened);
  const next = { ...cloneDraft(draft), primary };
  await during();
  return page.updateClientWith(id, (latest) => changesForSave(latest, next, draft));
});

describe('the switch on SharePoint (mocked REST)', () => {
  let fake;
  let page;
  before(async () => {
    fake = createSharePointFake();
    fake.install();
    page = await import(`../migration/src/lib/data/dataService.js?motion-sp=${Date.now()}`);
    page.configure({ sharePoint: fake.settings });
    await page.createClient({ id: 'c-sp', name: 'Acme', slug: 'acme', status: 'active', logoUrl: '', primaryColor: '#045bcc', secondaryColor: '#64748b', createdAt: '2026-10-18T00:00:00.000Z' });
    await page.updateClient('c-sp', { theme: STORED, themeVersion: 3 });
  });
  after(() => { globalThis.fetch = realFetch; ds.configure({ baseUrl: '/api' }); });

  it('a flip is two requests: the item, then a MERGE with its ETag (If-Match)', async () => {
    await page.getClient('c-sp');
    fake.reset();
    await flip(page, 'c-sp', false);
    const sent = fake.requests.map((entry) => `${entry.method} ${entry.ifMatch ? 'If-Match ' : ''}${entry.list ?? ''}`);
    assert.equal(fake.requests.length, 2, sent.join(' | '));
    assert.ok(fake.requests[1].ifMatch && fake.requests[1].ifMatch !== '*', 'the write names the version it read');
    assert.deepEqual(JSON.parse(fake.item('clients', 'c-sp').ThemeJson).motion, { enabled: false });
  });

  it('a colour saved between the flip\'s read and its write: the write is refused (412), read again, and both changes stay', async () => {
    await page.updateClient('c-sp', { theme: STORED, themeVersion: 3 });
    let interrupted = false;
    fake.reset();
    await page.updateClientWith('c-sp', (client) => {
      if (!interrupted) {
        interrupted = true;
        // Another admin's Brand Studio save lands now, straight into the list (as their page would write it).
        const row = fake.item('clients', 'c-sp');
        const theirs = buildClientTheme({ ...JSON.parse(row.ThemeJson), primary: '#5B3A99', version: 4 });
        row.ThemeJson = JSON.stringify(theirs);
        row.ThemeVersion = 4;
        row.__metadata.etag = `"theirs-${Date.now()}"`;
      }
      return { theme: withMotion(client.theme, false) };
    });
    const theme = JSON.parse(fake.item('clients', 'c-sp').ThemeJson);
    assert.equal(theme.primary, '#5B3A99', 'their colour');
    assert.deepEqual(theme.motion, { enabled: false }, 'and the switch');
    assert.equal(fake.item('clients', 'c-sp').ThemeVersion, 4);
    assert.equal(fake.requests.filter((entry) => entry.method === 'MERGE' && entry.list === 'clients').length, 2, 'the first write was refused (412) and made again on the new copy');
  });

  it('a flip that lands in the middle of a Brand Studio save: both stay', async () => {
    await page.updateClient('c-sp', { theme: STORED, themeVersion: 3 });
    await brandSave(page, 'c-sp', '#166534', () => flip(page, 'c-sp', false));
    const theme = JSON.parse(fake.item('clients', 'c-sp').ThemeJson);
    assert.equal(theme.primary, '#166534');
    assert.deepEqual(theme.motion, { enabled: false });
  });

  it('a failed save changes nothing and says why', async () => {
    await page.updateClient('c-sp', { theme: STORED, themeVersion: 3 });
    fake.failNext({ status: 503, times: 10, when: (entry) => entry.method === 'MERGE' && entry.list === 'clients' });
    await assert.rejects(flip(page, 'c-sp', false));
    fake.clearFaults();
    assert.equal(motionEnabled(JSON.parse(fake.item('clients', 'c-sp').ThemeJson)), true);
  });
});

describe('the switch on the local server', () => {
  let server;
  let dataDir;
  let page;
  let api;
  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'cec-motion-'));
    await cp(path.join(ROOT, 'server', 'data'), dataDir, { recursive: true });
    const port = await freePort();
    server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, UPLOAD_DIR: path.join(dataDir, 'uploads') }, stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((resolve, reject) => {
      server.once('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
      server.stdout.on('data', (chunk) => String(chunk).includes('running') && resolve());
    });
    api = `http://127.0.0.1:${port}/api`;
    globalThis.fetch = realFetch;
    page = await import(`../migration/src/lib/data/dataService.js?motion-local=${Date.now()}`);
    page.configure({ baseUrl: api });
    await page.createClient({ id: 'c-local', name: 'Acme', slug: 'acme-local', status: 'active', logoUrl: '', primaryColor: '#045bcc', secondaryColor: '#64748b', createdAt: '2026-10-18T00:00:00.000Z' });
  });
  after(async () => {
    server?.kill();
    globalThis.fetch = realFetch;
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('flipping writes motion and nothing else, and leaves ThemeVersion alone', async () => {
    await page.updateClient('c-local', { theme: STORED, themeVersion: 3 });
    await flip(page, 'c-local', false);
    const read = await page.getClient('c-local');
    assert.deepEqual(read.theme, { ...STORED, motion: { enabled: false } });
    assert.equal(read.themeVersion, 3);
  });

  it('a colour saved between the flip\'s read and its write: refused (412), read again, and both changes stay', async () => {
    await page.updateClient('c-local', { theme: STORED, themeVersion: 3 });
    const theirs = buildClientTheme({ ...STORED, primary: '#5B3A99', version: 4 });
    const statuses = [];
    let interrupted = false;
    // The other admin's save reaches the server just before this page's write does.
    globalThis.fetch = async (url, init = {}) => {
      if (!interrupted && init.method === 'PATCH' && init.headers?.['If-Match']) {
        interrupted = true;
        await realFetch(`${api}/clients/c-local`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: theirs, themeVersion: 4 }) });
      }
      const response = await realFetch(url, init);
      if (init.method === 'PATCH') statuses.push(response.status);
      return response;
    };
    try {
      await flip(page, 'c-local', false);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.deepEqual(statuses, [412, 200], 'refused once, then written on top');
    const read = await page.getClient('c-local');
    assert.equal(read.theme.primary, '#5B3A99', 'their colour');
    assert.deepEqual(read.theme.motion, { enabled: false }, 'and the switch');
    assert.equal(read.themeVersion, 4);
  });

  it('a flip that lands in the middle of a Brand Studio save: both stay', async () => {
    await page.updateClient('c-local', { theme: STORED, themeVersion: 3 });
    await brandSave(page, 'c-local', '#166534', () => flip(page, 'c-local', false));
    const read = await page.getClient('c-local');
    assert.equal(read.theme.primary, '#166534');
    assert.deepEqual(read.theme.motion, { enabled: false });
  });
});

describe('the admin page writes the switch only one way', () => {
  it('saveClientMotion is updateClientWith with withMotion on the client as read, and both screens use it through MotionSwitch', async () => {
    const data = await readFile(path.join(ROOT, 'migration/src/lib/admin/adminData.ts'), 'utf8');
    assert.match(data, /export async function saveClientMotion[\s\S]*?updateClientWith[\s\S]*?withMotion\(client\.theme, enabled\)/);
    const control = await readFile(path.join(ROOT, 'migration/src/admin/MotionSwitch.svelte'), 'utf8');
    assert.match(control, /role="switch"/);
    assert.match(control, /aria-checked=\{on\}/);
    assert.match(control, /saveClientMotion/);
    for (const screen of ['BrandStudio.svelte', 'AdminToday.svelte']) assert.match(await readFile(path.join(ROOT, 'migration/src/admin', screen), 'utf8'), /<MotionSwitch /, screen);
    const studio = await readFile(path.join(ROOT, 'migration/src/admin/BrandStudio.svelte'), 'utf8');
    assert.match(studio, /updateClientWith[\s\S]*?changesForSave\(latest, next, saved\)/, 'Brand Studio writes on the client as it is at the write');
  });
});

