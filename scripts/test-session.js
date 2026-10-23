// Prompt 19: a refused request (401, 403, a sign-in page) is classified in one table (lib/data/session.js) and recovered from in one place, the
// data layer's ladder (lib/data/core.js): Step A (a short pause, a fresh write token that proves the sign-in, the request once more), Step B (the
// page's renewer, a hidden frame that navigates on the site, then a light proof and the request once more), Step C (a typed error the admin's banner
// and the participant's sign-in screen say in words). Run: node --test scripts/test-session.js (part of `npm test`).
//
// Everything here is the fake's (scripts/sharepoint-fake.js): what the real site answers an idle tab, and whether a frame renews its sign-in, is
// ASSUMED until QA-TESTING.md's checks on the PCOE site.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ACCESS_DENIED, SESSION_REFUSED_CODE, TITLE, createSharePointFake } from './sharepoint-fake.js';
import { REFUSALS, SESSION_LIMITS, classifyRefusal, evidenceLine } from '../migration/src/lib/data/session.js';
import { errorText, permissionText, sessionBanner } from '../migration/src/lib/admin/session-notice.js';
import { isSignedOut } from '../migration/src/lib/participant/sign-in.js';
import { failureText } from '../migration/src/lib/admin/today-view.js';

let pages = 0;
/** A fresh page (its own data layer) on `fake`, with test-length waits. */
async function pageOn(fake, { renewer = null, cooldownMs = 200 } = {}) {
  const ds = await import(`../migration/src/lib/data/dataService.js?session=${pages += 1}`);
  ds.configure({ sharePoint: fake.settings });
  ds.setSessionRenewer(renewer, { pauseMs: [0, 5], cooldownMs, renewTimeoutMs: 500 });
  return ds;
}
const sent = (fake, test) => fake.requests.filter(test).length;
const isContextInfo = (entry) => entry.path.endsWith('/contextinfo');
const isProof = (entry) => entry.path.endsWith('/_api/web') && entry.method === 'GET';
const clientReads = (entry) => entry.list === 'clients' && entry.method === 'GET' && !entry.batched;
const DENIED_ONCE = { status: 403, message: ACCESS_DENIED };
/** One refusal each row of REFUSALS matches, in the same order: the row's own case. */
const REFUSAL_FIXTURES = [
  { status: 403, code: '-2130575252, Microsoft.SharePoint.SPException', message: 'The security validation for this page is invalid and might be corrupted.' },
  { status: 403, message: 'The security validation for this page is invalid.' },
  { status: 429, message: 'The request has been throttled.' },
  { status: 503, message: 'The server is busy.' },
  { status: 504, message: 'Gateway timeout.' },
  { status: 401, message: 'Unauthorized' },
  { status: 200, sawSignInPage: true },
  { status: 403, code: SESSION_REFUSED_CODE, message: 'Attempted to perform an unauthorized operation.' },
  { status: 403, message: ACCESS_DENIED },
];

