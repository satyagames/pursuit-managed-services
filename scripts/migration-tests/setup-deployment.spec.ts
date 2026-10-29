import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../migration/src/lib/admin/sha256.js';
import { sharePointFolderPath } from '../deployment-config.js';
import { axeCheck, describeFindings } from './a11y-support.js';
import { mockApi } from './fixtures.js';
import { newFake, pageUrl, seedAndGoLive, serveSharePoint, SITE, type Fake, isRead } from './sharepoint.js';
import { LISTS } from '../../migration/src/lib/schema/pms-schema.js';

// (Prompt 22: the lists are counted from the schema: "(12)" and thirteen rows until Prompt 21 added four lists.)
const LIST_COUNT = Object.keys(LISTS).length;
const ROWS = LIST_COUNT + 1; // (and the picture library)
import { TITLE } from '../sharepoint-fake.js';

// Phase 10b, what the deployer sees, in the BUILT pages: Setup's first panel ("This copy of the app"), its read-only rows of where the
// lists are with the one probe by address, and the label in the admin bar. Against the mocked SharePoint REST, which holds a plain
// and a prefixed set of lists: what a real site reports for a list's address and id, and whether it answers `web/GetList` at all, is
// what these rows are there to show on the first visit to one (QA-TESTING.md, item 92).

const shots = fileURLToPath(new URL('../../test-results/setup/', import.meta.url));
test.beforeAll(async () => { await mkdir(shots, { recursive: true }); });

const FOLDER = `${SITE}/Shared Documents/staging-test/`;
const panel = (page: Page) => page.locator('section.copy');
/** The panel's rows as `Label | value (source)`. */
const rowsOf = (page: Page) => panel(page).locator('.copy-row').evaluateAll((rows) => rows.map((row) => `${row.querySelector('dt')!.textContent!.trim()} | ${row.querySelector('dd')!.textContent!.replace(/\s+/g, ' ').trim()}`));
const where = (page: Page) => page.locator('section[aria-labelledby="where-heading"]');
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function prefixedSite(options: Parameters<typeof newFake>[0] = {}) {
  const fake = newFake({ prefix: 'PMS3', ...options });
  await seedAndGoLive(fake, 'c-kroger');
  fake.reset();
  return fake;
}

