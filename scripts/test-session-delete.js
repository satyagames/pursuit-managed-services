// Phase 16, Part 2: "Delete session..." on Admin → Results deletes a session's data for good. What it removes (every item keyed by the session's id in
// the lists of SESSION_OWNED, and nothing else), in which order (children first, the session item last), what it refuses (the live session; numbers
// that changed while the dialog was open), that it can be run again after it stopped part way, and the requests it sends. On both adapters: the
// mocked SharePoint REST (scripts/sharepoint-fake.js) and the real local server on a scratch copy of server/data (never server/data itself).
// Run: node --test scripts/test-session-delete.js (also part of npm test).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as ds from '../migration/src/lib/data/dataService.js';
import { LISTS } from '../migration/src/lib/schema/pms-schema.js';
import {
  DELETE_SESSION, KEPT, SESSION_OWNED, cardCounts, changedText, countsText, deleteSessionData, deleteSessionWarning, deletedText, planSessionDelete, progressText,
  refusedText, stoppedText,
} from '../migration/src/lib/admin/session-delete.js';
import { samplePack } from '../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../migration/src/lib/setup/seed.js';
import { freePort } from './free-port.js';
import { createSharePointFake } from './sharepoint-fake.js';

const ROOT = path.join(import.meta.dirname, '..');
const realFetch = globalThis.fetch;
const DAY = '2026-10-15';
const KROGER = `kroger-${DAY}`;
const DOMINOS = `dominos-${DAY}`;
const CONTENT = ['clients', 'sections', 'questions', 'options', 'adminusers', 'appsettings'];
const FAST = { gapMs: 0 };

/** Every list that holds a session id: a field named like it. */
const sessionLists = () => Object.entries(LISTS).filter(([, { fields }]) => Object.keys(fields).some((field) => /sessionid$/i.test(field))).map(([key]) => key);

describe('what a session delete removes, and in which order (Phase 16)', () => {
  it('every list with a session id column is either deleted from or kept on purpose, with a reason', () => {
    const owned = SESSION_OWNED.map((entry) => entry.list);
    const kept = KEPT.map((entry) => entry.list);
    for (const list of sessionLists()) assert.ok(owned.includes(list) || kept.includes(list), `${list} has a session id column: put it in SESSION_OWNED or KEPT`);
    assert.ok(owned.includes('sessions'), 'and the session item itself');
    for (const entry of KEPT) assert.ok(entry.why.length > 20, `${entry.list} says why it is kept`);
    for (const entry of SESSION_OWNED) {
      assert.ok(LISTS[entry.list], `${entry.list} is a list of the schema`);
      assert.ok(LISTS[entry.list].fields[entry.key], `${entry.list} has the field ${entry.key}`);
    }
    assert.deepEqual(owned.filter((list) => kept.includes(list)), [], 'nothing is both');
  });

  it('the check can fail: a new list with a session id that is in neither table is found', () => {
    const lists = { ...LISTS, newthing: { title: 'PMSNewThing', fields: { id: { column: 'AppId' }, sessionId: { column: 'SessionId' } } } };
    const named = Object.entries(lists).filter(([, { fields }]) => Object.keys(fields).some((field) => /sessionid$/i.test(field))).map(([key]) => key);
    const known = new Set([...SESSION_OWNED.map((entry) => entry.list), ...KEPT.map((entry) => entry.list)]);
    assert.deepEqual(named.filter((list) => !known.has(list)), ['newthing']);
  });

  it('children first, the session item last: answers, visit log, iPads, guest list, guest codes, the dashboard summary, then the session', () => {
    // (Prompt 21, Phase 5: the summary holds a few comments with their author, so it goes with the session's data.)
    assert.deepEqual(SESSION_OWNED.map((entry) => entry.list), ['responses', 'uservisitlogs', 'tracks', 'visitorroster', 'qrtokens', 'sessionsummary', 'sessions']);
    assert.equal(SESSION_OWNED.at(-1).key, 'id');
  });

  it('never names a content list, the admins, the settings or the pictures', () => {
    const owned = SESSION_OWNED.map((entry) => entry.list);
    for (const list of CONTENT) assert.ok(!owned.includes(list), `${list} is never deleted from`);
  });
});

