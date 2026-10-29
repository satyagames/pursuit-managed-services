// Prompt 21, Phase 3: clients, sessions (several a day) and the team (wireframe boards 5 and 6). Run: node --test scripts/test-sessions-plan.js
// (part of `npm test`).
//
// What this holds, in plain JS and on the mocked SharePoint REST: schema version 6's columns of PMSClientSessions (StartTime, Sequence, Period,
// PlannedDate, and the built-in Title as the session's title); the period of a date from the fiscal-year start month; a planned session's id
// (`<slug>-<yyyy-mm-dd>-<hhmm>`, then -2, -3 when SharePoint refuses a duplicate) while an existing id keeps working; two sessions on one day,
// for one client and for two, with their QR codes and their answers tied to the right session; the New session form's rules; the labels Planned,
// Live and Ended; the Client team (registered people only, whole client or selected sessions, a Designer's "may also edit activities", removing);
// and Today's new flow: an Admin plans, a Producer starts (the only thing that makes a session live), and one session is live at a time, said
// plainly. What the real site answers is QA-TESTING.md's.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LISTS, VERSION, selectOf } from '../migration/src/lib/schema/pms-schema.js';
import { META } from '../migration/src/lib/schema/pms-schema-meta.js';
import { LIST_WRITES } from '../migration/src/lib/access/access-matrix.js';
import { AccessDenied } from '../migration/src/lib/access/access-denied.js';
import { writeGuard } from '../migration/src/lib/access/guard.js';
import { sessionLabel, sessionTitle } from '../migration/src/lib/access/people.js';
import { TEAM_ROLES, addToTeam, teamCandidates, teamProblems, teamRows } from '../migration/src/lib/access/team.js';
import {
  ONE_LIVE_LIMIT, daySessionsOf, oneLiveWords, periodLabel, periodOf, planProblems, planSessionFor, plannedSessionId, sequenceWords, stageOf,
} from '../migration/src/lib/admin/session-plan.js';
import { checkDeleteRefusal } from '../migration/src/lib/admin/admin-content.js';
import { evaluateReadiness, loadReadinessInputs, startPlannedSession } from '../migration/src/lib/admin/admin-today.js';
import { seedPack } from '../migration/src/lib/setup/seed.js';
import { samplePack } from '../migration/src/lib/setup/sample-clients.js';
import { createSharePointFake } from './sharepoint-fake.js';

const NOW = new Date('2026-10-29T09:00:00Z');
const DAY = '2026-10-29';
let pages = 0;
/** A page of its own on a fresh fake site with the sample clients. */
async function siteWith(options = {}) {
  const fake = createSharePointFake(options);
  fake.install();
  const ds = await import(`../migration/src/lib/data/dataService.js?sessions-plan=${pages += 1}`);
  ds.configure({ sharePoint: fake.settings });
  await seedPack(ds, samplePack());
  return { fake, ds };
}
const person = (email) => ({ key: email, email, name: email, loginName: `i:0#.f|membership|${email}` });
const ACTIVE = (id, fullName = id) => ({ id, fullName, email: id, status: 'Active', source: 'Typed' });
const rowOf = (userKey, role, scopeType = 'global', more = {}) => ({
  id: `${userKey}|${role}|${scopeType}|${more.clientId ?? more.sessionId ?? ''}`, userKey, role, scopeType, clientId: null, sessionId: null, periodFrom: null,
  periodTo: null, validUntil: null, extras: '', grantedBy: 'vsatyadev@deloitte.com', ...more,
});
const accessFor = (email, assignments) => ({ person: person(email), owner: false, legacy: false, user: ACTIVE(email), assignments });
const SUPER = accessFor('vsatyadev@deloitte.com', [rowOf('vsatyadev@deloitte.com', 'Super admin')]);
const ADMIN = accessFor('pulmathur@deloitte.com', [rowOf('pulmathur@deloitte.com', 'Admin')]);
const PRODUCER = accessFor('raedla@deloitte.com', [rowOf('raedla@deloitte.com', 'Producer', 'client', { clientId: 'c-kroger' })]);
const guarded = (ds, access) => ds.setAccessGuard(writeGuard(access, ds.sharePointListTitles(), { now: () => NOW }));

