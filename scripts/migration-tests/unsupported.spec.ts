import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sharePointFolderPath } from '../deployment-config.js';
import { APP_NAME } from '../../migration/src/lib/common/app-name.ts';
import { mockApi } from './fixtures.js';

// Phase 8, part D: a browser that cannot run the app sees a short plain page, never a blank one. All three built pages, in all three engines.
//   - a browser that lacks something the app needs (blocked here with an init script) shows the notice, and the app never starts;
//   - a browser that cannot run module scripts at all runs the nomodule script, which shows it (simulated: no engine here lacks modules);
//   - a module that cannot be parsed, or throws before the page is drawn, shows it (the error event);
//   - scripting turned off shows it (the noscript style);
//   - a browser that is fine never sees it, and an error after the app has mounted never brings it up.
// The words, the feature list and the ES5 rule are held by scripts/test-unsupported.js; this is what a person would see.

const shots = fileURLToPath(new URL('../../test-results/unsupported/', import.meta.url));
const PAGES = [
  { name: 'participant', file: 'index.html', root: '#app' },
  { name: 'admin', file: 'admin.html', root: '#admin-app' },
  { name: 'setup', file: 'setup.html', root: '#setup-app' },
] as const;
const url = (file: string) => `${sharePointFolderPath}/${file}`;
const MESSAGE = 'This page needs a recent browser. Please open it in the latest Safari, Chrome, Edge or Firefox.';
/** The one error the page throws on purpose, to stop the rest of the bundle. Anything else is a failure. */
const INTENDED = /This browser cannot run this page/;

/** Browsers that lack one thing the app needs, made by taking it away before any script of the page runs. */
const BLOCKS: Record<string, () => void> = {
  'no structuredClone': () => { Object.defineProperty(window, 'structuredClone', { value: undefined, configurable: true }); },
  'no AbortSignal.timeout': () => { Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true }); },
  'no Array.prototype.at': () => { Object.defineProperty(Array.prototype, 'at', { value: undefined, configurable: true, writable: true }); },
  'no color-mix() in CSS': () => {
    const supports = CSS.supports.bind(CSS);
    CSS.supports = ((...args: string[]) => (/color-mix/.test(String(args[0])) ? false : (supports as (...a: string[]) => boolean)(...args))) as typeof CSS.supports;
  },
  'no CSS.registerProperty': () => { Object.defineProperty(CSS, 'registerProperty', { value: undefined, configurable: true }); },
  'no <dialog>': () => { Object.defineProperty(window, 'HTMLDialogElement', { value: undefined, configurable: true }); },
};

const notice = (page: Page) => page.locator('#pms-unsupported');
const normalised = async (page: Page) => (await notice(page).innerText()).replace(/\s+/g, ' ').trim();

function watch(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => { if (!INTENDED.test(error.message)) errors.push(error.message); });
  return errors;
}

test.beforeAll(async () => { await mkdir(shots, { recursive: true }); });

