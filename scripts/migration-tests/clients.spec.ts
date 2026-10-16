import { test, expect, type Page } from '@playwright/test';
import { freePort } from '../free-port.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ds from '../../public/js/dataService.js';
import { sharePointFolderPath } from '../deployment-config.js';

// The two seeded clients, end to end: the BUILT participant page against the REAL local server
// (server/index.js) running on a scratch copy of server/data. No synthetic fixture: what is on the
// screen is what the seed data says, read through the local adapter, and every answer lands in
// the scratch participantresponses.json. Each client shows its own theme, title and activities.

const root = fileURLToPath(new URL('../..', import.meta.url));
const shots = fileURLToPath(new URL('../../test-results/flow/', import.meta.url));
const results = fileURLToPath(new URL('../../test-results/budget/', import.meta.url));
const app = `${sharePointFolderPath}/index.html`;
const DAY = '2026-10-11';

let server: ChildProcess;
let dataDir: string;
let api: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'cec-clients-'));
  await cp(path.join(root, 'server', 'data'), dataDir, { recursive: true });
  const port = await freePort();
  server = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    server.once('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
    server.stdout!.on('data', (chunk) => String(chunk).includes('running') && resolve());
  });
  api = `http://127.0.0.1:${port}`;
  ds.configure({ baseUrl: `${api}/api` });
  await mkdir(shots, { recursive: true });
  await mkdir(results, { recursive: true });
});

test.afterAll(async () => {
  server?.kill();
  ds.configure({ baseUrl: '/api' });
  await rm(dataDir, { recursive: true, force: true });
});

/** Sends the page's /api requests to the scratch server, and keeps a list of them. */
async function useServer(page: Page) {
  const requests: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(`${request.method()} ${url.pathname.replace('/api/', '').split('/')[0]}`);
    const response = await route.fetch({ url: `${api}${url.pathname}${url.search}` });
    await route.fulfill({ response }).catch(() => {}); // (as in admin-local.ts: a page that is closing may take the answer back)
  });
  return requests;
}

const theme = (page: Page) => page.evaluate(() => {
  const root = document.documentElement;
  const read = (name: string) => root.style.getPropertyValue(name);
  return { client: root.dataset.client, source: root.dataset.themeSource, version: root.dataset.themeVersion, mid: read('--bg-mid'), bottom: read('--bg-bottom'), action: read('--action'), shell: getComputedStyle(document.querySelector('.shell')!).backgroundImage };
});
const choices = (page: Page) => page.locator('.pms-options button');
const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });
const submit = (page: Page) => page.getByRole('button', { name: 'Submit', exact: true });
/**
 * Every button on the screen whose fill is within 30 degrees of the wrong-answer red, as the
 * browser paints it. An answer that IS marked wrong is meant to be that red and is left out; a
 * white or translucent-white fill has no hue. The list should be empty for every client.
 */
const redControls = (page: Page) => page.evaluate(() => {
  const hue = (colour: string) => {
    const [red, green, blue, alpha = 1] = (colour.match(/[\d.]+/g) ?? []).map(Number);
    const [r, g, b] = [red / 255, green / 255, blue / 255];
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    if (alpha < 0.5 || delta < 0.08) return null;
    const sector = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return (sector * 60 + 360) % 360;
  };
  const probe = document.createElement('i');
  probe.style.background = 'var(--danger)';
  document.body.append(probe);
  const danger = hue(getComputedStyle(probe).backgroundColor)!;
  probe.remove();
  return [...document.querySelectorAll<HTMLElement>('button, [role="button"]')]
    .filter((control) => control.dataset.state !== 'incorrect' && control.getClientRects().length > 0)
    .map((control) => ({ name: (control.getAttribute('aria-label') ?? control.textContent ?? '').trim().replace(/\s+/g, ' '), fill: getComputedStyle(control).backgroundColor }))
    .filter(({ fill }) => {
      const value = hue(fill);
      if (value === null) return false;
      const apart = Math.abs(value - danger) % 360;
      return Math.min(apart, 360 - apart) <= 30;
    });
});
const fillOf = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).evaluate((control) => getComputedStyle(control).backgroundColor);

