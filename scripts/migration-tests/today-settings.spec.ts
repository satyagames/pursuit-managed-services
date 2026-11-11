import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { newFake, pageUrl, seedAndGoLive, serveSharePoint, type Fake } from './sharepoint.js';
import { STAFF_MODE_WARNING, localDate } from '../../migration/src/lib/admin/admin-today.js';

// Prompt 43: Today's Session settings. Folded, the three settings are three chips (icon first, a short word) and a Change toggle; open, the toggle
// keeps its place and width, says Hide and its chevron turns up, and the panel below has the three segmented controls and a footer that says changes
// save automatically. The staff-mode notice is in the card once. The BUILT admin page against the mocked SharePoint REST, signed in as a Super admin
// (who may run the session) or an Admin (who may not: events.run).

const pictures = fileURLToPath(new URL('../../test-results/admin/session-settings/', import.meta.url));
const today = localDate();
const mail = (name: string) => `${name}@deloitte.com`;
const me = (name: string, title: string) => ({ Id: 7, Title: title, Email: mail(name), LoginName: `i:0#.f|membership|${mail(name)}`, IsSiteAdmin: false });
const SUPER = me('vsatyadev', 'Satyadev, Vedala Venkata');
const PRODUCER = me('raedla', 'Aedla, Rajeshwar');
const WIDTHS = [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }] as const;

/** A site with the sample clients, `live` live today, and `who` signed in holding `role` (for all clients, or for `clientId` alone). */
async function site(who: ReturnType<typeof me>, role: string, { live = 'c-kroger', clientId = '' } = {}) {
  const fake = newFake({ user: who });
  await seedAndGoLive(fake, live, today);
  fake.add('users', { Title: who.Email, AppId: who.Email, FullName: who.Title, Email: who.Email, Status: 'Active', Source: 'Typed' });
  fake.add('roleassignments', {
    Title: `${who.Email}|${role}`, AppId: `${who.Email}|${role}|${clientId ? 'client' : 'global'}|${clientId}`, UserKey: who.Email, Role: role, ScopeType: clientId ? 'client' : 'global', ClientId: clientId, SessionId: '', Extras: '',
  });
  return fake;
}

