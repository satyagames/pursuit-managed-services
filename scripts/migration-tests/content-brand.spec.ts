import { test, expect, type Page } from '@playwright/test';
import { makeImage } from './brand-images.js';
import { axeCheck, describeFindings } from './a11y-support.js';
import { CONTENT_VIEWS } from '../../migration/src/lib/admin/admin-content-views.js';
import { PIN, activityRow, addActivity, adminUrl, ds, expectFits, openAdmin, pickClient, startLocal, stopLocal, today, type Local } from './admin-local.js';

// Phase 18: Brand Studio in the Content tab. Content is one client's workspace: a client header (logo or initial, the picker, Live now or
// Archived) and a strip of views from CONTENT_VIEWS (lib/admin/admin-content-views.js), Activities and Brand, each with what it holds in words.
// A view is made the first time it is opened and kept, out of sight, while the other shows, so a switch loses nothing and asks nothing; the
// guards still ask on a change of client, another top tab, Lock and closing the page, from a view out of sight too. The BUILT admin page against
// the REAL local server on a scratch copy of server/data, one server per test.

let local: Local;
// (Kroger is live in every test, so Content opens on it; with nobody live it would open on the first client by name.)
test.beforeEach(async () => { local = await startLocal(); await ds.activateClient('c-kroger', today); });
test.afterEach(async () => { await stopLocal(local); });

