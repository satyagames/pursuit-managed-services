// Prompt 27: the PMS groups, Setup's Apply and the drift report. Run: node --test scripts/test-site-access.js (part of `npm test`).
//
// Parts 1 to 3 only. The SharePoint answers come from scripts/sharepoint-fake.js with `sitePermissions` on, which is an APPROXIMATION of the calls as the
// brief describes them: every one of them is ASSUMED until tried on the real site (QA-TESTING.md).
import './fresh-page.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createSharePointFake } from './sharepoint-fake.js';
import { siteApi } from '../migration/src/lib/setup/provision.js';
import {
  GROUP_MATRIX, PMS_GROUPS, SECRET_LISTS, applyPermissions, matrixTable, permissionFindings, permissionPlan, readPermissionState, removeSiteGroups, removalPlan,
} from '../migration/src/lib/setup/list-permissions.js';
import { selfTestProbes, PROBE_SITE_ACCESS } from '../migration/src/lib/setup/setup-checks.js';
import { MANAGED_GROUPS, desiredGroups, driftOf, groupsOfRow, readDrift, siteGroupsAddress } from '../migration/src/lib/access/site-access.js';
import { SITE_ACCESS_ADD_USER, siteAccessNote } from '../migration/src/lib/access/access-words.js';

const NOW = new Date('2026-11-02T12:00:00Z');
const FOLDER = '/sites/test/Shared Documents/PMS';
const user = (id, status = 'Active', more = {}) => ({ id, email: id, fullName: id, status, ...more });
const role = (userKey, name, more = {}) => ({ id: `${userKey}|${name}`, userKey, role: name, scopeType: name === 'Leadership' ? 'client' : 'global', clientId: name === 'Leadership' ? 'c' : null, sessionId: null, periodFrom: null, periodTo: null, validUntil: null, extras: '', ...more });

let pages = 0;
async function site(sitePermissions = {}) {
  const fake = createSharePointFake({ sitePermissions, user: { Id: 42, Title: 'Owner', IsSiteAdmin: false } });
  fake.install();
  const ds = await import(`../migration/src/lib/data/dataService.js?siteaccess=${pages += 1}`);
  ds.configure({ sharePoint: fake.settings });
  return { fake, ds, api: siteApi(ds), titles: ds.sharePointListTitles(), read: fake.permissions };
}
const stateOf = ({ api, titles }) => readPermissionState(api.read, titles, FOLDER);
const paths = (fake) => fake.writes().map((entry) => entry.path.replace(/^.*\/_api/, ''));
const targetOf = (s, title) => s.read.scope(title);

describe('desiredGroups: what the app wants of a person', () => {
  const wanted = (u, ...roles) => desiredGroups(u, roles, NOW);
  const me = user('a@x.com');
  it('Super admin and Admin: staff and access managers', () => {
    assert.deepEqual(wanted(me, role(me.id, 'Super admin')), ['staff', 'managers']);
    assert.deepEqual(wanted(me, role(me.id, 'Admin')), ['staff', 'managers']);
  });
  it('Producer or Designer: staff', () => {
    assert.deepEqual(wanted(me, role(me.id, 'Producer')), ['staff']);
    assert.deepEqual(wanted(me, role(me.id, 'Designer')), ['staff']);
  });
  it('Leadership: leadership', () => assert.deepEqual(wanted(me, role(me.id, 'Leadership')), ['leadership']));
  it('turned off, expired or no role: none', () => {
    assert.deepEqual(wanted(user(me.id, 'Disabled'), role(me.id, 'Admin')), []);
    assert.deepEqual(wanted(me, role(me.id, 'Admin', { validUntil: '2026-01-01' })), []);
    assert.deepEqual(wanted(me), []);
  });
  it('mixed roles are the union', () => {
    assert.deepEqual(wanted(me, role(me.id, 'Leadership'), role(me.id, 'Producer')), ['staff', 'leadership']);
  });
  it('another person\'s row does not count', () => assert.deepEqual(wanted(me, role('b@x.com', 'Admin')), []));
});

