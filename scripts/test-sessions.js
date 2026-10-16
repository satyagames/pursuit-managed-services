// Integration test for the session logic on the local server: visits that merge into one live tally, resume, a facilitator's
// restart and the life of a QR code. It starts the real server on a scratch copy of server/data and drives it through
// dataService with the calls the pages use, so your own data is never touched.  Run: npm test
//
// Since Phase 10c-2a every step is one a page takes: a visit begins with beginVisit (Welcome) or openQrScan (a scanned code),
// an answer is the participant's own item (saveParticipantResponses), the tally is readSessionResults (Results and the exports),
// and a restart is restartParticipantTrack. Until then this suite drove the calls the legacy pages made, which are gone.
import assert from 'node:assert/strict';
import { freePort } from './free-port.js';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const ROOT = path.join(import.meta.dirname, '..');
const PORT = await freePort();
const SEED_SECTIONS = ['sec-straight-talk', 'sec-confidence', 'sec-trivia', 'sec-open-feedback'];
const SECTION_IDS = [...SEED_SECTIONS, 'sec-test-rank', 'sec-test-empty'];
const OBJECTIVE = 'q-straight-talk-objective'; // single-select, in sec-straight-talk
const CONFIDENCE = 'q-confidence-delivery'; //     confidence-continuum, in sec-confidence

let server;
let dataDir;
let ds;
let readSessionResults;

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'cec-sessions-'));
  await cp(path.join(ROOT, 'server', 'data'), dataDir, { recursive: true });
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    server.once('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
    server.stdout.on('data', (chunk) => String(chunk).includes('running') && resolve());
  });

  ds = await import('../public/js/dataService.js');
  ds.configure({ baseUrl: `http://localhost:${PORT}/api` });
  ({ readSessionResults } = await import('../migration/src/lib/session-results.js'));

  // A ranked-voting question and an empty section, which the seed data doesn't have.
  const optionIds = ['o-test-rank-a', 'o-test-rank-b', 'o-test-rank-c'];
  await ds.createSection({ id: 'sec-test-rank', title: 'Rank', order: 5, enabled: true, industryTags: [], questionIds: ['q-test-rank'] });
  await ds.createSection({ id: 'sec-test-empty', title: 'Empty', order: 6, enabled: false, industryTags: [], questionIds: [] });
  await ds.createQuestion({ id: 'q-test-rank', sectionId: 'sec-test-rank', type: 'ranked-voting', prompt: 'Rank these', optionIds, order: 1 });
  for (const id of optionIds) {
    await ds.createOption({ id, questionId: 'q-test-rank', label: id, value: id, correct: null });
  }
});

after(async () => {
  server?.kill();
  await rm(dataDir, { recursive: true, force: true });
});

/** A fresh, unstarted session, so each test is independent of the others. */
const newSession = () => ds.createSession({
  clientId: 'c-kroger', date: '2026-09-18', sectionIds: SECTION_IDS, status: 'not-started',
});

/** A visit begun at Welcome: the page makes the id. */
const join = (sessionId, clientId = 'c-kroger') => ds.beginVisit(crypto.randomUUID(), sessionId, clientId);

/** A visit begun by scanning a code: what the participant page does with `?qr=`. Rejects with the refusal when the code cannot be used. */
const scan = async (tokenId) => (await ds.openQrScan(tokenId)).claim();

/**
 * What a participant's device does with an answer: it keeps ONE item of its own and writes it whole each time (the first save creates
 * it). `held` is what each device remembers of its item. The questions here are not graded, so the latest answer is the one that counts.
 */
const held = new Map();
async function answer(track, questionId, value) {
  const mine = held.get(track.id) ?? { ref: null, responses: [] };
  const earlier = mine.responses.find((record) => record.questionId === questionId);
  const record = { questionId, answer: value, firstAnswer: earlier?.firstAnswer ?? value, attempts: 1, correct: null, answeredAt: new Date().toISOString() };
  const responses = [...mine.responses.filter((entry) => entry.questionId !== questionId), record];
  const saved = await ds.saveParticipantResponses({ trackId: track.id, sessionId: track.sessionId, clientId: track.clientId, responses }, mine.ref);
  held.set(track.id, { ref: saved.ref, responses: saved.responses });
}

/** What Results shows of one question: { respondents, tracks, counts: { optionId: n }, scores? }. */
async function tally(sessionId, questionId) {
  const results = await readSessionResults(sessionId);
  const question = results.sections.flatMap((section) => section.questions).find((q) => q.id === questionId);
  return {
    respondents: question.respondents,
    tracks: results.tracks.length,
    counts: Object.fromEntries(question.options.map((option) => [option.id, option.count])),
    scores: Object.fromEntries(question.options.filter((o) => o.score !== undefined).map((o) => [o.id, o.score])),
  };
}

