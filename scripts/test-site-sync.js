// Prompt 27, Part 4: the app changes who is in the three managed PMS groups, for a Super admin, behind Setup's switch. Run: node --test
// scripts/test-site-sync.js (part of `npm test`).
//
// Part 0 on the real site (3 Nov 2026, an account that is a Member and the owner of a scratch group, not a site owner) proved: CanCurrentUserEditMembership
// false on the owners' group and true on the scratch group, ensureuser 200, an add with the verbose SP.User body 201, removebyid 200, and the owners'
// group refusing the add with 403 (-2147024891). The fake below answers the same way; anything more it does is still an approximation.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, beforeEach } from 'node:test';
import { createSharePointFake } from './sharepoint-fake.js';
import { siteApi } from '../migration/src/lib/setup/provision.js';
import { applyPermissions, permissionPlan, readPermissionState, setSiteGroupsSync } from '../migration/src/lib/setup/list-permissions.js';
import { forgetGroupIds, groupIds, knownGroupIds, membership, syncSiteAccess } from '../migration/src/lib/access/site-access.js';
import { writeGuard } from '../migration/src/lib/access/guard.js';
import { isAccessDenied } from '../migration/src/lib/access/access-denied.js';
import { LIST_WRITES } from '../migration/src/lib/access/access-matrix.js';
import { AUDIT_ACTIONS } from '../migration/src/lib/access/audit.js';
import { auditWords } from '../migration/src/lib/access/people-ops.js';
import { META } from '../migration/src/lib/schema/pms-schema-meta.js';

const FOLDER = '/sites/test/Shared Documents/PMS';
const BOSS = 'boss@x.com';
const person = (id, status = 'Active', loginName = `i:0e.t|adfs|${id.split('@')[0]}`) => ({ id, email: id, fullName: id, loginName, status, source: loginName ? 'Directory' : 'Typed' });
const role = (userKey, name) => ({ id: `${userKey}|${name}|global`, userKey, role: name, scopeType: name === 'Leadership' ? 'period' : 'global', periodFrom: '2026-01-01', periodTo: '2027-12-31', clientId: null, sessionId: null, validUntil: null, extras: '' });
const accessOf = (roleName) => ({ person: { key: BOSS, email: BOSS, name: 'Boss', loginName: '' }, owner: false, legacy: false, user: { id: BOSS, status: 'Active' }, assignments: [role(BOSS, roleName)] });

let pages = 0;
/** A site where Setup's Apply has run (the switch as given), the people and roles seeded, and the admin page's guard installed for `as`. */
async function site({ sync = true, as = 'Super admin', people = [], roles = [], ...fakeOptions } = {}) {
  forgetGroupIds();
  const fake = createSharePointFake({ sitePermissions: fakeOptions, user: { Id: 42, Title: 'Owner', IsSiteAdmin: true }, directory: fakeOptions.directory ?? [] });
  fake.install();
  const ds = await import(`../migration/src/lib/data/dataService.js?sitesync=${pages += 1}`);
  ds.configure({ sharePoint: fake.settings });
  const api = siteApi(ds);
  const titles = ds.sharePointListTitles();
  const applied = await applyPermissions(api, permissionPlan(await readPermissionState(api.read, titles, FOLDER), titles), { titles, folder: FOLDER });
  assert.equal(applied.ok, true, applied.words);
  if (sync) assert.equal((await setSiteGroupsSync(api, titles, true)).ok, true);
  for (const row of [person(BOSS), ...people]) await ds.addAccessRecord('users', row);
  for (const row of [role(BOSS, as), ...roles]) await ds.addAccessRecord('roleassignments', row);
  const access = accessOf(as);
  ds.setAccessGuard(writeGuard(access, titles));
  fake.reset();
  const groupWrites = () => fake.writes().filter((entry) => /sitegroups|ensureuser/.test(entry.path)).map((entry) => `${entry.method} ${entry.path.replace(/^.*\/_api/, '')}`);
  const audit = () => fake.writes().filter((entry) => entry.list === 'auditlog').length;
  return { fake, ds, api, titles, access, groupWrites, audit, look: fake.permissions };
}
const rowsOf = (s, key) => s.fake.exportState().lists[key];
const idOf = (s, title) => s.look.group(title).Id;
const membersOf = (s, title) => s.look.group(title).users.map((user) => user.Email);

