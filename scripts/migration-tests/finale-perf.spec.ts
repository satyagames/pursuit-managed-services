import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openFinale } from './finale-support.js';
import { averageLuminance, mostChangesInASecond } from './png-luma.js';

// Prompt 36: what the finale costs and looks like over time, in Chromium through the DevTools protocol. The frame strip (0, 0.5, 1.2, 2, 3, 4 and 8 s
// at iPad landscape and phone width, written to test-results/finale/), the frame rate at 4x CPU slowdown (30 fps or more, or the shower stepped itself
// down), no flashing (the page's average luminance sampled about every 100 ms: no more than 2 changes of 0.1, WCAG 2.3.1's threshold, in any second), no long task
// as the page starts, and no layout shift during the sequence. The numbers are written to test-results/finale/measures.<width>.json.

const out = fileURLToPath(new URL('../../test-results/finale/', import.meta.url));
const STRIP_MS = [0, 500, 1200, 2000, 3000, 4000, 8000];

async function showerStart(page: Page) {
  await page.waitForFunction(() => (window as unknown as { __finale: { showerAt: number } }).__finale.showerAt > 0, null, { timeout: 10_000 });
  return page.evaluate(() => (window as unknown as { __finale: { showerAt: number } }).__finale.showerAt);
}
const sinceStart = (page: Page) => page.evaluate(() => performance.now() - (window as unknown as { __finale: { showerAt: number } }).__finale.showerAt);
async function waitUntil(page: Page, ms: number) {
  await page.waitForFunction((target) => performance.now() - (window as unknown as { __finale: { showerAt: number } }).__finale.showerAt >= target, ms, { polling: 10, timeout: 15_000 });
}

/** Watches, from before the page loads: layout shifts, long tasks, the frames' times, and whether the shower stepped down. */
async function installWatch(page: Page) {
  await page.addInitScript(() => {
    const watch = { shifts: [] as [number, number, string[]][], longTasks: [] as [number, number][], frames: [] as number[], struggling: false };
    (window as unknown as Record<string, unknown>).__watch = watch;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Node | null }[] })[]) {
        if (entry.hadRecentInput) continue;
        // What moved: "finale" for anything inside the thank-you card, otherwise the element's class (the page's header, which settles as the greeting loads).
        const what = (entry.sources ?? []).map(({ node }) => (node instanceof Element ? (node.closest('.pms-final') ? 'finale' : String(node.className)) : 'text'));
        watch.shifts.push([entry.startTime, entry.value, what]);
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) watch.longTasks.push([entry.startTime, entry.duration]); }).observe({ type: 'longtask', buffered: true });
    const frame = (now: number) => { watch.frames.push(now); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    // The governor stepping the motion level down (it is written on the page's root), which stops the shower's further bursts.
    new MutationObserver(() => { if (document.documentElement.dataset.motionLevel && document.documentElement.dataset.motionLevel !== 'full') watch.struggling = true; })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion-level'] });
  });
}
type Watch = { shifts: [number, number, string[]][]; longTasks: [number, number][]; frames: number[]; struggling: boolean };
const readWatch = (page: Page) => page.evaluate(() => (window as unknown as { __watch: Watch }).__watch);

const fpsBetween = (frames: number[], from: number, to: number) => {
  const inside = frames.filter((at) => at >= from && at <= to);
  return inside.length > 1 ? ((inside.length - 1) * 1000) / (inside.at(-1)! - inside[0]) : 0;
};

