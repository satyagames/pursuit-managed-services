// Prompt 26, Part 2: the format the data layer asks for. Plain rows everywhere (`odata=nometadata`), the small extra on the few reads whose version a
// write checks (`odata=minimalmetadata`: `odata.etag`), no item type in a write body and no request for one, and the conflict check as strong as it was:
// a second writer gets 412. ASSUMED until QA-TESTING.md's check: that the real site answers these formats as its documents say.
import './fresh-page.js';
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import * as ds from '../migration/src/lib/data/dataService.js';
import { refusalWords } from '../migration/src/lib/data/session.js';
import { createSharePointFake } from './sharepoint-fake.js';

const PLAIN = 'application/json;odata=nometadata';
const VERSIONED = 'application/json;odata=minimalmetadata';
const VERBOSE = 'application/json;odata=verbose';
const SITE = 'https://tenant.example/sites/cec/_api';

describe('the fake answers in the format asked for', () => {
  const clients = (fake) => `${SITE}/web/lists/getbytitle('${fake.settings.listPrefix ?? ''}PMSClients')/items`;
  const ask = (fake, accept, query = '$top=2&$select=Id,AppId,Name') => fake.fetch(`${clients(fake)}?${query}`, { headers: { Accept: accept } }).then((reply) => reply.json());

  it('verbose, plain and with the version', async () => {
    const fake = createSharePointFake();
    fake.add('clients', { AppId: 'c1', Name: 'One' });
    const verbose = await ask(fake, VERBOSE);
    const { Id } = verbose.d.results[0];
    assert.ok(verbose.d.results[0].__metadata.type.startsWith('SP.Data'));
    assert.deepEqual(await ask(fake, PLAIN), { value: [{ Id, ID: Id, AppId: 'c1', Name: 'One' }] });
    const minimal = await ask(fake, VERSIONED);
    assert.equal(minimal.value[0]['odata.etag'], verbose.d.results[0].__metadata.etag);
  });

  it('a refusal is odata.error, and the data layer reads its words', async () => {
    const reply = await ask(createSharePointFake(), PLAIN, '$select=Id,NoSuchColumn');
    assert.ok(reply['odata.error']);
    assert.match(refusalWords(reply).message, /NoSuchColumn/);
  });

  it('a body that is not verbose may not name a type, and needs none', async () => {
    const fake = createSharePointFake();
    const send = (body) => fake.fetch(`${clients(fake)}`, { method: 'POST', headers: { Accept: PLAIN, 'Content-Type': PLAIN, 'X-RequestDigest': 'digest-token' }, body: JSON.stringify(body) });
    assert.equal((await send({ __metadata: { type: 'SP.Data.PMSClientsListItem' }, AppId: 'c2', Title: 'x' })).status, 400);
    assert.equal((await send({ AppId: 'c2', Title: 'x' })).status, 201);
  });
});

