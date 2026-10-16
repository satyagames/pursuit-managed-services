// The sample clients (Kroger, Domino's): what the pack contains, that seeding is idempotent and
// never overwrites, that the local server data holds the same pack, and how a stored theme is
// turned into what the participant page applies.  Run: npm run test:seeds
import assert from 'node:assert/strict';
import { freePort } from './free-port.js';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as ds from '../public/js/dataService.js';
import { buildClientTheme, resolveClientTheme, safeImageUrl } from '../migration/src/lib/client-theme.js';
import { samplePack } from '../migration/src/lib/sample-clients.js';
import { localSamplePack } from '../migration/src/lib/sample-seed.js';
import { FILLABLE, seedPack } from '../migration/src/lib/seed.js';
import {
  CONTROL_TOKENS, DANGER_HUE_MARGIN, DEFAULT_PRIMARY, SURFACE_ALPHA, compositeOver, contrastRatio, dangerHueDistance, deriveTheme, isNearDangerHue,
} from '../migration/src/lib/theme.js';
import { STRAYS, TITLE, UNINDEXED, createSharePointFake } from './sharepoint-fake.js';

const ROOT = path.join(import.meta.dirname, '..');
const realFetch = globalThis.fetch;
const COUNT = { clients: 2, sections: 4, questions: 14, options: 56 };
const TOTAL = Object.values(COUNT).reduce((sum, value) => sum + value, 0);
const tally = (results) => Object.fromEntries(['Created', 'Completed', 'Skipped existing'].map((status) => [status, results.filter((result) => result.status === status).length]));

function sharePoint() {
  const fake = createSharePointFake();
  fake.install();
  ds.configure({ sharePoint: fake.settings });
  return fake;
}

const servers = [];
/** The real local server on `dataDir`. */
async function localServer(dataDir) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  servers.push(child);
  await new Promise((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
    child.stdout.on('data', (chunk) => String(chunk).includes('running') && resolve());
  });
  globalThis.fetch = realFetch;
  ds.configure({ baseUrl: `http://localhost:${port}/api` });
}

let scratch;
before(async () => { scratch = await mkdtemp(path.join(os.tmpdir(), 'cec-seeds-')); });
after(async () => {
  for (const child of servers) child.kill();
  globalThis.fetch = realFetch;
  ds.configure({ baseUrl: '/api' });
  await rm(scratch, { recursive: true, force: true });
});

// ---- What the pack says ---------------------------------------------------------------------------

