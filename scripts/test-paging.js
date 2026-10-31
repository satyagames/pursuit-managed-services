// Prompt 26, Part 4: a screen draws one page and reads one index. lib/common/paging.js is the rule; the index reads (readLists with `columns`) cost the same
// however many rows the list has, up to 5,000 to a request (the most SharePoint returns in one page of a list read), on 6,000 fake rows.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as ds from '../migration/src/lib/data/dataService.js';
import { selectOf } from '../migration/src/lib/schema/pms-schema.js';
import { INDEX_TOP, PER_PAGE, hashWithPage, pageOfHash, pagerState, pageRows } from '../migration/src/lib/common/paging.js';
import { PEOPLE_INDEX } from '../migration/src/lib/admin/list-index.js';
import { auditView } from '../migration/src/lib/access/audit-review.js';
import { createSharePointFake } from './sharepoint-fake.js';

describe('the page sums', () => {
  it('each list has its constant: 5, 5, 5, 5, 20, 10', () => {
    assert.deepEqual({ ...PER_PAGE }, { people: 5, clients: 5, sessions: 5, dashboardClients: 5, guests: 20, history: 10 });
  });
  it('says where the person is', () => {
    const state = pagerState({ total: 23, pageSize: 5, page: 2 });
    assert.deepEqual([state.page, state.pages, state.from, state.to, state.line, state.range], [2, 5, 6, 10, 'Page 2 of 5', 'Showing 6 to 10 of 23']);
    assert.deepEqual([state.hasPrevious, state.hasNext], [true, true]);
    assert.deepEqual([pagerState({ total: 23, pageSize: 5, page: 1 }).hasPrevious, pagerState({ total: 23, pageSize: 5, page: 5 }).hasNext], [false, false]);
    assert.equal(pagerState({ total: 23, pageSize: 5, page: 5 }).to, 23);
  });
  it('a page emptied by a delete steps back; a changed total keeps the page; nothing at all is page 1 of 1', () => {
    assert.equal(pagerState({ total: 20, pageSize: 5, page: 5 }).page, 4);
    assert.equal(pagerState({ total: 40, pageSize: 5, page: 5 }).page, 5);
    const none = pagerState({ total: 0, pageSize: 5, page: 3 });
    assert.deepEqual([none.page, none.pages, none.from, none.to], [1, 1, 0, 0]);
    assert.equal(pagerState({ total: 7, pageSize: 5, page: 'x' }).page, 1);
  });
  it('the rows of a page', () => {
    const rows = Array.from({ length: 12 }, (_, at) => at);
    assert.deepEqual(pageRows(rows, pagerState({ total: 12, pageSize: 5, page: 3 })), [10, 11]);
  });
  it('the page is kept in the address, and any other hash is left as it is', () => {
    assert.equal(hashWithPage('#users', 2), '#users?page=2');
    assert.equal(hashWithPage('#users?page=2', 3), '#users?page=3');
    assert.equal(hashWithPage('#users?page=2', 1), '#users');
    assert.equal(pageOfHash('#users?page=4'), 4);
    assert.equal(pageOfHash('#users'), 1);
    assert.equal(pageOfHash('#users?page=abc'), 1);
    assert.equal(pageOfHash('#users?page=-3'), 1);
  });
});

describe('an index read', () => {
  let fake;
  before(() => {
    fake = createSharePointFake();
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    for (let at = 0; at < 6000; at += 1) fake.add('users', { AppId: `person${at}@example.com`, Email: `person${at}@example.com`, FullName: `Person ${at}`, Status: 'Active' });
    for (let at = 0; at < 6000; at += 1) fake.add('roleassignments', { AppId: `r${at}`, UserKey: `person${at}@example.com`, Role: 'Producer', ScopeType: 'Global' });
    fake.add('clients', { AppId: 'c-1', Name: 'One', ThemeJson: '{"long":true}', Slug: 'one' });
    fake.add('sessions', { AppId: 's-1', ClientId: 'c-1', SectionIds: '["a"]' });
    fake.reset();
  });
  after(() => { delete globalThis.fetch; });

  it('names only its columns', async () => {
    const [clients] = await ds.readLists([{ list: 'clients', columns: ['name'] }]);
    assert.deepEqual([clients[0].id, clients[0].name, clients[0].theme], ['c-1', 'One', undefined]);
    const [{ query }] = fake.requests;
    assert.match(query, /\$select=Id,AppId,Name$/);
    assert.equal(selectOf('clients', ['name']), '$select=Id,AppId,Name');
  });

  it('6,000 people cost the batch and one page more for each list, where a list read of 200 to a page cost sixty, and page 1200 is drawn from it', async () => {
    fake.reset();
    const [users, roles] = await ds.readLists(PEOPLE_INDEX.slice(0, 2));
    assert.deepEqual([users.length, roles.length], [6000, 6000]);
    assert.ok(fake.count() <= 4, `${fake.count()} requests (the write token, the batch, and one more page for each list)`);
    const state = pagerState({ total: users.length, pageSize: PER_PAGE.people, page: 1200 });
    assert.equal(pageRows(users, state).length, 5);
    assert.equal(INDEX_TOP, 5000);
  });

  it('a read with no columns reads as it always did', async () => {
    fake.reset();
    const [clients] = await ds.readLists([{ list: 'clients' }]);
    assert.equal(clients[0].name, 'One');
    assert.match(fake.requests[0].query, /\$top=200/);
    assert.ok(fake.requests[0].query.endsWith(selectOf('clients')));
  });

  it('a scoped role is still held to the places it holds', async () => {
    const seen = [];
    ds.setAccessGuard(Object.assign(() => {}, { read: (list, where) => seen.push([list, where]) }));
    try { await ds.readLists([{ list: 'clients', where: { id: 'c-1' }, columns: ['name'] }]); } finally { ds.setAccessGuard(null); }
    assert.deepEqual(seen, [['clients', { id: 'c-1' }]]);
  });
});

describe('History of changes', () => {
  it('ten lines a page, newest first', () => {
    const lines = Array.from({ length: 23 }, (_, at) => ({ id: `a${at}`, action: 'role.give', actor: 'x', occurredAt: `2026-10-${String(at + 1).padStart(2, '0')}T10:00:00.000Z` }));
    const view = auditView(lines, { page: 2 });
    assert.deepEqual([view.pages, view.total, view.rows.length, view.rows[0].id], [3, 23, 10, 'a12']);
  });
});
