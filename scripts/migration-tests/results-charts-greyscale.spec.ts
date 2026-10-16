import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ds, openAdmin, startLocal, stopLocal, type Local } from './admin-local.js';
import { seedBigCharts, seedVine } from '../results-charts-fixtures.js';

// Phase 11a, part E: the charts read in greyscale (a page printed in black and white, a projector washed out, a reader who cannot tell the hues
// apart). Each chart is photographed as the admin view draws it, the picture is turned grey (luma, 0.299 R + 0.587 G + 0.114 B) in a Chromium page,
// and the grey of the highlighted mark is held against the grey of the tint at 1.5:1 at least (WCAG's contrast of the two greys). The grey pictures
// are written to test-results/charts/grey-*.png to be looked at. Chromium only: the decoding is a Chromium page, as in contrast.spec.ts.

const pictures = fileURLToPath(new URL('../../test-results/charts/', import.meta.url));
const AT_LEAST = 1.5;

let local: Local;
test.beforeEach(async () => { local = await startLocal(); });
test.afterEach(async () => { await stopLocal(local); });

/** The middle of `mark`, in the picture of `card`. */
async function middleOf(card: Locator, mark: Locator) {
  const [outer, inner] = [(await card.boundingBox())!, (await mark.boundingBox())!];
  return { x: inner.x - outer.x + inner.width / 2, y: inner.y - outer.y + inner.height / 2 };
}

/** The picture made grey, and the grey at each point (the mean of a 3 x 3 patch), measured in a page of its own. */
async function grey(page: Page, png: Buffer, points: { x: number; y: number }[]) {
  const tab = await page.context().newPage();
  try {
    return await tab.evaluate(async ({ base64, points: at }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = [image.width, image.height];
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < data.data.length; index += 4) {
        const luma = Math.round(0.299 * data.data[index] + 0.587 * data.data[index + 1] + 0.114 * data.data[index + 2]);
        data.data[index] = data.data[index + 1] = data.data[index + 2] = luma;
      }
      context.putImageData(data, 0, 0);
      const greys = at.map(({ x, y }) => {
        let sum = 0;
        for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) sum += data.data[((Math.round(y) + dy) * canvas.width + Math.round(x) + dx) * 4];
        return sum / 9;
      });
      return { greys, png: canvas.toDataURL('image/png').split(',')[1] };
    }, { base64: png.toString('base64'), points });
  } finally {
    await tab.close();
  }
}

/** WCAG's contrast of two greys (0-255). */
function ratio(a: number, b: number) {
  const lum = (value: number) => { const unit = value / 255; return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; };
  const [light, dark] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

test('in greyscale, the highlighted mark and the tint are 1.5:1 apart or more, on every kind of chart', async ({ page }) => {
  test.setTimeout(180_000);
  const big = await seedBigCharts(ds);
  const { session } = await seedVine(ds);
  await mkdir(pictures, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAdmin(page, local);
  const lines: string[] = [];
  const pairs: { kind: string; sessionId: string; question: string; first: string; second: string; what: string; wall?: boolean }[] = [
    { kind: 'choice', sessionId: session.id, question: 'v1', first: '.bars__bar--correct', second: '.bars__bar--rest', what: 'the correct answer (Dark Green) against the tint' },
    { kind: 'choice-top', sessionId: big.session.id, question: 'w2', first: '.bars__bar--top', second: '.bars__bar--rest', what: 'the top choice (Deloitte Blue) against the tint' },
    { kind: 'multi', sessionId: session.id, question: 'v2', first: '.bars__bar--top', second: '.bars__bar--rest', what: 'the top choice against the tint' },
    { kind: 'truefalse', sessionId: big.session.id, question: 'w12', first: '.split__slice--true', second: '.split__slice:not(.split__slice--true)', what: 'True, the correct answer (Dark Green), against False (the tint)' },
    { kind: 'truefalse-wall', sessionId: big.session.id, question: 'w12', first: '.split__slice--true', second: '.split__slice:not(.split__slice--true)', what: 'True (Deloitte Blue, the answer not shown yet) against False (the tint)', wall: true },
    { kind: 'ranking', sessionId: session.id, question: 'v5', first: '.bars__bar--top', second: '.bars__bar--rest', what: 'the top place against the tint' },
    { kind: 'scale', sessionId: big.session.id, question: 'w5', first: '.scale__column:last-of-type .scale__fill', second: '.scale__column:first-of-type .scale__fill', what: 'the high end of the ramp against the low end' },
  ];
  let opened = '';
  for (const pair of pairs) {
    const hash = `#live-display/${pair.sessionId}${pair.wall ? '/wall' : ''}`;
    if (opened !== hash) {
      await page.evaluate((next) => { window.location.hash = next; }, hash);
      await expect(page.locator('.result-card').first()).toBeVisible();
      opened = hash;
    }
    await page.mouse.move(0, 0);
    const card = page.locator(`.result-card[data-question="${pair.question}"]`);
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600); // drawn in
    const [first, second] = [card.locator(pair.first).first(), card.locator(pair.second).first()];
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    const png = await card.screenshot();
    const { greys, png: greyPng } = await grey(page, png, [await middleOf(card, first), await middleOf(card, second)]);
    await writeFile(`${pictures}grey-${pair.kind}.png`, Buffer.from(greyPng, 'base64'));
    const measured = ratio(greys[0], greys[1]);
    lines.push(`  ${measured.toFixed(2)}:1  ${pair.kind}: ${pair.what} (greys ${greys.map((value) => Math.round(value)).join(' and ')})`);
    expect(measured, `${pair.kind}: ${pair.what}`).toBeGreaterThanOrEqual(AT_LEAST);
  }
  console.log(`Results charts in greyscale:\n${lines.join('\n')}`);
});
