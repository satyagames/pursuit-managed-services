// Prompt 32, step 2: who is signed in and with what role, in the words of the bar's chip, its popover and the welcome strip.
// Run: node --test scripts/test-identity-words.js
//
// lib/access/identity-words.js reads only the access the page already holds (lib/access/resolve.js) and the role matrix: nothing is read for it.
// The role line is the highest role first (the matrix's order), "+N" for the others, then where it reaches; an end date within 14 days is a word.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENDS_SOON_DAYS, identityOf, initialsOf } from '../migration/src/lib/access/identity-words.js';
import { ROLES } from '../migration/src/lib/access/access-matrix.js';

const NOW = new Date('2026-11-04T10:00:00Z');
const TABS = [
  { id: 'today', title: 'Today' }, { id: 'clients', title: 'Clients' }, { id: 'content', title: 'Content' },
  { id: 'guests', title: 'Guests and QR' }, { id: 'results', title: 'Results' }, { id: 'users', title: 'People' },
];
const KEY = 'raedla@deloitte.com';
const person = { key: KEY, email: KEY, name: 'Aedla, Ravi', loginName: '', id: 7 };
let next = 0;
const row = (role, extra = {}) => ({ id: `a${next += 1}`, userKey: KEY, role, scopeType: 'global', clientId: '', sessionId: '', periodFrom: '', periodTo: '', validUntil: '', extras: '', ...extra });
const client = (role, clientId, extra = {}) => row(role, { scopeType: 'client', clientId, ...extra });
const accessOf = (assignments, extra = {}) => ({ person, owner: false, legacy: false, user: { key: KEY, status: 'Active' }, assignments, ...extra });
const id = (assignments, extra) => identityOf(accessOf(assignments, extra), { now: NOW, tabs: TABS });

describe('each role alone: the role, where it reaches, what it may do and what it may not', () => {
  it('Super admin: all clients, nothing hidden', () => {
    const me = id([row('Super admin')]);
    assert.equal(me.roleLine, 'Super admin · All clients');
    assert.equal(me.notAvailable, undefined, 'Prompt 39: the popover no longer says what is not available');
    // (Prompt 39: the chip shows the role alone below 1,280 px, the role and its reach from there; roleLine is the two joined.)
    assert.equal(me.role, 'Super admin');
    assert.equal(me.reach, 'All clients');
    assert.deepEqual(me.canDo, ['Start or end a session', 'Create or edit clients and sessions', 'Edit activities and questions', 'See results']);
  });

  it('Admin: all clients; Today, Content, Guests and Results are not theirs', () => {
    const me = id([row('Admin')]);
    assert.equal(me.roleLine, 'Admin · All clients');
    assert.deepEqual(me.canDo, ['Create or edit clients and sessions', 'See the list of people', 'Pick the team of a client or session']);
  });

  it('Producer on three clients: People and Reporting settings are named with who does them', () => {
    const me = id([client('Producer', 'kroger'), client('Producer', 'dominos'), client('Producer', 'acme')]);
    assert.equal(me.roleLine, 'Producer · 3 clients');
    assert.deepEqual(me.canDo, ['Start or end a session', 'Edit activities and questions', 'See results', 'Add or remove guests']);
  });

  it('Designer on one client: the brand; with the extra, the activities too', () => {
    assert.equal(id([client('Designer', 'kroger')]).roleLine, 'Designer · 1 client');
    assert.deepEqual(id([client('Designer', 'kroger')]).canDo, ['Edit the brand']);
    assert.deepEqual(id([client('Designer', 'kroger', { extras: 'content.edit' })]).canDo, ['Edit activities and questions', 'Edit the brand']);
  });

  it('Leadership: "Results" in the role line, whatever it covers', () => {
    const me = id([row('Leadership', { scopeType: 'period', periodFrom: '2026-09-01', periodTo: '2027-08-31' })]);
    assert.equal(me.roleLine, 'Leadership · Results');
    assert.deepEqual(me.canDo, ['See results', 'Export results', 'See guests\' names']);
    assert.equal(me.roles[0].covers, 'All clients, 1 Sep 2026 to 31 Aug 2027');
  });

  it('a client\'s name is used when the page has it, the count when it has not', () => {
    const access = accessOf([client('Producer', 'kroger')]);
    assert.equal(identityOf(access, { now: NOW, tabs: TABS }).roleLine, 'Producer · 1 client');
    assert.equal(identityOf(access, { now: NOW, tabs: TABS, clients: [{ id: 'kroger', name: 'Kroger' }] }).roleLine, 'Producer · Kroger');
  });

  it('a session\'s role counts its client; a role on all clients wins over any count', () => {
    assert.equal(id([row('Producer', { scopeType: 'session', sessionId: 's1', clientId: 'kroger' })]).roleLine, 'Producer · 1 client');
    assert.equal(id([row('Producer', { scopeType: 'session', sessionId: 's1', clientId: 'kroger' })]).roles[0].covers, '1 session');
    assert.equal(id([client('Producer', 'kroger'), row('Producer')]).roleLine, 'Producer · All clients');
  });
});

