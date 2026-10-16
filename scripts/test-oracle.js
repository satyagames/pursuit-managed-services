// Phase 9a: the independent oracle, small and seeded, as part of `npm test`. Run alone: node --test scripts/test-oracle.js
//
// scripts/oracle-results.js works every figure of a session out again from the raw stored rows, with nothing of the app's counting
// code, and compares it with the leader report's model, its CSV, its PDF's text, the Results screen's rows and the Live display's
// tally. Here it runs over a fixed set of random sessions on the mocked SharePoint REST, a few of them also as a PDF and on the real
// local server, and then proves that the comparison can fail: a figure changed behind its back is noticed, each time.
// The full run is `node scripts/oracle-results.js --seeds 500`.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STRAYS, UNINDEXED } from './sharepoint-fake.js';
import { FIXED_ZONES, KNOWN, compare, generate, loadApp, oracle, parseCsv, random, run, storeInSharePoint, toRows, wallClock } from './oracle-results.js';

const SEEDS = 48;

describe('the oracle and the app agree', () => {
  it(`on ${SEEDS} random sessions: the report, the CSV, the Results screen and the Live display, in four time zones; every eighth as a PDF and on the local server`, async () => {
    const outcome = await run({ from: 1, seeds: SEEDS, pdfEvery: 8, localEvery: 8 });
    assert.deepEqual(outcome.diffs, []);
    assert.equal(outcome.local, 6);
    assert.ok(outcome.people > 300, `only ${outcome.people} participants were generated`);
  });

  it('the sessions it checks do hold the hard cases', () => {
    const edits = new Set();
    let people = 0;
    let restarted = 0;
    let orphans = 0;
    let open = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const fixture = generate(seed);
      for (const edit of fixture.edits) edits.add(edit.split(' ')[0]);
      people += fixture.tracks.length;
      restarted += fixture.tracks.filter((track) => track.restartedAt).length;
      orphans += fixture.gone.tracks.length;
      open += [...fixture.items.values()].flat().filter((record) => record.correct === false && record.attempts === 1).length;
    }
    for (const kind of ['deleted', 'unlisted', 'removed', 'renamed', 're-keyed', 'switched', 'visit', 'damaged']) assert.ok(edits.has(kind), `no session has "${kind}"`);
    assert.ok(restarted > 5 && orphans > 0 && open > 10, `restarted ${restarted}, visits removed ${orphans}, wrong first answers never tried again ${open}`);
    assert.ok(people > 300);
  });
});

