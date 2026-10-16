import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../migration/src/lib/sha256.js';
import { localDate } from '../../migration/src/lib/admin-today.js';
import { makeImage } from './brand-images.js';
import { newFake, onSite, pageUrl, seedAndGoLive, serveSharePoint, shape, type Fake } from './sharepoint.js';
import { TITLE } from '../sharepoint-fake.js';

// Brand Studio on SharePoint: the BUILT admin and participant pages served at the approved host's address, against the
// mocked SharePoint REST (scripts/sharepoint-fake.js, which now has a ClientLogos library and counts every request).
// The request budgets of opening Brand Studio, saving, and one upload; where the pictures go (the ClientLogos library,
// flat names, ThemeJson) and that a participant's page reads them back. It is not the real tenant: whether uploads to
// ClientLogos are allowed for this user, and whether participants may read the files, only the test site can show.

const results = fileURLToPath(new URL('../../test-results/budget/', import.meta.url));
const shots = fileURLToPath(new URL('../../test-results/admin/', import.meta.url));
const measured: Record<string, unknown> = {};
const today = localDate();
const PIN = '2468';

test.afterAll(async () => {
  await mkdir(results, { recursive: true });
  await writeFile(`${results}brand-studio-sharepoint.json`, `${JSON.stringify(measured, null, 2)}\n`);
});

async function site() {
  const fake = newFake();
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex(PIN) });
  await seedAndGoLive(fake, 'c-kroger', today);
  return fake;
}

async function openClients(page: Page, fake: Fake) {
  const served = await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('admin.html')}#clients`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  fake.reset();
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
  await expect(page.locator('.row').filter({ hasText: 'Kroger' })).toBeVisible();
  return served;
}

const quiet = (page: Page) => page.waitForTimeout(400);
const card = (page: Page, slot: string) => page.locator(`section.asset[data-slot="${slot}"]`);
const crop = (page: Page) => page.getByRole('dialog', { name: /Crop and fit/ });
const words = (fake: Fake) => fake.requests.map(shape);

test('opening Brand Studio costs no request of its own; Save costs 1 read and 1 write; one new picture adds the upload; replacing it adds the removal', async ({ page }) => {
  const fake = await site();
  const served = await openClients(page, fake);
  measured['Clients tab, from the PIN (AdminUsers, the write token, one batch for AppSettings, Clients, Sessions and Sections)'] = fake.count();
  await quiet(page);

  // Open: the client is already on the page from the list, the preview needs no data, the fonts are in the page.
  fake.reset();
  await page.locator('.row').filter({ hasText: 'Kroger' }).getByRole('button', { name: 'Brand' }).click();
  await expect(page.getByRole('heading', { name: /Brand Studio · Kroger/ })).toBeVisible();
  await expect(page.frameLocator('iframe[data-device]').getByRole('heading', { name: 'Hi Jane Doe!' })).toBeVisible();
  await page.frameLocator('iframe[data-device]').locator('.shell').evaluate(() => document.fonts.ready);
  await quiet(page);
  expect(words(fake), 'opening Brand Studio sends nothing').toEqual([]);
  measured['Open Brand Studio from the Clients list'] = fake.count();

  // A colour change: one read of the client (has anyone else changed it?), then one write of it.
  await page.getByRole('button', { name: /Teal/ }).click();
  fake.reset();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('brand-status')).toHaveText('All changes saved');
  await quiet(page);
  measured['Save a colour change'] = { requests: fake.count(), shapes: words(fake) };
  expect(fake.count((entry) => entry.method === 'GET' && entry.list === 'clients'), 'the freshness read').toBeGreaterThanOrEqual(1);
  expect(fake.count((entry) => ['MERGE', 'POST'].includes(entry.method) && entry.list === 'clients' && /items\(/.test(entry.path))).toBe(1);
  expect(fake.count(), 'a colour save is small').toBeLessThanOrEqual(8);
  const stored = JSON.parse(fake.item('clients', 'c-kroger').ThemeJson);
  expect([stored.primary, stored.version]).toEqual(['#0A6B6B', 2]);
  expect([fake.item('clients', 'c-kroger').ThemeVersion, fake.item('clients', 'c-kroger').PrimaryColor]).toEqual([2, stored.tokens['--bg-mid']]);

  // One new picture: it is cropped in the browser, then Save puts it in ClientLogos and writes the theme once.
  const hero = await makeImage(page, { width: 1300, height: 1300, type: 'image/png', paint: 'photo' });
  await card(page, 'hero').locator('input[type="file"]').setInputFiles({ name: 'badge.png', mimeType: 'image/png', buffer: hero });
  await expect(crop(page)).toBeVisible();
  fake.reset();
  await crop(page).getByRole('button', { name: 'Use this picture' }).click();
  await expect(card(page, 'hero').getByTestId('hero-status')).toHaveText('Not saved yet');
  await quiet(page);
  expect(words(fake), 'cropping and compressing happen in the browser: no request').toEqual([]);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('brand-status')).toHaveText('All changes saved');
  await quiet(page);
  measured['Save with one new picture (hero)'] = { requests: fake.count(), shapes: words(fake) };
  const uploadsMade = [...fake.files.keys()];
  expect(uploadsMade).toHaveLength(1);
  expect(uploadsMade[0]).toMatch(new RegExp(`^${fake.libraryFolder}/kroger-hero-[0-9a-f]{10}\\.(webp|png)$`));
  expect(fake.count((entry) => entry.path.includes('/Files/add')), 'one file').toBe(1);
  const afterHero = JSON.parse(fake.item('clients', 'c-kroger').ThemeJson);
  expect(afterHero.assets.hero).toBe(`https://americas.internal.deloitteonline.com${uploadsMade[0]}`);
  expect(afterHero.version).toBe(3);
  // The upload itself, as its own cost: the folder, the write token (once a page), the file.
  measured['  of which the upload (library folder, write token, the file)'] = fake.count((entry) => /ClientLogos|Files\/add|contextinfo/.test(entry.path));

  // Replace it: the new file, the client, and the old file removed (into the recycle bin).
  await card(page, 'hero').locator('input[type="file"]').setInputFiles({ name: 'badge-2.png', mimeType: 'image/png', buffer: await makeImage(page, { width: 1300, height: 1300, type: 'image/png', paint: 'marker' }) });
  await crop(page).getByRole('button', { name: 'Use this picture' }).click();
  await expect(card(page, 'hero').getByTestId('hero-status')).toHaveText('Not saved yet');
  fake.reset();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('brand-status')).toHaveText('All changes saved');
  await quiet(page);
  measured['Save replacing that picture (adds the removal of the old one)'] = { requests: fake.count(), shapes: words(fake) };
  expect(fake.recycled.map((file) => file.path)).toEqual([uploadsMade[0]]);
  expect([...fake.files.keys()]).toHaveLength(1);
  expect(fake.count((entry) => entry.path.includes('recycle'))).toBe(1);
  expect(served.unexpected, 'nothing outside the site was asked for').toEqual([]);
});

