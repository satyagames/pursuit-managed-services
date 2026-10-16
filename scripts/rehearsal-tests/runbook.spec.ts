import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dataService from '../../public/js/dataService.js';
import { samplePack } from '../../migration/src/lib/sample-clients.js';
import { SAMPLE_PICTURES } from '../../migration/src/lib/sample-pictures.js';
import { seedSampleClients } from '../../migration/src/lib/sample-seed.js';
import { sha256Hex } from '../../migration/src/lib/sha256.js';
import { FOLDER_URL, SETTINGS_TEXT, SITE } from '../release-docs.js';
import { TITLE, createSharePointFake } from '../sharepoint-fake.js';

// Phase 10f, part D: RUNBOOK.md rehearsed on the mocked SharePoint REST, with the pages OF THE RELEASE PACKAGE (not a dev build), served at the new
// site's own addresses: ${SITE}/Shared%20Documents/PMS/. Steps 3 to 15, twice: on an empty site, and on a site built by hand with every list and
// column but one mistake (a column called "Session Id", internal name Session_x0020_Id, where PMSParticipants needs SessionId). Step 11 (permissions)
// cannot be rehearsed: the mock has no permissions. Screenshots of every step that asks for one go to test-results/rehearsal/.
//
// Phase 10h: the mock answers as the real site did on 14 Oct 2026 (`strict: false`: an item read that names no columns comes back without ClientId,
// and a duplicate is refused with 500), the self-test is step 10 (the steps after it moved one on), every rehearsal ends by holding that no item read
// went out without naming its columns (but the self-test probe's one, which does so on purpose), and a third rehearsal follows the runbook's note
// for the PCOE site: a site that already has its lists, an admin and the samples, where only the three pages are replaced.
//
// Phase 10i: the mock also answers as the site did on 15 Oct 2026 (DisplayName refused by name when there is an item, and left out of an unnamed read), the
// self-test is eleven steps (its fourth probe names what the site will not return by name), the third rehearsal is a site that already has its lists of
// this version (the 10h note's case), and a fourth follows the runbook's note for the PCOE site as it is now: lists of version 2 with their DisplayName
// columns, an admin, the samples, Domino's live and a staff visit logged under DisplayName, brought to version 3 by Setup; then a named guest and a code,
// the self-test, Results (the earlier visit unnamed), and an iPad that checks in with the guest's code.
//
//   npm run package:release       (from a clean, committed tree)
//   npm run test:rehearsal        (PMS_PACKAGE=<folder> to rehearse another package)

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = path.join(ROOT, 'test-results', 'rehearsal');
const PAGES = ['index.html', 'admin.html', 'setup.html'];
const EVERYTHING = ['clients', 'sessions', 'sections', 'questions', 'options', 'tracks', 'qrtokens', 'appsettings', 'visitorroster', 'uservisitlogs', 'adminusers', 'responses', 'logoLibrary'];
const PIN = '482916';
const TODAY = new Date().toLocaleDateString('en-CA');
const PICTURES = path.join(ROOT, 'migration', 'src', 'assets', 'sample-pictures');
const SUPPORT = '{"configVersion": 1, "listPrefix": "", "label": "PMS", "support": {"name": "Your name", "contact": "you@deloitte.com"}}';

/** The package folder to rehearse: PMS_PACKAGE, or the newest build-svelte/package/pms-<commit>/. */
async function packageFolder() {
  if (process.env.PMS_PACKAGE) return path.resolve(process.env.PMS_PACKAGE);
  const base = path.join(ROOT, 'build-svelte', 'package');
  const folders = await Promise.all((await readdir(base).catch(() => [])).filter((name) => /^pms-[0-9a-f]{7}$/.test(name))
    .map(async (name) => ({ name, at: (await stat(path.join(base, name))).mtimeMs })));
  const newest = folders.sort((a, b) => b.at - a.at)[0];
  if (!newest) throw new Error('There is no release package to rehearse with: run `npm run package:release` first.');
  return path.join(base, newest.name);
}

/** The package's own pms-config.txt, as it will be uploaded: it must be exactly the settings text (Phase 10g), and it is what the rehearsal's site serves for it. */
async function packageSettings(pkg: string) {
  const text = await readFile(path.join(pkg, 'pms-config.txt'), 'utf8');
  expect(text).toBe(SETTINGS_TEXT);
  return text;
}

