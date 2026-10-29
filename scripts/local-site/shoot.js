// The UX review's screenshot harness (Phase 12): `npm run ux:shoot` walks the participant, admin and Setup pages of the release package on the local PCOE
// site, in Playwright's Chromium, WebKit and Firefox at the review's device sizes, and writes PNGs to ux-review/<date>/ (git-ignored) with a contact
// sheet (index.html), a manifest (shots.json: each picture's flow, device, state and the requests it took) and ux-review.zip of the whole folder.
//
//   npm run ux:shoot                         every flow
//   npm run ux:shoot -- --only participant   one flow (participant, admin, setup, states, brand, fonts)
//   npm run ux:shoot -- --package <folder>   another package's pages
//   npm run ux:shoot -- --devices laptop-1366,ipad-portrait   only those devices
//   npm run ux:shoot -- --matrix brief       every flow at the device matrix of devices.spec.ts (Phase 15's alignment review)
//   npm run ux:shoot -- --measure            also measure every picture's geometry (align-probe.js) into alignment.json
//
// Pictures are made the same way every time: the scenario is rebuilt before each flow, the page's clock starts at 16 Oct 2026, 17:00 in India, the
// API answers with no added latency (the slow profile is a state of its own), fonts are waited for, and animations are switched off for the shot.
//
// Chromium reaches pms-local.test through --host-rules (a real network connection). WebKit and Firefox cannot be told that, so their requests to
// pms-local.test are passed to the local site by the harness (page.route) and its answers handed back: known, and harmless here, except that
// Playwright's WebKit drops the boundary of such a $batch answer (migration/playwright.config.ts says so), so a WebKit page reads its lists one by one.

import '../fresh-page.js';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { chromium, firefox, webkit } from '@playwright/test';
import { startLocalSite } from './server.js';
import { alignmentProbe } from './align-probe.js';
import { ADMIN, HOST, NOW, ORIGIN, pageUrl } from './site-shape.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const option = (name) => { const at = args.indexOf(`--${name}`); return at === -1 ? null : args[at + 1]; };
const only = option('only')?.split(',') ?? null;
const devicesWanted = option('devices')?.split(',') ?? null;
const want = (device) => !devicesWanted || devicesWanted.includes(device);
const measuring = args.includes('--measure');
const matrix = option('matrix') === 'brief';
const date = option('date') ?? new Date().toISOString().slice(0, 10);
export const OUT = path.join(ROOT, 'ux-review', date);

/** The review's devices. `engine` is the browser; `scale` the device pixel ratio (Windows' 125% and 150% scaling are 1.25 and 1.5). */
export const DEVICES = {
  'ipad-portrait': { engine: 'webkit', viewport: { width: 820, height: 1180 }, scale: 2, mobile: true, label: 'iPad (10th gen) portrait, WebKit' },
  'ipad-landscape': { engine: 'webkit', viewport: { width: 1180, height: 820 }, scale: 2, mobile: true, label: 'iPad (10th gen) landscape, WebKit' },
  'ipad-pro-11': { engine: 'webkit', viewport: { width: 834, height: 1194 }, scale: 2, mobile: true, label: 'iPad Pro 11 portrait, WebKit' },
  'iphone-15': { engine: 'webkit', viewport: { width: 393, height: 852 }, scale: 3, mobile: true, label: 'iPhone 15, WebKit' },
  'laptop-1366': { engine: 'chromium', viewport: { width: 1366, height: 768 }, scale: 1, label: 'Windows laptop 1366x768, Chromium' },
  'laptop-1536-125': { engine: 'chromium', viewport: { width: 1536, height: 864 }, scale: 1.25, label: 'Windows laptop 1536x864 at 125%, Chromium' },
  'laptop-1280-150': { engine: 'chromium', viewport: { width: 1280, height: 720 }, scale: 1.5, label: 'Windows laptop 1280x720 at 150%, Chromium' },
  projector: { engine: 'chromium', viewport: { width: 1920, height: 1080 }, scale: 1, label: 'Projector 1920x1080, Chromium' },
  'firefox-1440': { engine: 'firefox', viewport: { width: 1440, height: 900 }, scale: 1, label: 'Desktop 1440x900, Firefox' },
  // The matrix of scripts/migration-tests/devices.spec.ts (Phase 15): `--matrix brief` runs every flow at these instead of its own list.
  'm-iphone-portrait': { engine: 'webkit', viewport: { width: 390, height: 844 }, scale: 3, mobile: true, label: 'iPhone 390x844, WebKit' },
  'm-iphone-landscape': { engine: 'webkit', viewport: { width: 844, height: 390 }, scale: 3, mobile: true, label: 'iPhone 844x390, WebKit' },
  'm-ipad-portrait': { engine: 'webkit', viewport: { width: 820, height: 1180 }, scale: 2, mobile: true, label: 'iPad 820x1180, WebKit' },
  'm-ipad-landscape': { engine: 'webkit', viewport: { width: 1180, height: 820 }, scale: 2, mobile: true, label: 'iPad 1180x820, WebKit' },
  'm-ipad-pro': { engine: 'webkit', viewport: { width: 1024, height: 1366 }, scale: 2, mobile: true, label: 'iPad Pro 1024x1366, WebKit' },
  'm-laptop-1366': { engine: 'chromium', viewport: { width: 1366, height: 768 }, scale: 1, label: 'Laptop 1366x768, Chromium' },
  'm-desktop-1440': { engine: 'chromium', viewport: { width: 1440, height: 900 }, scale: 1, label: 'Desktop 1440x900, Chromium' },
};
const MATRIX = Object.keys(DEVICES).filter((key) => key.startsWith('m-'));
/** A flow's devices: its own list, or the brief's matrix with `--matrix brief`; either narrowed by `--devices`. */
const pick = (list) => (matrix ? [...MATRIX, ...list.filter((device) => device === 'laptop-1536-125')] : list).filter(want);
const alignment = [];

const manifest = [];
const problems = [];
let running;
const browsers = {};