describe('schema version 6: a session\'s time, title, order in its day, period and when it was planned', () => {
  it('this build is for version 6, and PMSClientSessions gains StartTime, Sequence, Period and PlannedDate (since 6), with its title in the built-in Title', () => {
    assert.equal(VERSION, 8); // (6 until Prompt 21, Phase 4, which added the roster's GuestGroup, 7 until its Phase 5; these five columns are still since 6)
    const fields = LISTS.sessions.fields;
    assert.deepEqual(
      ['title', 'startTime', 'sequence', 'period', 'plannedDate'].map((field) => [field, fields[field]?.column, fields[field]?.kind]),
      [['title', 'Title', 'text'], ['startTime', 'StartTime', 'text'], ['sequence', 'Sequence', 'number'], ['period', 'Period', 'text'], ['plannedDate', 'PlannedDate', 'date']],
    );
    assert.ok(selectOf('sessions').endsWith(',Title,StartTime,Sequence,Period,PlannedDate'), 'the new columns are the last of every read of the list');
    for (const column of ['StartTime', 'Sequence', 'Period', 'PlannedDate']) assert.equal(META.sessions.columns[column]?.since, 6, `${column} is version 6's`);
    assert.equal(META.sessions.columns.Title?.since, undefined, 'Title is SharePoint\'s own column, on every site');
    // (The repository's rule: exactly what a recorded request filters on is indexed. Nothing filters on Period until the Leadership dashboard.)
    assert.equal(fields.period.indexed, undefined);
  });

  it('a site Setup made for version 5 stops every page with PMS-LST-011 until Setup has added the four columns', async () => {
    const fake = createSharePointFake({ listsVersion: 5 });
    fake.install();
    const ds = await import(`../migration/src/lib/data/dataService.js?sessions-plan=${pages += 1}`);
    const stops = [];
    ds.configure({ sharePoint: fake.settings, onStop: (code) => stops.push(code) });
    await assert.rejects(ds.getAppSettings(), (error) => error.code === 'PMS-LST-011');
    await assert.rejects(ds.readLists([{ list: 'appsettings' }, { list: 'sessions' }]), (error) => error.code === 'PMS-LST-011');
    assert.ok(stops.every((code) => code === 'PMS-LST-011') && stops.length >= 1);
  });
});

describe('the period of a date, from the fiscal-year start month', () => {
  it('June (the setting\'s ASSUMED default): FY27 runs June 2026 to May 2027, a quarter every three months', () => {
    assert.equal(periodOf('2026-10-29', 6), 'FY27-Q2');
    assert.equal(periodOf('2026-06-01', 6), 'FY27-Q1');
    assert.equal(periodOf('2026-05-31', 6), 'FY26-Q4');
    assert.equal(periodOf('2027-03-15', 6), 'FY27-Q4');
    assert.equal(periodOf('2026-12-01'), 'FY27-Q3', 'an empty setting reads as June');
  });
  it('another start month moves every period; January makes the calendar year', () => {
    assert.equal(periodOf('2026-10-29', 1), 'FY26-Q4');
    assert.equal(periodOf('2026-01-01', 1), 'FY26-Q1');
    assert.equal(periodOf('2026-10-29', 10), 'FY27-Q1');
    assert.equal(periodOf('2026-09-30', 10), 'FY26-Q4');
  });
  it('no date, no period; a session made before version 6 shows the period of its date', () => {
    assert.equal(periodOf('', 6), '');
    assert.equal(periodOf('not a date', 6), '');
    assert.equal(periodLabel({ date: '2026-10-29', period: '' }, 6), 'FY27-Q2');
    assert.equal(periodLabel({ date: '2026-10-29', period: 'FY27-Q2' }, 1), 'FY27-Q2', 'a stored period is what was planned');
  });
});

