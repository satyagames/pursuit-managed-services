// Phase 10i: a column SharePoint will not return by name.
//
// The real site (PCOE, 15 Oct 2026, the package pms-e250a36) went live with Domino's, a participant's whole visit worked and the self-test
// passed; then Admin → Results did not load: "SharePoint (400): Value does not fall within the expected range." The request was the visit
// log's read of readNameSources, which names its columns since Phase 10h, DisplayName among them. Read one at a time, every custom column of
// every list came back but PMSVisitLog.DisplayName, and an unnamed read of that list left DisplayName out. `DisplayName` is also a property
// SharePoint gives every list item in REST (SP.ListItem.DisplayName): a column of that name can be written and not read back. PMSGuestList has
// a DisplayName column too, and only passed because it had no item; with a guest on it, a QR check-in (which reads the guest by AppId) and the
// admin's Guests and QR would fail the same way.
//
// So the mock refuses such a read when it has a row to return (scripts/sharepoint-fake.js, `refusesByName`), and this holds what the pages do
// on it: Results and the leader report name a member of staff by the sign-in their visit was logged under, and a named guest is added, gets a
// code and checks in by QR; and Setup's self-test asks the site which columns it will not return by name (part D). The guard on every column's name
// is in scripts/test-schema.js. It is not the real site.
// Run: node --test scripts/test-column-names.js (also part of npm test).
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import * as ds from '../migration/src/lib/data/dataService.js';
import { selectOf } from '../migration/src/lib/schema/pms-schema.js';
import { readNameSources, resultRows, sessionsNeedingNames } from '../migration/src/lib/admin/admin-results.js';
import { readLeaderReportRecords } from '../migration/src/lib/exports/leader-report-data.js';
import { nameParticipants } from '../migration/src/lib/results/participant-names.js';
import { samplePack } from '../migration/src/lib/setup/sample-clients.js';
import { readSessionResults } from '../migration/src/lib/results/session-results.js';
import { seedPack } from '../migration/src/lib/setup/seed.js';
import * as checks from '../migration/src/lib/setup/setup-checks.js';
import {
  REFUSED_BY_NAME, REFUSED_WORDS, STRAYS, TENANT_LEAVES_OUT, TENANT_REFUSES_BY_NAME, TITLE, UNINDEXED, UNNAMED, createSharePointFake, plainTitles,
} from './sharepoint-fake.js';

const { PROBE_LEFT_OUT, PROBE_REFUSED, selfTestProbes } = checks;

const realFetch = globalThis.fetch;
const DAY = '2026-10-15';
const SESSION = `kroger-${DAY}`;

/** A site with the sample clients on it and Kroger live today. `options` go to the mock. */
async function site(options = {}) {
  const fake = createSharePointFake(options);
  fake.install();
  ds.configure({ sharePoint: fake.settings });
  await seedPack(ds, samplePack());
  await ds.activateClient('c-kroger', DAY);
  return fake;
}
const at = (fake, key, query) => `${fake.siteUrl}/_api/web/lists/getbytitle('${fake.titleOf(key)}')/items?${query}`;
const rows = async (reply) => (await reply.json()).d.results;

