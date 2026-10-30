// Prompt 21, Phase 2: Manage Users (boards 3 and 4). Run: node --test scripts/test-users.js (part of `npm test`).
//
// The rules the Users screens stand on, in plain JS: the list (role chips, client and session filters, status, search, pages of 50, the role and reach
// columns), the people picker's state machine (debounce, two characters, eight suggestions, the keyboard, a stale search dropped) and its words, the
// directory search through the data layer (the people picker web service; refused: "unverified"), adding a person (no access with it), disabling,
// removing a role (what they lose), the extras, the history, and the guards, which also live in the data layer: nothing refused is sent.
// On the mocked SharePoint REST; what the real site answers to the people picker is QA-TESTING.md's.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AccessDenied } from '../migration/src/lib/access/access-denied.js';
import { writeGuard } from '../migration/src/lib/access/guard.js';
import { disableProblem } from '../migration/src/lib/access/grants.js';
import {
  PAGE_SIZE, ROLE_CHIPS, filterPeople, pageOf, peopleRows, reachWords, sessionLabel, sessionsOfClient,
} from '../migration/src/lib/access/people.js';
import { createPicker, pickerWords } from '../migration/src/lib/access/picker.js';
import {
  addPerson, emailProblem, historyOf, loseWords, removeRole, setExtras, setStatus,
} from '../migration/src/lib/access/people-ops.js';
import { createSharePointFake } from './sharepoint-fake.js';

const NOW = new Date('2026-10-28T12:00:00Z');
let pages = 0;
async function siteWith(options = {}) {
  const fake = createSharePointFake(options);
  fake.install();
  const ds = await import(`../migration/src/lib/data/dataService.js?users=${pages += 1}`);
  ds.configure({ sharePoint: fake.settings });
  return { fake, ds };
}
const person = (email) => ({ key: email, email, name: email, loginName: `i:0#.f|membership|${email}` });
const ACTIVE = (id, fullName = id) => ({ id, fullName, email: id, status: 'Active', source: 'Typed' });
const rowOf = (userKey, role, scopeType = 'global', more = {}) => ({
  id: `${userKey}|${role}|${scopeType}|${more.clientId ?? more.sessionId ?? ''}`, userKey, role, scopeType, clientId: null, sessionId: null, periodFrom: null, periodTo: null,
  validUntil: null, extras: '', grantedBy: 'vsatyadev@deloitte.com', ...more,
});
const accessFor = (email, assignments, owner = false) => ({ person: person(email), owner, legacy: false, user: ACTIVE(email), assignments });

const CLIENTS = [{ id: 'kroger', name: 'Kroger' }, { id: 'acme', name: 'Acme' }];
const SESSIONS = [
  { id: 'kroger-2026-10-28', clientId: 'kroger', date: '2026-10-28' },
  { id: 'kroger-2026-11-04', clientId: 'kroger', date: '2026-11-04', title: 'Round two', startTime: '14:30' },
  { id: 'acme-2026-10-30', clientId: 'acme', date: '2026-10-30' },
];
/** The brief's sample people, with the access each has. */
const USERS = [
  ACTIVE('vsatyadev@deloitte.com', 'Satyadev, Vedala Venkata'), ACTIVE('pulmathur@deloitte.com', 'Mathur, Pulkit'), ACTIVE('raedla@deloitte.com', 'Aedla, Rajeshwar'),
  ACTIVE('mohammadahussain@deloitte.com', 'Hussain, Mohammad Afrid'), ACTIVE('bmilder@deloitte.com', 'Milder, Brian'), ACTIVE('ablepe@deloitte.com', 'Lepe, Annabell'),
  { ...ACTIVE('gone@deloitte.com', 'Gone, Leaver'), status: 'Disabled' }, ACTIVE('nobody@deloitte.com', 'Nobody, New'),
];
const ROWS = [
  rowOf('vsatyadev@deloitte.com', 'Super admin'), rowOf('pulmathur@deloitte.com', 'Admin', 'global', { extras: 'users.manage' }),
  rowOf('raedla@deloitte.com', 'Producer', 'client', { clientId: 'kroger' }), rowOf('raedla@deloitte.com', 'Producer', 'session', { sessionId: 'acme-2026-10-30' }),
  rowOf('mohammadahussain@deloitte.com', 'Designer', 'client', { clientId: 'acme' }),
  rowOf('bmilder@deloitte.com', 'Leadership', 'period', { periodFrom: '2026-12-01', periodTo: '2027-02-28' }),
  rowOf('ablepe@deloitte.com', 'Leadership', 'client', { clientId: 'kroger', validUntil: '2026-10-01' }),
  rowOf('gone@deloitte.com', 'Producer', 'client', { clientId: 'kroger' }),
];
const people = () => peopleRows(USERS, ROWS, { clients: CLIENTS, sessions: SESSIONS, now: NOW });
const namesOf = (rows) => rows.map((each) => each.email.split('@')[0]);

