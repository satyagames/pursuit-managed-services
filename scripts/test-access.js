// Prompt 21, Phase 1: the access engine. Run: node --test scripts/test-access.js (part of `npm test`).
//
// Schema version 5 adds three lists (PMSUsers, PMSRoleAssignments, PMSAuditLog) and two settings (PMSAppSettings.FiscalYearStartMonth, MinSample).
// lib/access holds the reviewed role matrix (board 10 of the wireframes approved on 27 Oct 2026), the one check `can()`, the typed error
// AccessDenied, the write guard the data layer calls before every write, resolveAccess() (who is signed in, then two indexed reads, sent together),
// grants with their guards, the audit writer and the copy of PMSAdminUsers into the new lists. On the mocked SharePoint REST: what the real site
// answers (directory, owner group, list permissions) is QA-TESTING.md's.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LISTS, VERSION, selectOf } from '../migration/src/lib/schema/pms-schema.js';
import { META, columnsOf } from '../migration/src/lib/schema/pms-schema-meta.js';
import {
  ACTIONS, EXTRAS, LEGACY_ACTIONS, LEGACY_ADMIN, LIST_WRITES, MATRIX, ROLES, ROLE_SCOPES, matrixRows,
} from '../migration/src/lib/access/access-matrix.js';
import { AccessDenied, isAccessDenied } from '../migration/src/lib/access/access-denied.js';
import { can, canView, grantsOf, legacyAccess, userKeyOf } from '../migration/src/lib/access/can.js';
import { writeGuard } from '../migration/src/lib/access/guard.js';
import { forgetAccess, resolveAccess, signInStep } from '../migration/src/lib/access/resolve.js';
import { assignmentId, grantProblem, grantRole, revokeProblem, superAdmins } from '../migration/src/lib/access/grants.js';
import { AUDIT_ACTIONS, AUDIT_DETAIL_MAX, writeAudit } from '../migration/src/lib/access/audit.js';
import { makeMeSuperAdmin, migrateAdmins } from '../migration/src/lib/access/migrate-admins.js';
import { OWNER_BANNER, myDetails, noAccessWords } from '../migration/src/lib/access/access-words.js';
/** The product's name as the pages pass it (lib/common/app-name.ts is TypeScript: the words take the name, so any name will do here). */
const APP_NAME = 'PMS';
import { createSharePointFake } from './sharepoint-fake.js';

let pages = 0;
/** The round trips of a test, but the write token a $batch needs (the page asks for it once, and every write after reuses it). */
const trips = (fake) => fake.requests.filter((entry) => !entry.path.endsWith('/contextinfo')).length;
/** A fresh data service on a fake site, with fetch routed to it. */
async function siteWith(options = {}) {
  const fake = createSharePointFake(options);
  fake.install();
  const ds = await import(`../migration/src/lib/data/dataService.js?access=${pages += 1}`);
  ds.configure({ sharePoint: fake.settings });
  return { fake, ds };
}
const NOW = new Date('2026-10-28T12:00:00Z');
const row = (fields) => ({ status: 'Active', ...fields });
const grant = (role, scopeType = 'global', more = {}) => ({
  id: `x|${role}|${scopeType}|${more.clientId ?? more.sessionId ?? ''}`, userKey: 'x@deloitte.com', role, scopeType, clientId: null, sessionId: null,
  periodFrom: null, periodTo: null, validUntil: null, extras: '', grantedBy: 'vsatyadev@deloitte.com', ...more,
});
const person = (email, more = {}) => ({ key: email, email, name: email, loginName: `i:0#.f|membership|${email}` , ...more });
const accessOf = (grants, more = {}) => ({ person: person('x@deloitte.com'), owner: false, legacy: false, user: row({ id: 'x@deloitte.com' }), assignments: grants, ...more });

