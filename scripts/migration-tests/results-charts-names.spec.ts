import { test, expect, type Page } from '@playwright/test';
import { adminUrl, another, ds, openAdmin, shoot, startLocal, stopLocal, useServer, PIN, type Local } from './admin-local.js';
import { VINE, VINE_NAMES, seedVine } from '../results-charts-fixtures.js';
import { namesInPage, walkTheWall } from './results-charts-support.js';

// Phase 11a, part D: names on the charts, on the admin view only. VJR's run in miniature (scripts/results-charts-fixtures.js): Mike A and two more
// guests who scanned their own codes, a member of staff with no name, and a comment from each. The BUILT admin page against the REAL local server
// on a scratch copy of server/data. What a bar opens, what it counts, how it closes, the switch that hides the names, Results' own cards, and the
// wall (full screen, and the page "Open in a new tab" opens), where no name may be anywhere in the page: scripts/migration-tests/results-charts-
// wall-mutation.spec.ts shows that the wall's check can fail.

// A control that cannot be pressed fails the test in 15 seconds with the reason, instead of waiting for the test's own time to run out.
test.use({ actionTimeout: 15_000 });

let local: Local;
test.beforeEach(async () => { local = await startLocal(); });
test.afterEach(async () => { await stopLocal(local); });

const card = (page: Page, questionId: string) => page.locator(`.result-card[data-question="${questionId}"]`);
const panel = (page: Page) => page.getByTestId('names-panel');
const namesOf = (page: Page) => panel(page).locator('.names__name').allTextContents();
/** Opens a bar's names (pressing an open bar closes them, so an open one is left as it is). */
async function open(mark: ReturnType<Page['locator']>) {
  if ((await mark.getAttribute('aria-expanded')) !== 'true') await mark.click();
  await expect(mark).toHaveAttribute('aria-expanded', 'true');
}

/** Opens the Live display of the session, after the PIN, at its admin view. */
async function openLive(page: Page, sessionId: string, wall = false) {
  const requests = await openAdmin(page, local);
  await page.evaluate((hash) => { window.location.hash = hash; }, `#live-display/${sessionId}${wall ? '/wall' : ''}`);
  await expect(page.locator('.result-card').first()).toBeVisible();
  return requests;
}

test('a bar opens who picked it under its card, each name with the time they answered, as many as the bar counts', async ({ page }) => {
  const { session } = await seedVine(ds);
  await page.setViewportSize({ width: 1280, height: 900 });
  const requests = await openLive(page, session.id);
  const vine = card(page, 'v1').getByRole('button', { name: new RegExp(`^${VINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: 2 people`) });
  await expect(vine).toHaveAttribute('aria-expanded', 'false');
  const before = requests.length;
  await vine.click();
  await expect(vine).toHaveAttribute('aria-expanded', 'true');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('heading')).toHaveText(`Who picked: ${VINE} (2 people)`);
  expect(await namesOf(page)).toEqual(['Mike A', 'José Álvarez']);
  // Each name has a time beside it, and the bar names the panel it opened.
  await expect(panel(page).locator('.names__when')).toHaveText([/\d{1,2}:\d{2}/, /\d{1,2}:\d{2}/]);
  expect(await vine.getAttribute('aria-controls')).toBe(await panel(page).getAttribute('id'));
  // A screen reader hears the count.
  await expect(card(page, 'v1').locator('[aria-live="polite"]')).toHaveText(`Who picked ${VINE}: 2 people`);
  // Opening a panel is not a request: the names come from what the page already read.
  expect(requests.slice(before).filter((entry) => !/^GET (sessions|clienttracks|participantresponses|sections|appsettings)/.test(entry)), 'no request to show names').toEqual([]);
  await shoot(page, 'charts-names-panel-1280', { full: false });

  // Every mark of every chart opens as many names as it counts (a ranking lists everyone who ranked it, with their place).
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(vine).toBeFocused();
  for (const id of ['v1', 'v2', 'v3', 'v4', 'v5']) {
    const marks = card(page, id).locator('[data-mark]');
    for (let index = 0; index < await marks.count(); index += 1) {
      const mark = marks.nth(index);
      const name = (await mark.getAttribute('aria-label')) ?? '';
      await mark.click();
      await expect(mark).toHaveAttribute('aria-expanded', 'true');
      const own = card(page, id).getByTestId('names-panel');
      const heading = (await own.getByRole('heading').textContent()) ?? '';
      const counted = Number(/\((\d+) (?:person|people)\)$/.exec(heading)?.[1]);
      const names = await own.locator('.names__name').allTextContents();
      expect(names.length, `${id}: "${heading}" lists its people`).toBe(counted);
      if (id === 'v5') expect(counted, `${id}: everyone who ranked it`).toBe(4);
      else expect(name, `${id}: the bar says the same count`).toContain(`${counted} ${counted === 1 ? 'person' : 'people'}`);
      for (const person of names) expect(VINE_NAMES, `${person} is one of the four`).toContain(person);
    }
  }
  // The confidence scale's middle step, the true side and a ranking, worked out by hand from the fixture.
  // (Each card has a panel of its own, and they can be open together.)
  const namesIn = (id: string) => card(page, id).getByTestId('names-panel').locator('.names__name').allTextContents();
  await open(card(page, 'v4').getByRole('button', { name: /^Moderately confident: 2 people/ }));
  expect(await namesIn('v4')).toEqual(['Mike A', 'José Álvarez']);
  await open(card(page, 'v3').getByRole('button', { name: /^True: 3 people/ }));
  expect((await namesIn('v3')).sort()).toEqual(['José Álvarez', 'Mike A', 'Unnamed participant 1']);
  await open(card(page, 'v5').getByRole('button', { name: /Longer breaks/ }));
  const ranked = card(page, 'v5').getByTestId('names-panel');
  await expect(ranked.getByRole('heading')).toHaveText('How people ranked: Longer breaks (4 people)');
  await expect(ranked.locator('.names__person').first()).toContainText('Unnamed participant 1');
  await expect(ranked.locator('.names__person').first()).toContainText('1st');
  expect(await page.getByTestId('names-panel').count(), 'a panel open on each card that was pressed').toBe(5);
});

