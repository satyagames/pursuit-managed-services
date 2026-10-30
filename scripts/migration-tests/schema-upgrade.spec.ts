import { test, expect, type Page } from '@playwright/test';
import { sha256Hex } from '../../migration/src/lib/admin/sha256.js';
import { newFake, onSite, pageUrl, seedAndGoLive, serveSharePoint, type Fake } from './sharepoint.js';
import { PHASE_20_COLUMNS, PHASE_21_COLUMNS, PHASE_21C_COLUMNS, PHASE_21D_COLUMNS, PHASE_21E_COLUMNS, PHASE_23_COLUMNS } from '../sharepoint-fake.js';
import { VERSION } from '../../migration/src/lib/schema/pms-schema.js';
import { showPlan, siteApi } from '../../migration/src/lib/setup/provision.js';

// (Prompt 22: this build's version and the plan are read, not typed: the spec said version 4 and "4 columns" until Prompt 21 made it 8, and the
// columns since version 2 are every column this build's data layer names that a site of version 2 lacks.)
const SINCE_2 = [...PHASE_20_COLUMNS, ...PHASE_21_COLUMNS, ...PHASE_21C_COLUMNS, ...PHASE_21D_COLUMNS, ...PHASE_21E_COLUMNS, ...PHASE_23_COLUMNS];
const NEWER = VERSION + 1;

// Phase 10i, part C, in the BUILT pages, against the mocked SharePoint REST in the real site's modes (`strict: false`: ClientId and DisplayName left out of a
// read that names no columns; DisplayName refused by name when there is an item; a duplicate refused with 500). The site is the PCOE site as it was on
// 15 Oct 2026: lists Setup made for version 2 (with their DisplayName columns), an admin, the sample clients, Domino's live, and a member of staff's visit
// logged under DisplayName. The participant and admin pages stop with PMS-LST-011; Setup says version 2 and what to press; Show the plan names the two new
// columns, and the two old ones as harmless; Create adds them and, being clean, marks the site as ready, which raises it: "Raised the lists from version 2
// to version 3." Then the participant page greets a member of staff and Results names them, and a named guest checks in by QR. Not the real site.
// (Since Phase 20 the site is brought to this build's version: the plan names the columns of every version since 2 as well.)

const PIN = '2468';
const DAY = '2026-10-15';