describe('a session\'s id: existing ids keep working, a new one is <slug>-<yyyy-mm-dd>-<hhmm>', () => {
  const api = { slugify: (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') };
  it('the client\'s slug (or its name), the date and the start time', () => {
    assert.equal(plannedSessionId(api, { id: 'c-kroger', name: 'Kroger', slug: 'kroger' }, '2026-10-29', '09:30'), 'kroger-2026-10-29-0930');
    assert.equal(plannedSessionId(api, { id: 'c-old', name: 'Older Co.' }, '2026-10-29', '14:05'), 'older-co-2026-10-29-1405');
  });

  it('planning writes the id, and when SharePoint refuses it as a duplicate the next try is -2, then -3', async () => {
    const { fake, ds } = await siteWith();
    guarded(ds, SUPER);
    const client = await ds.getClient('c-kroger');
    const fields = planSessionFor(ds, client, { date: DAY, startTime: '09:30', title: 'Morning' }, { sessions: [], fiscalStartMonth: 6, now: NOW });
    const first = await ds.planSession(fields);
    const second = await ds.planSession(fields);
    const third = await ds.planSession(fields);
    assert.deepEqual([first.id, second.id, third.id], ['kroger-2026-10-29-0930', 'kroger-2026-10-29-0930-2', 'kroger-2026-10-29-0930-3']);
    assert.equal(fake.lists.get('sessions').filter((row) => row.ClientId === 'c-kroger').length, 3);
    const read = await ds.getSession(third.id);
    assert.deepEqual([read.title, read.startTime, read.period, read.sequence, read.date, read.status], ['Morning', '09:30', 'FY27-Q2', 1, DAY, 'not-started']);
    assert.ok(read.plannedDate, 'when it was planned');
  });

  it('an id made by the old Go live (<slug>-<date>) is still found, made live and read by every screen', async () => {
    const { ds } = await siteWith();
    const { session } = await ds.activateClient('c-kroger', DAY);
    assert.equal(session.id, `kroger-${DAY}`);
    assert.equal((await ds.getAppSettings()).activeSessionId, `kroger-${DAY}`);
    assert.equal(sessionLabel(session), '29 Oct 2026', 'no time and no title: the date alone');
  });

  it('the title of a session made before version 6 is its id (what the data layer always wrote into Title): it reads as no title', () => {
    assert.equal(sessionTitle({ id: 'kroger-2026-10-29', title: 'kroger-2026-10-29' }), '');
    assert.equal(sessionTitle({ id: 'kroger-2026-10-29-0930', title: 'Morning' }), 'Morning');
    assert.equal(sessionLabel({ id: 'kroger-2026-10-29', date: '2026-10-29', title: 'kroger-2026-10-29' }), '29 Oct 2026');
  });
});

describe('two sessions on one day', () => {
  it('for one client: two rows, each with its Sequence, and "1 of 2" by start time', async () => {
    const { ds } = await siteWith();
    guarded(ds, SUPER);
    const client = await ds.getClient('c-kroger');
    const afternoon = await ds.planSession(planSessionFor(ds, client, { date: DAY, startTime: '14:00', title: 'Afternoon' }, { sessions: [], now: NOW }));
    const sessions = [afternoon];
    const morning = await ds.planSession(planSessionFor(ds, client, { date: DAY, startTime: '09:00', title: 'Morning' }, { sessions, now: NOW }));
    assert.deepEqual([afternoon.sequence, morning.sequence], [1, 2], 'Sequence: the order they were planned in');
    const day = daySessionsOf([afternoon, morning], 'c-kroger', DAY);
    assert.deepEqual(day.map((session) => session.id), [morning.id, afternoon.id], 'the day by start time');
    assert.deepEqual(day.map((session) => sequenceWords(session, [afternoon, morning])), ['1 of 2 today', '2 of 2 today']);
    assert.equal(sequenceWords(morning, [morning]), '', 'one session that day: nothing to say');
  });

  it('for two clients: each its own session, and QR codes and answers stay with the session they were made in', async () => {
    const { fake, ds } = await siteWith();
    guarded(ds, SUPER);
    const [kroger, dominos] = await Promise.all([ds.getClient('c-kroger'), ds.getClient('c-dominos')]);
    const one = await ds.planSession(planSessionFor(ds, kroger, { date: DAY, startTime: '09:00', title: '' }, { sessions: [], now: NOW }));
    const two = await ds.planSession(planSessionFor(ds, dominos, { date: DAY, startTime: '09:00', title: '' }, { sessions: [one], now: NOW }));
    assert.deepEqual([one.id, two.id], ['kroger-2026-10-29-0900', 'dominos-2026-10-29-0900']);
    await ds.startSession(one.id);
    const krogerCode = await ds.provisionQrToken('c-kroger');
    const krogerVisit = crypto.randomUUID();
    await ds.beginVisit(krogerVisit, one.id, 'c-kroger');
    await ds.startSession(two.id);
    const dominosCode = await ds.provisionQrToken('c-dominos');
    const dominosVisit = crypto.randomUUID();
    await ds.beginVisit(dominosVisit, two.id, 'c-dominos');
    assert.deepEqual([krogerCode.sessionId, dominosCode.sessionId], [one.id, two.id]);
    const tracks = fake.lists.get('tracks');
    assert.equal(tracks.find((row) => row.AppId === krogerVisit)?.SessionId, one.id);
    assert.equal(tracks.find((row) => row.AppId === dominosVisit)?.SessionId, two.id);
    assert.deepEqual((await ds.listClientTracks(one.id)).map((track) => track.id), [krogerVisit], 'a session\'s visits are its own');
    // (Kroger's code was not scanned, so starting Domino's retired it: codes nobody scanned for the session replaced stop working.)
    assert.equal((await ds.getQrToken(krogerCode.id)).used, true);
  });

  it('starting a planned session takes in activities added since it was planned, as Go live always did', async () => {
    const { ds } = await siteWith();
    guarded(ds, SUPER);
    const client = await ds.getClient('c-kroger');
    const planned = await ds.planSession(planSessionFor(ds, client, { date: DAY, startTime: '10:00', title: '' }, { sessions: [], now: NOW }));
    const added = await ds.createSection({ id: 'kroger-late', title: 'Added later', order: 99, enabled: true, industryTags: [], questionIds: [], clientId: 'c-kroger', description: '' });
    const { session, settings } = await ds.startSession(planned.id);
    assert.ok(session.sectionIds.includes(added.id));
    assert.equal(settings.activeSessionId, planned.id);
    assert.equal(settings.activeClientId, 'c-kroger');
  });
});

describe('the New session form', () => {
  const sessions = [{ id: 'kroger-2026-10-29-0900', clientId: 'c-kroger', date: DAY, startTime: '09:00', title: 'Morning' }];
  it('a date and a start time are needed; a title only when the client has another session that day', () => {
    assert.deepEqual(planProblems({ date: '', startTime: '', title: '' }, { sessions, clientId: 'c-kroger' }), { date: 'Choose the date.', startTime: 'Choose the start time.' });
    assert.deepEqual(planProblems({ date: '2026-10-30', startTime: '09:00', title: '' }, { sessions, clientId: 'c-kroger' }), {});
    assert.deepEqual(planProblems({ date: DAY, startTime: '14:00', title: ' ' }, { sessions, clientId: 'c-kroger' }), { title: 'Give this session a title: the client has another session that day.' });
    assert.deepEqual(planProblems({ date: DAY, startTime: '14:00', title: 'Afternoon' }, { sessions, clientId: 'c-kroger' }), {});
    assert.deepEqual(planProblems({ date: DAY, startTime: '14:00', title: '' }, { sessions, clientId: 'c-dominos' }), {}, 'another client\'s session is not this one\'s day');
    assert.equal(planProblems({ date: '2026-02-30', startTime: '25:00', title: '' }, { sessions, clientId: 'c-kroger' }).date, 'Choose the date.');
    assert.equal(planProblems({ date: DAY, startTime: '25:00', title: 'x' }, { sessions, clientId: 'c-kroger' }).startTime, 'Choose the start time.');
  });
  it('what is planned: the id, the period from the setting, the order in the day, when it was planned', () => {
    const api = { slugify: (text) => String(text ?? '').toLowerCase() };
    const fields = planSessionFor(api, { id: 'c-kroger', name: 'Kroger', slug: 'kroger' }, { date: DAY, startTime: '14:00', title: ' Afternoon ' }, { sessions, fiscalStartMonth: 6, now: NOW });
    assert.deepEqual(fields, {
      id: 'kroger-2026-10-29-1400', clientId: 'c-kroger', date: DAY, startTime: '14:00', title: 'Afternoon', sequence: 2, period: 'FY27-Q2', plannedDate: NOW.toISOString(),
    });
  });
});

describe('Planned, Live and Ended: labels of the existing Status values', () => {
  const settings = { activeSessionId: 'b' };
  it('Ended once ended, Live while it is the live session, Planned otherwise', () => {
    assert.equal(stageOf({ id: 'a', status: 'not-started' }, settings), 'Planned');
    assert.equal(stageOf({ id: 'b', status: 'not-started' }, settings), 'Live');
    assert.equal(stageOf({ id: 'b', status: 'in-progress' }, settings), 'Live');
    assert.equal(stageOf({ id: 'b', status: 'completed' }, settings), 'Ended');
    assert.equal(stageOf({ id: 'a', status: 'completed' }, settings), 'Ended');
    assert.equal(stageOf({ id: 'a', status: 'in-progress' }, settings), 'Planned', 'ASSUMED: visited once, no longer live, not ended');
  });
});

describe('the one-live-session limit, said plainly', () => {
  it('ONE_LIVE_LIMIT says it, and Today says what going live with another session does', () => {
    assert.match(ONE_LIVE_LIMIT, /One session can be live at a time/);
    const status = { live: true, session: { id: 'kroger-2026-10-29-0900', clientId: 'c-kroger', date: DAY, startTime: '09:00' }, client: { id: 'c-kroger', name: 'Kroger' } };
    assert.equal(oneLiveWords(status, { id: 'dominos-2026-10-29-1000' }), 'One session can be live at a time. Going live with this one takes the place of Kroger, 29 Oct 2026, 09:00 for participants; that session is not ended.');
    assert.equal(oneLiveWords(status, { id: 'kroger-2026-10-29-0900' }), '', 'the live one itself');
    assert.equal(oneLiveWords({ live: false }, { id: 'x' }), '');
  });
});

describe('the Client team', () => {
  const users = [ACTIVE('raedla@deloitte.com', 'Aedla, Rajeshwar'), ACTIVE('mohammadahussain@deloitte.com', 'Hussain, Mohammad Afrid'), ACTIVE('ablepe@deloitte.com', 'Lepe, Annabell'),
    { ...ACTIVE('gone@deloitte.com', 'Gone, Leaver'), status: 'Disabled' }];
  const sessions = [{ id: 'kroger-2026-10-29-0900', clientId: 'c-kroger', date: DAY }, { id: 'kroger-2026-10-29-1400', clientId: 'c-kroger', date: DAY }, { id: 'acme-1', clientId: 'c-acme', date: DAY }];
  const rows = [
    rowOf('raedla@deloitte.com', 'Producer', 'client', { clientId: 'c-kroger' }),
    rowOf('mohammadahussain@deloitte.com', 'Designer', 'session', { sessionId: 'kroger-2026-10-29-1400', extras: 'content.edit' }),
    rowOf('ablepe@deloitte.com', 'Leadership', 'client', { clientId: 'c-acme' }),
    rowOf('pulmathur@deloitte.com', 'Admin'),
  ];
  it('the team roles are Producer, Designer and Leadership', () => assert.deepEqual(TEAM_ROLES, ['Producer', 'Designer', 'Leadership']));
  it('a client\'s team: its whole-client rows and its sessions\' rows, never another client\'s or a global role', () => {
    const team = teamRows(rows, users, { clientId: 'c-kroger', sessions });
    assert.deepEqual(team.map((row) => [row.name, row.role, row.reach, row.extras]), [
      ['Aedla, Rajeshwar', 'Producer', 'Whole client', ''],
      ['Hussain, Mohammad Afrid', 'Designer', '29 Oct 2026', 'may also edit activities'],
    ]);
  });
  it('the search is among registered, active people only, by name or email', () => {
    assert.deepEqual(teamCandidates(users, '').map((user) => user.id), ['raedla@deloitte.com', 'mohammadahussain@deloitte.com', 'ablepe@deloitte.com']);
    assert.deepEqual(teamCandidates(users, 'huss').map((user) => user.id), ['mohammadahussain@deloitte.com']);
    assert.deepEqual(teamCandidates(users, 'gone').map((user) => user.id), [], 'a disabled person is not offered');
    assert.deepEqual(teamCandidates(users, 'someone@deloitte.com'), [], 'nobody outside PMSUsers');
  });
  it('what the form needs: a person, a role, and sessions when the scope is selected sessions; the extra is a Designer\'s', () => {
    assert.deepEqual(teamProblems({ userKey: '', role: 'Producer', scope: 'client', sessionIds: [] }), { userKey: 'Choose the person.' });
    assert.deepEqual(teamProblems({ userKey: 'raedla@deloitte.com', role: 'Producer', scope: 'sessions', sessionIds: [] }), { sessionIds: 'Pick at least one session.' });
    assert.deepEqual(teamProblems({ userKey: 'raedla@deloitte.com', role: 'Admin', scope: 'client', sessionIds: [] }), { role: 'Choose Producer, Designer or Leadership.' });
    assert.deepEqual(teamProblems({ userKey: 'raedla@deloitte.com', role: 'Producer', scope: 'client', sessionIds: [], editActivities: true }), { editActivities: 'Only a Designer can be allowed to edit activities.' });
    assert.deepEqual(teamProblems({ userKey: 'raedla@deloitte.com', role: 'Designer', scope: 'client', sessionIds: [], editActivities: true }), {});
  });

  it('adding writes one row for the whole client, or one for each selected session, each with an audit line; an Admin may, a Producer may not', async () => {
    const { fake, ds } = await siteWith();
    guarded(ds, ADMIN);
    const whole = await addToTeam(ds, ADMIN, { clientId: 'c-kroger', userKey: 'raedla@deloitte.com', role: 'Producer', scope: 'client', sessionIds: [] }, { now: NOW });
    assert.deepEqual(whole, { added: 1, already: 0 });
    const some = await addToTeam(ds, ADMIN, { clientId: 'c-kroger', userKey: 'mohammadahussain@deloitte.com', role: 'Designer', scope: 'sessions', sessionIds: ['kroger-a', 'kroger-b'], editActivities: true }, { now: NOW });
    assert.deepEqual(some, { added: 2, already: 0 });
    const again = await addToTeam(ds, ADMIN, { clientId: 'c-kroger', userKey: 'raedla@deloitte.com', role: 'Producer', scope: 'client', sessionIds: [] }, { now: NOW });
    assert.deepEqual(again, { added: 0, already: 1 }, 'given twice: already there, nothing written');
    const stored = fake.lists.get('roleassignments').filter((row) => row.GrantedBy === 'pulmathur@deloitte.com');
    assert.deepEqual(stored.map((row) => [row.AppId, row.Extras]).sort(), [
      ['mohammadahussain@deloitte.com|Designer|session|kroger-a', 'content.edit'],
      ['mohammadahussain@deloitte.com|Designer|session|kroger-b', 'content.edit'],
      ['raedla@deloitte.com|Producer|client|c-kroger', ''],
    ]);
    assert.equal(fake.lists.get('auditlog').filter((line) => line.Actor === 'pulmathur@deloitte.com' && line.Action === 'grant').length, 3);
    guarded(ds, PRODUCER);
    const before = fake.lists.get('roleassignments').length;
    await assert.rejects(addToTeam(ds, PRODUCER, { clientId: 'c-kroger', userKey: 'ablepe@deloitte.com', role: 'Leadership', scope: 'client', sessionIds: [] }, { now: NOW }), AccessDenied);
    assert.equal(fake.lists.get('roleassignments').length, before, 'nothing written');
  });
});

describe('Today: the Admin plans, the Producer starts', () => {
  it('a session is made by those who may create clients and sessions: no longer by a Producer\'s Go live (the role matrix\'s writes)', () => {
    assert.deepEqual(LIST_WRITES.sessions.create, ['clients.manage']);
  });

  it('a Producer cannot plan a session; an Admin can, but cannot start it; the Producer starts it', async () => {
    const { fake, ds } = await siteWith();
    const client = await ds.getClient('c-kroger');
    guarded(ds, PRODUCER);
    await assert.rejects(ds.planSession(planSessionFor(ds, client, { date: DAY, startTime: '09:00', title: '' }, { sessions: [], now: NOW })), AccessDenied);
    guarded(ds, ADMIN);
    const planned = await ds.planSession(planSessionFor(ds, client, { date: DAY, startTime: '09:00', title: '' }, { sessions: [], now: NOW }));
    fake.reset();
    await assert.rejects(ds.startSession(planned.id), AccessDenied, 'an Admin may not start a session');
    assert.equal(fake.count((entry) => entry.method !== 'GET' && !String(entry.path).endsWith('/contextinfo')), 0, 'nothing written');
    guarded(ds, PRODUCER);
    const started = await startPlannedSession(ds, planned.id);
    assert.equal(started.verified, true);
    assert.equal((await ds.getAppSettings()).activeSessionId, planned.id);
  });

  it('readiness: with nothing planned for the client that day, a person who may not plan is told to ask an Admin (Go live stays off)', () => {
    const base = { client: { id: 'c-kroger', name: 'Kroger', status: 'active', logoUrl: 'x' }, date: DAY, today: DAY, sections: [{ id: 's', clientId: 'c-kroger', enabled: true, title: 'A', questionIds: [] }],
      questions: [], options: [], sessions: [], clients: [], target: null, roster: null, schema: null };
    const producer = evaluateReadiness({ ...base, mayPlan: false });
    const row = producer.find((entry) => entry.id === 'session-none');
    assert.equal(row?.level, 'blocker');
    assert.equal(row.detail, 'No session is planned for Kroger on 2026-10-29.');
    assert.equal(row.fix, 'An Admin plans sessions on the client\'s page under Clients. Ask one to plan this session.');
    assert.equal(evaluateReadiness(base).some((entry) => entry.id === 'session-none'), false, 'the PIN\'s legacy admin and a Super admin go live as before: Go live makes the day\'s session');
  });

  it('readiness reads the roster of the session picked for the day, not of the day\'s old id', async () => {
    const asked = [];
    const api = { sessionIdFor: (client, date) => `kroger-${date}`, readLists: async (queries) => { asked.push(...queries); return queries.map(() => []); } };
    const sessions = [
      { id: 'kroger-2026-10-29-0900', clientId: 'c-kroger', date: DAY, startTime: '09:00', participationMode: 'staff' },
      { id: 'kroger-2026-10-29-1400', clientId: 'c-kroger', date: DAY, startTime: '14:00', participationMode: 'client-visit' },
    ];
    const picked = await loadReadinessInputs(api, { client: { id: 'c-kroger' }, date: DAY, sections: [], sessions, sessionId: 'kroger-2026-10-29-1400' });
    assert.equal(picked.target.id, 'kroger-2026-10-29-1400');
    assert.deepEqual(asked, [{ list: 'visitorroster', where: { sessionId: 'kroger-2026-10-29-1400' } }]);
    const first = await loadReadinessInputs(api, { client: { id: 'c-kroger' }, date: DAY, sections: [], sessions });
    assert.equal(first.target.id, 'kroger-2026-10-29-0900', 'with none picked: the day\'s first that has not ended');
  });
});

describe('a client\'s open sessions, now that it can have several', () => {
  it('the confidence check may not be deleted while ANY open session of the client asks it', () => {
    const open = [{ status: 'not-started', confidenceCheck: false }, { status: 'not-started', confidenceCheck: true }];
    assert.match(checkDeleteRefusal(open), /asked in an open session/);
    assert.equal(checkDeleteRefusal([{ status: 'completed', confidenceCheck: true }, { status: 'not-started', confidenceCheck: false }]), '');
    assert.match(checkDeleteRefusal({ status: 'not-started', confidenceCheck: true }), /asked in an open session/, 'one session, as before');
    assert.equal(checkDeleteRefusal(null), '');
  });
});

describe('the words the screens draw', () => {
  it('Today\'s session picker: the start time, the title, its place in the day and its label', async () => {
    const { sessionChoiceWords } = await import('../migration/src/lib/admin/session-plan.js');
    const sessions = [
      { id: 'kroger-2026-10-29-0900', clientId: 'c-kroger', date: DAY, startTime: '09:00', title: 'Morning', status: 'not-started' },
      { id: 'kroger-2026-10-29-1400', clientId: 'c-kroger', date: DAY, startTime: '14:00', title: '', status: 'completed' },
      { id: `kroger-${DAY}`, clientId: 'c-kroger', date: DAY, title: `kroger-${DAY}` },
    ];
    const settings = { activeSessionId: 'kroger-2026-10-29-0900' };
    assert.equal(sessionChoiceWords(sessions[0], sessions, settings), '09:00, Morning, 2 of 3 today, Live');
    assert.equal(sessionChoiceWords(sessions[1], sessions, settings), '14:00, 3 of 3 today, Ended');
    assert.equal(sessionChoiceWords(sessions[2], sessions, settings), 'No start time, 1 of 3 today, Planned');
  });

  it('a session\'s team in the Sessions list: the client\'s team, and who is on that session alone', async () => {
    const { sessionTeamWords } = await import('../migration/src/lib/access/team.js');
    const users = [ACTIVE('raedla@deloitte.com', 'Aedla, Rajeshwar'), ACTIVE('mohammadahussain@deloitte.com', 'Hussain, Mohammad Afrid')];
    const rows = [
      rowOf('raedla@deloitte.com', 'Producer', 'client', { clientId: 'c-kroger' }),
      rowOf('mohammadahussain@deloitte.com', 'Designer', 'session', { sessionId: 'kroger-2026-10-29-1400' }),
    ];
    assert.equal(sessionTeamWords(rows, users, { id: 'kroger-2026-10-29-1400', clientId: 'c-kroger' }), 'Client team (1), and Hussain, Mohammad Afrid (Designer)');
    assert.equal(sessionTeamWords(rows, users, { id: 'kroger-2026-10-29-0900', clientId: 'c-kroger' }), 'Client team (1)');
    assert.equal(sessionTeamWords([], users, { id: 'x', clientId: 'c-kroger' }), 'No team yet');
  });

  it('Go live says why it is off for someone who may not start a session (an Admin)', async () => {
    const { goLiveWhy } = await import('../migration/src/lib/admin/today-view.js');
    const state = { loaded: true, client: { name: 'Kroger' }, dateValid: true, inputsBusy: false, blockers: 0, reason: null, alreadyLive: false, date: DAY };
    assert.equal(goLiveWhy({ ...state, mayRun: false }), 'Only a Producer or a Super admin starts a session. You can plan sessions on the client\'s page under Clients.');
    assert.equal(goLiveWhy(state), '', 'and nothing to say for one who may');
  });
});
