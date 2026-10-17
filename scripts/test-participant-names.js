// Phase 7c: ONE rule names a participant. Run: npm run test:report
//
// Admin → Results used to label a nameless visit with the client's name ("Harbour & Søn · Visit 1") and a second visit as "· Visit 2", while the
// leader report said "Unnamed participant 1" and "José Álvarez (2)". The rule now lives in migration/src/lib/results/participant-names.js and both use it.
// This builds ONE session (the report's Harbour fixture: seven visits, among them a guest named from the QR code, staff named from the visit log,
// a guest named from the roster, two visits with no name anywhere, and the same guest twice), takes the names from the code Admin → Results
// uses (lib/admin/admin-results.js, over the same reads the screen makes), and from the leader report, its CSV and its PDF, and asserts the
// lists are equal: the same people, the same names, in the same order. On the mocked SharePoint REST and on the real local server.
// It is not the real tenant, and the screen's own timers are checked in the browser specs (scripts/migration-tests).

import assert from 'node:assert/strict';
import { freePort } from './free-port.js';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as ds from '../migration/src/lib/data/dataService.js';
import { hasOwnName, readNameSources, resultRows, rowsToLookForAgain, sessionsNeedingNames } from '../migration/src/lib/admin/admin-results.js';
import { buildLeaderReport, participantAnswersRows } from '../migration/src/lib/exports/leader-report.js';
import { readLeaderReportRecords } from '../migration/src/lib/exports/leader-report-data.js';
import { nameParticipants } from '../migration/src/lib/results/participant-names.js';
import { readSessionResults } from '../migration/src/lib/results/session-results.js';
import { HARBOUR_MOVED, HARBOUR_PEOPLE, harbourContent, seedSession } from './leader-report-fixtures.js';
import { makeReport } from './leader-report-node.js';
import { inspectPdf } from './pdf-inspect.js';
import { STRAYS, UNINDEXED, createSharePointFake } from './sharepoint-fake.js';

const ROOT = path.join(import.meta.dirname, '..');
const realFetch = globalThis.fetch;
let server;
let dataDir;
let localBase;

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'cec-names-'));
  await cp(path.join(ROOT, 'server', 'data'), dataDir, { recursive: true });
  const port = await freePort();
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'inherit'] });
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
});

const input = () => ({ content: harbourContent(), people: HARBOUR_PEOPLE, extra: { questions: [HARBOUR_MOVED.question], options: HARBOUR_MOVED.options } });

async function onSharePoint() {
  const fake = createSharePointFake();
  fake.install();
  ds.configure({ sharePoint: fake.settings });
  const { session } = await seedSession(ds, input());
  return { fake, session };
}

async function onLocal() {
  await cp(path.join(ROOT, 'server', 'data'), dataDir, { recursive: true, force: true });
  globalThis.fetch = realFetch;
  ds.configure({ baseUrl: localBase });
  const { session } = await seedSession(ds, input());
  return { fake: null, session };
}

/** The names Admin → Results shows for a session: the screen's own reads (the results, then the names that are not on a track) and its own code. */
async function screenNames(sessionId) {
  const results = await readSessionResults(sessionId);
  const needing = sessionsNeedingNames([results]);
  const sources = (await readNameSources(needing)).get(sessionId);
  return { results, rows: resultRows(results, sources), needing };
}

/** The people in the PDF, in reading order: the bold 12 pt names where each person's block starts. */
const pdfNames = (read) => {
  const start = read.pages.findIndex((page) => page.items.some((item) => item.text === 'Participants' && Math.abs(item.size - 16) < 0.1));
  const end = read.pages.findIndex((page, index) => index > start && page.items.some((item) => item.text === 'How the numbers are counted' && Math.abs(item.size - 16) < 0.1));
  return read.pages.slice(start, end < 0 ? undefined : end).flatMap((page) => page.items.filter((item) => item.font === 'OpenSans-Bold' && Math.abs(item.size - 12) < 0.05).sort((a, b) => a.y - b.y).map((item) => item.text));
};

/** Each person once, in the order the CSV first meets them (its rows for answers to deleted questions are not people). */
const csvNames = (report) => [...new Set(participantAnswersRows(report).filter((row) => !String(row[3]).startsWith('(')).map((row) => row[2]))];

for (const [label, open] of [['the mocked SharePoint REST', onSharePoint], ['the real local server', onLocal]]) {
  describe(`one rule names a person, on ${label}`, () => {
    it('Admin → Results, the report, its CSV and its PDF name the same seven people in the same order', async () => {
      const { session } = await open();
      const { rows, needing } = await screenNames(session.id);
      const records = await readLeaderReportRecords(session.id);
      const report = buildLeaderReport(records, { timeZone: 'UTC' });
      const screen = rows.map((row) => row.name);
      const paper = report.participants.map((person) => person.name);

      assert.deepEqual(needing, [session.id], 'a session with visits that have no name of their own needs the visit log and the roster read');
      assert.deepEqual(screen, [
        'José Álvarez',          // the name on the guest's QR code
        'Zoë Brontë',
        'Søren Kjær',            // staff: the sign-in name, kept in the visit log for the account
        'Łukasz Żółć',
        'Unnamed participant 1', // no name recorded anywhere: never the client's name
        'José Álvarez (2)',      // the same guest's second visit: "(2)", not "Visit 2"
        'Unnamed participant 2',
      ]);
      assert.deepEqual(screen, paper, 'the screen and the report');
      assert.deepEqual(csvNames(report), paper, 'the CSV');
      const made = await makeReport(records);
      assert.deepEqual(pdfNames(await inspectPdf(made.bytes)), paper, 'the PDF');
      // The old labels are gone.
      for (const name of screen) {
        assert.doesNotMatch(name, /· Visit/);
        assert.notEqual(name, 'Harbour & Søn');
      }
    });

    it('is the same list for the same visits however they are read: tracks in any order, and the rows follow the order they joined', async () => {
      const { session } = await open();
      const { results, rows } = await screenNames(session.id);
      const reversed = { ...results, tracks: [...results.tracks].reverse() };
      const sources = (await readNameSources([session.id])).get(session.id);
      assert.deepEqual(resultRows(reversed, sources).map((row) => row.name), rows.map((row) => row.name));
      // Each row is a track of the session, once, with the status the screen has always shown: of the 8 questions of the two activities that are
      // switched on, how many each person has answered (the questions of the activity switched off, and of a deleted one, are not among them).
      assert.deepEqual(rows.map((row) => row.track.id).sort(), results.tracks.map((track) => track.id).sort());
      assert.deepEqual(rows.map((row) => [row.name, row.status, row.answered, row.total]), [
        ['José Álvarez', 'completed', 8, 8],
        ['Zoë Brontë', 'in-progress', 7, 8],
        ['Søren Kjær', 'completed', 8, 8],
        ['Łukasz Żółć', 'in-progress', 6, 8],
        ['Unnamed participant 1', 'in-progress', 1, 8],
        ['José Álvarez (2)', 'not-started', 0, 8],
        ['Unnamed participant 2', 'in-progress', 1, 8],
      ]);
    });
  });
}

