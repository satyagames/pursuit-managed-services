// Phase 7: what the facilitator's Live display and an open participant page read on their timers, against the mocked SharePoint REST
// (scripts/sharepoint-fake.js, which counts requests and injects 429 and 503) and the real local server on a scratch copy of server/data.
//   Run: npm run test:live
//
// What this proves: the Live display's own tally and the one Results and the exports read (readSessionResults) are the tally of a session
// worked out by hand in this file, on both adapters; the feed and the participant watch are ONE request where the site can batch, the cost they report is true,
// a busy answer reaches the timer instead of being retried, and a site that cannot batch costs requests but never a failed screen.
// It is not the real tenant.
import assert from 'node:assert/strict';
import { freePort } from './free-port.js';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as ds from '../migration/src/lib/data/dataService.js';
import { loadLiveStructure, readLive } from '../migration/src/lib/admin/live-session.js';
import { readLeaderReportRecords } from '../migration/src/lib/exports/leader-report-data.js';
import { readSessionResults } from '../migration/src/lib/results/session-results.js';
import { buildResults } from '../migration/src/lib/results/results-tally.js';
import { samplePack } from '../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../migration/src/lib/setup/seed.js';
import { STRAYS, UNINDEXED, createSharePointFake } from './sharepoint-fake.js';

const ROOT = path.join(import.meta.dirname, '..');
const realFetch = globalThis.fetch;
const DAY = '2026-10-11';
const measured = [];

let server;
let dataDir;
let localBase;

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'cec-live-'));
  await cp(path.join(ROOT, 'server', 'data'), dataDir, { recursive: true });
  const port = await freePort();
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    server.once('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
    server.stdout.on('data', (chunk) => String(chunk).includes('running') && resolve());
  });
  localBase = `http://localhost:${port}/api`;
});

after(async () => {
  server?.kill();
  globalThis.fetch = realFetch;
  ds.configure({ baseUrl: '/api' });
  await rm(dataDir, { recursive: true, force: true });
  if (measured.length) {
    console.log('\nMeasured against the mocked SharePoint REST:');
    for (const [what, count, budget] of measured) console.log(`  ${String(count).padStart(4)}  ${budget ? `(${budget})`.padEnd(14) : ''.padEnd(14)} ${what}`);
  }
});

/** SharePoint (the fake) with both sample clients seeded and Kroger live. */
async function sharePoint(settings = {}) {
  const fake = createSharePointFake();
  fake.install();
  ds.configure({ sharePoint: { ...fake.settings, ...settings } });
  await seedPack(ds, samplePack());
  const { session } = await ds.activateClient('c-kroger', DAY);
  return { fake, session };
}

async function local() {
  // The server reads its files fresh on every request, so putting the seed back is a new site for the next test.
  await cp(path.join(ROOT, 'server', 'data'), dataDir, { recursive: true, force: true });
  globalThis.fetch = realFetch;
  ds.configure({ baseUrl: localBase });
  const { session } = await ds.activateClient('c-kroger', DAY);
  return { fake: null, session };
}

/**
 * One activity with one question of each kind the display draws (a choice, a multiple choice, a ranking, a confidence scale and written
 * feedback), on the live session; three participants answering, each in an item of their own. Works on either adapter: it only uses
 * the data service.
 */
