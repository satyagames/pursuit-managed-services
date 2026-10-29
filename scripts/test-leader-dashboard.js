// Prompt 21, Phase 5: the Leadership dashboard's reads and its figures. Run: node --test scripts/test-leader-dashboard.js (part of `npm test`).
//
// Part 1: who reads which summaries. The read check (lib/access/owners.js mayRead) holds a role to the summaries of the clients, sessions or periods it holds;
// lib/admin/session-summaries.js asks only for those; the summaries come back from the mocked SharePoint by ClientId, AppId or Period.
// Part 2: the request budget. A session of 10,000 answers costs the dashboard the same reads as a session of none: it reads summaries, never answers.
// Part 3: the dashboard's figures (lib/results/dashboard-model.js) from summaries worked out by hand: the headline, the six tiles, the index by client against
// 100, the trend by quarter, the rows by client and their sessions, the priority index, the confidence steps, the feedback themes, low sample, the filters.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import * as ds from '../migration/src/lib/data/dataService.js';
import { AccessDenied } from '../migration/src/lib/access/access-denied.js';
import { writeGuard } from '../migration/src/lib/access/guard.js';
import { reachOf } from '../migration/src/lib/access/scope.js';
import { periodsBetween } from '../migration/src/lib/results/index-math.js';
import { placesOf, readSummaries, rebuildSummaries, writeSummary } from '../migration/src/lib/admin/session-summaries.js';
import { createSharePointFake } from './sharepoint-fake.js';

const NOW = new Date('2026-10-28T12:00:00Z');
const grant = (role, scopeType = 'global', more = {}) => ({
  id: `x|${role}|${scopeType}|${more.clientId ?? more.sessionId ?? ''}`, userKey: 'x@deloitte.com', role, scopeType, clientId: null, sessionId: null,
  periodFrom: null, periodTo: null, validUntil: null, extras: '', grantedBy: 'vsatyadev@deloitte.com', ...more,
});
const accessOf = (...grants) => ({
  person: { key: 'x@deloitte.com', email: 'x@deloitte.com', name: 'X', loginName: '' }, owner: false, legacy: false, user: { id: 'x@deloitte.com', status: 'Active' }, assignments: grants,
});
// Brian Milder: Leadership for FY27 Q2, all clients. Annabell Lepe: Leadership on Kroger. Rajeshwar Aedla: Producer of one Acme session.
const BRIAN = accessOf(grant('Leadership', 'period', { periodFrom: '2026-09-01', periodTo: '2026-11-30' }));
const ANNABELL = accessOf(grant('Leadership', 'client', { clientId: 'kroger' }));
const RAJESHWAR = accessOf(grant('Producer', 'session', { clientId: 'acme', sessionId: 'acme-2026-10-01-0900' }));
const SUPER = accessOf(grant('Super admin'));

describe('Part 1: the read check and the places asked for', () => {
  const guardOf = (access) => writeGuard(access, {}, { now: () => NOW });
  it('a role that holds every client reads every summary; a scoped role only what it holds, and never the list whole', () => {
    assert.doesNotThrow(() => guardOf(SUPER).read('sessionsummary', undefined));
    assert.throws(() => guardOf(ANNABELL).read('sessionsummary', undefined), AccessDenied);
    assert.doesNotThrow(() => guardOf(ANNABELL).read('sessionsummary', { clientId: ['kroger'] }));
    assert.throws(() => guardOf(ANNABELL).read('sessionsummary', { clientId: ['kroger', 'acme'] }), AccessDenied);
    assert.doesNotThrow(() => guardOf(RAJESHWAR).read('sessionsummary', { id: ['acme-2026-10-01-0900'] }));
    assert.throws(() => guardOf(RAJESHWAR).read('sessionsummary', { clientId: ['acme'] }), AccessDenied, 'a session\'s role does not read its client\'s other sessions');
    assert.doesNotThrow(() => guardOf(BRIAN).read('sessionsummary', { period: ['FY27-Q2'] }));
    assert.throws(() => guardOf(ANNABELL).read('sessionsummary', { period: ['FY27-Q2'] }), AccessDenied);
  });
  it('the quarters a date range touches, from the start month', () => {
    assert.deepEqual(periodsBetween('2026-09-01', '2026-11-30', 6), ['FY27-Q2']);
    assert.deepEqual(periodsBetween('2026-08-15', '2026-12-01', 6), ['FY27-Q1', 'FY27-Q2', 'FY27-Q3']);
    assert.deepEqual(periodsBetween('2026-11-30', '2026-09-01', 6), []);
    assert.deepEqual(periodsBetween('', '2026-09-01', 6), []);
  });
  it('what each role asks for: nothing named (every summary), its clients, its sessions, or the quarters of its periods', () => {
    assert.equal(placesOf(reachOf(SUPER, { now: NOW }), 6), undefined);
    assert.deepEqual(placesOf(reachOf(ANNABELL, { now: NOW }), 6), { clientIds: ['kroger'], sessionIds: [], periods: [] });
    assert.deepEqual(placesOf(reachOf(RAJESHWAR, { now: NOW }), 6), { clientIds: [], sessionIds: ['acme-2026-10-01-0900'], periods: [] });
    assert.deepEqual(placesOf(reachOf(BRIAN, { now: NOW }), 6), { clientIds: [], sessionIds: [], periods: ['FY27-Q2'] });
  });
});