describe('the sample pack', () => {
  const pack = samplePack();
  const optionsOf = (questionId) => pack.questions.find((question) => question.id === questionId).optionIds.map((id) => pack.options.find((option) => option.id === id));
  const rightAnswer = (questionId) => optionsOf(questionId).filter((option) => option.correct === true).map((option) => option.label);
  const sectionsOf = (clientId) => pack.sections.filter((section) => section.clientId === clientId).sort((a, b) => a.order - b.order);

  it('is internally consistent: unique ids, links both ways, one right answer per question', () => {
    for (const [list, count] of Object.entries(COUNT)) {
      assert.equal(pack[list].length, count, list);
      assert.equal(new Set(pack[list].map((record) => record.id)).size, count, `${list} ids are unique`);
    }
    for (const section of pack.sections) {
      assert.ok(pack.clients.some((client) => client.id === section.clientId));
      for (const id of section.questionIds) assert.equal(pack.questions.find((question) => question.id === id).sectionId, section.id);
    }
    for (const question of pack.questions) {
      const options = optionsOf(question.id);
      assert.equal(options.length, 4);
      assert.ok(options.every((option) => option.questionId === question.id));
      assert.equal(options.filter((option) => option.correct === true).length, 1, question.id);
      assert.ok(options.every((option) => option.value !== '' && String(Number(option.value)) !== option.value), 'a value SharePoint would hand back as a number');
    }
    assert.notEqual(samplePack(), samplePack(), 'each call is a fresh copy');
  });

  it("Kroger is the mockup: its palette, its event copy, question 1, Guess the Brand, and the earlier questions 2 to 5", () => {
    const kroger = pack.clients.find((client) => client.id === 'c-kroger');
    assert.equal(kroger.slug, 'kroger');
    assert.deepEqual(kroger.theme.tokens, deriveTheme(DEFAULT_PRIMARY).tokens, 'the mockup palette, exactly');
    assert.deepEqual(kroger.theme.copy, {
      eventTitle: 'Kroger Trivia Night',
      eventSubtitle: "Celebrating 140+ years of Kroger's history and the people who built them.",
      welcomeLine: 'Welcome to the Kroger experience.',
      logoText: 'Kroger',
    });
    assert.deepEqual(sectionsOf('c-kroger').map((section) => section.title), ["Kroger's History", 'Guess the Brand']);
    const [history, brand] = sectionsOf('c-kroger');
    assert.equal(history.description, "Celebrating 140+ years of Kroger's history and the people who built them.");
    assert.equal(brand.description, 'Solve the hints the best you can and spot the right Kroger brand!');
    assert.deepEqual(history.questionIds, ['q-trivia-1', 'q-trivia-2', 'q-trivia-3', 'q-trivia-4', 'q-trivia-5']);
    const first = pack.questions.find((question) => question.id === 'q-trivia-1');
    assert.equal(first.prompt, 'In 1883, Barney Kroger and his friend B.A. Branagan rented a storefront and started operations. What was the name of their first store?');
    assert.deepEqual(optionsOf('q-trivia-1').map((option) => option.label), ['Kroger grocery and Baking co.', 'Great Western Tea co.', "Kroger's", 'Kroger']);
    assert.deepEqual(rightAnswer('q-trivia-1'), ['Great Western Tea co.']);
    assert.deepEqual(['q-trivia-2', 'q-trivia-3', 'q-trivia-4', 'q-trivia-5'].flatMap(rightAnswer), ['66 Pearl Street, Cincinnati', 'Bakery', 'Food processing at Kroger', 'Door to Door Deliveries']);
    const guess = pack.questions.find((question) => question.id === 'q-brand-1');
    assert.equal(guess.prompt, 'When work runs long and plans go stray, Kroger helps home-cooked meals find their way.');
    assert.equal(guess.layout, 'image-grid');
    assert.deepEqual(optionsOf('q-brand-1').map((option) => option.label), ['Kroger', 'Home Chef', 'Bloom Haus', 'Smart Way']);
    assert.deepEqual(rightAnswer('q-brand-1'), ['Home Chef']);
    assert.ok(optionsOf('q-brand-1').every((option) => option.imageUrl === null), 'text tiles until logos are uploaded');
  });

  it("Domino's is the full pack: slug, colours, event copy, 5 + 3 questions, text tiles, and no logo", () => {
    const dominos = pack.clients.find((client) => client.id === 'c-dominos');
    assert.equal(dominos.name, "Domino's");
    assert.equal(dominos.slug, 'dominos');
    assert.equal(ds.slugify(dominos.name), 'dominos');
    assert.deepEqual([dominos.theme.primary, dominos.theme.accent], ['#0B648F', '#E21737']);
    assert.deepEqual([dominos.theme.tokens['--bg-mid'], dominos.theme.tokens['--action']], ['#0B648F', deriveTheme('#0B648F').tokens['--action']], 'the buttons follow the primary, not the accent');
    assert.ok(contrastRatio('#FFFFFF', dominos.theme.tokens['--action']) >= 4.5);
    assert.deepEqual([dominos.theme.tokens['--accent-rule'], dominos.theme.tokens['--accent-ring']], ['#FFFFFF', '#E21737'], 'the red accent shows as the ring on the white plate only');
    assert.deepEqual(dominos.theme.copy, {
      eventTitle: "Domino's Trivia Night",
      eventSubtitle: "Celebrating 65+ years of Domino's history and the people who built it.",
      welcomeLine: "Welcome to the Domino's experience.",
      logoText: "Domino's",
    });
    assert.equal(dominos.logoUrl, null, 'no logo file in the pack itself: the seed adds the pictures (scripts/test-sample-pictures.js)');
    assert.deepEqual(dominos.theme.assets, { hero: null, logo: null, background: null, tile: null });
    assert.equal(JSON.stringify(dominos).includes('data:image'), false, 'and nothing drawn in its place');

    const [history, innovation] = sectionsOf('c-dominos');
    assert.deepEqual([history.title, history.description, history.questionIds.length], ["Domino's History", "How well do you know the Domino's story?", 5]);
    assert.deepEqual([innovation.title, innovation.description, innovation.questionIds.length], ['Guess the Innovation', "Read the clue and spot the right Domino's innovation!", 3]);
    assert.deepEqual(history.questionIds.flatMap(rightAnswer), ['Michigan', 'Winnipeg, Canada', "Domino's Tracker", '2007', 'A purpose-built delivery vehicle']);
    assert.deepEqual(innovation.questionIds.flatMap(rightAnswer), ["Domino's Tracker", 'Carside Delivery', 'DXP']);
    for (const id of innovation.questionIds) {
      assert.equal(pack.questions.find((question) => question.id === id).layout, 'image-grid');
      assert.deepEqual(optionsOf(id).map((option) => option.label), ["Domino's Tracker", 'Carside Delivery', 'DXP', 'Pizza Profiles']);
      assert.ok(optionsOf(id).every((option) => option.imageUrl === null));
    }
    // The right answer is not always in the same place.
    const positions = history.questionIds.map((id) => optionsOf(id).findIndex((option) => option.correct));
    assert.ok(new Set(positions).size >= 3, `positions ${positions}`);
  });

  it('ThemeJson has the agreed shape and fits its column with a wide margin', () => {
    for (const client of pack.clients) {
      // (`sample` is the marker lib/sample-notice.js reads, Phase 9b; no page that paints reads it.)
      assert.deepEqual(Object.keys(client.theme), ['version', 'primary', 'accent', 'tokens', 'assets', 'copy', 'sample']);
      assert.deepEqual(client.theme.sample, { source: 'Seed sample clients' });
      assert.deepEqual(Object.keys(client.theme.assets), ['hero', 'logo', 'background', 'tile']);
      assert.deepEqual(Object.keys(client.theme.copy), ['eventTitle', 'eventSubtitle', 'welcomeLine', 'logoText']);
      assert.equal(client.theme.version, client.themeVersion);
      assert.equal(client.status, 'active');
      assert.ok(JSON.stringify(client.theme).length < 2000);
      assert.equal(resolveClientTheme(client).source, 'stored');
    }
  });
});

