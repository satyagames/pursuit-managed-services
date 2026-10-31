// Prompt 26, Part 1: what the three pages say in red. Opens the built pages on the local PCOE site in Chromium and prints every console.error, every
// uncaught error, every failed request and every answer of 400 or more, for index.html (boot, the hub, one saved answer), admin.html and setup.html.
// A browser prints a refused request in red with the page's own name and line 1 beside it ("index.html:1"): that is what the manager's photos show.
//
//   node scripts/console-errors.js            the pages in build-svelte/release (build them first), or --package <folder>
//   node scripts/console-errors.js --report   prints and always exits 0
//
// It exits 1 on anything that is not in EXPECTED. EXPECTED is empty: a clean console is the rule. It is the local site, not the real one: if the real
// site shows a line this does not, it is QA-TESTING.md's to capture (Console, right-click, Save as).
import './fresh-page.js';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { startLocalSite } from './local-site/server.js';
import { HOST, pageUrl } from './local-site/site-shape.js';

/** What a page may say in red, by a pattern of the line. Nothing, at the end of Prompt 26. */
export const EXPECTED = Object.freeze([]);

const args = process.argv.slice(2);
const option = (name) => { const at = args.indexOf(`--${name}`); return at === -1 ? null : args[at + 1]; };
const packageDir = option('package') ?? path.join(import.meta.dirname, '..', 'build-svelte', 'release');

const running = await startLocalSite({ port: 0, latency: 'none', scenario: 'event-day', persist: false, packageDir, fresh: true });
const { port } = running;
for (const row of running.site.fake.lists.get('sessions')) if (row.Status !== 'completed') row.ParticipationMode = 'staff'; // (the staff link: no QR code to scan)
const browser = await chromium.launch({ args: [`--host-rules=MAP ${HOST} 127.0.0.1:${port}`] });

const lines = [];
const noted = (where, page) => {
  page.on('console', (message) => { if (message.type() === 'error') lines.push(`${where}: console.error: ${message.text()}`); });
  page.on('pageerror', (error) => lines.push(`${where}: uncaught: ${error.message}`));
  page.on('requestfailed', (request) => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') lines.push(`${where}: failed: ${request.method()} ${decodeURI(request.url())} ${request.failure()?.errorText}`); });
  page.on('response', (response) => { if (response.status() >= 400) lines.push(`${where}: ${response.status()}: ${response.request().method()} ${decodeURI(response.url())}`); });
};

async function visit(file, walk) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1180, height: 820 } });
  await context.addCookies([{ name: 'pms-local-persona', value: file === 'index.html' ? 'staff' : 'admin', domain: HOST, path: '/', secure: true }]);
  const page = await context.newPage();
  noted(file, page);
  await page.goto(pageUrl(file));
  await page.waitForLoadState('networkidle');
  await walk(page).catch((error) => lines.push(`${file}: the walk stopped: ${String(error.message).split('\n')[0]}`));
  await page.waitForLoadState('networkidle');
  await context.close();
}

const press = async (page, name) => {
  await page.getByRole('button', { name }).first().click({ timeout: 8000 });
  await page.waitForLoadState('networkidle');
};

await visit('index.html', async (page) => {
  await press(page, 'Click here to begin'); // Welcome, then the hub
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.getByRole('button', { name: /^Straight talk/ }).first().click({ timeout: 8000 }); // an activity
  await page.locator('.pms-options button').first().click({ timeout: 8000 }); // one answer, saved in the background
  await page.waitForLoadState('networkidle');
});
await visit('admin.html', async () => {});
await visit('setup.html', async () => {});
await browser.close();
await running.close();

const unexpected = [...new Set(lines)].filter((line) => !EXPECTED.some((pattern) => pattern.test(line)));
for (const line of unexpected) console.log(line);
console.log(unexpected.length ? `${unexpected.length} line(s) in red.` : 'The console is clean on all three pages.');
process.exit(unexpected.length && !args.includes('--report') ? 1 : 0);
