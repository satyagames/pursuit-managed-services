import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../migration/src/lib/sha256.js';
import { localDate } from '../../migration/src/lib/admin-today.js';
import { qrImage } from '../../migration/src/lib/admin-links.js';
import { newFake, onSite, pageUrl, seedAndGoLive, serveSharePoint, shape, type Fake } from './sharepoint.js';
import { samplePack } from '../../migration/src/lib/sample-clients.js';
import { seedPack } from '../../migration/src/lib/seed.js';

// Phase 5b on SharePoint: the BUILT admin page served at the approved host's address, against the mocked
// SharePoint REST (scripts/sharepoint-fake.js), which counts every request. These are the request budgets
// of Content (load, selecting, switching, the 15 s refresh), of copying activities and of Generate all
// codes, with the pacing of the writes, and the QR address in SharePoint mode. The smoke test at the
// end runs on Chromium and on WebKit (the engine of every iPad browser). It is not the real tenant.

const results = fileURLToPath(new URL('../../test-results/budget/', import.meta.url));
const shots = fileURLToPath(new URL('../../test-results/admin/', import.meta.url));
const measured: Record<string, unknown> = {};
const today = localDate();
const PIN = '2468';

// The budgets are measured once, on Chromium; the smoke test at the end runs on WebKit as well.
test.beforeEach(({ browserName }, testInfo) => {
  testInfo.skip(browserName !== 'chromium' && !testInfo.title.startsWith('smoke'), 'budgets are measured on Chromium');
});

test.afterAll(async () => {
  if (Object.keys(measured).length === 0) return; // the WebKit run measures nothing
  await mkdir(results, { recursive: true });
  await writeFile(`${results}admin-content-sharepoint.json`, `${JSON.stringify(measured, null, 2)}\n`);
});

/** A site with an admin, both sample clients, and (optionally) one of them live, with guests choosing a personal QR. */
async function site(live: string | null = null, guests = 0) {
  const fake = newFake();
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex(PIN) });
  if (live) {
    const session = await seedAndGoLive(fake, live, today);
    await onSite(fake, async (ds) => {
      await ds.setSessionParticipationMode(session.id, 'client-visit');
      for (let index = 1; index <= guests; index += 1) await ds.createVisitor({ sessionId: session.id, displayName: `Guest ${String(index).padStart(2, '0')}`, enabled: true });
    });
  } else await onSite(fake, (ds) => seedPack(ds, samplePack()));
  return fake;
}

/** Opens the admin page on a tab (via the address), unlocks it, and leaves the fake's log empty for what comes next. */
async function openOn(page: Page, fake: Fake, tab = 'content') {
  const served = await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('admin.html')}#${tab}`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  fake.reset();
  await page.getByRole('button', { name: 'Unlock' }).click();
  return served;
}

/** How many requests to the site are in flight at once, at the most: the pacing as the network sees it. */
function watchInFlight(page: Page) {
  const seen = { now: 0, max: 0, writes: [] as number[] };
  const isWrite = (request: { url(): string; method(): string }) => request.method() === 'POST' && /\/items$/.test(new URL(request.url()).pathname);
  page.on('request', (request) => {
    if (!request.url().includes('/_api/')) return;
    seen.now += 1;
    seen.max = Math.max(seen.max, seen.now);
    if (isWrite(request)) seen.writes.push(Date.now());
  });
  const done = (request: { url(): string }) => { if (request.url().includes('/_api/')) seen.now -= 1; };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return seen;
}

const quiet = (page: Page) => page.waitForTimeout(400);
const titles = (page: Page) => page.locator('.content-activities > ul .activity__select .row__title');
const dialogOf = (page: Page) => page.getByRole('dialog');

