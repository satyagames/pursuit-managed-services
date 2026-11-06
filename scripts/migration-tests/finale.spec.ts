import { test, expect, type Page } from '@playwright/test';
import { readConfetti } from './effects-support.js';
import { HEADLINE, openFinale } from './finale-support.js';
import { showerCap } from '../../migration/src/lib/effects/confetti-plan.js';

// Prompt 36: the grand finale on the thank-you page, against the built release page with a synthetic API. Every activity is already done, so the page
// opens straight on the finale. At the full motion level: the petal shower falls from the top, across the whole width; the medal lands and its check is
// drawn by 2.5 s; the name's letters are all in by 3 s and the numbers final by 3.6 s; "Celebrate again" shows in the afterglow and replays; the shower
// is gone by 11 s and asks for no more frames. The buttons work from the first frame and nothing covers them. The status line is said once.
// The frame strip, the frame rate at 4x slowdown, the flashing check and the layout shift are in finale-perf.spec.ts (Chromium, DevTools).

const VIEWPORTS = [{ width: 1180, height: 820 }, { width: 820, height: 1180 }, { width: 1366, height: 650 }, { width: 390, height: 844 }];

type FinaleState = { frames: number; showerAt: number; showerGone: number };
const finaleState = (page: Page) => page.evaluate(() => (window as unknown as { __finale: FinaleState }).__finale);

/** Waits until `ms` after the shower started. */
async function at(page: Page, ms: number) {
  await page.waitForFunction((target) => {
    const state = (window as unknown as { __finale: FinaleState }).__finale;
    return state.showerAt > 0 && performance.now() - state.showerAt >= target;
  }, ms, { polling: 20, timeout: 20_000 });
}

/** Which thirds of the shower canvas (left, middle, right) have a piece drawn in the top `rows` share of it, now. */
const paintedThirds = (page: Page, rows = 1) => page.evaluate((share) => {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-pms-shower]');
  if (!canvas) return null;
  const { data, width, height } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, Math.max(1, Math.round(canvas.height * share)));
  const thirds = [false, false, false];
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) if (data[(y * width + x) * 4 + 3] > 0) thirds[Math.min(2, Math.floor((x / width) * 3))] = true;
  return thirds;
}, rows);

for (const viewport of VIEWPORTS) {
  test(`full motion at ${viewport.width}x${viewport.height}: the shower from above, the medal, the name, the numbers, the afterglow, then nothing`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    const { problems } = await openFinale(page);
    await at(page, 0);

    await at(page, 500);
    const early = await readConfetti(page);
    expect(early.maxPerFrame, 'pieces are falling within 0.5 s').toBeGreaterThan(0);
    expect(await paintedThirds(page, 0.5), 'from the top: the curtain starts on the left').toEqual(expect.arrayContaining([true]));

    await at(page, 1700);
    expect(await paintedThirds(page), 'across the whole width').toEqual([true, true, true]);

    await at(page, 2500);
    const medal = await page.evaluate(() => {
      const node = document.querySelector('.pms-medal')!;
      const path = node.querySelector('path')!;
      return {
        opacity: getComputedStyle(node).opacity,
        moving: node.getAnimations().filter((animation) => animation.playState === 'running').length,
        dash: parseFloat(getComputedStyle(path).strokeDashoffset),
      };
    });
    expect(medal, 'the medal has landed and its check is drawn by 2.5 s').toEqual({ opacity: '1', moving: 0, dash: 0 });

    await at(page, 3000);
    const letters = await page.evaluate(() => [...document.querySelectorAll('.pms-letter')].map((node) => getComputedStyle(node).opacity));
    expect(letters.length).toBeGreaterThan(5);
    expect(letters.every((opacity) => opacity === '1'), `every letter is in by 3 s (${letters.join(' ')})`).toBe(true);

    await at(page, 3300);
    await expect(page.getByRole('button', { name: 'Celebrate again' }), 'not before the afterglow').toBeHidden();

    await at(page, 3650);
    await expect(page.getByText('3 activities completed')).toBeVisible();
    await expect(page.getByText('5 of 5 right on the first try')).toBeVisible();
    await expect(page.getByText(/^0 /), 'no card is still counting').toHaveCount(0);

    await at(page, 4000);
    await expect(page.getByRole('button', { name: 'Celebrate again' })).toBeVisible();

    const drawn = await readConfetti(page);
    expect(drawn.maxPerFrame, 'never more pieces than the cap').toBeLessThanOrEqual(showerCap(viewport.width));

    await page.waitForFunction(() => (window as unknown as { __finale: FinaleState }).__finale.showerGone > 0, null, { timeout: 12_000 });
    const gone = await finaleState(page);
    expect(gone.showerGone - gone.showerAt, 'the shower and its afterglow are gone by 11 s').toBeLessThanOrEqual(11_000);
    await expect(page.locator('canvas[data-pms-confetti]')).toHaveCount(0);
    await page.waitForTimeout(300);
    const before = (await finaleState(page)).frames;
    await page.waitForTimeout(1000);
    expect((await finaleState(page)).frames - before, 'and the loop has stopped: no more frames are asked for').toBe(0);
    expect(problems, 'console and page errors').toEqual([]);
  });
}

