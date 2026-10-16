import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ds, openAdmin, startLocal, stopLocal, type Local } from './admin-local.js';
import { seedBigCharts, seedVine } from '../results-charts-fixtures.js';
import { chartProblems, emptyRoom, fitProblems, scrollProblems, tipProblems } from './results-charts-support.js';

// Phase 11a-2, part B: the charts fit their card and their tooltips are never cut off. On the real site (16 Oct 2026, a Windows laptop in Chrome) a
// confidence question in full screen had a scrollbar inside its chart, its tooltip ("2 people · 100%") cut off at the chart's bottom edge and lying over
// the middle step's label, and an empty white space under the chart; and on the admin view a card stretched to the height of its neighbour whose names
// were open. The cause (RELEASE-11A2.md): the scale's frame had `overflow-x: auto`, which makes a box scroll both ways, and its tooltip was drawn inside
// it; the full-screen card was as tall as the screen while the plot kept a fixed height; the grid stretched its cards.
//
// The BUILT admin page against the REAL local server, in all three engines, at the sizes the brief lists (and 1536x864 at device scale 1.25 and 1.5, a
// Windows laptop's usual scaling), in full screen and on the wall page, with VJR's confidence question (v4: 0, 2, 0) and ranking (v5), and the large
// session's single choice with eight answers of 90 characters (w1): nothing inside a card scrolls or cuts anything off; every mark's tooltip is whole
// inside the window, seen at each of its corners, and clear of the mark's own label; the chart takes the room its card gives it; a screen on its side
// shows the question with nothing to scroll, and a question that cannot fit a screen held upright makes the screen scroll as one page and says "More
// below". The wall's rule of Phase 11a (no name in the page) is results-charts-names.spec.ts's, unchanged. Pictures go to test-results/charts/fit-*.png.

const pictures = fileURLToPath(new URL('../../test-results/charts/', import.meta.url));
const SIZES = [
  { width: 1366, height: 768, scale: 1 }, { width: 1440, height: 900, scale: 1 }, { width: 1536, height: 864, scale: 1 }, { width: 1600, height: 900, scale: 1 },
  { width: 1920, height: 1080, scale: 1 }, { width: 1280, height: 800, scale: 1 }, { width: 1024, height: 768, scale: 1 }, { width: 820, height: 1180, scale: 1 },
  { width: 390, height: 844, scale: 1 }, { width: 1536, height: 864, scale: 1.25 }, { width: 1536, height: 864, scale: 1.5 },
] as const;
type Size = (typeof SIZES)[number];
const named = (size: Size) => `${size.width}x${size.height}${size.scale === 1 ? '' : `@${size.scale}`}`;
const PICTURED = new Set(['1536x864', '1366x768', '1536x864@1.25', '390x844']);
/** The questions, by session: VJR's confidence scale and ranking, and the large session's eight answers of 90 characters. */
const QUESTIONS = { vine: ['v4', 'v5'], big: ['w1'] } as const;

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });

let local: Local;
const sessions = { vine: '', big: '' };
test.beforeAll(async () => {
  test.setTimeout(240_000);
  local = await startLocal();
  sessions.big = (await seedBigCharts(ds)).session.id;
  sessions.vine = (await seedVine(ds)).session.id;
  await mkdir(pictures, { recursive: true });
});
test.afterAll(async () => { await stopLocal(local); });

/** A page of its own at `size` (its device scale too), with the display's own cover for full screen, as on an iPad (see results-charts-layout.spec.ts). */
async function pageAt(browser: Browser, size: Size) {
  const context = await browser.newContext({ baseURL: String(test.info().project.use.baseURL), viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale });
  await context.addInitScript(() => {
    for (const name of ['requestFullscreen', 'webkitRequestFullscreen']) Object.defineProperty(Element.prototype, name, { value: undefined, configurable: true });
  });
  const page = await context.newPage();
  await openAdmin(page, local);
  return page;
}

/** Waits until the display has drawn its bars and finished making the type smaller (the scale and the card's height stop changing). */
async function settle(page: Page) {
  let last = '';
  for (let step = 0; step < 30; step += 1) {
    await page.waitForTimeout(120);
    const now = await page.evaluate(() => {
      const live = document.querySelector('section.live');
      const card = document.querySelector('.result-card');
      return `${live ? getComputedStyle(live).getPropertyValue('--chart-scale') : ''}|${live?.className}|${card?.getBoundingClientRect().height}`;
    });
    if (now === last && step >= 4) return;
    last = now;
  }
}