describe('the users list: columns, chips, filters, pages', () => {
  it('each person has the roles and the reach their current assignment rows give; an ended access is not a role', () => {
    const byEmail = Object.fromEntries(people().map((each) => [each.email, each]));
    assert.deepEqual(byEmail['vsatyadev@deloitte.com'].roles, ['Super admin']);
    assert.deepEqual(byEmail['vsatyadev@deloitte.com'].reach, ['All clients']);
    assert.deepEqual(byEmail['raedla@deloitte.com'].roles, ['Producer']);
    assert.deepEqual(byEmail['raedla@deloitte.com'].reach, ['Kroger', 'Acme, 30 Oct 2026']);
    assert.deepEqual(byEmail['bmilder@deloitte.com'].reach, ['All clients, 1 Dec 2026 to 28 Feb 2027']);
    assert.deepEqual(byEmail['ablepe@deloitte.com'].roles, [], 'Kroger access that ended on 1 Oct 2026 is no role now');
    assert.deepEqual(byEmail['nobody@deloitte.com'].roles, [], 'adding a person gives no client access');
    assert.equal(byEmail['gone@deloitte.com'].status, 'Disabled');
    assert.equal(byEmail['pulmathur@deloitte.com'].name, 'Mathur, Pulkit');
  });

  it('says a place the way people say it, with the end date, and a session by its date, time and title', () => {
    const at = { clients: CLIENTS, sessions: SESSIONS };
    assert.equal(reachWords(rowOf('x', 'Admin'), at), 'All clients');
    assert.equal(reachWords(rowOf('x', 'Producer', 'client', { clientId: 'kroger', validUntil: '2026-11-30' }), at), 'Kroger, until 30 Nov 2026');
    assert.equal(reachWords(rowOf('x', 'Producer', 'client', { clientId: 'zzz' }), at), 'zzz', 'a client that is gone is named by its id');
    assert.equal(sessionLabel(SESSIONS[0]), '28 Oct 2026');
    assert.equal(sessionLabel(SESSIONS[1]), '4 Nov 2026, 14:30, Round two');
    assert.equal(reachWords(rowOf('x', 'Designer', 'session', { sessionId: 'kroger-2026-11-04' }), at), 'Kroger, 4 Nov 2026, 14:30, Round two');
  });

  it('the chips are All, Super admins, Admins, Producers, Designers, Leadership; a chip keeps the people holding that role now', () => {
    assert.deepEqual(ROLE_CHIPS.map((chip) => chip.label), ['All', 'Super admins', 'Admins', 'Producers', 'Designers', 'Leadership']);
    assert.deepEqual(namesOf(filterPeople(people(), { sessions: SESSIONS, now: NOW, chip: 'Producer' })), ['raedla', 'gone']);
    assert.deepEqual(namesOf(filterPeople(people(), { sessions: SESSIONS, now: NOW, chip: 'Leadership' })), ['bmilder'], 'ablepe\'s access has ended');
    assert.equal(filterPeople(people(), { sessions: SESSIONS, now: NOW, chip: 'all' }).length, USERS.length);
  });

  it('search finds a name or an email in any case; Status keeps Active or Disabled', () => {
    assert.deepEqual(namesOf(filterPeople(people(), { sessions: SESSIONS, now: NOW, search: 'ANNA' })), ['ablepe']);
    assert.deepEqual(namesOf(filterPeople(people(), { sessions: SESSIONS, now: NOW, search: 'raedla@' })), ['raedla']);
    assert.deepEqual(namesOf(filterPeople(people(), { sessions: SESSIONS, now: NOW, status: 'Disabled' })), ['gone']);
    assert.equal(filterPeople(people(), { sessions: SESSIONS, now: NOW, status: 'Active' }).length, USERS.length - 1);
  });

  it('the Client filter keeps who can reach that client (its own roles, its sessions\', and all-client roles); a Session filter narrows to that session', () => {
    assert.deepEqual(namesOf(filterPeople(people(), { sessions: SESSIONS, now: NOW, clientId: 'acme' })), ['vsatyadev', 'pulmathur', 'raedla', 'mohammadahussain', 'bmilder']);
    assert.deepEqual(namesOf(filterPeople(people(), { sessions: SESSIONS, now: NOW, clientId: 'kroger', chip: 'Producer' })), ['raedla', 'gone']);
    assert.deepEqual(namesOf(filterPeople(people(), { sessions: SESSIONS, now: NOW, clientId: 'acme', sessionId: 'acme-2026-10-30', chip: 'Producer' })), ['raedla']);
    assert.deepEqual(namesOf(filterPeople(people(), { sessions: SESSIONS, now: NOW, clientId: 'acme', sessionId: 'acme-2026-10-30', chip: 'Designer' })), ['mohammadahussain'], 'a client\'s role covers its sessions');
    assert.deepEqual(namesOf(filterPeople(people(), { sessions: SESSIONS, now: NOW, clientId: 'kroger', sessionId: 'kroger-2026-10-28', chip: 'Producer' })), ['raedla', 'gone']);
  });

  it('picking a client lists its sessions by date, time and title, earliest first', () => {
    assert.deepEqual(sessionsOfClient(SESSIONS, 'kroger').map((entry) => entry.label), ['28 Oct 2026', '4 Nov 2026, 14:30, Round two']);
    assert.deepEqual(sessionsOfClient(SESSIONS, '').map((entry) => entry.id), [], 'no client, no sessions to choose');
  });

  it('pages 50 at a time, and a page past the end is the last', () => {
    assert.equal(PAGE_SIZE, 50);
    const many = Array.from({ length: 120 }, (_, index) => index);
    assert.deepEqual([pageOf(many, 1).items.length, pageOf(many, 3).items.length, pageOf(many, 1).pages], [50, 20, 3]);
    assert.deepEqual(pageOf(many, 9).page, 3);
    assert.deepEqual(pageOf([], 1), { items: [], page: 1, pages: 1, total: 0 });
  });
});