const strip = (page: Page) => page.getByRole('tablist', { name: /views/ });
const viewTab = (page: Page, id: string) => page.locator(`#content-tab-${id}`);
const panel = (page: Page, id: string) => page.locator(`#content-view-${id}`);
const brandHeading = (page: Page, name: string) => page.getByRole('heading', { level: 3, name: `Brand · ${name}` });
const leave = (page: Page) => page.getByRole('dialog', { name: 'Leave Brand Studio?' });
const status = (page: Page) => page.getByTestId('brand-status');
const primary = (page: Page) => page.getByLabel('Primary', { exact: true });
const question = (page: Page) => page.getByLabel('Question', { exact: true });
/** A click where the tab is on the screen, as a pointer makes it (locator.click() first scrolls a sticky element to where it would be unstuck). */
async function press(page: Page, id: string) {
  const box = (await viewTab(page, id).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
const label = (id: string) => CONTENT_VIEWS.find((view) => view.id === id)!.label;

/** Unlocks the admin page at an address (a reload does the same). */
async function unlockAt(page: Page, hash: string) {
  await page.goto('about:blank');
  await page.goto(`${adminUrl}${hash}`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
}

/** Errors the page throws or logs, from now on. */
function watchErrors(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') problems.push(`console: ${message.text()}`); });
  return problems;
}

/** A client with no look of its own, and one activity. */
async function plainClient() {
  await ds.createClient({ id: 'c-plain', name: 'Plain Co', slug: 'plain-co', status: 'active', logoUrl: '', primaryColor: '#045bcc', secondaryColor: '#64748b', createdAt: new Date().toISOString(), themeVersion: 1 });
  return addActivity('c-plain', { title: 'Plain Quiz', enabled: true, questions: [{ prompt: 'Plain question?', options: [['Yes', true], ['No', false]] }] });
}

test('the strip: the views of the table, in order, Activities first, with what each holds; #content/brand opens Brand and a reload keeps it', async ({ page }) => {
  const problems = watchErrors(page);
  await ds.activateClient('c-kroger', today);
  await openAdmin(page, local, 'Content');
  await expect(strip(page).getByRole('tab')).toHaveCount(CONTENT_VIEWS.length);
  for (const [index, view] of CONTENT_VIEWS.entries()) await expect(strip(page).getByRole('tab').nth(index)).toContainText(view.label);
  await expect(viewTab(page, 'activities')).toHaveAttribute('aria-selected', 'true');
  await expect(viewTab(page, 'brand')).toHaveAttribute('aria-selected', 'false');
  await expect(viewTab(page, 'activities')).toHaveAttribute('aria-controls', 'content-view-activities');
  expect(new URL(page.url()).hash).toBe('#content');
  // The badges say what is on the screen: the activities and the live ones; the look.
  const rows = page.locator('.content-activities .activity');
  const count = await rows.count();
  const live = await page.locator('.content-activities .activity input[type="checkbox"]:checked').count();
  await expect(page.getByTestId('content-badge-activities')).toHaveText(`${count} · ${live} live`);
  await expect(page.getByTestId('content-badge-brand')).toHaveText('Custom look');
  await expect(page.getByTestId('content-look')).toContainText('Look: Custom');
  // Only the view showing is in the page; the other is not made until it is opened.
  await expect(panel(page, 'brand')).toBeHidden();
  await expect(panel(page, 'brand').locator('#brand-title')).toHaveCount(0);

  // The address.
  await unlockAt(page, '#content/brand');
  await expect(viewTab(page, 'brand')).toHaveAttribute('aria-selected', 'true');
  await expect(brandHeading(page, 'Kroger')).toBeVisible();
  await expect(panel(page, 'activities')).toBeHidden();
  await page.reload();
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(brandHeading(page, 'Kroger')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#content/brand');
  // An address changed by hand is followed; an unknown view is the default, and so is the old #sections.
  await page.evaluate(() => { window.location.hash = '#content'; });
  await expect(viewTab(page, 'activities')).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => { window.location.hash = '#content/brand'; });
  await expect(viewTab(page, 'brand')).toHaveAttribute('aria-selected', 'true');
  await unlockAt(page, '#content/colours');
  await expect(viewTab(page, 'activities')).toHaveAttribute('aria-selected', 'true');
  await unlockAt(page, '#sections');
  await expect(page.getByRole('tab', { name: 'Content', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(viewTab(page, 'activities')).toHaveAttribute('aria-selected', 'true');
  expect(problems).toEqual([]);
});

test('the Content tab comes back to the last view of the visit, kept in memory: nothing in browser storage, and blocked storage changes nothing', async ({ page, browser }) => {
  await openAdmin(page, local, 'Content');
  await viewTab(page, 'brand').click();
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  await page.getByRole('tab', { name: 'Content', exact: true }).click();
  await expect(viewTab(page, 'brand')).toHaveAttribute('aria-selected', 'true');
  expect(new URL(page.url()).hash).toBe('#content/brand');
  await viewTab(page, 'activities').click();
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  await page.getByRole('tab', { name: 'Content', exact: true }).click();
  await expect(viewTab(page, 'activities')).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => sessionStorage.length + localStorage.length), 'the admin page writes nothing to browser storage').toBe(0);

  // sessionStorage that throws (a policy, some private windows): nothing changes.
  const context = await browser.newContext();
  const blocked = await context.newPage();
  await blocked.addInitScript(() => { Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('blocked'); } }); });
  const problems = watchErrors(blocked);
  await openAdmin(blocked, local, 'Content');
  await viewTab(blocked, 'brand').click();
  await expect(brandHeading(blocked, 'Kroger')).toBeVisible();
  await blocked.getByRole('tab', { name: 'Today', exact: true }).click();
  await blocked.getByRole('tab', { name: 'Content', exact: true }).click();
  await expect(viewTab(blocked, 'brand')).toHaveAttribute('aria-selected', 'true');
  expect(problems).toEqual([]);
  await context.close();
});

test("Clients' Brand opens Content's Brand view on that client, an archived client too", async ({ page }) => {
  await openAdmin(page, local, 'Clients');
  await expect(page.getByRole('heading', { name: 'Clients', exact: true }).locator('xpath=..')).toContainText(`${label('brand')} opens the client's ${label('brand')} view in Content`);
  await page.locator('.row').filter({ hasText: "Domino's" }).getByRole('button', { name: "Brand: Domino's" }).click();
  await expect(page.getByRole('tab', { name: 'Content', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(viewTab(page, 'brand')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue('c-dominos');
  await expect(brandHeading(page, "Domino's")).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#content/brand');
  await expect(page.getByRole('button', { name: '← Clients' })).toHaveCount(0);

  await ds.updateClient('c-dominos', { status: 'archived' });
  await page.getByRole('tab', { name: 'Clients', exact: true }).click();
  await page.locator('.row').filter({ hasText: "Domino's" }).getByRole('button', { name: "Brand: Domino's" }).click();
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue('c-dominos');
  await expect(page.locator('.content-client .pill--archived')).toHaveText('Archived');
  await expect(brandHeading(page, "Domino's")).toBeVisible();
  await viewTab(page, 'activities').click();
  await expect(page.getByRole('button', { name: 'Add activity' })).toBeDisabled();
});

test('a switch keeps everything: the draft colour, device, screen and picture in Brand; the selection, scroll and a question being typed in Activities; nothing asks', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => { dialogs.push(dialog.type()); void dialog.dismiss(); });
  await openAdmin(page, local, 'Content');
  // Activities: the second activity, its first question open, typed in, the page scrolled.
  const second = page.locator('.content-activities .activity').nth(1);
  const secondId = await second.getAttribute('data-activity');
  await second.locator('.activity__select').click();
  await page.locator('.questions [data-edit-question]').first().click();
  await question(page).fill('A question typed and not saved');
  await page.evaluate(() => window.scrollTo({ top: 300 }));
  const scrolledTo = await page.evaluate(() => window.scrollY);

  // Brand: a colour typed, a device and a screen chosen, a picture picked; nothing saved.
  await press(page, 'brand');
  await expect(brandHeading(page, 'Kroger')).toBeVisible();
  await primary(page).fill('#5B3A99');
  await page.getByRole('group', { name: 'Device' }).getByRole('button', { name: 'iPad portrait' }).click();
  await page.getByRole('group', { name: 'Screen' }).getByRole('button', { name: 'Question' }).click();
  await page.locator('input[type="file"][data-slot="hero"]').setInputFiles({ name: 'hero.png', mimeType: 'image/png', buffer: await makeImage(page, { width: 1200, height: 1200, type: 'image/png', paint: 'logo' }) });
  await page.getByRole('dialog', { name: /Crop and fit/ }).getByRole('button', { name: 'Use this picture' }).click();
  const hero = page.locator('section.asset[data-slot="hero"]');
  await expect(hero.getByTestId('hero-status')).toHaveText('Not saved yet');
  const heroSrc = await hero.locator('img').first().getAttribute('src');
  await expect(status(page)).toHaveText('Unsaved changes');

  // To Activities: no prompt; the Brand tab says it holds unsaved changes, in words and with a mark.
  await press(page, 'activities');
  await expect(leave(page)).toHaveCount(0);
  await expect(page.getByTestId('content-flag-brand')).toHaveText('Unsaved changes');
  await expect(page.getByTestId('content-flag-brand').locator('.content-strip__dot')).toHaveCount(1);
  await expect(activityRow(page, secondId!).locator('.activity__select')).toHaveAttribute('aria-current', 'true');
  await expect(question(page)).toHaveValue('A question typed and not saved');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrolledTo);

  // And back: Brand is as it was left.
  await press(page, 'brand');
  await expect(primary(page)).toHaveValue('#5B3A99');
  await expect(page.getByRole('group', { name: 'Device' }).getByRole('button', { name: 'iPad portrait' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Screen' }).getByRole('button', { name: 'Question' })).toHaveAttribute('aria-pressed', 'true');
  await expect(hero.locator('img').first()).toHaveAttribute('src', heroSrc!);
  await expect(status(page)).toHaveText('Unsaved changes');
  await press(page, 'activities');
  await expect(question(page)).toHaveValue('A question typed and not saved');
  expect(dialogs, 'no prompt on a switch').toEqual([]);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('Save clears the flag and reaches the badge, the Look line and the activity preview with no reload; badges follow a live switch', async ({ page }) => {
  const plain = await plainClient();
  await openAdmin(page, local, 'Content');
  await pickClient(page, 'Plain Co');
  await expect(page.getByTestId('content-badge-brand')).toHaveText('Standard look');
  await expect(page.getByTestId('content-look')).toContainText('Look: Standard');
  await expect(page.getByTestId('content-chip')).toHaveText('P');
  await expect(page.getByTestId('content-badge-activities')).toHaveText('1 · 1 live');
  await page.getByRole('checkbox', { name: 'Set Plain Quiz live' }).uncheck({ force: true });
  await expect(page.getByTestId('content-badge-activities')).toHaveText('1 · 0 live');

  await viewTab(page, 'brand').click();
  await primary(page).fill('#8B2F6F');
  await expect(page.getByTestId('content-flag-brand')).toHaveText('Unsaved changes');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(status(page)).toHaveText('All changes saved');
  await expect(page.getByTestId('content-flag-brand')).toHaveCount(0);
  await expect(page.getByTestId('content-badge-brand')).toHaveText('Custom look');
  await viewTab(page, 'activities').click();
  await expect(page.getByTestId('content-look')).toContainText('Look: Custom');
  await activityRow(page, plain).getByRole('button', { name: /^Preview/ }).click();
  const frame = page.locator('.preview__frame');
  await expect(frame).toBeVisible();
  expect(await frame.evaluate((element) => (element as HTMLElement).dataset.themeSource)).not.toBe('default');
  expect(await frame.evaluate((element) => getComputedStyle(element).getPropertyValue('--bg-mid').trim().toUpperCase())).toBe('#8B2F6F');
});

test('changing client with unsaved colours asks; Cancel keeps the draft; Leave shows the new client and nothing of the old one', async ({ page }) => {
  await openAdmin(page, local, 'Content');
  await viewTab(page, 'brand').click();
  await primary(page).fill('#5B3A99');
  await viewTab(page, 'activities').click();
  // From Activities, with Brand out of sight: Brand comes into sight and asks.
  await pickClient(page, "Domino's");
  await expect(leave(page)).toBeVisible();
  await expect(viewTab(page, 'brand')).toHaveAttribute('aria-selected', 'true');
  await leave(page).getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue('c-kroger');
  await expect(primary(page)).toHaveValue('#5B3A99');
  await expect(brandHeading(page, 'Kroger')).toBeVisible();

  await pickClient(page, "Domino's");
  await leave(page).getByRole('button', { name: 'Leave without saving' }).click();
  await expect(brandHeading(page, "Domino's")).toBeVisible();
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue('c-dominos');
  await expect(page.getByRole('status').filter({ hasText: "Showing Domino's" })).toHaveCount(1);
  await expect(page.getByTestId('content-flag-brand')).toHaveCount(0);
  await expect(page.locator('.content-view').filter({ hasText: 'Kroger' }), 'nothing of the old client is left in the views').toHaveCount(0);
  await viewTab(page, 'activities').click();
  await expect(page.locator('.content-view').filter({ hasText: 'Kroger' })).toHaveCount(0);
  expect((await ds.getClient('c-kroger')).theme.primary, 'nothing was saved').not.toBe('#5B3A99');
});

test('another tab, Lock and closing the page still ask about Brand out of sight, and a question being typed out of sight; both in turn', async ({ page }) => {
  await openAdmin(page, local, 'Content');
  await viewTab(page, 'brand').click();
  await primary(page).fill('#5B3A99');
  await viewTab(page, 'activities').click();
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  await expect(leave(page)).toBeVisible();
  await expect(viewTab(page, 'brand')).toHaveAttribute('aria-selected', 'true');
  await leave(page).getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('tab', { name: 'Content', exact: true })).toHaveAttribute('aria-selected', 'true');
  await viewTab(page, 'activities').click();
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(leave(page)).toBeVisible();
  await leave(page).getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('button', { name: 'Lock' })).toBeVisible();

  // A question typed in Activities while Brand shows: leaving asks about both, one after the other.
  await viewTab(page, 'activities').click();
  await page.locator('.questions [data-edit-question]').first().click();
  await question(page).fill('Typed, not saved');
  await viewTab(page, 'brand').click();
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  await expect(leave(page)).toBeVisible();
  await leave(page).getByRole('button', { name: 'Leave without saving' }).click();
  const questionAsk = page.getByRole('dialog', { name: 'Leave without saving this question?' });
  await expect(questionAsk).toBeVisible();
  await expect(viewTab(page, 'activities')).toHaveAttribute('aria-selected', 'true');
  await questionAsk.getByRole('button', { name: 'Keep editing' }).click();
  await expect(question(page)).toHaveValue('Typed, not saved');
  await expect(page.getByRole('tab', { name: 'Content', exact: true })).toHaveAttribute('aria-selected', 'true');

  // Closing the page: the browser's own prompt, with Brand out of sight.
  await viewTab(page, 'brand').click();
  await primary(page).fill('#0A6B6B');
  await viewTab(page, 'activities').click();
  const asked = new Promise<string>((resolve) => page.once('dialog', (dialog) => { resolve(dialog.type()); void dialog.dismiss(); }));
  await page.close({ runBeforeUnload: true });
  expect(await asked).toBe('beforeunload');
});

test('the bridge: Open Brand switches view; "Preview an activity in this look..." waits for a save, says why, then opens the activity in the saved look', async ({ page }) => {
  const requests = await openAdmin(page, local, 'Content');
  await page.getByRole('button', { name: `Open ${label('brand')}` }).click();
  await expect(viewTab(page, 'brand')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(':focus')).toHaveAttribute('id', 'brand-title');
  const bridge = page.getByRole('region', { name: 'Preview an activity in this look...' });
  const preview = bridge.getByRole('button', { name: 'Preview' });
  await expect(preview).toBeEnabled();
  await expect(page.getByTestId('content-bridge-why')).toHaveText('Opens the activity with its real questions, in the saved look (not unsaved changes).');
  await primary(page).fill('#5B3A99');
  await expect(preview).toBeDisabled();
  await expect(page.getByTestId('content-bridge-why')).toHaveText('Save to preview your activities in this look.');
  const before = requests.length;
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(status(page)).toHaveText('All changes saved');
  await expect(preview).toBeEnabled();
  const chosen = await bridge.getByLabel('Activity').inputValue();
  expect(requests.slice(before).some((entry) => entry.startsWith('GET sections')), 'the picker reads what Content holds').toBe(false);
  await preview.click();
  const frame = page.locator('.preview__frame');
  await expect(frame).toBeVisible();
  expect(await frame.evaluate((element) => (element as HTMLElement).dataset.client)).toBe('c-kroger');
  expect(await frame.evaluate((element) => getComputedStyle(element).getPropertyValue('--bg-mid').trim().toUpperCase())).toBe('#5B3A99');
  await expect(page.locator('dialog[open]')).toContainText(await bridge.getByLabel('Activity').locator(`option[value="${chosen}"]`).innerText());
});

test('keyboard: Left, Right, Home and End on the strip; a click puts focus on the new heading without moving the page', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openAdmin(page, local, 'Content');
  await viewTab(page, 'activities').focus();
  await page.keyboard.press('ArrowRight');
  await expect(viewTab(page, 'brand')).toBeFocused();
  await expect(viewTab(page, 'brand')).toHaveAttribute('aria-selected', 'true');
  await expect(viewTab(page, 'brand')).toHaveAttribute('tabindex', '0');
  await expect(viewTab(page, 'activities')).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('ArrowRight');
  await expect(viewTab(page, 'activities')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(viewTab(page, 'brand')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(viewTab(page, 'activities')).toBeFocused();
  await page.keyboard.press('End');
  await expect(viewTab(page, 'brand')).toBeFocused();
  await page.keyboard.press('Home');
  // A click (or Enter): focus on the view's heading, the page where it was.
  const top = await page.evaluate(() => window.scrollY);
  await viewTab(page, 'brand').click();
  await expect(page.locator('#brand-title')).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(top);
  await viewTab(page, 'activities').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#activities-heading')).toBeFocused();
  // Each tab is a 44px target.
  for (const view of CONTENT_VIEWS) expect((await viewTab(page, view.id).boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
});

test('no request for opening, switching or keeping a view; the hidden view runs no timer or frame; 20 switches do not grow the page', async ({ page, browserName }) => {
  await page.clock.install();
  const requests = await openAdmin(page, local, 'Content');
  await expect(page.locator('.content-activities h3')).toBeVisible();
  // Brand made for the first time: only what Brand Studio asks for on its own (the participant page's address on a local server, GET host).
  let before = requests.length;
  await viewTab(page, 'brand').click();
  await expect(brandHeading(page, 'Kroger')).toBeVisible();
  await page.waitForTimeout(300);
  expect(requests.slice(before).filter((entry) => !entry.startsWith('GET host')), 'opening Brand').toEqual([]);
  before = requests.length;
  for (let index = 0; index < 4; index += 1) { await viewTab(page, 'activities').click(); await viewTab(page, 'brand').click(); }
  expect(requests.slice(before), 'switching').toEqual([]);
  // Kept while Brand shows: the activities' 15-second read waits.
  await page.clock.fastForward(46_000);
  await page.waitForTimeout(200);
  expect(requests.slice(before).filter((entry) => entry.includes('sections')), 'no read of the activities while they are out of sight').toEqual([]);
  // (And it does run while they show, so the count above is measuring something.)
  await viewTab(page, 'activities').click();
  await page.clock.fastForward(16_000);
  await expect.poll(() => requests.slice(before).filter((entry) => entry.includes('sections')).length).toBeGreaterThan(0);

  // Out of sight, Brand asks for no frame and starts no timer.
  await viewTab(page, 'activities').click();
  await page.evaluate(() => {
    const counts = { frames: 0, intervals: 0 };
    (window as unknown as { __counts: typeof counts }).__counts = counts;
    const frame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => { counts.frames += 1; return frame(callback); };
    const every = window.setInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...rest: unknown[]) => { counts.intervals += 1; return every(handler, timeout, ...rest); }) as typeof window.setInterval;
  });
  await page.clock.runFor(5_000);
  expect(await page.evaluate(() => (window as unknown as { __counts: unknown }).__counts)).toEqual({ frames: 0, intervals: 0 });

  // Memory (Chromium shows the heap): 20 switches, garbage collected before and after.
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Runtime.getHeapUsage')).usedSize; };
    const start = await heap();
    for (let index = 0; index < 20; index += 1) { await viewTab(page, 'brand').click(); await viewTab(page, 'activities').click(); }
    const end = await heap();
    expect(end - start, `heap grew by ${end - start} bytes over 20 switches`).toBeLessThan(1_000_000);
  }
});

for (const size of [{ width: 1366, height: 768 }, { width: 1180, height: 820 }]) {
  test(`at ${size.width} x ${size.height} the sticky header and strip with the top tabs take at most a fifth of the height, stay in reach, and cover neither Brand's preview nor the Save bar`, async ({ page }) => {
    // A long list of activities, so that the page scrolls well past the header.
    for (let index = 0; index < 12; index += 1) await addActivity('c-kroger', { title: `Long list ${index + 1}`, enabled: false, questions: [{ prompt: 'Long?', options: [['Yes', true], ['No', false]] }] });
    await page.setViewportSize(size);
    await openAdmin(page, local, 'Content');
    await expect(page.locator('.content-activities h3')).toBeVisible();
    const geometry = () => page.evaluate(() => {
      const box = (selector: string) => { const rect = document.querySelector(selector)!.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; };
      return { nav: box('.shell__nav'), spine: box('.content-spine'), picker: box('#content-client'), strip: box('.content-strip'), height: window.innerHeight };
    });
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
    const scrolled = await geometry();
    expect(scrolled.spine.top, 'stuck under the top tabs').toBeCloseTo(scrolled.nav.bottom, 0);
    expect(scrolled.spine.bottom, 'the sticky block and the top tabs within a fifth of the height').toBeLessThanOrEqual(scrolled.height * 0.2 + 0.5);
    expect(scrolled.nav.top).toBeGreaterThanOrEqual(-0.5);
    expect(scrolled.picker.top, 'the picker in reach').toBeGreaterThanOrEqual(scrolled.nav.bottom - 0.5);
    expect(scrolled.strip.top, 'the strip in reach').toBeGreaterThanOrEqual(scrolled.nav.bottom - 0.5);

    // The question editor's Save bar, with the page scrolled to the editor: below the sticky block.
    await page.locator('.questions [data-edit-question]').last().click();
    await expect(question(page)).toBeVisible();
    const save = page.locator('.questions .content-editor').getByRole('button', { name: 'Save', exact: true });
    await save.scrollIntoViewIfNeeded();
    const saveBox = (await save.boundingBox())!;
    expect(saveBox.y, 'the Save bar is not under the sticky block').toBeGreaterThanOrEqual((await geometry()).spine.bottom - 0.5);
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Brand's preview sticks below the block as the controls scroll.
    await viewTab(page, 'brand').click();
    await page.evaluate(() => window.scrollTo({ top: 900 }));
    await page.waitForTimeout(100);
    const preview = await page.locator('.brand__preview').evaluate((element) => element.getBoundingClientRect().top);
    expect(preview, "Brand's preview is not under the sticky block").toBeGreaterThanOrEqual((await geometry()).spine.bottom - 0.5);
  });
}

test('axe finds nothing on either view or the strip; no sideways scroll and 44px targets at 320, 820, 1180, 1366 and 125% zoom', async ({ page }) => {
  test.setTimeout(180_000);
  await openAdmin(page, local, 'Content');
  for (const size of [{ width: 320, height: 640 }, { width: 820, height: 1180 }, { width: 1180, height: 820 }, { width: 1366, height: 768 }, { width: 1093, height: 614 }]) {
    await page.setViewportSize(size);
    for (const view of CONTENT_VIEWS) {
      await viewTab(page, view.id).click();
      await expect(page.locator(`#${view.heading}`)).toBeVisible();
      await expectFits(page, `Content, ${view.label} at ${size.width}x${size.height}`);
      // The strip may scroll sideways on a narrow screen (never wraps out of sight): the chosen view's tab is on the screen.
      const box = (await viewTab(page, view.id).boundingBox())!;
      expect(box.x >= -0.5 && box.x + box.width <= size.width + 0.5, `the ${view.label} tab is on the screen`).toBe(true);
      await expect(strip(page)).toBeVisible();
      if (size.width === 1366 || size.width === 320) {
        const { findings } = await axeCheck(page, `Content, ${view.label} at ${size.width}`);
        expect(findings, describeFindings(findings)).toEqual([]);
      }
    }
  }
});