for (const viewport of [{ width: 1180, height: 820 }, { width: 390, height: 844 }]) {
  test(`the frame strip and the numbers at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await installWatch(page);
    await mkdir(`${out}strip-${viewport.width}/`, { recursive: true });
    await openFinale(page);
    const start = await showerStart(page);
    const taken: { ms: number; file: string }[] = [];
    for (const ms of STRIP_MS) {
      await waitUntil(page, ms);
      const actual = Math.round(await sinceStart(page));
      const file = `strip-${viewport.width}/${ms}.png`;
      await page.screenshot({ path: `${out}${file}` });
      taken.push({ ms: actual, file });
    }
    const watch = await readWatch(page);
    // The finale's own shifts: anything inside the card. (At phone width the page's header wraps once as the greeting loads, which the finale does not cause.)
    const during = watch.shifts.filter(([at]) => at >= start && at <= start + 4500);
    const shift = during.filter(([, , what]) => what.includes('finale')).reduce((sum, [, value]) => sum + value, 0);
    const longAtStart = watch.longTasks.filter(([at, duration]) => at + duration >= start - 200 && at <= start + 1000);
    const fps = fpsBetween(watch.frames, start + 350, start + 4200);
    const measures = { viewport, fps: Math.round(fps * 10) / 10, layoutShift: shift, shiftsDuring: during, longTasksAtStart: longAtStart, strip: taken };
    await writeFile(`${out}measures.${viewport.width}.json`, `${JSON.stringify(measures, null, 2)}\n`);
    console.log(`finale at ${viewport.width}px: ${measures.fps} fps, layout shift ${shift}, long tasks at start ${JSON.stringify(longAtStart)}`);

    // One picture of the strip: the frames side by side with their times, for the report.
    const cells = await Promise.all(taken.map(async ({ ms, file }) => `<figure><img src="data:image/png;base64,${(await readFile(`${out}${file}`)).toString('base64')}"><figcaption>${(ms / 1000).toFixed(1)} s</figcaption></figure>`));
    const strip = await page.context().newPage();
    const scale = viewport.width > 600 ? 0.25 : 0.5;
    await strip.setViewportSize({ width: Math.ceil(viewport.width * scale * STRIP_MS.length + 8 * (STRIP_MS.length + 1)), height: Math.ceil(viewport.height * scale + 40) });
    await strip.setContent(`<!doctype html><style>body{margin:0;display:flex;gap:8px;padding:4px 8px;background:#222;font:14px sans-serif;color:#fff}figure{margin:0}img{width:${Math.round(viewport.width * scale)}px;display:block}figcaption{text-align:center;padding-top:4px}</style>${cells.join('')}`);
    await strip.screenshot({ path: `${out}strip-${viewport.width}.png`, fullPage: true });
    await strip.close();

    expect(shift, 'no layout shift during the sequence').toBe(0);
    expect(longAtStart, 'no long task as the finale starts').toEqual([]);
  });
}

test('at 4x CPU slowdown the shower holds 30 fps or the governor steps the motion down', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1180, height: 820 });
  await installWatch(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await openFinale(page);
  const start = await showerStart(page);
  await waitUntil(page, 4300);
  const watch = await readWatch(page);
  const fps = fpsBetween(watch.frames, start + 350, start + 4200);
  await mkdir(out, { recursive: true });
  await writeFile(`${out}measures.slow.json`, `${JSON.stringify({ throttle: 4, fps: Math.round(fps * 10) / 10, steppedDown: watch.struggling }, null, 2)}\n`);
  console.log(`finale at 4x slowdown: ${fps.toFixed(1)} fps, governor stepped down: ${watch.struggling}`);
  expect(fps >= 30 || watch.struggling, `${fps.toFixed(1)} fps and the governor did not step down`).toBe(true);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});

test('no flashing: the page\'s average luminance changes by more than 0.1 (WCAG 2.3.1) at most twice in any second', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1180, height: 820 });
  await openFinale(page);
  const cdp = await page.context().newCDPSession(page);
  await showerStart(page);
  const samples: [number, number][] = [];
  while (samples.length === 0 || samples.at(-1)![0] < 4600) {
    const ms = await sinceStart(page);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1180, height: 820, scale: 0.2 } });
    samples.push([ms, averageLuminance(Buffer.from(shot.data, 'base64'))]);
    await page.waitForTimeout(Math.max(0, 100 - ((await sinceStart(page)) - ms)));
  }
  const most = mostChangesInASecond(samples, 0.1);
  const relative = mostChangesInASecond(samples, 0.1, { relative: true });
  await mkdir(out, { recursive: true });
  await writeFile(`${out}luminance.json`, `${JSON.stringify({ most, relative, samples: samples.map(([ms, luma]) => [Math.round(ms), Math.round(luma * 1000) / 1000]) }, null, 2)}\n`);
  console.log(`finale luminance: ${samples.length} samples, at most ${most} changes of 0.1 (WCAG) in a second; ${relative} of over 10 percent of the brighter sample`);
  expect(samples.length, 'sampled about every 100 ms').toBeGreaterThan(25);
  expect(most).toBeLessThanOrEqual(2);
});
