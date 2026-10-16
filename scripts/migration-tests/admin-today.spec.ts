import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { freePort } from '../free-port.js';
import { makeImage } from './brand-images.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ds from '../../public/js/dataService.js';
import { localDate } from '../../migration/src/lib/admin-today.js';
import { sharePointFolderPath } from '../deployment-config.js';

// The facilitator's Today and Clients screens, end to end: the BUILT admin and participant pages
// against the REAL local server (server/index.js) on a scratch copy of server/data, one server per
// test so no test inherits another's clients, sessions or answers. What is on screen is what the data
// says. Screenshots go to test-results/admin/ and are looked at, not only taken.

const root = fileURLToPath(new URL('../..', import.meta.url));
const shots = fileURLToPath(new URL('../../test-results/admin/', import.meta.url));
const adminUrl = `${sharePointFolderPath}/admin.html`;
const participantUrl = `${sharePointFolderPath}/index.html`;
const today = localDate();
const PIN = '1234'; // server/data/adminusers.json

type Local = { api: string; dir: string; server: ChildProcess };
let local: Local;

test.beforeEach(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cec-admin-spec-'));
  await cp(path.join(root, 'server', 'data'), dir, { recursive: true });
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(root, 'server', 'index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, UPLOAD_DIR: path.join(dir, 'uploads') }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((resolve, reject) => {
    server.once('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
    server.stdout!.on('data', (chunk) => String(chunk).includes('running') && resolve());
  });
  local = { api: `http://127.0.0.1:${port}`, dir, server };
  ds.configure({ baseUrl: `${local.api}/api` });
  await mkdir(shots, { recursive: true });
});

test.afterEach(async () => {
  local?.server.kill();
  ds.configure({ baseUrl: '/api' });
  await rm(local.dir, { recursive: true, force: true });
});

/** Sends a page's /api requests to this test's server, and keeps a list of them. */
async function useServer(page: Page) {
  const requests: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(`${request.method()} ${url.pathname.replace('/api/', '')}${url.search}`);
    // A page that outlives its test may ask once more after the server has gone: let it fail, not the test.
    const response = await route.fetch({ url: `${local.api}${url.pathname}${url.search}` }).catch(() => null);
    // (A page that is closing may take the answer back before it is delivered: not a failure of the test. admin-local.ts does the same.)
    if (response) await route.fulfill({ response }).catch(() => {});
    else await route.abort().catch(() => {});
  });
  return requests;
}

async function openAdmin(page: Page, tab?: string) {
  await useServer(page);
  await page.goto(adminUrl);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true');
  if (tab) await page.getByRole('tab', { name: tab, exact: true }).click();
}

/** A second admin, or a participant, in a browser of its own. */
async function another(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await useServer(page);
  return { context, page };
}

const goLiveButton = (page: Page) => page.getByRole('button', { name: /^(Go live|Going live\.\.\.|Checking\.\.\.|Already live)$/ });
const check = (page: Page, id: string) => page.locator(`[data-check="${id}"]`);
const pickClient = (page: Page, name: string) => page.getByLabel('Client', { exact: true }).selectOption({ label: name });
const status = (page: Page) => page.locator('section[data-live]');

let sequence = 0;
/** Content as the Content screen makes it: an activity that carries its client, with graded questions. */
async function addActivity(clientId: string, {
  title = 'Basics', enabled = true, questions = [{ prompt: 'Which year was it founded?', options: [['1901', true], ['1950', false]] }],
}: { title?: string; enabled?: boolean; questions?: { prompt: string; type?: string; options: [string, boolean | null][] }[] } = {}) {
  const id = `act-${clientId}-${sequence += 1}`;
  const questionIds: string[] = [];
  for (const [index, question] of questions.entries()) {
    const questionId = `${id}-q${index}`;
    const optionIds: string[] = [];
    for (const [position, [label, correct]] of question.options.entries()) {
      const optionId = `${questionId}-o${position}`;
      await ds.createOption({ id: optionId, questionId, label, value: label, correct });
      optionIds.push(optionId);
    }
    await ds.createQuestion({ id: questionId, sectionId: id, type: question.type ?? 'single-select', prompt: question.prompt, optionIds, order: index });
    questionIds.push(questionId);
  }
  await ds.createSection({ id, title, order: sequence, enabled, industryTags: [], questionIds, clientId, description: '' });
  return id;
}

/** A client in the stored shape the Clients screen writes. */
async function addClient(name: string, extra: Record<string, unknown> = {}) {
  const slug = (ds.slugify as (text: string) => string)(name);
  const id = `c-${slug}`;
  await ds.createClient({ id, name, slug, status: 'active', logoUrl: '', primaryColor: '#045bcc', secondaryColor: '#64748b', createdAt: new Date().toISOString(), themeVersion: 1,
    theme: { version: 1, primary: '#045BCC', accent: null, tokens: {}, assets: { hero: null, logo: null, background: null, tile: null }, copy: { eventTitle: `${name.toUpperCase()} TRIVIA NIGHT`, eventSubtitle: '', welcomeLine: '', logoText: name } }, ...extra });
  return id;
}

