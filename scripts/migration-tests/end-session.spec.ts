import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { onSite, type Fake } from './sharepoint.js';
import { advance, freezeClock, liveSite, looks, openVisitor, partsOf, quiet } from './polling-support.js';

// Phase 7, End session: an open participant page notices that the facilitator pressed End session (Sessions.Status becomes 'completed').
// It is read in the same one request the page already makes every ~20 seconds (a $batch of AppSettings, the session and the track):
// the session was added to that batch, and no request is added. A participant mid-activity finishes it first, and answers still save.
// The BUILT participant page, SharePoint mode, the mocked REST, Playwright's clock. Not the real tenant.

const results = fileURLToPath(new URL('../../test-results/budget/', import.meta.url));
const measured: Record<string, unknown> = {};
test.afterAll(async () => {
  await mkdir(results, { recursive: true });
  await writeFile(`${results}end-session.json`, `${JSON.stringify(measured, null, 2)}\n`);
});

const ENDED = 'This session has ended.';
const SAVED = 'Thank you. Your answers are saved.';

const endIt = (fake: Fake, sessionId: string) => onSite(fake, (ds) => ds.endSession(sessionId));
const reopenIt = (fake: Fake, sessionId: string) => onSite(fake, (ds) => ds.reopenSession(sessionId));
const statusOf = (fake: Fake, sessionId: string) => fake.item('sessions', sessionId)?.Status;
const ended = (page: Page) => page.getByRole('heading', { name: ENDED });
const trackId = (fake: Fake) => String(fake.lists.get('tracks')![0].AppId);

const toHub = async (page: Page) => {
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(page.locator('button.activity').first()).toBeVisible();
};

/** The visitor has already answered the first four of Kroger's History's five questions (graded, and right), so that the fifth is the last. */
const answerFirstFour = (fake: Fake, sessionId: string, track: string) => onSite(fake, (ds) => ds.saveParticipantResponses({
  trackId: track, sessionId, clientId: 'c-kroger',
  responses: ['q-trivia-1', 'q-trivia-2', 'q-trivia-3', 'q-trivia-4'].map((questionId) => {
    const right = samplePack().options.find((option) => option.questionId === questionId && option.correct)!.id;
    return { questionId, answer: right, firstAnswer: right, attempts: 1, correct: true, answeredAt: new Date().toISOString() };
  }),
}));

