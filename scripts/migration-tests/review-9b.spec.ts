import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { sha256Hex } from '../../migration/src/lib/sha256.js';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inspectPdf, squash } from '../pdf-inspect.js';
import { axeCheck, describeFindings, type Finding } from './a11y-support.js';
import { newFake, onSite, pageUrl, seedAndGoLive, serveSharePoint, type Fake } from './sharepoint.js';
import { TITLE } from '../sharepoint-fake.js';

// Phase 9b, in the BUILT pages, in a browser, against the mocked SharePoint REST (scripts/sharepoint-fake.js; nothing here ran on the real
// tenant or a real iPad). The rules are unit-tested (scripts/test-review-9b.js, test-participant-storage.js, test-live-display.js and the
// oracle); this is that a person sees them.

const PIN = '2468';
const DAY = '2026-10-11';
const shots = fileURLToPath(new URL('../../test-results/admin/', import.meta.url));
const NOTICE = `1 participant's answers could not be read and are not counted: Ada Lovelace. Correct or delete the damaged item in the ${TITLE.responses} list, then reload.`;

/** Kroger live, four iPads: two with answers, one named Ada whose saved-answers item is then damaged, one with none. */
async function damagedSite() {
  const fake = newFake();
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex(PIN) });
  const session = await seedAndGoLive(fake, 'c-kroger', DAY);
  const tracks = await onSite(fake, async (ds) => {
    const made = [];
    for (let index = 0; index < 4; index += 1) made.push(await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger'));
    const give = (trackId: string, picks: Record<string, string>) => ds.saveParticipantResponses({
      trackId, sessionId: session.id, clientId: 'c-kroger',
      responses: Object.entries(picks).map(([questionId, answer]) => ({ questionId, answer, firstAnswer: answer, attempts: 1, correct: null, answeredAt: '2026-10-11T12:00:00.000Z' })),
    });
    await give(made[0].id, { 'q-trivia-1': 'o-trivia-1-b', 'q-trivia-2': 'o-trivia-2-a' });
    await give(made[1].id, { 'q-trivia-1': 'o-trivia-1-b' });
    await give(made[2].id, { 'q-trivia-1': 'o-trivia-1-a', 'q-trivia-2': 'o-trivia-2-b' });
    return made as { id: string }[];
  });
  const [, , damaged] = tracks;
  fake.lists.get('tracks')!.find((row) => row.AppId === damaged.id)!.ParticipantName = 'Ada Lovelace';
  const damage = (text: string) => { fake.lists.get('responses')!.find((row) => row.AppId === damaged.id)!.ResponsesJson = text; };
  damage('{"this is":"not a list"');
  return { fake, session, tracks, damaged, damage };
}