describe('visits merge into one live tally', () => {
  it('reflects each visit the moment it saves, before the others finish', async () => {
    const session = await newSession();
    const a = await join(session.id);
    const b = await join(session.id); // a second iPad for the same client
    assert.notEqual(a.id, b.id);
    assert.equal((await tally(session.id, OBJECTIVE)).tracks, 2);

    await answer(a, OBJECTIVE, 'o-obj-cost');
    let now = await tally(session.id, OBJECTIVE); // track B hasn't answered anything yet
    assert.equal(now.respondents, 1);
    assert.equal(now.counts['o-obj-cost'], 1);
    assert.equal(now.counts['o-obj-tech'], 0);

    await answer(b, OBJECTIVE, 'o-obj-tech'); // answers differently
    now = await tally(session.id, OBJECTIVE);
    assert.equal(now.respondents, 2);
    assert.equal(now.counts['o-obj-cost'], 1);
    assert.equal(now.counts['o-obj-tech'], 1);
  });

  it('replaces a visit\'s own earlier answer but never another visit\'s', async () => {
    const session = await newSession();
    const a = await join(session.id);
    const b = await join(session.id);
    await answer(a, OBJECTIVE, 'o-obj-cost');
    await answer(b, OBJECTIVE, 'o-obj-cost');
    await answer(a, OBJECTIVE, 'o-obj-cx'); // A changes their mind

    const now = await tally(session.id, OBJECTIVE);
    assert.equal(now.respondents, 2);
    assert.equal(now.counts['o-obj-cost'], 1, 'only B still votes cost');
    assert.equal(now.counts['o-obj-cx'], 1);
  });

  it('keeps sessions apart', async () => {
    const [one, two] = [await newSession(), await newSession()];
    const a = await join(one.id);
    await answer(a, OBJECTIVE, 'o-obj-cost');
    assert.equal((await tally(two.id, OBJECTIVE)).respondents, 0);
  });

  it('scores ranked-voting with a Borda count', async () => {
    const session = await newSession();
    const ranks = [['a', 'b', 'c'], ['b', 'a', 'c'], ['a', 'c', 'b']];
    for (const rank of ranks) {
      const track = await join(session.id);
      await answer(track, 'q-test-rank', rank.map((x) => `o-test-rank-${x}`));
    }
    const now = await tally(session.id, 'q-test-rank');
    assert.deepEqual(now.scores, { 'o-test-rank-a': 8, 'o-test-rank-b': 6, 'o-test-rank-c': 4 });
    assert.deepEqual(Object.values(now.counts), [3, 3, 3]);
  });
});

describe('results export', () => {
  it('gives each option its share as a percent, of respondents or (ranked) of all points', async () => {
    const session = await newSession();
    const tracks = [];
    for (let i = 0; i < 3; i += 1) tracks.push(await join(session.id));
    const votes = ['o-obj-cost', 'o-obj-cost', 'o-obj-cx'];
    for (const [i, track] of tracks.entries()) await answer(track, OBJECTIVE, votes[i]);
    await answer(tracks[0], 'q-test-rank', ['a', 'b', 'c'].map((x) => `o-test-rank-${x}`));

    const results = await readSessionResults(session.id);
    const questions = new Map(results.sections.flatMap((section) => section.questions).map((q) => [q.id, q]));
    const percent = (id) => Object.fromEntries(questions.get(id).options.map((o) => [o.id, Math.round(o.percent)]));
    assert.deepEqual(percent(OBJECTIVE), { 'o-obj-cost': 67, 'o-obj-tech': 0, 'o-obj-process': 0, 'o-obj-cx': 33, 'o-obj-talent': 0 });
    assert.deepEqual(percent('q-test-rank'), { 'o-test-rank-a': 50, 'o-test-rank-b': 33, 'o-test-rank-c': 17 });
    assert.ok(questions.get(CONFIDENCE).options.every((o) => o.percent === 0), 'no answers yet: 0, not NaN');
  });

  it('builds a CSV of question, option, count and percentage, and defuses spreadsheet formulas', async () => {
    const { resultsToCsv } = await import('../public/js/resultsExport.js');
    const session = await newSession();
    const track = await join(session.id);
    await answer(track, OBJECTIVE, 'o-obj-tech');
    await answer(track, 'q-open-feedback', '=HYPERLINK("http://x"), "quoted"');

    const section = await ds.getSection('sec-straight-talk');
    let lines;
    try {
      await ds.updateSection(section.id, { enabled: true });
      lines = resultsToCsv(await readSessionResults(session.id)).split('\r\n');
    } finally {
      await ds.updateSection(section.id, { enabled: section.enabled });
    }
    const objective = 'Straight Talk,Vote on your top business objective for transition,single-select';
    assert.equal(lines[0], 'Activity,Question,Type,Option,Count,Percentage,Score,Respondents');
    assert.ok(lines.includes(`${objective},Modernize technology,1,100.0,,1`));
    assert.ok(lines.includes(`${objective},Reduce cost,0,0.0,,1`));
    assert.ok(lines.some((line) => line.endsWith(`,"'=HYPERLINK(""http://x""), ""quoted""",1,,,1`)), 'the comment is quoted and de-fanged');
    assert.ok(!lines.some((line) => line.startsWith('Empty')), 'a section that is not enabled is left out');
    assert.equal(lines.at(-1), '', 'ends with a line break');
  });
});

