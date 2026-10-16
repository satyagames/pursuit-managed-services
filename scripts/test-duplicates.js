// Phase 10h, part B: a duplicate is a duplicate, whether SharePoint says 400 or 500.
//
// The first run on the real site (PCOE, 14 Oct 2026) showed Setup's self-test step "A second create with the same AppId is refused" failing with
// "Refused, but not as a duplicate: SharePoint (500): The list item could not be added or updated because duplicate values were found in the
// following field(s) in the list: [AppId]." The data layer read a refusal as "it is there already" (409) only when SharePoint said 400, which the
// mock said and that site does not. Every path that meets a record already there leans on that 409: a participant's answers after a lost reply, a
// visit's track, the visit log, two admins pressing Go live, seeding, the seed-file import, a copy, a slug that is taken, the self-test. A 500 is
// not retried, so nothing looped: the action just failed, and a participant's answers stopped being saved.
//
// Held here: which refusal is a duplicate (spHttp, through the data layer's own calls, on a stand-in that answers exactly what each case says), and,
// with the mock answering a duplicate as that site does (500, its words), each of those paths ending as it always did. Run: node --test
// scripts/test-duplicates.js (also part of npm test).
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import * as ds from '../public/js/dataService.js';
import { createClientRecord } from '../migration/src/lib/admin-clients.js';
import { goLive } from '../migration/src/lib/admin-today.js';
import { createAnswerStore } from '../migration/src/lib/answer-store.js';
import { samplePack } from '../migration/src/lib/sample-clients.js';
import { seedPack } from '../migration/src/lib/seed.js';
import { DUPLICATE_CODE, DUPLICATE_WORDS, STRAYS, TITLE, UNINDEXED, UNNAMED, createSharePointFake } from './sharepoint-fake.js';

const realFetch = globalThis.fetch;
const DAY = '2026-10-15';
/** Each "device" or "admin" is a module of its own (one page, one write token). */
let pages = 0;
async function freshPage(settings) {
  const page = await import(`../public/js/dataService.js?duplicates-page=${pages += 1}`);
  page.configure(settings);
  return page;
}
/** A site with the sample clients, answering a duplicate as `options` say (by default: as the real site did, 500). */
async function site(options = {}) {
  const fake = createSharePointFake(options);
  fake.install();
  ds.configure({ sharePoint: fake.settings });
  await seedPack(ds, samplePack());
  return fake;
}
const answer = (questionId, value) => ({ questionId, answer: value, firstAnswer: value, attempts: 1, correct: true, answeredAt: '2026-10-15T10:00:00.000Z' });

describe('which refusal is a duplicate', () => {
  after(() => { globalThis.fetch = realFetch; });

  /** The refusal a create of a client meets when SharePoint answers `status` with `error`. Every other request is the mock's. */
  async function refusal(status, error) {
    const fake = createSharePointFake();
    const created = (url, options) => (options?.method ?? 'GET') === 'POST' && new RegExp(`${TITLE.clients}'\\)\\/items$`).test(decodeURIComponent(String(url)));
    globalThis.fetch = async (url, options) => (created(url, options)
      ? new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json;odata=verbose' } })
      : fake.fetch(url, options));
    ds.configure({ sharePoint: fake.settings });
    return ds.createClient({ id: 'c-x', name: 'X', slug: 'x', status: 'active' }).then(() => assert.fail('the create was not refused'), (cause) => cause);
  }
  const words = (value) => ({ lang: 'en-US', value });

  it('500 with SharePoint\'s words about duplicate values: a duplicate (409), and the error still says 500', async () => {
    const found = await refusal(500, { code: '-1, Microsoft.SharePoint.SPException', message: words(DUPLICATE_WORDS) });
    assert.equal(found.status, 409);
    assert.equal(found.sharePointStatus, 500);
    assert.equal(found.message, `SharePoint (500): ${DUPLICATE_WORDS}`, 'a Details line says what the site answered');
  });

  it('400 with the same words: a duplicate, as it always was', async () => {
    const found = await refusal(400, { message: words(DUPLICATE_WORDS) });
    assert.deepEqual([found.status, found.sharePointStatus], [409, 400]);
  });

  it('500 with SharePoint\'s duplicate code and its words in another language: a duplicate', async () => {
    const found = await refusal(500, { code: DUPLICATE_CODE, message: words('Das Listenelement konnte nicht hinzugefügt oder aktualisiert werden, da in den folgenden Feldern doppelte Werte gefunden wurden: [AppId].') });
    assert.deepEqual([found.status, found.sharePointStatus], [409, 500]);
  });

  it('500 for anything else stays 500, and so does 400; a 409 is a 409', async () => {
    assert.deepEqual(await refusal(500, { code: '-2146232060, System.Data.SqlClient.SqlException', message: words('Something went wrong. Please try again later.') }).then((cause) => [cause.status, cause.sharePointStatus]), [500, 500]);
    assert.deepEqual(await refusal(400, { message: words('The property \'Nickname\' does not exist on type \'SP.Data.PMSClientsListItem\'.') }).then((cause) => [cause.status, cause.sharePointStatus]), [400, 400]);
    assert.deepEqual(await refusal(409, { message: words('Conflict.') }).then((cause) => [cause.status, cause.sharePointStatus]), [409, 409]);
    assert.deepEqual(await refusal(503, { message: words('duplicate request: the server is busy') }).then((cause) => cause.status), 503, 'a busy answer is never a duplicate, whatever it says');
  });
});

