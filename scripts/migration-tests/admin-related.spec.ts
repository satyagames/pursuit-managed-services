import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';

// Prompt 40: what is chosen and what it opens stay side by side. The BUILT admin page, signed in as a Super admin (the six tabs), against the
// mocked SharePoint REST, with the sample clients, Kroger with seven activities and eight sessions in all. At 1280, 1440 and 1920 px:
//   - the bar: a divider between each two neighbouring tabs (five, drawn, not read), the word as far from it on each side (within 1 px);
//   - Clients: a client's Sessions and team open and the page 800 px down, the list is still in the window, and so is the client's strip;
//   - Content: the last activity chosen, its questions are in the window with no scrolling and the page did not jump to the top;
//   - Brand: Pictures, then Colours, first in the page and on the screen; the controls left of the preview; the preview in view 600 px down;
//   - People: each filter's label starts where its field's words do (within 1 px).
// Pictures of each go to test-results/admin/related/ to be looked at.

const pictures = fileURLToPath(new URL('../../test-results/admin/related/', import.meta.url));
const WIDTHS = [1280, 1440, 1920] as const;
const mail = (name: string) => `${name}@deloitte.com`;
const ME = { Id: 7, Title: 'Satyadev, Vedala Venkata', Email: mail('vsatyadev'), LoginName: `i:0#.f|membership|${mail('vsatyadev')}`, IsSiteAdmin: false };
const DATES = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13', '2026-10-20'];

async function site(): Promise<Fake> {
  const fake = newFake({ user: ME });
  await onSite(fake, async (ds) => {
    await seedPack(ds, samplePack());
    // More activities for Kroger, so its list is longer than the window.
    for (const [at, title] of ['Kroger in numbers', 'Fresh ideas', 'Store of the future', 'Our people', 'Supply chain', 'What comes next'].entries()) {
      await ds.createSection({ id: `sec-more-${at}`, title, order: 90 + at, enabled: false, industryTags: [], questionIds: [], clientId: 'c-kroger' });
    }
    for (const [at, date] of DATES.entries()) await ds.activateClient(at % 2 ? 'c-dominos' : 'c-kroger', date);
  });
  fake.add('users', { Title: ME.Email, AppId: ME.Email, FullName: ME.Title, Email: ME.Email, Status: 'Active', Source: 'Typed' });
  fake.add('users', { Title: mail('pulmathur'), AppId: mail('pulmathur'), FullName: 'Mathur, Pulkit', Email: mail('pulmathur'), Status: 'Active', Source: 'Typed' });
  for (const [who, role] of [[ME.Email, 'Super admin'], [mail('pulmathur'), 'Admin']]) {
    fake.add('roleassignments', { Title: `${who}|${role}`, AppId: `${who}|${role}|global|`, UserKey: who, Role: role, ScopeType: 'global', ClientId: '', SessionId: '', Extras: '' });
  }
  return fake;
}

const tab = async (page: Page, name: string) => {
  await page.getByRole('tab', { name, exact: true }).click();
  await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#admin-panel [aria-busy="true"]')).toHaveCount(0);
};
const inWindow = (page: Page, selector: string) => page.locator(selector).evaluate((element) => {
  const box = element.getBoundingClientRect();
  return box.height > 0 && box.top >= 0 && box.top < window.innerHeight && box.bottom > 0;
});