const shoot = async (page: Page, name: string) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${shots}${name}.png`, fullPage: true });
};

test('before anyone goes live the page says the experience is not live, in the default look', async ({ page }) => {
  const requests = await useServer(page);
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto(app);
  await expect(page.getByRole('heading', { name: "Today's experience isn't live yet" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
  expect(requests).toEqual(['GET appsettings']);
  expect((await theme(page)).mid, 'no client colour is applied').toBe('');
  await shoot(page, 'not-live-820x1180');
});

test('Kroger: the mockup. Its palette, its event title, its activities in order, question 1 and Guess the Brand', async ({ page }) => {
  const { session } = await ds.activateClient('c-kroger', DAY);
  expect(session.id).toBe(`kroger-${DAY}`);
  const requests = await useServer(page);
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(app);

  // Welcome, in Kroger's look.
  await expect(page.getByText('Welcome to the Kroger experience.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  // Four requests to the first screen on the local server, which has no signed-in user to ask about. Once the screen is up: the visit log,
  // and (Phase 10j) every enabled activity's questions and options, read once and held.
  await expect.poll(() => requests.filter((entry) => /questions|options/.test(entry)).sort()).toEqual(['GET options', 'GET questions']);
  const boot = requests.filter((entry) => entry !== 'POST uservisitlogs');
  expect(boot.slice(0, 4)).toEqual(['GET appsettings', 'GET clients', 'GET sessions', 'GET sections']);
  expect([...boot.slice(4)].sort()).toEqual(['GET options', 'GET questions']);
  await writeFile(`${results}local-boot.json`, `${JSON.stringify({ toFirstScreen: 4, requests: boot.slice(0, 4), afterFirstScreen: boot.slice(4) }, null, 2)}\n`);
  expect(await theme(page)).toMatchObject({ client: 'c-kroger', source: 'stored', version: '1', mid: '#045BCC', bottom: '#0444A8', action: '#296CD4' });
  expect((await theme(page)).shell).toContain('rgb(4, 91, 204)');
  // Phase 9b (SAM-1): Kroger ships with no logo (the drawn stand-in is gone), so its name is on the plate in type, as Domino's has always been.
  await expect(page.locator('.pms-hero-text'), 'no logo file: the name in type on the plate').toHaveText('Kroger');
  await expect(page.locator('.pms-hero img')).toHaveCount(0);
  await expect(page).toHaveTitle(/Welcome/);
  expect(await fillOf(page, 'Click here to begin')).toBe('rgb(41, 108, 212)');
  expect(await page.locator('.pms-hero').evaluate((plate) => getComputedStyle(plate, '::after').borderTopColor), 'Kroger has no accent: no ring on the plate').toBe('rgba(255, 255, 255, 0)');
  expect(await redControls(page)).toEqual([]);
  await shoot(page, 'kroger-welcome-820x1180');

  // The hub: the event title and subtitle from the theme, the activities in order, locked in sequence.
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  const title = page.getByRole('heading', { level: 1, name: 'Kroger Trivia Night' });
  await expect(title).toBeVisible();
  expect(await title.evaluate((element) => getComputedStyle(element).textTransform)).toBe('uppercase');
  await expect(page.getByText("Celebrating 140+ years of Kroger's history and the people who built them.")).toBeVisible();
  await expect(page.locator('button.activity')).toHaveText([/Kroger's History/, /Guess the Brand/, /Confidence Continuum/, /Open Feedback/]);
  await expect(page.locator('button.activity').nth(0)).toHaveAttribute('data-state', 'default');
  await expect(page.locator('button.activity[data-state="locked"]')).toHaveCount(3);
  await expect(page.getByText('Straight Talk'), 'a disabled activity is not shown').toHaveCount(0);
  await shoot(page, 'kroger-hub-820x1180');

  // Kroger's History: the section's own description, then question 1 as the mockup has it.
  await page.getByRole('button', { name: "Kroger's History" }).click();
  await expect(page.getByRole('heading', { level: 1, name: "Kroger's History" })).toBeVisible();
  await expect(page.getByText("Celebrating 140+ years of Kroger's history and the people who built them.")).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toContainText('In 1883, Barney Kroger and his friend B.A. Branagan rented a storefront and started operations. What was the name of their first store?');
  await expect(choices(page)).toHaveText([/^A\s*Kroger grocery and Baking co\.\s*$/, /^B\s*Great Western Tea co\.\s*$/, /^C\s*Kroger's\s*$/, /^D\s*Kroger\s*$/]);
  await shoot(page, 'kroger-question-820x1180');
  await choices(page).nth(1).click();
  await expect(choices(page).nth(1)).toHaveAttribute('data-state', 'correct');
  await expect(choices(page).nth(1)).toContainText('Correct');
  await next(page).click();
  // Questions 2 to 5 are the earlier placeholders, kept.
  await expect(page.getByRole('heading', { level: 2 })).toContainText('invested his life savings of $372');
  for (const [index, right] of [0, 2, 0, 2].entries()) {
    await choices(page).nth(right).click();
    await expect(choices(page).nth(right)).toHaveAttribute('data-state', 'correct');
    await (index === 3 ? submit(page) : next(page)).click();
  }
  await expect(page.getByText('5 of 5 right on the first try')).toBeVisible();

  // Guess the Brand is unlocked now: a 2x2 grid of TEXT tiles (no logos are uploaded), Home Chef right.
  await page.getByRole('button', { name: 'Back to activities' }).click();
  await expect(page.getByRole('button', { name: "Kroger's History Completed" })).toHaveAttribute('data-state', 'done');
  await page.getByRole('button', { name: /Guess the Brand/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Guess the Brand' })).toBeVisible();
  await expect(page.getByText('Solve the hints the best you can and spot the right Kroger brand!')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toContainText('When work runs long and plans go stray, Kroger helps home-cooked meals find their way.');
  await expect(page.locator('.pms-grid button.tile')).toHaveText(['Kroger', 'Home Chef', 'Bloom Haus', 'Smart Way']);
  await expect(page.locator('.pms-grid button.tile img')).toHaveCount(0);
  await shoot(page, 'kroger-tiles-820x1180');
  await page.getByRole('button', { name: 'Bloom Haus' }).click();
  await expect(page.getByRole('button', { name: /Bloom Haus/ })).toHaveAttribute('data-state', 'incorrect');
  expect(await redControls(page), 'beside a wrong answer, Retry and Home are still plainly not red').toEqual([]);
  await shoot(page, 'kroger-tiles-wrong-820x1180');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('button', { name: 'Home Chef' }).click();
  await expect(page.getByRole('button', { name: /Home Chef/ })).toHaveAttribute('data-state', 'correct');
  await submit(page).click();
  await expect(page.getByText('0 of 1 right on the first try')).toBeVisible();

  // What the local server now holds: one item for this participant, in the session made for today.
  const [track] = await ds.listClientTracks(session.id);
  const own = await ds.getParticipantResponses(track.id);
  expect(own).toMatchObject({ trackId: track.id, sessionId: `kroger-${DAY}`, clientId: 'c-kroger' });
  expect(own.responses.map((record: { questionId: string }) => record.questionId)).toEqual(['q-trivia-1', 'q-trivia-2', 'q-trivia-3', 'q-trivia-4', 'q-trivia-5', 'q-brand-1']);
  expect(own.responses.at(-1)).toMatchObject({ firstAnswer: 'o-brand-1-c', answer: 'o-brand-1-b', attempts: 2, correct: false });

  // The Live display (the Master screen's successor, in the admin page) tallies those answers through the one reader.
  await page.goto(`${sharePointFolderPath}/admin.html#live-display/${session.id}`);
  await page.getByRole('textbox', { name: 'PIN' }).fill('1234');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Live results' })).toBeVisible();
  await expect(page.getByText(/6 answers from 1 iPad\b/)).toBeVisible();
});

