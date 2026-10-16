import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { legacyColours } from '../../migration/src/lib/brand-studio.js';
import { resultsToCsv } from '../../public/js/resultsExport.js';
import { readSessionResults } from '../../migration/src/lib/session-results.js';
import {
  PIN, adminUrl, addActivity, another, ds, expectFits, openAdmin, participantUrl, shoot, startLocal, stopLocal, today, useServer, viewports, type Local,
} from './admin-local.js';
import { holdClock, setHidden } from './polling-support.js';

// Phase 7: the facilitator's live results display moved from the participant page's #/master-results/<id> to the admin page (Results →
// Live display, also from Today), with Full screen for projecting and the CSV, PDF and PowerPoint exports. The BUILT admin and
// participant pages against the REAL local server on a scratch copy of server/data. Screenshots are in test-results/admin/live-*.png.
// Since Phase 11a each question is a chart of its own kind (admin/charts/ResultCard.svelte, no chart library); the charts' own rules, the names
// and the wall are scripts/migration-tests/results-charts*.spec.ts. What is held here is the display around them, as it was.

let local: Local;
test.beforeEach(async () => { local = await startLocal(); });
test.afterEach(async () => { await stopLocal(local); });

type Live = { session: { id: string; sectionIds: string[]; clientId: string }; tracks: { id: string }[]; extraId: string };

/** Kroger live, with its two activities and a third of other kinds (a ranking, written feedback), and three iPads that answered. */
async function liveKroger(): Promise<Live> {
  const { session } = await ds.activateClient('c-kroger', today);
  const extraId = await addActivity('c-kroger', {
    title: 'Live extras',
    questions: [
      { prompt: 'Rank what mattered most', type: 'ranked-voting', options: [['Speed', null], ['Quality', null], ['Price', null]] },
      { prompt: 'What would you change?', type: 'open-text-feedback', options: [] },
    ],
  });
  await ds.addSectionsToLiveSession('c-kroger', [extraId]);
  const tracks = [];
  for (let index = 0; index < 3; index += 1) tracks.push(await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger'));
  const give = (trackId: string, picks: Record<string, unknown>) => ds.saveParticipantResponses({
    trackId, sessionId: session.id, clientId: 'c-kroger',
    responses: Object.entries(picks).map(([questionId, answer]) => ({ questionId, answer, firstAnswer: answer, attempts: 1, correct: null, answeredAt: new Date().toISOString() })),
  });
  await give(tracks[0].id, { 'q-trivia-1': 'o-trivia-1-b', 'q-trivia-2': 'o-trivia-2-a', [`${extraId}-q0`]: [`${extraId}-q0-o2`, `${extraId}-q0-o0`, `${extraId}-q0-o1`], [`${extraId}-q1`]: 'Faster check-in' });
  await give(tracks[1].id, { 'q-trivia-1': 'o-trivia-1-b', 'q-trivia-2': 'o-trivia-2-c' });
  await give(tracks[2].id, { 'q-trivia-1': 'o-trivia-1-a' });
  return { session: (await ds.getSession(session.id)) as Live['session'], tracks, extraId };
}

const display = (page: Page) => page.locator('section.live');
/** Puts keyboard focus on a control by Tab and Shift+Tab (a script's focus() is not a keyboard focus in every engine: in Firefox it is only after a keyboard focus). */
async function focusWithKeys(page: Page, target: ReturnType<Page['locator']>) {
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let step = 0; step < 14; step += 1) {
      if (await target.evaluate((element) => element === document.activeElement)) return;
      await page.keyboard.press(key);
    }
  }
  if (!(await target.evaluate((element) => element === document.activeElement))) throw new Error('the keyboard did not reach the control');
}
const meta = (page: Page) => page.locator('.live__meta');
const cards = (page: Page) => page.locator('.result-card');
/** A card's chart, whatever its kind: bars, the true-or-false split, a scale's columns, or written answers. */
const CHART = '.bars, .split, .scale, .words';
const brandOf = (page: Page) => display(page).evaluate((element) => [element.style.getPropertyValue('--brand-primary'), element.style.getPropertyValue('--brand-secondary')]);
const unlock = async (page: Page) => {
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
};

