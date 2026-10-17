import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../migration/src/lib/admin/sha256.js';
import { localDate } from '../../migration/src/lib/admin/admin-today.js';
import { TITLE } from '../sharepoint-fake.js';
import { newFake, onSite, pageUrl, seedAndGoLive, serveSharePoint, shape, type Fake } from './sharepoint.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';

// The BUILT admin page in SharePoint mode, served at the approved host's address, against the mocked
// SharePoint REST (scripts/sharepoint-fake.js), which counts every request. These are the request
// budgets of the Today screen measured in a real browser: what it sends to load, to refresh, and to go
// live. It is not the real tenant.

const results = fileURLToPath(new URL('../../test-results/budget/', import.meta.url));
const measured: Record<string, unknown> = {};
const today = localDate();
const PIN = '2468';

test.afterAll(async () => {
  await mkdir(results, { recursive: true });
  await writeFile(`${results}admin-sharepoint.json`, `${JSON.stringify(measured, null, 2)}\n`);
});

/** A site with an admin, both sample clients, and (optionally) one of them live. */
async function site(options: Parameters<typeof newFake>[0] = {}, live: string | null = null) {
  const fake = newFake(options);
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex(PIN) });
  if (live) await seedAndGoLive(fake, live, today);
  else await onSite(fake, (ds) => seedPack(ds, samplePack()));
  return fake;
}