async function openDisplay(page: Page, sessionId: string, wall = false) {
  await page.evaluate((hash) => { window.location.hash = hash; }, `#live-display/${sessionId}${wall ? '/wall' : ''}`);
  await expect(page.locator('.result-card').first()).toBeVisible();
  await settle(page);
}

async function fullScreenAt(page: Page, questionId: string) {
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(page.locator('section.live')).toHaveAttribute('data-presenting', 'true');
  for (let step = 0; step < 16; step += 1) {
    if ((await page.locator('section.live[data-presenting="true"] .result-card').getAttribute('data-question')) === questionId) break;
    await page.getByRole('button', { name: 'Next question' }).click();
  }
  await expect(page.locator('section.live[data-presenting="true"] .result-card')).toHaveAttribute('data-question', questionId);
  await settle(page);
}

/** A pointer on every mark of the card of `questionId`, in turn: what is wrong with its tooltip. */
async function everyTip(page: Page, questionId: string) {
  const problems: string[] = [];
  const marks = page.locator(`.result-card[data-question="${questionId}"] [data-mark]`);
  for (let index = 0; index < await marks.count(); index += 1) {
    const mark = marks.nth(index);
    const id = (await mark.getAttribute('data-mark')) ?? '';
    await mark.hover();
    await expect(mark).toHaveAttribute('aria-describedby', /tip/);
    await page.waitForTimeout(80); // placed after the browser has drawn it (and after a scroll that brought the mark into view)
    problems.push(...await tipProblems(page, id));
  }
  await page.mouse.move(1, 1);
  return problems;
}

/** Is the screen in full screen scrolling as one page, how far, and does it say "More below"? */
const screenState = (page: Page) => page.evaluate(() => {
  const live = document.querySelector<HTMLElement>('section.live')!;
  const more = document.querySelector<HTMLElement>('[data-testid="more-below"]');
  return { spills: live.classList.contains('live--spill'), scrolls: live.scrollHeight > live.clientHeight + 1, more: !!more && getComputedStyle(more).visibility !== 'hidden' };
});

for (const fixture of ['vine', 'big'] as const) {
  test(`full screen, ${fixture === 'vine' ? "VJR's scale and ranking" : 'eight answers of 90 characters'}: at every size, nothing scrolls inside the card, the chart fills it, every tooltip is whole and clear of its label`, async ({ browser, browserName }) => {
    test.setTimeout(600_000);
    const problems: string[] = [];
    for (const size of SIZES) {
      const page = await pageAt(browser, size);
      await openDisplay(page, sessions[fixture]);
      for (const questionId of QUESTIONS[fixture]) {
        await fullScreenAt(page, questionId);
        const where = `${named(size)}, full screen, ${questionId}`;
        const landscape = size.width > size.height;
        const state = await screenState(page);
        if (landscape || !state.spills) {
          // A screen on its side (and anything that fits) shows the whole question with nothing to scroll.
          expect(state, `${where}: nothing to scroll`).toEqual({ spills: false, scrolls: false, more: false });
          problems.push(...(await fitProblems(page)).map((problem) => `${where}: ${problem}`));
          problems.push(...(await emptyRoom(page, { plot: true })).map((problem) => `${where}: ${problem}`));
        } else {
          // Too long for a screen held upright even at the smallest type: the screen scrolls as one page and says so; the card cuts nothing off.
          expect(state, `${where}: the screen scrolls as one page and says "More below"`).toEqual({ spills: true, scrolls: true, more: true });
          await page.locator('section.live').evaluate((element) => { element.scrollTop = element.scrollHeight; });
          await expect(page.getByTestId('more-below'), `${where}: no "More below" at the end`).toBeHidden();
          problems.push(...(await chartProblems(page)).map((problem) => `${where}: ${problem}`));
          await page.locator('section.live').evaluate((element) => { element.scrollTop = 0; });
        }
        problems.push(...(await scrollProblems(page)).map((problem) => `${where}: ${problem}`));
        problems.push(...(await everyTip(page, questionId)).map((problem) => `${where}: ${problem}`));
        if (browserName === 'chromium' && PICTURED.has(named(size))) {
          const middle = page.locator(`.result-card[data-question="${questionId}"] [data-mark]`).nth(questionId === 'v4' ? 1 : 0);
          await middle.hover();
          await page.waitForTimeout(450);
          await page.screenshot({ path: `${pictures}fit-full-${questionId}-${named(size)}.png` });
          await page.mouse.move(1, 1);
        }
        await page.keyboard.press('Escape');
        await expect(page.locator('section.live')).toHaveAttribute('data-presenting', 'false');
      }
      await page.context().close();
    }
    expect(problems).toEqual([]);
  });

  test(`the wall page, ${fixture === 'vine' ? "VJR's run" : 'eight answers of 90 characters'}: at every size, nothing scrolls inside a card, no card stretches, every tooltip is whole and clear of its label`, async ({ browser, browserName }) => {
    test.setTimeout(600_000);
    const problems: string[] = [];
    for (const size of SIZES) {
      const page = await pageAt(browser, size);
      await openDisplay(page, sessions[fixture], true);
      const where = `${named(size)}, wall page`;
      problems.push(...(await scrollProblems(page)).map((problem) => `${where}: ${problem}`));
      problems.push(...(await emptyRoom(page)).map((problem) => `${where}: ${problem}`));
      problems.push(...(await chartProblems(page)).map((problem) => `${where}: ${problem}`));
      for (const questionId of QUESTIONS[fixture]) {
        problems.push(...(await everyTip(page, questionId)).map((problem) => `${where}, ${questionId}: ${problem}`));
        if (browserName === 'chromium' && PICTURED.has(named(size)) && questionId === 'v4') {
          const card = page.locator('.result-card[data-question="v4"]');
          await card.locator('[data-mark]').nth(1).hover();
          await page.waitForTimeout(450);
          await page.screenshot({ path: `${pictures}fit-wall-page-v4-${named(size)}.png` });
          await page.mouse.move(1, 1);
        }
      }
      await page.context().close();
    }
    expect(problems).toEqual([]);
  });
}