test('the Live display is reached from Today and from Results, and shows the tally, the counts and the client\'s own colours', async ({ page }) => {
  const live = await liveKroger();
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAdmin(page, local);
  // From Today: the button sits with the participant link, and the Results tab is the one that is selected.
  await page.getByRole('button', { name: 'Live display' }).click();
  await expect(page.getByRole('heading', { name: 'Live results' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Results', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(new RegExp(`#live-display/${live.session.id}$`));
  await expect(meta(page)).toContainText(/7 answers from 3 iPads/);
  // A card for every question of every live activity (the seed's own, and the two added here); a chart for each, the words and comments for the written one.
  const titles = await page.locator('.live-section__title').allTextContents();
  expect(titles.slice(0, 2)).toEqual(["Kroger's History", 'Guess the Brand']);
  expect(titles).toContain('Live extras');
  const inSession = await Promise.all(((await ds.getSession(live.session.id)) as { sectionIds: string[] }).sectionIds.map((id) => ds.getSection(id) as Promise<{ enabled: boolean }>));
  expect(titles.length, 'one block for each activity of the session that is on').toBe(inSession.filter((section) => section.enabled).length);
  const all = await cards(page).count();
  const written = await page.locator('.result-card .words').count();
  expect(all).toBeGreaterThanOrEqual(5 + 1 + 2);
  expect(written, 'the seed has a written question, and so does the activity added here').toBeGreaterThanOrEqual(2);
  await expect(page.locator(`.result-card :is(${CHART})`)).toHaveCount(all);
  const first = cards(page).first();
  await expect(first).toContainText('Barney Kroger');
  await expect(first).toContainText('3 answered');
  await expect(first.getByRole('button', { name: /^Great Western Tea co\.: 2 people, 67%/ })).toBeVisible();
  await expect(cards(page).filter({ hasText: 'What would you change?' }).locator('.words__text')).toHaveText(['Faster check-in']);
  // The colours are the client's own: the stored theme's, as the Master screen has always taken them.
  expect(await brandOf(page)).toEqual(Object.values(legacyColours({ primary: '#045BCC' })));
  await expect(page.locator('.live__client')).toHaveText('Kroger');
  await page.waitForTimeout(600); // the bars draw in once (400 ms), so the picture shows them settled
  await shoot(page, 'live-display-1440x900');

  // From Results: each session's card has the same button, and Back returns to the list.
  await page.getByRole('button', { name: '← Results' }).click();
  await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#results$/);
  await page.locator(`article[data-session="${live.session.id}"]`).getByRole('button', { name: 'Live display' }).click();
  await expect(page.getByRole('heading', { name: 'Live results' })).toBeVisible();
  await expect(meta(page)).toContainText(/7 answers from 3 iPads/);
  // The tab is how you leave it.
  await page.getByRole('tab', { name: 'Clients' }).click();
  await expect(display(page)).toHaveCount(0);
});

test('it keeps up by itself: a new answer moves the bars and the counts without a reload, and a new activity appears', async ({ page }) => {
  const live = await liveKroger();
  await openAdmin(page, local);
  await page.getByRole('button', { name: 'Live display' }).click();
  const first = cards(page).first();
  await expect(first.getByRole('button', { name: /^Great Western Tea co\.: 2 people, 67%/ })).toBeVisible();
  await ds.saveParticipantResponses({
    trackId: live.tracks[2].id, sessionId: live.session.id, clientId: 'c-kroger',
    responses: [{ questionId: 'q-trivia-1', answer: 'o-trivia-1-b', firstAnswer: 'o-trivia-1-b', attempts: 1, correct: true, answeredAt: new Date().toISOString() }],
  });
  await expect(first.getByRole('button', { name: /^Great Western Tea co\.: 3 people, 100%/ })).toBeVisible({ timeout: 10_000 });
  await expect(meta(page)).toContainText(/7 answers from 3 iPads/);
  // An activity switched off disappears from the display (the next refresh finds it in the feed), and back on, it returns.
  const extras = page.locator('.live-section__title', { hasText: 'Live extras' });
  await expect(extras).toHaveCount(1);
  await ds.updateSection(live.extraId, { enabled: false });
  await expect(extras).toHaveCount(0, { timeout: 10_000 });
  await ds.updateSection(live.extraId, { enabled: true });
  await expect(extras).toHaveCount(1, { timeout: 10_000 });
  // A fourth iPad joins. Since Phase 11a-2 (VJR's choice, 16 Oct 2026) "M iPads" are the visits that answered: it is not counted through two refreshes
  // that read it, and is counted once it has answered.
  const fourth = await ds.beginVisit(crypto.randomUUID(), live.session.id, 'c-kroger');
  const stamp = async () => /updated (.+)$/.exec((await meta(page).textContent()) ?? '')?.[1] ?? '';
  for (let refresh = 0; refresh < 2; refresh += 1) {
    const before = await stamp();
    await expect.poll(stamp, { timeout: 10_000 }).not.toBe(before);
  }
  await expect(meta(page)).toContainText(/7 answers from 3 iPads/);
  await ds.saveParticipantResponses({
    trackId: fourth.id, sessionId: live.session.id, clientId: 'c-kroger',
    responses: [{ questionId: 'q-trivia-1', answer: 'o-trivia-1-a', firstAnswer: 'o-trivia-1-a', attempts: 1, correct: true, answeredAt: new Date().toISOString() }],
  });
  await expect(meta(page)).toContainText(/8 answers from 4 iPads/, { timeout: 10_000 });
});

test('Full screen covers the page with large type, no navigation and a way out; Escape and the button both leave it', async ({ page }) => {
  await liveKroger();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openAdmin(page, local);
  await page.getByRole('button', { name: 'Live display' }).click();
  await expect(cards(page).first()).toBeVisible();
  const sizes = () => page.evaluate(() => ({
    prompt: parseFloat(getComputedStyle(document.querySelector('.result-card__prompt')!).fontSize),
    chart: document.querySelector('.result-card__body')!.getBoundingClientRect().height,
    title: parseFloat(getComputedStyle(document.querySelector('.live__title h2')!).fontSize),
  }));
  const normal = await sizes();
  await shoot(page, 'live-display-normal-1920x1080', { full: false });

  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(display(page)).toHaveAttribute('data-presenting', 'true');
  // It covers the whole window, and the admin's bar and tabs are out of reach (they are inert, not just covered).
  const box = (await display(page).boundingBox())!;
  // (The whole window, whatever size the engine made it: Firefox's real full screen is the size of its screen.)
  const [wide, high] = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
  expect([Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)]).toEqual([0, 0, wide, high]);
  expect(await page.evaluate(() => document.elementFromPoint(40, 20)?.closest('section.live') !== null), 'what is on top, at the corner where the admin bar was, is the display').toBe(true);
  await expect(page.locator('.shell__bar')).toHaveAttribute('inert', '');
  await expect(page.locator('.shell__nav')).toHaveAttribute('inert', '');
  // Larger type: the question, the heading and the chart text all scale with the window (1.92 at this width).
  await expect.poll(async () => (await sizes()).prompt).toBeGreaterThan(normal.prompt * 1.7);
  // (The chart's HEIGHT is no longer a multiple of the normal one: it takes the room the one card on screen leaves, and the next test holds that
  // to the screen. Its text is what scales with the window, and the card and the heading above.)
  await expect.poll(async () => (await sizes()).chart).toBeGreaterThan(normal.chart * 1.2);
  expect((await sizes()).title).toBeGreaterThan(normal.title * 1.7);
  // No navigation of the page inside it: no exports, no Back, no tabs; the way out, which appears when the pointer moves, and (Phase 7c) Previous, Next and Auto-advance.
  for (const name of ['Export CSV', 'Export PDF', 'Export PPT', '← Results', 'Refresh', 'Open in a new tab', 'Full screen']) {
    await expect(display(page).getByRole(name === 'Open in a new tab' ? 'link' : 'button', { name, exact: true }), name).toHaveCount(0);
  }
  // The way out shows at first, fades with the pointer after a few idle seconds, and any movement brings it back.
  const exit = display(page).getByRole('button', { name: 'Exit full screen' });
  await expect(exit).toHaveCSS('opacity', '1');
  await expect(display(page)).toHaveAttribute('data-idle', 'true', { timeout: 8000 });
  await expect(exit).toHaveCSS('opacity', '0');
  expect(await display(page).evaluate((element) => getComputedStyle(element).cursor)).toBe('none');
  await page.mouse.move(900, 500);
  await expect(display(page)).toHaveAttribute('data-idle', 'false');
  await expect(exit).toHaveCSS('opacity', '1');
  await page.keyboard.press('Tab'); // a keyboard user reaches it too, and then it stays
  await expect(exit).toBeFocused();
  await page.waitForTimeout(3300);
  await expect(exit, 'a focused way out stays visible').toHaveCSS('opacity', '1');
  // The page is a projector's: still the client's colours, answers counted, readable meta text.
  await expect(meta(page)).toContainText(/answers from 3 iPads/);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(display(page)).toHaveAttribute('data-idle', 'true', { timeout: 8000 });
  await shoot(page, 'live-display-fullscreen-1920x1080', { full: false });

  // Escape leaves it. (Where the browser gave the whole screen, Escape is the browser's own and it ends it the same way.)
  await page.keyboard.press('Escape');
  await expect(display(page)).toHaveAttribute('data-presenting', 'false');
  await expect(page.locator('.shell__bar')).not.toHaveAttribute('inert', '');
  await expect.poll(async () => (await sizes()).prompt).toBeCloseTo(normal.prompt, 0);

  // The button leaves it too, and so does ending the browser's own full screen from outside.
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(display(page)).toHaveAttribute('data-presenting', 'true');
  await exit.click();
  await expect(display(page)).toHaveAttribute('data-presenting', 'false');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null), { message: 'the browser\'s own full screen ended too' }).toBe(true);
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(display(page)).toHaveAttribute('data-presenting', 'true');
  if (await page.evaluate(() => document.fullscreenElement !== null)) {
    await page.evaluate(() => document.exitFullscreen());
    await expect(display(page), 'the browser ended its full screen by itself: so does the display').toHaveAttribute('data-presenting', 'false');
  } else {
    await page.keyboard.press('Escape');
    await expect(display(page)).toHaveAttribute('data-presenting', 'false');
  }
});

