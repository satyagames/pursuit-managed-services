// Phase 10i, part C: Setup brings a site of version 2 up to version 3 (since Phase 20: up to this build's version, 4, whose two columns its plan
// lists as well; scripts/test-confidence-check.js holds a site of version 3 brought to 4). Run: node --test scripts/test-schema-upgrade.js (part of `npm test`).
//
// The real site (PCOE) has lists Setup made for version 2, an admin, the sample clients and Domino's live, with a participant's visit logged in
// PMSVisitLog.DisplayName, a column that site will not return by name. Version 3 keeps the guest's name in PMSGuestList.GuestName and a staff
// sign-in's in PMSVisitLog.SignedInName. On such a site the participant and admin pages stop with PMS-LST-011 until Setup has run: Show the plan
// names the two new columns and nothing else (and the old DisplayName columns under what it will not touch, as harmless), Create adds them and
// only adds, and Mark the site as ready, once the check of version 3 is clean, raises the version from 2 to 3 and says so. Then the pages work.
// It never lowers a higher version. Against the mocked SharePoint REST in its PCOE modes; the real site is QA-TESTING.md's to see.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as admin from '../migration/src/lib/data/dataService.js';
import { LISTS, VERSION } from '../migration/src/lib/schema/pms-schema.js';
import { RETIRED } from '../migration/src/lib/schema/pms-schema-meta.js';
import { readNameSources, resultRows, sessionsNeedingNames } from '../migration/src/lib/admin/admin-results.js';
import { problem } from '../migration/src/lib/settings/deploy-problems.js';
import { create, markReady, planLines, showPlan, siteApi } from '../migration/src/lib/setup/provision.js';
import { samplePack } from '../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../migration/src/lib/setup/seed.js';
import { readSessionResults } from '../migration/src/lib/results/session-results.js';
import { schemaSpecs } from '../migration/src/lib/setup/setup-checks.js';
import { PHASE_20_COLUMNS, REFUSED_BY_NAME, STRAYS, UNINDEXED, UNNAMED, createSharePointFake } from './sharepoint-fake.js';

const DAY = '2026-10-15';
const SESSION = `dominos-${DAY}`;
let pages = 0;
/** A data layer of its own (one module is one page), pointed at `fake`, with a stop handler that notes what it is handed (as lib/settings/start.ts's does). */
async function pageOn(fake) {
  const ds = await import(`../migration/src/lib/data/dataService.js?schema-upgrade=${pages += 1}`);
  const stops = [];
  ds.configure({ sharePoint: fake.settings, onStop: (code) => stops.push(code) });
  return { ds, stops };
}

/**
 * The PCOE site as it was on 15 Oct 2026: lists Setup made for version 2 (with their DisplayName columns), an admin, the sample clients, Domino's live
 * today, a participant's staff visit logged under DisplayName, and (beyond what that site had) a guest added under DisplayName. The records are the
 * ones the pages of version 2 wrote: the item said 3 while this test's own data layer wrote them, and says 2 again before anything is looked at.
 */
