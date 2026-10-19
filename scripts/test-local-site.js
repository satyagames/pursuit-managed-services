// The local PCOE site (Phase 12, scripts/local-site/): what it adds to the mock is SharePoint's behaviour, each held here against a real HTTPS server,
// and each check shown able to fail by running it again with `quirks: false` (the server without that behaviour). Then VJR's dataset (the records it
// makes pass the admin's own rules, read back through the data layer and accepted by the pager's), the scenarios (the same site every time), the
// pictures (never tracked, never packaged), and the acceptance test of the stand-in: Setup's own self-test passes in a real browser, as on PCOE.
//
//   npm run test:local-site        (Node 22; the browser step needs Playwright's Chromium)

import './fresh-page.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { DUPLICATE_WORDS, REFUSED_WORDS } from './sharepoint-fake.js';
import { packRecords, readBranding, readDataset } from './local-site/dataset.js';
import { buildScenario } from './local-site/scenarios.js';
import { DIGEST_EXPIRED, FILE_NOT_FOUND_PAGE, QUERY_TOO_LONG, findPages, startLocalSite } from './local-site/server.js';
import { ADMIN, HOST, makeFake, pageUrl } from './local-site/site-shape.js';
import { MAX_ACTIVITY_TITLE, MAX_OPTION_TEXT, optionTextProblem } from '../migration/src/lib/admin/admin-content.js';
import { MAX_CLIENT_NAME, SLUG_MAX } from '../migration/src/lib/admin/admin-clients.js';
import { isAnswerComplete, isGraded, correctOptionIds } from '../migration/src/lib/participant/pager-logic.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FOLDER = '/sites/PCOE/Shared%20Documents/PMS/';
const API = '/sites/PCOE/_api';
const JSON_ACCEPT = { Accept: 'application/json;odata=verbose' };

/** One HTTPS request to a local site on `port`, as pms-local.test. Resolves { status, headers, text, json } or rejects when the connection is cut. */
function call(port, method, address, { headers = {}, body = null, persona = 'admin' } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      host: '127.0.0.1', port, servername: HOST, method, path: address, rejectUnauthorized: false,
      headers: { Host: HOST, Cookie: `pms-local-persona=${persona}`, ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        let raw = Buffer.concat(chunks);
        if (response.headers['content-encoding'] === 'gzip') raw = gunzipSync(raw);
        const text = raw.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: response.statusCode, headers: response.headers, text, json, raw });
      });
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}
const items = (list, query) => `${API}/web/lists/getbytitle('${list}')/items${query ? `?${query}` : ''}`;
const write = (port, list, record, options = {}) => call(port, 'POST', items(list), {
  ...options, headers: { ...JSON_ACCEPT, 'Content-Type': 'application/json;odata=verbose', 'X-RequestDigest': 'digest-token', ...(options.headers ?? {}) },
  body: JSON.stringify({ __metadata: { type: `SP.Data.${list}ListItem` }, ...record }),
});
const control = (port, action, fields = {}) => call(port, 'POST', `/__local/${action}`, { headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });

/** Starts a site on a free port in a scratch data folder; both kinds (with and without the quirks) are made for each test that needs them. */
async function site(options = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'pms-local-site-'));
  const running = await startLocalSite({ port: 0, latency: 'none', scenario: 'ready', dataDir, ...options });
  return { ...running, dataDir, stop: async () => { await running.close(); rmSync(dataDir, { recursive: true, force: true }); } };
}

