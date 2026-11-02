// Prompt 26, Part 7: a sign-in lost costs no work. Answers given meanwhile stay on the device and are sent once, after signing in again; the pop-up opens only from a tap
// (a button calls it), says when it is blocked, and never leaves the page waiting; a batch never carries more than 20 reads; the size watch's words and thresholds.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as ds from '../migration/src/lib/data/dataService.js';
import { createAnswerStore } from '../migration/src/lib/participant/answer-store.js';
import { isSignInPopup, openSignInPopup } from '../migration/src/lib/common/sign-in-popup.js';
import { SIZE_WARNINGS, selfTestProbes, sizeWarning, PROBE_SIZES } from '../migration/src/lib/setup/setup-checks.js';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { LISTS } from '../migration/src/lib/schema/pms-schema.js';
import { columnsOf } from '../migration/src/lib/schema/pms-schema-meta.js';
import { parse } from './request-baseline.js';
import { createSharePointFake } from './sharepoint-fake.js';

const memory = () => { const map = new Map(); return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: (key) => { map.delete(key); } }; };
const realFetch = globalThis.fetch;

describe('a sign-in lost in the middle of a quiz', () => {
  let fake;
  before(() => { fake = createSharePointFake(); fake.install(); ds.configure({ sharePoint: fake.settings }); });
  after(() => { globalThis.fetch = realFetch; });

  it('one answer sent, the sign-in lost, three more answered: after signing in all four are saved, each once, and nothing stays on the device', async () => {
    const storage = memory();
    const store = createAnswerStore({ api: ds, storage, sleep: async () => {} });
    const visit = { trackId: 't-lost', sessionId: 's', clientId: 'c', restartedAt: null };
    await store.restore(visit, null);
    const pick = (id) => ({ questionId: id, answer: 'a', firstAnswer: 'a', attempts: 1, correct: null });
    store.record(visit, 'sec', pick('q1'));
    await store.flush(visit, 'sec');
    fake.expireSession();
    for (const id of ['q2', 'q3', 'q4']) store.record(visit, 'sec', pick(id));
    await assert.rejects(store.flush(visit, 'sec'));
    assert.equal(store.pending(visit, 'sec').length, 3, 'held');
    assert.match(JSON.stringify([...storage.map.values()]), /q4/, 'and on the device, for a reload');
    assert.doesNotMatch(JSON.stringify([...storage.map.values()]), /participantName|displayName/, 'answers alone');
    fake.renewSession();
    assert.equal(await ds.checkSignedIn(), true);
    store.resume(visit);
    await store.flush(visit, 'sec');
    assert.deepEqual(JSON.parse(fake.item('responses', 't-lost').ResponsesJson).map((record) => record.questionId), ['q1', 'q2', 'q3', 'q4']);
    assert.equal(store.hasPending(visit), false);
    assert.equal(storage.map.size, 0);
  });

  it('checkSignedIn says when the sign-in is still refused, and is past the ladder\'s cooldown', async () => {
    fake.expireSession();
    assert.equal(await ds.checkSignedIn(), false);
    fake.renewSession();
    assert.equal(await ds.checkSignedIn(), true);
  });
});

describe('the pop-up', () => {
  const host = (popup) => {
    const listeners = new Set();
    const calls = { opened: [] };
    return {
      calls, say: (data, origin = 'https://site.example') => { for (const listener of listeners) listener({ data, origin }); },
      location: { origin: 'https://site.example' },
      open: (...args) => { calls.opened.push(args); return popup; },
      addEventListener: (_name, listener) => listeners.add(listener), removeEventListener: (_name, listener) => listeners.delete(listener),
      setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 2, clearTimeout: () => {},
    };
  };
  const URL_NOW = 'https://site.example/sites/x/PMS/index.html?t=1#/agenda';

  it('opens this page, marked, and carries on when it says so', async () => {
    const world = host({ closed: false });
    const done = openSignInPopup(URL_NOW, async () => true, world);
    assert.equal(world.calls.opened[0][0], 'https://site.example/sites/x/PMS/index.html?signed-in=1');
    world.say('something else');
    world.say('pms-signed-in', 'https://elsewhere.example');
    world.say('pms-signed-in');
    assert.equal(await done, true);
  });
  it('blocked: false at once, and nothing else is asked', async () => {
    let asked = 0;
    assert.equal(await openSignInPopup(URL_NOW, async () => { asked += 1; return true; }, host(null)), false);
    assert.equal(asked, 0);
  });
  it('the page knows it is the pop-up only with an opener and the mark', () => {
    assert.equal(isSignInPopup({ search: '?signed-in=1' }, {}), true);
    assert.equal(isSignInPopup({ search: '?signed-in=1' }, null), false);
    assert.equal(isSignInPopup({ search: '' }, {}), false);
  });
});

