// Phase 4: today's client and per-participant responses, proven against the mocked SharePoint REST
// (scripts/sharepoint-fake.js, which counts requests and injects 409, 412, 429 and 503) and against
// the real local server on a scratch copy of server/data.  Run: npm run test:storage
//
// What this can and cannot show: that the adapter sends the requests it should, in the numbers it
// should, and copes with the answers a list can give. It is not the real tenant. The setup page's
// self-test is how the real lists are checked.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { freePort } from './free-port.js';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as ds from '../migration/src/lib/data/dataService.js';
import { BACKOFF_MS, SaveFailedError, createAnswerStore } from '../migration/src/lib/participant/answer-store.js';
import { createActivityContent } from '../migration/src/lib/participant/activity-content.js';
import { bootParticipant } from '../migration/src/lib/participant/boot.js';
import { nextDelay } from '../migration/src/lib/common/poll-schedule.js';
import {
  MAX_TEXT_LENGTH, MAX_WRONG_TRIES, chooseGraded, firstTryScore, gradedRecord, gradedStateFromRecord, isRecordSettled, retryGraded, startGraded,
} from '../migration/src/lib/participant/pager-logic.js';
import { samplePack } from '../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../migration/src/lib/setup/seed.js';
import { readSessionResults } from '../migration/src/lib/results/session-results.js';
import { PROBE_LENGTH, PROBE_YESNO, schemaSpecs, selfTestProbes } from '../migration/src/lib/setup/setup-checks.js';
import { PHASE_4_COLUMNS, STRAYS, SUITE_PREFIX, TITLE, UNINDEXED, createSharePointFake, plainTitles } from './sharepoint-fake.js';

const ROOT = path.join(import.meta.dirname, '..');
const realFetch = globalThis.fetch;
const DAY = '2026-10-11';
const measured = []; // [what, requests, budget] rows, printed at the end

// ---- Harness -------------------------------------------------------------------------------------

/** A fake SharePoint with both sample clients seeded and `clientId` live. Requests so far are forgotten. */
async function liveSharePoint(clientId = 'c-kroger', options = {}) {
  const fake = createSharePointFake(options);
  fake.install();
  ds.configure({ sharePoint: fake.settings });
  await seedPack(ds, samplePack());
  const { session } = await ds.activateClient(clientId, DAY);
  fake.reset();
  return { fake, session };
}

const memoryStorage = () => {
  const map = new Map();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: (key) => { map.delete(key); } };
};

/** A store whose waits are recorded instead of slept, so a failing save does not slow the suite. */
function testStore({ storage = memoryStorage(), api = ds } = {}) {
  const sleeps = [];
  const store = createAnswerStore({ api, storage, sleep: async (ms) => { sleeps.push(ms); } });
  return { store, storage, sleeps };
}

/**
 * The boot as the page runs it (App.svelte): with the page's holder of the activities' questions (Phase 10j, lib/participant/activity-content.js), which a
 * QR scan has read them beside the claim. Resolves to the boot's result, with that holder as `held`.
 */
async function pageBoot(api, request) {
  const held = createActivityContent({ api });
  return Object.assign(await bootParticipant(api, { ...request, content: held }), { held });
}

/** A visit begun at Welcome ("Click here to begin"): the page makes the id. `options` may name the signed-in account. */
const newVisit = (sessionId, clientId = 'c-kroger', options = undefined) => ds.beginVisit(crypto.randomUUID(), sessionId, clientId, options);
/** A session's guests or its visit log, read the way the admin reads them. */
const listOf = async (list, sessionId) => (await ds.readLists([{ list, where: { sessionId } }]))[0];

const visitOf = (track, restartedAt = null) => ({ trackId: track.id ?? track, sessionId: track.sessionId, clientId: track.clientId ?? null, restartedAt });
const answer = (questionId, value, extra = {}) => ({ questionId, answer: value, firstAnswer: value, attempts: 1, correct: null, ...extra });
const writes = (fake) => fake.select((entry) => entry.list === 'responses' && entry.method !== 'GET');
const shape = (entry) => `${entry.method} ${entry.list ?? entry.path.split('/_api')[1]}`;
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const sorted = (list) => [...list].sort();

/** `count` visitors with a personal QR code each, the session being in client-visit mode: how the Kroger team arrives. */
async function visitorCodes(session, count, clientId = 'c-kroger') {
  await ds.setSessionParticipationMode(session.id, 'client-visit');
  const tokens = [];
  for (let index = 0; index < count; index += 1) {
    const visitor = await ds.createVisitor({ sessionId: session.id, displayName: `Guest ${index + 1}`, enabled: true });
    tokens.push(await ds.provisionQrToken(clientId, session.id, { visitorId: visitor.id }));
  }
  return tokens;
}

/**
 * A page of its own: the data service loaded as a separate module, so that it shares no write
 * token, no list metadata and no unfinished scan with any other "device" in the same test.
 */
let pagesOpened = 0;
async function freshPage(settings) {
  const page = await import(`../migration/src/lib/data/dataService.js?page=${pagesOpened += 1}`);
  page.configure(settings);
  return page;
}

let server;
let dataDir;
let localBase;

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'cec-storage-'));
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
    for (const [what, count, budget] of measured) console.log(`  ${String(count).padStart(4)}  ${budget ? `(budget ${budget})`.padEnd(14) : ''.padEnd(14)} ${what}`);
    // Phase 10b: these are the requests the data layer sends. A page on SharePoint asks for one thing more, before any of them and on
    // every load: its settings file, pms-config.txt, a small static file in its own folder (lib/settings/settings-file.js), which is not a
    // REST request. So a first screen is 8 list requests plus 1 file, and the first device of a session on a QR scan 9 plus 1.
    // scripts/migration-tests/sharepoint.spec.ts counts the file in a browser; on the local server none is asked for.
    console.log('        + 1 request for pms-config.txt before each "boot" above, in a page on SharePoint (none on the local server)');
  }
});

function useLocal() {
  globalThis.fetch = realFetch;
  ds.configure({ baseUrl: localBase });
}

// ---- (b) Request budgets ---------------------------------------------------------------------------

describe('boot: at most 8 requests to the first screen a participant can act on', () => {
  it('a first visit (staff, opening the plain link): AppSettings, then Client + Session + Sections + the session\'s visits; the activities once the screen is up', async () => {
    const { fake } = await liveSharePoint();
    const boot = await pageBoot(ds, { path: '/' });
    assert.equal(boot.experience.status, 'live');
    assert.equal(boot.experience.client.id, 'c-kroger');
    const sent = fake.requests.map(shape);
    assert.deepEqual(sorted(sent.slice(0, 2)), ['GET /web/currentuser', 'GET appsettings']);
    // (Phase 10j: the session's visits, "has this account visited today already?", in the same round as the rest.)
    assert.deepEqual(sorted(sent.slice(2)), ['GET clients', 'GET sections', 'GET sessions', 'GET tracks']);
    assert.ok(fake.count() <= 8);
    measured.push(['boot, first visit (staff): Welcome', fake.count(), 8]);
    // Once the screen is up (App.svelte): every enabled activity's questions and options, in one go, held for the pager.
    fake.reset();
    await boot.held.start(boot.experience.sections);
    assert.deepEqual(fake.requests.map(shape), ['GET questions', 'GET options']);
    const trivia = await boot.held.questionsOf(boot.experience.sections[0], boot.experience.sections);
    assert.equal(trivia.length, 5);
    assert.equal(trivia[0].options.length, 4);
    assert.equal(fake.count(), 2, 'the first activity then opens with no request');
  });

  it('nothing is written and nothing is read twice during boot, or by the read of the activities after it', async () => {
    const { fake } = await liveSharePoint();
    const boot = await pageBoot(ds, { path: '/' });
    await boot.held.start(boot.experience.sections);
    assert.equal(fake.count((entry) => entry.method !== 'GET'), 0);
    assert.equal(new Set(fake.requests.map((entry) => entry.url)).size, fake.count());
  });

  it('a returning visit (?t=) reads its track and its own answers alongside, and lands in its activity within 8', async () => {
    const { fake, session } = await liveSharePoint();
    const track = await newVisit(session.id);
    await ds.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: 'c-kroger', responses: [answer('q-trivia-1', 'o-trivia-1-b', { correct: true })] });
    fake.reset();
    const boot = await pageBoot(ds, { trackId: track.id, path: '/quiz/sec-trivia' });
    assert.equal(boot.track.id, track.id);
    assert.equal(boot.own.responses.length, 1, 'one indexed read restored the saved answer');
    assert.equal(boot.destination, null, 'it stays on the activity it was opened on');
    assert.deepEqual(fake.requests.map(shape), ['GET appsettings', 'GET tracks', 'GET responses', 'GET clients', 'GET sessions', 'GET sections']);
    assert.match(fake.select({ list: 'responses' })[0].query, /TrackId eq '/, 'the answers are read by the indexed TrackId');
    // What the pager then needs to show the question: the activity's questions and options, read (Phase 10j) with every other enabled activity's.
    const questions = await boot.held.questionsOf(boot.experience.sections.find((section) => section.id === 'sec-trivia'), boot.experience.sections);
    assert.equal(questions.length, 5);
    assert.ok(fake.count() <= 8);
    measured.push(['boot, reload inside an activity (?t=): the question is answerable', fake.count(), 8]);
    assert.equal(boot.userDeferred, true, 'a staff visit asks who is signed in after the screen is up, not before');
  });

  it('a returning visit that opens on the hub needs 6', async () => {
    const { fake, session } = await liveSharePoint();
    const track = await newVisit(session.id);
    fake.reset();
    const boot = await pageBoot(ds, { trackId: track.id, path: '/' });
    assert.equal(boot.destination, '/agenda');
    assert.equal(boot.own, null, 'no answers yet: the read says so, and nothing else asks again');
    assert.equal(fake.count(), 6);
    measured.push(['boot, returning visit (?t=): the hub', fake.count(), 8]);
  });

  it('a staff member who already has a visit today is offered it, within 8, and its answers are not read twice', async () => {
    const { fake, session } = await liveSharePoint();
    const earlier = await newVisit(session.id, 'c-kroger', { sharePointUserId: '42' });
    await ds.saveParticipantResponses({ trackId: earlier.id, sessionId: session.id, clientId: 'c-kroger', responses: [answer('q-trivia-1', 'o-trivia-1-a', { correct: false })] });
    fake.reset();
    const boot = await pageBoot(ds, { path: '/' });
    assert.equal(boot.accountTrack.id, earlier.id);
    assert.equal(boot.accountOwn.responses.length, 1);
    assert.equal(fake.count((entry) => ['questions', 'options'].includes(entry.list)), 0, 'and no activity is read before the first screen');
    assert.ok(fake.count() <= 8);
    measured.push(['boot, staff with an earlier visit today', fake.count(), 8]);
  });

  it('when no client is live it stops after AppSettings', async () => {
    const fake = createSharePointFake();
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    const boot = await pageBoot(ds, { path: '/agenda' });
    assert.equal(boot.experience.status, 'not-live');
    assert.equal(boot.experience.reason, 'no-session');
    assert.equal(boot.destination, '/welcome');
    assert.deepEqual(fake.requests.map(shape).sort(), ['GET /web/currentuser', 'GET appsettings']);
    measured.push(['boot, nothing live', fake.count(), 8]);
  });

  it('an archived client is not shown: the page says the experience is not live', async () => {
    const { fake } = await liveSharePoint('c-dominos');
    await ds.updateClient('c-dominos', { status: 'archived' });
    fake.reset();
    const boot = await pageBoot(ds, { path: '/' });
    assert.equal(boot.experience.status, 'archived');
    assert.equal(boot.experience.client, null, 'nothing about the archived client reaches the page');
    assert.deepEqual([boot.accountChecked, boot.accountTrack], [false, null], 'and nothing the boot read of its session is kept');
    await assert.rejects(ds.activateClient('c-dominos', DAY), { code: 'client-archived' });
  });

  it('a session that ended is not live either, and a visit to it is told so', async () => {
    const { session } = await liveSharePoint();
    const track = await newVisit(session.id);
    await ds.endSession(session.id);
    const boot = await pageBoot(ds, { trackId: track.id, path: '/agenda' });
    assert.equal(boot.experience.reason, 'session-ended');
    assert.equal(boot.code, 'session-ended');
    assert.equal(boot.track, null);
    assert.equal(boot.keepTrackInUrl, true);
  });

  it('a visit from another day is turned away to Welcome', async () => {
    const { session } = await liveSharePoint();
    const track = await newVisit(session.id);
    await ds.activateClient('c-dominos', DAY);
    const boot = await pageBoot(ds, { trackId: track.id, path: '/agenda' });
    assert.equal(boot.code, 'session-not-active');
    assert.equal(boot.track, null);
    assert.equal(boot.experience.client.id, 'c-dominos', "and the page is now today's client");
  });
});

