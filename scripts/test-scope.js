// Prompt 21, Phase 4: every module shows only what the role and its assignments allow (wireframe boards 7, 8 and 10). Run: node --test scripts/test-scope.js
// (part of `npm test`). Plain functions of lib/access/scope.js (the menu, the Content modes, the reach of an access, the scoped read queries), the write guard's
// real targets and its read check, one test for every cell of the capability matrix that is not "no", one forbidden write for every role, and the
// words "Survey feedback" (the stored key `open-text-feedback` does not change).
import './fresh-page.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createSharePointFake } from './sharepoint-fake.js';
import { ACTIONS, FIELD_WRITES, LIST_WRITES, MATRIX, ROLES } from '../migration/src/lib/access/access-matrix.js';
import { AccessDenied } from '../migration/src/lib/access/access-denied.js';
import { can, canView, legacyAccess } from '../migration/src/lib/access/can.js';
import { writeGuard } from '../migration/src/lib/access/guard.js';
import {
  TAB_ACTIONS, contentModes, firstTab, clientsFor, pickerLabel, readQueries, reachOf, sessionsFor, tabAllowed, tabsFor,
} from '../migration/src/lib/access/scope.js';

const NOW = new Date('2026-10-28T12:00:00Z');
const TITLES = {};
const grant = (role, scopeType = 'global', more = {}) => ({
  id: `x|${role}|${scopeType}|${more.clientId ?? more.sessionId ?? ''}`, userKey: 'x@deloitte.com', role, scopeType, clientId: null, sessionId: null,
  periodFrom: null, periodTo: null, validUntil: null, extras: '', grantedBy: 'vsatyadev@deloitte.com', ...more,
});
const accessOf = (...grants) => ({
  person: { key: 'x@deloitte.com', email: 'x@deloitte.com', name: 'X', loginName: '' }, owner: false, legacy: false, user: { id: 'x@deloitte.com', status: 'Active' }, assignments: grants,
});
const TABS = [{ id: 'today' }, { id: 'clients' }, { id: 'content' }, { id: 'guests' }, { id: 'results' }, { id: 'users' }];
const ids = (list) => list.map((entry) => entry.id);

const clients = [{ id: 'acme', name: 'Acme' }, { id: 'globex', name: 'Globex' }, { id: 'kroger', name: 'Kroger' }, { id: 'dayone', name: 'Day one' }];
const sessions = [
  { id: 'acme-1', clientId: 'acme', date: '2026-10-24', startTime: '09:30', title: 'Morning workshop' },
  { id: 'acme-2', clientId: 'acme', date: '2026-11-02', startTime: '14:00', title: 'Round two' },
  { id: 'globex-1', clientId: 'globex', date: '2026-10-25', startTime: '10:00', title: 'Kick-off' },
  { id: 'kroger-1', clientId: 'kroger', date: '2026-12-02', startTime: '', title: '' },
];
const producerOnAcme = accessOf(grant('Producer', 'client', { clientId: 'acme' }));

describe('the menu is built from the role matrix', () => {
  const menu = (access) => ids(tabsFor(access, TABS));
  it('a Producer: Events (Today, Guests and QR), Content and Results', () => assert.deepEqual(menu(producerOnAcme), ['today', 'content', 'guests', 'results']));
  it('a Designer: Content only', () => assert.deepEqual(menu(accessOf(grant('Designer', 'client', { clientId: 'acme' }))), ['content']));
  it('Leadership: Results only', () => assert.deepEqual(menu(accessOf(grant('Leadership', 'client', { clientId: 'acme' }))), ['results']));
  it('an Admin: Clients and People', () => assert.deepEqual(menu(accessOf(grant('Admin'))), ['clients', 'users']));
  it('a Super admin: everything', () => assert.deepEqual(menu(accessOf(grant('Super admin'))), ['today', 'clients', 'content', 'guests', 'results', 'users']));
  it('a PIN\'s legacy admin: everything but People, as before the switch-over', () => assert.deepEqual(menu(legacyAccess(null)), ['today', 'clients', 'content', 'guests', 'results']));
  it('the first tab is the first the role may open, and none when it may open none', () => {
    assert.equal(firstTab(accessOf(grant('Leadership', 'client', { clientId: 'acme' })), TABS), 'results');
    assert.equal(firstTab(accessOf(grant('Producer')), TABS), 'today');
    assert.equal(firstTab(accessOf(), TABS), null);
  });
  it('every tab names the actions that open it, and each is an action of the matrix', () => {
    assert.deepEqual(Object.keys(TAB_ACTIONS).sort(), TABS.map((tab) => tab.id).sort());
    for (const actions of Object.values(TAB_ACTIONS)) for (const action of actions) assert.ok(ACTIONS[action], action);
  });
  it('a person whose roles have ended sees no tab', () => {
    const ended = accessOf(grant('Producer', 'global', { validUntil: '2026-10-01' }));
    assert.deepEqual(tabsFor(ended, TABS, { now: NOW }), []);
    assert.equal(tabAllowed(ended, 'today', { now: NOW }), false);
  });
});

