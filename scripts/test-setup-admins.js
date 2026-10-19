// Phase 10c-3, part E: Setup adds the first admin, and the seed-file import brings no admins. Run: node --test scripts/test-setup-admins.js (part of
// `npm test`).
//
// "Add an admin" (migration/src/lib/setup/setup-admins.js) takes a name and a PIN typed twice (digits only, 6 to 12: the admin page's PIN field takes 12),
// and writes PMSAdminUsers with the hash migration/src/lib/admin/admin-pin.js compares: the same function, exported, with `login` unchanged. The PIN itself is
// never stored, sent, logged or shown, and the page lists the admins by name only. The import of a seed file leaves its admins out, so the demo PIN
// 1234 cannot reach a new site that way. On the mocked SharePoint REST and the real local server, which must leave the same record. How a PIN is
// hashed and compared is decision 10's and does not change.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { ID } from '../migration/src/lib/schema/pms-schema.js';
import { sha256Hex } from '../migration/src/lib/admin/sha256.js';
import { hashPin, login } from '../migration/src/lib/admin/admin-pin.js';
import * as pageService from '../migration/src/lib/data/dataService.js';
import { ADMIN_PIN, addAdmin, adminNames, newAdminProblem } from '../migration/src/lib/setup/setup-admins.js';
import { adminsInSeed, importSeed } from '../migration/src/lib/setup/setup-import.js';
import { freePort } from './free-port.js';
import { STRAYS, UNINDEXED, createSharePointFake } from './sharepoint-fake.js';

const ROOT = path.join(import.meta.dirname, '..');
const realFetch = globalThis.fetch;
const PIN = '482916';

/** A fake site whose every request is also noted with its body, to look for the PIN in anything that was sent. */
function siteWith(options = {}) {
  const fake = createSharePointFake(options);
  const sent = [];
  globalThis.fetch = async (url, init = {}) => {
    sent.push(`${String(url)} ${typeof init.body === 'string' ? init.body : ''}`);
    return fake.fetch(url, init);
  };
  return { fake, sent };
}
let pages = 0;
const freshPage = async (settings) => {
  const ds = await import(`../migration/src/lib/data/dataService.js?setup-admins=${pages += 1}`);
  ds.configure(settings);
  return ds;
};

describe('the rules of a new admin', () => {
  it('a name, and a PIN of 6 to 12 digits typed the same twice; each refusal in words', () => {
    assert.deepEqual(ADMIN_PIN, { min: 6, max: 12 });
    const cases = [
      [{ name: '', pin: PIN, again: PIN }, 'Type the admin\'s name.'],
      [{ name: '   ', pin: PIN, again: PIN }, 'Type the admin\'s name.'],
      [{ name: 'x'.repeat(256), pin: PIN, again: PIN }, 'A name can be 255 characters at most.'],
      [{ name: 'Asha', pin: '12345', again: '12345' }, 'A PIN is 6 to 12 digits.'],
      [{ name: 'Asha', pin: '1234567890123', again: '1234567890123' }, 'A PIN is 6 to 12 digits.'],
      [{ name: 'Asha', pin: '12a456', again: '12a456' }, 'A PIN is digits only (0 to 9).'],
      [{ name: 'Asha', pin: ' 123456', again: ' 123456' }, 'A PIN is digits only (0 to 9).'],
      [{ name: 'Asha', pin: PIN, again: '482917' }, 'The two PINs are not the same: type it again in both.'],
      [{ name: 'Asha', pin: PIN, again: PIN }, null],
      [{ name: 'Asha', pin: '123456789012', again: '123456789012' }, null],
    ];
    for (const [input, words] of cases) assert.equal(newAdminProblem(input), words, JSON.stringify({ ...input, name: input.name.slice(0, 10) }));
  });

  it('the hash is admin-pin.js\'s own, exported: SHA-256 as 64 hex characters, the same with or without crypto.subtle', async () => {
    assert.equal(await hashPin(PIN), sha256Hex(PIN));
    assert.match(await hashPin(PIN), /^[0-9a-f]{64}$/);
  });

  it('login is exactly what it was: admin-pin.js changed by one word, `export` before hashPin', async () => {
    const source = (await readFile(path.join(ROOT, 'migration/src/lib/admin/admin-pin.js'), 'utf8')).replace(/\r\n/g, '\n');
    assert.ok(source.includes(`/** Resolves to the matching admin user (without its PIN hash), or null. */
export async function login(pin) {
  const [hash, users] = await Promise.all([hashPin(pin), dataService.listAdminUsers()]);
  const user = users.find((candidate) => candidate.pin === hash);
  if (!user) return null;
  const { pin: _hash, ...safe } = user;
  return safe;
}`));
    assert.ok(source.includes(`export async function hashPin(pin) {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Hex(pin); // plain-http LAN page: no crypto.subtle
}`));
  });
});