test('Content loads in 4 requests from the PIN, and an activity or a client picked costs one each, on SharePoint', async ({ page }) => {
  const fake = await site('c-kroger');
  const served = await openOn(page, fake);
  await expect(titles(page).first()).toBeVisible();
  await expect(page.locator('[data-activity="sec-trivia"]')).toBeVisible();
  await expect(page.locator('.content-detail .row').first()).toBeVisible();
  await quiet(page);
  const load = fake.requests.map(shape);
  // The PIN check, the write token, one $batch of AppSettings, Clients and Sections, one of the first activity's questions and options.
  expect(load, `from Unlock to Content: ${load.join(' | ')}`).toHaveLength(4);
  expect(load.filter((entry) => entry.startsWith('POST /$batch'))).toHaveLength(2);
  expect(fake.requests.find((entry) => entry.parts)!.parts!.map(shape)).toEqual(['GET appsettings', 'GET clients', 'GET sections']);
  expect(fake.requests.filter((entry) => entry.method !== 'GET' && !/contextinfo|\$batch/.test(entry.path)), 'it only reads').toEqual([]);
  measured.contentLoadFromPin = { requests: load.length, breakdown: load };

  fake.reset();
  await page.locator('[data-activity="sec-guess-the-brand"] .activity__select').click();
  await expect(page.locator('.content-detail')).toContainText('home-cooked meals');
  await quiet(page);
  expect(fake.requests.map(shape), 'one batch of questions and options').toEqual(['POST /$batch']);
  expect(fake.requests[0].parts!.map(shape)).toEqual(['GET questions', 'GET options']);
  measured.selectAnActivity = { requests: 1 };

  fake.reset();
  await page.getByLabel('Client', { exact: true }).selectOption({ label: "Domino's" });
  await expect(titles(page).first()).toHaveText("Domino's History");
  await expect(page.locator('.content-detail .row').first()).toContainText("Domino's");
  await quiet(page);
  expect(fake.requests.map(shape), 'the new client\'s first activity: one batch').toEqual(['POST /$batch']);
  measured.switchClient = { requests: 1 };
  expect(served.unexpected).toEqual([]);
});

test('Content refreshes the live switches with ONE request every 15 seconds, none while the tab is hidden', async ({ page }) => {
  const fake = await site('c-kroger');
  await page.clock.install();
  await openOn(page, fake);
  await expect(titles(page).first()).toBeVisible();
  await quiet(page);
  const windows: number[] = [];
  for (let window = 0; window < 3; window += 1) {
    fake.reset();
    await page.clock.runFor(15_000);
    await expect.poll(() => fake.requests.length).toBeGreaterThan(0);
    await quiet(page);
    windows.push(fake.requests.length);
    // One read of the activities (a single read goes plain, not in a batch): one request.
    expect(fake.requests.map(shape), `window ${window}`).toEqual(['GET sections']);
  }
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
  fake.reset();
  await page.clock.runFor(45_000);
  await quiet(page);
  expect(fake.requests.length, 'a hidden tab asks for nothing').toBe(0);
  measured.contentRefresh = { perFifteenSeconds: windows, hiddenTab: 0 };
});