test('the panel stays open through a refresh, by its answer, and counts the person who just answered', async ({ page }) => {
  const { session } = await seedVine(ds);
  await openLive(page, session.id);
  const vine = card(page, 'v1').locator('[data-mark="v1b"]');
  await vine.click();
  await expect(panel(page).getByRole('heading')).toHaveText(`Who picked: ${VINE} (2 people)`);
  // A fifth person (a member of staff) picks Vine Street first: the next refresh moves the bar, and the open panel follows it.
  const track = await ds.beginVisit(crypto.randomUUID(), session.id, 'c-vine');
  await ds.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: 'c-vine', responses: [{ questionId: 'v1', answer: 'v1b', firstAnswer: 'v1b', attempts: 1, correct: true, answeredAt: new Date().toISOString() }] });
  await expect(panel(page).getByRole('heading')).toHaveText(`Who picked: ${VINE} (3 people)`, { timeout: 15_000 });
  await expect(vine).toHaveAttribute('aria-expanded', 'true');
  await expect(vine).toHaveAccessibleName(new RegExp(`^${VINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: 3 people, 60%`));
  expect(await namesOf(page)).toEqual(['Mike A', 'José Álvarez', 'Unnamed participant 2']);
});

test('Esc and the close button close it, and focus goes back to the bar that opened it', async ({ page }) => {
  const { session } = await seedVine(ds);
  await openLive(page, session.id);
  const chat = card(page, 'v2').locator('[data-mark="v2b"]');
  await chat.click();
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(chat).toBeFocused();
  await expect(chat).toHaveAttribute('aria-expanded', 'false');
  await chat.click();
  await panel(page).getByRole('button', { name: 'Close the names' }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(chat).toBeFocused();
  // From the keyboard: Enter on a bar opens it.
  await chat.press('Enter');
  await expect(panel(page)).toBeVisible();
  await chat.press('Space');
  await expect(panel(page)).toHaveCount(0);
});

test.describe('with a finger', () => {
  test.use({ hasTouch: true, viewport: { width: 820, height: 1180 } });

  test('on an iPad-sized touch screen a tap on a bar opens its names, and a tap on the close button closes them', async ({ page }) => {
    const { session } = await seedVine(ds);
    await openLive(page, session.id);
    const vine = card(page, 'v1').locator('[data-mark="v1b"]');
    await vine.scrollIntoViewIfNeeded();
    await vine.tap();
    await expect(panel(page)).toBeVisible();
    expect(await namesOf(page)).toEqual(['Mike A', 'José Álvarez']);
    await shoot(page, 'charts-names-panel-ipad', { full: false });
    await panel(page).getByRole('button', { name: 'Close the names' }).tap();
    await expect(panel(page)).toHaveCount(0);
  });
});

test('Names shown: on in the admin view, one click hides every name in the page, and another brings them back', async ({ page }) => {
  const { session } = await seedVine(ds);
  await openLive(page, session.id);
  const names = page.getByRole('switch', { name: /Names shown/ });
  await expect(names).toHaveAttribute('aria-checked', 'true');
  await card(page, 'v1').locator('[data-mark="v1b"]').click();
  await expect(panel(page)).toBeVisible();
  // The comments say who wrote them.
  await expect(card(page, 'v6').locator('.words__who').first()).toBeVisible();
  await names.click();
  await expect(names).toHaveAttribute('aria-checked', 'false');
  await expect(panel(page)).toHaveCount(0);
  expect(await namesInPage(page), 'no name in the page').toEqual([]);
  // A bar can still be pressed for its tooltip, but opens nothing.
  await card(page, 'v1').locator('[data-mark="v1b"]').click();
  await expect(panel(page)).toHaveCount(0);
  await expect(card(page, 'v1').locator('[data-mark="v1b"]')).not.toHaveAttribute('aria-expanded', /.*/);
  await names.click();
  await expect(card(page, 'v6').locator('.words__who').first()).toBeVisible();
});

test('Results: each session card\'s live results draw the same charts and open the same names, and lend the Live display a sign-in name they read', async ({ page, browser }) => {
  const { session } = await seedVine(ds);
  // A member of staff whose sign-in name is in the visit log (not on the visit itself), who picked Vine Street.
  await ds.updateSession(session.id, { participationMode: 'staff' });
  const track = await ds.beginVisit(crypto.randomUUID(), session.id, 'c-vine', { sharePointUserId: '17' });
  await ds.recordUserVisit({ visitKey: `visit-${track.id}`, sessionId: session.id, clientId: 'c-vine', page: 'participant', entryMode: 'staff', sharePointUserId: '17', displayName: 'Søren Kjær', visitorId: null, visitorName: '', trackId: null, visitedAt: new Date().toISOString() });
  await ds.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: 'c-vine', responses: [{ questionId: 'v1', answer: 'v1b', firstAnswer: 'v1b', attempts: 1, correct: true, answeredAt: new Date().toISOString() }] });
  await openAdmin(page, local, 'Results');
  const sessionCard = page.locator(`article[data-session="${session.id}"]`);
  await expect(sessionCard).toContainText('Søren Kjær');
  await sessionCard.locator('summary').click();
  const vine = sessionCard.locator('.result-card[data-question="v1"] [data-mark="v1b"]');
  await vine.click();
  await expect(sessionCard.getByTestId('names-panel').getByRole('heading')).toHaveText(`Who picked: ${VINE} (3 people)`);
  expect(await sessionCard.getByTestId('names-panel').locator('.names__name').allTextContents()).toEqual(['Mike A', 'José Álvarez', 'Søren Kjær']);
  // The Live display, opened from here, names him too: Results read the visit log, and the display reads none of its own.
  await sessionCard.getByRole('button', { name: 'Live display' }).click();
  await card(page, 'v1').locator('[data-mark="v1b"]').click();
  expect(await namesOf(page)).toEqual(['Mike A', 'José Álvarez', 'Søren Kjær']);
  // Opened directly in a page that has not read Results, the display has only what is on the visits: his name is not there (VJR's choice, 16 Oct
  // 2026: no request was added for it), so he is an unnamed participant, numbered after the one who has no name anywhere.
  const fresh = await another(browser, local);
  await fresh.page.goto(`${adminUrl}#live-display/${session.id}`);
  await fresh.page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await fresh.page.getByRole('button', { name: 'Unlock' }).click();
  await card(fresh.page, 'v1').locator('[data-mark="v1b"]').click();
  expect(await fresh.page.getByTestId('names-panel').locator('.names__name').allTextContents()).toEqual(['Mike A', 'José Álvarez', 'Unnamed participant 2']);
  await fresh.context.close();
});

