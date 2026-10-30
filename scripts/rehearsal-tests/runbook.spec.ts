import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dataService from '../../migration/src/lib/data/dataService.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { SAMPLE_PICTURES } from '../../migration/src/lib/setup/sample-pictures.js';
import { seedSampleClients } from '../../migration/src/lib/setup/sample-seed.js';
import { sha256Hex } from '../../migration/src/lib/admin/sha256.js';
import { FOLDER_URL, SETTINGS_TEXT, SITE, TIMING_CHECK } from '../release-docs.js';
import { PHASE_20_COLUMNS, PHASE_21_COLUMNS, PHASE_21C_COLUMNS, PHASE_21D_COLUMNS, PHASE_21E_COLUMNS, TITLE, createSharePointFake } from '../sharepoint-fake.js';
import { LIBRARY, LISTS, VERSION } from '../../migration/src/lib/schema/pms-schema.js';
import { makePlan, showPlan, siteApi } from '../../migration/src/lib/setup/provision.js';
import { emptyRoom, scrollProblems, tipProblems } from '../migration-tests/results-charts-support.js';

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
// Phase 10j: the fourth rehearsal is a site of version 2 (the 10i note's case, no longer in the runbook: the note's step 3 says what to do if the site
// is still at version 2), and a fifth follows the runbook's note for the PCOE site as it is now: lists brought to version 3 (the old DisplayName columns
// beside the new ones), an admin, the samples, Domino's live and a visit of before the upgrade; the three pages replaced, Setup as it is, the timing
// check run in the participant page after a visit (it must print its table and its summary line), a named guest and a code, the self-test, Results, and
// an iPad that checks in with the code and opens both activities with no read of their questions.
//
// Phase 11a: the fifth rehearsal is the 10j note's case (the timing check before and after), and a sixth follows the runbook's note as it is now: the site
// as pms-0a1c701 left it (lists of version 3, an admin, the samples, Domino's live), the three pages replaced, Setup as it is, a named guest who checks in
// by QR code on an iPad and answers an activity, their name on the bar of the answer they picked in the Live display (and the numbers view), and the wall
// (full screen, and the page "Open in a new tab" opens) with no name in it and Show answer. Full screen runs with the display's own cover, as on an iPad.
//
// Phase 11a-2: the sixth rehearsal follows the note as it is now, which adds a step for the Windows laptop that showed the fault of pms-3fb312a (about
// 1536 x 864): on the wall page and in full screen nothing scrolls inside a card, every tooltip is whole and clear of its label, no headline says "Most
// people" for half or less or ends in two full stops, and cards side by side keep their own heights.
//
//   npm run package:release       (from a clean, committed tree)
//   npm run test:rehearsal        (PMS_PACKAGE=<folder> to rehearse another package)

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SHOTS = path.join(ROOT, 'test-results', 'rehearsal');
const PAGES = ['index.html', 'admin.html', 'setup.html'];
// (Prompt 22: the lists, this build's version and an empty site's plan are read, not typed. Typed out they said 12 lists, version 3 and 89 columns, and
// the sites of version 2 and 3 below lacked every column this build's data layer names since: SINCE_2, kept while their records are written.)
const EVERYTHING = [...Object.keys(LISTS), 'logoLibrary'];
const LIST_COUNT = Object.keys(LISTS).length;
const EMPTY = makePlan({ lists: new Map(), fields: new Map(), reads: 0 }, { ...Object.fromEntries(Object.entries(LISTS).map(([key, list]) => [key, list.title])), logoLibrary: LIBRARY });
const createdWords = (plan: { lists: unknown[]; columns: unknown[]; settings: unknown[] }) => new RegExp(`^Created ${plan.lists.length} lists?, ${plan.columns.length} columns? and ${plan.settings.length} settings? in [\\d.]+ s \\(${plan.lists.length + plan.columns.length + plan.settings.length} writes\\)\\.$`);
const READY_WORDS = `The site is marked ready: every list passed the check, and the settings item of PMSAppSettings now says version ${VERSION}.`;
const SINCE_2 = [...PHASE_20_COLUMNS, ...PHASE_21_COLUMNS, ...PHASE_21C_COLUMNS, ...PHASE_21D_COLUMNS, ...PHASE_21E_COLUMNS];
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

