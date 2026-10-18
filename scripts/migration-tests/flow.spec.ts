import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sharePointFolderPath } from '../deployment-config.js';
import { addFlowContent, makeVisitor, mockApi, type Fixture } from './fixtures.js';

// The participant flow, run against the built release page (build-svelte/release) with a synthetic
// API. One question per screen, graded feedback and Retry, every answer saved as it is given into
// the participant's own item (Phase 4), resume after a reload or on another device, the sequential
// lock, completion and the finale, the facilitator preview, and pictures of every screen at phone,
// iPad and desktop sizes.

const appPath = (hash: string) => `${sharePointFolderPath}/index.html${hash}`;
const shots = fileURLToPath(new URL('../../test-results/flow/', import.meta.url));

/** A fixture with the flow content and a named visitor on track-a. */
async function flowFixture(page: Page, options: Parameters<typeof addFlowContent>[1] = {}) {
  const fixture = await mockApi(page);
  const content = addFlowContent(fixture, options);
  makeVisitor(fixture);
  return { fixture, ...content };
}

const choices = (page: Page) => page.locator('.pms-options button');
const choice = (page: Page, index: number) => choices(page).nth(index);
const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });
const submit = (page: Page) => page.getByRole('button', { name: 'Submit', exact: true });
const liveText = (page: Page) => page.locator('.pms-live');

/** Answers question `n` of the history activity correctly and moves on (Submit on the last). */
async function answerRight(page: Page, index: number, last = false) {
  await choice(page, index).click();
  await expect(choice(page, index)).toHaveAttribute('data-state', 'correct');
  await (last ? submit(page) : next(page)).click();
}

// `fixture.writes` counts writes of the participant's own item: its create and each overwrite.
// Every answer is written as it is given (a graded one at its first pick), so there is at most
// one write per pick, and fewer when a save was still out and the next answer rode along with it.
const savedIds = (fixture: Fixture) => fixture.saved().map((record) => record.questionId);
const record = (fixture: Fixture, questionId: string) => fixture.saved().find((entry) => entry.questionId === questionId);
/** Waits until nothing is waiting to be saved on the device (saved answers are not held in storage). */
const allSaved = (page: Page) => expect.poll(() => page.evaluate(() => sessionStorage.getItem('cec-answers:track-a'))).toBeNull();

// ---- Graded feedback ---------------------------------------------------------------------------