// ---- Seeding --------------------------------------------------------------------------------------

describe('seeding', () => {
  it('creates the whole pack on an empty site, and a second run creates nothing and writes nothing', async () => {
    const fake = sharePoint();
    const first = await seedPack(ds, samplePack());
    assert.deepEqual(tally(first), { Created: TOTAL, Completed: 0, 'Skipped existing': 0 });
    assert.deepEqual(Object.fromEntries(['clients', 'sections', 'questions', 'options'].map((list) => [list.toLowerCase(), fake.lists.get(list).length])), COUNT);
    fake.reset();
    const seen = [];
    const second = await seedPack(ds, samplePack(), (result) => seen.push(result));
    assert.deepEqual(tally(second), { Created: 0, Completed: 0, 'Skipped existing': TOTAL });
    assert.equal(fake.count((entry) => entry.method !== 'GET'), 0, 'not one write');
    assert.equal(fake.count(), 4, 'four list reads are all it takes to find nothing missing');
    assert.equal(seen.length, TOTAL);
    assert.deepEqual(Object.fromEntries(['clients', 'sections', 'questions', 'options'].map((list) => [list.toLowerCase(), fake.lists.get(list).length])), COUNT);
  });

  it('never overwrites: an edited question, answer, activity and client survive a re-run untouched', async () => {
    const fake = sharePoint();
    await seedPack(ds, samplePack());
    await ds.updateQuestion('q-dominos-history-1', { prompt: 'Where did the first store open?', layout: 'image-grid' });
    await ds.updateOption('o-dominos-history-1-b', { label: 'Michigan (Ypsilanti)', correct: false, imageUrl: 'https://example.test/mi.png' });
    await ds.updateOption('o-dominos-history-1-a', { correct: true });
    await ds.updateSection('sec-dominos-history', { title: 'Our History', description: '', enabled: false, questionIds: ['q-dominos-history-1'] });
    await ds.updateClient('c-dominos', { name: "Domino's Pizza", status: 'archived', themeVersion: 7, theme: { version: 7, primary: '#123456', copy: { eventTitle: 'Edited Night' } } });
    await ds.deleteQuestion('q-dominos-history-5'); // a deletion is an edit too... but a missing record IS recreated: see below
    const before = JSON.stringify([...fake.lists.entries()].map(([list, rows]) => [list, rows.map(({ __metadata, ...row }) => row)]));

    const again = await seedPack(ds, samplePack());
    assert.deepEqual(tally(again), { Created: 1, Completed: 1, 'Skipped existing': TOTAL - 2 });
    assert.deepEqual(again.filter((result) => result.status !== 'Skipped existing'), [
      { list: TITLE.questions, id: 'q-dominos-history-5', status: 'Created' }, // create-if-missing puts a deleted sample record back
      { list: TITLE.sections, id: 'sec-dominos-history', status: 'Completed' }, // its description had been emptied, and empty is all it fills
    ]);
    assert.equal((await ds.getQuestion('q-dominos-history-1')).prompt, 'Where did the first store open?');
    assert.equal((await ds.getQuestion('q-dominos-history-1')).layout, 'image-grid');
    assert.deepEqual((({ label, correct, imageUrl }) => [label, correct, imageUrl])(await ds.getOption('o-dominos-history-1-b')), ['Michigan (Ypsilanti)', false, 'https://example.test/mi.png']);
    assert.equal((await ds.getOption('o-dominos-history-1-a')).correct, true);
    const section = await ds.getSection('sec-dominos-history');
    assert.deepEqual([section.title, section.enabled, section.questionIds], ['Our History', false, ['q-dominos-history-1']]);
    const client = await ds.getClient('c-dominos');
    assert.deepEqual([client.name, client.status, client.themeVersion, client.theme.copy.eventTitle, client.theme.primary], ["Domino's Pizza", 'archived', 7, 'Edited Night', '#123456']);
    // Apart from the two results above, the site is byte for byte what it was.
    const strip = (snapshot) => JSON.parse(snapshot).map(([list, rows]) => [list, rows.filter((row) => row.AppId !== 'q-dominos-history-5' && row.AppId !== 'sec-dominos-history')]);
    const afterRun = JSON.stringify([...fake.lists.entries()].map(([list, rows]) => [list, rows.map(({ __metadata, ...row }) => row)]));
    assert.deepEqual(strip(afterRun), strip(before));
  });

  it('on a site with the earlier starter content it fills only the empty new fields, and creates only what is missing', async () => {
    const fake = sharePoint();
    // The Kroger records as the earlier import left them: older wording, and none of the new columns' values.
    await ds.createClient({ id: 'c-kroger', name: 'Kroger', logoUrl: '/assets/images/clients/kroger-logo.svg', primaryColor: '#0060A9', secondaryColor: '#E31837' });
    await ds.createSection({ id: 'sec-trivia', title: 'Industry Trivia', order: 3, enabled: true, industryTags: ['retail'], questionIds: ['q-trivia-1', 'q-trivia-2', 'q-trivia-3', 'q-trivia-4', 'q-trivia-5'] });
    await ds.createQuestion({ id: 'q-trivia-1', sectionId: 'sec-trivia', type: 'single-select', prompt: "'In 1883, the old wording", optionIds: ['o-trivia-1-a', 'o-trivia-1-b', 'o-trivia-1-c', 'o-trivia-1-d'], order: 1 });
    await ds.createOption({ id: 'o-trivia-1-b', questionId: 'q-trivia-1', label: "'Great Western Tea Co.", value: 'great-western-tea-co', correct: true });

    const results = await seedPack(ds, samplePack());
    assert.deepEqual(tally(results), { Created: TOTAL - 4, Completed: 3, 'Skipped existing': 1 });
    assert.deepEqual(results.filter((result) => result.status !== 'Created').map((result) => `${result.id}: ${result.status}`), [
      'c-kroger: Completed', 'o-trivia-1-b: Skipped existing', 'q-trivia-1: Completed', 'sec-trivia: Completed',
    ]);
    const client = await ds.getClient('c-kroger');
    assert.deepEqual([client.slug, client.status, client.themeVersion, client.theme.copy.eventTitle, client.primaryColor], ['kroger', 'active', 1, 'Kroger Trivia Night', '#0060A9']);
    const section = await ds.getSection('sec-trivia');
    assert.deepEqual([section.title, section.order, section.clientId], ['Industry Trivia', 3, 'c-kroger'], 'its name and place are the admin\'s; only the empty client was filled');
    assert.equal(section.description, "Celebrating 140+ years of Kroger's history and the people who built them.");
    assert.deepEqual((({ prompt, layout }) => [prompt, layout])(await ds.getQuestion('q-trivia-1')), ["'In 1883, the old wording", 'text-list']);
    assert.equal((await ds.getOption('o-trivia-1-b')).label, "'Great Western Tea Co.");
    assert.equal(fake.item('options', 'o-trivia-1-b').ImageUrl, undefined, 'an empty field with nothing to put in it is left alone');
    assert.deepEqual(tally(await seedPack(ds, samplePack())), { Created: 0, Completed: 0, 'Skipped existing': TOTAL });
    // Only the fields that did not exist before are ever filled.
    assert.deepEqual(FILLABLE, { clients: ['slug', 'theme', 'themeVersion', 'status'], sections: ['clientId', 'description'], questions: ['layout'], options: ['imageUrl'] });
  });

  it('two admins seeding at the same moment create each record once', async () => {
    const fake = sharePoint();
    const [left, right] = await Promise.all([seedPack(ds, samplePack()), seedPack(ds, samplePack())]);
    assert.deepEqual(Object.fromEntries(['clients', 'sections', 'questions', 'options'].map((list) => [list.toLowerCase(), fake.lists.get(list).length])), COUNT);
    assert.equal(tally(left).Created + tally(right).Created, TOTAL);
    for (const list of ['clients', 'sections', 'questions', 'options']) {
      assert.equal(new Set(fake.lists.get(list).map((row) => row.AppId)).size, fake.lists.get(list).length);
    }
  });

  it('a failure part-way leaves what was created, and the next run finishes the job', async () => {
    const fake = sharePoint();
    fake.failNext({ status: 403, message: 'Access denied.', when: (entry) => entry.method === 'POST' && entry.list === 'questions' });
    await assert.rejects(seedPack(ds, samplePack()), /Access denied/);
    assert.equal(fake.lists.get('options').length, COUNT.options);
    assert.equal(fake.lists.get('sections').length, 0, 'no activity was created ahead of its questions');
    const retry = await seedPack(ds, samplePack());
    assert.deepEqual(tally(retry), { Created: COUNT.questions + COUNT.sections, Completed: 0, 'Skipped existing': COUNT.clients + COUNT.options });
  });
});