async function openAdmin(page: Page, fake: Fake, hash = '') {
  await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('admin.html')}${hash}`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
}

const card = (page: Page, sessionId: string) => page.locator(`article[data-session="${sessionId}"]`);

async function download(page: Page, button: string, scope = page.locator('body')) {
  const [file] = await Promise.all([page.waitForEvent('download'), scope.getByRole('button', { name: button }).click()]);
  return { name: file.suggestedFilename(), bytes: await readFile((await file.path())!) };
}

// ---- C. DI-6: one damaged answer item does not stop a session's results -----------------------------------------------------------

test('a participant whose OWN saved answers are damaged still cannot start, and is told in words, not as a lost connection (DI-6)', async ({ page }) => {
  const { fake, damaged } = await damagedSite();
  await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('index.html')}#/agenda?t=${damaged.id}`);
  const alert = page.getByRole('alert');
  await expect(alert.getByRole('heading', { name: 'We can’t open your saved answers' })).toBeVisible();
  await expect(alert).toContainText('Your saved answers could not be read, so this page cannot go on. Please tell your facilitator');
  await expect(alert, 'it is not a lost connection').not.toContainText(/reach the server|connection/i);
  await expect(alert).not.toContainText(/ResponsesJson|JSON|Error:|undefined/);
  await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('Results, the Live display, the exports and the leader report show the rest, and say plainly what could not be read (DI-6)', async ({ page }) => {
  test.setTimeout(90_000);
  const { fake, session, damaged, damage } = await damagedSite();
  await openAdmin(page, fake, '#results');
  const here = card(page, session.id);
  await expect(here).toBeVisible();

  // Results: the notice is beside the export buttons, in bold; the damaged visit says so instead of "Not started"; the others are counted.
  await expect(here.getByTestId('unreadable-notice')).toHaveText(NOTICE);
  await expect(here.getByTestId('unreadable-notice').locator('strong')).toHaveCount(1);
  const row = here.locator('.row').filter({ hasText: 'Ada Lovelace' });
  await expect(row).toContainText('Answers unreadable');
  await expect(row).not.toContainText('Not started');
  await expect(row.getByRole('button', { name: 'Restart...' })).toBeDisabled();
  // The readable iPads are read as ever, whichever order the visits sort in (visits made in the same millisecond tie-break on a random id).
  await expect(here.locator('.row').filter({ hasText: 'In progress' })).toHaveCount(2);
  await expect(here.locator('.row').filter({ hasText: 'Not started' })).toHaveCount(1);
  await expect(here.locator('.row').filter({ hasText: 'Answers unreadable' })).toHaveCount(1);
  // (Since Phase 11a-2 "M iPads" are the visits whose answers are counted: the two readable ones that answered. The one that has not started answered
  // nothing, and the damaged one's answers are not among them: the notice says so.)
  await expect(here.locator('summary')).toContainText('answers from 2 iPads');
  // The two readable iPads (and nobody else) are counted: trivia question 1 has two answers, not three. (Since Phase 11a the card's live results are the
  // charts, whose cards say "N answered"; they said "N of M answered" before.)
  await here.locator('summary').click();
  await expect(here.locator('.result-card[data-question="q-trivia-1"] .result-card__meta')).toContainText('2 answered');

  // The leader report (PDF): the cover says it, in bold, with the session-status line; the person's block says why it is empty.
  const pdf = await download(page, 'Leader report (PDF)', here);
  const read = await inspectPdf(pdf.bytes);
  const cover = read.pages[0];
  expect(squash(cover.text)).toContain(squash(NOTICE));
  const sentence = cover.items.find((item) => squash(item.text).startsWith(squash("1 participant's answers")))!;
  expect(sentence.font).toBe('OpenSans-Bold');
  expect(squash(read.pages.map((sheet) => sheet.text).join(' '))).toContain(squash('Saved answers could not be read, so none are counted here.'));
  await expect(here.locator('.report-exports__status')).toContainText('Saved leader-report-');
  // The CSV needs no extra row: it holds the readable people, and nothing about the damage.
  const csv = await download(page, 'All answers (CSV)', here);
  expect(csv.bytes.toString('utf8')).not.toContain('could not be read');
  expect(csv.bytes.toString('utf8').split('\r\n').filter(Boolean).length).toBeGreaterThan(4);

  // The Live display: the notice is at the top; its own CSV export still works and holds the others' answers.
  await page.goto(`${pageUrl('admin.html')}#live-display/${session.id}`);
  await expect(page.getByTestId('unreadable-notice')).toHaveText(NOTICE);
  await expect(page.locator('.live__meta')).toContainText('answers from 2 iPads');
  const live = await download(page, 'Export CSV');
  expect(live.bytes.toString('utf8')).toContain('Great Western Tea co.');
  // The wall (a projector, in front of the client) says how many, and nothing for the admin to do (Phase 12, F-04).
  await page.goto(`${pageUrl('admin.html')}#live-display/${session.id}/wall`);
  await expect(page.getByTestId('unreadable-notice')).toHaveText("1 participant's answers could not be counted.");
  await page.goto(`${pageUrl('admin.html')}#live-display/${session.id}`);

  // Mended in the Responses list: Refresh, and the notice is gone and the person is back.
  damage(JSON.stringify([{ questionId: 'q-trivia-1', answer: 'o-trivia-1-a', firstAnswer: 'o-trivia-1-a', attempts: 1, correct: null, answeredAt: '2026-10-11T12:00:00.000Z' }]));
  await page.goto(`${pageUrl('admin.html')}#results`);
  await expect(card(page, session.id)).toBeVisible();
  await expect(card(page, session.id).getByTestId('unreadable-notice')).toHaveCount(0);
  await expect(card(page, session.id).locator('.row').filter({ hasText: 'Ada Lovelace' })).not.toContainText('Answers unreadable');
  expect(damaged.id.length).toBeGreaterThan(0);
});

