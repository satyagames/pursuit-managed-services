import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sharePointFolderPath } from '../deployment-config.js';
import { mockApi } from './fixtures.js';
import { newFake, pageUrl, seedAndGoLive, serveSharePoint } from './sharepoint.js';

// Phase 9a: the three messages the independent review added, in the BUILT pages, in a browser. Their rules are unit-tested
// (scripts/test-review-9a.js); this is that a person sees them. (The tile that falls back to its words is in flow.spec.ts.)

const built = (file: string) => readFile(path.join(import.meta.dirname, '..', '..', 'build-svelte', 'release', file), 'utf8');
const appPath = (page: string) => `${sharePointFolderPath}${page}`;

test('a page opened at an address nobody set it up for says so, and asks no list anything (FH-3, as Phase 10b has it)', async ({ page }) => {
  // Phase 9a's finding: at another host name for the same site the page fell back, without a word, to the developer's local server,
  // found nothing, and told participants "isn't live yet" for good. Its fix was a message naming the address. Since Phase 10b a page
  // is not built for one address: any https address that is not this computer is SharePoint, the page asks for the settings file in
  // its own folder, and with none there (and nothing built in) it stops, on both pages, having asked for nothing else.
  const OTHER = 'https://tenant-alias.example';
  const asked: string[] = [];
  await page.route(`${OTHER}/**`, async (route) => {
    const url = new URL(route.request().url());
    const file = ['index.html', 'admin.html'].find((name) => url.pathname.endsWith(`/${name}`));
    if (file) return route.fulfill({ contentType: 'text/html', body: await built(file) });
    asked.push(`${route.request().method()} ${url.pathname}`);
    return route.fulfill({ status: 404, contentType: 'text/html', body: '<html><body>Not found</body></html>' });
  });
  const folder = '/sites/CreativeExpCOE/Shared%20Documents/p_cec_01';
  await page.goto(`${OTHER}${folder}/index.html`);
  await expect(page.getByRole('heading', { level: 1, name: 'This page cannot start' })).toBeFocused();
  await expect(page.getByText('It cannot tell which lists are its own, so it has stopped rather than guess.')).toBeVisible();
  await expect(page.getByText('Details: PMS-CFG-001', { exact: true })).toBeVisible();
  await expect(page.getByText(/live yet/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();

  await page.goto(`${OTHER}${folder}/admin.html`);
  await expect(page.getByText('Details: PMS-CFG-001', { exact: true })).toBeVisible();
  await expect(page.getByLabel('PIN'), 'there is no PIN screen to try: the page does not know whose users to check it against').toHaveCount(0);
  // A few seconds of an open participant page used to be a request to /api every three: now each page asked for its settings file, once, and nothing else.
  await page.waitForTimeout(3500);
  expect(asked).toEqual([`GET ${folder}/pms-config.txt`, `GET ${folder}/pms-config.txt`]);
});

test('an expired sign-in shows its own banner with Reload, and a look that gets through takes it down (FH-1)', async ({ page }) => {
  test.setTimeout(60_000);
  const fake = newFake();
  await seedAndGoLive(fake);
  await serveSharePoint(page, fake);
  await page.goto(pageUrl('index.html'));
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  await expect(page.getByText('Your sign-in has expired')).toHaveCount(0);

  // The sign-in runs out: SharePoint answers every request with its sign-in page (200, HTML). Before the fix the page showed nothing.
  const signInPage = '<!DOCTYPE html><html><head><title>Sign in to your account</title></head><body><form>Sign in</form></body></html>';
  await page.route('**/_api/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: signInPage }));
  // (The network "coming back" makes the page look at once; a real page would look within its usual wait.)
  await expect.poll(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    return page.getByRole('alert').filter({ hasText: 'Your sign-in has expired. Reload this page to sign in again. Your answers are kept on this device.' }).count();
  }, { timeout: 20_000 }).toBe(1);
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
  await expect(page.getByText(/reach the server/), 'it is not shown as a lost connection').toHaveCount(0);

  // Signed in again (in another tab, say): the next look gets through and the banner goes.
  await page.unroute('**/_api/**');
  await expect.poll(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    return page.getByText('Your sign-in has expired').count();
  }, { timeout: 20_000 }).toBe(0);
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
});

test('the hub could not be loaded: plain words, and "Try again" reads it again without reloading the page (FH-4)', async ({ page }) => {
  const fixture = await mockApi(page);
  // Since Phase 10j the hub is drawn at once from the activities the page holds, and a read behind it that fails leaves them on the screen: the
  // hub has nothing to show, and says why, only when the page holds none. So the client has no activity when the page loads.
  const activities = fixture.records.sections.splice(0);
  await page.goto(appPath('/index.html#/welcome?t=track-a'));
  const toHub = page.getByRole('button', { name: /^(Activities|Click here to begin)$/ });
  await expect(toHub).toBeVisible();
  // The first arrival, straight after the page loaded, is drawn from what the boot read: none. Go there, come back, and arrive again:
  // that arrival reads the activities, and this time the read is answered 503.
  await toHub.click();
  await expect(page.getByText('There are no activities available right now.')).toBeVisible();
  await page.getByRole('button', { name: 'Home' }).click();
  await expect(toHub).toBeVisible();
  await page.evaluate(() => { (window as unknown as { stayedHere?: boolean }).stayedHere = true; });
  fixture.failNextSectionsRead = true;
  await toHub.click();
  await expect(page.getByRole('alert').filter({ hasText: 'reach the server. Check the connection, then try again.' })).toBeVisible();
  fixture.records.sections.push(...activities); // the facilitator's activities are there now
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('button.activity').first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { stayedHere?: boolean }).stayedHere), 'the page was not reloaded').toBe(true);
});

test('with activities on the screen, a read behind the hub that fails leaves them there: no error, and they still open (Phase 10j)', async ({ page }) => {
  const fixture = await mockApi(page);
  await page.goto(appPath('/index.html#/welcome?t=track-a'));
  const toHub = page.getByRole('button', { name: /^(Activities|Click here to begin)$/ });
  await toHub.click();
  await expect(page.locator('button.activity').first()).toBeVisible();
  await page.getByRole('button', { name: 'Home' }).click();
  fixture.failNextSectionsRead = true;
  await toHub.click();
  await expect(page.locator('button.activity')).toHaveCount(2);
  await expect(page.getByText('Loading activities...')).toHaveCount(0);
  await expect.poll(() => fixture.failNextSectionsRead, 'the read behind the hub was made, and failed').toBe(false);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.locator('button.activity').nth(1).click();
  await expect(page.getByRole('heading', { name: /Question B/ })).toBeVisible();
});