describe('a first QR scan: 8 requests to the first screen, and 9 for the device that starts the session', () => {
  /** A fresh page scanning `token`: the boot result and the requests it took, in order. */
  async function scan(fake, token, settings = {}) {
    ds.configure({ sharePoint: { ...fake.settings, ...settings } }); // a fresh page: no write token, no list metadata
    fake.reset();
    const boot = await pageBoot(ds, { qrToken: token.id, path: '/' });
    return { boot, sent: fake.requests.map(shape) };
  }
  const batched = (fake) => fake.requests.find((entry) => entry.parts).parts.map(shape);
  /**
   * A scan's requests by round, from what each one waits for rather than from where it falls in the list (Phase 17): round 1 is everything sent
   * before the $batch (which needs the write token round 1 asks for), round 2 the $batch, round 4 the writes that need the new track (the claim
   * and, for a session's first device, the session moved on), round 3 the rest (the track and the activities' content, which wait for the batch).
   * Requests of one round go out at the same moment, so their order within it is not held; that every round-4 write follows the track is.
   * @param {string[]} sent
   */
  function roundsOf(sent) {
    const batch = sent.indexOf('POST /$batch');
    const later = sent.slice(batch + 1);
    const needsTrack = (request) => request.startsWith('MERGE ');
    const track = sent.indexOf('POST tracks');
    assert.ok(sent.every((request, at) => !needsTrack(request) || at > track), `every write that needs the track follows it: ${sent.join(', ')}`);
    return [sorted(sent.slice(0, batch)), sent.slice(batch, batch + 1), sorted(later.filter((request) => !needsTrack(request))), sorted(later.filter(needsTrack))];
  }

  it("a visitor's code: the code beside AppSettings, one batch of reads, the track beside the first activity, then the claim", async () => {
    const { fake, session } = await liveSharePoint();
    const [first, second] = await visitorCodes(session, 2);

    // The session's first device also moves the session to in-progress.
    const opening = await scan(fake, first);
    assert.equal(opening.boot.claimed, true);
    const [one, two, three, four] = roundsOf(opening.sent);
    assert.deepEqual(one, ['GET appsettings', 'GET qrtokens', 'POST /contextinfo']);
    assert.deepEqual(two, ['POST /$batch']);
    assert.deepEqual(three, ['GET options', 'GET questions', 'POST tracks']);
    assert.deepEqual(four, ['MERGE qrtokens', 'MERGE sessions']);
    assert.equal(opening.sent.length, 9);
    assert.equal(fake.item('sessions', session.id).Status, 'in-progress');
    assert.equal(opening.boot.experience.session.status, 'in-progress', 'and the page was told');
    measured.push(["boot, first QR scan, the session's first device (it also moves the session to in-progress)", opening.sent.length, 12]);

    // Every device after it.
    const { boot, sent } = await scan(fake, second);
    const rounds = roundsOf(sent);
    assert.deepEqual(rounds[0], ['GET appsettings', 'GET qrtokens', 'POST /contextinfo'], 'round 1: the code, AppSettings and the write token, side by side');
    assert.deepEqual(rounds[1], ['POST /$batch'], 'round 2: one request');
    // (The first 'GET Tracks' is Phase 9a's look for a track an earlier, cut-off try of this code left: one more read in the same request.)
    assert.deepEqual(batched(fake), ['GET sessions', 'GET clients', 'GET sections', 'GET tracks', 'GET visitorroster', 'GET tracks']);
    assert.match(fake.requests[3].parts[3].query, /QrTokenId eq/, 'the look for earlier tries of this code');
    assert.match(fake.requests[3].parts[5].url, /ListItemEntityTypeFullName/, 'the type a new Tracks item must name, asked once');
    assert.deepEqual(rounds[2], ['GET options', 'GET questions', 'POST tracks'], 'round 3: the track, beside the first activity');
    assert.deepEqual(rounds[3], ['MERGE qrtokens'], 'round 4: the claim');
    assert.equal(sent.length, 8);
    measured.push(['boot, first QR scan (a visitor code): Welcome, with the activities read beside the track', sent.length, 8]);

    // What the page holds afterwards is what the 21-request path gave it.
    assert.equal(boot.experience.status, 'live');
    assert.equal(boot.experience.client.id, 'c-kroger');
    assert.deepEqual(boot.experience.sections.map((section) => section.id), ['sec-trivia', 'sec-guess-the-brand']);
    // (Phase 10j: every enabled activity's questions and options, read beside the track and held; each opens with no request.)
    const before = fake.count();
    const trivia = await boot.held.questionsOf(boot.experience.sections[0], boot.experience.sections);
    assert.equal(trivia.length, 5);
    assert.equal(trivia[0].options.length, 4);
    assert.equal((await boot.held.questionsOf(boot.experience.sections[1], boot.experience.sections)).length, 1);
    assert.equal(fake.count(), before);
    assert.equal(boot.user, null, 'a named visitor is never asked who is signed in');
    assert.deepEqual([boot.track.participantName, boot.track.joinedVia, boot.track.qrTokenId, boot.track.sharePointUserId, boot.track.sessionId], ['Guest 2', 'qr', second.id, null, session.id]);
    assert.equal(boot.own, null);
    assert.equal(boot.destination, '/welcome');

    // And the site: the code is used, by this track, and there is one track per device.
    const stored = fake.item('qrtokens', second.id);
    assert.deepEqual([stored.Used, stored.ClientTrackId, typeof stored.UsedAt, stored.ExpiredAt ?? null], [true, boot.track.id, 'string', null]);
    assert.equal(fake.lists.get('tracks').length, 2);
    const claim = fake.select({ method: 'MERGE', list: 'qrtokens' })[0];
    assert.match(claim.ifMatch, /^"\d+"$/, 'the claim carries the version the code was read at: that is what keeps it single use');
    const reads = fake.requests.flatMap((entry) => entry.parts ?? [entry]).filter((entry) => entry.method === 'GET').map((entry) => entry.url);
    assert.equal(reads.length, 10, 'nine, and the look for earlier tries of the code (Phase 9a), which rides in the batch');
    assert.equal(new Set(reads).size, 10, 'nothing is read twice');
    assert.equal(fake.count((entry) => Boolean(entry.faulted)), 0);
  });

  it('the rounds are read from what each request waits for: a claim landing between the content reads is still round 4; a claim before its track fails', () => {
    // As the page could send them on a busy machine: the track is answered before the second content read goes out.
    const interleaved = ['GET qrtokens', 'POST /contextinfo', 'GET appsettings', 'POST /$batch', 'GET questions', 'POST tracks', 'MERGE qrtokens', 'GET options'];
    assert.deepEqual(roundsOf(interleaved), [['GET appsettings', 'GET qrtokens', 'POST /contextinfo'], ['POST /$batch'], ['GET options', 'GET questions', 'POST tracks'], ['MERGE qrtokens']]);
    assert.notDeepEqual(sorted(interleaved.slice(4, 7)), ['GET options', 'GET questions', 'POST tracks'], 'which the slices by position (until Phase 17) would have refused');
    assert.throws(() => roundsOf(['GET qrtokens', 'GET appsettings', 'POST /contextinfo', 'POST /$batch', 'MERGE qrtokens', 'POST tracks', 'GET questions', 'GET options']), /follows it/);
  });

  it('a staff code costs the same: the signed-in user rides in the batch in place of the visitor', async () => {
    const { fake, session } = await liveSharePoint();
    const tokens = [await ds.provisionQrToken('c-kroger', session.id), await ds.provisionQrToken('c-kroger', session.id)];
    assert.equal((await scan(fake, tokens[0])).sent.length, 9);
    const { boot, sent } = await scan(fake, tokens[1]);
    assert.equal(sent.length, 8);
    assert.deepEqual(batched(fake), ['GET sessions', 'GET clients', 'GET sections', 'GET tracks', 'GET /web/currentuser', 'GET tracks']);
    assert.deepEqual(boot.user, { id: '42', displayName: 'Casey Example' });
    assert.deepEqual([boot.track.sharePointUserId, boot.track.visitorId, boot.track.participantName], ['42', null, null]);
    measured.push(['boot, first QR scan (a staff code)', sent.length, 8]);
  });

  it('a code that was used already costs 7, writes nothing, and shows today\'s experience with the reason', async () => {
    const { fake, session } = await liveSharePoint();
    const [token] = await visitorCodes(session, 1);
    await scan(fake, token);
    const { boot, sent } = await scan(fake, token);
    assert.deepEqual([boot.claimed, boot.code, boot.track], [false, 'token-used', null]);
    assert.match(boot.notice, /already been used/);
    assert.equal(boot.experience.status, 'live');
    assert.deepEqual(sorted(sent), ['GET /web/currentuser', 'GET appsettings', 'GET clients', 'GET qrtokens', 'GET sections', 'GET sessions', 'POST /contextinfo']);
    assert.equal(fake.count((entry) => entry.method !== 'GET' && !entry.path.endsWith('/contextinfo')), 0);
    assert.equal(fake.lists.get('tracks').length, 1);
    measured.push(['boot, a QR code that was already used', sent.length, null]);
  });

  it('where $batch is refused the scan still works, read by read, and the page does not ask for a batch again', async () => {
    const { fake, session } = await liveSharePoint();
    const [first, second, third, fourth] = await visitorCodes(session, 4);
    await scan(fake, first);
    fake.failNext({ status: 400, times: 99, message: 'Invalid batch request.', when: (entry) => entry.path.endsWith('/$batch') });
    const { boot, sent } = await scan(fake, second);
    assert.equal(boot.claimed, true);
    assert.equal(boot.track.participantName, 'Guest 2');
    assert.deepEqual(sorted(sent.slice(4, 10)), ['GET clients', 'GET sections', 'GET sessions', 'GET tracks', 'GET tracks', 'GET visitorroster'], 'the same six reads, one by one');
    assert.equal(sent.length, 14, '13, and the one batch that was refused (12 and 13 before Phase 9a added the look for earlier tries)');
    measured.push(['boot, first QR scan on a site that refuses $batch (each page load finds out once)', sent.length, null]);

    // The same page (nothing reset) scanning again: it remembers for as long as it is open.
    fake.reset();
    const again = await pageBoot(ds, { qrToken: third.id, path: '/' });
    assert.equal(again.claimed, true);
    assert.equal(fake.count((entry) => entry.path.endsWith('/$batch')), 0);

    // Told in its settings, a page never asks: 13, which is the floor without a batch.
    const told = await scan(fake, fourth, { batch: false });
    assert.equal(told.boot.claimed, true);
    assert.equal(told.sent.length, 13);
    assert.equal(told.sent.includes('POST /$batch'), false);
    measured.push(['boot, first QR scan with batch: false in the page settings', told.sent.length, null]);
  });

  it('one read failing inside the batch is asked for again by itself; a throttled batch waits as long as it is told', async () => {
    const { fake, session } = await liveSharePoint();
    const [first, second, third] = await visitorCodes(session, 3);
    await scan(fake, first);
    fake.failNext({ status: 503, when: (entry) => entry.batched === true && entry.list === 'sections' });
    const partial = await scan(fake, second);
    assert.equal(partial.boot.claimed, true);
    assert.equal(partial.sent.length, 9);
    assert.equal(partial.sent[4], 'GET sections');
    assert.equal(partial.boot.experience.sections.length, 2);

    fake.failNext({ status: 429, retryAfter: 1, when: (entry) => entry.path.endsWith('/$batch') });
    const throttled = await scan(fake, third);
    assert.equal(throttled.boot.claimed, true);
    const at = fake.requests.findIndex((entry) => entry.path.endsWith('/$batch'));
    assert.ok(fake.requests[at + 1].at - fake.requests[at].at >= 1000, 'Retry-After: 1 was honoured before the reads were sent one by one');
    // Being throttled is not being unsupported: the page asks for a batch the next time.
    const [fourth] = await visitorCodes(session, 1);
    fake.reset();
    await pageBoot(ds, { qrToken: fourth.id, path: '/' });
    assert.equal(fake.count((entry) => entry.path.endsWith('/$batch')), 1);
  });

  it('the mock is as strict about a batch as SharePoint: token, boundary, encoded address, and JSON only when asked', async () => {
    const fake = createSharePointFake();
    await fake.add('clients', { AppId: 'c one', Name: 'One' });
    const send = (body, headers = {}) => fake.fetch(`${fake.siteUrl}/_api/$batch`, {
      method: 'POST', headers: { 'Content-Type': 'multipart/mixed; boundary=b1', 'X-RequestDigest': 'digest-token', ...headers }, body,
    });
    const part = (line, accept = 'Accept: application/json;odata=verbose') => ['--b1', 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', '', line, accept, ''].join('\r\n');
    const read = (address) => `GET ${address} HTTP/1.1`;
    const list = `${fake.siteUrl}/_api/web/lists/getbytitle('${fake.titleOf('clients')}')/items`;
    // (Every item read names its columns, as the strict mock insists since Phase 10h.)
    const encoded = `${list}?$filter=AppId%20eq%20%27c%20one%27&$select=Id,AppId,Name`;

    assert.equal((await send(`${part(read(encoded))}\r\n--b1--\r\n`, { 'X-RequestDigest': '' })).status, 403, 'no write token');
    assert.equal((await send(`${part(read(encoded))}\r\n--b1--\r\n`, { 'Content-Type': 'application/json' })).status, 400, 'not multipart');
    const reply = await send([part(read(encoded)), part(read(`${list}?$filter=AppId eq 'c one'&$select=Id,AppId,Name`)), part(read(encoded), 'Accept: */*'), part(`POST ${list} HTTP/1.1`), '--b1--', ''].join('\r\n'));
    assert.equal(reply.status, 200);
    const mark = /boundary=(.+)$/.exec(reply.headers.get('Content-Type'))[1];
    const answers = (await reply.text()).split(`--${mark}`).slice(1, -1);
    assert.equal(answers.length, 4);
    assert.match(answers[0], /HTTP\/1\.1 200 OK[\s\S]*"AppId":"c one"/);
    assert.match(answers[1], /HTTP\/1\.1 400 /, 'an address with spaces in it is not a request line');
    assert.match(answers[2], /application\/atom\+xml[\s\S]*<feed/, 'without Accept: application/json a part is answered in Atom XML');
    assert.match(answers[3], /HTTP\/1\.1 400 [\s\S]*change set/, 'a write must be in a change set');
    assert.equal(fake.count(), 3, 'each batch is one request, whatever it carries');
  });
});

describe('saving: one cheap request per answer', () => {
  it('the first answer creates the item; every later answer is exactly one write, with no read and no version check', async () => {
    const { fake, session } = await liveSharePoint();
    const track = await newVisit(session.id);
    const { store } = testStore();
    const visit = visitOf(track);
    await store.restore(visit, null); // boot read it: there is nothing saved yet
    fake.reset();

    store.record(visit, 'sec-trivia', answer('q-trivia-1', 'o-trivia-1-b', { correct: true }));
    await store.flush(visit, 'sec-trivia');
    const first = fake.requests.map(shape);
    assert.deepEqual(first, ['GET responses', 'POST responses'], 'the list is asked its item type once, then the item is created');
    assert.match(fake.requests[0].url, /ListItemEntityTypeFullName/);
    measured.push(['first answer of a visit (item type + create)', fake.count(), null]);

    const per = [];
    for (let index = 2; index <= 15; index += 1) {
      fake.reset();
      store.record(visit, 'sec-trivia', answer(`q-extra-${index}`, `option-${index}`));
      await store.flush(visit, 'sec-trivia');
      per.push(fake.count());
      assert.deepEqual(fake.requests.map(shape), ['MERGE responses']);
      assert.equal(fake.requests[0].ifMatch, '*', 'a blind overwrite: no version to collide on');
    }
    assert.deepEqual(per, Array(14).fill(1));
    measured.push(['each answer after the first', 1, 1]);
    const stored = JSON.parse(fake.item('responses', track.id).ResponsesJson);
    assert.equal(stored.length, 15);
    assert.deepEqual(Object.keys(stored[0]), ['questionId', 'answer', 'firstAnswer', 'attempts', 'correct', 'answeredAt']);
    const item = fake.item('responses', track.id);
    assert.deepEqual([item.AppId, item.TrackId, item.SessionId, item.ClientId], [track.id, track.id, session.id, 'c-kroger']);
  });

  it('recording never waits for the network, and answers given while a save is out ride on the next one', async () => {
    const { fake, session } = await liveSharePoint();
    const track = await newVisit(session.id);
    const { store } = testStore();
    const visit = visitOf(track);
    await store.restore(visit, null);
    fake.reset();
    const started = performance.now();
    store.record(visit, 'sec-trivia', answer('q-1', 'o-1'));
    await settle(); // the first answer's request is out now
    for (let index = 2; index <= 6; index += 1) store.record(visit, 'sec-trivia', answer(`q-${index}`, `o-${index}`));
    assert.ok(performance.now() - started < 50, 'six answers recorded without waiting for a reply');
    assert.equal(writes(fake).length, 1, 'one request is out, and only one');
    await store.flush(visit, 'sec-trivia');
    assert.equal(writes(fake).length, 2, 'six answers, two writes: the first, and one carrying the other five');
    assert.equal(JSON.parse(fake.item('responses', track.id).ResponsesJson).length, 6);
    // And the store keeps working afterwards: a flush with nothing to save sends nothing and breaks nothing.
    await store.flush(visit, 'sec-trivia');
    store.record(visit, 'sec-trivia', answer('q-7', 'o-7'));
    await store.flush(visit, 'sec-trivia');
    assert.equal(writes(fake).length, 3);
    assert.equal(JSON.parse(fake.item('responses', track.id).ResponsesJson).length, 7);
  });

  it('10 devices on one account answering 15 questions each stay under 20% of 3,000 requests per 5 minutes', async () => {
    const { fake, session } = await liveSharePoint();
    // Ten visitors with a personal QR code each, on firm iPads that share one signed-in account.
    const tokens = await visitorCodes(session, 10);
    fake.reset();

    /**
     * One device, start to finish, making the calls the screens make. Each device is its own
     * browser, so it starts with nothing remembered: no write token and no list metadata.
     */
    const idleCounts = [];
    async function device(token) {
      ds.configure({ sharePoint: fake.settings }); // a fresh page: every cache is empty
      const boot = await pageBoot(ds, { qrToken: token.id, path: '/' });
      assert.equal(boot.claimed, true);
      const { store } = testStore();
      const visit = visitOf(boot.track);
      await store.restore(visit, boot.own);
      await ds.recordParticipantVisit({ visitKey: `visit-${token.id}`, sessionId: session.id, clientId: 'c-kroger', page: 'participant', entryMode: 'client-visit', visitorId: boot.track.visitorId, visitorName: boot.track.participantName, trackId: boot.track.id, visitedAt: new Date().toISOString() });
      let answered = 0;
      // The hub, then each activity in turn until 15 questions are answered (the sample Kroger has
      // 6, so the rest are extra answers to one activity: the count is what matters here). Each activity opens from what the page holds
      // (Phase 10j: the scan read every enabled activity's questions beside the track).
      const liveSession = boot.experience.session;
      const sections = (await ds.getClientActivities('c-kroger', liveSession)).filter((section) => section.enabled);
      for (const section of sections) {
        const questions = await boot.held.questionsOf(section, sections);
        for (const question of questions) {
          if (answered === 15) break;
          const wrongFirst = answered % 5 === 0 && question.options.some((option) => option.correct === false);
          if (wrongFirst) {
            // A wrong first pick is saved at once, then the Retry settles it: two writes for this question.
            const miss = question.options.find((option) => option.correct === false).id;
            store.record(visit, section.id, { questionId: question.id, answer: miss, firstAnswer: miss, attempts: 1, correct: false });
            await settle();
          }
          const pick = question.options.find((option) => option.correct === true)?.id ?? question.options[0]?.id ?? 'Typed feedback';
          store.record(visit, section.id, { questionId: question.id, answer: pick, firstAnswer: pick, attempts: wrongFirst ? 2 : 1, correct: question.options.some((option) => option.correct === true) ? !wrongFirst : null });
          answered += 1;
          await settle();
        }
        await store.flush(visit, section.id); // completion waits for pending saves
        await ds.getClientActivities('c-kroger', liveSession); // back on the hub
      }
      // A third activity for the rest of the 15, opened like the others (held: no read).
      await boot.held.questionsOf(sections[0], sections);
      for (let extra = answered; extra < 15; extra += 1) {
        store.record(visit, 'sec-more', answer(`q-extra-${extra}`, 'option'));
        await settle();
      }
      await store.flush(visit, 'sec-more');
      await ds.getClientActivities('c-kroger', liveSession); // back on the hub
      // The finale checks progress against the server; the score comes from the answers already held.
      await ds.getClientActivities('c-kroger', liveSession);
      const stored = JSON.parse(fake.item('responses', boot.track.id).ResponsesJson).length;

      // Then the device sits on the hub or the finale for five minutes, and the page looks at what the facilitator did on its timer
      // (App.svelte's checkServer: ONE read of AppSettings, the session, its own track and, on the hub, the activities), every
      // 20 seconds give or take 20%, drawn from the same rule the page uses.
      const idleStart = fake.count();
      let at = nextDelay({ mode: 'idle' });
      let looks = 0;
      while (at <= 300_000) {
        const before = fake.count();
        const watch = await ds.readParticipantWatch({ sessionId: session.id, trackId: boot.track.id, clientId: 'c-kroger' });
        assert.equal(fake.count() - before, 1, 'a look is ONE request');
        assert.equal(watch.requests, 1);
        assert.equal(watch.session.id, session.id);
        assert.equal(watch.track.id, boot.track.id);
        assert.ok(watch.sections.length > 0, 'the hub gets its activities in the same request');
        looks += 1;
        at += nextDelay({ mode: 'idle' });
      }
      idleCounts.push({ requests: fake.count() - idleStart, looks });
      return stored;
    }

    // One after another, so each device's own share can be told apart; the fake counts them all
    // against the one account. (Saving at the same moment is the races suite's job.)
    const perDevice = [];
    const counts = [];
    for (const token of tokens) {
      const before = fake.count();
      counts.push(await device(token));
      perDevice.push(fake.count() - before);
    }
    assert.deepEqual(counts, Array(10).fill(15), 'every device has its 15 answers stored');
    assert.equal(fake.lists.get('responses').length, 10, 'one item per participant');
    const total = fake.count();
    const saves = writes(fake).length;
    const claim = fake.select((entry) => ['qrtokens', 'tracks'].includes(entry.list) || entry.path.endsWith('/$batch')).length;
    const idle = idleCounts.reduce((sum, entry) => sum + entry.requests, 0);
    assert.equal(idleCounts.length, 10);
    assert.ok(idle < 0.1 * 3000, `${idle} requests from ten devices sitting idle for five minutes: under 10% of 3,000 (300)`);
    assert.ok(idleCounts.every((entry) => entry.requests / 5 <= 4), 'and each device made at most 4 requests a minute');
    // The visit itself (QR scan to finale) is what this test has always counted; the idle minutes are reported on their own and added to the whole.
    const visit = total - idle;
    assert.ok(visit < 0.2 * 3000, `${visit} requests in all (${perDevice.join(', ')}); the budget is under 600`);
    assert.ok(total < 0.2 * 3000, `${total} requests with the idle five minutes added: still under 20% of 3,000`);
    assert.equal(fake.count((entry) => entry.faulted), 0);
    assert.equal(fake.select((entry) => entry.list === 'responses' && entry.ifMatch && entry.ifMatch !== '*').length, 0, 'no save carried a version to collide on');
    measured.push(['10 devices x 15 questions each, QR scan to finale, every device a fresh page (no idle polling)', visit, '< 600']);
    measured.push(['10 devices then idle on the hub for 5 minutes, one look every ~20 s (' + idleCounts.map((entry) => entry.looks).join(', ') + ' looks)', idle, '< 300']);
    measured.push(['  the visit and the idle five minutes together', total, '< 600']);
    measured.push(['  the first device (it also moves the session to in-progress)', perDevice[0], null]);
    measured.push(['  each later device', perDevice[9], null]);
    measured.push(['  answer saves in all (10 creates + overwrites; 3 questions per device were missed first and saved twice)', saves, null]);
    measured.push(['  requests that check the ten devices in (the code, one batch of reads, the track, the claim)', claim, null]);
  });
});

// ---- (c) Races and throttling ----------------------------------------------------------------------

describe('races', () => {
  it('two devices saving at the same moment never get a 412', async () => {
    const { fake, session } = await liveSharePoint();
    const [a, b] = [await newVisit(session.id), await newVisit(session.id)];
    const [first, second] = [testStore(), testStore()];
    await first.store.restore(visitOf(a), null);
    await second.store.restore(visitOf(b), null);
    fake.reset();
    const run = async ({ store }, track) => {
      for (let index = 1; index <= 10; index += 1) {
        store.record(visitOf(track), 'sec-trivia', answer(`q-${index}`, `o-${index}`));
        await settle();
      }
      await store.flush(visitOf(track), 'sec-trivia');
    };
    await Promise.all([run(first, a), run(second, b)]);
    const statuses = fake.requests.filter((entry) => entry.faulted);
    assert.equal(statuses.length, 0);
    assert.equal(fake.lists.get('responses').length, 2);
    for (const track of [a, b]) assert.equal(JSON.parse(fake.item('responses', track.id).ResponsesJson).length, 10);
    assert.equal(first.sleeps.length + second.sleeps.length, 0, 'nothing had to be retried');
  });

  it('a double create leaves exactly one item, holding both sets of answers', async () => {
    const { fake, session } = await liveSharePoint();
    const track = await newVisit(session.id);
    const fields = { trackId: track.id, sessionId: session.id, clientId: 'c-kroger' };
    fake.reset();
    // The same visit open on two devices, neither of which has seen the item yet.
    const [left, right] = await Promise.all([
      ds.saveParticipantResponses({ ...fields, responses: [{ ...answer('q-1', 'a'), answeredAt: '2026-10-11T10:00:00.000Z' }] }),
      ds.saveParticipantResponses({ ...fields, responses: [{ ...answer('q-2', 'b'), answeredAt: '2026-10-11T10:00:01.000Z' }] }),
    ]);
    assert.equal(fake.lists.get('responses').length, 1);
    assert.equal(fake.count({ method: 'POST', list: 'responses' }), 2, 'both tried to create');
    assert.deepEqual(JSON.parse(fake.item('responses', track.id).ResponsesJson).map((record) => record.questionId).sort(), ['q-1', 'q-2']);
    assert.deepEqual(left.ref, right.ref, 'and both now hold the same item');
  });

  it('a create whose reply was lost is not repeated as a second item', async () => {
    const { fake, session } = await liveSharePoint();
    const track = await newVisit(session.id);
    const { store } = testStore();
    const visit = visitOf(track);
    await store.restore(visit, null);
    // The item gets created, but as far as the device knows the request failed.
    fake.hooks.beforeCreate = (list, fields) => { if (list === 'responses') fake.add(list, { ...fields }); };
    store.record(visit, 'sec-trivia', answer('q-1', 'a'));
    await store.flush(visit, 'sec-trivia');
    assert.equal(fake.lists.get('responses').length, 1);
    store.record(visit, 'sec-trivia', answer('q-2', 'b'));
    await store.flush(visit, 'sec-trivia');
    assert.deepEqual(JSON.parse(fake.item('responses', track.id).ResponsesJson).map((record) => record.questionId), ['q-1', 'q-2']);
  });

  it('the adapter waits as long as Retry-After asks before it tries again, on 429 and on 503', async () => {
    const { fake, session } = await liveSharePoint();
    const track = await newVisit(session.id);
    const saved = await ds.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: 'c-kroger', responses: [answer('q-1', 'a')] });
    for (const status of [429, 503]) {
      fake.reset();
      fake.failNext({ status, retryAfter: 1, when: (entry) => entry.method === 'MERGE' && entry.list === 'responses' });
      await ds.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: 'c-kroger', responses: [answer('q-1', 'a'), answer(`q-${status}`, 'b')] }, saved.ref);
      const tries = fake.select({ method: 'MERGE', list: 'responses' });
      assert.equal(tries.length, 2);
      assert.equal(tries[0].faulted, status);
      assert.ok(tries[1].at - tries[0].at >= 1000, `waited ${tries[1].at - tries[0].at} ms after a ${status} with Retry-After: 1`);
    }
    assert.equal(JSON.parse(fake.item('responses', track.id).ResponsesJson).length, 2);
  });

  it('when the adapter gives up, the store waits at least the Retry-After before its own next try', async () => {
    let calls = 0;
    const api = {
      mergeAnswerRecords: ds.mergeAnswerRecords,
      isUnreachable: ds.isUnreachable,
      getParticipantResponses: async () => null,
      saveParticipantResponses: async (fields) => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error('Too many requests'), { status: 429, retryAfter: 7000 });
        if (calls === 2) throw Object.assign(new Error('Server too busy'), { status: 503 });
        return { ref: { id: 1 }, responses: fields.responses };
      },
    };
    const { store, sleeps } = testStore({ api });
    const visit = { trackId: 't', sessionId: 's', clientId: 'c', restartedAt: null };
    store.record(visit, 'sec', answer('q-1', 'a'));
    await store.flush(visit, 'sec');
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [7000, BACKOFF_MS[1]], 'Retry-After: 7 s wins over the 0.4 s backoff; with none, the backoff applies');
  });

  it('a save that fails every try throws SaveFailedError, keeps the answers, and a later flush saves them', async () => {
    const { fake, session } = await liveSharePoint();
    const track = await newVisit(session.id);
    const { store, storage } = testStore();
    const visit = visitOf(track);
    await store.restore(visit, null);
    fake.failNext({ status: 500, times: 99, when: (entry) => entry.list === 'responses' && entry.method !== 'GET' });
    store.record(visit, 'sec-trivia', answer('q-1', 'a'));
    await assert.rejects(store.flush(visit, 'sec-trivia'), SaveFailedError);
    assert.equal(store.pending(visit, 'sec-trivia').length, 1, 'still held');
    assert.equal(JSON.parse(storage.map.get(`cec-answers:${track.id}`)).sections['sec-trivia'].length, 1, 'and still in storage for a reload');
    assert.equal(fake.lists.get('responses').length, 0);
    fake.clearFaults();
    const saved = await store.flush(visit, 'sec-trivia');
    assert.equal(saved.length, 1);
    assert.equal(storage.map.has(`cec-answers:${track.id}`), false, 'saved answers are no longer held in storage');
    assert.equal(JSON.parse(fake.item('responses', track.id).ResponsesJson).length, 1);
  });

  it('answers given during an outage do not each start a round of failing requests', async () => {
    const { fake, session } = await liveSharePoint();
    const track = await newVisit(session.id);
    const { store } = testStore();
    const visit = visitOf(track);
    await store.restore(visit, null);
    fake.reset();
    fake.failNext({ status: 500, times: 99, when: (entry) => entry.list === 'responses' && entry.method === 'POST' });
    for (let index = 1; index <= 8; index += 1) {
      store.record(visit, 'sec-trivia', answer(`q-${index}`, 'a'));
      await new Promise((resolve) => { setTimeout(resolve, 5); });
    }
    assert.equal(fake.count({ method: 'POST', list: 'responses' }), 3, 'one round of three tries, then quiet until the next flush');
  });
});