test('the admin view: every tooltip of every chart is whole, seen at its corners and clear of its label, at a laptop and a phone', async ({ browser }) => {
  test.setTimeout(240_000);
  const problems: string[] = [];
  for (const size of [{ width: 1280, height: 800, scale: 1 }, { width: 390, height: 844, scale: 1 }] as const) {
    const page = await pageAt(browser, size as unknown as Size);
    await openDisplay(page, sessions.vine);
    problems.push(...(await scrollProblems(page)).map((problem) => `${size.width}x${size.height}: ${problem}`));
    for (const questionId of ['v1', 'v2', 'v3', 'v4', 'v5']) problems.push(...(await everyTip(page, questionId)).map((problem) => `${size.width}x${size.height}, admin view, ${questionId}: ${problem}`));
    // Each numbers view, too: no box in it scrolls.
    const buttons = page.getByRole('button', { name: 'View as table' });
    const count = await buttons.count();
    for (let index = 0; index < count; index += 1) await buttons.first().click();
    problems.push(...(await scrollProblems(page)).map((problem) => `${size.width}x${size.height}, the numbers views: ${problem}`));
    await page.context().close();
  }
  expect(problems).toEqual([]);
});

test('a card beside one with its names open keeps its own height, on the Live display and on Results', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await pageAt(browser, { width: 1280, height: 900, scale: 1 });
  await openDisplay(page, sessions.vine);
  const box = (questionId: string, scope = 'section.live') => page.locator(`${scope} .result-card[data-question="${questionId}"]`).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: Math.round(rect.top + window.scrollY), height: Math.round(rect.height) };
  });
  for (const scope of ['section.live', `article[data-session="${sessions.vine}"]`]) {
    if (scope !== 'section.live') {
      await page.getByRole('button', { name: '← Results' }).click();
      await page.locator(`${scope} summary`).click();
      await expect(page.locator(`${scope} .result-card`).first()).toBeVisible();
      await settle(page);
    }
    // v1 and v2 share a row at this width.
    const [first, second] = [await box('v1', scope), await box('v2', scope)];
    expect(first.top, `${scope}: v1 and v2 are in one row`).toBe(second.top);
    await page.locator(`${scope} .result-card[data-question="v1"] [data-mark]`).first().click();
    await expect(page.locator(`${scope} .result-card[data-question="v1"]`).getByTestId('names-panel')).toBeVisible();
    const [opened, beside] = [await box('v1', scope), await box('v2', scope)];
    expect(opened.height, `${scope}: the card with its names open is taller`).toBeGreaterThan(first.height + 40);
    expect(beside, `${scope}: the card beside it keeps its own place and height`).toEqual(second);
    expect(await emptyRoom(page), `${scope}: no card has empty room under its last piece`).toEqual([]);
    await page.keyboard.press('Escape');
  }
  await page.context().close();
});