describe('the local site answers as PCOE does', () => {
  let on;
  let off;
  before(async () => { on = await site(); off = await site({ quirks: false }); });
  after(async () => { await on.stop(); await off.stop(); });

  test('it serves the release package\'s own pages and pms-config.txt, byte for byte', async () => {
    const pages = findPages();
    for (const file of ['index.html', 'admin.html', 'setup.html', 'pms-config.txt']) {
      const served = await call(on.port, 'GET', `${FOLDER}${file}`, { headers: { 'Accept-Encoding': 'gzip' } });
      assert.equal(served.status, 200, file);
      const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
      assert.equal(sha(served.raw), sha(readFileSync(path.join(pages.dir, file))), `${file} is the package's`);
    }
  });

  test('a .json file in the folder comes back as SharePoint\'s "File Not Found" page with status 200 (and without the quirk, it does not)', async () => {
    const answer = await call(on.port, 'GET', `${FOLDER}pms-config.json`);
    assert.equal(answer.status, 200);
    assert.equal(answer.text, FILE_NOT_FOUND_PAGE);
    assert.notEqual((await call(off.port, 'GET', `${FOLDER}pms-config.json`)).status, 200);
  });

  test('a second AppId is refused with 500 and SharePoint\'s words (seen on PCOE, 14 Oct 2026)', async () => {
    const answer = await write(on.port, 'PMSAppSettings', { AppId: 'default', Title: 'default' });
    assert.equal(answer.status, 500);
    assert.equal(answer.json.error.message.value, DUPLICATE_WORDS);
  });

  test('a read that names no columns leaves ClientId out; one that names it gets it', async () => {
    const unnamed = await call(on.port, 'GET', items('PMSActivities', '$top=1'), { headers: JSON_ACCEPT });
    assert.equal(unnamed.status, 200);
    assert.ok(!('ClientId' in unnamed.json.d.results[0]));
    const named = await call(on.port, 'GET', items('PMSActivities', '$top=1&$select=Id,AppId,ClientId'), { headers: JSON_ACCEPT });
    assert.equal(named.json.d.results[0].ClientId.startsWith('c-'), true);
  });

  test('a column called DisplayName is refused by name when there is a row to return (PCOE, 15 Oct 2026)', async () => {
    on.site.fake.fields.get('adminusers').push({ InternalName: 'DisplayName', TypeAsString: 'Text', Indexed: false, EnforceUniqueValues: false, Required: false });
    const answer = await call(on.port, 'GET', items('PMSAdminUsers', '$select=Id,AppId,DisplayName'), { headers: JSON_ACCEPT });
    assert.equal(answer.status, 400);
    assert.equal(answer.json.error.message.value, REFUSED_WORDS);
    on.site.fake.fields.get('adminusers').pop();
  });

  test('a read returns 100 items and a __next link unless it asks for more with $top', async () => {
    for (let index = 0; index < 110; index += 1) on.site.fake.add('uservisitlogs', { AppId: `log-page-${index}`, Title: 'x', SessionId: 's-paging' });
    const first = await call(on.port, 'GET', items('PMSVisitLog', '$select=Id,AppId'), { headers: JSON_ACCEPT });
    assert.equal(first.json.d.results.length, 100);
    assert.match(first.json.d.__next, /PMSVisitLog/);
    const all = await call(on.port, 'GET', items('PMSVisitLog', '$select=Id,AppId&$top=5000'), { headers: JSON_ACCEPT });
    assert.equal(all.json.d.results.length, 110);
  });

  test('a 429 carries its Retry-After, once, when one is asked for', async () => {
    await control(on.port, 'fault', { status: 429, retryAfter: 5 });
    const busy = await call(on.port, 'GET', items('PMSClients', '$select=Id,AppId'), { headers: JSON_ACCEPT });
    assert.equal(busy.status, 429);
    assert.equal(busy.headers['retry-after'], '5');
    assert.equal((await call(on.port, 'GET', items('PMSClients', '$select=Id,AppId'), { headers: JSON_ACCEPT })).status, 200);
  });

  test('a write after the write token expired is refused once with "security validation"; the next is accepted (and without the quirk, the first is)', async () => {
    for (const [running, expected] of [[on, 403], [off, 201]]) {
      await control(running.port, 'expire-token');
      const first = await write(running.port, 'PMSVisitLog', { AppId: `log-digest-${expected}`, Title: 'x' });
      assert.equal(first.status, expected);
      if (expected === 403) {
        assert.equal(first.json.error.message.value, DIGEST_EXPIRED);
        assert.equal((await write(running.port, 'PMSVisitLog', { AppId: 'log-digest-again', Title: 'x' })).status, 201);
      }
    }
  });

  test('PMSAdminUsers is readable by an admin only, in a $batch too (and without the quirk, by anyone)', async () => {
    const read = items('PMSAdminUsers', '$select=Id,AppId,Name');
    assert.equal((await call(on.port, 'GET', read, { headers: JSON_ACCEPT, persona: 'admin' })).status, 200);
    for (const persona of ['staff', 'guest', 'outsider']) assert.equal((await call(on.port, 'GET', read, { headers: JSON_ACCEPT, persona })).status, 403, persona);
    const batch = (port, persona) => call(port, 'POST', `${API}/$batch`, {
      persona, headers: { 'Content-Type': 'multipart/mixed; boundary="batch_local"', 'X-RequestDigest': 'digest-token' },
      body: ['--batch_local', 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', '', `GET https://${HOST}${read} HTTP/1.1`, 'Accept: application/json;odata=verbose', '', '', '--batch_local--', ''].join('\r\n'),
    });
    assert.match((await batch(on.port, 'staff')).text, /HTTP\/1\.1 403/);
    assert.match((await batch(on.port, 'admin')).text, /HTTP\/1\.1 200/);
    assert.equal((await call(off.port, 'GET', read, { headers: JSON_ACCEPT, persona: 'outsider' })).status, 200);
  });

  test('SharePoint says who is asking, by persona', async () => {
    const who = async (persona) => (await call(on.port, 'GET', `${API}/web/currentuser?$select=Id,Title`, { headers: JSON_ACCEPT, persona })).json.d.Title;
    assert.equal(await who('admin'), 'Rivera, Morgan');
    assert.equal(await who('staff'), 'Okafor, Jamie');
  });

  test('a query string over the limit is refused (ASSUMED limit), and without the quirk it is not', async () => {
    const long = items('PMSClients', `$select=Id,AppId&$filter=${encodeURIComponent(Array.from({ length: 120 }, (_, at) => `AppId eq 'client-${at}'`).join(' or '))}`);
    const refused = await call(on.port, 'GET', long, { headers: JSON_ACCEPT });
    assert.equal(refused.status, 400);
    assert.equal(refused.json.error.message.value, QUERY_TOO_LONG);
    assert.notEqual((await call(off.port, 'GET', long, { headers: JSON_ACCEPT })).json?.error?.message?.value, QUERY_TOO_LONG);
  });

  test('a column deleted by hand gives SharePoint\'s words naming it', async () => {
    const columns = on.site.fake.fields.get('sections');
    const at = columns.findIndex((column) => column.InternalName === 'Description');
    const [removed] = columns.splice(at, 1);
    const answer = await call(on.port, 'GET', items('PMSActivities', '$select=Id,AppId,Description'), { headers: JSON_ACCEPT });
    columns.splice(at, 0, removed);
    assert.equal(answer.status, 400);
    assert.match(answer.json.error.message.value, /'Description' does not exist/);
  });

  test('offline cuts every API request; a dropped connection cuts one', async () => {
    await control(on.port, 'offline', { on: true });
    await assert.rejects(call(on.port, 'GET', items('PMSClients', '$select=Id,AppId')));
    await control(on.port, 'offline', { on: false });
    await control(on.port, 'fault', { drop: true });
    await assert.rejects(call(on.port, 'GET', items('PMSClients', '$select=Id,AppId')));
    assert.equal((await call(on.port, 'GET', items('PMSClients', '$select=Id,AppId'), { headers: JSON_ACCEPT })).status, 200);
  });
});

describe('latency, persistence and the chaos rota', () => {
  test('PCOE\'s latency holds each API request about 350 ms; the pages are not held', async () => {
    const running = await site({ latency: 'pcoe' });
    try {
      let started = Date.now();
      await call(running.port, 'GET', items('PMSClients', '$select=Id,AppId'), { headers: JSON_ACCEPT });
      assert.ok(Date.now() - started >= 280, `an API request took ${Date.now() - started} ms`);
      started = Date.now();
      await call(running.port, 'GET', `${FOLDER}pms-config.txt`);
      assert.ok(Date.now() - started < 250);
    } finally { await running.stop(); }
  });

  test('what is written is still there after a restart; a reset puts the scenario back', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'pms-local-site-'));
    try {
      let running = await startLocalSite({ port: 0, latency: 'none', scenario: 'ready', dataDir });
      assert.equal((await write(running.port, 'PMSVisitLog', { AppId: 'log-kept', Title: 'kept' })).status, 201);
      await new Promise((resolve) => { setTimeout(resolve, 400); });
      await running.close();
      running = await startLocalSite({ port: 0, latency: 'none', scenario: 'ready', dataDir });
      assert.ok(running.site.fake.item('uservisitlogs', 'log-kept'), 'the item survived the restart');
      const made = await write(running.port, 'PMSVisitLog', { AppId: 'log-after', Title: 'after' });
      assert.notEqual(made.json.d.Id, running.site.fake.item('uservisitlogs', 'log-kept').Id, 'ids carry on after a restart');
      await control(running.port, 'reset');
      assert.equal(running.site.fake.item('uservisitlogs', 'log-kept'), undefined);
      await running.close();
    } finally { rmSync(dataDir, { recursive: true, force: true }); }
  });

  test('the chaos scenario answers a fault every sixth request, in turn', async () => {
    const running = await site({ scenario: 'chaos' });
    try {
      const statuses = [];
      for (let index = 0; index < 18; index += 1) statuses.push(await call(running.port, 'GET', items('PMSClients', '$select=Id,AppId'), { headers: JSON_ACCEPT }).then((answer) => answer.status, () => 'cut'));
      assert.deepEqual([statuses[5], statuses[11], statuses[17]], [429, 503, 500]);
      assert.equal(statuses.filter((status) => status === 200).length, 15);
    } finally { await running.stop(); }
  });
});