test('Welcome: the page says the session ended at its next look (within about 25 seconds), and Reopen brings Welcome back', async ({ page }) => {
  const { fake, session, codes } = await liveSite(1, { names: ['Avery Stone'] });
  await openVisitor(page, fake, codes[0]);
  await expect(page.getByRole('heading', { name: 'Hi Avery Stone!' })).toBeVisible();
  await freezeClock(page, fake);
  await advance(page, 5_000);
  await expect(ended(page)).toHaveCount(0);
  await endIt(fake, session.id);
  expect(statusOf(fake, session.id)).toBe('completed');
  await advance(page, 25_000);
  await expect(ended(page)).toBeVisible();
  await expect(page.getByText(SAVED)).toBeVisible();
  // Welcome's own screen is gone: no begin button, no greeting.
  await expect(page.getByRole('button', { name: /Click here to begin|Activities/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Hi Avery Stone!' })).toHaveCount(0);
  await page.screenshot({ path: `${fileURLToPath(new URL('../../test-results/flow/', import.meta.url))}session-ended-welcome.png` });

  // The facilitator reopens it. The page keeps looking (that is how it finds out), and Welcome is back with the same visit.
  await reopenIt(fake, session.id);
  await advance(page, 25_000);
  await expect(page.getByRole('heading', { name: 'Hi Avery Stone!' })).toBeVisible();
  await expect(ended(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
});

test('the hub: the notice replaces it at the next look, the answers are still saved, and Reopen restores the hub with its progress', async ({ page }) => {
  const { fake, session, codes } = await liveSite(1);
  await openVisitor(page, fake, codes[0]);
  const track = trackId(fake);
  // This visitor has already finished the first activity (its five answers are in the participant's own item).
  await onSite(fake, async (ds) => {
    const questions = ['q-trivia-1', 'q-trivia-2', 'q-trivia-3', 'q-trivia-4', 'q-trivia-5'];
    await ds.saveParticipantResponses({ trackId: track, sessionId: session.id, clientId: 'c-kroger', responses: questions.map((questionId) => ({ questionId, answer: 'o', firstAnswer: 'o', attempts: 1, correct: null, answeredAt: new Date().toISOString() })) });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Activities' }).click();
  await expect(page.locator('button.activity')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /Kroger's History/ })).toHaveAttribute('data-state', 'done');
  await freezeClock(page, fake);
  await endIt(fake, session.id);
  await advance(page, 25_000);
  await expect(ended(page)).toBeVisible();
  await expect(page.getByText(SAVED)).toBeVisible();
  await expect(page.locator('button.activity')).toHaveCount(0);
  const stored = JSON.parse(String(fake.item('responses', track)!.ResponsesJson));
  expect(stored.length, 'what the participant answered is still stored').toBe(5);
  await page.screenshot({ path: `${fileURLToPath(new URL('../../test-results/flow/', import.meta.url))}session-ended-hub.png` });

  await reopenIt(fake, session.id);
  await advance(page, 25_000);
  await expect(ended(page)).toHaveCount(0);
  await expect(page.locator('button.activity')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /Kroger's History/ }), 'the progress is what it was').toHaveAttribute('data-state', 'done');
});

test('mid-activity: the question stays, the answer still saves, and only on leaving the activity is the notice shown instead of the hub', async ({ page }) => {
  const { fake, session, codes } = await liveSite(1);
  await openVisitor(page, fake, codes[0]);
  const track = trackId(fake);
  await answerFirstFour(fake, session.id, track);
  await page.reload();
  await page.getByRole('button', { name: 'Activities' }).click();
  await page.getByRole('button', { name: /Kroger's History/ }).click();
  await expect(page.getByRole('progressbar', { name: 'Question 5 of 5' })).toBeVisible();
  await freezeClock(page, fake);
  await endIt(fake, session.id);
  // Two minutes with the question on screen: the slow look happens (it has seen the end) and nothing about the screen changes.
  await advance(page, 120_000);
  expect(looks(fake).length, 'the page did look, once or twice').toBeGreaterThanOrEqual(1);
  await expect(page.getByRole('progressbar', { name: 'Question 5 of 5' })).toBeVisible();
  await expect(ended(page)).toHaveCount(0);
  // The participant answers (the right one): it saves, although the session has ended.
  const right = samplePack().options.find((option) => option.questionId === 'q-trivia-5' && option.correct)!.label;
  const writes = () => fake.count((entry) => entry.list === 'responses' && entry.method !== 'GET');
  const before = writes();
  await page.getByRole('button', { name: right, exact: false }).first().click();
  await expect.poll(writes).toBeGreaterThan(before);
  expect(statusOf(fake, session.id)).toBe('completed');
  await expect(ended(page)).toHaveCount(0);
  // Finishing the activity: its completion screen is part of the activity, so it is shown, and the answer counts.
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
  await expect(ended(page)).toHaveCount(0);
  expect(JSON.parse(String(fake.item('responses', track)!.ResponsesJson)).length, 'all five are saved').toBe(5);
  // And only then, going back to the activities, is the notice shown where the hub would have been.
  await page.getByRole('button', { name: 'Back to activities' }).click();
  await advance(page, 6_000);
  await expect(ended(page)).toBeVisible();
  await expect(page.locator('button.activity')).toHaveCount(0);
  await expect(page.getByText(SAVED)).toBeVisible();
  expect(JSON.parse(String(fake.item('responses', track)!.ResponsesJson)).length, 'nothing was lost').toBe(5);
});

test('the finale is left as it is: someone who had finished everything still sees their thank-you after the session ends', async ({ page }) => {
  const { fake, session, codes } = await liveSite(1);
  await openVisitor(page, fake, codes[0]);
  const track = trackId(fake);
  await onSite(fake, async (ds) => {
    const every = (await ds.getClientActivities('c-kroger', await ds.getSession(session.id))).flatMap((activity: { questionIds?: string[] }) => activity.questionIds ?? []);
    await ds.saveParticipantResponses({ trackId: track, sessionId: session.id, clientId: 'c-kroger', responses: every.map((questionId: string) => ({ questionId, answer: 'o', firstAnswer: 'o', attempts: 1, correct: null, answeredAt: new Date().toISOString() })) });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Activities' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('heading', { name: /Thank you|Congratulations|You're done/i })).toBeVisible();
  await freezeClock(page, fake);
  await endIt(fake, session.id);
  await advance(page, 90_000);
  await expect(page.getByRole('heading', { name: /Thank you|Congratulations|You're done/i })).toBeVisible();
  await expect(ended(page)).toHaveCount(0);
});

test('a page reloaded after the end says so at once, and a Reopen brings it back by itself', async ({ page }) => {
  const { fake, session, codes } = await liveSite(1, { names: ['Avery Stone'] });
  await openVisitor(page, fake, codes[0]);
  await endIt(fake, session.id);
  await page.reload();
  await expect(ended(page)).toBeVisible();
  await expect(page.getByText(SAVED)).toBeVisible();
  await freezeClock(page, fake);
  await reopenIt(fake, session.id);
  await advance(page, 30_000);
  await expect(page.getByRole('heading', { name: 'Hi Avery Stone!' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Click here to begin|Activities/ })).toBeVisible();
});

test('it costs no request the page was not making: the same one look every ~20 seconds, before the end, while ended and after Reopen', async ({ page }) => {
  const { fake, session, codes } = await liveSite(1);
  await openVisitor(page, fake, codes[0]);
  await freezeClock(page, fake);
  const rate = async (minutesCount: number) => {
    fake.reset();
    await advance(page, minutesCount * 60_000);
    const sent = looks(fake);
    expect(sent.every((entry) => entry.path.endsWith('/$batch')), 'every look is one batch').toBe(true);
    expect(sent.every((entry) => partsOf(entry).sort().join() === ['appsettings', 'sessions', 'tracks'].sort().join()), 'of the same three reads').toBe(true);
    return sent.length / minutesCount;
  };
  const before = await rate(3);
  await endIt(fake, session.id);
  await advance(page, 25_000);
  await expect(ended(page)).toBeVisible();
  const during = await rate(3);
  await reopenIt(fake, session.id);
  await advance(page, 25_000);
  await expect(ended(page)).toHaveCount(0);
  const after = await rate(3);
  for (const perMinute of [before, during, after]) {
    expect(perMinute).toBeGreaterThanOrEqual(2.3);
    expect(perMinute).toBeLessThanOrEqual(4);
  }
  measured.cost = { perMinuteBeforeEnd: before, perMinuteWhileEnded: during, perMinuteAfterReopen: after, requestsPerLook: 1, partsPerLook: 3, extraRequestsForEndDetection: 0, extraReadsInTheBatch: 1 };
  await quiet(page);
});
