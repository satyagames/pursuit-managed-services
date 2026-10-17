// Phase 10b: the list namespace in the data layer. A copy of the app has its own lists, told apart by a prefix on their titles
// (`listPrefix`), with any one list named on its own (`lists`). Run: node --test scripts/test-list-namespace.js (part of `npm test`).
//
// The mocked SharePoint (scripts/sharepoint-fake.js) holds BOTH a plain set of lists and a prefixed set, and answers a request to
// either: a request that goes to the set that is not the test's own succeeds, as it would on a real site with two copies of the
// app, and is recorded as a stray. So "no stray" here is the proof that a page with a prefix never touches the lists without one.
// It is not the real tenant: what a real site does with these titles has not been seen.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { bootParticipant } from '../migration/src/lib/participant/boot.js';
import { samplePack } from '../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../migration/src/lib/setup/seed.js';
import { schemaSpecs } from '../migration/src/lib/setup/setup-checks.js';
import { NODE_SUITES, differences, readBaseline, recordSuite } from './request-baseline.js';
import { LIBRARY_KEY, OTHER_PREFIX, TITLE, createSharePointFake } from './sharepoint-fake.js';

const ROOT = path.join(import.meta.dirname, '..');
const realFetch = globalThis.fetch;
const DAY = '2026-10-11';
const BASE_TITLES = Object.entries(TITLE).filter(([key]) => key !== LIBRARY_KEY).map(([, title]) => title);
after(() => { globalThis.fetch = realFetch; });

let pages = 0;
/** A page of its own on `fake`: the data service as a separate module, configured with what the fake says its settings are. */
async function pageOn(fake, extra = {}) {
  fake.install();
  const page = await import(`../migration/src/lib/data/dataService.js?namespace=${pages += 1}`);
  page.configure({ sharePoint: { ...fake.settings, ...extra } });
  return page;
}
const png = () => new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])], { type: 'image/png' });
/** Every list title a request named, in the requests and inside each batch. */
const titlesAsked = (fake) => new Set(fake.requests.flatMap((entry) => [entry, ...(entry.parts ?? [])]).map((entry) => entry.title).filter(Boolean));

/** A day's work, touching every list: seeding, going live, a staff visit, a guest's scan and answers, results, a picture, the checks. */
async function aDaysWork(fake, page) {
  await seedPack(page, samplePack());
  const { session } = await page.activateClient('c-kroger', DAY);
  const staff = await bootParticipant(page, { path: '/' });
  assert.equal(staff.experience.status, 'live');
  const visit = await page.beginVisit('visit-1', session.id, 'c-kroger', {});
  await page.recordParticipantVisit({ visitKey: 'visit-1', sessionId: session.id, clientId: 'c-kroger', page: 'participant', entryMode: 'staff' });
  await page.setSessionParticipationMode(session.id, 'client-visit');
  const visitor = await page.createVisitor({ sessionId: session.id, displayName: 'Jordan Lee', enabled: true });
  const token = await page.provisionQrToken('c-kroger', session.id, { visitorId: visitor.id });
  const guest = await (await page.openQrScan(token.id)).claim();
  await page.saveParticipantResponses({ trackId: guest.id, sessionId: session.id, clientId: 'c-kroger', responses: [{ questionId: 'q-trivia-1', answer: 'o-trivia-1-b', firstAnswer: 'o-trivia-1-b', attempts: 1, correct: true, answeredAt: `${DAY}T12:00:00.000Z` }] });
  await page.saveParticipantResponses({ trackId: visit.id, sessionId: session.id, clientId: 'c-kroger', responses: [{ questionId: 'q-trivia-2', answer: 'o-trivia-2-a', firstAnswer: 'o-trivia-2-a', attempts: 1, correct: false, answeredAt: `${DAY}T10:01:00.000Z` }] });
  await page.readParticipantWatch({ sessionId: session.id, trackId: guest.id, clientId: 'c-kroger' });
  await page.readLiveFeed(session.id, { sectionIds: session.sectionIds });
  await page.readActivityContent(await page.listClientSections('c-kroger'));
  await page.readSessionResponsesChecked(session.id);
  await page.listAdminUsers();
  await page.uploadClientAsset(png(), 'kroger-logo-0123456789.png');
  await page.checkSharePointLists();
  await page.checkSharePointSchema({ batch: true });
  await page.runParticipantSelfTest();
  await page.endSession(session.id);
  return { session, guest, token };
}