async function populate(session) {
  const section = { id: 'sec-live', title: 'Live kinds', order: 9, enabled: true, clientId: session.clientId, questionIds: [] };
  const kinds = [
    ['q-live-single', 'single-select', ['A', 'B', 'C']],
    ['q-live-multi', 'multi-select', ['W', 'X', 'Y']],
    ['q-live-rank', 'ranked-voting', ['First', 'Second', 'Third']],
    ['q-live-scale', 'confidence-continuum', ['Low', 'Mid', 'High']],
    ['q-live-text', 'open-text-feedback', []],
  ];
  const optionIds = (id) => kinds.find(([questionId]) => questionId === id)[2].map((_label, index) => `${id}-o${index + 1}`);
  for (const [id, type, labels] of kinds) {
    for (const [index, label] of labels.entries()) await ds.createOption({ id: `${id}-o${index + 1}`, questionId: id, label, value: String(index + 1), correct: false });
    await ds.createQuestion({ id, sectionId: section.id, type, prompt: `Question ${id}`, optionIds: optionIds(id), order: section.questionIds.length });
    section.questionIds.push(id);
  }
  await ds.createSection(section);
  await ds.updateSession(session.id, { sectionIds: [...session.sectionIds, section.id] });
  const tracks = [];
  for (let index = 0; index < 3; index += 1) tracks.push(await ds.beginVisit(crypto.randomUUID(), session.id, session.clientId));
  const o = (question, number) => `${question}-o${number}`;
  const give = (track, responses) => ds.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: session.clientId, responses });
  const record = (questionId, answer) => ({ questionId, answer, firstAnswer: answer, attempts: 1, correct: null, answeredAt: '2026-10-11T12:00:00.000Z' });
  await give(tracks[0], [record('q-live-single', o('q-live-single', 1)), record('q-live-multi', [o('q-live-multi', 1), o('q-live-multi', 3)]), record('q-live-rank', [o('q-live-rank', 3), o('q-live-rank', 1), o('q-live-rank', 2)]), record('q-live-scale', o('q-live-scale', 3)), record('q-live-text', 'Great day')]);
  await give(tracks[1], [record('q-live-single', o('q-live-single', 1)), record('q-live-multi', [o('q-live-multi', 2)]), record('q-live-rank', [o('q-live-rank', 1), o('q-live-rank', 2), o('q-live-rank', 3)]), record('q-live-scale', o('q-live-scale', 1))]);
  // The third answers one question, and nothing else.
  await give(tracks[2], [record('q-live-single', o('q-live-single', 2))]);
  return { tracks, sectionId: section.id };
}

/**
 * The tally of populate()'s activity, worked out by hand from the answers it gives: [question, respondents, [count, percent, Borda points] for
 * each option in order]. Nobody's code made these numbers.
 *   single   A, A, B                         3 answered: 2, 1, 0 (two thirds, one third, none)
 *   multi    {W, Y}, {X}                     2 answered: 1, 1, 1 (each is half of the two people)
 *   ranking  Third-First-Second, First-Second-Third   2 answered; with three options first place is 3 points, then 2, then 1:
 *            First 2 + 3 = 5, Second 1 + 2 = 3, Third 3 + 1 = 4, of 12 points: 41.67%, 25%, 33.33%
 *   scale    High, Low                       2 answered: 1, 0, 1
 *   text     one written answer
 */
const LIVE_TALLY = [
  ['q-live-single', 3, [[2, 66.67], [1, 33.33], [0, 0]]],
  ['q-live-multi', 2, [[1, 50], [1, 50], [1, 50]]],
  ['q-live-rank', 2, [[2, 41.67, 5], [2, 25, 3], [2, 33.33, 4]]],
  ['q-live-scale', 2, [[1, 50], [0, 0], [1, 50]]],
  ['q-live-text', 1, []],
];
const tallyOf = (section) => section.questions.map((question) => [question.id, question.respondents,
  question.options.map((option) => [option.count, Math.round(option.percent * 100) / 100, ...(option.score === undefined ? [] : [option.score])])]);

/**
 * What a results tree of populate()'s session must be, whoever built it: the session's activities in its order with the new one last, every
 * question with its own options in their order, the hand-worked tally above for the activity people answered, and nothing counted anywhere else.
 */
function assertPopulated(results, session, tracks) {
  assert.equal(results.session.id, session.id);
  assert.deepEqual(results.sections.map((section) => section.id), [...session.sectionIds, 'sec-live']);
  assert.deepEqual(results.tracks.map((track) => track.id).sort(), tracks.map((track) => track.id).sort());
  for (const section of results.sections) {
    assert.deepEqual(section.questions.map((question) => question.id), section.questionIds, `${section.id}: its questions, in its order`);
    for (const question of section.questions) {
      assert.deepEqual(question.options.map((option) => option.id), question.optionIds, `${question.id}: its options, in its order`);
      assert.equal(question.respondents, question.responses.length);
      if (section.id !== 'sec-live') assert.deepEqual([question.respondents, question.options.map((option) => [option.count, option.percent])], [0, question.options.map(() => [0, 0])], `${question.id}: nobody answered it`);
    }
  }
  const live = results.sections.find((section) => section.id === 'sec-live');
  assert.deepEqual(tallyOf(live), LIVE_TALLY);
  const single = live.questions.find((question) => question.id === 'q-live-single');
  assert.deepEqual(single.responses.map((response) => response.clientTrackId).sort(), tracks.map((track) => track.id).sort(), 'each answer is its own visit\'s');
  assert.deepEqual(live.questions.find((question) => question.id === 'q-live-text').responses.map((response) => response.answer), ['Great day']);
}

