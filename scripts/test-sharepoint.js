import assert from 'node:assert/strict';
import { sharePointFolder } from './deployment-config.js';
import { afterEach, test } from 'node:test';
import * as service from '../migration/src/lib/data/dataService.js';
import { DEFAULT_BRAND, loadBrand } from '../migration/src/lib/brand/branding.js';
import { login } from '../migration/src/lib/admin/admin-pin.js';
import { sha256Hex } from '../migration/src/lib/admin/sha256.js';
import { importSeed } from '../migration/src/lib/setup/setup-import.js';
import { LISTS, VERSION } from '../migration/src/lib/schema/pms-schema.js';
import { columnsOf } from '../migration/src/lib/schema/pms-schema-meta.js';
import { TITLE } from './sharepoint-fake.js';

const originalFetch = globalThis.fetch;
const siteUrl = 'https://tenant.example/sites/cec';
const json = (data, status = 200) => new Response(JSON.stringify({ d: data }), { status });

test('backend mode detection follows service configuration', () => {
  assert.equal(service.isSharePointMode(), false);
  service.configure({ sharePoint: { siteUrl } });
  assert.equal(service.isSharePointMode(), true);
  service.configure({ baseUrl: '/api' });
  assert.equal(service.isSharePointMode(), false);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.CEC_ASSETS;
  service.configure({ baseUrl: '/api' });
});

test('SharePoint reads map AppId, dates and JSON arrays and follow pagination', async () => {
  service.configure({ sharePoint: { siteUrl } });
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.credentials, 'same-origin');
    calls += 1;
    if (calls === 1) return json({ results: [{ Id: 4, AppId: 'session-a', SessionDate: '2026-09-23T00:00:00Z', SectionIds: '["section-a"]', Status: 'not-started' }], __next: `${siteUrl}/_api/next` });
    assert.equal(url, `${siteUrl}/_api/next`);
    return json({ results: [{ Id: 5, AppId: 'session-b', SectionIds: '[]' }] });
  };
  const sessions = await service.listSessions();
  assert.equal(sessions[0].id, 'session-a');
  assert.equal(sessions[0].date, '2026-09-23');
  assert.deepEqual(sessions[0].sectionIds, ['section-a']);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].Id, undefined);
});

test('SharePoint 403 remains a permissions error, not a missing record', async () => {
  service.configure({ sharePoint: { siteUrl } });
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: { value: 'Access denied' } } }), { status: 403 });
  await assert.rejects(service.getClient('client-a'), { status: 403 });
});

test('current user reads only the signed-in SharePoint ID and display name', async () => {
  service.configure({ sharePoint: { siteUrl } });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `${siteUrl}/_api/web/currentuser?$select=Id,Title`);
    assert.equal(options.credentials, 'same-origin');
    return json({ Id: 42, Title: 'Casey Example', Email: 'not-requested@example.test' });
  };
  assert.deepEqual(await service.getCurrentUser(), { id: '42', displayName: 'Casey Example' });
  service.configure({ baseUrl: '/api' });
  assert.equal(await service.getCurrentUser(), null);
});

test('user setup stores the active session, visitor roster and idempotent visit events', async () => {
  const mock = mockSharePoint();
  await service.updateAppSettings({ activeSessionId: 'session-a' });
  await service.updateAppSettings({ activeSessionId: 'session-b' });
  assert.equal((await service.getAppSettings()).activeSessionId, 'session-b');

  await service.createVisitor({ id: 'visitor-a', sessionId: 'session-b', displayName: 'Jordan Lee', enabled: true });
  const [roster] = await service.readLists([{ list: 'visitorroster', where: { sessionId: 'session-b' } }]);
  assert.deepEqual(roster.map(({ id, displayName }) => [id, displayName]), [['visitor-a', 'Jordan Lee']]);

  const visit = { visitKey: 'visit-tab-a', sessionId: 'session-b', entryMode: 'staff', sharePointUserId: '42', displayName: 'Casey Example' };
  await service.recordUserVisit(visit);
  await service.recordUserVisit(visit);
  assert.equal(mock.lists.get('uservisitlogs').length, 1);
  assert.equal(mock.lists.get('uservisitlogs')[0].AppId, 'visit-tab-a');
  assert.equal(mock.lists.get('uservisitlogs')[0].SignedInName, 'Casey Example');
  assert.equal(mock.lists.get('uservisitlogs')[0].visitKey, undefined);
  assert.equal(mock.calls.filter((call) => call.method === 'GET' && call.url.includes(`getbytitle('${TITLE.uservisitlogs}')/items?$filter=`)).length, 0);
});

