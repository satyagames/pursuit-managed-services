// Prompt 22, Part 2: the settings the Leadership dashboard already reads, now set on screens. Run: node --test scripts/test-reporting-settings.js (part of
// `npm test`).
//
// Part 1: the matrix's new row (settings.manage: a Super admin's alone) and the columns a list's write rule does not decide alone (access-matrix.js
// FIELD_WRITES): FiscalYearStartMonth and MinSample need settings.manage, a client's Industry and Region need clients.manage. The write guard refuses
// the others with AccessDenied, and a value out of range with plain words, before anything is sent.
// Part 2: Reporting settings (lib/admin/reporting-settings.js): the save, its audit line, and what a new fiscal start month moves at once and what keeps
// the quarters it was given (the confirmation's words), and moving the stored quarters when the person asks.
// Part 3: a client's Industry and Region (lib/admin/client-tags.js): cleaned, suggested from the values in use, saved with the client update, audited.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { FIELD_WRITES, MATRIX } from '../migration/src/lib/access/access-matrix.js';
import { AccessDenied } from '../migration/src/lib/access/access-denied.js';
import { can, canView } from '../migration/src/lib/access/can.js';
import { writeGuard } from '../migration/src/lib/access/guard.js';
import { fieldProblem } from '../migration/src/lib/access/field-values.js';
import {
  fiscalChangeWords, moveQuestion, moveStoredPeriods, periodsToMove, readReportingSettings, saveReportingSettings, settingsChangeWords,
} from '../migration/src/lib/admin/reporting-settings.js';
import { TAG_MAX, cleanTag, saveClientTags, tagChangeWords, tagSuggestions } from '../migration/src/lib/admin/client-tags.js';
import { createSharePointFake } from './sharepoint-fake.js';

const NOW = new Date('2026-10-29T12:00:00Z');
const grant = (role, scopeType = 'global', more = {}) => ({
  id: `x|${role}|${scopeType}|${more.clientId ?? ''}`, userKey: 'x@deloitte.com', role, scopeType, clientId: null, sessionId: null,
  periodFrom: null, periodTo: null, validUntil: null, extras: '', grantedBy: 'vsatyadev@deloitte.com', ...more,
});
const accessOf = (...grants) => ({
  person: { key: 'x@deloitte.com', email: 'x@deloitte.com', name: 'X', loginName: '' }, owner: false, legacy: false, user: { id: 'x@deloitte.com', status: 'Active' }, assignments: grants,
});
const SUPER = accessOf(grant('Super admin'));
const ADMIN = accessOf(grant('Admin'));
const PRODUCER = accessOf(grant('Producer', 'client', { clientId: 'acme' }));
const DESIGNER = accessOf(grant('Designer', 'client', { clientId: 'acme' }));
const LEADER = accessOf(grant('Leadership', 'client', { clientId: 'acme' }));
const guardOf = (access) => writeGuard(access, {}, { now: () => NOW });