const sorted = (answers) => [...answers].sort((a, b) => `${a.clientTrackId} ${a.questionId}`.localeCompare(`${b.clientTrackId} ${b.questionId}`));
const withoutRefs = (value) => JSON.parse(JSON.stringify(value));

for (const [name, open] of [['mocked SharePoint', sharePoint], ['the local server', local]]) {
  describe(`the Live display's own tally is the session's, worked out by hand, on ${name}`, () => {
    it('the hand-worked tree for every kind of question', async () => {
      const { session } = await open();
      const { tracks } = await populate(session);
      const held = await loadLiveStructure(session.id);
      const read = await readLive(held);
      assert.equal(read.gone, false);
      assertPopulated(read.results, session, tracks);
    });

    it('the feed\'s answers are the records readSessionResponses gives', async () => {
      const { session } = await open();
      await populate(session);
      const feed = await ds.readLiveFeed(session.id, { sectionIds: session.sectionIds });
      const answers = await ds.readSessionResponses(session.id);
      assert.deepEqual(sorted(feed.answers), sorted(answers));
      assert.ok(feed.answers.every((answer) => answer.attempts === 1), 'each with its attempt history');
      assert.equal(feed.session.id, session.id);
      assert.equal(feed.tracks.length, 3);
      assert.deepEqual(feed.sections.map((section) => section.id), session.sectionIds, 'the activities, in the session\'s order');
    });

    it('the exports read through readSessionResults, which counts every answer readSessionResponses gives: ten of them', async () => {
      const { session } = await open();
      await populate(session);
      const results = await readSessionResults(session.id);
      const answers = await ds.readSessionResponses(session.id);
      const counted = results.sections.flatMap((section) => section.questions).reduce((sum, question) => sum + question.respondents, 0);
      assert.equal(answers.length, 10, 'five, four and one');
      assert.equal(counted, answers.length);
    });
  });
}

// ---- Phase 9b: the Results screen and the exports read through readSessionResults (built on buildResults), and say what could not be read ----