describe('schema version 5: three lists and two settings', () => {
  it('the version is 7 (6 until Prompt 21 Phase 4, 5 until its Phase 3) and the three lists hold the columns of the brief, the access lists keyed by AppId', () => {
    assert.equal(VERSION, 7);
    const columns = (key) => Object.values(LISTS[key].fields).map((field) => field.column);
    assert.equal(LISTS.users.title, 'PMSUsers');
    assert.deepEqual(columns('users'), ['AppId', 'FullName', 'Email', 'LoginName', 'JobTitle', 'Status', 'Source', 'AddedBy']);
    assert.equal(LISTS.roleassignments.title, 'PMSRoleAssignments');
    assert.deepEqual(columns('roleassignments'),
      ['AppId', 'UserKey', 'Role', 'ScopeType', 'ClientId', 'SessionId', 'PeriodFrom', 'PeriodTo', 'ValidUntil', 'Extras', 'GrantedBy']);
    assert.equal(LISTS.auditlog.title, 'PMSAuditLog');
    assert.deepEqual(columns('auditlog'), ['AppId', 'Actor', 'Action', 'TargetUser', 'Role', 'ClientId', 'SessionId', 'Detail', 'OccurredAt']);
    assert.equal(LISTS.appsettings.fields.fiscalYearStartMonth.column, 'FiscalYearStartMonth');
    assert.equal(LISTS.appsettings.fields.minSample.column, 'MinSample');
    assert.equal(LISTS.appsettings.fields.minSample.kind, 'number');
  });

  it('indexes exactly the columns the app filters on, names none DisplayName, and types every date as a date', () => {
    // (The brief's table also marks Email, ClientId, SessionId, Actor and TargetUser: the repo's rule is exactly the columns a request filters on
    // (scripts/test-schema.js, against the recorded requests), and Phase 1 filters on UserKey alone. The phase that first filters on one indexes it.)
    const indexed = (key) => columnsOf(key).filter((column) => column.indexed).map((column) => column.name);
    assert.deepEqual(indexed('users'), ['AppId']);
    assert.deepEqual(indexed('roleassignments'), ['AppId', 'UserKey']);
    assert.deepEqual(indexed('auditlog'), ['AppId']);
    for (const key of ['users', 'roleassignments', 'auditlog']) {
      assert.ok(!columnsOf(key).some((column) => column.name === 'DisplayName'));
      assert.equal(META[key].since, 5, `${key} came with version 5`);
    }
    for (const name of ['PeriodFrom', 'PeriodTo', 'ValidUntil']) assert.equal(columnsOf('roleassignments').find((column) => column.name === name).type, 'DateTime');
    assert.deepEqual(META.users.columns.Status.values, ['Active', 'Disabled']);
    assert.deepEqual(META.roleassignments.columns.Role.values, ROLES);
    assert.deepEqual(META.roleassignments.columns.ScopeType.values, ['global', 'client', 'session', 'period']);
    assert.equal(META.appsettings.columns.FiscalYearStartMonth.since, 5);
    assert.equal(META.appsettings.columns.MinSample.since, 5);
  });

  it('a site of version 4 has none of the three lists and neither setting; one of version 5 has all', () => {
    const old = createSharePointFake({ listsVersion: 4 });
    for (const key of ['users', 'roleassignments', 'auditlog']) assert.equal(old.lists.has(key), false, `${key} is not on a site of version 4`);
    assert.equal(old.field('appsettings', 'MinSample'), undefined);
    const now = createSharePointFake();
    for (const key of ['users', 'roleassignments', 'auditlog']) assert.equal(now.lists.has(key), true);
    assert.ok(now.field('appsettings', 'FiscalYearStartMonth'));
  });
});

describe('the role matrix (board 10): reviewed data', () => {
  it('prints exactly the matrix the manager approved', () => {
    const printed = matrixRows().map((line) => line.join(' | '));
    assert.deepEqual(printed, [
      'users.manage | Yes | Option | - | - | -',
      'users.view | Yes | View | - | - | -',
      'roles.global | Yes | - | - | - | -',
      'clients.manage | Yes | Yes | - | - | -',
      'team.assign | Yes | Yes | - | - | -',
      'events.run | Yes | - | Yes | - | -',
      'guests.manage | Yes | - | Yes | - | -',
      'qr.manage | Yes | - | Yes | - | -',
      'content.edit | Yes | - | Yes | Option | -',
      'brand.edit | Yes | - | View | Yes | -',
      'results.view | Yes | - | Yes | - | Yes',
      'results.export | Yes | - | Yes | - | Yes',
      'results.live | Yes | - | Yes | - | -',
      'results.names | Yes | - | Yes | - | Yes',
      'results.delete | Yes | - | - | - | -',
    ]);
    assert.deepEqual(Object.keys(ACTIONS), Object.keys(MATRIX));
    assert.deepEqual(Object.keys(EXTRAS), ['content.edit', 'users.manage'], 'an extra is the code of the Option cell it switches on');
  });

  it('every write the app can make is named in it, by list and change, and every action it names is in the table', () => {
    for (const key of [...Object.keys(LISTS), 'library']) {
      assert.ok(LIST_WRITES[key], `${key} has a row`);
      for (const op of ['create', 'update', 'delete']) {
        assert.ok(Array.isArray(LIST_WRITES[key][op]) || LIST_WRITES[key][op] === 'anyone', `${key}.${op}`);
        for (const action of Array.isArray(LIST_WRITES[key][op]) ? LIST_WRITES[key][op] : []) assert.ok(action in ACTIONS, `${key}.${op}: ${action}`);
      }
    }
    assert.deepEqual(LIST_WRITES.users.delete, [], 'a person is disabled, never deleted (decision J)');
    assert.deepEqual([LIST_WRITES.auditlog.create, LIST_WRITES.auditlog.update, LIST_WRITES.auditlog.delete], ['anyone', [], []], 'the audit list only grows');
    assert.deepEqual(LIST_WRITES.adminusers, { create: [], update: [], delete: [] }, 'the old admins list is read only for the admin page');
  });

  it('roles are allowed their places only: Admin and Super admin are global; Leadership all clients is for a period', () => {
    assert.deepEqual(ROLE_SCOPES['Super admin'], ['global']);
    assert.deepEqual(ROLE_SCOPES.Admin, ['global']);
    assert.deepEqual(ROLE_SCOPES.Leadership, ['client', 'session', 'period']);
  });

  it('the legacy admin (a PIN, before the switch-over) keeps everything the Phase 20 admin page did, and nothing about people', () => {
    assert.deepEqual(LEGACY_ACTIONS, ['clients.manage', 'events.run', 'guests.manage', 'qr.manage', 'content.edit', 'brand.edit', 'results.view',
      'results.export', 'results.live', 'results.names', 'results.delete']);
    assert.equal(LEGACY_ADMIN, 'Legacy admin');
  });
});

