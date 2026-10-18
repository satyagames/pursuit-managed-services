import { test, expect, type Page } from '@playwright/test';
import { choices, nextButton, openParticipant, settle, themedSite, THEMES, walkParticipant } from './a11y-support.js';
import { pageUrl, serveSharePoint } from './sharepoint.js';

// Phase 15, part 2: the motion plan as the participant page carries it out, read from the page itself. A MutationObserver records every shape
// lib/motion/motion.ts writes (`data-motion`) and on what; the spec then holds, for each kind of question, the sides the answers arrive from,
// that Back mirrors Next, that a tap during an entrance is taken at once, that three quick Nexts end on the right question with nothing left
// moving, that a re-render does not replay an entrance, that only transform and opacity are animated, and that when the motion ends every
// answer is exactly where it is with motion off.

type Shape = { shape: string; cls: string; index: number; at: number };

/** Records every shape written, on what (its classes, or its tag) and its place among its siblings. */
async function recordShapes(page: Page) {
  await page.addInitScript(() => {
    const log: Shape[] = [];
    (window as unknown as { __shapes: Shape[] }).__shapes = log;
    new MutationObserver((records) => {
      for (const record of records) {
        const element = record.target as HTMLElement;
        const shape = element.getAttribute('data-motion');
        if (!shape) continue;
        const cls = [...element.classList].filter((name) => !name.startsWith('svelte-')).join('.') || element.tagName.toLowerCase();
        log.push({ shape, cls, index: element.parentElement ? [...element.parentElement.children].indexOf(element) : -1, at: performance.now() });
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-motion'] });
  });
}
const shapesSince = async (page: Page, from: number) => (await page.evaluate(() => (window as unknown as { __shapes: Shape[] }).__shapes)).slice(from);
const logLength = async (page: Page) => page.evaluate(() => (window as unknown as { __shapes: Shape[] }).__shapes.length);
const of = (entries: Shape[], cls: string) => entries.filter((entry) => entry.cls.split('.').includes(cls));
const optionShapes = (entries: Shape[]) => of(entries, 'option-pill').filter((entry) => !['pop', 'nudge'].includes(entry.shape)).sort((a, b) => a.index - b.index).map((entry) => entry.shape);
const ALTERNATE = (count: number) => Array.from({ length: count }, (_, index) => (index % 2 === 0 ? 'from-left' : 'from-right'));

test('every kind of question: the question and its answers arrive from the planned sides, verdicts pop or nudge, cards settle, the hub rises', async ({ page }) => {
  test.setTimeout(150_000);
  await recordShapes(page);
  const { fake, pack } = await themedSite({ theme: 'kroger' });
  await openParticipant(page, fake);
  const seen = new Map<string, Shape[]>();
  let mark = 0;
  await walkParticipant(page, { pack, clientId: THEMES.kroger.clientId }, async (state) => {
    const length = await logLength(page);
    seen.set(state, await shapesSince(page, mark));
    mark = length;
  });

  expect(seen.get('welcome'), 'the first screen after the page loads does not move').toEqual([]);
  const hub = seen.get('hub: a current activity and a locked one')!;
  expect(of(hub, 'pms-head').map((entry) => entry.shape)).toEqual(['rise']);
  expect(of(hub, 'pms-divider').map((entry) => entry.shape)).toEqual(['draw-x']);
  expect(of(hub, 'li').map((entry) => entry.shape).every((shape) => shape === 'rise')).toBe(true);
  expect(of(hub, 'li').length).toBeGreaterThanOrEqual(2);

  const first = seen.get('question, unanswered')!;
  expect(of(first, 'pms-question').map((entry) => entry.shape), 'from the hub, the question rises').toEqual(['rise']);
  const firstOptions = optionShapes(first);
  expect(firstOptions).toEqual(ALTERNATE(firstOptions.length));
  expect(of(seen.get('question, wrong, with Retry')!, 'option-pill').map((entry) => entry.shape)).toContain('nudge');
  const correct = seen.get('question, correct')!;
  expect(of(correct, 'pms-question').map((entry) => entry.shape), 'Next: the next question comes from the right').toEqual(['from-right']);
  expect(of(correct, 'option-pill').map((entry) => entry.shape)).toContain('pop');
  expect(of(seen.get('activity done')!, 'pms-complete').map((entry) => entry.shape)).toEqual(['settle']);

  const multi = seen.get('multiple choice, unanswered')!;
  expect(optionShapes(multi), 'multiple choice alternates left and right').toEqual(ALTERNATE(4));
  expect(of(seen.get('multiple choice, two picked')!, 'option-pill').map((entry) => entry.shape), 'a tick pops').toEqual(['pop', 'pop']);
  expect(optionShapes(seen.get('true or false, correct')!), 'true or false converge from both sides').toEqual(['converge-left', 'converge-right']);
  expect(optionShapes(seen.get('confidence, one picked')!), 'a scale comes in from the left, in order').toEqual(['from-left', 'from-left', 'from-left']);
  expect(optionShapes(seen.get('ranking, unranked')!), 'a ranking alternates').toEqual(ALTERNATE(3));
  expect(of(seen.get('written answer, empty')!, 'pms-text').map((entry) => entry.shape), 'the text box rises').toEqual(['rise']);
  expect(of(seen.get('finale')!, 'pms-final').map((entry) => entry.shape)).toEqual(['settle']);

  // Once it has all ended nothing is left: no animation, no shape attribute.
  await settle(page);
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => String((animation as CSSAnimation).animationName ?? '').startsWith('motion-')).length)).toBe(0);
  expect(await page.locator('[data-motion]').count()).toBe(0);
});