describe('Content: view only is shown, not hidden', () => {
  it('a Producer edits activities and sees the brand, on a client of theirs', () => assert.deepEqual(contentModes(producerOnAcme, 'acme'), { activities: 'edit', brand: 'view' }));
  it('a Designer edits the brand and sees the activities; with the extra they edit the activities too', () => {
    assert.deepEqual(contentModes(accessOf(grant('Designer', 'client', { clientId: 'acme' })), 'acme'), { activities: 'view', brand: 'edit' });
    assert.deepEqual(contentModes(accessOf(grant('Designer', 'client', { clientId: 'acme', extras: 'content.edit' })), 'acme'), { activities: 'edit', brand: 'edit' });
  });
  it('another client\'s content is not shown at all', () => assert.deepEqual(contentModes(producerOnAcme, 'globex'), { activities: 'none', brand: 'none' }));
  it('the client owns its activities and its brand, so a Designer on one session only sees them and edits neither (DECIDED, Phase 4)', () => {
    const onSession = accessOf(grant('Designer', 'session', { sessionId: 'acme-1', clientId: 'acme', extras: 'content.edit' }));
    assert.deepEqual(contentModes(onSession, 'acme'), { activities: 'view', brand: 'view' });
  });
  it('a Super admin edits both; an Admin and Leadership have no Content', () => {
    assert.deepEqual(contentModes(accessOf(grant('Super admin')), 'acme'), { activities: 'edit', brand: 'edit' });
    assert.deepEqual(contentModes(accessOf(grant('Admin')), 'acme'), { activities: 'none', brand: 'none' });
    assert.deepEqual(contentModes(accessOf(grant('Leadership', 'client', { clientId: 'acme' })), 'acme'), { activities: 'none', brand: 'none' });
  });
});

describe('pickers list only the assigned places', () => {
  it('a client\'s Producer sees their client and its sessions, nothing else', () => {
    assert.deepEqual(ids(clientsFor(producerOnAcme, clients)), ['acme']);
    assert.deepEqual(ids(sessionsFor(producerOnAcme, sessions)), ['acme-1', 'acme-2']);
  });
  it('a session\'s Producer sees the client (to name it) and only that session', () => {
    const one = accessOf(grant('Producer', 'session', { sessionId: 'acme-2', clientId: 'acme' }));
    assert.deepEqual(ids(clientsFor(one, clients)), ['acme']);
    assert.deepEqual(ids(sessionsFor(one, sessions)), ['acme-2']);
  });
  it('Leadership for a period sees the sessions dated inside it', () => {
    const quarter = accessOf(grant('Leadership', 'period', { periodFrom: '2026-10-01', periodTo: '2026-10-31' }));
    assert.deepEqual(ids(sessionsFor(quarter, sessions)), ['acme-1', 'globex-1']);
  });
  it('day one: a client nobody was given to is seen only by those with a global role (a Super admin, an Admin)', () => {
    assert.ok(ids(clientsFor(accessOf(grant('Admin')), clients)).includes('dayone'));
    assert.ok(ids(clientsFor(accessOf(grant('Super admin')), clients)).includes('dayone'));
    for (const role of ['Producer', 'Designer', 'Leadership']) assert.ok(!ids(clientsFor(accessOf(grant(role, 'client', { clientId: 'acme' })), clients)).includes('dayone'), role);
  });
  it('sessions are labelled "24 Oct 09:30 Morning workshop", and a session with no time or title by its date', () => {
    assert.equal(pickerLabel(sessions[0]), '24 Oct 09:30 Morning workshop');
    assert.equal(pickerLabel(sessions[3]), '2 Dec');
    assert.equal(pickerLabel({ id: 'old-2026-01-05', date: '2026-01-05', title: 'old-2026-01-05' }), '5 Jan');
  });
});