beforeEach(() => forgetGroupIds());

describe('the guard: group writes are a Super admin\'s, and only for the three learned groups', () => {
  const titles = { users: 'PMSUsers' };
  const guardOf = (roleName) => writeGuard(accessOf(roleName), titles);
  it('a group write is its own row of the matrix, on the Super admin\'s own action', () => {
    assert.deepEqual(LIST_WRITES.sitegroup, { create: ['roles.global'], update: [], delete: ['roles.global'] });
  });
  it('an Admin is refused an add, a removal and ensureuser, before anything is sent', async () => {
    const s = await site();
    await groupIds(s.ds);
    const staff = idOf(s, 'PMS staff');
    for (const [method, resource] of [['POST', `/web/sitegroups/getbyid(${staff})/users`], ['POST', `/web/sitegroups/getbyid(${staff})/users/removebyid(7)`], ['POST', '/web/ensureuser']]) {
      assert.throws(() => guardOf('Admin')(method, resource, {}, {}), isAccessDenied, resource);
    }
  });
  it('a Super admin may change the three learned groups', async () => {
    const s = await site();
    await groupIds(s.ds);
    for (const title of ['PMS staff', 'PMS access managers', 'PMS leadership']) guardOf('Super admin')('POST', `/web/sitegroups/getbyid(${idOf(s, title)})/users`, {}, {});
    guardOf('Super admin')('POST', '/web/ensureuser', {}, {});
  });
  it('any other group is refused, even for a Super admin: the owners, PMS super admins, PMS participants, an id never learned', async () => {
    const s = await site();
    await groupIds(s.ds);
    for (const id of [3, idOf(s, 'PMS super admins'), idOf(s, 'PMS participants'), 9999]) {
      assert.throws(() => guardOf('Super admin')('POST', `/web/sitegroups/getbyid(${id})/users`, {}, {}), isAccessDenied, String(id));
    }
  });
  it('before the ids are read, every group write is refused', () => {
    forgetGroupIds();
    assert.throws(() => guardOf('Super admin')('POST', '/web/sitegroups/getbyid(100)/users', {}, {}), isAccessDenied);
  });
  it('a group\'s own settings and its creation stay Setup\'s: the admin page may not send them', () => {
    assert.throws(() => guardOf('Super admin')('POST', '/web/sitegroups', {}, {}), isAccessDenied);
    assert.throws(() => guardOf('Super admin')('POST', '/web/sitegroups/getbyid(100)/SetUserAsOwner(3)', {}, {}), isAccessDenied);
  });
});

describe('groupIds: lazy and cached', () => {
  it('reads nothing until asked, then once', async () => {
    const s = await site();
    assert.equal(knownGroupIds().size, 0);
    assert.equal(s.fake.requests.length, 0);
    const first = await groupIds(s.ds);
    const after = s.fake.requests.length;
    assert.equal(after, 1);
    assert.deepEqual(await groupIds(s.ds), first);
    assert.equal(s.fake.requests.length, after);
    assert.equal(knownGroupIds().size, 3);
    assert.equal(first.sync, true);
  });
});

