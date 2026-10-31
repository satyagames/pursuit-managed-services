// Prompt 26, Part 3: fewer calls, none repeated. The activities' content is read once per session (a screen change does not read it again; a change the page's
// watch found, or five minutes, does); a save carries one change, never the same value twice; the watch reads a small thing first and the activities only if it moved;
// the admin page's schema check names what it uses.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as ds from '../migration/src/lib/data/dataService.js';
import { createAnswerStore } from '../migration/src/lib/participant/answer-store.js';
import { CONTENT_MAX_AGE_MS, createActivityContent } from '../migration/src/lib/participant/activity-content.js';
import { samplePack } from '../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../migration/src/lib/setup/seed.js';
import { forgetReads, heldRead, holdRead } from '../migration/src/lib/admin/list-cache.js';
import { createSharePointFake } from './sharepoint-fake.js';

const KROGER = 'c-kroger';
const realFetch = globalThis.fetch;
const memory = () => { const map = new Map(); return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: (key) => { map.delete(key); } }; };

describe('on a site with content', () => {
  let fake; let session; let sections;
  before(async () => {
    fake = createSharePointFake();
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    await seedPack(ds, samplePack());
    ({ session } = await ds.activateClient(KROGER, '2026-10-15'));
    sections = await ds.listClientSections(KROGER);
    fake.reset();
  });
  after(() => { globalThis.fetch = realFetch; });

  describe('the activities\' content', () => {
    const contentReads = () => fake.requests.flatMap((entry) => entry.parts ?? [entry]).filter((entry) => entry.method === 'GET' && entry.list === 'questions').length;
    const reading = () => { let now = 1_000_000; return { clock: { now: () => now, on: (ms) => { now += ms; } } }; };

    it('Welcome, hub, quiz, hub, finale: read once', async () => {
      fake.reset();
      const { clock } = reading();
      const content = createActivityContent({ api: ds, now: clock.now });
      await content.start(sections); // once the first screen is up
      const once = contentReads();
      assert.ok(once >= 1);
      assert.equal(await content.hubRead(KROGER, sections), null, 'the hub arriving: nothing new, nothing read');
      await content.questionsOf(sections[0], sections);
      assert.equal(await content.hubRead(KROGER, sections), null, 'the hub again');
      assert.equal(contentReads(), once);
    });

    it('five minutes on it is read again, and when the watch found a change', async () => {
      const { clock } = reading();
      const content = createActivityContent({ api: ds, now: clock.now });
      await content.start(sections);
      fake.reset();
      clock.on(CONTENT_MAX_AGE_MS - 1);
      assert.equal(await content.hubRead(KROGER, sections), null);
      assert.equal(fake.count(), 0);
      clock.on(2);
      assert.ok(Array.isArray(await content.hubRead(KROGER, sections)), 'read again, the activities with it');
      assert.equal(fake.count(), 1, 'one request');
      fake.reset();
      content.stale();
      assert.ok(Array.isArray(await content.hubRead(KROGER, sections)));
      assert.equal(fake.count(), 1);
      fake.reset();
      assert.equal(await content.hubRead(KROGER, sections), null, 'and then it is held again');
      assert.equal(fake.count(), 0);
    });

    it('nothing held: it reads, and a read that fails says so', async () => {
      const content = createActivityContent({ api: ds });
      fake.reset();
      assert.ok(Array.isArray(await content.hubRead(KROGER, [])));
      assert.equal(fake.count(), 1);
      fake.failNext({ status: 400, times: 1, when: (entry) => entry.list === 'sections' });
      const again = createActivityContent({ api: ds });
      await assert.rejects(again.hubRead(KROGER, []));
    });
  });

  describe('a save', () => {
    const visit = () => ({ trackId: `t-${crypto.randomUUID()}`, sessionId: session.id, clientId: KROGER, restartedAt: null });
    const pick = (answer) => ({ questionId: 'q-1', answer, firstAnswer: answer, attempts: 1, correct: null });
    const writes = () => fake.count((entry) => ['POST', 'MERGE'].includes(entry.method) && entry.list === 'responses');

    it('never writes a value equal to the one held', async () => {
      const store = createAnswerStore({ api: ds, storage: memory(), sleep: async () => {} });
      const mine = visit();
      await store.restore(mine, null);
      store.record(mine, 's', pick('a'));
      await store.flush(mine, 's');
      fake.reset();
      store.record(mine, 's', pick('a'));
      assert.equal(store.hasPending(mine), false);
      await store.flush(mine, 's');
      assert.equal(writes(), 0);
    });

    it('changes right after a write wait a moment, and share one write, with the last value', async () => {
      const waits = [];
      let wake;
      let clock = 1000;
      const store = createAnswerStore({ api: ds, storage: memory(), now: () => clock, sleep: async () => {}, quiet: (ms) => { waits.push(ms); return new Promise((resolve) => { wake = resolve; }); } });
      const mine = visit();
      await store.restore(mine, null);
      fake.reset();
      store.record(mine, 's', pick('a'));
      await store.flush(mine, 's');
      assert.equal(writes(), 1, 'the first goes at once');
      clock += 100;
      store.record(mine, 's', { ...pick('b'), firstAnswer: 'a' });
      store.record(mine, 's', { ...pick('c'), firstAnswer: 'a' });
      assert.deepEqual(waits, [200, 200]);
      assert.equal(writes(), 1, 'nothing yet');
      wake();
      await store.flush(mine, 's');
      assert.equal(writes(), 2);
      assert.equal(store.recordFor(mine, 'q-1').answer, 'c');
    });

    it('Submit does not wait for the moment', async () => {
      let clock = 1000;
      const store = createAnswerStore({ api: ds, storage: memory(), now: () => clock, sleep: async () => {}, quiet: () => new Promise(() => {}) });
      const mine = visit();
      await store.restore(mine, null);
      store.record(mine, 's', pick('a'));
      await store.flush(mine, 's');
      fake.reset();
      clock += 10;
      store.record(mine, 's', pick('b'));
      await store.flush(mine, 's');
      assert.equal(writes(), 1);
    });
  });

  describe('the watch', () => {
    before(() => ds.configure({ sharePoint: fake.settings })); // (a page that can batch again)
    it('reads a small thing first: an unchanged list costs one request and no activity row', async () => {
      const first = await ds.readParticipantWatch({ sessionId: session.id, clientId: KROGER, activitiesStamp: '' });
      assert.ok(first.sections.length, 'nothing held: the activities come');
      assert.ok(first.activitiesStamp);
      fake.reset();
      const second = await ds.readParticipantWatch({ sessionId: session.id, clientId: KROGER, activitiesStamp: first.activitiesStamp });
      assert.equal(second.sections, null);
      assert.equal(second.activitiesStamp, first.activitiesStamp);
      assert.equal(fake.count(), 1);
      const part = fake.requests[0].parts.find((entry) => entry.list === 'sections');
      assert.match(part.query, /\$select=Id,AppId,Modified$/);
    });

    it('a change to an activity is seen by the next look, whoever wrote it, and the look after carries it, each in one request', async () => {
      const held = await ds.readParticipantWatch({ sessionId: session.id, clientId: KROGER, activitiesStamp: '' });
      await ds.updateSection(sections[0].id, { title: 'A new title' });
      fake.reset();
      const moved = await ds.readParticipantWatch({ sessionId: session.id, clientId: KROGER, activitiesStamp: held.activitiesStamp });
      assert.equal(moved.sections, null);
      assert.equal(moved.activitiesStamp, '');
      const next = await ds.readParticipantWatch({ sessionId: session.id, clientId: KROGER, activitiesStamp: moved.activitiesStamp });
      assert.ok(next.sections.some((section) => section.title === 'A new title'));
      assert.ok(next.activitiesStamp && next.activitiesStamp !== held.activitiesStamp);
      assert.equal(fake.count(), 2, 'one request each');
    });

    it('with no stamp it reads as it always did', async () => {
      fake.reset();
      const read = await ds.readParticipantWatch({ sessionId: session.id, clientId: KROGER });
      assert.ok(read.sections.length);
      assert.equal(fake.count(), 1);
    });
  });

  describe('the schema check', () => {
    it('names the properties it reads of every list\'s columns, and the report is as it was', async () => {
      fake.reset();
      const report = await ds.checkSharePointSchema({ batch: true });
      assert.ok(report.every((entry) => entry.ready), JSON.stringify(report.filter((entry) => !entry.ready)).slice(0, 300));
      const parts = fake.requests.flatMap((entry) => entry.parts ?? [entry]).filter((entry) => /\/fields$/.test(entry.path));
      assert.ok(parts.length > 10);
      for (const part of parts) assert.match(part.query, /\$select=InternalName,TypeAsString/);
    });
  });
});

