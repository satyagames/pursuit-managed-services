import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';

// Prompt 32, step 2: your role beside your name. The BUILT admin page, signed in as a person of the new lists, against the mocked SharePoint REST:
// the chip says the role and where it reaches without a click, the "Your access" popover says what the role may and may not do, and the welcome strip
// comes once per change of role. Everything is from the access the page reads at sign-in: nothing more is asked for.

const pictures = fileURLToPath(new URL('../../test-results/admin/identity/', import.meta.url));
const mail = (name: string) => `${name}@deloitte.com`;
const me = (name: string, title: string) => ({ Id: 7, Title: title, Email: mail(name), LoginName: `i:0#.f|membership|${mail(name)}`, IsSiteAdmin: false });
type Who = ReturnType<typeof me>;
const dayAhead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** One role row of `who`'s. */
const grant = (fake: Fake, who: Who, role: string, scope: string, place: Record<string, string> = {}, validUntil = '') => fake.add('roleassignments', {
  Title: `${who.Email}|${role}`, AppId: `${who.Email}|${role}|${scope}|${place.ClientId ?? ''}`, UserKey: who.Email, Role: role, ScopeType: scope,
  ClientId: '', SessionId: '', Extras: '', ...place, ...(validUntil ? { ValidUntil: `${validUntil}T00:00:00Z` } : {}),
});

/** A site with the sample clients and `who` signed in, holding `role` for `scope`. */
async function site(who: Who, role: string, scope: string, place: Record<string, string> = {}, validUntil = '') {
  const fake = newFake({ user: who });
  await onSite(fake, (ds) => seedPack(ds, samplePack()));
  fake.add('users', { Title: who.Email, AppId: who.Email, FullName: who.Title, Email: who.Email, Status: 'Active', Source: 'Typed' });
  grant(fake, who, role, scope, place, validUntil);
  return fake;
}
async function open(page: Page, fake: Fake) {
  const served = await serveSharePoint(page, fake);
  await page.goto(pageUrl('admin.html'));
  await expect(page.getByTestId('identity-chip')).toBeVisible();
  return served;
}
const chip = (page: Page) => page.getByTestId('identity-chip');
const popover = (page: Page) => page.getByTestId('access-popover');

const PERSONAS = [
  { role: 'Super admin', scope: 'global', place: {}, who: me('vsatyadev', 'Satyadev, Vedala Venkata'), line: 'Super admin · All clients', initials: 'VS' },
  { role: 'Admin', scope: 'global', place: {}, who: me('pulmathur', 'Mathur, Pulkit'), line: 'Admin · All clients', initials: 'PM' },
  { role: 'Producer', scope: 'client', place: { ClientId: 'c-kroger' }, who: me('raedla', 'Aedla, Rajeshwar'), line: 'Producer · 1 client', initials: 'RA' },
  { role: 'Designer', scope: 'client', place: { ClientId: 'c-kroger' }, who: me('mohammadahussain', 'Hussain, Mohammad Afrid'), line: 'Designer · 1 client', initials: 'MH' },
  { role: 'Leadership', scope: 'client', place: { ClientId: 'c-kroger' }, who: me('ablepe', 'Lepe, Annabell'), line: 'Leadership · Results', initials: 'AL' },
] as const;

test.describe('the chip says the role and its reach, without a click', () => {
  for (const persona of PERSONAS) {
    test(`${persona.role}: "${persona.line}"`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 780 });
      await open(page, await site(persona.who, persona.role, persona.scope, persona.place));
      await expect(page.getByTestId('identity-role')).toHaveText(persona.line);
      await expect(chip(page)).toContainText(persona.initials);
      const name = persona.who.Title.split(', ').reverse().join(' ');
      await expect(chip(page)).toHaveAccessibleName(`Signed in as ${name}, ${persona.role}, ${persona.line.split(' · ')[1]}. Opens your access.`);
      await chip(page).click();
      await expect(popover(page)).toBeVisible();
      await expect(popover(page).getByRole('heading', { name: 'Your access' })).toBeVisible();
      await expect(popover(page)).toContainText(name);
      await expect(popover(page)).not.toContainText(persona.who.Email);
      await expect(popover(page)).toContainText('Signed in with your Deloitte account');
      await expect(popover(page).getByRole('row')).toHaveCount(2);
      await expect(popover(page).getByRole('row').nth(1)).toContainText(persona.role);
      await expect(popover(page).getByRole('row').nth(1)).toContainText('No end date');
      await expect(popover(page).getByRole('button', { name: 'Copy my details' })).toBeVisible();
      await mkdir(pictures, { recursive: true });
      await page.screenshot({ path: `${pictures}chip-${persona.role.replace(' ', '-').toLowerCase()}.png`, clip: { x: 0, y: 0, width: 1440, height: 640 } });
      const words = { line: persona.line, canDo: await page.getByTestId('access-can-do').locator('li').allTextContents(), notAvailable: await page.getByTestId('access-not-available').textContent() };
      test.info().annotations.push({ type: 'words', description: JSON.stringify(words) });
    });
  }

  test('a Producer is told who does Clients, People and Reporting settings; a Super admin that nothing is hidden', async ({ page }) => {
    await open(page, await site(PERSONAS[2].who, 'Producer', 'client', { ClientId: 'c-kroger' }));
    await chip(page).click();
    await expect(page.getByTestId('access-not-available')).toHaveText('Clients and People: a Super admin or an Admin does these; Reporting settings: a Super admin does this.');
    const other = await page.context().browser()!.newPage();
    await open(other, await site(PERSONAS[0].who, 'Super admin', 'global'));
    await chip(other).click();
    await expect(other.getByTestId('access-not-available')).toHaveText('Nothing hidden: you have every tab');
    await other.close();
  });

  test('several roles: the highest first and "+1"; an end date nine days ahead is a word in the chip and in the popover', async ({ page }) => {
    const who = PERSONAS[2].who;
    const fake = await site(who, 'Designer', 'client', { ClientId: 'c-dominos' });
    grant(fake, who, 'Producer', 'client', { ClientId: 'c-kroger' }, dayAhead(9));
    await open(page, fake);
    await expect(page.getByTestId('identity-role')).toContainText('Producer +1 · 1 client');
    await expect(page.getByTestId('identity-ends')).toHaveText(/^Ends \d{1,2} [A-Z][a-z]{2}$/);
    await chip(page).click();
    await expect(popover(page).getByRole('row').nth(1)).toContainText('9 days');
    await expect(popover(page).getByRole('row').nth(2)).toContainText('Designer');
  });
});

