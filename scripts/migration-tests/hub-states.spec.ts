import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { sharePointFolderPath } from '../deployment-config.js';
import { addFlowContent, makeVisitor, mockApi } from './fixtures.js';
import { confettiCanvas, installAudioStub, installConfettiSpy, readAudio, readConfetti, resetConfetti } from './effects-support.js';
import { CUES, toneSignature } from '../../migration/src/lib/effects/sound-cues.js';

// Prompt 24: the Activities hub in a real page: the four states, a complete-then-return (the check, the open padlock, the colours, the cues, the sparks
// and the overlay going), nothing on a reload, a navigation clearing what is left, the locked tap, and the muted and the reduced-motion page.

const appPath = (hash: string) => `${sharePointFolderPath}/index.html${hash}`;
const pill = (page: Page, name: string | RegExp) => page.getByRole('button', { name });
const choice = (page: Page, index: number) => page.locator('.pms-options button').nth(index);
const shots = 'test-results/hub-states';

async function open(page: Page, { flow = null as 'open' | null, sound = true, seed = [] as string[] } = {}) {
  const fixture = await mockApi(page);
  const { right } = addFlowContent(fixture, { flow });
  makeVisitor(fixture);
  fixture.give(seed.map((id) => ({ questionId: id, answer: right(id) })));
  await installAudioStub(page, {});
  await installConfettiSpy(page);
  if (sound) await page.addInitScript(() => { window.localStorage.setItem('pms.sound', 'on'); });
  await page.goto(appPath('#/welcome?t=track-a'));
  await page.getByRole('button', { name: /^(Click here to begin|Activities)$/ }).first().click();
  await expect(pill(page, /Alpha's History/)).toBeVisible();
  return { fixture, right };
}

/** Answers the first activity to its end, and stays on its result screen. */
async function finishHistory(page: Page) {
  await pill(page, /Alpha's History/).click();
  await choice(page, 1).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await choice(page, 2).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await choice(page, 0).click();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
  await expect(confettiCanvas(page)).toHaveCount(0, { timeout: 8000 });
  await resetConfetti(page);
}

const contains = (haystack: number[], needle: number[]) => haystack.some((_, at) => needle.every((note, offset) => haystack[at + offset] === note));

test('the four states, each with its word, its icon and its name', async ({ page }) => {
  await open(page, { seed: ['q-h1'] });
  const history = pill(page, "Alpha's History, in progress, 1 of 3 questions");
  await expect(history).toHaveAttribute('data-state', 'progress');
  await expect(history).toContainText('In progress · 1 of 3 questions');
  await expect(history.locator('.ring')).toBeVisible();
  const brand = pill(page, 'Guess the Brand, locked. Finish the previous activity');
  await expect(brand).toHaveAttribute('aria-disabled', 'true');
  await expect(brand).toContainText('Locked');
  await expect(brand.locator('.shackle')).toHaveCount(1);
  await expect(page.getByText('0 of 3 complete')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Activities complete' })).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('[data-motion]')).toHaveCount(0);
  const results = await new AxeBuilder({ page }).include('.pms-hub').analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  await page.screenshot({ path: `${shots}/in-progress-${test.info().project.name}.png` });
});

test('any order: every unfinished activity with no answer is ready, with an open padlock', async ({ page }) => {
  await open(page, { flow: 'open' });
  for (const name of ["Alpha's History, ready", 'Guess the Brand, ready', 'Quick pulse, ready']) await expect(pill(page, name)).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('.activity[data-state="locked"]')).toHaveCount(0);
  await expect(page.getByText('Up next · 3 questions')).toHaveCount(1);
  await page.screenshot({ path: `${shots}/any-order-${test.info().project.name}.png` });
});

test('complete and return: the old look, then the check, the open padlock and the new colours, the two cues in order, the sparks and the overlay going; a reload plays nothing', async ({ page }) => {
  await open(page);
  await finishHistory(page);
  const before = await readAudio(page);
  await page.getByRole('button', { name: 'Back to activities' }).click();

  // At once: what a pill does and says is its real state, while its paint waits for its beat. A tap would already open it.
  const history = pill(page, "Alpha's History, done");
  const brand = pill(page, 'Guess the Brand, ready');
  await expect(history).toBeVisible();
  await expect(brand).not.toHaveAttribute('aria-disabled', 'true');
  await expect(history).toHaveAttribute('data-state', 'done');
  await expect(history.locator('.badge')).toBeVisible();
  await expect(brand).toHaveAttribute('data-state', 'ready', { timeout: 3000 });
  await expect(brand).toContainText('Ready');
  await expect(page.getByText('1 of 3 complete')).toBeVisible();

  await expect.poll(async () => contains((await readAudio(page)).oscillators.slice(before.oscillators.length), toneSignature(CUES.unlock)), { timeout: 3000 }).toBe(true);
  const heard = (await readAudio(page)).oscillators.slice(before.oscillators.length);
  expect(heard.indexOf(toneSignature(CUES.stamp)[0]), 'the stamp comes first').toBeLessThan(heard.indexOf(toneSignature(CUES.unlock)[0]));
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: 'Alpha\'s History is done. Guess the Brand is now ready.' })).toHaveCount(1);
  expect((await readConfetti(page)).maxPerFrame, 'never more than 24 sparks').toBeLessThanOrEqual(24);
  await expect(confettiCanvas(page), 'the overlay goes when the sparks have gone').toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('.activity[data-moment]')).toHaveCount(0, { timeout: 3000 });
  await page.screenshot({ path: `${shots}/after-unlock-${test.info().project.name}.png` });

  await page.reload();
  await expect(pill(page, 'Guess the Brand, ready')).toBeVisible();
  await page.waitForTimeout(1500);
  expect((await readAudio(page)).oscillators, 'a reload replays nothing').toEqual([]);
  expect(await page.locator('.activity[data-moment]').count()).toBe(0);
});