type Fake = ReturnType<typeof createSharePointFake>;
type Site = { fake: Fake; pkg: string; settings: string; unexpected: string[]; pictures: string[] };

/** Serves the package's pages and its pms-config.txt at the folder's address, the site's REST API from the fake, and the library's files. */
async function open(page: Page, site: Site) {
  const origin = new URL(SITE).origin;
  const api = `${new URL(SITE).pathname.toLowerCase()}/_api/`;
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const here = `${url.origin}${url.pathname}`;
    const file = PAGES.find((name) => here === `${FOLDER_URL}/${name}`);
    if (file) return route.fulfill({ contentType: 'text/html', body: await readFile(path.join(site.pkg, file)) });
    if (here === `${FOLDER_URL}/pms-config.txt`) return route.fulfill({ contentType: 'text/plain; charset=utf-8', body: site.settings });
    if (url.origin === origin && url.pathname.toLowerCase().startsWith(api)) {
      const reply = await site.fake.handle({ method: request.method(), url: request.url(), headers: request.headers(), body: request.postData(), bodyBuffer: request.postDataBuffer() ?? undefined });
      return route.fulfill({ status: reply.status, headers: reply.headers, body: reply.body });
    }
    if (url.origin === origin && url.pathname.startsWith(`${site.fake.libraryFolder}/`)) {
      site.pictures.push(url.pathname);
      const stored = site.fake.file(decodeURIComponent(url.pathname));
      return stored ? route.fulfill({ status: 200, contentType: stored.type, body: Buffer.from(stored.bytes) }) : route.fulfill({ status: 404, body: 'Not found' });
    }
    site.unexpected.push(url.href);
    return route.abort();
  });
}

const shoot = async (page: Page, name: string) => {
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
};
const lists = (page: Page) => page.getByRole('region', { name: /Lists/ });
/** The site as the real one answered on 14 Oct 2026 (Phase 10h): unnamed reads without ClientId, a duplicate refused with 500. */
const tenant = (options: Parameters<typeof createSharePointFake>[0]) => createSharePointFake({ ...options, strict: false });
/** Every item read the pages sent that named no columns, but the self-test probe's one item (`$top=1`), which does so on purpose. */
const unnamed = (fake: Fake) => fake.requests.flatMap((entry) => [entry, ...(entry.parts ?? [])])
  .filter((entry) => entry.method === 'GET' && /\/items$/.test(entry.path) && !/[?&]\$select=/.test(entry.query) && entry.query !== '?$top=1')
  .map((entry) => `${entry.list}${entry.query}`);
/** Whether a button can be seen as one: a background of its own that is not the page's, or a border (Phase 10h, part C). */
const seen = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).evaluate((button) => {
  const style = getComputedStyle(button);
  const page = getComputedStyle(document.body).backgroundColor;
  return (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== page) || (parseFloat(style.borderTopWidth) >= 1 && style.borderTopStyle !== 'none');
});

/** What the fourth probe says (Phase 10i) on a site of this version alone: nothing is refused. */
const NOTHING_REFUSED = 'Every column of the lists it read came back when named.';
/**
 * Step 10: the self-test. Every step passes, the site's 500 for a duplicate is read as a duplicate, the third probe names what the site leaves out, and
 * the fourth says `refused` (Phase 10i).
 */
async function selfTest(page: Page, label: string, browserName: string, refused = NOTHING_REFUSED) {
  const section = page.getByRole('region', { name: 'SharePoint self-test' });
  await expect(section).toContainText(`Proves that the ${TITLE.responses} list behaves`);
  page.once('dialog', (dialog) => { expect(dialog.message()).toContain(`one test item in the ${TITLE.responses} list of THIS site`); void dialog.accept(); });
  await section.getByRole('button', { name: 'Run self-test' }).click();
  // Playwright's WebKit drops the boundary of a fulfilled $batch reply (migration/playwright.config.ts says so), so the batch step fails there and only there.
  if (browserName === 'webkit') await expect(section.getByRole('status')).toHaveText('Self-test failed: Two reads in one request ($batch).', { timeout: 30_000 });
  else await expect(section.getByRole('status')).toContainText('Passed: 11 of 11 steps', { timeout: 30_000 });
  await expect(section.getByRole('row', { name: /A second create with the same AppId is refused/ })).toContainText('Refused: AppId enforces unique values.');
  await expect(section.getByRole('row', { name: /columns this site leaves out/ })).toContainText(new RegExp(`Left out of a read that names no columns: [^.]*${TITLE.sections}: ClientId`));
  await expect(section.getByRole('row', { name: /columns this site will not return by name/ })).toContainText(refused);
  await shoot(page, `${label}-step10-selftest`);
}
/** Step 5: Create, and the confirmation it asks for (the runbook says to confirm). */
async function create(page: Page) {
  page.once('dialog', (dialog) => { expect(dialog.message()).toContain('It only adds'); void dialog.accept(); });
  await lists(page).getByRole('button', { name: 'Create', exact: true }).click();
}

