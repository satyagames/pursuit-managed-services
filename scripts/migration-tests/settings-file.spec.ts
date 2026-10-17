import { test, expect, type Page, type Route } from '@playwright/test';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { sha256Hex } from '../../migration/src/lib/admin/sha256.js';
import { sharePointFolderPath } from '../deployment-config.js';
import { builtDefine } from '../site-override.js';
import { axeCheck, describeFindings } from './a11y-support.js';
import { mockApi } from './fixtures.js';
import { newFake, onSite, pageUrl, seedAndGoLive, serveSharePoint, SITE, type Fake, type SettingsFile } from './sharepoint.js';
import { TITLE } from '../sharepoint-fake.js';

// Phase 10b: the BUILT pages find out which site and lists are their own before they ask for anything else. On a SharePoint
// address each reads pms-config.txt from its own folder, once, on every load; the release pages have nothing built in, so that file
// is the only thing that names their lists. These are the outcomes a deployer can meet, in a browser, against the mocked SharePoint
// REST (scripts/sharepoint-fake.js): a good file, no file, a file that is wrong, a file that cannot be read, a file for another site.
// What a real SharePoint library answers for the file, for a missing one and for a signed-out browser has not been seen.

const REST = (fake: Fake) => fake.requests.length;
const stop = (page: Page) => page.locator('main').filter({ has: page.getByRole('heading', { level: 1, name: 'This page cannot start' }) });
const details = (page: Page) => stop(page).locator('p').last();
const html = (route: Route, status: number, body: string) => route.fulfill({ status, contentType: 'text/html; charset=utf-8', body });
const SIGN_IN = '<!DOCTYPE html><html><head><title>Sign in to your account</title></head><body><form>Sign in</form></body></html>';
// What the first real site (14 Oct 2026) sent, with a success status, for a .json file that was in the folder: its own error page.
const FILE_NOT_FOUND = '<!DOCTYPE html><html><head><title>Error</title></head><body><h1>Sorry, something went wrong</h1><p>File Not Found</p></body></html>';
const PAGE_REASON = "the site sent a web page in its place, usually its sign-in page, or an error page such as 'File Not Found' when the site will not hand out this kind of file";

/** A live site and a page on it, with `settings` as its pms-config.txt. */
async function site(page: Page, settings: SettingsFile) {
  const fake = newFake();
  await seedAndGoLive(fake, 'c-kroger');
  const served = await serveSharePoint(page, fake, { settings });
  fake.reset();
  return { fake, served };
}

test('a good file: the page starts, having asked for the file once and for nothing else it did not ask before', async ({ page }) => {
  const { fake, served } = await site(page, { configVersion: 1, listPrefix: '', label: 'Test, folder 3' });
  await page.goto(pageUrl('index.html'));
  await expect(page.getByRole('heading', { name: 'Hi Casey Example!' })).toBeVisible();
  expect(served.settingsFile, 'one request for the settings file').toBe(1);
  expect(served.unexpected).toEqual([]);
  expect(fake.strays).toEqual([]);

  // Again on a reload: asked for afresh, never kept. Nothing about the settings is in browser storage.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hi Casey Example!' })).toBeVisible();
  expect(served.settingsFile).toBe(2);
  const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
  expect(stored).not.toMatch(/listPrefix|pms-config|siteUrl|Test, folder 3/);

  // The admin and Setup pages read it the same way.
  await page.goto(pageUrl('admin.html'));
  await expect(page.getByLabel('PIN')).toBeVisible();
  await page.goto(pageUrl('setup.html'));
  await expect(page.getByRole('button', { name: 'Check Lists' })).toBeEnabled();
  expect(served.settingsFile).toBe(4);
});