describe('five devices scanning the same code at the same moment', () => {
  const claimWrite = (entry) => entry.method === 'MERGE' && entry.list === 'qrtokens';
  const USED = 'This QR code has already been used. Ask your facilitator for a new code.';

  /** Five pages of their own, each booting with the same code, all at once. */
  async function race(openPage, tokenId) {
    const pages = await Promise.all(Array.from({ length: 5 }, openPage));
    return Promise.all(pages.map((page) => pageBoot(page, { qrToken: tokenId, path: '/' })));
  }

  /** Exactly one device has the visit; the other four are on Welcome with the existing "already used" words, and have left nothing behind. */
  function assertSingleUse(boots, tracks, tokenTrackId) {
    const winners = boots.filter((boot) => boot.claimed);
    assert.equal(winners.length, 1, `${winners.length} devices were let in`);
    const losers = boots.filter((boot) => !boot.claimed);
    assert.deepEqual(losers.map((boot) => [boot.code, boot.notice, boot.track, boot.destination]), Array(4).fill(['token-used', USED, null, '/welcome']));
    assert.deepEqual(losers.map((boot) => boot.experience.status), Array(4).fill('live'), 'a device that lost still shows today\'s Welcome');
    assert.deepEqual(tracks, [winners[0].track.id], 'one track exists for the code: the winner\'s');
    assert.equal(tokenTrackId, winners[0].track.id);
    return winners[0];
  }

  const FAULTS = {
    'nothing going wrong': () => {},
    'a 412 on the first claim, although the code is still free': (fake) => fake.failNext({ status: 412, when: claimWrite }),
    '429 on the code list, reads and writes': (fake) => fake.failNext({ status: 429, retryAfter: 0, times: 3, when: (entry) => entry.list === 'qrtokens' }),
    '503 on the claim and on the new track': (fake) => {
      fake.failNext({ status: 503, retryAfter: 0, times: 2, when: claimWrite });
      fake.failNext({ status: 503, retryAfter: 0, times: 2, when: (entry) => entry.method === 'POST' && entry.list === 'tracks' });
    },
    '503 on a whole batch, 429 on a read inside one, 412 and 503 while the losers clean up': (fake) => {
      fake.failNext({ status: 503, retryAfter: 0, when: (entry) => entry.path.endsWith('/$batch') });
      fake.failNext({ status: 429, retryAfter: 0, when: (entry) => entry.batched === true && entry.list === 'sessions' });
      fake.failNext({ status: 412, when: claimWrite });
      fake.failNext({ status: 503, retryAfter: 0, times: 2, when: (entry) => entry.method === 'DELETE' && entry.list === 'tracks' });
    },
  };

  for (const [name, inject] of Object.entries(FAULTS)) {
    it(`SharePoint, ${name}: exactly one gets in, four are told "already used", and one track remains`, async () => {
      const { fake, session } = await liveSharePoint();
      const [token] = await visitorCodes(session, 1);
      fake.reset();
      inject(fake);
      const boots = await race(() => freshPage({ sharePoint: fake.settings }), token.id);
      const stored = fake.item('qrtokens', token.id);
      const winner = assertSingleUse(boots, fake.lists.get('tracks').filter((row) => row.QrTokenId === token.id).map((row) => row.AppId), stored.ClientTrackId);
      assert.equal(stored.Used, true);
      assert.equal(stored.ExpiredAt ?? null, null);
      assert.equal(winner.track.participantName, 'Guest 1');
      assert.equal(fake.select(claimWrite).filter((entry) => !entry.faulted && entry.ifMatch === '*').length, 0, 'no claim was ever sent without a version');
      const faulted = fake.requests.flatMap((entry) => [entry, ...(entry.parts ?? [])]).filter((entry) => entry.faulted).map((entry) => entry.faulted);
      if (name !== 'nothing going wrong') assert.ok(faulted.length > 0, 'the faults were really met');
      measured.push([`  5 devices, one code, ${name}: requests in all`, fake.count(), null]);
    });
  }

  it('the local server: exactly one gets in, and no stray track is left', async () => {
    useLocal();
    const { session } = await ds.activateClient('c-kroger', '2026-11-20');
    const token = await ds.provisionQrToken('c-kroger', session.id);
    const boots = await race(() => freshPage({ baseUrl: localBase }), token.id);
    const tracks = (await ds.listClientTracks(session.id)).filter((track) => track.qrTokenId === token.id).map((track) => track.id);
    assertSingleUse(boots, tracks, (await ds.getQrToken(token.id)).clientTrackId);
    assert.equal((await ds.getSession(session.id)).status, 'in-progress');
  });

  // ---- One device, and a connection that fails at the worst moment --------------------------------

  /** Runs `act` in place of the next request that `match` accepts; `act` is handed a function that really sends it. */
  function once(match, act) {
    const inner = globalThis.fetch;
    let done = false;
    globalThis.fetch = async (url, options = {}) => {
      if (done || !match(decodeURIComponent(String(url)), options)) return inner(url, options);
      done = true;
      return act(() => inner(url, options));
    };
  }
  const isClaim = (url, options) => options.headers?.['X-HTTP-Method'] === 'MERGE' && url.includes(`getbytitle('${SUITE_PREFIX}${TITLE.qrtokens}')`);
  const isCodeRead = (url, options) => (options.method ?? 'GET') === 'GET' && url.includes(`getbytitle('${SUITE_PREFIX}${TITLE.qrtokens}')`);
  const dropped = async () => { throw new TypeError('fetch failed'); };

  it('a claim that landed but whose reply was lost is still that device\'s: it is not told "already used" about its own code', async () => {
    const { fake, session } = await liveSharePoint();
    const [token] = await visitorCodes(session, 1);
    ds.configure({ sharePoint: fake.settings });
    fake.reset();
    once(isClaim, async (send) => {
      await send(); // SharePoint applied the write
      return new Response(JSON.stringify({ error: { message: { value: 'The server is busy.' } } }), { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '0' } });
    });
    const boot = await pageBoot(ds, { qrToken: token.id, path: '/' });
    assert.equal(boot.claimed, true);
    assert.deepEqual(fake.select(claimWrite).map((entry) => entry.ifMatch === '*'), [false, false], 'sent again after the 503, at the same version: refused, as it must be');
    assert.equal(fake.item('qrtokens', token.id).ClientTrackId, boot.track.id);
    assert.deepEqual(fake.lists.get('tracks').map((row) => row.AppId), [boot.track.id]);
  });

  for (const [what, landed] of [['after the claim landed', true], ['before the claim arrived', false]]) {
    it(`the connection drops ${what}: the page says it cannot reach the server, and "Try again" carries on with the same track`, async () => {
      const { fake, session } = await liveSharePoint();
      const [token] = await visitorCodes(session, 1);
      ds.configure({ sharePoint: fake.settings });
      fake.reset();
      once(isClaim, async (send) => {
        if (landed) await send();
        once(isCodeRead, dropped); // the device then asks the code whose it is, and that fails too
        return dropped();
      });
      await assert.rejects(pageBoot(ds, { qrToken: token.id, path: '/' }), (error) => error instanceof TypeError && !('code' in error), 'a connection error, not a refusal');
      assert.equal(fake.lists.get('tracks').length, 1, 'the track it wrote is kept while the outcome is unknown');

      const again = await pageBoot(ds, { qrToken: token.id, path: '/' }); // "Try again", same page
      assert.equal(again.claimed, true);
      assert.deepEqual(fake.lists.get('tracks').map((row) => row.AppId), [again.track.id]);
      assert.equal(fake.count({ method: 'POST', list: 'tracks' }), 1, 'no second track was written');
      assert.equal(fake.item('qrtokens', token.id).ClientTrackId, again.track.id);
      assert.equal(again.track.participantName, 'Guest 1');
    });
  }

  it('if another device takes the code while this one is cut off, "Try again" says "already used" and removes its track', async () => {
    const { fake, session } = await liveSharePoint();
    const [token] = await visitorCodes(session, 1);
    ds.configure({ sharePoint: fake.settings });
    once(isClaim, async () => {
      once(isCodeRead, dropped);
      return dropped();
    });
    await assert.rejects(pageBoot(ds, { qrToken: token.id, path: '/' }), TypeError);
    assert.equal(fake.lists.get('tracks').length, 1);
    const other = await pageBoot(await freshPage({ sharePoint: fake.settings }), { qrToken: token.id, path: '/' });
    assert.equal(other.claimed, true);
    const again = await pageBoot(ds, { qrToken: token.id, path: '/' });
    assert.deepEqual([again.claimed, again.code, again.notice], [false, 'token-used', USED]);
    assert.deepEqual(fake.lists.get('tracks').map((row) => row.AppId), [other.track.id]);
  });
});

// ---- (d) Resume ------------------------------------------------------------------------------------

describe('resume', () => {
  const trivia = (pack = samplePack()) => {
    const question = pack.questions.find((entry) => entry.id === 'q-trivia-1');
    return { ...question, options: question.optionIds.map((id) => pack.options.find((option) => option.id === id)) };
  };

  it('a reload mid-activity restores the saved answers with one indexed read', async () => {
    const { fake, session } = await liveSharePoint();
    const track = await newVisit(session.id);
    const visit = visitOf(track);
    const before = testStore();
    await before.store.restore(visit, null);
    before.store.record(visit, 'sec-trivia', answer('q-trivia-1', 'o-trivia-1-b', { correct: true }));
    before.store.record(visit, 'sec-trivia', answer('q-trivia-2', 'o-trivia-2-c', { correct: false, attempts: 2 }));
    await before.store.flush(visit, 'sec-trivia');
    fake.reset();
    // The reload: a new page, the same tab (its storage is empty because everything was saved).
    const reloaded = testStore({ storage: before.storage });
    await reloaded.store.restore(visit);
    assert.deepEqual(fake.requests.map(shape), ['GET responses']);
    assert.deepEqual((await reloaded.store.saved(visit)).map((record) => record.questionId), ['q-trivia-1', 'q-trivia-2']);
    assert.equal(fake.count(), 1, 'asking again reads nothing more');
    // Another device entirely (no storage in common) sees the same thing.
    const elsewhere = testStore();
    await elsewhere.store.restore(visit);
    assert.equal((await elsewhere.store.saved(visit)).length, 2);
  });

  it('a first wrong pick survives a reload: it is saved at the pick, and comes back as the first try', async () => {
    const { fake, session } = await liveSharePoint();
    const track = await newVisit(session.id);
    const visit = visitOf(track);
    const question = trivia();
    const wrong = 'o-trivia-1-a';
    const right = 'o-trivia-1-b';

    // The pick: wrong. The pager records it then and there, although the question is still open.
    const first = testStore();
    await first.store.restore(visit, null);
    const picked = chooseGraded(question, startGraded(), wrong);
    assert.equal(picked.phase, 'wrong');
    first.store.record(visit, 'sec-trivia', gradedRecord(question, picked));
    await first.store.flush(visit, 'sec-trivia');
    const stored = JSON.parse(fake.item('responses', track.id).ResponsesJson)[0];
    assert.deepEqual([stored.answer, stored.firstAnswer, stored.attempts, stored.correct], [wrong, wrong, 1, false]);
    assert.equal(isRecordSettled(stored), false, 'an open question does not count as answered');

    // Reload, on a device that kept nothing. The question comes back waiting for its Retry.
    const second = testStore();
    await second.store.restore(visit);
    const record = second.store.recordFor(visit, question.id);
    const restored = gradedStateFromRecord(question, record);
    assert.deepEqual(restored, { phase: 'wrong', attempts: 1, firstAnswer: wrong, choice: wrong });

    // Retry, right this time. The first answer does not change, so the score does not either.
    const settled = chooseGraded(question, retryGraded(restored), right);
    assert.equal(settled.phase, 'correct');
    second.store.record(visit, 'sec-trivia', gradedRecord(question, settled));
    await second.store.flush(visit, 'sec-trivia');
    const final = JSON.parse(fake.item('responses', track.id).ResponsesJson)[0];
    assert.deepEqual([final.answer, final.firstAnswer, final.attempts, final.correct], [right, wrong, 2, false]);
    assert.equal(isRecordSettled(final), true);
    assert.deepEqual(firstTryScore([question], new Map([[question.id, final.firstAnswer]])), { right: 0, total: 1 });
  });

  it('a reload cannot swap the first answer even if the page is told a different one', async () => {
    const { fake, session } = await liveSharePoint();
    const track = await newVisit(session.id);
    const visit = visitOf(track);
    const first = testStore();
    await first.store.restore(visit, null);
    first.store.record(visit, 'sec-trivia', { questionId: 'q-trivia-1', answer: 'o-trivia-1-a', firstAnswer: 'o-trivia-1-a', attempts: 1, correct: false });
    await first.store.flush(visit, 'sec-trivia');
    const second = testStore();
    await second.store.restore(visit);
    // A caller claiming a fresh, correct first try:
    second.store.record(visit, 'sec-trivia', { questionId: 'q-trivia-1', answer: 'o-trivia-1-b', firstAnswer: 'o-trivia-1-b', attempts: 1, correct: true });
    await second.store.flush(visit, 'sec-trivia');
    const stored = JSON.parse(fake.item('responses', track.id).ResponsesJson)[0];
    assert.deepEqual([stored.firstAnswer, stored.correct], ['o-trivia-1-a', false]);
  });

  it('answers a reload interrupted before they were saved are saved by the next page, without being asked', async () => {
    const { fake, session } = await liveSharePoint();
    const track = await newVisit(session.id);
    const visit = visitOf(track);
    const first = testStore();
    await first.store.restore(visit, null);
    fake.failNext({ status: 500, times: 99, when: (entry) => entry.list === 'responses' && entry.method !== 'GET' });
    first.store.record(visit, 'sec-trivia', answer('q-trivia-1', 'o-trivia-1-b', { correct: true }));
    await assert.rejects(first.store.flush(visit, 'sec-trivia'), SaveFailedError);
    fake.clearFaults();
    const second = testStore({ storage: first.storage });
    await second.store.restore(visit);
    await second.store.flush(visit, 'sec-trivia');
    assert.equal(JSON.parse(fake.item('responses', track.id).ResponsesJson)[0].questionId, 'q-trivia-1');
  });

  it("a facilitator restart removes the activity's answers from the participant's item and from the device, and they cannot come back", async () => {
    const { fake, session } = await liveSharePoint();
    const track = await newVisit(session.id);
    const visit = visitOf(track);
    const { store } = testStore();
    await store.restore(visit, null);
    store.record(visit, 'sec-trivia', answer('q-trivia-1', 'o-trivia-1-b', { correct: true }));
    store.record(visit, 'sec-guess-the-brand', answer('q-brand-1', 'o-brand-1-b', { correct: true }));
    await store.flush(visit, 'sec-trivia');

    const { removed } = await ds.restartParticipantTrack(track.id, { sectionId: 'sec-trivia' });
    assert.equal(removed, 1, 'the one answer to that activity, from their own item');
    assert.deepEqual(JSON.parse(fake.item('responses', track.id).ResponsesJson).map((record) => record.questionId), ['q-brand-1']);
    const restarted = await ds.getClientTrack(track.id);
    assert.equal(restarted.restartSectionId, 'sec-trivia');

    // The device had not noticed yet and saved once more: the old answer is back on the server...
    store.record(visit, 'sec-guess-the-brand', answer('q-brand-1', 'o-brand-1-b', { correct: true }));
    await store.flush(visit, 'sec-guess-the-brand');
    assert.equal(JSON.parse(fake.item('responses', track.id).ResponsesJson).length, 2);
    // ...until it notices the restart, drops the activity's answers and rewrites its item without them.
    await store.restart({ ...visit, restartedAt: restarted.restartedAt }, ['q-trivia-1', 'q-trivia-2', 'q-trivia-3', 'q-trivia-4', 'q-trivia-5']);
    await store.flush({ ...visit, restartedAt: restarted.restartedAt }, 'sec-trivia');
    assert.deepEqual(JSON.parse(fake.item('responses', track.id).ResponsesJson).map((record) => record.questionId), ['q-brand-1']);
    assert.equal(store.recordFor({ ...visit, restartedAt: restarted.restartedAt }, 'q-trivia-1'), null);
    assert.equal((await ds.readSessionResponses(session.id)).some((entry) => entry.questionId === 'q-trivia-1'), false);
  });

  it('answers held from before a restart are dropped by a page that loads after it', async () => {
    const { fake, session } = await liveSharePoint();
    const track = await newVisit(session.id);
    const first = testStore();
    await first.store.restore(visitOf(track), null);
    fake.failNext({ status: 500, times: 99, when: (entry) => entry.list === 'responses' && entry.method !== 'GET' });
    first.store.record(visitOf(track), 'sec-trivia', answer('q-trivia-1', 'o-trivia-1-b', { correct: true }));
    await assert.rejects(first.store.flush(visitOf(track), 'sec-trivia'));
    fake.clearFaults();
    await ds.restartParticipantTrack(track.id);
    const restartedAt = (await ds.getClientTrack(track.id)).restartedAt;
    const second = testStore({ storage: first.storage });
    await second.store.restore(visitOf(track, restartedAt));
    assert.equal(second.store.hasPending(visitOf(track, restartedAt)), false);
    assert.equal(first.storage.map.has(`cec-answers:${track.id}`), false);
    assert.equal(fake.item('responses', track.id), undefined, 'and nothing of theirs reaches the server');
  });
});