/** Waits for `ms` of the picker's own clock. */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const PEOPLE = Array.from({ length: 12 }, (_, index) => ({ key: `p${index}@deloitte.com`, name: `Person ${index}`, email: `p${index}@deloitte.com`, jobTitle: '' }));

describe('the people picker: search as you type', () => {
  it('starts at two characters, waits for a pause in typing, and asks once for what was typed last', async () => {
    const asked = [];
    const picker = createPicker({ delay: 20, search: async (text) => { asked.push(text); return PEOPLE.slice(0, 3); } });
    picker.type('p');
    await wait(40);
    assert.deepEqual(asked, [], 'one character asks nothing');
    assert.equal(picker.state.status, 'idle');
    picker.type('pe');
    picker.type('per');
    picker.type('pers');
    assert.equal(picker.state.status, 'waiting');
    await wait(60);
    assert.deepEqual(asked, ['pers'], 'three keystrokes inside the pause are one search');
    assert.equal(picker.state.suggestions.length, 3);
    assert.equal(picker.state.status, 'results');
  });

  it('shows at most eight suggestions', async () => {
    const picker = createPicker({ delay: 1, search: async () => PEOPLE });
    picker.type('person');
    await wait(20);
    assert.equal(picker.state.suggestions.length, 8);
  });

  it('a search that is overtaken is aborted and its answer never shown', async () => {
    const first = deferred();
    const signals = [];
    const picker = createPicker({
      delay: 1,
      search: (text, { signal }) => { signals.push(signal); return text === 'ab' ? first.promise : Promise.resolve([PEOPLE[1]]); },
    });
    picker.type('ab');
    await wait(15);
    assert.equal(picker.state.status, 'searching');
    picker.type('abc');
    assert.equal(signals[0].aborted, true, 'typing again aborts the search in flight');
    await wait(15);
    first.resolve([PEOPLE[0]]);
    await wait(5);
    assert.deepEqual(picker.state.suggestions.map((each) => each.name), ['Person 1'], 'the late answer of "ab" is dropped');
  });

  it('Down and Up move through the suggestions (and round), Enter chooses, Escape closes the list', async () => {
    const picker = createPicker({ delay: 1, search: async () => PEOPLE.slice(0, 3) });
    picker.type('per');
    await wait(15);
    assert.equal(picker.state.open, true);
    assert.equal(picker.state.active, -1);
    picker.key('ArrowDown');
    assert.equal(picker.state.active, 0);
    picker.key('ArrowDown'); picker.key('ArrowDown'); picker.key('ArrowDown');
    assert.equal(picker.state.active, 0, 'past the last is the first');
    picker.key('ArrowUp');
    assert.equal(picker.state.active, 2, 'up from the first is the last');
    assert.equal(picker.key('Enter').chosen.name, 'Person 2');
    assert.equal(picker.state.open, false);
    picker.type('pers');
    await wait(15);
    picker.key('ArrowDown');
    assert.deepEqual(picker.key('Escape'), { closed: true });
    assert.equal(picker.state.open, false);
    assert.equal(picker.key('Enter').chosen, undefined, 'a closed list chooses nothing');
  });

  it('a site that refuses the search says "unverified" and falls back to a typed email; Enter takes a full email as typed', async () => {
    const picker = createPicker({ delay: 1, search: async () => { throw Object.assign(new Error('no'), { status: 403 }); } });
    picker.type('raedla@deloitte.com');
    await wait(15);
    assert.equal(picker.state.status, 'unavailable');
    assert.match(pickerWords(picker.state), /unverified/);
    assert.match(pickerWords(picker.state), /full email/);
    assert.deepEqual(picker.key('Enter'), { typed: 'raedla@deloitte.com' });
    picker.type('raedla');
    await wait(15);
    assert.deepEqual(picker.key('Enter'), {}, 'half an email is not taken');
  });

  it('says in words, for a screen reader, what the list holds', async () => {
    const picker = createPicker({ delay: 1, search: async (text) => (text === 'zz' ? [] : PEOPLE.slice(0, 3)) });
    assert.match(pickerWords(picker.state), /Type at least 2 letters/);
    picker.type('zz');
    await wait(15);
    assert.equal(pickerWords(picker.state), 'No one found. Type the full email address instead.');
    picker.type('per');
    await wait(15);
    assert.equal(pickerWords(picker.state), '3 people found. Use the up and down arrows, then Enter.');
    picker.type('perso');
    assert.equal(pickerWords(picker.state), 'Searching...');
  });
});