test('the pages read pms-config.txt and nothing else: a pms-config.json beside it is never asked for, and changes nothing (Phase 10g)', async ({ page }) => {
  // The first real site would not hand out .json files from a document library (it sent its own "File Not Found" page), and did serve .txt.
  // The name is one: never both, so there is never a question of which wins. A decoy .json that would put a page on other lists is
  // served beside it, and must be neither requested nor obeyed.
  const { fake, served } = await site(page, { configVersion: 1, listPrefix: '' });
  const decoy: string[] = [];
  await page.route('**/pms-config.json', (route) => { decoy.push(route.request().url()); return route.fulfill({ contentType: 'text/plain', body: JSON.stringify({ configVersion: 1, listPrefix: 'DECOY' }) }); });
  const asked: string[] = [];
  page.on('request', (request) => { if (request.url().includes('pms-config')) asked.push(decodeURIComponent(request.url()).split('/').pop()!); });
  await page.goto(pageUrl('index.html'));
  await expect(page.getByRole('heading', { name: 'Hi Casey Example!' })).toBeVisible();
  await page.goto(pageUrl('admin.html'));
  await expect(page.getByLabel('PIN')).toBeVisible();
  await page.goto(pageUrl('setup.html'));
  await expect(page.getByRole('button', { name: 'Check Lists' })).toBeEnabled();
  expect(asked, 'each page asked for pms-config.txt, once').toEqual(['pms-config.txt', 'pms-config.txt', 'pms-config.txt']);
  expect(served.settingsFile).toBe(3);
  expect(decoy).toEqual([]);
  expect(fake.strays).toEqual([]);
});

test('with no pms-config.txt the pms-config.json beside it is no stand-in: the page stops as it does for any missing settings, and asks for nothing else (Phase 10g)', async ({ page }) => {
  const { fake, served } = await site(page, null);
  const decoy: string[] = [];
  await page.route('**/pms-config.json', (route) => { decoy.push(route.request().url()); return route.fulfill({ contentType: 'text/plain', body: JSON.stringify({ configVersion: 1, listPrefix: '' }) }); });
  await page.goto(pageUrl('index.html'));
  await expect(details(page)).toHaveText('Details: PMS-CFG-001');
  await page.waitForTimeout(500);
  expect(served.settingsFile).toBe(1);
  expect(decoy, 'a .json is not looked for when the .txt is missing').toEqual([]);
  expect(REST(fake), 'and the stopped page asked the lists for nothing').toBe(0);
});

test('no file, and nothing built in: every page stops, says so, and asks SharePoint nothing at all (PMS-CFG-001)', async ({ page }) => {
  const { fake, served } = await site(page, null);
  for (const file of ['index.html', 'admin.html']) {
    await page.goto(pageUrl(file));
    await expect(stop(page)).toBeVisible();
    await expect(stop(page)).toContainText('It cannot tell which lists are its own, so it has stopped rather than guess.');
    await expect(stop(page)).toContainText('open Setup (setup.html, in this folder) to see what is wrong');
    await expect(details(page)).toHaveText('Details: PMS-CFG-001');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByText(/live yet|reach the server/)).toHaveCount(0);
    await expect(page.getByLabel('PIN')).toHaveCount(0);
  }
  // A few seconds of an open page: its timer never started, so nothing is asked later either.
  await page.waitForTimeout(3500);
  expect(REST(fake), 'not one REST request: no list was read, the plain ones included').toBe(0);
  expect(served.settingsFile, 'each load asked for the file, and the 404 was its answer').toBe(2);
  expect(served.unexpected).toEqual([]);

  // Setup opens all the same and says it in full; everything that would touch a list is switched off.
  await page.goto(pageUrl('setup.html'));
  const problem = page.locator('.copy-problem');
  await expect(problem).toHaveAttribute('data-problem', 'PMS-CFG-001');
  await expect(problem.getByRole('heading', { name: 'This copy of the app has not been set up yet' })).toBeVisible();
  await expect(problem).toContainText('The app does not know which lists belong to it, so it has stopped rather than guess.');
  await expect(problem).toContainText('Who to ask: Whoever published the app');
  await expect(problem).toContainText(`Details: PMS-CFG-001, no listPrefix: pms-config.txt was not found and none is built in, opened from ${pageUrl('setup.html')}`);
  for (const name of ['Check Lists', 'Import Missing Records', 'Seed sample clients', 'Run self-test']) {
    await expect(page.getByRole('button', { name })).toBeDisabled();
  }
  expect(REST(fake)).toBe(0);
});