for (const { name, file, root } of PAGES) {
  test.describe(`${name} page`, () => {
    test.use({ viewport: { width: 820, height: 1180 } });

    test('a browser lacking something the app needs sees the notice, with the app name and the wordmark as text, and the app never starts', async ({ page, browserName }) => {
      const errors = watch(page);
      let first = true;
      for (const [what, block] of Object.entries(BLOCKS)) {
        await page.addInitScript(block);
        await page.goto(url(file));
        await expect(notice(page), what).toBeVisible();
        expect(await normalised(page), what).toContain(MESSAGE);
        await expect(notice(page).getByRole('heading', { level: 1 })).toHaveText('This page needs a recent browser.');
        await expect(notice(page).locator('.pms-mark')).toContainText(`Deloitte.`);
        await expect(notice(page).locator('.pms-mark')).toContainText(APP_NAME);
        expect(await page.locator(root).evaluate((element) => element.children.length), `${what}: nothing was drawn by the app`).toBe(0);
        expect(await page.evaluate(() => (window as unknown as { __pmsMounted?: boolean }).__pmsMounted), `${what}: the app did not mount`).toBeUndefined();
        if (first) {
          await page.screenshot({ path: `${shots}${name}-${browserName}-820x1180.png` });
          await page.setViewportSize({ width: 390, height: 844 });
          await page.screenshot({ path: `${shots}${name}-${browserName}-390x844.png` });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll on a phone').toBe(true);
          await page.setViewportSize({ width: 820, height: 1180 });
          first = false;
        }
        // Take the block away again: a fresh page for the next one (an init script stays for the life of the page object).
        await page.context().clearCookies();
        await page.close().catch(() => {});
        page = await page.context().newPage();
        watch(page);
        await page.setViewportSize({ width: 820, height: 1180 });
      }
      expect(errors).toEqual([]);
    });

    test('an ordinary browser never sees it: the app mounts, and a later error does not bring the notice up', async ({ page }) => {
      const errors = watch(page);
      if (name === 'participant') await mockApi(page);
      await page.goto(url(file));
      await expect(page.locator(root)).not.toBeEmpty();
      await expect(notice(page)).toBeHidden();
      expect(await page.evaluate(() => (window as unknown as { __pmsMounted?: boolean }).__pmsMounted)).toBe(true);
      // The nomodule script is in the page and did not run; the first thing in the module bundle is the stop.
      expect(await page.locator('script[nomodule]').count()).toBe(1);
      const later = page.waitForEvent('pageerror');
      await page.evaluate(() => { setTimeout(() => { throw new Error('an error of the app\'s own, long after it mounted'); }, 0); });
      expect((await later).message).toMatch(/long after it mounted/);
      await expect(notice(page)).toBeHidden();
      expect(errors.filter((message) => !/long after it mounted/.test(message))).toEqual([]);
    });

    test('a browser without module scripts runs the nomodule script and sees the notice (simulated: the module is made inert and nomodule is lifted)', async ({ page }) => {
      await page.route(`**${url(file)}`, async (route) => {
        const response = await route.fetch();
        const html = (await response.text())
          .replace(/<script type="module"/g, '<script type="text/x-not-a-module"')
          .replace('<script nomodule>', '<script>');
        await route.fulfill({ response, body: html });
      });
      await page.goto(url(file));
      await expect(notice(page)).toBeVisible();
      expect(await normalised(page)).toContain(MESSAGE);
      expect(await page.locator(root).evaluate((element) => element.children.length)).toBe(0);
    });

    test('a module that cannot be parsed, or that throws before anything is drawn, brings the notice up instead of a blank page', async ({ page }) => {
      for (const [what, code] of [['a syntax error', 'import { broken } from ;'], ['an error at the top of the module', 'throw new Error("top-level failure before the app was drawn");']] as const) {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route(`**${url(file)}`, async (route) => {
          const response = await route.fetch();
          const html = (await response.text()).replace(/<script type="module"[^>]*>[\s\S]*?<\/script>/, `<script type="module">${code}</script>`);
          await route.fulfill({ response, body: html });
        });
        await page.goto(url(file));
        await expect(notice(page), what).toBeVisible();
        expect(await normalised(page), what).toContain(MESSAGE);
        await page.unroute(`**${url(file)}`);
      }
    });
  });
}

test.describe('scripting turned off', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 820, height: 1180 } });

  for (const { name, file } of PAGES) {
    test(`the ${name} page says so, in the notice, with a line about JavaScript`, async ({ page, browserName }) => {
      await page.goto(url(file));
      await expect(notice(page)).toBeVisible();
      const text = await normalised(page);
      expect(text).toContain(MESSAGE);
      expect(text).toContain('JavaScript is turned off in this browser. Please turn it on, then reload this page.');
      await page.screenshot({ path: `${shots}${name}-${browserName}-no-javascript.png` });
    });
  }
});