describe('syncSiteAccess', () => {
  const producer = person('p@x.com');
  it('a Producer not yet on the site: ensureuser with the stored claim, added to PMS staff, one audit line', async () => {
    const s = await site({ people: [producer], roles: [role(producer.id, 'Producer')] });
    const result = await syncSiteAccess(s.ds, s.access, producer.id);
    assert.equal(result.status, 'done', result.words);
    assert.deepEqual(membersOf(s, 'PMS staff'), ['p@x.com']);
    assert.deepEqual(s.groupWrites(), ['POST /web/ensureuser', `POST /web/sitegroups/getbyid(${idOf(s, 'PMS staff')})/users`]);
    assert.equal(s.audit(), 1);
    const line = rowsOf(s, 'auditlog').at(-1);
    assert.equal(line.Action, 'site-add');
    assert.equal(line.Detail, 'staff');
  });
  it('the group write is sent as verbose JSON: under the plain type SharePoint refuses a __metadata body', async () => {
    const s = await site({ people: [producer], roles: [role(producer.id, 'Producer')] });
    await syncSiteAccess(s.ds, s.access, producer.id);
    const add = s.fake.writes().find((entry) => /\/users$/.test(entry.path));
    assert.match(add.contentType, /odata=verbose/);
  });
  it('run twice, the second does nothing', async () => {
    const s = await site({ people: [producer], roles: [role(producer.id, 'Producer')] });
    await syncSiteAccess(s.ds, s.access, producer.id);
    s.fake.reset();
    const again = await syncSiteAccess(s.ds, s.access, producer.id);
    assert.equal(again.status, 'same');
    assert.deepEqual(s.groupWrites(), []);
    assert.match(again.words, /PMS staff/);
  });
  it('an Admin: staff and access managers', async () => {
    const admin = person('a@x.com');
    const s = await site({ people: [admin], roles: [role(admin.id, 'Admin')] });
    assert.equal((await syncSiteAccess(s.ds, s.access, admin.id)).status, 'done');
    assert.deepEqual(membersOf(s, 'PMS staff'), ['a@x.com']);
    assert.deepEqual(membersOf(s, 'PMS access managers'), ['a@x.com']);
  });
  it('Producer moved to Leadership: added to leadership, then taken out of staff', async () => {
    const s = await site({ people: [producer], roles: [role(producer.id, 'Producer')] });
    await syncSiteAccess(s.ds, s.access, producer.id);
    await s.ds.removeAccessRecord('roleassignments', `${producer.id}|Producer|global`);
    await s.ds.addAccessRecord('roleassignments', role(producer.id, 'Leadership'));
    s.fake.reset();
    assert.equal((await syncSiteAccess(s.ds, s.access, producer.id)).status, 'done');
    assert.deepEqual(membersOf(s, 'PMS staff'), []);
    assert.deepEqual(membersOf(s, 'PMS leadership'), ['p@x.com']);
    const writes = s.groupWrites();
    assert.ok(writes.findIndex((each) => /\/users$/.test(each)) < writes.findIndex((each) => /removebyid/.test(each)), 'added before removed');
  });
  it('turned off: removed from the managed groups only; a site group the app does not manage is left as it was', async () => {
    const s = await site({ people: [producer], roles: [role(producer.id, 'Producer')] });
    await syncSiteAccess(s.ds, s.access, producer.id);
    s.look.addMembers('Site Members', ['p@x.com']);
    await s.ds.updateAccessRecord('users', producer.id, { status: 'Disabled' });
    assert.equal((await syncSiteAccess(s.ds, s.access, producer.id)).status, 'done');
    assert.deepEqual(membersOf(s, 'PMS staff'), []);
    assert.deepEqual(membersOf(s, 'Site Members'), ['p@x.com']);
    assert.equal(rowsOf(s, 'auditlog').at(-1).Action, 'site-remove');
  });
  it('an Admin\'s action never syncs: the person waits', async () => {
    const s = await site({ as: 'Admin', people: [producer], roles: [role(producer.id, 'Producer')] });
    const result = await syncSiteAccess(s.ds, s.access, producer.id);
    assert.equal(result.status, 'manual');
    assert.match(result.words, /A Super admin adds them/);
    assert.deepEqual(s.groupWrites(), []);
  });
  it('the switch off: manual, nothing sent', async () => {
    const s = await site({ sync: false, people: [producer], roles: [role(producer.id, 'Producer')] });
    const result = await syncSiteAccess(s.ds, s.access, producer.id);
    assert.equal(result.status, 'manual');
    assert.deepEqual(s.groupWrites(), []);
  });
  // (PCOE, 4 Nov 2026: the admin page was open when the switch was turned on in Setup, and a Super admin's grant still waited. The ids are kept for the
  // page; the switch is read again until it is on.)
  it('the switch turned on while the admin page is open is seen at the next action, with no reload', async () => {
    const s = await site({ sync: false, people: [producer], roles: [role(producer.id, 'Producer')] });
    assert.equal((await syncSiteAccess(s.ds, s.access, producer.id)).status, 'manual');
    assert.equal((await setSiteGroupsSync(s.api, s.titles, true)).ok, true);
    const result = await syncSiteAccess(s.ds, s.access, producer.id);
    assert.equal(result.status, 'done', result.words);
    assert.deepEqual(membersOf(s, 'PMS staff'), ['p@x.com']);
  });
  it('SharePoint says the group may not be edited by this account: manual, nothing sent', async () => {
    const s = await site({ people: [producer], roles: [role(producer.id, 'Producer')] });
    s.look.refuseEdits('PMS staff');
    const result = await syncSiteAccess(s.ds, s.access, producer.id);
    assert.equal(result.status, 'manual');
    assert.match(result.words, /PMS staff/);
    assert.deepEqual(s.groupWrites(), []);
  });
  it('a Typed person with no claim is looked up in the directory once; no match is manual', async () => {
    const typed = person('t@x.com', 'Active', '');
    const s = await site({ directory: [{ name: 'T', email: 't@x.com' }], people: [typed], roles: [role(typed.id, 'Designer')] });
    assert.equal((await syncSiteAccess(s.ds, s.access, typed.id)).status, 'done');
    const lost = person('n@x.com', 'Active', '');
    const t = await site({ people: [lost], roles: [role(lost.id, 'Designer')] });
    assert.equal((await syncSiteAccess(t.ds, t.access, lost.id)).status, 'manual');
    assert.deepEqual(t.groupWrites(), []);
  });
  it('a refused write is failed, with SharePoint\'s words and the SPRequestGuid, and never throws', async () => {
    const s = await site({ people: [producer], roles: [role(producer.id, 'Producer')] });
    s.fake.forbid((entry) => /\/users$/.test(entry.path));
    const result = await syncSiteAccess(s.ds, s.access, producer.id);
    assert.equal(result.status, 'failed');
    assert.match(result.words, /Access denied/);
    assert.match(result.words, /SPRequestGuid/);
  });
  it('membership: 404 is not on the site yet', async () => {
    const s = await site();
    assert.equal(await membership(s.ds, { id: 'nobody@x.com', email: 'nobody@x.com' }), null);
  });
});