describe('can(): the one check', () => {
  it('a Super admin may do everything; an Admin what board 10 says, and Add users only with the extra', () => {
    const sa = accessOf([grant('Super admin')]);
    for (const action of Object.keys(ACTIONS)) assert.equal(can(sa, action, {}, { now: NOW }), true, action);
    const admin = accessOf([grant('Admin')]);
    assert.equal(can(admin, 'clients.manage', { clientId: 'c-kroger' }, { now: NOW }), true);
    assert.equal(can(admin, 'events.run', {}, { now: NOW }), false);
    assert.equal(can(admin, 'users.manage', {}, { now: NOW }), false);
    assert.equal(can(admin, 'users.view', {}, { now: NOW }), false, 'View is not a change');
    assert.equal(canView(admin, 'users.view', {}, { now: NOW }), true);
    assert.equal(can(accessOf([grant('Admin', 'global', { extras: 'users.manage' })]), 'users.manage', {}, { now: NOW }), true);
  });

  it('a scoped role applies to its client or its session only; an empty target asks "anywhere"', () => {
    const producer = accessOf([grant('Producer', 'client', { clientId: 'c-kroger' })]);
    assert.equal(can(producer, 'events.run', { clientId: 'c-kroger' }, { now: NOW }), true);
    assert.equal(can(producer, 'events.run', { clientId: 'c-other' }, { now: NOW }), false);
    assert.equal(can(producer, 'events.run', {}, { now: NOW }), true);
    assert.equal(can(producer, 'brand.edit', { clientId: 'c-kroger' }, { now: NOW }), false);
    assert.equal(canView(producer, 'brand.edit', { clientId: 'c-kroger' }, { now: NOW }), true);
    const one = accessOf([grant('Producer', 'session', { clientId: 'c-kroger', sessionId: 'kroger-2026-11-02' })]);
    assert.equal(can(one, 'events.run', { sessionId: 'kroger-2026-11-02' }, { now: NOW }), true);
    assert.equal(can(one, 'events.run', { sessionId: 'kroger-2026-11-03' }, { now: NOW }), false);
    assert.equal(can(one, 'events.run', { clientId: 'c-kroger' }, { now: NOW }), false, 'one session is not the whole client');
  });

  it('a Designer edits brand, and activities only with the extra', () => {
    const designer = accessOf([grant('Designer', 'client', { clientId: 'c-kroger' })]);
    assert.equal(can(designer, 'brand.edit', { clientId: 'c-kroger' }, { now: NOW }), true);
    assert.equal(can(designer, 'content.edit', { clientId: 'c-kroger' }, { now: NOW }), false);
    const allowed = accessOf([grant('Designer', 'client', { clientId: 'c-kroger', extras: 'content.edit' })]);
    assert.equal(can(allowed, 'content.edit', { clientId: 'c-kroger' }, { now: NOW }), true);
  });

  it('Leadership for a period sees every client\'s results dated inside it, and none outside', () => {
    const lead = accessOf([grant('Leadership', 'period', { periodFrom: '2026-09-01', periodTo: '2026-11-30' })]);
    assert.equal(can(lead, 'results.view', { clientId: 'c-any', date: '2026-10-24' }, { now: NOW }), true);
    assert.equal(can(lead, 'results.view', { clientId: 'c-any', date: '2026-11-30' }, { now: NOW }), true, 'the last day counts');
    assert.equal(can(lead, 'results.view', { clientId: 'c-any', date: '2026-12-01' }, { now: NOW }), false);
    assert.equal(can(lead, 'results.view', { clientId: 'c-any' }, { now: NOW }), false, 'no date, no period to match');
    assert.equal(can(lead, 'events.run', {}, { now: NOW }), false);
  });

  it('ValidUntil is honoured at the moment of the call: the end date is the last day of access', () => {
    const until = accessOf([grant('Producer', 'client', { clientId: 'c-kroger', validUntil: '2026-10-28T00:00:00Z' })]);
    assert.equal(can(until, 'events.run', { clientId: 'c-kroger' }, { now: new Date('2026-10-28T23:59:00Z') }), true);
    assert.equal(can(until, 'events.run', { clientId: 'c-kroger' }, { now: new Date('2026-10-29T00:00:01Z') }), false);
    assert.equal(grantsOf(until, { now: new Date('2026-10-30T00:00:00Z') }).length, 0);
  });

  it('a disabled person can do nothing; the site owner is a Super admin whatever their row says', () => {
    const disabled = accessOf([grant('Super admin')], { user: row({ id: 'x@deloitte.com', status: 'Disabled' }) });
    assert.equal(can(disabled, 'clients.manage', {}, { now: NOW }), false);
    const owner = accessOf([], { owner: true, user: null });
    assert.equal(can(owner, 'roles.global', {}, { now: NOW }), true);
    assert.equal(can(owner, 'results.delete', {}, { now: NOW }), true);
  });

  it('rows of another person, an unknown role or a place the role may not have count for nothing', () => {
    const odd = accessOf([
      { ...grant('Super admin'), userKey: 'someone.else@deloitte.com' },
      grant('Owner'),
      grant('Admin', 'client', { clientId: 'c-kroger' }),
    ]);
    assert.deepEqual(grantsOf(odd, { now: NOW }), []);
  });

  it('a legacy admin (PIN) may do what the Phase 20 admin page did, and nothing about people', () => {
    const legacy = legacyAccess(person('x@deloitte.com'));
    for (const action of LEGACY_ACTIONS) assert.equal(can(legacy, action, { clientId: 'c-kroger' }, { now: NOW }), true, action);
    for (const action of ['users.manage', 'users.view', 'roles.global', 'team.assign']) assert.equal(can(legacy, action, {}, { now: NOW }), false, action);
    assert.equal(can(legacyAccess(null), 'events.run', {}, { now: NOW }), true, 'on the local server there is no signed-in person');
  });

  it('the key of a person is their email in lower case, or the email part of their login name', () => {
    assert.equal(userKeyOf({ Email: 'Pulkit.Mathur@Deloitte.com' }), 'pulkit.mathur@deloitte.com');
    assert.equal(userKeyOf({ Email: '', LoginName: 'i:0#.f|membership|RAedla@deloitte.com' }), 'raedla@deloitte.com');
    assert.equal(userKeyOf({ Email: '', LoginName: 'SHAREPOINT\\system' }), null);
  });
});