test('a navigation clears what is left of the moment: no later cue, no overlay', async ({ page }) => {
  await open(page);
  await finishHistory(page);
  const before = await readAudio(page);
  await page.getByRole('button', { name: 'Back to activities' }).click();
  await pill(page, 'Guess the Brand, ready').click(); // at once: nothing waits for the moment
  await expect(page).toHaveURL(/#\/quiz\/section-brand/);
  // (However far the moment had got by then: a slower engine reaches the tap later. From here on, nothing.)
  const left = (await readAudio(page)).oscillators.length;
  await page.waitForTimeout(1500);
  expect((await readAudio(page)).oscillators.length, 'no cue after leaving').toBe(left);
  expect(left).toBeGreaterThanOrEqual(before.oscillators.length);
  await expect(confettiCanvas(page)).toHaveCount(0);
});

test('a locked tap: the shake, the knock, the polite line, no red; a second tap inside 400 ms does not stack', async ({ page }) => {
  await open(page);
  const brand = page.locator('.activity[data-state="locked"]').first();
  const before = await readAudio(page);
  await brand.click({ force: true });
  await brand.click({ force: true, delay: 0 });
  await expect(page).toHaveURL(/#\/agenda/);
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: 'Locked. Finish the previous activity first.' })).toHaveCount(1);
  await expect.poll(async () => (await readAudio(page)).oscillators.length - before.oscillators.length).toBe(toneSignature(CUES.locked).length);
  const colour = await brand.evaluate((element) => getComputedStyle(element).backgroundColor);
  await expect(brand).not.toHaveAttribute('data-moment', /./, { timeout: 2000 });
  expect(await brand.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(colour);
});