describe('Add an admin, on SharePoint (mocked)', () => {
  it('writes the name and the hash, never the PIN; the admin page then unlocks with that PIN and not with another', async () => {
    const { fake, sent } = siteWith();
    pageService.configure({ sharePoint: fake.settings });
    const added = await addAdmin(pageService, { name: '  Asha Rao ', pin: PIN, again: PIN });
    assert.deepEqual(added, { name: 'Asha Rao' }, 'what comes back carries no PIN and no hash');
    const rows = fake.lists.get('adminusers');
    assert.equal(rows.length, 1);
    assert.match(rows[0][ID], /^admin-[0-9a-f]{8}$/);
    assert.deepEqual([rows[0].Name, rows[0].Title, rows[0].PinHash], ['Asha Rao', 'Asha Rao', sha256Hex(PIN)]);
    assert.ok(!sent.some((line) => line.includes(PIN)), 'the PIN is in nothing that was sent');
    assert.ok(!JSON.stringify(rows).includes(PIN), 'nor in anything stored');
    assert.deepEqual(await login(PIN), { id: rows[0][ID], name: 'Asha Rao' }, 'the admin page unlocks');
    assert.equal(await login('482917'), null, 'and a wrong PIN does not');
    assert.equal(await login('1234'), null, 'nor the demo PIN');
    pageService.configure({ baseUrl: '/api' });
  });

  it('lists the admins by name only, and refuses a PIN another admin has (no write)', async () => {
    const { fake } = siteWith();
    const ds = await freshPage({ sharePoint: fake.settings });
    await addAdmin(ds, { name: 'Asha Rao', pin: PIN, again: PIN });
    await addAdmin(ds, { name: 'Ben Ode', pin: '135792', again: '135792' });
    assert.deepEqual(await adminNames(ds), ['Asha Rao', 'Ben Ode']);
    fake.reset();
    await assert.rejects(addAdmin(ds, { name: 'Cleo', pin: PIN, again: PIN }), { message: 'Another admin already has that PIN: choose another.' });
    assert.equal(fake.writes().length, 0);
    await assert.rejects(addAdmin(ds, { name: 'Cleo', pin: '12', again: '12' }), { message: 'A PIN is 6 to 12 digits.' });
    assert.equal(fake.count(), 1, 'a PIN that breaks the rules is refused before anything is asked');
  });

  it('on lists that do not exist yet it says so, in words, and writes nothing', async () => {
    const { fake } = siteWith({ without: ['adminusers'], schemaVersion: null });
    const ds = await freshPage({ sharePoint: fake.settings });
    await assert.rejects(addAdmin(ds, { name: 'Asha', pin: PIN, again: PIN }), { message: 'The admins list does not exist yet: make the lists first (Show the plan, then Create).' });
    await assert.rejects(adminNames(ds), { message: 'The admins list does not exist yet: make the lists first (Show the plan, then Create).' });
    assert.equal(fake.writes().length, 0);
  });
});

describe('Add an admin, on the local server: the same record', () => {
  let server;
  let dataDir;
  after(async () => {
    server?.kill();
    globalThis.fetch = realFetch;
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('writes what SharePoint holds: the id, the name and the hash, and the admin page unlocks with it', async () => {
    globalThis.fetch = realFetch;
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'pms-admins-'));
    await cp(path.join(ROOT, 'server', 'data'), dataDir, { recursive: true });
    const port = await freePort();
    server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((resolve, reject) => {
      server.once('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
      server.stdout.on('data', (chunk) => String(chunk).includes('running') && resolve());
    });
    pageService.configure({ baseUrl: `http://localhost:${port}/api` });
    const added = await addAdmin(pageService, { name: 'Asha Rao', pin: PIN, again: PIN });
    assert.deepEqual(added, { name: 'Asha Rao' });
    const stored = JSON.parse(await readFile(path.join(dataDir, 'adminusers.json'), 'utf8'));
    const record = stored.find((user) => user.name === 'Asha Rao');
    assert.match(record.id, /^admin-[0-9a-f]{8}$/);
    assert.deepEqual(Object.keys(record).sort(), ['id', 'name', 'pin']);
    assert.equal(record.pin, sha256Hex(PIN));
    assert.equal((await login(PIN))?.name, 'Asha Rao');
    assert.equal(await login('482917'), null);
    assert.deepEqual(await adminNames(pageService), ['Demo Admin', 'Asha Rao'], 'the seeded demo admin of the local server, then the new one');
    const seeded = JSON.parse(await readFile(path.join(ROOT, 'server', 'data', 'adminusers.json'), 'utf8'));
    assert.deepEqual(seeded.map((user) => user.id), ['admin-1'], 'nothing a test made is in server/data');
    pageService.configure({ baseUrl: '/api' });
  });
});

describe('the seed-file import brings no admins', () => {
  it('a file that holds admin users is accepted, and none of them is imported (the demo PIN cannot reach a new site that way)', async () => {
    const { fake } = siteWith();
    const ds = await freshPage({ sharePoint: fake.settings });
    const seed = { version: 1, data: {
      clients: [{ id: 'c-seeded', name: 'Seeded' }], sections: [], questions: [], options: [], sessions: [],
      adminusers: [{ id: 'admin-1', pin: sha256Hex('1234'), name: 'Demo Admin' }],
    } };
    assert.equal(adminsInSeed(seed), 1, 'the page says one admin was left out');
    const results = await importSeed(ds, seed);
    assert.deepEqual(results.map((result) => [result.id, result.status]), [['c-seeded', 'Imported']]);
    assert.deepEqual(fake.lists.get('adminusers'), []);
    assert.equal(fake.count((entry) => entry.list === 'adminusers' && entry.path.includes('/items')), 0, 'not an item of the admins list is read or written (the list check reads its columns, as it reads every list\'s)');
    const without = { version: 1, data: { clients: [], sections: [], questions: [], options: [], sessions: [] } };
    assert.deepEqual(await importSeed(ds, without), [], 'and a file without them is as good');
    assert.equal(adminsInSeed(without), 0);
    assert.equal('importSharePointSeed' in ds, false, 'the import is Setup\'s alone: the participant page no longer carries it');
  });
});

describe('the suite', () => {
  it('no request of this suite reached a list that is not its own, and none filtered on a column the lists do not index', () => {
    assert.deepEqual(STRAYS, []);
    assert.deepEqual(UNINDEXED, []);
  });
});