test('the wall has no participant\'s name anywhere in the page: full screen from the admin view, the page "Open in a new tab" opens, and full screen from it', async ({ page, context }) => {
  test.setTimeout(300_000);
  // As on an iPad, where Safari does not put an element in its own full screen: the display's cover alone is the wall. (Playwright's WebKit, in a
  // headless window, often ends its own full screen by itself a moment after it began, and the display rightly follows it out, which would leave the
  // walk looking at the admin view. Full screen with the browser's own is in live-display-smoke.spec.ts, in all three engines.)
  await context.addInitScript(() => {
    for (const name of ['requestFullscreen', 'webkitRequestFullscreen']) Object.defineProperty(Element.prototype, name, { value: undefined, configurable: true });
  });
  const { session } = await seedVine(ds);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openLive(page, session.id);
  // The admin view has them (the check is looking at a page that does have names to hide).
  await card(page, 'v1').locator('[data-mark="v1b"]').click();
  expect(await namesInPage(page)).toEqual(['Mike A', 'José Álvarez', '=SUM(A1)', 'Unnamed participant 1']);
  // Full screen from the admin view, every question, its numbers, a tooltip, a chosen word and Show answer.
  await page.getByRole('button', { name: 'Full screen' }).click();
  expect(await walkTheWall(page, 'full screen from the admin view'), 'names found on the wall').toEqual([]);
  await page.keyboard.press('Escape');
  // The page "Open in a new tab" opens, and full screen from it.
  const [tab] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: 'Open in a new tab' }).click()]);
  await useServer(tab, local);
  await tab.setViewportSize({ width: 1280, height: 800 });
  await tab.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await tab.getByRole('button', { name: 'Unlock' }).click();
  await expect(tab.getByRole('heading', { name: 'Live results · Wall display' })).toBeVisible();
  await expect(tab.getByRole('switch', { name: /Names shown/ })).toHaveCount(0);
  expect(await walkTheWall(tab, 'the wall page'), 'names found on the wall page').toEqual([]);
  await shoot(tab, 'charts-wall-page-1280', { full: true });
  await tab.getByRole('button', { name: 'Full screen' }).click();
  expect(await walkTheWall(tab, 'full screen from the wall page'), 'names found in its full screen').toEqual([]);
  // Out of full screen before the tab closes.
  await tab.keyboard.press('Escape');
  await expect(tab.locator('section.live')).toHaveAttribute('data-presenting', 'false');
  await tab.close();
});