test('Full screen on a phone and a tablet: the cards fit, nothing scrolls sideways, and the way out is a tap', async ({ page }) => {
  await liveKroger();
  await openAdmin(page, local);
  await page.getByRole('button', { name: 'Live display' }).click();
  await expect(cards(page).first()).toBeVisible();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(500); // the charts lay themselves out again for the new width
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), { message: `the page stops scrolling sideways at ${viewport.width}`, timeout: 5000 }).toBe(true);
    await expectFits(page, `Live display at ${viewport.width}`);
    await shoot(page, `live-display-${viewport.width}x${viewport.height}`, { full: false });
  }
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(display(page)).toHaveAttribute('data-presenting', 'true');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shoot(page, 'live-display-fullscreen-820x1180', { full: false });
  await display(page).getByRole('button', { name: 'Exit full screen' }).tap().catch(() => display(page).getByRole('button', { name: 'Exit full screen' }).click());
  await expect(display(page)).toHaveAttribute('data-presenting', 'false');
});

// ---- Full screen: one question at a time, and the whole card on the screen (Phase 7c) ---------------------------------------------------

/** Where the card on screen is, and whether any of it is cut off: everything a projector would lose. */
const placed = (page: Page) => page.evaluate(() => {
  const box = (element: Element | null) => { const rect = element?.getBoundingClientRect(); return rect ? { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null; };
  const live = document.querySelector('section.live') as HTMLElement;
  const card = document.querySelector('.result-card') as HTMLElement;
  return {
    cards: document.querySelectorAll('.result-card').length,
    view: { width: window.innerWidth, height: window.innerHeight },
    card: box(card),
    chart: box(card.querySelector('.result-card__body')),
    count: box(card.querySelector('.result-card__meta')),
    prompt: box(card.querySelector('.result-card__prompt')),
    comments: box(card.querySelector('.words__comments')),
    cut: card.scrollHeight - card.clientHeight,
    displayCut: live.scrollHeight - live.clientHeight,
    pager: box(document.querySelector('.live__pager')),
    scale: getComputedStyle(live).getPropertyValue('--chart-scale'),
    eyebrow: document.querySelector('.live__eyebrow')?.textContent ?? '',
  };
});

/** The whole card is inside the window, and nothing in it is cut off by the card's own edge. */
async function expectWholeCard(page: Page, label: string, { chartAtLeast = 140 } = {}) {
  const at = await placed(page);
  expect(at.cards, `${label}: one card`).toBe(1);
  expect(at.card!.x, `${label}: left`).toBeGreaterThanOrEqual(0);
  expect(at.card!.y, `${label}: top`).toBeGreaterThanOrEqual(0);
  expect(at.card!.right, `${label}: right`).toBeLessThanOrEqual(at.view.width + 0.5);
  expect(at.card!.bottom, `${label}: bottom ${at.card!.bottom} against ${at.view.height}`).toBeLessThanOrEqual(at.view.height + 0.5);
  expect(at.cut, `${label}: the card's own contents run ${at.cut}px past its edge`).toBeLessThanOrEqual(1);
  expect(at.displayCut, `${label}: the display scrolls`).toBeLessThanOrEqual(1);
  // The question, its count, and the chart (its scale and labels too) are all within the card.
  for (const [name, part] of [['prompt', at.prompt], ['count', at.count], ['chart', at.chart], ['written answers', at.comments]] as const) {
    if (!part) continue;
    expect(part.bottom, `${label}: the ${name} is within the card`).toBeLessThanOrEqual(at.card!.bottom + 1);
    expect(part.right, `${label}: the ${name} is within the card`).toBeLessThanOrEqual(at.card!.right + 1);
    expect(part.y, `${label}: the ${name} is within the card`).toBeGreaterThanOrEqual(at.card!.y - 1);
  }
  if (at.chart) expect(at.chart.height, `${label}: a chart you can read`).toBeGreaterThan(chartAtLeast);
  // The controls are on the screen too.
  expect(at.pager!.bottom, `${label}: the controls`).toBeLessThanOrEqual(at.view.height + 0.5);
  return at;
}

const SIZES = [
  { width: 1920, height: 1080, name: '1920x1080' }, // a wall screen, or a 1080p projector
  { width: 1366, height: 768, name: '1366x768' }, // a laptop
  { width: 1280, height: 720, name: '1280x720' }, // a 720p projector
  { width: 1024, height: 768, name: '1024x768' }, // an iPad on its side
];

test('Full screen shows ONE question at a time, and the whole card fits: 1920x1080, 1366x768, 1280x720 and 1024x768, for every kind of question', async ({ page }) => {
  test.setTimeout(180_000);
  await liveKroger();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openAdmin(page, local);
  await page.getByRole('button', { name: 'Live display' }).click();
  await expect(cards(page).first()).toBeVisible();
  const total = await cards(page).count();
  expect(total).toBeGreaterThanOrEqual(8);
  const prompts = new Set<string>();
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect(display(page)).toHaveAttribute('data-presenting', 'true');
    await expect(cards(page)).toHaveCount(1);
    await expect(page.locator('.live__eyebrow')).toContainText(`Question 1 of ${total}`);
    for (let index = 0; index < total; index += 1) {
      await page.waitForTimeout(600); // the bars draw in once (400 ms), so the picture shows them settled and the measure is of the finished card
      const at = await expectWholeCard(page, `${size.name}, question ${index + 1} of ${total}`);
      prompts.add((await page.locator('.result-card__prompt').textContent()) ?? '');
      if (index === 0) await shoot(page, `live-display-fit-${size.name}`, { full: false });
      if (index === 0) expect(at.eyebrow).toContain('Question 1 of');
      await page.keyboard.press('ArrowRight');
    }
    // Round again: after the last, the first.
    await expect(page.locator('.live__eyebrow')).toContainText(`Question 1 of ${total}`);
    await page.keyboard.press('Escape');
    await expect(display(page)).toHaveAttribute('data-presenting', 'false');
  }
  // Every question was on the screen, once each: bar charts, the ranking and the written answers among them.
  expect(prompts.size).toBe(total);
  expect([...prompts]).toEqual(expect.arrayContaining(['Rank what mattered most', 'What would you change?']));
});