test('on SharePoint a participant\'s page reads the uploaded hero from the library and shows it; an SVG is never offered an upload', async ({ page, browser }) => {
  const fake = await site();
  await openClients(page, fake);
  await page.locator('.row').filter({ hasText: 'Kroger' }).getByRole('button', { name: 'Brand' }).click();
  // SVG: refused in the browser, nothing sent to the library.
  fake.reset();
  await card(page, 'logo').locator('input[type="file"]').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>') });
  await expect(card(page, 'logo').getByRole('alert')).toContainText('SVG drawings are not accepted');
  expect(fake.count((entry) => entry.path.includes('Files/add'))).toBe(0);

  await card(page, 'hero').locator('input[type="file"]').setInputFiles({ name: 'badge.png', mimeType: 'image/png', buffer: await makeImage(page, { width: 1300, height: 1300, type: 'image/png', paint: 'photo' }) });
  await crop(page).getByRole('button', { name: 'Use this picture' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('brand-status')).toHaveText('All changes saved');

  const guest = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestPage = await guest.newPage();
  const served = await serveSharePoint(guestPage, fake);
  await guestPage.goto(pageUrl('index.html'));
  const badge = guestPage.locator('.pms-badge');
  await expect(badge).toHaveClass(/pms-badge-ready/);
  expect(await badge.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([1200, 1200]);
  expect(served.pictures.length, 'the page asked the library for the picture').toBeGreaterThanOrEqual(1);
  expect(served.pictures[0]).toMatch(new RegExp(`\\/${TITLE.logoLibrary}\\/kroger-hero-[0-9a-f]{10}\\.(webp|png)$`));
  await guestPage.screenshot({ path: `${shots}brand-sharepoint-participant.png` });
  await guest.close();
});

test('the first write on a freshly opened page also needs the write token and the list\'s columns: what one picture costs from cold', async ({ page }) => {
  const fake = await site();
  await openClients(page, fake);
  await page.locator('.row').filter({ hasText: 'Kroger' }).getByRole('button', { name: 'Brand' }).click();
  await card(page, 'hero').locator('input[type="file"]').setInputFiles({ name: 'badge.png', mimeType: 'image/png', buffer: await makeImage(page, { width: 1300, height: 1300, type: 'image/png', paint: 'photo' }) });
  await crop(page).getByRole('button', { name: 'Use this picture' }).click();
  await expect(card(page, 'hero').getByTestId('hero-status')).toHaveText('Not saved yet');
  fake.reset();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('brand-status')).toHaveText('All changes saved');
  await quiet(page);
  measured['First Save on a page, with one new picture (adds the write token and the list\'s columns)'] = { requests: fake.count(), shapes: words(fake) };
  expect(fake.count()).toBeLessThanOrEqual(10);
  expect(fake.count((entry) => entry.path.endsWith('/contextinfo')), 'one write token for the whole Save').toBeLessThanOrEqual(1);
});