describe('the audit words', () => {
  it('site-add and site-remove are actions, with the schema\'s words', () => {
    assert.ok(AUDIT_ACTIONS.includes('site-add') && AUDIT_ACTIONS.includes('site-remove'));
    assert.deepEqual(AUDIT_ACTIONS, META.auditlog.columns.Action.values);
  });
  it('a person\'s history says which group\'s role, not its title', () => {
    assert.equal(auditWords({ action: 'site-add', detail: 'staff' }), 'Added to the site\'s staff group');
    assert.equal(auditWords({ action: 'site-remove', detail: 'leadership' }), 'Taken out of the site\'s leadership group');
  });
});

describe('Apply leaves the person who pressed it out of the groups it makes', () => {
  it('SharePoint adds a group\'s maker to it; Apply takes them out again', async () => {
    const s = await site({ sync: false });
    for (const title of ['PMS super admins', 'PMS access managers', 'PMS staff', 'PMS leadership', 'PMS participants']) assert.deepEqual(membersOf(s, title), [], title);
  });
});

describe('the screens', () => {
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  it('Turn off asks first, naming the groups, when the switch is on', () => {
    const source = read('migration/src/admin/UserDetail.svelte');
    assert.match(source, /This also removes them from \$\{keys\.map\(\(key\) => ids\[key\]\?\.title/);
    assert.match(source, /lead=\{`They will not be able to use the admin page\.\$\{offGroups\}`\}/);
  });
  it('a person\'s page and the team check again after each change, and say Not checked until then', () => {
    assert.match(read('migration/src/admin/SiteAccessHandoff.svelte'), /Site access: Not checked/);
    assert.match(read('migration/src/admin/UserDetail.svelte'), /changed=\{synced\}/);
    assert.match(read('migration/src/admin/ClientTeam.svelte'), /changed=\{teamChanges\}/);
  });
  it('Setup has the switch, off by default', () => {
    assert.match(read('migration/src/setup/PermissionsPanel.svelte'), /checked=\{saved\.sync\}/);
  });
});