describe('every refusal is classified by one table', () => {
  it('every row of the table classifies its own fixture, and every row has one (where each was seen is a comment beside it, in session.js)', async () => {
    assert.ok(REFUSALS.length >= 7, 'the table is there');
    assert.ok(Object.isFrozen(REFUSALS) && REFUSALS.every((row) => Object.isFrozen(row)), 'frozen');
    assert.equal(REFUSAL_FIXTURES.length, REFUSALS.length);
    REFUSAL_FIXTURES.forEach((fixture, index) => assert.equal(classifyRefusal(fixture), REFUSALS[index].kind, `row ${index}: ${JSON.stringify(REFUSALS[index])}`));
    const source = await readFile(new URL('../migration/src/lib/data/session.js', import.meta.url), 'utf8');
    const table = source.slice(source.indexOf('export const REFUSALS'), source.indexOf(']);', source.indexOf('export const REFUSALS')));
    assert.equal((table.match(/^\s*\/\/ /gm) ?? []).length, 7, 'a comment for each row, or each group of rows');
  });

  it('the stale write token and a busy site never become a session refusal, whatever the words say', () => {
    for (const fixture of REFUSAL_FIXTURES.filter((_, index) => ['digest', 'busy'].includes(REFUSALS[index].kind))) {
      const kind = classifyRefusal(fixture);
      assert.equal(classifyRefusal({ ...fixture, message: `${fixture.message ?? ''} ${ACCESS_DENIED}` }), kind, JSON.stringify(fixture));
      assert.equal(classifyRefusal({ ...fixture, message: `${fixture.message ?? ''} ${ACCESS_DENIED}`, proven: true }), kind);
    }
    assert.equal(classifyRefusal({ status: 403, code: '-2130575252, Microsoft.SharePoint.SPException', message: ACCESS_DENIED }), 'digest', 'the code decides');
    assert.equal(classifyRefusal({ status: 429, message: ACCESS_DENIED }), 'busy');
    assert.equal(classifyRefusal({ status: 503, sawSignInPage: true }), 'busy');
  });

  it('the identity: 401, a sign-in page, SharePoint\'s UnauthorizedAccessException or its "Access denied" words; after a working sign-in a 403 is a permission', () => {
    assert.equal(classifyRefusal({ status: 401 }), 'session');
    assert.equal(classifyRefusal({ status: 200, sawSignInPage: true }), 'session');
    assert.equal(classifyRefusal({ status: 403, code: SESSION_REFUSED_CODE, message: 'x' }), 'session');
    assert.equal(classifyRefusal({ status: 403, message: ACCESS_DENIED }), 'session');
    assert.equal(classifyRefusal({ status: 403, message: 'You do not have permission to perform this action.' }), 'session');
    assert.equal(classifyRefusal({ status: 403, message: ACCESS_DENIED, proven: true }), 'permission');
    assert.equal(classifyRefusal({ status: 401, proven: true }), 'session', 'a 401 is never a permission');
    assert.equal(classifyRefusal({ status: 403, message: 'Synthetic denied write' }), 'other', 'other words are as they were');
    assert.equal(classifyRefusal({ status: 404, message: ACCESS_DENIED }), 'other');
    assert.equal(classifyRefusal({ status: 500 }), 'other');
  });
});

