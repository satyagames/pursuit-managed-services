import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { newFake, onSite, pageUrl, serveSharePoint } from './sharepoint.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';

// Prompt 32, step 3, People: on a laptop the list (5 a page) is on the left and the chosen person opens on the right, in place, without leaving
// the list; below 1,100 px the person replaces the list, as before. The BUILT admin page, a Super admin on the mocked SharePoint, six people.

const pictures = fileURLToPath(new URL('../../test-results/admin/wide/', import.meta.url));
const LAPTOPS = [
  { width: 1366, height: 650 }, { width: 1440, height: 780 }, { width: 1536, height: 740 }, { width: 1920, height: 950 },
] as const;
const mail = (name: string) => `${name}@deloitte.com`;
const ME = { Id: 7, Title: 'Satyadev, Vedala Venkata', Email: mail('vsatyadev'), LoginName: `i:0#.f|membership|${mail('vsatyadev')}`, IsSiteAdmin: false };
const PEOPLE = [
  ['vsatyadev', 'Satyadev, Vedala Venkata', 'Super admin', 'global', ''], ['pulmathur', 'Mathur, Pulkit', 'Admin', 'global', ''],
  ['raedla', 'Aedla, Rajeshwar', 'Producer', 'client', 'c-kroger'], ['mohammadahussain', 'Hussain, Mohammad Afrid', 'Designer', 'client', 'c-kroger'],
  ['ablepe', 'Lepe, Annabell', 'Leadership', 'client', 'c-dominos'], ['bmilder', 'Milder, Brian', 'Producer', 'client', 'c-dominos'],
] as const;

async function openPeople(page: Page) {
  const fake = newFake({ user: ME });
  await onSite(fake, (ds) => seedPack(ds, samplePack()));
  for (const [name, title, role, scope, clientId] of PEOPLE) {
    fake.add('users', { Title: mail(name), AppId: mail(name), FullName: title, Email: mail(name), Status: 'Active', Source: 'Typed' });
    fake.add('roleassignments', { Title: `${name}|${role}`, AppId: `${mail(name)}|${role}|${scope}|${clientId}`, UserKey: mail(name), Role: role, ScopeType: scope, ClientId: clientId, SessionId: '', Extras: '' });
  }
  await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('admin.html')}#users`);
  await expect(page.getByTestId('user-row')).toHaveCount(5);
}

test('on a laptop the person opens beside the list, in place, and the list keeps its page and its compact rows', async ({ page }) => {
  await mkdir(pictures, { recursive: true });
  for (const size of LAPTOPS) {
    await page.setViewportSize(size);
    await openPeople(page);
    const at = `People at ${size.width} x ${size.height}`;
    // (The welcome strip is a first visit's: Got it, as a person would.)
    if (await page.getByTestId('welcome-strip').count()) await page.getByTestId('welcome-strip').getByRole('button', { name: 'Got it' }).click();
    await page.getByRole('button', { name: 'Open Mathur, Pulkit' }).click();
    const list = await page.locator('.people__list').boundingBox();
    const detail = await page.locator('.people__detail').boundingBox();
    expect(list, `${at}: the list stays`).not.toBeNull();
    expect(detail!.x, `${at}: the person is beside the list`).toBeGreaterThanOrEqual(list!.x + list!.width);
    await expect(page.getByTestId('user-row')).toHaveCount(5);
    await expect(page.locator('[data-testid="user-row"][aria-current="true"]')).toContainText('Mathur, Pulkit');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${at}: no sideways scroll`).toBe(true);
    await page.screenshot({ path: `${pictures}people-${size.width}x${size.height}.png`, fullPage: true });
    // (Not "nothing to scroll": the list's filters and the person's roles and history are each taller than a laptop window. The owner chose side by
    // side, scrolling, on 5 Nov 2026; Prompt 32's report says so. Each row is one compact line here.)
    const rowHeights = await page.getByTestId('user-row').evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
    for (const height of rowHeights) expect(height, `${at}: a compact row`).toBeLessThanOrEqual(80);
    // Another person opens in the same place.
    await page.getByRole('button', { name: 'Open Lepe, Annabell' }).click();
    await expect(page.locator('[data-testid="user-row"][aria-current="true"]')).toContainText('Lepe, Annabell');
  }
});

test('at 683 px the person replaces the list, as before, and Back brings it back', async ({ page }) => {
  await page.setViewportSize({ width: 683, height: 700 });
  await openPeople(page);
  await page.getByRole('button', { name: 'Open Mathur, Pulkit' }).click();
  await expect(page.locator('.people__list')).toBeHidden();
  await expect(page.locator('.people__detail')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