describe('Part 1: settings.manage, and the columns a list\'s rule does not decide alone', () => {
  it('settings.manage is a Super admin\'s alone, and no role sees it', () => {
    assert.deepEqual(MATRIX['settings.manage'], { 'Super admin': 'yes', Admin: 'no', Producer: 'no', Designer: 'no', Leadership: 'no' });
    assert.equal(can(SUPER, 'settings.manage', {}, { now: NOW }), true);
    for (const access of [ADMIN, PRODUCER, DESIGNER, LEADER]) assert.equal(canView(access, 'settings.manage', {}, { now: NOW }), false);
  });
  it('the guarded columns: the two settings need settings.manage, a client\'s tags clients.manage', () => {
    assert.deepEqual(FIELD_WRITES, { appsettings: { fiscalYearStartMonth: 'settings.manage', minSample: 'settings.manage' }, clients: { industry: 'clients.manage', region: 'clients.manage' } });
  });
  it('a Producer may still write the live session to the settings item, never the two settings', () => {
    const guard = guardOf(PRODUCER);
    assert.doesNotThrow(() => guard('PATCH', '/appsettings/default', {}, { activeSessionId: 'acme-1', activeClientId: 'acme' }));
    assert.throws(() => guard('PATCH', '/appsettings/default', {}, { minSample: 3 }), AccessDenied);
    assert.throws(() => guard('PATCH', '/appsettings/default', {}, { activeSessionId: 'acme-1', fiscalYearStartMonth: 7 }), AccessDenied);
  });
  it('on SharePoint the same, by column name', () => {
    const guard = writeGuard(PRODUCER, { appsettings: 'PMSAppSettings', clients: 'PMSClients' }, { now: () => NOW });
    const address = "/web/lists/getbytitle('PMSAppSettings')/items(1)";
    assert.doesNotThrow(() => guard('POST', address, { 'X-HTTP-Method': 'MERGE' }, { ActiveSessionId: 'acme-1' }));
    assert.throws(() => guard('POST', address, { 'X-HTTP-Method': 'MERGE' }, { MinSample: 3 }), AccessDenied);
    const designer = writeGuard(DESIGNER, { clients: 'PMSClients' }, { now: () => NOW });
    const client = "/web/lists/getbytitle('PMSClients')/items(4)";
    assert.doesNotThrow(() => designer('POST', client, { 'X-HTTP-Method': 'MERGE' }, { AppId: 'acme', ThemeJson: '{}' }), 'a Designer still saves the brand');
    assert.throws(() => designer('POST', client, { 'X-HTTP-Method': 'MERGE' }, { AppId: 'acme', Industry: 'Retail' }), AccessDenied);
  });
  it('an Admin sets a client\'s Industry and Region, never the settings; a Super admin both', () => {
    assert.doesNotThrow(() => guardOf(ADMIN)('PATCH', '/clients/acme', {}, { industry: 'Retail', region: 'EU' }));
    assert.throws(() => guardOf(ADMIN)('PATCH', '/appsettings/default', {}, { fiscalYearStartMonth: 7 }), AccessDenied);
    assert.doesNotThrow(() => guardOf(SUPER)('PATCH', '/appsettings/default', {}, { fiscalYearStartMonth: 7, minSample: 3 }));
    assert.doesNotThrow(() => guardOf(SUPER)('PATCH', '/clients/acme', {}, { region: '' }), 'empty is allowed');
  });
  it('a value out of range is refused in plain words before it is sent, whoever asks', () => {
    for (const month of [0, 13, 6.5, 'June', -1]) assert.equal(fieldProblem('appsettings', 'fiscalYearStartMonth', month), 'Choose a month from January to December.', String(month));
    for (const min of [0, -3, 2.5, 'ten']) assert.equal(fieldProblem('appsettings', 'minSample', min), 'The minimum sample is a whole number, 1 or more.', String(min));
    for (const fine of [1, 12, null]) assert.equal(fieldProblem('appsettings', 'fiscalYearStartMonth', fine), null);
    assert.equal(fieldProblem('appsettings', 'minSample', 1), null);
    assert.equal(fieldProblem('clients', 'industry', 'x'.repeat(61)), 'An industry is at most 60 characters.');
    assert.equal(fieldProblem('clients', 'region', 'x'.repeat(61)), 'A region is at most 60 characters.');
    assert.throws(() => guardOf(SUPER)('PATCH', '/appsettings/default', {}, { minSample: 0 }), (error) => error.code === 'invalid-value' && error.message === 'The minimum sample is a whole number, 1 or more.');
    assert.throws(() => guardOf(SUPER)('PATCH', '/appsettings/default', {}, { FiscalYearStartMonth: 13 }), (error) => error.code === 'invalid-value');
  });
});

/** A fresh data layer on the mocked SharePoint, with the page's guard for `access`. */
let pages = 0;
async function siteAs(access) {
  const fake = createSharePointFake();
  fake.install();
  const ds = await import(`../migration/src/lib/data/dataService.js?settings=${pages += 1}`);
  ds.configure({ sharePoint: fake.settings });
  ds.setAccessGuard(writeGuard(access, ds.sharePointListTitles(), { now: () => NOW }));
  return { fake, ds };
}
const writesOf = (fake) => fake.writes().filter((entry) => !entry.path.endsWith('/contextinfo'));
const auditLines = (fake) => [...(fake.lists.get('auditlog') ?? [])];