describe(`a copy with the prefix ${OTHER_PREFIX} uses its own lists and no others`, () => {
  it('a whole day (seed, go live, visits, a scan, answers, results, pictures, the checks) reaches the prefixed lists only', async () => {
    const fake = createSharePointFake({ prefix: OTHER_PREFIX });
    const page = await pageOn(fake);
    const { session, guest } = await aDaysWork(fake, page);

    assert.deepEqual(fake.strays.map((entry) => `${entry.method} ${entry.title}`), [], 'no request reached a list without the prefix');
    const asked = titlesAsked(fake);
    for (const title of asked) assert.ok(title.startsWith(OTHER_PREFIX), `${title} was asked for`);
    assert.deepEqual([...asked].sort(), [...BASE_TITLES, TITLE.logoLibrary].map((title) => OTHER_PREFIX + title).sort(), 'and all twelve lists and the picture library were used');
    // (Each set starts with the AppSettings item Setup makes: untouched, it is nothing a request left there.)
    const untouched = (row) => row.AppId === 'default' && row.Id === 100_000 && !('ActiveSessionId' in row);
    for (const [title, rows] of fake.otherLists) assert.equal(rows.filter((row) => !untouched(row)).length, 0, `${title} holds something`);
    assert.ok(fake.lists.get('clients').some((row) => row.AppId === 'c-kroger'));
    assert.equal(fake.item('appsettings', 'default').ActiveSessionId, session.id);
    assert.equal(fake.item('tracks', guest.id).__metadata.type, `SP.Data.${OTHER_PREFIX}${TITLE.tracks}ListItem`, 'the item type is the list\'s own, read from the site and never built from a title');
    assert.ok([...fake.files.keys()].every((file) => file.startsWith(`/sites/cec/${OTHER_PREFIX}${TITLE.logoLibrary}/`)), [...fake.files.keys()].join(', '));
    assert.equal(fake.files.size, 1, 'the Brand Studio upload went to the prefixed library (the older unnamed upload left the data layer in Phase 10c-1)');
  });

  it('the same day on the plain lists reaches none of the prefixed ones (the fake holds both sets either way)', async () => {
    const fake = createSharePointFake({ prefix: '' });
    await aDaysWork(fake, await pageOn(fake));
    assert.deepEqual(fake.strays.map((entry) => `${entry.method} ${entry.title}`), []);
    assert.deepEqual([...titlesAsked(fake)].sort(), [...BASE_TITLES, TITLE.logoLibrary].sort());
  });

  it('the check can fail: a page that has no prefix, on a site whose own lists have one, is caught as a stray and not as an error', async () => {
    const fake = createSharePointFake({ prefix: OTHER_PREFIX });
    const page = await pageOn(fake, { listPrefix: '' });
    assert.deepEqual(await page.listClients(), [], 'the request is answered: nothing would tell a person');
    assert.deepEqual(fake.strays.map((entry) => `${entry.method} ${entry.title}`), [`GET ${TITLE.clients}`]);
    assert.equal(fake.requests[0].stray, true);
    assert.equal(fake.requests[0].list, 'clients');
  });

  it('settings with no prefix at all are settings with an empty one: the same requests, to the character', async () => {
    const log = async (settings) => {
      const fake = createSharePointFake({ prefix: '' });
      fake.install();
      const page = await import(`../migration/src/lib/data/dataService.js?namespace=${pages += 1}`);
      page.configure({ sharePoint: settings(fake) });
      await seedPack(page, samplePack());
      const { session } = await page.activateClient('c-kroger', DAY);
      await bootParticipant(page, { path: '/' });
      await page.readLiveFeed(session.id, { sectionIds: session.sectionIds });
      await page.readActivityContent(await page.listClientSections('c-kroger'));
      await page.uploadClientAsset(png(), 'kroger-logo-0123456789.png');
      return fake.requests.map((entry) => `${entry.method} ${entry.url}${(entry.parts ?? []).map((part) => `\n  ${part.url}`).join('')}`);
    };
    const plain = await log((fake) => ({ siteUrl: fake.siteUrl }));
    assert.deepEqual(await log((fake) => ({ siteUrl: fake.siteUrl, listPrefix: '' })), plain);
    assert.deepEqual(await log((fake) => ({ siteUrl: fake.siteUrl, listPrefix: '', lists: {} })), plain);
    assert.ok(plain.length > 100);
  });
});