// ---- (e) One reader of a session's answers --------------------------------------------------------

describe('readSessionResponses reads a session\'s answers: one record for each participant and question', () => {
  /** Five participants, each with an item of their own. One missed first and got it on the Retry. */
  async function fiveAnswer(session) {
    const tracks = [];
    for (let index = 0; index < 5; index += 1) tracks.push(await newVisit(session.id));
    const [rightA, wrong, retried, rightB, rightC] = tracks;
    const own = (track, responses) => ds.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: 'c-kroger', responses });
    const at = '2026-10-11T12:00:00.000Z';
    const first = (answer, correct) => [{ questionId: 'q-trivia-1', answer, firstAnswer: answer, attempts: 1, correct, answeredAt: at }];
    await own(rightA, first('o-trivia-1-b', true));
    await own(wrong, first('o-trivia-1-a', false));
    // `retried` missed first and got it on the Retry: the FIRST answer (a) is the one that counts.
    await own(retried, [{ questionId: 'q-trivia-1', answer: 'o-trivia-1-b', firstAnswer: 'o-trivia-1-a', attempts: 2, correct: false, answeredAt: at },
      { questionId: 'q-open-feedback', answer: 'Great session', firstAnswer: 'Great session', attempts: 1, correct: null, answeredAt: at }]);
    await own(rightB, first('o-trivia-1-b', true));
    await own(rightC, first('o-trivia-1-b', true));
    return { rightA, wrong, retried, rightB, rightC };
  }
  const byOwner = (answers, questionId) => Object.fromEntries(answers.filter((entry) => entry.questionId === questionId).map((entry) => [entry.clientTrackId, entry]));

  it('returns one normalised answer per participant and question, in one request', async () => {
    const { fake, session } = await liveSharePoint();
    const people = await fiveAnswer(session);
    fake.reset();
    const answers = await ds.readSessionResponses(session.id);
    assert.equal(fake.count(), 1, 'one indexed query returns every participant item');
    assert.match(fake.requests[0].query, /SessionId eq '/);
    const trivia = byOwner(answers, 'q-trivia-1');
    assert.deepEqual(Object.keys(trivia).sort(), Object.values(people).map((track) => track.id).sort());
    assert.deepEqual([trivia[people.rightA.id].answer, trivia[people.rightA.id].attempts, trivia[people.rightA.id].correct], ['o-trivia-1-b', 1, true]);
    assert.deepEqual([trivia[people.retried.id].answer, trivia[people.retried.id].finalAnswer, trivia[people.retried.id].attempts, trivia[people.retried.id].correct], ['o-trivia-1-a', 'o-trivia-1-b', 2, false]);
    assert.deepEqual(Object.keys(answers[0]).sort(), ['answer', 'attempts', 'clientId', 'clientTrackId', 'correct', 'finalAnswer', 'firstAnswer', 'questionId', 'timestamp']);
    assert.equal(answers.find((entry) => entry.questionId === 'q-open-feedback').answer, 'Great session');
  });

  it('the tally Results and the exports show counts everyone, by first try', async () => {
    const { session } = await liveSharePoint();
    await fiveAnswer(session);
    const results = await readSessionResults(session.id);
    const question = results.sections.flatMap((section) => section.questions).find((entry) => entry.id === 'q-trivia-1');
    assert.equal(question.respondents, 5);
    const counts = Object.fromEntries(question.options.map((option) => [option.id, option.count]));
    assert.deepEqual(counts, { 'o-trivia-1-a': 2, 'o-trivia-1-b': 3, 'o-trivia-1-c': 0, 'o-trivia-1-d': 0 });
    assert.equal(results.tracks.length, 5);
  });

  it('an item with no TrackId is nobody\'s: its answers are not read, not counted and not reported, whether it is whole or damaged', async () => {
    const { fake, session } = await liveSharePoint();
    const people = await fiveAnswer(session);
    const before = await ds.readSessionResponsesChecked(session.id);
    assert.equal(before.answers.length, 6);
    // What an older page left behind, or a row somebody added by hand: the session's id as its AppId, and no TrackId.
    fake.add('responses', { AppId: session.id, Title: session.id, SessionId: session.id, ResponsesJson: JSON.stringify([
      { questionId: 'q-trivia-1', clientId: 'c-kroger', clientTrackId: people.wrong.id, answer: 'o-trivia-1-d', timestamp: '2026-10-11T12:00:00.000Z' },
      { questionId: 'q-trivia-2', clientId: 'c-kroger', clientTrackId: 'somebody-else', answer: 'o-trivia-2-a', timestamp: '2026-10-11T12:00:00.000Z' },
    ]) });
    assert.deepEqual(await ds.readSessionResponsesChecked(session.id), before, 'the same answers, and nothing said to be unreadable');
    const results = await readSessionResults(session.id);
    assert.equal(results.sections.flatMap((section) => section.questions).find((entry) => entry.id === 'q-trivia-2').respondents, 0, 'nobody is counted for it');
    fake.item('responses', session.id).ResponsesJson = '{oops';
    assert.deepEqual(await ds.readSessionResponsesChecked(session.id), before, 'damaged, it is still not a participant whose answers could not be read');
    assert.deepEqual(await ds.readSessionResponses(session.id), before.answers, 'and the reader that stops at a damaged item does not stop for it');
    const feed = await ds.readLiveFeed(session.id, { sectionIds: [], tolerant: true });
    assert.deepEqual([feed.answers.length, feed.unreadable], [6, []], 'the Live display\'s feed likewise');
  });

  it("lists a session's participant items a page at a time: about 60 in one indexed query", async () => {
    const { fake, session } = await liveSharePoint();
    for (let index = 0; index < 60; index += 1) {
      fake.add('responses', { AppId: `track-${index}`, TrackId: `track-${index}`, SessionId: session.id, ClientId: 'c-kroger', ResponsesJson: JSON.stringify([{ questionId: 'q-trivia-1', answer: 'o-trivia-1-b', firstAnswer: 'o-trivia-1-b', attempts: 1, correct: true, answeredAt: '2026-10-11T12:00:00.000Z' }]) });
    }
    fake.add('responses', { AppId: session.id, SessionId: session.id, ResponsesJson: '[]' }); // an item with no TrackId is not a participant's
    fake.add('responses', { AppId: 'elsewhere', TrackId: 'elsewhere', SessionId: 'another-session', ResponsesJson: '[]' });
    fake.reset();
    const page = await ds.listSessionParticipants(session.id);
    assert.equal(page.items.length, 60);
    assert.equal(page.next, null);
    assert.equal(fake.count(), 1);
    measured.push(["a session's 60 participant items (the leader report's read)", fake.count(), 1]);
    assert.deepEqual(Object.keys(page.items[0]).sort(), ['clientId', 'responses', 'sessionId', 'trackId']);

    const collected = [];
    let cursor = null;
    let pages = 0;
    do {
      const next = await ds.listSessionParticipants(session.id, { pageSize: 25, cursor });
      collected.push(...next.items);
      cursor = next.next;
      pages += 1;
    } while (cursor);
    assert.equal(pages, 3);
    assert.equal(new Set(collected.map((item) => item.trackId)).size, 60);
  });
});

// ---- (f) Both adapters -----------------------------------------------------------------------------

describe('the local adapter and the SharePoint adapter behave the same', () => {
  /** The same visit, the same steps; everything the app can observe is collected. */
  async function scenario() {
    const client = await ds.createClient({ id: 'c-parity', name: 'Parity & Co.', slug: 'parity', status: 'active', themeVersion: 3, theme: { version: 3, primary: '#045BCC', copy: { eventTitle: 'Parity Night' } } });
    await ds.createOption({ id: 'o-p-1', questionId: 'q-p-1', label: 'One', value: 'one', correct: false, imageUrl: null });
    await ds.createOption({ id: 'o-p-2', questionId: 'q-p-1', label: 'Two', value: 'two', correct: true, imageUrl: '/assets/two.png' });
    await ds.createQuestion({ id: 'q-p-1', sectionId: 'sec-p', type: 'single-select', prompt: 'Pick', optionIds: ['o-p-1', 'o-p-2'], order: 1, layout: 'image-grid' });
    await ds.createQuestion({ id: 'q-p-2', sectionId: 'sec-p', type: 'open-text-feedback', prompt: 'Say', optionIds: [], order: 2, layout: 'text-list' });
    await ds.createSection({ id: 'sec-p', title: 'Parity', order: 1, enabled: true, industryTags: [], questionIds: ['q-p-1', 'q-p-2'], clientId: client.id, description: 'Same on both' });
    const { session } = await ds.activateClient(client.id, '2026-12-01');
    const again = await ds.activateClient(client.id, '2026-12-01');
    const live = await ds.getLiveExperience();
    const questions = await ds.getSectionQuestions(live.sections[0]);
    const fields = { trackId: 'track-parity', sessionId: session.id, clientId: client.id };
    const at = (seconds) => `2026-12-01T10:00:0${seconds}.000Z`;
    const none = await ds.getParticipantResponses('track-parity');
    const created = await ds.saveParticipantResponses({ ...fields, responses: [{ questionId: 'q-p-1', answer: 'o-p-1', firstAnswer: 'o-p-1', attempts: 1, correct: false, answeredAt: at(1) }] });
    await ds.saveParticipantResponses({ ...fields, responses: [
      { questionId: 'q-p-1', answer: 'o-p-2', firstAnswer: 'o-p-1', attempts: 2, correct: false, answeredAt: at(2) },
      { questionId: 'q-p-2', answer: 'Line one\n"quoted" & <b>', firstAnswer: 'Line one\n"quoted" & <b>', attempts: 1, correct: null, answeredAt: at(3) },
    ] }, created.ref);
    // A second device creating the same item collides and merges; the stored first answer wins.
    const collided = await ds.saveParticipantResponses({ ...fields, responses: [{ questionId: 'q-p-1', answer: 'o-p-2', firstAnswer: 'o-p-2', attempts: 1, correct: true, answeredAt: at(4) }] });
    const own = await ds.getParticipantResponses('track-parity');
    const all = (await ds.readSessionResponses(session.id)).map(({ timestamp, ...rest }) => ({ ...rest, stamped: typeof timestamp === 'string' }))
      .sort((left, right) => `${left.clientTrackId}${left.questionId}`.localeCompare(`${right.clientTrackId}${right.questionId}`));
    const page = await ds.listSessionParticipants(session.id);
    const tooLong = await ds.saveParticipantResponses({ ...fields, responses: [{ questionId: 'q-p-2', answer: 'x'.repeat(MAX_TEXT_LENGTH + 1) }] }, created.ref).then(() => 'saved', (error) => error.code);
    const results = await readSessionResults(session.id);
    // (The $batch step and the two probes of the tenant (Phase 9b) exist on SharePoint only: the local server has no batch endpoint and no such questions.)
    const selfTest = (await ds.runParticipantSelfTest()).filter(({ name }) => !name.includes('$batch') && !name.startsWith('Probe')).map(({ name, pass }) => [name, pass]);
    const removed = await ds.deleteParticipantResponses('track-parity');
    const hub = await ds.getClientActivities(client.id, live.session);
    const visitFields = { visitKey: 'visit-parity', sessionId: session.id, clientId: client.id, page: 'participant', entryMode: 'staff', displayName: 'Casey', visitedAt: '2026-12-01T10:00:00.000Z' };
    const visit = [await ds.recordParticipantVisit(visitFields), await ds.recordParticipantVisit(visitFields)];
    const visits = (await listOf('uservisitlogs', session.id)).map(({ id, page, displayName }) => [id, page, displayName]);
    return {
      hub, visit, visits,
      sessionId: session.id, sameSession: again.session.id === session.id,
      live: { status: live.status, client: live.client, flow: live.session.activityFlow, sectionIds: live.session.sectionIds, sections: live.sections },
      activatedAt: typeof live.settings.activatedAt, activeClientId: live.settings.activeClientId,
      questions, none, collidedResponses: collided.responses, own: { ...own, ref: undefined }, all, page, tooLong,
      tally: results.sections[0].questions.map((question) => [question.id, question.respondents, question.options.map((option) => [option.id, option.count])]),
      selfTest, removed, after: await ds.getParticipantResponses('track-parity'),
    };
  }

  it('the same steps give identical records, answers, tallies and errors on both', async () => {
    const fake = createSharePointFake();
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    const sharePoint = await scenario();
    useLocal();
    const local = await scenario();
    assert.deepEqual(local, sharePoint);
    // And the values are the ones intended, not merely equal.
    assert.equal(sharePoint.sessionId, 'parity-2026-12-01');
    assert.equal(sharePoint.sameSession, true);
    assert.equal(sharePoint.live.client.theme.copy.eventTitle, 'Parity Night');
    assert.equal(sharePoint.live.flow, 'sequential');
    assert.equal(sharePoint.questions[0].layout, 'image-grid');
    assert.equal(sharePoint.questions[0].options[1].imageUrl, '/assets/two.png');
    assert.equal(sharePoint.none, null);
    assert.deepEqual(sharePoint.collidedResponses.map((record) => [record.questionId, record.answer, record.firstAnswer, record.correct]), [
      ['q-p-1', 'o-p-2', 'o-p-1', false], ['q-p-2', 'Line one\n"quoted" & <b>', 'Line one\n"quoted" & <b>', null],
    ]);
    assert.equal(sharePoint.tooLong, 'answer-too-long');
    assert.equal(sharePoint.selfTest.every(([, pass]) => pass), true);
    assert.equal(sharePoint.after, null);
    assert.deepEqual(sharePoint.hub.map((section) => section.id), ['sec-p']);
    assert.deepEqual(sharePoint.visits, [['visit-parity', 'participant', 'Casey']], 'logging the same visit twice leaves one row');
  });
});

// ---- openQrScan: what it refuses, in which words, and what a claim writes -----------------------------
// Until Phase 10c-2a this held openQrScan() to claimQrToken(), the legacy pages' check-in, case by case and word for word. That
// function is gone, so the codes and the words are written out here: they are what a guest reads on Welcome when a code cannot be used.