describe('VJR\'s dataset', () => {
  const records = packRecords();
  test('3 clients, 15 activities, 28 questions, in the dataset\'s order, and its characters unchanged', () => {
    assert.equal(records.clients.length, 3);
    assert.equal(records.sections.length, 15);
    assert.equal(records.questions.length, 28);
    for (const client of records.clients) {
      assert.deepEqual(records.sections.filter((section) => section.clientId === client.id).map((section) => section.title), ['Straight talk', 'Confidence continuum', 'Open feedback', 'MCQ', 'Guess the brand']);
    }
    const label = (id) => records.options.find((option) => option.id === id).label;
    assert.equal(label('o-kroger-mcq-2-c'), `84.51${String.fromCharCode(0xB0)}`);
    assert.equal(records.clients[2].name, `Domino${String.fromCharCode(0x2019)}s`);
    assert.equal(records.questions.find((question) => question.id === 'q-template-open-feedback-2').prompt, 'What has held back earlier transformation efforts in your organization?');
    assert.equal(readDataset().clients.flatMap((client) => client.activities).flatMap((activity) => activity.questions).length, 28);
  });

  test('every record passes the admin\'s own rules', () => {
    const ids = [...records.clients, ...records.sections, ...records.questions, ...records.options].map((record) => record.id);
    assert.equal(new Set(ids).size, ids.length, 'every AppId is unique');
    for (const client of records.clients) {
      assert.ok(client.name.length <= MAX_CLIENT_NAME && client.slug.length <= SLUG_MAX && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(client.slug));
      const titles = records.sections.filter((section) => section.clientId === client.id).map((section) => section.title);
      assert.equal(new Set(titles).size, titles.length, `a title is unique within ${client.name}`);
    }
    for (const section of records.sections) assert.ok(section.title.length <= MAX_ACTIVITY_TITLE);
    for (const question of records.questions) {
      const own = records.options.filter((option) => option.questionId === question.id);
      assert.deepEqual(own.map((option) => option.id), question.optionIds, `${question.id}'s options belong to it`);
      for (const option of own) assert.equal(optionTextProblem(option.label), '', option.id);
      assert.ok(own.every((option) => option.label.length <= MAX_OPTION_TEXT));
      const right = own.filter((option) => option.correct === true).length;
      if (['q-template-mcq', 'q-kroger-mcq', 'q-dominos-mcq', 'q-template-guess', 'q-kroger-guess', 'q-dominos-guess'].some((stem) => question.id.startsWith(stem))) assert.equal(right, 1, `${question.id} has exactly one right answer`);
      else assert.equal(right, 0, `${question.id} is a poll`);
    }
  });

  test('read back through the data layer, the pager accepts every question', async () => {
    const { state } = await buildScenario('ready', { pictures: new Map() });
    const fake = makeFake();
    fake.importState(state);
    const restore = fake.install();
    try {
      const ds = await import('../migration/src/lib/data/dataService.js?local-site-test=1');
      ds.configure({ sharePoint: fake.settings });
      for (const client of records.clients) {
        const sections = await ds.listClientSections(client.id);
        assert.deepEqual(sections.map((section) => section.id), records.sections.filter((section) => section.clientId === client.id).map((section) => section.id));
        for (const section of sections) {
          for (const question of await ds.getSectionQuestions(section)) {
            const draft = question.type === 'open-text-feedback' ? 'An answer.' : question.type === 'ranked-voting' ? question.options.map((option) => option.id) : question.options[0].id;
            assert.ok(isAnswerComplete(question, draft), question.id);
            assert.equal(isGraded(question), correctOptionIds(question).length === 1, question.id);
          }
        }
      }
      const admins = await ds.listAdminUsers();
      assert.deepEqual(admins.map((admin) => admin.name), [ADMIN.name]);
    } finally { restore(); }
  });

  test('copying the Template\'s activities to a new client gives it five, in order, with its own ids, and leaves the Template as it was', async () => {
    const { state } = await buildScenario('ready', { pictures: new Map() });
    const fake = makeFake();
    fake.importState(state);
    const restore = fake.install();
    try {
      const ds = await import('../migration/src/lib/data/dataService.js?local-site-test=2');
      ds.configure({ sharePoint: fake.settings });
      await ds.createClient({ id: 'c-newco', name: 'NewCo', slug: 'newco', status: 'active', themeVersion: 1, theme: null, logoUrl: null, primaryColor: null, secondaryColor: null, createdAt: null });
      const before = JSON.stringify(fake.lists.get('sections').filter((row) => row.ClientId === 'c-template'));
      const template = await ds.listClientSections('c-template');
      const result = await ds.copyActivities({ toClientId: 'c-newco', sectionIds: template.map((section) => section.id), gapMs: 0 });
      assert.equal(result.failed?.length ?? 0, 0);
      const copied = await ds.listClientSections('c-newco');
      assert.deepEqual(copied.map((section) => section.title), template.map((section) => section.title));
      assert.ok(copied.every((section) => !template.some((source) => source.id === section.id)), 'its own ids');
      assert.equal(JSON.stringify(fake.lists.get('sections').filter((row) => row.ClientId === 'c-template')), before, 'the Template is unchanged');
    } finally { restore(); }
  });

  test('with the pictures, every address in a theme is a file in PMSClientImages; without them, the records differ only there', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'pms-pictures-'));
    try {
      // Stand-ins of the right type and a little of each name in their bytes: the loader stores what it is given, it does not decode it.
      for (const name of readBranding().files) writeFileSync(path.join(dir, name), Buffer.from(`RIFF....WEBPVP8 ${name}`));
      const pictures = new Map(readBranding().files.map((name) => [name, { bytes: new Uint8Array(readFileSync(path.join(dir, name))), type: 'image/webp' }]));
      const withPictures = await buildScenario('tiles', { pictures });
      const without = await buildScenario('tiles', { pictures: new Map() });
      const fake = makeFake();
      fake.importState(withPictures.state);
      const addresses = fake.lists.get('clients').flatMap((row) => Object.values(JSON.parse(row.ThemeJson).assets)).filter((value) => typeof value === 'string');
      const tiles = fake.lists.get('options').map((row) => row.ImageUrl).filter(Boolean);
      assert.equal(addresses.length, 7);
      assert.equal(tiles.length, 4);
      for (const address of [...addresses, ...tiles]) assert.ok(fake.file(new URL(address).pathname), `${address} is in the library`);
      const strip = (state) => JSON.stringify(state.lists.clients.map(({ ThemeJson, LogoUrl, Modified, Created, __metadata, ...rest }) => rest)) + JSON.stringify(state.lists.sections.map((row) => row.AppId));
      assert.equal(strip(withPictures.state), strip(without.state));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the scenarios', () => {
  test('each is the same site every time it is built', async () => {
    for (const name of ['ready', 'event-day', 'pcoe-16oct']) {
      const one = await buildScenario(name, { pictures: new Map() });
      const two = await buildScenario(name, { pictures: new Map() });
      assert.equal(JSON.stringify(one.state), JSON.stringify(two.state), name);
    }
  });

  test('event-day has 60 visits at every stage, a damaged answer item and a removed option', async () => {
    const { state } = await buildScenario('event-day', { pictures: new Map() });
    assert.equal(state.lists.tracks.length, 60);
    assert.equal(state.lists.responses.filter((row) => row.ResponsesJson === '{oops').length, 1);
    assert.ok(!state.lists.options.some((row) => row.AppId === 'o-kroger-mcq-3-c'));
    assert.ok(state.lists.responses.some((row) => row.ResponsesJson.includes('o-kroger-mcq-3-c')));
    assert.equal(state.lists.tracks.filter((row) => row.RestartedAt).length, 2);
  });
});

