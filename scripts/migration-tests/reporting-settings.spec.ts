import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';

// Prompt 22, Part 2: the settings the Leadership dashboard reads, set on screens, in the BUILT admin page against the mocked SharePoint REST. A Super admin
// opens Reporting settings from the dashboard (keyboard only), is refused a minimum of 0 in plain words, saves 3 (the Low sample tag goes), changes the
// fiscal start month and reads what moves at once and what keeps the old quarters, then moves the stored quarters on a second yes; each change is one
// audit line. A Producer sees the dashboard but no Reporting settings. An Admin gives Kroger an Industry and a Region on its page (suggested from the
// values in use) and sees them as labels on the page and in the Clients list. Axe on each screen.

const mail = (name: string) => `${name}@deloitte.com`;
const me = (name: string, title: string) => ({ Id: 7, Title: title, Email: mail(name), LoginName: `i:0#.f|membership|${mail(name)}`, IsSiteAdmin: false });

/** A summary item of FY27-Q2: `afters` Afters at `mean`, everyone paired, moving one point. */
const summary = (id: string, clientId: string, date: string, afters: number, mean: number) => ({
  Title: id, AppId: id, ClientId: clientId, Period: 'FY27-Q2', SessionDate: `${date}T00:00:00Z`, Guests: afters, Answers: afters * 3, Completed: afters, BeforeCount: afters,
  AfterCount: afters, PairedCount: afters, MeanBefore: mean - 1, MeanAfter: mean,
  SummaryJson: JSON.stringify({ v: 1, title: 'Morning workshop', startTime: '09:30', facilitator: 'Aedla, Rajeshwar', scaleMax: 5, pairedBefore: mean - 1, pairedAfter: mean,
    moved: { started: 4, moved: 2 }, distribution: null, firstChoices: [], kinds: {}, groups: {}, feedback: { count: 0, themes: [], quotes: [] } }),
});

async function site(who: ReturnType<typeof me>, role: string, scope = 'global', place: Record<string, string> = {}) {
  const fake = newFake({ user: who });
  await onSite(fake, (ds) => seedPack(ds, samplePack()));
  fake.add('users', { Title: who.Email, AppId: who.Email, FullName: who.Title, Email: who.Email, Status: 'Active', Source: 'Typed' });
  fake.add('roleassignments', { Title: `${who.Email}|${role}`, AppId: `${who.Email}|${role}|${scope}|${place.ClientId ?? ''}`, UserKey: who.Email, Role: role, ScopeType: scope, ClientId: '', SessionId: '', Extras: '', ...place });
  // Kroger's 4 Afters are under the minimum of 10 (Low sample) and over 3. 2 Sep 2026 is FY27-Q2 in a June year and FY27-Q1 in a July year.
  fake.add('sessionsummary', summary('kroger-2026-09-02-0930', 'c-kroger', '2026-09-02', 4, 3.3));
  fake.add('sessionsummary', summary('dominos-2026-10-20-0930', 'c-dominos', '2026-10-20', 12, 2.7));
  fake.add('sessions', { Title: 'Morning workshop', AppId: 'kroger-2026-09-02-0930', ClientId: 'c-kroger', SessionDate: '2026-09-02T00:00:00Z', SectionIds: '[]', Status: 'completed',
    ParticipationMode: 'staff', ActivityFlow: 'sequential', ConfidenceCheck: true, StartTime: '09:30', Sequence: 1, Period: 'FY27-Q2', PlannedDate: '2026-08-20T09:00:00Z' });
  return fake;
}
async function open(page: Page, fake: Fake) {
  await page.clock.setFixedTime(new Date('2026-10-29T12:00:00Z'));
  const served = await serveSharePoint(page, fake);
  await page.goto(pageUrl('admin.html'));
  return served;
}
const axe = async (page: Page, label: string) => {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations.map((each) => `${each.id}: ${each.nodes.map((node) => node.target.join(' ')).join(', ')}`), label).toEqual([]);
};
const toDashboard = async (page: Page) => {
  await page.getByRole('tab', { name: 'Results' }).click();
  const dashboard = page.getByRole('button', { name: 'Dashboard', exact: true });
  if (await dashboard.isVisible()) await dashboard.click();
  await expect(page.getByRole('heading', { name: 'Leadership dashboard', level: 2 })).toBeVisible();
};
const auditOf = (fake: Fake, action: string) => (fake.lists.get('auditlog') ?? []).filter((line) => line.Action === action).map((line) => String(line.Detail));

