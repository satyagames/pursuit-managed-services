import { test, expect } from '@playwright/test';
import { sha256Hex } from '../../migration/src/lib/admin/sha256.js';
import { TITLE } from '../sharepoint-fake.js';
import { newFake, pageUrl, serveSharePoint } from './sharepoint.js';

// Phase 10c-2b, part E, in the BUILT pages, against the mocked SharePoint REST: the version of the lists (SchemaVersion on the AppSettings item
// every page reads first). The participant and admin pages stop on lists of another version with 10b's coded stop screen; Setup opens and says
// which case it is. On version 3 (2 until Phase 10i) every page works (every other spec runs on such a site). Nothing here has met the real tenant: a page opened
// there before Setup has run is QA-TESTING.md's to see.

const PIN = '2468';
/** A site whose AppSettings item says `version` (null: no item at all, as before Setup has run), with an admin who can unlock. */
const site = (version: number | null) => {
  const fake = newFake({ schemaVersion: version });
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex(PIN) });
  return fake;
};

for (const [version, code] of [[null, 'PMS-LST-010'], [2, 'PMS-LST-011'], [4, 'PMS-LST-012']] as const) {
  test(`the participant page on lists ${version === null ? 'that were never set up' : `of version ${version}`} stops with ${code}, at its first read`, async ({ page }) => {
    const fake = site(version);
    await serveSharePoint(page, fake);
    await page.goto(pageUrl('index.html'));
    const heading = page.getByRole('heading', { name: 'This page cannot start' });
    await expect(heading).toBeVisible();
    await expect(page.getByText("This site's lists are not the ones this version of the app needs")).toBeVisible();
    await expect(page.getByText(`Details: ${code}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByRole('button', { name: /begin/i })).toHaveCount(0);
    // The settings item was the first list read; nothing was written, and the page asks nothing more.
    const lists = fake.requests.filter((entry) => entry.list || entry.parts?.length);
    expect(lists[0].list ?? lists[0].parts![0].list).toBe('appsettings');
    expect(fake.requests.filter((entry) => !['GET'].includes(entry.method) && !/contextinfo|\$batch/.test(entry.path))).toEqual([]);
    const seen = fake.requests.length;
    await page.waitForTimeout(1500);
    expect(fake.requests.length, 'and it does not keep looking').toBe(seen);
  });
}

test('the admin page on lists of version 2 unlocks, then stops with PMS-LST-011 at its first read of the settings item', async ({ page }) => {
  const fake = site(1);
  await serveSharePoint(page, fake);
  await page.goto(pageUrl('admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'This page cannot start' })).toBeVisible();
  await expect(page.getByText('Details: PMS-LST-011')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Today' })).toHaveCount(0);
});

test('the admin page on a site with no lists at all stops with PMS-LST-010 at the PIN, its first read', async ({ page }) => {
  const fake = newFake({ schemaVersion: null, without: Object.keys(TITLE).filter((key) => key !== 'logoLibrary') });
  await serveSharePoint(page, fake);
  await page.goto(pageUrl('admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Details: PMS-LST-010')).toBeVisible();
});

for (const [version, words] of [
  [null, "This site's lists have not been set up for this app yet. "],
  [2, "This site's lists need an update before this version of the app can use them. The lists on this site are version 2; this version of the app needs version 3. Open Setup (setup.html, in the same folder as this page), press Show the plan, then Create, then Mark the site as ready: a clean Create does the last step by itself."],
  [4, 'This site has been updated for a newer version of the app. The lists on this site are version 4; these files are for version 3. Upload the newer files.'],
  [3, 'The lists are the version this app needs.'],
] as const) {
  test(`Setup opens on lists ${version === null ? 'that were never set up' : `of version ${version}`}, and says so`, async ({ page }) => {
    const fake = site(version);
    await serveSharePoint(page, fake);
    await page.goto(pageUrl('setup.html'));
    await expect(page.getByTestId('lists-version')).toContainText(words);
    await expect(page.getByRole('button', { name: 'Check Lists' })).toBeEnabled();
    expect(fake.requests.filter((entry) => entry.method !== 'GET' && !/contextinfo/.test(entry.path)), 'it only reads').toEqual([]);
  });
}