// ---- The local server data ------------------------------------------------------------------------

describe('the local server data holds the same pack', () => {
  const dataFile = async (dir, name) => JSON.parse(await readFile(path.join(dir, `${name}.json`), 'utf8'));

  it('every pack record is in server/data, field for field (the clients with their pictures at the local server\'s address, Phase 10f)', async () => {
    const pack = localSamplePack();
    for (const list of Object.keys(COUNT)) {
      const stored = new Map((await dataFile(path.join(ROOT, 'server', 'data'), list)).map((record) => [record.id, record]));
      for (const record of pack[list]) assert.deepEqual(stored.get(record.id), record, `${list} ${record.id}`);
    }
  });

  it('holds no test fixture: the two sample clients, an empty roster and nothing live, and no name a test made up', async () => {
    const dir = path.join(ROOT, 'server', 'data');
    assert.deepEqual((await dataFile(dir, 'clients')).map((client) => client.id).sort(), ['c-dominos', 'c-kroger']);
    for (const list of ['appsettings', 'visitorroster', 'uservisitlogs', 'participantresponses']) assert.deepEqual(await dataFile(dir, list), [], `${list} starts empty`);
    // The names the browser tests create in their own scratch copy of this folder; they must never be in the committed one.
    const fixtures = ['Blocked Co', 'Draft Co', 'Spare Co', 'Acme Foods', 'Brightside Grocers', 'Guest 0', 'Loose ', 'Pasted ', 'Menu Deep Dive'];
    for (const file of await readdir(dir)) {
      const text = await readFile(path.join(dir, file), 'utf8');
      for (const fixture of fixtures) assert.ok(!text.includes(fixture), `${file} holds the test fixture "${fixture}"`);
    }
    // An upload from a test run lands in the scratch folder, not here: public/assets/images/clients holds nothing a test made.
    const uploads = (await readdir(path.join(ROOT, 'public', 'assets', 'images', 'clients'))).filter((name) => name.startsWith('upload-'));
    assert.deepEqual(uploads, [], 'no uploaded test logo is left in public/');
  });

  it('seeding the committed data creates nothing and changes no file', async () => {
    const dir = path.join(scratch, 'committed');
    await cp(path.join(ROOT, 'server', 'data'), dir, { recursive: true });
    const snapshot = async () => Object.fromEntries(await Promise.all((await readdir(dir)).sort().map(async (file) => [file, await readFile(path.join(dir, file), 'utf8')])));
    const before = await snapshot();
    await localServer(dir);
    assert.deepEqual(tally(await seedPack(ds, samplePack())), { Created: 0, Completed: 0, 'Skipped existing': TOTAL });
    assert.deepEqual(await snapshot(), before);
    // Kroger's three older activities belong to Kroger too, so nothing in the local data is unowned.
    assert.deepEqual((await ds.listSections()).filter((section) => !section.clientId), []);
    assert.deepEqual((await ds.listClientSections('c-kroger')).map((section) => section.title), ["Kroger's History", 'Guess the Brand', 'Confidence Continuum', 'Open Feedback', 'Straight Talk']);
    assert.deepEqual((await ds.listClientSections('c-dominos')).map((section) => section.title), ["Domino's History", 'Guess the Innovation']);
  });

  it('on an empty local server it creates the same records as on SharePoint, and twice creates nothing new', async () => {
    const dir = path.join(scratch, 'empty');
    await cp(path.join(ROOT, 'server', 'data', 'adminusers.json'), path.join(dir, 'adminusers.json'), { recursive: true });
    await localServer(dir);
    assert.deepEqual(tally(await seedPack(ds, samplePack())), { Created: TOTAL, Completed: 0, 'Skipped existing': 0 });
    assert.deepEqual(tally(await seedPack(ds, samplePack())), { Created: 0, Completed: 0, 'Skipped existing': TOTAL });
    const read = async () => ({
      clients: await ds.listClients(), sections: (await ds.listSections()).sort((a, b) => a.id.localeCompare(b.id)),
      questions: (await ds.listQuestions()).sort((a, b) => a.id.localeCompare(b.id)), options: (await ds.listOptions()).sort((a, b) => a.id.localeCompare(b.id)),
    });
    const local = await read();
    sharePoint();
    await seedPack(ds, samplePack());
    assert.deepEqual(await read(), local, 'both backends hand back identical records');
    const pack = samplePack();
    assert.deepEqual(local.clients, pack.clients);
    assert.deepEqual(local.options, [...pack.options].sort((a, b) => a.id.localeCompare(b.id)));
  });
});

