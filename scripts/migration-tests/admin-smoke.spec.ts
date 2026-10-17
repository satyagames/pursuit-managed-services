import { test, expect } from '@playwright/test';
import { sha256Hex } from '../../migration/src/lib/admin/sha256.js';
import { localDate } from '../../migration/src/lib/admin/admin-today.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';
import { newFake, onSite, pageUrl, serveSharePoint } from './sharepoint.js';

// A short pass over the built admin page, run on Chromium and on WebKit (the engine of every iPad
// browser): unlock, go live, every tab opens, nothing throws, nothing is asked of any host but the
// site. The mocked SharePoint REST answers; it is not the real tenant.

const today = localDate();

test('admin smoke: unlock, go live, switch tabs, no errors and no stray requests', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') problems.push(`console: ${message.text()}`); });
  const fake = newFake();
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex('2468') });
  await onSite(fake, (ds) => seedPack(ds, samplePack()));
  const served = await serveSharePoint(page, fake);

  await page.goto(pageUrl('admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('tab')).toHaveText(['Today', 'Clients', 'Content', 'Guests and QR', 'Results']);
  await expect(page.locator('section[data-live]')).toContainText('NOT LIVE');
  await expect(page.getByLabel('Date')).toHaveValue(today);
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Kroger' });
  await expect(page.locator('[data-check="lists"]')).toHaveAttribute('data-level', 'pass');
  await page.getByRole('button', { name: 'Go live' }).click();
  await expect(page.getByText('Verified: participants now see Kroger')).toBeVisible();
  await expect(page.locator('section[data-live]')).toContainText('LIVE');
  await expect(page.getByRole('img', { name: 'QR code for the participant link' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Staff sign in/ })).toBeChecked();
  await page.getByRole('radio', { name: /^Open/ }).check();
  await expect.poll(() => fake.item('sessions', `kroger-${today}`)?.ActivityFlow).toBe('open');

  // The keyboard reaches the tab row, and arrows move along it.
  await page.getByRole('tab', { name: 'Today' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Clients' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.row').filter({ hasText: 'Kroger' })).toContainText('LIVE NOW');
  await expect(page.locator('.row').filter({ hasText: "Domino's" })).toContainText('Last live never');
  for (const [tab, heading] of [['Content', 'Content'], ['Guests and QR', 'Guests and QR'], ['Results', 'Results']]) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
  }
  await page.getByRole('tab', { name: 'Today' }).click();
  await expect(page.locator('section[data-live]')).toContainText('Kroger');
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('textbox', { name: 'PIN' })).toBeVisible();

  expect(served.unexpected).toEqual([]);
  expect(problems).toEqual([]);
});
