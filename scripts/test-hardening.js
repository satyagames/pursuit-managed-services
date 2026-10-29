// Prompt 21, Phase 7: hardening. Run: node --test scripts/test-hardening.js (part of `npm test`). Three things move the app from a guardrail towards a
// boundary: (1) the access lists' own permissions, which Setup's plan names and its self-test checks (lib/setup/list-permissions.js, ASSUMED until tried
// on PCOE); (2) the data layer's specialised readers (a session's answers, its participants, the Live display's feed) ask the read check as the plain
// reads do; (3) the Super admin's read-only review of the audit list (lib/access/audit-review.js, the matrix's audit.view).
import './fresh-page.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createSharePointFake } from './sharepoint-fake.js';
import { MATRIX } from '../migration/src/lib/access/access-matrix.js';
import { can, canView, legacyAccess } from '../migration/src/lib/access/can.js';
import { writeGuard } from '../migration/src/lib/access/guard.js';
import {
  ACCESS_GROUP, ADD_ONLY_LEVEL, PERMISSION_LISTS, PROBE_PERMISSIONS, permissionFindings, permissionProbe, permissionSteps,
} from '../migration/src/lib/setup/list-permissions.js';
import { AUDIT_PAGE, auditView } from '../migration/src/lib/access/audit-review.js';
import { selfTestProbes } from '../migration/src/lib/setup/setup-checks.js';

const NOW = new Date('2026-10-28T12:00:00Z');
const TITLES = { users: 'PMSUsers', roleassignments: 'PMSRoleAssignments', auditlog: 'PMSAuditLog' };
const grant = (role, scopeType = 'global', more = {}) => ({
  id: `x|${role}|${scopeType}|${more.clientId ?? more.sessionId ?? ''}`, userKey: 'x@deloitte.com', role, scopeType, clientId: null, sessionId: null,
  periodFrom: null, periodTo: null, validUntil: null, extras: '', grantedBy: 'vsatyadev@deloitte.com', ...more,
});
const accessOf = (...grants) => ({
  person: { key: 'x@deloitte.com', email: 'x@deloitte.com', name: 'X', loginName: '' }, owner: false, legacy: false, user: { id: 'x@deloitte.com', status: 'Active' }, assignments: grants,
});

// SharePoint's permission levels as /roleassignments gives them (BasePermissions Low and High, as strings). Full Control and Contribute are the site's
// own; Read has View only; the add-only level has View and Add.
const FULL = { Name: 'Full Control', BasePermissions: { High: '2147483647', Low: '4294967295' } };
const CONTRIBUTE = { Name: 'Contribute', BasePermissions: { High: '432', Low: '1011030767' } };
const READ = { Name: 'Read', BasePermissions: { High: '432', Low: '138612833' } };
const ADD_ONLY = { Name: ADD_ONLY_LEVEL, BasePermissions: { High: '432', Low: String(138612833 | 2) } };
const binding = (title, ...levels) => ({ Member: { Title: title, PrincipalType: 8 }, RoleDefinitionBindings: { results: levels } });
const locked = (bindings) => ({ unique: true, bindings });