test('a session with nothing damaged shows none of it, anywhere', async ({ page }) => {
  const { fake, session, damage } = await damagedSite();
  damage(JSON.stringify([]));
  await openAdmin(page, fake, '#results');
  await expect(card(page, session.id)).toBeVisible();
  await expect(page.getByTestId('unreadable-notice')).toHaveCount(0);
  await expect(page.getByText('could not be read')).toHaveCount(0);
  await page.goto(`${pageUrl('admin.html')}#live-display/${session.id}`);
  // (Its answers mended to none, the damaged visit answered nothing: still the two that answered.)
  await expect(page.locator('.live__meta')).toContainText('answers from 2 iPads');
  await expect(page.getByTestId('unreadable-notice')).toHaveCount(0);
});

// ---- D. DI-9: remove a visit that has no answers -------------------------------------------------------------------------------------

/** Kroger live (staff mode), three visits: two empty, one with an answer. */
async function visitsSite() {
  const fake = newFake();
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex(PIN) });
  const session = await seedAndGoLive(fake, 'c-kroger', DAY);
  const tracks = await onSite(fake, async (ds) => {
    const made = [];
    for (let index = 0; index < 3; index += 1) made.push(await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger'));
    await ds.saveParticipantResponses({ trackId: made[2].id, sessionId: session.id, clientId: 'c-kroger', responses: [{ questionId: 'q-trivia-1', answer: 'o-trivia-1-b', firstAnswer: 'o-trivia-1-b', attempts: 1, correct: null, answeredAt: '2026-10-11T12:00:00.000Z' }] });
    return made as { id: string }[];
  });
  return { fake, session, tracks };
}
const REMOVE_ASKS = "Remove this visit? It has no answers. If it was made by a guest's code, that code stays used: issue a replacement code if the guest needs to start again.";

test('Results: only a visit with no answers has Remove; it asks first, removes that visit alone, and the others stay (DI-9)', async ({ page }) => {
  const { fake, session, tracks } = await visitsSite();
  await openAdmin(page, fake, '#results');
  const here = card(page, session.id);
  await expect(here.locator('.row')).toHaveCount(3);
  // The two empty visits are "not started" and have Remove; the one with an answer does not.
  await expect(here.getByRole('button', { name: 'Remove...' })).toHaveCount(2);
  await expect(here.locator('.row').filter({ hasText: 'In progress' }).getByRole('button', { name: 'Remove...' })).toHaveCount(0);
  // Cancel leaves everything as it was.
  let asked = '';
  page.once('dialog', (dialog) => { asked = dialog.message(); void dialog.dismiss(); });
  await here.getByRole('button', { name: 'Remove...' }).first().click();
  await expect.poll(() => asked).toBe(REMOVE_ASKS);
  await expect(here.locator('.row')).toHaveCount(3);
  // Yes removes it, and only it.
  page.once('dialog', (dialog) => void dialog.accept());
  await here.getByRole('button', { name: 'Remove...' }).first().click();
  await expect(here.locator('.row')).toHaveCount(2);
  await expect(page.locator('.toast')).toContainText('removed');
  await expect(here.getByRole('button', { name: 'Remove...' })).toHaveCount(1);
  const left = fake.lists.get('tracks')!.map((row) => row.AppId);
  expect(left).toHaveLength(2);
  expect(left).toContain(tracks[2].id);
});

test('Results: an answer that arrived after the screen was drawn stops the removal, in words, and the visit stays (DI-9)', async ({ page }) => {
  const { fake, session, tracks } = await visitsSite();
  // Two empty visits, named so that the test can tell which row is which (the order of equal-named visits is not the point here).
  const rowsOfTracks = fake.lists.get('tracks')!;
  rowsOfTracks.find((row) => row.AppId === tracks[0].id)!.ParticipantName = 'Empty One';
  rowsOfTracks.find((row) => row.AppId === tracks[1].id)!.ParticipantName = 'Empty Two';
  await openAdmin(page, fake, '#results');
  const here = card(page, session.id);
  const one = here.locator('.row').filter({ hasText: 'Empty One' });
  await expect(one.getByRole('button', { name: 'Remove...' })).toBeVisible();
  // The iPad answers a moment after Results showed it as "not started", before Remove is pressed.
  await onSite(fake, (ds) => ds.saveParticipantResponses({ trackId: tracks[0].id, sessionId: session.id, clientId: 'c-kroger', responses: [{ questionId: 'q-trivia-1', answer: 'o-trivia-1-a', firstAnswer: 'o-trivia-1-a', attempts: 1, correct: null, answeredAt: '2026-10-11T12:01:00.000Z' }] }));
  page.once('dialog', (dialog) => void dialog.accept());
  await one.getByRole('button', { name: 'Remove...' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'This visit now has answers, so it was not removed.' })).toBeVisible();
  expect(fake.lists.get('tracks')!.map((row) => row.AppId), 'the visit that gained an answer is still there').toContain(tracks[0].id);
  // The screen shows what is there now: that visit is in progress and has no Remove; the other empty one still has it.
  await expect(one).toContainText('In progress');
  await expect(one.getByRole('button', { name: 'Remove...' })).toHaveCount(0);
  await expect(here.locator('.row').filter({ hasText: 'Empty Two' }).getByRole('button', { name: 'Remove...' })).toBeVisible();
});