describe('openQrScan refuses with these codes and these words, and a claim writes this visit, on both adapters', () => {
  const REFUSALS = {
    unknown: ['token-unknown', "This QR code isn't recognized. Ask your facilitator for a new one."],
    used: ['token-used', 'This QR code has already been used. Ask your facilitator for a new code.'],
    'no-visitor': ['visitor-token-required', 'This code is not assigned to a visitor. Ask your facilitator for a visitor-specific code.'],
    'visitor-off': ['visitor-missing', 'This visitor code is no longer enabled. Ask your facilitator for help.'],
    'stray-visitor': ['unexpected-visitor', 'This visitor code is not valid for the active session mode.'],
    'other-session': ['session-not-active', 'This code is for a different session. Ask your facilitator for the current check-in code.'],
    'ended-unretired': ['token-expired', 'This QR code has expired because the session has ended.'],
    expired: ['token-expired', 'This QR code has expired because the session has ended.'],
  };

  /** Every refusal, each asked of a code in that state. Returns what the scan said, and what claim() then rejected with, by case. */
  async function refusals(day) {
    const { session } = await ds.activateClient('c-kroger', day);
    const said = {};
    const ask = async (name, tokenId) => {
      const scan = await ds.openQrScan(tokenId);
      const viaClaim = await scan.claim().then(() => null, ({ code, message }) => [code, message]);
      said[name] = { scan: scan.failure ? [scan.failure.code, scan.failure.message] : null, viaClaim, live: scan.experience.status };
    };
    const code = (options) => ds.provisionQrToken('c-kroger', session.id, options).then((token) => token.id);

    await ask('unknown', 'no-such-code');
    const spent = await code();
    await (await ds.openQrScan(spent)).claim();
    await ask('used', spent);
    const tracksBefore = (await ds.listClientTracks(session.id)).length;

    const staffCode = await code();
    const elsewhere = await code();
    await ds.updateSession(session.id, { participationMode: 'client-visit' });
    await ask('no-visitor', staffCode);
    const guest = await ds.createVisitor({ sessionId: session.id, displayName: 'Guest', enabled: true });
    const guestCode = await code({ visitorId: guest.id });
    const strayCode = await code({ visitorId: guest.id });
    await ds.updateVisitor(guest.id, { enabled: false }); // directly: setVisitorEnabled() would retire the codes too
    await ask('visitor-off', guestCode);
    await ds.updateVisitor(guest.id, { enabled: true });
    await ds.updateSession(session.id, { participationMode: 'staff' });
    await ask('stray-visitor', strayCode);

    await ds.updateAppSettings({ activeSessionId: 'another-session' });
    await ask('other-session', elsewhere);
    await ds.updateAppSettings({ activeSessionId: session.id });

    const late = await code();
    await ds.updateSession(session.id, { status: 'completed' }); // ended by hand: the code was never retired
    await ask('ended-unretired', late);
    const retired = ds.qrTokenStatus(await ds.getQrToken(late));
    await ds.reopenSession(session.id);
    const lapsed = await code();
    await ds.endSession(session.id); // retires it
    await ask('expired', lapsed);
    await ds.reopenSession(session.id);
    return { said, retired, tracksAdded: (await ds.listClientTracks(session.id)).length - tracksBefore };
  }

  /** A staff code and a visitor's code, each scanned and claimed. Returns the visit each made, and the state its code was left in. */
  async function claims(day) {
    const { session } = await ds.activateClient('c-kroger', day);
    const user = await ds.getCurrentUser();
    const scanned = async (options) => {
      const token = await ds.provisionQrToken('c-kroger', session.id, options);
      const scan = await ds.openQrScan(token.id);
      const track = await scan.claim();
      const now = await ds.getQrToken(token.id);
      return {
        track, tokenId: token.id, live: scan.experience.status, failure: scan.failure,
        code: [track.qrTokenId === token.id, now.used, now.clientTrackId === track.id, typeof now.usedAt, ds.qrTokenStatus(now)],
      };
    };
    const staff = await scanned();
    await ds.setSessionParticipationMode(session.id, 'client-visit');
    const guest = await ds.createVisitor({ sessionId: session.id, displayName: 'Jordan Lee', enabled: true });
    const visitor = await scanned({ visitorId: guest.id });
    return { session, user, guest, staff, visitor, status: (await ds.getSession(session.id)).status, tracks: (await ds.listClientTracks(session.id)).length };
  }

  for (const adapter of ['SharePoint', 'the local server']) {
    const open = async () => {
      if (adapter === 'SharePoint') {
        const fake = createSharePointFake();
        fake.install();
        ds.configure({ sharePoint: fake.settings });
        await seedPack(ds, samplePack());
      } else useLocal();
    };

    it(`${adapter}: every refusal has its code and its words, from the scan and from claim() alike, and writes no track`, async () => {
      await open();
      const { said, retired, tracksAdded } = await refusals('2026-11-21');
      assert.deepEqual(Object.keys(said).sort(), Object.keys(REFUSALS).sort(), 'the cases are the ones intended');
      for (const [name, { scan, viaClaim }] of Object.entries(said)) {
        assert.deepEqual(scan, REFUSALS[name], name);
        assert.deepEqual(viaClaim, REFUSALS[name], `${name}: claim() rejects with the same`);
      }
      assert.equal(retired, 'expired', 'a code whose session ended is retired by the scan');
      assert.equal(tracksAdded, 0);
      assert.equal(said['other-session'].live, 'not-live', 'the experience shown is the active session\'s, not the code\'s');
      assert.equal(said.expired.live, 'not-live');
      assert.equal(said.used.live, 'live');
    });

    it(`${adapter}: a claim that goes through writes the visit, with the guest's name or the account, and leaves the code used and linked to it`, async () => {
      await open();
      const { session, user, guest, staff, visitor, status, tracks } = await claims('2026-11-22');
      const plain = ({ id, createdAt, qrTokenId, ...rest }) => ({ ...rest, hasId: typeof id === 'string' && id.length > 0, stamped: !Number.isNaN(Date.parse(createdAt)) });
      const made = { sessionId: session.id, clientId: 'c-kroger', joinedVia: 'qr', resumeCount: 0, lastResumedAt: null, restartedAt: null, restartSectionId: null, hasId: true, stamped: true };
      // A staff code records the signed-in account (the local server has none); a visitor's code records the roster's name and no account.
      assert.deepEqual(plain(staff.track), { ...made, visitorId: null, participantName: null, sharePointUserId: user?.id ?? null });
      assert.deepEqual(plain(visitor.track), { ...made, visitorId: guest.id, participantName: 'Jordan Lee', sharePointUserId: null });
      assert.equal(user?.id ?? null, adapter === 'SharePoint' ? '42' : null);
      for (const kind of [staff, visitor]) {
        assert.equal(kind.failure, null);
        assert.equal(kind.live, 'live');
        assert.deepEqual(kind.code, [true, true, true, 'string', 'used']);
      }
      assert.equal(status, 'in-progress');
      assert.equal(tracks, 2);
    });
  }
});

// ---- Activation ------------------------------------------------------------------------------------

describe('activateClient', () => {
  it("finds or creates the client's session for the day under a deterministic id, and points AppSettings at it", async () => {
    const { fake } = await liveSharePoint('c-dominos');
    const settings = fake.item('appsettings', 'default');
    assert.equal(settings.ActiveSessionId, `dominos-${DAY}`);
    assert.equal(settings.ActiveClientId, 'c-dominos');
    assert.ok(!Number.isNaN(Date.parse(settings.ActivatedAt)));
    const session = fake.item('sessions', `dominos-${DAY}`);
    assert.deepEqual(JSON.parse(session.SectionIds), ['sec-dominos-history', 'sec-dominos-innovation']);
    assert.deepEqual([session.ClientId, session.Status, session.ActivityFlow, session.ParticipationMode], ['c-dominos', 'not-started', 'sequential', 'staff']);
    assert.equal(session.SessionDate, `${DAY}T00:00:00Z`);
    // Another day is another session; the same day again is the same one.
    await ds.activateClient('c-dominos', '2026-10-12');
    await ds.activateClient('c-dominos', DAY);
    assert.deepEqual(fake.lists.get('sessions').map((row) => row.AppId).sort(), [`dominos-${DAY}`, 'dominos-2026-10-12']);
    assert.equal(fake.item('appsettings', 'default').ActiveSessionId, `dominos-${DAY}`);
  });

  it('two admins going live at once cannot create a duplicate session', async () => {
    const fake = createSharePointFake();
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    await seedPack(ds, samplePack());
    const results = await Promise.allSettled([ds.activateClient('c-kroger', DAY), ds.activateClient('c-kroger', DAY), ds.activateClient('c-kroger', DAY)]);
    assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'fulfilled', 'fulfilled']);
    assert.equal(fake.lists.get('sessions').filter((row) => row.AppId === `kroger-${DAY}`).length, 1);
    assert.equal(fake.lists.get('appsettings').length, 1);
    assert.deepEqual(new Set(results.map((result) => result.value.session.id)), new Set([`kroger-${DAY}`]));
  });

  it('refuses a bad date, a missing client, and a day whose session has ended', async () => {
    const { session } = await liveSharePoint();
    await assert.rejects(ds.activateClient('c-kroger', '11/10/2026'), { code: 'date-invalid' });
    await assert.rejects(ds.activateClient('c-nobody', DAY), { code: 'client-missing' });
    await ds.endSession(session.id);
    await assert.rejects(ds.activateClient('c-kroger', DAY), { code: 'session-ended' });
  });

  it("switching client retires the previous session's unscanned codes, and an activity added later joins the session", async () => {
    const { fake, session } = await liveSharePoint();
    const token = await ds.provisionQrToken('c-kroger', session.id);
    await ds.activateClient('c-dominos', DAY);
    assert.equal(fake.item('qrtokens', token.id).Used, true);
    await ds.createSection({ id: 'sec-late', title: 'Late', order: 9, enabled: true, industryTags: [], questionIds: [], clientId: 'c-kroger' });
    const again = await ds.activateClient('c-kroger', DAY);
    assert.ok(again.session.sectionIds.includes('sec-late'));
  });

  it('nothing is live without a client named in AppSettings, and an activity with no client is shown to nobody and costs no read', async () => {
    const fake = createSharePointFake();
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    await ds.createClient({ id: 'c-own', name: 'Own Co.', status: 'active' });
    await ds.createSection({ id: 'sec-none', title: 'Nobody\'s', order: 1, enabled: true, industryTags: [], questionIds: [] });
    await ds.createSession({ id: 's-own', clientId: 'c-own', date: DAY, sectionIds: ['sec-none'], status: 'not-started' });
    // AppSettings names a session and no client. Only the legacy admin wrote that; Go live always writes both.
    await ds.updateAppSettings({ activeSessionId: 's-own' });
    fake.reset();
    const unnamed = await ds.getLiveExperience();
    assert.deepEqual([unnamed.status, unnamed.reason, unnamed.client, unnamed.sections], ['not-live', 'client-missing', null, []]);
    assert.deepEqual(fake.requests.map(shape), ['GET appsettings', 'GET sessions'], 'the session says whether it is missing or has ended; no client is looked for through it');

    // Live as Go live makes it. The activity the session lists belongs to no client, so it is not among this client's: there are none.
    await ds.updateAppSettings({ activeSessionId: 's-own', activeClientId: 'c-own' });
    fake.reset();
    const live = await ds.getLiveExperience();
    assert.deepEqual([live.status, live.client.id, live.sections], ['live', 'c-own', []]);
    assert.deepEqual(sorted(fake.requests.map(shape)), ['GET appsettings', 'GET clients', 'GET sections', 'GET sessions'], 'four reads');
    assert.equal(fake.count((entry) => entry.list === 'sections' && entry.query.includes('AppId eq')), 0, 'and none of them for the session\'s own list of activities');
    // The hub's two reads and the page's timer say the same, at the same cost.
    fake.reset();
    assert.deepEqual((await ds.getSessionActivities('s-own', 'c-own')).sections, []);
    assert.deepEqual(await ds.getClientActivities('c-own', live.session), []);
    assert.deepEqual((await ds.readParticipantWatch({ sessionId: 's-own', clientId: 'c-own' })).sections, []);
    assert.equal(fake.count((entry) => [entry, ...(entry.parts ?? [])].some((read) => read.list === 'sections' && read.query.includes('AppId eq'))), 0);
    assert.equal(fake.count((entry) => entry.method !== 'GET' && !entry.path.endsWith('/$batch') && !entry.path.endsWith('/contextinfo')), 0, 'a participant load writes nothing');

    // Given the client, it is that client's.
    await ds.updateSection('sec-none', { clientId: 'c-own' });
    assert.deepEqual((await ds.getLiveExperience()).sections.map((section) => section.id), ['sec-none']);
  });
});

// ---- A site that lacks a column ---------------------------------------------------------------------
// (Until Phase 10c-1 the first test here ran everything the legacy app did on such a site. The legacy app left the branch, and the
// functions only it called with it; what is left is what the new pages say when a column they need is missing.)

// Schema v2 (Phase 10c-2b): every column must exist. Until then thirteen columns (those added in Phase 4) were optional to the data layer
// and to the checks; a write that needed one the list lacked failed by naming it, and any other write went through. Now a list that lacks
// any column is refused before anything is written to it, and both checks name every missing column alike. The fakes and the calls are
// the ones those tests made (the same thirteen columns taken away), so what is sent is what was sent, under the new names.
describe('every column must exist', () => {
  it('a write to a list that lacks a column is refused before anything is sent, even when the record does not carry that column', async () => {
    const fake = createSharePointFake({ without: PHASE_4_COLUMNS });
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    await assert.rejects(ds.createSection({ id: 's', title: 'S', order: 1, enabled: true, industryTags: [], questionIds: [], clientId: 'c' }),
      new RegExp(`${TITLE.sections} is missing the internal column ClientId\\.`));
    await assert.rejects(ds.createClient({ id: 'c', name: 'C' }), new RegExp(`${TITLE.clients} is missing the internal column Slug\\.`), 'a client that carries no theme is refused all the same');
    await assert.rejects(ds.createQuestion({ id: 'q', sectionId: 's', type: 'single-select', prompt: 'Q', optionIds: [], order: 1 }),
      new RegExp(`${TITLE.questions} is missing the internal column Layout\\.`));
    assert.equal(fake.count((entry) => entry.method === 'POST' && entry.list), 0, 'nothing was sent to a list');
  });

  it('both checks name every missing column, and every missing list; Setup\'s says how to make each, Today\'s names it only', async () => {
    const fake = createSharePointFake({ without: [...PHASE_4_COLUMNS, 'visitorroster', 'tracks.RestartSectionId'] });
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    const report = plainTitles(await ds.checkSharePointSchema({ specs: schemaSpecs }));
    const flat = report.flatMap((list) => list.problems.map((problem) => `${list.list}.${problem.column} | ${problem.type} | ${problem.problem}`));
    assert.deepEqual(flat.filter((line) => !line.includes(TITLE.visitorroster)), [
      `${TITLE.clients}.Slug | Single line of text | Missing.`,
      `${TITLE.clients}.ThemeJson | Multiple lines of text, plain text | Missing.`,
      `${TITLE.clients}.ThemeVersion | Number | Missing.`,
      `${TITLE.clients}.Status | Single line of text | Missing.`,
      `${TITLE.sessions}.ActivityFlow | Single line of text | Missing.`,
      `${TITLE.sections}.ClientId | Single line of text, indexed | Missing.`,
      `${TITLE.sections}.Description | Multiple lines of text, plain text | Missing.`,
      `${TITLE.questions}.Layout | Single line of text | Missing.`,
      `${TITLE.options}.ImageUrl | Single line of text | Missing.`,
      `${TITLE.tracks}.RestartSectionId | Single line of text | Missing.`,
      `${TITLE.appsettings}.ActiveClientId | Single line of text | Missing.`,
      `${TITLE.appsettings}.ActivatedAt | Date and Time, shown as Date & Time | Missing.`,
      `${TITLE.responses}.TrackId | Single line of text, indexed | Missing.`,
      `${TITLE.responses}.ClientId | Single line of text | Missing.`,
    ]);
    assert.deepEqual(report.find((list) => list.list === TITLE.visitorroster).problems, [{ column: null, type: null, problem: `The list "${TITLE.visitorroster}" does not exist.` }]);
    assert.equal(report.filter((list) => list.ready).map((list) => list.list).join(), `${TITLE.qrtokens},${TITLE.uservisitlogs},${TITLE.adminusers},${TITLE.users},${TITLE.roleassignments},${TITLE.auditlog},${TITLE.sessionsummary}`);
    assert.equal(fake.count((entry) => entry.method !== 'GET'), 0, 'the check only reads');
    const today = plainTitles(await ds.checkSharePointSchema()).flatMap((list) => list.problems.map((problem) => `${list.list}.${problem.column} | ${problem.type} | ${problem.problem}`));
    assert.deepEqual(today, flat.map((line) => line.replace(/ \| [^|]+ \| Missing\.$/, ' | null | Missing.')));
  });

  it('both checks catch a wrong type, a missing index, rich text, a column of words made as a Choice, a required column and an AppId that is not', async () => {
    const fake = createSharePointFake();
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    assert.equal((await ds.checkSharePointSchema({ specs: schemaSpecs })).every((list) => list.ready), true, 'the full schema is ready');
    assert.equal((await ds.checkSharePointSchema()).every((list) => list.ready), true, 'and so is Today\'s check of it');
    const field = (list, column) => fake.fields.get(list).find((entry) => entry.InternalName === column);
    field('responses', 'TrackId').Indexed = false;
    field('clients', 'ThemeJson').RichText = true;
    field('clients', 'ThemeVersion').TypeAsString = 'Text';
    field('sections', 'ClientId').Required = true;
    field('questions', 'Layout').TypeAsString = 'Choice';
    field('adminusers', 'AppId').Required = false;
    field('sessions', 'SessionDate').DisplayFormat = 0;
    const problems = async (options) => plainTitles(await ds.checkSharePointSchema(options)).flatMap((list) => list.problems.map((problem) => `${list.list}.${problem.column}: ${problem.problem}`));
    const expected = [
      `${TITLE.clients}.ThemeJson: Must be plain text with append-only disabled.`,
      `${TITLE.clients}.ThemeVersion: Wrong type: it is Single line of text.`,
      `${TITLE.sections}.ClientId: Must not be required.`,
      `${TITLE.questions}.Layout: Wrong type: it is Choice.`,
      `${TITLE.adminusers}.AppId: Not required: every item must have one.`,
      `${TITLE.responses}.TrackId: Not indexed.`,
    ];
    // Setup's check also says a date shown as Date Only (it can come back as the day before); Today's knows kinds and indexes, not formats.
    assert.deepEqual(await problems({ specs: schemaSpecs }), [...expected.slice(0, 2), `${TITLE.sessions}.SessionDate: Shows the date only: make it Date & Time.`, ...expected.slice(2)]);
    assert.deepEqual(await problems(), expected);
  });
});

// ---- The setup page's self-test -------------------------------------------------------------------