describe('the mock answers a duplicate as the real site did', () => {
  after(() => { globalThis.fetch = realFetch; });
  const twice = async (options) => {
    const fake = createSharePointFake(options);
    const address = `${fake.siteUrl}/_api/web/lists/getbytitle('${fake.titleOf('clients')}')/items`;
    const body = JSON.stringify({ __metadata: { type: `SP.Data.${fake.titleOf('clients')}ListItem` }, AppId: 'c-a', Name: 'A' });
    const send = () => fake.fetch(address, { method: 'POST', headers: { 'X-RequestDigest': 'digest-token' }, body });
    assert.equal((await send()).status, 201);
    const reply = await send();
    return { status: reply.status, error: (await reply.json()).error };
  };

  it('500 and its words by default; 400 when asked (`duplicateStatus`); its code only when asked (`duplicateCode`: assumed, not seen)', async () => {
    assert.deepEqual(await twice(), { status: 500, error: { message: { value: DUPLICATE_WORDS } } });
    assert.deepEqual(await twice({ duplicateStatus: 400 }), { status: 400, error: { message: { value: DUPLICATE_WORDS } } });
    assert.deepEqual(await twice({ duplicateCode: true }), { status: 500, error: { code: DUPLICATE_CODE, message: { value: DUPLICATE_WORDS } } });
    assert.match(DUPLICATE_CODE, /Microsoft\.SharePoint\.SPDuplicateValuesFoundException$/);
  });
});