describe('a list that is named on its own', () => {
  it('lists: { qrtokens: "GuestCodes" } reaches that title only: neither QRTokens nor the prefixed QRTokens is asked for', async () => {
    const fake = createSharePointFake({ prefix: OTHER_PREFIX, lists: { qrtokens: 'GuestCodes' } });
    const page = await pageOn(fake);
    const { token } = await aDaysWork(fake, page);
    assert.deepEqual(fake.strays.map((entry) => `${entry.method} ${entry.title}`), []);
    const asked = titlesAsked(fake);
    assert.ok(asked.has('GuestCodes') && !asked.has(`${OTHER_PREFIX}${TITLE.qrtokens}`) && !asked.has(TITLE.qrtokens), [...asked].join(', '));
    assert.equal(fake.item('qrtokens', token.id).Used, true, 'the code was claimed in the list that was named');
    assert.equal(fake.otherLists.get(`${OTHER_PREFIX}${TITLE.qrtokens}`).length, 0);
    assert.equal(fake.otherLists.get(TITLE.qrtokens).length, 0);
    assert.deepEqual(page.sharePointListTitles().qrtokens, 'GuestCodes');
  });

  it('a title with an apostrophe or a space is sent as SharePoint needs it, and without a prefix the other lists keep their plain names', async () => {
    const fake = createSharePointFake({ prefix: '', lists: { adminusers: "Admin user's list" }, logoLibrary: 'Client Pictures' });
    const page = await pageOn(fake);
    fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: 'not-a-real-hash' });
    assert.deepEqual((await page.listAdminUsers()).map((user) => user.id), ['admin'], 'the list is found under its odd title');
    await page.uploadClientAsset(png(), 'kroger-logo-0123456789.png');
    assert.deepEqual(fake.strays, []);
    assert.ok(fake.requests.some((entry) => entry.url.includes("getbytitle('Admin%20user''s%20list')")), fake.requests.map((entry) => entry.url).join('\n'));
    assert.ok(fake.requests.some((entry) => entry.url.includes("getbytitle('Client%20Pictures')/RootFolder")));
    assert.ok([...fake.files.keys()][0].startsWith('/sites/cec/Client Pictures/'));
  });

  it('the picture library follows the prefix unless it is named: the two places that default it agree', async () => {
    for (const [options, library] of [[{ prefix: '' }, TITLE.logoLibrary], [{ prefix: OTHER_PREFIX }, `${OTHER_PREFIX}${TITLE.logoLibrary}`], [{ prefix: OTHER_PREFIX, logoLibrary: TITLE.logoLibrary }, TITLE.logoLibrary]]) {
      const fake = createSharePointFake(options);
      const page = await pageOn(fake);
      await page.uploadClientAsset(png(), 'kroger-logo-0123456789.png');
      assert.deepEqual(fake.strays.map((entry) => entry.title), [], JSON.stringify(options));
      assert.deepEqual([...new Set(fake.select((entry) => entry.path.includes('/RootFolder')).map((entry) => entry.title))], [library]);
      assert.equal(page.sharePointListTitles().logoLibrary, library);
    }
  });
});