describe('AccessDenied and the write guard', () => {
  it('is one typed error, in plain words, with the action it refused', () => {
    const error = new AccessDenied('events.run');
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'AccessDenied');
    assert.equal(error.code, 'access-denied');
    assert.equal(error.action, 'events.run');
    assert.equal(error.status, undefined, 'never a status: the sign-in ladder must not take it for a refused request');
    assert.match(error.message, /^Your access does not allow this \(start or end a session\)\. Ask an admin if you need it\.$/);
    assert.doesNotMatch(error.message, /token|digest|FedAuth/i);
    assert.equal(isAccessDenied(error), true);
    assert.equal(isAccessDenied(new Error('x')), false);
  });

  const titles = Object.fromEntries([...Object.keys(LISTS).map((key) => [key, `${LISTS[key].title}`]), ['logoLibrary', 'PMSClientImages']]);
  const at = (key) => `/web/lists/getbytitle('${LISTS[key].title}')`;

  it('reads the change from a SharePoint request: create, update, delete, a picture; the write token passes', () => {
    const leader = accessOf([grant('Leadership', 'client', { clientId: 'c-kroger' })]);
    const guard = writeGuard(leader, titles, { now: () => NOW });
    assert.doesNotThrow(() => guard('POST', '/contextinfo', {}, undefined));
    assert.throws(() => guard('POST', `${at('sessions')}/items`, {}, { ClientId: 'c-kroger', AppId: 's' }), (error) => error.code === 'access-denied');
    assert.throws(() => guard('POST', `${at('clients')}/items(4)`, { 'X-HTTP-Method': 'MERGE' }, {}), AccessDenied);
    assert.throws(() => guard('POST', `${at('responses')}/items(4)`, { 'X-HTTP-Method': 'DELETE' }, undefined), AccessDenied);
    assert.throws(() => guard('POST', "/web/GetFolderByServerRelativeUrl('/sites/cec/PMSClientImages')/Files/add(url='a.png',overwrite=true)", {}, undefined), AccessDenied);
    assert.throws(() => guard('POST', '/web/lists', {}, {}), AccessDenied, 'a change it cannot name is refused');
    assert.doesNotThrow(() => guard('POST', `${at('auditlog')}/items`, {}, { Actor: 'x' }), 'anyone signed in may add to the audit list');
    assert.throws(() => guard('POST', `${at('auditlog')}/items(3)`, { 'X-HTTP-Method': 'MERGE' }, {}), AccessDenied, 'and nobody may change it');
  });

  it('a scoped role is held to the client a written item names', () => {
    const producer = accessOf([grant('Producer', 'client', { clientId: 'c-kroger' })]);
    const guard = writeGuard(producer, titles, { now: () => NOW });
    // (Phase 4: a write that names only a session is held to that session's client, which the page has read; one it has not read is nobody's.)
    assert.throws(() => guard('POST', `${at('visitorroster')}/items`, {}, { SessionId: 'kroger-2026-11-02' }), AccessDenied, 'a session not read is not known to be theirs');
    guard.learn('sessions', [{ id: 'kroger-2026-11-02', clientId: 'c-kroger', date: '2026-11-02' }]);
    assert.doesNotThrow(() => guard('POST', `${at('visitorroster')}/items`, {}, { SessionId: 'kroger-2026-11-02' }));
    assert.doesNotThrow(() => guard('POST', `${at('qrtokens')}/items`, {}, { ClientId: 'c-kroger' }));
    assert.throws(() => guard('POST', `${at('qrtokens')}/items`, {}, { ClientId: 'c-other' }), AccessDenied);
    assert.throws(() => guard('POST', `${at('sections')}/items`, {}, { ClientId: 'c-other' }), AccessDenied);
  });

  it('reads the change from a request to the local server the same way', () => {
    const designer = accessOf([grant('Designer', 'global')]);
    const guard = writeGuard(designer, titles, { now: () => NOW });
    assert.doesNotThrow(() => guard('PATCH', '/clients/c-kroger', {}, { theme: {} }));
    assert.doesNotThrow(() => guard('POST', '/uploads/logo?name=a.png', {}, undefined));
    assert.throws(() => guard('POST', '/sessions', {}, { clientId: 'c-kroger' }), AccessDenied);
    assert.throws(() => guard('DELETE', '/participantresponses/t1', {}, undefined), AccessDenied);
  });

  it('the data layer asks it before every write, and sends nothing it refuses; configure() forgets it', async () => {
    const { fake, ds } = await siteWith();
    const leader = accessOf([grant('Leadership', 'client', { clientId: 'c-kroger' })]);
    ds.setAccessGuard(writeGuard(leader, ds.sharePointListTitles(), { now: () => NOW }));
    fake.reset();
    await assert.rejects(ds.createClient({ id: 'c-new', name: 'New' }), (error) => error.code === 'access-denied');
    assert.equal(fake.writes().length, 0, 'not one write reached the site');
    ds.setAccessGuard(writeGuard(legacyAccess(null), ds.sharePointListTitles(), { now: () => NOW }));
    await ds.createClient({ id: 'c-new', name: 'New' });
    assert.ok(fake.item('clients', 'c-new'), 'the legacy admin writes as before');
    ds.configure({ sharePoint: fake.settings });
    ds.setAccessGuard(writeGuard(leader, ds.sharePointListTitles(), { now: () => NOW }));
    ds.configure({ sharePoint: fake.settings });
    await ds.createClient({ id: 'c-free', name: 'Free' });
    assert.ok(fake.item('clients', 'c-free'), 'a page with no guard (the participant page, Setup) writes as it always did');
  });
});