test('a question too long for the room is made smaller until the card is whole, and a ranking of eight, a wall of written answers, a scale, a multi-select and a true or false fit too', async ({ page }) => {
  test.setTimeout(120_000);
  const { session } = await ds.activateClient('c-kroger', today);
  const long = Array.from({ length: 20 }, (_unused, index) => `part ${index + 1} of a question that goes on and on and asks about a great many things at once`).join(', ');
  const extraId = await addActivity('c-kroger', {
    title: 'Stress',
    questions: [
      { prompt: long, type: 'single-select', options: [['A fairly long answer that wraps', null], ['Another long answer that also wraps onto lines', null], ['Short', null], ['Medium answer', null]] },
      { prompt: 'Rank all eight, most important first', type: 'ranked-voting', options: Array.from({ length: 8 }, (_unused, index) => [`Priority number ${index + 1}`, null] as [string, null]) },
      { prompt: 'What would you change?', type: 'open-text-feedback', options: [] },
      { prompt: 'Scale: how confident are you in the plan?', type: 'confidence-continuum', options: [['Not confident', null], ['Fairly confident', null], ['Very confident', null]] },
      { prompt: 'Pick any: which channels do you use?', type: 'multi-select', options: [['Phone', null], ['Email', null], ['App', null], ['In person', null], ['Post', null]] },
      { prompt: 'True or false: the harbour opened in 1887.', type: 'true-false', options: [['True', true], ['False', false]] },
    ],
  });
  await ds.addSectionsToLiveSession('c-kroger', [extraId]);
  // Forty people with a written answer each (more than a card can show), a pick on the scale, any number of channels, and true or false.
  for (let index = 0; index < 40; index += 1) {
    const track = await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger');
    const answer = (questionId: string, value: unknown) => ({ questionId, answer: value, firstAnswer: value, attempts: 1, correct: null, answeredAt: new Date().toISOString() });
    await ds.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: 'c-kroger', responses: [
      { ...answer(`${extraId}-q2`, `Comment ${index + 1}: a sentence of some length about what to change`) },
      answer(`${extraId}-q3`, `${extraId}-q3-o${index % 3}`),
      answer(`${extraId}-q4`, [`${extraId}-q4-o${index % 5}`, `${extraId}-q4-o${(index + 2) % 5}`]),
      answer(`${extraId}-q5`, `${extraId}-q5-o${index % 2}`),
    ] });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await openAdmin(page, local);
  await page.getByRole('button', { name: 'Live display' }).click();
  await expect(cards(page).first()).toBeVisible();
  for (const size of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(size);
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect(display(page)).toHaveAttribute('data-presenting', 'true');
    await expect(cards(page)).toHaveCount(1);
    const scaleOfFirst = Number((await placed(page)).scale);
    const seen = new Map<string, number>();
    const kind = async (heading: string) => (heading.startsWith('part 1 of') ? 'long' : heading.startsWith('Rank all eight') ? 'ranking'
      : heading.startsWith('Scale:') ? 'scale' : heading.startsWith('Pick any') ? 'multi' : heading.startsWith('True or false') ? 'truefalse'
        : heading.startsWith('What would you change') && (await cards(page).locator('.words__comment').count()) > 5 ? 'written' : '');
    for (let guard = 0; guard < 40 && seen.size < 6; guard += 1) {
      const heading = (await cards(page).locator('.result-card__prompt').textContent()) ?? '';
      const which = await kind(heading);
      if (which && !seen.has(which)) {
        await page.waitForTimeout(1400); // the card is laid out again for each step the type is made smaller
        await shoot(page, `live-display-fit-${which}-${size.width}x${size.height}`, { full: false });
        // (A question of 1,700 characters leaves the chart little room, but the card is whole: that is what the shrinking is for.)
        const at = await expectWholeCard(page, `${size.width}x${size.height}: ${which}`, { chartAtLeast: which === 'long' ? 60 : which === 'scale' ? 80 : 140 });
        seen.set(which, Number(at.scale));
        if (which === 'written') {
          // 40 answers cannot all be shown, and the card says how many it left out instead of cutting them off without a word.
          await expect(cards(page).locator('.words__more')).toContainText(/\d+ more written answers are not shown/);
        }
      }
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(120);
    }
    expect([...seen.keys()].sort(), 'every kind was on the screen').toEqual(['long', 'multi', 'ranking', 'scale', 'truefalse', 'written']);
    expect(seen.get('long')!, 'the long question is smaller than an ordinary one, and whole').toBeLessThan(scaleOfFirst);
    await page.keyboard.press('Escape');
    await expect(display(page)).toHaveAttribute('data-presenting', 'false');
  }
});