describe('with the mock answering a duplicate as the real site did (500), every path that meets a record already there ends as it always did', () => {
  after(() => { globalThis.fetch = realFetch; });

  it('a participant\'s first save whose reply was lost, then the next save: one item, holding every answer', async () => {
    const fake = await site();
    const { session } = await ds.activateClient('c-kroger', DAY);
    const track = await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger');
    const sleeps = [];
    const store = createAnswerStore({ api: ds, storage: new Map(), sleep: async (ms) => { sleeps.push(ms); } });
    const visit = { trackId: track.id, sessionId: session.id, clientId: 'c-kroger' };
    await store.restore(visit, null);
    // The item is created, but as far as the device knows the request failed: the next create meets it.
    fake.hooks.beforeCreate = (list, fields) => { if (list === 'responses') fake.add(list, { ...fields }); };
    store.record(visit, 'sec-trivia', answer('q-trivia-1', 'a'));
    await store.flush(visit, 'sec-trivia');
    store.record(visit, 'sec-trivia', answer('q-trivia-2', 'b'));
    await store.flush(visit, 'sec-trivia');
    assert.equal(fake.lists.get('responses').length, 1);
    assert.deepEqual(JSON.parse(fake.item('responses', track.id).ResponsesJson).map((record) => record.questionId), ['q-trivia-1', 'q-trivia-2']);
    assert.ok(fake.requests.some((entry) => entry.list === 'responses' && entry.method === 'POST' && entry.faulted === undefined), 'a create met the item');
    assert.deepEqual(sleeps, [], 'and nothing had to be tried again');
  });

  it('a visit\'s track whose create was answered 503 after it was made: tried again, met as there, and the scan gets in with one track', async () => {
    const fake = await site();
    const { session } = await ds.activateClient('c-kroger', DAY);
    await ds.setSessionParticipationMode(session.id, 'client-visit');
    const visitor = await ds.createVisitor({ sessionId: session.id, displayName: 'Avery Stone', enabled: true });
    const code = await ds.provisionQrToken('c-kroger', session.id, { visitorId: visitor.id });
    const device = await freshPage({ sharePoint: fake.settings });
    let lost = false;
    const inner = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const response = await inner(url, options);
      if (!lost && (options.method ?? 'GET') === 'POST' && new RegExp(`${TITLE.tracks}'\\)\\/items$`).test(decodeURIComponent(String(url)))) {
        lost = true;
        return new Response(JSON.stringify({ error: { message: { value: 'The server is busy.' } } }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      return response;
    };
    try {
      const scan = await device.openQrScan(code.id);
      assert.equal(scan.failure, null);
      const track = await scan.claim();
      assert.equal(lost, true);
      assert.equal(track.participantName, 'Avery Stone');
      assert.deepEqual(fake.lists.get('tracks').map((row) => row.AppId), [track.id], 'one track');
      assert.equal(fake.item('qrtokens', code.id).ClientTrackId, track.id);
    } finally { globalThis.fetch = inner; }
  });

  it('the same visit logged twice: one row, and no error', async () => {
    const fake = await site();
    const { session } = await ds.activateClient('c-kroger', DAY);
    const entry = { visitKey: `visit-${crypto.randomUUID()}`, sessionId: session.id, clientId: 'c-kroger', page: 'welcome', entryMode: 'staff', visitedAt: new Date().toISOString() };
    await ds.recordParticipantVisit(entry);
    const again = await ds.recordParticipantVisit(entry);
    assert.equal(again.id, entry.visitKey);
    assert.equal(fake.lists.get('uservisitlogs').length, 1);
  });

  it('two admins pressing Go live at once: both verified, one session, one AppSettings item', async () => {
    const fake = await site();
    const [left, right] = [await freshPage({ sharePoint: fake.settings }), await freshPage({ sharePoint: fake.settings })];
    // (Each admin's own page: goLive() in one page hands a second press the first one's answer, so the two go to the data layer apiece.)
    const [one, two] = await Promise.all([left.activateClient('c-kroger', DAY), right.activateClient('c-kroger', DAY)]);
    assert.deepEqual([one.session.id, two.session.id], [`kroger-${DAY}`, `kroger-${DAY}`]);
    assert.equal((await goLive(left, { clientId: 'c-kroger', date: DAY })).verified, true);
    assert.deepEqual(fake.lists.get('sessions').map((row) => row.AppId), [`kroger-${DAY}`]);
    assert.deepEqual(fake.lists.get('appsettings').map((row) => row.AppId), ['default']);
    assert.ok(fake.requests.some((entry) => entry.list === 'sessions' && entry.method === 'POST' && entry.appId === `kroger-${DAY}`), 'both tried to create it');
  });

  it('seeding twice at the same moment: each record once, and both runs end', async () => {
    const fake = createSharePointFake();
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    const other = await freshPage({ sharePoint: fake.settings });
    const [left, right] = await Promise.all([seedPack(ds, samplePack()), seedPack(other, samplePack())]);
    for (const list of ['clients', 'sections', 'questions', 'options']) {
      const ids = fake.lists.get(list).map((row) => row.AppId);
      assert.equal(new Set(ids).size, ids.length, list);
      assert.equal(ids.length, samplePack()[list].length, list);
    }
    const created = (results) => results.filter((result) => result.status === 'Created').length;
    assert.equal(created(left) + created(right), ['clients', 'sections', 'questions', 'options'].reduce((sum, list) => sum + samplePack()[list].length, 0));
  });

  it('a slug another admin took a moment ago is said to be taken, and there is one client', async () => {
    const fake = await site();
    await createClientRecord(await freshPage({ sharePoint: fake.settings }), { name: 'Acme', slug: 'acme' });
    await assert.rejects(createClientRecord(await freshPage({ sharePoint: fake.settings }), { name: 'Acme Two', slug: 'acme' }), (cause) => cause.code === 'slug-taken' && /already taken/.test(cause.message));
    assert.deepEqual(fake.lists.get('clients').filter((row) => row.AppId === 'c-acme').map((row) => row.Name), ['Acme']);
  });

  it('Setup\'s self-test: "A second create with the same AppId is refused" passes, as the site refuses it', async () => {
    await site();
    const steps = await ds.runParticipantSelfTest();
    const duplicate = steps.find((step) => step.name === 'A second create with the same AppId is refused');
    assert.deepEqual([duplicate.pass, duplicate.detail], [true, 'Refused: AppId enforces unique values.']);
    assert.ok(steps.every((step) => step.pass), steps.filter((step) => !step.pass).map((step) => `${step.name}: ${step.detail}`).join('; '));
  });
});

it('no request of this suite reached a list that is not its own, filtered on a column with no index or named no columns', () => {
  assert.deepEqual(STRAYS.map((entry) => `${entry.method} ${entry.title}`), []);
  assert.deepEqual(UNINDEXED.map((entry) => `${entry.list}.${entry.unindexed}`), []);
  assert.deepEqual(UNNAMED.map((entry) => `${entry.list}${entry.query}`), []);
});