async function open(page: Page, fake: Fake, query = '') {
  await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('admin.html')}${query}`);
  await expect(page.locator('section[data-live]')).toContainText('LIVE');
  await page.evaluate(() => document.fonts.ready);
}

const card = (page: Page) => page.locator('section.controls');
const chips = (page: Page) => card(page).locator('[data-chip]');
const chip = (page: Page, group: 'mode' | 'flow' | 'check') => card(page).locator(`[data-chip="${group}"]`);
const toggle = (page: Page) => page.getByTestId('settings-toggle');
const foot = (page: Page) => page.getByTestId('settings-foot');
const box = async (locator: Locator) => (await locator.boundingBox())!;
const shoot = (page: Page, name: string) => card(page).screenshot({ path: `${pictures}${name}.png` });

/** The chips' tops, and whether any chip's words overflow it or wrap. */
const chipRow = (page: Page) => chips(page).evaluateAll((all) => all.map((element) => {
  const rect = element.getBoundingClientRect();
  const words = element.querySelector('span')!;
  return { top: Math.round(rect.top), width: Math.round(rect.width), room: Math.round(element.parentElement!.parentElement!.clientWidth), overflow: element.scrollWidth > element.clientWidth + 1, lines: words.getClientRects().length };
}));

test.beforeAll(async () => { await mkdir(pictures, { recursive: true }); });

for (const size of WIDTHS) {
  test(`at ${size.width} px: three chips on one row, Change and its chevron; open, Hide in the same place and width with the chevron up, and no Done`, async ({ page }) => {
    await page.setViewportSize(size);
    await open(page, await site(SUPER, 'Super admin'));
    // Folded.
    await expect(chips(page)).toHaveText(['Staff sign in', 'Sequential', 'Confidence off']);
    const row = await chipRow(page);
    expect(new Set(row.map((entry) => entry.top)).size, `one row: ${JSON.stringify(row)}`).toBe(1);
    expect(row.every((entry) => !entry.overflow && entry.lines === 1), 'no chip wraps or overflows').toBe(true);
    await expect(toggle(page)).toHaveAccessibleName('Change');
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle(page).locator('svg')).toHaveAttribute('data-icon', 'chevron-down');
    await expect(page.locator('#today-settings')).toBeHidden();
    await expect(chips(page).locator('svg[data-icon]').first()).toHaveAttribute('data-icon', 'badge');
    const before = await box(toggle(page));
    // Open.
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle(page)).toHaveAccessibleName('Hide');
    await expect.poll(() => toggle(page).locator('.toggle__chevron').evaluate((element) => getComputedStyle(element).transform)).toBe('matrix(-1, 0, 0, -1, 0, 0)');
    const after = await box(toggle(page));
    for (const key of ['x', 'y', 'width'] as const) expect(Math.abs(after[key] - before[key]), `toggle ${key}`).toBeLessThanOrEqual(1);
    await expect(card(page).getByText('Done', { exact: true })).toHaveCount(0);
    await expect(card(page).getByRole('button', { name: 'Done' })).toHaveCount(0);
    for (const group of ['How people are identified', 'Activity flow', 'Confidence check']) {
      await expect(card(page).getByRole('group', { name: group }).getByRole('radio'), group).toHaveCount(2);
      await expect(card(page).getByRole('group', { name: group })).toBeVisible();
    }
    await expect(page.locator('#today-settings')).toHaveAttribute('role', 'group');
    await expect(foot(page)).toHaveText('Changes save automatically');
    if (size.width === 1440) await shoot(page, 'open-staff-1440');
  });
}

test('each change updates its chip at once, the footer says Saving… then Changes save automatically, and the panel stays open; Esc folds it to the toggle', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fake = await site(SUPER, 'Super admin');
  await open(page, fake);
  await shoot(page, 'closed-1440');
  await toggle(page).click();
  // (The footer is polite: it says what is happening, and a write that is under way says Saving….)
  const states: string[] = [];
  await page.exposeFunction('footState', (state: string) => { states.push(state); });
  await foot(page).evaluate((element) => {
    new MutationObserver(() => (window as unknown as { footState: (s: string) => void }).footState(element.dataset.state ?? '')).observe(element, { attributes: true });
  });
  await expect(foot(page)).toHaveAttribute('aria-live', 'polite');

  await card(page).getByRole('radio', { name: /Guests scan a personal QR/ }).check();
  await expect(chip(page, 'mode')).toHaveText('Guests scan QR');
  await expect(chip(page, 'mode')).toHaveClass(/chip--primary/);
  await expect(chip(page, 'mode').locator('svg').first()).toHaveAttribute('data-icon', 'qr');
  await expect(foot(page)).toHaveText('Changes save automatically');
  await card(page).getByRole('radio', { name: /^Open/ }).check();
  await expect(chip(page, 'flow')).toHaveText('Open');
  await expect(chip(page, 'flow').locator('svg').first()).toHaveAttribute('data-icon', 'grid');
  await card(page).getByRole('radio', { name: /^On/ }).check();
  await expect(chip(page, 'check')).toHaveText('Confidence on');
  await expect(foot(page)).toHaveText('Changes save automatically');
  expect(states, 'each write was Saving… then saved').toEqual(['saving', 'saved', 'saving', 'saved', 'saving', 'saved']);
  await expect.poll(() => fake.item('sessions', `kroger-${today}`)?.ActivityFlow).toBe('open');
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#today-settings')).toBeVisible();

  // Esc folds it and puts the focus back on the toggle.
  await card(page).getByRole('radio', { name: /^On/ }).focus();
  await page.keyboard.press('Escape');
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle(page)).toBeFocused();
  await expect(page.locator('#today-settings')).toBeHidden();
});

test('the keyboard: chips, then the toggle, then the groups; the arrows move inside a control without choosing, Space chooses', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fake = await site(SUPER, 'Super admin');
  await open(page, fake);
  await chip(page, 'mode').focus();
  await page.keyboard.press('Tab');
  await expect(chip(page, 'flow')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(chip(page, 'check')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(toggle(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(card(page).getByRole('radio', { name: /Staff sign in/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(card(page).getByRole('radio', { name: /^Sequential/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(card(page).getByRole('radio', { name: /^Open/ })).toBeFocused();
  await expect(card(page).getByRole('radio', { name: /^Sequential/ }), 'an arrow does not choose').toBeChecked();
  await page.keyboard.press('Space');
  await expect(chip(page, 'flow')).toHaveText('Open');
  await expect.poll(() => fake.item('sessions', `kroger-${today}`)?.ActivityFlow).toBe('open');
});

test('the Confidence chip opens the panel at the confidence check; clicking it again does not fold it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, await site(SUPER, 'Super admin'));
  await chip(page, 'check').click();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(card(page).getByRole('group', { name: 'Confidence check' }).getByRole('radio').first()).toBeFocused();
  await chip(page, 'check').click();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
});

test('the staff-mode notice: in the card once, under Identification, only while Staff sign in is chosen; folded, a marker on the chip', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, await site(SUPER, 'Super admin'));
  // Folded: no sentence in the card, a marker on the Identification chip with the sentence as its tooltip and in its name.
  await expect(card(page).getByText('own sign-in')).toHaveCount(0);
  await expect(chip(page, 'mode').getByTestId('staff-mode-marker')).toBeVisible();
  await expect(chip(page, 'mode')).toHaveAttribute('title', STAFF_MODE_WARNING);
  await expect(chip(page, 'mode')).toHaveAccessibleName(new RegExp(`^Staff sign in\\. ${STAFF_MODE_WARNING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  // Still in Readiness, as before.
  await expect(page.locator('[data-check="staff-signin"]')).toHaveAttribute('data-level', 'warning');
  // Open: once, directly under Identification.
  await toggle(page).click();
  await expect(card(page).getByText('own sign-in')).toHaveCount(1);
  await expect(card(page).getByRole('group', { name: 'How people are identified' }).getByTestId('staff-mode-warning')).toHaveText(STAFF_MODE_WARNING);
  await shoot(page, 'open-staff-notice-1440');
  // Guests: gone from the card, and the marker with it.
  await card(page).getByRole('radio', { name: /Guests scan a personal QR/ }).check();
  await expect(card(page).getByText('own sign-in')).toHaveCount(0);
  await expect(chip(page, 'mode').getByTestId('staff-mode-marker')).toHaveCount(0);
  page.once('dialog', (dialog) => dialog.accept());
  await card(page).getByRole('radio', { name: /Staff sign in/ }).check();
  await expect(card(page).getByText('own sign-in')).toHaveCount(1);
});