test('Previous and Next, and the left and right arrow keys, walk the questions and go round at either end', async ({ page }) => {
  test.setTimeout(90_000);
  await liveKroger();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.clock.install({ time: new Date() });
  await openAdmin(page, local);
  await page.getByRole('button', { name: 'Live display' }).click();
  await expect(cards(page).first()).toBeVisible();
  const total = await cards(page).count();
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(display(page)).toHaveAttribute('data-presenting', 'true');
  const prompt = () => page.locator('.result-card__prompt').textContent();
  const place = () => page.locator('.live__eyebrow').textContent();
  const first = await prompt();
  expect(await place()).toContain(`Question 1 of ${total}`);
  const next = page.getByRole('button', { name: 'Next question' });
  const previous = page.getByRole('button', { name: 'Previous question' });

  await next.click();
  expect(await place()).toContain(`Question 2 of ${total}`);
  const second = await prompt();
  expect(second).not.toBe(first);
  await page.keyboard.press('ArrowRight');
  expect(await place()).toContain(`Question 3 of ${total}`);
  await page.keyboard.press('ArrowLeft');
  expect(await place()).toContain(`Question 2 of ${total}`);
  expect(await prompt()).toBe(second);
  await previous.click();
  expect(await prompt()).toBe(first);
  // Round again at either end.
  await previous.click();
  expect(await place()).toContain(`Question ${total} of ${total}`);
  await next.click();
  expect(await place()).toContain('Question 1 of');
  await page.keyboard.press('ArrowLeft');
  expect(await place()).toContain(`Question ${total} of ${total}`);
  await page.keyboard.press('ArrowRight');
  expect(await prompt()).toBe(first);
  // A key with a modifier is the browser's own (alt + arrow is Back), and moves nothing.
  await page.keyboard.press('Alt+ArrowRight');
  expect(await prompt()).toBe(first);

  // Moving about is not a request: with the page's clock held (so the display's own timer cannot fire), six moves send nothing.
  await holdClock(page);
  await page.waitForTimeout(800);
  const sent: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/')) sent.push(request.url()); });
  for (let index = 0; index < 6; index += 1) await next.click();
  await page.keyboard.press('ArrowLeft');
  expect(sent, 'seven moves, no request').toEqual([]);
  // The controls are targets of 44px or more.
  for (const control of [next, previous, page.getByRole('switch', { name: 'Auto-advance every 15 s' })]) {
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(43.5);
    expect(box.width).toBeGreaterThanOrEqual(43.5);
  }
});

