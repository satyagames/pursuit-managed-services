import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { samplePack } from '../../migration/src/lib/sample-clients.js';
import { seedPack } from '../../migration/src/lib/seed.js';
import { newFake, onSite, pageUrl, seedAndGoLive, serveSharePoint, shape, stampFirstAppearance, type Fake } from './sharepoint.js';
import { TITLE } from '../sharepoint-fake.js';

// Phase 4, in SharePoint mode: the BUILT participant page, served at the approved host's address,
// against the mocked SharePoint REST (scripts/sharepoint-fake.js), which counts every request.
// These are the request budgets measured in a real browser: what the page sends before its first
// screen, and what a whole visit costs. It is not the real tenant.
//
// Since Phase 10b a page on SharePoint first asks for its settings file, pms-config.txt, in its own folder: ONE request for a small
// static file, on every load, before any of the requests counted below. So the budget to the first screen is 8 list requests plus 1
// file (a first QR scan: 8 plus 1; the device that starts the session: 9 plus 1; where the site cannot batch, 14 plus 1). The file
// is not a REST request and is not in the fake's log: `served.settingsFile` counts it. On the local server no file is asked for.

const results = fileURLToPath(new URL('../../test-results/budget/', import.meta.url));
const measured: Record<string, unknown> = {};
test.afterAll(async () => {
  await mkdir(results, { recursive: true });
  await writeFile(`${results}sharepoint-browser.json`, `${JSON.stringify(measured, null, 2)}\n`);
});

/** The requests the fake received up to `at`, and after it. */
const split = (fake: Fake, at: number) => ({
  before: fake.requests.filter((entry) => entry.at <= at).map(shape),
  after: fake.requests.filter((entry) => entry.at > at).map(shape),
});

/** A visitor with a personal QR code for the live session (client-visit mode). */
const visitorCode = (fake: Fake, sessionId: string, clientId: string, name = 'Jordan Lee') => onSite(fake, async (ds) => {
  await ds.setSessionParticipationMode(sessionId, 'client-visit');
  const visitor = await ds.createVisitor({ sessionId, displayName: name, enabled: true });
  return (await ds.provisionQrToken(clientId, sessionId, { visitorId: visitor.id })).id as string;
});

const choices = (page: Page) => page.locator('.pms-options button');