test('a file with a mistake in it stops the page and names where; Setup says what the rule is (PMS-CFG-002)', async ({ page }) => {
  const mistakes: [SettingsFile, string, string][] = [
    [{ configVersion: 1, listPrefx: 'PMS3' }, 'PMS-CFG-002 invalid listPrefx', '"listPrefx" is not a setting this app knows.'],
    [{ configVersion: 1, listPrefix: 'PMS 3' }, 'PMS-CFG-002 invalid listPrefix', '"listPrefix" must be empty, or a letter followed by up to 15 letters or digits.'],
    [{ listPrefix: '', lists: { qrtoken: 'GuestCodes' } }, 'PMS-CFG-002 invalid lists.qrtoken', '"lists.qrtoken" is not one of this app\'s lists'],
    [{ listPrefix: '', lists: { qrtokens: TITLE.clients } }, 'PMS-CFG-002 invalid lists', `"lists.qrtokens" and the ${TITLE.clients} list would both be "${TITLE.clients}".`],
    [(route) => route.fulfill({ contentType: 'text/plain', body: '{ "listPrefix": "PMS3", }' }), 'PMS-CFG-002 json 200', 'it is not valid JSON.'],
    [(route) => route.fulfill({ contentType: 'text/plain', body: '["PMS3"]' }), 'PMS-CFG-002 invalid *', 'it must be one JSON object, { ... }.'],
  ];
  const { fake, served } = await site(page, null);
  for (const [settings, coded, rule] of mistakes) {
    served.settings = settings;
    await page.goto(pageUrl('index.html'));
    await expect(details(page)).toHaveText(`Details: ${coded}`);
    await page.goto(pageUrl('setup.html'));
    await expect(page.locator('.copy-problem')).toHaveAttribute('data-problem', 'PMS-CFG-002');
    await expect(page.locator('.copy-problem')).toContainText(`This page could not use its settings file, pms-config.txt: ${rule}`);
    await expect(page.getByRole('button', { name: 'Check Lists' })).toBeDisabled();
  }
  expect(REST(fake), 'a file that is wrong is never passed over for a default').toBe(0);
});

test('a file that cannot be read stops the page (503, a sign-in page, 403, no connection); once it can be read, Try again starts the app', async ({ page }) => {
  const { fake, served } = await site(page, null);
  const failures: [SettingsFile, string, string][] = [
    [(route) => html(route, 503, 'Service Unavailable'), 'PMS-CFG-002 status 503', 'the site answered 503'],
    [(route) => html(route, 200, SIGN_IN), 'PMS-CFG-002 page 200', PAGE_REASON],
    [(route) => html(route, 200, FILE_NOT_FOUND), 'PMS-CFG-002 page 200', PAGE_REASON],
    [(route) => html(route, 403, 'Forbidden'), 'PMS-CFG-002 status 403', 'the site answered 403'],
    [(route) => route.abort('connectionfailed'), 'PMS-CFG-002 unreachable', 'there was no connection, or no answer within 8 seconds'],
  ];
  for (const [settings, coded, reason] of failures) {
    served.settings = settings;
    await page.goto(pageUrl('admin.html'));
    await expect(details(page)).toHaveText(`Details: ${coded}`);
    await expect(page.getByLabel('PIN')).toHaveCount(0);
    await page.goto(pageUrl('setup.html'));
    await expect(page.locator('.copy-problem')).toContainText(`This page could not use its settings file, pms-config.txt: ${reason}. It has stopped rather than guess.`);
  }
  expect(REST(fake), 'none of them fell through to the lists without a prefix').toBe(0);

  // The participant page, stopped on a 503; then the site answers again.
  served.settings = (route) => html(route, 503, 'Service Unavailable');
  await page.goto(pageUrl('index.html'));
  await expect(details(page)).toHaveText('Details: PMS-CFG-002 status 503');
  const asked = served.settingsFile;
  served.settings = { configVersion: 1, listPrefix: '' };
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Hi Casey Example!' })).toBeVisible();
  await expect(stop(page)).toHaveCount(0);
  expect(served.settingsFile).toBe(asked + 1);
  expect(fake.strays).toEqual([]);
});

