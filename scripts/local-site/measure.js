// The UX review's performance measurements (Phase 12): the shipped pages on the local PCOE site in Chromium, with the CPU four times slower and the
// API at PCOE's latency (about 350 ms) or the slow profile (about 1,500 ms), on the scenarios "event-day" and "stress". Nothing is guessed: each number
// is read from the page (PerformanceObserver: LCP, CLS, long tasks, event timing) or from the DevTools protocol (CPU throttling, scripting time).
//
//   node scripts/local-site/measure.js            writes ux-review/<date>/perf.json and prints the table
//
// The pages are fetched over a real HTTPS connection (gzip, as SharePoint sends them); the network itself is this computer's, so a time here is the
// page's own work plus the API's added latency, not a radio link's. Run it on a quiet machine; numbers move by a few percent between runs.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startLocalSite } from './server.js';
import { ADMIN, HOST, pageUrl } from './site-shape.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = path.join(ROOT, 'ux-review', new Date().toISOString().slice(0, 10));
const OBSERVE = () => {
  window.__perf = { lcp: 0, cls: 0, longTasks: [], events: [] };
  new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__perf.lcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__perf.cls += entry.value; }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__perf.longTasks.push(Math.round(entry.duration)); }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__perf.events.push({ name: entry.name, duration: entry.duration, delay: entry.processingStart - entry.startTime }); }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
};
const read = (page) => page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const paint = Object.fromEntries(performance.getEntriesByType('paint').map((entry) => [entry.name, Math.round(entry.startTime)]));
  const resources = performance.getEntriesByType('resource');
  return {
    ttfb: Math.round(nav.responseStart), domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd),
    documentBytes: nav.encodedBodySize, documentDecoded: nav.decodedBodySize, firstContentfulPaint: paint['first-contentful-paint'] ?? null,
    lcp: Math.round(window.__perf.lcp), cls: Number(window.__perf.cls.toFixed(4)), longTasks: window.__perf.longTasks.length, longestTask: Math.max(0, ...window.__perf.longTasks),
    totalLongTaskMs: window.__perf.longTasks.reduce((sum, value) => sum + value, 0),
    worstInput: window.__perf.events.reduce((worst, entry) => Math.max(worst, entry.duration), 0),
    resources: resources.length, resourceBytes: resources.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0),
    jsHeapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  };
});

async function measure(browser, running, { label, latency, scenario, persona = 'staff', cpu = 4, run }) {
  running.site.latency = latency;
  await running.site.load(scenario, { rebuild: true });
  if (scenario === 'event-day' && persona === 'staff') for (const row of running.site.fake.lists.get('sessions')) row.ParticipationMode = 'staff';
  const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, ignoreHTTPSErrors: true, timezoneId: 'Asia/Kolkata' });
  await context.addCookies([{ name: 'pms-local-persona', value: persona, domain: HOST, path: '/', secure: true }]);
  await context.addInitScript(OBSERVE);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await cdp.send('Performance.enable');
  const logStart = running.site.log.length;
  const started = Date.now();
  const marks = await run(page, cdp);
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]));
  const result = {
    label, latency, scenario, cpu, wallMs: Date.now() - started, ...marks, ...(await read(page)),
    scriptMs: Math.round(metrics.ScriptDuration * 1000), layoutMs: Math.round(metrics.LayoutDuration * 1000), styleMs: Math.round(metrics.RecalcStyleDuration * 1000),
    apiRequests: running.site.log.length - logStart,
  };
  await context.close();
  process.stdout.write('.');
  return result;
}

const timeTo = async (page, locator) => { const started = Date.now(); await locator.waitFor({ timeout: 90_000 }); return Date.now() - started; };

const RUNS = [];
for (const latency of ['pcoe', 'slow']) {
  RUNS.push({ label: `participant: open to "Click here to begin" (${latency})`, latency, scenario: 'event-day', run: async (page) => ({ readyMs: await (async () => { const started = Date.now(); await page.goto(pageUrl('index.html')); await page.getByRole('button', { name: 'Click here to begin' }).waitFor({ timeout: 90_000 }); return Date.now() - started; })() }) });
  RUNS.push({
    label: `participant: begin, hub, open an activity, answer, Submit (${latency})`, latency, scenario: 'event-day',
    run: async (page) => {
      await page.goto(pageUrl('index.html'));
      await page.getByRole('button', { name: 'Click here to begin' }).click({ timeout: 90_000 });
      const hubMs = await timeTo(page, page.getByRole('button', { name: /^Straight talk/ }).first());
      await page.getByRole('button', { name: /^Straight talk/ }).first().click();
      const questionMs = await timeTo(page, page.locator('.pms-options button').first());
      for (let index = 0; index < 5; index += 1) await page.locator('.pms-options button').nth(index).click();
      const started = Date.now();
      await page.getByRole('button', { name: 'Submit', exact: true }).click();
      await page.getByRole('button', { name: 'Back to activities' }).waitFor({ timeout: 90_000 });
      return { hubMs, questionMs, submitMs: Date.now() - started };
    },
  });
}
for (const scenario of ['event-day', 'stress']) {
  RUNS.push({
    label: `admin: PIN to Today, then Results (${scenario})`, latency: 'pcoe', scenario, persona: 'admin',
    run: async (page) => {
      await page.goto(pageUrl('admin.html'));
      const pinMs = await timeTo(page, page.getByRole('textbox', { name: 'PIN' }));
      await page.getByRole('textbox', { name: 'PIN' }).fill(ADMIN.pin);
      const started = Date.now();
      await page.getByRole('button', { name: 'Unlock' }).click();
      await page.getByRole('tab', { name: 'Today' }).waitFor();
      await page.getByRole('heading', { level: 2 }).first().waitFor();
      const todayMs = Date.now() - started;
      const opened = Date.now();
      await page.getByRole('tab', { name: 'Results', exact: true }).click();
      await page.locator('article[data-session]').first().waitFor({ timeout: 90_000 });
      return { pinMs, todayMs, resultsMs: Date.now() - opened };
    },
  });
  RUNS.push({
    label: `admin: Live display, 60 s of refreshes (${scenario})`, latency: 'pcoe', scenario, persona: 'admin',
    run: async (page, cdp) => {
      await page.goto(pageUrl('admin.html'));
      await page.getByRole('textbox', { name: 'PIN' }).fill(ADMIN.pin);
      await page.getByRole('button', { name: 'Unlock' }).click();
      await page.getByRole('tab', { name: 'Today' }).waitFor({ timeout: 90_000 });
      await page.goto(pageUrl(`admin.html#live-display`));
      await page.waitForTimeout(4000);
      const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]));
      await page.waitForTimeout(60_000);
      await page.waitForTimeout(3000);
      const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]));
      return { refreshScriptMs: Math.round((after.ScriptDuration - before.ScriptDuration) * 1000), refreshLayoutMs: Math.round((after.LayoutDuration - before.LayoutDuration) * 1000) };
    },
  });
}

const running = await startLocalSite({ port: 0, latency: 'pcoe', scenario: 'ready', persist: false });
const browser = await chromium.launch({ args: running.browserArgs });
const results = [];
try {
  for (const run of RUNS) results.push(await measure(browser, running, run).catch((error) => ({ label: run.label, error: String(error).slice(0, 400) })));
} finally {
  await browser.close();
  await running.close();
}
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify({ pages: running.site.pages.name, measuredAt: new Date().toISOString(), results }, null, 2));
console.log('');
for (const result of results) console.log(JSON.stringify(result));