describe('the directory search, through the data layer', () => {
  const directory = [
    { name: 'Aedla, Rajeshwar', email: 'RAedla@deloitte.com', jobTitle: 'Senior Consultant' },
    { name: 'Hussain, Mohammad Afrid', email: 'mohammadahussain@deloitte.com' },
    ...Array.from({ length: 12 }, (_, index) => ({ name: `Smith, Sam ${index}`, email: `ssmith${index}@deloitte.com` })),
  ];

  it('asks the people picker for at most eight, and hands back the key, name, email and job title', async () => {
    const { fake, ds } = await siteWith({ directory });
    fake.reset();
    const real = globalThis.fetch;
    let body;
    globalThis.fetch = (url, init) => { if (/clientPeoplePicker/.test(String(url))) body = JSON.parse(init.body); return real(url, init); };
    let found;
    try { found = await ds.searchDirectory('smith'); } finally { globalThis.fetch = real; }
    assert.equal(found.length, 8);
    const sent = fake.requests.find((entry) => /clientPeoplePickerSearchUser/.test(entry.path));
    assert.equal(sent.method, 'POST');
    assert.equal(body.queryParams.MaximumEntitySuggestions, 8);
    assert.equal(body.queryParams.QueryString, 'smith');
    const [one] = await ds.searchDirectory('aedla');
    assert.deepEqual(one, { key: 'raedla@deloitte.com', name: 'Aedla, Rajeshwar', email: 'raedla@deloitte.com', loginName: 'i:0#.f|membership|RAedla@deloitte.com', jobTitle: 'Senior Consultant' });
  });

  it('passes an abort signal to the request', async () => {
    const { fake, ds } = await siteWith({ directory });
    const real = globalThis.fetch;
    let seen;
    globalThis.fetch = (url, init) => { if (/clientPeoplePicker/.test(String(url))) seen = init.signal; return real(url, init); };
    try {
      const controller = new AbortController();
      await ds.searchDirectory('aedla', { signal: controller.signal });
      controller.abort();
      assert.equal(seen.aborted, true, 'the page\'s own abort reaches the request');
    } finally { globalThis.fetch = real; }
    assert.ok(fake);
  });

  it('a site that refuses it is an error with its status, and is not taken for a lost sign-in', async () => {
    const { fake, ds } = await siteWith({ directory, pickerStatus: 403 });
    let lost = 0;
    ds.onSessionChange(() => { lost += 1; });
    await assert.rejects(ds.searchDirectory('aedla'), (error) => error.status === 403);
    assert.equal(lost, 0, 'the sign-in ladder does not run for a refused search');
    assert.ok(fake);
  });

  it('under the write guard the search still goes (it changes nothing), for a person who may add people; and the local server has no directory (null)', async () => {
    const { ds } = await siteWith({ directory });
    ds.setAccessGuard(writeGuard(accessFor('vsatyadev@deloitte.com', [rowOf('vsatyadev@deloitte.com', 'Super admin')]), ds.sharePointListTitles(), { now: () => NOW }));
    assert.equal((await ds.searchDirectory('aedla')).length, 1);
    ds.configure({ baseUrl: 'http://localhost:1' });
    assert.equal(await ds.searchDirectory('aedla'), null);
  });
});

