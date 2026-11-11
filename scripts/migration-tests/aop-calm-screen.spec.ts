import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { localDate } from '../../migration/src/lib/admin/admin-today.js';
import { DEFAULT_CRITERIA } from '../../migration/src/lib/admin/aop-editor.js';
import { encodeAnswer } from '../../migration/src/lib/participant/aop-answer.js';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';
import { installAudioStub, installConfettiSpy, readAudio, readConfetti, resetConfetti } from './effects-support.js';
import { CUES, toneSignature } from '../../migration/src/lib/effects/sound-cues.js';

// Prompt 35: the Art of Possibility as one calm screen, in the BUILT participant page against the mocked SharePoint REST, with the manager's sample (13
// sub-processes by the five default criteria). At an iPad in landscape and in portrait, a 1366 x 650 laptop and a 390 px phone: no sideways scroll, the page
// is the one thing that scrolls, every criterion heading is shown whole, boxes are 48 px, the headings stay in view, the first-box bubble shows once, the
// notes open beside their heading, the strip shows the progress, and what is stored is what Prompt 34 stored for the same ratings. (Prompt 42: a tap
// opens a box's choices; the legend is colour and word; the counts are in the summary only; no Undo; no mosaic on the hub.)

const shots = fileURLToPath(new URL('../../test-results/aop-calm-screen/', import.meta.url));
const today = localDate();
const SIZES = {
  'ipad-landscape': { width: 1180, height: 820 },
  'ipad-portrait': { width: 820, height: 1180 },
  laptop: { width: 1366, height: 650 },
  phone: { width: 390, height: 844 },
} as const;
const ROWS: [string, number][] = [['Corp accounting – GL', 29], ['AP / AR', 28], ['Other finance', 11], ['Treasury', 8], ['Tax', 7], ['FP&A', 6], ['Payroll', 5], ['Fixed assets', 4], ['Intercompany', 4], ['Internal audit', 4], ['Regional finance', 4], ['Procurement admin', 3], ['National admin', 0]];
const CRITERIA = DEFAULT_CRITERIA.map((criterion, at) => ({ ...criterion, id: `c-${String(at + 1).repeat(6)}` }));
const OPTION_IDS = ROWS.map((_, at) => `o-${at + 1}`);

async function site() {
  const fake = newFake();
  const tokens: string[] = [];
  await onSite(fake, async (ds) => {
    await ds.createClient({ id: 'c-kroger', name: 'Kroger', slug: 'kroger', status: 'active', themeVersion: 1, theme: null, logoUrl: null, primaryColor: null, secondaryColor: null, createdAt: new Date().toISOString() });
    for (const [at, [label, people]] of ROWS.entries()) await ds.createOption({ id: OPTION_IDS[at], questionId: 'q-aop', ...ds.matrixRowFields({ label, people: String(people) }) });
    await ds.createQuestion({ id: 'q-aop', sectionId: 'sec-aop', type: 'art-of-the-possible', prompt: 'Rate each sub-process on five criteria', optionIds: OPTION_IDS, order: 1, criteria: CRITERIA });
    await ds.createSection({ id: 'sec-aop', title: 'The Art of Possibility', order: 1, enabled: true, industryTags: [], questionIds: ['q-aop'], clientId: 'c-kroger' });
    const { session } = await ds.activateClient('c-kroger', today) as { session: { id: string } };
    await ds.setSessionParticipationMode(session.id, 'client-visit');
    const visitor = await ds.createVisitor({ id: 'v-1', sessionId: session.id, displayName: 'Priya Rao', enabled: true, guestGroup: '' }) as { id: string };
    tokens.push((await ds.provisionQrToken('c-kroger', session.id, { visitorId: visitor.id }) as { id: string }).id);
  });
  return { fake, token: tokens[0] };
}

async function open(page: Page, fake: Fake, token: string, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await serveSharePoint(page, fake);
  await page.goto(`${pageUrl('index.html')}?qr=${token}`);
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await page.getByRole('button', { name: /The Art of Possibility/ }).click();
  await expect(page.getByTestId('matrix')).toBeVisible();
  // The screen's entrance (a rise of 420 ms at most) has settled, so what is measured is where things rest.
  await page.getByTestId('matrix').evaluate((node) => Promise.all(node.getAnimations().map((each) => each.finished)));
}