describe('Part 2: Reporting settings', () => {
  const realFetch = globalThis.fetch;
  after(() => { globalThis.fetch = realFetch; });

  it('the save: what changed only, one audit line with who, the old and the new value, and no answer', async () => {
    const { fake, ds } = await siteAs(SUPER);
    const before = await readReportingSettings(ds);
    assert.deepEqual(before, { fiscalYearStartMonth: null, minSample: null });
    const saved = await saveReportingSettings(ds, SUPER, before, { fiscalYearStartMonth: 7, minSample: 3 }, { now: NOW });
    assert.equal(saved.detail, 'Fiscal year starts in: June (not set) to July; Minimum sample: 10 (not set) to 3');
    assert.deepEqual(await readReportingSettings(ds), { fiscalYearStartMonth: 7, minSample: 3 });
    const lines = auditLines(fake);
    assert.equal(lines.length, 1);
    assert.deepEqual([lines[0].Action, lines[0].Actor, lines[0].Detail], ['settings', 'x@deloitte.com', saved.detail]);
    assert.doesNotMatch(JSON.stringify(lines[0]), /questionId|answer/i);
    const again = await saveReportingSettings(ds, SUPER, await readReportingSettings(ds), { fiscalYearStartMonth: 7, minSample: 3 }, { now: NOW });
    assert.equal(again.changed, false, 'nothing changed: nothing written');
    assert.equal(auditLines(fake).length, 1);
  });
  it('refused for every role but a Super admin, with AccessDenied and not one request', async () => {
    for (const access of [ADMIN, PRODUCER, DESIGNER, LEADER]) {
      const { fake, ds } = await siteAs(access);
      fake.reset();
      await assert.rejects(saveReportingSettings(ds, access, { fiscalYearStartMonth: null, minSample: null }, { minSample: 3 }, { now: NOW }), AccessDenied);
      assert.equal(fake.requests.length, 0);
    }
  });
  it('a value out of range is refused before any request, by the screen\'s rule and again by the data layer\'s guard', async () => {
    const { fake, ds } = await siteAs(SUPER);
    fake.reset();
    await assert.rejects(saveReportingSettings(ds, SUPER, { fiscalYearStartMonth: null, minSample: null }, { fiscalYearStartMonth: 13 }, { now: NOW }), /Choose a month from January to December\./);
    assert.equal(fake.requests.length, 0);
    await assert.rejects(ds.updateAppSettings({ minSample: 0 }), (error) => error.code === 'invalid-value');
    assert.equal(writesOf(fake).length, 0, 'the data layer sends no write');
  });
  it('the words of what changed', () => {
    assert.equal(settingsChangeWords({ fiscalYearStartMonth: 6, minSample: 10 }, { fiscalYearStartMonth: 1, minSample: 10 }), 'Fiscal year starts in: June to January');
    assert.equal(settingsChangeWords({ fiscalYearStartMonth: 6, minSample: 10 }, { minSample: 25 }), 'Minimum sample: 10 to 25');
    assert.equal(settingsChangeWords({ fiscalYearStartMonth: 6, minSample: 10 }, { fiscalYearStartMonth: 6 }), '');
  });

  // A June year: 15 Jun 2026 is FY27-Q1, 1 Sep 2026 FY27-Q2, 15 Jul FY27-Q1. A July year: 15 Jun is FY26-Q4, 1 Sep FY27-Q1, 15 Jul FY27-Q1 still.
  const SESSIONS = [
    { id: 's-jun', clientId: 'acme', date: '2026-06-15', period: 'FY27-Q1' }, { id: 's-jul', clientId: 'acme', date: '2026-07-15', period: 'FY27-Q1' },
    { id: 's-sep', clientId: 'acme', date: '2026-09-01', period: 'FY27-Q2' }, { id: 's-old', clientId: 'acme', date: '2026-09-02', period: '' },
  ];
  const SUMMARIES = [{ id: 's-jun', clientId: 'acme', sessionDate: '2026-06-15', period: 'FY27-Q1' }, { id: 's-jul', clientId: 'acme', sessionDate: '2026-07-15', period: 'FY27-Q1' }];
  it('which stored quarters a new start month leaves behind: those whose date now falls in another quarter (an empty one is worked out on the screen)', () => {
    assert.deepEqual(periodsToMove(SESSIONS, SUMMARIES, 7), {
      sessions: [{ id: 's-jun', from: 'FY27-Q1', to: 'FY26-Q4' }, { id: 's-sep', from: 'FY27-Q2', to: 'FY27-Q1' }],
      summaries: [{ id: 's-jun', from: 'FY27-Q1', to: 'FY26-Q4' }],
    });
    assert.deepEqual(periodsToMove(SESSIONS, SUMMARIES, 6), { sessions: [], summaries: [] });
  });
  it('the confirmation says in plain words what changes at once and what keeps the old quarters', () => {
    assert.equal(fiscalChangeWords({ from: null, to: 7, sessions: 2, summaries: 1 }),
      'Start the fiscal year in July instead of June? At once, the dashboard\'s year and quarter choices, the days each one covers, and the quarter of every '
      + 'session planned from now on follow July. 2 sessions and 1 summary keep the quarter they were given under June, so the trend by quarter, each '
      + 'client\'s change since the quarter before, the comparisons with the quarter before and the same quarter last year, and the quarters a Leadership '
      + 'period reads still use June\'s quarters until you move them. After saving you can move them.');
    assert.match(fiscalChangeWords({ from: 6, to: 7, sessions: 0, summaries: 0 }), /Nothing stored needs to move: every session and summary already has July's quarter\.$/);
    assert.equal(moveQuestion({ sessions: 2, summaries: 1, month: 7 }), 'Move the stored quarters of 2 sessions and 1 summary to a year that starts in July? It writes 3 items, reads no answers and changes nothing else.');
  });
  it('moving the stored quarters writes only those, and says so in the audit list', async () => {
    const { fake, ds } = await siteAs(SUPER);
    for (const session of SESSIONS) fake.add('sessions', { AppId: session.id, Title: session.id, ClientId: session.clientId, SessionDate: `${session.date}T00:00:00Z`, Period: session.period, Status: 'completed' });
    for (const each of SUMMARIES) fake.add('sessionsummary', { AppId: each.id, Title: each.id, ClientId: each.clientId, SessionDate: `${each.sessionDate}T00:00:00Z`, Period: each.period, SummaryJson: '{"v":1}' });
    const moves = periodsToMove(SESSIONS, SUMMARIES, 7);
    const done = await moveStoredPeriods(ds, SUPER, moves, { month: 7, now: NOW });
    assert.deepEqual(done, { moved: 3, failed: [] });
    const period = (key, id) => fake.lists.get(key).find((item) => item.AppId === id).Period;
    assert.deepEqual([period('sessions', 's-jun'), period('sessions', 's-sep'), period('sessions', 's-jul'), period('sessions', 's-old')], ['FY26-Q4', 'FY27-Q1', 'FY27-Q1', '']);
    assert.equal(period('sessionsummary', 's-jun'), 'FY26-Q4');
    assert.equal(JSON.parse(fake.lists.get('sessionsummary').find((item) => item.AppId === 's-jun').SummaryJson).v, 1, 'the summary\'s figures are kept');
    assert.equal(auditLines(fake).at(-1).Detail, 'Stored quarters moved to a year that starts in July: 2 sessions, 1 summary');
    await assert.rejects(moveStoredPeriods(ds, ADMIN, moves, { month: 7, now: NOW }), AccessDenied, 'a Super admin\'s alone');
  });
});

describe('Part 3: a client\'s Industry and Region', () => {
  const realFetch = globalThis.fetch;
  after(() => { globalThis.fetch = realFetch; });
  it('a tag is plain text, trimmed, its spaces single, at most 60 characters; empty is allowed', () => {
    assert.equal(TAG_MAX, 60);
    assert.equal(cleanTag('  Consumer   goods \t'), 'Consumer goods');
    assert.equal(cleanTag('Retail\u0000\u0007'), 'Retail');
    assert.equal(cleanTag(''), '');
    assert.equal(cleanTag(null), '');
    assert.equal(cleanTag('x'.repeat(80)).length, 60);
  });
  it('the suggestions are the values already used, once each, in order', () => {
    const clients = [{ industry: 'Retail', region: 'US' }, { industry: ' retail ', region: 'EU' }, { industry: '', region: 'US' }, { industry: 'Energy' }];
    assert.deepEqual(tagSuggestions(clients, 'industry'), ['Energy', 'Retail']);
    assert.deepEqual(tagSuggestions(clients, 'region'), ['EU', 'US']);
  });
  it('the words of what changed', () => {
    assert.equal(tagChangeWords({ industry: '', region: 'US' }, { industry: 'Retail', region: 'US' }), 'Industry: none to Retail');
    assert.equal(tagChangeWords({ industry: 'Retail', region: 'US' }, { industry: 'Retail', region: '' }), 'Region: US to none');
  });
  it('an Admin saves them with the client update, and one audit line names the client', async () => {
    const { fake, ds } = await siteAs(ADMIN);
    fake.add('clients', { AppId: 'acme', Title: 'Acme', Name: 'Acme', Industry: '', Region: 'US' });
    const saved = await saveClientTags(ds, ADMIN, { id: 'acme', name: 'Acme', industry: '', region: 'US' }, { industry: '  Retail ', region: 'US' }, { now: NOW });
    assert.deepEqual(saved.client, { industry: 'Retail', region: 'US' });
    const item = fake.lists.get('clients').find((entry) => entry.AppId === 'acme');
    assert.deepEqual([item.Industry, item.Region], ['Retail', 'US']);
    const line = auditLines(fake).at(-1);
    assert.deepEqual([line.Action, line.ClientId, line.Detail], ['client', 'acme', 'Industry: none to Retail']);
  });
  it('refused for a Producer, a Designer and Leadership, with AccessDenied and not one request', async () => {
    for (const access of [PRODUCER, DESIGNER, LEADER]) {
      const { fake, ds } = await siteAs(access);
      fake.reset();
      await assert.rejects(saveClientTags(ds, access, { id: 'acme', name: 'Acme' }, { industry: 'Retail', region: '' }, { now: NOW }), AccessDenied);
      assert.equal(fake.requests.length, 0);
    }
  });
});