describe('the words of a session delete (Phase 16)', () => {
  it('the warning is built from the session, says permanently, and names what is kept', () => {
    const warning = deleteSessionWarning({ clientName: 'Kroger', date: '2026-10-15', status: 'completed' }, { ipads: 4, answers: 34, codes: 6 });
    assert.equal(warning.lead, 'You are about to delete all data of Kroger, 2026-10-15 from the SharePoint lists: 4 iPads, 34 answers, 6 guest codes. This is permanent and cannot be undone.');
    assert.ok(warning.points.includes(DELETE_SESSION.kept));
    assert.ok(!warning.points.includes(DELETE_SESSION.inProgress));
    const open = deleteSessionWarning({ clientName: "Domino's", date: '2026-10-14', status: 'in-progress' }, { ipads: 1, answers: 1, codes: 0 });
    assert.match(open.lead, /Domino's, 2026-10-14 from the SharePoint lists: 1 iPad, 1 answer, 0 guest codes\./);
    assert.ok(open.points.includes(DELETE_SESSION.inProgress), 'an in-progress session that is not live says it may be deleted');
  });

  it('the buttons say what they do, and the rest of the words are in one place', () => {
    assert.equal(DELETE_SESSION.confirm, 'Delete permanently');
    assert.equal(DELETE_SESSION.title, "Delete this session's data permanently?");
    assert.equal(DELETE_SESSION.live, 'This session is live. End it in Today first.');
    assert.equal(progressText({ done: 140, total: 380 }), 'Deleting 140 of 380...');
    assert.match(stoppedText(3), /^Stopped: 3 items are left\./);
    assert.match(stoppedText(1), /^Stopped: 1 item is left\./);
    assert.match(refusedText('PMSVisitLog'), /may not delete items in PMSVisitLog/);
    assert.equal(deletedText({ clientName: 'Kroger', date: '2026-10-15' }), 'Kroger 2026-10-15 deleted');
    assert.equal(countsText({ ipads: 2, answers: 0, codes: 1 }), '2 iPads, 0 answers, 1 guest code');
    assert.match(changedText({ ipads: 2, answers: 5, codes: 1 }), /now 2 iPads, 5 answers, 1 guest code\. .*Delete permanently again\./);
    for (const text of [...Object.values(DELETE_SESSION), stoppedText(2), refusedText('X'), changedText({ ipads: 1, answers: 1, codes: 1 })]) {
      assert.doesNotMatch(text, /purge|cascade|OK\b/i, `plain words: ${text}`);
    }
  });

  it('a card\'s numbers come from what it holds', () => {
    const card = { results: { tracks: [{}, {}], sections: [{ questions: [{ responses: [{}, {}] }, { responses: [{}] }] }, { questions: [] }] }, codes: ['used', 'unused'] };
    assert.deepEqual(cardCounts(card), { ipads: 2, answers: 3, codes: 2 });
  });
});

// ---- On both adapters --------------------------------------------------------------------------------------------------------------------

/** Kroger on DAY: two iPads with answers, one without, a guest on the roster with a code, two visit log entries; then Domino's goes live with one iPad. */
async function scene() {
  await ds.activateClient('c-kroger', DAY);
  const tracks = [];
  for (let index = 0; index < 3; index += 1) tracks.push(await ds.beginVisit(crypto.randomUUID(), KROGER, 'c-kroger'));
  const session = await ds.getSession(KROGER);
  const section = await ds.getSection(session.sectionIds[0]);
  const answer = (trackId, questionId) => ({ questionId, answer: 'x', firstAnswer: 'x', attempts: 1, correct: null, answeredAt: `${DAY}T10:00:00.000Z` });
  await ds.saveParticipantResponses({ trackId: tracks[0].id, sessionId: KROGER, clientId: 'c-kroger', responses: section.questionIds.slice(0, 2).map((id) => answer(tracks[0].id, id)) });
  await ds.saveParticipantResponses({ trackId: tracks[1].id, sessionId: KROGER, clientId: 'c-kroger', responses: [answer(tracks[1].id, section.questionIds[0])] });
  await ds.setSessionParticipationMode(KROGER, 'client-visit');
  const guest = await ds.createVisitor({ sessionId: KROGER, displayName: 'Ada Guest', enabled: true });
  await ds.provisionQrToken('c-kroger', KROGER, { visitorId: guest.id });
  for (const track of tracks.slice(0, 2)) await ds.recordUserVisit({ id: `visit-${track.id}`, sessionId: KROGER, clientId: 'c-kroger', page: 'participant', entryMode: 'sign-in', trackId: track.id, visitedAt: `${DAY}T09:00:00.000Z` });
  // (Prompt 21, Phase 5) each session's summary for the dashboard.
  const summary = (id, clientId) => ({ id, clientId, period: 'FY27-Q2', sessionDate: DAY, guests: 1, answers: 1, completed: 0, beforeCount: 0, afterCount: 0, pairedCount: 0, meanBefore: null, meanAfter: null, summaryJson: { feedback: { quotes: [{ name: 'Ada Guest', text: 'Good' }] } } });
  await ds.saveSessionSummary(summary(KROGER, 'c-kroger'));
  await ds.activateClient('c-dominos', DAY);
  const other = await ds.beginVisit(crypto.randomUUID(), DOMINOS, 'c-dominos');
  await ds.saveSessionSummary(summary(DOMINOS, 'c-dominos'));
  return { tracks, other };
}

/** How many items each list holds for a session, by key. */
async function holding(sessionId) {
  const out = {};
  for (const { list, key } of SESSION_OWNED) out[list] = (await ds.listItemKeys(list, { [key]: sessionId })).length;
  return out;
}
/** Every item of the content lists, by key: what a delete must never change. */
async function content() {
  const out = {};
  for (const list of CONTENT) out[list] = (await ds.readLists([{ list }]))[0].map((row) => JSON.stringify(row)).sort();
  return out;
}
/** The data service with one list's deletes failing (`status`), as a part-way stop. */
const failingOn = (list, status = 500) => ({
  ...ds,
  deleteByKey: async (name, key) => { if (name === list) throw Object.assign(new Error(`refused (${status})`), { status }); return ds.deleteByKey(name, key); },
});
const empty = Object.fromEntries(SESSION_OWNED.map(({ list }) => [list, 0]));

function behaves(name, setUp) {
  describe(`deleting a session's data, on ${name} (Phase 16)`, () => {
    let site;
    before(async () => { site = await setUp(); });
    after(async () => { await site?.stop(); });

    it('removes every item keyed by the session in every list it owns, and nothing else', async () => {
      await site.fresh();
      await scene();
      assert.deepEqual(await holding(KROGER), { responses: 2, uservisitlogs: 2, tracks: 3, visitorroster: 1, qrtokens: 1, sessionsummary: 1, sessions: 1 });
      const before = await content();
      const other = await holding(DOMINOS);
      const plan = await planSessionDelete(KROGER);
      assert.deepEqual(plan.counts, { ipads: 3, answers: 3, codes: 1 });
      assert.equal(plan.live, false);
      const steps = [];
      const result = await deleteSessionData(KROGER, { expected: plan.counts, onProgress: (step) => steps.push(step), ...FAST });
      assert.deepEqual(result.deleted, { responses: 2, uservisitlogs: 2, tracks: 3, visitorroster: 1, qrtokens: 1, sessionsummary: 1, sessions: 1 });
      assert.equal(result.total, 11); // (10 until Prompt 21, Phase 5: the summary)
      assert.equal(result.left, 0);
      assert.deepEqual(result.leftovers, []);
      assert.deepEqual(steps[0], { done: 0, total: 11 });
      assert.deepEqual(steps.at(-1), { done: 11, total: 11 });
      assert.deepEqual(await holding(KROGER), empty);
      assert.equal(await ds.getSession(KROGER), null);
      assert.deepEqual(await content(), before, 'the client, activities, questions, options, admins and settings are untouched');
      assert.deepEqual(await holding(DOMINOS), other, "the other session's data is untouched");
    });

    it('refuses the live session, in words, and deletes nothing; a session in progress that is not live may be deleted', async () => {
      await site.fresh();
      await scene();
      await assert.rejects(deleteSessionData(DOMINOS, FAST), (error) => error.code === 'session-live' && error.message === DELETE_SESSION.live);
      assert.equal((await holding(DOMINOS)).sessions, 1);
      assert.equal((await holding(DOMINOS)).tracks, 1);
      assert.equal((await ds.getSession(KROGER)).status, 'in-progress', 'Kroger was never ended');
      const result = await deleteSessionData(KROGER, FAST);
      assert.equal(result.left, 0);
      assert.deepEqual(await holding(KROGER), empty);
    });

    it('reads again before it deletes: numbers that changed while the dialog was open are refused, with the new numbers', async () => {
      await site.fresh();
      const { tracks } = await scene();
      const seen = (await planSessionDelete(KROGER)).counts;
      await ds.saveParticipantResponses({ trackId: tracks[2].id, sessionId: KROGER, clientId: 'c-kroger', responses: [{ questionId: 'q-new', answer: 'y', firstAnswer: 'y', attempts: 1, correct: null, answeredAt: `${DAY}T11:00:00.000Z` }] });
      await assert.rejects(deleteSessionData(KROGER, { expected: seen, ...FAST }), (error) => error.code === 'session-changed' && error.counts.answers === seen.answers + 1 && error.message === changedText(error.counts));
      assert.equal((await holding(KROGER)).responses, 3, 'nothing was deleted');
      const again = await deleteSessionData(KROGER, { expected: (await planSessionDelete(KROGER)).counts, ...FAST });
      assert.equal(again.left, 0);
    });

    it('is safe to run again: a second run finds nothing, and an item already gone counts as deleted', async () => {
      await site.fresh();
      await scene();
      await deleteSessionData(KROGER, FAST);
      assert.deepEqual(await deleteSessionData(KROGER, FAST), { deleted: {}, total: 0, leftovers: [], left: 0, refused: null });
      const [track] = await ds.listItemKeys('tracks', { sessionId: DOMINOS });
      await ds.deleteByKey('tracks', track.key);
      await ds.deleteByKey('tracks', track.key); // (404: already gone)
      assert.equal((await ds.listItemKeys('tracks', { sessionId: DOMINOS })).length, 0);
    });

    it('a session made again under the same id the same day has none of the old one', async () => {
      await site.fresh();
      await scene();
      await deleteSessionData(KROGER, FAST);
      await ds.activateClient('c-kroger', DAY); // (the same id: kroger-<day>)
      assert.deepEqual(await holding(KROGER), { ...empty, sessions: 1 });
      assert.deepEqual((await ds.readSessionResponses(KROGER)), []);
      assert.deepEqual(await ds.listClientTracks(KROGER), []);
      // ...and it is the live one now, so it is refused.
      await assert.rejects(deleteSessionData(KROGER, FAST), (error) => error.code === 'session-live');
    });

    for (const [at, { list }] of SESSION_OWNED.entries()) {
      it(`a delete that fails at ${list} stops there, keeps the session on Results, and a second run removes the rest`, async () => {
        await site.fresh();
        await scene();
        const result = await deleteSessionData(KROGER, { data: failingOn(list), ...FAST });
        assert.ok(result.left > 0, 'something is left');
        assert.ok(result.leftovers.length > 0 && result.leftovers.every((entry) => entry.list === list), 'what is left is named');
        const now = await holding(KROGER);
        for (const later of SESSION_OWNED.slice(at)) assert.ok(now[later.list] > 0, `${later.list} is not reached`);
        for (const earlier of SESSION_OWNED.slice(0, at)) assert.equal(now[earlier.list], 0, `${earlier.list} went first`);
        assert.equal(now.sessions, 1, 'the session item is still there, so Results still shows it');
        const rest = await deleteSessionData(KROGER, FAST);
        assert.equal(rest.left, 0);
        assert.deepEqual(await holding(KROGER), empty);
      });
    }

    it('a refused delete (403) names the list in words and leaves the session to delete again', async () => {
      await site.fresh();
      await scene();
      const result = await deleteSessionData(KROGER, { data: failingOn('uservisitlogs', 403), ...FAST });
      assert.equal(result.refused, ds.sharePointListTitles().uservisitlogs);
      assert.equal((await holding(KROGER)).sessions, 1);
    });
  });
}

behaves('the mocked SharePoint', async () => {
  let fake;
  return {
    async fresh() {
      fake = createSharePointFake();
      fake.install();
      ds.configure({ sharePoint: fake.settings });
      await seedPack(ds, samplePack());
    },
    get fake() { return fake; },
    async stop() { globalThis.fetch = realFetch; ds.configure({ baseUrl: '/api' }); },
  };
});

behaves('the local server', async () => {
  let server;
  let dataDir;
  const start = async () => {
    server?.kill();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'cec-delete-'));
    await cp(path.join(ROOT, 'server', 'data'), dataDir, { recursive: true });
    const port = await freePort();
    server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((resolve, reject) => {
      server.once('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
      server.stdout.on('data', (chunk) => String(chunk).includes('running') && resolve());
    });
    globalThis.fetch = realFetch;
    ds.configure({ baseUrl: `http://localhost:${port}/api` });
  };
  return {
    fresh: start,
    async stop() { server?.kill(); ds.configure({ baseUrl: '/api' }); if (dataDir) await rm(dataDir, { recursive: true, force: true }); },
  };
});

