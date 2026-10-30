// Phase 10h, part A: every item read names its columns.
//
// The first run on the real site (PCOE, 14 Oct 2026) showed the admin's Content tab and Today's readiness saying that Kroger and Domino's
// had no activities, although the four seeded activities were on PMSActivities with the right ClientId. A read of that list that named its
// columns ($select=Id,Title,AppId,ClientId,Enabled) returned ClientId; the data layer's read, which named none (items?$top=200), returned
// every column of the list but ClientId. Why that site leaves it out, and what else it leaves out, is not known. So every item read the data
// layer and Setup send names its columns (pms-schema.js selectOf), and the mock answers as that site did (scripts/sharepoint-fake.js:
// `strict: false` is the site as it was seen; the default refuses a read that names no columns, so every suite sees one).
//
// What is held here: on the site as it was seen, the Content tab and Today's readiness show Kroger's two activities, Go live with Kroger
// works and Results ties a session to its client; on the strict mock, a walk through what the pages do sends no read that names no columns;
// in the source, every address of an item read names its columns; a create whose reply leaves a column out still returns the record as
// written; and Setup's probe of what a site leaves out says so. Run: node --test scripts/test-named-reads.js (also part of npm test).
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import * as ds from '../migration/src/lib/data/dataService.js';
import { LISTS, selectOf } from '../migration/src/lib/schema/pms-schema.js';
import { activitiesOfClient } from '../migration/src/lib/admin/admin-content.js';
import { clientUsage, recentCodes } from '../migration/src/lib/admin/admin-clients.js';
import { evaluateReadiness, goLive, loadToday, pollToday } from '../migration/src/lib/admin/admin-today.js';
import { NAME_SOURCE_SESSIONS, readNameSources } from '../migration/src/lib/admin/admin-results.js';
import { markReady, siteApi } from '../migration/src/lib/setup/provision.js';
import { PROBE_LEFT_OUT, schemaSpecs, selfTestProbes } from '../migration/src/lib/setup/setup-checks.js';
import { readSessionResults } from '../migration/src/lib/results/session-results.js';
import { selectLine, selectRequest } from './schema-baseline/select-baselines.js';
import { samplePack } from '../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../migration/src/lib/setup/seed.js';
import { STRAYS, TENANT_LEAVES_OUT, TITLE, UNINDEXED, UNNAMED, UNNAMED_REFUSAL, createSharePointFake, plainTitles } from './sharepoint-fake.js';

const ROOT = path.join(import.meta.dirname, '..');
const realFetch = globalThis.fetch;
const DAY = '2026-10-15';
const KROGER = ['sec-trivia', 'sec-guess-the-brand'];

/** A site with the sample clients on it. `options` go to the mock: `{ strict: false }` is the real site as it was seen. */
async function site(options = {}) {
  const fake = createSharePointFake(options);
  fake.install();
  ds.configure({ sharePoint: fake.settings });
  await seedPack(ds, samplePack());
  return fake;
}
/** Every operation of the log, a batch's parts included. */
const operations = (fake) => fake.requests.flatMap((entry) => [entry, ...(entry.parts ?? [])]).filter((entry) => !entry.path.endsWith('/$batch'));
const itemReads = (fake) => operations(fake).filter((entry) => entry.method === 'GET' && /\/items$/.test(entry.path));

