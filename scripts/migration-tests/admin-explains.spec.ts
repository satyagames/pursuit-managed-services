import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ME, PEOPLE, open, settled, site } from './explain-support.js';

// Prompt 33: the admin page explains itself. Each tab's title line (icon, title, one sentence, at most one green main action), names on
// every form and panel, breadcrumbs, numbered steps on Guests and QR, the folded low-priority blocks, the role switches and the round red
// minus, Content's two parts. The BUILT admin page on the mocked SharePoint (explain-support.ts). Pictures go to test-results/admin/explain/.

const pictures = fileURLToPath(new URL('../../test-results/admin/explain/', import.meta.url));
const SIZES = [{ width: 1366, height: 650 }, { width: 1920, height: 950 }] as const;
const GREEN = 'rgb(47, 107, 79)'; // --adm-primary, #2F6B4F (Prompt 38; it was #237F0C)
const shoot = async (page: Page, name: string) => {
  await mkdir(pictures, { recursive: true });
  const { width, height } = page.viewportSize()!;
  await page.screenshot({ path: `${pictures}${name}-${width}x${height}.png`, fullPage: true });
};
const head = (page: Page) => page.locator('.shell__body .panel__head:visible').first();

// ---- The title line, on every tab ---------------------------------------------------------------------------

const TABS = [
  { hash: 'today', title: 'Today' }, { hash: 'clients', title: 'Clients' }, { hash: 'content', title: 'Content' },
  { hash: 'guests', title: 'Guests and QR codes' }, { hash: 'results', title: 'Results' }, { hash: 'users', title: 'People' },
] as const;

test('every tab: its title has an icon and one sentence, at most one main action, green; no button only says Save, OK or Submit', async ({ page }) => {
  for (const each of TABS) {
    await open(page, await site(), each.hash);
    await settled(page);
    const line = head(page);
    await expect(line.locator('h2'), `${each.hash}: the title`).toContainText(each.title);
    await expect(line.locator('h2 svg[data-icon]'), `${each.hash}: the title's icon`).toHaveCount(1);
    await expect(line.locator('p').first(), `${each.hash}: one sentence`).toHaveText(/^[^.]+\.$/);
    const mains = line.locator('.btn--primary:visible');
    expect(await mains.count(), `${each.hash}: at most one main action`).toBeLessThanOrEqual(1);
    for (const main of await page.locator('.shell__body .btn--primary:visible').all()) {
      expect(await main.evaluate((el) => getComputedStyle(el).backgroundColor), `${each.hash}: the main action is green`).toBe(GREEN);
    }
    await expect(page.locator('.shell__body').getByRole('button', { name: /^(Save|OK|Submit)$/ })).toHaveCount(0);
  }
});

// ---- Folded blocks ------------------------------------------------------------------------------------------

/** A folded block: closed on load, its count in the header, opened and closed by mouse and keyboard, skipped by Tab while closed. */
async function checkFold(page: Page, button: Locator, panelText: RegExp | string, summary: RegExp, reopen: () => Promise<void> = async () => {}) {
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).toHaveAccessibleName(summary);
  await expect(button).toContainText('Show');
  const panel = page.locator(`#${await button.getAttribute('aria-controls')}`);
  await expect(panel).toBeHidden();
  await button.focus();
  await page.keyboard.press('Tab');
  expect(await panel.evaluate((el) => el.contains(document.activeElement)), 'Tab skips the closed panel').toBe(false);
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(button).toContainText('Hide');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(panelText);
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Space');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored, 'nothing about the fold is stored').not.toMatch(/fold|entries|history|participant-details/i);
  await page.reload();
  await reopen();
  await expect(page.getByRole('button', { name: summary })).toHaveAttribute('aria-expanded', 'false');
}

test('Guests and QR: Recent app entries is folded, with its count and a clock', async ({ page }) => {
  await open(page, await site(), 'guests');
  const button = page.getByRole('button', { name: /^Recent app entries/ });
  await expect(button.locator('svg[data-icon="clock"]')).toHaveCount(1);
  await checkFold(page, button, /Entries appear here as guests scan their codes/, /^Recent app entries · none yet Show$/);
});

test('People: a person\'s History of changes is folded, with its count and latest day', async ({ page }) => {
  await open(page, await site(), 'users');
  await page.getByRole('button', { name: 'Open Mathur, Pulkit' }).click();
  const button = page.getByTestId('person-history').getByRole('button');
  await checkFold(page, button, /Satyadev, Vedala Venkata/, /^History of changes · 2 entries, latest 3 Nov 2026 Show$/,
    () => page.getByRole('button', { name: 'Open Mathur, Pulkit' }).click());
});

