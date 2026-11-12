import { test, expect, type Page } from '@playwright/test';
import { pageUrl, serveSharePoint } from './sharepoint.js';
import { adminSite } from './refactor-site.js';

// Prompt 44: the admin's shared title row, admin/ui/PageHead.svelte, on the BUILT admin page (a Super admin on the mocked SharePoint REST). Each
// screen that draws it has the markup it wrote for itself before (header.panel__head > div > h2 then p.muted, its actions after the words), its
// icon beside the title and hidden from the reader, and a heading that takes focus by script only where the screen asked (tabindex -1), never
// by Tab. What the other primitives of admin/ui/ own is held where it was: Fold by admin-explains.spec.ts, ConfirmDialog (focus on Cancel, Enter
// and Esc cancel, focus returns) by session-delete.spec.ts, Pager by users.spec.ts, StickyBar by admin-today.spec.ts.

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await serveSharePoint(page, await adminSite());
  await page.goto(pageUrl('admin.html'));
  await expect(page.getByTestId('identity-chip')).toBeVisible();
  const welcome = page.getByTestId('welcome-strip');
  if (await welcome.count()) await welcome.getByRole('button', { name: 'Got it' }).click();
}
const tab = async (page: Page, name: string) => {
  await page.getByRole('tab', { name, exact: true }).click();
  await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
};
/** The first title row on the screen, as its markup reads. */
const titleRow = (page: Page) => page.locator('#admin-panel header.panel__head').first().evaluate((head) => {
  const words = head.firstElementChild!;
  const h2 = words.querySelector(':scope > h2')!;
  return {
    wordsFirst: words.tagName === 'DIV',
    order: [...words.children].map((child) => child.tagName.toLowerCase() + (child.classList.contains('muted') ? '.muted' : '')).slice(0, 2),
    title: h2.textContent?.trim(),
    icon: h2.querySelector('svg.icon')?.getAttribute('aria-hidden') ?? null,
    tabindex: h2.getAttribute('tabindex'),
    actions: [...head.children].slice(1).map((child) => child.className.split(' ')[0] || child.tagName.toLowerCase()),
  };
});

test('every screen\'s title row is the markup it had: the words first, the heading then its line, the actions after them', async ({ page }) => {
  await open(page);
  const expected: [string, string, string | null, string[]][] = [
    ['Today', 'Today', '-1', []], // (the shell gives the first screen's heading tabindex -1 when it opens, AdminApp.svelte's newScreen)
    ['Clients', 'Clients', '-1', ['btn']],
    ['Content', 'Content', null, []],
    ['Guests and QR', 'Guests and QR codes', null, []], // (Refresh shows only when guests scan a QR; the seeded session is staff sign-in)
    ['Results', 'Results', '-1', ['results-actions']],
  ];
  for (const [name, title, tabindex, actions] of expected) {
    if (name !== 'Today') await tab(page, name);
    await expect(page.locator('#admin-panel [aria-busy="true"]')).toHaveCount(0);
    const row = await titleRow(page);
    expect(row.wordsFirst, `${name}: the words come first`).toBe(true);
    expect(row.order, `${name}: the heading, then its line`).toEqual(['h2', 'p.muted']);
    expect(row.title, `${name}: the title`).toBe(title);
    expect(row.icon, `${name}: the icon is hidden from the reader`).toBe('true');
    expect(row.tabindex, `${name}: focus by script only where asked`).toBe(tabindex);
    expect(row.actions, `${name}: the actions after the words`).toEqual(actions);
  }
});

test('a focusable title is focused by script, not reached by Tab, and the Leadership dashboard\'s title takes focus when it opens', async ({ page }) => {
  await open(page);
  await tab(page, 'Results');
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.locator('#dash-title')).toBeFocused();
  await expect(page.locator('#dash-title')).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#dash-title')).toHaveText('Leadership dashboard');
  // Tab moves on from the heading to a control and never back to a heading.
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => /^H[1-6]$/.test(document.activeElement?.tagName ?? ''))).toBe(false);
  }
});