/** Steps 8 to 15, the same on both sites once Setup has made them ready. */
async function fromAdminToResults(page: Page, browser: Browser, site: Site, label: string, browserName: string) {
  // 8. Add an admin. (Phase 10h: the button can be seen.)
  const admins = page.getByRole('region', { name: /Admins/ });
  await admins.getByLabel('Name').fill('Asha Rao');
  await admins.getByLabel('PIN (6 to 12 digits)').fill(PIN);
  await admins.getByLabel('The same PIN again').fill(PIN);
  expect(await seen(page, 'Add an admin'), 'Add an admin can be seen').toBe(true);
  await admins.getByRole('button', { name: 'Add an admin' }).click();
  await expect(admins.getByTestId('admin-names')).toHaveText('Admins on this site: Asha Rao.');
  await shoot(page, `${label}-step08-admin`);

  // 9. Seed sample clients.
  const samples = page.getByRole('region', { name: 'Sample clients' });
  expect(await seen(page, 'Seed sample clients'), 'Seed sample clients can be seen').toBe(true);
  page.once('dialog', (dialog) => void dialog.accept());
  await samples.getByRole('button', { name: 'Seed sample clients' }).click();
  await expect(samples.getByRole('status')).toHaveText('Complete: 76 created, 0 completed, 0 already present. Pictures: 6 uploaded, 0 already in the library.', { timeout: 30_000 });
  await shoot(page, `${label}-step09-seed`);
  expect([...site.fake.files.keys()].map((key) => key.split('/').pop()).sort()).toEqual(Object.values(SAMPLE_PICTURES).flatMap((entry) => [entry.hero.name, entry.logo.name, entry.background.name]).sort());
  for (const [key, stored] of site.fake.files) {
    const committed = await readFile(path.join(PICTURES, key.split('/').pop()!));
    if (browserName === 'webkit') {
      // Playwright's WebKit does not hand a route the body of a Blob upload, so the mock stored each picture empty (migration/playwright.config.ts
      // says so). The six names arrived; the committed bytes are put in their place so that the iPad's steps can still be rehearsed in Safari's engine.
      expect(stored.bytes.length, `${key}: if WebKit now hands the body over, drop this`).toBe(0);
      stored.bytes = new Uint8Array(committed);
    } else {
      expect(Buffer.from(stored.bytes).equals(committed), `${key} arrived whole`).toBe(true);
    }
  }

  // 10. The self-test (optional).
  await selfTest(page, label, browserName);

  // (11. Permissions: the mock has none to set.)

  // 12. A support contact: the file replaced, Setup reloaded.
  site.settings = SUPPORT;
  await page.reload();
  await expect(page.getByText('Your name, you@deloitte.com')).toBeVisible();

  await fromGoLiveToResults(page, browser, site, label);
}