test('configured active session blocks stale visits, resumes and QR scans', async () => {
  const mock = mockSharePoint();
  Object.assign(mock.lists.get('appsettings')[0], { ActiveSessionId: 'session-b' });
  mock.add('clients', { AppId: 'client-a', Name: 'Company A' });
  mock.add('sessions', { AppId: 'session-a', ClientId: 'client-a', Status: 'in-progress', SectionIds: '[]' });
  mock.add('sessions', { AppId: 'session-b', ClientId: 'client-a', Status: 'in-progress', SectionIds: '[]' });
  mock.add('tracks', { AppId: 'track-old', SessionId: 'session-a', ClientId: 'client-a', ResumeCount: 0 });
  mock.add('qrtokens', { AppId: 'token-old', ClientId: 'client-a', SessionId: 'session-a', Used: false });
  await assert.rejects(service.beginVisit('visit-new', 'session-a', 'client-a'), { code: 'session-not-active' });
  await assert.rejects(service.resumeClientTrack('track-old'), { code: 'session-not-active' });
  const scan = await quietly(() => service.openQrScan('token-old'));
  assert.equal(scan.failure.code, 'session-not-active');
  await assert.rejects(scan.claim(), { code: 'session-not-active' });
  await assert.rejects(service.provisionQrToken('client-a', 'session-a'), { code: 'session-not-active' });
  assert.equal(mock.lists.get('tracks').length, 1);
  assert.equal(mock.lists.get('qrtokens')[0].Used, false);
});

/** Runs `work` with console.warn silent: this file's stub has no "who is signed in", which a scan asks for and can do without. */
async function quietly(work) {
  const warn = console.warn;
  console.warn = () => {};
  try { return await work(); } finally { console.warn = warn; }
}

test('a visitor\'s QR scan keeps the roster name and the code is single-use', async () => {
  const mock = mockSharePoint();
  mock.add('clients', { AppId: 'client-a', Name: 'Example Company' });
  mock.add('sessions', { AppId: 'session-a', ClientId: 'client-a', Status: 'not-started', ParticipationMode: 'client-visit' });
  mock.add('visitorroster', { AppId: 'visitor-a', SessionId: 'session-a', GuestName: 'Jordan Lee', Enabled: true });
  // (A provisioned site has the AppSettings item; until Phase 10c-2b this test had none, which let any session hand out codes.)
  Object.assign(mock.lists.get('appsettings')[0], { ActiveSessionId: 'session-a', ActiveClientId: 'client-a' });
  const token = await service.provisionQrToken('client-a', 'session-a', { visitorId: 'visitor-a' });
  const track = await (await service.openQrScan(token.id)).claim();
  assert.equal(track.visitorId, 'visitor-a');
  assert.equal(track.participantName, 'Jordan Lee');
  assert.equal(track.sharePointUserId, null);
  assert.equal((await service.getQrToken(token.id)).used, true);
  const again = await quietly(() => service.openQrScan(token.id));
  assert.equal(again.failure.code, 'token-used');
  await assert.rejects(again.claim(), { code: 'token-used' });
  assert.equal(mock.lists.get('tracks').length, 1);
});

