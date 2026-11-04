import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';

// Prompt 28, Part 2: "Email them about this" in the BUILT admin page, against the mocked SharePoint REST. On every screen that changes access the box
// is there and unticked, and unticked again when the screen opens again (nothing remembered); ticked, the message appears after the save, never
// before, with a mailto: draft to the person's stored address; unticked, nothing appears. The box costs no request; each press of the draft or Copy
// writes one access-email line, and opening a screen writes none. Producers, Designers and Leadership never see it. What a real Outlook and Teams do
// with the draft is QA-TESTING.md's.

const mail = (name: string) => `${name}@deloitte.com`;
const me = (name: string, title: string) => ({ Id: 7, Title: title, Email: mail(name), LoginName: `i:0#.f|membership|${mail(name)}`, IsSiteAdmin: false });

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
  person('mohammadahussain', 'Hussain, Mohammad Afrid'); role('mohammadahussain', 'Designer', 'client', { ClientId: 'c-kroger' });
  person('lead', 'Lead, Leader'); role('lead', 'Leadership', 'client', { ClientId: 'c-kroger' });
  person('bmilder', 'Milder, Brian');
  return fake;
}

async function open(page: Page, fake: Fake) {
  const served = await serveSharePoint(page, fake);
  await page.goto(pageUrl('admin.html'));
  // (A draft is never followed in the test: the click still runs the page's own handler, which writes the audit line.)
  await page.evaluate(() => document.addEventListener('click', (event) => { if ((event.target as Element).closest?.('a[href^="mailto:"]')) event.preventDefault(); }));
  return served;
}

const person = async (page: Page, name: string) => {
  await page.getByRole('tab', { name: 'People' }).click();
  await page.getByLabel('Search people').fill(name.split(',')[0]);
  await page.getByRole('button', { name: `Open ${name}` }).click();
  await expect(page.getByRole('heading', { name })).toBeFocused();
};
const emailLines = (fake: Fake) => (fake.lists.get('auditlog') ?? []).filter((line: any) => line.Action === 'access-email');
const writes = (fake: Fake, from: number, to = fake.requests.length) => fake.requests.slice(from, to).filter((request: { method: string }) => request.method !== 'GET');
/** What a stretch of the log asked, as distinct "METHOD list" words (the reads that follow a change may finish later, so counts are not compared). */
const kinds = (fake: Fake, from: number, to = fake.requests.length) => [...new Set(fake.requests.slice(from, to).map((request: { method: string; list: string | null; path: string }) => `${request.method} ${request.list ?? request.path}`))].sort();
const axe = async (page: Page, label: string) => {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations.map((each) => `${each.id}: ${each.nodes.map((node) => node.target.join(' ')).join(', ')}`), label).toEqual([]);
};

