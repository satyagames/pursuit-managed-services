import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ds, openAdmin, startLocal, stopLocal, type Local } from './admin-local.js';
import { seedBigCharts, seedVine } from '../results-charts-fixtures.js';
import { chartProblems, fitProblems, smallText } from './results-charts-support.js';

// Phase 11a, part E: alignment, colour and readability, measured and not only looked at. The BUILT admin page against the REAL local server, with
// VJR's run in miniature (four people, one question of each kind) and a large session (60 people, 15 questions, answers of 90 characters, eight of
// them to a question, a 100-character name, accents, a name that starts with "="), in all three engines, at a phone (390x844), an iPad held upright
// (820x1180), a laptop (1280x800), an iPad on its side (1024x768) and the wall (1920x1080). On every chart: no sideways scroll, no words cut off or
// on top of other words, the labels on one left edge and the bars on one baseline, numbers right-aligned in the numbers view, nothing under 12px on
// the admin page; and on the wall, the type as large as it has been since Phase 7c and one question whole on the screen. Pictures of each kind, on
// the admin view and the wall, a phone and a laptop, are written to test-results/charts/ (and looked at: RELEASE-11A.md says what was changed).

const pictures = fileURLToPath(new URL('../../test-results/charts/', import.meta.url));
const SIZES = [
  { width: 390, height: 844, name: 'phone' },
  { width: 820, height: 1180, name: 'ipad-portrait' },
  { width: 1280, height: 800, name: 'laptop' },
  { width: 1024, height: 768, name: 'ipad-landscape' },
  { width: 1920, height: 1080, name: 'wall' },
] as const;
const PICTURED = new Set(['phone', 'laptop']);

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });

let local: Local;
let vineId = '';
let bigId = '';
test.beforeAll(async () => {
  test.setTimeout(240_000);
  local = await startLocal();
  bigId = (await seedBigCharts(ds)).session.id;
  vineId = (await seedVine(ds)).session.id; // the one that is live
  await mkdir(pictures, { recursive: true });
});
test.afterAll(async () => { await stopLocal(local); });

async function openDisplay(page: Page, sessionId: string) {
  await openAdmin(page, local);
  await page.evaluate((hash) => { window.location.hash = hash; }, `#live-display/${sessionId}`);
  await expect(page.locator('.result-card').first()).toBeVisible();
  await page.waitForTimeout(600); // the bars draw in once (400 ms)
}

/** Every card's numbers view, opened, checked, and closed again. */
async function checkNumbers(page: Page, label: string) {
  const buttons = page.getByRole('button', { name: 'View as table' });
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) await buttons.first().click();
  await expect(page.locator('.numbers__grid')).toHaveCount(count);
  expect(await chartProblems(page), `${label}, the numbers views`).toEqual([]);
  expect(await smallText(page, 'section.live'), `${label}, the numbers views: nothing under 12px`).toEqual([]);
  const back = page.getByRole('button', { name: 'View as chart' });
  for (let index = 0; index < count; index += 1) await back.first().click();
}