test('a refresh leaves full screen as it was: the type does not jump back to full size, nor a long page to its top', async ({ browser }) => {
  test.setTimeout(120_000);
  // The large session's first question on a phone held upright is made as small as the type goes, and then the screen scrolls as one page. The local
  // server is looked at every 2.5 seconds: two refreshes in the six seconds watched, each a new set of objects for the same question. Every change the
  // page makes to the display's size of type or to its scrolling is written down as it is made (a jump back would be undone a moment later, too fast
  // for anyone to look at it and catch it).
  const page = await pageAt(browser, { width: 390, height: 844, scale: 1 });
  await openDisplay(page, sessions.big);
  await fullScreenAt(page, 'w1');
  await page.locator('section.live').evaluate((element) => { element.scrollTop = 120; });
  const before = await page.locator('section.live').evaluate((element) => ({ scale: getComputedStyle(element).getPropertyValue('--chart-scale'), top: element.scrollTop }));
  await page.locator('section.live').evaluate((element) => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    new MutationObserver(() => seen.push(`${getComputedStyle(element).getPropertyValue('--chart-scale')} ${element.className.replace(/\s*svelte-\w+/g, '')}`)).observe(element, { attributes: true, attributeFilter: ['style', 'class'] });
  });
  const updated = await page.locator('.live__meta').textContent();
  await page.waitForTimeout(6_000);
  expect(await page.locator('.live__meta').textContent(), 'the display was refreshed meanwhile').not.toBe(updated);
  expect(await page.evaluate(() => (window as unknown as { seen: string[] }).seen), 'no change to the size of type or to the page').toEqual([]);
  expect(await page.locator('section.live').evaluate((element) => ({ scale: getComputedStyle(element).getPropertyValue('--chart-scale'), top: element.scrollTop })), 'the same type and the same place').toEqual(before);
  await page.context().close();
});

test('eight answers of 90 characters in full screen are never cut off: upright screens, and wide screens too short for them, fit whole or scroll as one page', async ({ browser }) => {
  test.setTimeout(300_000);
  // Phase 11a-3, item E. The type is made smaller a step at a time while the card does not fit, down to 0.75, and past that the screen scrolls as one
  // page. Until 11a-3 each step's fit factor stopped at 0.5, so a window 1,550 px wide or more (type 1.6 to 2.4) stopped at type 0.8 or above, neither
  // smaller nor spilling, and the card was cut at its edge: 1920x600 and 1600x700 are such windows. 768x1024 and 1080x1920 are screens held upright.
  const problems: string[] = [];
  for (const size of [{ width: 1920, height: 600, scale: 1 }, { width: 1600, height: 700, scale: 1 }, { width: 768, height: 1024, scale: 1 }, { width: 1080, height: 1920, scale: 1 }]) {
    const page = await pageAt(browser, size as unknown as Size);
    await openDisplay(page, sessions.big);
    await fullScreenAt(page, 'w1');
    const where = `${size.width}x${size.height}, full screen, w1`;
    const state = await screenState(page);
    if (!state.spills) {
      expect(state, `${where}: it fits, with nothing to scroll`).toEqual({ spills: false, scrolls: false, more: false });
      problems.push(...(await fitProblems(page)).map((problem) => `${where}: ${problem}`));
    } else {
      expect(state, `${where}: the screen scrolls as one page and says "More below"`).toEqual({ spills: true, scrolls: true, more: true });
      expect(await page.locator('section.live').evaluate((element) => getComputedStyle(element).getPropertyValue('--chart-scale').trim()), `${where}: it spills only at the smallest type`).toBe('0.75');
      problems.push(...(await chartProblems(page)).map((problem) => `${where}: ${problem}`));
    }
    problems.push(...(await scrollProblems(page)).map((problem) => `${where}: ${problem}`));
    await page.context().close();
  }
  expect(problems).toEqual([]);
});