// ---- From a stored theme to the page --------------------------------------------------------------

describe('a stored theme', () => {
  const kroger = () => samplePack().clients[0];
  const dominos = () => samplePack().clients[1];

  it('is applied as stored: the resolved tokens, the copy, and the assets', () => {
    const theme = resolveClientTheme(dominos());
    assert.equal(theme.source, 'stored');
    assert.equal(theme.version, 1);
    assert.deepEqual(theme.tokens, deriveTheme('#0B648F', '#E21737').tokens);
    assert.equal(theme.copy.eventTitle, "Domino's Trivia Night");
    assert.equal(theme.copy.logoText, "Domino's");
    assert.deepEqual(theme.assets, { hero: null, logo: null, background: null, tile: null });
    assert.equal(resolveClientTheme(kroger()).assets.logo, null, 'Phase 9b: Kroger ships with no logo, so its name shows in type');
    assert.equal(resolveClientTheme({ ...kroger(), logoUrl: '/assets/images/clients/acme-logo.png' }).assets.logo, '/assets/images/clients/acme-logo.png', "with no logo in the theme, the client's own logoUrl is the logo");
  });

  it('whose version has moved on is not trusted: the colours are derived again', () => {
    const client = { ...dominos(), themeVersion: 2 };
    client.theme.tokens['--bg-mid'] = '#111111';
    const theme = resolveClientTheme(client);
    assert.equal(theme.source, 'derived');
    assert.equal(theme.version, 2);
    assert.equal(theme.tokens['--bg-mid'], '#0B648F');
  });

  it('with an unknown or unsafe token is not applied at all', () => {
    for (const [name, value] of [['--bg-mid', 'url(javascript:alert(1))'], ['--evil', '#000000'], ['--action', 'red; background: url(x)']]) {
      const client = dominos();
      client.theme.tokens[name] = value;
      const theme = resolveClientTheme(client);
      assert.equal(theme.source, 'derived', `${name}: ${value}`);
      assert.deepEqual(theme.tokens, deriveTheme('#0B648F', '#E21737').tokens);
    }
  });

  it('that is missing means the default look (the older PrimaryColor is not carried over), and never throws', () => {
    assert.deepEqual(resolveClientTheme({ name: 'Plain', primaryColor: '#008044' }).tokens, deriveTheme(DEFAULT_PRIMARY).tokens);
    assert.equal(resolveClientTheme({ name: 'Plain', primaryColor: '#008044' }).source, 'default');
    assert.equal(resolveClientTheme({ name: 'Plain', primaryColor: '#008044' }).copy.welcomeLine, 'Welcome to the Plain experience.');
    // Stored colours without usable tokens are still honoured: the palette is derived from them.
    assert.deepEqual(resolveClientTheme({ name: 'Plain', theme: { primary: '#008044' } }).tokens, deriveTheme('#008044').tokens);
    assert.equal(resolveClientTheme({ name: 'Plain', theme: { primary: '#008044' } }).source, 'derived');
    for (const client of [null, undefined, {}, { theme: 'not an object' }, { theme: [] }, { primaryColor: 'blue' }, { theme: { primary: 'nope', tokens: 7, copy: 3, assets: 'x' } }]) {
      const theme = resolveClientTheme(client);
      assert.deepEqual(theme.tokens, deriveTheme(DEFAULT_PRIMARY).tokens);
      assert.equal(theme.source, 'default');
      assert.deepEqual(theme.copy, { eventTitle: '', eventSubtitle: '', welcomeLine: '', logoText: '' });
    }
  });

  it('partial stored tokens are completed from the derived palette', () => {
    const client = dominos();
    client.theme.tokens = { '--bg-bottom': '#123456' };
    const theme = resolveClientTheme(client);
    assert.equal(theme.source, 'stored');
    assert.equal(theme.tokens['--bg-bottom'], '#123456');
    assert.equal(theme.tokens['--bg-mid'], '#0B648F');
  });

  it('only lets picture addresses through', () => {
    assert.equal(safeImageUrl('https://site.example/logo.png'), 'https://site.example/logo.png');
    assert.equal(safeImageUrl(' /sites/cec/ClientLogos/logo.png '), '/sites/cec/ClientLogos/logo.png');
    assert.equal(safeImageUrl('assets/images/clients/kroger-logo.svg'), 'assets/images/clients/kroger-logo.svg');
    assert.equal(safeImageUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'file:///etc/passwd', '', null, 42]) assert.equal(safeImageUrl(bad), null, String(bad));
    const client = dominos();
    client.theme.assets = { hero: 'javascript:alert(1)', background: 'https://site.example/bg.jpg' };
    assert.deepEqual(resolveClientTheme(client).assets, { hero: null, logo: null, background: 'https://site.example/bg.jpg', tile: null });
  });

  it('is built at save time with tokens that already pass contrast', () => {
    const theme = buildClientTheme({ primary: '#7FD1FF', accent: '#FFE600', version: 4, copy: { eventTitle: 'Light Night' } });
    assert.equal(theme.version, 4);
    assert.deepEqual([theme.primary, theme.accent], ['#7FD1FF', '#FFE600'], 'the choices are kept as chosen');
    assert.notEqual(theme.tokens['--bg-mid'], '#7FD1FF', 'while the stored token is the darkened, readable one');
    assert.ok(contrastRatio('#FFFFFF', theme.tokens['--action']) >= 4.5);
    assert.deepEqual(theme.copy, { eventTitle: 'Light Night', eventSubtitle: '', welcomeLine: '', logoText: '' });
    assert.equal(resolveClientTheme({ name: 'Light', themeVersion: 4, theme }).source, 'stored');
  });
});