describe('several roles', () => {
  it('the highest first, in the matrix\'s order, then "+N" for the other roles (not rows); the reach is the highest role\'s', () => {
    const me = id([client('Designer', 'kroger'), client('Producer', 'kroger'), client('Producer', 'dominos')]);
    assert.equal(me.roleLine, 'Producer +1 · 2 clients');
    assert.deepEqual(me.roles.map((entry) => entry.role), ['Producer', 'Producer', 'Designer']);
    assert.equal(id([row('Leadership', { scopeType: 'client', clientId: 'kroger' }), row('Admin')]).roleLine, 'Admin +1 · All clients');
  });

  it('the rank is the role matrix\'s own list', () => {
    assert.deepEqual(ROLES, ['Super admin', 'Admin', 'Producer', 'Designer', 'Leadership']);
    const all = id([...ROLES].reverse().map((role) => (role === 'Leadership' ? client(role, 'kroger') : row(role))));
    assert.deepEqual(all.roles.map((entry) => entry.role), ROLES);
    assert.equal(all.roleLine, 'Super admin +4 · All clients');
  });

  it('the role line stays under 40 characters: a long client name becomes the count', () => {
    const long = id([client('Producer', 'x')]);
    assert.ok(long.roleLine.length < 40);
    const named = identityOf(accessOf([client('Designer', 'x')]), { now: NOW, tabs: TABS, clients: [{ id: 'x', name: 'The Very Long Client Name Of Some Kind' }] });
    assert.equal(named.roleLine, 'Designer · 1 client');
    assert.ok(named.roleLine.length < 40);
  });
});

describe('an end date: "Ends" when it is 14 days away or less', () => {
  const ending = (validUntil) => id([client('Producer', 'kroger', { validUntil })]);

  it('the window is 14 days', () => assert.equal(ENDS_SOON_DAYS, 14));

  it('9 days away: the chip says when, the table says how long', () => {
    const me = ending('2026-11-13');
    assert.deepEqual(me.endsSoon, { day: '13 Nov', days: 9 });
    assert.deepEqual(me.roles[0], { role: 'Producer', covers: '1 client', until: '13 Nov 2026', endsSoon: '9 days' });
    assert.match(me.ariaLabel, /ends 13 Nov/);
  });

  it('exactly 14 days ends soon; 15 does not; the last day itself is "today"', () => {
    assert.deepEqual(ending('2026-11-18').endsSoon, { day: '18 Nov', days: 14 });
    assert.equal(ending('2026-11-19').endsSoon, null);
    assert.equal(ending('2026-11-19').roles[0].endsSoon, '');
    assert.equal(ending('2026-11-04').roles[0].endsSoon, 'today');
    assert.equal(ending('2026-11-05').roles[0].endsSoon, '1 day');
  });

  it('a role already ended is not shown at all (it no longer counts)', () => {
    const me = id([client('Producer', 'kroger', { validUntil: '2026-11-01' }), row('Designer')]);
    assert.equal(me.roleLine, 'Designer · All clients');
    assert.equal(me.endsSoon, null);
  });

  it('no end date: "No end date"', () => assert.equal(id([row('Admin')]).roles[0].until, 'No end date'));

  it('of several, the soonest', () => {
    assert.deepEqual(id([client('Producer', 'a', { validUntil: '2026-11-15' }), client('Designer', 'b', { validUntil: '2026-11-10' })]).endsSoon, { day: '10 Nov', days: 6 });
  });
});

describe('the site owner, a PIN and nobody', () => {
  it('a site owner with no role of their own: "Site owner", and every tab', () => {
    const me = id([], { owner: true });
    assert.equal(me.roleLine, 'Site owner');
    assert.equal(me.role, 'Site owner');
    assert.equal(me.reach, '');
    assert.deepEqual(me.roles, []);
    assert.equal(me.notAvailable, undefined, 'Prompt 39: the popover no longer says what is not available');
    assert.ok(me.chip);
  });

  it('a site owner who is also a Super admin: the role, once', () => {
    const me = id([row('Super admin')], { owner: true });
    assert.equal(me.roleLine, 'Super admin · All clients');
    assert.equal(me.roles.length, 1);
  });

  it('a PIN sign-in: the name only, no chip (the code names no role for a PIN)', () => {
    const me = identityOf({ person: null, owner: false, legacy: true, user: null, assignments: [] }, { now: NOW, tabs: TABS, name: 'Demo Admin' });
    assert.equal(me.chip, false);
    assert.equal(me.name, 'Demo Admin');
    assert.equal(me.roleLine, '');
  });

  it('nobody signed in: no chip', () => assert.equal(identityOf(null, { now: NOW, tabs: TABS }).chip, false));
});

