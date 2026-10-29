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

describe('Part 3: the dashboard\'s figures, worked out by hand', async () => {
  const { dashboardOf, defaultFilters, filterOptions, reportCsv } = await import('../migration/src/lib/results/dashboard-model.js');
  const { METRICS } = await import('../migration/src/lib/results/metric-words.js');
  const json = (more) => ({ v: 1, title: '', startTime: '', facilitator: 'Rajeshwar Aedla', scaleMax: 5, pairedBefore: 3, pairedAfter: 3, moved: { started: 0, moved: 0 },
    distribution: null, firstChoices: [], kinds: { choice: 10 }, groups: {}, feedback: { count: 0, themes: [], quotes: [] }, ...more });
  const firsts = (counts) => [{ questionId: 'q', prompt: 'First?', options: Object.entries(counts).map(([label, count]) => ({ label, count })) }];
  const row = (id, clientId, period, sessionDate, more, summary) => ({ id, clientId, period, sessionDate, guests: 10, answers: 0, completed: 0, beforeCount: 0, afterCount: 0, pairedCount: 0,
    meanBefore: null, meanAfter: null, ...more, summary: json(summary) });
  // FY27-Q2: Kroger 20 Afters with a mean of 3.3 (k1 3.6, k2 3.0), Acme 20 at 2.7: all 3.0, so Kroger 110 and Acme 90. FY27-Q1: both at 3.0 (100).
  const SUMMARIES = [
    row('k1', 'kroger', 'FY27-Q2', '2026-10-01', { guests: 10, completed: 8, afterCount: 10, meanAfter: 3.6, pairedCount: 10 }, {
      pairedBefore: 3, pairedAfter: 4, moved: { started: 4, moved: 2 }, firstChoices: firsts({ Speed: 6, Cost: 4 }), groups: { Executives: 4 },
      distribution: { before: [0, 2, 4, 4, 0], after: [0, 0, 2, 6, 2] }, feedback: { count: 3, themes: [{ word: 'clarity', count: 3 }], quotes: [{ name: 'Asha', text: 'Clear' }] } }),
    row('k2', 'kroger', 'FY27-Q2', '2026-11-02', { guests: 10, completed: 6, afterCount: 10, meanAfter: 3.0, pairedCount: 10 }, {
      title: 'Afternoon', startTime: '14:00', moved: { started: 4, moved: 0 }, firstChoices: firsts({ speed: 2, Cost: 8 }), kinds: { ranking: 10 }, facilitator: 'Brian Milder',
      distribution: { before: [0, 0, 10, 0, 0], after: [0, 0, 10, 0, 0] }, feedback: { count: 3, themes: [{ word: 'clarity', count: 1 }, { word: 'pace', count: 2 }], quotes: [{ name: 'Ben', text: 'Good pace' }] } }),
    row('a1', 'acme', 'FY27-Q2', '2026-10-15', { guests: 20, completed: 16, afterCount: 20, meanAfter: 2.7, pairedCount: 20 }, {
      pairedBefore: 2.5, pairedAfter: 3, moved: { started: 8, moved: 6 }, firstChoices: firsts({ Speed: 2, Trust: 18 }) }),
    row('k0', 'kroger', 'FY27-Q1', '2026-07-01', { afterCount: 10, meanAfter: 3.0 }),
    row('a0', 'acme', 'FY27-Q1', '2026-07-02', { afterCount: 10, meanAfter: 3.0 }),
  ];
  const CLIENTS = [{ id: 'kroger', name: 'Kroger', industry: 'Retail', region: 'US' }, { id: 'acme', name: 'Acme', industry: 'Energy', region: 'EU' }];
  const near = (actual, expected, what) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${what}: ${actual}, not ${expected}`);
  const view = (filters = {}, more = {}) => dashboardOf({ summaries: SUMMARIES, clients: CLIENTS, filters: { ...defaultFilters({ period: 'FY27-Q2' }), ...filters }, startMonth: 6, minSample: 10, ...more });

  it('the six tiles of FY27 Q2, all clients: sessions, guests, completion, the index against the all-client average, the shift and moved to confident', () => {
    const { tiles } = view();
    assert.deepEqual(tiles.map((tile) => tile.id), ['sessions', 'guests', 'completion', 'confidence-index', 'confidence-shift', 'moved']);
    assert.deepEqual(tiles.map((tile) => tile.text), ['3', '40', '75%', '100', '+10%', '50%'], '(10 x 20% + 10 x 0% + 20 x 10%) / 40 = 10%; (2 + 0 + 6) of (4 + 4 + 8) = 50%');
    assert.ok(tiles.every((tile) => METRICS[tile.id]), 'every tile has its words');
  });
  it('the headline sentence is built from the numbers', () => {
    assert.equal(view().headline, '3 sessions with 40 guests at 2 clients in FY27 Q2. Confidence matched the all-client average (index 100); Kroger was highest at 110.');
    assert.equal(view({ clientIds: ['kroger'] }).headline, '2 sessions with 20 guests at 1 client in FY27 Q2. Confidence ran 10% above the all-client average (index 110).');
    assert.equal(view({ clientIds: ['acme'], compare: 'prior-quarter' }).headline, '1 session with 20 guests at 1 client in FY27 Q2. Confidence ran 10% below the quarter before (index 90).');
    assert.equal(view({ period: 'FY25-Q1', year: 'FY25', span: 'q1' }).headline, 'No session in FY25 Q1 has a summary yet.');
  });
  it('by client against 100, highest first, with the change since the quarter before, and each client\'s sessions against its own average', () => {
    const { byClient } = view();
    assert.deepEqual(byClient.map((each) => [each.clientId, each.name, each.sessions.length, each.guests]), [['kroger', 'Kroger', 2, 20], ['acme', 'Acme', 1, 20]]);
    near(byClient[0].index, 110, 'Kroger'); near(byClient[1].index, 90, 'Acme');
    near(byClient[0].change, 10, 'Kroger moved from 100'); near(byClient[1].change, -10, 'Acme moved from 100');
    assert.deepEqual(byClient[0].sessions.map((each) => [each.id, each.label]), [['k1', '1 Oct'], ['k2', '2 Nov 14:00 Afternoon']]);
    near(byClient[0].sessions[0].index, (3.6 / 3.3) * 100, 'k1 against Kroger'); near(byClient[0].sessions[1].index, (3.0 / 3.3) * 100, 'k2 against Kroger');
  });
  it('the baselines: one chosen client, and low sample below the minimum', () => {
    near(view({ clientIds: ['kroger'], compare: 'client', compareClient: 'acme' }).tiles[3].value, (3.3 / 2.7) * 100, 'Kroger against Acme');
    const small = view({}, { minSample: 50 });
    assert.equal(small.tiles[3].low, true, '40 Afters is under 50');
    assert.ok(small.headline.includes('(index 100, low sample)'));
    assert.equal(view().tiles[3].low, false);
  });
  it('the trend by quarter: the four quarters up to the one in view, each against the mean over them', () => {
    const { trend } = view({ clientIds: ['kroger'] });
    assert.deepEqual(trend.map((each) => each.period), ['FY26-Q3', 'FY26-Q4', 'FY27-Q1', 'FY27-Q2']);
    assert.deepEqual(trend.slice(0, 2).map((each) => each.index), [null, null]);
    near(trend[2].index, (3.0 / 3.2) * 100, 'Q1'); near(trend[3].index, (3.3 / 3.2) * 100, 'Q2');
  });
  it('the priority index, the confidence steps, the themes and the comments (names hidden when asked)', () => {
    const kroger = view({ clientIds: ['kroger'] });
    assert.deepEqual(kroger.priority.map((each) => [each.label, Math.round(each.share), Math.round(each.baseShare), Math.round(each.index)]), [['Cost', 60, 30, 200], ['Speed', 40, 25, 160]]);
    assert.deepEqual(kroger.distribution, { scaleMax: 5, before: [0, 10, 70, 20, 0], after: [0, 0, 60, 30, 10], beforeCount: 20, afterCount: 20 });
    assert.deepEqual(kroger.themes, [{ word: 'clarity', count: 4 }, { word: 'pace', count: 2 }]);
    assert.deepEqual(kroger.quotes.map((each) => [each.name, each.text]), [['Asha', 'Clear'], ['Ben', 'Good pace']]);
    assert.deepEqual(view({ clientIds: ['kroger'], hideNames: true }).quotes.map((each) => each.name), ['Guest 1', 'Guest 2']);
    assert.deepEqual(view({ clientIds: ['kroger'] }, { mayName: false }).quotes.map((each) => each.name), ['Guest 1', 'Guest 2'], 'a role without results.names never sees one');
  });
  it('the filters: a whole year, a month, a custom range, an industry, a facilitator, an activity type, a guest group', () => {
    assert.equal(view({ period: 'FY27', span: 'fy' }).tiles[0].text, '5');
    assert.deepEqual(view({ span: 'month', month: '2026-10' }).byClient.flatMap((each) => each.sessions.map((session) => session.id)).sort(), ['a1', 'k1']);
    assert.deepEqual(view({ span: 'custom', from: '2026-10-10', to: '2026-11-30' }).byClient.flatMap((each) => each.sessions.map((session) => session.id)).sort(), ['a1', 'k2']);
    assert.deepEqual(view({ industry: 'Retail' }).byClient.map((each) => each.clientId), ['kroger']);
    assert.deepEqual(view({ facilitator: 'Brian Milder' }).byClient.flatMap((each) => each.sessions.map((session) => session.id)), ['k2']);
    assert.deepEqual(view({ kind: 'ranking' }).byClient.flatMap((each) => each.sessions.map((session) => session.id)), ['k2']);
    assert.deepEqual(view({ group: 'Executives' }).byClient.flatMap((each) => each.sessions.map((session) => session.id)), ['k1']);
    const options = filterOptions(SUMMARIES, CLIENTS);
    assert.deepEqual([options.industries, options.facilitators, options.groups, options.kinds.map((kind) => kind.id)], [['Energy', 'Retail'], ['Brian Milder', 'Rajeshwar Aedla'], ['Executives'], ['choice', 'ranking']]);
    assert.deepEqual(options.years, ['FY27']);
  });
  it('Export report: one row a session, by client, with the indexes; no cell starts a formula', () => {
    const csv = reportCsv(view());
    const lines = csv.trim().split('\r\n');
    assert.equal(lines[0], 'Client,Session,Date,Guests,Completed,Confidence index,Session index,Low sample');
    assert.equal(lines.length, 1 + 3);
    assert.equal(lines[1], 'Kroger,1 Oct,2026-10-01,10,8,110,109,');
    const risky = reportCsv(dashboardOf({ summaries: SUMMARIES, clients: [{ id: 'kroger', name: '=HYPERLINK("x")' }, CLIENTS[1]], filters: defaultFilters({ period: 'FY27-Q2' }), startMonth: 6, minSample: 10 }));
    assert.ok(!risky.split('\r\n').some((line) => /(^|,)=/.test(line)), 'a name that starts a formula is quoted');
  });
});

export { rebuildSummaries, writeSummary };

describe('Part 4: the empty states (Prompt 21, Phase 6)', async () => {
  const { dashboardOf, defaultFilters, emptyStateOf, reportCsv } = await import('../migration/src/lib/results/dashboard-model.js');
  const none = { all: false, clientIds: new Set(), sessionIds: new Set(), sessionClients: new Set(), periods: [] };
  // A session that ended with nobody answering: its summary has no guest, no After and no mean.
  const silent = { id: 's0', clientId: 'kroger', period: 'FY27-Q2', sessionDate: '2026-10-01', guests: 0, answers: 0, completed: 0, beforeCount: 0, afterCount: 0, pairedCount: 0,
    meanBefore: null, meanAfter: null, summary: { v: 1, title: '', startTime: '09:00', facilitator: '', scaleMax: null, pairedBefore: null, pairedAfter: null, moved: { started: 0, moved: 0 },
      distribution: null, firstChoices: [], kinds: {}, groups: {}, feedback: { count: 0, themes: [], quotes: [] } } };

  it('a person with no client, session or period is told so, and nothing is read for them', () => {
    assert.deepEqual(emptyStateOf({ reach: none, summaries: [] }), {
      kind: 'no-scope', title: 'No clients to show yet',
      line: 'You have not been given a client or a period yet. Ask a Super admin or an Admin to give you access; your figures appear here when they do.',
    });
    assert.equal(emptyStateOf({ reach: reachOf(ANNABELL, { now: NOW }), summaries: [] }).kind, 'no-summaries');
    const blank = accessOf(grant('Leadership', 'client', { clientId: '' }));
    assert.equal(emptyStateOf({ reach: reachOf(blank, { now: NOW }), summaries: [] })?.kind, 'no-scope', 'a role row that names no client is no place');
  });

  it('no summary at all: no session has ended yet; with summaries, no empty state (the headline speaks for an empty period)', () => {
    assert.deepEqual(emptyStateOf({ reach: null, summaries: [] }), {
      kind: 'no-summaries', title: 'No session has ended yet', line: 'A session\'s figures appear here once it has ended.',
    });
    assert.equal(emptyStateOf({ reach: null, summaries: [silent] }), null);
  });

  it('a session with no answers counts as a session with nobody in it: no figure reads NaN', () => {
    const board = dashboardOf({ summaries: [silent], clients: [{ id: 'kroger', name: 'Kroger' }], filters: defaultFilters({ period: 'FY27-Q2' }), startMonth: 6, minSample: 10 });
    assert.deepEqual(board.tiles.map((tile) => tile.text), ['1', '0', 'None yet', 'Not measured', 'Not measured', 'Not measured']);
    assert.equal(board.headline, '1 session with 0 guests at 1 client in FY27 Q2. Confidence was not measured in these sessions.');
    assert.doesNotMatch(JSON.stringify(board), /NaN|Infinity/);
    assert.doesNotMatch(reportCsv(board), /NaN|Infinity/);
  });
});

describe('Part 5: the words (Prompt 21, Phase 6 wording review)', async () => {
  const { dashboardFileName, rebuildQuestion } = await import('../migration/src/lib/results/dashboard-model.js');

  it('Rebuild asks in plain words, with no word of the plumbing', () => {
    assert.equal(rebuildQuestion(1), 'Rebuild the summary of 1 ended session? It reads that session\'s answers once and writes one summary, which can take a few seconds. Nothing else changes.');
    assert.equal(rebuildQuestion(3), 'Rebuild the summaries of 3 ended sessions? Each one reads that session\'s answers once and writes one summary, which can take a few seconds a session. Nothing else changes.');
    assert.doesNotMatch(rebuildQuestion(3), /request|token|digest/i);
  });

  it('Export report is named like the other exports: lower case, hyphens, the day it was made', () => {
    assert.equal(dashboardFileName('FY27 Q2', new Date('2026-10-29T12:00:00Z')), 'dashboard-fy27-q2-2026-10-29.csv');
    assert.equal(dashboardFileName('1 Oct 2026 to 31 Oct 2026', new Date('2026-10-29T12:00:00Z')), 'dashboard-1-oct-2026-to-31-oct-2026-2026-10-29.csv');
  });
});