test.describe('Email them about this', () => {
  test('Give access: unticked each time it opens; unticked, nothing appears; ticked, the draft appears after the save, and costs no request more', async ({ page }) => {
    const fake = await site(me('vsatyadev', 'Satyadev, Vedala Venkata'));
    const served = await open(page, fake);
    await person(page, 'Milder, Brian');
    await page.getByRole('button', { name: 'Give access' }).click();
    let dialog = page.getByRole('dialog');
    const box = dialog.getByRole('checkbox', { name: 'Email them about this' });
    await expect(box).not.toBeChecked();
    await expect(dialog.getByTestId('email-box')).toContainText('To: bmilder@deloitte.com. A copy comes to you.');
    await box.check();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Give access' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('checkbox', { name: 'Email them about this' })).not.toBeChecked(); // (nothing remembered)
    // Unticked: the change, and nothing more.
    await dialog.getByRole('combobox', { name: /^Client/ }).selectOption({ label: 'Kroger' });
    let before = fake.requests.length;
    await dialog.getByRole('button', { name: 'Give access' }).click();
    await expect(page.getByTestId('access-row')).toHaveCount(1);
    await expect(page.getByTestId('email-panel')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    const unticked = { writes: writes(fake, before).length, kinds: kinds(fake, before) };
    // Ticked: the same requests, and the message only once the change has saved.
    await page.getByRole('button', { name: 'Give access' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: /^Role/ }).selectOption('Leadership');
    await dialog.getByRole('combobox', { name: /^Client/ }).selectOption({ label: 'Kroger' });
    await dialog.getByRole('checkbox', { name: 'Email them about this' }).check();
    await expect(page.getByTestId('email-panel')).toHaveCount(0); // (not before the save)
    before = fake.requests.length;
    await dialog.getByRole('button', { name: 'Give access' }).click();
    const panel = page.getByTestId('email-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('access-row')).toHaveCount(2);
    await page.waitForLoadState('networkidle');
    expect(writes(fake, before).length).toBe(unticked.writes);
    expect(kinds(fake, before).filter((each) => !unticked.kinds.includes(each))).toEqual([]); // (no request the unticked change did not make)
    expect(emailLines(fake)).toHaveLength(0); // (none for showing it)
    const text = panel.getByRole('textbox');
    await expect(text).toHaveValue(/has given you the Leadership role on/);
    await expect(text).toHaveValue(/For Kroger\./);
    await expect(text).toHaveValue(/admin\.html/);
    await expect(panel).toContainText('The app does not send it: you press Send.');
    const draft = panel.getByRole('link', { name: 'Open email draft' });
    await expect(draft).toHaveAttribute('href', /^mailto:bmilder%40deloitte\.com\?cc=vsatyadev%40deloitte\.com&subject=/);
    await axe(page, 'the message');
    // Editing the message changes the draft.
    await text.fill('Hello Brian, a word of my own.');
    await expect(draft).toHaveAttribute('href', new RegExp(`body=${encodeURIComponent('Hello Brian, a word of my own.')}$`));
    before = fake.requests.length;
    await draft.click();
    await expect(panel.getByRole('status').filter({ hasText: 'Press Send there' })).toBeVisible();
    await expect.poll(() => emailLines(fake).length).toBe(1);
    await panel.getByRole('button', { name: 'Copy message' }).click();
    await expect(panel.getByRole('status').filter({ hasText: /Message copied|Press Ctrl\+C/ })).toBeVisible();
    await expect.poll(() => emailLines(fake).length).toBe(2);
    expect(writes(fake, before)).toHaveLength(2); // (one line per press, and nothing else)
    expect(emailLines(fake).map((line: any) => [line.Detail, line.TargetUser])).toEqual([['Draft opened', mail('bmilder')], ['Message copied', mail('bmilder')]]);
    expect(served.unexpected).toEqual([]);
  });

  test('Remove, Turn off and Turn on: the box in each, unticked; a removal and a turn-off carry no link', async ({ page }) => {
    const fake = await site(me('vsatyadev', 'Satyadev, Vedala Venkata'));
    await open(page, fake);
    await person(page, 'Aedla, Rajeshwar');
    await page.getByRole('button', { name: /^Remove Producer/ }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('checkbox', { name: 'Email them about this' })).not.toBeChecked();
    await dialog.getByRole('checkbox', { name: 'Email them about this' }).check();
    await axe(page, 'Remove, with the box');
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
    const panel = page.getByTestId('email-panel');
    await expect(panel.getByRole('textbox')).toHaveValue(/Your Producer role for Kroger on .* has been removed\./);
    await expect(panel.getByRole('textbox')).not.toHaveValue(/https?:/);
    await page.getByRole('button', { name: 'Turn access off' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('checkbox', { name: 'Email them about this' })).not.toBeChecked();
    await dialog.getByRole('checkbox', { name: 'Email them about this' }).check();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Turn access off' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('checkbox', { name: 'Email them about this' })).not.toBeChecked(); // (unticked again)
    await dialog.getByRole('checkbox', { name: 'Email them about this' }).check();
    await dialog.getByRole('button', { name: 'Turn access off' }).click();
    await expect(panel.getByRole('textbox')).toHaveValue(/has been turned off\./);
    await expect(panel.getByRole('textbox')).not.toHaveValue(/https?:/);
    // Turn on is one press: the page's own box, unticked, then unticked again after the change.
    const pageBox = page.getByRole('checkbox', { name: 'Email them about this' });
    await expect(pageBox).not.toBeChecked();
    await pageBox.check();
    await page.getByRole('button', { name: 'Turn access on' }).click();
    await expect(panel.getByRole('textbox')).toHaveValue(/has been turned on again\./);
    await expect(pageBox).not.toBeChecked();
    // Unticked: the panel shown before is closed by hand, and nothing new comes.
    await panel.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Turn access off' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Turn access off' }).click();
    await expect(page.getByRole('button', { name: 'Turn access on' })).toBeVisible();
    await expect(page.getByTestId('email-panel')).toHaveCount(0);
    expect(emailLines(fake)).toHaveLength(0);
  });

  test('an Admin\'s team add and remove: the box, unticked, and the message to the person chosen', async ({ page }) => {
    const fake = await site(me('pulmathur', 'Mathur, Pulkit'));
    await open(page, fake);
    await page.getByRole('tab', { name: 'Clients' }).click();
    await page.getByRole('button', { name: 'Sessions and team: Kroger' }).click();
    await page.getByRole('button', { name: 'Add to team' }).click();
    await expect(page.getByRole('checkbox', { name: 'Email them about this' })).not.toBeChecked();
    await page.getByLabel('Search people').fill('milder');
    await page.getByLabel('Person').selectOption({ label: 'Milder, Brian (bmilder@deloitte.com)' });
    await expect(page.getByTestId('email-box')).toContainText('To: bmilder@deloitte.com.');
    await page.getByRole('checkbox', { name: 'Email them about this' }).check();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const panel = page.getByTestId('email-panel');
    await expect(panel.getByRole('textbox')).toHaveValue(/has added you to a client's team on .*, as a Producer\./);
    await expect(panel.getByRole('link', { name: 'Open email draft' })).toHaveAttribute('href', /^mailto:bmilder%40deloitte\.com\?/);
    await page.getByRole('button', { name: 'Add to team' }).click();
    await expect(page.getByRole('checkbox', { name: 'Email them about this' })).not.toBeChecked(); // (the form opens unticked again)
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: /^Remove Milder, Brian/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('checkbox', { name: 'Email them about this' })).not.toBeChecked();
    await dialog.getByRole('checkbox', { name: 'Email them about this' }).check();
    await dialog.getByRole('button', { name: 'Remove' }).click();
    await expect(panel.getByRole('textbox')).toHaveValue(/Your Producer role for Kroger on .* has been removed\./);
  });

  for (const [name, full] of [['raedla', 'Aedla, Rajeshwar'], ['mohammadahussain', 'Hussain, Mohammad Afrid'], ['lead', 'Lead, Leader']]) {
    test(`${full} (no role to give) never sees the box or the message`, async ({ page }) => {
      const fake = await site(me(name, full));
      await open(page, fake);
      await expect(page.getByRole('navigation', { name: 'Admin sections' }).getByRole('tablist')).toBeVisible();
      await expect(page.getByRole('tab', { name: 'People' })).toHaveCount(0);
      await expect(page.getByTestId('email-box')).toHaveCount(0);
      await expect(page.getByTestId('email-panel')).toHaveCount(0);
    });
  }
});
