import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharePointFolderPath } from '../deployment-config.js';
import { PIN, adminUrl, startLocal, stopLocal, useServer, type Local } from './admin-local.js';
import { notLivePage, openParticipant, settle, themedSite, THEMES, walkParticipant } from './a11y-support.js';
import { layoutProblems } from './layout-support.js';

// Phase 8, part C: zoom and reflow.
//   - Pinch-zoom works outside kiosk mode. The Phase 8 plan found user-scalable=no blocking it for everyone; this says what the three pages' viewport
//     tag is now, that nothing the page runs cancels a pinch or a gesture, and that nothing sets touch-action so as to forbid zoom. With ?kiosk=1
//     (or standalone mode) the lock is on, which also proves the checks can fail.
//   - At 200% text size and at 320 CSS pixels wide (what 1280 px looks like at 400% zoom) there is no sideways scroll and nothing is lost:
//     nothing sticks out, nothing is cut off, every control is still on the screen. On every participant screen and state, and on the admin tabs.
// The built pages, mocked SharePoint and the local server, three engines. A real iPad's own zoom has not been tried.

const release = fileURLToPath(new URL('../../build-svelte/release/', import.meta.url));
const pictures = fileURLToPath(new URL('../../test-results/a11y/reflow/', import.meta.url));

test('the viewport tag of all three pages allows zoom: no user-scalable=no, no maximum-scale', async () => {
  for (const file of ['index.html', 'admin.html', 'setup.html']) {
    const html = await readFile(path.join(release, file), 'utf8');
    const tag = html.match(/<meta name="viewport" content="([^"]*)"/)?.[1] ?? '';
    expect(tag, `${file}: viewport tag`).toMatch(/width=device-width/);
    expect(tag, `${file}: viewport tag`).toMatch(/initial-scale=1/);
    expect(tag, `${file}: blocks pinch zoom`).not.toMatch(/user-scalable\s*=\s*(no|0)/i);
    expect(tag, `${file}: caps the zoom`).not.toMatch(/maximum-scale/i);
    expect(tag, `${file}: fixes the scale`).not.toMatch(/minimum-scale\s*=\s*1(\.0+)?\s*(,|$)(?=.*maximum)/i);
  }
});

/** Dispatches the events a pinch makes (WebKit's gesture events, and a two-finger touchmove) and says whether anything cancelled them. */
const pinchCancelled = (page: Page) => page.evaluate(() => {
  const cancelled: string[] = [];
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    if (event.defaultPrevented) cancelled.push(type);
  }
  const move = new Event('touchmove', { bubbles: true, cancelable: true });
  Object.defineProperty(move, 'touches', { value: [{ clientX: 10, clientY: 10 }, { clientX: 50, clientY: 50 }] });
  document.body.dispatchEvent(move);
  if (move.defaultPrevented) cancelled.push('two-finger touchmove');
  return cancelled;
});

/** Elements whose touch-action would stop a pinch (anything but auto or manipulation, which both allow it). */
const blockingTouchAction = (page: Page) => page.evaluate(() => [...document.querySelectorAll('*')]
  .map((element) => ({ element, value: getComputedStyle(element).touchAction }))
  .filter(({ value }) => value !== 'auto' && value !== 'manipulation' && !/pinch-zoom/.test(value))
  .map(({ element, value }) => `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? `.${element.className.trim().split(/\s+/)[0]}` : ''}: ${value}`));

test('pinch-zoom works in a normal tab: nothing cancels a pinch or a gesture, no element forbids zoom, and html is not marked as a kiosk', async ({ page }) => {
  const { fake } = await themedSite({ theme: 'kroger' });
  await openParticipant(page, fake);
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-kiosk')), 'not a kiosk').toBe(false);
  expect(await pinchCancelled(page), 'nothing cancels a pinch').toEqual([]);
  expect(await blockingTouchAction(page), 'nothing forbids zoom through touch-action').toEqual([]);
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await pinchCancelled(page), 'nor on the hub').toEqual([]);
  expect(await blockingTouchAction(page), 'nor on the hub').toEqual([]);
});

test('with ?kiosk=1 the lock is on: a pinch and the gestures are cancelled (so the check above can fail)', async ({ page }) => {
  const { fake } = await themedSite({ theme: 'kroger' });
  await (await import('./sharepoint.js')).serveSharePoint(page, fake);
  await page.goto((await import('./sharepoint.js')).pageUrl('index.html?kiosk=1'));
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-kiosk'))).toBe(true);
  expect((await pinchCancelled(page)).sort()).toEqual(['gestureend', 'gesturestart', 'gesturechange', 'two-finger touchmove'].sort());
});

