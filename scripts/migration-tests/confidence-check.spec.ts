import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sharePointFolderPath } from '../deployment-config.js';
import { addFlowContent, makeVisitor, mockApi, type Fixture } from './fixtures.js';

// Phase 20: the confidence check, Before and After, on the built participant page with a synthetic API. A whole visit (Before, the
// activities, After, Thank you's card), a reload on each check screen, a session with the check switched off (as before), the radio group
// from the keyboard and by its names, and pictures at 768 x 1024, 1024 x 768 and 390 x 844 (test-results/confidence-check/).
// What it does not cover: the facilitator's restart in a browser (scripts/test-confidence-check.js holds both kinds on the device's store and
// on the data layer), a real iPad's hands and screens (QA-TESTING.md).

const appPath = (hash: string) => `${sharePointFolderPath}/index.html${hash}`;
const shots = fileURLToPath(new URL('../../test-results/confidence-check/', import.meta.url));
const LABELS = ['Not confident at all', 'Slightly confident', 'Moderately confident', 'Confident', 'Very confident'];
const PROMPT = 'How confident are you that Deloitte has the capabilities to deliver this solution?';

/** The flow content, a named visitor, and client-a's confidence check, asked by the session unless `on` is false. */
async function checkFixture(page: Page, { on = true, flow = null as 'open' | 'sequential' | null } = {}) {
  const fixture = await mockApi(page);
  const content = addFlowContent(fixture, { flow });
  makeVisitor(fixture);
  const { records } = fixture;
  const optionIds = LABELS.map((_, at) => `chk-${at + 1}`);
  records.sections.push({ id: 'section-check', title: 'Confidence check', description: 'Asked at the start and the end.', enabled: true, order: 0, questionIds: ['q-check'], clientId: 'client-a', kind: 'confidence-check' } as never);
  records.questions.push({ id: 'q-check', sectionId: 'section-check', prompt: PROMPT, type: 'confidence-continuum', optionIds, order: 1, layout: 'text-list' } as never);
  LABELS.forEach((label, at) => records.options.push({ id: optionIds[at], questionId: 'q-check', label, value: at + 1, correct: null } as never));
  for (const session of records.sessions) {
    session.sectionIds = ['section-check', ...session.sectionIds];
    Object.assign(session, { confidenceCheck: on });
  }
  return { fixture, ...content };
}

/** Every activity answered right, as stored answers. */
const everyActivity = (content: Awaited<ReturnType<typeof checkFixture>>) => content.questions.map((question) => {
  const id = question.correct == null ? `${question.id}-a` : content.right(question.id);
  return { questionId: question.id, answer: id, firstAnswer: id };
});
const cards = (page: Page) => page.getByRole('radiogroup').getByRole('radio');
const saved = (fixture: Fixture) => fixture.saved().map((record) => record.questionId);