const shoot = async (page: Page, name: string, { full = true } = {}) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${shots}${name}.png`, fullPage: full });
};

// ---- The day: create, pick, go live, see it as a participant ---------------------------------------

test('create a client, find it in the Today picker, go live, and a second browser shows its title, theme and activities', async ({ page, browser }) => {
  await openAdmin(page, 'Clients');
  await page.getByRole('button', { name: 'Add client' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Acme Foods');
  await expect(page.getByLabel('Slug', { exact: true })).toHaveValue('acme-foods');
  await expect(page.getByLabel('Event title')).toHaveValue('ACME FOODS TRIVIA NIGHT');
  await page.getByLabel('Subtitle').fill('Fresh ideas since 1901.');
  await page.getByLabel('Welcome line').fill('Welcome to Acme night!');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const row = page.locator('.row').filter({ hasText: 'Acme Foods' });
  await expect(row).toContainText('Active');
  await expect(row).toContainText('0 activities (0 live) · Last live never · acme-foods');
  const stored = await ds.getClient('c-acme-foods');
  expect(stored).toMatchObject({ name: 'Acme Foods', slug: 'acme-foods', status: 'active', themeVersion: 1 });
  expect(stored.theme).toMatchObject({ version: 1, primary: '#045BCC', copy: { eventTitle: 'ACME FOODS TRIVIA NIGHT', eventSubtitle: 'Fresh ideas since 1901.', welcomeLine: 'Welcome to Acme night!', logoText: 'Acme Foods' } });
  expect(stored.theme.tokens['--bg-mid']).toBe('#045BCC');

  // It is in the picker, but it has no activity yet: that is a blocker, and Go live says why.
  await page.getByRole('tab', { name: 'Today' }).click();
  await pickClient(page, 'Acme Foods');
  await expect(goLiveButton(page)).toBeDisabled();
  await expect(check(page, 'activities')).toHaveAttribute('data-level', 'blocker');
  await expect(page.getByTestId('go-live-why')).toContainText('Fix this first: Live activities.');
  await addActivity('c-acme-foods', { title: 'Acme Basics' });
  await page.getByRole('button', { name: 'Re-check' }).click();
  await expect(goLiveButton(page)).toBeEnabled();
  await expect(check(page, 'logo')).toHaveAttribute('data-level', 'warning');
  await expect(check(page, 'one-activity')).toHaveAttribute('data-level', 'warning');

  await goLiveButton(page).click();
  await expect(page.getByText('Verified: participants now see Acme Foods')).toBeVisible();
  await expect(status(page)).toContainText('LIVE');
  await expect(status(page)).toContainText('Acme Foods');
  await expect(status(page)).toContainText(`acme-foods-${today}`);
  await expect(page.getByTestId('participants')).toHaveText('0');
  // The link, its QR image, the participant view and the Live display (the old Master screen, now in the admin page).
  await expect(page.getByRole('textbox', { name: 'Participant link' })).toHaveValue(/\/index\.html$/);
  await expect(page.getByRole('img', { name: 'QR code for the participant link' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open participant view' })).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('button', { name: 'Live display' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Master screen' }), 'the participant page no longer has results to link to').toHaveCount(0);
  expect(await ds.getAppSettings()).toMatchObject({ activeSessionId: `acme-foods-${today}`, activeClientId: 'c-acme-foods' });

  // A browser of its own: the participant page shows that client's words, look and activities.
  const { context, page: guest } = await another(browser);
  await guest.goto(participantUrl);
  await expect(guest.getByText('Welcome to Acme night!', { exact: true })).toBeVisible();
  expect(await guest.evaluate(() => ({ client: document.documentElement.dataset.client, source: document.documentElement.dataset.themeSource, version: document.documentElement.dataset.themeVersion, mid: document.documentElement.style.getPropertyValue('--bg-mid') })))
    .toEqual({ client: 'c-acme-foods', source: 'stored', version: '1', mid: '#045BCC' });
  await expect(guest.locator('.pms-hero-text'), 'no logo file: the name in type').toHaveText('Acme Foods');
  await guest.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(guest.getByRole('heading', { level: 1, name: 'ACME FOODS TRIVIA NIGHT' })).toBeVisible();
  await expect(guest.getByText('Fresh ideas since 1901.')).toBeVisible();
  await expect(guest.locator('button.activity')).toHaveText([/Acme Basics/]);
  await context.close();

  // The new participant is counted on the next refresh, and the client's row says it is live.
  await expect(page.getByTestId('participants')).toHaveText('1', { timeout: 15_000 });
  await page.getByRole('tab', { name: 'Clients' }).click();
  await expect(page.locator('.row').filter({ hasText: 'Acme Foods' })).toContainText('LIVE NOW');
  await expect(page.locator('.row').filter({ hasText: 'Acme Foods' })).toContainText(`Last live ${today}`);
});

test('switching to another client with participants present asks first, says what happens, and a fresh page then shows the new client', async ({ page, browser }) => {
  await ds.activateClient('c-kroger', today);
  const krogerSession = `kroger-${today}`;
  const code = await ds.provisionQrToken('c-kroger', krogerSession);

  // A participant is partway through a Kroger activity, on a page that stays open.
  const { context, page: guest } = await another(browser);
  await guest.goto(participantUrl);
  await guest.getByRole('button', { name: 'Click here to begin' }).click();
  await guest.getByRole('button', { name: "Kroger's History" }).click();
  await guest.locator('.pms-options button').nth(1).click();
  await expect(guest.locator('.pms-options button').nth(1)).toHaveAttribute('data-state', 'correct');
  const [track] = await ds.listClientTracks(krogerSession);
  await expect.poll(async () => (await ds.getParticipantResponses(track.id))?.responses.length ?? 0).toBe(1);

  await openAdmin(page);
  await expect(status(page)).toContainText('Kroger');
  await expect(page.getByTestId('participants')).toHaveText('1');
  await pickClient(page, "Domino's");
  await goLiveButton(page).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: "Switch from Kroger to Domino's?" })).toBeVisible();
  await expect(dialog).toContainText('Kroger is live now with 1 participant.');
  await expect(dialog).toContainText('move on by themselves: within about 25 seconds for someone on Welcome or the Activities hub');
  await expect(dialog).toContainText("Domino's Welcome screen, in that client's colours");
  await expect(dialog).toContainText('Anyone partway through an activity is taken out of it and has to start again from Welcome.');
  await expect(dialog).toContainText('Answers already saved stay in the Kroger session and in its results. Nothing is deleted and that session is not ended.');
  await expect(dialog).toContainText('Visitor codes for Kroger that nobody has scanned yet stop working.');
  await shoot(page, 'today-confirm-dialog-1440x900', { full: false });

  // Cancel changes nothing.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await ds.getAppSettings()).toMatchObject({ activeClientId: 'c-kroger' });
  expect((await ds.getQrToken(code.id)).used).toBe(false);

  // Confirm, and the participant page that was left open does what the dialog said.
  await goLiveButton(page).click();
  await page.getByRole('dialog').getByRole('button', { name: "Switch to Domino's" }).click();
  await expect(page.getByText("Verified: participants now see Domino's")).toBeVisible();
  await expect(status(page)).toContainText("Domino's");
  await expect(status(page)).toContainText('0');
  await expect(guest.getByText("Welcome to the Domino's experience.", { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(guest.getByText(/Your facilitator changed the active session/)).toBeVisible();
  await expect(guest.getByRole('heading', { name: /question|first store/i }), 'taken out of the Kroger activity').toHaveCount(0);

  // What the dialog said about the data: nothing deleted, Kroger's session not ended, an unscanned code retired.
  expect((await ds.getParticipantResponses(track.id))?.responses).toHaveLength(1);
  expect((await ds.getSession(krogerSession)).status).toBe('in-progress');
  expect(await ds.listClientTracks(krogerSession)).toHaveLength(1);
  expect(await ds.getQrToken(code.id)).toMatchObject({ used: true });
  expect((await ds.getQrToken(code.id)).expiredAt).toBeTruthy();
  await context.close();

  // A fresh page shows the new client.
  const fresh = await another(browser);
  await fresh.page.goto(participantUrl);
  await expect(fresh.page.getByText("Welcome to the Domino's experience.", { exact: true })).toBeVisible();
  await expect(fresh.page.getByText(/Kroger/)).toHaveCount(0);
  await fresh.context.close();
});

test('a double click and a second admin at the same moment make exactly one session and one AppSettings result', async ({ page, browser }) => {
  const requests = await useServer(page);
  await page.goto(adminUrl);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await pickClient(page, 'Kroger');
  const second = await another(browser);
  await second.page.goto(adminUrl);
  await second.page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await second.page.getByRole('button', { name: 'Unlock' }).click();
  await pickClient(second.page, 'Kroger');
  await expect(goLiveButton(page)).toBeEnabled();
  await expect(goLiveButton(second.page)).toBeEnabled();

  await Promise.all([goLiveButton(page).dblclick(), goLiveButton(second.page).click()]);
  await expect(page.getByText('Verified: participants now see Kroger')).toBeVisible();
  await expect(second.page.getByText('Verified: participants now see Kroger')).toBeVisible();
  const sessions = (await ds.listSessions()).filter((session: { clientId: string }) => session.clientId === 'c-kroger');
  expect(sessions.filter((session: { id: string }) => session.id === `kroger-${today}`)).toHaveLength(1);
  expect(await (await fetch(`${local.api}/api/appsettings`)).json()).toHaveLength(1);
  expect(await ds.getAppSettings()).toMatchObject({ activeSessionId: `kroger-${today}`, activeClientId: 'c-kroger' });
  // The double click on one page was one call: that page tried to create the session at most once.
  expect(requests.filter((entry) => entry.startsWith('POST sessions')).length).toBeLessThanOrEqual(1);
  await second.context.close();
});

// ---- Readiness --------------------------------------------------------------------------------------

test('each readiness blocker disables Go live and says why; each warning shows and still allows it', async ({ page }) => {
  // A client for each rule, made through the API so the page can be asked about all of them.
  const bare = await addClient('Bare Co'); // no activity at all
  const noOptions = await addClient('No Options Co', { logoUrl: '/assets/x.png' });
  await addActivity(noOptions, { questions: [{ prompt: 'A question with no answers', options: [] }, { prompt: 'Another', options: [['Yes', true], ['No', false]] }] });
  await addActivity(noOptions, { title: 'Second' });
  const noCorrect = await addClient('No Correct Co', { logoUrl: '/assets/x.png' });
  await addActivity(noCorrect, { questions: [{ prompt: 'Which one is right?', options: [['A', false], ['B', false]] }] });
  await addActivity(noCorrect, { title: 'Second' });
  const warn = await addClient('Warn Co'); // no logo, one activity
  await addActivity(warn);
  expect([bare, noOptions, noCorrect, warn]).toHaveLength(4);

  await openAdmin(page);
  const go = goLiveButton(page);
  const level = async (id: string) => check(page, id).getAttribute('data-level');

  await pickClient(page, 'Bare Co');
  await expect(go).toBeDisabled();
  await expect(check(page, 'activities')).toHaveAttribute('data-level', 'blocker');
  await expect(check(page, 'activities')).toContainText('Bare Co has no activities.');
  await expect(check(page, 'activities')).toContainText('Add activities under Content');
  await expect(page.getByTestId('readiness-summary')).toContainText('1 blocker');

  await pickClient(page, 'No Options Co');
  await expect(go).toBeDisabled();
  await expect(check(page, 'no-options')).toHaveAttribute('data-level', 'blocker');
  await expect(check(page, 'no-options')).toContainText('"A question with no answers" (Basics) has no answer options.');
  await expect(page.getByTestId('go-live-why')).toContainText('Fix this first: Answer options.');

  await pickClient(page, 'No Correct Co');
  await expect(go).toBeDisabled();
  await expect(check(page, 'no-correct')).toHaveAttribute('data-level', 'blocker');
  await expect(check(page, 'no-correct')).toContainText('is marked as graded but no answer is marked correct');

  // A warning shows, and does not stop Go live.
  await pickClient(page, 'Warn Co');
  await expect(go).toBeEnabled();
  expect(await level('logo')).toBe('warning');
  expect(await level('one-activity')).toBe('warning');
  // Phase 9b (DI-1): a session that does not exist yet is made in staff mode, so its reminder is the third warning (it was 2 before).
  expect(await level('staff-signin')).toBe('warning');
  await expect(page.getByTestId('readiness-summary')).toContainText('Ready to go live, with 3 warnings');
  await expect(page.getByTestId('go-live-why')).toHaveCount(0);
  await shoot(page, 'today-blockers-1440x900');

  // A date that is not today: a warning too. Another client the same day: a warning.
  const tomorrow = localDate(new Date(Date.now() + 86_400_000));
  await page.getByLabel('Date').fill(tomorrow);
  await expect(check(page, 'date')).toHaveAttribute('data-level', 'warning');
  await expect(check(page, 'date')).toContainText(`${tomorrow} is not today (${today})`);
  await ds.createSession({ id: `kroger-${tomorrow}`, clientId: 'c-kroger', date: tomorrow, sectionIds: [], status: 'not-started', activityFlow: 'sequential', participationMode: 'staff' });
  await page.getByRole('button', { name: 'Re-check' }).click();
  await expect(check(page, 'same-date')).toContainText(`Kroger already has a session on ${tomorrow}.`);
  await expect(go).toBeEnabled();
  await go.click();
  await expect(page.getByText('Verified: participants now see Warn Co')).toBeVisible();

  // Phase 9b (DI-1): the live session is in staff mode, so the rule is on the screen beside "How people are identified" ...
  const staffWarning = page.getByTestId('staff-mode-warning');
  await expect(staffWarning).toHaveText("Staff mode: every person needs their own sign-in. iPads that share one sign-in must use Guests scan a personal QR, or two people's answers will be mixed.");
  await expect(check(page, 'staff-signin')).toHaveAttribute('data-level', 'warning');
  await expect(go, 'a warning never blocks').toHaveText('Already live');

  // Guests on, nobody added: a warning, after the client is live.
  await page.getByRole('radio', { name: /Guests scan a personal QR/ }).check();
  await expect(page.locator('.toast')).toContainText('Guests now scan a personal QR');
  await expect(check(page, 'guests')).toHaveAttribute('data-level', 'warning');
  await expect(check(page, 'guests')).toContainText('no guests are added');
  // ... and in guest mode it is gone from both places.
  await expect(staffWarning).toHaveCount(0);
  await expect(check(page, 'staff-signin')).toHaveCount(0);
  await expect(page.getByText('own sign-in')).toHaveCount(0);
  page.once('dialog', (dialog) => dialog.accept()); // "Switch to staff sign-in? Guest QR codes that nobody has scanned yet will stop working."
  await page.getByRole('radio', { name: /Staff sign in/ }).check();
  await expect(staffWarning).toBeVisible();
  await page.getByRole('radio', { name: /Guests scan a personal QR/ }).check();
  await expect(staffWarning).toHaveCount(0);

  // A client archived by someone else after this page loaded: a blocker, and Go live refuses.
  await pickClient(page, 'Bare Co');
  await ds.updateClient(bare, { status: 'archived' });
  await page.getByRole('button', { name: 'Re-check' }).click();
  await expect(check(page, 'client')).toHaveAttribute('data-level', 'blocker');
  await expect(check(page, 'client')).toContainText('Bare Co is archived.');
  await expect(go).toBeDisabled();

  // A session that has ended for that day: a blocker with Reopen beside it.
  await pickClient(page, 'Warn Co');
  await page.getByRole('button', { name: 'Re-check' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'End session' }).click();
  await expect(status(page)).toContainText('NOT LIVE');
  await page.getByRole('button', { name: 'Re-check' }).click();
  await expect(check(page, 'session-ended')).toHaveAttribute('data-level', 'blocker');
  await expect(go).toBeDisabled();
  await check(page, 'session-ended').getByRole('button', { name: 'Reopen session' }).click();
  await expect(check(page, 'session-ended')).toHaveCount(0);
  await expect(status(page)).toContainText('LIVE');
});

// ---- Clients: archive, restore, slugs ---------------------------------------------------------------

test('an archived client is not selectable on Today, a live client cannot be archived, and restoring brings it back', async ({ page }) => {
  await openAdmin(page, 'Clients');
  const dominos = page.locator('.row').filter({ hasText: "Domino's" });
  page.once('dialog', (dialog) => dialog.accept());
  await dominos.getByRole('button', { name: 'Archive' }).click();
  await expect(dominos).toContainText('Archived');
  expect((await ds.getClient('c-dominos')).status).toBe('archived');
  await expect(dominos.getByRole('button', { name: 'Generate QR' })).toBeDisabled();
  await page.getByRole('tab', { name: 'Today' }).click();
  await expect(page.getByLabel('Client', { exact: true }).locator('option')).toHaveText(['Kroger']);
  // The server refuses it as well, whatever the page says.
  await expect(ds.activateClient('c-dominos', today)).rejects.toMatchObject({ code: 'client-archived' });
  await page.getByRole('tab', { name: 'Clients' }).click();
  await dominos.getByRole('button', { name: 'Restore' }).click();
  await expect(dominos).toContainText('Active');
  await page.getByRole('tab', { name: 'Today' }).click();
  await expect(page.getByLabel('Client', { exact: true }).locator('option')).toHaveText(["Domino's", 'Kroger']);

  // A live client has no Archive button to press, and if it goes live after the page loaded, the click is refused.
  await pickClient(page, 'Kroger');
  await goLiveButton(page).click();
  await expect(page.getByText('Verified: participants now see Kroger')).toBeVisible();
  await page.getByRole('tab', { name: 'Clients' }).click();
  const kroger = page.locator('.row').filter({ hasText: 'Kroger' });
  await expect(kroger).toContainText('LIVE NOW');
  await expect(kroger.getByRole('button', { name: 'Archive' })).toBeDisabled();
  await page.getByRole('tab', { name: 'Today' }).click();
  await pickClient(page, "Domino's");
  await goLiveButton(page).click();
  await expect(page.getByText("Verified: participants now see Domino's")).toBeVisible();
  await page.getByRole('tab', { name: 'Clients' }).click();
  await expect(dominos.getByRole('button', { name: 'Archive' })).toBeDisabled();
  // Another admin makes Kroger live behind this page's back: the page still thinks it is not.
  await ds.activateClient('c-kroger', today);
  await expect(kroger.getByRole('button', { name: 'Archive' })).toBeEnabled();
  page.once('dialog', (dialog) => dialog.accept());
  await kroger.getByRole('button', { name: 'Archive' }).click();
  await expect(page.locator('.toast')).toContainText('Kroger is live now.');
  expect((await ds.getClient('c-kroger')).status).toBe('active');
});

test('slugs: made from the name, a to z and hyphens only, unique, and locked once a session exists', async ({ page }) => {
  await ds.activateClient('c-kroger', today); // Kroger now has a session
  await openAdmin(page, 'Clients');
  await page.getByRole('button', { name: 'Add client' }).click();
  const name = page.getByLabel('Name', { exact: true });
  const slug = page.getByLabel('Slug', { exact: true });
  await name.fill("Domino's Pizza!");
  await expect(slug).toHaveValue('dominos-pizza');
  // Typing in the slug stops it following the name.
  await slug.fill('Bad Slug');
  await expect(page.locator('#slug-help')).toContainText('Use a to z, 0 to 9 and hyphens');
  await name.fill('Something Else');
  await expect(slug).toHaveValue('Bad Slug');
  await slug.fill('kroger');
  await expect(page.locator('#slug-help')).toContainText('Kroger already uses this slug.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Kroger already uses this slug.');
  expect((await ds.listClients()).map((client: { id: string }) => client.id)).not.toContain('c-kroger-2');
  for (const [typed, message] of [['-start', /Use a to z/], ['two--hyphens', /Use a to z/], ['under_score', /Use a to z/], ['x'.repeat(41), /40 characters/]] as const) {
    await slug.fill(typed);
    await expect(page.locator('#slug-help')).toContainText(message);
  }
  await slug.fill('something-else');
  await expect(page.locator('#slug-help')).toContainText('Session ids are the slug and the date');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.row').filter({ hasText: 'Something Else' })).toContainText('something-else');
  // Two admins adding the same slug together: the second is refused by the unique id, not by luck.
  await expect(ds.createClient({ id: 'c-something-else', name: 'Again', slug: 'something-else' })).rejects.toMatchObject({ status: 409 });

  // A client with a session has its slug locked; one without can still change it, and an edit bumps ThemeVersion.
  const kroger = page.locator('.row').filter({ hasText: 'Kroger' });
  await kroger.getByRole('button', { name: 'Edit' }).click();
  await expect(slug).toBeDisabled();
  await expect(page.locator('#slug-help')).toContainText('Locked: this client already has sessions');
  await page.getByLabel('Event title').fill('KROGER NIGHT');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(kroger).toBeVisible();
  const edited = await ds.getClient('c-kroger');
  expect(edited).toMatchObject({ slug: 'kroger', themeVersion: 2 });
  expect(edited.theme).toMatchObject({ version: 2, copy: { eventTitle: 'KROGER NIGHT' } });
  expect(edited.theme.copy.eventSubtitle, 'the words it did not touch stayed').toBe("Celebrating 140+ years of Kroger's history and the people who built them.");
  expect(edited.theme.tokens['--action'], 'and so did its palette').toBe('#296CD4');
  const fresh = page.locator('.row').filter({ hasText: 'Something Else' });
  await fresh.getByRole('button', { name: 'Edit' }).click();
  await expect(slug).toBeEnabled();
  await slug.fill('something-new');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.row').filter({ hasText: 'something-new' })).toBeVisible();
  expect((await ds.getClient('c-something-else')).slug).toBe('something-new');
});

// ---- Every capability of the old tabs is still reachable --------------------------------------------

test.describe('capabilities that moved', () => {
  test('active session: Go live picks a client and date; any other session is made live from All sessions', async ({ page }) => {
    await openAdmin(page);
    await page.getByText(/^All sessions/).click();
    // The seed's own session (made before ids were <slug>-<date>) is listed, and can be made live.
    await expect(page.locator('.row').filter({ hasText: 's-kroger-kickoff' })).toContainText('Kroger · 2026-09-18');
    await page.locator('.row').filter({ hasText: 's-kroger-kickoff' }).getByRole('button', { name: 'Make live' }).click();
    await expect(page.getByText('Verified: participants now see Kroger')).toBeVisible();
    expect(await ds.getAppSettings()).toMatchObject({ activeSessionId: 's-kroger-kickoff', activeClientId: 'c-kroger' });
    await expect(status(page)).toContainText('s-kroger-kickoff');
    expect((await ds.getLiveExperience()).status).toBe('live');
  });

  test('visit mode, activity flow, end and reopen are controls on Today', async ({ page, browser }) => {
    await ds.activateClient('c-kroger', today);
    await openAdmin(page);
    await page.getByRole('radio', { name: /Guests scan a personal QR/ }).check();
    await expect.poll(async () => (await ds.getSession(`kroger-${today}`)).participationMode).toBe('client-visit');
    await page.getByRole('radio', { name: /^Open/ }).check();
    await expect.poll(async () => (await ds.getSession(`kroger-${today}`)).activityFlow).toBe('open');
    // Back to staff: guest codes nobody scanned stop working, so it asks.
    page.once('dialog', (dialog) => { expect(dialog.message()).toContain('Guest QR codes that nobody has scanned yet will stop working'); void dialog.accept(); });
    await page.getByRole('radio', { name: /Staff sign in/ }).check();
    await expect.poll(async () => (await ds.getSession(`kroger-${today}`)).participationMode).toBe('staff');

    // End session: participants are told, by themselves, at their next check; Reopen brings it back.
    const guest = await another(browser);
    await guest.page.goto(participantUrl);
    await expect(guest.page.getByText('Welcome to the Kroger experience.', { exact: true })).toBeVisible();
    page.once('dialog', (dialog) => { expect(dialog.message()).toContain('End the Kroger session?'); void dialog.accept(); });
    await page.getByRole('button', { name: 'End session' }).click();
    await expect(status(page)).toContainText('NOT LIVE');
    await expect(status(page)).toContainText('The Kroger session has ended');
    expect((await ds.getSession(`kroger-${today}`)).status).toBe('completed');
    // The page that was open notices by itself (the local server is checked every 3 seconds; SharePoint every 20), and a reloaded one says the same.
    const ended = guest.page.getByRole('heading', { name: 'This session has ended.' });
    await expect(ended).toBeVisible({ timeout: 12_000 });
    await expect(guest.page.getByText('Thank you. Your answers are saved.')).toBeVisible();
    await guest.page.reload();
    await expect(ended).toBeVisible();
    await page.getByRole('region', { name: 'Controls' }).getByRole('button', { name: 'Reopen session' }).click();
    await expect(status(page)).toContainText('LIVE');
    // And Reopen brings the page back to Welcome, again by itself.
    await expect(guest.page.getByText('Welcome to the Kroger experience.', { exact: true })).toBeVisible({ timeout: 12_000 });
    await expect(page.getByRole('button', { name: 'End session' })).toBeVisible();
    expect((await ds.getSession(`kroger-${today}`)).status).toBe('not-started');
    await guest.context.close();
  });

  test('Guests and QR: the roster, a code for each guest, replacing and disabling, and recent entries', async ({ page }) => {
    await ds.activateClient('c-kroger', today);
    await ds.setSessionParticipationMode(`kroger-${today}`, 'client-visit');
    await ds.recordUserVisit({ id: 'visit-1', sessionId: `kroger-${today}`, clientId: 'c-kroger', entryMode: 'client-visit', visitorName: 'Earlier Guest', visitedAt: new Date().toISOString() });
    await openAdmin(page, 'Guests and QR');
    await expect(page.getByText(/Live session: Kroger/)).toBeVisible();
    await page.getByRole('textbox', { name: 'Visitor name' }).fill('Jordan Lee');
    await page.getByRole('button', { name: 'Add visitor' }).click();
    const guest = page.getByRole('listitem').filter({ hasText: 'Jordan Lee' });
    await expect(guest).toContainText('No code');
    await guest.getByRole('button', { name: 'Generate QR' }).click();
    await expect(page.getByRole('img', { name: /Single-use check-in QR code for Jordan Lee/ })).toBeVisible();
    await expect(guest).toContainText('Not scanned');
    const before = (await ds.listQrTokens()).length;
    const first = (await ds.listQrTokens()).at(-1);
    await guest.getByRole('button', { name: 'Replace code' }).click();
    await expect.poll(async () => (await ds.listQrTokens()).length).toBe(before + 1);
    expect((await ds.getQrToken(first.id)).used, 'the replaced code no longer works').toBe(true);
    await guest.getByRole('button', { name: 'Disable' }).click();
    await expect(guest).toContainText('Disabled');
    await expect(page.getByRole('heading', { name: 'Recent app entries' })).toBeVisible();
    await expect(page.getByText('Earlier Guest')).toBeVisible();
    // With staff sign-in on, the roster steps aside and points to Today.
    await ds.setSessionParticipationMode(`kroger-${today}`, 'staff');
    await page.getByRole('tab', { name: 'Today' }).click();
    await page.getByRole('tab', { name: 'Guests and QR' }).click();
    await expect(page.getByText(/Staff sign in is on/)).toBeVisible();
    await page.getByRole('button', { name: 'Open Today' }).click();
    await expect(page.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true');
  });

  test('Results: each iPad, the live tally, the Live display, and restarting one track', async ({ page, browser }) => {
    const session = (await ds.activateClient('c-kroger', today)).session;
    const guest = await another(browser);
    await guest.page.goto(participantUrl);
    await guest.page.getByRole('button', { name: 'Click here to begin' }).click();
    await guest.page.getByRole('button', { name: "Kroger's History" }).click();
    await guest.page.locator('.pms-options button').nth(1).click();
    await expect(guest.page.locator('.pms-options button').nth(1)).toHaveAttribute('data-state', 'correct');
    const [track] = await ds.listClientTracks(session.id);
    await expect.poll(async () => (await ds.getParticipantResponses(track.id))?.responses.length ?? 0).toBe(1);
    await openAdmin(page, 'Results');
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeVisible();
    const card = page.locator(`article[data-session="${session.id}"]`);
    // The card's Live display (it was the Master screen link, opening the participant page) opens in this page, and Back returns here.
    await card.getByRole('button', { name: 'Live display' }).click();
    await expect(page.getByRole('heading', { name: 'Live results' })).toBeVisible();
    await expect(page.locator('.live__meta')).toContainText('1 answer from 1 iPad');
    await page.getByRole('button', { name: '← Results' }).click();
    await expect(card).toContainText('1 of');
    await card.locator('summary').click();
    await expect(card.getByText(/1 answer from 1 iPad\b/)).toBeVisible();
    await expect(card.getByRole('button', { name: 'End session' }), 'ending a session is on Today').toHaveCount(0);
    await card.getByRole('button', { name: 'Restart...' }).click();
    await page.getByText('The very beginning').click();
    await page.getByRole('button', { name: 'Restart', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('restarted · 1 answers removed');
    expect((await ds.getParticipantResponses(track.id))?.responses ?? []).toHaveLength(0);
    await guest.context.close();
  });

  test('Clients: a check-in code for iPads, logo upload, and delete protection', async ({ page }) => {
    // Phase 10c-2a: the visits and the QR codes are read by session, never as whole lists (which only grow).
    const wholeLists: string[] = [];
    page.on('request', (request) => { const url = new URL(request.url()); if (request.method() === 'GET' && /\/api\/(qrtokens|tracks)$/.test(url.pathname) && !url.search) wholeLists.push(url.pathname); });
    await openAdmin(page, 'Clients');
    const kroger = page.locator('.row').filter({ hasText: 'Kroger' });
    // Not live yet: the code needs the live session, and says so.
    await kroger.getByRole('button', { name: 'Generate QR' }).click();
    await expect(page.locator('.toast')).toContainText('Kroger is not live. Go live with it on Today first');
    await ds.activateClient('c-kroger', today);
    await kroger.getByRole('button', { name: 'Generate QR' }).click();
    await expect(page.getByRole('img', { name: 'QR code that checks an iPad in' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Check-in link' })).toHaveValue(/\/index\.html\?qr=/);
    const had = (await ds.listQrTokens()).length;
    await page.getByRole('button', { name: 'New code' }).click();
    await expect.poll(async () => (await ds.listQrTokens()).length).toBe(had + 1);
    // The codes listed are this session's two: the one that was showing and the new one, newest first.
    await expect(page.locator('.qr-editor .rows--flat .row')).toHaveCount(2);
    await expect(page.locator('.qr-editor .rows--flat .row').first()).toContainText('(showing)');
    await page.getByRole('button', { name: 'Done' }).click();
    // Delete protection: a client with activities and sessions is not deleted, and one that is live is said to be live. That comes from
    // what is live (AppSettings); the legacy look's one item ("the active theme") is not asked for.
    const themeAsked: string[] = [];
    page.on('request', (request) => { if (/\/api\/theme\b/.test(request.url())) themeAsked.push(request.url()); });
    await kroger.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.toast')).toContainText("Can't delete Kroger: it's used by a session, a client track, a QR token, today's live session");
    await expect(page.locator('.toast')).not.toContainText('the active theme');
    expect(themeAsked).toEqual([]);
    expect(await ds.getClient('c-kroger')).toBeTruthy();
    // Logo upload (it moved from the Clients form to Brand Studio's Client logo, which also keeps Clients.LogoUrl in step for the legacy app).
    const dominos = page.locator('.row').filter({ hasText: "Domino's" });
    await dominos.getByRole('button', { name: 'Brand: Domino\'s' }).click();
    await page.locator('section.asset[data-slot="logo"] input[type="file"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: await makeImage(page, { width: 900, height: 450, type: 'image/png', paint: 'logo' }) });
    await page.getByRole('dialog', { name: /Crop and fit/ }).getByRole('button', { name: 'Use this picture' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await ds.getClient('c-dominos')).logoUrl).toMatch(/^\/assets\/images\/clients\/dominos-logo-[0-9a-f]{10}\.(webp|png)$/);
    await expect(page.getByTestId('brand-status')).toHaveText('All changes saved');
    await page.getByRole('button', { name: '← Clients' }).click();
    // A client nothing refers to is deleted after a confirmation.
    const spare = await addClient('Spare Co');
    await page.getByRole('tab', { name: 'Today' }).click();
    await page.getByRole('tab', { name: 'Clients' }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('.row').filter({ hasText: 'Spare Co' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.row').filter({ hasText: 'Spare Co' })).toHaveCount(0);
    expect(await ds.getClient(spare)).toBeNull();
    expect(wholeLists, 'no whole list of visits or codes was read').toEqual([]);
  });

  test('Content opens with the activities and their live switches, and the PIN gate still guards the page', async ({ page }) => {
    await useServer(page);
    await page.goto(adminUrl);
    await expect(page.getByText('The PIN gates navigation only. SharePoint permissions control data access.')).toBeVisible();
    await page.getByRole('textbox', { name: 'PIN' }).fill('0000');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('alert')).toContainText('Incorrect PIN');
    await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('tab')).toHaveText(['Today', 'Clients', 'Content', 'Guests and QR', 'Results']);
    await page.getByRole('tab', { name: 'Content' }).click();
    await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible();
    await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Kroger' });
    await expect(page.getByRole('checkbox', { name: "Set Kroger's History live" })).toBeChecked();
    await page.getByRole('button', { name: 'Lock' }).click();
    await expect(page.getByRole('textbox', { name: 'PIN' })).toBeVisible();
  });
});

// ---- Layout, keyboard and screenshots ---------------------------------------------------------------

const viewports = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const;

async function expectFits(page: Page, label: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label}: no horizontal page scroll`).toBe(true);
  const small = await page.evaluate(() => {
    const clickable = [...document.querySelectorAll<HTMLElement>('button, a[href], select, input:not([type="hidden"]):not([type="file"]), textarea, summary, [role="tab"]')];
    return clickable
      // A check box, radio or switch is operated through its label; a hidden input is not a target at all.
      .map((element) => (element.matches('input[type="radio"], input[type="checkbox"]') ? element.closest('label') ?? element : element))
      .filter((element, index, all) => all.indexOf(element) === index)
      .map((element) => ({ name: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 32), box: element.getBoundingClientRect(), hidden: getComputedStyle(element).visibility === 'hidden' }))
      .filter(({ box, hidden }) => !hidden && box.width > 2 && box.height > 2 && (box.width < 43.5 || box.height < 43.5))
      .map(({ name, box }) => `${name}: ${Math.round(box.width)}x${Math.round(box.height)}`);
  });
  expect(small, `${label}: targets under 44px`).toEqual([]);
}