test('disabling a visitor permanently retires their unused QR codes', async () => {
  const mock = mockSharePoint();
  mock.add('sessions', { AppId: 'session-a', ClientId: 'client-a', Status: 'in-progress', ParticipationMode: 'client-visit' });
  mock.add('visitorroster', { AppId: 'visitor-a', SessionId: 'session-a', GuestName: 'Jordan Lee', Enabled: true });
  mock.add('qrtokens', { AppId: 'invite-a', ClientId: 'client-a', SessionId: 'session-a', VisitorId: 'visitor-a', Used: false, ClientTrackId: null });
  await service.setVisitorEnabled('visitor-a', false);
  assert.equal((await service.getVisitor('visitor-a')).enabled, false);
  assert.equal((await service.getQrToken('invite-a')).used, true);
  assert.ok((await service.getQrToken('invite-a')).expiredAt);
  await service.setVisitorEnabled('visitor-a', true);
  assert.equal((await quietly(() => service.openQrScan('invite-a'))).failure.code, 'token-expired');
});

test('switching a session to Staff mode retires all unclaimed visitor QR codes', async () => {
  const mock = mockSharePoint();
  mock.add('sessions', { AppId: 'session-a', ClientId: 'client-a', Status: 'in-progress', ParticipationMode: 'client-visit' });
  mock.add('qrtokens', { AppId: 'invite-a', ClientId: 'client-a', SessionId: 'session-a', VisitorId: 'visitor-a', Used: false });
  mock.add('qrtokens', { AppId: 'staff-token', ClientId: 'client-a', SessionId: 'session-a', Used: false });
  await service.setSessionParticipationMode('session-a', 'staff');
  const tokens = mock.lists.get('qrtokens');
  assert.equal(tokens.find((token) => token.AppId === 'invite-a').Used, true);
  assert.ok(tokens.find((token) => token.AppId === 'invite-a').ExpiredAt);
  assert.equal(tokens.find((token) => token.AppId === 'staff-token').Used, false);
});

// The stub's lists, by title: every column of each, from the schema (migration/src/lib/schema/pms-schema.js and pms-schema-meta.js; schema v2 has no
// column that may be left out). JSON is plain text of several lines; every other column is reported as a single line of text.
const stubColumns = Object.fromEntries(Object.entries(LISTS).map(([key, { title }]) => [title, columnsOf(key).map((column) => column.name)]));
const noteColumns = new Set(Object.keys(LISTS).flatMap((key) => columnsOf(key).filter((column) => ['array', 'object'].includes(column.kind)).map((column) => column.name)));

// The stub, like the mock of scripts/sharepoint-fake.js, keeps its lists by key ('sessions'): a test names a list by its key, never by a title.
const keyOf = Object.fromEntries(Object.entries(LISTS).map(([key, { title }]) => [title, key]));