test('a whole visit: Before first, the activities, After at the end, and Thank you says how confidence moved', async ({ page }) => {
  const content = await checkFixture(page);
  await page.goto(appPath('#/?t=track-a'));
  await expect(page).toHaveURL(/#\/check-in/);
  await expect(page.getByText('Before we begin', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: PROMPT })).toBeVisible();
  await expect(page.getByText('Tap the one that fits best')).toBeVisible();
  await expect(cards(page)).toHaveCount(5);
  const go = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(go).toBeDisabled();
  await page.getByRole('radio', { name: /Slightly confident/ }).click();
  await expect(page.getByRole('radio', { name: /Slightly confident/ })).toHaveAttribute('aria-checked', 'true');
  await expect(go).toBeEnabled();

  // A reload keeps the picked card, and nothing is saved until Continue.
  await page.reload();
  await expect(page.getByRole('radio', { name: /Slightly confident/ })).toHaveAttribute('aria-checked', 'true');
  expect(saved(content.fixture)).toEqual([]);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/#\/agenda/);
  await expect(page.getByRole('button', { name: "Alpha's History" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confidence check' })).toHaveCount(0);
  await expect.poll(() => saved(content.fixture)).toContain('q-check@before');

  // The activities, done (stored as if answered), then the hub's Finish asks After.
  content.fixture.give([...everyActivity(content), { questionId: 'q-check@before', answer: 'chk-2', firstAnswer: 'chk-2' }]);
  await page.goto(appPath('#/agenda?t=track-a'));
  await page.reload();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page).toHaveURL(/#\/check-out/);
  await expect(page.getByText('Before you go', { exact: true })).toBeVisible();
  // The Before answer is not shown here.
  for (const card of await cards(page).all()) await expect(card).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('radio', { name: /^4 ?Confident/ }).click();
  await page.reload();
  await expect(page.getByRole('radio', { name: /^4 ?Confident/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page).toHaveURL(/#\/thank-you/);
  await expect(page.getByText('Your confidence moved up')).toBeVisible();
  await expect(page.getByText('Before: 2 Slightly confident')).toBeVisible();
  await expect(page.getByText('After: 4 Confident')).toBeVisible();
  await expect.poll(() => saved(content.fixture)).toContain('q-check@after');

  // Back on the hub, nothing is asked twice: Before is not asked again, and the visit is over.
  await page.goto(appPath('#/check-in?t=track-a'));
  await expect(page).not.toHaveURL(/#\/check-in/);
});

test('the hub cannot skip Before; an any-order session offers Finish (and After) before every activity is done', async ({ page }) => {
  const content = await checkFixture(page, { flow: 'open' });
  await page.goto(appPath('#/agenda?t=track-a'));
  await expect(page).toHaveURL(/#\/check-in/);
  content.fixture.give([{ questionId: 'q-check@before', answer: 'chk-3', firstAnswer: 'chk-3' }]);
  await page.goto(appPath('#/agenda?t=track-a'));
  await page.reload();
  await expect(page.getByRole('button', { name: "Alpha's History" })).toBeVisible();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page).toHaveURL(/#\/check-out/);
});

test('a session with the check switched off is as it was: no check screen, and Finish goes to Thank you', async ({ page }) => {
  const content = await checkFixture(page, { on: false });
  await page.goto(appPath('#/?t=track-a'));
  await expect(page).toHaveURL(/#\/agenda/);
  await expect(page.getByRole('button', { name: 'Confidence check' })).toHaveCount(0);
  await page.goto(appPath('#/check-in?t=track-a'));
  await expect(page).toHaveURL(/#\/agenda/);
  content.fixture.give(everyActivity(content));
  await page.reload();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page).toHaveURL(/#\/thank-you/);
  await expect(page.getByText(/Your confidence/)).toHaveCount(0);
});

test('keyboard: one tab stop for the cards, arrows move and pick, the focus ring shows, and every card is named', async ({ page, browserName }) => {
  await checkFixture(page);
  await page.goto(appPath('#/check-in?t=track-a'));
  await expect(cards(page)).toHaveCount(5);
  for (const [at, label] of LABELS.entries()) await expect(page.getByRole('radio', { name: `${at + 1} ${label}` })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: PROMPT })).toBeVisible();
  const first = cards(page).first();
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(cards(page).nth(1)).toBeFocused();
  await expect(cards(page).nth(1)).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(cards(page).nth(2)).toHaveAttribute('aria-checked', 'true');
  await expect(cards(page).nth(1)).toHaveAttribute('aria-checked', 'false');
  // The picked card is the group's one tab stop.
  expect(await cards(page).evaluateAll((all) => all.map((card) => card.getAttribute('tabindex')))).toEqual(['-1', '-1', '0', '-1', '-1']);
  if (browserName === 'chromium') {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeFocused();
  }
});

for (const [name, width, height] of [['portrait', 768, 1024], ['landscape', 1024, 768], ['phone', 390, 844]] as const) {
  test(`the screen at ${width} x ${height} (${name}): the cards and the button fit without scrolling, text 16 px or more, targets well over 44 px`, async ({ page, browserName }) => {
    await checkFixture(page);
    await page.setViewportSize({ width, height });
    await page.goto(appPath('#/check-in?t=track-a'));
    await page.getByRole('radio', { name: /Moderately confident/ }).click();
    await mkdir(shots, { recursive: true });
    await page.screenshot({ path: `${shots}check-in-${name}-${browserName}.png` });
    const button = page.getByRole('button', { name: 'Continue', exact: true });
    const box = await button.boundingBox();
    expect(box && box.y + box.height <= height + 1, 'the button is on the screen without scrolling').toBe(true);
    for (const card of await cards(page).all()) {
      const each = (await card.boundingBox())!;
      expect(each.height).toBeGreaterThanOrEqual(name === 'phone' ? 55 : 89);
      expect(each.width).toBeGreaterThanOrEqual(44);
    }
    const smallest = await page.locator('.pms-check').evaluate((root) => Math.min(...[...root.querySelectorAll('p, h1, span, button')]
      .filter((node) => node.textContent?.trim()).map((node) => parseFloat(getComputedStyle(node).fontSize))));
    expect(smallest).toBeGreaterThanOrEqual(16);
    if (name === 'portrait') {
      // The answer panel starts on the 61.8% line of the screen (633 at 1024) and runs to its foot.
      const panel = (await page.locator('.pms-check-panel').boundingBox())!;
      expect(Math.abs(panel.y / height - 0.618)).toBeLessThan(0.01);
      expect(Math.abs(panel.y + panel.height - height)).toBeLessThan(2);
      const row = await cards(page).evaluateAll((all) => all.map((card) => card.getBoundingClientRect()).map((rect) => rect.height / rect.width));
      for (const ratio of row) expect(Math.abs(ratio - 196 / 121)).toBeLessThan(0.02);
    }
  });
}

test('the facilitator\'s preview shows Before and After read-only', async ({ page }) => {
  await checkFixture(page);
  await page.goto(`${sharePointFolderPath}/index.html?preview=client-a#/`);
  await page.getByRole('button', { name: /begin/i }).click();
  await expect(page.getByText('Before we begin', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: /Confident$/ }).first().click({ force: true });
  for (const card of await cards(page).all()) await expect(card).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
});

test('axe finds nothing on Before (a card picked) and After, at WCAG 2.1 AA', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'axe reads the DOM, which is the same in every engine (a11y.spec.ts runs it on Chromium too)');
  const { axeCheck } = await import('./a11y-support.js');
  const content = await checkFixture(page);
  await page.goto(appPath('#/check-in?t=track-a'));
  await page.getByRole('radio', { name: /Slightly confident/ }).click();
  expect((await axeCheck(page, 'Before, a card picked')).findings).toEqual([]);
  content.fixture.give([...everyActivity(content), { questionId: 'q-check@before', answer: 'chk-2', firstAnswer: 'chk-2' }]);
  await page.goto(appPath('#/check-out?t=track-a'));
  await page.reload();
  await expect(page.getByText('Before you go', { exact: true })).toBeVisible();
  expect((await axeCheck(page, 'After, nothing picked')).findings).toEqual([]);
});
