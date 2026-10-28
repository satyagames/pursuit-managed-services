import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';

// Prompt 21, Phase 2: the People screens (boards 3 and 4) in the BUILT admin page, signed in as a person of the new lists (no PIN), against the mocked
// SharePoint REST. The list and its filters, Add user with the people picker by keyboard alone, Give access, Remove with its confirmation, the picker
// refused ("unverified"), who sees the tab, and axe on each screen. Nothing reaches a real tenant: what the real site answers to the people picker
// is QA-TESTING.md's.

const mail = (name: string) => `${name}@deloitte.com`;
const me = (name: string, title: string) => ({ Id: 7, Title: title, Email: mail(name), LoginName: `i:0#.f|membership|${mail(name)}`, IsSiteAdmin: false });
const DIRECTORY = [
  { name: 'Aedla, Rajeshwar', email: mail('raedla'), jobTitle: 'Consultant' },
  { name: 'Hussain, Mohammad Afrid', email: mail('mohammadahussain') },
  { name: 'Milder, Brian', email: mail('bmilder') },
];

/** A site with the sample clients, the people of the brief, and `who` as the signed-in account. */
async function site(who: ReturnType<typeof me>, options: Parameters<typeof newFake>[0] = {}) {
  const fake = newFake({ user: who, directory: DIRECTORY, ...options });
  await onSite(fake, (ds) => seedPack(ds, samplePack()));
  const person = (name: string, full: string, status = 'Active') => fake.add('users', { Title: mail(name), AppId: mail(name), FullName: full, Email: mail(name), Status: status, Source: 'Typed' });
  const role = (name: string, kind: string, scope: string, place: Record<string, string> = {}, extras = '') => fake.add('roleassignments', {
    Title: `${name}|${kind}`, AppId: `${mail(name)}|${kind}|${scope}|${place.ClientId ?? ''}`, UserKey: mail(name), Role: kind, ScopeType: scope, ClientId: '', SessionId: '', Extras: extras, ...place,
  });
  person('vsatyadev', 'Satyadev, Vedala Venkata'); role('vsatyadev', 'Super admin', 'global');
  person('pmedichalam', 'Medichalam, Pramod Narayan'); role('pmedichalam', 'Super admin', 'global');
  person('pulmathur', 'Mathur, Pulkit'); role('pulmathur', 'Admin', 'global');
  person('raedla', 'Aedla, Rajeshwar'); role('raedla', 'Producer', 'client', { ClientId: 'c-kroger' });
  person('mohammadahussain', 'Hussain, Mohammad Afrid'); role('mohammadahussain', 'Designer', 'client', { ClientId: 'c-kroger' });
  person('gone', 'Gone, Leaver', 'Disabled');
  return fake;
}

async function open(page: Page, fake: Fake) {
  const served = await serveSharePoint(page, fake);
  await page.goto(pageUrl('admin.html'));
  return served;
}

const axe = async (page: Page, label: string) => {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations.map((each) => `${each.id}: ${each.nodes.map((node) => node.target.join(' ')).join(', ')}`), label).toEqual([]);
};

