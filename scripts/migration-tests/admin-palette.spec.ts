import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openAdmin, startLocal, stopLocal, type Local } from './admin-local.js';

// Prompt 41: the Deloitte green palette, on the built admin page with the local server's sample data, at 1440 px:
//   - what the browser draws: the active tab's underline is the accent #0DF200, the primary button #26890D with white words, the page
//     #F5F6F4, the bar white, the keyboard's ring 2 px of #26890D;
//   - the accent is never words: no element with words of its own is drawn in #0DF200, or on it unless its words are ink;
//   - axe finds nothing (contrast included) on each screen;
//   - a picture of each screen (Today, Clients, Content's activities and Brand, Guests and QR, Results, People when shown, a dialog, an empty
//     state) goes to test-results/admin/palette/ to be looked at.

const pictures = fileURLToPath(new URL('../../test-results/admin/palette/', import.meta.url));
const ACCENT = 'rgb(13, 242, 0)';
const PRIMARY = 'rgb(38, 137, 13)';

let local: Local | undefined;
test.beforeEach(async () => { local = await startLocal(); });
test.afterEach(async () => { await stopLocal(local); local = undefined; });

const openTab = async (page: Page, tab: string) => {
  await page.getByRole('tab', { name: tab, exact: true }).click();
  await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#admin-panel [aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
};

/** Every element with words of its own drawn in the accent, or on an accent fill with words that are not ink. */
const accentWords = (page: Page) => page.evaluate(({ accent }) => {
  const own = (element: Element) => [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim());
  return [...document.querySelectorAll('body *')].filter((element) => {
    if (!own(element) || !(element as HTMLElement).checkVisibility?.()) return false;
    const style = getComputedStyle(element);
    return style.color === accent || (style.backgroundColor === accent && style.color !== 'rgb(34, 34, 34)');
  }).map((element) => `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}: ${element.textContent!.trim().slice(0, 30)}`);
}, { accent: ACCENT });

const axe = async (page: Page, label: string) => {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.map((each) => `${each.id}: ${each.nodes.map((node) => node.target.join(' ')).join(', ')}`), label).toEqual([]);
};

test('the palette as drawn: the accent underline, the primary button, the page, the bar and the ring', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAdmin(page, local!);
  await page.evaluate(() => document.fonts.ready);
  const drawn = await page.evaluate(() => {
    const active = document.querySelector('.shell__nav .tab[aria-selected="true"]')!;
    const inactive = document.querySelector('.shell__nav .tab[aria-selected="false"]')!;
    // A primary button as the page's sheets draw it (Today may have none enabled yet): one put in the panel and read.
    const primary = document.createElement('button');
    primary.className = 'btn btn--primary';
    primary.textContent = 'Go live';
    document.querySelector('#admin-panel')!.append(primary);
    return {
      underline: getComputedStyle(active).borderBottomColor,
      activeWords: getComputedStyle(active).color,
      activeIcon: getComputedStyle(active.querySelector('.icon')!).color,
      inactiveWords: getComputedStyle(inactive).color,
      primary: [getComputedStyle(primary).backgroundColor, getComputedStyle(primary).color],
      page: getComputedStyle(document.body).backgroundColor,
      bar: getComputedStyle(document.querySelector('.shell__bar')!).backgroundColor,
      removed: primary.remove(),
    };
  });
  expect(drawn.underline, 'the active tab is underlined in #0DF200').toBe(ACCENT);
  expect(drawn.activeWords, 'its words are ink').toBe('rgb(34, 34, 34)');
  expect(drawn.activeIcon, 'its icon the primary').toBe(PRIMARY);
  expect(drawn.inactiveWords, 'the other tabs are the 75% neutral (words: the 60% one is 4.3:1)').toBe('rgb(89, 89, 89)');
  expect(drawn.primary, 'a primary button is #26890D with white words').toEqual([PRIMARY, 'rgb(255, 255, 255)']);
  expect(drawn.page, 'the page').toBe('rgb(245, 246, 244)');
  expect(drawn.bar, 'the bar is white').toBe('rgb(255, 255, 255)');

  // The ring: Tab to the first control of the bar.
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => { const style = getComputedStyle(document.activeElement!); return [style.outlineStyle, style.outlineWidth, style.outlineColor, style.boxShadow]; });
  expect(ring.slice(0, 3), 'the ring is 2 px of the primary').toEqual(['solid', '2px', PRIMARY]);
  expect(ring[3], 'with the accent at 35% outside it').toContain('rgba(13, 242, 0, 0.35)');
});

test('every screen: axe finds nothing, the accent is never words, and a picture of each at 1440 px', async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(pictures, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAdmin(page, local!);
  const welcome = page.getByTestId('welcome-strip');
  if (await welcome.count()) await welcome.getByRole('button', { name: 'Got it' }).click();
  const look = async (name: string) => {
    expect(await accentWords(page), `${name}: words in or on the accent`).toEqual([]);
    await axe(page, name);
    await page.screenshot({ path: `${pictures}${name}-1440.png`, fullPage: true });
  };

  await page.evaluate(() => document.fonts.ready);
  await look('today');
  for (const [tab, name] of [['Clients', 'clients'], ['Content', 'content-activities'], ['Guests and QR', 'guests'], ['Results', 'results-sessions']] as const) {
    await openTab(page, tab);
    await look(name);
    if (tab === 'Content') {
      await page.locator('.content-strip__tab[data-view="brand"]').click();
      await expect(page.locator('.brand__preview')).toBeVisible();
      await look('content-brand');
      await page.locator('.content-strip__tab[data-view="activities"]').click();
    }
  }
  const people = page.getByRole('tab', { name: 'People', exact: true });
  if (await people.count()) { await openTab(page, 'People'); await look('people'); }

  // A dialog: Clients' New client.
  await openTab(page, 'Clients');
  const add = page.getByRole('button', { name: /^(New|Add) client/ }).first();
  if (await add.count()) {
    await add.click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${pictures}dialog-1440.png` });
    await page.keyboard.press('Escape');
  }
});
