import { test, expect } from '@playwright/test';
import { choices, nextButton, submitButton, themedSite, THEMES } from './a11y-support.js';
import { pageUrl, serveSharePoint } from './sharepoint.js';

// Phase 8, part E: the participant page on a slow SharePoint. Every REST request is answered 800 ms late, and the first write of an answer is
// answered 429 with Retry-After: 2. What must still be true, on the BUILT page against the mocked site (Chromium: Playwright's route is
// what holds the answers back):
//   - Next advances at once: the answer is saved in the background, so a tap is never held up by an 800 ms save;
//   - the first answer is saved exactly once: one Responses item for the participant, one record for the question, whatever the 429 and the
//     retry did, and the retry waits at least as long as Retry-After asked;
//   - saves that were still out when the last answer was given are all done before the completion screen appears (Completion waits);
//   - nothing creates a second Responses item (the one write that created it was refused once and then went through once).
// It is the mocked SharePoint: the real site's own latency and throttling are not known (QA-TESTING.md section 9, items 6 and 39).

test('with every request 800 ms late and one 429, Next is at once, the answer is saved exactly once, Completion waits for the saves, and there is one Responses item', async ({ page }) => {
  test.setTimeout(180_000);
  const { fake, pack } = await themedSite({ theme: 'kroger', flow: 'open' });
  await serveSharePoint(page, fake, { latencyMs: 800 });
  await page.goto(pageUrl('index.html'));
  const section = pack.sections.filter((entry) => entry.clientId === THEMES.kroger.clientId).sort((a, b) => a.order - b.order)[0];
  const questions = pack.questions.filter((question) => question.sectionId === section.id).sort((a, b) => a.order - b.order);
  const right = (id: string) => pack.options.filter((option) => option.questionId === id).findIndex((option) => option.correct === true);

  // Opening the page and joining are not what is under test; they are slow because everything is.
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await page.getByRole('button', { name: new RegExp(`^${section.title}`) }).first().click({ timeout: 30_000 });
  await expect(page.getByRole('progressbar', { name: `Question 1 of ${questions.length}` })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_000); // let the page's own visit-log writes finish, so that only answers are counted from here
  fake.reset();
  fake.failNext({ status: 429, retryAfter: 2, times: 1, when: (entry: { list: string | null; method: string }) => entry.list === 'responses' && entry.method !== 'GET' });

  // Each answer, then Next: how long a tap takes to show the next question (it must be far under the 800 ms of a request).
  const nextTimes: number[] = [];
  for (const [index, question] of questions.entries()) {
    await expect(page.getByRole('progressbar', { name: `Question ${index + 1} of ${questions.length}` })).toBeVisible({ timeout: 5_000 });
    await choices(page).nth(right(question.id)).click();
    await expect(choices(page).nth(right(question.id))).toHaveAttribute('data-state', 'correct');
    if (index === questions.length - 1) break;
    const started = Date.now();
    await nextButton(page).click();
    await expect(page.getByRole('progressbar', { name: `Question ${index + 2} of ${questions.length}` })).toBeVisible({ timeout: 700 });
    nextTimes.push(Date.now() - started);
  }
  expect(Math.max(...nextTimes), `Next took ${nextTimes.join(', ')} ms against 800 ms requests`).toBeLessThan(600);

  // The last answer: Submit has to wait for the saves that are still out, and says so.
  const writesBefore = fake.count((entry: { list: string | null; method: string }) => entry.list === 'responses' && entry.method !== 'GET');
  await submitButton(page).click();
  await expect(page.getByRole('button', { name: /Saving/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: /Nice work/ })).toBeVisible({ timeout: 60_000 });

  // At the moment the completion screen was there, every answer was already on the site.
  const items = fake.lists.get('responses') as { AppId: string; TrackId: string; ResponsesJson: string }[];
  expect(items, 'one Responses item for the one participant').toHaveLength(1);
  const stored = JSON.parse(items[0].ResponsesJson) as { questionId: string; firstAnswer: string; attempts: number }[];
  expect(stored.map((answer) => answer.questionId).sort(), 'every question, once each').toEqual(questions.map((question) => question.id).sort());
  expect(stored.find((answer) => answer.questionId === questions[0].id)).toMatchObject({ attempts: 1, firstAnswer: pack.options.filter((option) => option.questionId === questions[0].id)[right(questions[0].id)].id });
  expect(items[0].AppId).toBe(items[0].TrackId);

  // What went over the wire: the item was created once (the first try was refused with 429 and retried), then overwritten.
  type Entry = { method: string; list: string | null; at: number; faulted?: number };
  const writes = fake.select((entry: Entry) => entry.list === 'responses' && entry.method !== 'GET') as Entry[];
  const creates = writes.filter((entry) => entry.method === 'POST');
  const refused = writes.filter((entry) => entry.faulted === 429);
  expect(refused, 'the one 429 was met').toHaveLength(1);
  expect(creates.filter((entry) => entry.faulted === undefined), 'the item was created by exactly one write that went through').toHaveLength(1);
  expect(creates.length, 'and by no more than the refused try and its retry').toBeLessThanOrEqual(2);
  const retried = creates.find((entry) => entry.faulted === undefined)!;
  expect(retried.at - refused[0].at, 'the retry waited at least as long as Retry-After asked (2 s)').toBeGreaterThanOrEqual(1_950);
  // Answers given while a save was out rode along on the next one: fewer writes than answers' worth of saves, and at least a create and an update.
  expect(writes.length - refused.length, 'the writes that went through').toBeGreaterThanOrEqual(2);
  expect(writes.length - refused.length, 'are fewer than a write for each answer and the retry').toBeLessThanOrEqual(questions.length + 1);
  expect(writes.length, 'the page waited for its saves at Submit').toBeGreaterThan(writesBefore - 1);

  // And reloading after all this finds the answers: nothing is left unsaved on the device.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_000);
  expect(fake.lists.get('responses'), 'still one Responses item after the reload, and nothing written again by it').toHaveLength(1);
  const after = JSON.parse((fake.lists.get('responses') as { ResponsesJson: string }[])[0].ResponsesJson) as { questionId: string }[];
  expect(after.map((answer) => answer.questionId).sort()).toEqual(questions.map((question) => question.id).sort());
});
