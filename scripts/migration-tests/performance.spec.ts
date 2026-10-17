import { chromium, test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../migration/src/lib/admin/sha256.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';
import { pageAddress, startHttpsSite } from './https-site.js';
import { newFake, onSite, seedAndGoLive } from './sharepoint.js';

// Phase 8, part E: how long the two pages take to become usable, measured in Chromium through the DevTools protocol.
//   CPU:     Emulation.setCPUThrottlingRate, 4x slower (a mid-range phone, or an older iPad, is about that far behind a laptop).
//   Network: Network.emulateNetworkConditions with the "Slow 4G" profile as Lighthouse defines it: 1.6 Mbit/s down, 750 kbit/s up, 150 ms of
//            round trip on every request. The page, the three pages' real build, is sent gzip-compressed over a real (local, HTTPS) connection
//            from scripts/migration-tests/https-site.ts, and every SharePoint REST call is answered over that same connection by the mocked
//            SharePoint, so the throttle applies to all of it. The mocked site answers at once: only the network's cost is in the numbers.
// What is measured, in the page's own clock from the start of the navigation (each in a new browser context, so with nothing cached):
//   participant  the moment the Welcome screen's "Click here to begin" is on screen, enabled and a frame has been drawn after it;
//   admin        the moment the PIN field is usable, and the moment Today is drawn after the PIN is sent as soon as the field allows.
// Five runs for each; the median is reported, with the fastest and slowest, and the longest task the page ran (the Long Tasks API: a task over
// 50 ms) up to that moment. Anything over 3 s is flagged. Nothing is optimised here; the numbers are in MIGRATION-PLAN.md, "Phase 8".
// It is the mocked SharePoint and this Mac. A real iPad on the venue's network on the real site will differ; QA-TESTING.md asks for that run.

const out = fileURLToPath(new URL('../../test-results/perf/', import.meta.url));
const RUNS = 5;
const SLOW_4G = { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const CONDITIONS = [
  { name: 'no throttling', cpu: 1, network: false },
  { name: '4x CPU', cpu: 4, network: false },
  { name: '4x CPU + Slow 4G', cpu: 4, network: true },
] as const;

type Probe = { pinAt: number | null; readyAt: number | null; longTasks: { start: number; duration: number }[] };
type Run = { page: string; condition: string; readyMs: number; pinMs: number | null; longestTask: number; longTasksOver50: number; blockingMs: number; pageBytes: number; apiRequests: number };

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Runs in the page before anything else: notes when the thing we are waiting for appears, and every long task. */
function probe(kind: 'participant' | 'admin') {
  const state: Probe = { pinAt: null, readyAt: null, longTasks: [] };
  (window as unknown as { __perf: Probe }).__perf = state;
  try {
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) state.longTasks.push({ start: entry.startTime, duration: entry.duration }); }).observe({ type: 'longtask', buffered: true });
  } catch { /* an engine without the Long Tasks API */ }
  const shown = (element: Element | null | undefined) => { const rect = element?.getBoundingClientRect(); return Boolean(rect && rect.width > 0 && rect.height > 0); };
  const frameAfter = (done: () => void) => requestAnimationFrame(() => requestAnimationFrame(done));
  const look = () => {
    if (kind === 'participant') {
      const begin = [...document.querySelectorAll('button')].find((button) => (button.textContent ?? '').trim() === 'Click here to begin');
      if (state.readyAt === null && begin && !begin.disabled && shown(begin)) { state.readyAt = -1; frameAfter(() => { state.readyAt = performance.now(); }); }
    } else {
      const pin = document.querySelector('input[aria-label="PIN"]');
      if (state.pinAt === null && pin && !(pin as HTMLInputElement).disabled && shown(pin)) { state.pinAt = -1; frameAfter(() => { state.pinAt = performance.now(); }); }
      const today = document.querySelector('section[data-live]');
      if (state.readyAt === null && shown(today)) { state.readyAt = -1; frameAfter(() => { state.readyAt = performance.now(); }); }
    }
  };
  new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true });
  look();
}