test('a file that names another site stops the page: it is never used from a folder it was not written for (PMS-CFG-004)', async ({ page }) => {
  const { fake, served } = await site(page, { configVersion: 1, listPrefix: '', siteUrl: 'https://americas.internal.deloitteonline.com/sites/AnotherSite' });
  for (const file of ['index.html', 'admin.html']) {
    await page.goto(pageUrl(file));
    await expect(details(page)).toHaveText('Details: PMS-CFG-004');
  }
  await page.goto(pageUrl('setup.html'));
  const problem = page.locator('.copy-problem');
  await expect(problem.getByRole('heading', { name: 'This page was opened from the wrong address' })).toBeVisible();
  await expect(problem).toContainText('This copy of the app is set up for a different SharePoint site than the one it was opened from.');
  await expect(problem).toContainText(`siteUrl https://americas.internal.deloitteonline.com/sites/AnotherSite (pms-config.txt)`);
  expect(REST(fake)).toBe(0);

  // Its own site, spelled out, is fine, in any case of letters.
  served.settings = { configVersion: 1, listPrefix: '', siteUrl: SITE.toUpperCase().replace('HTTPS', 'https') };
  await page.goto(pageUrl('index.html'));
  await expect(page.getByRole('heading', { name: 'Hi Casey Example!' })).toBeVisible();
});