test('the controls fade with the way out when the pointer is idle, and come back on any movement, a touch or a key', async ({ page }) => {
  await liveKroger();
  await page.setViewportSize({ width: 1280, height: 720 });
  await openAdmin(page, local);
  await page.getByRole('button', { name: 'Live display' }).click();
  await page.getByRole('button', { name: 'Full screen' }).click();
  const pager = page.locator('.live__pager');
  const exit = display(page).getByRole('button', { name: 'Exit full screen' });
  await expect(pager).toHaveCSS('opacity', '1');
  // Press Next with the mouse (that leaves the button focused, but not "focus-visible"): the controls still fade.
  await page.getByRole('button', { name: 'Next question' }).click();
  await expect(display(page)).toHaveAttribute('data-idle', 'true', { timeout: 8000 });
  await expect(pager).toHaveCSS('opacity', '0');
  await expect(exit).toHaveCSS('opacity', '0');
  expect(await display(page).evaluate((element) => getComputedStyle(element).cursor)).toBe('none');
  // The card does not move or change size when they fade: the room for them is kept.
  const before = (await placed(page)).card!;
  await page.mouse.move(600, 400);
  await expect(display(page)).toHaveAttribute('data-idle', 'false');
  await expect(pager).toHaveCSS('opacity', '1');
  await expect(exit).toHaveCSS('opacity', '1');
  const after = (await placed(page)).card!;
  expect([after.x, after.y, after.width, after.height]).toEqual([before.x, before.y, before.width, before.height]);
  // A key brings them back too (an arrow key moves, and shows them).
  await expect(display(page)).toHaveAttribute('data-idle', 'true', { timeout: 8000 });
  await page.keyboard.press('ArrowRight');
  await expect(display(page)).toHaveAttribute('data-idle', 'false');
  await expect(pager).toHaveCSS('opacity', '1');
  // A control reached by the keyboard stays in view while the rest fades: the way out, and then a control of the pager. (A key press came last, so a
  // script's focus() is a keyboard focus, as Tab would make it.)
  await page.keyboard.press('ArrowRight');
  await focusWithKeys(page, exit);
  await page.waitForTimeout(3400);
  await expect(display(page)).toHaveAttribute('data-idle', 'true');
  await expect(exit, 'the way out, reached by the keyboard, stays visible').toHaveCSS('opacity', '1');
  await expect(pager, 'while the controls fade').toHaveCSS('opacity', '0');
  await focusWithKeys(page, page.getByRole('button', { name: 'Previous question' }));
  await page.waitForTimeout(3400);
  await expect(pager, 'a control of the pager, reached by the keyboard, stays visible').toHaveCSS('opacity', '1');
});

