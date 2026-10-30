import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';

// Prompt 21, Phase 3: a client's page (boards 5 and 6) and Today's new flow in the BUILT admin page, signed in as a person of the new lists (no PIN),
// against the mocked SharePoint REST. An Admin plans two sessions on one day (the second needs a title) and picks the team (whole client, or selected
// sessions; Remove with its confirmation); the Admin cannot start a session; a Producer picks one of the day's sessions on Today and starts it, is told
// plainly that one session is live at a time, and with nothing planned is told to ask an Admin. Axe on each screen. Nothing reaches a real tenant.

const DAY = '2026-11-04';
const mail = (name: string) => `${name}@deloitte.com`;
const me = (name: string, title: string) => ({ Id: 7, Title: title, Email: mail(name), LoginName: `i:0#.f|membership|${mail(name)}`, IsSiteAdmin: false });

/** A site with the sample clients, some of the brief's people, and `who` as the signed-in account. */
async function site(who: ReturnType<typeof me>) {
  const fake = newFake({ user: who });
  await onSite(fake, (ds) => seedPack(ds, samplePack()));
  const person = (name: string, full: string) => fake.add('users', { Title: mail(name), AppId: mail(name), FullName: full, Email: mail(name), Status: 'Active', Source: 'Typed' });
  const role = (name: string, kind: string, scope: string, place: Record<string, string> = {}) => fake.add('roleassignments', {
    Title: `${name}|${kind}`, AppId: `${mail(name)}|${kind}|${scope}|${place.ClientId ?? ''}`, UserKey: mail(name), Role: kind, ScopeType: scope, ClientId: '', SessionId: '', Extras: '', ...place,
  });
  person('vsatyadev', 'Satyadev, Vedala Venkata'); role('vsatyadev', 'Super admin', 'global');
  person('pulmathur', 'Mathur, Pulkit'); role('pulmathur', 'Admin', 'global');
  person('raedla', 'Aedla, Rajeshwar'); role('raedla', 'Producer', 'client', { ClientId: 'c-kroger' });
  person('mohammadahussain', 'Hussain, Mohammad Afrid');
  return fake;
}
/** A session planned ahead, as the client's page writes it. */
const planned = (fake: Fake, id: string, startTime: string, title: string, sequence: number) => fake.add('sessions', {
  Title: title, AppId: id, ClientId: 'c-kroger', SessionDate: `${DAY}T00:00:00Z`, SectionIds: '[]', Status: 'not-started', ParticipationMode: 'staff',
  ActivityFlow: 'sequential', ConfidenceCheck: false, StartTime: startTime, Sequence: sequence, Period: 'FY27-Q2', PlannedDate: '2026-10-29T09:00:00Z',
});

async function open(page: Page, fake: Fake) {
  const served = await serveSharePoint(page, fake);
  await page.goto(pageUrl('admin.html'));
  return served;
}
const axe = async (page: Page, label: string) => {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations.map((each) => `${each.id}: ${each.nodes.map((node) => node.target.join(' ')).join(', ')}`), label).toEqual([]);
};
const openKroger = async (page: Page) => {
  await page.getByRole('tab', { name: 'Clients' }).click();
  await page.getByRole('button', { name: 'Sessions and team: Kroger' }).click();
  await expect(page.getByRole('heading', { name: 'Kroger', level: 2 })).toBeFocused();
};