describe('the ladder, on the fake', () => {
  let restore;
  let fake;
  beforeEach(() => { fake = createSharePointFake(); restore = fake.install(); });
  afterEach(() => restore());

  it('a stale write token is as it was: the token is asked for again and the write sent once more, and nothing is renewed', async () => {
    let renewed = 0;
    const ds = await pageOn(fake, { renewer: async () => { renewed += 1; return true; } });
    await ds.listClients();
    fake.reset();
    fake.failNext({ status: 403, message: 'The security validation for this page is invalid and might be corrupted.', when: (entry) => entry.method === 'POST' && entry.path.endsWith('/web/lists') });
    await ds.sendToSharePoint('POST', '/web/lists', { __metadata: { type: 'SP.List' }, BaseTemplate: 100, Title: fake.titleOf('sections') }).catch(() => {});
    assert.deepEqual(fake.requests.map((entry) => `${entry.method} ${entry.path.replace(/^.*\/_api/, '')}`), ['POST /contextinfo', 'POST /web/lists', 'POST /contextinfo', 'POST /web/lists']);
    assert.equal(renewed, 0);
    assert.deepEqual(ds.sessionEvidence(), [], 'a stale token is not a refused sign-in');
  });

  it('Step A: a refusal that a fresh token mends is read again once, with no renewal and no error', async () => {
    let renewed = 0;
    const ds = await pageOn(fake, { renewer: async () => { renewed += 1; return true; } });
    const events = [];
    ds.onSessionChange((event) => events.push(event.state));
    fake.failNext({ ...DENIED_ONCE, when: clientReads });
    assert.ok(Array.isArray(await ds.listClients()));
    assert.equal(sent(fake, clientReads), 2, 'the read, and once more');
    assert.equal(sent(fake, isContextInfo), 1, 'one fresh token, which proves the sign-in');
    assert.equal(renewed, 0);
    assert.deepEqual(events, [], 'nothing to tell the person');
    const [entry] = ds.sessionEvidence();
    assert.equal(entry.status, 403);
    assert.equal(entry.list, 'clients');
    assert.equal(entry.method, 'GET');
    assert.match(entry.requestGuid, /^fa\d{6}-/);
  });

  it('Step B: a sign-in SharePoint no longer accepts is renewed by the renewer, proven with one light read, and the read carries on', async () => {
    let renewed = 0;
    const ds = await pageOn(fake, { renewer: async () => { renewed += 1; fake.renewSession(); return true; } });
    fake.expireSession();
    assert.ok(Array.isArray(await ds.listClients()));
    assert.equal(renewed, 1);
    assert.deepEqual(fake.requests.map((entry) => `${entry.method} ${entry.path.replace(/^.*\/_api/, '').replace(/\/web\/lists\/getbytitle\('[^']*'\)/, '<list>')} ${entry.faulted ?? 200}`),
      ['GET <list>/items 403', 'POST /contextinfo 403', 'GET /web 200', 'GET <list>/items 200']);
    assert.equal(sent(fake, isProof), 1);
  });

  it('Step C: a sign-in that cannot be renewed is a typed error with plain words; the raw status and words are in its Details only', async () => {
    const ds = await pageOn(fake, { renewer: async () => false });
    const events = [];
    ds.onSessionChange((event) => events.push(event));
    fake.expireSession();
    const error = await ds.listClients().then(() => null, (cause) => cause);
    assert.equal(error.code, 'session-lost');
    assert.equal(error.status, 401);
    assert.doesNotMatch(error.message, /403|access denied|permission|digest|token|FedAuth/i);
    assert.equal(error.sharePointStatus, 403);
    assert.match(error.details, /403/);
    assert.match(error.details, /-2147024891/);
    assert.match(error.details, /SPRequestGuid fa\d{6}-/);
    assert.equal(events.length, 1);
    assert.equal(events[0].state, 'lost');
    assert.equal(isSignedOut(error), true, 'the participant page says its own "Your sign-in has expired"');
    const banner = sessionBanner(error, { unsaved: false });
    assert.equal(banner.text, 'Your SharePoint sign-in needs refreshing. Reload this page to carry on.');
    assert.match(banner.details, /SPRequestGuid fa\d{6}-/);
    assert.match(banner.details, /since the last answer/);
    assert.equal(sessionBanner(error, { unsaved: true }).warning, 'Your unsaved changes here will be lost if you reload.');
    assert.equal(errorText(error, 'Could not load clients.'), 'Could not load clients.', 'a screen says its own line; the banner says what to do');
    assert.equal(failureText(error, 'Could not go live.'), 'Could not go live.', 'Today\'s shared line too');
  });

  it('a later answer clears it: the page is told the sign-in is back', async () => {
    const ds = await pageOn(fake, { renewer: async () => false, cooldownMs: 0 });
    const events = [];
    ds.onSessionChange((event) => events.push(event.state));
    fake.expireSession();
    await assert.rejects(ds.listClients(), { code: 'session-lost' });
    fake.renewSession();
    await ds.listClients();
    assert.deepEqual(events, ['lost', 'back']);
  });

  it('a list the account may not read is a permission, said with the list\'s title, and is not tried again and again', async () => {
    let renewed = 0;
    const ds = await pageOn(fake, { renewer: async () => { renewed += 1; return true; } });
    fake.failNext({ ...DENIED_ONCE, times: 99, when: clientReads });
    const error = await ds.listClients().then(() => null, (cause) => cause);
    assert.equal(error.status, 403, 'still a 403 to every caller');
    assert.equal(error.message, `SharePoint (403): ${ACCESS_DENIED}`, 'with the words it always had');
    assert.equal(error.kind, 'permission');
    assert.equal(error.list, 'clients');
    assert.equal(sent(fake, clientReads), 2, 'read, and once more after the sign-in was proven');
    assert.equal(renewed, 0, 'a sign-in that works is not renewed');
    assert.equal(isSignedOut(error), false);
    assert.equal(permissionText(error), `Your account cannot read ${fake.titleOf('clients')}. Ask the site owner for Contribute access to the PMS lists.`);
    assert.match(errorText(error, 'Could not load clients.'), new RegExp(`^Your account cannot read ${fake.titleOf('clients')}\\. .*Details: 403`));
    fake.reset();
    await assert.rejects(ds.listClients(), { kind: 'permission' });
    assert.deepEqual(fake.requests.map((entry) => entry.method), ['GET'], 'the second time: the read alone, no proof, no retry');
  });

  it('single flight: ten reads refused at once cause one renewal and one proof', async () => {
    let renewed = 0;
    const ds = await pageOn(fake, { renewer: async () => { renewed += 1; fake.renewSession(); return true; } });
    fake.expireSession();
    const read = await Promise.all(Array.from({ length: 10 }, () => ds.listClients()));
    assert.equal(read.length, 10);
    assert.equal(renewed, 1);
    assert.equal(sent(fake, isProof), 1);
    assert.equal(sent(fake, isContextInfo), 1);
    assert.equal(sent(fake, clientReads), 20, 'each read, and each once more');
  });

  it('cooldown: after a failed recovery the next refusal does not renew again until the cooldown is over', async () => {
    let renewed = 0;
    const ds = await pageOn(fake, { renewer: async () => { renewed += 1; return false; }, cooldownMs: 300 });
    fake.expireSession();
    await assert.rejects(ds.listClients(), { code: 'session-lost' });
    fake.reset();
    await assert.rejects(ds.listClients(), { code: 'session-lost' });
    assert.equal(renewed, 1, 'not renewed again inside the cooldown');
    assert.deepEqual(fake.requests.map((entry) => entry.method), ['GET'], 'the read alone');
    await new Promise((resolve) => { setTimeout(resolve, 320); });
    await assert.rejects(ds.listClients(), { code: 'session-lost' });
    assert.equal(renewed, 2, 'and tried once more after it');
  });

  it(`the cooldown is a named constant of a few seconds (${SESSION_LIMITS.cooldownMs} ms), and so are the other waits`, () => {
    assert.ok(SESSION_LIMITS.cooldownMs >= 2_000 && SESSION_LIMITS.cooldownMs <= 10_000);
    assert.ok(SESSION_LIMITS.renewTimeoutMs >= 3_000 && SESSION_LIMITS.renewTimeoutMs <= 20_000);
    assert.ok(SESSION_LIMITS.idleMs >= 60_000);
    assert.equal(SESSION_LIMITS.evidenceKept, 20);
    assert.ok(Object.isFrozen(SESSION_LIMITS));
  });

  it('a write is sent at most twice: again only after a renewal proved the sign-in, never after a 403 the sign-in did not cause', async () => {
    const ds = await pageOn(fake, { renewer: async () => { fake.renewSession(); return true; } });
    const create = (key) => ds.sendToSharePoint('POST', '/web/lists', { __metadata: { type: 'SP.List' }, BaseTemplate: 100, Title: `${fake.titleOf(key)}x` }).catch((cause) => cause);
    const listWrites = (entry) => entry.method === 'POST' && entry.path.endsWith('/web/lists');
    await ds.readLists([{ list: 'clients' }, { list: 'sessions' }]); // (a write token in hand: the refusal meets the write, not the token)
    fake.reset();
    fake.expireSession();
    await create('sections');
    assert.equal(sent(fake, listWrites), 2, 'refused whole, renewed, sent once more');
    fake.reset();
    fake.forbid((entry) => entry.path.endsWith('/web/lists'));
    const refused = await create('questions');
    assert.equal(refused.status, 403);
    assert.equal(refused.kind, 'permission');
    assert.equal(sent(fake, listWrites), 1, 'the sign-in works: a write the account may not make is not sent again');
    fake.clearFaults();
    fake.reset();
    // A refused write, renewed, refused again: two in all, and then it stops.
    fake.failNext({ ...DENIED_ONCE, times: 99, when: listWrites });
    fake.expireSession();
    await create('options');
    assert.equal(sent(fake, listWrites), 2);
    fake.clearFaults();
    fake.reset();
    // A stale token first (sent again, as always), then a refused sign-in: the write has had its second send.
    fake.failNext({ status: 403, message: 'The security validation for this page is invalid.', when: listWrites });
    fake.failNext({ ...DENIED_ONCE, when: listWrites });
    await create('tracks');
    assert.equal(sent(fake, listWrites), 2, 'never a third');
  });

  it('a part refused inside a $batch is never sent again as a batch: the hole is read on its own, as it always was', async () => {
    const ds = await pageOn(fake, { renewer: async () => true });
    await ds.listClients();
    fake.reset();
    fake.failNext({ ...DENIED_ONCE, when: (entry) => entry.batched && entry.list === 'sessions' });
    await ds.readLists([{ list: 'clients' }, { list: 'sessions' }]);
    assert.equal(sent(fake, (entry) => entry.path.endsWith('/$batch')), 1);
    assert.equal(sent(fake, (entry) => entry.list === 'sessions' && !entry.batched), 1, 'the hole, read with a plain GET');
  });

  it('a $batch refused whole by a sign-in that is renewed is sent once more; one that cannot be renewed is the typed error, not three plain reads', async () => {
    const ds = await pageOn(fake, { renewer: async () => { fake.renewSession(); return true; } });
    await ds.readLists([{ list: 'clients' }, { list: 'sessions' }]); // (a write token in hand, as a page that has read once has)
    fake.reset();
    fake.expireSession();
    await ds.readLists([{ list: 'clients' }, { list: 'sessions' }]);
    assert.equal(sent(fake, (entry) => entry.path.endsWith('/$batch')), 2);
    assert.equal(sent(fake, (entry) => !entry.batched && ['clients', 'sessions'].includes(entry.list)), 0, 'no plain reads');
    const lost = await pageOn(fake, { renewer: async () => false });
    await lost.readLists([{ list: 'clients' }, { list: 'sessions' }]);
    fake.reset();
    fake.expireSession();
    await assert.rejects(lost.readLists([{ list: 'clients' }, { list: 'sessions' }]), { code: 'session-lost' });
    assert.equal(sent(fake, (entry) => !entry.batched && ['clients', 'sessions'].includes(entry.list)), 0);
  });

  it('without a renewer (a test, or a page with no document), a refusal is thrown as it always was, with no request more: only the evidence is kept', async () => {
    const ds = await pageOn(fake, { renewer: null });
    fake.expireSession();
    await assert.rejects(ds.listClients(), (error) => error.status === 403 && error.message === `SharePoint (403): ${ACCESS_DENIED}` && error.kind === undefined);
    assert.deepEqual(fake.requests.map((entry) => entry.method), ['GET']);
    assert.equal(ds.sessionEvidence().length, 1);
  });

  it('429 and 503 are as they were: waited for and sent again, never renewed', async () => {
    let renewed = 0;
    const ds = await pageOn(fake, { renewer: async () => { renewed += 1; return true; } });
    fake.failNext({ status: 503, retryAfter: 0, when: clientReads });
    fake.failNext({ status: 429, retryAfter: 0, when: clientReads });
    await ds.listClients();
    assert.equal(sent(fake, clientReads), 3);
    assert.equal(sent(fake, isContextInfo), 0);
    assert.equal(renewed, 0);
    assert.deepEqual(ds.sessionEvidence(), []);
  });

  it('the evidence: the last 20 refusals, in memory, with no item id, name or answer; checkSession() is one light read', async () => {
    const ds = await pageOn(fake, { renewer: null, cooldownMs: 0 });
    fake.failNext({ ...DENIED_ONCE, times: 99, when: (entry) => entry.list === 'sessions' && entry.method === 'GET' });
    for (let index = 0; index < 23; index += 1) await ds.getSession(`s-${index}`).catch(() => {});
    const evidence = ds.sessionEvidence();
    assert.equal(evidence.length, 20);
    assert.deepEqual(Object.keys(evidence[0]).sort(), ['code', 'health', 'list', 'method', 'requestGuid', 'sinceAnswerMs', 'sinceLoadMs', 'status', 'visibility']);
    assert.doesNotMatch(JSON.stringify(evidence), /s-\d/, 'no item id');
    assert.equal(evidence[0].list, 'sessions');
    assert.match(evidenceLine(evidence[0]), /^403 · -2147024891|^403 · GET/);
    evidence.length = 0;
    assert.equal(ds.sessionEvidence().length, 20, 'a copy');
    fake.clearFaults();
    fake.reset();
    const before = ds.lastAnswerAt();
    assert.deepEqual(await ds.checkSession(), { requests: 1 });
    assert.deepEqual(fake.requests.map((entry) => `${entry.method} ${entry.path.replace(/^.*\/_api/, '')}${entry.query}`), ['GET /web?$select=Id']);
    assert.ok(ds.lastAnswerAt() >= before);
  });
});