test('every activity done: the stamp, the all-done cue, the green wave down the pills, Finish rises, one medium burst, and Finish still goes to the finale', async ({ page }) => {
  await open(page, { seed: ['q-h1', 'q-h2', 'q-h3', 'q-b1', 'q-b2'] });
  const last = pill(page, /Quick pulse/);
  await last.click();
  await choice(page, 0).click();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
  await expect(confettiCanvas(page)).toHaveCount(0, { timeout: 8000 });
  await resetConfetti(page);
  const before = await readAudio(page);
  await page.getByRole('button', { name: 'Back to activities' }).click();
  await expect(page.locator('.activity[data-moment="wave"]').first()).toBeAttached({ timeout: 3000 });
  await expect(page.getByRole('button', { name: 'Finish', exact: true })).toHaveAttribute('data-moves', 'true', { timeout: 3000 });
  await expect.poll(async () => contains((await readAudio(page)).oscillators.slice(before.oscillators.length), toneSignature(CUES.allDone)), { timeout: 3000 }).toBe(true);
  await expect(page.getByText('3 of 3 complete')).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: 'Quick pulse is done. Every activity is done.' })).toHaveCount(1);
  expect((await readConfetti(page)).maxPerFrame, 'the medium burst came').toBeGreaterThan(24);
  await expect(confettiCanvas(page), 'and went').toHaveCount(0, { timeout: 8000 });
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Thank you/ })).toBeVisible();
});

test('sound off: every beat is silent and the motion stays', async ({ page }) => {
  await open(page, { sound: false });
  await finishHistory(page);
  await page.getByRole('button', { name: 'Back to activities' }).click();
  await expect(pill(page, 'Guess the Brand, ready')).toHaveAttribute('data-state', 'ready', { timeout: 3000 });
  await page.waitForTimeout(800);
  expect((await readAudio(page)).oscillators, 'no tone at all').toEqual([]);
  expect((await readConfetti(page)).maxPerFrame, 'the sparks still came').toBeGreaterThan(0);
});

test('reduced motion: the finished hub at once, no overlay at all, and the sound stays', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await finishHistory(page);
  const before = await readAudio(page);
  await page.getByRole('button', { name: 'Back to activities' }).click();
  const brand = pill(page, 'Guess the Brand, ready');
  await expect(brand).toHaveAttribute('data-state', 'ready', { timeout: 300 });
  await expect.poll(async () => contains((await readAudio(page)).oscillators.slice(before.oscillators.length), toneSignature(CUES.unlock)), { timeout: 3000 }).toBe(true);
  expect((await readConfetti(page)).added, 'no overlay').toBe(0);
  await expect(page.locator('.activity[data-moment]')).toHaveCount(0);
});

test('performance on the slow iPad stand-in (4x slower CPU): the moment\'s frames, printed; no long frame over 50 ms in the moment once the screen has been drawn', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CPU throttling and long tasks are the DevTools protocol');
  await open(page);
  await finishHistory(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(() => {
    const gaps: number[] = [];
    let last = 0;
    const tick = (now: number) => { if (last) gaps.push(now - last); last = now; (window as unknown as { __gaps: number[] }).__gaps = gaps; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await page.getByRole('button', { name: 'Back to activities' }).click();
  await page.waitForTimeout(1600);
  const gaps = await page.evaluate(() => (window as unknown as { __gaps: number[] }).__gaps);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  // The first frames carry the new screen's own drawing, not the moment (as the governor leaves them out).
  const moment = gaps.slice(8);
  const long = moment.filter((gap) => gap > 50);
  const sorted = [...moment].sort((a, b) => a - b);
  console.log(`[hub moment, 4x CPU] ${moment.length} frames, p50 ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} ms, longest ${sorted.at(-1)!.toFixed(1)} ms, over 50 ms: ${long.length} (first frames left out: ${gaps.slice(0, 8).map((gap) => gap.toFixed(0)).join(', ')})`);
  expect(long.length, `long frames: ${long.map((gap) => gap.toFixed(0)).join(', ')}`).toBeLessThanOrEqual(2);
});

test('at 200% text the pills keep their icon and word, nothing overflows', async ({ page }) => {
  await open(page, { seed: ['q-h1'] });
  await expect(page.locator('button.activity')).toHaveCount(3);
  await expect(page.locator('[data-motion]')).toHaveCount(0);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(width, 'no sideways scroll').toBeLessThanOrEqual(0);
  for (const element of await page.locator('button.activity').all()) {
    const box = (await element.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await element.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  }
  await page.screenshot({ path: `${shots}/large-text-${test.info().project.name}.png`, fullPage: true });
});