test('"This copy of the app": what the pages are using and where each value came from, then where the lists are, by reading only', async ({ page, browserName }) => {
  const fake = await prefixedSite();
  await serveSharePoint(page, fake, { settings: { configVersion: 1, listPrefix: 'PMS3', label: 'Test, folder 3', support: { name: 'Asha Rao', contact: 'asha.rao@example.com' } } });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(pageUrl('setup.html'));
  await expect(panel(page).getByRole('heading', { name: 'This copy of the app' })).toBeVisible();
  await expect(panel(page).locator('.copy-problem')).toHaveCount(0);
  const rows = await rowsOf(page);
  expect(rows.slice(0, 7)).toEqual([
    `Opened from | ${FOLDER}`,
    `Site | ${SITE} (from this page's address)`,
    `Lists | PMS3${TITLE.clients}, PMS3${TITLE.sessions}, ... (${LIST_COUNT}) (prefix "PMS3" from pms-config.txt)`,
    `Picture library | PMS3${TITLE.logoLibrary} (default for this prefix)`,
    'Grouped reads | on (default)',
    'Support | Asha Rao, asha.rao@example.com (from pms-config.txt)',
    'Label | Test, folder 3 (from pms-config.txt)',
  ]);
  expect(rows[7]).toMatch(/^Build \| (pms-[0-9a-f]{7}( with uncommitted changes)?|a build with no commit to name it by) \(built in\)$/);
  expect(rows).toHaveLength(8);
  // The panel itself asks SharePoint nothing: it is what the page worked out as it started. The page reads as it opens the version of the lists, on
  // the AppSettings item (Phase 10c-2b), and, on lists of this version, the admins' names to list them (Phase 10c-3, part E).
  await expect(page.getByTestId('lists-version')).toContainText('The lists are the version this app needs.');
  await expect(page.getByTestId('admin-names')).toHaveText('There is no admin on this site yet.');
  // (Prompt 22: since Prompt 21 People and access reads who has access as Setup opens: who is signed in and the owners group in one $batch, then the
  // people and their roles. Reads only; the spec expected the first two alone until then.)
  await expect(page.getByTestId('super-admins')).toBeVisible();
  expect(fake.requests.filter((entry) => !isRead(entry)), 'nothing but reads').toEqual([]);
  expect([...new Set(fake.requests.map((entry) => entry.list).filter(Boolean))].sort(), 'the version of the lists, the admins, and who has access').toEqual(['adminusers', 'appsettings', 'roleassignments', 'users']);
  fake.reset();

  // Where the lists are: thirteen rows, nothing read yet.
  const table = where(page).locator('table.where tbody tr');
  await expect(table).toHaveCount(ROWS);
  await expect(table.first()).toHaveText(new RegExp(`clients\\s*PMS3${TITLE.clients}\\s*not read yet`));
  await expect(table.last()).toHaveText(new RegExp(`picture library\\s*PMS3${TITLE.logoLibrary}\\s*not read yet`));
  await expect(where(page).getByTestId('address-probe')).toHaveCount(0);

  await where(page).getByRole('button', { name: 'Read where the lists are' }).click();
  await expect(where(page).getByRole('status')).toHaveText(`Read ${ROWS} of ${ROWS}. Nothing on the site was changed.`);
  await expect(table.first().locator('[data-address]')).toHaveText(`/sites/CreativeExpCOE/Lists/PMS3${TITLE.clients}`);
  await expect(table.first().locator('[data-id]')).toHaveText(/^[0-9a-f-]{36}$/);
  await expect(table.last().locator('[data-address]')).toHaveText(`/sites/CreativeExpCOE/PMS3${TITLE.logoLibrary}`);
  await expect(table.filter({ hasText: 'At the address its title suggests.' })).toHaveCount(ROWS);
  await expect(where(page).getByTestId('address-probe')).toHaveText(new RegExp(`^Asked for PMS3${TITLE.clients} by its title and by its address \\(\\/sites\\/CreativeExpCOE\\/Lists\\/PMS3${TITLE.clients}\\): the same list both ways \\(id [0-9a-f-]{36}\\)\\.$`));

  // A read by title for each list and the library, and one by address: all GET, all to this copy's own lists, nothing written.
  expect(fake.requests.map((entry) => entry.method)).toEqual(Array.from({ length: ROWS + 1 }, () => 'GET'));
  expect(fake.requests.filter((entry) => entry.title).map((entry) => entry.title)).toEqual([...Object.keys(LISTS), 'logoLibrary'].map((key) => `PMS3${TITLE[key as keyof typeof TITLE]}`));
  expect(fake.requests.at(-1)!.path).toMatch(new RegExp(`\\/web\\/GetList\\('\\/sites\\/CreativeExpCOE\\/Lists\\/PMS3${TITLE.clients}'\\)$`));
  expect(fake.strays).toEqual([]);
  await page.screenshot({ path: `${shots}setup-copy-${browserName}.png`, fullPage: true });

  // A phone: the panel and the rows fit, with nothing running off the side.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => noSidewaysScroll(page)).toBe(true);
  await page.screenshot({ path: `${shots}setup-copy-phone-${browserName}.png`, fullPage: true });
  if (browserName === 'chromium') {
    const findings = [...(await axeCheck(page, 'Setup: this copy of the app, and where the lists are (390)')).findings];
    await page.setViewportSize({ width: 1280, height: 900 });
    findings.push(...(await axeCheck(page, 'Setup: this copy of the app, and where the lists are (1280)')).findings);
    expect(describeFindings(findings)).toBe('');
  }
});

