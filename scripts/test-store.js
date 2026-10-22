// Phase 17: the local server's store (server/store.js) writes a list as a temporary file renamed over the old one, and reads a list by opening its
// file. Windows refuses to rename over a file that is open (EPERM), so a write that met a read of the same list (two iPads at once: one making its
// visit while another looks for its earlier ones) failed with a 500 that SharePoint would never give. test-sessions.js's six simultaneous scans
// met it now and then on the development machine. A write that meets a read now tries again, a few milliseconds apart; a file that stays open, or
// any other error, still fails as before. (On macOS and Linux a rename over an open file succeeds, and the first two tests pass either way.)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let dir;
let store;
/** A reader as a page is one: a read, then a few milliseconds before the next (each is an HTTP request of its own). */
const gap = () => new Promise((resolve) => { setTimeout(resolve, 1 + Math.random() * 4); });

describe('the local server\'s store keeps a write that meets a read of the same list', () => {
  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'pms-store-'));
    process.env.DATA_DIR = dir;
    store = await import(`../server/store.js?store-test=${Date.now()}`);
  });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it('fifty writes while four readers read the same list: every write lands, in order', async () => {
    await writeFile(path.join(dir, 'tracks.json'), `${JSON.stringify(Array.from({ length: 300 }, (_, i) => ({ id: `t-${i}`, note: 'x'.repeat(200) })))}\n`);
    let reading = true;
    const readers = Array.from({ length: 4 }, async () => { while (reading) { await store.read('tracks'); await gap(); } });
    const writes = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => store.update('tracks', (rows) => { rows.push({ id: `new-${i}` }); return i; })));
    reading = false;
    await Promise.allSettled(readers);
    assert.deepEqual(writes.filter((write) => write.status === 'rejected').map((write) => write.reason.code), []);
    const rows = await store.read('tracks');
    assert.deepEqual(rows.slice(300).map((row) => row.id), Array.from({ length: 50 }, (_, i) => `new-${i}`));
    assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith('.tmp')), [], 'no temporary file is left');
  });

  it('a read that meets a write gets the list whole, before or after it', async () => {
    let reading = true;
    const seen = new Set();
    const reader = (async () => { while (reading) { seen.add((await store.read('tracks')).length); await gap(); } })();
    try {
      for (let i = 0; i < 20; i += 1) await store.update('tracks', (rows) => { rows.push({ id: `more-${i}` }); });
    } finally {
      reading = false;
      await reader.catch(() => {});
    }
    for (const length of seen) assert.ok(length >= 350 && length <= 370, `a whole list (${length} rows)`);
  });

  it('a file that stays open is still an error, after the tries (on Windows), and nothing is lost', { skip: process.platform !== 'win32' && 'a rename over an open file succeeds here' }, async () => {
    const file = path.join(dir, 'held.json');
    await writeFile(file, '[]\n');
    const handle = await open(file, 'r');
    try {
      const started = Date.now();
      await assert.rejects(store.update('held', (rows) => { rows.push({ id: 'x' }); }), { code: 'EPERM' });
      assert.ok(Date.now() - started < 3_000, 'it gives up within a few seconds');
    } finally { await handle.close(); }
    assert.deepEqual(await store.read('held'), [], 'the list is as it was');
  });
});
