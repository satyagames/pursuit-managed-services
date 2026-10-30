// Prompt 23, Part 5: a guest's picture in storage. The name holds no name of a person, what may be removed, Delete session taking the files, an audit line and never the image, on the
// mocked SharePoint and the real local server. What a browser must show (the dialog, the fallback, one request for the image) is scripts/migration-tests/art-of-the-possible.spec.ts's.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { GUEST_PICTURE_NAME as SERVER_NAME } from '../server/api.js';
import { guestPictureName, sha256Hex } from '../migration/src/lib/brand/asset-names.js';
import { SLOTS, slotSpec } from '../migration/src/lib/brand/asset-specs.js';
import { compressToCap } from '../migration/src/lib/brand/asset-compress.js';
import { GUEST_PICTURE_NAME } from '../migration/src/lib/schema/aop-rules.js';
import { PICTURE_CONSENT, clearGuestPicture, picturesLine, setGuestPicture } from '../migration/src/lib/admin/guest-picture.js';
import { deleteSessionData } from '../migration/src/lib/admin/session-delete.js';
import { freePort } from './free-port.js';
import { createSharePointFake } from './sharepoint-fake.js';

const ROOT = path.join(import.meta.dirname, '..');
const realFetch = globalThis.fetch;
const WEBP = (extra = '') => new Uint8Array([...new TextEncoder().encode('RIFF'), 20, 0, 0, 0, ...new TextEncoder().encode(`WEBPVP8 ${extra}`)]);
const blob = (extra = '') => new Blob([WEBP(extra)], { type: 'image/webp' });

let pages = 0;
const freshPage = async (settings) => {
  const page = await import(`../migration/src/lib/data/dataService.js?guest-page=${pages += 1}`);
  page.configure(settings);
  return page;
};

describe('the name', () => {
  it('is g-, 10 hex of the session and guest ids, 10 hex of the bytes: no name of a person, a new picture a new name', () => {
    const bytes = WEBP('a');
    const name = guestPictureName('s-1', 'v-jane-doe', bytes, 'image/webp');
    assert.equal(name, `g-${sha256Hex(new TextEncoder().encode('s-1v-jane-doe')).slice(0, 10)}-${sha256Hex(bytes).slice(0, 10)}.webp`);
    assert.match(name, GUEST_PICTURE_NAME);
    assert.ok(!name.includes('jane'));
    assert.notEqual(name, guestPictureName('s-1', 'v-jane-doe', WEBP('b'), 'image/webp'));
    assert.notEqual(name, guestPictureName('s-2', 'v-jane-doe', bytes, 'image/webp'));
    assert.match(guestPictureName('s', 'v', bytes, 'image/jpeg'), /\.jpg$/);
  });
  it('the local server takes the same name, and only it', () => {
    assert.equal(String(SERVER_NAME), String(GUEST_PICTURE_NAME));
    for (const bad of ['g-0123456789-abcdef0123.png', 'g-012-abc.webp', 'jane-g-0123456789-abcdef0123.webp', '../g-0123456789-abcdef0123.webp']) assert.ok(!SERVER_NAME.test(bad), bad);
  });
});