// ---- The accent never drives a control -------------------------------------------------------------

describe('no control is filled with the accent, or with anything near the wrong-answer red', () => {
  const WHITE = '#FFFFFF';
  /** Every colour a control is filled with, for a set of resolved tokens: the CTA, a locked pill, and a pill or tile over the page. */
  const controlFills = (tokens) => ({
    '--action': tokens['--action'],
    '--disabled': tokens['--disabled'],
    '--surface over --bg-mid': compositeOver(WHITE, SURFACE_ALPHA, tokens['--bg-mid']),
    '--surface over --bg-bottom': compositeOver(WHITE, SURFACE_ALPHA, tokens['--bg-bottom']),
  });
  const seededClients = async () => [
    ...samplePack().clients.map((client) => [`sample pack ${client.id}`, client]),
    ...JSON.parse(await readFile(path.join(ROOT, 'server', 'data', 'clients.json'), 'utf8')).map((client) => [`server/data ${client.id}`, client]),
  ];

  it('for every seeded client, every control fill is more than 30 degrees from the danger hue', async () => {
    const clients = await seededClients();
    assert.ok(clients.length >= 4);
    for (const [where, client] of clients) {
      const { tokens } = resolveClientTheme(client);
      assert.equal(tokens['--danger'], '#E00000');
      for (const [name, fill] of Object.entries(controlFills(tokens))) {
        assert.ok(dangerHueDistance(fill) > DANGER_HUE_MARGIN, `${where}: ${name} is ${fill}, ${dangerHueDistance(fill).toFixed(0)} degrees from the wrong-answer red`);
      }
      assert.ok(contrastRatio(WHITE, tokens['--action']) >= 4.5, `${where}: white on the CTA`);
    }
  });

  it("Domino's has a red accent, and no control wears it", async () => {
    for (const [where, client] of (await seededClients()).filter(([, entry]) => entry.id === 'c-dominos')) {
      assert.equal(client.theme.accent, '#E21737');
      assert.equal(isNearDangerHue(client.theme.accent), true, 'the accent itself is one Brand Studio must warn about');
      const { tokens } = resolveClientTheme(client);
      for (const name of CONTROL_TOKENS) {
        assert.notEqual(tokens[name], '#E21737', `${where}: ${name}`);
        assert.equal(tokens[name], deriveTheme('#0B648F').tokens[name], `${where}: ${name} comes from the primary`);
      }
      assert.equal(tokens['--action'], '#256C96');
    }
  });

  it('a theme stored when the accent still coloured the buttons cannot bring that back, and neither can any stored token', () => {
    // What Phase 4 stored for Domino's: --action was the accent.
    const old = samplePack().clients[1];
    old.theme.tokens = { ...old.theme.tokens, '--action': '#E21737' };
    delete old.theme.tokens['--accent-rule'];
    delete old.theme.tokens['--accent-ring'];
    const theme = resolveClientTheme(old);
    assert.equal(theme.source, 'stored');
    assert.equal(theme.tokens['--action'], '#256C96');
    assert.deepEqual([theme.tokens['--accent-rule'], theme.tokens['--accent-ring']], ['#FFFFFF', '#E21737'], 'and the tokens it never had are derived');
    // Any control token, set to anything valid: ignored. Controls follow the page colour that is painted.
    for (const name of CONTROL_TOKENS) {
      const client = samplePack().clients[1];
      client.theme.tokens[name] = '#E00000';
      assert.equal(resolveClientTheme(client).tokens[name], deriveTheme('#0B648F').tokens[name], name);
    }
    const repainted = samplePack().clients[1];
    repainted.theme.tokens['--bg-mid'] = '#008044';
    assert.equal(resolveClientTheme(repainted).tokens['--action'], deriveTheme('#008044').tokens['--action'], 'a stored page colour takes its own controls with it');
  });

  it('only the divider and the logo plate read the accent tokens, and no component reads a theme\'s accent itself', async () => {
    const files = [];
    const walk = async (dir) => {
      for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
        if (entry.isDirectory()) await walk(path.join(dir, entry.name));
        else if (/\.(svelte|css|ts|js)$/.test(entry.name)) files.push(path.join(dir, entry.name).split(path.sep).join('/'));
      }
    };
    await walk('migration/src');
    const readers = [];
    const accentReaders = [];
    for (const file of files) {
      const text = await readFile(path.join(ROOT, file), 'utf8');
      if (/var\(\s*--accent-(?:rule|ring)/.test(text)) readers.push(file);
      if (/\.accent\b/.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))) accentReaders.push(file);
    }
    assert.deepEqual(readers.sort(), ['migration/src/components/Divider.svelte', 'migration/src/components/HeroPlate.svelte']);
    // The stored accent is turned into tokens in one place (client-theme.js, through deriveTheme); the styleguide shows presets.
    // Brand Studio (the admin's editor of a client's look) and its libraries read the accent too: it is what they edit. No
    // participant screen or component does.
    assert.deepEqual(accentReaders.sort(), [
      'migration/src/admin/BrandStudio.svelte', 'migration/src/admin/CopyBrandDialog.svelte', 'migration/src/dev/Styleguide.svelte',
      'migration/src/lib/brand-studio.js', 'migration/src/lib/client-theme.js', 'migration/src/lib/legacy-colours.js',
    ]);
    assert.deepEqual(accentReaders.filter((file) => /^migration\/src\/(components|routes|pager)\//.test(file)), [], 'no participant screen or component reads an accent');
    for (const control of ['PillButton', 'HomeButton', 'OptionPill', 'LogoTile', 'ActivityPill', 'SoundToggle', 'ActionBar']) {
      assert.doesNotMatch(await readFile(path.join(ROOT, 'migration/src/components', `${control}.svelte`), 'utf8'), /accent/i, `${control} knows nothing of an accent`);
    }
  });
});

// Phase 10b: every fake also holds the other set of lists (the prefixed ones; or the plain ones, when this suite is run a second time
// with PMS_TEST_LIST_PREFIX and its own lists are the prefixed ones). A request to them is answered, as a second copy's lists would
// answer on a real site, so nothing else in this suite would notice one: this does.
it('no request of this suite reached a list that is not its own', () => {
  assert.deepEqual(STRAYS.map((entry) => `${entry.method} ${entry.title}`), []);
  assert.deepEqual(UNINDEXED.map((entry) => `${entry.list}.${entry.unindexed}`), [], 'and none filtered on a column the schema does not index');
});