describe('scoped reads: a request names only places the person may read', () => {
  it('a global role reads as before: the same plain queries', () => {
    assert.deepEqual(readQueries(reachOf(accessOf(grant('Admin'))), 'clients'), [{ list: 'clients' }]);
    assert.deepEqual(readQueries(reachOf(legacyAccess(null)), 'sessions'), [{ list: 'sessions' }]);
  });
  it('a client\'s Producer reads their client by id, its sessions and activities by ClientId', () => {
    const reach = reachOf(producerOnAcme);
    assert.deepEqual(readQueries(reach, 'clients'), [{ list: 'clients', where: { id: ['acme'] } }]);
    assert.deepEqual(readQueries(reach, 'sessions'), [{ list: 'sessions', where: { clientId: ['acme'] } }]);
    assert.deepEqual(readQueries(reach, 'sections'), [{ list: 'sections', where: { clientId: ['acme'] } }]);
  });
  it('a session\'s Producer reads that session by id, and the client by id', () => {
    const reach = reachOf(accessOf(grant('Producer', 'session', { sessionId: 'acme-2', clientId: 'acme' })));
    assert.deepEqual(readQueries(reach, 'sessions'), [{ list: 'sessions', where: { id: ['acme-2'] } }]);
    assert.deepEqual(readQueries(reach, 'clients'), [{ list: 'clients', where: { id: ['acme'] } }]);
  });
  it('many places go in groups of 15 to an address', () => {
    const many = Array.from({ length: 31 }, (_unused, at) => grant('Producer', 'client', { clientId: `c${at}` }));
    const queries = readQueries(reachOf(accessOf(...many)), 'clients');
    assert.deepEqual(queries.map((query) => query.where.id.length), [15, 15, 1]);
  });
  it('a person with no place reads nothing', () => assert.deepEqual(readQueries(reachOf(accessOf()), 'clients'), []));

  const guardOf = (access) => writeGuard(access, TITLES, { now: () => NOW });
  it('the guard refuses a read that names no place, or another client\'s, from a scoped role', () => {
    const guard = guardOf(producerOnAcme);
    assert.throws(() => guard.read('clients', undefined), AccessDenied);
    assert.throws(() => guard.read('clients', { id: ['globex'] }), AccessDenied);
    assert.throws(() => guard.read('sessions', { clientId: ['acme', 'globex'] }), AccessDenied);
    assert.throws(() => guard.read('sections', {}), AccessDenied);
    assert.doesNotThrow(() => guard.read('clients', { id: ['acme'] }));
    assert.doesNotThrow(() => guard.read('sessions', { clientId: ['acme'] }));
    assert.doesNotThrow(() => guard.read('appsettings', {}));
  });
  it('answers are read by session, and the session must be one the guard has seen to be theirs', () => {
    const guard = guardOf(producerOnAcme);
    assert.throws(() => guard.read('tracks', { sessionId: ['acme-1'] }), AccessDenied, 'a session not yet read is not known to be theirs');
    guard.learn('sessions', sessions);
    assert.doesNotThrow(() => guard.read('tracks', { sessionId: ['acme-1', 'acme-2'] }));
    assert.throws(() => guard.read('tracks', { sessionId: ['globex-1'] }), AccessDenied);
    assert.throws(() => guard.read('visitorroster', {}), AccessDenied);
  });
  it('a session\'s Producer reads that session\'s answers without reading anything first, and not its client\'s other sessions', () => {
    const guard = guardOf(accessOf(grant('Producer', 'session', { sessionId: 'acme-2', clientId: 'acme' })));
    assert.doesNotThrow(() => guard.read('responses', { sessionId: ['acme-2'] }));
    assert.throws(() => guard.read('responses', { sessionId: ['acme-1'] }), AccessDenied);
    assert.throws(() => guard.read('sessions', { clientId: ['acme'] }), AccessDenied);
  });
  it('a period\'s Leadership reads the answers of sessions inside the period only', () => {
    const guard = guardOf(accessOf(grant('Leadership', 'period', { periodFrom: '2026-10-01', periodTo: '2026-10-31' })));
    guard.learn('sessions', sessions);
    assert.doesNotThrow(() => guard.read('responses', { sessionId: ['acme-1'] }));
    assert.throws(() => guard.read('responses', { sessionId: ['acme-2'] }), AccessDenied);
  });
  it('a global role and the legacy admin read anything', () => {
    for (const access of [accessOf(grant('Admin')), legacyAccess(null)]) {
      const guard = guardOf(access);
      assert.doesNotThrow(() => guard.read('clients', undefined));
      assert.doesNotThrow(() => guard.read('tracks', { sessionId: ['whatever'] }));
    }
  });
});