test('"Celebrate again" replays the whole thing, keeps its place and its focus, and says nothing twice', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1180, height: 820 });
  const { problems } = await openFinale(page);
  await at(page, 3900);
  const status = page.getByRole('status');
  await expect(status).toHaveCount(1);
  await expect(status).toHaveText(`All activities done. ${HEADLINE}`);
  const again = page.getByRole('button', { name: 'Celebrate again' });
  const place = await again.boundingBox();
  await again.click();
  await expect(again).toBeFocused();
  await page.waitForFunction(() => document.querySelectorAll('canvas[data-pms-shower]').length === 1, null, { timeout: 2000 });
  await expect(page.locator('canvas[data-pms-confetti]'), 'one canvas, not two').toHaveCount(1);
  const moving = await page.evaluate(() => document.querySelector('.pms-medal')!.getAnimations().length);
  expect(moving, 'the medal lands again').toBeGreaterThan(0);
  await expect(again, 'the button stays usable while it replays').toBeVisible();
  const now = (await again.boundingBox())!;
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(now[key] - place![key]), `the button has not moved (${key})`).toBeLessThan(0.5);
  await expect(status).toHaveText(`All activities done. ${HEADLINE}`);
  expect(problems).toEqual([]);
});

test('the buttons work from the first frame: nothing covers them and the canvas takes no tap', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await openFinale(page);
  const home = page.getByRole('button', { name: 'Home', exact: true });
  for (const ms of [0, 400, 1200, 2200, 3200]) {
    await at(page, ms);
    const hit = await home.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return Boolean(top && node.contains(top));
    });
    expect(hit, `Home is the topmost thing under a tap at ${ms} ms`).toBe(true);
  }
  const canvas = await page.locator('canvas[data-pms-shower]').evaluate((node) => getComputedStyle(node).pointerEvents);
  expect(canvas).toBe('none');
  await home.click();
  await expect(page.getByRole('heading', { name: 'Hi Jordan Lee!' })).toBeVisible();
  await expect(page.locator('canvas[data-pms-confetti]'), 'the shower does not follow the guest').toHaveCount(0);
});

test('the numbers are text, the medal and the shower are hidden from assistive tech, and the heading keeps its name', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await openFinale(page);
  await at(page, 3700);
  await expect(page.getByRole('heading', { name: HEADLINE })).toBeVisible();
  await expect(page.locator('.pms-medal-wrap')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('canvas[data-pms-shower]')).toHaveAttribute('aria-hidden', 'true');
  const cards = await page.locator('.pms-card').allInnerTexts();
  expect(cards.map((text) => text.replace(/\s+/g, ' ').trim())).toEqual(['3 activities completed', '5 of 5 right on the first try']);
});