const box = (page: Page, row: string, criterion: string) => page.getByRole('button', { name: new RegExp(`^${row.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}, ${criterion.replace(/\//g, '\\/')}: `) });
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const saved = (fake: Fake) => JSON.parse(fake.lists.get('responses')?.[0]?.ResponsesJson ?? '[]');
const progress = (page: Page) => page.getByRole('progressbar', { name: 'Your progress' });
/** Prompt 42: a tap opens the box's choices, and the choice rates it. */
async function rate(page: Page, target: ReturnType<typeof box>, level: 'Low' | 'Medium' | 'High' | 'Clear') {
  await target.click();
  await page.getByRole('menu').getByRole('menuitemradio', { name: level }).click();
}
const axeOn = async (page: Page) => expect((await new AxeBuilder({ page }).include('[data-testid="matrix"]').analyze()).violations.map((each) => `${each.id}: ${each.nodes[0]?.target}`)).toEqual([]);

/** Every word of every criterion heading on one line of its own heading, and inside its cell: no word is split or cut. */
const brokenHeadingWords = (page: Page) => page.evaluate(() => {
  const broken: string[] = [];
  for (const words of document.querySelectorAll<HTMLElement>('.matrix-head-words')) {
    const text = words.firstChild as Text;
    const cell = words.closest('th')!.getBoundingClientRect();
    for (const match of (text.data ?? '').matchAll(/\S+/g)) {
      const range = document.createRange();
      range.setStart(text, match.index!);
      range.setEnd(text, match.index! + match[0].length);
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
      if (rects.length !== 1) broken.push(`"${match[0]}" on ${rects.length} lines`);
      else if (rects[0].right > cell.right + 0.5 || rects[0].left < cell.left - 0.5) broken.push(`"${match[0]}" runs out of its heading`);
    }
  }
  return broken;
});