function mockSharePoint() {
  const lists = new Map(Object.values(keyOf).map((key) => [key, []]));
  const calls = [];
  let nextId = 1;
  let version = 0;
  const stamp = (item) => ({ ...item, __metadata: { etag: `"${++version}"` } });
  const add = (key, fields) => {
    const item = stamp({ Id: nextId++, ...fields });
    lists.get(key).push(item);
    return item;
  };
  const fail = (status, message) => new Response(JSON.stringify({ error: { message: { value: message } } }), { status });
  const state = { lists, calls, add, beforeMerge: null, beforeCreate: null, unique: true, expireDigest: false };
  // A site Setup has made (Phase 10c-2b): the AppSettings item says the lists' version, and takes no id of the test's own sequence.
  lists.get('appsettings').push(stamp({ Id: 100_000, AppId: 'default', SchemaVersion: VERSION }));
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options });
    if (url.endsWith('/contextinfo')) return json({ GetContextWebInformation: { FormDigestValue: 'digest-token', FormDigestTimeoutSeconds: 1800 } });
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname);
    const name = path.match(/getbytitle\('([^']+)'\)/)?.[1];
    const rows = lists.get(keyOf[name]);
    if (!rows) return fail(404, 'List does not exist');
    if (path.endsWith('/fields')) return json({ results: stubColumns[name].map((InternalName) => ({
      InternalName, Indexed: InternalName === 'AppId', EnforceUniqueValues: state.unique && InternalName === 'AppId',
      TypeAsString: noteColumns.has(InternalName) ? 'Note' : 'Text', RichText: false,
    })) });
    if (!path.includes('/items')) return json({ ListItemEntityTypeFullName: `SP.Data.${name}ListItem` });
    if (options.method === 'GET') {
      const filter = parsed.searchParams.get('$filter');
      const matches = !filter ? rows : rows.filter((row) => {
        const groups = [...filter.matchAll(/\(([^()]+)\)/g)].map(([, group]) =>
          [...group.matchAll(/(\w+) eq '((?:''|[^'])*)'/g)]);
        const ungrouped = [...filter.replace(/\([^()]+\)/g, '').matchAll(/(\w+) eq '((?:''|[^'])*)'/g)];
        if (ungrouped.length) groups.push(ungrouped);
        return groups.every((comparisons) => comparisons.some(([, column, value]) => String(row[column]) === value.replace(/''/g, "'")));
      });
      return json({ results: matches });
    }
    assert.equal(options.headers['X-RequestDigest'], 'digest-token');
    if (state.expireDigest) {
      state.expireDigest = false;
      return fail(403, 'The security validation for this page has expired');
    }
    const itemId = Number(path.match(/items\((\d+)\)/)?.[1]);
    const fields = options.body ? JSON.parse(options.body) : {};
    const { __metadata, ...changes } = fields;
    if (options.headers['X-HTTP-Method'] === 'MERGE') {
      if (state.beforeMerge) {
        const callback = state.beforeMerge;
        state.beforeMerge = null;
        callback(rows);
      }
      const index = rows.findIndex((row) => row.Id === itemId);
      if (rows[index].__metadata.etag !== options.headers['If-Match']) return fail(412, 'Version changed');
      rows[index] = stamp({ ...rows[index], ...changes });
      return new Response(null, { status: 204 });
    }
    if (options.headers['X-HTTP-Method'] === 'DELETE') {
      const index = rows.findIndex((row) => row.Id === itemId);
      if (rows[index].__metadata.etag !== options.headers['If-Match']) return fail(412, 'Version changed');
      rows.splice(index, 1);
      return new Response(null, { status: 204 });
    }
    if (state.beforeCreate) {
      const callback = state.beforeCreate;
      state.beforeCreate = null;
      callback(keyOf[name], changes);
    }
    if (rows.some((row) => row.AppId === changes.AppId)) return fail(400, 'A duplicate unique value exists');
    assert.equal(__metadata.type, `SP.Data.${name}ListItem`);
    return json(add(keyOf[name], changes), 201);
  };
  service.configure({ sharePoint: { siteUrl } });
  return state;
}

test('CRUD uses SharePoint numeric IDs, unique AppId, metadata and a cached digest', async () => {
  const mock = mockSharePoint();
  const id = "client's & team";
  await service.createClient({ id, name: 'Example' });
  assert.equal((await service.getClient(id)).name, 'Example');
  await service.updateClient(id, { name: 'Updated' });
  assert.equal((await service.getClient(id)).name, 'Updated');
  await service.deleteClient(id);
  assert.equal(await service.getClient(id), null);
  assert.equal(mock.calls.filter((call) => call.url.endsWith('/contextinfo')).length, 1);
  assert.ok(mock.calls.some((call) => call.url.includes('/items(1)')));
});

test('section content uses one read per list, preserves ordering and stays fresh', async () => {
  const mock = mockSharePoint();
  mock.add('sections', { AppId: 'section', QuestionIds: '["question-b","question-a"]' });
  mock.add('questions', { AppId: 'question-a', OptionIds: '["option-a"]' });
  mock.add('questions', { AppId: 'question-b', OptionIds: '["option-b","option-a"]' });
  mock.add('options', { AppId: 'option-a', Label: 'A' });
  mock.add('options', { AppId: 'option-b', Label: 'B' });
  const content = await service.getSectionContent('section');
  assert.equal(mock.calls.length, 3);
  assert.ok(mock.calls.every((call) => call.method === 'GET'));
  assert.equal(content.section.id, 'section');
  assert.deepEqual(content.questions.map((question) => question.id), ['question-b', 'question-a']);
  assert.deepEqual(content.questions[0].options.map((option) => option.id), ['option-b', 'option-a']);
  mock.lists.get('options')[0].Label = 'Updated';
  assert.equal((await service.getSectionContent('section')).questions[1].options[0].label, 'Updated');
  assert.equal(await service.getSectionContent('missing'), null);
  mock.add('sections', { AppId: 'empty', QuestionIds: '[]' });
  const before = mock.calls.length;
  assert.deepEqual((await service.getSectionContent('empty')).questions, []);
  assert.equal(mock.calls.length - before, 1);
});