describe('Setup names the access lists\' permissions (ASSUMED until tried on PCOE)', () => {
  it('the three lists and what each needs', () => {
    assert.deepEqual(PERMISSION_LISTS, { users: 'managers', roleassignments: 'managers', auditlog: 'add-only' });
    assert.equal(ACCESS_GROUP, 'PMS access managers');
    assert.equal(ADD_ONLY_LEVEL, 'PMS add only');
  });

  it('the plan\'s steps say, in plain words and by the lists\' titles, what a site owner sets by hand', () => {
    const steps = permissionSteps(TITLES);
    assert.equal(steps.length, 4);
    assert.match(steps[0], /group named "PMS access managers"/);
    assert.match(steps[1], /PMSUsers and PMSRoleAssignments: stop inheriting permissions/);
    assert.match(steps[2], /permission level named "PMS add only"/);
    assert.match(steps[3], /PMSAuditLog: stop inheriting permissions/);
    for (const step of steps) assert.doesNotMatch(step, /FedAuth|digest|token/i);
  });

  it('a list that still inherits the site\'s permissions is a finding: every member may change it', () => {
    const found = permissionFindings({ users: { unique: false, bindings: [] }, roleassignments: locked([]), auditlog: locked([]) }, TITLES);
    assert.equal(found.find((each) => each.key === 'users').ok, false);
    assert.match(found.find((each) => each.key === 'users').words, /PMSUsers still inherits the site's permissions/);
  });

  it('only the access group and the site\'s owners may change the people lists; the members may read them', () => {
    const good = locked([binding('PMS access managers', CONTRIBUTE), binding('PCOE Owners', FULL), binding('PCOE Members', READ)]);
    const found = permissionFindings({ users: good, roleassignments: good, auditlog: locked([binding('PCOE Owners', FULL), binding('PCOE Members', ADD_ONLY)]) }, TITLES);
    assert.deepEqual(found.map((each) => each.ok), [true, true, true]);
    const loose = locked([binding('PMS access managers', CONTRIBUTE), binding('PCOE Members', CONTRIBUTE)]);
    const bad = permissionFindings({ users: loose, roleassignments: good, auditlog: locked([binding('PCOE Members', ADD_ONLY)]) }, TITLES);
    assert.equal(bad[0].ok, false);
    assert.match(bad[0].words, /PCOE Members may change PMSUsers/);
  });

  it('the audit list takes new lines from the members and lets no one but the owners change or delete one', () => {
    const editable = permissionFindings({ users: locked([]), roleassignments: locked([]), auditlog: locked([binding('PCOE Members', CONTRIBUTE)]) }, TITLES)[2];
    assert.equal(editable.ok, false);
    assert.match(editable.words, /PCOE Members may change or delete lines of PMSAuditLog/);
    const closed = permissionFindings({ users: locked([]), roleassignments: locked([]), auditlog: locked([binding('PCOE Members', READ)]) }, TITLES)[2];
    assert.equal(closed.ok, false);
    assert.match(closed.words, /No one but the owners can add lines to PMSAuditLog/);
  });

  it('the self-test probe reads each list\'s permissions (read only, two requests a list) and says what it found', async () => {
    const asked = [];
    const answers = {
      PMSUsers: locked([binding('PMS access managers', CONTRIBUTE), binding('PCOE Members', READ)]),
      PMSRoleAssignments: { unique: false, bindings: [] },
      PMSAuditLog: locked([binding('PCOE Members', ADD_ONLY)]),
    };
    const probe = async (list, address) => {
      asked.push(address);
      assert.equal(list, null);
      const title = decodeURIComponent(/getbytitle\('([^']+)'\)/.exec(address)[1]);
      const answer = answers[title];
      if (/HasUniqueRoleAssignments/.test(address)) return { ok: true, rows: 0, length: 0, data: { HasUniqueRoleAssignments: answer.unique } };
      return { ok: true, rows: answer.bindings.length, length: 0, data: { results: answer.bindings } };
    };
    const detail = await permissionProbe(probe, TITLES);
    assert.equal(asked.length, 6);
    assert.ok(asked.every((address) => !/\/items/.test(address)), 'no item is read');
    assert.match(detail, /PMSUsers: as planned\./);
    assert.match(detail, /PMSRoleAssignments still inherits/);
    assert.match(detail, /PMSAuditLog: as planned\./);
    assert.match(detail, /ASSUMED/);
  });

  it('a refused read of the permissions is said, not failed (a site owner runs Setup; another account may not read them)', async () => {
    const detail = await permissionProbe(async () => ({ ok: false, status: 403, message: 'Access denied.' }), TITLES);
    assert.match(detail, /Could not read the permissions of PMSUsers \(403/);
  });

  it('Setup\'s self-test asks it after the filter probes and before the column probes', () => {
    const steps = selfTestProbes(async () => ({ ok: true, rows: 0, length: 0, data: {} }), TITLES);
    const names = steps.map((step) => step.name);
    assert.ok(names.includes(PROBE_PERMISSIONS));
    assert.equal(names.indexOf(PROBE_PERMISSIONS), 2);
    assert.ok(!selfTestProbes(async () => ({ ok: true })).some((step) => step.name === PROBE_PERMISSIONS), 'not without the titles');
  });
});

describe('the specialised readers ask the read check (Phase 4 left them out)', () => {
  let pages = 0;
  async function siteWith(access) {
    const fake = createSharePointFake();
    fake.install();
    const ds = await import(`../migration/src/lib/data/dataService.js?hardening=${pages += 1}`);
    ds.configure({ sharePoint: fake.settings });
    ds.setAccessGuard(writeGuard(access, ds.sharePointListTitles(), { now: () => NOW }));
    fake.reset();
    return { fake, ds };
  }
  const producerOnAcme = accessOf(grant('Producer', 'client', { clientId: 'acme' }));

  it('a session\'s answers, its participants and the Live feed of a session not held are refused before any request', async () => {
    const { fake, ds } = await siteWith(producerOnAcme);
    await assert.rejects(ds.readSessionResponsesChecked('globex-2026-10-25'), (error) => error.code === 'access-denied');
    await assert.rejects(ds.readSessionResponses('globex-2026-10-25'), (error) => error.code === 'access-denied');
    await assert.rejects(ds.listSessionParticipants('globex-2026-10-25'), (error) => error.code === 'access-denied');
    await assert.rejects(ds.readLiveFeed('globex-2026-10-25'), (error) => error.code === 'access-denied');
    assert.equal(fake.requests.length, 0, 'not one request reached the site');
  });

  it('a session held by the role is read, once the page has listed it', async () => {
    const sessionOnly = accessOf(grant('Producer', 'session', { sessionId: 'acme-2026-10-24' }));
    const { fake, ds } = await siteWith(sessionOnly);
    const { answers } = await ds.readSessionResponsesChecked('acme-2026-10-24');
    assert.deepEqual(answers, []);
    await ds.listSessionParticipants('acme-2026-10-24');
    await ds.readLiveFeed('acme-2026-10-24');
    assert.ok(fake.requests.length > 0);
  });

  it('a global role, the legacy admin and a page with no guard read as they always did', async () => {
    const { ds, fake } = await siteWith(legacyAccess(null));
    await ds.readSessionResponsesChecked('globex-2026-10-25');
    await ds.readLiveFeed('globex-2026-10-25');
    ds.configure({ sharePoint: fake.settings });
    await ds.readSessionResponsesChecked('globex-2026-10-25');
  });
});

describe('the audit review: the Super admin\'s read-only look at every line', () => {
  it('is a Super admin\'s alone (audit.view, decision J): an Admin, even with the extra, does not see it', () => {
    assert.deepEqual(MATRIX['audit.view'], { 'Super admin': 'yes', Admin: 'no', Producer: 'no', Designer: 'no', Leadership: 'no' });
    assert.equal(can(accessOf(grant('Super admin')), 'audit.view', {}, { now: NOW }), true);
    const admin = accessOf(grant('Admin', 'global', { extras: 'users.manage' }));
    assert.equal(can(admin, 'audit.view', {}, { now: NOW }), false);
    assert.equal(canView(admin, 'audit.view', {}, { now: NOW }), false);
    assert.equal(can(legacyAccess(null), 'audit.view', {}, { now: NOW }), false);
  });

  const line = (n, more = {}) => ({
    id: `audit-${n}`, actor: 'vsatyadev@deloitte.com', action: 'grant', targetUser: 'raedla@deloitte.com', role: 'Producer', clientId: 'kroger', sessionId: '',
    detail: '', occurredAt: `2026-10-${String(n).padStart(2, '0')}T09:00:00Z`, ...more,
  });
  const names = { 'vsatyadev@deloitte.com': 'Satyadev, Vedala Venkata', 'raedla@deloitte.com': 'Aedla, Rajeshwar', 'bmilder@deloitte.com': 'Milder, Brian' };

  it('People shows History of changes to those the matrix allows, and the screen only reads', () => {
    const people = readFileSync(new URL('../migration/src/admin/AdminPeople.svelte', import.meta.url), 'utf8');
    assert.ok(people.includes("can(access, 'audit.view', {})"));
    const screen = readFileSync(new URL('../migration/src/admin/AuditReview.svelte', import.meta.url), 'utf8');
    assert.ok(screen.includes("listAccessRecords('auditlog')"));
    assert.doesNotMatch(screen, /addAccessRecord|updateAccessRecord|removeAccessRecord|writeAudit/);
  });

  it('lists every line, newest first, in words: when, who, what, to whom and where', () => {
    const view = auditView([line(1), line(3, { action: 'disable', targetUser: 'bmilder@deloitte.com' })], { names });
    assert.equal(view.total, 2);
    assert.deepEqual(view.rows.map((row) => row.id), ['audit-3', 'audit-1']);
    assert.equal(view.rows[0].who, 'Satyadev, Vedala Venkata');
    assert.equal(view.rows[0].did, 'Turned off');
    assert.equal(view.rows[0].target, 'Milder, Brian');
    assert.equal(view.rows[1].did, 'Given Producer');
    assert.equal(view.rows[1].place, 'kroger');
  });

  it('filters by what was done, by a person (who did it or to whom, by name or email) and by days, inclusive', () => {
    const lines = [line(1), line(2, { action: 'revoke' }), line(3, { action: 'disable', targetUser: 'bmilder@deloitte.com' }), line(4, { actor: 'bmilder@deloitte.com', targetUser: 'raedla@deloitte.com' })];
    assert.deepEqual(auditView(lines, { names, action: 'revoke' }).rows.map((row) => row.id), ['audit-2']);
    assert.deepEqual(auditView(lines, { names, person: 'milder' }).rows.map((row) => row.id), ['audit-4', 'audit-3']);
    assert.deepEqual(auditView(lines, { names, person: 'BMILDER@' }).rows.map((row) => row.id), ['audit-4', 'audit-3']);
    assert.deepEqual(auditView(lines, { names, from: '2026-10-02', to: '2026-10-03' }).rows.map((row) => row.id), ['audit-3', 'audit-2']);
  });

  it('pages of 50, and a page past the end is the last', () => {
    const lines = Array.from({ length: 120 }, (_, at) => line(1, { id: `audit-${at}`, occurredAt: new Date(Date.UTC(2026, 9, 1, 0, at)).toISOString() }));
    assert.equal(AUDIT_PAGE, 50);
    const first = auditView(lines, { names });
    assert.equal(first.pages, 3);
    assert.equal(first.rows.length, 50);
    assert.equal(first.rows[0].id, 'audit-119');
    const last = auditView(lines, { names, page: 9 });
    assert.equal(last.page, 3);
    assert.equal(last.rows.length, 20);
  });

  it('never shows an answer: a detail that looks like one is left out', () => {
    const view = auditView([line(1, { action: 'add-user', detail: '{"answer":"secret"}' })], { names });
    assert.doesNotMatch(JSON.stringify(view.rows), /secret/);
  });
});