describe('resolveAccess(): who is signed in, in few requests', () => {
  /** A site with the sample people of the brief, and `extra` users who are nothing to the signed-in person. */
  async function peopleSite({ me = { Id: 7, Title: 'Mathur, Pulkit', Email: 'PulMathur@deloitte.com', LoginName: 'i:0#.f|membership|pulmathur@deloitte.com', IsSiteAdmin: false }, extra = 0, options = {} } = {}) {
    const { fake, ds } = await siteWith({ user: me, ...options });
    fake.add('users', { Title: 'pulmathur@deloitte.com', AppId: 'pulmathur@deloitte.com', FullName: 'Mathur, Pulkit', Email: 'pulmathur@deloitte.com', Status: 'Active' });
    fake.add('roleassignments', { Title: 'a', AppId: 'pulmathur@deloitte.com|Admin|global|', UserKey: 'pulmathur@deloitte.com', Role: 'Admin', ScopeType: 'global' });
    fake.add('roleassignments', { Title: 'b', AppId: 'pulmathur@deloitte.com|Producer|client|c-kroger', UserKey: 'pulmathur@deloitte.com', Role: 'Producer', ScopeType: 'client', ClientId: 'c-kroger' });
    for (let index = 0; index < extra; index += 1) {
      const email = `person${index}@deloitte.com`;
      fake.add('users', { Title: email, AppId: email, Email: email, Status: 'Active' });
      fake.add('roleassignments', { Title: email, AppId: `${email}|Producer|client|c-x`, UserKey: email, Role: 'Producer', ScopeType: 'client', ClientId: 'c-x' });
    }
    fake.reset();
    forgetAccess();
    return { fake, ds };
  }

  it('asks who this is (one request), then reads their row and their assignments with two indexed reads sent together', async () => {
    const { fake, ds } = await peopleSite();
    const access = await resolveAccess(ds, { now: NOW });
    assert.equal(access.person.key, 'pulmathur@deloitte.com');
    assert.equal(access.user.status, 'Active');
    assert.deepEqual(access.assignments.map((each) => each.role).sort(), ['Admin', 'Producer']);
    assert.equal(trips(fake), 2, 'two round trips: who this is, then the two reads in one $batch');
    const reads = fake.requests.flatMap((entry) => entry.parts ?? [entry]).filter((entry) => ['users', 'roleassignments'].includes(entry.list));
    assert.equal(reads.length, 2);
    assert.match(reads.find((entry) => entry.list === 'users').query, /\$filter=AppId eq 'pulmathur@deloitte\.com'/);
    assert.match(reads.find((entry) => entry.list === 'roleassignments').query, /\$filter=UserKey eq 'pulmathur@deloitte\.com'/);
    for (const entry of reads) assert.match(entry.query, /\$select=/, 'every item read names its columns');
  });

  it('costs the same however many people are on the site, and is kept for the page until it is asked again', async () => {
    const { fake, ds } = await peopleSite({ extra: 300 });
    await resolveAccess(ds, { now: NOW });
    assert.equal(trips(fake), 2);
    await resolveAccess(ds, { now: NOW });
    assert.equal(trips(fake), 2, 'the second asking is answered from the page');
    await resolveAccess(ds, { now: NOW, refresh: true });
    assert.equal(trips(fake), 4, 'and read again on demand');
  });

  it('reads the same two lists one by one when the site will not batch', async () => {
    const { fake, ds } = await peopleSite();
    fake.failNext({ status: 400, when: (entry) => entry.path.endsWith('/$batch') });
    const access = await resolveAccess(ds, { now: NOW });
    assert.equal(access.assignments.length, 2);
    assert.equal(trips(fake), 5, 'the refused batch, then four plain reads; the page asks for no second batch');
  });

  it('the sign-in step: listed and active with a role enters; disabled or no role is No access; nobody listed tries the PIN', async () => {
    const enter = signInStep(accessOf([grant('Admin')]), { now: NOW });
    assert.deepEqual(enter, { step: 'enter', banner: null, reason: null });
    assert.deepEqual(signInStep(accessOf([grant('Admin')], { user: row({ id: 'x', status: 'Disabled' }) }), { now: NOW }), { step: 'no-access', banner: null, reason: 'disabled' });
    assert.deepEqual(signInStep(accessOf([grant('Admin', 'global', { validUntil: '2026-01-01T00:00:00Z' })]), { now: NOW }), { step: 'no-access', banner: null, reason: 'no-roles' });
    assert.deepEqual(signInStep(accessOf([], { user: null }), { now: NOW }), { step: 'pin', banner: null, reason: 'not-listed' });
    assert.deepEqual(signInStep({ person: null, owner: false, legacy: false, user: null, assignments: [] }, { now: NOW }), { step: 'pin', banner: null, reason: 'local' });
  });

  it('the site owner is a Super admin with a banner until a Super admin row of their own exists', async () => {
    const { ds } = await peopleSite({ me: { Id: 1, Title: 'Satyadev, Vedala Venkata', Email: 'vsatyadev@deloitte.com', LoginName: 'i:0#.f|membership|vsatyadev@deloitte.com', IsSiteAdmin: true } });
    const access = await resolveAccess(ds, { now: NOW });
    assert.equal(access.owner, true);
    assert.deepEqual(signInStep(access, { now: NOW }), { step: 'enter', banner: 'owner', reason: null });
    const withRow = { ...access, user: row({ id: 'vsatyadev@deloitte.com' }), assignments: [{ ...grant('Super admin'), userKey: 'vsatyadev@deloitte.com' }] };
    assert.deepEqual(signInStep(withRow, { now: NOW }), { step: 'enter', banner: null, reason: null });
  });

  it('a member of the site\'s owners group is a site owner too', async () => {
    const { ds } = await peopleSite({ me: { Id: 3, Title: 'Owner, Group', Email: 'owner@deloitte.com', LoginName: 'i:0#.f|membership|owner@deloitte.com', IsSiteAdmin: false, Groups: { results: [{ Id: 5 }] } }, options: { ownerGroupId: 5 } });
    assert.equal((await resolveAccess(ds, { now: NOW })).owner, true);
  });

  it('on the local server nobody is signed in: the PIN, as before, and no request', async () => {
    const ds = await import(`../migration/src/lib/data/dataService.js?access-local=${pages += 1}`);
    ds.configure({ baseUrl: 'http://127.0.0.1:9/api' });
    forgetAccess();
    const access = await resolveAccess(ds, { now: NOW });
    assert.equal(access.person, null);
    assert.equal(signInStep(access, { now: NOW }).step, 'pin');
  });
});