test('a first visit reaches Welcome in 6 requests, all reads, and reads the activities and logs the visit only once the screen is up', async ({ page }) => {
  const fake = newFake();
  await seedAndGoLive(fake, 'c-kroger');
  const served = await serveSharePoint(page, fake);
  const firstScreen = await stampFirstAppearance(page, '.pms-cta button');
  fake.reset();
  await page.goto(pageUrl('index.html'));
  await expect(page.getByRole('heading', { name: 'Hi Casey Example!' })).toBeVisible();
  await expect(page.getByText('Welcome to the Kroger experience.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  await expect.poll(() => fake.count({ method: 'POST', list: 'uservisitlogs' })).toBe(1);
  await expect.poll(() => fake.count((entry) => entry.list === 'responses' && /ListItemEntityTypeFullName/.test(entry.url))).toBe(1);
  await expect.poll(() => fake.count({ method: 'GET', list: 'options' })).toBe(1);

  const { before, after } = split(fake, (await firstScreen())!);
  // (Phase 10j: the session's visits in the second round, beside the client, the session and the activities; no question before Welcome.)
  expect([...before].sort()).toEqual(['GET /web/currentuser', 'GET appsettings', 'GET clients', 'GET sections', 'GET sessions', 'GET tracks']);
  expect(before.indexOf('GET appsettings'), 'AppSettings comes first, before the client, session and activities').toBeLessThan(before.indexOf('GET clients'));
  expect(before.length).toBeLessThanOrEqual(8);
  // Once the screen is up: every enabled activity's questions and options (Phase 10j); the visit log (its list's metadata, the write token, the
  // row), then what "Click here to begin" and the first save will ask for, fetched ahead: the participants list's type and columns, the sessions
  // list's (the session has not started) and the answers list's type.
  const later = after.filter((entry) => !entry.includes('appsettings'));
  expect([...later].sort()).toEqual([
    'GET options', 'GET questions', 'GET responses', 'GET sessions', 'GET sessions', 'GET tracks', 'GET tracks', 'GET uservisitlogs', 'POST /contextinfo', 'POST uservisitlogs',
  ]);
  expect(later.filter((entry) => !/questions|options/.test(entry))).toEqual([
    'GET uservisitlogs', 'POST /contextinfo', 'POST uservisitlogs', 'GET tracks', 'GET tracks', 'GET sessions', 'GET sessions', 'GET responses',
  ]);
  expect(served.unexpected).toEqual([]);
  expect(served.settingsFile, 'and, before all of them, one request for the settings file: 8 list requests plus 1 file').toBe(1);
  expect(fake.strays, 'every one of them to this copy\'s own lists').toEqual([]);
  measured.firstVisit = { toFirstScreen: before.length, settingsFile: served.settingsFile, requests: before, afterFirstScreen: after };

  // The first activity opens with no request at all: the page read every activity's questions once its first screen was up.
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(page.locator('button.activity')).toHaveText([/Kroger's History/, /Guess the Brand/]);
  const settled = fake.count();
  await page.getByRole('button', { name: "Kroger's History" }).click();
  await expect(page.getByRole('group', { name: /first store/ })).toBeVisible();
  expect(fake.requests.slice(settled).map(shape).filter((entry) => /Questions|Options/.test(entry))).toEqual([]);
});

test('a first QR scan reaches Welcome in 8 requests (9 for the device that starts the session), with the claim last', async ({ page, browser }) => {
  const fake = newFake();
  const session = await seedAndGoLive(fake, 'c-kroger');
  const opening = await visitorCode(fake, session.id, 'c-kroger', 'Avery Stone');
  const code = await visitorCode(fake, session.id, 'c-kroger');

  // The session's first device also moves it to in-progress.
  const opened = await serveSharePoint(page, fake);
  const openingScreen = await stampFirstAppearance(page, '.pms-cta button');
  fake.reset();
  await page.goto(`${pageUrl('index.html')}?qr=${opening}`);
  await expect(page.getByRole('heading', { name: 'Hi Avery Stone!' })).toBeVisible();
  const first = split(fake, (await openingScreen())!).before;
  expect([...first].sort()).toEqual([
    'GET appsettings', 'GET options', 'GET qrtokens', 'GET questions', 'MERGE qrtokens', 'MERGE sessions', 'POST /$batch', 'POST /contextinfo', 'POST tracks',
  ]);
  expect(first.length).toBeLessThanOrEqual(12);
  expect(opened.settingsFile, 'the device that starts the session: 9 list requests plus 1 for the settings file').toBe(1);

  // Every device after it: its own browser, with nothing remembered.
  const context = await browser.newContext();
  const next = await context.newPage();
  const served = await serveSharePoint(next, fake);
  const firstScreen = await stampFirstAppearance(next, '.pms-cta button');
  fake.reset();
  await next.goto(`${pageUrl('index.html')}?qr=${code}`);
  await expect(next.getByRole('heading', { name: 'Hi Jordan Lee!' })).toBeVisible();
  await expect(next.getByText('Welcome to the Kroger experience.', { exact: true })).toBeVisible();
  await expect(next.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  await expect.poll(() => fake.count({ method: 'POST', list: 'uservisitlogs' })).toBe(1);
  await expect.poll(() => fake.count((entry) => entry.list === 'responses' && /ListItemEntityTypeFullName/.test(entry.url))).toBe(1);

  const { before, after } = split(fake, (await firstScreen())!);
  expect([...before].sort()).toEqual([
    'GET appsettings', 'GET options', 'GET qrtokens', 'GET questions', 'MERGE qrtokens', 'POST /$batch', 'POST /contextinfo', 'POST tracks',
  ]);
  expect(before.length).toBeLessThanOrEqual(8);
  // One request carries the session, the client, its activities, the visitor and the Tracks item type.
  const batch = fake.requests.find((entry) => entry.parts)!;
  // (The first 'GET Tracks' is Phase 9a's look for a track an earlier, cut-off try of this code left.)
  expect(batch.parts!.map(shape)).toEqual(['GET sessions', 'GET clients', 'GET sections', 'GET tracks', 'GET visitorroster', 'GET tracks']);
  expect(before.indexOf('GET qrtokens'), 'the code is read first').toBeLessThan(before.indexOf('POST /$batch'));
  expect(before.indexOf('POST /$batch'), 'the track is written only once everything was checked').toBeLessThan(before.indexOf('POST tracks'));
  expect(before.indexOf('POST tracks'), 'and the claim comes last').toBeLessThan(before.indexOf('MERGE qrtokens'));
  expect(before, 'a named visitor is never asked who is signed in').not.toContain('GET /web/currentuser');
  expect(fake.select({ method: 'MERGE', list: 'qrtokens' })[0].ifMatch, 'the claim carries the version the code was read at').toMatch(/^"\d+"$/);
  // Once the screen is up: the visit log (its list's item type, then the row; the write token is already held), then (Phase 10j) the answers
  // list's type, fetched ahead for the first save.
  expect(after.filter((entry) => !/appsettings|GET tracks/.test(entry))).toEqual(['GET uservisitlogs', 'POST uservisitlogs', 'GET responses']);
  expect(served.unexpected).toEqual([]);
  expect(fake.count((entry) => Boolean(entry.faulted))).toBe(0);
  expect(served.settingsFile, 'a first scan: 8 list requests plus 1 for the settings file').toBe(1);
  measured.firstScan = { toFirstScreen: before.length, settingsFile: served.settingsFile, requests: before, batched: batch.parts!.map(shape), afterFirstScreen: after, firstDeviceOfSession: first.length, firstDeviceSettingsFile: opened.settingsFile };

  // The first activity opens with no request at all: the scan brought its questions along.
  await next.getByRole('button', { name: 'Click here to begin' }).click();
  const settled = fake.count();
  await next.getByRole('button', { name: "Kroger's History" }).click();
  await expect(next.getByRole('group', { name: /first store/ })).toBeVisible();
  expect(fake.requests.slice(settled).map(shape).filter((entry) => /Questions|Options/.test(entry))).toEqual([]);
  await context.close();
});

test('five iPads scanning the same code at the same moment: one gets in, four see "already used", one track exists', async ({ browser }) => {
  const fake = newFake();
  const session = await seedAndGoLive(fake, 'c-kroger');
  const code = await visitorCode(fake, session.id, 'c-kroger');
  // Hold every page's first read of the code until all five have asked, so that all five see it unused.
  let waiting = 0;
  let release = () => {};
  const all = new Promise<void>((resolve) => { release = resolve; });
  const contexts = await Promise.all(Array.from({ length: 5 }, () => browser.newContext()));
  const pages = await Promise.all(contexts.map(async (context) => {
    const page = await context.newPage();
    await serveSharePoint(page, fake);
    let held = false;
    await page.route(`**/_api/**${TITLE.qrtokens}**`, async (route) => {
      if (!held && route.request().method() === 'GET') {
        held = true;
        if ((waiting += 1) === 5) release();
        await all;
      }
      await route.fallback();
    });
    return page;
  }));
  fake.reset();
  await Promise.all(pages.map((page) => page.goto(`${pageUrl('index.html')}?qr=${code}`)));

  const outcomes = await Promise.all(pages.map(async (page) => {
    const begin = page.getByRole('button', { name: 'Click here to begin' });
    const used = page.getByText('This QR code has already been used. Ask your facilitator for a new code.');
    await expect(begin.or(used)).toBeVisible();
    return (await begin.isVisible()) ? 'in' : 'used';
  }));
  expect(outcomes.filter((outcome) => outcome === 'in')).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome === 'used')).toHaveLength(4);
  expect(waiting, 'all five read the code before any of them claimed it').toBe(5);
  expect(fake.count({ method: 'POST', list: 'tracks' }), 'each wrote a track').toBe(5);
  expect(fake.select({ method: 'MERGE', list: 'qrtokens' }).filter((entry) => !entry.faulted).length).toBeGreaterThanOrEqual(5);

  // The device that got in is on Welcome with its name; the others see the existing "already used" screen.
  const winner = pages[outcomes.indexOf('in')];
  await expect(winner.getByRole('heading', { name: 'Hi Jordan Lee!' })).toBeVisible();
  for (const [index, page] of pages.entries()) {
    if (outcomes[index] !== 'used') continue;
    await expect(page.getByRole('heading', { name: 'Scan your visitor QR code' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Click here to begin' })).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('qr'), 'the spent code is taken out of the address').toBeNull();
  }
  // One track is left, and it is the one the code names.
  const tracks = fake.lists.get('tracks')!;
  expect(tracks).toHaveLength(1);
  expect(fake.item('qrtokens', code)).toMatchObject({ Used: true, ClientTrackId: tracks[0].AppId });
  measured.fiveDevicesOneCode = { in: 1, alreadyUsed: 4, tracksLeft: tracks.length, requests: fake.count() };
  await Promise.all(contexts.map((context) => context.close()));
});

test('a reload inside an activity is answerable again within 8 requests, and restores the answers with one read', async ({ page }) => {
  const fake = newFake();
  const session = await seedAndGoLive(fake, 'c-kroger');
  const code = await visitorCode(fake, session.id, 'c-kroger');
  await serveSharePoint(page, fake);
  const firstScreen = await stampFirstAppearance(page, '.pms-options button');

  // The first scan (its own budget is the test above).
  fake.reset();
  await page.goto(`${pageUrl('index.html')}?qr=${code}`);
  await expect(page.getByRole('heading', { name: 'Hi Jordan Lee!' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();

  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await page.getByRole('button', { name: "Kroger's History" }).click();
  await choices(page).nth(1).click();
  await expect(choices(page).nth(1)).toHaveAttribute('data-state', 'correct');
  await expect.poll(() => fake.count({ method: 'POST', list: 'responses' })).toBe(1);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Question 2 of 5' })).toBeVisible();

  fake.reset();
  await page.evaluate(() => { delete (window as unknown as { firstScreenAt?: number }).firstScreenAt; });
  await page.reload();
  await expect(page.getByRole('progressbar', { name: 'Question 2 of 5' })).toBeVisible();
  await expect(choices(page).first()).toBeVisible();
  // The reads. (The write token is the first request of the resume stamp, which is sent once the screen is drawn: it can fall a few
  // milliseconds either side of the moment the options are first seen, so it is not counted among the reads the first screen waits for.)
  const before = split(fake, (await firstScreen())!).before.filter((entry) => entry !== 'POST /contextinfo');
  expect([...before].sort()).toEqual([
    'GET appsettings', 'GET clients', 'GET options', 'GET questions', 'GET responses', 'GET sections', 'GET sessions', 'GET tracks',
  ]);
  expect(before, 'a named visitor is never asked who is signed in').not.toContain('GET /web/currentuser');
  expect(fake.select({ method: 'GET', list: 'responses' })[0].query).toContain("TrackId eq '");
  measured.reloadInActivity = { toFirstScreen: before.length, requests: before };
  // Afterwards: the resume stamp. The visit log is not sent again by the same tab.
  await expect.poll(() => fake.count({ method: 'MERGE', list: 'tracks' })).toBe(1);
  expect(fake.count({ list: 'uservisitlogs' })).toBe(0);
});

test('a whole visit, QR scan to finale: one item for the participant, one blind write per pick, and the total it costs', async ({ page }) => {
  const fake = newFake();
  const session = await seedAndGoLive(fake, 'c-kroger');
  const code = await visitorCode(fake, session.id, 'c-kroger');
  // The sample pack gives Kroger its two graded activities. Add a confidence poll and an open-text
  // question, as Kroger has on the local server, so the visit covers every kind of answer.
  await onSite(fake, async (ds) => {
    const levels = ['Not confident', 'Moderately confident', 'Very confident'];
    for (const [index, label] of levels.entries()) await ds.createOption({ id: `o-conf-${index + 1}`, questionId: 'q-confidence-delivery', label, value: index + 1, correct: null });
    await ds.createQuestion({ id: 'q-confidence-delivery', sectionId: 'sec-confidence', type: 'confidence-continuum', prompt: "Rate your confidence in Deloitte's delivery capabilities", optionIds: ['o-conf-1', 'o-conf-2', 'o-conf-3'], order: 1 });
    await ds.createSection({ id: 'sec-confidence', title: 'Confidence Continuum', order: 3, enabled: true, industryTags: [], questionIds: ['q-confidence-delivery'], clientId: 'c-kroger' });
    await ds.createQuestion({ id: 'q-open-feedback', sectionId: 'sec-open-feedback', type: 'open-text-feedback', prompt: "Any other feedback you'd like to share?", optionIds: [], order: 1 });
    await ds.createSection({ id: 'sec-open-feedback', title: 'Open Feedback', order: 4, enabled: true, industryTags: [], questionIds: ['q-open-feedback'], clientId: 'c-kroger' });
    // Open flow, so the activities can be taken in the order the test wants.
    await ds.updateSession(session.id, { activityFlow: 'open' });
  });
  const served = await serveSharePoint(page, fake);
  fake.reset();
  await page.goto(`${pageUrl('index.html')}?qr=${code}`);
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(page.locator('button.activity')).toHaveCount(4);

  const next = page.getByRole('button', { name: 'Next', exact: true });
  const submit = page.getByRole('button', { name: 'Submit', exact: true });
  const back = page.getByRole('button', { name: 'Back to activities' });
  let picks = 0;

  // Kroger's History: five graded questions. The first is missed once, then right on the Retry.
  await page.getByRole('button', { name: "Kroger's History" }).click();
  await choices(page).nth(0).click();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await choices(page).nth(1).click();
  picks += 2;
  await next.click();
  for (const [index, right] of [0, 2, 0, 2].entries()) {
    await choices(page).nth(right).click();
    picks += 1;
    await (index === 3 ? submit : next).click();
  }
  await expect(page.getByText('4 of 5 right on the first try')).toBeVisible();
  await back.click();

  // Guess the Brand: text tiles, because no logos are uploaded.
  await page.getByRole('button', { name: /Guess the Brand/ }).click();
  await expect(page.locator('.pms-grid button.tile')).toHaveText(['Kroger', 'Home Chef', 'Bloom Haus', 'Smart Way']);
  await page.getByRole('button', { name: 'Home Chef' }).click();
  picks += 1;
  await submit.click();
  await back.click();

  await page.getByRole('button', { name: /Confidence Continuum/ }).click();
  await page.getByRole('button', { name: 'Very confident' }).click();
  await submit.click();
  picks += 1;
  await back.click();

  await page.getByRole('button', { name: /Open Feedback/ }).click();
  await page.getByRole('textbox').fill('A useful afternoon.');
  await submit.click();
  picks += 1;
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Thank you, Jordan Lee!' })).toBeVisible();
  await expect(page.getByText('4 activities completed')).toBeVisible();
  await expect(page.getByText('5 of 6 right on the first try')).toBeVisible();

  // One item, the participant's own, holding all eight answers.
  const items = fake.lists.get('responses')!;
  expect(items).toHaveLength(1);
  const track = fake.lists.get('tracks')![0];
  expect(items[0]).toMatchObject({ AppId: track.AppId, TrackId: track.AppId, SessionId: session.id, ClientId: 'c-kroger' });
  const stored = JSON.parse(items[0].ResponsesJson as string) as { questionId: string; firstAnswer: unknown; answer: unknown; attempts: number; correct: boolean | null }[];
  expect(stored.map((record) => record.questionId)).toEqual(['q-trivia-1', 'q-trivia-2', 'q-trivia-3', 'q-trivia-4', 'q-trivia-5', 'q-brand-1', 'q-confidence-delivery', 'q-open-feedback']);
  expect(stored[0]).toMatchObject({ firstAnswer: 'o-trivia-1-a', answer: 'o-trivia-1-b', attempts: 2, correct: false });
  expect(stored[7]).toMatchObject({ answer: 'A useful afternoon.', correct: null });

  // The saves: one create, then one overwrite per pick, each blind (no version to collide on).
  const saves = fake.select((entry) => entry.list === 'responses' && entry.method !== 'GET');
  expect(saves[0].method).toBe('POST');
  expect(saves.slice(1).every((entry) => entry.method === 'MERGE' && entry.ifMatch === '*')).toBe(true);
  expect(saves.length, 'at most one write per pick').toBeLessThanOrEqual(picks);
  expect(fake.count((entry) => Boolean(entry.faulted))).toBe(0);
  expect(fake.select({ method: 'GET', list: 'responses' }).filter((entry) => entry.query.includes('TrackId')), 'the visit began here: its answers never had to be read').toEqual([]);
  expect(served.unexpected).toEqual([]);

  const polls = fake.select((entry) => entry.method === 'GET' && (entry.list === 'tracks' || entry.list === 'appsettings') && entry.at > saves[0].at).length;
  const total = fake.count();
  measured.wholeVisit = {
    questions: 8, picks, total, saves: saves.length, polls,
    byList: Object.fromEntries([...new Set(fake.requests.map(shape))].sort().map((key) => [key, fake.requests.filter((entry) => shape(entry) === key).length])),
  };
  expect(total - polls, 'everything but the 10-second polls').toBeLessThanOrEqual(60);
});

test("the client's theme is on the page before any colour is painted, and the default look is never shown first", async ({ page }) => {
  const fake = newFake();
  await seedAndGoLive(fake, 'c-dominos');
  await serveSharePoint(page, fake);
  // Hold AppSettings back, so the page can be looked at while it does not yet know whose day it is.
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/_api/**${TITLE.appsettings}**`, async (route) => { await held; await route.fallback(); });
  // Record every background the shell ever has.
  await page.addInitScript(() => {
    const seen = new Set<string>();
    (window as unknown as { shellBackgrounds: Set<string> }).shellBackgrounds = seen;
    const look = () => {
      const shell = document.querySelector('.shell');
      if (shell) seen.add(getComputedStyle(shell).backgroundImage);
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await page.goto(pageUrl('index.html'));
  await expect(page.getByText('Restoring your session...')).toBeVisible();
  const waiting = await page.evaluate(() => {
    const shell = getComputedStyle(document.querySelector('.shell')!);
    return { pending: document.documentElement.hasAttribute('data-theme-pending'), image: shell.backgroundImage, colour: shell.backgroundColor, body: getComputedStyle(document.body).backgroundColor };
  });
  expect(waiting).toEqual({ pending: true, image: 'none', colour: 'rgb(0, 1, 2)', body: 'rgb(0, 1, 2)' });

  release();
  await expect(page.getByText("Welcome to the Domino's experience.", { exact: true })).toBeVisible();
  const themed = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      pending: root.hasAttribute('data-theme-pending'), client: root.dataset.client, version: root.dataset.themeVersion, source: root.dataset.themeSource,
      mid: root.style.getPropertyValue('--bg-mid'), action: root.style.getPropertyValue('--action'),
      shell: getComputedStyle(document.querySelector('.shell')!).backgroundImage,
      backgrounds: [...(window as unknown as { shellBackgrounds: Set<string> }).shellBackgrounds],
    };
  });
  expect(themed).toMatchObject({ pending: false, client: 'c-dominos', version: '1', source: 'stored', mid: '#0B648F', action: '#256C96' });
  expect(themed.shell).toContain('rgb(11, 100, 143)');
  expect(themed.backgrounds.some((value) => value.includes('rgb(4, 91, 204)')), 'the default blue never appeared').toBe(false);
  // The logo slot is the name in plain type: no picture, and nothing drawn to stand in for one.
  await expect(page.locator('.pms-hero-text')).toHaveText("Domino's");
  await expect(page.locator('.pms-hero img, .pms-hero svg')).toHaveCount(0);
});

test('throttled saves wait as long as the server asks and still arrive, while the participant carries on', async ({ page }) => {
  const fake = newFake();
  const session = await seedAndGoLive(fake, 'c-kroger');
  const code = await visitorCode(fake, session.id, 'c-kroger');
  await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('index.html')}?qr=${code}`);
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await page.getByRole('button', { name: "Kroger's History" }).click();
  await choices(page).nth(1).click();
  await expect.poll(() => fake.count({ method: 'POST', list: 'responses' })).toBe(1);
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // The next save is refused twice: 429, then 503, each asking for a one-second wait.
  fake.reset();
  fake.failNext({ status: 429, retryAfter: 1, when: (entry) => entry.method === 'MERGE' && entry.list === 'responses' });
  await choices(page).nth(0).click();
  await expect.poll(() => fake.count({ method: 'MERGE', list: 'responses' })).toBe(1);
  fake.failNext({ status: 503, retryAfter: 1, when: (entry) => entry.method === 'MERGE' && entry.list === 'responses' });
  // Next does not wait for any of it.
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Question 3 of 5' })).toBeVisible();
  await expect.poll(() => fake.select({ method: 'MERGE', list: 'responses' }).filter((entry) => !entry.faulted).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  const tries = fake.select({ method: 'MERGE', list: 'responses' });
  expect(tries.map((entry) => entry.faulted ?? 204).slice(0, 3)).toEqual([429, 503, 204]);
  expect(tries[1].at - tries[0].at).toBeGreaterThanOrEqual(1000);
  expect(tries[2].at - tries[1].at).toBeGreaterThanOrEqual(1000);
  expect(JSON.parse(fake.lists.get('responses')![0].ResponsesJson as string)).toHaveLength(2);
});

test('nothing live: the page says so in the default look, asks SharePoint very little, and turns live by itself', async ({ page }) => {
  const fake = newFake();
  await onSite(fake, (ds) => seedPack(ds, samplePack())); // both clients exist, but neither has been made live
  await serveSharePoint(page, fake);
  await page.clock.install();
  fake.reset();
  await page.goto(pageUrl('index.html'));
  await expect(page.getByRole('heading', { name: "Today's experience isn't live yet" })).toBeVisible();
  await expect(page.getByText('Your facilitator will start it shortly. This page will update by itself.')).toBeVisible();
  expect(fake.requests.map(shape).sort()).toEqual(['GET /web/currentuser', 'GET appsettings']);
  expect(await page.evaluate(() => [document.documentElement.hasAttribute('data-theme-pending'), document.documentElement.style.getPropertyValue('--bg-mid')])).toEqual([false, '']);
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toHaveCount(0);

  // The facilitator goes live with Domino's. The page finds out on its next check: a waiting page looks every 20 seconds, give or take 20%.
  await onSite(fake, (ds) => ds.activateClient('c-dominos', '2026-10-11'));
  fake.reset();
  await page.clock.fastForward(24_500);
  await expect(page.getByText("Welcome to the Domino's experience.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--bg-mid'))).toBe('#0B648F');
  await expect(page.getByRole('heading', { name: "Today's experience isn't live yet" })).toHaveCount(0);
});

test('the hub still reads, and comes up, when drawing what it holds needs a read of the answers that fails (Phase 10j)', async ({ page }) => {
  const fake = newFake();
  const session = await seedAndGoLive(fake, 'c-kroger');
  await onSite(fake, (ds) => ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger', { sharePointUserId: '42' }));
  await serveSharePoint(page, fake);
  // The boot's look for this account's earlier visit fails, so Welcome looks for itself; the reads of that visit's answers fail twice: Welcome's,
  // and the one the hub's first drawing needs (nothing on this page has read them). Before the fix the hub then stayed on its loading line.
  fake.failNext({ status: 500, times: 1, when: (entry) => entry.method === 'GET' && entry.list === 'tracks' && /SessionId eq/.test(entry.query) && !/QrTokenId eq/.test(entry.query) });
  fake.failNext({ status: 500, times: 2, when: (entry) => entry.method === 'GET' && entry.list === 'responses' && /TrackId eq/.test(entry.query) });
  await page.goto(pageUrl('index.html'));
  await expect(page.getByRole('button', { name: 'Start a new visit' }), 'Welcome found the earlier visit itself').toBeVisible();
  await page.getByRole('button', { name: /^(Activities|Click here to begin)$/ }).click();
  await expect(page.locator('button.activity')).toHaveCount(2, { timeout: 15_000 });
  expect(fake.select((entry) => entry.list === 'responses' && entry.method === 'GET').filter((entry) => entry.faulted).length, 'both reads failed').toBe(2);
});