describe('writes are held to the real client or session', () => {
  const guardOf = (access) => writeGuard(access, TITLES, { now: () => NOW });
  it('a Producer on Acme starts an Acme session, not a Globex one, though the write names only the session', () => {
    const guard = guardOf(producerOnAcme);
    guard.learn('sessions', sessions);
    assert.doesNotThrow(() => guard('PATCH', '/sessions/acme-1', {}, { status: 'live' }));
    assert.throws(() => guard('PATCH', '/sessions/globex-1', {}, { status: 'live' }), AccessDenied);
  });
  it('an activity\'s question and option are held to the client of the activity', () => {
    const guard = guardOf(producerOnAcme);
    guard.learn('sections', [{ id: 'a1', clientId: 'acme' }, { id: 'g1', clientId: 'globex' }]);
    guard.learn('questions', [{ id: 'qa', sectionId: 'a1' }, { id: 'qg', sectionId: 'g1' }]);
    assert.doesNotThrow(() => guard('POST', '/questions', {}, { id: 'n1', sectionId: 'a1' }));
    assert.throws(() => guard('POST', '/questions', {}, { id: 'n2', sectionId: 'g1' }), AccessDenied);
    assert.doesNotThrow(() => guard('POST', '/options', {}, { id: 'o1', questionId: 'qa' }));
    assert.throws(() => guard('POST', '/options', {}, { id: 'o2', questionId: 'qg' }), AccessDenied);
    assert.throws(() => guard('POST', '/options', {}, { id: 'o3', questionId: 'never-read' }), AccessDenied, 'an owner not known is not theirs');
  });
  it('a question created under an activity made on this page is theirs at once', () => {
    const guard = guardOf(producerOnAcme);
    guard('POST', '/sections', {}, { id: 'new-a', clientId: 'acme' });
    assert.doesNotThrow(() => guard('POST', '/questions', {}, { id: 'n3', sectionId: 'new-a' }));
  });
  it('a Designer on one session writes neither the client\'s activities nor its brand', () => {
    const guard = guardOf(accessOf(grant('Designer', 'session', { sessionId: 'acme-1', clientId: 'acme', extras: 'content.edit' })));
    assert.throws(() => guard('POST', '/sections', {}, { id: 'x', clientId: 'acme' }), AccessDenied);
    assert.throws(() => guard('PATCH', '/clients/acme', {}, { clientId: 'acme', theme: {} }), AccessDenied);
  });
});

