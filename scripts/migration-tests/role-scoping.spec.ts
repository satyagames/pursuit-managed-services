import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';

// Prompt 21, Phase 4: every module shows only what the role and its assignments allow (boards 7, 8 and 10), in the BUILT admin page, signed in as a person
// of the new lists, against the mocked SharePoint REST. The menu is the role matrix's; Content's views a role may look at but not change are shown with
// "View only" and switched off; the pickers and the reads hold only the places given (another client's data is never asked for); Results offers a button
// only for an action the role has. Axe on the view-only screens. Nothing reaches a real tenant.

const mail = (name: string) => `${name}@deloitte.com`;
const me = (name: string, title: string) => ({ Id: 7, Title: title, Email: mail(name), LoginName: `i:0#.f|membership|${mail(name)}`, IsSiteAdmin: false });
type Place = Record<string, string>;

/** A site with the sample clients (Kroger and Domino's), a session of each, and `who` as the signed-in account holding `kind` for `scope`. */
async function site(who: ReturnType<typeof me>, kind: string, scope: string, place: Place = {}, extras = '') {
  const fake = newFake({ user: who });
  await onSite(fake, (ds) => seedPack(ds, samplePack()));
  const name = who.Email.split('@')[0];
  fake.add('users', { Title: who.Email, AppId: who.Email, FullName: who.Title, Email: who.Email, Status: 'Active', Source: 'Typed' });
  fake.add('roleassignments', {
    Title: `${name}|${kind}`, AppId: `${who.Email}|${kind}|${scope}|${place.ClientId ?? place.SessionId ?? ''}`, UserKey: who.Email, Role: kind, ScopeType: scope,
    ClientId: '', SessionId: '', Extras: extras, ...place,
  });
  for (const [id, client] of [['kroger-2026-11-04-0900', 'c-kroger'], ['dominos-2026-11-04-0900', 'c-dominos']]) {
    fake.add('sessions', {
      Title: id.startsWith('kroger') ? 'Morning workshop' : 'Kick-off', AppId: id, ClientId: client, SessionDate: '2026-11-04T00:00:00Z', SectionIds: '[]', Status: 'not-started',
      ParticipationMode: 'staff', ActivityFlow: 'sequential', ConfidenceCheck: false, StartTime: '09:00', Sequence: 1, Period: 'FY27-Q2', PlannedDate: '2026-10-29T09:00:00Z',
    });
  }
  return fake;
}
async function open(page: Page, fake: Fake) {
  const served = await serveSharePoint(page, fake);
  await page.goto(pageUrl('admin.html'));
  return served;
}
const tabs = async (page: Page) => {
  await expect(page.getByRole('tablist').first().getByRole('tab').first()).toBeVisible();
  return (await page.getByRole('tablist').first().getByRole('tab').allTextContents()).map((text) => text.trim());
};
/** The "View only" notices on show (a view out of sight keeps its own). */
const shown = (page: Page) => page.locator('[data-testid="view-only"]:visible');
const axe = async (page: Page, label: string) => {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations.map((each) => `${each.id}: ${each.nodes.map((node) => node.target.join(' ')).join(', ')}`), label).toEqual([]);
};
/** Whether any request the page made named the client (in an address or a body): another client's data must never be asked for. */
const asked = (fake: Fake, text: string) => (fake as unknown as { requests: { url?: string; query?: string; parts?: { url?: string; query?: string }[] }[] }).requests
  .some((entry) => [entry, ...(entry.parts ?? [])].some((each) => `${each.url ?? ''} ${each.query ?? ''}`.includes(text)));

