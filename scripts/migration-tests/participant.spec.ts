import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { sharePointFolderPath } from '../deployment-config.js';
import { makeImage } from './brand-images.js';
import { addFeedbackFixture, addQuestionTypeFixture, mockApi } from './fixtures.js';

const appPath = (page: string) => `${sharePointFolderPath}${page}`;

test('finishing an activity keeps earlier completion on the first hub paint, with one write and one read of its own item', async ({ page }) => {
  const fixture = await mockApi(page);
  await page.goto(appPath('/index.html#/quiz/section-b?t=track-a'));
  await expect(page.getByRole('group', { name: 'Question B' })).toBeVisible();
  await page.getByRole('button', { name: /Choice B 1/ }).click();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
  await page.getByRole('button', { name: 'Back to activities' }).click();
  await expect(page.getByRole('button', { name: 'Module A, done' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Module B, done' })).toBeVisible();
  expect(fixture.writes, 'one answer, one write: an overwrite of the item the page had read').toBe(1);
  expect(fixture.responseReads, 'the page read its own answers once, as it loaded; no screen read them again').toBe(1);
  expect(fixture.saved().map((record) => record.questionId)).toEqual(['question-a', 'question-b']);
});

test('staff Welcome uses the admin-selected session, hides client selection, and logs one tab entry', async ({ page }) => {
  const fixture = await mockApi(page);
  await page.goto(appPath('/index.html'));
  await expect(page.getByRole('heading', { name: 'Hi there!' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Select Client' })).toHaveCount(0);
  await expect(page.getByText('Welcome to the Synthetic Alpha experience.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Click here to begin', exact: true })).toBeVisible();
  // The entry is logged once the screen is up, not before it.
  await expect.poll(() => fixture.visitLogs.length).toBe(1);
  expect(fixture.visitLogs[0]).toMatchObject({ sessionId: 'session-a', clientId: 'client-a', entryMode: 'staff', page: 'participant' });
  await page.getByRole('button', { name: 'Click here to begin', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic Alpha' })).toBeVisible();
  expect(fixture.visitWrites).toBe(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Synthetic Alpha' })).toBeVisible();
  // The visit now has a track, so it is logged once more under the same id, which adds no row.
  await expect.poll(() => fixture.visitWrites).toBe(2);
  expect(fixture.visitLogs).toHaveLength(1);
  // A further reload of the same visit says nothing new and spends no request on it.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Synthetic Alpha' })).toBeVisible();
  await page.waitForTimeout(400);
  expect(fixture.visitWrites).toBe(2);
});

test('client-visit QR welcomes its roster name, records the check-in, and hides client selection', async ({ page }) => {
  const fixture = await mockApi(page);
  fixture.records.sessions[0].participationMode = 'client-visit';
  fixture.records.visitors.push({ id: 'visitor-jordan', sessionId: 'session-a', displayName: 'Jordan Lee', enabled: true });
  fixture.records.tokens.push({ id: 'visitor-code', clientId: 'client-a', sessionId: 'session-a', visitorId: 'visitor-jordan', used: false, createdAt: '2026-10-09T12:00:00Z', usedAt: null, clientTrackId: null });
  await page.goto(appPath('/index.html?qr=visitor-code'));
  await expect(page.getByRole('heading', { name: 'Hi Jordan Lee!' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Select Client' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  expect(fixture.records.tracks.at(-1)).toMatchObject({ visitorId: 'visitor-jordan', participantName: 'Jordan Lee' });
  await expect.poll(() => fixture.visitLogs.length).toBe(1);
  expect(fixture.visitLogs[0]).toMatchObject({ entryMode: 'client-visit', visitorId: 'visitor-jordan', visitorName: 'Jordan Lee' });
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic Alpha' })).toBeVisible();
  await expect(page.locator('header').getByText('Hi Jordan Lee!')).toBeVisible();
});

test('visit-log permission failure is visible but does not block a valid staff visit', async ({ page }) => {
  const fixture = await mockApi(page);
  fixture.failVisitLog = true;
  await page.goto(appPath('/index.html'));
  await expect(page.getByRole('heading', { name: 'Hi there!' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('This visit could not be recorded');
  await page.getByRole('button', { name: 'Click here to begin', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic Alpha' })).toBeVisible();
  expect(fixture.trackCreates).toBe(1);
});

test('Thank You shows a retryable error and recovers without another response save', async ({ page }) => {
  const fixture = await mockApi(page);
  fixture.give([{ questionId: 'question-b', answer: 'option-b-1' }]);
  await page.goto(appPath('/index.html#/agenda?t=track-a'));
  await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeVisible();
  fixture.failNextSectionsRead = true;
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your saved answers are safe');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
  expect(fixture.writes).toBe(0);
});

test('activity changes and same-route restart reload what was saved', async ({ page }) => {
  const fixture = await mockApi(page);
  await page.goto(appPath('/index.html#/quiz/section-a?t=track-a'));
  // Module A is already answered and saved, so it opens as a finished activity.
  await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
  await page.evaluate(() => { location.hash = '#/quiz/section-b?t=track-a'; });
  await expect(page.getByRole('group', { name: 'Question B' })).toBeVisible();
  await page.evaluate(() => { location.hash = '#/quiz/section-a?t=track-a'; });
  await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
  // The facilitator restarts Module A: its answer is removed from the participant's item, then the track is stamped.
  fixture.clearAnswers();
  fixture.restartedAt = '2026-10-09T12:00:00Z';
  fixture.restartSectionId = 'section-a';
  await page.evaluate(() => { window.dispatchEvent(new Event('online')); });
  await expect(page.getByRole('group', { name: 'Question A' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Nice work/ })).toHaveCount(0);
  expect(fixture.saved().some((record) => record.questionId === 'question-a'), 'and the device does not write the old answer back').toBe(false);
});

test('an admin active-session switch redirects connected participants and logs the new session entry', async ({ page }) => {
  const fixture = await mockApi(page);
  await page.goto(appPath('/index.html#/agenda?t=track-a'));
  await expect(page.getByRole('heading', { name: 'Synthetic Alpha' })).toBeVisible();
  Object.assign(fixture.records.appsettings[0], { activeSessionId: 'session-b', activeClientId: 'client-b' });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('heading', { name: 'Hi there!' })).toBeVisible();
  await expect(page.getByText('Welcome to the Synthetic Beta experience.', { exact: true })).toBeVisible();
  await expect(page.getByText(/changed the active session/i)).toBeVisible();
  await expect.poll(() => fixture.visitLogs.length).toBe(2);
  expect(fixture.visitLogs.map((visit) => visit.sessionId)).toEqual(['session-a', 'session-b']);
});

test('QR deep link claims exactly once and a repeat scan explains that it was used', async ({ page }) => {
  const fixture = await mockApi(page);
  fixture.records.tokens.push({ id: 'scan-once', clientId: 'client-a', sessionId: 'session-a', used: false, createdAt: '2026-10-09T12:00:00Z', usedAt: null, clientTrackId: null });
  await page.goto(appPath('/index.html?qr=scan-once'));
  await expect(page.getByRole('heading', { name: 'Hi there!' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  await expect(page).toHaveURL(/#\/welcome\?t=claimed-track-1$/);
  expect(new URL(page.url()).searchParams.has('qr')).toBe(false);
  expect(fixture.records.tokens[0].used).toBe(true);
  expect(fixture.records.tokens[0].clientTrackId).toBe('claimed-track-1');
  expect(fixture.trackCreates).toBe(1);
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic Alpha' })).toBeVisible();
  await page.goto(appPath('/index.html?qr=scan-once'));
  await expect(page.getByRole('heading', { name: 'Hi there!' })).toBeVisible();
  await expect(page.getByText(/already been used/i)).toBeVisible();
  expect(fixture.trackCreates).toBe(1);
});

test('one failed save is retried by itself and the participant never sees it', async ({ page }) => {
  const fixture = await mockApi(page);
  await page.goto(appPath('/index.html#/quiz/section-b?t=track-a'));
  await expect(page.getByRole('group', { name: 'Question B' })).toBeVisible();
  fixture.failNextSave = true;
  await page.getByRole('button', { name: /Choice B 1/ }).click();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
  await expect(page.getByRole('button', { name: "Couldn't save, Retry" })).toHaveCount(0);
  expect(fixture.writes, 'the failed try, then the one that worked').toBe(2);
  expect(fixture.saved().map((record) => record.questionId)).toEqual(['question-a', 'question-b']);
});

test('all choice question types validate and save their expected answer shapes, one question per screen', async ({ page }) => {
  const fixture = await mockApi(page);
  addQuestionTypeFixture(fixture);
  await page.goto(appPath('/index.html#/quiz/section-types?t=track-a'));
  const next = page.getByRole('button', { name: 'Next', exact: true });

  // Multi-select needs at least one box ticked.
  await expect(page.getByRole('group', { name: 'Choose any' })).toBeVisible();
  await expect(next).toBeDisabled();
  await page.getByRole('button', { name: /Multi A/ }).click();
  await page.getByRole('button', { name: /Multi B/ }).click();
  await expect(next).toBeEnabled();
  await next.click();

  await expect(page.getByRole('group', { name: 'Binary choice' })).toBeVisible();
  await expect(next).toBeDisabled();
  await page.getByRole('button', { name: 'True', exact: true }).click();
  await next.click();

  await expect(page.getByRole('group', { name: 'Confidence level' })).toBeVisible();
  await page.getByRole('button', { name: 'Very confident' }).click();
  await next.click();

  // Ranking needs every option ranked once; tapping a ranked option takes it out again.
  await expect(page.getByRole('group', { name: 'Rank candidates' })).toBeVisible();
  await page.getByRole('button', { name: 'Candidate A, not ranked' }).click();
  await page.getByRole('button', { name: 'Candidate B, not ranked' }).click();
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Candidate C, not ranked' }).click();
  await expect(page.getByRole('button', { name: 'Candidate C, rank 3' })).toBeVisible();
  await page.getByRole('button', { name: 'Candidate A, rank 1' }).click();
  await expect(page.getByRole('button', { name: 'Candidate B, rank 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Clear ranking' }).click();
  for (const label of ['A', 'B', 'C']) await page.getByRole('button', { name: `Candidate ${label}, not ranked` }).click();
  await expect.poll(() => fixture.writes, 'each answer was saved as it was settled, with Next; the ranking is not final yet').toBe(3);
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
  await expect(page.getByText('Thanks for sharing')).toBeVisible();
  expect(fixture.writes, 'four answers, four writes').toBe(4);
  const saved = (questionId: string) => fixture.saved().find((record) => record.questionId === questionId);
  expect(saved('question-multi')?.answer).toEqual(['multi-one', 'multi-two']);
  expect(saved('question-binary')?.answer).toBe('binary-true');
  expect(saved('question-confidence')?.answer).toBe('confidence-three');
  expect(saved('question-ranked')?.answer).toEqual(['rank-one', 'rank-two', 'rank-three']);
  expect(fixture.saved().filter((record) => record.questionId !== 'question-a').every((record) => record.correct === null && record.attempts === 1), 'none of these is graded').toBe(true);
});

test('an old Feedback link lands on its activity, where typed feedback is trimmed, kept through a failed save, and saved', async ({ page }) => {
  const fixture = await mockApi(page);
  addFeedbackFixture(fixture);
  fixture.items.get('track-a')!.responses = fixture.saved().filter((record) => record.questionId !== 'question-feedback');
  await page.goto(appPath('/index.html#/feedback/section-feedback?t=track-a'));
  await expect(page).toHaveURL(/#\/quiz\/section-feedback\?t=track-a$/);
  const input = page.getByRole('textbox', { name: 'What would improve this?' });
  const submit = page.getByRole('button', { name: 'Submit', exact: true });
  await expect(submit).toBeDisabled();
  await input.fill('   ');
  await expect(submit).toBeDisabled();
  await input.fill(' Updated feedback ');
  // (Held still, as a tab that is not showing is: since Phase 9a a look that reaches the server sends unsaved answers again by
  // itself, and this test counts the tries a failed Submit made before anything else happens.)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  fixture.failSaves = 3;
  await submit.click();
  const retry = page.getByRole('button', { name: "Couldn't save, Retry" });
  await expect(retry).toBeVisible({ timeout: 10_000 });
  await expect(input).toHaveValue(' Updated feedback ');
  expect(fixture.writes).toBe(3);
  await retry.click();
  await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
  expect(fixture.writes).toBe(4);
  expect(fixture.saved().at(-1)).toMatchObject({ questionId: 'question-feedback', answer: 'Updated feedback', firstAnswer: 'Updated feedback', correct: null });
});

test('a written answer is limited to 1000 characters, with a count that says so', async ({ page }) => {
  const fixture = await mockApi(page);
  addFeedbackFixture(fixture);
  fixture.items.get('track-a')!.responses = fixture.saved().filter((record) => record.questionId !== 'question-feedback');
  await page.goto(appPath('/index.html#/quiz/section-feedback?t=track-a'));
  const input = page.getByRole('textbox', { name: 'What would improve this?' });
  await expect(input).toHaveAttribute('maxlength', '1000');
  await expect(page.getByText('0 of 1000 characters')).toBeVisible();
  await input.fill('Short and sweet');
  await expect(page.getByText('15 of 1000 characters')).toBeVisible();
  await expect(input).toHaveAccessibleDescription('15 of 1000 characters');
  // The field itself stops at the limit, whatever is pasted into it.
  await input.fill('x'.repeat(1400));
  await expect(input).toHaveValue('x'.repeat(1000));
  await expect(page.getByText('1000 of 1000 characters. That is the most an answer can hold.')).toBeVisible();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
  expect((fixture.saved().at(-1)!.answer as string).length).toBe(1000);
});

test('participant controls fit desktop and mobile viewports', async ({ page }, testInfo) => {
  await mockApi(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(appPath('/index.html#/quiz/section-b?t=track-a'));
  await expect(page.getByRole('group', { name: 'Question B' })).toBeVisible();
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.locator('.pms-pager').evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(Math.min(600, viewport.width - 100));
    await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`quiz-${viewport.width}.png`), fullPage: true });
  }
});

/** The facilitator's live results display (it was the participant page's Master screen until Phase 7): in the admin page, after the PIN. */
async function openLiveDisplay(page: import('@playwright/test').Page, sessionId: string) {
  await page.goto('about:blank'); // a fresh admin page each time: only a change of the hash would not reload one that is open
  await page.goto(appPath(`/admin.html#live-display/${sessionId}`));
  await page.getByRole('textbox', { name: 'PIN' }).fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
}

test('PPT exports use each selected session client branding', async ({ page }) => {
  await mockApi(page);
  for (const [sessionId, name, color] of [['session-a', 'Synthetic Alpha', '0060A9'], ['session-b', 'Synthetic Beta', '008044']]) {
    await openLiveDisplay(page, sessionId);
    const exportButton = page.getByRole('button', { name: 'Export PPT', exact: true });
    await expect(exportButton).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;
    const archive = await JSZip.loadAsync(await readFile((await download.path())!));
    const slide = await archive.file('ppt/slides/slide1.xml')!.async('string');
    expect(slide).toContain(name);
    expect(slide).toContain(color);
    expect(await archive.file('docProps/app.xml')!.async('string')).toContain('<Company>Pursuit Managed Services</Company>');
  }
});

test('PDF exports record the product name as the creator', async ({ page }) => {
  await mockApi(page);
  await openLiveDisplay(page, 'session-a');
  const exportButton = page.getByRole('button', { name: 'Export PDF', exact: true });
  await expect(exportButton).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await exportButton.click();
  const download = await downloadPromise;
  expect((await readFile((await download.path())!)).toString('latin1')).toContain('/Creator (Pursuit Managed Services)');
});

test('Content Preview is read-only, preserves the title, and closes cleanly', async ({ page }) => {
  const fixture = await mockApi(page);
  await page.goto(appPath('/admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('tab', { name: 'Content' }).click();
  await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible();
  const title = await page.title();
  await page.locator('.row').filter({ hasText: 'Module A' }).getByRole('button', { name: 'Preview' }).click();
  await expect(page.locator('dialog button.pill[data-state="correct"]')).toHaveCount(1);
  expect(await page.title()).toBe(title);
  expect(fixture.writes).toBe(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
});

test('missing results sessions render an actionable error', async ({ page }) => {
  await mockApi(page);
  await openLiveDisplay(page, 'missing');
  await expect(page.getByRole('alert')).toContainText('That session no longer exists');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('Admin session end/reopen failures stay retryable and stale polls cannot undo an action', async ({ page }) => {
  const fixture = await mockApi(page);
  await page.clock.install();
  await page.goto(appPath('/admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  // End and Reopen are controls on Today, which is the first screen.
  const end = page.getByRole('button', { name: 'End session' });
  await expect(end).toBeVisible();
  fixture.failNextSessionUpdate = true;
  page.once('dialog', (dialog) => dialog.accept());
  await end.click();
  await expect(page.locator('.toast')).toContainText('Synthetic session update failure');
  await expect(end).toBeEnabled();
  fixture.holdNextSessionRead = true;
  await page.clock.runFor(10_000);
  await expect.poll(() => fixture.releaseSessionRead !== null).toBe(true);
  page.once('dialog', (dialog) => dialog.accept());
  await end.click();
  const reopen = page.getByRole('button', { name: 'Reopen session' });
  await expect(reopen).toBeVisible();
  // The poll that began before the click answers now, with the session as it was before: it must not put it back.
  const stale = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/sessions' && response.url().includes('id=session-a') && response.request().method() === 'GET');
  fixture.releaseSessionRead!();
  await stale;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(reopen).toBeVisible();
  await expect(page.getByText('NOT LIVE', { exact: true })).toBeVisible();
  fixture.failNextSessionUpdate = true;
  await reopen.click();
  await expect(page.locator('.toast')).toContainText('Synthetic session update failure');
  await expect(reopen).toBeEnabled();
  await reopen.click();
  await expect(end).toBeVisible();
  expect(fixture.sessionUpdates).toBe(4);
});

test('Admin Content rolls back failed live changes and Preview supports Escape/tab teardown', async ({ page }) => {
  const fixture = await mockApi(page);
  await page.goto(appPath('/admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('tab', { name: 'Content' }).click();
  const live = page.getByRole('checkbox', { name: 'Set Module A live' });
  const liveSwitch = page.locator('label.switch').filter({ has: live });
  await expect(live).toBeChecked();
  fixture.failNextSectionUpdate = true;
  await liveSwitch.click();
  await expect(page.locator('.toast')).toContainText('Synthetic activity update failure');
  await expect(live).toBeChecked();
  await expect(live).toBeEnabled();
  await liveSwitch.click();
  await expect(page.locator('.toast')).toContainText('Module A is off');
  await expect(live).not.toBeChecked();
  const preview = page.locator('.row').filter({ hasText: 'Module A' }).getByRole('button', { name: 'Preview' });
  await preview.click();
  await expect(page.locator('dialog button.pill[data-state="correct"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog')).toHaveCount(0);
  await preview.click();
  await expect(page.locator('dialog button.pill[data-state="correct"]')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Clients' }).dispatchEvent('click');
  await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
  await expect(page.locator('dialog')).toHaveCount(0);
  expect(fixture.writes).toBe(0);
});

test('Admin Content rolls back a partial create and preserves the editable draft', async ({ page }) => {
  const fixture = await mockApi(page);
  await page.goto(appPath('/admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('tab', { name: 'Content' }).click();
  await page.getByRole('button', { name: 'Add question', exact: true }).click();
  await page.getByLabel('Question', { exact: true }).fill('Synthetic new draft');
  await page.getByLabel('Option 1 text').fill('First');
  await page.getByLabel('Option 2 text').fill('Second');
  fixture.failOptionCreateAt = 2;
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic option create failure');
  await expect(page.getByLabel('Question', { exact: true })).toHaveValue('Synthetic new draft');
  await expect(page.getByLabel('Option 1 text')).toHaveValue('First');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  expect(fixture.deleted).toEqual(['created-options-1', 'created-questions-1']);
});

test('Admin Content converts question types, updates records, and unlinks deleted options', async ({ page }) => {
  const fixture = await mockApi(page);
  await page.goto(appPath('/admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('tab', { name: 'Content' }).click();
  await page.locator('[data-activity="section-b"] .activity__select').click();
  const row = page.locator('.row').filter({ hasText: 'Question B' });
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Question', { exact: true }).fill('Converted multi question');
  await page.getByLabel('Type').selectOption('multi-select');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Converted multi question')).toBeVisible();
  expect(fixture.records.questions.find((question) => question.id === 'question-b')).toMatchObject({ prompt: 'Converted multi question', type: 'multi-select' });
  expect(fixture.records.options.filter((option) => option.questionId === 'question-b').every((option) => option.correct == null)).toBe(true);
  const convertedRow = page.locator('.row').filter({ hasText: 'Converted multi question' });
  let confirmation = '';
  page.once('dialog', (dialog) => { confirmation = dialog.message(); void dialog.accept(); });
  await convertedRow.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('This activity has no questions yet.')).toBeVisible();
  expect(confirmation).toContain('Delete "Converted multi question"');
  expect(fixture.records.sections.find((section) => section.id === 'section-b')?.questionIds).toEqual([]);
  expect(fixture.records.questions.some((question) => question.id === 'question-b')).toBe(false);
  expect(fixture.records.options.some((option) => option.questionId === 'question-b')).toBe(false);
});

test('Admin Today ignores action completions after switching tabs', async ({ page }) => {
  const fixture = await mockApi(page);
  await page.goto(appPath('/admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  fixture.holdNextSessionUpdate = true;
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'End session' }).click();
  await expect.poll(() => fixture.releaseSessionUpdate !== null).toBe(true);
  await page.getByRole('tab', { name: 'Content' }).click();
  const completed = page.waitForResponse((response) => response.url().endsWith('/api/sessions/session-a') && response.request().method() === 'PATCH');
  fixture.releaseSessionUpdate!();
  await completed;
  await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible();
  await expect(page.locator('.toast')).toHaveCount(0);
});

test('Admin Clients blocks deleting a referenced client, and Brand Studio surfaces logo upload errors', async ({ page }) => {
  const fixture = await mockApi(page);
  await page.goto(appPath('/admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('tab', { name: 'Clients' }).click();
  const client = page.locator('.row').filter({ hasText: 'Synthetic Alpha' });
  let confirmationOpened = false;
  page.on('dialog', (dialog) => { confirmationOpened = true; void dialog.dismiss(); });
  await client.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.toast')).toContainText("Can't delete Synthetic Alpha");
  expect(fixture.clientDeletes).toEqual([]);
  expect(confirmationOpened).toBe(false);
  // The logo is Brand Studio's now (it was the Clients form's): a file over the limit is refused before any upload, and a denied upload says so.
  await client.getByRole('button', { name: 'Brand: Synthetic Alpha' }).click();
  const fileInput = page.locator('input[type="file"][data-slot="logo"]');
  await fileInput.setInputFiles({ name: 'oversized.png', mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(page.locator('section.asset[data-slot="logo"]').getByRole('alert')).toContainText('over the 10 MB limit');
  expect(fixture.logoUploadRequests).toBe(0);
  fixture.failLogoUpload = true;
  const logo = await makeImage(page, { width: 900, height: 450, type: 'image/png', paint: 'logo' });
  await fileInput.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: logo });
  await page.getByRole('dialog', { name: /Crop and fit/ }).getByRole('button', { name: 'Use this picture' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.brand__actions').getByRole('alert')).toContainText('Synthetic logo upload denied');
  expect(fixture.logoUploadRequests).toBe(1);
});

test('Admin Results restarts only the selected track answers from the chosen activity', async ({ page }) => {
  const fixture = await mockApi(page);
  await page.goto(appPath('/admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('tab', { name: 'Results' }).click();
  const card = page.locator('article[data-session="session-a"]');
  // (Phase 7c: a visit with no name anywhere is "Unnamed participant N", as the leader report says, not the client's name.)
  const trackRow = card.locator('li.row').filter({ hasText: 'Unnamed participant 1' });
  await trackRow.getByRole('button', { name: 'Restart...' }).click();
  await page.getByRole('radio', { name: /Module A/ }).locator('..').click();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  // track-a's answer to Module A is in its own item.
  await expect(page.locator('.toast')).toContainText('restarted · 1 answers removed');
  expect(fixture.saved('track-a'), "the answer is gone from the participant's own item").toEqual([]);
  expect(fixture.records.tracks[0].restartSectionId).toBe('section-a');
  expect(fixture.trackPatches).toBe(1);
});

test('Admin Clients generates a QR code, rotates it, and can show the prior unused token', async ({ page }) => {
  const fixture = await mockApi(page);
  await page.goto(appPath('/admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('tab', { name: 'Clients' }).click();
  const client = page.locator('.row').filter({ hasText: 'Synthetic Alpha' });
  await client.getByRole('button', { name: 'Generate QR' }).click();
  await expect(page.getByRole('img', { name: 'QR code that checks an iPad in' })).toBeVisible();
  const link = page.getByRole('textbox', { name: 'Check-in link' });
  await expect(link).toHaveValue(/\?qr=synthetic-token-1$/);
  await page.getByRole('button', { name: 'New code' }).click();
  await expect(link).toHaveValue(/\?qr=synthetic-token-2$/);
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(link).toHaveValue(/\?qr=synthetic-token-1$/);
  expect(fixture.tokenCreates).toBe(2);
});

test('Admin Clients creates and edits a client record', async ({ page }) => {
  const fixture = await mockApi(page);
  await page.goto(appPath('/admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('tab', { name: 'Clients' }).click();
  await page.getByRole('button', { name: 'Add client' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Synthetic New Client');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const client = page.locator('.row').filter({ hasText: 'Synthetic New Client' });
  await expect(client).toBeVisible();
  await client.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Synthetic Edited Client');
  await expect(page.getByLabel('Primary color'), 'colours are not on the Clients form any more').toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.row').filter({ hasText: 'Synthetic Edited Client' })).toBeVisible();
  // A new client's older colour fields come from the default palette, and the name edit left them alone.
  expect(fixture.records.clients.find((entry) => entry.id === 'client-created')).toMatchObject({ name: 'Synthetic Edited Client', primaryColor: '#045BCC', secondaryColor: '#296CD4' });
  // The colours are Brand Studio's: saving there writes the older fields from the theme.
  await page.locator('.row').filter({ hasText: 'Synthetic Edited Client' }).getByRole('button', { name: /^Brand/ }).click();
  await page.getByLabel('Primary', { exact: true }).fill('#123456');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('brand-status')).toHaveText('All changes saved');
  expect(fixture.records.clients.find((entry) => entry.id === 'client-created')).toMatchObject({ name: 'Synthetic Edited Client', primaryColor: '#123456', themeVersion: 3 });
});

test('Admin Today and Guests and QR: live session, visit mode, roster, QR codes, disabling a visitor, recent entries, and making another session live', async ({ page }) => {
  const fixture = await mockApi(page);
  fixture.visitLogs.push({ id: 'visit-casey', sessionId: 'session-a', entryMode: 'staff', displayName: 'Casey Example', visitedAt: '2026-10-09T13:00:00Z' });
  await page.goto(appPath('/admin.html'));
  await page.getByRole('textbox', { name: 'PIN' }).fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  // The session that is live, and the identification switch, are on Today.
  await expect(page.getByTestId('participants')).toHaveText('1');
  await expect(page.getByText('session-a', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: /Guests scan a personal QR/ }).check();
  await expect(page.locator('.toast')).toContainText('Guests now scan a personal QR');
  expect(fixture.records.sessions[0].participationMode).toBe('client-visit');
  expect(fixture.records.appsettings[0].activeSessionId).toBe('session-a');
  await page.getByRole('tab', { name: 'Guests and QR' }).click();
  await expect(page.getByRole('heading', { name: 'Guests and QR', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Visitor name' }).fill('Jordan Lee');
  await page.getByRole('button', { name: 'Add visitor' }).click();
  const visitorRow = page.getByRole('listitem').filter({ hasText: 'Jordan Lee' });
  await expect(visitorRow).toBeVisible();
  await visitorRow.getByRole('button', { name: 'Generate QR' }).click();
  await expect(page.getByRole('img', { name: /Single-use check-in QR code for Jordan Lee/ })).toBeVisible();
  expect(fixture.records.tokens[0]).toMatchObject({ visitorId: 'visitor-1', sessionId: 'session-a' });
  await visitorRow.getByRole('button', { name: 'Replace code' }).click();
  await expect.poll(() => fixture.tokenCreates).toBe(2);
  expect(fixture.records.tokens[0].used).toBe(true);
  expect(fixture.records.tokens[0].expiredAt).toBeTruthy();
  expect(fixture.records.tokens).toHaveLength(2);
  await visitorRow.getByRole('button', { name: 'Disable' }).click();
  await expect(visitorRow).toContainText('Disabled');
  expect(fixture.records.visitors[0].enabled).toBe(false);
  expect(fixture.records.tokens[1].used).toBe(true);
  expect(fixture.records.tokens[1].expiredAt).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Recent app entries' })).toBeVisible();
  await expect(page.getByText('Casey Example')).toBeVisible();

  // Another existing session can be made live from Today; with a participant in this one, it asks first.
  await page.getByRole('tab', { name: 'Today' }).click();
  await page.getByText(/^All sessions/).click();
  await page.locator('.row').filter({ hasText: 'session-b' }).getByRole('button', { name: 'Make live' }).click();
  await expect(page.getByRole('heading', { name: 'Switch from Synthetic Alpha to Synthetic Beta?' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to Synthetic Beta' }).click();
  await expect(page.getByText('Verified: participants now see Synthetic Beta')).toBeVisible();
  expect(fixture.records.appsettings[0]).toMatchObject({ activeSessionId: 'session-b', activeClientId: 'client-b' });
});