describe('the finished picture', () => {
  it('its slot: round, 256 by 256, WebP then JPEG, at most 60 KB, and no transparency', () => {
    const spec = slotSpec('guest');
    assert.deepEqual([spec.width, spec.height, [...spec.formats], spec.maxBytes, spec.transparent, spec.safe.shape], [256, 256, ['image/webp', 'image/jpeg'], 60 * 1024, false, 'circle']);
    assert.ok(SLOTS.guest);
  });
  it('a 200 KB photo comes out under 60 KB, by quality, and a browser that cannot make WebP gives a JPEG', async () => {
    const encode = (allow) => async (_canvas, mime, quality) => (allow.includes(mime) ? { mime, bytes: Math.round(200 * 1024 * (quality ?? 1) ** 6), data: 'blob' } : { mime: 'image/png', bytes: 200 * 1024, data: 'blob' });
    const webp = await compressToCap({ spec: SLOTS.guest, render: () => 'canvas', encode: encode(['image/webp', 'image/jpeg']) });
    assert.equal(webp.mime, 'image/webp');
    assert.ok(webp.bytes <= 60 * 1024, String(webp.bytes));
    const jpeg = await compressToCap({ spec: SLOTS.guest, render: () => 'canvas', encode: encode(['image/jpeg']) });
    assert.equal(jpeg.mime, 'image/jpeg');
    assert.ok(jpeg.bytes <= 60 * 1024);
  });
  it('says what it asks for, and the Guests screen\'s line', () => {
    assert.equal(PICTURE_CONSENT, 'Only add a picture if the guest agreed.');
    assert.equal(picturesLine([{ pictureUrl: 'x' }, {}, { pictureUrl: 'y' }, {}, { pictureUrl: 'z' }, {}]), '3 of 6 have a picture.');
    assert.equal(picturesLine([{}]), '0 of 1 has a picture.');
  });
});