test('Results: an ended session has no Remove at all, and Reopen brings it back (DI-9)', async ({ page }) => {
  const { fake, session } = await visitsSite();
  await onSite(fake, (ds) => ds.endSession(session.id));
  await openAdmin(page, fake, '#results');
  await expect(card(page, session.id).locator('.row')).toHaveCount(3);
  await expect(card(page, session.id).getByRole('button', { name: 'Remove...' })).toHaveCount(0);
  await onSite(fake, (ds) => ds.reopenSession(session.id));
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(card(page, session.id).getByRole('button', { name: 'Remove...' })).toHaveCount(2);
});

test('a staff page that holds a removed visit says so and offers the way forward: when it was open, and when its link is opened afresh (DI-9)', async ({ page }) => {
  const { fake, tracks } = await visitsSite();
  await serveSharePoint(page, fake);
  const empty = tracks[0].id;
  await page.goto(`${pageUrl('index.html')}#/agenda?t=${empty}`);
  await expect(page.locator('button.activity').first()).toBeVisible();
  // A facilitator removes the visit while this page is open: its next look finds it gone.
  await onSite(fake, (ds) => ds.removeEmptyVisit(empty));
  await expect.poll(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    return page.getByText('This visit is no longer on record. Press the button below to start again.').count();
  }, { timeout: 20_000 }).toBe(1);
  await expect(page.getByRole('button', { name: /Click here to begin|Activities/ })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  // The same link opened afresh, in a page of its own (the first page has already moved its own address on to Welcome): the same words, and a
  // way forward. Never a blank page or a raw error.
  const fresh = await page.context().newPage();
  await serveSharePoint(fresh, fake);
  await fresh.goto(`${pageUrl('index.html')}#/agenda?t=${empty}`);
  await expect(fresh.getByText('This visit is no longer on record. Press the button below to start again.')).toBeVisible();
  await expect(fresh.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  await expect(fresh.locator('body')).not.toContainText(/Error|undefined|TypeError|Failed to fetch/);
  // And pressing it starts a new visit.
  await fresh.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(fresh.locator('button.activity').first()).toBeVisible();
  expect(fake.lists.get('tracks')!.length).toBe(3);
});

test('a guest page that holds a removed visit says to ask the facilitator, and Welcome still shows the way in (DI-9)', async ({ page }) => {
  const { fake, session } = await visitsSite();
  // A guest's visit made with a personal code, then removed from Results (empty).
  const guest = await onSite(fake, async (ds) => {
    await ds.setSessionParticipationMode(session.id, 'client-visit');
    const visitor = await ds.createVisitor({ sessionId: session.id, displayName: 'Guest One', enabled: true });
    const token = await ds.provisionQrToken('c-kroger', session.id, { visitorId: visitor.id });
    const track = await (await ds.openQrScan(token.id)).claim();
    return { token, track };
  });
  await onSite(fake, (ds) => ds.removeEmptyVisit(guest.track.id));
  await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('index.html')}#/agenda?t=${guest.track.id}`);
  await expect(page.getByText('This visit is no longer on record. Ask your facilitator for a new code.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Scan your visitor QR code' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/Error|undefined|TypeError|Failed to fetch/);
  // The code stays used: the facilitator issues a replacement. Nothing was changed on the code or the roster.
  const code = fake.lists.get('qrtokens')!.find((row) => row.AppId === guest.token.id)!;
  expect(code.Used).toBe(true);
  expect(fake.lists.get('visitorroster')!.length).toBe(1);
});

// ---- E. SAM-1 and SAM-2: sample content ----------------------------------------------------------------------------------------------

const SAMPLE_NOTICE = 'Sample content: confirm with the client team before real use';
const OLD_LOGO = '/assets/images/clients/kroger-logo.svg';

/** The two sample clients on the site, an admin, Kroger live, and a client somebody made by hand. */
async function sampleSite() {
  const fake = newFake();
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex(PIN) });
  const session = await seedAndGoLive(fake, 'c-kroger', DAY);
  await onSite(fake, async (ds) => {
    await ds.createClient({ id: 'c-acme', name: 'Acme Foods', slug: 'acme', status: 'active', logoUrl: '/assets/images/clients/acme-logo.png', primaryColor: '#045bcc', secondaryColor: '#64748b', createdAt: new Date().toISOString(), themeVersion: 1,
      theme: { version: 1, primary: '#045BCC', accent: null, tokens: {}, assets: { hero: null, logo: null, background: null, tile: null }, copy: { eventTitle: 'ACME FOODS TRIVIA NIGHT', eventSubtitle: '', welcomeLine: '', logoText: 'Acme Foods' } } });
  });
  return { fake, session };
}
/** A site that was seeded BEFORE Phase 9b: Kroger carries the old logo address, and no client carries the marker. */
function asSeededBefore(fake: Fake) {
  for (const row of fake.lists.get('clients')!) {
    if (!['c-kroger', 'c-dominos'].includes(row.AppId)) continue;
    const theme = JSON.parse(row.ThemeJson);
    delete theme.sample;
    row.ThemeJson = JSON.stringify(theme);
    if (row.AppId === 'c-kroger') row.LogoUrl = OLD_LOGO;
  }
}
const clientRow = (page: Page, name: string) => page.locator('.client-row').filter({ hasText: name });

