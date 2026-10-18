import { test, expect, type Page } from '@playwright/test';
import { choices, nextButton, openParticipant, settle, themedSite } from './a11y-support.js';

// Phase 15, part 1: the alignment review's geometry, held (docs/history/ALIGNMENT-REVIEW.md). Each measurement allows 1 px for sub-pixel rounding and the
// Open Sans fallback metrics. A-01: in a list of answers the words of every answer start at one left edge whatever each answer's state, and picking an
// answer does not move its words. And, at
// the device matrix of devices.spec.ts, on a question: no sideways scroll, the column in the middle of the window, the answers one width, and the
// action row on one axis. Measured after any motion has ended (settle).

const TOL = 1;
const MATRIX = [
  { name: 'iPhone portrait', width: 390, height: 844 }, { name: 'iPhone landscape', width: 844, height: 390 },
  { name: 'iPad portrait', width: 820, height: 1180 }, { name: 'iPad landscape', width: 1180, height: 820 },
  { name: 'iPad Pro portrait', width: 1024, height: 1366 }, { name: 'laptop 1366x768', width: 1366, height: 768 }, { name: 'desktop 1440x900', width: 1440, height: 900 },
];

/** The left edge of each answer's words, in the order of the answers. */
const wordEdges = (page: Page) => page.locator('.pms-options .label').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().left));

/** The open flow (every activity open) to the activity of one of each other kind of question: the first is multiple choice (lettered). */
async function toTypes(page: Page) {
  const { fake } = await themedSite({ theme: 'kroger', flow: 'open' });
  await openParticipant(page, fake);
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await page.getByRole('button', { name: /^More question types/ }).click();
  await expect(page.getByRole('progressbar', { name: 'Question 1 of 5' })).toBeVisible();
  await settle(page);
}

test('A-01: the words of every answer start at one edge whatever its state, and a pick does not move them (multiple choice, ranking)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 820, height: 1180 });
  await toTypes(page);
  const before = await wordEdges(page);
  expect(before.length).toBe(4);
  await choices(page).nth(1).click();
  await settle(page);
  const after = await wordEdges(page);
  expect(Math.abs(after[1] - before[1]), 'the picked answer\'s words do not move sideways').toBeLessThanOrEqual(TOL);
  expect(Math.max(...after) - Math.min(...after), `one left edge for picked and unpicked answers: ${after.map((x) => x.toFixed(1))}`).toBeLessThanOrEqual(TOL);
  // The ranking: ranked answers (a number in a badge) and unranked ones (a dash) line up too.
  await nextButton(page).click();
  await expect(page.getByRole('progressbar', { name: 'Question 2 of 5' })).toBeVisible();
  await choices(page).nth(0).click();
  await nextButton(page).click();
  await expect(page.getByRole('progressbar', { name: 'Question 3 of 5' })).toBeVisible();
  await choices(page).nth(1).click();
  await nextButton(page).click();
  await expect(page.getByRole('progressbar', { name: 'Question 4 of 5' })).toBeVisible();
  await choices(page).nth(2).click();
  await settle(page);
  const ranked = await wordEdges(page);
  expect(Math.max(...ranked) - Math.min(...ranked), `ranking: one left edge: ${ranked.map((x) => x.toFixed(1))}`).toBeLessThanOrEqual(TOL);
});

for (const size of MATRIX) {
  test(`a question at ${size.name}: no sideways scroll, the column in the middle, the answers one width, the action row on one axis`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    await toTypes(page);
    const geometry = await page.evaluate(() => {
      const doc = document.documentElement;
      const stage = document.querySelector('main.stage')!.getBoundingClientRect();
      const answers = [...document.querySelectorAll('.pms-options > *')].map((node) => node.getBoundingClientRect().width);
      const actions = [...document.querySelectorAll('.pms-actions > *')].map((node) => { const rect = node.getBoundingClientRect(); return rect.top + rect.height / 2; });
      return { overflow: doc.scrollWidth - doc.clientWidth, left: stage.left, right: doc.clientWidth - stage.right, answers, actions };
    });
    expect(geometry.overflow, 'no sideways scroll').toBeLessThanOrEqual(TOL);
    expect(Math.abs(geometry.left - geometry.right), `the column is in the middle (${geometry.left} vs ${geometry.right})`).toBeLessThanOrEqual(TOL);
    expect(Math.max(...geometry.answers) - Math.min(...geometry.answers), 'every answer is one width').toBeLessThanOrEqual(TOL);
    expect(Math.max(...geometry.actions) - Math.min(...geometry.actions), 'the action row is on one axis').toBeLessThanOrEqual(TOL);
  });
}