describe('the comparison can fail', () => {
  /** A session stored in the mocked SharePoint, its truth, and the app. */
  async function stored(seed) {
    const app = await loadApp();
    const fixture = generate(seed, { people: 12 });
    const { fake, rows } = storeInSharePoint(app, fixture);
    return { app, fixture, fake, rows, truth: oracle(rows, fixture.session.id) };
  }
  const restore = (app) => { app.ds.configure({ baseUrl: '/api' }); };
  const realFetch = globalThis.fetch;
  const done = (app) => { globalThis.fetch = realFetch; restore(app); };

  it('a stored first answer changed after the oracle looked is noticed in the report, the CSV and the screens', async () => {
    const { app, fixture, fake, truth } = await stored(7);
    try {
      assert.deepEqual((await compare(fixture, truth, app)).diffs, [], 'the session agrees before it is touched');
      const item = fake.lists.get('responses').find((row) => row.TrackId && JSON.parse(row.ResponsesJson).some((record) => record.correct !== null));
      const records = JSON.parse(item.ResponsesJson);
      const graded = records.find((record) => record.correct !== null);
      const other = fake.lists.get('options').find((row) => row.QuestionId === graded.questionId && row.AppId !== graded.firstAnswer);
      graded.firstAnswer = other.AppId;
      item.ResponsesJson = JSON.stringify(records);
      const { diffs } = await compare(fixture, truth, app);
      assert.ok(diffs.some((line) => /count for each option/.test(line)), 'the tally');
      assert.ok(diffs.some((line) => /CSV row \d+ .*first answer/.test(line)), 'the CSV');
      assert.ok(diffs.some((line) => /Live display/.test(line)) && diffs.some((line) => /Results screen/.test(line)), 'both screens');
    } finally { done(app); }
  });

  it('a name, a missing answer and a time an hour out are each noticed', async () => {
    const { app, fixture, fake, truth } = await stored(11);
    try {
      const track = fake.lists.get('tracks')[0];
      track.ParticipantName = 'Somebody Else';
      assert.ok((await compare(fixture, truth, app)).diffs.some((line) => /participants, in order/.test(line)), 'the name');
      const item = fake.lists.get('responses').find((row) => row.TrackId && JSON.parse(row.ResponsesJson).length > 1);
      const records = JSON.parse(item.ResponsesJson);
      const kept = records.slice(1).map((record, index) => (index === 0 ? { ...record, answeredAt: new Date(Date.parse(record.answeredAt) + 3_600_000).toISOString() } : record));
      item.ResponsesJson = JSON.stringify(kept);
      const { diffs } = await compare(fixture, truth, app, { zone: 'Asia/Kolkata' });
      assert.ok(diffs.some((line) => /answered at \(Asia\/Kolkata\)/.test(line)), 'the time');
      assert.ok(diffs.some((line) => /answered \/ graded answered|an unanswered question|answered by/.test(line)), 'the missing answer');
    } finally { done(app); }
  });

  it('a CSV cell that starts a formula is noticed, in whichever column', async () => {
    const { app, fixture, truth } = await stored(13);
    try {
      fixture.tracks.length = 0; // (only the app's own output matters here)
      const unguarded = { ...app, participantAnswersCsv: (report) => app.participantAnswersCsv(report).replace(/(^|,|\n)'([=+\-@])/g, '$1$2').replace(/"'([=+\-@])/g, '"$1') };
      const { diffs } = await compare(fixture, truth, unguarded);
      assert.ok(diffs.some((line) => /starts a formula/.test(line)), 'the fixtures hold names, answers, activities and a client that start with = + - @');
    } finally { done(app); }
  });

  it('Phase 9b: a damaged answer item the app does not name, or does not say so for, is noticed, on every screen and in the report', async () => {
    const { app, fixture, truth } = await stored(4);
    try {
      assert.ok(fixture.damaged.size > 0, 'this seed has damaged items');
      assert.deepEqual(truth.unreadable.map((entry) => entry.id).sort(), [...fixture.damaged.keys()].sort(), 'the oracle names exactly the damaged ones');
      assert.deepEqual((await compare(fixture, truth, app, { pdf: true })).diffs, [], 'and the app agrees');
      // The report's data forgets them.
      const forgetful = { ...app, readLeaderReportRecords: async (id) => ({ ...(await app.readLeaderReportRecords(id)), unreadable: [] }) };
      const report = (await compare(fixture, truth, forgetful)).diffs;
      assert.ok(report.some((line) => /unreadable items: what the report reads/.test(line)), 'the data');
      assert.ok(report.some((line) => /the notice does not count/.test(line)), 'the notice');
      assert.ok(report.some((line) => /people marked as unreadable/.test(line)), 'the people');
      // The Results screen forgets them; so does the Live display.
      const blind = { ...app, readSessionResults: async (id) => ({ ...(await app.readSessionResults(id)), unreadable: [] }) };
      const results = (await compare(fixture, truth, blind)).diffs;
      assert.ok(results.some((line) => /unreadable items: the Results screen/.test(line)));
      assert.ok(results.some((line) => /answers that could not be read/.test(line)), 'the row of the person');
      const dim = { ...app, readLive: async (held) => { const read = await app.readLive(held); return { ...read, results: { ...read.results, unreadable: [] } }; } };
      assert.ok((await compare(fixture, truth, dim)).diffs.some((line) => /unreadable items: the Live display/.test(line)));
    } finally { done(app); }
  });

  it('Phase 9b: a session with nothing damaged, given a notice, is noticed', async () => {
    let seed = 1;
    while (generate(seed, { people: 12 }).damaged.size > 0) seed += 1;
    const { app, fixture, truth } = await stored(seed);
    try {
      assert.equal(truth.unreadable.length, 0);
      const chatty = { ...app, buildLeaderReport: (records, options) => { const made = app.buildLeaderReport(records, options); made.meta.unreadableNotice = 'something could not be read'; return made; } };
      assert.ok((await compare(fixture, truth, chatty)).diffs.some((line) => /says nothing about unreadable items when there are none/.test(line)));
    } finally { done(app); }
  });

  it('a PDF figure that is not the oracle’s is noticed', async () => {
    const { app, fixture, truth } = await stored(17);
    try {
      assert.deepEqual((await compare(fixture, truth, app, { pdf: true })).diffs, []);
      const wrong = structuredClone({ ...truth, label: undefined });
      wrong.label = truth.label;
      wrong.people[0].answered += 1;
      const { diffs } = await compare(fixture, wrong, app, { pdf: true });
      assert.ok(diffs.some((line) => /PDF: ".* answered" is printed/.test(line)), diffs.filter((line) => /PDF/.test(line)).join('\n'));
    } finally { done(app); }
  });
});

