import { test, expect, type Page } from '@playwright/test';
import { ds, openAdmin, startLocal, stopLocal, today, type Local } from './admin-local.js';
import { axeCheck, describeFindings } from './a11y-support.js';

// Phase 15, part 3: the client's Animations switch on the admin page, against the real local server. Brand Studio's switch and Today's quick
// switch write the one stored value (ThemeJson `motion.enabled`), each is a switch a screen reader announces and the keyboard works, a failed
// save puts the switch back and says so, and axe finds nothing on either screen. What a participant then sees is motion.spec.ts.

let local: Local;
test.beforeEach(async () => { local = await startLocal(); });
test.afterEach(async () => { await stopLocal(local); });

const theSwitch = (page: Page) => page.getByRole('switch', { name: /^Animations/ });
const stored = async (clientId = 'c-kroger') => ((await ds.getClient(clientId)) as { theme?: { motion?: { enabled?: unknown } } }).theme?.motion?.enabled;

async function openBrand(page: Page, name = 'Kroger') {
  await openAdmin(page, local, 'Clients');
  await page.locator('.row').filter({ hasText: name }).getByRole('button', { name: 'Brand' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`Brand Studio · ${name}`) })).toBeVisible();
}

test('Today and Brand Studio flip the same stored value, by keyboard as well as by tap, and say so', async ({ page }) => {
  test.setTimeout(90_000);
  await ds.activateClient('c-kroger', today);
  const version = ((await ds.getClient('c-kroger')) as { themeVersion?: number }).themeVersion;
  await openAdmin(page, local);
  const quick = theSwitch(page);
  await expect(quick).toHaveAttribute('aria-checked', 'true');
  await expect(quick).toContainText('On');
  await quick.focus();
  await page.keyboard.press('Space');
  await expect(quick).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.toast')).toContainText('Animations are off for Kroger');
  await expect.poll(() => stored()).toBe(false);
  expect(((await ds.getClient('c-kroger')) as { themeVersion?: number }).themeVersion, 'the theme\'s version is not moved by the switch').toBe(version);

  await openBrand(page);
  const studio = theSwitch(page);
  await expect(studio, 'Brand Studio shows what Today saved').toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('Turns the screen transitions and the celebration confetti on or off for participants.')).toBeVisible();
  await expect(page.getByTestId('brand-status'), 'the switch is saved as it is flipped: it is never an unsaved change').toHaveText('All changes saved');
  await studio.focus();
  await page.keyboard.press('Enter');
  await expect(studio).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => stored()).toBe(true);
  await expect(page.getByTestId('brand-status')).toHaveText('All changes saved');
  const box = await studio.boundingBox();
  expect(box!.height, '44 px target').toBeGreaterThanOrEqual(44);
});

test('a save that fails puts the switch back to the saved value and says it could not save', async ({ page }) => {
  test.setTimeout(60_000);
  await ds.activateClient('c-kroger', today);
  await openAdmin(page, local);
  await page.route('**/api/clients/c-kroger', (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"The list is busy."}' }) : route.fallback()));
  await theSwitch(page).click();
  await expect(page.locator('.toast')).toContainText('Could not save the animations setting.');
  await expect(theSwitch(page)).toHaveAttribute('aria-checked', 'true');
  expect(await stored()).not.toBe(false);
});

test('a colour saved in Brand Studio and the switch flipped on Today by another admin: both are kept', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await ds.activateClient('c-kroger', today);
  await openBrand(page);
  await page.getByRole('button', { name: /Teal/ }).click();
  const other = await browser.newContext();
  const second = await other.newPage();
  await openAdmin(second, local);
  await theSwitch(second).click();
  await expect(theSwitch(second)).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => stored()).toBe(false);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('brand-status')).toHaveText('All changes saved');
  const client = (await ds.getClient('c-kroger')) as { theme: { primary: string; motion?: { enabled: boolean } } };
  expect(client.theme.primary.toUpperCase(), 'the colour').toBe('#0A6B6B');
  expect(client.theme.motion?.enabled, 'and the switch').toBe(false);
  await other.close();
});

test('axe finds nothing on Today and in Brand Studio with the switch on them', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'axe runs in Chromium, as a11y.spec.ts does');
  test.setTimeout(90_000);
  await ds.activateClient('c-kroger', today);
  await openAdmin(page, local);
  await expect(theSwitch(page)).toBeVisible();
  const onToday = await axeCheck(page, 'Today with the Animations switch');
  expect(onToday.findings, describeFindings(onToday.findings)).toEqual([]);
  await openBrand(page);
  await expect(theSwitch(page)).toBeVisible();
  const inStudio = await axeCheck(page, 'Brand Studio with the Animations switch', { exclude: ['iframe'] });
  expect(inStudio.findings, describeFindings(inStudio.findings)).toEqual([]);
});