describe('resume', () => {
  it('finds a track again by its id, with its answers intact', async () => {
    const session = await newSession();
    const track = await join(session.id);
    await answer(track, OBJECTIVE, 'o-obj-cost');

    const first = await ds.resumeClientTrack(track.id);
    assert.equal(first.id, track.id);
    assert.equal(first.resumeCount, 1);
    assert.equal((await ds.resumeClientTrack(track.id)).resumeCount, 2);

    const mine = await ds.getParticipantResponses(track.id);
    assert.deepEqual(mine.responses.map((r) => [r.questionId, r.answer]), [[OBJECTIVE, 'o-obj-cost']]);
  });

  it('reports an unknown track as null', async () => {
    assert.equal(await ds.resumeClientTrack('trk-does-not-exist'), null);
  });

  it('refuses to resume into a session that has ended, until it is reopened', async () => {
    const session = await newSession();
    const track = await join(session.id);
    await ds.endSession(session.id);
    await assert.rejects(ds.resumeClientTrack(track.id), { code: 'session-ended' });
    await assert.rejects(join(session.id), { code: 'session-ended' });

    assert.equal((await ds.reopenSession(session.id)).status, 'in-progress');
    assert.equal((await ds.resumeClientTrack(track.id)).id, track.id);
  });

  // (A test of deleteClientTrack() stood here. It left the data layer in Phase 10c-2b: no page called it. A visit is removed by
  // removeEmptyVisit(), tested in scripts/test-review-9b.js and test-participant-storage.js, which never touches a QR code.)

  it('moves a session to in-progress when the first visit begins', async () => {
    const session = await newSession();
    assert.equal((await ds.getSession(session.id)).status, 'not-started');
    await join(session.id);
    assert.equal((await ds.getSession(session.id)).status, 'in-progress');
  });
});

describe('admin restart', () => {
  it('sends one visit back to the start of an activity and leaves the others alone', async () => {
    const session = await newSession();
    const a = await join(session.id);
    const b = await join(session.id);
    await answer(a, OBJECTIVE, 'o-obj-cost');
    await answer(a, CONFIDENCE, 'o-conf-3');
    await answer(b, OBJECTIVE, 'o-obj-cost');

    const { removed } = await ds.restartParticipantTrack(a.id, { sectionId: 'sec-straight-talk' });
    assert.equal(removed, 1);
    const answersOf = async (track) => ((await ds.getParticipantResponses(track.id))?.responses ?? []).map((r) => r.questionId);
    assert.deepEqual(await answersOf(a), [CONFIDENCE], 'only that module was cleared');
    assert.deepEqual(await answersOf(b), [OBJECTIVE]);
    assert.equal((await tally(session.id, OBJECTIVE)).respondents, 1, 'the tally dropped A again');

    const [restarted, untouched] = [await ds.getClientTrack(a.id), await ds.getClientTrack(b.id)];
    assert.equal(restarted.restartSectionId, 'sec-straight-talk');
    assert.ok(restarted.restartedAt, 'the iPad watches this to know it was restarted');
    assert.equal(untouched.restartedAt, null);
  });

  it('restarts a visit from the very beginning', async () => {
    const session = await newSession();
    const a = await join(session.id);
    const b = await join(session.id);
    for (const track of [a, b]) {
      await answer(track, OBJECTIVE, 'o-obj-cost');
      await answer(track, CONFIDENCE, 'o-conf-1');
    }
    assert.equal((await ds.restartParticipantTrack(a.id)).removed, 2);
    assert.equal((await ds.getClientTrack(a.id)).restartSectionId, null);
    assert.equal((await tally(session.id, CONFIDENCE)).respondents, 1);
  });

  it('restarting an activity with no questions removes nothing', async () => {
    const session = await newSession();
    const a = await join(session.id);
    await answer(a, OBJECTIVE, 'o-obj-cost');
    assert.equal((await ds.restartParticipantTrack(a.id, { sectionId: 'sec-test-empty' })).removed, 0);
    assert.equal((await tally(session.id, OBJECTIVE)).respondents, 1);
  });

  it('rejects a visit or an activity that does not exist', async () => {
    const session = await newSession();
    const a = await join(session.id);
    await assert.rejects(ds.restartParticipantTrack('trk-nope'), { code: 'track-missing' });
    await assert.rejects(ds.restartParticipantTrack(a.id, { sectionId: 'sec-nope' }), { code: 'section-missing' });
  });
});