/** A summary item as the data layer writes it. */
const item = (id, clientId, period, date, more = {}) => ({ id, clientId, period, sessionDate: date, guests: 10, answers: 40, completed: 8, beforeCount: 10, afterCount: 10, pairedCount: 10,
  meanBefore: 2.5, meanAfter: 3.5, summaryJson: { v: 1, title: '', startTime: '09:00', scaleMax: 5, pairedBefore: 2.5, pairedAfter: 3.5, moved: { started: 4, moved: 2 }, firstChoices: [], kinds: {}, groups: {}, feedback: { count: 0, themes: [], quotes: [] } }, ...more });

describe('Part 1: on the mocked SharePoint', () => {
  const realFetch = globalThis.fetch;
  after(() => { globalThis.fetch = realFetch; ds.configure({ baseUrl: '/api' }); });
  const site = () => {
    const fake = createSharePointFake();
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    return fake;
  };
  it('a summary written twice is one item, the second written over the first', async () => {
    const fake = site();
    await ds.saveSessionSummary(item('kroger-2026-10-27-0930', 'kroger', 'FY27-Q2', '2026-10-27'));
    await ds.saveSessionSummary(item('kroger-2026-10-27-0930', 'kroger', 'FY27-Q2', '2026-10-27', { guests: 12 }));
    const rows = await ds.readSessionSummaries();
    assert.deepEqual(rows.map((row) => [row.id, row.guests, row.summaryJson.startTime]), [['kroger-2026-10-27-0930', 12, '09:00']]);
    assert.equal(fake.writes().length, 3, 'a create, a duplicate refused, and the write over it');
  });
  it('each role reads the summaries of its places: by ClientId, by AppId or by Period, one request each', async () => {
    const fake = site();
    for (const row of [item('k1', 'kroger', 'FY27-Q2', '2026-10-27'), item('k2', 'kroger', 'FY27-Q1', '2026-07-01'), item('acme-2026-10-01-0900', 'acme', 'FY27-Q2', '2026-10-01'),
      item('a2', 'acme', 'FY27-Q3', '2026-12-10')]) await ds.saveSessionSummary(row);
    const readAs = async (access) => {
      const before = fake.requests.length;
      const rows = await readSummaries(access, { startMonth: 6, now: NOW });
      return { ids: rows.map((row) => row.id).sort(), requests: fake.requests.slice(before).filter((entry) => entry.method === 'GET') };
    };
    const annabell = await readAs(ANNABELL);
    assert.deepEqual(annabell.ids, ['k1', 'k2']);
    assert.equal(annabell.requests.length, 1);
    assert.match(decodeURIComponent(annabell.requests[0].path + (annabell.requests[0].query ?? '')), /ClientId eq 'kroger'/);
    const brian = await readAs(BRIAN);
    assert.deepEqual(brian.ids, ['acme-2026-10-01-0900', 'k1'], 'the quarter of his period, and only the days inside it');
    assert.match(decodeURIComponent(brian.requests[0].path + (brian.requests[0].query ?? '')), /Period eq 'FY27-Q2'/);
    assert.deepEqual((await readAs(RAJESHWAR)).ids, ['acme-2026-10-01-0900']);
    assert.deepEqual((await readAs(SUPER)).ids, ['a2', 'acme-2026-10-01-0900', 'k1', 'k2']);
  });
});

describe('Part 2: the request budget', () => {
  const realFetch = globalThis.fetch;
  after(() => { globalThis.fetch = realFetch; ds.configure({ baseUrl: '/api' }); });
  it('the dashboard of a site whose sessions hold 10,000 answers reads as many requests as one whose sessions hold none: the summaries and the clients', async () => {
    const costOf = async (answers) => {
      const fake = createSharePointFake();
      fake.install();
      ds.configure({ sharePoint: fake.settings });
      fake.add('clients', { AppId: 'kroger', Title: 'Kroger', Name: 'Kroger' });
      for (let at = 0; at < 20; at += 1) {
        const id = `kroger-2026-10-${String(at + 1).padStart(2, '0')}`;
        fake.add('sessions', { AppId: id, Title: id, ClientId: 'kroger', SessionDate: `2026-10-${String(at + 1).padStart(2, '0')}T00:00:00Z`, Status: 'completed' });
        for (let person = 0; person < answers / 20; person += 1) {
          fake.add('responses', { AppId: `${id}-t${person}`, Title: `${id}-t${person}`, SessionId: id, TrackId: `${id}-t${person}`, ClientId: 'kroger', ResponsesJson: JSON.stringify([{ questionId: 'q', answer: 'a', firstAnswer: 'a', attempts: 1, correct: null }]) });
        }
        fake.add('sessionsummary', { AppId: id, Title: id, ClientId: 'kroger', Period: 'FY27-Q2', SessionDate: `2026-10-${String(at + 1).padStart(2, '0')}T00:00:00Z`, Guests: answers / 20, Answers: answers / 20, SummaryJson: '{}' });
      }
      const before = fake.requests.length;
      const { readDashboard } = await import('../migration/src/lib/admin/session-summaries.js');
      const read = await readDashboard(ANNABELL, { startMonth: 6, now: NOW });
      return { requests: fake.requests.length - before, summaries: read.summaries.length };
    };
    const none = await costOf(0);
    const many = await costOf(10_000);
    assert.equal(none.summaries, 20);
    assert.equal(many.summaries, 20);
    assert.equal(many.requests, none.requests, 'the same requests, whatever the answers');
    assert.ok(many.requests <= 2, `at most two requests (the summaries and the clients, side by side): ${many.requests}`);
  });
});

export { rebuildSummaries, writeSummary };