/** The PCOE site of 15 Oct 2026 (see the top). The records are what the pages of version 2 wrote: the item says this build's version while this test writes them. */
async function pcoe() {
  // (Phase 20: this build's data layer names PMSActivities.Kind and PMSClientSessions.ConfidenceCheck, so the site has them while the records are
  // written and loses them before anything is looked at.)
  const fake = newFake({ listsVersion: 2, strict: false, keepColumns: SINCE_2 });
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex(PIN) });
  fake.item('appsettings', 'default')!.SchemaVersion = VERSION;
  const session = await seedAndGoLive(fake, 'c-dominos', DAY);
  const before = await onSite(fake, (ds) => ds.beginVisit(crypto.randomUUID(), session.id, 'c-dominos', { sharePointUserId: '17' }));
  fake.add('uservisitlogs', {
    AppId: 'visit-before', Title: 'visit-before', SessionId: session.id, ClientId: 'c-dominos', Page: 'participant', EntryMode: 'staff', SharePointUserId: '17',
    DisplayName: 'Priya Shah', TrackId: (before as { id: string }).id, VisitedAt: `${DAY}T09:00:00.000Z`,
  });
  fake.dropColumns(SINCE_2);
  // (Go live rewrote the item: it is read again.)
  fake.item('appsettings', 'default')!.SchemaVersion = 2;
  fake.reset();
  return { fake, session };
}
const lists = (page: Page) => page.getByRole('region', { name: /Lists/ });
async function unlock(page: Page, hash = '') {
  await page.goto(`${pageUrl('admin.html')}${hash}`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
}

test('on the PCOE site of version 2 the participant and admin pages stop with PMS-LST-011, and write nothing', async ({ page }) => {
  const { fake } = await pcoe();
  const served = await serveSharePoint(page, fake);
  await page.goto(pageUrl('index.html'));
  await expect(page.getByRole('heading', { name: 'This page cannot start' })).toBeVisible();
  await expect(page.getByText("This site's lists are not the ones this version of the app needs")).toBeVisible();
  await expect(page.getByText('Details: PMS-LST-011')).toBeVisible();
  await unlock(page);
  await expect(page.getByText('Details: PMS-LST-011')).toBeVisible();
  expect(fake.writes()).toEqual([]);
  expect(served.unexpected).toEqual([]);
});

test('Setup brings the PCOE site from version 2 to this build\'s version: the plan, Create, "Raised the lists from version 2 to version 8.", and then the pages work', async ({ page, browser }) => {
  const { fake, session } = await pcoe();
  // What Show the plan should say: Setup's own plan of this very site, read before the page opens (scripts/test-provision.js holds the plan itself).
  const { plan: expected } = await onSite(fake, (ds) => showPlan(siteApi(ds), ds.sharePointListTitles()));
  fake.reset();
  const writes = expected.lists.length + expected.columns.length + expected.settings.length;
  const served = await serveSharePoint(page, fake);
  await page.goto(pageUrl('setup.html'));
  await expect(page.getByTestId('lists-version')).toHaveText(`This site's lists need an update before this version of the app can use them. The lists on this site are version 2; this version of the app needs version ${VERSION}. `
    + `Open Setup (setup.html, in the same folder as this page), press Show the plan, then Create, then Mark the site as ready: a clean Create does the last step by itself. (PMS-LST-011, SchemaVersion 2, this build needs ${VERSION})`);

  // Show the plan: the new columns of version 3 and of every version since (and Prompt 21's lists), as Setup plans them; the old DisplayName columns are
  // named as harmless.
  await lists(page).getByRole('button', { name: 'Show the plan' }).click();
  await expect(page.getByTestId('plan-summary')).toHaveText(`${expected.summary}.`);
  expect(expected.columns.map((column: { name: string }) => column.name)).toEqual(expect.arrayContaining(['GuestName', 'SignedInName', 'Kind', 'ConfidenceCheck']));
  await expect(page.locator('[data-testid="plan"] [data-list="sessions"]')).toContainText('ConfidenceCheck');
  await expect(page.locator('[data-testid="plan"] [data-list="sections"]')).toContainText('Create 1 column: Kind.');
  const guests = page.locator('[data-testid="plan"] [data-list="visitorroster"]');
  const visits = page.locator('[data-testid="plan"] [data-list="uservisitlogs"]');
  await expect(guests).toContainText('GuestName');
  await expect(visits).toContainText('Create 1 column: SignedInName.');
  await expect(guests.locator('[data-harmless="true"]')).toContainText('DisplayName is no longer used since version 3: GuestName holds the guest\'s name now.');
  await expect(visits.locator('[data-harmless="true"]')).toContainText('Harmless: nothing reads or writes it. Leave it as it is, or a site owner may delete it by hand.');
  expect(fake.writes(), 'the plan writes nothing').toEqual([]);

  // Create adds what was planned, and a clean Create marks the site as ready by itself: that raises the version.
  page.once('dialog', (dialog) => { expect(dialog.message()).toContain('It only adds'); void dialog.accept(); });
  await lists(page).getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByTestId('create-progress')).toHaveText(new RegExp(`^Created ${expected.lists.length} lists?, ${expected.columns.length} columns and ${expected.settings.length} settings in [\\d.]+ s \\(${writes} writes\\)\\.$`), { timeout: 60_000 });
  await expect(page.getByTestId('ready-status')).toHaveText(`Raised the lists from version 2 to version ${VERSION}.`);
  await expect(page.getByTestId('lists-version')).toHaveText('The lists are the version this app needs.');
  await expect(page.getByTestId('lists-status')).toHaveText('All list schemas ready. Write permissions have not been tested.');
  expect(fake.item('appsettings', 'default')!.SchemaVersion).toBe(VERSION);
  expect(fake.field('visitorroster', 'DisplayName') && fake.field('uservisitlogs', 'DisplayName'), 'the old columns are where they were').toBeTruthy();
  expect(fake.requests.some((entry) => entry.method === 'DELETE')).toBe(false);
  // Pressed again, it writes nothing.
  await lists(page).getByRole('button', { name: 'Mark the site as ready' }).click();
  await expect(page.getByTestId('ready-status')).toHaveText(`The site was already marked ready (version ${VERSION}). Nothing was written.`);

  // A member of staff opens the participant page and begins: Welcome greets them, and their visit is logged under SignedInName.
  const staff = await browser.newPage();
  await serveSharePoint(staff, fake);
  await staff.goto(pageUrl('index.html'));
  await expect(staff.getByRole('heading', { name: 'Hi Casey Example!' })).toBeVisible();
  await staff.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(staff.locator('button.activity').first()).toBeVisible();
  await expect.poll(() => fake.lists.get('uservisitlogs')!.filter((row) => row.SignedInName === 'Casey Example').length).toBeGreaterThan(0);

  // Results names them; the visit of before keeps its name only in the old column, which the site will not return, so it is unnamed.
  await unlock(page, '#results');
  const titles = page.locator(`article[data-session="${session.id}"] .row__title`);
  // (Since Phase 16 the newest joiner is first: lib/admin/admin-results.js ROW_ORDER.)
  await expect(titles).toHaveText(['Casey Example', 'Unnamed participant 1']);

  // A named guest is added and gets a code (as Guests and QR does), and checks in by QR.
  const code = await onSite(fake, async (ds) => {
    await ds.setSessionParticipationMode(session.id, 'client-visit');
    const [guest] = (await ds.addGuests(session.id, ['Jordan Lee'], { gapMs: 0 })).added;
    return (await ds.provisionQrToken('c-dominos', session.id, { visitorId: guest.id })).id as string;
  });
  const guest = await (await browser.newContext()).newPage();
  await serveSharePoint(guest, fake);
  await guest.goto(`${pageUrl('index.html')}?qr=${code}`);
  await expect(guest.getByRole('heading', { name: 'Hi Jordan Lee!' })).toBeVisible();
  expect(fake.lists.get('tracks')!.some((row) => row.ParticipantName === 'Jordan Lee')).toBe(true);
  expect(served.unexpected).toEqual([]);
});

test('on a site whose lists say a newer version, Setup says they are newer, and Mark the site as ready never lowers them', async ({ page }) => {
  const fake: Fake = newFake({ schemaVersion: NEWER });
  await serveSharePoint(page, fake);
  await page.goto(pageUrl('setup.html'));
  await expect(page.getByTestId('lists-version')).toContainText(`The lists on this site are version ${NEWER}; these files are for version ${VERSION}. Upload the newer files.`);
  await lists(page).getByRole('button', { name: 'Mark the site as ready' }).click();
  await expect(page.getByTestId('ready-status')).toHaveText(`Not marked ready: the settings item says version ${NEWER}; this version of the app is for version ${VERSION}. Setup never lowers the version of the lists: upload the newer files.`);
  expect(fake.item('appsettings', 'default')!.SchemaVersion).toBe(NEWER);
  expect(fake.writes()).toEqual([]);
});