describe('the name and its initials', () => {
  it('"Last, First" is said "First Last"', () => {
    assert.equal(id([row('Admin')]).name, 'Ravi Aedla');
    assert.equal(initialsOf('Aedla, Ravi'), 'RA');
  });
  it('"First Last" and a middle name', () => {
    assert.equal(initialsOf('Ravi Aedla'), 'RA');
    assert.equal(initialsOf('Ravi K Aedla'), 'RA');
  });
  it('one word, then the email, then a mark', () => {
    assert.equal(initialsOf('Ravi'), 'R');
    assert.equal(initialsOf('', 'raedla@deloitte.com'), 'R');
    assert.equal(initialsOf('', ''), '?');
  });
  it('no name: the email is the name', () => {
    const me = identityOf(accessOf([row('Admin')], { person: { ...person, name: '' } }), { now: NOW, tabs: TABS });
    assert.equal(me.name, KEY);
    assert.equal(me.initials, 'R');
  });
  it('the chip\'s label is one line: name, role, reach, what it opens', () => {
    assert.equal(id([client('Producer', 'kroger'), client('Producer', 'dominos'), client('Producer', 'acme')]).ariaLabel,
      'Signed in as Ravi Aedla, Producer, 3 clients. Opens your access.');
    assert.equal(id([row('Super admin'), client('Designer', 'k')]).ariaLabel, 'Signed in as Ravi Aedla, Super admin and 1 more role, All clients. Opens your access.');
  });
});

describe('rolesKey: changes when, and only when, a role, client or date changes', () => {
  const base = [client('Producer', 'kroger', { validUntil: '2026-12-12' }), row('Designer')];
  const keyOf = (assignments) => id(assignments).rolesKey;
  const key = keyOf(base);

  it('short and stable', () => {
    assert.match(key, /^[0-9a-z]{4,10}$/);
    assert.equal(keyOf(base.map((entry) => ({ ...entry }))), key);
    assert.equal(keyOf([...base].reverse()), key, 'the order rows are read in does not matter');
  });
  it('another role, client or date changes it', () => {
    assert.notEqual(keyOf([{ ...base[0], role: 'Designer' }, base[1]]), key);
    assert.notEqual(keyOf([{ ...base[0], clientId: 'dominos' }, base[1]]), key);
    assert.notEqual(keyOf([{ ...base[0], validUntil: '2026-12-13' }, base[1]]), key);
    assert.notEqual(keyOf([base[0]]), key);
  });
  it('a row\'s id, who gave it, or its extras do not', () => {
    assert.equal(keyOf([{ ...base[0], id: 'other', grantedBy: 'x@deloitte.com', extras: 'content.edit' }, base[1]]), key);
  });
});

describe('the welcome strip\'s sentence and where "seen" is kept', () => {
  it('"Welcome, <first name>. You are signed in as <role> for <reach>."', () => {
    assert.equal(id([client('Producer', 'a'), client('Producer', 'b'), client('Producer', 'c')]).welcome, 'Welcome, Ravi. You are signed in as Producer for 3 clients.');
    assert.equal(id([row('Super admin'), client('Designer', 'k')]).welcome, 'Welcome, Ravi. You are signed in as Super admin and 1 more role for all clients.');
    assert.equal(id([row('Leadership', { scopeType: 'client', clientId: 'k' })]).welcome, 'Welcome, Ravi. You are signed in as Leadership for results.');
    assert.equal(identityOf(accessOf([client('Producer', 'k')]), { now: NOW, tabs: TABS, clients: [{ id: 'k', name: 'Kroger' }] }).welcome, 'Welcome, Ravi. You are signed in as Producer for Kroger.');
    assert.equal(id([], { owner: true }).welcome, 'Welcome, Ravi. You are signed in as the site owner.');
  });

  it('the storage key names the person by a hash, never by their email or name', () => {
    const me = id([row('Admin')]);
    assert.match(me.seenKey, /^pms\.welcome\.[0-9a-z]+$/);
    assert.doesNotMatch(me.seenKey, /raedla|ravi|aedla|@/i);
    assert.notEqual(identityOf(accessOf([row('Admin')], { person: { ...person, key: 'other@deloitte.com' } }), { now: NOW, tabs: TABS }).seenKey, me.seenKey);
  });
});