test.describe('the menu is the role matrix\'s', () => {
  test('a Producer: Today, Content, Guests and QR, Results; the first tab is Today', async ({ page }) => {
    await open(page, await site(me('raedla', 'Aedla, Rajeshwar'), 'Producer', 'client', { ClientId: 'c-kroger' }));
    expect(await tabs(page)).toEqual(['Today', 'Content', 'Guests and QR', 'Results']);
    await expect(page.getByRole('heading', { name: 'Today', level: 2 })).toBeVisible();
  });
  test('a Designer: Content only, and it opens there', async ({ page }) => {
    await open(page, await site(me('mohammadahussain', 'Hussain, Mohammad Afrid'), 'Designer', 'client', { ClientId: 'c-kroger' }));
    expect(await tabs(page)).toEqual(['Content']);
    await expect(page.getByRole('heading', { name: 'Content', level: 2 })).toBeVisible();
  });
  test('Leadership: Results only, with no Live display, no Delete session and no restart of a visit', async ({ page }) => {
    await open(page, await site(me('ablepe', 'Lepe, Annabell'), 'Leadership', 'client', { ClientId: 'c-kroger' }));
    expect(await tabs(page)).toEqual(['Results']);
    // (Prompt 21, Phase 5: Leadership opens Results on the dashboard; the sessions' cards are its Sessions view.)
    await expect(page.getByRole('heading', { name: 'Leadership dashboard', level: 2 })).toBeVisible();
    await page.getByRole('button', { name: 'Sessions', exact: true }).click();
    const cards = page.locator('article[data-session]');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute('data-session', 'kroger-2026-11-04-0900');
    await expect(page.getByRole('button', { name: 'Live display' })).toHaveCount(0);
    await expect(page.locator('[data-delete-session]')).toHaveCount(0);
  });
  test('an Admin: Clients and People; a Super admin: everything', async ({ page }) => {
    await open(page, await site(me('pulmathur', 'Mathur, Pulkit'), 'Admin', 'global'));
    expect(await tabs(page)).toEqual(['Clients', 'People']);
    const all = await page.context().newPage();
    await open(all, await site(me('vsatyadev', 'Satyadev, Vedala Venkata'), 'Super admin', 'global'));
    expect(await tabs(all)).toEqual(['Today', 'Clients', 'Content', 'Guests and QR', 'Results', 'People']);
  });
});

test.describe('Content: view only is shown, not hidden', () => {
  test('a Designer edits the brand and looks at the activities, switched off, with the notice; axe finds nothing', async ({ page }) => {
    const fake = await site(me('mohammadahussain', 'Hussain, Mohammad Afrid'), 'Designer', 'client', { ClientId: 'c-kroger' });
    await open(page, fake);
    await expect(page.getByLabel('Client')).toBeVisible();
    await expect(page.getByLabel('Client').locator('option')).toHaveCount(1);
    await expect(shown(page)).toContainText('View only');
    await expect(shown(page)).toContainText('activities');
    await expect(page.getByRole('button', { name: 'Add activity' }).first()).toBeDisabled();
    await axe(page, 'Content, activities view only');
    await page.getByRole('tab', { name: /Brand/ }).click();
    await expect(shown(page)).toHaveCount(0);
    expect(asked(fake, 'c-dominos'), 'no request named another client').toBe(false);
  });
  test('a Designer given the extra edits the activities too', async ({ page }) => {
    await open(page, await site(me('mohammadahussain', 'Hussain, Mohammad Afrid'), 'Designer', 'client', { ClientId: 'c-kroger' }, 'content.edit'));
    await expect(shown(page)).toHaveCount(0);
  });
  test('a Producer edits the activities and looks at the brand, switched off', async ({ page }) => {
    await open(page, await site(me('raedla', 'Aedla, Rajeshwar'), 'Producer', 'client', { ClientId: 'c-kroger' }));
    await page.getByRole('tab', { name: 'Content' }).click();
    await expect(shown(page)).toHaveCount(0);
    await page.getByRole('tab', { name: /Brand/ }).click();
    await expect(shown(page)).toContainText('look');
    await axe(page, 'Content, brand view only');
  });
});

test.describe('the reads hold the places given', () => {
  test('a Producer\'s Today, Guests and Results never ask for another client', async ({ page }) => {
    const fake = await site(me('raedla', 'Aedla, Rajeshwar'), 'Producer', 'client', { ClientId: 'c-kroger' });
    await open(page, fake);
    await expect(page.getByLabel('Client')).toBeVisible();
    await expect(page.getByLabel('Client').locator('option')).toHaveCount(1);
    for (const name of ['Guests and QR', 'Results']) await page.getByRole('tab', { name }).click();
    await expect(page.locator('article[data-session]')).toHaveCount(1);
    expect(asked(fake, 'c-dominos') || asked(fake, 'dominos-2026'), 'no request named the other client or its session').toBe(false);
  });
});