test('Clients and Content say "Sample content" for the two seeded clients until somebody confirms, which records who and when; a client made by hand shows none (SAM-2)', async ({ page }) => {
  const { fake } = await sampleSite();
  await openAdmin(page, fake, '');
  await page.getByRole('tab', { name: 'Clients', exact: true }).click();
  await expect(clientRow(page, 'Kroger')).toBeVisible();
  for (const name of ['Kroger', "Domino's"]) await expect(clientRow(page, name).getByTestId('sample-notice')).toHaveText(new RegExp(`^${SAMPLE_NOTICE}\\s*Mark as confirmed$`));
  await expect(clientRow(page, 'Acme Foods').getByTestId('sample-notice')).toHaveCount(0);
  await expect(clientRow(page, 'Acme Foods').getByTestId('sample-confirmed')).toHaveCount(0);

  // Confirm Kroger: who (the admin and the signed-in account) and when are written to its ThemeJson, and nothing else about it changes.
  const before = JSON.parse(fake.lists.get('clients')!.find((row) => row.AppId === 'c-kroger')!.ThemeJson);
  await clientRow(page, 'Kroger').getByRole('button', { name: 'Mark as confirmed' }).click();
  await expect(clientRow(page, 'Kroger').getByTestId('sample-confirmed')).toContainText(/^Confirmed by Facilitator \(Casey Example\) on /);
  await expect(clientRow(page, 'Kroger').getByTestId('sample-notice')).toHaveCount(0);
  await expect(clientRow(page, "Domino's").getByTestId('sample-notice')).toBeVisible();
  const stored = fake.lists.get('clients')!.find((row) => row.AppId === 'c-kroger')!;
  const after = JSON.parse(stored.ThemeJson);
  expect(after.sample).toMatchObject({ source: 'Seed sample clients', confirmedBy: 'Facilitator (Casey Example)' });
  expect(Date.now() - Date.parse(after.sample.confirmedAt)).toBeLessThan(60_000);
  expect({ ...after, sample: undefined }, 'nothing else in the theme changed').toEqual({ ...before, sample: undefined });
  expect(stored.ThemeVersion, 'and its version did not move').toBe(1);

  // Content: the same notice for the client chosen there.
  await page.getByRole('tab', { name: 'Content', exact: true }).click();
  await page.getByLabel('Client', { exact: true }).selectOption({ label: "Domino's" });
  await expect(page.getByTestId('sample-notice')).toHaveText(new RegExp(`^${SAMPLE_NOTICE}\\s*Mark as confirmed$`));
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Kroger' });
  await expect(page.getByTestId('sample-notice')).toHaveCount(0);
  await expect(page.getByTestId('sample-confirmed')).toContainText('Confirmed by Facilitator (Casey Example)');
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Acme Foods' });
  await expect(page.locator('[data-testid^="sample-"]')).toHaveCount(0);
  // Confirm Domino's from Content, and the list agrees after a reload (it is stored, not remembered by the page).
  await page.getByLabel('Client', { exact: true }).selectOption({ label: "Domino's" });
  await page.getByTestId('sample-notice').getByRole('button', { name: 'Mark as confirmed' }).click();
  await expect(page.getByTestId('sample-confirmed')).toContainText('Confirmed by');
  await page.reload();
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('tab', { name: 'Clients', exact: true }).click();
  await expect(page.locator('[data-testid="sample-notice"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="sample-confirmed"]')).toHaveCount(2);
});