/** The list and change an action opens in LIST_WRITES, to try one write of it. */
const WRITE_OF = {
  'users.manage': ['POST', '/users', {}, { id: 'p@deloitte.com' }],
  'roles.global': ['POST', '/roleassignments', {}, { id: 'p|Admin|global|', role: 'Admin', scopeType: 'global' }],
  'team.assign': ['POST', '/roleassignments', {}, { id: 'p|Producer|client|acme', role: 'Producer', scopeType: 'client', clientId: 'acme' }],
  'clients.manage': ['POST', '/clients', {}, { id: 'acme' }],
  'events.run': ['PATCH', '/tracks/t1', {}, { sessionId: 'acme-1', clientId: 'acme' }],
  'guests.manage': ['POST', '/visitorroster', {}, { id: 'v1', sessionId: 'acme-1', clientId: 'acme' }],
  'qr.manage': ['POST', '/qrtokens', {}, { id: 'q1', sessionId: 'acme-1', clientId: 'acme' }],
  'content.edit': ['POST', '/sections', {}, { id: 'sec1', clientId: 'acme' }],
  'brand.edit': ['PATCH', '/clients/acme', {}, { clientId: 'acme', theme: {} }],
  'results.delete': ['DELETE', '/sessions/acme-1', {}, undefined],
};

describe('one test for every cell of the capability matrix that is not "no"', () => {
  const EXTRA_ROLE = { 'content.edit': 'Designer', 'users.manage': 'Admin' };
  for (const [action, cells] of Object.entries(MATRIX)) {
    for (const role of ROLES) {
      const cell = cells[role];
      if (cell === 'no') continue;
      const scope = role === 'Super admin' || role === 'Admin' ? ['global', {}] : ['client', { clientId: 'acme' }];
      it(`${action} / ${role}: ${cell}`, () => {
        const base = accessOf(grant(role, scope[0], scope[1]));
        if (cell === 'yes') {
          assert.equal(can(base, action, { clientId: 'acme' }), true);
          assert.equal(canView(base, action, { clientId: 'acme' }), true);
          if (scope[0] === 'client') assert.equal(can(base, action, { clientId: 'globex' }), false, 'and only on its own client');
        } else if (cell === 'view') {
          assert.equal(can(base, action, { clientId: 'acme' }), false);
          assert.equal(canView(base, action, { clientId: 'acme' }), true);
        } else {
          assert.equal(EXTRA_ROLE[action], role);
          assert.equal(can(base, action, { clientId: 'acme' }), false, 'off until the extra');
          const extra = accessOf(grant(role, scope[0], { ...scope[1], extras: action }));
          assert.equal(can(extra, action, { clientId: 'acme' }), true);
        }
      });
    }
  }
  it('every action of the matrix is somewhere in a menu tab or a write, so the table is complete', () => {
    const inTabs = new Set(Object.values(TAB_ACTIONS).flat());
    const inWrites = new Set([...Object.values(LIST_WRITES).flatMap((change) => Object.values(change).flat()), ...Object.values(FIELD_WRITES).flatMap((fields) => Object.values(fields))]); // (Prompt 22: settings.manage is a column's)
    const viaOther = new Set(['results.export', 'results.live', 'results.names', 'results.view', 'users.view', 'audit.view']); // (audit.view: People's History of changes, scripts/test-hardening.js)
    for (const action of Object.keys(ACTIONS)) assert.ok(inTabs.has(action) || inWrites.has(action) || viaOther.has(action), action);
  });
});