describe('the mock answers an item read as the real site did (Phase 10h)', () => {
  after(() => { globalThis.fetch = realFetch; });
  const at = (fake, key, query) => `${fake.siteUrl}/_api/web/lists/getbytitle('${fake.titleOf(key)}')/items?${query}`;
  const rows = async (reply) => (await reply.json()).d.results;

  it('a read that names its columns gets exactly those, with __metadata, Id and ID', async () => {
    const fake = await site();
    const [row] = await rows(await fake.fetch(at(fake, 'sections', `$filter=${encodeURIComponent("AppId eq 'sec-trivia'")}&$select=Id,AppId,ClientId,Enabled`)));
    assert.deepEqual(Object.keys(row).sort(), ['AppId', 'ClientId', 'Enabled', 'ID', 'Id', '__metadata']);
    assert.deepEqual([row.AppId, row.ClientId, row.Enabled, row.ID === row.Id], ['sec-trivia', 'c-kroger', true, true]);
    assert.ok(row.__metadata.etag && row.__metadata.type, 'the version and the type, as every read has them');
  });

  it('a read that names none leaves ClientId out, on every list that has it (`strict: false`, the site as it was seen)', async () => {
    const fake = await site({ strict: false });
    assert.deepEqual(TENANT_LEAVES_OUT, ['ClientId', 'DisplayName'], 'and DisplayName since Phase 10i (PMSVisitLog, 15 Oct 2026)');
    const all = await rows(await fake.fetch(at(fake, 'sections', '$top=200')));
    assert.equal(all.length, 4, 'the four seeded activities are there');
    assert.ok(all.every((row) => !('ClientId' in row) && row.AppId && 'Enabled' in row && 'Title' in row), 'every other column is there, ClientId is not');
    assert.equal(fake.item('sections', 'sec-trivia').ClientId, 'c-kroger', 'and the list holds it');
    assert.equal((await fake.fetch(at(fake, 'sections', `$top=200&${selectOf('sections')}`)).then(rows)).filter((row) => row.ClientId === 'c-kroger').length, 2, 'named, it comes back');
  });

  it('strict, as by default: a read that names no columns is refused, and noted; the probe\'s one item is answered', async () => {
    const fake = await site();
    const before = UNNAMED.length;
    const refused = await fake.fetch(at(fake, 'clients', '$top=200'));
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).error.message.value, UNNAMED_REFUSAL);
    assert.equal(UNNAMED.length, before + 1);
    UNNAMED.splice(before);
    const probe = await rows(await fake.fetch(at(fake, 'sections', '$top=1')));
    assert.equal(probe.length, 1);
    assert.equal('ClientId' in probe[0], false, 'answered as the site answers it');
    assert.equal(UNNAMED.length, before);
  });

  it('a column that the list does not have cannot be named (400, as SharePoint is believed to answer)', async () => {
    const fake = await site();
    const reply = await fake.fetch(at(fake, 'clients', '$select=Id,AppId,Nickname'));
    assert.equal(reply.status, 400);
    assert.match((await reply.json()).error.message.value, /The field or property 'Nickname' does not exist\./);
  });

  it('a __next link carries the $select it was asked with, and the next page is named too', async () => {
    const fake = await site();
    for (let index = 0; index < 3; index += 1) fake.add('clients', { AppId: `c-extra-${index}`, Name: `Extra ${index}` });
    const first = await (await fake.fetch(at(fake, 'clients', `$top=2&${selectOf('clients')}`))).json();
    assert.equal(first.d.results.length, 2);
    const next = new URL(first.d.__next);
    assert.equal(next.searchParams.get('$select'), selectOf('clients').slice('$select='.length));
    const second = await rows(await fake.fetch(first.d.__next));
    assert.equal(second.length, 2);
    assert.deepEqual(Object.keys(second[0]).sort(), ['AppId', 'ID', 'Id', 'Name', '__metadata'].sort(), 'only what was named (and held)');
  });

  it('the item a create returns leaves ClientId out too (assumed: the same serialisation as an unnamed read)', async () => {
    const fake = await site();
    const reply = await fake.fetch(`${fake.siteUrl}/_api/web/lists/getbytitle('${fake.titleOf('sessions')}')/items`, {
      method: 'POST', headers: { 'X-RequestDigest': 'digest-token' },
      body: JSON.stringify({ __metadata: { type: `SP.Data.${fake.titleOf('sessions')}ListItem` }, AppId: 's-x', ClientId: 'c-kroger', Status: 'not-started' }),
    });
    assert.equal(reply.status, 201);
    const made = (await reply.json()).d;
    assert.equal('ClientId' in made, false);
    assert.equal(fake.item('sessions', 's-x').ClientId, 'c-kroger', 'it is stored');
  });
});