test('a Super admin sets the minimum sample and the fiscal start month by keyboard; a value out of range is refused; each change is audited', async ({ page }) => {
  const fake = await site(me('vsatyadev', 'Satyadev, Vedala Venkata'), 'Super admin');
  await open(page, fake);
  await toDashboard(page);
  const kroger = page.getByRole('region', { name: 'Confidence index and shift by client' }).locator('.dash__bar-row', { hasText: 'Kroger' });
  await expect(kroger).toContainText('(low sample)');

  await page.getByRole('button', { name: 'Reporting settings' }).focus();
  await page.keyboard.press('Enter');
  const heading = page.getByRole('heading', { name: 'Reporting settings', level: 2 });
  await expect(heading).toBeFocused();
  await axe(page, 'Reporting settings');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Back to the dashboard' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Fiscal year starts in')).toBeFocused();
  await expect(page.getByLabel('Fiscal year starts in')).toHaveValue('6');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Minimum sample')).toBeFocused();
  await page.keyboard.type('0');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('The minimum sample is a whole number, 1 or more.');
  expect(auditOf(fake, 'settings'), 'nothing written').toEqual([]);
  await page.getByLabel('Minimum sample').fill('3');
  await page.getByRole('button', { name: 'Save settings' }).press('Enter');
  await expect(page.getByText('Reporting settings saved')).toBeVisible();
  expect(fake.lists.get('appsettings')!.find((item) => item.AppId === 'default')!.MinSample).toBe(3);
  expect(auditOf(fake, 'settings')).toEqual(['Minimum sample: 10 (not set) to 3']);
  await page.getByRole('button', { name: 'Back to the dashboard' }).click();
  await expect(page.getByRole('button', { name: 'Reporting settings' })).toBeFocused();
  await expect(kroger).toBeVisible();
  await expect(kroger, 'the Low sample tag is gone at a minimum of 3').not.toContainText('low sample', { ignoreCase: true });
  await page.getByRole('button', { name: 'Reporting settings' }).click();
  await expect(heading).toBeFocused();

  // The start month: the question says what follows at once and what keeps the old quarters; the stored quarters move only on a second yes.
  const asked: string[] = [];
  page.on('dialog', (dialog) => { asked.push(dialog.message()); void dialog.accept(); });
  await page.getByLabel('Fiscal year starts in').selectOption({ label: 'July' });
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('button', { name: 'Move stored quarters' })).toBeVisible();
  expect(asked[0]).toMatch(/^Start the fiscal year in July instead of June\? At once, the dashboard's year and quarter choices/);
  expect(asked[0]).toContain('1 session and 1 summary keep the quarter they were given under June');
  await axe(page, 'the stored quarters waiting');
  await page.getByRole('button', { name: 'Move stored quarters' }).click();
  await expect(page.getByText('2 stored quarters moved')).toBeVisible();
  expect(asked[1]).toBe('Move the stored quarters of 1 session and 1 summary to a year that starts in July? It writes 2 items, reads no answers and changes nothing else.');
  expect(fake.lists.get('sessions')!.find((item) => item.AppId === 'kroger-2026-09-02-0930')!.Period).toBe('FY27-Q1');
  expect(fake.lists.get('sessionsummary')!.find((item) => item.AppId === 'kroger-2026-09-02-0930')!.Period).toBe('FY27-Q1');
  expect(auditOf(fake, 'settings').slice(1)).toEqual(['Fiscal year starts in: June (not set) to July', 'Stored quarters moved to a year that starts in July: 1 session, 1 summary']);
});

test('a Producer sees the dashboard but not Reporting settings; an Admin has no Results at all', async ({ page }) => {
  await open(page, await site(me('raedla', 'Aedla, Rajeshwar'), 'Producer', 'client', { ClientId: 'c-kroger' }));
  await toDashboard(page);
  await expect(page.getByRole('button', { name: 'Reporting settings' })).toHaveCount(0);
  await page.goto('about:blank');
  await open(page, await site(me('pulmathur', 'Mathur, Pulkit'), 'Admin'));
  await expect(page.getByRole('tab', { name: 'Clients' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Results' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reporting settings' })).toHaveCount(0);
});

test('an Admin gives Kroger an Industry and a Region on its page, suggested from the values in use; they show as labels there and in Clients', async ({ page }) => {
  const fake = await site(me('pulmathur', 'Mathur, Pulkit'), 'Admin');
  const dominos = fake.lists.get('clients')!.find((item) => item.AppId === 'c-dominos')!;
  Object.assign(dominos, { Industry: 'Food service', Region: 'North America' });
  await open(page, fake);
  await page.getByRole('tab', { name: 'Clients' }).click();
  await expect(page.locator('.client-row', { hasText: 'Domino' }).getByTestId('client-tag-industry')).toHaveText('Industry: Food service');
  await page.getByRole('button', { name: 'Sessions and team: Kroger' }).click();
  await expect(page.getByRole('heading', { name: 'Kroger', level: 2 })).toBeFocused();
  const about = page.getByRole('region', { name: 'About this client' });
  await expect(about.locator('#about-region-choices option')).toHaveCount(1);
  await expect(about.locator('#about-region-choices option')).toHaveAttribute('value', 'North America');
  await about.getByLabel('Industry').fill('  Retail  ');
  await about.getByLabel('Region').fill('North America');
  await about.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Kroger: details saved')).toBeVisible();
  await expect(page.getByTestId('client-tag-industry').first()).toHaveText('Industry: Retail');
  const item = fake.lists.get('clients')!.find((entry) => entry.AppId === 'c-kroger')!;
  expect([item.Industry, item.Region]).toEqual(['Retail', 'North America']);
  expect(auditOf(fake, 'client')).toEqual(['Industry: none to Retail; Region: none to North America']);
  await axe(page, 'About this client');
  await page.getByRole('button', { name: 'Back to clients' }).click();
  await expect(page.locator('.client-row', { hasText: 'Kroger' }).getByTestId('client-tag-region')).toHaveText('Region: North America');
});