test('the admin fits 390, 820 and 1440 wide on every tab: no sideways scroll, 44px targets, and screenshots', async ({ page, browser }) => {
  test.setTimeout(120_000);
  // A client with problems, so the blockers screen has something to show; Kroger live with a guest in the roster.
  const blocked = await addClient('Acme Foods');
  await addActivity(blocked, { questions: [{ prompt: 'A question with no answers', options: [] }, { prompt: 'Which one is right?', options: [['A', false], ['B', false]] }] });
  const { session } = await ds.activateClient('c-kroger', today);
  await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger');
  await ds.setSessionParticipationMode(session.id, 'client-visit');
  const visitor = await ds.createVisitor({ sessionId: session.id, displayName: 'Jordan Lee', enabled: true });
  // The guest scans their code, which is what puts their name on the visit.
  const code = await ds.provisionQrToken('c-kroger', session.id, { visitorId: visitor.id });
  await (await ds.openQrScan(code.id)).claim();

  for (const size of viewports) {
    const tag = `${size.width}x${size.height}`;
    await page.setViewportSize(size);
    await openAdmin(page);
    await expect(status(page)).toContainText('LIVE');
    await expect(page.getByTestId('participants')).toHaveText('2');
    await expectFits(page, `Today (live) at ${tag}`);
    await shoot(page, `today-live-${tag}`);
    await pickClient(page, 'Acme Foods');
    await expect(goLiveButton(page)).toBeDisabled();
    await expect(page.getByTestId('go-live-why')).toBeVisible();
    await expectFits(page, `Today (blockers) at ${tag}`);
    await shoot(page, `today-blockers-${tag}`);
    for (const tab of ['Clients', 'Content', 'Guests and QR', 'Results']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect(page.getByRole('heading', { name: tab, exact: true }).first()).toBeVisible();
      await page.waitForTimeout(150);
      await expectFits(page, `${tab} at ${tag}`);
      if (tab === 'Clients') {
        await page.getByRole('button', { name: 'Add client' }).click();
        await expectFits(page, `Clients, add form at ${tag}`);
        await page.getByLabel('Name', { exact: true }).fill('Brightside Grocers');
        await shoot(page, `clients-${tag}`);
        await page.getByRole('button', { name: 'Cancel' }).click();
      }
      if (tab === 'Guests and QR') await shoot(page, `guests-${tag}`);
    }
    // The tab the page is on is visible in the row, however far it scrolled.
    expect(await page.getByRole('tab', { name: 'Results' }).evaluate((tab) => { const box = tab.getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth; })).toBe(true);
  }

  // Not live, at each width.
  await ds.endSession(session.id);
  for (const size of viewports) {
    await page.setViewportSize(size);
    await openAdmin(page);
    await expect(status(page)).toContainText('NOT LIVE');
    await expectFits(page, `Today (not live) at ${size.width}`);
    await shoot(page, `today-not-live-${size.width}x${size.height}`);
  }
  // The confirmation, at each width: Domino's is live with a participant, and Kroger (reopened) is the client to switch to.
  await ds.reopenSession(session.id);
  await ds.activateClient('c-dominos', today);
  await ds.beginVisit(crypto.randomUUID(), `dominos-${today}`, 'c-dominos');
  for (const size of viewports) {
    await page.setViewportSize(size);
    await openAdmin(page);
    await expect(page.getByTestId('participants')).toHaveText('1');
    await pickClient(page, 'Kroger');
    await goLiveButton(page).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectFits(page, `confirmation at ${size.width}`);
    expect(await page.getByRole('dialog').evaluate((dialog) => { const box = dialog.getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight; })).toBe(true);
    await shoot(page, `today-confirm-dialog-${size.width}x${size.height}`, { full: false });
    await page.getByRole('button', { name: 'Cancel' }).click();
  }
  expect(browser).toBeTruthy();
});