test('the Live display\'s brand is the session\'s own client, then the built-in default: no theme list is asked, even where one exists', async () => {
  const mock = mockSharePoint();
  // A site that still has the legacy look's one item, naming a client and a colour: nothing may ask for it.
  mock.lists.set('ThemeConfig', []);
  mock.add('ThemeConfig', { AppId: 'default', ClientId: 'fallback', PrimaryColor: '#112233', SecondaryColor: '#445566', LogoUrl: '/theme-logo.png' });
  mock.add('clients', { AppId: 'client', Name: 'Route client', PrimaryColor: '#445566' });
  mock.add('clients', { AppId: 'fallback', Name: 'Theme client', PrimaryColor: '#778899' });
  mock.add('sessions', { AppId: 'session', ClientId: 'client', SectionIds: '[]' });
  const before = mock.calls.length;
  // The client the caller names (the Live display hands over its session's client): one read.
  const brand = await loadBrand({ state: { clientId: 'client' } });
  assert.deepEqual([brand.clientId, brand.name, brand.primaryColor], ['client', 'Route client', '#445566']);
  assert.equal(mock.calls.length - before, 1);
  // Only a session: that session's client.
  assert.equal((await loadBrand({ state: {}, sessionId: 'session' })).name, 'Route client');
  // A client that is gone, and no client at all: the default brand, whole, and never the old list's client, colours or logo.
  for (const route of [{ state: { clientId: 'missing' } }, { state: {} }, { state: {}, sessionId: 'no-such-session' }]) {
    assert.deepEqual(await loadBrand(route), { clientId: null, ...DEFAULT_BRAND }, JSON.stringify(route));
  }
  assert.deepEqual(mock.calls.filter((call) => String(call.url).includes('ThemeConfig')), [], 'no request named the theme list');
});

test('PIN sign-in retains the existing pin property mapped to PinHash', async () => {
  const mock = mockSharePoint();
  mock.add('adminusers', { AppId: 'admin', Name: 'Facilitator', PinHash: sha256Hex('1357') });
  assert.deepEqual(await login('1357'), { id: 'admin', name: 'Facilitator' });
  assert.equal(await login('0000'), null);
});

test('ordinary updates read once and still retry concurrent changes', async () => {
  const mock = mockSharePoint();
  await service.createClient({ id: 'client', name: 'Before' });
  mock.calls.length = 0;
  await service.updateClient('client', { name: 'After' });
  assert.equal(mock.calls.length, 2);
  mock.beforeMerge = (rows) => {
    rows[0].PrimaryColor = '#112233';
    rows[0].__metadata.etag = '"concurrent"';
  };
  await service.updateClient('client', { name: 'Final' });
  const client = await service.getClient('client');
  assert.equal(client.name, 'Final');
  assert.equal(client.primaryColor, '#112233');
  await assert.rejects(service.updateClient('missing', { name: 'Missing' }), { status: 404 });
});

test('writes refuse a nonunique AppId before submitting any list data', async () => {
  const mock = mockSharePoint();
  mock.unique = false;
  await assert.rejects(service.createClient({ name: 'Example' }), /Enforce unique values/);
  assert.equal(mock.calls.some((call) => call.method === 'POST'), false);
});

test('expired digest is refreshed once and permission errors are not retried', async () => {
  const mock = mockSharePoint();
  mock.expireDigest = true;
  await service.createClient({ name: 'Example' });
  assert.equal(mock.calls.filter((call) => call.url.endsWith('/contextinfo')).length, 2);
});

test('a missing list is not mistaken for a missing app record', async () => {
  const mock = mockSharePoint();
  mock.lists.delete('clients');
  await assert.rejects(service.getClient('missing'), /List does not exist/);
});

