import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openAdmin, startLocal, stopLocal, type Local } from './admin-local.js';

// Prompt 32, step 1: the admin page uses the whole laptop screen. No container is capped (the 1,120 px of admin.css and the 1,000 px of the legacy
// sheet are gone): the content runs edge to edge with clamp(16px, 2vw, 32px) at the sides. At 1,100 px and wider the brand, the section tabs and the
// person share one sticky bar, 52 px high; below it the bar is two rows as before, and only the tab row sticks. Each tab's heading and its help share
// one line. On the built admin page and the local server's sample data, at the page-area sizes of the common laptops and at a 200 percent zoom.

const pictures = fileURLToPath(new URL('../../test-results/admin/wide/', import.meta.url));
const LAPTOPS = [
  { width: 1366, height: 650 }, { width: 1440, height: 780 }, { width: 1536, height: 740 }, { width: 1920, height: 950 },
] as const;
const ZOOMED = { width: 683, height: 700 } as const;
const TABS = ['Today', 'Clients', 'Content', 'Guests and QR', 'Results'];

let local: Local | undefined;
test.beforeEach(async () => { local = await startLocal(); });
test.afterEach(async () => { await stopLocal(local); local = undefined; });

/** Where the bar's parts and the tab's first heading are, in the window's pixels. */
const geometry = (page: Page) => page.evaluate(() => {
  const box = (selector: string) => {
    const element = document.querySelector(selector);
    if (!element || element.getClientRects().length === 0) return null;
    const { top, bottom, left, right, height } = element.getBoundingClientRect();
    return { top, bottom, left, right, height };
  };
  const head = [...document.querySelectorAll<HTMLElement>('#admin-panel header.panel__head')].find((element) => element.getClientRects().length > 0);
  const title = head?.querySelector('h2')?.getBoundingClientRect();
  const help = head?.querySelector('p')?.getBoundingClientRect();
  const headBox = head?.getBoundingClientRect();
  return {
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    bar: box('.shell__bar'), brand: box('.shell__brand'), tabs: box('[role="tablist"]'), user: box('.shell__end'),
    head: headBox ? { left: headBox.left, right: headBox.right } : null,
    title: title ? { top: title.top, bottom: title.bottom } : null,
    help: help ? { top: help.top, bottom: help.bottom } : null,
    scrollPadding: parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0,
    sticky: Math.max(...[...document.querySelectorAll<HTMLElement>('.shell__bar, .shell__nav')]
      .filter((element) => getComputedStyle(element).position === 'sticky').map((element) => element.getBoundingClientRect().height), 0),
  };
});