describe('what the admin page holds of a read', () => {
  it('stands until this page writes; a read says whether anything differs, so another person\'s write shows at the next read', () => {
    forgetReads();
    assert.equal(heldRead('clients', 0), null);
    assert.equal(holdRead('clients', [{ id: 'a' }], 0), true, 'the first read: draw');
    assert.deepEqual(heldRead('clients', 0), [{ id: 'a' }]);
    assert.equal(holdRead('clients', [{ id: 'a' }], 0), false, 'the same again: no redraw');
    assert.equal(holdRead('clients', [{ id: 'a' }, { id: 'b' }], 0), true, 'another person added one: draw');
    assert.equal(heldRead('clients', 1), null, 'this page wrote: not held');
  });
  it('a write counts, a read and the write token do not, on the data layer', async () => {
    const fake = createSharePointFake();
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    const before = ds.writesSent();
    await ds.listClients();
    assert.equal(ds.writesSent(), before);
    await ds.createClient({ id: 'c-w', name: 'W', slug: 'w' });
    assert.equal(ds.writesSent(), before + 1);
    globalThis.fetch = realFetch;
  });
  it('nothing of it is in browser storage', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../migration/src/lib/admin/list-cache.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source.replace(/^\/\/.*$/gm, ''), /localStorage|sessionStorage/);
  });
});
