import { test, expect, type Page, type Route } from '@playwright/test';
import { sha256Hex } from '../../migration/src/lib/admin/sha256.js';
import { localDate } from '../../migration/src/lib/admin/admin-today.js';
import { newFake, pageUrl, seedAndGoLive, serveSharePoint, settingsOf, type Fake } from './sharepoint.js';
import { axeCheck } from './a11y-support.js';

// Prompt 19: a SharePoint sign-in that stops being accepted while the admin page is open, on the BUILT admin page against the mocked SharePoint
// REST (scripts/sharepoint-fake.js: expireSession() refuses every /_api request with "Access denied" until renewSession()). Step B's hidden
// frame really loads: it navigates to the page's own pms-config.txt, which this test serves, and that request is where the test lets the
// "site" renew the sign-in or not. It is not SharePoint Online: whether a navigation renews a real sign-in is QA-TESTING.md's to see.

const PIN = '2468';
const today = localDate();

async function site() {
  const fake = newFake();
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex(PIN) });
  await seedAndGoLive(fake, 'c-kroger', today);
  return fake;
}

/** Serves the site; the settings file renews the sign-in when the renewer's frame asks for it and `renewal.works`. */
async function serve(page: Page, fake: Fake) {
  const renewal = { works: true, asked: 0 };
  const settings = settingsOf(fake);
  await serveSharePoint(page, fake, {
    settings: (route: Route) => {
      if (new URL(route.request().url()).searchParams.has('renew')) {
        renewal.asked += 1;
        if (renewal.works) fake.renewSession();
      }
      return route.fulfill({ contentType: 'text/plain; charset=utf-8', body: JSON.stringify(settings) });
    },
  });
  return renewal;
}

async function unlock(page: Page, hash = '#clients') {
  await page.goto(`${pageUrl('admin.html')}${hash}`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
}
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const banner = (page: Page) => page.getByTestId('session-banner');
const RAW = /\b403\b|access denied|you do not have permission|FedAuth|digest|token/i;
/** The page's words, without the banner's Details (which holds SharePoint's own on purpose). */
const shownWords = (page: Page) => page.evaluate(() => {
  const copy = document.body.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[data-testid="session-details"], script, style').forEach((node) => node.remove());
  return copy.innerText;
});

test('a sign-in that stopped being accepted is renewed by the hidden frame: the screen loads, nothing is said, the frame is gone', async ({ page }) => {
  const fake = await site();
  const renewal = await serve(page, fake);
  await unlock(page);
  await expect(page.locator('.row').filter({ hasText: 'Kroger' })).toBeVisible();
  fake.reset();
  fake.expireSession();
  await tab(page, 'Guests and QR').click();
  await expect(page.getByRole('heading', { name: 'Guests and QR', exact: true })).toBeVisible();
  await expect(page.getByText('Could not load Guests and QR.')).toHaveCount(0);
  await expect.poll(() => fake.sessionExpired).toBe(false);
  await page.waitForTimeout(500);
  await expect(banner(page)).toHaveCount(0);
  expect(renewal.asked).toBe(1);
  expect(fake.count((entry) => entry.path.endsWith('/_api/web') && entry.method === 'GET')).toBe(1);
  await expect(page.locator('iframe[data-session-renewer]')).toHaveCount(0);
  expect(await shownWords(page)).not.toMatch(RAW);
});

test('a sign-in that cannot be renewed: one calm banner, no SharePoint words on the screen, the guid in Details; a later answer clears it', async ({ page }) => {
  const fake = await site();
  const renewal = await serve(page, fake);
  await unlock(page);
  await expect(page.locator('.row').filter({ hasText: 'Kroger' })).toBeVisible();
  renewal.works = false;
  fake.expireSession();
  const focused = await page.evaluate(() => document.activeElement?.textContent ?? '');
  await tab(page, 'Guests and QR').click();
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toHaveAttribute('role', 'alert');
  await expect(banner(page)).toContainText('Your SharePoint sign-in needs refreshing. Reload this page to carry on.');
  await expect(page.getByText('Could not load Guests and QR.')).toBeVisible();
  expect(await shownWords(page)).not.toMatch(RAW);
  expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="session-banner"]') === null)).toBe(true);
  expect(focused).toBeDefined();
  await banner(page).getByText('Details', { exact: true }).click();
  await expect(page.getByTestId('session-details')).toContainText(/SPRequestGuid fa\d{6}-/);
  await expect(page.getByTestId('session-details')).toContainText('403');
  await expect(page.getByTestId('session-details')).toContainText('since the last answer');
  await expect(page.locator('iframe[data-session-renewer]')).toHaveCount(0);
  expect(renewal.asked).toBe(1);
  // The site answers again (the person signed in elsewhere): the next request clears the banner and says so.
  fake.renewSession();
  await tab(page, 'Today').click();
  await expect(page.getByRole('status').filter({ hasText: 'Reconnected.' })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test('Reload reloads; the banner does not reload by itself', async ({ page }) => {
  const fake = await site();
  const renewal = await serve(page, fake);
  await unlock(page);
  await expect(page.locator('.row').filter({ hasText: 'Kroger' })).toBeVisible();
  renewal.works = false;
  fake.expireSession();
  await tab(page, 'Guests and QR').click();
  await expect(banner(page)).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByRole('heading', { name: 'Guests and QR', exact: true })).toBeVisible();
  fake.renewSession();
  await Promise.all([page.waitForEvent('load'), banner(page).getByRole('button', { name: 'Reload' }).click()]);
  await expect(page.getByRole('textbox', { name: 'PIN' })).toBeVisible();
});

test('unsaved Brand changes: the banner warns, offers to stay, and nothing is lost', async ({ page }) => {
  const fake = await site();
  const renewal = await serve(page, fake);
  await unlock(page, '#content/brand');
  await expect(page.getByRole('heading', { level: 3, name: 'Brand · Kroger' })).toBeVisible();
  await page.getByLabel('Primary', { exact: true }).fill('#5B3A99');
  renewal.works = false;
  fake.expireSession();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText('Your unsaved changes here will be lost if you reload.');
  await expect(page.getByText('Could not save this look.')).toBeVisible();
  await expect(page.getByLabel('Primary', { exact: true })).toHaveValue(/#5b3a99/i);
  await banner(page).getByRole('button', { name: 'Stay on this page' }).click();
  await expect(banner(page)).toHaveCount(0);
  await expect(page.getByLabel('Primary', { exact: true })).toHaveValue(/#5b3a99/i);
  await expect(page.getByRole('heading', { level: 3, name: 'Brand · Kroger' })).toBeVisible();
});

test('the banner: axe finds nothing, its controls are reached with the keyboard, and Details opens with Enter', async ({ page }) => {
  const fake = await site();
  const renewal = await serve(page, fake);
  await unlock(page);
  await expect(page.locator('.row').filter({ hasText: 'Kroger' })).toBeVisible();
  renewal.works = false;
  fake.expireSession();
  await tab(page, 'Guests and QR').click();
  await expect(banner(page)).toBeVisible();
  const { findings } = await axeCheck(page, 'session banner');
  expect(findings).toEqual([]);
  const reload = banner(page).getByRole('button', { name: 'Reload' });
  await reload.focus();
  await expect(reload).toBeFocused();
  const box = await reload.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Tab');
  const summary = banner(page).locator('summary');
  await expect(summary).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('session-details')).toBeVisible();
  expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