const openTab = async (page: Page, tab: string) => {
  await page.getByRole('tab', { name: tab, exact: true }).click();
  await expect(page.getByRole('heading', { name: tab, exact: true }).first()).toBeVisible();
  // Measured once the tab has read what it shows: a loading line is shorter than the screen it stands for.
  await expect(page.locator('#admin-panel [aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('#admin-panel').getByRole('status').filter({ hasText: /^Loading/ })).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
};

test('on a laptop the content runs edge to edge and the brand, tabs and person share one 52 px bar', async ({ page }) => {
  await mkdir(pictures, { recursive: true });
  for (const size of LAPTOPS) {
    await page.setViewportSize(size);
    await openAdmin(page, local!);
    for (const tab of TABS) {
      await openTab(page, tab);
      const at = `${tab} at ${size.width} x ${size.height}`;
      const g = await geometry(page);
      expect(g.scrollWidth, `${at}: no sideways scroll`).toBeLessThanOrEqual(g.innerWidth);
      expect(g.head, `${at}: the tab has a heading`).not.toBeNull();
      expect(g.head!.left, `${at}: the gap at the left`).toBeLessThanOrEqual(40);
      expect(g.width - g.head!.right, `${at}: the gap at the right`).toBeLessThanOrEqual(40);
      expect(g.bar!.height, `${at}: the bar's height`).toBeLessThanOrEqual(53);
      for (const [part, where] of [['the brand', g.brand], ['the tabs', g.tabs], ['the person', g.user]] as const) {
        expect(where, `${at}: ${part} is shown`).not.toBeNull();
        expect(where!.top, `${at}: ${part} is in the bar`).toBeGreaterThanOrEqual(g.bar!.top - 1);
        expect(where!.bottom, `${at}: ${part} is in the bar`).toBeLessThanOrEqual(g.bar!.bottom + 1);
      }
      expect(g.brand!.right, `${at}: the brand comes before the tabs`).toBeLessThanOrEqual(g.tabs!.left + 1);
      expect(g.tabs!.right, `${at}: the tabs come before the person`).toBeLessThanOrEqual(g.user!.left + 1);
      // The heading and its help on one line: the help starts above the heading's foot.
      expect(g.help!.top, `${at}: the help is beside the heading, not under it`).toBeLessThan(g.title!.bottom);
      // A control the keyboard scrolls to stops below the sticky bar, with room for its 9 px ring.
      expect(g.scrollPadding, `${at}: scroll-padding-top clears the sticky bar and the ring`).toBeGreaterThanOrEqual(g.sticky + 9);
      if (size.width === 1366 || size.width === 1920) await page.screenshot({ path: `${pictures}${tab.split(' ')[0].toLowerCase()}-${size.width}x${size.height}.png` });
    }
  }
});

test('at 683 px (a 1366 px laptop at 200 percent) the bar is two rows as before, only the tab row sticks, and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize(ZOOMED);
  await openAdmin(page, local!);
  for (const tab of TABS) {
    await openTab(page, tab);
    const at = `${tab} at 683 x 700`;
    const g = await geometry(page);
    expect(g.scrollWidth, `${at}: no sideways scroll`).toBeLessThanOrEqual(g.innerWidth);
    expect(g.tabs!.top, `${at}: the tabs are a row of their own, under the brand`).toBeGreaterThanOrEqual(g.brand!.bottom);
    expect(await page.locator('.shell__bar').evaluate((element) => getComputedStyle(element).position), `${at}: the brand row scrolls away`).not.toBe('sticky');
    expect(await page.locator('.shell__nav').evaluate((element) => getComputedStyle(element).position), `${at}: the tab row sticks`).toBe('sticky');
    expect(g.scrollPadding, `${at}: scroll-padding-top clears the tab row and the ring`).toBeGreaterThanOrEqual(g.sticky + 9);
  }
  await mkdir(pictures, { recursive: true });
  await openTab(page, 'Today');
  await page.screenshot({ path: `${pictures}today-683x700.png` });
});

// Step 3, Today: column A (the live card, Go live, the sessions), B (Readiness, with only warnings and failures open), C (Controls, sticky under the
// bar). Three columns from 1,100 px: A over B is taller than a 1366 x 650 window, and C under B would push End session out of it. On Domino's,
// ready with one warning.
const columnsOf = (page: Page) => page.evaluate(() => Object.fromEntries(['a', 'b', 'c'].map((zone) => {
  const box = document.querySelector(`.today__${zone}`)?.getBoundingClientRect();
  return [zone, box ? { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom) } : null];
})));
const inView = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).evaluate((element) => {
  const box = element.getBoundingClientRect();
  return box.top >= 52 && box.bottom <= window.innerHeight && box.left >= 0 && box.right <= document.documentElement.clientWidth;
});

