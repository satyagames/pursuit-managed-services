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