test('Auto-advance is off until it is switched on, then moves to the next question every 15 seconds and goes round; a move by hand or a hidden tab holds it', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'it runs on Playwright\'s clock, as the other clock-driven specs do (WebKit drops the boundary of a fulfilled $batch)');
  test.setTimeout(90_000);
  await liveKroger();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.clock.install({ time: new Date() });
  await openAdmin(page, local);
  await page.getByRole('button', { name: 'Live display' }).click();
  await expect(cards(page).first()).toBeVisible();
  const total = await cards(page).count();
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(display(page)).toHaveAttribute('data-presenting', 'true');
  const place = async () => Number(((await page.locator('.live__eyebrow').textContent()) ?? '').match(/Question (\d+) of/)?.[1]);
  const auto = page.getByRole('switch', { name: 'Auto-advance every 15 s' });
  /** Moves the page's clock on, a second at a time so that what it asks the server for arrives. */
  const run = async (ms: number) => { for (let done = 0; done < ms; done += 1000) { await page.clock.runFor(Math.min(1000, ms - done)); await page.waitForTimeout(30); } };

  // Off by default: a minute goes by and nothing moves.
  await expect(auto).toHaveAttribute('aria-checked', 'false');
  await expect(auto).toContainText('Off');
  await run(60_000);
  expect(await place()).toBe(1);

  await auto.click();
  await expect(auto).toHaveAttribute('aria-checked', 'true');
  await expect(auto).toContainText('On');
  await run(14_000);
  expect(await place(), '14 s: not yet').toBe(1);
  await run(1_500);
  expect(await place(), '15 s: the next one').toBe(2);
  await run(15_000);
  expect(await place()).toBe(3);

  // A move by hand starts the 15 seconds again, so the question you went to is not taken away at once.
  await run(10_000);
  await page.keyboard.press('ArrowRight');
  expect(await place()).toBe(4);
  await run(14_000);
  expect(await place(), '14 s after a move by hand').toBe(4);
  await run(1_500);
  expect(await place()).toBe(5);

  // A hidden tab holds it; shown again, it starts a fresh 15 seconds.
  await setHidden(page, true);
  await run(60_000);
  expect(await place(), 'a minute hidden: it did not move').toBe(5);
  await setHidden(page, false);
  await run(14_000);
  expect(await place(), 'shown again: a fresh 15 s').toBe(5);
  await run(1_500);
  expect(await place()).toBe(6);

  // It goes round: from the last to the first.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  expect(await place(), 'from 6, six back: the last').toBe(total);
  await run(15_500);
  expect(await place(), 'and then round to the first').toBe(1);

  // Switched off again, it stops; leaving full screen puts it back to off.
  await auto.click();
  await expect(auto).toHaveAttribute('aria-checked', 'false');
  await run(60_000);
  expect(await place()).toBe(1);
  await auto.click();
  await page.keyboard.press('Escape');
  await expect(display(page)).toHaveAttribute('data-presenting', 'false');
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(page.getByRole('switch', { name: 'Auto-advance every 15 s' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.live__eyebrow')).toContainText('Question 1 of');
});

// ---- The exports, from the admin page --------------------------------------------------------------------------------

test('Export CSV downloads exactly the rows the tally has, through the one reader of answers', async ({ page }) => {
  const live = await liveKroger();
  await openAdmin(page, local);
  await page.getByRole('button', { name: 'Live display' }).click();
  await expect(meta(page)).toContainText(/7 answers/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`results-${live.session.id}-${new Date().toISOString().slice(0, 10)}.csv`);
  const text = (await readFile((await file.path())!, 'utf8')).replace(/^﻿/, '');
  // What the exporter writes for the session as dataService reads it now: the same file, to the byte.
  expect(text).toBe(resultsToCsv(await readSessionResults(live.session.id)));
  expect(text.split('\r\n')[0]).toBe('Activity,Question,Type,Option,Count,Percentage,Score,Respondents');
  expect(text).toContain('Great Western Tea co.,2,66.7,,3');
  expect(text).toContain('Faster check-in');
  await expect(page.getByText(/^Saved results-.*\.csv$/).first()).toBeVisible();
});

test('Export PDF and Export PPT download real files from the admin page, branded with the session\'s client and this product\'s name', async ({ page }) => {
  const live = await liveKroger();
  await openAdmin(page, local);
  await page.getByRole('button', { name: 'Live display' }).click();
  await expect(meta(page)).toContainText(/7 answers/);

  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF' }).click();
  const pdf = await readFile(((await (await pdfDownload).path()))!);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  const pdfText = pdf.toString('latin1');
  expect(pdfText).toContain('/Creator (Pursuit Managed Services)');
  expect(pdfText).toContain('Kroger');
  expect(pdfText).toContain("Kroger's History");
  expect(pdf.length).toBeGreaterThan(5000);

  const pptDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PPT' }).click();
  const file = await pptDownload;
  expect(file.suggestedFilename()).toBe(`results-${live.session.id}-${new Date().toISOString().slice(0, 10)}.pptx`);
  const archive = await JSZip.loadAsync(await readFile((await file.path())!));
  const slide = await archive.file('ppt/slides/slide1.xml')!.async('string');
  expect(slide).toContain('Kroger');
  expect(slide).toContain(Object.values(legacyColours({ primary: '#045BCC' }))[0].slice(1)); // the theme's page colour is in the slide
  expect(await archive.file('docProps/app.xml')!.async('string')).toContain('<Company>Pursuit Managed Services</Company>');
  // Neither export left the page in a bad state.
  await expect(page.getByRole('button', { name: 'Export PPT' })).toBeEnabled();
  await expect(page.locator('.live__status[role="alert"]')).toHaveCount(0);
});

test('each session\'s exports use that session\'s client colours: Domino\'s PPT is Domino\'s, not the live client\'s', async ({ page }) => {
  await liveKroger();
  const { session: dominos } = await ds.activateClient('c-dominos', today);
  await useServer(page, local);
  await page.goto(`${adminUrl}#live-display/kroger-${today}`);
  await unlock(page);
  await expect(page.locator('.live__client')).toHaveText('Kroger');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PPT' }).click();
  const slide = await (await JSZip.loadAsync(await readFile(((await (await download).path()))!))).file('ppt/slides/slide1.xml')!.async('string');
  expect(slide).toContain('Kroger');
  expect(slide).not.toContain("Domino's");
  expect(dominos.id).toBe(`dominos-${today}`);
});

// ---- The old address, and addresses of the display --------------------------------------------------------------------

test('the old participant address #/master-results/<id> only says where results went, reads nothing, and links to the admin page in the same folder', async ({ page }) => {
  const live = await liveKroger();
  const requests = await useServer(page, local);
  await page.goto(`${participantUrl}#/master-results/${live.session.id}`);
  await expect(page.getByRole('heading', { name: 'Results have moved to the admin page' })).toBeVisible();
  const link = page.getByRole('link', { name: 'Open the live display' });
  const href = (await link.getAttribute('href'))!;
  expect(href).toBe(new URL(`admin.html#live-display/${live.session.id}`, page.url()).href);
  expect(new URL(href).pathname).toBe(adminUrl);
  // It sent no request to the API at all, and the page carries none of the export code.
  expect(requests, 'the notice reads nothing').toEqual([]);
  expect(await page.evaluate(() => ({ jspdf: typeof (window as unknown as { jspdf?: unknown }).jspdf, pptx: typeof (window as unknown as { PptxGenJS?: unknown }).PptxGenJS, charts: document.querySelectorAll('canvas').length }))).toEqual({ jspdf: 'undefined', pptx: 'undefined', charts: 0 });
  await expect(page.getByRole('button', { name: /Export/ })).toHaveCount(0);
  // With no session in the address it points at the display of whatever is live.
  await page.goto(`${participantUrl}#/master-results`);
  await expect(page.getByTestId('moved-link')).toHaveAttribute('href', new URL('admin.html#live-display', page.url()).href);
  // The link works: the admin page asks for its PIN, and then opens the display.
  await page.getByTestId('moved-link').click();
  await unlock(page);
  await expect(page.getByRole('heading', { name: 'Live results' })).toBeVisible();
  await expect(meta(page)).toContainText(/7 answers from 3 iPads/);
  await shoot(page, 'live-display-moved-notice-phone', { full: false });
});

test('the notice on a phone and a desktop: nothing scrolls sideways', async ({ page }) => {
  const live = await liveKroger();
  await useServer(page, local);
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`${participantUrl}#/master-results/${live.session.id}`);
    await expect(page.getByRole('heading', { name: 'Results have moved to the admin page' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shoot(page, `live-display-moved-notice-${viewport.width}`, { full: false });
  }
});

test('the address #live-display opens whichever session is live, and a picker when none is; #live-display/<id> opens that session; an unknown id says so', async ({ page, browser }) => {
  const live = await liveKroger();
  await useServer(page, local);
  await page.goto(`${adminUrl}#live-display`);
  await unlock(page);
  await expect(page.getByRole('heading', { name: 'Live results' })).toBeVisible();
  await expect(page.locator('.live__client')).toHaveText('Kroger');
  await expect(meta(page)).toContainText(/7 answers from 3 iPads/);
  // A reload (after the PIN) comes back to it.
  await page.reload();
  await unlock(page);
  await expect(meta(page)).toContainText(/7 answers from 3 iPads/);

  // Nothing live: a list of sessions to choose from, and choosing one opens it.
  await ds.updateAppSettings({ activeSessionId: null, activeClientId: null });
  const second = await another(browser, local);
  await second.page.goto(`${adminUrl}#live-display`);
  await unlock(second.page);
  await expect(second.page.getByRole('status').filter({ hasText: 'Nothing is live. Choose a session.' })).toBeVisible();
  await second.page.getByRole('button', { name: new RegExp(`Kroger · ${today}`) }).click();
  await expect(second.page.getByRole('heading', { name: 'Live results' })).toBeVisible();
  await expect(second.page).toHaveURL(new RegExp(`#live-display/${live.session.id}$`));
  await expect(second.page.locator('.live__meta')).toContainText(/7 answers from 3 iPads/);
  await second.context.close();

  // A session that does not exist: a clear message and a way to try again.
  await page.goto('about:blank');
  await page.goto(`${adminUrl}#live-display/no-such-session`);
  await unlock(page);
  await expect(page.getByRole('alert')).toContainText('That session no longer exists');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  // An address changed by hand in a tab that is already open is followed: no reload, no new PIN.
  await page.evaluate((hash) => { window.location.hash = hash; }, `#live-display/${live.session.id}`);
  await expect(page.getByRole('heading', { name: 'Live results' })).toBeVisible();
  await expect(meta(page)).toContainText(/7 answers from 3 iPads/);
  await page.evaluate(() => { window.location.hash = '#clients'; });
  await expect(page.getByRole('tab', { name: 'Clients' })).toHaveAttribute('aria-selected', 'true');
  await expect(display(page)).toHaveCount(0);
});

test('"Open in a new tab" is a link to the same session\'s wall display on the admin page, and a tab opened from it shows it after the PIN', async ({ page, context }) => {
  const live = await liveKroger();
  await openAdmin(page, local);
  await page.getByRole('button', { name: 'Live display' }).click();
  const link = page.getByRole('link', { name: 'Open in a new tab' });
  await expect(link).toHaveAttribute('target', '_blank');
  // Phase 11a: the new tab is the wall (no names in it), told apart from the facilitator's own view by the end of its address.
  expect(new URL((await link.getAttribute('href'))!).hash).toBe(`#live-display/${live.session.id}/wall`);
  const [tab] = await Promise.all([context.waitForEvent('page'), link.click()]);
  await useServer(tab, local);
  await unlock(tab);
  await expect(tab.getByRole('heading', { name: 'Live results · Wall display' })).toBeVisible();
  await expect(tab.getByRole('switch', { name: /Names shown/ })).toHaveCount(0);
  await expect(tab.locator('.live__meta')).toContainText(/7 answers from 3 iPads/);
});

test('every capability the Master screen had is in the Live display: live tally, counts, brand colours, Full screen, CSV, PDF, PowerPoint, a session picker, Try again', async ({ page }) => {
  await liveKroger();
  await openAdmin(page, local);
  await page.getByRole('button', { name: 'Live display' }).click();
  await expect(meta(page)).toContainText(/\d+ answers from \d+ iPads · updated /);
  for (const name of ['Export CSV', 'Export PDF', 'Export PPT', 'Full screen']) await expect(page.getByRole('button', { name })).toBeEnabled();
  await expect(display(page).locator(`.result-card :is(${CHART})`).first()).toBeVisible();
  expect((await brandOf(page))[0]).toMatch(/^#[0-9A-F]{6}$/);
});