describe('the SharePoint self-test', () => {
  it('creates, updates, reads back, is refused a duplicate, lists, and deletes everything it made', async () => {
    const fake = createSharePointFake();
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    const seen = [];
    const steps = await ds.runParticipantSelfTest((step) => seen.push(step.name));
    assert.deepEqual(steps.map((step) => [step.name, step.pass, step.requests]), [
      ['Create a participant item', true, 3], // the list's item type, the write token, the create
      ['Update it with one write, no read', true, 1],
      ['Read it back by TrackId', true, 1],
      ['A second create with the same AppId is refused', true, 1],
      ['List the session with one query', true, 1],
      ['Two reads in one request ($batch)', true, 1],
      ['Delete everything it made', true, 3],
    ]);
    assert.deepEqual(seen, steps.map((step) => step.name));
    assert.equal(fake.lists.get('responses').length, 0, 'nothing is left behind');
  });

  // ---- Phase 9b (G): what this tenant does with a Yes/No filter and with a long $filter, found by reading and reporting only ----------------
  // The Used column is filtered as `Used eq 'false'` by everything that looks for codes nobody scanned (End session, Go live, disabling a guest), and the
  // mock only compares strings; and a few reads send many ids in one address. Neither has been seen on the real tenant, so the self-test (test site only)
  // asks it: three spellings of the Yes/No filter on a small read, and a $filter that grows from 1,000 to 4,000 characters on the one-item AppSettings list.
  // They never write, never fail the self-test, and are not run on the local server.
  describe('Phase 9b (G): the self-test\'s two read-only probes of the tenant', () => {
    // (The Setup page hands the self-test these two as extra steps: lib/setup/setup-checks.js, which the participant page does not carry.)
    const run = async (arrange = () => {}) => {
      const fake = createSharePointFake();
      fake.install();
      ds.configure({ sharePoint: fake.settings });
      arrange(fake);
      const steps = await ds.runParticipantSelfTest(() => {}, selfTestProbes(ds.probeSharePointRead));
      return { fake, steps, yesNo: steps.find((step) => step.name === PROBE_YESNO), length: steps.find((step) => step.name === PROBE_LENGTH) };
    };

    it('they come after the batch step and before the clean-up, as steps of the same run: 9 steps, 20 requests', async () => {
      const { steps } = await run();
      assert.deepEqual(steps.map((step) => [step.name, step.pass, step.requests]), [
        ['Create a participant item', true, 3], ['Update it with one write, no read', true, 1], ['Read it back by TrackId', true, 1],
        ['A second create with the same AppId is refused', true, 1], ['List the session with one query', true, 1], ['Two reads in one request ($batch)', true, 1],
        [PROBE_YESNO, true, 3], [PROBE_LENGTH, true, 6], ['Delete everything it made', true, 3],
      ]);
      assert.equal(steps.reduce((sum, step) => sum + step.requests, 0), 20);
    });

    it('a site that accepts everything says so: all three spellings, and the longest filter it was asked, with the length of the address', async () => {
      const { yesNo, length } = await run();
      assert.equal(yesNo.pass, true);
      assert.match(yesNo.detail, /Used eq 'false': accepted/);
      assert.match(yesNo.detail, /Used eq 0: accepted/);
      assert.match(yesNo.detail, /Used eq false: accepted/);
      assert.doesNotMatch(yesNo.detail, /refused/);
      assert.equal(length.pass, true);
      assert.match(length.detail, /accepted a \$filter of up to 4,0\d\d characters/);
      assert.match(length.detail, /the six lengths 1,000 to 4,000 were all accepted/);
    });

    it('a site that refuses a spelling or a long filter says which, with what it answered, and the longest it did accept', async () => {
      const { yesNo, length, steps } = await run((fake) => {
        fake.failNext({ status: 400, times: 99, message: 'The expression "Used eq 0" is not valid.', when: (entry) => entry.list === 'qrtokens' && /Used eq 0/.test(entry.query) });
        fake.failNext({ status: 400, times: 99, message: 'The expression "Used eq false" is not valid.', when: (entry) => entry.list === 'qrtokens' && /Used eq false/.test(entry.query) });
        fake.failNext({ status: 400, times: 99, message: 'The URL is too long.', when: (entry) => entry.list === 'appsettings' && entry.url.length > 2_300 });
      });
      assert.match(yesNo.detail, /Used eq 'false': accepted/);
      assert.match(yesNo.detail, /Used eq 0: refused \(400: The expression "Used eq 0" is not valid\.\)/);
      assert.match(yesNo.detail, /Used eq false: refused \(400: The expression "Used eq false" is not valid\.\)/);
      assert.match(length.detail, /accepted a \$filter of up to 2,0\d\d characters/);
      assert.match(length.detail, /refused one of 2,5\d\d \(400: The URL is too long\.\)/);
      assert.equal(yesNo.pass && length.pass, true, 'a probe only reports');
      assert.ok(steps.every((step) => step.pass), 'and the self-test still passes');
      assert.equal(length.requests, 4, 'it stops at the first refusal (1,000, 1,500 and 2,000 accepted, 2,500 refused)');
    });

    it('whatever the site answers, it says that nothing depends on it: the app does not filter on a Yes/No column (Phase 10c-2a)', async () => {
      const NOTHING = /The app does not filter on a Yes\/No column \(it reads a session's codes and tests them itself\), so nothing depends on these answers\.$/;
      assert.match((await run()).yesNo.detail, NOTHING);
      const { yesNo } = await run((fake) => fake.failNext({ status: 400, times: 99, message: 'Cannot convert.', when: (entry) => entry.list === 'qrtokens' && /Used eq 'false'/.test(entry.query) }));
      assert.match(yesNo.detail, /Used eq 'false': refused \(400: Cannot convert\.\)/);
      assert.match(yesNo.detail, NOTHING);
      assert.doesNotMatch(yesNo.detail, /will fail on this site|what the app sends/);
      assert.equal(yesNo.pass, true);
    });

    it('only reads: not one write goes to any list but the self-test\'s own Responses item, and QRTokens and AppSettings are only read', async () => {
      const { fake } = await run();
      const others = fake.requests.flatMap((entry) => [entry, ...(entry.parts ?? [])]).filter((entry) => ['qrtokens', 'appsettings'].includes(entry.list));
      assert.ok(others.length >= 9, 'the three and the six reads');
      assert.ok(others.every((entry) => entry.method === 'GET'));
      assert.deepEqual([fake.lists.get('qrtokens').length, fake.lists.get('appsettings').map((row) => row.AppId)], [0, ['default']], 'and nothing was created there (the one item is the one Setup made)');
    });

    it('is not run on the local server, which has neither (the steps are only run on SharePoint, and the question refuses to be asked there)', async () => {
      useLocal();
      const steps = await ds.runParticipantSelfTest(() => {}, selfTestProbes(ds.probeSharePointRead));
      assert.equal(steps.some((step) => /^Probe/.test(step.name)), false);
      assert.ok(steps.every((step) => step.pass));
      await assert.rejects(ds.probeSharePointRead('qrtokens', '$top=1'), /SharePoint mode is not enabled/);
    });

    it('a question that cannot be asked is an answer, not an error: it never throws, whatever the site does', async () => {
      const { fake } = await run();
      fake.failNext({ status: 503, times: 99, when: (entry) => entry.list === 'qrtokens' });
      const answer = await ds.probeSharePointRead('qrtokens', '$top=1');
      assert.equal(answer.ok, false);
      assert.match(answer.message, /\S/);
    });
  });

  it('fails, and still cleans up, when AppId does not enforce unique values', async () => {
    const fake = createSharePointFake();
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    fake.fields.get('responses').find((field) => field.InternalName === 'AppId').EnforceUniqueValues = false;
    const steps = await ds.runParticipantSelfTest();
    const duplicate = steps.find((step) => step.name.startsWith('A second create'));
    assert.equal(duplicate.pass, false);
    assert.match(duplicate.detail, /Enforce unique values/);
    assert.equal(steps.find((step) => step.name.startsWith('Read it back')).pass, true);
    assert.equal(steps.find((step) => step.name.includes('$batch')).pass, true, 'the batch step checks the batch, not the duplicate');
    assert.equal(steps.at(-1).pass, true);
    assert.equal(fake.lists.get('responses').length, 0);
  });

  it('says so when the site does not answer $batch, and what that costs, without failing the rest', async () => {
    const fake = createSharePointFake();
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    fake.failNext({ status: 400, times: 99, message: 'Batch is not enabled.', when: (entry) => entry.path.endsWith('/$batch') });
    const steps = await ds.runParticipantSelfTest();
    const batch = steps.find((step) => step.name.includes('$batch'));
    assert.equal(batch.pass, false);
    // Phase 10c-2a, G: the setting is "batch": false in pms-config.txt (Phase 10b). The sentence still named public/config.js, a file
    // that left with the legacy pages, so whoever read it was sent to a file that does not exist.
    assert.match(batch.detail, /refused the batch request \(400\).*a QR scan costs 13 requests instead of 8 \(set "batch": false in pms-config\.txt\), and still works/);
    assert.doesNotMatch(batch.detail, /public\/config/);
    assert.deepEqual(steps.filter((step) => step !== batch).map((step) => step.pass), [true, true, true, true, true, true]);
    assert.equal(fake.lists.get('responses').length, 0);
  });

  it('reports the step that fails when the list refuses writes, and leaves nothing behind', async () => {
    const fake = createSharePointFake();
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    fake.failNext({ status: 403, times: 99, message: 'Access denied.', when: (entry) => entry.list === 'responses' && entry.method === 'POST' });
    const steps = await ds.runParticipantSelfTest();
    assert.deepEqual(steps.map((step) => step.pass), [false, true]);
    assert.match(steps[0].detail, /Access denied/);
  });
});

// ---- The text column limit -------------------------------------------------------------------------

describe('the multi-line text limit', () => {
  const uuid = () => crypto.randomUUID();
  const at = '2026-10-11T12:00:00.000Z';
  /** The worst text there is for JSON: every character doubles when escaped. */
  const worstText = '"'.repeat(MAX_TEXT_LENGTH);

  it('an open-text answer is capped at 1000 characters: validated in the pager, capped at the door, refused by the adapter', async () => {
    assert.equal(MAX_TEXT_LENGTH, 1000);
    assert.equal(ds.MAX_ANSWER_TEXT, 1000);
    const { fake, session } = await liveSharePoint();
    const track = await newVisit(session.id);
    const fields = { trackId: track.id, sessionId: session.id, clientId: 'c-kroger' };
    await assert.rejects(ds.saveParticipantResponses({ ...fields, responses: [answer('q-open-feedback', 'x'.repeat(1001))] }), { code: 'answer-too-long' });
    assert.equal(fake.lists.get('responses').length, 0);
    // The store never lets one through: a longer text is cut to the limit before it is kept.
    const { store } = testStore();
    await store.restore(visitOf(track), null);
    store.record(visitOf(track), 'sec-open-feedback', answer('q-open-feedback', 'y'.repeat(5000)));
    await store.flush(visitOf(track), 'sec-open-feedback');
    assert.equal(JSON.parse(fake.item('responses', track.id).ResponsesJson)[0].answer.length, 1000);
  });

  it('the largest realistic record fits the column with room to spare', async () => {
    // Far beyond any planned event: 40 questions, of which 5 are open text filled to the limit with
    // the worst possible characters, 10 are six-way rankings and 25 are choices, all with UUID ids.
    const responses = [];
    for (let index = 0; index < 5; index += 1) responses.push({ questionId: uuid(), answer: worstText, firstAnswer: worstText, attempts: 1, correct: null, answeredAt: at });
    for (let index = 0; index < 10; index += 1) {
      const ranking = Array.from({ length: 6 }, uuid);
      responses.push({ questionId: uuid(), answer: ranking, firstAnswer: ranking, attempts: 1, correct: null, answeredAt: at });
    }
    for (let index = 0; index < 25; index += 1) responses.push({ questionId: uuid(), answer: uuid(), firstAnswer: uuid(), attempts: 2, correct: false, answeredAt: at });
    const size = JSON.stringify(responses).length;
    assert.ok(size < ds.MAX_RESPONSES_JSON, `${size} characters; the adapter refuses more than ${ds.MAX_RESPONSES_JSON}`);
    assert.ok(ds.MAX_RESPONSES_JSON < 63_999, 'and the adapter stops short of what a SharePoint multi-line plain-text column holds');
    measured.push(['characters in the largest realistic record (limit 60,000; column 63,999)', size, null]);

    const { fake, session } = await liveSharePoint();
    await ds.saveParticipantResponses({ trackId: 'track-big', sessionId: session.id, clientId: 'c-kroger', responses });
    assert.equal(fake.item('responses', 'track-big').ResponsesJson.length, size);
    assert.equal((await ds.getParticipantResponses('track-big')).responses.length, 40);

    // The seeded clients themselves are tiny by comparison.
    const pack = samplePack();
    const kroger = pack.questions.map((question) => ({ questionId: question.id, answer: question.optionIds[0], firstAnswer: question.optionIds[1], attempts: 2, correct: false, answeredAt: at }));
    assert.ok(JSON.stringify(kroger).length < 3000);
  });

  it('a record that would not fit is refused whole, with a reason, instead of being cut off', async () => {
    const { fake, session } = await liveSharePoint();
    const responses = Array.from({ length: 16 }, () => ({ questionId: uuid(), answer: worstText, firstAnswer: worstText, attempts: 1, correct: null, answeredAt: at }));
    await assert.rejects(ds.saveParticipantResponses({ trackId: 'track-huge', sessionId: session.id, clientId: 'c-kroger', responses }), { code: 'responses-too-large' });
    assert.equal(fake.count({ method: 'POST', list: 'responses' }), 0);
  });
});

// ---- The pager rule the storage relies on ----------------------------------------------------------

describe('a stored record alone says whether its question is settled', () => {
  it('for every sequence of picks, isRecordSettled(record) agrees with the pager', () => {
    assert.equal(MAX_WRONG_TRIES, 2, 'isRecordSettled depends on this; revisit it if the number of tries changes');
    const question = { id: 'q', prompt: '', type: 'single-select', options: ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id, correct: id === 'b' })) };
    let checked = 0;
    const walk = (state) => {
      for (const option of question.options) {
        const next = chooseGraded(question, state, option.id);
        const record = gradedRecord(question, next);
        const resolved = next.phase === 'correct' || next.phase === 'revealed';
        assert.equal(isRecordSettled(record), resolved, JSON.stringify(record));
        assert.deepEqual(gradedStateFromRecord(question, record), next, 'and the record rebuilds the state it came from');
        checked += 1;
        if (!resolved) walk(retryGraded(next));
      }
    };
    walk(startGraded());
    assert.equal(checked, 4 + 3 * 4);
    assert.equal(isRecordSettled({ correct: null, attempts: 1 }), true, 'an ungraded answer is always final');
  });
});

// ---- Source guards -------------------------------------------------------------------------------