for (const [name, open] of [['mocked SharePoint', sharePoint], ['the local server', local]]) {
  describe(`Phase 9b: readSessionResults (Results, the exports) on ${name}`, () => {
    it('gives the hand-worked tree, for every kind of question, and nothing is unreadable', async () => {
      const { session } = await open();
      const { tracks } = await populate(session);
      const read = await readSessionResults(session.id);
      assertPopulated(read, session, tracks);
      assert.deepEqual(read.unreadable, []);
      assert.equal(await readSessionResults('no-such-session'), null, 'a session that does not exist is null, as it was');
    });

    it('one damaged item: everyone else is counted exactly as before, and the damaged one is named', async () => {
      const { fake, session } = await open();
      const { tracks } = await populate(session);
      const before = await readSessionResults(session.id);
      const victim = tracks[1];
      if (fake) fake.lists.get('responses').find((row) => row.AppId === victim.id).ResponsesJson = '{broken';
      else await fetch(`${localBase}/participantresponses/${victim.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ responses: 'broken' }) });
      const after = await readSessionResults(session.id);
      assert.deepEqual(after.unreadable.map((entry) => entry.id), [victim.id]);
      // The other participants' answers are unchanged: only the victim's own answers left the tally.
      const answersOf = (results, trackId) => results.sections.flatMap((section) => section.questions).flatMap((question) => question.responses).filter((response) => response.clientTrackId === trackId);
      assert.ok(answersOf(before, victim.id).length > 0 && answersOf(after, victim.id).length === 0);
      for (const other of [tracks[0], tracks[2]]) assert.deepEqual(withoutRefs(answersOf(after, other.id)), withoutRefs(answersOf(before, other.id)));
      assert.equal(after.tracks.length, before.tracks.length, 'the visit itself is still a participant');
      const single = after.sections.find((section) => section.id === 'sec-live').questions.find((question) => question.id === 'q-live-single');
      assert.deepEqual(single.options.map((option) => option.count), [1, 1, 0], 'the two whose items can still be read');
    });

    it('the Live display\'s feed carries the same list, and says nothing when nothing is damaged', async () => {
      const { fake, session } = await open();
      const { tracks } = await populate(session);
      const held = await loadLiveStructure(session.id);
      assert.deepEqual((await readLive(held)).results.unreadable, []);
      if (fake) fake.lists.get('responses').find((row) => row.AppId === tracks[0].id).ResponsesJson = '"nope"';
      else await fetch(`${localBase}/participantresponses/${tracks[0].id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ responses: { a: 1 } }) });
      const read = await readLive(held);
      assert.equal(read.gone, false);
      assert.deepEqual(read.results.unreadable.map((entry) => entry.id), [tracks[0].id]);
      const same = await readSessionResults(session.id);
      assert.deepEqual(withoutRefs(read.results.sections), withoutRefs(same.sections), 'and the Live display and Results agree about what is counted');
    });
  });
}

// ---- Phase 9b: no request address grows with the content --------------------------------------------------------------------------------
// Results and the three exports read every question and option of a session, and boot reads one activity's questions, each in ONE address that grew with
// the content (about 40 characters an option: 2,400 at 60 options, and 2,000 at 30 questions). They now read in groups of 20 (readActivityContent's way),
// so no address is longer than 1,500 characters whatever the activity holds. (The legacy pages' own reader made one address for all of it,
// more than 1,500 characters at 60 questions: a test here held that until the function left in Phase 10c-2a.)

/** The longest address a request or a part of a batch carried: the whole URL, as sent, on a site with a realistic address. */
const longest = (fake, strip = (url) => url) => Math.max(...fake.requests.flatMap((entry) => [entry.url, ...(entry.parts ?? []).map((part) => part.url)]).map((url) => strip(url).length));
// (Since Phase 10h every item read names its columns: a `$select` of at most 170 characters, the same whatever the activity holds. The part of an
// address that could grow with the content is held to 1,500 characters as it always was, and the whole address to 1,700.)
const withoutSelect = (url) => url.replace(/&(?:\$|%24)select=[^&]*/, '');
const REAL_SITE = 'https://americas.internal.deloitteonline.com/sites/CreativeExpCOE';

/** One activity with `count` questions of four options each, with the ids the admin screens give (UUIDs), on the live session. */
async function bigActivity(session, count) {
  const questionIds = [];
  const questions = [];
  for (let number = 1; number <= count; number += 1) {
    const id = crypto.randomUUID();
    const optionIds = [];
    for (let index = 0; index < 4; index += 1) {
      const optionId = crypto.randomUUID();
      await ds.createOption({ id: optionId, questionId: id, label: `Answer ${number}.${index + 1}`, value: String(index), correct: index === 1 });
      optionIds.push(optionId);
    }
    await ds.createQuestion({ id, sectionId: 'sec-big', type: 'single-select', prompt: `Question ${number}`, optionIds, order: number });
    questionIds.push(id);
    questions.push({ id, optionIds });
  }
  const section = { id: 'sec-big', title: 'Big', order: 9, enabled: true, clientId: session.clientId, questionIds, description: '' };
  await ds.createSection(section);
  await ds.updateSession(session.id, { sectionIds: [...session.sectionIds, section.id] });
  return { section, questions };
}