test('copying two activities on SharePoint: every record once, the activity last, three writes at a time, and the request counts', async ({ page }) => {
  const fake = await site('c-kroger');
  await openOn(page, fake);
  await expect(titles(page).first()).toBeVisible();
  await page.getByLabel('Client', { exact: true }).selectOption({ label: "Domino's" });
  await expect(titles(page).first()).toHaveText("Domino's History");
  await quiet(page);

  fake.reset();
  await page.getByRole('button', { name: 'Copy from another client...' }).click();
  await expect(dialogOf(page).getByRole('checkbox', { name: /^Kroger's History/ })).toBeVisible();
  await quiet(page);
  const opening = fake.requests.map(shape);
  expect(opening, 'choosing the source: one batch of its questions and options').toEqual(['POST /$batch']);
  await dialogOf(page).getByRole('checkbox', { name: /^Kroger's History/ }).check();
  await dialogOf(page).getByRole('checkbox', { name: /^Guess the Brand/ }).check();
  await expect(dialogOf(page).getByTestId('copy-summary')).toContainText("Copying 2 activities, 6 questions, 24 options to Domino's.");

  const seen = watchInFlight(page);
  fake.reset();
  const started = Date.now();
  await dialogOf(page).getByRole('button', { name: 'Copy 2 activities' }).click();
  await expect(dialogOf(page).getByTestId('copy-result')).toContainText("Copied 2 activities to Domino's. They are not live yet.", { timeout: 30_000 });
  const elapsed = Date.now() - started;
  const writes = fake.requests.filter((entry) => entry.method === 'POST' && ['options', 'questions', 'sections'].includes(entry.list ?? ''));
  expect(writes.map((entry) => entry.list).filter((list) => list === 'options')).toHaveLength(24);
  expect(writes.filter((entry) => entry.list === 'questions')).toHaveLength(6);
  expect(writes.filter((entry) => entry.list === 'sections')).toHaveLength(2);
  expect(fake.requests.findIndex((entry) => entry.list === 'sections' && entry.method === 'POST'), 'the first activity record comes after its questions and options')
    .toBeGreaterThan(fake.requests.findLastIndex((entry) => /^[oq]-trivia/.test(entry.appId ?? '')) - 1);
  expect(seen.max, `at most 3 requests at a time (saw ${seen.max})`).toBeLessThanOrEqual(3);
  expect(elapsed, 'the writes are spaced: 120 ms between one lane\'s writes').toBeGreaterThanOrEqual((Math.ceil(32 / 3) - 1) * 100);
  const total = fake.requests.length;
  const others = fake.requests.filter((entry) => !writes.includes(entry)).map(shape);
  expect(total - writes.length, `besides the 32 writes: ${others.join(' | ')}`).toBeLessThanOrEqual(14);
  measured.copyTwoActivities = { records: 32, requests: total, writes: writes.length, others: others.length, maxInFlight: seen.max, ms: elapsed, otherRequests: others, pacing: '3 lanes, 120 ms between one lane\'s writes, Retry-After honoured by the adapter' };
  await dialogOf(page).getByRole('button', { name: 'Close' }).click();
  await expect(titles(page)).toHaveText(["Domino's History", 'Guess the Innovation', "Kroger's History", 'Guess the Brand']);
  // Whole, and not live.
  expect(fake.item('sections', 'sec-trivia~c-dominos')).toMatchObject({ ClientId: 'c-dominos', Enabled: false, SortOrder: 3 });
  expect(JSON.parse(fake.item('sections', 'sec-trivia~c-dominos')!.QuestionIds)).toHaveLength(5);
});

test('a failed write in a copy on SharePoint leaves nothing of that activity, and running it again writes only what is missing', async ({ page }) => {
  const fake = await site('c-kroger');
  await openOn(page, fake);
  await page.getByLabel('Client', { exact: true }).selectOption({ label: "Domino's" });
  await expect(titles(page).first()).toHaveText("Domino's History");
  await page.getByRole('button', { name: 'Copy from another client...' }).click();
  await dialogOf(page).getByRole('checkbox', { name: /^Kroger's History/ }).check();
  await dialogOf(page).getByRole('checkbox', { name: /^Guess the Brand/ }).check();
  let options = 0;
  fake.failNext({ status: 503, times: 1, when: (entry) => entry.method === 'POST' && entry.list === 'options' && (options += 1) === 8 });
  await dialogOf(page).getByRole('button', { name: 'Copy 2 activities' }).click();
  await expect(dialogOf(page).getByTestId('copy-result')).toContainText('Not copied: "Kroger\'s History"', { timeout: 30_000 });
  expect(fake.item('sections', 'sec-trivia~c-dominos')).toBeUndefined();
  expect(fake.lists.get('options')!.filter((row) => row.AppId.endsWith('~c-dominos') && row.AppId.includes('trivia'))).toEqual([]);
  expect(fake.lists.get('questions')!.filter((row) => row.AppId.endsWith('~c-dominos') && row.AppId.includes('trivia'))).toEqual([]);
  expect(fake.item('sections', 'sec-guess-the-brand~c-dominos')).toBeTruthy();
  fake.reset();
  await dialogOf(page).getByRole('button', { name: 'Run it again' }).click();
  await expect(dialogOf(page).getByTestId('copy-result')).toContainText("Copied 1 activity to Domino's", { timeout: 30_000 });
  const writes = fake.requests.filter((entry) => entry.method === 'POST' && ['options', 'questions', 'sections'].includes(entry.list ?? ''));
  expect(writes).toHaveLength(26);
  measured.copyRerunAfterFailure = { writes: writes.length, requests: fake.requests.length };
});

test('Generate all codes on SharePoint: one write per code, three at a time, nothing on a second press, and the QR address is the participant page and the code', async ({ page }) => {
  const fake = await site('c-kroger', 12);
  await openOn(page, fake, 'guests');
  await expect(page.getByTestId('guest-summary')).toContainText('12 guests: 12 no code');
  await page.waitForTimeout(400);
  measured.guestsLoad = { requests: fake.requests.length, breakdown: fake.requests.map(shape) };
  expect(fake.requests.length, 'from Unlock to the roster').toBeLessThanOrEqual(5);

  const seen = watchInFlight(page);
  fake.reset();
  const started = Date.now();
  await page.getByRole('button', { name: /^Generate all codes/ }).click();
  await expect(page.getByTestId('guest-report')).toHaveText('Made 12 codes. Everyone who can scan has one.', { timeout: 30_000 });
  const elapsed = Date.now() - started;
  const posts = fake.requests.filter((entry) => entry.method === 'POST' && entry.list === 'qrtokens');
  expect(posts).toHaveLength(12);
  expect(seen.max, `at most 3 at a time (saw ${seen.max})`).toBeLessThanOrEqual(3);
  expect(elapsed).toBeGreaterThanOrEqual((Math.ceil(12 / 3) - 1) * 100);
  const others = fake.requests.filter((entry) => !posts.includes(entry)).map(shape);
  expect(others.length, `besides the 12 writes: ${others.join(' | ')}`).toBeLessThanOrEqual(9);
  measured.generateAllCodes = { guests: 12, requests: fake.requests.length, writes: posts.length, others: others.length, otherRequests: others, maxInFlight: seen.max, ms: elapsed, pacing: '3 lanes, 120 ms between one lane\'s writes, Retry-After honoured by the adapter' };

  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('button', { name: 'Generate all codes' })).toBeDisabled();
  fake.reset();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.waitForTimeout(400);
  expect(fake.requests.filter((entry) => entry.method === 'POST' && entry.list === 'qrtokens'), 'nothing is made when nobody is missing a code').toHaveLength(0);
  measured.refresh = { requests: fake.requests.length, breakdown: fake.requests.map(shape) };

  // The print sheet: the cards carry the participant page of THIS site and the code, and the picture is the QR of exactly that address.
  fake.reset();
  await page.getByRole('button', { name: /^Print QR sheet/ }).click();
  await expect(page.locator('[data-card]')).toHaveCount(12);
  await page.waitForTimeout(400);
  measured.printViewLoad = { requests: fake.requests.length, breakdown: fake.requests.map(shape) };
  const tokens = fake.lists.get('qrtokens')!.filter((row) => row.SessionId === `kroger-${today}`);
  expect(tokens).toHaveLength(12);
  const visitors = fake.lists.get('visitorroster')!;
  for (const token of tokens) {
    const name = visitors.find((row) => row.AppId === token.VisitorId)!.GuestName as string;
    const card = page.locator('[data-card]').filter({ has: page.getByRole('heading', { name, exact: true }) });
    const url = await card.locator('img').getAttribute('data-qr-url');
    expect(url, name).toBe(`${pageUrl('index.html')}?qr=${token.AppId}`);
    expect(new URL(url!).pathname, 'the participant page beside this admin page').toBe(new URL(pageUrl('index.html')).pathname);
    expect(await card.locator('img').getAttribute('src')).toBe(await qrImage(url!));
  }
  await page.screenshot({ path: `${shots}guests-print-view-sharepoint.png`, fullPage: false });
});

test('adding a pasted list on SharePoint writes one item per new name and counts the requests', async ({ page }) => {
  const fake = await site('c-kroger', 0);
  await openOn(page, fake, 'guests');
  await expect(page.getByLabel('Paste names')).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByLabel('Paste names').fill(Array.from({ length: 10 }, (_, index) => `Pasted ${index + 1}`).join('\n') + '\nPasted 1');
  await expect(page.getByTestId('paste-summary')).toContainText('10 new, 1 duplicate skipped.');
  const seen = watchInFlight(page);
  fake.reset();
  await page.getByRole('button', { name: 'Add 10 guests' }).click();
  await expect(page.getByTestId('guest-report')).toHaveText('Added 10 guests.', { timeout: 30_000 });
  const posts = fake.requests.filter((entry) => entry.method === 'POST' && entry.list === 'visitorroster');
  expect(posts).toHaveLength(10);
  expect(seen.max).toBeLessThanOrEqual(3);
  await page.waitForTimeout(300);
  measured.addTenGuests = { requests: fake.requests.length, writes: posts.length, others: fake.requests.length - posts.length, maxInFlight: seen.max };
  expect(fake.lists.get('visitorroster')!.map((row) => row.GuestName).sort()).toEqual(Array.from({ length: 10 }, (_, index) => `Pasted ${index + 1}`).sort());
});

// ---- On Chromium and on WebKit ---------------------------------------------------------------------------------------

test('smoke: Content, a new activity, the copy dialog, and Guests with its print sheet, with no errors and no stray requests', async ({ page, browserName }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') problems.push(`console: ${message.text()}`); });
  const fake = await site('c-kroger', 14);
  const served = await openOn(page, fake);
  await expect(page.getByRole('tab')).toHaveText(['Today', 'Clients', 'Content', 'Guests and QR', 'Results']);
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue('c-kroger');
  await expect(page.locator('.content-bar .pill--live')).toHaveText('LIVE NOW');
  await page.getByLabel('Client', { exact: true }).selectOption({ label: "Domino's" });
  await expect(titles(page)).toHaveText(["Domino's History", 'Guess the Innovation']);
  await page.getByRole('button', { name: 'Add activity' }).click();
  await dialogOf(page).getByLabel('Name', { exact: true }).fill('Menu Deep Dive');
  await dialogOf(page).getByRole('button', { name: 'Add activity' }).click();
  await expect(titles(page).last()).toHaveText('Menu Deep Dive');
  expect(fake.item('sections', fake.lists.get('sections')!.find((row) => row.Title === 'Menu Deep Dive')!.AppId)).toMatchObject({ ClientId: 'c-dominos', Enabled: false, SortOrder: 3 });
  await page.getByRole('button', { name: 'Copy from another client...' }).click();
  await dialogOf(page).getByRole('checkbox', { name: /^Guess the Brand/ }).check();
  await dialogOf(page).getByRole('button', { name: 'Copy 1 activity' }).click();
  await expect(dialogOf(page).getByTestId('copy-result')).toContainText('Copied 1 activity', { timeout: 30_000 });
  await dialogOf(page).getByRole('button', { name: 'Close' }).click();
  // The preview is the Domino's look.
  await page.locator('[data-activity="sec-dominos-history"]').getByRole('button', { name: /^Preview/ }).click();
  await expect(page.locator('dialog button.pill').first()).toBeVisible();
  expect(await page.locator('.preview__frame').evaluate((element) => (element as HTMLElement).dataset.themeSource)).toBe('stored');
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Guests and QR', exact: true }).click();
  await page.getByRole('button', { name: /^Generate all codes/ }).click();
  await expect(page.getByTestId('guest-report')).toHaveText('Made 14 codes. Everyone who can scan has one.', { timeout: 30_000 });
  await page.getByRole('button', { name: /^Print QR sheet/ }).click();
  await expect(page.locator('[data-card]')).toHaveCount(14);
  await expect(page.getByTestId('print-summary')).toContainText('14 cards on 2 pages');
  // Printed layout, in the engine of an iPad: 12 on the first page in 3 columns and 4 rows, 2 on the second.
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: 794, height: 1123 });
  const layout = await page.evaluate(() => [...document.querySelectorAll('.print-page')].map((entry) => {
    const cards = [...entry.querySelectorAll('[data-card]')].map((card) => card.getBoundingClientRect());
    return { cards: cards.length, columns: new Set(cards.map((box) => Math.round(box.left))).size, rows: new Set(cards.map((box) => Math.round(box.top))).size, width: Math.round(cards[0].width), noPrint: getComputedStyle(document.querySelector('.no-print')!).display };
  }));
  expect(layout).toEqual([{ cards: 12, columns: 3, rows: 4, width: Math.round((61 * 96) / 25.4), noPrint: 'none' }, { cards: 2, columns: 2, rows: 1, width: Math.round((61 * 96) / 25.4), noPrint: 'none' }]);
  await page.screenshot({ path: `${shots}guests-print-${browserName}.png` });
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('button', { name: 'Back to Guests and QR' }).click();
  await expect(page.getByRole('heading', { name: 'Visitor roster' })).toBeVisible();
  expect(served.unexpected).toEqual([]);
  expect(problems).toEqual([]);
});