describe('a batch', () => {
  it('never carries more than 20 reads, whatever is asked; the answers keep their order', async () => {
    const fake = createSharePointFake();
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    for (let at = 0; at < 47; at += 1) fake.add('clients', { AppId: `c-${at}`, Name: `Client ${at}` });
    for (const size of [1, 2, 19, 20, 21, 40, 47]) {
      fake.reset();
      const queries = Array.from({ length: size }, (_, at) => ({ list: 'clients', where: { id: `c-${at}` } }));
      const answers = await ds.readLists(queries);
      assert.deepEqual(answers.map(([row]) => row.id), queries.map(({ where }) => where.id));
      for (const entry of fake.requests) assert.ok((entry.parts?.length ?? 0) <= 20, `${entry.parts?.length} reads in one batch`);
    }
    globalThis.fetch = realFetch;
  });
});

describe('the size watch', () => {
  it('warns at 3,000 and 4,500 in a plain sentence, and not below', () => {
    assert.deepEqual([...SIZE_WARNINGS], [3000, 4500]);
    assert.equal(sizeWarning('PMSVisitLog', 2999), null);
    assert.equal(sizeWarning('PMSVisitLog', 3412), 'PMSVisitLog has 3,412 items. SharePoint refuses some reads above 5,000. Ask Satyadev to run Housekeeping.');
    assert.match(sizeWarning('PMSVisitLog', 4501), /4,501 items/);
  });
  it('the self-test reads each list\'s count, and says the sentence for one that has grown (3,001 and 4,501 fake items)', async () => {
    const answers = { PMSVisitLog: 3001, PMSParticipantAnswers: 4501 };
    const probe = async (_list, address) => {
      const title = /getbytitle\('([^']+)'\)/.exec(address)?.[1];
      return { ok: true, data: { ItemCount: answers[title] ?? 7 } };
    };
    const titles = Object.fromEntries(Object.entries(LISTS).map(([key, { title }]) => [key, title]));
    const step = selfTestProbes(probe, titles).find(({ name }) => name === PROBE_SIZES);
    const said = await step.run();
    assert.match(said, /PMSVisitLog has 3,001 items/);
    assert.match(said, /PMSParticipantAnswers has 4,501 items/);
    assert.match(said, /PMSClients 7/);
  });
});

describe('what a read may filter or order by', () => {
  const INDEXED = Object.fromEntries(Object.keys(LISTS).map((key) => [LISTS[key].title, new Set(columnsOf(key).filter((column) => column.indexed).map((column) => column.name))]));
  const dir = path.join(import.meta.dirname, 'request-baseline');
  it('every recorded address filters and orders only by an indexed column (Setup\'s read-only probes, which ask for Id alone, aside)', () => {
    const found = [];
    let looked = 0;
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.txt'))) {
      for (const [entry] of parse(readFileSync(path.join(dir, file), 'utf8'))) {
        for (const line of entry.split('\n')) {
          const address = decodeURIComponent(line.trim().replace(/^carries /, ''));
          const title = /getbytitle\('([^']+)'\)\/items\?/.exec(address)?.[1]?.replace(/^Test/, '');
          if (!title || !INDEXED[title] || /\$select=Id(&|$)/.test(address)) continue;
          looked += 1;
          const filter = /\$filter=([^&]*)/.exec(address)?.[1] ?? '';
          const order = /\$orderby=(\w+)/.exec(address)?.[1];
          for (const [, column] of filter.matchAll(/(\w+) eq /g)) if (!INDEXED[title].has(column)) found.push(`${title}.${column}: ${file}`);
          if (order && order !== 'ID' && !INDEXED[title].has(order)) found.push(`${title}.${order} (orderby): ${file}`);
        }
      }
    }
    assert.ok(looked > 100, `looked at ${looked}`);
    assert.deepEqual([...new Set(found)], []);
  });
});