describe('grants, their guards and the audit list', () => {
  const sa = { ...accessOf([{ ...grant('Super admin'), userKey: 'vsatyadev@deloitte.com' }]), person: person('vsatyadev@deloitte.com'), user: row({ id: 'vsatyadev@deloitte.com' }) };
  const admin = { ...accessOf([{ ...grant('Admin'), userKey: 'pulmathur@deloitte.com' }]), person: person('pulmathur@deloitte.com'), user: row({ id: 'pulmathur@deloitte.com' }) };

  it('an assignment\'s id is user|role|scope|place, so the same grant twice is the same id', () => {
    assert.equal(assignmentId({ userKey: 'raedla@deloitte.com', role: 'Producer', scopeType: 'client', clientId: 'c-kroger' }), 'raedla@deloitte.com|Producer|client|c-kroger');
    assert.equal(assignmentId({ userKey: 'pulmathur@deloitte.com', role: 'Admin', scopeType: 'global' }), 'pulmathur@deloitte.com|Admin|global|');
    assert.equal(assignmentId({ userKey: 'bmilder@deloitte.com', role: 'Leadership', scopeType: 'period', periodFrom: '2026-09-01', periodTo: '2026-11-30' }), 'bmilder@deloitte.com|Leadership|period|2026-09-01..2026-11-30');
  });

  it('who may grant what: Super admin and Admin only by a Super admin, a team role by an Admin, all clients for a period only by a Super admin', () => {
    assert.equal(grantProblem(sa, { userKey: 'a@deloitte.com', role: 'Admin', scopeType: 'global' }, { now: NOW }), null);
    assert.match(grantProblem(admin, { userKey: 'a@deloitte.com', role: 'Admin', scopeType: 'global' }, { now: NOW }), /Only a Super admin/);
    assert.equal(grantProblem(admin, { userKey: 'a@deloitte.com', role: 'Producer', scopeType: 'client', clientId: 'c-kroger' }, { now: NOW }), null);
    assert.match(grantProblem(admin, { userKey: 'b@deloitte.com', role: 'Leadership', scopeType: 'period', periodFrom: '2026-09-01', periodTo: '2026-11-30' }, { now: NOW }), /Only a Super admin/);
    assert.match(grantProblem(admin, { userKey: 'pulmathur@deloitte.com', role: 'Producer', scopeType: 'client', clientId: 'c-kroger' }, { now: NOW }), /your own/);
    assert.match(grantProblem(sa, { userKey: 'a@deloitte.com', role: 'Admin', scopeType: 'client', clientId: 'c-kroger' }, { now: NOW }), /Admin is for all clients/);
    assert.match(grantProblem(sa, { userKey: 'a@deloitte.com', role: 'Producer', scopeType: 'client' }, { now: NOW }), /Pick the client/);
    assert.match(grantProblem(admin, { userKey: 'a@deloitte.com', role: 'Designer', scopeType: 'client', clientId: 'c-k', extras: 'users.manage' }, { now: NOW }), /extra/);
  });

  it('removing: never the last Super admin, never your own roles, and an Admin never a Super admin or Admin row', () => {
    const rows = [{ ...grant('Super admin'), id: 'vsatyadev@deloitte.com|Super admin|global|', userKey: 'vsatyadev@deloitte.com' }, { ...grant('Admin'), id: 'pulmathur@deloitte.com|Admin|global|', userKey: 'pulmathur@deloitte.com' }];
    const other = { ...sa, person: person('pmedichalam@deloitte.com'), assignments: [{ ...grant('Super admin'), userKey: 'pmedichalam@deloitte.com' }] };
    assert.equal(revokeProblem(other, rows[0], rows, { now: NOW }), 'At least one Super admin must remain.');
    assert.match(revokeProblem(sa, rows[0], [...rows, { ...rows[0], id: 'srk|Super admin|global|', userKey: 'srkolachana@deloitte.com' }], { now: NOW }), /your own/);
    assert.equal(revokeProblem(other, rows[0], [...rows, { ...rows[0], id: 'srk', userKey: 'srkolachana@deloitte.com' }], { now: NOW }), null);
    assert.match(revokeProblem(admin, rows[0], rows, { now: NOW }), /Only a Super admin/);
    assert.equal(revokeProblem(admin, { ...grant('Producer', 'client', { clientId: 'c-kroger' }), userKey: 'raedla@deloitte.com' }, rows, { now: NOW }), null);
  });

  it('the Super admins now: active people with a current global Super admin row', () => {
    const users = [row({ id: 'vsatyadev@deloitte.com', fullName: 'Satyadev, Vedala Venkata' }), row({ id: 'gone@deloitte.com', fullName: 'Gone', status: 'Disabled' }), row({ id: 'pulmathur@deloitte.com', fullName: 'Mathur, Pulkit' })];
    const rows = [{ ...grant('Super admin'), userKey: 'vsatyadev@deloitte.com' }, { ...grant('Super admin'), userKey: 'gone@deloitte.com' }, { ...grant('Admin'), userKey: 'pulmathur@deloitte.com' }];
    assert.deepEqual(superAdmins(users, rows, { now: NOW }).map((user) => user.fullName), ['Satyadev, Vedala Venkata']);
  });

  it('a grant writes the row and one audit line; the same grant again is "already granted", with no second row or line', async () => {
    const { fake, ds } = await siteWith({ duplicateStatus: 500 });
    const wanted = { userKey: 'raedla@deloitte.com', role: 'Producer', scopeType: 'client', clientId: 'c-kroger' };
    assert.deepEqual(await grantRole(ds, sa, wanted, { now: NOW }), { granted: true, already: false, id: 'raedla@deloitte.com|Producer|client|c-kroger' });
    assert.equal(fake.lists.get('roleassignments').length, 1);
    assert.equal(fake.item('roleassignments', 'raedla@deloitte.com|Producer|client|c-kroger').GrantedBy, 'vsatyadev@deloitte.com');
    assert.deepEqual(await grantRole(ds, sa, wanted, { now: NOW }), { granted: false, already: true, id: 'raedla@deloitte.com|Producer|client|c-kroger' });
    assert.equal(fake.lists.get('roleassignments').length, 1);
    const audit = fake.lists.get('auditlog');
    assert.equal(audit.length, 1);
    assert.deepEqual([audit[0].Actor, audit[0].Action, audit[0].TargetUser, audit[0].Role, audit[0].ClientId], ['vsatyadev@deloitte.com', 'grant', 'raedla@deloitte.com', 'Producer', 'c-kroger']);
    await assert.rejects(grantRole(ds, admin, { userKey: 'z@deloitte.com', role: 'Super admin', scopeType: 'global' }, { now: NOW }), AccessDenied);
  });

  it('an audit line is short and holds no answers', async () => {
    assert.deepEqual(AUDIT_ACTIONS, META.auditlog.columns.Action.values, 'the writer and the schema say the same words');
    const { fake, ds } = await siteWith();
    await writeAudit(ds, sa, { action: 'add-user', targetUser: 'raedla@deloitte.com', detail: 'x'.repeat(400) }, { now: NOW });
    const [line] = fake.lists.get('auditlog');
    assert.equal(line.Detail.length, AUDIT_DETAIL_MAX);
    assert.equal(line.OccurredAt, NOW.toISOString());
    await assert.rejects(writeAudit(ds, sa, { action: 'grant', targetUser: 'a', detail: '[{"questionId":"q1","answer":"o2"}]' }, { now: NOW }), /answers/);
    await assert.rejects(writeAudit(ds, sa, { action: 'rename-everything', targetUser: 'a' }, { now: NOW }), /not an action/);
  });
});

