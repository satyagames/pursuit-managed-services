import { test, expect, type Page } from '@playwright/test';
import { sha256Hex } from '../../migration/src/lib/admin/sha256.js';
import { localDate } from '../../migration/src/lib/admin/admin-today.js';
import { newFake, pageUrl, seedAndGoLive, serveSharePoint } from './sharepoint.js';

// Prompt 19, Part 4: the admin page's keep-alive (lib/common/session-keepalive.ts) on Playwright's clock, so ten idle minutes take a moment.
// One light read, GET /_api/web?$select=Id, only when no request has been answered for the idle time; a busy screen adds none; a hidden tab
// none; shown again after the idle time, one at once. The BUILT admin page against the mocked SharePoint REST.

const PIN = '2468';
const IDLE = 10 * 60_000;
const proofs = (fake: ReturnType<typeof newFake>) => fake.count((entry) => entry.path.endsWith('/_api/web') && entry.method === 'GET');
const quiet = (page: Page) => page.waitForTimeout(400);

async function open(page: Page, hash: string) {
  const fake = newFake();
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex(PIN) });
  await seedAndGoLive(fake, 'c-kroger', localDate());
  await page.clock.install();
  await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('admin.html')}${hash}`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  return fake;
}

test('an idle screen (Clients) checks its sign-in once after ten quiet minutes, with one light read', async ({ page }) => {
  const fake = await open(page, '#clients');
  await expect(page.locator('.row').filter({ hasText: 'Kroger' })).toBeVisible();
  await quiet(page);
  fake.reset();
  await page.clock.runFor(IDLE - 30_000);
  await quiet(page);
  expect(proofs(fake), 'not before the idle time').toBe(0);
  await page.clock.runFor(40_000);
  await expect.poll(() => proofs(fake)).toBe(1);
  expect(fake.requests.map((entry) => `${entry.method} ${entry.path.replace(/^.*\/_api/, '')}${entry.query}`)).toEqual(['GET /web?$select=Id']);
});

test('a busy screen (Today refreshes every 10 seconds) adds no request in ten minutes', async ({ page }) => {
  const fake = await open(page, '#today');
  await expect(page.getByTestId('participants')).toHaveText('0');
  await quiet(page);
  fake.reset();
  for (let minute = 0; minute < 11; minute += 1) {
    await page.clock.runFor(60_000);
    await quiet(page);
  }
  expect(fake.count(), 'the screen did refresh').toBeGreaterThan(30);
  expect(proofs(fake)).toBe(0);
});

test('no request while the tab is hidden; shown again after the idle time, one at once', async ({ page }) => {
  const fake = await open(page, '#clients');
  await expect(page.locator('.row').filter({ hasText: 'Kroger' })).toBeVisible();
  await quiet(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  fake.reset();
  await page.clock.runFor(IDLE + 60_000);
  await quiet(page);
  expect(fake.count(), 'a hidden tab asks for nothing').toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => proofs(fake)).toBe(1);
});