test('a write that fails says so in the footer with Retry, and Retry writes it again', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fake = await site(SUPER, 'Super admin');
  await open(page, fake);
  await toggle(page).click();
  const handle = fake.handle.bind(fake);
  let failing = true;
  fake.handle = (async (request: Parameters<Fake['handle']>[0]) => (failing && request.method !== 'GET' && !/contextinfo/i.test(request.url)
    ? { status: 403, headers: { 'content-type': 'application/json;odata=nometadata' }, body: JSON.stringify({ 'odata.error': { code: '-2147024891, System.UnauthorizedAccessException', message: { lang: 'en-US', value: 'Access denied.' } } }) }
    : handle(request))) as Fake['handle'];
  await card(page).getByRole('radio', { name: /^Open/ }).check();
  await expect(foot(page)).toHaveAttribute('data-state', 'error');
  await expect(foot(page).locator('svg[data-icon="alert-triangle"]')).toBeVisible();
  await expect(foot(page).getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  // (Nothing was written: the control and its chip still say what is saved.)
  await expect(card(page).getByRole('radio', { name: /^Sequential/ })).toBeChecked();
  await expect(chip(page, 'flow')).toHaveText('Sequential');
  await shoot(page, 'error-saving-1440');
  failing = false;
  await foot(page).getByRole('button', { name: 'Retry' }).click();
  await expect(foot(page)).toHaveText('Changes save automatically');
  await expect(chip(page, 'flow')).toHaveText('Open');
  await expect.poll(() => fake.item('sessions', `kroger-${today}`)?.ActivityFlow).toBe('open');
});