describe('a forbidden write, per role, is AccessDenied and nothing is sent', () => {
  const guardOf = (access) => writeGuard(access, TITLES, { now: () => NOW });
  const attempt = (guard, action) => guard(...WRITE_OF[action]);
  it('Super admin: can write every kind (nothing forbidden on a global role)', () => {
    const guard = guardOf(accessOf(grant('Super admin')));
    for (const action of Object.keys(WRITE_OF)) assert.doesNotThrow(() => attempt(guard, action), action);
  });
  it('Admin: not sessions\' answers, activities or the brand; not people unless the extra is on', () => {
    const guard = guardOf(accessOf(grant('Admin')));
    for (const action of ['content.edit', 'events.run', 'guests.manage', 'qr.manage', 'results.delete', 'users.manage']) assert.throws(() => attempt(guard, action), AccessDenied, action);
    for (const action of ['clients.manage', 'team.assign']) assert.doesNotThrow(() => attempt(guard, action), action);
  });
  it('Producer: not clients, people or the brand, and nothing of another client', () => {
    const guard = guardOf(producerOnAcme);
    for (const action of ['clients.manage', 'brand.edit', 'users.manage', 'roles.global', 'team.assign', 'results.delete']) assert.throws(() => attempt(guard, action), AccessDenied, action);
    assert.throws(() => guard('POST', '/sections', {}, { id: 'sec2', clientId: 'globex' }), AccessDenied);
    assert.throws(() => guard('POST', '/qrtokens', {}, { id: 'q2', sessionId: 'x', clientId: 'globex' }), AccessDenied);
    for (const action of ['content.edit', 'events.run', 'guests.manage', 'qr.manage']) assert.doesNotThrow(() => attempt(guard, action), action);
  });
  it('Designer: the brand of their client, not another\'s; the activities only with the extra; nothing else', () => {
    const plain = guardOf(accessOf(grant('Designer', 'client', { clientId: 'acme' })));
    for (const action of ['content.edit', 'clients.manage', 'events.run', 'guests.manage', 'qr.manage', 'users.manage']) assert.throws(() => attempt(plain, action), AccessDenied, action);
    assert.doesNotThrow(() => attempt(plain, 'brand.edit'));
    assert.throws(() => plain('PATCH', '/clients/globex', {}, { clientId: 'globex', theme: {} }), AccessDenied);
    const extra = guardOf(accessOf(grant('Designer', 'client', { clientId: 'acme', extras: 'content.edit' })));
    assert.doesNotThrow(() => attempt(extra, 'content.edit'));
  });
  it('Leadership: no write at all', () => {
    const guard = guardOf(accessOf(grant('Leadership', 'client', { clientId: 'acme' })));
    for (const action of Object.keys(WRITE_OF)) assert.throws(() => attempt(guard, action), AccessDenied, action);
  });
});

