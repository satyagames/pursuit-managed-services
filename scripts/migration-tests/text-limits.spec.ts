import { test, expect } from '@playwright/test';
import { activityTitles, openAdmin, startLocal, stopLocal, type Local } from './admin-local.js';

// Phase 10c-3, part F: an answer's text and a client's name take the 255 characters a single line of text holds on SharePoint (pms-schema-meta.js),
// with a plain message at the limit. The BUILT admin page against the real local server on a scratch copy of server/data; the data layer refuses a
// longer line on both adapters (scripts/test-text-limits.js).

let local: Local;
test.beforeEach(async () => { local = await startLocal(); });
test.afterEach(async () => { await stopLocal(local); });
const LONG = 'x'.repeat(300);

test('an answer\'s text stops at 255 characters and says so, and the question saves', async ({ page }) => {
  await openAdmin(page, local, 'Content');
  await page.getByRole('button', { name: 'Add activity' }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Long answers');
  await page.getByRole('dialog').getByRole('button', { name: 'Add activity' }).click();
  await expect(activityTitles(page).last()).toHaveText('Long answers');
  await page.getByRole('button', { name: 'Add question' }).click();
  await page.getByLabel('Question', { exact: true }).fill('Which is longer?');
  await expect(page.getByTestId('option-limit')).toHaveCount(0);
  await page.getByLabel('Option 1 text').fill(LONG);
  await expect(page.getByLabel('Option 1 text')).toHaveValue('x'.repeat(255));
  await expect(page.getByTestId('option-limit')).toHaveText("255 characters: the most an answer's text can hold.");
  await page.getByLabel('Option 2 text').fill('Short');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Saved');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a client\'s name stops at 255 characters and says so', async ({ page }) => {
  await openAdmin(page, local, 'Clients');
  await page.getByRole('button', { name: 'Add client' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Acme');
  await expect(page.locator('#name-limit')).toHaveCount(0);
  await page.getByLabel('Name', { exact: true }).fill(LONG);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('x'.repeat(255));
  await expect(page.locator('#name-limit')).toHaveText("255 characters: the most a client's name can hold.");
  await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('aria-describedby', 'name-limit');
});