describe('the oracle’s own tools', () => {
  it('a wall clock in a zone with one offset all year, across midnight and the date line', () => {
    assert.equal(wallClock('2026-10-13T19:35:09.000Z', 'UTC'), '2026-10-13 19:35:09');
    assert.equal(wallClock('2026-10-13T19:35:09.000Z', 'Asia/Kolkata'), '2026-10-14 01:05:09');
    assert.equal(wallClock('2026-10-13T03:00:00.000Z', 'America/Phoenix'), '2026-10-12 20:00:00');
    assert.equal(wallClock('2026-12-31T11:00:00.000Z', 'Pacific/Kiritimati'), '2027-01-01 01:00:00');
    assert.deepEqual(Object.keys(FIXED_ZONES), ['UTC', 'Asia/Kolkata', 'America/Phoenix', 'Pacific/Kiritimati']);
  });

  it('reads a CSV with quotes, commas and line breaks inside a cell', () => {
    // (The byte-order mark is written as a number: the character itself does not show in an editor.)
    assert.deepEqual(parseCsv(`${String.fromCharCode(0xFEFF)}a,b\r\n"x, ""y""","line\nbreak"\r\n`), [['a', 'b'], ['x, "y"', 'line\nbreak']]);
  });

  it('the Results screen and the exports read results the way the oracle compares them (lib/adminData.ts)', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../migration/src/lib/adminData.ts', import.meta.url), 'utf8');
    assert.match(source, /export const getSessionResults = readSessionResults as unknown as \(sessionId: string\) => Promise<SessionResults \| null>;/);
    assert.match(source, /import \{ readSessionResults \} from '\.\/session-results\.js';/);
    const callers = await Promise.all(['admin/AdminResults.svelte', 'admin/LiveDisplay.svelte'].map((file) => readFile(new URL(`../migration/src/${file}`, import.meta.url), 'utf8')));
    for (const text of callers) assert.match(text, /import \{[^}]*\bgetSessionResults\b[^}]*\} from '\.\.\/lib\/adminData\.js'/);
  });

  it('the same seed makes the same session, and the stored rows are raw', () => {
    assert.equal(JSON.stringify(toRows(generate(5))), JSON.stringify(toRows(generate(5))));
    assert.notEqual(random(1).next(), random(2).next());
    const rows = toRows(generate(5, { people: 6 }));
    assert.equal(typeof rows.responses.at(-1).ResponsesJson, 'string');
    assert.equal(typeof rows.sessions[0].SectionIds, 'string');
  });

  it('nothing is let through: the list of known differences is empty', () => {
    assert.deepEqual(Object.keys(KNOWN), []);
  });

  it('the Results screen\'s "completed" is checked on sessions that have the hard case: every question answered, one still waiting for its Retry', async () => {
    const app = await loadApp();
    const realFetch = globalThis.fetch;
    let seen = 0;
    try {
      for (let seed = 1; seed <= 400 && seen === 0; seed += 1) {
        const fixture = generate(seed);
        const { rows } = storeInSharePoint(app, fixture);
        const truth = oracle(rows, fixture.session.id);
        if (!truth.screen.rows.some((row) => row.total > 0 && row.answered === row.total && !row.completed)) continue;
        const results = await app.readSessionResults(fixture.session.id);
        const shown = app.resultRows(results, (await app.readNameSources([fixture.session.id])).get(fixture.session.id));
        truth.screen.rows.forEach((row, index) => { assert.equal(shown[index].status === 'completed', row.completed, `seed ${seed}, ${row.name}`); });
        seen += truth.screen.rows.filter((row) => row.answered === row.total && !row.completed).length;
      }
    } finally { globalThis.fetch = realFetch; app.ds.configure({ baseUrl: '/api' }); }
    assert.ok(seen > 0, 'no session among the first 400 has the case');
  });
});

// Phase 10b: every fake also holds the other set of lists (the prefixed ones; or the plain ones, when this suite is run a second time
// with PMS_TEST_LIST_PREFIX and its own lists are the prefixed ones). A request to them is answered, as a second copy's lists would
// answer on a real site, so nothing else in this suite would notice one: this does.
it('no request of this suite reached a list that is not its own', () => {
  assert.deepEqual(STRAYS.map((entry) => `${entry.method} ${entry.title}`), []);
  assert.deepEqual(UNINDEXED.map((entry) => `${entry.list}.${entry.unindexed}`), [], 'and none filtered on a column the schema does not index');
});