describe('the list matrix', () => {
  it('covers the sixteen lists, the picture library and the pages', () => {
    assert.equal(Object.keys(GROUP_MATRIX).length, 18);
    assert.ok(GROUP_MATRIX.pages && GROUP_MATRIX.logoLibrary);
  });
  it('the five secret lists are closed to participants', () => {
    assert.deepEqual([...SECRET_LISTS].sort(), ['adminusers', 'auditlog', 'roleassignments', 'sessionsummary', 'users']);
    for (const key of SECRET_LISTS) assert.equal(GROUP_MATRIX[key].participants, undefined, key);
  });
  it('the audit list: staff add only, everyone else nothing', () => {
    assert.deepEqual(GROUP_MATRIX.auditlog, { staff: 'add-only' });
  });
  it('the people lists: access managers Contribute, staff and leadership Read', () => {
    for (const key of ['users', 'roleassignments']) assert.deepEqual(GROUP_MATRIX[key], { staff: 'read', managers: 'contribute', leadership: 'read' });
  });
  it('leadership never reads the old admins list', () => assert.deepEqual(GROUP_MATRIX.adminusers, { staff: 'read' }));
  it('no list gives the super admins\' group anything: it only owns the managed groups', () => {
    for (const cells of Object.values(GROUP_MATRIX)) assert.equal(cells.superadmins, undefined);
  });
  it('prints as a table, one row each', () => {
    const table = matrixTable({ users: 'PMSUsers' });
    assert.equal(table.rows.length, 18);
    assert.deepEqual(table.rows.find((row) => row[0] === 'PMSUsers').slice(1), ['None', 'Read', 'Contribute', 'Read']);
  });
});

describe('the existing check under plain reads (Prompt 26)', () => {
  it('sees the levels when RoleDefinitionBindings is a plain array', () => {
    const contribute = { Name: 'Contribute', BasePermissions: { High: '432', Low: '1011030767' } };
    const read = { users: { unique: true, bindings: [{ Member: { Title: 'Site Members' }, RoleDefinitionBindings: [contribute] }] }, roleassignments: { unique: true, bindings: [] }, auditlog: { unique: true, bindings: [] } };
    assert.equal(permissionFindings(read, { users: 'PMSUsers', roleassignments: 'PMSRoleAssignments', auditlog: 'PMSAuditLog' })[0].ok, false);
  });
});

describe('the plan: Done, To do, Differs', () => {
  it('a fresh site is all To do, and reading it writes nothing', async () => {
    const s = await site();
    const plan = permissionPlan(await stateOf(s), s.titles);
    assert.ok(plan.steps.every((step) => step.state === 'To do'), JSON.stringify(plan.steps.filter((step) => step.state !== 'To do')));
    assert.deepEqual(s.fake.writes(), []);
  });
  // (The owner, 3 Nov 2026, option 1: PCOE's four access lists were set by hand. Apply adds the matrix's grants to such a list, removes nothing,
  // and changes no grant already there; it still leaves alone a list where a PMS group already holds another level.)
  it('a list with its own permissions that hold nothing for the PMS groups: Apply adds to them, with no break and nothing removed', async () => {
    const s = await site({ handmade: ['PMSUsers'] });
    const plan = permissionPlan(await stateOf(s), s.titles);
    const step = plan.steps.find((each) => each.id === 'list:users');
    assert.equal(step.state, 'To do');
    assert.match(step.words, /adds to its own permissions/);
    const before = targetOf(s, s.titles.users).holders;
    const result = await applyPermissions(s.api, plan, { titles: s.titles, folder: FOLDER });
    assert.equal(result.ok, true, result.words);
    const mine = paths(s.fake).filter((path) => path.includes(`'${s.titles.users}'`));
    assert.ok(!mine.some((path) => /breakroleinheritance|removeroleassignment|resetroleinheritance/.test(path)), mine.join(' '));
    const after = targetOf(s, s.titles.users);
    for (const holder of before) assert.ok(after.holders.includes(holder), holder);
    assert.deepEqual(after.levels['PMS staff'], ['Read']);
    assert.deepEqual(after.levels['PMS access managers'], ['Contribute']);
    assert.ok(result.undo.some((line) => /PMSUsers.*removeroleassignment/.test(line)), 'its undo takes the grants back, not the hand-set permissions');
    assert.ok(!result.undo.some((line) => /PMSUsers.*resetroleinheritance/.test(line)));
    assert.equal(permissionPlan(await stateOf(s), s.titles).steps.find((each) => each.id === 'list:users').state, 'Done');
  });
  it('a list where a PMS group already holds another level Differs and is left alone', async () => {
    const s = await site();
    await applyPermissions(s.api, permissionPlan(await stateOf(s), s.titles), { titles: s.titles, folder: FOLDER });
    const where = `/web/lists/getbytitle('${s.titles.users}')/roleassignments`;
    await s.api.write('POST', `${where}/addroleassignment(principalid=${s.read.group('PMS staff').Id},roledefid=1073741827)`);
    await s.api.write('POST', `${where}/removeroleassignment(principalid=${s.read.group('PMS staff').Id},roledefid=1073741826)`);
    const plan = permissionPlan(await stateOf(s), s.titles);
    assert.equal(plan.steps.find((step) => step.id === 'list:users').state, 'Differs');
    const before = JSON.stringify(targetOf(s, s.titles.users));
    await applyPermissions(s.api, plan, { titles: s.titles, folder: FOLDER });
    assert.equal(JSON.stringify(targetOf(s, s.titles.users)), before);
  });
  it('a pages folder that is the library\'s root Differs: Apply never breaks a whole library', async () => {
    const s = await site({ rootFolders: [FOLDER] });
    assert.equal(permissionPlan(await stateOf(s), s.titles).steps.find((step) => step.id === 'list:pages').state, 'Differs');
  });
  it('an existing "PMS add only" with other bits Differs', async () => {
    const s = await site({ levels: [{ Id: 77, Name: 'PMS add only', RoleTypeKind: 0, BasePermissions: { High: '0', Low: '7' } }] });
    assert.equal(permissionPlan(await stateOf(s), s.titles).steps.find((step) => step.id === 'level').state, 'Differs');
  });
});

