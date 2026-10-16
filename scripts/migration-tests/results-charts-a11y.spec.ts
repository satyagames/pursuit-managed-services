import { test, expect, type Page } from '@playwright/test';
import { axeCheck, describeFindings, type Finding } from './a11y-support.js';
import { ds, openAdmin, startLocal, stopLocal, type Local } from './admin-local.js';
import { seedBigCharts, seedVine } from '../results-charts-fixtures.js';

// Phase 11a, part E: axe-core at WCAG 2.1 A and AA (colour contrast on) on the Results charts, on Live results and on Results' own cards, in every
// state a chart has: as drawn, a names panel open, the numbers view, a word chosen among the written answers, the wall with its answer shown, and
// with the names hidden. Chromium only, as a11y.spec.ts is (migration/playwright.config.ts says why): there are no waivers, so any finding fails it.

test.use({ actionTimeout: 15_000 });

let local: Local;
test.beforeEach(async () => { local = await startLocal(); });
test.afterEach(async () => { await stopLocal(local); });

async function check(page: Page, where: string, findings: Finding[]) {
  await page.waitForTimeout(500); // the bars have drawn in
  const result = await axeCheck(page, where);
  findings.push(...result.findings);
}

test('Live results, the Results cards and the wall: axe finds nothing, in every state of the charts', async ({ page }) => {
  test.setTimeout(240_000);
  const big = await seedBigCharts(ds);
  const { session } = await seedVine(ds);
  const findings: Finding[] = [];
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAdmin(page, local);
  for (const [name, id] of [['VJR\'s four people', session.id], ['sixty people', big.session.id]] as const) {
    await page.evaluate((hash) => { window.location.hash = hash; }, `#live-display/${id}`);
    await expect(page.locator('.result-card').first()).toBeVisible();
    await check(page, `Live results, ${name}`, findings);
    // A names panel open on every chart that has one.
    for (const card of await page.locator('.result-card').all()) {
      const mark = card.locator('[data-mark]').first();
      if ((await card.getAttribute('data-kind')) === 'text') await mark.click(); // a word chosen
      else if ((await mark.getAttribute('aria-expanded')) !== 'true') await mark.click();
    }
    await check(page, `Live results, ${name}, a names panel open on each chart and a word chosen`, findings);
    // Every card in its numbers view.
    while (await page.getByRole('button', { name: 'View as table' }).count()) await page.getByRole('button', { name: 'View as table' }).first().click();
    await check(page, `Live results, ${name}, the numbers views`, findings);
    while (await page.getByRole('button', { name: 'View as chart' }).count()) await page.getByRole('button', { name: 'View as chart' }).first().click();
    // The names hidden.
    await page.getByRole('switch', { name: /Names shown/ }).click();
    await check(page, `Live results, ${name}, the names hidden`, findings);
    await page.getByRole('switch', { name: /Names shown/ }).click();
  }
  // The wall page, with every graded answer shown, and its full screen.
  await page.evaluate((hash) => { window.location.hash = hash; }, `#live-display/${session.id}/wall`);
  await expect(page.getByRole('heading', { name: 'Live results · Wall display' })).toBeVisible();
  await check(page, 'the wall page', findings);
  while (await page.getByRole('button', { name: 'Show answer' }).count()) await page.getByRole('button', { name: 'Show answer' }).first().click();
  await check(page, 'the wall page, every answer shown', findings);
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(page.locator('section.live')).toHaveAttribute('data-presenting', 'true');
  for (let index = 0; index < 6; index += 1) {
    const show = page.getByRole('button', { name: 'Show answer' });
    if (await show.count()) await show.click();
    await check(page, `the wall in full screen, question ${index + 1}`, findings);
    await page.getByRole('button', { name: 'Next question' }).click();
  }
  await page.keyboard.press('Escape');
  // Results: the session's card opened, its charts, a names panel and the numbers.
  await page.getByRole('tab', { name: 'Results', exact: true }).click();
  const sessionCard = page.locator(`article[data-session="${session.id}"]`);
  await sessionCard.locator('summary').click();
  await expect(sessionCard.locator('.result-card').first()).toBeVisible();
  await check(page, 'Results, a session\'s live results open', findings);
  await sessionCard.locator('.result-card[data-question="v1"] [data-mark="v1b"]').click();
  await sessionCard.locator('.result-card[data-question="v6"] [data-mark]').first().click();
  await check(page, 'Results, a names panel open and a word chosen', findings);
  await sessionCard.getByRole('button', { name: 'View as table' }).first().click();
  await check(page, 'Results, a numbers view', findings);
  expect(findings, describeFindings(findings)).toEqual([]);
});
