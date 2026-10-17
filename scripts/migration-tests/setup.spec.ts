import { test, expect, type Page } from '@playwright/test';
import { PHASE_4_COLUMNS, TITLE } from '../sharepoint-fake.js';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';
import { SAMPLE_PICTURES } from '../../migration/src/lib/setup/sample-pictures.js';

// The built Setup page at the approved host's address, against the mocked SharePoint REST. Every
// request is answered by the fake; nothing reaches the real tenant.

async function openSetup(page: Page, fake: Fake = newFake()) {
  const served = await serveSharePoint(page, fake);
  await page.goto(pageUrl('setup.html'));
  /** The AppIds the page tried to create, in order. */
  const creates = () => fake.select((entry) => entry.method === 'POST' && Boolean(entry.list)).map((entry) => String(entry.appId));
  return { fake, served, creates };
}

const seed = {
  version: 1,
  data: { clients: [{ id: 'seed-first', name: 'Synthetic First' }, { id: 'seed-second', name: 'Synthetic Second' }], sections: [], questions: [], options: [], sessions: [], adminusers: [], theme: {} },
};

async function chooseSeed(page: Page, text = JSON.stringify(seed)) {
  await page.getByLabel('Private seed file').setInputFiles({ name: 'synthetic-seed.json', mimeType: 'application/json', buffer: Buffer.from(text) });
}

// (Phase 10c-3: the check and the import each say what happened beside their own button.)
const status = (page: Page) => page.getByTestId('lists-status');
const importStatus = (page: Page) => page.getByTestId('import-status');
const check = async (page: Page) => {
  await page.getByRole('button', { name: 'Check Lists' }).click();
  await expect(status(page)).not.toContainText('Checking');
};