test.describe('a client\'s page: sessions and team', () => {
  test('an Admin plans two sessions on one day (the second needs a title), each its own row with 1 of 2 today, and axe finds nothing', async ({ page }) => {
    const fake = await site(me('pulmathur', 'Mathur, Pulkit'));
    const served = await open(page, fake);
    await openKroger(page);
    await expect(page.getByTestId('one-live-limit')).toContainText('One session can be live at a time');
    await axe(page, 'a client\'s page');
    await page.getByRole('button', { name: 'New session' }).click();
    await page.getByLabel('Date').fill(DAY);
    await page.getByLabel('Start time').fill('09:00');
    await page.getByLabel('Title').fill('Morning');
    await axe(page, 'New session');
    await page.getByRole('button', { name: 'Plan session' }).click();
    await expect(page.getByTestId('client-sessions').locator('tbody tr')).toHaveCount(1);
    await page.getByRole('button', { name: 'New session' }).click();
    await page.getByLabel('Date').fill(DAY);
    await page.getByLabel('Start time').fill('14:00');
    await page.getByRole('button', { name: 'Plan session' }).click();
    await expect(page.getByRole('alert')).toHaveText('Give this session a title: the client has another session that day.');
    await page.getByLabel('Title').fill('Afternoon');
    await page.getByRole('button', { name: 'Plan session' }).click();
    const rows = page.getByTestId('client-sessions').locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('4 Nov 2026, 09:00');
    await expect(rows.nth(0)).toContainText('1 of 2 today');
    await expect(rows.nth(1)).toContainText('2 of 2 today');
    await expect(rows.nth(1)).toContainText('Afternoon');
    await expect(rows.nth(1)).toContainText('FY27-Q2');
    await expect(rows.nth(1)).toContainText('Planned');
    expect(fake.lists.get('sessions')!.filter((row) => row.ClientId === 'c-kroger' && String(row.AppId).startsWith(`kroger-${DAY}-`)).map((row) => row.AppId).sort())
      .toEqual([`kroger-${DAY}-0900`, `kroger-${DAY}-1400`]);
    // A session with a team of its own: once planned, the team form opens on it and the Client team heading takes the focus.
    await page.getByRole('button', { name: 'New session' }).click();
    await page.getByLabel('Date').fill('2026-11-05');
    await page.getByLabel('Start time').fill('10:30');
    await page.getByLabel('Use the client team').uncheck();
    await page.getByRole('button', { name: 'Plan session' }).click();
    await expect(page.getByRole('heading', { name: 'Client team' })).toBeFocused();
    await expect(page.getByLabel('Selected sessions')).toBeChecked();
    await expect(page.getByLabel('5 Nov 2026, 10:30')).toBeChecked();
    expect(served.unexpected).toEqual([]);
  });

  test('the team: a person registered in People for selected sessions, a Designer\'s extra, Remove with what they lose; axe on the form and the confirmation', async ({ page }) => {
    const fake = await site(me('pulmathur', 'Mathur, Pulkit'));
    planned(fake, `kroger-${DAY}-0900`, '09:00', 'Morning', 1);
    planned(fake, `kroger-${DAY}-1400`, '14:00', 'Afternoon', 2);
    await open(page, fake);
    await openKroger(page);
    await expect(page.getByTestId('client-team')).toContainText('Aedla, Rajeshwar');
    await page.getByRole('button', { name: 'Add to team' }).click();
    await page.getByLabel('Role').selectOption('Designer');
    await page.getByLabel('Search people').fill('huss');
    await page.getByLabel('Person').selectOption({ label: 'Hussain, Mohammad Afrid (mohammadahussain@deloitte.com)' });
    await page.getByLabel('Selected sessions').check();
    await page.getByLabel('4 Nov 2026, 14:00, Afternoon').check();
    await page.getByLabel('May also edit activities').check();
    await axe(page, 'Add to team');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId('client-team')).toContainText('Hussain, Mohammad Afrid');
    await expect(page.getByTestId('client-team')).toContainText('may also edit activities');
    expect(fake.lists.get('roleassignments')!.some((row) => row.AppId === `${mail('mohammadahussain')}|Designer|session|kroger-${DAY}-1400` && row.Extras === 'content.edit')).toBe(true);
    await page.getByRole('button', { name: /^Remove Hussain, Mohammad Afrid/ }).click();
    await expect(page.getByRole('dialog')).toContainText('will no longer be a Designer');
    await axe(page, 'Remove from the team');
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByTestId('client-team')).not.toContainText('Hussain, Mohammad Afrid');
  });
});

test.describe('Today: the Admin plans, the Producer starts', () => {
  // (Prompt 21, Phase 4: the menu is the role matrix's, and an Admin has no Events module, so Today is not theirs: they plan on the client's page.
  // In Phase 3 this test opened Today as an Admin and found Go live off with the words "Only a Producer or a Super admin starts a session"; those words
  // stay in Today for any role that reaches it without the right to start.)
  test('an Admin cannot start a session: Today is not in their menu, and no Go live is on the client\'s page', async ({ page }) => {
    const fake = await site(me('pulmathur', 'Mathur, Pulkit'));
    planned(fake, `kroger-${DAY}-0900`, '09:00', 'Morning', 1);
    await open(page, fake);
    await expect(page.getByRole('tab', { name: 'Today' })).toHaveCount(0);
    await openKroger(page);
    await expect(page.getByTestId('client-sessions')).toContainText('Morning');
    await expect(page.getByRole('button', { name: 'Go live' })).toHaveCount(0);
  });

  test('a Producer picks one of the day\'s two sessions and starts it; the next is told plainly that one session is live at a time; with nothing planned, ask an Admin', async ({ page }) => {
    const fake = await site(me('raedla', 'Aedla, Rajeshwar'));
    planned(fake, `kroger-${DAY}-0900`, '09:00', 'Morning', 1);
    planned(fake, `kroger-${DAY}-1400`, '14:00', 'Afternoon', 2);
    const served = await open(page, fake);
    await page.getByRole('tab', { name: 'Today' }).click();
    await page.getByLabel('Client').selectOption({ label: 'Kroger' });
    await page.getByLabel('Date').fill(DAY);
    await page.getByLabel('Date').dispatchEvent('change');
    const session = page.getByLabel('Session', { exact: true });
    await expect(session.locator('option')).toHaveText(['09:00, Morning, 1 of 2 today, Planned', '14:00, Afternoon, 2 of 2 today, Planned']);
    await axe(page, 'Today with the day\'s sessions');
    const ready = page.getByText(/^Ready to go live/); // (readiness is checked again after each pick: Go live waits for it)
    await expect(ready).toBeVisible();
    await page.getByRole('button', { name: 'Go live' }).click();
    await expect(page.getByText('Verified: participants now see Kroger')).toBeVisible();
    expect(fake.item('appsettings', 'default').ActiveSessionId).toBe(`kroger-${DAY}-0900`);
    await session.selectOption(`kroger-${DAY}-1400`);
    await expect(page.getByTestId('one-live')).toHaveText('One session can be live at a time. Going live with this one takes the place of Kroger, 4 Nov 2026, 09:00, Morning for participants; that session is not ended.');
    await expect(ready).toBeVisible();
    await page.getByRole('button', { name: 'Go live' }).click();
    await expect(page.getByText('Verified: participants now see Kroger')).toBeVisible();
    expect(fake.item('appsettings', 'default').ActiveSessionId).toBe(`kroger-${DAY}-1400`);
    await page.getByLabel('Date').fill('2026-11-05');
    await page.getByLabel('Date').dispatchEvent('change');
    await expect(page.getByText('No session is planned for Kroger on 2026-11-05.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Go live' })).toBeDisabled();
    expect(served.unexpected).toEqual([]);
  });
});