test('a list that is missing, one that was renamed after it was made, and one named in the settings are each said in the rows', async ({ page }) => {
  const fake = await prefixedSite({ without: ['adminusers'], addresses: { sessions: 'Session' }, lists: { qrtokens: 'GuestCodes' } });
  await serveSharePoint(page, fake, { settings: { configVersion: 1, listPrefix: 'PMS3', lists: { qrtokens: 'GuestCodes' } } });
  await page.goto(pageUrl('setup.html'));
  expect((await rowsOf(page))[2]).toBe(`Lists | PMS3${TITLE.clients}, PMS3${TITLE.sessions}, ... (${LIST_COUNT}) (prefix "PMS3" from pms-config.txt; 1 named on its own from pms-config.txt: qrtokens is GuestCodes)`);
  await where(page).getByRole('button', { name: 'Read where the lists are' }).click();
  await expect(where(page).getByRole('status')).toHaveText(`Read ${ROWS - 1} of ${ROWS}: 1 could not be found or read. Nothing on the site was changed.`);
  const row = (key: string) => where(page).locator(`tr[data-list="${key}"]`);
  await expect(row('adminusers')).toHaveText(new RegExp(`adminusers\\s*PMS3${TITLE.adminusers}\\s*none\\s*There is no list with this title\\.`));
  await expect(row('sessions')).toContainText('/sites/CreativeExpCOE/Lists/Session');
  await expect(row('sessions')).toContainText(`At another address than its title suggests (/sites/CreativeExpCOE/Lists/PMS3${TITLE.sessions}): it was made under another name.`);
  await expect(row('qrtokens')).toHaveText(/qrtokens\s*GuestCodes\s*\/sites\/CreativeExpCOE\/Lists\/GuestCodes/);
  expect(fake.strays).toEqual([]);
  expect(fake.count((entry) => !isRead(entry))).toBe(0);
});

test('with a problem the panel says it in full, with the two ways to put it right, and nothing below can be pressed', async ({ page, browserName }) => {
  const fake = newFake();
  const served = await serveSharePoint(page, fake, { settings: null });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(pageUrl('setup.html'));
  const problem = panel(page).locator('.copy-problem');
  await expect(problem).toHaveAttribute('data-problem', 'PMS-CFG-001');
  await expect(problem.getByRole('heading', { name: 'This copy of the app has not been set up yet' })).toBeVisible();
  await expect(problem).toContainText('Use one of the two ways below to name them, then reload this page.');
  await expect(problem.locator('ol li')).toHaveCount(2);
  await expect(problem.locator('ol li').first()).toContainText('Put a file called pms-config.txt in the same folder as these three pages.');
  await expect(problem.locator('ol li').first()).toContainText('{ "configVersion": 1, "listPrefix": "PMS3" }');
  await expect(problem.locator('ol li').first()).toContainText('say so on purpose with "listPrefix": ""');
  await expect(problem.locator('ol li').last()).toContainText('PMS_LIST_PREFIX=PMS3 npm run build:svelte:release');
  await expect(problem).toContainText('Everything below is switched off until this is put right');
  expect((await rowsOf(page)).slice(0, 4)).toEqual([
    `Opened from | ${FOLDER}`,
    `Site | ${SITE} (from this page's address)`,
    'Lists | Not named yet (nothing gives a list prefix)',
    'Picture library | Not named yet (it follows the list prefix)',
  ]);
  for (const name of ['Check Lists', 'Read where the lists are', 'Run self-test']) await expect(page.getByRole('button', { name })).toBeDisabled();
  await expect(where(page).locator('table.where tbody tr').first()).toHaveText(new RegExp(`clients\\s*${TITLE.clients}\\s*not read yet`));
  if (browserName === 'chromium') expect(describeFindings((await axeCheck(page, 'Setup: not set up yet (PMS-CFG-001)')).findings)).toBe('');
  await page.screenshot({ path: `${shots}setup-problem-${browserName}.png`, fullPage: true });

  // A file for another site has nothing to do with naming lists: the two ways are not shown for it.
  served.settings = { configVersion: 1, listPrefix: 'PMS3', siteUrl: 'https://americas.internal.deloitteonline.com/sites/AnotherSite' };
  await page.reload();
  await expect(problem).toHaveAttribute('data-problem', 'PMS-CFG-004');
  await expect(problem.locator('ol')).toHaveCount(0);
  expect((await rowsOf(page))[1]).toBe('Site | https://americas.internal.deloitteonline.com/sites/AnotherSite (from pms-config.txt)');
  expect(fake.requests.length, 'and through all of it nothing was asked of any list').toBe(0);
});

