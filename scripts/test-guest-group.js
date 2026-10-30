// Prompt 21, Phase 4: a guest's Group tag. Schema version 7 adds PMSGuestList.GuestGroup (an optional tag; the Guest filter of Phase 5 reads it); Events adds
// a guest with a group, and a paste may say it per line ("Jordan Lee | Finance", or tab-separated from a sheet). A guest with no group is written exactly as before.
// Run: node --test scripts/test-guest-group.js (part of `npm test`).
import './fresh-page.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LISTS, VERSION } from '../migration/src/lib/schema/pms-schema.js';
import { META } from '../migration/src/lib/schema/pms-schema-meta.js';
import { MAX_GUEST_GROUP, guestGroups, inGroup, parseGuestList } from '../migration/src/lib/admin/admin-content.js';
import { createSharePointFake } from './sharepoint-fake.js';

describe('schema version 7: PMSGuestList.GuestGroup', () => {
  it('the version is 7 and the roster\'s last column is the optional GuestGroup, not indexed, since 7', () => {
    assert.equal(VERSION, 8); // (7 until Prompt 21, Phase 5)
    const fields = Object.values(LISTS.visitorroster.fields);
    assert.deepEqual(fields.map((field) => field.column), ['AppId', 'SessionId', 'GuestName', 'Enabled', 'GuestGroup']);
    assert.ok(!fields.at(-1).indexed, 'the app filters on it in Phase 5, which indexes it then');
    assert.equal(META.visitorroster.columns.GuestGroup.since, 7);
  });
});

describe('a guest list with groups', () => {
  it('a line says its group after a bar or a tab; the group of the form is for every line that names none', () => {
    const parsed = parseGuestList('Jordan Lee | Finance\nAmal Khan\tOperations\nSam Ng', { group: 'Walk-ins' });
    assert.deepEqual(parsed.guests, [{ name: 'Jordan Lee', group: 'Finance' }, { name: 'Amal Khan', group: 'Operations' }, { name: 'Sam Ng', group: 'Walk-ins' }]);
    assert.deepEqual(parsed.duplicates, []);
  });
  it('commas and semicolons still separate names, every name of the line in its group; duplicates and long names are handled as before', () => {
    const parsed = parseGuestList('A One; B Two | East\nb two\nC Three', { existing: ['c three'] });
    assert.deepEqual(parsed.guests, [{ name: 'A One', group: 'East' }, { name: 'B Two', group: 'East' }]);
    assert.deepEqual(parsed.duplicates.map((entry) => [entry.name, entry.reason]), [['b two', 'in-paste'], ['C Three', 'on-roster']]);
  });
  it('a group is tidied and cut to its length', () => {
    const parsed = parseGuestList(`X  Y |   ${'g'.repeat(MAX_GUEST_GROUP + 10)}  `);
    assert.equal(parsed.guests[0].group.length, MAX_GUEST_GROUP);
  });
  it('the groups on a roster, alphabetically, and the guests of one', () => {
    const visitors = [{ id: 'a', guestGroup: 'West' }, { id: 'b', guestGroup: 'East' }, { id: 'c' }, { id: 'd', guestGroup: 'East' }];
    assert.deepEqual(guestGroups(visitors), ['East', 'West']);
    assert.deepEqual(inGroup(visitors, 'East').map((visitor) => visitor.id), ['b', 'd']);
    assert.equal(inGroup(visitors, '').length, 4, 'all');
  });
});

describe('adding guests with a group, on the mocked SharePoint', () => {
  let pages = 0;
  async function liveSite() {
    const fake = createSharePointFake();
    fake.install();
    const ds = await import(`../migration/src/lib/data/dataService.js?group=${pages += 1}`);
    ds.configure({ sharePoint: fake.settings });
    fake.add('clients', { AppId: 'c-a', Title: 'A', Name: 'A', Slug: 'a', Status: 'active' });
    await ds.activateClient('c-a', '2026-10-14');
    return { fake, ds, sessionId: 'a-2026-10-14' };
  }
  it('a guest with a group is written with GuestGroup, and one without is written as before (no such column in the request)', async () => {
    const { fake, ds, sessionId } = await liveSite();
    fake.reset();
    const result = await ds.addGuests(sessionId, [{ name: 'Jordan Lee', group: 'Finance' }, 'Sam Ng', { name: 'Amal Khan', group: '' }]);
    assert.equal(result.added.length, 3);
    const rows = fake.lists.get('visitorroster');
    assert.deepEqual(rows.map((row) => [row.GuestName, row.GuestGroup ?? null]), [['Jordan Lee', 'Finance'], ['Sam Ng', null], ['Amal Khan', null]]);
    assert.deepEqual(rows.map((row) => 'GuestGroup' in row), [true, false, false], 'a guest with no group is written without the column, as before');
  });
  it('a single guest added with a group keeps it, and it is read back', async () => {
    const { fake, ds, sessionId } = await liveSite();
    const visitor = await ds.createVisitor({ sessionId, displayName: 'Kim Roe', enabled: true, guestGroup: 'Press' });
    assert.equal(visitor.guestGroup, 'Press');
    const [rows] = await ds.readLists([{ list: 'visitorroster', where: { sessionId } }]);
    assert.deepEqual(rows.map((row) => [row.displayName, row.guestGroup]), [['Kim Roe', 'Press']]);
    assert.equal(fake.lists.get('visitorroster')[0].GuestGroup, 'Press');
  });
});