async function pcoe() {
  // (Phase 20: the records are written by this build's data layer, which names PMSActivities.Kind and PMSClientSessions.ConfidenceCheck in its
  // reads, so the site has them while they are written and loses them before anything is looked at, as a site of version 2 never had them.)
  const fake = createSharePointFake({ listsVersion: 2, keepColumns: PHASE_20_COLUMNS });
  fake.install();
  const { ds } = await pageOn(fake);
  fake.item('appsettings', 'default').SchemaVersion = VERSION;
  await seedPack(ds, samplePack());
  await ds.activateClient('c-dominos', DAY);
  fake.add('adminusers', { AppId: 'admin-1', Title: 'VJR', Name: 'VJR', PinHash: '0'.repeat(63) + '1' });
  const track = await ds.beginVisit(crypto.randomUUID(), SESSION, 'c-dominos', { sharePointUserId: '42' });
  fake.add('uservisitlogs', {
    AppId: 'visit-before', Title: 'visit-before', SessionId: SESSION, ClientId: 'c-dominos', Page: 'participant', EntryMode: 'staff', SharePointUserId: '42',
    DisplayName: 'Casey Example', VisitorId: null, VisitorName: '', TrackId: track.id, VisitedAt: `${DAY}T09:00:00.000Z`,
  });
  fake.add('visitorroster', { AppId: 'guest-before', Title: 'guest-before', SessionId: 'dominos-2026-10-14', DisplayName: 'Avery Stone', Enabled: true });
  fake.dropColumns(PHASE_20_COLUMNS);
  // (Go live rewrote the item: it is read again.)
  fake.item('appsettings', 'default').SchemaVersion = 2;
  fake.reset();
  return { fake, track };
}
/** Setup on `fake`: its own data layer, the calls it makes of the site, and its strict check. */
async function setup(fake) {
  const { ds } = await pageOn(fake);
  const titles = ds.sharePointListTitles();
  return { ds, api: siteApi(ds), titles, check: () => ds.checkSharePointSchema({ specs: schemaSpecs }) };
}
const coded = (code) => (error) => error.code === code;
/** What the plan says of an old DisplayName column: what it found, then the fix. */
const retired = (holds, now) => `DisplayName is no longer used since version 3: ${now} holds ${holds} now. (SharePoint gives every list item a property called DisplayName, `
  + 'and would not return a column of that name when a read named it.) Harmless: nothing reads or writes it. Leave it as it is, or a site owner may delete it by hand.';

describe('a site of version 2 (the PCOE site), before Setup has run', () => {
  it('the participant and admin pages stop with PMS-LST-011 at their first read of the settings item, and send nothing more', async () => {
    const { fake } = await pcoe();
    const participant = await pageOn(fake);
    await assert.rejects(participant.ds.readParticipantWatch({ sessionId: SESSION }), coded('PMS-LST-011'));
    const admin = await pageOn(fake);
    assert.equal((await admin.ds.listAdminUsers()).length, 1, 'the PIN is checked as before');
    await assert.rejects(admin.ds.getAppSettings(), coded('PMS-LST-011'));
    assert.deepEqual([participant.stops, admin.stops], [['PMS-LST-011'], ['PMS-LST-011']]);
    assert.equal(fake.writes().length, 0);
  });

  it('Setup says the case in full: version 2, this build needs 4 (3 until Phase 20), and what to press, in order', async () => {
    const { fake } = await pcoe();
    const { ds } = await setup(fake);
    const found = await ds.getAppSettings().then(() => null, (error) => error);
    const said = problem({ id: found.code, version: found.version, wanted: found.wanted, list: ds.sharePointListTitles().appsettings });
    assert.equal(`${said.title}. ${said.what} ${said.next} (${said.technical})`,
      "This site's lists need an update before this version of the app can use them. The lists on this site are version 2; this version of the app needs version 4. "
      + 'Open Setup (setup.html, in the same folder as this page), press Show the plan, then Create, then Mark the site as ready: a clean Create does the last step by itself. '
      + '(PMS-LST-011, SchemaVersion 2, this build needs 4)');
  });
});