test('graded: a wrong pick turns red with a label and offers Retry; a second wrong pick reveals the answer and allows Next', async ({ page }) => {
  const { fixture } = await flowFixture(page);
  await page.goto(appPath('#/quiz/section-history?t=track-a'));
  await expect(page.getByRole('heading', { level: 1, name: "Alpha's History" })).toBeVisible();
  await expect(page.getByText('Celebrating 140+ years')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Question 1 of 3' })).toBeVisible();
  await expect(page.getByText('Question 1 of 3', { exact: true })).toBeVisible();
  await expect(next(page)).toBeDisabled();

  // First wrong try.
  await choice(page, 2).click();
  await expect(choice(page, 2)).toHaveAttribute('data-state', 'incorrect');
  await expect(choice(page, 2)).toContainText('Incorrect');
  await expect(liveText(page)).toContainText('Incorrect. Press Retry to try again.');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(next(page)).toHaveCount(0);
  await expect(choice(page, 1)).toHaveAttribute('data-state', 'default');
  // A stray tap on another answer does nothing until Retry (the options say so with aria-disabled).
  await expect(choice(page, 3)).toHaveAttribute('aria-disabled', 'true');
  await choice(page, 3).click({ force: true });
  await expect(choice(page, 3)).toHaveAttribute('data-state', 'default');

  // Retry clears the choice.
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  for (let index = 0; index < 4; index += 1) await expect(choice(page, index)).toHaveAttribute('data-state', 'default');
  await expect(next(page)).toBeDisabled();

  // Second wrong try: the right answer is revealed and Next is allowed.
  await choice(page, 3).click();
  await expect(choice(page, 3)).toHaveAttribute('data-state', 'incorrect');
  await expect(choice(page, 1)).toHaveAttribute('data-state', 'correct');
  await expect(choice(page, 1)).toContainText('Correct');
  await expect(liveText(page)).toContainText('The correct answer is Great Western Tea co.');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect(next(page)).toBeEnabled();
  await next(page).click();
  await expect(page.getByRole('progressbar', { name: 'Question 2 of 3' })).toBeVisible();
  // Both picks were saved as they were made: the first try is what is kept as the first answer.
  await allSaved(page);
  expect(fixture.writes).toBe(2);
  expect(fixture.saved()).toMatchObject([{ questionId: 'q-h1', answer: 'q-h1-d', firstAnswer: 'q-h1-c', attempts: 2, correct: false }]);
});

test('graded: a correct pick turns green with a label, is saved at once, and Next moves on without touching the network', async ({ page }) => {
  const { fixture } = await flowFixture(page);
  await page.goto(appPath('#/quiz/section-history?t=track-a'));
  await expect(page.getByRole('group', { name: /first store/ })).toBeVisible();
  await choice(page, 1).click();
  await expect(choice(page, 1)).toHaveAttribute('data-state', 'correct');
  await expect(choice(page, 1)).toContainText('Correct');
  await expect(liveText(page)).toContainText('Correct. Press Next to continue.');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await allSaved(page);
  expect(fixture.writes, 'the pick itself was saved, with one request').toBe(1);
  expect(fixture.saved()).toMatchObject([{ questionId: 'q-h1', answer: 'q-h1-b', firstAnswer: 'q-h1-b', attempts: 1, correct: true }]);

  const requests: string[] = [];
  page.on('request', (request) => { if (request.method() !== 'GET') requests.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  await next(page).click();
  await expect(page.getByRole('group', { name: /self-service/ })).toBeVisible();
  expect(requests, 'Next waits for nothing and sends nothing').toEqual([]);
  expect(fixture.writes).toBe(1);
});

test('Next is instant even while a save is still out, and the answers given meanwhile go in one later write', async ({ page }) => {
  const { fixture } = await flowFixture(page);
  await page.goto(appPath('#/quiz/section-history?t=track-a'));
  fixture.holdSaves = true; // the server takes its time over the first save
  await choice(page, 1).click();
  await expect(choice(page, 1)).toHaveAttribute('data-state', 'correct');
  await next(page).click();
  await expect(page.getByRole('progressbar', { name: 'Question 2 of 3' })).toBeVisible();
  await choice(page, 2).click();
  await next(page).click();
  await expect(page.getByRole('progressbar', { name: 'Question 3 of 3' })).toBeVisible();
  await choice(page, 0).click();
  await expect(choice(page, 0)).toHaveAttribute('data-state', 'correct');
  expect(fixture.writes, 'one request in flight; the rest wait their turn').toBe(1);
  expect(fixture.saved()).toEqual([]);
  // Completion is the one thing that waits for the saves.
  await submit(page).click();
  await expect(page.getByRole('button', { name: 'Saving...' })).toBeDisabled();
  await expect(page.getByRole('heading', { name: /Nice work/ })).toHaveCount(0);
  fixture.releaseSaves();
  await expect(page.getByRole('heading', { name: 'Nice work, Jordan Lee!' })).toBeVisible();
  expect(fixture.writes, 'the first answer, then one write carrying the other two').toBe(2);
  expect(savedIds(fixture)).toEqual(['q-h1', 'q-h2', 'q-h3']);
});

test('graded saves store the FIRST answer, so a Retry can never raise the result', async ({ page }) => {
  const { fixture, wrong, right } = await flowFixture(page);
  await page.goto(appPath('#/quiz/section-history?t=track-a'));
  // Q1: wrong first, then right on the retry. Q2: right first time. Q3: wrong twice (revealed).
  await choice(page, 2).click();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await choice(page, 1).click();
  await expect(choice(page, 1)).toHaveAttribute('data-state', 'correct');
  await next(page).click();
  await choice(page, 2).click();
  await next(page).click();
  await choice(page, 1).click();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await choice(page, 2).click();
  await expect(submit(page)).toBeEnabled();
  await submit(page).click();

  await expect(page.getByRole('heading', { name: 'Nice work, Jordan Lee!' })).toBeVisible();
  await expect(page.getByText('1 of 3 right on the first try')).toBeVisible();
  expect(fixture.writes, 'never more than one write per pick').toBeLessThanOrEqual(5);
  expect(fixture.saved()).toMatchObject([
    { questionId: 'q-h1', firstAnswer: 'q-h1-c', answer: right('q-h1'), attempts: 2, correct: false },
    { questionId: 'q-h2', firstAnswer: right('q-h2'), answer: right('q-h2'), attempts: 1, correct: true },
    { questionId: 'q-h3', firstAnswer: 'q-h3-b', answer: 'q-h3-c', attempts: 2, correct: false },
  ]);
  expect(record(fixture, 'q-h1')!.firstAnswer).not.toBe(right('q-h1'));
  expect(record(fixture, 'q-h3')!.firstAnswer).toBe(wrong('q-h3', 0));
  expect(Object.keys(fixture.saved()[0])).toEqual(['questionId', 'answer', 'firstAnswer', 'attempts', 'correct', 'answeredAt']);
  expect(fixture.items.get('track-a')).toMatchObject({ id: 'track-a', trackId: 'track-a', sessionId: 'session-a', clientId: 'client-a' });
});

test('one question per screen, with its number, a progress bar, and the heading focused on each step', async ({ page }) => {
  await flowFixture(page);
  await page.goto(appPath('#/quiz/section-history?t=track-a'));
  const heading = (name: RegExp) => page.getByRole('heading', { level: 2, name });
  await expect(heading(/first store/)).toBeVisible();
  await expect(heading(/first store/)).toBeFocused();
  await expect(page.locator('.pms-question')).toHaveCount(1);
  await expect(page.locator('.pms-options')).toHaveCount(1);
  await expect(page.getByText('1.', { exact: true })).toBeVisible();
  await expect(heading(/self-service/)).toHaveCount(0);

  await answerRight(page, 1);
  await expect(heading(/self-service/)).toBeVisible();
  await expect(heading(/self-service/)).toBeFocused();
  await expect(heading(/first store/)).toHaveCount(0);
  await expect(page.locator('.pms-question')).toHaveCount(1);
  await expect(page.getByRole('progressbar', { name: 'Question 2 of 3' })).toHaveAttribute('aria-valuenow', '2');
  await expect(page.getByText('2.', { exact: true })).toBeVisible();

  await answerRight(page, 2);
  await expect(page.getByRole('progressbar', { name: 'Question 3 of 3' })).toHaveAttribute('aria-valuenow', '3');
  await expect(submit(page)).toBeDisabled();
});

test('keyboard: arrows move between answers, Enter picks one, and focus follows the heading', async ({ page }) => {
  await flowFixture(page);
  await page.goto(appPath('#/quiz/section-history?t=track-a'));
  await expect(page.getByRole('heading', { level: 2 })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(choice(page, 0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(choice(page, 1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expect(choice(page, 1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(choice(page, 3)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(choice(page, 0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(choice(page, 1)).toHaveAttribute('data-state', 'correct');
  await expect(liveText(page)).toContainText('Correct');
  // Once a graded question is settled, focus moves to the action it offers.
  await expect(next(page)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { level: 2, name: /self-service/ })).toBeFocused();
});

test('reduced motion switches the step animation off', async ({ browser }) => {
  // (Phase 15: the step's motion is the motion plan's, lib/motion/: the next question comes in by Next with a shape of its own; until then it was a
  // keyframe on .pms-step. The question is read at once after Next, while it is still coming in. Each pass is a fresh visit in a browser of its own.)
  const nextStep = async (reducedMotion: 'reduce' | 'no-preference') => {
    const context = await browser.newContext({ reducedMotion });
    const page = await context.newPage();
    await flowFixture(page);
    await page.goto(appPath('#/quiz/section-history?t=track-a'));
    await choice(page, 1).click();
    await next(page).click();
    await expect(page.locator('.pms-question')).not.toContainText('1.');
    const name = await page.locator('.pms-question').evaluate((element) => getComputedStyle(element).animationName);
    const shapes = await page.locator('[data-motion]').count();
    await context.close();
    return { name, shapes };
  };
  expect((await nextStep('no-preference')).name, 'it does animate when motion is welcome (so the check can fail)').toMatch(/^motion-/);
  expect(await nextStep('reduce')).toEqual({ name: 'none', shapes: 0 });
});

// ---- Saving and resume -------------------------------------------------------------------------

test('a reload mid-activity resumes at the first unanswered question from what was saved, with one read', async ({ page }) => {
  const { fixture } = await flowFixture(page);
  await page.goto(appPath('#/quiz/section-history?t=track-a'));
  await answerRight(page, 1);
  await answerRight(page, 2);
  await expect(page.getByRole('progressbar', { name: 'Question 3 of 3' })).toBeVisible();
  await allSaved(page);
  expect(fixture.writes).toBe(2);
  expect(savedIds(fixture)).toEqual(['q-h1', 'q-h2']);
  expect(fixture.responseReads, 'the page read its answers once, as it loaded').toBe(1);

  await page.reload();
  await expect(page.getByRole('progressbar', { name: 'Question 3 of 3' })).toBeVisible();
  await expect(page.getByRole('group', { name: /original lease/ })).toBeVisible();
  expect(fixture.responseReads, 'and once more for the reload: no screen reads them again').toBe(2);
  expect(fixture.writes, 'a reload writes nothing').toBe(2);

  await answerRight(page, 0, true);
  await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
  expect(fixture.writes).toBe(3);
  expect(savedIds(fixture)).toEqual(['q-h1', 'q-h2', 'q-h3']);
  expect(await page.evaluate(() => sessionStorage.getItem('cec-answers:track-a')), 'saved answers are no longer held locally').toBeNull();
});

test('answers the device could not save yet are held on it, survive a reload, and are saved when the server is back', async ({ page }) => {
  const { fixture } = await flowFixture(page);
  await page.goto(appPath('#/quiz/section-history?t=track-a'));
  fixture.failSaves = 99; // the server is unreachable for now
  await answerRight(page, 1);
  await answerRight(page, 2);
  await expect(page.getByRole('progressbar', { name: 'Question 3 of 3' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('cec-answers:track-a') ?? 'null')?.sections?.['section-history']?.length)).toBe(2);
  expect(fixture.saved()).toEqual([]);

  await page.reload();
  await expect(page.getByRole('progressbar', { name: 'Question 3 of 3' }), 'the held answers still count').toBeVisible();
  fixture.failSaves = 0;
  await answerRight(page, 0, true);
  await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible({ timeout: 15_000 });
  expect(savedIds(fixture)).toEqual(['q-h1', 'q-h2', 'q-h3']);
  await allSaved(page);
});

test('a first wrong pick survives a reload: the question comes back waiting for its Retry, and the first answer stays wrong', async ({ page }) => {
  const { fixture, right } = await flowFixture(page);
  await page.goto(appPath('#/quiz/section-history?t=track-a'));
  await choice(page, 2).click();
  await expect(choice(page, 2)).toHaveAttribute('data-state', 'incorrect');
  await allSaved(page);
  expect(fixture.saved(), 'the first pick is on the server before anything else happens').toMatchObject([
    { questionId: 'q-h1', answer: 'q-h1-c', firstAnswer: 'q-h1-c', attempts: 1, correct: false },
  ]);

  await page.reload();
  // Not a fresh question: the wrong pick is still there, still wrong, with Retry and no Next.
  await expect(page.getByRole('progressbar', { name: 'Question 1 of 3' })).toBeVisible();
  await expect(choice(page, 2)).toHaveAttribute('data-state', 'incorrect');
  await expect(choice(page, 2)).toContainText('Incorrect');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(next(page)).toHaveCount(0);
  await expect(choice(page, 1)).toHaveAttribute('aria-disabled', 'true');

  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await choice(page, 1).click();
  await expect(choice(page, 1)).toHaveAttribute('data-state', 'correct');
  await next(page).click();
  await answerRight(page, 2);
  await answerRight(page, 0, true);
  await expect(page.getByText('2 of 3 right on the first try'), 'the reload did not buy a second first try').toBeVisible();
  expect(record(fixture, 'q-h1')).toMatchObject({ answer: right('q-h1'), firstAnswer: 'q-h1-c', attempts: 2, correct: false });
});

test('a visit continues on another device: nothing is held there, and one read brings the answers back', async ({ page }) => {
  const { fixture, right } = await flowFixture(page);
  // Saved from the first device: question 1 right, question 2 left on a wrong first pick.
  fixture.give([{ questionId: 'q-h1', answer: right('q-h1') }, { questionId: 'q-h2', answer: 'q-h2-a' }]);
  await page.goto(appPath('#/quiz/section-history?t=track-a'));
  await expect(page.getByRole('progressbar', { name: 'Question 2 of 3' })).toBeVisible();
  await expect(choice(page, 0)).toHaveAttribute('data-state', 'incorrect');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  expect(fixture.responseReads).toBe(1);
  expect(fixture.writes).toBe(0);
});

test('resume counts answers the server already has as well as pending ones', async ({ page }) => {
  const { fixture, right } = await flowFixture(page);
  fixture.give([{ questionId: 'q-h1', answer: right('q-h1') }]);
  await page.goto(appPath('#/quiz/section-history?t=track-a'));
  await expect(page.getByRole('progressbar', { name: 'Question 2 of 3' })).toBeVisible();
  await answerRight(page, 2);
  await page.reload();
  await expect(page.getByRole('progressbar', { name: 'Question 3 of 3' })).toBeVisible();
});

test('a facilitator restart wipes answers held on this device so they cannot come back', async ({ page }) => {
  const { fixture } = await flowFixture(page);
  await page.goto(appPath('#/quiz/section-history?t=track-a'));
  await answerRight(page, 1);
  await expect(page.getByRole('progressbar', { name: 'Question 2 of 3' })).toBeVisible();
  fixture.restartedAt = '2026-10-11T12:00:00Z';
  fixture.restartSectionId = 'section-history';
  await page.evaluate(() => { window.dispatchEvent(new Event('online')); });
  await expect(page.getByRole('progressbar', { name: 'Question 1 of 3' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('progressbar', { name: 'Question 1 of 3' })).toBeVisible();
});

/**
 * The page stops looking at the server, as a tab that is not showing does. Since Phase 9a a look that reaches the server sends
 * unsaved answers again by itself, so a test that wants to read what a failed save LEFT has to hold the page still first.
 */
const stopLooking = (page: Page) => page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
});

test('a failed save shows "Couldn\'t save, Retry", keeps every answer, and retrying saves them', async ({ page }) => {
  const { fixture } = await flowFixture(page);
  await page.goto(appPath('#/quiz/section-history?t=track-a'));
  await answerRight(page, 1);
  await answerRight(page, 2);
  await stopLooking(page);
  fixture.failSaves = 3;
  await choice(page, 0).click();
  await submit(page).click();
  await expect(page.getByRole('button', { name: 'Saving...' })).toBeDisabled();
  const retry = page.getByRole('button', { name: "Couldn't save, Retry" });
  await expect(retry).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('alert')).toContainText('kept on this device');
  expect(fixture.writes, 'two answers saved, then three tries, with backoff, for the third').toBe(2 + 3);
  await expect(choice(page, 0)).toHaveAttribute('data-state', 'correct');
  const held = await page.evaluate(() => JSON.parse(sessionStorage.getItem('cec-answers:track-a') ?? 'null'));
  expect(held.sections['section-history'].map((entry: { questionId: string }) => entry.questionId), 'only the unsaved answer is held').toEqual(['q-h3']);
  expect(savedIds(fixture)).toEqual(['q-h1', 'q-h2']);

  await retry.click();
  await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
  expect(fixture.writes).toBe(2 + 3 + 1);
  expect(savedIds(fixture)).toEqual(['q-h1', 'q-h2', 'q-h3']);
});

test('answers a failed Submit left on the device are saved when the server next answers, with nobody touching the page (Phase 9a)', async ({ page }) => {
  // Before the fix nothing sent them again until someone tapped Retry: a participant who had walked away was left out of the results.
  const { fixture } = await flowFixture(page);
  await page.goto(appPath('#/quiz/section-history?t=track-a'));
  await answerRight(page, 1);
  await answerRight(page, 2);
  fixture.failSaves = 3;
  await choice(page, 0).click();
  await submit(page).click();
  const retry = page.getByRole('button', { name: "Couldn't save, Retry" });
  await expect(retry).toBeVisible({ timeout: 10_000 });
  // The server answers again (the three failures are used up). The page's next look reaches it, and that sends what is waiting.
  await expect.poll(() => savedIds(fixture), { timeout: 15_000 }).toEqual(['q-h1', 'q-h2', 'q-h3']);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('cec-answers:track-a'))).toBeNull();
  // Whoever is still there presses Retry and is through at once, with nothing sent twice.
  const writes = fixture.writes;
  await retry.click();
  await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
  expect(fixture.writes).toBe(writes);
});

test('after a failed save a reload finds the answers and saves them again by itself', async ({ page }) => {
  const { fixture } = await flowFixture(page);
  await page.goto(appPath('#/quiz/section-history?t=track-a'));
  await answerRight(page, 1);
  await answerRight(page, 2);
  fixture.failSaves = 3;
  await choice(page, 0).click();
  await submit(page).click();
  await expect(page.getByRole('button', { name: "Couldn't save, Retry" })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Nice work, Jordan Lee!' })).toBeVisible();
  expect(fixture.writes).toBe(2 + 3 + 1);
  expect(savedIds(fixture)).toEqual(['q-h1', 'q-h2', 'q-h3']);
});

// ---- Activities hub ----------------------------------------------------------------------------

test('hub: one pill per activity in order, the next locked until the one before is finished, then a green dot', async ({ page }) => {
  const { fixture, right } = await flowFixture(page);
  await page.goto(appPath('#/agenda?t=track-a'));
  await expect(page.getByRole('heading', { level: 1, name: 'Synthetic Alpha' })).toBeVisible();
  await expect(page.getByText('Choose an activity to get started.')).toBeVisible();
  const history = page.getByRole('button', { name: "Alpha's History" });
  const brand = page.getByRole('button', { name: /Guess the Brand/ });
  const pulse = page.getByRole('button', { name: /Quick pulse/ });
  await expect(page.locator('button.activity')).toHaveCount(3);
  await expect(history).toHaveAttribute('data-state', 'default');
  await expect(brand).toHaveAttribute('data-state', 'locked');
  await expect(brand).toHaveAttribute('aria-disabled', 'true');
  await expect(brand).toContainText('Finish the previous activity');
  await expect(pulse).toHaveAttribute('data-state', 'locked');

  // A locked pill does nothing.
  await brand.click({ force: true });
  await expect(page).toHaveURL(/#\/agenda\?t=track-a$/);

  // With the first activity finished (here: on another device, so the page is opened again) the
  // second is unlocked and the first has its dot.
  fixture.give(['q-h1', 'q-h2', 'q-h3'].map((id) => ({ questionId: id, answer: right(id) })));
  await page.reload();
  await expect(page.getByRole('button', { name: "Alpha's History Completed" })).toHaveAttribute('data-state', 'done', { timeout: 10_000 });
  await expect(brand).toHaveAttribute('data-state', 'default');
  await expect(pulse).toHaveAttribute('data-state', 'locked');
  await brand.click();
  await expect(page).toHaveURL(/#\/quiz\/section-brand\?t=track-a$/);
});

test('hub: session.activityFlow "open" locks nothing', async ({ page }) => {
  await flowFixture(page, { flow: 'open' });
  await page.goto(appPath('#/agenda?t=track-a'));
  await expect(page.locator('button.activity')).toHaveCount(3);
  await expect(page.locator('button.activity[data-state="locked"]')).toHaveCount(0);
  await page.getByRole('button', { name: /Quick pulse/ }).click();
  await expect(page.getByRole('group', { name: /Which topic/ })).toBeVisible();
});

test("hub: the client's event copy (its theme's eventTitle, eventSubtitle) is used when present, the client name when not", async ({ page }) => {
  await flowFixture(page, { eventCopy: true });
  await page.goto(appPath('#/agenda?t=track-a'));
  await expect(page.getByRole('heading', { level: 1, name: 'Alpha Trivia Night' })).toBeVisible();
  await expect(page.getByText("Celebrating 140+ years of Alpha's history and the people who built them.")).toBeVisible();
  await expect(page.getByText('Choose an activity to get started.')).toHaveCount(0);
  // The title is set uppercase by style, not by changing the text.
  expect(await page.getByRole('heading', { level: 1 }).evaluate((element) => getComputedStyle(element).textTransform)).toBe('uppercase');
});

test('header: wordmark left; on inner screens "Hi {name}!" and a compact sound switch right; no client strip', async ({ page }) => {
  await flowFixture(page);
  await page.goto(appPath('#/welcome?t=track-a'));
  const header = page.locator('header');
  await expect(page.getByRole('heading', { name: 'Hi Jordan Lee!' })).toBeVisible();
  await expect(header.getByText('Hi Jordan Lee!')).toHaveCount(0);
  await expect(header.locator('#sound-toggle')).toBeVisible();
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Synthetic Alpha' })).toBeVisible();
  await expect(header.getByText('Hi Jordan Lee!')).toBeVisible();
  await expect(header.getByRole('img', { name: 'Deloitte' })).toBeVisible();
  await expect(header.getByRole('switch', { name: 'Sound' })).toHaveAttribute('aria-checked', 'false');
  await header.getByRole('switch', { name: 'Sound' }).click();
  await expect(header.getByRole('switch', { name: 'Sound' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.client-strip, .client-name')).toHaveCount(0);
  const box = await header.getByText('Hi Jordan Lee!').boundingBox();
  const wordmark = await header.getByRole('img', { name: 'Deloitte' }).boundingBox();
  expect(wordmark!.x).toBeLessThan(box!.x);
});

// ---- Welcome ---------------------------------------------------------------------------------

test('welcome: client logo on a white round plate, greeting, client line, and "Click here to begin" on a first visit', async ({ page }) => {
  await flowFixture(page);
  await page.goto(appPath('#/welcome?t=track-a'));
  await expect(page.getByRole('heading', { name: 'Hi Jordan Lee!' })).toBeVisible();
  await expect(page.getByText('Welcome to the Synthetic Alpha experience.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  const plate = page.locator('.pms-hero');
  await expect(plate).toBeVisible();
  const style = await plate.evaluate((element) => ({ radius: getComputedStyle(element).borderRadius, background: getComputedStyle(element).backgroundColor, box: element.getBoundingClientRect().toJSON() }));
  expect(style.radius).toBe('50%');
  expect(style.background).toBe('rgb(255, 255, 255)');
  expect(Math.abs(style.box.width - style.box.height)).toBeLessThan(1);
  await expect(plate.locator('img')).toHaveAttribute('src', /^data:image\/svg\+xml/);
});

test('welcome: once any answer exists the button reads "Activities"', async ({ page }) => {
  const { fixture, right } = await flowFixture(page);
  fixture.give([{ questionId: 'q-h1', answer: right('q-h1') }]);
  await page.goto(appPath('#/welcome?t=track-a'));
  await expect(page.getByRole('button', { name: 'Activities', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Activities', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Synthetic Alpha' })).toBeVisible();
});

test('welcome: answers still held on this device (not saved yet) also turn the button into "Activities"', async ({ page }) => {
  const { fixture } = await flowFixture(page);
  fixture.failSaves = 99;
  await page.goto(appPath('#/quiz/section-history?t=track-a'));
  await answerRight(page, 1);
  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page.getByRole('button', { name: 'Activities', exact: true })).toBeVisible();
});

test('welcome: a visit with no name says "Hi there!"', async ({ page }) => {
  const fixture = await mockApi(page);
  addFlowContent(fixture);
  await page.goto(appPath(''));
  await expect(page.getByRole('heading', { name: 'Hi there!' })).toBeVisible();
});

// ---- Logo tiles --------------------------------------------------------------------------------

test('image-grid questions show a 2x2 grid of logo tiles with graded feedback on the tiles', async ({ page }) => {
  await flowFixture(page);
  await page.goto(appPath('#/quiz/section-brand?t=track-a'));
  await expect(page.getByRole('heading', { level: 1, name: 'Guess the Brand' })).toBeVisible();
  await expect(page.locator('.pms-grid')).toBeVisible();
  await expect(page.locator('.pms-grid button.tile')).toHaveCount(4);
  await expect(page.locator('.pms-grid button.pill')).toHaveCount(0);
  const boxes = await page.locator('.pms-grid button.tile').evaluateAll((tiles) => tiles.map((tile) => tile.getBoundingClientRect().toJSON()));
  expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(1);
  expect(Math.abs(boxes[2].y - boxes[3].y)).toBeLessThan(1);
  expect(Math.abs(boxes[0].x - boxes[2].x)).toBeLessThan(1);
  expect(boxes[1].x).toBeGreaterThan(boxes[0].x + boxes[0].width - 1);
  expect(boxes[2].y).toBeGreaterThan(boxes[0].y + boxes[0].height - 1);
  await expect(page.locator('.pms-grid button.tile img')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Harvest' })).toBeVisible();

  await page.getByRole('button', { name: 'Bloom' }).click();
  await expect(page.getByRole('button', { name: /Bloom/ })).toHaveAttribute('data-state', 'incorrect');
  await expect(page.getByRole('button', { name: /Bloom/ })).toContainText('Incorrect');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('button', { name: 'Harvest' }).click();
  await expect(page.getByRole('button', { name: /Harvest/ })).toHaveAttribute('data-state', 'correct');
  await expect(page.getByRole('button', { name: /Harvest/ })).toContainText('Correct');
  await next(page).click();
  await expect(page.getByRole('progressbar', { name: 'Question 2 of 2' })).toBeVisible();
});

test('a tile question without images shows its answers as text on the tiles', async ({ page }) => {
  const { fixture } = await flowFixture(page);
  for (const option of fixture.records.options.filter((entry) => entry.questionId === 'q-b1')) delete (option as { imageUrl?: string }).imageUrl;
  await page.goto(appPath('#/quiz/section-brand?t=track-a'));
  await expect(page.locator('.pms-grid button.tile')).toHaveCount(4);
  await expect(page.locator('.pms-grid button.tile img')).toHaveCount(0);
  await expect(page.locator('.pms-grid button.tile').nth(1)).toHaveText('Harvest');
});

test('a tile whose picture cannot be loaded shows its answer in words, and can still be chosen (Phase 9a)', async ({ page }) => {
  const { fixture } = await flowFixture(page);
  const options = fixture.records.options.filter((entry) => entry.questionId === 'q-b1');
  (options[1] as { imageUrl?: string }).imageUrl = 'https://pictures.invalid/removed-file.png';
  await page.route('https://pictures.invalid/**', (route) => route.abort());
  await page.goto(appPath('#/quiz/section-brand?t=track-a'));
  const tile = page.locator('.pms-grid button.tile').nth(1);
  // Before the fix this tile was empty: a broken picture with no words.
  await expect(tile.locator('.text')).toBeVisible();
  await expect(tile.locator('.text')).toHaveText('Harvest');
  await expect(tile.locator('img')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Harvest' })).toBeVisible();
  // A tile whose picture did load keeps it, and its words stay out of sight.
  await expect(page.locator('.pms-grid button.tile').nth(0).locator('.text')).toBeHidden();
  await tile.click();
  await expect(tile).toHaveAttribute('data-state', 'correct');
});

// ---- Ungraded ----------------------------------------------------------------------------------

test('an ungraded question uses the same pager with a neutral selected state and no red or green', async ({ page }) => {
  const { fixture } = await flowFixture(page);
  await page.goto(appPath('#/quiz/section-pulse?t=track-a'));
  await expect(page.getByRole('progressbar', { name: 'Question 1 of 1' })).toBeVisible();
  await expect(submit(page)).toBeDisabled();
  await choice(page, 1).click();
  await expect(choice(page, 1)).toHaveAttribute('data-state', 'selected');
  await expect(choice(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-state="correct"], [data-state="incorrect"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  // The pick can be changed freely before moving on.
  await choice(page, 2).click();
  await expect(choice(page, 2)).toHaveAttribute('data-state', 'selected');
  await expect(choice(page, 1)).toHaveAttribute('data-state', 'default');
  await expect(submit(page)).toBeEnabled();
  await submit(page).click();
  await expect(page.getByRole('heading', { name: 'Nice work, Jordan Lee!' })).toBeVisible();
  await expect(page.getByText('Thanks for sharing')).toBeVisible();
  expect(fixture.saved()).toMatchObject([{ questionId: 'q-p1', answer: 'q-p1-c', firstAnswer: 'q-p1-c', attempts: 1, correct: null }]);
  expect(fixture.writes, 'changing the pick wrote nothing: an ungraded answer is saved when it is final').toBe(1);
});

// ---- Completion and finale ---------------------------------------------------------------------

test('completion shows the first-try score, then the finale once everything is done, with no way to start over', async ({ page }) => {
  const { fixture } = await flowFixture(page, { flow: 'open' });
  await page.goto(appPath('#/agenda?t=track-a'));

  await page.getByRole('button', { name: "Alpha's History" }).click();
  await answerRight(page, 1);
  await answerRight(page, 2);
  await answerRight(page, 0, true);
  await expect(page.getByRole('heading', { name: 'Nice work, Jordan Lee!' })).toBeVisible();
  await expect(page.getByText('3 of 3 right on the first try')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finish', exact: true }), 'two activities are still open').toHaveCount(0);
  await page.getByRole('button', { name: 'Back to activities' }).click();
  await expect(page.getByRole('button', { name: "Alpha's History Completed" })).toHaveAttribute('data-state', 'done');

  await page.getByRole('button', { name: /Guess the Brand/ }).click();
  await choice(page, 1).click();
  await next(page).click();
  await choice(page, 0).click(); // wrong: the badge question's answer is Orbit
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await choice(page, 3).click();
  await submit(page).click();
  await expect(page.getByText('1 of 2 right on the first try')).toBeVisible();
  await page.getByRole('button', { name: 'Back to activities' }).click();

  await page.getByRole('button', { name: /Quick pulse/ }).click();
  await choice(page, 0).click();
  await submit(page).click();
  await expect(page.getByText('Thanks for sharing')).toBeVisible();
  // The last activity offers the finish line.
  await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to activities' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();

  await expect(page).toHaveURL(/#\/thank-you\?t=track-a$/);
  await expect(page.getByRole('heading', { name: 'Thank you, Jordan Lee!' })).toBeVisible();
  await expect(page.getByText('Your responses have been recorded.')).toBeVisible();
  await expect(page.getByText('3 activities completed')).toBeVisible();
  await expect(page.getByText('4 of 5 right on the first try')).toBeVisible();
  expect(fixture.writes, 'seven picks in all, so seven writes at most').toBeLessThanOrEqual(7);
  expect(savedIds(fixture)).toEqual(['q-h1', 'q-h2', 'q-h3', 'q-b1', 'q-b2', 'q-p1']);
  expect(fixture.items.size, 'one item for the participant, not one per activity').toBe(1);

  // A participant's record is theirs for the day: the finale offers Home and nothing that could replace it.
  await expect(page.getByRole('button', { name: 'Start over' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Home' })).toBeVisible();
});

test('testers can start over with ?debug=1, and doing so leaves the saved record exactly as it was', async ({ page }) => {
  const { fixture, right } = await flowFixture(page, { flow: 'open' });
  fixture.give(['q-h1', 'q-h2', 'q-h3', 'q-b1', 'q-b2'].map((id) => ({ questionId: id, answer: right(id) })));
  fixture.give([{ questionId: 'q-p1', answer: 'q-p1-a' }]);
  const before = JSON.stringify(fixture.saved());
  await page.goto(`${sharePointFolderPath}/index.html?debug=1#/thank-you?t=track-a`);
  await expect(page.getByRole('heading', { name: 'Thank you, Jordan Lee!' })).toBeVisible();
  await expect(page.getByText('5 of 5 right on the first try'), 'the score comes from the saved answers, with nothing read again').toBeVisible();
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByRole('heading', { name: 'Hi there!' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('cec-answers:track-a'))).toBeNull();
  expect(JSON.stringify(fixture.saved()), 'the record is untouched').toBe(before);
  expect(fixture.writes).toBe(0);
  // Beginning again is a new visit with a record of its own.
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(page.locator('button.activity')).toHaveCount(3);
  expect(fixture.trackCreates).toBe(1);
  expect(JSON.stringify(fixture.saved())).toBe(before);
});

test('the finale cannot be reached early', async ({ page }) => {
  await flowFixture(page);
  await page.goto(appPath('#/thank-you?t=track-a'));
  await expect(page.getByRole('heading', { level: 1, name: 'Synthetic Alpha' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Thank you/ })).toHaveCount(0);
});

test('an activity that is already finished opens on its completion screen, not on its questions', async ({ page }) => {
  const { fixture, right } = await flowFixture(page);
  // Question 2 was missed twice, so it is settled (revealed) and wrong.
  fixture.give(['q-h1', 'q-h2', 'q-h3'].map((id) => (id === 'q-h2' ? { questionId: id, answer: 'q-h2-b', firstAnswer: 'q-h2-a', attempts: 2 } : { questionId: id, answer: right(id) })));
  await page.goto(appPath('#/quiz/section-history?t=track-a'));
  await expect(page.getByRole('heading', { name: 'Nice work, Jordan Lee!' })).toBeVisible();
  await expect(page.getByText('2 of 3 right on the first try')).toBeVisible();
  await expect(page.locator('.pms-question')).toHaveCount(0);
});

// ---- Facilitator preview -----------------------------------------------------------------------

test('admin preview steps through the questions, shows the right answers, and never writes', async ({ page }) => {
  const { fixture } = await flowFixture(page);
  const writes: string[] = [];
  page.on('request', (request) => { if (request.method() !== 'GET') writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  await page.goto(`${sharePointFolderPath}/admin.html`);
  await page.getByRole('textbox', { name: 'PIN' }).fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  // Content opens on the live client, whose activities these are.
  await page.getByRole('tab', { name: 'Content' }).click();
  await page.locator('.row').filter({ hasText: "Alpha's History" }).getByRole('button', { name: 'Preview' }).click();

  const dialog = page.locator('dialog');
  await expect(dialog.getByRole('heading', { level: 1, name: "Alpha's History" })).toBeVisible();
  await expect(dialog.getByText('Question 1 of 3', { exact: true })).toBeVisible();
  await expect(dialog.locator('button.pill[data-state="correct"]')).toHaveCount(1);
  await expect(dialog.locator('button.pill[data-state="correct"]')).toContainText('Great Western Tea co.');

  // Tapping an answer does nothing in a preview.
  await dialog.locator('.pms-options button').nth(2).click({ force: true });
  await expect(dialog.locator('button.pill[data-state="incorrect"]')).toHaveCount(0);
  await expect(dialog.locator('button.pill[data-state="selected"]')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.getByText('Question 2 of 3', { exact: true })).toBeVisible();
  await expect(dialog.locator('button.pill[data-state="correct"]')).toContainText('1916');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.getByText('Question 3 of 3', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(dialog.getByText('Question 2 of 3', { exact: true })).toBeVisible();
  // There is no Home button and no Submit in a preview.
  await expect(dialog.getByRole('button', { name: 'Home' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Submit', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('cec-answers:')))).toEqual([]);

  // Logo tiles preview with the right tile marked.
  await page.keyboard.press('Escape');
  await page.locator('.row').filter({ hasText: 'Guess the Brand' }).getByRole('button', { name: 'Preview' }).click();
  await expect(dialog.locator('button.tile[data-state="correct"]')).toHaveCount(1);
  await expect(dialog.locator('button.tile')).toHaveCount(4);
  await page.keyboard.press('Escape');

  expect(fixture.writes).toBe(0);
  expect(writes, 'no write of any kind').toEqual([]);
});

// ---- Layout and pictures -----------------------------------------------------------------------

const viewports = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
];

async function expectFits(page: Page, label: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label}: no horizontal scroll`).toBe(true);
  const small = await page.evaluate(() => [...document.querySelectorAll('button, [role="switch"], a[href], textarea')]
    .map((element) => ({ name: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30), box: element.getBoundingClientRect() }))
    .filter(({ box }) => box.width > 0 && (box.width < 43.5 || box.height < 43.5))
    .map(({ name, box }) => `${name}: ${Math.round(box.width)}x${Math.round(box.height)}`));
  expect(small, `${label}: tap targets under 44px`).toEqual([]);
  const tiny = await page.evaluate(() => [...document.querySelectorAll('main p, main h2, main button, main li')]
    .filter((element) => element.children.length === 0 || element.matches('p, h2, button'))
    .map((element) => ({ text: (element.textContent ?? '').trim().slice(0, 24), size: parseFloat(getComputedStyle(element).fontSize) }))
    .filter(({ text, size }) => text && size < 15.99)
    .map(({ text, size }) => `${text}: ${size}px`));
  expect(tiny, `${label}: body text under 16px`).toEqual([]);
}

for (const viewport of viewports) {
  test(`pictures and fit at ${viewport.width}x${viewport.height}: Welcome, hub, question states, logo tiles, completion, finale`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' }); // still pictures: no entrance animation mid-capture
    const { fixture, right } = await flowFixture(page, { flow: 'open', eventCopy: true });
    const size = `${viewport.width}x${viewport.height}`;
    await mkdir(shots, { recursive: true });
    const shoot = async (name: string, label = name) => {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${shots}${name}-${size}.png`, fullPage: true });
      await expectFits(page, `${label} at ${size}`);
    };

    await page.goto(appPath('#/welcome?t=track-a'));
    await expect(page.getByRole('heading', { name: 'Hi Jordan Lee!' })).toBeVisible();
    await shoot('welcome');

    await page.getByRole('button', { name: 'Click here to begin' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Alpha Trivia Night' })).toBeVisible();
    await expect(page.locator('button.activity')).toHaveCount(3);
    await shoot('hub');

    // A question: default, then correct, then incorrect (after a Retry, on the next question).
    await page.getByRole('button', { name: "Alpha's History" }).click();
    await expect(page.getByRole('group', { name: /first store/ })).toBeVisible();
    await shoot('question-default');
    await choice(page, 1).click();
    await expect(choice(page, 1)).toHaveAttribute('data-state', 'correct');
    await shoot('question-correct');
    await next(page).click();
    await choice(page, 0).click();
    await expect(choice(page, 0)).toHaveAttribute('data-state', 'incorrect');
    await shoot('question-incorrect');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await choice(page, 3).click();
    await expect(choice(page, 2)).toHaveAttribute('data-state', 'correct');
    await shoot('question-revealed');
    await next(page).click();
    await choice(page, 0).click();

    await submit(page).click();
    await expect(page.getByRole('heading', { name: 'Nice work, Jordan Lee!' })).toBeVisible();
    await shoot('complete');

    // Logo tiles.
    await page.getByRole('button', { name: 'Back to activities' }).click();
    await page.getByRole('button', { name: /Guess the Brand/ }).click();
    await expect(page.locator('.pms-grid button.tile')).toHaveCount(4);
    await shoot('tiles-default');
    await page.getByRole('button', { name: 'Bloom' }).click();
    await expect(page.getByRole('button', { name: /Bloom/ })).toHaveAttribute('data-state', 'incorrect');
    await shoot('tiles-incorrect');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('button', { name: 'Harvest' }).click();
    await expect(page.getByRole('button', { name: /Harvest/ })).toHaveAttribute('data-state', 'correct');
    await shoot('tiles-correct');

    // An ungraded question and the finale: everything answered through the data, then the hub's Finish.
    fixture.give(['q-b1', 'q-b2', 'q-p1'].map((id) => ({ questionId: id, answer: id === 'q-p1' ? 'q-p1-a' : right(id) })));
    await page.goto(appPath('#/quiz/section-pulse?t=track-a'));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Nice work, Jordan Lee!' })).toBeVisible();
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Thank you, Jordan Lee!' })).toBeVisible();
    await shoot('finale');
  });
}