test('a re-render does not replay an entrance: answering, and the hub reading its activities again, move nothing that is already there', async ({ page }) => {
  test.setTimeout(90_000);
  await recordShapes(page);
  const { fake } = await themedSite({ theme: 'kroger' });
  await openParticipant(page, fake);
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  const pills = page.locator('.pms-activities li');
  await expect(pills.first()).toBeVisible();
  await page.waitForTimeout(1500); // the hub's own fresh read lands and redraws the pills
  const rows = await pills.count();
  expect(of(await shapesSince(page, 0), 'li').length, 'each row came in once').toBe(rows);
});

/** The `?preview=<clientId>` page: walks to the activity of every other kind of question, read-only, with Next and Back. */
async function previewTypes(page: Page) {
  const { fake } = await themedSite({ theme: 'kroger', live: false });
  await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('index.html')}?preview=${THEMES.kroger.clientId}`);
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await page.getByRole('button', { name: /^More question types/ }).click();
  await expect(page.getByRole('progressbar', { name: 'Question 1 of 5' })).toBeVisible();
}

test('Back mirrors Next, part for part; three quick Nexts end on the right question with nothing left moving', async ({ page }) => {
  test.setTimeout(90_000);
  await recordShapes(page);
  await previewTypes(page);
  await settle(page);
  let from = await logLength(page);
  await nextButton(page).click();
  await expect(page.getByRole('progressbar', { name: 'Question 2 of 5' })).toBeVisible();
  const forward = await shapesSince(page, from);
  expect(of(forward, 'pms-question').map((entry) => entry.shape)).toEqual(['from-right']);
  expect(optionShapes(forward)).toEqual(['converge-left', 'converge-right']);
  await settle(page);
  from = await logLength(page);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Question 1 of 5' })).toBeVisible();
  const back = await shapesSince(page, from);
  expect(of(back, 'pms-question').map((entry) => entry.shape), 'Back: the question comes from the left').toEqual(['from-left']);
  expect(optionShapes(back), 'and the answers from the other sides').toEqual(ALTERNATE(4).map((shape) => (shape === 'from-left' ? 'from-right' : 'from-left')));

  // Three Nexts as fast as a thumb can: the page ends on question 4, settled, with nothing running and nothing left behind.
  for (let press = 0; press < 3; press += 1) await nextButton(page).click({ noWaitAfter: true });
  await expect(page.getByRole('progressbar', { name: 'Question 4 of 5' })).toBeVisible();
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length), 'nothing is still running').toBe(0);
  expect(await page.locator('[data-motion]').count()).toBe(0);
  await expect(page.locator('.pms-question')).toContainText('Rank these topics');
});

test('a tap during an entrance is taken at once, and only transform and opacity are animated', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'slows the animations through the DevTools protocol (Animation.setPlaybackRate), which only Chromium has');
  test.setTimeout(90_000);
  const { fake } = await themedSite({ theme: 'kroger' });
  await openParticipant(page, fake);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.05 });
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await page.getByRole('button', { name: /^Kroger trivia/ }).or(page.locator('.pms-activities button').first()).first().click();
  const first = choices(page).first();
  await first.waitFor();
  const moving = await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running' && String((animation as CSSAnimation).animationName).startsWith('motion-')).length);
  expect(moving, 'the answers are still coming in (20 times slower than real)').toBeGreaterThan(0);
  const box = await first.boundingBox();
  const started = Date.now();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(first).toHaveAttribute('data-state', /correct|incorrect/, { timeout: 1500 });
  expect(Date.now() - started, 'answered without waiting for the motion to end').toBeLessThan(1500);
  const properties = await page.evaluate(() => [...new Set(document.getAnimations()
    .filter((animation) => String((animation as CSSAnimation).animationName ?? '').startsWith('motion-'))
    .flatMap((animation) => (animation.effect as KeyframeEffect).getKeyframes().flatMap((frame) => Object.keys(frame)))
    .filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)))]);
  expect(properties.length).toBeGreaterThan(0);
  expect(properties.filter((name) => !['transform', 'opacity'].includes(name)), 'compositor properties only').toEqual([]);
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
});

test('when the motion has ended every answer is exactly where it is with motion off', async ({ browser }) => {
  test.setTimeout(90_000);
  const boxes = async (search: string) => {
    const context = await browser.newContext({ viewport: { width: 820, height: 1180 } });
    const page = await context.newPage();
    const { fake } = await themedSite({ theme: 'kroger', live: false });
    await serveSharePoint(page, fake);
    await page.goto(`${pageUrl('index.html')}?preview=${THEMES.kroger.clientId}${search}`);
    await page.getByRole('button', { name: 'Click here to begin' }).click();
    await page.getByRole('button', { name: /^More question types/ }).click();
    await nextButton(page).click();
    await expect(page.getByRole('progressbar', { name: 'Question 2 of 5' })).toBeVisible();
    await settle(page);
    const rects = await page.locator('.pms-question, .pms-options > *').evaluateAll((nodes) => nodes.map((node) => { const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 2) / 2); }));
    await context.close();
    return rects;
  };
  const moving = await boxes('');
  const still = await boxes('&motion=off');
  expect(moving.length).toBeGreaterThan(2);
  expect(moving).toEqual(still);
});