test('Setup rejects invalid schemas and performs no writes', async ({ page }) => {
  const { fake, served, creates } = await openSetup(page);
  for (const fields of fake.fields.values()) fields.find((field) => field.InternalName === 'AppId')!.Indexed = false;
  await chooseSeed(page);
  await check(page);
  await expect(status(page)).toContainText('List configuration needs attention');
  await expect(page.getByRole('button', { name: 'Import Missing Records' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Seed sample clients' })).toBeDisabled();
  expect(creates()).toEqual([]);
  expect(fake.count((entry) => entry.method !== 'GET')).toBe(0);
  expect(served.unexpected).toEqual([]);
});

test('Setup names every missing list and column with its internal name and type', async ({ page }) => {
  const { fake } = await openSetup(page, newFake({ without: [...PHASE_4_COLUMNS, 'uservisitlogs'] }));
  await check(page);
  await expect(status(page)).toContainText('List configuration needs attention');
  const lists = page.getByRole('table').first();
  await expect(lists.getByRole('row', { name: new RegExp(`^${TITLE.clients}\\b`) })).toContainText('4 problems');
  await expect(lists.getByRole('row', { name: new RegExp(`^${TITLE.tracks}\\b`) })).toContainText('Ready');
  await expect(lists.getByRole('row', { name: new RegExp(`^${TITLE.uservisitlogs}\\b`) })).toContainText('1 problem');

  const fix = page.getByRole('table', { name: 'What to fix' });
  const rows = (await fix.getByRole('row').allInnerTexts()).slice(1).map((row) => row.split('\t').map((cell) => cell.trim()).join(' | '));
  expect(rows).toEqual([
    `${TITLE.clients} | Slug | Single line of text | Missing.`,
    `${TITLE.clients} | ThemeJson | Multiple lines of text, plain text | Missing.`,
    `${TITLE.clients} | ThemeVersion | Number | Missing.`,
    `${TITLE.clients} | Status | Single line of text | Missing.`,
    `${TITLE.sessions} | ActivityFlow | Single line of text | Missing.`,
    `${TITLE.sections} | ClientId | Single line of text, indexed | Missing.`,
    `${TITLE.sections} | Description | Multiple lines of text, plain text | Missing.`,
    `${TITLE.questions} | Layout | Single line of text | Missing.`,
    `${TITLE.options} | ImageUrl | Single line of text | Missing.`,
    `${TITLE.appsettings} | ActiveClientId | Single line of text | Missing.`,
    `${TITLE.appsettings} | ActivatedAt | Date and Time, shown as Date & Time | Missing.`,
    `${TITLE.uservisitlogs} | (the list) |  | The list "${TITLE.uservisitlogs}" does not exist.`,
    `${TITLE.responses} | TrackId | Single line of text, indexed | Missing.`,
    `${TITLE.responses} | ClientId | Single line of text | Missing.`,
  ]);
  expect(fake.count((entry) => entry.method !== 'GET'), 'the check creates nothing').toBe(0);
});

test('Setup cancellation and malformed JSON never write starter records', async ({ page }) => {
  const { served, creates } = await openSetup(page);
  await check(page);
  await expect(status(page)).toContainText('All list schemas ready');
  await chooseSeed(page);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Import Missing Records' }).click();
  expect(creates()).toEqual([]);
  await chooseSeed(page, '{ broken');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Import Missing Records' }).click();
  await expect(importStatus(page)).toContainText('Import stopped');
  expect(creates()).toEqual([]);
  expect(served.unexpected).toEqual([]);
});

test('Setup partial failure preserves prior imports and retry skips existing IDs', async ({ page }) => {
  const { fake, served, creates } = await openSetup(page);
  await check(page);
  await expect(status(page)).toContainText('All list schemas ready');
  await chooseSeed(page);
  fake.failNext({ status: 403, message: 'Synthetic denied write', when: (entry) => entry.method === 'POST' && entry.appId === 'seed-second' });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Import Missing Records' }).click();
  await expect(importStatus(page)).toContainText('Import stopped');
  await expect(page.getByRole('list', { name: 'Import progress' })).toContainText('seed-first: Imported');
  expect(fake.lists.get('clients')).toHaveLength(1);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Import Missing Records' }).click();
  // (The seed still holds `theme`, as a file made before Phase 10c-2a does: it is accepted, and nothing is imported for it.)
  await expect(importStatus(page)).toContainText('Complete: 1 imported, 1 already present');
  await expect(page.getByRole('list', { name: 'Import progress' })).toContainText('seed-first: Skipped existing');
  expect(creates().filter((id) => id === 'seed-first')).toHaveLength(1);
  expect(fake.lists.get('clients')).toHaveLength(2);
  expect(served.unexpected).toEqual([]);
});

test('Setup rejects oversized files before attempting an import', async ({ page }) => {
  const { served, creates } = await openSetup(page);
  await check(page);
  await expect(status(page)).toContainText('All list schemas ready');
  await chooseSeed(page, ' '.repeat(5 * 1024 * 1024 + 1));
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Import Missing Records' }).click();
  await expect(importStatus(page)).toContainText('smaller than 5 MB');
  expect(creates()).toEqual([]);
  expect(served.unexpected).toEqual([]);
});

// ---- Phase 4: sample clients, the self-test -------------------------------------------------------

test('Seed sample clients creates Kroger and Domino\'s once; a second run creates nothing and writes nothing', async ({ page }) => {
  const { fake, served } = await openSetup(page);
  const section = page.getByRole('region', { name: 'Sample clients' });
  await expect(section.getByRole('button', { name: 'Seed sample clients' })).toBeDisabled();
  await check(page);

  page.once('dialog', (dialog) => dialog.dismiss());
  await section.getByRole('button', { name: 'Seed sample clients' }).click();
  expect(fake.count((entry) => entry.method !== 'GET'), 'cancelling writes nothing').toBe(0);

  page.once('dialog', (dialog) => dialog.accept());
  await section.getByRole('button', { name: 'Seed sample clients' }).click();
  await expect(section.getByRole('status')).toContainText('Complete: 76 created, 0 completed, 0 already present.', { timeout: 20_000 });
  expect(Object.fromEntries(['clients', 'sections', 'questions', 'options'].map((list) => [list, fake.lists.get(list)!.length]))).toEqual({ clients: 2, sections: 4, questions: 14, options: 56 });
  const dominos = fake.item('clients', 'c-dominos')!;
  expect(dominos).toMatchObject({ Name: "Domino's", Slug: 'dominos', Status: 'active', ThemeVersion: 1, PrimaryColor: '#0B648F', SecondaryColor: '#E21737' });
  expect(JSON.parse(dominos.ThemeJson as string).copy).toMatchObject({ eventTitle: "Domino's Trivia Night", logoText: "Domino's" });
  // Phase 10f: its logo is VJR's file, uploaded to the picture library first (no logo is drawn or invented).
  expect(dominos.LogoUrl, 'its logo is the uploaded file').toBe(new URL(`${fake.libraryFolder}/${SAMPLE_PICTURES['c-dominos'].logo.name}`, fake.settings.siteUrl).href);
  expect(fake.files.size, 'the six sample pictures').toBe(6);
  expect(fake.item('sections', 'sec-dominos-history')).toMatchObject({ ClientId: 'c-dominos', Description: "How well do you know the Domino's story?" });
  expect(fake.item('questions', 'q-brand-1')).toMatchObject({ Layout: 'image-grid' });
  expect(fake.item('options', 'o-brand-1-b')).toMatchObject({ Label: 'Home Chef', Correct: true });
  expect(fake.item('options', 'o-trivia-1-b')).toMatchObject({ Label: 'Great Western Tea co.', Correct: true });

  // An admin edits a question; seeding again must leave it alone.
  await onSite(fake, (ds) => ds.updateQuestion('q-dominos-history-1', { prompt: 'Edited by an admin' }));
  fake.reset();
  page.once('dialog', (dialog) => dialog.accept());
  await section.getByRole('button', { name: 'Seed sample clients' }).click();
  await expect(section.getByRole('status')).toContainText('Complete: 0 created, 0 completed, 76 already present.');
  expect(fake.count((entry) => entry.method !== 'GET'), 'the second run writes nothing').toBe(0);
  expect(fake.item('questions', 'q-dominos-history-1')!.Prompt).toBe('Edited by an admin');
  expect(fake.lists.get('questions')).toHaveLength(14);
  expect(served.unexpected).toEqual([]);
});

test('the self-test creates, updates, reads back, is refused a duplicate, lists, batches two reads, asks the site four read-only questions, and deletes what it made', async ({ page }) => {
  const { fake, served } = await openSetup(page);
  const section = page.getByRole('region', { name: 'SharePoint self-test' });
  await expect(section.getByText('Test site only.')).toBeVisible();
  // (The page has read the version of the lists as it opened: Phase 10c-2b. That read is not the self-test's.)
  await expect(page.getByTestId('lists-version')).toContainText('The lists are the version this app needs.');
  fake.reset();
  page.once('dialog', (dialog) => { expect(dialog.message()).toContain('Run it on the test site only.'); void dialog.dismiss(); });
  await section.getByRole('button', { name: 'Run self-test' }).click();
  expect(fake.count(), 'cancelling sends nothing').toBe(0);

  page.once('dialog', (dialog) => dialog.accept());
  await section.getByRole('button', { name: 'Run self-test' }).click();
  // (Phase 9b: two read-only probes of the tenant, 3 and 6 requests, joined the seven steps. Phase 10h: a third, one read of each of the twelve lists and a
  // second of each that holds an item: here the AppSettings item and the self-test's own answers. Phase 10i: a fourth, one look at each list, and for each that
  // holds an item its fields and one item naming every column.)
  await expect(section.getByRole('status')).toContainText('Passed: 11 of 11 steps, 50 requests.');
  const rows = (await section.getByRole('table', { name: 'Self-test steps' }).getByRole('row').allInnerTexts()).slice(1).map((row) => row.split('\t').slice(0, 3).map((cell) => cell.trim()).join(' | '));
  expect(rows).toEqual([
    'Create a participant item | Pass | 3',
    'Update it with one write, no read | Pass | 1',
    'Read it back by TrackId | Pass | 1',
    'A second create with the same AppId is refused | Pass | 1',
    'List the session with one query | Pass | 1',
    'Two reads in one request ($batch) | Pass | 1',
    'Probe (read-only): a Yes/No filter on the guest QR codes\' Used column, written three ways | Pass | 3',
    'Probe (read-only): how long a $filter this site accepts | Pass | 6',
    'Probe (read-only): columns this site leaves out of a read that names no columns | Pass | 14',
    'Probe (read-only): columns this site will not return by name | Pass | 16',
    'Delete everything it made | Pass | 3',
  ]);
  await expect(section.getByRole('row', { name: /columns this site leaves out/ })).toContainText(`Left out of a read that names no columns: ${TITLE.responses}: ClientId.`);
  await expect(section.getByRole('row', { name: /columns this site will not return by name/ })).toContainText('Every column of the lists it read came back when named. Read one item of 2 lists, naming every column;');
  await expect(section.getByRole('row', { name: /a Yes\/No filter on the guest QR codes' Used column/ })).toContainText("Used eq 'false': accepted");
  await expect(section.getByRole('row', { name: /how long a \$filter this site accepts/ })).toContainText('the six lengths 1,000 to 4,000 were all accepted');
  expect(fake.lists.get('responses'), 'nothing is left in the list').toHaveLength(0);
  const touched = fake.requests.flatMap((entry) => [entry, ...(entry.parts ?? [])]);
  expect(new Set(touched.map((entry) => entry.list ?? (entry.path.endsWith('/$batch') ? 'batch' : 'contextinfo'))), 'it touches Responses, and only reads the other lists').toEqual(new Set([...Object.keys(TITLE).filter((key) => key !== 'logoLibrary'), 'contextinfo', 'batch']));
  expect(touched.filter((entry) => entry.list !== 'responses' && entry.list).every((entry) => entry.method === 'GET'), 'the probes only read').toBe(true);
  expect(served.unexpected).toEqual([]);
});

// Phase 10h, part D: the self-test's words named "the Responses list" and QRTokens.Used, titles no list has had since Phase 10c-2b (the real site's deployer
// read them there). They name the lists as this copy spells them: the schema file's titles, with the prefix of its settings.
test('the self-test names the lists as this copy spells them, prefix and all: the answers list and the codes\' Used column', async ({ page }) => {
  for (const prefix of ['', 'Test']) {
    await openSetup(page, newFake({ prefix }));
    const section = page.getByRole('region', { name: 'SharePoint self-test' });
    await expect(section).toContainText(`Proves that the ${prefix}${TITLE.responses} list behaves the way saving depends on`);
    await expect(section).toContainText(`ways on ${prefix}${TITLE.qrtokens}.Used`);
    await expect(section).toContainText('asks the site four read-only questions');
    await expect(section).not.toContainText(/Responses list|QRTokens/);
    let asked = '';
    page.once('dialog', (dialog) => { asked = dialog.message(); void dialog.dismiss(); });
    await section.getByRole('button', { name: 'Run self-test' }).click();
    await expect.poll(() => asked).toContain(`one test item in the ${prefix}${TITLE.responses} list of THIS site`);
  }
});

test('the self-test fails loudly, and still cleans up, when Responses.AppId does not enforce unique values', async ({ page }) => {
  const { fake } = await openSetup(page);
  fake.fields.get('responses')!.find((field) => field.InternalName === 'AppId')!.EnforceUniqueValues = false;
  const section = page.getByRole('region', { name: 'SharePoint self-test' });
  page.once('dialog', (dialog) => dialog.accept());
  await section.getByRole('button', { name: 'Run self-test' }).click();
  // Two items now exist for one participant, so the listing step, which expects one, reports it too.
  await expect(section.getByRole('status')).toContainText('Self-test failed: A second create with the same AppId is refused; List the session with one query.');
  await expect(section.getByRole('row', { name: /A second create/ })).toContainText('FAIL');
  await expect(section.getByRole('row', { name: /A second create/ })).toContainText('Enforce unique values');
  await expect(section.getByRole('row', { name: /Delete everything/ })).toContainText('2 item(s) removed.');
  expect(fake.lists.get('responses')).toHaveLength(0);
});