// (Today is the tab of events.run, granted per client, and a Producer reads only their own clients' sessions: a Kroger Producer, while Domino's is
// live, never reads Domino's session, so the card has no settings to show and nothing to change. The second guard, chips without a toggle when
// events.run is missing for the session shown, is pinned on TodayControls' source in scripts/test-today-view.js: no persona reaches it today.)
test('a person without events.run for the live session (a Kroger Producer while Domino\'s is live) gets no chips, no toggle and no controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await serveSharePoint(page, await site(PRODUCER, 'Producer', { live: 'c-dominos', clientId: 'c-kroger' }));
  await page.goto(pageUrl('admin.html'));
  await expect(card(page)).toContainText('Go live first. These apply to the live session.');
  await expect(chips(page)).toHaveCount(0);
  await expect(toggle(page)).toHaveCount(0);
  await expect(card(page).getByRole('radio')).toHaveCount(0);
});

test('axe finds nothing in either state; chips and segments are 4.5:1 for words and 3:1 for icons', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, await site(SUPER, 'Super admin'));
  const scan = async () => (await new AxeBuilder({ page }).include('section.controls').analyze()).violations.map((each) => `${each.id}: ${each.nodes.map((node) => node.target).join(', ')}`);
  expect(await scan()).toEqual([]);
  // A changed chip too (the primary wash).
  await toggle(page).click();
  await card(page).getByRole('radio', { name: /^Open/ }).check();
  await expect(chip(page, 'flow')).toHaveClass(/chip--primary/);
  await expect(page.locator('.settings__fold--open')).toBeVisible();
  expect(await scan()).toEqual([]);
  const ratios = await card(page).evaluate((root) => {
    const rgb = (value: string) => { const [r, g, b, a = 1] = value.match(/[\d.]+/g)!.map(Number); return { r, g, b, a }; };
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => [r, g, b].map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a: string, b: string) => { const x = lum(rgb(a)); const y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const background = (element: Element): string => {
      for (let at: Element | null = element; at; at = at.parentElement) { const value = getComputedStyle(at).backgroundColor; if (rgb(value).a > 0) return value; }
      return 'rgb(255, 255, 255)';
    };
    const measure = (selector: string) => [...root.querySelectorAll(selector)].map((element) => ({
      selector, words: ratio(getComputedStyle(element).color, background(element)),
      icon: (() => { const svg = element.querySelector('svg'); return svg ? ratio(getComputedStyle(svg).color, background(svg)) : null; })(),
    }));
    return [...measure('[data-chip]'), ...measure('.seg__option'), ...measure('.settings__toggle'), ...measure('.chip__mark')];
  });
  for (const entry of ratios) {
    if (entry.selector !== '.chip__mark') expect(entry.words, `${entry.selector} words`).toBeGreaterThanOrEqual(4.5);
    if (entry.icon !== null) expect(entry.icon, `${entry.selector} icon`).toBeGreaterThanOrEqual(3);
  }
});

test('motion off: the panel opens and folds, and the chevron turns, with no animation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, await site(SUPER, 'Super admin'), '?motion=off');
  const timing = () => page.evaluate(() => ({
    fold: getComputedStyle(document.querySelector('.settings__fold')!).transitionDuration,
    chevron: getComputedStyle(document.querySelector('.toggle__chevron')!).transitionDuration,
  }));
  await toggle(page).click();
  expect(await timing()).toEqual({ fold: '0s', chevron: '0s' });
  await expect(page.locator('#today-settings')).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => (animation.effect as KeyframeEffect | null)?.target?.closest?.('section.controls')).length)).toBe(0);
  await toggle(page).click();
  expect(await timing()).toEqual({ fold: '0s', chevron: '0s' });
  await expect(page.locator('#today-settings')).toBeHidden();
});

test('at full motion the panel takes 200 ms and the chevron 160 ms', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, await site(SUPER, 'Super admin'));
  await toggle(page).click();
  const timing = await page.evaluate(() => ({
    fold: getComputedStyle(document.querySelector('.settings__fold')!).transitionDuration,
    chevron: getComputedStyle(document.querySelector('.toggle__chevron')!).transitionDuration,
  }));
  // (Opening, the panel is visible from the first frame; folding, it stays visible until its height is gone.)
  expect(timing).toEqual({ fold: '0.2s, 0s', chevron: '0.16s' });
});

test('Go live folds the panel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fake = await site(SUPER, 'Super admin');
  await open(page, fake);
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await page.getByLabel('Client', { exact: true }).selectOption({ label: "Domino's" });
  await page.getByTestId('sticky-bar').getByRole('button', { name: 'Go live' }).click();
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button').last().click();
  await expect(page.locator('section[data-live]')).toContainText("Domino's");
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
});

