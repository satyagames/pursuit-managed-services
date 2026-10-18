import { test, expect, type CDPSession, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { a11yPack, THEMES } from './a11y-support.js';
import { newFake, onSite, pageUrl, serveSharePoint } from './sharepoint.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';

// Phase 15, the performance contract of the motion system, measured in Chromium through the DevTools protocol with the CPU four times slower
// (the "slow iPad" stand-in; a person judges feel on a real device). For each entrance of a question (6 and 12 answers, from the hub and by
// Next) with motion on and with motion off (?motion=off), from the click to 900 ms after it: layouts and style recalculations
// (Performance.getMetrics), script time, long tasks, layout shift, how long the tap took to be handled (event timing), and the frames
// (requestAnimationFrame gaps: p95 and the longest run of dropped frames). Deterministic numbers are held loosely; frame times are printed.
// Then 200 presses of Next and Back leave no animation, no shape, no listener and no heap behind. The table is written to
// test-results/perf/motion-perf.json. PMS_PAGES=<folder> measures another build's pages (the "before" of RELEASE-15.md).

const PAGES = process.env.PMS_PAGES || undefined;
const OUT = path.join(import.meta.dirname, '..', '..', 'test-results', 'perf');
const DAY = '2026-10-11';

/** Kroger with one more activity, first in the list: polls of 6, 12 and 6 answers (no right answer, so any pick allows Next). */
async function site() {
  const fake = newFake();
  const pack = a11yPack();
  const sectionId = 'sec-motion-check';
  const counts = [6, 12, 6];
  const questions = counts.map((count, index) => ({ id: `q-motion-${index}`, sectionId, type: 'single-select', prompt: `Which of these ${count} would you pick first?`, optionIds: Array.from({ length: count }, (_, at) => `o-motion-${index}-${at}`), order: index + 1, layout: 'text-list' }));
  const options = questions.flatMap((question) => question.optionIds.map((id, at) => ({ id, questionId: question.id, label: `Answer ${at + 1} of ${question.optionIds.length}`, value: String(at + 1), correct: null, imageUrl: null })));
  pack.sections.push({ id: sectionId, title: 'Motion check', order: 0, enabled: true, industryTags: [], questionIds: questions.map((question) => question.id), clientId: THEMES.kroger.clientId, description: 'Three polls.' });
  pack.questions.push(...questions);
  pack.options.push(...options);
  await onSite(fake, async (ds) => { await seedPack(ds, pack); await ds.activateClient(THEMES.kroger.clientId, DAY); });
  return fake;
}

const OBSERVE = () => {
  const seen = { longTasks: [] as number[], shift: 0, events: [] as number[] };
  (window as unknown as { __perf: typeof seen }).__perf = seen;
  new PerformanceObserver((list) => { for (const entry of list.getEntries()) seen.longTasks.push(entry.duration); }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((list) => { for (const entry of list.getEntries()) seen.shift += (entry as unknown as { value: number }).value; }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((list) => { for (const entry of list.getEntries()) seen.events.push(entry.duration); }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
};

type Window = { layouts: number; styles: number; scriptMs: number; longTasks: number; longestTask: number; shift: number; worstEventMs: number; frames: number; p95: number; worstRun: number };

async function metrics(cdp: CDPSession) {
  const list = (await cdp.send('Performance.getMetrics')).metrics;
  const value = (name: string) => list.find((metric) => metric.name === name)?.value ?? 0;
  return { layouts: value('LayoutCount'), styles: value('RecalcStyleCount'), script: value('ScriptDuration') };
}

/** Clicks `target`, then measures until 900 ms after it. */
async function measure(page: Page, cdp: CDPSession, target: () => Promise<void>): Promise<Window> {
  await page.evaluate(() => {
    const perf = (window as unknown as { __perf: { longTasks: number[]; shift: number; events: number[] } }).__perf;
    perf.longTasks.length = 0; perf.shift = 0; perf.events.length = 0;
    const frames: number[] = [];
    (window as unknown as { __frames: number[] }).__frames = frames;
    let last = 0;
    const until = performance.now() + 1100;
    const tick = (now: number) => { if (last) frames.push(now - last); last = now; if (now < until) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const before = await metrics(cdp);
  await target();
  await page.waitForTimeout(900);
  const after = await metrics(cdp);
  const read = await page.evaluate(() => ({ perf: (window as unknown as { __perf: { longTasks: number[]; shift: number; events: number[] } }).__perf, frames: (window as unknown as { __frames: number[] }).__frames }));
  const sorted = [...read.frames].sort((a, b) => a - b);
  let run = 0;
  let worstRun = 0;
  for (const gap of read.frames) { const dropped = Math.max(0, Math.round(gap / 16.7) - 1); run = dropped > 0 ? run + dropped : 0; worstRun = Math.max(worstRun, dropped > 0 ? run : 0); }
  return {
    layouts: after.layouts - before.layouts, styles: after.styles - before.styles, scriptMs: Math.round((after.script - before.script) * 1000),
    longTasks: read.perf.longTasks.length, longestTask: Math.round(Math.max(0, ...read.perf.longTasks)), shift: Number(read.perf.shift.toFixed(4)),
    worstEventMs: Math.round(Math.max(0, ...read.perf.events)), frames: read.frames.length,
    p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0), worstRun,
  };
}

async function run(page: Page, search: string) {
  await page.addInitScript(OBSERVE);
  const fake = await site();
  await serveSharePoint(page, fake, { pages: PAGES });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`${pageUrl('index.html')}${search}`);
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await page.getByRole('button', { name: /^Motion check/ }).waitFor();
  // (The hub's own entrance is its moment, not the next screen's: it is let finish before anything is measured.)
  await page.waitForTimeout(1200);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const rows: Record<string, Window> = {};
  rows['6 answers, from the hub'] = await measure(page, cdp, () => page.getByRole('button', { name: /^Motion check/ }).click());
  await page.locator('.pms-options button').first().click();
  await page.waitForTimeout(400);
  rows['12 answers, by Next'] = await measure(page, cdp, () => page.getByRole('button', { name: 'Next', exact: true }).click());
  await page.locator('.pms-options button').first().click();
  await page.waitForTimeout(400);
  rows['6 answers, by Next'] = await measure(page, cdp, () => page.getByRole('button', { name: 'Next', exact: true }).click());
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return rows;
}

test.describe('the motion performance contract (Chromium, 4x slower CPU)', () => {
  test('an entrance costs no extra layout, no long task, no layout shift; the tap is handled at once; frames are printed', async ({ browser }) => {
    test.setTimeout(180_000);
    const table: Record<string, Record<string, Window>> = {};
    for (const [label, search] of [['motion on', ''], ['motion off', '?motion=off']] as const) {
      const context = await browser.newContext({ viewport: { width: 820, height: 1180 } });
      table[label] = await run(await context.newPage(), search);
      await context.close();
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, `motion-perf${PAGES ? '-other' : ''}.json`), JSON.stringify({ pages: PAGES ?? 'build-svelte/release', table }, null, 2));
    console.log(`\n  motion performance (${PAGES ?? 'build-svelte/release'}), 4x CPU:`);
    console.table(Object.fromEntries(Object.entries(table).flatMap(([mode, rows]) => Object.entries(rows).map(([name, row]) => [`${mode}: ${name}`, row]))));
    for (const name of Object.keys(table['motion on'])) {
      const on = table['motion on'][name];
      const off = table['motion off'][name];
      expect(on.shift, `${name}: motion adds no layout shift (${on.shift} vs ${off.shift}: what the screen change itself shifts)`).toBeLessThanOrEqual(off.shift);
      expect(on.layouts, `${name}: motion adds no layout pass beyond the screen's own (${on.layouts} vs ${off.layouts})`).toBeLessThanOrEqual(off.layouts + 1);
      expect(on.longTasks, `${name}: motion adds no long task (${on.longTasks} vs ${off.longTasks})`).toBeLessThanOrEqual(off.longTasks);
      expect(on.worstEventMs, `${name}: the tap is handled within 200 ms`).toBeLessThan(200);
    }
  });

  test('200 presses of Next and Back leave no animation, no shape, no extra listener and no growing heap', async ({ page }) => {
    test.setTimeout(240_000);
    const fake = await site();
    await serveSharePoint(page, fake, { pages: PAGES });
    await page.goto(`${pageUrl('index.html')}?preview=${THEMES.kroger.clientId}`);
    await page.getByRole('button', { name: 'Click here to begin' }).click();
    await page.getByRole('button', { name: /^Motion check/ }).click();
    await expect(page.getByRole('progressbar', { name: 'Question 1 of 3' })).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    const listeners = async () => {
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' });
      const own = (await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId!, depth: 0 })).listeners.length;
      const { result: win } = await cdp.send('Runtime.evaluate', { expression: 'window' });
      return own + (await cdp.send('DOMDebugger.getEventListeners', { objectId: win.objectId!, depth: 0 })).listeners.length;
    };
    const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Runtime.getHeapUsage')).usedSize; };
    const next = page.getByRole('button', { name: 'Next', exact: true });
    const back = page.getByRole('button', { name: 'Back', exact: true });
    // Warm up once (the first presses install what is installed once), then measure.
    await next.click(); await back.click();
    await page.waitForTimeout(800);
    const [listenersBefore, heapBefore] = [await listeners(), await heap()];
    for (let press = 0; press < 100; press += 1) {
      await next.click({ noWaitAfter: true });
      await back.click({ noWaitAfter: true });
    }
    await page.waitForTimeout(1000);
    const [listenersAfter, heapAfter] = [await listeners(), await heap()];
    console.log(`  200 presses: listeners ${listenersBefore} -> ${listenersAfter}, heap ${(heapBefore / 1048576).toFixed(2)} -> ${(heapAfter / 1048576).toFixed(2)} MB`);
    expect(await page.evaluate(() => document.getAnimations().length), 'no animation left').toBe(0);
    expect(await page.locator('[data-motion]').count(), 'no shape left').toBe(0);
    expect(listenersAfter, 'no listener added per press').toBe(listenersBefore);
    expect(heapAfter - heapBefore, 'the heap does not grow with the presses').toBeLessThan(1.5 * 1048576);
  });
});