test.describe('the popover from the keyboard', () => {
  test('Tab to the chip, Enter opens, Esc closes and focus returns; Space opens; Tab leaves the popover (no trap); a click outside closes it', async ({ page, browserName }) => {
    await open(page, await site(PERSONAS[0].who, 'Super admin', 'global'));
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    await page.locator('body').focus();
    for (let step = 0; step < 20 && !(await chip(page).evaluate((element) => element === document.activeElement)); step += 1) await page.keyboard.press(tab);
    await expect(chip(page)).toBeFocused();
    await expect(chip(page)).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(popover(page)).toBeVisible();
    await expect(chip(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(chip(page)).toHaveAttribute('aria-controls', 'your-access');
    await page.keyboard.press('Escape');
    await expect(popover(page)).toHaveCount(0);
    await expect(chip(page)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(popover(page)).toBeVisible();
    // Not a trap: Tab goes through the popover's button and on, out of it.
    await page.keyboard.press(tab);
    await expect(popover(page).getByRole('button', { name: 'Copy my details' })).toBeFocused();
    await page.keyboard.press(tab);
    expect(await popover(page).evaluate((element) => element.contains(document.activeElement))).toBe(false);
    // A second press closes it; so does a click outside.
    await chip(page).click();
    await expect(popover(page)).toHaveCount(0);
    await chip(page).click();
    await page.locator('#admin-panel h2').first().click();
    await expect(popover(page)).toHaveCount(0);
  });
});

test.describe('the welcome strip', () => {
  test('shows on the first visit, not the second, and again after the role changes; "What can I do?" opens the popover', async ({ page }) => {
    const who = PERSONAS[2].who;
    const fake = await site(who, 'Producer', 'client', { ClientId: 'c-kroger' });
    await open(page, fake);
    const strip = page.getByTestId('welcome-strip');
    await expect(strip).toHaveText(/Welcome, Rajeshwar\. You are signed in as Producer for 1 client\./);
    await expect(strip).toHaveAttribute('role', 'status');
    await strip.getByRole('button', { name: 'What can I do?' }).click();
    await expect(popover(page)).toBeVisible();
    await expect(popover(page).getByRole('heading', { name: 'Your access' })).toBeFocused();
    await page.keyboard.press('Escape');
    await strip.getByRole('button', { name: 'Got it' }).click();
    await expect(strip).toHaveCount(0);

    await page.reload();
    await expect(chip(page)).toBeVisible();
    await expect(page.locator('#admin-panel h2').first()).toBeVisible();
    await expect(strip).toHaveCount(0);

    grant(fake, who, 'Producer', 'client', { ClientId: 'c-dominos' });
    await page.reload();
    await expect(strip).toHaveText(/signed in as Producer for 2 clients/);
    // Nothing of the person is in storage but a hash: no name, no email.
    const stored = await page.evaluate(() => Object.keys(localStorage).map((key) => `${key}=${localStorage.getItem(key)}`).join(' '));
    expect(stored).toMatch(/pms\.welcome\./);
    expect(stored).not.toMatch(/raedla|Rajeshwar|Aedla|@/i);
  });

  test('with storage blocked it shows once for the tab and the page works', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
    });
    await open(page, await site(PERSONAS[2].who, 'Producer', 'client', { ClientId: 'c-kroger' }));
    const strip = page.getByTestId('welcome-strip');
    await expect(strip).toBeVisible();
    await strip.getByRole('button', { name: 'Got it' }).click();
    await expect(strip).toHaveCount(0);
    await page.getByRole('tab', { name: 'Results' }).click();
    await page.getByRole('tab', { name: 'Today' }).click();
    await expect(strip).toHaveCount(0);
    expect(problems).toEqual([]);
  });
});

test.describe('the chip at every width', () => {
  for (const width of [360, 768, 1280]) {
    test(`at ${width} px the role is shown and nothing overlaps`, async ({ page }) => {
      await page.setViewportSize({ width, height: 760 });
      await open(page, await site(PERSONAS[2].who, 'Producer', 'client', { ClientId: 'c-kroger' }));
      await expect(page.getByTestId('identity-role')).toBeVisible();
      await expect(page.getByTestId('identity-role')).toHaveText('Producer · 1 client');
      const boxes = await page.evaluate(() => ['.shell__brand', '[data-testid="identity-chip"]', '[data-testid="copy-label"]'].map((selector) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null;
      }));
      const [brand, chipBox] = boxes;
      const apart = (a: typeof brand, b: typeof brand) => !a || !b || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
      expect(apart(brand, chipBox), 'the brand and the chip').toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll').toBe(true);
      if (width < 900) await expect(page.locator('.who__name')).toBeHidden();
      await mkdir(pictures, { recursive: true });
      await page.screenshot({ path: `${pictures}chip-${width}.png`, clip: { x: 0, y: 0, width, height: 140 } });
    });
  }
});