test.describe('the Art of Possibility, one calm screen (Prompt 35)', () => {
  for (const [name, size] of Object.entries(SIZES)) {
    test(`${name} (${size.width} x ${size.height}): the view it starts in, one scroll, whole headings, 48 px boxes, headings in view`, async ({ page }) => {
      const { fake, token } = await site();
      await open(page, fake, token, size);
      const grid = size.width >= 700 && size.width > size.height;
      await expect(page.getByRole('button', { name: grid ? 'All at once' : 'One at a time' })).toHaveAttribute('aria-pressed', 'true');
      // The chrome is one line: no "Question 1 of 1", no number before the question.
      await expect(page.getByText('Question 1 of 1')).toHaveCount(0);
      await expect(page.locator('h2')).toHaveText('Rate each sub-process on five criteria');
      expect(await noSidewaysScroll(page)).toBe(true);
      await page.screenshot({ path: `${shots}${name}-empty.png`, fullPage: true });
      if (!grid) {
        await page.getByRole('button', { name: 'All at once' }).click();
        await page.screenshot({ path: `${shots}${name}-grid-chosen.png`, fullPage: true });
        return;
      }
      // One scroll: the grid has none of its own.
      expect(await page.locator('.matrix-well').evaluate((node) => getComputedStyle(node).overflowX === 'visible' && node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight + 1)).toBe(true);
      expect(await brokenHeadingWords(page)).toEqual([]);
      const first = await box(page, 'Corp accounting – GL', 'Strategic value').boundingBox();
      expect(first!.width).toBeGreaterThanOrEqual(48);
      expect(first!.height).toBeGreaterThanOrEqual(48);
      // The People column: the number only, its words for a screen reader.
      await expect(page.getByRole('columnheader', { name: 'People in scope' })).toBeVisible();
      await expect(page.getByRole('row', { name: /Corp accounting/ }).getByRole('cell').first()).toHaveText('29');
      // Scroll the page: the strip and the headings stay in view.
      const stripTop = await page.locator('.matrix-strip').evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const head = (await page.getByRole('columnheader', { name: /Strategic value/ }).boundingBox())!;
      const strip = (await page.locator('.matrix-strip').boundingBox())!;
      // Scrolled past where it started, the strip sits at the top of the screen; short of that it has simply moved up with the page.
      const scrolled = await page.evaluate(() => window.scrollY);
      expect(Math.abs(strip.y - Math.max(0, stripTop - scrolled))).toBeLessThan(2);
      // The headings are never under the strip, and never scrolled off the screen.
      expect(head.y).toBeGreaterThanOrEqual(strip.y + strip.height - 1);
      expect(head.y + head.height).toBeLessThanOrEqual(size.height);
      await axeOn(page);
    });
  }

  test('a tap opens the choices and never rates by itself (Prompt 42: no press and hold, no tap-to-cycle); the keys; Escape; Clear all asks (laptop)', async ({ page }) => {
    const { fake, token } = await site();
    await open(page, fake, token, SIZES.laptop);
    await expect(page.getByText('Tap a box and choose Low, Medium or High.')).toBeVisible();
    await expect(page.getByTestId('matrix-teach')).toHaveText('Tap to rate');
    const gl = box(page, 'Corp accounting – GL', 'Strategic value');
    const menu = page.getByRole('menu');

    // A tap: the choices open on the box, and nothing is rated until one is chosen. The bubble stays until the first rating.
    const at = (await gl.boundingBox())!;
    const clip = { x: at.x - 24, y: at.y - 24, width: at.width + 220, height: at.height + 260 };
    await gl.click();
    await expect(menu).toBeVisible();
    await page.screenshot({ path: `${shots}tap-open.png`, clip });
    await expect(gl).toHaveAttribute('data-level', '0');
    await expect(page.getByTestId('matrix-teach')).toHaveCount(1);
    for (const [index, name] of ['Low', 'Medium', 'High'].entries()) await expect(menu.getByRole('menuitemradio').nth(index)).toHaveAccessibleName(name);
    await expect(menu.getByRole('menuitemradio')).toHaveCount(3);
    await expect(menu.getByRole('menuitemradio', { name: 'Low' })).toBeFocused();
    for (const item of await menu.getByRole('menuitemradio').all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await axeOn(page);
    await page.screenshot({ path: `${shots}laptop-menu-open.png`, fullPage: true });
    await menu.getByRole('menuitemradio', { name: 'Medium' }).click();
    await expect(menu).toHaveCount(0);
    await expect(gl).toHaveAttribute('data-level', '2');
    await expect(gl).toBeFocused();
    await expect(page.getByTestId('matrix-teach')).toHaveCount(0);

    // Another tap opens the choices again and changes nothing; Escape closes them and puts the keyboard back on the box.
    await gl.click();
    await expect(menu.getByRole('menuitemradio', { name: 'Medium' })).toHaveAttribute('aria-checked', 'true');
    await expect(gl).toHaveAttribute('data-level', '2');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(gl).toBeFocused();
    await expect(gl).toHaveAttribute('data-level', '2');

    // The keyboard: Enter opens the choices on the box's level; arrows and Enter pick; Clear (offered once rated) empties the box, with no Undo.
    await page.keyboard.press('Enter');
    await expect(menu.getByRole('menuitemradio', { name: 'Medium' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'Clear' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(gl).toHaveAttribute('data-level', '0');
    await expect(gl).toBeFocused();
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);

    // The menu key (Shift+F10) opens it too, and Tab leaves it: it is not a trap.
    await gl.focus();
    await page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);

    // L, M, H set; Delete clears; Space opens the choices (it never takes the next level).
    await gl.focus();
    for (const [key, level] of [['l', '1'], ['m', '2'], ['h', '3'], ['Delete', '0']]) {
      await page.keyboard.press(key);
      await expect(gl).toHaveAttribute('data-level', level);
    }
    await page.keyboard.press('Space');
    await expect(menu).toBeVisible();
    await expect(gl).toHaveAttribute('data-level', '0');
    await page.keyboard.press('l');
    await expect(gl).toHaveAttribute('data-level', '1');

    // On the last row the choices open above the box when there is no room below.
    const last = box(page, 'National admin', 'Outsourcing suitability');
    await last.scrollIntoViewIfNeeded();
    await last.focus();
    await page.keyboard.press('Enter');
    const lastAt = (await last.boundingBox())!;
    const menuAt = (await menu.boundingBox())!;
    if (lastAt.y + lastAt.height + menuAt.height > SIZES.laptop.height) expect(menuAt.y + menuAt.height).toBeLessThanOrEqual(lastAt.y + 1);
    expect(menuAt.x + menuAt.width).toBeLessThanOrEqual(SIZES.laptop.width);
    await page.keyboard.press('Escape');

    // Clear all asks first, in plain words, and nothing brings the ratings back (Prompt 42: no Undo).
    await page.keyboard.press('h');
    await expect(progress(page)).toHaveAttribute('aria-valuenow', '2');
    await page.getByRole('button', { name: 'More choices' }).click();
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.getByText('Remove all your ratings?')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(progress(page)).toHaveAttribute('aria-valuenow', '2');
    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(progress(page)).toHaveAttribute('aria-valuenow', '0');
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    await expect(gl).toHaveAttribute('data-level', '0');
  });

  test('One at a time on a phone: a card per sub-process, the words shown, it moves on after the last box, Previous stops it', async ({ page }) => {
    const { fake, token } = await site();
    await open(page, fake, token, SIZES.phone);
    const card = page.getByTestId('matrix-card');
    await expect(card.getByText('Sub-process 1 of 13')).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Corp accounting – GL' })).toBeVisible();
    await expect(card.getByText('29 people', { exact: true })).toBeVisible();
    // Five criteria, each with its words shown (not behind an i) and three 56 px choices with their shape.
    const groups = card.getByRole('group');
    await expect(groups).toHaveCount(5);
    for (const [at, criterion] of CRITERIA.entries()) {
      const group = groups.nth(at);
      await expect(group).toHaveAccessibleName(criterion.label);
      await expect(group.getByText(criterion.hint)).toBeVisible();
      await expect(group.getByRole('button')).toHaveText(['Low', 'Medium', 'High']);
      for (const choice of await group.getByRole('button').all()) {
        expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(56);
        await expect(choice.locator('svg path')).toHaveCount(1);
      }
    }
    await expect(card.getByRole('button', { name: 'About' })).toHaveCount(0);
    expect(await noSidewaysScroll(page)).toBe(true);
    await axeOn(page);
    await page.screenshot({ path: `${shots}phone-card.png`, fullPage: true });

    // The fifth rating: a check, then the next sub-process 600 ms later.
    const rateRow = async (choice: string) => { for (const criterion of CRITERIA) await card.getByRole('group', { name: criterion.label }).getByRole('button', { name: choice }).click(); };
    await rateRow('High');
    await expect(card.getByTestId('matrix-card-done')).toBeVisible();
    await page.screenshot({ path: `${shots}phone-card-done.png`, fullPage: true });
    await expect(card.getByText('Sub-process 2 of 13')).toBeVisible({ timeout: 2000 });
    await expect(card.getByRole('heading', { name: 'AP / AR' })).toBeFocused();

    // Previous, tapped before it moves on, keeps the guest on this one.
    await rateRow('Low');
    await card.getByRole('button', { name: 'Previous' }).click();
    await page.waitForTimeout(900);
    await expect(card.getByText('Sub-process 2 of 13')).toBeVisible();
    await card.getByRole('button', { name: 'Next sub-process' }).click();
    await card.getByRole('button', { name: 'Next sub-process' }).click();
    await expect(card.getByText('Sub-process 4 of 13')).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Treasury' })).toBeVisible();
    await expect(progress(page)).toHaveAttribute('aria-valuenow', '10');
  });

  test('One at a time with motion off waits for Next', async ({ page }) => {
    const { fake, token } = await site();
    await page.setViewportSize(SIZES.phone);
    await serveSharePoint(page, fake);
    await page.goto(`${pageUrl('index.html')}?qr=${token}&motion=off`);
    await page.getByRole('button', { name: 'Click here to begin' }).click();
    await page.getByRole('button', { name: /The Art of Possibility/ }).click();
    const card = page.getByTestId('matrix-card');
    for (const criterion of CRITERIA) await card.getByRole('group', { name: criterion.label }).getByRole('button', { name: 'Medium' }).click();
    await expect(card.getByTestId('matrix-card-done')).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(card.getByText('Sub-process 1 of 13')).toBeVisible();
  });

  test('the motion: a pop and a ripple, a finished row, the milestones once each, Clear all\'s fly-away and the wave under the cap (iPad landscape)', async ({ page }) => {
    const { fake, token } = await site();
    await open(page, fake, token, SIZES['ipad-landscape']);
    const running = () => page.evaluate(() => document.getAnimations().filter((each) => each.playState === 'running').length);
    /** The most animations running at once over `ms`, sampled each frame, while `act` runs. */
    const most = async (act: () => Promise<unknown>, ms: number) => {
      await page.evaluate((span) => {
        const scope = window as unknown as { pmsMost: number };
        scope.pmsMost = 0;
        const end = performance.now() + span;
        const sample = () => { scope.pmsMost = Math.max(scope.pmsMost, document.getAnimations().filter((each) => each.playState === 'running').length); if (performance.now() < end) requestAnimationFrame(sample); };
        requestAnimationFrame(sample);
      }, ms);
      await act();
      await page.waitForTimeout(ms);
      return page.evaluate(() => (window as unknown as { pmsMost: number }).pmsMost);
    };
    const nextAndRate = async (times: number, key = 'h') => {
      for (let at = 0; at < times; at += 1) {
        await page.getByRole('button', { name: /Next empty box/ }).click();
        await page.keyboard.press(key);
      }
    };

    // A choice: the box's content pops and a ripple grows from the box (Prompt 42: the tap opens the choices).
    const gl = box(page, 'Corp accounting – GL', 'Strategic value');
    await rate(page, gl, 'Low');
    expect(await gl.locator('.matrix-face').evaluate((node) => node.getAnimations().length)).toBe(1);
    expect(await page.locator('.matrix-ripple').evaluate((node) => node.getAnimations().length)).toBe(1);
    await page.waitForTimeout(500);
    expect(await running()).toBe(0);

    // A finished row: its check arrives and the sheen sweeps across it.
    await gl.focus();
    for (const key of ['ArrowRight', 'h', 'ArrowRight', 'h', 'ArrowRight', 'h']) await page.keyboard.press(key);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('h');
    expect(await page.getByRole('row', { name: /Corp accounting/ }).getByTestId('matrix-row-done').evaluate((node) => node.getAnimations().length)).toBe(1);
    expect(await page.locator('.matrix-sheen').evaluate((node) => node.getAnimations().length)).toBe(1);

    // The milestones: 17, 33 and 49 of 65, each said once, gone after 1.6 seconds.
    const label = page.getByTestId('matrix-milestone');
    await nextAndRate(11);
    await expect(label).toHaveCount(0);
    await nextAndRate(1);
    await expect(label).toHaveText('A quarter done');
    await page.screenshot({ path: `${shots}milestone.png` });
    await expect(label).toHaveCount(0, { timeout: 2500 });
    await nextAndRate(16);
    await expect(label).toHaveText('Halfway');
    await nextAndRate(16);
    await expect(label).toHaveText('Nearly there');
    await expect(progress(page)).toHaveAttribute('aria-valuenow', '49');

    // Clear all: copies of the rated boxes fly off, never more than 16 things moving, and they are gone (Prompt 42: asked first; no Undo). Rating the
    // boxes again says no milestone a second time.
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: 'More choices' }).click();
    await page.getByRole('button', { name: 'Clear all' }).click();
    const flying = await most(() => page.getByRole('button', { name: 'Remove' }).click(), 1200);
    console.log(`  Clear all: at most ${flying} animations at once`);
    expect(flying).toBeGreaterThan(0);
    expect(flying).toBeLessThanOrEqual(16);
    await expect(page.locator('.motion-copy')).toHaveCount(0);
    await expect(progress(page)).toHaveAttribute('aria-valuenow', '0');
    await nextAndRate(49);
    await expect(progress(page)).toHaveAttribute('aria-valuenow', '49');
    await expect(label).toHaveCount(0);

    // The last box: the wave runs through the grid under the cap, and the bar's check arrives.
    await nextAndRate(15);
    await page.waitForTimeout(700);
    const waving = await most(() => nextAndRate(1), 1200);
    console.log(`  the wave: at most ${waving} animations at once`);
    expect(waving).toBeGreaterThan(5);
    expect(waving).toBeLessThanOrEqual(16);
    await expect(page.getByTestId('matrix-bar-check')).toBeVisible();
    await page.screenshot({ path: `${shots}ipad-landscape-all-rated.png`, fullPage: true });
  });

  test('with motion off nothing moves, and a milestone\'s words still show', async ({ page }) => {
    const { fake, token } = await site();
    await page.setViewportSize(SIZES['ipad-landscape']);
    await serveSharePoint(page, fake);
    await page.goto(`${pageUrl('index.html')}?qr=${token}&motion=off`);
    await page.getByRole('button', { name: 'Click here to begin' }).click();
    await page.getByRole('button', { name: /The Art of Possibility/ }).click();
    for (let at = 0; at < 17; at += 1) {
      await page.getByRole('button', { name: /Next empty box/ }).click();
      await page.keyboard.press('m');
    }
    await expect(page.getByTestId('matrix-milestone')).toHaveText('A quarter done');
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    await page.getByRole('button', { name: 'More choices' }).click();
    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('.motion-copy')).toHaveCount(0);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });

  test('at a 4x slower processor the wave and Clear all keep 30 frames a second (Chromium, measured and printed)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the processor slowdown is Chromium\'s (DevTools protocol)');
    const { fake, token } = await site();
    await open(page, fake, token, SIZES['ipad-landscape']);
    for (let at = 0; at < 64; at += 1) {
      await page.getByRole('button', { name: /Next empty box/ }).click();
      await page.keyboard.press('m');
    }
    await page.waitForTimeout(2000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const frames = async (act: () => Promise<unknown>, ms: number) => {
      await page.evaluate((span) => {
        const scope = window as unknown as { pmsFrames: number[] };
        scope.pmsFrames = [];
        let last = 0;
        const end = performance.now() + span;
        const step = (now: number) => { if (last) scope.pmsFrames.push(now - last); last = now; if (now < end) requestAnimationFrame(step); };
        requestAnimationFrame(step);
      }, ms);
      await act();
      await page.waitForTimeout(ms + 200);
      const gaps = await page.evaluate(() => (window as unknown as { pmsFrames: number[] }).pmsFrames);
      return { fps: 1000 / (gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length), worst: Math.max(...gaps) };
    };
    const wave = await frames(async () => { await page.getByRole('button', { name: /Next empty box/ }).click(); await page.keyboard.press('m'); }, 1000);
    await page.getByRole('button', { name: 'More choices' }).click();
    await page.getByRole('button', { name: 'Clear all' }).click();
    const cleared = await frames(() => page.getByRole('button', { name: 'Remove' }).click(), 1000);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    console.log(`  4x slowdown: the wave ${wave.fps.toFixed(0)} fps (slowest frame ${wave.worst.toFixed(0)} ms); Clear all ${cleared.fps.toFixed(0)} fps (slowest frame ${cleared.worst.toFixed(0)} ms)`);
    expect(wave.fps).toBeGreaterThanOrEqual(30);
    expect(cleared.fps).toBeGreaterThanOrEqual(30);
  });

  test('the sounds, with sound on: a note per level, the clear\'s tick, opening the choices is silent, a finished row, the milestones, Clear all, every box rated with its burst; a fast run never piles up', async ({ page }) => {
    const { fake, token } = await site();
    await installAudioStub(page, {});
    await installConfettiSpy(page);
    await page.addInitScript(() => { window.localStorage.setItem('pms.sound', 'on'); });
    await open(page, fake, token, SIZES['ipad-landscape']);
    const heard = async () => (await readAudio(page)).oscillators;
    const since = async (count: number) => (await heard()).slice(count);
    const first = (name: keyof typeof CUES) => toneSignature(CUES[name])[0];
    const gl = box(page, 'Corp accounting – GL', 'Strategic value');

    // A choice a level: Low G3, Medium E4, High C5; a clear is the soft tick (noise, no note). Opening the choices plays nothing (Prompt 42).
    for (const [name, level] of [['rateLow', 'Low'], ['rateMedium', 'Medium'], ['rateHigh', 'High']] as const) {
      const before = (await heard()).length;
      await gl.click();
      await expect(page.getByRole('menu')).toBeVisible();
      await page.waitForTimeout(80);
      expect(await since(before), 'opening the choices is silent').toEqual([]);
      await page.getByRole('menu').getByRole('menuitemradio', { name: level }).click();
      await expect.poll(async () => (await since(before))[0]).toBe(first(name));
      await page.waitForTimeout(80);
    }
    const noise = (await readAudio(page)).noise;
    const before = (await heard()).length;
    await rate(page, gl, 'Clear');
    await expect.poll(async () => (await readAudio(page)).noise).toBeGreaterThan(noise);
    expect(await since(before)).toEqual([]);
    await gl.focus();
    await page.keyboard.press('m');
    await page.waitForTimeout(80);
    let mark = (await heard()).length;

    // A fast run of 20 key presses: the rating cues start at most once every 60 ms.
    mark = (await heard()).length;
    const started = Date.now();
    for (let at = 0; at < 20; at += 1) await page.keyboard.press(['l', 'm', 'h'][at % 3]);
    const span = Date.now() - started;
    await page.waitForTimeout(100);
    const notes = (await since(mark)).filter((freq) => [first('rateLow'), first('rateMedium'), first('rateHigh')].includes(freq)).length;
    console.log(`  20 key presses in ${span} ms: ${notes} rating cues`);
    expect(notes).toBeGreaterThan(0);
    expect(notes).toBeLessThanOrEqual(Math.floor(span / 60) + 1);

    // A finished row: two notes up, E5 then G5.
    await gl.focus();
    for (const key of ['ArrowRight', 'm', 'ArrowRight', 'm', 'ArrowRight', 'm']) { await page.keyboard.press(key); await page.waitForTimeout(100); }
    await page.keyboard.press('ArrowRight');
    mark = (await heard()).length;
    await page.keyboard.press('m');
    await expect.poll(async () => await since(mark)).toEqual([...toneSignature(CUES.rateMedium), ...toneSignature(CUES.rowDone)]);

    // The quarter milestone (17 of 65, not a row's end): C5 alone after the Medium's E4.
    for (let at = 0; at < 11; at += 1) { await page.getByRole('button', { name: /Next empty box/ }).click(); await page.keyboard.press('m'); await page.waitForTimeout(100); }
    await page.getByRole('button', { name: /Next empty box/ }).click();
    mark = (await heard()).length;
    await page.keyboard.press('m');
    await expect(page.getByTestId('matrix-milestone')).toHaveText('A quarter done');
    await expect.poll(async () => await since(mark)).toEqual([...toneSignature(CUES.rateMedium), ...toneSignature(CUES.milestoneQuarter)]);

    // Clear all: the descending run.
    await page.getByRole('button', { name: 'More choices' }).click();
    await page.getByRole('button', { name: 'Clear all' }).click();
    mark = (await heard()).length;
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect.poll(async () => await since(mark)).toEqual(toneSignature(CUES.clearAll));

    // Every box rated: the arpeggio, and the small burst from the bar.
    for (let at = 0; at < 64; at += 1) { await page.getByRole('button', { name: /Next empty box/ }).click(); await page.keyboard.press('l'); }
    await page.waitForTimeout(400);
    await resetConfetti(page);
    mark = (await heard()).length;
    await page.getByRole('button', { name: /Next empty box/ }).click();
    await page.keyboard.press('l');
    await expect.poll(async () => await since(mark)).toEqual([...toneSignature(CUES.rateLow), ...toneSignature(CUES.allRated)]);
    await expect.poll(async () => (await readConfetti(page)).added).toBe(1);
  });

  test('with sound off nothing plays and no audio is ever started; with sound on nothing plays until the first tap', async ({ page }) => {
    const { fake, token } = await site();
    await installAudioStub(page, {});
    await open(page, fake, token, SIZES['ipad-landscape']);
    for (let at = 0; at < 6; at += 1) { await page.getByRole('button', { name: /Next empty box/ }).click(); await page.keyboard.press('h'); }
    const off = await readAudio(page);
    expect(off.contexts).toBe(0);
    expect(off.oscillators).toEqual([]);

    const second = await site();
    const quiet = await page.context().newPage();
    await installAudioStub(quiet, {});
    await quiet.addInitScript(() => { window.localStorage.setItem('pms.sound', 'on'); });
    await quiet.setViewportSize(SIZES['ipad-landscape']);
    await serveSharePoint(quiet, second.fake);
    await quiet.goto(`${pageUrl('index.html')}?qr=${second.token}`);
    await quiet.waitForTimeout(500);
    expect((await readAudio(quiet)).oscillators).toEqual([]);
    expect((await readAudio(quiet)).contexts).toBe(0);
  });

  test('a choice shows its colour within 100 ms at a 4x slower processor (Chromium, measured and printed)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the processor slowdown is Chromium\'s (DevTools protocol)');
    const { fake, token } = await site();
    await open(page, fake, token, SIZES['ipad-landscape']);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    // From the press to the first frame painted after the box took its level: a capture listener stamps the press, a MutationObserver sees the
    // level, and the frame after next is when it is on screen.
    await page.evaluate(() => {
      const scope = window as unknown as { pmsTaps: number[] };
      scope.pmsTaps = [];
      let pressed = 0;
      document.addEventListener('pointerdown', () => { pressed = performance.now(); }, true);
      new MutationObserver(() => {
        const from = pressed;
        if (!from) return;
        pressed = 0;
        requestAnimationFrame(() => requestAnimationFrame(() => scope.pmsTaps.push(performance.now() - from)));
      }).observe(document.querySelector('[data-testid="matrix"]')!, { subtree: true, attributeFilter: ['data-level'] });
    });
    for (const row of ROWS.slice(0, 4)) {
      for (const criterion of CRITERIA.slice(0, 3)) {
        await box(page, row[0], criterion.label).click();
        await page.getByRole('menu').getByRole('menuitemradio', { name: 'High' }).click();
        await page.waitForTimeout(120);
      }
    }
    const taps = await page.evaluate(() => (window as unknown as { pmsTaps: number[] }).pmsTaps.slice().sort((a, b) => a - b));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const median = taps[Math.floor(taps.length / 2)];
    const worst = taps[taps.length - 1];
    console.log(`  choice to paint at 4x slowdown, ${taps.length} taps: median ${median.toFixed(1)} ms, slowest ${worst.toFixed(1)} ms`);
    expect(taps.length).toBe(12);
    expect(median).toBeLessThan(100);
  });

  test('the bubble, the strip, the notes and the stored answer (iPad landscape)', async ({ page }) => {
    const { fake, token } = await site();
    await open(page, fake, token, SIZES['ipad-landscape']);
    // The bubble points at the first empty box, and goes for this visit after the first rating.
    const teach = page.getByTestId('matrix-teach');
    await expect(teach).toHaveText('Tap to rate');
    const firstBox = box(page, 'Corp accounting – GL', 'Strategic value');
    await expect(firstBox).toHaveAttribute('aria-describedby', /teach/);
    await rate(page, firstBox, 'Low');
    await expect(box(page, 'Corp accounting – GL', 'Strategic value')).toHaveAttribute('data-level', '1');
    await expect(teach).toHaveCount(0);
    await page.getByRole('button', { name: 'One at a time' }).click();
    await page.getByRole('button', { name: 'All at once' }).click();
    await expect(teach).toHaveCount(0);

    // Each choice: Low, Medium, High, then Clear; each with its letter and its shape.
    const gl = box(page, 'Corp accounting – GL', 'Volume / repeatability');
    for (const [level, letter, name] of [['1', 'L', 'Low'], ['2', 'M', 'Medium'], ['3', 'H', 'High']] as const) {
      await rate(page, gl, name);
      await expect(gl).toHaveAttribute('data-level', level);
      await expect(gl).toHaveText(letter);
      await expect(gl.locator('svg path')).toHaveCount(1);
    }
    await rate(page, gl, 'Clear');
    await expect(gl).toHaveAttribute('data-level', '0');
    await expect(progress(page)).toHaveAttribute('aria-valuenow', '1');
    await expect(page.getByTestId('matrix-legend')).toHaveText(/^Low\s*Medium\s*High$/);
    await expect(page.getByRole('button', { name: /Next empty box/ })).toContainText('64 left');
    await expect(page.getByText('Colour shows the rating, not good or bad.')).toBeVisible();

    // A note opens beside its heading, does not move the grid, and closes on Escape (focus back on its button) and on a tap outside.
    const before = await gl.boundingBox();
    const about = page.getByRole('button', { name: 'About Standardisation' });
    await about.click();
    const note = page.getByTestId('matrix-about');
    await expect(note).toContainText('High: one documented way of working.');
    const heading = (await page.getByRole('columnheader', { name: /Standardisation/ }).boundingBox())!;
    const placed = (await note.boundingBox())!;
    expect(placed.y).toBeGreaterThanOrEqual(heading.y + heading.height - 1);
    expect(placed.y).toBeLessThan(heading.y + heading.height + 12);
    expect(placed.x + placed.width).toBeGreaterThan(heading.x);
    expect(placed.x).toBeLessThan(heading.x + heading.width);
    expect(await gl.boundingBox()).toEqual(before);
    await axeOn(page);
    await page.screenshot({ path: `${shots}ipad-landscape-note.png` });
    await page.keyboard.press('Escape');
    await expect(note).toHaveCount(0);
    await expect(about).toBeFocused();
    await about.click();
    await expect(note).toBeVisible();
    await page.getByText('Colour shows the rating, not good or bad.').click();
    await expect(note).toHaveCount(0);

    // A finished row shows its check.
    await box(page, 'Corp accounting – GL', 'Strategic value').focus();
    for (const key of ['ArrowRight', 'h', 'ArrowRight', 'm', 'ArrowRight', 'l', 'ArrowRight', 'h']) await page.keyboard.press(key);
    await expect(page.getByRole('row', { name: /Corp accounting/ }).getByTestId('matrix-row-done')).toBeVisible();
    await page.screenshot({ path: `${shots}ipad-landscape-partial.png`, fullPage: true });

    // Clear all is in the "More choices" menu and asks first.
    await page.getByRole('button', { name: 'More choices' }).click();
    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(progress(page)).toHaveAttribute('aria-valuenow', '0');
    await expect(page.getByTestId('matrix-glance')).toHaveCount(0);

    // Every box High through Next empty box, then Send: the answer Prompt 34 stored for the same ratings.
    for (let at = 0; at < 65; at += 1) {
      await page.getByRole('button', { name: /Next empty box/ }).click();
      await page.keyboard.press('h');
    }
    await expect(page.getByRole('button', { name: 'All done' })).toBeDisabled();
    // (Prompt 35) Your ratings at a glance: under the grid once every box is rated; made on the device from the draft, nothing more is stored or sent.
    const glance = page.getByTestId('matrix-glance');
    await expect(glance.getByRole('heading', { name: 'You rated all 65 boxes' })).toBeVisible();
    await expect(glance.getByRole('img')).toHaveCount(0); // (Prompt 42: no mosaic beside the headline)
    await expect(glance.getByTestId('matrix-tally')).toHaveText(['Low 0', 'Medium 0', 'High 65']);
    await expect(glance).toContainText('Your highest-rated sub-process was Corp accounting – GL (5 High).');
    await axeOn(page);
    await page.screenshot({ path: `${shots}ipad-landscape-complete.png`, fullPage: true });
    await page.getByRole('button', { name: /^Send/ }).click();
    await expect(page.getByRole('heading', { name: /Nice work/ })).toBeVisible();
    const [record] = saved(fake);
    const all = Object.fromEntries(OPTION_IDS.map((id) => [id, Object.fromEntries(CRITERIA.map((criterion) => [criterion.id, 3]))]));
    expect(record.answer).toEqual(encodeAnswer(all));

    // (Prompt 42) The hub: the finished activity has no mosaic any more, and nothing about the ratings is requested.
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.getByRole('button', { name: 'Back to activities' }).click();
    await expect(page.getByRole('button', { name: /The Art of Possibility, done/ })).toBeVisible();
    await expect(page.getByRole('img', { name: /Your ratings/ })).toHaveCount(0);
    await page.waitForTimeout(2500); // (the hub's stamp moment settles)
    await page.screenshot({ path: `${shots}hub-badge.png`, fullPage: true });
    // The thank-you: the ratings are in, and how many.
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByText('Your ratings are in.')).toBeVisible();
    await expect(page.getByText('65 ratings', { exact: true })).toBeVisible();
    await page.waitForTimeout(3000); // (the finale's confetti settles)
    await page.screenshot({ path: `${shots}thank-you.png`, fullPage: true });
    expect(requests.filter((url) => /aop|glance|ratings/i.test(url))).toEqual([]);
  });
});