test('a site seeded before Phase 9b: Kroger shows its name in type, not the drawn logo, on Welcome, the Clients list and the Live display, and readiness warns (SAM-1)', async ({ page, browser }) => {
  const { fake, session } = await sampleSite();
  asSeededBefore(fake);
  // The participant page: the name in type on the plate; the stand-in picture is not asked for.
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  const asked: string[] = [];
  guestPage.on('request', (request) => { if (/kroger-logo/.test(request.url())) asked.push(request.url()); });
  await serveSharePoint(guestPage, fake);
  await guestPage.goto(pageUrl('index.html'));
  await expect(guestPage.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  await expect(guestPage.locator('.pms-hero-text')).toHaveText('Kroger');
  await expect(guestPage.locator('img[src*="kroger-logo"], img[alt="Kroger"]')).toHaveCount(0);
  expect(asked).toEqual([]);
  await guest.close();

  await openAdmin(page, fake, '');
  // Today: readiness warns that there is no logo.
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Kroger' });
  await expect(page.locator('[data-check="logo"]')).toHaveAttribute('data-level', 'warning');
  await expect(page.locator('[data-check="logo"]')).toContainText('has no logo or hero image');
  // Clients: no picture in the row; the sample notice is there although this site has no marker (the seeds' id and date say so).
  await page.getByRole('tab', { name: 'Clients', exact: true }).click();
  await expect(clientRow(page, 'Kroger')).toBeVisible();
  await expect(clientRow(page, 'Kroger').locator('img.logo')).toHaveCount(0);
  await expect(clientRow(page, 'Kroger').getByTestId('sample-notice')).toBeVisible();
  await expect(clientRow(page, 'Acme Foods').locator('img.logo')).toHaveCount(1);
  // The Live display: no logo chip.
  await page.goto(`${pageUrl('admin.html')}#live-display/${session.id}`);
  await expect(page.locator('.live__client')).toHaveText('Kroger');
  await expect(page.locator('.live__logo')).toHaveCount(0);
});

test('the leader report\'s cover says "Sample content, not yet confirmed with the client." until the client is confirmed, and never for a client made by hand (SAM-2)', async ({ page }) => {
  test.setTimeout(90_000);
  const { fake, session } = await sampleSite();
  await onSite(fake, async (ds) => { await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger'); });
  await openAdmin(page, fake, '#results');
  const here = card(page, session.id);
  await expect(here).toBeVisible();
  const first = await inspectPdf((await download(page, 'Leader report (PDF)', here)).bytes);
  expect(squash(first.pages[0].text)).toContain(squash('Sample content, not yet confirmed with the client.'));
  expect(first.pages[0].items.find((item) => squash(item.text).startsWith(squash('Sample content, not yet')))!.font).toBe('OpenSans-Bold');
  // Confirmed on Clients; the next report does not carry it.
  await page.getByRole('tab', { name: 'Clients', exact: true }).click();
  await clientRow(page, 'Kroger').getByRole('button', { name: 'Mark as confirmed' }).click();
  await expect(clientRow(page, 'Kroger').getByTestId('sample-confirmed')).toBeVisible();
  await page.getByRole('tab', { name: 'Results', exact: true }).click();
  await expect(card(page, session.id)).toBeVisible();
  const second = await inspectPdf((await download(page, 'Leader report (PDF)', card(page, session.id))).bytes);
  expect(squash(second.pages.map((sheet) => sheet.text).join(' '))).not.toContain(squash('Sample content'));
});

// ---- Accessibility of the screens and states this phase added (axe-core at WCAG 2.1 A and AA; it reads the DOM, which is the same in every engine, so Chromium only) ----

test('axe finds nothing on the new states: the notices, the Remove buttons, the sample notice, the warning on Today, the two participant messages', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'axe reads the DOM, which is the same in every engine');
  test.setTimeout(120_000);
  const findings: Finding[] = [];
  // A page of its own for each site: a navigation that only changes the address's hash does not reload, and the PIN would not be asked for again.
  const fresh = async () => (await (await browser.newContext()).newPage());
  // Each state is also photographed, to test-results/admin/9b-*.png, to be looked at (AGENTS.md: look at the pictures).
  await mkdir(shots, { recursive: true });
  const look = async (page: Page, where: string) => {
    findings.push(...(await axeCheck(page, where)).findings);
    await page.screenshot({ path: `${shots}9b-${where.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.png`, fullPage: true });
  };

  // A damaged answer item: Results (the notice, the "Answers unreadable" pill, the disabled Restart) and the Live display.
  const damaged = await damagedSite();
  const results = await fresh();
  await openAdmin(results, damaged.fake, '#results');
  await expect(card(results, damaged.session.id).getByTestId('unreadable-notice')).toBeVisible();
  await look(results, 'Results with a damaged item');
  await results.goto(`${pageUrl('admin.html')}#live-display/${damaged.session.id}`);
  await expect(results.getByTestId('unreadable-notice')).toBeVisible();
  await look(results, 'Live display with a damaged item');

  // Visits with no answers: Results with its Remove buttons.
  const visits = await visitsSite();
  const removable = await fresh();
  await openAdmin(removable, visits.fake, '#results');
  await expect(card(removable, visits.session.id).getByRole('button', { name: 'Remove...' }).first()).toBeVisible();
  await look(removable, 'Results with Remove buttons');

  // Sample content: Today with the staff-mode warning, then Clients and Content with the notice.
  const sample = await sampleSite();
  const admin = await fresh();
  await openAdmin(admin, sample.fake, '');
  await expect(admin.locator('[data-check="staff-signin"]')).toBeVisible();
  await look(admin, 'Today with the staff-mode warning in the readiness list');
  await admin.getByRole('tab', { name: 'Clients', exact: true }).click();
  await expect(clientRow(admin, 'Kroger').getByTestId('sample-notice')).toBeVisible();
  await look(admin, 'Clients with the sample notice');
  await clientRow(admin, 'Kroger').getByRole('button', { name: 'Mark as confirmed' }).click();
  await expect(clientRow(admin, 'Kroger').getByTestId('sample-confirmed')).toBeVisible();
  await look(admin, 'Clients with a confirmed sample');
  await admin.getByRole('tab', { name: 'Content', exact: true }).click();
  await admin.getByLabel('Client', { exact: true }).selectOption({ label: "Domino's" });
  await expect(admin.getByTestId('sample-notice')).toBeVisible();
  await look(admin, 'Content with the sample notice');
  // Today with the warning beside "How people are identified" (a live staff-mode session).
  await admin.getByRole('tab', { name: 'Today', exact: true }).click();
  await admin.getByRole('button', { name: 'Go live' }).click();
  await expect(admin.getByTestId('staff-mode-warning')).toBeVisible();
  await look(admin, 'Today with the staff-mode warning beside the controls');

  // The participant's two messages.
  const own = await damagedSite();
  const guest = await fresh();
  await serveSharePoint(guest, own.fake);
  await guest.goto(`${pageUrl('index.html')}#/agenda?t=${own.damaged.id}`);
  await expect(guest.getByRole('alert').getByRole('heading', { name: 'We can’t open your saved answers' })).toBeVisible();
  await look(guest, 'participant: saved answers cannot be read');
  const gone = await visitsSite();
  const goneId = gone.tracks[0].id;
  await onSite(gone.fake, (ds) => ds.removeEmptyVisit(goneId));
  const gonePage = await fresh();
  await serveSharePoint(gonePage, gone.fake);
  await gonePage.goto(`${pageUrl('index.html')}#/agenda?t=${goneId}`);
  await expect(gonePage.getByText('This visit is no longer on record. Press the button below to start again.')).toBeVisible();
  await look(gonePage, 'participant: visit no longer on record');

  expect(describeFindings(findings)).toBe('');
});