test('Results: the session\'s People are folded under its charts, with a count', async ({ page }) => {
  const built = await site();
  await open(page, built, 'results');
  const card = page.locator(`article[data-session="${built.sessionId}"]`);
  const button = card.getByRole('button', { name: /^People/ });
  const charts = await card.locator('details.tally').boundingBox();
  expect((await button.boundingBox())!.y, 'below the charts').toBeGreaterThan(charts!.y);
  await expect(button.locator('svg[data-icon="users"]')).toHaveCount(1); // (Prompt 38's icon set: users)
  await checkFold(page, button, /Person 1/, /^People · 3 people( · QR codes: .*)? Show$/);
});

// ---- People: switches and the round red minus ----------------------------------------------------------------

const switchOf = (page: Page, role: string) => page.getByRole('switch', { name: new RegExp(`^${role} for all clients`) });
const rolesOf = (built: Awaited<ReturnType<typeof site>>, key: string) => (built.fake.lists.get('roleassignments') ?? []).filter((row) => row.UserKey === key).map((row) => row.Role).sort();

test('People: Super admin and Admin are switches that grant at once, and turning one off asks first, naming the person and the role', async ({ page }) => {
  const built = await site();
  await open(page, built, 'users');
  await page.getByRole('button', { name: 'Open Mathur, Pulkit' }).click();
  await expect(page.getByRole('button', { name: /^Make/ })).toHaveCount(0);
  await expect(switchOf(page, 'Super admin')).toHaveAttribute('aria-checked', 'false');
  await expect(switchOf(page, 'Super admin')).toHaveAccessibleName('Super admin for all clients: off');
  await expect(switchOf(page, 'Admin')).toHaveAttribute('aria-checked', 'true');
  await expect(switchOf(page, 'Admin')).toContainText('On');
  await shoot(page, 'people-switches');

  await switchOf(page, 'Super admin').click();
  await expect(page.getByText('Mathur, Pulkit is now a Super admin.')).toBeVisible();
  await expect(switchOf(page, 'Super admin')).toHaveAttribute('aria-checked', 'true');
  expect(rolesOf(built, 'pulmathur@deloitte.com')).toEqual(['Admin', 'Super admin']);

  await switchOf(page, 'Admin').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText('Remove Admin from Mathur, Pulkit?');
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(switchOf(page, 'Admin')).toHaveAttribute('aria-checked', 'false');
  expect(rolesOf(built, 'pulmathur@deloitte.com')).toEqual(['Super admin']);
});

test('People: a guarded switch is disabled with its reason beside it, never hidden', async ({ page }) => {
  await open(page, await site(), 'users');
  await page.getByLabel('Search people').fill('Satyadev');
  await page.getByRole('button', { name: 'Open Satyadev, Vedala Venkata' }).click();
  await expect(switchOf(page, 'Super admin')).toBeDisabled();
  await expect(switchOf(page, 'Super admin')).toHaveAccessibleDescription('You cannot change your own roles.');
  // An Admin sees a Super admin's switches, disabled, with the reason.
  const admin = { ...ME, Title: 'Mathur, Pulkit', Email: 'pulmathur@deloitte.com', LoginName: 'i:0#.f|membership|pulmathur@deloitte.com' };
  await open(page, await site({ me: admin }), 'users');
  await page.getByLabel('Search people').fill('Satyadev');
  await page.getByRole('button', { name: 'Open Satyadev, Vedala Venkata' }).click();
  await expect(switchOf(page, 'Super admin')).toBeDisabled();
  await expect(switchOf(page, 'Super admin')).toHaveAccessibleDescription('Only a Super admin can give or remove roles for all clients.');
});