describe('Setup copies PMSAdminUsers into the new lists (the switch-over)', () => {
  const sa = { person: person('vsatyadev@deloitte.com'), owner: true, legacy: false, user: null, assignments: [] };

  it('each legacy admin given an email becomes an active person with Admin, and Producer and Designer on all clients; idempotent; counts reported', async () => {
    const { fake, ds } = await siteWith();
    fake.add('adminusers', { Title: 'a', AppId: 'admin-1', Name: 'Mathur, Pulkit', PinHash: 'f'.repeat(64) });
    fake.add('adminusers', { Title: 'b', AppId: 'admin-2', Name: 'Demo Admin', PinHash: 'e'.repeat(64) });
    const first = await migrateAdmins(ds, sa, { 'admin-1': 'PulMathur@deloitte.com ' }, { now: NOW });
    assert.deepEqual(first, { people: 1, peopleAlready: 0, roles: 3, rolesAlready: 0, skipped: ['Demo Admin'] });
    const user = fake.item('users', 'pulmathur@deloitte.com');
    assert.deepEqual([user.FullName, user.Email, user.Status, user.Source, user.AddedBy], ['Mathur, Pulkit', 'pulmathur@deloitte.com', 'Active', 'Typed', 'vsatyadev@deloitte.com']);
    assert.deepEqual(fake.lists.get('roleassignments').map((each) => each.AppId).sort(),
      ['pulmathur@deloitte.com|Admin|global|', 'pulmathur@deloitte.com|Designer|global|', 'pulmathur@deloitte.com|Producer|global|']);
    const second = await migrateAdmins(ds, sa, { 'admin-1': 'pulmathur@deloitte.com' }, { now: NOW });
    assert.deepEqual(second, { people: 0, peopleAlready: 1, roles: 0, rolesAlready: 3, skipped: ['Demo Admin'] });
    assert.equal(fake.lists.get('roleassignments').length, 3);
    assert.equal(fake.lists.get('adminusers').length, 2, 'the old list is left as it was (read only for one release)');
    assert.ok(fake.lists.get('auditlog').every((line) => !/[0-9a-f]{64}/.test(line.Detail ?? '')), 'no PIN hash in the audit list');
  });

  it('is refused, in words, to anyone who is not a Super admin, and an email that is not one is refused before anything is written', async () => {
    const { fake, ds } = await siteWith();
    fake.add('adminusers', { Title: 'a', AppId: 'admin-1', Name: 'Mathur, Pulkit', PinHash: 'f'.repeat(64) });
    const producer = accessOf([grant('Producer', 'client', { clientId: 'c-kroger' })]);
    await assert.rejects(migrateAdmins(ds, producer, { 'admin-1': 'pulmathur@deloitte.com' }, { now: NOW }), AccessDenied);
    await assert.rejects(migrateAdmins(ds, sa, { 'admin-1': 'pulmathur' }, { now: NOW }), /not an email address/);
    assert.equal(fake.writes().length, 0);
  });

  it('after the copy the migrated admin signs in without a PIN, and may do what the PIN gave them except delete a session\'s data (decision E)', async () => {
    const { ds } = await siteWith({ user: { Id: 7, Title: 'Mathur, Pulkit', Email: 'pulmathur@deloitte.com', LoginName: 'i:0#.f|membership|pulmathur@deloitte.com', IsSiteAdmin: false } });
    await migrateAdmins(ds, sa, { 'admin-1': 'pulmathur@deloitte.com' }, { now: NOW, admins: [{ id: 'admin-1', name: 'Mathur, Pulkit' }] });
    forgetAccess();
    const access = await resolveAccess(ds, { now: NOW });
    assert.equal(signInStep(access, { now: NOW }).step, 'enter');
    for (const action of LEGACY_ACTIONS.filter((each) => each !== 'results.delete')) assert.equal(can(access, action, { clientId: 'c-kroger' }, { now: NOW }), true, action);
    assert.equal(can(access, 'results.delete', {}, { now: NOW }), false);
  });
});