describe('what the screen reads for the names', () => {
  it('on SharePoint, one request for up to twenty sessions (two lists side by side), none for no session, and a guest session needs none at all', async () => {
    const { fake, session } = await onSharePoint();
    fake.reset();
    const found = await readNameSources([session.id]);
    assert.equal(fake.count((entry) => !entry.path.endsWith('/contextinfo')), 1, fake.requests.map((entry) => `${entry.method} ${entry.path}`).join('\n'));
    assert.equal(found.get(session.id).roster.length > 0, true, 'the roster came back');
    assert.equal(found.get(session.id).visits.length > 0, true, 'and the visit log');
    // Twenty sessions in a read; twenty-one are two reads side by side, still ONE request.
    fake.reset();
    const many = await readNameSources(Array.from({ length: 21 }, (_unused, index) => (index === 0 ? session.id : `no-such-session-${index}`)));
    assert.equal(fake.count((entry) => !entry.path.endsWith('/contextinfo')), 1);
    assert.equal(many.size, 21);
    assert.equal(many.get(session.id).visits.length, found.get(session.id).visits.length, 'each session gets its own rows');
    assert.equal(many.get('no-such-session-3').visits.length, 0);
    fake.reset();
    assert.equal((await readNameSources([])).size, 0);
    assert.equal(fake.count((entry) => !entry.path.endsWith('/contextinfo')), 0, 'no sessions, no request');

    // A session of guests, every one with the name on its own track, needs nothing read.
    const { results } = await screenNames(session.id);
    const guests = { ...results, tracks: results.tracks.map((track) => ({ ...track, participantName: `Guest ${track.id}` })) };
    assert.deepEqual(sessionsNeedingNames([guests]), []);
    assert.equal(results.tracks.some((track) => !hasOwnName(track)), true);
    assert.ok(resultRows(guests).every((row) => row.name === `Guest ${row.track.id}`), 'and they are named by their own tracks');
  });

  it('with nothing read the person is "Unnamed participant N", never the client or an id: the screen shows what it could not read, plainly', async () => {
    const { session } = await onLocal();
    const { results } = await screenNames(session.id);
    const bare = resultRows(results).map((row) => row.name);
    assert.ok(bare.every((name) => /^Unnamed participant \d+|^José Álvarez|^Zoë Brontë|^Łukasz Żółć/.test(name)), bare.join(' | '));
    assert.ok(bare.every((name) => !name.includes('Harbour')), 'never the client');
    assert.deepEqual(nameParticipants({ tracks: results.tracks }).map((entry) => entry.name), bare, 'the same function, the same answer');
  });
});

describe('when the live session looks for a name again', () => {
  const now = Date.parse('2026-10-11T13:30:00.000Z');
  const row = (id, joinedSecondsAgo, unnamed = true) => ({ track: { id, createdAt: joinedSecondsAgo === null ? undefined : new Date(now - joinedSecondsAgo * 1000).toISOString() }, name: unnamed ? 'Unnamed participant 1' : 'Ana', unnamed });
  const ids = (rows, looked = new Map()) => rowsToLookForAgain(rows, looked, now).map((each) => each.track.id);

  it('only for someone with no name who joined in the last two minutes and has been looked for fewer than twice', () => {
    assert.deepEqual(ids([row('new', 20), row('fresh', 119), row('old', 121), row('named', 20, false), row('undated', null)]), ['new', 'fresh']);
    assert.deepEqual(ids([row('new', 20)], new Map([['new', 1]])), ['new'], 'once more after the first look');
    assert.deepEqual(ids([row('new', 20)], new Map([['new', 2]])), [], 'and then never');
    assert.deepEqual(ids([]), []);
  });
});

// Phase 10b: every fake also holds the other set of lists (the prefixed ones; or the plain ones, when this suite is run a second time
// with PMS_TEST_LIST_PREFIX and its own lists are the prefixed ones). A request to them is answered, as a second copy's lists would
// answer on a real site, so nothing else in this suite would notice one: this does.
it('no request of this suite reached a list that is not its own', () => {
  assert.deepEqual(STRAYS.map((entry) => `${entry.method} ${entry.title}`), []);
  assert.deepEqual(UNINDEXED.map((entry) => `${entry.list}.${entry.unindexed}`), [], 'and none filtered on a column the schema does not index');
});