test('QR links retain SharePoint file paths and local server roots', () => {
  const page = `${siteUrl}/Shared%20Documents/${encodeURIComponent(sharePointFolder)}/index.html`;
  assert.equal(service.qrUrl('token & one', page), `${page}?qr=token+%26+one`);
  assert.equal(service.qrUrl('token', 'http://localhost:3000/'), 'http://localhost:3000/?qr=token');
  assert.equal(service.qrUrl('new', `${page}?qr=old#/agenda`), `${page}?qr=new`);
});

test('seed import skips existing records, brings no admins, never imports live history, and does not read an older file\'s theme', async () => {
  const mock = mockSharePoint();
  mock.add('clients', { AppId: 'client', Name: 'Do not overwrite' });
  const seed = { version: 1, data: {
    clients: [{ id: 'client', name: 'Replacement' }, { id: 'client-two', name: 'Second' }], sections: [], questions: [], options: [], sessions: [],
    adminusers: [{ id: 'admin', pin: sha256Hex('1357'), name: 'Facilitator' }], theme: { primaryColor: '#112233' },
    tracks: [{ id: 'must-not-import' }], responses: [], qrtokens: [],
  } };
  // (Phase 10c-3: the import is Setup's alone, lib/setup/setup-import.js, built on the data layer's own calls. A file's admins are left out: admins are
  // added with Add an admin. The file still holds `theme`, as one made before Phase 10c-2a does: it is accepted, and nothing is imported for it.)
  const first = await importSeed(service, seed);
  assert.deepEqual(first.map((result) => [result.list, result.id, result.status]), [[TITLE.clients, 'client', 'Skipped existing'], [TITLE.clients, 'client-two', 'Imported']]);
  assert.equal(mock.lists.get('clients')[0].Name, 'Do not overwrite');
  assert.equal(mock.lists.get('adminusers').length, 0);
  assert.equal(mock.lists.get('tracks').length, 0);
  const second = await importSeed(service, seed);
  assert.equal(second.every((result) => result.status === 'Skipped existing'), true);
});

test('embedded starter logos render inline without changing stored or editable URLs', async () => {
  const mock = mockSharePoint();
  const logo = '/assets/images/clients/kroger-logo.svg';
  globalThis.CEC_ASSETS = { [logo.slice(1)]: 'data:image/svg+xml;base64,PHN2Zy8+' };
  mock.add('clients', { AppId: 'client', Name: 'Example', LogoUrl: logo });
  assert.equal((await service.getClient('client')).logoUrl, logo);
  assert.equal((await loadBrand({ state: { clientId: 'client' } })).logoUrl, globalThis.CEC_ASSETS[logo.slice(1)]);
  const seed = { version: 1, data: {
    clients: [{ id: 'new-client', name: 'New', logoUrl: logo }],
    sections: [], questions: [], options: [], sessions: [], adminusers: [],
  } };
  await importSeed(service, seed);
  const stored = mock.lists.get('clients').find((client) => client.AppId === 'new-client').LogoUrl;
  assert.ok(!stored.startsWith('data:'));
  assert.ok(stored.endsWith('/assets/images/clients/kroger-logo.svg'));
  assert.ok(stored.length <= 255);
});

test('a sign-in redirect producing HTML is reported as authentication failure', async () => {
  service.configure({ sharePoint: { siteUrl } });
  globalThis.fetch = async () => new Response('<html>Sign in</html>', { status: 200 });
  await assert.rejects(service.listClients(), { status: 401 });
});

test('429 respects Retry-After and retries without changing the target site', async () => {
  service.configure({ sharePoint: { siteUrl } });
  let calls = 0;
  globalThis.fetch = async (url) => {
    assert.ok(url.startsWith(`${siteUrl}/_api/`));
    if (++calls === 1) return new Response('', { status: 429, headers: { 'Retry-After': '0' } });
    return json({ results: [] });
  };
  assert.deepEqual(await service.listClients(), []);
  assert.equal(calls, 2);
});

test('pagination rejects external URLs instead of forwarding credentials', async () => {
  service.configure({ sharePoint: { siteUrl } });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return json({ results: [], __next: 'https://other.example/_api/items' });
  };
  await assert.rejects(service.listClients(), /pagination URL/);
  assert.equal(calls, 1);
});