for (const [adapter, start] of [
  ['SharePoint (mocked)', async () => {
    const fake = createSharePointFake();
    fake.install();
    const data = await freshPage({ sharePoint: fake.settings });
    return { data, count: () => fake.files.size, recycled: () => fake.recycled.length, writes: () => fake.writes(), stop: async () => { globalThis.fetch = realFetch; } };
  }],
  ['the local server', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'pms-guest-data-'));
    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'pms-guest-up-'));
    await cp(path.join(ROOT, 'server', 'data'), dataDir, { recursive: true });
    const port = await freePort();
    const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, UPLOAD_DIR: uploadDir }, stdio: 'ignore' });
    for (let tries = 0; tries < 80; tries += 1) { try { await realFetch(`http://localhost:${port}/api/clients`); break; } catch { await new Promise((resolve) => { setTimeout(resolve, 100); }); } }
    const data = await freshPage({ baseUrl: `http://localhost:${port}/api` });
    return { data, count: async () => (await readdir(uploadDir)).length, recycled: () => 0, writes: () => [], stop: async () => { server.kill(); await rm(dataDir, { recursive: true, force: true, maxRetries: 5 }); await rm(uploadDir, { recursive: true, force: true, maxRetries: 5 }); } };
  }],
]) {
  describe(`storing and removing, on ${adapter}`, () => {
    let site;
    let data;
    const audit = [];
    const logged = () => ({ addAccessRecord: async (_key, line) => { audit.push(line); return line; } });
    /** The data layer with the audit line caught: what lib/admin/guest-picture.js is handed. */
    const api = () => new Proxy(data, { get: (target, name) => (name === 'addAccessRecord' ? logged().addAccessRecord : target[name]) });
    before(async () => { site = await start(); data = site.data; });
    after(async () => { await site.stop(); });

    let visitor;
    it('a guest with no picture is written without the column, and has no picture', async () => {
      visitor = await data.createVisitor({ id: 'v-pic', sessionId: 's-pic', displayName: 'Jane Doe', enabled: true });
      assert.ok(!visitor.pictureUrl);
    });
    it('adding one stores the file and writes the row; the file\'s name holds no name; an audit line says so, with the guest\'s id and never the image', async () => {
      const before = await site.count();
      visitor = await setGuestPicture({ data: api(), access: { person: { key: 'a@b.c' } }, visitor, blob: blob('first') });
      assert.match(visitor.pictureUrl, /g-[0-9a-f]{10}-[0-9a-f]{10}\.webp$/);
      assert.ok(!visitor.pictureUrl.toLowerCase().includes('jane'));
      assert.equal(await site.count(), before + 1);
      assert.equal((await data.getVisitor('v-pic')).pictureUrl, visitor.pictureUrl);
      assert.equal(audit.at(-1).action, 'picture');
      assert.match(audit.at(-1).detail, /Added the picture of guest v-pic/);
      assert.ok(!JSON.stringify(audit).includes('RIFF') && !JSON.stringify(audit).includes(visitor.pictureUrl));
    });
    it('replacing it stores the new file and takes the old one away', async () => {
      const before = await site.count();
      const old = visitor.pictureUrl;
      visitor = await setGuestPicture({ data: api(), access: { person: { key: 'a@b.c' } }, visitor, blob: blob('second') });
      assert.notEqual(visitor.pictureUrl, old);
      assert.equal(await site.count(), before);
      assert.match(audit.at(-1).detail, /Replaced/);
    });
    it('a removal is refused unless the name is a guest picture\'s and the address is the one on that guest\'s row', async () => {
      const before = await site.count();
      assert.equal((await data.removeGuestPicture('/assets/images/clients/kroger-hero-0123456789.webp', visitor)).refused, true, 'a brand picture');
      assert.equal((await data.removeGuestPicture('/assets/images/clients/g-0000000000-0000000000.webp', visitor)).refused, true, 'another guest\'s');
      assert.equal((await data.removeGuestPicture(visitor.pictureUrl, { id: 'other', pictureUrl: null })).refused, true, 'not on that row');
      assert.equal((await data.removeGuestPicture(visitor.pictureUrl, 'no-such-guest')).refused, true, 'no such guest');
      assert.equal((await data.removeClientAsset(visitor.pictureUrl)), false, 'and the brand\'s remover never touches one');
      assert.equal(await site.count(), before);
    });
    it('an upload that is not one of the page\'s pictures is refused', async () => {
      await assert.rejects(data.uploadGuestPicture('s', 'v', new Blob(['<svg/>'], { type: 'image/svg+xml' })), { code: 'invalid-value' });
    });
    it('removing it takes the file and the row\'s address; removing then adding works', async () => {
      const before = await site.count();
      visitor = await clearGuestPicture({ data: api(), access: { person: { key: 'a@b.c' } }, visitor });
      assert.equal(await site.count(), before - 1);
      assert.ok(!(await data.getVisitor('v-pic')).pictureUrl);
      assert.match(audit.at(-1).detail, /Removed/);
      visitor = await setGuestPicture({ data: api(), access: { person: { key: 'a@b.c' } }, visitor, blob: blob('third') });
      assert.ok(visitor.pictureUrl);
    });
    it('a file already gone counts as gone, and says so', async () => {
      await data.removeGuestPicture(visitor.pictureUrl, visitor);
      const again = await data.removeGuestPicture(visitor.pictureUrl, visitor);
      assert.deepEqual([again.removed, again.missing], [false, true]);
    });
    it('Delete session takes the guests\' files, and says what it did; a file already gone does not stop it', async () => {
      const session = await data.createSession({ id: 's-del', clientId: 'c-none', date: '2026-10-30', sectionIds: [], status: 'completed' });
      const first = await data.createVisitor({ id: 'v-a', sessionId: session.id, displayName: 'A', enabled: true });
      const second = await data.createVisitor({ id: 'v-b', sessionId: session.id, displayName: 'B', enabled: true });
      const third = await data.createVisitor({ id: 'v-c', sessionId: session.id, displayName: 'C', enabled: true });
      await setGuestPicture({ data: api(), visitor: first, blob: blob('a') });
      const held = await setGuestPicture({ data: api(), visitor: second, blob: blob('b') });
      await data.removeGuestPicture(held.pictureUrl, held); // gone already, with the row still saying it
      void third;
      const before = await site.count();
      const result = await deleteSessionData(session.id, { data, gapMs: 0 });
      assert.deepEqual(result.pictures, { removed: 1, missing: 1, failed: 0 });
      assert.equal(await site.count(), before - 1);
      assert.equal(result.left, 0);
      assert.equal(await data.getVisitor('v-a'), null);
    });
  });
}