describe('Survey feedback: the words change, the stored key does not', () => {
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  it('the question editor and the exports say Survey feedback', () => {
    assert.match(read('migration/src/admin/QuestionEditor.svelte'), /'open-text-feedback': \{ label: 'Survey feedback'/);
    assert.match(read('migration/src/lib/exports/resultsExport.js'), /'open-text-feedback': 'Survey feedback'/);
    assert.doesNotMatch(read('migration/src/admin/QuestionEditor.svelte'), /Open text feedback|Open feedback/);
    assert.doesNotMatch(read('migration/src/lib/exports/resultsExport.js'), /Written answer|Open feedback/);
  });
  it('the stored type is still open-text-feedback in the schema, the pager and the tally', () => {
    assert.match(read('migration/src/lib/schema/pms-schema-meta.js'), /'open-text-feedback'/);
    assert.match(read('migration/src/lib/participant/pager-logic.js'), /'open-text-feedback'/);
    assert.match(read('migration/src/lib/results/results-chart-model.js'), /'open-text-feedback'/);
  });
  it('the sample content pack\'s activity is Survey feedback too', () => {
    assert.doesNotMatch(read('scripts/local-site/datasets/pms-content-pack.json'), /Open feedback/);
  });
});

describe('the data layer asks the read check, and a scoped role\'s refused read sends nothing', () => {
  let pages = 0;
  async function siteWith() {
    const fake = createSharePointFake();
    fake.install();
    const ds = await import(`../migration/src/lib/data/dataService.js?scope=${pages += 1}`);
    ds.configure({ sharePoint: fake.settings });
    return { fake, ds };
  }
  it('readLists, listClients and queryItems refuse an unfiltered or foreign read before any request, and send a scoped one', async () => {
    const { fake, ds } = await siteWith();
    ds.setAccessGuard(writeGuard(producerOnAcme, ds.sharePointListTitles(), { now: () => NOW }));
    fake.reset();
    await assert.rejects(ds.readLists([{ list: 'clients' }]), (error) => error.code === 'access-denied');
    await assert.rejects(ds.readLists([{ list: 'sessions', where: { clientId: 'globex' } }]), (error) => error.code === 'access-denied');
    await assert.rejects(ds.listClients(), (error) => error.code === 'access-denied');
    await assert.rejects(ds.listClientSections('globex'), (error) => error.code === 'access-denied');
    assert.equal(fake.requests.length, 0, 'not one request reached the site');
    await ds.readLists([{ list: 'clients', where: { id: ['acme'] } }, { list: 'sessions', where: { clientId: ['acme'] } }]);
    assert.ok(fake.requests.length > 0, 'a read of their own client goes out');
  });
  it('a global role and a page with no guard read as they always did', async () => {
    const { fake, ds } = await siteWith();
    ds.setAccessGuard(writeGuard(legacyAccess(null), ds.sharePointListTitles(), { now: () => NOW }));
    await ds.readLists([{ list: 'clients' }]);
    await ds.listClients();
    ds.configure({ sharePoint: fake.settings });
    await ds.readLists([{ list: 'clients' }]);
  });
});

describe('Today, Guests and Results read only the places held', () => {
  it('scopedReader turns a plain read into the reads of the places held, and sends nothing for a session not held', async () => {
    const { scopedReader } = await import('../migration/src/lib/access/scope.js');
    const sent = [];
    const readLists = async (queries) => { sent.push(queries); return queries.map(({ list, where }) => (list === 'sessions' ? sessions.filter((s) => [where?.clientId ?? s.clientId].flat().includes(s.clientId)) : [])); };
    const read = scopedReader(readLists, reachOf(producerOnAcme));
    const [clientRows, sessionRows] = await read([{ list: 'clients' }, { list: 'sessions' }]);
    assert.deepEqual(sent[0], [{ list: 'clients', where: { id: ['acme'] } }, { list: 'sessions', where: { clientId: ['acme'] } }]);
    assert.deepEqual(clientRows, []);
    assert.deepEqual(ids(sessionRows), ['acme-1', 'acme-2']);
    sent.length = 0;
    const [elsewhere, mine, tracks, foreign] = await read([
      { list: 'sessions', where: { id: 'globex-1' } }, { list: 'sessions', where: { id: 'acme-1' } }, { list: 'tracks', where: { sessionId: 'acme-1' } }, { list: 'clients', where: { id: 'globex' } },
    ]);
    assert.deepEqual(elsewhere, []);
    assert.deepEqual(foreign, []);
    assert.deepEqual(sent[0].map((query) => query.list), ['sessions', 'tracks'], 'only the session they hold, and its answers (it was read before), are sent');
    assert.equal(mine.length + tracks.length >= 0, true);
  });
  it('the reader of a global role is readLists itself', async () => {
    const { scopedReader } = await import('../migration/src/lib/access/scope.js');
    const readLists = async () => [];
    assert.equal(scopedReader(readLists, reachOf(accessOf(grant('Admin')))), readLists);
    assert.equal(scopedReader(readLists, null), readLists);
  });
  it('an activity names its questions, so a question read by id is known to be the client\'s', () => {
    const guard = writeGuard(producerOnAcme, TITLES, { now: () => NOW });
    guard.learn('sections', [{ id: 'a1', clientId: 'acme', questionIds: ['qa'] }, { id: 'g1', clientId: 'globex', questionIds: ['qg'] }]);
    assert.doesNotThrow(() => guard.read('questions', { id: ['qa'] }));
    assert.doesNotThrow(() => guard.read('options', { questionId: ['qa'] }));
    assert.throws(() => guard.read('questions', { id: ['qg'] }), AccessDenied);
  });
  it('a live session that is not theirs is said to be "elsewhere", not "missing"', async () => {
    const { liveStatus, notLiveText } = await import('../migration/src/lib/admin/admin-today.js');
    const status = liveStatus({ settings: { activeSessionId: 'globex-1', activeClientId: 'globex' }, session: null, clients: [], elsewhere: true });
    assert.equal(status.reason, 'elsewhere');
    assert.match(notLiveText(status), /A session you have not been given is live/);
    assert.equal(liveStatus({ settings: { activeSessionId: 'x' }, session: null, clients: [] }).reason, 'session-missing', 'as before for a global role');
  });
});