test('on the local server Setup says so: no site, no settings file, and no list addresses to read', async ({ page, browserName }) => {
  const asked: string[] = [];
  page.on('request', (request) => { if (/pms-config|_api/.test(request.url())) asked.push(request.url()); });
  await mockApi(page);
  await page.goto(`${sharePointFolderPath}/setup.html`);
  await expect(panel(page).getByRole('heading', { name: 'This copy of the app' })).toBeVisible();
  const rows = await rowsOf(page);
  expect(rows.slice(0, 3)).toEqual([
    `Opened from | http://127.0.0.1:5188${sharePointFolderPath}/`,
    'Site | None: this is the local server (plain http, or this computer)',
    "Lists | The local server's own files (no settings file is read here)",
  ]);
  expect(rows).toHaveLength(4);
  await expect(page.getByRole('heading', { name: 'Where the lists are' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check Lists' })).toBeEnabled();
  expect(asked).toEqual([]);
  if (browserName === 'chromium') expect(describeFindings((await axeCheck(page, 'Setup on the local server')).findings)).toBe('');
});

test('the label of this copy is in the admin bar, beside the product name, and nowhere else', async ({ page, browserName }) => {
  const admin = (fake: Fake) => fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex('2468') });
  const unlock = async () => {
    await page.getByLabel('PIN').fill('2468');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  };
  const fake = await prefixedSite();
  admin(fake);
  const served = await serveSharePoint(page, fake, { settings: { configVersion: 1, listPrefix: 'PMS3', label: 'Test, folder 3' } });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(pageUrl('admin.html'));
  await expect(page.getByLabel('PIN')).toBeVisible();
  await expect(page.getByText('Test, folder 3'), 'not on the PIN screen').toHaveCount(0);
  await unlock();
  const label = page.getByTestId('copy-label');
  await expect(label).toHaveText('Test, folder 3');
  await expect(page.locator('.shell__bar .shell__brand').getByTestId('copy-label')).toBeVisible();
  await expect(page.getByText('Test, folder 3')).toHaveCount(1);
  const findings = browserName === 'chromium' ? [...(await axeCheck(page, 'admin bar with a label (1280)')).findings] : [];
  await page.screenshot({ path: `${shots}admin-label-${browserName}.png` });

  // The longest label there can be, on a phone: it wraps inside the bar and nothing runs off the side.
  served.settings = { configVersion: 1, listPrefix: 'PMS3', label: 'Regional leadership offsite, test copy 3' };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await unlock();
  await expect(label).toHaveText('Regional leadership offsite, test copy 3');
  await expect.poll(() => noSidewaysScroll(page)).toBe(true);
  if (browserName === 'chromium') findings.push(...(await axeCheck(page, 'admin bar with the longest label (390)')).findings);
  expect(describeFindings(findings)).toBe('');
  await page.screenshot({ path: `${shots}admin-label-phone-${browserName}.png` });

  // A copy with no label has none: nothing is put in its place.
  served.settings = { configVersion: 1, listPrefix: 'PMS3' };
  await page.reload();
  await unlock();
  await expect(label).toHaveCount(0);
  // The participant page and Setup's own bar do not show it (Setup lists it as a row of its panel).
  served.settings = { configVersion: 1, listPrefix: 'PMS3', label: 'Test, folder 3' };
  await page.goto(pageUrl('index.html'));
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  await expect(page.getByText('Test, folder 3')).toHaveCount(0);
});