async function browser(engine) {
  if (!browsers[engine]) {
    const kind = { chromium, webkit, firefox }[engine];
    browsers[engine] = await kind.launch(engine === 'chromium' ? { args: running.browserArgs } : {});
  }
  return browsers[engine];
}

/** Passes a request for pms-local.test to the local site and returns its answer (WebKit and Firefox). */
async function forward(request, persona) {
  // (The persona is set here: a route sees no cookie of the page in Playwright's WebKit on Windows.)
  const headers = { ...(await request.allHeaders()), host: HOST, cookie: `pms-local-persona=${persona}` };
  return new Promise((resolve, reject) => {
    const url = new URL(request.url());
    delete headers['accept-encoding'];
    const body = request.postDataBuffer();
    const outgoing = https.request({ host: '127.0.0.1', port: running.port, servername: HOST, method: request.method(), path: url.pathname + url.search, headers, rejectUnauthorized: false }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([name]) => !['content-length', 'connection', 'transfer-encoding'].includes(name)).map(([name, value]) => [name, String(value)])), body: Buffer.concat(chunks) }));
    });
    outgoing.on('error', reject);
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

/**
 * A page on `device` as `persona`. Options: `reducedMotion`, `forcedColors`, `textZoom` (CSS zoom of the root, for 200%), `offline` (set later).
 * Records any request that leaves pms-local.test and any answer of 400 or more, against the shot it happens in.
 */
export async function open(deviceKey, persona = 'admin', { reducedMotion = 'no-preference', forcedColors = 'none', colorScheme = 'light' } = {}) {
  const device = DEVICES[deviceKey];
  const context = await (await browser(device.engine)).newContext({
    viewport: device.viewport, deviceScaleFactor: device.scale, isMobile: device.engine === 'webkit' ? Boolean(device.mobile) : undefined, hasTouch: Boolean(device.mobile),
    ignoreHTTPSErrors: true, timezoneId: 'Asia/Kolkata', locale: 'en-US', reducedMotion, forcedColors, colorScheme,
  });
  await context.addCookies([{ name: 'pms-local-persona', value: persona, domain: HOST, path: '/', secure: true }]);
  if (device.engine !== 'chromium') {
    await context.route(`${ORIGIN}/**`, async (route) => {
      try { await route.fulfill(await forward(route.request(), persona)); } catch { await route.abort('connectionfailed'); }
    });
  }
  const page = await context.newPage();
  await page.clock.install({ time: new Date(NOW) });
  page.on('request', (request) => { if (!request.url().startsWith(`${ORIGIN}/`) && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) problems.push({ kind: 'third-party request', url: request.url(), device: deviceKey }); });
  page.on('response', (response) => { if (response.status() >= 400 && !response.url().includes('/__local/')) page.__failures = [...(page.__failures ?? []), `${response.status()} ${decodeURIComponent(new URL(response.url()).pathname)}`]; });
  page.on('pageerror', (error) => problems.push({ kind: 'page error', message: String(error?.message ?? error), device: deviceKey }));
  return { context, page, device: deviceKey };
}

/** Takes one picture: waits for fonts and a quiet moment, switches animations off, and writes the PNG and its manifest row. */
export async function shot(view, { flow, id, title, state = 'default', fullPage = true, note = '' }) {
  const { page, device } = view;
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(350);
  const dir = path.join(OUT, flow);
  mkdirSync(dir, { recursive: true });
  const file = `${id}--${device}.png`;
  if (measuring) {
    const findings = await page.evaluate(alignmentProbe, { touch: Boolean(DEVICES[device].mobile) }).catch((error) => [{ kind: 'probe-failed', where: '-', measured: 0, detail: String(error?.message ?? error).slice(0, 200), text: '' }]);
    alignment.push({ flow, id, title, state, device, file: `${flow}/${file}`, findings });
  }
  await page.screenshot({ path: path.join(dir, file), fullPage, animations: 'disabled', caret: 'hide' });
  const since = view.logAt ?? 0;
  const requests = running.site.log.slice(since);
  view.logAt = running.site.log.length;
  manifest.push({ flow, id, title, state, device, deviceLabel: DEVICES[device].label, file: `${flow}/${file}`, url: page.url().replace(ORIGIN, ''), requests: requests.length, failed: page.__failures ?? [], note });
  page.__failures = [];
  process.stdout.write('.');
}

const scenario = async (name, change) => {
  await running.site.load(name, { rebuild: true });
  if (change) change(running.site.fake);
};
/** Sets the live session's way in: 'staff' (the staff link) or 'client-visit' (guests scan a personal QR). */
const liveMode = (mode) => (fake) => { for (const row of fake.lists.get('sessions')) if (row.Status !== 'completed') row.ParticipationMode = mode; };

// ---- The participant page -----------------------------------------------------------------------------------------------------------------

const options = (page) => page.locator('.pms-options button');
const button = (page, name) => page.getByRole('button', { name, exact: true });

/** Answers the question on screen: right or wrong first, a ranking in order, words in a text box. Returns the kind it met. */
async function answer(page, { wrongFirst = false, text = 'Clear ownership on both sides, and a weekly check-in we keep.', shots = null } = {}) {
  const box = page.locator('textarea');
  if (await box.count()) { await box.fill(text); return 'text'; }
  const all = options(page);
  await all.first().waitFor();
  const labels = await all.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
  if (labels.some((label) => /not ranked|rank \d/.test(label))) {
    const count = await all.count();
    for (let index = 0; index < count; index += 1) {
      await all.nth(index).click();
      if (shots && index === 1) await shots('ranking-partly');
    }
    return 'ranking';
  }
  const count = await all.count();
  const order = wrongFirst ? [...Array(count).keys()].reverse() : [...Array(count).keys()];
  let wrong = 0;
  for (const index of order) {
    await all.nth(index).click();
    await page.waitForTimeout(150);
    const state = await all.nth(index).getAttribute('data-state');
    if (state === 'incorrect') {
      wrong += 1;
      if (shots) await shots(`wrong-${wrong}`);
      const retry = button(page, 'Retry');
      if (await retry.count()) { await retry.click(); if (shots) await shots('after-retry'); continue; }
      if (shots) await shots('revealed');
      return 'revealed';
    }
    if (state === 'correct' && shots) await shots('correct');
    return state === 'correct' ? 'correct' : 'choice';
  }
  return 'choice';
}
const forward1 = async (page) => {
  for (const name of ['Next', 'Submit']) {
    const control = button(page, name);
    if (await control.count() && await control.isEnabled()) { await control.click(); return name; }
  }
  return null;
};