describe('the mock answers a column the site will not return by name as the real site did (Phase 10i)', () => {
  after(() => { globalThis.fetch = realFetch; });
  /** A site Setup made for version 2, with its DisplayName columns, and a row in the visit log: the PCOE site as it was on 15 Oct 2026. */
  const older = (options = {}) => {
    const fake = createSharePointFake({ listsVersion: 2, ...options });
    fake.add('uservisitlogs', { AppId: 'visit-1', SessionId: SESSION, ClientId: 'c-kroger', Page: 'participant', DisplayName: 'Casey Example' });
    return fake;
  };

  it('by default DisplayName is that column, and it is left out of a read that names no columns, beside ClientId', () => {
    assert.deepEqual(TENANT_REFUSES_BY_NAME, ['DisplayName']);
    assert.deepEqual(TENANT_LEAVES_OUT, ['ClientId', 'DisplayName']);
  });

  it('an item read that names it, with a row to return, is refused with 400 and the site\'s words, and noted', async () => {
    const fake = older();
    const before = REFUSED_BY_NAME.length;
    const reply = await fake.fetch(at(fake, 'uservisitlogs', '$top=1&$select=Id,AppId,DisplayName'));
    assert.equal(reply.status, 400);
    assert.equal((await reply.json()).error.message.value, REFUSED_WORDS);
    assert.equal(REFUSED_WORDS, 'Value does not fall within the expected range.');
    assert.deepEqual(REFUSED_BY_NAME.slice(before).map((entry) => [entry.list, entry.refusedByName]), [['uservisitlogs', 'DisplayName']]);
    REFUSED_BY_NAME.splice(before);
    const plain = await rows(await fake.fetch(at(fake, 'uservisitlogs', '$top=1&$select=Id,AppId,SessionId')));
    assert.deepEqual([plain[0].AppId, plain[0].SessionId], ['visit-1', SESSION], 'the same item, with the other columns named');
  });

  it('the same read is answered when there is nothing to return: on the site PMSGuestList and PMSGuestQRCodes were empty, and passed', async () => {
    const fake = older();
    const before = REFUSED_BY_NAME.length;
    const reply = await fake.fetch(at(fake, 'visitorroster', '$top=1&$select=Id,AppId,DisplayName'));
    assert.equal(reply.status, 200);
    assert.deepEqual(await rows(reply), []);
    assert.equal(REFUSED_BY_NAME.length, before);
  });

  it('a read that names no columns (the site as it was seen, `strict: false`) leaves DisplayName out, and ClientId', async () => {
    const fake = older({ strict: false });
    const [row] = await rows(await fake.fetch(at(fake, 'uservisitlogs', '$top=200')));
    assert.deepEqual([row.AppId, row.SessionId, row.Page, 'DisplayName' in row, 'ClientId' in row], ['visit-1', SESSION, 'participant', false, false]);
    assert.equal(fake.item('uservisitlogs', 'visit-1').DisplayName, 'Casey Example', 'the list holds it');
  });

  it('`refusesByName: []` answers every read that names it', async () => {
    const fake = older({ refusesByName: [] });
    const [row] = await rows(await fake.fetch(at(fake, 'uservisitlogs', '$top=1&$select=Id,AppId,DisplayName')));
    assert.equal(row.DisplayName, 'Casey Example');
  });

  it('a site of version 2 has DisplayName where version 3 has GuestName and SignedInName, of the same type, and says version 2', () => {
    const fake = createSharePointFake({ listsVersion: 2 });
    const names = (key) => fake.fields.get(key).map((field) => field.InternalName);
    assert.deepEqual(names('visitorroster'), ['AppId', 'SessionId', 'DisplayName', 'Enabled']);
    assert.ok(names('uservisitlogs').includes('DisplayName') && !names('uservisitlogs').includes('SignedInName'));
    assert.equal(fake.item('appsettings', 'default').SchemaVersion, 2);
    const today = createSharePointFake();
    assert.deepEqual(today.fields.get('visitorroster').map((field) => field.InternalName), ['AppId', 'SessionId', 'GuestName', 'Enabled', 'GuestGroup']);
    assert.equal(today.fields.get('visitorroster')[2].TypeAsString, fake.fields.get('visitorroster')[2].TypeAsString);
    assert.equal(today.item('appsettings', 'default').SchemaVersion, 8); // (3 until Phase 20; 4 until Prompt 21; 5 until its Phase 3; 6 until its Phase 4; 7 until its Phase 5)
  });
});