describe('nothing of the local site ships', () => {
  test('git tracks none of VJR\'s pictures, no state and no certificate', () => {
    const tracked = execFileSync('git', ['ls-files', 'scripts/local-site'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    for (const file of tracked) assert.doesNotMatch(file, /datasets\/images\/|\/data\/|\.cert\/|\.webp$/, file);
    const ignored = execFileSync('git', ['check-ignore', 'scripts/local-site/datasets/images/logo-kroger.webp', 'scripts/local-site/data/x/state.json', 'scripts/local-site/.cert/key.pem'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    assert.equal(ignored.length, 3);
  });

  test('the release package holds no file of the local site and none of the pictures', () => {
    const pages = findPages();
    if (!existsSync(path.join(pages.dir, 'SHA256SUMS.txt'))) return;
    const names = readdirSync(pages.dir);
    assert.deepEqual(names.filter((name) => /local|\.webp$|state\.json/.test(name)), []);
    for (const page of ['index.html', 'admin.html', 'setup.html']) {
      const text = readFileSync(path.join(pages.dir, page), 'utf8');
      assert.ok(!text.includes('pms-local.test') && !text.includes('__local'), `${page} knows nothing of the local site`);
    }
  });
});

describe('the acceptance test of the stand-in', () => {
  test('Setup\'s own self-test passes on the local site: "Passed: 11 of 11 steps", as on PCOE on 16 Oct 2026', async () => {
    const { chromium } = await import('@playwright/test');
    const running = await site({ scenario: 'event-day' });
    const browser = await chromium.launch({ args: running.browserArgs });
    try {
      const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
      const outside = [];
      page.on('request', (request) => { if (!request.url().startsWith(`https://${HOST}/`)) outside.push(request.url()); });
      await page.goto(pageUrl('setup.html'));
      const section = page.getByRole('region', { name: 'SharePoint self-test' });
      page.once('dialog', (dialog) => { void dialog.accept(); });
      await section.getByRole('button', { name: 'Run self-test' }).click();
      await section.getByRole('status').filter({ hasText: /Passed|failed/ }).waitFor({ timeout: 60_000 });
      assert.match(await section.getByRole('status').textContent(), /Passed: 11 of 11 steps/);
      assert.deepEqual(outside, [], 'no request left the site');
    } finally {
      await browser.close();
      await running.stop();
    }
  });
});