test.describe('the selection and what it opens stay side by side (Prompt 40)', () => {
  test.describe.configure({ timeout: 240_000 });
  for (const width of WIDTHS) {
    test(`at ${width} px`, async ({ page }) => {
      await mkdir(pictures, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await serveSharePoint(page, await site());
      await page.goto(pageUrl('admin.html'));
      await expect(page.getByTestId('identity-chip')).toBeVisible();
      const welcome = page.getByTestId('welcome-strip');
      if (await welcome.count()) await welcome.getByRole('button', { name: 'Got it' }).click();
      await page.evaluate(() => document.fonts.ready);

      // 1. The bar: five dividers, between neighbours only, 1 x 20 px in the line colour; the word as far from each on both sides.
      const bar = await page.evaluate(() => {
        const tabs = [...document.querySelectorAll<HTMLElement>('.shell__nav .tab')];
        const line = getComputedStyle(document.documentElement).getPropertyValue('--adm-line').trim();
        const words = (tab: HTMLElement) => {
          const range = document.createRange();
          range.selectNodeContents([...tab.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).at(-1)!);
          return range.getBoundingClientRect();
        };
        return {
          line,
          dividers: tabs.map((tab) => {
            const mark = getComputedStyle(tab, '::before');
            if (mark.content === 'none' || mark.content === 'normal') return null;
            return { left: tab.getBoundingClientRect().left + parseFloat(mark.left), width: mark.width, height: mark.height, colour: mark.backgroundColor };
          }),
          words: tabs.map((tab) => ({ end: words(tab).right, start: tab.querySelector('.icon')!.getBoundingClientRect().left })),
          scrolls: document.querySelector('.tabs')!.scrollWidth - document.querySelector('.tabs')!.clientWidth,
        };
      });
      expect(bar.dividers[0], `${width}: none before the first tab`).toBeNull();
      expect(bar.dividers.filter(Boolean), `${width}: five dividers`).toHaveLength(5);
      expect(bar.scrolls, `${width}: one line, no scroll`).toBeLessThanOrEqual(0);
      for (const [at, divider] of bar.dividers.entries()) {
        if (!divider) continue;
        expect([divider.width, divider.height], `${width}: divider ${at} is 1 x 20 px`).toEqual(['1px', '20px']);
        const before = divider.left - bar.words[at - 1].end;
        const after = bar.words[at].start - (divider.left + 1);
        expect(Math.abs(before - after), `${width}: divider ${at}, ${before} px before and ${after} px after`).toBeLessThanOrEqual(1);
      }
      if (width === 1440) await page.locator('.shell__bar').screenshot({ path: `${pictures}header-${width}.png` });

      // 2. Clients: the list and the client's strip stay in the window as the client's page scrolls.
      await tab(page, 'Clients');
      await page.getByRole('button', { name: 'Sessions and team: Kroger' }).click();
      await expect(page.getByTestId('client-context')).toContainText('Kroger');
      await expect(page.locator('.client-row[aria-current="true"]')).toHaveClass(/adm-selected/);
      await expect(page.locator('.workspace')).toHaveAttribute('aria-busy', 'false');
      await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(150);
      expect(await page.evaluate(() => window.scrollY), `${width}: the page scrolled`).toBeGreaterThan(0);
      expect(await inWindow(page, '.clients__list'), `${width}: the client list is in the window`).toBe(true);
      expect(await inWindow(page, '[data-testid="client-context"]'), `${width}: the client's strip is in the window`).toBe(true);
      expect(await inWindow(page, '.client-row[aria-current="true"]'), `${width}: the open client's row is in the window`).toBe(true);
      await page.screenshot({ path: `${pictures}clients-scrolled-${width}.png` });

      // 3. Content: the last activity's questions open beside it, in the window, with no jump to the top.
      await tab(page, 'Content');
      await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Kroger' });
      await expect(page.locator('#admin-panel [aria-busy="true"]')).toHaveCount(0);
      const rows = page.locator('.content-activities > ul .activity__select');
      expect(await rows.count(), `${width}: six or more activities`).toBeGreaterThanOrEqual(6);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await rows.last().scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => window.scrollY);
      await rows.last().click();
      await expect(page.getByTestId('questions-title')).toHaveText(new RegExp(`^${await rows.count()} · `));
      await expect(rows.last()).toBeFocused();
      expect(await page.evaluate(() => window.scrollY), `${width}: the page did not move`).toBe(before);
      if (before > 0) expect(await page.evaluate(() => window.scrollY), `${width}: no jump to the top`).not.toBe(0);
      expect(await inWindow(page, '.content-detail'), `${width}: the questions are in the window`).toBe(true);
      expect(await inWindow(page, '.questions__head'), `${width}: Add question is in the window`).toBe(true);
      await expect(page.locator('.activity--selected .activity__select')).toHaveText(new RegExp((await rows.last().locator('.row__title').textContent())!));
      await page.screenshot({ path: `${pictures}content-activities-scrolled-${width}.png` });

      // 4. Brand: Pictures, then Colours; edit on the left, the preview on the right, which stays in view.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator('.content-strip__tab[data-view="brand"]').click();
      await expect(page.locator('.brand__preview')).toBeVisible();
      const groups = await page.locator('.brand__controls > :is(section, details)').evaluateAll((parts) => parts.map((part) => ({
        name: part.querySelector('h3, summary')?.textContent?.trim().split(/\s/)[0], top: part.getBoundingClientRect().top })));
      expect(groups.slice(0, 2).map((group) => group.name), `${width}: Pictures first, Colours second, in the page`).toEqual(['Pictures', 'Colours']);
      expect(groups[0].top, `${width}: Pictures above Colours on the screen`).toBeLessThan(groups[1].top);
      const [controls, preview] = await Promise.all([page.locator('.brand__controls').boundingBox(), page.locator('.brand__preview').boundingBox()]);
      expect(controls!.x, `${width}: the controls left of the preview`).toBeLessThan(preview!.x);
      expect(await page.locator('.brand__grid > *').evaluateAll((parts) => parts.map((part) => part.className.split(' ')[0])), `${width}: controls then preview in the page`).toEqual(['brand__controls', 'brand__preview']);
      await page.evaluate(() => window.scrollBy(0, 600));
      await page.waitForTimeout(150);
      expect(await inWindow(page, '.brand__preview'), `${width}: the preview stays in view`).toBe(true);
      await page.screenshot({ path: `${pictures}brand-${width}.png` });

      // 5. People: each label starts where its field's words do.
      await page.evaluate(() => window.scrollTo(0, 0));
      await tab(page, 'People');
      const labels = await page.evaluate(() => ['users-search', 'users-client', 'users-session', 'users-status'].map((id) => {
        const field = document.getElementById(id)!;
        const words = document.createRange();
        words.selectNodeContents(document.querySelector(`label[for="${id}"]`)!);
        const style = getComputedStyle(field);
        // (A native <select> draws its words a few px inside its padding, so a select must be the page's own drawn one for the padding to be where they start.)
        return { id, label: words.getBoundingClientRect().left, field: field.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
          baseline: words.getBoundingClientRect().bottom, drawn: field.tagName !== 'SELECT' || style.appearance === 'none' };
      }));
      for (const label of labels) {
        expect(Math.abs(label.label - label.field), `${width}: ${label.id}'s label at ${label.label}, its words at ${label.field}`).toBeLessThanOrEqual(1);
        expect(label.drawn, `${width}: ${label.id} is drawn by the page, so its words start at its padding`).toBe(true);
      }
      if (width >= 1280) expect(Math.max(...labels.map((label) => label.baseline)) - Math.min(...labels.map((label) => label.baseline)), `${width}: one baseline`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `${pictures}people-${width}.png` });
    });
  }
});