async function openAdmin(page: Page, fake: Fake) {
  const served = await serveSharePoint(page, fake);
  await page.goto(pageUrl('admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  return served;
}

const unlock = (page: Page) => page.getByRole('button', { name: 'Unlock' }).click();
const goLiveButton = (page: Page) => page.getByRole('button', { name: /^(Go live|Going live\.\.\.|Checking\.\.\.|Already live)$/ });
const pickClient = (page: Page, name: string) => page.getByLabel('Client', { exact: true }).selectOption({ label: name });
const quiet = (page: Page) => page.waitForTimeout(400);

test('Today loads in at most 6 requests from the PIN, with nothing live and with a client live', async ({ page }) => {
  for (const live of [null, 'c-kroger']) {
    const fake = await site({}, live);
    const served = await openAdmin(page, fake);
    fake.reset();
    await unlock(page);
    await expect(page.getByTestId('go-live-why').or(goLiveButton(page)).first()).toBeVisible();
    await expect(page.getByTestId('readiness-summary')).not.toContainText('Checking');
    await quiet(page);
    const sent = fake.requests.map(shape);
    expect(sent.length, `from Unlock to Today: ${sent.join(' | ')}`).toBeLessThanOrEqual(6);
    // The PIN check, the write token, the lists, every list's columns, and the picked client's questions and options.
    expect(sent.filter((entry) => entry.startsWith('POST /$batch')).length).toBe(3);
    expect(sent.filter((entry) => !entry.startsWith('POST /$batch') && entry !== 'POST /contextinfo')).toEqual(['GET adminusers']);
    expect(fake.requests.filter((entry) => entry.method !== 'GET' && !/contextinfo|\$batch/.test(entry.path)), 'it only reads').toEqual([]);
    expect(served.unexpected).toEqual([]);
    measured[`todayLoad_${live ?? 'nothingLive'}`] = { requests: sent.length, breakdown: sent };
    if (live) await expect(page.getByTestId('participants')).toHaveText('0');
    await page.goto('about:blank');
  }
});

test('the status panel refreshes with one request every 10 seconds, none while the tab is hidden, and one more only when what is live changed', async ({ page }) => {
  const fake = await site({}, 'c-kroger');
  await page.clock.install();
  await openAdmin(page, fake);
  await unlock(page);
  await expect(page.getByTestId('participants')).toHaveText('0');
  await quiet(page);

  const windows: number[] = [];
  for (let window = 0; window < 3; window += 1) {
    fake.reset();
    await page.clock.runFor(10_000);
    await expect.poll(() => fake.requests.length).toBeGreaterThan(0);
    await quiet(page);
    windows.push(fake.requests.length);
    expect(fake.requests.map(shape), `window ${window}`).toEqual(['POST /$batch']);
    expect(fake.requests[0].parts!.map(shape)).toEqual(['GET appsettings', 'GET sessions', 'GET tracks']);
  }
  expect(Math.max(...windows)).toBeLessThanOrEqual(2);

  // A participant joins: the next refresh shows them.
  await onSite(fake, (ds) => ds.beginVisit(crypto.randomUUID(), `kroger-${today}`, 'c-kroger'));
  await page.clock.runFor(10_000);
  await expect(page.getByTestId('participants')).toHaveText('1');

  // Hidden: nothing is sent. Visible again: one refresh at once.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
  fake.reset();
  await page.clock.runFor(30_000);
  await quiet(page);
  expect(fake.requests.length, 'a hidden tab asks for nothing').toBe(0);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => fake.requests.length).toBe(1);

  // Another admin makes Domino's live: one refresh finds out (2 requests), and the page then reloads itself once.
  await onSite(fake, (ds) => ds.activateClient('c-dominos', today));
  fake.reset();
  await page.clock.runFor(10_000);
  await expect(page.locator('section[data-live]')).toContainText("Domino's");
  await quiet(page);
  const found = fake.requests.map(shape);
  expect(found.slice(0, 2)).toEqual(['POST /$batch', 'POST /$batch']);
  measured.poll = { perTenSeconds: windows, hiddenTab: 0, whenSomethingElseBecameLive: { toFindOut: 2, thenThePageReloads: found.length - 2 } };
});

test('Go live costs only what it needs: the session, AppSettings, and one read to prove it', async ({ page }) => {
  const fake = await site();
  await openAdmin(page, fake);
  await unlock(page);
  await pickClient(page, 'Kroger');
  await expect(goLiveButton(page)).toBeEnabled();
  await expect(page.getByTestId('readiness-summary')).not.toContainText('Checking');
  await quiet(page);

  fake.reset();
  await goLiveButton(page).click();
  await expect(page.getByText('Verified: participants now see Kroger')).toBeVisible();
  await quiet(page);
  const first = fake.requests.map(shape);
  // (Since Phase 10c-2b the AppSettings item is there before the first Go live: Setup makes it, with the lists' version. Go live updates it.)
  expect(fake.requests.filter((entry) => entry.method !== 'GET' && entry.list).map(shape)).toEqual(['POST sessions', 'MERGE appsettings']);
  expect(first.at(-1)).toBe('GET appsettings');
  expect(first.length, first.join(' | ')).toBeLessThanOrEqual(14);
  measured.goLive_firstOfTheDay = { requests: first.length, breakdown: first };
  expect(fake.item('appsettings', 'default')).toMatchObject({ ActiveSessionId: `kroger-${today}`, ActiveClientId: 'c-kroger' });

  // Switching with nobody in the first client: no confirmation, and nothing is written but the new session and AppSettings.
  await pickClient(page, "Domino's");
  await quiet(page);
  fake.reset();
  await goLiveButton(page).click();
  await expect(page.getByText("Verified: participants now see Domino's")).toBeVisible();
  await quiet(page);
  const switched = fake.requests.map(shape);
  expect(fake.requests.filter((entry) => entry.method !== 'GET' && !/contextinfo|\$batch/.test(entry.path)).map(shape)).toEqual(['POST sessions', 'MERGE appsettings']);
  measured.goLive_switchingClient = { requests: switched.length, breakdown: switched };

  // Pressing it again for the client that is live: the button says so and sends nothing.
  fake.reset();
  await expect(goLiveButton(page)).toHaveText('Already live');
  await expect(goLiveButton(page)).toBeDisabled();
  await quiet(page);
  expect(fake.requests.filter((entry) => entry.method !== 'GET' && !/\$batch|contextinfo/.test(entry.path))).toEqual([]);
  expect(fake.lists.get('sessions')!.map((row) => row.AppId).sort()).toEqual([`dominos-${today}`, `kroger-${today}`]);
});

test('a missing SharePoint list or column is a blocker that names it; a missing index is only a warning', async ({ page }) => {
  // A column the app needs is missing: the site is seeded first, and the column taken away afterwards. (A list Today does not read as it loads:
  // since Phase 10h every item read names its columns, and a read that names one the list lacks is refused, below.)
  let fake = await site();
  fake.fields.set('qrtokens', fake.fields.get('qrtokens')!.filter((column) => column.InternalName !== 'UsedAt'));
  await openAdmin(page, fake);
  await unlock(page);
  await pickClient(page, 'Kroger');
  const lists = page.locator('[data-check="lists"]');
  await expect(lists).toHaveAttribute('data-level', 'blocker');
  // (Today names the column; how to create it, its type in words, is Setup's: the admin page does not carry pms-schema-meta.js.)
  await expect(lists).toContainText(`${TITLE.qrtokens}.UsedAt: Missing.`);
  await expect(lists).toContainText('SHAREPOINT-LISTS.md');
  await expect(goLiveButton(page)).toBeDisabled();
  await expect(page.getByTestId('go-live-why')).toContainText('Fix this first: SharePoint lists.');
  await expect(lists.getByRole('link', { name: 'Open Setup' })).toHaveAttribute('href', './setup.html');
  await page.goto('about:blank');

  // A column missing from a list Today reads as it loads (Phase 10h): the read names it, the site refuses it (as SharePoint is believed to: QA-TESTING.md
  // item 141), and Today says it cannot load, in the site's words, which name the column. Nothing can go live. (Until Phase 10h the read named no
  // columns and Today showed this as the blocker above.)
  fake = await site();
  fake.fields.set('clients', fake.fields.get('clients')!.filter((column) => column.InternalName !== 'Slug'));
  await openAdmin(page, fake);
  await unlock(page);
  await expect(page.getByRole('alert')).toContainText('Could not load Today');
  await expect(page.getByRole('alert')).toContainText("The field or property 'Slug' does not exist.");
  await expect(goLiveButton(page)).toHaveCount(0);
  await page.goto('about:blank');

  // A list that is not there at all.
  fake = await site({ without: ['uservisitlogs'] });
  await openAdmin(page, fake);
  await unlock(page);
  await pickClient(page, 'Kroger');
  await expect(page.locator('[data-check="lists"]')).toHaveAttribute('data-level', 'blocker');
  await expect(page.locator('[data-check="lists"]')).toContainText(TITLE.uservisitlogs);
  await expect(goLiveButton(page)).toBeDisabled();
  await page.goto('about:blank');

  // Only an index is missing: a warning, and Go live works.
  fake = await site();
  fake.fields.get('sections')!.find((column) => column.InternalName === 'ClientId')!.Indexed = false;
  await openAdmin(page, fake);
  await unlock(page);
  await pickClient(page, 'Kroger');
  await expect(page.locator('[data-check="lists"]')).toHaveAttribute('data-level', 'warning');
  await expect(page.locator('[data-check="lists"]')).toContainText('Not indexed.');
  await expect(goLiveButton(page)).toBeEnabled();
  await goLiveButton(page).click();
  await expect(page.getByText('Verified: participants now see Kroger')).toBeVisible();
});

test('a site that cannot batch still loads Today, one read at a time', async ({ page }) => {
  const fake = await site({}, 'c-kroger');
  fake.failNext({ status: 400, times: 100, when: (entry) => entry.path.endsWith('/$batch') });
  fake.reset();
  await openAdmin(page, fake);
  await unlock(page);
  await expect(page.locator('section[data-live]')).toContainText('Kroger');
  await expect(page.getByTestId('readiness-summary')).not.toContainText('Checking');
  await expect(page.locator('[data-check="lists"]')).toHaveAttribute('data-level', 'pass');
  measured.todayLoad_withoutBatch = { requests: fake.requests.length, breakdown: fake.requests.map(shape) };
});