describe('on the mock as the site is: a member of staff and a named guest', () => {
  after(() => { globalThis.fetch = realFetch; });

  it('Results names a member of staff by the sign-in their visit was logged under, as the leader report does', async () => {
    await site();
    // What the participant page sends for a staff visit (App.svelte, logEntry): the visit, then its row of the visit log.
    const track = await ds.beginVisit(crypto.randomUUID(), SESSION, 'c-kroger', { sharePointUserId: '42' });
    await ds.recordParticipantVisit({
      visitKey: 'visit-staff-42', sessionId: SESSION, clientId: 'c-kroger', page: 'participant', entryMode: 'staff', sharePointUserId: '42',
      displayName: 'Casey Example', visitorId: null, visitorName: '', trackId: track.id, visitedAt: new Date().toISOString(),
    });
    // Admin → Results: the session's results, then the names that are not on a track (the read that failed on the site).
    const results = await readSessionResults(SESSION);
    assert.deepEqual(sessionsNeedingNames([results]), [SESSION]);
    const sources = (await readNameSources([SESSION])).get(SESSION);
    assert.deepEqual(sources.visits.map((visit) => visit.displayName), ['Casey Example'], 'the visit log is read with the name in it');
    assert.deepEqual(resultRows(results, sources).map((row) => [row.name, row.unnamed]), [['Casey Example', false]]);
    // The leader report reads the visit log and the roster too.
    const records = await readLeaderReportRecords(SESSION);
    assert.deepEqual(nameParticipants(records).map((person) => person.name), ['Casey Example']);
  });

  it('a named guest is added, gets a code and checks in by QR: the visit carries their name, and Guests lists them', async () => {
    await site();
    await ds.setSessionParticipationMode(SESSION, 'client-visit');
    // The admin's Guests and QR: a named guest, then their code.
    const added = await ds.addGuests(SESSION, ['Jordan Lee'], { gapMs: 0 });
    assert.deepEqual(added.failed.map((entry) => entry.error.message), []);
    const [guest] = added.added;
    assert.equal(guest.displayName, 'Jordan Lee');
    assert.deepEqual((await ds.addGuests(SESSION, ['Jordan Lee'], { gapMs: 0 })).skipped, ['Jordan Lee'], 'adding the same name again reads the roster, with them on it');
    const code = await ds.provisionQrToken('c-kroger', SESSION, { visitorId: guest.id });
    // The participant page: the scan reads the guest by AppId, naming its columns, in its one batch.
    const scan = await ds.openQrScan(code.id);
    assert.equal(scan.failure, null, scan.failure?.message);
    const track = await scan.claim();
    assert.deepEqual([track.visitorId, track.participantName], [guest.id, 'Jordan Lee']);
    // And Guests and QR reads the roster and the codes again, as its look every 15 seconds does.
    const [roster, codes] = await ds.readLists([{ list: 'visitorroster', where: { sessionId: SESSION } }, { list: 'qrtokens', where: { sessionId: SESSION } }]);
    assert.deepEqual(roster.map((row) => row.displayName), ['Jordan Lee']);
    assert.deepEqual(codes.map((row) => [row.visitorId, row.used]), [[guest.id, true]]);
  });

  it('the guest list and the visit log are read naming GuestName and SignedInName, never DisplayName (schema version 3)', () => {
    assert.equal(selectOf('visitorroster'), '$select=Id,AppId,SessionId,GuestName,Enabled,GuestGroup');
    assert.equal(selectOf('uservisitlogs'), '$select=Id,AppId,SessionId,ClientId,Page,EntryMode,SharePointUserId,SignedInName,VisitorId,VisitorName,TrackId,VisitedAt');
  });
});

// ---- Setup's self-test asks which columns this site will not return by name (Phase 10i, part D) -----------------------------------------------------