// ---- The requests, on the mocked SharePoint ----------------------------------------------------------------------------------------------

describe('the requests of a session delete, on the mocked SharePoint (Phase 16)', () => {
  let fake;
  before(() => {});
  after(() => { globalThis.fetch = realFetch; ds.configure({ baseUrl: '/api' }); });

  /** A session with `count` iPads, each with an answers item, a visit log entry, a guest and a code: 5 items each, and the session and its summary. */
  async function sized(count) {
    fake = createSharePointFake();
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    const id = `big-${DAY}`;
    fake.add('sessions', { AppId: id, Title: id, ClientId: 'c-big', SessionDate: `${DAY}T00:00:00Z`, Status: 'completed', SectionIds: '[]' });
    for (let index = 0; index < count; index += 1) {
      const track = `t-${index}`;
      fake.add('tracks', { AppId: track, Title: track, SessionId: id, ClientId: 'c-big', CreatedAt: `${DAY}T09:00:00Z` });
      fake.add('responses', { AppId: track, Title: track, SessionId: id, TrackId: track, ClientId: 'c-big', ResponsesJson: JSON.stringify([{ questionId: 'q1', answer: 'a', firstAnswer: 'a', attempts: 1, correct: null }]) });
      fake.add('uservisitlogs', { AppId: `v-${index}`, Title: `v-${index}`, SessionId: id, ClientId: 'c-big', TrackId: track });
      fake.add('visitorroster', { AppId: `g-${index}`, Title: `g-${index}`, SessionId: id, GuestName: `Guest ${index}`, Enabled: true });
      fake.add('qrtokens', { AppId: `code-${index}`, Title: `code-${index}`, SessionId: id, ClientId: 'c-big', VisitorId: `g-${index}`, Used: true });
    }
    fake.add('sessionsummary', { AppId: id, Title: id, ClientId: 'c-big', Period: 'FY27-Q2', Guests: count, SummaryJson: '{}' });
    fake.reset();
    return id;
  }
  const pages = (count) => Math.max(1, Math.ceil(count / 200));

  for (const count of [0, 1, 60, 200]) {
    it(`a session of ${count} iPads: the reads, then one write for each item, and nothing else`, async () => {
      const id = await sized(count);
      const result = await deleteSessionData(id, FAST);
      assert.equal(result.left, 0);
      assert.equal(result.total, count * 5 + 2); // (+ 1 until Prompt 21, Phase 5: the session alone)
      const reads = fake.requests.filter((entry) => entry.method === 'GET');
      const writes = fake.writes();
      // Five child lists, the summary and the session, one read each (another for every 200 items more), the answers once more for the numbers, the settings item.
      assert.equal(reads.length, 5 * pages(count) + 2 + pages(count) + 1, reads.map((entry) => `${entry.method} ${entry.list}`).join('\n'));
      assert.equal(writes.length, count * 5 + 2, 'one delete for each item');
      assert.ok(writes.every((entry) => SESSION_OWNED.some(({ list }) => list === entry.list)), 'only the lists a session owns are written to');
      assert.equal(fake.count({ method: 'POST', list: null }) - writes.filter((entry) => entry.list === null).length <= 1, true, 'one write token at most');
      assert.ok(fake.requests.every((entry) => !/\$batch/.test(entry.path)), 'no batch: one paced delete for each item');
      for (const entry of fake.requests.filter((request) => request.method === 'GET' && /\/items\?/.test(request.path))) {
        assert.match(decodeURIComponent(entry.path), /\$select=/, 'every item read names its columns');
        assert.ok(entry.path.length < 2000, 'every address is short');
      }
    });
  }

  it('the deletes are paced: three at a time at most', async () => {
    const id = await sized(30);
    let running = 0;
    let most = 0;
    const data = { ...ds, deleteByKey: async (list, key) => { running += 1; most = Math.max(most, running); try { await ds.deleteByKey(list, key); } finally { running -= 1; } } };
    await deleteSessionData(id, { data, gapMs: 0 });
    assert.equal(most, 3);
  });
});