describe('Apply', () => {
  const run = async (s, options = {}) => applyPermissions(s.api, permissionPlan(await stateOf(s), s.titles), { titles: s.titles, folder: FOLDER, ...options });

  it('rehearses first, on a scratch list and a scratch folder, and leaves neither', async () => {
    const s = await site();
    const result = await run(s);
    assert.equal(result.ok, true, result.words);
    const all = paths(s.fake);
    const firstReal = all.findIndex((path) => /sitegroups|roledefinitions/.test(path));
    const rehearsal = all.slice(0, firstReal);
    // (First what an earlier rehearsal may have left is deleted; then the scratch list is made.)
    assert.ok(rehearsal.slice(0, 2).every((path) => /PMSPermissionProbe|_pms-probe/.test(path)), rehearsal.slice(0, 2).join(' '));
    assert.match(rehearsal[2], /\/web\/lists$/);
    assert.ok(rehearsal.some((path) => /PMSPermissionProbe.*breakroleinheritance/.test(path)));
    assert.ok(rehearsal.some((path) => /PMSPermissionProbe.*addroleassignment/.test(path)));
    assert.ok(rehearsal.some((path) => /PMSPermissionProbe.*removeroleassignment/.test(path)));
    assert.ok(rehearsal.some((path) => /PMSPermissionProbe.*resetroleinheritance/.test(path)));
    assert.ok(rehearsal.some((path) => /\/web\/folders$/.test(path)));
    assert.equal(s.read.scope('PMSPermissionProbe'), undefined);
    assert.equal(s.read.folders().length, 0);
  });
  it('the rehearsal deletes its scratch list and folder with IF-MATCH, as PCOE asks (412 without it)', async () => {
    const s = await site();
    assert.equal((await run(s)).ok, true);
    const deletes = s.fake.writes().filter((entry) => entry.method === 'DELETE' && /PMSPermissionProbe|_pms-probe/.test(entry.path));
    assert.equal(deletes.length, 4, 'two before, to clear an earlier run, and two after');
    assert.ok(deletes.every((entry) => entry.ifMatch === '*'));
  });
  it('a scratch list and folder left by a rehearsal that stopped are deleted first, then the rehearsal runs', async () => {
    const s = await site();
    s.read.leaveScratch(FOLDER);
    const result = await run(s);
    assert.equal(result.ok, true, result.words);
    assert.equal(s.read.scope('PMSPermissionProbe'), undefined);
    assert.equal(s.read.folders().length, 0);
  });
  it('a rehearsal that differs stops before a real list or group is touched', async () => {
    const s = await site();
    s.fake.forbid((entry) => /PMSPermissionProbe.*removeroleassignment/.test(entry.path));
    const result = await run(s);
    assert.equal(result.ok, false);
    assert.match(result.words, /rehearsal/i);
    assert.ok(!paths(s.fake).some((path) => /sitegroups|roledefinitions|PMSUsers/.test(path)));
    assert.equal(s.read.scope('PMSPermissionProbe'), undefined, 'the scratch list is cleaned up');
  });
  it('makes the groups and the level, with the verbose body type (a __metadata body under nometadata is refused)', async () => {
    const s = await site();
    assert.equal((await run(s)).ok, true);
    for (const title of Object.values(PMS_GROUPS)) assert.ok(s.read.group(title), title);
    assert.equal(s.read.level('PMS add only').BasePermissions.Low, '196611');
  });
  it('the owners: PMS super admins owns the three managed groups; the site\'s owners own the other two', async () => {
    const s = await site();
    await run(s);
    for (const title of Object.values(MANAGED_GROUPS)) assert.equal(s.read.group(title).OwnerTitle, 'PMS super admins');
    assert.equal(s.read.group('PMS super admins').OwnerTitle, 'Site Owners');
    assert.equal(s.read.group('PMS participants').OwnerTitle, 'Site Owners');
  });
  it('an owner that does not land stops Apply and points to the group\'s settings page', async () => {
    const s = await site({ ownerNotSet: true });
    const result = await run(s);
    assert.equal(result.ok, false);
    assert.match(result.words, /group's settings page/);
  });
  it('a level whose bits read back differently stops Apply: the read-back is trusted, not the sum', async () => {
    const s = await site({ levelLow: '7' });
    const result = await run(s);
    assert.equal(result.ok, false);
    assert.match(result.words, /PMS add only/);
  });
  it('each list: break with the copy, then grant; nothing is removed; the site\'s groups stay', async () => {
    const s = await site();
    await run(s);
    const mine = paths(s.fake).filter((path) => path.includes(`'${s.titles.users}'`));
    assert.match(mine[0], /breakroleinheritance\(copyRoleAssignments=true,clearSubscopes=false\)/);
    assert.ok(mine.slice(1).every((path) => /addroleassignment/.test(path)));
    const scope = targetOf(s, s.titles.users);
    assert.equal(scope.unique, true);
    assert.ok(scope.holders.includes('Site Members'), 'Members keep what they had until the removal step');
    assert.ok(scope.holders.includes('Site Owners'));
  });
  it('the grants match the matrix, list by list, and the pages folder is changed, not its library', async () => {
    const s = await site();
    await run(s);
    for (const key of Object.keys(GROUP_MATRIX)) {
      const title = key === 'pages' ? FOLDER : s.titles[key];
      const scope = targetOf(s, title);
      for (const [group, level] of Object.entries(GROUP_MATRIX[key])) {
        assert.deepEqual(scope.levels[PMS_GROUPS[group]], [{ read: 'Read', contribute: 'Contribute', 'add-only': 'PMS add only' }[level]], `${key} ${group}`);
      }
    }
    assert.ok(!paths(s.fake).some((path) => /getbytitle\('Shared Documents'\)/.test(path)));
  });
  it('stops on a 403 with words that say what to do, and prints the undo of each list it changed', async () => {
    const s = await site();
    s.fake.forbid((entry) => entry.path.includes(`'${s.titles.responses}'`));
    const result = await run(s);
    assert.equal(result.ok, false);
    assert.match(result.words, /A site owner must/);
    assert.ok(result.undo.length > 0);
    assert.ok(result.undo.every((line) => /resetroleinheritance/.test(line)));
  });
  it('refuses to start when the running account is not a site owner: it would not keep Full Control', async () => {
    const s = await site({ runningIsOwner: false });
    const result = await run(s);
    assert.equal(result.ok, false);
    assert.match(result.words, /Full Control/);
    assert.deepEqual(s.fake.writes(), []);
  });
  it('saves the ids as the settings list\'s second row, in its Title, and adds no column', async () => {
    const s = await site();
    await run(s);
    const rows = [s.fake.item('appsettings', 'site-groups')].filter(Boolean);
    assert.equal(rows.length, 1);
    const groups = groupsOfRow(rows[0]);
    assert.deepEqual(Object.keys(groups).sort(), ['leadership', 'managers', 'staff', 'sync']);
    assert.equal(groups.sync, false, 'the switch starts off');
    assert.equal(groups.staff.title, 'PMS staff');
    assert.ok(Number.isInteger(groups.staff.id));
    assert.ok(rows[0].Title.length <= 255);
  });
  it('a second run finds everything Done and changes nothing', async () => {
    const s = await site();
    await run(s);
    const plan = permissionPlan(await stateOf(s), s.titles);
    assert.ok(plan.steps.every((step) => step.state === 'Done'), JSON.stringify(plan.steps.filter((step) => step.state !== 'Done')));
    const before = s.fake.writes().length;
    await applyPermissions(s.api, plan, { titles: s.titles, folder: FOLDER });
    assert.equal(paths(s.fake).slice(before).filter((path) => !/PMSPermissionProbe|\/web\/folders|_pms-probe/.test(path) && !/\/web\/lists$/.test(path)).length, 0);
  });
});

describe('Remove the site\'s groups: a separate step', () => {
  const applied = async (options) => {
    const s = await site(options);
    await applyPermissions(s.api, permissionPlan(await stateOf(s), s.titles), { titles: s.titles, folder: FOLDER });
    return s;
  };
  it('removes every other principal, never the owners and never a PMS group', async () => {
    const s = await applied();
    const plan = removalPlan(await stateOf(s), s.titles);
    assert.ok(plan.some((each) => each.who.includes('Site Members')));
    assert.ok(!plan.some((each) => each.who.includes('Site Owners')));
    const result = await removeSiteGroups(s.api, await stateOf(s), s.titles);
    assert.equal(result.ok, true, result.words);
    const scope = targetOf(s, s.titles.users);
    assert.deepEqual([...scope.holders].sort(), ['PMS access managers', 'PMS leadership', 'PMS staff', 'Site Owners']);
    assert.equal(paths(s.fake).filter((path) => /getbyprincipalid\(3\)/.test(path)).length, 0);
  });
  it('then the existing check is clean', async () => {
    const s = await applied();
    await removeSiteGroups(s.api, await stateOf(s), s.titles);
    const state = await stateOf(s);
    const read = Object.fromEntries(['users', 'roleassignments', 'auditlog'].map((key) => [key, { unique: state.targets[key].unique, bindings: state.targets[key].raw }]));
    const found = permissionFindings(read, s.titles);
    assert.ok(found.every((each) => each.ok), JSON.stringify(found));
  });
  it('touches no list that is not Done, and refuses a list whose owners do not hold Full Control', async () => {
    const s = await applied();
    const where = `/web/lists/getbytitle('${s.titles.users}')/roleassignments`;
    await s.api.write('POST', `${where}/addroleassignment(principalid=${s.read.group('PMS staff').Id},roledefid=1073741827)`);
    assert.ok(!removalPlan(await stateOf(s), s.titles).some((each) => each.key === 'users'));
    const t = await applied();
    t.read.dropOwners(t.titles.clients);
    const result = await removeSiteGroups(t.api, await stateOf(t), t.titles);
    assert.equal(result.ok, false);
    assert.match(result.words, /owners/);
  });
  it('after the removal, participants cannot read the five secret lists', async () => {
    const s = await applied();
    await removeSiteGroups(s.api, await stateOf(s), s.titles);
    for (const key of SECRET_LISTS) assert.equal(targetOf(s, s.titles[key]).levels['PMS participants'], undefined, key);
  });
});

describe('the drift report (read only)', () => {
  const members = (...pairs) => pairs.map(([email, login = `i:0e.t|adfs|${email}`]) => ({ Id: 1, Title: email, Email: email, LoginName: login }));
  const a = user('a@x.com');
  const b = user('b@x.com');
  const off = user('off@x.com', 'Disabled');
  it('waiting, more than the role says, and not in People', () => {
    const found = driftOf({
      users: [a, b, off], assignments: [role(a.id, 'Producer'), role(b.id, 'Leadership'), role(off.id, 'Admin')], now: NOW,
      members: { staff: members([b.id], [off.id], ['stranger@x.com']), managers: [], leadership: members([b.id]) },
    });
    assert.deepEqual(found.waiting.map((each) => [each.key, each.missing]), [['a@x.com', ['staff']]]);
    assert.deepEqual(found.more.map((each) => [each.key, each.extra]), [['b@x.com', ['staff']], ['off@x.com', ['staff']]]);
    assert.deepEqual(found.strangers.map((each) => each.name), ['stranger@x.com']);
  });
  it('matches on the stored claim when the email differs (ADFS)', () => {
    const claimed = user('c@x.com', 'Active', { loginName: 'i:0e.t|adfs|CALIAS' });
    const found = driftOf({ users: [claimed], assignments: [role(claimed.id, 'Producer')], now: NOW, members: { staff: [{ Id: 2, Title: 'C', Email: '', LoginName: 'I:0E.T|ADFS|calias' }], managers: [], leadership: [] } });
    assert.deepEqual(found, { waiting: [], more: [], strangers: [] });
  });
  it('reads one group at a time, follows __next, never $skip, writes nothing', async () => {
    const s = await site({ memberPage: 1 });
    await applyPermissions(s.api, permissionPlan(await stateOf(s), s.titles), { titles: s.titles, folder: FOLDER });
    s.read.addMembers('PMS staff', ['one@x.com', 'two@x.com', 'three@x.com']);
    const writes = s.fake.writes().length;
    const log = [];
    const reader = (resource) => { log.push(resource); return s.api.read(resource); };
    const found = await readDrift(reader, s.titles, { users: [], assignments: [], now: NOW });
    assert.deepEqual(found.drift.strangers.map((each) => each.name).sort(), ['one@x.com', 'three@x.com', 'two@x.com']);
    assert.ok(!log.some((address) => /\$skip=/.test(address)));
    assert.equal(s.fake.writes().length, writes);
  });
  it('says so when Setup has not made the groups', async () => {
    const s = await site();
    assert.equal((await readDrift(s.api.read, s.titles, { users: [], assignments: [], now: NOW })).ready, false);
  });
  it('a refused group is said, not failed', async () => {
    const s = await site();
    await applyPermissions(s.api, permissionPlan(await stateOf(s), s.titles), { titles: s.titles, folder: FOLDER });
    const read = (address) => (/users/.test(address) ? Promise.reject(Object.assign(new Error('Access denied.'), { status: 403 })) : s.api.read(address));
    const found = await readDrift(read, s.titles, { users: [], assignments: [], now: NOW });
    assert.equal(found.ready, false);
    assert.match(found.words, /403/);
  });
  it('Setup\'s self-test has the step, read only, and only with the titles', () => {
    const steps = selfTestProbes(async () => ({ ok: true }), {});
    assert.ok(steps.some((step) => step.name === PROBE_SITE_ACCESS));
    assert.ok(!selfTestProbes(async () => ({ ok: true })).some((step) => step.name === PROBE_SITE_ACCESS));
  });
  it('the settings row is found by its own filter and names its columns', () => {
    assert.match(siteGroupsAddress({ appsettings: 'PMSAppSettings' }), /\$filter=AppId eq 'site-groups'.*\$select=.*,Title$/);
  });
});

describe('Part 3: the hand-off', () => {
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const person = { key: 'a@x.com' };
  const me = { key: 'boss@x.com' };
  it('the note says what is left and who does it, by group', () => {
    assert.match(siteAccessNote('Producer', { person, me }), /A Super admin adds them to PMS staff/);
    assert.match(siteAccessNote('Designer', { person, me }), /PMS staff/);
    assert.match(siteAccessNote('Admin', { person, me }), /PMS staff and PMS access managers/);
    assert.match(siteAccessNote('Leadership', { person, me }), /A Super admin adds them to PMS leadership/);
  });
  it('Add user says who gives site access', () => assert.match(SITE_ACCESS_ADD_USER, /A Super admin does that/));
  it('a person\'s page and the client team show the button; only a Super admin sees it', () => {
    const hand = read('migration/src/admin/SiteAccessHandoff.svelte');
    assert.match(hand, /Open site groups/);
    assert.match(hand, /roles\.global/);
    assert.match(read('migration/src/admin/UserDetail.svelte'), /SiteAccessHandoff/);
    assert.match(read('migration/src/admin/ClientTeam.svelte'), /SiteAccessHandoff/);
  });
  it('the People page has the drift report for a Super admin', () => {
    assert.match(read('migration/src/admin/AdminPeople.svelte'), /SiteAccessDrift/);
    assert.match(read('migration/src/admin/SiteAccessDrift.svelte'), /Waiting for site access/);
  });
  it('the words name no site', () => {
    for (const file of ['migration/src/lib/access/site-access.js', 'migration/src/lib/setup/list-permissions.js']) assert.doesNotMatch(read(file).replace(/^\s*\/\/.*$/gm, ''), /PCOE/);
  });
});