test('keyboard: the tab row is one stop with arrows, every control shows the green ring, and Enter on Go live works', async ({ page }) => {
  await ds.activateClient('c-kroger', today);
  await openAdmin(page);
  await expect(status(page)).toContainText('LIVE');
  // Tab order: Lock, the tab row (one stop), the panel, then the page in reading order.
  const order: string[] = [];
  const rings: string[] = [];
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  for (let step = 0; step < 14; step += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      const style = getComputedStyle(element);
      return {
        name: (element.getAttribute('aria-label') || element.getAttribute('aria-controls') || element.textContent?.trim() || element.id || `${element.tagName} ${element.getAttribute('type') ?? ''}`).replace(/\s+/g, ' ').slice(0, 28),
        outline: `${style.outlineStyle} ${style.outlineWidth}`, halo: style.boxShadow !== 'none', role: element.getAttribute('role') ?? element.tagName.toLowerCase(),
      };
    });
    order.push(`${focused.role}:${focused.name}`);
    if (focused.outline !== 'solid 3px' || !focused.halo) rings.push(`${focused.role}:${focused.name} ${focused.outline}`);
  }
  expect(rings, 'every stop draws the 3px green ring with its halo').toEqual([]);
  expect(order.slice(0, 5)).toEqual(['button:Lock', 'tab:admin-panel', expect.stringMatching(/^tabpanel:/), expect.stringMatching(/^select:/), expect.stringMatching(/^input:/)]);
  expect(order.filter((entry) => entry.startsWith('tab:')), 'the six tabs are one tab stop').toHaveLength(1);

  // Arrow keys move along the row and open the tab; Home and End jump.
  await page.getByRole('tab', { name: 'Today' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Clients' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Clients' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Results' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Today' })).toBeFocused();

  // Pick Domino's, then Enter on Go live with the keyboard (nobody is in Kroger, so no confirmation).
  await page.getByLabel('Client', { exact: true }).focus();
  await page.getByLabel('Client', { exact: true }).selectOption('c-dominos');
  await expect(goLiveButton(page)).toBeEnabled();
  await goLiveButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText("Verified: participants now see Domino's")).toBeVisible();

  // With a participant in it, the confirmation takes focus, Escape cancels, and focus starts on Cancel.
  await ds.beginVisit(crypto.randomUUID(), `dominos-${today}`, 'c-dominos');
  await page.getByRole('button', { name: 'Re-check' }).click();
  await ds.activateClient('c-kroger', today);
  await ds.activateClient('c-dominos', today);
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Kroger' });
  await expect(page.getByTestId('participants')).toHaveText('1', { timeout: 15_000 });
  await goLiveButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await ds.getAppSettings()).toMatchObject({ activeClientId: 'c-dominos' });
});