describe('what the data layer asks for', () => {
  let fake; let restore;
  const seen = [];
  before(() => {
    fake = createSharePointFake();
    restore = fake.install();
    const answer = globalThis.fetch;
    const log = (url, init) => { seen.push({ url: String(url), init }); return answer(url, init); };
    globalThis.fetch = log;
    ds.configure({ sharePoint: fake.settings });
  });
  after(() => restore());
  afterEach(() => { seen.length = 0; });

  const reads = () => seen.filter(({ init }) => !init?.method || init.method === 'GET');

  it('a list read asks for plain rows, and they decode', async () => {
    fake.add('clients', { AppId: 'c-plain', Name: 'Plain', Status: 'active' });
    const rows = await ds.listClients();
    assert.ok(rows.some((row) => row.id === 'c-plain' && row.name === 'Plain'));
    assert.deepEqual([...new Set(reads().map(({ init }) => init.headers.Accept))], [PLAIN]);
  });

  it('a read of one item by its AppId asks for its version', async () => {
    fake.add('clients', { AppId: 'c-held', Name: 'Before' });
    assert.equal((await ds.getClient('c-held')).name, 'Before');
    const read = reads().filter(({ url }) => /AppId eq/.test(decodeURIComponent(url)));
    assert.ok(read.length);
    assert.equal(read[0].init.headers.Accept, VERSIONED);
  });

  it('a create and a change carry no item type, and nothing asks for one', async () => {
    const made = await ds.createClient({ id: 'c-typeless', name: 'Typeless', slug: 'typeless' });
    await ds.updateClient(made.id, { name: 'Typeless two' });
    assert.equal((await ds.getClient(made.id)).name, 'Typeless two');
    assert.ok(!seen.some(({ url }) => /ListItemEntityTypeFullName/.test(decodeURIComponent(url))), 'no request for a list\'s item type');
    const writes = seen.filter(({ url, init }) => init?.method === 'POST' && !/contextinfo|\$batch/.test(url));
    assert.ok(writes.length >= 2);
    for (const { init } of writes) {
      assert.doesNotMatch(init.body, /"__metadata":/);
      assert.equal(init.headers['Content-Type'], PLAIN);
    }
  });

  it('on the participant page a list\'s first write does not read its columns', async () => {
    const page = await import('../migration/src/lib/data/dataService.js?reply=1');
    page.skipColumnChecks(); // (the participant page, migration/src/main.ts)
    page.configure({ sharePoint: fake.settings });
    await page.createClient({ id: 'c-first', name: 'First write', slug: 'first-write' });
    assert.ok(!seen.some(({ url }) => /\/fields\?/.test(decodeURIComponent(url))));
    seen.length = 0;
    ds.configure({ sharePoint: fake.settings });
    await ds.createClient({ id: 'c-second', name: 'Second', slug: 'second' });
    assert.ok(seen.some(({ url }) => /\/fields\?/.test(decodeURIComponent(url))), 'every other page still checks the list before its first write');
  });

  it('a second writer gets 412, however the two reads are made', async () => {
    fake.add('clients', { AppId: 'c-race', Name: 'Race' });
    const first = await ds.getClient('c-race');
    assert.ok(first);
    // Two people read the client; both change it; the second is refused where it would have overwritten the first, and the data layer's own read gets it through.
    fake.reset();
    let asked = 0;
    let wrote = 0;
    const merged = await ds.updateClientWith('c-race', (held) => {
      asked += 1;
      // The other writer comes in between this person's read and write, once.
      if (!wrote) { wrote += 1; const row = fake.lists.get('clients').find((each) => each.AppId === 'c-race'); row.__metadata = { ...row.__metadata, etag: '"999"' }; }
      return { name: `${held.name} changed` };
    });
    assert.equal(merged.name, 'Race changed');
    assert.equal(asked, 2, 'refused once with 412, read again and asked again');
    const merges = fake.requests.filter((entry) => entry.method === 'MERGE' && entry.list === 'clients');
    assert.equal(merges.length, 2);
    assert.ok(merges.every((entry) => entry.ifMatch && entry.ifMatch !== '*'), 'held to a version, never a blind overwrite');
  });

  it('removing answers is held to the version of the item, never a blind overwrite', async () => {
    fake.reset();
    await ds.saveParticipantResponses({ trackId: 't-v', sessionId: 's-v', clientId: 'c-v', responses: [{ questionId: 'q1', answer: 'a', firstAnswer: 'a', attempts: 1, correct: true, answeredAt: '2026-10-15T10:00:00.000Z' }] });
    fake.add('tracks', { AppId: 't-v', SessionId: 's-v', ClientId: 'c-v' });
    fake.reset();
    await ds.restartParticipantTrack('t-v');
    const merges = fake.requests.filter((entry) => entry.method === 'MERGE' && entry.list === 'responses');
    assert.ok(merges.length);
    assert.ok(merges.every((entry) => entry.ifMatch && entry.ifMatch !== '*'), 'held to a version');
  });

  it('a batch\'s parts ask for plain rows too, and the reader takes them', async () => {
    fake.add('sections', { AppId: 'sec-b', ClientId: 'c-b', Title: 'B' });
    const [sections, clients] = await ds.readLists([{ list: 'sections', where: { clientId: 'c-b' } }, { list: 'clients', where: { id: 'c-plain' } }]);
    assert.equal(sections[0].id, 'sec-b');
    assert.equal(clients[0].name, 'Plain');
    const batch = seen.find(({ url }) => url.endsWith('/$batch'));
    assert.match(batch.init.body, /Accept: application\/json;odata=nometadata/);
    assert.doesNotMatch(batch.init.body, /odata=verbose/);
  });

  it('who is signed in reads an expanded list of groups in the plain format', async () => {
    const me = await ds.readSignedInPerson();
    assert.equal(me.Id, 42);
    assert.equal(typeof me.owner, 'boolean');
  });
});