test.describe('admin and setup in a normal tab', () => {
  let local: Local;
  test.beforeEach(async () => { local = await startLocal(); });
  test.afterEach(async () => { await stopLocal(local); });

  test('allow a pinch too', async ({ page }) => {
    await useServer(page, local);
    for (const url of [adminUrl, `${sharePointFolderPath}/setup.html`]) {
      await page.goto(url);
      await expect(page.locator('body')).not.toBeEmpty();
      expect(await pinchCancelled(page), url).toEqual([]);
    }
  });
});

// ---- Reflow ---------------------------------------------------------------------------------------------------------------------------

const BIG_TEXT = 'html { font-size: 200% !important; }';

for (const { name, width, height, style } of [
  { name: '200% text size, on a phone (390 px)', width: 390, height: 844, style: BIG_TEXT },
  { name: '200% text size, on an iPad (820 px)', width: 820, height: 1180, style: BIG_TEXT },
  { name: '320 CSS px wide', width: 320, height: 568, style: '' },
  { name: '320 CSS px wide at 200% text size', width: 320, height: 568, style: BIG_TEXT },
]) {
  test(`participant page at ${name}: every screen and state, no sideways scroll, nothing sticking out or cut off`, async ({ page, browserName }) => {
    test.setTimeout(240_000);
    await mkdir(pictures, { recursive: true });
    await page.setViewportSize({ width, height });
    if (style) await page.addInitScript((css) => { document.addEventListener('DOMContentLoaded', () => { const element = document.createElement('style'); element.textContent = css; document.head.appendChild(element); }); }, style);
    const { fake, pack } = await themedSite({ theme: 'kroger' });
    await openParticipant(page, fake);
    const problems: string[] = [];
    await walkParticipant(page, { pack, clientId: THEMES.kroger.clientId }, async (state) => {
      await settle(page);
      for (const problem of await layoutProblems(page, { touch: true })) problems.push(`${state}: ${problem}`);
      // Nothing is lost: the heading and the main control of the screen are still there to read and to press.
      expect(await page.getByRole('heading').first().isVisible(), `${state}: a heading`).toBe(true);
      // Pictures of the screens that were the hardest to fit, for a person to look at.
      if (browserName === 'chromium' && ['welcome', 'hub: a finished, a current and a locked activity', 'question, wrong, with Retry', 'question, answer revealed after two wrong tries'].includes(state)) {
        await page.screenshot({ path: `${pictures}${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${state.replace(/[^a-z]+/gi, '-').slice(0, 24)}.png`, fullPage: true });
      }
    });
    for (const state of ['not live', 'ended'] as const) {
      const other = await page.context().newPage();
      await other.setViewportSize({ width, height });
      if (style) await other.addInitScript((css) => { document.addEventListener('DOMContentLoaded', () => { const element = document.createElement('style'); element.textContent = css; document.head.appendChild(element); }); }, style);
      await notLivePage(other, state);
      for (const problem of await layoutProblems(other, { touch: true })) problems.push(`${state}: ${problem}`);
      await other.close();
    }
    expect([...new Set(problems)]).toEqual([]);
  });
}

test.describe('admin', () => {
  let local: Local;
  test.beforeEach(async () => { local = await startLocal(); });
  test.afterEach(async () => { await stopLocal(local); });

  for (const { name, width, height, style } of [
    { name: '200% text size at 820 px', width: 820, height: 1180, style: BIG_TEXT },
    { name: '320 CSS px wide', width: 320, height: 568, style: '' },
  ]) {
    test(`every tab at ${name}: no sideways scroll, nothing sticking out or cut off`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height });
      await useServer(page, local);
      await page.goto(adminUrl);
      if (style) await page.addStyleTag({ content: style });
      const problems: string[] = [];
      const look = async (label: string) => { await settle(page); for (const problem of await layoutProblems(page, { touch: true })) problems.push(`${label}: ${problem}`); };
      await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
      await look('the PIN gate');
      await page.getByRole('button', { name: 'Unlock' }).click();
      await expect(page.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true');
      await look('Today');
      for (const tab of ['Clients', 'Content', 'Guests and QR', 'Results']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await expect(page.getByRole('heading', { name: tab, exact: true }).first()).toBeVisible();
        await look(tab);
      }
      expect([...new Set(problems)]).toEqual([]);
    });
  }
});
