import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openAdmin, startLocal, stopLocal, type Local } from './admin-local.js';

// Prompt 38: the admin page, calm and premium. On the built admin page and the local server's sample data: no sideways scroll at 1024, 1280 and
// 1440 px on any tab; axe finds nothing (contrast included) on each tab; every control drawn as an icon alone has a name; the sticky bar never hides
// the field that has the focus; Esc closes a dialog and a more menu (focus back where it was); a new client needs its name only; and the pictures
// the brief asks for (Today ready and blocked, Clients, Content and its editor, Guests, the QR sheet, Results, a dialog, an empty state) are
// written to test-results/admin/calm/ to be looked at.

const pictures = fileURLToPath(new URL('../../test-results/admin/calm/', import.meta.url));
const WIDTHS = [1024, 1280, 1440] as const;
const TABS = ['Today', 'Clients', 'Content', 'Guests and QR', 'Results'];

let local: Local | undefined;
test.beforeEach(async () => { local = await startLocal(); });
test.afterEach(async () => { await stopLocal(local); local = undefined; });

const openTab = async (page: Page, tab: string) => {
  await page.getByRole('tab', { name: tab, exact: true }).click();
  await expect(page.locator('#admin-panel [aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
};

// (Prompt 39: the 1,280 px cap is gone; the content is the window's width, up to 1,920 px, less the page padding.)
test('no sideways scroll at 1024, 1280 and 1440 px, and the content is the whole width of the window', async ({ page }) => {
  await mkdir(pictures, { recursive: true });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await openAdmin(page, local!);
    for (const tab of TABS) {
      await openTab(page, tab);
      const at = `${tab} at ${width} px`;
      const { scroll, inner, body, room } = await page.evaluate(() => {
        const panel = document.querySelector('#admin-panel')!.getBoundingClientRect();
        return { scroll: document.documentElement.scrollWidth, inner: window.innerWidth, body: panel.width, room: document.documentElement.clientWidth };
      });
      expect(scroll, `${at}: no sideways scroll`).toBeLessThanOrEqual(inner);
      expect(body, `${at}: the content and its padding, the whole width`).toBeGreaterThanOrEqual(Math.min(room, 1920) - 1);
      expect(body, `${at}: never past 1,920 px`).toBeLessThanOrEqual(1920 + 1);
      if (width === 1440) await page.screenshot({ path: `${pictures}${tab.split(' ')[0].toLowerCase()}-${width}.png`, fullPage: true });
    }
  }
});

test('axe finds nothing on each tab, and every icon-only control has a name', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAdmin(page, local!);
  for (const tab of TABS) {
    await openTab(page, tab);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map((violation) => `${tab}: ${violation.id} ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`), `${tab}: axe`).toEqual([]);
    const unnamed = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('button, a[href]')]
      .filter((element) => element.getClientRects().length > 0 && !element.textContent?.trim() && element.querySelector('svg'))
      .filter((element) => !(element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') || element.getAttribute('title')))
      .map((element) => element.outerHTML.slice(0, 80)));
    expect(unnamed, `${tab}: icon-only controls without a name`).toEqual([]);
  }
});

test('the sticky bar never hides the focused field, and holds one primary action', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await openAdmin(page, local!);
  const bar = page.getByTestId('sticky-bar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.btn--primary')).toHaveCount(1);
  for (const field of await page.locator('#admin-panel').locator('input:not([type="hidden"]), select').all()) {
    if (!(await field.isVisible())) continue;
    await field.focus();
    const [box, top] = await Promise.all([field.boundingBox(), bar.evaluate((element) => element.getBoundingClientRect().top)]);
    expect(box!.y + box!.height, 'the focused field is above the bar').toBeLessThanOrEqual(top);
  }
  await page.screenshot({ path: `${pictures}today-bar-1024.png` });
});

test('Esc closes a more menu and a dialog, and the focus goes back to what opened it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAdmin(page, local!);
  await openTab(page, 'Clients');
  const more = page.getByRole('button', { name: 'More actions for Kroger' });
  await more.click();
  await expect(page.getByRole('menu', { name: 'More actions for Kroger' })).toBeVisible();
  await expect(page.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(more).toBeFocused();
  await openTab(page, 'Content');
  await page.getByRole('button', { name: 'Add activity' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: `${pictures}dialog-1280.png` });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('a new client needs its name only; the rest is folded with a line of what it holds', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAdmin(page, local!);
  await openTab(page, 'Clients');
  await page.getByRole('button', { name: 'Add client', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeVisible();
  await expect(page.getByLabel('Short name in session ids')).toBeHidden();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Acme Foods');
  await expect(page.locator('.client-more .adm-fold__summary')).toContainText('acme-foods');
  await page.screenshot({ path: `${pictures}clients-add-1280.png` });
});

test('a fold the person opened stays open while they type in it, and shuts only when they press it', async ({ page }) => {
  // (Found while bringing the older specs up to date: a fold whose open state was an expression was set again whenever its summary line changed,
  // so typing a short name, or clearing a pasted list, shut the fold under the cursor.)
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAdmin(page, local!);
  await openTab(page, 'Clients');
  await page.getByRole('button', { name: 'Add client', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Acme Foods');
  await page.locator('.client-more summary').click();
  const slug = page.getByLabel('Short name in session ids');
  await slug.fill('acme');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Acme Foods Group');
  await expect(slug, 'More details is still open after typing in it and in the name').toBeVisible();
  await page.locator('.client-more summary').click();
  await expect(slug).toBeHidden();
  // (Guests' Add many at once is held to the same in admin-guests.spec.ts, which has a live session to add guests to.)
});