test('Today on a laptop: three zones from 1,100 px; the ready checks fold; nothing to scroll; Go live and End session in view', async ({ page }) => {
  await mkdir(pictures, { recursive: true });
  for (const size of LAPTOPS) {
    await page.setViewportSize(size);
    await openAdmin(page, local!);
    await page.getByLabel('Client', { exact: true }).selectOption({ label: "Domino's" });
    await expect(page.getByTestId('readiness-summary')).toHaveText(/Ready to go live, with 1 warning/);
    const at = `Today at ${size.width} x ${size.height}`;
    const zones = await columnsOf(page);
    expect(zones.a && zones.b && zones.c, `${at}: the three zones`).toBeTruthy();
    expect(zones.b!.left, `${at}: B beside A`).toBeGreaterThanOrEqual(zones.a!.right);
    expect(zones.c!.left, `${at}: C beside B`).toBeGreaterThanOrEqual(zones.b!.right);
    // Only the warning is open; the ready checks are one line with a Show control that says how many.
    const fold = page.getByRole('button', { name: /^Show \d+ ready checks?$/ });
    await expect(fold, `${at}: the fold`).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-check][data-level="pass"]').first()).toBeHidden();
    await expect(page.locator('[data-check][data-level="warning"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), `${at}: nothing to scroll`).toBeLessThanOrEqual(0);
    expect(await inView(page, 'Go live'), `${at}: Go live in view`).toBe(true);
    await page.screenshot({ path: `${pictures}today-ready-${size.width}x${size.height}.png` });
    await fold.click();
    await expect(page.getByRole('button', { name: /^Hide \d+ ready checks?$/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-check][data-level="pass"]').first()).toBeVisible();
  }
});

test('Today live at 1366 x 650: End session in view, Controls stay in view as the page scrolls, the segmented controls are radios that set the session', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 650 });
  await openAdmin(page, local!);
  await page.getByLabel('Client', { exact: true }).selectOption({ label: "Domino's" });
  await page.getByRole('button', { name: 'Go live', exact: true }).click();
  await expect(page.locator('section[data-live]')).toContainText('LIVE');
  expect(await inView(page, 'End session'), 'End session in view').toBe(true);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await inView(page, 'End session'), 'End session in view at the foot of the page').toBe(true);
  const controls = await page.locator('.today__c').boundingBox();
  expect(controls!.y, 'Controls stay under the bar').toBeGreaterThanOrEqual(52);
  for (const group of ['How people are identified', 'Activity flow', 'Confidence check']) {
    await expect(page.getByRole('group', { name: group }).getByRole('radio'), `${group}: radios`).toHaveCount(2);
  }
  await page.getByRole('radio', { name: /^Open/ }).check();
  await expect(page.getByTestId('flow-meaning')).toHaveText('Every activity is open from the start, in any order.');
  await page.screenshot({ path: `${pictures}today-live-1366x650.png` });
});

// Step 3, Clients: on a laptop the list stays on the left and the chosen client's sessions and team open on the right, in place. The client's page
// reads what it read before (its sessions, the people and their roles, once it opens): no new request. Below 1,100 px it replaces the list, as before.
test('Clients on a laptop: a client\'s sessions and team open beside the list, in place; Back to clients closes them', async ({ page }) => {
  await mkdir(pictures, { recursive: true });
  for (const size of LAPTOPS) {
    await page.setViewportSize(size);
    await openAdmin(page, local!);
    await openTab(page, 'Clients');
    const at = `Clients at ${size.width} x ${size.height}`;
    await page.getByRole('button', { name: 'Sessions and team: Kroger' }).click();
    await expect(page.getByRole('heading', { name: 'Kroger', level: 2 }), `${at}: the client's page has the focus`).toBeFocused();
    const list = await page.locator('.clients__list').boundingBox();
    const detail = await page.locator('.clients__detail').boundingBox();
    expect(list, `${at}: the list stays`).not.toBeNull();
    expect(detail!.x, `${at}: the client is beside the list`).toBeGreaterThanOrEqual(list!.x + list!.width);
    await expect(page.locator('.client-row[aria-current="true"]'), `${at}: the open client is marked`).toContainText('Kroger');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${at}: no sideways scroll`).toBe(true);
    await page.screenshot({ path: `${pictures}clients-${size.width}x${size.height}.png` });
    // Another client opens in the same place.
    await page.getByRole('button', { name: "Sessions and team: Domino's" }).click();
    await expect(page.getByRole('heading', { name: "Domino's", level: 2 })).toBeFocused();
    await page.getByRole('button', { name: 'Back to clients' }).click();
    await expect(page.locator('.clients__detail')).toHaveCount(0);
    await expect(page.getByRole('button', { name: "Sessions and team: Domino's" })).toBeFocused();
  }
});

test('Clients at 683 px: a client\'s sessions and team replace the list, as before', async ({ page }) => {
  await page.setViewportSize(ZOOMED);
  await openAdmin(page, local!);
  await openTab(page, 'Clients');
  await page.getByRole('button', { name: 'Sessions and team: Kroger' }).click();
  await expect(page.locator('.clients__list')).toBeHidden();
  await expect(page.locator('.clients__detail')).toBeVisible();
  await page.getByRole('button', { name: 'Back to clients' }).click();
  await expect(page.getByRole('button', { name: 'Sessions and team: Kroger' })).toBeFocused();
});