for (const [fixture, session] of [['VJR\'s four people', () => vineId], ['sixty people and long answers', () => bigId]] as const) {
  test(`the admin view, ${fixture}: every chart at five sizes, and its numbers`, async ({ page, browserName }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openDisplay(page, session());
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.waitForTimeout(450);
      const label = `${fixture}, admin view, ${size.width}x${size.height}`;
      expect(await chartProblems(page), label).toEqual([]);
      expect(await smallText(page, 'section.live'), `${label}: nothing under 12px`).toEqual([]);
      await checkNumbers(page, label);
      if (fixture.startsWith('VJR') && PICTURED.has(size.name) && browserName === 'chromium') {
        await page.mouse.move(0, 0); // (a pointer resting on a bar would lift it and show its tooltip in the picture)
        for (const card of await page.locator('.result-card').all()) {
          await card.scrollIntoViewIfNeeded();
          await card.screenshot({ path: `${pictures}admin-${await card.getAttribute('data-kind')}-${size.name}.png` });
        }
      }
    }
  });

  test(`the wall, ${fixture}: one question at a time, whole on the screen, in type as large as before`, async ({ page, context, browserName }) => {
    test.setTimeout(300_000);
    // The display's cover alone, as on an iPad (Safari does not put an element in its own full screen): so the wall is exactly the size each step sets,
    // in every engine (Firefox's own full screen is the size of its screen, and Playwright's WebKit often ends its own a moment after it began).
    await context.addInitScript(() => {
      for (const name of ['requestFullscreen', 'webkitRequestFullscreen']) Object.defineProperty(Element.prototype, name, { value: undefined, configurable: true });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await openDisplay(page, session());
    const total = await page.locator('.result-card').count();
    // On the large session a phone and an upright iPad are not walls: there the check is that nothing is cut sideways (see the comment below).
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.getByRole('button', { name: 'Full screen' }).click();
      await expect(page.locator('section.live')).toHaveAttribute('data-presenting', 'true');
      const [wide] = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
      const expected = Math.round(Math.min(2.4, Math.max(1.2, wide / 1000)) * 20) / 20;
      for (let index = 0; index < total; index += 1) {
        await page.waitForTimeout(700); // drawn in, and made smaller if it has to be
        const label = `${fixture}, the wall, ${size.width}x${size.height}, question ${index + 1} of ${total}`;
        const scale = Number(await page.locator('section.live').evaluate((element) => getComputedStyle(element).getPropertyValue('--chart-scale')));
        // The type is what the window asks for (Phase 7c), made smaller only when a long question would not fit, and never below 0.75.
        expect(scale, `${label}: the type`).toBeLessThanOrEqual(expected + 0.001);
        expect(scale, `${label}: the type`).toBeGreaterThanOrEqual(0.75);
        // On a wall (a screen on its side) VJR's questions are short enough that nothing is made smaller; a phone held upright may take a step.
        if (fixture.startsWith('VJR') && size.width > size.height) expect(scale, `${label}: VJR's questions are short, so nothing is made smaller`).toBeCloseTo(expected, 3);
        const prompt = await page.locator('.result-card__prompt').evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
        expect(prompt, `${label}: the question's size follows the type`).toBeCloseTo(16 * scale, 0);
        // Nothing is ever cut; top to bottom, one question is whole on the screen. (Sixty people's 90-character answers do not fit a phone or an
        // upright iPad even at the smallest type, and those are not walls: since Phase 11a-2 the card is then as tall as it needs, nothing in it is
        // cut, and the screen scrolls as one page and says "More below": results-charts-fit.spec.ts.)
        expect(await chartProblems(page), label).toEqual([]);
        if (fixture.startsWith('VJR') || size.width > size.height) expect(await fitProblems(page), label).toEqual([]);
        if (fixture.startsWith('VJR') && PICTURED.has(size.name) && browserName === 'chromium') {
          await page.mouse.move(0, 0);
          await page.screenshot({ path: `${pictures}wall-${await page.locator('.result-card').getAttribute('data-kind')}-${size.name}.png` });
        }
        await page.getByRole('button', { name: 'Next question' }).click();
      }
      await page.keyboard.press('Escape');
      await expect(page.locator('section.live')).toHaveAttribute('data-presenting', 'false');
    }
  });
}

test('Results\' own cards: the same charts, aligned and readable, at a phone and a laptop, with a names panel open', async ({ page, browserName }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAdmin(page, local, 'Results');
  const card = page.locator(`article[data-session="${vineId}"]`);
  await card.locator('summary').click();
  await expect(card.locator('.result-card').first()).toBeVisible();
  await card.locator('.result-card[data-question="v1"] [data-mark="v1b"]').click();
  await expect(card.getByTestId('names-panel')).toBeVisible();
  for (const size of [SIZES[0], SIZES[2]]) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.waitForTimeout(450);
    const label = `Results, ${size.width}x${size.height}`;
    expect(await chartProblems(page), label).toEqual([]);
    expect(await smallText(page, `article[data-session="${vineId}"] .tally__charts`), `${label}: nothing under 12px`).toEqual([]);
    if (browserName === 'chromium') {
      const first = card.locator('.result-card[data-question="v1"]');
      await first.scrollIntoViewIfNeeded();
      await first.screenshot({ path: `${pictures}results-names-panel-${size.name}.png` });
    }
  }
});