/** Steps 13 to 15: Go live, one iPad, Results. */
async function fromGoLiveToResults(page: Page, browser: Browser, site: Site, label: string) {
  // 13. Go live with Kroger: readiness says nothing of a logo, and the participant link is this folder's.
  await page.goto(`${FOLDER_URL}/admin.html`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Kroger' });
  const goLive = page.getByRole('button', { name: /^(Go live|Going live\.\.\.|Checking\.\.\.)$/ });
  await expect(goLive).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByText(/has no logo or hero image/)).toHaveCount(0);
  await goLive.click();
  await expect(page.getByText('Verified: participants now see Kroger')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('textbox', { name: 'Participant link' })).toHaveValue(`${FOLDER_URL}/index.html`);
  await expect(page.getByRole('img', { name: 'QR code for the participant link' })).toBeVisible();
  await shoot(page, `${label}-step13-today`);

  // 14. One iPad: Welcome with Kroger's pictures, then one activity to its end.
  const context = await browser.newContext({ viewport: { width: 820, height: 1180 } });
  const ipad = await context.newPage();
  await open(ipad, site);
  await ipad.goto(`${FOLDER_URL}/index.html`);
  await expect(ipad.locator('.pms-hero-box')).toHaveAttribute('data-badge', 'ready', { timeout: 15_000 });
  await expect(ipad.locator('.shell')).toHaveAttribute('data-background', 'ready', { timeout: 15_000 });
  expect(site.pictures.map((address) => address.split('/').pop())).toEqual(expect.arrayContaining([SAMPLE_PICTURES['c-kroger'].hero.name, SAMPLE_PICTURES['c-kroger'].background.name]));
  // (The hero fades in once it has loaded: the picture is taken when it is fully there.)
  await expect.poll(() => ipad.locator('img.pms-badge').evaluate((image) => getComputedStyle(image).opacity)).toBe('1');
  await expect.poll(() => ipad.locator('.shell > img').evaluate((image) => getComputedStyle(image).opacity)).toBe('1');
  await shoot(ipad, `${label}-step14-welcome`);
  await ipad.getByRole('button', { name: 'Click here to begin' }).click();
  const pack = samplePack();
  const history = pack.sections.find((section) => section.id === 'sec-trivia')!;
  await ipad.getByRole('button', { name: new RegExp(history.title) }).click();
  for (const [index, questionId] of history.questionIds.entries()) {
    const right = pack.options.find((option) => option.questionId === questionId && option.correct)!;
    await ipad.locator('.pms-options button').filter({ hasText: right.label }).first().click();
    await ipad.getByRole('button', { name: index === history.questionIds.length - 1 ? 'Submit' : 'Next', exact: true }).click();
  }
  await expect(ipad.getByText(`${history.questionIds.length} of ${history.questionIds.length} right on the first try`)).toBeVisible({ timeout: 15_000 });
  await shoot(ipad, `${label}-step14-done`);
  await context.close();

  // 15. Results: today's session, one participant, the five answers.
  await page.getByRole('tab', { name: 'Results', exact: true }).click();
  const card = page.locator(`[data-session="kroger-${TODAY}"]`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  // The participant is named by the iPad's sign-in (Casey Example, the fake's default signed-in user), with the five answers of step 14 (of six questions in Kroger's live activities).
  await expect(card).toContainText("Casey Example5 of 6 questions answered");
  await shoot(page, `${label}-step15-results`);
  expect(site.unexpected).toEqual([]);
  expect(site.fake.strays, 'nothing reached a list that is not this copy\'s').toEqual([]);
  expect(unnamed(site.fake), 'every item read named its columns (Phase 10h)').toEqual([]);
}

test('the runbook on an empty site: This copy of the app, the plan, Create, ready, an admin, the samples, Go live, an iPad, Results', async ({ page, browser, browserName }) => {
  const pkg = await packageFolder();
  const site: Site = { fake: tenant({ prefix: '', siteUrl: SITE, without: EVERYTHING, schemaVersion: null }), pkg, settings: await packageSettings(pkg), unexpected: [], pictures: [] };
  await page.setViewportSize({ width: 1366, height: 900 });
  await open(page, site);

  // 3. This copy of the app.
  await page.goto(`${FOLDER_URL}/setup.html`);
  const copy = page.getByRole('region', { name: /This copy of the app/ });
  await expect(copy).toContainText(`${SITE} (from this page's address)`);
  await expect(copy).toContainText('PMSClients, PMSClientSessions, ... (12) (no prefix from pms-config.txt)');
  await expect(copy).toContainText('PMSClientImages');
  await expect(copy).toContainText('PMS (from pms-config.txt)');
  await expect(copy).toContainText(`${path.basename(site.pkg)} (built in)`);
  await shoot(page, `empty-${browserName}-step03-this-copy`);

  // 4. Show the plan. (Phase 10h: Create can be seen.)
  await lists(page).getByRole('button', { name: 'Show the plan' }).click();
  await expect(page.getByTestId('plan-summary')).toHaveText('13 lists, 89 columns, 47 settings to create.');
  expect(await seen(page, 'Create'), 'Create can be seen').toBe(true);
  await shoot(page, `empty-${browserName}-step04-plan`);

  // 5. Create (it marks the site ready by itself when it ends clean).
  await create(page);
  await expect(page.getByTestId('create-progress')).toHaveText(/^Created 13 lists, 89 columns and 47 settings in [\d.]+ s \(149 writes\)\.$/, { timeout: 90_000 });
  await shoot(page, `empty-${browserName}-step05-create`);

  // 6. Check Lists: every row Ready.
  await lists(page).getByRole('button', { name: 'Check Lists' }).click();
  await expect(page.getByTestId('lists-status')).toHaveText('All list schemas ready. Write permissions have not been tested.');
  await shoot(page, `empty-${browserName}-step06-check`);

  // 7. Mark the site as ready: Create did it already, so pressing it writes nothing.
  await expect(page.getByTestId('ready-status')).toHaveText('The site is marked ready: every list passed the check, and the settings item of PMSAppSettings now says version 3.');
  await lists(page).getByRole('button', { name: 'Mark the site as ready' }).click();
  await expect(page.getByTestId('ready-status')).toHaveText('The site was already marked ready (version 3). Nothing was written.');
  await shoot(page, `empty-${browserName}-step07-ready`);

  await fromAdminToResults(page, browser, site, `empty-${browserName}`, browserName);
});

test('the runbook on a hand-built site with one misnamed column: the plan reports it, Mark ready refuses, and after the fix it is ready', async ({ page, browser, browserName }) => {
  const fake = tenant({ prefix: '', siteUrl: SITE, without: ['tracks.SessionId'], schemaVersion: null });
  fake.fields.get('tracks')!.push({ InternalName: 'Session_x0020_Id', Title: 'Session Id', TypeAsString: 'Text', Indexed: false, EnforceUniqueValues: false, Required: false, ReadOnlyField: false, Hidden: false, FromBaseType: false });
  const pkg = await packageFolder();
  const site: Site = { fake, pkg, settings: await packageSettings(pkg), unexpected: [], pictures: [] };
  await page.setViewportSize({ width: 1366, height: 900 });
  await open(page, site);

  // Before Setup has marked it ready, the participant page stops with PMS-LST-010 (the runbook says this is expected).
  await page.goto(`${FOLDER_URL}/index.html`);
  await expect(page.getByText('This page cannot start')).toBeVisible();
  await expect(page.getByText(/PMS-LST-010/).first()).toBeVisible();

  // 3. This copy of the app.
  await page.goto(`${FOLDER_URL}/setup.html`);
  await expect(page.getByRole('region', { name: /This copy of the app/ })).toContainText(SITE);
  await shoot(page, `handbuilt-${browserName}-step03-this-copy`);

  // 4. Show the plan: nothing to create, and the misnamed column, with its fix.
  await lists(page).getByRole('button', { name: 'Show the plan' }).click();
  await expect(page.getByTestId('plan-summary')).toHaveText('Nothing to create. 1 thing Setup will not touch needs fixing by hand (below).');
  const plan = page.getByTestId('plan');
  await expect(plan).toContainText('A column called "Session Id" has the internal name Session_x0020_Id; the app looks for SessionId.');
  await expect(plan).toContainText('Delete "Session Id" (on a new list it holds nothing), then press Show the plan again: Create will make SessionId');
  await shoot(page, `handbuilt-${browserName}-step04-plan`);

  // 7 (too early). Mark the site as ready refuses while the column is wrong.
  await lists(page).getByRole('button', { name: 'Mark the site as ready' }).click();
  await expect(page.getByTestId('ready-status')).toContainText('Not marked ready: the check found 1 problem.');
  expect(fake.item('appsettings', 'default'), 'no version written').toBeFalsy();
  await shoot(page, `handbuilt-${browserName}-step07-refused`);

  // The deployer deletes "Session Id" in the list's settings; the plan then names SessionId.
  const fields = fake.fields.get('tracks')!;
  fields.splice(fields.findIndex((field) => field.InternalName === 'Session_x0020_Id'), 1);
  await lists(page).getByRole('button', { name: 'Show the plan' }).click();
  await expect(page.getByTestId('plan-summary')).toHaveText(/^0 lists, 1 column, 1 setting to create\.\s*$/);
  await expect(page.locator('[data-testid="plan"] [data-list="tracks"]')).toContainText('Create 1 column: SessionId.');

  // 5. Create: the one column and its index, then the site is marked ready by itself.
  await create(page);
  await expect(page.getByTestId('create-progress')).toHaveText(/^Created 0 lists, 1 column and 1 setting in [\d.]+ s \(2 writes\)\.$/, { timeout: 60_000 });
  await expect(page.getByTestId('ready-status')).toHaveText('The site is marked ready: every list passed the check, and the settings item of PMSAppSettings now says version 3.');

  // 6. Check Lists.
  await lists(page).getByRole('button', { name: 'Check Lists' }).click();
  await expect(page.getByTestId('lists-status')).toHaveText('All list schemas ready. Write permissions have not been tested.');
  await shoot(page, `handbuilt-${browserName}-step06-check`);
  await shoot(page, `handbuilt-${browserName}-step07-ready`);

  await fromAdminToResults(page, browser, site, `handbuilt-${browserName}`, browserName);
});

// (Until Phase 10i this was the runbook's note for the PCOE site. The note is now for that site's lists of version 2, below; this is a site whose lists are of
// this version already, where only the three pages are replaced.)
test('a site that already has its lists of this version, an admin and the samples: three pages replaced, Setup checked, the self-test, Content, then Go live to Results', async ({ page, browser, browserName }) => {
  // The site as pms-969bf16 left it on 14 Oct 2026: its lists made and marked ready, an admin, the sample clients with their pictures. The previous
  // pages' run is stood for by the data layer (the samples as Setup seeds them, from the committed pictures).
  const fake = tenant({ prefix: '', siteUrl: SITE });
  fake.add('adminusers', { AppId: 'admin-pcoe', Title: 'Asha Rao', Name: 'Asha Rao', PinHash: sha256Hex(PIN) });
  const restore = fake.install();
  try {
    dataService.configure({ sharePoint: fake.settings });
    const seeded = await seedSampleClients(dataService, { siteUrl: SITE, file: async (name: string, type: string) => new Blob([await readFile(path.join(PICTURES, name))], { type }) });
    expect(seeded.filter((result) => result.status === 'Created')).toHaveLength(76);
  } finally {
    restore();
  }
  const pkg = await packageFolder();
  const site: Site = { fake, pkg, settings: await packageSettings(pkg), unexpected: [], pictures: [] };
  await page.setViewportSize({ width: 1366, height: 900 });
  await open(page, site);
  fake.reset();

  // 1 and 2 of the note: the three pages replaced (the package's are served), pms-config.txt kept; Setup shows the new build, every list stays Ready,
  // and the buttons can be seen.
  await page.goto(`${FOLDER_URL}/setup.html`);
  await expect(page.getByRole('region', { name: /This copy of the app/ })).toContainText(`${path.basename(site.pkg)} (built in)`);
  await lists(page).getByRole('button', { name: 'Check Lists' }).click();
  await expect(page.getByTestId('lists-status')).toHaveText('All list schemas ready. Write permissions have not been tested.');
  for (const name of ['Check Lists', 'Add an admin', 'Seed sample clients', 'Run self-test']) expect(await seen(page, name), `${name} can be seen`).toBe(true);
  await shoot(page, `pcoe-${browserName}-note2-setup`);

  // 3 of the note: the self-test (step 10).
  await selfTest(page, `pcoe-${browserName}`, browserName);

  // 4 of the note: Content shows Kroger's two activities and Domino's two.
  await page.goto(`${FOLDER_URL}/admin.html`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('tab', { name: 'Content', exact: true }).click();
  const pack = samplePack();
  const titles = (clientId: string) => pack.sections.filter((section) => section.clientId === clientId).map((section) => section.title);
  for (const [clientId, name] of [['c-kroger', 'Kroger'], ['c-dominos', "Domino's"]]) {
    await page.getByLabel('Client', { exact: true }).selectOption({ label: name });
    // (Each activity of the client has its live switch: the two of each, and no other.)
    await expect(page.getByRole('checkbox', { name: /^Set .+ live$/ })).toHaveCount(2);
    for (const title of titles(clientId)) await expect(page.getByRole('checkbox', { name: `Set ${title} live` })).toBeChecked();
  }
  await shoot(page, `pcoe-${browserName}-note4-content`);

  // 5 of the note: on from step 12 (the support contact is optional and left out here), Go live to Results.
  await fromGoLiveToResults(page, browser, site, `pcoe-${browserName}`);
});

test('the runbook\'s note for the PCOE site of version 2: the plan, Create, raised to version 3, a guest and a code, the self-test, Results, and an iPad that checks in by QR', async ({ page, browser, browserName }) => {
  // The site as it was on 15 Oct 2026: lists Setup made for version 2 (with their DisplayName columns), an admin, the sample clients with their pictures,
  // Domino's live and a member of staff's visit logged under DisplayName. The earlier pages' records are stood for by the data layer (the item said 3 while
  // they were written, and says 2 again before the note begins).
  const fake = tenant({ prefix: '', siteUrl: SITE, listsVersion: 2 });
  fake.add('adminusers', { AppId: 'admin-pcoe', Title: 'Asha Rao', Name: 'Asha Rao', PinHash: sha256Hex(PIN) });
  fake.item('appsettings', 'default')!.SchemaVersion = 3;
  const restore = fake.install();
  let sessionId = '';
  try {
    dataService.configure({ sharePoint: fake.settings });
    await seedSampleClients(dataService, { siteUrl: SITE, file: async (name: string, type: string) => new Blob([await readFile(path.join(PICTURES, name))], { type }) });
    sessionId = (await dataService.activateClient('c-dominos', TODAY)).session.id;
    const before = await dataService.beginVisit(crypto.randomUUID(), sessionId, 'c-dominos', { sharePointUserId: '17' });
    fake.add('uservisitlogs', { AppId: 'visit-15-oct', Title: 'visit-15-oct', SessionId: sessionId, ClientId: 'c-dominos', Page: 'participant', EntryMode: 'staff', SharePointUserId: '17', DisplayName: 'Priya Shah', TrackId: before.id });
  } finally {
    restore();
  }
  fake.item('appsettings', 'default')!.SchemaVersion = 2;
  const pkg = await packageFolder();
  const site: Site = { fake, pkg, settings: await packageSettings(pkg), unexpected: [], pictures: [] };
  await page.setViewportSize({ width: 1366, height: 900 });
  await open(page, site);
  fake.reset();

  // 1 and 2 of the note: the three pages replaced (the package's are served), pms-config.txt kept. The participant page stops with PMS-LST-011 until step 5;
  // Setup shows the new build and says the lists are version 2 and this build needs 3.
  await page.goto(`${FOLDER_URL}/index.html`);
  await expect(page.getByText('Details: PMS-LST-011')).toBeVisible();
  await page.goto(`${FOLDER_URL}/setup.html`);
  await expect(page.getByRole('region', { name: /This copy of the app/ })).toContainText(`${path.basename(site.pkg)} (built in)`);
  await expect(page.getByTestId('lists-version')).toContainText('The lists on this site are version 2; this version of the app needs version 3.');
  await expect(page.getByTestId('lists-version')).toContainText('(PMS-LST-011, SchemaVersion 2, this build needs 3)');
  await shoot(page, `pcoe-v2-${browserName}-note2-setup`);

  // 3. Show the plan: the two columns and nothing else; the two old DisplayName columns are harmless.
  await lists(page).getByRole('button', { name: 'Show the plan' }).click();
  await expect(page.getByTestId('plan-summary')).toHaveText('0 lists, 2 columns, 0 settings to create.');
  await expect(page.locator('[data-testid="plan"] [data-list="visitorroster"]')).toContainText('Create 1 column: GuestName.');
  await expect(page.locator('[data-testid="plan"] [data-list="uservisitlogs"]')).toContainText('Create 1 column: SignedInName.');
  await expect(page.locator('[data-testid="plan"] [data-harmless="true"]')).toHaveCount(2);
  await shoot(page, `pcoe-v2-${browserName}-note3-plan`);

  // 4 and 5. Create, which ends clean and marks the site as ready by itself: the version is raised.
  await create(page);
  await expect(page.getByTestId('create-progress')).toHaveText(/^Created 0 lists, 2 columns and 0 settings in [\d.]+ s \(2 writes\)\.$/, { timeout: 60_000 });
  await expect(page.getByTestId('ready-status')).toHaveText('Raised the lists from version 2 to version 3.');
  await expect(page.getByTestId('lists-version')).toHaveText('The lists are the version this app needs.');
  await shoot(page, `pcoe-v2-${browserName}-note5-raised`);
  expect(fake.item('appsettings', 'default')!.SchemaVersion).toBe(3);

  // 6. Check Lists: every row Ready.
  await lists(page).getByRole('button', { name: 'Check Lists' }).click();
  await expect(page.getByTestId('lists-status')).toHaveText('All list schemas ready. Write permissions have not been tested.');
  await shoot(page, `pcoe-v2-${browserName}-note6-check`);

  // 7. The admin page: guests scan a personal QR; one named guest and their code.
  await page.goto(`${FOLDER_URL}/admin.html`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('radio', { name: /Guests scan a personal QR/ }).check();
  await expect.poll(() => fake.item('sessions', sessionId)?.ParticipationMode).toBe('client-visit');
  await page.getByRole('tab', { name: 'Guests and QR', exact: true }).click();
  await page.getByLabel('Paste names').fill('Jordan Lee');
  await page.getByRole('button', { name: 'Add 1 guest' }).click();
  await expect(page.getByTestId('guest-report')).toHaveText('Added 1 guest.');
  await page.getByRole('button', { name: /^Generate all codes/ }).click();
  await expect.poll(() => fake.lists.get('qrtokens')!.length).toBe(1);
  expect(fake.lists.get('visitorroster')!.map((row) => row.GuestName)).toEqual(['Jordan Lee']);
  const code = String(fake.lists.get('qrtokens')![0].AppId);
  await shoot(page, `pcoe-v2-${browserName}-note7-guest`);

  // 8. The self-test: the fourth probe names the two old DisplayName columns, and nothing of the app.
  await page.goto(`${FOLDER_URL}/setup.html`);
  await selfTest(page, `pcoe-v2-${browserName}`, browserName,
    `Refused when named: ${TITLE.visitorroster}.DisplayName (no longer used since version 3; 400: Value does not fall within the expected range.); ${TITLE.uservisitlogs}.DisplayName (no longer used since version 3; 400: Value does not fall within the expected range.).`);

  // 9. Results: the live session's card loads; the visit of 15 Oct is unnamed (its name is in the old column, which the site will not return).
  await page.goto(`${FOLDER_URL}/admin.html#results`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  const titles = page.locator(`[data-session="${sessionId}"] .row__title`);
  await expect(titles).toHaveText(['Unnamed participant 1'], { timeout: 15_000 });
  await shoot(page, `pcoe-v2-${browserName}-note9-results`);

  // 10. An iPad checks in with the guest's code: Welcome greets the guest by name; one activity to its end; Results names them.
  const context = await browser.newContext({ viewport: { width: 820, height: 1180 } });
  const ipad = await context.newPage();
  await open(ipad, site);
  await ipad.goto(`${FOLDER_URL}/index.html?qr=${code}`);
  await expect(ipad.getByRole('heading', { name: 'Hi Jordan Lee!' })).toBeVisible({ timeout: 15_000 });
  await shoot(ipad, `pcoe-v2-${browserName}-note10-welcome`);
  await ipad.getByRole('button', { name: 'Click here to begin' }).click();
  const pack = samplePack();
  const history = pack.sections.find((section) => section.id === 'sec-dominos-history')!;
  await ipad.getByRole('button', { name: new RegExp(history.title) }).click();
  for (const [index, questionId] of history.questionIds.entries()) {
    const right = pack.options.find((option) => option.questionId === questionId && option.correct)!;
    await ipad.locator('.pms-options button').filter({ hasText: right.label }).first().click();
    await ipad.getByRole('button', { name: index === history.questionIds.length - 1 ? 'Submit' : 'Next', exact: true }).click();
  }
  await expect(ipad.getByText(`${history.questionIds.length} of ${history.questionIds.length} right on the first try`)).toBeVisible({ timeout: 15_000 });
  await context.close();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(titles).toHaveText(['Unnamed participant 1', 'Jordan Lee'], { timeout: 15_000 });
  await shoot(page, `pcoe-v2-${browserName}-note10-results`);
  expect(site.unexpected).toEqual([]);
  expect(fake.strays, 'nothing reached a list that is not this copy\'s').toEqual([]);
  expect(unnamed(fake), 'every item read named its columns').toEqual([]);
});