test('the participant page and admin Today, on a 4x slower CPU and Slow 4G: time to a usable screen and the longest task, median of five', async () => {
  test.setTimeout(1_800_000);
  await mkdir(out, { recursive: true });

  // One mocked site for both pages: Kroger live for the participant, and a facilitator with the PIN 2468 for admin.
  const fake = newFake();
  fake.add('adminusers', { AppId: 'admin', Title: 'Facilitator', Name: 'Facilitator', PinHash: sha256Hex('2468') });
  await seedAndGoLive(fake, 'c-kroger');
  await onSite(fake, (ds) => seedPack(ds, samplePack()));
  const site = await startHttpsSite(fake);
  const browser = await chromium.launch({ args: site.args });
  const runs: Run[] = [];
  try {
    for (const target of ['participant', 'admin'] as const) {
      for (const condition of CONDITIONS) {
        for (let attempt = 0; attempt < RUNS; attempt += 1) {
          const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, ignoreHTTPSErrors: true });
          const page = await context.newPage();
          const cdp = await context.newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: condition.cpu });
          if (condition.network) {
            await cdp.send('Network.enable');
            await cdp.send('Network.emulateNetworkConditions', { offline: false, ...SLOW_4G, connectionType: 'cellular4g' });
          }
          await page.addInitScript(probe, target);
          const before = { page: site.bytes.page, requests: site.requests.length };
          await page.goto(pageAddress(target === 'participant' ? 'index.html' : 'admin.html'), { waitUntil: 'commit', timeout: 180_000 });
          if (target === 'admin') {
            await page.waitForFunction(() => (window as unknown as { __perf: Probe }).__perf.pinAt !== null && (window as unknown as { __perf: Probe }).__perf.pinAt! > 0, null, { timeout: 180_000, polling: 25 });
            await page.getByRole('textbox', { name: 'PIN' }).fill('2468');
            await page.getByRole('button', { name: 'Unlock' }).click();
          }
          await page.waitForFunction(() => { const state = (window as unknown as { __perf: Probe }).__perf; return state.readyAt !== null && state.readyAt > 0; }, null, { timeout: 180_000, polling: 25 });
          const seen = await page.evaluate(() => (window as unknown as { __perf: Probe }).__perf);
          const upTo = seen.readyAt!;
          const tasks = seen.longTasks.filter((task) => task.start <= upTo);
          runs.push({
            page: target, condition: condition.name, readyMs: Math.round(seen.readyAt!), pinMs: seen.pinAt && seen.pinAt > 0 ? Math.round(seen.pinAt) : null,
            longestTask: Math.round(Math.max(0, ...tasks.map((task) => task.duration))), longTasksOver50: tasks.length, blockingMs: Math.round(tasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0)),
            pageBytes: site.bytes.page - before.page, apiRequests: site.requests.slice(before.requests).filter((request) => request.url.includes('/_api/')).length,
          });
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    await site.close();
  }

  const table = [] as { page: string; condition: string; 'median s': number; 'fastest s': number; 'slowest s': number; 'PIN screen s (median)': number | string; 'longest task ms (median)': number; 'longest task ms (max)': number; 'blocking ms (median)': number; 'page KB on the wire': number; 'API requests': number; flag: string }[];
  for (const target of ['participant', 'admin']) {
    for (const condition of CONDITIONS) {
      const mine = runs.filter((entry) => entry.page === target && entry.condition === condition.name);
      const seconds = mine.map((entry) => entry.readyMs / 1000);
      table.push({
        page: target === 'participant' ? 'participant (Welcome)' : 'admin (Today)', condition: condition.name,
        'median s': Number(median(seconds).toFixed(2)), 'fastest s': Number(Math.min(...seconds).toFixed(2)), 'slowest s': Number(Math.max(...seconds).toFixed(2)),
        'PIN screen s (median)': target === 'admin' ? Number(median(mine.map((entry) => (entry.pinMs ?? 0) / 1000)).toFixed(2)) : '',
        'longest task ms (median)': median(mine.map((entry) => entry.longestTask)), 'longest task ms (max)': Math.max(...mine.map((entry) => entry.longestTask)),
        'blocking ms (median)': median(mine.map((entry) => entry.blockingMs)),
        'page KB on the wire': Number((mine[0].pageBytes / 1000).toFixed(1)), 'API requests': mine[0].apiRequests,
        flag: median(seconds) > 3 ? 'OVER 3 s' : '',
      });
    }
  }
  await writeFile(`${out}perf.json`, `${JSON.stringify({ when: new Date().toISOString(), runsEach: RUNS, slow4G: SLOW_4G, cpuRate: 4, table, runs }, null, 2)}\n`);
  console.log(`\nTime to a usable screen, Chromium, ${RUNS} runs each, mocked SharePoint over local HTTPS (median):`);
  console.table(table);
  expect(runs.every((entry) => Number.isFinite(entry.readyMs) && entry.readyMs > 0)).toBe(true);
  // Sanity, not a target: nothing here takes more than a minute, even on Slow 4G with a 4x slower CPU.
  expect(Math.max(...runs.map((entry) => entry.readyMs))).toBeLessThan(60_000);
});