describe('Setup brings it to version 4 (3 until Phase 20)', () => {
  it('Show the plan: the two new columns of version 3, the two of version 4, and nothing else; the old DisplayName columns under what it will not touch, as harmless', async () => {
    const { fake } = await pcoe();
    const site = await setup(fake);
    const { plan } = await showPlan(site.api, site.titles);
    assert.deepEqual(plan.columns.map((item) => `${item.list}.${item.name}`).sort(), [`${site.titles.visitorroster}.GuestName`, `${site.titles.uservisitlogs}.SignedInName`, `${site.titles.sessions}.ConfidenceCheck`, `${site.titles.sections}.Kind`].sort());
    assert.deepEqual([plan.lists, plan.settings], [[], []]);
    assert.equal(plan.summary, '0 lists, 4 columns, 0 settings to create');
    assert.deepEqual(plan.untouched.map((item) => [item.list, item.column, item.harmless]), [[site.titles.visitorroster, 'DisplayName', true], [site.titles.uservisitlogs, 'DisplayName', true]]);
    assert.equal(plan.toFix, 0, 'nothing to fix by hand');
    // (The two lists that gain a column of version 4 say so in lines of their own: test-confidence-check.js holds them.)
    assert.deepEqual(planLines(plan).filter((line) => ![`${site.titles.sessions} (exists)`, `${site.titles.sections} (exists)`, '  Create 1 column: ConfidenceCheck.', '  Create 1 column: Kind.'].includes(line)), [
      `${site.titles.visitorroster} (exists)`,
      '  Create 1 column: GuestName.',
      `  Will not touch (harmless): ${retired('the guest\'s name', 'GuestName')}`,
      `${site.titles.uservisitlogs} (exists)`,
      '  Create 1 column: SignedInName.',
      `  Will not touch (harmless): ${retired('the signed-in name', 'SignedInName')}`,
      '0 lists, 4 columns, 0 settings to create',
    ]);
    assert.equal(fake.writes().length, 0, 'the plan reads and never writes');
  });

  it('Create adds the four columns and only adds; Mark the site as ready raises the version: "Raised the lists from version 2 to version 4."', async () => {
    const { fake } = await pcoe();
    const site = await setup(fake);
    const { plan } = await showPlan(site.api, site.titles);
    fake.reset();
    const made = await create(site.api, plan, { gapMs: 0 });
    assert.equal(made.ok, true, made.failure?.words);
    assert.deepEqual(fake.writes().map((entry) => `${entry.method} ${entry.list} ${entry.field ?? ''}`).sort(), ['POST sections Kind', 'POST sessions ConfidenceCheck', 'POST uservisitlogs SignedInName', 'POST visitorroster GuestName']);
    assert.ok(fake.field('visitorroster', 'DisplayName') && fake.field('uservisitlogs', 'DisplayName'), 'the old columns are where they were');
    assert.equal(fake.field('uservisitlogs', 'SignedInName').TypeAsString, 'Text');
    fake.reset();
    const ready = await markReady(site.api, site.titles, { check: site.check });
    assert.deepEqual([ready.ready, ready.wrote, ready.words], [true, 'raised', 'Raised the lists from version 2 to version 4.']);
    assert.deepEqual(ready.problems, [], 'the check of version 4 found nothing: the old DisplayName columns are not a problem');
    assert.deepEqual(fake.writes().map((entry) => `${entry.method} ${entry.list}`), ['MERGE appsettings'], 'one write: the version');
    assert.equal(fake.item('appsettings', 'default').SchemaVersion, 4);
    assert.equal(fake.item('appsettings', 'default').ActiveClientId, 'c-dominos', 'and nothing else of the item changed');
    const again = await markReady(site.api, site.titles, { check: site.check });
    assert.deepEqual([again.wrote, again.words], [null, 'The site was already marked ready (version 4). Nothing was written.']);
    const plan2 = (await showPlan(site.api, site.titles)).plan;
    assert.equal(plan2.summary, 'Nothing to create', 'and the plan has nothing left to create');
    assert.equal(plan2.untouched.length, 2, 'the old columns are still listed, as harmless');
  });

  it('then the pages work: Results names a member of staff who visits now, a named guest checks in by QR, and the admin\'s Today check is clean', async () => {
    const { fake, track: before } = await pcoe();
    const site = await setup(fake);
    assert.equal((await create(site.api, (await showPlan(site.api, site.titles)).plan, { gapMs: 0 })).ok, true);
    assert.equal((await markReady(site.api, site.titles, { check: site.check })).wrote, 'raised');
    // (The admin page's own data layer: Results' modules import it.)
    const ds = admin;
    const stops = [];
    ds.configure({ sharePoint: fake.settings, onStop: (code) => stops.push(code) });
    assert.equal((await ds.getAppSettings()).schemaVersion, 4);
    // A member of staff visits, as the participant page logs it (App.svelte, logEntry).
    const now = await ds.beginVisit(crypto.randomUUID(), SESSION, 'c-dominos', { sharePointUserId: '17' });
    await ds.recordParticipantVisit({
      visitKey: 'visit-after', sessionId: SESSION, clientId: 'c-dominos', page: 'participant', entryMode: 'staff', sharePointUserId: '17', displayName: 'Priya Shah',
      visitorId: null, visitorName: '', trackId: now.id, visitedAt: new Date().toISOString(),
    });
    assert.equal(fake.item('uservisitlogs', 'visit-after').SignedInName, 'Priya Shah', 'written to the new column');
    const results = await readSessionResults(SESSION);
    const rows = resultRows(results, (await readNameSources(sessionsNeedingNames([results]))).get(SESSION));
    // The visit of before keeps its name only in the old column, which this site will not return by name: it is unnamed now.
    assert.deepEqual(rows.map((row) => [row.track.id, row.name]), [[before.id, 'Unnamed participant 1'], [now.id, 'Priya Shah']]);
    // A named guest is added, gets a code and checks in by QR.
    await ds.setSessionParticipationMode(SESSION, 'client-visit');
    const [guest] = (await ds.addGuests(SESSION, ['Jordan Lee'], { gapMs: 0 })).added;
    assert.equal(fake.item('visitorroster', guest.id).GuestName, 'Jordan Lee');
    const code = await ds.provisionQrToken('c-dominos', SESSION, { visitorId: guest.id });
    const scan = await ds.openQrScan(code.id);
    assert.equal(scan.failure, null);
    assert.equal((await scan.claim()).participantName, 'Jordan Lee');
    // Today's check (by kind and index) finds nothing wrong with the old columns either.
    assert.ok((await ds.checkSharePointSchema()).every((list) => list.ready));
    assert.deepEqual(stops, []);
  });

  it('a guest added before the upgrade has their name in the old column only: the guest list reads it as nameless', async () => {
    const { fake } = await pcoe();
    const site = await setup(fake);
    await create(site.api, (await showPlan(site.api, site.titles)).plan, { gapMs: 0 });
    await markReady(site.api, site.titles, { check: site.check });
    const { ds } = await pageOn(fake);
    const [roster] = await ds.readLists([{ list: 'visitorroster', where: { sessionId: 'dominos-2026-10-14' } }]);
    assert.deepEqual(roster.map((guest) => [guest.id, guest.displayName ?? null]), [['guest-before', null]]);
  });

  it('a site whose lists say version 5 is never lowered, and one with a problem left is not raised', async () => {
    const newer = createSharePointFake({ schemaVersion: 5 });
    newer.install();
    const site = await setup(newer);
    const result = await markReady(site.api, site.titles, { check: site.check });
    assert.deepEqual([result.ready, result.wrote], [false, null]);
    assert.equal(result.words, 'Not marked ready: the settings item says version 5; this version of the app is for version 4. Setup never lowers the version of the lists: upload the newer files.');
    assert.equal(newer.item('appsettings', 'default').SchemaVersion, 5);
    assert.equal(newer.writes().length, 0);

    const { fake } = await pcoe();
    const half = await setup(fake);
    const result2 = await markReady(half.api, half.titles, { check: half.check });
    assert.equal(result2.wrote, null, 'the four columns are not there yet');
    assert.deepEqual(result2.problems.map((entry) => `${entry.list}.${entry.column}: ${entry.problem}`).sort(), [`${half.titles.visitorroster}.GuestName: Missing.`, `${half.titles.uservisitlogs}.SignedInName: Missing.`, `${half.titles.sessions}.ConfidenceCheck: Missing.`, `${half.titles.sections}.Kind: Missing.`].sort());
    assert.equal(fake.item('appsettings', 'default').SchemaVersion, 2);
    assert.equal(fake.writes().length, 0);
  });

  it('every retired column is of a list of the schema, last used in an earlier version, and its new column is a column of that list today', () => {
    for (const [key, columns] of Object.entries(RETIRED)) {
      for (const column of columns) {
        assert.ok(column.lastIn < VERSION, `${key}.${column.name}`);
        assert.ok(Object.values(LISTS[key].fields).some((field) => field.column === column.now), `${key}.${column.now}`);
        assert.ok(!Object.values(LISTS[key].fields).some((field) => field.column === column.name), `${key}.${column.name} is not a column of today`);
      }
    }
  });
});

it('no request of this suite reached a list that is not its own, filtered on a column with no index, named no columns or was refused by name', () => {
  assert.deepEqual(STRAYS.map((entry) => `${entry.method} ${entry.title}`), []);
  assert.deepEqual(UNINDEXED.map((entry) => `${entry.list}.${entry.unindexed}`), []);
  assert.deepEqual(UNNAMED.map((entry) => `${entry.list}${entry.query}`), []);
  assert.deepEqual(REFUSED_BY_NAME.map((entry) => `${entry.list}${entry.query}`), []);
});