describe('QR tokens', () => {
  it('builds the URL a scan opens and reads the token back from it', () => {
    const url = ds.qrUrl('abc-123', 'http://192.168.1.20:3000/');
    assert.equal(url, 'http://192.168.1.20:3000/?qr=abc-123');
    assert.equal(ds.qrTokenFromSearch(new URL(url).search), 'abc-123');
    assert.equal(ds.qrTokenFromSearch(''), null);
  });

  it('is provisioned for a client, claimed once into a fresh track, then rejected', async () => {
    const session = await newSession();
    const token = await ds.provisionQrToken('c-kroger', session.id);
    assert.equal(token.clientId, 'c-kroger');
    assert.equal(token.sessionId, session.id);
    assert.equal(ds.qrTokenStatus(token), 'unused');

    const first = await ds.openQrScan(token.id);
    assert.equal(first.failure, null);
    const track = await first.claim();
    assert.equal(track.sessionId, session.id);
    assert.equal(track.clientId, 'c-kroger');
    assert.equal(track.joinedVia, 'qr');
    assert.equal(track.qrTokenId, token.id);

    const used = await ds.getQrToken(token.id);
    assert.equal(used.used, true);
    assert.equal(used.clientTrackId, track.id);
    assert.equal(ds.qrTokenStatus(used), 'used');

    const second = await ds.openQrScan(token.id);
    assert.equal(second.failure.code, 'token-used', 'a second scan is told before it writes anything');
    await assert.rejects(second.claim(), { code: 'token-used' });
    assert.equal((await ds.listClientTracks(session.id)).length, 1, 'the rejected scan started no track');
  });

  it('rejects a token that was never provisioned', async () => {
    await assert.rejects(scan('not-a-token'), { code: 'token-unknown' });
  });

  it('lets exactly one of several simultaneous scans win, without leaving stray tracks', async () => {
    const session = await newSession();
    const token = await ds.provisionQrToken('c-kroger', session.id);
    // Six devices: each is the data service loaded as a module of its own, because one module is one page (it remembers an unfinished scan).
    const devices = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
      const device = await import(`../public/js/dataService.js?device=${index + 1}`);
      device.configure({ baseUrl: `http://localhost:${PORT}/api` });
      return device;
    }));
    const scans = await Promise.allSettled(devices.map(async (device) => (await device.openQrScan(token.id)).claim()));

    assert.equal(scans.filter((scan) => scan.status === 'fulfilled').length, 1);
    for (const scan of scans.filter((s) => s.status === 'rejected')) assert.equal(scan.reason.code, 'token-used');
    const tracks = await ds.listClientTracks(session.id);
    assert.equal(tracks.length, 1);
    assert.equal((await ds.getQrToken(token.id)).clientTrackId, tracks[0].id);
  });

  it('expires with its session: unscanned codes are retired, and scanning them fails', async () => {
    const session = await newSession();
    const scanned = await ds.provisionQrToken('c-kroger', session.id);
    const unscanned = await ds.provisionQrToken('c-kroger', session.id);
    await scan(scanned.id);

    await ds.endSession(session.id);
    const retired = await ds.getQrToken(unscanned.id);
    assert.equal(retired.used, true);
    assert.equal(ds.qrTokenStatus(retired), 'expired');
    assert.equal(ds.qrTokenStatus(await ds.getQrToken(scanned.id)), 'used', 'a scanned code stays "used"');

    await assert.rejects(scan(unscanned.id), { code: 'token-expired' });
    await assert.rejects(scan(scanned.id), { code: 'token-used' });
    await assert.rejects(ds.provisionQrToken('c-kroger', session.id), { code: 'session-ended' });
  });

  it('retires a code whose session ended without it being expired (e.g. a hand edit)', async () => {
    const session = await newSession();
    const token = await ds.provisionQrToken('c-kroger', session.id);
    await ds.updateSession(session.id, { status: 'completed' }); // bypasses endSession()
    await assert.rejects(scan(token.id), { code: 'token-expired' });
    assert.equal(ds.qrTokenStatus(await ds.getQrToken(token.id)), 'expired');
  });

  it('defaults to the client\'s open session', async () => {
    const closed = await newSession();
    await ds.endSession(closed.id);
    const open = await newSession();
    const token = await ds.provisionQrToken('c-kroger');
    assert.notEqual(token.sessionId, closed.id);
    assert.ok((await ds.findOpenSession('c-kroger')), `there is an open session (e.g. ${open.id})`);
  });
});

describe('data integrity', () => {
  it('leaves every reference valid (node scripts/validate-data.js)', () => {
    const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'validate-data.js')], {
      env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8',
    });
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  });
});