describe('what the app says names the list a person will find on the site', () => {
  const open = async (options = {}) => {
    const fake = createSharePointFake({ prefix: OTHER_PREFIX, ...options });
    const page = await pageOn(fake);
    await seedPack(page, samplePack());
    const { session } = await page.activateClient('c-kroger', DAY);
    return { fake, page, session };
  };

  it('the self-test names the Responses list by its title when its AppId is not unique', async () => {
    const { fake, page } = await open();
    fake.fields.get('responses').find((field) => field.InternalName === 'AppId').EnforceUniqueValues = false;
    const steps = await page.runParticipantSelfTest();
    const duplicate = steps.find((step) => /second create/.test(step.name));
    assert.equal(duplicate.pass, false);
    assert.match(duplicate.detail, new RegExp(`turn on "Enforce unique values" for ${OTHER_PREFIX}${TITLE.responses}\\.AppId`));
  });

  it('a visit whose answers cannot be read names the Responses list by its title', async () => {
    const { fake, page, session } = await open();
    const track = await page.beginVisit(crypto.randomUUID(), session.id, 'c-kroger');
    await page.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: 'c-kroger', responses: [{ questionId: 'q-trivia-1', answer: 'o-trivia-1-b', firstAnswer: 'o-trivia-1-b', attempts: 1, correct: null, answeredAt: `${DAY}T12:00:00.000Z` }] });
    fake.lists.get('responses').find((row) => row.AppId === track.id).ResponsesJson = '{oops';
    await assert.rejects(page.removeEmptyVisit(track.id), (error) => error.code === 'visit-unreadable' && error.message.endsWith(`Correct or delete the damaged item in the ${OTHER_PREFIX}${TITLE.responses} list first.`));
  });

  it('a claim with no version to hold names the codes list by its title (read from the source: the fake always gives a version)', async () => {
    const source = await readFile(path.join(ROOT, 'migration/src/lib/data/dataService.js'), 'utf8');
    assert.match(source, /SharePoint did not return an ETag for \$\{spTitle\('qrtokens'\)\}\./);
    for (const spelled of ["list: 'Sections'", 'for Responses.AppId', 'an ETag for QRTokens', 'in the Responses list first']) {
      assert.ok(!source.includes(spelled), `the data layer still spells a title out: ${spelled}`);
    }
    assert.equal([...source.matchAll(/LISTS\[\w+\]\.title/g)].length, 1, 'one place reads a usual title (from the schema file): the function every title comes from');
    // (Three until Phase 10c-1: the third was the older upload with no name, which left with the legacy admin.)
    assert.equal([...source.matchAll(/getbytitle\(/g)].length, 2, 'two addresses name a list or the library by title: every list\'s, and the picture library\'s folder');
    assert.equal([...source.matchAll(/\$\{LIBRARY\}/g)].length, 1, 'and one place reads the library\'s usual title');
    assert.equal([...(await readFile(path.join(ROOT, 'migration/src/lib/schema/pms-schema.js'), 'utf8')).matchAll(new RegExp(`'${TITLE.logoLibrary}'`, 'g'))].length, 1, 'which the schema file holds');
  });

  it('a missing list, a missing column and a duplicate are reported under the title on this site', async () => {
    const missing = createSharePointFake({ prefix: OTHER_PREFIX, without: ['qrtokens', 'sections.ClientId'] });
    const page = await pageOn(missing);
    const report = await page.checkSharePointSchema();
    assert.deepEqual(report.map((entry) => entry.list).sort(), BASE_TITLES.map((title) => OTHER_PREFIX + title).sort());
    assert.equal(report.find((entry) => entry.list === `${OTHER_PREFIX}${TITLE.qrtokens}`).problems[0].problem, `The list "${OTHER_PREFIX}${TITLE.qrtokens}" does not exist.`);
    assert.deepEqual((await page.checkSharePointLists()).find((entry) => entry.list === `${OTHER_PREFIX}${TITLE.sections}`), { list: `${OTHER_PREFIX}${TITLE.sections}`, status: `${OTHER_PREFIX}${TITLE.sections} is missing the internal column ClientId. See SHAREPOINT-LISTS.md.` }, 'the older check stops at the first missing column, whichever it is (every column must exist)');
    await assert.rejects(page.createSection({ id: 's1', title: 'One', order: 1, enabled: true, industryTags: [], questionIds: [], clientId: 'c-kroger' }),
      (error) => error.message.startsWith(`${OTHER_PREFIX}${TITLE.sections} is missing the internal column ClientId`));
    missing.add('clients', { AppId: 'twice' });
    missing.add('clients', { AppId: 'twice' });
    await assert.rejects(page.getClient('twice'), new RegExp(`Duplicate AppId twice in ${OTHER_PREFIX}${TITLE.clients}\\.`));
  });
});