test('a confidence scale (Phase 11a-2): wider columns, the average at its true place between the steps, the bands and their names where they were', async ({ page, context }) => {
  test.setTimeout(180_000);
  await context.addInitScript(() => {
    for (const name of ['requestFullscreen', 'webkitRequestFullscreen']) Object.defineProperty(Element.prototype, name, { value: undefined, configurable: true });
  });
  /** What is wrong with the scale of `questionId` on the screen: the average's line and pointer not at the place the counts give, a band not under its steps. */
  const scaleProblems = (questionId: string) => page.evaluate((qid) => {
    const problems: string[] = [];
    const scale = document.querySelector<HTMLElement>(`.result-card[data-question="${qid}"] .scale`)!;
    const plot = scale.querySelector('.scale__plot')!.getBoundingClientRect();
    const columns = [...scale.querySelectorAll('.scale__column')].map((element) => element.getBoundingClientRect());
    const counts = [...scale.querySelectorAll('.scale__count')].map((element) => Number(element.textContent));
    // The steps are worth 1, 2, 3 ... in order (both scales of the fixtures), so the average's place among them is the average less one, and the
    // line is that far along from the middle of the first column towards the middle of the last.
    const average = counts.reduce((sum, count, index) => sum + (index + 1) * count, 0) / counts.reduce((sum, count) => sum + count, 0);
    const expected = plot.left + ((average - 1 + 0.5) / columns.length) * plot.width;
    for (const [what, selector] of [['line', '.scale__average'], ['pointer', '.scale__pointer']] as const) {
      const rect = scale.querySelector(selector)!.getBoundingClientRect();
      const off = rect.left + rect.width / 2 - expected;
      if (Math.abs(off) > 1.5) problems.push(`${qid}: the average's ${what} (${average.toFixed(2)}) is ${off.toFixed(1)}px off its place`);
    }
    for (const band of scale.querySelectorAll<HTMLElement>('.scale__band')) {
      const [from, to] = band.style.gridColumn.split('/').map((part) => Number(part.trim()));
      const rect = band.getBoundingClientRect();
      if (Math.abs(rect.left - columns[from - 1].left) > 1 || Math.abs(rect.right - columns[to - 2].right) > 1) problems.push(`${qid}: a band is not behind steps ${from} to ${to - 1}`);
    }
    for (const name of scale.querySelectorAll<HTMLElement>('.scale__band-name')) {
      const [from, to] = name.style.gridColumn.split('/').map((part) => Number(part.trim()));
      const rect = name.getBoundingClientRect();
      if (rect.left < columns[from - 1].left - 1 || rect.right > columns[to - 2].right + 1) problems.push(`${qid}: the band name "${name.textContent}" is not under steps ${from} to ${to - 1}`);
    }
    return problems;
  }, questionId);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openDisplay(page, vineId);
  // VJR's scale, 0, 2, 0: the average is 2.0, on the middle step; three steps, three bands, and no band names (each step names itself).
  expect(await scaleProblems('v4')).toEqual([]);
  expect(await chartProblems(page)).toEqual([]);
  const middle = await page.locator('.result-card[data-question="v4"] .scale__column').nth(1).evaluate((element) => element.getBoundingClientRect().width);
  const fill = await page.locator('.result-card[data-question="v4"] .scale__fill').nth(1).evaluate((element) => element.getBoundingClientRect().width);
  expect(fill, 'on the admin page a column is 40% of its step, at most 72px').toBeCloseTo(Math.min(72, 0.4 * middle), 0);
  await page.getByRole('button', { name: 'Full screen' }).click();
  for (let step = 0; step < 3; step += 1) await page.getByRole('button', { name: 'Next question' }).click();
  await expect(page.locator('section.live[data-presenting="true"] .result-card')).toHaveAttribute('data-question', 'v4');
  await page.waitForTimeout(700);
  expect(await scaleProblems('v4'), 'in full screen').toEqual([]);
  expect(await chartProblems(page), 'in full screen').toEqual([]);
  await page.keyboard.press('Escape');
  // The large session's five steps: an average between two steps, and the three bands named under the axis.
  await openDisplay(page, bigId);
  await page.locator('.result-card[data-question="w5"]').scrollIntoViewIfNeeded();
  expect(await scaleProblems('w5')).toEqual([]);
  await expect(page.locator('.result-card[data-question="w5"] .scale__band-name')).toHaveCount(3);
});