test('the stop screen: the heading takes focus, Try again is reached by the keyboard with the ring, and axe finds nothing, on both pages and in Setup', async ({ page, browserName }) => {
  const { served } = await site(page, null);
  const findings = [];
  for (const [file, width, height] of [['index.html', 390, 844], ['index.html', 820, 1180], ['admin.html', 1280, 900], ['admin.html', 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(pageUrl(file));
    await expect(stop(page)).toBeVisible();
    await expect(stop(page).getByRole('heading', { level: 1 })).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${file} at ${width}: nothing runs off the side`).toBe(true);
    const button = page.getByRole('button', { name: 'Try again' });
    expect((await button.boundingBox())!.height, 'a tap target of 44px or more').toBeGreaterThanOrEqual(44);
    // (Safari on a Mac does not Tab to buttons unless its own setting is on: Alt+Tab is what it offers.)
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(button).toBeFocused();
    expect(await button.evaluate((element) => getComputedStyle(element).outlineStyle), 'the focus ring').toBe('solid');
    if (browserName === 'chromium') findings.push(...(await axeCheck(page, `the stop screen, ${file} at ${width}`)).findings);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  served.settings = { listPrefx: 'PMS3' };
  await page.goto(pageUrl('setup.html'));
  await expect(page.locator('.copy-problem')).toBeVisible();
  if (browserName === 'chromium') findings.push(...(await axeCheck(page, 'Setup with a settings problem')).findings);
  expect(describeFindings(findings)).toBe('');
});

test('on the local server nothing of this applies: no settings file is asked for, and the page starts as it always did', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (request) => { if (request.url().includes('pms-config')) asked.push(request.url()); });
  await mockApi(page);
  await page.goto(`${sharePointFolderPath}/index.html`);
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  await page.goto(`${sharePointFolderPath}/setup.html`);
  await expect(page.getByRole('button', { name: 'Check Lists' })).toBeEnabled();
  await expect(page.locator('.copy-problem')).toHaveCount(0);
  expect(asked).toEqual([]);
});

// ---- The list namespace, in a browser ------------------------------------------------------------------------------------------------
// The mocked site holds BOTH a set of lists with plain titles and a set with the prefix PMS3, and answers a request to either. A
// request that reaches the set that is not the test's own is recorded as a stray: on a real site it would simply work, on another
// copy's lists.

const titlesAsked = (fake: Fake) => [...new Set(fake.requests.flatMap((entry) => [entry, ...(entry.parts ?? [])]).map((entry) => entry.title as string | null).filter(Boolean))].sort();

/** A site whose own lists have the prefix PMS3, seeded and live. */
async function prefixedSite(options: Parameters<typeof newFake>[0] = {}) {
  const fake = newFake({ prefix: 'PMS3', ...options });
  const session = await seedAndGoLive(fake, 'c-kroger');
  fake.reset();
  return { fake, session };
}

test('"listPrefix": "PMS3": the page starts on the prefixed lists, and the lists without a prefix are never asked for anything', async ({ page }) => {
  const { fake } = await prefixedSite();
  const served = await serveSharePoint(page, fake, { settings: { configVersion: 1, listPrefix: 'PMS3' } });
  await page.goto(pageUrl('index.html'));
  await expect(page.getByRole('heading', { name: 'Hi Casey Example!' })).toBeVisible();
  await expect(page.getByText('Welcome to the Kroger experience.', { exact: true })).toBeVisible();
  await expect.poll(() => fake.count({ method: 'POST', list: 'uservisitlogs' })).toBe(1);
  // (Phase 10j: once the first screen is up the page reads every activity's questions and options, and fetches ahead what its next writes
  // ask for, the answers list's item type among them.)
  await expect.poll(() => [fake.count({ method: 'GET', list: 'options' }), fake.count((entry) => entry.list === 'responses' && /ListItemEntityTypeFullName/.test(entry.url))]).toEqual([1, 1]);
  expect(fake.strays.map((entry) => `${entry.method} ${entry.title}`), 'no request reached a list without the prefix').toEqual([]);
  expect(titlesAsked(fake)).toEqual([`PMS3${TITLE.appsettings}`, `PMS3${TITLE.clients}`, `PMS3${TITLE.options}`, `PMS3${TITLE.questions}`, `PMS3${TITLE.responses}`, `PMS3${TITLE.sections}`, `PMS3${TITLE.sessions}`, `PMS3${TITLE.tracks}`, `PMS3${TITLE.uservisitlogs}`].sort());
  // (Each set starts with the AppSettings item Setup makes, Phase 10c-2b: untouched, it is nothing a request left there.)
  const untouched = (row: Record<string, unknown>) => row.AppId === 'default' && row.Id === 100_000 && !('ActiveSessionId' in row);
  for (const [title, rows] of fake.otherLists) expect(rows.filter((row: Record<string, unknown>) => !untouched(row)).length, `${title} holds nothing`).toBe(0);
  expect(served.settingsFile).toBe(1);
  expect(served.unexpected).toEqual([]);

  // The admin's first screen and Setup's check, the same way.
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex('1234') });
  await page.goto(pageUrl('admin.html'));
  await page.getByLabel('PIN').fill('1234');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.goto(pageUrl('setup.html'));
  await page.getByRole('button', { name: 'Check Lists' }).click();
  await expect(page.getByRole('status').first()).toContainText('All list schemas ready');
  await expect(page.locator('section[aria-labelledby="lists-heading"]').getByRole('cell', { name: `PMS3${TITLE.appsettings}`, exact: true })).toBeVisible();
  expect(fake.strays.map((entry) => `${entry.method} ${entry.title}`)).toEqual([]);
  expect(titlesAsked(fake).every((title) => title.startsWith('PMS3'))).toBe(true);
});

test('the failure this is for: the same pages with "listPrefix": "" on that site read the other lists, work, and tell nobody', async ({ page }) => {
  // What a copied folder with a copied settings file does. Nothing can make it impossible; this is why the prefix is never assumed,
  // and why Setup shows which lists a copy uses. The mocked site records what a real one would not.
  const { fake } = await prefixedSite();
  await serveSharePoint(page, fake, { settings: { configVersion: 1, listPrefix: '' } });
  await page.goto(pageUrl('index.html'));
  await expect(page.getByRole('heading', { name: "Today's experience isn't live yet" })).toBeVisible();
  await expect(page.locator('main').filter({ hasText: 'This page cannot start' })).toHaveCount(0);
  expect(fake.strays.length, 'every request went to the lists without a prefix, and each was answered').toBeGreaterThan(0);
  expect(titlesAsked(fake)).toEqual([TITLE.appsettings]);
});

test('a list that is named on its own is asked for under that title only: a guest scans a code kept in "GuestCodes"', async ({ page }) => {
  const { fake, session } = await prefixedSite({ lists: { qrtokens: 'GuestCodes' } });
  const code = await onSite(fake, async (ds) => {
    await ds.setSessionParticipationMode(session.id, 'client-visit');
    const visitor = await ds.createVisitor({ sessionId: session.id, displayName: 'Jordan Lee', enabled: true });
    return (await ds.provisionQrToken('c-kroger', session.id, { visitorId: visitor.id })).id as string;
  });
  fake.reset();
  await serveSharePoint(page, fake, { settings: { configVersion: 1, listPrefix: 'PMS3', lists: { qrtokens: 'GuestCodes' } } });
  await page.goto(`${pageUrl('index.html')}?qr=${code}`);
  await expect(page.getByRole('heading', { name: 'Hi Jordan Lee!' })).toBeVisible();
  expect(fake.strays.map((entry) => `${entry.method} ${entry.title}`)).toEqual([]);
  const asked = titlesAsked(fake);
  expect(asked).toContain('GuestCodes');
  expect(asked.filter((title) => /QRTokens/.test(title)), `neither QRTokens nor PMS3${TITLE.qrtokens}`).toEqual([]);
  expect(fake.item('qrtokens', code)!.Used, 'the code was claimed in the list that was named').toBe(true);
});

test.describe('pages with values built into them', () => {
  // Built here, into a scratch folder, with the bundler constant the release build uses (scripts/site-override.js): the release
  // candidate in build-svelte/release has nothing built in, and is never touched by this.
  const scratch = fileURLToPath(new URL('../../test-results/.settings-built/', import.meta.url));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    await rm(scratch, { recursive: true, force: true });
    const define = builtDefine({ PMS_LIST_PREFIX: 'PMS3', PMS_LABEL: 'Built for the test', PMS_SUPPORT_NAME: 'Asha Rao', PMS_SUPPORT_CONTACT: 'asha.rao@example.com' });
    for (const [config, name] of [['vite.config.ts', 'index.html'], ['vite.setup.config.ts', 'setup.html']]) {
      await build({ configFile: `${root}migration/${config}`, define, logLevel: 'silent', build: { outDir: `${scratch}${name}.d`, emptyOutDir: true } });
      const { copyFile } = await import('node:fs/promises');
      await copyFile(`${scratch}${name}.d/${name}`, `${scratch}${name}`);
    }
  });

  test('no settings file: the built-in prefix is used (the 404 is the answer), on the prefixed lists only', async ({ page }) => {
    const { fake } = await prefixedSite();
    const served = await serveSharePoint(page, fake, { settings: null, pages: scratch });
    await page.goto(pageUrl('index.html'));
    await expect(page.getByRole('heading', { name: 'Hi Casey Example!' })).toBeVisible();
    expect(served.settingsFile, 'the file is still asked for, once').toBe(1);
    expect(fake.strays).toEqual([]);
    expect(titlesAsked(fake).every((title) => title.startsWith('PMS3'))).toBe(true);
  });

  test('a settings file beside those pages still wins, setting by setting; a file that is wrong stops them, built-in prefix or not', async ({ page }) => {
    // The file names the plain lists: that is what the page uses, on a site whose own lists are the plain ones.
    const fake = newFake({ prefix: '' });
    await seedAndGoLive(fake, 'c-kroger');
    fake.reset();
    const served = await serveSharePoint(page, fake, { settings: { configVersion: 1, listPrefix: '' }, pages: scratch });
    await page.goto(pageUrl('index.html'));
    await expect(page.getByRole('heading', { name: 'Hi Casey Example!' })).toBeVisible();
    expect(fake.strays, 'the built-in PMS3 was not used').toEqual([]);
    // (The visit log is written once the first screen is up: wait for it, so that the count below is of a page that has finished.)
    await expect.poll(() => fake.count({ method: 'POST', list: 'uservisitlogs' })).toBe(1);

    served.settings = { listPrefx: 'PMS3' };
    const before = fake.requests.length;
    await page.goto(pageUrl('index.html'));
    await expect(details(page)).toHaveText('Details: PMS-CFG-002 invalid listPrefx');
    served.settings = (route) => html(route, 503, 'Service Unavailable');
    await page.goto(pageUrl('index.html'));
    await expect(details(page)).toHaveText('Details: PMS-CFG-002 status 503');
    expect(fake.requests.length, 'neither fell back to the prefix that is built in').toBe(before);
  });
});