describe('the boundaries this phase relies on', () => {
  const source = (...parts) => readFile(path.join(ROOT, ...parts), 'utf8');
  async function sourceFiles(dir) {
    const found = [];
    for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
      const relative = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...await sourceFiles(relative));
      else if (/\.(svelte|ts|js)$/.test(entry.name)) found.push(relative);
    }
    return found;
  }

  // Everything migration/src/lib/data/dataService.js exports. Until Phase 10c-1 the legacy app was built from the same file, so nothing could be taken
  // out of it and this test held that it only grew. The legacy app left the branch, that rule went with it, and so did the 16 exports that
  // only the legacy pages, or nothing, called (GONE, the first three lines). Phase 10c-2a took out the seven that only tests called;
  // setCurrentTrack, which set a value only one of those seven read; and restartClientTrack, which cleared a session's shared answer
  // item and so had nothing left to do that its one caller, restartParticipantTrack, does not do; and getTheme and updateTheme, with the
  // ThemeConfig list (the last line). Phase 10j added one, prepareWrites (what the participant page's writes will ask for, fetched ahead).
  // The list is pinned whole, so an export cannot appear or disappear without this test being edited on purpose: all of this file is in the
  // participant page.
  const EXPORTS = [
    'COPY_SEPARATOR', 'MAX_ANSWER_TEXT', 'MAX_RESPONSES_JSON', 'activateClient', 'activateSession', 'addAdminUser', 'addGuests', 'addSectionsToLiveSession',
    'beginVisit', 'checkSession', 'checkSharePointLists', 'checkSharePointSchema', 'configure', 'copyActivities',
    'copyIdFor', 'copyTitle', 'createClient', 'createOption', 'createQuestion', 'createSection', 'createSession', 'createVisitor', 'deleteActivity', 'deleteByKey',
    'deleteClient', 'deleteOption', 'deleteParticipantResponses', 'deleteQuestion', 'deleteSession', 'duplicateActivity',
    'endSession', 'findOpenSession', 'getAppSettings', 'getClient', 'getClientActivities', 'getClientTrack', 'getCurrentUser', 'getLanUrls',
    'getLiveExperience', 'getOption', 'getParticipantResponses', 'getQrToken', 'getQuestion', 'getSection', 'getSectionContent',
    'getSectionQuestions', 'getSession', 'getSessionActivities', 'getVisitor',
    'guestNameKey', 'isSharePointMode', 'isUnreachable', 'lastAnswerAt', 'listAdminUsers', 'listClientSections',
    'listClientTracks', 'listClients', 'listItemKeys', 'listOptions', 'listQrTokens', 'listQuestions', 'listSections', 'listSessionParticipants', 'listSessions',
    'mergeAnswerRecords', 'noteTrackResumed', 'onSessionChange', 'openQrScan', 'planCopy', 'prepareWrites', 'probeSharePointRead',
    'provisionGuestCodes', 'provisionQrToken', 'qrTokenFromSearch', 'qrTokenStatus', 'qrUrl', 'readActivityContent', 'readLists', 'readLiveFeed',
    'readParticipantWatch', 'readSessionResponses', 'readSessionResponsesChecked', 'recordParticipantVisit', 'recordUserVisit', 'removeClientAsset',
    'removeEmptyVisit', 'reopenSession', 'requireConfiguration', 'responseOwner', 'restartParticipantTrack',
    'resumeClientTrack', 'runPaced', 'runParticipantSelfTest', 'saveParticipantResponses', 'sendToSharePoint', 'sessionEvidence', 'sessionIdFor',
    'setSessionParticipationMode', 'setSessionRenewer', 'setVisitorEnabled', 'sharePointListTitles', 'slugify', 'updateAppSettings', 'updateClient', 'updateClientWith', 'updateOption',
    'updateQrToken', 'updateQuestion', 'updateSection', 'updateSession', 'updateVisitor', 'uploadClientAsset',
    // (Prompt 21: roles and access.)
    'addAccessRecord', 'listAccessRecords', 'readAccessRows', 'readSignedInPerson', 'setAccessGuard',
    // (Prompt 21, Phase 2: the people screens' three, lib/data/access-people.js.)
    'removeAccessRecord', 'searchDirectory', 'updateAccessRecord',
    // (Prompt 21, Phase 3: sessions planned ahead, lib/data/planning.js.)
    'planSession', 'startSession',
    // (Prompt 21, Phase 5: the sessions' summaries, lib/data/summaries.js.)
    'readSessionSummaries', 'saveSessionSummary',
  ].sort();
  // The seven that no page called, and which tests of the pages used as set-up or as a reference until those tests were given the calls the
  // pages use (DROPS-10C2A.md, part 3, in git history at 7347c72).
  const SEVEN = ['claimQrToken', 'getSessionResponses', 'getSessionResults', 'joinSession', 'listUserVisitLogs', 'listVisitorRoster', 'saveResponse'];
  const GONE = [
    'assignActivitiesToClient', 'assignUnownedSections', 'createAdminUser', 'createQrToken', 'deleteAdminUser', 'deleteQrToken', 'deleteSection',
    'deleteVisitor', 'getActiveSessionContext', 'getAdminUser', 'getCurrentTrack', 'requestCount', 'saveResponses', 'setActiveSession',
    'updateAdminUser', 'uploadClientLogo',
    ...SEVEN, 'setCurrentTrack', 'restartClientTrack', 'getTheme', 'updateTheme',
    // Phase 10c-2b: the added columns, with their types in words, are pms-schema-meta.js's (Setup's); the data layer knows no type's words.
    'addedSharePointColumns',
    // Phase 10c-2b, G: no page called it (Results removes an empty visit with removeEmptyVisit, which never touches a QR code).
    'deleteClientTrack',
    // Phase 10c-3, E: Setup's alone, now migration/src/lib/setup/setup-import.js (and it brings no admins).
    'importSharePointSeed',
  ];

  it('dataService exports exactly what is listed here; what only the legacy pages, only tests, or nothing called is gone', () => {
    assert.deepEqual(Object.keys(ds).sort(), EXPORTS);
    // (Phase 10c-3: sendToSharePoint, the Setup page's one way to write to the site itself, for lib/setup/provision.js, and addAdminUser came; the seed-file
    // import, Setup's alone, went to migration/src/lib/setup/setup-import.js. Still 103. Phase 10j: prepareWrites, 104. Phase 15: updateClientWith, 105. Phase 16: listItemKeys and deleteByKey, for
    // lib/admin/session-delete.js, 107. Prompt 19: the page's SharePoint sign-in (lib/data/session-calls.js), setSessionRenewer, onSessionChange,
    // sessionEvidence, lastAnswerAt and checkSession, 112. Prompt 21: setAccessGuard and lib/data/access-reads.js's four, 117; Phase 2: three of lib/data/access-people.js, 120; Phase 3: planSession and startSession, lib/data/planning.js, 122; Phase 5: readSessionSummaries and saveSessionSummary, lib/data/summaries.js, 124.)
    assert.equal(EXPORTS.length, 124);
    assert.equal(GONE.length, 30);
    for (const name of GONE) assert.ok(!(name in ds), `${name} is back`);
  });

  it('nothing calls the seven exports that only tests had kept: no page, no shared module, no test and no helper', async () => {
    // (A call on the data service, under any of the names a file gives it. The admin's own getSessionResults is lib/admin/adminData.ts's, a
    // different function, and is called without a prefix.)
    const called = new RegExp(`\\b(?:dataService|api|ds|service|page|device)\\.(?:${SEVEN.join('|')})\\(`);
    const callers = [];
    for (const file of [...await sourceFiles(path.join('migration', 'src')), ...await sourceFiles('scripts')]) {
      const code = (await source(file)).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      if (called.test(code)) callers.push(file.split(path.sep).join('/'));
    }
    assert.deepEqual(callers, []);
    // (Written in two pieces, so that this file is not itself a caller.)
    assert.match(['ds', 'joinSession('].join('.'), called, 'the pattern does find a call');
    assert.doesNotMatch('getSessionResults(', called, 'and not the admin\'s own function of that name');
  });

  it('answers are saved through participantData and nowhere else in the Svelte app', async () => {
    const offenders = [];
    for (const file of await sourceFiles('migration/src')) {
      const text = (await source(file)).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      const name = file.split(path.sep).join('/');
      const isDoor = name.endsWith('lib/participant/participantData.ts');
      const isStore = name.endsWith('lib/participant/answer-store.js');
      // The boot sequence reads the visit's item (alongside its other reads) and hands it to participantData; it never writes.
      const isBoot = name.endsWith('lib/participant/boot.js');
      // The data layer is where the saves go (it was in public/js, outside this check, until Phase 14).
      if (name.includes('lib/data/')) continue;
      if (!isDoor && /from ['"][^'"]*answer-store(\.js)?['"]/.test(text)) offenders.push(`${name} imports the answer store`);
      if (!isDoor && !isStore && /\b(saveParticipantResponses|saveResponses?)\b/.test(text)) offenders.push(`${name} writes answers itself`);
      if (!isDoor && !isStore && !isBoot && /\bgetParticipantResponses\b/.test(text)) offenders.push(`${name} reads answers itself`);
      // The older reader sees the session's shared item only; every reader of results uses readSessionResponses.
      if (/\bgetSessionResponses\b/.test(text)) offenders.push(`${name} uses the older reader`);
    }
    assert.deepEqual(offenders, []);
    // Since Phase 9b the admin reads answers through readSessionResponsesChecked(): readSessionResponses() that names a damaged item instead of stopping.
    assert.match(await source('migration/src/lib/admin/adminData.ts'), /dataService\.readSessionResponsesChecked/);
    assert.match(await source('migration/src/lib/results/session-results.js'), /\.readSessionResponsesChecked/);
    assert.match(await source('migration/src/lib/admin/adminData.ts'), /dataService\.restartParticipantTrack/);
  });

  it('only the boot sequence decides what is read before the first screen, and nothing keeps data between page loads', async () => {
    const importers = [];
    for (const file of await sourceFiles('migration/src')) {
      if (/from ['"][^'"]*\/boot(\.js)?['"]/.test(await source(file))) importers.push(file.split(path.sep).join('/'));
    }
    assert.deepEqual(importers, ['migration/src/App.svelte']);
    // No data cache. Browser storage holds only: answers not saved yet, this tab's visit-log id and
    // "already logged" mark, and the sound choice. No client, session, activity or theme is kept.
    const users = [];
    const keys = new Set();
    for (const file of await sourceFiles('migration/src')) {
      const text = await source(file);
      if (/\b(?:local|session)Storage\b/.test(text)) users.push(file.split(path.sep).join('/'));
      for (const match of text.matchAll(/['"`]((?:cec-[a-z-]+:)|(?:pms\.[a-z]+))/g)) keys.add(match[1]);
    }
    // Phase 15: lib/motion/motion.ts keeps, for this tab's session only, how much this device may move (`pms.motion`, the governor's step and
    // `?motion=off`): a fact about the device, like the sound choice, never a client, a session, an activity or a theme.
    assert.deepEqual(users.sort(), ['migration/src/App.svelte', 'migration/src/lib/effects/effects.ts', 'migration/src/lib/motion/motion.ts', 'migration/src/lib/participant/answer-store.js', 'migration/src/lib/participant/participantData.ts']);
    // Phase 20: lib/participant/participantData.ts keeps, for this tab only, the card picked on a confidence check screen and not yet confirmed
    // (`cec-check-pick:`), so a reload shows it picked: an answer not given yet, like the answers not saved yet, never a client or a session.
    assert.deepEqual([...keys].sort(), ['cec-answers:', 'cec-check-pick:', 'cec-visit-id:', 'cec-visit-logged:', 'pms.motion', 'pms.sound']);
    for (const file of ['participant/boot.js', 'participant/experience.svelte.ts', 'brand/client-theme.js']) {
      assert.doesNotMatch(await source('migration/src/lib', file), /Storage\b|indexedDB|caches\./, `${file} keeps nothing`);
    }
  });

  it('the finale offers Start over to testers only', async () => {
    const finale = await source('migration/src/routes/ThankYou.svelte');
    assert.match(finale, /\{#if debug( && !preview)?\}<PillButton[^>]*onclick=\{startOver\}>Start over<\/PillButton>\{\/if\}/);
    assert.match(finale, /get\('debug'\) === '1'/);
  });
});

// ---- Phase 9a: "Click here to begin" -------------------------------------------------------------------
// The legacy pages' own way in made a new track every call and then had to write the session. A press whose reply was lost, pressed
// again, left a second visit that the results count as a participant who answered nothing; and on a site where participants may only
// read Sessions (which is what the runbook's permission list said) nobody could begin at all, each press leaving one more.
// beginVisit() is the participant page's own: the caller's id, and the session write tried, not required. (Until Phase 10c-2a these
// tests held it to the legacy function, which is gone; what it makes and what it refuses are now written out here.)

describe('beginVisit: one visit however often it is pressed, and no need to write the session', () => {
  const tracksOf = async (sessionId) => (await ds.listClientTracks(sessionId)).length;

  for (const adapter of ['SharePoint', 'the local server']) {
    const open = async (date) => {
      let fake = null;
      if (adapter === 'SharePoint') {
        fake = createSharePointFake();
        fake.install();
        ds.configure({ sharePoint: fake.settings });
        await seedPack(ds, samplePack());
      } else useLocal();
      const { session } = await ds.activateClient('c-kroger', date);
      return { fake, session };
    };

    it(`${adapter}: the visit it makes is a manual visit of that account in that session, with the id it was given`, async () => {
      const { session } = await open('2026-12-01');
      const id = crypto.randomUUID();
      const track = await ds.beginVisit(id, session.id, 'c-kroger', { sharePointUserId: '42' });
      const expected = {
        id, sessionId: session.id, clientId: 'c-kroger', joinedVia: 'manual', qrTokenId: null, visitorId: null, participantName: null,
        sharePointUserId: '42', resumeCount: 0, lastResumedAt: null, restartedAt: null, restartSectionId: null, createdAt: 'a time',
      };
      const plain = ({ createdAt, ...rest }) => ({ ...rest, createdAt: Number.isNaN(Date.parse(createdAt)) ? createdAt : 'a time' });
      assert.deepEqual(plain(track), expected);
      assert.deepEqual(plain(await ds.getClientTrack(id)), expected, 'and so is what was stored');
      assert.equal((await ds.getSession(session.id)).status, 'in-progress', 'the first visit moves the session on');
    });

    it(`${adapter}: pressed again with the same id, it finds the visit it made and makes no other`, async () => {
      const { session } = await open('2026-12-02');
      const id = crypto.randomUUID();
      const first = await ds.beginVisit(id, session.id, 'c-kroger', { sharePointUserId: '42' });
      const second = await ds.beginVisit(id, session.id, 'c-kroger', { sharePointUserId: '42' });
      assert.equal(second.id, first.id);
      assert.equal(second.createdAt, first.createdAt, 'the same record, not a new one');
      assert.equal(await tracksOf(session.id), 1);
    });

    it(`${adapter}: it refuses with these codes and these words, and writes nothing`, async () => {
      const { session } = await open('2026-12-03');
      const said = async (sessionId) => { try { await ds.beginVisit(crypto.randomUUID(), sessionId, 'c-kroger'); return null; } catch (error) { return [error.code, error.message]; } };
      // Guests only: a visit needs a personal code.
      await ds.setSessionParticipationMode(session.id, 'client-visit');
      assert.deepEqual(await said(session.id), ['visitor-required', 'Scan the visitor QR code provided by your facilitator.']);
      await ds.setSessionParticipationMode(session.id, 'staff');
      // Ended.
      await ds.endSession(session.id);
      assert.deepEqual(await said(session.id), ['session-ended', 'This session has ended.']);
      await ds.reopenSession(session.id);
      // Something else is live now.
      const other = await ds.activateClient('c-dominos', '2026-12-03');
      assert.deepEqual(await said(session.id), ['session-not-active', 'Your facilitator changed the active session. Ask them for the current check-in link.']);
      // No such session.
      await ds.updateAppSettings({ activeSessionId: 'no-such-session' });
      assert.deepEqual(await said('no-such-session'), ['session-missing', 'That session no longer exists.']);
      assert.equal(await tracksOf(session.id), 0);
      assert.equal(await tracksOf(other.session.id), 0);
    });
  }

  it('SharePoint: the track was written but the reply was lost (503): the next press finds it, and there is one visit', async () => {
    const { fake, session } = await liveSharePoint();
    const id = crypto.randomUUID();
    // The server applies the create and then answers 503: beforeCreate runs inside the fake, so the row is there when the fault is returned.
    let applied = false;
    const realFetch9a = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const response = await realFetch9a(url, options);
      if (!applied && (options.method ?? 'GET') === 'POST' && new RegExp(`${TITLE.tracks}'\\)\\/items$`).test(decodeURIComponent(String(url)))) {
        applied = true;
        return new Response(JSON.stringify({ error: { message: { value: 'The server is busy.' } } }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      return response;
    };
    try {
      await assert.rejects(ds.beginVisit(id, session.id, 'c-kroger', { sharePointUserId: '42' }), (error) => error.status === 503);
      assert.equal(fake.lists.get('tracks').length, 1, 'the visit is there although the page was told it failed');
      const track = await ds.beginVisit(id, session.id, 'c-kroger', { sharePointUserId: '42' });
      assert.equal(track.id, id);
      assert.equal(fake.lists.get('tracks').length, 1, 'a press with a new id each time would have made a second');
    } finally { globalThis.fetch = realFetch9a; }
  });

  it('SharePoint: where participants may not write Sessions, everyone still gets in, each with one visit', async () => {
    const { fake, session } = await liveSharePoint();
    fake.failNext({ status: 403, times: 99, message: 'Access denied. You do not have permission to perform this action or access this resource.', when: (entry) => entry.list === 'sessions' && entry.method !== 'GET' });
    const warn = console.warn;
    const warned = [];
    console.warn = (...parts) => { warned.push(parts.join(' ')); };
    try {
      for (let person = 0; person < 3; person += 1) {
        const page = await freshPage({ sharePoint: fake.settings });
        const track = await page.beginVisit(crypto.randomUUID(), session.id, 'c-kroger', { sharePointUserId: String(100 + person) });
        assert.equal(track.sessionId, session.id);
      }
    } finally { console.warn = warn; fake.clearFaults(); }
    assert.equal(fake.lists.get('tracks').length, 3, 'three people, three visits (when the session write was required: three errors and three orphans)');
    assert.equal(fake.item('sessions', session.id).Status, 'not-started', 'the session could not be moved on, and nothing depends on that');
    assert.ok(warned.some((line) => /Could not mark the session as in progress/.test(line)));
  });

  it('a visit id that is somebody else’s visit in another session is not handed over', async () => {
    const { session } = await liveSharePoint();
    const other = await newVisit(session.id);
    const { session: later } = await ds.activateClient('c-dominos', DAY);
    await assert.rejects(ds.beginVisit(other.id, later.id, 'c-dominos'), (error) => error.status === 409);
  });

  it('Welcome begins a visit with beginVisit, with the id kept for that session until the visit is known to have begun', async () => {
    const welcome = await readFile(path.join(ROOT, 'migration', 'src', 'routes', 'Welcome.svelte'), 'utf8');
    assert.match(welcome, /dataService\.beginVisit\(visitIdFor\(live\.id\), live\.id, live\.clientId, \{/);
    assert.match(welcome, /if \(!trackId && live\) visitBegun\(live\.id\);/);
    assert.doesNotMatch(welcome, /dataService\.joinSession\(/);
  });

  it('the id: the same for a session while a try is unfinished, another session\'s is its own, and a new one once the visit has begun', async () => {
    const { newVisitId, visitBegun, visitIdFor } = await import('../migration/src/lib/participant/visit-id.js');
    const first = visitIdFor('session-a');
    assert.equal(visitIdFor('session-a'), first, 'pressed again after a lost reply: the same visit');
    assert.notEqual(visitIdFor('session-b'), first, 'the facilitator went live with something else meanwhile: never the other session\'s id');
    visitBegun('session-a');
    assert.notEqual(visitIdFor('session-a'), first, '"Start a new visit" later is a new visit, not the earlier one again');
    assert.match(first, /^[0-9a-f-]{32,36}$/);
    // Without randomUUID (plain http on the LAN): 16 random bytes as hex.
    let drawn = 0;
    const plain = newVisitId({ getRandomValues: (bytes) => { for (let index = 0; index < bytes.length; index += 1) bytes[index] = (drawn += 7) % 256; return bytes; } });
    assert.match(plain, /^[0-9a-f]{32}$/);
  });

  it('SharePoint: a visit left by a lost reply in one session is not what begins a visit in the next (each session has its own id)', async () => {
    const { visitBegun, visitIdFor } = await import('../migration/src/lib/participant/visit-id.js');
    const { session } = await liveSharePoint();
    const stale = visitIdFor(session.id);
    await ds.beginVisit(stale, session.id, 'c-kroger'); // made; the page never heard, so the id is still held
    const { session: next } = await ds.activateClient('c-dominos', DAY);
    const track = await ds.beginVisit(visitIdFor(next.id), next.id, 'c-dominos');
    assert.equal(track.sessionId, next.id);
    assert.notEqual(track.id, stale);
    visitBegun(session.id);
    visitBegun(next.id);
  });
});

// ---- Phase 9a: a scan that was cut off leaves no visit behind ------------------------------------------
// A device writes its track, then claims the code. If the connection drops in between and the page is then loaded afresh (the
// guest scans again from the camera, which opens a new page with nothing in memory), the first track was left for good: the
// results counted "Guest One" twice, once as someone who answered nothing, and the admin has no way to remove a visit.

describe('openQrScan: the device that gets the code removes what an earlier, cut-off try of that code left', () => {
  for (const adapter of ['SharePoint', 'the local server']) {
    it(`${adapter}: a claim that never arrived, then a fresh page: one visit, the second one`, async () => {
      let fake = null;
      let settings;
      if (adapter === 'SharePoint') {
        ({ fake } = await liveSharePoint());
        settings = { sharePoint: fake.settings };
      } else {
        useLocal();
        await ds.activateClient('c-kroger', '2026-12-10');
        settings = { baseUrl: localBase };
      }
      const session = (await ds.getLiveExperience()).session;
      const [token] = await visitorCodes(session, 1);
      const before = (await ds.listClientTracks(session.id)).length;

      // The first page writes its track; then every request about the code fails (the claim, and the look at whose it is).
      const first = await freshPage(settings);
      const scan = await first.openQrScan(token.id);
      const real = globalThis.fetch;
      globalThis.fetch = async (url, options) => {
        if (new RegExp(`/qrtokens|getbytitle\\('${SUITE_PREFIX}${TITLE.qrtokens}'\\)`, 'i').test(decodeURIComponent(String(url)))) throw new TypeError('Load failed');
        return real(url, options);
      };
      try { await assert.rejects(scan.claim(), TypeError); } finally { globalThis.fetch = real; }
      assert.equal((await ds.listClientTracks(session.id)).length, before + 1, 'the cut-off try left its track');
      assert.equal((await ds.getQrToken(token.id)).used, false, 'and the code is still free');

      // The guest scans again: a new page, which knows nothing of the first.
      const second = await freshPage(settings);
      const again = await second.openQrScan(token.id);
      assert.equal(again.failure, null);
      const track = await again.claim();
      const tracks = (await ds.listClientTracks(session.id)).filter((entry) => entry.qrTokenId === token.id);
      assert.deepEqual(tracks.map((entry) => entry.id), [track.id], 'one visit for the guest, not two');
      assert.equal((await ds.getQrToken(token.id)).clientTrackId, track.id);
    });
  }

  it('SharePoint: it costs no request where the site can batch, and a look for earlier tries that fails never stops a scan', async () => {
    const { fake, session } = await liveSharePoint();
    const [one, two] = await visitorCodes(session, 2);
    const page = await freshPage({ sharePoint: fake.settings });
    fake.reset();
    const scan = await page.openQrScan(one.id);
    await scan.claim();
    assert.ok(fake.count() <= 9, `a first scan took ${fake.count()} requests`);
    const batch = fake.requests.find((entry) => entry.parts);
    assert.ok(batch.parts.some((part) => part.list === 'tracks' && /QrTokenId eq/.test(part.query)), 'the look for earlier tries rides in the one batch');
    // The look fails, in the batch and alone: the scan goes through all the same.
    const other = await freshPage({ sharePoint: fake.settings });
    fake.failNext({ status: 500, times: 9, when: (entry) => entry.list === 'tracks' && entry.method === 'GET' && /QrTokenId eq/.test(entry.query) });
    const second = await other.openQrScan(two.id);
    const track = await second.claim();
    fake.clearFaults();
    assert.equal(track.qrTokenId, two.id);
  });

  it('SharePoint: five devices on one code at once still end with one visit, and nobody removes the winner’s', async () => {
    const { fake, session } = await liveSharePoint();
    const [token] = await visitorCodes(session, 1);
    const pages = await Promise.all(Array.from({ length: 5 }, () => freshPage({ sharePoint: fake.settings })));
    // Staggered, so that later devices see earlier ones' tracks as "earlier tries" while those are still claiming.
    const outcomes = await Promise.all(pages.map(async (page, index) => {
      await new Promise((resolve) => { setTimeout(resolve, index * 2); });
      try { const scan = await page.openQrScan(token.id); return scan.failure ? scan.failure.code : (await scan.claim()).id; } catch (error) { return error.code ?? String(error); }
    }));
    const winners = outcomes.filter((outcome) => !/^token-/.test(outcome));
    assert.equal(winners.length, 1, outcomes.join(', '));
    const tracks = fake.lists.get('tracks').filter((row) => row.QrTokenId === token.id);
    assert.deepEqual(tracks.map((row) => row.AppId), winners, 'exactly the winner’s track is left');
    assert.equal(fake.item('qrtokens', token.id).ClientTrackId, winners[0]);
  });
});

// ---- Phase 9b (DI-6): one damaged answer item must not stop the rest -------------------------------------------------------
// A Responses item whose ResponsesJson is not a JSON list (a hand edit, a rich-text column) used to make readSessionResponses, readLiveFeed
// and getSessionResults throw for the WHOLE session. Reading it as empty would drop a participant without a word, so the decision is:
// show the rest and say what could not be read. readSessionResponsesChecked() and readLiveFeed({ tolerant: true }) return the readable
// answers and `unreadable: [{ id, reason }]`; the readers that throw, and the participant page's own reads, are untouched.

describe('Phase 9b, DI-6: one damaged answer item does not stop the rest of a session\'s results', () => {
  const at = '2026-10-11T12:00:00.000Z';
  const good = (questionId, value) => [{ questionId, answer: value, firstAnswer: value, attempts: 1, correct: null, answeredAt: at }];
  const DAMAGE = ['{oops', '{"a":1}', '"words"', '7', 'null'];
  const sortedIds = (list) => list.map((entry) => entry.id).sort();

  /** Six visits: two with good items, then one damaged item for each kind of damage on SharePoint (four of them are enough on the local server). */
  async function visits(session) {
    const tracks = [];
    for (let index = 0; index < 2 + DAMAGE.length; index += 1) tracks.push(await newVisit(session.id));
    for (const track of tracks.slice(0, 2)) await ds.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: 'c-kroger', responses: good('q-trivia-1', 'o-trivia-1-b') });
    return tracks;
  }

  it('SharePoint: the readable answers come back, the damaged items are named with a reason, and still in ONE request', async () => {
    const { fake, session } = await liveSharePoint();
    const tracks = await visits(session);
    const damaged = tracks.slice(2);
    damaged.forEach((track, index) => fake.add('responses', { AppId: track.id, Title: track.id, TrackId: track.id, SessionId: session.id, ClientId: 'c-kroger', ResponsesJson: DAMAGE[index] }));
    fake.reset();
    const checked = await ds.readSessionResponsesChecked(session.id);
    assert.equal(fake.count(), 1, 'one indexed query for every item');
    assert.deepEqual(sorted(checked.answers.map((entry) => entry.clientTrackId)), sorted(tracks.slice(0, 2).map((track) => track.id)), 'only the readable items are counted');
    assert.deepEqual(sortedIds(checked.unreadable), sorted(damaged.map((track) => track.id)), 'exactly the damaged ones are named');
    for (const entry of checked.unreadable) assert.match(entry.reason, /^its saved answers are not (valid JSON|a list)$/);
    assert.equal(checked.unreadable.find((entry) => entry.id === damaged[0].id).reason, 'its saved answers are not valid JSON');
    assert.equal(checked.unreadable.find((entry) => entry.id === damaged[1].id).reason, 'its saved answers are not a list');
    // The reader everything else uses is as it was: a hard stop, with the item named.
    await assert.rejects(ds.readSessionResponses(session.id), /ResponsesJson (must contain a JSON array|contains invalid JSON)|contains invalid JSON/);
  });

  it('SharePoint: an item with nothing in it is an empty list, not a damaged one', async () => {
    const { fake, session } = await liveSharePoint();
    const [track] = await visits(session);
    const blank = await newVisit(session.id);
    fake.add('responses', { AppId: blank.id, Title: blank.id, TrackId: blank.id, SessionId: session.id, ClientId: 'c-kroger', ResponsesJson: '' });
    const checked = await ds.readSessionResponsesChecked(session.id);
    assert.deepEqual(checked.unreadable, []);
    assert.ok(checked.answers.some((entry) => entry.clientTrackId === track.id));
  });

  it('SharePoint: the Live display\'s feed does the same, in its one request, and only when asked to', async () => {
    const { fake, session } = await liveSharePoint();
    const tracks = await visits(session);
    fake.add('responses', { AppId: tracks[2].id, Title: tracks[2].id, TrackId: tracks[2].id, SessionId: session.id, ClientId: 'c-kroger', ResponsesJson: '{oops' });
    const sectionIds = session.sectionIds ?? [];
    fake.reset();
    const feed = await ds.readLiveFeed(session.id, { sectionIds, tolerant: true });
    assert.equal(feed.requests, 1);
    assert.deepEqual(feed.unreadable.map((entry) => entry.id), [tracks[2].id]);
    assert.equal(new Set(feed.answers.map((entry) => entry.clientTrackId)).size, 2);
    await assert.rejects(ds.readLiveFeed(session.id, { sectionIds }), /ResponsesJson|JSON/);
    const clean = await liveSharePoint();
    assert.deepEqual((await ds.readLiveFeed(clean.session.id, { sectionIds: [], tolerant: true })).unreadable, [], 'a session with nothing damaged says so');
  });

  it('SharePoint: a participant whose OWN item is damaged still cannot start, but is told in words, with a code the page can recognise', async () => {
    const { fake, session } = await liveSharePoint();
    const [track] = await visits(session);
    const item = fake.lists.get('responses').find((row) => row.AppId === track.id);
    item.ResponsesJson = '{oops';
    const failure = await ds.getParticipantResponses(track.id).then(() => null, (error) => error);
    assert.ok(failure, 'it still fails');
    assert.equal(failure.code, 'responses-unreadable');
    assert.match(failure.message, /^Your saved answers could not be read/);
    assert.doesNotMatch(failure.message, /ResponsesJson|JSON|undefined|Error:/, 'no jargon and no stack');
    assert.match(failure.message, /facilitator/);
  });

  it('the local server: the same session, the same answers and the same list of damaged items', async () => {
    useLocal();
    const { session } = await ds.activateClient('c-kroger', '2026-10-21');
    const tracks = await visits(session);
    const damaged = tracks.slice(2, 6);
    const kinds = ['garbage', { a: 1 }, 7, 'null'];
    for (const [index, track] of damaged.entries()) {
      const sent = await fetch(`${localBase}/participantresponses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: track.id, trackId: track.id, sessionId: session.id, clientId: 'c-kroger', responses: kinds[index] }) });
      assert.equal(sent.status, 201);
    }
    const checked = await ds.readSessionResponsesChecked(session.id);
    assert.deepEqual(sorted(checked.answers.map((entry) => entry.clientTrackId)), sorted(tracks.slice(0, 2).map((track) => track.id)));
    assert.deepEqual(sortedIds(checked.unreadable), sorted(damaged.map((track) => track.id)));
    assert.ok(checked.unreadable.every((entry) => entry.reason === 'its saved answers are not a list'));
    const feed = await ds.readLiveFeed(session.id, { sectionIds: [], tolerant: true });
    assert.deepEqual(sortedIds(feed.unreadable), sorted(damaged.map((track) => track.id)));
    assert.equal(new Set(feed.answers.map((entry) => entry.clientTrackId)).size, 2);
  });

  it('the tolerant reader is beside the others: the readers that throw, and the participant page\'s own reads, are the functions they were', () => {
    assert.equal(typeof ds.readSessionResponsesChecked, 'function');
    assert.equal(ds.readSessionResponses.length, 1);
    assert.equal(ds.readLiveFeed.length, 1, 'readLiveFeed keeps its one required argument');
  });
});

// ---- Phase 9b (DI-9): removing a visit that has no answers -------------------------------------------------------------------
// A visit nobody uses (a guest whose first scan was cut off, a visit made while testing) used to stay in Results and the report for ever.
// removeEmptyVisit() takes it away, and only it: it re-reads the visit's answers first and refuses if any have arrived, it refuses on an ended
// session (a past report must not change silently), it never touches the QR code (which stays used) or the roster, and it removes the visit's
// own answer item only when that item is empty.

let visitDays = 0;
for (const [name, open] of [
  ['SharePoint', () => liveSharePoint()],
  ['the local server', async () => {
    useLocal();
    const { session } = await ds.activateClient('c-kroger', `2026-11-${String(10 + (visitDays += 1)).padStart(2, '0')}`);
    return { fake: null, session };
  }],
]) {
  describe(`Phase 9b, DI-9: removeEmptyVisit, on ${name}`, () => {
    const REFUSAL = 'This visit now has answers, so it was not removed.';
    const answerOf = () => [{ questionId: 'q-trivia-1', answer: 'o-trivia-1-b', firstAnswer: 'o-trivia-1-b', attempts: 1, correct: null, answeredAt: '2026-10-11T12:00:00.000Z' }];
    const tracksOf = async (session) => (await ds.listClientTracks(session.id)).map((track) => track.id);
    const page = (fake) => (fake ? freshPage({ sharePoint: fake.settings }) : Promise.resolve(ds));
    const visit = (session) => newVisit(session.id);
    const save = (session, track, responses) => ds.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: 'c-kroger', responses });

    it('removes a visit with no answers, and nothing else: the QR code stays used, the guest stays on the roster, other visits stay', async () => {
      const { fake, session } = await open();
      const other = await visit(session); // (made before the session is switched to guests: a staff visit)
      const [token] = await visitorCodes(session, 1);
      const guest = await (await (await page(fake)).openQrScan(token.id)).claim();
      const roster = await listOf('visitorroster', session.id);
      assert.deepEqual(sorted(await tracksOf(session)), sorted([guest.id, other.id]));
      assert.equal((await ds.getQrToken(token.id)).used, true);
      assert.deepEqual(await ds.removeEmptyVisit(guest.id), { removed: true, leftovers: 0 });
      assert.deepEqual(await tracksOf(session), [other.id], 'only that visit went');
      const code = await ds.getQrToken(token.id);
      assert.equal(code.used, true, 'the code stays used: the guest needs a replacement code to start again');
      assert.equal(code.clientTrackId, guest.id, 'and it was not touched at all');
      assert.deepEqual(await listOf('visitorroster', session.id), roster, 'the roster is as it was');
      await assert.rejects(ds.removeEmptyVisit(guest.id), (error) => error.code === 'visit-missing' && /already gone/.test(error.message), 'asked twice, it says it is gone');
    });

    it('removes the visit\'s own answer item too when that item is empty, and not before the visit itself', async () => {
      const { session } = await open();
      const track = await visit(session);
      await save(session, track, []);
      assert.notEqual(await ds.getParticipantResponses(track.id), null, 'an empty item exists');
      assert.deepEqual(await ds.removeEmptyVisit(track.id), { removed: true, leftovers: 0 });
      assert.deepEqual(await tracksOf(session), []);
      assert.equal(await ds.getParticipantResponses(track.id), null, 'and it is gone');
    });

    it('re-reads the visit\'s answers first: one that arrived since the screen was drawn stops the removal, and nothing is deleted', async () => {
      const { session } = await open();
      const track = await visit(session);
      const other = await visit(session);
      await save(session, track, answerOf()); // the iPad answered a moment after Results showed "not started"
      await assert.rejects(ds.removeEmptyVisit(track.id), (error) => error.code === 'visit-has-answers' && error.message === REFUSAL);
      assert.deepEqual(sorted(await tracksOf(session)), sorted([track.id, other.id]), 'the visit is still there');
      assert.equal((await ds.getParticipantResponses(track.id)).responses.length, 1, 'and so is its answer');
    });

    it('never on an ended session: a past report must not change silently', async () => {
      const { session } = await open();
      const track = await visit(session);
      await ds.endSession(session.id);
      await assert.rejects(ds.removeEmptyVisit(track.id), (error) => error.code === 'session-ended' && /has ended/.test(error.message));
      assert.deepEqual(await tracksOf(session), [track.id], 'nothing was removed');
      await ds.reopenSession(session.id);
      assert.deepEqual(await ds.removeEmptyVisit(track.id), { removed: true, leftovers: 0 }, 'reopened, it can be');
    });

    it('a visit whose saved answers cannot be read is not "empty": it is refused, and left for the facilitator to mend', async () => {
      const { fake, session } = await open();
      const track = await visit(session);
      await save(session, track, answerOf());
      if (fake) fake.lists.get('responses').find((row) => row.AppId === track.id).ResponsesJson = '{oops';
      else await fetch(`${localBase}/participantresponses/${track.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ responses: 'oops' }) });
      await assert.rejects(ds.removeEmptyVisit(track.id), (error) => error.code === 'visit-unreadable' && /cannot be read/.test(error.message));
      assert.deepEqual(await tracksOf(session), [track.id]);
    });
  });
}

// ---- Phase 10c-2a: a session has no answer item of its own, so nothing looks for one, clears one or makes one ----------------------
// Until then a restart cleared the visit's answers in "the session's shared item" as well (AppId = the session's id), which only the
// legacy pages wrote; on SharePoint that clearing MADE the item, empty, when there was none. Removing a visit read it.

describe('Phase 10c-2a: nothing looks for a session\'s own answer item', () => {
  const forTheSession = (session) => (entry) => entry.list === 'responses' && entry.query.includes(`AppId eq '${session.id}'`);

  it('SharePoint: a restart reads the activity once, clears the participant\'s own item and stamps the visit: 9 requests on a fresh page, and no item is made for the session', async () => {
    const { fake, session } = await liveSharePoint();
    const track = await newVisit(session.id);
    await ds.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: 'c-kroger', responses: [answer('q-trivia-1', 'o-trivia-1-b', { correct: true }), answer('q-brand-1', 'o-brand-1-b', { correct: true })] });
    const page = await freshPage({ sharePoint: fake.settings });
    fake.reset();
    assert.deepEqual(await page.restartParticipantTrack(track.id, { sectionId: 'sec-trivia' }), { removed: 1 });
    // The activity; the participant's item and its overwrite (with the write token); the visit, then its update (which reads it at its
    // version, and the list's type and columns the first time a page writes to Tracks).
    assert.deepEqual(sorted(fake.requests.map(shape)), ['GET responses', 'GET sections', 'GET tracks', 'GET tracks', 'GET tracks', 'GET tracks', 'MERGE responses', 'MERGE tracks', 'POST /contextinfo']);
    measured.push(['restarting one activity of a visit (fresh page; 14 before Phase 10c-2a)', fake.count(), 9]);
    assert.equal(fake.count(forTheSession(session)), 0, 'nothing asks for an item with the session\'s id');
    assert.equal(fake.count((entry) => entry.list === 'responses' && entry.method === 'POST'), 0, 'and none is made');
    assert.deepEqual(fake.lists.get('responses').map((row) => row.AppId), [track.id], 'the list holds the participant\'s item and nothing else');
    assert.ok((await ds.getClientTrack(track.id)).restartedAt);
    fake.reset();
    assert.deepEqual(await page.restartParticipantTrack(track.id), { removed: 1 });
    assert.deepEqual(sorted(fake.requests.map(shape)), ['GET responses', 'GET tracks', 'GET tracks', 'MERGE responses', 'MERGE tracks']);
    measured.push(['restarting a visit from the beginning (the same page again; 7 before)', fake.count(), 5]);
  });

  it('SharePoint: removing a visit is five requests: the visit, its session, its own item, and the delete (six with an empty item)', async () => {
    const { fake, session } = await liveSharePoint();
    const empty = await newVisit(session.id);
    const withItem = await newVisit(session.id);
    await ds.saveParticipantResponses({ trackId: withItem.id, sessionId: session.id, clientId: 'c-kroger', responses: [] });
    fake.reset();
    await ds.removeEmptyVisit(empty.id);
    const bare = fake.count();
    fake.reset();
    await ds.removeEmptyVisit(withItem.id);
    const full = fake.count();
    assert.deepEqual([bare, full], [5, 6], `${bare} and ${full} requests`);
    assert.ok(fake.requests.every((entry) => !new RegExp(`${TITLE.qrtokens}|${TITLE.visitorroster}`).test(entry.path)), 'it never asked for a code or the roster');
    assert.equal(fake.count(forTheSession(session)), 0, 'nor for an item with the session\'s id');
    measured.push(['removing a visit with no answers (6 before Phase 10c-2a)', bare, 5], ['removing a visit that has an empty answer item (7 before)', full, 6]);
  });
});

// ---- Phase 10c-2a (F1): no request filters on a Yes/No column -------------------------------------------------------------------
// Five things retire the codes nobody scanned: disabling a guest, changing how people are identified, End session, Go live over another
// session, and making an existing session live. Each asked for them with `Used eq 'false'`: a Yes/No column compared with a quoted
// word, which only the mocked REST had ever answered (it compares text). They now read the session's codes by the indexed SessionId
// (and VisitorId for one guest) and test `used` in the browser, so nothing rests on how SharePoint compares a Yes/No column.

for (const adapter of ['SharePoint', 'the local server']) {
  it(`${adapter}: the five ways codes are retired read them by session and never filter on Used; they retire exactly the unscanned ones`, async () => {
    let fake = null;
    let session;
    if (adapter === 'SharePoint') ({ fake, session } = await liveSharePoint());
    else { useLocal(); ({ session } = await ds.activateClient('c-kroger', '2026-11-25')); }
    const day = session.date ?? session.id.slice(-10);
    const state = async (token) => { const now = await ds.getQrToken(token.id); return [ds.qrTokenStatus(now), now.used, Boolean(now.expiredAt)]; };
    const RETIRED = ['expired', true, true];
    const SCANNED = ['used', true, false];
    const scan = async (token) => (await ds.openQrScan(token.id)).claim();
    const guestWithCode = async (name) => {
      const visitor = await ds.createVisitor({ sessionId: session.id, displayName: name, enabled: true });
      return { visitor, code: await ds.provisionQrToken('c-kroger', session.id, { visitorId: visitor.id }) };
    };

    // 1. Disabling a guest retires that guest's unscanned code, and only theirs.
    await ds.setSessionParticipationMode(session.id, 'client-visit');
    const [joined, off, other] = [await guestWithCode('Joined'), await guestWithCode('Switched off'), await guestWithCode('Another')];
    await scan(joined.code);
    await ds.setVisitorEnabled(off.visitor.id, false);
    assert.deepEqual([await state(joined.code), await state(off.code), await state(other.code)], [SCANNED, RETIRED, ['unused', false, false]]);
    // 2. Back to staff sign-in: every visitor's unscanned code is retired; a scanned one is as it was.
    await ds.setSessionParticipationMode(session.id, 'staff');
    assert.deepEqual([await state(joined.code), await state(other.code)], [SCANNED, RETIRED]);
    // 3. End session retires the unscanned codes of that session.
    const [used, waiting] = [await ds.provisionQrToken('c-kroger', session.id), await ds.provisionQrToken('c-kroger', session.id)];
    await scan(used);
    await ds.endSession(session.id);
    assert.deepEqual([await state(used), await state(waiting)], [SCANNED, RETIRED]);
    // 4. Going live with another client retires the unscanned codes of the session it replaces.
    await ds.reopenSession(session.id);
    const left = await ds.provisionQrToken('c-kroger', session.id);
    const dominos = await ds.activateClient('c-dominos', day);
    assert.deepEqual(await state(left), RETIRED);
    // 5. And so does making an existing session live.
    const theirs = await ds.provisionQrToken('c-dominos', dominos.session.id);
    await ds.activateSession(session.id);
    assert.deepEqual([await state(theirs), await state(used), await state(joined.code)], [RETIRED, SCANNED, SCANNED]);

    if (fake) {
      const reads = fake.requests.flatMap((entry) => [entry, ...(entry.parts ?? [])]).filter((entry) => entry.list === 'qrtokens' && entry.method === 'GET');
      assert.deepEqual(reads.filter((entry) => /\bUsed eq\b/.test(entry.query)).map((entry) => entry.query), [], 'no read of the codes filters on the Yes/No column');
      // (The columns a read names come after its filter since Phase 10h.)
      const filterOf = (entry) => entry.query.replace(/&\$select=[^&]*$/, '');
      const bySession = reads.filter((entry) => /\(SessionId eq '[^']+'\)$/.test(filterOf(entry)) && !entry.query.includes('AppId eq'));
      assert.ok(bySession.length >= 4, `the codes are read by the indexed SessionId (${bySession.length} such reads)`);
      assert.equal(reads.filter((entry) => /\(VisitorId eq '[^']+'\) and \(SessionId eq '[^']+'\)$/.test(filterOf(entry))).length, 1, 'and by VisitorId and SessionId for one guest');
    }
  });
}

// Phase 10b: every fake also holds the other set of lists (the prefixed ones; or the plain ones, when this suite is run a second time
// with PMS_TEST_LIST_PREFIX and its own lists are the prefixed ones). A request to them is answered, as a second copy's lists would
// answer on a real site, so nothing else in this suite would notice one: this does.
it('no request of this suite reached a list that is not its own', () => {
  assert.deepEqual(STRAYS.map((entry) => `${entry.method} ${entry.title}`), []);
  assert.deepEqual(UNINDEXED.map((entry) => `${entry.list}.${entry.unindexed}`), [], 'and none filtered on a column the schema does not index');
});