/** Serves the package's pages and its pms-config.txt at the folder's address, the site's REST API from the fake, and the library's files (to one page, or to
 *  every page of a context, so a tab the page opens is served too). */
async function open(page: Page | BrowserContext, site: Site) {
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
  else await expect(section.getByRole('status')).toContainText('Passed: 12 of 12 steps', { timeout: 30_000 }); // (11 until Prompt 21 Phase 7's permission probe)
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
  await expect(copy).toContainText(`PMSClients, PMSClientSessions, ... (${LIST_COUNT}) (no prefix from pms-config.txt)`);
  await expect(copy).toContainText('PMSClientImages');
  await expect(copy).toContainText('PMS (from pms-config.txt)');
  await expect(copy).toContainText(`${path.basename(site.pkg)} (built in)`);
  await shoot(page, `empty-${browserName}-step03-this-copy`);

  // 4. Show the plan. (Phase 10h: Create can be seen.)
  await lists(page).getByRole('button', { name: 'Show the plan' }).click();
  await expect(page.getByTestId('plan-summary')).toHaveText(`${EMPTY.summary}.`);
  expect(await seen(page, 'Create'), 'Create can be seen').toBe(true);
  await shoot(page, `empty-${browserName}-step04-plan`);

  // 5. Create (it marks the site ready by itself when it ends clean).
  await create(page);
  await expect(page.getByTestId('create-progress')).toHaveText(createdWords(EMPTY), { timeout: 90_000 });
  await shoot(page, `empty-${browserName}-step05-create`);

  // 6. Check Lists: every row Ready.
  await lists(page).getByRole('button', { name: 'Check Lists' }).click();
  await expect(page.getByTestId('lists-status')).toHaveText('All list schemas ready. Write permissions have not been tested.');
  await shoot(page, `empty-${browserName}-step06-check`);

  // 7. Mark the site as ready: Create did it already, so pressing it writes nothing.
  await expect(page.getByTestId('ready-status')).toHaveText(READY_WORDS);
  await lists(page).getByRole('button', { name: 'Mark the site as ready' }).click();
  await expect(page.getByTestId('ready-status')).toHaveText(`The site was already marked ready (version ${VERSION}). Nothing was written.`);
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
  await expect(page.getByTestId('ready-status')).toHaveText(READY_WORDS);

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

// (Until Phase 10j this was the runbook's note for the PCOE site. The note is now for that site's lists of version 3, below; its step 3 says what to do on a
// site still at version 2, which is this.)
test('a site of version 2 (the 10i note\'s case): the plan, Create, raised to version 3, a guest and a code, the self-test, Results, and an iPad that checks in by QR', async ({ page, browser, browserName }) => {
  // The site as it was on 15 Oct 2026: lists Setup made for version 2 (with their DisplayName columns), an admin, the sample clients with their pictures,
  // Domino's live and a member of staff's visit logged under DisplayName. The earlier pages' records are stood for by the data layer (the item said 3 while
  // they were written, and says 2 again before the note begins).
  const fake = tenant({ prefix: '', siteUrl: SITE, listsVersion: 2, keepColumns: SINCE_2 });
  fake.add('adminusers', { AppId: 'admin-pcoe', Title: 'Asha Rao', Name: 'Asha Rao', PinHash: sha256Hex(PIN) });
  fake.item('appsettings', 'default')!.SchemaVersion = VERSION;
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
  fake.dropColumns(SINCE_2);
  fake.item('appsettings', 'default')!.SchemaVersion = 2;
  // What Show the plan should say: Setup's own plan of this very site (scripts/test-provision.js holds the plan itself).
  const restoreForPlan = fake.install();
  let expected: Awaited<ReturnType<typeof showPlan>>['plan'];
  try {
    dataService.configure({ sharePoint: fake.settings });
    expected = (await showPlan(siteApi(dataService), dataService.sharePointListTitles())).plan;
  } finally {
    restoreForPlan();
  }
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
  await expect(page.getByTestId('lists-version')).toContainText(`The lists on this site are version 2; this version of the app needs version ${VERSION}.`);
  await expect(page.getByTestId('lists-version')).toContainText(`(PMS-LST-011, SchemaVersion 2, this build needs ${VERSION})`);
  await shoot(page, `pcoe-v2-${browserName}-note2-setup`);

  // 3. Show the plan: the two columns of version 3 and everything since, as Setup plans them; the two old DisplayName columns are harmless.
  await lists(page).getByRole('button', { name: 'Show the plan' }).click();
  await expect(page.getByTestId('plan-summary')).toHaveText(`${expected!.summary}.`);
  await expect(page.locator('[data-testid="plan"] [data-list="visitorroster"]')).toContainText('GuestName');
  await expect(page.locator('[data-testid="plan"] [data-list="uservisitlogs"]')).toContainText('Create 1 column: SignedInName.');
  await expect(page.locator('[data-testid="plan"] [data-harmless="true"]')).toHaveCount(2);
  await shoot(page, `pcoe-v2-${browserName}-note3-plan`);

  // 4 and 5. Create, which ends clean and marks the site as ready by itself: the version is raised.
  await create(page);
  await expect(page.getByTestId('create-progress')).toHaveText(createdWords(expected!), { timeout: 90_000 });
  await expect(page.getByTestId('ready-status')).toHaveText(`Raised the lists from version 2 to version ${VERSION}.`);
  await expect(page.getByTestId('lists-version')).toHaveText('The lists are the version this app needs.');
  await shoot(page, `pcoe-v2-${browserName}-note5-raised`);
  expect(fake.item('appsettings', 'default')!.SchemaVersion).toBe(VERSION);

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
  await expect(titles).toHaveText(['Jordan Lee', 'Unnamed participant 1'], { timeout: 15_000 }); // (newest first since Phase 16: lib/admin/admin-results.js ROW_ORDER)
  await shoot(page, `pcoe-v2-${browserName}-note10-results`);
  expect(site.unexpected).toEqual([]);
  expect(fake.strays, 'nothing reached a list that is not this copy\'s').toEqual([]);
  expect(unnamed(fake), 'every item read named its columns').toEqual([]);
});

test('the 10j note\'s case, the PCOE site of version 3: the pages replaced, Setup as it is, the timing check after a visit, a guest and a code, the self-test, Results, and an iPad whose activities open at once', async ({ page, browser, browserName }) => {
  // The site as it is after pms-da9fc8d on 15 Oct 2026: lists Setup made for version 2 and brought to version 3 (the old DisplayName columns stay beside
  // GuestName and SignedInName), an admin, the sample clients with their pictures, Domino's live, and a visit of before the upgrade whose sign-in name is
  // in the old column. The earlier pages' records are stood for by the data layer.
  // (Prompt 22: since this build needs version ${VERSION}, the site is as Setup leaves it after raising it: every column since version 2 is there.)
  const fake = tenant({ prefix: '', siteUrl: SITE, listsVersion: 2, keepColumns: SINCE_2 });
  for (const [key, name] of [['visitorroster', 'GuestName'], ['uservisitlogs', 'SignedInName']]) fake.fields.get(key)!.push({ ...fake.field(key, 'DisplayName')!, InternalName: name });
  fake.item('appsettings', 'default')!.SchemaVersion = VERSION;
  fake.add('adminusers', { AppId: 'admin-pcoe', Title: 'Asha Rao', Name: 'Asha Rao', PinHash: sha256Hex(PIN) });
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
  const pkg = await packageFolder();
  const site: Site = { fake, pkg, settings: await packageSettings(pkg), unexpected: [], pictures: [] };
  await page.setViewportSize({ width: 1366, height: 900 });
  await open(page, site);
  fake.reset();
  const pack = samplePack();
  const activities = pack.sections.filter((section) => section.clientId === 'c-dominos');

  // (1. The timing check with the pages there now: there are none of them here. 2. The three pages replaced: the package's are served.)
  // 3. Setup shows the new build and says the lists are this app's version: nothing to press, nothing written.
  await page.goto(`${FOLDER_URL}/setup.html`);
  await expect(page.getByRole('region', { name: /This copy of the app/ })).toContainText(`${path.basename(site.pkg)} (built in)`);
  await expect(page.getByTestId('lists-version')).toHaveText('The lists are the version this app needs.');
  await shoot(page, `pcoe-v3-${browserName}-note3-setup`);
  expect(fake.writes(), 'Setup wrote nothing').toEqual([]);

  // 4. The timing check, with these pages: a fresh participant page, a visit begun, one activity to its end, back to the hub; the line in the console.
  const said: { type: string; text: string }[] = [];
  page.on('console', (message) => { said.push({ type: message.type(), text: message.text() }); });
  await page.goto(`${FOLDER_URL}/index.html`);
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  const [history, other] = activities;
  await page.getByRole('button', { name: new RegExp(history.title) }).click();
  for (const [index, questionId] of history.questionIds.entries()) {
    const right = pack.options.find((option) => option.questionId === questionId && option.correct)!;
    await page.locator('.pms-options button').filter({ hasText: right.label }).first().click();
    await page.getByRole('button', { name: index === history.questionIds.length - 1 ? 'Submit' : 'Next', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Back to activities' }).click();
  await expect(page.locator('button.activity')).toHaveCount(activities.length);
  await page.evaluate(TIMING_CHECK);
  await expect.poll(() => said.filter((entry) => entry.type === 'table').length, 'the table').toBe(1);
  const summary = said.find((entry) => entry.text.startsWith('page file '))?.text ?? '';
  expect(summary).toMatch(/^page file \d+ ms, \d+ KB \| requests \d+, median \d+ ms, slowest \d+ ms \| fields reads: \d+ ms, \d+ KB$/);
  await shoot(page, `pcoe-v3-${browserName}-note4-hub`);

  // 5. The admin page: guests scan a personal QR; one named guest and their code.
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
  const code = String(fake.lists.get('qrtokens')![0].AppId);
  await shoot(page, `pcoe-v3-${browserName}-note5-guest`);

  // 6. The self-test: the fourth probe names the two old DisplayName columns, and nothing of the app.
  await page.goto(`${FOLDER_URL}/setup.html`);
  await selfTest(page, `pcoe-v3-${browserName}`, browserName,
    `Refused when named: ${TITLE.visitorroster}.DisplayName (no longer used since version 3; 400: Value does not fall within the expected range.); ${TITLE.uservisitlogs}.DisplayName (no longer used since version 3; 400: Value does not fall within the expected range.).`);

  // 7. Results: the live session's card loads; the visit of before the upgrade is unnamed, the visit of step 4 named by its sign-in.
  await page.goto(`${FOLDER_URL}/admin.html#results`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  const titles = page.locator(`[data-session="${sessionId}"] .row__title`);
  await expect(titles).toHaveText(['Casey Example', 'Unnamed participant 1'], { timeout: 15_000 }); // (newest first since Phase 16)
  await shoot(page, `pcoe-v3-${browserName}-note7-results`);

  // 8. An iPad checks in with the guest's code; one activity to its end, back to the hub, and the other opens at once: no read of its questions.
  const context = await browser.newContext({ viewport: { width: 820, height: 1180 } });
  const ipad = await context.newPage();
  await open(ipad, site);
  await ipad.goto(`${FOLDER_URL}/index.html?qr=${code}`);
  await expect(ipad.getByRole('heading', { name: 'Hi Jordan Lee!' })).toBeVisible({ timeout: 15_000 });
  await ipad.getByRole('button', { name: 'Click here to begin' }).click();
  await ipad.getByRole('button', { name: new RegExp(history.title) }).click();
  for (const [index, questionId] of history.questionIds.entries()) {
    const right = pack.options.find((option) => option.questionId === questionId && option.correct)!;
    await ipad.locator('.pms-options button').filter({ hasText: right.label }).first().click();
    await ipad.getByRole('button', { name: index === history.questionIds.length - 1 ? 'Submit' : 'Next', exact: true }).click();
  }
  await expect(ipad.getByText(`${history.questionIds.length} of ${history.questionIds.length} right on the first try`)).toBeVisible({ timeout: 15_000 });
  await ipad.getByRole('button', { name: 'Back to activities' }).click();
  const mark = fake.requests.length;
  await ipad.getByRole('button', { name: new RegExp(other.title) }).click();
  await expect(ipad.locator('.pms-options button, .pms-grid button').first()).toBeVisible();
  await expect(ipad.getByText('Loading activity...')).toHaveCount(0);
  // (The hub reads every enabled activity's questions behind what it shows, alone or in a $batch, whenever it lands: never the other activity's alone.)
  const read = fake.requests.slice(mark).flatMap((entry) => [entry, ...(entry.parts ?? [])]).filter((entry) => entry.list === 'questions');
  expect(read.filter((entry) => !entry.query.includes(history.questionIds[0])), 'the other activity opened from what the page holds').toEqual([]);
  await shoot(ipad, `pcoe-v3-${browserName}-note8-other`);
  await context.close();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(titles).toHaveText(['Jordan Lee', 'Casey Example', 'Unnamed participant 1'], { timeout: 15_000 }); // (newest first since Phase 16)
  await shoot(page, `pcoe-v3-${browserName}-note8-results`);
  expect(site.unexpected).toEqual([]);
  expect(fake.strays, 'nothing reached a list that is not this copy\'s').toEqual([]);
  expect(unnamed(fake), 'every item read named its columns').toEqual([]);
});

test('the runbook\'s note for the PCOE site (Phase 11a): the pages replaced, Setup as it is, a named guest by QR code on an iPad, their name on the bar they picked, the numbers, and the wall with no names and Show answer', async ({ browser, browserName }) => {
  // The site as pms-0a1c701 left it on 15 Oct 2026: lists of version 3 (the old DisplayName columns beside the new ones), an admin, the sample clients
  // with their pictures, and Domino's live. The earlier pages' records are stood for by the data layer.
  // (Prompt 22: since this build needs version ${VERSION}, the site is as Setup leaves it after raising it: every column since version 2 is there.)
  const fake = tenant({ prefix: '', siteUrl: SITE, listsVersion: 2, keepColumns: SINCE_2 });
  for (const [key, name] of [['visitorroster', 'GuestName'], ['uservisitlogs', 'SignedInName']]) fake.fields.get(key)!.push({ ...fake.field(key, 'DisplayName')!, InternalName: name });
  fake.item('appsettings', 'default')!.SchemaVersion = VERSION;
  fake.add('adminusers', { AppId: 'admin-pcoe', Title: 'Asha Rao', Name: 'Asha Rao', PinHash: sha256Hex(PIN) });
  const restore = fake.install();
  let sessionId = '';
  try {
    dataService.configure({ sharePoint: fake.settings });
    await seedSampleClients(dataService, { siteUrl: SITE, file: async (name: string, type: string) => new Blob([await readFile(path.join(PICTURES, name))], { type }) });
    sessionId = (await dataService.activateClient('c-dominos', TODAY)).session.id;
  } finally {
    restore();
  }
  const pkg = await packageFolder();
  const site: Site = { fake, pkg, settings: await packageSettings(pkg), unexpected: [], pictures: [] };
  // (As on an iPad, where Safari does not put an element in its own full screen: the display's cover is the full screen. The tab opened from the page
  // is served too: the routes are the context's.)
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(() => {
    for (const name of ['requestFullscreen', 'webkitRequestFullscreen']) Object.defineProperty(Element.prototype, name, { value: undefined, configurable: true });
  });
  await open(context, site);
  const page = await context.newPage();
  fake.reset();
  const pack = samplePack();
  const [first] = pack.sections.filter((section) => section.clientId === 'c-dominos');
  const names = () => page.evaluate(() => document.documentElement.outerHTML.includes('Mike A'));

  // (1. The three pages replaced: the package's are served.) 2. Setup shows the new build and says the lists are this app's version: nothing written.
  await page.goto(`${FOLDER_URL}/setup.html`);
  await expect(page.getByRole('region', { name: /This copy of the app/ })).toContainText(`${path.basename(site.pkg)} (built in)`);
  await expect(page.getByTestId('lists-version')).toHaveText('The lists are the version this app needs.');
  await shoot(page, `pcoe-11a-${browserName}-note2-setup`);
  expect(fake.writes(), 'Setup wrote nothing').toEqual([]);

  // 3. A named guest and their code (the admin page), then an iPad that scans it and answers the first activity to its end.
  await page.goto(`${FOLDER_URL}/admin.html`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('radio', { name: /Guests scan a personal QR/ }).check();
  await expect.poll(() => fake.item('sessions', sessionId)?.ParticipationMode).toBe('client-visit');
  await page.getByRole('tab', { name: 'Guests and QR', exact: true }).click();
  await page.getByLabel('Paste names').fill('Mike A');
  await page.getByRole('button', { name: 'Add 1 guest' }).click();
  await expect(page.getByTestId('guest-report')).toHaveText('Added 1 guest.');
  await page.getByRole('button', { name: /^Generate all codes/ }).click();
  await expect.poll(() => fake.lists.get('qrtokens')!.length).toBe(1);
  const code = String(fake.lists.get('qrtokens')![0].AppId);
  const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 } });
  const ipad = await tablet.newPage();
  await open(ipad, site);
  await ipad.goto(`${FOLDER_URL}/index.html?qr=${code}`);
  await expect(ipad.getByRole('heading', { name: 'Hi Mike A!' })).toBeVisible({ timeout: 15_000 });
  await ipad.getByRole('button', { name: 'Click here to begin' }).click();
  await ipad.getByRole('button', { name: new RegExp(first.title) }).click();
  const picked: string[] = [];
  for (const [index, questionId] of first.questionIds.entries()) {
    const right = pack.options.find((option) => option.questionId === questionId && option.correct)!;
    picked.push(right.id);
    await ipad.locator('.pms-options button').filter({ hasText: right.label }).first().click();
    await ipad.getByRole('button', { name: index === first.questionIds.length - 1 ? 'Submit' : 'Next', exact: true }).click();
  }
  await expect(ipad.getByText(`${first.questionIds.length} of ${first.questionIds.length} right on the first try`)).toBeVisible({ timeout: 15_000 });
  await tablet.close();

  // 4. Results, the session's Live display: the bar of the answer the guest picked names them, with the time; the numbers view has the same numbers.
  await page.getByRole('tab', { name: 'Results', exact: true }).click();
  await page.locator(`article[data-session="${sessionId}"]`).getByRole('button', { name: 'Live display' }).click();
  const card = page.locator(`.result-card[data-question="${first.questionIds[0]}"]`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.locator(`[data-mark="${picked[0]}"]`).click();
  const panel = card.getByTestId('names-panel');
  await expect(panel.getByRole('heading')).toHaveText(/^Who picked: .+ \(1 person\)$/);
  await expect(panel.locator('.names__name')).toHaveText(['Mike A']);
  await shoot(page, `pcoe-11a-${browserName}-note4-names`);
  await card.getByRole('button', { name: 'View as table' }).click();
  const label = pack.options.find((option) => option.id === picked[0])!.label;
  await expect(card.locator('tbody tr').filter({ hasText: label })).toContainText(/1\s*100%/);
  await card.getByRole('button', { name: 'View as chart' }).click();

  // 5. Full screen: every question, no name anywhere, and a quiz question's answer marked only after Show answer. Then the page "Open in a new tab" opens.
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(page.locator('section.live')).toHaveAttribute('data-presenting', 'true');
  const total = Number(/of (\d+)/.exec((await page.locator('.live__eyebrow').textContent()) ?? '')?.[1]);
  for (let index = 0; index < total; index += 1) {
    expect(await names(), `full screen, question ${index + 1}: no name`).toBe(false);
    const shown = page.locator('.result-card');
    if (await shown.getByRole('button', { name: 'Show answer' }).count()) {
      await expect(shown.locator('.bars__bar--correct, .split__slice--correct')).toHaveCount(0);
      await shown.getByRole('button', { name: 'Show answer' }).click();
      await expect(shown.locator('.bars__bar--correct, .split__slice--correct')).toHaveCount(1);
    }
    await page.getByRole('button', { name: 'Next question' }).click();
  }
  await shoot(page, `pcoe-11a-${browserName}-note5-fullscreen`);
  await page.keyboard.press('Escape');
  const [tab] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: 'Open in a new tab' }).click()]);
  await tab.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await tab.getByRole('button', { name: 'Unlock' }).click();
  await expect(tab.getByRole('heading', { name: 'Live results · Wall display' })).toBeVisible();
  await expect(tab.locator('.result-card').first()).toBeVisible({ timeout: 15_000 });
  await expect(tab.getByRole('switch', { name: /Names shown/ })).toHaveCount(0);
  await tab.locator(`.result-card[data-question="${first.questionIds[0]}"] [data-mark="${picked[0]}"]`).click();
  expect(await tab.evaluate(() => document.documentElement.outerHTML.includes('Mike A')), 'the wall page: no name').toBe(false);
  await shoot(tab, `pcoe-11a-${browserName}-note5-wall`);

  // 6. (Phase 11a-2) The Windows laptop that showed the fault, about 1536 x 864: on the wall page and in full screen nothing scrolls inside a card, every
  // mark's tooltip is whole, seen at its corners and clear of its label, no headline says "Most people" for half or less or ends in two full stops, and
  // the cards side by side keep their own heights.
  const sentences = async (where: Page) => (await where.locator('.result-card__headline').allTextContents()).filter((text) => /Most people \((?:\d|[1-4]\d|50)%\)|[^.]\.\.$/.test(text));
  const tips = async (where: Page) => {
    const found: string[] = [];
    for (const mark of await where.locator('section.live .result-card [data-mark]').all()) {
      if (await mark.locator('xpath=ancestor::*[contains(@class, "words")]').count()) continue; // a written answer's word is a button with no tooltip
      await mark.hover();
      await where.waitForTimeout(80);
      found.push(...await tipProblems(where, (await mark.getAttribute('data-mark')) ?? ''));
    }
    await where.mouse.move(1, 1);
    return found;
  };
  await tab.setViewportSize({ width: 1536, height: 864 });
  await tab.waitForTimeout(500);
  expect(await scrollProblems(tab), 'the wall page at 1536 x 864: nothing scrolls inside a card').toEqual([]);
  expect(await emptyRoom(tab), 'the wall page: each card keeps its own height').toEqual([]);
  expect(await sentences(tab), 'the wall page: the headlines').toEqual([]);
  expect(await tips(tab), 'the wall page: the tooltips').toEqual([]);
  // (Firefox does not resize a page while another tab of its window is in front: the wall page's tab is closed, and the admin page brought forward.)
  await tab.close();
  await page.bringToFront();
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(page.locator('section.live')).toHaveAttribute('data-presenting', 'true');
  for (let index = 0; index < total; index += 1) {
    await page.waitForTimeout(500);
    expect(await scrollProblems(page), `full screen at 1536 x 864, question ${index + 1}: nothing scrolls inside the card`).toEqual([]);
    expect(await sentences(page), `full screen, question ${index + 1}: the headline`).toEqual([]);
    expect(await tips(page), `full screen, question ${index + 1}: the tooltips`).toEqual([]);
    await page.getByRole('button', { name: 'Next question' }).click();
  }
  await shoot(page, `pcoe-11a2-${browserName}-note6-laptop`);
  await page.keyboard.press('Escape');
  await context.close();
  expect(site.unexpected).toEqual([]);
  expect(fake.strays, 'nothing reached a list that is not this copy\'s').toEqual([]);
  expect(unnamed(fake), 'every item read named its columns').toEqual([]);
});