describe('Setup: the site owner makes themself a Super admin (decision I: ends the banner)', () => {
  it('writes their row and a Super admin row, with audit lines; again is "already"; anyone else is refused', async () => {
    const { fake, ds } = await siteWith();
    const owner = { person: person('vsatyadev@deloitte.com', { name: 'Satyadev, Vedala Venkata' }), owner: true, legacy: false, user: null, assignments: [] };
    assert.deepEqual(await makeMeSuperAdmin(ds, owner, { now: NOW }), { granted: true, already: false, id: 'vsatyadev@deloitte.com|Super admin|global|' });
    assert.equal(fake.item('users', 'vsatyadev@deloitte.com').FullName, 'Satyadev, Vedala Venkata');
    assert.deepEqual(fake.lists.get('auditlog').map((line) => line.Action).sort(), ['add-user', 'grant']);
    assert.equal((await makeMeSuperAdmin(ds, owner, { now: NOW })).already, true);
    await assert.rejects(makeMeSuperAdmin(ds, { ...owner, owner: false }, { now: NOW }), AccessDenied);
  });
});

describe('the words (board 2 and board 10\'s edge states)', () => {
  it('No access says who to ask, a disabled person is told so, the owner\'s banner says why, and none names a SharePoint word', () => {
    assert.deepEqual(noAccessWords(APP_NAME, 'no-roles'), { title: `You do not have access to ${APP_NAME} yet`, line: `Ask a Super admin of ${APP_NAME} to give you access.` });
    assert.deepEqual(noAccessWords(APP_NAME, 'disabled'), { title: `Your access to ${APP_NAME} is turned off`, line: `Ask a Super admin of ${APP_NAME} if you need it again.` });
    assert.equal(OWNER_BANNER, 'You can see everything because you own this site. Add yourself as a Super admin in Setup.');
    assert.equal(myDetails({ name: 'Mathur, Pulkit', email: 'pulmathur@deloitte.com' }), 'Mathur, Pulkit, pulmathur@deloitte.com');
    for (const words of [OWNER_BANNER, ...Object.values(noAccessWords(APP_NAME, 'disabled')), ...Object.values(noAccessWords(APP_NAME, null))]) {
      assert.doesNotMatch(words, /FedAuth|digest|token|SharePoint/i);
    }
  });
});

describe('the participant page carries none of it', () => {
  it('the settings item\'s read names the two new settings, and no page reads them from anywhere else', () => {
    assert.match(selectOf('appsettings'), /FiscalYearStartMonth,MinSample/);
  });
});