describe('Setup\'s check still finds each list when its title is not the usual one', () => {
  const flawed = async (options) => {
    const fake = createSharePointFake(options);
    // What a site owner might have made: a Yes/No kept as text, an index missing, and a column called Order0 (which is nothing of the app's).
    fake.fields.get('sections').find((field) => field.InternalName === 'Enabled').TypeAsString = 'Text';
    fake.fields.get('tracks').find((field) => field.InternalName === 'SessionId').Indexed = false;
    fake.fields.get('questions').push({ InternalName: 'Order0', TypeAsString: 'Number', Indexed: false, EnforceUniqueValues: false, RichText: false, AppendOnly: false, Required: false, ReadOnlyField: false });
    const page = await pageOn(fake);
    return (await page.checkSharePointSchema({ specs: schemaSpecs })).flatMap((entry) => entry.problems.map((problem) => `${entry.list}.${problem.column}: ${problem.problem}`));
  };

  it('with a prefix, and with a list named on its own, the same two problems appear, under the titles on the site', async () => {
    const plain = await flawed({ prefix: '' });
    assert.deepEqual([...plain].sort(), [`${TITLE.sections}.Enabled: Wrong type: it is Single line of text.`, `${TITLE.tracks}.SessionId: Not indexed.`]);
    const prefixed = await flawed({ prefix: OTHER_PREFIX });
    assert.deepEqual(prefixed, plain.map((line) => `${OTHER_PREFIX}${line}`));
    const named = await flawed({ prefix: OTHER_PREFIX, lists: { tracks: 'Visits', questions: 'Quiz questions' } });
    assert.deepEqual([...named].sort(), [`${OTHER_PREFIX}${TITLE.sections}.Enabled: Wrong type: it is Single line of text.`, 'Visits.SessionId: Not indexed.']);
  });
});

describe(`every mocked suite a second time, on ${OTHER_PREFIX} lists`, () => {
  // Each suite is run again with PMS_TEST_LIST_PREFIX: every fake it makes then has prefixed lists of its own (and still holds the
  // plain ones), and the suite configures the data layer with what the fake says its settings are. Three things are held. The suite
  // passes. It ends with no stray request, by its own last test: nothing reached a list without the prefix. And what it sent is, to
  // the character, what the baseline of Phase 10b's start holds once the prefix is taken off the titles again: the prefix is the only
  // thing that moved. (A negative control was run by hand and is in MIGRATION-PLAN.md: with one list made to forget its prefix, two of
  // these suites failed ONLY their no-stray test, which is what a page reading the wrong lists and working looks like.)
  const unprefixed = (recording) => {
    const plain = new Map();
    for (const [entry, count] of recording) {
      const key = entry.replaceAll(`getbytitle('${OTHER_PREFIX}`, "getbytitle('").replaceAll(`/${OTHER_PREFIX}${TITLE.logoLibrary}`, `/${TITLE.logoLibrary}`).replaceAll(`%2F${OTHER_PREFIX}${TITLE.logoLibrary}`, `%2F${TITLE.logoLibrary}`);
      plain.set(key, (plain.get(key) ?? 0) + count);
    }
    return plain;
  };
  // (test-sharepoint.js is the legacy functions on stubs of its own: it has no fake and so no second set of lists.)
  const SECOND_RUN = NODE_SUITES.filter((name) => name !== 'test-sharepoint');
  const recordings = new Map(SECOND_RUN.map((name) => [name, recordSuite(name, { PMS_TEST_LIST_PREFIX: OTHER_PREFIX })]));
  for (const name of SECOND_RUN) {
    it(`scripts/${name}.js: passes, with no stray, and sends the baseline's requests under the prefixed titles`, async () => {
      const recording = await recordings.get(name);
      const named = [...recording.keys()].flatMap((entry) => [...entry.matchAll(/getbytitle\('([^']+)'\)/g)].map((match) => match[1]));
      assert.deepEqual([...new Set(named.filter((title) => !title.startsWith(OTHER_PREFIX) && title !== 'Missing%20Library'))], [], 'a request named a list without the prefix');
      const found = differences(await readBaseline(name), unprefixed(recording));
      assert.deepEqual(found, [], `${found.length} difference(s) from the baseline with the prefix taken off:\n\n${found.join('\n\n')}\n`);
    });
  }
});