// ---- On the real site as it was seen ----------------------------------------------------------------------------------------------------

describe('on the site as it was seen (ClientId left out of a read that names no columns)', () => {
  after(() => { globalThis.fetch = realFetch; });

  it('the Content tab shows Kroger\'s two seeded activities, and Domino\'s two', async () => {
    await site({ strict: false });
    const [sections] = await ds.readLists([{ list: 'sections' }]); // the Content tab's read (AdminContent.svelte)
    assert.deepEqual(activitiesOfClient(sections, 'c-kroger').map((section) => section.id), KROGER);
    assert.deepEqual(activitiesOfClient(sections, 'c-dominos').map((section) => section.id), ['sec-dominos-history', 'sec-dominos-innovation']);
  });

  it('Today\'s readiness counts Kroger\'s two live activities and nothing blocks Go live', async () => {
    await site({ strict: false });
    const today = await loadToday(ds, { clientId: 'c-kroger', date: DAY });
    assert.equal(today.pickedClientId, 'c-kroger');
    const client = today.clients.find((entry) => entry.id === 'c-kroger');
    const rows = evaluateReadiness({ ...today, client, date: DAY, today: DAY });
    const activities = rows.find((row) => row.id === 'activities');
    assert.equal(activities.level, 'pass', activities.detail);
    assert.match(activities.detail, /^2 activities are live: Kroger's History, Guess the Brand\.$/);
    assert.deepEqual(rows.filter((row) => row.level === 'blocker').map((row) => `${row.id}: ${row.detail}`), []);
    assert.equal(today.questions.length, 6, 'the questions of both');
  });

  it('Go live with Kroger works: the session is Kroger\'s and holds both activities, the first time and the next', async () => {
    const fake = await site({ strict: false });
    const first = await goLive(ds, { clientId: 'c-kroger', date: DAY });
    assert.equal(first.verified, true);
    assert.equal(first.session.clientId, 'c-kroger', 'the session as the create returned it');
    assert.deepEqual(first.session.sectionIds, KROGER);
    assert.equal(fake.item('sessions', `kroger-${DAY}`).ClientId, 'c-kroger');
    const again = await goLive(ds, { clientId: 'c-kroger', date: DAY });
    assert.equal(again.verified, true, 'the session read back is Kroger\'s');
    assert.equal(again.session.clientId, 'c-kroger');
    const polled = await pollToday(ds, { settings: null, clients: [] });
    assert.equal(polled.status.live, true);
  });

  it('Results ties a session to its client', async () => {
    await site({ strict: false });
    await goLive(ds, { clientId: 'c-kroger', date: DAY });
    await ds.beginVisit(crypto.randomUUID(), `kroger-${DAY}`, 'c-kroger');
    const results = await readSessionResults(`kroger-${DAY}`);
    assert.equal(results.session.clientId, 'c-kroger');
    assert.deepEqual(results.sections.map((section) => section.id), KROGER);
    assert.deepEqual((await ds.listSessions()).map((session) => [session.id, session.clientId]), [[`kroger-${DAY}`, 'c-kroger']]);
    assert.deepEqual((await ds.listClientTracks(`kroger-${DAY}`)).map((track) => track.clientId), ['c-kroger']);
  });
});

// ---- Every item read names its columns --------------------------------------------------------------------------------------------------

describe('every item read the data layer and Setup can send names its columns', () => {
  after(() => { globalThis.fetch = realFetch; });

  it('a walk through what the three pages do, on the strict mock: no read without $select, and each names its list\'s columns', async () => {
    const fake = await site();
    const sessionId = `kroger-${DAY}`;
    // The admin: Today, Go live, a poll, Content, Clients, a guest and a code.
    await loadToday(ds, { date: DAY });
    await goLive(ds, { clientId: 'c-kroger', date: DAY });
    await pollToday(ds, { settings: null, clients: [] });
    const [sections] = await ds.readLists([{ list: 'sections' }, { list: 'clients' }]);
    await ds.readActivityContent(activitiesOfClient(sections, 'c-kroger'));
    await clientUsage(ds, 'c-kroger');
    await recentCodes(ds, sessionId, 'c-kroger');
    await ds.setSessionParticipationMode(sessionId, 'client-visit');
    const visitor = await ds.createVisitor({ sessionId, displayName: 'Avery Stone', enabled: true });
    const code = await ds.provisionQrToken('c-kroger', sessionId, { visitorId: visitor.id });
    // The participant: a QR scan, an answer saved, what an open page looks at.
    const scan = await ds.openQrScan(code.id);
    assert.equal(scan.failure, null);
    const track = await scan.claim();
    assert.equal(track.clientId, 'c-kroger', 'the visit as its create returned it');
    await ds.saveParticipantResponses({ trackId: track.id, sessionId, clientId: 'c-kroger', responses: [{ questionId: 'q-trivia-1', answer: 'a', firstAnswer: 'a', attempts: 1, correct: true }] });
    await ds.getParticipantResponses(track.id);
    await ds.noteTrackResumed(await ds.getClientTrack(track.id));
    await ds.readParticipantWatch({ sessionId, trackId: track.id, clientId: 'c-kroger' });
    // Results and the Live display.
    await readSessionResults(sessionId);
    await readNameSources([sessionId]);
    await ds.readLiveFeed(sessionId, { sectionIds: KROGER, tolerant: true });
    await ds.endSession(sessionId);
    // (Prompt 21, Phase 5) the dashboard: the session's summary written when it ends, then the summaries read whole, and by client, session and period.
    await ds.saveSessionSummary({ id: sessionId, clientId: 'c-kroger', period: 'FY27-Q2', sessionDate: DAY, guests: 1, answers: 1, completed: 0, beforeCount: 0, afterCount: 0, pairedCount: 0, meanBefore: null, meanAfter: null, summaryJson: {} });
    await ds.readSessionSummaries();
    await ds.readSessionSummaries({ clientIds: ['c-kroger'], sessionIds: [sessionId], periods: ['FY27-Q2'] });
    // Setup: the version, the admins, the check, Mark ready (already ready: it reads the settings item and writes nothing).
    await ds.getAppSettings();
    await ds.listAdminUsers();
    // (Prompt 21) the admin page's sign-in: the person's row and assignments; Setup's list of Super admins and its copy of the old admins.
    await ds.readAccessRows('pulmathur@deloitte.com');
    for (const key of ['users', 'roleassignments', 'auditlog']) await ds.listAccessRecords(key);
    const ready = await markReady(siteApi(ds), ds.sharePointListTitles(), { check: () => ds.checkSharePointSchema({ specs: schemaSpecs }) });
    assert.equal(ready.ready, true, ready.words);

    const unnamed = itemReads(fake).filter((entry) => !/[?&]\$select=/.test(entry.query));
    assert.deepEqual(unnamed.map((entry) => `${entry.list}${entry.query}`), [], 'every item read named its columns');
    const lists = new Set(itemReads(fake).map((entry) => entry.list));
    assert.deepEqual([...lists].sort(), Object.keys(LISTS).sort(), 'and the walk read every list');
    for (const entry of itemReads(fake)) {
      const named = new URLSearchParams(entry.query.slice(1)).get('$select').split(',');
      const columns = Object.values(LISTS[entry.list].fields).map((field) => field.column);
      assert.deepEqual(columns.filter((column) => !named.includes(column)), [], `${entry.list}${entry.query} names every column of its list`);
    }
    assert.deepEqual(UNNAMED.map((entry) => `${entry.list}${entry.query}`), []);
  });

  it('in the source: each address of an item read in the data layer and migration/src/lib names its columns, through selectOf or the participant\'s own', async () => {
    const files = [
      ...(await readdir(path.join(ROOT, 'migration', 'src', 'lib'), { recursive: true })).filter((name) => /\.(js|ts)$/.test(name)).map((name) => path.join(ROOT, 'migration', 'src', 'lib', name)),
    ];
    const found = [];
    for (const file of files) {
      const lines = (await readFile(file, 'utf8')).split('\n');
      lines.forEach((line, at) => {
        if (/^\s*(\/\/|\*|\/\*\*)/.test(line) || !/\/items\?/.test(line)) return;
        // (With / on every system: the checks below name files that way, and on Windows path.relative gives \.)
        found.push({ where: `${path.relative(ROOT, file).split(path.sep).join('/')}:${at + 1}`, line: line.trim() });
      });
    }
    // (A probe's query that names its own columns is sent as it is; one that names none is given the list's: probeSharePointRead. Prompt 21: the
    // settings item's version alone, read on a site of an older version that refuses the full read, names its three columns through versionSelect.)
    const named = (line) => /selectOf\(|versionSelect\(|PARTICIPANT_SELECT|\/\\\$select=\/\.test\(query\) \? .*: spItems\(list, query\)/.test(line);
    assert.deepEqual(found.filter((entry) => !named(entry.line)).map((entry) => `${entry.where}: ${entry.line}`), []);
    assert.ok(found.some((entry) => entry.where.startsWith('migration/src/lib/data/') && /selectOf\(/.test(entry.line)), 'the data layer builds its item reads with selectOf');
    assert.equal(found.filter((entry) => entry.where.startsWith('migration/src/lib/setup/provision.js')).length, 2, 'Setup\'s two reads of the settings item');
    // The one read that names no columns on purpose: Setup's probe of what a site leaves out (one item, `$top=1`, which the strict mock answers).
    const checks = await readFile(path.join(ROOT, 'migration', 'src', 'lib', 'setup', 'setup-checks.js'), 'utf8');
    assert.deepEqual(checks.match(/\/items`|\?\$top=1`/g), ['/items`', '?$top=1`']);
  });

  it('selectOf names SharePoint\'s Id, AppId and every column of the list, once, and nothing else', () => {
    assert.equal(selectOf('sections'), '$select=Id,AppId,Title,SortOrder,Enabled,IndustryTags,QuestionIds,ClientId,Description,Kind'); // (Kind: Phase 20)
    assert.equal(selectOf('responses'), '$select=Id,AppId,SessionId,ResponsesJson,TrackId,ClientId');
    for (const key of Object.keys(LISTS)) {
      const named = selectOf(key).slice('$select='.length).split(',');
      assert.equal(new Set(named).size, named.length, key);
      assert.deepEqual(named.slice(0, 2), ['Id', 'AppId'], key);
      assert.deepEqual(named.slice(2).sort(), [...new Set(Object.values(LISTS[key].fields).map((field) => field.column))].filter((column) => column !== 'AppId').sort(), key);
    }
  });

  it('the longest addresses, on the real site\'s address: naming the columns adds the same to every read of a list (at most 171 characters since Prompt 21 Phase 3; 164 before); printed', async () => {
    const fake = await site({ siteUrl: 'https://internal.global.deloitteonline.com/sites/PCOE' });
    // The reads that carry the most ids (lib/data/read-groups.js, admin-clients.js, admin-results.js), each id as long as it can be: a session id is a slug of
    // 40, a date, a start time and the last try of a duplicate (Prompt 21, Phase 3: <slug>-<yyyy-mm-dd>-<hhmm>-9, 58 characters; 51 before), a question id a
    // UUID (36). As a browser sends them: spaces and quotes encoded.
    const session = (index) => `${'a'.repeat(40)}-2026-10-${String(index + 10).padStart(2, '0')}-1430-9`;
    const cases = [
      ['PMSParticipants by 15 sessions (Clients: what uses a client)', { list: 'tracks', where: { sessionId: Array.from({ length: 15 }, (_, index) => session(index)) } }, 1_700],
      ['PMSAnswerOptions by 20 questions (an activity\'s content)', { list: 'options', where: { questionId: Array.from({ length: 20 }, () => crypto.randomUUID()) } }, 1_700],
      // (Prompt 21, Phase 3: as many sessions as readNameSources puts in a read; 20 of the longer ids made 2,013 characters.)
      [`PMSVisitLog by ${NAME_SOURCE_SESSIONS} sessions (Results: who is who, readNameSources; over 1,500 since Phase 10c-2a)`, { list: 'uservisitlogs', where: { sessionId: Array.from({ length: NAME_SOURCE_SESSIONS }, (_, index) => session(index)) } }, 2_000],
    ];
    for (const [what, query, most] of cases) {
      fake.reset();
      await ds.readLists([query]);
      const [read] = itemReads(fake);
      const sent = new URL(read.url).href;
      const without = sent.replace(/&\$select=[^&]*$/, '');
      console.log(`  ${what}: ${sent.length} characters (${without.length} without the ${selectOf(query.list).length + 1} that name its columns)`);
      assert.equal(sent.length - without.length, selectOf(query.list).length + 1, 'the columns, named once, at the end');
      assert.ok(sent.length <= most, `${what}: ${sent.length} characters`);
    }
    // (Prompt 21, Phase 3: a session's five columns of version 6 make PMSClientSessions the list that names the most; until then it was the visits'.)
    assert.ok(Object.keys(LISTS).every((key) => selectOf(key).length <= selectOf('sessions').length), 'the sessions name the most columns');
    assert.equal(selectOf('tracks').length + 1, 164);
    assert.equal(selectOf('sessions').length + 1, 171);
  });
});

// ---- The request baselines follow by translation, never by a new recording ---------------------------------------------------------------

describe('the request baselines: each entry that read items without naming their columns gets them, and nothing else moves', () => {
  it('a plain read, a read a batch carried and a mock\'s __next link get the list\'s columns; a write, a named read and a read of the list itself do not', () => {
    const at = "/sites/cec/_api/web/lists/getbytitle('PMSActivities')";
    assert.equal(selectLine(`3 x GET ${at}/items?$top=200&$filter=(ClientId eq 'c-kroger')`), `3 x GET ${at}/items?$top=200&$filter=(ClientId eq 'c-kroger')&${selectOf('sections')}`);
    assert.equal(selectLine(`    carries GET ${at}/items?$filter=AppId%20eq%20%27sec-trivia%27&$top=2`), `    carries GET ${at}/items?$filter=AppId%20eq%20%27sec-trivia%27&$top=2&${selectOf('sections')}`);
    assert.equal(selectLine(`~2 x GET ${at}/items?%24top=200&%24fakeskip=200`),
      `~2 x GET ${at}/items?%24top=200&%24select=${selectOf('sections').slice('$select='.length).replaceAll(',', '%2C')}&%24fakeskip=200`);
    for (const left of [`1 x POST ${at}/items`, `1 x MERGE ${at}/items(12)`, `1 x GET ${at}?$select=ListItemEntityTypeFullName`, `1 x GET ${at}/fields`,
      `1 x GET ${at}/items?$select=Id&$top=1&$filter=Id%20eq%201`, "1 x GET /sites/cec/_api/web/lists/getbytitle('PMSParticipantAnswers')/items?$filter=TrackId eq 't'&$select=Id,AppId,SessionId,ClientId,TrackId,ResponsesJson&$top=5",
      '# Request baseline: a header line', "1 x GET /sites/cec/_api/web/lists/getbytitle('Somebody Else')/items?$top=1"]) {
      assert.equal(selectLine(left), left);
    }
    assert.equal(selectRequest(`POST /sites/cec/_api/$batch\n    carries GET ${at}/items?$top=200`), `POST /sites/cec/_api/$batch\n    carries GET ${at}/items?$top=200&${selectOf('sections')}`);
  });
});

// ---- A create whose reply leaves a column out ---------------------------------------------------------------------------------------------

describe('a create whose reply leaves a column out', () => {
  after(() => { globalThis.fetch = realFetch; });

  it('still resolves to the record as it was written, ClientId included, and takes what the reply says over it', async () => {
    const fake = await site();
    const made = await ds.createSession({ id: 's-made', clientId: 'c-kroger', date: DAY, sectionIds: KROGER, status: 'not-started', participationMode: 'staff', activityFlow: 'sequential' });
    assert.equal(made.clientId, 'c-kroger');
    assert.equal(made.date, DAY);
    assert.deepEqual(made.sectionIds, KROGER);
    assert.equal(fake.item('sessions', 's-made').ClientId, 'c-kroger');
    const visit = await ds.beginVisit(crypto.randomUUID(), 's-made', 'c-kroger').catch((error) => error);
    assert.equal(visit.code, 'session-not-active', 'not live: refused before anything is written');
  });
});

// ---- Setup's probe -------------------------------------------------------------------------------------------------------------------------

describe('Setup\'s self-test asks what this site leaves out of a read that names no columns (read-only)', () => {
  after(() => { globalThis.fetch = realFetch; });
  const run = async (fake) => {
    ds.configure({ sharePoint: fake.settings });
    const steps = selfTestProbes(ds.probeSharePointRead, ds.sharePointListTitles());
    // (Phase 10i put a fourth probe after it.)
    assert.deepEqual(steps.map((step) => step.name).slice(-2, -1), [PROBE_LEFT_OUT]);
    fake.reset();
    return { detail: plainTitles(await steps.find((step) => step.name === PROBE_LEFT_OUT).run()), requests: fake.requests };
  };

  it('it names each list that leaves a column out, and the column; the lists with nothing in them are not read twice', async () => {
    const fake = await site();
    await goLive(ds, { clientId: 'c-kroger', date: DAY });
    await ds.beginVisit(crypto.randomUUID(), `kroger-${DAY}`, 'c-kroger');
    const { detail, requests } = await run(fake);
    assert.equal(detail, `Left out of a read that names no columns: ${TITLE.sessions}: ClientId; ${TITLE.sections}: ClientId; ${TITLE.tracks}: ClientId. `
      + `Read one item of 7 lists; empty, so not read again: ${TITLE.qrtokens}, ${TITLE.visitorroster}, ${TITLE.uservisitlogs}, ${TITLE.adminusers}, ${TITLE.responses}, ${TITLE.users}, ${TITLE.roleassignments}, ${TITLE.auditlog}, ${TITLE.sessionsummary}. `
      + 'The app names its columns in every read (Phase 10h), so nothing depends on this answer.');
    assert.equal(requests.length, 16 + 7, 'one read of each list (fifteen since Prompt 21, sixteen since its Phase 5), and a second of each that has an item');
    assert.ok(requests.every((entry) => entry.method === 'GET'), 'it only reads');
  });

  it('a site that leaves nothing out says so; a list it cannot read is named, with what the site answered; it never fails', async () => {
    const fake = await site({ leavesOut: [] });
    fake.failNext({ status: 403, times: 99, message: 'Access denied.', when: (entry) => entry.list === 'adminusers' });
    const { detail } = await run(fake);
    assert.match(detail, /^No list left a column out of a read that names no columns\. Read one item of 5 lists; /);
    assert.match(detail, new RegExp(`could not be read: ${TITLE.adminusers} \\(403: Access denied\\.\\)`));
  });
});

it('no request of this suite reached a list that is not its own, filtered on a column with no index or named no columns', () => {
  assert.deepEqual(STRAYS.map((entry) => `${entry.method} ${entry.title}`), []);
  assert.deepEqual(UNINDEXED.map((entry) => `${entry.list}.${entry.unindexed}`), []);
  assert.deepEqual(UNNAMED.map((entry) => `${entry.list}${entry.query}`), []);
});