describe('the local server is untouched', () => {
  it('a 401 or 403 from the local server is thrown as it was, with one request and nothing renewed', async () => {
    const ds = await import(`../migration/src/lib/data/dataService.js?session=${pages += 1}`);
    let renewed = 0;
    ds.configure({ baseUrl: 'http://127.0.0.1:9/api' });
    ds.setSessionRenewer(async () => { renewed += 1; return true; });
    const realFetch = globalThis.fetch;
    const asked = [];
    globalThis.fetch = async (url) => { asked.push(String(url)); return new Response(JSON.stringify({ error: 'Synthetic denied' }), { status: 403 }); };
    try {
      await assert.rejects(ds.listClients(), { status: 403, message: 'Synthetic denied' });
      assert.deepEqual(await ds.checkSession(), { requests: 0 }, 'no light read either');
    } finally { globalThis.fetch = realFetch; }
    assert.equal(asked.length, 1);
    assert.equal(renewed, 0);
    assert.deepEqual(ds.sessionEvidence(), []);
  });
});

describe('the words', () => {
  it('a permission names the list and what to ask for; a write says change', () => {
    assert.equal(permissionText({ listTitle: 'PMSClients', method: 'GET' }), 'Your account cannot read PMSClients. Ask the site owner for Contribute access to the PMS lists.');
    assert.equal(permissionText({ listTitle: 'PMSClients', method: 'POST' }), 'Your account cannot change PMSClients. Ask the site owner for Contribute access to the PMS lists.');
    assert.equal(permissionText({ method: 'POST' }), 'Your account cannot change the PMS lists. Ask the site owner for Contribute access to the PMS lists.');
  });

  it('anything else is as it was', () => {
    assert.equal(errorText(new Error('SharePoint (403): Access denied.'), 'x'), 'SharePoint (403): Access denied.');
    assert.equal(errorText('nope', 'Could not load clients.'), 'Could not load clients.');
    assert.equal(sessionBanner(new Error('boom'), { unsaved: false }), null, 'only a lost sign-in has a banner');
    assert.equal(TITLE.clients, 'PMSClients');
  });
});