/** One staff visit through all five of Kroger's activities, a picture of every screen and state on the way. */
async function participantWalk(deviceKey, { full = true } = {}) {
  await scenario('event-day', liveMode('staff'));
  const view = await open(deviceKey, 'staff');
  const { page } = view;
  const flow = 'participant';
  await page.goto(pageUrl('index.html'));
  await button(page, 'Click here to begin').waitFor({ timeout: 30_000 });
  await shot(view, { flow, id: '01-welcome', title: 'Welcome (staff link)' });
  await button(page, 'Click here to begin').click();
  await page.waitForURL(/#\/agenda/);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await shot(view, { flow, id: '02-hub', title: 'Activities hub, nothing done' });
  const titles = ['Straight talk', 'Confidence continuum', 'Survey feedback', 'MCQ', 'Guess the brand'];
  for (const [index, title] of titles.entries()) {
    if (!full && index > 1) break;
    await page.getByRole('button', { name: new RegExp(`^${title}`) }).first().click();
    await page.waitForURL(/#\/quiz\//);
    let step = 1;
    for (;;) {
      await page.getByRole('heading', { level: 1 }).waitFor();
      const base = `03-${index + 1}-${title.toLowerCase().replace(/ /g, '-')}-q${step}`;
      await shot(view, { flow, id: `${base}-unanswered`, title: `${title}, question ${step}`, state: 'unanswered' });
      const kind = await answer(page, { wrongFirst: title === 'MCQ' && step === 1, shots: (state) => shot(view, { flow, id: `${base}-${state}`, title: `${title}, question ${step}`, state }) });
      if (kind === 'text' || kind === 'ranking' || kind === 'choice') await shot(view, { flow, id: `${base}-answered`, title: `${title}, question ${step}`, state: 'answered' });
      const pressed = await forward1(page);
      if (pressed === 'Submit' || pressed === null) break;
      step += 1;
    }
    await button(page, 'Back to activities').or(button(page, 'Finish')).first().waitFor({ timeout: 20_000 });
    await shot(view, { flow, id: `04-${index + 1}-complete`, title: `${title} complete` });
    const back = button(page, 'Back to activities');
    if (index < titles.length - 1 && await back.count()) {
      await back.click();
      await page.waitForURL(/#\/agenda/);
      if (index === 0) await shot(view, { flow, id: '05-hub-one-done', title: 'Hub after one activity' });
    }
  }
  if (full) {
    await button(page, 'Finish').first().click();
    await page.waitForURL(/#\/thank-you/);
    await page.waitForTimeout(800);
    await shot(view, { flow, id: '06-finale', title: 'Finale (thank you)' });
  }
  await view.context.close();
}

/** A named guest arriving by QR code; and the codes that no longer work. */
async function guestFlow(deviceKey) {
  await scenario('event-day');
  const guest = running.site.extras.guests[0];
  const view = await open(deviceKey, 'guest');
  const { page } = view;
  const flow = 'participant-guest';
  await page.goto(`${pageUrl('index.html')}?qr=${guest.token}`);
  await button(page, 'Click here to begin').or(page.getByRole('heading', { level: 1 })).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  await shot(view, { flow, id: '01-welcome-guest', title: `Welcome, a named guest by QR (${guest.name})` });
  await page.goto(`${pageUrl('index.html')}?qr=qr-kroger-01`);
  await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await shot(view, { flow, id: '02-qr-used', title: 'A QR code that was used already' });
  await page.goto(`${pageUrl('index.html')}?qr=qr-does-not-exist`);
  await page.waitForTimeout(1500);
  await shot(view, { flow, id: '03-qr-unknown', title: 'A QR code that does not exist' });
  await page.goto(pageUrl('index.html'));
  await page.waitForTimeout(1500);
  await shot(view, { flow, id: '04-staff-link-in-guest-mode', title: 'The plain link while guests must scan a code' });
  await view.context.close();
}

/** States of the participant page: not live, ended, offline, a busy site, the unsupported notice, reduced motion, 200% text, a slow network. */
async function participantStates(deviceKey) {
  const flow = 'participant-states';
  await scenario('ready');
  let view = await open(deviceKey, 'staff');
  await view.page.goto(pageUrl('index.html'));
  await view.page.getByRole('heading', { level: 1 }).waitFor({ timeout: 30_000 });
  await shot(view, { flow, id: '01-not-live', title: 'Nothing live yet' });
  await view.context.close();

  await scenario('finished', liveMode('staff'));
  view = await open(deviceKey, 'staff');
  await view.page.goto(pageUrl('index.html'));
  await view.page.getByRole('heading', { level: 1 }).waitFor({ timeout: 30_000 });
  await shot(view, { flow, id: '02-session-ended', title: 'The session has ended' });
  await view.context.close();

  await scenario('event-day', liveMode('staff'));
  view = await open(deviceKey, 'staff');
  await view.page.goto(pageUrl('index.html'));
  await button(view.page, 'Click here to begin').click();
  await view.page.waitForURL(/#\/agenda/);
  await view.page.getByRole('button', { name: /^Straight talk/ }).first().click();
  await options(view.page).first().waitFor();
  running.site.offline = true;
  await view.context.setOffline(true);
  await view.page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await answer(view.page);
  await forward1(view.page);
  await view.page.waitForTimeout(6000);
  await shot(view, { flow, id: '03-offline-submit', title: 'Submit while offline' });
  running.site.offline = false;
  await view.context.setOffline(false);
  await view.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await view.page.waitForTimeout(4000);
  await shot(view, { flow, id: '04-back-online', title: 'Back online' });
  await view.context.close();

  await scenario('event-day', liveMode('staff'));
  running.site.faults.push({ status: 503, retryAfter: 1, times: 6 });
  view = await open(deviceKey, 'staff');
  await view.page.goto(pageUrl('index.html'));
  await view.page.waitForTimeout(4000);
  await shot(view, { flow, id: '05-site-busy', title: 'The site answers 503 at start' });
  running.site.faults = [];
  await view.context.close();

  running.site.latency = 'slow';
  await scenario('event-day', liveMode('staff'));
  view = await open(deviceKey, 'staff');
  await view.page.goto(pageUrl('index.html'));
  await view.page.waitForTimeout(1200);
  await shot(view, { flow, id: '06-slow-loading', title: 'Slow network (1,500 ms a request): 1.2 s after opening', fullPage: false });
  await button(view.page, 'Click here to begin').click({ timeout: 30_000 });
  await view.page.waitForTimeout(900);
  await shot(view, { flow, id: '07-slow-begin', title: 'Slow network: just after "Click here to begin"', fullPage: false });
  running.site.latency = 'none';
  await view.context.close();

  await scenario('event-day', liveMode('staff'));
  view = await open(deviceKey, 'staff', { reducedMotion: 'reduce' });
  await view.page.goto(pageUrl('index.html'));
  await button(view.page, 'Click here to begin').click();
  await view.page.waitForURL(/#\/agenda/);
  await view.page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await view.page.waitForTimeout(400);
  await shot(view, { flow, id: '08-hub-text-200', title: 'Hub with text at 200%, reduced motion' });
  await view.page.getByRole('button', { name: /^Straight talk/ }).first().click();
  await options(view.page).first().waitFor();
  await shot(view, { flow, id: '09-ranking-text-200', title: 'Ranking with text at 200%' });
  await view.context.close();

  view = await open(deviceKey, 'staff', { forcedColors: 'active' });
  await view.page.goto(pageUrl('index.html'));
  await button(view.page, 'Click here to begin').waitFor({ timeout: 30_000 });
  await shot(view, { flow, id: '10-forced-colors', title: 'Welcome in forced colours (high contrast)' });
  await view.context.close();
}

/** Keyboard only: a picture of the focus ring on each stop of Welcome and the first question. */
async function keyboardFocus(deviceKey) {
  const flow = 'participant-keyboard';
  await scenario('event-day', liveMode('staff'));
  const view = await open(deviceKey, 'staff');
  const { page } = view;
  await page.goto(pageUrl('index.html'));
  await button(page, 'Click here to begin').waitFor({ timeout: 30_000 });
  for (let stop = 1; stop <= 3; stop += 1) {
    await page.keyboard.press('Tab');
    await shot(view, { flow, id: `01-welcome-tab-${stop}`, title: `Welcome, Tab ${stop}`, fullPage: false });
  }
  await button(page, 'Click here to begin').focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/#\/agenda/);
  await page.getByRole('button', { name: /^Straight talk/ }).first().focus();
  await shot(view, { flow, id: '02-hub-tab', title: 'Hub, focus on an activity', fullPage: false });
  await page.keyboard.press('Enter');
  await options(page).first().waitFor();
  await page.keyboard.press('Tab');
  await shot(view, { flow, id: '03-question-tab', title: 'Ranking question, first Tab', fullPage: false });
  await view.context.close();
}

/** The picture tiles (scenario "tiles"): the test-only sixth Kroger activity. */
async function tiles(deviceKey) {
  await running.site.load('tiles', { rebuild: true });
  const fake = running.site.fake;
  // Kroger live in staff mode, with a free hub (the tiles activity is sixth, after five in sequence).
  const restore = fake.install();
  const ds = await import(`../../migration/src/lib/data/dataService.js?shoot-tiles=${Date.now()}`);
  ds.configure({ sharePoint: fake.settings });
  try {
    const { session } = await ds.activateClient('c-kroger', '2026-10-16');
    await ds.updateSession(session.id, { activityFlow: 'open' });
  } finally { restore(); }
  const view = await open(deviceKey, 'staff');
  const { page } = view;
  await page.goto(pageUrl('index.html'));
  await button(page, 'Click here to begin').click({ timeout: 30_000 });
  await page.waitForURL(/#\/agenda/);
  await page.getByRole('button', { name: /^Guess the brand: picture tiles/ }).first().click();
  await options(page).first().waitFor();
  await page.waitForTimeout(800);
  await shot(view, { flow: 'tiles', id: '01-tiles', title: 'Picture tiles (test content)' });
  await answer(page, { wrongFirst: true, shots: (state) => shot(view, { flow: 'tiles', id: `02-tiles-${state}`, title: 'Picture tiles', state }) });
  await view.context.close();
}

// ---- The admin page -----------------------------------------------------------------------------------------------------------------------

async function unlock(page) {
  await page.goto(pageUrl('admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill(ADMIN.pin);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('tab', { name: 'Today' }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
}
const tab = async (page, name) => { await page.getByRole('tab', { name, exact: true }).click(); await page.waitForTimeout(1500); };

async function adminFlow(deviceKey) {
  const flow = 'admin';
  await scenario('event-day');
  const view = await open(deviceKey, 'admin');
  const { page } = view;
  await page.goto(pageUrl('admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).waitFor({ timeout: 30_000 });
  await shot(view, { flow, id: '01-pin', title: 'PIN' });
  await unlock(page);
  await shot(view, { flow, id: '02-today-live', title: 'Today, Kroger live with guests' });
  await tab(page, 'Clients');
  await shot(view, { flow, id: '03-clients', title: 'Clients' });
  await page.getByRole('button', { name: /^Brand/ }).first().click();
  await page.waitForTimeout(2500);
  await shot(view, { flow, id: '04-brand-studio', title: 'Brand Studio (the first client)' });
  await page.goto(pageUrl('admin.html#content'));
  await page.waitForTimeout(2500);
  await shot(view, { flow, id: '05-content', title: 'Content (the live client)' });
  // (Phase 18: Brand is a view of Content; an address that names it, as a reload would. Before Phase 18 it shows Content as 05 does.)
  await page.goto(pageUrl('admin.html#content/brand'));
  await page.waitForTimeout(2500);
  await shot(view, { flow, id: '05b-content-brand', title: 'Content, the Brand view (the live client)' });
  await tab(page, 'Guests and QR');
  await shot(view, { flow, id: '06-guests', title: 'Guests and QR' });
  await tab(page, 'Results');
  await page.waitForTimeout(2000);
  await shot(view, { flow, id: '07-results', title: 'Results, every session' });
  await page.goto(pageUrl('admin.html#live-display'));
  await page.waitForTimeout(3000);
  await shot(view, { flow, id: '08-live-display', title: 'Live display, every question' });
  await view.context.close();
}

async function adminStates(deviceKey) {
  const flow = 'admin-states';
  await scenario('ready');
  let view = await open(deviceKey, 'admin');
  await unlock(view.page);
  await shot(view, { flow, id: '01-today-nothing-live', title: 'Today, nothing live' });
  await view.page.getByLabel('Client', { exact: true }).selectOption({ label: 'Kroger' }).catch(() => {});
  await view.page.waitForTimeout(1500);
  await shot(view, { flow, id: '02-today-kroger-picked', title: 'Today, Kroger picked, readiness' });
  await view.page.getByRole('button', { name: 'Go live' }).click().catch(() => {});
  await view.page.waitForTimeout(2500);
  await shot(view, { flow, id: '03-today-gone-live', title: 'Today, after Go live (staff mode warning)' });
  await view.context.close();

  await scenario('ready');
  view = await open(deviceKey, 'outsider');
  await view.page.goto(pageUrl('admin.html'));
  await view.page.waitForTimeout(3000);
  await shot(view, { flow, id: '04-outsider-open', title: 'Admin page as an account that may not read PMSAdminUsers' });
  await view.page.getByRole('textbox', { name: 'PIN' }).fill(ADMIN.pin).catch(() => {});
  await view.page.getByRole('button', { name: 'Unlock' }).click().catch(() => {});
  await view.page.waitForTimeout(2500);
  await shot(view, { flow, id: '05-outsider-unlock', title: 'Outsider presses Unlock with a right PIN' });
  await view.context.close();

  await scenario('stress');
  view = await open(deviceKey, 'admin');
  await unlock(view.page);
  await shot(view, { flow, id: '06-stress-today', title: 'Today with 60 clients (stress)', fullPage: false });
  await tab(view.page, 'Results');
  await view.page.waitForTimeout(4000);
  await shot(view, { flow, id: '07-stress-results', title: 'Results, 400 visits and 30 questions (stress): the top of the screen', fullPage: false });
  await view.context.close();
}

/** The Live display in full screen on the projector: every question in turn, Show answer, the wall page. */
async function liveDisplay(deviceKey) {
  const flow = 'live-display';
  await scenario('event-day');
  const view = await open(deviceKey, 'admin');
  const { page } = view;
  await unlock(page);
  await page.goto(pageUrl('admin.html#live-display'));
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Full screen' }).click();
  await page.waitForTimeout(1500);
  for (let index = 1; index <= 10; index += 1) {
    await shot(view, { flow, id: `01-fullscreen-q${String(index).padStart(2, '0')}`, title: `Full screen, question ${index}`, fullPage: false });
    const show = page.getByRole('button', { name: 'Show answer' });
    if (await show.count() && await show.isVisible()) {
      await show.click();
      await page.waitForTimeout(500);
      await shot(view, { flow, id: `02-fullscreen-q${String(index).padStart(2, '0')}-answer`, title: `Full screen, question ${index}, answer shown`, fullPage: false });
    }
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(900);
  }
  await page.keyboard.press('Escape');
  await page.goto(pageUrl('admin.html#live-display/kroger-2026-10-16/wall'));
  await page.waitForTimeout(3000);
  await shot(view, { flow, id: '03-wall', title: 'The wall page (no names)' });
  await view.context.close();
}

// ---- Setup ----------------------------------------------------------------------------------------------------------------------------------

async function setupFlow(deviceKey) {
  const flow = 'setup';
  await scenario('empty');
  const view = await open(deviceKey, 'admin');
  const { page } = view;
  page.on('dialog', (dialog) => { void dialog.accept(); });
  await page.goto(pageUrl('setup.html'));
  await page.waitForTimeout(3000);
  await shot(view, { flow, id: '01-empty-site', title: 'Setup on a site with no lists' });
  await page.getByRole('button', { name: 'Show the plan' }).click().catch(() => {});
  await page.waitForTimeout(2500);
  await shot(view, { flow, id: '02-plan', title: 'The plan' });
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(4000);
  await shot(view, { flow, id: '03-created', title: 'After Create (and Mark ready)' });
  await page.getByRole('textbox', { name: 'Name' }).fill('Brennan, Ingrid').catch(() => {});
  await page.getByRole('textbox', { name: /^PIN/ }).fill('735190').catch(() => {});
  await page.getByRole('textbox', { name: /same PIN/i }).fill('735190').catch(() => {});
  await page.getByRole('button', { name: 'Add an admin' }).click().catch(() => {});
  await page.waitForTimeout(2500);
  await shot(view, { flow, id: '03b-admin-added', title: 'After Add an admin' });
  await scenario('event-day');
  await page.goto(pageUrl('setup.html'));
  await page.waitForTimeout(3000);
  await shot(view, { flow, id: '04-ready-site', title: 'Setup on a ready site' });
  await page.getByRole('button', { name: 'Run self-test' }).click();
  await page.getByText(/Passed: \d+ of \d+|Self-test failed/).waitFor({ timeout: 60_000 });
  await shot(view, { flow, id: '05-self-test', title: 'Self-test' });
  await view.context.close();
}

// ---- VJR's pictures (UX-REVIEW.md: the brand matrix and Brand Studio) -------------------------------------------------------------------------

/** Makes `clientId` live on the running site in staff mode with every activity open, as Today would. */
async function goLiveStaff(clientId) {
  const fake = running.site.fake;
  const restore = fake.install();
  try {
    const ds = await import(`../../migration/src/lib/data/dataService.js?shoot-live=${clientId}-${Date.now()}`);
    ds.configure({ sharePoint: fake.settings });
    const { session } = await ds.activateClient(clientId, '2026-10-16');
    await ds.updateSession(session.id, { activityFlow: 'open', participationMode: 'staff' });
  } finally { restore(); }
}

/** Each client's look (its logo, hero and background, or none for the Template) on Welcome, the hub, a question and a completion screen. */
async function brandMatrix(deviceKey) {
  for (const [clientId, name] of [['c-kroger', 'kroger'], ['c-dominos', 'dominos'], ['c-template', 'template']]) {
    await running.site.load('ready', { rebuild: true });
    await goLiveStaff(clientId);
    const view = await open(deviceKey, 'staff');
    const { page } = view;
    const flow = 'brand';
    await page.goto(pageUrl('index.html'));
    await button(page, 'Click here to begin').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2200);
    await shot(view, { flow, id: `${name}-01-welcome`, title: `${name}: Welcome` });
    await button(page, 'Click here to begin').click();
    await page.waitForURL(/#\/agenda/);
    await page.waitForTimeout(1500);
    await shot(view, { flow, id: `${name}-02-hub`, title: `${name}: hub` });
    await page.getByRole('button', { name: /^MCQ/ }).first().click();
    await options(page).first().waitFor();
    await shot(view, { flow, id: `${name}-03-question`, title: `${name}: a quiz question` });
    for (let step = 0; step < 6; step += 1) {
      await answer(page);
      const pressed = await forward1(page);
      if (pressed === 'Submit' || pressed === null) break;
      await options(page).first().waitFor();
    }
    await button(page, 'Back to activities').first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    await shot(view, { flow, id: `${name}-04-complete`, title: `${name}: activity complete` });
    await view.context.close();
  }
}

/** Each of VJR's pictures through Brand Studio's own upload: the crop dialog, then what the slot says (size, cap, a notice). On the Template. */
async function brandStudioUploads(deviceKey) {
  await running.site.load('ready', { rebuild: true });
  const view = await open(deviceKey, 'admin');
  const { page } = view;
  const flow = 'brand-studio';
  await unlock(page);
  await tab(page, 'Clients');
  await page.locator('li, tr, article, .card').filter({ hasText: 'Template' }).getByRole('button', { name: /^Brand/ }).first().click();
  await page.waitForTimeout(2500);
  const images = path.join(ROOT, 'scripts', 'local-site', 'datasets', 'images');
  const uploads = [
    ['hero', 'hero-fresh-sticker.webp'], ['hero', 'hero-red-blue-ball.webp'], ['logo', 'logo-kroger.webp'], ['logo', 'logo-dominos.webp'],
    ['background', 'bg-red-white-gingham.webp'], ['background', 'bg-light-blue-grain.webp'], ['background', 'bg-dark-blue-stripes.webp'],
    ['hero', 'tile-home-chef.webp'],
  ];
  for (const [slot, file] of uploads) {
    const id = `${slot}-${file.replace(/\.webp$/, '')}`;
    await page.locator(`input[data-slot="${slot}"]`).setInputFiles(path.join(images, file));
    const dialog = page.getByRole('dialog');
    const opened = await dialog.waitFor({ timeout: 8000 }).then(() => true, () => false);
    if (opened) {
      await page.waitForTimeout(800);
      await shot(view, { flow, id: `${id}-1-crop`, title: `Brand Studio, ${slot}: ${file}, the crop dialog`, fullPage: false });
      await dialog.getByRole('button', { name: 'Use this picture' }).click();
    } else await page.waitForTimeout(1500);
    // (How long the browser takes to crop and compress it to the slot's cap: "Preparing the picture..." until it is done.)
    const started = Date.now();
    await page.getByText('Preparing the picture...').first().waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const preparedMs = Date.now() - started;
    const card = page.locator(`input[data-slot="${slot}"]`).locator('xpath=ancestor::*[contains(@class,"card") or self::section or self::article][1]');
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await shot(view, { flow, id: `${id}-2-result`, title: `Brand Studio, ${slot}: ${file}, after choosing it`, fullPage: false, note: `prepared in ${preparedMs} ms (Chromium, this laptop). ${(await card.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(-500)}` });
  }
  await view.context.close();
}

// ---- A mock-up of the reveal line (UX-REVIEW.md: no column holds it, so the app cannot show it) -----------------------------------------------
// The real "Guess the brand" screen after the right answer, with a box drawn into the page by the harness and labelled MOCK-UP on the picture itself.
// Nothing of it is in the app or the package.

async function revealMockup(deviceKey) {
  await scenario('event-day', (fake) => {
    liveMode('staff')(fake);
    for (const row of fake.lists.get('sessions')) row.ActivityFlow = 'open';
  });
  const reveal = running.site.extras.reveals.find((entry) => entry.questionId === 'q-kroger-guess-the-brand-1')?.reveal ?? '';
  const view = await open(deviceKey, 'staff');
  const { page } = view;
  await page.goto(pageUrl('index.html'));
  await button(page, 'Click here to begin').click({ timeout: 30_000 });
  await page.waitForURL(/#\/agenda/);
  await page.getByRole('button', { name: /^Guess the brand/ }).first().click();
  await options(page).first().waitFor();
  await answer(page);
  await page.evaluate((text) => {
    const box = document.createElement('div');
    box.setAttribute('style', 'margin:1rem 0;padding:1rem 1.25rem;border-radius:16px;background:rgba(255,255,255,.14);border:2px dashed #fff;color:#fff;font:inherit;font-size:1.125rem;line-height:1.5');
    box.innerHTML = '<strong style="display:block;font-size:.8rem;letter-spacing:.08em;margin-bottom:.35rem">MOCK-UP: NOT IN THE APP (the reveal line would need a new column, schema version 4)</strong>';
    box.append(document.createTextNode(text));
    document.querySelector('.pms-options')?.after(box);
  }, reveal);
  await shot(view, { flow: 'mockups', id: '01-reveal-line', title: 'MOCK-UP: the reveal line after "Guess the brand" (not in the app)' });
  await view.context.close();
}

// ---- The font experiment (UX-REVIEW.md, section 6) -------------------------------------------------------------------------------------------
// The same screens three ways: (a) the package as it is, Open Sans embedded; (b) the variant with no embedded faces (`--font-variant <folder>`, built
// in a scratch worktree, never committed) on a device that HAS Open Sans, which the harness stands in for by serving the TTFs from the brand folder
// and declaring them in the page (an init script: the page's own code is the variant's); (c) the variant on a device without Open Sans.

const INSTALL_OPEN_SANS = () => {
  const style = document.createElement('style');
  style.textContent = Object.entries({ 300: 'OpenSans-Light.ttf', 400: 'OpenSans-Regular.ttf', 600: 'OpenSans-Semibold.ttf', 700: 'OpenSans-Bold.ttf', 800: 'OpenSans-ExtraBold.ttf' })
    .map(([weight, file]) => `@font-face{font-family:'Open Sans';font-weight:${weight};src:url('/__installed-fonts/${file}')}`).join('')
    + "@font-face{font-family:'Open Sans';font-weight:800;font-style:italic;src:url('/__installed-fonts/OpenSans-ExtraBoldItalic.ttf')}";
  document.addEventListener('DOMContentLoaded', () => document.head.prepend(style));
};

async function fontScreens(deviceKey, variant) {
  const flow = 'fonts';
  const view = await open(deviceKey, 'staff');
  const { page, context } = view;
  if (variant.install) {
    await context.route(`${ORIGIN}/__installed-fonts/**`, (route) => route.fulfill({ contentType: 'font/ttf', body: readFileSync(path.join(ROOT, 'public', 'assets', 'Font', 'open-sans', decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()))) }));
    await context.addInitScript(INSTALL_OPEN_SANS);
  }
  const id = (screen) => `${screen}--${variant.key}`;
  await scenario('event-day', liveMode('staff'));
  await page.goto(pageUrl('index.html'));
  await button(page, 'Click here to begin').click({ timeout: 30_000 });
  await page.waitForURL(/#\/agenda/);
  await page.getByRole('button', { name: /^Straight talk/ }).first().waitFor();
  await shot(view, { flow, id: id('01-hub'), title: `Hub: ${variant.label}`, state: variant.key });
  await page.getByRole('button', { name: /^Straight talk/ }).first().click();
  await options(page).first().waitFor();
  await shot(view, { flow, id: id('02-ranking'), title: `Ranking question: ${variant.label}`, state: variant.key });
  await page.context().addCookies([{ name: 'pms-local-persona', value: 'admin', domain: HOST, path: '/', secure: true }]);
  await unlock(page);
  await tab(page, 'Results');
  await page.waitForTimeout(2500);
  await shot(view, { flow, id: id('03-results'), title: `Results: ${variant.label}`, state: variant.key });
  await page.goto(pageUrl('admin.html#print-guests'));
  await page.waitForTimeout(2500);
  await shot(view, { flow, id: id('04-qr-sheet'), title: `QR print sheet: ${variant.label}`, state: variant.key });
  await page.goto(pageUrl('admin.html#live-display'));
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Full screen' }).click();
  await page.waitForTimeout(1500);
  await shot(view, { flow, id: id('05-fullscreen'), title: `Live display, full screen: ${variant.label}`, state: variant.key, fullPage: false });
  const fit = await page.evaluate(() => getComputedStyle(document.querySelector('[style*="--chart-scale"]') ?? document.documentElement).getPropertyValue('--chart-scale'));
  manifest.at(-1).note = `--chart-scale ${fit || '(not set)'}; fonts in use: ${await page.evaluate(() => [...document.fonts].filter((face) => face.status === 'loaded').map((face) => `${face.family} ${face.weight}`).join(', '))}`;
  await view.context.close();
}

async function fontsFlow() {
  const variantDir = option('font-variant');
  if (!variantDir) throw new Error('The fonts flow needs --font-variant <folder of the variant\'s three pages>.');
  const main = running;
  const variants = [
    { key: 'a-embedded', label: '(a) as now, Open Sans embedded', packageDir: main.site.pages.dir },
    { key: 'b-variant-installed', label: '(b) no embedded font, Open Sans installed', packageDir: variantDir, install: true },
    { key: 'c-variant-absent', label: '(c) no embedded font, Open Sans absent', packageDir: variantDir },
  ];
  for (const variant of variants) {
    running = await startLocalSite({ port: 0, latency: 'none', scenario: 'ready', persist: false, packageDir: variant.packageDir });
    for (const engine of Object.keys(browsers)) { await browsers[engine].close(); delete browsers[engine]; }
    try {
      for (const device of ['laptop-1366', 'projector', 'ipad-portrait'].filter(want)) await safely(fontScreens)(device, variant);
    } finally {
      for (const engine of Object.keys(browsers)) { await browsers[engine].close(); delete browsers[engine]; }
      await running.close();
      running = main;
    }
  }
}

// ---- The contact sheet ------------------------------------------------------------------------------------------------------------------------

function contactSheet() {
  const escape = (text) => String(text ?? '').replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);
  const flows = [...new Set(manifest.map((entry) => entry.flow))];
  const sections = flows.map((flow) => {
    const ids = [...new Set(manifest.filter((entry) => entry.flow === flow).map((entry) => entry.id))];
    const rows = ids.map((id) => {
      const entries = manifest.filter((entry) => entry.flow === flow && entry.id === id);
      return `<div class="row" id="${escape(`${flow}-${id}`)}"><h3>${escape(entries[0].title)} <small>${escape(id)}${entries[0].state !== 'default' ? `, ${escape(entries[0].state)}` : ''}</small></h3><div class="pics">${entries.map((entry) => `<figure><a href="${escape(entry.file)}"><img loading="lazy" src="${escape(entry.file)}" alt="${escape(`${entry.title}, ${entry.deviceLabel}`)}"></a><figcaption>${escape(entry.deviceLabel)} · ${entry.requests} requests${entry.failed.length ? ` · <strong>${escape(entry.failed.join(', '))}</strong>` : ''}</figcaption></figure>`).join('')}</div></div>`;
    }).join('');
    return `<section><h2 id="${escape(flow)}">${escape(flow)}</h2>${rows}</section>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PMS UX review ${escape(date)}</title><style>
body{font-family:system-ui,sans-serif;margin:0 auto;padding:16px;max-width:1800px;color:#1a1a1a;background:#fff}h2{border-top:2px solid #333;padding-top:12px;margin-top:32px}h3{font-size:1rem;margin:20px 0 6px}small{color:#555;font-weight:400}
.pics{display:flex;gap:12px;overflow-x:auto;align-items:flex-start}figure{margin:0;flex:0 0 auto;max-width:360px}img{max-width:360px;max-height:520px;border:1px solid #ccc;display:block}figcaption{font-size:.75rem;color:#444;max-width:360px}
nav a{margin-right:12px}.problems{background:#fff4ce;padding:8px 12px}
</style></head><body><h1>PMS UX review: contact sheet (${escape(date)})</h1>
<p>Pages: <strong>${escape(running.site.pages.name)}</strong> on the local PCOE site. ${manifest.length} pictures. Each picture links to the full size; the findings are in UX-REVIEW.md, by the picture's id.</p>
<nav>${flows.map((flow) => `<a href="#${escape(flow)}">${escape(flow)}</a>`).join('')}</nav>
${problems.length ? `<div class="problems"><h2>Problems seen while shooting</h2><ul>${[...new Set(problems.map((problem) => `${problem.kind}: ${problem.url ?? problem.message} (${problem.device})`))].map((line) => `<li>${escape(line)}</li>`).join('')}</ul></div>` : ''}
${sections}</body></html>`;
}

function zipFolder() {
  const files = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (!name.endsWith('.zip')) files[path.relative(OUT, full).split(path.sep).join('/')] = [new Uint8Array(readFileSync(full)), { level: 0 }];
    }
  };
  walk(OUT);
  writeFileSync(path.join(OUT, 'ux-review.zip'), zipSync(files));
}

/** Runs one flow on one device; a failure (Windows may refuse to start Firefox: spawn UNKNOWN) is recorded and the next goes on. */
const safely = (run) => async (device, ...rest) => {
  try { await run(device, ...rest); } catch (error) {
    problems.push({ kind: `${run.name} stopped`, message: String(error?.message ?? error).split('\n')[0].slice(0, 300), device });
    process.stdout.write('x');
  }
};
const FLOWS = {
  participant: async () => {
    for (const device of pick(['ipad-portrait', 'ipad-landscape', 'iphone-15', 'laptop-1366'])) await safely(participantWalk)(device);
    for (const device of pick(['ipad-pro-11', 'firefox-1440'])) await safely(participantWalk)(device, { full: false });
    for (const device of pick(['ipad-portrait', 'iphone-15'])) await safely(guestFlow)(device);
    for (const device of pick(['ipad-portrait', 'laptop-1366'])) await safely(participantStates)(device);
    for (const device of pick(['laptop-1366'])) await safely(keyboardFocus)(device);
  },
  tiles: async () => {
    for (const device of pick(['ipad-portrait', 'iphone-15', 'laptop-1366'])) await safely(tiles)(device);
  },
  admin: async () => {
    for (const device of pick(['laptop-1366', 'laptop-1536-125', 'laptop-1280-150', 'ipad-landscape', 'firefox-1440'])) await safely(adminFlow)(device);
    for (const device of pick(['laptop-1366', 'ipad-landscape'])) await safely(adminStates)(device);
    for (const device of pick(['projector', 'laptop-1536-125', 'ipad-landscape'])) await safely(liveDisplay)(device);
  },
  setup: async () => {
    for (const device of pick(['laptop-1366', 'ipad-portrait'])) await safely(setupFlow)(device);
  },
  brand: async () => {
    for (const device of pick(['ipad-portrait', 'ipad-landscape', 'iphone-15', 'laptop-1366', 'projector'])) await safely(brandMatrix)(device);
    for (const device of pick(['laptop-1366'])) await safely(brandStudioUploads)(device);
  },
  mockups: async () => {
    if (!matrix) for (const device of pick(['ipad-portrait', 'iphone-15'])) await safely(revealMockup)(device);
  },
  fonts: async () => { if (option('font-variant')) await fontsFlow(); },
};

export async function main() {
  running = await startLocalSite({ port: 0, latency: 'none', scenario: 'ready', persist: false, packageDir: option('package') ?? undefined });
  mkdirSync(OUT, { recursive: true });
  console.log(`Shooting ${running.site.pages.name} into ${OUT}`);
  try {
    for (const [name, run] of Object.entries(FLOWS)) {
      if (only && !only.includes(name)) continue;
      process.stdout.write(`\n${name} `);
      try { await run(); } catch (error) { problems.push({ kind: `flow "${name}" stopped`, message: String(error?.stack ?? error).slice(0, 600), device: '-' }); console.error(`\n${name} stopped:`, error); }
    }
  } finally {
    for (const each of Object.values(browsers)) await each.close();
    await running.close();
  }
  const previous = (() => { try { return JSON.parse(readFileSync(path.join(OUT, 'shots.json'), 'utf8')); } catch { return { shots: [], problems: [] }; } })();
  const kept = previous.shots.filter((entry) => !manifest.some((fresh) => fresh.file === entry.file));
  manifest.unshift(...kept);
  writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify({ pages: running.site.pages.name, shots: manifest, problems }, null, 2));
  writeFileSync(path.join(OUT, 'index.html'), contactSheet());
  if (measuring) writeFileSync(path.join(OUT, 'alignment.json'), JSON.stringify({ pages: running.site.pages.name, matrix: matrix ? MATRIX : null, shots: alignment }, null, 2));
  zipFolder();
  console.log(`\n${manifest.length} pictures, ${problems.length} problems. Contact sheet: ${path.join(OUT, 'index.html')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
