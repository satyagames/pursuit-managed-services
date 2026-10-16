import { test, expect, type Page } from '@playwright/test';
import { sha256Hex } from '../../migration/src/lib/sha256.js';
import { newFake, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';

// Phase 10c-3: the built Setup page prepares a site, against the mocked SharePoint REST (scripts/sharepoint-fake.js). Nothing reaches a real
// tenant: what the real site answers to each request is QA-TESTING.md's to see.

/** Every list of the schema and the picture library, by key: `without` all of them is a site with nothing of the app on it. */
const EVERYTHING = ['clients', 'sessions', 'sections', 'questions', 'options', 'tracks', 'qrtokens', 'appsettings', 'visitorroster', 'uservisitlogs', 'adminusers', 'responses', 'logoLibrary'];

async function openSetup(page: Page, fake: Fake) {
  const served = await serveSharePoint(page, fake);
  await page.goto(pageUrl('setup.html'));
  return served;
}
const lists = (page: Page) => page.getByRole('region', { name: /Lists/ });
async function showPlan(page: Page) {
  await lists(page).getByRole('button', { name: 'Show the plan' }).click();
  await expect(page.getByTestId('plan-status')).toHaveText('Nothing on the site was changed.');
}

test('Show the plan on a site with nothing on it: every list, column and setting, in words, and nothing written', async ({ page }) => {
  const fake = newFake({ without: EVERYTHING, schemaVersion: null });
  const served = await openSetup(page, fake);
  await showPlan(page);
  await expect(page.getByTestId('plan-summary')).toHaveText('13 lists, 89 columns, 47 settings to create.');
  const activities = page.locator('[data-testid="plan"] [data-list="sections"]');
  await expect(activities.getByRole('heading', { name: 'PMSActivities (new)' })).toBeVisible();
  await expect(activities).toContainText('Create the list PMSActivities.');
  await expect(activities).toContainText('Create 7 columns: AppId, SortOrder, Enabled, IndustryTags, QuestionIds, ClientId, Description.');
  await expect(activities).toContainText('Turn attachments off, content approval off.');
  // The internal names and definitions are there, folded away.
  await activities.getByText('Technical details').click();
  await expect(activities).toContainText('<Field Type="Number" Name="SortOrder" StaticName="SortOrder" DisplayName="SortOrder" Required="FALSE" />');
  expect(fake.writes(), 'the plan writes nothing').toEqual([]);
  expect(served.unexpected).toEqual([]);
});

test('Show the plan on a complete site says "Nothing to create", and names what is already as the app needs', async ({ page }) => {
  const fake = newFake();
  await openSetup(page, fake);
  await showPlan(page);
  await expect(page.getByTestId('plan-summary')).toHaveText('Nothing to create.');
  await expect(page.getByTestId('plan-settled')).toContainText('Already as the app needs: PMSClients, PMSClientSessions');
  expect(fake.writes()).toEqual([]);
});

test('Show the plan reports a column of the wrong type and a rich-text column, with their fixes, and plans nothing for them', async ({ page }) => {
  const fake = newFake();
  fake.field('sections', 'SortOrder')!.TypeAsString = 'Text';
  fake.field('clients', 'ThemeJson')!.RichText = true;
  await openSetup(page, fake);
  await showPlan(page);
  await expect(page.getByTestId('plan-summary')).toHaveText('Nothing to create. 2 things Setup will not touch need fixing by hand (below).');
  await expect(page.locator('[data-testid="plan"] [data-list="sections"]')).toContainText('SortOrder is of type Text; the app needs Number. To fix: A column\'s type is not changed here.');
  await expect(page.locator('[data-testid="plan"] [data-list="clients"]')).toContainText('ThemeJson is rich text; the app keeps plain text in it. To fix: In the list\'s settings, edit ThemeJson: choose Plain text');
  expect(fake.writes()).toEqual([]);
});

// ---- Create (Phase 10c-3, part C) ---------------------------------------------------------------------------------------------------------

async function create(page: Page) {
  page.once('dialog', (dialog) => { expect(dialog.message()).toContain('It only adds'); void dialog.accept(); });
  await lists(page).getByRole('button', { name: 'Create', exact: true }).click();
}

test('Create is off until the plan has been shown, then carries it out, says what it made, and reads the site again: "Nothing to create"', async ({ page }) => {
  const fake = newFake({ without: EVERYTHING, schemaVersion: null });
  const served = await openSetup(page, fake);
  await expect(lists(page).getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
  await showPlan(page);
  await expect(lists(page).getByRole('button', { name: 'Create', exact: true })).toBeEnabled();
  page.once('dialog', (dialog) => void dialog.dismiss());
  await lists(page).getByRole('button', { name: 'Create', exact: true }).click();
  expect(fake.writes(), 'cancelling writes nothing').toEqual([]);
  await create(page);
  await expect(page.getByTestId('create-progress')).toHaveText(/^Created 13 lists, 89 columns and 47 settings in [\d.]+ s \(149 writes\)\.$/, { timeout: 30_000 });
  await expect(page.getByTestId('plan-status')).toHaveText('The site was read again after Create.');
  await expect(page.getByTestId('plan-summary')).toHaveText('Nothing to create.');
  await expect(lists(page).getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
  // A clean Create marks the site as ready by itself (part D).
  await expect(page.getByTestId('ready-status')).toHaveText('The site is marked ready: every list passed the check, and the settings item of PMSAppSettings now says version 3.');
  await expect(page.getByTestId('lists-version')).toHaveText('The lists are the version this app needs.');
  expect(fake.lists.size).toBe(12);
  expect(fake.libraryPresent).toBe(true);
  expect(fake.requests.some((entry) => entry.method === 'DELETE')).toBe(false);
  expect(served.unexpected).toEqual([]);
});

test('the version-history choice is unticked by default and changes the plan, with no request, for the four busy lists only', async ({ page }) => {
  const fake = newFake({ without: EVERYTHING, schemaVersion: null });
  await openSetup(page, fake);
  await showPlan(page);
  const choice = page.getByRole('checkbox', { name: /^Turn off version history on PMSParticipants, PMSParticipantAnswers, PMSGuestQRCodes and PMSVisitLog \(if your organisation's policy allows\)$/ });
  await expect(choice).not.toBeChecked();
  await expect(page.locator('[data-testid="plan"] [data-list="tracks"]')).toContainText('Turn attachments off, content approval off.');
  const reads = fake.count();
  await choice.check();
  await expect(page.locator('[data-testid="plan"] [data-list="tracks"]')).toContainText('Turn attachments off, content approval off, version history off.');
  await expect(page.locator('[data-testid="plan"] [data-list="sessions"]')).toContainText('Turn attachments off, content approval off.');
  expect(fake.count(), 'worked out again from the same reads').toBe(reads);
  await create(page);
  await expect(page.getByTestId('create-progress')).toHaveText(/^Created 13 lists/, { timeout: 30_000 });
  expect(fake.listSettings('tracks')!.EnableVersioning).toBe(false);
  expect(fake.listSettings('sessions')!.EnableVersioning).toBe(true);
});

test('an account that may not create lists: Create stops at the first write and says what to do', async ({ page }) => {
  const fake = newFake({ without: EVERYTHING, schemaVersion: null });
  fake.forbid();
  await openSetup(page, fake);
  await showPlan(page);
  await create(page);
  await expect(page.getByTestId('create-progress')).toHaveText('Your account cannot create lists on this site. A site owner must press Create, or create the lists by hand from SHAREPOINT-LISTS.md.');
  await expect(page.getByTestId('create-made')).toHaveText('Nothing was made before it stopped.');
  await expect(page.getByTestId('create-technical')).toContainText('403 at: create the list PMSClients. Access denied.');
  expect(fake.writes()).toHaveLength(1);
  await expect(page.getByTestId('plan-summary')).toHaveText('13 lists, 89 columns, 47 settings to create.');
});

// ---- Ready (Phase 10c-3, part D) ------------------------------------------------------------------------------------------------------------

test('before the site is marked ready the participant and admin pages stop with PMS-LST-010; after Create, which marks it ready, they open', async ({ page }) => {
  const fake = newFake({ without: EVERYTHING, schemaVersion: null });
  await serveSharePoint(page, fake);
  await page.goto(pageUrl('index.html'));
  await expect(page.getByText('Details: PMS-LST-010')).toBeVisible();
  await page.goto(pageUrl('admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill('246813');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Details: PMS-LST-010')).toBeVisible();

  await page.goto(pageUrl('setup.html'));
  await showPlan(page);
  await create(page);
  await expect(page.getByTestId('ready-status')).toContainText('The site is marked ready', { timeout: 30_000 });
  expect(fake.item('appsettings', 'default')).toMatchObject({ Title: 'default', AppId: 'default', SchemaVersion: 3 });

  await page.goto(pageUrl('index.html'));
  await expect(page.getByRole('heading', { name: "Today's experience isn't live yet" })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This page cannot start' })).toHaveCount(0);
  await page.goto(pageUrl('admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill('246813');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Incorrect PIN.'), 'the admin page reads its lists: there is simply no admin yet (part E adds one)').toBeVisible();
  await expect(page.getByRole('heading', { name: 'This page cannot start' })).toHaveCount(0);
});

test('Mark the site as ready writes nothing on a site with one wrong column, and says why', async ({ page }) => {
  const fake = newFake({ schemaVersion: null });
  fake.field('sections', 'SortOrder')!.TypeAsString = 'Text';
  await openSetup(page, fake);
  await lists(page).getByRole('button', { name: 'Mark the site as ready' }).click();
  await expect(page.getByTestId('ready-status')).toHaveText('Not marked ready: the check found 1 problem. Fix it (it is listed below, with what Setup will not touch), then press Mark the site as ready again.');
  await expect(page.getByRole('table', { name: 'What to fix' })).toContainText('SortOrder');
  expect(fake.writes()).toEqual([]);
  expect(fake.lists.get('appsettings')).toEqual([]);
  await expect(page.getByTestId('lists-version')).toContainText("This site's lists have not been set up for this app yet");
});

// ---- Admins (Phase 10c-3, part E) -----------------------------------------------------------------------------------------------------------

const admins = (page: Page) => page.getByRole('region', { name: 'Admins' });
async function addAdmin(page: Page, name: string, pin: string, again = pin) {
  await admins(page).getByLabel('Name').fill(name);
  await admins(page).getByLabel('PIN (6 to 12 digits)').fill(pin);
  await admins(page).getByLabel('The same PIN again').fill(again);
  await admins(page).getByRole('button', { name: 'Add an admin' }).click();
}

test('Add an admin: the name and the hash are written, never the PIN; the admin page unlocks with that PIN and not with another', async ({ page }) => {
  const fake = newFake();
  const sent: string[] = [];
  page.on('request', (request) => { sent.push(`${request.url()} ${request.postData() ?? ''}`); });
  await openSetup(page, fake);
  await expect(admins(page).getByTestId('admin-names')).toHaveText('There is no admin on this site yet.');
  await addAdmin(page, 'Asha Rao', '482916', '482917');
  await expect(admins(page).getByTestId('admin-status')).toHaveText('Not added: The two PINs are not the same: type it again in both.');
  await expect(admins(page).getByLabel('PIN (6 to 12 digits)')).toHaveValue('');
  expect(fake.writes()).toEqual([]);
  await addAdmin(page, 'Asha Rao', '482916');
  await expect(admins(page).getByTestId('admin-status')).toHaveText('Added Asha Rao. They can unlock the admin page with their PIN.');
  await expect(admins(page).getByTestId('admin-names')).toHaveText('Admins on this site: Asha Rao.');
  const [row] = fake.lists.get('adminusers')!;
  expect(row).toMatchObject({ Name: 'Asha Rao', Title: 'Asha Rao', PinHash: sha256Hex('482916') });
  expect(sent.some((line) => line.includes('482916')), 'the PIN is in no request the page sent').toBe(false);
  await expect(page.getByText('482916')).toHaveCount(0);

  await page.goto(pageUrl('admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill('111111');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Incorrect PIN.')).toBeVisible();
  await page.getByRole('textbox', { name: 'PIN' }).fill('482916');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('tab', { name: 'Today' })).toBeVisible();
});

test('the seed-file import leaves the file\'s admins out, and says so', async ({ page }) => {
  const fake = newFake();
  await openSetup(page, fake);
  await page.getByRole('button', { name: 'Check Lists' }).click();
  await expect(page.getByTestId('lists-status')).toContainText('All list schemas ready');
  const seed = { version: 1, data: { clients: [{ id: 'seed-first', name: 'Synthetic First' }], sections: [], questions: [], options: [], sessions: [], adminusers: [{ id: 'admin-1', name: 'Demo Admin', pin: sha256Hex('1234') }] } };
  await page.getByLabel('Private seed file').setInputFiles({ name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(seed)) });
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Import Missing Records' }).click();
  await expect(page.getByTestId('import-status')).toHaveText("Complete: 1 imported, 0 already present. The file's admin was left out: admins are added with Add an admin.");
  expect(fake.lists.get('adminusers')).toEqual([]);
});

// ---- The steps of a new site (Phase 10c-3, part G) ---------------------------------------------------------------------------------------------

test('the Setup page reads as the steps of a new site: settings, lists, admins, then the optional ones, and moving content last', async ({ page }) => {
  await openSetup(page, newFake());
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    '1. This copy of the app', '2. Lists', '3. Admins', '4. Sample clients (optional)', '5. SharePoint self-test (optional)', 'Where the lists are', 'Moving content made on another copy',
  ]);
  await expect(lists(page).getByRole('heading', { level: 3 })).toHaveText(['Show the plan', 'Create', 'Check Lists', 'Mark the site as ready']);
});

test('a new site from nothing: plan, Create (which marks it ready), an admin, the sample clients, the admin page with that PIN, Go live, and a participant checks in', async ({ page }) => {
  test.setTimeout(120_000);
  const fake = newFake({ without: EVERYTHING, schemaVersion: null });
  const served = await openSetup(page, fake);
  await expect(page.getByTestId('lists-version')).toContainText("This site's lists have not been set up for this app yet");

  await showPlan(page);
  await expect(page.getByTestId('plan-summary')).toHaveText('13 lists, 89 columns, 47 settings to create.');
  await create(page);
  await expect(page.getByTestId('create-progress')).toHaveText(/^Created 13 lists, 89 columns and 47 settings in [\d.]+ s \(149 writes\)\.$/, { timeout: 60_000 });
  await expect(page.getByTestId('ready-status')).toHaveText('The site is marked ready: every list passed the check, and the settings item of PMSAppSettings now says version 3.');
  await expect(page.getByTestId('lists-version')).toHaveText('The lists are the version this app needs.');
  await expect(page.getByTestId('plan-summary')).toHaveText('Nothing to create.');

  await expect(admins(page).getByTestId('admin-names')).toHaveText('There is no admin on this site yet.');
  await addAdmin(page, 'Asha Rao', '482916');
  await expect(admins(page).getByTestId('admin-names')).toHaveText('Admins on this site: Asha Rao.');

  const samples = page.getByRole('region', { name: 'Sample clients' });
  page.once('dialog', (dialog) => void dialog.accept());
  await samples.getByRole('button', { name: 'Seed sample clients' }).click();
  await expect(samples.getByRole('status')).toContainText('Complete: 76 created, 0 completed, 0 already present.', { timeout: 30_000 });

  await page.goto(pageUrl('admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill('482916');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('tab', { name: 'Today' })).toBeVisible();
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Kroger' });
  const goLive = page.getByRole('button', { name: /^(Go live|Going live\.\.\.|Checking\.\.\.)$/ });
  await expect(goLive).toBeEnabled({ timeout: 15_000 });
  await goLive.click();
  await expect(page.getByText('Verified: participants now see Kroger')).toBeVisible({ timeout: 15_000 });

  await page.goto(pageUrl('index.html'));
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(page.locator('button.activity').first()).toBeVisible();
  await expect.poll(() => fake.lists.get('tracks')!.length, { message: 'the participant\'s visit is on the site' }).toBe(1);
  expect(fake.item('appsettings', 'default')).toMatchObject({ SchemaVersion: 3, ActiveClientId: 'c-kroger' });
  expect(fake.strays, 'nothing reached a list that is not this copy\'s').toEqual([]);
  expect(fake.requests.some((entry) => entry.method === 'DELETE')).toBe(false);
  expect(served.unexpected).toEqual([]);
});