for (const [name, open] of [
  ['mocked SharePoint', async () => {
    const fake = createSharePointFake({ siteUrl: REAL_SITE });
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    await seedPack(ds, samplePack());
    return { fake, session: (await ds.activateClient('c-kroger', DAY)).session };
  }],
  ['the local server', local],
]) {
  describe(`Phase 9b: short addresses, on ${name}`, () => {
    for (const count of [15, 60]) {
      it(`${count} questions of four options: Results, the exports, the Live display, the report and boot read all of it, none in a long address`, async () => {
        const { fake, session } = await open();
        const { section, questions } = await bigActivity(session, count);
        const tracks = [await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger')];
        await ds.saveParticipantResponses({ trackId: tracks[0].id, sessionId: session.id, clientId: 'c-kroger', responses: [{ questionId: questions[0].id, answer: questions[0].optionIds[1], firstAnswer: questions[0].optionIds[1], attempts: 1, correct: true, answeredAt: '2026-10-11T12:00:00.000Z' }] });
        const checked = [];
        const within = (what) => {
          if (!fake) return;
          checked.push([what, longest(fake)]);
          assert.ok(longest(fake, withoutSelect) <= 1_500, `${what}: the longest address without its $select was ${longest(fake, withoutSelect)} characters`);
          assert.ok(longest(fake) <= 1_700, `${what}: the longest address was ${longest(fake)} characters`);
        };

        if (fake) fake.reset();
        const results = await readSessionResults(session.id);
        const big = results.sections.find((entry) => entry.id === 'sec-big');
        assert.equal(big.questions.length, count);
        assert.ok(big.questions.every((question) => question.options.length === 4), 'every option of every question');
        assert.equal(big.questions[0].respondents, 1);
        assert.deepEqual(big.questions[0].options.map((option) => option.count), [0, 1, 0, 0]);
        within('Results and the exports (readSessionResults)');

        if (fake) fake.reset();
        const held = await loadLiveStructure(session.id);
        const live = await readLive(held);
        assert.equal(live.results.sections.find((entry) => entry.id === 'sec-big').questions.length, count);
        within('the Live display (structure and feed)');

        if (fake) fake.reset();
        const records = await readLeaderReportRecords(session.id);
        assert.equal(records.questions.filter((question) => question.sectionId === 'sec-big').length, count);
        assert.equal(records.options.filter((option) => questions.some((question) => question.id === option.questionId)).length, count * 4);
        within('the leader report (readLeaderReportRecords)');

        if (fake) fake.reset();
        const first = await ds.getSectionQuestions(section);
        assert.deepEqual(first.map((question) => question.id), questions.map((question) => question.id), 'in the activity\'s order');
        assert.deepEqual(first.map((question) => question.options.map((option) => option.id)), questions.map((question) => question.optionIds), 'each with its options in order');
        within('boot: the first activity (getSectionQuestions)');
        if (fake) measured.push([`${count} questions: the longest address of any of the five reads`, Math.max(...checked.map(([, length]) => length)), 1_700]);
      });
    }
  });
}

describe('the participant watch: ONE request on SharePoint', () => {
  it('reads AppSettings, the session, the track and the activities together, and says it cost one request', async () => {
    const { fake, session } = await sharePoint();
    const track = await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger');
    ds.configure({ sharePoint: fake.settings }); // a fresh page
    await ds.getAppSettings(); // (the write token is asked for with the first batch; that is once per page, not per look)
    fake.reset();
    const watch = await ds.readParticipantWatch({ sessionId: session.id, trackId: track.id, clientId: 'c-kroger' });
    assert.equal(watch.requests, 1);
    const sent = fake.select();
    assert.deepEqual(sent.filter((entry) => !entry.path.endsWith('/contextinfo')).map((entry) => entry.path.replace(/^.*\/_api/, '')), ['/$batch']);
    assert.equal(sent.find((entry) => entry.path.endsWith('/$batch')).parts.length, 4, 'four reads in the one request');
    assert.equal(watch.settings.activeSessionId, session.id);
    assert.equal(watch.settings.activeClientId, 'c-kroger');
    assert.equal(watch.session.id, session.id);
    assert.equal(watch.track.id, track.id);
    assert.deepEqual(watch.sections.map((section) => section.id), (await ds.getClientActivities('c-kroger', session)).map((section) => section.id));
    // A second look needs no write token again.
    fake.reset();
    await ds.readParticipantWatch({ sessionId: session.id, trackId: track.id, clientId: null });
    assert.equal(fake.count(), 1);
    assert.equal(fake.select()[0].parts.length, 3, 'without the hub: AppSettings, the session and the track');
    measured.push(['a participant look on the hub (AppSettings, session, track, activities)', 1, '1 request']);
    measured.push(['a participant look elsewhere (AppSettings, session, track)', 1, '1 request']);
  });

  it('reads only what it is asked for: a page with no visit and nothing live is one plain read', async () => {
    const { fake } = await sharePoint();
    ds.configure({ sharePoint: fake.settings });
    fake.reset();
    const watch = await ds.readParticipantWatch({});
    assert.equal(watch.requests, 1);
    assert.equal(fake.count(), 1);
    assert.equal(watch.session, null);
    assert.equal(watch.track, null);
    assert.equal(watch.sections, null);
    assert.equal(watch.settings.activeClientId, 'c-kroger');
  });

  it('a record that does not exist reads as null, not as a failure', async () => {
    const { fake, session } = await sharePoint();
    ds.configure({ sharePoint: fake.settings });
    const watch = await ds.readParticipantWatch({ sessionId: 'no-such-session', trackId: 'no-such-track', clientId: 'c-kroger' });
    assert.equal(watch.session, null);
    assert.equal(watch.track, null);
    assert.equal(watch.settings.activeSessionId, session.id);
  });

  it('notices an End session (the session\'s status) and a Reopen, in the same one request', async () => {
    const { fake, session } = await sharePoint();
    const track = await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger');
    const look = () => ds.readParticipantWatch({ sessionId: session.id, trackId: track.id });
    assert.equal((await look()).session.status, 'in-progress');
    await ds.endSession(session.id);
    fake.reset();
    const ended = await look();
    assert.equal(ended.session.status, 'completed');
    assert.equal(fake.count(), 1);
    assert.equal(ended.settings.activeSessionId, session.id, 'AppSettings does not change on End, which is why the session is read too');
    await ds.reopenSession(session.id);
    assert.equal((await look()).session.status, 'in-progress');
  });

  it('where the site cannot batch it costs one request each, says so, and still works: the page then waits that much longer', async () => {
    const { fake, session } = await sharePoint({ batch: false });
    const track = await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger');
    fake.reset();
    const watch = await ds.readParticipantWatch({ sessionId: session.id, trackId: track.id, clientId: 'c-kroger' });
    assert.equal(watch.requests, 4);
    assert.equal(fake.count((entry) => !entry.path.endsWith('/contextinfo')), 4);
    assert.equal(watch.session.id, session.id);
    assert.equal(watch.track.id, track.id);
    assert.ok(watch.sections.length > 0);
    measured.push(['the same look on a site that cannot batch', 4, '4 requests']);
  });

  it('a busy answer (429 or 503) is not retried and not turned into plain reads: it reaches the timer, with its Retry-After', async () => {
    for (const [status, retryAfter] of [[429, 7], [503, 12]]) {
      const { fake, session } = await sharePoint();
      const track = await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger');
      ds.configure({ sharePoint: fake.settings });
      await ds.readParticipantWatch({ sessionId: session.id, trackId: track.id }); // the write token, once
      fake.reset();
      fake.failNext({ status, retryAfter, when: (entry) => entry.path.endsWith('/$batch') });
      await assert.rejects(ds.readParticipantWatch({ sessionId: session.id, trackId: track.id, clientId: 'c-kroger' }), (error) => {
        assert.equal(error.status, status);
        assert.equal(error.retryAfter, retryAfter * 1000);
        return true;
      });
      assert.equal(fake.count(), 1, `one request, then nothing: ${fake.select().map((entry) => entry.path).join(', ')}`);
    }
  });

  it('a 500 or a refused batch: a failure that is not "this site cannot batch" is thrown after one request, never replayed as three plain reads; a 400 turns batching off for good', async () => {
    const { fake, session } = await sharePoint();
    const track = await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger');
    ds.configure({ sharePoint: fake.settings });
    await ds.readParticipantWatch({ sessionId: session.id, trackId: track.id }); // the write token, once
    fake.reset();
    fake.failNext({ status: 500, when: (entry) => entry.path.endsWith('/$batch') });
    await assert.rejects(ds.readParticipantWatch({ sessionId: session.id, trackId: track.id, clientId: 'c-kroger' }), (error) => error.status === 500);
    assert.equal(fake.count(), 1, 'one request, and then the timer waits');
    // The next look is a batch again: one 500 is not "this site cannot batch".
    fake.reset();
    assert.equal((await ds.readParticipantWatch({ sessionId: session.id, trackId: track.id, clientId: 'c-kroger' })).requests, 1);
    // A 400 is the site saying it cannot: this look is plain reads, and so is every look after it, without asking for a batch again.
    fake.reset();
    fake.failNext({ status: 400, times: 1, when: (entry) => entry.path.endsWith('/$batch') });
    assert.equal((await ds.readParticipantWatch({ sessionId: session.id, trackId: track.id, clientId: 'c-kroger' })).requests, 4);
    fake.reset();
    assert.equal((await ds.readParticipantWatch({ sessionId: session.id, trackId: track.id, clientId: 'c-kroger' })).requests, 4);
    assert.equal(fake.count((entry) => entry.path.endsWith('/$batch')), 0, 'it did not ask for a batch again');
  });

  it('on the local server it is plain reads side by side and returns the same fields', async () => {
    const { session } = await local();
    const track = await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger');
    const watch = await ds.readParticipantWatch({ sessionId: session.id, trackId: track.id, clientId: 'c-kroger' });
    assert.equal(watch.settings.activeSessionId, session.id);
    assert.equal(watch.session.id, session.id);
    assert.equal(watch.track.id, track.id);
    assert.ok(watch.sections.length > 0);
    assert.equal(typeof watch.requests, 'number');
    assert.equal((await ds.readParticipantWatch({})).session, null);
  });
});

describe('the Live display: one request a refresh on SharePoint', () => {
  it('the feed is one batch of the session, its tracks, every answer and its activities', async () => {
    const { fake, session } = await sharePoint();
    await populate(session);
    ds.configure({ sharePoint: fake.settings });
    await ds.getAppSettings();
    fake.reset();
    const feed = await ds.readLiveFeed(session.id, { sectionIds: [...session.sectionIds, 'sec-live'] });
    assert.equal(feed.requests, 1);
    const sent = fake.select().filter((entry) => !entry.path.endsWith('/contextinfo'));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].parts.length, 4);
    assert.deepEqual(sent[0].parts.map((part) => part.list).sort(), ['responses', 'sections', 'sessions', 'tracks']);
    measured.push(['a Live display refresh (session, tracks, every answer, activities)', 1, '1 request']);
  });

  it('opening reads the structure in three requests (session; activities and client; questions and options) and then one feed', async () => {
    const { fake, session } = await sharePoint();
    await populate(session);
    ds.configure({ sharePoint: fake.settings });
    await ds.getAppSettings();
    fake.reset();
    const held = await loadLiveStructure(session.id);
    const structure = fake.select().filter((entry) => !entry.path.endsWith('/contextinfo')).length;
    assert.equal(structure, 3);
    assert.equal(held.client.id, 'c-kroger');
    assert.ok(held.sections.length >= 3 && held.questions.length > 5 && held.options.length > 5);
    fake.reset();
    const read = await readLive(held);
    assert.equal(fake.count(), 1, 'a refresh is one request');
    assert.equal(read.requests, 1);
    measured.push(['opening the Live display: the structure', structure, '3 requests']);
  });

  it('a change to the activities (one switched off, a question added) is picked up from the feed by reading the structure again', async () => {
    const { fake, session } = await sharePoint();
    await populate(session);
    ds.configure({ sharePoint: fake.settings });
    const held = await loadLiveStructure(session.id);
    await ds.updateSection('sec-live', { enabled: false });
    fake.reset();
    const read = await readLive(held);
    assert.equal(fake.count((entry) => !entry.path.endsWith('/contextinfo')), 1 + 3, 'the feed, then the structure once');
    assert.equal(read.requests, 1, 'what the timer scales by is the refresh itself');
    assert.equal(read.structure.sections.find((section) => section.id === 'sec-live').enabled, false);
    // And nothing changed: no structure read.
    fake.reset();
    await readLive(read.structure);
    assert.equal(fake.count(), 1);
  });

  it('the structure is read again after five minutes, to pick up edited words and options', async () => {
    const { fake, session } = await sharePoint();
    await populate(session);
    ds.configure({ sharePoint: fake.settings });
    const held = await loadLiveStructure(session.id, 1_000_000);
    await ds.updateQuestion('q-live-single', { prompt: 'A reworded question' });
    fake.reset();
    const soon = await readLive(held, 1_000_000 + 299_000);
    assert.equal(fake.count(), 1);
    assert.notEqual(soon.results.sections.find((section) => section.id === 'sec-live').questions[0].prompt, 'A reworded question');
    fake.reset();
    const later = await readLive(held, 1_000_000 + 301_000);
    assert.equal(fake.count((entry) => !entry.path.endsWith('/contextinfo')), 1 + 3);
    assert.equal(later.results.sections.find((section) => section.id === 'sec-live').questions[0].prompt, 'A reworded question');
  });

  it('a session that is gone reads as gone, not as a failure; and a busy answer reaches the timer', async () => {
    const { fake, session } = await sharePoint();
    ds.configure({ sharePoint: fake.settings });
    const held = await loadLiveStructure(session.id);
    assert.equal(await loadLiveStructure('no-such-session'), null);
    await ds.deleteSession(session.id);
    assert.deepEqual(await readLive(held), { gone: true, requests: 1 });
    const second = await sharePoint();
    ds.configure({ sharePoint: second.fake.settings });
    const open = await loadLiveStructure(second.session.id);
    second.fake.failNext({ status: 429, retryAfter: 9, when: (entry) => entry.path.endsWith('/$batch') });
    await assert.rejects(readLive(open), (error) => error.status === 429 && error.retryAfter === 9000);
  });

  it('five minutes of refreshes plus the structure reads stay under 6 requests a minute', async () => {
    const { fake, session } = await sharePoint();
    await populate(session);
    ds.configure({ sharePoint: fake.settings });
    await ds.getAppSettings();
    fake.reset();
    let now = 0;
    let held = await loadLiveStructure(session.id, now);
    let refreshes = 0;
    while (now < 300_000) {
      now += 12_000;
      held = (await readLive(held, now)).structure;
      refreshes += 1;
    }
    const total = fake.count((entry) => !entry.path.endsWith('/contextinfo'));
    assert.equal(refreshes, 25);
    assert.ok(total / 5 < 6, `${total} requests in 5 minutes: ${(total / 5).toFixed(1)} a minute`);
    measured.push([`the Live display open for 5 minutes (${refreshes} refreshes and the structure read at the start and at 5 minutes)`, total, `${(total / 5).toFixed(1)} a minute`]);
  });

  it('where the site cannot batch a refresh costs one request a read and says so, so the timer slows to match', async () => {
    const { fake, session } = await sharePoint({ batch: false });
    await populate(session);
    ds.configure({ sharePoint: { ...fake.settings, batch: false } });
    const held = await loadLiveStructure(session.id);
    fake.reset();
    const read = await readLive(held);
    assert.equal(read.requests, 4);
    assert.equal(fake.count(), 4);
    measured.push(['a Live display refresh on a site that cannot batch', 4, '4 requests']);
  });
});

// Phase 10b: every fake also holds the other set of lists (the prefixed ones; or the plain ones, when this suite is run a second time
// with PMS_TEST_LIST_PREFIX and its own lists are the prefixed ones). A request to them is answered, as a second copy's lists would
// answer on a real site, so nothing else in this suite would notice one: this does.
it('no request of this suite reached a list that is not its own', () => {
  assert.deepEqual(STRAYS.map((entry) => `${entry.method} ${entry.title}`), []);
  assert.deepEqual(UNINDEXED.map((entry) => `${entry.list}.${entry.unindexed}`), [], 'and none filtered on a column the schema does not index');
});