describe('Setup\'s self-test asks which columns this site will not return by name (read-only, Phase 10i)', () => {
  after(() => { globalThis.fetch = realFetch; });
  /** The probe as Setup's self-test runs it, on `fake`: what it says, and every request it sent. */
  const probe = async (fake) => {
    ds.configure({ sharePoint: fake.settings });
    const steps = selfTestProbes(ds.probeSharePointRead, ds.sharePointListTitles());
    assert.equal(PROBE_REFUSED, 'Probe (read-only): columns this site will not return by name');
    assert.deepEqual(steps.map((step) => step.name).slice(-2), [PROBE_LEFT_OUT, PROBE_REFUSED], 'the fourth probe, after the third');
    fake.reset();
    const before = REFUSED_BY_NAME.length;
    const detail = plainTitles(await steps.find((step) => step.name === PROBE_REFUSED).run());
    REFUSED_BY_NAME.splice(before);
    return { detail, requests: fake.requests };
  };
  /** The PCOE site once Setup has brought it to version 3: today's columns, and the DisplayName columns version 2 made, which it keeps. */
  const upgraded = async () => {
    const fake = await site();
    const older = createSharePointFake({ listsVersion: 2 });
    for (const key of ['visitorroster', 'uservisitlogs']) fake.fields.get(key).push(older.field(key, 'DisplayName'));
    // What 15 Oct left on it (a staff visit logged under DisplayName), then what the runbook's note adds: a named guest and a code.
    const track = await ds.beginVisit(crypto.randomUUID(), SESSION, 'c-kroger', { sharePointUserId: '42' });
    fake.add('uservisitlogs', { AppId: 'visit-before', SessionId: SESSION, ClientId: 'c-kroger', Page: 'participant', EntryMode: 'staff', SharePointUserId: '42', DisplayName: 'Casey Example', TrackId: track.id });
    await ds.setSessionParticipationMode(SESSION, 'client-visit');
    const [guest] = (await ds.addGuests(SESSION, ['Jordan Lee'], { gapMs: 0 })).added;
    await ds.provisionQrToken('c-kroger', SESSION, { visitorId: guest.id });
    return fake;
  };
  const WORDS = 'Value does not fall within the expected range.';

  it('on the PCOE site after the upgrade, with a guest and a code: the two old DisplayName columns, and nothing the app reads', async () => {
    const fake = await upgraded();
    const { detail, requests } = await probe(fake);
    assert.equal(detail, `Refused when named: ${TITLE.visitorroster}.DisplayName (no longer used since version 3; 400: ${WORDS}); `
      + `${TITLE.uservisitlogs}.DisplayName (no longer used since version 3; 400: ${WORDS}). `
      + `Read one item of 10 lists, naming every column; empty, so not tested: ${TITLE.adminusers}, ${TITLE.responses}, ${TITLE.users}, ${TITLE.roleassignments}, ${TITLE.auditlog}, ${TITLE.sessionsummary}. `
      + 'No column of the app is among them (since version 3 no column is named like a property SharePoint gives every list item), so nothing depends on this answer.');
    assert.ok(requests.every((entry) => entry.method === 'GET'), 'it only reads');
    // One look at each list, its fields and one item naming every column for each of the ten with an item, and each column alone on the two that refused.
    assert.equal(requests.length, 16 + 10 + 10 + 5 + 13); // (Prompt 21: fifteen lists, twelve before; Phase 4: the guest list has one more column to read alone, GuestGroup; Phase 5: sixteen lists)
    assert.equal(requests.filter((entry) => /\/items$/.test(entry.path) && !/[?&]\$select=/.test(entry.query)).length, 0, 'every item read names its columns');
  });

  it('a site of version 3 alone: every column comes back when named; an empty list is not tested', async () => {
    const fake = await site();
    const { detail, requests } = await probe(fake);
    assert.equal(detail, 'Every column of the lists it read came back when named. Read one item of 6 lists, naming every column; empty, so not tested: '
      + `${TITLE.tracks}, ${TITLE.qrtokens}, ${TITLE.visitorroster}, ${TITLE.uservisitlogs}, ${TITLE.adminusers}, ${TITLE.responses}, ${TITLE.users}, ${TITLE.roleassignments}, ${TITLE.auditlog}, ${TITLE.sessionsummary}. `
      + 'No column of the app is among them (since version 3 no column is named like a property SharePoint gives every list item), so nothing depends on this answer.');
    assert.equal(requests.length, 16 + 6 + 6); // (Prompt 21: fifteen lists, twelve before; Phase 5: sixteen)
  });

  it('a column the app reads that the site will not return is named as such; a list it cannot read is named; it never fails', async () => {
    const fake = createSharePointFake({ refusesByName: ['Slug'] });
    fake.install();
    fake.add('clients', { AppId: 'c-a', Title: 'A', Name: 'A', Slug: 'a' });
    fake.failNext({ status: 403, times: 99, message: 'Access denied.', when: (entry) => entry.list === 'adminusers' });
    const { detail } = await probe(fake);
    assert.match(detail, new RegExp(`^Refused when named: ${TITLE.clients}\\.Slug \\(which the app reads; 400: ${WORDS.replace('.', '\\.')}\\)\\. `));
    assert.match(detail, new RegExp(`could not be read: ${TITLE.adminusers} \\(403: Access denied\\.\\)`));
    assert.match(detail, new RegExp(`The app reads ${TITLE.clients}\\.Slug: its reads of that list will fail on this site\\.$`));
  });
});

it('no request of this suite reached a list that is not its own, filtered on a column with no index, named no columns or was refused by name', () => {
  assert.deepEqual(STRAYS.map((entry) => `${entry.method} ${entry.title}`), []);
  assert.deepEqual(UNINDEXED.map((entry) => `${entry.list}.${entry.unindexed}`), []);
  assert.deepEqual(UNNAMED.map((entry) => `${entry.list}${entry.query}`), []);
  assert.deepEqual(REFUSED_BY_NAME.map((entry) => `${entry.list}${entry.query}`), []);
});
