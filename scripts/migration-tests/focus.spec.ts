import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { samplePack } from '../../migration/src/lib/sample-clients.js';
import { seedPack } from '../../migration/src/lib/seed.js';
import { newFake, onSite, pageUrl, seedAndGoLive, serveSharePoint } from './sharepoint.js';

// A heading that script moves focus to (a new screen, the next question) is not a control. For
// someone using a pointer or a finger it must draw nothing at all: no outline and no halo. For
// someone using the keyboard it must show the same green ring as every control, so they can see
// where they are. These tests read what the browser actually computes for the focused heading, in
// both cases, on every screen that focuses one. They run on Chromium and on WebKit (every iPad
// browser), because the two disagree about what `:focus-visible` means for scripted focus.

const shots = fileURLToPath(new URL('../../test-results/flow/', import.meta.url));

/** What the browser paints around the focused element, if that element is a heading; null otherwise. */
const focusedHeading = (page: Page) => page.evaluate(() => {
  const element = document.activeElement;
  if (!element || !/^H[1-6]$/.test(element.tagName)) return null;
  const style = getComputedStyle(element);
  return {
    text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 32),
    outline: style.outlineStyle === 'none' ? 'none' : `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
    halo: style.boxShadow,
    marked: element.hasAttribute('data-keyboard-focus'),
  };
});
const NOTHING = { outline: 'none', halo: 'none', marked: false };
const RING = { outline: 'solid 3px rgb(134, 188, 37)', marked: true };
const choices = (page: Page) => page.locator('.pms-options button');
const nextButton = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });

async function notLivePage(page: Page) {
  const fake = newFake();
  await onSite(fake, (ds) => seedPack(ds, samplePack())); // clients exist; none is live
  await serveSharePoint(page, fake);
  await page.goto(pageUrl('index.html'));
}

async function krogerPage(page: Page) {
  const fake = newFake();
  await seedAndGoLive(fake, 'c-kroger');
  await serveSharePoint(page, fake);
  await page.goto(pageUrl('index.html'));
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
}

test('"isn\'t live yet": the heading is focused on load with no outline and no halo; only the keyboard brings the ring', async ({ page }) => {
  await notLivePage(page);
  const heading = page.getByRole('heading', { name: "Today's experience isn't live yet" });
  // Nobody has touched anything. This is the box that used to show.
  await expect(heading).toBeFocused();
  expect(await focusedHeading(page)).toMatchObject(NOTHING);

  // A pointer user presses "Check again": the screen comes back and focuses its heading again.
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(heading).toBeFocused();
  expect(await focusedHeading(page)).toMatchObject(NOTHING);

  // A keyboard user does the same with Enter on the button: now the heading shows where focus is.
  // (Not reached with Tab here: Safari on a Mac skips buttons with Tab unless a system setting says otherwise.)
  await page.getByRole('button', { name: 'Check again' }).press('Enter');
  await expect(heading).toBeFocused();
  const ringed = await focusedHeading(page);
  expect(ringed).toMatchObject(RING);
  expect(ringed!.halo, 'with the dark halo every control has').not.toBe('none');

  // A click on the heading itself gives it focus by pointer: the ring from before does not stay.
  await heading.click();
  await expect(heading).toBeFocused();
  expect(await focusedHeading(page)).toMatchObject(NOTHING);
});

test('the stop screen (Phase 10b): its heading is focused when the page opens, with no outline and no halo, on both pages', async ({ page }) => {
  // A site whose folder has no pms-config.txt, and pages with nothing built in: both pages stop (lib/start.ts) and focus the heading.
  // The screen only ever appears as a page loads, when nobody has used the keyboard yet, so it draws nothing round the heading; the
  // ring on its one control, Try again, is held by settings-file.spec.ts and keyboard.spec.ts.
  for (const file of ['index.html', 'admin.html']) {
    const fake = newFake();
    await serveSharePoint(page, fake, { settings: null });
    await page.goto(pageUrl(file));
    await expect(page.getByRole('heading', { level: 1, name: 'This page cannot start' })).toBeFocused();
    expect(await focusedHeading(page), file).toMatchObject({ ...NOTHING, text: 'This page cannot start' });
    // Try again loads the page afresh: the same screen, the same focus, still nothing drawn.
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'This page cannot start' })).toBeFocused();
    expect(await focusedHeading(page), `${file}, after Try again`).toMatchObject(NOTHING);
    expect(fake.requests.length, 'and through all of it nothing was asked of the lists').toBe(0);
  }
});

test('in an activity: the question and the completion heading take the ring after Enter, and nothing after a click', async ({ page }) => {
  await krogerPage(page);
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await page.getByRole('button', { name: "Kroger's History" }).click();
  const question = page.getByRole('heading', { level: 2 });
  await expect(question).toBeFocused();
  expect(await focusedHeading(page), 'question 1, reached by a click').toMatchObject(NOTHING);

  // Pointer: pick, Next.
  await choices(page).nth(1).click();
  await nextButton(page).click();
  await expect(page.getByRole('progressbar', { name: 'Question 2 of 5' })).toBeVisible();
  await expect(question).toBeFocused();
  expect(await focusedHeading(page), 'question 2, reached by a click').toMatchObject(NOTHING);

  // Keyboard: Enter on an answer picks it and moves focus to Next; Enter again goes on.
  await choices(page).nth(0).press('Enter');
  await expect(nextButton(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('progressbar', { name: 'Question 3 of 5' })).toBeVisible();
  await expect(question).toBeFocused();
  expect(await focusedHeading(page), 'question 3, reached by keyboard').toMatchObject(RING);

  // Back to the pointer: the ring goes again.
  await choices(page).nth(2).click();
  await nextButton(page).click();
  await expect(page.getByRole('progressbar', { name: 'Question 4 of 5' })).toBeVisible();
  await expect(question).toBeFocused();
  expect(await focusedHeading(page), 'question 4, reached by a click').toMatchObject(NOTHING);

  // The last question by keyboard: the completion screen's heading is ringed too.
  await choices(page).nth(0).press('Enter');
  await page.keyboard.press('Enter');
  await choices(page).nth(2).press('Enter');
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  const done = page.getByRole('heading', { level: 1, name: /Nice work/ });
  await expect(done).toBeFocused();
  expect(await focusedHeading(page), 'activity complete, reached by keyboard').toMatchObject(RING);
});

test('Welcome and the hub take focus on their heading (Phase 8), with the ring only after the keyboard', async ({ page }) => {
  await krogerPage(page);
  const welcome = page.getByRole('heading', { level: 1 });
  await expect(welcome).toBeFocused();
  expect(await focusedHeading(page), 'Welcome, opened by nobody touching anything').toMatchObject(NOTHING);
  // The keyboard: Enter on the one button goes to the hub, whose heading is focused and ringed.
  await page.getByRole('button', { name: 'Click here to begin' }).press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: /Kroger Trivia Night/ })).toBeFocused();
  expect(await focusedHeading(page), 'the hub, reached by the keyboard').toMatchObject(RING);
  // A click on Home: Welcome again, its heading focused, and no ring for a pointer.
  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Hi / })).toBeFocused();
  expect(await focusedHeading(page), 'Welcome, reached by a click').toMatchObject(NOTHING);
  await page.getByRole('button', { name: 'Click here to begin' }).click(); // (nothing has been answered, so it still says so)
  await expect(page.getByRole('heading', { level: 1, name: /Kroger Trivia Night/ })).toBeFocused();
  expect(await focusedHeading(page), 'the hub, reached by a click').toMatchObject(NOTHING);
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, viewport: { width: 820, height: 1180 } });

  test('taps never draw anything round a heading: not-live, each question, completion and the finale', async ({ page }) => {
    await krogerPage(page);
    await page.getByRole('button', { name: 'Click here to begin' }).tap();
    await page.getByRole('button', { name: "Kroger's History" }).tap();
    const question = page.getByRole('heading', { level: 2 });
    for (const [index, right] of [1, 0, 2, 0, 2].entries()) {
      await expect(page.getByRole('progressbar', { name: `Question ${index + 1} of 5` })).toBeVisible();
      await expect(question).toBeFocused();
      expect(await focusedHeading(page), `question ${index + 1}`).toMatchObject(NOTHING);
      await choices(page).nth(right).tap();
      await page.getByRole('button', { name: index === 4 ? 'Submit' : 'Next', exact: true }).tap();
    }
    await expect(page.getByRole('heading', { level: 1, name: /Nice work/ })).toBeFocused();
    expect(await focusedHeading(page), 'activity complete').toMatchObject(NOTHING);

    await page.getByRole('button', { name: 'Back to activities' }).tap();
    await page.getByRole('button', { name: /Guess the Brand/ }).tap();
    await expect(question).toBeFocused();
    expect(await focusedHeading(page), 'a tile question').toMatchObject(NOTHING);
    await page.getByRole('button', { name: 'Home Chef' }).tap();
    await page.getByRole('button', { name: 'Submit', exact: true }).tap();
    await page.getByRole('button', { name: 'Finish', exact: true }).tap();
    await expect(page.getByRole('heading', { level: 1, name: /Thank you/ })).toBeFocused();
    expect(await focusedHeading(page), 'the finale').toMatchObject(NOTHING);
  });

  test('"isn\'t live yet" on an untouched iPad shows no box', async ({ page }, testInfo) => {
    await notLivePage(page);
    await expect(page.getByRole('heading', { name: "Today's experience isn't live yet" })).toBeFocused();
    expect(await focusedHeading(page)).toMatchObject(NOTHING);
    // A picture of it, per engine, to look at.
    await mkdir(shots, { recursive: true });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${shots}not-live-untouched-${testInfo.project.name}-820x1180.png` });
    await page.getByRole('button', { name: 'Check again' }).tap();
    await expect(page.getByRole('heading', { name: "Today's experience isn't live yet" })).toBeFocused();
    expect(await focusedHeading(page)).toMatchObject(NOTHING);
  });
});