test("Domino's: its own colours, title and two activities, with the name in type where a logo would be", async ({ page }) => {
  const { session } = await ds.activateClient('c-dominos', DAY);
  expect(session.id).toBe(`dominos-${DAY}`);
  await useServer(page);
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(app);

  await expect(page.getByText("Welcome to the Domino's experience.", { exact: true })).toBeVisible();
  // The buttons are the primary's blue. The red accent (#E21737) colours no control.
  expect(await theme(page)).toMatchObject({ client: 'c-dominos', source: 'stored', version: '1', mid: '#0B648F', action: '#256C96' });
  expect((await theme(page)).shell).toContain('rgb(11, 100, 143)');
  expect(await fillOf(page, 'Click here to begin')).toBe('rgb(37, 108, 150)');
  expect(await redControls(page)).toEqual([]);
  // Where the accent does show: a thin ring drawn on the white logo plate, which it stands out from.
  expect(await page.locator('.pms-hero').evaluate((plate) => getComputedStyle(plate, '::after').borderTopColor)).toBe('rgb(226, 23, 55)');
  // No logo file exists for Domino's, and none is drawn: the plate carries the name in ExtraBold type.
  const plate = page.locator('.pms-hero');
  await expect(plate.locator('.pms-hero-text')).toHaveText("Domino's");
  await expect(plate.locator('img, svg, canvas')).toHaveCount(0);
  expect(await plate.locator('.pms-hero-text').evaluate((element) => [getComputedStyle(element).fontWeight, getComputedStyle(element).fontFamily.includes('Open Sans')])).toEqual(['800', true]);
  expect(await plate.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)');
  await shoot(page, 'dominos-welcome-820x1180');

  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(page.getByRole('heading', { level: 1, name: "Domino's Trivia Night" })).toBeVisible();
  await expect(page.getByText("Celebrating 65+ years of Domino's history and the people who built it.")).toBeVisible();
  await expect(page.locator('button.activity')).toHaveText([/Domino's History/, /Guess the Innovation/]);
  await expect(page.getByText(/Kroger/), "nothing of yesterday's client").toHaveCount(0);
  await shoot(page, 'dominos-hub-820x1180');

  await page.getByRole('button', { name: "Domino's History" }).click();
  await expect(page.getByText("How well do you know the Domino's story?")).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toContainText("Domino's opened its first store in 1960. In which U.S. state was it?");
  await expect(choices(page)).toHaveText([/Ohio/, /Michigan/, /Illinois/, /New York/]);
  await expect(page.getByText('Question 1 of 5', { exact: true })).toBeVisible();
  expect(await redControls(page)).toEqual([]);
  expect(await page.locator('.pms-divider').evaluate((rule) => getComputedStyle(rule).borderTopColor), 'red is too weak on this blue for the thin rule, so it stays white').toBe('rgb(255, 255, 255)');
  await shoot(page, 'dominos-question-820x1180');
  // A wrong first answer: the only red on the screen is the answer marked Incorrect. Retry and Home are blue.
  await choices(page).nth(0).click();
  await expect(choices(page).nth(0)).toHaveAttribute('data-state', 'incorrect');
  expect(await choices(page).nth(0).evaluate((control) => getComputedStyle(control).backgroundColor)).toBe('rgb(224, 0, 0)');
  expect(await fillOf(page, 'Retry')).toBe('rgb(37, 108, 150)');
  expect(await redControls(page)).toEqual([]);
  await shoot(page, 'dominos-question-wrong-820x1180');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  for (const [index, right] of [1, 2, 0, 1, 3].entries()) {
    await choices(page).nth(right).click();
    await expect(choices(page).nth(right)).toHaveAttribute('data-state', 'correct');
    if (index === 0) expect(await fillOf(page, 'Next')).toBe('rgb(37, 108, 150)');
    await (index === 4 ? submit(page) : next(page)).click();
  }
  await expect(page.getByText('4 of 5 right on the first try')).toBeVisible();

  await page.getByRole('button', { name: 'Back to activities' }).click();
  await page.getByRole('button', { name: /Guess the Innovation/ }).click();
  await expect(page.getByText("Read the clue and spot the right Domino's innovation!")).toBeVisible();
  await expect(page.getByText('Question 1 of 3', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toContainText('Follow your order from the oven to your door, step by step.');
  await expect(page.locator('.pms-grid button.tile')).toHaveText(["Domino's Tracker", 'Carside Delivery', 'DXP', 'Pizza Profiles']);
  await expect(page.locator('.pms-grid button.tile img')).toHaveCount(0);
  expect(await redControls(page)).toEqual([]);
  await shoot(page, 'dominos-tiles-820x1180');
  for (const [index, name] of ["Domino's Tracker", 'Carside Delivery', 'DXP'].entries()) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.pms-grid button.tile[data-state="correct"]')).toHaveCount(1);
    await (index === 2 ? submit(page) : next(page)).click();
  }
  await expect(page.getByText('3 of 3 right on the first try')).toBeVisible();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Thank you/ })).toBeVisible();
  await expect(page.getByText('2 activities completed')).toBeVisible();
  await expect(page.getByText('7 of 8 right on the first try')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start over' })).toHaveCount(0);

  const tracks = await ds.listClientTracks(session.id);
  expect(tracks).toHaveLength(1);
  expect((await ds.getParticipantResponses(tracks[0].id)).responses).toHaveLength(8);
  const page1 = await ds.listSessionParticipants(session.id);
  expect(page1.items.map((item: { trackId: string }) => item.trackId)).toEqual([tracks[0].id]);
  // Kroger's answers from the earlier test are in Kroger's session, untouched and separate.
  expect((await ds.listSessionParticipants(`kroger-${DAY}`)).items).toHaveLength(1);
});

test("a page left open follows the facilitator from one client to the next, look and all", async ({ page }) => {
  await ds.activateClient('c-kroger', DAY);
  await useServer(page);
  await page.goto(app);
  await expect(page.getByText('Welcome to the Kroger experience.', { exact: true })).toBeVisible();
  expect((await theme(page)).mid).toBe('#045BCC');
  // Nobody touches the iPad. The facilitator makes Domino's today's client.
  await ds.activateClient('c-dominos', DAY);
  await expect(page.getByText("Welcome to the Domino's experience.", { exact: true })).toBeVisible({ timeout: 10_000 });
  expect(await theme(page)).toMatchObject({ client: 'c-dominos', mid: '#0B648F', action: '#256C96' });
  await expect(page.locator('.pms-hero-text')).toHaveText("Domino's");

  // Someone in the middle of a Kroger visit is told, and lands on Domino's Welcome.
  await ds.activateClient('c-kroger', DAY);
  await expect(page.getByText('Welcome to the Kroger experience.', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /Click here to begin|Activities/ }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Kroger Trivia Night' })).toBeVisible();
  await ds.activateClient('c-dominos', DAY);
  await expect(page.getByText(/changed the active session/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Welcome to the Domino's experience.", { exact: true })).toBeVisible();
  expect((await theme(page)).mid).toBe('#0B648F');
});

test('an archived client is not shown to anyone, and an ended session says so', async ({ page }) => {
  await ds.activateClient('c-dominos', DAY);
  await ds.updateClient('c-dominos', { status: 'archived' });
  await useServer(page);
  await page.goto(app);
  await expect(page.getByRole('heading', { name: "Today's experience isn't live yet" })).toBeVisible();
  await expect(page.getByText(/Domino/)).toHaveCount(0);
  expect((await theme(page)).mid).toBe('');

  await ds.updateClient('c-dominos', { status: 'active' });
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByText("Welcome to the Domino's experience.", { exact: true })).toBeVisible();

  await ds.endSession(`dominos-${DAY}`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'This session has ended.' })).toBeVisible();
  await expect(page.getByText('Thank you. Your answers are saved.')).toBeVisible();
});