test.describe('the People screens', () => {
  test('a Super admin signs in with no PIN, sees People, filters it by role chip, search and client, and axe finds nothing', async ({ page }) => {
    const fake = await site(me('vsatyadev', 'Satyadev, Vedala Venkata'));
    const served = await open(page, fake);
    await expect(page.getByRole('tab', { name: 'People' })).toBeVisible();
    await page.getByRole('tab', { name: 'People' }).click();
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
    await expect(page.getByTestId('user-row')).toHaveCount(6);
    await axe(page, 'People, the list');
    await page.getByRole('button', { name: 'Producers' }).click();
    await expect(page.getByTestId('user-row')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Producers' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByLabel('Search people').fill('MILDER');
    await expect(page.getByTestId('users-count')).toContainText('No one matches');
    await page.getByLabel('Search people').fill('mathur');
    await expect(page.getByTestId('user-row')).toHaveCount(1);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Kroger' });
    await expect(page.getByTestId('user-row')).toHaveCount(5); // (the two Super admins and the Admin reach every client, with the Producer and the Designer)
    await expect(page.getByLabel('Session', { exact: true })).toBeEnabled();
    expect(served.unexpected).toEqual([]);
  });

  test('Add user, by keyboard alone: search as you type, Down and Enter, Add user, then Give access; the guards refuse the rest', async ({ page }) => {
    const fake = await site(me('vsatyadev', 'Satyadev, Vedala Venkata'));
    await open(page, fake);
    await page.getByRole('tab', { name: 'People' }).click();
    await page.getByRole('button', { name: 'Add user' }).focus();
    await page.keyboard.press('Enter');
    const field = page.getByRole('combobox', { name: 'Name or email' });
    await field.focus();
    await field.pressSequentially('a');
    await expect(page.getByRole('status').filter({ hasText: 'Type at least 2 letters' })).toBeVisible();
    await field.pressSequentially('e');
    await expect(page.getByRole('listbox', { name: 'People found' }).getByRole('option')).toHaveCount(1);
    await expect(page.getByRole('status').filter({ hasText: '1 person found' })).toBeVisible();
    await axe(page, 'Add user, with a suggestion');
    await page.keyboard.press('ArrowDown');
    await expect(field).toHaveAttribute('aria-activedescendant', 'user-picker-option-0');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('user-chosen')).toContainText('Aedla, Rajeshwar');
    // (Aedla is there already: adding says so and opens them.)
    await page.getByRole('button', { name: 'Add user', exact: true }).last().click();
    await expect(page.getByRole('heading', { name: 'Aedla, Rajeshwar' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to people' }).click();
    await page.getByRole('button', { name: 'Add user' }).click();
    await page.getByRole('combobox', { name: 'Name or email' }).pressSequentially('bmilder');
    await expect(page.getByRole('listbox', { name: 'People found' }).getByRole('option')).toHaveCount(1);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Add user', exact: true }).last().click();
    await expect(page.getByRole('heading', { name: 'Milder, Brian' })).toBeVisible();
    await expect(page.getByTestId('no-access-rows')).toContainText('no access to any client or session yet');
    expect(fake.item('users', mail('bmilder'))).toBeTruthy();
    await page.getByRole('button', { name: 'Give access' }).click();
    const give = page.getByRole('dialog');
    await give.getByRole('combobox', { name: /^Role/ }).selectOption('Leadership');
    await give.getByRole('combobox', { name: /^Client/ }).selectOption({ label: 'Kroger' });
    await axe(page, 'Give access');
    await give.getByRole('button', { name: 'Give access' }).click();
    await expect(page.getByTestId('access-row')).toHaveCount(1);
    await expect(page.getByTestId('access-row')).toContainText('Leadership');
    await expect(page.getByTestId('history')).toContainText('Added from the directory');
  });

  test('Remove says what they lose, and a Super admin cannot remove their own roles or the last Super admin', async ({ page }) => {
    const fake = await site(me('vsatyadev', 'Satyadev, Vedala Venkata'));
    await open(page, fake);
    await page.getByRole('tab', { name: 'People' }).click();
    await page.getByRole('button', { name: 'Open Aedla, Rajeshwar' }).click();
    await page.getByRole('button', { name: /^Remove Producer/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('will no longer be a Producer for Kroger');
    await axe(page, 'Remove, the confirmation');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('access-row')).toHaveCount(1);
    await page.getByRole('button', { name: /^Remove Producer/ }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).last().click();
    await expect(page.getByTestId('no-access-rows')).toBeVisible();
    expect(fake.item('roleassignments', `${mail('raedla')}|Producer|client|c-kroger`)).toBeUndefined();
    await page.getByRole('button', { name: 'Back to people' }).click();
    await page.getByRole('button', { name: 'Open Satyadev, Vedala Venkata' }).click();
    await expect(page.getByTestId('own-note')).toBeVisible();
    await expect(page.getByRole('button', { name: /Remove Super admin/ })).toHaveCount(0);
  });

  test('a site that refuses the people picker says unverified, and a typed email is taken', async ({ page }) => {
    const fake = await site(me('vsatyadev', 'Satyadev, Vedala Venkata'), { pickerStatus: 403 });
    await open(page, fake);
    await page.getByRole('tab', { name: 'People' }).click();
    await page.getByRole('button', { name: 'Add user' }).click();
    const field = page.getByRole('combobox', { name: 'Name or email' });
    await field.pressSequentially('new.person@deloitte.com');
    await expect(page.getByRole('status').filter({ hasText: 'unverified' })).toBeVisible();
    await axe(page, 'Add user, unverified');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('user-chosen')).toContainText('Typed in by hand');
    await page.getByRole('button', { name: 'Add user', exact: true }).last().click();
    await expect(page.getByRole('heading', { name: 'new.person@deloitte.com' })).toBeVisible();
    expect(fake.item('users', mail('new.person')).Source).toBe('Typed');
  });

  test('an Admin sees People and may give a team role, but has no Add user (without the extra) and no global roles; a Producer has no People tab', async ({ page }) => {
    const admin = await site(me('pulmathur', 'Mathur, Pulkit'));
    await open(page, admin);
    await page.getByRole('tab', { name: 'People' }).click();
    await expect(page.getByRole('button', { name: 'Add user' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open Aedla, Rajeshwar' }).click();
    await expect(page.getByRole('button', { name: 'Give access' })).toBeVisible();
    await expect(page.getByText('Only a Super admin can give or remove these.')).toBeVisible();
    await page.getByRole('button', { name: 'Back to people' }).click();
    await page.getByRole('button', { name: 'Open Satyadev, Vedala Venkata' }).click();
    await expect(page.getByRole('button', { name: /Remove Super admin/ })).toHaveCount(0);
    await page.goto('about:blank');
    const producer = await site(me('raedla', 'Aedla, Rajeshwar'));
    await open(page, producer);
    await expect(page.getByRole('tab', { name: 'People' })).toHaveCount(0);
  });
});