describe('adding, disabling, removing: the writes and their audit lines', () => {
  const SUPER = accessFor('vsatyadev@deloitte.com', [rowOf('vsatyadev@deloitte.com', 'Super admin')]);
  const ADMIN = accessFor('pulmathur@deloitte.com', [rowOf('pulmathur@deloitte.com', 'Admin')]);
  const ADMIN_PLUS = accessFor('pulmathur@deloitte.com', [rowOf('pulmathur@deloitte.com', 'Admin', 'global', { extras: 'users.manage' })]);
  /** A site with the people of the brief (as SharePoint stores them), a guard for `access`, and the audit list empty. */
  async function site(access = SUPER, options = {}) {
    const { fake, ds } = await siteWith(options);
    for (const user of USERS) fake.add('users', { Title: user.id, AppId: user.id, FullName: user.fullName, Email: user.email, Status: user.status, Source: 'Typed' });
    for (const each of ROWS) {
      fake.add('roleassignments', {
        Title: each.id, AppId: each.id, UserKey: each.userKey, Role: each.role, ScopeType: each.scopeType, ClientId: each.clientId ?? '', SessionId: each.sessionId ?? '',
        Extras: each.extras, ...(each.validUntil ? { ValidUntil: each.validUntil } : {}),
      });
    }
    ds.setAccessGuard(writeGuard(access, ds.sharePointListTitles(), { now: () => NOW }));
    fake.reset();
    return { fake, ds };
  }
  const audit = (fake) => fake.lists.get('auditlog').map((line) => [line.Action, line.TargetUser, line.Detail]);

  it('an email is checked before anything is written', () => {
    assert.equal(emailProblem('raedla@deloitte.com'), null);
    assert.match(emailProblem('raedla'), /full email/);
    assert.match(emailProblem(''), /full email/);
    assert.match(emailProblem('a b@deloitte.com'), /full email/);
  });

  it('adding a person writes their row (key: the email in lower case, source, who added them) and one audit line, and gives no access', async () => {
    const { fake, ds } = await site();
    const done = await addPerson(ds, SUPER, { email: 'New.Person@Deloitte.com', name: 'Person, New', loginName: 'i:0#.f|membership|new.person@deloitte.com', jobTitle: 'Analyst', source: 'Directory' }, { now: NOW });
    assert.deepEqual([done.added, done.already, done.key], [true, false, 'new.person@deloitte.com']);
    const stored = fake.item('users', 'new.person@deloitte.com');
    assert.deepEqual([stored.FullName, stored.Email, stored.Status, stored.Source, stored.AddedBy, stored.JobTitle],
      ['Person, New', 'new.person@deloitte.com', 'Active', 'Directory', 'vsatyadev@deloitte.com', 'Analyst']);
    assert.equal(fake.lists.get('roleassignments').length, ROWS.length, 'no role was given');
    assert.deepEqual(audit(fake), [['add-user', 'new.person@deloitte.com', 'Added from the directory']]);
  });

  it('a person typed in by hand is a Typed one; adding the same person again is "already there", with no second row or line', async () => {
    const { fake, ds } = await site();
    await addPerson(ds, SUPER, { email: 'typed@deloitte.com', source: 'Typed' }, { now: NOW });
    assert.equal(fake.item('users', 'typed@deloitte.com').Source, 'Typed');
    assert.deepEqual(audit(fake)[0], ['add-user', 'typed@deloitte.com', 'Typed in by hand']);
    const again = await addPerson(ds, SUPER, { email: 'TYPED@deloitte.com', source: 'Typed' }, { now: NOW });
    assert.deepEqual([again.added, again.already], [false, true]);
    assert.equal(fake.lists.get('users').filter((entry) => entry.AppId === 'typed@deloitte.com').length, 1);
    assert.equal(fake.lists.get('auditlog').length, 1);
  });

  it('only a Super admin adds people, or an Admin given that extra (decision C); another is refused and nothing is sent', async () => {
    for (const refused of [ADMIN, accessFor('raedla@deloitte.com', [rowOf('raedla@deloitte.com', 'Producer', 'client', { clientId: 'kroger' })])]) {
      const { fake, ds } = await site(refused);
      await assert.rejects(addPerson(ds, refused, { email: 'z@deloitte.com', source: 'Typed' }, { now: NOW }), AccessDenied);
      assert.equal(fake.writes().length, 0);
    }
    const { fake, ds } = await site(ADMIN_PLUS);
    assert.equal((await addPerson(ds, ADMIN_PLUS, { email: 'z@deloitte.com', source: 'Typed' }, { now: NOW })).added, true);
    assert.ok(fake.item('users', 'z@deloitte.com'));
  });

  it('disabling turns a person\'s access off and enabling turns it on, each with an audit line; the row is never deleted', async () => {
    const { fake, ds } = await site();
    await setStatus(ds, SUPER, 'raedla@deloitte.com', 'Disabled', { now: NOW });
    assert.equal(fake.item('users', 'raedla@deloitte.com').Status, 'Disabled');
    await setStatus(ds, SUPER, 'raedla@deloitte.com', 'Active', { now: NOW });
    assert.equal(fake.item('users', 'raedla@deloitte.com').Status, 'Active');
    assert.deepEqual(audit(fake).map((line) => line.slice(0, 2)), [['disable', 'raedla@deloitte.com'], ['enable', 'raedla@deloitte.com']]);
    assert.equal(fake.writes().filter((entry) => entry.method === 'DELETE').length, 0);
  });

  it('cannot disable the last Super admin, cannot disable yourself, and an Admin with the extra cannot disable an Admin or a Super admin', async () => {
    const { fake, ds } = await site(accessFor('pmedichalam@deloitte.com', [rowOf('pmedichalam@deloitte.com', 'Super admin')]));
    // (vsatyadev is the only Super admin among the rows: the other Super admin in this test is a second row only in the access, which counts for nothing in the lists)
    await assert.rejects(setStatus(ds, accessFor('pmedichalam@deloitte.com', [rowOf('pmedichalam@deloitte.com', 'Super admin')]), 'vsatyadev@deloitte.com', 'Disabled', { now: NOW }),
      /At least one Super admin must remain/);
    assert.equal(fake.item('users', 'vsatyadev@deloitte.com').Status, 'Active');
    const own = await site(SUPER);
    await assert.rejects(setStatus(own.ds, SUPER, 'vsatyadev@deloitte.com', 'Disabled', { now: NOW }), /your own/);
    const plus = await site(ADMIN_PLUS);
    await assert.rejects(setStatus(plus.ds, ADMIN_PLUS, 'vsatyadev@deloitte.com', 'Disabled', { now: NOW }), /Only a Super admin/);
    await setStatus(plus.ds, ADMIN_PLUS, 'raedla@deloitte.com', 'Disabled', { now: NOW });
    assert.equal(plus.fake.item('users', 'raedla@deloitte.com').Status, 'Disabled', 'an Admin with the extra turns off a Producer');
    assert.equal(plus.fake.lists.get('auditlog').length, 1, 'a refusal writes no audit line');
  });

  it('removing a role deletes the row and writes one audit line; again is a plain "already gone" and not an error', async () => {
    const { fake, ds } = await site();
    const target = { ...ROWS[2] };
    const done = await removeRole(ds, SUPER, target, ROWS, { now: NOW });
    assert.equal(done.removed, true);
    assert.equal(fake.item('roleassignments', target.id), undefined);
    assert.deepEqual(audit(fake), [['revoke', 'raedla@deloitte.com', 'Producer, client kroger']]);
    const again = await removeRole(ds, SUPER, target, ROWS, { now: NOW });
    assert.deepEqual([again.removed, again.already], [false, true]);
    assert.equal(fake.lists.get('auditlog').length, 1);
  });

  it('the guards: your own roles, the last Super admin, and an Admin never touches a Super admin or Admin row', async () => {
    const { fake, ds } = await site(ADMIN);
    await assert.rejects(removeRole(ds, ADMIN, ROWS[0], ROWS, { now: NOW }), /Only a Super admin/);
    await assert.rejects(removeRole(ds, ADMIN, ROWS[1], ROWS, { now: NOW }), /your own/);
    assert.equal(fake.writes().length, 0, 'nothing was sent');
    await removeRole(ds, ADMIN, ROWS[2], ROWS, { now: NOW });
    assert.equal(fake.item('roleassignments', ROWS[2].id), undefined, 'an Admin removes a client\'s team role');
    const sole = await site(accessFor('pmedichalam@deloitte.com', [rowOf('pmedichalam@deloitte.com', 'Super admin')]));
    await assert.rejects(removeRole(sole.ds, accessFor('pmedichalam@deloitte.com', [rowOf('pmedichalam@deloitte.com', 'Super admin')]), ROWS[0], ROWS, { now: NOW }), /At least one Super admin must remain/);
  });

  it('the guards live in the data layer too: the data call refuses what the screen would have, and sends no write', async () => {
    const { fake, ds } = await site(ADMIN);
    await assert.rejects(ds.removeAccessRecord('roleassignments', ROWS[0].id), AccessDenied);
    await assert.rejects(ds.removeAccessRecord('roleassignments', ROWS[1].id), /your own/);
    await assert.rejects(ds.updateAccessRecord('users', 'vsatyadev@deloitte.com', { status: 'Disabled' }), /Only a Super admin/);
    await assert.rejects(ds.updateAccessRecord('auditlog', 'x', { detail: 'changed' }), /Not an access list|AccessDenied|does not allow/);
    assert.equal(fake.writes().length, 0);
    assert.ok(fake.item('roleassignments', ROWS[0].id), 'the Super admin row is still there');
  });

  it('the extras: "may also add people" on an Admin row is a Super admin\'s to switch; another is refused; an audit line says so', async () => {
    const { fake, ds } = await site();
    const admin = { ...ROWS[1], extras: 'users.manage' };
    await setExtras(ds, SUPER, admin, '', ROWS, { now: NOW });
    assert.equal(fake.item('roleassignments', admin.id).Extras, '');
    await setExtras(ds, SUPER, admin, 'users.manage', ROWS, { now: NOW });
    assert.equal(fake.item('roleassignments', admin.id).Extras, 'users.manage');
    assert.deepEqual(audit(fake).map((line) => line[0]), ['grant', 'grant']);
    await assert.rejects(setExtras(ds, SUPER, ROWS[2], 'users.manage', ROWS, { now: NOW }), /not for a Producer/);
    const plus = await site(ADMIN_PLUS);
    await assert.rejects(setExtras(plus.ds, ADMIN_PLUS, ROWS[1], '', ROWS, { now: NOW }), /your own|Only a Super admin/);
  });

  it('what a removal takes away is said in plain words, with the person and the place', () => {
    const at = { clients: CLIENTS, sessions: SESSIONS };
    assert.equal(loseWords(ROWS[2], 'Aedla, Rajeshwar', at), 'Aedla, Rajeshwar will no longer be a Producer for Kroger: they will not be able to run its sessions, edit its activities or see its results.');
    assert.match(loseWords(ROWS[5], 'Milder, Brian', at), /Leadership for all clients, 1 Dec 2026 to 28 Feb 2027.*see results/);
    assert.match(loseWords(ROWS[0], 'Satyadev, Vedala Venkata', at), /Super admin/);
    assert.match(loseWords(ROWS[4], 'Hussain, Mohammad Afrid', at), /Designer for Acme.*brand/);
  });

  it('a person\'s history is their audit lines, newest first, in plain sentences; other people\'s lines and nothing about answers', () => {
    const lines = [
      { id: 'a1', actor: 'vsatyadev@deloitte.com', action: 'add-user', targetUser: 'raedla@deloitte.com', role: '', detail: 'Added from the directory', occurredAt: '2026-10-20T09:00:00.000Z' },
      { id: 'a2', actor: 'pulmathur@deloitte.com', action: 'grant', targetUser: 'raedla@deloitte.com', role: 'Producer', clientId: 'kroger', detail: 'Producer, client kroger', occurredAt: '2026-10-21T09:00:00.000Z' },
      { id: 'a3', actor: 'pulmathur@deloitte.com', action: 'grant', targetUser: 'other@deloitte.com', role: 'Producer', detail: 'x', occurredAt: '2026-10-22T09:00:00.000Z' },
      { id: 'a4', actor: 'vsatyadev@deloitte.com', action: 'disable', targetUser: 'raedla@deloitte.com', role: '', detail: '', occurredAt: '2026-10-23T09:00:00.000Z' },
    ];
    const history = historyOf(lines, 'RAedla@deloitte.com', { names: { 'vsatyadev@deloitte.com': 'Satyadev, Vedala Venkata' } });
    assert.deepEqual(history.map((entry) => entry.id), ['a4', 'a2', 'a1']);
    assert.equal(history[0].words, 'Turned off by Satyadev, Vedala Venkata');
    assert.equal(history[1].words, 'Given Producer, client kroger by pulmathur@deloitte.com');
    assert.equal(history[2].words, 'Added from the directory by Satyadev, Vedala Venkata');
    assert.equal(history[0].day, '23 Oct 2026');
  });

  it('disableProblem is the rule the screen and the data layer share', () => {
    const rows = [rowOf('vsatyadev@deloitte.com', 'Super admin'), rowOf('pmedichalam@deloitte.com', 'Super admin')];
    const users = [ACTIVE('vsatyadev@deloitte.com'), ACTIVE('pmedichalam@deloitte.com')];
    const other = accessFor('srkolachana@deloitte.com', [rowOf('srkolachana@deloitte.com', 'Super admin')]);
    assert.equal(disableProblem(other, 'vsatyadev@deloitte.com', rows, users, { now: NOW }), null, 'one of two Super admins may be turned off');
    assert.equal(disableProblem(other, 'vsatyadev@deloitte.com', rows.slice(0, 1), users.slice(0, 1), { now: NOW }), 'At least one Super admin must remain.');
    assert.match(disableProblem(accessFor('vsatyadev@deloitte.com', rows.slice(0, 1)), 'vsatyadev@deloitte.com', rows, users, { now: NOW }), /your own/);
  });
});