test('People and Clients: removing a client role is the round red minus, named for the role, client and person, with a tooltip, and still asks', async ({ page }) => {
  await open(page, await site(), 'users');
  await page.getByRole('button', { name: 'Open Hussain, Mohammad Afrid' }).click();
  const minus = page.getByRole('button', { name: 'Remove Designer for Kroger from Hussain, Mohammad Afrid' });
  await expect(minus.locator('svg[data-icon="minus-circle"]')).toHaveCount(1);
  const box = (await minus.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  await minus.hover();
  await expect(page.getByRole('tooltip', { includeHidden: true }).filter({ hasText: 'Remove' }).first()).toBeVisible();
  await minus.focus();
  await expect(page.getByRole('tooltip', { includeHidden: true }).filter({ hasText: 'Remove' }).first()).toBeVisible();
  await minus.click();
  await expect(page.getByRole('dialog')).toContainText('Remove Designer from Hussain, Mohammad Afrid?');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await open(page, await site(), 'clients');
  await page.locator('#sessions-c-kroger').click();
  const teamMinus = page.getByRole('button', { name: 'Remove Producer for Kroger from Aedla, Rajeshwar' });
  await expect(teamMinus.locator('svg[data-icon="minus-circle"]')).toHaveCount(1);
  await teamMinus.click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

// ---- Breadcrumbs ------------------------------------------------------------------------------------------

test('breadcrumbs inside a person, a client and its new session, and an activity; the earlier parts go back', async ({ page }) => {
  await open(page, await site(), 'users');
  await page.getByRole('button', { name: 'Open Mathur, Pulkit' }).click();
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(crumbs).toHaveText(/People\s*›\s*Mathur, Pulkit/);
  await crumbs.getByRole('button', { name: 'People' }).click();
  await expect(page.locator('.people__detail')).toHaveCount(0);

  await open(page, await site(), 'clients');
  await page.locator('#sessions-c-kroger').click();
  await expect(crumbs).toHaveText(/Clients\s*›\s*Kroger/);
  await page.getByRole('button', { name: 'Add session' }).click();
  await expect(crumbs).toHaveText(/Clients\s*›\s*Kroger\s*›\s*New session/);
  await crumbs.getByRole('button', { name: 'Kroger' }).click();
  await expect(page.getByRole('heading', { name: 'Add a session to Kroger' })).toHaveCount(0);
  await crumbs.getByRole('button', { name: 'Clients' }).click();
  await expect(page.locator('.workspace')).toHaveCount(0);

  await open(page, await site(), 'content');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText(/Content\s*›\s*Activities/);
});

// ---- Clients: named panels ----------------------------------------------------------------------------------

test('Clients: a client\'s three sections, and panels that name the verb and the client, with Required and a specific button', async ({ page }) => {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    const built = await site();
    await open(page, built, 'clients');
    await page.locator('#sessions-c-kroger').click();
    await settled(page);
    for (const [name, words] of [['Client details', /^Client details:/], ['Sessions', /^Sessions: each time you run the app for this client\.$/], ['Team', /^Team:/]] as const) {
      const section = page.locator('.workspace section').filter({ has: page.getByRole('heading', { name, exact: true }) }).first();
      await expect(section.locator('.part__intro').first(), name).toHaveText(words);
    }
    await expect(page.getByRole('button', { name: 'Edit client details' }).locator('svg[data-icon="pencil"]')).toHaveCount(1);

    await page.getByRole('button', { name: 'Add session' }).click();
    const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Add a session to Kroger' }) });
    await expect(form).toContainText('Required');
    expect(await page.getByTestId('sticky-bar').getByRole('button').allTextContents(), 'Cancel, then the one main action, in the bar').toEqual(['Cancel', 'Create session']);
    await shoot(page, 'clients-add-session');
    await form.getByLabel('Start time').fill('14:30');
    await form.getByLabel(/^Title/).fill('Afternoon');
    await page.getByTestId('create-session').click();
    await expect(page.getByText(/^Session added to Kroger/)).toBeVisible();

    await page.getByRole('button', { name: 'Add team member' }).click();
    const team = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Add a team member to Kroger' }) });
    expect(await team.locator('.dialog__actions button').allTextContents()).toEqual(['Cancel', 'Add team member']);
    await team.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Edit client details' }).click();
    const edit = page.getByRole('region', { name: 'Edit client details: Kroger' });
    await expect(edit).toContainText('Participants see this name');
    expect(await edit.locator('.dialog__actions button').allTextContents()).toEqual(['Cancel', 'Save client']);
    await edit.getByRole('button', { name: 'Cancel' }).click();
  }
});

// ---- Content: two parts -------------------------------------------------------------------------------------

test('Content: two large parts with an icon, a name and a meaning, a labelled tablist with arrows, Home and End', async ({ page }) => {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await open(page, await site(), 'content');
    const list = page.getByRole('tablist', { name: 'Content has two parts' });
    const parts = list.getByRole('tab');
    await expect(parts).toHaveCount(2);
    for (const [index, [name, meaning]] of [['Activities', 'What people answer: activities and questions'], ['Brand', 'How it looks: logo, colours and fonts']].entries()) {
      await expect(parts.nth(index)).toContainText(name);
      await expect(parts.nth(index)).toContainText(meaning);
      await expect(parts.nth(index).locator('svg[data-icon]')).toHaveCount(1);
      expect((await parts.nth(index).boundingBox())!.height).toBeGreaterThanOrEqual(56);
    }
    await expect(parts.first()).toHaveAttribute('aria-selected', 'true');
    expect(await parts.first().evaluate((el) => getComputedStyle(el).backgroundColor), 'the chosen part is on the primary wash (Prompt 38; it was deep green)').toBe('rgb(235, 243, 238)');
    await shoot(page, 'content-activities');
    await parts.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(parts.nth(1)).toBeFocused();
    await expect(parts.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText(/Content\s*›\s*Brand/);
    await page.keyboard.press('Home');
    await expect(parts.first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(parts.nth(1)).toBeFocused();
    await shoot(page, 'content-brand');
  }
});

// ---- Guests and QR: three steps ------------------------------------------------------------------------------

test('Guests and QR: three steps, the current one marked; Make codes and Print or share are disabled with a reason until they can work', async ({ page }) => {
  await page.setViewportSize(SIZES[0]);
  await open(page, await site({ guests: false }), 'guests');
  const steps = page.getByRole('list', { name: 'Steps' }).getByRole('listitem').filter({ has: page.locator('.step__title') });
  await expect(steps.locator('.step__title')).toHaveText([/Add guests/, /Make codes/, /Print or share/]);
  await expect(steps.nth(0)).toHaveAttribute('aria-current', 'step');
  const make = page.getByRole('button', { name: /^Make (\d+ )?QR codes?$/ });
  await expect(make).toBeDisabled();
  await expect(make).toHaveAccessibleDescription('Add at least one guest first.');
  const print = page.getByRole('button', { name: /^Print QR sheet/ });
  await expect(print).toBeDisabled();
  await expect(print).toHaveAccessibleDescription(/^Make codes first/);

  await open(page, await site(), 'guests');
  await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step');
  await expect(steps.nth(0)).toHaveAttribute('data-done', 'true');
  await expect(steps.nth(0).locator('svg[data-icon="check"]')).toHaveCount(1);
  await expect(steps.nth(0).locator('.step__summary')).toHaveText('2 guests added.');
  await expect(make).toHaveText('Make 1 QR code');
  await expect(make).toBeEnabled();
  await expect(print).toBeEnabled();
  for (const size of SIZES) {
    await page.setViewportSize(size);
    const boxes = await steps.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().toJSON()));
    expect(boxes[1].x, 'left to right from 1,100 px').toBeGreaterThan(boxes[0].x);
    expect(Math.abs(boxes[1].height - boxes[0].height), 'one row, one height').toBeLessThanOrEqual(1);
    await shoot(page, 'guests');
  }
  await make.click();
  await expect(steps.nth(2)).toHaveAttribute('aria-current', 'step');
});

// ---- Alignment ------------------------------------------------------------------------------------------

test('alignment: no sideways scroll, footers right-aligned with the main action last, form labels on one left edge', async ({ page }) => {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    for (const each of TABS) {
      await open(page, await site(), each.hash);
      await settled(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${each.hash}: no sideways scroll`).toBe(true);
    }
    await open(page, await site(), 'clients');
    await page.locator('#sessions-c-kroger').click();
    await page.getByRole('button', { name: 'Add session' }).click();
    // (Prompt 38: a new session's actions are the sticky bar's; the bar's right edge, inside its padding, is the footer's.)
    const foot = page.getByTestId('sticky-bar');
    const [footBox, lastBox] = [await foot.boundingBox(), await foot.locator('button').last().boundingBox()];
    const inset = await foot.evaluate((el) => parseFloat(getComputedStyle(el).paddingRight));
    expect(footBox!.x + footBox!.width - inset - (lastBox!.x + lastBox!.width), 'the footer is right-aligned').toBeLessThanOrEqual(2);
    await expect(foot.locator('button').last()).toHaveClass(/btn--primary/);
    // Gaps between the sections of a client are multiples of 8 px.
    const gaps = await page.locator('.workspace__parts > *').evaluateAll((parts) => parts.slice(1).map((part, index) => Math.round(part.getBoundingClientRect().top - parts[index].getBoundingClientRect().bottom)));
    for (const gap of gaps) expect(gap % 8, `a gap of ${gap} px`).toBe(0);
  }
});

export { PEOPLE };

// ---- Pictures for the report ---------------------------------------------------------------------------------

test('pictures: People with History folded and open, Results with People folded and open', async ({ page }) => {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    const built = await site();
    await open(page, built, 'users');
    await page.getByRole('button', { name: 'Open Mathur, Pulkit' }).click();
    await expect(page.getByTestId('person-history').getByRole('button')).toHaveAccessibleName(/entries/);
    await shoot(page, 'people-history-folded');
    await page.getByTestId('person-history').getByRole('button').click();
    await shoot(page, 'people-history-open');
    await open(page, built, 'results');
    const card = page.locator(`article[data-session="${built.sessionId}"]`);
    await expect(card.getByRole('button', { name: /^People/ })).toBeVisible();
    await shoot(page, 'results-details-folded');
    await card.getByRole('button', { name: /^People/ }).click();
    await shoot(page, 'results-details-open');
  }
});
